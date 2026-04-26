from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import StoryWorldCardTemplate, StoryWorldDetailType
from app.schemas import StoryWorldCardTemplateOut, StoryWorldDetailTypeOut
from app.services.media import resolve_media_display_url
from app.services.story_characters import normalize_story_avatar_scale, normalize_story_character_avatar_original_url, normalize_story_character_avatar_url
from app.services.story_world_cards import (
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
    deserialize_story_world_card_triggers,
    normalize_story_world_card_content,
    normalize_story_world_card_kind,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_title,
    normalize_story_world_card_triggers,
    normalize_story_world_detail_type,
    normalize_story_world_detail_type_key,
    serialize_story_world_card_memory_turns,
    serialize_story_world_card_triggers,
)

STORY_WORLD_CARD_TEMPLATE_KINDS = {
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
}


def normalize_story_world_card_template_kind(value: str | None) -> str:
    normalized = normalize_story_world_card_kind(value)
    if normalized in STORY_WORLD_CARD_TEMPLATE_KINDS:
        return normalized
    return STORY_WORLD_CARD_KIND_WORLD_PROFILE


def story_world_detail_type_to_out(detail_type: StoryWorldDetailType) -> StoryWorldDetailTypeOut:
    return StoryWorldDetailTypeOut(
        id=int(detail_type.id),
        name=normalize_story_world_detail_type(getattr(detail_type, "name", "")),
        created_at=detail_type.created_at,
        updated_at=detail_type.updated_at,
    )


def upsert_story_world_detail_type(
    db: Session,
    *,
    user_id: int,
    name: str | None,
) -> StoryWorldDetailType | None:
    normalized_name = normalize_story_world_detail_type(name)
    if not normalized_name:
        return None

    normalized_key = normalize_story_world_detail_type_key(normalized_name)
    existing_type = db.scalar(
        select(StoryWorldDetailType).where(
            StoryWorldDetailType.user_id == int(user_id),
            StoryWorldDetailType.name_key == normalized_key,
        )
    )
    if existing_type is not None:
        if str(getattr(existing_type, "name", "") or "").strip() != normalized_name:
            existing_type.name = normalized_name
        return existing_type

    created_type = StoryWorldDetailType(
        user_id=int(user_id),
        name=normalized_name,
        name_key=normalized_key,
    )
    db.add(created_type)
    db.flush()
    return created_type


def story_world_card_template_to_out(template: StoryWorldCardTemplate) -> StoryWorldCardTemplateOut:
    normalized_kind = normalize_story_world_card_template_kind(getattr(template, "kind", None))
    avatar_url = resolve_media_display_url(
        getattr(template, "avatar_url", None),
        kind="story-world-card-template-avatar",
        entity_id=int(template.id),
        version=getattr(template, "updated_at", None),
    )
    avatar_original_url = (
        resolve_media_display_url(
            getattr(template, "avatar_original_url", None),
            kind="story-world-card-template-avatar-original",
            entity_id=int(template.id),
            version=getattr(template, "updated_at", None),
        )
        if getattr(template, "avatar_url", None)
        else None
    )
    return StoryWorldCardTemplateOut(
        id=int(template.id),
        user_id=int(template.user_id),
        title=normalize_story_world_card_title(getattr(template, "title", "")),
        content=normalize_story_world_card_content(getattr(template, "content", "")),
        triggers=normalize_story_world_card_triggers(
            deserialize_story_world_card_triggers(str(getattr(template, "triggers", "") or "")),
            fallback_title=str(getattr(template, "title", "") or ""),
        ),
        kind=normalized_kind,
        detail_type=normalize_story_world_detail_type(getattr(template, "detail_type", "")),
        avatar_url=avatar_url,
        avatar_original_url=avatar_original_url,
        avatar_scale=normalize_story_avatar_scale(getattr(template, "avatar_scale", None)),
        memory_turns=serialize_story_world_card_memory_turns(getattr(template, "memory_turns", None), kind=normalized_kind),
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def build_story_world_card_template(
    *,
    user_id: int,
    title: str,
    content: str,
    triggers: list[str],
    kind: str | None,
    detail_type: str | None,
    avatar_url: str | None,
    avatar_original_url: str | None,
    avatar_scale: float | int | str | None,
    memory_turns: int | float | str | None,
    memory_turns_explicit: bool,
) -> StoryWorldCardTemplate:
    normalized_kind = normalize_story_world_card_template_kind(kind)
    normalized_title = normalize_story_world_card_title(title)
    normalized_content = normalize_story_world_card_content(content)
    normalized_triggers = normalize_story_world_card_triggers(triggers, fallback_title=normalized_title)
    normalized_detail_type = normalize_story_world_detail_type(detail_type) if normalized_kind == STORY_WORLD_CARD_KIND_WORLD else ""
    normalized_avatar = normalize_story_character_avatar_url(avatar_url)
    normalized_avatar_original = normalize_story_character_avatar_original_url(avatar_original_url)
    if normalized_avatar and not normalized_avatar_original:
        normalized_avatar_original = normalized_avatar
    normalized_scale = normalize_story_avatar_scale(avatar_scale)
    normalized_memory_turns = normalize_story_world_card_memory_turns_for_storage(
        memory_turns,
        kind=normalized_kind,
        explicit=memory_turns_explicit,
        current_value=None,
    )
    return StoryWorldCardTemplate(
        user_id=int(user_id),
        title=normalized_title,
        content=normalized_content,
        triggers=serialize_story_world_card_triggers(normalized_triggers),
        kind=normalized_kind,
        detail_type=normalized_detail_type,
        avatar_url=normalized_avatar,
        avatar_original_url=normalized_avatar_original if normalized_avatar else None,
        avatar_scale=normalized_scale,
        memory_turns=normalized_memory_turns,
    )
