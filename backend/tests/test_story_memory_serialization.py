from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_memory import story_memory_block_to_out  # noqa: E402


class StoryMemorySerializationTests(unittest.TestCase):
    def test_pipeline_layers_are_valid_story_memory_api_layers(self) -> None:
        now = datetime.now(timezone.utc)

        for index, layer in enumerate(
            ("latest_full", "fresh_detailed", "compressed", "facts", "raw_pending"),
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


if __name__ == "__main__":
    unittest.main()
