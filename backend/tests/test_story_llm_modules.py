from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError

from app.services.story_llm_modules import GameStateAnalysisPayload, strict_json_loads  # noqa: E402
from app.services.story_memory_prompts import build_game_state_analysis_messages  # noqa: E402


class StoryLlmModuleTests(unittest.TestCase):
    def test_json_loader_accepts_fenced_provider_response(self) -> None:
        parsed = strict_json_loads(
            '```json\n{"summary":"compressed","open_threads":[]}\n```'
        )

        self.assertEqual(parsed["summary"], "compressed")

    def test_json_loader_rejects_response_without_json_object(self) -> None:
        with self.assertRaises(ValueError):
            strict_json_loads("no structured payload")

    def test_game_state_schema_accepts_complete_inventory_value(self) -> None:
        payload = GameStateAnalysisPayload.model_validate(
            {
                "auto_state": {
                    "character_updates": [
                        {
                            "character_ref": {"id": 1, "name": "Alex"},
                            "inventory": {
                                "value": "ключ, карта",
                                "source": "explicit",
                                "should_update": True,
                            },
                        }
                    ]
                }
            }
        )

        inventory = payload.auto_state.character_updates[0].inventory
        self.assertEqual(inventory.value, "ключ, карта")
        self.assertTrue(inventory.should_update)

    def test_game_state_prompt_requires_names_profiles_and_identity_triggers(self) -> None:
        messages = build_game_state_analysis_messages(
            requested_modules=["auto_state", "npc_cards"],
            world_card="",
            previous_location=None,
            player_character_card=None,
            existing_character_cards=[],
            npc_dedup_candidates=[],
            current_character_states=[],
            player_turn="",
            previous_narrator_response="",
            narrator_response="",
        )
        prompt = "\n".join(message["content"] for message in messages)

        self.assertIn("важному безымянному NPC обязательно придумай", prompt)
        self.assertIn("Возраст: ... Внешность: ... Характер: ...", prompt)
        self.assertIn("Первым триггером новой карточки", prompt)
        self.assertIn("inventory.value is the complete current comma-separated item list", prompt)
        self.assertIn("Здоровье по умолчанию записывай одним словом «Нормальное»", prompt)
        self.assertIn("Не останавливайся после первого найденного персонажа", prompt)
        self.assertIn("Лимита «одна новая карточка за ход» нет", prompt)
        self.assertIn("PREVIOUS_NARRATOR_RESPONSE", prompt)

    def test_auto_modules_use_gemini_without_cross_model_fallback(self) -> None:
        from app.services import story_memory_pipeline

        service = story_memory_pipeline._llm_service(gemini_only=True)

        self.assertEqual(service.primary_model, "google/gemini-2.5-flash")
        self.assertEqual(service.fallback_models, [])

    def test_create_card_schema_rejects_missing_ai_generated_state(self) -> None:
        with self.assertRaises(ValidationError):
            GameStateAnalysisPayload.model_validate(
                {
                    "npc_cards": {
                        "actions": [
                            {
                                "type": "create_card",
                                "new_card": {
                                    "name": "Кира",
                                    "description": "Возраст: около 22 лет. Внешность: высокая. Характер: азартная.",
                                    "triggers": ["вторая бандитка"],
                                },
                            }
                        ]
                    }
                }
            )


if __name__ == "__main__":
    unittest.main()
