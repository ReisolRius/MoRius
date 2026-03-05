from __future__ import annotations
import json
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryInstructionCard, StoryPlotCard, StoryWorldCard, User
from app.schemas import (
    StoryCommunityWorldSummaryOut,
    StoryGameSummaryOut,
    StoryInstructionCardOut,
    StoryPlotCardOut,
    StoryWorldCardOut,
)
from app.services.media import (
    normalize_avatar_value,
    normalize_media_position,
    normalize_media_scale,
    validate_avatar_url,
)
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_url,
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
    "Фантастика (Научная фантастика)",
    "Детектив",
    "Триллер",
    "Хоррор (Ужасы)",
    "Мистика",
    "Романтика (Любовный роман)",
    "Приключения",
    "Боевик",
    "Исторический роман",
    "Комедия / Юмор",
    "Трагедия / Драма",
    "Антиутопия",
    "Постапокалипсис",
    "Киберпанк",
    "Повседневность",
}
STORY_CONTEXT_LIMIT_MIN_TOKENS = 500
STORY_CONTEXT_LIMIT_MAX_TOKENS = 10_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 1_500
STORY_RESPONSE_MAX_TOKENS_MIN = 200
STORY_RESPONSE_MAX_TOKENS_MAX = 800
STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
STORY_TURN_COST_STAGE_1_CONTEXT_LIMIT_MAX = 1_500
STORY_TURN_COST_STAGE_2_CONTEXT_LIMIT_MAX = 3_000
STORY_TURN_COST_STAGE_3_CONTEXT_LIMIT_MAX = 4_000
STORY_TURN_COST_STAGE_4_CONTEXT_LIMIT_MAX = 5_500
STORY_TURN_COST_STAGE_5_CONTEXT_LIMIT_MAX = 7_000
STORY_TURN_COST_STAGE_6_CONTEXT_LIMIT_MAX = 8_500
STORY_TURN_COST_STAGE_1 = 1
STORY_TURN_COST_STAGE_2 = 2
STORY_TURN_COST_STAGE_3 = 3
STORY_TURN_COST_STAGE_4 = 4
STORY_TURN_COST_STAGE_5 = 5
STORY_TURN_COST_STAGE_6 = 6
STORY_TURN_COST_STAGE_7 = 7
STORY_LLM_MODEL_GLM5 = "z-ai/glm-5"
STORY_LLM_MODEL_GLM47 = "z-ai/glm-4.7"
STORY_LLM_MODEL_DEEPSEEK_V32 = "deepseek/deepseek-v3.2"
STORY_LLM_MODEL_GROK_41_FAST = "x-ai/grok-4.1-fast"
STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE = "arcee-ai/trinity-large-preview:free"
STORY_DEFAULT_LLM_MODEL = STORY_LLM_MODEL_DEEPSEEK_V32
STORY_SUPPORTED_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_GLM47,
    STORY_LLM_MODEL_DEEPSEEK_V32,
    STORY_LLM_MODEL_GROK_41_FAST,
    STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE,
}
STORY_IMAGE_MODEL_FLUX = "black-forest-labs/flux.2-pro"
STORY_IMAGE_MODEL_SEEDREAM = "bytedance-seed/seedream-4.5"
STORY_IMAGE_MODEL_NANO_BANANO = "google/gemini-2.5-flash-image"
STORY_IMAGE_MODEL_NANO_BANANO_2 = "google/gemini-3.1-flash-image-preview"
STORY_IMAGE_MODEL_GROK = "grok-imagine-image-pro"
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
STORY_DEFAULT_TOP_K = 0
STORY_TOP_R_MIN = 0.1
STORY_TOP_R_MAX = 1.0
STORY_DEFAULT_TOP_R = 1.0
STORY_TEMPERATURE_MIN = 0.0
STORY_TEMPERATURE_MAX = 2.0
STORY_DEFAULT_TEMPERATURE = 1.0
STORY_DEFAULT_SHOW_GG_THOUGHTS = True
STORY_DEFAULT_SHOW_NPC_THOUGHTS = True
STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH = 320
STORY_COVER_SCALE_MIN = 1.0
STORY_COVER_SCALE_MAX = 3.0
STORY_COVER_SCALE_DEFAULT = 1.0
STORY_IMAGE_POSITION_MIN = 0.0
STORY_IMAGE_POSITION_MAX = 100.0
STORY_IMAGE_POSITION_DEFAULT = 50.0
STORY_COVER_MAX_BYTES = 1 * 1024 * 1024
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
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 10
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"


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
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())


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
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:4_000].rstrip()


def normalize_story_game_opening_scene(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:STORY_OPENING_SCENE_MAX_LENGTH].rstrip()


def normalize_story_image_style_prompt(value: str | None) -> str:
    if value is None:
        return ""
    normalized = " ".join(str(value).replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        return ""
    return normalized[:STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH].rstrip()


def normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(value, STORY_CONTEXT_LIMIT_MAX_TOKENS))


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


def get_story_turn_cost_tokens(context_usage_tokens: int | None) -> int:
    normalized_usage = max(int(context_usage_tokens or 0), 0)
    if normalized_usage <= STORY_TURN_COST_STAGE_1_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_1
    if normalized_usage <= STORY_TURN_COST_STAGE_2_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_2
    if normalized_usage <= STORY_TURN_COST_STAGE_3_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_3
    if normalized_usage <= STORY_TURN_COST_STAGE_4_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_4
    if normalized_usage <= STORY_TURN_COST_STAGE_5_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_5
    if normalized_usage <= STORY_TURN_COST_STAGE_6_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_STAGE_6
    return STORY_TURN_COST_STAGE_7


def coerce_story_llm_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_LLM_MODEL).strip()
    if normalized in STORY_SUPPORTED_LLM_MODELS:
        return normalized
    return STORY_DEFAULT_LLM_MODEL


def normalize_story_llm_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_LLM_MODEL).strip()
    if normalized not in STORY_SUPPORTED_LLM_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported story model. "
                "Use one of: z-ai/glm-5, z-ai/glm-4.7, deepseek/deepseek-v3.2, "
                "x-ai/grok-4.1-fast, arcee-ai/trinity-large-preview:free"
            ),
        )
    return normalized


def coerce_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    if normalized in STORY_SUPPORTED_IMAGE_MODELS:
        return normalized
    return STORY_DEFAULT_IMAGE_MODEL


def normalize_story_image_model(value: str | None) -> str:
    normalized = (value or STORY_DEFAULT_IMAGE_MODEL).strip()
    if normalized not in STORY_SUPPORTED_IMAGE_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported image model. "
                "Use one of: black-forest-labs/flux.2-pro, bytedance-seed/seedream-4.5, "
                "google/gemini-2.5-flash-image, google/gemini-3.1-flash-image-preview, grok-imagine-image-pro"
            ),
        )
    return normalized


def normalize_story_memory_optimization_enabled(value: bool | None) -> bool:
    if value is None:
        return True
    return bool(value)


def normalize_story_top_k(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_TOP_K
    return max(STORY_TOP_K_MIN, min(int(value), STORY_TOP_K_MAX))


def normalize_story_top_r(value: float | None) -> float:
    if value is None:
        return STORY_DEFAULT_TOP_R
    clamped_value = max(STORY_TOP_R_MIN, min(float(value), STORY_TOP_R_MAX))
    return round(clamped_value, 2)


def normalize_story_temperature(value: float | None) -> float:
    if value is None:
        return STORY_DEFAULT_TEMPERATURE
    clamped_value = max(STORY_TEMPERATURE_MIN, min(float(value), STORY_TEMPERATURE_MAX))
    return round(clamped_value, 2)


def normalize_story_show_gg_thoughts(value: bool | None) -> bool:
    if value is None:
        return STORY_DEFAULT_SHOW_GG_THOUGHTS
    return bool(value)


def normalize_story_show_npc_thoughts(value: bool | None) -> bool:
    if value is None:
        return STORY_DEFAULT_SHOW_NPC_THOUGHTS
    return bool(value)


def normalize_story_ambient_enabled(value: bool | None) -> bool:
    if value is None:
        return False
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
    return parsed


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


def normalize_story_cover_image_url(raw_value: str | None) -> str | None:
    normalized = normalize_avatar_value(raw_value)
    if normalized is None:
        return None
    return validate_avatar_url(normalized, max_bytes=STORY_COVER_MAX_BYTES)


def story_game_rating_average(game: StoryGame) -> float:
    rating_count = max(int(game.community_rating_count or 0), 0)
    if rating_count <= 0:
        return 0.0
    rating_sum = max(int(game.community_rating_sum or 0), 0)
    return round(rating_sum / rating_count, 2)


def story_game_summary_to_out(
    game: StoryGame,
    *,
    latest_message_preview: str | None = None,
) -> StoryGameSummaryOut:
    return StoryGameSummaryOut(
        id=game.id,
        title=game.title,
        description=(game.description or "").strip(),
        latest_message_preview=latest_message_preview,
        opening_scene=(game.opening_scene or "").strip(),
        visibility=coerce_story_game_visibility(game.visibility),
        age_rating=coerce_story_game_age_rating(game.age_rating),
        genres=deserialize_story_game_genres(game.genres),
        cover_image_url=normalize_avatar_value(game.cover_image_url),
        cover_scale=normalize_story_cover_scale(game.cover_scale),
        cover_position_x=normalize_story_cover_position(game.cover_position_x),
        cover_position_y=normalize_story_cover_position(game.cover_position_y),
        source_world_id=game.source_world_id,
        community_views=max(int(game.community_views or 0), 0),
        community_launches=max(int(game.community_launches or 0), 0),
        community_rating_avg=story_game_rating_average(game),
        community_rating_count=max(int(game.community_rating_count or 0), 0),
        context_limit_chars=game.context_limit_chars,
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(game, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(game, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(game, "image_style_prompt", None)),
        memory_optimization_enabled=bool(getattr(game, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(game, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(game, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(game, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        ambient_profile=deserialize_story_ambient_profile(getattr(game, "ambient_profile", None)),
        last_activity_at=game.last_activity_at,
        created_at=game.created_at,
        updated_at=game.updated_at,
    )


def story_game_summary_to_compact_out(
    game: StoryGame,
    *,
    latest_message_preview: str | None = None,
) -> StoryGameSummaryOut:
    return StoryGameSummaryOut(
        id=game.id,
        title=game.title,
        description=(game.description or "").strip(),
        latest_message_preview=latest_message_preview,
        opening_scene="",
        visibility=coerce_story_game_visibility(game.visibility),
        age_rating=coerce_story_game_age_rating(game.age_rating),
        genres=deserialize_story_game_genres(game.genres),
        cover_image_url=normalize_avatar_value(game.cover_image_url),
        cover_scale=normalize_story_cover_scale(game.cover_scale),
        cover_position_x=normalize_story_cover_position(game.cover_position_x),
        cover_position_y=normalize_story_cover_position(game.cover_position_y),
        source_world_id=game.source_world_id,
        community_views=max(int(game.community_views or 0), 0),
        community_launches=max(int(game.community_launches or 0), 0),
        community_rating_avg=story_game_rating_average(game),
        community_rating_count=max(int(game.community_rating_count or 0), 0),
        context_limit_chars=game.context_limit_chars,
        response_max_tokens=normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(game, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(game, "image_model", None)),
        image_style_prompt="",
        memory_optimization_enabled=bool(getattr(game, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(game, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(game, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(game, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        ambient_profile=None,
        last_activity_at=game.last_activity_at,
        created_at=game.created_at,
        updated_at=game.updated_at,
    )


def story_author_name(user: User | None) -> str:
    if user is None:
        return "Unknown"
    if user.display_name and user.display_name.strip():
        return user.display_name.strip()
    return user.email.split("@", maxsplit=1)[0]


def story_author_avatar_url(user: User | None) -> str | None:
    if user is None:
        return None
    return normalize_avatar_value(user.avatar_url)


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
    summary = story_game_summary_to_out(world)
    return StoryCommunityWorldSummaryOut(
        id=summary.id,
        title=summary.title,
        description=summary.description,
        author_id=author_id,
        author_name=author_name,
        author_avatar_url=author_avatar_url,
        age_rating=summary.age_rating,
        genres=summary.genres,
        cover_image_url=summary.cover_image_url,
        cover_scale=summary.cover_scale,
        cover_position_x=summary.cover_position_x,
        cover_position_y=summary.cover_position_y,
        community_views=summary.community_views,
        community_launches=summary.community_launches,
        community_rating_avg=summary.community_rating_avg,
        community_rating_count=summary.community_rating_count,
        user_rating=user_rating,
        is_reported_by_user=bool(is_reported_by_user),
        is_favorited_by_user=bool(is_favorited_by_user),
        created_at=summary.created_at,
        updated_at=summary.updated_at,
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
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        default_value = STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS
    else:
        default_value = STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS
    if raw_value is None:
        return default_value
    parsed_value = int(raw_value)
    if parsed_value <= 0:
        return default_value
    return parsed_value


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


def refresh_story_game_public_card_snapshots(db: Session, game: StoryGame) -> None:
    instruction_cards_snapshot = [
        StoryInstructionCardOut.model_validate(card).model_dump(mode="json")
        for card in list_story_instruction_cards(db, game.id)
    ]
    plot_cards_snapshot = [
        story_plot_card_to_out(card).model_dump(mode="json")
        for card in list_story_plot_cards(db, game.id)
    ]
    world_cards_snapshot = [
        story_world_card_to_out(card).model_dump(mode="json")
        for card in list_story_world_cards(db, game.id)
    ]
    game.published_instruction_cards_snapshot = _serialize_story_public_cards_snapshot(instruction_cards_snapshot)
    game.published_plot_cards_snapshot = _serialize_story_public_cards_snapshot(plot_cards_snapshot)
    game.published_world_cards_snapshot = _serialize_story_public_cards_snapshot(world_cards_snapshot)


def get_story_game_public_cards_out(
    db: Session,
    game: StoryGame,
) -> tuple[list[StoryInstructionCardOut], list[StoryPlotCardOut], list[StoryWorldCardOut]]:
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
        return instruction_cards_snapshot, plot_cards_snapshot, world_cards_snapshot

    instruction_cards = [
        StoryInstructionCardOut.model_validate(card)
        for card in list_story_instruction_cards(db, game.id)
    ]
    plot_cards = [
        story_plot_card_to_out(card)
        for card in list_story_plot_cards(db, game.id)
    ]
    world_cards = [
        story_world_card_to_out(card)
        for card in list_story_world_cards(db, game.id)
    ]
    return instruction_cards, plot_cards, world_cards


def ensure_story_game_public_card_snapshots(db: Session, game: StoryGame) -> bool:
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
                )
                db.add(cloned_instruction)
        else:
            for card in source_instruction_cards_out:
                cloned_instruction = StoryInstructionCard(
                    game_id=target_game_id,
                    title=card.title,
                    content=card.content,
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
                    is_enabled=bool(getattr(card, "is_enabled", True)),
                    source=normalize_story_plot_card_source(getattr(card, "source", "")),
                )
                db.add(cloned_plot)
        else:
            for card in source_plot_cards_out:
                snapshot_memory_turns = 0 if card.memory_turns is None else int(card.memory_turns)
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
                        snapshot_memory_turns,
                        explicit=False,
                        current_value=snapshot_memory_turns,
                    ),
                    ai_edit_enabled=bool(card.ai_edit_enabled),
                    is_enabled=bool(card.is_enabled),
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
                triggers=card.triggers,
                kind=card_kind,
                avatar_url=normalize_story_character_avatar_url(card.avatar_url),
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
            triggers=serialize_story_world_card_triggers(
                normalize_story_world_card_triggers(
                    list(card.triggers),
                    fallback_title=card.title,
                )
            ),
            kind=card_kind,
            avatar_url=normalize_story_character_avatar_url(card.avatar_url),
            avatar_scale=normalize_story_avatar_scale(card.avatar_scale),
            character_id=None,
            memory_turns=_normalize_story_world_card_memory_turns_for_storage(card.memory_turns, kind=card_kind),
            is_locked=bool(card.is_locked),
            ai_edit_enabled=bool(card.ai_edit_enabled),
            source=_normalize_story_world_card_source(card.source),
        )
        db.add(cloned_world_card)
