from __future__ import annotations

import base64
import ipaddress
import secrets
from datetime import datetime, timezone
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CoinPurchase, User
from app.services.concurrency import grant_purchase_coins_once

PAYMENT_PROVIDER = "yookassa"
FINAL_PAYMENT_STATUSES = {"succeeded", "canceled"}
COIN_TOP_UP_PLANS: tuple[dict[str, Any], ...] = (
    {
        "id": "standard",
        "title": "Путник",
        "description": "250 солов",
        "price_rub": 399,
        "coins": 250,
    },
    {
        "id": "pro",
        "title": "Искатель",
        "description": "800 солов",
        "price_rub": 999,
        "coins": 800,
    },
    {
        "id": "mega",
        "title": "Хронист",
        "description": "2500 солов",
        "price_rub": 2890,
        "coins": 2500,
    },
)
COIN_TOP_UP_PLANS_BY_ID = {plan["id"]: plan for plan in COIN_TOP_UP_PLANS}
RECEIPT_ITEM_DESCRIPTION_MAX_LENGTH = 128
DEFAULT_RECEIPT_ITEM_DESCRIPTION = "Top up sols"
YOOKASSA_WEBHOOK_IP_RANGES: tuple[str, ...] = (
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11/32",
    "77.75.156.35/32",
    "77.75.154.128/25",
    "2a02:5180::/32",
)
YOOKASSA_WEBHOOK_IP_NETWORKS = tuple(ipaddress.ip_network(raw_value) for raw_value in YOOKASSA_WEBHOOK_IP_RANGES)

HTTP_SESSION = requests.Session()
HTTP_ADAPTER = HTTPAdapter(
    pool_connections=max(settings.http_pool_connections, 1),
    pool_maxsize=max(settings.http_pool_maxsize, 1),
)
HTTP_SESSION.mount("https://", HTTP_ADAPTER)
HTTP_SESSION.mount("http://", HTTP_ADAPTER)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_payments_configured() -> bool:
    return bool(settings.yookassa_shop_id and settings.yookassa_secret_key and settings.payments_return_url)


def is_yookassa_webhook_token_valid(token: str | None) -> bool:
    configured_token = settings.yookassa_webhook_token
    if not configured_token:
        return True
    if token is None:
        return False
    return secrets.compare_digest(token.strip(), configured_token)


def normalize_webhook_source_ip(raw_source_ip: str | None) -> str | None:
    if raw_source_ip is None:
        return None
    normalized = raw_source_ip.strip()
    if not normalized:
        return None

    # Handle forwarded IPv4 entries like "1.2.3.4:12345".
    if ":" in normalized and normalized.count(":") == 1 and "." in normalized:
        host, _, tail = normalized.partition(":")
        if tail.isdigit():
            normalized = host.strip()

    if normalized.startswith("[") and "]" in normalized:
        normalized = normalized[1 : normalized.index("]")]

    return normalized or None


def is_yookassa_webhook_source_ip_allowed(raw_source_ip: str | None) -> bool:
    source_ip = normalize_webhook_source_ip(raw_source_ip)
    if not source_ip:
        return False
    try:
        parsed_ip = ipaddress.ip_address(source_ip)
    except ValueError:
        return False
    return any(parsed_ip in network for network in YOOKASSA_WEBHOOK_IP_NETWORKS)


def _build_yookassa_auth_header() -> str:
    raw_value = f"{settings.yookassa_shop_id}:{settings.yookassa_secret_key}"
    encoded_value = base64.b64encode(raw_value.encode("utf-8")).decode("ascii")
    return f"Basic {encoded_value}"


def _raise_if_payments_not_configured() -> None:
    if is_payments_configured():
        return
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Оплата пока не настроена на сервере",
    )


def get_coin_plan(plan_id: str) -> dict[str, Any]:
    plan = COIN_TOP_UP_PLANS_BY_ID.get(plan_id)
    if plan:
        return plan
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown sol top-up plan")


def _normalize_receipt_item_description(raw_value: str) -> str:
    compact = " ".join(raw_value.replace("\r", " ").replace("\n", " ").split()).strip()
    if not compact:
        compact = DEFAULT_RECEIPT_ITEM_DESCRIPTION
    if len(compact) > RECEIPT_ITEM_DESCRIPTION_MAX_LENGTH:
        return compact[:RECEIPT_ITEM_DESCRIPTION_MAX_LENGTH]
    return compact


def _build_receipt_payload(plan: dict[str, Any], user: User, amount_value: str) -> dict[str, Any] | None:
    if not settings.yookassa_receipt_enabled:
        return None

    customer_email = str(user.email or "").strip().lower()
    if not customer_email:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments receipt is enabled but user email is missing",
        )

    payment_mode = settings.yookassa_receipt_payment_mode.strip() or "full_payment"
    payment_subject = settings.yookassa_receipt_payment_subject.strip() or "service"
    tax_system_code = settings.yookassa_receipt_tax_system_code
    vat_code = settings.yookassa_receipt_vat_code

    item_description = _normalize_receipt_item_description(
        f"MoRius оплата покупки солов: {plan['title']} ({plan['price_rub']} руб)"
    )
    item_payload: dict[str, Any] = {
        "description": item_description,
        "quantity": "1.00",
        "amount": {
            "value": amount_value,
            "currency": "RUB",
        },
        "vat_code": vat_code,
        "payment_mode": payment_mode,
        "payment_subject": payment_subject,
    }
    receipt_payload: dict[str, Any] = {
        "customer": {
            "email": customer_email,
        },
        "items": [item_payload],
    }
    if 1 <= tax_system_code <= 6:
        receipt_payload["tax_system_code"] = tax_system_code
    return receipt_payload


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
        response = HTTP_SESSION.request(
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


def create_payment_in_provider(plan: dict[str, Any], user: User) -> dict[str, Any]:
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
        "description": f"MoRius оплата покупки солов: {plan['title']} ({plan['price_rub']} руб)",
        "metadata": {
            "app": "morius",
            "user_id": str(user.id),
            "plan_id": str(plan["id"]),
        },
    }
    receipt_payload = _build_receipt_payload(plan, user, amount_value)
    if receipt_payload is not None:
        payment_payload["receipt"] = receipt_payload
    return _perform_yookassa_request(
        "POST",
        "/payments",
        json_payload=payment_payload,
        idempotence_key=idempotence_key,
    )


def fetch_payment_from_provider(payment_id: str) -> dict[str, Any]:
    return _perform_yookassa_request("GET", f"/payments/{payment_id}")


def grant_purchase_coins_once_for_purchase(db: Session, purchase: CoinPurchase, user: User) -> bool:
    if purchase.id is None:
        db.flush()

    return grant_purchase_coins_once(
        db,
        purchase_id=int(purchase.id),
        user_id=int(user.id),
        coins=int(purchase.coins),
        granted_at=_utcnow(),
    )


def sync_purchase_status(
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
    if status_value == "succeeded":
        grant_purchase_coins_once_for_purchase(db, purchase, user)

    db.commit()
    db.refresh(purchase)
    db.refresh(user)


def sync_user_pending_purchases(db: Session, user: User) -> None:
    if not is_payments_configured():
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
            provider_payment_payload = fetch_payment_from_provider(purchase.provider_payment_id)
            sync_purchase_status(
                db=db,
                purchase=purchase,
                user=user,
                provider_payment_payload=provider_payment_payload,
            )
        except HTTPException:
            db.rollback()


def close_http_session() -> None:
    HTTP_SESSION.close()

