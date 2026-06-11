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
from app.services.story_generation_provider import (  # noqa: E402
    _ensure_story_stream_within_time_budget,
)


class _RollbackTrackingSession:
    def __init__(self) -> None:
        self.rollback_calls = 0

    def rollback(self) -> None:
        self.rollback_calls += 1


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


if __name__ == "__main__":
    unittest.main()
