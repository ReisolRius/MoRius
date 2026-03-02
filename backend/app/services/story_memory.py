from __future__ import annotations

from fastapi import HTTPException, status

from app.models import StoryMemoryBlock
from app.schemas import StoryMemoryBlockOut

STORY_MEMORY_LAYER_RAW = "raw"
STORY_MEMORY_LAYER_COMPRESSED = "compressed"
STORY_MEMORY_LAYER_SUPER = "super"
STORY_MEMORY_LAYER_KEY = "key"
STORY_MEMORY_LAYERS = {
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_SUPER,
    STORY_MEMORY_LAYER_KEY,
}
STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH = 160
STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH = 64_000


def normalize_story_memory_layer(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized in STORY_MEMORY_LAYERS:
        return normalized
    return STORY_MEMORY_LAYER_RAW


def normalize_story_memory_block_title(value: str, *, fallback: str = "Блок памяти") -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        normalized = fallback
    if len(normalized) > STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH:
        normalized = normalized[:STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Memory block title cannot be empty")
    return normalized


def normalize_story_memory_block_content(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if len(normalized) > STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH:
        normalized = normalized[-STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH :].lstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Memory block text cannot be empty")
    return normalized


def story_memory_block_to_out(block: StoryMemoryBlock) -> StoryMemoryBlockOut:
    return StoryMemoryBlockOut(
        id=block.id,
        game_id=block.game_id,
        assistant_message_id=block.assistant_message_id,
        layer=normalize_story_memory_layer(block.layer),
        title=block.title,
        content=block.content,
        token_count=max(int(getattr(block, "token_count", 0) or 0), 0),
        created_at=block.created_at,
        updated_at=block.updated_at,
    )
