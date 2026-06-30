from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import CoinPurchase, SavedPaymentMethod, Subscription, User
from app.schemas import (
    CoinPlanListResponse,
    CoinPlanOut,
    CoinTopUpCreateRequest,
    CoinTopUpCreateResponse,
    CoinTopUpSyncResponse,
    MessageResponse,
    MockSubscriptionCreateRequest,
    SavedPaymentMethodListResponse,
    SavedPaymentMethodOut,
    SubscriptionCheckoutRequest,
    SubscriptionCheckoutResponse,
    SubscriptionCreateResponse,
    SubscriptionListResponse,
    SubscriptionOut,
    SubscriptionPlanListResponse,
    SubscriptionPlanOut,
    UserOut,
)
from app.services.auth_identity import (
    get_current_user,
    serialize_user_out,
    user_has_admin_panel_access,
)
from app.services.payments import (
    COIN_TOP_UP_PLANS,
    FINAL_PAYMENT_STATUSES,
    PAYMENT_PROVIDER,
    SUBSCRIPTION_PERIOD_DAYS,
    SUBSCRIPTION_PLANS,
    charge_due_subscriptions,
    create_payment_in_provider,
    create_subscription_payment_in_provider,
    detect_card_brand,
    fetch_payment_from_provider,
    get_coin_plan,
    get_subscription_plan,
    grant_purchase_and_referral_rewards_once_for_purchase,
    is_payments_configured,
    is_subscriptions_enabled,
    is_yookassa_webhook_source_ip_allowed,
    is_yookassa_webhook_token_valid,
    parse_card_expiry,
    sync_purchase_status,
    sync_subscription_status,
    sync_user_pending_subscriptions,
)
from app.services.referrals import get_referred_reward_amount_for_purchase


def _serialize_subscription(db: Session, subscription: Subscription) -> SubscriptionOut:
    card_title: str | None = None
    if subscription.payment_method_id is not None:
        method = db.get(SavedPaymentMethod, subscription.payment_method_id)
        if method is not None:
            card_title = method.title
    return SubscriptionOut(
        id=subscription.id,
        plan_id=subscription.plan_id,
        plan_title=subscription.plan_title,
        price_rub=subscription.price_rub,
        status=subscription.status,
        started_at=subscription.started_at,
        next_charge_at=subscription.next_charge_at,
        canceled_at=subscription.canceled_at,
        is_mock=bool(subscription.is_mock),
        card_title=card_title,
    )

# Card networks used to label demonstration cards before real subscriptions go live.
_DEMO_CARD_TYPES: tuple[tuple[str, str], ...] = (
    ("MasterCard", "5555"),
    ("Visa", "4242"),
    ("МИР", "2204"),
)

router = APIRouter()


@router.get("/api/payments/plans", response_model=CoinPlanListResponse)
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


@router.get("/api/payments/subscription-plans", response_model=SubscriptionPlanListResponse)
def get_subscription_plans() -> SubscriptionPlanListResponse:
    return SubscriptionPlanListResponse(
        plans=[
            SubscriptionPlanOut(
                id=str(plan["id"]),
                title=str(plan["title"]),
                subtitle=str(plan["subtitle"]),
                price_rub=int(plan["price_rub"]),
                period=str(plan["period"]),
                monthly_coins=int(plan["monthly_coins"]),
                models=[str(model) for model in plan.get("models", [])],
                daily_turn_limit=int(plan.get("daily_turn_limit", 0)),
                memory_token_cap=int(plan.get("memory_token_cap", 0)),
                perks=[str(perk) for perk in plan["perks"]],
                badge=(str(plan["badge"]) if plan.get("badge") else None),
            )
            for plan in SUBSCRIPTION_PLANS
        ],
        enabled=is_subscriptions_enabled(),
    )


@router.get("/api/payments/methods", response_model=SavedPaymentMethodListResponse)
def list_saved_payment_methods(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SavedPaymentMethodListResponse:
    user = get_current_user(db, authorization)
    methods = db.scalars(
        select(SavedPaymentMethod)
        .where(SavedPaymentMethod.user_id == user.id)
        .order_by(SavedPaymentMethod.is_default.desc(), SavedPaymentMethod.created_at.desc())
    ).all()
    return SavedPaymentMethodListResponse(
        methods=[SavedPaymentMethodOut.model_validate(method) for method in methods],
        subscriptions_enabled=is_subscriptions_enabled(),
    )


@router.post("/api/payments/methods/demo", response_model=SavedPaymentMethodOut)
def create_demo_payment_method(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SavedPaymentMethodOut:
    """Create a demonstration saved card.

    Staff-only. Lets an administrator populate the card-management screen so the
    card-unbinding flow can be captured for ЮKassa moderation before real
    recurring payments are switched on. Demo cards never charge anyone.
    """
    user = get_current_user(db, authorization)
    if not user_has_admin_panel_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or moderator access required")

    card_type, last4 = secrets.choice(_DEMO_CARD_TYPES)
    has_any = db.scalar(
        select(SavedPaymentMethod.id).where(SavedPaymentMethod.user_id == user.id).limit(1)
    )
    method = SavedPaymentMethod(
        user_id=user.id,
        provider=PAYMENT_PROVIDER,
        provider_payment_method_id=f"demo-{secrets.token_hex(8)}",
        title=f"{card_type} •••• {last4}",
        card_type=card_type,
        card_last4=last4,
        card_first6="555555" if card_type == "MasterCard" else "424242",
        expiry_month="12",
        expiry_year="2029",
        is_default=has_any is None,
        is_demo=True,
    )
    db.add(method)
    db.commit()
    db.refresh(method)
    return SavedPaymentMethodOut.model_validate(method)


@router.delete("/api/payments/methods/{method_id}", response_model=MessageResponse)
def delete_saved_payment_method(
    method_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Unbind (forget) a saved card so it is never used for auto-charges again.

    This is the merchant side of the "отвязка карты" scenario required by ЮKassa:
    the stored payment_method_id is deleted and future recurring charges against
    it become impossible.
    """
    user = get_current_user(db, authorization)
    method = db.scalar(
        select(SavedPaymentMethod).where(
            SavedPaymentMethod.id == method_id,
            SavedPaymentMethod.user_id == user.id,
        )
    )
    if method is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment method not found")

    # Unbinding the card stops the NEXT auto-renewal without dropping the subscription: detach the
    # card so any active subscription keeps working until its paid period ends, then simply lapses
    # (no card → renewal can't happen). The user keeps what they already paid for.
    related_subscriptions = db.scalars(
        select(Subscription).where(
            Subscription.payment_method_id == method.id,
            Subscription.status == "active",
        )
    ).all()
    for subscription in related_subscriptions:
        subscription.payment_method_id = None

    was_default = bool(method.is_default)
    db.delete(method)
    db.flush()

    if was_default:
        replacement = db.scalar(
            select(SavedPaymentMethod)
            .where(SavedPaymentMethod.user_id == user.id)
            .order_by(SavedPaymentMethod.created_at.desc())
        )
        if replacement is not None:
            replacement.is_default = True

    db.commit()
    return MessageResponse(message="ok")


@router.get("/api/payments/subscriptions", response_model=SubscriptionListResponse)
def list_subscriptions(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SubscriptionListResponse:
    user = get_current_user(db, authorization)
    # Backstop for the webhook: reconcile any pending first-payments when the shop loads.
    sync_user_pending_subscriptions(db, user)
    subscriptions = db.scalars(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    ).all()
    return SubscriptionListResponse(
        subscriptions=[_serialize_subscription(db, subscription) for subscription in subscriptions]
    )


@router.post("/api/payments/subscriptions/checkout", response_model=SubscriptionCheckoutResponse)
def create_subscription_checkout(
    payload: SubscriptionCheckoutRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SubscriptionCheckoutResponse:
    """Real ЮKassa subscription checkout: create a first payment that saves the card, open a
    pending subscription and return the redirect URL. The subscription is activated on the
    payment.succeeded webhook (or the pending-sync backstop)."""
    user = get_current_user(db, authorization)
    if not is_subscriptions_enabled():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Подписки временно недоступны")
    plan = get_subscription_plan(payload.plan_id)

    provider_payment_payload = create_subscription_payment_in_provider(plan, user)
    provider_payment_id = str(provider_payment_payload.get("id", "")).strip()
    if not provider_payment_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Payment provider did not return payment id")
    provider_status = str(provider_payment_payload.get("status", "pending")).strip().lower() or "pending"
    confirmation_payload = provider_payment_payload.get("confirmation")
    confirmation_url = ""
    if isinstance(confirmation_payload, dict):
        confirmation_url = str(confirmation_payload.get("confirmation_url", "")).strip()
    if not confirmation_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Payment provider did not return confirmation url")

    subscription = db.scalar(
        select(Subscription).where(Subscription.provider_payment_id == provider_payment_id)
    )
    if subscription is None:
        subscription = Subscription(
            user_id=user.id,
            plan_id=str(plan["id"]),
            plan_title=str(plan["title"]),
            price_rub=int(plan["price_rub"]),
            provider_payment_id=provider_payment_id,
            status="pending",
            is_mock=False,
        )
        db.add(subscription)
    db.flush()

    # If the gateway already settled synchronously, activate immediately.
    if provider_status in {"succeeded", "canceled"}:
        sync_subscription_status(
            db=db,
            subscription=subscription,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
    else:
        db.commit()
    db.refresh(subscription)

    return SubscriptionCheckoutResponse(
        payment_id=provider_payment_id,
        confirmation_url=confirmation_url,
        status=subscription.status,
        subscription_id=int(subscription.id),
    )


@router.post("/api/payments/subscriptions/{payment_id}/sync", response_model=SubscriptionCreateResponse)
def sync_subscription_payment(
    payment_id: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SubscriptionCreateResponse:
    """Reconcile a subscription payment after the ЮKassa redirect back to the app."""
    user = get_current_user(db, authorization)
    subscription = db.scalar(
        select(Subscription).where(
            Subscription.provider_payment_id == payment_id,
            Subscription.user_id == user.id,
        )
    )
    if subscription is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")
    if subscription.status == "pending":
        provider_payment_payload = fetch_payment_from_provider(payment_id)
        sync_subscription_status(
            db=db,
            subscription=subscription,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
    method_out = SavedPaymentMethodOut(
        id=0, title="", card_type="", card_last4="", expiry_month="", expiry_year="",
        is_default=False, is_demo=False, created_at=None,
    )
    if subscription.payment_method_id is not None:
        method = db.get(SavedPaymentMethod, subscription.payment_method_id)
        if method is not None:
            method_out = SavedPaymentMethodOut.model_validate(method)
    return SubscriptionCreateResponse(
        subscription=_serialize_subscription(db, subscription),
        method=method_out,
    )


@router.post("/api/payments/subscriptions/run-recurring", response_model=MessageResponse)
def run_recurring_subscription_charges(
    token: str | None = Query(default=None, alias="token"),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Scheduler entrypoint (cron/worker) for monthly renewals. Protected by a shared secret."""
    configured = settings.payments_recurring_charge_token
    if not configured or not token or token.strip() != configured:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    result = charge_due_subscriptions(db)
    return MessageResponse(message=f"charged={result['charged']} failed={result['failed']} due={result['due']}")


@router.post("/api/payments/subscriptions/mock", response_model=SubscriptionCreateResponse)
def create_mock_subscription(
    payload: MockSubscriptionCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SubscriptionCreateResponse:
    """Administrator-only test checkout: save a card and open an active subscription.

    This grants a real entitlement (unlocked subscription models, daily turns, memory cap) so an
    administrator can fully test how subscriptions behave before players get the live button — and
    it also captures the full flow (card entry → payment → linked card → unbinding) for ЮKassa
    moderation. No real money moves and the full card number is never stored — only the last 4 digits.
    """
    user = get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")

    plan = get_subscription_plan(payload.plan_id)

    digits = "".join(ch for ch in payload.card_number if ch.isdigit())
    if not (12 <= len(digits) <= 19):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный номер карты")
    expiry_month, expiry_year = parse_card_expiry(payload.card_expiry)
    last4 = digits[-4:]
    brand = detect_card_brand(digits)

    has_any = db.scalar(
        select(SavedPaymentMethod.id).where(SavedPaymentMethod.user_id == user.id).limit(1)
    )
    method = SavedPaymentMethod(
        user_id=user.id,
        provider=PAYMENT_PROVIDER,
        provider_payment_method_id=f"mock-{secrets.token_hex(8)}",
        title=f"{brand} •••• {last4}",
        card_type=brand,
        card_last4=last4,
        card_first6=digits[:6],
        expiry_month=expiry_month,
        expiry_year=expiry_year,
        is_default=has_any is None,
        is_demo=True,
    )
    db.add(method)
    db.flush()

    now = datetime.now(timezone.utc)
    subscription = Subscription(
        user_id=user.id,
        plan_id=str(plan["id"]),
        plan_title=str(plan["title"]),
        price_rub=int(plan["price_rub"]),
        status="active",
        payment_method_id=method.id,
        started_at=now,
        next_charge_at=now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
        is_mock=True,
    )
    db.add(subscription)
    db.commit()
    db.refresh(method)
    db.refresh(subscription)

    return SubscriptionCreateResponse(
        subscription=_serialize_subscription(db, subscription),
        method=SavedPaymentMethodOut.model_validate(method),
    )


@router.post("/api/payments/subscriptions/{subscription_id}/cancel", response_model=SubscriptionOut)
def cancel_subscription(
    subscription_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SubscriptionOut:
    user = get_current_user(db, authorization)
    subscription = db.scalar(
        select(Subscription).where(
            Subscription.id == subscription_id,
            Subscription.user_id == user.id,
        )
    )
    if subscription is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")

    if subscription.status == "active":
        subscription.status = "canceled"
        subscription.canceled_at = datetime.now(timezone.utc)
        subscription.next_charge_at = None
        db.commit()
        db.refresh(subscription)

    return _serialize_subscription(db, subscription)


@router.post("/api/payments/create", response_model=CoinTopUpCreateResponse)
def create_coin_top_up_payment(
    payload: CoinTopUpCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CoinTopUpCreateResponse:
    user = get_current_user(db, authorization)
    plan = get_coin_plan(payload.plan_id)
    provider_payment_payload = create_payment_in_provider(plan, user)

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

    db.flush()
    if provider_status == "succeeded":
        grant_purchase_and_referral_rewards_once_for_purchase(db, purchase, user)

    db.commit()
    db.refresh(purchase)
    db.refresh(user)

    return CoinTopUpCreateResponse(
        payment_id=purchase.provider_payment_id,
        confirmation_url=confirmation_url,
        status=purchase.status,
    )


@router.post("/api/payments/{payment_id}/sync", response_model=CoinTopUpSyncResponse)
def sync_coin_top_up_payment(
    payment_id: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CoinTopUpSyncResponse:
    user = get_current_user(db, authorization)
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
    referral_bonus_granted = False
    referral_bonus_amount = 0
    if needs_sync or needs_coin_apply:
        provider_payment_payload = fetch_payment_from_provider(payment_id)
        sync_result = sync_purchase_status(
            db=db,
            purchase=purchase,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
        referral_bonus_granted = sync_result.referral_bonus_granted
        referral_bonus_amount = sync_result.referral_bonus_amount
    else:
        db.refresh(user)

    if (
        not referral_bonus_granted
        and purchase.status == "succeeded"
        and purchase.id is not None
    ):
        existing_referral_bonus_amount = get_referred_reward_amount_for_purchase(
            db,
            purchase_id=int(purchase.id),
            referred_user_id=int(user.id),
        )
        if existing_referral_bonus_amount > 0:
            referral_bonus_granted = True
            referral_bonus_amount = existing_referral_bonus_amount

    return CoinTopUpSyncResponse(
        payment_id=purchase.provider_payment_id,
        status=purchase.status,
        coins=purchase.coins,
        referral_bonus_granted=referral_bonus_granted,
        referral_bonus_amount=referral_bonus_amount,
        user=serialize_user_out(user, db=db),
    )


@router.post("/api/payments/yookassa/webhook", response_model=MessageResponse)
def yookassa_webhook(
    payload: dict[str, Any],
    request: Request,
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
    token: str | None = Query(default=None, alias="token"),
    db: Session = Depends(get_db),
) -> MessageResponse:
    if not is_payments_configured():
        return MessageResponse(message="ignored")
    if not is_yookassa_webhook_token_valid(token):
        return MessageResponse(message="ignored")

    source_ip: str | None = None
    if settings.app_trust_proxy_headers and x_forwarded_for:
        source_ip = x_forwarded_for.split(",", 1)[0].strip()
    if not source_ip and request.client is not None:
        source_ip = request.client.host
    if settings.yookassa_webhook_trusted_ips_only and not is_yookassa_webhook_source_ip_allowed(source_ip):
        return MessageResponse(message="ignored")

    event = str(payload.get("event", "")).strip().lower()
    payment_payload = payload.get("object")
    if not isinstance(payment_payload, dict):
        return MessageResponse(message="ignored")

    payment_id = str(payment_payload.get("id", "")).strip()
    if not payment_id:
        return MessageResponse(message="ignored")

    if event and not event.startswith("payment."):
        return MessageResponse(message="ignored")

    purchase = db.scalar(select(CoinPurchase).where(CoinPurchase.provider_payment_id == payment_id))
    if purchase is not None:
        user = db.get(User, purchase.user_id)
        if user is None:
            return MessageResponse(message="ignored")
        try:
            provider_payment_payload = fetch_payment_from_provider(payment_id)
            sync_purchase_status(
                db=db,
                purchase=purchase,
                user=user,
                provider_payment_payload=provider_payment_payload,
            )
        except HTTPException:
            db.rollback()
            return MessageResponse(message="ignored")
        return MessageResponse(message="ok")

    # Not a coin top-up — try a subscription first payment / renewal.
    subscription = db.scalar(select(Subscription).where(Subscription.provider_payment_id == payment_id))
    if subscription is None:
        return MessageResponse(message="ignored")
    user = db.get(User, subscription.user_id)
    if user is None:
        return MessageResponse(message="ignored")
    try:
        provider_payment_payload = fetch_payment_from_provider(payment_id)
        sync_subscription_status(
            db=db,
            subscription=subscription,
            user=user,
            provider_payment_payload=provider_payment_payload,
        )
    except HTTPException:
        db.rollback()
        return MessageResponse(message="ignored")

    return MessageResponse(message="ok")
