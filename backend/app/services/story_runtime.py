from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryMessage, StoryPlotCardChangeEvent, StoryWorldCardChangeEvent
from app.schemas import StoryGenerateRequest

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StoryRuntimeDeps:
    validate_provider_config: Callable[[], None]
    get_current_user: Callable[[Session, str | None], Any]
    get_user_story_game_or_404: Callable[[Session, int, int], StoryGame]
    list_story_messages: Callable[[Session, int], list[StoryMessage]]
    normalize_generation_instructions: Callable[[list[Any]], list[dict[str, str]]]
    rollback_story_card_events_for_assistant_message: Callable[..., None]
    normalize_text: Callable[[str], str]
    derive_story_title: Callable[[str], str]
    touch_story_game: Callable[[StoryGame], None]
    list_story_plot_cards: Callable[[Session, int], list[Any]]
    list_story_world_cards: Callable[[Session, int], list[Any]]
    select_story_world_cards_for_prompt: Callable[[list[StoryMessage], list[Any]], list[dict[str, Any]]]
    normalize_context_limit_chars: Callable[[int | None], int]
    stream_story_provider_chunks: Callable[..., Any]
    normalize_generated_story_output: Callable[..., str]
    persist_generated_world_cards: Callable[..., list[Any]]
    upsert_story_plot_memory_card: Callable[..., tuple[bool, list[Any]]]
    world_card_event_to_out: Callable[[Any], Any]
    plot_card_event_to_out: Callable[[Any], Any]
    story_default_title: str
    story_user_role: str
    story_assistant_role: str
    stream_persist_min_chars: int
    stream_persist_max_interval_seconds: float


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _public_story_error_detail(exc: Exception) -> str:
    detail = str(exc).strip()
    if not detail:
        return "Text generation failed"
    return detail[:500]


def _stream_story_response(
    *,
    deps: StoryRuntimeDeps,
    db: Session,
    game: StoryGame,
    source_user_message: StoryMessage | None,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_chars: int,
):
    assistant_message: StoryMessage | None = None
    try:
        assistant_message = StoryMessage(
            game_id=game.id,
            role=deps.story_assistant_role,
            content="",
        )
        db.add(assistant_message)
        deps.touch_story_game(game)
        db.commit()
        db.refresh(assistant_message)
    except Exception as exc:
        logger.exception("Failed to initialize story generation stream")
        db.rollback()
        yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    yield _sse_event(
        "start",
        {
            "assistant_message_id": assistant_message.id,
            "user_message_id": source_user_message.id if source_user_message else None,
        },
    )

    produced = ""
    persisted_length = 0
    last_persisted_at = time.monotonic()
    aborted = False
    stream_error: str | None = None
    try:
        for chunk in deps.stream_story_provider_chunks(
            prompt=prompt,
            turn_index=turn_index,
            context_messages=context_messages,
            instruction_cards=instruction_cards,
            plot_cards=plot_cards,
            world_cards=world_cards,
            context_limit_chars=context_limit_chars,
        ):
            produced += chunk
            current_time = time.monotonic()
            if (
                len(produced) - persisted_length >= deps.stream_persist_min_chars
                or current_time - last_persisted_at >= deps.stream_persist_max_interval_seconds
            ):
                assistant_message.content = produced
                deps.touch_story_game(game)
                db.commit()
                persisted_length = len(produced)
                last_persisted_at = current_time
            yield _sse_event("chunk", {"assistant_message_id": assistant_message.id, "delta": chunk})
    except GeneratorExit:
        aborted = True
        raise
    except Exception as exc:
        stream_error = str(exc)
        logger.exception("Story generation failed")
        db.rollback()
        error_detail = _public_story_error_detail(exc)
        yield _sse_event("error", {"detail": error_detail})

    normalized_output = produced
    if produced.strip():
        try:
            normalized_output = deps.normalize_generated_story_output(
                text_value=produced,
                world_cards=world_cards,
            )
        except Exception:
            logger.exception("Failed to normalize generated story output")
            normalized_output = produced

    try:
        assistant_message.content = normalized_output
        deps.touch_story_game(game)
        db.commit()
        db.refresh(assistant_message)
    except Exception as exc:
        logger.exception("Failed to finalize generated story message")
        db.rollback()
        if not aborted:
            stream_error = stream_error or str(exc)
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    if not aborted and stream_error is None:
        persisted_world_card_events: list[Any] = []
        persisted_plot_card_events: list[Any] = []
        plot_card_created = False
        try:
            generated_events = deps.persist_generated_world_cards(
                db=db,
                game=game,
                assistant_message=assistant_message,
                prompt=prompt,
                assistant_text=assistant_message.content,
            )
            persisted_world_card_events = [
                deps.world_card_event_to_out(event) for event in generated_events if event.undone_at is None
            ]
        except Exception:
            logger.exception("Failed to persist generated world cards")
        try:
            plot_card_created, generated_plot_events = deps.upsert_story_plot_memory_card(db=db, game=game)
            persisted_plot_card_events = [
                deps.plot_card_event_to_out(event) for event in generated_plot_events if event.undone_at is None
            ]
        except Exception:
            logger.exception("Failed to update story plot memory card")
        yield _sse_event(
            "done",
            {
                "message": {
                    "id": assistant_message.id,
                    "game_id": assistant_message.game_id,
                    "role": assistant_message.role,
                    "content": assistant_message.content,
                    "created_at": assistant_message.created_at.isoformat(),
                    "updated_at": assistant_message.updated_at.isoformat(),
                },
                "world_card_events": [event.model_dump(mode="json") for event in persisted_world_card_events],
                "plot_card_events": [event.model_dump(mode="json") for event in persisted_plot_card_events],
                "plot_card_created": plot_card_created,
            },
        )


def generate_story_response(
    *,
    deps: StoryRuntimeDeps,
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StreamingResponse:
    deps.validate_provider_config()
    user = deps.get_current_user(db, authorization)
    game = deps.get_user_story_game_or_404(db, user.id, game_id)
    messages = deps.list_story_messages(db, game.id)
    instruction_cards = deps.normalize_generation_instructions(payload.instructions)
    source_user_message: StoryMessage | None = None

    if payload.reroll_last_response:
        if not messages:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to reroll")

        last_message = messages[-1]
        if last_message.role != deps.story_assistant_role:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Last message is not AI-generated")

        source_user_message = next(
            (message for message in reversed(messages[:-1]) if message.role == deps.story_user_role),
            None,
        )
        if source_user_message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for reroll")

        try:
            deps.rollback_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=last_message.id,
            )
            # Extra safety for legacy rows: ensure no event still references removed assistant message.
            db.execute(
                sa_delete(StoryWorldCardChangeEvent).where(
                    StoryWorldCardChangeEvent.game_id == game.id,
                    StoryWorldCardChangeEvent.assistant_message_id == last_message.id,
                )
            )
            db.execute(
                sa_delete(StoryPlotCardChangeEvent).where(
                    StoryPlotCardChangeEvent.game_id == game.id,
                    StoryPlotCardChangeEvent.assistant_message_id == last_message.id,
                )
            )
            db.delete(last_message)
            deps.touch_story_game(game)
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            logger.exception(
                "Failed to prepare reroll for game_id=%s assistant_message_id=%s",
                game.id,
                last_message.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to prepare reroll: {_public_story_error_detail(exc)}",
            ) from exc
        prompt_text = source_user_message.content
    else:
        if payload.prompt is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt is required")
        prompt_text = deps.normalize_text(payload.prompt)
        source_user_message = StoryMessage(
            game_id=game.id,
            role=deps.story_user_role,
            content=prompt_text,
        )
        db.add(source_user_message)
        if game.title == deps.story_default_title:
            game.title = deps.derive_story_title(prompt_text)
        deps.touch_story_game(game)
        db.commit()
        db.refresh(source_user_message)

    plot_cards = deps.list_story_plot_cards(db, game.id)
    world_cards = deps.list_story_world_cards(db, game.id)
    context_messages = deps.list_story_messages(db, game.id)
    active_world_cards = deps.select_story_world_cards_for_prompt(context_messages, world_cards)
    active_plot_cards = [
        {
            "title": card.title.replace("\r\n", " ").strip(),
            "content": card.content.replace("\r\n", "\n").strip(),
        }
        for card in plot_cards[:40]
        if card.title.strip() and card.content.strip()
    ]
    assistant_turn_index = (
        len([message for message in context_messages if message.role == deps.story_assistant_role]) + 1
    )
    stream = _stream_story_response(
        deps=deps,
        db=db,
        game=game,
        source_user_message=source_user_message,
        prompt=prompt_text,
        turn_index=assistant_turn_index,
        context_messages=context_messages,
        instruction_cards=instruction_cards,
        plot_cards=active_plot_cards,
        world_cards=active_world_cards,
        context_limit_chars=deps.normalize_context_limit_chars(game.context_limit_chars),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
