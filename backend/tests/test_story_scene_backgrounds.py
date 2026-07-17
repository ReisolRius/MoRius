from __future__ import annotations

from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryPlaceTemplate, StorySceneBackground, User  # noqa: E402
from app.services.story_novel_backgrounds import (  # noqa: E402
    _build_scene_background_prompt_messages,
    _collect_story_active_character_context,
    _normalize_story_scene_background_triggers,
    _parse_story_novel_scene_background_decision,
    analyze_and_apply_story_novel_scene_background,
    apply_story_scene_background_memory_for_turn,
    create_story_place_template_impl,
    create_story_scene_background_impl,
    find_matching_story_scene_background,
    generate_story_novel_background_impl,
    generate_story_place_template_background_impl,
    get_current_story_scene_background,
    import_story_place_template_impl,
    story_scene_background_to_out,
    update_story_scene_background_impl,
)
from app.services.story_games import delete_story_game_with_relations  # noqa: E402


class NormalizeStorySceneBackgroundTriggersTests(unittest.TestCase):
    def test_trims_dedupes_case_insensitively_and_caps_length(self) -> None:
        normalized = _normalize_story_scene_background_triggers(
            ["Старая таверна", "  старая таверна  ", "Рынок", "", None]
        )
        self.assertEqual(normalized, ["Старая таверна", "Рынок"])

    def test_ignores_non_list_input(self) -> None:
        self.assertEqual(_normalize_story_scene_background_triggers("старая таверна"), [])
        self.assertEqual(_normalize_story_scene_background_triggers(None), [])

    def test_background_composer_receives_active_characters_as_conditional_context(self) -> None:
        cards = [
            SimpleNamespace(
                kind="main_hero",
                title="Айри",
                content="Бедная деревенская ведьма, живущая среди трав и старых книг.",
                memory_turns=None,
                race="человек",
                clothing="",
                inventory="",
                health_status="",
            ),
            SimpleNamespace(
                kind="npc",
                title="Лорд Вейр",
                content="Богатый аристократ и коллекционер редких часов.",
                memory_turns=3,
                race="",
                clothing="",
                inventory="",
                health_status="",
            ),
            SimpleNamespace(kind="npc", title="Отключённый", content="Не включать", memory_turns=0),
        ]

        context = _collect_story_active_character_context(cards)
        messages = _build_scene_background_prompt_messages(
            world_title="Мир",
            world_content="Фэнтези",
            genres=["фэнтези"],
            image_style_prompt="anime",
            location_label="Дом Айри",
            latest_user_prompt="Вхожу домой",
            latest_assistant_text="Дверь открылась",
            active_character_context=context,
        )

        self.assertIn("Айри", context)
        self.assertIn("Лорд Вейр", context)
        self.assertNotIn("Отключённый", context)
        self.assertIn("только если фон явно является его домом", messages[0]["content"])
        self.assertIn("АКТИВНЫЕ ПЕРСОНАЖИ", messages[1]["content"])


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

    def test_title_without_trigger_does_not_auto_activate(self) -> None:
        db = self.Session()
        self._add_background(db, title="Дом Айри", triggers=[])
        db.commit()

        self.assertIsNone(
            find_matching_story_scene_background(
                db,
                game_id=self.game_id,
                location_label="Дом Айри",
                scene_text="Они вернулись в Дом Айри.",
            )
        )

    def test_scene_text_trigger_switches_to_another_place(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Таверна", triggers=["таверна"], is_current=True)
        forest = self._add_background(db, title="Лес", triggers=["тёмный лес"], is_current=False)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db,
            game=game,
            location_label="Таверна",
            scene_text="К вечеру путники вошли в тёмный лес.",
        )
        db.commit()

        self.assertEqual(current.id, forest.id)
        db.refresh(tavern)
        self.assertFalse(tavern.is_current)

    def test_scene_text_trigger_uses_word_boundaries(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Таверна", triggers=[], is_current=True)
        self._add_background(db, title="Лес", triggers=["лес"], is_current=False)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db,
            game=game,
            location_label="",
            scene_text="У телеги треснуло колесо.",
        )

        self.assertEqual(current.id, tavern.id)

    def test_location_label_partial_match_uses_word_boundaries(self) -> None:
        db = self.Session()
        self._add_background(db, title="Лес", triggers=["лес"])
        db.commit()

        self.assertIsNone(
            find_matching_story_scene_background(
                db,
                game_id=self.game_id,
                location_label="Колесо",
                scene_text="",
            )
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

    def test_apply_memory_clears_generated_background_when_location_changes(self) -> None:
        db = self.Session()
        tavern = self._add_background(db, title="Таверна", triggers=[], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db, game=game, location_label="Неизвестная пещера"
        )
        db.commit()

        self.assertIsNone(current)
        db.refresh(tavern)
        self.assertFalse(tavern.is_current)

    def test_apply_memory_clears_trigger_place_when_scene_leaves(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db,
            game=game,
            location_label="Библиотека",
            scene_text="Она вошла в тихую библиотеку.",
        )
        db.commit()

        # No saved place matches the new location, and the current trigger-based place no longer
        # corresponds to it, so the scene drops to the neutral gradient instead of stranding the
        # street background.
        self.assertIsNone(current)
        db.refresh(street)
        self.assertFalse(street.is_current)

    def test_apply_memory_keeps_trigger_place_while_location_still_matches(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = apply_story_scene_background_memory_for_turn(
            db,
            game=game,
            location_label="Улица",
            scene_text="Они всё ещё стоят на шумной улице.",
        )
        db.commit()

        self.assertIsNotNone(current)
        self.assertEqual(current.id, street.id)

    def test_llm_analysis_switches_to_contextual_place(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        airi_home = self._add_background(db, title="Дом Айри", triggers=["дом айри"], is_current=False)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()

        def fake_request(_messages: list[dict[str, str]]) -> str:
            # The model picks Airi's home from imprecise contextual wording.
            return f'{{"place_id": {airi_home.id}}}'

        current = analyze_and_apply_story_novel_scene_background(
            db,
            game=game,
            location_label="дом",
            scene_text="Они наконец пошли домой к Айри.",
            latest_user_text="Пойдём к Айри домой",
            request_text=fake_request,
        )
        db.commit()

        self.assertIsNotNone(current)
        self.assertEqual(current.id, airi_home.id)
        db.refresh(street)
        self.assertFalse(street.is_current)

    def test_llm_analysis_clears_to_neutral_when_no_place(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = analyze_and_apply_story_novel_scene_background(
            db,
            game=game,
            location_label="Заброшенный маяк",
            scene_text="Они поднялись на вершину заброшенного маяка.",
            latest_user_text="Идём к маяку",
            request_text=lambda _messages: '{"place_id": 0}',
        )
        db.commit()

        self.assertIsNone(current)
        db.refresh(street)
        self.assertFalse(street.is_current)

    def test_llm_analysis_keeps_current_when_model_returns_current_id(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        db.commit()

        game = type("Game", (), {"id": self.game_id})()
        current = analyze_and_apply_story_novel_scene_background(
            db,
            game=game,
            location_label="улица",
            scene_text="Они всё ещё на шумной улице.",
            latest_user_text="осмотреться",
            request_text=lambda _messages: f'{{"place_id": {street.id}}}',
        )
        db.commit()

        self.assertIsNotNone(current)
        self.assertEqual(current.id, street.id)
        db.refresh(street)
        self.assertTrue(street.is_current)

    def test_llm_analysis_falls_back_to_trigger_memory_on_error(self) -> None:
        db = self.Session()
        street = self._add_background(db, title="Улица", triggers=["улица"], is_current=True)
        market = self._add_background(db, title="Рынок", triggers=["рынок"], is_current=False)
        db.commit()

        def boom(_messages: list[dict[str, str]]) -> str:
            raise RuntimeError("service unavailable")

        game = type("Game", (), {"id": self.game_id})()
        current = analyze_and_apply_story_novel_scene_background(
            db,
            game=game,
            location_label="Рынок",
            scene_text="Они пришли на шумный рынок.",
            latest_user_text="идём на рынок",
            request_text=boom,
        )
        db.commit()

        # Literal trigger memory still switches to the market on LLM failure.
        self.assertIsNotNone(current)
        self.assertEqual(current.id, market.id)

    def test_parse_decision_rejects_hallucinated_id(self) -> None:
        self.assertIsNone(_parse_story_novel_scene_background_decision('{"place_id": 999}', {1, 2}))
        self.assertEqual(_parse_story_novel_scene_background_decision('{"place_id": 2}', {1, 2}), 2)
        self.assertEqual(_parse_story_novel_scene_background_decision('{"place_id": 0}', {1, 2}), 0)
        self.assertEqual(
            _parse_story_novel_scene_background_decision('reasoning... {"place_id": 1} done', {1}),
            1,
        )
        self.assertIsNone(_parse_story_novel_scene_background_decision("no json here", {1}))

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


class StoryPlaceCrudAndGenerationTests(unittest.TestCase):
    DATA_IMAGE = "data:image/png;base64,aGVsbG8="

    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    @staticmethod
    def _seed(db):
        user = User(email="places-admin@example.com", password_hash="test", role="administrator")
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="VN places", game_mode="visual_novel")
        db.add(game)
        db.commit()
        return user, game

    def test_profile_place_import_is_independent_and_manual_data_image_is_resolved(self) -> None:
        with self.Session() as db:
            user, game = self._seed(db)
            template_out = create_story_place_template_impl(
                db=db,
                user=user,
                title="Дом Айри",
                triggers=["дом айри"],
                image_url=self.DATA_IMAGE,
            )
            self.assertTrue(str(template_out.image_url).startswith("/api/media/"))

            place_out = import_story_place_template_impl(
                db=db,
                game=game,
                user=user,
                library_place_id=template_out.id,
                make_current=True,
            )
            self.assertEqual(place_out.triggers, ["дом айри"])
            self.assertTrue(place_out.is_current)
            self.assertTrue(str(place_out.image_url).startswith("/api/media/"))

            update_story_scene_background_impl(
                db=db,
                game=game,
                user=user,
                background_id=place_out.id,
                fields={"title", "triggers"},
                title="Гостиная Айри",
                triggers=["гостиная"],
            )
            template = db.get(StoryPlaceTemplate, template_out.id)
            self.assertEqual(template.title, "Дом Айри")
            self.assertEqual(place_out.game_id, game.id)

    def test_manual_game_place_create_does_not_activate_unless_requested(self) -> None:
        with self.Session() as db:
            user, game = self._seed(db)
            place_out = create_story_scene_background_impl(
                db=db,
                game=game,
                user=user,
                title="Поляна",
                triggers=["поляна"],
                image_url=self.DATA_IMAGE,
            )

            self.assertFalse(place_out.is_current)
            self.assertIsNone(get_current_story_scene_background(db, game.id))

            delete_story_game_with_relations(db, game_id=game.id)
            db.commit()
            self.assertIsNone(db.get(StoryGame, game.id))

    def test_manual_generation_creates_non_current_place_and_keeps_current_scene(self) -> None:
        with self.Session() as db:
            user, game = self._seed(db)
            current = create_story_scene_background_impl(
                db=db,
                game=game,
                user=user,
                title="Таверна",
                triggers=["таверна"],
                image_url=self.DATA_IMAGE,
                make_current=True,
            )
            scene_payload = SimpleNamespace(prompt="A wizard study", location_title="Башня", has_people=False)
            generation_payload = {
                "model": "test-image-model",
                "image_url": "https://example.com/tower.webp",
                "image_data_url": None,
            }
            with (
                patch("app.services.story_novel_backgrounds.generate_story_scene_background_prompt", return_value=scene_payload),
                patch("app.services.story_novel_backgrounds.spend_user_tokens_if_sufficient", return_value=True),
                patch("app.services.story_visuals._get_story_turn_image_cost_tokens", return_value=6),
                patch("app.services.story_visuals._limit_story_turn_image_request_prompt", side_effect=lambda value, **_: value),
                patch("app.services.story_visuals._request_story_turn_image", return_value=generation_payload),
            ):
                generated = generate_story_novel_background_impl(
                    db=db,
                    game=game,
                    user=user,
                    world_cards=[],
                    location_label="Таверна",
                    latest_user_prompt="",
                    latest_assistant_text="",
                    requested_title="Башня мага",
                    requested_description="Высокая башня с алхимической лабораторией",
                    requested_triggers=["башня мага"],
                    make_current=False,
                    create_new_place=True,
                )

            self.assertFalse(generated.is_current)
            self.assertEqual(generated.triggers, ["башня мага"])
            self.assertEqual(get_current_story_scene_background(db, game.id).id, current.id)

    def test_profile_can_generate_paid_place_template_background(self) -> None:
        with self.Session() as db:
            user, _game = self._seed(db)
            generation_payload = {
                "model": "test-image-model",
                "image_url": "https://example.com/library.webp",
                "image_data_url": None,
            }
            with (
                patch("app.services.story_novel_backgrounds.spend_user_tokens_if_sufficient", return_value=True),
                patch("app.services.story_visuals._get_story_turn_image_cost_tokens", return_value=9),
                patch("app.services.story_visuals._limit_story_turn_image_request_prompt", side_effect=lambda value, **_: value),
                patch("app.services.story_visuals._request_story_turn_image", return_value=generation_payload),
            ):
                generated = generate_story_place_template_background_impl(
                    db=db,
                    user=user,
                    title="Старая библиотека",
                    description="Пыльные стеллажи и лунный свет",
                    style_prompt="painterly anime background",
                    image_model="google/gemini-2.5-flash-image",
                    triggers=["библиотека"],
                )

            self.assertEqual(generated.title, "Старая библиотека")
            self.assertEqual(generated.triggers, ["библиотека"])
            self.assertEqual(db.get(StoryPlaceTemplate, generated.id).image_url, "https://example.com/library.webp")

    def test_regeneration_replaces_current_place_instead_of_creating_another(self) -> None:
        with self.Session() as db:
            user, game = self._seed(db)
            game.image_style_prompt = "Hand-painted watercolor storybook style"
            db.flush()
            place_out = create_story_scene_background_impl(
                db=db,
                game=game,
                user=user,
                title="Таверна",
                triggers=["таверна"],
                image_url=self.DATA_IMAGE,
                make_current=True,
            )

            scene_payload = SimpleNamespace(
                prompt="An empty medieval tavern interior",
                location_title="Другая подпись от модели",
                has_people=False,
            )
            generation_payload = {
                "model": "test-image-model",
                "image_url": "https://example.com/new-tavern.webp",
                "image_data_url": None,
            }
            with (
                patch(
                    "app.services.story_novel_backgrounds.generate_story_scene_background_prompt",
                    return_value=scene_payload,
                ),
                patch(
                    "app.services.story_novel_backgrounds.spend_user_tokens_if_sufficient",
                    return_value=True,
                ),
                patch("app.services.story_visuals._get_story_turn_image_cost_tokens", return_value=1),
                patch("app.services.story_visuals._limit_story_turn_image_request_prompt", side_effect=lambda value, **_: value),
                patch("app.services.story_visuals._request_story_turn_image", return_value=generation_payload),
            ):
                regenerated = generate_story_novel_background_impl(
                    db=db,
                    game=game,
                    user=user,
                    world_cards=[],
                    location_label="Таверна",
                    latest_user_prompt="",
                    latest_assistant_text="",
                    place_id=place_out.id,
                )

            self.assertEqual(regenerated.id, place_out.id)
            self.assertEqual(regenerated.title, "Таверна")
            self.assertEqual(regenerated.triggers, ["таверна"])
            self.assertEqual(
                db.scalar(select(func.count()).select_from(StorySceneBackground)),
                1,
            )
            persisted = db.get(StorySceneBackground, place_out.id)
            self.assertEqual(persisted.image_url, "https://example.com/new-tavern.webp")
            self.assertIn("Completely empty of people and characters", persisted.prompt)
            self.assertIn("Hand-painted watercolor storybook style", persisted.prompt)

    def test_generation_replaces_only_within_same_assistant_turn(self) -> None:
        with self.Session() as db:
            user, game = self._seed(db)
            scene_payload = SimpleNamespace(
                prompt="An empty moonlit railway platform",
                location_title="Платформа",
                has_people=False,
            )
            generated_urls = iter(
                [
                    "https://example.com/platform-v1.webp",
                    "https://example.com/platform-v2.webp",
                    "https://example.com/forest.webp",
                ]
            )

            def fake_generate(**_kwargs):
                return {
                    "model": "test-image-model",
                    "image_url": next(generated_urls),
                    "image_data_url": None,
                }

            with (
                patch(
                    "app.services.story_novel_backgrounds.generate_story_scene_background_prompt",
                    return_value=scene_payload,
                ),
                patch(
                    "app.services.story_novel_backgrounds.spend_user_tokens_if_sufficient",
                    return_value=True,
                ),
                patch("app.services.story_visuals._get_story_turn_image_cost_tokens", return_value=1),
                patch("app.services.story_visuals._limit_story_turn_image_request_prompt", side_effect=lambda value, **_: value),
                patch("app.services.story_visuals._request_story_turn_image", side_effect=fake_generate),
            ):
                first = generate_story_novel_background_impl(
                    db=db, game=game, user=user, world_cards=[], location_label="Платформа",
                    latest_user_prompt="", latest_assistant_text="", assistant_message_id=101,
                )
                same_turn = generate_story_novel_background_impl(
                    db=db, game=game, user=user, world_cards=[], location_label="Платформа",
                    latest_user_prompt="", latest_assistant_text="", assistant_message_id=101,
                )
                next_turn = generate_story_novel_background_impl(
                    db=db, game=game, user=user, world_cards=[], location_label="Лес",
                    latest_user_prompt="", latest_assistant_text="", assistant_message_id=202,
                )

            self.assertEqual(same_turn.id, first.id)
            self.assertNotEqual(next_turn.id, first.id)
            self.assertEqual(db.scalar(select(func.count()).select_from(StorySceneBackground)), 2)
            self.assertEqual(db.get(StorySceneBackground, first.id).image_url, "https://example.com/platform-v2.webp")
            self.assertEqual(db.get(StorySceneBackground, next_turn.id).generated_for_assistant_message_id, 202)


if __name__ == "__main__":
    unittest.main()
