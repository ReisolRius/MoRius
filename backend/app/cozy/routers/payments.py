from __future__ import annotations

import base64
import logging
import secrets
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cozy.database import get_db
from app.cozy.models import CozyPlayer, CozyPurchase
from app.cozy.schemas import (
    MessageOut,
    PaymentsStatusOut,
    PurchaseCreateIn,
    PurchaseListOut,
    PurchaseOut,
)
from app.cozy.security import current_player
from app.cozy.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

NOT_CONFIGURED_MESSAGE = "Оплата пока не подключена"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(purchase: CozyPurchase) -> PurchaseOut:
    return PurchaseOut(
        id=purchase.id,
        product_id=purchase.product_id,
        gems=purchase.gems,
        amount_roubles=purchase.amount_roubles,
        status=purchase.status,
        confirmation_url=purchase.confirmation_url,
    )


def _auth_header() -> str:
    raw = f"{settings.yookassa_shop_id}:{settings.yookassa_secret_key}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _provider_request(method: str, path: str, *, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Authorization": _auth_header(), "Content-Type": "application/json"}
    if method.upper() == "POST":
        # ЮKassa deduplicates on this, which is what stops a retried request from charging twice.
        headers["Idempotence-Key"] = secrets.token_hex(16)

    try:
        response = requests.request(
            method,
            f"{settings.yookassa_api_url.rstrip('/')}{path}",
            json=json_body,
            headers=headers,
            timeout=(5, 20),
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Касса недоступна") from exc

    payload = {}
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        logger.error("Cozy: yookassa %s %s -> %s %s", method, path, response.status_code, payload)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Касса отказала")

    return payload if isinstance(payload, dict) else {}


def _mark_paid(db: Session, purchase: CozyPurchase) -> None:
    if purchase.status in {"paid", "granted"}:
        return
    purchase.status = "paid"
    purchase.paid_at = _now()
    db.commit()


@router.get("/api/cozy/payments/done", include_in_schema=False)
def payment_done() -> HTMLResponse:
    """Where ЮKassa drops the browser after the money moves.

    It grants nothing and checks nothing - the phone collects the purchase itself the moment it
    comes back into focus, and a page that handed anything over would be a page anybody can
    refresh. All it has to do is not be a 404 at the end of a payment.
    """
    return HTMLResponse(
        """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cozy Village</title>
<style>
 body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
        background:#f6ead3; color:#4a3a28; font:16px/1.5 system-ui,-apple-system,sans-serif; }
 .card { max-width:420px; padding:32px 28px; text-align:center; background:#fdf6e8;
         border-radius:22px; box-shadow:0 10px 30px rgba(74,58,40,.18); }
 h1 { font-size:22px; margin:0 0 10px; }
 p { margin:0; opacity:.8; }
</style></head><body><div class="card"><h1>Спасибо!</h1>
<p>Вернитесь в Cozy Village — покупка появится в игре.</p></div></body></html>"""
    )


@router.get("/api/cozy/payments/status", response_model=PaymentsStatusOut)
def payments_status() -> PaymentsStatusOut:
    """Whether there is a till behind the shop yet.

    The game asks this before it draws the buy buttons, so that "not connected" is a sentence on
    the card rather than a tap that does nothing. A shop that silently ignores a purchase is the
    single worst thing a shop can do.
    """
    return PaymentsStatusOut(
        configured=settings.payments_configured,
        provider="yookassa",
        message="" if settings.payments_configured else NOT_CONFIGURED_MESSAGE,
    )


@router.post("/api/cozy/payments/create", response_model=PurchaseOut)
def create_purchase(
    payload: PurchaseCreateIn,
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> PurchaseOut:
    """Opens a payment and hands back the page to send the player to.

    The row is written before the provider is called and the provider is called before anything is
    handed over, so every state this can stop in is a state that can be reconciled later: a row
    with no payment id was never charged, and a payment id with no grant is what /sync and the
    webhook are for.
    """
    if not settings.payments_configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_CONFIGURED_MESSAGE)

    purchase = CozyPurchase(
        player_id=player.id,
        product_id=payload.product_id,
        gems=payload.gems,
        amount_roubles=payload.amount_roubles,
        status="created",
    )
    db.add(purchase)
    db.commit()
    db.refresh(purchase)

    provider_payment = _provider_request(
        "POST",
        "/payments",
        json_body={
            "amount": {"value": f"{payload.amount_roubles}.00", "currency": "RUB"},
            "capture": True,
            "confirmation": {"type": "redirect", "return_url": settings.yookassa_return_url},
            "description": f"Cozy Village: {payload.product_id}",
            "metadata": {"purchase_id": str(purchase.id), "player_id": str(player.id)},
        },
    )

    purchase.provider_payment_id = str(provider_payment.get("id", ""))
    confirmation = provider_payment.get("confirmation")
    if isinstance(confirmation, dict):
        purchase.confirmation_url = str(confirmation.get("confirmation_url", ""))

    if str(provider_payment.get("status", "")) == "succeeded":
        purchase.status = "paid"
        purchase.paid_at = _now()

    db.commit()
    db.refresh(purchase)
    return _serialize(purchase)


@router.post("/api/cozy/payments/{purchase_id}/sync", response_model=PurchaseOut)
def sync_purchase(
    purchase_id: int,
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> PurchaseOut:
    """Asks the provider directly. The backstop for a webhook that never arrived."""
    purchase = db.scalar(
        select(CozyPurchase).where(CozyPurchase.id == purchase_id, CozyPurchase.player_id == player.id)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Покупка не найдена")

    if purchase.status in {"paid", "granted"} or not purchase.provider_payment_id:
        return _serialize(purchase)

    provider_payment = _provider_request("GET", f"/payments/{purchase.provider_payment_id}")
    provider_status = str(provider_payment.get("status", ""))

    if provider_status == "succeeded":
        _mark_paid(db, purchase)
    elif provider_status == "canceled":
        purchase.status = "canceled"
        db.commit()

    db.refresh(purchase)
    return _serialize(purchase)


@router.get("/api/cozy/payments/pending", response_model=PurchaseListOut)
def pending_purchases(
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> PurchaseListOut:
    """Paid for, not yet in the village.

    Gems live in the save on the phone, so the server cannot add them to a column - what it holds
    is the entitlement. The game asks for this on every launch, hands over whatever is here, and
    only then says it has. That is what makes a purchase survive being closed on the payment page,
    losing signal, or reinstalling before the receipt arrived.
    """
    rows = db.scalars(
        select(CozyPurchase)
        .where(CozyPurchase.player_id == player.id, CozyPurchase.status == "paid")
        .order_by(CozyPurchase.id)
    ).all()
    return PurchaseListOut(purchases=[_serialize(row) for row in rows])


@router.post("/api/cozy/payments/{purchase_id}/ack", response_model=PurchaseOut)
def acknowledge_purchase(
    purchase_id: int,
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> PurchaseOut:
    purchase = db.scalar(
        select(CozyPurchase).where(CozyPurchase.id == purchase_id, CozyPurchase.player_id == player.id)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Покупка не найдена")

    if purchase.status == "paid":
        purchase.status = "granted"
        purchase.granted_at = _now()
        db.commit()
        db.refresh(purchase)

    return _serialize(purchase)


@router.post("/api/cozy/payments/yookassa/webhook", response_model=MessageOut)
async def yookassa_webhook(
    request: Request,
    x_cozy_webhook_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageOut:
    """What ЮKassa says when the money actually moves.

    Answers 200 to everything it understands, including events it does not care about: a webhook
    that returns an error gets retried, and a retry storm over a notification we were always going
    to ignore is a self-inflicted outage.
    """
    if settings.yookassa_webhook_token and x_cozy_webhook_token != settings.yookassa_webhook_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bad webhook token")

    try:
        body = await request.json()
    except Exception:
        return MessageOut(message="ignored")

    if not isinstance(body, dict):
        return MessageOut(message="ignored")

    event = str(body.get("event", ""))
    payment = body.get("object")
    if not isinstance(payment, dict):
        return MessageOut(message="ignored")

    payment_id = str(payment.get("id", ""))
    if not payment_id:
        return MessageOut(message="ignored")

    purchase = db.scalar(select(CozyPurchase).where(CozyPurchase.provider_payment_id == payment_id))
    if purchase is None:
        return MessageOut(message="unknown payment")

    if event == "payment.succeeded":
        _mark_paid(db, purchase)
    elif event == "payment.canceled" and purchase.status == "created":
        purchase.status = "canceled"
        db.commit()

    return MessageOut(message="ok")
