from __future__ import annotations

from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
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
    def test_player_turn_location_fallback_is_disabled(self) -> None:
        payload = story_memory_pipeline._build_story_location_fallback_payload_from_player_turn(
            latest_user_prompt=(
                "\u042f \u0448\u0435\u043b \u043f\u043e \u043b\u0435\u0441\u0443 "
                "\u043a \u0441\u0435\u0432\u0435\u0440\u0443 \u043e\u0442 "
                "\u0441\u0442\u043e\u043b\u0438\u0446\u044b, "
                "\u043d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u043b\u0441\u044f "
                "\u0432 \u0434\u0440\u0443\u0433\u043e\u0439 \u0433\u043e\u0440\u043e\u0434."
            ),
            latest_assistant_text="",
        )

        self.assertIsNone(payload)

    def test_location_keep_is_not_repaired_by_local_player_turn_fallback(self) -> None:
        fallback_payload = story_memory_pipeline._build_story_location_fallback_payload_from_player_turn(
            latest_user_prompt="\u042f \u0448\u0435\u043b \u043f\u043e \u043b\u0435\u0441\u0443.",
            latest_assistant_text="\u041b\u0438\u0440\u0430 \u0443\u043b\u044b\u0431\u043d\u0443\u043b\u0430\u0441\u044c.",
        )

        should_repair = story_memory_pipeline._should_repair_story_location_payload_with_local_fallback(
            current_location_content=(
                "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 "
                "\u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442 "
                "\u043d\u0430 \u0443\u043b\u0438\u0446\u0435 "
                "\u0441\u0442\u043e\u043b\u0438\u0446\u044b."
            ),
            model_payload={"action": "keep"},
            fallback_payload=fallback_payload,
        )

        self.assertIsNone(fallback_payload)
        self.assertFalse(should_repair)

    def test_unified_postprocess_keeps_model_location_decision_without_local_repair(self) -> None:
        game = SimpleNamespace(
            id=42,
            environment_current_datetime="",
            environment_current_weather="",
            environment_tomorrow_weather="",
            environment_turn_step_minutes=5,
        )

        with (
            patch.object(story_memory_pipeline, "settings", SimpleNamespace(polza_api_key="test-key")),
            patch.object(story_memory_pipeline, "_get_story_main_hero_name_for_memory", return_value="Alex"),
            patch.object(story_memory_pipeline, "_list_story_known_character_names_for_memory", return_value=["Alex"]),
            patch.object(
                story_memory_pipeline,
                "_request_polza_story_text",
                return_value='{"location":{"action":"keep"}}',
            ) as request_mock,
        ):
            payload = story_memory_pipeline._extract_story_postprocess_memory_payload(
                db=SimpleNamespace(),
                game=game,
                current_location_content=(
                    "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 "
                    "\u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442 "
                    "\u043d\u0430 \u0443\u043b\u0438\u0446\u0435 "
                    "\u0441\u0442\u043e\u043b\u0438\u0446\u044b."
                ),
                latest_user_prompt="\u042f \u0448\u0435\u043b \u043f\u043e \u043b\u0435\u0441\u0443.",
                previous_assistant_text="",
                latest_assistant_text="\u041b\u0438\u0440\u0430 \u043f\u043e\u0434\u043d\u044f\u043b\u0430 \u0433\u043b\u0430\u0437\u0430.",
                raw_memory_enabled=False,
                location_enabled=True,
                environment_enabled=False,
                character_state_enabled=False,
                important_event_enabled=False,
                auto_npc_cards_enabled=False,
            )

        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(payload, {"location": {"action": "keep"}})

    def test_postprocess_section_aliases_accept_wrapped_npcs(self) -> None:
        raw_payload = {"result": {"npcs": [{"name": "\u041b\u0438\u0440\u0430"}]}}

        resolved = story_memory_pipeline._resolve_story_postprocess_section_payload(
            parsed_payload=raw_payload,
            section_name="auto_npcs",
            requested_sections=["auto_npcs"],
        )
        coerced = story_memory_pipeline._coerce_story_auto_npcs_section_payload(resolved)

        self.assertEqual(coerced, [{"name": "\u041b\u0438\u0440\u0430"}])

    def test_local_auto_npc_payload_is_disabled(self) -> None:
        assistant_text = (
            "[[NPC:\u041b\u0438\u0440\u0430]] "
            "\u0410\u043b\u0435\u043a\u0441, \u043d\u0443 \u043a\u043e\u043d\u0435\u0447\u043d\u043e.\n\n"
            "\u041b\u0438\u0440\u0430 \u0443\u043b\u044b\u0431\u043d\u0443\u043b\u0430\u0441\u044c; "
            "\u0434\u043b\u0438\u043d\u043d\u044b\u0435 "
            "\u044d\u043b\u044c\u0444\u0438\u0439\u0441\u043a\u0438\u0435 "
            "\u0443\u0448\u0438 \u0441\u043b\u0435\u0433\u043a\u0430 "
            "\u0434\u0440\u043e\u0433\u043d\u0443\u043b\u0438."
        )

        payloads = story_memory_pipeline._build_story_auto_npc_local_payloads(
            latest_user_prompt="\u042f \u043f\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e \u041b\u0438\u0440\u0443.",
            latest_assistant_text=assistant_text,
            existing_identity_keys=set(),
        )

        self.assertEqual(payloads, [])

    def test_missing_unified_payload_delegates_location_to_ai_module_without_local_override(self) -> None:
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

            def rollback(self):
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
        self.assertIsNone(location_payloads[0])

    def test_missing_unified_payload_marks_retryable_without_local_important_fallback(self) -> None:
        game = StoryGame(id=11, user_id=1, title="Test")
        game.memory_optimization_enabled = True
        game.character_state_enabled = False
        game.auto_npc_cards_enabled = False
        game.environment_enabled = False
        game.environment_time_enabled = False
        game.environment_weather_enabled = False

        assistant_message = StoryMessage(
            id=21,
            game_id=11,
            role=main.STORY_ASSISTANT_ROLE,
            content="The narrator text was produced and must not be lost.",
        )

        class FakeSession:
            def scalar(self, *_args, **_kwargs):
                return None

            def commit(self):
                return None

            def rollback(self):
                return None

        with (
            patch.object(main, "_list_story_latest_assistant_message_ids", return_value=[21]),
            patch.object(main, "_get_story_main_hero_name_for_memory", return_value="Hero"),
            patch.object(main, "_should_store_story_raw_memory_turn", return_value=True),
            patch.object(main, "_touch_story_game"),
            patch.object(story_memory_pipeline, "_upsert_story_raw_memory_block", return_value=True),
            patch.object(story_memory_pipeline, "_sync_story_raw_memory_blocks_for_recent_turns", return_value=False),
            patch.object(story_memory_pipeline, "_get_story_latest_location_memory_content", return_value=""),
            patch.object(story_memory_pipeline, "_story_environment_any_enabled_for_game", return_value=False),
            patch.object(story_memory_pipeline, "_extract_story_postprocess_memory_payload", return_value=None),
            patch.object(
                story_memory_pipeline,
                "_extract_story_important_plot_card_payload_locally",
                side_effect=AssertionError("local important fallback must not be used"),
            ) as local_fallback_mock,
            patch.object(story_memory_pipeline, "_upsert_story_location_memory_block", return_value=False),
            patch.object(story_memory_pipeline, "_rebalance_story_memory_layers"),
        ):
            result = main._upsert_story_plot_memory_card(
                db=FakeSession(),
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt_override="Player turn",
                latest_assistant_text_override=assistant_message.content,
                resolved_postprocess_payload_override=None,
                memory_optimization_enabled=True,
                allow_model_postprocess_request=True,
            )

        self.assertEqual(local_fallback_mock.call_count, 0)
        self.assertEqual(len(result), 3)
        meta = result[2]
        self.assertTrue(meta["postprocess_pending"])
        self.assertTrue(meta["postprocess_failed"])
        self.assertEqual(meta["postprocess_status"], "storyteller_succeeded_postprocessing_failed_retryable")
        self.assertIn("unified_postprocess", meta["postprocess_failed_modules"])

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
