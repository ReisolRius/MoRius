from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import Base  # noqa: E402
from app.models import CoinPurchase, ReferralReward, User  # noqa: E402
from app.services.concurrency import grant_purchase_coins_once  # noqa: E402
from app.services.payments import (  # noqa: E402
    grant_purchase_and_referral_rewards_once_for_purchase,
    sync_purchase_status,
    sync_user_pending_purchases,
)


class PaymentIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    @staticmethod
    def _create_referral_purchase(
        db,
        *,
        suffix: str,
        status: str = "pending",
    ) -> tuple[User, User, CoinPurchase]:
        referrer = User(email=f"referrer-{suffix}@example.test", coins=0)
        referred = User(email=f"referred-{suffix}@example.test", coins=0)
        db.add_all([referrer, referred])
        db.flush()
        referred.referred_by_user_id = int(referrer.id)
        referred.referral_applied_at = datetime.now(timezone.utc)
        purchase = CoinPurchase(
            user_id=int(referred.id),
            provider="yookassa",
            provider_payment_id=f"referral-payment-{suffix}",
            plan_id="standard",
            plan_title="Путник",
            amount_rub=399,
            coins=400,
            status=status,
        )
        db.add(purchase)
        db.commit()
        return referrer, referred, purchase

    def test_purchase_coins_are_granted_once(self) -> None:
        with self.Session() as db:
            user = User(email="buyer@example.test", coins=0)
            purchase = CoinPurchase(
                user_id=1,
                provider="yookassa",
                provider_payment_id="payment-idempotency-test",
                plan_id="standard",
                plan_title="Путник",
                amount_rub=399,
                coins=400,
                status="succeeded",
            )
            db.add(user)
            db.flush()
            purchase.user_id = int(user.id)
            db.add(purchase)
            db.commit()

            first_grant = grant_purchase_coins_once(
                db,
                purchase_id=int(purchase.id),
                user_id=int(user.id),
                coins=int(purchase.coins),
                granted_at=datetime.now(timezone.utc),
            )
            db.commit()
            db.refresh(user)
            db.refresh(purchase)

            second_grant = grant_purchase_coins_once(
                db,
                purchase_id=int(purchase.id),
                user_id=int(user.id),
                coins=int(purchase.coins),
                granted_at=datetime.now(timezone.utc),
            )
            db.commit()
            db.refresh(user)

            self.assertTrue(first_grant)
            self.assertFalse(second_grant)
            self.assertEqual(user.coins, 400)
            self.assertIsNotNone(purchase.coins_granted_at)

    def test_pending_and_canceled_purchases_do_not_grant_referral_bonus(self) -> None:
        with self.Session() as db:
            for payment_status in ("pending", "canceled"):
                with self.subTest(payment_status=payment_status):
                    referrer, referred, purchase = self._create_referral_purchase(
                        db,
                        suffix=payment_status,
                    )

                    result = sync_purchase_status(
                        db=db,
                        purchase=purchase,
                        user=referred,
                        provider_payment_payload={"status": payment_status},
                    )
                    db.refresh(referrer)
                    db.refresh(referred)
                    db.refresh(purchase)

                    self.assertFalse(result.purchase_coins_granted)
                    self.assertFalse(result.referral_bonus_granted)
                    self.assertEqual(referrer.coins, 0)
                    self.assertEqual(referred.coins, 0)
                    self.assertIsNone(referred.referral_bonus_claimed_at)
                    self.assertIsNone(purchase.coins_granted_at)

            rewards = db.scalars(select(ReferralReward)).all()
            self.assertEqual(rewards, [])

    def test_successful_purchase_grants_500_to_both_users_once(self) -> None:
        with self.Session() as db:
            referrer, referred, purchase = self._create_referral_purchase(db, suffix="success")

            first_result = sync_purchase_status(
                db=db,
                purchase=purchase,
                user=referred,
                provider_payment_payload={"status": "succeeded"},
            )
            db.refresh(referrer)
            db.refresh(referred)
            db.refresh(purchase)

            self.assertTrue(first_result.purchase_coins_granted)
            self.assertTrue(first_result.referral_bonus_granted)
            self.assertEqual(first_result.referral_bonus_amount, 500)
            self.assertEqual(referrer.coins, 500)
            self.assertEqual(referred.coins, 900)
            self.assertIsNotNone(referred.referral_bonus_claimed_at)
            self.assertIsNotNone(purchase.coins_granted_at)

            second_result = sync_purchase_status(
                db=db,
                purchase=purchase,
                user=referred,
                provider_payment_payload={"status": "succeeded"},
            )
            db.refresh(referrer)
            db.refresh(referred)

            rewards = db.scalars(select(ReferralReward)).all()
            self.assertFalse(second_result.purchase_coins_granted)
            self.assertFalse(second_result.referral_bonus_granted)
            self.assertEqual(referrer.coins, 500)
            self.assertEqual(referred.coins, 900)
            self.assertEqual(len(rewards), 1)
            self.assertEqual(rewards[0].referrer_reward_amount, 500)
            self.assertEqual(rewards[0].referred_reward_amount, 500)
            self.assertEqual(rewards[0].status, "granted")

    def test_referral_grant_retries_after_purchase_coins_were_already_granted(self) -> None:
        with self.Session() as db:
            referrer, referred, purchase = self._create_referral_purchase(
                db,
                suffix="retry",
                status="succeeded",
            )
            base_grant = grant_purchase_coins_once(
                db,
                purchase_id=int(purchase.id),
                user_id=int(referred.id),
                coins=int(purchase.coins),
                granted_at=datetime.now(timezone.utc),
            )
            db.commit()
            db.refresh(purchase)

            with patch("app.services.payments.is_payments_configured", return_value=True), patch(
                "app.services.payments.fetch_payment_from_provider"
            ) as fetch_payment_mock:
                sync_user_pending_purchases(db, referred)
                fetch_payment_mock.assert_not_called()
            db.refresh(referrer)
            db.refresh(referred)

            duplicate_result = grant_purchase_and_referral_rewards_once_for_purchase(db, purchase, referred)
            db.commit()
            db.refresh(referrer)
            db.refresh(referred)

            rewards = db.scalars(select(ReferralReward)).all()
            self.assertTrue(base_grant)
            self.assertFalse(duplicate_result.purchase_coins_granted)
            self.assertFalse(duplicate_result.referral_bonus_granted)
            self.assertEqual(referrer.coins, 500)
            self.assertEqual(referred.coins, 900)
            self.assertEqual(len(rewards), 1)


if __name__ == "__main__":
    unittest.main()
