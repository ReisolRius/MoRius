from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMessage
from app.schemas import StoryMessageOut, StoryMessageUpdateRequest
from app.services.auth_identity import get_current_user
from app.services.story_messages import story_message_to_out
from app.services.story_queries import get_user_story_game_or_404, list_story_messages, list_story_world_cards, touch_story_game
from app.services.story_text import normalize_story_text

router = APIRouter()
logger = logging.getLogger(__name__)


def _normalize_assistant_text_for_memory(*, monolith_main, content: str | None) -> str:
    safe_content = str(content or "")
    normalized = monolith_main._strip_story_markup_for_memory_text(safe_content).replace("\r\n", "\n").strip()
    if normalized:
        return normalized
    normalized = monolith_main._normalize_story_markup_to_plain_text(safe_content).replace("\r\n", "\n").strip()
    if normalized:
        return normalized
    return safe_content.replace("\r\n", "\n").strip()


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
    next_content = str(payload.content or "").replace("\r\n", "\n").strip()
    logger.info(
        "Story message update requested: game_id=%s message_id=%s role=%s content_len=%s",
        game.id,
        message.id,
        message.role,
        len(next_content),
    )
    if next_content:
        message.content = normalize_story_text(next_content)
    elif message.role == "assistant":
        message.content = ""
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story text cannot be empty")
    if message.role == "assistant":
        message.scene_emotion_payload = ""

    touch_story_game(game)
    try:
        db.commit()
    except Exception:
        logger.exception(
            "Story message update commit failed: game_id=%s message_id=%s",
            game.id,
            message.id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update story message",
        )
    db.refresh(message)
    return story_message_to_out(message)


@router.post("/api/story/games/{game_id}/messages/{message_id}/scene-emotion/refresh", response_model=StoryMessageOut)
def refresh_story_message_scene_emotion(
    game_id: int,
    message_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMessageOut:
    user = get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

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
    if message.role != "assistant":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Scene emotion analysis is available for assistant messages only")

    from app import main as monolith_main

    source_user_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == "user",
            StoryMessage.id < message.id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    latest_user_prompt = (
        source_user_message.content.replace("\r\n", "\n").strip()
        if isinstance(source_user_message, StoryMessage)
        else ""
    )
    latest_assistant_text = _normalize_assistant_text_for_memory(
        monolith_main=monolith_main,
        content=message.content,
    )
    prompt_world_cards = monolith_main._select_story_world_cards_for_prompt(
        list_story_messages(db, game.id),
        list_story_world_cards(db, game.id),
    )
    message.scene_emotion_payload = (
        monolith_main._request_story_scene_emotion_payload(
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            world_cards=prompt_world_cards,
        )
        or ""
    )
    touch_story_game(game)
    db.commit()
    db.refresh(message)
    return story_message_to_out(message)
