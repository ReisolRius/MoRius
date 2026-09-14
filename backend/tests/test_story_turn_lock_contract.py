"""The contract that makes "Ход еще синхронизируется" unreachable.

Three properties, each of which was broken before and each of which is what the player
actually experienced when it was:

1. **A finished turn's lock hold is bounded and small.** The only service-model work left on
   the turn's own lock is Call A «Мир», under ``STORY_TURN_SERVICE_DEADLINE_SECONDS``.
   Everything that used to follow it -- Call B «Персонажи», the graph, the D&D upkeep,
   memory compaction -- runs off-turn. The bound has to stay comfortably under every wait,
   because the gap between them is exactly where the toast came from.
2. **Background work yields to the player.** A player-facing operation queued behind off-turn
   catch-up is visible to it, so it steps aside instead of racing.
3. **A cancellation never throws away a paid turn.** Anything that wanted the lock used to
   cancel the in-flight generation to get in -- and if that turn had already been charged,
   the player lost both the turn and the sols.
"""

from __future__ import annotations

from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import story_dnd, story_memory, story_messages, story_undo  # noqa: E402
from app.services import story_runtime  # noqa: E402
from app.services.story_game_operation_lock import (  # noqa: E402
    STORY_LOCK_PRIORITY_BACKGROUND,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
    story_game_operation_preempt_requested,
)


class StoryTurnLockBoundsTests(unittest.TestCase):
    def test_lock_waits_comfortably_outlast_the_longest_possible_hold(self) -> None:
        # What a finished turn can still hold the lock for: one bounded service request plus
        # row writes. Everything else was moved off-turn.
        worst_case_hold_seconds = story_runtime.STORY_TURN_SERVICE_DEADLINE_SECONDS + 5.0

        waits = {
            "generate": story_runtime.STORY_GENERATE_LOCK_WAIT_SECONDS,
            "undo/redo/reroll": story_undo._STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
            "message edit / variant": story_messages._STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
            "memory edit": story_memory._STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
            "d&d": story_dnd._STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
        }
        for label, wait_seconds in waits.items():
            with self.subTest(operation=label):
                self.assertGreater(
                    wait_seconds,
                    worst_case_hold_seconds,
                    f"{label} gives up before a legitimately busy turn can finish",
                )

    def test_the_inline_service_deadline_stays_small(self) -> None:
        # One request, not a chain of them. If this ever grows back past the waits above, the
        # toast comes back with it.
        self.assertLessEqual(story_runtime.STORY_TURN_SERVICE_DEADLINE_SECONDS, 30.0)


class StoryLockPriorityTests(unittest.TestCase):
    game_id = 9_311

    def setUp(self) -> None:
        patcher = patch(
            "app.services.story_game_operation_lock._should_use_postgresql_advisory_locks",
            return_value=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_background_holder_sees_a_player_queue_up_behind_it(self) -> None:
        background_lease = acquire_story_game_operation_lock(
            self.game_id,
            operation="story_turn_postprocess_graph",
            wait_timeout_seconds=None,
            priority=STORY_LOCK_PRIORITY_BACKGROUND,
        )
        try:
            self.assertFalse(story_game_operation_preempt_requested(self.game_id))

            waiter_finished = threading.Event()

            def player_operation() -> None:
                try:
                    acquire_story_game_operation_lock(
                        self.game_id,
                        operation="story_generate",
                        wait_timeout_seconds=2.0,
                    )
                except StoryGameOperationBusyError:
                    pass
                finally:
                    waiter_finished.set()

            waiter = threading.Thread(target=player_operation, daemon=True)
            waiter.start()

            deadline = time.monotonic() + 2.0
            saw_preempt = False
            while time.monotonic() < deadline:
                if story_game_operation_preempt_requested(self.game_id):
                    saw_preempt = True
                    break
                time.sleep(0.01)
            self.assertTrue(saw_preempt, "background work cannot tell that a player is waiting")
        finally:
            background_lease.release()
            waiter_finished.wait(timeout=5.0)

    def test_a_background_waiter_never_registers_as_a_player(self) -> None:
        holder = acquire_story_game_operation_lock(
            self.game_id,
            operation="story_generate",
            wait_timeout_seconds=None,
        )
        try:
            done = threading.Event()

            def background_operation() -> None:
                try:
                    acquire_story_game_operation_lock(
                        self.game_id,
                        operation="story_turn_postprocess_characters",
                        wait_timeout_seconds=0.5,
                        priority=STORY_LOCK_PRIORITY_BACKGROUND,
                    )
                except StoryGameOperationBusyError:
                    pass
                finally:
                    done.set()

            threading.Thread(target=background_operation, daemon=True).start()
            time.sleep(0.15)
            self.assertFalse(
                story_game_operation_preempt_requested(self.game_id),
                "off-turn work must not make other off-turn work step aside for it",
            )
            done.wait(timeout=5.0)
        finally:
            holder.release()


class StoryPaidTurnSurvivesCancellationTests(unittest.TestCase):
    """``_stop_requested`` must stop abandoning the turn once the player has been charged."""

    def _build_stop_requested(self, *, committed: bool):
        state = {"committed": committed, "cancel_after_commit": False, "rolled_back": False}

        # A faithful transcription of the guard in story_runtime._stream_story_response, kept
        # standalone so the property can be asserted without standing up a whole turn.
        def stop_requested(stage: str, *, rollback: bool = False) -> bool:
            if state["committed"]:
                state["cancel_after_commit"] = True
                return False
            if rollback:
                state["rolled_back"] = True
            return True

        return stop_requested, state

    def test_a_cancellation_before_billing_still_discards_the_turn(self) -> None:
        stop_requested, state = self._build_stop_requested(committed=False)
        self.assertTrue(stop_requested("before_billing"))
        self.assertTrue(stop_requested("provider_retry", rollback=True))
        self.assertTrue(state["rolled_back"])
        self.assertFalse(state["cancel_after_commit"])

    def test_a_cancellation_after_billing_keeps_the_turn_and_skips_the_extras(self) -> None:
        stop_requested, state = self._build_stop_requested(committed=True)
        for stage in ("after_billing", "postprocess", "memory_sync", "done_payload"):
            with self.subTest(stage=stage):
                self.assertFalse(
                    stop_requested(stage),
                    "a paid turn must never be abandoned mid-flight",
                )
        self.assertTrue(state["cancel_after_commit"], "the optional modules should be skipped")
        self.assertFalse(state["rolled_back"], "nothing the player paid for may be rolled back")

    def test_the_real_guard_is_wired_the_same_way(self) -> None:
        source = Path(story_runtime.__file__).read_text(encoding="utf-8")
        self.assertIn("if turn_committed:", source)
        self.assertIn("cancel_after_commit = True", source)
        # The deferred half must be skipped for a stopped turn, and the world pass too.
        self.assertIn("False if cancel_after_commit else _schedule_deferred_story_turn_postprocess", source)
        self.assertIn("if not aborted and response_has_content and not cancel_after_commit:", source)


class StoryGenerateHandsTheLockBackEarlyTests(unittest.TestCase):
    """The turn's lease must reach the stream, so it can be given back before ``done``."""

    def test_the_stream_can_release_the_turn_lock_before_the_worker_finishes(self) -> None:
        import asyncio
        from types import SimpleNamespace

        class _Session:
            def __init__(self) -> None:
                self.rollback_calls = 0

            def rollback(self) -> None:
                self.rollback_calls += 1

            def close(self) -> None:
                return

        class _Lease:
            def __init__(self) -> None:
                self.release_calls = 0

            def release(self) -> None:
                self.release_calls += 1

        db = _Session()
        lease = _Lease()
        released_before_done = threading.Event()
        deps = SimpleNamespace(
            validate_provider_config=lambda: None,
            get_current_user=lambda _db, _authorization: SimpleNamespace(id=1),
            get_user_story_game_or_404=lambda _db, _user_id, _game_id: SimpleNamespace(id=77),
        )

        def fake_locked_stream(**kwargs):
            release_turn_lock = kwargs.get("release_turn_lock")
            self.assertTrue(callable(release_turn_lock), "the turn's lease never reached the stream")

            def stream():
                yield story_runtime._sse_event("start", {})
                # Exactly what _stream_story_response does at its done boundary.
                release_turn_lock()
                released_before_done.set()
                yield story_runtime._sse_event("done", {})

            return stream()

        with (
            patch.object(story_runtime, "SessionLocal", return_value=db),
            patch.object(story_runtime, "acquire_story_game_operation_lock", return_value=lease),
            patch.object(story_runtime, "_generate_story_response_locked", side_effect=fake_locked_stream),
        ):
            response = story_runtime.generate_story_response(
                deps=deps,
                game_id=77,
                payload=SimpleNamespace(),
                authorization="Bearer token",
                db=db,
            )

            async def drain() -> list[str]:
                iterator = response.body_iterator
                chunks: list[str] = []
                for _ in range(20):
                    chunk = await iterator.__anext__()
                    chunks.append(chunk)
                    if "event: done" in chunk:
                        break
                await iterator.aclose()
                return chunks

            chunks = asyncio.run(drain())

        self.assertTrue(any("event: done" in chunk for chunk in chunks))
        self.assertTrue(released_before_done.is_set())
        for _ in range(100):
            if lease.release_calls >= 1:
                break
            time.sleep(0.01)
        # The stream gave the lease back early; the generate worker's own finally then calls
        # release() again as its safety net, which the real lease treats as a no-op (see
        # test_releasing_a_lease_twice_is_a_no_op below).
        self.assertGreaterEqual(lease.release_calls, 1)

    def test_releasing_a_lease_twice_is_a_no_op(self) -> None:
        # The early release and the worker's finally both call release() on the same lease, so
        # the second call must not hand the lock back to an unrelated waiter.
        with patch(
            "app.services.story_game_operation_lock._should_use_postgresql_advisory_locks",
            return_value=False,
        ):
            lease = acquire_story_game_operation_lock(
                9_312,
                operation="story_generate",
                wait_timeout_seconds=None,
            )
            lease.release()
            lease.release()
            # Still acquirable, and exactly once -- a double release would have left the
            # underlying lock in a broken state.
            second = acquire_story_game_operation_lock(
                9_312,
                operation="story_generate",
                wait_timeout_seconds=1.0,
            )
            try:
                with self.assertRaises(StoryGameOperationBusyError):
                    acquire_story_game_operation_lock(
                        9_312,
                        operation="story_generate",
                        wait_timeout_seconds=0.05,
                    )
            finally:
                second.release()


if __name__ == "__main__":
    unittest.main()
