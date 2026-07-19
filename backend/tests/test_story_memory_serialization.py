from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_memory import story_memory_block_to_out  # noqa: E402
from app.services.story_memory_pipeline import _validate_story_memory_terminal_statuses  # noqa: E402


class StoryMemorySerializationTests(unittest.TestCase):
    def test_pipeline_layers_are_valid_story_memory_api_layers(self) -> None:
        now = datetime.now(timezone.utc)

        for index, layer in enumerate(
            ("latest_full", "fresh_detailed", "compressed", "facts", "raw_pending", "archive"),
            start=1,
        ):
            with self.subTest(layer=layer):
                block = SimpleNamespace(
                    id=index,
                    game_id=10,
                    assistant_message_id=100 + index,
                    layer=layer,
                    title=f"{layer} title",
                    content=f"{layer} content",
                    token_count=5,
                    created_at=now,
                    updated_at=now,
                )

                serialized = story_memory_block_to_out(block)

                self.assertEqual(serialized.layer, layer)

    def test_memory_compaction_cannot_drop_completed_mission_status(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "omitted terminal story status"):
            _validate_story_memory_terminal_statuses(
                source_content="Группа выполнила задание и вернулась в лагерь.",
                result_content="Группа вернулась в лагерь и отдыхает.",
            )

        _validate_story_memory_terminal_statuses(
            source_content="Группа выполнила задание и вернулась в лагерь.",
            result_content="Задание выполнено; группа снова находится в лагере.",
        )
        _validate_story_memory_terminal_statuses(
            source_content="Завтра группе предстоит выполнить задание.",
            result_content="Группа планирует отправиться на задание завтра.",
        )
        _validate_story_memory_terminal_statuses(
            source_content="Артур закончил фразу и отказался от вина.",
            result_content="Артур замолчал и отставил бокал.",
        )
        _validate_story_memory_terminal_statuses(
            source_content="Задание не было выполнено, группа вернулась в лагерь.",
            result_content="Задание провалено; группа снова находится в лагере.",
        )


if __name__ == "__main__":
    unittest.main()
