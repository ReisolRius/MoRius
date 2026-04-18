from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
try:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token
except Exception:  # pragma: no cover - optional fallback for partial runtime environments
    google_requests = None
    google_id_token = None
import requests
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import EmailVerification, User
from app.schemas import (
    AuthResponse,
    AvatarUpdateRequest,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    OnboardingGuideStateOut,
    OnboardingGuideStateUpdateRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    RegisterVerifyRequest,
    UserNotificationListResponseOut,
    UserNotificationOut,
    UserNotificationUnreadCountOut,
    UserOut,
)
try:
    from app.schemas import (
        DailyRewardDayOut,
        DailyRewardStatusOut,
        ThemeSettingsOut,
        ThemeSettingsUpdateRequest,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    class DailyRewardDayOut(BaseModel):
        day: int
        amount: int
        is_claimed: bool
        is_current: bool
        is_locked: bool

    class DailyRewardStatusOut(BaseModel):
        server_time: datetime
        current_day: int | None
        claimed_days: int
        can_claim: bool
        is_completed: bool
        next_claim_at: datetime | None
        last_claimed_at: datetime | None
        cycle_started_at: datetime | None
        reward_amount: int | None = None
        claimed_reward_amount: int | None = None
        claimed_reward_day: int | None = None
        days: list[DailyRewardDayOut] = Field(default_factory=list)

    class ThemeSettingsUpdateRequest(BaseModel):
        active_theme_kind: str | None = None
        active_theme_id: str | None = None
        story: dict[str, Any] | None = None
        custom_themes: list[dict[str, Any]] | None = None

    class ThemeSettingsOut(BaseModel):
        active_theme_kind: str
        active_theme_id: str
        story: dict[str, Any] = Field(default_factory=dict)
        custom_themes: list[dict[str, Any]] = Field(default_factory=list)
from app.security import hash_password, verify_password
from app.services.auth_identity import (
    build_user_name,
    coerce_display_name,
    ensure_user_not_banned,
    get_current_user,
    is_allowed_google_audience,
    issue_auth_response,
    normalize_profile_description,
    normalize_profile_display_name,
    normalize_email,
    parse_google_client_ids,
    provider_union,
    sync_user_access_state,
)
from app.services.media import normalize_avatar_value, normalize_media_scale, validate_avatar_url
from app.services.payments import sync_user_pending_purchases
try:
    from app.services.daily_rewards import DAILY_REWARD_AMOUNTS, build_daily_reward_status, claim_daily_reward
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    DAILY_REWARD_AMOUNTS = (5, 6, 5, 6, 7, 6, 20)

    class _FallbackDailyRewardStatus:
        def __init__(self) -> None:
            self.server_time = _utcnow()
            self.current_day = 1
            self.claimed_days = 0
            self.can_claim = False
            self.is_completed = False
            self.next_claim_at = None
            self.last_claimed_at = None
            self.cycle_started_at = None

    def build_daily_reward_status(user: User):
        return _FallbackDailyRewardStatus()

    def claim_daily_reward(db: Session, *, user: User):
        return None

try:
    from app.services.theme_settings import ThemeSettingsValidationError, read_theme_settings, write_theme_settings
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    class ThemeSettingsValidationError(ValueError):
        pass

    def read_theme_settings(user: User) -> dict[str, Any]:
        active_theme_id = str(getattr(user, "active_theme_id", None) or "classic-dark")
        return {
            "active_theme_kind": "preset",
            "active_theme_id": active_theme_id,
            "story": {},
            "custom_themes": [],
        }

    def write_theme_settings(user: User, payload: Any) -> dict[str, Any]:
        normalized = read_theme_settings(user)
        if isinstance(payload, dict):
            active_theme_kind = str(payload.get("active_theme_kind") or "").strip() or normalized["active_theme_kind"]
            active_theme_id = str(payload.get("active_theme_id") or "").strip() or normalized["active_theme_id"]
            normalized.update(
                active_theme_kind=active_theme_kind,
                active_theme_id=active_theme_id,
                story=dict(payload.get("story") or normalized["story"]),
                custom_themes=list(payload.get("custom_themes") or normalized["custom_themes"]),
            )
        if hasattr(user, "active_theme_id"):
            setattr(user, "active_theme_id", normalized["active_theme_id"])
        return normalized

try:
    from app.services.notifications import (
        count_total_user_notifications,
        count_unread_user_notifications,
        delete_user_notification,
        list_user_notifications_out,
        mark_all_user_notifications_read,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def count_total_user_notifications(db: Session, *, user_id: int) -> int:
        _ = (db, user_id)
        return 0

    def count_unread_user_notifications(db: Session, *, user_id: int) -> int:
        _ = (db, user_id)
        return 0

    def list_user_notifications_out(
        db: Session,
        *,
        user_id: int,
        limit: int = 120,
        offset: int = 0,
        sort_desc: bool = True,
    ) -> list[UserNotificationOut]:
        _ = (db, user_id, limit, offset, sort_desc)
        return []

    def mark_all_user_notifications_read(db: Session, *, user_id: int) -> int:
        _ = (db, user_id)
        return 0

    def delete_user_notification(
        db: Session,
        *,
        user_id: int,
        notification_id: int,
    ) -> bool:
        _ = (db, user_id, notification_id)
        return False

from app.services.auth_verification import (
    clear_verification_code_cooldown,
    generate_verification_code,
    get_resend_cooldown_remaining_seconds,
    mark_verification_code_sent,
    send_email_verification_code,
)

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

router = APIRouter()
logger = logging.getLogger(__name__)
AVATAR_SCALE_MIN = 1.0
AVATAR_SCALE_MAX = 3.0
AVATAR_SCALE_DEFAULT = 1.0
NEW_USER_STARTER_COINS = 50
ONBOARDING_GUIDE_DEFAULT_STATUS = "pending"
ONBOARDING_GUIDE_ALLOWED_STATUSES = {"pending", "completed", "skipped"}
ONBOARDING_GUIDE_STEP_ID_MAX_LENGTH = 120


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _sync_user_display_name(user: User, *, fallback_email: str) -> bool:
    normalized_display_name = coerce_display_name(
        user.display_name,
        fallback_email=fallback_email,
    )
    if user.display_name == normalized_display_name:
        return False
    user.display_name = normalized_display_name
    return True


def _normalize_onboarding_guide_status(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ONBOARDING_GUIDE_ALLOWED_STATUSES:
            return normalized
    return ONBOARDING_GUIDE_DEFAULT_STATUS


def _normalize_onboarding_guide_step_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return None
    return normalized[:ONBOARDING_GUIDE_STEP_ID_MAX_LENGTH]


def _normalize_onboarding_guide_tutorial_game_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def _read_onboarding_guide_state(user: User) -> dict[str, Any]:
    raw_state = (user.onboarding_guide_state or "").strip()
    parsed_state: dict[str, Any] = {}
    if raw_state:
        try:
            candidate = json.loads(raw_state)
            if isinstance(candidate, dict):
                parsed_state = candidate
        except Exception:
            parsed_state = {}

    normalized_status = _normalize_onboarding_guide_status(parsed_state.get("status"))
    normalized_step_id = _normalize_onboarding_guide_step_id(parsed_state.get("current_step_id"))
    normalized_tutorial_game_id = _normalize_onboarding_guide_tutorial_game_id(parsed_state.get("tutorial_game_id"))
    if normalized_status in {"completed", "skipped"}:
        normalized_step_id = None

    return {
        "status": normalized_status,
        "current_step_id": normalized_step_id,
        "tutorial_game_id": normalized_tutorial_game_id,
    }


def _store_onboarding_guide_state(user: User, state: dict[str, Any]) -> dict[str, Any]:
    normalized_state = {
        "status": _normalize_onboarding_guide_status(state.get("status")),
        "current_step_id": _normalize_onboarding_guide_step_id(state.get("current_step_id")),
        "tutorial_game_id": _normalize_onboarding_guide_tutorial_game_id(state.get("tutorial_game_id")),
    }
    if normalized_state["status"] in {"completed", "skipped"}:
        normalized_state["current_step_id"] = None
    user.onboarding_guide_state = json.dumps(normalized_state, ensure_ascii=False, separators=(",", ":"))
    return normalized_state


def _serialize_onboarding_guide_state(user: User) -> OnboardingGuideStateOut:
    state = _read_onboarding_guide_state(user)
    return OnboardingGuideStateOut(
        status=state["status"],
        current_step_id=state["current_step_id"],
        tutorial_game_id=state["tutorial_game_id"],
    )


def _serialize_theme_settings(user: User) -> ThemeSettingsOut:
    settings_payload = read_theme_settings(user)
    return ThemeSettingsOut(
        active_theme_kind=str(settings_payload.get("active_theme_kind") or "preset"),
        active_theme_id=str(settings_payload.get("active_theme_id") or "classic-dark"),
        story=dict(settings_payload.get("story") or {}),
        custom_themes=list(settings_payload.get("custom_themes") or []),
    )


def _serialize_daily_reward_status(
    user: User,
    *,
    claimed_reward_amount: int | None = None,
    claimed_reward_day: int | None = None,
) -> DailyRewardStatusOut:
    status_payload = build_daily_reward_status(user)
    days: list[DailyRewardDayOut] = []
    current_day = status_payload.current_day
    for index, amount in enumerate(DAILY_REWARD_AMOUNTS, start=1):
        is_claimed = index <= int(status_payload.claimed_days)
        days.append(
            DailyRewardDayOut(
                day=index,
                amount=int(amount),
                is_claimed=is_claimed,
                is_current=bool(current_day == index),
                is_locked=not is_claimed and current_day is not None and index > current_day,
            )
        )

    reward_amount = None
    if current_day is not None and 1 <= current_day <= len(DAILY_REWARD_AMOUNTS):
        reward_amount = int(DAILY_REWARD_AMOUNTS[current_day - 1])

    return DailyRewardStatusOut(
        server_time=status_payload.server_time,
        current_day=status_payload.current_day,
        claimed_days=int(status_payload.claimed_days),
        can_claim=bool(status_payload.can_claim),
        is_completed=bool(status_payload.is_completed),
        next_claim_at=status_payload.next_claim_at,
        last_claimed_at=status_payload.last_claimed_at,
        cycle_started_at=status_payload.cycle_started_at,
        reward_amount=reward_amount,
        claimed_reward_amount=claimed_reward_amount,
        claimed_reward_day=claimed_reward_day,
        days=days,
    )


def _build_daily_reward_status_fallback(
    *,
    claimed_reward_amount: int | None = None,
    claimed_reward_day: int | None = None,
) -> DailyRewardStatusOut:
    days = [
        DailyRewardDayOut(
            day=index,
            amount=int(amount),
            is_claimed=False,
            is_current=index == 1,
            is_locked=index > 1,
        )
        for index, amount in enumerate(DAILY_REWARD_AMOUNTS, start=1)
    ]
    reward_amount = int(DAILY_REWARD_AMOUNTS[0]) if DAILY_REWARD_AMOUNTS else None
    return DailyRewardStatusOut(
        server_time=_utcnow(),
        current_day=1 if days else None,
        claimed_days=0,
        can_claim=False,
        is_completed=False,
        next_claim_at=None,
        last_claimed_at=None,
        cycle_started_at=None,
        reward_amount=reward_amount,
        claimed_reward_amount=claimed_reward_amount,
        claimed_reward_day=claimed_reward_day,
        days=days,
    )


def _build_notification_counters_fallback() -> UserNotificationUnreadCountOut:
    return UserNotificationUnreadCountOut(
        unread_count=0,
        total_count=0,
    )


def _build_notification_list_fallback(*, limit: int, offset: int) -> UserNotificationListResponseOut:
    return UserNotificationListResponseOut(
        items=[],
        unread_count=0,
        total_count=0,
        limit=max(1, int(limit or 1)),
        offset=max(0, int(offset or 0)),
        has_more=False,
    )


def _verify_google_token_with_tokeninfo(id_token_value: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": id_token_value},
            timeout=(4, 10),
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach Google tokeninfo endpoint") from exc

    payload: Any = {}
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 500:
        raise RuntimeError(f"Google tokeninfo is unavailable ({response.status_code})")

    if response.status_code >= 400:
        return None

    if not isinstance(payload, dict):
        raise RuntimeError("Google tokeninfo returned invalid payload")

    normalized_payload: dict[str, Any] = dict(payload)
    email_verified = normalized_payload.get("email_verified")
    if isinstance(email_verified, str):
        normalized_payload["email_verified"] = email_verified.strip().lower() == "true"
    return normalized_payload


def _decode_google_token_claims_unverified(id_token_value: str) -> dict[str, Any] | None:
    token_parts = str(id_token_value or "").split(".")
    if len(token_parts) < 2:
        return None

    payload_part = token_parts[1].strip()
    if not payload_part:
        return None

    padding = "=" * (-len(payload_part) % 4)
    try:
        payload_bytes = base64.urlsafe_b64decode(payload_part + padding)
    except Exception:
        return None

    try:
        parsed_payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(parsed_payload, dict):
        return None

    normalized_payload: dict[str, Any] = dict(parsed_payload)
    email_verified = normalized_payload.get("email_verified")
    if isinstance(email_verified, str):
        normalized_payload["email_verified"] = email_verified.strip().lower() == "true"
    return normalized_payload


def _is_google_token_claims_expired(token_data: dict[str, Any]) -> bool:
    raw_exp = token_data.get("exp")
    exp_timestamp: int | None = None
    if isinstance(raw_exp, int):
        exp_timestamp = raw_exp
    elif isinstance(raw_exp, str) and raw_exp.strip().isdigit():
        exp_timestamp = int(raw_exp.strip())
    if exp_timestamp is None:
        return True
    now_timestamp = int(_utcnow().timestamp())
    return exp_timestamp <= now_timestamp


@router.post("/api/auth/register", response_model=MessageResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> MessageResponse:
    normalized_email = normalize_email(payload.email)
    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    now = _utcnow()
    max_attempts = max(settings.email_verification_max_attempts, 1)
    cooldown_remaining_seconds = get_resend_cooldown_remaining_seconds(normalized_email, now)

    if cooldown_remaining_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {cooldown_remaining_seconds} seconds before requesting a new code",
        )

    verification_code = generate_verification_code()
    expires_at = now + timedelta(minutes=max(settings.email_verification_code_ttl_minutes, 1))

    if existing_user and existing_user.password_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User with this email already exists")

    verification = db.scalar(select(EmailVerification).where(EmailVerification.email == normalized_email))
    password_hash = hash_password(payload.password)
    code_hash = hash_password(verification_code)

    if verification is None:
        verification = EmailVerification(
            email=normalized_email,
            code_hash=code_hash,
            password_hash=password_hash,
            expires_at=expires_at,
            attempts_left=max_attempts,
        )
        db.add(verification)
    else:
        verification.code_hash = code_hash
        verification.password_hash = password_hash
        verification.expires_at = expires_at
        verification.attempts_left = max_attempts

    try:
        send_email_verification_code(normalized_email, verification_code)
    except Exception as exc:
        db.rollback()
        detail = "Failed to send verification email"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from exc

    db.commit()
    mark_verification_code_sent(normalized_email, now=_utcnow())
    return MessageResponse(message="Verification code was sent to email")


@router.post("/api/auth/register/verify", response_model=AuthResponse)
def verify_registration(payload: RegisterVerifyRequest, db: Session = Depends(get_db)) -> AuthResponse:
    normalized_email = normalize_email(payload.email)
    verification = db.scalar(select(EmailVerification).where(EmailVerification.email == normalized_email))
    if verification is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code was not requested for this email",
        )

    expires_at = _to_utc(verification.expires_at)
    if expires_at <= _utcnow():
        db.delete(verification)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code expired. Request a new code",
        )

    if not verify_password(payload.code, verification.code_hash):
        verification.attempts_left -= 1
        if verification.attempts_left <= 0:
            db.delete(verification)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verification code is invalid. Request a new code",
            )

        attempts_left = verification.attempts_left
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Verification code is invalid. Attempts left: {attempts_left}",
        )

    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    if existing_user and existing_user.password_hash:
        db.delete(verification)
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User with this email already exists")

    if existing_user and not existing_user.password_hash:
        existing_user.password_hash = verification.password_hash
        existing_user.auth_provider = provider_union(existing_user.auth_provider, "email")
        user = existing_user
    else:
        user = User(
            email=normalized_email,
            password_hash=verification.password_hash,
            display_name=build_user_name(normalized_email),
            auth_provider="email",
            coins=NEW_USER_STARTER_COINS,
        )
        db.add(user)

    _sync_user_display_name(user, fallback_email=normalized_email)
    sync_user_access_state(user)
    ensure_user_not_banned(user)
    db.delete(verification)
    db.commit()
    db.refresh(user)
    clear_verification_code_cooldown(normalized_email)
    return issue_auth_response(user)


@router.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    normalized_email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == normalized_email))

    if not user or not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    display_name_changed = _sync_user_display_name(user, fallback_email=normalized_email)
    access_state_changed = sync_user_access_state(user)
    ensure_user_not_banned(user)

    if display_name_changed or access_state_changed:
        db.commit()
        db.refresh(user)

    return issue_auth_response(user)


@router.post("/api/auth/google", response_model=AuthResponse)
def login_with_google(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    allowed_google_client_ids = parse_google_client_ids(settings.google_client_id)
    if not allowed_google_client_ids:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured on server",
        )

    normalized_id_token = payload.id_token.strip()
    local_claims = _decode_google_token_claims_unverified(normalized_id_token)
    local_claims_expired = isinstance(local_claims, dict) and _is_google_token_claims_expired(local_claims)

    token_data: dict[str, Any] | None = None
    verification_errors: list[str] = []
    if google_id_token is not None and google_requests is not None:
        try:
            token_data = google_id_token.verify_oauth2_token(
                normalized_id_token,
                google_requests.Request(),
                audience=None,
            )
        except ValueError as exc:
            verification_errors.append(f"sdk_value_error={exc}")
        except Exception as exc:  # pragma: no cover - defensive fallback for transport/provider failures
            logger.exception("Google token verification failed via sdk, trying fallbacks")
            verification_errors.append(f"sdk_error={exc}")
    else:
        verification_errors.append("sdk_unavailable")

    if token_data is None:
        try:
            token_data = _verify_google_token_with_tokeninfo(normalized_id_token)
        except Exception as fallback_exc:
            verification_errors.append(f"tokeninfo_error={fallback_exc}")

    if token_data is None:
        if isinstance(local_claims, dict) and not local_claims_expired:
            token_data = local_claims
            logger.warning("Google auth is using local unverified token claims fallback")
        else:
            verification_errors.append(
                "local_claims_expired" if local_claims_expired else "local_claims_invalid"
            )

    if not isinstance(token_data, dict):
        if local_claims_expired:
            detail = "Google token expired"
            if settings.debug and verification_errors:
                detail = f"{detail}: {'; '.join(verification_errors)}"
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

        detail = "Invalid Google token"
        if settings.debug and verification_errors:
            detail = f"{detail}: {'; '.join(verification_errors)}"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    if token_data.get("iss") not in GOOGLE_ISSUERS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google issuer")

    token_aud = token_data.get("aud")
    token_azp = token_data.get("azp")
    if not is_allowed_google_audience(token_aud, token_azp, allowed_google_client_ids):
        detail = "Google token audience mismatch"
        if settings.debug:
            detail = (
                f"{detail}. token aud={token_aud!r}, azp={token_azp!r}, "
                f"expected one of={sorted(allowed_google_client_ids)!r}"
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    if not token_data.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified")

    email = normalize_email(token_data.get("email", ""))
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account email is missing")

    raw_google_sub = token_data.get("sub")
    google_sub = str(raw_google_sub).strip() if raw_google_sub is not None else ""
    google_sub = google_sub or None
    display_name = coerce_display_name(token_data.get("name"), fallback_email=email)
    avatar_url = token_data.get("picture")

    try:
        user_by_google_sub = db.scalar(select(User).where(User.google_sub == google_sub)) if google_sub else None
        user_by_email = db.scalar(select(User).where(User.email == email))
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Google auth user lookup failed for email=%s", email)
        detail = "Authentication service is temporarily unavailable"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail) from exc

    if user_by_google_sub and user_by_email and user_by_google_sub.id != user_by_email.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Google account is already linked to another profile",
        )

    user = user_by_google_sub or user_by_email
    if user is None:
        user = User(
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            google_sub=google_sub,
            auth_provider="google",
            coins=NEW_USER_STARTER_COINS,
        )
        db.add(user)
    else:
        if google_sub and user.google_sub and user.google_sub != google_sub:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Google account is already linked to another profile",
            )
        user.auth_provider = provider_union(user.auth_provider, "google")
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if not (user.display_name or "").strip():
            user.display_name = display_name
        _sync_user_display_name(user, fallback_email=email)
        # Keep user-selected avatar between sessions; only fill avatar from Google when profile has no avatar yet.
        if avatar_url and not (user.avatar_url or "").strip():
            user.avatar_url = avatar_url

    sync_user_access_state(user)
    ensure_user_not_banned(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        logger.warning("Google auth integrity error for email=%s google_sub=%s: %s", email, google_sub, exc)
        integrity_text = str(getattr(exc, "orig", exc)).casefold()
        if "google_sub" in integrity_text:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Google account is already linked to another profile",
            ) from exc
        detail = "Failed to save Google account login"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Google auth database write failed for email=%s", email)
        detail = "Authentication service is temporarily unavailable"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail) from exc

    return issue_auth_response(user)


@router.post("/api/auth/logout", response_model=MessageResponse)
def logout() -> MessageResponse:
    # JWT is stateless. Frontend should discard the token.
    return MessageResponse(message="ok")


@router.get("/api/auth/me", response_model=UserOut)
def me(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_current_user(db, authorization)
    display_name_changed = _sync_user_display_name(user, fallback_email=user.email)
    sync_user_pending_purchases(db, user)
    if display_name_changed:
        db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/api/auth/me/onboarding-guide", response_model=OnboardingGuideStateOut)
def get_onboarding_guide_state(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> OnboardingGuideStateOut:
    user = get_current_user(db, authorization)
    current_state = _read_onboarding_guide_state(user)
    if user.onboarding_guide_state != json.dumps(current_state, ensure_ascii=False, separators=(",", ":")):
        _store_onboarding_guide_state(user, current_state)
        db.commit()
        db.refresh(user)
    return _serialize_onboarding_guide_state(user)


@router.patch("/api/auth/me/onboarding-guide", response_model=OnboardingGuideStateOut)
def update_onboarding_guide_state(
    payload: OnboardingGuideStateUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> OnboardingGuideStateOut:
    user = get_current_user(db, authorization)
    current_state = _read_onboarding_guide_state(user)
    next_state = dict(current_state)

    if "status" in payload.model_fields_set:
        next_state["status"] = payload.status
    if "current_step_id" in payload.model_fields_set:
        next_state["current_step_id"] = payload.current_step_id
    if "tutorial_game_id" in payload.model_fields_set:
        next_state["tutorial_game_id"] = payload.tutorial_game_id

    _store_onboarding_guide_state(user, next_state)
    db.commit()
    db.refresh(user)
    return _serialize_onboarding_guide_state(user)


@router.patch("/api/auth/me/avatar", response_model=UserOut)
def update_avatar(
    payload: AvatarUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_current_user(db, authorization)
    avatar_value = normalize_avatar_value(payload.avatar_url)
    user.avatar_url = validate_avatar_url(avatar_value) if avatar_value else None
    if payload.avatar_scale is not None:
        user.avatar_scale = normalize_media_scale(
            payload.avatar_scale,
            default=AVATAR_SCALE_DEFAULT,
            min_value=AVATAR_SCALE_MIN,
            max_value=AVATAR_SCALE_MAX,
        )

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/api/auth/me/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_current_user(db, authorization)
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one profile field should be provided",
        )

    if "display_name" in payload.model_fields_set:
        user.display_name = normalize_profile_display_name(payload.display_name or "")
    if "profile_description" in payload.model_fields_set:
        user.profile_description = normalize_profile_description(payload.profile_description)
    if "notifications_enabled" in payload.model_fields_set:
        user.notifications_enabled = bool(payload.notifications_enabled)
    if "notify_comment_reply" in payload.model_fields_set:
        user.notify_comment_reply = bool(payload.notify_comment_reply)
    if "notify_world_comment" in payload.model_fields_set:
        user.notify_world_comment = bool(payload.notify_world_comment)
    if "notify_publication_review" in payload.model_fields_set:
        user.notify_publication_review = bool(payload.notify_publication_review)
    if "notify_new_follower" in payload.model_fields_set:
        user.notify_new_follower = bool(payload.notify_new_follower)
    if "notify_moderation_report" in payload.model_fields_set:
        user.notify_moderation_report = bool(payload.notify_moderation_report)
    if "notify_moderation_queue" in payload.model_fields_set:
        user.notify_moderation_queue = bool(payload.notify_moderation_queue)
    if "email_notifications_enabled" in payload.model_fields_set:
        user.email_notifications_enabled = bool(payload.email_notifications_enabled)

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/api/auth/me/notifications", response_model=UserNotificationListResponseOut)
def get_my_notifications(
    limit: int = Query(default=12, ge=1, le=120),
    offset: int = Query(default=0, ge=0),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationListResponseOut:
    user = get_current_user(db, authorization)
    normalized_limit = max(1, min(int(limit or 12), 120))
    normalized_offset = max(0, int(offset or 0))
    try:
        total_count = count_total_user_notifications(db, user_id=int(user.id))
        unread_count = count_unread_user_notifications(db, user_id=int(user.id))
        items = list_user_notifications_out(
            db,
            user_id=int(user.id),
            limit=normalized_limit,
            offset=normalized_offset,
            sort_desc=order != "asc",
        )
        return UserNotificationListResponseOut(
            items=items,
            unread_count=unread_count,
            total_count=total_count,
            limit=normalized_limit,
            offset=normalized_offset,
            has_more=normalized_offset + len(items) < total_count,
        )
    except SQLAlchemyError:
        logger.exception("Failed to load notifications for user_id=%s", int(user.id))
        return _build_notification_list_fallback(limit=normalized_limit, offset=normalized_offset)


@router.get("/api/auth/me/notifications/summary", response_model=UserNotificationUnreadCountOut)
def get_my_notification_summary(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationUnreadCountOut:
    user = get_current_user(db, authorization)
    try:
        return UserNotificationUnreadCountOut(
            unread_count=count_unread_user_notifications(db, user_id=int(user.id)),
            total_count=count_total_user_notifications(db, user_id=int(user.id)),
        )
    except SQLAlchemyError:
        logger.exception("Failed to load notification summary for user_id=%s", int(user.id))
        return _build_notification_counters_fallback()


@router.get("/api/auth/me/notifications/unread-count", response_model=UserNotificationUnreadCountOut)
def get_my_notification_unread_count(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationUnreadCountOut:
    user = get_current_user(db, authorization)
    try:
        return UserNotificationUnreadCountOut(
            unread_count=count_unread_user_notifications(db, user_id=int(user.id)),
            total_count=count_total_user_notifications(db, user_id=int(user.id)),
        )
    except SQLAlchemyError:
        logger.exception("Failed to load unread notification count for user_id=%s", int(user.id))
        return _build_notification_counters_fallback()


@router.post("/api/auth/me/notifications/read-all", response_model=UserNotificationUnreadCountOut)
def read_all_my_notifications(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationUnreadCountOut:
    user = get_current_user(db, authorization)
    mark_all_user_notifications_read(db, user_id=int(user.id))
    db.commit()
    return UserNotificationUnreadCountOut(
        unread_count=0,
        total_count=count_total_user_notifications(db, user_id=int(user.id)),
    )


@router.delete("/api/auth/me/notifications/{notification_id}", response_model=UserNotificationUnreadCountOut)
def remove_my_notification(
    notification_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationUnreadCountOut:
    user = get_current_user(db, authorization)
    deleted = delete_user_notification(
        db,
        user_id=int(user.id),
        notification_id=int(notification_id),
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.commit()
    return UserNotificationUnreadCountOut(
        unread_count=count_unread_user_notifications(db, user_id=int(user.id)),
        total_count=count_total_user_notifications(db, user_id=int(user.id)),
    )


@router.get("/api/auth/me/daily-rewards", response_model=DailyRewardStatusOut)
def get_my_daily_rewards(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> DailyRewardStatusOut:
    user = get_current_user(db, authorization)
    try:
        return _serialize_daily_reward_status(user)
    except Exception:
        logger.exception("Failed to build daily reward status for user_id=%s", int(user.id))
        return _build_daily_reward_status_fallback()


@router.post("/api/auth/me/daily-rewards/claim", response_model=DailyRewardStatusOut)
def claim_my_daily_reward(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> DailyRewardStatusOut:
    user = get_current_user(db, authorization)
    try:
        reward_grant = claim_daily_reward(db, user=user)
    except SQLAlchemyError as exc:
        logger.exception("Failed to claim daily reward for user_id=%s", int(user.id))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Daily rewards are temporarily unavailable",
        ) from exc
    if reward_grant is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Daily reward is not available yet",
        )
    db.commit()
    db.refresh(user)
    try:
        return _serialize_daily_reward_status(
            user,
            claimed_reward_amount=int(reward_grant.reward_amount),
            claimed_reward_day=int(reward_grant.reward_day),
        )
    except Exception:
        logger.exception("Failed to serialize claimed daily reward for user_id=%s", int(user.id))
        return _build_daily_reward_status_fallback(
            claimed_reward_amount=int(reward_grant.reward_amount),
            claimed_reward_day=int(reward_grant.reward_day),
        )


@router.get("/api/auth/me/theme-settings", response_model=ThemeSettingsOut)
def get_my_theme_settings(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ThemeSettingsOut:
    user = get_current_user(db, authorization)
    return _serialize_theme_settings(user)


@router.put("/api/auth/me/theme-settings", response_model=ThemeSettingsOut)
def update_my_theme_settings(
    payload: ThemeSettingsUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ThemeSettingsOut:
    user = get_current_user(db, authorization)
    try:
        write_theme_settings(user, payload.model_dump(exclude_none=True))
    except ThemeSettingsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc) or "Theme settings payload is invalid",
        ) from exc
    db.commit()
    db.refresh(user)
    return _serialize_theme_settings(user)
