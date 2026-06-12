from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, load_only

from app.models import (
    StoryCharacter,
    StoryGame,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryMemoryBlock,
    StoryMessage,
    StoryMessageSegment,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)

STORY_GAME_VISIBILITY_PUBLIC = "public"
STORY_CARD_VISIBILITY_PUBLIC = "public"
STORY_WORLD_CARD_KIND_MAIN_HERO = "main_hero"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def touch_story_game(game: StoryGame) -> None:
    game.last_activity_at = _utcnow()


def get_user_story_game_or_404(db: Session, user_id: int, game_id: int) -> StoryGame:
    game = db.scalar(
        select(StoryGame).where(
            StoryGame.id == game_id,
            StoryGame.user_id == user_id,
        )
    )
    if game is not None:
        return game
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")


def get_public_story_world_or_404(db: Session, world_id: int) -> StoryGame:
    world = db.scalar(
        select(StoryGame).where(
            StoryGame.id == world_id,
            StoryGame.visibility == STORY_GAME_VISIBILITY_PUBLIC,
        )
    )
    if world is not None:
        return world
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community world not found")


def get_public_story_character_or_404(db: Session, character_id: int) -> StoryCharacter:
    character = db.scalar(
        select(StoryCharacter).where(
            StoryCharacter.id == character_id,
            StoryCharacter.visibility == STORY_CARD_VISIBILITY_PUBLIC,
        )
    )
    if character is not None:
        return character
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community character not found")


def get_public_story_instruction_template_or_404(db: Session, template_id: int) -> StoryInstructionTemplate:
    template = db.scalar(
        select(StoryInstructionTemplate).where(
            StoryInstructionTemplate.id == template_id,
            StoryInstructionTemplate.visibility == STORY_CARD_VISIBILITY_PUBLIC,
        )
    )
    if template is not None:
        return template
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community instruction template not found")


def list_story_messages(db: Session, game_id: int) -> list[StoryMessage]:
    return db.scalars(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.asc())
    ).all()


def list_story_messages_window(
    db: Session,
    game_id: int,
    *,
    assistant_turns_limit: int | None = None,
    before_message_id: int | None = None,
) -> tuple[list[StoryMessage], bool]:
    normalized_turn_limit = max(int(assistant_turns_limit or 0), 0)
    normalized_before_message_id = max(int(before_message_id or 0), 0)
    if normalized_turn_limit <= 0:
        messages = list_story_messages(db, game_id)
        return messages, False

    assistant_query = (
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == "assistant",
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(normalized_turn_limit)
    )
    if normalized_before_message_id > 0:
        assistant_query = assistant_query.where(StoryMessage.id < normalized_before_message_id)

    assistant_anchor_ids = [
        int(message_id)
        for message_id in db.scalars(assistant_query).all()
        if int(message_id or 0) > 0
    ]

    if not assistant_anchor_ids:
        fallback_query = (
            select(StoryMessage)
            .where(
                StoryMessage.game_id == game_id,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.asc())
        )
        if normalized_before_message_id > 0:
            fallback_query = fallback_query.where(StoryMessage.id < normalized_before_message_id)
        messages = db.scalars(fallback_query).all()
        return messages, False

    oldest_assistant_id = min(assistant_anchor_ids)
    start_message_id = db.scalar(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == "user",
            StoryMessage.id < oldest_assistant_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    if not isinstance(start_message_id, int) or start_message_id <= 0:
        start_message_id = oldest_assistant_id

    window_query = (
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.id >= start_message_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.asc())
    )
    if normalized_before_message_id > 0:
        window_query = window_query.where(StoryMessage.id < normalized_before_message_id)
    messages = db.scalars(window_query).all()
    if not messages:
        return [], False

    oldest_loaded_message_id = int(getattr(messages[0], "id", 0) or 0)
    has_older_messages = db.scalar(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.id < oldest_loaded_message_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    ) is not None
    return messages, has_older_messages


def list_story_turn_images(db: Session, game_id: int) -> list[StoryTurnImage]:
    rows = db.execute(
        select(
            StoryTurnImage,
            StoryTurnImage.image_data_url.is_not(None).label("has_image_data_url"),
        )
        .options(
            load_only(
                StoryTurnImage.id,
                StoryTurnImage.game_id,
                StoryTurnImage.assistant_message_id,
                StoryTurnImage.model,
                StoryTurnImage.prompt,
                StoryTurnImage.revised_prompt,
                StoryTurnImage.image_url,
                StoryTurnImage.created_at,
                StoryTurnImage.updated_at,
            )
        )
        .where(
            StoryTurnImage.game_id == game_id,
            StoryTurnImage.undone_at.is_(None),
        )
        .order_by(StoryTurnImage.assistant_message_id.asc(), StoryTurnImage.id.asc())
    ).all()
    images: list[StoryTurnImage] = []
    for image, has_image_data_url in rows:
        setattr(image, "_morius_has_image_data_url", bool(has_image_data_url))
        images.append(image)
    return images


def list_story_message_segments(
    db: Session,
    game_id: int,
    *,
    message_ids: list[int] | None = None,
) -> list[StoryMessageSegment]:
    query = (
        select(StoryMessageSegment)
        .join(StoryMessage, StoryMessage.id == StoryMessageSegment.message_id)
        .where(
            StoryMessageSegment.game_id == game_id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessageSegment.message_id.asc(), StoryMessageSegment.order_index.asc())
    )
    normalized_message_ids = [
        int(message_id)
        for message_id in (message_ids or [])
        if isinstance(message_id, int) and int(message_id) > 0
    ]
    if normalized_message_ids:
        query = query.where(StoryMessageSegment.message_id.in_(normalized_message_ids))
    return db.scalars(query).all()


def has_story_assistant_redo_step(db: Session, game_id: int) -> bool:
    has_undone_message = db.scalar(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.undone_at.is_not(None),
        )
        .order_by(StoryMessage.undone_at.desc(), StoryMessage.id.desc())
        .limit(1)
    )
    if has_undone_message is not None:
        return True
    has_undone_image = db.scalar(
        select(StoryTurnImage.id)
        .where(
            StoryTurnImage.game_id == game_id,
            StoryTurnImage.undone_at.is_not(None),
        )
        .order_by(StoryTurnImage.undone_at.desc(), StoryTurnImage.id.desc())
        .limit(1)
    )
    return has_undone_image is not None


def list_story_instruction_cards(db: Session, game_id: int) -> list[StoryInstructionCard]:
    return db.scalars(
        select(StoryInstructionCard)
        .where(StoryInstructionCard.game_id == game_id)
        .order_by(StoryInstructionCard.id.asc())
    ).all()


def list_story_plot_cards(db: Session, game_id: int) -> list[StoryPlotCard]:
    return db.scalars(
        select(StoryPlotCard)
        .where(StoryPlotCard.game_id == game_id)
        .order_by(StoryPlotCard.id.asc())
    ).all()


def list_story_memory_blocks(
    db: Session,
    game_id: int,
    *,
    assistant_message_id: int | None = None,
    include_undone: bool = False,
) -> list[StoryMemoryBlock]:
    query = select(StoryMemoryBlock).where(StoryMemoryBlock.game_id == game_id)
    if assistant_message_id is not None:
        query = query.where(StoryMemoryBlock.assistant_message_id == assistant_message_id)
    if not include_undone:
        query = query.where(StoryMemoryBlock.undone_at.is_(None))
    query = query.order_by(StoryMemoryBlock.id.asc())
    return db.scalars(query).all()


def list_story_world_cards(db: Session, game_id: int) -> list[StoryWorldCard]:
    return db.scalars(
        select(StoryWorldCard)
        .where(StoryWorldCard.game_id == game_id)
        .order_by(StoryWorldCard.id.asc())
    ).all()


def list_story_characters(
    db: Session,
    user_id: int,
    *,
    limit: int | None = None,
    offset: int = 0,
    query: str = "",
    include_emotion_assets: bool = True,
) -> list[StoryCharacter]:
    statement = select(StoryCharacter).where(StoryCharacter.user_id == user_id)
    if not include_emotion_assets:
        statement = statement.options(
            load_only(
                StoryCharacter.id,
                StoryCharacter.user_id,
                StoryCharacter.name,
                StoryCharacter.description,
                StoryCharacter.race,
                StoryCharacter.clothing,
                StoryCharacter.inventory,
                StoryCharacter.health_status,
                StoryCharacter.note,
                StoryCharacter.triggers,
                StoryCharacter.name_color,
                StoryCharacter.speech_color,
                StoryCharacter.avatar_url,
                StoryCharacter.avatar_original_url,
                StoryCharacter.avatar_scale,
                StoryCharacter.emotion_model,
                StoryCharacter.emotion_prompt_lock,
                StoryCharacter.source,
                StoryCharacter.visibility,
                StoryCharacter.source_character_id,
                StoryCharacter.community_rating_sum,
                StoryCharacter.community_rating_count,
                StoryCharacter.community_additions_count,
                StoryCharacter.publication_status,
                StoryCharacter.publication_requested_at,
                StoryCharacter.publication_reviewed_at,
                StoryCharacter.publication_reviewer_user_id,
                StoryCharacter.publication_rejection_reason,
                StoryCharacter.created_at,
                StoryCharacter.updated_at,
            )
        )
    normalized_query = " ".join(str(query or "").split()).strip()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                StoryCharacter.name.ilike(pattern),
                StoryCharacter.race.ilike(pattern),
                StoryCharacter.description.ilike(pattern),
                StoryCharacter.clothing.ilike(pattern),
                StoryCharacter.inventory.ilike(pattern),
                StoryCharacter.health_status.ilike(pattern),
                StoryCharacter.note.ilike(pattern),
                StoryCharacter.triggers.ilike(pattern),
            )
        )
    is_paginated_lookup = limit is not None or offset > 0 or bool(normalized_query)
    if is_paginated_lookup:
        statement = statement.order_by(StoryCharacter.updated_at.desc(), StoryCharacter.id.desc())
    else:
        statement = statement.order_by(StoryCharacter.id.asc())
    if offset > 0:
        statement = statement.offset(offset)
    if limit is not None:
        statement = statement.limit(limit)
    return db.scalars(statement).all()


def list_story_instruction_templates(
    db: Session,
    user_id: int,
    *,
    limit: int | None = None,
    offset: int = 0,
    query: str = "",
) -> list[StoryInstructionTemplate]:
    statement = select(StoryInstructionTemplate).where(StoryInstructionTemplate.user_id == user_id)
    normalized_query = " ".join(str(query or "").split()).strip()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                StoryInstructionTemplate.title.ilike(pattern),
                StoryInstructionTemplate.content.ilike(pattern),
            )
        )
    is_paginated_lookup = limit is not None or offset > 0 or bool(normalized_query)
    if is_paginated_lookup:
        statement = statement.order_by(StoryInstructionTemplate.updated_at.desc(), StoryInstructionTemplate.id.desc())
    else:
        statement = statement.order_by(StoryInstructionTemplate.id.asc())
    if offset > 0:
        statement = statement.offset(offset)
    if limit is not None:
        statement = statement.limit(limit)
    return db.scalars(statement).all()


def get_story_instruction_template_for_user_or_404(
    db: Session,
    user_id: int,
    template_id: int,
) -> StoryInstructionTemplate:
    template = db.scalar(
        select(StoryInstructionTemplate).where(
            StoryInstructionTemplate.id == template_id,
            StoryInstructionTemplate.user_id == user_id,
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction template not found")
    return template


def get_story_character_for_user_or_404(db: Session, user_id: int, character_id: int) -> StoryCharacter:
    character = db.scalar(
        select(StoryCharacter).where(
            StoryCharacter.id == character_id,
            StoryCharacter.user_id == user_id,
        )
    )
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")
    return character


def get_story_main_hero_card(db: Session, game_id: int) -> StoryWorldCard | None:
    return db.scalar(
        select(StoryWorldCard)
        .where(
            StoryWorldCard.game_id == game_id,
            StoryWorldCard.kind == STORY_WORLD_CARD_KIND_MAIN_HERO,
        )
        .order_by(StoryWorldCard.id.asc())
    )


def list_story_plot_card_events(
    db: Session,
    game_id: int,
    *,
    assistant_message_id: int | None = None,
    include_undone: bool = False,
) -> list[StoryPlotCardChangeEvent]:
    query = select(StoryPlotCardChangeEvent).where(StoryPlotCardChangeEvent.game_id == game_id)
    if assistant_message_id is not None:
        query = query.where(StoryPlotCardChangeEvent.assistant_message_id == assistant_message_id)
    if not include_undone:
        query = query.where(StoryPlotCardChangeEvent.undone_at.is_(None))
    query = query.order_by(StoryPlotCardChangeEvent.id.asc())
    return db.scalars(query).all()


def list_story_world_card_events(
    db: Session,
    game_id: int,
    *,
    assistant_message_id: int | None = None,
    include_undone: bool = False,
) -> list[StoryWorldCardChangeEvent]:
    query = select(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == game_id)
    if assistant_message_id is not None:
        query = query.where(StoryWorldCardChangeEvent.assistant_message_id == assistant_message_id)
    if not include_undone:
        query = query.where(StoryWorldCardChangeEvent.undone_at.is_(None))
    query = query.order_by(StoryWorldCardChangeEvent.id.asc())
    return db.scalars(query).all()
