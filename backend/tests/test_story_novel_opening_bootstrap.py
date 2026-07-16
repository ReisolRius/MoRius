from __future__ import annotations

from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryCharacter, StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard  # noqa: E402
from app.services.story_novel_bootstrap import ensure_story_novel_opening_scene_beats  # noqa: E402


class StoryNovelOpeningBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_game(self, db, *, mode: str = "visual_novel", opening_scene: str | None = None) -> StoryGame:
        game = StoryGame(
            user_id=1,
            title="Тестовая новелла",
            game_mode=mode,
            opening_scene=opening_scene
            or "Снег тихо ложится на мостовую.\n\n[[NPC:Мия]] Нам пора уходить.",
        )
        db.add(game)
        db.flush()
        return game

    def test_materializes_opening_scene_as_message_and_ordered_beats(self) -> None:
        with self.Session() as db:
            game = self._create_game(db)
            character = StoryCharacter(
                user_id=1,
                name="Мия",
                description="Проводница",
                triggers='["Мия"]',
            )
            db.add(character)
            db.flush()
            db.add(
                StoryWorldCard(
                    game_id=game.id,
                    title="Мия",
                    content="Проводница",
                    triggers='["Мия"]',
                    kind="npc",
                    character_id=character.id,
                )
            )
            db.flush()

            result = ensure_story_novel_opening_scene_beats(db=db, game=game)
            db.commit()

            self.assertTrue(result.changed)
            self.assertIsNotNone(result.message_id)
            self.assertEqual(result.beat_count, 2)
            messages = list(db.scalars(select(StoryMessage).where(StoryMessage.game_id == game.id)).all())
            self.assertEqual(len(messages), 1)
            self.assertEqual(messages[0].role, "assistant")
            beats = list(
                db.scalars(
                    select(StoryNovelBeat)
                    .where(StoryNovelBeat.game_id == game.id)
                    .order_by(StoryNovelBeat.order_index.asc())
                ).all()
            )
            self.assertEqual([beat.kind for beat in beats], ["narration", "dialogue"])
            self.assertEqual(beats[1].speaker_name, "Мия")
            self.assertEqual(beats[1].speaker_character_id, character.id)

    def test_is_idempotent_and_never_duplicates_opening_rows(self) -> None:
        with self.Session() as db:
            game = self._create_game(db)
            first = ensure_story_novel_opening_scene_beats(db=db, game=game)
            db.commit()
            second = ensure_story_novel_opening_scene_beats(db=db, game=game)
            db.commit()

            self.assertTrue(first.changed)
            self.assertFalse(second.changed)
            self.assertEqual(first.message_id, second.message_id)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(StoryMessage).where(StoryMessage.game_id == game.id)),
                1,
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(StoryNovelBeat).where(StoryNovelBeat.game_id == game.id)),
                first.beat_count,
            )

    def test_does_not_change_rpg_games_or_rewrite_started_histories(self) -> None:
        with self.Session() as db:
            rpg_game = self._create_game(db, mode="rpg")
            rpg_result = ensure_story_novel_opening_scene_beats(db=db, game=rpg_game)
            self.assertFalse(rpg_result.changed)

            played_game = self._create_game(db, opening_scene="Новое вступление")
            db.add_all(
                [
                    StoryMessage(game_id=played_game.id, role="user", content="Осмотреться"),
                    StoryMessage(game_id=played_game.id, role="assistant", content="Старая сцена продолжается."),
                ]
            )
            db.flush()
            played_result = ensure_story_novel_opening_scene_beats(db=db, game=played_game)
            db.commit()

            self.assertFalse(played_result.changed)
            played_messages = list(
                db.scalars(
                    select(StoryMessage)
                    .where(StoryMessage.game_id == played_game.id)
                    .order_by(StoryMessage.id.asc())
                ).all()
            )
            self.assertEqual([message.content for message in played_messages], ["Осмотреться", "Старая сцена продолжается."])
            self.assertEqual(
                db.scalar(select(func.count()).select_from(StoryNovelBeat).where(StoryNovelBeat.game_id == played_game.id)),
                0,
            )


if __name__ == "__main__":
    unittest.main()
