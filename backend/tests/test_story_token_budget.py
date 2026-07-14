from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main  # noqa: E402
from app.services.story_token_budget import TokenBudgetService, TokenCounter  # noqa: E402


class StoryTokenBudgetTests(unittest.TestCase):
    def test_standard_budget_subtracts_active_cards_before_tier_split(self) -> None:
        service = TokenBudgetService(TokenCounter(safety_margin=1.0))

        result = service.calculate(
            user_memory_token_limit=30_000,
            active_cards_token_count=10_000,
            optimization_mode="standard",
        )

        self.assertEqual(result.available_history_tokens, 20_000)
        self.assertEqual(result.fresh_budget, 10_000)
        self.assertEqual(result.compressed_budget, 6_000)
        self.assertEqual(result.facts_budget, 4_000)

    def test_token_counter_is_word_like_not_character_length(self) -> None:
        counter = TokenCounter(safety_margin=1.0)

        self.assertEqual(counter.count_text("очень длинное слово", apply_margin=False), 3)
        self.assertLess(counter.count_text("очень длинное слово"), len("очень длинное слово"))

    def test_memory_prompt_cards_are_dropped_whole_instead_of_sentence_trimmed(self) -> None:
        card = {
            "title": "Ожидает сжатия: старый ход",
            "content": "Первое предложение. Второе предложение. Третье предложение.",
            "source_kind": "memory",
            "memory_layer": "raw_pending",
        }

        fitted = main._trim_story_plot_cards_to_context_limit([card], 4)

        self.assertEqual(fitted, [])

    def test_current_location_context_card_is_priority_location_memory(self) -> None:
        game = SimpleNamespace(current_location_label="старая таверна")

        cards = main._build_story_prompt_context_cards(game=game, memory_blocks=[])

        location_card = next(card for card in cards if card["title"] == "Место")
        self.assertEqual(location_card["memory_layer"], "location")
        self.assertIn("старая таверна", location_card["content"].casefold())

    def test_location_prompt_card_survives_context_pressure(self) -> None:
        cards = [
            {
                "title": "Место",
                "content": "Текущее место действия: старая таверна.",
                "source_kind": "context",
                "memory_layer": "location",
            },
            {
                "title": "Окружение: шум",
                "content": "word " * 4_000,
                "source_kind": "context",
            },
            {
                "title": "Свежая память: старый ход",
                "content": "word " * 4_000,
                "source_kind": "memory",
                "memory_layer": "raw",
            },
        ]

        fitted = main._fit_story_plot_cards_to_context_limit(
            instruction_cards=[],
            plot_cards=cards,
            world_cards=[],
            context_limit_tokens=6_000,
            reserved_history_tokens=4_500,
        )

        self.assertIn("Место", [card["title"] for card in fitted])


if __name__ == "__main__":
    unittest.main()
