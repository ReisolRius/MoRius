from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline, story_runtime  # noqa: E402


class _FakeSession:
    def refresh(self, _item):
        return None

    def rollback(self):
        return None


class StoryRuntimeMemoryCheckpointTests(unittest.TestCase):
    def test_latest_full_block_satisfies_raw_memory_checkpoint(self) -> None:
        game = SimpleNamespace(id=10, memory_optimization_enabled=True)
        assistant_message = SimpleNamespace(id=20, game_id=10)
        latest_full_block = SimpleNamespace(
            assistant_message_id=20,
            layer="latest_full",
        )
        deps = SimpleNamespace(touch_story_game=lambda _game: None)

        with (
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[20]),
            patch.object(story_memory_pipeline, "_upsert_story_raw_memory_block", return_value=False),
            patch.object(story_memory_pipeline, "_sync_story_raw_memory_blocks_for_recent_turns", return_value=False),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", return_value=[latest_full_block]),
        ):
            checkpointed = story_runtime._checkpoint_story_raw_turn_memory(
                deps=deps,
                db=_FakeSession(),
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt="Player turn",
                latest_assistant_text="Narrator response",
                memory_optimization_enabled=True,
            )

        self.assertTrue(checkpointed)


if __name__ == "__main__":
    unittest.main()
