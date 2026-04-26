from __future__ import annotations
from datetime import datetime
import json
import math
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacterStateSnapshot,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMapImage,
    StoryMemoryBlock,
    StoryMessage,
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
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_race,
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
STORY_CONTEXT_LIMIT_MAX_TOKENS = 32_000
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
STORY_RESPONSE_MAX_TOKENS_MIN = 200
STORY_RESPONSE_MAX_TOKENS_MAX = 800
STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
STORY_REPETITION_PENALTY_MIN = 1.0
STORY_REPETITION_PENALTY_MAX = 2.0
STORY_DEFAULT_REPETITION_PENALTY = 1.05
STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX = 6_000
STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX = 16_000
STORY_TURN_COST_TIER_3_CONTEXT_LIMIT_MAX = 32_000
STORY_TURN_COST_STANDARD_TIERS = (1, 2, 4)
STORY_TURN_COST_PREMIUM_TIERS = (2, 4, 8)
STORY_TURN_COST_GLM51_TIERS = (3, 6, 12)
STORY_ENVIRONMENT_TIME_MODE_GROK = "grok"
STORY_ENVIRONMENT_TURN_STEP_MINUTES_DEFAULT = 3
STORY_LLM_MODEL_GLM5 = "z-ai/glm-5"
STORY_LLM_MODEL_GLM51 = "z-ai/glm-5.1"
STORY_LLM_MODEL_GLM47 = "z-ai/glm-4.7"
STORY_LLM_MODEL_DEEPSEEK_V3 = "deepseek/deepseek-chat-v3-0324"
STORY_LLM_MODEL_DEEPSEEK_V32 = "deepseek/deepseek-v3.2"
STORY_LLM_MODEL_GROK_41_FAST = "x-ai/grok-4.1-fast"
STORY_LLM_MODEL_MISTRAL_NEMO = "mistralai/mistral-nemo"
STORY_LLM_MODEL_XIAOMI_MIMO_V2_FLASH = "xiaomi/mimo-v2-flash"
STORY_LLM_MODEL_XIAOMI_MIMO_V2_PRO = "xiaomi/mimo-v2-pro"
STORY_LLM_MODEL_AION_2 = "aion-labs/aion-2.0"
STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE = "arcee-ai/trinity-large-preview:free"
STORY_DEFAULT_LLM_MODEL = STORY_LLM_MODEL_DEEPSEEK_V3
STORY_LLM_MODEL_LEGACY_ALIASES = {
    STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE: STORY_LLM_MODEL_XIAOMI_MIMO_V2_FLASH,
}
STORY_SUPPORTED_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_GLM51,
    STORY_LLM_MODEL_GLM47,
    STORY_LLM_MODEL_DEEPSEEK_V3,
    STORY_LLM_MODEL_DEEPSEEK_V32,
    STORY_LLM_MODEL_GROK_41_FAST,
    STORY_LLM_MODEL_MISTRAL_NEMO,
    STORY_LLM_MODEL_XIAOMI_MIMO_V2_FLASH,
    STORY_LLM_MODEL_XIAOMI_MIMO_V2_PRO,
    STORY_LLM_MODEL_AION_2,
}
STORY_TURN_COST_STANDARD_LLM_MODELS = {
    STORY_LLM_MODEL_DEEPSEEK_V3,
    STORY_LLM_MODEL_DEEPSEEK_V32,
    STORY_LLM_MODEL_GLM47,
    STORY_LLM_MODEL_GROK_41_FAST,
    STORY_LLM_MODEL_MISTRAL_NEMO,
    STORY_LLM_MODEL_XIAOMI_MIMO_V2_FLASH,
}
STORY_TURN_COST_PREMIUM_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_AION_2,
    STORY_LLM_MODEL_XIAOMI_MIMO_V2_PRO,
}
STORY_IMAGE_MODEL_FLUX = "black-forest-labs/flux.2-pro"
STORY_IMAGE_MODEL_SEEDREAM = "bytedance-seed/seedream-4.5"
STORY_IMAGE_MODEL_NANO_BANANO = "google/gemini-2.5-flash-image"
STORY_IMAGE_MODEL_NANO_BANANO_2 = "google/gemini-3.1-flash-image-preview"
STORY_IMAGE_MODEL_GROK = "grok-imagine-image"
STORY_IMAGE_MODEL_GROK_LEGACY = "grok-imagine-image-pro"
STORY_DEFAULT_IMAGE_MODEL = STORY_IMAGE_MODEL_FLUX
STORY_SUPPORTED_IMAGE_MODELS = {
    STORY_IMAGE_MODEL_FLUX,
    STORY_IMAGE_MODEL_SEEDREAM,
    STORY_IMAGE_MODEL_NANO_BANANO,
    STORY_IMAGE_MODEL_NANO_BANANO_2,
    STORY_IMAGE_MODEL_GROK,
}
STORY_TOP_K_MIN = 0
STORY_TOP_K_MAX = 200
STORY_DEFAULT_TOP_K = 55
STORY_TOP_R_MIN = 0.1
STORY_TOP_R_MAX = 1.0
STORY_DEFAULT_TOP_R = 0.85
STORY_TEMPERATURE_MIN = 0.0
STORY_TEMPERATURE_MAX = 2.0
STORY_DEFAULT_TEMPERATURE = 0.85
STORY_DEFAULT_SHOW_GG_THOUGHTS = False
STORY_DEFAULT_SHOW_NPC_THOUGHTS = False
STORY_DEFAULT_EMOTION_VISUALIZATION_ENABLED = False
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
STORY_WORLD_CARD_KINDS = {
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_KIND_MAIN_HERO,
}
STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 3
STORY_WORLD_CARD_MEMORY_TURNS_DISABLED = 0
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"


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


def normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    normalized = int(value)
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(normalized, STORY_CONTEXT_LIMIT_MAX_TOKENS))


def normalize_story_response_max_tokens(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_RESPONSE_MAX_TOKENS
    normalized = int(value)
    if STORY_RESPONSE_MAX_TOKENS_MIN <= normalized <= STORY_RESPONSE_MAX_TOKENS_MAX:
        return normalized
    return STORY_DEFAULT_RESPONSE_MAX_TOKENS


def normalize_story_response_max_tokens_enabled(value: bool | None) -> bool:
    if value is None:
        return False
    return bool(value)


def get_story_model_turn_cost_tiers(model_name: str | None) -> tuple[int, int, int]:
    normalized_model_name = coerce_story_llm_model(model_name)
    if normalized_model_name == STORY_LLM_MODEL_GLM51:
        return STORY_TURN_COST_GLM51_TIERS
    if normalized_model_name in STORY_TURN_COST_PREMIUM_LLM_MODELS:
        return STORY_TURN_COST_PREMIUM_TIERS
    if normalized_model_name in STORY_TURN_COST_STANDARD_LLM_MODELS:
        return STORY_TURN_COST_STANDARD_TIERS
    return STORY_TURN_COST_STANDARD_TIERS


def get_story_turn_cost_tokens(context_usage_tokens: int | None, model_name: str | None = None) -> int:
    normalized_usage = max(int(context_usage_tokens or 0), 0)
    tier_1_cost, tier_2_cost, tier_3_cost = get_story_model_turn_cost_tiers(model_name)
    if normalized_usage <= STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX:
        return tier_1_cost
    if normalized_usage <= STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX:
        return tier_2_cost
    return tier_3_cost


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
                "Use one of: z-ai/glm-5, z-ai/glm-5.1, z-ai/glm-4.7, "
                "deepseek/deepseek-chat-v3-0324, deepseek/deepseek-v3.2, "
                "x-ai/grok-4.1-fast, mistralai/mistral-nemo, "
                "xiaomi/mimo-v2-flash, xiaomi/mimo-v2-pro, aion-labs/aion-2.0"
            ),
        )
    return normalized


def coerce_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    if normalized == STORY_IMAGE_MODEL_GROK_LEGACY:
        normalized = STORY_IMAGE_MODEL_GROK
    if normalized in STORY_SUPPORTED_IMAGE_MODELS:
        return normalized
    return STORY_DEFAULT_IMAGE_MODEL


def normalize_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    if normalized == STORY_IMAGE_MODEL_GROK_LEGACY:
        normalized = STORY_IMAGE_MODEL_GROK
    if normalized not in STORY_SUPPORTED_IMAGE_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported image model. "
                "Use one of: black-forest-labs/flux.2-pro, bytedance-seed/seedream-4.5, "
                "google/gemini-2.5-flash-image, google/gemini-3.1-flash-image-preview, grok-imagine-image"
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
    _ = model_name
    if value is None:
        return STORY_DEFAULT_TOP_K
    return max(STORY_TOP_K_MIN, min(int(value), STORY_TOP_K_MAX))


def normalize_story_top_r(value: float | None, *, model_name: str | None = None) -> float:
    _ = model_name
    if value is None:
        return STORY_DEFAULT_TOP_R
    clamped_value = max(STORY_TOP_R_MIN, min(float(value), STORY_TOP_R_MAX))
    return round(clamped_value, 2)


def normalize_story_temperature(value: float | None, *, model_name: str | None = None) -> float:
    _ = model_name
    if value is None:
        return STORY_DEFAULT_TEMPERATURE
    clamped_value = max(STORY_TEMPERATURE_MIN, min(float(value), STORY_TEMPERATURE_MAX))
    return round(clamped_value, 2)


def normalize_story_repetition_penalty(value: float | None, *, model_name: str | None = None) -> float:
    _ = model_name
    if value is None:
        return STORY_DEFAULT_REPETITION_PENALTY
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


def normalize_story_character_state_enabled(value: bool | None) -> bool:
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
    return STORY_ENVIRONMENT_TIME_MODE_GROK


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
        return json.dumps(value, ensure_ascii=False)
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


def normalize_story_emotion_visualization_enabled(value: bool | None) -> bool:
    if value is None:
        return STORY_DEFAULT_EMOTION_VISUALIZATION_ENABLED
    return bool(value)


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
    return validate_avatar_url(normalized, max_bytes=STORY_COVER_MAX_BYTES)


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
    db.execute(sa_delete(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == game_id))
    db.execute(sa_delete(StoryPlotCardChangeEvent).where(StoryPlotCardChangeEvent.game_id == game_id))
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
        context_limit_chars=normalize_story_context_limit_chars(getattr(game, "context_limit_chars", None)),
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=normalized_story_model,
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
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        character_state_enabled=normalize_story_character_state_enabled(
            getattr(game, "character_state_enabled", None)
        ),
        environment_enabled=environment_time_enabled or environment_weather_enabled,
        environment_time_enabled=environment_time_enabled,
        environment_weather_enabled=environment_weather_enabled,
        emotion_visualization_enabled=normalize_story_emotion_visualization_enabled(
            getattr(game, "emotion_visualization_enabled", None)
        ),
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
        context_limit_chars=normalize_story_context_limit_chars(getattr(game, "context_limit_chars", None)),
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=normalized_story_model,
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
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        character_state_enabled=normalize_story_character_state_enabled(
            getattr(game, "character_state_enabled", None)
        ),
        environment_enabled=environment_time_enabled or environment_weather_enabled,
        environment_time_enabled=environment_time_enabled,
        environment_weather_enabled=environment_weather_enabled,
        emotion_visualization_enabled=normalize_story_emotion_visualization_enabled(
            getattr(game, "emotion_visualization_enabled", None)
        ),
        ambient_profile=None,
        environment_current_datetime=serialize_story_environment_datetime(
            deserialize_story_environment_datetime(getattr(game, "environment_current_datetime", None))
        ),
        environment_current_weather=current_weather,
        environment_tomorrow_weather=deserialize_story_environment_weather(
            getattr(game, "environment_tomorrow_weather", None)
        ),
        current_location_label=str(getattr(game, "current_location_label", "") or "").strip() or None,
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


def story_community_world_summary_to_out(
    world: StoryGame,
    *,
    author_id: int,
    author_name: str,
    author_avatar_url: str | None,
    user_rating: int | None,
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
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
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
) -> None:
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
        else:
            for card in source_instruction_cards_out:
                cloned_instruction = StoryInstructionCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
                    is_active=bool(getattr(card, "is_active", True)),
                )
                db.add(cloned_instruction)

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
        return

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
