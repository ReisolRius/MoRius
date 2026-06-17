from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class StoryMemoryLayerProgressionTests(unittest.TestCase):
    def test_rebalance_keeps_only_latest_turn_raw_and_compresses_previous_turn(self) -> None:
        blocks = [
            SimpleNamespace(
                id=1,
                game_id=10,
                assistant_message_id=101,
                layer="raw",
                title="old full turn",
                content="old full turn content",
                token_count=10,
            ),
            SimpleNamespace(
                id=2,
                game_id=10,
                assistant_message_id=102,
                layer="raw",
                title="latest full turn",
                content="latest full turn content",
                token_count=10,
            ),
        ]

        class FakeNestedTransaction:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

        class FakeSession:
            def begin_nested(self):
                return FakeNestedTransaction()

            def get(self, _model, block_id):
                return next((block for block in blocks if block.id == block_id), None)

            def delete(self, block):
                blocks.remove(block)

            def flush(self):
                return None

            def commit(self):
                return None

        def create_memory_block(**kwargs):
            block = SimpleNamespace(
                id=max(item.id for item in blocks) + 1,
                game_id=kwargs["game_id"],
                assistant_message_id=kwargs["assistant_message_id"],
                layer=kwargs["layer"],
                title=kwargs["title"],
                content=kwargs["content"],
                token_count=5,
            )
            blocks.append(block)
            return block

        game = SimpleNamespace(
            id=10,
            context_limit_chars=6_000,
            story_llm_model="z-ai/glm-5",
            memory_optimization_mode="standard",
        )

        with (
            patch.object(
                story_memory_pipeline,
                "_list_story_memory_blocks",
                side_effect=lambda _db, _game_id: list(blocks),
            ),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(story_memory_pipeline, "_get_story_main_hero_name_for_memory", return_value="Hero"),
            patch.object(story_memory_pipeline, "_list_story_known_character_names_for_memory", return_value=["Hero"]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                return_value=("compressed old turn", "compressed old turn content"),
            ),
            patch.object(story_memory_pipeline, "_create_story_memory_block", side_effect=create_memory_block),
        ):
            story_memory_pipeline._rebalance_story_memory_layers(
                db=FakeSession(),
                game=game,
                max_model_requests=1,
            )

        raw_blocks = [block for block in blocks if block.layer == "raw"]
        compressed_blocks = [block for block in blocks if block.layer == "compressed"]
        self.assertEqual([block.assistant_message_id for block in raw_blocks], [102])
        self.assertEqual([block.assistant_message_id for block in compressed_blocks], [101])

    def test_rebalance_keeps_raw_block_when_model_compaction_fails(self) -> None:
        blocks = [
            SimpleNamespace(
                id=1,
                game_id=10,
                assistant_message_id=101,
                layer="raw",
                title="old full turn",
                content="old full turn content",
                token_count=10,
            ),
            SimpleNamespace(
                id=2,
                game_id=10,
                assistant_message_id=102,
                layer="raw",
                title="latest full turn",
                content="latest full turn content",
                token_count=10,
            ),
        ]

        class FakeNestedTransaction:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

        class FakeSession:
            def begin_nested(self):
                return FakeNestedTransaction()

            def get(self, _model, block_id):
                return next((block for block in blocks if block.id == block_id), None)

            def delete(self, block):
                blocks.remove(block)

            def flush(self):
                return None

            def commit(self):
                return None

        game = SimpleNamespace(
            id=10,
            context_limit_chars=6_000,
            story_llm_model="z-ai/glm-5",
            memory_optimization_mode="standard",
        )

        with (
            patch.object(
                story_memory_pipeline,
                "_list_story_memory_blocks",
                side_effect=lambda _db, _game_id: list(blocks),
            ),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(story_memory_pipeline, "_get_story_main_hero_name_for_memory", return_value="Hero"),
            patch.object(story_memory_pipeline, "_list_story_known_character_names_for_memory", return_value=["Hero"]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                side_effect=RuntimeError("model down"),
            ) as compress_mock,
            patch.object(story_memory_pipeline, "_create_story_memory_block") as create_mock,
        ):
            story_memory_pipeline._rebalance_story_memory_layers(
                db=FakeSession(),
                game=game,
                max_model_requests=1,
            )

        raw_blocks = [block for block in blocks if block.layer == "raw"]
        compressed_blocks = [block for block in blocks if block.layer == "compressed"]
        self.assertEqual([block.assistant_message_id for block in raw_blocks], [101, 102])
        self.assertEqual(compressed_blocks, [])
        self.assertEqual(compress_mock.call_count, 1)
        create_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
