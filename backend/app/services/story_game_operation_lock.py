from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

from sqlalchemy import text

from app.config import is_postgresql_database_url, settings
from app.database import engine

logger = logging.getLogger(__name__)

_LOCK_WAIT_LOG_THRESHOLD_SECONDS = 0.25
_LOCK_HOLD_LOG_THRESHOLD_SECONDS = 2.0
_POSTGRES_LOCK_NAMESPACE = 41027
_POSTGRES_LOCK_POLL_INTERVAL_SECONDS = 0.05
STORY_GAME_OPERATION_BUSY_DETAIL = "Игровая сессия сейчас занята другой операцией. Попробуйте ещё раз через пару секунд."


class StoryGameOperationBusyError(RuntimeError):
    pass


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
    _database_lock_connection: object | None = None

    def release(self) -> None:
        entry = self._entry
        acquired_at = self._acquired_at
        database_lock_connection = self._database_lock_connection
        if entry is None:
            return

        held_for_seconds = 0.0
        if acquired_at is not None:
            held_for_seconds = max(time.monotonic() - acquired_at, 0.0)

        try:
            if database_lock_connection is not None:
                try:
                    database_lock_connection.execute(
                        text("SELECT pg_advisory_unlock(:namespace, :game_id)"),
                        {
                            "namespace": _POSTGRES_LOCK_NAMESPACE,
                            "game_id": self.game_id,
                        },
                    )
                    database_lock_connection.commit()
                except Exception:
                    logger.exception(
                        "Failed to release PostgreSQL advisory lock: game_id=%s operation=%s",
                        self.game_id,
                        self.operation,
                    )
                finally:
                    try:
                        database_lock_connection.close()
                    except Exception:
                        logger.exception(
                            "Failed to close PostgreSQL advisory lock connection: game_id=%s operation=%s",
                            self.game_id,
                            self.operation,
                        )

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
            self._database_lock_connection = None

    def __enter__(self) -> StoryGameOperationLease:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.release()
        return False


_LOCK_REGISTRY_GUARD = Lock()
_LOCK_REGISTRY: dict[int, _StoryGameLockEntry] = {}


def _should_use_postgresql_advisory_locks() -> bool:
    return is_postgresql_database_url(getattr(settings, "database_url", ""))


def _acquire_postgresql_story_game_lock(
    *,
    game_id: int,
    operation: str,
    wait_timeout_seconds: float | None,
) -> object | None:
    if not _should_use_postgresql_advisory_locks():
        return None

    wait_started_at = time.monotonic()
    connection = engine.connect()
    try:
        parameters = {
            "namespace": _POSTGRES_LOCK_NAMESPACE,
            "game_id": game_id,
        }
        if wait_timeout_seconds is None:
            connection.execute(
                text("SELECT pg_advisory_lock(:namespace, :game_id)"),
                parameters,
            )
            connection.commit()
        else:
            normalized_timeout_seconds = max(float(wait_timeout_seconds), 0.0)
            deadline = wait_started_at + normalized_timeout_seconds
            while True:
                result = connection.execute(
                    text("SELECT pg_try_advisory_lock(:namespace, :game_id)"),
                    parameters,
                )
                acquired = bool(result.scalar())
                connection.commit()
                if acquired:
                    break

                remaining_seconds = deadline - time.monotonic()
                if remaining_seconds <= 0:
                    raise StoryGameOperationBusyError(
                        f"PostgreSQL advisory lock wait timed out: game_id={game_id} operation={operation}"
                    )
                time.sleep(min(_POSTGRES_LOCK_POLL_INTERVAL_SECONDS, remaining_seconds))
    except Exception:
        try:
            connection.close()
        except Exception:
            logger.exception(
                "Failed to close PostgreSQL advisory lock connection after acquire failure: game_id=%s operation=%s",
                game_id,
                operation,
            )
        raise

    waited_for_seconds = max(time.monotonic() - wait_started_at, 0.0)
    if waited_for_seconds >= _LOCK_WAIT_LOG_THRESHOLD_SECONDS:
        logger.info(
            "PostgreSQL advisory lock acquired after wait: game_id=%s operation=%s waited_for=%.3fs",
            game_id,
            operation,
            waited_for_seconds,
        )
    return connection


def acquire_story_game_operation_lock(
    game_id: int,
    *,
    operation: str,
    wait_timeout_seconds: float | None = None,
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
    if wait_timeout_seconds is None:
        acquired = entry.lock.acquire()
    else:
        acquired = entry.lock.acquire(timeout=max(float(wait_timeout_seconds), 0.0))
    if not acquired:
        with _LOCK_REGISTRY_GUARD:
            current_entry = _LOCK_REGISTRY.get(normalized_game_id)
            if current_entry is entry:
                current_entry.ref_count = max(current_entry.ref_count - 1, 0)
                if current_entry.ref_count == 0:
                    _LOCK_REGISTRY.pop(normalized_game_id, None)
        raise StoryGameOperationBusyError(
            f"Story game operation lock wait timed out: game_id={normalized_game_id} operation={normalized_operation}"
        )
    waited_for_seconds = max(time.monotonic() - wait_started_at, 0.0)
    if waited_for_seconds >= _LOCK_WAIT_LOG_THRESHOLD_SECONDS:
        logger.info(
            "Story game operation lock acquired after wait: game_id=%s operation=%s waited_for=%.3fs",
            normalized_game_id,
            normalized_operation,
            waited_for_seconds,
        )

    database_lock_connection = None
    try:
        database_lock_connection = _acquire_postgresql_story_game_lock(
            game_id=normalized_game_id,
            operation=normalized_operation,
            wait_timeout_seconds=wait_timeout_seconds,
        )
    except Exception:
        try:
            entry.lock.release()
        finally:
            with _LOCK_REGISTRY_GUARD:
                current_entry = _LOCK_REGISTRY.get(normalized_game_id)
                if current_entry is entry:
                    current_entry.ref_count = max(current_entry.ref_count - 1, 0)
                    if current_entry.ref_count == 0:
                        _LOCK_REGISTRY.pop(normalized_game_id, None)
        raise

    return StoryGameOperationLease(
        game_id=normalized_game_id,
        operation=normalized_operation,
        _entry=entry,
        _acquired_at=time.monotonic(),
        _database_lock_connection=database_lock_connection,
    )
