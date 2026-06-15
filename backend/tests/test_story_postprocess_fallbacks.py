from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main  # noqa: E402
from app.models import StoryGame, StoryMessage  # noqa: E402
from app.services import story_memory_pipeline  # noqa: E402
from app.services.story_service_budget import (  # noqa: E402
    StoryServiceHttpRequestBudget,
    consume_story_service_http_request,
    use_story_service_http_request_budget,
)


class StoryPostprocessFallbackTests(unittest.TestCase):
    def test_missing_unified_payload_does_not_trigger_location_model_fallback(self) -> None:
        game = StoryGame(id=10, user_id=1, title="Test")
        game.memory_optimization_enabled = True
        game.character_state_enabled = False
        game.auto_npc_cards_enabled = False
        game.environment_enabled = False
        game.environment_time_enabled = False
        game.environment_weather_enabled = False

        assistant_message = StoryMessage(
            id=20,
            game_id=10,
            role=main.STORY_ASSISTANT_ROLE,
            content="Герой входит в зал гильдии и подходит к стойке.",
        )

        class FakeSession:
            def scalar(self, *_args, **_kwargs):
                return None

            def commit(self):
                return None

        location_payloads: list[object] = []

        def capture_location_payload(**kwargs):
            location_payloads.append(kwargs.get("resolved_payload_override"))
            return False

        with (
            patch.object(main, "_list_story_latest_assistant_message_ids", return_value=[20]),
            patch.object(main, "_get_story_main_hero_name_for_memory", return_value="Герой"),
            patch.object(main, "_should_store_story_raw_memory_turn", return_value=True),
            patch.object(main, "_touch_story_game"),
            patch.object(story_memory_pipeline, "_upsert_story_raw_memory_block", return_value=True),
            patch.object(story_memory_pipeline, "_sync_story_raw_memory_blocks_for_recent_turns", return_value=False),
            patch.object(story_memory_pipeline, "_get_story_latest_location_memory_content", return_value=""),
            patch.object(story_memory_pipeline, "_story_environment_any_enabled_for_game", return_value=False),
            patch.object(story_memory_pipeline, "_extract_story_postprocess_memory_payload", return_value=None),
            patch.object(story_memory_pipeline, "_extract_story_important_plot_card_payload", return_value=None),
            patch.object(story_memory_pipeline, "_extract_story_important_plot_card_payload_locally", return_value=None),
            patch.object(story_memory_pipeline, "_upsert_story_location_memory_block", side_effect=capture_location_payload),
            patch.object(story_memory_pipeline, "_rebalance_story_memory_layers"),
        ):
            main._upsert_story_plot_memory_card(
                db=FakeSession(),
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt_override="Я захожу в гильдию.",
                latest_assistant_text_override=assistant_message.content,
                resolved_postprocess_payload_override=None,
                memory_optimization_enabled=True,
                allow_model_postprocess_request=True,
            )

        self.assertEqual(len(location_payloads), 1)
        self.assertIsInstance(location_payloads[0], dict)
        self.assertIn(location_payloads[0].get("action"), {"keep", "update"})

    def test_story_service_budget_caps_postprocess_requests_at_two(self) -> None:
        budget = StoryServiceHttpRequestBudget(max_requests=2)

        with use_story_service_http_request_budget(budget):
            consume_story_service_http_request()
            consume_story_service_http_request()
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                consume_story_service_http_request()

        self.assertEqual(budget.used_requests, 2)


if __name__ == "__main__":
    unittest.main()
