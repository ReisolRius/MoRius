from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main  # noqa: E402


def _game(location_module_enabled) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        location_module_enabled=location_module_enabled,
        current_location_label="старая таверна",
    )


class StoryLocationModuleToggleTests(unittest.TestCase):
    def test_enabled_game_sends_the_current_place_to_the_narrator(self) -> None:
        cards = main._build_story_prompt_context_cards(game=_game(True), memory_blocks=[])

        titles = [card["title"] for card in cards]
        self.assertIn(main.STORY_MEMORY_LOCATION_TITLE, titles)

    def test_disabled_game_sends_no_place_information_at_all(self) -> None:
        # "Off" has to mean absent, not merely unused: no location card may reach the prompt.
        cards = main._build_story_prompt_context_cards(game=_game(False), memory_blocks=[])

        titles = [card["title"] for card in cards]
        self.assertNotIn(main.STORY_MEMORY_LOCATION_TITLE, titles)
        self.assertFalse(any("таверна" in str(card.get("content", "")) for card in cards))

    def test_unset_flag_keeps_the_module_on(self) -> None:
        # The column default only materialises on INSERT, so an un-flushed or detached game
        # reports None. That must read as enabled -- the module is on by default -- and not
        # silently drop location from those turns.
        cards = main._build_story_prompt_context_cards(game=_game(None), memory_blocks=[])

        titles = [card["title"] for card in cards]
        self.assertIn(main.STORY_MEMORY_LOCATION_TITLE, titles)

    def test_only_an_explicit_false_disables_the_module(self) -> None:
        for value, expected in ((True, True), (None, True), (False, False)):
            with self.subTest(value=value):
                self.assertEqual(main._story_location_module_enabled(_game(value)), expected)


if __name__ == "__main__":
    unittest.main()
