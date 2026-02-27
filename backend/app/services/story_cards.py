from __future__ import annotations

from fastapi import HTTPException, status

from app.models import StoryInstructionTemplate, StoryPlotCard
from app.schemas import StoryInstructionTemplateOut, StoryPlotCardOut

STORY_PLOT_CARD_SOURCE_USER = "user"
STORY_PLOT_CARD_SOURCE_AI = "ai"
STORY_PLOT_CARD_MAX_CONTENT_LENGTH = 16_000
STORY_PLOT_CARD_MAX_TITLE_LENGTH = 120
STORY_TEMPLATE_VISIBILITY_PRIVATE = "private"
STORY_TEMPLATE_VISIBILITY_PUBLIC = "public"
STORY_TEMPLATE_VISIBILITY_VALUES = {
    STORY_TEMPLATE_VISIBILITY_PRIVATE,
    STORY_TEMPLATE_VISIBILITY_PUBLIC,
}


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


def coerce_story_instruction_template_visibility(value: str | None) -> str:
    normalized = (value or STORY_TEMPLATE_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_TEMPLATE_VISIBILITY_VALUES:
        return STORY_TEMPLATE_VISIBILITY_PRIVATE
    return normalized


def normalize_story_instruction_template_visibility(value: str | None) -> str:
    normalized = (value or STORY_TEMPLATE_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_TEMPLATE_VISIBILITY_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Visibility should be either private or public",
        )
    return normalized


def story_instruction_template_rating_average(template: StoryInstructionTemplate) -> float:
    rating_count = max(int(getattr(template, "community_rating_count", 0) or 0), 0)
    if rating_count <= 0:
        return 0.0
    rating_sum = max(int(getattr(template, "community_rating_sum", 0) or 0), 0)
    return round(rating_sum / rating_count, 2)


def story_instruction_template_to_out(template: StoryInstructionTemplate) -> StoryInstructionTemplateOut:
    return StoryInstructionTemplateOut(
        id=template.id,
        user_id=template.user_id,
        title=template.title,
        content=template.content,
        visibility=coerce_story_instruction_template_visibility(getattr(template, "visibility", None)),
        source_template_id=getattr(template, "source_template_id", None),
        community_rating_avg=story_instruction_template_rating_average(template),
        community_rating_count=max(int(getattr(template, "community_rating_count", 0) or 0), 0),
        community_additions_count=max(int(getattr(template, "community_additions_count", 0) or 0), 0),
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


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
