from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_display_modes import (  # noqa: E402
    STORY_DISPLAY_MODE_TEXT,
    STORY_DISPLAY_MODE_VISUAL_NOVEL,
    can_user_use_visual_novel_mode,
    normalize_story_display_mode,
)
from app.services.story_visual_novel import (  # noqa: E402
    build_visual_novel_instruction_card,
    is_story_visual_novel_enabled_for_user,
    normalize_visual_novel_response,
)
from app.services.story_runtime import _calculate_story_turn_cost_tokens  # noqa: E402


class StoryVisualNovelTests(unittest.TestCase):
    def test_json_response_is_split_into_ordered_beats(self) -> None:
        response = normalize_visual_novel_response(
            """
            ```json
            {
              "beats": [
                {"type": "scene", "text": "Комната стихает."},
                {"type": "line", "speaker": "Мира", "emotion": "joy", "text": "Я нашла ключ.", "visual_hint": "держит ключ"},
                {"type": "thought", "speaker": "Мира", "emotion": "thinking", "text": "Только бы он подошел."}
              ]
            }
            ```
            """
        )

        self.assertEqual(response.source_format, "json")
        self.assertEqual([beat.beat_type for beat in response.beats], ["narration", "dialogue", "thought"])
        self.assertEqual(response.beats[1].speaker_name, "Мира")
        self.assertEqual(response.beats[1].emotion, "happy")
        self.assertEqual(response.beats[2].emotion, "thoughtful")
        self.assertIn("Мира: Я нашла ключ.", response.rendered_text)
        self.assertNotIn("```", response.rendered_text)

    def test_text_response_falls_back_to_markers_and_speaker_lines(self) -> None:
        response = normalize_visual_novel_response(
            "Дождь стучит по стеклу.\n\n[[THOUGHT:Мира]] Нужно уходить.\n\nСтраж: Стоять!"
        )

        self.assertEqual(response.source_format, "text")
        self.assertEqual([beat.beat_type for beat in response.beats], ["narration", "thought", "dialogue"])
        self.assertEqual(response.beats[1].speaker_name, "Мира")
        self.assertEqual(response.beats[1].emotion, "thoughtful")
        self.assertEqual(response.beats[2].speaker_name, "Страж")

    def test_visual_novel_mode_requires_admin_user_and_game_mode(self) -> None:
        admin = SimpleNamespace(role="administrator")
        player = SimpleNamespace(role="user")
        visual_game = SimpleNamespace(display_mode="visual-novel")
        text_game = SimpleNamespace(display_mode="text")

        self.assertEqual(normalize_story_display_mode("visual-novel"), STORY_DISPLAY_MODE_VISUAL_NOVEL)
        self.assertEqual(normalize_story_display_mode("unknown"), STORY_DISPLAY_MODE_TEXT)
        self.assertTrue(can_user_use_visual_novel_mode(admin))
        self.assertTrue(can_user_use_visual_novel_mode(SimpleNamespace(role=" Administrator ")))
        self.assertFalse(can_user_use_visual_novel_mode(player))
        self.assertTrue(is_story_visual_novel_enabled_for_user(visual_game, admin))
        self.assertFalse(is_story_visual_novel_enabled_for_user(visual_game, player))
        self.assertFalse(is_story_visual_novel_enabled_for_user(text_game, admin))

    def test_instruction_card_is_hidden_service_context(self) -> None:
        card = build_visual_novel_instruction_card()

        self.assertEqual(card["source_kind"], "visual_novel")
        self.assertIn('"beats"', card["content"])
        self.assertIn("return valid JSON only", card["content"])

    def test_instruction_card_contributes_to_runtime_context_estimate(self) -> None:
        card = build_visual_novel_instruction_card()
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=lambda context_usage_tokens, _model_name: int(context_usage_tokens or 0),
            context_limit_tokens=8_000,
            model_name="test",
            context_messages=[],
            instruction_cards=[card],
            plot_cards=[],
            world_cards=[],
            memory_optimization_enabled=True,
        )

        self.assertGreater(cost, 0)


if __name__ == "__main__":
    unittest.main()
