"""Rules tests for the parts of D&D mode that decide whether a character lives or acts.

These four groups exist because each one guards a rule that a prompt regression could
otherwise quietly undo: the sheet lock (a played character is built, not re-rolled), death
saves (a hero can actually die), group rolls (skipping a fight still costs dice), and the
initiative order (the bar on screen shows what the rules produce, not what a model said).
"""

from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_dnd import (  # noqa: E402
    DND_COMBAT_PHASE_ACTIVE,
    DND_COMBAT_PHASE_INITIATIVE,
    DND_COMBAT_SIDE_ENEMY,
    DND_COMBAT_SIDE_HERO,
    DND_DEATH_SAVE_DC,
    DND_LIFE_STATE_ALIVE,
    DND_LIFE_STATE_DEAD,
    DND_LIFE_STATE_DYING,
    DND_LIFE_STATE_STABLE,
    DND_MAX_SKILL_PROFICIENCIES,
    DND_OUTCOME_SUCCESS,
    advance_dnd_combat_turn,
    apply_death_save_roll,
    build_dnd_instruction_card,
    dnd_sheet_locks,
    normalize_dnd_state,
    perform_roll,
    resolve_life_state,
    roll_npc_initiatives,
    skill_slots_for_level,
    start_dnd_combat_if_ready,
)
from app.services.story_dnd_apply import apply_dnd_turn_upkeep  # noqa: E402
from app.services.story_dnd_service import build_local_check_fallback  # noqa: E402


def _state(**overrides) -> dict:
    hero = {
        "name": "Алекс",
        "race": "human",
        "class": "rogue",
        "background_id": "urchin",
        "base_abilities": {"str": 11, "dex": 15, "con": 12, "int": 12, "wis": 12, "cha": 11},
    }
    hero.update(overrides.pop("hero", {}))
    return normalize_dnd_state({"hero": hero, **overrides})


class DndSheetLockTests(unittest.TestCase):
    def test_nothing_is_locked_before_the_first_turn(self) -> None:
        locks = dnd_sheet_locks(_state(turn_count=0))
        self.assertFalse(locks["identity_locked"])
        self.assertFalse(locks["abilities_locked"])
        self.assertFalse(locks["skills_locked"])

    def test_identity_and_abilities_lock_once_play_has_started(self) -> None:
        locks = dnd_sheet_locks(_state(turn_count=1))
        self.assertTrue(locks["identity_locked"])
        self.assertTrue(locks["abilities_locked"])

    def test_sandbox_never_locks(self) -> None:
        locks = dnd_sheet_locks(_state(turn_count=40, play_mode="sandbox"))
        self.assertFalse(locks["identity_locked"])
        self.assertFalse(locks["abilities_locked"])
        self.assertFalse(locks["skills_locked"])

    def test_skills_lock_only_when_every_slot_is_spent(self) -> None:
        # A rogue with a background has six slots and starts with the four class skills, so
        # two are still open and the picker must stay usable.
        state = _state(turn_count=3)
        locks = dnd_sheet_locks(state)
        self.assertEqual(locks["skill_slots"], 6)
        self.assertEqual(locks["free_skill_slots"], 2)
        self.assertFalse(locks["skills_locked"])

        filled = _state(
            turn_count=3,
            hero={
                "skill_proficiencies": [
                    "stealth",
                    "sleight_of_hand",
                    "perception",
                    "deception",
                    "acrobatics",
                    "investigation",
                ]
            },
        )
        self.assertTrue(dnd_sheet_locks(filled)["skills_locked"])

    def test_a_level_opens_exactly_one_new_slot(self) -> None:
        before = skill_slots_for_level("rogue", 4, "urchin")
        after = skill_slots_for_level("rogue", 5, "urchin")
        self.assertEqual(after, min(before + 1, DND_MAX_SKILL_PROFICIENCIES))

    def test_stored_skills_are_trimmed_to_the_slots_the_level_granted(self) -> None:
        # A blob claiming six proficiencies for a class that has earned two keeps two.
        state = _state(
            hero={
                "class": "fighter",
                "background_id": "",
                "skill_proficiencies": [
                    "athletics",
                    "intimidation",
                    "stealth",
                    "arcana",
                    "history",
                    "medicine",
                ],
            }
        )
        self.assertEqual(len(state["hero"]["skill_proficiencies"]), 2)


class DndDeathTests(unittest.TestCase):
    def test_life_state_follows_hit_points(self) -> None:
        self.assertEqual(
            resolve_life_state(hp_current=5, death_saves={}, is_dead=False), DND_LIFE_STATE_ALIVE
        )
        self.assertEqual(
            resolve_life_state(hp_current=0, death_saves={}, is_dead=False), DND_LIFE_STATE_DYING
        )
        self.assertEqual(
            resolve_life_state(hp_current=0, death_saves={"successes": 3}, is_dead=False),
            DND_LIFE_STATE_STABLE,
        )
        self.assertEqual(
            resolve_life_state(hp_current=0, death_saves={"failures": 3}, is_dead=False),
            DND_LIFE_STATE_DEAD,
        )

    def test_a_hero_with_hit_points_can_never_be_dying(self) -> None:
        # The point of deriving the state: "dead with 12 hit points" is not representable.
        state = _state(hero={"hp": {"current": 12, "max": 12}, "death_saves": {"failures": 2}})
        self.assertEqual(state["hero"]["life_state"], DND_LIFE_STATE_ALIVE)
        self.assertEqual(state["hero"]["death_saves"], {"successes": 0, "failures": 0})

    def test_three_failures_kill(self) -> None:
        hero = {"hp": {"current": 0, "max": 9, "temp": 0}, "death_saves": {"successes": 0, "failures": 2}}
        summary = apply_death_save_roll(hero, natural=4, total=4)
        self.assertEqual(summary["life_state"], DND_LIFE_STATE_DEAD)
        self.assertTrue(hero["is_dead"])

    def test_three_successes_stabilize(self) -> None:
        hero = {"hp": {"current": 0, "max": 9, "temp": 0}, "death_saves": {"successes": 2, "failures": 1}}
        summary = apply_death_save_roll(hero, natural=15, total=15)
        self.assertEqual(summary["life_state"], DND_LIFE_STATE_STABLE)

    def test_natural_twenty_puts_the_hero_back_up_with_one_hit_point(self) -> None:
        hero = {"hp": {"current": 0, "max": 9, "temp": 0}, "death_saves": {"successes": 0, "failures": 2}}
        summary = apply_death_save_roll(hero, natural=20, total=20)
        self.assertTrue(summary["revived"])
        self.assertEqual(hero["hp"]["current"], 1)
        self.assertEqual(summary["life_state"], DND_LIFE_STATE_ALIVE)

    def test_natural_one_counts_as_two_failures(self) -> None:
        hero = {"hp": {"current": 0, "max": 9, "temp": 0}, "death_saves": {"successes": 0, "failures": 1}}
        apply_death_save_roll(hero, natural=1, total=1)
        self.assertEqual(hero["death_saves"]["failures"], 3)

    def test_a_save_just_under_the_dc_is_a_failure(self) -> None:
        hero = {"hp": {"current": 0, "max": 9, "temp": 0}, "death_saves": {}}
        apply_death_save_roll(hero, natural=DND_DEATH_SAVE_DC - 1, total=DND_DEATH_SAVE_DC - 1)
        self.assertEqual(hero["death_saves"]["failures"], 1)

    def test_falling_to_zero_marks_the_hero_unconscious(self) -> None:
        state = _state(hero={"hp": {"current": 9, "max": 9}}, turn_count=2)
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"hp": {"should_update": True, "delta": -30}}, turn_index=3
        )
        self.assertEqual(next_state["hero"]["hp"]["current"], 0)
        self.assertEqual(next_state["hero"]["life_state"], DND_LIFE_STATE_DYING)
        self.assertIn(
            "unconscious", {item["id"] for item in next_state["hero"]["conditions"]}
        )

    def test_an_unconscious_hero_is_announced_to_the_narrator(self) -> None:
        state = _state(hero={"hp": {"current": 0, "max": 9}})
        card = build_dnd_instruction_card(state)
        self.assertIn("БЕЗ СОЗНАНИЯ", card["content"])

    def test_a_dead_hero_ends_the_story_in_the_prompt(self) -> None:
        state = _state(hero={"hp": {"current": 0, "max": 9}, "is_dead": True})
        card = build_dnd_instruction_card(state)
        self.assertIn("ГЕРОЙ МЁРТВ", card["content"])


class DndGroupRollTests(unittest.TestCase):
    def test_one_die_per_target(self) -> None:
        result = perform_roll(
            die=20,
            dc=10,
            advantage="none",
            modifier_breakdown=[],
            group_targets=["Бандит", "Головорез", "Главарь"],
        ).to_dict()
        self.assertEqual(result["group_size"], 3)
        self.assertEqual(len(result["group_targets"]), 3)

    def test_difficulty_climbs_down_the_line(self) -> None:
        result = perform_roll(
            die=20, dc=10, advantage="none", modifier_breakdown=[], group_targets=["A", "B", "C"]
        ).to_dict()
        difficulties = [item["dc"] for item in result["group_targets"]]
        self.assertEqual(difficulties, sorted(difficulties))
        self.assertLess(difficulties[0], difficulties[-1])

    def test_a_single_target_is_an_ordinary_roll(self) -> None:
        result = perform_roll(
            die=20, dc=10, advantage="none", modifier_breakdown=[], group_targets=["Бандит"]
        ).to_dict()
        self.assertEqual(result["group_size"], 0)

    def test_a_partial_sweep_never_reads_as_a_win(self) -> None:
        """Leaving one enemy standing is a failed sweep, however well the other dice went.

        This is the rule that keeps "я убиваю их всех" honest, so it is checked over many
        rolls rather than one: a headline success must imply every target went down. (A
        natural 20 still crits against any DC, so individual successes at DC 30 are expected.)
        """
        for _attempt in range(200):
            result = perform_roll(
                die=20, dc=25, advantage="none", modifier_breakdown=[], group_targets=["A", "B", "C"]
            ).to_dict()
            if result["outcome"] == DND_OUTCOME_SUCCESS:
                self.assertEqual(result["group_successes"], result["group_size"])
            if result["group_successes"] < result["group_size"]:
                self.assertNotEqual(result["outcome"], DND_OUTCOME_SUCCESS)

    def test_a_sweeping_declaration_is_detected_offline(self) -> None:
        fallback = build_local_check_fallback("Выхватываю клинки и убиваю их всех")
        self.assertTrue(fallback["needs_check"])
        self.assertGreater(len(fallback["group_targets"]), 1)


class DndCombatTests(unittest.TestCase):
    def _fight(self) -> dict:
        state = _state(
            turn_count=4,
            npcs=[
                {
                    "name": "Герта",
                    "level": 14,
                    "hp": {"current": 120, "max": 120},
                    "armor_class": 16,
                    "abilities": {"dex": 14},
                }
            ],
        )
        payload = {
            "combat": {
                "started": True,
                "in_combat": True,
                "participants": [
                    {"name": "Алекс", "side": "hero"},
                    {"name": "Бандит", "side": "enemy", "max_hp": 11, "armor_class": 12, "dex_modifier": 2},
                    {"name": "Герта", "side": "ally"},
                ],
            }
        }
        next_state, _changes = apply_dnd_turn_upkeep(state, payload, turn_index=5)
        return next_state

    def test_a_fight_starts_waiting_on_the_players_own_die(self) -> None:
        combat = self._fight()["combat"]
        self.assertTrue(combat["active"])
        self.assertEqual(combat["phase"], DND_COMBAT_PHASE_INITIATIVE)
        hero = next(item for item in combat["participants"] if item["side"] == DND_COMBAT_SIDE_HERO)
        self.assertIsNone(hero["initiative"])

    def test_everyone_else_rolls_automatically(self) -> None:
        combat = self._fight()["combat"]
        others = [item for item in combat["participants"] if item["side"] != DND_COMBAT_SIDE_HERO]
        self.assertTrue(others)
        for participant in others:
            self.assertIsNotNone(participant["initiative"])

    def test_a_statted_npc_keeps_its_own_numbers(self) -> None:
        # An archmage the player statted by hand must not become a bandit because a fight
        # broke out and the model guessed some hit points.
        state = _state(
            turn_count=4,
            npcs=[
                {
                    "name": "Герта",
                    "level": 14,
                    "hp": {"current": 120, "max": 120},
                    "armor_class": 16,
                    "stats_source": "manual",
                }
            ],
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {
                "combat": {
                    "started": True,
                    "in_combat": True,
                    "participants": [
                        {"name": "Алекс", "side": "hero"},
                        {"name": "Герта", "side": "enemy", "max_hp": 11, "armor_class": 12},
                    ],
                }
            },
            turn_index=5,
        )
        gerta = next(item for item in next_state["combat"]["participants"] if item["name"] == "Герта")
        self.assertEqual(gerta["hp"]["max"], 120)
        self.assertEqual(gerta["armor_class"], 16)

    def test_a_thug_invented_this_turn_takes_the_fights_numbers(self) -> None:
        # The other half of the same rule: a placeholder roster entry created by this very
        # turn has no numbers worth defending, so the fight's own stat block wins and is
        # written back, leaving the codex and the initiative bar in agreement.
        state = _state(turn_count=6)
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {
                "npcs": [{"name": "Старший грабитель", "is_active": True}],
                "combat": {
                    "started": True,
                    "in_combat": True,
                    "participants": [
                        {"name": "Алекс", "side": "hero"},
                        {
                            "name": "Старший грабитель",
                            "side": "enemy",
                            "max_hp": 11,
                            "armor_class": 12,
                            "dex_modifier": 1,
                        },
                    ],
                },
            },
            turn_index=7,
        )
        participant = next(
            item for item in next_state["combat"]["participants"] if item["name"] == "Старший грабитель"
        )
        self.assertEqual(participant["hp"]["max"], 11)
        self.assertEqual(participant["armor_class"], 12)
        roster = next(item for item in next_state["npcs"] if item["name"] == "Старший грабитель")
        self.assertEqual(roster["hp"]["max"], 11)
        self.assertEqual(roster["armor_class"], 12)

    def test_the_fight_begins_once_the_last_die_has_landed(self) -> None:
        combat = self._fight()["combat"]
        hero = next(item for item in combat["participants"] if item["side"] == DND_COMBAT_SIDE_HERO)
        hero["initiative"] = 18
        combat = start_dnd_combat_if_ready(roll_npc_initiatives(combat))
        self.assertEqual(combat["phase"], DND_COMBAT_PHASE_ACTIVE)
        initiatives = [item["initiative"] for item in combat["participants"]]
        self.assertEqual(initiatives, sorted(initiatives, reverse=True))

    def test_turns_wrap_into_the_next_round(self) -> None:
        combat = self._fight()["combat"]
        next(item for item in combat["participants"] if item["side"] == DND_COMBAT_SIDE_HERO)["initiative"] = 18
        combat = start_dnd_combat_if_ready(roll_npc_initiatives(combat))
        combat = advance_dnd_combat_turn(combat, steps=len(combat["participants"]))
        self.assertEqual(combat["round"], 2)
        self.assertEqual(combat["turn_index"], 0)

    def test_a_downed_combatant_is_skipped(self) -> None:
        combat = self._fight()["combat"]
        next(item for item in combat["participants"] if item["side"] == DND_COMBAT_SIDE_HERO)["initiative"] = 18
        combat = start_dnd_combat_if_ready(roll_npc_initiatives(combat))
        combat["participants"][1]["is_down"] = True
        combat = advance_dnd_combat_turn(combat, steps=1)
        self.assertFalse(combat["participants"][combat["turn_index"]]["is_down"])

    def test_the_last_enemy_falling_ends_the_fight(self) -> None:
        state = self._fight()
        payload = {"combat": {"in_combat": True, "participants": [
            {"name": "Алекс", "side": "hero"},
            {"name": "Бандит", "side": "enemy"},
        ], "defeated": ["Бандит"]}}
        next_state, _changes = apply_dnd_turn_upkeep(state, payload, turn_index=6)
        self.assertFalse(next_state["combat"]["active"])

    def test_a_fight_the_narrator_stopped_mentioning_closes_itself(self) -> None:
        state = self._fight()
        next_state, _changes = apply_dnd_turn_upkeep(state, {}, turn_index=6)
        self.assertFalse(next_state["combat"]["active"])

    def test_a_dead_hero_leaves_no_fight_behind(self) -> None:
        state = self._fight()
        state["hero"]["hp"] = {"current": 1, "max": 9, "temp": 0}
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {
                "hp": {"should_update": True, "delta": -40},
                "combat": {"in_combat": True, "participants": [
                    {"name": "Алекс", "side": "hero"},
                    {"name": "Бандит", "side": "enemy"},
                ]},
            },
            turn_index=7,
        )
        self.assertFalse(next_state["combat"]["active"])

    def test_combat_reaches_the_narrator_prompt(self) -> None:
        state = self._fight()
        next(
            item for item in state["combat"]["participants"] if item["side"] == DND_COMBAT_SIDE_HERO
        )["initiative"] = 18
        state["combat"] = start_dnd_combat_if_ready(state["combat"])
        card = build_dnd_instruction_card(state)
        self.assertIn("БОЙ", card["content"])
        self.assertIn("Раунд", card["content"])

    def test_a_fight_without_enemies_is_not_a_fight(self) -> None:
        state = _state(turn_count=2)
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"combat": {"started": True, "participants": [{"name": "Алекс", "side": "hero"}]}},
            turn_index=3,
        )
        self.assertFalse(next_state["combat"]["active"])
        self.assertEqual(
            [item for item in next_state["combat"]["participants"] if item["side"] == DND_COMBAT_SIDE_ENEMY],
            [],
        )


if __name__ == "__main__":
    unittest.main()
