from __future__ import annotations

from pathlib import Path
import sys
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


if __name__ == "__main__":
    unittest.main()
