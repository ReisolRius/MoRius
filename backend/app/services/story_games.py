from __future__ import annotations
import json
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryInstructionCard, StoryPlotCard, StoryWorldCard, User
from app.schemas import StoryCommunityWorldSummaryOut, StoryGameSummaryOut
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
from app.services.story_queries import (
    list_story_instruction_cards,
    list_story_plot_cards,
    list_story_world_cards,
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
STORY_CONTEXT_LIMIT_MAX_TOKENS = 4_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 2_000
STORY_TURN_COST_LOW_CONTEXT_LIMIT_MAX = 1_500
STORY_TURN_COST_MEDIUM_CONTEXT_LIMIT_MAX = 3_000
STORY_TURN_COST_LOW = 1
STORY_TURN_COST_MEDIUM = 2
STORY_TURN_COST_HIGH = 3
STORY_LLM_MODEL_GLM5 = "z-ai/glm-5"
STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE = "arcee-ai/trinity-large-preview:free"
STORY_LLM_MODEL_MOONSHOT_KIMI_K2_0905 = "moonshotai/kimi-k2-0905"
STORY_DEFAULT_LLM_MODEL = STORY_LLM_MODEL_GLM5
STORY_SUPPORTED_LLM_MODELS = {
    STORY_LLM_MODEL_GLM5,
    STORY_LLM_MODEL_ARCEE_TRINITY_LARGE_PREVIEW_FREE,
    STORY_LLM_MODEL_MOONSHOT_KIMI_K2_0905,
}
STORY_TOP_K_MIN = 0
STORY_TOP_K_MAX = 200
STORY_DEFAULT_TOP_K = 0
STORY_TOP_R_MIN = 0.1
STORY_TOP_R_MAX = 1.0
STORY_DEFAULT_TOP_R = 1.0
STORY_COVER_SCALE_MIN = 1.0
STORY_COVER_SCALE_MAX = 3.0
STORY_COVER_SCALE_DEFAULT = 1.0
STORY_IMAGE_POSITION_MIN = 0.0
STORY_IMAGE_POSITION_MAX = 100.0
STORY_IMAGE_POSITION_DEFAULT = 50.0
STORY_COVER_MAX_BYTES = 500 * 1024
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


def normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(value, STORY_CONTEXT_LIMIT_MAX_TOKENS))


def get_story_turn_cost_tokens(context_usage_tokens: int | None) -> int:
    normalized_usage = max(int(context_usage_tokens or 0), 0)
    if normalized_usage <= STORY_TURN_COST_LOW_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_LOW
    if normalized_usage <= STORY_TURN_COST_MEDIUM_CONTEXT_LIMIT_MAX:
        return STORY_TURN_COST_MEDIUM
    return STORY_TURN_COST_HIGH


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
                "Use one of: z-ai/glm-5, arcee-ai/trinity-large-preview:free, moonshotai/kimi-k2-0905"
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


def normalize_story_ambient_enabled(value: bool | None) -> bool:
    if value is None:
        return True
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


def story_game_summary_to_out(game: StoryGame) -> StoryGameSummaryOut:
    return StoryGameSummaryOut(
        id=game.id,
        title=game.title,
        description=(game.description or "").strip(),
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
        story_llm_model=coerce_story_llm_model(getattr(game, "story_llm_model", None)),
        memory_optimization_enabled=bool(getattr(game, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(game, "story_top_r", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(game, "ambient_enabled", None)),
        ambient_profile=deserialize_story_ambient_profile(getattr(game, "ambient_profile", None)),
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
    author_name: str,
    author_avatar_url: str | None,
    user_rating: int | None,
) -> StoryCommunityWorldSummaryOut:
    summary = story_game_summary_to_out(world)
    return StoryCommunityWorldSummaryOut(
        id=summary.id,
        title=summary.title,
        description=summary.description,
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


def clone_story_world_cards_to_game(
    db: Session,
    *,
    source_world_id: int,
    target_game_id: int,
) -> None:
    source_instruction_cards = list_story_instruction_cards(db, source_world_id)
    for card in source_instruction_cards:
        cloned_instruction = StoryInstructionCard(
            game_id=target_game_id,
            title=card.title,
            content=card.content,
        )
        db.add(cloned_instruction)

    source_plot_cards = list_story_plot_cards(db, source_world_id)
    for card in source_plot_cards:
        cloned_plot = StoryPlotCard(
            game_id=target_game_id,
            title=card.title,
            content=card.content,
            source=card.source,
        )
        db.add(cloned_plot)

    source_world_cards = list_story_world_cards(db, source_world_id)
    for card in source_world_cards:
        card_kind = _normalize_story_world_card_kind(card.kind)
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
