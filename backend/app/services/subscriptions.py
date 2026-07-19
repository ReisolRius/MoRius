"""Subscription entitlement resolution + turn accounting.

Subscriptions differ ONLY in: available narrator models, daily turns, and scene-memory size.
A subscription narrator turn never spends sols, including story-service modules attached to the
turn. It consumes exactly one of the tier's accrued turns instead.

Turn budget accrues: each Europe/Moscow day inside the current subscription billing period adds
the tier's daily limit, and unspent turns roll over within the period. The counter resets ONLY at
a billing-period boundary (the subscription's renewal/expiry) — even when the subscription renews,
each new period starts a fresh budget.

An active `Subscription` row (real or `is_mock` admin-test) grants the entitlement; mock rows can
only be created by an administrator, so they double as the admin "тест подписки".
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update as sa_update
from sqlalchemy.orm import Session

from app.models import Subscription, User
from app.services.payments import SUBSCRIPTION_PERIOD_DAYS, SUBSCRIPTION_PLANS_BY_ID

SUBSCRIPTION_RESET_TIMEZONE = ZoneInfo("Europe/Moscow")

# Hard cap on a subscription-model response (no memory optimization / plain text).
SUBSCRIPTION_RESPONSE_MAX_TOKENS = 450

# Access keeps working for this many days past a missed renewal, giving the recurring-charge job
# time to retry. This also means access auto-expires if the renewal never succeeds — so even with
# no scheduler deployed, an "active" row never grants unpaid access indefinitely.
SUBSCRIPTION_ACCESS_GRACE_DAYS = 3

_DATE_FORMAT = "%Y-%m-%d"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _moscow_date(value: datetime) -> date:
    return _to_utc(value).astimezone(SUBSCRIPTION_RESET_TIMEZONE).date()


def get_active_subscription(db: Session, user: User, *, now: datetime | None = None) -> Subscription | None:
    """Newest active, non-lapsed subscription for the user (real or admin-test mock).

    "Non-lapsed" = no charge due yet, or due within the grace window. This makes access end on its
    own if a renewal isn't paid, even when the recurring-charge scheduler is not (yet) deployed.
    """
    current = now or _utcnow()
    grace_floor = current - timedelta(days=SUBSCRIPTION_ACCESS_GRACE_DAYS)
    candidates = db.scalars(
        select(Subscription)
        .where(
            Subscription.user_id == user.id,
            Subscription.status == "active",
        )
        .order_by(Subscription.started_at.desc(), Subscription.id.desc())
    ).all()
    for subscription in candidates:
        next_charge_at = subscription.next_charge_at
        if next_charge_at is None or _to_utc(next_charge_at) > grace_floor:
            return subscription
    return None


def _period_start_date(subscription: Subscription, *, now: datetime) -> date:
    """Moscow calendar day on which the subscription's current billing period began.

    Anchored to ``next_charge_at`` (period end) minus one period, so it advances together with each
    renewal; falls back to ``started_at`` (or today) for rows without a known charge date.
    """
    next_charge_at = subscription.next_charge_at
    if next_charge_at is not None:
        return _moscow_date(_to_utc(next_charge_at) - timedelta(days=SUBSCRIPTION_PERIOD_DAYS))
    started_at = subscription.started_at
    if started_at is not None:
        return _moscow_date(started_at)
    return _moscow_date(now)


def _days_elapsed_in_period(period_start: str, *, now: datetime | None = None) -> int:
    today = _moscow_date(now or _utcnow())
    try:
        start = datetime.strptime(period_start, _DATE_FORMAT).date()
    except (TypeError, ValueError):
        return 1
    return max(1, (today - start).days + 1)


def _period_turn_cap(daily_turn_limit: int, period_start: str, *, now: datetime | None = None) -> int:
    return max(0, int(daily_turn_limit)) * _days_elapsed_in_period(period_start, now=now)


def get_subscription_entitlement(
    db: Session,
    user: User,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Resolve the user's active entitlement, or None when there is no active subscription."""
    current = now or _utcnow()
    subscription = get_active_subscription(db, user, now=current)
    if subscription is None:
        return None
    plan = SUBSCRIPTION_PLANS_BY_ID.get(str(subscription.plan_id))
    if plan is None:
        return None
    return {
        "plan_id": str(plan["id"]),
        "plan_title": str(plan["title"]),
        "models": [str(model) for model in plan.get("models", [])],
        "daily_turn_limit": int(plan.get("daily_turn_limit", 0)),
        "memory_token_cap": int(plan.get("memory_token_cap", 0)),
        "is_mock": bool(subscription.is_mock),
        "period_start": _period_start_date(subscription, now=current).strftime(_DATE_FORMAT),
    }


def get_period_turns_used(
    user: User,
    entitlement: dict[str, Any] | None,
) -> int:
    """Turns used in the current billing period (0 once a new period begins, before the DB reset)."""
    if not entitlement:
        return 0
    if str(getattr(user, "subscription_turns_date", "") or "") != str(entitlement.get("period_start", "")):
        return 0
    return max(0, int(getattr(user, "subscription_turns_used", 0) or 0))


def get_daily_turns_remaining(
    user: User,
    entitlement: dict[str, Any] | None,
    *,
    now: datetime | None = None,
) -> int:
    """Accrued turns still available now (daily limit × days elapsed in period − used)."""
    if not entitlement:
        return 0
    cap = _period_turn_cap(int(entitlement.get("daily_turn_limit", 0)), str(entitlement.get("period_start", "")), now=now)
    return max(0, cap - get_period_turns_used(user, entitlement))


def try_consume_subscription_turn(
    db: Session,
    *,
    user_id: int,
    daily_turn_limit: int,
    period_start: str,
    now: datetime | None = None,
) -> bool:
    """Atomically consume one accrued turn within the current billing period.

    Returns True when a turn was consumed, False when the accrued budget is exhausted. The counter
    is reset to 0 when a new billing period begins (``period_start`` changes); within a period the
    cap grows by ``daily_turn_limit`` each Moscow day, so unspent turns roll over.
    """
    cap = _period_turn_cap(int(daily_turn_limit), period_start, now=now)
    if cap <= 0:
        return False

    # 1) Roll the counter over to the current period if it belongs to a previous one.
    db.execute(
        sa_update(User)
        .where(User.id == user_id, User.subscription_turns_date != period_start)
        .values(subscription_turns_date=period_start, subscription_turns_used=0)
    )

    # 2) Increment only while still under the accrued cap for this period.
    result = db.execute(
        sa_update(User)
        .where(
            User.id == user_id,
            User.subscription_turns_date == period_start,
            User.subscription_turns_used < cap,
        )
        .values(subscription_turns_used=User.subscription_turns_used + 1)
    )
    return (result.rowcount or 0) > 0
