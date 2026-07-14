from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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

        self.assertIn("Only perform the modules listed in REQUESTED_MODULES", prompt)
        self.assertIn("If an important NPC is unnamed, invent a lore-appropriate personal name", prompt)
        self.assertIn("Age: ... Appearance: ... Character: ...", prompt)
        self.assertIn("inventory.value is the complete current comma-separated item list", prompt)
        self.assertIn("Return all qualifying new NPC actions from the turn", prompt)
        self.assertIn("Existing cards are immutable", prompt)
        self.assertIn("PREVIOUS_NARRATOR_RESPONSE", prompt)

    def test_auto_modules_use_glm_flash_without_cross_model_fallback(self) -> None:
        from app.services import story_memory_pipeline

        service = story_memory_pipeline._llm_service(service_model_only=True)

        self.assertEqual(service.primary_model, "z-ai/glm-4.7-flash")
        self.assertEqual(service.fallback_models, [])

    def test_create_card_schema_tolerates_missing_ai_generated_state(self) -> None:
        payload = GameStateAnalysisPayload.model_validate(
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

        self.assertEqual(payload.npc_cards.actions[0].type, "create_card")
        self.assertEqual(payload.npc_cards.actions[0].new_card.name, "Кира")
        self.assertEqual(payload.npc_cards.actions[0].new_card.clothing, "")


if __name__ == "__main__":
    unittest.main()
