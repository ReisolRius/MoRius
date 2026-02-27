from __future__ import annotations

from datetime import datetime

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.models import CoinPurchase, StoryCharacter, StoryGame, StoryInstructionTemplate, User


def increment_story_world_views(db: Session, world_id: int) -> None:
    db.execute(
        sa_update(StoryGame)
        .where(StoryGame.id == world_id)
        .values(community_views=StoryGame.community_views + 1)
    )


def increment_story_world_launches(db: Session, world_id: int) -> None:
    db.execute(
        sa_update(StoryGame)
        .where(StoryGame.id == world_id)
        .values(community_launches=StoryGame.community_launches + 1)
    )


def apply_story_world_rating_insert(db: Session, world_id: int, rating_value: int) -> None:
    db.execute(
        sa_update(StoryGame)
        .where(StoryGame.id == world_id)
        .values(
            community_rating_sum=StoryGame.community_rating_sum + rating_value,
            community_rating_count=StoryGame.community_rating_count + 1,
        )
    )


def apply_story_world_rating_update(db: Session, world_id: int, rating_delta: int) -> None:
    if rating_delta == 0:
        return
    db.execute(
        sa_update(StoryGame)
        .where(StoryGame.id == world_id)
        .values(community_rating_sum=StoryGame.community_rating_sum + rating_delta)
    )


def apply_story_character_rating_insert(db: Session, character_id: int, rating_value: int) -> None:
    db.execute(
        sa_update(StoryCharacter)
        .where(StoryCharacter.id == character_id)
        .values(
            community_rating_sum=StoryCharacter.community_rating_sum + rating_value,
            community_rating_count=StoryCharacter.community_rating_count + 1,
        )
    )


def apply_story_character_rating_update(db: Session, character_id: int, rating_delta: int) -> None:
    if rating_delta == 0:
        return
    db.execute(
        sa_update(StoryCharacter)
        .where(StoryCharacter.id == character_id)
        .values(community_rating_sum=StoryCharacter.community_rating_sum + rating_delta)
    )


def increment_story_character_additions(db: Session, character_id: int) -> None:
    db.execute(
        sa_update(StoryCharacter)
        .where(StoryCharacter.id == character_id)
        .values(community_additions_count=StoryCharacter.community_additions_count + 1)
    )


def apply_story_instruction_template_rating_insert(db: Session, template_id: int, rating_value: int) -> None:
    db.execute(
        sa_update(StoryInstructionTemplate)
        .where(StoryInstructionTemplate.id == template_id)
        .values(
            community_rating_sum=StoryInstructionTemplate.community_rating_sum + rating_value,
            community_rating_count=StoryInstructionTemplate.community_rating_count + 1,
        )
    )


def apply_story_instruction_template_rating_update(db: Session, template_id: int, rating_delta: int) -> None:
    if rating_delta == 0:
        return
    db.execute(
        sa_update(StoryInstructionTemplate)
        .where(StoryInstructionTemplate.id == template_id)
        .values(community_rating_sum=StoryInstructionTemplate.community_rating_sum + rating_delta)
    )


def increment_story_instruction_template_additions(db: Session, template_id: int) -> None:
    db.execute(
        sa_update(StoryInstructionTemplate)
        .where(StoryInstructionTemplate.id == template_id)
        .values(community_additions_count=StoryInstructionTemplate.community_additions_count + 1)
    )


def grant_purchase_coins_once(
    db: Session,
    *,
    purchase_id: int,
    user_id: int,
    coins: int,
    granted_at: datetime,
) -> bool:
    grant_result = db.execute(
        sa_update(CoinPurchase)
        .where(
            CoinPurchase.id == purchase_id,
            CoinPurchase.coins_granted_at.is_(None),
        )
        .values(coins_granted_at=granted_at)
    )
    if (grant_result.rowcount or 0) <= 0:
        return False

    db.execute(
        sa_update(User)
        .where(User.id == user_id)
        .values(coins=User.coins + coins)
    )
    return True


def spend_user_tokens_if_sufficient(
    db: Session,
    *,
    user_id: int,
    tokens: int,
) -> bool:
    normalized_tokens = int(tokens)
    if normalized_tokens <= 0:
        return True

    update_result = db.execute(
        sa_update(User)
        .where(
            User.id == user_id,
            User.coins >= normalized_tokens,
        )
        .values(coins=User.coins - normalized_tokens)
    )
    return (update_result.rowcount or 0) > 0


def add_user_tokens(
    db: Session,
    *,
    user_id: int,
    tokens: int,
) -> None:
    normalized_tokens = int(tokens)
    if normalized_tokens <= 0:
        return

    db.execute(
        sa_update(User)
        .where(User.id == user_id)
        .values(coins=User.coins + normalized_tokens)
    )
