from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard
from app.services.story_novel import is_story_visual_novel_game, persist_story_novel_beats_for_message


@dataclass(frozen=True)
class StoryNovelOpeningBootstrapResult:
    changed: bool
    message_id: int | None
    beat_count: int


def _normalize_opening_scene_text(value: object) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def ensure_story_novel_opening_scene_beats(
    *,
    db: Session,
    game: StoryGame,
    world_cards: list[StoryWorldCard] | None = None,
) -> StoryNovelOpeningBootstrapResult:
    """Make the VN opening scene a real assistant turn with persisted UI beats.

    World creation stores ``opening_scene`` on the game before the first generation.  RPG
    renders that field as a standalone intro, but the Visual Novel stage is driven only by
    ``StoryNovelBeat`` rows.  This small, idempotent bootstrap bridges those two data shapes.

    Existing played histories are never rewritten.  The only legacy message we may update is
    a single assistant-only bootstrap message before the player has submitted any turn.
    Transaction ownership stays with the caller so this can participate in create/update/read
    recovery flows without an internal commit.
    """
    if not is_story_visual_novel_game(game):
        return StoryNovelOpeningBootstrapResult(changed=False, message_id=None, beat_count=0)

    opening_scene = _normalize_opening_scene_text(getattr(game, "opening_scene", None))
    if not opening_scene:
        return StoryNovelOpeningBootstrapResult(changed=False, message_id=None, beat_count=0)

    # The opening can only be the first assistant message.  Two rows are sufficient to
    # distinguish an untouched assistant-only bootstrap from any started history, without
    # loading an arbitrarily long campaign on every VN read.
    active_messages = list(
        db.scalars(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == int(game.id),
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.asc())
            .limit(2)
        ).all()
    )
    opening_message = next(
        (
            message
            for message in active_messages
            if str(getattr(message, "role", "") or "").strip().lower() == "assistant"
            and _normalize_opening_scene_text(getattr(message, "content", None)) == opening_scene
        ),
        None,
    )
    changed = False

    if opening_message is None:
        can_reuse_unplayed_bootstrap = (
            len(active_messages) == 1
            and str(getattr(active_messages[0], "role", "") or "").strip().lower() == "assistant"
        )
        if active_messages and not can_reuse_unplayed_bootstrap:
            return StoryNovelOpeningBootstrapResult(changed=False, message_id=None, beat_count=0)
        if can_reuse_unplayed_bootstrap:
            opening_message = active_messages[0]
            opening_message.content = opening_scene
        else:
            opening_message = StoryMessage(
                game_id=int(game.id),
                role="assistant",
                content=opening_scene,
            )
            db.add(opening_message)
        db.flush()
        changed = True

    existing_beats = list(
        db.scalars(
            select(StoryNovelBeat)
            .where(StoryNovelBeat.message_id == int(opening_message.id))
            .order_by(StoryNovelBeat.order_index.asc())
        ).all()
    )
    if existing_beats and not changed:
        return StoryNovelOpeningBootstrapResult(
            changed=False,
            message_id=int(opening_message.id),
            beat_count=len(existing_beats),
        )

    resolved_world_cards = world_cards
    if resolved_world_cards is None:
        resolved_world_cards = list(
            db.scalars(
                select(StoryWorldCard)
                .where(StoryWorldCard.game_id == int(game.id))
                .order_by(StoryWorldCard.id.asc())
            ).all()
        )
    beats = persist_story_novel_beats_for_message(
        db=db,
        game=game,
        assistant_message=opening_message,
        raw_response=opening_scene,
        world_cards=resolved_world_cards,
    )
    return StoryNovelOpeningBootstrapResult(
        changed=True,
        message_id=int(opening_message.id),
        beat_count=len(beats),
    )
