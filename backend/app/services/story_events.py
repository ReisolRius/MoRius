from __future__ import annotations

import json

from app.models import StoryPlotCardChangeEvent, StoryWorldCardChangeEvent
from app.schemas import StoryPlotCardChangeEventOut, StoryWorldCardChangeEventOut
from app.services.media import normalize_avatar_value
from app.services.story_cards import (
    STORY_PLOT_CARD_MAX_CONTENT_LENGTH,
    STORY_PLOT_CARD_MAX_TITLE_LENGTH,
    normalize_story_plot_card_source,
)
from app.services.story_characters import normalize_story_avatar_scale
from app.services.story_world_cards import (
    STORY_WORLD_CARD_MAX_CONTENT_LENGTH,
    normalize_story_world_card_kind,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_source,
    normalize_story_world_card_triggers,
    serialize_story_world_card_memory_turns,
)

STORY_WORLD_CARD_EVENT_ADDED = "added"
STORY_WORLD_CARD_EVENT_UPDATED = "updated"
STORY_WORLD_CARD_EVENT_DELETED = "deleted"


def _coerce_bool(raw_value: object, *, default: bool) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return bool(raw_value)
    if isinstance(raw_value, str):
        return raw_value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return default


def normalize_story_world_card_event_action(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {STORY_WORLD_CARD_EVENT_ADDED, "add", "create", "created", "new"}:
        return STORY_WORLD_CARD_EVENT_ADDED
    if normalized in {STORY_WORLD_CARD_EVENT_UPDATED, "update", "edit", "edited", "modify", "modified"}:
        return STORY_WORLD_CARD_EVENT_UPDATED
    if normalized in {STORY_WORLD_CARD_EVENT_DELETED, "delete", "remove", "removed"}:
        return STORY_WORLD_CARD_EVENT_DELETED
    return ""


def deserialize_story_world_card_snapshot(raw_value: str | None) -> dict[str, object] | None:
    if raw_value is None:
        return None
    normalized_raw = raw_value.strip()
    if not normalized_raw:
        return None

    try:
        parsed = json.loads(normalized_raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    title_value = " ".join(str(parsed.get("title", "")).split()).strip()
    content_value = str(parsed.get("content", "")).replace("\r\n", "\n").strip()
    if not title_value or not content_value:
        return None

    if len(title_value) > 120:
        title_value = title_value[:120].rstrip()
    if len(content_value) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
        content_value = content_value[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not title_value or not content_value:
        return None

    raw_triggers = parsed.get("triggers")
    trigger_values: list[str] = []
    if isinstance(raw_triggers, list):
        trigger_values = [item for item in raw_triggers if isinstance(item, str)]
    triggers_value = normalize_story_world_card_triggers(trigger_values, fallback_title=title_value)
    source_value = normalize_story_world_card_source(str(parsed.get("source", "")))
    kind_value = normalize_story_world_card_kind(str(parsed.get("kind", "")))
    raw_avatar_value = parsed.get("avatar_url")
    avatar_value = normalize_avatar_value(raw_avatar_value) if isinstance(raw_avatar_value, str) else None
    avatar_scale_value = normalize_story_avatar_scale(parsed.get("avatar_scale"))
    is_locked_value = _coerce_bool(parsed.get("is_locked"), default=False)
    ai_edit_enabled_value = _coerce_bool(parsed.get("ai_edit_enabled"), default=True)

    card_id: int | None = None
    raw_id = parsed.get("id")
    if isinstance(raw_id, int) and raw_id > 0:
        card_id = raw_id
    elif isinstance(raw_id, str) and raw_id.strip().isdigit():
        parsed_id = int(raw_id.strip())
        if parsed_id > 0:
            card_id = parsed_id

    character_id: int | None = None
    raw_character_id = parsed.get("character_id")
    if isinstance(raw_character_id, int) and raw_character_id > 0:
        character_id = raw_character_id
    elif isinstance(raw_character_id, str) and raw_character_id.strip().isdigit():
        parsed_character_id = int(raw_character_id.strip())
        if parsed_character_id > 0:
            character_id = parsed_character_id

    memory_turns_value = normalize_story_world_card_memory_turns_for_storage(
        parsed.get("memory_turns"),
        kind=kind_value,
        explicit="memory_turns" in parsed,
        current_value=None,
    )

    return {
        "id": card_id,
        "title": title_value,
        "content": content_value,
        "triggers": triggers_value,
        "kind": kind_value,
        "avatar_url": avatar_value,
        "avatar_scale": avatar_scale_value,
        "character_id": character_id,
        "memory_turns": serialize_story_world_card_memory_turns(memory_turns_value, kind=kind_value),
        "is_locked": is_locked_value,
        "ai_edit_enabled": ai_edit_enabled_value,
        "source": source_value,
    }


def deserialize_story_plot_card_snapshot(raw_value: str | None) -> dict[str, object] | None:
    if raw_value is None:
        return None
    normalized_raw = raw_value.strip()
    if not normalized_raw:
        return None

    try:
        parsed = json.loads(normalized_raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    title_value = " ".join(str(parsed.get("title", "")).split()).strip()
    content_value = str(parsed.get("content", "")).replace("\r\n", "\n").strip()
    if not title_value or not content_value:
        return None

    if len(title_value) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
        title_value = title_value[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
    if len(content_value) > STORY_PLOT_CARD_MAX_CONTENT_LENGTH:
        content_value = content_value[:STORY_PLOT_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not title_value or not content_value:
        return None

    source_value = normalize_story_plot_card_source(str(parsed.get("source", "")))

    card_id: int | None = None
    raw_id = parsed.get("id")
    if isinstance(raw_id, int) and raw_id > 0:
        card_id = raw_id
    elif isinstance(raw_id, str) and raw_id.strip().isdigit():
        parsed_id = int(raw_id.strip())
        if parsed_id > 0:
            card_id = parsed_id

    return {
        "id": card_id,
        "title": title_value,
        "content": content_value,
        "source": source_value,
    }


def story_world_card_change_event_to_out(event: StoryWorldCardChangeEvent) -> StoryWorldCardChangeEventOut:
    return StoryWorldCardChangeEventOut(
        id=event.id,
        game_id=event.game_id,
        assistant_message_id=event.assistant_message_id,
        world_card_id=event.world_card_id,
        action=normalize_story_world_card_event_action(event.action) or STORY_WORLD_CARD_EVENT_UPDATED,
        title=event.title,
        changed_text=event.changed_text,
        before_snapshot=deserialize_story_world_card_snapshot(event.before_snapshot),
        after_snapshot=deserialize_story_world_card_snapshot(event.after_snapshot),
        created_at=event.created_at,
    )


def story_plot_card_change_event_to_out(event: StoryPlotCardChangeEvent) -> StoryPlotCardChangeEventOut:
    return StoryPlotCardChangeEventOut(
        id=event.id,
        game_id=event.game_id,
        assistant_message_id=event.assistant_message_id,
        plot_card_id=event.plot_card_id,
        action=normalize_story_world_card_event_action(event.action) or STORY_WORLD_CARD_EVENT_UPDATED,
        title=event.title,
        changed_text=event.changed_text,
        before_snapshot=deserialize_story_plot_card_snapshot(event.before_snapshot),
        after_snapshot=deserialize_story_plot_card_snapshot(event.after_snapshot),
        created_at=event.created_at,
    )
