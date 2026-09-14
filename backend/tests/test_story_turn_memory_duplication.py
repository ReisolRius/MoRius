"""Regression tests for the "context memory grows out of nowhere" report.

A turn owns exactly one narrative memory block, moved forward one tier at a time
(latest_full -> raw_pending -> fresh_detailed -> compressed -> facts). Anything that asks a
turn for its *full text* block while that turn has already been compacted used to simply
create a second one, and the next compaction pass then promoted the copy into its own
permanent block. Repeated over a long game -- one extra copy per edit, per reroll-variant
switch, per post-cancel checkpoint -- that is unbounded growth of the context the player is
charged for, invisible in the transcript and stuck to one specific turn.
"""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMemoryBlock, StoryMessage  # noqa: E402
from app.services.story_memory_pipeline import (  # noqa: E402
    _dedupe_story_turn_narrative_memory_blocks,
    _sync_story_raw_memory_blocks_for_recent_turns,
)


class StoryTurnMemoryDuplicationTests(unittest.TestCase):
    game_id = 4242

    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed_game(self, db, *, turns: int) -> tuple[StoryGame, list[int]]:
        game = StoryGame(id=self.game_id, user_id=1, title="regression")
        db.add(game)
        db.flush()
        assistant_ids: list[int] = []
        for index in range(turns):
            db.add(StoryMessage(game_id=self.game_id, role="user", content=f"player action {index}"))
            assistant_message = StoryMessage(
                game_id=self.game_id,
                role="assistant",
                content=f"narrator response {index} " + "x" * 400,
            )
            db.add(assistant_message)
            db.flush()
            assistant_ids.append(int(assistant_message.id))
        return game, assistant_ids

    def _add_block(self, db, assistant_id: int, layer: str, token_count: int) -> StoryMemoryBlock:
        block = StoryMemoryBlock(
            game_id=self.game_id,
            assistant_message_id=assistant_id,
            layer=layer,
            title=layer,
            content=f"{layer} content",
            token_count=token_count,
        )
        db.add(block)
        db.flush()
        return block

    def _narrative_layers(self, db, assistant_id: int) -> list[str]:
        return sorted(
            block.layer
            for block in db.scalars(
                select(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == self.game_id,
                    StoryMemoryBlock.assistant_message_id == assistant_id,
                    StoryMemoryBlock.undone_at.is_(None),
                )
            ).all()
            if block.layer != "archive"
        )

    def test_syncing_an_already_compacted_turn_does_not_add_a_second_full_copy(self) -> None:
        with self.Session() as db:
            game, assistant_ids = self._seed_game(db, turns=3)
            self._add_block(db, assistant_ids[0], "compressed", 40)
            self._add_block(db, assistant_ids[1], "compressed", 40)
            self._add_block(db, assistant_ids[2], "latest_full", 300)

            for _ in range(5):
                _sync_story_raw_memory_blocks_for_recent_turns(
                    db=db,
                    game=game,
                    additional_assistant_message_ids=[assistant_ids[0]],
                )
                db.flush()

            self.assertEqual(self._narrative_layers(db, assistant_ids[0]), ["compressed"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[1]), ["compressed"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[2]), ["latest_full"])

    def test_a_turn_with_no_memory_at_all_still_gets_its_block_back(self) -> None:
        with self.Session() as db:
            game, assistant_ids = self._seed_game(db, turns=2)

            _sync_story_raw_memory_blocks_for_recent_turns(db=db, game=game)
            db.flush()

            for assistant_id in assistant_ids:
                self.assertEqual(self._narrative_layers(db, assistant_id), ["latest_full"])

    def test_collapse_heals_a_game_that_already_accumulated_duplicates(self) -> None:
        with self.Session() as db:
            game, assistant_ids = self._seed_game(db, turns=3)
            # The exact bug shape: one genuine summary plus the copies later builds bolted on.
            self._add_block(db, assistant_ids[0], "compressed", 40)
            self._add_block(db, assistant_ids[0], "fresh_detailed", 90)
            self._add_block(db, assistant_ids[0], "fresh_detailed", 90)
            self._add_block(db, assistant_ids[0], "latest_full", 300)
            # Terminal-tier blocks are never deleted: older builds merged several turns into
            # one and attributed it to the newest source turn, so two can be two real summaries.
            self._add_block(db, assistant_ids[1], "facts", 25)
            self._add_block(db, assistant_ids[1], "super", 25)
            self._add_block(db, assistant_ids[1], "latest_full", 300)
            # The newest turn is kept whole on purpose, so its full text is the survivor.
            self._add_block(db, assistant_ids[2], "latest_full", 300)
            self._add_block(db, assistant_ids[2], "compressed", 40)

            removed = _dedupe_story_turn_narrative_memory_blocks(db=db, game=game)
            db.flush()

            self.assertEqual(removed, 5)
            self.assertEqual(self._narrative_layers(db, assistant_ids[0]), ["compressed"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[1]), ["facts", "super"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[2]), ["latest_full"])
            # Healing is a one-off: a second pass has nothing left to do.
            self.assertEqual(_dedupe_story_turn_narrative_memory_blocks(db=db, game=game), 0)

    def test_collapse_leaves_a_healthy_game_untouched(self) -> None:
        with self.Session() as db:
            game, assistant_ids = self._seed_game(db, turns=3)
            self._add_block(db, assistant_ids[0], "facts", 25)
            self._add_block(db, assistant_ids[1], "compressed", 40)
            self._add_block(db, assistant_ids[2], "latest_full", 300)

            self.assertEqual(_dedupe_story_turn_narrative_memory_blocks(db=db, game=game), 0)
            self.assertEqual(self._narrative_layers(db, assistant_ids[0]), ["facts"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[1]), ["compressed"])
            self.assertEqual(self._narrative_layers(db, assistant_ids[2]), ["latest_full"])


if __name__ == "__main__":
    unittest.main()
