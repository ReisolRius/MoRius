from __future__ import annotations

from decimal import Decimal
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import User  # noqa: E402
from app.schemas import CoinTopUpCreateRequest, SubscriptionCheckoutRequest  # noqa: E402
from app.services.payments import (  # noqa: E402
    COIN_TOP_UP_PLANS_BY_ID,
    SUBSCRIPTION_PLANS_BY_ID,
    calculate_checkout_amount_rub,
    create_payment_in_provider,
    create_subscription_payment_in_provider,
)


class VoluntaryCommissionPaymentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = User(id=42, email="buyer@example.test")

    def test_amount_is_calculated_from_catalog_price_with_half_up_kopeck_rounding(self) -> None:
        self.assertEqual(calculate_checkout_amount_rub(399), Decimal("399.00"))
        self.assertEqual(
            calculate_checkout_amount_rub(399, cover_commission=True),
            Decimal("412.97"),
        )
        self.assertEqual(
            calculate_checkout_amount_rub(299, cover_commission=True),
            Decimal("309.47"),
        )

    def test_top_up_provider_receives_server_calculated_commission_amount(self) -> None:
        plan = COIN_TOP_UP_PLANS_BY_ID["standard"]
        with patch("app.services.payments._build_receipt_payload", return_value=None), patch(
            "app.services.payments._perform_yookassa_request",
            return_value={"id": "payment-1", "status": "pending"},
        ) as provider_request:
            create_payment_in_provider(plan, self.user, cover_commission=True)

        payload = provider_request.call_args.kwargs["json_payload"]
        self.assertEqual(payload["amount"], {"value": "412.97", "currency": "RUB"})
        self.assertIn("412.97 руб", payload["description"])
        self.assertEqual(payload["metadata"]["cover_commission"], "true")
        self.assertEqual(payload["metadata"]["plan_id"], "standard")

    def test_subscription_provider_receives_server_calculated_first_payment_amount(self) -> None:
        plan = SUBSCRIPTION_PLANS_BY_ID["spark"]
        with patch("app.services.payments._build_receipt_payload", return_value=None), patch(
            "app.services.payments._perform_yookassa_request",
            return_value={"id": "subscription-payment-1", "status": "pending"},
        ) as provider_request:
            create_subscription_payment_in_provider(plan, self.user, cover_commission=True)

        payload = provider_request.call_args.kwargs["json_payload"]
        self.assertEqual(payload["amount"], {"value": "309.47", "currency": "RUB"})
        self.assertIn("309.47 руб", payload["description"])
        self.assertEqual(payload["metadata"]["cover_commission"], "true")
        self.assertTrue(payload["save_payment_method"])

    def test_checkout_requests_only_accept_plan_and_boolean_flag(self) -> None:
        top_up = CoinTopUpCreateRequest.model_validate(
            {"plan_id": "standard", "cover_commission": True, "amount_rub": "0.01"}
        )
        subscription = SubscriptionCheckoutRequest.model_validate(
            {"plan_id": "spark", "cover_commission": True, "amount_rub": "0.01"}
        )

        self.assertTrue(top_up.cover_commission)
        self.assertTrue(subscription.cover_commission)
        self.assertFalse(hasattr(top_up, "amount_rub"))
        self.assertFalse(hasattr(subscription, "amount_rub"))


if __name__ == "__main__":
    unittest.main()
