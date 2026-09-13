from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import SavedPaymentMethod, Subscription, User  # noqa: E402
from app.services.payments import (  # noqa: E402
    SUBSCRIPTION_PERIOD_DAYS,
    cancel_subscription_at_period_end,
    charge_due_subscriptions,
    resume_subscription_auto_renewal,
    sync_subscription_status,
)
from app.services.subscriptions import get_active_subscription  # noqa: E402


STARTED_AT = datetime(2026, 7, 1, tzinfo=timezone.utc)
PERIOD_END = STARTED_AT + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)


class SubscriptionCancellationTests(unittest.TestCase):
    """Cancelling must stop the next charge, never take back the paid period.

    Cancelling used to flip the row to `canceled` immediately, and the entitlement resolver
    only looks at `active` rows -- so a membership bought minutes earlier vanished the second
    the player pressed cancel.
    """

    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        self.db = Session(bind=self.engine, future=True)
        self.user = User(email="cancel-player@example.com", role="user")
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _card(self) -> SavedPaymentMethod:
        method = SavedPaymentMethod(
            user_id=int(self.user.id),
            provider="yookassa",
            provider_payment_method_id="saved-card-1",
            title="Visa •••• 4242",
            card_type="Visa",
            card_last4="4242",
            card_first6="424242",
            expiry_month="12",
            expiry_year="2030",
            is_default=True,
            is_demo=False,
        )
        self.db.add(method)
        self.db.flush()
        return method

    def _flame(self, *, method: SavedPaymentMethod | None = None) -> Subscription:
        subscription = Subscription(
            user_id=int(self.user.id),
            plan_id="flame",
            plan_title="Пламя",
            price_rub=599,
            provider_payment_id="flame-payment",
            status="active",
            payment_method_id=(int(method.id) if method is not None else None),
            started_at=STARTED_AT,
            next_charge_at=PERIOD_END,
            is_mock=False,
        )
        self.db.add(subscription)
        self.db.commit()
        self.db.refresh(subscription)
        return subscription

    def test_cancelling_keeps_access_for_the_rest_of_the_paid_period(self) -> None:
        subscription = self._flame(method=self._card())

        cancel_subscription_at_period_end(subscription, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        self.assertEqual(subscription.status, "active")
        self.assertTrue(subscription.cancel_at_period_end)
        # SQLite hands the timestamp back naive, so compare the instant rather than the value.
        self.assertEqual(
            subscription.next_charge_at.replace(tzinfo=timezone.utc),
            PERIOD_END,
        )

        mid_period = get_active_subscription(
            self.db, self.user, now=STARTED_AT + timedelta(days=20)
        )
        self.assertIsNotNone(mid_period)
        self.assertEqual(int(mid_period.id), int(subscription.id))

        # The last minute of the period is still paid for.
        last_minute = get_active_subscription(
            self.db, self.user, now=PERIOD_END - timedelta(minutes=1)
        )
        self.assertIsNotNone(last_minute)

    def test_a_cancelled_membership_gets_no_grace_days_past_its_period(self) -> None:
        # The grace window covers a renewal that is late, not one nobody intends to make.
        subscription = self._flame(method=self._card())
        cancel_subscription_at_period_end(subscription, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        self.assertIsNone(
            get_active_subscription(self.db, self.user, now=PERIOD_END + timedelta(minutes=1))
        )

    def test_an_uncancelled_membership_still_gets_its_grace_days(self) -> None:
        self._flame(method=self._card())

        self.assertIsNotNone(
            get_active_subscription(self.db, self.user, now=PERIOD_END + timedelta(days=1))
        )

    def test_the_renewal_job_ends_a_cancelled_membership_without_charging(self) -> None:
        subscription = self._flame(method=self._card())
        cancel_subscription_at_period_end(subscription, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        with patch(
            "app.services.payments.create_subscription_recurring_payment_in_provider",
        ) as recurring_payment:
            result = charge_due_subscriptions(self.db, now=PERIOD_END + timedelta(minutes=1))

        self.db.refresh(subscription)
        self.assertEqual(recurring_payment.call_count, 0)
        self.assertEqual(subscription.status, "canceled")
        self.assertIsNone(subscription.next_charge_at)
        self.assertEqual(result["expired"], 1)
        self.assertEqual(result["charged"], 0)

    def test_cancelling_can_be_undone_while_the_period_is_still_running(self) -> None:
        subscription = self._flame(method=self._card())
        cancel_subscription_at_period_end(subscription, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        resume_subscription_auto_renewal(subscription)
        self.db.commit()

        self.assertFalse(subscription.cancel_at_period_end)
        self.assertIsNone(subscription.canceled_at)

        with patch(
            "app.services.payments.create_subscription_recurring_payment_in_provider",
            return_value={"id": "flame-renewal", "status": "succeeded"},
        ) as recurring_payment:
            result = charge_due_subscriptions(self.db, now=PERIOD_END + timedelta(minutes=1))

        self.db.refresh(subscription)
        self.assertEqual(recurring_payment.call_count, 1)
        self.assertEqual(subscription.status, "active")
        self.assertEqual(result["charged"], 1)

    def test_unbinding_the_card_also_leaves_the_paid_period_alone(self) -> None:
        # Same promise by a different route: no card means no renewal, and the period the
        # player bought still runs to the end.
        subscription = self._flame(method=self._card())
        subscription.payment_method_id = None
        self.db.commit()

        self.assertIsNotNone(
            get_active_subscription(self.db, self.user, now=PERIOD_END - timedelta(days=1))
        )

        result = charge_due_subscriptions(self.db, now=PERIOD_END + timedelta(minutes=1))
        self.db.refresh(subscription)
        self.assertEqual(subscription.status, "expired")
        self.assertEqual(result["charged"], 0)

    def test_buying_a_new_tier_clears_a_pending_cancellation_on_the_new_row(self) -> None:
        method = self._card()
        flame = self._flame(method=method)
        cancel_subscription_at_period_end(flame, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        constellation = Subscription(
            user_id=int(self.user.id),
            plan_id="constellation",
            plan_title="Созвездие",
            price_rub=1190,
            provider_payment_id="constellation-payment",
            status="pending",
            cancel_at_period_end=True,
            is_mock=False,
        )
        self.db.add(constellation)
        self.db.commit()

        sync_subscription_status(
            db=self.db,
            subscription=constellation,
            user=self.user,
            provider_payment_payload={"status": "succeeded"},
        )
        self.db.refresh(flame)
        self.db.refresh(constellation)

        self.assertEqual(constellation.status, "active")
        self.assertFalse(constellation.cancel_at_period_end)
        self.assertEqual(flame.status, "canceled")

    def test_cancelling_a_membership_with_no_period_left_ends_it_immediately(self) -> None:
        subscription = self._flame(method=self._card())
        subscription.next_charge_at = None
        self.db.commit()

        cancel_subscription_at_period_end(subscription, now=STARTED_AT + timedelta(days=2))
        self.db.commit()

        self.assertEqual(subscription.status, "canceled")


if __name__ == "__main__":
    unittest.main()
