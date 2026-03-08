from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryGame, StoryMemoryBlock, StoryMessage
from app.schemas import StoryMessageOut, StoryMessageUpdateRequest
from app.services.auth_identity import get_current_user
from app.services.story_memory import STORY_MEMORY_LAYER_RAW, normalize_story_memory_layer
from app.services.story_messages import story_message_to_out
from app.services.story_queries import get_user_story_game_or_404, list_story_messages, list_story_world_cards, touch_story_game
from app.services.story_text import normalize_story_text

router = APIRouter()


def _normalize_assistant_text_for_memory(*, monolith_main, content: str) -> str:
    normalized = monolith_main._strip_story_markup_for_memory_text(content).replace("\r\n", "\n").strip()
    if normalized:
        return normalized
    normalized = monolith_main._normalize_story_markup_to_plain_text(content).replace("\r\n", "\n").strip()
    if normalized:
        return normalized
    return content.replace("\r\n", "\n").strip()


def _sync_latest_raw_memory_blocks(*, db: Session, game: StoryGame) -> None:
    # Lazy import avoids module initialization cycle while runtime helpers still live in main.py.
    from app import main as monolith_main

    latest_assistant_message_ids = monolith_main._list_story_latest_assistant_message_ids(
        db,
        game.id,
        limit=monolith_main.STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS,
    )
    if not latest_assistant_message_ids:
        return

    for assistant_message_id in latest_assistant_message_ids:
        assistant_message = db.scalar(
            select(StoryMessage).where(
                StoryMessage.id == assistant_message_id,
                StoryMessage.game_id == game.id,
                StoryMessage.role == "assistant",
                StoryMessage.undone_at.is_(None),
            )
        )
        if assistant_message is None:
            continue

        source_user_message = db.scalar(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == game.id,
                StoryMessage.role == "user",
                StoryMessage.id < assistant_message.id,
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
            content=assistant_message.content,
        )
        raw_block_content = monolith_main._build_story_raw_memory_block_content(
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            preserve_assistant_text=True,
        )

        raw_blocks = db.scalars(
            select(StoryMemoryBlock).where(
                StoryMemoryBlock.game_id == game.id,
                StoryMemoryBlock.assistant_message_id == assistant_message.id,
                StoryMemoryBlock.undone_at.is_(None),
            )
        ).all()

        if not raw_block_content:
            for block in raw_blocks:
                if normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW:
                    db.delete(block)
            continue

        normalized_title = monolith_main._build_story_memory_block_title(
            raw_block_content,
            fallback_prefix="Fresh memory",
        )
        normalized_content = monolith_main._normalize_story_memory_block_content(raw_block_content)
        updated_existing_block = False
        for block in raw_blocks:
            if normalize_story_memory_layer(block.layer) != STORY_MEMORY_LAYER_RAW:
                continue
            block.title = normalized_title
            block.content = normalized_content
            block.token_count = max(monolith_main._estimate_story_tokens(normalized_content), 1)
            updated_existing_block = True

        if not updated_existing_block:
            monolith_main._create_story_memory_block(
                db=db,
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                layer=STORY_MEMORY_LAYER_RAW,
                title=normalized_title,
                content=raw_block_content,
                preserve_content=True,
            )

    monolith_main._rebalance_story_memory_layers(db=db, game=game)


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
    message.content = normalize_story_text(payload.content)
    if message.role == "assistant":
        message.scene_emotion_payload = ""

    _sync_latest_raw_memory_blocks(db=db, game=game)

    touch_story_game(game)
    db.commit()
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
