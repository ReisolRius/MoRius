from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class StoryMemoryCompressionTests(unittest.TestCase):
    def test_raw_memory_preserves_latest_full_text_speakers_without_markup(self) -> None:
        content = story_memory_pipeline._build_story_raw_memory_block_content(
            latest_user_prompt="Я открываю дверь и показываю Марине знак ждать у входа.",
            latest_assistant_text=(
                "[[NPC:Марина]] Стой, я слышу шаги за стеной.\n\n"
                "Марина поднимает фонарь, а JRius остается у двери."
            ),
            player_turn_label="JRius",
            known_character_names=["JRius", "Марина"],
            preserve_user_text=True,
            preserve_assistant_text=True,
        )

        self.assertIn("полный текст", content.casefold())
        self.assertNotIn("подробный пересказ", content)
        self.assertNotIn("[[", content)
        self.assertIn("JRius:", content)
        self.assertIn("Марина:", content)

    def test_raw_memory_preserves_full_text_even_without_preserve_flags(self) -> None:
        user_tail = "Финальный приказ игрока должен остаться в памяти целиком."
        assistant_tail = "Финальная реплика рассказчика должна остаться без обрезки."
        content = story_memory_pipeline._build_story_raw_memory_block_content(
            latest_user_prompt=(
                "Алекс долго объясняет план отхода через северные ворота. " * 20
                + user_tail
            ),
            latest_assistant_text=(
                "Алисия внимательно слушает и отмечает, что стража уже меняет караул. " * 30
                + assistant_tail
            ),
            player_turn_label="Алекс",
            known_character_names=["Алекс", "Алисия"],
            preserve_user_text=False,
            preserve_assistant_text=False,
        )

        self.assertIn("полный текст", content.casefold())
        self.assertNotIn("подробный пересказ", content)
        self.assertIn(user_tail, content)
        self.assertIn(assistant_tail, content)

    def test_local_summary_keeps_latin_speaker_name(self) -> None:
        summary = story_memory_pipeline._build_story_memory_summary_without_truncation(
            "JRius: Я беру меч и закрываю дверь. Марина: Стой у входа и слушай шаги.",
            super_mode=False,
            player_name="JRius",
            known_character_names=["JRius", "Марина"],
            max_lines=4,
            max_chars=400,
        )

        self.assertIn("JRius:", summary)
        self.assertIn("Марина:", summary)

    def test_model_compression_falls_back_after_unusable_primary_payload(self) -> None:
        source_text = (
            "Alex вошел в зал и закрыл дверь. "
            "Марина осталась у входа и слушала шаги за стеной. "
        ) * 12
        fallback_text = "Alex вошел в зал и закрыл дверь, а Марина осталась у входа слушать шаги."

        with (
            patch.object(
                story_memory_pipeline,
                "settings",
                SimpleNamespace(polza_api_key="test-key"),
            ),
            patch.object(
                story_memory_pipeline,
                "_request_polza_story_text",
                side_effect=[source_text, fallback_text],
            ) as request_mock,
        ):
            _, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content=source_text,
                model_name="primary-model",
                fallback_model_names=["fallback-model"],
                super_mode=False,
                player_name="Alex",
                known_character_names=["Alex", "Марина"],
            )

        self.assertEqual(content, fallback_text)
        self.assertEqual(request_mock.call_count, 2)
        self.assertEqual(
            [call.kwargs["model_name"] for call in request_mock.call_args_list],
            ["primary-model", "fallback-model"],
        )
        self.assertEqual(
            [call.kwargs["fallback_model_names"] for call in request_mock.call_args_list],
            [[], []],
        )
        self.assertTrue(all(call.kwargs["retry_on_rate_limit"] is False for call in request_mock.call_args_list))


if __name__ == "__main__":
    unittest.main()
