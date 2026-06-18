from __future__ import annotations

from pathlib import Path
import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class StoryCharacterStatePipelineTests(unittest.TestCase):
    def test_character_state_update_payload_merges_model_fields(self) -> None:
        existing_cards = [
            {
                "world_card_id": 1,
                "name": "Alex",
                "kind": "main_hero",
                "is_active": True,
                "status": "",
                "clothing": "",
                "location": "",
                "equipment": "",
                "mood": "",
                "attitude_to_hero": "",
                "personality": "",
            }
        ]
        raw_payload = {
            "cards": [
                {
                    "world_card_id": 1,
                    "name": "Alex",
                    "kind": "main_hero",
                    "is_active": True,
                    "status": "healthy",
                    "clothing": "black coat and boots",
                    "location": "",
                    "equipment": "phone and keys",
                    "mood": "focused",
                    "attitude_to_hero": "",
                    "personality": "",
                }
            ]
        }

        normalized = story_memory_pipeline._normalize_story_character_state_update_payload(
            raw_payload,
            existing_cards=existing_cards,
            current_location_content="Действие происходит в библиотеке.",
        )

        self.assertIsInstance(normalized, dict)
        card = normalized["cards"][0]
        self.assertEqual(card["status"], "Состояние нормальное")
        self.assertEqual(card["clothing"], "black coat and boots")
        self.assertEqual(card["equipment"], "phone and keys")
        self.assertEqual(card["location"], "в библиотеке")


    def test_character_state_status_uses_health_template(self) -> None:
        self.assertEqual(
            story_memory_pipeline._normalize_story_character_state_status_template("перелом правой руки"),
            "Ранен: перелом правой руки",
        )
        self.assertEqual(
            story_memory_pipeline._normalize_story_character_state_status_template("болен: терница"),
            "Болен: терница",
        )

    def test_auto_state_applies_structured_clothing_health_and_explicit_inventory_only(self) -> None:
        game = SimpleNamespace(
            id=10,
            character_state_enabled=True,
            character_state_payload=json.dumps(
                [
                    {
                        "world_card_id": 1,
                        "name": "Alex",
                        "kind": "main_hero",
                        "is_active": True,
                        "status": "",
                        "clothing": "",
                        "location": "",
                        "equipment": "old key",
                        "mood": "",
                        "attitude_to_hero": "",
                        "personality": "",
                    }
                ],
                ensure_ascii=False,
            ),
        )
        payload = {
            "character_updates": [
                {
                    "character_ref": {"id": 1, "name": "Alex"},
                    "clothing": {"value": "dark coat and travel boots", "source": "inferred", "should_update": True},
                    "inventory_changes": [],
                    "health": {"value": "normal", "source": "default", "should_update": True},
                }
            ]
        }

        class FakeSession:
            def flush(self):
                return None

        with patch.object(story_memory_pipeline, "_ensure_story_character_state_cards_include_world_cards", return_value=False):
            changed = story_memory_pipeline._sync_story_character_state_cards(
                db=FakeSession(),
                game=game,
                assistant_message=SimpleNamespace(id=20),
                resolved_payload_override=payload,
                current_location_content="Действие происходит в библиотеке.",
            )

        cards = json.loads(game.character_state_payload)
        self.assertTrue(changed)
        self.assertEqual(cards[0]["clothing"], "dark coat and travel boots")
        self.assertEqual(cards[0]["status"], "Состояние нормальное")
        self.assertEqual(cards[0]["equipment"], "old key")
        self.assertEqual(cards[0]["location"], "в библиотеке")

    def test_auto_state_appends_explicit_inventory_changes(self) -> None:
        game = SimpleNamespace(
            id=10,
            character_state_enabled=True,
            character_state_payload=json.dumps(
                [
                    {
                        "world_card_id": 1,
                        "name": "Alex",
                        "kind": "main_hero",
                        "is_active": True,
                        "status": "Состояние нормальное",
                        "clothing": "coat",
                        "location": "",
                        "equipment": "old key",
                        "mood": "",
                        "attitude_to_hero": "",
                        "personality": "",
                    }
                ],
                ensure_ascii=False,
            ),
        )
        payload = {
            "character_updates": [
                {
                    "character_ref": {"id": 1, "name": "Alex"},
                    "inventory_changes": [
                        {"action": "gained", "item": "silver coin", "details": "from Mira", "confidence": "high"}
                    ],
                }
            ]
        }

        class FakeSession:
            def flush(self):
                return None

        with patch.object(story_memory_pipeline, "_ensure_story_character_state_cards_include_world_cards", return_value=False):
            story_memory_pipeline._sync_story_character_state_cards(
                db=FakeSession(),
                game=game,
                assistant_message=SimpleNamespace(id=20),
                resolved_payload_override=payload,
            )

        cards = json.loads(game.character_state_payload)
        self.assertIn("old key", cards[0]["equipment"])
        self.assertIn("gained silver coin from Mira", cards[0]["equipment"])


if __name__ == "__main__":
    unittest.main()
