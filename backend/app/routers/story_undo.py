from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryPlotCardChangeEvent, StoryWorldCardChangeEvent
from app.schemas import MessageResponse
from app.services.auth_identity import get_current_user
from app.services.story_queries import get_user_story_game_or_404
from app.services.story_undo import (
    redo_story_assistant_step,
    undo_story_assistant_step,
    undo_story_plot_card_change_event,
    undo_story_world_card_change_event,
)

router = APIRouter()


@router.post("/api/story/games/{game_id}/assistant-step/undo", response_model=MessageResponse)
def undo_story_assistant_step_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    action = undo_story_assistant_step(db=db, game=game)

    if action == "assistant_image_deleted":
        message = "Assistant image reverted"
    elif action == "assistant_message_deleted":
        message = "Assistant response reverted"
    elif action == "user_message_deleted":
        message = "User message reverted"
    else:
        message = "Rollback step applied"
    return MessageResponse(message=message)


@router.post("/api/story/games/{game_id}/assistant-step/redo", response_model=MessageResponse)
def redo_story_assistant_step_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    action = redo_story_assistant_step(db=db, game=game)

    if action == "assistant_image_restored":
        message = "Assistant image restored"
    elif action == "assistant_message_restored":
        message = "Assistant response restored"
    elif action == "user_message_restored":
        message = "User message restored"
    else:
        message = "Restore step applied"
    return MessageResponse(message=message)


@router.post("/api/story/games/{game_id}/world-card-events/{event_id}/undo", response_model=MessageResponse)
def undo_story_world_card_event_route(
    game_id: int,
    event_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    event = db.scalar(
        select(StoryWorldCardChangeEvent).where(
            StoryWorldCardChangeEvent.id == event_id,
            StoryWorldCardChangeEvent.game_id == game.id,
        )
    )
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card event not found")

    undo_story_world_card_change_event(db, game, event)
    return MessageResponse(message="World card change reverted")


@router.post("/api/story/games/{game_id}/plot-card-events/{event_id}/undo", response_model=MessageResponse)
def undo_story_plot_card_event_route(
    game_id: int,
    event_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    event = db.scalar(
        select(StoryPlotCardChangeEvent).where(
            StoryPlotCardChangeEvent.id == event_id,
            StoryPlotCardChangeEvent.game_id == game.id,
        )
    )
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plot card event not found")

    undo_story_plot_card_change_event(db, game, event)
    return MessageResponse(message="Plot card change reverted")
