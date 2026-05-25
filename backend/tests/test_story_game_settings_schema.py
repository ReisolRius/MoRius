from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import StoryGameSettingsUpdateRequest  # noqa: E402
from app.services.story_games import (  # noqa: E402
    get_story_turn_cost_tokens,
    coerce_story_image_model,
    normalize_story_appearance_background_mode,
    normalize_story_appearance_color,
    normalize_story_appearance_gradient_enabled,
    normalize_story_appearance_text_style,
    normalize_story_appearance_ui_style,
    normalize_story_context_limit_chars,
)


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

    def test_extended_context_models_allow_128k_and_other_models_cap_at_64k(self) -> None:
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5.1"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="aion-labs/aion-2.0"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="google/gemini-2.5-pro"),
            64_000,
        )

    def test_extended_context_models_have_128k_cost_tier(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-5.1"), 18)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5.1"), 35)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "aion-labs/aion-2.0"), 16)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "aion-labs/aion-2.0"), 30)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5"), 16)

    def test_new_polza_models_have_planned_turn_costs(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "google/gemini-2.5-pro"), 16)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "qwen/qwen3.5-122b-a10b"), 16)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "anthropic/claude-sonnet-4.6"), 18)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "anthropic/claude-sonnet-4.6"), 30)

    def test_standard_models_have_six_sol_64k_tier(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-chat-v3-0324"), 6)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-v3.2"), 6)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "xiaomi/mimo-v2-flash"), 6)

    def test_seedream_image_model_legacy_id_maps_to_polza_id(self) -> None:
        self.assertEqual(
            coerce_story_image_model("bytedance-seed/seedream-4.5"),
            "bytedance/seedream-4.5",
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
