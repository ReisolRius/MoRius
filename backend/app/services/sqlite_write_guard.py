from __future__ import annotations

import time

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

SQLITE_LOCKED_ERROR_MARKERS = (
    "database is locked",
    "database schema is locked",
)
SQLITE_PENDING_ROLLBACK_MARKER = "session's transaction has been rolled back due to a previous exception during flush"
POSTGRES_BUSY_ERROR_SQLSTATES = {
    "40P01",  # deadlock_detected
    "40001",  # serialization_failure
    "55P03",  # lock_not_available
}
POSTGRES_BUSY_ERROR_MARKERS = (
    "deadlock detected",
    "could not serialize access due to concurrent update",
    "could not serialize access due to read/write dependencies among transactions",
    "could not obtain lock on row",
    "canceling statement due to lock timeout",
)


def _normalize_exception_detail(exc: BaseException | None) -> str:
    return str(exc or "").replace("\r\n", "\n").strip().lower()


def _postgres_sqlstate(exc: BaseException | None) -> str | None:
    if exc is None:
        return None
    orig = getattr(exc, "orig", exc)
    for attr_name in ("sqlstate", "pgcode"):
        value = getattr(orig, attr_name, None)
        if value:
            return str(value).strip().upper()
    return None


def is_sqlite_locked_error(exc: BaseException | None) -> bool:
    detail = _normalize_exception_detail(exc)
    if not detail:
        return False
    return any(marker in detail for marker in SQLITE_LOCKED_ERROR_MARKERS)


def is_postgresql_busy_error(exc: BaseException | None) -> bool:
    detail = _normalize_exception_detail(exc)
    if not detail:
        return False
    sqlstate = _postgres_sqlstate(exc)
    if sqlstate in POSTGRES_BUSY_ERROR_SQLSTATES:
        return True
    return any(marker in detail for marker in POSTGRES_BUSY_ERROR_MARKERS)


def is_database_busy_error(exc: BaseException | None) -> bool:
    if exc is None:
        return False
    if is_sqlite_locked_error(exc):
        return True
    if isinstance(exc, OperationalError) and is_postgresql_busy_error(exc):
        return True
    return is_postgresql_busy_error(exc)


def is_database_busy_session_error(exc: BaseException | None) -> bool:
    detail = _normalize_exception_detail(exc)
    if not detail:
        return False
    if is_database_busy_error(exc):
        return True
    return SQLITE_PENDING_ROLLBACK_MARKER in detail and (
        any(marker in detail for marker in SQLITE_LOCKED_ERROR_MARKERS)
        or any(marker in detail for marker in POSTGRES_BUSY_ERROR_MARKERS)
    )


def commit_with_retry(
    db: Session,
    *,
    max_attempts: int = 3,
    initial_retry_delay_seconds: float = 0.2,
    retry_backoff_multiplier: float = 2.0,
) -> int:
    attempts = max(int(max_attempts or 0), 1)
    retry_delay_seconds = max(float(initial_retry_delay_seconds or 0.0), 0.0)
    backoff_multiplier = max(float(retry_backoff_multiplier or 0.0), 1.0)

    for attempt in range(1, attempts + 1):
        try:
            db.commit()
            return attempt
        except Exception as exc:
            try:
                db.rollback()
            except Exception:
                pass
            if not is_sqlite_locked_error(exc) or attempt >= attempts:
                raise
            if retry_delay_seconds > 0:
                time.sleep(retry_delay_seconds)
                retry_delay_seconds *= backoff_multiplier

    raise RuntimeError("Database commit retry loop exited unexpectedly")


def is_sqlite_busy_session_error(exc: BaseException | None) -> bool:
    return is_database_busy_session_error(exc)


def commit_with_sqlite_retry(
    db: Session,
    *,
    max_attempts: int = 3,
    initial_retry_delay_seconds: float = 0.2,
    retry_backoff_multiplier: float = 2.0,
) -> int:
    return commit_with_retry(
        db,
        max_attempts=max_attempts,
        initial_retry_delay_seconds=initial_retry_delay_seconds,
        retry_backoff_multiplier=retry_backoff_multiplier,
    )
