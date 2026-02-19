from __future__ import annotations

import base64
import binascii
import math
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from threading import Lock
from typing import Any

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import and_, inspect, or_, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, engine, get_db
from app.models import CoinPurchase, EmailVerification, User
from app.schemas import (
    AvatarUpdateRequest,
    AuthResponse,
    CoinPlanListResponse,
    CoinPlanOut,
    CoinTopUpCreateRequest,
    CoinTopUpCreateResponse,
    CoinTopUpSyncResponse,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    RegisterVerifyRequest,
    UserOut,
)
from app.security import create_access_token, hash_password, safe_decode_access_token, verify_password

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
ALLOWED_AVATAR_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
EMAIL_RESEND_TRACKER: dict[str, datetime] = {}
EMAIL_RESEND_TRACKER_LOCK = Lock()
PAYMENT_PROVIDER = "yookassa"
FINAL_PAYMENT_STATUSES = {"succeeded", "canceled"}
COIN_TOP_UP_PLANS: tuple[dict[str, Any], ...] = (
    {
        "id": "standard",
        "title": "Стандарт",
        "description": "500 монет",
        "price_rub": 50,
        "coins": 500,
    },
    {
        "id": "pro",
        "title": "Про",
        "description": "1500 монет",
        "price_rub": 100,
        "coins": 1500,
    },
    {
        "id": "mega",
        "title": "Мега",
        "description": "5000 монет",
        "price_rub": 200,
        "coins": 5000,
    },
)
COIN_TOP_UP_PLANS_BY_ID = {plan["id"]: plan for plan in COIN_TOP_UP_PLANS}

app = FastAPI(title=settings.app_name, debug=settings.debug)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_user_coins_column_exists() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(User.__tablename__):
        return

    user_columns = {column["name"] for column in inspector.get_columns(User.__tablename__)}
    if "coins" in user_columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0"))


@app.on_event("startup")
def on_startup() -> None:
    if settings.database_url.startswith("sqlite:///"):
        raw_path = settings.database_url.replace("sqlite:///", "")
        if raw_path and raw_path != ":memory:":
            db_path = Path(raw_path).resolve()
            db_path.parent.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)
    _ensure_user_coins_column_exists()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _provider_union(current_provider: str, next_provider: str) -> str:
    providers = {value.strip() for value in current_provider.split("+") if value.strip()}
    providers.add(next_provider)
    return "+".join(sorted(providers))


def _build_user_name(email: str) -> str:
    return email.split("@", maxsplit=1)[0]


def _parse_google_client_ids(raw_value: str) -> set[str]:
    return {item.strip() for item in raw_value.split(",") if item.strip()}


def _is_allowed_google_audience(claim_aud: Any, claim_azp: Any, allowed_client_ids: set[str]) -> bool:
    if isinstance(claim_aud, str) and claim_aud in allowed_client_ids:
        return True

    if isinstance(claim_aud, list):
        if any(isinstance(value, str) and value in allowed_client_ids for value in claim_aud):
            return True

    if isinstance(claim_azp, str) and claim_azp in allowed_client_ids:
        return True

    return False


def _generate_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _get_resend_cooldown_remaining_seconds(email: str, now: datetime) -> int:
    cooldown_seconds = max(settings.email_verification_resend_cooldown_seconds, 0)
    if cooldown_seconds <= 0:
        return 0

    with EMAIL_RESEND_TRACKER_LOCK:
        last_sent_at = EMAIL_RESEND_TRACKER.get(email)

    if last_sent_at is None:
        return 0

    elapsed_seconds = (now - last_sent_at).total_seconds()
    remaining_seconds = max(math.ceil(cooldown_seconds - elapsed_seconds), 0)
    if remaining_seconds > 0:
        return remaining_seconds

    with EMAIL_RESEND_TRACKER_LOCK:
        if EMAIL_RESEND_TRACKER.get(email) == last_sent_at:
            EMAIL_RESEND_TRACKER.pop(email, None)

    return 0


def _mark_verification_code_sent(email: str, now: datetime) -> None:
    if settings.email_verification_resend_cooldown_seconds <= 0:
        return

    with EMAIL_RESEND_TRACKER_LOCK:
        EMAIL_RESEND_TRACKER[email] = now


def _clear_verification_code_cooldown(email: str) -> None:
    with EMAIL_RESEND_TRACKER_LOCK:
        EMAIL_RESEND_TRACKER.pop(email, None)


def _build_mail_from_header_for_email(from_email: str) -> str:
    if settings.smtp_from_name:
        return f"{settings.smtp_from_name} <{from_email}>"
    return from_email


def _build_mail_from_header() -> str:
    return _build_mail_from_header_for_email(settings.smtp_from_email)


def _send_email_verification_code_via_resend(
    *,
    recipient_email: str,
    from_header: str,
    subject: str,
    text_body: str,
) -> None:
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": from_header,
        "to": [recipient_email],
        "subject": subject,
        "text": text_body,
    }

    try:
        response = requests.post(
            settings.resend_api_url,
            json=payload,
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach Resend API") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        if detail:
            raise RuntimeError(f"Resend API error ({response.status_code}): {detail}")
        raise RuntimeError(f"Resend API error ({response.status_code})")


def _send_email_verification_code(recipient_email: str, verification_code: str) -> None:
    ttl_minutes = max(settings.email_verification_code_ttl_minutes, 1)
    message = EmailMessage()
    message["Subject"] = "MoRius: код подтверждения email"
    message["From"] = _build_mail_from_header()
    message["To"] = recipient_email
    message.set_content(
        "Код подтверждения для регистрации в MoRius:\n"
        f"{verification_code}\n\n"
        f"Код действует {ttl_minutes} минут.\n"
        "Если вы не запрашивали код, просто проигнорируйте это письмо."
    )

    if settings.resend_api_key:
        if not settings.resend_from_email:
            raise RuntimeError("RESEND_FROM_EMAIL is required when RESEND_API_KEY is set")

        _send_email_verification_code_via_resend(
            recipient_email=recipient_email,
            from_header=_build_mail_from_header_for_email(settings.resend_from_email),
            subject=str(message["Subject"]),
            text_body=message.get_content(),
        )
        return

    if not settings.smtp_host:
        raise RuntimeError(
            "Email provider is not configured. Set RESEND_API_KEY + RESEND_FROM_EMAIL, "
            "or configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL and SMTP_FROM_NAME."
        )

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.ehlo()
        if settings.smtp_use_tls:
            smtp.starttls()
            smtp.ehlo()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def _normalize_avatar_value(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    cleaned = raw_value.strip()
    if not cleaned:
        return None
    return cleaned


def _validate_avatar_url(avatar_url: str) -> str:
    if avatar_url.startswith(("https://", "http://")):
        if len(avatar_url) > 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Avatar URL is too long",
            )
        return avatar_url

    if not avatar_url.startswith("data:image/") or "," not in avatar_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported avatar format",
        )

    header, payload = avatar_url.split(",", maxsplit=1)
    if ";base64" not in header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported avatar encoding",
        )

    mime_type = header[len("data:") :].split(";", maxsplit=1)[0].lower()
    if mime_type not in ALLOWED_AVATAR_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG, JPEG, WEBP or GIF avatars are supported",
        )

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar payload is not valid base64",
        ) from exc

    if len(raw_bytes) > settings.avatar_max_bytes:
        max_mb = settings.avatar_max_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Avatar is too large. Max size is {max_mb:.1f} MB",
        )

    return avatar_url


def _is_payments_configured() -> bool:
    return bool(settings.yookassa_shop_id and settings.yookassa_secret_key and settings.payments_return_url)


def _build_yookassa_auth_header() -> str:
    raw_value = f"{settings.yookassa_shop_id}:{settings.yookassa_secret_key}"
    encoded_value = base64.b64encode(raw_value.encode("utf-8")).decode("ascii")
    return f"Basic {encoded_value}"


def _raise_if_payments_not_configured() -> None:
    if _is_payments_configured():
        return
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Оплата пока не настроена на сервере",
    )


def _get_coin_plan(plan_id: str) -> dict[str, Any]:
    plan = COIN_TOP_UP_PLANS_BY_ID.get(plan_id)
    if plan:
        return plan
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown coin top-up plan")


def _perform_yookassa_request(
    method: str,
    endpoint: str,
    *,
    json_payload: dict[str, Any] | None = None,
    idempotence_key: str | None = None,
) -> dict[str, Any]:
    _raise_if_payments_not_configured()

    base_url = settings.yookassa_api_url.rstrip("/")
    url = f"{base_url}{endpoint}"
    headers = {
        "Authorization": _build_yookassa_auth_header(),
        "Content-Type": "application/json",
    }
    if idempotence_key:
        headers["Idempotence-Key"] = idempotence_key

    try:
        response = requests.request(
            method=method,
            url=url,
            json=json_payload,
            headers=headers,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider is temporarily unavailable",
        ) from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        detail = "Payment provider request failed"
        if isinstance(payload, dict):
            description = str(payload.get("description", "")).strip()
            code = str(payload.get("code", "")).strip()
            if description:
                detail = f"{detail}: {description}"
            if code and settings.debug:
                detail = f"{detail} ({code})"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider returned invalid response",
        )

    return payload


def _create_payment_in_provider(plan: dict[str, Any], user: User) -> dict[str, Any]:
    idempotence_key = secrets.token_hex(16)
    amount_value = f"{plan['price_rub']:.2f}"
    payment_payload = {
        "amount": {
            "value": amount_value,
            "currency": "RUB",
        },
        "capture": True,
        "confirmation": {
            "type": "redirect",
            "return_url": settings.payments_return_url,
        },
        "description": f"Пополнение монет: {plan['title']} ({plan['coins']} монет)",
        "metadata": {
            "app": "morius",
            "user_id": str(user.id),
            "plan_id": str(plan["id"]),
        },
    }
    return _perform_yookassa_request(
        "POST",
        "/payments",
        json_payload=payment_payload,
        idempotence_key=idempotence_key,
    )


def _fetch_payment_from_provider(payment_id: str) -> dict[str, Any]:
    return _perform_yookassa_request("GET", f"/payments/{payment_id}")


def _sync_purchase_status(
    *,
    db: Session,
    purchase: CoinPurchase,
    user: User,
    provider_payment_payload: dict[str, Any],
) -> None:
    status_value = str(provider_payment_payload.get("status", "")).strip().lower()
    if not status_value:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider response does not include payment status",
        )

    purchase.status = status_value
    if status_value == "succeeded" and purchase.coins_granted_at is None:
        user.coins += purchase.coins
        purchase.coins_granted_at = _utcnow()

    db.commit()
    db.refresh(purchase)
    db.refresh(user)


def _sync_user_pending_purchases(db: Session, user: User) -> None:
    if not _is_payments_configured():
        return

    purchases = db.scalars(
        select(CoinPurchase).where(
            CoinPurchase.user_id == user.id,
            or_(
                CoinPurchase.status.notin_(FINAL_PAYMENT_STATUSES),
                and_(CoinPurchase.status == "succeeded", CoinPurchase.coins_granted_at.is_(None)),
            ),
        )
    ).all()

    for purchase in purchases:
        try:
            provider_payment_payload = _fetch_payment_from_provider(purchase.provider_payment_id)
            _sync_purchase_status(
                db=db,
                purchase=purchase,
                user=user,
                provider_payment_payload=provider_payment_payload,
            )
        except HTTPException:
            db.rollback()


def _issue_auth_response(user: User) -> AuthResponse:
    token = create_access_token(subject=str(user.id))
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    token_prefix = "bearer "
    if not authorization.lower().startswith(token_prefix):
        return None
    return authorization[len(token_prefix) :].strip()


def _get_current_user(
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
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.get(User, int(subject))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


@app.get("/api/health", response_model=MessageResponse)
def health_check() -> MessageResponse:
    return MessageResponse(message="ok")


@app.post("/api/auth/register", response_model=MessageResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> MessageResponse:
    normalized_email = _normalize_email(payload.email)
    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    now = _utcnow()
    max_attempts = max(settings.email_verification_max_attempts, 1)
    cooldown_remaining_seconds = _get_resend_cooldown_remaining_seconds(normalized_email, now)

    if cooldown_remaining_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {cooldown_remaining_seconds} seconds before requesting a new code",
        )

    verification_code = _generate_verification_code()
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
        _send_email_verification_code(normalized_email, verification_code)
    except Exception as exc:
        db.rollback()
        detail = "Failed to send verification email"
        if settings.debug:
            detail = f"{detail}: {exc}"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from exc

    db.commit()
    _mark_verification_code_sent(normalized_email, now=_utcnow())
    return MessageResponse(message="Verification code was sent to email")


@app.post("/api/auth/register/verify", response_model=AuthResponse)
def verify_registration(payload: RegisterVerifyRequest, db: Session = Depends(get_db)) -> AuthResponse:
    normalized_email = _normalize_email(payload.email)
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
        existing_user.auth_provider = _provider_union(existing_user.auth_provider, "email")
        if not existing_user.display_name:
            existing_user.display_name = _build_user_name(normalized_email)
        user = existing_user
    else:
        user = User(
            email=normalized_email,
            password_hash=verification.password_hash,
            display_name=_build_user_name(normalized_email),
            auth_provider="email",
        )
        db.add(user)

    db.delete(verification)
    db.commit()
    db.refresh(user)
    _clear_verification_code_cooldown(normalized_email)
    return _issue_auth_response(user)


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    normalized_email = _normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == normalized_email))

    if not user or not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    return _issue_auth_response(user)


@app.post("/api/auth/google", response_model=AuthResponse)
def login_with_google(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    allowed_google_client_ids = _parse_google_client_ids(settings.google_client_id)
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

    if token_data.get("iss") not in GOOGLE_ISSUERS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google issuer")

    token_aud = token_data.get("aud")
    token_azp = token_data.get("azp")
    if not _is_allowed_google_audience(token_aud, token_azp, allowed_google_client_ids):
        detail = "Google token audience mismatch"
        if settings.debug:
            detail = (
                f"{detail}. token aud={token_aud!r}, azp={token_azp!r}, "
                f"expected one of={sorted(allowed_google_client_ids)!r}"
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    if not token_data.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified")

    email = _normalize_email(token_data.get("email", ""))
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account email is missing")

    google_sub = token_data.get("sub")
    display_name = token_data.get("name") or _build_user_name(email)
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
        user.auth_provider = _provider_union(user.auth_provider, "google")
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if display_name and (not user.display_name or user.auth_provider == "google"):
            user.display_name = display_name
        if avatar_url:
            user.avatar_url = avatar_url

    db.commit()
    db.refresh(user)
    return _issue_auth_response(user)


@app.get("/api/auth/me", response_model=UserOut)
def me(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    user = _get_current_user(db, authorization)
    _sync_user_pending_purchases(db, user)
    db.refresh(user)
    return UserOut.model_validate(user)


@app.patch("/api/auth/me/avatar", response_model=UserOut)
def update_avatar(
    payload: AvatarUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserOut:
    user = _get_current_user(db, authorization)
    avatar_value = _normalize_avatar_value(payload.avatar_url)
    user.avatar_url = _validate_avatar_url(avatar_value) if avatar_value else None

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@app.get("/api/payments/plans", response_model=CoinPlanListResponse)
def get_coin_top_up_plans() -> CoinPlanListResponse:
    return CoinPlanListResponse(
        plans=[
            CoinPlanOut(
                id=str(plan["id"]),
                title=str(plan["title"]),
                description=str(plan["description"]),
                price_rub=int(plan["price_rub"]),
                coins=int(plan["coins"]),
            )
            for plan in COIN_TOP_UP_PLANS
        ]
    )


@app.post("/api/payments/create", response_model=CoinTopUpCreateResponse)
def create_coin_top_up_payment(
    payload: CoinTopUpCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CoinTopUpCreateResponse:
    user = _get_current_user(db, authorization)
    plan = _get_coin_plan(payload.plan_id)
    provider_payment_payload = _create_payment_in_provider(plan, user)

    provider_payment_id = str(provider_payment_payload.get("id", "")).strip()
    if not provider_payment_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider did not return payment id",
        )

    provider_status = str(provider_payment_payload.get("status", "pending")).strip().lower() or "pending"
    confirmation_payload = provider_payment_payload.get("confirmation")
    confirmation_url = ""
    if isinstance(confirmation_payload, dict):
        confirmation_url = str(confirmation_payload.get("confirmation_url", "")).strip()

    if not confirmation_url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider did not return confirmation url",
        )

    purchase = db.scalar(select(CoinPurchase).where(CoinPurchase.provider_payment_id == provider_payment_id))
    if purchase is None:
        purchase = CoinPurchase(
            user_id=user.id,
            provider=PAYMENT_PROVIDER,
            provider_payment_id=provider_payment_id,
            plan_id=str(plan["id"]),
            plan_title=str(plan["title"]),
            amount_rub=int(plan["price_rub"]),
            coins=int(plan["coins"]),
            status=provider_status,
            confirmation_url=confirmation_url,
        )
        db.add(purchase)
    else:
        purchase.user_id = user.id
        purchase.status = provider_status
        purchase.confirmation_url = confirmation_url

    if provider_status == "succeeded" and purchase.coins_granted_at is None:
        user.coins += purchase.coins
        purchase.coins_granted_at = _utcnow()

    db.commit()

    return CoinTopUpCreateResponse(
        payment_id=purchase.provider_payment_id,
        confirmation_url=confirmation_url,
        status=purchase.status,
    )


@app.post("/api/payments/{payment_id}/sync", response_model=CoinTopUpSyncResponse)
def sync_coin_top_up_payment(
    payment_id: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CoinTopUpSyncResponse:
    user = _get_current_user(db, authorization)
    purchase = db.scalar(
        select(CoinPurchase).where(
            CoinPurchase.provider_payment_id == payment_id,
            CoinPurchase.user_id == user.id,
        )
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")

    needs_sync = purchase.status not in FINAL_PAYMENT_STATUSES
    needs_coin_apply = purchase.status == "succeeded" and purchase.coins_granted_at is None
    if needs_sync or needs_coin_apply:
        provider_payment_payload = _fetch_payment_from_provider(payment_id)
        _sync_purchase_status(
            db=db,
            purchase=purchase,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
    else:
        db.refresh(user)

    return CoinTopUpSyncResponse(
        payment_id=purchase.provider_payment_id,
        status=purchase.status,
        coins=purchase.coins,
        user=UserOut.model_validate(user),
    )


@app.post("/api/payments/yookassa/webhook", response_model=MessageResponse)
def yookassa_webhook(payload: dict[str, Any], db: Session = Depends(get_db)) -> MessageResponse:
    if not _is_payments_configured():
        return MessageResponse(message="ignored")

    event = str(payload.get("event", "")).strip().lower()
    payment_payload = payload.get("object")
    if not isinstance(payment_payload, dict):
        return MessageResponse(message="ignored")

    payment_id = str(payment_payload.get("id", "")).strip()
    if not payment_id:
        return MessageResponse(message="ignored")

    purchase = db.scalar(select(CoinPurchase).where(CoinPurchase.provider_payment_id == payment_id))
    if purchase is None:
        return MessageResponse(message="ignored")

    if event and not event.startswith("payment."):
        return MessageResponse(message="ignored")

    user = db.get(User, purchase.user_id)
    if user is None:
        return MessageResponse(message="ignored")

    try:
        provider_payment_payload = _fetch_payment_from_provider(payment_id)
        _sync_purchase_status(
            db=db,
            purchase=purchase,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
    except HTTPException:
        db.rollback()
        return MessageResponse(message="ignored")

    return MessageResponse(message="ok")


@app.post("/api/auth/logout", response_model=MessageResponse)
def logout() -> MessageResponse:
    # JWT is stateless. Frontend should discard the token.
    return MessageResponse(message="ok")
