from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMemoryBlock, StoryMessage, User  # noqa: E402
from app.services.story_memory_pipeline import (  # noqa: E402
    _list_story_memory_blocks,
    _purge_story_orphaned_memory_blocks,
)
from app.services.story_queries import list_story_memory_blocks  # noqa: E402


class StoryOrphanedMemoryBlockTests(unittest.TestCase):
    """A rolled-back turn must stop costing context budget.

    Reroll marks the discarded assistant message undone and only deletes its memory blocks
    once the replacement turn succeeds. When the replacement is cancelled or dies on a
    provider error, that cleanup never runs -- and the blocks used to stay live: gone from
    the transcript, still charged to the memory budget of every later turn. That is the
    "memory filled up out of nowhere while I never left the same turn" report.
    """

    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed(self, db) -> tuple[int, dict[str, int]]:
        user = User(email="orphan-memory@example.com", password_hash="test", role="user")
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="Сцена")
        db.add(game)
        db.flush()

        live_message = StoryMessage(game_id=game.id, role="assistant", content="Живой ход")
        discarded_message = StoryMessage(game_id=game.id, role="assistant", content="Отменённый ход")
        db.add_all([live_message, discarded_message])
        db.flush()
        discarded_message.undone_at = datetime.now(timezone.utc)

        live_block = StoryMemoryBlock(
            game_id=game.id,
            assistant_message_id=live_message.id,
            layer="raw",
            title="Живой",
            content="Живой блок",
            token_count=40,
        )
        stranded_block = StoryMemoryBlock(
            game_id=game.id,
            assistant_message_id=discarded_message.id,
            layer="raw",
            title="Осиротевший",
            content="Блок отменённого хода",
            token_count=4000,
        )
        # Location / weather / key-fact blocks belong to the game, not to one turn.
        game_block = StoryMemoryBlock(
            game_id=game.id,
            assistant_message_id=None,
            layer="location",
            title="Место",
            content="Таверна",
            token_count=20,
        )
        db.add_all([live_block, stranded_block, game_block])
        db.flush()
        ids = {
            "live": live_block.id,
            "stranded": stranded_block.id,
            "game": game_block.id,
            "discarded_message": discarded_message.id,
        }
        db.commit()
        return game.id, ids

    def test_blocks_of_a_rolled_back_turn_are_not_counted(self) -> None:
        with self.Session() as db:
            game_id, ids = self._seed(db)

            titles = [block.title for block in _list_story_memory_blocks(db, game_id)]

            self.assertEqual(titles, ["Живой", "Место"])
            self.assertNotIn("Осиротевший", titles)
            _ = ids

    def test_public_listing_hides_them_too(self) -> None:
        with self.Session() as db:
            game_id, _ = self._seed(db)

            titles = [block.title for block in list_story_memory_blocks(db, game_id)]

            self.assertEqual(titles, ["Живой", "Место"])

    def test_include_undone_still_returns_everything(self) -> None:
        with self.Session() as db:
            game_id, _ = self._seed(db)

            titles = [
                block.title for block in list_story_memory_blocks(db, game_id, include_undone=True)
            ]

            self.assertEqual(titles, ["Живой", "Осиротевший", "Место"])

    def test_restoring_the_turn_brings_its_memory_back(self) -> None:
        # Undo is reversible, so hiding must key off the message rather than a second flag
        # that a restore could forget to clear.
        with self.Session() as db:
            game_id, ids = self._seed(db)
            message = db.get(StoryMessage, ids["discarded_message"])
            message.undone_at = None
            db.commit()

            titles = [block.title for block in _list_story_memory_blocks(db, game_id)]

            self.assertEqual(titles, ["Живой", "Осиротевший", "Место"])

    def test_purge_reaps_only_blocks_whose_turn_is_gone(self) -> None:
        with self.Session() as db:
            game_id, ids = self._seed(db)

            # An undone turn may still be restored, so its block must survive the sweep.
            self.assertEqual(_purge_story_orphaned_memory_blocks(db, game_id), 0)
            db.commit()
            self.assertIsNotNone(db.get(StoryMemoryBlock, ids["stranded"]))

            db.delete(db.get(StoryMessage, ids["discarded_message"]))
            db.commit()

            self.assertEqual(_purge_story_orphaned_memory_blocks(db, game_id), 1)
            db.commit()

            remaining = db.scalars(
                select(StoryMemoryBlock.title).where(StoryMemoryBlock.game_id == game_id)
            ).all()
            self.assertEqual(sorted(remaining), ["Живой", "Место"])


if __name__ == "__main__":
    unittest.main()
