from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
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
from app.models import EmailVerification, PasswordResetVerification, User
from app.schemas import (
    AuthResponse,
    AuthMethodPasswordRequest,
    AvatarUpdateRequest,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    OnboardingGuideStateOut,
    OnboardingGuideStateUpdateRequest,
    PasswordResetRequest,
    PasswordResetVerifyRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    RegisterVerifyRequest,
    UserNotificationListResponseOut,
    UserNotificationOut,
    UserNotificationUnreadCountOut,
    UserOut,
    VKIDOAuthCompleteResponse,
    VKIDOAuthStartRequest,
    VKIDOAuthStartResponse,
    YandexOAuthCompleteResponse,
    YandexOAuthStartRequest,
    YandexOAuthStartResponse,
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
from app.security import create_access_token, hash_password, safe_decode_access_token, verify_password
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
    serialize_user_out,
    sync_auth_provider,
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
        mark_user_notification_read,
        reconcile_stale_moderation_notifications,
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

    def mark_user_notification_read(db: Session, *, user_id: int, notification_id: int) -> bool:
        _ = (db, user_id, notification_id)
        return False

    def reconcile_stale_moderation_notifications(db: Session, *, user_id: int) -> int:
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
    send_password_reset_code,
    send_email_verification_code,
)
from app.services.cosmetics import (
    normalize_avatar_frame_selection_for_user,
    normalize_profile_banner_selection_for_user,
)
from app.services.user_account_integrity import (
    find_user_by_email_case_insensitive,
    merge_users_for_email_into_target,
    repair_duplicate_users_for_email,
)
from app.services.vk_id_oauth import (
    VKIDIdentity,
    VKIDOAuthError,
    build_vk_id_authorization_url,
    exchange_vk_id_code,
    fetch_vk_id_identity,
)
from app.services.yandex_oauth import (
    YandexIdentity,
    YandexOAuthError,
    build_yandex_authorization_url,
    exchange_yandex_code,
    fetch_yandex_identity,
)

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

router = APIRouter()
logger = logging.getLogger(__name__)
AVATAR_SCALE_MIN = 1.0
AVATAR_SCALE_MAX = 3.0
AVATAR_SCALE_DEFAULT = 1.0
NEW_USER_STARTER_COINS = 50
ONBOARDING_GUIDE_DEFAULT_STATUS = "pending"
ONBOARDING_GUIDE_ALLOWED_STATUSES = {"pending", "completed", "skipped"}
ONBOARDING_GUIDE_STEP_ID_MAX_LENGTH = 120
PASSWORD_RESET_COOLDOWN_PREFIX = "password-reset:"
PASSWORD_RESET_SUCCESS_MESSAGE = "If an account with this email exists, password reset code was sent"
YANDEX_OAUTH_FLOW_COOKIE = "morius_yandex_oauth_flow"
YANDEX_OAUTH_COMPLETION_COOKIE = "morius_yandex_oauth_completion"
YANDEX_OAUTH_STATE_TTL_MINUTES = 10
YANDEX_OAUTH_COMPLETION_TTL_MINUTES = 5
YANDEX_OAUTH_PURPOSE_STATE = "yandex_oauth_state"
YANDEX_OAUTH_PURPOSE_FLOW = "yandex_oauth_flow"
YANDEX_OAUTH_PURPOSE_COMPLETION = "yandex_oauth_completion"
VK_ID_OAUTH_FLOW_COOKIE = "morius_vk_id_oauth_flow"
VK_ID_OAUTH_COMPLETION_COOKIE = "morius_vk_id_oauth_completion"
VK_ID_OAUTH_STATE_TTL_MINUTES = 10
VK_ID_OAUTH_COMPLETION_TTL_MINUTES = 5
VK_ID_OAUTH_PURPOSE_STATE = "vk_id_oauth_state"
VK_ID_OAUTH_PURPOSE_FLOW = "vk_id_oauth_flow"
VK_ID_OAUTH_PURPOSE_COMPLETION = "vk_id_oauth_completion"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _is_secure_yandex_cookie() -> bool:
    return settings.yandex_redirect_uri.lower().startswith("https://")


def _set_yandex_cookie(
    response: Response,
    *,
    key: str,
    value: str,
    max_age_seconds: int,
    path: str,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age_seconds,
        httponly=True,
        secure=_is_secure_yandex_cookie(),
        samesite="lax",
        path=path,
    )


def _delete_yandex_cookie(response: Response, *, key: str, path: str) -> None:
    response.delete_cookie(
        key=key,
        httponly=True,
        secure=_is_secure_yandex_cookie(),
        samesite="lax",
        path=path,
    )


def _is_secure_vk_id_cookie() -> bool:
    return settings.vk_id_redirect_uri.lower().startswith("https://")


def _set_vk_id_cookie(
    response: Response,
    *,
    key: str,
    value: str,
    max_age_seconds: int,
    path: str,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age_seconds,
        httponly=True,
        secure=_is_secure_vk_id_cookie(),
        samesite="lax",
        path=path,
    )


def _delete_vk_id_cookie(response: Response, *, key: str, path: str) -> None:
    response.delete_cookie(
        key=key,
        httponly=True,
        secure=_is_secure_vk_id_cookie(),
        samesite="lax",
        path=path,
    )


def _normalize_yandex_return_path(value: str | None, *, action: str) -> str:
    fallback = "/profile" if action == "link" else "/auth"
    normalized = str(value or "").strip()
    if not normalized.startswith("/") or normalized.startswith("//"):
        return fallback
    if any(character in normalized for character in ("\r", "\n", "\\")):
        return fallback
    return normalized[:512]


def _normalize_vk_id_return_path(value: str | None, *, action: str) -> str:
    return _normalize_yandex_return_path(value, action=action)


def _build_yandex_frontend_redirect(
    *,
    return_path: str,
    complete: bool = False,
    error: str | None = None,
) -> str:
    separator = "&" if "?" in return_path else "?"
    query: dict[str, str] = {}
    if complete:
        query["yandex_oauth"] = "complete"
    if error:
        query["yandex_oauth_error"] = error[:160]
    suffix = f"{separator}{urlencode(query)}" if query else ""
    return f"{settings.yandex_frontend_url}{return_path}{suffix}"


def _build_vk_id_frontend_redirect(
    *,
    return_path: str,
    complete: bool = False,
    error: str | None = None,
) -> str:
    separator = "&" if "?" in return_path else "?"
    query: dict[str, str] = {}
    if complete:
        query["vk_id_oauth"] = "complete"
    if error:
        query["vk_id_oauth_error"] = error[:160]
    suffix = f"{separator}{urlencode(query)}" if query else ""
    return f"{settings.vk_id_frontend_url}{return_path}{suffix}"


def _vk_id_provider_error_code(exc: VKIDOAuthError) -> str:
    raw_code = str(getattr(exc, "code", "") or "").strip().lower()
    allowed_codes = {
        "invalid_request",
        "invalid_grant",
        "invalid_scope",
        "invalid_client",
        "access_denied",
        "state_mismatch",
        "missing_access_token",
        "user_info_rejected",
        "invalid_user_info",
        "missing_user_id",
        "missing_email",
    }
    return raw_code if raw_code in allowed_codes else "provider_error"


def _decode_yandex_token(value: str | None, *, purpose: str) -> dict[str, Any]:
    payload = safe_decode_access_token(str(value or "").strip())
    if not isinstance(payload, dict) or payload.get("purpose") != purpose:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yandex OAuth session is invalid or expired")
    return payload


def _decode_vk_id_token(value: str | None, *, purpose: str) -> dict[str, Any]:
    payload = safe_decode_access_token(str(value or "").strip())
    if not isinstance(payload, dict) or payload.get("purpose") != purpose:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth session is invalid or expired")
    return payload


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    normalized = str(value or "").strip()
    padding = "=" * (-len(normalized) % 4)
    return base64.urlsafe_b64decode(f"{normalized}{padding}".encode("ascii"))


def _sign_vk_id_state(payload: str) -> str:
    return _base64url_encode(
        hmac.new(
            settings.jwt_secret_key.encode("utf-8"),
            f"vk-id-oauth-state:{payload}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )


def _encode_vk_id_state(
    *,
    nonce: str,
    action: str,
    provider: str,
    user_id: int | None,
    return_path: str,
) -> str:
    expires_at = int((_utcnow() + timedelta(minutes=VK_ID_OAUTH_STATE_TTL_MINUTES)).timestamp())
    state_payload: dict[str, Any] = {
        "a": "l" if action == "link" else "g",
        "e": expires_at,
        "n": nonce,
        "p": "m" if provider == "mail" else "v",
        "r": return_path,
    }
    if user_id is not None:
        state_payload["u"] = int(user_id)
    encoded_payload = _base64url_encode(
        json.dumps(state_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    return f"v1.{encoded_payload}.{_sign_vk_id_state(encoded_payload)}"


def _decode_vk_id_state(value: str | None) -> dict[str, Any]:
    raw_value = str(value or "").strip()
    if raw_value.startswith("v1."):
        try:
            _version, encoded_payload, signature = raw_value.split(".", 2)
            expected_signature = _sign_vk_id_state(encoded_payload)
            if not secrets.compare_digest(signature, expected_signature):
                raise ValueError("VK ID compact state signature mismatch")
            payload = json.loads(_base64url_decode(encoded_payload).decode("utf-8"))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VK ID OAuth session is invalid or expired",
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth session is invalid or expired")
        expires_at = payload.get("e")
        if not isinstance(expires_at, int) or expires_at <= int(_utcnow().timestamp()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth session is invalid or expired")
        nonce = str(payload.get("n") or "").strip()
        if not nonce:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth session is invalid or expired")
        return {
            "purpose": VK_ID_OAUTH_PURPOSE_STATE,
            "nonce": nonce,
            "action": "link" if payload.get("a") == "l" else "login",
            "provider": "mail" if payload.get("p") == "m" else "vk",
            "user_id": payload.get("u"),
            "return_path": str(payload.get("r") or ""),
        }
    return _decode_vk_id_token(raw_value, purpose=VK_ID_OAUTH_PURPOSE_STATE)


def _build_vk_id_code_verifier(nonce: str) -> str:
    normalized_nonce = str(nonce or "").strip()
    if not normalized_nonce:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth session is invalid or expired")
    digest = hmac.new(
        settings.jwt_secret_key.encode("utf-8"),
        f"vk-id-oauth-pkce:{normalized_nonce}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _resolve_yandex_login_user(db: Session, identity: YandexIdentity) -> tuple[User, bool]:
    user_by_subject = db.scalar(select(User).where(User.yandex_sub == identity.subject))
    user_by_email = find_user_by_email_case_insensitive(db, identity.email)
    if user_by_subject and user_by_email and int(user_by_subject.id) != int(user_by_email.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yandex account is already linked to another profile",
        )

    user = user_by_subject or user_by_email
    is_new_user = user is None
    if user is None:
        user = User(
            email=normalize_email(identity.email),
            display_name=coerce_display_name(identity.display_name, fallback_email=identity.email),
            avatar_url=identity.avatar_url,
            yandex_sub=identity.subject,
            auth_provider="yandex",
            coins=NEW_USER_STARTER_COINS,
        )
        db.add(user)
        return user, True

    user, _ = merge_users_for_email_into_target(
        db,
        identity.email,
        target_user=user,
    )
    if user.yandex_sub and user.yandex_sub != identity.subject:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This profile is linked to another Yandex account",
        )
    user.yandex_sub = identity.subject
    if not (user.display_name or "").strip():
        user.display_name = coerce_display_name(identity.display_name, fallback_email=user.email)
    if identity.avatar_url and not (user.avatar_url or "").strip():
        user.avatar_url = identity.avatar_url
    sync_auth_provider(user)
    return user, is_new_user


def _link_yandex_identity(db: Session, *, user_id: int, identity: YandexIdentity) -> User:
    user = db.scalar(select(User).where(User.id == int(user_id)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile was not found")

    linked_user = db.scalar(select(User).where(User.yandex_sub == identity.subject))
    if linked_user is not None and int(linked_user.id) != int(user.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Yandex account is already linked to another profile",
        )

    user, _ = merge_users_for_email_into_target(
        db,
        identity.email,
        target_user=user,
    )
    user.password_hash = None
    user.google_sub = None
    user.vk_id_sub = None
    user.vk_id_provider = None
    user.yandex_sub = identity.subject
    if identity.avatar_url and not (user.avatar_url or "").strip():
        user.avatar_url = identity.avatar_url
    sync_auth_provider(user)
    return user


def _vk_id_identity_email(identity: VKIDIdentity) -> str:
    return normalize_email(str(identity.email or ""))


def _vk_id_placeholder_email(identity: VKIDIdentity) -> str:
    digest = hashlib.sha256(f"{identity.provider}:{identity.subject}".encode("utf-8")).hexdigest()[:24]
    return f"{identity.provider}-{digest}@vkid.morius-ai.ru"


def _resolve_vk_id_login_user(db: Session, identity: VKIDIdentity) -> tuple[User, bool]:
    identity_email = _vk_id_identity_email(identity)
    user_by_subject = db.scalar(select(User).where(User.vk_id_sub == identity.subject))
    user_by_email = find_user_by_email_case_insensitive(db, identity_email) if identity_email else None
    if user_by_subject and user_by_email and int(user_by_subject.id) != int(user_by_email.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="VK ID account is already linked to another profile",
        )

    user = user_by_subject or user_by_email
    is_new_user = user is None
    if user is None:
        user_email = identity_email or _vk_id_placeholder_email(identity)
        user = User(
            email=user_email,
            display_name=coerce_display_name(identity.display_name, fallback_email=user_email),
            avatar_url=identity.avatar_url,
            vk_id_sub=identity.subject,
            vk_id_provider=identity.provider,
            auth_provider=identity.provider,
            coins=NEW_USER_STARTER_COINS,
        )
        db.add(user)
        return user, True

    if identity_email:
        user, _ = merge_users_for_email_into_target(
            db,
            identity_email,
            target_user=user,
        )
    if user.vk_id_sub and user.vk_id_sub != identity.subject:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This profile is linked to another VK ID account",
        )
    user.vk_id_sub = identity.subject
    user.vk_id_provider = identity.provider
    if not (user.display_name or "").strip():
        user.display_name = coerce_display_name(identity.display_name, fallback_email=user.email)
    if identity.avatar_url and not (user.avatar_url or "").strip():
        user.avatar_url = identity.avatar_url
    sync_auth_provider(user)
    return user, is_new_user


def _link_vk_id_identity(db: Session, *, user_id: int, identity: VKIDIdentity) -> User:
    identity_email = _vk_id_identity_email(identity)
    user = db.scalar(select(User).where(User.id == int(user_id)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile was not found")

    linked_user = db.scalar(select(User).where(User.vk_id_sub == identity.subject))
    if linked_user is not None and int(linked_user.id) != int(user.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="VK ID account is already linked to another profile",
        )

    if identity_email:
        user, _ = merge_users_for_email_into_target(
            db,
            identity_email,
            target_user=user,
        )
    user.password_hash = None
    user.google_sub = None
    user.yandex_sub = None
    user.vk_id_sub = identity.subject
    user.vk_id_provider = identity.provider
    if identity.avatar_url and not (user.avatar_url or "").strip():
        user.avatar_url = identity.avatar_url
    sync_auth_provider(user)
    return user


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


def _verify_google_access_token_with_tokeninfo(access_token_value: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"access_token": access_token_value},
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
    email_verified = normalized_payload.get("email_verified", normalized_payload.get("verified_email"))
    if isinstance(email_verified, str):
        normalized_payload["email_verified"] = email_verified.strip().lower() == "true"
    elif isinstance(email_verified, bool):
        normalized_payload["email_verified"] = email_verified
    return normalized_payload


def _fetch_google_userinfo(access_token_value: str) -> dict[str, Any]:
    try:
        response = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token_value}"},
            timeout=(4, 10),
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach Google userinfo endpoint") from exc

    payload: Any = {}
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 500:
        raise RuntimeError(f"Google userinfo is unavailable ({response.status_code})")

    if response.status_code >= 400 or not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")

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


@router.post("/api/auth/vk/start", response_model=VKIDOAuthStartResponse)
def start_vk_id_oauth(
    payload: VKIDOAuthStartRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> VKIDOAuthStartResponse:
    client_id = settings.vk_id_client_id.strip()
    redirect_uri = settings.vk_id_redirect_uri.strip()
    if not client_id or not client_id.isdigit() or not redirect_uri or not settings.vk_id_frontend_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VK ID OAuth is not configured on server",
        )

    user_id: int | None = None
    if payload.action == "link":
        user_id = int(get_current_user(db, authorization).id)

    return_path = _normalize_vk_id_return_path(payload.return_path, action=payload.action)
    nonce = secrets.token_urlsafe(24)
    code_verifier = _build_vk_id_code_verifier(nonce)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).decode("ascii").rstrip("=")
    state_token = _encode_vk_id_state(
        nonce=nonce,
        action=payload.action,
        provider=payload.provider,
        user_id=user_id,
        return_path=return_path,
    )
    _set_vk_id_cookie(
        response,
        key=VK_ID_OAUTH_FLOW_COOKIE,
        value=state_token,
        max_age_seconds=VK_ID_OAUTH_STATE_TTL_MINUTES * 60,
        path="/api/auth/callback/vk",
    )
    return VKIDOAuthStartResponse(
        authorization_url=build_vk_id_authorization_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state_token,
            code_challenge=code_challenge,
            provider=payload.provider,
            force_login=payload.action == "link",
        )
    )


@router.get("/api/auth/callback/vk", include_in_schema=False)
def vk_id_oauth_callback(
    payload: str | None = Query(default=None),
    code: str | None = Query(default=None),
    state_token: str | None = Query(default=None, alias="state"),
    device_id: str | None = Query(default=None),
    provider_error: str | None = Query(default=None, alias="error"),
    flow_cookie: str | None = Cookie(default=None, alias=VK_ID_OAUTH_FLOW_COOKIE),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    callback_payload: dict[str, Any] = {}
    if payload:
        try:
            parsed_payload = json.loads(payload)
        except (TypeError, ValueError):
            parsed_payload = {}
        if isinstance(parsed_payload, dict):
            callback_payload = parsed_payload

    resolved_code = str(code or callback_payload.get("code") or "").strip()
    resolved_state = str(state_token or callback_payload.get("state") or "").strip()
    resolved_device_id = str(device_id or callback_payload.get("device_id") or "").strip()
    resolved_error = str(
        provider_error
        or callback_payload.get("error")
        or callback_payload.get("error_description")
        or ""
    ).strip()

    state_for_exchange = resolved_state
    try:
        state_payload = _decode_vk_id_state(resolved_state)
    except HTTPException:
        try:
            state_payload = _decode_vk_id_state(flow_cookie)
            state_for_exchange = str(flow_cookie or "").strip()
        except HTTPException:
            logger.warning(
                "VK ID OAuth state decode failed: has_state=%s state_len=%s has_payload=%s payload_len=%s has_flow_cookie=%s",
                bool(resolved_state),
                len(resolved_state),
                bool(payload),
                len(str(payload or "")),
                bool(flow_cookie),
            )
            redirect = RedirectResponse(
                _build_vk_id_frontend_redirect(return_path="/auth", error="session_expired"),
                status_code=status.HTTP_303_SEE_OTHER,
            )
            _delete_vk_id_cookie(
                redirect,
                key=VK_ID_OAUTH_FLOW_COOKIE,
                path="/api/auth/callback/vk",
            )
            return redirect
    action = "link" if state_payload.get("action") == "link" else "login"
    provider = "mail" if state_payload.get("provider") == "mail" else "vk"
    return_path = _normalize_vk_id_return_path(state_payload.get("return_path"), action=action)
    code_verifier = _build_vk_id_code_verifier(str(state_payload.get("nonce") or ""))

    if resolved_error:
        redirect = RedirectResponse(
            _build_vk_id_frontend_redirect(return_path=return_path, error=resolved_error),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_vk_id_cookie(
            redirect,
            key=VK_ID_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/vk",
        )
        return redirect
    if not resolved_code or not resolved_device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="VK ID authorization response is incomplete",
        )

    try:
        access_token = exchange_vk_id_code(
            client_id=settings.vk_id_client_id,
            redirect_uri=settings.vk_id_redirect_uri,
            code=resolved_code,
            code_verifier=code_verifier,
            device_id=resolved_device_id,
            state=state_for_exchange,
        )
        identity = fetch_vk_id_identity(
            access_token=access_token,
            client_id=settings.vk_id_client_id,
            provider=provider,
        )
        if action == "link":
            try:
                user_id = int(str(state_payload.get("user_id")))
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="VK ID account link target is invalid",
                ) from exc
            user = _link_vk_id_identity(db, user_id=user_id, identity=identity)
            is_new_user = False
        else:
            user, is_new_user = _resolve_vk_id_login_user(db, identity)

        _sync_user_display_name(user, fallback_email=user.email)
        sync_user_access_state(user)
        ensure_user_not_banned(user)
        db.commit()
        db.refresh(user)
    except HTTPException as exc:
        db.rollback()
        logger.warning("VK ID OAuth account operation failed: status=%s detail=%s", exc.status_code, exc.detail)
        error_code = "account_conflict" if exc.status_code == status.HTTP_409_CONFLICT else "account_error"
        redirect = RedirectResponse(
            _build_vk_id_frontend_redirect(return_path=return_path, error=error_code),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_vk_id_cookie(
            redirect,
            key=VK_ID_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/vk",
        )
        return redirect
    except (IntegrityError, SQLAlchemyError) as exc:
        db.rollback()
        logger.exception("VK ID OAuth database operation failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from exc
    except VKIDOAuthError as exc:
        db.rollback()
        error_code = _vk_id_provider_error_code(exc)
        logger.warning("VK ID OAuth provider error: code=%s detail=%s", error_code, exc)
        redirect = RedirectResponse(
            _build_vk_id_frontend_redirect(return_path=return_path, error=error_code),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_vk_id_cookie(
            redirect,
            key=VK_ID_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/vk",
        )
        return redirect

    completion_token = create_access_token(
        subject=str(user.id),
        claims={
            "purpose": VK_ID_OAUTH_PURPOSE_COMPLETION,
            "oauth_action": action,
            "oauth_provider": provider,
            "is_new_user": is_new_user,
        },
        expires_delta=timedelta(minutes=VK_ID_OAUTH_COMPLETION_TTL_MINUTES),
    )
    redirect = RedirectResponse(
        _build_vk_id_frontend_redirect(return_path=return_path, complete=True),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _delete_vk_id_cookie(
        redirect,
        key=VK_ID_OAUTH_FLOW_COOKIE,
        path="/api/auth/callback/vk",
    )
    _set_vk_id_cookie(
        redirect,
        key=VK_ID_OAUTH_COMPLETION_COOKIE,
        value=completion_token,
        max_age_seconds=VK_ID_OAUTH_COMPLETION_TTL_MINUTES * 60,
        path="/api/auth/vk/complete",
    )
    return redirect


@router.post("/api/auth/vk/complete", response_model=VKIDOAuthCompleteResponse)
def complete_vk_id_oauth(
    response: Response,
    completion_cookie: str | None = Cookie(default=None, alias=VK_ID_OAUTH_COMPLETION_COOKIE),
    db: Session = Depends(get_db),
) -> VKIDOAuthCompleteResponse:
    completion_payload = _decode_vk_id_token(
        completion_cookie,
        purpose=VK_ID_OAUTH_PURPOSE_COMPLETION,
    )
    try:
        user_id = int(str(completion_payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VK ID OAuth result is invalid") from exc
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile was not found")
    sync_user_access_state(user)
    ensure_user_not_banned(user)
    auth_response = issue_auth_response(
        user,
        is_new_user=bool(completion_payload.get("is_new_user")),
        db=db,
    )
    _delete_vk_id_cookie(
        response,
        key=VK_ID_OAUTH_COMPLETION_COOKIE,
        path="/api/auth/vk/complete",
    )
    return VKIDOAuthCompleteResponse(
        **auth_response.model_dump(),
        oauth_action="link" if completion_payload.get("oauth_action") == "link" else "login",
        oauth_provider="mail" if completion_payload.get("oauth_provider") == "mail" else "vk",
    )


@router.post("/api/auth/yandex/start", response_model=YandexOAuthStartResponse)
def start_yandex_oauth(
    payload: YandexOAuthStartRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> YandexOAuthStartResponse:
    client_id = settings.yandex_client_id.strip()
    redirect_uri = settings.yandex_redirect_uri.strip()
    if not client_id or not redirect_uri or not settings.yandex_frontend_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Yandex OAuth is not configured on server",
        )

    user_id: int | None = None
    if payload.action == "link":
        user_id = int(get_current_user(db, authorization).id)

    return_path = _normalize_yandex_return_path(payload.return_path, action=payload.action)
    nonce = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).decode("ascii").rstrip("=")
    state_token = create_access_token(
        subject="yandex-oauth-state",
        claims={
            "purpose": YANDEX_OAUTH_PURPOSE_STATE,
            "nonce": nonce,
            "action": payload.action,
            "user_id": user_id,
            "return_path": return_path,
        },
        expires_delta=timedelta(minutes=YANDEX_OAUTH_STATE_TTL_MINUTES),
    )
    flow_token = create_access_token(
        subject="yandex-oauth-flow",
        claims={
            "purpose": YANDEX_OAUTH_PURPOSE_FLOW,
            "nonce": nonce,
            "code_verifier": code_verifier,
        },
        expires_delta=timedelta(minutes=YANDEX_OAUTH_STATE_TTL_MINUTES),
    )
    _set_yandex_cookie(
        response,
        key=YANDEX_OAUTH_FLOW_COOKIE,
        value=flow_token,
        max_age_seconds=YANDEX_OAUTH_STATE_TTL_MINUTES * 60,
        path="/api/auth/callback/yandex",
    )
    return YandexOAuthStartResponse(
        authorization_url=build_yandex_authorization_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state_token,
            code_challenge=code_challenge,
            force_confirm=payload.action == "link",
        )
    )


@router.get("/api/auth/callback/yandex", include_in_schema=False)
def yandex_oauth_callback(
    code: str | None = Query(default=None),
    state_token: str | None = Query(default=None, alias="state"),
    provider_error: str | None = Query(default=None, alias="error"),
    flow_cookie: str | None = Cookie(default=None, alias=YANDEX_OAUTH_FLOW_COOKIE),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    state_payload = _decode_yandex_token(state_token, purpose=YANDEX_OAUTH_PURPOSE_STATE)
    action = "link" if state_payload.get("action") == "link" else "login"
    return_path = _normalize_yandex_return_path(state_payload.get("return_path"), action=action)
    flow_payload = _decode_yandex_token(flow_cookie, purpose=YANDEX_OAUTH_PURPOSE_FLOW)
    if not secrets.compare_digest(
        str(state_payload.get("nonce") or ""),
        str(flow_payload.get("nonce") or ""),
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yandex OAuth state mismatch")

    if provider_error:
        redirect = RedirectResponse(
            _build_yandex_frontend_redirect(return_path=return_path, error=str(provider_error)),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_yandex_cookie(
            redirect,
            key=YANDEX_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/yandex",
        )
        return redirect
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yandex authorization code is missing")

    try:
        access_token = exchange_yandex_code(
            client_id=settings.yandex_client_id,
            code=code,
            code_verifier=str(flow_payload.get("code_verifier") or ""),
        )
        identity = fetch_yandex_identity(
            access_token=access_token,
            expected_client_id=settings.yandex_client_id,
        )
        if action == "link":
            raw_user_id = state_payload.get("user_id")
            try:
                user_id = int(str(raw_user_id))
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Yandex account link target is invalid",
                ) from exc
            user = _link_yandex_identity(db, user_id=user_id, identity=identity)
            is_new_user = False
        else:
            user, is_new_user = _resolve_yandex_login_user(db, identity)

        _sync_user_display_name(user, fallback_email=user.email)
        sync_user_access_state(user)
        ensure_user_not_banned(user)
        db.commit()
        db.refresh(user)
    except HTTPException as exc:
        db.rollback()
        logger.warning("Yandex OAuth account operation failed: status=%s detail=%s", exc.status_code, exc.detail)
        error_code = "account_conflict" if exc.status_code == status.HTTP_409_CONFLICT else "account_error"
        redirect = RedirectResponse(
            _build_yandex_frontend_redirect(return_path=return_path, error=error_code),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_yandex_cookie(
            redirect,
            key=YANDEX_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/yandex",
        )
        return redirect
    except (IntegrityError, SQLAlchemyError) as exc:
        db.rollback()
        logger.exception("Yandex OAuth database operation failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from exc
    except YandexOAuthError as exc:
        db.rollback()
        logger.warning("Yandex OAuth provider error: %s", exc)
        redirect = RedirectResponse(
            _build_yandex_frontend_redirect(return_path=return_path, error="provider_error"),
            status_code=status.HTTP_303_SEE_OTHER,
        )
        _delete_yandex_cookie(
            redirect,
            key=YANDEX_OAUTH_FLOW_COOKIE,
            path="/api/auth/callback/yandex",
        )
        return redirect

    completion_token = create_access_token(
        subject=str(user.id),
        claims={
            "purpose": YANDEX_OAUTH_PURPOSE_COMPLETION,
            "oauth_action": action,
            "is_new_user": is_new_user,
        },
        expires_delta=timedelta(minutes=YANDEX_OAUTH_COMPLETION_TTL_MINUTES),
    )
    redirect = RedirectResponse(
        _build_yandex_frontend_redirect(return_path=return_path, complete=True),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _delete_yandex_cookie(
        redirect,
        key=YANDEX_OAUTH_FLOW_COOKIE,
        path="/api/auth/callback/yandex",
    )
    _set_yandex_cookie(
        redirect,
        key=YANDEX_OAUTH_COMPLETION_COOKIE,
        value=completion_token,
        max_age_seconds=YANDEX_OAUTH_COMPLETION_TTL_MINUTES * 60,
        path="/api/auth/yandex/complete",
    )
    return redirect


@router.post("/api/auth/yandex/complete", response_model=YandexOAuthCompleteResponse)
def complete_yandex_oauth(
    response: Response,
    completion_cookie: str | None = Cookie(default=None, alias=YANDEX_OAUTH_COMPLETION_COOKIE),
    db: Session = Depends(get_db),
) -> YandexOAuthCompleteResponse:
    completion_payload = _decode_yandex_token(
        completion_cookie,
        purpose=YANDEX_OAUTH_PURPOSE_COMPLETION,
    )
    try:
        user_id = int(str(completion_payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yandex OAuth result is invalid") from exc
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile was not found")
    sync_user_access_state(user)
    ensure_user_not_banned(user)
    auth_response = issue_auth_response(
        user,
        is_new_user=bool(completion_payload.get("is_new_user")),
        db=db,
    )
    _delete_yandex_cookie(
        response,
        key=YANDEX_OAUTH_COMPLETION_COOKIE,
        path="/api/auth/yandex/complete",
    )
    return YandexOAuthCompleteResponse(
        **auth_response.model_dump(),
        oauth_action="link" if completion_payload.get("oauth_action") == "link" else "login",
    )


@router.post("/api/auth/me/auth-method/password", response_model=UserOut)
def replace_auth_method_with_password(
    payload: AuthMethodPasswordRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    current_user = get_current_user(db, authorization)
    repaired_user, _ = repair_duplicate_users_for_email(
        db,
        current_user.email,
        preferred_user_id=int(current_user.id),
    )
    user = repaired_user or current_user
    user.password_hash = hash_password(payload.password)
    user.google_sub = None
    user.yandex_sub = None
    user.vk_id_sub = None
    user.vk_id_provider = None
    sync_auth_provider(user)
    sync_user_access_state(user)
    ensure_user_not_banned(user)
    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Failed to replace auth method with password for user_id=%s", int(current_user.id))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable",
        ) from exc
    return serialize_user_out(user, db=db)


@router.post("/api/auth/register", response_model=MessageResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> MessageResponse:
    normalized_email = normalize_email(payload.email)
    if not payload.accepted_terms:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Terms should be accepted")
    if not payload.accepted_age:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Age confirmation should be accepted")
    display_name = coerce_display_name(payload.display_name, fallback_email=normalized_email)
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
            display_name=display_name,
            expires_at=expires_at,
            attempts_left=max_attempts,
        )
        db.add(verification)
    else:
        verification.code_hash = code_hash
        verification.password_hash = password_hash
        verification.display_name = display_name
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

    is_new_user = False
    if existing_user and not existing_user.password_hash:
        existing_user.password_hash = verification.password_hash
        existing_user.auth_provider = provider_union(existing_user.auth_provider, "email")
        if not (existing_user.display_name or "").strip() and verification.display_name:
            existing_user.display_name = verification.display_name
        user = existing_user
    else:
        is_new_user = True
        user = User(
            email=normalized_email,
            password_hash=verification.password_hash,
            display_name=verification.display_name or build_user_name(normalized_email),
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
    return issue_auth_response(user, is_new_user=is_new_user, db=db)


@router.post("/api/auth/password-reset", response_model=MessageResponse)
def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)) -> MessageResponse:
    normalized_email = normalize_email(payload.email)
    cooldown_key = f"{PASSWORD_RESET_COOLDOWN_PREFIX}{normalized_email}"
    now = _utcnow()
    cooldown_remaining_seconds = get_resend_cooldown_remaining_seconds(cooldown_key, now)
    if cooldown_remaining_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {cooldown_remaining_seconds} seconds before requesting a new code",
        )

    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        mark_verification_code_sent(cooldown_key, now=now)
        return MessageResponse(message=PASSWORD_RESET_SUCCESS_MESSAGE)

    verification_code = generate_verification_code()
    expires_at = now + timedelta(minutes=max(settings.email_verification_code_ttl_minutes, 1))
    max_attempts = max(settings.email_verification_max_attempts, 1)
    code_hash = hash_password(verification_code)

    verification = db.scalar(
        select(PasswordResetVerification).where(PasswordResetVerification.email == normalized_email)
    )
    if verification is None:
        verification = PasswordResetVerification(
            email=normalized_email,
            code_hash=code_hash,
            expires_at=expires_at,
            attempts_left=max_attempts,
        )
        db.add(verification)
    else:
        verification.code_hash = code_hash
        verification.expires_at = expires_at
        verification.attempts_left = max_attempts

    try:
        send_password_reset_code(normalized_email, verification_code)
    except Exception as exc:
        db.rollback()
        detail = "Failed to send password reset email"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from exc

    db.commit()
    mark_verification_code_sent(cooldown_key, now=_utcnow())
    return MessageResponse(message=PASSWORD_RESET_SUCCESS_MESSAGE)


@router.post("/api/auth/password-reset/verify", response_model=AuthResponse)
def verify_password_reset(payload: PasswordResetVerifyRequest, db: Session = Depends(get_db)) -> AuthResponse:
    normalized_email = normalize_email(payload.email)
    cooldown_key = f"{PASSWORD_RESET_COOLDOWN_PREFIX}{normalized_email}"
    verification = db.scalar(
        select(PasswordResetVerification).where(PasswordResetVerification.email == normalized_email)
    )
    if verification is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset code was not requested for this email",
        )

    expires_at = _to_utc(verification.expires_at)
    if expires_at <= _utcnow():
        db.delete(verification)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset code expired. Request a new code",
        )

    if not verify_password(payload.code, verification.code_hash):
        verification.attempts_left -= 1
        if verification.attempts_left <= 0:
            db.delete(verification)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password reset code is invalid. Request a new code",
            )

        attempts_left = verification.attempts_left
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password reset code is invalid. Attempts left: {attempts_left}",
        )

    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        db.delete(verification)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password reset code is invalid")

    user.password_hash = hash_password(payload.password)
    user.auth_provider = provider_union(user.auth_provider, "email")
    _sync_user_display_name(user, fallback_email=normalized_email)
    sync_user_access_state(user)
    ensure_user_not_banned(user)
    db.delete(verification)
    db.commit()
    db.refresh(user)
    clear_verification_code_cooldown(cooldown_key)
    return issue_auth_response(user, db=db)


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

    return issue_auth_response(user, db=db)


@router.post("/api/auth/google", response_model=AuthResponse)
def login_with_google(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    allowed_google_client_ids = parse_google_client_ids(settings.google_client_id)
    if not allowed_google_client_ids:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured on server",
        )

    normalized_id_token = (payload.id_token or "").strip()
    normalized_access_token = (payload.access_token or "").strip()

    token_data: dict[str, Any] | None = None
    verification_errors: list[str] = []

    if normalized_id_token:
        local_claims = _decode_google_token_claims_unverified(normalized_id_token)
        local_claims_expired = isinstance(local_claims, dict) and _is_google_token_claims_expired(local_claims)

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
    else:
        try:
            token_data = _verify_google_access_token_with_tokeninfo(normalized_access_token)
        except Exception as exc:
            verification_errors.append(f"tokeninfo_error={exc}")

        if not isinstance(token_data, dict):
            detail = "Invalid Google token"
            if settings.debug and verification_errors:
                detail = f"{detail}: {'; '.join(verification_errors)}"
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

        userinfo_data = _fetch_google_userinfo(normalized_access_token)
        token_data.update({key: value for key, value in userinfo_data.items() if value is not None})

    token_aud = token_data.get("aud") or token_data.get("issued_to") or token_data.get("audience")
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

    raw_google_sub = token_data.get("sub") or token_data.get("user_id")
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
    is_new_user = user is None
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

    return issue_auth_response(user, is_new_user=is_new_user, db=db)


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
    return serialize_user_out(user, db=db)


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
    return serialize_user_out(user, db=db)


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
    if "profile_banner_id" in payload.model_fields_set:
        user.profile_banner_id = normalize_profile_banner_selection_for_user(
            db,
            user_id=int(user.id),
            value=payload.profile_banner_id,
        )
    if "avatar_frame_id" in payload.model_fields_set:
        user.avatar_frame_id = normalize_avatar_frame_selection_for_user(
            db,
            user_id=int(user.id),
            value=payload.avatar_frame_id,
        )
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
    if "ai_assistant_visible" in payload.model_fields_set:
        user.ai_assistant_visible = bool(payload.ai_assistant_visible)
    if "email_notifications_enabled" in payload.model_fields_set:
        user.email_notifications_enabled = bool(payload.email_notifications_enabled)

    db.commit()
    db.refresh(user)
    return serialize_user_out(user, db=db)


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
        if reconcile_stale_moderation_notifications(db, user_id=int(user.id)):
            db.commit()
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
        if reconcile_stale_moderation_notifications(db, user_id=int(user.id)):
            db.commit()
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
        if reconcile_stale_moderation_notifications(db, user_id=int(user.id)):
            db.commit()
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


@router.post("/api/auth/me/notifications/{notification_id}/read", response_model=UserNotificationUnreadCountOut)
def read_my_notification(
    notification_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserNotificationUnreadCountOut:
    user = get_current_user(db, authorization)
    found = mark_user_notification_read(
        db,
        user_id=int(user.id),
        notification_id=int(notification_id),
    )
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.commit()
    return UserNotificationUnreadCountOut(
        unread_count=count_unread_user_notifications(db, user_id=int(user.id)),
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
