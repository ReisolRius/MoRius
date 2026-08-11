"""Time-limited storewide discount.

One place decides whether the promotion is running and what a plan costs while it is, so a
displayed price and a charged price cannot drift apart. The discount is applied inside the
plan getters in `payments`, which means every existing consumer of ``plan["price_rub"]`` --
the provider charge, the stored purchase amount, the receipt, the shop listing -- picks it up
without needing to know the promotion exists.

`base_price_rub` is carried alongside so the UI can strike the original price through, and it
is what the promotion is computed from. Discounting an already-discounted price is therefore
impossible even if a plan dict is passed through twice.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# The store is priced in RUB for a Russian audience, so the deadline is the one players read
# on the timer: Moscow time, not the server's local zone or UTC.
PROMO_TIMEZONE = timezone(timedelta(hours=3))

PROMO_DISCOUNT_PERCENT = 10

# Inclusive of the whole final minute: the promotion dies at 14 Aug 00:00, i.e. the moment
# "13 августа 23:59" has fully elapsed.
PROMO_ENDS_AT = datetime(2026, 8, 14, 0, 0, 0, tzinfo=PROMO_TIMEZONE)

PROMO_TITLE = "Скидка 10% на всё"
PROMO_SUBTITLE = "Солы и подписки до 13 августа 23:59 (МСК)"


def _now() -> datetime:
    return datetime.now(tz=PROMO_TIMEZONE)


def is_promo_active(now: datetime | None = None) -> bool:
    return (now or _now()) < PROMO_ENDS_AT


def discounted_price_rub(base_price_rub: int) -> int:
    """Price after the discount, in whole roubles.

    Rounded up so the store never charges a fraction of a rouble it cannot display, and
    floored at 1 so a plan can never become free through rounding.
    """
    base = max(int(base_price_rub), 0)
    if base <= 0 or not is_promo_active():
        return base
    remaining_percent = 100 - PROMO_DISCOUNT_PERCENT
    discounted = -(-base * remaining_percent // 100)  # ceil division
    return max(int(discounted), 1)


def apply_promo_to_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the plan priced for the promotion.

    Always sets `base_price_rub` to the undiscounted price, so callers can render the
    original, and so re-applying this to its own output is a no-op.
    """
    base_price_rub = int(plan.get("base_price_rub", plan.get("price_rub", 0)) or 0)
    effective_price_rub = discounted_price_rub(base_price_rub)
    return {
        **plan,
        "price_rub": effective_price_rub,
        "base_price_rub": base_price_rub,
        "promo_active": effective_price_rub < base_price_rub,
        "promo_discount_percent": PROMO_DISCOUNT_PERCENT if effective_price_rub < base_price_rub else 0,
    }


def apply_promo_to_plans(plans: Any) -> list[dict[str, Any]]:
    return [apply_promo_to_plan(plan) for plan in plans]


def promo_state() -> dict[str, Any]:
    """Everything the storefront needs to render the banner and count down."""
    active = is_promo_active()
    return {
        "active": active,
        "discount_percent": PROMO_DISCOUNT_PERCENT if active else 0,
        "ends_at": PROMO_ENDS_AT.isoformat(),
        "title": PROMO_TITLE,
        "subtitle": PROMO_SUBTITLE,
    }
