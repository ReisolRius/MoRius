from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMemoryBlock, StoryMessage
from app.schemas import (
    MessageResponse,
    StoryMemoryBlockCreateRequest,
    StoryMemoryBlockOut,
    StoryMemoryOptimizeRequest,
    StoryMemoryBlockUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_memory import (
    STORY_MEMORY_LAYER_KEY,
    normalize_story_memory_block_content,
    normalize_story_memory_block_title,
    normalize_story_memory_layer,
    story_memory_block_to_out,
)
from app.services.story_queries import get_user_story_game_or_404, list_story_memory_blocks, touch_story_game

router = APIRouter()
logger = logging.getLogger(__name__)

_MEMORY_TOKEN_ESTIMATE_PATTERN = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+|[^\s]", re.IGNORECASE)


def _estimate_memory_token_count(text_value: str) -> int:
    matches = _MEMORY_TOKEN_ESTIMATE_PATTERN.findall(text_value)
    return max(len(matches), 1)


def _get_key_memory_block_or_404(db: Session, game_id: int, block_id: int) -> StoryMemoryBlock:
    block = db.scalar(
        select(StoryMemoryBlock).where(
            StoryMemoryBlock.id == block_id,
            StoryMemoryBlock.game_id == game_id,
            StoryMemoryBlock.undone_at.is_(None),
        )
    )
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory block not found")
    if normalize_story_memory_layer(block.layer) != STORY_MEMORY_LAYER_KEY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only key memory blocks can be edited")
    return block


def _resolve_story_memory_optimize_start_assistant_message_id(
    *,
    db: Session,
    game_id: int,
    message_id: int | None,
) -> int | None:
    normalized_message_id = int(message_id or 0)
    if normalized_message_id <= 0:
        return None
    message = db.scalar(
        select(StoryMessage).where(
            StoryMessage.id == normalized_message_id,
            StoryMessage.game_id == game_id,
            StoryMessage.undone_at.is_(None),
        )
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role == "assistant":
        return int(message.id)
    return db.scalar(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == "assistant",
            StoryMessage.id > message.id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.asc())
        .limit(1)
    )


@router.post("/api/story/games/{game_id}/memory-blocks", response_model=StoryMemoryBlockOut)
def create_story_memory_block(
    game_id: int,
    payload: StoryMemoryBlockCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMemoryBlockOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    normalized_title = normalize_story_memory_block_title(payload.title, fallback="Важный момент")
    normalized_content = normalize_story_memory_block_content(payload.content)
    block = StoryMemoryBlock(
        game_id=game.id,
        assistant_message_id=None,
        layer=STORY_MEMORY_LAYER_KEY,
        title=normalized_title,
        content=normalized_content,
        token_count=_estimate_memory_token_count(normalized_content),
    )
    db.add(block)
    touch_story_game(game)
    db.commit()
    db.refresh(block)
    return StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block))


@router.patch("/api/story/games/{game_id}/memory-blocks/{block_id}", response_model=StoryMemoryBlockOut)
def update_story_memory_block(
    game_id: int,
    block_id: int,
    payload: StoryMemoryBlockUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMemoryBlockOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    block = _get_key_memory_block_or_404(db, game.id, block_id)
    normalized_title = normalize_story_memory_block_title(payload.title, fallback=block.title or "Важный момент")
    normalized_content = normalize_story_memory_block_content(payload.content)
    block.title = normalized_title
    block.content = normalized_content
    block.token_count = _estimate_memory_token_count(normalized_content)
    touch_story_game(game)
    db.commit()
    db.refresh(block)
    return StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block))


@router.post("/api/story/games/{game_id}/memory/optimize", response_model=list[StoryMemoryBlockOut])
def optimize_story_memory(
    game_id: int,
    payload: StoryMemoryOptimizeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryMemoryBlockOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    starting_assistant_message_id = _resolve_story_memory_optimize_start_assistant_message_id(
        db=db,
        game_id=game.id,
        message_id=payload.message_id,
    )

    try:
        from app.services import story_memory_pipeline

        optimize_memory_fn = getattr(story_memory_pipeline, "_optimize_story_memory_state", None)
        if not callable(optimize_memory_fn):
            raise RuntimeError("Story memory optimization helper is unavailable")
        optimize_memory_fn(
            db=db,
            game=game,
            starting_assistant_message_id=starting_assistant_message_id,
            max_assistant_messages=int(payload.max_assistant_messages or 48),
            max_model_requests=2,
            require_model_compaction=True,
        )
        db.commit()
    except Exception as exc:
        detail = str(exc).strip() or "Failed to optimize story memory"
        logger.exception(
            "Story memory optimize request failed: game_id=%s message_id=%s starting_assistant_message_id=%s",
            game.id,
            payload.message_id,
            starting_assistant_message_id,
        )
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to optimize story memory: {detail[:420]}",
        )

    memory_blocks = list_story_memory_blocks(db, game.id)
    return [StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block)) for block in memory_blocks]


@router.delete("/api/story/games/{game_id}/memory-blocks/{block_id}", response_model=MessageResponse)
def delete_story_memory_block(
    game_id: int,
    block_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    block = _get_key_memory_block_or_404(db, game.id, block_id)
    db.delete(block)
    touch_story_game(game)
    db.commit()
    return MessageResponse(message="Memory block deleted")
