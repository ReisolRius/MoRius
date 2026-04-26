from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import re
import secrets

from sqlalchemy import func, select, update as sa_update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import CoinPurchase, ReferralReward, User
from app.services.concurrency import add_user_tokens

logger = logging.getLogger(__name__)

REFERRAL_BONUS_COINS = 500
REFERRAL_CODE_LENGTH = 10
REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
REFERRAL_CODE_PATTERN = re.compile(r"^[A-Z0-9_-]{4,32}$")


@dataclass(frozen=True)
class ReferralApplyResult:
    ok: bool
    reason: str
    message: str
    referral_pending_purchase: bool
    pending_bonus_amount: int
    referrer_user_id: int | None = None


@dataclass(frozen=True)
class ReferralRewardGrantResult:
    bonus_granted: bool
    bonus_amount: int = 0


@dataclass(frozen=True)
class ReferralSummary:
    referral_code: str
    paid_referrals_count: int
    referral_pending_purchase: bool
    pending_bonus_amount: int


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_referral_code(raw_code: str | None) -> str:
    normalized = str(raw_code or "").strip().upper()
    if not normalized or not REFERRAL_CODE_PATTERN.fullmatch(normalized):
        return ""
    return normalized


def _generate_referral_code() -> str:
    return "".join(secrets.choice(REFERRAL_CODE_ALPHABET) for _ in range(REFERRAL_CODE_LENGTH))


def ensure_user_referral_code(db: Session, user: User) -> str:
    existing_code = normalize_referral_code(getattr(user, "referral_code", None))
    if existing_code:
        if user.referral_code != existing_code:
            user.referral_code = existing_code
        return existing_code

    for _ in range(32):
        candidate = _generate_referral_code()
        collision = db.scalar(select(User.id).where(User.referral_code == candidate).limit(1))
        if collision is not None:
            continue
        user.referral_code = candidate
        db.flush()
        return candidate

    raise RuntimeError("Failed to generate unique referral code")


def user_has_successful_purchase(db: Session, *, user_id: int) -> bool:
    purchase_id = db.scalar(
        select(CoinPurchase.id)
        .where(
            CoinPurchase.user_id == user_id,
            CoinPurchase.status == "succeeded",
        )
        .limit(1)
    )
    return purchase_id is not None


def has_pending_referral_bonus(user: User) -> bool:
    return bool(getattr(user, "referred_by_user_id", None)) and getattr(user, "referral_bonus_claimed_at", None) is None


def get_paid_referrals_count(db: Session, *, referrer_user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(ReferralReward.id)).where(
                ReferralReward.referrer_user_id == referrer_user_id,
                ReferralReward.status == "granted",
            )
        )
        or 0
    )


def get_referred_reward_amount_for_purchase(db: Session, *, purchase_id: int, referred_user_id: int) -> int:
    reward = db.scalar(
        select(ReferralReward).where(
            ReferralReward.triggering_purchase_id == purchase_id,
            ReferralReward.referred_user_id == referred_user_id,
            ReferralReward.status == "granted",
        )
    )
    if reward is None:
        return 0
    return max(0, int(reward.referred_reward_amount or 0))


def build_referral_summary(db: Session, user: User) -> ReferralSummary:
    referral_code = ensure_user_referral_code(db, user)
    referral_pending_purchase = has_pending_referral_bonus(user)
    return ReferralSummary(
        referral_code=referral_code,
        paid_referrals_count=get_paid_referrals_count(db, referrer_user_id=int(user.id)),
        referral_pending_purchase=referral_pending_purchase,
        pending_bonus_amount=REFERRAL_BONUS_COINS if referral_pending_purchase else 0,
    )


def apply_referral_code(db: Session, *, user: User, raw_code: str | None) -> ReferralApplyResult:
    code = normalize_referral_code(raw_code)
    if not code:
        return ReferralApplyResult(
            ok=False,
            reason="invalid",
            message="Реферальная ссылка устарела или повреждена.",
            referral_pending_purchase=has_pending_referral_bonus(user),
            pending_bonus_amount=REFERRAL_BONUS_COINS if has_pending_referral_bonus(user) else 0,
        )

    own_code = ensure_user_referral_code(db, user)
    if own_code == code:
        return ReferralApplyResult(
            ok=False,
            reason="self_referral",
            message="Нельзя применить собственную реферальную ссылку.",
            referral_pending_purchase=has_pending_referral_bonus(user),
            pending_bonus_amount=REFERRAL_BONUS_COINS if has_pending_referral_bonus(user) else 0,
        )

    referrer = db.scalar(select(User).where(User.referral_code == code))
    if referrer is None:
        return ReferralApplyResult(
            ok=False,
            reason="not_found",
            message="Реферальная ссылка не найдена.",
            referral_pending_purchase=has_pending_referral_bonus(user),
            pending_bonus_amount=REFERRAL_BONUS_COINS if has_pending_referral_bonus(user) else 0,
        )

    if getattr(user, "referred_by_user_id", None):
        return ReferralApplyResult(
            ok=False,
            reason="already_applied",
            message="Реферальная ссылка уже применена к этому аккаунту.",
            referral_pending_purchase=has_pending_referral_bonus(user),
            pending_bonus_amount=REFERRAL_BONUS_COINS if has_pending_referral_bonus(user) else 0,
            referrer_user_id=int(user.referred_by_user_id),
        )

    if user_has_successful_purchase(db, user_id=int(user.id)):
        return ReferralApplyResult(
            ok=False,
            reason="already_purchased",
            message="Реферальный бонус доступен только до первой покупки.",
            referral_pending_purchase=False,
            pending_bonus_amount=0,
            referrer_user_id=int(referrer.id),
        )

    user.referred_by_user_id = int(referrer.id)
    user.referral_applied_at = _utcnow()
    return ReferralApplyResult(
        ok=True,
        reason="applied",
        message="Реферальная ссылка применена. Бонус начислится после первой покупки.",
        referral_pending_purchase=True,
        pending_bonus_amount=REFERRAL_BONUS_COINS,
        referrer_user_id=int(referrer.id),
    )


def _get_first_successful_purchase_id(db: Session, *, user_id: int) -> int | None:
    return db.scalar(
        select(CoinPurchase.id)
        .where(
            CoinPurchase.user_id == user_id,
            CoinPurchase.status == "succeeded",
        )
        .order_by(CoinPurchase.created_at.asc(), CoinPurchase.id.asc())
        .limit(1)
    )


def grant_referral_rewards_after_purchase(
    db: Session,
    *,
    purchase: CoinPurchase,
    user: User,
) -> ReferralRewardGrantResult:
    if purchase.id is None or purchase.user_id != user.id or purchase.status != "succeeded":
        return ReferralRewardGrantResult(bonus_granted=False)

    referrer_user_id = int(getattr(user, "referred_by_user_id", None) or 0)
    if referrer_user_id <= 0 or referrer_user_id == int(user.id):
        return ReferralRewardGrantResult(bonus_granted=False)
    if getattr(user, "referral_bonus_claimed_at", None) is not None:
        return ReferralRewardGrantResult(bonus_granted=False)

    first_purchase_id = _get_first_successful_purchase_id(db, user_id=int(user.id))
    if first_purchase_id != int(purchase.id):
        return ReferralRewardGrantResult(bonus_granted=False)

    referrer_exists = db.scalar(select(User.id).where(User.id == referrer_user_id).limit(1))
    if referrer_exists is None:
        return ReferralRewardGrantResult(bonus_granted=False)

    try:
        with db.begin_nested():
            existing_reward_id = db.scalar(
                select(ReferralReward.id)
                .where(ReferralReward.referred_user_id == int(user.id))
                .limit(1)
            )
            if existing_reward_id is not None:
                return ReferralRewardGrantResult(bonus_granted=False)

            now = _utcnow()
            update_result = db.execute(
                sa_update(User)
                .where(
                    User.id == int(user.id),
                    User.referred_by_user_id == referrer_user_id,
                    User.referral_bonus_claimed_at.is_(None),
                )
                .values(referral_bonus_claimed_at=now)
            )
            if (update_result.rowcount or 0) <= 0:
                return ReferralRewardGrantResult(bonus_granted=False)

            db.add(
                ReferralReward(
                    referrer_user_id=referrer_user_id,
                    referred_user_id=int(user.id),
                    triggering_purchase_id=int(purchase.id),
                    referrer_reward_amount=REFERRAL_BONUS_COINS,
                    referred_reward_amount=REFERRAL_BONUS_COINS,
                    status="granted",
                )
            )
            add_user_tokens(db, user_id=int(user.id), tokens=REFERRAL_BONUS_COINS)
            add_user_tokens(db, user_id=referrer_user_id, tokens=REFERRAL_BONUS_COINS)
            db.flush()
            return ReferralRewardGrantResult(
                bonus_granted=True,
                bonus_amount=REFERRAL_BONUS_COINS,
            )
    except SQLAlchemyError:
        logger.exception(
            "Referral reward grant failed for purchase_id=%s referred_user_id=%s referrer_user_id=%s",
            purchase.id,
            user.id,
            referrer_user_id,
        )
        return ReferralRewardGrantResult(bonus_granted=False)
