from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_canonical_pipeline import (  # noqa: E402
    CanonicalNpc,
    CanonicalObject,
    CanonicalStateV1,
    HeldItem,
    build_scene_plan,
    clear_canonical_state_payload,
    critique_narrative,
    deserialize_canonical_state_payload,
    detect_language_issues,
    finalize_canonical_state_after_output,
    guard_generated_story_output,
    load_or_init_canonical_state,
    persist_canonical_state_to_game,
    repair_visible_text_mojibake,
    resolve_state_delta,
    safe_parse_player_turn,
    serialize_canonical_state,
    validate_canonical_state,
)
from app.services.story_output_contract import (  # noqa: E402
    parse_ai_output_to_ui_blocks,
    serialize_ui_blocks_to_existing_ai_output,
    validate_ai_output_contract,
)


class StoryOutputContractTests(unittest.TestCase):
    def test_structured_npc_marker_survives_parse_and_serialize(self) -> None:
        raw = "Дверь тихо скрипнула.\n\n[[NPC:Мира]] Ты опять за свое?"

        blocks = parse_ai_output_to_ui_blocks(raw)

        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[1].type, "dialogue")
        self.assertEqual(blocks[1].speaker_name, "Мира")
        self.assertIn("[[NPC:Мира]]", serialize_ui_blocks_to_existing_ai_output(blocks))
        self.assertTrue(validate_ai_output_contract(raw).ok)

    def test_language_gate_checks_visible_text_without_breaking_marker_ids(self) -> None:
        raw = "[[NPC:char_mira]] РџСЂРёРІРµС‚, герой."

        report = detect_language_issues(raw)

        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "mojibake_visible_text" for issue in report.issues))
        repaired = repair_visible_text_mojibake(raw)
        self.assertIn("[[NPC:char_mira]]", repaired)
        self.assertIn("Привет", repaired)

    def test_cjk_visible_text_is_detected(self) -> None:
        report = detect_language_issues("[[NPC:Мира]] Привет 你好")

        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "cjk_visible_text" for issue in report.issues))


    def test_normal_russian_visible_text_is_not_mojibake(self) -> None:
        report = detect_language_issues(
            "\u0421\u0446\u0435\u043d\u0430 \u043d\u0430 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u0438\u0435 "
            "\u0437\u0430\u043c\u0438\u0440\u0430\u0435\u0442."
        )

        self.assertFalse(any(issue.code == "mojibake_visible_text" for issue in report.issues))


class StoryCanonicalPipelineTests(unittest.TestCase):
    def test_canonical_state_payload_roundtrip_preserves_scene_facts(self) -> None:
        state = CanonicalStateV1()
        state.scene.location_name = "\u041a\u0443\u0445\u043d\u044f"
        state.npcs["npc_mira"] = CanonicalNpc(
            character_id="npc_mira",
            name="\u041c\u0438\u0440\u0430",
            distance_to_player="near",
        )
        state.player.right_hand = HeldItem(object_id="cup_tea_1", name="\u0447\u0430\u0448\u043a\u0430", contents="\u0447\u0430\u0439")
        state.objects["cup_tea_1"] = CanonicalObject(
            object_id="cup_tea_1",
            name="\u0447\u0430\u0448\u043a\u0430",
            contents="\u0447\u0430\u0439",
            holder_character_id="player",
        )

        restored = deserialize_canonical_state_payload(serialize_canonical_state(state))

        self.assertIsNotNone(restored)
        self.assertEqual(restored.scene.location_name, "\u041a\u0443\u0445\u043d\u044f")
        self.assertEqual(restored.npcs["npc_mira"].distance_to_player, "near")
        self.assertEqual(restored.player.right_hand.contents, "\u0447\u0430\u0439")

    def test_load_or_init_prefers_persisted_state_and_merges_cards(self) -> None:
        state = CanonicalStateV1()
        state.npcs["npc_1"] = CanonicalNpc(
            character_id="npc_1",
            name="\u041c\u0438\u0440\u0430",
            distance_to_player="near",
        )
        game = SimpleNamespace(
            canonical_state_payload=serialize_canonical_state(state),
            current_location_label="\u0422\u0430\u0432\u0435\u0440\u043d\u0430",
            environment_current_datetime="",
            environment_current_weather="",
        )

        loaded = load_or_init_canonical_state(
            game=game,
            world_cards=[
                {
                    "id": 1,
                    "kind": "npc",
                    "title": "\u041c\u0438\u0440\u0430",
                    "inventory": "\u043a\u043b\u044e\u0447",
                }
            ],
            context_messages=[],
        )

        self.assertEqual(loaded.scene.location_name, "\u0422\u0430\u0432\u0435\u0440\u043d\u0430")
        self.assertEqual(loaded.npcs["npc_1"].distance_to_player, "near")
        self.assertIn("inventory_1_1", loaded.objects)

    def test_persist_and_clear_canonical_state_payload_on_game(self) -> None:
        game = SimpleNamespace(canonical_state_payload="")
        state = CanonicalStateV1()
        state.scene.zone_id = "room"

        self.assertTrue(persist_canonical_state_to_game(game, state))
        self.assertIn('"version":1', game.canonical_state_payload)

        self.assertTrue(clear_canonical_state_payload(game))
        self.assertEqual(game.canonical_state_payload, "")

    def test_relative_movement_updates_npc_distance(self) -> None:
        state = CanonicalStateV1()
        state.npcs["npc_mira"] = CanonicalNpc(character_id="npc_mira", name="\u041c\u0438\u0440\u0430")

        parsed = safe_parse_player_turn("\u041f\u043e\u0434\u0445\u043e\u0436\u0443 \u043a \u041c\u0438\u0440\u0435.", state)
        next_state, deltas = resolve_state_delta(state, parsed)

        self.assertEqual(next_state.npcs["npc_mira"].distance_to_player, "near")
        self.assertTrue(any(delta.path == "npcs.npc_mira.distance_to_player" for delta in deltas))

    def test_finalize_state_records_narrative_patterns(self) -> None:
        state = CanonicalStateV1()
        state.npcs["npc_mira"] = CanonicalNpc(character_id="npc_mira", name="\u041c\u0438\u0440\u0430")
        plan = build_scene_plan(
            player_text="\u041c\u0438\u0440\u0430?",
            state=state,
            parsed_turn=safe_parse_player_turn("\u041c\u0438\u0440\u0430?", state),
            deltas=[],
            validation=validate_canonical_state(state),
        )

        final_state = finalize_canonical_state_after_output(
            state=state,
            output="[[NPC:\u041c\u0438\u0440\u0430]] \u041c\u0438\u0440\u0430 \u043a\u0438\u0432\u043d\u0443\u043b\u0430.",
            scene_plan=plan,
        )

        self.assertTrue(final_state.narrative_patterns.recent_openings)
        self.assertEqual(final_state.conversation.last_speaker_id, "npc_mira")

    def test_repeated_opening_is_flagged_by_critic(self) -> None:
        state = CanonicalStateV1()
        state.narrative_patterns.recent_openings.append("\u0414\u0432\u0435\u0440\u044c \u0442\u0438\u0445\u043e \u0441\u043a\u0440\u0438\u043f\u043d\u0443\u043b\u0430.")
        output = "\u0414\u0432\u0435\u0440\u044c \u0442\u0438\u0445\u043e \u0441\u043a\u0440\u0438\u043f\u043d\u0443\u043b\u0430. \u041c\u0438\u0440\u0430 \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0430."
        plan = build_scene_plan(
            player_text="\u0416\u0434\u0443.",
            state=state,
            parsed_turn=safe_parse_player_turn("\u0416\u0434\u0443.", state),
            deltas=[],
            validation=validate_canonical_state(state),
        )

        report = critique_narrative(
            output=output,
            state=state,
            scene_plan=plan,
            contract_check=validate_ai_output_contract(output),
            language_check=detect_language_issues(output),
        )

        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "repeated_recent_opening" for issue in report.issues))

    def test_tea_does_not_become_coffee_critic(self) -> None:
        state = CanonicalStateV1()
        state.player.right_hand = HeldItem(object_id="cup_tea_1", name="чашка", contents="чай")
        state.objects["cup_tea_1"] = CanonicalObject(
            object_id="cup_tea_1",
            name="чашка",
            contents="чай",
            holder_character_id="player",
        )
        plan = build_scene_plan(
            player_text="Пью из чашки.",
            state=state,
            parsed_turn=safe_parse_player_turn("Пью из чашки.", state),
            deltas=[],
            validation=validate_canonical_state(state),
        )

        contract = validate_ai_output_contract("Ты подносишь кофе к губам.")
        language = detect_language_issues("Ты подносишь кофе к губам.")
        report = critique_narrative(
            output="Ты подносишь кофе к губам.",
            state=state,
            scene_plan=plan,
            contract_check=contract,
            language_check=language,
        )

        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "tea_became_coffee" for issue in report.issues))

    def test_adjacent_npc_reapproach_is_detected(self) -> None:
        state = CanonicalStateV1()
        state.npcs["npc_mira"] = CanonicalNpc(
            character_id="npc_mira",
            name="Мира",
            distance_to_player="adjacent",
        )
        state.conversation.active_addressee_id = "npc_mira"
        parsed = safe_parse_player_turn("Мира, что происходит?", state)
        next_state, deltas = resolve_state_delta(state, parsed)
        plan = build_scene_plan(
            player_text="Мира, что происходит?",
            state=next_state,
            parsed_turn=parsed,
            deltas=deltas,
            validation=validate_canonical_state(next_state),
        )

        output = "[[NPC:Мира]] Мира подошла к тебе ближе и нахмурилась."
        report = critique_narrative(
            output=output,
            state=next_state,
            scene_plan=plan,
            contract_check=validate_ai_output_contract(output),
            language_check=detect_language_issues(output),
        )

        self.assertFalse(report.ok)
        self.assertTrue(any(issue.code == "npc_reapproached_when_already_near" for issue in report.issues))

    def test_dialogue_addressee_sets_scene_plan_responder(self) -> None:
        state = CanonicalStateV1()
        state.npcs["npc_mira"] = CanonicalNpc(character_id="npc_mira", name="Мира")

        parsed = safe_parse_player_turn("Я спрашиваю Мира: «Ты видела ключ?»", state)
        next_state, deltas = resolve_state_delta(state, parsed)
        plan = build_scene_plan(
            player_text="Я спрашиваю Мира: «Ты видела ключ?»",
            state=next_state,
            parsed_turn=parsed,
            deltas=deltas,
            validation=validate_canonical_state(next_state),
        )

        self.assertEqual(next_state.conversation.active_addressee_id, "npc_mira")
        self.assertEqual(plan.main_responder_id, "npc_mira")

    def test_guard_never_raises_and_preserves_contract_when_pipeline_finds_issue(self) -> None:
        state_card = {"id": 1, "kind": "npc", "title": "Мира", "content": "Собеседница.", "triggers": []}

        result = guard_generated_story_output(
            output="[[NPC:Мира]] РџСЂРёРІРµС‚.",
            player_text="Мира, привет.",
            world_cards=[state_card],
            context_messages=[],
        )

        self.assertTrue(result.contract.ok)
        self.assertIn("[[NPC:Мира]]", result.output)
        self.assertIn("Привет", result.output)


    def test_safe_fallback_replaces_unpatchable_language_issue_when_enabled(self) -> None:
        result = guard_generated_story_output(
            output="[[NPC:\u041c\u0438\u0440\u0430]] \u4f60\u597d",
            player_text="\u041c\u0438\u0440\u0430?",
            world_cards=[{"id": 1, "kind": "npc", "title": "\u041c\u0438\u0440\u0430"}],
            context_messages=[],
            use_safe_fallback=True,
        )

        self.assertTrue(result.fallback_used)
        self.assertTrue(result.contract.ok)
        self.assertTrue(result.language.ok)


if __name__ == "__main__":
    unittest.main()
