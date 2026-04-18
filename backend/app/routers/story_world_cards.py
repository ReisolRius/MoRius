from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select, update as sa_update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryWorldCard, StoryWorldCardChangeEvent, StoryWorldCardTemplate, StoryWorldDetailType
from app.schemas import (
    MessageResponse,
    StoryCharacterAssignRequest,
    StoryWorldCardAiEditUpdateRequest,
    StoryWorldCardAvatarUpdateRequest,
    StoryWorldCardCreateRequest,
    StoryWorldCardOut,
    StoryWorldCardTemplateCreateRequest,
    StoryWorldCardTemplateOut,
    StoryWorldCardTemplateUpdateRequest,
    StoryWorldDetailTypeCreateRequest,
    StoryWorldDetailTypeOut,
    StoryWorldCardUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_race,
)
from app.services.story_games import STORY_GAME_VISIBILITY_PUBLIC, refresh_story_game_public_card_snapshots
from app.services.story_character_state_fields import sync_story_character_state_payload_from_world_cards
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
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
    STORY_WORLD_CARD_SOURCE_USER,
    build_story_world_card_from_character,
    normalize_story_npc_profile_content,
    normalize_story_world_card_content,
    normalize_story_world_detail_type,
    normalize_story_world_card_kind,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_title,
    normalize_story_world_card_triggers,
    serialize_story_world_card_triggers,
    story_world_card_to_out,
)
from app.services.story_world_card_templates import (
    STORY_WORLD_CARD_TEMPLATE_KINDS,
    build_story_world_card_template,
    normalize_story_world_card_template_kind,
    story_world_card_template_to_out,
    story_world_detail_type_to_out,
    upsert_story_world_detail_type,
)

router = APIRouter()


def _normalize_character_identity_name(value: str) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def _is_same_character_identity(card: StoryWorldCard, *, character_id: int, normalized_name: str) -> bool:
    if card.character_id == character_id:
        return True
    card_name = _normalize_character_identity_name(card.title)
    return bool(card_name and card_name == normalized_name)


def _refresh_public_story_game_snapshots_if_needed(db: Session, game) -> None:
    if (str(getattr(game, "visibility", "") or "").strip().lower() != STORY_GAME_VISIBILITY_PUBLIC):
        return
    refresh_story_game_public_card_snapshots(db, game)


def _is_public_story_game(game) -> bool:
    return (str(getattr(game, "visibility", "") or "").strip().lower() == STORY_GAME_VISIBILITY_PUBLIC)


@router.get("/api/story/world-detail-types", response_model=list[StoryWorldDetailTypeOut])
def list_story_world_detail_types(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryWorldDetailTypeOut]:
    user = get_current_user(db, authorization)
    detail_types = db.scalars(
        select(StoryWorldDetailType)
        .where(StoryWorldDetailType.user_id == int(user.id))
        .order_by(func.lower(StoryWorldDetailType.name).asc(), StoryWorldDetailType.id.asc())
    ).all()
    return [story_world_detail_type_to_out(detail_type) for detail_type in detail_types]


@router.post("/api/story/world-detail-types", response_model=StoryWorldDetailTypeOut)
def create_story_world_detail_type(
    payload: StoryWorldDetailTypeCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldDetailTypeOut:
    user = get_current_user(db, authorization)
    detail_type = upsert_story_world_detail_type(
        db,
        user_id=int(user.id),
        name=payload.name,
    )
    if detail_type is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World detail type cannot be empty")
    db.commit()
    db.refresh(detail_type)
    return story_world_detail_type_to_out(detail_type)


@router.get("/api/story/world-card-templates", response_model=list[StoryWorldCardTemplateOut])
def list_story_world_card_templates(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryWorldCardTemplateOut]:
    user = get_current_user(db, authorization)
    templates = db.scalars(
        select(StoryWorldCardTemplate)
        .where(StoryWorldCardTemplate.user_id == int(user.id))
        .order_by(StoryWorldCardTemplate.updated_at.desc(), StoryWorldCardTemplate.id.desc())
    ).all()
    return [story_world_card_template_to_out(template) for template in templates]


@router.post("/api/story/world-card-templates", response_model=StoryWorldCardTemplateOut)
def create_story_world_card_template(
    payload: StoryWorldCardTemplateCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardTemplateOut:
    user = get_current_user(db, authorization)
    template = build_story_world_card_template(
        user_id=int(user.id),
        title=payload.title,
        content=payload.content,
        triggers=payload.triggers,
        kind=payload.kind,
        detail_type=payload.detail_type,
        avatar_url=payload.avatar_url,
        avatar_original_url=payload.avatar_original_url,
        avatar_scale=payload.avatar_scale,
        memory_turns=payload.memory_turns,
        memory_turns_explicit="memory_turns" in payload.model_fields_set,
    )
    if template.kind == STORY_WORLD_CARD_KIND_WORLD and template.detail_type:
        upsert_story_world_detail_type(db, user_id=int(user.id), name=template.detail_type)
    db.add(template)
    db.commit()
    db.refresh(template)
    return story_world_card_template_to_out(template)


@router.patch("/api/story/world-card-templates/{template_id}", response_model=StoryWorldCardTemplateOut)
def update_story_world_card_template(
    template_id: int,
    payload: StoryWorldCardTemplateUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryWorldCardTemplateOut:
    user = get_current_user(db, authorization)
    template = db.scalar(
        select(StoryWorldCardTemplate).where(
            StoryWorldCardTemplate.id == template_id,
            StoryWorldCardTemplate.user_id == int(user.id),
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card template not found")

    normalized_kind = normalize_story_world_card_template_kind(getattr(template, "kind", None))
    prepared_template = build_story_world_card_template(
        user_id=int(user.id),
        title=payload.title,
        content=payload.content,
        triggers=payload.triggers,
        kind=normalized_kind,
        detail_type=payload.detail_type,
        avatar_url=payload.avatar_url,
        avatar_original_url=payload.avatar_original_url,
        avatar_scale=payload.avatar_scale,
        memory_turns=payload.memory_turns,
        memory_turns_explicit="memory_turns" in payload.model_fields_set,
    )

    template.title = prepared_template.title
    template.content = prepared_template.content
    template.triggers = prepared_template.triggers
    template.kind = normalized_kind
    template.detail_type = prepared_template.detail_type
    template.avatar_url = prepared_template.avatar_url
    template.avatar_original_url = prepared_template.avatar_original_url
    template.avatar_scale = prepared_template.avatar_scale
    template.memory_turns = prepared_template.memory_turns

    if template.kind == STORY_WORLD_CARD_KIND_WORLD and template.detail_type:
        upsert_story_world_detail_type(db, user_id=int(user.id), name=template.detail_type)

    db.commit()
    db.refresh(template)
    return story_world_card_template_to_out(template)


@router.delete("/api/story/world-card-templates/{template_id}", response_model=MessageResponse)
def delete_story_world_card_template(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    template = db.scalar(
        select(StoryWorldCardTemplate).where(
            StoryWorldCardTemplate.id == template_id,
            StoryWorldCardTemplate.user_id == int(user.id),
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card template not found")
    db.delete(template)
    db.commit()
    return MessageResponse(message="World card template deleted")


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
    if _is_public_story_game(game):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Public worlds are published without a main hero",
        )
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
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
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
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
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

    normalized_avatar = normalize_story_character_avatar_url(payload.avatar_url)
    normalized_avatar_original = normalize_story_character_avatar_original_url(payload.avatar_original_url)
    world_card.avatar_url = normalized_avatar
    world_card.avatar_original_url = normalized_avatar_original if normalized_avatar else None
    if payload.avatar_scale is not None:
        world_card.avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
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
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
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
    existing_cards = list_story_world_cards(db, game.id)
    normalized_title = normalize_story_world_card_title(payload.title)
    normalized_content = normalize_story_world_card_content(payload.content)
    normalized_triggers = normalize_story_world_card_triggers(payload.triggers, fallback_title=normalized_title)
    normalized_kind = normalize_story_world_card_kind(payload.kind)
    is_character_card = normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}
    normalized_race = normalize_story_character_race(payload.race) if is_character_card else ""
    normalized_clothing = normalize_story_character_clothing(payload.clothing) if is_character_card else ""
    normalized_inventory = normalize_story_character_inventory(payload.inventory) if is_character_card else ""
    normalized_health_status = normalize_story_character_health_status(payload.health_status) if is_character_card else ""
    normalized_detail_type = normalize_story_world_detail_type(payload.detail_type) if normalized_kind == STORY_WORLD_CARD_KIND_WORLD else ""
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO and _is_public_story_game(game):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Public worlds are published without a main hero",
        )
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        normalized_content = normalize_story_npc_profile_content(normalized_title, normalized_content)
    normalized_avatar = normalize_story_character_avatar_url(payload.avatar_url)
    normalized_avatar_original = normalize_story_character_avatar_original_url(payload.avatar_original_url)
    normalized_avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    linked_character = (
        get_story_character_for_user_or_404(db, user.id, payload.character_id)
        if is_character_card and payload.character_id is not None
        else None
    )
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
    if normalized_kind == STORY_WORLD_CARD_KIND_WORLD_PROFILE:
        existing_world_profile = next(
            (
                card
                for card in existing_cards
                if normalize_story_world_card_kind(getattr(card, "kind", None)) == STORY_WORLD_CARD_KIND_WORLD_PROFILE
            ),
            None,
        )
        if existing_world_profile is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="World description card is already created",
            )

    world_card = StoryWorldCard(
        game_id=game.id,
        title=normalized_title,
        content=normalized_content,
        race=normalized_race,
        clothing=normalized_clothing,
        inventory=normalized_inventory,
        health_status=normalized_health_status,
        triggers=serialize_story_world_card_triggers(normalized_triggers),
        kind=normalized_kind,
        detail_type=normalized_detail_type,
        avatar_url=normalized_avatar,
        avatar_original_url=normalized_avatar_original if normalized_avatar else None,
        avatar_scale=normalized_avatar_scale,
        character_id=linked_character.id if linked_character is not None else None,
        memory_turns=normalized_memory_turns,
        is_locked=False,
        ai_edit_enabled=True,
        source=STORY_WORLD_CARD_SOURCE_USER,
    )
    db.add(world_card)
    if normalized_kind == STORY_WORLD_CARD_KIND_WORLD and normalized_detail_type:
        upsert_story_world_detail_type(db, user_id=int(user.id), name=normalized_detail_type)
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
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
    is_character_card = normalized_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}
    normalized_race = normalize_story_character_race(payload.race) if is_character_card else ""
    normalized_clothing = normalize_story_character_clothing(payload.clothing) if is_character_card else ""
    normalized_inventory = normalize_story_character_inventory(payload.inventory) if is_character_card else ""
    normalized_health_status = normalize_story_character_health_status(payload.health_status) if is_character_card else ""
    normalized_detail_type = normalize_story_world_detail_type(payload.detail_type) if normalized_kind == STORY_WORLD_CARD_KIND_WORLD else ""
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO and _is_public_story_game(game):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Public worlds are published without a main hero",
        )
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
    world_card.race = normalized_race
    world_card.clothing = normalized_clothing
    world_card.inventory = normalized_inventory
    world_card.health_status = normalized_health_status
    world_card.triggers = serialize_story_world_card_triggers(normalized_triggers)
    world_card.detail_type = normalized_detail_type
    if not is_character_card:
        world_card.character_id = None
    elif "character_id" in payload.model_fields_set:
        if payload.character_id is None:
            world_card.character_id = None
        else:
            linked_character = get_story_character_for_user_or_404(db, user.id, payload.character_id)
            world_card.character_id = linked_character.id
    world_card.memory_turns = normalized_memory_turns
    if normalized_kind == STORY_WORLD_CARD_KIND_WORLD and normalized_detail_type:
        upsert_story_world_detail_type(db, user_id=int(user.id), name=normalized_detail_type)
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
    db.commit()
    db.refresh(world_card)
    return story_world_card_to_out(world_card)


@router.delete("/api/story/games/{game_id}/world-cards/{card_id}", response_model=MessageResponse)
def delete_story_world_card(
    game_id: int,
    card_id: int,
    allow_main_hero_delete: bool = False,
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
        can_delete_main_hero = (
            allow_main_hero_delete
            and (game.visibility or "").strip().lower() == STORY_GAME_VISIBILITY_PUBLIC
        )
        if not can_delete_main_hero:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Main hero cannot be removed once selected",
            )

    db.execute(
        sa_update(StoryWorldCardChangeEvent)
        .where(
            StoryWorldCardChangeEvent.world_card_id == world_card.id,
        )
        .values(world_card_id=None)
    )
    db.delete(world_card)
    sync_story_character_state_payload_from_world_cards(
        db=db,
        game=game,
        sync_manual_snapshot=bool(getattr(game, "character_state_enabled", None)),
    )
    touch_story_game(game)
    _refresh_public_story_game_snapshots_if_needed(db, game)
    db.commit()
    return MessageResponse(message="World card deleted")
