from __future__ import annotations

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
STORY_CONTEXT_LIMIT_MIN_TOKENS = 500
STORY_CONTEXT_LIMIT_MAX_TOKENS = 6_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 2_000
STORY_COVER_SCALE_MIN = 1.0
STORY_COVER_SCALE_MAX = 3.0
STORY_COVER_SCALE_DEFAULT = 1.0
STORY_IMAGE_POSITION_MIN = 0.0
STORY_IMAGE_POSITION_MAX = 100.0
STORY_IMAGE_POSITION_DEFAULT = 50.0
STORY_COVER_MAX_BYTES = 500 * 1024
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


def normalize_story_game_description(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:4_000].rstrip()


def normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(value, STORY_CONTEXT_LIMIT_MAX_TOKENS))


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
        visibility=coerce_story_game_visibility(game.visibility),
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


def story_community_world_summary_to_out(
    world: StoryGame,
    *,
    author_name: str,
    user_rating: int | None,
) -> StoryCommunityWorldSummaryOut:
    summary = story_game_summary_to_out(world)
    return StoryCommunityWorldSummaryOut(
        id=summary.id,
        title=summary.title,
        description=summary.description,
        author_name=author_name,
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

