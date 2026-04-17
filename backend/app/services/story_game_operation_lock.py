from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

logger = logging.getLogger(__name__)

_LOCK_WAIT_LOG_THRESHOLD_SECONDS = 0.25
_LOCK_HOLD_LOG_THRESHOLD_SECONDS = 2.0


@dataclass
class _StoryGameLockEntry:
    lock: Lock
    ref_count: int = 0


@dataclass
class StoryGameOperationLease:
    game_id: int
    operation: str
    _entry: _StoryGameLockEntry | None
    _acquired_at: float | None

    def release(self) -> None:
        entry = self._entry
        acquired_at = self._acquired_at
        if entry is None:
            return

        held_for_seconds = 0.0
        if acquired_at is not None:
            held_for_seconds = max(time.monotonic() - acquired_at, 0.0)

        try:
            entry.lock.release()
        finally:
            with _LOCK_REGISTRY_GUARD:
                current_entry = _LOCK_REGISTRY.get(self.game_id)
                if current_entry is entry:
                    current_entry.ref_count = max(current_entry.ref_count - 1, 0)
                    if current_entry.ref_count == 0:
                        _LOCK_REGISTRY.pop(self.game_id, None)

            if held_for_seconds >= _LOCK_HOLD_LOG_THRESHOLD_SECONDS:
                logger.info(
                    "Story game operation lock released: game_id=%s operation=%s held_for=%.3fs",
                    self.game_id,
                    self.operation,
                    held_for_seconds,
                )

            self._entry = None
            self._acquired_at = None

    def __enter__(self) -> StoryGameOperationLease:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.release()
        return False


_LOCK_REGISTRY_GUARD = Lock()
_LOCK_REGISTRY: dict[int, _StoryGameLockEntry] = {}


def acquire_story_game_operation_lock(
    game_id: int,
    *,
    operation: str,
) -> StoryGameOperationLease:
    normalized_game_id = int(game_id or 0)
    normalized_operation = str(operation or "").strip() or "unknown"
    if normalized_game_id <= 0:
        return StoryGameOperationLease(
            game_id=normalized_game_id,
            operation=normalized_operation,
            _entry=None,
            _acquired_at=None,
        )

    with _LOCK_REGISTRY_GUARD:
        entry = _LOCK_REGISTRY.get(normalized_game_id)
        if entry is None:
            entry = _StoryGameLockEntry(lock=Lock())
            _LOCK_REGISTRY[normalized_game_id] = entry
        entry.ref_count += 1

    wait_started_at = time.monotonic()
    entry.lock.acquire()
    waited_for_seconds = max(time.monotonic() - wait_started_at, 0.0)
    if waited_for_seconds >= _LOCK_WAIT_LOG_THRESHOLD_SECONDS:
        logger.info(
            "Story game operation lock acquired after wait: game_id=%s operation=%s waited_for=%.3fs",
            normalized_game_id,
            normalized_operation,
            waited_for_seconds,
        )

    return StoryGameOperationLease(
        game_id=normalized_game_id,
        operation=normalized_operation,
        _entry=entry,
        _acquired_at=time.monotonic(),
    )
