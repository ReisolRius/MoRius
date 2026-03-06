from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

from app.database import get_db
from app.models import (
    StoryBugReport,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldReport,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryBugReportCreateRequest,
    StoryCommunityWorldCommentCreateRequest,
    StoryCommunityWorldCommentOut,
    StoryCommunityWorldCommentUpdateRequest,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryCommunityWorldSummaryOut,
    StoryGameCloneRequest,
    StoryGameCreateRequest,
    StoryGameOut,
    StoryGameMetaUpdateRequest,
    StoryGameSettingsUpdateRequest,
    StoryGameSummaryOut,
    StoryInstructionCardOut,
    StoryMemoryBlockOut,
    StoryMessageOut,
    StoryTurnImageOut,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import (
    apply_story_world_rating_delete,
    apply_story_world_rating_insert,
    apply_story_world_rating_update,
    increment_story_world_launches,
)
from app.services.story_games import (
    STORY_DEFAULT_TITLE,
    STORY_GAME_VISIBILITY_PRIVATE,
    STORY_GAME_VISIBILITY_PUBLIC,
    clone_story_world_cards_to_game,
    coerce_story_llm_model,
    coerce_story_image_model,
    coerce_story_game_age_rating,
    ensure_story_game_public_card_snapshots,
    deserialize_story_game_genres,
    get_story_game_public_cards_out,
    normalize_story_ambient_enabled,
    normalize_story_context_limit_chars,
    normalize_story_cover_image_url,
    normalize_story_cover_position,
    normalize_story_cover_scale,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_game_age_rating,
    normalize_story_game_description,
    normalize_story_game_genres,
    normalize_story_image_style_prompt,
    normalize_story_image_model,
    normalize_story_game_opening_scene,
    normalize_story_game_visibility,
    normalize_story_llm_model,
    normalize_story_memory_optimization_enabled,
    normalize_story_show_gg_thoughts,
    normalize_story_show_npc_thoughts,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
    refresh_story_game_public_card_snapshots,
    serialize_story_game_genres,
    story_author_avatar_url,
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_compact_out,
    story_game_summary_to_out,
)
from app.services.story_cards import story_plot_card_to_out
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_memory import story_memory_block_to_out
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    has_story_assistant_redo_step,
    list_story_instruction_cards,
    list_story_memory_blocks,
    list_story_messages,
    list_story_plot_card_events,
    list_story_plot_cards,
    touch_story_game,
    list_story_turn_images,
    list_story_world_card_events,
    list_story_world_cards,
)
from app.services.story_world_comments import (
    list_story_community_world_comments_out,
    normalize_story_community_world_comment_content,
    story_community_world_comment_to_out,
)
from app.services.story_world_cards import story_world_card_to_out

router = APIRouter()

STORY_WORLD_REPORT_STATUS_OPEN = "open"
STORY_BUG_REPORT_STATUS_OPEN = "open"
STORY_BUG_REPORT_TITLE_MAX_LENGTH = 160
STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH = 8_000
STORY_GAME_TITLE_MAX_LENGTH = 160
STORY_CLONE_TITLE_SUFFIX = " (копия)"
PRIVILEGED_WORLD_COMMENT_ROLES = {"administrator", "moderator"}
STORY_LIST_PREVIEW_MAX_CHARS = 145
STORY_LIST_PREVIEW_MAX_CHARS_WITH_ELLIPSIS = 142


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _build_story_clone_title(source_title: str) -> str:
    normalized_source_title = source_title.strip() or STORY_DEFAULT_TITLE
    max_base_length = STORY_GAME_TITLE_MAX_LENGTH - len(STORY_CLONE_TITLE_SUFFIX)
    trimmed_source_title = normalized_source_title[: max(max_base_length, 0)].rstrip()
    if not trimmed_source_title:
        trimmed_source_title = STORY_DEFAULT_TITLE[: max(max_base_length, 0)].rstrip() or STORY_DEFAULT_TITLE
    return f"{trimmed_source_title}{STORY_CLONE_TITLE_SUFFIX}"[:STORY_GAME_TITLE_MAX_LENGTH]


def _build_story_list_preview(raw_content: str | None) -> str | None:
    if not isinstance(raw_content, str):
        return None
    normalized = " ".join(raw_content.split()).strip()
    if not normalized:
        return None
    if len(normalized) <= STORY_LIST_PREVIEW_MAX_CHARS:
        return normalized
    return f"{normalized[:STORY_LIST_PREVIEW_MAX_CHARS_WITH_ELLIPSIS]}..."


def _normalize_story_bug_report_title(value: str) -> str:
    normalized = " ".join(str(value).replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bug report title should not be empty")
    return normalized[:STORY_BUG_REPORT_TITLE_MAX_LENGTH].rstrip()


def _normalize_story_bug_report_description(value: str) -> str:
    normalized = str(value).replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bug report description should not be empty")
    return normalized[:STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH].rstrip()


def _build_story_game_snapshot_payload(db: Session, game: StoryGame) -> dict[str, object]:
    messages = list_story_messages(db, game.id)
    turn_images = list_story_turn_images(db, game.id)
    instruction_cards = list_story_instruction_cards(db, game.id)
    plot_cards = list_story_plot_cards(db, game.id)
    plot_card_events = list_story_plot_card_events(db, game.id)
    memory_blocks = list_story_memory_blocks(db, game.id)
    world_cards = list_story_world_cards(db, game.id)
    world_card_events = list_story_world_card_events(db, game.id)
    can_redo_assistant_step = has_story_assistant_redo_step(db, game.id)

    payload = StoryGameOut(
        game=story_game_summary_to_out(game),
        messages=[StoryMessageOut.model_validate(message) for message in messages],
        turn_images=[StoryTurnImageOut.model_validate(item) for item in turn_images],
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        plot_cards=[story_plot_card_to_out(card) for card in plot_cards],
        plot_card_events=[story_plot_card_change_event_to_out(event) for event in plot_card_events],
        memory_blocks=[StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block)) for block in memory_blocks],
        world_cards=[story_world_card_to_out(card) for card in world_cards],
        world_card_events=[story_world_card_change_event_to_out(event) for event in world_card_events],
        can_redo_assistant_step=can_redo_assistant_step,
    )
    return payload.model_dump(mode="json")


def _load_latest_story_message_preview_by_game_id(
    db: Session,
    *,
    game_ids: list[int],
) -> dict[int, str]:
    if not game_ids:
        return {}

    latest_message_ids_subquery = (
        select(
            StoryMessage.game_id.label("game_id"),
            func.max(StoryMessage.id).label("max_message_id"),
        )
        .where(
            StoryMessage.game_id.in_(game_ids),
            StoryMessage.undone_at.is_(None),
        )
        .group_by(StoryMessage.game_id)
        .subquery()
    )
    rows = db.execute(
        select(StoryMessage.game_id, StoryMessage.content).join(
            latest_message_ids_subquery,
            (StoryMessage.game_id == latest_message_ids_subquery.c.game_id)
            & (StoryMessage.id == latest_message_ids_subquery.c.max_message_id),
        )
    ).all()

    preview_by_game_id: dict[int, str] = {}
    for game_id, message_content in rows:
        preview = _build_story_list_preview(message_content)
        if preview:
            preview_by_game_id[int(game_id)] = preview
    return preview_by_game_id


def _build_story_community_world_summary(
    db: Session,
    *,
    user_id: int,
    world: StoryGame,
    user_rating_override: int | None = None,
    is_reported_by_user_override: bool | None = None,
    is_favorited_by_user_override: bool | None = None,
) -> StoryCommunityWorldSummaryOut:
    author = db.scalar(select(User).where(User.id == world.user_id))

    if user_rating_override is None:
        user_rating_value = db.scalar(
            select(StoryCommunityWorldRating.rating).where(
                StoryCommunityWorldRating.world_id == world.id,
                StoryCommunityWorldRating.user_id == user_id,
            )
        )
        user_rating = int(user_rating_value) if user_rating_value is not None else None
    else:
        user_rating = int(user_rating_override)

    if is_reported_by_user_override is None:
        user_report_id = db.scalar(
            select(StoryCommunityWorldReport.id).where(
                StoryCommunityWorldReport.world_id == world.id,
                StoryCommunityWorldReport.reporter_user_id == user_id,
            )
        )
        is_reported_by_user = user_report_id is not None
    else:
        is_reported_by_user = bool(is_reported_by_user_override)

    if is_favorited_by_user_override is None:
        user_favorite_id = db.scalar(
            select(StoryCommunityWorldFavorite.id).where(
                StoryCommunityWorldFavorite.world_id == world.id,
                StoryCommunityWorldFavorite.user_id == user_id,
            )
        )
        is_favorited_by_user = user_favorite_id is not None
    else:
        is_favorited_by_user = bool(is_favorited_by_user_override)

    return story_community_world_summary_to_out(
        world,
        author_id=world.user_id,
        author_name=story_author_name(author),
        author_avatar_url=story_author_avatar_url(author),
        user_rating=user_rating,
        is_reported_by_user=is_reported_by_user,
        is_favorited_by_user=is_favorited_by_user,
    )


def _create_story_game_publication_copy_from_source(
    db: Session,
    *,
    source_game: StoryGame,
    copy_cards: bool,
) -> StoryGame:
    publication = StoryGame(
        user_id=source_game.user_id,
        title=source_game.title,
        description=source_game.description,
        opening_scene=source_game.opening_scene,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
        age_rating=source_game.age_rating,
        genres=source_game.genres,
        cover_image_url=source_game.cover_image_url,
        cover_scale=source_game.cover_scale,
        cover_position_x=source_game.cover_position_x,
        cover_position_y=source_game.cover_position_y,
        source_world_id=source_game.id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=source_game.context_limit_chars,
        response_max_tokens=source_game.response_max_tokens,
        response_max_tokens_enabled=source_game.response_max_tokens_enabled,
        story_llm_model=source_game.story_llm_model,
        image_model=source_game.image_model,
        image_style_prompt=source_game.image_style_prompt,
        memory_optimization_enabled=source_game.memory_optimization_enabled,
        story_top_k=source_game.story_top_k,
        story_top_r=source_game.story_top_r,
        story_temperature=source_game.story_temperature,
        show_gg_thoughts=source_game.show_gg_thoughts,
        show_npc_thoughts=source_game.show_npc_thoughts,
        ambient_enabled=source_game.ambient_enabled,
        ambient_profile=source_game.ambient_profile,
        last_activity_at=_utcnow(),
    )
    db.add(publication)
    db.flush()

    if copy_cards:
        clone_story_world_cards_to_game(
            db,
            source_world_id=source_game.id,
            target_game_id=publication.id,
        )
        refresh_story_game_public_card_snapshots(db, publication)

    return publication


def _delete_story_game_with_relations(db: Session, *, game_id: int) -> None:
    db.execute(
        sa_delete(StoryWorldCardChangeEvent).where(
            StoryWorldCardChangeEvent.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCardChangeEvent).where(
            StoryPlotCardChangeEvent.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryTurnImage).where(
            StoryTurnImage.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryMemoryBlock).where(
            StoryMemoryBlock.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryMessage).where(
            StoryMessage.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryInstructionCard).where(
            StoryInstructionCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCard).where(
            StoryPlotCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryWorldCard).where(
            StoryWorldCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldView).where(
            StoryCommunityWorldView.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldLaunch).where(
            StoryCommunityWorldLaunch.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == game_id,
        )
    )
    game = db.scalar(select(StoryGame).where(StoryGame.id == game_id))
    if game is not None:
        db.delete(game)


@router.get("/api/story/games", response_model=list[StoryGameSummaryOut])
def list_story_games(
    compact: bool = False,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryGameSummaryOut]:
    user = get_current_user(db, authorization)
    query = (
        select(StoryGame)
        .where(StoryGame.user_id == user.id)
        .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
    )
    if compact:
        query = query.options(
            load_only(
                StoryGame.id,
                StoryGame.title,
                StoryGame.description,
                StoryGame.visibility,
                StoryGame.age_rating,
                StoryGame.genres,
                StoryGame.cover_image_url,
                StoryGame.cover_scale,
                StoryGame.cover_position_x,
                StoryGame.cover_position_y,
                StoryGame.source_world_id,
                StoryGame.community_views,
                StoryGame.community_launches,
                StoryGame.community_rating_sum,
                StoryGame.community_rating_count,
                StoryGame.context_limit_chars,
                StoryGame.response_max_tokens,
                StoryGame.response_max_tokens_enabled,
                StoryGame.story_llm_model,
                StoryGame.image_model,
                StoryGame.memory_optimization_enabled,
                StoryGame.story_top_k,
                StoryGame.story_top_r,
                StoryGame.story_temperature,
                StoryGame.show_gg_thoughts,
                StoryGame.show_npc_thoughts,
                StoryGame.ambient_enabled,
                StoryGame.last_activity_at,
                StoryGame.created_at,
                StoryGame.updated_at,
            )
        )
    games = db.scalars(query).all()
    if not compact:
        return [story_game_summary_to_out(game) for game in games]

    preview_by_game_id = _load_latest_story_message_preview_by_game_id(
        db,
        game_ids=[game.id for game in games],
    )
    return [
        story_game_summary_to_compact_out(
            game,
            latest_message_preview=preview_by_game_id.get(game.id),
        )
        for game in games
    ]


@router.get("/api/story/community/worlds", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_worlds(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
    worlds = db.scalars(
        select(StoryGame)
        .where(
            StoryGame.visibility == "public",
        )
        .order_by(
            StoryGame.community_launches.desc(),
            StoryGame.community_views.desc(),
            StoryGame.community_rating_count.desc(),
            StoryGame.id.desc(),
        )
        .limit(60)
    ).all()
    if not worlds:
        return []

    world_ids = [world.id for world in worlds]
    author_ids = sorted({world.user_id for world in worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}
    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}
    user_favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.user_id == user.id,
            StoryCommunityWorldFavorite.world_id.in_(world_ids),
        )
    ).all()
    favorited_world_ids = {row.world_id for row in user_favorite_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=world.id in favorited_world_ids,
        )
        for world in worlds
    ]


@router.get("/api/story/community/favorites", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_favorites(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
    favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite)
        .where(StoryCommunityWorldFavorite.user_id == user.id)
        .order_by(StoryCommunityWorldFavorite.created_at.desc(), StoryCommunityWorldFavorite.id.desc())
        .limit(120)
    ).all()
    if not favorite_rows:
        return []

    ordered_world_ids: list[int] = []
    seen_world_ids: set[int] = set()
    for row in favorite_rows:
        world_id = int(row.world_id)
        if world_id in seen_world_ids:
            continue
        seen_world_ids.add(world_id)
        ordered_world_ids.append(world_id)

    worlds = db.scalars(
        select(StoryGame).where(
            StoryGame.id.in_(ordered_world_ids),
            StoryGame.visibility == "public",
        )
    ).all()
    if not worlds:
        return []

    world_by_id = {world.id: world for world in worlds}
    ordered_worlds = [world_by_id[world_id] for world_id in ordered_world_ids if world_id in world_by_id]
    if not ordered_worlds:
        return []

    world_ids = [world.id for world in ordered_worlds]
    author_ids = sorted({world.user_id for world in ordered_worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}

    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=True,
        )
        for world in ordered_worlds
    ]


@router.post("/api/story/community/worlds/{world_id}/launch", response_model=StoryGameSummaryOut)
def launch_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    title = world.title.strip() or STORY_DEFAULT_TITLE

    cloned_game = StoryGame(
        user_id=user.id,
        title=title,
        description=world.description or "",
        opening_scene=world.opening_scene or "",
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(world.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(world.genres)),
        cover_image_url=normalize_story_cover_image_url(world.cover_image_url),
        cover_scale=normalize_story_cover_scale(world.cover_scale),
        cover_position_x=normalize_story_cover_position(world.cover_position_x),
        cover_position_y=normalize_story_cover_position(world.cover_position_y),
        source_world_id=world.id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(world.context_limit_chars),
        response_max_tokens=normalize_story_response_max_tokens(getattr(world, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(world, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(world, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(world, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(world, "image_style_prompt", None)),
        memory_optimization_enabled=bool(getattr(world, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(world, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(world, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(world, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(world, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(world, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(world, "ambient_enabled", None)),
        ambient_profile=str(getattr(world, "ambient_profile", "") or ""),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    ensure_story_game_public_card_snapshots(db, world)
    source_instruction_cards, source_plot_cards, source_world_cards = get_story_game_public_cards_out(db, world)
    clone_story_world_cards_to_game(
        db,
        source_world_id=world.id,
        target_game_id=cloned_game.id,
        source_instruction_cards_out=source_instruction_cards,
        source_plot_cards_out=source_plot_cards,
        source_world_cards_out=source_world_cards,
    )

    launch_inserted = False
    try:
        with db.begin_nested():
            db.add(
                StoryCommunityWorldLaunch(
                    world_id=world.id,
                    user_id=user.id,
                )
            )
            db.flush()
        launch_inserted = True
    except IntegrityError:
        launch_inserted = False

    if launch_inserted:
        increment_story_world_launches(db, world.id)
    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return story_game_summary_to_out(cloned_game)


@router.post("/api/story/community/worlds/{world_id}/rating", response_model=StoryCommunityWorldSummaryOut)
def rate_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldRatingRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    rating_value = int(payload.rating)

    existing_rating = db.scalar(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == world.id,
            StoryCommunityWorldRating.user_id == user.id,
        )
    )
    if rating_value <= 0:
        if existing_rating is not None:
            previous_rating = int(existing_rating.rating)
            db.delete(existing_rating)
            apply_story_world_rating_delete(db, world.id, previous_rating)
        db.commit()
        db.refresh(world)
        return _build_story_community_world_summary(
            db,
            user_id=user.id,
            world=world,
            user_rating_override=None,
        )

    if existing_rating is None:
        inserted_rating: StoryCommunityWorldRating | None = None
        try:
            with db.begin_nested():
                inserted_rating = StoryCommunityWorldRating(
                    world_id=world.id,
                    user_id=user.id,
                    rating=rating_value,
                )
                db.add(inserted_rating)
                db.flush()
            apply_story_world_rating_insert(db, world.id, rating_value)
            existing_rating = inserted_rating
        except IntegrityError:
            existing_rating = db.scalar(
                select(StoryCommunityWorldRating).where(
                    StoryCommunityWorldRating.world_id == world.id,
                    StoryCommunityWorldRating.user_id == user.id,
                )
            )

    if existing_rating is not None:
        previous_rating = int(existing_rating.rating)
        if previous_rating != rating_value:
            existing_rating.rating = rating_value
            apply_story_world_rating_update(db, world.id, rating_value - previous_rating)

    db.commit()
    db.refresh(world)
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        user_rating_override=rating_value,
    )


@router.post("/api/story/community/worlds/{world_id}/report", response_model=StoryCommunityWorldSummaryOut)
def report_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report description should not be empty",
        )

    existing_report_id = db.scalar(
        select(StoryCommunityWorldReport.id).where(
            StoryCommunityWorldReport.world_id == world.id,
            StoryCommunityWorldReport.reporter_user_id == user.id,
        )
    )
    if existing_report_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        )

    db.add(
        StoryCommunityWorldReport(
            world_id=world.id,
            reporter_user_id=user.id,
            reason=payload.reason,
            description=description,
            status=STORY_WORLD_REPORT_STATUS_OPEN,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        ) from None

    db.refresh(world)
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_reported_by_user_override=True,
    )


@router.get("/api/story/community/worlds/{world_id}/comments", response_model=list[StoryCommunityWorldCommentOut])
def list_story_community_world_comments(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldCommentOut]:
    get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    return list_story_community_world_comments_out(db, world_id=world.id)


@router.post("/api/story/community/worlds/{world_id}/comments", response_model=StoryCommunityWorldCommentOut)
def create_story_community_world_comment(
    world_id: int,
    payload: StoryCommunityWorldCommentCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment = StoryCommunityWorldComment(
        world_id=world.id,
        user_id=user.id,
        content=content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.patch("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=StoryCommunityWorldCommentOut)
def update_story_community_world_comment(
    world_id: int,
    comment_id: int,
    payload: StoryCommunityWorldCommentUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit this comment")

    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment.content = content
    db.commit()
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.delete("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=MessageResponse)
def delete_story_community_world_comment(
    world_id: int,
    comment_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id and user.role not in PRIVILEGED_WORLD_COMMENT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this comment")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="Comment deleted")


@router.post("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def favorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    existing_favorite_id = db.scalar(
        select(StoryCommunityWorldFavorite.id).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if existing_favorite_id is None:
        db.add(
            StoryCommunityWorldFavorite(
                world_id=world.id,
                user_id=user.id,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=True,
    )


@router.delete("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def unfavorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    favorite_row = db.scalar(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if favorite_row is not None:
        db.delete(favorite_row)
        db.commit()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=False,
    )


@router.post("/api/story/games", response_model=StoryGameSummaryOut)
def create_story_game(
    payload: StoryGameCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    title = payload.title.strip() if payload.title else STORY_DEFAULT_TITLE
    if not title:
        title = STORY_DEFAULT_TITLE
    description = normalize_story_game_description(payload.description)
    opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    requested_visibility = normalize_story_game_visibility(payload.visibility)
    age_rating = normalize_story_game_age_rating(payload.age_rating)
    genres = normalize_story_game_genres(payload.genres)
    cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    cover_scale = normalize_story_cover_scale(payload.cover_scale)
    cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    cover_position_y = normalize_story_cover_position(payload.cover_position_y)
    context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(payload.response_max_tokens_enabled)
    story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    image_model = normalize_story_image_model(payload.image_model)
    image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    memory_optimization_enabled = normalize_story_memory_optimization_enabled(payload.memory_optimization_enabled)
    story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(payload.story_top_r)
    story_temperature = normalize_story_temperature(payload.story_temperature)
    show_gg_thoughts = normalize_story_show_gg_thoughts(payload.show_gg_thoughts)
    show_npc_thoughts = normalize_story_show_npc_thoughts(payload.show_npc_thoughts)
    ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)

    game = StoryGame(
        user_id=user.id,
        title=title,
        description=description,
        opening_scene=opening_scene,
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=age_rating,
        genres=serialize_story_game_genres(genres),
        cover_image_url=cover_image_url,
        cover_scale=cover_scale,
        cover_position_x=cover_position_x,
        cover_position_y=cover_position_y,
        source_world_id=None,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=context_limit_chars,
        response_max_tokens=response_max_tokens,
        response_max_tokens_enabled=response_max_tokens_enabled,
        story_llm_model=story_llm_model,
        image_model=image_model,
        image_style_prompt=image_style_prompt,
        memory_optimization_enabled=memory_optimization_enabled,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        story_temperature=story_temperature,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
        ambient_enabled=ambient_enabled,
        ambient_profile="",
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.flush()
    if requested_visibility == STORY_GAME_VISIBILITY_PUBLIC:
        _create_story_game_publication_copy_from_source(
            db,
            source_game=game,
            copy_cards=True,
        )
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.post("/api/story/games/{game_id}/clone", response_model=StoryGameSummaryOut)
def clone_story_game(
    game_id: int,
    payload: StoryGameCloneRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    source_game = get_user_story_game_or_404(db, user.id, game_id)

    cloned_game = StoryGame(
        user_id=user.id,
        title=_build_story_clone_title(source_game.title or ""),
        description=normalize_story_game_description(source_game.description),
        opening_scene=normalize_story_game_opening_scene(source_game.opening_scene),
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(source_game.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(source_game.genres)),
        cover_image_url=normalize_story_cover_image_url(source_game.cover_image_url),
        cover_scale=normalize_story_cover_scale(source_game.cover_scale),
        cover_position_x=normalize_story_cover_position(source_game.cover_position_x),
        cover_position_y=normalize_story_cover_position(source_game.cover_position_y),
        source_world_id=source_game.source_world_id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(source_game.context_limit_chars),
        response_max_tokens=normalize_story_response_max_tokens(getattr(source_game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(source_game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(source_game, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(source_game, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(source_game, "image_style_prompt", None)),
        memory_optimization_enabled=bool(getattr(source_game, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(source_game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(source_game, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(source_game, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(source_game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(source_game, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(source_game, "ambient_enabled", None)),
        ambient_profile=str(getattr(source_game, "ambient_profile", "") or ""),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    clone_story_world_cards_to_game(
        db,
        source_world_id=source_game.id,
        target_game_id=cloned_game.id,
        copy_instructions=payload.copy_instructions,
        copy_plot=payload.copy_plot,
        copy_world=payload.copy_world,
        copy_main_hero=payload.copy_main_hero,
    )

    if payload.copy_history:
        source_messages = list_story_messages(db, source_game.id)
        message_id_map: dict[int, int] = {}
        for message in source_messages:
            cloned_message = StoryMessage(
                game_id=cloned_game.id,
                role=message.role,
                content=message.content,
            )
            db.add(cloned_message)
            db.flush()
            message_id_map[int(message.id)] = int(cloned_message.id)

        source_memory_blocks = list_story_memory_blocks(db, source_game.id)
        for block in source_memory_blocks:
            source_assistant_message_id = getattr(block, "assistant_message_id", None)
            target_assistant_message_id: int | None = None
            if source_assistant_message_id is not None:
                target_assistant_message_id = message_id_map.get(int(source_assistant_message_id))
            cloned_memory_block = StoryMemoryBlock(
                game_id=cloned_game.id,
                assistant_message_id=target_assistant_message_id,
                layer=str(block.layer or "raw"),
                title=str(block.title or ""),
                content=str(block.content or ""),
                token_count=max(int(getattr(block, "token_count", 0) or 0), 0),
            )
            db.add(cloned_memory_block)

    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return story_game_summary_to_out(cloned_game)


@router.post("/api/story/games/{game_id}/bug-reports", response_model=MessageResponse)
def create_story_bug_report(
    game_id: int,
    payload: StoryBugReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    title = _normalize_story_bug_report_title(payload.title)
    description = _normalize_story_bug_report_description(payload.description)
    snapshot_payload = _build_story_game_snapshot_payload(db, game)
    snapshot_payload_json = json.dumps(snapshot_payload, ensure_ascii=False, separators=(",", ":"))
    source_game_title = (str(game.title or "").strip() or f"Game #{int(game.id)}")[:STORY_GAME_TITLE_MAX_LENGTH]

    report = StoryBugReport(
        source_game_id=int(game.id),
        source_game_title=source_game_title,
        reporter_user_id=int(user.id),
        reporter_display_name=story_author_name(user),
        title=title,
        description=description,
        snapshot_payload=snapshot_payload_json,
        status=STORY_BUG_REPORT_STATUS_OPEN,
        closed_by_user_id=None,
        closed_at=None,
    )
    db.add(report)
    db.commit()
    return MessageResponse(message="Bug report submitted")


@router.patch("/api/story/games/{game_id}/settings", response_model=StoryGameSummaryOut)
def update_story_game_settings(
    game_id: int,
    payload: StoryGameSettingsUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    if payload.context_limit_chars is not None:
        game.context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    if payload.response_max_tokens is not None:
        game.response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    if payload.response_max_tokens_enabled is not None:
        game.response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(
            payload.response_max_tokens_enabled
        )
    if payload.story_llm_model is not None:
        game.story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    if payload.image_model is not None:
        game.image_model = normalize_story_image_model(payload.image_model)
    if payload.image_style_prompt is not None:
        game.image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    if payload.memory_optimization_enabled is not None:
        game.memory_optimization_enabled = bool(payload.memory_optimization_enabled)
    if payload.story_top_k is not None:
        game.story_top_k = normalize_story_top_k(payload.story_top_k)
    if payload.story_top_r is not None:
        game.story_top_r = normalize_story_top_r(payload.story_top_r)
    if payload.story_temperature is not None:
        game.story_temperature = normalize_story_temperature(payload.story_temperature)
    if payload.show_gg_thoughts is not None:
        game.show_gg_thoughts = normalize_story_show_gg_thoughts(payload.show_gg_thoughts)
    if payload.show_npc_thoughts is not None:
        game.show_npc_thoughts = normalize_story_show_npc_thoughts(payload.show_npc_thoughts)
    if payload.ambient_enabled is not None:
        game.ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.patch("/api/story/games/{game_id}/meta", response_model=StoryGameSummaryOut)
def update_story_game_meta(
    game_id: int,
    payload: StoryGameMetaUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    requested_visibility: str | None = None
    if payload.title is not None:
        normalized_title = payload.title.strip()
        game.title = normalized_title or STORY_DEFAULT_TITLE
    if payload.description is not None:
        game.description = normalize_story_game_description(payload.description)
    if payload.opening_scene is not None:
        game.opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    if payload.visibility is not None:
        requested_visibility = normalize_story_game_visibility(payload.visibility)
    if payload.age_rating is not None:
        game.age_rating = normalize_story_game_age_rating(payload.age_rating)
    if payload.genres is not None:
        game.genres = serialize_story_game_genres(normalize_story_game_genres(payload.genres))
    if payload.cover_image_url is not None:
        game.cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    if payload.cover_scale is not None:
        game.cover_scale = normalize_story_cover_scale(payload.cover_scale)
    if payload.cover_position_x is not None:
        game.cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    if payload.cover_position_y is not None:
        game.cover_position_y = normalize_story_cover_position(payload.cover_position_y)
    if requested_visibility is not None:
        if requested_visibility == STORY_GAME_VISIBILITY_PUBLIC and game.visibility != STORY_GAME_VISIBILITY_PUBLIC:
            _create_story_game_publication_copy_from_source(
                db,
                source_game=game,
                copy_cards=True,
            )
            game.visibility = STORY_GAME_VISIBILITY_PRIVATE
        else:
            game.visibility = requested_visibility

    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.delete("/api/story/games/{game_id}", response_model=MessageResponse)
def delete_story_game(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    _delete_story_game_with_relations(db, game_id=game.id)
    db.commit()
    return MessageResponse(message="Game deleted")
