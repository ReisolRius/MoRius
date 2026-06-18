from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class _FakeNestedTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class _FakeSession:
    def __init__(self, blocks: list[SimpleNamespace]) -> None:
        self.blocks = blocks

    def begin_nested(self):
        return _FakeNestedTransaction()

    def get(self, _model, block_id):
        return next((block for block in self.blocks if block.id == block_id), None)

    def delete(self, block):
        self.blocks.remove(block)

    def flush(self):
        return None

    def commit(self):
        return None


def _block(block_id: int, assistant_id: int, layer: str, content: str, token_count: int = 10) -> SimpleNamespace:
    return SimpleNamespace(
        id=block_id,
        game_id=10,
        assistant_message_id=assistant_id,
        layer=layer,
        title=f"{layer} {assistant_id}",
        content=content,
        token_count=token_count,
    )


def _game() -> SimpleNamespace:
    return SimpleNamespace(
        id=10,
        context_limit_chars=30_000,
        story_llm_model="z-ai/glm-5",
        memory_optimization_mode="standard",
    )


def _budget(*, fresh: int = 10_000, compressed: int = 6_000, facts: int = 4_000) -> SimpleNamespace:
    return SimpleNamespace(
        user_memory_token_limit=30_000,
        active_cards_token_count=0,
        available_history_tokens=30_000,
        fresh_budget=fresh,
        compressed_budget=compressed,
        facts_budget=facts,
    )


class StoryMemoryLayerProgressionTests(unittest.TestCase):
    def test_rebalance_keeps_latest_full_and_compresses_previous_turn_to_fresh_detailed(self) -> None:
        blocks = [
            _block(1, 101, "latest_full", "old full turn content"),
            _block(2, 102, "latest_full", "latest full turn content"),
        ]

        def create_memory_block(**kwargs):
            block = _block(
                max(item.id for item in blocks) + 1,
                kwargs["assistant_message_id"],
                kwargs["layer"],
                kwargs["content"],
                token_count=5,
            )
            block.title = kwargs["title"]
            blocks.append(block)
            return block

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget()),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                return_value=("Подробная память", "detailed old turn"),
            ),
            patch.object(story_memory_pipeline, "_create_story_memory_block", side_effect=create_memory_block),
        ):
            story_memory_pipeline._rebalance_story_memory_layers(db=_FakeSession(blocks), game=_game(), max_model_requests=1)

        latest_blocks = [block for block in blocks if block.layer == "latest_full"]
        fresh_blocks = [block for block in blocks if block.layer == "fresh_detailed"]
        self.assertEqual([block.assistant_message_id for block in latest_blocks], [102])
        self.assertEqual([(block.assistant_message_id, block.content) for block in fresh_blocks], [(101, "detailed old turn")])

    def test_rebalance_marks_raw_pending_when_model_compaction_fails(self) -> None:
        blocks = [
            _block(1, 101, "latest_full", "old full turn content"),
            _block(2, 102, "latest_full", "latest full turn content"),
        ]

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget()),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                side_effect=RuntimeError("model down"),
            ) as compress_mock,
            patch.object(story_memory_pipeline, "_create_story_memory_block") as create_mock,
        ):
            story_memory_pipeline._rebalance_story_memory_layers(db=_FakeSession(blocks), game=_game(), max_model_requests=1)

        pending_blocks = [block for block in blocks if block.layer == "raw_pending"]
        latest_blocks = [block for block in blocks if block.layer == "latest_full"]
        self.assertEqual([block.assistant_message_id for block in pending_blocks], [101])
        self.assertEqual([block.content for block in pending_blocks], ["old full turn content"])
        self.assertEqual([block.assistant_message_id for block in latest_blocks], [102])
        self.assertEqual(compress_mock.call_count, 1)
        create_mock.assert_not_called()

    def test_strict_rebalance_raises_when_model_compaction_fails(self) -> None:
        blocks = [
            _block(1, 101, "latest_full", "old full turn content"),
            _block(2, 102, "latest_full", "latest full turn content"),
        ]

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget()),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                side_effect=RuntimeError("model down"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "model down"):
                story_memory_pipeline._rebalance_story_memory_layers(
                    db=_FakeSession(blocks),
                    game=_game(),
                    max_model_requests=1,
                    require_model_compaction=True,
                )

        self.assertEqual([block.layer for block in blocks], ["latest_full", "latest_full"])

    def test_rebalance_retries_raw_pending_and_replaces_it_with_fresh_detailed(self) -> None:
        blocks = [
            _block(1, 101, "raw_pending", "old full turn awaiting retry"),
            _block(2, 102, "latest_full", "latest full turn content"),
        ]

        def create_memory_block(**kwargs):
            block = _block(
                max(item.id for item in blocks) + 1,
                kwargs["assistant_message_id"],
                kwargs["layer"],
                kwargs["content"],
                token_count=5,
            )
            block.title = kwargs["title"]
            blocks.append(block)
            return block

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget()),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                return_value=("Detailed memory", "compressed pending turn"),
            ) as compress_mock,
            patch.object(story_memory_pipeline, "_create_story_memory_block", side_effect=create_memory_block),
        ):
            story_memory_pipeline._rebalance_story_memory_layers(
                db=_FakeSession(blocks),
                game=_game(),
                max_model_requests=1,
            )

        self.assertEqual(compress_mock.call_args.kwargs["raw_content"], "old full turn awaiting retry")
        self.assertEqual([block.layer for block in blocks], ["latest_full", "fresh_detailed"])
        self.assertEqual(
            [block.content for block in blocks if block.layer == "fresh_detailed"],
            ["compressed pending turn"],
        )

    def test_rebalance_can_prioritize_newest_stale_latest_full_block(self) -> None:
        blocks = [
            _block(1, 100, "latest_full", "old stale turn"),
            _block(2, 101, "latest_full", "new stale turn"),
            _block(3, 102, "latest_full", "latest turn"),
        ]

        def create_memory_block(**kwargs):
            block = _block(
                max(item.id for item in blocks) + 1,
                kwargs["assistant_message_id"],
                kwargs["layer"],
                kwargs["content"],
                token_count=5,
            )
            block.title = kwargs["title"]
            blocks.append(block)
            return block

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget()),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(
                story_memory_pipeline,
                "_compress_story_memory_block_with_model",
                return_value=("Подробная память", "fresh recent stale"),
            ) as compress_mock,
            patch.object(story_memory_pipeline, "_create_story_memory_block", side_effect=create_memory_block),
        ):
            story_memory_pipeline._rebalance_story_memory_layers(
                db=_FakeSession(blocks),
                game=_game(),
                max_model_requests=1,
                prioritize_recent_transitions=True,
            )

        self.assertEqual(compress_mock.call_args.kwargs["raw_content"], "new stale turn")
        self.assertEqual([block.assistant_message_id for block in blocks if block.layer == "latest_full"], [100, 102])
        self.assertEqual([block.assistant_message_id for block in blocks if block.layer == "fresh_detailed"], [101])

    def test_fresh_over_budget_promotes_detailed_blocks_to_compressed(self) -> None:
        blocks = [
            _block(1, 101, "fresh_detailed", "fresh turn one", token_count=50),
            _block(2, 102, "latest_full", "latest turn", token_count=5),
        ]

        with (
            patch.object(story_memory_pipeline, "_calculate_memory_budget", return_value=_budget(fresh=10)),
            patch.object(story_memory_pipeline, "_list_story_memory_blocks", side_effect=lambda _db, _game_id: list(blocks)),
            patch.object(story_memory_pipeline, "_list_story_latest_assistant_message_ids", return_value=[102]),
            patch.object(story_memory_pipeline, "_promote_blocks", return_value=(True, 0)) as promote_mock,
        ):
            story_memory_pipeline._rebalance_story_memory_layers(db=_FakeSession(blocks), game=_game(), max_model_requests=1)

        self.assertEqual(promote_mock.call_count, 1)
        self.assertEqual(
            [block.layer for block in promote_mock.call_args.kwargs["source_blocks"]],
            ["fresh_detailed"],
        )
        self.assertEqual(promote_mock.call_args.kwargs["target_layer"], "compressed")

    def test_optimize_memory_state_accepts_legacy_endpoint_kwargs(self) -> None:
        with patch.object(story_memory_pipeline, "_rebalance_story_memory_layers", return_value=True) as rebalance_mock:
            result = story_memory_pipeline._optimize_story_memory_state(
                db=SimpleNamespace(),
                game=_game(),
                starting_assistant_message_id=77,
                max_assistant_messages=48,
                max_model_requests=1,
                require_model_compaction=False,
            )

        self.assertTrue(result)
        self.assertEqual(rebalance_mock.call_args.kwargs["max_model_requests"], 1)
        self.assertNotIn("starting_assistant_message_id", rebalance_mock.call_args.kwargs)
        self.assertNotIn("max_assistant_messages", rebalance_mock.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
