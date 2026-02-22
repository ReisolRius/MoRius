from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryCharacter
from app.schemas import (
    MessageResponse,
    StoryCharacterCreateRequest,
    StoryCharacterOut,
    StoryCharacterUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_url,
    normalize_story_character_description,
    normalize_story_character_name,
    normalize_story_character_source,
    normalize_story_character_triggers,
    serialize_triggers,
    story_character_to_out,
    unlink_story_character_from_world_cards,
)
from app.services.story_queries import (
    get_story_character_for_user_or_404,
    list_story_characters,
)

router = APIRouter()


@router.get("/api/story/characters", response_model=list[StoryCharacterOut])
def list_story_characters_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCharacterOut]:
    user = get_current_user(db, authorization)
    characters = list_story_characters(db, user.id)
    return [story_character_to_out(character) for character in characters]


@router.post("/api/story/characters", response_model=StoryCharacterOut)
def create_story_character(
    payload: StoryCharacterCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterOut:
    user = get_current_user(db, authorization)
    normalized_name = normalize_story_character_name(payload.name)
    normalized_description = normalize_story_character_description(payload.description)
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    character = StoryCharacter(
        user_id=user.id,
        name=normalized_name,
        description=normalized_description,
        triggers=serialize_triggers(normalized_triggers),
        avatar_url=avatar_url,
        avatar_scale=avatar_scale,
        source="user",
    )
    db.add(character)
    db.commit()
    db.refresh(character)
    return story_character_to_out(character)


@router.patch("/api/story/characters/{character_id}", response_model=StoryCharacterOut)
def update_story_character(
    character_id: int,
    payload: StoryCharacterUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterOut:
    user = get_current_user(db, authorization)
    character = get_story_character_for_user_or_404(db, user.id, character_id)
    normalized_name = normalize_story_character_name(payload.name)
    normalized_description = normalize_story_character_description(payload.description)
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    character.name = normalized_name
    character.description = normalized_description
    character.triggers = serialize_triggers(normalized_triggers)
    character.avatar_url = avatar_url
    character.avatar_scale = avatar_scale
    character.source = normalize_story_character_source(character.source)
    db.commit()
    db.refresh(character)
    return story_character_to_out(character)


@router.delete("/api/story/characters/{character_id}", response_model=MessageResponse)
def delete_story_character(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    character = get_story_character_for_user_or_404(db, user.id, character_id)
    unlink_story_character_from_world_cards(db, character_id=character.id)
    db.delete(character)
    db.commit()
    return MessageResponse(message="Character deleted")

