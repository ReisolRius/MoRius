from __future__ import annotations

from pathlib import Path
import sys
import unittest


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
        self.assertEqual(card["status"], "healthy")
        self.assertEqual(card["clothing"], "black coat and boots")
        self.assertEqual(card["equipment"], "phone and keys")
        self.assertEqual(card["location"], "в библиотеке")


if __name__ == "__main__":
    unittest.main()
