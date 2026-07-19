from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from threading import Event
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_game_operation_lock import (  # noqa: E402
    STORY_GAME_OPERATION_BUSY_DETAIL,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)
from app.services import story_runtime  # noqa: E402
from app.services import story_generation_provider  # noqa: E402
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

    def close(self) -> None:
        return


class _ReleaseTrackingLease:
    def __init__(self) -> None:
        self.release_calls = 0

    def release(self) -> None:
        self.release_calls += 1


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


class _FakeProviderStreamResponse:
    status_code = 200
    encoding = "utf-8"

    def __init__(self) -> None:
        self.closed = False

    def iter_lines(self, *, chunk_size: int, decode_unicode: bool):
        _ = (chunk_size, decode_unicode)
        yield 'data: {"choices":[{"delta":{"content":"start "}}]}'
        yield 'data: {"choices":[{"finish_reason":"length"}]}'
        yield "data: [DONE]"

    def close(self) -> None:
        self.closed = True


class StoryGenerationLockingTests(unittest.TestCase):
    def test_stream_time_budget_fails_when_first_token_never_arrives(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "did not produce content"):
            _ensure_story_stream_within_time_budget(
                provider_label="RouterAI",
                started_at=10.0,
                current_time=131.0,
                emitted_delta=False,
                first_token_timeout_seconds=120.0,
                story_generation_game_id=None,
                story_generation_id=None,
            )

    def test_stream_time_budget_does_not_cut_a_healthy_long_stream(self) -> None:
        _ensure_story_stream_within_time_budget(
            provider_label="RouterAI",
            started_at=10.0,
            current_time=3_611.0,
            emitted_delta=True,
            first_token_timeout_seconds=120.0,
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
            patch.object(story_runtime, "SessionLocal", return_value=db),
            patch.object(story_runtime, "acquire_story_game_operation_lock", side_effect=fake_acquire),
            patch.object(story_runtime, "cancel_story_generation", return_value=True) as cancel_mock,
            patch.object(story_runtime, "STORY_GENERATE_LOCK_WAIT_SECONDS", 0.0),
            patch.object(story_runtime, "STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS", 0.0),
        ):
            response = story_runtime.generate_story_response(
                deps=deps,
                game_id=202,
                payload=SimpleNamespace(),
                authorization="Bearer token",
                db=db,
            )
            self.assertEqual(acquire_calls, [])

            async def consume_until_error() -> list[str]:
                iterator = response.body_iterator
                chunks: list[str] = []
                for _ in range(5):
                    chunk = await iterator.__anext__()
                    chunks.append(chunk)
                    if "event: error" in chunk:
                        break
                await iterator.aclose()
                return chunks

            chunks = asyncio.run(consume_until_error())

        self.assertEqual(chunks[0], story_runtime._sse_stream_warmup())
        self.assertTrue(any("event: error" in chunk for chunk in chunks))
        self.assertTrue(any(STORY_GAME_OPERATION_BUSY_DETAIL in chunk for chunk in chunks))
        self.assertGreaterEqual(len(acquire_calls), 2)
        cancel_mock.assert_called_once_with(202)

    def test_story_generate_releases_operation_lock_when_stream_is_closed_early(self) -> None:
        db = _RollbackTrackingSession()
        lease = _ReleaseTrackingLease()
        deps = SimpleNamespace(
            validate_provider_config=lambda: None,
            get_current_user=lambda _db, _authorization: SimpleNamespace(id=101),
            get_user_story_game_or_404=lambda _db, _user_id, _game_id: SimpleNamespace(id=303),
        )

        def fake_locked_stream(**kwargs):
            self.assertTrue(kwargs.get("as_stream"))

            def stream():
                yield "event: start\ndata: {}\n\n"
                while True:
                    yield ": keepalive\n\n"

            return stream()

        with (
            patch.object(story_runtime, "SessionLocal", return_value=db),
            patch.object(story_runtime, "acquire_story_game_operation_lock", return_value=lease),
            patch.object(
                story_runtime,
                "_generate_story_response_locked",
                side_effect=fake_locked_stream,
            ),
        ):
            response = story_runtime.generate_story_response(
                deps=deps,
                game_id=303,
                payload=SimpleNamespace(),
                authorization="Bearer token",
                db=db,
            )

            async def consume_one_chunk_and_close() -> None:
                iterator = response.body_iterator
                chunks: list[str] = []
                for _ in range(5):
                    chunk = await iterator.__anext__()
                    chunks.append(chunk)
                    if "event: start" in chunk:
                        break
                self.assertEqual(chunks[0], story_runtime._sse_stream_warmup())
                self.assertTrue(any("event: start" in chunk for chunk in chunks))
                await iterator.aclose()

            asyncio.run(consume_one_chunk_and_close())

        for _ in range(50):
            if lease.release_calls >= 1:
                break
            time.sleep(0.01)

        self.assertEqual(lease.release_calls, 1)
        self.assertEqual(db.rollback_calls, 2)

    def test_story_generate_emits_keepalive_while_preparing_locked_stream(self) -> None:
        db = _RollbackTrackingSession()
        lease = _ReleaseTrackingLease()
        prep_started = Event()
        prep_continue = Event()
        deps = SimpleNamespace(
            validate_provider_config=lambda: None,
            get_current_user=lambda _db, _authorization: SimpleNamespace(id=101),
            get_user_story_game_or_404=lambda _db, _user_id, _game_id: SimpleNamespace(id=404),
        )

        def slow_locked_stream(**kwargs):
            self.assertTrue(kwargs.get("as_stream"))
            prep_started.set()
            prep_continue.wait(timeout=2.0)

            def stream():
                yield "event: start\ndata: {}\n\n"

            return stream()

        with (
            patch.object(story_runtime, "SessionLocal", return_value=db),
            patch.object(story_runtime, "acquire_story_game_operation_lock", return_value=lease),
            patch.object(
                story_runtime,
                "_generate_story_response_locked",
                side_effect=slow_locked_stream,
            ),
            patch.object(story_runtime, "STORY_STREAM_RELAY_HEARTBEAT_SECONDS", 0.01),
        ):
            response = story_runtime.generate_story_response(
                deps=deps,
                game_id=404,
                payload=SimpleNamespace(),
                authorization="Bearer token",
                db=db,
            )

            async def consume_keepalive_then_start() -> list[str]:
                iterator = response.body_iterator
                chunks = [await iterator.__anext__()]
                self.assertTrue(prep_started.wait(timeout=1.0))
                chunks.append(await iterator.__anext__())
                prep_continue.set()
                for _ in range(10):
                    chunk = await iterator.__anext__()
                    chunks.append(chunk)
                    if "event: start" in chunk:
                        break
                await iterator.aclose()
                return chunks

            chunks = asyncio.run(consume_keepalive_then_start())

        self.assertEqual(chunks[0], story_runtime._sse_stream_warmup())
        self.assertTrue(any(": keepalive" in chunk for chunk in chunks[:2]))
        self.assertTrue(any("event: start" in chunk for chunk in chunks))
        for _ in range(50):
            if lease.release_calls >= 1:
                break
            time.sleep(0.01)
        self.assertEqual(lease.release_calls, 1)

        if response.background is not None:
            asyncio.run(response.background())

        self.assertEqual(lease.release_calls, 1)
        self.assertEqual(db.rollback_calls, 2)

    def test_story_stream_emits_keepalive_while_provider_waits_for_first_chunk(self) -> None:
        game_id = 9_103
        generation_id = "generation-provider-heartbeat"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=503)
        provider_continue = Event()

        def slow_provider(**_kwargs):
            provider_continue.wait(timeout=2.0)
            yield "late text"

        deps = SimpleNamespace(
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            story_assistant_role="assistant",
            touch_story_game=lambda _game: None,
            stream_story_provider_chunks=slow_provider,
            spend_user_tokens_if_sufficient=lambda *_args, **_kwargs: True,
            resolve_story_turn_postprocess_payload=lambda **_kwargs: {},
        )

        mark_story_generation_started(game_id, generation_id)
        try:
            with patch.object(story_runtime, "STORY_PROVIDER_HEARTBEAT_SECONDS", 0.01):
                stream = story_runtime._stream_story_response(
                    deps=deps,
                    db=db,
                    game=game,
                    user=user,
                    turn_cost_tokens=0,
                    source_user_message=None,
                    prompt="turn",
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
                    visual_novel_enabled=False,
                    show_gg_thoughts=False,
                    show_npc_thoughts=False,
                    story_generation_id=generation_id,
                )

                self.assertIn("event: start", next(stream))
                self.assertIn(": keepalive", next(stream))
                provider_continue.set()

                chunk_event = ""
                for _ in range(20):
                    chunk_event = next(stream)
                    if "event: chunk" in chunk_event:
                        break
                self.assertIn("event: chunk", chunk_event)
                self.assertIn("late text", chunk_event)
                stream.close()
        finally:
            mark_story_generation_finished(game_id, generation_id)

    def test_visual_novel_stream_never_exposes_split_scene_cast_marker(self) -> None:
        game_id = 9_104
        generation_id = "generation-vn-cast-redaction"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=504)
        deps = SimpleNamespace(
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            story_assistant_role="assistant",
            touch_story_game=lambda _game: None,
            stream_story_provider_chunks=lambda **_kwargs: iter(
                ["Мия вошла. {{VN_", "CAST|Мия|Страх}}"]
            ),
            spend_user_tokens_if_sufficient=lambda *_args, **_kwargs: self.fail(
                "Billing must not run after finalizing-stage cancellation"
            ),
            resolve_story_turn_postprocess_payload=lambda **_kwargs: self.fail(
                "Post-process must not run after finalizing-stage cancellation"
            ),
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
                prompt="turn",
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
                visual_novel_enabled=True,
                show_gg_thoughts=False,
                show_npc_thoughts=False,
                story_generation_id=generation_id,
            )

            self.assertIn("event: start", next(stream))
            public_chunk = next(stream)
            self.assertIn("event: chunk", public_chunk)
            self.assertIn("Мия вошла.", public_chunk)
            self.assertNotIn("VN_CAST", public_chunk)
            self.assertNotIn("{{VN_", public_chunk)

            finalizing_event = next(stream)
            self.assertIn('"stage": "finalizing"', finalizing_event)
            self.assertTrue(cancel_story_generation(game_id))
            with self.assertRaises(StopIteration):
                next(stream)
        finally:
            mark_story_generation_finished(game_id, generation_id)

    @patch.object(story_runtime, "_checkpoint_story_raw_turn_memory", return_value=True)
    def test_cancel_after_finalizing_progress_skips_billing_and_postprocess(self, checkpoint) -> None:
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
        checkpoint.assert_called_once()

    def test_subscription_stream_consumes_turn_but_never_spends_sols(self) -> None:
        game_id = 9_105
        generation_id = "generation-subscription-zero-sols"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=505, coins=0)
        billing_calls = 0

        def fail_sol_billing(*_args, **_kwargs):
            nonlocal billing_calls
            billing_calls += 1
            self.fail("Subscription narrator turn must never spend sols")

        deps = SimpleNamespace(
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            story_assistant_role="assistant",
            touch_story_game=lambda _game: None,
            stream_story_provider_chunks=lambda **_kwargs: iter(["Подписочный ответ"]),
            spend_user_tokens_if_sufficient=fail_sol_billing,
            select_story_world_cards_triggered_by_text=lambda *_args, **_kwargs: [],
        )

        mark_story_generation_started(game_id, generation_id)
        try:
            with patch(
                "app.services.subscriptions.try_consume_subscription_turn",
                return_value=True,
            ) as consume_turn_mock:
                stream = story_runtime._stream_story_response(
                    deps=deps,
                    db=db,
                    game=game,
                    user=user,
                    turn_cost_tokens=99,
                    source_user_message=None,
                    prompt="Ход",
                    turn_index=1,
                    context_messages=[],
                    instruction_cards=[],
                    plot_cards=[],
                    world_cards=[],
                    all_world_cards=[],
                    context_limit_chars=10_000,
                    story_model_name="deepseek/deepseek-v4-flash",
                    story_response_max_tokens=450,
                    story_temperature=0.7,
                    story_repetition_penalty=1.0,
                    story_top_k=40,
                    story_top_r=0.9,
                    memory_optimization_enabled=False,
                    reroll_discarded_assistant_text=None,
                    ambient_enabled=False,
                    visual_novel_enabled=False,
                    show_gg_thoughts=False,
                    show_npc_thoughts=False,
                    story_generation_id=generation_id,
                    precharged_graph_cost_tokens=5,
                    is_subscription_turn=True,
                    subscription_daily_turn_limit=20,
                    subscription_period_start="2026-07-01",
                )

                self.assertIn("event: start", next(stream))
                self.assertIn("event: chunk", next(stream))
                self.assertIn('"stage": "finalizing"', next(stream))
                self.assertIn('"stage": "postprocess"', next(stream))
                stream.close()

            consume_turn_mock.assert_called_once()
        finally:
            mark_story_generation_finished(game_id, generation_id)

        self.assertEqual(billing_calls, 0)

    def test_partial_provider_failure_is_not_restarted_as_a_new_turn(self) -> None:
        game_id = 9_102
        generation_id = "generation-provider-retry"
        db = _StreamingSession()
        game = SimpleNamespace(id=game_id)
        user = SimpleNamespace(id=502)
        provider_calls = 0

        def stream_provider(**_kwargs):
            nonlocal provider_calls
            provider_calls += 1
            yield "partial text"
            raise RuntimeError("RouterAI story stream ended incomplete")

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
                    visual_novel_enabled=False,
                    show_gg_thoughts=False,
                    show_npc_thoughts=False,
                    story_generation_id=generation_id,
                )

                self.assertIn("event: start", next(stream))
                self.assertIn("partial text", next(stream))
                error_event = next(stream)
                self.assertIn("event: error", error_event)
                with self.assertRaises(StopIteration):
                    next(stream)
        finally:
            mark_story_generation_finished(game_id, generation_id)

        self.assertEqual(provider_calls, 1)
        self.assertIn(db.added[0], db.deleted)

    def test_polza_length_finish_recovers_tail_before_success(self) -> None:
        fake_response = _FakeProviderStreamResponse()

        with (
            patch.object(story_generation_provider.HTTP_SESSION, "post", return_value=fake_response),
            patch.object(
                story_generation_provider,
                "_build_story_provider_messages",
                return_value=[
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "turn"},
                ],
            ),
            patch.object(
                story_generation_provider,
                "_recover_polza_story_stream_tail",
                return_value="tail.",
            ) as recover_mock,
        ):
            chunks = list(
                story_generation_provider._iter_polza_story_stream_chunks(
                    context_messages=[],
                    instruction_cards=[],
                    plot_cards=[],
                    world_cards=[],
                    context_limit_chars=10_000,
                    model_name="test/model",
                    max_tokens=400,
                )
            )

        self.assertEqual("".join(chunks), "start tail.")
        self.assertTrue(fake_response.closed)
        recover_mock.assert_called_once()
        self.assertIs(recover_mock.call_args.kwargs["consume_remaining_token_budget"], False)


if __name__ == "__main__":
    unittest.main()
