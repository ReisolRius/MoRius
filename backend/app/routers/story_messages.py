from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMemoryBlock, StoryMessage, StoryNovelBeat, StoryWorldCard
from app.schemas import StoryMessageOut, StoryMessageSelectVariantRequest, StoryMessageUpdateRequest
from app.services.auth_identity import get_current_user
from app.services.story_memory import (
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_FACTS,
    STORY_MEMORY_LAYER_FRESH_DETAILED,
    STORY_MEMORY_LAYER_LATEST_FULL,
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_RAW_PENDING,
    STORY_MEMORY_LAYER_SUPER,
    normalize_story_memory_block_content,
    normalize_story_memory_block_title,
    normalize_story_memory_layer,
)
from app.services.sqlite_write_guard import commit_with_retry, is_database_busy_session_error
from app.services.story_game_operation_lock import (
    STORY_GAME_OPERATION_BUSY_DETAIL,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)
from app.services.story_messages import parse_story_message_variant_history, story_message_to_out
from app.services.story_novel import (
    is_story_visual_novel_enabled,
    persist_story_novel_beats_for_message,
)
from app.services.story_queries import get_user_story_game_or_404, touch_story_game
from app.services.story_text import normalize_story_text

router = APIRouter()
logger = logging.getLogger(__name__)
STORY_MESSAGE_BUSY_DETAIL = STORY_GAME_OPERATION_BUSY_DETAIL
_STORY_OPERATION_LOCK_TIMEOUT_SECONDS = 15.0
_STORY_INLINE_EDIT_RAW_KEEP_LATEST_ASSISTANT_TURNS = 1
_STORY_INLINE_EDIT_REPLACEABLE_MEMORY_LAYERS = {
    STORY_MEMORY_LAYER_LATEST_FULL,
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_FRESH_DETAILED,
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_SUPER,
    STORY_MEMORY_LAYER_FACTS,
    STORY_MEMORY_LAYER_RAW_PENDING,
}


def _acquire_story_operation_lease_or_409(*, game_id: int, operation: str):
    try:
        return acquire_story_game_operation_lock(
            game_id,
            operation=operation,
            wait_timeout_seconds=_STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
        )
    except StoryGameOperationBusyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=STORY_MESSAGE_BUSY_DETAIL,
        ) from exc


def _normalize_story_message_content(content: str | None) -> str:
    return str(content or "").replace("\r\n", "\n").strip()


def _estimate_story_tokens(value: str) -> int:
    normalized = str(value or "").strip()
    if not normalized:
        return 0
    return max(1, (len(normalized) + 3) // 4)


def _build_story_raw_memory_block_title(content: str) -> str:
    first_content_line = next(
        (
            " ".join(line.split()).strip()
            for line in str(content or "").splitlines()
            if " ".join(line.split()).strip()
        ),
        "",
    )
    return normalize_story_memory_block_title(first_content_line[:120].strip(), fallback="Свежий ход")


def _list_latest_assistant_message_ids(db: Session, game_id: int, *, limit: int) -> list[int]:
    normalized_limit = max(int(limit or 0), 1)
    rows = db.scalars(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == "assistant",
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(normalized_limit)
    ).all()
    return [int(row) for row in rows if int(row or 0) > 0]


def _get_story_main_hero_name_for_raw_memory(db: Session, *, game_id: int) -> str:
    raw_title = db.scalar(
        select(StoryWorldCard.title)
        .where(
            StoryWorldCard.game_id == game_id,
            StoryWorldCard.kind == "main_hero",
        )
        .order_by(StoryWorldCard.id.asc())
        .limit(1)
    )
    normalized = " ".join(str(raw_title or "").split()).strip()
    return normalized or "игрок"


def _get_story_user_message_before_assistant(
    db: Session,
    *,
    game_id: int,
    assistant_message_id: int,
) -> StoryMessage | None:
    return db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == "user",
            StoryMessage.id < assistant_message_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )


def _build_latest_turn_raw_memory_content(
    *,
    user_text: str | None,
    assistant_text: str | None,
    main_hero_name: str,
) -> str:
    normalized_user_text = _normalize_story_message_content(user_text)
    normalized_assistant_text = _normalize_story_message_content(assistant_text)
    normalized_main_hero_name = " ".join(str(main_hero_name or "").split()).strip() or "игрок"
    parts: list[str] = []
    if normalized_user_text:
        parts.append(f"Ход игрока: {normalized_main_hero_name} (полный текст):\n{normalized_user_text}")
    if normalized_assistant_text:
        parts.append(f"Ответ рассказчика (полный текст):\n{normalized_assistant_text}")
    return "\n\n".join(parts).strip()


def _upsert_latest_turn_raw_memory_block(
    *,
    db: Session,
    game,
    assistant_message: StoryMessage,
) -> None:
    user_message = _get_story_user_message_before_assistant(
        db,
        game_id=int(game.id),
        assistant_message_id=int(assistant_message.id),
    )
    raw_content = _build_latest_turn_raw_memory_content(
        user_text=getattr(user_message, "content", None),
        assistant_text=getattr(assistant_message, "content", None),
        main_hero_name=_get_story_main_hero_name_for_raw_memory(db, game_id=int(game.id)),
    )
    active_turn_memory_blocks = db.scalars(
        select(StoryMemoryBlock)
        .where(
            StoryMemoryBlock.game_id == int(game.id),
            StoryMemoryBlock.assistant_message_id == int(assistant_message.id),
            StoryMemoryBlock.undone_at.is_(None),
        )
        .order_by(StoryMemoryBlock.id.asc())
    ).all()
    turn_memory_blocks = [
        block
        for block in active_turn_memory_blocks
        if normalize_story_memory_layer(block.layer) in _STORY_INLINE_EDIT_REPLACEABLE_MEMORY_LAYERS
    ]

    changed = False

    if not raw_content:
        for block in turn_memory_blocks:
            db.delete(block)
            changed = True
        if changed:
            db.flush()
        return

    normalized_content = normalize_story_memory_block_content(raw_content)
    normalized_title = _build_story_raw_memory_block_title(normalized_content)
    token_count = _estimate_story_tokens(normalized_content)
    primary_block = next(
        (
            block
            for block in turn_memory_blocks
            if normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_LATEST_FULL
        ),
        None,
    )
    if primary_block is None:
        primary_block = next(
            (
                block
                for block in turn_memory_blocks
                if normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
            ),
            None,
        )
    if primary_block is None and turn_memory_blocks:
        primary_block = turn_memory_blocks[0]
    if primary_block is None:
        db.add(
            StoryMemoryBlock(
                game_id=int(game.id),
                assistant_message_id=int(assistant_message.id),
                layer=STORY_MEMORY_LAYER_LATEST_FULL,
                title=normalized_title,
                content=normalized_content,
                token_count=token_count,
            )
        )
        db.flush()
        return

    if normalize_story_memory_layer(primary_block.layer) != STORY_MEMORY_LAYER_LATEST_FULL:
        primary_block.layer = STORY_MEMORY_LAYER_LATEST_FULL
        changed = True
    if primary_block.title != normalized_title:
        primary_block.title = normalized_title
        changed = True
    if primary_block.content != normalized_content:
        primary_block.content = normalized_content
        changed = True
    if int(getattr(primary_block, "token_count", 0) or 0) != token_count:
        primary_block.token_count = token_count
        changed = True
    for duplicate_block in turn_memory_blocks:
        if duplicate_block is primary_block:
            continue
        db.delete(duplicate_block)
        changed = True
    if changed:
        db.flush()


def _sync_turn_raw_memory_after_message_update(
    *,
    db: Session,
    game,
    message: StoryMessage,
) -> None:
    try:
        target_assistant_message: StoryMessage | None = None
        if message.role == "assistant":
            target_assistant_message = message
        elif message.role == "user":
            target_assistant_message = db.scalar(
                select(StoryMessage)
                .where(
                    StoryMessage.game_id == game.id,
                    StoryMessage.role == "assistant",
                    StoryMessage.id > message.id,
                    StoryMessage.undone_at.is_(None),
                )
                .order_by(StoryMessage.id.asc())
                .limit(1)
            )

        if target_assistant_message is None:
            return

        latest_assistant_ids = set(
            _list_latest_assistant_message_ids(
                db,
                int(game.id),
                limit=_STORY_INLINE_EDIT_RAW_KEEP_LATEST_ASSISTANT_TURNS,
            )
        )
        if int(target_assistant_message.id) not in latest_assistant_ids:
            return

        _upsert_latest_turn_raw_memory_block(
            db=db,
            game=game,
            assistant_message=target_assistant_message,
        )
    except Exception:
        logger.exception(
            "Story message update saved but latest turn memory sync failed: game_id=%s message_id=%s",
            getattr(game, "id", None),
            getattr(message, "id", None),
        )


def _sync_story_novel_beats_after_assistant_message_update(
    *,
    db: Session,
    game,
    user,
    message: StoryMessage,
) -> None:
    """Keep persisted VN pages aligned with an edited/selected assistant variant.

    RPG games retain the historical cleanup behavior.  In an enabled admin Visual Novel game,
    ``persist_story_novel_beats_for_message`` atomically replaces the old rows with a parse of
    the message's newly canonical content and relinks speakers against current world cards.
    """
    if message.role != "assistant":
        return
    if not is_story_visual_novel_enabled(game, user):
        db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.message_id == message.id))
        return

    world_cards = list(
        db.scalars(
            select(StoryWorldCard)
            .where(StoryWorldCard.game_id == int(game.id))
            .order_by(StoryWorldCard.id.asc())
        ).all()
    )
    persist_story_novel_beats_for_message(
        db=db,
        game=game,
        assistant_message=message,
        raw_response=str(message.content or ""),
        world_cards=world_cards,
    )


@router.patch("/api/story/games/{game_id}/messages/{message_id}", response_model=StoryMessageOut)
def update_story_message(
    game_id: int,
    message_id: int,
    payload: StoryMessageUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMessageOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    with _acquire_story_operation_lease_or_409(game_id=game.id, operation="story_message_update"):
        message = db.scalar(
            select(StoryMessage).where(
                StoryMessage.id == message_id,
                StoryMessage.game_id == game.id,
                StoryMessage.undone_at.is_(None),
            )
        )
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        next_content = str(payload.content or "").replace("\r\n", "\n").strip()
        logger.info(
            "Story message update requested: game_id=%s message_id=%s role=%s content_len=%s",
            game.id,
            message.id,
            message.role,
            len(next_content),
        )
        if next_content:
            message.content = normalize_story_text(next_content)
        elif message.role == "assistant":
            message.content = ""
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story text cannot be empty")
        if message.role == "assistant":
            # A manual edit is a deliberate override of whatever variant was showing -- drop the
            # reroll variant log rather than leave it pointing at now-stale text.
            message.variant_history_json = "[]"
            message.active_variant_index = 0
            _sync_story_novel_beats_after_assistant_message_update(
                db=db,
                game=game,
                user=user,
                message=message,
            )

        _sync_turn_raw_memory_after_message_update(db=db, game=game, message=message)
        touch_story_game(game)
        try:
            commit_with_retry(db)
        except Exception as exc:
            if is_database_busy_session_error(exc):
                logger.warning(
                    "Story message update hit database busy state: game_id=%s message_id=%s",
                    game.id,
                    message.id,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=STORY_MESSAGE_BUSY_DETAIL,
                ) from exc
            logger.exception(
                "Story message update commit failed: game_id=%s message_id=%s",
                game.id,
                message.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update story message",
            ) from exc
        db.refresh(message)
        return story_message_to_out(message)


@router.post(
    "/api/story/games/{game_id}/messages/{message_id}/select-variant",
    response_model=StoryMessageOut,
)
def select_story_message_variant(
    game_id: int,
    message_id: int,
    payload: StoryMessageSelectVariantRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMessageOut:
    """Switch the displayed/canonical text of the last assistant message to one of its
    discarded reroll variants (or back to the newest one), without re-running generation."""
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    with _acquire_story_operation_lease_or_409(game_id=game.id, operation="story_message_select_variant"):
        message = db.scalar(
            select(StoryMessage).where(
                StoryMessage.id == message_id,
                StoryMessage.game_id == game.id,
                StoryMessage.role == "assistant",
                StoryMessage.undone_at.is_(None),
            )
        )
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        # variant_history_json is a stable, append-only chronological log of every attempt made
        # for this turn; selecting a variant only moves the active pointer and mirrors that log
        # entry's text onto the message -- it never reorders or removes log entries.
        variant_log = parse_story_message_variant_history(message.variant_history_json)
        if not variant_log or payload.variant_index >= len(variant_log):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant index")

        selected = variant_log[payload.variant_index]
        message.content = selected["content"]
        message.active_variant_index = payload.variant_index
        _sync_story_novel_beats_after_assistant_message_update(
            db=db,
            game=game,
            user=user,
            message=message,
        )

        _sync_turn_raw_memory_after_message_update(db=db, game=game, message=message)
        touch_story_game(game)
        try:
            commit_with_retry(db)
        except Exception as exc:
            if is_database_busy_session_error(exc):
                logger.warning(
                    "Story message variant switch hit database busy state: game_id=%s message_id=%s",
                    game.id,
                    message.id,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=STORY_MESSAGE_BUSY_DETAIL,
                ) from exc
            logger.exception(
                "Story message variant switch commit failed: game_id=%s message_id=%s",
                game.id,
                message.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to switch story message variant",
            ) from exc
        db.refresh(message)
        return story_message_to_out(message)

