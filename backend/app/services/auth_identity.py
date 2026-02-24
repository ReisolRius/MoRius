from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.schemas import AuthResponse, UserOut
from app.security import create_access_token, safe_decode_access_token

DISPLAY_NAME_MAX_LENGTH = 25
DISPLAY_NAME_FALLBACK = "Player"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _compact_display_name(value: str | None) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


def _truncate_display_name(value: str) -> str:
    return value[:DISPLAY_NAME_MAX_LENGTH]


def provider_union(current_provider: str, next_provider: str) -> str:
    providers = {value.strip() for value in current_provider.split("+") if value.strip()}
    providers.add(next_provider)
    return "+".join(sorted(providers))


def build_user_name(email: str) -> str:
    local_part = normalize_email(email).split("@", maxsplit=1)[0]
    compact_value = _compact_display_name(local_part)
    if not compact_value:
        compact_value = DISPLAY_NAME_FALLBACK
    return _truncate_display_name(compact_value)


def coerce_display_name(value: str | None, *, fallback_email: str) -> str:
    compact_value = _compact_display_name(value)
    if not compact_value:
        compact_value = build_user_name(fallback_email)
    return _truncate_display_name(compact_value)


def normalize_profile_display_name(value: str) -> str:
    compact_value = _compact_display_name(value)
    if not compact_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Display name should not be empty",
        )
    return _truncate_display_name(compact_value)


def parse_google_client_ids(raw_value: str) -> set[str]:
    return {item.strip() for item in raw_value.split(",") if item.strip()}


def is_allowed_google_audience(claim_aud: Any, claim_azp: Any, allowed_client_ids: set[str]) -> bool:
    if isinstance(claim_aud, str) and claim_aud in allowed_client_ids:
        return True

    if isinstance(claim_aud, list):
        if any(isinstance(value, str) and value in allowed_client_ids for value in claim_aud):
            return True

    if isinstance(claim_azp, str) and claim_azp in allowed_client_ids:
        return True

    return False


def issue_auth_response(user: User) -> AuthResponse:
    token = create_access_token(subject=str(user.id), claims={"email": user.email})
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    token_prefix = "bearer "
    if not authorization.lower().startswith(token_prefix):
        return None
    return authorization[len(token_prefix) :].strip()


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_token_issued_at(raw_value: Any) -> datetime:
    if isinstance(raw_value, datetime):
        return _to_utc(raw_value)

    if isinstance(raw_value, (int, float)):
        return datetime.fromtimestamp(float(raw_value), tz=timezone.utc)

    if isinstance(raw_value, str):
        cleaned = raw_value.strip()
        if not cleaned:
            raise ValueError("Token iat claim is empty")
        try:
            return datetime.fromtimestamp(float(cleaned), tz=timezone.utc)
        except ValueError as exc:
            raise ValueError("Token iat claim is invalid") from exc

    raise ValueError("Token iat claim is missing")


def get_current_user(
    db: Session,
    authorization: str | None,
) -> User:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization token")

    payload = safe_decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    subject = payload.get("sub")
    if subject is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    try:
        user_id = int(str(subject))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload") from exc

    token_email = normalize_email(str(payload.get("email", "")))
    if not token_email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    try:
        token_issued_at = _parse_token_issued_at(payload.get("iat"))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload") from exc

    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if normalize_email(user.email) != token_email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match user identity")

    user_created_at = _to_utc(user.created_at)
    if token_issued_at < user_created_at - timedelta(minutes=2):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is no longer valid")

    return user
