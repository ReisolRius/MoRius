from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard, User  # noqa: E402
from app.services import story_runtime  # noqa: E402


class StoryNovelRuntimeMaterializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    @staticmethod
    def _seed(db):
        user = User(email="vn-runtime@example.com", password_hash="test", role="administrator")
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="VN runtime", game_mode="visual_novel")
        db.add(game)
        db.flush()
        card = StoryWorldCard(
            game_id=game.id,
            title="Мия",
            content="Проводница",
            triggers='["Мия"]',
            kind="npc",
        )
        message = StoryMessage(
            game_id=game.id,
            role="assistant",
            content="[[NPC:Мия]] (радость) Идём.",
        )
        db.add_all([card, message])
        db.commit()
        return game, card, message

    def test_recovers_from_post_commit_serialization_failure_without_duplicate_pages(self) -> None:
        with self.Session() as db:
            game, card, message = self._seed(db)
            real_serializer = story_runtime.serialize_story_novel_beats_for_stream
            serialization_attempts = 0

            def flaky_serializer(session, beats):
                nonlocal serialization_attempts
                serialization_attempts += 1
                if serialization_attempts == 1:
                    raise RuntimeError("temporary serializer failure")
                return real_serializer(session, beats)

            touch_game = Mock()
            with patch.object(
                story_runtime,
                "serialize_story_novel_beats_for_stream",
                side_effect=flaky_serializer,
            ):
                payload = story_runtime._materialize_story_novel_beats_for_stream(
                    db=db,
                    game=game,
                    assistant_message=message,
                    raw_response=message.content,
                    world_cards=[card],
                    touch_story_game=touch_game,
                )

            self.assertEqual(serialization_attempts, 2)
            self.assertEqual(len(payload), 1)
            self.assertEqual(payload[0]["text"], "Идём.")
            self.assertEqual(touch_game.call_count, 1)
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(StoryNovelBeat)
                    .where(StoryNovelBeat.message_id == message.id)
                ),
                1,
            )

    def test_retries_persistence_once_then_raises_public_materialization_error(self) -> None:
        with self.Session() as db:
            game, card, message = self._seed(db)
            with patch.object(
                story_runtime,
                "persist_story_novel_beats_for_message",
                side_effect=RuntimeError("storage unavailable"),
            ) as persist_mock:
                with self.assertRaisesRegex(RuntimeError, "Не удалось подготовить страницы"):
                    story_runtime._materialize_story_novel_beats_for_stream(
                        db=db,
                        game=game,
                        assistant_message=message,
                        raw_response=message.content,
                        world_cards=[card],
                        touch_story_game=lambda _game: None,
                    )

            self.assertEqual(persist_mock.call_count, 2)
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(StoryNovelBeat)
                    .where(StoryNovelBeat.message_id == message.id)
                ),
                0,
            )


if __name__ == "__main__":
    unittest.main()
