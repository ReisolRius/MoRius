from __future__ import annotations
from datetime import datetime
import json
import math
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    StorySummaryJob,
    StoryCharacterStateSnapshot,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryGame,
    StoryGraphEdge,
    StoryGraphEvent,
    StoryGraphNode,
    StoryGraphSuggestion,
    StoryInstructionCard,
    StoryMapImage,
    StoryMemoryBlock,
    StoryMessage,
    StoryNovelBeat,
    StorySceneBackground,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    StoryCommunityWorldSummaryOut,
    StoryGameSummaryOut,
    StoryInstructionCardOut,
    StoryPublicationStateOut,
    StoryPlotCardOut,
    StoryWorldCardOut,
)
from app.services.media import (
    normalize_avatar_value,
    normalize_media_position,
    normalize_media_scale,
    resolve_media_display_url,
    resolve_media_storage_value,
    validate_avatar_url,
)
from app.services.cosmetics import (
    COSMETIC_KIND_AVATAR_FRAME,
    resolve_cosmetic_image_url_by_selection_id,
)
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_race,
    normalize_story_character_text_color,
)
from app.services.story_cards import (
    deserialize_story_plot_card_triggers,
    normalize_story_plot_card_memory_turns_for_storage,
    normalize_story_plot_card_source,
    normalize_story_plot_card_triggers,
    serialize_story_plot_card_triggers,
    story_plot_card_to_out,
)
from app.services.story_queries import (
    list_story_instruction_cards,
    list_story_plot_cards,
    list_story_world_cards,
)
from app.services.story_world_cards import (
    normalize_story_world_card_triggers,
    serialize_story_world_card_triggers,
    story_world_card_to_out,
)
from app.services.text_encoding import repair_likely_utf8_mojibake_deep, sanitize_likely_utf8_mojibake
from app.services.story_novel import STORY_GAME_MODE_RPG, normalize_story_game_mode
from app.services.image_compression import PROFILE_COVER
try:
    from app.services.story_publication_moderation import coerce_story_publication_status
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def coerce_story_publication_status(value: str | None, *, is_public: bool = False) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"none", "pending", "approved", "rejected"}:
            return normalized
        return "approved" if is_public else "none"

STORY_DEFAULT_TITLE = "Новая игра"
STORY_GAME_VISIBILITY_PRIVATE = "private"
STORY_GAME_VISIBILITY_PUBLIC = "public"
STORY_GAME_VISIBILITY_VALUES = {
    STORY_GAME_VISIBILITY_PRIVATE,
    STORY_GAME_VISIBILITY_PUBLIC,
}
STORY_DEFAULT_AGE_RATING = "16+"
STORY_AGE_RATING_VALUES = {
    "6+",
    "16+",
    "18+",
}
STORY_GENRE_MAX_ITEMS = 3
STORY_GAME_GENRE_VALUES = {
    "Фэнтези",
    "Тёмное фэнтези",
    "Фантастика (Научная фантастика)",
    "Научная фантастика",
    "Детектив",
    "Триллер",
    "Хоррор (Ужасы)",
    "Хоррор",
    "Мистика",
    "Мифология",
    "Романтика (Любовный роман)",
    "Романтическое приключение",
    "Приключения",
    "Боевик",
    "Исторический роман",
    "Комедия / Юмор",
    "Трагедия / Драма",
    "Антиутопия",
    "Постапокалипсис",
    "Киберпанк",
    "Повседневность",
    "Школьное аниме",
}
STORY_CONTEXT_LIMIT_MIN_TOKENS = 6_000
STORY_CONTEXT_LIMIT_MAX_TOKENS = 64_000
STORY_CONTEXT_LIMIT_GLM51_MAX_TOKENS = 128_000
STORY_CONTEXT_LIMIT_AION_MAX_TOKENS = 108_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 6_000
STORY_MEMORY_OPTIMIZATION_MODE_STANDARD = "standard"
STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED = "enhanced"
STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM = "maximum"
STORY_DEFAULT_MEMORY_OPTIMIZATION_MODE = STORY_MEMORY_OPTIMIZATION_MODE_STANDARD
STORY_MEMORY_OPTIMIZATION_MODE_VALUES = {
    STORY_MEMORY_OPTIMIZATION_MODE_STANDARD,
    STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED,
    STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM,
}
STORY_NARRATOR_MODE_NORMAL = "normal"
STORY_NARRATOR_MODE_RISK = "risk"
STORY_NARRATOR_MODE_HARDCORE = "hardcore"
STORY_NARRATOR_MODE_VALUES = {
    STORY_NARRATOR_MODE_NORMAL,
    STORY_NARRATOR_MODE_RISK,
    STORY_NARRATOR_MODE_HARDCORE,
}
STORY_RESPONSE_MAX_TOKENS_MIN = 300
STORY_RESPONSE_MAX_TOKENS_MAX = 2_500
STORY_DEFAULT_RESPONSE_MAX_TOKENS = 800
# The length control is on for a new game: an unbounded narrator fills the context and
# the player's balance far faster than anyone expects, and 800 tokens is a full scene.
STORY_RESPONSE_MAX_TOKENS_DEFAULT_ENABLED = True
STORY_REPETITION_PENALTY_MIN = 1.0
STORY_REPETITION_PENALTY_MAX = 2.0
STORY_DEFAULT_REPETITION_PENALTY = 1.05
STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX = 6_000
STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX = 16_000
STORY_TURN_COST_TIER_3_CONTEXT_LIMIT_MAX = 32_000
STORY_TURN_COST_TIER_4_CONTEXT_LIMIT_MAX = 64_000
STORY_TURN_COST_TIER_5_CONTEXT_LIMIT_MAX = 128_000
# Sol economy v2 (re-derived 2026-09-18 against live RouterAI rates). Every tier below is
# sized so the AI bill can never exceed 25% of the gross rouble the player paid, which is what
# leaves >= 55% net after the 8% turnover tax, 3.5% YooKassa and the hosting allowance.
#
#   Revenue. Price against the cheapest pack per sol -- the worst rate a player can buy into.
#   That is Летописец, 2150 sols for 5990 RUB -> 2.786 RUB/sol gross. The AI budget carried by
#   one sol is therefore 0.25 * 2.786 = 0.6965 RUB.
#
#   Cost, worst case. Input = the tier's full context ceiling (or the model's own ceiling when
#   it is lower, e.g. Aion 2.0's 108k on tier 5) PLUS the service prompt, which since
#   2026-09-18 is spent on top of the player's limit rather than out of it
#   (_story_service_prompt_overhead_tokens, ~2 900-3 550 tokens depending on the model).
#   Output = STORY_RESPONSE_MAX_TOKENS_MAX (2500): sol turns ignore the per-game response
#   setting, story_runtime forces the ceiling.
#   Reasoning is billed on top at internal_reasoning where the provider publishes one.
#   PLUS the service layer, which the previous pricing left out entirely: every sol turn also
#   runs Call A (world/location analysis) and the memory compression on the service model
#   (POLZA_STORY_SERVICE_TEXT_MODEL), and the player is never charged for either. Measured with
#   this repo's own prompt builders: 0.157 RUB/turn up to a 16k context, 0.311 RUB above it.
#
#   price_sols = ceil(worst_case_cost_RUB / 0.6965), then forced strictly increasing across
#   the five tiers, so a bigger context always costs more than a smaller one and the rounding
#   always lands in the operator's favour.
#
#   Two modes, priced separately. Reasoning off (the default) is what the base tiers cover.
#   Reasoning on adds STORY_REASONING_SURCHARGE_BY_MODEL, priced on the same basis with a full
#   STORY_REASONING_MAX_TOKENS budget. For the models in STORY_REASONING_MINIMUM_LLM_MODELS the
#   "off" state still reserves their mandatory minimum, so that reserve is already in the base.
#
# Tier 5 only applies to models whose context reaches past 64k (see
# STORY_EXTENDED_CONTEXT_LLM_MODELS and Aion 2.0's 108k); for the rest it is never charged and
# the number only exists to keep the tuple monotonic.
STORY_TURN_COST_DEEPSEEK_TIERS = (1, 2, 3, 4, 5)
STORY_TURN_COST_DEEPSEEK_V4_PRO_TIERS = (3, 4, 6, 10, 19)
STORY_TURN_COST_DEEPSEEK_R1_TIERS = (3, 4, 5, 8, 9)
STORY_TURN_COST_GLM47_TIERS = (2, 3, 4, 6, 7)
STORY_TURN_COST_AION_TIERS = (3, 4, 7, 11, 16)
STORY_TURN_COST_AION3_TIERS = (9, 14, 22, 37, 38)
# Aion 3.0 Mini: reasoning is MANDATORY on this endpoint (RouterAI answers "Reasoning is
# mandatory for this endpoint and cannot be disabled." to reasoning={"enabled": false}), so the
# bounded STORY_REASONING_MAX_TOKENS budget is billed as completion on every single turn and is
# priced into the base tiers below -- there is no cheaper "off" state to sell and therefore no
# paid toggle. Same for Aion 2.0/3.0 and DeepSeek R1.
STORY_TURN_COST_AION3_MINI_TIERS = (3, 4, 6, 9, 10)
STORY_TURN_COST_QWEN_TIERS = (2, 3, 4, 5, 6)
STORY_TURN_COST_GLM5_TIERS = (2, 3, 5, 8, 9)
STORY_TURN_COST_GEMINI_31_FLASH_LITE_TIERS = (2, 3, 4, 5, 6)
STORY_TURN_COST_GEMINI_25_PRO_TIERS = (7, 10, 13, 20, 21)
STORY_TURN_COST_GLM51_TIERS = (3, 5, 7, 12, 22)
STORY_TURN_COST_GLM52_TIERS = (2, 3, 5, 8, 9)
STORY_TURN_COST_GEMINI_31_PRO_TIERS = (10, 14, 19, 29, 30)
STORY_TURN_COST_CLAUDE_SONNET_TIERS = (11, 16, 23, 39, 40)
STORY_TURN_COST_KIMI_K26_TIERS = (2, 3, 4, 7, 11)
STORY_TURN_COST_KIMI_K3_TIERS = (8, 11, 17, 28, 50)
STORY_REASONING_MAX_TOKENS = 2_048
STORY_REASONING_GEMINI_25_PRO_MIN_TOKENS = 128
STORY_REASONING_GEMINI_31_PRO_BASE_TOKENS = 1_024
STORY_REASONING_GEMINI_3_MIN_TOKENS = 512
STORY_ENVIRONMENT_TIME_MODE_SERVICE = "service"
STORY_ENVIRONMENT_TURN_STEP_MINUTES_DEFAULT = 3
STORY_LLM_MODEL_GLM5 = "z-ai/glm-5"
STORY_LLM_MODEL_GLM51 = "z-ai/glm-5.1"
STORY_LLM_MODEL_GLM52 = "z-ai/glm-5.2"
STORY_LLM_MODEL_GLM47 = "z-ai/glm-4.7"
STORY_LLM_MODEL_DEEPSEEK_V32 = "deepseek/deepseek-v3.2"
STORY_LLM_MODEL_DEEPSEEK_V4_PRO = "deepseek/deepseek-v4-pro-0813"
STORY_LLM_MODEL_DEEPSEEK_R1 = "deepseek/deepseek-r1-0528"
STORY_LLM_MODEL_AION_2 = "aion-labs/aion-2.0"
STORY_LLM_MODEL_AION_3 = "aion-labs/aion-3.0"
STORY_LLM_MODEL_AION_3_MINI = "aion-labs/aion-3.0-mini"
STORY_LLM_MODEL_GEMINI_31_FLASH_LITE = "google/gemini-3.1-flash-lite"
STORY_LLM_MODEL_CLAUDE_SONNET_46 = "anthropic/claude-sonnet-4.6"
STORY_LLM_MODEL_GEMINI_25_PRO = "google/gemini-2.5-pro"
STORY_LLM_MODEL_GEMINI_31_PRO = "google/gemini-3.1-pro-preview"
STORY_LLM_MODEL_QWEN37_PLUS = "qwen/qwen3.7-plus"
STORY_LLM_MODEL_KIMI_K26 = "moonshotai/kimi-k2.6"
STORY_LLM_MODEL_KIMI_K3 = "moonshotai/kimi-k3"
STORY_DEFAULT_LLM_MODEL = STORY_LLM_MODEL_DEEPSEEK_V32

# Subscription-only narrator models (accessible ONLY with an active subscription or admin
# test — never purchasable with sols). Provider IDs are .env-overridable via config.settings;
# kept in sync with SUBSCRIPTION_PLANS in app/services/payments.py.
STORY_LLM_MODEL_SUB_DEEPSEEK_V4_FLASH = settings.subscription_model_deepseek_v4_flash
STORY_LLM_MODEL_SUB_GEMINI_25_FLASH_LITE = settings.subscription_model_gemini_25_flash_lite
STORY_LLM_MODEL_SUB_GLM_45_AIR = settings.subscription_model_glm_45_air
STORY_SUBSCRIPTION_LLM_MODELS = {
    STORY_LLM_MODEL_SUB_DEEPSEEK_V4_FLASH,
    STORY_LLM_MODEL_SUB_GEMINI_25_FLASH_LITE,
    STORY_LLM_MODEL_SUB_GLM_45_AIR,
}

STORY_LLM_MODEL_LEGACY_ALIASES: dict[str, str] = {
    "google/gemini-3-flash": STORY_LLM_MODEL_GEMINI_31_FLASH_LITE,
    "deepseek/deepseek-v4-pro": STORY_LLM_MODEL_DEEPSEEK_V4_PRO,
    # Retired narrator models. Saved games still carry these ids, so each one maps to the
    # closest surviving model instead of silently snapping back to the global default.
    "deepseek/deepseek-chat-v3-0324": STORY_LLM_MODEL_DEEPSEEK_V32,
    "deepcogito/cogito-v2.1-671b": STORY_LLM_MODEL_DEEPSEEK_V4_PRO,
    "minimax/minimax-m2-her": STORY_LLM_MODEL_QWEN37_PLUS,
    # Retired by the sol economy v2 cleanup (2026-09-18). Mistral Nemo and GPT-5.6 Luna Pro
    # left the catalogue outright; GLM 4.7 Flash survives only as the service model
    # (POLZA_STORY_SERVICE_TEXT_MODEL) and is no longer sellable as a narrator.
    "mistralai/mistral-nemo": STORY_LLM_MODEL_DEEPSEEK_V32,
    "openai/gpt-5.6-luna-pro": STORY_LLM_MODEL_DEEPSEEK_V32,
    "z-ai/glm-4.7-flash": STORY_LLM_MODEL_GLM47,
    # Was a subscription model; the tier now tops out at GLM 4.5 Air.
    "google/gemini-3-flash-preview": STORY_LLM_MODEL_SUB_GLM_45_AIR,
}
STORY_SUPPORTED_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_GLM51,
    STORY_LLM_MODEL_GLM52,
    STORY_LLM_MODEL_GLM47,
    STORY_LLM_MODEL_DEEPSEEK_V32,
    STORY_LLM_MODEL_DEEPSEEK_V4_PRO,
    STORY_LLM_MODEL_DEEPSEEK_R1,
    STORY_LLM_MODEL_AION_2,
    STORY_LLM_MODEL_AION_3,
    STORY_LLM_MODEL_AION_3_MINI,
    STORY_LLM_MODEL_GEMINI_31_FLASH_LITE,
    STORY_LLM_MODEL_CLAUDE_SONNET_46,
    STORY_LLM_MODEL_GEMINI_25_PRO,
    STORY_LLM_MODEL_GEMINI_31_PRO,
    STORY_LLM_MODEL_QWEN37_PLUS,
    STORY_LLM_MODEL_KIMI_K26,
    STORY_LLM_MODEL_KIMI_K3,
    *STORY_SUBSCRIPTION_LLM_MODELS,
}

# Models where the player can buy reasoning above the model's free/base mode. For models
# with unavoidable thinking, False means the cheapest supported level and True means the
# enhanced level. Always-reasoning models without a controllable level are intentionally
# omitted: their cost is already included in the base turn tiers above.
STORY_REASONING_SUPPORTED_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_GLM51,
    STORY_LLM_MODEL_GLM52,
    STORY_LLM_MODEL_GLM47,
    STORY_LLM_MODEL_DEEPSEEK_V32,
    STORY_LLM_MODEL_DEEPSEEK_V4_PRO,
    STORY_LLM_MODEL_GEMINI_31_FLASH_LITE,
    STORY_LLM_MODEL_CLAUDE_SONNET_46,
    STORY_LLM_MODEL_GEMINI_25_PRO,
    STORY_LLM_MODEL_GEMINI_31_PRO,
    STORY_LLM_MODEL_QWEN37_PLUS,
    STORY_LLM_MODEL_KIMI_K26,
    STORY_LLM_MODEL_KIMI_K3,
    *STORY_SUBSCRIPTION_LLM_MODELS,
}

# These models cannot truthfully be described as having reasoning switched off. Gemini
# exposes a cheaper minimum level; Aion and DeepSeek R1 expose no reliable off/effort mode
# through RouterAI, so they always use the bounded base budget and have no paid toggle.
STORY_REASONING_MINIMUM_LLM_MODELS = {
    STORY_LLM_MODEL_AION_2,
    STORY_LLM_MODEL_AION_3,
    STORY_LLM_MODEL_AION_3_MINI,
    STORY_LLM_MODEL_DEEPSEEK_R1,
    STORY_LLM_MODEL_GEMINI_31_FLASH_LITE,
    STORY_LLM_MODEL_GEMINI_25_PRO,
    STORY_LLM_MODEL_GEMINI_31_PRO,
}
STORY_REASONING_FIXED_LLM_MODELS = {
    STORY_LLM_MODEL_AION_2,
    STORY_LLM_MODEL_AION_3,
    STORY_LLM_MODEL_AION_3_MINI,
    STORY_LLM_MODEL_DEEPSEEK_R1,
}

# Incremental add-on above the model's off/minimum mode: the extra thinking tokens the toggle
# buys, at the model's internal_reasoning rate (completion rate where the provider publishes
# none), divided by the 0.6965 RUB of AI budget one sol carries and rounded up.
#
#   sols = ceil((full_budget - mandatory_minimum) x reasoning_rate / 0.6965)
#
# full_budget is STORY_REASONING_MAX_TOKENS, except Gemini 3.x which takes a thinking *level*
# rather than a token budget and is therefore priced for ~4000 tokens. The mandatory minimum is
# already inside the base tier (see STORY_REASONING_MINIMUM_LLM_MODELS), so only the difference
# is charged. Verified against live RouterAI rates: base tier + surcharge holds >= 55% net at
# every tier of every model, worst case 56.5%.
STORY_REASONING_SURCHARGE_BY_MODEL: dict[str, int] = {
    STORY_LLM_MODEL_GLM5: 1,
    STORY_LLM_MODEL_GLM51: 1,
    STORY_LLM_MODEL_GLM52: 1,
    STORY_LLM_MODEL_GLM47: 1,
    STORY_LLM_MODEL_DEEPSEEK_V32: 1,
    STORY_LLM_MODEL_DEEPSEEK_V4_PRO: 1,
    STORY_LLM_MODEL_GEMINI_31_FLASH_LITE: 1,
    STORY_LLM_MODEL_CLAUDE_SONNET_46: 5,
    STORY_LLM_MODEL_GEMINI_25_PRO: 4,
    # Gemini 3.x takes a thinking *level*, not a token budget, so "medium" has no ceiling we
    # control — priced for ~4K reasoning tokens rather than the 2_048 the other models cap at.
    STORY_LLM_MODEL_GEMINI_31_PRO: 6,
    STORY_LLM_MODEL_QWEN37_PLUS: 1,
    STORY_LLM_MODEL_KIMI_K26: 1,
    STORY_LLM_MODEL_KIMI_K3: 4,
    STORY_LLM_MODEL_SUB_DEEPSEEK_V4_FLASH: 1,
    STORY_LLM_MODEL_SUB_GEMINI_25_FLASH_LITE: 1,
    STORY_LLM_MODEL_SUB_GLM_45_AIR: 1,
}
STORY_EXTENDED_CONTEXT_LLM_MODELS = {
    STORY_LLM_MODEL_GLM51,
    STORY_LLM_MODEL_DEEPSEEK_V4_PRO,
    STORY_LLM_MODEL_KIMI_K26,
    STORY_LLM_MODEL_KIMI_K3,
}
STORY_TURN_COST_STANDARD_LLM_MODELS = {
    STORY_LLM_MODEL_DEEPSEEK_V32,
}

# Narrator models that cannot carry D&D mode. The mode hands the model a long structured
# system card (sheet, hit points, dice verdict, NPC relations) and expects it to honour a roll
# result it did not choose, and a model that drops instructions before that point reads to a
# player as the dice being ignored. The two models this used to hold (Mistral Nemo and GLM 4.7
# Flash) left the narrator catalogue in the sol economy v2 cleanup, so every surviving narrator
# now carries the mode -- including the budget option deepseek/deepseek-v3.2 and every
# subscription model, so a subscriber's plan never becomes unusable here.
STORY_DND_BLOCKED_LLM_MODELS: set[str] = set()
# What a blocked game falls back to: the cheapest model that still follows the contract.
STORY_DND_DEFAULT_LLM_MODEL = STORY_LLM_MODEL_DEEPSEEK_V32


def is_story_dnd_supported_llm_model(model_name: str | None) -> bool:
    return coerce_story_llm_model(model_name) not in STORY_DND_BLOCKED_LLM_MODELS


def coerce_story_dnd_llm_model(model_name: str | None) -> str:
    normalized = coerce_story_llm_model(model_name)
    if normalized in STORY_DND_BLOCKED_LLM_MODELS:
        return STORY_DND_DEFAULT_LLM_MODEL
    return normalized
STORY_IMAGE_MODEL_NANO_BANANO = "google/gemini-2.5-flash-image"
STORY_IMAGE_MODEL_NANO_BANANO_2 = "google/gemini-3.1-flash-image-preview"
STORY_DEFAULT_IMAGE_MODEL = STORY_IMAGE_MODEL_NANO_BANANO
# Only the two Nano Banana models are sellable. FLUX.2 (pro / klein), Seedream 4.5 and the old
# Qwen editor were retired with the sol economy v2 cleanup; every id they ever went by stays in
# the alias table so saved turns, maps and novel backgrounds keep rendering on Nano Banana.
STORY_SUPPORTED_IMAGE_MODELS = {
    STORY_IMAGE_MODEL_NANO_BANANO,
    STORY_IMAGE_MODEL_NANO_BANANO_2,
}
STORY_IMAGE_MODEL_LEGACY_ALIASES = {
    "black-forest-labs/flux.2-pro": STORY_IMAGE_MODEL_NANO_BANANO,
    "flux.2-pro": STORY_IMAGE_MODEL_NANO_BANANO,
    "black-forest-labs/flux.2-klein-4b": STORY_IMAGE_MODEL_NANO_BANANO,
    "flux.2-klein-4b": STORY_IMAGE_MODEL_NANO_BANANO,
    "bytedance-seed/seedream-4.5": STORY_IMAGE_MODEL_NANO_BANANO,
    "seedream-4.5": STORY_IMAGE_MODEL_NANO_BANANO,
    "bytedance/seedream-4.5": STORY_IMAGE_MODEL_NANO_BANANO,
    "qwen-image-edit": STORY_IMAGE_MODEL_NANO_BANANO,
    "qwen/qwen-image-edit": STORY_IMAGE_MODEL_NANO_BANANO,
}
STORY_TOP_K_MIN = 0
STORY_TOP_K_MAX = 200
STORY_DEFAULT_TOP_K = 55
STORY_TOP_R_MIN = 0.1
STORY_TOP_R_MAX = 1.0
STORY_DEFAULT_TOP_R = 0.75
STORY_TEMPERATURE_MIN = 0.0
STORY_TEMPERATURE_MAX = 2.0
STORY_DEFAULT_TEMPERATURE = 0.75
# Per-narrator-model default sampling profiles. Each model behaves best in Russian RP with
# its own temperature / nucleus / top_k / repetition penalty, so when the player has not
# manually overridden a value (value is None) we seed the model's tuned default instead of a
# single global one. These are defaults only: the player can still adjust every slider, and
# switching the narrator model re-seeds the profile of the newly selected model.
#
# This table is the backend mirror of the frontend STORY_NARRATOR_SAMPLING_DEFAULTS in
# frontend/src/pages/StoryGamePage.tsx and MUST stay in sync with it: the UI sends these
# values on model switch, while this copy covers game creation and any non-UI/API client.
# top_k == 0 means "do not constrain by top_k" (nucleus sampling governs). Provider-specific
# unsupported parameters are filtered independently when the request payload is assembled.
STORY_MODEL_SAMPLING_PROFILES: dict[str, dict[str, float]] = {
    STORY_LLM_MODEL_GLM5: {"temperature": 0.90, "top_r": 0.95, "top_k": 60, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_GLM51: {"temperature": 0.95, "top_r": 0.97, "top_k": 80, "repetition_penalty": 1.03},
    STORY_LLM_MODEL_GLM52: {"temperature": 0.90, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_GLM47: {"temperature": 0.85, "top_r": 0.95, "top_k": 50, "repetition_penalty": 1.08},
    STORY_LLM_MODEL_DEEPSEEK_V32: {"temperature": 0.75, "top_r": 0.90, "top_k": 40, "repetition_penalty": 1.10},
    STORY_LLM_MODEL_DEEPSEEK_V4_PRO: {"temperature": 0.70, "top_r": 0.90, "top_k": 0, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_DEEPSEEK_R1: {"temperature": 0.70, "top_r": 0.90, "top_k": 0, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_AION_2: {"temperature": 0.80, "top_r": 0.92, "top_k": 50, "repetition_penalty": 1.08},
    STORY_LLM_MODEL_AION_3: {"temperature": 0.80, "top_r": 0.92, "top_k": 50, "repetition_penalty": 1.08},
    STORY_LLM_MODEL_AION_3_MINI: {"temperature": 0.80, "top_r": 0.92, "top_k": 50, "repetition_penalty": 1.08},
    STORY_LLM_MODEL_GEMINI_31_FLASH_LITE: {"temperature": 1.00, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.00},
    STORY_LLM_MODEL_CLAUDE_SONNET_46: {"temperature": 0.90, "top_r": 1.00, "top_k": 0, "repetition_penalty": 1.00},
    STORY_LLM_MODEL_GEMINI_25_PRO: {"temperature": 1.05, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.00},
    STORY_LLM_MODEL_GEMINI_31_PRO: {"temperature": 1.10, "top_r": 0.97, "top_k": 128, "repetition_penalty": 1.00},
    STORY_LLM_MODEL_QWEN37_PLUS: {"temperature": 0.85, "top_r": 0.92, "top_k": 50, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_KIMI_K26: {"temperature": 0.90, "top_r": 0.95, "top_k": 50, "repetition_penalty": 1.05},
    STORY_LLM_MODEL_KIMI_K3: {"temperature": 0.85, "top_r": 0.95, "top_k": 64, "repetition_penalty": 1.03},
    # The OpenAI reasoning family accepts none of temperature / top_p / top_k / repetition_penalty,
    # so this profile is deliberately neutral -- nothing is constrained and nothing is faked.
    STORY_LLM_MODEL_SUB_DEEPSEEK_V4_FLASH: {"temperature": 0.85, "top_r": 0.90, "top_k": 50, "repetition_penalty": 1.08},
    STORY_LLM_MODEL_SUB_GEMINI_25_FLASH_LITE: {"temperature": 0.95, "top_r": 0.95, "top_k": 0, "repetition_penalty": 1.06},
    STORY_LLM_MODEL_SUB_GLM_45_AIR: {"temperature": 0.82, "top_r": 0.90, "top_k": 50, "repetition_penalty": 1.06},
}


def _story_model_sampling_profile(model_name: str | None) -> dict[str, float]:
    normalized = (model_name or "").strip()
    normalized = STORY_LLM_MODEL_LEGACY_ALIASES.get(normalized, normalized)
    return STORY_MODEL_SAMPLING_PROFILES.get(normalized, {})


STORY_DEFAULT_SHOW_GG_THOUGHTS = False
STORY_DEFAULT_SHOW_NPC_THOUGHTS = False
STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH = 320
STORY_COVER_SCALE_MIN = 1.0
STORY_COVER_SCALE_MAX = 3.0
STORY_COVER_SCALE_DEFAULT = 1.0
STORY_IMAGE_POSITION_MIN = 0.0
STORY_IMAGE_POSITION_MAX = 100.0
STORY_IMAGE_POSITION_DEFAULT = 50.0
STORY_COVER_MAX_BYTES = 2 * 1024 * 1024
STORY_OPENING_SCENE_MAX_LENGTH = 12_000
STORY_WORLD_CARD_KIND_WORLD = "world"
STORY_WORLD_CARD_KIND_NPC = "npc"
STORY_WORLD_CARD_KIND_MAIN_HERO = "main_hero"
STORY_WORLD_CARD_KIND_WORLD_PROFILE = "world_profile"
STORY_WORLD_CARD_KINDS = {
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
}
STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 3
STORY_WORLD_CARD_MEMORY_TURNS_DISABLED = 0
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"
STORY_APPEARANCE_BACKGROUND_MODE_DEFAULT = "custom"
STORY_APPEARANCE_BACKGROUND_MODE_CUSTOM = "custom"
STORY_APPEARANCE_BACKGROUND_MODE_VALUES = {
    STORY_APPEARANCE_BACKGROUND_MODE_DEFAULT,
    STORY_APPEARANCE_BACKGROUND_MODE_CUSTOM,
}
STORY_APPEARANCE_UI_STYLE_DEFAULT = "default"
STORY_APPEARANCE_UI_STYLE_CYBERPUNK = "cyberpunk"
STORY_APPEARANCE_UI_STYLE_FANTASY = "fantasy"
STORY_APPEARANCE_UI_STYLE_MODERN = "modern"
STORY_APPEARANCE_UI_STYLE_VALUES = {
    STORY_APPEARANCE_UI_STYLE_DEFAULT,
    STORY_APPEARANCE_UI_STYLE_CYBERPUNK,
    STORY_APPEARANCE_UI_STYLE_FANTASY,
    STORY_APPEARANCE_UI_STYLE_MODERN,
}
STORY_APPEARANCE_TEXT_STYLE_DEFAULT = "default"
STORY_APPEARANCE_TEXT_STYLE_SERIF = "serif"
STORY_APPEARANCE_TEXT_STYLE_TERMINAL = "terminal"
STORY_APPEARANCE_TEXT_STYLE_VALUES = {
    STORY_APPEARANCE_TEXT_STYLE_DEFAULT,
    STORY_APPEARANCE_TEXT_STYLE_SERIF,
    STORY_APPEARANCE_TEXT_STYLE_TERMINAL,
}
STORY_APPEARANCE_DEFAULT_GRADIENT_FROM = "#20232D"
STORY_APPEARANCE_DEFAULT_GRADIENT_TO = "#0A0400"
STORY_APPEARANCE_DEFAULT_SOLID_COLOR = "#21242C"


def coerce_story_narrator_mode(value: str | None) -> str:
    normalized = str(value or STORY_NARRATOR_MODE_NORMAL).strip().lower()
    if normalized not in STORY_NARRATOR_MODE_VALUES:
        return STORY_NARRATOR_MODE_NORMAL
    return normalized


def normalize_story_appearance_background_mode(value: str | None) -> str:
    normalized = str(value or STORY_APPEARANCE_BACKGROUND_MODE_DEFAULT).strip().lower()
    if normalized not in STORY_APPEARANCE_BACKGROUND_MODE_VALUES:
        return STORY_APPEARANCE_BACKGROUND_MODE_DEFAULT
    return normalized


def normalize_story_appearance_gradient_enabled(value: bool | None) -> bool:
    if value is None:
        return True
    return bool(value)


def normalize_story_appearance_dialogue_view(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_appearance_color(value: str | None, *, default: str) -> str:
    normalized = str(value or default).strip()
    if len(normalized) != 7 or not normalized.startswith("#"):
        return default
    hex_digits = normalized[1:]
    if any(character not in "0123456789abcdefABCDEF" for character in hex_digits):
        return default
    return f"#{hex_digits.upper()}"


def normalize_story_appearance_ui_style(value: str | None) -> str:
    normalized = str(value or STORY_APPEARANCE_UI_STYLE_DEFAULT).strip().lower()
    if normalized not in STORY_APPEARANCE_UI_STYLE_VALUES:
        return STORY_APPEARANCE_UI_STYLE_DEFAULT
    return normalized


def normalize_story_appearance_text_style(value: str | None) -> str:
    normalized = str(value or STORY_APPEARANCE_TEXT_STYLE_DEFAULT).strip().lower()
    if normalized not in STORY_APPEARANCE_TEXT_STYLE_VALUES:
        return STORY_APPEARANCE_TEXT_STYLE_DEFAULT
    return normalized


def _story_publication_state_out(record: StoryGame) -> StoryPublicationStateOut:
    is_public = coerce_story_game_visibility(getattr(record, "visibility", None)) == STORY_GAME_VISIBILITY_PUBLIC
    return StoryPublicationStateOut(
        status=coerce_story_publication_status(
            getattr(record, "publication_status", None),
            is_public=is_public,
        ),
        requested_at=getattr(record, "publication_requested_at", None),
        reviewed_at=getattr(record, "publication_reviewed_at", None),
        reviewer_user_id=getattr(record, "publication_reviewer_user_id", None),
        rejection_reason=str(getattr(record, "publication_rejection_reason", "") or "").strip() or None,
    )


def coerce_story_game_visibility(value: str | None) -> str:
    normalized = (value or STORY_GAME_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_GAME_VISIBILITY_VALUES:
        return STORY_GAME_VISIBILITY_PRIVATE
    return normalized


def normalize_story_game_visibility(value: str | None) -> str:
    normalized = (value or STORY_GAME_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_GAME_VISIBILITY_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Visibility should be either private or public",
        )
    return normalized


def coerce_story_game_age_rating(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_AGE_RATING).strip()
    if normalized in STORY_AGE_RATING_VALUES:
        return normalized
    return STORY_DEFAULT_AGE_RATING


def normalize_story_game_age_rating(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_AGE_RATING).strip()
    if normalized not in STORY_AGE_RATING_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Age rating should be one of: 6+, 16+, 18+",
        )
    return normalized


def _normalize_story_game_genre_value(value: str) -> str:
    return " ".join(sanitize_likely_utf8_mojibake(value).replace("\r", " ").replace("\n", " ").split())


def normalize_story_game_genres(values: list[str] | None) -> list[str]:
    if values is None:
        return []

    normalized_values: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        genre = _normalize_story_game_genre_value(str(raw_value))
        if not genre:
            continue
        if genre not in STORY_GAME_GENRE_VALUES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported genre: {genre}",
            )
        if genre in seen:
            continue
        seen.add(genre)
        normalized_values.append(genre)

    if len(normalized_values) > STORY_GENRE_MAX_ITEMS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No more than {STORY_GENRE_MAX_ITEMS} genres are allowed",
        )

    return normalized_values


def serialize_story_game_genres(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def deserialize_story_game_genres(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []

    try:
        loaded = json.loads(raw_value)
    except (TypeError, ValueError):
        return []

    if not isinstance(loaded, list):
        return []

    normalized_values: list[str] = []
    seen: set[str] = set()
    for item in loaded:
        if not isinstance(item, str):
            continue
        genre = _normalize_story_game_genre_value(item)
        if not genre or genre in seen or genre not in STORY_GAME_GENRE_VALUES:
            continue
        seen.add(genre)
        normalized_values.append(genre)
        if len(normalized_values) >= STORY_GENRE_MAX_ITEMS:
            break

    return normalized_values


def normalize_story_game_description(value: str | None) -> str:
    if value is None:
        return ""
    normalized = sanitize_likely_utf8_mojibake(value).replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:4_000].rstrip()


def normalize_story_game_opening_scene(value: str | None) -> str:
    if value is None:
        return ""
    normalized = sanitize_likely_utf8_mojibake(value).replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:STORY_OPENING_SCENE_MAX_LENGTH].rstrip()


def normalize_story_image_style_prompt(value: str | None) -> str:
    if value is None:
        return ""
    normalized = " ".join(sanitize_likely_utf8_mojibake(value).replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        return ""
    return normalized[:STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH].rstrip()


def get_story_context_limit_max_tokens(model_name: str | None = None) -> int:
    normalized_model_name = coerce_story_llm_model(model_name)
    if normalized_model_name == STORY_LLM_MODEL_AION_2:
        return STORY_CONTEXT_LIMIT_AION_MAX_TOKENS
    if normalized_model_name in STORY_EXTENDED_CONTEXT_LLM_MODELS:
        return STORY_CONTEXT_LIMIT_GLM51_MAX_TOKENS
    return STORY_CONTEXT_LIMIT_MAX_TOKENS


def normalize_story_context_limit_chars(value: int | None, *, model_name: str | None = None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    normalized = int(value)
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(normalized, get_story_context_limit_max_tokens(model_name)))


def normalize_story_response_max_tokens(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_RESPONSE_MAX_TOKENS
    normalized = int(value)
    if STORY_RESPONSE_MAX_TOKENS_MIN <= normalized <= STORY_RESPONSE_MAX_TOKENS_MAX:
        return normalized
    return STORY_DEFAULT_RESPONSE_MAX_TOKENS


def normalize_story_response_max_tokens_enabled(value: bool | None) -> bool:
    if value is None:
        return STORY_RESPONSE_MAX_TOKENS_DEFAULT_ENABLED
    return bool(value)


def normalize_story_response_token_limit_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def is_story_reasoning_supported_model(model_name: str | None) -> bool:
    return coerce_story_llm_model(model_name) in STORY_REASONING_SUPPORTED_LLM_MODELS


def is_story_reasoning_minimum_model(model_name: str | None) -> bool:
    return coerce_story_llm_model(model_name) in STORY_REASONING_MINIMUM_LLM_MODELS


def is_story_reasoning_fixed_model(model_name: str | None) -> bool:
    return coerce_story_llm_model(model_name) in STORY_REASONING_FIXED_LLM_MODELS


def get_story_reasoning_reserved_tokens(
    model_name: str | None,
    *,
    reasoning_enabled: bool,
) -> int:
    normalized_model_name = coerce_story_llm_model(model_name)
    if reasoning_enabled and is_story_reasoning_supported_model(normalized_model_name):
        return STORY_REASONING_MAX_TOKENS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_25_PRO:
        return STORY_REASONING_GEMINI_25_PRO_MIN_TOKENS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_31_PRO:
        return STORY_REASONING_GEMINI_31_PRO_BASE_TOKENS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_31_FLASH_LITE:
        return STORY_REASONING_GEMINI_3_MIN_TOKENS
    if normalized_model_name in STORY_REASONING_FIXED_LLM_MODELS:
        return STORY_REASONING_MAX_TOKENS
    return 0


def normalize_story_reasoning_enabled(value: bool | None, *, model_name: str | None = None) -> bool:
    if value is None or not bool(value):
        return False
    return is_story_reasoning_supported_model(model_name)


def get_story_reasoning_surcharge_tokens(
    model_name: str | None,
    *,
    reasoning_enabled: bool,
) -> int:
    normalized_model_name = coerce_story_llm_model(model_name)
    if not normalize_story_reasoning_enabled(reasoning_enabled, model_name=normalized_model_name):
        return 0
    return max(int(STORY_REASONING_SURCHARGE_BY_MODEL.get(normalized_model_name, 0)), 0)


def get_story_model_turn_cost_tiers(model_name: str | None) -> tuple[int, int, int, int, int]:
    normalized_model_name = coerce_story_llm_model(model_name)
    if normalized_model_name == STORY_LLM_MODEL_GLM47:
        return STORY_TURN_COST_GLM47_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GLM51:
        return STORY_TURN_COST_GLM51_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GLM52:
        return STORY_TURN_COST_GLM52_TIERS
    if normalized_model_name == STORY_LLM_MODEL_AION_2:
        return STORY_TURN_COST_AION_TIERS
    if normalized_model_name == STORY_LLM_MODEL_AION_3:
        return STORY_TURN_COST_AION3_TIERS
    if normalized_model_name == STORY_LLM_MODEL_AION_3_MINI:
        return STORY_TURN_COST_AION3_MINI_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GLM5:
        return STORY_TURN_COST_GLM5_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_31_FLASH_LITE:
        return STORY_TURN_COST_GEMINI_31_FLASH_LITE_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_25_PRO:
        return STORY_TURN_COST_GEMINI_25_PRO_TIERS
    if normalized_model_name == STORY_LLM_MODEL_CLAUDE_SONNET_46:
        return STORY_TURN_COST_CLAUDE_SONNET_TIERS
    if normalized_model_name == STORY_LLM_MODEL_GEMINI_31_PRO:
        return STORY_TURN_COST_GEMINI_31_PRO_TIERS
    if normalized_model_name == STORY_LLM_MODEL_KIMI_K26:
        return STORY_TURN_COST_KIMI_K26_TIERS
    if normalized_model_name == STORY_LLM_MODEL_KIMI_K3:
        return STORY_TURN_COST_KIMI_K3_TIERS
    if normalized_model_name == STORY_LLM_MODEL_DEEPSEEK_V32:
        return STORY_TURN_COST_DEEPSEEK_TIERS
    if normalized_model_name == STORY_LLM_MODEL_DEEPSEEK_V4_PRO:
        return STORY_TURN_COST_DEEPSEEK_V4_PRO_TIERS
    if normalized_model_name == STORY_LLM_MODEL_DEEPSEEK_R1:
        return STORY_TURN_COST_DEEPSEEK_R1_TIERS
    if normalized_model_name == STORY_LLM_MODEL_QWEN37_PLUS:
        return STORY_TURN_COST_QWEN_TIERS
    if normalized_model_name in STORY_TURN_COST_STANDARD_LLM_MODELS:
        return STORY_TURN_COST_DEEPSEEK_TIERS
    return STORY_TURN_COST_DEEPSEEK_TIERS


def get_story_turn_cost_tokens(context_usage_tokens: int | None, model_name: str | None = None) -> int:
    normalized_usage = max(int(context_usage_tokens or 0), 0)
    normalized_usage = min(normalized_usage, get_story_context_limit_max_tokens(model_name))
    tier_1_cost, tier_2_cost, tier_3_cost, tier_4_cost, tier_5_cost = get_story_model_turn_cost_tiers(model_name)
    if normalized_usage <= STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX:
        return tier_1_cost
    if normalized_usage <= STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX:
        return tier_2_cost
    if normalized_usage <= STORY_TURN_COST_TIER_3_CONTEXT_LIMIT_MAX:
        return tier_3_cost
    if normalized_usage <= STORY_TURN_COST_TIER_4_CONTEXT_LIMIT_MAX:
        return tier_4_cost
    return tier_5_cost


def coerce_story_llm_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_LLM_MODEL).strip()
    normalized = STORY_LLM_MODEL_LEGACY_ALIASES.get(normalized, normalized)
    if normalized in STORY_SUPPORTED_LLM_MODELS:
        return normalized
    return STORY_DEFAULT_LLM_MODEL


def normalize_story_llm_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_LLM_MODEL).strip()
    normalized = STORY_LLM_MODEL_LEGACY_ALIASES.get(normalized, normalized)
    if normalized not in STORY_SUPPORTED_LLM_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported story model. "
                "Use one of: z-ai/glm-5, z-ai/glm-5.1, z-ai/glm-5.2, z-ai/glm-4.7, "
                "deepseek/deepseek-v3.2, deepseek/deepseek-v4-pro-0813, deepseek/deepseek-r1-0528, "
                "aion-labs/aion-2.0, aion-labs/aion-3.0, aion-labs/aion-3.0-mini, "
                "google/gemini-3.1-flash-lite, google/gemini-2.5-pro, google/gemini-3.1-pro-preview, "
                "anthropic/claude-sonnet-4.6, qwen/qwen3.7-plus, "
                "moonshotai/kimi-k2.6, moonshotai/kimi-k3"
            ),
        )
    return normalized


def coerce_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    normalized = STORY_IMAGE_MODEL_LEGACY_ALIASES.get(normalized, normalized)
    if normalized in STORY_SUPPORTED_IMAGE_MODELS:
        return normalized
    return STORY_DEFAULT_IMAGE_MODEL


def normalize_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    normalized = STORY_IMAGE_MODEL_LEGACY_ALIASES.get(normalized, normalized)
    if normalized not in STORY_SUPPORTED_IMAGE_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported image model. "
                "Use one of: google/gemini-2.5-flash-image, "
                "google/gemini-3.1-flash-image-preview"
            ),
        )
    return normalized


def normalize_story_memory_optimization_enabled(value: bool | None) -> bool:
    _ = value
    # Memory optimization is a mandatory runtime mode.
    return True


def normalize_story_memory_optimization_mode(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_MEMORY_OPTIMIZATION_MODE_VALUES:
        return normalized
    if normalized in {"усиленный", "enhanced"}:
        return STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED
    if normalized in {"максимальные", "максимальный", "maximum", "max"}:
        return STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM
    return STORY_DEFAULT_MEMORY_OPTIMIZATION_MODE


def normalize_story_top_k(value: int | None, *, model_name: str | None = None) -> int:
    if value is None:
        profile_value = _story_model_sampling_profile(model_name).get("top_k", STORY_DEFAULT_TOP_K)
        return max(STORY_TOP_K_MIN, min(int(profile_value), STORY_TOP_K_MAX))
    return max(STORY_TOP_K_MIN, min(int(value), STORY_TOP_K_MAX))


def normalize_story_top_r(value: float | None, *, model_name: str | None = None) -> float:
    if value is None:
        profile_value = _story_model_sampling_profile(model_name).get("top_r", STORY_DEFAULT_TOP_R)
        return round(max(STORY_TOP_R_MIN, min(float(profile_value), STORY_TOP_R_MAX)), 2)
    clamped_value = max(STORY_TOP_R_MIN, min(float(value), STORY_TOP_R_MAX))
    return round(clamped_value, 2)


def normalize_story_temperature(value: float | None, *, model_name: str | None = None) -> float:
    if value is None:
        profile_value = _story_model_sampling_profile(model_name).get("temperature", STORY_DEFAULT_TEMPERATURE)
        return round(max(STORY_TEMPERATURE_MIN, min(float(profile_value), STORY_TEMPERATURE_MAX)), 2)
    clamped_value = max(STORY_TEMPERATURE_MIN, min(float(value), STORY_TEMPERATURE_MAX))
    return round(clamped_value, 2)


def normalize_story_repetition_penalty(value: float | None, *, model_name: str | None = None) -> float:
    if value is None:
        profile_value = _story_model_sampling_profile(model_name).get(
            "repetition_penalty", STORY_DEFAULT_REPETITION_PENALTY
        )
        return round(max(STORY_REPETITION_PENALTY_MIN, min(float(profile_value), STORY_REPETITION_PENALTY_MAX)), 2)
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return STORY_DEFAULT_REPETITION_PENALTY
    if not math.isfinite(numeric_value):
        return STORY_DEFAULT_REPETITION_PENALTY
    clamped_value = max(STORY_REPETITION_PENALTY_MIN, min(numeric_value, STORY_REPETITION_PENALTY_MAX))
    return round(clamped_value, 2)


def normalize_story_show_gg_thoughts(value: bool | None) -> bool:
    _ = value
    return False


def normalize_story_show_npc_thoughts(value: bool | None) -> bool:
    if value is None:
        return STORY_DEFAULT_SHOW_NPC_THOUGHTS
    return bool(value)


def normalize_story_ambient_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_location_module_enabled(value: bool | None) -> bool:
    if value is None:
        return True
    return bool(value)


def normalize_story_character_state_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_auto_graph_nodes_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_auto_graph_edges_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_graph_confirm_low_confidence(value: bool | None) -> bool:
    if value is None:
        return True
    return bool(value)


def normalize_story_graph_auto_apply_confidence(value: float | None) -> float:
    if value is None:
        return 0.78
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return 0.78
    if not math.isfinite(numeric_value):
        return 0.78
    return round(max(0.0, min(numeric_value, 1.0)), 2)


def normalize_story_canonical_state_pipeline_enabled(value: bool | None) -> bool:
    if value is None:
        return True
    return bool(value)


def normalize_story_canonical_state_safe_fallback_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_environment_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def normalize_story_environment_time_enabled(
    value: bool | None,
    *,
    legacy_environment_enabled: bool | None = None,
) -> bool:
    if value is None:
        return bool(legacy_environment_enabled) if legacy_environment_enabled is not None else False
    return bool(value)


def normalize_story_environment_weather_enabled(
    value: bool | None,
    *,
    legacy_environment_enabled: bool | None = None,
) -> bool:
    if value is None:
        return bool(legacy_environment_enabled) if legacy_environment_enabled is not None else False
    return bool(value)


def coerce_story_environment_time_mode(value: str | None) -> str:
    _ = value
    return STORY_ENVIRONMENT_TIME_MODE_SERVICE


def normalize_story_environment_turn_step_minutes(value: int | None) -> int:
    _ = value
    return STORY_ENVIRONMENT_TURN_STEP_MINUTES_DEFAULT


def deserialize_story_environment_datetime(raw_value: str | None):
    normalized = str(raw_value or "").strip()
    if not normalized:
        return None
    try:
        return __import__("datetime").datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None


def serialize_story_environment_datetime(value) -> str:
    if value is None:
        return ""
    try:
        return value.isoformat()
    except AttributeError:
        return ""


def deserialize_story_environment_weather(raw_value: str | None) -> dict[str, Any] | None:
    if not raw_value:
        return None
    try:
        parsed = json.loads(raw_value)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return repair_likely_utf8_mojibake_deep(parsed)


def serialize_story_environment_weather(value: dict[str, Any] | None) -> str:
    if not isinstance(value, dict):
        return ""
    try:
        return json.dumps(repair_likely_utf8_mojibake_deep(value), ensure_ascii=False)
    except (TypeError, ValueError):
        return ""


def deserialize_story_character_state_cards_payload(raw_value: str | None) -> list[dict[str, Any]]:
    normalized_raw = sanitize_likely_utf8_mojibake(raw_value).strip()
    if not normalized_raw:
        return []
    try:
        parsed = json.loads(normalized_raw)
    except (TypeError, ValueError):
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("cards")
    if not isinstance(parsed, list):
        return []

    normalized_cards: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        raw_world_card_id = item.get("world_card_id")
        world_card_id: int | None = None
        if isinstance(raw_world_card_id, int) and raw_world_card_id > 0:
            world_card_id = raw_world_card_id
        elif isinstance(raw_world_card_id, str) and raw_world_card_id.strip().isdigit():
            parsed_world_card_id = int(raw_world_card_id.strip())
            if parsed_world_card_id > 0:
                world_card_id = parsed_world_card_id

        name = " ".join(
            sanitize_likely_utf8_mojibake(item.get("name") or item.get("title") or "").split()
        ).strip()[:120].rstrip()
        kind = _normalize_story_world_card_kind(str(item.get("kind") or STORY_WORLD_CARD_KIND_NPC))
        normalized_card: dict[str, Any] = {
            "world_card_id": world_card_id,
            "name": name,
            "kind": kind,
            "is_active": bool(item.get("is_active", True)),
            "status": sanitize_likely_utf8_mojibake(item.get("status") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            "clothing": sanitize_likely_utf8_mojibake(item.get("clothing") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            "location": sanitize_likely_utf8_mojibake(item.get("location") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            # Where this character stands *within* the current location, in a few words --
            # "за спиной госпожи", "в дверях", "у окна". `location` answers which place; this
            # answers where in the room, which is what the narrator keeps losing between
            # paragraphs when a bodyguard behind a chair turns up in the doorway.
            "position": sanitize_likely_utf8_mojibake(item.get("position") or "").replace("\r\n", "\n").strip()[:200].rstrip(),
            "equipment": sanitize_likely_utf8_mojibake(item.get("equipment") or item.get("inventory") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            "mood": sanitize_likely_utf8_mojibake(item.get("mood") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            "attitude_to_hero": sanitize_likely_utf8_mojibake(item.get("attitude_to_hero") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
            "personality": sanitize_likely_utf8_mojibake(item.get("personality") or "").replace("\r\n", "\n").strip()[:1000].rstrip(),
        }
        for lock_key in (
            "status_manual_override_turns",
            "clothing_manual_override_turns",
            "equipment_manual_override_turns",
            "mood_manual_override_turns",
            "attitude_to_hero_manual_override_turns",
        ):
            raw_lock_value = item.get(lock_key)
            if isinstance(raw_lock_value, int) and raw_lock_value > 0:
                normalized_card[lock_key] = raw_lock_value
        if normalized_card["world_card_id"] is None or not normalized_card["name"]:
            continue
        normalized_cards.append(normalized_card)
    return normalized_cards


def serialize_story_character_state_cards_payload(value: list[dict[str, Any]] | None) -> str:
    normalized_cards = deserialize_story_character_state_cards_payload(json.dumps(value or [], ensure_ascii=False))
    try:
        return json.dumps(normalized_cards, ensure_ascii=False)
    except (TypeError, ValueError):
        return "[]"


def serialize_story_ambient_profile(value: dict[str, Any] | None) -> str:
    if not isinstance(value, dict):
        return ""
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return ""


def deserialize_story_ambient_profile(raw_value: str | None) -> dict[str, Any] | None:
    if not raw_value:
        return None
    try:
        parsed = json.loads(raw_value)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return repair_likely_utf8_mojibake_deep(parsed)


def normalize_story_cover_scale(raw_value: float | int | str | None) -> float:
    return normalize_media_scale(
        raw_value,
        default=STORY_COVER_SCALE_DEFAULT,
        min_value=STORY_COVER_SCALE_MIN,
        max_value=STORY_COVER_SCALE_MAX,
    )


def normalize_story_cover_position(raw_value: float | int | str | None) -> float:
    return normalize_media_position(
        raw_value,
        default=STORY_IMAGE_POSITION_DEFAULT,
        min_value=STORY_IMAGE_POSITION_MIN,
        max_value=STORY_IMAGE_POSITION_MAX,
    )


def normalize_story_cover_image_url(raw_value: str | None, *, db: Session | None = None) -> str | None:
    normalized = normalize_avatar_value(raw_value)
    if normalized is None:
        return None
    if db is not None:
        normalized = normalize_avatar_value(resolve_media_storage_value(db, normalized))
        if normalized is None:
            return None
    return validate_avatar_url(normalized, max_bytes=STORY_COVER_MAX_BYTES, profile=PROFILE_COVER)


def story_game_rating_average(game: StoryGame) -> float:
    rating_count = max(int(game.community_rating_count or 0), 0)
    if rating_count <= 0:
        return 0.0
    rating_sum = max(int(game.community_rating_sum or 0), 0)
    return round(rating_sum / rating_count, 2)


_STORY_ENVIRONMENT_MONTH_NAMES_RU = (
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
)


def _story_environment_reference_datetime_from_weather(
    current_datetime,
    current_weather: dict[str, Any] | None,
):
    if isinstance(current_datetime, datetime):
        return current_datetime
    day_date = str((current_weather or {}).get("day_date") or "").strip()
    if not day_date:
        return None
    try:
        return datetime.fromisoformat(f"{day_date}T12:00")
    except ValueError:
        return None


def _story_environment_season_label_from_datetime(value) -> str:
    if not isinstance(value, datetime):
        return ""
    month = int(value.month)
    if month in {12, 1, 2}:
        return "зима"
    if month in {3, 4, 5}:
        return "весна"
    if month in {6, 7, 8}:
        return "лето"
    return "осень"


def _story_environment_month_label_from_datetime(value) -> str:
    if not isinstance(value, datetime):
        return ""
    return _STORY_ENVIRONMENT_MONTH_NAMES_RU[max(min(int(value.month), 12), 1) - 1]


def _story_environment_time_of_day_label_from_datetime(value) -> str:
    if not isinstance(value, datetime):
        return ""
    hour = int(value.hour)
    if 5 <= hour < 12:
        return "утро"
    if 12 <= hour < 18:
        return "день"
    if 18 <= hour < 23:
        return "вечер"
    return "ночь"


def _story_environment_clock_time_to_minutes(
    value: str | None,
    *,
    treat_midnight_as_end_of_day: bool = False,
) -> int | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        hours_text, minutes_text = normalized.split(":", 1)
        hours = int(hours_text)
        minutes = int(minutes_text)
    except (TypeError, ValueError):
        return None
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    total_minutes = hours * 60 + minutes
    if treat_midnight_as_end_of_day and total_minutes == 0:
        return 24 * 60
    return total_minutes


def resolve_story_environment_current_weather_for_output(
    game: StoryGame,
) -> dict[str, Any] | None:
    current_weather = deserialize_story_environment_weather(
        getattr(game, "environment_current_weather", None)
    )
    current_datetime = deserialize_story_environment_datetime(
        getattr(game, "environment_current_datetime", None)
    )
    if not isinstance(current_weather, dict):
        return current_weather

    reference_datetime = _story_environment_reference_datetime_from_weather(
        current_datetime,
        current_weather,
    )

    raw_timeline = current_weather.get("timeline")
    if not isinstance(raw_timeline, list):
        next_weather = dict(current_weather)
        if isinstance(reference_datetime, datetime):
            next_weather.setdefault("season", _story_environment_season_label_from_datetime(reference_datetime))
            next_weather.setdefault("month", _story_environment_month_label_from_datetime(reference_datetime))
            next_weather.setdefault("time_of_day", _story_environment_time_of_day_label_from_datetime(reference_datetime))
        return next_weather

    timeline_entries = [entry for entry in raw_timeline if isinstance(entry, dict)]
    if not timeline_entries:
        next_weather = dict(current_weather)
        if isinstance(reference_datetime, datetime):
            next_weather.setdefault("season", _story_environment_season_label_from_datetime(reference_datetime))
            next_weather.setdefault("month", _story_environment_month_label_from_datetime(reference_datetime))
            next_weather.setdefault("time_of_day", _story_environment_time_of_day_label_from_datetime(reference_datetime))
        return next_weather

    if not isinstance(reference_datetime, datetime):
        return current_weather

    timeline_entries.sort(
        key=lambda entry: _story_environment_clock_time_to_minutes(entry.get("start_time")) or 0
    )
    current_minutes = reference_datetime.hour * 60 + reference_datetime.minute
    fallback_entry = timeline_entries[-1]
    active_entry: dict[str, Any] | None = None

    for entry in timeline_entries:
        start_minutes = _story_environment_clock_time_to_minutes(entry.get("start_time"))
        end_minutes = _story_environment_clock_time_to_minutes(
            entry.get("end_time"),
            treat_midnight_as_end_of_day=(str(entry.get("start_time") or "").strip() != "00:00"),
        )
        if start_minutes is None or end_minutes is None:
            continue
        if current_minutes < start_minutes:
            active_entry = fallback_entry
            break
        if start_minutes <= current_minutes < end_minutes:
            active_entry = entry
            break
        fallback_entry = entry

    if active_entry is None:
        active_entry = fallback_entry

    next_weather = dict(current_weather)
    summary = str(active_entry.get("summary") or "").strip()
    if summary:
        next_weather["summary"] = summary
    temperature_c = active_entry.get("temperature_c")
    if isinstance(temperature_c, int):
        next_weather["temperature_c"] = temperature_c
    for field_name in ("fog", "humidity", "wind"):
        field_value = str(active_entry.get(field_name) or "").strip()
        if field_value:
            next_weather[field_name] = field_value
    next_weather.setdefault("season", _story_environment_season_label_from_datetime(reference_datetime))
    next_weather.setdefault("month", _story_environment_month_label_from_datetime(reference_datetime))
    next_weather.setdefault("time_of_day", _story_environment_time_of_day_label_from_datetime(reference_datetime))
    return next_weather


def count_story_completed_turns(messages: list[StoryMessage]) -> int:
    completed_turns = 0
    has_pending_user_turn = False

    for message in messages:
        if message.role == "user":
            has_pending_user_turn = True
            continue
        if message.role == "assistant" and has_pending_user_turn:
            completed_turns += 1
            has_pending_user_turn = False

    return completed_turns


def delete_story_game_with_relations(db: Session, *, game_id: int) -> StoryGame | None:
    db.execute(sa_delete(StorySummaryJob).where(StorySummaryJob.game_id == game_id))
    db.execute(sa_delete(StoryGraphEvent).where(StoryGraphEvent.game_id == game_id))
    db.execute(sa_delete(StoryGraphSuggestion).where(StoryGraphSuggestion.game_id == game_id))
    db.execute(sa_delete(StoryGraphEdge).where(StoryGraphEdge.game_id == game_id))
    db.execute(sa_delete(StoryGraphNode).where(StoryGraphNode.game_id == game_id))
    db.execute(sa_delete(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == game_id))
    db.execute(sa_delete(StoryPlotCardChangeEvent).where(StoryPlotCardChangeEvent.game_id == game_id))
    db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.game_id == game_id))
    db.execute(sa_delete(StorySceneBackground).where(StorySceneBackground.game_id == game_id))
    db.execute(sa_delete(StoryTurnImage).where(StoryTurnImage.game_id == game_id))
    db.execute(sa_delete(StoryMapImage).where(StoryMapImage.game_id == game_id))
    db.execute(sa_delete(StoryMemoryBlock).where(StoryMemoryBlock.game_id == game_id))
    db.execute(sa_delete(StoryCharacterStateSnapshot).where(StoryCharacterStateSnapshot.game_id == game_id))
    db.execute(sa_delete(StoryMessage).where(StoryMessage.game_id == game_id))
    db.execute(sa_delete(StoryInstructionCard).where(StoryInstructionCard.game_id == game_id))
    db.execute(sa_delete(StoryPlotCard).where(StoryPlotCard.game_id == game_id))
    db.execute(sa_delete(StoryWorldCard).where(StoryWorldCard.game_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldComment).where(StoryCommunityWorldComment.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldRating).where(StoryCommunityWorldRating.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldView).where(StoryCommunityWorldView.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldLaunch).where(StoryCommunityWorldLaunch.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldFavorite).where(StoryCommunityWorldFavorite.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldReport).where(StoryCommunityWorldReport.world_id == game_id))

    game = db.scalar(select(StoryGame).where(StoryGame.id == game_id))
    if game is not None:
        db.delete(game)
    return game


def story_game_summary_to_out(
    game: StoryGame,
    *,
    latest_message_preview: str | None = None,
    turn_count: int = 0,
) -> StoryGameSummaryOut:
    cover_image_url = resolve_media_display_url(
        getattr(game, "cover_image_url", None),
        kind="story-game-cover",
        entity_id=int(game.id),
        version=getattr(game, "updated_at", None),
    )
    current_weather = resolve_story_environment_current_weather_for_output(game)
    normalized_story_model = coerce_story_llm_model(getattr(game, "story_llm_model", None))
    environment_time_enabled = normalize_story_environment_time_enabled(
        getattr(game, "environment_time_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )
    environment_weather_enabled = normalize_story_environment_weather_enabled(
        getattr(game, "environment_weather_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )
    return StoryGameSummaryOut(
        id=game.id,
        title=sanitize_likely_utf8_mojibake(game.title),
        description=sanitize_likely_utf8_mojibake(game.description).strip(),
        latest_message_preview=sanitize_likely_utf8_mojibake(latest_message_preview) or None,
        turn_count=max(int(turn_count or 0), 0),
        opening_scene=sanitize_likely_utf8_mojibake(game.opening_scene).strip(),
        visibility=coerce_story_game_visibility(game.visibility),
        publication=_story_publication_state_out(game),
        age_rating=coerce_story_game_age_rating(game.age_rating),
        genres=deserialize_story_game_genres(game.genres),
        cover_image_url=cover_image_url,
        cover_scale=normalize_story_cover_scale(game.cover_scale),
        cover_position_x=normalize_story_cover_position(game.cover_position_x),
        cover_position_y=normalize_story_cover_position(game.cover_position_y),
        source_world_id=game.source_world_id,
        community_views=max(int(game.community_views or 0), 0),
        community_launches=max(int(game.community_launches or 0), 0),
        community_rating_avg=story_game_rating_average(game),
        community_rating_count=max(int(game.community_rating_count or 0), 0),
        context_limit_chars=normalize_story_context_limit_chars(
            getattr(game, "context_limit_chars", None),
            model_name=normalized_story_model,
        ),
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        response_token_limit_enabled=normalize_story_response_token_limit_enabled(
            getattr(game, "response_token_limit_enabled", None)
        ),
        story_llm_model=normalized_story_model,
        story_reasoning_enabled=normalize_story_reasoning_enabled(
            getattr(game, "story_reasoning_enabled", None),
            model_name=normalized_story_model,
        ),
        image_model=coerce_story_image_model(getattr(game, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(game, "image_style_prompt", None)),
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(
            getattr(game, "memory_optimization_enabled", None)
        ),
        memory_optimization_mode=normalize_story_memory_optimization_mode(
            getattr(game, "memory_optimization_mode", None)
        ),
        story_repetition_penalty=normalize_story_repetition_penalty(
            getattr(game, "story_repetition_penalty", None),
            model_name=normalized_story_model,
        ),
        story_top_k=normalize_story_top_k(getattr(game, "story_top_k", None), model_name=normalized_story_model),
        story_top_r=normalize_story_top_r(getattr(game, "story_top_r", None), model_name=normalized_story_model),
        story_temperature=normalize_story_temperature(
            getattr(game, "story_temperature", None),
            model_name=normalized_story_model,
        ),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(game, "show_npc_thoughts", None)),
        active_main_hero_card_id=(
            int(getattr(game, "active_main_hero_card_id", 0) or 0) or None
        ),
        auto_npc_cards_enabled=bool(getattr(game, "auto_npc_cards_enabled", False)),
        auto_graph_nodes_enabled=normalize_story_auto_graph_nodes_enabled(
            getattr(game, "auto_graph_nodes_enabled", None)
        ),
        auto_graph_edges_enabled=normalize_story_auto_graph_edges_enabled(
            getattr(game, "auto_graph_edges_enabled", None)
        ),
        graph_confirm_low_confidence=normalize_story_graph_confirm_low_confidence(
            getattr(game, "graph_confirm_low_confidence", None)
        ),
        graph_auto_apply_confidence=normalize_story_graph_auto_apply_confidence(
            getattr(game, "graph_auto_apply_confidence", None)
        ),
        accelerated_service_enabled=False,
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        game_mode=normalize_story_game_mode(getattr(game, "game_mode", None)),
        character_state_enabled=normalize_story_character_state_enabled(
            getattr(game, "character_state_enabled", None)
        ),
        location_module_enabled=normalize_story_location_module_enabled(
            getattr(game, "location_module_enabled", None)
        ),
        appearance_background_mode=normalize_story_appearance_background_mode(
            getattr(game, "appearance_background_mode", None)
        ),
        appearance_gradient_enabled=normalize_story_appearance_gradient_enabled(
            getattr(game, "appearance_gradient_enabled", None)
        ),
        appearance_dialogue_view=normalize_story_appearance_dialogue_view(
            getattr(game, "appearance_dialogue_view", None)
        ),
        appearance_gradient_from=normalize_story_appearance_color(
            getattr(game, "appearance_gradient_from", None),
            default=STORY_APPEARANCE_DEFAULT_GRADIENT_FROM,
        ),
        appearance_gradient_to=normalize_story_appearance_color(
            getattr(game, "appearance_gradient_to", None),
            default=STORY_APPEARANCE_DEFAULT_GRADIENT_TO,
        ),
        appearance_solid_color=normalize_story_appearance_color(
            getattr(game, "appearance_solid_color", None),
            default=STORY_APPEARANCE_DEFAULT_SOLID_COLOR,
        ),
        appearance_ui_style=normalize_story_appearance_ui_style(getattr(game, "appearance_ui_style", None)),
        appearance_text_style=normalize_story_appearance_text_style(getattr(game, "appearance_text_style", None)),
        canonical_state_pipeline_enabled=normalize_story_canonical_state_pipeline_enabled(
            getattr(game, "canonical_state_pipeline_enabled", None)
        ),
        canonical_state_safe_fallback_enabled=normalize_story_canonical_state_safe_fallback_enabled(
            getattr(game, "canonical_state_safe_fallback_enabled", None)
        ),
        environment_enabled=environment_time_enabled or environment_weather_enabled,
        environment_time_enabled=environment_time_enabled,
        environment_weather_enabled=environment_weather_enabled,
        ambient_profile=deserialize_story_ambient_profile(getattr(game, "ambient_profile", None)),
        environment_current_datetime=serialize_story_environment_datetime(
            deserialize_story_environment_datetime(getattr(game, "environment_current_datetime", None))
        ),
        environment_current_weather=current_weather,
        environment_tomorrow_weather=deserialize_story_environment_weather(
            getattr(game, "environment_tomorrow_weather", None)
        ),
        current_location_label=sanitize_likely_utf8_mojibake(
            str(getattr(game, "current_location_label", "") or "").strip()
        )
        or None,
        current_location_manual_override_label=sanitize_likely_utf8_mojibake(
            str(getattr(game, "current_location_manual_override_label", "") or "").strip()
        )
        or None,
        last_activity_at=game.last_activity_at,
        created_at=game.created_at,
        updated_at=game.updated_at,
    )


def mask_story_game_admin_only_state(
    summary: StoryGameSummaryOut,
    *,
    include_character_state: bool = False,
    include_story_map: bool = False,
) -> StoryGameSummaryOut:
    updates: dict[str, Any] = {}
    if not include_character_state:
        updates["character_state_enabled"] = False
    if not include_story_map:
        updates["current_location_label"] = None
    updates["game_mode"] = STORY_GAME_MODE_RPG
    if not updates:
        return summary
    return summary.model_copy(update=updates)


def story_game_summary_to_compact_out(
    game: StoryGame,
    *,
    latest_message_preview: str | None = None,
    turn_count: int = 0,
) -> StoryGameSummaryOut:
    cover_image_url = resolve_media_display_url(
        getattr(game, "cover_image_url", None),
        kind="story-game-cover",
        entity_id=int(game.id),
        version=getattr(game, "updated_at", None),
    )
    current_weather = resolve_story_environment_current_weather_for_output(game)
    normalized_story_model = coerce_story_llm_model(getattr(game, "story_llm_model", None))
    environment_time_enabled = normalize_story_environment_time_enabled(
        getattr(game, "environment_time_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )
    environment_weather_enabled = normalize_story_environment_weather_enabled(
        getattr(game, "environment_weather_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )
    return StoryGameSummaryOut(
        id=game.id,
        title=sanitize_likely_utf8_mojibake(game.title),
        description=sanitize_likely_utf8_mojibake(game.description).strip(),
        latest_message_preview=sanitize_likely_utf8_mojibake(latest_message_preview) or None,
        turn_count=max(int(turn_count or 0), 0),
        opening_scene="",
        visibility=coerce_story_game_visibility(game.visibility),
        publication=_story_publication_state_out(game),
        age_rating=coerce_story_game_age_rating(game.age_rating),
        genres=deserialize_story_game_genres(game.genres),
        cover_image_url=cover_image_url,
        cover_scale=normalize_story_cover_scale(game.cover_scale),
        cover_position_x=normalize_story_cover_position(game.cover_position_x),
        cover_position_y=normalize_story_cover_position(game.cover_position_y),
        source_world_id=game.source_world_id,
        community_views=max(int(game.community_views or 0), 0),
        community_launches=max(int(game.community_launches or 0), 0),
        community_rating_avg=story_game_rating_average(game),
        community_rating_count=max(int(game.community_rating_count or 0), 0),
        context_limit_chars=normalize_story_context_limit_chars(
            getattr(game, "context_limit_chars", None),
            model_name=normalized_story_model,
        ),
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        response_token_limit_enabled=normalize_story_response_token_limit_enabled(
            getattr(game, "response_token_limit_enabled", None)
        ),
        story_llm_model=normalized_story_model,
        story_reasoning_enabled=normalize_story_reasoning_enabled(
            getattr(game, "story_reasoning_enabled", None),
            model_name=normalized_story_model,
        ),
        image_model=coerce_story_image_model(getattr(game, "image_model", None)),
        image_style_prompt="",
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(
            getattr(game, "memory_optimization_enabled", None)
        ),
        memory_optimization_mode=normalize_story_memory_optimization_mode(
            getattr(game, "memory_optimization_mode", None)
        ),
        story_repetition_penalty=normalize_story_repetition_penalty(
            getattr(game, "story_repetition_penalty", None),
            model_name=normalized_story_model,
        ),
        story_top_k=normalize_story_top_k(getattr(game, "story_top_k", None), model_name=normalized_story_model),
        story_top_r=normalize_story_top_r(getattr(game, "story_top_r", None), model_name=normalized_story_model),
        story_temperature=normalize_story_temperature(
            getattr(game, "story_temperature", None),
            model_name=normalized_story_model,
        ),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(game, "show_npc_thoughts", None)),
        active_main_hero_card_id=(
            int(getattr(game, "active_main_hero_card_id", 0) or 0) or None
        ),
        auto_npc_cards_enabled=bool(getattr(game, "auto_npc_cards_enabled", False)),
        auto_graph_nodes_enabled=normalize_story_auto_graph_nodes_enabled(
            getattr(game, "auto_graph_nodes_enabled", None)
        ),
        auto_graph_edges_enabled=normalize_story_auto_graph_edges_enabled(
            getattr(game, "auto_graph_edges_enabled", None)
        ),
        graph_confirm_low_confidence=normalize_story_graph_confirm_low_confidence(
            getattr(game, "graph_confirm_low_confidence", None)
        ),
        graph_auto_apply_confidence=normalize_story_graph_auto_apply_confidence(
            getattr(game, "graph_auto_apply_confidence", None)
        ),
        accelerated_service_enabled=False,
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        game_mode=normalize_story_game_mode(getattr(game, "game_mode", None)),
        character_state_enabled=normalize_story_character_state_enabled(
            getattr(game, "character_state_enabled", None)
        ),
        location_module_enabled=normalize_story_location_module_enabled(
            getattr(game, "location_module_enabled", None)
        ),
        appearance_background_mode=normalize_story_appearance_background_mode(
            getattr(game, "appearance_background_mode", None)
        ),
        appearance_gradient_enabled=normalize_story_appearance_gradient_enabled(
            getattr(game, "appearance_gradient_enabled", None)
        ),
        appearance_dialogue_view=normalize_story_appearance_dialogue_view(
            getattr(game, "appearance_dialogue_view", None)
        ),
        appearance_gradient_from=normalize_story_appearance_color(
            getattr(game, "appearance_gradient_from", None),
            default=STORY_APPEARANCE_DEFAULT_GRADIENT_FROM,
        ),
        appearance_gradient_to=normalize_story_appearance_color(
            getattr(game, "appearance_gradient_to", None),
            default=STORY_APPEARANCE_DEFAULT_GRADIENT_TO,
        ),
        appearance_solid_color=normalize_story_appearance_color(
            getattr(game, "appearance_solid_color", None),
            default=STORY_APPEARANCE_DEFAULT_SOLID_COLOR,
        ),
        appearance_ui_style=normalize_story_appearance_ui_style(getattr(game, "appearance_ui_style", None)),
        appearance_text_style=normalize_story_appearance_text_style(getattr(game, "appearance_text_style", None)),
        canonical_state_pipeline_enabled=normalize_story_canonical_state_pipeline_enabled(
            getattr(game, "canonical_state_pipeline_enabled", None)
        ),
        canonical_state_safe_fallback_enabled=normalize_story_canonical_state_safe_fallback_enabled(
            getattr(game, "canonical_state_safe_fallback_enabled", None)
        ),
        environment_enabled=environment_time_enabled or environment_weather_enabled,
        environment_time_enabled=environment_time_enabled,
        environment_weather_enabled=environment_weather_enabled,
        ambient_profile=None,
        environment_current_datetime=serialize_story_environment_datetime(
            deserialize_story_environment_datetime(getattr(game, "environment_current_datetime", None))
        ),
        environment_current_weather=current_weather,
        environment_tomorrow_weather=deserialize_story_environment_weather(
            getattr(game, "environment_tomorrow_weather", None)
        ),
        current_location_label=str(getattr(game, "current_location_label", "") or "").strip() or None,
        current_location_manual_override_label=str(
            getattr(game, "current_location_manual_override_label", "") or ""
        ).strip()
        or None,
        last_activity_at=game.last_activity_at,
        created_at=game.created_at,
        updated_at=game.updated_at,
    )


def story_author_name(user: User | None) -> str:
    if user is None:
        return "Unknown"
    if user.display_name and user.display_name.strip():
        return sanitize_likely_utf8_mojibake(user.display_name).strip()
    return sanitize_likely_utf8_mojibake(user.email.split("@", maxsplit=1)[0]).strip()


def story_author_avatar_url(user: User | None) -> str | None:
    if user is None:
        return None
    return resolve_media_display_url(
        getattr(user, "avatar_url", None),
        kind="user-avatar",
        entity_id=int(user.id),
        version=getattr(user, "updated_at", None),
    )


def story_author_avatar_frame_id(user: User | None) -> str:
    if user is None:
        return "none"
    normalized = str(getattr(user, "avatar_frame_id", "") or "").strip()
    return normalized or "none"


def story_author_avatar_frame_image_url(db: Session, user: User | None) -> str | None:
    if user is None:
        return None
    return resolve_cosmetic_image_url_by_selection_id(
        db,
        value=story_author_avatar_frame_id(user),
        kind=COSMETIC_KIND_AVATAR_FRAME,
    )


def story_community_world_summary_to_out(
    world: StoryGame,
    *,
    author_id: int,
    author_name: str,
    author_avatar_url: str | None,
    user_rating: int | None = None,
    author_avatar_frame_id: str = "none",
    author_avatar_frame_image_url: str | None = None,
    is_reported_by_user: bool = False,
    is_favorited_by_user: bool = False,
) -> StoryCommunityWorldSummaryOut:
    return StoryCommunityWorldSummaryOut(
        id=world.id,
        title=sanitize_likely_utf8_mojibake(world.title),
        description=sanitize_likely_utf8_mojibake(world.description).strip(),
        author_id=author_id,
        author_name=sanitize_likely_utf8_mojibake(author_name).strip(),
        author_avatar_url=author_avatar_url,
        author_avatar_frame_id=str(author_avatar_frame_id or "none").strip() or "none",
        author_avatar_frame_image_url=author_avatar_frame_image_url,
        age_rating=coerce_story_game_age_rating(getattr(world, "age_rating", None)),
        genres=deserialize_story_game_genres(getattr(world, "genres", None)),
        cover_image_url=resolve_media_display_url(
            getattr(world, "cover_image_url", None),
            kind="story-game-cover",
            entity_id=int(world.id),
            version=getattr(world, "updated_at", None),
        ),
        cover_scale=normalize_story_cover_scale(getattr(world, "cover_scale", None)),
        cover_position_x=normalize_story_cover_position(getattr(world, "cover_position_x", None)),
        cover_position_y=normalize_story_cover_position(getattr(world, "cover_position_y", None)),
        community_views=max(int(getattr(world, "community_views", 0) or 0), 0),
        community_launches=max(int(getattr(world, "community_launches", 0) or 0), 0),
        community_rating_avg=story_game_rating_average(world),
        community_rating_count=max(int(getattr(world, "community_rating_count", 0) or 0), 0),
        user_rating=user_rating,
        is_reported_by_user=bool(is_reported_by_user),
        is_favorited_by_user=bool(is_favorited_by_user),
        created_at=world.created_at,
        updated_at=world.updated_at,
    )


def _normalize_story_world_card_kind(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized in STORY_WORLD_CARD_KINDS:
        return normalized
    return STORY_WORLD_CARD_KIND_WORLD


def _normalize_story_world_card_source(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized == STORY_WORLD_CARD_SOURCE_AI:
        return STORY_WORLD_CARD_SOURCE_AI
    return STORY_WORLD_CARD_SOURCE_USER


def _normalize_story_world_card_memory_turns_for_storage(raw_value: int | None, *, kind: str) -> int:
    normalized_kind = _normalize_story_world_card_kind(kind)
    if normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_WORLD_PROFILE}:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if raw_value is None:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    parsed_value = int(raw_value)
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if parsed_value <= STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
        return STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
    return parsed_value


def _coerce_story_plot_card_enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return True


def _serialize_story_public_cards_snapshot(items: list[dict[str, Any]]) -> str:
    return json.dumps(items, ensure_ascii=False, separators=(",", ":"))


def _deserialize_story_public_cards_snapshot(raw_value: str | None) -> list[dict[str, Any]] | None:
    if not raw_value:
        return None
    try:
        loaded = json.loads(raw_value)
    except (TypeError, ValueError):
        return None
    if not isinstance(loaded, list):
        return None
    if not all(isinstance(item, dict) for item in loaded):
        return None
    return loaded


def _load_story_public_instruction_cards_snapshot(raw_value: str | None) -> list[StoryInstructionCardOut] | None:
    loaded = _deserialize_story_public_cards_snapshot(raw_value)
    if loaded is None:
        return None
    try:
        return [StoryInstructionCardOut.model_validate(item) for item in loaded]
    except Exception:
        return None


def _load_story_public_plot_cards_snapshot(raw_value: str | None) -> list[StoryPlotCardOut] | None:
    loaded = _deserialize_story_public_cards_snapshot(raw_value)
    if loaded is None:
        return None
    try:
        return [StoryPlotCardOut.model_validate(item) for item in loaded]
    except Exception:
        return None


def _load_story_public_world_cards_snapshot(raw_value: str | None) -> list[StoryWorldCardOut] | None:
    loaded = _deserialize_story_public_cards_snapshot(raw_value)
    if loaded is None:
        return None
    try:
        return [StoryWorldCardOut.model_validate(item) for item in loaded]
    except Exception:
        return None


def _filter_story_public_world_cards_for_publication(
    cards: list[StoryWorldCardOut],
    *,
    is_public_world: bool,
) -> list[StoryWorldCardOut]:
    if not is_public_world:
        return cards
    return [
        card
        for card in cards
        if _normalize_story_world_card_kind(getattr(card, "kind", None)) != STORY_WORLD_CARD_KIND_MAIN_HERO
    ]


def refresh_story_game_public_card_snapshots(db: Session, game: StoryGame) -> None:
    instruction_cards_snapshot = [
        StoryInstructionCardOut.model_validate(card).model_dump(mode="json")
        for card in list_story_instruction_cards(db, game.id)
    ]
    plot_cards_snapshot = [
        story_plot_card_to_out(card).model_dump(mode="json")
        for card in list_story_plot_cards(db, game.id)
    ]
    is_public_world = coerce_story_game_visibility(getattr(game, "visibility", None)) == STORY_GAME_VISIBILITY_PUBLIC
    world_cards_out = _filter_story_public_world_cards_for_publication(
        [story_world_card_to_out(card) for card in list_story_world_cards(db, game.id)],
        is_public_world=is_public_world,
    )
    world_cards_snapshot = [
        card.model_dump(mode="json")
        for card in world_cards_out
    ]
    game.published_instruction_cards_snapshot = _serialize_story_public_cards_snapshot(instruction_cards_snapshot)
    game.published_plot_cards_snapshot = _serialize_story_public_cards_snapshot(plot_cards_snapshot)
    game.published_world_cards_snapshot = _serialize_story_public_cards_snapshot(world_cards_snapshot)


def get_story_game_public_cards_out(
    db: Session,
    game: StoryGame,
) -> tuple[list[StoryInstructionCardOut], list[StoryPlotCardOut], list[StoryWorldCardOut]]:
    is_public_world = coerce_story_game_visibility(getattr(game, "visibility", None)) == STORY_GAME_VISIBILITY_PUBLIC
    instruction_cards_snapshot = _load_story_public_instruction_cards_snapshot(
        getattr(game, "published_instruction_cards_snapshot", None)
    )
    plot_cards_snapshot = _load_story_public_plot_cards_snapshot(
        getattr(game, "published_plot_cards_snapshot", None)
    )
    world_cards_snapshot = _load_story_public_world_cards_snapshot(
        getattr(game, "published_world_cards_snapshot", None)
    )
    if (
        instruction_cards_snapshot is not None
        and plot_cards_snapshot is not None
        and world_cards_snapshot is not None
    ):
        return (
            instruction_cards_snapshot,
            plot_cards_snapshot,
            _filter_story_public_world_cards_for_publication(world_cards_snapshot, is_public_world=is_public_world),
        )

    instruction_cards = [
        StoryInstructionCardOut.model_validate(card)
        for card in list_story_instruction_cards(db, game.id)
    ]
    plot_cards = [
        story_plot_card_to_out(card)
        for card in list_story_plot_cards(db, game.id)
    ]
    world_cards = _filter_story_public_world_cards_for_publication(
        [story_world_card_to_out(card) for card in list_story_world_cards(db, game.id)],
        is_public_world=is_public_world,
    )
    return instruction_cards, plot_cards, world_cards


def ensure_story_game_public_card_snapshots(db: Session, game: StoryGame) -> bool:
    is_public_world = coerce_story_game_visibility(getattr(game, "visibility", None)) == STORY_GAME_VISIBILITY_PUBLIC
    instruction_cards_snapshot = _load_story_public_instruction_cards_snapshot(
        getattr(game, "published_instruction_cards_snapshot", None)
    )
    plot_cards_snapshot = _load_story_public_plot_cards_snapshot(
        getattr(game, "published_plot_cards_snapshot", None)
    )
    world_cards_snapshot = _load_story_public_world_cards_snapshot(
        getattr(game, "published_world_cards_snapshot", None)
    )
    if (
        instruction_cards_snapshot is not None
        and plot_cards_snapshot is not None
        and world_cards_snapshot is not None
    ):
        filtered_world_cards_snapshot = _filter_story_public_world_cards_for_publication(
            world_cards_snapshot,
            is_public_world=is_public_world,
        )
        if (
            len(instruction_cards_snapshot) == 0
            and len(plot_cards_snapshot) == 0
            and len(filtered_world_cards_snapshot) == 0
        ):
            has_live_instruction_cards = len(list_story_instruction_cards(db, game.id)) > 0
            has_live_plot_cards = len(list_story_plot_cards(db, game.id)) > 0
            if is_public_world:
                has_live_world_cards = any(
                    _normalize_story_world_card_kind(getattr(card, "kind", None)) != STORY_WORLD_CARD_KIND_MAIN_HERO
                    for card in list_story_world_cards(db, game.id)
                )
            else:
                has_live_world_cards = len(list_story_world_cards(db, game.id)) > 0
            if has_live_instruction_cards or has_live_plot_cards or has_live_world_cards:
                refresh_story_game_public_card_snapshots(db, game)
                return True
        return False
    refresh_story_game_public_card_snapshots(db, game)
    return True


def clone_story_world_cards_to_game(
    db: Session,
    *,
    source_world_id: int,
    target_game_id: int,
    copy_instructions: bool = True,
    copy_plot: bool = True,
    copy_world: bool = True,
    copy_main_hero: bool = True,
    source_instruction_cards_out: list[StoryInstructionCardOut] | None = None,
    source_plot_cards_out: list[StoryPlotCardOut] | None = None,
    source_world_cards_out: list[StoryWorldCardOut] | None = None,
) -> dict[tuple[str, int], int]:
    cloned_card_pairs: list[tuple[str, int, Any]] = []
    if copy_instructions:
        if source_instruction_cards_out is None:
            source_instruction_cards = list_story_instruction_cards(db, source_world_id)
            for card in source_instruction_cards:
                cloned_instruction = StoryInstructionCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
                    is_active=bool(getattr(card, "is_active", True)),
                )
                db.add(cloned_instruction)
                cloned_card_pairs.append(("instruction_card", int(card.id), cloned_instruction))
        else:
            for card in source_instruction_cards_out:
                cloned_instruction = StoryInstructionCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
                    is_active=bool(getattr(card, "is_active", True)),
                )
                db.add(cloned_instruction)
                cloned_card_pairs.append(("instruction_card", int(card.id), cloned_instruction))

    if copy_plot:
        if source_plot_cards_out is None:
            source_plot_cards = list_story_plot_cards(db, source_world_id)
            for card in source_plot_cards:
                cloned_plot = StoryPlotCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
                    triggers=serialize_story_plot_card_triggers(
                        normalize_story_plot_card_triggers(
                            deserialize_story_plot_card_triggers(str(getattr(card, "triggers", "") or "")),
                            fallback_title=card.title,
                        )
                    ),
                    memory_turns=normalize_story_plot_card_memory_turns_for_storage(
                        getattr(card, "memory_turns", None),
                        explicit=False,
                        current_value=getattr(card, "memory_turns", None),
                    ),
                    ai_edit_enabled=bool(getattr(card, "ai_edit_enabled", True)),
                    is_enabled=_coerce_story_plot_card_enabled(getattr(card, "is_enabled", True)),
                    source=normalize_story_plot_card_source(getattr(card, "source", "")),
                )
                db.add(cloned_plot)
                cloned_card_pairs.append(("plot_card", int(card.id), cloned_plot))
        else:
            for card in source_plot_cards_out:
                cloned_plot = StoryPlotCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
                    triggers=serialize_story_plot_card_triggers(
                        normalize_story_plot_card_triggers(
                            list(card.triggers),
                            fallback_title=card.title,
                        )
                    ),
                    memory_turns=normalize_story_plot_card_memory_turns_for_storage(
                        card.memory_turns,
                        explicit=True,
                        current_value=None,
                    ),
                    ai_edit_enabled=bool(card.ai_edit_enabled),
                    is_enabled=_coerce_story_plot_card_enabled(card.is_enabled),
                    source=normalize_story_plot_card_source(card.source),
                )
                db.add(cloned_plot)
                cloned_card_pairs.append(("plot_card", int(card.id), cloned_plot))

    if source_world_cards_out is None:
        source_world_cards = list_story_world_cards(db, source_world_id)
        for card in source_world_cards:
            card_kind = _normalize_story_world_card_kind(card.kind)
            if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO and not copy_main_hero:
                continue
            if card_kind != STORY_WORLD_CARD_KIND_MAIN_HERO and not copy_world:
                continue
            cloned_world_card = StoryWorldCard(
                game_id=target_game_id,
                title=card.title,
                content=card.content,
                race=normalize_story_character_race(getattr(card, "race", "")),
                clothing=normalize_story_character_clothing(getattr(card, "clothing", "")),
                inventory=normalize_story_character_inventory(getattr(card, "inventory", "")),
                health_status=normalize_story_character_health_status(getattr(card, "health_status", "")),
                triggers=card.triggers,
                name_color=normalize_story_character_text_color(getattr(card, "name_color", "")),
                speech_color=normalize_story_character_text_color(getattr(card, "speech_color", "")),
                bubble_color=normalize_story_character_text_color(getattr(card, "bubble_color", "")),
                thought_bubble_color=normalize_story_character_text_color(getattr(card, "thought_bubble_color", "")),
                kind=card_kind,
                detail_type=" ".join(str(getattr(card, "detail_type", "") or "").replace("\r\n", " ").split()).strip(),
                avatar_url=normalize_story_character_avatar_url(card.avatar_url, db=db),
                avatar_original_url=(
                    normalize_story_character_avatar_original_url(
                        getattr(card, "avatar_original_url", None),
                        db=db,
                    )
                    if getattr(card, "avatar_url", None)
                    else None
                ),
                avatar_scale=normalize_story_avatar_scale(card.avatar_scale),
                character_id=None,
                memory_turns=_normalize_story_world_card_memory_turns_for_storage(card.memory_turns, kind=card_kind),
                is_locked=bool(card.is_locked),
                ai_edit_enabled=bool(card.ai_edit_enabled),
                source=_normalize_story_world_card_source(card.source),
            )
            db.add(cloned_world_card)
            cloned_card_pairs.append(("world_card", int(card.id), cloned_world_card))
    else:
        for card in source_world_cards_out:
            card_kind = _normalize_story_world_card_kind(card.kind)
            if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO and not copy_main_hero:
                continue
            if card_kind != STORY_WORLD_CARD_KIND_MAIN_HERO and not copy_world:
                continue
            cloned_world_card = StoryWorldCard(
                game_id=target_game_id,
                title=card.title,
                content=card.content,
                race=normalize_story_character_race(getattr(card, "race", "")),
                clothing=normalize_story_character_clothing(getattr(card, "clothing", "")),
                inventory=normalize_story_character_inventory(getattr(card, "inventory", "")),
                health_status=normalize_story_character_health_status(getattr(card, "health_status", "")),
                triggers=serialize_story_world_card_triggers(
                    normalize_story_world_card_triggers(
                        list(card.triggers),
                        fallback_title=card.title,
                    )
                ),
                name_color=normalize_story_character_text_color(getattr(card, "name_color", "")),
                speech_color=normalize_story_character_text_color(getattr(card, "speech_color", "")),
                bubble_color=normalize_story_character_text_color(getattr(card, "bubble_color", "")),
                thought_bubble_color=normalize_story_character_text_color(getattr(card, "thought_bubble_color", "")),
                kind=card_kind,
                detail_type=" ".join(str(getattr(card, "detail_type", "") or "").replace("\r\n", " ").split()).strip(),
                avatar_url=normalize_story_character_avatar_url(card.avatar_url, db=db),
                avatar_original_url=(
                    normalize_story_character_avatar_original_url(
                        getattr(card, "avatar_original_url", None),
                        db=db,
                    )
                    if getattr(card, "avatar_url", None)
                    else None
                ),
                avatar_scale=normalize_story_avatar_scale(card.avatar_scale),
                character_id=None,
                memory_turns=_normalize_story_world_card_memory_turns_for_storage(card.memory_turns, kind=card_kind),
                is_locked=bool(card.is_locked),
                ai_edit_enabled=bool(card.ai_edit_enabled),
                source=_normalize_story_world_card_source(card.source),
            )
            db.add(cloned_world_card)
            cloned_card_pairs.append(("world_card", int(card.id), cloned_world_card))

    if not cloned_card_pairs:
        return {}
    db.flush()
    return {
        (card_type, source_card_id): int(cloned_card.id)
        for card_type, source_card_id, cloned_card in cloned_card_pairs
    }


def clone_story_graph_to_game(
    db: Session,
    *,
    source_game_id: int,
    target_game_id: int,
    card_id_map: dict[tuple[str, int], int],
    message_id_map: dict[int, int] | None = None,
) -> tuple[int, int]:
    """Clone active graph nodes and edges without leaving cross-game references."""

    if not card_id_map:
        return (0, 0)

    turn_id_map = message_id_map or {}
    source_nodes = db.scalars(
        select(StoryGraphNode)
        .where(
            StoryGraphNode.game_id == int(source_game_id),
            StoryGraphNode.undone_at.is_(None),
        )
        .order_by(StoryGraphNode.id.asc())
    ).all()
    cloned_node_pairs: list[tuple[StoryGraphNode, StoryGraphNode]] = []
    for source_node in source_nodes:
        card_key = (str(source_node.card_type or ""), int(source_node.card_id))
        target_card_id = card_id_map.get(card_key)
        if target_card_id is None:
            continue
        source_turn_id = getattr(source_node, "source_turn_id", None)
        cloned_node = StoryGraphNode(
            game_id=int(target_game_id),
            card_type=card_key[0],
            card_id=int(target_card_id),
            x=float(source_node.x),
            y=float(source_node.y),
            width=float(source_node.width),
            height=float(source_node.height),
            collapsed=bool(source_node.collapsed),
            color=str(source_node.color or ""),
            created_by=str(source_node.created_by or "user"),
            source_turn_id=(
                turn_id_map.get(int(source_turn_id))
                if source_turn_id is not None
                else None
            ),
        )
        db.add(cloned_node)
        cloned_node_pairs.append((source_node, cloned_node))

    if not cloned_node_pairs:
        return (0, 0)
    db.flush()
    node_id_map = {
        int(source_node.id): int(cloned_node.id)
        for source_node, cloned_node in cloned_node_pairs
    }

    source_edges = db.scalars(
        select(StoryGraphEdge)
        .where(
            StoryGraphEdge.game_id == int(source_game_id),
            StoryGraphEdge.undone_at.is_(None),
        )
        .order_by(StoryGraphEdge.id.asc())
    ).all()
    cloned_edge_count = 0
    for source_edge in source_edges:
        target_source_node_id = node_id_map.get(int(source_edge.source_node_id))
        target_target_node_id = node_id_map.get(int(source_edge.target_node_id))
        target_source_card_id = card_id_map.get(
            (str(source_edge.source_card_type or ""), int(source_edge.source_card_id))
        )
        target_target_card_id = card_id_map.get(
            (str(source_edge.target_card_type or ""), int(source_edge.target_card_id))
        )
        if (
            target_source_node_id is None
            or target_target_node_id is None
            or target_source_card_id is None
            or target_target_card_id is None
        ):
            continue
        source_turn_id = getattr(source_edge, "source_turn_id", None)
        db.add(
            StoryGraphEdge(
                game_id=int(target_game_id),
                source_node_id=target_source_node_id,
                target_node_id=target_target_node_id,
                source_card_type=str(source_edge.source_card_type or ""),
                source_card_id=int(target_source_card_id),
                target_card_type=str(source_edge.target_card_type or ""),
                target_card_id=int(target_target_card_id),
                relation_type=str(source_edge.relation_type or "custom"),
                label=str(source_edge.label or ""),
                description=str(source_edge.description or ""),
                direction=str(source_edge.direction or "directed"),
                scope=str(source_edge.scope or "both"),
                importance=int(source_edge.importance),
                active=bool(source_edge.active),
                created_by=str(source_edge.created_by or "user"),
                confidence=source_edge.confidence,
                source_turn_id=(
                    turn_id_map.get(int(source_turn_id))
                    if source_turn_id is not None
                    else None
                ),
            )
        )
        cloned_edge_count += 1

    if cloned_edge_count:
        db.flush()
    return (len(cloned_node_pairs), cloned_edge_count)
