"""Rules tests for the third pass: money, identity, feelings, the clock and the room.

Each group pins down something that was wrong in play and that no amount of prompt tuning
could guarantee on its own: change for small coins, two cards for one character, a label that
said "Влюблена" while the scene stayed polite, a clock that ignored the player, and a
bodyguard who teleported across the room between paragraphs.
"""

from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_dnd import (  # noqa: E402
    DEFAULT_MOOD,
    DND_MOOD_TURN_BUDGET,
    build_dnd_instruction_card,
    currency_to_base_units,
    dedupe_dnd_npcs,
    describe_npc_relationship,
    format_currency,
    normalize_dnd_state,
    npc_identity_keys,
    relation_check_shift,
    resolve_check_dc,
    split_currency,
)
from app.services.story_dnd_apply import apply_dnd_turn_upkeep  # noqa: E402


class DndCurrencyTests(unittest.TestCase):
    def test_a_purse_reads_as_coins(self) -> None:
        self.assertEqual(format_currency(1500, "fantasy"), "15 зм")
        self.assertEqual(format_currency(0, "fantasy"), "0 мм")

    def test_small_change_comes_out_of_the_whole_purse(self) -> None:
        """Fifteen gold minus five coppers is 14/9/5, not fourteen gold.

        This is the entire reason the purse is one integer: with a "gold" field, a five-copper
        bribe could only ever be rounded up to a coin the player did not intend to spend.
        """
        self.assertEqual(format_currency(1500 - 5, "fantasy"), "14 зм 9 см 5 мм")

    def test_each_setting_speaks_its_own_money(self) -> None:
        self.assertEqual(format_currency(40_000, "modern"), "400 $")
        self.assertEqual(format_currency(15_000, "cyberpunk"), "15 ткр")

    def test_coin_counts_convert_to_base_units(self) -> None:
        self.assertEqual(currency_to_base_units({"gp": 3, "sp": 4}, "fantasy"), 340)
        # A denomination the setting does not have is ignored rather than guessed at.
        self.assertEqual(currency_to_base_units({"galleons": 9}, "fantasy"), 0)

    def test_splitting_skips_empty_denominations(self) -> None:
        self.assertEqual([part["id"] for part in split_currency(1500, "fantasy")], ["gp"])

    def test_an_older_sheet_keeps_its_money(self) -> None:
        state = normalize_dnd_state({"hero": {"class": "rogue", "gold": 15, "inventory": ["Меч"]}})
        self.assertEqual(state["hero"]["purse"], 1500)
        self.assertEqual(state["hero"]["purse_display"], "15 зм")

    def test_paying_in_coppers_leaves_change(self) -> None:
        state = normalize_dnd_state({"turn_count": 3, "hero": {"class": "rogue", "purse": 1500}})
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"gold": {"should_update": True, "coins": {"cp": -5}}}, turn_index=4
        )
        self.assertEqual(next_state["hero"]["purse_display"], "14 зм 9 см 5 мм")

    def test_a_plain_delta_still_means_main_coins(self) -> None:
        state = normalize_dnd_state({"turn_count": 3, "hero": {"class": "rogue", "purse": 1500}})
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"gold": {"should_update": True, "delta": 3}}, turn_index=4
        )
        self.assertEqual(next_state["hero"]["purse"], 1800)


class DndIdentityTests(unittest.TestCase):
    def test_a_named_character_absorbs_the_role_they_were_introduced_as(self) -> None:
        kept, merged = dedupe_dnd_npcs(
            [
                {"name": "Слуга Алисии", "key": "слуга алисии", "role": "сопровождающий", "aliases": []},
                {"name": "Томас", "key": "томас", "role": "телохранитель", "aliases": ["Слуга Алисии"]},
            ]
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["name"], "Томас")
        self.assertIn("Слуга Алисии", kept[0]["aliases"])
        self.assertTrue(merged)

    def test_the_merge_keeps_what_each_half_knew(self) -> None:
        kept, _merged = dedupe_dnd_npcs(
            [
                {"name": "Незнакомец", "key": "незнакомец", "notes": "Шрам через бровь", "relation_score": -20},
                {"name": "Рябой", "key": "рябой", "aliases": ["Незнакомец"], "relation_score": 0},
            ]
        )
        self.assertEqual(kept[0]["name"], "Рябой")
        self.assertEqual(kept[0]["notes"], "Шрам через бровь")
        self.assertEqual(kept[0]["relation_score"], -20)

    def test_two_genuinely_different_people_stay_apart(self) -> None:
        kept, merged = dedupe_dnd_npcs(
            [{"name": "Герта", "key": "герта"}, {"name": "Алисия", "key": "алисия"}]
        )
        self.assertEqual(len(kept), 2)
        self.assertFalse(merged)

    def test_identity_keys_cover_every_label(self) -> None:
        keys = npc_identity_keys({"name": "Томас", "key": "томас", "aliases": ["Слуга Алисии"]})
        self.assertIn("томас", keys)
        self.assertIn("слуга алисии", keys)

    def test_the_state_never_holds_the_same_person_twice(self) -> None:
        state = normalize_dnd_state(
            {
                "npcs": [
                    {"name": "Слуга Алисии", "is_active": True},
                    {"name": "Томас", "aliases": ["Слуга Алисии"]},
                ]
            }
        )
        self.assertEqual(len(state["npcs"]), 1)

    def test_a_named_character_absorbs_the_placeholder_even_on_a_loose_answer(self) -> None:
        """The model is asked for the roster label and sometimes answers with the job.

        It reported was_called="Телохранитель" for a row filed as "Слуга Алисии", which left
        the party with two cards for one man. The role and the place in the room both point at
        the same row, so the merge still happens.
        """
        state = normalize_dnd_state(
            {
                "turn_count": 6,
                "scene_location": "Чайный дом",
                "npcs": [
                    {"name": "Алисия", "is_active": True},
                    {
                        "name": "Слуга Алисии",
                        "role": "телохранитель",
                        "is_active": True,
                        "position": "за спиной госпожи",
                    },
                ],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {
                "npcs": [
                    {"name": "Алисия", "is_active": True},
                    {
                        "name": "Томас",
                        "role": "телохранитель",
                        "is_active": True,
                        "position": "за спиной госпожи",
                        "was_called": "Телохранитель",
                    },
                ]
            },
            turn_index=7,
            location_label="Чайный дом",
        )
        names = {npc["name"] for npc in next_state["npcs"]}
        self.assertEqual(names, {"Алисия", "Томас"})
        thomas = next(npc for npc in next_state["npcs"] if npc["name"] == "Томас")
        self.assertIn("Слуга Алисии", thomas["aliases"])

    def test_two_real_people_are_never_welded_together(self) -> None:
        # The merge is deliberately narrow: a row filed under a real name is never a
        # placeholder, however well the roles line up.
        state = normalize_dnd_state(
            {
                "turn_count": 6,
                "scene_location": "Казарма",
                "npcs": [
                    {"name": "Герта", "role": "маг", "is_active": True, "position": "у окна"},
                    {"name": "Алисия", "role": "маг", "is_active": True, "position": "у окна"},
                ],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {
                "npcs": [
                    {
                        "name": "Алисия",
                        "role": "маг",
                        "is_active": True,
                        "position": "у окна",
                        "was_called": "Маг",
                    }
                ]
            },
            turn_index=7,
            location_label="Казарма",
        )
        self.assertEqual(len(next_state["npcs"]), 2)

    def test_appearing_on_stage_is_remembered(self) -> None:
        state = normalize_dnd_state({"npcs": [{"name": "Герта", "is_active": True}]})
        self.assertTrue(state["npcs"][0]["has_appeared"])


class DndFeelingTests(unittest.TestCase):
    def _state(self, relation: str, mood: str = DEFAULT_MOOD) -> dict:
        return normalize_dnd_state(
            {
                "hero": {"class": "rogue"},
                "npcs": [{"name": "Алисия", "relation": relation, "mood": mood, "is_active": True}],
            }
        )

    def test_affection_makes_persuasion_easier_and_threats_harder(self) -> None:
        loving, _ = resolve_check_dc(
            self._state("in_love"), {"kind": "skill", "skill": "persuasion", "dc": 15, "target": "Алисия"}
        )
        neutral, _ = resolve_check_dc(
            self._state("neutral"), {"kind": "skill", "skill": "persuasion", "dc": 15, "target": "Алисия"}
        )
        threat_loving, _ = resolve_check_dc(
            self._state("in_love"), {"kind": "skill", "skill": "intimidation", "dc": 15, "target": "Алисия"}
        )
        self.assertLess(loving, neutral)
        self.assertGreater(threat_loving, neutral)

    def test_hostility_makes_persuasion_harder(self) -> None:
        hostile, _ = resolve_check_dc(
            self._state("hostile"), {"kind": "skill", "skill": "persuasion", "dc": 15, "target": "Алисия"}
        )
        self.assertGreater(hostile, 15)

    def test_a_quarrel_does_not_erase_a_romance(self) -> None:
        """The two clocks are the point: in love, and currently furious, is a real state."""
        angry_love, note = resolve_check_dc(
            self._state("in_love", "angry"),
            {"kind": "skill", "skill": "persuasion", "dc": 15, "target": "Алисия"},
        )
        calm_love, _ = resolve_check_dc(
            self._state("in_love"), {"kind": "skill", "skill": "persuasion", "dc": 15, "target": "Алисия"}
        )
        self.assertGreater(angry_love, calm_love)
        self.assertIn("влюблена", note.lower())
        self.assertIn("злость", note.lower())

    def test_feelings_do_not_touch_unrelated_checks(self) -> None:
        shift, _note = relation_check_shift(
            {"relation": "in_love", "mood": DEFAULT_MOOD}, kind="skill", skill="stealth"
        )
        self.assertEqual(shift, 0)

    def test_the_narrator_is_told_how_to_play_the_feeling(self) -> None:
        line = describe_npc_relationship({"relation": "in_love", "relation_score": 90, "mood": DEFAULT_MOOD})
        self.assertIn("влюблённость", line.lower())
        self.assertIn("холодная вежливость здесь неуместна", line.lower())

    def test_a_mood_fades_when_nothing_keeps_it_alive(self) -> None:
        state = normalize_dnd_state(
            {
                "turn_count": 5,
                "scene_location": "Чайный дом",
                "npcs": [{"name": "Алисия", "is_active": True, "mood": "angry", "mood_turn": 2}],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"npcs": [{"name": "Алисия", "is_active": True}]},
            turn_index=2 + DND_MOOD_TURN_BUDGET,
            location_label="Чайный дом",
        )
        self.assertEqual(next_state["npcs"][0]["mood"], DEFAULT_MOOD)

    def test_a_fresh_mood_survives_the_scene_it_started_in(self) -> None:
        state = normalize_dnd_state(
            {
                "turn_count": 5,
                "scene_location": "Чайный дом",
                "npcs": [{"name": "Алисия", "is_active": True, "mood": "angry", "mood_turn": 5}],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"npcs": [{"name": "Алисия", "is_active": True}]},
            turn_index=6,
            location_label="Чайный дом",
        )
        self.assertEqual(next_state["npcs"][0]["mood"], "angry")


class DndSceneMemoryTests(unittest.TestCase):
    def test_blocking_reaches_the_narrator(self) -> None:
        """A bodyguard behind a chair must not turn up in the doorway next paragraph."""
        state = normalize_dnd_state(
            {"npcs": [{"name": "Томас", "is_active": True, "position": "за спиной госпожи"}]}
        )
        card = build_dnd_instruction_card(state)
        self.assertIn("РАССТАНОВКА", card["content"])
        self.assertIn("за спиной госпожи", card["content"])

    def test_positions_are_recorded_from_the_turn(self) -> None:
        state = normalize_dnd_state({"turn_count": 4, "scene_location": "Чайный дом"})
        next_state, _changes = apply_dnd_turn_upkeep(
            state,
            {"npcs": [{"name": "Томас", "is_active": True, "position": "в дверях"}]},
            turn_index=5,
            location_label="Чайный дом",
        )
        self.assertEqual(next_state["npcs"][0]["position"], "в дверях")

    def test_leaving_the_room_forgets_the_blocking(self) -> None:
        state = normalize_dnd_state(
            {
                "turn_count": 4,
                "scene_location": "Чайный дом",
                "npcs": [{"name": "Томас", "is_active": True, "position": "в дверях"}],
            }
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {}, turn_index=5, location_label="Улица города"
        )
        self.assertEqual(next_state["npcs"][0]["position"], "")


class DndClockTests(unittest.TestCase):
    def _morning(self) -> dict:
        return normalize_dnd_state({"turn_count": 6, "environment": {"time_of_day": "morning", "day": 1}})

    def test_the_narrator_alone_cannot_skip_to_evening(self) -> None:
        next_state, _changes = apply_dnd_turn_upkeep(
            self._morning(), {"environment": {"elapsed": "hours", "time_of_day": "evening"}}, turn_index=7
        )
        self.assertNotEqual(next_state["environment"]["time_of_day"], "evening")

    def test_a_player_who_says_evening_gets_evening(self) -> None:
        """The budget guards against model drift, not against the player's own narration."""
        next_state, _changes = apply_dnd_turn_upkeep(
            self._morning(),
            {"environment": {"elapsed": "hours", "time_of_day": "evening", "player_declared": True}},
            turn_index=7,
        )
        self.assertEqual(next_state["environment"]["time_of_day"], "evening")

    def test_a_declared_week_moves_the_calendar(self) -> None:
        next_state, _changes = apply_dnd_turn_upkeep(
            self._morning(),
            {
                "environment": {
                    "elapsed": "weeks",
                    "time_of_day": "night",
                    "day_delta": 7,
                    "player_declared": True,
                }
            },
            turn_index=7,
        )
        self.assertEqual(next_state["environment"]["time_of_day"], "night")
        self.assertEqual(next_state["environment"]["day"], 8)


class DndLedgerHygieneTests(unittest.TestCase):
    def test_a_quest_closes_on_a_paraphrase(self) -> None:
        state = normalize_dnd_state(
            {"turn_count": 5, "quests": [{"title": "Добыть запечатанный серебряный тубус", "status": "active"}]}
        )
        next_state, _changes = apply_dnd_turn_upkeep(
            state, {"quests": {"completed": ["серебряный тубус"]}}, turn_index=6
        )
        self.assertEqual(next_state["quests"][0]["status"], "done")

    def test_stale_notes_can_be_retired(self) -> None:
        state = normalize_dnd_state(
            {
                "turn_count": 5,
                "notes": [
                    {"text": "Герта ждёт вечерний отчёт", "turn": 2},
                    {"text": "Алисия пригласила в чайный дом", "turn": 3},
                ],
            }
        )
        next_state, changes = apply_dnd_turn_upkeep(
            state, {"retired_notes": ["Герта ждёт вечерний отчёт"]}, turn_index=6
        )
        remaining = [note["text"] for note in next_state["notes"]]
        self.assertNotIn("Герта ждёт вечерний отчёт", remaining)
        self.assertIn("Алисия пригласила в чайный дом", remaining)
        self.assertTrue(any("retired" in change for change in changes))


if __name__ == "__main__":
    unittest.main()
