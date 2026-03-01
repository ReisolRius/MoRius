from __future__ import annotations

import json
import logging
import math
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryMessage, StoryPlotCardChangeEvent, StoryTurnImage, StoryWorldCardChangeEvent
from app.schemas import StoryGenerateRequest, UserOut
from app.services.story_games import (
    coerce_story_llm_model,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_top_k,
    normalize_story_top_r,
)

logger = logging.getLogger(__name__)
STORY_TOKEN_ESTIMATE_PATTERN = re.compile(r"[0-9a-zа-яё]+|[^\s]", re.IGNORECASE)


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
    select_story_world_cards_triggered_by_text: Callable[[str, list[Any]], list[dict[str, Any]]]
    normalize_context_limit_chars: Callable[[int | None], int]
    get_story_turn_cost_tokens: Callable[[int | None], int]
    spend_user_tokens_if_sufficient: Callable[[Session, int, int], bool]
    add_user_tokens: Callable[[Session, int, int], None]
    stream_story_provider_chunks: Callable[..., Any]
    normalize_generated_story_output: Callable[..., str]
    persist_generated_world_cards: Callable[..., list[Any]]
    upsert_story_plot_memory_card: Callable[..., tuple[bool, list[Any]]]
    plot_card_to_out: Callable[[Any], Any]
    world_card_to_out: Callable[[Any], Any]
    world_card_event_to_out: Callable[[Any], Any]
    plot_card_event_to_out: Callable[[Any], Any]
    story_default_title: str
    story_user_role: str
    story_assistant_role: str
    stream_persist_min_chars: int
    stream_persist_max_interval_seconds: float


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _safe_dump_stream_events(events: list[Any]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for event in events:
        if hasattr(event, "model_dump"):
            try:
                dumped = event.model_dump(mode="json")
            except Exception:
                continue
            if isinstance(dumped, dict):
                serialized.append(dumped)
            continue
        if isinstance(event, dict):
            serialized.append(event)
    return serialized


def _safe_dump_stream_items(items: list[Any]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for item in items:
        if hasattr(item, "model_dump"):
            try:
                dumped = item.model_dump(mode="json")
            except Exception:
                continue
            if isinstance(dumped, dict):
                serialized.append(dumped)
            continue
        if isinstance(item, dict):
            serialized.append(item)
    return serialized


def _public_story_error_detail(exc: Exception) -> str:
    detail = str(exc).strip()
    if not detail:
        return "Text generation failed"
    return detail[:500]


def _estimate_story_tokens(value: str) -> int:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return 0
    matches = STORY_TOKEN_ESTIMATE_PATTERN.findall(normalized.lower().replace("ё", "е"))
    if matches:
        return len(matches)
    return max(1, math.ceil(len(normalized) / 4))


def _estimate_story_context_usage_tokens(
    *,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    memory_optimization_enabled: bool,
) -> int:
    instruction_payload = "\n".join(
        f"{index}. {card['title']}: {card['content']}"
        for index, card in enumerate(instruction_cards, start=1)
        if card.get("title", "").strip() and card.get("content", "").strip()
    )
    instruction_tokens_used = _estimate_story_tokens(instruction_payload)

    plot_payload = "\n".join(
        f"{index}. {card['title']}: {card['content']}"
        for index, card in enumerate(plot_cards, start=1)
        if card.get("title", "").strip() and card.get("content", "").strip()
    )
    plot_tokens_used = _estimate_story_tokens(plot_payload)

    history_lines: list[str] = []
    for message in context_messages:
        if message.role not in {"user", "assistant"}:
            continue
        normalized_content = message.content.replace("\r\n", "\n").strip()
        if not normalized_content:
            continue
        speaker_label = "Игрок" if message.role == "user" else "ИИ"
        history_lines.append(f"{speaker_label}: {normalized_content}")
    history_payload = "\n".join(history_lines)
    history_tokens_used = _estimate_story_tokens(history_payload)

    world_lines: list[str] = []
    for index, card in enumerate(world_cards, start=1):
        title = str(card.get("title", "")).replace("\r\n", " ").strip()
        content = str(card.get("content", "")).replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        raw_triggers = card.get("triggers", [])
        normalized_triggers = [str(trigger).replace("\r\n", " ").strip() for trigger in raw_triggers if str(trigger).strip()]
        world_lines.append(f"{index}. {title}: {content}")
        world_lines.append(f"Триггеры: {', '.join(normalized_triggers) if normalized_triggers else 'нет'}")
    world_tokens_used = _estimate_story_tokens("\n".join(world_lines))

    latest_user_tokens_used = 0
    for message in reversed(context_messages):
        if message.role != "user":
            continue
        normalized_content = message.content.replace("\r\n", "\n").strip()
        if not normalized_content:
            continue
        latest_user_tokens_used = _estimate_story_tokens(normalized_content) + 4
        break

    story_memory_tokens_used = (
        plot_tokens_used + latest_user_tokens_used
        if memory_optimization_enabled
        else history_tokens_used
    )
    return max(instruction_tokens_used + story_memory_tokens_used + world_tokens_used, 0)


def _merge_story_active_world_cards(
    primary_cards: list[dict[str, Any]],
    fallback_cards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for card in [*primary_cards, *fallback_cards]:
        if not isinstance(card, dict):
            continue
        card_id = card.get("id")
        if isinstance(card_id, int):
            dedupe_key = f"id:{card_id}"
        else:
            try:
                dedupe_key = f"json:{json.dumps(card, sort_keys=True, ensure_ascii=False)}"
            except (TypeError, ValueError):
                dedupe_key = f"obj:{id(card)}"
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        merged.append(card)

    return merged


def _stream_story_response(
    *,
    deps: StoryRuntimeDeps,
    db: Session,
    game: StoryGame,
    user: Any,
    turn_cost_tokens: int,
    source_user_message: StoryMessage | None,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    all_world_cards: list[Any],
    context_limit_chars: int,
    story_model_name: str | None,
    story_response_max_tokens: int | None,
    story_top_k: int,
    story_top_r: float,
    memory_optimization_enabled: bool,
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
            story_model_name=story_model_name,
            story_response_max_tokens=story_response_max_tokens,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
            use_plot_memory=memory_optimization_enabled,
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
        # Client disconnected or canceled stream: finalize what is already produced
        # so we don't persist a broken tail from interim chunk checkpoints.
        aborted = True
        stream_error = stream_error or "stream cancelled by client"
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

    response_has_content = bool(normalized_output.strip() or produced.strip())
    if turn_cost_tokens > 0 and not response_has_content and not aborted:
        try:
            deps.add_user_tokens(
                db,
                int(user.id),
                turn_cost_tokens,
            )
            db.commit()
            db.refresh(user)
        except Exception:
            logger.exception(
                "Failed to refund story turn tokens: game_id=%s user_id=%s tokens=%s",
                game.id,
                user.id,
                turn_cost_tokens,
            )
            db.rollback()

    assistant_text_for_postprocess = assistant_message.content.strip()
    if not assistant_text_for_postprocess:
        assistant_text_for_postprocess = normalized_output.strip()
    if not assistant_text_for_postprocess:
        assistant_text_for_postprocess = produced.strip()

    assistant_triggered_world_cards: list[dict[str, Any]] = []
    if not aborted and response_has_content:
        try:
            assistant_triggered_world_cards = deps.select_story_world_cards_triggered_by_text(
                assistant_text_for_postprocess,
                all_world_cards,
            )
        except Exception:
            logger.exception(
                "Failed to run assistant trigger check: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

    if response_has_content:
        logger.info(
            "Story post-process dispatch (inline): game_id=%s assistant_message_id=%s memory_optimization_enabled=%s",
            game.id,
            assistant_message.id,
            memory_optimization_enabled,
        )
        world_card_events_out: list[Any] = []
        plot_card_events_out: list[Any] = []
        plot_card_created = False
        postprocess_pending = False

        if memory_optimization_enabled:
            try:
                plot_card_created, generated_plot_events = deps.upsert_story_plot_memory_card(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt_override=prompt,
                    latest_assistant_text_override=assistant_text_for_postprocess,
                )
                plot_card_events_out = [
                    deps.plot_card_event_to_out(event) for event in generated_plot_events if event.undone_at is None
                ]
                plot_memory_payload = {
                    "assistant_message_id": assistant_message.id,
                    "plot_card_events": _safe_dump_stream_events(plot_card_events_out),
                    "plot_cards": _safe_dump_stream_items(
                        [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
                    ),
                    "plot_card_created": plot_card_created,
                }
                yield _sse_event("plot_memory", plot_memory_payload)
            except Exception as exc:
                logger.exception("Failed to update story plot memory card")
                db.rollback()
                yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
                return

        try:
            generated_events = deps.persist_generated_world_cards(
                db=db,
                game=game,
                assistant_message=assistant_message,
                prompt=prompt,
                assistant_text=assistant_text_for_postprocess,
                memory_optimization_enabled=memory_optimization_enabled,
            )
            world_card_events_out.extend(
                deps.world_card_event_to_out(event) for event in generated_events if event.undone_at is None
            )
        except Exception:
            logger.exception("Failed to persist generated world cards")
            db.rollback()

        done_payload = {
            "message": {
                "id": assistant_message.id,
                "game_id": assistant_message.game_id,
                "role": assistant_message.role,
                "content": assistant_message.content,
                "created_at": assistant_message.created_at.isoformat(),
                "updated_at": assistant_message.updated_at.isoformat(),
            },
            "user": UserOut.model_validate(user).model_dump(mode="json"),
            "turn_cost_tokens": turn_cost_tokens,
            "world_card_events": _safe_dump_stream_events(world_card_events_out),
            "plot_card_events": _safe_dump_stream_events(plot_card_events_out),
            "plot_cards": _safe_dump_stream_items(
                [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
            ),
            "world_cards": _safe_dump_stream_items(
                [deps.world_card_to_out(card) for card in deps.list_story_world_cards(db, game.id)]
            ),
            "plot_card_created": plot_card_created,
            "postprocess_pending": postprocess_pending,
            "assistant_triggered_world_card_ids": [
                int(card.get("id"))
                for card in assistant_triggered_world_cards
                if isinstance(card, dict) and isinstance(card.get("id"), int)
            ],
        }
        try:
            yield _sse_event("done", done_payload)
        except Exception as exc:
            logger.exception("Failed to emit stream done event")
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    done_payload = {
        "message": {
            "id": assistant_message.id,
            "game_id": assistant_message.game_id,
            "role": assistant_message.role,
            "content": assistant_message.content,
            "created_at": assistant_message.created_at.isoformat(),
            "updated_at": assistant_message.updated_at.isoformat(),
        },
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "turn_cost_tokens": turn_cost_tokens,
        "plot_cards": _safe_dump_stream_items(
            [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
        ),
        "world_cards": _safe_dump_stream_items(
            [deps.world_card_to_out(card) for card in deps.list_story_world_cards(db, game.id)]
        ),
        "world_card_events": [],
        "plot_card_events": [],
        "plot_card_created": False,
        "postprocess_pending": False,
        "assistant_triggered_world_card_ids": [
            int(card.get("id"))
            for card in assistant_triggered_world_cards
            if isinstance(card, dict) and isinstance(card.get("id"), int)
        ],
    }
    try:
        yield _sse_event("done", done_payload)
    except Exception as exc:
        logger.exception("Failed to emit stream done event")
        yield _sse_event("error", {"detail": _public_story_error_detail(exc)})


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
    story_model_name = coerce_story_llm_model(getattr(game, "story_llm_model", None))
    if payload.story_llm_model is not None:
        story_model_name = coerce_story_llm_model(payload.story_llm_model)
    raw_memory_optimization_enabled = getattr(game, "memory_optimization_enabled", None)
    memory_optimization_enabled = True if raw_memory_optimization_enabled is None else bool(raw_memory_optimization_enabled)
    if payload.memory_optimization_enabled is not None:
        memory_optimization_enabled = bool(payload.memory_optimization_enabled)
    logger.info(
        "Story generate settings: game_id=%s memory_optimization_enabled=%s payload_override=%s game_value=%s",
        game.id,
        memory_optimization_enabled,
        payload.memory_optimization_enabled,
        raw_memory_optimization_enabled,
    )
    story_top_k = normalize_story_top_k(getattr(game, "story_top_k", None))
    if payload.story_top_k is not None:
        story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(getattr(game, "story_top_r", None))
    if payload.story_top_r is not None:
        story_top_r = normalize_story_top_r(payload.story_top_r)
    story_response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(
        getattr(game, "response_max_tokens_enabled", None)
    )
    story_response_max_tokens = normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None))
    if payload.response_max_tokens is not None:
        story_response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
        story_response_max_tokens_enabled = True
    if not story_response_max_tokens_enabled:
        story_response_max_tokens = None
    context_limit_chars = deps.normalize_context_limit_chars(game.context_limit_chars)
    turn_cost_tokens = 0
    messages = deps.list_story_messages(db, game.id)
    discard_last_assistant_steps = max(int(payload.discard_last_assistant_steps or 0), 0)
    instruction_cards = deps.normalize_generation_instructions(payload.instructions)
    source_user_message: StoryMessage | None = None

    def _calculate_turn_cost_tokens(context_messages_for_cost: list[StoryMessage]) -> int:
        plot_cards_for_cost = deps.list_story_plot_cards(db, game.id)
        world_cards_for_cost = deps.list_story_world_cards(db, game.id)
        active_world_cards_for_cost = deps.select_story_world_cards_for_prompt(
            context_messages_for_cost,
            world_cards_for_cost,
        )
        active_plot_cards_for_cost = (
            [
                {
                    "title": card.title.replace("\r\n", " ").strip(),
                    "content": card.content.replace("\r\n", "\n").strip(),
                }
                for card in plot_cards_for_cost
                if card.title.strip() and card.content.strip()
            ]
            if memory_optimization_enabled
            else []
        )
        context_usage_tokens = _estimate_story_context_usage_tokens(
            context_messages=context_messages_for_cost,
            instruction_cards=instruction_cards,
            plot_cards=active_plot_cards_for_cost,
            world_cards=active_world_cards_for_cost,
            memory_optimization_enabled=memory_optimization_enabled,
        )
        return max(int(deps.get_story_turn_cost_tokens(context_usage_tokens)), 0)

    def _drop_last_assistant_steps(
        *,
        steps: int,
        delete_source_user: bool,
        action_label: str,
    ) -> list[StoryMessage]:
        if steps <= 0:
            return deps.list_story_messages(db, game.id)

        for _ in range(steps):
            current_messages = deps.list_story_messages(db, game.id)
            if not current_messages:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to rollback")

            last_message = current_messages[-1]
            if last_message.role != deps.story_assistant_role:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Last message is not AI-generated")

            source_user_message_for_step = next(
                (message for message in reversed(current_messages[:-1]) if message.role == deps.story_user_role),
                None,
            )
            if source_user_message_for_step is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for rollback")

            try:
                deps.rollback_story_card_events_for_assistant_message(
                    db=db,
                    game=game,
                    assistant_message_id=last_message.id,
                    commit=False,
                )
                # Extra safety for legacy rows: ensure no event still references removed assistant message.
                db.execute(
                    sa_delete(StoryWorldCardChangeEvent).where(
                        StoryWorldCardChangeEvent.assistant_message_id == last_message.id,
                    )
                )
                db.execute(
                    sa_delete(StoryPlotCardChangeEvent).where(
                        StoryPlotCardChangeEvent.assistant_message_id == last_message.id,
                    )
                )
                db.execute(
                    sa_delete(StoryTurnImage).where(
                        StoryTurnImage.assistant_message_id == last_message.id,
                    )
                )
                db.delete(last_message)
                if delete_source_user:
                    db.delete(source_user_message_for_step)
                deps.touch_story_game(game)
                db.commit()
            except HTTPException:
                db.rollback()
                raise
            except Exception as exc:
                db.rollback()
                logger.exception(
                    "Failed to prepare %s for game_id=%s assistant_message_id=%s",
                    action_label,
                    game.id,
                    last_message.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to prepare {action_label}: {_public_story_error_detail(exc)}",
                ) from exc

        return deps.list_story_messages(db, game.id)

    def _purge_undone_story_steps(*, action_label: str) -> None:
        try:
            undone_message_ids = db.scalars(
                select(StoryMessage.id).where(
                    StoryMessage.game_id == game.id,
                    StoryMessage.undone_at.is_not(None),
                )
            ).all()

            if undone_message_ids:
                db.execute(
                    sa_delete(StoryTurnImage).where(
                        StoryTurnImage.assistant_message_id.in_(undone_message_ids),
                    )
                )
                db.execute(
                    sa_delete(StoryWorldCardChangeEvent).where(
                        StoryWorldCardChangeEvent.assistant_message_id.in_(undone_message_ids),
                    )
                )
                db.execute(
                    sa_delete(StoryPlotCardChangeEvent).where(
                        StoryPlotCardChangeEvent.assistant_message_id.in_(undone_message_ids),
                    )
                )
            db.execute(
                sa_delete(StoryTurnImage).where(
                    StoryTurnImage.game_id == game.id,
                    StoryTurnImage.undone_at.is_not(None),
                )
            )
            db.execute(
                sa_delete(StoryWorldCardChangeEvent).where(
                    StoryWorldCardChangeEvent.game_id == game.id,
                    StoryWorldCardChangeEvent.undone_at.is_not(None),
                )
            )
            db.execute(
                sa_delete(StoryPlotCardChangeEvent).where(
                    StoryPlotCardChangeEvent.game_id == game.id,
                    StoryPlotCardChangeEvent.undone_at.is_not(None),
                )
            )
            db.execute(
                sa_delete(StoryMessage).where(
                    StoryMessage.game_id == game.id,
                    StoryMessage.undone_at.is_not(None),
                )
            )
            deps.touch_story_game(game)
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception(
                "Failed to purge undone story steps for %s: game_id=%s",
                action_label,
                game.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to purge undone steps for {action_label}: {_public_story_error_detail(exc)}",
            ) from exc

    if payload.reroll_last_response:
        if discard_last_assistant_steps > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="discard_last_assistant_steps cannot be used with reroll_last_response",
            )

        messages = deps.list_story_messages(db, game.id)
        source_user_message = next((message for message in reversed(messages) if message.role == deps.story_user_role), None)
        if source_user_message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for reroll")

        last_message = messages[-1] if messages else None
        if last_message is not None and last_message.role == deps.story_assistant_role:
            messages = _drop_last_assistant_steps(
                steps=1,
                delete_source_user=False,
                action_label="reroll",
            )

        _purge_undone_story_steps(action_label="reroll")
        messages = deps.list_story_messages(db, game.id)
        source_user_message = next((message for message in reversed(messages) if message.role == deps.story_user_role), None)
        if source_user_message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for reroll")

        prompt_text = source_user_message.content
        turn_cost_tokens = _calculate_turn_cost_tokens(messages)
        if not deps.spend_user_tokens_if_sufficient(db, int(user.id), turn_cost_tokens):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Недостаточно солов для хода",
            )
        db.commit()
        db.refresh(user)
    else:
        if discard_last_assistant_steps > 0:
            messages = _drop_last_assistant_steps(
                steps=discard_last_assistant_steps,
                delete_source_user=True,
                action_label="rollback",
            )
        if payload.prompt is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt is required")
        prompt_text = deps.normalize_text(payload.prompt)
        turn_cost_tokens = _calculate_turn_cost_tokens(messages)
        if not deps.spend_user_tokens_if_sufficient(db, int(user.id), turn_cost_tokens):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Недостаточно солов для хода",
            )
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
        db.refresh(user)

    plot_cards = deps.list_story_plot_cards(db, game.id)
    world_cards = deps.list_story_world_cards(db, game.id)
    context_messages = deps.list_story_messages(db, game.id)
    active_world_cards = deps.select_story_world_cards_for_prompt(context_messages, world_cards)
    early_triggered_world_cards: list[dict[str, Any]] = []
    if source_user_message is not None and source_user_message.content.strip():
        early_triggered_world_cards = deps.select_story_world_cards_triggered_by_text(
            source_user_message.content,
            world_cards,
        )
    active_world_cards = _merge_story_active_world_cards(
        early_triggered_world_cards,
        active_world_cards,
    )
    active_plot_cards = [
        {
            "title": card.title.replace("\r\n", " ").strip(),
            "content": card.content.replace("\r\n", "\n").strip(),
        }
        for card in plot_cards
        if card.title.strip() and card.content.strip()
    ] if memory_optimization_enabled else []
    assistant_turn_index = (
        len([message for message in context_messages if message.role == deps.story_assistant_role]) + 1
    )
    stream = _stream_story_response(
        deps=deps,
        db=db,
        game=game,
        user=user,
        turn_cost_tokens=turn_cost_tokens,
        source_user_message=source_user_message,
        prompt=prompt_text,
        turn_index=assistant_turn_index,
        context_messages=context_messages,
        instruction_cards=instruction_cards,
        plot_cards=active_plot_cards,
        world_cards=active_world_cards,
        all_world_cards=world_cards,
        context_limit_chars=context_limit_chars,
        story_model_name=story_model_name,
        story_response_max_tokens=story_response_max_tokens,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        memory_optimization_enabled=memory_optimization_enabled,
    )

    def _safe_stream():
        try:
            yield from stream
        except GeneratorExit:
            raise
        except BaseException as exc:
            logger.exception("Unhandled story stream failure")
            detail_source = exc if isinstance(exc, Exception) else RuntimeError(str(exc))
            try:
                yield _sse_event("error", {"detail": _public_story_error_detail(detail_source)})
            except Exception:
                return

    return StreamingResponse(
        _safe_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
