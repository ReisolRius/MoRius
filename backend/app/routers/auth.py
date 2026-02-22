from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
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
    RegisterRequest,
    RegisterVerifyRequest,
    UserOut,
)
from app.security import hash_password, verify_password
from app.services.auth_identity import (
    build_user_name,
    get_current_user,
    is_allowed_google_audience,
    issue_auth_response,
    normalize_email,
    parse_google_client_ids,
    provider_union,
)
from app.services.media import normalize_avatar_value, normalize_media_scale, validate_avatar_url
from app.services.payments import sync_user_pending_purchases
from app.services.auth_verification import (
    clear_verification_code_cooldown,
    generate_verification_code,
    get_resend_cooldown_remaining_seconds,
    mark_verification_code_sent,
    send_email_verification_code,
)

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

router = APIRouter()
logger = logging.getLogger(__name__)
AVATAR_SCALE_MIN = 1.0
AVATAR_SCALE_MAX = 3.0
AVATAR_SCALE_DEFAULT = 1.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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
        if not existing_user.display_name:
            existing_user.display_name = build_user_name(normalized_email)
        user = existing_user
    else:
        user = User(
            email=normalized_email,
            password_hash=verification.password_hash,
            display_name=build_user_name(normalized_email),
            auth_provider="email",
        )
        db.add(user)

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

    return issue_auth_response(user)


@router.post("/api/auth/google", response_model=AuthResponse)
def login_with_google(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    allowed_google_client_ids = parse_google_client_ids(settings.google_client_id)
    if not allowed_google_client_ids:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured on server",
        )

    try:
        token_data = google_id_token.verify_oauth2_token(
            payload.id_token,
            google_requests.Request(),
            audience=None,
        )
    except ValueError as exc:
        detail = "Invalid Google token"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail) from exc
    except Exception as exc:  # pragma: no cover - defensive fallback for transport/provider failures
        logger.exception("Google token verification failed")
        detail = "Google auth verification is temporarily unavailable"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc

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

    google_sub = token_data.get("sub")
    display_name = token_data.get("name") or build_user_name(email)
    avatar_url = token_data.get("picture")

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            google_sub=google_sub,
            auth_provider="google",
        )
        db.add(user)
    else:
        user.auth_provider = provider_union(user.auth_provider, "google")
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if display_name and (not user.display_name or user.auth_provider == "google"):
            user.display_name = display_name
        if avatar_url:
            user.avatar_url = avatar_url

    db.commit()
    db.refresh(user)
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
    sync_user_pending_purchases(db, user)
    db.refresh(user)
    return UserOut.model_validate(user)


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
