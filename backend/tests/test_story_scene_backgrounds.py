from __future__ import annotations

from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StorySceneBackground  # noqa: E402
from app.services.story_novel_backgrounds import (  # noqa: E402
    _normalize_story_scene_background_triggers,
    apply_story_scene_background_memory_for_turn,
    find_matching_story_scene_background,
    get_current_story_scene_background,
    story_scene_background_to_out,
)


class NormalizeStorySceneBackgroundTriggersTests(unittest.TestCase):
    def test_trims_dedupes_case_insensitively_and_caps_length(self) -> None:
        normalized = _normalize_story_scene_background_triggers(
            ["Старая таверна", "  старая таверна  ", "Рынок", "", None]
        )
        self.assertEqual(normalized, ["Старая таверна", "Рынок"])

    def test_ignores_non_list_input(self) -> None:
        self.assertEqual(_normalize_story_scene_background_triggers("старая таверна"), [])
        self.assertEqual(_normalize_story_scene_background_triggers(None), [])


class StorySceneBackgroundDbTests(unittest.TestCase):
    game_id = 501

    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _add_background(
        self,
        db,
        *,
        title: str,
        triggers: list[str] | None = None,
        is_current: bool = False,
    ) -> StorySceneBackground:
        import json

        background = StorySceneBackground(
            game_id=self.game_id,
            title=title,
            prompt=f"prompt for {title}",
            triggers=json.dumps(triggers or [], ensure_ascii=False),
            is_current=is_current,
        )
        db.add(background)
        db.flush()
        return background

    def test_find_matching_prefers_exact_title_match(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Старая таверна", triggers=["таверна"])
        self._add_background(db, title="Рынок", triggers=["рынок"])
        db.commit()

        match = find_matching_story_scene_background(
            db, game_id=self.game_id, location_label="Старая таверна"
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.id, tavern.id)

    def test_find_matching_falls_back_to_partial_trigger_match(self) -> None:
        db = self.Session()
        market = self._add_background(db, title="Рынок", triggers=["рыночная площадь"])
        db.commit()

        match = find_matching_story_scene_background(
            db, game_id=self.game_id, location_label="рыночная площадь у фонтана"
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.id, market.id)

    def test_find_matching_returns_none_when_no_backgrounds_or_label(self) -> None:
        db = self.Session()
        self.assertIsNone(
            find_matching_story_scene_background(db, game_id=self.game_id, location_label="Таверна")
        )
        self._add_background(db, title="Таверна", triggers=[])
        db.commit()
        self.assertIsNone(
            find_matching_story_scene_background(db, game_id=self.game_id, location_label=None)
        )

    def test_apply_memory_switches_current_background_for_free(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Таверна", triggers=[], is_current=True)
        market = self._add_background(db, title="Рынок", triggers=["рынок"], is_current=False)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(db, game=game, location_label="Рынок")
        db.commit()

        self.assertIsNotNone(current)
        self.assertEqual(current.id, market.id)

        db.refresh(tavern)
        db.refresh(market)
        self.assertFalse(tavern.is_current)
        self.assertTrue(market.is_current)

    def test_apply_memory_keeps_current_background_when_no_match(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Таверна", triggers=[], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db, game=game, location_label="Неизвестная пещера"
        )
        db.commit()

        self.assertIsNotNone(current)
        self.assertEqual(current.id, tavern.id)

    def test_story_scene_background_to_out_resolves_triggers_and_current_flag(self) -> None:
        db = self.Session()
        background = self._add_background(
            db, title="Таверна", triggers=["таверна", "трактир"], is_current=True
        )
        db.commit()

        out = story_scene_background_to_out(background)
        self.assertEqual(out.title, "Таверна")
        self.assertEqual(out.triggers, ["таверна", "трактир"])
        self.assertTrue(out.is_current)

    def test_get_current_story_scene_background_returns_none_when_none_current(self) -> None:
        db = self.Session()
        self._add_background(db, title="Таверна", triggers=[], is_current=False)
        db.commit()

        self.assertIsNone(get_current_story_scene_background(db, self.game_id))


if __name__ == "__main__":
    unittest.main()
