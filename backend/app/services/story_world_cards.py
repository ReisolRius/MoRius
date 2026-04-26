from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException, status

from app.models import StoryCharacter, StoryWorldCard
from app.schemas import StoryWorldCardOut
from app.services.media import normalize_avatar_value, resolve_media_display_url
from app.services.story_characters import (
    deserialize_triggers,
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_race,
)
from app.services.text_encoding import sanitize_likely_utf8_mojibake

STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"
STORY_WORLD_CARD_KIND_WORLD = "world"
STORY_WORLD_CARD_KIND_WORLD_PROFILE = "world_profile"
STORY_WORLD_CARD_KIND_NPC = "npc"
STORY_WORLD_CARD_KIND_MAIN_HERO = "main_hero"
STORY_WORLD_CARD_KINDS = {
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_KIND_MAIN_HERO,
}
STORY_WORLD_CARD_MAX_CONTENT_LENGTH = 8_000
STORY_WORLD_DETAIL_TYPE_MAX_LENGTH = 120
STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 3
STORY_WORLD_CARD_MEMORY_TURNS_OPTIONS = {3, 5, 10}
STORY_WORLD_CARD_MEMORY_TURNS_DISABLED = 0
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_TRIGGER_MAX_LENGTH = 80


def normalize_story_world_card_title(value: str | None) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(value).split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card title cannot be empty")
    return normalized


def normalize_story_world_card_content(value: str | None) -> str:
    normalized = sanitize_likely_utf8_mojibake(value).replace("\r\n", "\n").strip()
    if len(normalized) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card text cannot be empty")
    return normalized


def normalize_story_world_card_trigger(value: str | None) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(value).replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_WORLD_CARD_TRIGGER_MAX_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_TRIGGER_MAX_LENGTH].rstrip()
    return normalized


def _split_story_world_trigger_candidates(value: str | None) -> list[str]:
    normalized = str(value or "").replace("\r\n", "\n")
    parts = re.split(r"[,;\n]+", normalized)
    return [part.strip() for part in parts if part.strip()]


def normalize_story_world_card_triggers(values: list[str | None] | None, *, fallback_title: str | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        candidate_values = _split_story_world_trigger_candidates(value)
        if not candidate_values:
            candidate_values = [value]
        for candidate in candidate_values:
            trigger = normalize_story_world_card_trigger(candidate)
            if not trigger:
                continue
            trigger_key = trigger.casefold()
            if trigger_key in seen:
                continue
            seen.add(trigger_key)
            normalized.append(trigger)

    fallback_trigger = normalize_story_world_card_trigger(fallback_title)
    if fallback_trigger:
        fallback_key = fallback_trigger.casefold()
        if fallback_key not in seen:
            normalized.insert(0, fallback_trigger)

    return normalized[:40]


def serialize_story_world_card_triggers(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def deserialize_story_world_card_triggers(raw_value: str | None) -> list[str]:
    raw = str(raw_value or "").strip()
    if not raw:
        return []

    parsed: Any
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
        candidate_values = _split_story_world_trigger_candidates(item)
        if not candidate_values:
            candidate_values = [item]
        for candidate in candidate_values:
            trigger = normalize_story_world_card_trigger(candidate)
            if not trigger:
                continue
            trigger_key = trigger.casefold()
            if trigger_key in seen:
                continue
            seen.add(trigger_key)
            normalized.append(trigger)

    return normalized[:40]


def normalize_story_world_card_source(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized == STORY_WORLD_CARD_SOURCE_AI:
        return STORY_WORLD_CARD_SOURCE_AI
    return STORY_WORLD_CARD_SOURCE_USER


def normalize_story_world_card_kind(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized in STORY_WORLD_CARD_KINDS:
        return normalized
    return STORY_WORLD_CARD_KIND_WORLD


def normalize_story_world_detail_type(value: str | None) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(value).replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_WORLD_DETAIL_TYPE_MAX_LENGTH:
        normalized = normalized[:STORY_WORLD_DETAIL_TYPE_MAX_LENGTH].rstrip()
    return normalized


def normalize_story_world_detail_type_key(value: str | None) -> str:
    return normalize_story_world_detail_type(value).casefold()


def _default_story_world_card_memory_turns(kind: str) -> int:
    normalized_kind = normalize_story_world_card_kind(kind)
    if normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_WORLD_PROFILE}:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        return STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS
    return STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS


def normalize_story_world_card_memory_turns_for_storage(
    raw_value: int | float | str | None,
    *,
    kind: str,
    explicit: bool = False,
    current_value: int | None = None,
) -> int:
    normalized_kind = normalize_story_world_card_kind(kind)
    if normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_WORLD_PROFILE}:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS

    fallback_value = (
        _default_story_world_card_memory_turns(normalized_kind)
        if current_value is None
        else current_value
    )
    if not explicit:
        return fallback_value

    if raw_value is None:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS

    parsed_value: int | None = None
    if isinstance(raw_value, bool):
        parsed_value = None
    elif isinstance(raw_value, int):
        parsed_value = raw_value
    elif isinstance(raw_value, float) and raw_value.is_integer():
        parsed_value = int(raw_value)
    elif isinstance(raw_value, str):
        cleaned = raw_value.strip().lower()
        if cleaned in {"always", "forever", "infinite"}:
            parsed_value = STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
        elif cleaned in {"off", "disabled", "disable", "none", "never"}:
            parsed_value = STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
        elif cleaned.lstrip("-").isdigit():
            parsed_value = int(cleaned)

    if parsed_value is None:
        return fallback_value
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
        return STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
    if parsed_value in STORY_WORLD_CARD_MEMORY_TURNS_OPTIONS:
        return parsed_value
    return fallback_value


def serialize_story_world_card_memory_turns(raw_value: int | None, *, kind: str) -> int | None:
    normalized_kind = normalize_story_world_card_kind(kind)
    normalized_value = normalize_story_world_card_memory_turns_for_storage(
        raw_value,
        kind=normalized_kind,
        explicit=False,
        current_value=raw_value,
    )
    if normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_WORLD_PROFILE}:
        return None
    if normalized_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return None
    if normalized_value <= STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
        return STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
    return normalized_value


def normalize_story_npc_profile_content(name: str, content: str) -> str:
    normalized_content = normalize_story_world_card_content(content)
    if not normalized_content:
        return normalized_content

    lowered_content = normalized_content.casefold()
    has_appearance = any(fragment in lowered_content for fragment in ("внешност", "appearance", "облик", "выгляд"))
    has_character = any(fragment in lowered_content for fragment in ("характер", "personality", "манер", "повед"))
    has_important = any(fragment in lowered_content for fragment in ("важн", "important", "мотив", "цель", "роль"))
    if has_important and (has_appearance or has_character):
        return normalized_content

    compact_content = " ".join(normalized_content.split())
    return normalize_story_world_card_content(
        f"Внешность и характер: {compact_content}\n"
        f"Важное: роль {name} в истории, цели и риски для игрока."
    )


def story_world_card_to_out(card: StoryWorldCard) -> StoryWorldCardOut:
    normalized_kind = normalize_story_world_card_kind(card.kind)
    avatar_url = resolve_media_display_url(
        getattr(card, "avatar_url", None),
        kind="story-world-card-avatar",
        entity_id=int(card.id),
        version=getattr(card, "updated_at", None),
    )
    avatar_original_url = (
        resolve_media_display_url(
            getattr(card, "avatar_original_url", None),
            kind="story-world-card-avatar-original",
            entity_id=int(card.id),
            version=getattr(card, "updated_at", None),
        )
        if getattr(card, "avatar_url", None)
        else None
    )
    return StoryWorldCardOut(
        id=card.id,
        game_id=card.game_id,
        title=normalize_story_world_card_title(card.title),
        content=normalize_story_world_card_content(card.content),
        race=normalize_story_character_race(getattr(card, "race", "")),
        clothing=normalize_story_character_clothing(getattr(card, "clothing", "")),
        inventory=normalize_story_character_inventory(getattr(card, "inventory", "")),
        health_status=normalize_story_character_health_status(getattr(card, "health_status", "")),
        triggers=deserialize_story_world_card_triggers(card.triggers),
        kind=normalized_kind,
        detail_type=normalize_story_world_detail_type(getattr(card, "detail_type", "")),
        avatar_url=avatar_url,
        avatar_original_url=avatar_original_url,
        avatar_scale=normalize_story_avatar_scale(card.avatar_scale),
        character_id=card.character_id,
        memory_turns=serialize_story_world_card_memory_turns(card.memory_turns, kind=normalized_kind),
        is_locked=bool(card.is_locked),
        ai_edit_enabled=bool(card.ai_edit_enabled),
        source=normalize_story_world_card_source(card.source),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def build_story_world_card_from_character(
    *,
    game_id: int,
    character: StoryCharacter,
    kind: str,
    lock_card: bool = True,
    db: Any | None = None,
) -> StoryWorldCard:
    normalized_name = normalize_story_world_card_title(character.name)
    normalized_content = normalize_story_world_card_content(character.description)
    character_triggers = deserialize_triggers(character.triggers)
    normalized_triggers = normalize_story_world_card_triggers(
        character_triggers,
        fallback_title=normalized_name,
    )
    normalized_kind = normalize_story_world_card_kind(kind)

    return StoryWorldCard(
        game_id=game_id,
        title=normalized_name,
        content=normalized_content,
        race=normalize_story_character_race(getattr(character, "race", "")),
        clothing=normalize_story_character_clothing(getattr(character, "clothing", "")),
        inventory=normalize_story_character_inventory(getattr(character, "inventory", "")),
        health_status=normalize_story_character_health_status(getattr(character, "health_status", "")),
        triggers=serialize_story_world_card_triggers(normalized_triggers),
        kind=normalized_kind,
        detail_type="",
        avatar_url=normalize_story_character_avatar_url(character.avatar_url, db=db),
        avatar_original_url=(
            normalize_story_character_avatar_original_url(getattr(character, "avatar_original_url", None), db=db)
            if getattr(character, "avatar_url", None)
            else None
        ),
        avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
        character_id=character.id,
        memory_turns=normalize_story_world_card_memory_turns_for_storage(
            None,
            kind=normalized_kind,
            explicit=False,
            current_value=None,
        ),
        is_locked=lock_card,
        ai_edit_enabled=True,
        source=STORY_WORLD_CARD_SOURCE_USER,
    )
