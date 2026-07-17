from __future__ import annotations

import json
import logging
import math
import re
import time
from queue import Empty, Queue
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from threading import Event, Thread
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask, BackgroundTasks
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    StoryCharacterStateSnapshot,
    StoryGame,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryNovelBeat,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)
from app.schemas import StoryGenerateRequest, StoryInstructionCardInput, UserOut
from app.services.story_games import (
    STORY_RESPONSE_MAX_TOKENS_MAX,
    STORY_SUBSCRIPTION_LLM_MODELS,
    coerce_story_llm_model,
    normalize_story_environment_enabled,
    normalize_story_environment_time_enabled,
    normalize_story_environment_weather_enabled,
    normalize_story_repetition_penalty,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_response_token_limit_enabled,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
)
from app.services.story_messages import parse_story_message_variant_history
from app.services.story_game_operation_lock import (
    STORY_GAME_OPERATION_BUSY_DETAIL,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)
from app.services.story_canonical_pipeline import (
    build_canonical_generation_prompt,
    clear_canonical_state_payload,
    persist_canonical_state_to_game,
)
from app.services.story_memory import resolve_story_current_location_label
from app.services.provider_resilience import is_retryable_provider_error
from app.services.story_service_budget import (
    StoryServiceHttpRequestBudget,
    use_story_service_http_request_budget,
)
from app.services.story_smart_regeneration import (
    build_smart_regeneration_instruction_card,
    normalize_smart_regeneration_mode,
    normalize_smart_regeneration_options,
)
from app.services.sqlite_write_guard import commit_with_retry, is_database_busy_session_error
from app.services.story_generation_cancel import (
    StoryGenerationCancelled,
    cancel_story_generation,
    cancel_story_generation_or_next,
    is_story_generation_cancelled,
    mark_story_generation_finished,
    mark_story_generation_started,
)
from app.services.story_novel import (
    build_story_novel_instruction_card,
    is_story_visual_novel_enabled,
    persist_story_novel_beats_for_message,
    serialize_story_novel_beats_for_stream,
    strip_story_novel_scene_cast_metadata,
)
from app.services.story_novel_backgrounds import (
    apply_story_scene_background_memory_for_turn,
    story_scene_background_to_out,
)


def _resolve_story_turn_scene_background(
    deps: "StoryRuntimeDeps",
    db: Session,
    *,
    game: StoryGame,
    location_label: str | None,
    scene_text: str | None,
    latest_user_text: str | None,
):
    """Prefer the VN-only GLM place analysis; fall back to literal trigger memory when unwired."""
    resolver = getattr(deps, "resolve_story_novel_scene_background", None)
    if resolver is not None:
        return resolver(
            db,
            game=game,
            location_label=location_label,
            scene_text=scene_text,
            latest_user_text=latest_user_text,
        )
    return apply_story_scene_background_memory_for_turn(
        db, game=game, location_label=location_label, scene_text=scene_text
    )

logger = logging.getLogger(__name__)
STORY_MEMORY_SOURCE_EN_MODEL_IDS: set[str] = set()
STORY_SQLITE_BUSY_DETAIL = STORY_GAME_OPERATION_BUSY_DETAIL
STORY_POSTPROCESS_STATUS_COMMITTED = "storyteller_succeeded_committed"
STORY_POSTPROCESS_STATUS_FAILED_RETRYABLE = "storyteller_succeeded_postprocessing_failed_retryable"
STORY_POSTPROCESS_STATUS_PENDING = "storyteller_succeeded_postprocessing_pending"
STORY_GENERATE_LOCK_WAIT_SECONDS = 15.0
STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS = 20.0
STORY_GENERATE_LOCK_POLL_SECONDS = 0.75
STORY_PROVIDER_HEARTBEAT_SECONDS = 8.0
STORY_STREAM_RELAY_HEARTBEAT_SECONDS = 1.0
STORY_VISUAL_NOVEL_MATERIALIZATION_ERROR_DETAIL = (
    "Не удалось подготовить страницы визуальной новеллы. Повторите ход."
)
# Max discarded reroll variants kept alongside the current assistant message (oldest dropped first).
STORY_MESSAGE_VARIANT_HISTORY_MAX = 8
# Жёсткий потолок на ВСЕ Gemini-вызовы пост-обработки одного хода (единый общий бюджет на
# Call A «Мир», Call B «Персонажи», сжатие памяти и граф). Логический максимум при всех
# включённых модулях: 1 (A) + 1 (B) + 2 (память) + 1 (граф) = 5. Ретраи валидации используют
# только остаток бюджета; упёршись в потолок, запрос отклоняется штатно (модуль → pending,
# повтор следующим ходом), без локального синтеза.
STORY_TURN_MAX_SERVICE_REQUESTS = 5
STORY_MEMORY_POSTPROCESS_MAX_SERVICE_REQUESTS = 5
STORY_GRAPH_MAX_SERVICE_REQUESTS = 5
STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES = 7
STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_TOKENS = 1_800
STORY_ENVIRONMENT_TIME_TURN_SURCHARGE_TOKENS = 1
STORY_CHARACTER_AUTOMATION_TURN_SURCHARGE_TOKENS = 1
STORY_STREAM_RETRY_DELAYS_SECONDS = (1.0, 2.5, 5.0, 8.0)
STORY_CONTINUE_MODEL_PROMPT = (
    "Continue the current scene from exactly where the latest assistant response ended. "
    "Do not repeat or paraphrase the previous response. Advance events with a new action, reaction, consequence, "
    "detail, choice, or complication while preserving continuity, tone, and cause-and-effect logic."
)
STORY_CONTINUE_INSTRUCTION_CARD = {
    "title": "Continue command",
    "content": STORY_CONTINUE_MODEL_PROMPT,
    "source_kind": "system",
}
STORY_BILLING_KEY_MEMORY_BUDGET_SHARE = 0.10
STORY_BILLING_KEY_MEMORY_MIN_BUDGET_TOKENS = 500
STORY_BILLING_PLOT_CONTEXT_MAX_SHARE = 0.35
STORY_BILLING_RAW_MEMORY_BUDGET_SHARE = 0.50
STORY_BILLING_COMPRESSED_MEMORY_BUDGET_SHARE = 0.30


@dataclass
class _StoryMessagePromptOverride:
    source: StoryMessage
    content: str

    @property
    def id(self) -> Any:
        return getattr(self.source, "id", None)

    @property
    def game_id(self) -> Any:
        return getattr(self.source, "game_id", None)

    @property
    def role(self) -> str:
        return str(getattr(self.source, "role", "") or "")

    def __getattr__(self, name: str) -> Any:
        return getattr(self.source, name)


@dataclass(frozen=True)
class _StoryProviderHeartbeat:
    pass


_STORY_PROVIDER_HEARTBEAT = _StoryProviderHeartbeat()


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
    normalize_context_limit_chars: Callable[..., int]
    get_story_turn_cost_tokens: Callable[[int | None, str | None], int]
    spend_user_tokens_if_sufficient: Callable[[Session, int, int], bool]
    add_user_tokens: Callable[[Session, int, int], None]
    stream_story_provider_chunks: Callable[..., Any]
    upsert_story_plot_memory_card: Callable[..., Any]
    list_story_prompt_memory_cards: Callable[[Session, StoryGame, bool, list[StoryMessage] | None], list[dict[str, str]]]
    list_story_memory_blocks: Callable[[Session, int], list[Any]]
    seed_opening_scene_memory_block: Callable[..., bool]
    memory_block_to_out: Callable[[Any], Any]
    plot_card_to_out: Callable[[Any], Any]
    world_card_to_out: Callable[[Any], Any]
    resolve_story_ambient_profile: Callable[..., dict[str, Any] | None]
    resolve_story_turn_postprocess_payload: Callable[..., dict[str, Any] | None]
    serialize_story_ambient_profile: Callable[[dict[str, Any] | None], str]
    story_game_summary_to_out: Callable[[StoryGame], Any]
    story_default_title: str
    story_user_role: str
    story_assistant_role: str
    stream_persist_min_chars: int
    stream_persist_max_interval_seconds: float
    normalize_generated_story_output: Callable[..., str] | None = None
    # Visual-novel-only: smarter per-turn scene-background resolution via the under-the-hood
    # GLM model. Falls back to literal trigger memory when unset.
    resolve_story_novel_scene_background: Callable[..., Any] | None = None


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _sse_keepalive() -> str:
    return ": keepalive\n\n"


def _serialize_story_user_payload(db: Session, user: Any) -> dict[str, Any]:
    """Serialize the user for SSE turn payloads, including the live subscription block
    (plan + remaining daily turns) so the client left menu updates after every turn."""
    try:
        from app.services.auth_identity import serialize_user_out

        return serialize_user_out(user, db=db).model_dump(mode="json")
    except Exception:
        return UserOut.model_validate(user).model_dump(mode="json")


# A one-time ~2 KB SSE comment sent the instant the stream opens. Some proxies/CDNs buffer a
# response until their first buffer fills before forwarding anything; a tiny keepalive isn't
# enough to trip that, so the "start" frame (which turns on the "generation started" indicator)
# and the first tokens get held back — the player sees a long blank wait, then the whole answer
# at once. This padding forces an immediate flush so streaming begins right away. SSE comment
# lines (starting with ':') are ignored by the client parser, so it's invisible in the UI.
_STORY_SSE_STREAM_WARMUP = ":" + (" " * 2048) + "\n\n"


def _sse_stream_warmup() -> str:
    return _STORY_SSE_STREAM_WARMUP


def _iter_story_provider_chunks_with_heartbeat(
    *,
    chunk_iter_factory: Callable[[], Any],
    game_id: int,
    story_generation_id: str,
):
    queue: Queue[tuple[str, Any]] = Queue()

    def _worker() -> None:
        try:
            for chunk in chunk_iter_factory():
                queue.put(("chunk", chunk))
        except BaseException as exc:
            queue.put(("error", exc))
        finally:
            queue.put(("done", None))

    thread = Thread(
        target=_worker,
        name=f"story-provider-stream-{int(game_id or 0)}",
        daemon=True,
    )
    thread.start()

    heartbeat_seconds = max(float(STORY_PROVIDER_HEARTBEAT_SECONDS), 0.25)
    while True:
        if is_story_generation_cancelled(game_id, story_generation_id):
            raise StoryGenerationCancelled("Story generation cancelled")
        try:
            kind, value = queue.get(timeout=heartbeat_seconds)
        except Empty:
            yield _STORY_PROVIDER_HEARTBEAT
            continue

        if kind == "chunk":
            yield str(value or "")
            continue
        if kind == "error":
            raise value
        if kind == "done":
            return


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


def _normalize_story_postprocess_result(value: Any) -> tuple[bool, list[Any], dict[str, Any]]:
    if isinstance(value, tuple):
        plot_card_created = bool(value[0]) if len(value) >= 1 else False
        raw_events = value[1] if len(value) >= 2 else []
        events = list(raw_events) if isinstance(raw_events, list) else []
        raw_meta = value[2] if len(value) >= 3 else {}
        meta = dict(raw_meta) if isinstance(raw_meta, dict) else {}
        return (plot_card_created, events, meta)
    if isinstance(value, dict):
        raw_events = value.get("plot_card_events")
        events = list(raw_events) if isinstance(raw_events, list) else []
        return (
            bool(value.get("plot_card_created")),
            events,
            dict(value),
        )
    return (False, [], {})


def _public_story_error_detail(exc: Exception) -> str:
    detail = re.sub(r"\s+", " ", str(exc).replace("\r\n", "\n").strip())
    if not detail:
        return "Text generation failed"
    if is_database_busy_session_error(exc):
        return STORY_SQLITE_BUSY_DETAIL
    lowered_detail = detail.casefold()
    if (
        lowered_detail.startswith("routerai chat error")
        or lowered_detail.startswith("polza chat error")
    ) and "{" in detail:
        detail = detail.split("{", 1)[0].rstrip(" .:,")
    return detail[:500]


def _materialize_story_novel_beats_for_stream(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    raw_response: str,
    world_cards: list[StoryWorldCard],
    touch_story_game: Callable[[StoryGame], None],
) -> list[dict[str, Any]]:
    """Persist and serialize non-empty VN pages with one transaction-safe recovery attempt.

    A serialization failure can happen after the beat rows were already committed.  On retry,
    reload those rows instead of blindly replacing them again.  If persistence failed before
    commit, the clean transaction retries the deterministic parser/persist step once.
    """
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            novel_beats: list[StoryNovelBeat] = []
            if attempt > 0:
                novel_beats = list(
                    db.scalars(
                        select(StoryNovelBeat)
                        .where(StoryNovelBeat.message_id == int(assistant_message.id))
                        .order_by(StoryNovelBeat.order_index.asc())
                    ).all()
                )
            if not novel_beats:
                novel_beats = persist_story_novel_beats_for_message(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    raw_response=raw_response,
                    world_cards=world_cards,
                )
                if not novel_beats:
                    raise RuntimeError("Visual Novel parser produced no pages for a non-empty response")
                touch_story_game(game)
                commit_with_retry(db)
            db.refresh(assistant_message)
            for beat in novel_beats:
                try:
                    db.refresh(beat)
                except Exception:
                    # Serialization resolves current characters independently; a refresh miss
                    # is recoverable and should not discard otherwise committed pages.
                    pass
            payload = serialize_story_novel_beats_for_stream(db, novel_beats)
            if not payload:
                raise RuntimeError("Visual Novel page serialization returned an empty payload")
            return payload
        except Exception as exc:
            last_error = exc
            db.rollback()
            logger.warning(
                "Visual Novel page materialization attempt failed: game_id=%s "
                "assistant_message_id=%s attempt=%s",
                getattr(game, "id", None),
                getattr(assistant_message, "id", None),
                attempt + 1,
                exc_info=True,
            )
    raise RuntimeError(STORY_VISUAL_NOVEL_MATERIALIZATION_ERROR_DETAIL) from last_error


def _attach_story_operation_lease_release(
    response: StreamingResponse,
    release_callback: Callable[[], None],
) -> StreamingResponse:
    released = False

    def release_once() -> None:
        nonlocal released
        if released:
            return
        released = True
        release_callback()

    body_iterator = response.body_iterator

    async def releasing_body_iterator():
        try:
            async for chunk in body_iterator:
                yield chunk
        finally:
            release_once()

    response.body_iterator = releasing_body_iterator()

    existing_background = response.background
    if existing_background is None:
        response.background = BackgroundTask(release_once)
        return response

    if isinstance(existing_background, BackgroundTasks):
        existing_background.add_task(release_once)
        response.background = existing_background
        return response

    combined_background = BackgroundTasks()
    combined_background.tasks.append(existing_background)
    combined_background.add_task(release_once)
    response.background = combined_background
    return response


def _wait_for_story_generate_operation_lease(locked_game_id: int, stop_event: Event | None = None):
    wait_started_at = time.monotonic()
    cancel_requested = False
    cancel_deadline = wait_started_at + STORY_GENERATE_LOCK_WAIT_SECONDS + STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS
    last_busy_error: StoryGameOperationBusyError | None = None

    while True:
        if stop_event is not None and stop_event.is_set():
            raise StoryGenerationCancelled("Story generation stream was closed before lock acquisition")
        now = time.monotonic()
        active_deadline = (
            cancel_deadline
            if cancel_requested
            else wait_started_at + STORY_GENERATE_LOCK_WAIT_SECONDS
        )
        remaining_seconds = max(active_deadline - now, 0.0)
        poll_seconds = min(max(float(STORY_GENERATE_LOCK_POLL_SECONDS), 0.05), max(remaining_seconds, 0.05))
        try:
            return acquire_story_game_operation_lock(
                locked_game_id,
                operation="story_generate",
                wait_timeout_seconds=poll_seconds,
            )
        except StoryGameOperationBusyError as exc:
            last_busy_error = exc
            now = time.monotonic()
            if not cancel_requested and now >= wait_started_at + STORY_GENERATE_LOCK_WAIT_SECONDS:
                cancelled_previous_generation = cancel_story_generation(locked_game_id)
                cancel_requested = True
                cancel_deadline = now + STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS
                logger.warning(
                    "Story generate lock timed out inside stream; requested active generation cancellation: "
                    "game_id=%s cancelled=%s error=%s",
                    locked_game_id,
                    cancelled_previous_generation,
                    exc,
                )
            elif cancel_requested and now >= cancel_deadline:
                logger.warning(
                    "Story generate lock stayed busy after streaming cancellation grace period: "
                    "game_id=%s wait_seconds=%.3fs error=%s",
                    locked_game_id,
                    STORY_GENERATE_LOCK_CANCEL_WAIT_SECONDS,
                    exc,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=STORY_GAME_OPERATION_BUSY_DETAIL,
                ) from last_busy_error
            yield _sse_keepalive()


def _restore_latest_undone_assistant_response_if_orphaned(
    *,
    deps: StoryRuntimeDeps,
    db: Session,
    game: StoryGame,
    current_messages: list[StoryMessage] | None = None,
    reason: str,
) -> bool:
    messages = current_messages if current_messages is not None else deps.list_story_messages(db, game.id)
    latest_visible_message = messages[-1] if messages else None
    if latest_visible_message is None or latest_visible_message.role != deps.story_user_role:
        return False

    latest_undone_assistant = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == deps.story_assistant_role,
            StoryMessage.undone_at.is_not(None),
            StoryMessage.id > latest_visible_message.id,
        )
        .order_by(StoryMessage.undone_at.desc(), StoryMessage.id.desc())
    )
    if latest_undone_assistant is None:
        return False

    visible_message_after_undone_assistant = db.scalar(
        select(StoryMessage.id)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.undone_at.is_(None),
            StoryMessage.id > latest_undone_assistant.id,
        )
        .order_by(StoryMessage.id.asc())
        .limit(1)
    )
    if visible_message_after_undone_assistant is not None:
        return False

    from app.services.story_undo import reapply_story_card_events_for_assistant_message

    reapply_story_card_events_for_assistant_message(
        db=db,
        game=game,
        assistant_message_id=latest_undone_assistant.id,
        commit=False,
        touch_game=False,
    )
    latest_undone_assistant.undone_at = None
    deps.touch_story_game(game)
    commit_with_retry(db)
    logger.warning(
        "Restored orphaned assistant response: game_id=%s assistant_message_id=%s reason=%s",
        game.id,
        latest_undone_assistant.id,
        reason,
    )
    return True


def _estimate_story_tokens(value: str) -> int:
    normalized = _normalize_story_message_content(value)
    if not normalized:
        return 0
    matches = STORY_TOKEN_ESTIMATE_PATTERN.findall(normalized.lower().replace("ё", "е"))
    if matches:
        return len(matches)
    return max(1, math.ceil(len(normalized) / 4))


def _normalize_story_model_id(value: str | None) -> str:
    return str(value or "").strip().lower()


def _normalize_story_message_content(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _story_message_variant_created_at(message: "StoryMessage") -> str:
    created_at_value = getattr(message, "created_at", None)
    return created_at_value.isoformat() if isinstance(created_at_value, datetime) else ""


def _snapshot_discarded_story_message_log(message: "StoryMessage") -> list[dict[str, str]]:
    """Chronological variant log to carry from `message` onto whatever replaces it.

    If `message` was never rerolled, its log is empty, so bootstrap a single-entry log from its
    own text. Otherwise its stored log already mirrors its active content (kept in sync by
    _finalize_story_message_variant_log / the select-variant endpoint), so it's returned as-is
    -- appending message.content again here would duplicate the active entry.
    """
    existing = parse_story_message_variant_history(getattr(message, "variant_history_json", None))
    if existing:
        return existing[-STORY_MESSAGE_VARIANT_HISTORY_MAX:]
    snapshot_content = _normalize_story_message_content(getattr(message, "content", None))
    if not snapshot_content:
        return []
    return [
        {
            "content": snapshot_content,
            "created_at": _story_message_variant_created_at(message),
        }
    ]


def _append_story_message_variant_log_entry(
    message: "StoryMessage",
    carried_log: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Append `message`'s final text as a brand-new entry onto a carried chronological log."""
    combined = list(carried_log)
    snapshot_content = _normalize_story_message_content(getattr(message, "content", None))
    if snapshot_content:
        combined.append(
            {
                "content": snapshot_content,
                "created_at": _story_message_variant_created_at(message),
            }
        )
    return combined[-STORY_MESSAGE_VARIANT_HISTORY_MAX:]


def _sanitize_streamed_story_markup(
    value: Any,
    *,
    normalize_generated_story_output: Callable[..., str] | None = None,
    world_cards: list[dict[str, Any]] | None = None,
    model_name: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
) -> str:
    """Final safety net for the streamed reply.

    Delegates to the monolith markup sanitizer, which strips markdown noise and rewrites
    invented speaker tags into canonical [[...]] markers. A strict, read-only validation pass
    then routes only obvious unmarked speech through the existing model-assisted normalizer.
    Correct canonical output and ordinary narration remain on the lossless path.
    """
    raw = _normalize_story_message_content(value)
    if not raw:
        return raw
    cleaned = raw
    strict_validator: Callable[[str], bool] | None = None
    try:
        from app import main as monolith_main

        sanitizer = getattr(monolith_main, "_sanitize_story_stream_markup_formatting", None)
        if callable(sanitizer):
            sanitized = str(sanitizer(raw) or "").replace("\r\n", "\n").strip()
            if sanitized:
                cleaned = sanitized

        strict_validator = getattr(monolith_main, "_is_story_strict_markup_output", None)
        if not callable(strict_validator) or bool(strict_validator(cleaned)):
            return cleaned
    except Exception:
        logger.exception("Failed to sanitize streamed story markup; using raw provider text")
        return raw

    if not callable(normalize_generated_story_output):
        logger.warning("Unmarked story dialogue detected, but the markup normalizer is unavailable")
        return cleaned

    try:
        repaired = normalize_generated_story_output(
            text_value=cleaned,
            world_cards=world_cards if isinstance(world_cards, list) else [],
            model_name=model_name,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )
        repaired_text = str(repaired or "").replace("\r\n", "\n").strip()
        if repaired_text:
            if callable(strict_validator) and not bool(strict_validator(repaired_text)):
                logger.warning("Story markup repair returned output that still violates the strict contract")
            return repaired_text
    except Exception:
        logger.exception("Failed to repair unmarked dialogue in streamed story output")
    return cleaned


def _should_use_english_memory_source(model_name: str | None) -> bool:
    return _normalize_story_model_id(model_name) in STORY_MEMORY_SOURCE_EN_MODEL_IDS


def _resolve_story_environment_runtime_flags(
    game: StoryGame,
    *,
    payload_environment_enabled: bool | None = None,
    payload_environment_time_enabled: bool | None = None,
    payload_environment_weather_enabled: bool | None = None,
) -> tuple[bool, bool, bool]:
    legacy_enabled = normalize_story_environment_enabled(getattr(game, "environment_enabled", None))
    time_enabled = normalize_story_environment_time_enabled(
        getattr(game, "environment_time_enabled", None),
        legacy_environment_enabled=legacy_enabled,
    )
    weather_enabled = normalize_story_environment_weather_enabled(
        getattr(game, "environment_weather_enabled", None),
        legacy_environment_enabled=legacy_enabled,
    )

    if payload_environment_enabled is not None and payload_environment_time_enabled is None:
        time_enabled = normalize_story_environment_time_enabled(
            None,
            legacy_environment_enabled=payload_environment_enabled,
        )
    if payload_environment_enabled is not None and payload_environment_weather_enabled is None:
        weather_enabled = normalize_story_environment_weather_enabled(
            None,
            legacy_environment_enabled=payload_environment_enabled,
        )
    if payload_environment_time_enabled is not None:
        time_enabled = normalize_story_environment_time_enabled(
            payload_environment_time_enabled,
            legacy_environment_enabled=time_enabled,
        )
    if payload_environment_weather_enabled is not None:
        weather_enabled = normalize_story_environment_weather_enabled(
            payload_environment_weather_enabled,
            legacy_environment_enabled=weather_enabled,
        )

    no_environment_payload = (
        payload_environment_enabled is None
        and payload_environment_time_enabled is None
        and payload_environment_weather_enabled is None
    )
    if no_environment_payload and not (time_enabled or weather_enabled):
        if str(getattr(game, "environment_current_datetime", "") or "").strip():
            time_enabled = True
        if (
            str(getattr(game, "environment_current_weather", "") or "").strip()
            or str(getattr(game, "environment_tomorrow_weather", "") or "").strip()
        ):
            weather_enabled = True

    return time_enabled or weather_enabled, time_enabled, weather_enabled


def _with_latest_user_prompt_override(
    context_messages: list[StoryMessage],
    replacement_content: str,
) -> list[StoryMessage]:
    replacement = _normalize_story_message_content(replacement_content)
    if not replacement:
        return context_messages
    result: list[Any] = list(context_messages)
    for index in range(len(result) - 1, -1, -1):
        message = result[index]
        if str(getattr(message, "role", "") or "") != "user":
            continue
        result[index] = _StoryMessagePromptOverride(source=message, content=replacement)
        return result
    return context_messages


def _estimate_story_context_usage_tokens(
    *,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    memory_optimization_enabled: bool,
    context_limit_tokens: int,
) -> int:
    context_limit = max(int(context_limit_tokens or 0), 0)

    def _estimate_cards_payload_tokens(cards: list[dict[str, str]]) -> int:
        if not cards:
            return 0
        payload = "\n".join(
            f"{index}. {card['title']}: {card['content']}"
            for index, card in enumerate(cards, start=1)
            if card.get("title", "").strip() and card.get("content", "").strip()
        )
        return _estimate_story_tokens(payload)

    def _estimate_cards_tokens_within_budget(cards: list[dict[str, str]], token_budget: int) -> int:
        budget = max(int(token_budget), 0)
        if not cards or budget <= 0:
            return 0

        selected_reversed: list[dict[str, str]] = []
        consumed_tokens = 0
        for card in reversed(cards):
            title = " ".join(str(card.get("title", "")).replace("\r\n", " ").split()).strip()
            content = str(card.get("content", "")).replace("\r\n", "\n").strip()
            if not title or not content:
                continue
            card_cost = _estimate_story_tokens(title) + _estimate_story_tokens(content) + 6
            if consumed_tokens + card_cost <= budget:
                selected_reversed.append({"title": title, "content": content})
                consumed_tokens += card_cost
                continue
            if not selected_reversed:
                return budget
            break

        selected_reversed.reverse()
        return min(_estimate_cards_payload_tokens(selected_reversed), budget)

    def _select_billable_history_messages() -> list[StoryMessage]:
        eligible_messages = [
            message
            for message in context_messages
            if message.role in {"user", "assistant"}
            and _normalize_story_message_content(getattr(message, "content", None))
        ]
        if not memory_optimization_enabled:
            return eligible_messages

        latest_user_index: int | None = None
        for index, message in enumerate(eligible_messages):
            if message.role != "user":
                continue
            latest_user_index = index
        if latest_user_index is None:
            return []

        selected_reversed: list[StoryMessage] = []
        consumed_tokens = 0
        for message in reversed(eligible_messages[: latest_user_index + 1]):
            if len(selected_reversed) >= STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES:
                break
            content = _normalize_story_message_content(getattr(message, "content", None))
            entry_cost = _estimate_story_tokens(content) + 4
            if consumed_tokens + entry_cost > STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_TOKENS:
                if not selected_reversed:
                    selected_reversed.append(message)
                break
            selected_reversed.append(message)
            consumed_tokens += entry_cost
        selected_reversed.reverse()
        return selected_reversed

    def _estimate_history_tokens_within_budget(messages_for_billing: list[StoryMessage], token_budget: int) -> int:
        budget = max(int(token_budget), 0)
        if not messages_for_billing or budget <= 0:
            return 0

        consumed_tokens = 0
        selected_any = False
        for message in reversed(messages_for_billing):
            content = _normalize_story_message_content(getattr(message, "content", None))
            if not content:
                continue
            message_cost = _estimate_story_tokens(content) + 4
            if consumed_tokens + message_cost <= budget:
                consumed_tokens += message_cost
                selected_any = True
                continue
            if not selected_any:
                return budget
            break
        return min(consumed_tokens, budget)

    billable_instruction_cards = [
        card
        for card in instruction_cards
        if str(card.get("source_kind", "") or "").strip().lower() in {"", "user", "instruction"}
    ]
    instruction_payload = "\n".join(
        f"{index}. {card['title']}: {card['content']}"
        for index, card in enumerate(billable_instruction_cards, start=1)
        if card.get("title", "").strip() and card.get("content", "").strip()
    )
    instruction_tokens_used = _estimate_story_tokens(instruction_payload)

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

    fixed_cards_budget_tokens = max(context_limit - instruction_tokens_used - world_tokens_used, 0)
    billable_history_messages = _select_billable_history_messages()
    if not memory_optimization_enabled:
        history_tokens_used = _estimate_history_tokens_within_budget(
            billable_history_messages,
            fixed_cards_budget_tokens,
        )
        return max(instruction_tokens_used + history_tokens_used + world_tokens_used, 0)

    history_tokens_used = _estimate_history_tokens_within_budget(
        billable_history_messages,
        fixed_cards_budget_tokens,
    )
    fixed_cards_budget_tokens = max(fixed_cards_budget_tokens - history_tokens_used, 0)

    key_memory_cards: list[dict[str, str]] = []
    location_memory_cards: list[dict[str, str]] = []
    raw_memory_cards: list[dict[str, str]] = []
    compressed_memory_cards: list[dict[str, str]] = []
    super_memory_cards: list[dict[str, str]] = []
    plot_memory_cards: list[dict[str, str]] = []
    for card in plot_cards:
        source_kind = str(card.get("source_kind", "") or "").strip().lower()
        memory_layer = str(card.get("memory_layer", "") or "").strip().lower()
        title = " ".join(str(card.get("title", "") or "").replace("\r\n", " ").split()).strip()
        if memory_layer == "location" or title == "Место" or title.startswith("Место:"):
            location_memory_cards.append(card)
        elif memory_layer == "key":
            key_memory_cards.append(card)
        elif memory_layer == "raw":
            raw_memory_cards.append(card)
        elif memory_layer == "compressed":
            compressed_memory_cards.append(card)
        elif memory_layer == "super":
            super_memory_cards.append(card)
        elif source_kind == "plot":
            plot_memory_cards.append(card)

    key_memory_budget_tokens = min(
        context_limit,
        max(int(context_limit * STORY_BILLING_KEY_MEMORY_BUDGET_SHARE), STORY_BILLING_KEY_MEMORY_MIN_BUDGET_TOKENS),
    )
    location_memory_tokens_used = _estimate_cards_tokens_within_budget(
        location_memory_cards,
        fixed_cards_budget_tokens,
    )
    fixed_cards_budget_tokens = max(fixed_cards_budget_tokens - location_memory_tokens_used, 0)
    key_memory_tokens_used = _estimate_cards_tokens_within_budget(
        key_memory_cards,
        min(key_memory_budget_tokens, fixed_cards_budget_tokens),
    )
    available_after_key_tokens = max(fixed_cards_budget_tokens - key_memory_tokens_used, 0)
    plot_budget_tokens = min(
        int(context_limit * STORY_BILLING_PLOT_CONTEXT_MAX_SHARE),
        available_after_key_tokens,
    )
    plot_tokens_used = _estimate_cards_tokens_within_budget(plot_memory_cards, plot_budget_tokens)
    dev_memory_budget_tokens = max(fixed_cards_budget_tokens - key_memory_tokens_used - plot_tokens_used, 0)
    raw_memory_budget_tokens = max(int(dev_memory_budget_tokens * STORY_BILLING_RAW_MEMORY_BUDGET_SHARE), 0)
    compressed_memory_budget_tokens = max(
        int(dev_memory_budget_tokens * STORY_BILLING_COMPRESSED_MEMORY_BUDGET_SHARE),
        0,
    )
    super_memory_budget_tokens = max(
        dev_memory_budget_tokens - raw_memory_budget_tokens - compressed_memory_budget_tokens,
        0,
    )
    memory_tokens_used = (
        location_memory_tokens_used
        + key_memory_tokens_used
        + plot_tokens_used
        + _estimate_cards_tokens_within_budget(raw_memory_cards, raw_memory_budget_tokens)
        + _estimate_cards_tokens_within_budget(compressed_memory_cards, compressed_memory_budget_tokens)
        + _estimate_cards_tokens_within_budget(super_memory_cards, super_memory_budget_tokens)
    )
    return max(instruction_tokens_used + history_tokens_used + memory_tokens_used + world_tokens_used, 0)


def _calculate_story_turn_cost_tokens(
    *,
    get_story_turn_cost_tokens: Callable[[int | None, str | None], int],
    context_limit_tokens: int,
    model_name: str | None,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    memory_optimization_enabled: bool,
    accelerated_service_enabled: bool = False,
) -> int:
    _ = accelerated_service_enabled
    context_usage_tokens = _estimate_story_context_usage_tokens(
        context_messages=context_messages,
        instruction_cards=instruction_cards,
        plot_cards=plot_cards,
        world_cards=world_cards,
        memory_optimization_enabled=memory_optimization_enabled,
        context_limit_tokens=context_limit_tokens,
    )
    billable_context_usage_tokens = min(
        max(context_usage_tokens, 0),
        max(int(context_limit_tokens or 0), 0),
    )
    base_cost = max(int(get_story_turn_cost_tokens(billable_context_usage_tokens, model_name)), 0)
    return base_cost


def _calculate_story_service_surcharge_tokens(
    *,
    environment_time_enabled: bool,
    character_state_enabled: bool,
    auto_npc_cards_enabled: bool,
    graph_enabled: bool,
    graph_request_cost_tokens: int = 0,
) -> int:
    surcharge = 0
    if environment_time_enabled:
        surcharge += STORY_ENVIRONMENT_TIME_TURN_SURCHARGE_TOKENS
    if character_state_enabled or auto_npc_cards_enabled:
        surcharge += STORY_CHARACTER_AUTOMATION_TURN_SURCHARGE_TOKENS
    if graph_enabled:
        surcharge += max(0, min(int(graph_request_cost_tokens or 0), STORY_GRAPH_MAX_SERVICE_REQUESTS))
    return surcharge


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


def _order_story_world_cards_for_active_main_hero(
    game: StoryGame,
    world_cards: list[Any],
) -> list[Any]:
    active_main_hero_card_id = int(getattr(game, "active_main_hero_card_id", 0) or 0)
    if active_main_hero_card_id <= 0:
        return list(world_cards)

    def _rank(card: Any) -> tuple[int, int]:
        card_id = int(getattr(card, "id", 0) or 0)
        card_kind = str(getattr(card, "kind", "") or "").strip().lower()
        if card_kind == "main_hero" and card_id == active_main_hero_card_id:
            return (-2, card_id)
        if card_kind == "main_hero":
            return (-1, card_id)
        return (0, card_id)

    return sorted(list(world_cards), key=_rank)


def _checkpoint_story_raw_turn_memory(
    *,
    deps: StoryRuntimeDeps,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    memory_optimization_enabled: bool,
) -> bool:
    if not memory_optimization_enabled:
        return False

    try:
        from app.services import story_memory_pipeline
    except Exception:
        logger.exception(
            "Story raw-memory checkpoint import failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        return False

    try:
        changed = False
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
        preserve_full_text = int(getattr(assistant_message, "id", 0) or 0) in latest_assistant_ids
        changed = bool(
            story_memory_pipeline._upsert_story_raw_memory_block(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt=latest_user_prompt,
                latest_assistant_text=latest_assistant_text,
                preserve_user_text=preserve_full_text,
                preserve_assistant_text=preserve_full_text,
            )
        ) or changed

        raw_memory_resync_fn = getattr(story_memory_pipeline, "_sync_story_raw_memory_blocks_for_recent_turns", None)
        if callable(raw_memory_resync_fn):
            changed = bool(
                raw_memory_resync_fn(
                    db=db,
                    game=game,
                    additional_assistant_message_ids=[int(getattr(assistant_message, "id", 0) or 0)],
                    run_rebalance=False,
                )
            ) or changed

        has_raw_checkpoint = any(
            int(getattr(block, "assistant_message_id", 0) or 0) == int(getattr(assistant_message, "id", 0) or 0)
            and str(getattr(block, "layer", "") or "").strip().lower() in {"raw", "latest_full"}
            for block in story_memory_pipeline._list_story_memory_blocks(db, game.id)
        )

        if changed:
            deps.touch_story_game(game)
            commit_with_retry(db)
            try:
                db.refresh(game)
            except Exception:
                pass
            try:
                db.refresh(assistant_message)
            except Exception:
                pass
            has_raw_checkpoint = True

        if has_raw_checkpoint:
            logger.info(
                "Story raw-memory checkpoint ready: game_id=%s assistant_message_id=%s changed=%s",
                game.id,
                assistant_message.id,
                changed,
            )
        return has_raw_checkpoint
    except Exception:
        logger.exception(
            "Story raw-memory checkpoint failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        db.rollback()
        return False


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
            if layer_value not in {"raw", "latest_full", "fresh_detailed", "compressed", "facts", "raw_pending", "super"}:
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
            story_memory_pipeline._rebalance_story_memory_layers(
                db=db,
                game=game,
                max_model_requests=3,
                backfill_existing_compact_layers=False,
                prioritize_recent_transitions=True,
            )
        except Exception:
            logger.exception(
                "Story fallback memory rebalance failed: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

    current_location_content = ""
    if story_memory_pipeline is not None:
        try:
            previous_location_content = story_memory_pipeline._get_story_effective_location_memory_content(
                db=db,
                game=game,
            )
            changed = bool(
                story_memory_pipeline._upsert_story_location_memory_block(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=latest_user_prompt,
                    latest_assistant_text=latest_assistant_text,
                    previous_assistant_text="",
                    resolved_payload_override=None,
                )
            ) or changed
            current_location_content = story_memory_pipeline._get_story_effective_location_memory_content(
                db=db,
                game=game,
            )
            created_auto_npc_card_ids: set[int] = set()
            if bool(getattr(game, "auto_npc_cards_enabled", False)):
                created_auto_npc_cards = story_memory_pipeline._sync_story_auto_npc_cards_for_assistant_message(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=latest_user_prompt,
                    latest_assistant_text=latest_assistant_text,
                    resolved_payload_override=None,
                    allow_model_request=False,
                )
                created_auto_npc_card_ids = {
                    int(getattr(card, "id"))
                    for card in created_auto_npc_cards
                    if isinstance(getattr(card, "id", None), int)
                }
                changed = bool(created_auto_npc_cards) or changed
            if bool(getattr(game, "character_state_enabled", None)):
                changed = bool(
                    story_memory_pipeline._ensure_story_character_state_cards_include_world_cards(
                        db=db,
                        game=game,
                        active_world_card_ids=created_auto_npc_card_ids,
                        current_location_content=current_location_content or previous_location_content,
                    )
                ) or changed
                changed = bool(
                    story_memory_pipeline._sync_story_character_state_cards(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        resolved_payload_override=None,
                        current_location_content=current_location_content or previous_location_content,
                        latest_user_prompt=latest_user_prompt,
                        previous_assistant_text="",
                        latest_assistant_text=latest_assistant_text,
                        allow_model_seed=False,
                        allow_model_fill=False,
                    )
                ) or changed
                try:
                    from app.services.story_character_state_fields import apply_story_character_state_payload_to_world_cards

                    apply_story_character_state_payload_to_world_cards(db=db, game=game)
                except Exception:
                    logger.exception(
                        "Story fallback character-state field sync failed: game_id=%s assistant_message_id=%s",
                        game.id,
                        assistant_message.id,
                    )
        except Exception:
            logger.exception(
                "Story fallback location/NPC/state sync failed: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

    environment_enabled, _, _ = _resolve_story_environment_runtime_flags(game)
    if environment_enabled:
        if story_memory_pipeline is not None:
            try:
                if not current_location_content:
                    current_location_content = story_memory_pipeline._get_story_effective_location_memory_content(
                        db=db,
                        game=game,
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
    reroll_discarded_assistant_text: str | None,
    reroll_carried_variant_history: list[dict[str, str]] | None = None,
    ambient_enabled: bool,
    visual_novel_enabled: bool,
    show_gg_thoughts: bool,
    show_npc_thoughts: bool,
    story_generation_id: str,
    precharged_graph_cost_tokens: int = 0,
    discarded_assistant_message_ids: list[int] | None = None,
    is_subscription_turn: bool = False,
    subscription_daily_turn_limit: int = 0,
    subscription_period_start: str = "",
):
    assistant_message: StoryMessage | None = None
    discarded_assistant_ids = [
        int(message_id)
        for message_id in (discarded_assistant_message_ids or [])
        if isinstance(message_id, int) and int(message_id) > 0
    ]
    discarded_steps_restored = False
    discarded_steps_purged = False
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
        commit_with_retry(db)
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

    def _stop_requested(stage: str, *, rollback: bool = False) -> bool:
        if not is_story_generation_cancelled(int(game.id), story_generation_id):
            return False
        logger.info(
            "Story generation cancellation acknowledged: game_id=%s assistant_message_id=%s stage=%s",
            game.id,
            getattr(assistant_message, "id", None),
            stage,
        )
        if rollback:
            try:
                db.rollback()
            except Exception:
                logger.debug(
                    "Failed to roll back cancelled story generation stage: game_id=%s stage=%s",
                    game.id,
                    stage,
                    exc_info=True,
                )
        return True

    def _persist_cancelled_output() -> None:
        partial_output = str(produced or "").replace("\r\n", "\n").strip()
        try:
            if assistant_message is not None and partial_output:
                assistant_message.content = partial_output
            elif assistant_message is not None:
                db.delete(assistant_message)
            deps.touch_story_game(game)
            commit_with_retry(db)
            try:
                db.refresh(user)
            except Exception:
                pass
        except Exception:
            logger.exception(
                "Failed to clean up canceled story stream: game_id=%s assistant_message_id=%s",
                game.id,
                getattr(assistant_message, "id", None),
            )
            db.rollback()

    def _restore_discarded_assistant_steps(reason: str) -> None:
        nonlocal discarded_steps_restored
        if discarded_steps_restored or not discarded_assistant_ids:
            return
        try:
            from app.services.story_undo import reapply_story_card_events_for_assistant_message

            restored_any = False
            for discarded_assistant_id in discarded_assistant_ids:
                discarded_message = db.scalar(
                    select(StoryMessage).where(
                        StoryMessage.id == discarded_assistant_id,
                        StoryMessage.game_id == game.id,
                        StoryMessage.role == deps.story_assistant_role,
                        StoryMessage.undone_at.is_not(None),
                    )
                )
                if discarded_message is None:
                    continue
                reapply_story_card_events_for_assistant_message(
                    db=db,
                    game=game,
                    assistant_message_id=discarded_assistant_id,
                    commit=False,
                    touch_game=False,
                )
                discarded_message.undone_at = None
                restored_any = True
            if restored_any:
                deps.touch_story_game(game)
                commit_with_retry(db)
                try:
                    db.refresh(game)
                except Exception:
                    pass
                logger.info(
                    "Restored discarded assistant step after failed replacement: game_id=%s assistant_ids=%s reason=%s",
                    game.id,
                    discarded_assistant_ids,
                    reason,
                )
            discarded_steps_restored = True
        except Exception:
            logger.exception(
                "Failed to restore discarded assistant step: game_id=%s assistant_ids=%s reason=%s",
                game.id,
                discarded_assistant_ids,
                reason,
            )
            db.rollback()

    def _purge_discarded_assistant_steps_after_success() -> None:
        nonlocal discarded_steps_purged
        if discarded_steps_purged or not discarded_assistant_ids:
            return
        discarded_steps_purged = True
        try:
            from app.services.story_undo import purge_story_graph_turn_references

            purge_story_graph_turn_references(
                db=db,
                game_id=int(game.id),
                assistant_message_ids=discarded_assistant_ids,
            )
            db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.message_id.in_(discarded_assistant_ids)))
            db.execute(sa_delete(StoryTurnImage).where(StoryTurnImage.assistant_message_id.in_(discarded_assistant_ids)))
            db.execute(
                sa_delete(StoryWorldCardChangeEvent).where(
                    StoryWorldCardChangeEvent.assistant_message_id.in_(discarded_assistant_ids)
                )
            )
            db.execute(
                sa_delete(StoryPlotCardChangeEvent).where(
                    StoryPlotCardChangeEvent.assistant_message_id.in_(discarded_assistant_ids)
                )
            )
            db.execute(sa_delete(StoryMemoryBlock).where(StoryMemoryBlock.assistant_message_id.in_(discarded_assistant_ids)))
            db.execute(
                sa_delete(StoryCharacterStateSnapshot).where(
                    StoryCharacterStateSnapshot.assistant_message_id.in_(discarded_assistant_ids)
                )
            )
            db.execute(
                sa_delete(StoryMessage).where(
                    StoryMessage.game_id == game.id,
                    StoryMessage.id.in_(discarded_assistant_ids),
                    StoryMessage.undone_at.is_not(None),
                )
            )
            deps.touch_story_game(game)
            commit_with_retry(db)
        except Exception:
            logger.exception(
                "Failed to purge discarded assistant step after replacement: game_id=%s assistant_ids=%s",
                game.id,
                discarded_assistant_ids,
            )
            db.rollback()

    variant_log_finalized = False

    def _finalize_story_message_variant_log() -> None:
        # Append this attempt's final text onto the chronological reroll log (carried from any
        # earlier discarded attempts of this same turn) and mark it active, so the player can
        # browse back through every reroll variant via the message carousel.
        nonlocal variant_log_finalized
        if variant_log_finalized or assistant_message is None:
            return
        variant_log_finalized = True
        if not reroll_carried_variant_history:
            return
        try:
            full_log = _append_story_message_variant_log_entry(assistant_message, reroll_carried_variant_history)
            assistant_message.variant_history_json = json.dumps(full_log, ensure_ascii=False)
            assistant_message.active_variant_index = max(len(full_log) - 1, 0)
            commit_with_retry(db)
        except Exception:
            logger.exception(
                "Failed to finalize story message variant log: game_id=%s assistant_message_id=%s",
                game.id,
                getattr(assistant_message, "id", None),
            )
            db.rollback()

    try:
        for stream_attempt in range(len(STORY_STREAM_RETRY_DELAYS_SECONDS) + 1):
            try:
                def _provider_chunks():
                    return deps.stream_story_provider_chunks(
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
                        reroll_discarded_assistant_text=reroll_discarded_assistant_text,
                        show_gg_thoughts=show_gg_thoughts,
                        show_npc_thoughts=show_npc_thoughts,
                        story_generation_game_id=int(game.id),
                        story_generation_id=story_generation_id,
                        raw_output_collector=stream_runtime_meta,
                    )

                for chunk in _iter_story_provider_chunks_with_heartbeat(
                    chunk_iter_factory=_provider_chunks,
                    game_id=int(game.id),
                    story_generation_id=story_generation_id,
                ):
                    if chunk is _STORY_PROVIDER_HEARTBEAT:
                        yield _sse_keepalive()
                        continue
                    produced += chunk
                    current_time = time.monotonic()
                    if (
                        len(produced) - persisted_length >= persist_min_chars
                        or current_time - last_persisted_at >= persist_max_interval_seconds
                    ):
                        assistant_message.content = produced
                        try:
                            commit_with_retry(db)
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
                    if not visual_novel_enabled:
                        yield _sse_event("chunk", {"assistant_message_id": assistant_message.id, "delta": chunk})
                break
            except (GeneratorExit, StoryGenerationCancelled):
                raise
            except Exception as exc:
                if _stop_requested("provider_retry", rollback=True):
                    raise StoryGenerationCancelled("Story generation cancelled") from exc
                can_retry = (
                    stream_attempt < len(STORY_STREAM_RETRY_DELAYS_SECONDS)
                    and not produced
                    and is_retryable_provider_error(exc)
                )
                if not can_retry:
                    raise
                retry_delay = STORY_STREAM_RETRY_DELAYS_SECONDS[stream_attempt]
                logger.warning(
                    "Story provider failed before producing text; silently retrying full turn: "
                    "game_id=%s assistant_message_id=%s model=%s attempt=%s next_attempt=%s delay=%.1fs error=%s",
                    game.id,
                    assistant_message.id,
                    story_model_name,
                    stream_attempt + 1,
                    stream_attempt + 2,
                    retry_delay,
                    exc,
                )
                produced = ""
                stream_runtime_meta.clear()
                persisted_length = 0
                last_persisted_at = time.monotonic()
                assistant_message.content = ""
                deps.touch_story_game(game)
                try:
                    commit_with_retry(db)
                except Exception:
                    logger.warning(
                        "Failed to clear partial story checkpoint before provider retry: "
                        "game_id=%s assistant_message_id=%s",
                        game.id,
                        assistant_message.id,
                        exc_info=True,
                    )
                    db.rollback()
                yield _sse_event(
                    "retry",
                    {
                        "assistant_message_id": assistant_message.id,
                        "attempt": stream_attempt + 2,
                        "max_attempts": len(STORY_STREAM_RETRY_DELAYS_SECONDS) + 1,
                    },
                )
                time.sleep(retry_delay)
    except GeneratorExit:
        cancel_story_generation(int(game.id))
        aborted = True
        stream_error = stream_error or "stream cancelled by client"
    except StoryGenerationCancelled:
        aborted = True
        stream_error = stream_error or "stream cancelled by client"
    except Exception as exc:
        stream_error = str(exc)
        logger.exception("Story generation failed")
        db.rollback()
        error_detail = _public_story_error_detail(exc)
        try:
            if assistant_message is not None:
                db.delete(assistant_message)
            deps.touch_story_game(game)
            commit_with_retry(db)
            try:
                db.refresh(user)
            except Exception:
                pass
        except Exception:
            logger.exception(
                "Failed to clean up failed story stream: game_id=%s assistant_message_id=%s",
                game.id,
                getattr(assistant_message, "id", None),
            )
            db.rollback()
        _restore_discarded_assistant_steps("provider_failed")
        yield _sse_event("error", {"detail": error_detail})
        return

    if visual_novel_enabled and produced and not aborted:
        public_stream_text = strip_story_novel_scene_cast_metadata(produced)
        if public_stream_text:
            # VN cast metadata can be split across arbitrary provider chunks.  Buffer the
            # admin-only VN response and emit one clean public chunk once the provider finishes
            # instead of ever leaking a partial ``{{VN_CAST...}}`` marker to the client.
            yield _sse_event(
                "chunk",
                {"assistant_message_id": assistant_message.id, "delta": public_stream_text},
            )

    if not aborted and _stop_requested("provider_complete"):
        aborted = True

    if aborted:
        if discarded_assistant_ids:
            try:
                if assistant_message is not None:
                    db.delete(assistant_message)
                deps.touch_story_game(game)
                commit_with_retry(db)
            except Exception:
                logger.exception(
                    "Failed to remove cancelled replacement assistant: game_id=%s assistant_message_id=%s",
                    game.id,
                    getattr(assistant_message, "id", None),
                )
                db.rollback()
            _restore_discarded_assistant_steps("replacement_cancelled")
        else:
            _persist_cancelled_output()
        return

    if assistant_message is not None:
        yield _sse_event("progress", {"assistant_message_id": assistant_message.id, "stage": "finalizing"})
        if _stop_requested("finalizing"):
            _persist_cancelled_output()
            return

    # Preserve correct provider output byte-for-byte apart from the lossless markup cleanup.
    # Only an explicit strict-contract violation (obvious unmarked speech or a forbidden
    # generic speaker label) enters the existing model-assisted repair path.
    normalized_output = _sanitize_streamed_story_markup(
        produced,
        normalize_generated_story_output=getattr(deps, "normalize_generated_story_output", None),
        world_cards=world_cards,
        model_name=story_model_name,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )

    try:
        assistant_message.content = normalized_output
        deps.touch_story_game(game)
        commit_with_retry(db)
        db.refresh(assistant_message)
    except Exception as exc:
        logger.exception("Failed to finalize generated story message")
        db.rollback()
        if not aborted:
            stream_error = stream_error or str(exc)
            _restore_discarded_assistant_steps("message_finalize_failed")
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    if _stop_requested("message_finalized"):
        return

    response_has_content = bool(normalized_output.strip() or produced.strip())
    if not response_has_content:
        try:
            if assistant_message is not None:
                db.delete(assistant_message)
            deps.touch_story_game(game)
            commit_with_retry(db)
        except Exception:
            logger.exception(
                "Failed to clean up empty story stream: game_id=%s assistant_message_id=%s",
                game.id,
                getattr(assistant_message, "id", None),
            )
            db.rollback()
        _restore_discarded_assistant_steps("empty_response")
        yield _sse_event("error", {"detail": "RouterAI returned an empty story response"})
        return

    novel_beats_payload: list[dict[str, Any]] = []
    if visual_novel_enabled and not aborted and response_has_content:
        yield _sse_event("progress", {"assistant_message_id": assistant_message.id, "stage": "visual_novel"})
        if _stop_requested("visual_novel"):
            return
        try:
            novel_beats_payload = _materialize_story_novel_beats_for_stream(
                db=db,
                game=game,
                assistant_message=assistant_message,
                raw_response=normalized_output,
                world_cards=[card for card in all_world_cards if isinstance(card, StoryWorldCard)],
                touch_story_game=deps.touch_story_game,
            )
            normalized_output = str(getattr(assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
        except Exception as exc:
            logger.exception(
                "Failed to materialize visual novel beats: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            db.rollback()
            try:
                db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.message_id == assistant_message.id))
                db.delete(assistant_message)
                deps.touch_story_game(game)
                commit_with_retry(db)
            except Exception:
                logger.exception(
                    "Failed to clean up assistant after Visual Novel materialization failure: "
                    "game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
                db.rollback()
            _restore_discarded_assistant_steps("visual_novel_materialization_failed")
            yield _sse_event(
                "error",
                {"detail": STORY_VISUAL_NOVEL_MATERIALIZATION_ERROR_DETAIL},
            )
            return

        if not novel_beats_payload:
            # Defensive invariant: a non-empty VN response must never reach either done path
            # without at least one renderable page, even if a future helper regresses silently.
            logger.error(
                "Visual Novel materialization returned no pages: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            yield _sse_event(
                "error",
                {"detail": STORY_VISUAL_NOVEL_MATERIALIZATION_ERROR_DETAIL},
            )
            return

        if _stop_requested("visual_novel_persist", rollback=True):
            return

    if _stop_requested("before_billing"):
        return

    if is_subscription_turn:
        # Consume one daily turn (the authoritative atomic guard) instead of charging sols for
        # the base model cost. Module surcharges, if any, are still charged below.
        try:
            from app.services.subscriptions import try_consume_subscription_turn

            if not try_consume_subscription_turn(
                db,
                user_id=int(user.id),
                daily_turn_limit=int(subscription_daily_turn_limit),
                period_start=str(subscription_period_start),
            ):
                db.rollback()
                if assistant_message is not None:
                    db.delete(assistant_message)
                deps.touch_story_game(game)
                commit_with_retry(db)
                _restore_discarded_assistant_steps("subscription_daily_limit")
                yield _sse_event(
                    "error",
                    {"detail": "Дневной лимит ходов по подписке исчерпан"},
                )
                return
            commit_with_retry(db)
            db.refresh(user)
        except Exception as exc:
            logger.exception(
                "Failed to consume subscription turn: game_id=%s user_id=%s",
                game.id,
                user.id,
            )
            db.rollback()
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
            return

    if turn_cost_tokens > 0:
        try:
            if not deps.spend_user_tokens_if_sufficient(db, int(user.id), turn_cost_tokens):
                db.rollback()
                if assistant_message is not None:
                    db.delete(assistant_message)
                deps.touch_story_game(game)
                commit_with_retry(db)
                _restore_discarded_assistant_steps("billing_insufficient")
                yield _sse_event("error", {"detail": "Недостаточно солов для хода"})
                return
            commit_with_retry(db)
            db.refresh(user)
        except Exception as exc:
            logger.exception(
                "Failed to charge successful story turn: game_id=%s user_id=%s tokens=%s",
                game.id,
                user.id,
                turn_cost_tokens,
            )
            db.rollback()
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
            return

    if _stop_requested("after_billing"):
        return

    assistant_text_for_postprocess = _normalize_story_message_content(getattr(assistant_message, "content", None))
    if not assistant_text_for_postprocess:
        assistant_text_for_postprocess = normalized_output.strip()
    if not assistant_text_for_postprocess:
        assistant_text_for_postprocess = produced.strip()

    assistant_text_for_memory = assistant_text_for_postprocess
    if _should_use_english_memory_source(story_model_name):
        raw_output_candidate = str(stream_runtime_meta.get("raw_output") or "").replace("\r\n", "\n").strip()
        if raw_output_candidate:
            if raw_output_candidate:
                assistant_text_for_memory = raw_output_candidate

    raw_memory_checkpointed = False
    if not aborted and response_has_content:
        if _stop_requested("raw_memory_checkpoint"):
            return
        raw_memory_checkpointed = _checkpoint_story_raw_turn_memory(
            deps=deps,
            db=db,
            game=game,
            assistant_message=assistant_message,
            latest_user_prompt=prompt,
            latest_assistant_text=assistant_text_for_memory,
            memory_optimization_enabled=memory_optimization_enabled,
        )
        if _stop_requested("raw_memory_checkpoint_complete", rollback=True):
            return
        if memory_optimization_enabled and not raw_memory_checkpointed:
            logger.warning(
                "Story raw-memory checkpoint unavailable before post-process: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

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
    # Единый жёсткий бюджет на ВСЕ Gemini-вызовы хода: Call A «Мир», Call B «Персонажи»,
    # сжатие памяти и граф тянут запросы из одного счётчика. Это и есть потолок ≤5 на ход.
    service_request_budget = StoryServiceHttpRequestBudget(
        max_requests=STORY_MEMORY_POSTPROCESS_MAX_SERVICE_REQUESTS
    )
    graph_request_budget = StoryServiceHttpRequestBudget(
        max_requests=STORY_GRAPH_MAX_SERVICE_REQUESTS
    )
    if not aborted and response_has_content:
        yield _sse_event("progress", {"assistant_message_id": assistant_message.id, "stage": "postprocess"})
        if _stop_requested("postprocess"):
            return
        try:
            with use_story_service_http_request_budget(service_request_budget):
                unified_postprocess_payload = deps.resolve_story_turn_postprocess_payload(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=prompt,
                    latest_assistant_text=assistant_text_for_memory,
                    world_cards=world_cards,
                    raw_memory_enabled=False,
                    location_enabled=True,
                    environment_enabled=_resolve_story_environment_runtime_flags(game)[0],
                    character_state_enabled=bool(getattr(game, "character_state_enabled", None)),
                    important_event_enabled=True,
                    ambient_enabled=ambient_enabled,
                    auto_npc_cards_enabled=bool(getattr(game, "auto_npc_cards_enabled", False)),
                )
            if _stop_requested("postprocess_resolved", rollback=True):
                return
        except Exception:
            logger.exception(
                "Failed to resolve unified story post-process payload: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            unified_postprocess_payload = None

    if _stop_requested("before_postprocess_apply", rollback=True):
        return

    ambient_payload: dict[str, Any] | None = None
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

    if not aborted and response_has_content:
        logger.info(
            "Story post-process dispatch (inline): game_id=%s assistant_message_id=%s memory_optimization_enabled=%s",
            game.id,
            assistant_message.id,
            memory_optimization_enabled,
        )
        yield _sse_event("progress", {"assistant_message_id": assistant_message.id, "stage": "memory_sync"})
        if _stop_requested("memory_sync"):
            return
        plot_card_created = False
        postprocess_pending = False
        postprocess_failed = False
        postprocess_status = STORY_POSTPROCESS_STATUS_COMMITTED
        postprocess_failed_modules: list[str] = []
        graph_analysis_result: dict[str, Any] | None = None

        def _assistant_has_memory_block(items: list[Any]) -> bool:
            for item in items:
                if isinstance(item, dict):
                    assistant_message_id = item.get("assistant_message_id")
                    layer_value = str(item.get("layer", "") or "").strip().lower()
                else:
                    assistant_message_id = getattr(item, "assistant_message_id", None)
                    layer_value = str(getattr(item, "layer", "") or "").strip().lower()
                if layer_value not in {"raw", "latest_full", "fresh_detailed", "compressed", "facts", "raw_pending", "super"}:
                    continue
                if int(assistant_message_id or 0) == assistant_message.id:
                    return True
            return False

        try:
            with use_story_service_http_request_budget(service_request_budget):
                postprocess_result = deps.upsert_story_plot_memory_card(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt_override=prompt,
                    latest_assistant_text_override=assistant_text_for_memory,
                    resolved_postprocess_payload_override=unified_postprocess_payload,
                    memory_optimization_enabled=memory_optimization_enabled,
                    allow_model_postprocess_request=True,
                )
                if _stop_requested("memory_sync_resolved", rollback=True):
                    return
                plot_card_created, _generated_plot_events, postprocess_meta = _normalize_story_postprocess_result(
                    postprocess_result
                )
                raw_failed_modules = postprocess_meta.get("postprocess_failed_modules")
                if isinstance(raw_failed_modules, list):
                    postprocess_failed_modules.extend(
                        str(module_name)
                        for module_name in raw_failed_modules
                        if str(module_name or "").strip()
                    )
                elif isinstance(raw_failed_modules, str) and raw_failed_modules.strip():
                    postprocess_failed_modules.append(raw_failed_modules.strip())
                postprocess_failed = bool(postprocess_meta.get("postprocess_failed")) or bool(postprocess_failed_modules)
                postprocess_pending = bool(postprocess_meta.get("postprocess_pending")) or postprocess_failed
                raw_postprocess_status = str(postprocess_meta.get("postprocess_status") or "").strip()
                if raw_postprocess_status:
                    postprocess_status = raw_postprocess_status
            commit_with_retry(db)
            if _stop_requested("memory_sync_committed"):
                return
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
                plot_memory_payload = {
                    "assistant_message_id": assistant_message.id,
                    "plot_card_events": [],
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
            postprocess_pending = True
            postprocess_failed_modules.append("memory_sync")
            postprocess_status = STORY_POSTPROCESS_STATUS_FAILED_RETRYABLE

        graph_enabled = bool(getattr(game, "auto_graph_nodes_enabled", False)) or bool(
            getattr(game, "auto_graph_edges_enabled", False)
        )
        if graph_enabled:
            yield _sse_event("progress", {"assistant_message_id": assistant_message.id, "stage": "graph_sync"})
            if _stop_requested("graph_sync"):
                return
            try:
                from app.services.story_graph import analyze_story_graph_after_turn

                with use_story_service_http_request_budget(graph_request_budget):
                    graph_analysis_result = analyze_story_graph_after_turn(
                        db=db,
                        game=game,
                        latest_user_prompt=prompt,
                        latest_assistant_text=assistant_text_for_postprocess,
                        assistant_message_id=int(assistant_message.id),
                        apply_high_confidence=True,
                        confidence_threshold=getattr(game, "graph_auto_apply_confidence", None),
                        confirm_low_confidence=getattr(game, "graph_confirm_low_confidence", None),
                        allow_model_request=True,
                        allow_node_actions=bool(getattr(game, "auto_graph_nodes_enabled", False)),
                        allow_edge_actions=bool(getattr(game, "auto_graph_edges_enabled", False)),
                    )
                if _stop_requested("graph_sync_resolved", rollback=True):
                    return
                commit_with_retry(db)
            except Exception as exc:
                logger.exception(
                    "Story graph post-process failed independently: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
                db.rollback()
                graph_analysis_result = {
                    "applied_cards": 0,
                    "applied_nodes": 0,
                    "applied_edges": 0,
                    "updated_edges": 0,
                    "suggestions_created": 0,
                    "skipped": ["graph analysis failed"],
                    "error": str(exc).strip()[:500],
                }
                try:
                    from app.models import StoryGraphEvent

                    db.add(
                        StoryGraphEvent(
                            game_id=int(game.id),
                            assistant_message_id=int(assistant_message.id),
                            event_type="analysis_failed",
                            message="Gemini graph analysis failed",
                            payload=json.dumps(
                                {"error": str(exc).strip()[:1_000]},
                                ensure_ascii=False,
                            ),
                        )
                    )
                    commit_with_retry(db)
                except Exception:
                    logger.exception(
                        "Failed to persist story graph error event: game_id=%s assistant_message_id=%s",
                        game.id,
                        assistant_message.id,
                    )
                    db.rollback()

        actual_graph_cost_tokens = 0
        if graph_enabled and int(graph_request_budget.used_requests or 0) > 0:
            actual_graph_cost_tokens = max(
                1,
                min(int(graph_request_budget.used_requests or 0), STORY_GRAPH_MAX_SERVICE_REQUESTS),
            )
        if graph_enabled and isinstance(graph_analysis_result, dict):
            graph_analysis_result["gemini_request_count"] = actual_graph_cost_tokens
            graph_analysis_result["cost_tokens"] = actual_graph_cost_tokens
        prepaid_graph_cost_tokens = max(
            0,
            min(int(precharged_graph_cost_tokens or 0), STORY_GRAPH_MAX_SERVICE_REQUESTS),
        )
        actual_turn_cost_tokens = max(turn_cost_tokens - prepaid_graph_cost_tokens + actual_graph_cost_tokens, 0)
        if actual_turn_cost_tokens < turn_cost_tokens:
            refund_tokens = turn_cost_tokens - actual_turn_cost_tokens
            try:
                deps.add_user_tokens(db, int(user.id), int(refund_tokens))
                commit_with_retry(db)
                db.refresh(user)
                turn_cost_tokens = actual_turn_cost_tokens
            except Exception:
                logger.exception(
                    "Failed to refund unused graph AI turn cost: game_id=%s assistant_message_id=%s refund=%s",
                    game.id,
                    assistant_message.id,
                    refund_tokens,
                )
                db.rollback()

        logger.info(
            "Story service request usage: game_id=%s assistant_message_id=%s memory_gemini_requests=%s/%s graph_gemini_requests=%s/%s",
            game.id,
            assistant_message.id,
            service_request_budget.used_requests,
            service_request_budget.max_requests,
            graph_request_budget.used_requests,
            graph_request_budget.max_requests,
        )

        memory_blocks_after_postprocess = deps.list_story_memory_blocks(db, game.id)
        needs_baseline_sync = postprocess_failed or (
            memory_optimization_enabled and not _assistant_has_memory_block(memory_blocks_after_postprocess)
        )

        baseline_synced = False
        if needs_baseline_sync:
            if _stop_requested("baseline_sync"):
                return
            with use_story_service_http_request_budget(service_request_budget):
                baseline_synced = _best_effort_sync_story_turn_memory_and_environment(
                    deps=deps,
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=prompt,
                    latest_assistant_text=assistant_text_for_memory,
                    memory_optimization_enabled=memory_optimization_enabled,
                )
            if _stop_requested("baseline_sync_complete", rollback=True):
                return
        if postprocess_failed and not baseline_synced:
            logger.warning(
                "Story post-process failed and baseline sync made no changes: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
        if postprocess_failed:
            postprocess_pending = True
            if postprocess_status == STORY_POSTPROCESS_STATUS_COMMITTED:
                postprocess_status = STORY_POSTPROCESS_STATUS_FAILED_RETRYABLE
        elif postprocess_pending and postprocess_status == STORY_POSTPROCESS_STATUS_COMMITTED:
            postprocess_status = STORY_POSTPROCESS_STATUS_PENDING

        postprocess_failed_modules = sorted({module for module in postprocess_failed_modules if module})

        if _stop_requested("done_payload"):
            return

        _purge_discarded_assistant_steps_after_success()
        _finalize_story_message_variant_log()
        ai_memory_blocks_payload = _safe_dump_stream_items(
            [deps.memory_block_to_out(block) for block in deps.list_story_memory_blocks(db, game.id)]
        )
        done_payload = {
            "message": {
                "id": assistant_message.id,
                "game_id": assistant_message.game_id,
                "role": assistant_message.role,
                "content": strip_story_novel_scene_cast_metadata(assistant_message.content),
                "created_at": assistant_message.created_at.isoformat(),
                "updated_at": assistant_message.updated_at.isoformat(),
                "variant_history": [
                    {
                        "content": strip_story_novel_scene_cast_metadata(variant["content"]),
                        "created_at": variant.get("created_at") or None,
                    }
                    for variant in parse_story_message_variant_history(
                        getattr(assistant_message, "variant_history_json", None)
                    )
                ],
                "active_variant_index": int(getattr(assistant_message, "active_variant_index", 0) or 0),
            },
            "user": _serialize_story_user_payload(db, user),
            "turn_cost_tokens": turn_cost_tokens,
            "world_card_events": [],
            "plot_card_events": [],
            "plot_cards": _safe_dump_stream_items(
                [deps.plot_card_to_out(card) for card in deps.list_story_plot_cards(db, game.id)]
            ),
            "ai_memory_blocks": ai_memory_blocks_payload,
            "world_cards": _safe_dump_stream_items(
                [deps.world_card_to_out(card) for card in deps.list_story_world_cards(db, game.id)]
            ),
            "plot_card_created": plot_card_created,
            "postprocess_pending": postprocess_pending,
            "postprocess_failed": postprocess_failed,
            "postprocess_status": postprocess_status,
            "postprocess_failed_modules": postprocess_failed_modules,
            "raw_memory_checkpointed": raw_memory_checkpointed,
            "assistant_triggered_world_card_ids": [
                int(card.get("id"))
                for card in assistant_triggered_world_cards
                if isinstance(card, dict) and isinstance(card.get("id"), int)
            ],
        }
        if graph_analysis_result is not None:
            done_payload["graph_analysis"] = graph_analysis_result
        if visual_novel_enabled:
            done_payload["novel_beats"] = novel_beats_payload
        game_payload = _safe_dump_stream_item(deps.story_game_summary_to_out(game))
        if game_payload is not None:
            resolved_current_location_label = resolve_story_current_location_label(
                game_payload.get("current_location_label"),
                ai_memory_blocks_payload,
            )
            if resolved_current_location_label:
                game_payload["current_location_label"] = resolved_current_location_label
            if visual_novel_enabled:
                try:
                    current_background = _resolve_story_turn_scene_background(
                        deps,
                        db,
                        game=game,
                        location_label=resolved_current_location_label,
                        scene_text=str(getattr(assistant_message, "content", "") or ""),
                        latest_user_text=prompt,
                    )
                    commit_with_retry(db)
                    # Always report the resolved background (or None) so the client can drop to
                    # the neutral gradient when the scene has moved to an unremembered location.
                    done_payload["current_scene_background"] = (
                        _safe_dump_stream_item(story_scene_background_to_out(current_background))
                        if current_background is not None
                        else None
                    )
                except Exception:
                    logger.exception(
                        "Story scene background memory match failed: game_id=%s assistant_message_id=%s",
                        game.id,
                        assistant_message.id,
                    )
                    db.rollback()
            done_payload["game"] = game_payload
        if isinstance(ambient_payload, dict):
            done_payload["ambient"] = ambient_payload
        try:
            yield _sse_event("done", done_payload)
        except Exception as exc:
            logger.exception("Failed to emit stream done event")
            yield _sse_event("error", {"detail": _public_story_error_detail(exc)})
        return

    _purge_discarded_assistant_steps_after_success()
    _finalize_story_message_variant_log()
    ai_memory_blocks_payload = _safe_dump_stream_items(
        [deps.memory_block_to_out(block) for block in deps.list_story_memory_blocks(db, game.id)]
    )
    done_payload = {
        "message": {
            "id": assistant_message.id,
            "game_id": assistant_message.game_id,
            "role": assistant_message.role,
            "content": strip_story_novel_scene_cast_metadata(assistant_message.content),
            "created_at": assistant_message.created_at.isoformat(),
            "updated_at": assistant_message.updated_at.isoformat(),
            "variant_history": [
                {
                    "content": strip_story_novel_scene_cast_metadata(variant["content"]),
                    "created_at": variant.get("created_at") or None,
                }
                for variant in parse_story_message_variant_history(
                    getattr(assistant_message, "variant_history_json", None)
                )
            ],
            "active_variant_index": int(getattr(assistant_message, "active_variant_index", 0) or 0),
        },
        "user": _serialize_story_user_payload(db, user),
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
    if visual_novel_enabled:
        done_payload["novel_beats"] = novel_beats_payload
    game_payload = _safe_dump_stream_item(deps.story_game_summary_to_out(game))
    if game_payload is not None:
        resolved_current_location_label = resolve_story_current_location_label(
            game_payload.get("current_location_label"),
            ai_memory_blocks_payload,
        )
        if resolved_current_location_label:
            game_payload["current_location_label"] = resolved_current_location_label
        if visual_novel_enabled:
            try:
                current_background = _resolve_story_turn_scene_background(
                    deps,
                    db,
                    game=game,
                    location_label=resolved_current_location_label,
                    scene_text=str(getattr(assistant_message, "content", "") or ""),
                    latest_user_text=prompt,
                )
                commit_with_retry(db)
                # Always report the resolved background (or None) so the client can drop to the
                # neutral gradient when the scene has moved to an unremembered location.
                done_payload["current_scene_background"] = (
                    _safe_dump_stream_item(story_scene_background_to_out(current_background))
                    if current_background is not None
                    else None
                )
            except Exception:
                logger.exception(
                    "Story scene background memory match failed: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
                db.rollback()
        done_payload["game"] = game_payload
    try:
        yield _sse_event("done", done_payload)
    except Exception as exc:
        logger.exception("Failed to emit stream done event")
        yield _sse_event("error", {"detail": _public_story_error_detail(exc)})


def _generate_story_response_locked(
    *,
    deps: StoryRuntimeDeps,
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None,
    db: Session,
    as_stream: bool = False,
) -> StreamingResponse | Any:
    deps.validate_provider_config()
    user = deps.get_current_user(db, authorization)
    game = deps.get_user_story_game_or_404(db, user.id, game_id)
    story_model_name = coerce_story_llm_model(getattr(game, "story_llm_model", None))
    if payload.story_llm_model is not None:
        story_model_name = coerce_story_llm_model(payload.story_llm_model)
    # Subscription-only narrator models: gate by an active subscription (or admin test) that
    # includes the model, and by the tier's daily-turn limit. Subscription turns render as plain
    # text (no memory optimization / environment / visual novel), cap responses at 450 tokens,
    # never charge sols for the base model cost, and consume one daily turn instead.
    is_subscription_turn = story_model_name in STORY_SUBSCRIPTION_LLM_MODELS
    subscription_entitlement: dict[str, Any] | None = None
    subscription_memory_cap = 0
    if is_subscription_turn:
        from app.services.subscriptions import (
            get_daily_turns_remaining,
            get_subscription_entitlement,
        )

        subscription_entitlement = get_subscription_entitlement(db, user)
        allowed_subscription_models = (
            set(subscription_entitlement["models"]) if subscription_entitlement else set()
        )
        if story_model_name not in allowed_subscription_models:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Эта модель доступна только по активной подписке",
            )
        if get_daily_turns_remaining(user, subscription_entitlement) <= 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Дневной лимит ходов по подписке исчерпан. Лимит обновится в полночь по Москве.",
            )
        subscription_memory_cap = int(subscription_entitlement["memory_token_cap"])
    raw_memory_optimization_enabled = getattr(game, "memory_optimization_enabled", None)
    # Memory optimization is mandatory for story runtime.
    memory_optimization_enabled = True
    if bool(getattr(game, "memory_optimization_enabled", True)) is not True:
        game.memory_optimization_enabled = True
    payload_environment_enabled = getattr(payload, "environment_enabled", None)
    payload_environment_time_enabled = getattr(payload, "environment_time_enabled", None)
    payload_environment_weather_enabled = getattr(payload, "environment_weather_enabled", None)
    raw_environment_enabled = getattr(game, "environment_enabled", None)
    raw_environment_time_enabled = getattr(game, "environment_time_enabled", None)
    raw_environment_weather_enabled = getattr(game, "environment_weather_enabled", None)
    environment_enabled, environment_time_enabled, environment_weather_enabled = _resolve_story_environment_runtime_flags(
        game,
        payload_environment_enabled=payload_environment_enabled,
        payload_environment_time_enabled=payload_environment_time_enabled,
        payload_environment_weather_enabled=payload_environment_weather_enabled,
    )
    if bool(getattr(game, "environment_time_enabled", None)) != environment_time_enabled:
        game.environment_time_enabled = environment_time_enabled
    if bool(getattr(game, "environment_weather_enabled", None)) != environment_weather_enabled:
        game.environment_weather_enabled = environment_weather_enabled
    if bool(getattr(game, "environment_enabled", None)) != environment_enabled:
        game.environment_enabled = environment_enabled
    if is_subscription_turn:
        # Subscription turns never use the environment ("Место действия") module — skip it for this
        # turn without overwriting the user's stored game setting.
        environment_enabled = False
        environment_time_enabled = False
        environment_weather_enabled = False
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
    is_administrator = str(getattr(user, "role", "") or "").strip().lower() == "administrator"
    raw_ambient_enabled = getattr(game, "ambient_enabled", None)
    ambient_enabled = bool(raw_ambient_enabled)
    if payload.ambient_enabled is not None:
        ambient_enabled = bool(payload.ambient_enabled)
    if not is_administrator:
        ambient_enabled = False
    visual_novel_enabled = is_story_visual_novel_enabled(game, user)
    logger.info(
        "Story generate settings: game_id=%s memory_optimization_enabled=%s payload_override=%s game_value=%s environment_enabled=%s environment_time_enabled=%s environment_weather_enabled=%s environment_payload_override=%s environment_time_payload_override=%s environment_weather_payload_override=%s environment_game_value=%s environment_time_game_value=%s environment_weather_game_value=%s ambient_enabled=%s ambient_payload_override=%s ambient_game_value=%s visual_novel_enabled=%s",
        game.id,
        memory_optimization_enabled,
        payload.memory_optimization_enabled,
        raw_memory_optimization_enabled,
        environment_enabled,
        environment_time_enabled,
        environment_weather_enabled,
        payload_environment_enabled,
        payload_environment_time_enabled,
        payload_environment_weather_enabled,
        raw_environment_enabled,
        raw_environment_time_enabled,
        raw_environment_weather_enabled,
        ambient_enabled,
        payload.ambient_enabled,
        raw_ambient_enabled,
        visual_novel_enabled,
    )
    story_top_k = normalize_story_top_k(getattr(game, "story_top_k", None), model_name=story_model_name)
    if payload.story_top_k is not None:
        story_top_k = normalize_story_top_k(payload.story_top_k, model_name=story_model_name)
    story_top_r = normalize_story_top_r(getattr(game, "story_top_r", None), model_name=story_model_name)
    if payload.story_top_r is not None:
        story_top_r = normalize_story_top_r(payload.story_top_r, model_name=story_model_name)
    story_temperature = normalize_story_temperature(
        getattr(game, "story_temperature", None),
        model_name=story_model_name,
    )
    if payload.story_temperature is not None:
        story_temperature = normalize_story_temperature(payload.story_temperature, model_name=story_model_name)
    story_repetition_penalty = normalize_story_repetition_penalty(
        getattr(game, "story_repetition_penalty", None),
        model_name=story_model_name,
    )
    if payload.story_repetition_penalty is not None:
        story_repetition_penalty = normalize_story_repetition_penalty(
            payload.story_repetition_penalty,
            model_name=story_model_name,
        )
    raw_show_gg_thoughts = getattr(game, "show_gg_thoughts", None)
    show_gg_thoughts = False
    raw_show_npc_thoughts = getattr(game, "show_npc_thoughts", None)
    show_npc_thoughts = False if raw_show_npc_thoughts is None else bool(raw_show_npc_thoughts)
    if payload.show_npc_thoughts is not None:
        show_npc_thoughts = bool(payload.show_npc_thoughts)
    # The switchable per-game response-token limit was removed from the interface. Ignore any stored
    # value or payload override so non-subscription turns always fall back to the hidden ceiling
    # (STORY_RESPONSE_MAX_TOKENS_MAX); the admin bypass below is still honored.
    story_response_max_tokens_enabled = False
    story_response_max_tokens = normalize_story_response_max_tokens(getattr(game, "response_max_tokens", None))
    if not story_response_max_tokens_enabled:
        response_token_limit_enabled = normalize_story_response_token_limit_enabled(
            getattr(game, "response_token_limit_enabled", None)
        )
        is_response_token_limit_bypass_allowed = (
            str(getattr(user, "role", "") or "").strip().lower() == "administrator"
            and not response_token_limit_enabled
        )
        story_response_max_tokens = None if is_response_token_limit_bypass_allowed else STORY_RESPONSE_MAX_TOKENS_MAX
    context_limit_chars = deps.normalize_context_limit_chars(
        game.context_limit_chars,
        model_name=story_model_name,
    )
    if is_subscription_turn:
        # Plain continuous text: disable memory optimization, the visual novel and the emotion
        # stage (environment was already disabled above). Clamp the response to 450 tokens and the
        # scene memory to the tier cap. Toggleable modules are left as-is (they still cost sols).
        memory_optimization_enabled = False
        visual_novel_enabled = False
        ambient_enabled = False
        from app.services.subscriptions import SUBSCRIPTION_RESPONSE_MAX_TOKENS

        story_response_max_tokens = SUBSCRIPTION_RESPONSE_MAX_TOKENS
        story_response_max_tokens_enabled = True
        if subscription_memory_cap > 0:
            context_limit_chars = min(context_limit_chars, subscription_memory_cap)
    turn_cost_tokens = 0
    messages = deps.list_story_messages(db, game.id)
    discard_last_assistant_steps = max(int(payload.discard_last_assistant_steps or 0), 0)
    reroll_discarded_assistant_text: str | None = None
    instruction_cards = deps.normalize_generation_instructions(payload.instructions)
    smart_regeneration_payload = getattr(payload, "smart_regeneration", None)
    smart_regeneration_enabled = bool(getattr(smart_regeneration_payload, "enabled", False))
    smart_regeneration_mode = getattr(smart_regeneration_payload, "mode", None)
    smart_regeneration_options = list(getattr(smart_regeneration_payload, "options", []) or [])
    if smart_regeneration_enabled:
        try:
            normalize_smart_regeneration_mode(smart_regeneration_mode)
            if smart_regeneration_options:
                normalize_smart_regeneration_options(smart_regeneration_options)
        except ValueError as exc:
            logger.info(
                "Smart regeneration validation failed: game_id=%s detail=%s",
                game.id,
                str(exc),
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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
    discarded_assistant_message_ids: list[int] = []
    # Text-only snapshots of every reroll variant discarded so far this turn, oldest first.
    # Carried forward onto the replacement assistant message so the player can browse and
    # switch back to any of them; capped to avoid unbounded growth from repeated rerolls.
    reroll_carried_variant_history: list[dict[str, str]] = []
    reroll_carried_variant_anchor_user_message_id: int | None = None

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
            first_assistant_text = _normalize_story_message_content(getattr(first_assistant_message, "content", None))
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

    def _ensure_user_can_afford_turn(turn_cost: int) -> None:
        if turn_cost <= 0:
            return
        try:
            db.refresh(user)
        except Exception:
            pass
        if int(getattr(user, "coins", 0) or 0) >= int(turn_cost):
            return
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Недостаточно солов для хода",
        )

    def _drop_last_assistant_steps(
        *,
        steps: int,
        delete_source_user: bool,
        action_label: str,
    ) -> list[StoryMessage]:
        nonlocal reroll_discarded_assistant_text
        nonlocal discarded_assistant_message_ids
        nonlocal reroll_carried_variant_history
        nonlocal reroll_carried_variant_anchor_user_message_id
        if steps <= 0:
            return deps.list_story_messages(db, game.id)

        if steps != 1:
            # Variant carry-forward only makes sense for a single-step reroll of the immediate
            # last response; multi-step rollback (editing an older turn) is a different action.
            reroll_carried_variant_history = []
            reroll_carried_variant_anchor_user_message_id = None

        for _ in range(steps):
            current_messages = deps.list_story_messages(db, game.id)
            if not current_messages:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to rollback")

            last_message = current_messages[-1]
            if last_message.role != deps.story_assistant_role:
                return current_messages

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
                    purge_events=False,
                    touch_game=False,
                )
                if reroll_discarded_assistant_text is None:
                    discarded_text = _normalize_story_message_content(getattr(last_message, "content", None))
                    if discarded_text:
                        reroll_discarded_assistant_text = discarded_text
                if steps == 1:
                    reroll_carried_variant_history = _snapshot_discarded_story_message_log(last_message)
                    reroll_carried_variant_anchor_user_message_id = int(source_user_message_for_step.id)
                last_message.undone_at = datetime.now(timezone.utc)
                discarded_assistant_message_ids.append(int(last_message.id))
                if delete_source_user:
                    source_user_message_for_step.undone_at = datetime.now(timezone.utc)
                clear_canonical_state_payload(game)
                deps.touch_story_game(game)
                commit_with_retry(db)
            except HTTPException:
                db.rollback()
                raise
            except Exception as exc:
                db.rollback()
                if is_database_busy_session_error(exc):
                    logger.warning(
                        "Story %s delayed by busy storage after retries: game_id=%s assistant_message_id=%s",
                        action_label,
                        game.id,
                        last_message.id,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=STORY_GAME_OPERATION_BUSY_DETAIL,
                    ) from exc
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
                from app.services.story_undo import purge_story_graph_turn_references

                purge_story_graph_turn_references(
                    db=db,
                    game_id=int(game.id),
                    assistant_message_ids=undone_message_ids,
                )
                db.execute(
                    sa_delete(StoryNovelBeat).where(
                        StoryNovelBeat.message_id.in_(undone_message_ids),
                    )
                )
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
            commit_with_retry(db)
        except Exception as exc:
            db.rollback()
            if is_database_busy_session_error(exc):
                logger.warning(
                    "Story purge undone delayed by busy storage after retries: game_id=%s action=%s",
                    game.id,
                    action_label,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=STORY_GAME_OPERATION_BUSY_DETAIL,
                ) from exc
            logger.exception(
                "Failed to purge undone story steps for %s: game_id=%s",
                action_label,
                game.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to purge undone steps for {action_label}: {_public_story_error_detail(exc)}",
            ) from exc

    def _restore_latest_undone_assistant_for_reroll_if_needed(current_messages: list[StoryMessage]) -> bool:
        try:
            return _restore_latest_undone_assistant_response_if_orphaned(
                deps=deps,
                db=db,
                game=game,
                current_messages=current_messages,
                reason="reroll_prepare",
            )
        except Exception as exc:
            db.rollback()
            if is_database_busy_session_error(exc):
                logger.warning(
                    "Story reroll repair delayed by busy storage after retries: game_id=%s",
                    game.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=STORY_GAME_OPERATION_BUSY_DETAIL,
                ) from exc
            logger.exception(
                "Failed to restore orphaned assistant response before reroll: game_id=%s",
                game.id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to repair reroll state: {_public_story_error_detail(exc)}",
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

        if _restore_latest_undone_assistant_for_reroll_if_needed(messages):
            messages = deps.list_story_messages(db, game.id)

        _purge_undone_story_steps(action_label="reroll")
        messages = deps.list_story_messages(db, game.id)
        last_message = messages[-1] if messages else None
        if last_message is not None and last_message.role == deps.story_assistant_role:
            messages = _drop_last_assistant_steps(
                steps=1,
                delete_source_user=False,
                action_label="reroll",
            )

        messages = deps.list_story_messages(db, game.id)
        source_user_message = next((message for message in reversed(messages) if message.role == deps.story_user_role), None)
        if source_user_message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No user prompt found for reroll")

        prompt_text = _normalize_story_message_content(getattr(source_user_message, "content", None))
    else:
        if discard_last_assistant_steps > 0:
            messages = _drop_last_assistant_steps(
                steps=discard_last_assistant_steps,
                delete_source_user=False,
                action_label="rollback",
            )
        else:
            # A genuinely new turn (not a reroll retry): the previous response is now settled
            # as permanent history, so its reroll variant scratch space can be cleared.
            settled_assistant_message = messages[-1] if messages else None
            if (
                settled_assistant_message is not None
                and settled_assistant_message.role == deps.story_assistant_role
                and parse_story_message_variant_history(
                    getattr(settled_assistant_message, "variant_history_json", None)
                )
            ):
                settled_assistant_message.variant_history_json = "[]"
                settled_assistant_message.active_variant_index = 0
                commit_with_retry(db)
        if payload.prompt is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt is required")
        prompt_text = deps.normalize_text(payload.prompt)
        source_user_message = next(
            (
                message
                for message in reversed(messages)
                if message.role == deps.story_user_role
                and _normalize_story_message_content(getattr(message, "content", None)) == prompt_text
            ),
            None,
        )
        if source_user_message is None:
            source_user_message = StoryMessage(
                game_id=game.id,
                role=deps.story_user_role,
                content=prompt_text,
            )
            db.add(source_user_message)
            db.flush()
        if game.title == deps.story_default_title:
            game.title = deps.derive_story_title(prompt_text)
        deps.touch_story_game(game)
        if (
            reroll_carried_variant_anchor_user_message_id is None
            or source_user_message.id != reroll_carried_variant_anchor_user_message_id
        ):
            # The resolved prompt turned out not to be a same-turn reroll (e.g. an edited or
            # brand-new prompt after an unrelated rollback) -- don't carry stale variant text.
            reroll_carried_variant_history = []

    billing_instruction_cards = list(instruction_cards)

    try:
        smart_instruction_card = build_smart_regeneration_instruction_card(
            getattr(payload, "smart_regeneration", None),
            previous_assistant_text=reroll_discarded_assistant_text,
        )
    except ValueError as exc:
        logger.info(
            "Smart regeneration validation failed: game_id=%s detail=%s",
            game.id,
            str(exc),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if smart_instruction_card is not None:
        instruction_cards = [smart_instruction_card, *instruction_cards]
        logger.info(
            "Smart regeneration enabled: game_id=%s mode=%s options=%s instruction_chars=%s",
            game.id,
            str(getattr(payload.smart_regeneration, "mode", None) or "new_variant"),
            list(getattr(payload.smart_regeneration, "options", []) or []),
            len(str(smart_instruction_card.get("content", ""))),
        )

    world_cards = _order_story_world_cards_for_active_main_hero(
        game,
        deps.list_story_world_cards(db, game.id),
    )
    context_messages = deps.list_story_messages(db, game.id)
    active_world_cards = deps.select_story_world_cards_for_prompt(context_messages, world_cards)
    early_triggered_world_cards: list[dict[str, Any]] = []
    source_user_prompt = _normalize_story_message_content(
        getattr(source_user_message, "content", None) if source_user_message is not None else None
    )
    if source_user_prompt:
        early_triggered_world_cards = deps.select_story_world_cards_triggered_by_text(
            source_user_prompt,
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
    is_continue_turn = bool(getattr(payload, "is_continue", False))
    model_prompt_text = STORY_CONTINUE_MODEL_PROMPT if is_continue_turn else prompt_text
    provider_context_messages = (
        _with_latest_user_prompt_override(context_messages, STORY_CONTINUE_MODEL_PROMPT)
        if is_continue_turn
        else context_messages
    )
    effective_instruction_cards = instruction_cards
    if is_continue_turn:
        effective_instruction_cards = [dict(STORY_CONTINUE_INSTRUCTION_CARD), *effective_instruction_cards]
    canonical_pipeline_enabled = bool(settings.enable_canonical_state_pipeline) and bool(
        getattr(game, "canonical_state_pipeline_enabled", True)
    )
    if canonical_pipeline_enabled:
        try:
            canonical_prompt = build_canonical_generation_prompt(
                player_text=model_prompt_text,
                game=game,
                world_cards=active_world_cards,
                context_messages=provider_context_messages,
            )
            if canonical_prompt:
                effective_instruction_cards = [
                    {
                        "title": "Canonical State V1",
                        "content": canonical_prompt,
                        "source_kind": "canonical",
                    },
                    *instruction_cards,
                ]
        except Exception:
            logger.exception("Canonical state prompt card failed; continuing with legacy instruction cards")
    if visual_novel_enabled:
        visual_novel_instruction_card = build_story_novel_instruction_card()
        effective_instruction_cards = [*effective_instruction_cards, visual_novel_instruction_card]
    try:
        from app.services.story_graph import build_story_graph_context_instruction

        graph_context_instruction = build_story_graph_context_instruction(
            db,
            game,
            context_messages=provider_context_messages,
            world_cards=active_world_cards,
            plot_cards=active_plot_cards,
            instruction_cards=instruction_cards,
        )
        if graph_context_instruction:
            graph_instruction_card = {
                "title": "Граф связей карточек",
                "content": graph_context_instruction,
                "source_kind": "graph",
            }
            effective_instruction_cards = [*effective_instruction_cards, graph_instruction_card]
            logger.info(
                "Story graph context attached: game_id=%s chars=%s",
                game.id,
                len(graph_context_instruction),
            )
    except Exception:
        logger.exception("Story graph context build failed; continuing without graph context: game_id=%s", game.id)
    turn_cost_tokens = _calculate_story_turn_cost_tokens(
        get_story_turn_cost_tokens=deps.get_story_turn_cost_tokens,
        context_limit_tokens=context_limit_chars,
        model_name=story_model_name,
        context_messages=provider_context_messages,
        instruction_cards=billing_instruction_cards,
        plot_cards=active_plot_cards,
        world_cards=active_world_cards,
        memory_optimization_enabled=memory_optimization_enabled,
        accelerated_service_enabled=bool(getattr(game, "accelerated_service_enabled", False)),
    )
    if is_subscription_turn:
        # The base model cost is covered by the subscription — a daily turn is consumed at billing
        # instead. Toggleable modules below still add their sol surcharge.
        turn_cost_tokens = 0
    graph_enabled_for_billing = bool(getattr(game, "auto_graph_nodes_enabled", False)) or bool(
        getattr(game, "auto_graph_edges_enabled", False)
    )
    precharged_graph_cost_tokens = STORY_GRAPH_MAX_SERVICE_REQUESTS if graph_enabled_for_billing else 0
    turn_cost_tokens += _calculate_story_service_surcharge_tokens(
        environment_time_enabled=environment_time_enabled,
        character_state_enabled=bool(getattr(game, "character_state_enabled", None)),
        auto_npc_cards_enabled=bool(getattr(game, "auto_npc_cards_enabled", False)),
        graph_enabled=graph_enabled_for_billing,
        graph_request_cost_tokens=precharged_graph_cost_tokens,
    )
    _ensure_user_can_afford_turn(turn_cost_tokens)
    db.commit()
    if source_user_message is not None:
        db.refresh(source_user_message)
    db.refresh(user)
    assistant_turn_index = (
        len([message for message in context_messages if message.role == deps.story_assistant_role]) + 1
    )
    story_generation_id = uuid4().hex
    mark_story_generation_started(int(game.id), story_generation_id)
    stream = _stream_story_response(
        deps=deps,
        db=db,
        game=game,
        user=user,
        turn_cost_tokens=turn_cost_tokens,
        source_user_message=source_user_message,
        prompt=model_prompt_text,
        turn_index=assistant_turn_index,
        context_messages=provider_context_messages,
        instruction_cards=effective_instruction_cards,
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
        reroll_discarded_assistant_text=reroll_discarded_assistant_text,
        reroll_carried_variant_history=reroll_carried_variant_history,
        ambient_enabled=ambient_enabled,
        visual_novel_enabled=visual_novel_enabled,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
        story_generation_id=story_generation_id,
        precharged_graph_cost_tokens=precharged_graph_cost_tokens,
        discarded_assistant_message_ids=discarded_assistant_message_ids,
        is_subscription_turn=is_subscription_turn,
        subscription_daily_turn_limit=(
            int(subscription_entitlement["daily_turn_limit"]) if subscription_entitlement else 0
        ),
        subscription_period_start=(
            str(subscription_entitlement["period_start"]) if subscription_entitlement else ""
        ),
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
        finally:
            mark_story_generation_finished(int(game.id), story_generation_id)

    if as_stream:
        return _safe_stream()

    return StreamingResponse(
        _safe_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
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
    locked_game_id = int(game_id or 0)
    _ = db

    def _streaming_entry():
        stop_event = Event()
        queue: Queue[tuple[str, Any]] = Queue()

        def _repair_orphaned_reroll_after_prepare_failure(worker_db: Session, reason: str) -> None:
            if not bool(getattr(payload, "reroll_last_response", False)):
                return
            try:
                worker_db.rollback()
            except Exception:
                pass
            try:
                repair_user = deps.get_current_user(worker_db, authorization)
                repair_game = deps.get_user_story_game_or_404(worker_db, repair_user.id, locked_game_id)
                _restore_latest_undone_assistant_response_if_orphaned(
                    deps=deps,
                    db=worker_db,
                    game=repair_game,
                    reason=reason,
                )
            except Exception:
                logger.exception(
                    "Failed to repair orphaned reroll state after generate prepare failure: game_id=%s reason=%s",
                    locked_game_id,
                    reason,
                )
                try:
                    worker_db.rollback()
                except Exception:
                    pass

        def _worker() -> None:
            operation_lease = None
            worker_db = SessionLocal()
            stream_iterator = None
            try:
                try:
                    worker_db.rollback()
                except Exception:
                    logger.exception(
                        "Failed to release DB transaction before story generate lock wait: game_id=%s",
                        locked_game_id,
                    )

                wait_iterator = _wait_for_story_generate_operation_lease(locked_game_id, stop_event)
                while True:
                    if stop_event.is_set():
                        raise StoryGenerationCancelled("Story generation stream was closed before start")
                    try:
                        wait_chunk = next(wait_iterator)
                    except StopIteration as stop:
                        operation_lease = stop.value
                        break
                    queue.put(("chunk", wait_chunk))

                if stop_event.is_set():
                    raise StoryGenerationCancelled("Story generation stream was closed before preparation")

                stream = _generate_story_response_locked(
                    deps=deps,
                    game_id=game_id,
                    payload=payload,
                    authorization=authorization,
                    db=worker_db,
                    as_stream=True,
                )
                stream_iterator = iter(stream)
                for chunk in stream_iterator:
                    if stop_event.is_set():
                        cancel_story_generation_or_next(locked_game_id)
                        raise StoryGenerationCancelled("Story generation stream was closed")
                    queue.put(("chunk", chunk))
            except StoryGenerationCancelled:
                logger.info("Story generate worker stopped after cancellation: game_id=%s", locked_game_id)
            except HTTPException as exc:
                logger.warning(
                    "Story generate request failed inside stream worker: game_id=%s status=%s detail=%s",
                    locked_game_id,
                    exc.status_code,
                    str(getattr(exc, "detail", "") or "").strip() or "n/a",
                )
                _repair_orphaned_reroll_after_prepare_failure(worker_db, "prepare_http_error")
                queue.put(
                    (
                        "chunk",
                        _sse_event(
                            "error",
                            {"detail": str(getattr(exc, "detail", "") or "") or "Story generation failed"},
                        ),
                    )
                )
            except Exception as exc:
                logger.exception("Unhandled story generate stream worker failure: game_id=%s", locked_game_id)
                _repair_orphaned_reroll_after_prepare_failure(worker_db, "prepare_unhandled_error")
                queue.put(("chunk", _sse_event("error", {"detail": _public_story_error_detail(exc)})))
            finally:
                if stop_event.is_set() and stream_iterator is not None:
                    try:
                        close_stream = getattr(stream_iterator, "close", None)
                        if callable(close_stream):
                            close_stream()
                    except Exception:
                        logger.debug("Failed to close story stream iterator after cancellation", exc_info=True)
                try:
                    worker_db.rollback()
                except Exception:
                    pass
                if operation_lease is not None:
                    operation_lease.release()
                try:
                    worker_db.close()
                except Exception:
                    logger.debug("Failed to close story generate worker DB session", exc_info=True)
                queue.put(("done", None))

        worker = Thread(
            target=_worker,
            name=f"story-generate-entry-{locked_game_id}",
            daemon=True,
        )
        worker.start()

        try:
            yield _sse_stream_warmup()
            heartbeat_seconds = max(float(STORY_STREAM_RELAY_HEARTBEAT_SECONDS), 0.25)
            while True:
                try:
                    kind, value = queue.get(timeout=heartbeat_seconds)
                except Empty:
                    yield _sse_keepalive()
                    continue
                if kind == "chunk":
                    yield str(value or "")
                    continue
                if kind == "done":
                    return
        except GeneratorExit:
            stop_event.set()
            cancel_story_generation_or_next(locked_game_id)
            raise

    return StreamingResponse(
        _streaming_entry(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
