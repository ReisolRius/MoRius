from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.models import User

# Weekly reward cycle, Moscow time. The ladder resets every Monday at 00:00 MSK regardless of
# how far the player got: claim day 3 on Sunday and Monday starts again at day 1.
WEEKLY_REWARD_RESET_TIMEZONE = ZoneInfo("Europe/Moscow")
# Kept under the old name so existing importers keep working.
MONTHLY_REWARD_RESET_TIMEZONE = WEEKLY_REWARD_RESET_TIMEZONE
# Sol economy v2. The previous ladder ran 28 days and paid 286 sols a month, which at the new
# rate would be worth ~800 RUB of free play per fully-engaged non-payer. One sol now buys a
# cheap turn outright, so a perfect week pays 15 sols = 15 turns, ~65 a month. Worst case that
# costs 15 x 0.6965 = 10.45 RUB of AI per week per player who never misses a day.
DAILY_REWARD_AMOUNTS: tuple[int, ...] = (
    1,
    1,
    2,
    2,
    2,
    2,
    5,
)
DAILY_REWARD_TOTAL_DAYS = len(DAILY_REWARD_AMOUNTS)
DAILY_REWARD_TOTAL_AMOUNT = sum(DAILY_REWARD_AMOUNTS)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_claimed_days(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        normalized = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(normalized, DAILY_REWARD_TOTAL_DAYS))


def _normalize_claim_timestamp(value: object) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return _to_utc(value)


def _normalize_claim_month(value: object) -> str:
    """Accept a stored cycle key, in the ISO-week form this module writes.

    Anything else -- including a key left behind by the old monthly cycle ("2026-09") -- is
    rejected, which restarts the ladder on the next claim instead of resuming mid-week.
    """
    if not isinstance(value, str):
        return ""
    normalized = value.strip()
    if len(normalized) != 8 or normalized[4:6] != "-W":
        return ""
    if not normalized[:4].isdigit() or not normalized[6:].isdigit():
        return ""
    return normalized


def _resolve_claim_month_key(value: datetime) -> str:
    """ISO year-week in Moscow time, e.g. "2026-W38".

    ISO weeks start on Monday, which is exactly the reset the players were promised: a reward
    taken on Sunday evening is the last of its week, and Monday 00:00 MSK opens a new one.
    """
    local_value = value.astimezone(WEEKLY_REWARD_RESET_TIMEZONE)
    iso_year, iso_week, _ = local_value.isocalendar()
    return f"{iso_year:04d}-W{iso_week:02d}"


def _resolve_stored_claim_month(user: User) -> str:
    stored_claim_month = _normalize_claim_month(getattr(user, "daily_reward_claim_month", ""))
    if stored_claim_month:
        return stored_claim_month

    last_claimed_at = _normalize_claim_timestamp(getattr(user, "daily_reward_last_claimed_at", None))
    if last_claimed_at is not None:
        return _resolve_claim_month_key(last_claimed_at)

    cycle_started_at = _normalize_claim_timestamp(getattr(user, "daily_reward_cycle_started_at", None))
    if cycle_started_at is not None:
        return _resolve_claim_month_key(cycle_started_at)

    return ""


def _resolve_next_claim_at(
    *,
    current_time: datetime,
    last_claimed_at: datetime | None,
) -> datetime | None:
    if last_claimed_at is None:
        return None
    current_local_time = current_time.astimezone(WEEKLY_REWARD_RESET_TIMEZONE)
    last_claimed_local_time = last_claimed_at.astimezone(WEEKLY_REWARD_RESET_TIMEZONE)
    if current_local_time.date() > last_claimed_local_time.date():
        return None
    next_local_midnight = datetime.combine(
        last_claimed_local_time.date() + timedelta(days=1),
        datetime.min.time(),
        tzinfo=WEEKLY_REWARD_RESET_TIMEZONE,
    )
    next_claim_at = next_local_midnight.astimezone(timezone.utc)
    if next_claim_at <= current_time:
        return None
    return next_claim_at


def can_access_daily_rewards(user: User) -> bool:
    return True


@dataclass(frozen=True)
class DailyRewardStatus:
    server_time: datetime
    current_claim_month: str
    current_day: int | None
    claimed_days: int
    stored_claimed_days: int
    can_claim: bool
    is_completed: bool
    next_claim_at: datetime | None
    last_claimed_at: datetime | None
    cycle_started_at: datetime | None


@dataclass(frozen=True)
class DailyRewardClaimGrant:
    reward_day: int
    reward_amount: int
    claimed_at: datetime


def build_daily_reward_status(user: User, *, now: datetime | None = None) -> DailyRewardStatus:
    current_time = _to_utc(now or _utcnow())
    current_claim_month = _resolve_claim_month_key(current_time)
    stored_claimed_days = _normalize_claimed_days(getattr(user, "daily_reward_claimed_days", 0))
    last_claimed_at = _normalize_claim_timestamp(getattr(user, "daily_reward_last_claimed_at", None))
    next_claim_at = _resolve_next_claim_at(current_time=current_time, last_claimed_at=last_claimed_at)
    cooldown_active = next_claim_at is not None
    cycle_started_at = _normalize_claim_timestamp(getattr(user, "daily_reward_cycle_started_at", None))
    stored_claim_month = _resolve_stored_claim_month(user)
    month_progress_resets = stored_claim_month != current_claim_month
    claimed_days = 0 if month_progress_resets else stored_claimed_days

    if claimed_days >= DAILY_REWARD_TOTAL_DAYS:
        claimed_days = DAILY_REWARD_TOTAL_DAYS
        current_day = None
        can_claim = False
        is_completed = True
    else:
        current_day = claimed_days + 1
        can_claim = not cooldown_active
        is_completed = False

    if claimed_days <= 0:
        cycle_started_at = None

    return DailyRewardStatus(
        server_time=current_time,
        current_claim_month=current_claim_month,
        current_day=current_day,
        claimed_days=claimed_days,
        stored_claimed_days=stored_claimed_days,
        can_claim=can_claim,
        is_completed=is_completed,
        next_claim_at=next_claim_at,
        last_claimed_at=last_claimed_at,
        cycle_started_at=cycle_started_at,
    )


def claim_daily_reward(
    db: Session,
    *,
    user: User,
    now: datetime | None = None,
) -> DailyRewardClaimGrant | None:
    current_time = _to_utc(now or _utcnow())
    current_status = build_daily_reward_status(user, now=current_time)
    claim_day = current_status.current_day
    if claim_day is None or not current_status.can_claim:
        return None

    reward_amount = DAILY_REWARD_AMOUNTS[claim_day - 1]
    next_claimed_days = current_status.claimed_days + 1
    next_cycle_started_at = current_time if next_claimed_days == 1 else current_status.cycle_started_at or current_time
    next_claim_mask = (1 << next_claimed_days) - 1

    update_result = db.execute(
        sa_update(User)
        .where(
            User.id == int(user.id),
            User.daily_reward_claimed_days == current_status.stored_claimed_days,
        )
        .values(
            coins=User.coins + reward_amount,
            daily_reward_claimed_days=next_claimed_days,
            daily_reward_claim_month=current_status.current_claim_month,
            daily_reward_claim_mask=next_claim_mask,
            daily_reward_last_claimed_at=current_time,
            daily_reward_cycle_started_at=next_cycle_started_at,
        )
    )

    if (update_result.rowcount or 0) <= 0:
        return None

    return DailyRewardClaimGrant(
        reward_day=claim_day,
        reward_amount=reward_amount,
        claimed_at=current_time,
    )
