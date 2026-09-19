"""Subscription turn budget: daily accrual, the monthly reset, and admin adjustments."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import Subscription, User  # noqa: E402
from app.services import subscriptions as subs  # noqa: E402
from app.services.payments import SUBSCRIPTION_PERIOD_DAYS, SUBSCRIPTION_PLANS_BY_ID  # noqa: E402

PLAN_ID = "constellation"
DAILY_LIMIT = int(SUBSCRIPTION_PLANS_BY_ID[PLAN_ID]["daily_turn_limit"])
PERIOD_START = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


class SubscriptionTurnBudgetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True)

    def _make_user(self, db, *, email: str, next_charge_at: datetime | None) -> User:
        user = User(email=email, password_hash="x")
        db.add(user)
        db.flush()
        db.add(
            Subscription(
                user_id=user.id,
                plan_id=PLAN_ID,
                plan_title=str(SUBSCRIPTION_PLANS_BY_ID[PLAN_ID]["title"]),
                price_rub=int(SUBSCRIPTION_PLANS_BY_ID[PLAN_ID]["price_rub"]),
                status="active",
                started_at=PERIOD_START,
                next_charge_at=next_charge_at,
            )
        )
        db.commit()
        return user

    def _spend(self, db, user: User, entitlement: dict, count: int, *, now: datetime) -> int:
        consumed = 0
        for _ in range(count):
            if subs.try_consume_subscription_turn(
                db,
                user_id=int(user.id),
                daily_turn_limit=int(entitlement["daily_turn_limit"]),
                period_start=str(entitlement["period_start"]),
                now=now,
            ):
                consumed += 1
        db.commit()
        db.refresh(user)
        return consumed

    def test_turns_accrue_every_day_and_unspent_ones_roll_over(self) -> None:
        with self.Session() as db:
            user = self._make_user(
                db, email="accrue@test", next_charge_at=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
            )
            for day in (0, 1, 2, 9, 29):
                now = PERIOD_START + timedelta(days=day)
                entitlement = subs.get_subscription_entitlement(db, user, now=now)
                assert entitlement is not None
                with self.subTest(day=day):
                    self.assertEqual(
                        subs.get_daily_turns_remaining(user, entitlement, now=now),
                        DAILY_LIMIT * (day + 1),
                    )

            # Spending on day 3 leaves everything accrued before it intact.
            now = PERIOD_START + timedelta(days=3)
            entitlement = subs.get_subscription_entitlement(db, user, now=now)
            self._spend(db, user, entitlement, 50, now=now)
            self.assertEqual(subs.get_period_turns_used(user, entitlement), 50)
            self.assertEqual(
                subs.get_daily_turns_remaining(user, entitlement, now=now),
                DAILY_LIMIT * 4 - 50,
            )

    def test_accrual_never_exceeds_one_period(self) -> None:
        """A late renewal keeps access through the grace window; it must not keep accruing."""
        with self.Session() as db:
            user = self._make_user(
                db, email="late@test", next_charge_at=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
            )
            full_period = DAILY_LIMIT * SUBSCRIPTION_PERIOD_DAYS
            for day in (SUBSCRIPTION_PERIOD_DAYS - 1, SUBSCRIPTION_PERIOD_DAYS, SUBSCRIPTION_PERIOD_DAYS + 2):
                now = PERIOD_START + timedelta(days=day)
                entitlement = subs.get_subscription_entitlement(db, user, now=now)
                if entitlement is None:
                    continue
                with self.subTest(day=day):
                    self.assertLessEqual(
                        subs.get_daily_turns_remaining(user, entitlement, now=now),
                        full_period,
                    )

    def test_renewal_resets_usage_and_the_admin_adjustment(self) -> None:
        with self.Session() as db:
            user = self._make_user(
                db, email="renew@test", next_charge_at=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
            )
            now = PERIOD_START + timedelta(days=5)
            entitlement = subs.get_subscription_entitlement(db, user, now=now)
            self._spend(db, user, entitlement, 30, now=now)
            subs.adjust_subscription_turns(db, user=user, entitlement=entitlement, delta=100, now=now)
            db.commit()
            db.refresh(user)
            self.assertEqual(subs.get_period_turns_used(user, entitlement), 30)
            self.assertEqual(subs.get_period_turns_bonus(user, entitlement), 100)

            # The renewal moves the charge date, which is what starts a new period.
            subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one()
            subscription.next_charge_at = PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS * 2)
            db.commit()

            later = PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS + 1)
            renewed = subs.get_subscription_entitlement(db, user, now=later)
            assert renewed is not None
            self.assertNotEqual(renewed["period_start"], entitlement["period_start"])
            self.assertEqual(subs.get_period_turns_used(user, renewed), 0)
            self.assertEqual(subs.get_period_turns_bonus(user, renewed), 0)

            # ...and the stored counters are cleared for real on the next turn, not just hidden.
            self._spend(db, user, renewed, 1, now=later)
            self.assertEqual(int(user.subscription_turns_bonus), 0)
            self.assertEqual(int(user.subscription_turns_used), 1)

    def test_admin_grant_without_a_charge_date_still_resets_monthly(self) -> None:
        """An admin grant has no next_charge_at, so the period rolls off started_at instead."""
        with self.Session() as db:
            user = self._make_user(db, email="grant@test", next_charge_at=None)
            first = subs.get_subscription_entitlement(db, user, now=PERIOD_START + timedelta(days=10))
            second = subs.get_subscription_entitlement(
                db, user, now=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS + 1)
            )
            assert first is not None and second is not None
            self.assertNotEqual(first["period_start"], second["period_start"])
            self.assertEqual(
                subs.get_daily_turns_remaining(
                    user, second, now=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS + 1)
                ),
                DAILY_LIMIT * 2,
            )

    def test_admin_adjustment_grants_and_deducts_within_the_period(self) -> None:
        with self.Session() as db:
            user = self._make_user(
                db, email="adjust@test", next_charge_at=PERIOD_START + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
            )
            now = PERIOD_START
            entitlement = subs.get_subscription_entitlement(db, user, now=now)
            assert entitlement is not None

            self.assertEqual(
                subs.adjust_subscription_turns(db, user=user, entitlement=entitlement, delta=25, now=now),
                DAILY_LIMIT + 25,
            )
            # The granted turns are really spendable, not just displayed.
            self.assertEqual(self._spend(db, user, entitlement, DAILY_LIMIT + 25, now=now), DAILY_LIMIT + 25)
            self.assertEqual(subs.get_daily_turns_remaining(user, entitlement, now=now), 0)

            # Deducting more than the player has floors at zero instead of going into debt.
            subs.adjust_subscription_turns(db, user=user, entitlement=entitlement, delta=60, now=now)
            db.commit()
            remaining = subs.adjust_subscription_turns(
                db, user=user, entitlement=entitlement, delta=-10_000, now=now
            )
            db.commit()
            db.refresh(user)
            self.assertEqual(remaining, 0)
            self.assertEqual(subs.get_daily_turns_remaining(user, entitlement, now=now), 0)
            self.assertFalse(
                subs.try_consume_subscription_turn(
                    db,
                    user_id=int(user.id),
                    daily_turn_limit=int(entitlement["daily_turn_limit"]),
                    period_start=str(entitlement["period_start"]),
                    now=now,
                )
            )


if __name__ == "__main__":
    unittest.main()


class AdminSubscriptionTurnsEndpointTests(unittest.TestCase):
    """The admin endpoint itself: what it reports and what it refuses."""

    def setUp(self) -> None:
        from sqlalchemy.orm import Session as OrmSession

        self.engine = create_engine("sqlite://", future=True)
        Base.metadata.create_all(self.engine)
        self.db = OrmSession(bind=self.engine, future=True)
        self.admin = User(email="admin-turns@example.com", role="administrator", password_hash="x")
        self.player = User(email="player-turns@example.com", role="user", password_hash="x")
        self.no_plan = User(email="noplan-turns@example.com", role="user", password_hash="x")
        self.db.add_all([self.admin, self.player, self.no_plan])
        self.db.flush()
        self.db.add(
            Subscription(
                user_id=self.player.id,
                plan_id=PLAN_ID,
                plan_title=str(SUBSCRIPTION_PLANS_BY_ID[PLAN_ID]["title"]),
                price_rub=int(SUBSCRIPTION_PLANS_BY_ID[PLAN_ID]["price_rub"]),
                status="active",
                started_at=datetime.now(timezone.utc),
                next_charge_at=datetime.now(timezone.utc) + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
            )
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _call(self, user: User, operation: str, amount: int):
        from unittest.mock import patch

        from app.routers.admin import update_user_subscription_turns
        from app.schemas import AdminUserSubscriptionTurnsUpdateRequest

        with patch("app.routers.admin._require_administrator", return_value=self.admin):
            return update_user_subscription_turns(
                int(user.id),
                AdminUserSubscriptionTurnsUpdateRequest(operation=operation, amount=amount),
                authorization=None,
                db=self.db,
            )

    def test_admin_grants_and_deducts_turns_and_sees_the_balance(self) -> None:
        granted = self._call(self.player, "add", 75)
        assert granted.subscription is not None
        self.assertEqual(granted.subscription.daily_turn_limit, DAILY_LIMIT)
        self.assertEqual(granted.subscription.turns_bonus, 75)
        self.assertEqual(granted.subscription.turns_remaining, DAILY_LIMIT + 75)
        self.assertEqual(granted.subscription.turns_accrued, DAILY_LIMIT)
        self.assertEqual(granted.subscription.turns_used, 0)

        deducted = self._call(self.player, "subtract", 25)
        assert deducted.subscription is not None
        self.assertEqual(deducted.subscription.turns_remaining, DAILY_LIMIT + 50)

    def test_turns_cannot_be_adjusted_without_an_active_subscription(self) -> None:
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as caught:
            self._call(self.no_plan, "add", 10)
        self.assertEqual(caught.exception.status_code, 409)
