from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMessage, StoryNovelBeat, StorySceneBackground, User  # noqa: E402
from app.routers.story_games import clone_story_game  # noqa: E402
from app.schemas import StoryGameCloneRequest  # noqa: E402


class StoryGameCloneNovelBeatTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_copy_history_remaps_visual_novel_beats_to_cloned_messages(self) -> None:
        with self.Session() as db:
            user = User(
                email="vn-clone@example.com",
                password_hash="test",
                role="administrator",
            )
            db.add(user)
            db.flush()
            source_game = StoryGame(
                user_id=user.id,
                title="Исходная новелла",
                game_mode="visual_novel",
            )
            db.add(source_game)
            db.flush()
            user_message = StoryMessage(
                game_id=source_game.id,
                role="user",
                content="Осмотреть зал",
            )
            assistant_message = StoryMessage(
                game_id=source_game.id,
                role="assistant",
                content="Тишина.\n\n[[NPC:Мия]] (радость) Ты всё-таки пришёл.",
            )
            db.add_all([user_message, assistant_message])
            db.flush()
            source_place = StorySceneBackground(
                game_id=source_game.id,
                title="Зал",
                triggers='["зал"]',
                image_url="https://example.com/hall.webp",
                is_current=True,
            )
            db.add(source_place)
            db.add_all(
                [
                    StoryNovelBeat(
                        game_id=source_game.id,
                        message_id=assistant_message.id,
                        order_index=0,
                        kind="narration",
                        speaker_name=None,
                        speaker_character_id=None,
                        emotion=None,
                        scene_characters_json='[{"name":"Мия","emotion":"scared","character_id":321}]',
                        text="Тишина.",
                    ),
                    StoryNovelBeat(
                        game_id=source_game.id,
                        message_id=assistant_message.id,
                        order_index=1,
                        kind="dialogue",
                        speaker_name="Мия",
                        speaker_character_id=321,
                        emotion="happy",
                        text="Ты всё-таки пришёл.",
                    ),
                ]
            )
            db.commit()

            with patch("app.routers.story_games.get_current_user", return_value=user):
                cloned_summary = clone_story_game(
                    game_id=source_game.id,
                    payload=StoryGameCloneRequest(
                        copy_instructions=False,
                        copy_plot=False,
                        copy_world=True,
                        copy_main_hero=False,
                        copy_history=True,
                    ),
                    authorization="Bearer test",
                    db=db,
                )

            cloned_messages = list(
                db.scalars(
                    select(StoryMessage)
                    .where(StoryMessage.game_id == cloned_summary.id)
                    .order_by(StoryMessage.id.asc())
                ).all()
            )
            cloned_beats = list(
                db.scalars(
                    select(StoryNovelBeat)
                    .where(StoryNovelBeat.game_id == cloned_summary.id)
                    .order_by(StoryNovelBeat.order_index.asc())
                ).all()
            )
            cloned_places = list(
                db.scalars(
                    select(StorySceneBackground).where(StorySceneBackground.game_id == cloned_summary.id)
                ).all()
            )

            self.assertEqual([message.role for message in cloned_messages], ["user", "assistant"])
            self.assertEqual(len(cloned_beats), 2)
            self.assertNotEqual(cloned_messages[1].id, assistant_message.id)
            self.assertEqual({beat.message_id for beat in cloned_beats}, {cloned_messages[1].id})
            self.assertEqual([beat.kind for beat in cloned_beats], ["narration", "dialogue"])
            self.assertEqual([beat.text for beat in cloned_beats], ["Тишина.", "Ты всё-таки пришёл."])
            self.assertEqual(cloned_beats[1].speaker_name, "Мия")
            self.assertEqual(cloned_beats[1].speaker_character_id, 321)
            self.assertEqual(cloned_beats[1].emotion, "happy")
            self.assertEqual(
                cloned_beats[0].scene_characters_json,
                '[{"name":"Мия","emotion":"scared","character_id":321}]',
            )
            self.assertEqual(len(cloned_places), 1)
            self.assertEqual(cloned_places[0].title, "Зал")
            self.assertEqual(cloned_places[0].triggers, '["зал"]')
            self.assertTrue(cloned_places[0].is_current)


if __name__ == "__main__":
    unittest.main()
