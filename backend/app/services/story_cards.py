from __future__ import annotations

import json
import re

from fastapi import HTTPException, status

from app.models import StoryInstructionCard, StoryInstructionTemplate, StoryPlotCard
from app.schemas import StoryInstructionCardOut, StoryInstructionTemplateOut, StoryPlotCardOut, StoryPublicationStateOut
try:
    from app.services.story_publication_moderation import coerce_story_publication_status
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def coerce_story_publication_status(value: str | None, *, is_public: bool = False) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"none", "pending", "approved", "rejected"}:
            return normalized
        return "approved" if is_public else "none"

STORY_PLOT_CARD_SOURCE_USER = "user"
STORY_PLOT_CARD_SOURCE_AI = "ai"
STORY_PLOT_CARD_MAX_CONTENT_LENGTH = 32_000
STORY_PLOT_CARD_MAX_TITLE_LENGTH = 120
STORY_PLOT_CARD_TRIGGER_MAX_LENGTH = 80
STORY_PLOT_CARD_TRIGGER_ACTIVE_TURNS = 2
STORY_PLOT_CARD_MEMORY_TURNS_OPTIONS = {2, 3, 5, 10, 15}
STORY_PLOT_CARD_MEMORY_TURNS_DISABLED = -1
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


def story_instruction_card_to_out(card: StoryInstructionCard) -> StoryInstructionCardOut:
    return StoryInstructionCardOut(
        id=card.id,
        game_id=card.game_id,
        title=card.title,
        content=card.content,
        is_active=bool(getattr(card, "is_active", True)),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


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


def _story_instruction_template_publication_state_out(
    template: StoryInstructionTemplate,
) -> StoryPublicationStateOut:
    is_public = coerce_story_instruction_template_visibility(getattr(template, "visibility", None)) == STORY_TEMPLATE_VISIBILITY_PUBLIC
    return StoryPublicationStateOut(
        status=coerce_story_publication_status(
            getattr(template, "publication_status", None),
            is_public=is_public,
        ),
        requested_at=getattr(template, "publication_requested_at", None),
        reviewed_at=getattr(template, "publication_reviewed_at", None),
        reviewer_user_id=getattr(template, "publication_reviewer_user_id", None),
        rejection_reason=str(getattr(template, "publication_rejection_reason", "") or "").strip() or None,
    )


def story_instruction_template_to_out(template: StoryInstructionTemplate) -> StoryInstructionTemplateOut:
    return StoryInstructionTemplateOut(
        id=template.id,
        user_id=template.user_id,
        title=template.title,
        content=template.content,
        visibility=coerce_story_instruction_template_visibility(getattr(template, "visibility", None)),
        publication=_story_instruction_template_publication_state_out(template),
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


def normalize_story_plot_card_trigger(value: str) -> str:
    normalized = " ".join(value.replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_PLOT_CARD_TRIGGER_MAX_LENGTH:
        normalized = normalized[:STORY_PLOT_CARD_TRIGGER_MAX_LENGTH].rstrip()
    return normalized


def _split_story_plot_trigger_candidates(value: str) -> list[str]:
    normalized = value.replace("\r\n", "\n")
    parts = re.split(r"[,;\n]+", normalized)
    return [part.strip() for part in parts if part.strip()]


def normalize_story_plot_card_triggers(values: list[str], *, fallback_title: str | None = None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidate_values = _split_story_plot_trigger_candidates(value)
        if not candidate_values:
            candidate_values = [value]
        for candidate in candidate_values:
            trigger = normalize_story_plot_card_trigger(candidate)
            if not trigger:
                continue
            trigger_key = trigger.casefold()
            if trigger_key in seen:
                continue
            seen.add(trigger_key)
            normalized.append(trigger)

    return normalized[:40]


def serialize_story_plot_card_triggers(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def deserialize_story_plot_card_triggers(raw_value: str) -> list[str]:
    raw = raw_value.strip()
    if not raw:
        return []

    parsed: object
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = [part.strip() for part in raw.split(",")]

    if not isinstance(parsed, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, str):
            continue
        candidate_values = _split_story_plot_trigger_candidates(item)
        if not candidate_values:
            candidate_values = [item]
        for candidate in candidate_values:
            trigger = normalize_story_plot_card_trigger(candidate)
            if not trigger:
                continue
            trigger_key = trigger.casefold()
            if trigger_key in seen:
                continue
            seen.add(trigger_key)
            normalized.append(trigger)

    return normalized[:40]


def normalize_story_plot_card_memory_turns_for_storage(
    raw_value: int | float | str | None,
    *,
    explicit: bool = False,
    current_value: int | None = None,
) -> int:
    fallback_value = (
        STORY_PLOT_CARD_TRIGGER_ACTIVE_TURNS
        if current_value is None
        else current_value
    )
    if not explicit:
        return fallback_value

    if raw_value is None:
        return STORY_PLOT_CARD_MEMORY_TURNS_DISABLED

    parsed_value: int | None = None
    if isinstance(raw_value, bool):
        parsed_value = None
    elif isinstance(raw_value, int):
        parsed_value = raw_value
    elif isinstance(raw_value, float) and raw_value.is_integer():
        parsed_value = int(raw_value)
    elif isinstance(raw_value, str):
        cleaned = raw_value.strip().lower()
        if cleaned in {"off", "disabled", "disable", "none", "never"}:
            parsed_value = STORY_PLOT_CARD_MEMORY_TURNS_DISABLED
        elif cleaned.lstrip("-").isdigit():
            parsed_value = int(cleaned)

    if parsed_value is None:
        return fallback_value
    if parsed_value <= 0:
        return STORY_PLOT_CARD_MEMORY_TURNS_DISABLED
    if parsed_value in STORY_PLOT_CARD_MEMORY_TURNS_OPTIONS:
        return parsed_value
    return fallback_value


def serialize_story_plot_card_memory_turns(raw_value: int | None) -> int | None:
    normalized_value = normalize_story_plot_card_memory_turns_for_storage(
        raw_value,
        explicit=False,
        current_value=raw_value,
    )
    if normalized_value == STORY_PLOT_CARD_MEMORY_TURNS_DISABLED:
        return None
    return normalized_value


def story_plot_card_to_out(card: StoryPlotCard) -> StoryPlotCardOut:
    triggers = normalize_story_plot_card_triggers(
        deserialize_story_plot_card_triggers(getattr(card, "triggers", "")),
        fallback_title=card.title,
    )
    return StoryPlotCardOut(
        id=card.id,
        game_id=card.game_id,
        title=card.title,
        content=card.content,
        triggers=triggers,
        memory_turns=serialize_story_plot_card_memory_turns(getattr(card, "memory_turns", None)),
        ai_edit_enabled=bool(card.ai_edit_enabled),
        is_enabled=bool(getattr(card, "is_enabled", True)),
        source=normalize_story_plot_card_source(card.source),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )
