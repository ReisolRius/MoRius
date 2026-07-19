from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryMemoryBlock, StoryMessage  # noqa: E402
from app.routers.story_messages import _sync_turn_raw_memory_after_message_update  # noqa: E402
from app.services.story_memory import (  # noqa: E402
    STORY_MEMORY_LAYER_ARCHIVE,
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_KEY,
    STORY_MEMORY_LAYER_LATEST_FULL,
)
from app.services.story_memory_pipeline import _sync_story_raw_memory_blocks_for_recent_turns  # noqa: E402


class StoryMessageMemorySyncTests(unittest.TestCase):
    game_id = 1001

    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_latest_turn(
        self,
        db,
        *,
        user_content: str = "original player turn",
        assistant_content: str = "original narrator response",
    ) -> tuple[StoryMessage, StoryMessage]:
        user_message = StoryMessage(
            game_id=self.game_id,
            role="user",
            content=user_content,
        )
        assistant_message = StoryMessage(
            game_id=self.game_id,
            role="assistant",
            content=assistant_content,
        )
        db.add_all([user_message, assistant_message])
        db.flush()
        return user_message, assistant_message

    def _active_blocks(self, db, *, assistant_message_id: int) -> list[StoryMemoryBlock]:
        return db.scalars(
            select(StoryMemoryBlock)
            .where(
                StoryMemoryBlock.game_id == self.game_id,
                StoryMemoryBlock.assistant_message_id == assistant_message_id,
                StoryMemoryBlock.undone_at.is_(None),
            )
            .order_by(StoryMemoryBlock.id.asc())
        ).all()

    def test_assistant_edit_updates_latest_full_memory_and_removes_stale_turn_layers(self) -> None:
        with self.Session() as db:
            _, assistant_message = self._create_latest_turn(db)
            key_block = StoryMemoryBlock(
                game_id=self.game_id,
                assistant_message_id=assistant_message.id,
                layer=STORY_MEMORY_LAYER_KEY,
                title="stable key",
                content="This fact belongs to another memory layer.",
                token_count=10,
            )
            db.add_all(
                [
                    StoryMemoryBlock(
                        game_id=self.game_id,
                        assistant_message_id=assistant_message.id,
                        layer=STORY_MEMORY_LAYER_LATEST_FULL,
                        title="stale latest",
                        content="stale latest text",
                        token_count=4,
                    ),
                    StoryMemoryBlock(
                        game_id=self.game_id,
                        assistant_message_id=assistant_message.id,
                        layer=STORY_MEMORY_LAYER_COMPRESSED,
                        title="stale compressed",
                        content="stale compressed text",
                        token_count=4,
                    ),
                    key_block,
                ]
            )
            db.flush()

            assistant_message.content = "edited narrator response"
            _sync_turn_raw_memory_after_message_update(
                db=db,
                game=SimpleNamespace(id=self.game_id),
                message=assistant_message,
            )

            blocks = self._active_blocks(db, assistant_message_id=int(assistant_message.id))
            latest_blocks = [block for block in blocks if block.layer == STORY_MEMORY_LAYER_LATEST_FULL]

            self.assertEqual(len(latest_blocks), 1)
            self.assertIn("original player turn", latest_blocks[0].content)
            self.assertIn("edited narrator response", latest_blocks[0].content)
            self.assertNotIn("stale latest text", latest_blocks[0].content)
            self.assertNotIn(STORY_MEMORY_LAYER_COMPRESSED, {block.layer for block in blocks})
            self.assertIn(key_block, blocks)

    def test_user_edit_updates_next_latest_assistant_memory(self) -> None:
        with self.Session() as db:
            user_message, assistant_message = self._create_latest_turn(db)
            db.add(
                StoryMemoryBlock(
                    game_id=self.game_id,
                    assistant_message_id=assistant_message.id,
                    layer=STORY_MEMORY_LAYER_LATEST_FULL,
                    title="stale latest",
                    content="original player turn\noriginal narrator response",
                    token_count=9,
                )
            )
            db.flush()

            user_message.content = "edited player turn"
            _sync_turn_raw_memory_after_message_update(
                db=db,
                game=SimpleNamespace(id=self.game_id),
                message=user_message,
            )

            latest_block = db.scalar(
                select(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == self.game_id,
                    StoryMemoryBlock.assistant_message_id == assistant_message.id,
                    StoryMemoryBlock.layer == STORY_MEMORY_LAYER_LATEST_FULL,
                    StoryMemoryBlock.undone_at.is_(None),
                )
            )

            self.assertIsNotNone(latest_block)
            assert latest_block is not None
            self.assertIn("edited player turn", latest_block.content)
            self.assertIn("original narrator response", latest_block.content)
            self.assertNotIn("original player turn\noriginal narrator response", latest_block.content)

    def test_sync_backfills_missing_intermediate_turn_and_archives_every_active_turn(self) -> None:
        with self.Session() as db:
            first_user, first_assistant = self._create_latest_turn(
                db,
                user_content="accept mission",
                assistant_content="the mission starts tomorrow",
            )
            second_user, second_assistant = self._create_latest_turn(
                db,
                user_content="complete mission",
                assistant_content="the mission is completed",
            )
            third_user, third_assistant = self._create_latest_turn(
                db,
                user_content="return to camp",
                assistant_content="everyone rests at camp",
            )
            _ = (first_user, second_user, third_user)
            db.add_all(
                [
                    StoryMemoryBlock(
                        game_id=self.game_id,
                        assistant_message_id=first_assistant.id,
                        layer=STORY_MEMORY_LAYER_COMPRESSED,
                        title="mission assigned",
                        content="The mission was assigned for tomorrow.",
                        token_count=9,
                    ),
                    StoryMemoryBlock(
                        game_id=self.game_id,
                        assistant_message_id=third_assistant.id,
                        layer=STORY_MEMORY_LAYER_LATEST_FULL,
                        title="camp",
                        content="return to camp\neveryone rests at camp",
                        token_count=9,
                    ),
                ]
            )
            db.flush()

            changed = _sync_story_raw_memory_blocks_for_recent_turns(
                db=db,
                game=SimpleNamespace(id=self.game_id),
                additional_assistant_message_ids=[int(second_assistant.id)],
            )

            self.assertTrue(changed)
            all_blocks = db.scalars(
                select(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == self.game_id,
                    StoryMemoryBlock.undone_at.is_(None),
                )
            ).all()
            archived_ids = {
                int(block.assistant_message_id)
                for block in all_blocks
                if block.layer == STORY_MEMORY_LAYER_ARCHIVE and block.assistant_message_id is not None
            }
            self.assertEqual(
                archived_ids,
                {int(first_assistant.id), int(second_assistant.id), int(third_assistant.id)},
            )
            repaired_block = next(
                block
                for block in all_blocks
                if block.assistant_message_id == second_assistant.id
                and block.layer == STORY_MEMORY_LAYER_LATEST_FULL
            )
            self.assertIn("complete mission", repaired_block.content)
            self.assertIn("the mission is completed", repaired_block.content)
            first_layers = {
                block.layer for block in all_blocks if block.assistant_message_id == first_assistant.id
            }
            self.assertEqual(first_layers, {STORY_MEMORY_LAYER_COMPRESSED, STORY_MEMORY_LAYER_ARCHIVE})


if __name__ == "__main__":
    unittest.main()
