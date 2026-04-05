from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityWorldFavorite,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryMessage,
    User,
)
from app.schemas import (
    StoryCommunityWorldOut,
    StoryGameOut,
    StoryInstructionCardOut,
    StoryMemoryBlockOut,
    StoryMessageOut,
    StoryTurnImageOut,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import increment_story_world_views
from app.services.story_cards import story_plot_card_to_out
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_games import (
    count_story_completed_turns,
    ensure_story_game_public_card_snapshots,
    get_story_game_public_cards_out,
    STORY_DEFAULT_TITLE,
    story_author_avatar_url,
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_compact_out,
    story_game_summary_to_out,
)
from app.services.story_memory import story_memory_block_to_out
from app.services.story_memory import resolve_story_current_location_label
from app.services.story_messages import story_message_to_out
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    has_story_assistant_redo_step,
    list_story_instruction_cards,
    list_story_memory_blocks,
    list_story_messages,
    list_story_messages_window,
    list_story_turn_images,
    list_story_plot_card_events,
    list_story_plot_cards,
    list_story_world_card_events,
    list_story_world_cards,
)
from app.services.story_world_comments import list_story_community_world_comments_out
from app.services.story_world_cards import story_world_card_to_out

router = APIRouter()
logger = logging.getLogger(__name__)
_DEV_MEMORY_LAYERS = {"raw", "compressed", "super"}
_STORY_GAME_MESSAGES_DEFAULT_ASSISTANT_TURNS = 20


def _safe_story_read_map(
    *,
    section_name: str,
    game_id: int,
    items: list[object],
    serializer,
) -> list[object]:
    serialized_items: list[object] = []
    for item in items:
        try:
            serialized_items.append(serializer(item))
        except Exception:
            logger.exception(
                "Story read skipped broken %s item: game_id=%s item_id=%s",
                section_name,
                game_id,
                getattr(item, "id", None),
            )
    return serialized_items


def _safe_story_read_query(
    *,
    section_name: str,
    game_id: int,
    loader,
) -> list[object]:
    try:
        loaded_items = loader()
    except Exception:
        logger.exception(
            "Story read skipped broken %s query: game_id=%s",
            section_name,
            game_id,
        )
        return []
    return list(loaded_items or [])


def _get_story_dev_raw_keep_turns() -> int:
    try:
        from app.services import story_memory_pipeline

        return max(
            int(getattr(story_memory_pipeline, "STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS", 1) or 1),
            1,
        )
    except Exception:
        logger.exception("Failed to resolve story raw keep limit, using 1")
        return 1


def _has_story_memory_markup_artifacts(memory_blocks: list[object]) -> bool:
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value not in _DEV_MEMORY_LAYERS:
            continue
        content_value = str(getattr(block, "content", "") or "")
        title_value = str(getattr(block, "title", "") or "")
        if "[[" in content_value or "[[" in title_value:
            return True
    return False


def _count_story_dev_memory_blocks(memory_blocks: list[object]) -> int:
    count = 0
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value in _DEV_MEMORY_LAYERS:
            count += 1
    return count


def _list_latest_story_assistant_message_ids(
    *,
    db: Session,
    game_id: int,
    limit: int = 1,
) -> set[int]:
    normalized_limit = max(int(limit or 0), 1)
    return {
        int(message_id)
        for message_id in db.scalars(
            select(StoryMessage.id)
            .where(
                StoryMessage.game_id == int(game_id),
                StoryMessage.role == "assistant",
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(normalized_limit)
        ).all()
    }


def _has_stale_raw_dev_memory_blocks(
    *,
    db: Session,
    game_id: int,
    memory_blocks: list[object],
    keep_turns: int = 1,
) -> bool:
    latest_assistant_message_ids = _list_latest_story_assistant_message_ids(
        db=db,
        game_id=game_id,
        limit=keep_turns,
    )
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value != "raw":
            continue
        assistant_message_id = int(getattr(block, "assistant_message_id", 0) or 0)
        if assistant_message_id <= 0:
            return True
        if assistant_message_id not in latest_assistant_message_ids:
            return True
    return False


def _has_non_compact_dev_memory_blocks(memory_blocks: list[object]) -> bool:
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value not in {"compressed", "super"}:
            continue
        title_value = str(getattr(block, "title", "") or "")
        content_value = str(getattr(block, "content", "") or "").replace("\r\n", "\n").strip()
        lowered = content_value.casefold()
        if (
            ("ход игрока" in lowered and ("ответ мастера" in lowered or "ответ рассказчика" in lowered))
            or ("полный текст" in lowered and ("ход игрока" in lowered or "ответ мастера" in lowered))
        ):
            return True
        if "полный текст" in title_value.casefold():
            return True
    return False


def _maybe_self_heal_story_memory_blocks(
    *,
    db: Session,
    game: object,
    memory_blocks: list[object],
) -> list[object]:
    raw_blocks = [
        block
        for block in memory_blocks
        if str(getattr(block, "layer", "") or "").strip().lower() == "raw"
    ]
    has_stale_raw_blocks = _has_stale_raw_dev_memory_blocks(
        db=db,
        game_id=int(getattr(game, "id", 0) or 0),
        memory_blocks=memory_blocks,
        keep_turns=_get_story_dev_raw_keep_turns(),
    )
    has_markup = _has_story_memory_markup_artifacts(memory_blocks)
    has_non_compact_blocks = _has_non_compact_dev_memory_blocks(memory_blocks)
    if (
        len(raw_blocks) <= _get_story_dev_raw_keep_turns()
        and not has_markup
        and not has_non_compact_blocks
        and not has_stale_raw_blocks
    ):
        return memory_blocks

    # Page load must stay cheap and predictable. Heavy memory optimization is now
    # handled explicitly via POST /api/story/games/{game_id}/memory/optimize
    # after generation/edit, not during GET /api/story/games/{game_id}.
    logger.info(
        "Story read skipped auto-heal during page load: game_id=%s raw_blocks=%s has_stale_raw=%s has_markup=%s has_non_compact=%s",
        getattr(game, "id", None),
        len(raw_blocks),
        has_stale_raw_blocks,
        has_markup,
        has_non_compact_blocks,
    )
    return memory_blocks


def _build_story_game_out_resilient(
    *,
    db: Session,
    game: object,
    requested_game_id: int,
    messages: list[object],
    has_older_messages: bool,
    ) -> StoryGameOut:
    resolved_game_id = int(getattr(game, "id", 0) or 0)
    turn_images = _safe_story_read_query(
        section_name="turn_images",
        game_id=resolved_game_id,
        loader=lambda: list_story_turn_images(db, resolved_game_id),
    )
    instruction_cards = _safe_story_read_query(
        section_name="instruction_cards",
        game_id=resolved_game_id,
        loader=lambda: list_story_instruction_cards(db, resolved_game_id),
    )
    plot_cards = _safe_story_read_query(
        section_name="plot_cards",
        game_id=resolved_game_id,
        loader=lambda: list_story_plot_cards(db, resolved_game_id),
    )
    plot_card_events = _safe_story_read_query(
        section_name="plot_card_events",
        game_id=resolved_game_id,
        loader=lambda: list_story_plot_card_events(db, resolved_game_id),
    )
    memory_blocks = _safe_story_read_query(
        section_name="memory_blocks",
        game_id=resolved_game_id,
        loader=lambda: list_story_memory_blocks(db, resolved_game_id),
    )
    try:
        memory_blocks = _maybe_self_heal_story_memory_blocks(
            db=db,
            game=game,
            memory_blocks=memory_blocks,
        )
    except Exception:
        logger.exception(
            "Story read skipped memory self-heal wrapper: game_id=%s",
            resolved_game_id,
        )
    world_cards = _safe_story_read_query(
        section_name="world_cards",
        game_id=resolved_game_id,
        loader=lambda: list_story_world_cards(db, resolved_game_id),
    )
    world_card_events = _safe_story_read_query(
        section_name="world_card_events",
        game_id=resolved_game_id,
        loader=lambda: list_story_world_card_events(db, resolved_game_id),
    )
    try:
        can_redo_assistant_step = has_story_assistant_redo_step(db, resolved_game_id)
    except Exception:
        logger.exception(
            "Story read skipped redo-state check: game_id=%s",
            resolved_game_id,
        )
        can_redo_assistant_step = False
    try:
        summary_messages = messages if not has_older_messages else list_story_messages(db, resolved_game_id)
        game_summary = story_game_summary_to_out(
            game,
            turn_count=count_story_completed_turns(summary_messages),
        )
    except Exception:
        logger.exception(
            "Story read full summary failed, using compact fallback: game_id=%s requested_game_id=%s",
            resolved_game_id,
            requested_game_id,
        )
        try:
            game_summary = story_game_summary_to_compact_out(
                game,
                latest_message_preview=None,
                turn_count=count_story_completed_turns(messages),
            ).model_copy(
                update={
                    "opening_scene": str(getattr(game, "opening_scene", "") or "").strip(),
                    "title": str(getattr(game, "title", "") or "").strip() or STORY_DEFAULT_TITLE,
                    "description": str(getattr(game, "description", "") or "").strip(),
                }
            )
        except Exception:
            logger.exception(
                "Story read compact summary fallback failed, using ultra-minimal summary: game_id=%s requested_game_id=%s",
                resolved_game_id,
                requested_game_id,
            )
            game_summary = story_game_summary_to_compact_out(
                type(
                    "StoryReadFallbackGame",
                    (),
                    {
                        "id": resolved_game_id,
                        "title": str(getattr(game, "title", "") or "").strip() or STORY_DEFAULT_TITLE,
                        "description": str(getattr(game, "description", "") or "").strip(),
                        "visibility": str(getattr(game, "visibility", "private") or "private"),
                        "publication_status": getattr(game, "publication_status", None),
                        "publication_requested_at": getattr(game, "publication_requested_at", None),
                        "publication_reviewed_at": getattr(game, "publication_reviewed_at", None),
                        "publication_reviewer_user_id": getattr(game, "publication_reviewer_user_id", None),
                        "publication_rejection_reason": getattr(game, "publication_rejection_reason", None),
                        "age_rating": str(getattr(game, "age_rating", "18+") or "18+"),
                        "genres": str(getattr(game, "genres", "") or ""),
                        "cover_image_url": getattr(game, "cover_image_url", None),
                        "cover_scale": getattr(game, "cover_scale", None),
                        "cover_position_x": getattr(game, "cover_position_x", None),
                        "cover_position_y": getattr(game, "cover_position_y", None),
                        "source_world_id": getattr(game, "source_world_id", None),
                        "community_views": getattr(game, "community_views", 0),
                        "community_launches": getattr(game, "community_launches", 0),
                        "community_rating_sum": getattr(game, "community_rating_sum", 0),
                        "community_rating_count": getattr(game, "community_rating_count", 0),
                        "context_limit_chars": getattr(game, "context_limit_chars", 12000),
                        "response_max_tokens": getattr(game, "response_max_tokens", None),
                        "response_max_tokens_enabled": getattr(game, "response_max_tokens_enabled", None),
                        "story_llm_model": getattr(game, "story_llm_model", None),
                        "image_model": getattr(game, "image_model", None),
                        "memory_optimization_enabled": getattr(game, "memory_optimization_enabled", True),
                        "story_top_k": getattr(game, "story_top_k", None),
                        "story_top_r": getattr(game, "story_top_r", None),
                        "story_temperature": getattr(game, "story_temperature", None),
                        "show_gg_thoughts": getattr(game, "show_gg_thoughts", None),
                        "show_npc_thoughts": getattr(game, "show_npc_thoughts", None),
                        "ambient_enabled": getattr(game, "ambient_enabled", None),
                        "environment_enabled": getattr(game, "environment_enabled", False),
                        "emotion_visualization_enabled": getattr(game, "emotion_visualization_enabled", False),
                        "environment_current_datetime": getattr(game, "environment_current_datetime", None),
                        "environment_current_weather": getattr(game, "environment_current_weather", None),
                        "environment_tomorrow_weather": getattr(game, "environment_tomorrow_weather", None),
                        "current_location_label": getattr(game, "current_location_label", None),
                        "last_activity_at": getattr(game, "last_activity_at", None),
                        "created_at": getattr(game, "created_at", None),
                        "updated_at": getattr(game, "updated_at", None),
                    },
                )(),
                latest_message_preview=None,
                turn_count=count_story_completed_turns(messages),
            ).model_copy(
                update={
                    "opening_scene": str(getattr(game, "opening_scene", "") or "").strip(),
                }
            )
    try:
        resolved_current_location_label = resolve_story_current_location_label(
            getattr(game_summary, "current_location_label", None),
            memory_blocks,
        )
    except Exception:
        logger.exception(
            "Story read skipped current location resolution: game_id=%s requested_game_id=%s",
            getattr(game, "id", None),
            requested_game_id,
        )
        resolved_current_location_label = getattr(game_summary, "current_location_label", None)
    if resolved_current_location_label != getattr(game_summary, "current_location_label", None):
        game_summary = game_summary.model_copy(update={"current_location_label": resolved_current_location_label})

    logger.info(
        "Story read route response: requested_game_id=%s returned_game_id=%s messages=%s memory_blocks=%s has_older_messages=%s",
        requested_game_id,
        getattr(game, "id", None),
        len(messages),
        len(memory_blocks),
        has_older_messages,
    )
    return StoryGameOut(
        game=game_summary,
        messages=_safe_story_read_map(
            section_name="messages",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(messages),
            serializer=story_message_to_out,
        ),
        has_older_messages=has_older_messages,
        turn_images=_safe_story_read_map(
            section_name="turn_images",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(turn_images),
            serializer=lambda item: StoryTurnImageOut.model_validate(item),
        ),
        instruction_cards=_safe_story_read_map(
            section_name="instruction_cards",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(instruction_cards),
            serializer=lambda item: StoryInstructionCardOut.model_validate(item),
        ),
        plot_cards=_safe_story_read_map(
            section_name="plot_cards",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(plot_cards),
            serializer=story_plot_card_to_out,
        ),
        plot_card_events=_safe_story_read_map(
            section_name="plot_card_events",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(plot_card_events),
            serializer=story_plot_card_change_event_to_out,
        ),
        memory_blocks=_safe_story_read_map(
            section_name="memory_blocks",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(memory_blocks),
            serializer=lambda item: StoryMemoryBlockOut.model_validate(story_memory_block_to_out(item)),
        ),
        world_cards=_safe_story_read_map(
            section_name="world_cards",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(world_cards),
            serializer=story_world_card_to_out,
        ),
        world_card_events=_safe_story_read_map(
            section_name="world_card_events",
            game_id=int(getattr(game, "id", 0) or 0),
            items=list(world_card_events),
            serializer=story_world_card_change_event_to_out,
        ),
        can_redo_assistant_step=can_redo_assistant_step,
    )


@router.get("/api/story/community/worlds/{world_id}", response_model=StoryCommunityWorldOut)
def get_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    view_inserted = False
    try:
        with db.begin_nested():
            db.add(
                StoryCommunityWorldView(
                    world_id=world.id,
                    user_id=user.id,
                )
            )
            db.flush()
        view_inserted = True
    except IntegrityError:
        view_inserted = False

    snapshot_backfilled = ensure_story_game_public_card_snapshots(db, world)
    if view_inserted:
        increment_story_world_views(db, world.id)
    if view_inserted or snapshot_backfilled:
        db.commit()
        db.refresh(world)

    author = db.scalar(select(User).where(User.id == world.user_id))
    user_rating = db.scalar(
        select(StoryCommunityWorldRating.rating).where(
            StoryCommunityWorldRating.world_id == world.id,
            StoryCommunityWorldRating.user_id == user.id,
        )
    )
    user_report = db.scalar(
        select(StoryCommunityWorldReport.id).where(
            StoryCommunityWorldReport.world_id == world.id,
            StoryCommunityWorldReport.reporter_user_id == user.id,
        )
    )
    user_favorite = db.scalar(
        select(StoryCommunityWorldFavorite.id).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    instruction_cards, plot_cards, world_cards = get_story_game_public_cards_out(db, world)
    comments = list_story_community_world_comments_out(db, world_id=world.id)

    return StoryCommunityWorldOut(
        world=story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=story_author_name(author),
            author_avatar_url=story_author_avatar_url(author),
            user_rating=int(user_rating) if user_rating is not None else None,
            is_reported_by_user=user_report is not None,
            is_favorited_by_user=user_favorite is not None,
        ),
        context_limit_chars=world.context_limit_chars,
        instruction_cards=instruction_cards,
        plot_cards=plot_cards,
        world_cards=world_cards,
        comments=comments,
    )


@router.get("/api/story/games/{game_id}", response_model=StoryGameOut)
def get_story_game(
    game_id: int,
    response: Response,
    assistant_turns_limit: int = _STORY_GAME_MESSAGES_DEFAULT_ASSISTANT_TURNS,
    before_message_id: int | None = None,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameOut:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Vary"] = "Authorization"
    user = get_current_user(db, authorization)
    try:
        game = get_user_story_game_or_404(db, user.id, game_id)
        messages, has_older_messages = list_story_messages_window(
            db,
            int(getattr(game, "id", 0) or 0),
            assistant_turns_limit=assistant_turns_limit,
            before_message_id=before_message_id,
        )
        return _build_story_game_out_resilient(
            db=db,
            game=game,
            requested_game_id=game_id,
            messages=list(messages),
            has_older_messages=has_older_messages,
        )
    except Exception:
        logger.exception("Story read primary route failed, retrying legacy load: requested_game_id=%s", game_id)
        try:
            db.rollback()
        except Exception:
            pass
        game = get_user_story_game_or_404(db, user.id, game_id)
        messages = list_story_messages(db, int(getattr(game, "id", 0) or 0))
        return _build_story_game_out_resilient(
            db=db,
            game=game,
            requested_game_id=game_id,
            messages=list(messages),
            has_older_messages=False,
        )
