from __future__ import annotations

from pathlib import Path
import sys
import unittest

from fastapi import HTTPException
from pydantic import ValidationError


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import StoryGameCreateRequest, StoryGameSettingsUpdateRequest  # noqa: E402
from app.models import StoryMessage  # noqa: E402
from app import main as monolith_main  # noqa: E402
from app.services import story_generation_provider  # noqa: E402
from app.services.story_games import (  # noqa: E402
    STORY_DEFAULT_IMAGE_MODEL,
    STORY_DEFAULT_LLM_MODEL,
    STORY_DEFAULT_REPETITION_PENALTY,
    STORY_DEFAULT_TEMPERATURE,
    STORY_DEFAULT_TOP_K,
    STORY_DEFAULT_TOP_R,
    STORY_MODEL_SAMPLING_PROFILES,
    STORY_REASONING_SURCHARGE_BY_MODEL,
    coerce_story_image_model,
    coerce_story_llm_model,
    get_story_reasoning_reserved_tokens,
    get_story_reasoning_surcharge_tokens,
    get_story_turn_cost_tokens,
    is_story_reasoning_fixed_model,
    is_story_reasoning_minimum_model,
    is_story_reasoning_supported_model,
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
from app.services.story_runtime import (  # noqa: E402
    _calculate_story_turn_cost_tokens,
    _resolve_story_turn_charge_tokens,
)


class StoryGameSettingsSchemaTests(unittest.TestCase):
    def test_reasoning_enhancement_is_off_by_default_and_tracked_when_sent(self) -> None:
        omitted = StoryGameSettingsUpdateRequest()
        enabled = StoryGameSettingsUpdateRequest(story_reasoning_enabled=True)
        created = StoryGameCreateRequest(story_reasoning_enabled=True)

        self.assertIsNone(omitted.story_reasoning_enabled)
        self.assertTrue(enabled.story_reasoning_enabled)
        self.assertIn("story_reasoning_enabled", enabled.model_fields_set)
        self.assertTrue(created.story_reasoning_enabled)

    def test_reasoning_surcharges_match_supported_model_catalog(self) -> None:
        self.assertEqual(get_story_reasoning_surcharge_tokens("google/gemini-2.5-pro", reasoning_enabled=True), 4)
        self.assertEqual(
            get_story_reasoning_surcharge_tokens("google/gemini-3.1-pro-preview", reasoning_enabled=True),
            6,
        )
        self.assertEqual(get_story_reasoning_surcharge_tokens("anthropic/claude-sonnet-4.6", reasoning_enabled=True), 5)
        self.assertEqual(get_story_reasoning_surcharge_tokens("google/gemini-2.5-pro", reasoning_enabled=False), 0)
        # Retired ids resolve through the alias table, so Mistral Nemo now answers for its
        # replacement (DeepSeek V3.2) rather than for a model that no longer exists.
        self.assertTrue(is_story_reasoning_supported_model("mistralai/mistral-nemo"))
        self.assertEqual(
            get_story_reasoning_surcharge_tokens("mistralai/mistral-nemo", reasoning_enabled=True),
            get_story_reasoning_surcharge_tokens("deepseek/deepseek-v3.2", reasoning_enabled=True),
        )
        # An id with no alias falls back to the default narrator and must never be billed as a
        # paid toggle it does not have.
        self.assertEqual(get_story_reasoning_surcharge_tokens("who/knows", reasoning_enabled=False), 0)
        self.assertFalse(is_story_reasoning_supported_model("aion-labs/aion-2.0"))
        self.assertTrue(is_story_reasoning_minimum_model("aion-labs/aion-2.0"))
        self.assertTrue(is_story_reasoning_fixed_model("aion-labs/aion-2.0"))
        self.assertEqual(get_story_reasoning_surcharge_tokens("aion-labs/aion-2.0", reasoning_enabled=True), 0)
        self.assertTrue(all(value > 0 for value in STORY_REASONING_SURCHARGE_BY_MODEL.values()))

    def test_unavoidable_reasoning_reserves_base_tokens(self) -> None:
        self.assertEqual(
            get_story_reasoning_reserved_tokens("google/gemini-2.5-pro", reasoning_enabled=False),
            128,
        )
        self.assertEqual(
            get_story_reasoning_reserved_tokens("google/gemini-3.1-pro-preview", reasoning_enabled=False),
            1_024,
        )
        self.assertEqual(
            get_story_reasoning_reserved_tokens("google/gemini-3.1-pro-preview", reasoning_enabled=True),
            2_048,
        )
        self.assertEqual(
            get_story_reasoning_reserved_tokens("deepseek/deepseek-r1-0528", reasoning_enabled=False),
            2_048,
        )

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

    def test_accelerated_service_is_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(accelerated_service_enabled=True)

        self.assertTrue(payload.accelerated_service_enabled)
        self.assertIn("accelerated_service_enabled", payload.model_fields_set)

    def test_create_request_accepts_game_mode(self) -> None:
        payload = StoryGameCreateRequest(title="VN", game_mode="visual_novel")

        self.assertEqual(payload.game_mode, "visual_novel")

    def test_response_token_limit_accepts_the_published_range(self) -> None:
        from app.services.story_games import (
            STORY_DEFAULT_RESPONSE_MAX_TOKENS,
            STORY_RESPONSE_MAX_TOKENS_MAX,
            STORY_RESPONSE_MAX_TOKENS_MIN,
        )

        for value in (STORY_RESPONSE_MAX_TOKENS_MIN, STORY_DEFAULT_RESPONSE_MAX_TOKENS, STORY_RESPONSE_MAX_TOKENS_MAX):
            with self.subTest(value=value):
                payload = StoryGameSettingsUpdateRequest(response_max_tokens=value)
                self.assertEqual(payload.response_max_tokens, value)
                self.assertIn("response_max_tokens", payload.model_fields_set)

        # Outside the range the schema refuses rather than silently clamping, so a stale client
        # cannot push a game back onto the old unbounded ceiling.
        for value in (STORY_RESPONSE_MAX_TOKENS_MIN - 1, STORY_RESPONSE_MAX_TOKENS_MAX + 1):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    StoryGameSettingsUpdateRequest(response_max_tokens=value)

    def test_response_length_is_a_target_with_a_completion_margin(self) -> None:
        """The number the model is told and the number max_tokens cuts on must never be equal."""
        from app.services.story_games import (
            STORY_RESPONSE_MAX_TOKENS_MAX,
            STORY_RESPONSE_MAX_TOKENS_MIN,
        )

        for target in (300, 400, 800, 1200, 2000, 2300, 2500):
            with self.subTest(target=target):
                told = monolith_main._story_response_target_tokens(target)
                request_max = monolith_main._story_response_request_max_tokens(target)
                self.assertGreater(request_max, told)
                self.assertLessEqual(request_max, STORY_RESPONSE_MAX_TOKENS_MAX)
                self.assertGreaterEqual(told, STORY_RESPONSE_MAX_TOKENS_MIN)
                # The player's setting is honoured except at the very top, where the margin
                # has to come out of the target to stay under the ceiling.
                self.assertLessEqual(told, target)
                if target <= STORY_RESPONSE_MAX_TOKENS_MAX - monolith_main.STORY_RESPONSE_COMPLETION_MARGIN_MIN_TOKENS:
                    self.assertEqual(told, target)
                prompt = monolith_main._build_story_system_prompt(
                    [],
                    [],
                    [],
                    model_name="deepseek/deepseek-v3.2",
                    response_max_tokens=target,
                )
                self.assertIn(str(told), prompt)
                self.assertNotIn(str(request_max), prompt)

    def test_response_length_control_is_on_by_default(self) -> None:
        from app.services.story_games import (
            STORY_DEFAULT_RESPONSE_MAX_TOKENS,
            normalize_story_response_max_tokens,
            normalize_story_response_max_tokens_enabled,
        )

        self.assertTrue(normalize_story_response_max_tokens_enabled(None))
        self.assertFalse(normalize_story_response_max_tokens_enabled(False))
        self.assertEqual(normalize_story_response_max_tokens(None), STORY_DEFAULT_RESPONSE_MAX_TOKENS)
        self.assertEqual(STORY_DEFAULT_RESPONSE_MAX_TOKENS, 800)

    def test_extended_context_models_use_model_specific_caps(self) -> None:
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5.1"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="moonshotai/kimi-k2.6"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="moonshotai/kimi-k3"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="aion-labs/aion-2.0"),
            108_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="qwen/qwen3.7-plus"),
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
            response_max_tokens=3_000,
        )

        self.assertEqual(effective_limit, 108_000)
        self.assertLessEqual(effective_limit + 3_000, 131_072)
        self.assertEqual(
            monolith_main._effective_story_context_limit_tokens(
                128_000,
                model_name="z-ai/glm-5.1",
                response_max_tokens=3_000,
            ),
            128_000,
        )
        for model_name in ("moonshotai/kimi-k2.6", "moonshotai/kimi-k3"):
            self.assertEqual(
                monolith_main._effective_story_context_limit_tokens(
                    128_000,
                    model_name=model_name,
                    response_max_tokens=3_000,
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
            prompt.index("ВНУТРЕННИЙ ПРОТОКОЛ ФОРМАТА MORU"),
            prompt.index("ПРАВИЛА И КАРТОЧКИ ИГРОКА:"),
        )
        self.assertIn("Этот протокол важнее карточек", prompt)
        self.assertIn("не отменяют маркеры", prompt)

    def test_cost_tiers_respect_model_context_caps(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-5.1"), 12)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5.1"), 22)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-5.2"), 8)
        # GLM 5.2 stops at 64k, so past the tier-4 ceiling it is still charged tier 4.
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5.2"), 8)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "aion-labs/aion-2.0"), 11)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "aion-labs/aion-2.0"), 16)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "z-ai/glm-5"), 8)

    def test_new_polza_models_have_planned_turn_costs(self) -> None:
        self.assertEqual(
            coerce_story_llm_model("deepseek/deepseek-v4-pro-0813"),
            "deepseek/deepseek-v4-pro-0813",
        )
        self.assertEqual(
            coerce_story_llm_model("deepseek/deepseek-v4-pro"),
            "deepseek/deepseek-v4-pro-0813",
        )
        self.assertEqual(
            coerce_story_llm_model("deepseek/deepseek-r1-0528"),
            "deepseek/deepseek-r1-0528",
        )
        self.assertEqual(
            coerce_story_llm_model("z-ai/glm-5.2"),
            "z-ai/glm-5.2",
        )
        # Retired by the sol economy v2 cleanup: saved games must land on a live model.
        self.assertEqual(
            coerce_story_llm_model("openai/gpt-5.6-luna-pro"),
            "deepseek/deepseek-v3.2",
        )
        self.assertEqual(
            coerce_story_llm_model("mistralai/mistral-nemo"),
            "deepseek/deepseek-v3.2",
        )
        self.assertEqual(
            coerce_story_llm_model("z-ai/glm-4.7-flash"),
            "z-ai/glm-4.7",
        )
        # Retired narrator ids survive in old saves and must land on their replacement
        # rather than silently snapping back to the global default.
        self.assertEqual(
            coerce_story_llm_model("deepseek/deepseek-chat-v3-0324"),
            "deepseek/deepseek-v3.2",
        )
        self.assertEqual(
            coerce_story_llm_model("deepcogito/cogito-v2.1-671b"),
            "deepseek/deepseek-v4-pro-0813",
        )
        self.assertEqual(
            coerce_story_llm_model("minimax/minimax-m2-her"),
            "qwen/qwen3.7-plus",
        )
        self.assertEqual(
            coerce_story_llm_model("google/gemini-3.1-flash-lite"),
            "google/gemini-3.1-flash-lite",
        )
        self.assertEqual(
            coerce_story_llm_model("moonshotai/kimi-k2.5"),
            "moonshotai/kimi-k2.5",
        )
        self.assertEqual(
            coerce_story_llm_model("moonshotai/kimi-k2.6"),
            "moonshotai/kimi-k2.6",
        )
        self.assertEqual(
            coerce_story_llm_model("moonshotai/kimi-k3"),
            "moonshotai/kimi-k3",
        )
        self.assertEqual(get_story_turn_cost_tokens(6_000, "deepseek/deepseek-v4-pro-0813"), 3)
        self.assertEqual(get_story_turn_cost_tokens(6_001, "deepseek/deepseek-v4-pro-0813"), 4)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "deepseek/deepseek-v4-pro-0813"), 6)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-v4-pro-0813"), 10)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "deepseek/deepseek-v4-pro-0813"), 19)
        self.assertEqual(get_story_turn_cost_tokens(6_000, "deepseek/deepseek-r1-0528"), 3)
        self.assertEqual(get_story_turn_cost_tokens(6_001, "deepseek/deepseek-r1-0528"), 4)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "deepseek/deepseek-r1-0528"), 5)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-r1-0528"), 8)
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="deepseek/deepseek-v4-pro-0813"),
            128_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="deepseek/deepseek-r1-0528"),
            64_000,
        )
        self.assertEqual(
            normalize_story_context_limit_chars(128_000, model_name="z-ai/glm-5.2"),
            64_000,
        )
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-2.5-pro"), 13)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "anthropic/claude-sonnet-4.6"), 23)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "anthropic/claude-sonnet-4.6"), 39)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-3.1-pro-preview"), 19)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "z-ai/glm-4.7"), 4)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "google/gemini-3.1-flash-lite"), 4)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "moonshotai/kimi-k2.6"), 4)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "moonshotai/kimi-k2.6"), 10)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "moonshotai/kimi-k2.5"), 4)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "moonshotai/kimi-k2.5"), 11)
        self.assertEqual(get_story_turn_cost_tokens(16_001, "moonshotai/kimi-k3"), 17)
        self.assertEqual(get_story_turn_cost_tokens(64_001, "moonshotai/kimi-k3"), 50)

    def test_turn_cost_table_matches_product_matrix(self) -> None:
        from app.services.story_games import (
            STORY_SUBSCRIPTION_LLM_MODELS,
            STORY_SUPPORTED_LLM_MODELS,
        )

        # The last column is the cost actually charged past 64k, not the raw 5th tier
        # constant: usage is clamped to the model's own context ceiling first, so for the
        # models capped at 64k it necessarily equals their 64k price. DeepSeek V4 Pro,
        # GLM 5.1 and both Kimi models (128k), plus Aion 2.0 (108k), reach tier five.
        expected_rows = {
            "deepseek/deepseek-v3.2": (1, 2, 3, 4, 4),
            "deepseek/deepseek-v4-pro-0813": (3, 4, 6, 10, 19),
            "deepseek/deepseek-r1-0528": (3, 4, 5, 8, 8),
            "z-ai/glm-4.7": (2, 3, 4, 6, 6),
            "z-ai/glm-5": (2, 3, 5, 8, 8),
            "z-ai/glm-5.1": (3, 5, 7, 12, 22),
            "z-ai/glm-5.2": (2, 3, 5, 8, 8),
            "aion-labs/aion-2.0": (3, 4, 7, 11, 16),
            "aion-labs/aion-3.0": (9, 14, 22, 37, 37),
            "aion-labs/aion-3.0-mini": (3, 4, 6, 9, 9),
            "qwen/qwen3.7-plus": (2, 3, 4, 5, 5),
            "google/gemini-3.1-flash-lite": (2, 3, 4, 5, 5),
            "google/gemini-2.5-pro": (7, 10, 13, 20, 20),
            "google/gemini-3.1-pro-preview": (10, 14, 19, 29, 29),
            "anthropic/claude-sonnet-4.6": (11, 16, 23, 39, 39),
            "moonshotai/kimi-k2.5": (2, 3, 4, 7, 11),
            "moonshotai/kimi-k2.6": (2, 3, 4, 6, 10),
            "moonshotai/kimi-k3": (8, 11, 17, 28, 50),
        }
        # The matrix is the whole sellable catalogue: a narrator added or retired without a
        # price lands here as a failure rather than shipping unpriced.
        self.assertEqual(
            set(expected_rows),
            set(STORY_SUPPORTED_LLM_MODELS) - set(STORY_SUBSCRIPTION_LLM_MODELS),
        )
        usage_by_tier = (6_000, 6_001, 16_001, 32_001, 64_001)
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

    def test_requested_narrator_sampling_profiles_match_approved_defaults(self) -> None:
        expected_profiles = {
            "deepseek/deepseek-v3.2": {"temperature": 0.75, "top_r": 0.90, "top_k": 40, "repetition_penalty": 1.10},
            "deepseek/deepseek-v4-pro-0813": {"temperature": 0.70, "top_r": 0.90, "top_k": 0, "repetition_penalty": 1.05},
            "deepseek/deepseek-r1-0528": {"temperature": 0.70, "top_r": 0.90, "top_k": 0, "repetition_penalty": 1.05},
            "z-ai/glm-4.7": {"temperature": 0.85, "top_r": 0.95, "top_k": 50, "repetition_penalty": 1.08},
            "z-ai/glm-5": {"temperature": 0.90, "top_r": 0.95, "top_k": 60, "repetition_penalty": 1.05},
            "aion-labs/aion-2.0": {"temperature": 0.80, "top_r": 0.92, "top_k": 50, "repetition_penalty": 1.08},
            "google/gemini-3.1-flash-lite": {"temperature": 1.00, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.00},
            "z-ai/glm-5.1": {"temperature": 0.95, "top_r": 0.97, "top_k": 80, "repetition_penalty": 1.03},
            "z-ai/glm-5.2": {"temperature": 0.90, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.05},
            "google/gemini-2.5-pro": {"temperature": 1.05, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.00},
            "google/gemini-3.1-pro-preview": {"temperature": 1.10, "top_r": 0.97, "top_k": 128, "repetition_penalty": 1.00},
            "anthropic/claude-sonnet-4.6": {"temperature": 0.90, "top_r": 1.00, "top_k": 0, "repetition_penalty": 1.00},
            "moonshotai/kimi-k2.6": {"temperature": 0.90, "top_r": 0.95, "top_k": 50, "repetition_penalty": 1.05},
            "moonshotai/kimi-k3": {"temperature": 0.85, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.03},
        }

        for model_name, expected_profile in expected_profiles.items():
            with self.subTest(model_name=model_name):
                self.assertEqual(STORY_MODEL_SAMPLING_PROFILES[model_name], expected_profile)

    def test_deepseek_v4_pro_gets_tuned_sampling_defaults(self) -> None:
        # The problem model: keep top_k unconstrained and a calm repetition penalty; the
        # formatting discipline is enforced by the prompt + sanitizer, not by clamping prose.
        model_name = "deepseek/deepseek-v4-pro-0813"
        self.assertEqual(normalize_story_temperature(None, model_name=model_name), 0.70)
        self.assertEqual(normalize_story_top_r(None, model_name=model_name), 0.90)
        self.assertEqual(normalize_story_top_k(None, model_name=model_name), 0)
        self.assertEqual(normalize_story_repetition_penalty(None, model_name=model_name), 1.05)

    def test_deepseek_r1_gets_v4_pro_sampling_defaults(self) -> None:
        model_name = "deepseek/deepseek-r1-0528"
        self.assertEqual(normalize_story_temperature(None, model_name=model_name), 0.70)
        self.assertEqual(normalize_story_top_r(None, model_name=model_name), 0.90)
        self.assertEqual(normalize_story_top_k(None, model_name=model_name), 0)
        self.assertEqual(normalize_story_repetition_penalty(None, model_name=model_name), 1.05)

    def test_provider_applies_only_supported_sampling_parameters(self) -> None:
        expected_policy = {
            "google/gemini-3.1-flash-lite": (1.00, (64, 0.95), None),
            "google/gemini-2.5-pro": (1.05, (64, 0.95), None),
            "google/gemini-3.1-pro-preview": (1.10, (128, 0.97), None),
            "anthropic/claude-sonnet-4.6": (0.90, (None, None), None),
            "moonshotai/kimi-k2.6": (0.90, (50, 0.95), 1.5),
            "moonshotai/kimi-k3": (0.85, (64, 0.95), 1.5),
        }

        for model_name, (temperature, sampling, repetition_penalty) in expected_policy.items():
            profile = STORY_MODEL_SAMPLING_PROFILES[model_name]
            with self.subTest(model_name=model_name):
                self.assertEqual(
                    monolith_main._select_story_temperature_value(
                        model_name=model_name,
                        story_temperature=profile["temperature"],
                    ),
                    temperature,
                )
                self.assertEqual(
                    monolith_main._select_story_sampling_values(
                        model_name=model_name,
                        story_top_k=int(profile["top_k"]),
                        story_top_r=profile["top_r"],
                    ),
                    sampling,
                )
                self.assertEqual(
                    story_generation_provider._select_story_repetition_penalty_value(
                        model_name=model_name,
                        story_repetition_penalty=1.5,
                    ),
                    repetition_penalty,
                )
                self.assertIsNone(
                    story_generation_provider._select_story_frequency_penalty_value(model_name=model_name)
                )
                self.assertIsNone(
                    story_generation_provider._select_story_presence_penalty_value(model_name=model_name)
                )

    def test_paid_reasoning_models_default_to_disabled_thinking(self) -> None:
        appliers = (
            monolith_main._apply_polza_story_reasoning_preferences,
            story_generation_provider._apply_polza_story_reasoning_preferences,
        )
        for applier in appliers:
            for model_name in (
                "deepseek/deepseek-v4-pro-0813",
                "moonshotai/kimi-k2.6",
                "moonshotai/kimi-k3",
            ):
                payload: dict[str, object] = {}

                applier(payload, model_name=model_name)

                self.assertEqual(payload["reasoning"], {"enabled": False, "exclude": True})

                enabled_payload: dict[str, object] = {}
                applier(enabled_payload, model_name=model_name, reasoning_enabled=True)
                self.assertEqual(
                    enabled_payload["reasoning"],
                    {"enabled": True, "max_tokens": 2_048, "exclude": True},
                )

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
        model_name = "deepseek/deepseek-v4-pro-0813"
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
            coerce_story_llm_model("qwen/qwen3-next-80b-a3b-instruct"),
            STORY_DEFAULT_LLM_MODEL,
        )
        with self.assertRaises(HTTPException):
            normalize_story_llm_model("qwen/qwen3-next-80b-a3b-instruct")

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

        self.assertEqual(cost, 11)

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

    def test_subscription_turn_charge_only_keeps_reasoning_add_on(self) -> None:
        self.assertEqual(
            _resolve_story_turn_charge_tokens(
                is_subscription_turn=True,
                base_cost_tokens=65,
                service_surcharge_tokens=7,
            ),
            0,
        )
        self.assertEqual(
            _resolve_story_turn_charge_tokens(
                is_subscription_turn=True,
                base_cost_tokens=65,
                service_surcharge_tokens=7,
                reasoning_surcharge_tokens=2,
            ),
            2,
        )
        self.assertEqual(
            _resolve_story_turn_charge_tokens(
                is_subscription_turn=False,
                base_cost_tokens=10,
                service_surcharge_tokens=7,
                reasoning_surcharge_tokens=2,
            ),
            19,
        )

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

        self.assertEqual(cost, 23)

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

        self.assertEqual(cost, 11)

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

        self.assertEqual(cost, 11)

    def test_standard_models_have_updated_64k_tier(self) -> None:
        self.assertEqual(get_story_turn_cost_tokens(32_001, "deepseek/deepseek-v3.2"), 4)
        self.assertEqual(get_story_turn_cost_tokens(32_001, "z-ai/glm-4.7"), 6)

    def test_nano_banano_is_default_and_retired_image_models_migrate_to_it(self) -> None:
        self.assertEqual(STORY_DEFAULT_IMAGE_MODEL, "google/gemini-2.5-flash-image")
        for old_flux_model in (
            "flux.2-pro",
            "black-forest-labs/flux.2-pro",
            "flux.2-klein-4b",
            "black-forest-labs/flux.2-klein-4b",
            # Seedream 4.5 was still selectable until the sol economy v2 cleanup, so live
            # games carry it and must fall back rather than fail to render.
            "seedream-4.5",
            "bytedance/seedream-4.5",
            "bytedance-seed/seedream-4.5",
        ):
            with self.subTest(old_flux_model=old_flux_model):
                self.assertEqual(
                    coerce_story_image_model(old_flux_model),
                    "google/gemini-2.5-flash-image",
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


    def test_reasoning_surcharge_covers_every_model_that_sells_the_toggle(self) -> None:
        """No model may offer paid reasoning without a price, and none may carry a dead price."""
        from app.services.story_games import (
            STORY_REASONING_SUPPORTED_LLM_MODELS,
            STORY_REASONING_SURCHARGE_BY_MODEL,
            STORY_REASONING_MINIMUM_LLM_MODELS,
        )

        sellable = {
            model
            for model in STORY_REASONING_SUPPORTED_LLM_MODELS
            if model not in STORY_REASONING_MINIMUM_LLM_MODELS
            or model in STORY_REASONING_SURCHARGE_BY_MODEL
        }
        self.assertEqual(set(STORY_REASONING_SURCHARGE_BY_MODEL), sellable)
        self.assertTrue(all(value >= 1 for value in STORY_REASONING_SURCHARGE_BY_MODEL.values()))

    def test_reasoning_surcharges_match_the_derived_prices(self) -> None:
        """Pins the derivation: extra thinking tokens / 0.6965 RUB of AI budget per sol."""
        expected = {
            "z-ai/glm-5": 1,
            "z-ai/glm-5.1": 1,
            "z-ai/glm-5.2": 1,
            "z-ai/glm-4.7": 1,
            "deepseek/deepseek-v3.2": 1,
            "deepseek/deepseek-v4-pro-0813": 1,
            "google/gemini-3.1-flash-lite": 1,
            "qwen/qwen3.7-plus": 1,
            "moonshotai/kimi-k2.5": 1,
            "moonshotai/kimi-k2.6": 1,
            "moonshotai/kimi-k3": 4,
            "google/gemini-2.5-pro": 4,
            "anthropic/claude-sonnet-4.6": 5,
            "google/gemini-3.1-pro-preview": 6,
            "deepseek/deepseek-v4-flash": 1,
            "google/gemini-2.5-flash-lite": 1,
            "z-ai/glm-4.5-air": 1,
        }
        from app.services.story_games import STORY_REASONING_SURCHARGE_BY_MODEL

        self.assertEqual(dict(STORY_REASONING_SURCHARGE_BY_MODEL), expected)
        for model_name, surcharge in expected.items():
            with self.subTest(model_name=model_name):
                self.assertEqual(
                    get_story_reasoning_surcharge_tokens(model_name, reasoning_enabled=True),
                    surcharge,
                )
                self.assertEqual(
                    get_story_reasoning_surcharge_tokens(model_name, reasoning_enabled=False),
                    0,
                )

    def test_service_prompt_is_spent_on_top_of_the_player_context_limit(self) -> None:
        """The player's limit buys the player's content; the narrator contract is extra.

        Before this the mandatory rules (~3 000 tokens) came out of the same budget, so a
        6 000 setting really gave the player less than half of it and trimmed their cards to
        fit -- while the meter, which counts player content only, still showed room.
        """
        from app.services import story_prompt_engine
        from app.services.story_token_budget import estimate_story_tokens

        model_name = "deepseek/deepseek-v3.2"
        overhead = monolith_main._story_service_prompt_overhead_tokens(
            model_name,
            monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX,
            False,
            True,
        )
        self.assertGreater(overhead, 1_000)

        cards = [
            {"title": f"Память {index}", "content": "Плотный русский текст блока памяти. " * 40}
            for index in range(24)
        ]
        history = [StoryMessage(game_id=1, role="user", content="Иду дальше по коридору.")]
        available_card_tokens = sum(
            estimate_story_tokens(card["title"]) + estimate_story_tokens(card["content"])
            for card in cards
        )
        for context_limit in (6_000, 16_000, 32_000):
            with self.subTest(context_limit=context_limit):
                payload = story_prompt_engine._build_story_provider_messages(
                    history,
                    [],
                    cards,
                    [],
                    use_plot_memory=True,
                    context_limit_tokens=context_limit,
                    response_max_tokens=monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX,
                    model_name=model_name,
                    show_gg_thoughts=False,
                    show_npc_thoughts=True,
                )
                total = sum(estimate_story_tokens(item.get("content", "")) for item in payload)
                player_tokens = total - overhead
                # The player never gets charged more than their limit...
                self.assertLessEqual(player_tokens, int(context_limit * 1.02))
                # ...and when there is more content than the limit, they get to use it all
                # rather than losing the service prompt's share off the top.
                if available_card_tokens > context_limit * 1.2:
                    self.assertGreater(player_tokens, int(context_limit * 0.7))

    def test_truncated_reply_is_repaired_before_it_reaches_the_player(self) -> None:
        """max_tokens is a hard cut, so a long reply can end mid-word; that must never ship."""
        from app.services.story_runtime import _sanitize_streamed_story_markup

        body = (
            "Он шагнул в проём, и холод ударил в лицо. Стражник обернулся медленно, будто "
            "нехотя, и свет фонаря выхватил из темноты его небритую щёку. За спиной хлопнула "
            "дверь. Где-то наверху заскрипели половицы, и этот звук показался громче "
            "собственного дыхания. Он замер, считая удары сердца, и понял, что путь назад "
            "уже отрезан, а впереди только узкий коридор с низким потолком."
        )
        for label, truncated in (
            ("half word", body + " Он сделал шаг и не усп"),
            ("dangling marker", body + "\n\n[[NPC:Мир"),
        ):
            with self.subTest(label=label):
                repaired = _sanitize_streamed_story_markup(truncated)
                self.assertTrue(repaired.endswith(("." , "!", "?", "…")), repaired[-40:])
                self.assertNotIn("не усп", repaired)
                self.assertNotIn("[[NPC:Мир\n", repaired)

        # A well-formed reply is returned untouched.
        self.assertEqual(_sanitize_streamed_story_markup(body), body)
        # A short line without a full stop is a style choice, not a 2500-token truncation.
        self.assertEqual(_sanitize_streamed_story_markup("Он молчал"), "Он молчал")

    def test_model_is_not_told_the_hard_token_ceiling(self) -> None:
        """Naming the ceiling made models write up to it and get guillotined at the same number."""
        prompt = monolith_main._build_story_system_prompt(
            [],
            [],
            [],
            model_name="deepseek/deepseek-v3.2",
            response_max_tokens=monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX,
        )
        self.assertIn("БЮДЖЕТ ОТВЕТА", prompt)
        self.assertNotIn("жесткий максимум", prompt)
        self.assertNotIn(str(monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX), prompt)
        # The budget is the last thing the model reads: it is the instruction models drop
        # first, and it lost to the style rules above it when it sat in the middle.
        body_lines = [line for line in prompt.split("\n") if line.strip()]
        self.assertIn("БЮДЖЕТ ОТВЕТА", body_lines[-3])
        # It must not demand a paragraph count: the marker protocol already forces every
        # spoken line onto its own paragraph, so a paragraph budget is unsatisfiable as soon
        # as a scene has two speakers, and an impossible rule gets dropped wholesale.
        budget_text = "\n".join(body_lines[-3:])
        self.assertNotIn("абзац", budget_text)
        self.assertIn("предложен", budget_text)
        self.assertIn("реплик", budget_text)

    def test_over_long_reply_is_cut_back_to_the_response_budget(self) -> None:
        """max_tokens cannot hold a thinking model to the budget, so the text is trimmed."""
        from app.services.story_runtime import _sanitize_streamed_story_markup
        from app.services.story_token_budget import estimate_story_tokens

        narration = (
            "Дверь открылась плавно, впуская в душную комнату свежий весенний воздух, "
            "который тут же скользнул по деревянным половицам и растаял у дальней стены."
        )
        paragraphs = []
        for index in range(12):
            paragraphs.append(narration)
            paragraphs.append(f"[[NPC:Мисака]] Реплика номер {index}, произнесённая спокойно и ровно.")
        reply = "\n".join(paragraphs)
        self.assertGreater(estimate_story_tokens(reply), 900)

        trimmed = _sanitize_streamed_story_markup(reply, response_target_tokens=300)
        trimmed_tokens = estimate_story_tokens(trimmed)
        self.assertLessEqual(
            trimmed_tokens,
            int(300 * monolith_main.STORY_RESPONSE_OVERRUN_TOLERANCE),
        )
        self.assertGreater(trimmed_tokens, 0)
        # Paragraph boundaries only: a half paragraph would break the marker contract, and in
        # visual-novel mode it would drop a {{VN_CAST|...}} tag.
        for block in trimmed.split("\n"):
            self.assertIn(block.strip(), {line.strip() for line in reply.split("\n")})

        # A reply already inside the budget is returned untouched, and so is one with no budget.
        short_reply = "\n".join(paragraphs[:2])
        self.assertEqual(
            estimate_story_tokens(_sanitize_streamed_story_markup(short_reply, response_target_tokens=300)),
            estimate_story_tokens(short_reply),
        )
        self.assertEqual(
            estimate_story_tokens(_sanitize_streamed_story_markup(reply, response_target_tokens=None)),
            estimate_story_tokens(reply),
        )


if __name__ == "__main__":
    unittest.main()
