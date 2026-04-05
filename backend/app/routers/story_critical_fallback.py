from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryGame, StoryMessage
from app.schemas import StoryGameOut, StoryGameSummaryOut, StoryInstructionCardOut, StoryMemoryBlockOut, StoryTurnImageOut
from app.services.auth_identity import get_current_user
from app.services.story_cards import story_plot_card_to_out
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_games import count_story_completed_turns, story_game_summary_to_compact_out, story_game_summary_to_out
from app.services.story_memory import resolve_story_current_location_label, story_memory_block_to_out
from app.services.story_messages import story_message_to_out
from app.services.story_queries import (
    get_user_story_game_or_404,
    has_story_assistant_redo_step,
    list_story_instruction_cards,
    list_story_memory_blocks,
    list_story_messages,
    list_story_plot_card_events,
    list_story_plot_cards,
    list_story_turn_images,
    list_story_world_card_events,
    list_story_world_cards,
)
from app.services.story_world_cards import story_world_card_to_out

games_router = APIRouter()
read_router = APIRouter()
logger = logging.getLogger(__name__)
_DEV_MEMORY_LAYERS = {"raw", "compressed", "super"}


def _apply_no_store_headers(response: Response | None) -> None:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Vary"] = "Authorization"


def _has_dev_memory_blocks(memory_blocks: list[object]) -> bool:
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value in _DEV_MEMORY_LAYERS:
            return True
    return False


def _count_raw_memory_blocks(memory_blocks: list[object]) -> int:
    count = 0
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value == "raw":
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


def _has_dev_memory_markup(memory_blocks: list[object]) -> bool:
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value not in _DEV_MEMORY_LAYERS:
            continue
        if "[[" in str(getattr(block, "content", "") or ""):
            return True
        if "[[" in str(getattr(block, "title", "") or ""):
            return True
    return False


def _has_non_compact_dev_memory(memory_blocks: list[object]) -> bool:
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


def _has_weather_block_for_assistant(memory_blocks: list[object], assistant_message_id: int) -> bool:
    target_assistant_message_id = int(assistant_message_id or 0)
    if target_assistant_message_id <= 0:
        return False
    for block in memory_blocks:
        layer_value = str(getattr(block, "layer", "") or "").strip().lower()
        if layer_value != "weather":
            continue
        if int(getattr(block, "assistant_message_id", 0) or 0) == target_assistant_message_id:
            return True
    return False


def _get_story_dev_raw_keep_turns() -> int:
    try:
        from app.services import story_memory_pipeline

        return max(
            int(getattr(story_memory_pipeline, "STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS", 1) or 1),
            1,
        )
    except Exception:
        logger.exception("Story fallback failed to resolve raw keep limit, using 1")
        return 1


def _self_heal_story_memory_and_environment_snapshot(
    *,
    db: Session,
    game: object,
    messages: list[object],
    memory_blocks: list[object],
) -> tuple[list[object], list[object]]:
    latest_assistant_message = next(
        (message for message in reversed(messages) if str(getattr(message, "role", "") or "") == "assistant"),
        None,
    )
    if latest_assistant_message is None:
        return messages, memory_blocks

    raw_memory_count = _count_raw_memory_blocks(memory_blocks)
    raw_keep_turns = _get_story_dev_raw_keep_turns()
    has_stale_raw_blocks = _has_stale_raw_dev_memory_blocks(
        db=db,
        game_id=int(getattr(game, "id", 0) or 0),
        memory_blocks=memory_blocks,
        keep_turns=raw_keep_turns,
    )
    should_heal_memory = (
        not _has_dev_memory_blocks(memory_blocks)
        or raw_memory_count > raw_keep_turns
        or has_stale_raw_blocks
        or _has_dev_memory_markup(memory_blocks)
        or _has_non_compact_dev_memory(memory_blocks)
    )
    environment_enabled = bool(getattr(game, "environment_enabled", None))
    has_current_datetime = bool(str(getattr(game, "environment_current_datetime", "") or "").strip())
    should_heal_environment = environment_enabled and (
        not has_current_datetime
        or not _has_weather_block_for_assistant(memory_blocks, int(getattr(latest_assistant_message, "id", 0) or 0))
    )
    if not should_heal_memory and not should_heal_environment:
        return messages, memory_blocks

    try:
        from app.services import story_memory_pipeline
    except Exception:
        logger.exception("Story fallback snapshot self-heal import failed: game_id=%s", getattr(game, "id", None))
        return messages, memory_blocks

    changed = False
    try:
        if should_heal_memory:
            if not bool(getattr(game, "memory_optimization_enabled", True)):
                game.memory_optimization_enabled = True
                changed = True
            changed = bool(
                story_memory_pipeline._sync_story_raw_memory_blocks_for_recent_turns(
                    db=db,
                    game=game,
                    additional_assistant_message_ids=[int(getattr(latest_assistant_message, "id", 0) or 0)],
                )
            ) or changed
            try:
                story_memory_pipeline._rebalance_story_memory_layers(db=db, game=game)
                changed = True
            except Exception:
                logger.exception(
                    "Story fallback snapshot memory rebalance failed: game_id=%s raw_blocks=%s",
                    getattr(game, "id", None),
                    raw_memory_count,
                )

        if should_heal_environment:
            current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
                db=db,
                game_id=int(getattr(game, "id", 0) or 0),
            )
            changed = bool(
                story_memory_pipeline._sync_story_environment_state_for_assistant_message(
                    db=db,
                    game=game,
                    assistant_message=latest_assistant_message,
                    current_location_content_override=current_location_content,
                    resolved_payload_override={"action": "keep"},
                    allow_weather_seed=False,
                )
            ) or changed
    except Exception:
        logger.exception(
            "Story fallback snapshot self-heal failed: game_id=%s assistant_message_id=%s",
            getattr(game, "id", None),
            getattr(latest_assistant_message, "id", None),
        )
        try:
            db.rollback()
        except Exception:
            pass
        return messages, memory_blocks

    if not changed:
        return messages, memory_blocks

    try:
        from app.services.story_queries import touch_story_game

        touch_story_game(game)
        db.commit()
        db.refresh(game)
    except Exception:
        logger.exception("Story fallback snapshot self-heal commit failed: game_id=%s", getattr(game, "id", None))
        db.rollback()
        return messages, memory_blocks

    return list_story_messages(db, int(getattr(game, "id", 0) or 0)), list_story_memory_blocks(
        db,
        int(getattr(game, "id", 0) or 0),
    )


@games_router.get("/api/story/games", response_model=list[StoryGameSummaryOut])
def list_story_games_fallback_router(
    response: Response,
    compact: bool = False,
    limit: int | None = Query(default=None, ge=1, le=200),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryGameSummaryOut]:
    _apply_no_store_headers(response)
    user = get_current_user(db, authorization)
    query = (
        select(StoryGame)
        .where(StoryGame.user_id == user.id)
        .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
    )
    if limit is not None:
        query = query.limit(limit)
    games = db.scalars(query).all()
    if not games:
        return []

    summaries: list[StoryGameSummaryOut] = []
    for game in games:
        messages = list_story_messages(db, game.id)
        turn_count = count_story_completed_turns(messages)
        if compact:
            latest_assistant_message = next(
                (message for message in reversed(messages) if getattr(message, "role", "") == "assistant"),
                None,
            )
            latest_preview = (
                str(getattr(latest_assistant_message, "content", "") or "").replace("\r\n", "\n").strip()[:240] or None
            )
            summaries.append(
                story_game_summary_to_compact_out(
                    game,
                    latest_message_preview=latest_preview,
                    turn_count=turn_count,
                )
            )
        else:
            summaries.append(
                story_game_summary_to_out(
                    game,
                    turn_count=turn_count,
                )
            )
    return summaries


@read_router.get("/api/story/games/{game_id}", response_model=StoryGameOut)
def get_story_game_fallback_router(
    game_id: int,
    response: Response,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameOut:
    _apply_no_store_headers(response)
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    messages = list_story_messages(db, game.id)
    turn_images = list_story_turn_images(db, game.id)
    instruction_cards = list_story_instruction_cards(db, game.id)
    plot_cards = list_story_plot_cards(db, game.id)
    plot_card_events = list_story_plot_card_events(db, game.id)
    memory_blocks = list_story_memory_blocks(db, game.id)
    messages, memory_blocks = _self_heal_story_memory_and_environment_snapshot(
        db=db,
        game=game,
        messages=messages,
        memory_blocks=memory_blocks,
    )
    world_cards = list_story_world_cards(db, game.id)
    world_card_events = list_story_world_card_events(db, game.id)
    can_redo_assistant_step = has_story_assistant_redo_step(db, game.id)
    game_summary = story_game_summary_to_out(game, turn_count=count_story_completed_turns(messages))
    resolved_current_location_label = resolve_story_current_location_label(
        getattr(game_summary, "current_location_label", None),
        memory_blocks,
    )
    if resolved_current_location_label != getattr(game_summary, "current_location_label", None):
        game_summary = game_summary.model_copy(update={"current_location_label": resolved_current_location_label})
    logger.info(
        "Story read route response: route=fallback requested_game_id=%s returned_game_id=%s messages=%s memory_blocks=%s",
        game_id,
        game.id,
        len(messages),
        len(memory_blocks),
    )
    return StoryGameOut(
        game=game_summary,
        messages=[story_message_to_out(message) for message in messages],
        turn_images=[StoryTurnImageOut.model_validate(item) for item in turn_images],
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        plot_cards=[story_plot_card_to_out(card) for card in plot_cards],
        plot_card_events=[story_plot_card_change_event_to_out(event) for event in plot_card_events],
        memory_blocks=[StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block)) for block in memory_blocks],
        world_cards=[story_world_card_to_out(card) for card in world_cards],
        world_card_events=[story_world_card_change_event_to_out(event) for event in world_card_events],
        can_redo_assistant_step=can_redo_assistant_step,
    )
