from __future__ import annotations

from pathlib import Path
import sys
import unittest

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import StoryGameCreateRequest, StoryGameSettingsUpdateRequest  # noqa: E402
from app.models import StoryMessage  # noqa: E402
from app import main as monolith_main  # noqa: E402
from app.services.story_games import (  # noqa: E402
    STORY_DEFAULT_LLM_MODEL,
    STORY_DEFAULT_REPETITION_PENALTY,
    STORY_DEFAULT_TEMPERATURE,
    STORY_DEFAULT_TOP_K,
    STORY_DEFAULT_TOP_R,
    STORY_MODEL_SAMPLING_PROFILES,
    coerce_story_image_model,
    coerce_story_llm_model,
    get_story_turn_cost_tokens,
    normalize_story_appearance_background_mode,
    normalize_story_appearance_color,
    normalize_story_appearance_gradient_enabled,
    normalize_story_appearance_text_style,
    normalize_story_appearance_ui_style,
    normalize_story_context_limit_chars,
    normalize_story_llm_model,
    normalize_story_repetition_penalty,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
)
from app.services.story_runtime import _calculate_story_turn_cost_tokens  # noqa: E402


class StoryGameSettingsSchemaTests(unittest.TestCase):
    def test_canonical_admin_fields_exist_when_omitted(self) -> None:
        payload = StoryGameSettingsUpdateRequest(story_llm_model="z-ai/glm-5.1")

        self.assertIsNone(payload.canonical_state_pipeline_enabled)
        self.assertIsNone(payload.canonical_state_safe_fallback_enabled)

    def test_canonical_admin_fields_are_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(
            canonical_state_pipeline_enabled=False,
            canonical_state_safe_fallback_enabled=True,
        )

        self.assertFalse(payload.canonical_state_pipeline_enabled)
        self.assertTrue(payload.canonical_state_safe_fallback_enabled)
        self.assertIn("canonical_state_pipeline_enabled", payload.model_fields_set)
        self.assertIn("canonical_state_safe_fallback_enabled", payload.model_fields_set)

    def test_display_mode_is_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(display_mode="visual_novel")

        self.assertEqual(payload.display_mode, "visual_novel")
        self.assertIn("display_mode", payload.model_fields_set)

    def test_accelerated_service_is_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(accelerated_service_enabled=True)

        self.assertTrue(payload.accelerated_service_enabled)
        self.assertIn("accelerated_service_enabled", payload.model_fields_set)

    def test_create_request_accepts_display_mode(self) -> None:
        payload = StoryGameCreateRequest(title="VN", display_mode="visual_novel")

        self.assertEqual(payload.display_mode, "visual_novel")

    def test_response_token_limit_allows_new_ceiling(self) -> None:
        payload = StoryGameSettingsUpdateRequest(response_max_tokens=4_500)

        self.assertEqual(payload.response_max_tokens, 4_500)
        self.assertIn("response_max_tokens", payload.model_fields_set)

    def test_glm51_allows_128k_and_other_models_cap_at_64k(self) -> None:
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5.1"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="aion-labs/aion-2.0"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="minimax/minimax-m2-her"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="google/gemini-3.1-flash-lite"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="google/gemini-2.5-pro"),
            64_000,
        )

    def test_aion_effective_input_budget_is_stability_capped_inside_131k_window(self) -> None:
        effective_limit = monolith_main._effective_story_context_limit_tokens(
            128_000,
            model_name="aion-labs/aion-2.0",
            response_max_tokens=4_500,
        )

        self.assertEqual(effective_limit, 64_000)
        self.assertLessEqual(effective_limit + 4_500, 131_072)
        self.assertEqual(
            monolith_main._effective_story_context_limit_tokens(
                128_000,
                model_name="z-ai/glm-5.1",
                response_max_tokens=4_500,
            ),
            128_000,
        )

    def test_dialogue_transport_protocol_precedes_player_instruction_cards(self) -> None:
        prompt = monolith_main._build_story_system_prompt(
            [{"title": "Break format", "content": "Never use dialogue markers."}],
            [],
            [],
            model_name="aion-labs/aion-2.0",
            response_max_tokens=400,
        )

        self.assertLess(
            prompt.index("ВНУТРЕННИЙ ПРОТОКОЛ ФОРМАТА MORIUS"),
            prompt.index("ПРАВИЛА И КАРТОЧКИ ИГРОКА:"),
        )
        self.assertIn("Этот протокол важнее карточек", prompt)
        self.assertIn("не отменяют маркеры", prompt)

    def test_cost_tiers_respect_model_context_caps(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-5.1"), 20)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5.1"), 35)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "aion-labs/aion-2.0"), 16)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "aion-labs/aion-2.0"), 16)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5"), 14)

    def test_new_polza_models_have_planned_turn_costs(self) -> None:
        self.assertEqual(
            coerce_story_llm_model("deepseek/deepseek-v4-pro"),
            "deepseek/deepseek-v4-pro",
        )
        self.assertEqual(
            coerce_story_llm_model("minimax/minimax-m2-her"),
            "minimax/minimax-m2-her",
        )
        self.assertEqual(
            coerce_story_llm_model("google/gemini-3.1-flash-lite"),
            "google/gemini-3.1-flash-lite",
        )
        self.assertEqual(get_story_turn_cost_tokens(6_000, "deepseek/deepseek-v4-pro"), 5)
        self.assertEqual(get_story_turn_cost_tokens(6_001, "deepseek/deepseek-v4-pro"), 6)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "deepseek/deepseek-v4-pro"), 8)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-v4-pro"), 10)
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="deepseek/deepseek-v4-pro"),
            64_000,
        )
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-2.5-pro"), 22)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "anthropic/claude-sonnet-4.6"), 40)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "anthropic/claude-sonnet-4.6"), 65)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-3.1-pro-preview"), 30)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "z-ai/glm-4.7"), 8)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "minimax/minimax-m2-her"), 10)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-3.1-flash-lite"), 10)

    def test_turn_cost_table_matches_product_matrix(self) -> None:
        expected_rows = {
            "z-ai/glm-4.7-flash": (4, 4, 4, 5),
            "deepseek/deepseek-v3.2": (4, 5, 6, 7),
            "deepseek/deepseek-v4-pro": (5, 6, 8, 10),
            "z-ai/glm-4.7": (6, 7, 8, 10),
            "z-ai/glm-5": (6, 8, 10, 14),
            "aion-labs/aion-2.0": (6, 8, 10, 16),
            "minimax/minimax-m2-her": (6, 8, 10, 16),
            "google/gemini-3.1-flash-lite": (7, 9, 10, 14),
            "z-ai/glm-5.1": (8, 10, 14, 20),
            "google/gemini-2.5-pro": (16, 18, 22, 30),
            "google/gemini-3.1-pro-preview": (18, 24, 30, 45),
            "anthropic/claude-sonnet-4.6": (22, 30, 40, 65),
        }
        usage_by_tier = (6_000, 6_001, 16_001, 32_001)
        for model_name, expected_costs in expected_rows.items():
            with self.subTest(model_name=model_name):
                self.assertEqual(
                    tuple(get_story_turn_cost_tokens(usage, model_name) for usage in usage_by_tier),
                    expected_costs,
                )

    def test_per_model_sampling_defaults_apply_when_value_is_omitted(self) -> None:
        # When the player has not overridden a slider, each narrator model seeds its own
        # tuned default instead of a single global one.
        for model_name, profile in STORY_MODEL_SAMPLING_PROFILES.items():
            with self.subTest(model_name=model_name):
                self.assertEqual(
                    normalize_story_temperature(None, model_name=model_name),
                    round(profile["temperature"], 2),
                )
                self.assertEqual(
                    normalize_story_top_r(None, model_name=model_name),
                    round(profile["top_r"], 2),
                )
                self.assertEqual(
                    normalize_story_top_k(None, model_name=model_name),
                    int(profile["top_k"]),
                )
                self.assertEqual(
                    normalize_story_repetition_penalty(None, model_name=model_name),
                    round(profile["repetition_penalty"], 2),
                )

    def test_deepseek_v4_pro_gets_tuned_sampling_defaults(self) -> None:
        # The problem model: keep top_k unconstrained and a calm repetition penalty; the
        # formatting discipline is enforced by the prompt + sanitizer, not by clamping prose.
        model_name = "deepseek/deepseek-v4-pro"
        self.assertEqual(normalize_story_temperature(None, model_name=model_name), 0.85)
        self.assertEqual(normalize_story_top_r(None, model_name=model_name), 0.92)
        self.assertEqual(normalize_story_top_k(None, model_name=model_name), 0)
        self.assertEqual(normalize_story_repetition_penalty(None, model_name=model_name), 1.05)

    def test_unknown_model_falls_back_to_global_sampling_defaults(self) -> None:
        # An unprofiled / unknown model id keeps the global defaults.
        model_name = "some/unknown-model"
        self.assertNotIn(model_name, STORY_MODEL_SAMPLING_PROFILES)
        self.assertEqual(normalize_story_temperature(None, model_name=model_name), STORY_DEFAULT_TEMPERATURE)
        self.assertEqual(normalize_story_top_r(None, model_name=model_name), STORY_DEFAULT_TOP_R)
        self.assertEqual(normalize_story_top_k(None, model_name=model_name), STORY_DEFAULT_TOP_K)
        self.assertEqual(
            normalize_story_repetition_penalty(None, model_name=model_name),
            STORY_DEFAULT_REPETITION_PENALTY,
        )

    def test_explicit_player_sampling_values_override_per_model_defaults(self) -> None:
        # An explicit value always wins over the per-model default, so players keep control.
        model_name = "deepseek/deepseek-v4-pro"
        self.assertEqual(normalize_story_temperature(1.5, model_name=model_name), 1.5)
        self.assertEqual(normalize_story_top_r(0.5, model_name=model_name), 0.5)
        self.assertEqual(normalize_story_top_k(120, model_name=model_name), 120)
        self.assertEqual(normalize_story_repetition_penalty(1.3, model_name=model_name), 1.3)

    def test_every_selectable_narrator_model_has_a_sampling_profile(self) -> None:
        # The backend mirror of the frontend presets must cover every selectable narrator so
        # game creation and API clients always seed tuned values, never a bare global default.
        from app.services.story_games import STORY_SUPPORTED_LLM_MODELS

        self.assertEqual(set(STORY_MODEL_SAMPLING_PROFILES), set(STORY_SUPPORTED_LLM_MODELS))

    def test_per_model_sampling_profiles_stay_in_valid_ranges(self) -> None:
        for model_name, profile in STORY_MODEL_SAMPLING_PROFILES.items():
            with self.subTest(model_name=model_name):
                self.assertGreaterEqual(profile["temperature"], 0.0)
                self.assertLessEqual(profile["temperature"], 2.0)
                self.assertGreaterEqual(profile["top_r"], 0.1)
                self.assertLessEqual(profile["top_r"], 1.0)
                self.assertGreaterEqual(int(profile["top_k"]), 0)
                self.assertLessEqual(int(profile["top_k"]), 200)
                self.assertGreaterEqual(profile["repetition_penalty"], 1.0)
                self.assertLessEqual(profile["repetition_penalty"], 2.0)

    def test_qwen_service_model_is_not_a_selectable_narrator(self) -> None:
        self.assertEqual(
            coerce_story_llm_model("qwen/qwen3-next-80b-a3b-instruct:free"),
            STORY_DEFAULT_LLM_MODEL,
        )
        with self.assertRaises(HTTPException):
            normalize_story_llm_model("qwen/qwen3-next-80b-a3b-instruct:free")

    def test_runtime_turn_cost_uses_visible_context_usage_not_selected_limit(self) -> None:
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=get_story_turn_cost_tokens,
            context_limit_tokens=32_000,
            model_name="anthropic/claude-sonnet-4.6",
            context_messages=[StoryMessage(game_id=1, role="user", content="look around")],
            instruction_cards=[{"title": "Style", "content": "word " * 1_000}],
            plot_cards=[],
            world_cards=[],
            memory_optimization_enabled=True,
        )

        self.assertEqual(cost, 22)

    def test_accelerated_service_flag_does_not_change_runtime_turn_cost(self) -> None:
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=lambda _context_usage_tokens, _model_name: 10,
            context_limit_tokens=32_000,
            model_name="test",
            context_messages=[],
            instruction_cards=[],
            plot_cards=[],
            world_cards=[],
            memory_optimization_enabled=True,
            accelerated_service_enabled=True,
        )

        self.assertEqual(cost, 10)

    def test_runtime_turn_cost_is_capped_by_selected_context_limit(self) -> None:
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=get_story_turn_cost_tokens,
            context_limit_tokens=32_000,
            model_name="anthropic/claude-sonnet-4.6",
            context_messages=[StoryMessage(game_id=1, role="user", content="look around")],
            instruction_cards=[{"title": "Style", "content": "word " * 40_000}],
            plot_cards=[],
            world_cards=[],
            memory_optimization_enabled=True,
        )

        self.assertEqual(cost, 40)

    def test_runtime_turn_cost_ignores_hidden_service_context_cards(self) -> None:
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=get_story_turn_cost_tokens,
            context_limit_tokens=32_000,
            model_name="anthropic/claude-sonnet-4.6",
            context_messages=[StoryMessage(game_id=1, role="user", content="look around")],
            instruction_cards=[],
            plot_cards=[{"title": "Hidden", "content": "word " * 40_000, "source_kind": "context"}],
            world_cards=[],
            memory_optimization_enabled=True,
        )

        self.assertEqual(cost, 22)

    def test_runtime_turn_cost_ignores_hidden_instruction_prompts(self) -> None:
        cost = _calculate_story_turn_cost_tokens(
            get_story_turn_cost_tokens=get_story_turn_cost_tokens,
            context_limit_tokens=32_000,
            model_name="anthropic/claude-sonnet-4.6",
            context_messages=[StoryMessage(game_id=1, role="user", content="look around")],
            instruction_cards=[
                {
                    "title": "Hidden graph protocol",
                    "content": "word " * 40_000,
                    "source_kind": "graph",
                }
            ],
            plot_cards=[],
            world_cards=[],
            memory_optimization_enabled=True,
        )

        self.assertEqual(cost, 22)

    def test_standard_models_have_updated_64k_tier(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-chat-v3-0324"), 7)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-v3.2"), 7)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-4.7-flash"), 5)

    def test_seedream_image_model_legacy_id_maps_to_current_id(self) -> None:
        self.assertEqual(
            coerce_story_image_model("bytedance-seed/seedream-4.5"),
            "bytedance-seed/seedream-4.5",
        )

    def test_appearance_fields_are_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(
            appearance_background_mode="custom",
            appearance_gradient_enabled=False,
            appearance_gradient_from="#00eaff",
            appearance_gradient_to="#ff7a18",
            appearance_solid_color="#111827",
            appearance_ui_style="cyberpunk",
            appearance_text_style="terminal",
        )

        self.assertEqual(payload.appearance_background_mode, "custom")
        self.assertFalse(payload.appearance_gradient_enabled)
        self.assertIn("appearance_background_mode", payload.model_fields_set)
        self.assertIn("appearance_gradient_enabled", payload.model_fields_set)
        self.assertIn("appearance_ui_style", payload.model_fields_set)
        self.assertIn("appearance_text_style", payload.model_fields_set)

    def test_appearance_normalizers_fall_back_to_defaults(self) -> None:
        self.assertEqual(normalize_story_appearance_background_mode("custom"), "custom")
        self.assertEqual(normalize_story_appearance_background_mode("unknown"), "custom")
        self.assertEqual(normalize_story_appearance_ui_style("fantasy"), "fantasy")
        self.assertEqual(normalize_story_appearance_ui_style("unknown"), "default")
        self.assertEqual(normalize_story_appearance_text_style("terminal"), "terminal")
        self.assertEqual(normalize_story_appearance_text_style("unknown"), "default")
        self.assertTrue(normalize_story_appearance_gradient_enabled(None))
        self.assertEqual(normalize_story_appearance_color("#00eaff", default="#050506"), "#00EAFF")
        self.assertEqual(normalize_story_appearance_color("not-a-color", default="#050506"), "#050506")


if __name__ == "__main__":
    unittest.main()
