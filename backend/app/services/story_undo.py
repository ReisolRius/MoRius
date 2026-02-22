from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select, update as sa_update
from sqlalchemy.orm import Session

from app.models import (
    StoryGame,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)
from app.services.media import normalize_avatar_value
from app.services.story_cards import (
    normalize_story_plot_card_content,
    normalize_story_plot_card_source,
    normalize_story_plot_card_title,
)
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_url,
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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    raw_avatar = snapshot.get("avatar_url")
    avatar_url = normalize_avatar_value(raw_avatar) if isinstance(raw_avatar, str) else None
    if avatar_url is not None and avatar_url.startswith("data:image/"):
        avatar_url = normalize_story_character_avatar_url(avatar_url)
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
            triggers=serialize_story_world_card_triggers(triggers),
            kind=kind,
            avatar_url=avatar_url,
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
    world_card.triggers = serialize_story_world_card_triggers(triggers)
    world_card.kind = kind
    world_card.avatar_url = avatar_url
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

    source = normalize_story_plot_card_source(str(snapshot.get("source", "")))

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
            source=source,
        )
        db.add(plot_card)
        db.flush()
        return plot_card

    plot_card.title = normalize_story_plot_card_title(title)
    plot_card.content = normalize_story_plot_card_content(content)
    plot_card.source = source
    db.flush()
    return plot_card


def undo_story_plot_card_change_event(
    db: Session,
    game: StoryGame,
    event: StoryPlotCardChangeEvent,
    *,
    commit: bool = True,
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
) -> None:
    world_events = list_story_world_card_events(
        db,
        game.id,
        assistant_message_id=assistant_message_id,
        include_undone=False,
    )
    for event in reversed(world_events):
        undo_story_world_card_change_event(db, game, event, commit=False)

    plot_events = list_story_plot_card_events(
        db,
        game.id,
        assistant_message_id=assistant_message_id,
        include_undone=False,
    )
    for event in reversed(plot_events):
        undo_story_plot_card_change_event(db, game, event, commit=False)

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

    touch_story_game(game)
    db.commit()
