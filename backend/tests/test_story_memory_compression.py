from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class StoryMemoryCompressionTests(unittest.TestCase):
    def test_raw_memory_preserves_speakers_without_full_text_duplication(self) -> None:
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

        self.assertIn("подробный пересказ", content)
        self.assertNotIn("полный текст", content.casefold())
        self.assertNotIn("[[", content)
        self.assertIn("JRius:", content)
        self.assertIn("Марина:", content)

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


if __name__ == "__main__":
    unittest.main()
