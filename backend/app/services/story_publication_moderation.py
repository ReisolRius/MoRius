from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

STORY_PUBLICATION_STATUS_NONE = "none"
STORY_PUBLICATION_STATUS_PENDING = "pending"
STORY_PUBLICATION_STATUS_APPROVED = "approved"
STORY_PUBLICATION_STATUS_REJECTED = "rejected"
STORY_PUBLICATION_STATUS_VALUES = {
    STORY_PUBLICATION_STATUS_NONE,
    STORY_PUBLICATION_STATUS_PENDING,
    STORY_PUBLICATION_STATUS_APPROVED,
    STORY_PUBLICATION_STATUS_REJECTED,
}
STORY_PUBLICATION_REJECTION_REASON_MAX_LENGTH = 2_000


def publication_utcnow() -> datetime:
    return datetime.now(timezone.utc)


def coerce_story_publication_status(value: str | None, *, is_public: bool = False) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_PUBLICATION_STATUS_VALUES:
        return normalized
    if is_public:
        return STORY_PUBLICATION_STATUS_APPROVED
    return STORY_PUBLICATION_STATUS_NONE


def normalize_story_publication_status(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in STORY_PUBLICATION_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Publication status is invalid",
        )
    return normalized


def normalize_story_publication_rejection_reason(
    value: str | None,
    *,
    required: bool = False,
) -> str | None:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rejection reason should not be empty",
            )
        return None
    return normalized[:STORY_PUBLICATION_REJECTION_REASON_MAX_LENGTH].rstrip()


def _set_story_publication_state_value(record: Any, *, field_name: str, value: Any) -> None:
    if hasattr(record, field_name):
        setattr(record, field_name, value)


def clear_story_publication_state(record: Any) -> None:
    _set_story_publication_state_value(record, field_name="publication_status", value=STORY_PUBLICATION_STATUS_NONE)
    _set_story_publication_state_value(record, field_name="publication_requested_at", value=None)
    _set_story_publication_state_value(record, field_name="publication_reviewed_at", value=None)
    _set_story_publication_state_value(record, field_name="publication_reviewer_user_id", value=None)
    _set_story_publication_state_value(record, field_name="publication_rejection_reason", value=None)


def mark_story_publication_pending(
    record: Any,
    *,
    now: datetime | None = None,
    preserve_requested_at: bool = False,
) -> None:
    current_time = now or publication_utcnow()
    _set_story_publication_state_value(record, field_name="publication_status", value=STORY_PUBLICATION_STATUS_PENDING)
    if not preserve_requested_at or getattr(record, "publication_requested_at", None) is None:
        _set_story_publication_state_value(record, field_name="publication_requested_at", value=current_time)
    _set_story_publication_state_value(record, field_name="publication_reviewed_at", value=None)
    _set_story_publication_state_value(record, field_name="publication_reviewer_user_id", value=None)
    _set_story_publication_state_value(record, field_name="publication_rejection_reason", value=None)


def mark_story_publication_approved(
    record: Any,
    *,
    reviewer_user_id: int | None,
    now: datetime | None = None,
) -> None:
    current_time = now or publication_utcnow()
    _set_story_publication_state_value(record, field_name="publication_status", value=STORY_PUBLICATION_STATUS_APPROVED)
    if getattr(record, "publication_requested_at", None) is None:
        _set_story_publication_state_value(record, field_name="publication_requested_at", value=current_time)
    _set_story_publication_state_value(record, field_name="publication_reviewed_at", value=current_time)
    _set_story_publication_state_value(record, field_name="publication_reviewer_user_id", value=reviewer_user_id)
    _set_story_publication_state_value(record, field_name="publication_rejection_reason", value=None)


def mark_story_publication_rejected(
    record: Any,
    *,
    reviewer_user_id: int | None,
    rejection_reason: str,
    now: datetime | None = None,
) -> None:
    current_time = now or publication_utcnow()
    normalized_reason = normalize_story_publication_rejection_reason(rejection_reason, required=True)
    _set_story_publication_state_value(record, field_name="publication_status", value=STORY_PUBLICATION_STATUS_REJECTED)
    if getattr(record, "publication_requested_at", None) is None:
        _set_story_publication_state_value(record, field_name="publication_requested_at", value=current_time)
    _set_story_publication_state_value(record, field_name="publication_reviewed_at", value=current_time)
    _set_story_publication_state_value(record, field_name="publication_reviewer_user_id", value=reviewer_user_id)
    _set_story_publication_state_value(record, field_name="publication_rejection_reason", value=normalized_reason)
