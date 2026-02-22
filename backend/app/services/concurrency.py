from __future__ import annotations

from datetime import datetime

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.models import CoinPurchase, StoryGame, User


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
