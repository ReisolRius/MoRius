from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMessage
from app.schemas import StoryMessageOut, StoryMessageUpdateRequest
from app.services.auth_identity import get_current_user
from app.services.story_queries import get_user_story_game_or_404, touch_story_game
from app.services.story_text import normalize_story_text

STORY_ASSISTANT_ROLE = "assistant"

router = APIRouter()


@router.patch("/api/story/games/{game_id}/messages/{message_id}", response_model=StoryMessageOut)
def update_story_message(
    game_id: int,
    message_id: int,
    payload: StoryMessageUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMessageOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    message = db.scalar(
        select(StoryMessage).where(
            StoryMessage.id == message_id,
            StoryMessage.game_id == game.id,
            StoryMessage.undone_at.is_(None),
        )
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role != STORY_ASSISTANT_ROLE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only AI messages can be edited")

    message.content = normalize_story_text(payload.content)
    touch_story_game(game)
    db.commit()
    db.refresh(message)
    return StoryMessageOut.model_validate(message)
