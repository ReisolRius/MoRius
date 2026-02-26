from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryWorldCard
from app.schemas import (
    MessageResponse,
    StoryCharacterAssignRequest,
    StoryWorldCardAiEditUpdateRequest,
    StoryWorldCardAvatarUpdateRequest,
    StoryWorldCardCreateRequest,
    StoryWorldCardOut,
    StoryWorldCardUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_url,
)
from app.services.story_queries import (
    get_story_character_for_user_or_404,
    get_story_main_hero_card,
    get_user_story_game_or_404,
    list_story_world_cards,
    touch_story_game,
)
from app.services.story_world_cards import (
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_SOURCE_USER,
    build_story_world_card_from_character,
    normalize_story_npc_profile_content,
    normalize_story_world_card_content,
    normalize_story_world_card_kind,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_title,
    normalize_story_world_card_triggers,
    serialize_story_world_card_triggers,
    story_world_card_to_out,
)

router = APIRouter()


def _normalize_character_identity_name(value: str) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def _is_same_character_identity(card: StoryWorldCard, *, character_id: int, normalized_name: str) -> bool:
    if card.character_id == character_id:
        return True
    card_name = _normalize_character_identity_name(card.title)
    return bool(card_name and card_name == normalized_name)


@router.get("/api/story/games/{game_id}/world-cards", response_model=list[StoryWorldCardOut])
def list_story_world_cards_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryWorldCardOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    cards = list_story_world_cards(db, game.id)
    return [story_world_card_to_out(card) for card in cards]


@router.post("/api/story/games/{game_id}/main-hero", response_model=StoryWorldCardOut)
def select_story_main_hero(
    game_id: int,
    payload: StoryCharacterAssignRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    character = get_story_character_for_user_or_404(db, user.id, payload.character_id)
    normalized_character_name = _normalize_character_identity_name(character.name)
    existing_cards = list_story_world_cards(db, game.id)
    existing_npc = next(
        (
            card
            for card in existing_cards
            if normalize_story_world_card_kind(card.kind) == STORY_WORLD_CARD_KIND_NPC
            and _is_same_character_identity(
                card,
                character_id=payload.character_id,
                normalized_name=normalized_character_name,
            )
        ),
        None,
    )
    if existing_npc is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This character is already selected as NPC",
        )

    existing_main_hero = get_story_main_hero_card(db, game.id)
    if existing_main_hero is not None:
        if _is_same_character_identity(
            existing_main_hero,
            character_id=payload.character_id,
            normalized_name=normalized_character_name,
        ):
            return story_world_card_to_out(existing_main_hero)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main hero is already selected and cannot be changed",
        )

    main_hero_card = build_story_world_card_from_character(
        game_id=game.id,
        character=character,
        kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
        lock_card=False,
    )
    db.add(main_hero_card)
    touch_story_game(game)
    db.commit()
    db.refresh(main_hero_card)
    return story_world_card_to_out(main_hero_card)


@router.post("/api/story/games/{game_id}/npc-from-character", response_model=StoryWorldCardOut)
def create_story_npc_from_character(
    game_id: int,
    payload: StoryCharacterAssignRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    character = get_story_character_for_user_or_404(db, user.id, payload.character_id)
    normalized_character_name = _normalize_character_identity_name(character.name)
    existing_cards = list_story_world_cards(db, game.id)
    existing_main_hero = get_story_main_hero_card(db, game.id)
    if (
        existing_main_hero is not None
        and _is_same_character_identity(
            existing_main_hero,
            character_id=payload.character_id,
            normalized_name=normalized_character_name,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main hero cannot be added as NPC",
        )

    existing_npc = next(
        (
            card
            for card in existing_cards
            if normalize_story_world_card_kind(card.kind) == STORY_WORLD_CARD_KIND_NPC
            and _is_same_character_identity(
                card,
                character_id=payload.character_id,
                normalized_name=normalized_character_name,
            )
        ),
        None,
    )
    if existing_npc is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This character is already selected as NPC",
        )

    npc_card = build_story_world_card_from_character(
        game_id=game.id,
        character=character,
        kind=STORY_WORLD_CARD_KIND_NPC,
        lock_card=False,
    )
    db.add(npc_card)
    touch_story_game(game)
    db.commit()
    db.refresh(npc_card)
    return story_world_card_to_out(npc_card)


@router.patch("/api/story/games/{game_id}/world-cards/{card_id}/avatar", response_model=StoryWorldCardOut)
def update_story_world_card_avatar(
    game_id: int,
    card_id: int,
    payload: StoryWorldCardAvatarUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")

    world_card.avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
    if payload.avatar_scale is not None:
        world_card.avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return story_world_card_to_out(world_card)


@router.patch("/api/story/games/{game_id}/world-cards/{card_id}/ai-edit", response_model=StoryWorldCardOut)
def update_story_world_card_ai_edit(
    game_id: int,
    card_id: int,
    payload: StoryWorldCardAiEditUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")

    world_card.ai_edit_enabled = bool(payload.ai_edit_enabled)
    touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return story_world_card_to_out(world_card)


@router.post("/api/story/games/{game_id}/world-cards", response_model=StoryWorldCardOut)
def create_story_world_card(
    game_id: int,
    payload: StoryWorldCardCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    normalized_title = normalize_story_world_card_title(payload.title)
    normalized_content = normalize_story_world_card_content(payload.content)
    normalized_triggers = normalize_story_world_card_triggers(payload.triggers, fallback_title=normalized_title)
    normalized_kind = normalize_story_world_card_kind(payload.kind)
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        normalized_content = normalize_story_npc_profile_content(normalized_title, normalized_content)
    normalized_avatar = normalize_story_character_avatar_url(payload.avatar_url)
    normalized_avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    normalized_memory_turns = normalize_story_world_card_memory_turns_for_storage(
        payload.memory_turns,
        kind=normalized_kind,
        explicit="memory_turns" in payload.model_fields_set,
        current_value=None,
    )
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
        existing_main_hero = get_story_main_hero_card(db, game.id)
        if existing_main_hero is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Main hero is already selected and cannot be changed",
            )

    world_card = StoryWorldCard(
        game_id=game.id,
        title=normalized_title,
        content=normalized_content,
        triggers=serialize_story_world_card_triggers(normalized_triggers),
        kind=normalized_kind,
        avatar_url=normalized_avatar,
        avatar_scale=normalized_avatar_scale,
        character_id=None,
        memory_turns=normalized_memory_turns,
        is_locked=False,
        ai_edit_enabled=True,
        source=STORY_WORLD_CARD_SOURCE_USER,
    )
    db.add(world_card)
    touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return story_world_card_to_out(world_card)


@router.patch("/api/story/games/{game_id}/world-cards/{card_id}", response_model=StoryWorldCardOut)
def update_story_world_card(
    game_id: int,
    card_id: int,
    payload: StoryWorldCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")
    if bool(world_card.is_locked):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This world card cannot be edited",
        )

    normalized_title = normalize_story_world_card_title(payload.title)
    normalized_content = normalize_story_world_card_content(payload.content)
    normalized_triggers = normalize_story_world_card_triggers(payload.triggers, fallback_title=normalized_title)
    normalized_kind = normalize_story_world_card_kind(world_card.kind)
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        normalized_content = normalize_story_npc_profile_content(normalized_title, normalized_content)
    if "memory_turns" in payload.model_fields_set:
        normalized_memory_turns = normalize_story_world_card_memory_turns_for_storage(
            payload.memory_turns,
            kind=normalized_kind,
            explicit=True,
            current_value=world_card.memory_turns,
        )
    else:
        normalized_memory_turns = normalize_story_world_card_memory_turns_for_storage(
            world_card.memory_turns,
            kind=normalized_kind,
            explicit=False,
            current_value=world_card.memory_turns,
        )

    world_card.title = normalized_title
    world_card.content = normalized_content
    world_card.triggers = serialize_story_world_card_triggers(normalized_triggers)
    world_card.memory_turns = normalized_memory_turns
    touch_story_game(game)
    db.commit()
    db.refresh(world_card)
    return story_world_card_to_out(world_card)


@router.delete("/api/story/games/{game_id}/world-cards/{card_id}", response_model=MessageResponse)
def delete_story_world_card(
    game_id: int,
    card_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    world_card = db.scalar(
        select(StoryWorldCard).where(
            StoryWorldCard.id == card_id,
            StoryWorldCard.game_id == game.id,
        )
    )
    if world_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")
    if normalize_story_world_card_kind(world_card.kind) == STORY_WORLD_CARD_KIND_MAIN_HERO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main hero cannot be removed once selected",
        )

    db.delete(world_card)
    touch_story_game(game)
    db.commit()
    return MessageResponse(message="World card deleted")
