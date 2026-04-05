from __future__ import annotations

import json

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import StoryCharacter, StoryWorldCard
from app.schemas import StoryCharacterOut, StoryPublicationStateOut
from app.services.media import normalize_avatar_value, normalize_media_scale, resolve_media_display_url, validate_avatar_url
from app.services.story_emotions import deserialize_story_character_emotion_assets
try:
    from app.services.story_publication_moderation import coerce_story_publication_status
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def coerce_story_publication_status(value: str | None, *, is_public: bool = False) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"none", "pending", "approved", "rejected"}:
            return normalized
        return "approved" if is_public else "none"

STORY_CHARACTER_SOURCE_USER = "user"
STORY_CHARACTER_SOURCE_AI = "ai"
STORY_CHARACTER_MAX_NAME_LENGTH = 120
STORY_CHARACTER_MAX_DESCRIPTION_LENGTH = 6_000
STORY_CHARACTER_MAX_NOTE_LENGTH = 20
STORY_CHARACTER_MAX_TRIGGERS = 40
STORY_CHARACTER_TRIGGER_MAX_LENGTH = 80
STORY_CHARACTER_VISIBILITY_PRIVATE = "private"
STORY_CHARACTER_VISIBILITY_PUBLIC = "public"
STORY_CHARACTER_VISIBILITY_VALUES = {
    STORY_CHARACTER_VISIBILITY_PRIVATE,
    STORY_CHARACTER_VISIBILITY_PUBLIC,
}
STORY_AVATAR_SCALE_MIN = 1.0
STORY_AVATAR_SCALE_MAX = 3.0
STORY_AVATAR_SCALE_DEFAULT = 1.0


def _normalize_story_trigger(value: str) -> str:
    normalized = " ".join(value.replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_CHARACTER_TRIGGER_MAX_LENGTH:
        return normalized[:STORY_CHARACTER_TRIGGER_MAX_LENGTH].rstrip()
    return normalized


def serialize_triggers(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def deserialize_triggers(raw_value: str) -> list[str]:
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
        trigger = _normalize_story_trigger(item)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    return normalized[:STORY_CHARACTER_MAX_TRIGGERS]


def normalize_story_character_source(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized == STORY_CHARACTER_SOURCE_AI:
        return STORY_CHARACTER_SOURCE_AI
    return STORY_CHARACTER_SOURCE_USER


def coerce_story_character_visibility(value: str | None) -> str:
    normalized = (value or STORY_CHARACTER_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_CHARACTER_VISIBILITY_VALUES:
        return STORY_CHARACTER_VISIBILITY_PRIVATE
    return normalized


def normalize_story_character_visibility(value: str | None) -> str:
    normalized = (value or STORY_CHARACTER_VISIBILITY_PRIVATE).strip().lower()
    if normalized not in STORY_CHARACTER_VISIBILITY_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Visibility should be either private or public",
        )
    return normalized


def normalize_story_character_name(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Character name cannot be empty")
    if len(normalized) > STORY_CHARACTER_MAX_NAME_LENGTH:
        normalized = normalized[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Character name cannot be empty")
    return normalized


def normalize_story_character_description(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if len(normalized) > STORY_CHARACTER_MAX_DESCRIPTION_LENGTH:
        normalized = normalized[:STORY_CHARACTER_MAX_DESCRIPTION_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Character description cannot be empty")
    return normalized


def normalize_story_character_note(value: str | None) -> str:
    normalized = " ".join((value or "").replace("\r\n", " ").split()).strip()
    if len(normalized) > STORY_CHARACTER_MAX_NOTE_LENGTH:
        normalized = normalized[:STORY_CHARACTER_MAX_NOTE_LENGTH].rstrip()
    return normalized


def normalize_story_character_avatar_url(raw_value: str | None) -> str | None:
    normalized = normalize_avatar_value(raw_value)
    if normalized is None:
        return None
    return validate_avatar_url(normalized, max_bytes=settings.character_avatar_max_bytes)


def normalize_story_character_avatar_original_url(raw_value: str | None) -> str | None:
    normalized = normalize_avatar_value(raw_value)
    if normalized is None:
        return None
    return validate_avatar_url(normalized, max_bytes=settings.character_avatar_max_bytes)


def normalize_story_avatar_scale(raw_value: float | int | str | None) -> float:
    return normalize_media_scale(
        raw_value,
        default=STORY_AVATAR_SCALE_DEFAULT,
        min_value=STORY_AVATAR_SCALE_MIN,
        max_value=STORY_AVATAR_SCALE_MAX,
    )


def normalize_story_character_triggers(values: list[str], *, fallback_name: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        trigger = _normalize_story_trigger(raw_value)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    fallback_trigger = _normalize_story_trigger(fallback_name)
    if fallback_trigger:
        fallback_key = fallback_trigger.casefold()
        if fallback_key not in seen:
            normalized.insert(0, fallback_trigger)

    return normalized[:STORY_CHARACTER_MAX_TRIGGERS]


def story_character_rating_average(character: StoryCharacter) -> float:
    rating_count = max(int(getattr(character, "community_rating_count", 0) or 0), 0)
    if rating_count <= 0:
        return 0.0
    rating_sum = max(int(getattr(character, "community_rating_sum", 0) or 0), 0)
    return round(rating_sum / rating_count, 2)


def _story_character_publication_state_out(character: StoryCharacter) -> StoryPublicationStateOut:
    is_public = coerce_story_character_visibility(getattr(character, "visibility", None)) == STORY_CHARACTER_VISIBILITY_PUBLIC
    return StoryPublicationStateOut(
        status=coerce_story_publication_status(
            getattr(character, "publication_status", None),
            is_public=is_public,
        ),
        requested_at=getattr(character, "publication_requested_at", None),
        reviewed_at=getattr(character, "publication_reviewed_at", None),
        reviewer_user_id=getattr(character, "publication_reviewer_user_id", None),
        rejection_reason=str(getattr(character, "publication_rejection_reason", "") or "").strip() or None,
    )


def story_character_to_out(character: StoryCharacter, *, include_emotion_assets: bool = True) -> StoryCharacterOut:
    avatar_url = resolve_media_display_url(
        getattr(character, "avatar_url", None),
        kind="story-character-avatar",
        entity_id=int(character.id),
        version=getattr(character, "updated_at", None),
    )
    avatar_original_url = (
        resolve_media_display_url(
            getattr(character, "avatar_original_url", None),
            kind="story-character-avatar-original",
            entity_id=int(character.id),
            version=getattr(character, "updated_at", None),
        )
        if getattr(character, "avatar_url", None)
        else None
    )
    emotion_assets = {
        emotion_id: resolved_asset_url
        for emotion_id, raw_asset_url in deserialize_story_character_emotion_assets(
            getattr(character, "emotion_assets", None)
        ).items()
        if (
            resolved_asset_url := resolve_media_display_url(
                raw_asset_url,
                kind="story-character-emotion-asset",
                entity_id=int(character.id),
                version=getattr(character, "updated_at", None),
                asset_id=emotion_id,
            )
        )
    }
    if not include_emotion_assets:
        emotion_assets = {}
    return StoryCharacterOut(
        id=character.id,
        user_id=character.user_id,
        name=character.name,
        description=character.description,
        note=normalize_story_character_note(getattr(character, "note", "")),
        triggers=deserialize_triggers(character.triggers),
        avatar_url=avatar_url,
        avatar_original_url=avatar_original_url,
        avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
        emotion_assets=emotion_assets,
        emotion_model=str(getattr(character, "emotion_model", "") or "").strip(),
        emotion_prompt_lock=str(getattr(character, "emotion_prompt_lock", "") or "").strip() or None,
        source=normalize_story_character_source(character.source),
        visibility=coerce_story_character_visibility(getattr(character, "visibility", None)),
        publication=_story_character_publication_state_out(character),
        source_character_id=getattr(character, "source_character_id", None),
        community_rating_avg=story_character_rating_average(character),
        community_rating_count=max(int(getattr(character, "community_rating_count", 0) or 0), 0),
        community_additions_count=max(int(getattr(character, "community_additions_count", 0) or 0), 0),
        created_at=character.created_at,
        updated_at=character.updated_at,
    )


def unlink_story_character_from_world_cards(db: Session, *, character_id: int) -> None:
    linked_cards = db.scalars(
        select(StoryWorldCard).where(StoryWorldCard.character_id == character_id)
    ).all()
    for linked_card in linked_cards:
        linked_card.character_id = None
