from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMemoryBlock
from app.schemas import (
    MessageResponse,
    StoryMemoryBlockCreateRequest,
    StoryMemoryBlockOut,
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
from app.services.story_queries import get_user_story_game_or_404, touch_story_game

router = APIRouter()

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

