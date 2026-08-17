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
from app.routers.admin import grant_user_subscription  # noqa: E402
from app.schemas import AdminUserSubscriptionGrantRequest  # noqa: E402
from app.services.payments import (  # noqa: E402
    SUBSCRIPTION_PERIOD_DAYS,
    charge_due_subscriptions,
    grant_subscription_for_one_period,
    sync_subscription_status,
)
from app.services.subscriptions import get_subscription_entitlement  # noqa: E402


class SubscriptionLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        self.db = Session(bind=self.engine, future=True)
        self.user = User(email="subscription-player@example.com", role="user")
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _real_card(self) -> SavedPaymentMethod:
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

    def _active_flame(self, *, method: SavedPaymentMethod | None = None) -> Subscription:
        started_at = datetime(2026, 7, 1, tzinfo=timezone.utc)
        subscription = Subscription(
            user_id=int(self.user.id),
            plan_id="flame",
            plan_title="Пламя",
            price_rub=599,
            provider_payment_id="flame-payment",
            status="active",
            payment_method_id=(int(method.id) if method is not None else None),
            started_at=started_at,
            next_charge_at=started_at + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
            is_mock=False,
        )
        self.db.add(subscription)
        self.db.flush()
        return subscription

    def test_successful_tier_purchase_replaces_previous_subscription(self) -> None:
        method = self._real_card()
        old_flame = self._active_flame(method=method)
        new_constellation = Subscription(
            user_id=int(self.user.id),
            plan_id="constellation",
            plan_title="Созвездие",
            price_rub=1190,
            provider_payment_id="constellation-payment",
            status="pending",
            is_mock=False,
        )
        self.db.add(new_constellation)
        self.db.commit()

        sync_subscription_status(
            db=self.db,
            subscription=new_constellation,
            user=self.user,
            provider_payment_payload={"status": "succeeded"},
        )
        self.db.refresh(old_flame)
        self.db.refresh(new_constellation)

        self.assertEqual(old_flame.status, "canceled")
        self.assertIsNone(old_flame.next_charge_at)
        self.assertEqual(new_constellation.status, "active")
        self.assertEqual(get_subscription_entitlement(self.db, self.user)["plan_id"], "constellation")

        # Duplicate webhook delivery must not extend the paid period another month.
        next_charge_at = new_constellation.next_charge_at
        sync_subscription_status(
            db=self.db,
            subscription=new_constellation,
            user=self.user,
            provider_payment_payload={"status": "succeeded"},
        )
        self.db.refresh(new_constellation)
        self.assertEqual(new_constellation.next_charge_at, next_charge_at)

    def test_admin_grant_is_free_now_and_renews_from_existing_real_card(self) -> None:
        method = self._real_card()
        old_flame = self._active_flame(method=method)
        self.db.commit()
        now = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)

        granted = grant_subscription_for_one_period(
            self.db,
            user=self.user,
            plan_id="constellation",
            now=now,
        )
        self.db.commit()
        self.db.refresh(old_flame)
        self.db.refresh(granted)

        self.assertEqual(old_flame.status, "canceled")
        self.assertEqual(granted.status, "active")
        self.assertFalse(granted.is_mock)
        self.assertIsNone(granted.provider_payment_id)
        self.assertEqual(granted.payment_method_id, method.id)
        granted_next_charge_at = granted.next_charge_at
        if granted_next_charge_at is not None and granted_next_charge_at.tzinfo is None:
            granted_next_charge_at = granted_next_charge_at.replace(tzinfo=timezone.utc)
        self.assertEqual(granted_next_charge_at, now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS))

        with patch(
            "app.services.payments.create_subscription_recurring_payment_in_provider",
            return_value={"id": "renewal-payment", "status": "succeeded"},
        ) as recurring_payment:
            result = charge_due_subscriptions(
                self.db,
                now=now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
            )

        self.db.refresh(granted)
        self.assertEqual(result, {"charged": 1, "failed": 0, "due": 1})
        self.assertEqual(granted.provider_payment_id, "renewal-payment")
        self.assertEqual(recurring_payment.call_args.args[0]["id"], "constellation")
        self.assertEqual(recurring_payment.call_args.args[2], "saved-card-1")

    def test_admin_grant_expires_after_month_without_real_card(self) -> None:
        now = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        granted = grant_subscription_for_one_period(
            self.db,
            user=self.user,
            plan_id="spark",
            now=now,
        )
        self.db.commit()

        result = charge_due_subscriptions(
            self.db,
            now=now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS),
        )
        self.db.refresh(granted)

        self.assertEqual(result, {"charged": 0, "failed": 1, "due": 1})
        self.assertEqual(granted.status, "expired")

    def test_admin_endpoint_returns_new_subscription_state(self) -> None:
        admin = User(email="subscription-admin@example.com", role="administrator")
        self.db.add(admin)
        self.db.commit()

        with patch("app.routers.admin._require_administrator", return_value=admin):
            response = grant_user_subscription(
                int(self.user.id),
                AdminUserSubscriptionGrantRequest(plan_id="constellation"),
                authorization=None,
                db=self.db,
            )

        self.assertIsNotNone(response.subscription)
        self.assertEqual(response.subscription.plan_id, "constellation")
        self.assertTrue(response.subscription.is_admin_grant)
        self.assertFalse(response.subscription.auto_renew)

    def test_recurring_job_repairs_historical_duplicate_subscriptions(self) -> None:
        method = self._real_card()
        old_flame = self._active_flame(method=method)
        constellation_started_at = datetime(2026, 7, 15, tzinfo=timezone.utc)
        constellation = Subscription(
            user_id=int(self.user.id),
            plan_id="constellation",
            plan_title="Созвездие",
            price_rub=1190,
            provider_payment_id="constellation-payment",
            status="active",
            payment_method_id=int(method.id),
            started_at=constellation_started_at,
            next_charge_at=datetime(2026, 8, 14, tzinfo=timezone.utc),
            is_mock=False,
        )
        self.db.add(constellation)
        self.db.commit()

        with patch(
            "app.services.payments.create_subscription_recurring_payment_in_provider",
            return_value={"id": "constellation-renewal", "status": "succeeded"},
        ) as recurring_payment:
            result = charge_due_subscriptions(
                self.db,
                now=datetime(2026, 8, 15, tzinfo=timezone.utc),
            )

        self.db.refresh(old_flame)
        self.db.refresh(constellation)
        self.assertEqual(old_flame.status, "canceled")
        self.assertIsNone(old_flame.next_charge_at)
        self.assertEqual(constellation.status, "active")
        self.assertEqual(result, {"charged": 1, "failed": 0, "due": 1})
        self.assertEqual(recurring_payment.call_count, 1)
        self.assertEqual(recurring_payment.call_args.args[0]["id"], "constellation")


if __name__ == "__main__":
    unittest.main()
