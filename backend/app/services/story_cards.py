from __future__ import annotations

from fastapi import HTTPException, status

from app.models import StoryPlotCard
from app.schemas import StoryPlotCardOut

STORY_PLOT_CARD_SOURCE_USER = "user"
STORY_PLOT_CARD_SOURCE_AI = "ai"
STORY_PLOT_CARD_MAX_CONTENT_LENGTH = 16_000
STORY_PLOT_CARD_MAX_TITLE_LENGTH = 120


def normalize_story_instruction_title(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Instruction title cannot be empty")
    return normalized


def normalize_story_instruction_content(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Instruction text cannot be empty")
    return normalized


def normalize_story_plot_card_title(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plot card title cannot be empty")
    if len(normalized) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
        normalized = normalized[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
    return normalized


def normalize_story_plot_card_content(value: str, *, preserve_tail: bool = False) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if len(normalized) > STORY_PLOT_CARD_MAX_CONTENT_LENGTH:
        if preserve_tail:
            normalized = normalized[-STORY_PLOT_CARD_MAX_CONTENT_LENGTH :].lstrip()
        else:
            normalized = normalized[:STORY_PLOT_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plot card text cannot be empty")
    return normalized


def normalize_story_plot_card_source(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized == STORY_PLOT_CARD_SOURCE_AI:
        return STORY_PLOT_CARD_SOURCE_AI
    return STORY_PLOT_CARD_SOURCE_USER


def story_plot_card_to_out(card: StoryPlotCard) -> StoryPlotCardOut:
    return StoryPlotCardOut(
        id=card.id,
        game_id=card.game_id,
        title=card.title,
        content=card.content,
        source=normalize_story_plot_card_source(card.source),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )
