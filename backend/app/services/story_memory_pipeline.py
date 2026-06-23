from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import main as monolith_main
from app.config import POLZA_GEMINI_25_FLASH_MODEL, settings
from app.models import StoryGame, StoryMemoryBlock, StoryMessage, StoryWorldCard
from app.services.story_game_state_analysis import (
    NpcCardDedupService,
    build_world_card_context,
    normalize_match_text,
    parse_json_list,
    world_card_to_character_payload,
)
from app.services.story_llm_modules import (
    CompressedMemoryPayload,
    DetailedMemoryPayload,
    FactMemoryPayload,
    GameStateAnalysisPayload,
    ImportantMemoryPayload,
    LlmModuleService,
)
from app.services.story_memory import (
    STORY_MEMORY_LAYER_COMPRESSED as LEGACY_STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_KEY,
    STORY_MEMORY_LAYER_LOCATION,
    STORY_MEMORY_LAYER_RAW as LEGACY_STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_SUPER as LEGACY_STORY_MEMORY_LAYER_SUPER,
    STORY_MEMORY_LAYER_WEATHER,
    normalize_story_memory_block_content as _base_normalize_memory_content,
    normalize_story_memory_block_title as _base_normalize_memory_title,
    normalize_story_memory_layer as _base_normalize_memory_layer,
)
from app.services.story_memory_prompts import (
    LLM_COMPRESSED_MEMORY_PROMPT_NAME,
    LLM_DETAILED_MEMORY_PROMPT_NAME,
    LLM_FACT_MEMORY_PROMPT_NAME,
    LLM_GAME_STATE_ANALYSIS_PROMPT_NAME,
    LLM_IMPORTANT_MEMORY_PROMPT_NAME,
    build_compressed_memory_messages,
    build_detailed_memory_messages,
    build_fact_memory_messages,
    build_game_state_analysis_messages,
    build_important_memory_messages,
)
from app.services.story_queries import list_story_instruction_cards, list_story_plot_cards, list_story_world_cards
from app.services.story_service_budget import (
    StoryServiceHttpRequestBudget,
    use_story_service_http_request_budget,
)
from app.services.story_games import (
    deserialize_story_environment_datetime as _story_games_deserialize_environment_datetime,
    deserialize_story_environment_weather as _story_games_deserialize_environment_weather,
    normalize_story_environment_time_enabled as _story_games_normalize_environment_time_enabled,
    normalize_story_environment_weather_enabled as _story_games_normalize_environment_weather_enabled,
    serialize_story_environment_datetime as _story_games_serialize_environment_datetime,
    serialize_story_environment_weather as _story_games_serialize_environment_weather,
)
from app.services.story_token_budget import TokenBudgetResult, TokenBudgetService, TokenCounter
from app.services.text_encoding import repair_likely_utf8_mojibake_deep, sanitize_likely_utf8_mojibake


logger = logging.getLogger(__name__)


def _bind_monolith_names() -> None:
    module_globals = globals()
    for name in dir(monolith_main):
        if name.startswith("__"):
            continue
        module_globals.setdefault(name, getattr(monolith_main, name))


_bind_monolith_names()


STORY_MEMORY_LAYER_LATEST_FULL = "latest_full"
STORY_MEMORY_LAYER_FRESH_DETAILED = "fresh_detailed"
STORY_MEMORY_LAYER_COMPRESSED_SUMMARY = "compressed"
STORY_MEMORY_LAYER_FACTS = "facts"
STORY_MEMORY_LAYER_RAW_PENDING = "raw_pending"
STORY_MEMORY_LAYER_PROMOTED = "promoted"

STORY_MEMORY_LAYER_RAW = STORY_MEMORY_LAYER_LATEST_FULL
STORY_MEMORY_LAYER_COMPRESSED = STORY_MEMORY_LAYER_COMPRESSED_SUMMARY
STORY_MEMORY_LAYER_SUPER = STORY_MEMORY_LAYER_FACTS

STORY_TURN_POSTPROCESS_MODEL = POLZA_GEMINI_25_FLASH_MODEL
STORY_ENVIRONMENT_ANALYSIS_MODEL = POLZA_GEMINI_25_FLASH_MODEL
STORY_CHARACTER_STATE_GENERATION_MODEL = POLZA_GEMINI_25_FLASH_MODEL
STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS = 1
STORY_DEFAULT_MEMORY_TOKEN_LIMIT = 30_000

_TOKEN_COUNTER = TokenCounter()
_TOKEN_BUDGET_SERVICE = TokenBudgetService(_TOKEN_COUNTER)
_NPC_DEDUP_SERVICE = NpcCardDedupService()
STORY_MEMORY_MODEL_MAX_ATTEMPTS = 2
STORY_IMPORTANT_MEMORY_MODEL_MAX_ATTEMPTS = 3


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_story_message_content(value: Any) -> str:
    return sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", "\n").strip()


def _normalize_story_assistant_text_for_memory(content: Any) -> str:
    normalized = _normalize_story_message_content(content)
    if not normalized:
        return ""
    cleaned = re.sub(r"\[\[\s*(?:NPC|GG|NPC_THOUGHT|GG_THOUGHT|NARRATOR)[^\]]*\]\]", " ", normalized)
    cleaned = re.sub(r"\[\[[^\]]*$", " ", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip() or normalized


def _normalize_story_assistant_text_for_analysis(content: Any) -> str:
    normalized = _normalize_story_message_content(content)
    if not normalized:
        return ""
    with_speakers = re.sub(
        r"\[\[\s*(?:NPC|GG|NPC_THOUGHT|GG_THOUGHT)\s*:\s*([^\]]+?)\s*\]\]",
        lambda match: f"{' '.join(match.group(1).split()).strip()}: ",
        normalized,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\[\[\s*NARRATOR[^\]]*\]\]", " ", with_speakers, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[\[[^\]]*$", " ", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip() or normalized


def _estimate_story_tokens(value: str) -> int:
    return _TOKEN_COUNTER.count_text(value, apply_margin=True)


def _normalize_story_memory_layer(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "latest": STORY_MEMORY_LAYER_LATEST_FULL,
        "latest_full_turn": STORY_MEMORY_LAYER_LATEST_FULL,
        "latest_full": STORY_MEMORY_LAYER_LATEST_FULL,
        "fresh": STORY_MEMORY_LAYER_FRESH_DETAILED,
        "detailed": STORY_MEMORY_LAYER_FRESH_DETAILED,
        "fresh_detailed": STORY_MEMORY_LAYER_FRESH_DETAILED,
        "compressed_summary": STORY_MEMORY_LAYER_COMPRESSED_SUMMARY,
        "compressed": STORY_MEMORY_LAYER_COMPRESSED_SUMMARY,
        "fact": STORY_MEMORY_LAYER_FACTS,
        "facts": STORY_MEMORY_LAYER_FACTS,
        "super": STORY_MEMORY_LAYER_FACTS,
        "raw_pending": STORY_MEMORY_LAYER_RAW_PENDING,
        "pending_retry": STORY_MEMORY_LAYER_RAW_PENDING,
        "raw": LEGACY_STORY_MEMORY_LAYER_RAW,
        "key": STORY_MEMORY_LAYER_KEY,
        "location": STORY_MEMORY_LAYER_LOCATION,
        "weather": STORY_MEMORY_LAYER_WEATHER,
    }
    return aliases.get(normalized, _base_normalize_memory_layer(normalized))


def _request_polza_story_text(messages_payload: list[dict[str, str]], *args: Any, **kwargs: Any) -> str:
    repaired_messages = repair_likely_utf8_mojibake_deep(messages_payload)
    include_configured_service_fallback = bool(kwargs.pop("include_configured_service_fallback", True))
    service_game = kwargs.pop("service_game", None)
    if service_game is not None:
        primary_model, fallback_models = monolith_main._resolve_story_service_model_pair(service_game)
        kwargs["model_name"] = primary_model
        kwargs["fallback_model_names"] = fallback_models

    requested_model = str(kwargs.get("model_name") or STORY_TURN_POSTPROCESS_MODEL).strip()
    service_models = {
        STORY_TURN_POSTPROCESS_MODEL,
        POLZA_GEMINI_25_FLASH_MODEL,
        str(getattr(settings, "polza_plot_card_model", "") or "").strip(),
    }
    if include_configured_service_fallback and requested_model in service_models:
        fallback_models = [
            str(value or "").strip()
            for value in list(kwargs.get("fallback_model_names") or [])
            if str(value or "").strip()
        ]
        configured_fallback = str(getattr(settings, "polza_service_fallback_model", "") or "").strip()
        if configured_fallback and configured_fallback != requested_model and configured_fallback not in fallback_models:
            fallback_models.append(configured_fallback)
        kwargs["fallback_model_names"] = fallback_models
    kwargs["model_name"] = requested_model
    return monolith_main._request_polza_story_text(repaired_messages, *args, **kwargs)


def _llm_service(*, gemini_only: bool = False) -> LlmModuleService:
    return LlmModuleService(
        _request_polza_story_text,
        primary_model=POLZA_GEMINI_25_FLASH_MODEL,
        fallback_models=(
            []
            if gemini_only
            else [str(getattr(settings, "polza_service_fallback_model", "") or "").strip()]
        ),
        include_configured_fallback=not gemini_only,
    )


def _list_story_memory_blocks(db: Session, game_id: int) -> list[StoryMemoryBlock]:
    return list(
        db.scalars(
            select(StoryMemoryBlock)
            .where(StoryMemoryBlock.game_id == int(game_id), StoryMemoryBlock.undone_at.is_(None))
            .order_by(StoryMemoryBlock.id.asc())
        )
    )


def _list_story_latest_assistant_message_ids(db: Session, game_id: int, limit: int = 1) -> list[int]:
    return [
        int(value)
        for value in db.scalars(
            select(StoryMessage.id)
            .where(
                StoryMessage.game_id == int(game_id),
                StoryMessage.role == STORY_ASSISTANT_ROLE,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(max(int(limit or 1), 1))
        )
    ]


def _get_story_user_prompt_before_assistant_message(db: Session, *, game_id: int, assistant_message_id: int) -> str:
    message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == int(game_id),
            StoryMessage.role == STORY_USER_ROLE,
            StoryMessage.id < int(assistant_message_id),
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    return _normalize_story_message_content(getattr(message, "content", "") if message is not None else "")


def _get_story_previous_assistant_text_before_message(
    db: Session,
    *,
    game_id: int,
    assistant_message_id: int,
) -> str:
    message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == int(game_id),
            StoryMessage.role == STORY_ASSISTANT_ROLE,
            StoryMessage.id < int(assistant_message_id),
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    return _normalize_story_assistant_text_for_memory(getattr(message, "content", "") if message is not None else "")


def _build_story_raw_memory_block_content(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    preserve_user_text: bool = True,
    preserve_assistant_text: bool = True,
) -> str:
    _ = (preserve_user_text, preserve_assistant_text)
    player_text = _normalize_story_message_content(latest_user_prompt)
    narrator_text = _normalize_story_assistant_text_for_memory(latest_assistant_text)
    parts: list[str] = []
    if player_text:
        parts.append(f"PLAYER_TURN:\n{player_text}")
    if narrator_text:
        parts.append(f"NARRATOR_RESPONSE:\n{narrator_text}")
    return "\n\n".join(parts).strip()


def _parse_full_turn_content(content: str) -> tuple[str, str]:
    normalized = _normalize_story_message_content(content)
    if not normalized:
        return "", ""
    player_marker = "PLAYER_TURN:"
    narrator_marker = "NARRATOR_RESPONSE:"
    if player_marker in normalized and narrator_marker in normalized:
        before, after_player = normalized.split(player_marker, 1)
        _ = before
        player_text, narrator_text = after_player.split(narrator_marker, 1)
        return player_text.strip(), narrator_text.strip()
    legacy_player = "Ход игрока (полный текст):"
    legacy_narrator = "Ответ рассказчика (полный текст):"
    if legacy_player in normalized and legacy_narrator in normalized:
        player_text, narrator_text = normalized.split(legacy_narrator, 1)
        player_text = player_text.replace(legacy_player, "", 1)
        return player_text.strip(), narrator_text.strip()
    return "", normalized


def _build_story_memory_block_title(content: str, *, fallback_prefix: str) -> str:
    seed = " ".join(_normalize_story_message_content(content).split()).strip()
    if seed:
        return _base_normalize_memory_title(f"{fallback_prefix}: {seed[:110].rstrip(' ,;:-.!?')}")
    return _base_normalize_memory_title(f"{fallback_prefix}: ход")


def _create_story_memory_block(
    *,
    db: Session,
    game_id: int,
    assistant_message_id: int | None,
    layer: str,
    title: str,
    content: str,
) -> StoryMemoryBlock:
    normalized_layer = _normalize_story_memory_layer(layer)
    normalized_content = _base_normalize_memory_content(content)
    block = StoryMemoryBlock(
        game_id=int(game_id),
        assistant_message_id=int(assistant_message_id) if assistant_message_id else None,
        layer=normalized_layer,
        title=_base_normalize_memory_title(title),
        content=normalized_content,
        token_count=max(_estimate_story_tokens(normalized_content), 1),
    )
    db.add(block)
    db.flush()
    return block


def _upsert_story_raw_memory_block(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    preserve_user_text: bool = True,
    preserve_assistant_text: bool = True,
) -> bool:
    _ = (preserve_user_text, preserve_assistant_text)
    if assistant_message.game_id != game.id:
        return False
    content = _build_story_raw_memory_block_content(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    if not content:
        return False
    assistant_id = int(getattr(assistant_message, "id", 0) or 0)
    existing_blocks = [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if int(getattr(block, "assistant_message_id", 0) or 0) == assistant_id
        and _normalize_story_memory_layer(getattr(block, "layer", "")) in {STORY_MEMORY_LAYER_LATEST_FULL, LEGACY_STORY_MEMORY_LAYER_RAW}
    ]
    title = f"Последний полный ход #{assistant_id}" if assistant_id else "Последний полный ход"
    token_count = max(_estimate_story_tokens(content), 1)
    changed = False
    if existing_blocks:
        primary = existing_blocks[0]
        if _normalize_story_memory_layer(primary.layer) != STORY_MEMORY_LAYER_LATEST_FULL:
            primary.layer = STORY_MEMORY_LAYER_LATEST_FULL
            changed = True
        if primary.title != title:
            primary.title = title
            changed = True
        if primary.content != content:
            primary.content = content
            changed = True
        if int(primary.token_count or 0) != token_count:
            primary.token_count = token_count
            changed = True
        for duplicate in existing_blocks[1:]:
            db.delete(duplicate)
            changed = True
        if changed:
            db.flush()
        return changed

    _create_story_memory_block(
        db=db,
        game_id=game.id,
        assistant_message_id=assistant_id or None,
        layer=STORY_MEMORY_LAYER_LATEST_FULL,
        title=title,
        content=content,
    )
    return True


def _format_detailed_memory_content(payload: DetailedMemoryPayload) -> str:
    lines = [payload.summary.strip()]
    if payload.important_entities:
        lines.append("\nImportant entities:")
        for entity in payload.important_entities:
            note = f" — {entity.note.strip()}" if entity.note.strip() else ""
            lines.append(f"- {entity.name.strip()} ({entity.type.strip() or 'other'}){note}")
    if payload.state_changes:
        lines.append("\nState changes:")
        lines.extend(f"- {item.strip()}" for item in payload.state_changes if item.strip())
    if payload.open_threads:
        lines.append("\nOpen threads:")
        lines.extend(f"- {item.strip()}" for item in payload.open_threads if item.strip())
    return "\n".join(line for line in lines if line is not None).strip()


def _format_compressed_memory_content(payload: CompressedMemoryPayload) -> str:
    lines = [payload.summary.strip()]
    if payload.key_facts:
        lines.append("\nKey facts:")
        lines.extend(f"- {item.strip()}" for item in payload.key_facts if item.strip())
    if payload.open_threads:
        lines.append("\nOpen threads:")
        lines.extend(f"- {item.strip()}" for item in payload.open_threads if item.strip())
    return "\n".join(lines).strip()


def _format_fact_memory_content(payload: FactMemoryPayload) -> str:
    lines: list[str] = []
    if payload.facts:
        lines.append("Facts:")
        lines.extend(f"- {item.strip()}" for item in payload.facts if item.strip())
    if payload.persistent_state:
        lines.append("\nPersistent state:")
        lines.extend(f"- {item.strip()}" for item in payload.persistent_state if item.strip())
    if payload.open_threads:
        lines.append("\nOpen threads:")
        lines.extend(f"- {item.strip()}" for item in payload.open_threads if item.strip())
    return "\n".join(lines).strip()


def _compress_story_memory_block_with_model(
    *,
    raw_content: str,
    model_name: str | None = None,
    fallback_model_names: list[str] | None = None,
    super_mode: bool = False,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,
) -> tuple[str, str]:
    _ = (model_name, fallback_model_names, player_name, known_character_names)
    content = _normalize_story_message_content(raw_content)
    if not content:
        raise ValueError("Cannot compress empty memory block")
    service = _llm_service(gemini_only=True)
    reserved_budget = StoryServiceHttpRequestBudget(max_requests=STORY_MEMORY_MODEL_MAX_ATTEMPTS)
    with use_story_service_http_request_budget(reserved_budget):
        if super_mode:
            payload, _meta = service.call_json(
                messages=build_fact_memory_messages(compressed_blocks=[{"content": content}]),
                schema=FactMemoryPayload,
                module=LLM_FACT_MEMORY_PROMPT_NAME,
                max_tokens=900,
                max_attempts=STORY_MEMORY_MODEL_MAX_ATTEMPTS,
            )
            result_content = _format_fact_memory_content(payload)
            return "Факты памяти", result_content
        player_turn, narrator_response = _parse_full_turn_content(content)
        payload, _meta = service.call_json(
            messages=build_detailed_memory_messages(player_turn=player_turn, narrator_response=narrator_response),
            schema=DetailedMemoryPayload,
            module=LLM_DETAILED_MEMORY_PROMPT_NAME,
            max_tokens=1_100,
            max_attempts=STORY_MEMORY_MODEL_MAX_ATTEMPTS,
        )
    result_content = _format_detailed_memory_content(payload)
    return "Подробная память", result_content


def _get_story_stale_raw_memory_blocks(
    *,
    db: Session,
    game: StoryGame,
    latest_assistant_message_ids: list[int] | None = None,
) -> list[StoryMemoryBlock]:
    latest_ids = set(latest_assistant_message_ids or _list_story_latest_assistant_message_ids(db, game.id, limit=1))
    stale: list[StoryMemoryBlock] = []
    for block in _list_story_memory_blocks(db, game.id):
        layer = _normalize_story_memory_layer(getattr(block, "layer", ""))
        assistant_id = int(getattr(block, "assistant_message_id", 0) or 0)
        if layer in {
            STORY_MEMORY_LAYER_LATEST_FULL,
            STORY_MEMORY_LAYER_RAW_PENDING,
            LEGACY_STORY_MEMORY_LAYER_RAW,
        } and assistant_id not in latest_ids:
            stale.append(block)
    return sorted(stale, key=lambda item: (int(getattr(item, "id", 0) or 0)))


def _has_story_stale_raw_memory_blocks(*, db: Session, game: StoryGame) -> bool:
    return bool(_get_story_stale_raw_memory_blocks(db=db, game=game))


def _active_prompt_cards_for_budget(db: Session, game: StoryGame) -> list[Any]:
    cards: list[Any] = []
    try:
        cards.extend(list_story_instruction_cards(db, game.id))
    except Exception:
        logger.warning("Failed to list instruction cards for memory budget", exc_info=True)
    try:
        cards.extend(card for card in list_story_plot_cards(db, game.id) if bool(getattr(card, "is_enabled", True)))
    except Exception:
        logger.warning("Failed to list plot cards for memory budget", exc_info=True)
    try:
        cards.extend(list_story_world_cards(db, game.id))
    except Exception:
        logger.warning("Failed to list world cards for memory budget", exc_info=True)
    return cards


def _calculate_memory_budget(db: Session, game: StoryGame) -> TokenBudgetResult:
    configured_limit = int(getattr(game, "context_limit_chars", 0) or 0)
    user_memory_token_limit = configured_limit if configured_limit > 0 else STORY_DEFAULT_MEMORY_TOKEN_LIMIT
    active_cards_token_count = _TOKEN_BUDGET_SERVICE.count_active_cards(_active_prompt_cards_for_budget(db, game))
    result = _TOKEN_BUDGET_SERVICE.calculate(
        user_memory_token_limit=user_memory_token_limit,
        active_cards_token_count=active_cards_token_count,
        optimization_mode=getattr(game, "memory_optimization_mode", "standard"),
    )
    logger.info(
        "Story memory token budget",
        extra={
            "gameId": int(getattr(game, "id", 0) or 0),
            "userMemoryTokenLimit": result.user_memory_token_limit,
            "activeCardsTokenCount": result.active_cards_token_count,
            "availableHistoryTokens": result.available_history_tokens,
            "tierBudgets": {
                "fresh": result.fresh_budget,
                "compressed": result.compressed_budget,
                "facts": result.facts_budget,
            },
        },
    )
    return result


def _layer_blocks(db: Session, game: StoryGame, layer_names: set[str]) -> list[StoryMemoryBlock]:
    return [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if _normalize_story_memory_layer(getattr(block, "layer", "")) in layer_names
    ]


def _sum_block_tokens(blocks: list[StoryMemoryBlock]) -> int:
    return sum(max(_TOKEN_BUDGET_SERVICE.count_block_tokens(block), 1) for block in blocks)


def _promote_blocks(
    *,
    db: Session,
    game: StoryGame,
    source_blocks: list[StoryMemoryBlock],
    target_layer: str,
    prompt_name: str,
    max_model_requests_left: int,
) -> tuple[bool, int]:
    if not source_blocks or max_model_requests_left <= 0:
        return False, max_model_requests_left
    service = _llm_service(gemini_only=True)
    block_payloads = [
        {
            "id": int(getattr(block, "id", 0) or 0),
            "assistant_message_id": getattr(block, "assistant_message_id", None),
            "content": str(getattr(block, "content", "") or ""),
        }
        for block in source_blocks
    ]
    reserved_budget = StoryServiceHttpRequestBudget(max_requests=STORY_MEMORY_MODEL_MAX_ATTEMPTS)
    with use_story_service_http_request_budget(reserved_budget):
        if prompt_name == LLM_COMPRESSED_MEMORY_PROMPT_NAME:
            payload, _meta = service.call_json(
                messages=build_compressed_memory_messages(detailed_blocks=block_payloads),
                schema=CompressedMemoryPayload,
                module=prompt_name,
                game_id=game.id,
                max_tokens=1_100,
                max_attempts=STORY_MEMORY_MODEL_MAX_ATTEMPTS,
            )
            content = _format_compressed_memory_content(payload)
            title = "Сжатая память"
        else:
            payload, _meta = service.call_json(
                messages=build_fact_memory_messages(compressed_blocks=block_payloads),
                schema=FactMemoryPayload,
                module=prompt_name,
                game_id=game.id,
                max_tokens=900,
                max_attempts=STORY_MEMORY_MODEL_MAX_ATTEMPTS,
            )
            content = _format_fact_memory_content(payload)
            title = "Факты памяти"

    if not content:
        raise RuntimeError(f"{prompt_name} returned empty content")
    assistant_ids = [int(getattr(block, "assistant_message_id", 0) or 0) for block in source_blocks]
    assistant_id = max([value for value in assistant_ids if value > 0], default=None)
    _create_story_memory_block(
        db=db,
        game_id=game.id,
        assistant_message_id=assistant_id,
        layer=target_layer,
        title=title,
        content=content,
    )
    for block in source_blocks:
        db.delete(block)
    db.flush()
    logger.info(
        "Story memory promotion",
        extra={
            "gameId": game.id,
            "llmModule": prompt_name,
            "promotionDecisions": {
                "sourceBlockIds": [int(getattr(block, "id", 0) or 0) for block in source_blocks],
                "targetLayer": target_layer,
            },
        },
    )
    return True, max_model_requests_left - 1


def _rebalance_story_memory_layers(
    *,
    db: Session,
    game: StoryGame,
    max_model_requests: int = 4,
    require_model_compaction: bool = False,
    commit_each_model_compaction: bool = False,
    backfill_existing_compact_layers: bool = False,
    prioritize_recent_transitions: bool = False,
) -> bool:
    _ = backfill_existing_compact_layers
    budget = _calculate_memory_budget(db, game)
    requests_left = max(int(max_model_requests or 0), 0)
    changed = False
    successful_raw_compactions = 0
    raw_compaction_failures: list[Exception] = []

    stale_latest = _get_story_stale_raw_memory_blocks(db=db, game=game)
    stale_latest = sorted(
        stale_latest,
        key=lambda item: (
            1
            if _normalize_story_memory_layer(getattr(item, "layer", ""))
            == STORY_MEMORY_LAYER_RAW_PENDING
            else 0,
            (
                -int(getattr(item, "id", 0) or 0)
                if prioritize_recent_transitions
                else int(getattr(item, "id", 0) or 0)
            ),
        ),
    )
    for block in list(stale_latest):
        if requests_left <= 0:
            break
        block_id = int(getattr(block, "id", 0) or 0)
        try:
            title, content = _compress_story_memory_block_with_model(raw_content=str(block.content or ""))
        except Exception as exc:
            requests_left -= 1
            raw_compaction_failures.append(exc)
            logger.warning(
                "Story latest_full->fresh_detailed compression failed",
                extra={
                    "gameId": game.id,
                    "llmModule": LLM_DETAILED_MEMORY_PROMPT_NAME,
                    "rawPendingCreated": True,
                    "validationErrors": str(exc),
                    "memoryBlockTokenCounts": {"source": max(_TOKEN_BUDGET_SERVICE.count_block_tokens(block), 1)},
                },
            )
            current = db.get(StoryMemoryBlock, block_id)
            if current is not None:
                current.layer = STORY_MEMORY_LAYER_RAW_PENDING
                current.title = f"Ожидает сжатия #{getattr(current, 'assistant_message_id', '') or block_id}"
                current.token_count = max(_estimate_story_tokens(str(current.content or "")), 1)
                db.flush()
                changed = True
                if commit_each_model_compaction:
                    db.commit()
            continue

        requests_left -= 1
        try:
            _create_story_memory_block(
                db=db,
                game_id=game.id,
                assistant_message_id=getattr(block, "assistant_message_id", None),
                layer=STORY_MEMORY_LAYER_FRESH_DETAILED,
                title=title,
                content=content,
            )
            db.delete(block)
            db.flush()
            changed = True
            successful_raw_compactions += 1
            if commit_each_model_compaction:
                db.commit()
        except Exception:
            logger.exception(
                "Story memory compression result could not be persisted: game_id=%s block_id=%s",
                game.id,
                block_id,
            )
            raise

    if raw_compaction_failures and require_model_compaction and successful_raw_compactions <= 0:
        first_failure = raw_compaction_failures[0]
        raise RuntimeError(
            f"Gemini memory compression failed for all attempted blocks: {first_failure}"
        ) from first_failure

    fresh_blocks = sorted(
        _layer_blocks(
            db,
            game,
            {STORY_MEMORY_LAYER_LATEST_FULL, STORY_MEMORY_LAYER_FRESH_DETAILED, STORY_MEMORY_LAYER_RAW_PENDING},
        ),
        key=lambda item: int(getattr(item, "id", 0) or 0),
    )
    if _sum_block_tokens(fresh_blocks) > budget.fresh_budget and requests_left > 0:
        promotable = [
            block
            for block in fresh_blocks
            if _normalize_story_memory_layer(getattr(block, "layer", "")) == STORY_MEMORY_LAYER_FRESH_DETAILED
        ]
        if promotable:
            try:
                promoted, requests_left = _promote_blocks(
                    db=db,
                    game=game,
                    source_blocks=promotable[: max(1, min(len(promotable), 6))],
                    target_layer=STORY_MEMORY_LAYER_COMPRESSED_SUMMARY,
                    prompt_name=LLM_COMPRESSED_MEMORY_PROMPT_NAME,
                    max_model_requests_left=requests_left,
                )
                changed = changed or promoted
            except Exception:
                if require_model_compaction:
                    raise
                logger.warning("Story fresh_detailed promotion failed", exc_info=True)

    compressed_blocks = sorted(
        _layer_blocks(db, game, {STORY_MEMORY_LAYER_COMPRESSED_SUMMARY}),
        key=lambda item: int(getattr(item, "id", 0) or 0),
    )
    if _sum_block_tokens(compressed_blocks) > budget.compressed_budget and requests_left > 0:
        try:
            promoted, requests_left = _promote_blocks(
                db=db,
                game=game,
                source_blocks=compressed_blocks[: max(1, min(len(compressed_blocks), 8))],
                target_layer=STORY_MEMORY_LAYER_FACTS,
                prompt_name=LLM_FACT_MEMORY_PROMPT_NAME,
                max_model_requests_left=requests_left,
            )
            changed = changed or promoted
        except Exception:
            if require_model_compaction:
                raise
            logger.warning("Story compressed_summary promotion failed", exc_info=True)

    facts_blocks = sorted(
        _layer_blocks(db, game, {STORY_MEMORY_LAYER_FACTS}),
        key=lambda item: int(getattr(item, "id", 0) or 0),
    )
    if len(facts_blocks) > 1 and _sum_block_tokens(facts_blocks) > budget.facts_budget and requests_left > 0:
        try:
            promoted, requests_left = _promote_blocks(
                db=db,
                game=game,
                source_blocks=facts_blocks[: max(2, min(len(facts_blocks), 10))],
                target_layer=STORY_MEMORY_LAYER_FACTS,
                prompt_name=LLM_FACT_MEMORY_PROMPT_NAME,
                max_model_requests_left=requests_left,
            )
            changed = changed or promoted
        except Exception:
            if require_model_compaction:
                raise
            logger.warning("Story facts merge failed", exc_info=True)

    return changed


def _normalize_story_location_memory_content(value: str) -> str:
    normalized = _normalize_story_message_content(value)
    return " ".join(normalized.replace("\n", " ").split()).strip(" .,:;!?")


def _normalize_story_location_memory_label(value: str) -> str:
    normalized = _normalize_story_location_memory_content(value)
    for prefix in ("Действие происходит ", "События происходят "):
        if normalized.casefold().startswith(prefix.casefold()):
            normalized = normalized[len(prefix) :].strip(" .,:;!?")
            break
    return normalized


def _resolve_story_location_memory_label(*, label: str | None = None, content: str | None = None) -> str:
    return _normalize_story_location_memory_label(label or content or "")


def _location_payload_to_content(payload: dict[str, Any]) -> str:
    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    display = str(current.get("display") or payload.get("display") or "").strip()
    if not display:
        parts = [
            current.get("country"),
            current.get("region"),
            current.get("city"),
            current.get("district"),
            current.get("street"),
            current.get("place_name"),
            current.get("place_type"),
            current.get("room_or_area"),
        ]
        display = ", ".join(str(part).strip() for part in parts if str(part or "").strip())
    display = _normalize_story_location_memory_label(display)
    if not display:
        return ""
    return f"Действие происходит {display}."


def _upsert_story_location_memory_block(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    previous_assistant_text: str = "",
    resolved_payload_override: dict[str, Any] | None = None,
) -> bool:
    _ = (latest_user_prompt, latest_assistant_text, previous_assistant_text)
    payload = resolved_payload_override if isinstance(resolved_payload_override, dict) else None
    if not payload or not bool(payload.get("should_update")):
        return False
    content = _location_payload_to_content(payload)
    if not content:
        return False
    label = _normalize_story_location_memory_label(content)
    existing = [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if _normalize_story_memory_layer(getattr(block, "layer", "")) == STORY_MEMORY_LAYER_LOCATION
    ]
    changed = False
    if str(getattr(game, "current_location_label", "") or "") != label:
        game.current_location_label = label
        changed = True
    token_count = max(_estimate_story_tokens(content), 1)
    title = f"Место: {label}"
    if existing:
        block = existing[-1]
        if block.assistant_message_id != assistant_message.id:
            block.assistant_message_id = assistant_message.id
            changed = True
        if block.title != title:
            block.title = title
            changed = True
        if block.content != content:
            block.content = content
            changed = True
        if int(block.token_count or 0) != token_count:
            block.token_count = token_count
            changed = True
    else:
        _create_story_memory_block(
            db=db,
            game_id=game.id,
            assistant_message_id=assistant_message.id,
            layer=STORY_MEMORY_LAYER_LOCATION,
            title=title,
            content=content,
        )
        changed = True
    if changed:
        db.flush()
    return changed


def _get_story_latest_location_memory_content(*, db: Session, game_id: int) -> str:
    for block in reversed(_list_story_memory_blocks(db, game_id)):
        if _normalize_story_memory_layer(getattr(block, "layer", "")) == STORY_MEMORY_LAYER_LOCATION:
            return _normalize_story_message_content(getattr(block, "content", "") or "")
    return ""


def _story_character_state_cards_from_game(game: StoryGame) -> list[dict[str, Any]]:
    raw_value = getattr(game, "character_state_payload", "") or ""
    if isinstance(raw_value, list):
        return [dict(item) for item in raw_value if isinstance(item, dict)]
    try:
        parsed = json.loads(str(raw_value or "[]"))
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [dict(item) for item in parsed if isinstance(item, dict)]


def _serialize_story_character_state_cards_payload(value: list[dict[str, Any]] | None) -> str:
    return json.dumps(value or [], ensure_ascii=False)


def _normalize_story_character_state_status_template(value: Any) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        return ""
    lowered = normalized.casefold()
    if lowered in {
        "normal",
        "healthy",
        "ok",
        "нормально",
        "нормальное",
        "состояние нормальное",
        "здоров",
        "здорова",
    }:
        return "Нормальное"
    for prefix in ("состояние:", "ранен:", "ранена:", "болен:", "больна:"):
        if lowered.startswith(prefix):
            normalized = normalized.split(":", 1)[1].strip()
            break
    if not normalized:
        return "Нормальное"
    return normalized[:1].upper() + normalized[1:]


def _split_story_character_inventory_items(value: Any) -> list[str]:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return []
    raw_items = re.split(r"[,;\n]+", normalized)
    items: list[str] = []
    seen: set[str] = set()
    for raw_item in raw_items:
        item = " ".join(raw_item.split()).strip(" .")
        key = normalize_match_text(item)
        if not item or not key or key in seen:
            continue
        seen.add(key)
        items.append(item)
    return items


def _normalize_story_character_inventory_list(value: Any) -> str:
    return ", ".join(_split_story_character_inventory_items(value))


def _state_location_from_content(content: str) -> str:
    label = _normalize_story_location_memory_label(content)
    if label.casefold().startswith("действие происходит"):
        label = label[len("действие происходит") :].strip(" .,:;!?")
    if label and not label.startswith("в "):
        return f"в {label[0].lower()}{label[1:]}"
    return label


def _normalize_story_character_state_update_payload(
    raw_payload: Any,
    *,
    existing_cards: list[dict[str, Any]],
    current_location_content: str,
) -> dict[str, Any] | None:
    if not isinstance(raw_payload, dict):
        return None
    raw_cards = raw_payload.get("cards")
    if not isinstance(raw_cards, list):
        return None
    existing_by_id = {
        str(card.get("world_card_id") or card.get("id") or ""): dict(card)
        for card in existing_cards
        if str(card.get("world_card_id") or card.get("id") or "").strip()
    }
    normalized_cards: list[dict[str, Any]] = []
    for raw_card in raw_cards:
        if not isinstance(raw_card, dict):
            continue
        key = str(raw_card.get("world_card_id") or raw_card.get("id") or "").strip()
        card = dict(existing_by_id.get(key, {}))
        card.update({key_name: raw_card.get(key_name, card.get(key_name, "")) for key_name in raw_card.keys()})
        if "status" in card:
            card["status"] = _normalize_story_character_state_status_template(card.get("status")) or card.get("status", "")
        if not str(card.get("location") or "").strip() and current_location_content:
            card["location"] = _state_location_from_content(current_location_content)
        normalized_cards.append(card)
    return {"cards": normalized_cards}


def _ensure_story_character_state_cards_include_world_cards(
    *,
    db: Session,
    game: StoryGame,
    active_world_card_ids: set[int] | None = None,
    current_location_content: str = "",
) -> bool:
    _ = active_world_card_ids
    existing_cards = _story_character_state_cards_from_game(game)
    seen_ids = {int(card.get("world_card_id") or 0) for card in existing_cards if _safe_int(card.get("world_card_id")) > 0}
    next_cards = list(existing_cards)
    location = _state_location_from_content(current_location_content)
    for card in list_story_world_cards(db, game.id):
        kind = str(getattr(card, "kind", "") or "").strip().lower()
        if kind not in {"main_hero", "npc"}:
            continue
        if not bool(getattr(card, "ai_edit_enabled", True)):
            continue
        card_id = int(getattr(card, "id", 0) or 0)
        if card_id <= 0 or card_id in seen_ids:
            continue
        next_cards.append(
            {
                "world_card_id": card_id,
                "name": str(getattr(card, "title", "") or "").strip(),
                "kind": kind,
                "is_active": True,
                "status": _normalize_story_character_state_status_template(getattr(card, "health_status", "")),
                "clothing": str(getattr(card, "clothing", "") or "").strip(),
                "location": location,
                "equipment": str(getattr(card, "inventory", "") or "").strip(),
                "mood": "",
                "attitude_to_hero": "",
                "personality": "",
            }
        )
        seen_ids.add(card_id)
    next_payload = _serialize_story_character_state_cards_payload(next_cards)
    if str(getattr(game, "character_state_payload", "") or "") == next_payload:
        return False
    game.character_state_payload = next_payload
    db.flush()
    return True


def _seed_story_character_state_cards_from_world_cards(*, db: Session, game: StoryGame, **kwargs: Any) -> bool:
    return _ensure_story_character_state_cards_include_world_cards(db=db, game=game, **kwargs)


def _sync_story_character_state_cards(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    resolved_payload_override: dict[str, Any] | None = None,
    current_location_content: str = "",
    latest_user_prompt: str = "",
    previous_assistant_text: str = "",
    latest_assistant_text: str = "",
    allow_model_seed: bool = False,
    allow_model_fill: bool = False,
) -> bool:
    _ = (assistant_message, latest_user_prompt, previous_assistant_text, latest_assistant_text, allow_model_seed, allow_model_fill)
    if not bool(getattr(game, "character_state_enabled", False)):
        return False
    _ensure_story_character_state_cards_include_world_cards(db=db, game=game, current_location_content=current_location_content)
    existing_cards = _story_character_state_cards_from_game(game)
    payload = resolved_payload_override if isinstance(resolved_payload_override, dict) else None
    if not payload:
        return False
    if isinstance(payload.get("cards"), list):
        normalized = _normalize_story_character_state_update_payload(
            payload,
            existing_cards=existing_cards,
            current_location_content=current_location_content,
        )
        if not normalized:
            return False
        next_cards = normalized["cards"]
    else:
        updates = payload.get("character_updates")
        if not isinstance(updates, list):
            return False
        next_cards = [dict(card) for card in existing_cards]
        by_name = {
            normalize_match_text(card.get("name")): card
            for card in next_cards
            if normalize_match_text(card.get("name"))
        }
        by_id = {str(card.get("world_card_id") or card.get("id") or ""): card for card in next_cards}
        applied_updates = 0
        skipped_updates = 0
        for update in updates:
            if not isinstance(update, dict):
                continue
            character_ref = update.get("character_ref") if isinstance(update.get("character_ref"), dict) else {}
            ref_id = str(character_ref.get("id") or "").strip()
            ref_name = str(character_ref.get("name") or "").strip()
            card = by_id.get(ref_id) if ref_id else None
            if card is None and ref_name:
                card = by_name.get(normalize_match_text(ref_name))
            if card is None:
                skipped_updates += 1
                logger.warning(
                    "Story character-state update skipped because Gemini reference did not match a tracked card: "
                    "game_id=%s assistant_message_id=%s character_id=%s character_name=%s",
                    game.id,
                    assistant_message.id,
                    ref_id,
                    ref_name,
                )
                continue
            applied_updates += 1
            clothing = update.get("clothing") if isinstance(update.get("clothing"), dict) else {}
            if clothing.get("should_update") and str(clothing.get("source") or "") != "unchanged":
                card["clothing"] = str(clothing.get("value") or "").strip()
            health = update.get("health") if isinstance(update.get("health"), dict) else {}
            if health.get("should_update") and str(health.get("source") or "") != "unchanged":
                card["status"] = _normalize_story_character_state_status_template(health.get("value"))
            inventory = update.get("inventory") if isinstance(update.get("inventory"), dict) else {}
            if inventory.get("should_update") and str(inventory.get("source") or "") != "unchanged":
                card["equipment"] = _normalize_story_character_inventory_list(inventory.get("value"))
            if current_location_content and not str(card.get("location") or "").strip():
                card["location"] = _state_location_from_content(current_location_content)
        logger.info(
            "Story character-state Gemini actions processed: game_id=%s assistant_message_id=%s "
            "applied=%s skipped=%s",
            game.id,
            assistant_message.id,
            applied_updates,
            skipped_updates,
        )
    next_payload = _serialize_story_character_state_cards_payload(next_cards)
    if str(getattr(game, "character_state_payload", "") or "") == next_payload:
        return False
    game.character_state_payload = next_payload
    db.flush()
    return True


def _build_existing_character_cards(db: Session, game: StoryGame, cards: list[Any] | None = None) -> list[dict[str, Any]]:
    source_cards = list(cards) if cards is not None else list_story_world_cards(db, game.id)
    return [
        payload
        for payload in (world_card_to_character_payload(card) for card in source_cards)
        if payload is not None
    ]


def _sync_story_auto_npc_cards_for_assistant_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    resolved_payload_override: Any = None,
    allow_model_request: bool = False,
) -> list[StoryWorldCard]:
    if not bool(getattr(game, "auto_npc_cards_enabled", False)):
        return []
    try:
        existing_cards = list_story_world_cards(db, game.id)
    except Exception:
        logger.warning("Failed to list world cards for NPC auto-card sync", exc_info=True)
        existing_cards = []
    payload = resolved_payload_override
    if payload is None and allow_model_request:
        extracted = _extract_story_postprocess_memory_payload(
            db=db,
            game=game,
            current_location_content=_get_story_latest_location_memory_content(db=db, game_id=game.id),
            latest_user_prompt=latest_user_prompt,
            previous_assistant_text="",
            latest_assistant_text=latest_assistant_text,
            raw_memory_enabled=False,
            location_enabled=False,
            environment_enabled=False,
            character_state_enabled=False,
            important_event_enabled=False,
            auto_npc_cards_enabled=True,
        )
        payload = extracted.get("npc_cards", {}).get("actions") if isinstance(extracted, dict) else None
    actions = payload.get("actions") if isinstance(payload, dict) else payload
    if not isinstance(actions, list):
        logger.warning(
            "Story auto-NPC Gemini payload has no actions list: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        return []
    candidates = _NPC_DEDUP_SERVICE.build_candidates(
        cards=existing_cards,
        player_turn=latest_user_prompt,
        narrator_response=latest_assistant_text,
    )
    changed_cards: list[StoryWorldCard] = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        dedup_triggers: list[str] = []
        action_type = str(action.get("type") or "").strip()
        if action_type == "no_action":
            continue
        existing_id = _safe_int(action.get("existing_card_id"))
        target_card = db.get(StoryWorldCard, existing_id) if existing_id > 0 else None
        if target_card is not None and int(getattr(target_card, "game_id", 0) or 0) != int(game.id):
            target_card = None
        if target_card is not None and not bool(getattr(target_card, "ai_edit_enabled", True)):
            logger.info(
                "Story auto-NPC update ignored for AI-locked card: game_id=%s assistant_message_id=%s "
                "existing_card_id=%s",
                game.id,
                assistant_message.id,
                existing_id,
            )
            continue
        if action_type == "create_card":
            new_card = action.get("new_card") if isinstance(action.get("new_card"), dict) else {}
            name = str(new_card.get("name") or "").strip()
            raw_triggers = [name, *new_card.get("triggers", [])]
            triggers: list[str] = []
            seen_trigger_keys: set[str] = set()
            for raw_trigger in raw_triggers:
                trigger = str(raw_trigger or "").strip()
                trigger_key = normalize_match_text(trigger)
                if not trigger or not trigger_key or trigger_key in seen_trigger_keys:
                    continue
                seen_trigger_keys.add(trigger_key)
                triggers.append(trigger)
            target_card = _NPC_DEDUP_SERVICE.find_existing_match(
                cards=existing_cards,
                name=name,
                triggers=triggers,
                candidates=candidates,
            )
            if target_card is not None:
                action_type = "update_existing_card"
                dedup_triggers = triggers
            elif name:
                description = str(new_card.get("description") or "").strip()
                personality = str(new_card.get("personality") or "").strip()
                content = description or personality or name
                created = StoryWorldCard(
                    game_id=game.id,
                    title=name,
                    content=content,
                    race=str(new_card.get("race") or "").strip(),
                    clothing=str(new_card.get("clothing") or "").strip(),
                    inventory=_normalize_story_character_inventory_list(new_card.get("inventory")),
                    health_status=_normalize_story_character_state_status_template(new_card.get("health_status")),
                    triggers=json.dumps(triggers, ensure_ascii=False),
                    kind="npc",
                    source="ai",
                )
                db.add(created)
                db.flush()
                existing_cards.append(created)
                changed_cards.append(created)
                logger.info(
                    "Story NPC dedup decision",
                    extra={"gameId": game.id, "turnId": assistant_message.id, "npcDedupDecision": "create_card"},
                )
                continue
        if (
            action_type == "update_existing_card"
            and target_card is not None
            and not bool(getattr(target_card, "ai_edit_enabled", True))
        ):
            logger.info(
                "Story auto-NPC dedup matched an AI-locked card; update ignored: "
                "game_id=%s assistant_message_id=%s existing_card_id=%s",
                game.id,
                assistant_message.id,
                getattr(target_card, "id", None),
            )
            continue
        if action_type == "update_existing_card" and target_card is not None:
            update = action.get("update_existing") if isinstance(action.get("update_existing"), dict) else {}
            add_triggers = [
                str(item).strip()
                for item in [*dedup_triggers, *update.get("add_triggers", [])]
                if str(item or "").strip()
            ]
            current_triggers = [str(item).strip() for item in parse_json_list(getattr(target_card, "triggers", "[]")) if str(item or "").strip()]
            merged_triggers: list[str] = []
            seen_trigger_keys: set[str] = set()
            for trigger in [*current_triggers, *add_triggers]:
                trigger_key = normalize_match_text(trigger)
                if not trigger_key or trigger_key in seen_trigger_keys:
                    continue
                seen_trigger_keys.add(trigger_key)
                merged_triggers.append(trigger)
            notes = str(update.get("notes") or "").strip()
            changed = False
            next_triggers_json = json.dumps(merged_triggers, ensure_ascii=False)
            if target_card.triggers != next_triggers_json:
                target_card.triggers = next_triggers_json
                changed = True
            if notes and notes not in str(target_card.content or ""):
                target_card.content = "\n".join(part for part in [str(target_card.content or "").strip(), notes] if part)
                changed = True
            if changed:
                db.flush()
                changed_cards.append(target_card)
                logger.info(
                    "Story NPC dedup decision",
                    extra={"gameId": game.id, "turnId": assistant_message.id, "npcDedupDecision": "update_existing_card"},
                )
        elif action_type == "update_existing_card":
            logger.warning(
                "Story auto-NPC update skipped because Gemini did not provide a valid existing card id: "
                "game_id=%s assistant_message_id=%s existing_card_id=%s",
                game.id,
                assistant_message.id,
                action.get("existing_card_id"),
            )
    return changed_cards


def _extract_story_postprocess_memory_payload(
    *,
    db: Session,
    game: StoryGame,
    current_location_content: str,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    raw_memory_enabled: bool = False,
    location_enabled: bool = True,
    environment_enabled: bool = False,
    character_state_enabled: bool = False,
    important_event_enabled: bool = False,
    ambient_enabled: bool = False,
    scene_emotion_enabled: bool = False,
    auto_npc_cards_enabled: bool = False,
    world_cards: list[dict[str, Any]] | None = None,
    scene_emotion_active_cast_entries: list[dict[str, Any]] | None = None,
    scene_emotion_allowed_emotions: list[str] | None = None,
) -> dict[str, Any] | None:
    _ = (
        raw_memory_enabled,
        environment_enabled,
        ambient_enabled,
        scene_emotion_enabled,
        scene_emotion_active_cast_entries,
        scene_emotion_allowed_emotions,
    )
    requested_modules: list[str] = []
    if location_enabled:
        requested_modules.append("location")
    if character_state_enabled:
        requested_modules.append("auto_state")
    if auto_npc_cards_enabled:
        requested_modules.append("npc_cards")
    if not requested_modules and not important_event_enabled:
        return None
    result: dict[str, Any] = {"call_count": 0}
    failed_modules: list[str] = []

    if important_event_enabled:
        try:
            result["important_event"] = _extract_story_important_plot_card_payload(
                db=db,
                game=game,
                latest_user_prompt=latest_user_prompt,
                latest_assistant_text=latest_assistant_text,
            )
            result["call_count"] += 1
        except Exception:
            logger.warning(
                "Important-memory analysis failed after Gemini retries: game_id=%s",
                game.id,
                exc_info=True,
            )
            result["important_event"] = None
            failed_modules.append("important_event")

    if not requested_modules:
        if failed_modules:
            result["_postprocess_failed_modules"] = failed_modules
        return result
    # Character state and NPC deduplication must see every persisted character,
    # not only the cards selected for the current storyteller prompt.
    try:
        source_world_cards: list[Any] = list(list_story_world_cards(db, game.id))
    except Exception:
        logger.warning(
            "Failed to load complete world-card context for Gemini post-process: game_id=%s",
            game.id,
            exc_info=True,
        )
        source_world_cards = list(world_cards or [])
    world_context_cards = list(world_cards or source_world_cards)
    existing_character_cards = _build_existing_character_cards(db, game, source_world_cards)
    candidates = _NPC_DEDUP_SERVICE.build_candidates(
        cards=source_world_cards,
        player_turn=latest_user_prompt,
        narrator_response=latest_assistant_text,
    )
    main_hero_card = next((item for item in existing_character_cards if item.get("kind") == "main_hero"), None)
    current_states = _story_character_state_cards_from_game(game) if character_state_enabled else []
    previous_location = {
        "display": _normalize_story_location_memory_label(current_location_content)
        or str(getattr(game, "current_location_label", "") or "").strip()
        or None
    }
    messages = build_game_state_analysis_messages(
        requested_modules=requested_modules,
        world_card=build_world_card_context(world_context_cards),
        previous_location=previous_location,
        player_character_card=main_hero_card,
        existing_character_cards=existing_character_cards,
        npc_dedup_candidates=candidates,
        current_character_states=current_states,
        player_turn=_normalize_story_message_content(latest_user_prompt),
        previous_narrator_response=_normalize_story_assistant_text_for_analysis(previous_assistant_text),
        narrator_response=_normalize_story_assistant_text_for_analysis(latest_assistant_text),
    )
    if auto_npc_cards_enabled:
        response_max_tokens = 3_200
    elif character_state_enabled:
        response_max_tokens = 2_400
    else:
        response_max_tokens = 1_400
    payload, _meta = _llm_service(gemini_only=True).call_json(
        messages=messages,
        schema=GameStateAnalysisPayload,
        module=LLM_GAME_STATE_ANALYSIS_PROMPT_NAME,
        game_id=game.id,
        max_tokens=response_max_tokens,
        max_attempts=2,
    )
    model_result = payload.model_dump(mode="json")
    result["call_count"] += 1
    if location_enabled:
        location = model_result.get("location") if isinstance(model_result.get("location"), dict) else {}
        if location:
            if bool(location.get("changed")) and not bool(location.get("should_update")):
                location["should_update"] = True
            location["content"] = _location_payload_to_content(location)
        result["location"] = location
    if character_state_enabled:
        auto_state = (
            model_result.get("auto_state")
            if isinstance(model_result.get("auto_state"), dict)
            else {"character_updates": []}
        )
        result["auto_state"] = auto_state
        result["character_state"] = auto_state
    if auto_npc_cards_enabled:
        npc_cards = (
            model_result.get("npc_cards")
            if isinstance(model_result.get("npc_cards"), dict)
            else {"actions": []}
        )
        result["npc_cards"] = npc_cards
        result["auto_npcs"] = npc_cards.get("actions", [])
    if failed_modules:
        result["_postprocess_failed_modules"] = failed_modules
    return result


def _resolve_story_postprocess_section_payload(
    raw_payload: Any = None,
    *,
    parsed_payload: Any = None,
    section_name: str,
    requested_sections: list[str] | None = None,
) -> Any:
    _ = requested_sections
    if raw_payload is None:
        raw_payload = parsed_payload
    if not isinstance(raw_payload, dict):
        return None
    if section_name in raw_payload:
        return raw_payload.get(section_name)
    if section_name == "auto_npcs":
        return (raw_payload.get("npc_cards") or {}).get("actions") if isinstance(raw_payload.get("npc_cards"), dict) else None
    if section_name == "character_state":
        return raw_payload.get("auto_state")
    return None


def _coerce_story_auto_npcs_section_payload(raw_payload: Any) -> list[dict[str, Any]] | None:
    if isinstance(raw_payload, dict) and isinstance(raw_payload.get("actions"), list):
        raw_payload = raw_payload.get("actions")
    if not isinstance(raw_payload, list):
        return None
    return [dict(item) for item in raw_payload if isinstance(item, dict)]


def _build_story_auto_npc_local_payloads(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    _ = (args, kwargs)
    return []


def _build_story_location_fallback_payload_from_player_turn(*args: Any, **kwargs: Any) -> dict[str, str] | None:
    _ = (args, kwargs)
    return None


def _should_repair_story_location_payload_with_local_fallback(*args: Any, **kwargs: Any) -> bool:
    _ = (args, kwargs)
    return False


def _story_environment_any_enabled_for_game(game: StoryGame) -> bool:
    return any(
        bool(getattr(game, field_name, False))
        for field_name in (
            "environment_enabled",
            "environment_time_enabled",
            "environment_weather_enabled",
            "environment_ambient_enabled",
            "environment_scene_emotion_enabled",
        )
    )


_STORY_ENVIRONMENT_MONTH_NAMES_RU = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)
_STORY_ENVIRONMENT_WEEKDAY_NAMES_RU = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)


def _story_environment_time_enabled_for_game(game: StoryGame) -> bool:
    return _story_games_normalize_environment_time_enabled(
        getattr(game, "environment_time_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )


def _story_environment_weather_enabled_for_game(game: StoryGame) -> bool:
    return _story_games_normalize_environment_weather_enabled(
        getattr(game, "environment_weather_enabled", None),
        legacy_environment_enabled=getattr(game, "environment_enabled", None),
    )


def _story_environment_any_enabled_for_game(game: StoryGame) -> bool:
    return _story_environment_time_enabled_for_game(game) or _story_environment_weather_enabled_for_game(game)


def _deserialize_story_environment_datetime(value: str | None) -> datetime | None:
    parsed = _story_games_deserialize_environment_datetime(value)
    if not isinstance(parsed, datetime):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0)


def _serialize_story_environment_datetime(value: datetime | None) -> str:
    if not isinstance(value, datetime):
        return ""
    return _story_games_serialize_environment_datetime(value.replace(second=0, microsecond=0))


def _deserialize_story_environment_weather(value: str | None) -> dict[str, Any] | None:
    return _normalize_story_environment_weather_payload(_story_games_deserialize_environment_weather(value))


def _serialize_story_environment_weather(value: dict[str, Any] | None) -> str:
    return _story_games_serialize_environment_weather(_normalize_story_environment_weather_payload(value))


def _story_environment_season_label(value: datetime | None) -> str:
    if not isinstance(value, datetime):
        return ""
    if value.month in {12, 1, 2}:
        return "зима"
    if value.month in {3, 4, 5}:
        return "весна"
    if value.month in {6, 7, 8}:
        return "лето"
    return "осень"


def _story_environment_time_of_day_label(value: datetime | None) -> str:
    if not isinstance(value, datetime):
        return ""
    if 5 <= value.hour < 12:
        return "утро"
    if 12 <= value.hour < 18:
        return "день"
    if 18 <= value.hour < 23:
        return "вечер"
    return "ночь"


def _format_story_environment_datetime_prompt_facts(value: datetime | None) -> str:
    if not isinstance(value, datetime):
        return ""
    month_label = _STORY_ENVIRONMENT_MONTH_NAMES_RU[max(1, min(value.month, 12)) - 1]
    weekday_label = _STORY_ENVIRONMENT_WEEKDAY_NAMES_RU[value.weekday()]
    season_label = _story_environment_season_label(value)
    time_of_day = _story_environment_time_of_day_label(value)
    return (
        f"Дата: {value.day} {month_label} {value.year} года.\n"
        f"День недели: {weekday_label}.\n"
        f"Сезон: {season_label}.\n"
        f"Точное время сейчас: {value.strftime('%H:%M')}.\n"
        f"Часть суток: {time_of_day}."
    )


def _build_story_environment_time_prompt_card(game: StoryGame) -> dict[str, str] | None:
    if not _story_environment_time_enabled_for_game(game):
        return None
    current_datetime = _deserialize_story_environment_datetime(
        str(getattr(game, "environment_current_datetime", "") or "")
    )
    content = _format_story_environment_datetime_prompt_facts(current_datetime)
    if not content:
        return None
    title = str(getattr(monolith_main, "STORY_ENVIRONMENT_TIME_CARD_TITLE", "Время") or "Время")
    return {"title": f"Окружение: {title}", "content": content}


def _story_environment_date_key_from_value(value: datetime | str | None) -> str:
    parsed = value if isinstance(value, datetime) else _deserialize_story_environment_datetime(str(value or ""))
    if not isinstance(parsed, datetime):
        return ""
    return parsed.date().isoformat()


def _story_environment_next_date_key(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    try:
        parsed = datetime.fromisoformat(f"{normalized}T00:00")
    except ValueError:
        return ""
    return (parsed + timedelta(days=1)).date().isoformat()


def _story_environment_datetime_from_day_date(value: str, *, hour: int = 12) -> datetime | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(f"{normalized}T{max(0, min(int(hour), 23)):02d}:00")
    except (TypeError, ValueError):
        return None
    return parsed.replace(second=0, microsecond=0, tzinfo=None)


def _normalize_story_environment_weather_text(value: Any, *, max_chars: int = 180) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", " ").split()).strip()
    return normalized[: max(1, int(max_chars or 1))].rstrip()


def _normalize_story_environment_temperature(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(-80, min(numeric, 70))


def _normalize_story_environment_weather_timeline(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized_entries: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        next_entry: dict[str, Any] = {}
        start_time = _normalize_story_environment_weather_text(entry.get("start_time"), max_chars=5)
        end_time = _normalize_story_environment_weather_text(entry.get("end_time"), max_chars=5)
        if start_time:
            next_entry["start_time"] = start_time
        if end_time:
            next_entry["end_time"] = end_time
        summary = _normalize_story_environment_weather_text(entry.get("summary"), max_chars=120)
        if summary:
            next_entry["summary"] = summary
        temperature = _normalize_story_environment_temperature(entry.get("temperature_c"))
        if temperature is not None:
            next_entry["temperature_c"] = temperature
        for field_name in ("fog", "humidity", "wind"):
            field_value = _normalize_story_environment_weather_text(entry.get(field_name), max_chars=80)
            if field_value:
                next_entry[field_name] = field_value
        if next_entry:
            normalized_entries.append(next_entry)
    return normalized_entries[:8]


def _normalize_story_environment_weather_payload(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    if not isinstance(value, dict):
        return None
    payload: dict[str, Any] = {}
    for field_name, max_chars in (
        ("summary", 180),
        ("season", 48),
        ("month", 48),
        ("time_of_day", 48),
        ("fog", 80),
        ("humidity", 80),
        ("wind", 80),
        ("evidence", 220),
    ):
        field_value = _normalize_story_environment_weather_text(value.get(field_name), max_chars=max_chars)
        if field_value:
            payload[field_name] = field_value
    day_date = _story_environment_date_key_from_value(value.get("day_date"))
    if not day_date:
        raw_day_date = str(value.get("day_date") or "").strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_day_date):
            day_date = raw_day_date
    if day_date:
        payload["day_date"] = day_date
    temperature = _normalize_story_environment_temperature(value.get("temperature_c"))
    if temperature is not None:
        payload["temperature_c"] = temperature
    timeline = _normalize_story_environment_weather_timeline(value.get("timeline"))
    if timeline:
        payload["timeline"] = timeline
    return payload or None


def _default_story_environment_temperature_for_datetime(value: datetime | None) -> int:
    season = _story_environment_season_label(value)
    if season == "зима":
        return -4
    if season == "весна":
        return 10
    if season == "лето":
        return 22
    if season == "осень":
        return 9
    return 15


def _default_story_environment_summary(value: datetime | None, location: str = "") -> str:
    season = _story_environment_season_label(value) or "сезон не определен"
    time_of_day = _story_environment_time_of_day_label(value)
    place = _normalize_story_location_memory_label(location)
    if season == "зима":
        base = "прохладно, воздух сухой, небо частично затянуто"
    elif season == "лето":
        base = "тепло, переменная облачность, видимость хорошая"
    elif season == "весна":
        base = "свежо, переменная облачность, возможна сырость"
    elif season == "осень":
        base = "прохладно, облачно, воздух влажный"
    else:
        base = "умеренная погода без резких явлений"
    if place:
        return f"{base}; место действия: {place}; часть суток: {time_of_day or 'не определена'}"
    return f"{base}; часть суток: {time_of_day or 'не определена'}"


def _build_story_environment_canonical_timeline(
    *,
    reference_datetime: datetime | None,
    day_date: str,
    summary: str,
    temperature_c: int | None,
) -> list[dict[str, Any]]:
    temperature = temperature_c if temperature_c is not None else _default_story_environment_temperature_for_datetime(reference_datetime)
    entries: list[dict[str, Any]] = []
    for start_time, end_time, offset in (
        ("00:00", "06:00", -3),
        ("06:00", "12:00", 0),
        ("12:00", "18:00", 2),
        ("18:00", "00:00", -1),
    ):
        entry = {
            "start_time": start_time,
            "end_time": end_time,
            "summary": summary,
            "temperature_c": max(-80, min(70, temperature + offset)),
        }
        if day_date:
            entry["day_date"] = day_date
        entries.append(entry)
    return entries


def _repair_story_environment_weather_payload(
    weather_payload: dict[str, Any] | None,
    *,
    reference_datetime: datetime | None,
    supporting_text: str,
    target_day_date: str,
    ensure_timeline: bool = False,
    align_to_current_period: bool = False,
) -> dict[str, Any] | None:
    normalized = _normalize_story_environment_weather_payload(weather_payload) or {}
    day_date = target_day_date or _story_environment_date_key_from_value(reference_datetime) or normalized.get("day_date", "")
    summary = _normalize_story_environment_weather_text(normalized.get("summary"), max_chars=180)
    if not summary:
        summary = _default_story_environment_summary(reference_datetime, supporting_text)
    temperature = _normalize_story_environment_temperature(normalized.get("temperature_c"))
    if temperature is None:
        temperature = _default_story_environment_temperature_for_datetime(reference_datetime)
    repaired: dict[str, Any] = {
        **normalized,
        "summary": summary,
        "temperature_c": temperature,
    }
    if day_date:
        repaired["day_date"] = day_date
    if isinstance(reference_datetime, datetime):
        repaired.setdefault("season", _story_environment_season_label(reference_datetime))
        repaired.setdefault("month", _STORY_ENVIRONMENT_MONTH_NAMES_RU[max(1, min(reference_datetime.month, 12)) - 1])
        repaired.setdefault("time_of_day", _story_environment_time_of_day_label(reference_datetime))
    if ensure_timeline or not isinstance(repaired.get("timeline"), list):
        repaired["timeline"] = _build_story_environment_canonical_timeline(
            reference_datetime=reference_datetime,
            day_date=day_date,
            summary=summary,
            temperature_c=temperature,
        )
    if align_to_current_period and isinstance(reference_datetime, datetime) and isinstance(repaired.get("timeline"), list):
        current_minutes = reference_datetime.hour * 60 + reference_datetime.minute
        active_entry: dict[str, Any] | None = None
        for entry in repaired["timeline"]:
            if not isinstance(entry, dict):
                continue
            start_minutes = _story_environment_clock_time_to_minutes(entry.get("start_time"))
            end_minutes = _story_environment_clock_time_to_minutes(
                entry.get("end_time"),
                treat_midnight_as_end_of_day=str(entry.get("start_time") or "") != "00:00",
            )
            if start_minutes is None or end_minutes is None:
                continue
            if start_minutes <= current_minutes < end_minutes:
                active_entry = entry
                break
        if active_entry:
            for field_name in ("summary", "temperature_c", "fog", "humidity", "wind"):
                if field_name in active_entry:
                    repaired[field_name] = active_entry[field_name]
    return _normalize_story_environment_weather_payload(repaired)


def _story_environment_clock_time_to_minutes(
    value: Any,
    *,
    treat_midnight_as_end_of_day: bool = False,
) -> int | None:
    normalized = str(value or "").strip()
    try:
        hour_text, minute_text = normalized.split(":", 1)
        hours = int(hour_text)
        minutes = int(minute_text)
    except (TypeError, ValueError):
        return None
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    total = hours * 60 + minutes
    if treat_midnight_as_end_of_day and total == 0:
        return 24 * 60
    return total


def _build_story_weather_prompt_content_compact(
    *,
    current_weather: dict[str, Any] | None,
    tomorrow_weather: dict[str, Any] | None,
) -> str:
    def render(label: str, payload: dict[str, Any] | None) -> str:
        weather = _normalize_story_environment_weather_payload(payload)
        if not isinstance(weather, dict):
            return ""
        parts: list[str] = []
        for field_name, label_name in (
            ("summary", "сводка"),
            ("temperature_c", "температура"),
            ("fog", "туман"),
            ("humidity", "влажность"),
            ("wind", "ветер"),
            ("season", "сезон"),
            ("time_of_day", "часть суток"),
        ):
            value = weather.get(field_name)
            if value is None or value == "":
                continue
            if field_name == "temperature_c" and isinstance(value, int):
                parts.append(f"{label_name}: {value:+d}°C")
            else:
                parts.append(f"{label_name}: {value}")
        return f"{label}: {'; '.join(parts)}" if parts else ""

    lines = [
        line
        for line in (
            render("Сейчас", current_weather),
            render("Завтра", tomorrow_weather),
        )
        if line
    ]
    return "\n".join(lines).strip()


def _build_story_environment_weather_prompt_card(game: StoryGame) -> dict[str, str] | None:
    if not _story_environment_weather_enabled_for_game(game):
        return None
    content = _build_story_weather_prompt_content_compact(
        current_weather=_deserialize_story_environment_weather(
            str(getattr(game, "environment_current_weather", "") or "")
        ),
        tomorrow_weather=_deserialize_story_environment_weather(
            str(getattr(game, "environment_tomorrow_weather", "") or "")
        ),
    )
    if not content:
        return None
    title = str(getattr(monolith_main, "STORY_MEMORY_WEATHER_TITLE", "Погода и время") or "Погода и время")
    return {"title": f"Погода: {title}", "content": content}


def _seed_story_environment_weather_payload(
    *,
    game: StoryGame,
    current_location_content: str,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    current_datetime_override: str | None = None,
) -> dict[str, Any] | None:
    _ = (latest_user_prompt, previous_assistant_text, latest_assistant_text)
    current_datetime = _deserialize_story_environment_datetime(
        current_datetime_override
        if isinstance(current_datetime_override, str) and current_datetime_override.strip()
        else str(getattr(game, "environment_current_datetime", "") or "")
    )
    if current_datetime is None:
        current_datetime = datetime.now().replace(second=0, microsecond=0, tzinfo=None)
    current_day_date = _story_environment_date_key_from_value(current_datetime)
    tomorrow_day_date = _story_environment_next_date_key(current_day_date)
    existing_current = _deserialize_story_environment_weather(str(getattr(game, "environment_current_weather", "") or ""))
    existing_tomorrow = _deserialize_story_environment_weather(str(getattr(game, "environment_tomorrow_weather", "") or ""))
    supporting_text = "\n".join(
        part
        for part in (
            current_location_content,
            latest_user_prompt,
            previous_assistant_text,
            latest_assistant_text,
        )
        if str(part or "").strip()
    )
    current_weather = _repair_story_environment_weather_payload(
        existing_current,
        reference_datetime=current_datetime,
        supporting_text=supporting_text,
        target_day_date=current_day_date,
        ensure_timeline=True,
        align_to_current_period=True,
    )
    tomorrow_weather = _repair_story_environment_weather_payload(
        existing_tomorrow,
        reference_datetime=_story_environment_datetime_from_day_date(tomorrow_day_date, hour=12),
        supporting_text=supporting_text,
        target_day_date=tomorrow_day_date,
        ensure_timeline=False,
    )
    if not isinstance(current_weather, dict) or not isinstance(tomorrow_weather, dict):
        return None
    return {"current_weather": current_weather, "tomorrow_weather": tomorrow_weather}


def _ensure_story_environment_seeded(*, db: Session, game: StoryGame) -> bool:
    _ = db
    time_enabled = _story_environment_time_enabled_for_game(game)
    weather_enabled = _story_environment_weather_enabled_for_game(game)
    if not (time_enabled or weather_enabled):
        return False
    changed = False
    current_datetime = _deserialize_story_environment_datetime(str(getattr(game, "environment_current_datetime", "") or ""))
    if time_enabled and current_datetime is None:
        current_datetime = datetime.now().replace(second=0, microsecond=0, tzinfo=None)
        game.environment_current_datetime = _serialize_story_environment_datetime(current_datetime)
        changed = True
    if weather_enabled:
        current_weather = _deserialize_story_environment_weather(str(getattr(game, "environment_current_weather", "") or ""))
        tomorrow_weather = _deserialize_story_environment_weather(str(getattr(game, "environment_tomorrow_weather", "") or ""))
        if not isinstance(current_weather, dict) or not isinstance(tomorrow_weather, dict):
            seeded = _seed_story_environment_weather_payload(
                game=game,
                current_location_content=str(getattr(game, "current_location_label", "") or ""),
                latest_user_prompt="",
                previous_assistant_text="",
                latest_assistant_text=str(getattr(game, "opening_scene", "") or ""),
            )
            if isinstance(seeded, dict):
                next_current = seeded.get("current_weather")
                next_tomorrow = seeded.get("tomorrow_weather")
                if isinstance(next_current, dict):
                    serialized = _serialize_story_environment_weather(next_current)
                    if serialized != str(getattr(game, "environment_current_weather", "") or ""):
                        game.environment_current_weather = serialized
                        changed = True
                if isinstance(next_tomorrow, dict):
                    serialized = _serialize_story_environment_weather(next_tomorrow)
                    if serialized != str(getattr(game, "environment_tomorrow_weather", "") or ""):
                        game.environment_tomorrow_weather = serialized
                        changed = True
    if changed:
        try:
            db.flush()
        except Exception:
            pass
    return changed


def _sync_story_environment_state_for_assistant_message(*args: Any, **kwargs: Any) -> bool:
    _ = (args, kwargs)
    return False


def _sync_story_manual_environment_memory_blocks(*args: Any, **kwargs: Any) -> bool:
    _ = (args, kwargs)
    return False


def _restore_story_environment_state_from_latest_weather_memory_block(*args: Any, **kwargs: Any) -> bool:
    _ = (args, kwargs)
    return False


def _extract_story_memory_sentences(raw_content: str) -> list[str]:
    normalized = _normalize_story_message_content(raw_content)
    if not normalized:
        return []
    return [part.strip() for part in re.split(r"(?<=[.!?…])\s+", normalized) if part.strip()]


def _build_story_memory_summary_without_truncation(*, raw_content: str, **kwargs: Any) -> str:
    _ = kwargs
    return _normalize_story_message_content(raw_content)


def _evaluate_story_turn_memory_signal(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = (args, kwargs)
    return {"should_store": True, "score": 100}


def _should_store_story_raw_memory_turn(*args: Any, **kwargs: Any) -> bool:
    _ = (args, kwargs)
    return True


def _sync_story_raw_memory_blocks_for_recent_turns(
    *,
    db: Session,
    game: StoryGame,
    additional_assistant_message_ids: list[int] | None = None,
    **kwargs: Any,
) -> bool:
    _ = (additional_assistant_message_ids, kwargs)
    changed = False
    latest_ids = _list_story_latest_assistant_message_ids(db, game.id, limit=1)
    for assistant_id in latest_ids:
        message = db.get(StoryMessage, assistant_id)
        if message is None:
            continue
        user_prompt = _get_story_user_prompt_before_assistant_message(
            db,
            game_id=game.id,
            assistant_message_id=assistant_id,
        )
        changed = _upsert_story_raw_memory_block(
            db=db,
            game=game,
            assistant_message=message,
            latest_user_prompt=user_prompt,
            latest_assistant_text=str(getattr(message, "content", "") or ""),
        ) or changed
    return changed


def _optimize_story_memory_state(*, db: Session, game: StoryGame, **kwargs: Any) -> bool:
    max_model_requests = int(kwargs.pop("max_model_requests", 4) or 4)
    kwargs.pop("starting_assistant_message_id", None)
    kwargs.pop("max_assistant_messages", None)
    return _rebalance_story_memory_layers(db=db, game=game, max_model_requests=max_model_requests, **kwargs)


def _get_story_main_hero_name_for_memory(db: Session, *, game_id: int) -> str:
    for card in list_story_world_cards(db, game_id):
        if str(getattr(card, "kind", "") or "").strip().lower() == "main_hero":
            return str(getattr(card, "title", "") or "").strip()
    return ""


def _list_story_known_character_names_for_memory(db: Session, *, game_id: int) -> list[str]:
    names: list[str] = []
    for card in list_story_world_cards(db, game_id):
        if str(getattr(card, "kind", "") or "").strip().lower() in {"main_hero", "npc"}:
            title = str(getattr(card, "title", "") or "").strip()
            if title:
                names.append(title)
    return list(dict.fromkeys(names))


def _count_story_user_turns_before_assistant_message(db: Session, *, game_id: int, assistant_message_id: int) -> int:
    return len(
        list(
            db.scalars(
                select(StoryMessage.id).where(
                    StoryMessage.game_id == int(game_id),
                    StoryMessage.role == STORY_USER_ROLE,
                    StoryMessage.id < int(assistant_message_id),
                    StoryMessage.undone_at.is_(None),
                )
            )
        )
    )


def _sanitize_story_key_memory_content(raw_content: str) -> str:
    return _normalize_story_message_content(raw_content)


def _is_story_key_memory_content_valid(content: str) -> bool:
    return bool(_normalize_story_message_content(content))


def _extract_story_important_plot_card_payload_locally(*args: Any, **kwargs: Any) -> None:
    _ = (args, kwargs)
    return None


def _extract_story_important_plot_card_payload(
    *,
    db: Session,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    **kwargs: Any,
) -> tuple[str, str] | None:
    _ = kwargs
    player_turn = _normalize_story_message_content(latest_user_prompt)
    narrator_response = _normalize_story_assistant_text_for_memory(latest_assistant_text)
    if not player_turn and not narrator_response:
        return None

    existing_memories = [
        {
            "title": str(getattr(block, "title", "") or "").strip(),
            "summary": str(getattr(block, "content", "") or "").strip(),
        }
        for block in _list_story_memory_blocks(db, game.id)
        if _normalize_story_memory_layer(getattr(block, "layer", "")) == STORY_MEMORY_LAYER_KEY
    ][-40:]
    payload, _meta = _llm_service(gemini_only=True).call_json(
        messages=build_important_memory_messages(
            player_turn=player_turn,
            narrator_response=narrator_response,
            existing_memories=existing_memories,
        ),
        schema=ImportantMemoryPayload,
        module=LLM_IMPORTANT_MEMORY_PROMPT_NAME,
        game_id=game.id,
        max_tokens=450,
        max_attempts=STORY_IMPORTANT_MEMORY_MODEL_MAX_ATTEMPTS,
        request_timeout=(8.0, 90.0),
    )
    if not payload.should_store:
        return None
    title = _base_normalize_memory_title(payload.title)
    content = _sanitize_story_key_memory_content(payload.summary)
    if not _is_story_key_memory_content_valid(content):
        raise RuntimeError("Gemini important-memory module returned invalid content")
    return title, content


def _estimate_story_memory_similarity(left_value: str, right_value: str) -> float:
    left_tokens = set(_normalize_story_message_content(left_value).casefold().split())
    right_tokens = set(_normalize_story_message_content(right_value).casefold().split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens.intersection(right_tokens)) / max(min(len(left_tokens), len(right_tokens)), 1)


def _create_story_key_memory_block(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    title: str,
    content: str,
) -> bool:
    normalized_content = _sanitize_story_key_memory_content(content)
    if not normalized_content:
        return False
    normalized_title = _base_normalize_memory_title(title or "Важно: Важное событие")
    for block in _list_story_memory_blocks(db, game.id):
        if _normalize_story_memory_layer(block.layer) != STORY_MEMORY_LAYER_KEY:
            continue
        if _estimate_story_memory_similarity(block.content, normalized_content) >= 0.85:
            return False
    _create_story_memory_block(
        db=db,
        game_id=game.id,
        assistant_message_id=assistant_message.id,
        layer=STORY_MEMORY_LAYER_KEY,
        title=normalized_title,
        content=normalized_content,
    )
    return True
