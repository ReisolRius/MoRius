from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import promo  # noqa: E402
from app.services.payments import (  # noqa: E402
    COIN_TOP_UP_PLANS,
    SUBSCRIPTION_PLANS,
    get_coin_plan,
    get_coin_plans,
    get_subscription_plan,
)


def _at(moment: datetime):
    return patch.object(promo, "_now", return_value=moment)


_BEFORE_END = promo.PROMO_ENDS_AT - timedelta(minutes=1)
_AFTER_END = promo.PROMO_ENDS_AT


class PromoWindowTests(unittest.TestCase):
    def test_promo_runs_through_the_final_minute_of_13_august(self) -> None:
        last_minute = datetime(2026, 8, 13, 23, 59, 59, tzinfo=promo.PROMO_TIMEZONE)
        with _at(last_minute):
            self.assertTrue(promo.is_promo_active())

    def test_promo_is_over_at_midnight(self) -> None:
        with _at(_AFTER_END):
            self.assertFalse(promo.is_promo_active())

    def test_prices_return_to_normal_once_it_expires(self) -> None:
        with _at(_AFTER_END):
            for plan in get_coin_plans():
                with self.subTest(plan=plan["id"]):
                    self.assertEqual(plan["price_rub"], plan["base_price_rub"])
                    self.assertFalse(plan["promo_active"])
                    self.assertEqual(plan["promo_discount_percent"], 0)


class PromoPricingTests(unittest.TestCase):
    def test_every_sol_pack_is_ten_percent_off_while_it_runs(self) -> None:
        with _at(_BEFORE_END):
            for source, plan in zip(COIN_TOP_UP_PLANS, get_coin_plans()):
                with self.subTest(plan=plan["id"]):
                    self.assertEqual(plan["base_price_rub"], source["price_rub"])
                    self.assertLess(plan["price_rub"], source["price_rub"])
                    self.assertEqual(plan["price_rub"], -(-source["price_rub"] * 90 // 100))
                    self.assertTrue(plan["promo_active"])

    def test_every_subscription_is_ten_percent_off_while_it_runs(self) -> None:
        with _at(_BEFORE_END):
            for source in SUBSCRIPTION_PLANS:
                with self.subTest(plan=source["id"]):
                    plan = get_subscription_plan(str(source["id"]))
                    self.assertEqual(plan["base_price_rub"], source["price_rub"])
                    self.assertEqual(plan["price_rub"], -(-source["price_rub"] * 90 // 100))

    def test_the_charged_plan_carries_the_discounted_price(self) -> None:
        # The provider charge, the stored purchase amount and the receipt all read
        # plan["price_rub"], so this is what a buyer is actually charged.
        with _at(_BEFORE_END):
            self.assertEqual(get_coin_plan("standard")["price_rub"], 360)

    def test_discounting_is_not_applied_twice(self) -> None:
        # Plan dicts are passed around and re-wrapped; base_price_rub is what the discount is
        # computed from, so a second pass must be a no-op rather than another 10% off.
        with _at(_BEFORE_END):
            once = promo.apply_promo_to_plan({"price_rub": 1000})
            twice = promo.apply_promo_to_plan(once)
            self.assertEqual(once["price_rub"], twice["price_rub"])
            self.assertEqual(twice["base_price_rub"], 1000)

    def test_a_plan_never_rounds_down_to_free(self) -> None:
        with _at(_BEFORE_END):
            self.assertGreaterEqual(promo.discounted_price_rub(1), 1)
            self.assertEqual(promo.discounted_price_rub(0), 0)


if __name__ == "__main__":
    unittest.main()
