"""Scene blocking for every mode that tracks characters.

The tracked-character payload has always known where each person stands; nothing ever showed
it to the narrator, so a bodyguard posted behind his mistress's chair could reappear in the
doorway two paragraphs later. These tests pin down the delivery and, just as importantly, the
cases where the card must stay silent -- stale blocking is worse than none, because it puts
people in a room the party has already left.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_character_state_fields import (  # noqa: E402
    STORY_SCENE_LAYOUT_MAX_CHARACTERS,
    build_story_scene_layout_instruction_card,
)
from app.services.story_games import (  # noqa: E402
    deserialize_story_character_state_cards_payload,
    serialize_story_character_state_cards_payload,
)


class _Game:
    def __init__(self, cards: list[dict]) -> None:
        self.character_state_payload = json.dumps(cards, ensure_ascii=False)


def _card(name: str, **overrides) -> dict:
    card = {
        "world_card_id": abs(hash(name)) % 10_000 + 1,
        "name": name,
        "kind": "npc",
        "is_active": True,
        "location": "Чайный дом",
        "position": "у окна",
    }
    card.update(overrides)
    return card


class SceneLayoutCardTests(unittest.TestCase):
    def test_present_characters_reach_the_narrator(self) -> None:
        card = build_story_scene_layout_instruction_card(
            _Game([_card("Алисия", position="за столиком напротив"), _card("Томас", position="за спиной госпожи")]),
            location_label="Чайный дом",
        )
        self.assertIsNotNone(card)
        self.assertIn("Алисия: за столиком напротив", card["content"])
        self.assertIn("Томас: за спиной госпожи", card["content"])

    def test_nothing_to_say_means_no_card(self) -> None:
        """An ordinary two-hander must not pay tokens for an empty section."""
        self.assertIsNone(build_story_scene_layout_instruction_card(_Game([]), location_label="Лес"))
        self.assertIsNone(
            build_story_scene_layout_instruction_card(
                _Game([_card("Алисия", position="")]), location_label="Чайный дом"
            )
        )

    def test_characters_who_are_not_in_the_scene_are_left_out(self) -> None:
        card = build_story_scene_layout_instruction_card(
            _Game([_card("Алисия"), _card("Спящий", is_active=False, position="в углу")]),
            location_label="Чайный дом",
        )
        self.assertIn("Алисия", card["content"])
        self.assertNotIn("Спящий", card["content"])

    def test_blocking_from_another_place_is_dropped(self) -> None:
        # Stale staging is a trap, not information: it would place Герта in a tea house she
        # is not in, which is precisely the continuity break the card exists to prevent.
        card = build_story_scene_layout_instruction_card(
            _Game([_card("Алисия"), _card("Герта", location="Улица города", position="у фонаря")]),
            location_label="Чайный дом",
        )
        self.assertIn("Алисия", card["content"])
        self.assertNotIn("Герта", card["content"])

    def test_an_unknown_scene_keeps_everyone(self) -> None:
        # With no location label there is nothing to contradict, so filtering would only lose
        # information the narrator could have used.
        card = build_story_scene_layout_instruction_card(
            _Game([_card("Алисия"), _card("Герта", location="Улица города")]), location_label=""
        )
        self.assertIn("Алисия", card["content"])
        self.assertIn("Герта", card["content"])

    def test_the_card_is_bounded(self) -> None:
        crowd = [_card(f"Гость {index}", position=f"место {index}") for index in range(20)]
        card = build_story_scene_layout_instruction_card(_Game(crowd), location_label="Чайный дом")
        self.assertEqual(
            len([line for line in card["content"].split("\n") if line.startswith("- ")]),
            STORY_SCENE_LAYOUT_MAX_CHARACTERS,
        )

    def test_a_broken_payload_is_survivable(self) -> None:
        class Broken:
            character_state_payload = "{not json"

        self.assertIsNone(build_story_scene_layout_instruction_card(Broken(), location_label="Лес"))


class SceneLayoutPayloadTests(unittest.TestCase):
    def test_position_round_trips_through_the_payload(self) -> None:
        payload = serialize_story_character_state_cards_payload([_card("Томас", position="в дверях")])
        restored = deserialize_story_character_state_cards_payload(payload)
        self.assertEqual(restored[0]["position"], "в дверях")

    def test_position_is_always_present_and_bounded(self) -> None:
        restored = deserialize_story_character_state_cards_payload(
            json.dumps([{"world_card_id": 1, "name": "Томас", "position": "x" * 900}], ensure_ascii=False)
        )
        self.assertIn("position", restored[0])
        self.assertLessEqual(len(restored[0]["position"]), 200)

    def test_a_card_without_a_position_still_normalizes(self) -> None:
        restored = deserialize_story_character_state_cards_payload(
            json.dumps([{"world_card_id": 1, "name": "Томас"}], ensure_ascii=False)
        )
        self.assertEqual(restored[0]["position"], "")


if __name__ == "__main__":
    unittest.main()
