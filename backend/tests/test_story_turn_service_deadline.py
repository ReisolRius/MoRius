from __future__ import annotations

from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_generation_cancel  # noqa: E402
from app.services.story_service_budget import (  # noqa: E402
    StoryServiceHttpRequestBudget,
    StoryTurnServiceDeadlineExceeded,
    clamp_timeout_to_story_turn_service_deadline,
    consume_story_service_http_request,
    story_turn_service_deadline_remaining_seconds,
    use_story_service_http_request_budget,
    use_story_turn_service_deadline,
)


class StoryTurnServiceDeadlineTests(unittest.TestCase):
    """The post-turn service phase holds the per-game lock, so it needs a wall-clock cap.

    Request budgets cap how many service calls a turn makes but not how long they take: two
    modules sitting on their read timeouts hold the lock for minutes, and every action the
    player takes meanwhile comes back as "the turn is still syncing".
    """

    def test_requests_are_allowed_while_time_remains(self) -> None:
        with use_story_turn_service_deadline(30.0):
            with use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=3)):
                consume_story_service_http_request()
                consume_story_service_http_request()

    def test_an_expired_turn_refuses_further_service_requests(self) -> None:
        with use_story_turn_service_deadline(0.0):
            with use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=3)):
                with self.assertRaises(StoryTurnServiceDeadlineExceeded):
                    consume_story_service_http_request()

    def test_the_deadline_error_is_a_runtime_error_like_budget_exhaustion(self) -> None:
        # Module call sites catch RuntimeError/Exception and mark the module failed-retryable;
        # the deadline has to travel the same path rather than killing the turn.
        self.assertTrue(issubclass(StoryTurnServiceDeadlineExceeded, RuntimeError))

    def test_no_deadline_in_force_leaves_behaviour_unchanged(self) -> None:
        self.assertIsNone(story_turn_service_deadline_remaining_seconds())
        with use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=1)):
            consume_story_service_http_request()
        self.assertEqual(clamp_timeout_to_story_turn_service_deadline((20, 120)), (20, 120))

    def test_read_timeout_is_clamped_to_the_remaining_allowance(self) -> None:
        with use_story_turn_service_deadline(30.0):
            connect_seconds, read_seconds = clamp_timeout_to_story_turn_service_deadline((20, 120))
        self.assertEqual(connect_seconds, 20)
        self.assertLessEqual(read_seconds, 30.0)
        self.assertGreater(read_seconds, 20.0)

    def test_a_nearly_spent_allowance_still_leaves_a_usable_timeout(self) -> None:
        # Handing out a 0.2s read timeout would turn a slow module into a guaranteed failure.
        with use_story_turn_service_deadline(0.2):
            _, read_seconds = clamp_timeout_to_story_turn_service_deadline((20, 120))
        self.assertEqual(read_seconds, 15.0)

    def test_a_timeout_shorter_than_the_allowance_is_left_alone(self) -> None:
        with use_story_turn_service_deadline(300.0):
            self.assertEqual(clamp_timeout_to_story_turn_service_deadline((20, 40)), (20, 40))


class StoryArmedCancelExpiryTests(unittest.TestCase):
    """A cancel parked for a generation that never registered must not outlive the gap.

    Otherwise it kills an unrelated turn the player starts minutes later, which looks like a
    turn dying the instant it begins.
    """

    def setUp(self) -> None:
        story_generation_cancel._CANCEL_NEXT_GENERATION_ARMED_AT.clear()
        story_generation_cancel._CURRENT_GENERATION_BY_GAME.clear()
        story_generation_cancel._CANCELLED_GENERATIONS.clear()

    tearDown = setUp

    def test_a_fresh_armed_cancel_still_lands_on_the_next_generation(self) -> None:
        self.assertTrue(story_generation_cancel.cancel_story_generation_or_next(501))

        story_generation_cancel.mark_story_generation_started(501, "gen-a")

        self.assertTrue(story_generation_cancel.is_story_generation_cancelled(501, "gen-a"))

    def test_a_stale_armed_cancel_does_not_kill_a_later_turn(self) -> None:
        self.assertTrue(story_generation_cancel.cancel_story_generation_or_next(502))

        stale = time.monotonic() - (story_generation_cancel._CANCEL_NEXT_GENERATION_TTL_SECONDS + 5)
        with patch.dict(
            story_generation_cancel._CANCEL_NEXT_GENERATION_ARMED_AT,
            {502: stale},
            clear=True,
        ):
            story_generation_cancel.mark_story_generation_started(502, "gen-b")

        self.assertFalse(story_generation_cancel.is_story_generation_cancelled(502, "gen-b"))

    def test_an_armed_cancel_is_consumed_once(self) -> None:
        story_generation_cancel.cancel_story_generation_or_next(503)

        story_generation_cancel.mark_story_generation_started(503, "gen-c")
        story_generation_cancel.mark_story_generation_finished(503, "gen-c")
        story_generation_cancel.mark_story_generation_started(503, "gen-d")

        self.assertTrue(story_generation_cancel.is_story_generation_cancelled(503, "gen-c") is False)
        self.assertFalse(story_generation_cancel.is_story_generation_cancelled(503, "gen-d"))


if __name__ == "__main__":
    unittest.main()
