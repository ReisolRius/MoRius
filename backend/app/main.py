from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import re
import secrets
import smtplib
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import and_, inspect, or_, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, engine, get_db
from app.models import (
    CoinPurchase,
    EmailVerification,
    StoryGame,
    StoryInstructionCard,
    StoryMessage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
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
    StoryGameCreateRequest,
    StoryGameOut,
    StoryGameSummaryOut,
    StoryGenerateRequest,
    StoryInstructionCardCreateRequest,
    StoryInstructionCardInput,
    StoryInstructionCardOut,
    StoryInstructionCardUpdateRequest,
    StoryMessageOut,
    StoryMessageUpdateRequest,
    StoryWorldCardCreateRequest,
    StoryWorldCardChangeEventOut,
    StoryWorldCardOut,
    StoryWorldCardUpdateRequest,
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
STORY_DEFAULT_TITLE = "Новая игра"
STORY_USER_ROLE = "user"
STORY_ASSISTANT_ROLE = "assistant"
STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"
STORY_WORLD_CARD_EVENT_ADDED = "added"
STORY_WORLD_CARD_EVENT_UPDATED = "updated"
STORY_WORLD_CARD_EVENT_DELETED = "deleted"
STORY_WORLD_CARD_EVENT_ACTIONS = {
    STORY_WORLD_CARD_EVENT_ADDED,
    STORY_WORLD_CARD_EVENT_UPDATED,
    STORY_WORLD_CARD_EVENT_DELETED,
}
STORY_WORLD_CARD_MAX_CONTENT_LENGTH = 1_000
STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH = 600
STORY_WORLD_CARD_MAX_AI_CHANGES = 3
STORY_WORLD_CARD_SIGNIFICANT_IMPORTANCE = {"high", "critical"}
STORY_WORLD_CARD_ALLOWED_KINDS = {
    "character",
    "npc",
    "item",
    "artifact",
    "action",
    "event",
    "place",
    "location",
    "faction",
    "organization",
    "quest",
}
STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS = {
    "кофе",
    "чашка",
    "кружка",
    "чай",
    "вода",
    "стол",
    "стул",
    "завтрак",
    "утро",
    "окно",
}
STORY_MATCH_TOKEN_PATTERN = re.compile(r"[0-9a-zа-яё]+", re.IGNORECASE)
GIGACHAT_TOKEN_CACHE: dict[str, Any] = {"access_token": None, "expires_at": None}
GIGACHAT_TOKEN_CACHE_LOCK = Lock()
logger = logging.getLogger(__name__)
STORY_SYSTEM_PROMPT = (
    "Ты мастер интерактивной текстовой RPG (GM/рассказчик). "
    "Отвечай только на русском языке. "
    "Продолжай историю по действиям игрока, а не давай советы и не объясняй правила. "
    "Пиши художественно и атмосферно, от второго лица, с учетом предыдущих сообщений. "
    "Не выходи из роли, не упоминай, что ты ИИ, без мета-комментариев. "
    "Формат: 2-5 абзацев связного повествования. "
    "В конце добавляй краткий крючок-вопрос: что игрок делает дальше."
)

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


def _normalize_story_text(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story text cannot be empty")
    return normalized


def _normalize_story_instruction_title(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Instruction title cannot be empty")
    return normalized


def _normalize_story_instruction_content(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Instruction text cannot be empty")
    return normalized


def _normalize_story_generation_instructions(
    instructions: list[StoryInstructionCardInput],
) -> list[dict[str, str]]:
    normalized_cards: list[dict[str, str]] = []
    for item in instructions:
        title = " ".join(item.title.split()).strip()
        content = item.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        normalized_cards.append({"title": title, "content": content})
    return normalized_cards


def _normalize_story_world_card_title(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card title cannot be empty")
    return normalized


def _normalize_story_world_card_content(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if len(normalized) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card text cannot be empty")
    return normalized


def _normalize_story_world_card_trigger(value: str) -> str:
    normalized = " ".join(value.replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > 80:
        return normalized[:80].rstrip()
    return normalized


def _normalize_story_world_card_triggers(values: list[str], *, fallback_title: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        trigger = _normalize_story_world_card_trigger(raw_value)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    fallback_trigger = _normalize_story_world_card_trigger(fallback_title)
    if fallback_trigger:
        fallback_key = fallback_trigger.casefold()
        if fallback_key not in seen:
            normalized.insert(0, fallback_trigger)

    return normalized[:40]


def _serialize_story_world_card_triggers(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def _deserialize_story_world_card_triggers(raw_value: str) -> list[str]:
    raw = raw_value.strip()
    if not raw:
        return []

    parsed: Any
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = [part.strip() for part in raw.split(",")]

    if not isinstance(parsed, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, str):
            continue
        trigger = _normalize_story_world_card_trigger(item)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    return normalized[:40]


def _normalize_story_world_card_source(value: str) -> str:
    normalized = value.strip().lower()
    if normalized == STORY_WORLD_CARD_SOURCE_AI:
        return STORY_WORLD_CARD_SOURCE_AI
    return STORY_WORLD_CARD_SOURCE_USER


def _story_world_card_to_out(card: StoryWorldCard) -> StoryWorldCardOut:
    return StoryWorldCardOut(
        id=card.id,
        game_id=card.game_id,
        title=card.title,
        content=card.content,
        triggers=_deserialize_story_world_card_triggers(card.triggers),
        source=_normalize_story_world_card_source(card.source),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def _normalize_story_world_card_event_action(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in STORY_WORLD_CARD_EVENT_ACTIONS:
        return normalized
    return ""


def _normalize_story_world_card_changed_text(value: str, *, fallback: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        normalized = fallback.strip()
    if len(normalized) > STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH].rstrip()
    return normalized


def _is_story_world_card_title_mundane(value: str) -> bool:
    tokens = _normalize_story_match_tokens(value)
    if not tokens:
        return False
    if len(tokens) == 1:
        return tokens[0] in STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS
    if len(tokens) == 2:
        return all(token in STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS for token in tokens)
    return False


def _story_world_card_snapshot_from_card(card: StoryWorldCard) -> dict[str, Any]:
    return {
        "id": card.id,
        "title": card.title,
        "content": card.content,
        "triggers": _deserialize_story_world_card_triggers(card.triggers),
        "source": _normalize_story_world_card_source(card.source),
    }


def _serialize_story_world_card_snapshot(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _deserialize_story_world_card_snapshot(raw_value: str | None) -> dict[str, Any] | None:
    if raw_value is None:
        return None
    normalized_raw = raw_value.strip()
    if not normalized_raw:
        return None

    try:
        parsed = json.loads(normalized_raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    title_value = " ".join(str(parsed.get("title", "")).split()).strip()
    content_value = str(parsed.get("content", "")).replace("\r\n", "\n").strip()
    if not title_value or not content_value:
        return None

    if len(title_value) > 120:
        title_value = title_value[:120].rstrip()
    if len(content_value) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
        content_value = content_value[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not title_value or not content_value:
        return None

    raw_triggers = parsed.get("triggers")
    trigger_values: list[str] = []
    if isinstance(raw_triggers, list):
        trigger_values = [item for item in raw_triggers if isinstance(item, str)]
    triggers_value = _normalize_story_world_card_triggers(trigger_values, fallback_title=title_value)
    source_value = _normalize_story_world_card_source(str(parsed.get("source", "")))

    card_id: int | None = None
    raw_id = parsed.get("id")
    if isinstance(raw_id, int) and raw_id > 0:
        card_id = raw_id
    elif isinstance(raw_id, str) and raw_id.strip().isdigit():
        parsed_id = int(raw_id.strip())
        if parsed_id > 0:
            card_id = parsed_id

    return {
        "id": card_id,
        "title": title_value,
        "content": content_value,
        "triggers": triggers_value,
        "source": source_value,
    }


def _story_world_card_change_event_to_out(event: StoryWorldCardChangeEvent) -> StoryWorldCardChangeEventOut:
    return StoryWorldCardChangeEventOut(
        id=event.id,
        game_id=event.game_id,
        assistant_message_id=event.assistant_message_id,
        world_card_id=event.world_card_id,
        action=_normalize_story_world_card_event_action(event.action) or STORY_WORLD_CARD_EVENT_UPDATED,
        title=event.title,
        changed_text=event.changed_text,
        before_snapshot=_deserialize_story_world_card_snapshot(event.before_snapshot),
        after_snapshot=_deserialize_story_world_card_snapshot(event.after_snapshot),
        created_at=event.created_at,
    )


def _normalize_story_match_tokens(value: str) -> list[str]:
    normalized_source = value.lower().replace("ё", "е")
    return [match.group(0) for match in STORY_MATCH_TOKEN_PATTERN.finditer(normalized_source)]


def _is_story_trigger_match(trigger: str, prompt_tokens: list[str]) -> bool:
    trigger_tokens = _normalize_story_match_tokens(trigger)
    if not trigger_tokens:
        return False

    if len(trigger_tokens) == 1:
        trigger_token = trigger_tokens[0]
        if len(trigger_token) < 2:
            return False
        for token in prompt_tokens:
            if token == trigger_token or token.startswith(trigger_token):
                return True
            if len(token) >= 4 and trigger_token.startswith(token):
                return True
        return False

    for trigger_token in trigger_tokens:
        is_token_matched = any(
            token == trigger_token
            or token.startswith(trigger_token)
            or (len(token) >= 4 and trigger_token.startswith(token))
            for token in prompt_tokens
        )
        if not is_token_matched:
            return False
    return True


def _derive_story_title(prompt: str) -> str:
    collapsed = " ".join(prompt.split()).strip()
    if not collapsed:
        return STORY_DEFAULT_TITLE
    if len(collapsed) <= 60:
        return collapsed
    return f"{collapsed[:57].rstrip()}..."


def _touch_story_game(game: StoryGame) -> None:
    game.last_activity_at = _utcnow()


def _get_user_story_game_or_404(db: Session, user_id: int, game_id: int) -> StoryGame:
    game = db.scalar(
        select(StoryGame).where(
            StoryGame.id == game_id,
            StoryGame.user_id == user_id,
        )
    )
    if game:
        return game
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")


def _list_story_messages(db: Session, game_id: int) -> list[StoryMessage]:
    return db.scalars(
        select(StoryMessage).where(StoryMessage.game_id == game_id).order_by(StoryMessage.id.asc())
    ).all()


def _list_story_instruction_cards(db: Session, game_id: int) -> list[StoryInstructionCard]:
    return db.scalars(
        select(StoryInstructionCard)
        .where(StoryInstructionCard.game_id == game_id)
        .order_by(StoryInstructionCard.id.asc())
    ).all()


def _list_story_world_cards(db: Session, game_id: int) -> list[StoryWorldCard]:
    return db.scalars(
        select(StoryWorldCard)
        .where(StoryWorldCard.game_id == game_id)
        .order_by(StoryWorldCard.id.asc())
    ).all()


def _list_story_world_card_events(
    db: Session,
    game_id: int,
    *,
    assistant_message_id: int | None = None,
    include_undone: bool = False,
) -> list[StoryWorldCardChangeEvent]:
    query = select(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == game_id)
    if assistant_message_id is not None:
        query = query.where(StoryWorldCardChangeEvent.assistant_message_id == assistant_message_id)
    if not include_undone:
        query = query.where(StoryWorldCardChangeEvent.undone_at.is_(None))
    query = query.order_by(StoryWorldCardChangeEvent.id.asc())
    return db.scalars(query).all()


def _select_story_world_cards_for_prompt(
    prompt: str,
    world_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    prompt_tokens = _normalize_story_match_tokens(prompt)
    selected_cards: list[dict[str, Any]] = []

    for card in world_cards:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue

        triggers = _deserialize_story_world_card_triggers(card.triggers)
        if not triggers:
            triggers = _normalize_story_world_card_triggers([], fallback_title=title)

        if prompt_tokens:
            is_relevant = any(_is_story_trigger_match(trigger, prompt_tokens) for trigger in triggers)
            if not is_relevant:
                continue

        selected_cards.append(
            {
                "id": card.id,
                "title": title,
                "content": content,
                "triggers": triggers,
                "source": _normalize_story_world_card_source(card.source),
            }
        )
        if len(selected_cards) >= 10:
            break

    return selected_cards


def _build_story_system_prompt(
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
) -> str:
    if not instruction_cards and not world_cards:
        return STORY_SYSTEM_PROMPT

    lines = [STORY_SYSTEM_PROMPT]

    if instruction_cards:
        lines.extend(["", "Пользовательские инструкции для текущей игры:"])
        for index, card in enumerate(instruction_cards, start=1):
            lines.append(f"{index}. {card['title']}: {card['content']}")

    if world_cards:
        lines.extend(["", "Карточки мира, релевантные текущему действию игрока:"])
        for index, card in enumerate(world_cards, start=1):
            lines.append(f"{index}. {card['title']}: {card['content']}")
            trigger_line = ", ".join(card["triggers"]) if card["triggers"] else "нет"
            lines.append(f"Триггеры: {trigger_line}")

    lines.extend(
        [
            "",
            "Следуй инструкциям и карточкам мира молча.",
            "Не перечисляй и не комментируй их в ответе.",
            "Просто продолжай историю в нужной манере.",
        ]
    )
    return "\n".join(lines)


def _validate_story_provider_config() -> None:
    provider = settings.story_llm_provider
    if provider == "mock":
        return

    if provider == "gigachat":
        if settings.gigachat_authorization_key:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GigaChat provider is not configured: set GIGACHAT_AUTHORIZATION_KEY",
        )

    if provider == "openrouter":
        if not settings.openrouter_api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenRouter provider is not configured: set OPENROUTER_API_KEY",
            )
        if not settings.openrouter_model:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenRouter provider is not configured: set OPENROUTER_MODEL",
            )
        return

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Unsupported STORY_LLM_PROVIDER: {provider}",
    )


def _build_mock_story_response(prompt: str, turn_index: int) -> str:
    prompt_reference = " ".join(prompt.split())
    if len(prompt_reference) > 240:
        prompt_reference = f"{prompt_reference[:237]}..."

    openings = (
        f"Вы делаете шаг: {prompt_reference}. Мир откликается сразу, будто давно ждал именно этого решения.",
        f"Ваше действие звучит уверенно: {prompt_reference}. Несколько фигур в тени одновременно поворачиваются к вам.",
        f"После ваших слов ({prompt_reference}) в зале на миг становится тише, и даже огонь в лампах будто тускнеет.",
    )
    complications = (
        "Слева слышится короткий металлический звон, а впереди кто-то закрывает путь, прищурившись и ожидая вашего следующего шага.",
        "Старый трактирщик быстро уводит взгляд, но едва заметно показывает на узкий проход за стойкой, где обычно никого не бывает.",
        "Из дальнего угла доносится шепот о цене вашей смелости, и становится ясно: назад дорога будет уже не такой простой.",
    )
    outcomes = (
        "У вас появляется шанс выиграть время и подготовить почву для более рискованного хода.",
        "Обстановка сгущается, но инициатива все еще у вас, если действовать точно и без паузы.",
        "Ситуация накаляется, однако именно это может дать вам редкую возможность перехватить контроль.",
    )
    prompts = (
        "Что вы сделаете в первую очередь?",
        "Какой ход выберете дальше?",
        "Каким будет ваш следующий шаг?",
    )

    opening = openings[(turn_index - 1) % len(openings)]
    complication = complications[(len(prompt_reference) + turn_index) % len(complications)]
    outcome = outcomes[(turn_index + len(prompt_reference) * 2) % len(outcomes)]
    follow_up = prompts[(turn_index + len(prompt_reference) * 3) % len(prompts)]

    paragraphs = [opening, complication, outcome, follow_up]
    return "\n\n".join(paragraphs)


def _iter_story_stream_chunks(text_value: str, chunk_size: int = 24) -> list[str]:
    return [text_value[index : index + chunk_size] for index in range(0, len(text_value), chunk_size)]


def _build_story_provider_messages(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
) -> list[dict[str, str]]:
    history = [
        {"role": message.role, "content": message.content.strip()}
        for message in context_messages
        if message.role in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE} and message.content.strip()
    ]
    if len(history) > 24:
        history = history[-24:]

    return [{"role": "system", "content": _build_story_system_prompt(instruction_cards, world_cards)}, *history]


def _extract_text_from_model_content(value: Any) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue

            if not isinstance(item, dict):
                continue

            text_value = item.get("text")
            if isinstance(text_value, str):
                parts.append(text_value)
                continue

            if item.get("type") == "text":
                content_value = item.get("content")
                if isinstance(content_value, str):
                    parts.append(content_value)

        return "".join(parts)

    return ""


def _extract_json_array_from_text(raw_value: str) -> Any:
    normalized = raw_value.strip()
    if not normalized:
        return []

    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        pass

    start_index = normalized.find("[")
    end_index = normalized.rfind("]")
    if start_index >= 0 and end_index > start_index:
        fragment = normalized[start_index : end_index + 1]
        try:
            return json.loads(fragment)
        except json.JSONDecodeError:
            return []

    return []


def _build_story_world_card_extraction_messages(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, str]]:
    existing_titles = [card.title.strip() for card in existing_cards if card.title.strip()]
    existing_titles_preview = ", ".join(existing_titles[:40]) if existing_titles else "нет"
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    if len(prompt_preview) > 1200:
        prompt_preview = f"{prompt_preview[:1197].rstrip()}..."
    if len(assistant_preview) > 5000:
        assistant_preview = f"{assistant_preview[:4997].rstrip()}..."

    return [
        {
            "role": "system",
            "content": (
                "Ты извлекаешь важные сущности мира из художественного фрагмента. "
                "Верни строго JSON-массив без markdown. "
                "Формат элемента: {\"title\": string, \"content\": string, \"triggers\": string[]}. "
                "Добавляй только новые и действительно важные сущности (персонажи, предметы, места, организации). "
                "Максимум 3 элемента. Если добавлять нечего, верни []"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Последний ход игрока:\n{prompt_preview}\n\n"
                f"Ответ мастера:\n{assistant_preview}\n\n"
                f"Уже существующие карточки: {existing_titles_preview}\n\n"
                "Верни только JSON-массив."
            ),
        },
    ]


def _normalize_story_world_card_candidates(
    raw_candidates: Any,
    existing_title_keys: set[str],
) -> list[dict[str, Any]]:
    if not isinstance(raw_candidates, list):
        return []

    normalized_cards: list[dict[str, Any]] = []
    seen_title_keys = set(existing_title_keys)

    for raw_item in raw_candidates:
        if not isinstance(raw_item, dict):
            continue

        title_value = raw_item.get("title")
        content_value = raw_item.get("content")
        if not isinstance(title_value, str) or not isinstance(content_value, str):
            continue

        title = " ".join(title_value.split()).strip()
        content = content_value.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        if len(title) > 120:
            title = title[:120].rstrip()
        if len(content) > 8_000:
            content = content[:8_000].rstrip()
        if not title or not content:
            continue

        title_key = title.casefold()
        if title_key in seen_title_keys:
            continue

        raw_triggers = raw_item.get("triggers")
        trigger_values: list[str] = []
        if isinstance(raw_triggers, list):
            trigger_values = [value for value in raw_triggers if isinstance(value, str)]

        triggers = _normalize_story_world_card_triggers(trigger_values, fallback_title=title)
        normalized_cards.append(
            {
                "title": title,
                "content": content,
                "triggers": triggers,
                "source": STORY_WORLD_CARD_SOURCE_AI,
            }
        )
        seen_title_keys.add(title_key)
        if len(normalized_cards) >= 3:
            break

    return normalized_cards


def _build_story_world_card_change_messages(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, str]]:
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    if len(prompt_preview) > 1200:
        prompt_preview = f"{prompt_preview[:1197].rstrip()}..."
    if len(assistant_preview) > 5200:
        assistant_preview = f"{assistant_preview[:5197].rstrip()}..."

    existing_cards_preview: list[dict[str, Any]] = []
    for card in existing_cards[:120]:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        if len(content) > 320:
            content = f"{content[:317].rstrip()}..."
        existing_cards_preview.append(
            {
                "id": card.id,
                "title": title,
                "content": content,
                "triggers": _deserialize_story_world_card_triggers(card.triggers)[:10],
                "source": _normalize_story_world_card_source(card.source),
            }
        )

    existing_cards_json = json.dumps(existing_cards_preview, ensure_ascii=False)

    return [
        {
            "role": "system",
            "content": (
                "You update long-term world memory for an interactive RPG session. "
                "Return strict JSON array without markdown.\n"
                "Each item format:\n"
                "{"
                "\"action\":\"add|update|delete\","
                "\"card_id\": number optional,"
                "\"title\": string optional,"
                "\"content\": string optional,"
                "\"triggers\": string[] optional,"
                "\"changed_text\": string optional,"
                "\"importance\":\"critical|high|medium|low\","
                "\"kind\":\"character|npc|item|artifact|action|event|place|location|faction|organization|quest\""
                "}.\n"
                "Rules:\n"
                "1) Keep only significant details that matter in future turns.\n"
                "2) Ignore mundane transient details (food, drinks, coffee, cups, generic furniture, routine background actions).\n"
                "3) Prefer update for existing cards when new important details appear.\n"
                "4) Delete only if a card became invalid/irrelevant.\n"
                "5) For add/update provide full current card text (max 1000 chars) and useful triggers.\n"
                f"6) Return at most {STORY_WORLD_CARD_MAX_AI_CHANGES} operations. Return [] if no important changes."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Player action:\n{prompt_preview}\n\n"
                f"Game master response:\n{assistant_preview}\n\n"
                f"Existing world cards JSON:\n{existing_cards_json}\n\n"
                "Return JSON array only."
            ),
        },
    ]


def _extract_story_world_card_operation_target(
    raw_item: dict[str, Any],
    existing_by_id: dict[int, StoryWorldCard],
    existing_by_title: dict[str, StoryWorldCard],
) -> StoryWorldCard | None:
    raw_card_id = raw_item.get("card_id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        card = existing_by_id.get(raw_card_id)
        if card is not None:
            return card
    elif isinstance(raw_card_id, str) and raw_card_id.strip().isdigit():
        parsed_card_id = int(raw_card_id.strip())
        if parsed_card_id > 0:
            card = existing_by_id.get(parsed_card_id)
            if card is not None:
                return card

    for field_name in ("target_title", "title"):
        raw_title = raw_item.get(field_name)
        if not isinstance(raw_title, str):
            continue
        normalized_title = " ".join(raw_title.split()).strip().casefold()
        if not normalized_title:
            continue
        card = existing_by_title.get(normalized_title)
        if card is not None:
            return card

    return None


def _normalize_story_world_card_change_operations(
    raw_operations: Any,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if isinstance(raw_operations, dict):
        raw_nested_operations = raw_operations.get("changes")
        if not isinstance(raw_nested_operations, list):
            raw_nested_operations = raw_operations.get("operations")
        raw_operations = raw_nested_operations
    if not isinstance(raw_operations, list):
        return []

    existing_by_id = {card.id: card for card in existing_cards}
    existing_by_title = {
        " ".join(card.title.split()).strip().casefold(): card
        for card in existing_cards
        if " ".join(card.title.split()).strip()
    }

    normalized_operations: list[dict[str, Any]] = []
    seen_target_ids: set[int] = set()
    seen_added_title_keys: set[str] = set()

    for raw_item in raw_operations:
        if not isinstance(raw_item, dict):
            continue

        action = _normalize_story_world_card_event_action(str(raw_item.get("action", "")))
        if not action:
            continue

        importance = str(raw_item.get("importance", "high")).strip().lower()
        if importance and importance not in STORY_WORLD_CARD_SIGNIFICANT_IMPORTANCE:
            continue

        kind = str(raw_item.get("kind", "")).strip().lower()
        if kind and kind not in STORY_WORLD_CARD_ALLOWED_KINDS:
            continue

        target_card = _extract_story_world_card_operation_target(raw_item, existing_by_id, existing_by_title)
        raw_changed_text = raw_item.get("changed_text")
        changed_text_source = raw_changed_text if isinstance(raw_changed_text, str) else ""

        title = ""
        content = ""
        triggers: list[str] = []

        if action in {STORY_WORLD_CARD_EVENT_ADDED, STORY_WORLD_CARD_EVENT_UPDATED}:
            raw_title = raw_item.get("title")
            raw_content = raw_item.get("content")
            if not isinstance(raw_title, str) or not isinstance(raw_content, str):
                continue
            title = " ".join(raw_title.split()).strip()
            content = raw_content.replace("\r\n", "\n").strip()
            if len(title) > 120:
                title = title[:120].rstrip()
            if len(content) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
                content = content[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
            if not title or not content:
                continue

            raw_triggers = raw_item.get("triggers")
            trigger_values: list[str] = []
            if isinstance(raw_triggers, list):
                trigger_values = [item for item in raw_triggers if isinstance(item, str)]
            triggers = _normalize_story_world_card_triggers(trigger_values, fallback_title=title)

            title_key = title.casefold()
            if _is_story_world_card_title_mundane(title) and importance != "critical":
                continue

            if action == STORY_WORLD_CARD_EVENT_ADDED and target_card is None:
                target_card = existing_by_title.get(title_key)
                if target_card is not None:
                    action = STORY_WORLD_CARD_EVENT_UPDATED

            if action == STORY_WORLD_CARD_EVENT_ADDED:
                if title_key in seen_added_title_keys:
                    continue
                changed_text = _normalize_story_world_card_changed_text(
                    changed_text_source,
                    fallback=content,
                )
                normalized_operations.append(
                    {
                        "action": STORY_WORLD_CARD_EVENT_ADDED,
                        "title": title,
                        "content": content,
                        "triggers": triggers,
                        "changed_text": changed_text,
                    }
                )
                seen_added_title_keys.add(title_key)
                if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                    break
                continue

        if action == STORY_WORLD_CARD_EVENT_UPDATED:
            if target_card is None:
                continue
            if target_card.id in seen_target_ids:
                continue
            if not title or not content:
                continue
            if _is_story_world_card_title_mundane(title) and importance != "critical":
                continue

            current_title = " ".join(target_card.title.split()).strip()
            current_content = target_card.content.replace("\r\n", "\n").strip()
            current_triggers = _deserialize_story_world_card_triggers(target_card.triggers)
            if title == current_title and content == current_content and triggers == current_triggers:
                continue

            changed_text = _normalize_story_world_card_changed_text(
                changed_text_source,
                fallback=f"Обновлены важные детали: {title}",
            )
            normalized_operations.append(
                {
                    "action": STORY_WORLD_CARD_EVENT_UPDATED,
                    "world_card_id": target_card.id,
                    "title": title,
                    "content": content,
                    "triggers": triggers,
                    "changed_text": changed_text,
                }
            )
            seen_target_ids.add(target_card.id)
            if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                break
            continue

        if action == STORY_WORLD_CARD_EVENT_DELETED:
            if target_card is None:
                continue
            if target_card.id in seen_target_ids:
                continue
            if target_card.source != STORY_WORLD_CARD_SOURCE_AI:
                continue
            changed_text = _normalize_story_world_card_changed_text(
                changed_text_source,
                fallback=f"Карточка удалена как неактуальная: {target_card.title}",
            )
            normalized_operations.append(
                {
                    "action": STORY_WORLD_CARD_EVENT_DELETED,
                    "world_card_id": target_card.id,
                    "title": target_card.title,
                    "changed_text": changed_text,
                }
            )
            seen_target_ids.add(target_card.id)
            if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                break

    return normalized_operations


def _request_openrouter_world_card_candidates(messages_payload: list[dict[str, str]]) -> Any:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    candidate_models = [settings.openrouter_model]
    if settings.openrouter_model != "openrouter/free":
        candidate_models.append("openrouter/free")

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        payload = {
            "model": model_name,
            "messages": messages_payload,
            "stream": False,
            "temperature": 0.1,
        }
        try:
            response = requests.post(
                settings.openrouter_chat_url,
                headers=headers,
                json=payload,
                timeout=(20, 60),
            )
        except requests.RequestException as exc:
            raise RuntimeError("Failed to reach OpenRouter extraction endpoint") from exc

        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                error_value = error_payload.get("error")
                if isinstance(error_value, dict):
                    detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                elif isinstance(error_value, str):
                    detail = error_value.strip()
                if not detail:
                    detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

            error_text = f"OpenRouter extraction error ({response.status_code})"
            if detail:
                error_text = f"{error_text}: {detail}"

            if response.status_code in {402, 404, 429, 503} and model_name != candidate_models[-1]:
                last_error = RuntimeError(error_text)
                continue
            raise RuntimeError(error_text)

        try:
            payload_value = response.json()
        except ValueError as exc:
            raise RuntimeError("OpenRouter extraction returned invalid payload") from exc

        if not isinstance(payload_value, dict):
            return []
        choices = payload_value.get("choices")
        if not isinstance(choices, list) or not choices:
            return []
        choice = choices[0] if isinstance(choices[0], dict) else {}
        message_value = choice.get("message")
        if not isinstance(message_value, dict):
            return []
        raw_content = _extract_text_from_model_content(message_value.get("content"))
        return _extract_json_array_from_text(raw_content)

    if last_error is not None:
        raise last_error

    return []


def _request_gigachat_world_card_candidates(messages_payload: list[dict[str, str]]) -> Any:
    access_token = _get_gigachat_access_token()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": False,
        "temperature": 0.1,
    }

    try:
        response = requests.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 60),
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat extraction endpoint") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = {}

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        error_text = f"GigaChat extraction error ({response.status_code})"
        if detail:
            error_text = f"{error_text}: {detail}"
        raise RuntimeError(error_text)

    try:
        payload_value = response.json()
    except ValueError as exc:
        raise RuntimeError("GigaChat extraction returned invalid payload") from exc

    if not isinstance(payload_value, dict):
        return []
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return []
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message_value = choice.get("message")
    if not isinstance(message_value, dict):
        return []
    content_value = _extract_text_from_model_content(message_value.get("content"))
    if not content_value:
        return []
    return _extract_json_array_from_text(content_value)


def _generate_story_world_card_change_operations(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if not assistant_text.strip() or len(assistant_text.strip()) < 80:
        return []
    if len(existing_cards) >= 240:
        return []

    messages_payload = _build_story_world_card_change_messages(prompt, assistant_text, existing_cards)

    raw_operations: Any = []
    if settings.story_llm_provider == "openrouter":
        raw_operations = _request_openrouter_world_card_candidates(messages_payload)
    elif settings.story_llm_provider == "gigachat":
        raw_operations = _request_gigachat_world_card_candidates(messages_payload)
    else:
        return []

    return _normalize_story_world_card_change_operations(raw_operations, existing_cards)


def _apply_story_world_card_change_operations(
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    operations: list[dict[str, Any]],
) -> list[StoryWorldCardChangeEvent]:
    if not operations:
        return []

    existing_cards = _list_story_world_cards(db, game.id)
    existing_by_id = {card.id: card for card in existing_cards}
    existing_by_title = {
        " ".join(card.title.split()).strip().casefold(): card
        for card in existing_cards
        if " ".join(card.title.split()).strip()
    }
    events: list[StoryWorldCardChangeEvent] = []

    for operation in operations[:STORY_WORLD_CARD_MAX_AI_CHANGES]:
        action = _normalize_story_world_card_event_action(str(operation.get("action", "")))
        if not action:
            continue

        if action == STORY_WORLD_CARD_EVENT_ADDED:
            title_value = str(operation.get("title", "")).strip()
            content_value = str(operation.get("content", "")).strip()
            triggers_value = operation.get("triggers")
            if not title_value or not content_value or not isinstance(triggers_value, list):
                continue
            card = StoryWorldCard(
                game_id=game.id,
                title=_normalize_story_world_card_title(title_value),
                content=_normalize_story_world_card_content(content_value),
                triggers=_serialize_story_world_card_triggers(
                    _normalize_story_world_card_triggers(
                        [item for item in triggers_value if isinstance(item, str)],
                        fallback_title=title_value,
                    )
                ),
                source=STORY_WORLD_CARD_SOURCE_AI,
            )
            db.add(card)
            db.flush()

            card_snapshot = _story_world_card_snapshot_from_card(card)
            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=card.content,
            )
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_ADDED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=None,
                after_snapshot=_serialize_story_world_card_snapshot(card_snapshot),
            )
            db.add(event)
            events.append(event)
            existing_by_id[card.id] = card
            existing_by_title[card.title.casefold()] = card
            continue

        raw_world_card_id = operation.get("world_card_id")
        if not isinstance(raw_world_card_id, int):
            continue
        card = existing_by_id.get(raw_world_card_id)
        if card is None:
            continue

        if action == STORY_WORLD_CARD_EVENT_UPDATED:
            before_snapshot = _story_world_card_snapshot_from_card(card)
            previous_title_key = card.title.casefold()
            title_value = str(operation.get("title", "")).strip()
            content_value = str(operation.get("content", "")).strip()
            triggers_value = operation.get("triggers")
            if not title_value or not content_value or not isinstance(triggers_value, list):
                continue

            card.title = _normalize_story_world_card_title(title_value)
            card.content = _normalize_story_world_card_content(content_value)
            card.triggers = _serialize_story_world_card_triggers(
                _normalize_story_world_card_triggers(
                    [item for item in triggers_value if isinstance(item, str)],
                    fallback_title=title_value,
                )
            )
            card.source = STORY_WORLD_CARD_SOURCE_AI
            db.flush()

            after_snapshot = _story_world_card_snapshot_from_card(card)
            if before_snapshot == after_snapshot:
                continue

            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=f"Обновлены важные детали: {card.title}",
            )
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_UPDATED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=_serialize_story_world_card_snapshot(before_snapshot),
                after_snapshot=_serialize_story_world_card_snapshot(after_snapshot),
            )
            db.add(event)
            events.append(event)
            existing_by_title.pop(previous_title_key, None)
            existing_by_title[card.title.casefold()] = card
            continue

        if action == STORY_WORLD_CARD_EVENT_DELETED:
            before_snapshot = _story_world_card_snapshot_from_card(card)
            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=f"Карточка удалена как неактуальная: {card.title}",
            )
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_DELETED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=_serialize_story_world_card_snapshot(before_snapshot),
                after_snapshot=None,
            )
            db.add(event)
            events.append(event)
            existing_by_id.pop(card.id, None)
            existing_by_title.pop(card.title.casefold(), None)
            db.delete(card)
            db.flush()

    if not events:
        return []

    _touch_story_game(game)
    db.commit()
    for event in events:
        db.refresh(event)

    return events


def _persist_generated_story_world_cards(
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    prompt: str,
    assistant_text: str,
) -> list[StoryWorldCardChangeEvent]:
    existing_cards = _list_story_world_cards(db, game.id)
    try:
        operations = _generate_story_world_card_change_operations(
            prompt=prompt,
            assistant_text=assistant_text,
            existing_cards=existing_cards,
        )
    except Exception as exc:
        logger.warning("World card extraction failed: %s", exc)
        return []

    try:
        return _apply_story_world_card_change_operations(
            db=db,
            game=game,
            assistant_message=assistant_message,
            operations=operations,
        )
    except Exception as exc:
        logger.warning("World card persistence failed: %s", exc)
        return []


def _restore_story_world_card_from_snapshot(
    db: Session,
    game_id: int,
    snapshot: dict[str, Any] | None,
) -> StoryWorldCard | None:
    if snapshot is None:
        return None

    title = str(snapshot.get("title", "")).strip()
    content = str(snapshot.get("content", "")).strip()
    if not title or not content:
        return None

    source = _normalize_story_world_card_source(str(snapshot.get("source", "")))
    raw_triggers = snapshot.get("triggers")
    trigger_values: list[str] = []
    if isinstance(raw_triggers, list):
        trigger_values = [value for value in raw_triggers if isinstance(value, str)]
    triggers = _normalize_story_world_card_triggers(trigger_values, fallback_title=title)

    card_id: int | None = None
    raw_card_id = snapshot.get("id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        card_id = raw_card_id

    world_card: StoryWorldCard | None = None
    if card_id is not None:
        world_card = db.scalar(
            select(StoryWorldCard).where(
                StoryWorldCard.id == card_id,
                StoryWorldCard.game_id == game_id,
            )
        )

    if world_card is None:
        world_card = StoryWorldCard(
            game_id=game_id,
            title=_normalize_story_world_card_title(title),
            content=_normalize_story_world_card_content(content),
            triggers=_serialize_story_world_card_triggers(triggers),
            source=source,
        )
        db.add(world_card)
        db.flush()
        return world_card

    world_card.title = _normalize_story_world_card_title(title)
    world_card.content = _normalize_story_world_card_content(content)
    world_card.triggers = _serialize_story_world_card_triggers(triggers)
    world_card.source = source
    db.flush()
    return world_card


def _undo_story_world_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryWorldCardChangeEvent,
) -> None:
    if event.undone_at is not None:
        return

    action = _normalize_story_world_card_event_action(event.action)
    if not action:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    before_snapshot = _deserialize_story_world_card_snapshot(event.before_snapshot)
    after_snapshot = _deserialize_story_world_card_snapshot(event.after_snapshot)

    if action == STORY_WORLD_CARD_EVENT_ADDED:
        target_card_id = event.world_card_id
        if target_card_id is None and after_snapshot is not None:
            raw_snapshot_id = after_snapshot.get("id")
            if isinstance(raw_snapshot_id, int) and raw_snapshot_id > 0:
                target_card_id = raw_snapshot_id

        if target_card_id is not None:
            world_card = db.scalar(
                select(StoryWorldCard).where(
                    StoryWorldCard.id == target_card_id,
                    StoryWorldCard.game_id == game.id,
                )
            )
            if world_card is not None:
                db.delete(world_card)
                db.flush()
    elif action in {STORY_WORLD_CARD_EVENT_UPDATED, STORY_WORLD_CARD_EVENT_DELETED}:
        restored_card = _restore_story_world_card_from_snapshot(db, game.id, before_snapshot)
        if restored_card is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot restore world card state for this event",
            )
        event.world_card_id = restored_card.id
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    event.undone_at = _utcnow()
    _touch_story_game(game)
    db.commit()
    db.refresh(event)


def _normalize_basic_auth_header(raw_value: str) -> str:
    normalized = raw_value.strip()
    if not normalized:
        raise RuntimeError("GIGACHAT_AUTHORIZATION_KEY is missing")
    if normalized.lower().startswith("basic "):
        return normalized
    return f"Basic {normalized}"


def _get_gigachat_access_token() -> str:
    now = _utcnow()
    with GIGACHAT_TOKEN_CACHE_LOCK:
        cached_token = GIGACHAT_TOKEN_CACHE.get("access_token")
        cached_expires_at = GIGACHAT_TOKEN_CACHE.get("expires_at")

    if isinstance(cached_token, str) and cached_token and isinstance(cached_expires_at, datetime):
        if cached_expires_at > now + timedelta(seconds=30):
            return cached_token

    headers = {
        "Authorization": _normalize_basic_auth_header(settings.gigachat_authorization_key),
        "RqUID": str(uuid4()),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"scope": settings.gigachat_scope}

    try:
        response = requests.post(
            settings.gigachat_oauth_url,
            headers=headers,
            data=data,
            timeout=20,
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat OAuth endpoint") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        detail = ""
        if isinstance(payload, dict):
            detail = str(payload.get("error_description") or payload.get("message") or payload.get("error") or "").strip()
        if detail:
            raise RuntimeError(f"GigaChat OAuth error ({response.status_code}): {detail}")
        raise RuntimeError(f"GigaChat OAuth error ({response.status_code})")

    if not isinstance(payload, dict):
        raise RuntimeError("GigaChat OAuth returned invalid payload")

    access_token = str(payload.get("access_token", "")).strip()
    if not access_token:
        raise RuntimeError("GigaChat OAuth response does not contain access_token")

    expires_at_value = payload.get("expires_at")
    expires_at = now + timedelta(minutes=25)
    if isinstance(expires_at_value, int):
        expires_at = datetime.fromtimestamp(expires_at_value / 1000, tz=timezone.utc)
    elif isinstance(expires_at_value, str) and expires_at_value.isdigit():
        expires_at = datetime.fromtimestamp(int(expires_at_value) / 1000, tz=timezone.utc)

    with GIGACHAT_TOKEN_CACHE_LOCK:
        GIGACHAT_TOKEN_CACHE["access_token"] = access_token
        GIGACHAT_TOKEN_CACHE["expires_at"] = expires_at

    return access_token


def _iter_gigachat_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
):
    access_token = _get_gigachat_access_token()
    messages_payload = _build_story_provider_messages(context_messages, instruction_cards, world_cards)
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to GigaChat")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": True,
    }

    try:
        response = requests.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 120),
            stream=True,
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat chat endpoint") from exc

    try:
        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

            if detail:
                raise RuntimeError(f"GigaChat chat error ({response.status_code}): {detail}")
            raise RuntimeError(f"GigaChat chat error ({response.status_code})")

        # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
        response.encoding = "utf-8"
        emitted_delta = False
        for raw_line in response.iter_lines(decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue

            raw_data = line[len("data:") :].strip()
            if raw_data == "[DONE]":
                break

            try:
                chunk_payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            choices = chunk_payload.get("choices")
            if not isinstance(choices, list) or not choices:
                continue

            choice = choices[0] if isinstance(choices[0], dict) else {}
            delta_value = choice.get("delta")
            if isinstance(delta_value, dict):
                content_delta = delta_value.get("content")
                if isinstance(content_delta, str) and content_delta:
                    emitted_delta = True
                    yield content_delta
                    continue

            if emitted_delta:
                continue

            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = message_value.get("content")
                if isinstance(content_value, str) and content_value:
                    for chunk in _iter_story_stream_chunks(content_value):
                        yield chunk
                    break
    finally:
        response.close()


def _iter_openrouter_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
):
    messages_payload = _build_story_provider_messages(context_messages, instruction_cards, world_cards)
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to OpenRouter")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    candidate_models = [settings.openrouter_model]
    if settings.openrouter_model != "openrouter/free":
        candidate_models.append("openrouter/free")

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        payload = {
            "model": model_name,
            "messages": messages_payload,
            "stream": True,
        }

        for attempt_index in range(2):
            try:
                response = requests.post(
                    settings.openrouter_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=(20, 120),
                    stream=True,
                )
            except requests.RequestException as exc:
                raise RuntimeError("Failed to reach OpenRouter chat endpoint") from exc

            try:
                if response.status_code >= 400:
                    detail = ""
                    try:
                        error_payload = response.json()
                    except ValueError:
                        error_payload = {}

                    if isinstance(error_payload, dict):
                        error_value = error_payload.get("error")
                        if isinstance(error_value, dict):
                            detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                            metadata_value = error_value.get("metadata")
                            if isinstance(metadata_value, dict):
                                raw_detail = str(metadata_value.get("raw") or "").strip()
                                if raw_detail:
                                    detail = f"{detail}. {raw_detail}" if detail else raw_detail
                        elif isinstance(error_value, str):
                            detail = error_value.strip()

                        if not detail:
                            detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

                    if response.status_code == 429 and attempt_index == 0:
                        time.sleep(1.1)
                        continue

                    error_text = f"OpenRouter chat error ({response.status_code})"
                    if detail:
                        error_text = f"{error_text}: {detail}"

                    if response.status_code in {404, 429, 503} and model_name != candidate_models[-1]:
                        last_error = RuntimeError(error_text)
                        break

                    raise RuntimeError(error_text)

                # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
                response.encoding = "utf-8"
                emitted_delta = False
                for raw_line in response.iter_lines(decode_unicode=True):
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue

                    raw_data = line[len("data:") :].strip()
                    if raw_data == "[DONE]":
                        break

                    try:
                        chunk_payload = json.loads(raw_data)
                    except json.JSONDecodeError:
                        continue

                    error_value = chunk_payload.get("error")
                    if isinstance(error_value, dict):
                        error_detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                        raise RuntimeError(error_detail or "OpenRouter stream returned an error")
                    if isinstance(error_value, str) and error_value.strip():
                        raise RuntimeError(error_value.strip())

                    choices = chunk_payload.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue

                    choice = choices[0] if isinstance(choices[0], dict) else {}
                    delta_value = choice.get("delta")
                    if isinstance(delta_value, dict):
                        content_delta = _extract_text_from_model_content(delta_value.get("content"))
                        if content_delta:
                            emitted_delta = True
                            yield content_delta
                            continue

                    if emitted_delta:
                        continue

                    message_value = choice.get("message")
                    if isinstance(message_value, dict):
                        content_value = _extract_text_from_model_content(message_value.get("content"))
                        if content_value:
                            for chunk in _iter_story_stream_chunks(content_value):
                                yield chunk
                            break

                return
            finally:
                response.close()

        if model_name == candidate_models[-1] and last_error is not None:
            raise last_error

    if last_error is not None:
        raise last_error

    raise RuntimeError("OpenRouter chat request failed")


def _iter_story_provider_stream_chunks(
    *,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
):
    if settings.story_llm_provider == "gigachat":
        yield from _iter_gigachat_story_stream_chunks(context_messages, instruction_cards, world_cards)
        return
    if settings.story_llm_provider == "openrouter":
        yield from _iter_openrouter_story_stream_chunks(context_messages, instruction_cards, world_cards)
        return

    response_text = _build_mock_story_response(prompt, turn_index)
    for chunk in _iter_story_stream_chunks(response_text):
        yield chunk
        time.sleep(0.05)


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _public_story_error_detail(exc: Exception) -> str:
    detail = str(exc).strip()
    if not detail:
        return "Text generation failed"
    return detail[:500]


def _stream_story_response(
    *,
    db: Session,
    game: StoryGame,
    source_user_message: StoryMessage | None,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
):
    assistant_message = StoryMessage(
        game_id=game.id,
        role=STORY_ASSISTANT_ROLE,
        content="",
    )
    db.add(assistant_message)
    _touch_story_game(game)
    db.commit()
    db.refresh(assistant_message)

    yield _sse_event(
        "start",
        {
            "assistant_message_id": assistant_message.id,
            "user_message_id": source_user_message.id if source_user_message else None,
        },
    )

    produced = ""
    persisted_length = 0
    persist_interval = 220
    aborted = False
    stream_error: str | None = None
    try:
        for chunk in _iter_story_provider_stream_chunks(
            prompt=prompt,
            turn_index=turn_index,
            context_messages=context_messages,
            instruction_cards=instruction_cards,
            world_cards=world_cards,
        ):
            produced += chunk
            if len(produced) - persisted_length >= persist_interval:
                assistant_message.content = produced
                _touch_story_game(game)
                db.commit()
                db.refresh(assistant_message)
                persisted_length = len(produced)
            yield _sse_event("chunk", {"assistant_message_id": assistant_message.id, "delta": chunk})
    except GeneratorExit:
        aborted = True
        raise
    except Exception as exc:
        stream_error = str(exc)
        logger.exception("Story generation failed")
        error_detail = _public_story_error_detail(exc)
        yield _sse_event("error", {"detail": error_detail})
    finally:
        assistant_message.content = produced
        _touch_story_game(game)
        db.commit()
        db.refresh(assistant_message)

    if not aborted and stream_error is None:
        persisted_world_card_events: list[StoryWorldCardChangeEventOut] = []
        try:
            generated_events = _persist_generated_story_world_cards(
                db=db,
                game=game,
                assistant_message=assistant_message,
                prompt=prompt,
                assistant_text=assistant_message.content,
            )
            persisted_world_card_events = [
                _story_world_card_change_event_to_out(event) for event in generated_events if event.undone_at is None
            ]
        except Exception:
            logger.exception("Failed to persist generated world cards")
        yield _sse_event(
            "done",
            {
                "message": {
                    "id": assistant_message.id,
                    "game_id": assistant_message.game_id,
                    "role": assistant_message.role,
                    "content": assistant_message.content,
                    "created_at": assistant_message.created_at.isoformat(),
                    "updated_at": assistant_message.updated_at.isoformat(),
                },
                "world_card_events": [event.model_dump(mode="json") for event in persisted_world_card_events],
            },
        )


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


@app.get("/api/story/games", response_model=list[StoryGameSummaryOut])
def list_story_games(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryGameSummaryOut]:
    user = _get_current_user(db, authorization)
    games = db.scalars(
        select(StoryGame)
        .where(StoryGame.user_id == user.id)
        .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
    ).all()
    return [StoryGameSummaryOut.model_validate(game) for game in games]


@app.post("/api/story/games", response_model=StoryGameSummaryOut)
def create_story_game(
    payload: StoryGameCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = _get_current_user(db, authorization)
    title = payload.title.strip() if payload.title else STORY_DEFAULT_TITLE
    if not title:
        title = STORY_DEFAULT_TITLE

    game = StoryGame(
        user_id=user.id,
        title=title,
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return StoryGameSummaryOut.model_validate(game)


@app.get("/api/story/games/{game_id}", response_model=StoryGameOut)
def get_story_game(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    messages = _list_story_messages(db, game.id)
    instruction_cards = _list_story_instruction_cards(db, game.id)
    world_cards = _list_story_world_cards(db, game.id)
    world_card_events = _list_story_world_card_events(db, game.id)
    return StoryGameOut(
        game=StoryGameSummaryOut.model_validate(game),
        messages=[StoryMessageOut.model_validate(message) for message in messages],
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        world_cards=[_story_world_card_to_out(card) for card in world_cards],
        world_card_events=[_story_world_card_change_event_to_out(event) for event in world_card_events],
    )


@app.get("/api/story/games/{game_id}/instructions", response_model=list[StoryInstructionCardOut])
def list_story_instruction_cards(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryInstructionCardOut]:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    cards = _list_story_instruction_cards(db, game.id)
    return [StoryInstructionCardOut.model_validate(card) for card in cards]


@app.post("/api/story/games/{game_id}/instructions", response_model=StoryInstructionCardOut)
def create_story_instruction_card(
    game_id: int,
    payload: StoryInstructionCardCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionCardOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = StoryInstructionCard(
        game_id=game.id,
        title=_normalize_story_instruction_title(payload.title),
        content=_normalize_story_instruction_content(payload.content),
    )
    db.add(instruction_card)
    _touch_story_game(game)
    db.commit()
    db.refresh(instruction_card)
    return StoryInstructionCardOut.model_validate(instruction_card)


@app.patch("/api/story/games/{game_id}/instructions/{instruction_id}", response_model=StoryInstructionCardOut)
def update_story_instruction_card(
    game_id: int,
    instruction_id: int,
    payload: StoryInstructionCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionCardOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = db.scalar(
        select(StoryInstructionCard).where(
            StoryInstructionCard.id == instruction_id,
            StoryInstructionCard.game_id == game.id,
        )
    )
    if instruction_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction card not found")

    instruction_card.title = _normalize_story_instruction_title(payload.title)
    instruction_card.content = _normalize_story_instruction_content(payload.content)
    _touch_story_game(game)
    db.commit()
    db.refresh(instruction_card)
    return StoryInstructionCardOut.model_validate(instruction_card)


@app.delete("/api/story/games/{game_id}/instructions/{instruction_id}", response_model=MessageResponse)
def delete_story_instruction_card(
    game_id: int,
    instruction_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = db.scalar(
        select(StoryInstructionCard).where(
            StoryInstructionCard.id == instruction_id,
            StoryInstructionCard.game_id == game.id,
        )
    )
    if instruction_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction card not found")

    db.delete(instruction_card)
    _touch_story_game(game)
    db.commit()
    return MessageResponse(message="Instruction card deleted")


@app.get("/api/story/games/{game_id}/world-cards", response_model=list[StoryWorldCardOut])
def list_story_world_cards(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryWorldCardOut]:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    cards = _list_story_world_cards(db, game.id)
    return [_story_world_card_to_out(card) for card in cards]


@app.post("/api/story/games/{game_id}/world-cards", response_model=StoryWorldCardOut)
def create_story_world_card(
    game_id: int,
    payload: StoryWorldCardCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    normalized_title = _normalize_story_world_card_title(payload.title)
    normalized_content = _normalize_story_world_card_content(payload.content)
    normalized_triggers = _normalize_story_world_card_triggers(payload.triggers, fallback_title=normalized_title)

    world_card = StoryWorldCard(
        game_id=game.id,
        title=normalized_title,
        content=normalized_content,
        triggers=_serialize_story_world_card_triggers(normalized_triggers),
        source=STORY_WORLD_CARD_SOURCE_USER,
    )
    db.add(world_card)
    _touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return _story_world_card_to_out(world_card)


@app.patch("/api/story/games/{game_id}/world-cards/{card_id}", response_model=StoryWorldCardOut)
def update_story_world_card(
    game_id: int,
    card_id: int,
    payload: StoryWorldCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")

    normalized_title = _normalize_story_world_card_title(payload.title)
    normalized_content = _normalize_story_world_card_content(payload.content)
    normalized_triggers = _normalize_story_world_card_triggers(payload.triggers, fallback_title=normalized_title)

    world_card.title = normalized_title
    world_card.content = normalized_content
    world_card.triggers = _serialize_story_world_card_triggers(normalized_triggers)
    _touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return _story_world_card_to_out(world_card)


@app.delete("/api/story/games/{game_id}/world-cards/{card_id}", response_model=MessageResponse)
def delete_story_world_card(
    game_id: int,
    card_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")

    db.delete(world_card)
    _touch_story_game(game)
    db.commit()
    return MessageResponse(message="World card deleted")


@app.post("/api/story/games/{game_id}/world-card-events/{event_id}/undo", response_model=MessageResponse)
def undo_story_world_card_event(
    game_id: int,
    event_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    event = db.scalar(
        select(StoryWorldCardChangeEvent).where(
            StoryWorldCardChangeEvent.id == event_id,
            StoryWorldCardChangeEvent.game_id == game.id,
        )
    )
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card event not found")

    _undo_story_world_card_change_event(db, game, event)
    return MessageResponse(message="World card change reverted")


@app.patch("/api/story/games/{game_id}/messages/{message_id}", response_model=StoryMessageOut)
def update_story_message(
    game_id: int,
    message_id: int,
    payload: StoryMessageUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMessageOut:
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    message = db.scalar(
        select(StoryMessage).where(
            StoryMessage.id == message_id,
            StoryMessage.game_id == game.id,
        )
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role != STORY_ASSISTANT_ROLE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only AI messages can be edited")

    message.content = _normalize_story_text(payload.content)
    _touch_story_game(game)
    db.commit()
    db.refresh(message)
    return StoryMessageOut.model_validate(message)


@app.post("/api/story/games/{game_id}/generate")
def generate_story_response(
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    _validate_story_provider_config()
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)
    messages = _list_story_messages(db, game.id)
    instruction_cards = _normalize_story_generation_instructions(payload.instructions)
    world_cards = _list_story_world_cards(db, game.id)
    source_user_message: StoryMessage | None = None

    if payload.reroll_last_response:
        if not messages:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to reroll")

        last_message = messages[-1]
        if last_message.role != STORY_ASSISTANT_ROLE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Last message is not AI-generated")

        source_user_message = next((message for message in reversed(messages[:-1]) if message.role == STORY_USER_ROLE), None)
        if source_user_message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for reroll")

        db.delete(last_message)
        _touch_story_game(game)
        db.commit()
        prompt_text = source_user_message.content
    else:
        if payload.prompt is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt is required")
        prompt_text = _normalize_story_text(payload.prompt)
        source_user_message = StoryMessage(
            game_id=game.id,
            role=STORY_USER_ROLE,
            content=prompt_text,
        )
        db.add(source_user_message)
        if game.title == STORY_DEFAULT_TITLE:
            game.title = _derive_story_title(prompt_text)
        _touch_story_game(game)
        db.commit()
        db.refresh(source_user_message)

    active_world_cards = _select_story_world_cards_for_prompt(prompt_text, world_cards)
    context_messages = _list_story_messages(db, game.id)
    assistant_turn_index = (
        len([message for message in context_messages if message.role == STORY_ASSISTANT_ROLE]) + 1
    )
    stream = _stream_story_response(
        db=db,
        game=game,
        source_user_message=source_user_message,
        prompt=prompt_text,
        turn_index=assistant_turn_index,
        context_messages=context_messages,
        instruction_cards=instruction_cards,
        world_cards=active_world_cards,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
