from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select, update as sa_update
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacterStateSnapshot,
    StoryGame,
    StoryMemoryBlock,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)
from app.services.story_character_state_snapshots import restore_story_character_state_from_latest_snapshot
from app.services.media import normalize_avatar_value
from app.services.story_cards import (
    normalize_story_plot_card_memory_turns_for_storage,
    normalize_story_plot_card_content,
    normalize_story_plot_card_source,
    normalize_story_plot_card_triggers,
    normalize_story_plot_card_title,
    serialize_story_plot_card_triggers,
)
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_race,
)
from app.services.story_events import (
    STORY_WORLD_CARD_EVENT_ADDED,
    STORY_WORLD_CARD_EVENT_DELETED,
    STORY_WORLD_CARD_EVENT_UPDATED,
    deserialize_story_plot_card_snapshot,
    deserialize_story_world_card_snapshot,
    normalize_story_world_card_event_action,
)
from app.services.story_queries import (
    list_story_plot_card_events,
    list_story_world_card_events,
    touch_story_game,
)
from app.services.story_world_cards import (
    normalize_story_world_card_content,
    normalize_story_world_card_kind,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_source,
    normalize_story_world_card_title,
    normalize_story_world_card_triggers,
    serialize_story_world_card_triggers,
)

STORY_USER_ROLE = "user"
STORY_ASSISTANT_ROLE = "assistant"
logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _extract_snapshot_card_id(snapshot: dict[str, object] | None) -> int | None:
    if snapshot is None:
        return None
    raw_card_id = snapshot.get("id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        return raw_card_id
    if isinstance(raw_card_id, str):
        normalized_card_id = raw_card_id.strip()
        if normalized_card_id.isdigit():
            parsed_card_id = int(normalized_card_id)
            if parsed_card_id > 0:
                return parsed_card_id
    return None


def _restore_story_environment_state_after_assistant_step_change(
    *,
    db: Session,
    game: StoryGame,
) -> None:
    try:
        from app.services import story_memory_pipeline
    except Exception:
        logger.exception(
            "Failed to import story_memory_pipeline for environment restore: game_id=%s",
            game.id,
        )
        return

    try:
        story_memory_pipeline._restore_story_environment_state_from_latest_weather_memory_block(
            db=db,
            game=game,
        )
    except Exception:
        logger.exception(
            "Failed to restore story environment after assistant-step change: game_id=%s",
            game.id,
        )


def restore_story_world_card_from_snapshot(
    db: Session,
    game_id: int,
    snapshot: dict[str, object] | None,
) -> StoryWorldCard | None:
    if snapshot is None:
        return None

    title = str(snapshot.get("title") or snapshot.get("name") or "").strip()
    content = str(
        snapshot.get("content")
        or snapshot.get("description")
        or snapshot.get("text")
        or snapshot.get("profile")
        or ""
    ).strip()
    if not title or not content:
        return None

    source = normalize_story_world_card_source(str(snapshot.get("source", "")))
    kind = normalize_story_world_card_kind(str(snapshot.get("kind", "")))
    race = normalize_story_character_race(snapshot.get("race"))
    clothing = normalize_story_character_clothing(snapshot.get("clothing"))
    inventory = normalize_story_character_inventory(snapshot.get("inventory"))
    health_status = normalize_story_character_health_status(snapshot.get("health_status"))
    raw_avatar = snapshot.get("avatar_url")
    avatar_url = normalize_avatar_value(raw_avatar) if isinstance(raw_avatar, str) else None
    if avatar_url is not None and avatar_url.startswith("data:image/"):
        avatar_url = normalize_story_character_avatar_url(avatar_url)
    raw_avatar_original = snapshot.get("avatar_original_url")
    avatar_original_url = normalize_avatar_value(raw_avatar_original) if isinstance(raw_avatar_original, str) else None
    if avatar_original_url is not None and avatar_original_url.startswith("data:image/"):
        avatar_original_url = normalize_story_character_avatar_original_url(avatar_original_url)
    avatar_scale = normalize_story_avatar_scale(snapshot.get("avatar_scale"))
    raw_triggers = snapshot.get("triggers")
    trigger_values: list[str] = []
    if isinstance(raw_triggers, list):
        trigger_values = [value for value in raw_triggers if isinstance(value, str)]
    elif isinstance(snapshot.get("tags"), list):
        trigger_values = [value for value in snapshot.get("tags", []) if isinstance(value, str)]
    triggers = normalize_story_world_card_triggers(trigger_values, fallback_title=title)
    has_memory_turns = "memory_turns" in snapshot
    memory_turns = normalize_story_world_card_memory_turns_for_storage(
        snapshot.get("memory_turns"),
        kind=kind,
        explicit=has_memory_turns,
        current_value=None,
    )

    raw_character_id = snapshot.get("character_id")
    character_id: int | None = None
    if isinstance(raw_character_id, int) and raw_character_id > 0:
        character_id = raw_character_id
    elif isinstance(raw_character_id, str) and raw_character_id.strip().isdigit():
        parsed_character_id = int(raw_character_id.strip())
        if parsed_character_id > 0:
            character_id = parsed_character_id

    raw_is_locked = snapshot.get("is_locked")
    if isinstance(raw_is_locked, bool):
        is_locked = raw_is_locked
    elif isinstance(raw_is_locked, (int, float)):
        is_locked = bool(raw_is_locked)
    elif isinstance(raw_is_locked, str):
        is_locked = raw_is_locked.strip().lower() in {"1", "true", "yes", "y", "on"}
    else:
        is_locked = False

    has_ai_edit_enabled = "ai_edit_enabled" in snapshot
    raw_ai_edit_enabled = snapshot.get("ai_edit_enabled")
    if isinstance(raw_ai_edit_enabled, bool):
        ai_edit_enabled = raw_ai_edit_enabled
    elif isinstance(raw_ai_edit_enabled, (int, float)):
        ai_edit_enabled = bool(raw_ai_edit_enabled)
    elif isinstance(raw_ai_edit_enabled, str):
        ai_edit_enabled = raw_ai_edit_enabled.strip().lower() in {"1", "true", "yes", "y", "on"}
    else:
        ai_edit_enabled = True

    card_id: int | None = None
    raw_card_id = snapshot.get("id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        card_id = raw_card_id

    world_card: StoryWorldCard | None = None
    if card_id is not None:
        world_card = db.scalar(
            select(StoryWorldCard).where(
                StoryWorldCard.id == card_id,
                StoryWorldCard.game_id == game_id,
            )
        )

    if world_card is None:
        world_card = StoryWorldCard(
            game_id=game_id,
            title=normalize_story_world_card_title(title),
            content=normalize_story_world_card_content(content),
            race=race,
            clothing=clothing,
            inventory=inventory,
            health_status=health_status,
            triggers=serialize_story_world_card_triggers(triggers),
            kind=kind,
            avatar_url=avatar_url,
            avatar_original_url=avatar_original_url if avatar_url else None,
            avatar_scale=avatar_scale,
            character_id=character_id,
            memory_turns=memory_turns,
            is_locked=is_locked,
            ai_edit_enabled=ai_edit_enabled,
            source=source,
        )
        db.add(world_card)
        db.flush()
        return world_card

    world_card.title = normalize_story_world_card_title(title)
    world_card.content = normalize_story_world_card_content(content)
    world_card.race = race
    world_card.clothing = clothing
    world_card.inventory = inventory
    world_card.health_status = health_status
    world_card.triggers = serialize_story_world_card_triggers(triggers)
    world_card.kind = kind
    world_card.avatar_url = avatar_url
    world_card.avatar_original_url = avatar_original_url if avatar_url else None
    world_card.avatar_scale = avatar_scale
    world_card.character_id = character_id
    if has_memory_turns:
        world_card.memory_turns = memory_turns
    else:
        world_card.memory_turns = normalize_story_world_card_memory_turns_for_storage(
            world_card.memory_turns,
            kind=kind,
            explicit=False,
            current_value=world_card.memory_turns,
        )
    world_card.is_locked = is_locked
    if has_ai_edit_enabled:
        world_card.ai_edit_enabled = ai_edit_enabled
    world_card.source = source
    db.flush()
    return world_card


def undo_story_world_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryWorldCardChangeEvent,
    *,
    commit: bool = True,
    touch_game: bool = True,
) -> None:
    if event.undone_at is not None:
        return

    action = normalize_story_world_card_event_action(event.action)
    if not action:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    before_snapshot = deserialize_story_world_card_snapshot(event.before_snapshot)
    after_snapshot = deserialize_story_world_card_snapshot(event.after_snapshot)

    if action == STORY_WORLD_CARD_EVENT_ADDED:
        target_card_id = event.world_card_id
        if target_card_id is None and after_snapshot is not None:
            raw_snapshot_id = after_snapshot.get("id")
            if isinstance(raw_snapshot_id, int) and raw_snapshot_id > 0:
                target_card_id = raw_snapshot_id

        if target_card_id is not None:
            # Break FK links from event log rows before deleting the restored card.
            db.execute(
                sa_update(StoryWorldCardChangeEvent)
                .where(
                    StoryWorldCardChangeEvent.game_id == game.id,
                    StoryWorldCardChangeEvent.world_card_id == target_card_id,
                )
                .values(world_card_id=None)
            )
            if event.world_card_id == target_card_id:
                event.world_card_id = None
            world_card = db.scalar(
                select(StoryWorldCard).where(
                    StoryWorldCard.id == target_card_id,
                    StoryWorldCard.game_id == game.id,
                )
            )
            if world_card is not None:
                db.delete(world_card)
                db.flush()
    elif action in {STORY_WORLD_CARD_EVENT_UPDATED, STORY_WORLD_CARD_EVENT_DELETED}:
        restored_card = restore_story_world_card_from_snapshot(db, game.id, before_snapshot)
        if restored_card is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot restore world card state for this event",
            )
        event.world_card_id = restored_card.id
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    event.undone_at = _utcnow()
    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()


def redo_story_world_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryWorldCardChangeEvent,
    *,
    commit: bool = True,
    touch_game: bool = True,
) -> None:
    if event.undone_at is None:
        return

    action = normalize_story_world_card_event_action(event.action)
    if not action:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    before_snapshot = deserialize_story_world_card_snapshot(event.before_snapshot)
    after_snapshot = deserialize_story_world_card_snapshot(event.after_snapshot)

    if action in {STORY_WORLD_CARD_EVENT_ADDED, STORY_WORLD_CARD_EVENT_UPDATED}:
        restored_card = restore_story_world_card_from_snapshot(db, game.id, after_snapshot)
        if restored_card is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot reapply world card state for this event",
            )
        event.world_card_id = restored_card.id
    elif action == STORY_WORLD_CARD_EVENT_DELETED:
        target_card_id = event.world_card_id
        if target_card_id is None:
            target_card_id = _extract_snapshot_card_id(before_snapshot)

        if target_card_id is not None:
            # Break FK links from event log rows before deleting the restored card.
            db.execute(
                sa_update(StoryWorldCardChangeEvent)
                .where(
                    StoryWorldCardChangeEvent.game_id == game.id,
                    StoryWorldCardChangeEvent.world_card_id == target_card_id,
                )
                .values(world_card_id=None)
            )
            if event.world_card_id == target_card_id:
                event.world_card_id = None
            world_card = db.scalar(
                select(StoryWorldCard).where(
                    StoryWorldCard.id == target_card_id,
                    StoryWorldCard.game_id == game.id,
                )
            )
            if world_card is not None:
                db.delete(world_card)
                db.flush()
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported world card event action")

    event.undone_at = None
    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()


def restore_story_plot_card_from_snapshot(
    db: Session,
    game_id: int,
    snapshot: dict[str, object] | None,
) -> StoryPlotCard | None:
    if snapshot is None:
        return None

    title = str(snapshot.get("title") or snapshot.get("name") or snapshot.get("heading") or "").strip()
    content = str(snapshot.get("content") or snapshot.get("summary") or snapshot.get("text") or "").strip()
    if not title or not content:
        return None

    raw_triggers = snapshot.get("triggers")
    trigger_values: list[str] = []
    if isinstance(raw_triggers, list):
        trigger_values = [value for value in raw_triggers if isinstance(value, str)]
    elif isinstance(snapshot.get("tags"), list):
        trigger_values = [value for value in snapshot.get("tags", []) if isinstance(value, str)]
    triggers = normalize_story_plot_card_triggers(trigger_values, fallback_title=title)

    source = normalize_story_plot_card_source(str(snapshot.get("source", "")))
    has_ai_edit_enabled = "ai_edit_enabled" in snapshot
    raw_ai_edit_enabled = snapshot.get("ai_edit_enabled")
    if isinstance(raw_ai_edit_enabled, bool):
        ai_edit_enabled = raw_ai_edit_enabled
    elif isinstance(raw_ai_edit_enabled, (int, float)):
        ai_edit_enabled = bool(raw_ai_edit_enabled)
    elif isinstance(raw_ai_edit_enabled, str):
        ai_edit_enabled = raw_ai_edit_enabled.strip().lower() in {"1", "true", "yes", "y", "on"}
    else:
        ai_edit_enabled = True

    has_is_enabled = "is_enabled" in snapshot
    raw_is_enabled = snapshot.get("is_enabled")
    if isinstance(raw_is_enabled, bool):
        is_enabled = raw_is_enabled
    elif isinstance(raw_is_enabled, (int, float)):
        is_enabled = bool(raw_is_enabled)
    elif isinstance(raw_is_enabled, str):
        is_enabled = raw_is_enabled.strip().lower() in {"1", "true", "yes", "y", "on"}
    else:
        is_enabled = True

    has_memory_turns = "memory_turns" in snapshot
    memory_turns = normalize_story_plot_card_memory_turns_for_storage(
        snapshot.get("memory_turns"),
        explicit=has_memory_turns,
        current_value=None,
    )

    card_id: int | None = None
    raw_card_id = snapshot.get("id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        card_id = raw_card_id

    plot_card: StoryPlotCard | None = None
    if card_id is not None:
        plot_card = db.scalar(
            select(StoryPlotCard).where(
                StoryPlotCard.id == card_id,
                StoryPlotCard.game_id == game_id,
            )
        )

    if plot_card is None:
        plot_card = StoryPlotCard(
            game_id=game_id,
            title=normalize_story_plot_card_title(title),
            content=normalize_story_plot_card_content(content),
            triggers=serialize_story_plot_card_triggers(triggers),
            memory_turns=memory_turns,
            ai_edit_enabled=ai_edit_enabled,
            is_enabled=is_enabled,
            source=source,
        )
        db.add(plot_card)
        db.flush()
        return plot_card

    plot_card.title = normalize_story_plot_card_title(title)
    plot_card.content = normalize_story_plot_card_content(content)
    plot_card.triggers = serialize_story_plot_card_triggers(triggers)
    if has_memory_turns:
        plot_card.memory_turns = normalize_story_plot_card_memory_turns_for_storage(
            snapshot.get("memory_turns"),
            explicit=True,
            current_value=plot_card.memory_turns,
        )
    else:
        plot_card.memory_turns = normalize_story_plot_card_memory_turns_for_storage(
            plot_card.memory_turns,
            explicit=False,
            current_value=plot_card.memory_turns,
        )
    if has_ai_edit_enabled:
        plot_card.ai_edit_enabled = ai_edit_enabled
    if has_is_enabled:
        plot_card.is_enabled = is_enabled
    plot_card.source = source
    db.flush()
    return plot_card


def undo_story_plot_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryPlotCardChangeEvent,
    *,
    commit: bool = True,
    touch_game: bool = True,
) -> None:
    if event.undone_at is not None:
        return

    action = normalize_story_world_card_event_action(event.action)
    if not action:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported plot card event action")

    before_snapshot = deserialize_story_plot_card_snapshot(event.before_snapshot)
    after_snapshot = deserialize_story_plot_card_snapshot(event.after_snapshot)

    if action == STORY_WORLD_CARD_EVENT_ADDED:
        target_card_id = event.plot_card_id
        if target_card_id is None and after_snapshot is not None:
            raw_snapshot_id = after_snapshot.get("id")
            if isinstance(raw_snapshot_id, int) and raw_snapshot_id > 0:
                target_card_id = raw_snapshot_id

        if target_card_id is not None:
            # Break FK links from event log rows before deleting the restored card.
            db.execute(
                sa_update(StoryPlotCardChangeEvent)
                .where(
                    StoryPlotCardChangeEvent.game_id == game.id,
                    StoryPlotCardChangeEvent.plot_card_id == target_card_id,
                )
                .values(plot_card_id=None)
            )
            if event.plot_card_id == target_card_id:
                event.plot_card_id = None
            plot_card = db.scalar(
                select(StoryPlotCard).where(
                    StoryPlotCard.id == target_card_id,
                    StoryPlotCard.game_id == game.id,
                )
            )
            if plot_card is not None:
                db.delete(plot_card)
                db.flush()
    elif action in {STORY_WORLD_CARD_EVENT_UPDATED, STORY_WORLD_CARD_EVENT_DELETED}:
        restored_card = restore_story_plot_card_from_snapshot(db, game.id, before_snapshot)
        if restored_card is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot restore plot card state for this event",
            )
        event.plot_card_id = restored_card.id
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported plot card event action")

    event.undone_at = _utcnow()
    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()


def redo_story_plot_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryPlotCardChangeEvent,
    *,
    commit: bool = True,
    touch_game: bool = True,
) -> None:
    if event.undone_at is None:
        return

    action = normalize_story_world_card_event_action(event.action)
    if not action:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported plot card event action")

    before_snapshot = deserialize_story_plot_card_snapshot(event.before_snapshot)
    after_snapshot = deserialize_story_plot_card_snapshot(event.after_snapshot)

    if action in {STORY_WORLD_CARD_EVENT_ADDED, STORY_WORLD_CARD_EVENT_UPDATED}:
        restored_card = restore_story_plot_card_from_snapshot(db, game.id, after_snapshot)
        if restored_card is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot reapply plot card state for this event",
            )
        event.plot_card_id = restored_card.id
    elif action == STORY_WORLD_CARD_EVENT_DELETED:
        target_card_id = event.plot_card_id
        if target_card_id is None:
            target_card_id = _extract_snapshot_card_id(before_snapshot)

        if target_card_id is not None:
            # Break FK links from event log rows before deleting the restored card.
            db.execute(
                sa_update(StoryPlotCardChangeEvent)
                .where(
                    StoryPlotCardChangeEvent.game_id == game.id,
                    StoryPlotCardChangeEvent.plot_card_id == target_card_id,
                )
                .values(plot_card_id=None)
            )
            if event.plot_card_id == target_card_id:
                event.plot_card_id = None
            plot_card = db.scalar(
                select(StoryPlotCard).where(
                    StoryPlotCard.id == target_card_id,
                    StoryPlotCard.game_id == game.id,
                )
            )
            if plot_card is not None:
                db.delete(plot_card)
                db.flush()
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported plot card event action")

    event.undone_at = None
    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()


def rollback_story_card_events_for_assistant_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message_id: int,
    commit: bool = True,
    purge_events: bool = True,
    touch_game: bool = True,
) -> None:
    now = _utcnow()
    world_events = list_story_world_card_events(
        db,
        game.id,
        assistant_message_id=assistant_message_id,
        include_undone=False,
    )
    for event in reversed(world_events):
        undo_story_world_card_change_event(db, game, event, commit=False, touch_game=False)

    plot_events = list_story_plot_card_events(
        db,
        game.id,
        assistant_message_id=assistant_message_id,
        include_undone=False,
    )
    for event in reversed(plot_events):
        undo_story_plot_card_change_event(db, game, event, commit=False, touch_game=False)

    memory_blocks = db.scalars(
        select(StoryMemoryBlock).where(
            StoryMemoryBlock.game_id == game.id,
            StoryMemoryBlock.assistant_message_id == assistant_message_id,
        )
    ).all()
    if purge_events:
        for block in memory_blocks:
            db.delete(block)
    else:
        for block in memory_blocks:
            block.undone_at = now

    character_state_snapshots = db.scalars(
        select(StoryCharacterStateSnapshot).where(
            StoryCharacterStateSnapshot.game_id == game.id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message_id,
        )
    ).all()
    if purge_events:
        for snapshot in character_state_snapshots:
            db.delete(snapshot)
    else:
        for snapshot in character_state_snapshots:
            snapshot.undone_at = now

    if purge_events:
        for event in list_story_world_card_events(
            db,
            game.id,
            assistant_message_id=assistant_message_id,
            include_undone=True,
        ):
            db.delete(event)
        for event in list_story_plot_card_events(
            db,
            game.id,
            assistant_message_id=assistant_message_id,
            include_undone=True,
        ):
            db.delete(event)
        for block in db.scalars(
            select(StoryMemoryBlock).where(
                StoryMemoryBlock.game_id == game.id,
                StoryMemoryBlock.assistant_message_id == assistant_message_id,
            )
        ).all():
            db.delete(block)
        for snapshot in db.scalars(
            select(StoryCharacterStateSnapshot).where(
                StoryCharacterStateSnapshot.game_id == game.id,
                StoryCharacterStateSnapshot.assistant_message_id == assistant_message_id,
            )
        ).all():
            db.delete(snapshot)

    restore_story_character_state_from_latest_snapshot(db=db, game=game)

    _restore_story_environment_state_after_assistant_step_change(db=db, game=game)

    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
    else:
        db.flush()


def reapply_story_card_events_for_assistant_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message_id: int,
    commit: bool = True,
    touch_game: bool = True,
) -> None:
    world_events = [
        event
        for event in list_story_world_card_events(
            db,
            game.id,
            assistant_message_id=assistant_message_id,
            include_undone=True,
        )
        if event.undone_at is not None
    ]
    for event in world_events:
        redo_story_world_card_change_event(db, game, event, commit=False, touch_game=False)

    plot_events = [
        event
        for event in list_story_plot_card_events(
            db,
            game.id,
            assistant_message_id=assistant_message_id,
            include_undone=True,
        )
        if event.undone_at is not None
    ]
    for event in plot_events:
        redo_story_plot_card_change_event(db, game, event, commit=False, touch_game=False)

    for block in db.scalars(
        select(StoryMemoryBlock).where(
            StoryMemoryBlock.game_id == game.id,
            StoryMemoryBlock.assistant_message_id == assistant_message_id,
            StoryMemoryBlock.undone_at.is_not(None),
        )
    ).all():
        block.undone_at = None

    for snapshot in db.scalars(
        select(StoryCharacterStateSnapshot).where(
            StoryCharacterStateSnapshot.game_id == game.id,
            StoryCharacterStateSnapshot.assistant_message_id == assistant_message_id,
            StoryCharacterStateSnapshot.undone_at.is_not(None),
        )
    ).all():
        snapshot.undone_at = None

    restore_story_character_state_from_latest_snapshot(db=db, game=game)

    _restore_story_environment_state_after_assistant_step_change(db=db, game=game)

    if touch_game:
        touch_story_game(game)
    if commit:
        db.commit()
    else:
        db.flush()


def undo_story_assistant_step(
    *,
    db: Session,
    game: StoryGame,
) -> str:
    last_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
    )
    if last_message is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to rollback")

    if last_message.role == STORY_ASSISTANT_ROLE:
        latest_image = db.scalar(
            select(StoryTurnImage)
            .where(
                StoryTurnImage.game_id == game.id,
                StoryTurnImage.assistant_message_id == last_message.id,
                StoryTurnImage.undone_at.is_(None),
            )
            .order_by(StoryTurnImage.id.desc())
        )
        if latest_image is not None:
            latest_image.undone_at = _utcnow()
            touch_story_game(game)
            db.commit()
            return "assistant_image_deleted"

        rollback_story_card_events_for_assistant_message(
            db=db,
            game=game,
            assistant_message_id=last_message.id,
            commit=False,
            purge_events=False,
            touch_game=False,
        )
        last_message.undone_at = _utcnow()
        touch_story_game(game)
        db.commit()
        return "assistant_message_deleted"

    if last_message.role == STORY_USER_ROLE:
        last_message.undone_at = _utcnow()
        touch_story_game(game)
        db.commit()
        return "user_message_deleted"

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported message role for rollback")


def redo_story_assistant_step(
    *,
    db: Session,
    game: StoryGame,
) -> str:
    latest_undone_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.undone_at.is_not(None),
        )
        .order_by(StoryMessage.undone_at.desc(), StoryMessage.id.desc())
    )
    latest_undone_image = db.scalar(
        select(StoryTurnImage)
        .where(
            StoryTurnImage.game_id == game.id,
            StoryTurnImage.undone_at.is_not(None),
        )
        .order_by(StoryTurnImage.undone_at.desc(), StoryTurnImage.id.desc())
    )

    if latest_undone_message is None and latest_undone_image is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to restore")

    restore_image_step = False
    if latest_undone_image is not None:
        if latest_undone_message is None:
            restore_image_step = True
        else:
            image_undone_at = latest_undone_image.undone_at
            message_undone_at = latest_undone_message.undone_at
            if image_undone_at is not None and message_undone_at is not None:
                if image_undone_at > message_undone_at:
                    restore_image_step = True
                elif image_undone_at == message_undone_at and latest_undone_image.id > latest_undone_message.id:
                    restore_image_step = True

    if restore_image_step and latest_undone_image is not None:
        latest_undone_image.undone_at = None
        touch_story_game(game)
        db.commit()
        return "assistant_image_restored"

    if latest_undone_message is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to restore")

    if latest_undone_message.role == STORY_ASSISTANT_ROLE:
        reapply_story_card_events_for_assistant_message(
            db=db,
            game=game,
            assistant_message_id=latest_undone_message.id,
            commit=False,
            touch_game=False,
        )
        latest_undone_message.undone_at = None
        touch_story_game(game)
        db.commit()
        return "assistant_message_restored"

    if latest_undone_message.role == STORY_USER_ROLE:
        latest_undone_message.undone_at = None
        touch_story_game(game)
        db.commit()
        return "user_message_restored"

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported message role for restore")
