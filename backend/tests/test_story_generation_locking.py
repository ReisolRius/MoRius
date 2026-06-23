from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_game_operation_lock import (  # noqa: E402
    STORY_GAME_OPERATION_BUSY_DETAIL,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)
from app.services import story_runtime  # noqa: E402
from app.services.story_generation_cancel import (  # noqa: E402
    cancel_story_generation,
    mark_story_generation_finished,
    mark_story_generation_started,
)
from app.services.story_generation_provider import (  # noqa: E402
    _ensure_story_stream_within_time_budget,
)


class _RollbackTrackingSession:
    def __init__(self) -> None:
        self.rollback_calls = 0

    def rollback(self) -> None:
        self.rollback_calls += 1


class _StreamingSession:
    def __init__(self) -> None:
        self.next_message_id = 700
        self.commit_calls = 0
        self.rollback_calls = 0
        self.deleted: list[object] = []
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)
        if getattr(value, "id", None) is None:
            setattr(value, "id", self.next_message_id)
            self.next_message_id += 1

    def commit(self) -> None:
        self.commit_calls += 1

    def rollback(self) -> None:
        self.rollback_calls += 1

    def refresh(self, _value: object) -> None:
        return

    def delete(self, value: object) -> None:
        self.deleted.append(value)


class StoryGenerationLockingTests(unittest.TestCase):
    def test_stream_time_budget_fails_when_first_token_never_arrives(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "did not produce content"):
            _ensure_story_stream_within_time_budget(
                provider_label="OpenRouter",
                started_at=10.0,
                current_time=131.0,
                emitted_delta=False,
                first_token_timeout_seconds=120.0,
                total_timeout_seconds=300.0,
                story_generation_game_id=None,
                story_generation_id=None,
            )

    def test_stream_time_budget_fails_when_stream_never_finishes(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "exceeded"):
            _ensure_story_stream_within_time_budget(
                provider_label="OpenRouter",
                started_at=10.0,
                current_time=311.0,
                emitted_delta=True,
                first_token_timeout_seconds=120.0,
                total_timeout_seconds=300.0,
                story_generation_game_id=None,
                story_generation_id=None,
            )

    def test_operation_lock_timeout_raises_busy_without_leaking_registry_entry(self) -> None:
        game_id = 9_001
        with patch(
            "app.services.story_game_operation_lock._should_use_postgresql_advisory_locks",
            return_value=False,
        ):
            lease = acquire_story_game_operation_lock(
                game_id,
                operation="test_generation",
                wait_timeout_seconds=None,
            )
            try:
                with self.assertRaises(StoryGameOperationBusyError):
                    acquire_story_game_operation_lock(
                        game_id,
                        operation="test_generation",
                        wait_timeout_seconds=0.001,
                    )
            finally:
                lease.release()

            next_lease = acquire_story_game_operation_lock(
                game_id,
                operation="test_generation",
                wait_timeout_seconds=0.001,
            )
            next_lease.release()

    def test_story_generate_releases_db_before_lock_wait_and_returns_conflict_when_busy(self) -> None:
        db = _RollbackTrackingSession()
        deps = SimpleNamespace(
            validate_provider_config=lambda: None,
            get_current_user=lambda _db, _authorization: SimpleNamespace(id=101),
            get_user_story_game_or_404=lambda _db, _user_id, _game_id: SimpleNamespace(id=202),
        )
        acquire_calls: list[float | None] = []

        def fake_acquire(_game_id: int, *, operation: str, wait_timeout_seconds: float | None):
            self.assertEqual(operation, "story_generate")
            self.assertEqual(db.rollback_calls, 1)
            acquire_calls.append(wait_timeout_seconds)
            raise StoryGameOperationBusyError(STORY_GAME_OPERATION_BUSY_DETAIL)

        with (
            patch.object(story_runtime, "acquire_story_game_operation_lock", side_effect=fake_acquire),
            patch.object(story_runtime, "cancel_story_generation", return_value=True) as cancel_mock,
            patch.object(story_runtime, "STORY_GENERATE_LOCK_WAIT_SECONDS", 0.001),
            patch.object(story_runtime, "STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS", 0.002),
        ):
            with self.assertRaises(HTTPException) as exc_info:
                story_runtime.generate_story_response(
                    deps=deps,
                    game_id=202,
                    payload=SimpleNamespace(),
                    authorization="Bearer token",
                    db=db,
                )

        self.assertEqual(exc_info.exception.status_code, 409)
        self.assertEqual(exc_info.exception.detail, STORY_GAME_OPERATION_BUSY_DETAIL)
        self.assertEqual(acquire_calls, [0.001, 0.002])
        cancel_mock.assert_called_once_with(202)

    def test_cancel_after_finalizing_progress_skips_billing_and_postprocess(self) -> None:
        game_id = 9_101
        generation_id = "generation-finalizing-cancel"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=501)
        calls = {
            "billing": 0,
            "postprocess": 0,
        }

        def fail_billing(*_args, **_kwargs):
            calls["billing"] += 1
            self.fail("Billing must not run after finalizing-stage cancellation")

        def fail_postprocess(*_args, **_kwargs):
            calls["postprocess"] += 1
            self.fail("Post-process must not run after finalizing-stage cancellation")

        deps = SimpleNamespace(
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            story_assistant_role="assistant",
            touch_story_game=lambda _game: None,
            stream_story_provider_chunks=lambda **_kwargs: iter(["Готовый ответ"]),
            spend_user_tokens_if_sufficient=fail_billing,
            resolve_story_turn_postprocess_payload=fail_postprocess,
        )

        mark_story_generation_started(game_id, generation_id)
        try:
            stream = story_runtime._stream_story_response(
                deps=deps,
                db=db,
                game=game,
                user=user,
                turn_cost_tokens=10,
                source_user_message=None,
                prompt="Ход",
                turn_index=1,
                context_messages=[],
                instruction_cards=[],
                plot_cards=[],
                world_cards=[],
                all_world_cards=[],
                context_limit_chars=10_000,
                story_model_name=None,
                story_response_max_tokens=None,
                story_temperature=0.7,
                story_repetition_penalty=1.0,
                story_top_k=40,
                story_top_r=0.9,
                memory_optimization_enabled=True,
                reroll_discarded_assistant_text=None,
                ambient_enabled=False,
                emotion_visualization_enabled=False,
                visual_novel_enabled=False,
                show_gg_thoughts=False,
                show_npc_thoughts=False,
                story_generation_id=generation_id,
            )

            self.assertIn("event: start", next(stream))
            self.assertIn("event: chunk", next(stream))
            finalizing_event = next(stream)
            self.assertIn("event: progress", finalizing_event)
            self.assertIn('"stage": "finalizing"', finalizing_event)

            self.assertTrue(cancel_story_generation(game_id))
            with self.assertRaises(StopIteration):
                next(stream)
        finally:
            mark_story_generation_finished(game_id, generation_id)

        self.assertEqual(calls["billing"], 0)
        self.assertEqual(calls["postprocess"], 0)

    def test_partial_provider_failure_restarts_turn_without_billing_partial_text(self) -> None:
        game_id = 9_102
        generation_id = "generation-provider-retry"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=502)
        provider_calls = 0

        def stream_provider(**_kwargs):
            nonlocal provider_calls
            provider_calls += 1
            if provider_calls == 1:
                yield "partial text"
                raise RuntimeError("OpenRouter story stream ended incomplete")
            yield "complete replacement"

        deps = SimpleNamespace(
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            story_assistant_role="assistant",
            touch_story_game=lambda _game: None,
            stream_story_provider_chunks=stream_provider,
            spend_user_tokens_if_sufficient=lambda *_args, **_kwargs: self.fail(
                "Billing must not run before the retried response reaches finalizing"
            ),
            resolve_story_turn_postprocess_payload=lambda **_kwargs: self.fail(
                "Post-process must not run before cancellation"
            ),
        )

        mark_story_generation_started(game_id, generation_id)
        try:
            with (
                patch.object(story_runtime, "STORY_STREAM_RETRY_DELAYS_SECONDS", (0.0,)),
                patch.object(story_runtime.time, "sleep", return_value=None),
            ):
                stream = story_runtime._stream_story_response(
                    deps=deps,
                    db=db,
                    game=game,
                    user=user,
                    turn_cost_tokens=10,
                    source_user_message=None,
                    prompt="turn",
                    turn_index=1,
                    context_messages=[],
                    instruction_cards=[],
                    plot_cards=[],
                    world_cards=[],
                    all_world_cards=[],
                    context_limit_chars=10_000,
                    story_model_name="aion-labs/aion-2.0",
                    story_response_max_tokens=None,
                    story_temperature=0.7,
                    story_repetition_penalty=1.0,
                    story_top_k=40,
                    story_top_r=0.9,
                    memory_optimization_enabled=True,
                    reroll_discarded_assistant_text=None,
                    ambient_enabled=False,
                    emotion_visualization_enabled=False,
                    visual_novel_enabled=False,
                    show_gg_thoughts=False,
                    show_npc_thoughts=False,
                    story_generation_id=generation_id,
                )

                self.assertIn("event: start", next(stream))
                self.assertIn("partial text", next(stream))
                retry_event = next(stream)
                self.assertIn("event: retry", retry_event)
                self.assertIn('"attempt": 2', retry_event)
                self.assertIn("complete replacement", next(stream))
                self.assertIn('"stage": "finalizing"', next(stream))
                self.assertTrue(cancel_story_generation(game_id))
                with self.assertRaises(StopIteration):
                    next(stream)
        finally:
            mark_story_generation_finished(game_id, generation_id)

        self.assertEqual(provider_calls, 2)
        self.assertEqual(getattr(db.added[0], "content", ""), "complete replacement")


if __name__ == "__main__":
    unittest.main()
