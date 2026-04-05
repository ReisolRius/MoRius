from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import StoryCharacterStateSnapshot, StoryGame, StoryMessage
from app.services.story_games import (
    deserialize_story_character_state_cards_payload,
    serialize_story_character_state_cards_payload,
)


def _normalize_story_character_state_snapshot_payload(raw_value: str | None) -> str:
    return serialize_story_character_state_cards_payload(
        deserialize_story_character_state_cards_payload(raw_value or "")
    )


def _ensure_story_character_state_snapshot_table(db: Session) -> None:
    StoryCharacterStateSnapshot.__table__.create(bind=db.get_bind(), checkfirst=True)


def get_latest_story_character_state_snapshot(
    *,
    db: Session,
    game_id: int,
    include_undone: bool = False,
) -> StoryCharacterStateSnapshot | None:
    _ensure_story_character_state_snapshot_table(db)
    query = (
        select(StoryCharacterStateSnapshot)
        .where(StoryCharacterStateSnapshot.game_id == game_id)
        .order_by(StoryCharacterStateSnapshot.id.desc())
    )
    if not include_undone:
        query = query.where(StoryCharacterStateSnapshot.undone_at.is_(None))
    return db.scalar(query.limit(1))


def sync_story_character_state_manual_snapshot(
    *,
    db: Session,
    game: StoryGame,
) -> bool:
    _ensure_story_character_state_snapshot_table(db)
    normalized_payload = _normalize_story_character_state_snapshot_payload(
        str(getattr(game, "character_state_payload", "") or "")
    )
    current_manual_snapshots = db.scalars(
        select(StoryCharacterStateSnapshot)
        .where(
            StoryCharacterStateSnapshot.game_id == game.id,
            StoryCharacterStateSnapshot.assistant_message_id.is_(None),
            StoryCharacterStateSnapshot.undone_at.is_(None),
        )
        .order_by(StoryCharacterStateSnapshot.id.desc())
    ).all()
    if current_manual_snapshots and str(current_manual_snapshots[0].payload or "") == normalized_payload:
        return False

    if current_manual_snapshots:
        db.execute(
            sa_delete(StoryCharacterStateSnapshot).where(
                StoryCharacterStateSnapshot.game_id == game.id,
                StoryCharacterStateSnapshot.assistant_message_id.is_(None),
            )
        )

    db.add(
        StoryCharacterStateSnapshot(
            game_id=game.id,
            assistant_message_id=None,
            payload=normalized_payload,
        )
    )
    db.flush()
    return True


def ensure_story_character_state_snapshot_baseline(
    *,
    db: Session,
    game: StoryGame,
) -> bool:
    latest_snapshot = get_latest_story_character_state_snapshot(db=db, game_id=game.id)
    if isinstance(latest_snapshot, StoryCharacterStateSnapshot):
        return False
    return sync_story_character_state_manual_snapshot(db=db, game=game)


def create_story_character_state_assistant_snapshot(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
) -> bool:
    _ensure_story_character_state_snapshot_table(db)
    normalized_payload = _normalize_story_character_state_snapshot_payload(
        str(getattr(game, "character_state_payload", "") or "")
    )
    current_snapshot = db.scalar(
        select(StoryCharacterStateSnapshot)
        .where(
            StoryCharacterStateSnapshot.game_id == game.id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message.id,
        )
        .order_by(StoryCharacterStateSnapshot.id.desc())
        .limit(1)
    )
    if isinstance(current_snapshot, StoryCharacterStateSnapshot) and str(current_snapshot.payload or "") == normalized_payload:
        return False

    db.execute(
        sa_delete(StoryCharacterStateSnapshot).where(
            StoryCharacterStateSnapshot.game_id == game.id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message.id,
        )
    )
    db.add(
        StoryCharacterStateSnapshot(
            game_id=game.id,
            assistant_message_id=assistant_message.id,
            payload=normalized_payload,
        )
    )
    db.flush()
    return True


def restore_story_character_state_from_latest_snapshot(
    *,
    db: Session,
    game: StoryGame,
) -> bool:
    latest_snapshot = get_latest_story_character_state_snapshot(db=db, game_id=game.id)
    if not isinstance(latest_snapshot, StoryCharacterStateSnapshot):
        return False

    next_payload = _normalize_story_character_state_snapshot_payload(str(latest_snapshot.payload or ""))
    if str(getattr(game, "character_state_payload", "") or "") == next_payload:
        return False

    game.character_state_payload = next_payload
    db.flush()
    return True


def mark_story_character_state_snapshots_undone(
    *,
    db: Session,
    game_id: int,
    assistant_message_id: int,
    undone_at: datetime,
) -> bool:
    _ensure_story_character_state_snapshot_table(db)
    snapshots = db.scalars(
        select(StoryCharacterStateSnapshot).where(
            StoryCharacterStateSnapshot.game_id == game_id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message_id,
            StoryCharacterStateSnapshot.undone_at.is_(None),
        )
    ).all()
    changed = False
    for snapshot in snapshots:
        snapshot.undone_at = undone_at
        changed = True
    if changed:
        db.flush()
    return changed


def restore_story_character_state_snapshots_for_assistant_message(
    *,
    db: Session,
    game_id: int,
    assistant_message_id: int,
) -> bool:
    _ensure_story_character_state_snapshot_table(db)
    snapshots = db.scalars(
        select(StoryCharacterStateSnapshot).where(
            StoryCharacterStateSnapshot.game_id == game_id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message_id,
            StoryCharacterStateSnapshot.undone_at.is_not(None),
        )
    ).all()
    changed = False
    for snapshot in snapshots:
        snapshot.undone_at = None
        changed = True
    if changed:
        db.flush()
    return changed
