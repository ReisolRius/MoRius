"""Rules tests for the second pass over D&D mode.

Each group guards something a player complained about and that a prompt change alone could
silently undo: which arm a character swings with, where a difficulty number comes from, money
that lives in the purse rather than the backpack, conditions that expire, and a stage that
empties when the party walks away from it.
"""

from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_dnd import (  # noqa: E402
    DND_CHECK_KIND_ATTACK,
    STORY_DND_DIFFICULTY_DEADLY,
    STORY_DND_DIFFICULTY_EASY,
    STORY_DND_DIFFICULTY_HARD,
    STORY_DND_DIFFICULTY_NORMAL,
    STORY_DND_ROLL_POLICY_STORY,
    attack_ability_for_hero,
    build_check_modifier_breakdown,
    creature_save_dc,
    default_gold_for,
    default_inventory_for,
    difficulty_hero_bonus,
    expire_dnd_conditions,
    extract_starting_gold,
    normalize_dnd_hero,
    normalize_dnd_state,
    resolve_check_dc,
)
from app.services.story_dnd_apply import apply_dnd_turn_upkeep  # noqa: E402


def _rogue(**overrides) -> dict:
    hero = {
        "class": "rogue",
        "base_abilities": {"str": 11, "dex": 15, "con": 12, "int": 12, "wis": 12, "cha": 11},
    }
    hero.update(overrides)
    return normalize_dnd_hero(hero, play_mode="game")


class DndAttackAbilityTests(unittest.TestCase):
    def test_a_rogue_swings_with_dexterity(self) -> None:
        """A rogue with DEX 16 and STR 12 attacks with Ловкость, whatever the prose says."""
        self.assertEqual(attack_ability_for_hero(_rogue()), "dex")

    def test_a_fighter_swings_with_strength(self) -> None:
        fighter = normalize_dnd_hero(
            {"class": "fighter", "base_abilities": {"str": 15, "dex": 12, "con": 13, "int": 10, "wis": 10, "cha": 8}},
            play_mode="game",
        )
        self.assertEqual(attack_ability_for_hero(fighter), "str")

    def test_a_finesse_class_still_uses_strength_when_it_is_higher(self) -> None:
        strong_rogue = _rogue(base_abilities={"str": 15, "dex": 10, "con": 12, "int": 12, "wis": 12, "cha": 11})
        self.assertEqual(attack_ability_for_hero(strong_rogue), "str")

    def test_the_models_choice_of_ability_is_overridden_for_attacks(self) -> None:
        # The judge said "str"; the character sheet says otherwise, and the sheet wins.
        breakdown = build_check_modifier_breakdown(_rogue(), {"kind": DND_CHECK_KIND_ATTACK, "ability": "str"})
        labels = {item["label"] for item in breakdown}
        self.assertIn("ЛОВ", labels)
        self.assertNotIn("СИЛ", labels)


class DndDerivedDifficultyTests(unittest.TestCase):
    def _state(self, difficulty: str = STORY_DND_DIFFICULTY_NORMAL) -> dict:
        return normalize_dnd_state(
            {
                "hero": {"class": "rogue"},
                "difficulty": difficulty,
                "combat": {
                    "active": True,
                    "participants": [
                        {"name": "Алекс", "side": "hero"},
                        {
                            "name": "Тварь во тьме",
                            "side": "enemy",
                            "armor_class": 13,
                            "level": 3,
                            "abilities": {"str": 16, "dex": 12, "con": 14, "int": 4, "wis": 10, "cha": 5},
                        },
                    ],
                },
            }
        )

    def test_an_attacks_difficulty_is_the_targets_armour_class(self) -> None:
        dc, source = resolve_check_dc(self._state(), {"kind": "attack", "dc": 22, "target": "Тварь во тьме"})
        self.assertEqual(dc, 13)
        self.assertIn("КД цели", source)

    def test_the_same_creature_is_the_same_difficulty_every_time(self) -> None:
        state = self._state()
        first, _ = resolve_check_dc(state, {"kind": "attack", "dc": 9, "target": "Тварь во тьме"})
        second, _ = resolve_check_dc(state, {"kind": "attack", "dc": 27, "target": "Тварь во тьме"})
        self.assertEqual(first, second)

    def test_a_creature_save_uses_the_5e_monster_formula(self) -> None:
        creature = {"level": 3, "abilities": {"str": 16, "dex": 12, "con": 14, "int": 4, "wis": 10, "cha": 5}}
        # 8 + proficiency 2 + best modifier (+3 from STR 16)
        self.assertEqual(creature_save_dc(creature), 13)

    def test_an_unknown_target_keeps_the_masters_number(self) -> None:
        dc, source = resolve_check_dc(self._state(), {"kind": "skill", "dc": 17, "target": "никого"})
        self.assertEqual(dc, 17)
        self.assertEqual(source, "")

    def test_the_difficulty_dial_shifts_every_check(self) -> None:
        check = {"kind": "attack", "dc": 15, "target": "Тварь во тьме"}
        easy, _ = resolve_check_dc(self._state(STORY_DND_DIFFICULTY_EASY), check)
        normal, _ = resolve_check_dc(self._state(STORY_DND_DIFFICULTY_NORMAL), check)
        hard, _ = resolve_check_dc(self._state(STORY_DND_DIFFICULTY_HARD), check)
        deadly, _ = resolve_check_dc(self._state(STORY_DND_DIFFICULTY_DEADLY), check)
        self.assertLess(easy, normal)
        self.assertLess(normal, hard)
        self.assertLess(hard, deadly)

    def test_easy_mode_also_helps_the_hero_directly(self) -> None:
        self.assertGreater(difficulty_hero_bonus(STORY_DND_DIFFICULTY_EASY), 0)
        self.assertEqual(difficulty_hero_bonus(STORY_DND_DIFFICULTY_NORMAL), 0)
        self.assertLess(difficulty_hero_bonus(STORY_DND_DIFFICULTY_DEADLY), 0)

    def test_the_difficulty_bonus_reaches_the_dice(self) -> None:
        breakdown = build_check_modifier_breakdown(_rogue(), {"kind": "skill", "skill": "stealth", "difficulty_bonus": 2})
        self.assertIn(2, [item["value"] for item in breakdown if item["key"] == "difficulty"])


class DndStartingGoldTests(unittest.TestCase):
    def test_a_coin_pouch_becomes_money(self) -> None:
        gold, items = extract_starting_gold(["Короткий меч", "Мешочек с 12 зм", "Кожаный доспех"])
        self.assertEqual(gold, 12)
        self.assertEqual(items, ["Короткий меч", "Кожаный доспех"])

    def test_a_component_pouch_is_not_money(self) -> None:
        gold, items = extract_starting_gold(["Посох", "Компонентный мешочек"])
        self.assertEqual(gold, 0)
        self.assertIn("Компонентный мешочек", items)

    def test_a_new_character_starts_funded_and_with_a_clean_pack(self) -> None:
        hero = _rogue()
        self.assertEqual(hero["gold"], default_gold_for("rogue"))
        self.assertGreater(hero["gold"], 0)
        self.assertNotIn("Мешочек с 12 зм", hero["inventory"])

    def test_an_older_sheet_moves_its_purse_to_the_gold_line(self) -> None:
        hero = normalize_dnd_hero(
            {"class": "rogue", "gold": 0, "inventory": ["Короткий меч", "Мешочек с 12 зм"]},
            play_mode="game",
        )
        self.assertEqual(hero["gold"], 12)
        self.assertEqual(hero["inventory"], ["Короткий меч"])

    def test_the_class_kit_no_longer_lists_coins(self) -> None:
        for class_id in ("rogue", "fighter", "wizard", "bard"):
            with self.subTest(class_id=class_id):
                self.assertFalse(
                    any("зм" in item for item in default_inventory_for(class_id, "human")),
                    class_id,
                )


class DndConditionExpiryTests(unittest.TestCase):
    def test_a_hold_does_not_outlive_the_scene(self) -> None:
        kept, expired = expire_dnd_conditions([{"id": "restrained", "turn": 4}], current_turn=10)
        self.assertEqual(expired, ["restrained"])
        self.assertEqual(kept, [])

    def test_a_slow_condition_persists(self) -> None:
        kept, expired = expire_dnd_conditions([{"id": "exhaustion", "turn": 1}], current_turn=40)
        self.assertEqual(expired, [])
        self.assertEqual(len(kept), 1)

    def test_a_fresh_condition_survives_its_own_turn(self) -> None:
        kept, expired = expire_dnd_conditions([{"id": "prone", "turn": 9}], current_turn=9)
        self.assertEqual(expired, [])
        self.assertEqual(len(kept), 1)

    def test_expiry_runs_even_when_the_model_says_nothing(self) -> None:
        state = normalize_dnd_state(
            {"turn_count": 9, "hero": {"conditions": [{"id": "grappled", "turn": 2}]}}
        )
        next_state, changes = apply_dnd_turn_upkeep(state, {}, turn_index=10)
        self.assertEqual(next_state["hero"]["conditions"], [])
        self.assertTrue(any("expired" in change for change in changes))


class DndSceneTests(unittest.TestCase):
    def test_walking_away_clears_the_stage(self) -> None:
        """The archmage the hero said goodbye to must not speak from the catacomb doorway."""
        state = normalize_dnd_state(
            {
                "turn_count": 5,
                "scene_location": "Улица города",
                "npcs": [{"name": "Герта", "is_active": True}, {"name": "Рябой", "is_active": False}],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {}, turn_index=6, location_label="Катакомбы под гильдией"
        )
        self.assertFalse(any(npc["is_active"] for npc in next_state["npcs"]))
        self.assertEqual(next_state["scene_location"], "Катакомбы под гильдией")

    def test_staying_put_keeps_the_scene(self) -> None:
        state = normalize_dnd_state(
            {"turn_count": 5, "scene_location": "Улица города", "npcs": [{"name": "Герта", "is_active": True}]}
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"npcs": [{"name": "Герта", "is_active": True}]},
            turn_index=6,
            location_label="Улица города",
        )
        self.assertTrue(next_state["npcs"][0]["is_active"])

    def test_the_default_table_favours_roleplay_over_dice(self) -> None:
        self.assertEqual(normalize_dnd_state({})["roll_policy"], STORY_DND_ROLL_POLICY_STORY)
        self.assertEqual(normalize_dnd_state({})["difficulty"], STORY_DND_DIFFICULTY_NORMAL)


if __name__ == "__main__":
    unittest.main()
