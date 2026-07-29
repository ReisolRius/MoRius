from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import story_read  # noqa: E402


def _block(layer: str) -> SimpleNamespace:
    return SimpleNamespace(layer=layer, content=f"{layer} content")


def _user(role: str) -> SimpleNamespace:
    return SimpleNamespace(role=role)


class StoryReadMemoryVisibilityTests(unittest.TestCase):
    # The player-facing "Память контекста" usage bar is built client-side from exactly the
    # memory blocks this endpoint returns. Hiding the compression-pipeline layers from
    # non-administrators made that bar read as permanently empty (and the turn cost read as
    # flat) for every regular player, even though the server-side prompt kept using those
    # blocks normally -- so the AI still remembered everything while the UI showed nothing.
    _PIPELINE_LAYERS = ("raw", "latest_full", "fresh_detailed", "compressed", "super", "facts", "raw_pending")

    def test_regular_players_receive_every_compression_pipeline_layer(self) -> None:
        blocks = [_block(layer) for layer in self._PIPELINE_LAYERS]

        visible = story_read._select_client_story_memory_blocks(blocks, _user("user"))

        self.assertEqual([block.layer for block in visible], list(self._PIPELINE_LAYERS))

    def test_archive_recovery_copies_stay_hidden_from_regular_players(self) -> None:
        blocks = [_block("fresh_detailed"), _block("archive"), _block("facts")]

        visible = story_read._select_client_story_memory_blocks(blocks, _user("user"))

        self.assertEqual([block.layer for block in visible], ["fresh_detailed", "facts"])

    def test_administrators_receive_archive_blocks_too(self) -> None:
        blocks = [_block("fresh_detailed"), _block("archive")]

        visible = story_read._select_client_story_memory_blocks(blocks, _user("administrator"))

        self.assertEqual([block.layer for block in visible], ["fresh_detailed", "archive"])

    def test_only_archive_is_withheld_from_regular_players(self) -> None:
        self.assertEqual(story_read._ADMIN_ONLY_MEMORY_LAYERS, {"archive"})


if __name__ == "__main__":
    unittest.main()
