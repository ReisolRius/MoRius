from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as monolith_main  # noqa: E402


class StoryImageClothingPriorityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.card = {
            "id": 7,
            "title": "Mira",
            "kind": "npc",
            "content": "Appearance: long dark hair. She used to wear a red dress.",
            "clothing": "black travel coat, leather trousers, and high boots",
        }

    def test_explicit_clothing_is_the_first_appearance_lock_fragment(self) -> None:
        lock = monolith_main._extract_story_turn_image_appearance_lock_from_card(self.card)

        self.assertIn("CURRENT OUTFIT (EXPLICIT CARD FIELD)", lock)
        self.assertIn("black travel coat", lock)
        self.assertTrue(lock.startswith("CURRENT OUTFIT (EXPLICIT CARD FIELD)"))

    def test_full_character_lock_marks_structured_clothing_as_highest_priority(self) -> None:
        locks = monolith_main._build_story_turn_image_full_character_card_locks(
            user_prompt="I look at Mira.",
            assistant_text="Mira stands by the door.",
            world_cards=[self.card],
        )

        self.assertEqual(len(locks), 1)
        self.assertIn("EXPLICIT_CLOTHING_LOCK (HIGHEST OUTFIT PRIORITY)", locks[0])
        self.assertIn("use EXPLICIT_CLOTHING_LOCK", locks[0])

    def test_prompt_composer_receives_explicit_clothing_separately_from_description(self) -> None:
        rendered = monolith_main._format_story_turn_image_prompt_composer_cards(
            [self.card],
            max_cards=4,
            max_content_chars=800,
        )

        self.assertIn("EXPLICIT_CLOTHING (highest outfit priority)", rendered)
        self.assertIn("black travel coat", rendered)
        self.assertIn("Description:", rendered)


if __name__ == "__main__":
    unittest.main()
