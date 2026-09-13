from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMessage, StoryWorldCard, User  # noqa: E402
from app.routers import story_dnd as dnd_router  # noqa: E402
from app.schemas import (  # noqa: E402
    StoryDndCheckRequest,
    StoryDndEnvironmentRequest,
    StoryDndHeroUpdateRequest,
    StoryDndLevelUpRequest,
    StoryDndNpcUpdateRequest,
    StoryDndPlayModeRequest,
    StoryDndRollRequest,
)
from app.services.story_dnd import serialize_dnd_state, create_default_dnd_state  # noqa: E402


class StoryDndRouterTests(unittest.TestCase):
    """Exercise the endpoints directly against an in-memory database.

    These are deliberately not mocked at the service boundary: the point is to catch the
    plumbing mistakes (argument order, missing normalization, lost state) that unit tests on
    the rules engine cannot see.
    """

    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)
        self.db = self.Session()
        self.admin = User(email="dnd-admin@example.com", password_hash="x", role="administrator")
        self.player = User(email="dnd-player@example.com", password_hash="x", role="user")
        self.db.add_all([self.admin, self.player])
        self.db.flush()
        self.game = StoryGame(
            user_id=self.admin.id,
            title="Подземелье",
            game_mode="dnd",
            dnd_state_payload=serialize_dnd_state(create_default_dnd_state()),
        )
        self.rpg_game = StoryGame(user_id=self.admin.id, title="Обычная игра", game_mode="rpg")
        self.db.add_all([self.game, self.rpg_game])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _as(self, user: User):
        return patch.object(dnd_router, "get_current_user", lambda db, authorization: user)

    # --- access -------------------------------------------------------------------------

    def test_administrator_can_read_state_and_catalog(self) -> None:
        with self._as(self.admin):
            result = dnd_router.read_story_dnd_state(self.game.id, True, None, self.db)
        self.assertEqual(result.game_id, self.game.id)
        self.assertEqual(result.state["play_mode"], "game")
        self.assertIsNotNone(result.catalog)
        self.assertTrue(result.catalog["races"])

    def test_player_gets_404(self) -> None:
        with self._as(self.player), self.assertRaises(HTTPException) as caught:
            dnd_router.read_story_dnd_state(self.game.id, True, None, self.db)
        self.assertEqual(caught.exception.status_code, 404)

    def test_non_dnd_game_gets_404(self) -> None:
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.read_story_dnd_state(self.rpg_game.id, True, None, self.db)
        self.assertEqual(caught.exception.status_code, 404)

    # --- hero sheet ---------------------------------------------------------------------

    def test_saving_a_legal_sheet_persists_it(self) -> None:
        payload = StoryDndHeroUpdateRequest(
            name="Рюрик",
            race="half_orc",
            **{"class": "barbarian"},
            base_abilities={"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
        )
        with self._as(self.admin):
            result = dnd_router.update_story_dnd_hero(self.game.id, payload, None, self.db)
        hero = result.state["hero"]
        self.assertEqual(hero["name"], "Рюрик")
        self.assertEqual(hero["race"], "half_orc")
        self.assertEqual(hero["class"], "barbarian")
        self.assertEqual(hero["abilities"]["str"], 17)  # 15 + racial 2
        # d12 barbarian, CON 13 + half-orc +1 = 14 -> modifier +2.
        self.assertEqual(hero["hp"]["max"], 12 + 2)
        self.assertTrue(result.state["setup_completed"])

    def test_saving_an_illegal_sheet_is_rejected_with_an_explanation(self) -> None:
        payload = StoryDndHeroUpdateRequest(
            base_abilities={"str": 18, "dex": 18, "con": 18, "int": 18, "wis": 18, "cha": 18},
        )
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.update_story_dnd_hero(self.game.id, payload, None, self.db)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("закупка очков", str(caught.exception.detail).lower())

    def test_sandbox_accepts_extreme_abilities(self) -> None:
        with self._as(self.admin):
            dnd_router.update_story_dnd_play_mode(
                self.game.id, StoryDndPlayModeRequest(play_mode="sandbox"), None, self.db
            )
            result = dnd_router.update_story_dnd_hero(
                self.game.id,
                StoryDndHeroUpdateRequest(
                    base_abilities={"str": 30, "dex": 30, "con": 30, "int": 30, "wis": 30, "cha": 30},
                    level=20,
                    hp_max=500,
                ),
                None,
                self.db,
            )
        self.assertEqual(result.state["hero"]["abilities"]["str"], 30)
        self.assertEqual(result.state["hero"]["hp"]["max"], 500)
        self.assertEqual(result.state["hero"]["level"], 20)

    def test_saving_the_sheet_keeps_spent_improvement_points(self) -> None:
        """A plain save must not silently undo a level-up the player already spent."""
        with self._as(self.admin):
            dnd_router.update_story_dnd_hero(
                self.game.id,
                StoryDndHeroUpdateRequest(
                    base_abilities={"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
                ),
                None,
                self.db,
            )
        # Reach level 4 so two improvement points are available.
        state = dnd_router.get_game_dnd_state(self.game)
        state["hero"]["xp"] = 700
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()

        with self._as(self.admin):
            after_level_up = dnd_router.apply_story_dnd_level_up(
                self.game.id, StoryDndLevelUpRequest(asi_allocation={"str": 2}), None, self.db
            )
            # Human (the default race) gives +1 to everything: 15 base + 1 + 2 improvement.
            self.assertEqual(after_level_up.state["hero"]["abilities"]["str"], 18)
            self.assertEqual(after_level_up.state["hero"]["pending_asi_points"], 0)

            after_save = dnd_router.update_story_dnd_hero(
                self.game.id, StoryDndHeroUpdateRequest(name="Рюрик"), None, self.db
            )
        self.assertEqual(after_save.state["hero"]["abilities"]["str"], 18)
        self.assertEqual(after_save.state["hero"]["pending_asi_points"], 0)

    def test_level_up_beyond_the_allowance_is_rejected(self) -> None:
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.apply_story_dnd_level_up(
                self.game.id, StoryDndLevelUpRequest(asi_allocation={"str": 6}), None, self.db
            )
        self.assertEqual(caught.exception.status_code, 400)

    # --- environment ---------------------------------------------------------------------

    def test_environment_is_editable_before_the_first_turn(self) -> None:
        with self._as(self.admin):
            result = dnd_router.update_story_dnd_environment(
                self.game.id,
                StoryDndEnvironmentRequest(season="winter", time_of_day="night", weather="snow"),
                None,
                self.db,
            )
        self.assertEqual(result.state["environment"]["season"], "winter")
        self.assertEqual(result.state["environment"]["weather"], "snow")

    def test_environment_locks_after_the_first_turn(self) -> None:
        state = dnd_router.get_game_dnd_state(self.game)
        state["turn_count"] = 3
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.update_story_dnd_environment(
                self.game.id, StoryDndEnvironmentRequest(time_of_day="night"), None, self.db
            )
        self.assertEqual(caught.exception.status_code, 409)

    def test_sandbox_unlocks_the_environment_again(self) -> None:
        state = dnd_router.get_game_dnd_state(self.game)
        state["turn_count"] = 3
        state["play_mode"] = "sandbox"
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()
        with self._as(self.admin):
            result = dnd_router.update_story_dnd_environment(
                self.game.id, StoryDndEnvironmentRequest(time_of_day="night"), None, self.db
            )
        self.assertEqual(result.state["environment"]["time_of_day"], "night")

    def test_season_rejects_impossible_weather(self) -> None:
        with self._as(self.admin):
            result = dnd_router.update_story_dnd_environment(
                self.game.id,
                StoryDndEnvironmentRequest(season="summer", weather="blizzard"),
                None,
                self.db,
            )
        self.assertNotEqual(result.state["environment"]["weather"], "blizzard")

    # --- NPCs ------------------------------------------------------------------------------

    def _seed_npc_card(self) -> StoryWorldCard:
        card = StoryWorldCard(
            game_id=self.game.id,
            title="Гаррет",
            content="Глава теневой гильдии, худой, седеющий, говорит тихо.",
            kind="npc",
            triggers="[]",
        )
        self.db.add(card)
        self.db.commit()
        return card

    def test_npc_cards_appear_in_the_codex(self) -> None:
        self._seed_npc_card()
        with self._as(self.admin):
            result = dnd_router.read_story_dnd_state(self.game.id, False, None, self.db)
        names = [npc["name"] for npc in result.state["npcs"]]
        self.assertIn("Гаррет", names)

    def test_npc_edit_marks_stats_as_manual(self) -> None:
        self._seed_npc_card()
        with self._as(self.admin):
            dnd_router.read_story_dnd_state(self.game.id, False, None, self.db)
            result = dnd_router.update_story_dnd_npc(
                self.game.id,
                "гаррет",
                StoryDndNpcUpdateRequest(level=14, relation="wary", notes="Опасен"),
                None,
                self.db,
            )
        npc = next(item for item in result.state["npcs"] if item["name"] == "Гаррет")
        self.assertEqual(npc["level"], 14)
        self.assertEqual(npc["relation"], "wary")
        self.assertEqual(npc["stats_source"], "manual")

    def test_meeting_prompt_mentions_the_npc(self) -> None:
        self._seed_npc_card()
        with self._as(self.admin):
            dnd_router.read_story_dnd_state(self.game.id, False, None, self.db)
            result = dnd_router.build_story_dnd_meeting_prompt(self.game.id, "гаррет", None, self.db)
        self.assertIn("Гаррет", result.prompt)

    # --- checks and rolls --------------------------------------------------------------------

    def test_inert_action_costs_nothing_and_needs_no_roll(self) -> None:
        starting_coins = self.admin.coins
        with self._as(self.admin):
            result = dnd_router.analyze_story_dnd_check(
                self.game.id, StoryDndCheckRequest(prompt="иду дальше"), None, self.db
            )
        self.assertFalse(result.needs_check)
        self.assertEqual(result.charged_tokens, 0)
        self.assertEqual(self.admin.coins, starting_coins)

    def test_check_charges_one_sol_and_stores_the_pending_check(self) -> None:
        self.admin.coins = 50
        self.db.commit()
        analysis = {
            "needs_check": True,
            "kind": "skill",
            "skill": "stealth",
            "ability": "dex",
            "die": 20,
            "dc": 15,
            "advantage": "none",
            "situational_modifier": 0,
            "situational_label": "",
            "reason": "Кража при свидетелях",
            "target": "Стражник",
            "success_hint": "Нож у тебя",
            "failure_hint": "Тебя заметили",
        }
        with self._as(self.admin), patch(
            "app.services.story_dnd_service.analyze_dnd_action_check", return_value=analysis
        ):
            result = dnd_router.analyze_story_dnd_check(
                self.game.id,
                StoryDndCheckRequest(prompt="Пытаюсь незаметно вытащить нож у стражника"),
                None,
                self.db,
            )
        self.assertTrue(result.needs_check)
        self.assertEqual(result.charged_tokens, 1)
        self.assertEqual(self.admin.coins, 49)
        self.assertEqual(result.check["skill"], "stealth")
        self.assertTrue(result.check["modifier_breakdown"])

    def test_check_failure_falls_back_to_local_rules_and_refunds(self) -> None:
        """A dead provider must not silently delete the roll.

        This used to return "no check needed", which is exactly how a stealth attempt got
        resolved without dice. Now the keyword rules stand in, and the sol comes back because
        the player paid for a judged check and got a guess.
        """
        self.admin.coins = 50
        self.db.commit()
        with self._as(self.admin), patch(
            "app.services.story_dnd_service.analyze_dnd_action_check",
            side_effect=RuntimeError("provider down"),
        ):
            result = dnd_router.analyze_story_dnd_check(
                self.game.id,
                StoryDndCheckRequest(prompt="Пытаюсь взломать замок отмычкой"),
                None,
                self.db,
            )
        self.assertTrue(result.needs_check)
        self.assertEqual(result.check["skill"], "investigation")
        self.assertEqual(result.charged_tokens, 0)
        self.assertEqual(self.admin.coins, 50)

    def test_check_failure_on_an_inert_action_still_needs_no_roll(self) -> None:
        self.admin.coins = 50
        self.db.commit()
        with self._as(self.admin), patch(
            "app.services.story_dnd_service.analyze_dnd_action_check",
            side_effect=RuntimeError("provider down"),
        ):
            result = dnd_router.analyze_story_dnd_check(
                self.game.id,
                StoryDndCheckRequest(prompt="Оглядываюсь вокруг и жду, что будет дальше"),
                None,
                self.db,
            )
        self.assertFalse(result.needs_check)
        self.assertEqual(self.admin.coins, 50)

    def test_check_without_sols_is_rejected(self) -> None:
        self.admin.coins = 0
        self.db.commit()
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.analyze_story_dnd_check(
                self.game.id,
                StoryDndCheckRequest(prompt="Пытаюсь убедить стражника пропустить нас"),
                None,
                self.db,
            )
        self.assertEqual(caught.exception.status_code, 402)

    def test_roll_consumes_the_pending_check(self) -> None:
        state = dnd_router.get_game_dnd_state(self.game)
        state["pending_check"] = {
            "id": "abc123",
            "prompt": "Крадусь мимо стражи",
            "kind": "skill",
            "skill": "stealth",
            "ability": "dex",
            "die": 20,
            "dc": 15,
        }
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()
        with self._as(self.admin):
            result = dnd_router.roll_story_dnd_check(
                self.game.id, StoryDndRollRequest(check_id="abc123"), None, self.db
            )
        self.assertIn(result.roll["outcome"], {"critical_success", "success", "failure", "critical_failure"})
        self.assertIsNone(result.state["pending_check"])
        self.assertFalse(result.state["last_roll"]["consumed"])

    def test_roll_without_a_pending_check_conflicts(self) -> None:
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.roll_story_dnd_check(self.game.id, StoryDndRollRequest(), None, self.db)
        self.assertEqual(caught.exception.status_code, 409)

    def test_stale_check_id_is_refused(self) -> None:
        state = dnd_router.get_game_dnd_state(self.game)
        state["pending_check"] = {"id": "fresh", "prompt": "Крадусь", "kind": "skill", "skill": "stealth", "dc": 12}
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()
        with self._as(self.admin), self.assertRaises(HTTPException) as caught:
            dnd_router.roll_story_dnd_check(
                self.game.id, StoryDndRollRequest(check_id="stale"), None, self.db
            )
        self.assertEqual(caught.exception.status_code, 409)

    def test_discard_clears_the_pending_check(self) -> None:
        state = dnd_router.get_game_dnd_state(self.game)
        state["pending_check"] = {"id": "x", "prompt": "Крадусь", "kind": "skill", "skill": "stealth", "dc": 12}
        dnd_router.set_game_dnd_state(self.game, state)
        self.db.commit()
        with self._as(self.admin):
            result = dnd_router.discard_story_dnd_check(self.game.id, None, self.db)
        self.assertIsNone(result.state["pending_check"])

    # --- reset ---------------------------------------------------------------------------------

    def test_reset_clears_the_sheet_but_keeps_the_roster(self) -> None:
        self._seed_npc_card()
        with self._as(self.admin):
            dnd_router.read_story_dnd_state(self.game.id, False, None, self.db)
            dnd_router.update_story_dnd_hero(
                self.game.id, StoryDndHeroUpdateRequest(name="Рюрик"), None, self.db
            )
            result = dnd_router.reset_story_dnd_state(self.game.id, None, self.db)
        self.assertEqual(result.state["hero"]["name"], "")
        self.assertTrue(any(npc["name"] == "Гаррет" for npc in result.state["npcs"]))


class StoryDndMessagesTests(unittest.TestCase):
    """The scene tail the check module reads must come from the live turn, not an undone one."""

    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)
        self.db = self.Session()
        user = User(email="tail@example.com", password_hash="x", role="administrator")
        self.db.add(user)
        self.db.flush()
        self.game = StoryGame(user_id=user.id, title="Тест", game_mode="dnd")
        self.db.add(self.game)
        self.db.flush()
        self.db.add_all(
            [
                StoryMessage(game_id=self.game.id, role="assistant", content="Первый ход"),
                StoryMessage(game_id=self.game.id, role="user", content="Иду"),
                StoryMessage(game_id=self.game.id, role="assistant", content="Второй ход"),
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_latest_assistant_text_is_the_last_live_one(self) -> None:
        self.assertEqual(dnd_router._latest_assistant_text(self.db, self.game.id), "Второй ход")


if __name__ == "__main__":
    unittest.main()
