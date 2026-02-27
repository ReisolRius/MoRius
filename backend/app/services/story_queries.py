from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacter,
    StoryGame,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryMessage,
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
            StoryGame.source_world_id.is_(None),
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
            StoryCharacter.source_character_id.is_(None),
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
            StoryInstructionTemplate.source_template_id.is_(None),
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


def list_story_turn_images(db: Session, game_id: int) -> list[StoryTurnImage]:
    return db.scalars(
        select(StoryTurnImage)
        .where(
            StoryTurnImage.game_id == game_id,
            StoryTurnImage.undone_at.is_(None),
        )
        .order_by(StoryTurnImage.assistant_message_id.asc(), StoryTurnImage.id.asc())
    ).all()


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


def list_story_world_cards(db: Session, game_id: int) -> list[StoryWorldCard]:
    return db.scalars(
        select(StoryWorldCard)
        .where(StoryWorldCard.game_id == game_id)
        .order_by(StoryWorldCard.id.asc())
    ).all()


def list_story_characters(db: Session, user_id: int) -> list[StoryCharacter]:
    return db.scalars(
        select(StoryCharacter)
        .where(StoryCharacter.user_id == user_id)
        .order_by(StoryCharacter.id.asc())
    ).all()


def list_story_instruction_templates(db: Session, user_id: int) -> list[StoryInstructionTemplate]:
    return db.scalars(
        select(StoryInstructionTemplate)
        .where(StoryInstructionTemplate.user_id == user_id)
        .order_by(StoryInstructionTemplate.id.asc())
    ).all()


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
