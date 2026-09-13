from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_dnd import (  # noqa: E402
    ABILITY_HARD_CAP,
    DND_OUTCOME_CRITICAL_FAILURE,
    DND_OUTCOME_CRITICAL_SUCCESS,
    DND_OUTCOME_FAILURE,
    DND_OUTCOME_SUCCESS,
    DND_RELATION_SCORES,
    POINT_BUY_BUDGET,
    STORY_DND_PLAY_MODE_SANDBOX,
    ability_modifier,
    apply_race_bonuses,
    award_experience,
    build_check_modifier_breakdown,
    build_dnd_instruction_card,
    create_default_dnd_state,
    deserialize_dnd_state,
    level_for_total_xp,
    max_hit_points,
    normalize_dnd_state,
    perform_roll,
    point_buy_total_cost,
    proficiency_bonus,
    relation_id_for_score,
    resolve_check_advantage,
    resolve_check_outcome,
    serialize_dnd_state,
    validate_hero_sheet,
)
from app.services.story_dnd_apply import apply_dnd_turn_upkeep  # noqa: E402
from app.services.story_dnd_service import dnd_action_needs_model_check  # noqa: E402


class DndAbilityMathTests(unittest.TestCase):
    def test_modifier_matches_5e_table(self) -> None:
        for score, expected in ((1, -5), (8, -1), (10, 0), (11, 0), (15, 2), (20, 5), (30, 10)):
            with self.subTest(score=score):
                self.assertEqual(ability_modifier(score), expected)

    def test_proficiency_bonus_steps_every_four_levels(self) -> None:
        for level, expected in ((1, 2), (4, 2), (5, 3), (9, 4), (13, 5), (17, 6), (20, 6)):
            with self.subTest(level=level):
                self.assertEqual(proficiency_bonus(level), expected)

    def test_standard_array_costs_exactly_the_budget(self) -> None:
        standard_array = {"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8}
        self.assertEqual(point_buy_total_cost(standard_array), POINT_BUY_BUDGET)


class DndSheetValidationTests(unittest.TestCase):
    def test_legal_point_buy_is_accepted(self) -> None:
        result = validate_hero_sheet(
            play_mode="game",
            race_id="human",
            class_id="fighter",
            base_abilities={"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
            level=1,
        )
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.point_buy_spent, POINT_BUY_BUDGET)

    def test_score_above_the_point_buy_band_is_rejected(self) -> None:
        result = validate_hero_sheet(
            play_mode="game",
            race_id="human",
            class_id="fighter",
            base_abilities={"str": 18, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
            level=1,
        )
        self.assertFalse(result.ok)

    def test_overspent_point_buy_is_rejected(self) -> None:
        result = validate_hero_sheet(
            play_mode="game",
            race_id="human",
            class_id="fighter",
            base_abilities={"str": 15, "dex": 15, "con": 15, "int": 15, "wis": 15, "cha": 15},
            level=1,
        )
        self.assertFalse(result.ok)

    def test_asi_beyond_the_earned_allowance_is_rejected(self) -> None:
        result = validate_hero_sheet(
            play_mode="game",
            race_id="human",
            class_id="fighter",
            base_abilities={"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
            level=1,
            spent_asi={"str": 4},
        )
        self.assertFalse(result.ok)

    def test_level_one_cannot_exceed_seventeen_in_strict_mode(self) -> None:
        """15 (the point-buy ceiling) plus the best racial bonus is 17, never 18."""
        abilities = apply_race_bonuses(
            {"str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8},
            "half_orc",
        )
        self.assertLessEqual(max(abilities.values()), 17)
        self.assertLessEqual(max(abilities.values()), ABILITY_HARD_CAP)

    def test_sandbox_allows_extreme_scores(self) -> None:
        result = validate_hero_sheet(
            play_mode=STORY_DND_PLAY_MODE_SANDBOX,
            race_id="human",
            class_id="wizard",
            base_abilities={"str": 30, "dex": 30, "con": 30, "int": 30, "wis": 30, "cha": 30},
            level=20,
        )
        self.assertTrue(result.ok, result.errors)

    def test_sandbox_still_rejects_out_of_range_scores(self) -> None:
        result = validate_hero_sheet(
            play_mode=STORY_DND_PLAY_MODE_SANDBOX,
            race_id="human",
            class_id="wizard",
            base_abilities={"str": 99, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
            level=1,
        )
        self.assertFalse(result.ok)


class DndHitPointTests(unittest.TestCase):
    def test_level_one_fighter_takes_the_full_hit_die(self) -> None:
        self.assertEqual(max_hit_points("fighter", 14, 1), 12)  # d10 + CON 2

    def test_later_levels_use_the_fixed_average(self) -> None:
        # d10 fighter, CON 14: 12 at level 1, then (6 + 2) per level.
        self.assertEqual(max_hit_points("fighter", 14, 3), 12 + 8 + 8)

    def test_minimum_one_hit_point_per_level(self) -> None:
        self.assertGreaterEqual(max_hit_points("wizard", 1, 5), 5)


class DndExperienceTests(unittest.TestCase):
    def test_level_follows_total_experience(self) -> None:
        self.assertEqual(level_for_total_xp(0), 1)
        self.assertEqual(level_for_total_xp(119), 1)
        self.assertEqual(level_for_total_xp(120), 2)
        self.assertEqual(level_for_total_xp(10_000_000), 20)

    def test_award_raises_the_level_and_grants_asi_points(self) -> None:
        state = create_default_dnd_state()
        state["hero"]["xp"] = 630  # one milestone short of level 4
        state["hero"]["level"] = 3
        award_experience(state, "milestone")
        self.assertEqual(state["hero"]["level"], 4)
        self.assertEqual(state["hero"]["pending_asi_points"], 2)
        self.assertIsNotNone(state["last_level_up"])

    def test_unknown_bucket_awards_nothing(self) -> None:
        state = create_default_dnd_state()
        award_experience(state, "legendary_infinite")
        self.assertEqual(state["hero"]["xp"], 0)

    def test_sandbox_experience_never_moves_the_level(self) -> None:
        state = normalize_dnd_state({"play_mode": "sandbox", "hero": {"level": 12}})
        award_experience(state, "milestone")
        self.assertEqual(state["hero"]["level"], 12)


class DndRollTests(unittest.TestCase):
    def test_outcome_grading(self) -> None:
        self.assertEqual(resolve_check_outcome(die=20, natural=20, total=22, dc=30), DND_OUTCOME_CRITICAL_SUCCESS)
        self.assertEqual(resolve_check_outcome(die=20, natural=1, total=11, dc=5), DND_OUTCOME_CRITICAL_FAILURE)
        self.assertEqual(resolve_check_outcome(die=20, natural=12, total=15, dc=15), DND_OUTCOME_SUCCESS)
        self.assertEqual(resolve_check_outcome(die=20, natural=12, total=14, dc=15), DND_OUTCOME_FAILURE)

    def test_smaller_dice_have_no_crit_range(self) -> None:
        self.assertEqual(resolve_check_outcome(die=6, natural=6, total=8, dc=12), DND_OUTCOME_FAILURE)
        self.assertEqual(resolve_check_outcome(die=6, natural=1, total=6, dc=5), DND_OUTCOME_SUCCESS)

    def test_roll_stays_inside_the_die(self) -> None:
        for _ in range(200):
            result = perform_roll(die=20, dc=15, advantage="advantage", modifier_breakdown=[])
            self.assertEqual(len(result.rolls), 2)
            self.assertTrue(all(1 <= value <= 20 for value in result.rolls))
            self.assertEqual(result.natural, max(result.rolls))

    def test_disadvantage_takes_the_lower_die(self) -> None:
        for _ in range(200):
            result = perform_roll(die=20, dc=15, advantage="disadvantage", modifier_breakdown=[])
            self.assertEqual(result.natural, min(result.rolls))

    def test_non_d20_ignores_advantage(self) -> None:
        result = perform_roll(die=6, dc=4, advantage="advantage", modifier_breakdown=[])
        self.assertEqual(len(result.rolls), 1)

    def test_modifier_breakdown_includes_ability_and_proficiency(self) -> None:
        state = create_default_dnd_state()
        state["hero"]["abilities"]["dex"] = 16
        state["hero"]["skill_proficiencies"] = ["stealth"]
        state["hero"]["level"] = 5
        breakdown = build_check_modifier_breakdown(state["hero"], {"kind": "skill", "skill": "stealth"})
        total = sum(item["value"] for item in breakdown)
        self.assertEqual(total, 3 + 3)  # DEX +3, proficiency +3 at level 5

    def test_conditions_decide_advantage(self) -> None:
        hero = create_default_dnd_state()["hero"]
        hero["conditions"] = [{"id": "poisoned"}]
        self.assertEqual(resolve_check_advantage(hero, {}), "disadvantage")
        hero["conditions"] = [{"id": "poisoned"}, {"id": "hidden"}]
        self.assertEqual(resolve_check_advantage(hero, {}), "none")


class DndRelationTests(unittest.TestCase):
    def test_score_maps_to_the_right_band(self) -> None:
        self.assertEqual(relation_id_for_score(-100), "hostile")
        self.assertEqual(relation_id_for_score(-75), "hostile")
        self.assertEqual(relation_id_for_score(-45), "hateful")
        self.assertEqual(relation_id_for_score(-20), "wary")
        self.assertEqual(relation_id_for_score(0), "neutral")
        self.assertEqual(relation_id_for_score(40), "friendly")
        self.assertEqual(relation_id_for_score(100), "in_love")

    def test_the_neutral_band_is_symmetric(self) -> None:
        """One point of friction must not read the same as a whole scene of goodwill.

        The bands used to be lopsided -- a single -1 already showed "Настороженное" while +30
        was still "Нейтральное" -- which made every relationship look either stuck or
        suspicious. Neutral now covers the same distance in both directions.
        """
        for score in (-15, -8, 0, 8, 15):
            self.assertEqual(relation_id_for_score(score), "neutral", score)
        self.assertNotEqual(relation_id_for_score(-16), "neutral")
        self.assertNotEqual(relation_id_for_score(16), "neutral")

    def test_a_hand_picked_label_round_trips(self) -> None:
        # Choosing a relation in the NPC editor stores its canonical score, and reading that
        # score back has to land on the very label the player chose.
        for relation_id, score in DND_RELATION_SCORES.items():
            self.assertEqual(relation_id_for_score(score), relation_id, relation_id)


class DndUpkeepClampTests(unittest.TestCase):
    def _state_with_npc(self) -> dict:
        state = create_default_dnd_state()
        state["npcs"] = [
            {
                "key": "мира",
                "name": "Мира",
                "relation": "neutral",
                "relation_score": 0,
                "level": 2,
                "hp": {"current": 14, "max": 14, "temp": 0},
            }
        ]
        return state

    def test_damage_cannot_exceed_the_hero_maximum(self) -> None:
        state = create_default_dnd_state()
        max_hp = state["hero"]["hp"]["max"]
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"hp": {"should_update": True, "delta": -99_999}}
        )
        self.assertEqual(next_state["hero"]["hp"]["current"], 0)
        self.assertEqual(next_state["hero"]["hp"]["max"], max_hp)

    def test_healing_cannot_exceed_the_maximum(self) -> None:
        state = create_default_dnd_state()
        state["hero"]["hp"]["current"] = 2
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"hp": {"should_update": True, "delta": 9_999}}
        )
        self.assertEqual(next_state["hero"]["hp"]["current"], next_state["hero"]["hp"]["max"])

    def test_temporary_hit_points_absorb_damage_first(self) -> None:
        state = create_default_dnd_state()
        state["hero"]["hp"]["temp"] = 5
        before = state["hero"]["hp"]["current"]
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"hp": {"should_update": True, "delta": -3}}
        )
        self.assertEqual(next_state["hero"]["hp"]["current"], before)
        self.assertEqual(next_state["hero"]["hp"]["temp"], 2)

    def test_a_still_scene_cannot_become_night(self) -> None:
        state = create_default_dnd_state()
        state["environment"]["time_of_day"] = "morning"
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"environment": {"elapsed": "none", "time_of_day": "night", "day_delta": 0}},
        )
        self.assertEqual(next_state["environment"]["time_of_day"], "morning")

    def test_a_still_scene_cannot_change_the_weather(self) -> None:
        state = create_default_dnd_state()
        state["environment"]["weather"] = "clear"
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"environment": {"elapsed": "minutes", "weather": "blizzard"}},
        )
        self.assertEqual(next_state["environment"]["weather"], "clear")

    def test_hours_move_the_clock_but_only_as_far_as_allowed(self) -> None:
        state = create_default_dnd_state()
        state["environment"]["time_of_day"] = "morning"
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"environment": {"elapsed": "hours", "time_of_day": "midnight"}},
        )
        # Two slots forward from "morning" is "afternoon", never midnight.
        self.assertEqual(next_state["environment"]["time_of_day"], "afternoon")

    def test_winter_cannot_arrive_in_summer_even_after_days(self) -> None:
        state = create_default_dnd_state()
        state["environment"]["season"] = "summer"
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"environment": {"elapsed": "days", "weather": "blizzard", "day_delta": 3}},
        )
        self.assertEqual(next_state["environment"]["season"], "summer")
        self.assertNotEqual(next_state["environment"]["weather"], "blizzard")

    def test_season_turns_over_after_a_full_season_of_days(self) -> None:
        state = create_default_dnd_state()
        state["environment"]["season"] = "summer"
        for _ in range(15):
            state, _changes = apply_dnd_turn_upkeep(
                state, {"environment": {"elapsed": "weeks", "day_delta": 30}}
            )
        self.assertNotEqual(state["environment"]["season"], "summer")

    def test_relationship_drift_is_capped_per_turn(self) -> None:
        state = self._state_with_npc()
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"npcs": [{"name": "Мира", "relation_delta": 999, "is_active": True}]}
        )
        # The cap is the point: one turn cannot buy devotion, whatever the model asked for.
        self.assertLessEqual(next_state["npcs"][0]["relation_score"], 18)
        self.assertNotIn(next_state["npcs"][0]["relation"], ("loyal", "devoted", "in_love"))

    def test_repeated_positive_turns_eventually_change_the_band(self) -> None:
        state = self._state_with_npc()
        for _ in range(3):
            state, _changes = apply_dnd_turn_upkeep(
                state, {"npcs": [{"name": "Мира", "relation_delta": 18, "is_active": True}]}
            )
        self.assertIn(state["npcs"][0]["relation"], ("friendly", "loyal"))
        self.assertGreater(state["npcs"][0]["relation_score"], 15)

    def test_npc_not_mentioned_leaves_the_stage(self) -> None:
        state = self._state_with_npc()
        state["npcs"][0]["is_active"] = True
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"npcs": [{"name": "Кто-то другой", "is_active": True}]}
        )
        mira = next((npc for npc in next_state["npcs"] if npc["name"] == "Мира"), None)
        self.assertIsNotNone(mira)
        self.assertFalse(mira["is_active"])

    def test_manual_npc_level_is_not_lowered_or_raised_by_the_model(self) -> None:
        state = self._state_with_npc()
        state["npcs"][0]["level"] = 18
        state["npcs"][0]["stats_source"] = "manual"
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"npcs": [{"name": "Мира", "level": 2, "is_active": True}]}
        )
        self.assertEqual(next_state["npcs"][0]["level"], 18)

    def test_sandbox_inventory_is_left_to_the_player(self) -> None:
        state = normalize_dnd_state({"play_mode": "sandbox"})
        state["hero"]["inventory"] = ["Меч богов"]
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"inventory": {"should_update": True, "removed": ["Меч богов"]}}
        )
        self.assertIn("Меч богов", next_state["hero"]["inventory"])

    def test_quests_are_added_and_completed(self) -> None:
        state = create_default_dnd_state()
        state, _changes = apply_dnd_turn_upkeep(
            state, {"quests": {"added": [{"title": "Найти амулет", "detail": "В склепе"}]}}
        )
        self.assertEqual(state["quests"][0]["status"], "active")
        state, _changes = apply_dnd_turn_upkeep(state, {"quests": {"completed": ["найти амулет"]}})
        self.assertEqual(state["quests"][0]["status"], "done")

    def test_a_malformed_payload_changes_nothing(self) -> None:
        state = create_default_dnd_state()
        next_state, changes = apply_dnd_turn_upkeep(state, {"hp": "not a dict", "npcs": "nope"})
        self.assertEqual(changes, [])
        self.assertEqual(next_state["hero"]["hp"], state["hero"]["hp"])


class DndStateSerializationTests(unittest.TestCase):
    def test_round_trip_is_stable(self) -> None:
        state = create_default_dnd_state()
        self.assertEqual(deserialize_dnd_state(serialize_dnd_state(state)), state)

    def test_garbage_payload_falls_back_to_defaults(self) -> None:
        self.assertEqual(deserialize_dnd_state("{not json"), create_default_dnd_state())
        self.assertEqual(deserialize_dnd_state(None), create_default_dnd_state())

    def test_unknown_keys_are_dropped(self) -> None:
        state = normalize_dnd_state({"hero": {"name": "Рюрик", "hack": True}, "nonsense": 1})
        self.assertEqual(state["hero"]["name"], "Рюрик")
        self.assertNotIn("hack", state["hero"])
        self.assertNotIn("nonsense", state)

    def test_environment_locks_itself_after_the_first_turn(self) -> None:
        self.assertFalse(normalize_dnd_state({"turn_count": 0})["environment"]["locked"])
        self.assertTrue(normalize_dnd_state({"turn_count": 1})["environment"]["locked"])
        self.assertFalse(
            normalize_dnd_state({"turn_count": 5, "play_mode": "sandbox"})["environment"]["locked"]
        )


class DndPromptTests(unittest.TestCase):
    def test_instruction_card_carries_the_sheet(self) -> None:
        state = create_default_dnd_state()
        state["hero"]["name"] = "Рюрик"
        card = build_dnd_instruction_card(state)
        self.assertEqual(card["source_kind"], "dnd")
        self.assertIn("Рюрик", card["content"])
        self.assertIn("Хиты:", card["content"])

    def test_roll_result_is_marked_mandatory(self) -> None:
        state = create_default_dnd_state()
        roll = {
            "die": 20,
            "natural": 20,
            "rolls": [20],
            "advantage": "none",
            "modifier_total": 3,
            "total": 23,
            "dc": 15,
            "outcome": DND_OUTCOME_CRITICAL_SUCCESS,
            "check": {"kind": "skill", "skill": "stealth"},
        }
        content = build_dnd_instruction_card(state, roll=roll)["content"]
        self.assertIn("РЕЗУЛЬТАТ БРОСКА", content)
        self.assertIn("Критический успех", content)


class DndCheckPrefilterTests(unittest.TestCase):
    def test_inert_actions_skip_the_paid_module(self) -> None:
        for text in ("иду дальше", "Осматриваюсь вокруг", "продолжить", "да", "  "):
            with self.subTest(text=text):
                self.assertFalse(dnd_action_needs_model_check(text))

    def test_real_attempts_reach_the_module(self) -> None:
        for text in (
            "Пытаюсь незаметно вытащить нож у стражника",
            "Убеждаю трактирщика дать нам комнату бесплатно",
            "Иду дальше и по пути взламываю замок на сундуке",
        ):
            with self.subTest(text=text):
                self.assertTrue(dnd_action_needs_model_check(text))


if __name__ == "__main__":
    unittest.main()
