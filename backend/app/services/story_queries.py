from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacter,
    StoryGame,
    StoryInstructionCard,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)

STORY_GAME_VISIBILITY_PUBLIC = "public"
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


def list_story_messages(db: Session, game_id: int) -> list[StoryMessage]:
    return db.scalars(
        select(StoryMessage).where(StoryMessage.game_id == game_id).order_by(StoryMessage.id.asc())
    ).all()


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

