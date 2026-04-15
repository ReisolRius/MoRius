from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    StoryCharacterStateSnapshot,
    StoryGame,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCardChangeEvent,
)
from app.schemas import StoryGenerateRequest, StoryInstructionCardInput, UserOut
from app.services.story_games import (
    coerce_story_llm_model,
    normalize_story_repetition_penalty,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
)
from app.services.story_memory import resolve_story_current_location_label

logger = logging.getLogger(__name__)
STORY_MEMORY_SOURCE_EN_MODEL_IDS: set[str] = set()


def _is_sqlite_database_url(database_url: str | None) -> bool:
    return str(database_url or "").strip().startswith("sqlite")
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
    get_story_turn_cost_tokens: Callable[[int | None, str | None], int]
    spend_user_tokens_if_sufficient: Callable[[Session, int, int], bool]
    add_user_tokens: Callable[[Session, int, int], None]
    stream_story_provider_chunks: Callable[..., Any]
    normalize_generated_story_output: Callable[..., str]
    persist_generated_world_cards: Callable[..., list[Any]]
    upsert_story_plot_memory_card: Callable[..., tuple[bool, list[Any]]]
    list_story_prompt_memory_cards: Callable[[Session, StoryGame, bool, list[StoryMessage] | None], list[dict[str, str]]]
    list_story_memory_blocks: Callable[[Session, int], list[Any]]
    seed_opening_scene_memory_block: Callable[..., bool]
    memory_block_to_out: Callable[[Any], Any]
    plot_card_to_out: Callable[[Any], Any]
    world_card_to_out: Callable[[Any], Any]
    world_card_event_to_out: Callable[[Any], Any]
    plot_card_event_to_out: Callable[[Any], Any]
    resolve_story_ambient_profile: Callable[..., dict[str, Any] | None]
    resolve_story_scene_emotion_payload: Callable[..., str | None]
    resolve_story_turn_postprocess_payload: Callable[..., dict[str, Any] | None]
    serialize_story_ambient_profile: Callable[[dict[str, Any] | None], str]
    story_game_summary_to_out: Callable[[StoryGame], Any]
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


def _safe_dump_stream_item(item: Any) -> dict[str, Any] | None:
    if hasattr(item, "model_dump"):
        try:
            dumped = item.model_dump(mode="json")
        except Exception:
            return None
        return dumped if isinstance(dumped, dict) else None
    return item if isinstance(item, dict) else None


def _public_story_error_detail(exc: Exception) -> str:
    detail = re.sub(r"\s+", " ", str(exc).replace("\r\n", "\n").strip())
    if not detail:
        return "Text generation failed"
    if detail.casefold().startswith("openrouter chat error") and "{" in detail:
        detail = detail.split("{", 1)[0].rstrip(" .:,")
    return detail[:500]


def _estimate_story_tokens(value: str) -> int:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return 0
    matches = STORY_TOKEN_ESTIMATE_PATTERN.findall(normalized.lower().replace("ё", "е"))
    if matches:
        return len(matches)
    return max(1, math.ceil(len(normalized) / 4))


def _normalize_story_model_id(value: str | None) -> str:
    return str(value or "").strip().lower()


def _should_use_english_memory_source(model_name: str | None) -> bool:
    return _normalize_story_model_id(model_name) in STORY_MEMORY_SOURCE_EN_MODEL_IDS


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

    story_memory_tokens_used = plot_tokens_used + (
        latest_user_tokens_used
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


def _best_effort_sync_story_turn_memory_and_environment(
    *,
    deps: StoryRuntimeDeps,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    memory_optimization_enabled: bool,
) -> bool:
    def _normalize_text(value: str | None) -> str:
        return str(value or "").replace("\r\n", "\n").strip()

    def _normalize_assistant_memory_text(value: str | None) -> str:
        normalized = _normalize_text(value)
        if not normalized:
            return ""
        if "[[" not in normalized:
            return normalized
        try:
            from app.services import story_memory_pipeline as _story_memory_pipeline

            cleaned = _story_memory_pipeline._normalize_story_assistant_text_for_memory(normalized)
            cleaned = str(cleaned or "").strip()
            if cleaned:
                return cleaned
        except Exception:
            pass
        cleaned = re.sub(r"\[\[[^\]]+\]\]", " ", normalized)
        cleaned = re.sub(r"\[\[[^\]]*$", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def _assistant_has_dev_memory_block(*, assistant_id: int) -> bool:
        for item in deps.list_story_memory_blocks(db, game.id):
            layer_value = str(getattr(item, "layer", "") or "").strip().lower()
            if layer_value not in {"raw", "compressed", "super"}:
                continue
            if int(getattr(item, "assistant_message_id", 0) or 0) == assistant_id:
                return True
        return False

    def _upsert_raw_memory_block_directly(*, assistant_id: int, prompt_text: str, assistant_text: str) -> bool:
        normalized_prompt = _normalize_text(prompt_text)
        normalized_assistant = _normalize_assistant_memory_text(assistant_text)
        if not normalized_prompt and not normalized_assistant:
            return False

        content_parts: list[str] = []
        if normalized_prompt:
            content_parts.append(f"Ход игрока (полный текст):\n{normalized_prompt}")
        if normalized_assistant:
            content_parts.append(f"Ответ рассказчика (полный текст):\n{normalized_assistant}")
        normalized_content = "\n\n".join(content_parts).strip()
        if not normalized_content:
            return False

        title_seed = normalized_prompt or normalized_assistant
        compact_title_seed = " ".join(title_seed.split()).strip()
        if compact_title_seed:
            normalized_title = compact_title_seed[:120].rstrip(" ,;:-.!?")
        else:
            normalized_title = f"Ход {assistant_id}"
        if not normalized_title:
            normalized_title = f"Ход {assistant_id}"

        raw_blocks = list(
            db.scalars(
                select(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == game.id,
                    StoryMemoryBlock.assistant_message_id == assistant_id,
                    StoryMemoryBlock.undone_at.is_(None),
                )
            )
        )
        raw_blocks = [
            block
            for block in raw_blocks
            if str(getattr(block, "layer", "") or "").strip().lower() == "raw"
        ]

        token_count = max(_estimate_story_tokens(normalized_content), 1)
        changed_local = False
        if raw_blocks:
            primary = raw_blocks[0]
            if str(getattr(primary, "title", "") or "") != normalized_title:
                primary.title = normalized_title
                changed_local = True
            if str(getattr(primary, "content", "") or "") != normalized_content:
                primary.content = normalized_content
                changed_local = True
            if int(getattr(primary, "token_count", 0) or 0) != token_count:
                primary.token_count = token_count
                changed_local = True
            for duplicate in raw_blocks[1:]:
                db.delete(duplicate)
                changed_local = True
            return changed_local

        db.add(
            StoryMemoryBlock(
                game_id=game.id,
                assistant_message_id=assistant_id,
                layer="raw",
                title=normalized_title,
                content=normalized_content,
                token_count=token_count,
            )
        )
        db.flush()
        return True

    def _parse_environment_datetime(raw_value: str | None) -> datetime | None:
        normalized = str(raw_value or "").strip()
        if not normalized:
            return None
        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _serialize_environment_datetime(raw_value: datetime) -> str:
        normalized = raw_value
        if normalized.tzinfo is not None:
            normalized = normalized.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            normalized = normalized.replace(tzinfo=None)
        return normalized.replace(second=0, microsecond=0).isoformat()

    story_memory_pipeline = None
    try:
        from app.services import story_memory_pipeline
    except Exception:
        logger.exception(
            "Story fallback memory/environment sync import failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )

    changed = False
    memory_changed = False
    raw_memory_resynced = False
    should_force_memory_rebalance = bool(memory_optimization_enabled) and bool(
        _normalize_text(latest_user_prompt) or _normalize_text(latest_assistant_text)
    )
    if memory_optimization_enabled:
        if story_memory_pipeline is not None:
            try:
                if not bool(getattr(game, "memory_optimization_enabled", True)):
                    game.memory_optimization_enabled = True
                    changed = True
                keep_turns = max(
                    1,
                    int(
                        getattr(
                            story_memory_pipeline,
                            "STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS",
                            1,
                        )
                        or 1
                    ),
                )
                latest_assistant_ids = set(
                    story_memory_pipeline._list_story_latest_assistant_message_ids(
                        db,
                        game.id,
                        limit=keep_turns,
                    )
                )
                preserve_assistant_text = int(getattr(assistant_message, "id", 0) or 0) in latest_assistant_ids
                raw_memory_changed = bool(
                    story_memory_pipeline._upsert_story_raw_memory_block(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        latest_user_prompt=latest_user_prompt,
                        latest_assistant_text=latest_assistant_text,
                        preserve_user_text=preserve_assistant_text,
                        preserve_assistant_text=preserve_assistant_text,
                    )
                )
                raw_memory_resync_fn = getattr(
                    story_memory_pipeline,
                    "_sync_story_raw_memory_blocks_for_recent_turns",
                    None,
                )
                if callable(raw_memory_resync_fn):
                    raw_memory_resynced = bool(
                        raw_memory_resync_fn(
                            db=db,
                            game=game,
                            additional_assistant_message_ids=[int(getattr(assistant_message, "id", 0) or 0)],
                        )
                    )
                memory_changed = raw_memory_changed or memory_changed
                memory_changed = raw_memory_resynced or memory_changed
                changed = raw_memory_changed or changed
                changed = raw_memory_resynced or changed
            except Exception:
                logger.exception(
                    "Story fallback raw-memory sync failed: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )

        # Emergency-only guard: avoid synthetic raw blocks when the unified memory pipeline is available.
        assistant_id = int(getattr(assistant_message, "id", 0) or 0)
        if (
            story_memory_pipeline is None
            and assistant_id > 0
            and not _assistant_has_dev_memory_block(assistant_id=assistant_id)
        ):
            direct_raw_changed = _upsert_raw_memory_block_directly(
                assistant_id=assistant_id,
                prompt_text=latest_user_prompt,
                assistant_text=latest_assistant_text or str(getattr(assistant_message, "content", "") or ""),
            )
            memory_changed = direct_raw_changed or memory_changed
            changed = direct_raw_changed or changed

    if (memory_changed or should_force_memory_rebalance) and story_memory_pipeline is not None:
        try:
            story_memory_pipeline._rebalance_story_memory_layers(db=db, game=game)
        except Exception:
            logger.exception(
                "Story fallback memory rebalance failed: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

    if story_memory_pipeline is not None:
        environment_enabled = bool(
            story_memory_pipeline._normalize_story_environment_enabled(
                getattr(game, "environment_enabled", None),
            )
        )
    else:
        environment_enabled = bool(getattr(game, "environment_enabled", False))
    if environment_enabled:
        if story_memory_pipeline is not None:
            try:
                current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
                    db=db,
                    game_id=game.id,
                )
                changed = bool(
                    story_memory_pipeline._sync_story_environment_state_for_assistant_message(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        latest_user_prompt=latest_user_prompt,
                        latest_assistant_text=latest_assistant_text,
                        current_location_content_override=current_location_content,
                        resolved_payload_override=None,
                        allow_weather_seed=False,
                        allow_model_request=False,
                    )
                ) or changed
            except Exception:
                logger.exception(
                    "Story fallback environment sync failed: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )

    if not changed:
        return False

    try:
        deps.touch_story_game(game)
        db.commit()
        db.refresh(game)
        try:
            db.refresh(assistant_message)
        except Exception:
            pass
        return True
    except Exception:
        logger.exception(
            "Story fallback memory/environment commit failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        db.rollback()
        return False


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
    story_temperature: float,
    story_repetition_penalty: float,
    story_top_k: int,
    story_top_r: float,
    memory_optimization_enabled: bool,
    ambient_enabled: bool,
    emotion_visualization_enabled: bool,
    show_gg_thoughts: bool,
    show_npc_thoughts: bool,
):
    assistant_message: StoryMessage | None = None
    persist_min_chars = max(int(deps.stream_persist_min_chars), 1)
    persist_max_interval_seconds = max(float(deps.stream_persist_max_interval_seconds), 0.25)
    if _is_sqlite_database_url(getattr(settings, "database_url", "")):
        persist_min_chars = max(persist_min_chars, 2_800)
        persist_max_interval_seconds = max(persist_max_interval_seconds, 4.0)
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
    stream_runtime_meta: dict[str, str] = {}
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
            story_temperature=story_temperature,
            story_repetition_penalty=story_repetition_penalty,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
            use_plot_memory=memory_optimization_enabled,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
            raw_output_collector=stream_runtime_meta,
        ):
            produced += chunk
            current_time = time.monotonic()
            if (
                len(produced) - persisted_length >= persist_min_chars
                or current_time - last_persisted_at >= persist_max_interval_seconds
            ):
                assistant_message.content = produced
                try:
                    db.commit()
                except Exception:
                    logger.warning(
                        "Failed to checkpoint streamed story response; final save will retry. game_id=%s assistant_message_id=%s",
                        game.id,
                        assistant_message.id,
                        exc_info=True,
                    )
                    db.rollback()
                else:
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
                model_name=story_model_name,
                show_gg_thoughts=show_gg_thoughts,
                show_npc_thoughts=show_npc_thoughts,
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

    assistant_text_for_memory = assistant_text_for_postprocess
    if _should_use_english_memory_source(story_model_name):
        raw_output_candidate = str(stream_runtime_meta.get("raw_output") or "").replace("\r\n", "\n").strip()
        if raw_output_candidate:
            try:
                raw_output_candidate = deps.normalize_generated_story_output(
                    text_value=raw_output_candidate,
                    world_cards=world_cards,
                    model_name=None,
                    show_gg_thoughts=show_gg_thoughts,
                    show_npc_thoughts=show_npc_thoughts,
                ).strip()
            except Exception:
                logger.exception("Failed to normalize raw English output for memory")
            if raw_output_candidate:
                assistant_text_for_memory = raw_output_candidate

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

    unified_postprocess_payload: dict[str, Any] | None = None
    if not aborted and response_has_content:
        try:
            unified_postprocess_payload = deps.resolve_story_turn_postprocess_payload(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt=prompt,
                latest_assistant_text=assistant_text_for_memory,
                world_cards=world_cards,
                raw_memory_enabled=False,
                location_enabled=True,
                environment_enabled=bool(getattr(game, "environment_enabled", None)),
                character_state_enabled=bool(getattr(game, "character_state_enabled", None)),
                important_event_enabled=memory_optimization_enabled,
                ambient_enabled=ambient_enabled,
                emotion_visualization_enabled=emotion_visualization_enabled,
            )
        except Exception:
            logger.exception(
                "Failed to resolve unified story post-process payload: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            unified_postprocess_payload = None

    ambient_payload: dict[str, Any] | None = None
    scene_emotion_payload: str | None = None
    if ambient_enabled and not aborted and response_has_content:
        try:
            ambient_payload = deps.resolve_story_ambient_profile(
                latest_assistant_text=assistant_text_for_postprocess,
                resolved_payload_override=(
                    unified_postprocess_payload.get("ambient")
                    if isinstance(unified_postprocess_payload, dict)
                    and isinstance(unified_postprocess_payload.get("ambient"), dict)
                    else None
                ),
                allow_model_request=False,
            )
        except Exception:
            logger.exception(
                "Failed to resolve ambient profile: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            ambient_payload = None

        if isinstance(ambient_payload, dict):
            try:
                game.ambient_profile = deps.serialize_story_ambient_profile(ambient_payload)
                deps.touch_story_game(game)
                db.commit()
            except Exception:
                logger.exception(
                    "Failed to persist ambient profile: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
                db.rollback()
                ambient_payload = None

    if emotion_visualization_enabled and not aborted and response_has_content:
        try:
            scene_emotion_payload = deps.resolve_story_scene_emotion_payload(
                latest_user_prompt=prompt,
                latest_assistant_text=assistant_text_for_postprocess,
                world_cards=world_cards,
                resolved_payload_override=(
                    unified_postprocess_payload.get("scene_emotion")
                    if isinstance(unified_postprocess_payload, dict)
                    and isinstance(unified_postprocess_payload.get("scene_emotion"), dict)
                    else None
                ),
                allow_model_request=False,
            )
        except Exception:
            logger.exception(
                "Failed to resolve scene emotion payload: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            scene_emotion_payload = None

        if scene_emotion_payload:
            try:
                assistant_message.scene_emotion_payload = scene_emotion_payload
                deps.touch_story_game(game)
                db.commit()
                db.refresh(assistant_message)
            except Exception:
                logger.exception(
                    "Failed to persist scene emotion payload: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
                db.rollback()
                scene_emotion_payload = None

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
        postprocess_failed = False
        environment_enabled_for_turn = bool(getattr(game, "environment_enabled", None))
        previous_environment_datetime = str(getattr(game, "environment_current_datetime", "") or "")

        def _assistant_has_memory_block(items: list[Any]) -> bool:
            for item in items:
                if isinstance(item, dict):
                    assistant_message_id = item.get("assistant_message_id")
                    layer_value = str(item.get("layer", "") or "").strip().lower()
                else:
                    assistant_message_id = getattr(item, "assistant_message_id", None)
                    layer_value = str(getattr(item, "layer", "") or "").strip().lower()
                if layer_value not in {"raw", "compressed", "super"}:
                    continue
                if int(assistant_message_id or 0) == assistant_message.id:
                    return True
            return False

        try:
            plot_card_created, generated_plot_events = deps.upsert_story_plot_memory_card(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt_override=prompt,
                latest_assistant_text_override=assistant_text_for_memory,
                resolved_postprocess_payload_override=unified_postprocess_payload,
                memory_optimization_enabled=memory_optimization_enabled,
                allow_model_postprocess_request=False,
            )
            db.commit()
            try:
                db.refresh(game)
            except Exception:
                logger.exception(
                    "Failed to refresh story game after memory/environment post-process: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
            try:
                db.refresh(assistant_message)
            except Exception:
                logger.exception(
                    "Failed to refresh assistant message after memory/environment post-process: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
            logger.info(
                "Story memory/environment post-process committed: game_id=%s assistant_message_id=%s memory_blocks=%s environment_current_datetime=%s",
                game.id,
                assistant_message.id,
                len(deps.list_story_memory_blocks(db, game.id)),
                str(getattr(game, "environment_current_datetime", "") or ""),
            )
            if memory_optimization_enabled:
                plot_card_events_out = [
                    deps.plot_card_event_to_out(event) for event in generated_plot_events if event.undone_at is None
                ]
                plot_memory_payload = {
                    "assistant_message_id": assistant_message.id,
                    "plot_card_events": _safe_dump_stream_events(plot_card_events_out),
                    "plot_cards": _safe_dump_stream_items(
                        [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
                    ),
                    "ai_memory_blocks": _safe_dump_stream_items(
                        [deps.memory_block_to_out(block) for block in deps.list_story_memory_blocks(db, game.id)]
                    ),
                    "plot_card_created": plot_card_created,
                }
                yield _sse_event("plot_memory", plot_memory_payload)
        except Exception as exc:
            logger.exception("Failed to update story plot memory card")
            db.rollback()
            postprocess_failed = True

        memory_blocks_after_postprocess = deps.list_story_memory_blocks(db, game.id)
        current_environment_datetime = str(getattr(game, "environment_current_datetime", "") or "")
        needs_baseline_sync = postprocess_failed or (
            memory_optimization_enabled and not _assistant_has_memory_block(memory_blocks_after_postprocess)
        ) or (
            environment_enabled_for_turn
            and (
                not current_environment_datetime
                or current_environment_datetime == previous_environment_datetime
            )
        )

        baseline_synced = False
        if needs_baseline_sync:
            baseline_synced = _best_effort_sync_story_turn_memory_and_environment(
                deps=deps,
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt=prompt,
                latest_assistant_text=assistant_text_for_memory,
                memory_optimization_enabled=memory_optimization_enabled,
            )
        if postprocess_failed and not baseline_synced:
            logger.warning(
                "Story post-process failed and baseline sync made no changes: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

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

        ai_memory_blocks_payload = _safe_dump_stream_items(
            [deps.memory_block_to_out(block) for block in deps.list_story_memory_blocks(db, game.id)]
        )
        done_payload = {
            "message": {
                "id": assistant_message.id,
                "game_id": assistant_message.game_id,
                "role": assistant_message.role,
                "content": assistant_message.content,
                "scene_emotion_payload": str(getattr(assistant_message, "scene_emotion_payload", "") or "").strip() or None,
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
            "ai_memory_blocks": ai_memory_blocks_payload,
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
        game_payload = _safe_dump_stream_item(deps.story_game_summary_to_out(game))
        if game_payload is not None:
            resolved_current_location_label = resolve_story_current_location_label(
                game_payload.get("current_location_label"),
                ai_memory_blocks_payload,
            )
            if resolved_current_location_label:
                game_payload["current_location_label"] = resolved_current_location_label
            done_payload["game"] = game_payload
        if isinstance(ambient_payload, dict):
            done_payload["ambient"] = ambient_payload
        try:
            yield _sse_event("done", done_payload)
        except Exception as exc:
            logger.exception("Failed to emit stream done event")
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    ai_memory_blocks_payload = _safe_dump_stream_items(
        [deps.memory_block_to_out(block) for block in deps.list_story_memory_blocks(db, game.id)]
    )
    done_payload = {
        "message": {
            "id": assistant_message.id,
            "game_id": assistant_message.game_id,
            "role": assistant_message.role,
            "content": assistant_message.content,
            "scene_emotion_payload": str(getattr(assistant_message, "scene_emotion_payload", "") or "").strip() or None,
            "created_at": assistant_message.created_at.isoformat(),
            "updated_at": assistant_message.updated_at.isoformat(),
        },
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "turn_cost_tokens": turn_cost_tokens,
        "plot_cards": _safe_dump_stream_items(
            [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
        ),
        "ai_memory_blocks": ai_memory_blocks_payload,
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
    game_payload = _safe_dump_stream_item(deps.story_game_summary_to_out(game))
    if game_payload is not None:
        resolved_current_location_label = resolve_story_current_location_label(
            game_payload.get("current_location_label"),
            ai_memory_blocks_payload,
        )
        if resolved_current_location_label:
            game_payload["current_location_label"] = resolved_current_location_label
        done_payload["game"] = game_payload
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
    # Memory optimization is mandatory for story runtime.
    memory_optimization_enabled = True
    if bool(getattr(game, "memory_optimization_enabled", True)) is not True:
        game.memory_optimization_enabled = True
    payload_environment_enabled = getattr(payload, "environment_enabled", None)
    raw_environment_enabled = getattr(game, "environment_enabled", None)
    environment_enabled = bool(raw_environment_enabled)
    if payload_environment_enabled is None and not environment_enabled:
        has_environment_snapshot = any(
            str(value or "").strip()
            for value in (
                getattr(game, "environment_current_datetime", ""),
                getattr(game, "environment_current_weather", ""),
                getattr(game, "environment_tomorrow_weather", ""),
            )
        )
        if has_environment_snapshot:
            environment_enabled = True
    if payload_environment_enabled is not None:
        environment_enabled = bool(payload_environment_enabled)
    if bool(getattr(game, "environment_enabled", None)) != environment_enabled:
        game.environment_enabled = environment_enabled
    if environment_enabled:
        try:
            from app.services import story_memory_pipeline as _story_memory_pipeline

            has_environment_snapshot = any(
                str(value or "").strip()
                for value in (
                    getattr(game, "environment_current_datetime", ""),
                    getattr(game, "environment_current_weather", ""),
                    getattr(game, "environment_tomorrow_weather", ""),
                )
            )
            has_weather_memory_snapshot = any(
                _story_memory_pipeline._normalize_story_memory_layer(getattr(block, "layer", ""))
                == _story_memory_pipeline.STORY_MEMORY_LAYER_WEATHER
                for block in _story_memory_pipeline._list_story_memory_blocks(db, game.id)
            )
            if has_environment_snapshot and not has_weather_memory_snapshot:
                _story_memory_pipeline._sync_story_manual_environment_memory_blocks(db=db, game=game)
                db.flush()
        except Exception:
            logger.exception(
                "Failed to ensure baseline story environment snapshot: game_id=%s",
                game.id,
            )
    raw_ambient_enabled = getattr(game, "ambient_enabled", None)
    ambient_enabled = bool(raw_ambient_enabled)
    if payload.ambient_enabled is not None:
        ambient_enabled = bool(payload.ambient_enabled)
    raw_emotion_visualization_enabled = getattr(game, "emotion_visualization_enabled", None)
    emotion_visualization_enabled = bool(raw_emotion_visualization_enabled)
    if payload.emotion_visualization_enabled is not None:
        emotion_visualization_enabled = bool(payload.emotion_visualization_enabled)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        emotion_visualization_enabled = False
    logger.info(
        "Story generate settings: game_id=%s memory_optimization_enabled=%s payload_override=%s game_value=%s environment_enabled=%s environment_payload_override=%s environment_game_value=%s ambient_enabled=%s ambient_payload_override=%s ambient_game_value=%s emotion_visualization_enabled=%s emotion_payload_override=%s emotion_game_value=%s",
        game.id,
        memory_optimization_enabled,
        payload.memory_optimization_enabled,
        raw_memory_optimization_enabled,
        environment_enabled,
        payload_environment_enabled,
        raw_environment_enabled,
        ambient_enabled,
        payload.ambient_enabled,
        raw_ambient_enabled,
        emotion_visualization_enabled,
        payload.emotion_visualization_enabled,
        raw_emotion_visualization_enabled,
    )
    story_top_k = normalize_story_top_k(getattr(game, "story_top_k", None))
    if payload.story_top_k is not None:
        story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(getattr(game, "story_top_r", None))
    if payload.story_top_r is not None:
        story_top_r = normalize_story_top_r(payload.story_top_r)
    story_temperature = normalize_story_temperature(getattr(game, "story_temperature", None))
    if payload.story_temperature is not None:
        story_temperature = normalize_story_temperature(payload.story_temperature)
    story_repetition_penalty = normalize_story_repetition_penalty(
        getattr(game, "story_repetition_penalty", None)
    )
    if payload.story_repetition_penalty is not None:
        story_repetition_penalty = normalize_story_repetition_penalty(payload.story_repetition_penalty)
    raw_show_gg_thoughts = getattr(game, "show_gg_thoughts", None)
    show_gg_thoughts = False
    raw_show_npc_thoughts = getattr(game, "show_npc_thoughts", None)
    show_npc_thoughts = False if raw_show_npc_thoughts is None else bool(raw_show_npc_thoughts)
    if payload.show_npc_thoughts is not None:
        show_npc_thoughts = bool(payload.show_npc_thoughts)
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
    if not instruction_cards:
        try:
            persisted_instruction_rows = db.scalars(
                select(StoryInstructionCard)
                .where(
                    StoryInstructionCard.game_id == game.id,
                    StoryInstructionCard.is_active.is_(True),
                )
                .order_by(StoryInstructionCard.id.asc())
            ).all()
            persisted_instruction_inputs = [
                StoryInstructionCardInput(
                    title=str(getattr(card, "title", "") or ""),
                    content=str(getattr(card, "content", "") or ""),
                    is_active=bool(getattr(card, "is_active", True)),
                )
                for card in persisted_instruction_rows
            ]
            instruction_cards = deps.normalize_generation_instructions(persisted_instruction_inputs)
            if instruction_cards:
                logger.info(
                    "Story instructions hydrated from DB: game_id=%s cards=%s",
                    game.id,
                    len(instruction_cards),
                )
        except Exception:
            logger.exception("Failed to hydrate story instructions from DB: game_id=%s", game.id)
    source_user_message: StoryMessage | None = None

    def _seed_opening_scene_message_if_needed(current_messages: list[StoryMessage]) -> list[StoryMessage]:
        opening_scene = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
        if not opening_scene:
            return current_messages
        if current_messages:
            if not memory_optimization_enabled:
                return current_messages
            first_assistant_message = next(
                (message for message in current_messages if message.role == deps.story_assistant_role),
                None,
            )
            if first_assistant_message is None:
                return current_messages
            first_assistant_text = first_assistant_message.content.replace("\r\n", "\n").strip()
            if first_assistant_text != opening_scene:
                return current_messages
            try:
                created = deps.seed_opening_scene_memory_block(
                    db=db,
                    game=game,
                    assistant_message=first_assistant_message,
                    opening_scene_text=opening_scene,
                )
                if created:
                    db.commit()
            except Exception as exc:
                db.rollback()
                logger.warning(
                    "Opening scene memory backfill skipped after error: game_id=%s detail=%s",
                    game.id,
                    _public_story_error_detail(exc),
                )
                return current_messages
            return deps.list_story_messages(db, game.id) if created else current_messages
        try:
            opening_scene_message = StoryMessage(
                game_id=game.id,
                role=deps.story_assistant_role,
                content=opening_scene,
            )
            db.add(opening_scene_message)
            db.flush()
            if memory_optimization_enabled:
                try:
                    deps.seed_opening_scene_memory_block(
                        db=db,
                        game=game,
                        assistant_message=opening_scene_message,
                        opening_scene_text=opening_scene,
                    )
                except Exception as exc:
                    logger.warning(
                        "Opening scene memory seed skipped after error: game_id=%s detail=%s",
                        game.id,
                        _public_story_error_detail(exc),
                    )
            deps.touch_story_game(game)
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception("Failed to seed opening scene message: game_id=%s", game.id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to prepare opening scene: {_public_story_error_detail(exc)}",
            ) from exc
        return deps.list_story_messages(db, game.id)

    def _calculate_turn_cost_tokens(context_messages_for_cost: list[StoryMessage]) -> int:
        world_cards_for_cost = deps.list_story_world_cards(db, game.id)
        active_world_cards_for_cost = deps.select_story_world_cards_for_prompt(
            context_messages_for_cost,
            world_cards_for_cost,
        )
        active_plot_cards_for_cost = deps.list_story_prompt_memory_cards(
            db,
            game,
            memory_optimization_enabled,
            context_messages_for_cost,
        )
        context_usage_tokens = _estimate_story_context_usage_tokens(
            context_messages=context_messages_for_cost,
            instruction_cards=instruction_cards,
            plot_cards=active_plot_cards_for_cost,
            world_cards=active_world_cards_for_cost,
            memory_optimization_enabled=memory_optimization_enabled,
        )
        base_turn_cost_tokens = max(int(deps.get_story_turn_cost_tokens(context_usage_tokens, story_model_name)), 0)
        extra_turn_cost_tokens = 0
        if ambient_enabled:
            extra_turn_cost_tokens += 1
        if emotion_visualization_enabled:
            extra_turn_cost_tokens += 1
        return base_turn_cost_tokens + extra_turn_cost_tokens

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
                    touch_game=False,
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
                db.execute(
                    sa_delete(StoryMemoryBlock).where(
                        StoryMemoryBlock.assistant_message_id == last_message.id,
                    )
                )
                db.execute(
                    sa_delete(StoryCharacterStateSnapshot).where(
                        StoryCharacterStateSnapshot.assistant_message_id == last_message.id,
                    )
                )
                db.delete(last_message)
                if delete_source_user:
                    db.delete(source_user_message_for_step)
                if action_label != "reroll":
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
                    sa_delete(StoryMemoryBlock).where(
                        StoryMemoryBlock.assistant_message_id.in_(undone_message_ids),
                    )
                )
                db.execute(
                    sa_delete(StoryCharacterStateSnapshot).where(
                        StoryCharacterStateSnapshot.assistant_message_id.in_(undone_message_ids),
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
                sa_delete(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == game.id,
                    StoryMemoryBlock.undone_at.is_not(None),
                )
            )
            db.execute(
                sa_delete(StoryCharacterStateSnapshot).where(
                    StoryCharacterStateSnapshot.game_id == game.id,
                    StoryCharacterStateSnapshot.undone_at.is_not(None),
                )
            )
            db.execute(
                sa_delete(StoryMessage).where(
                    StoryMessage.game_id == game.id,
                    StoryMessage.undone_at.is_not(None),
                )
            )
            if action_label != "reroll":
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

    messages = _seed_opening_scene_message_if_needed(messages)

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
    active_plot_cards = deps.list_story_prompt_memory_cards(
        db,
        game,
        memory_optimization_enabled,
        context_messages,
    )
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
        story_temperature=story_temperature,
        story_repetition_penalty=story_repetition_penalty,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        memory_optimization_enabled=memory_optimization_enabled,
        ambient_enabled=ambient_enabled,
        emotion_visualization_enabled=emotion_visualization_enabled,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
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
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            # Force identity encoding for SSE so middleware/proxies do not gzip-buffer the stream.
            "Content-Encoding": "identity",
        },
    )
