from __future__ import annotations

from contextlib import nullcontext
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    StoryCharacter,
    StoryGame,
    StoryMessage,
    StoryNovelBeat,
    StoryWorldCard,
    User,
)
from app.routers import story_messages as story_messages_router  # noqa: E402
from app.schemas import StoryMessageSelectVariantRequest, StoryMessageUpdateRequest  # noqa: E402
from app.services.story_emotions import serialize_story_character_emotion_assets  # noqa: E402


class StoryMessageNovelBeatSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed_turn(self, db, *, game_mode: str = "visual_novel"):
        user = User(
            email=f"message-vn-{id(self)}@example.com",
            password_hash="test",
            role="administrator",
        )
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="VN message sync", game_mode=game_mode)
        db.add(game)
        db.flush()
        character = StoryCharacter(
            user_id=user.id,
            name="Мия",
            description="Хозяйка дома",
            triggers='["Мия"]',
            emotion_assets=serialize_story_character_emotion_assets(
                {"angry": "https://cdn.example.com/mia-angry.png"}
            ),
            novel_sprite_gender="female",
        )
        db.add(character)
        db.flush()
        card = StoryWorldCard(
            game_id=game.id,
            title="Мия",
            content="Хозяйка дома",
            triggers='["Мия"]',
            kind="npc",
            character_id=character.id,
        )
        message = StoryMessage(
            game_id=game.id,
            role="assistant",
            content="Старый текст",
            variant_history_json="[]",
        )
        db.add_all([card, message])
        db.flush()
        db.add(
            StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="narration",
                text="Устаревшая страница",
            )
        )
        db.commit()
        return user, game, character, message

    @staticmethod
    def _route_patches(user):
        return (
            patch.object(story_messages_router, "get_current_user", return_value=user),
            patch.object(
                story_messages_router,
                "_acquire_story_operation_lease_or_409",
                return_value=nullcontext(),
            ),
            patch.object(story_messages_router, "_sync_turn_raw_memory_after_message_update"),
        )

    def _message_beats(self, db, message_id: int) -> list[StoryNovelBeat]:
        return list(
            db.scalars(
                select(StoryNovelBeat)
                .where(StoryNovelBeat.message_id == message_id)
                .order_by(StoryNovelBeat.order_index.asc())
            ).all()
        )

    def test_assistant_edit_reparses_visual_novel_beats(self) -> None:
        with self.Session() as db:
            user, game, character, message = self._seed_turn(db)
            auth_patch, lock_patch, memory_patch = self._route_patches(user)
            with auth_patch, lock_patch, memory_patch:
                story_messages_router.update_story_message(
                    game_id=game.id,
                    message_id=message.id,
                    payload=StoryMessageUpdateRequest(
                        content="[[NPC:Мия]] (злость) Немедленно уходи."
                    ),
                    authorization=None,
                    db=db,
                )

            beats = self._message_beats(db, message.id)
            self.assertEqual(len(beats), 1)
            self.assertEqual(beats[0].kind, "dialogue")
            self.assertEqual(beats[0].speaker_name, "Мия")
            self.assertEqual(beats[0].speaker_character_id, character.id)
            self.assertEqual(beats[0].emotion, "angry")
            self.assertEqual(beats[0].text, "Немедленно уходи.")

    def test_variant_selection_reparses_selected_visual_novel_content(self) -> None:
        with self.Session() as db:
            user, game, character, message = self._seed_turn(db)
            message.variant_history_json = json.dumps(
                [
                    {"content": "Первый вариант", "created_at": ""},
                    {
                        "content": "[[NPC:Мия]] (злость) Второй вариант.",
                        "created_at": "",
                    },
                ],
                ensure_ascii=False,
            )
            db.commit()
            auth_patch, lock_patch, memory_patch = self._route_patches(user)
            with auth_patch, lock_patch, memory_patch:
                story_messages_router.select_story_message_variant(
                    game_id=game.id,
                    message_id=message.id,
                    payload=StoryMessageSelectVariantRequest(variant_index=1),
                    authorization=None,
                    db=db,
                )

            beats = self._message_beats(db, message.id)
            self.assertEqual(len(beats), 1)
            self.assertEqual(beats[0].speaker_character_id, character.id)
            self.assertEqual(beats[0].emotion, "angry")
            self.assertEqual(beats[0].text, "Второй вариант.")

    def test_rpg_assistant_edit_keeps_cleanup_behavior(self) -> None:
        with self.Session() as db:
            user, game, _, message = self._seed_turn(db, game_mode="rpg")
            auth_patch, lock_patch, memory_patch = self._route_patches(user)
            with auth_patch, lock_patch, memory_patch:
                story_messages_router.update_story_message(
                    game_id=game.id,
                    message_id=message.id,
                    payload=StoryMessageUpdateRequest(content="Обычный RPG-текст"),
                    authorization=None,
                    db=db,
                )

            self.assertEqual(self._message_beats(db, message.id), [])


if __name__ == "__main__":
    unittest.main()
