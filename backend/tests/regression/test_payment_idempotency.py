from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import Base  # noqa: E402
from app.models import CoinPurchase, User  # noqa: E402
from app.services.concurrency import grant_purchase_coins_once  # noqa: E402


class PaymentIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

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


if __name__ == "__main__":
    unittest.main()
