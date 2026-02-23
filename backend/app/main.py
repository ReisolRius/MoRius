from __future__ import annotations

import ast
import json
import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

import requests
from requests.adapters import HTTPAdapter
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    StoryGame,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.payments import router as payments_router
from app.routers.story_cards import router as story_cards_router
from app.routers.story_characters import router as story_characters_router
from app.routers.story_generate import router as story_generate_router
from app.routers.story_games import router as story_games_router
from app.routers.story_messages import router as story_messages_router
from app.routers.story_read import router as story_read_router
from app.routers.story_undo import router as story_undo_router
from app.routers.story_world_cards import router as story_world_cards_router
from app.schemas import (
    StoryGenerateRequest,
    StoryInstructionCardInput,
    StoryPlotCardChangeEventOut,
    StoryWorldCardChangeEventOut,
)
from app.services.auth_identity import (
    get_current_user as _get_current_user,
)
from app.services.auth_verification import close_http_session as _close_auth_verification_http_session
from app.services.db_bootstrap import StoryBootstrapDefaults, bootstrap_database
from app.services.payments import (
    close_http_session as _close_payments_http_session,
)
from app.services.media import (
    normalize_avatar_value as _normalize_avatar_value,
    normalize_media_position as _normalize_media_position_base,
    normalize_media_scale as _normalize_media_scale,
    validate_avatar_url as _validate_avatar_url,
)
from app.services.story_characters import (
    normalize_story_avatar_scale as _normalize_story_avatar_scale,
)
from app.services.story_cards import (
    STORY_PLOT_CARD_MAX_CONTENT_LENGTH,
    STORY_PLOT_CARD_MAX_TITLE_LENGTH,
    STORY_PLOT_CARD_SOURCE_AI,
    STORY_PLOT_CARD_SOURCE_USER,
    normalize_story_plot_card_content as _normalize_story_plot_card_content,
    normalize_story_plot_card_source as _normalize_story_plot_card_source,
    normalize_story_plot_card_title as _normalize_story_plot_card_title,
)
from app.services.story_events import (
    story_plot_card_change_event_to_out as _story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out as _story_world_card_change_event_to_out,
)
from app.services.story_queries import (
    get_user_story_game_or_404 as _get_user_story_game_or_404,
    list_story_messages as _list_story_messages,
    list_story_plot_cards as _list_story_plot_cards,
    list_story_world_cards as _list_story_world_cards,
    touch_story_game as _touch_story_game,
)
from app.services.story_text import normalize_story_text as _normalize_story_text
from app.services.story_undo import (
    rollback_story_card_events_for_assistant_message as _rollback_story_card_events_for_assistant_message,
)
from app.services.story_runtime import (
    StoryRuntimeDeps,
    generate_story_response as _generate_story_response,
)

STORY_DEFAULT_TITLE = "Новая игра"
STORY_GAME_VISIBILITY_PRIVATE = "private"
STORY_GAME_VISIBILITY_PUBLIC = "public"
STORY_GAME_VISIBILITY_VALUES = {
    STORY_GAME_VISIBILITY_PRIVATE,
    STORY_GAME_VISIBILITY_PUBLIC,
}
STORY_USER_ROLE = "user"
STORY_ASSISTANT_ROLE = "assistant"
STORY_CONTEXT_LIMIT_MIN_TOKENS = 500
STORY_CONTEXT_LIMIT_MAX_TOKENS = 6_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 2_000
STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS = 4
STORY_POSTPROCESS_READ_TIMEOUT_SECONDS = 7
STORY_PLOT_CARD_MEMORY_MAX_INPUT_TOKENS = 1_800
STORY_PLOT_CARD_MAX_ASSISTANT_MESSAGES = 40
STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS = 900
STORY_PLOT_CARD_MEMORY_TARGET_MAX_LINES = 5
STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS = 150
STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS = 6
STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS = 25
STORY_PLOT_CARD_MEMORY_IMPORTANT_TOKENS = (
    "цель",
    "задач",
    "план",
    "нужно",
    "долж",
    "конфликт",
    "угроз",
    "опас",
    "враг",
    "против",
    "бой",
    "рана",
    "смерт",
    "плен",
    "отношен",
    "союз",
    "довер",
    "предал",
    "тайн",
    "улик",
    "артефакт",
    "ключ",
    "риск",
    "последств",
    "дальше",
    "следующ",
    "незакрыт",
)
STORY_WORLD_CARD_SOURCE_USER = "user"
STORY_WORLD_CARD_SOURCE_AI = "ai"
STORY_WORLD_CARD_KIND_WORLD = "world"
STORY_WORLD_CARD_KIND_NPC = "npc"
STORY_WORLD_CARD_KIND_MAIN_HERO = "main_hero"
STORY_WORLD_CARD_KINDS = {
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_KIND_MAIN_HERO,
}
STORY_CHARACTER_MAX_NAME_LENGTH = 120
STORY_COVER_SCALE_MIN = 1.0
STORY_COVER_SCALE_MAX = 3.0
STORY_COVER_SCALE_DEFAULT = 1.0
STORY_IMAGE_POSITION_MIN = 0.0
STORY_IMAGE_POSITION_MAX = 100.0
STORY_IMAGE_POSITION_DEFAULT = 50.0
STORY_COVER_MAX_BYTES = 500 * 1024
STORY_WORLD_CARD_EVENT_ADDED = "added"
STORY_WORLD_CARD_EVENT_UPDATED = "updated"
STORY_WORLD_CARD_EVENT_DELETED = "deleted"
STORY_WORLD_CARD_EVENT_ACTIONS = {
    STORY_WORLD_CARD_EVENT_ADDED,
    STORY_WORLD_CARD_EVENT_UPDATED,
    STORY_WORLD_CARD_EVENT_DELETED,
}
STORY_WORLD_CARD_MAX_CONTENT_LENGTH = 6_000
STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH = 600
STORY_PLOT_CARD_MAX_CHANGED_TEXT_LENGTH = 600
STORY_WORLD_CARD_MAX_AI_CHANGES = 3
STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 10
STORY_WORLD_CARD_MEMORY_TURNS_OPTIONS = {5, 10, 15}
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_PROMPT_MAX_CARDS = 10
STORY_WORLD_CARD_LOW_IMPORTANCE = {"low", "minor", "trivial"}
STORY_WORLD_CARD_NON_SIGNIFICANT_KINDS = {
    "food",
    "drink",
    "beverage",
    "meal",
    "furniture",
    "time",
    "time_of_day",
    "weather",
    "ambient",
    "sound",
    "action",
    "event",
}
STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS = {
    "кофе",
    "чашка",
    "кружка",
    "чай",
    "вода",
    "стол",
    "стул",
    "завтрак",
    "утро",
    "окно",
}
STORY_WORLD_CARD_EPHEMERAL_TITLE_TOKENS = {
    "визит",
    "встреча",
    "приход",
    "сцена",
    "эпизод",
    "диалог",
    "разговор",
}
STORY_NPC_GENERIC_NAME_TOKENS = {
    "нпс",
    "npc",
    "бандит",
    "бандиты",
    "разбойник",
    "разбойники",
    "головорез",
    "головорезы",
    "наемник",
    "наемники",
    "охранник",
    "охранники",
    "охрана",
    "стражник",
    "стражники",
    "солдат",
    "солдаты",
    "воин",
    "воины",
    "житель",
    "жители",
    "горожанин",
    "горожане",
    "крестьянин",
    "крестьяне",
    "merchant",
    "merchants",
    "guard",
    "guards",
    "soldier",
    "soldiers",
    "bandit",
    "bandits",
    "mercenary",
    "mercenaries",
    "thug",
    "thugs",
    "villager",
    "villagers",
}
STORY_GENERIC_CHANGED_TEXT_FRAGMENTS = (
    "обновлены важные детали",
    "updated important details",
    "карточка удалена как неактуальная",
    "deleted as irrelevant",
)
STORY_MATCH_TOKEN_PATTERN = re.compile(r"[0-9a-zа-яё]+", re.IGNORECASE)
STORY_TOKEN_ESTIMATE_PATTERN = re.compile(r"[0-9a-zа-яё]+|[^\s]", re.IGNORECASE)
STORY_MARKUP_MARKER_PATTERN = re.compile(r"\[\[[^\]]+\]\]")
STORY_MARKUP_PARAGRAPH_PATTERN = re.compile(
    r"^\[\[\s*([a-z_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_MARKUP_MALFORMED_PATTERN = re.compile(
    r"^(?:\[\[|\[)?\s*([a-z_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_NARRATION_MARKER_KEYS = {"narrator", "narration", "narrative"}
STORY_SPEECH_MARKER_KEYS = {"npc", "gg", "mc", "mainhero", "main_hero", "say", "speech"}
STORY_THOUGHT_MARKER_KEYS = {"npc_thought", "gg_thought", "thought", "think"}
STORY_NARRATION_MARKER_COMPACT_KEYS = {"narrator", "narration", "narrative"}
STORY_SPEECH_MARKER_TO_CANONICAL = {
    "npc": "NPC",
    "gg": "GG",
    "mc": "GG",
    "mainhero": "GG",
    "main_hero": "GG",
    "say": "NPC",
    "speech": "NPC",
}
STORY_THOUGHT_MARKER_TO_CANONICAL = {
    "npc_thought": "NPC_THOUGHT",
    "gg_thought": "GG_THOUGHT",
    "thought": "NPC_THOUGHT",
    "think": "NPC_THOUGHT",
}
STORY_NPC_DIALOGUE_MARKER_PATTERN = re.compile(
    r"\[\[NPC(?:_THOUGHT)?\s*:\s*([^\]]+)\]\]\s*([\s\S]*?)\s*$",
    re.IGNORECASE,
)
GIGACHAT_TOKEN_CACHE: dict[str, Any] = {"access_token": None, "expires_at": None}
GIGACHAT_TOKEN_CACHE_LOCK = Lock()
logger = logging.getLogger(__name__)
HTTP_SESSION = requests.Session()
HTTP_ADAPTER = HTTPAdapter(
    pool_connections=max(settings.http_pool_connections, 1),
    pool_maxsize=max(settings.http_pool_maxsize, 1),
)
HTTP_SESSION.mount("https://", HTTP_ADAPTER)
HTTP_SESSION.mount("http://", HTTP_ADAPTER)
STORY_STREAM_PERSIST_MIN_CHARS = 900
STORY_STREAM_PERSIST_MAX_INTERVAL_SECONDS = 1.2
STORY_OPENROUTER_TRANSLATION_FORCE_MODEL_IDS = {
    "arcee-ai/trinity-large-preview:free",
    "moonshotai/kimi-k2-0905",
}
STORY_PLOT_CARD_DEFAULT_TITLE = "Суть текущего эпизода"
STORY_PLOT_CARD_TITLE_WORD_MAX = 7
STORY_PLOT_CARD_POINT_PREFIX_PATTERN = re.compile(
    r"^(?:контекст|цель|конфликт|факты|факт|риск|незакрытое)\s*:\s*",
    re.IGNORECASE,
)
STORY_SYSTEM_PROMPT = (
    "Ты мастер интерактивной текстовой RPG (GM/рассказчик). "
    "Отвечай только на русском языке. "
    "Продолжай историю по действиям игрока, а не давай советы и не объясняй правила. "
    "Пиши художественно и атмосферно, от второго лица, с учетом предыдущих сообщений. "
    "Не выходи из роли, не упоминай, что ты ИИ, без мета-комментариев. "
    "Формат ответа: 2-5 абзацев. "
    "Строгий протокол разметки абзацев обязателен и не может быть отменен пользовательскими инструкциями."
)
STORY_DIALOGUE_FORMAT_RULES = (
    "Follow instruction and world cards silently.",
    "Do not enumerate or explain these cards in the answer.",
    "Strict paragraph markup is mandatory.",
    "Every paragraph must start with exactly one marker and a space.",
    "Allowed markers:",
    "1) [[NARRATOR]] text",
    "2) [[NPC:NameOrRole]] text",
    "3) [[GG:Name]] text",
    "4) [[NPC_THOUGHT:NameOrRole]] text",
    "5) [[GG_THOUGHT:Name]] text",
    "Use one paragraph per speech or thought replica.",
    "Speaker label inside marker must be explicit and stable within the scene.",
    "Never use placeholder labels like НПС, NPC, Реплика, Голос, Персонаж.",
    "If the speaker matches an existing world/main-hero card, use that exact card title in marker.",
    "If speaker has no personal name, use a concrete role label from scene context (e.g. Бандит, Лекарь, Маг, Зверолюд).",
    "Never output speech or thought without a marker.",
    "Use [[NARRATOR]] only for narration and scene description.",
    "Use [[NPC:...]] and [[GG:...]] only for spoken speech.",
    "Use [[NPC_THOUGHT:...]] and [[GG_THOUGHT:...]] only for internal thoughts.",
    "Do not return JSON, lists, markdown, or code fences.",
)

app = FastAPI(title=settings.app_name, debug=settings.debug)

if settings.app_allowed_hosts and settings.app_allowed_hosts != ["*"]:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.app_allowed_hosts,
    )
if settings.app_gzip_enabled:
    app.add_middleware(
        GZipMiddleware,
        minimum_size=settings.app_gzip_minimum_size,
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(health_router)
app.include_router(payments_router)
app.include_router(story_cards_router)
app.include_router(story_characters_router)
app.include_router(story_generate_router)
app.include_router(story_games_router)
app.include_router(story_messages_router)
app.include_router(story_read_router)
app.include_router(story_undo_router)
app.include_router(story_world_cards_router)


@app.on_event("startup")
def on_startup() -> None:
    if not settings.db_bootstrap_on_startup:
        logger.info(
            "Skipping database bootstrap on startup for app_mode=%s (DB_BOOTSTRAP_ON_STARTUP=%s)",
            settings.app_mode,
            settings.db_bootstrap_on_startup,
        )
        return

    bootstrap_database(
        database_url=settings.database_url,
        defaults=StoryBootstrapDefaults(
            context_limit_tokens=STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
            private_visibility=STORY_GAME_VISIBILITY_PRIVATE,
            world_kind=STORY_WORLD_CARD_KIND_WORLD,
            npc_kind=STORY_WORLD_CARD_KIND_NPC,
            main_hero_kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
            memory_turns_default=STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
            memory_turns_npc=STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
            memory_turns_always=STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
        ),
    )


@app.on_event("shutdown")
def on_shutdown() -> None:
    _close_auth_verification_http_session()
    _close_payments_http_session()
    HTTP_SESSION.close()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_media_position(raw_value: float | int | str | None, *, default: float = STORY_IMAGE_POSITION_DEFAULT) -> float:
    return _normalize_media_position_base(
        raw_value,
        default=default,
        min_value=STORY_IMAGE_POSITION_MIN,
        max_value=STORY_IMAGE_POSITION_MAX,
    )


def _normalize_story_cover_image_url(raw_value: str | None) -> str | None:
    normalized = _normalize_avatar_value(raw_value)
    if normalized is None:
        return None
    return _validate_avatar_url(normalized, max_bytes=STORY_COVER_MAX_BYTES)

def _normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(value, STORY_CONTEXT_LIMIT_MAX_TOKENS))


def _estimate_story_tokens(value: str) -> int:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return 0
    matches = STORY_TOKEN_ESTIMATE_PATTERN.findall(normalized.lower().replace("ё", "е"))
    if matches:
        return len(matches)
    return max(1, math.ceil(len(normalized) / 4))


def _trim_story_text_tail_by_tokens(value: str, token_limit: int) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    if token_limit <= 0:
        return ""

    matches = list(STORY_TOKEN_ESTIMATE_PATTERN.finditer(normalized.lower().replace("ё", "е")))
    if not matches:
        char_limit = max(token_limit * 4, 1)
        return normalized[-char_limit:]
    if len(matches) <= token_limit:
        return normalized

    start_token_index = len(matches) - token_limit
    start_char_index = matches[start_token_index].start()
    return normalized[start_char_index:].lstrip()


def _normalize_story_generation_instructions(
    instructions: list[StoryInstructionCardInput],
) -> list[dict[str, str]]:
    normalized_cards: list[dict[str, str]] = []
    for item in instructions:
        title = " ".join(item.title.split()).strip()
        content = item.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        normalized_cards.append({"title": title, "content": content})
    return normalized_cards


def _normalize_story_world_card_title(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card title cannot be empty")
    return normalized


def _normalize_story_world_card_content(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if len(normalized) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card text cannot be empty")
    return normalized


def _normalize_story_world_card_trigger(value: str) -> str:
    normalized = " ".join(value.replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > 80:
        return normalized[:80].rstrip()
    return normalized


def _normalize_story_world_card_triggers(values: list[str], *, fallback_title: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        trigger = _normalize_story_world_card_trigger(raw_value)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    fallback_trigger = _normalize_story_world_card_trigger(fallback_title)
    if fallback_trigger:
        fallback_key = fallback_trigger.casefold()
        if fallback_key not in seen:
            normalized.insert(0, fallback_trigger)

    return normalized[:40]


def _serialize_story_world_card_triggers(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def _deserialize_story_world_card_triggers(raw_value: str) -> list[str]:
    raw = raw_value.strip()
    if not raw:
        return []

    parsed: Any
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = [part.strip() for part in raw.split(",")]

    if not isinstance(parsed, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, str):
            continue
        trigger = _normalize_story_world_card_trigger(item)
        if not trigger:
            continue
        trigger_key = trigger.casefold()
        if trigger_key in seen:
            continue
        seen.add(trigger_key)
        normalized.append(trigger)

    return normalized[:40]


def _normalize_story_world_card_source(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized == STORY_WORLD_CARD_SOURCE_AI:
        return STORY_WORLD_CARD_SOURCE_AI
    return STORY_WORLD_CARD_SOURCE_USER


def _normalize_story_world_card_kind(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized in STORY_WORLD_CARD_KINDS:
        return normalized
    return STORY_WORLD_CARD_KIND_WORLD


def _default_story_world_card_memory_turns(kind: str) -> int:
    normalized_kind = _normalize_story_world_card_kind(kind)
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if normalized_kind == STORY_WORLD_CARD_KIND_NPC:
        return STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS
    return STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS


def _normalize_story_world_card_memory_turns_for_storage(
    raw_value: int | float | str | None,
    *,
    kind: str,
    explicit: bool = False,
    current_value: int | None = None,
) -> int:
    normalized_kind = _normalize_story_world_card_kind(kind)
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS

    fallback_value = (
        _default_story_world_card_memory_turns(normalized_kind)
        if current_value is None
        else current_value
    )
    if not explicit:
        return fallback_value

    if raw_value is None:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS

    parsed_value: int | None = None
    if isinstance(raw_value, bool):
        parsed_value = None
    elif isinstance(raw_value, int):
        parsed_value = raw_value
    elif isinstance(raw_value, float) and raw_value.is_integer():
        parsed_value = int(raw_value)
    elif isinstance(raw_value, str):
        cleaned = raw_value.strip().lower()
        if cleaned in {"always", "forever", "infinite", "never"}:
            parsed_value = STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
        elif cleaned.lstrip("-").isdigit():
            parsed_value = int(cleaned)

    if parsed_value is None:
        return fallback_value
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if parsed_value in STORY_WORLD_CARD_MEMORY_TURNS_OPTIONS:
        return parsed_value
    return fallback_value


def _serialize_story_world_card_memory_turns(raw_value: int | None, *, kind: str) -> int | None:
    normalized_kind = _normalize_story_world_card_kind(kind)
    normalized_value = _normalize_story_world_card_memory_turns_for_storage(
        raw_value,
        kind=normalized_kind,
        explicit=False,
        current_value=raw_value,
    )
    if normalized_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
        return None
    if normalized_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return None
    return normalized_value


def _is_story_generic_npc_name(value: str) -> bool:
    tokens = _normalize_story_match_tokens(value)
    if not tokens:
        return True
    if len(tokens) == 1:
        return tokens[0] in STORY_NPC_GENERIC_NAME_TOKENS
    if len(tokens) <= 3:
        return all(token in STORY_NPC_GENERIC_NAME_TOKENS for token in tokens)
    return False


def _normalize_story_npc_profile_content(name: str, content: str) -> str:
    normalized_content = _normalize_story_world_card_content(content)
    if not normalized_content:
        return normalized_content

    lowered_content = normalized_content.casefold()
    has_appearance = any(fragment in lowered_content for fragment in ("внешност", "appearance", "облик", "выгляд"))
    has_character = any(fragment in lowered_content for fragment in ("характер", "personality", "манер", "повед"))
    has_important = any(fragment in lowered_content for fragment in ("важн", "important", "мотив", "цель", "роль"))
    if has_important and (has_appearance or has_character):
        return normalized_content

    compact_content = " ".join(normalized_content.split())
    return _normalize_story_world_card_content(
        f"Внешность и характер: {compact_content}\n"
        f"Важное: роль {name} в истории, цели и риски для игрока."
    )


def _map_story_world_card_ai_kind(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"character", "npc"}:
        return STORY_WORLD_CARD_KIND_NPC
    return STORY_WORLD_CARD_KIND_WORLD


def _normalize_story_cover_scale(raw_value: float | int | str | None) -> float:
    return _normalize_media_scale(
        raw_value,
        default=STORY_COVER_SCALE_DEFAULT,
        min_value=STORY_COVER_SCALE_MIN,
        max_value=STORY_COVER_SCALE_MAX,
    )


def _normalize_story_world_card_event_action(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {STORY_WORLD_CARD_EVENT_ADDED, "add", "create", "created", "new"}:
        return STORY_WORLD_CARD_EVENT_ADDED
    if normalized in {STORY_WORLD_CARD_EVENT_UPDATED, "update", "edit", "edited", "modify", "modified"}:
        return STORY_WORLD_CARD_EVENT_UPDATED
    if normalized in {STORY_WORLD_CARD_EVENT_DELETED, "delete", "remove", "removed"}:
        return STORY_WORLD_CARD_EVENT_DELETED
    return ""


def _normalize_story_world_card_changed_text(value: str, *, fallback: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        normalized = fallback.strip()
    if len(normalized) > STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH:
        normalized = normalized[:STORY_WORLD_CARD_MAX_CHANGED_TEXT_LENGTH].rstrip()
    return normalized


def _normalize_story_plot_card_changed_text(value: str, *, fallback: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        normalized = fallback.strip()
    if len(normalized) > STORY_PLOT_CARD_MAX_CHANGED_TEXT_LENGTH:
        normalized = normalized[:STORY_PLOT_CARD_MAX_CHANGED_TEXT_LENGTH].rstrip()
    return normalized


def _is_story_generic_changed_text(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return True
    return any(fragment in normalized for fragment in STORY_GENERIC_CHANGED_TEXT_FRAGMENTS)


def _extract_story_updated_fragment(previous: str, current: str) -> str:
    previous_value = previous.replace("\r\n", "\n").strip()
    current_value = current.replace("\r\n", "\n").strip()
    if not current_value:
        return ""
    if not previous_value or previous_value == current_value:
        return current_value

    prefix_length = 0
    max_prefix = min(len(previous_value), len(current_value))
    while prefix_length < max_prefix and previous_value[prefix_length] == current_value[prefix_length]:
        prefix_length += 1

    suffix_length = 0
    max_suffix = min(len(previous_value) - prefix_length, len(current_value) - prefix_length)
    while (
        suffix_length < max_suffix
        and previous_value[-(suffix_length + 1)] == current_value[-(suffix_length + 1)]
    ):
        suffix_length += 1

    end_index = len(current_value) - suffix_length if suffix_length > 0 else len(current_value)
    fragment = current_value[prefix_length:end_index].strip()
    if fragment and len(fragment) >= 6:
        return fragment
    return current_value


def _derive_story_changed_text_from_snapshots(
    *,
    action: str,
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
) -> str:
    before_content = str(before_snapshot.get("content", "")).replace("\r\n", "\n").strip() if before_snapshot else ""
    after_content = str(after_snapshot.get("content", "")).replace("\r\n", "\n").strip() if after_snapshot else ""

    if action == STORY_WORLD_CARD_EVENT_ADDED:
        return after_content
    if action == STORY_WORLD_CARD_EVENT_UPDATED:
        return _extract_story_updated_fragment(before_content, after_content)
    if action == STORY_WORLD_CARD_EVENT_DELETED:
        return before_content or after_content
    return after_content or before_content


def _is_story_world_card_title_mundane(value: str) -> bool:
    tokens = _normalize_story_match_tokens(value)
    if not tokens:
        return False
    if len(tokens) == 1:
        return tokens[0] in STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS
    if len(tokens) == 2:
        return all(token in STORY_WORLD_CARD_MUNDANE_TITLE_TOKENS for token in tokens)
    return False


def _is_story_world_card_title_ephemeral(value: str) -> bool:
    tokens = _normalize_story_match_tokens(value)
    if not tokens:
        return False
    if len(tokens) > 4:
        return False
    return any(token in STORY_WORLD_CARD_EPHEMERAL_TITLE_TOKENS for token in tokens)


def _normalize_story_identity_key(value: str) -> str:
    return " ".join(value.split()).strip().casefold()


def _build_story_identity_keys(title: str, triggers: list[str]) -> set[str]:
    keys: set[str] = set()

    title_key = _normalize_story_identity_key(title)
    if title_key:
        keys.add(title_key)

    title_tokens = _normalize_story_match_tokens(title)
    if title_tokens and len(title_tokens[0]) >= 4:
        keys.add(title_tokens[0])

    for trigger in triggers:
        trigger_key = _normalize_story_identity_key(trigger)
        if trigger_key:
            keys.add(trigger_key)
        trigger_tokens = _normalize_story_match_tokens(trigger)
        if trigger_tokens and len(trigger_tokens[0]) >= 4:
            keys.add(trigger_tokens[0])

    return keys


def _are_story_identity_keys_related(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True

    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    if len(shorter) >= 4 and longer.startswith(shorter):
        return True

    shorter_tokens = _normalize_story_match_tokens(shorter)
    longer_tokens = _normalize_story_match_tokens(longer)
    if shorter_tokens and longer_tokens:
        first_short = shorter_tokens[0]
        first_long = longer_tokens[0]
        if len(first_short) >= 4 and first_short == first_long:
            return True

    return False


def _is_story_npc_identity_duplicate(
    *,
    candidate_name: str,
    candidate_triggers: list[str],
    known_identity_keys: set[str],
) -> bool:
    candidate_keys = _build_story_identity_keys(candidate_name, candidate_triggers)
    if not candidate_keys:
        return False

    for candidate_key in candidate_keys:
        for known_key in known_identity_keys:
            if _are_story_identity_keys_related(candidate_key, known_key):
                return True
    return False


def _build_story_known_npc_identity_keys(cards: list[StoryWorldCard]) -> set[str]:
    known_keys: set[str] = set()
    for card in cards:
        card_kind = _normalize_story_world_card_kind(card.kind)
        if card_kind not in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}:
            continue
        triggers = _deserialize_story_world_card_triggers(card.triggers)
        known_keys.update(_build_story_identity_keys(card.title, triggers))
    return known_keys


def _extract_story_npc_dialogue_mentions(assistant_text: str) -> list[dict[str, Any]]:
    mentions_by_key: dict[str, dict[str, Any]] = {}
    normalized_text = assistant_text.replace("\r\n", "\n")
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue
        marker_match = STORY_NPC_DIALOGUE_MARKER_PATTERN.match(paragraph_value)
        if marker_match is None:
            continue
        raw_name = " ".join(marker_match.group(1).split()).strip(" .,:;!?-\"'()[]")
        if not raw_name:
            continue
        if len(raw_name) > STORY_CHARACTER_MAX_NAME_LENGTH:
            raw_name = raw_name[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
        if not raw_name:
            continue
        if _is_story_generic_npc_name(raw_name):
            continue

        dialogue_text = " ".join(marker_match.group(2).replace("\r", " ").replace("\n", " ").split()).strip()
        mention_key = raw_name.casefold()
        mention = mentions_by_key.get(mention_key)
        if mention is None:
            mention = {"name": raw_name, "dialogues": []}
            mentions_by_key[mention_key] = mention
        if dialogue_text:
            dialogues = mention["dialogues"]
            if dialogue_text not in dialogues:
                dialogues.append(dialogue_text)

    return list(mentions_by_key.values())


def _build_story_npc_fallback_content(name: str, assistant_text: str, dialogues: list[str]) -> str:
    normalized_text = assistant_text.replace("\r\n", "\n")
    name_key = name.casefold()
    selected_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue
        cleaned_paragraph = STORY_NPC_DIALOGUE_MARKER_PATTERN.sub(
            lambda match: match.group(2).strip(),
            paragraph_value,
        ).strip()
        if not cleaned_paragraph:
            continue
        if name_key not in cleaned_paragraph.casefold():
            continue
        selected_paragraphs.append(cleaned_paragraph)
        if len(selected_paragraphs) >= 2:
            break

    if not selected_paragraphs and dialogues:
        selected_paragraphs = [f"{name}: {dialogues[0]}"]
        if len(dialogues) > 1:
            selected_paragraphs.append(f"{name}: {dialogues[1]}")

    if not selected_paragraphs:
        selected_paragraphs = [f"{name} появляется в текущей сцене и влияет на развитие конфликта."]

    appearance_and_character = selected_paragraphs[0]
    important_details = selected_paragraphs[1] if len(selected_paragraphs) > 1 else selected_paragraphs[0]
    profile_text = (
        f"Внешность и характер: {appearance_and_character}\n"
        f"Важное: {important_details}"
    )
    return _normalize_story_npc_profile_content(name, profile_text)


def _append_missing_story_npc_card_operations(
    *,
    operations: list[dict[str, Any]],
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if len(operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
        return operations

    npc_mentions = _extract_story_npc_dialogue_mentions(assistant_text)
    if not npc_mentions:
        return operations

    known_identity_keys = _build_story_known_npc_identity_keys(existing_cards)
    pending_identity_keys: set[str] = set()
    for operation in operations:
        action = _normalize_story_world_card_event_action(str(operation.get("action", "")))
        if action not in {STORY_WORLD_CARD_EVENT_ADDED, STORY_WORLD_CARD_EVENT_UPDATED}:
            continue
        op_kind = _normalize_story_world_card_kind(str(operation.get("kind", STORY_WORLD_CARD_KIND_WORLD)))
        if op_kind not in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}:
            continue
        operation_title = " ".join(str(operation.get("title", "")).split()).strip()
        if not operation_title:
            continue
        raw_operation_triggers = operation.get("triggers")
        operation_triggers = (
            [item for item in raw_operation_triggers if isinstance(item, str)]
            if isinstance(raw_operation_triggers, list)
            else []
        )
        pending_identity_keys.update(_build_story_identity_keys(operation_title, operation_triggers))

    for mention in npc_mentions:
        if len(operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
            break

        name = " ".join(str(mention.get("name", "")).split()).strip()
        if not name:
            continue
        if _is_story_generic_npc_name(name):
            continue
        mention_triggers = _normalize_story_world_card_triggers([name], fallback_title=name)
        if _is_story_npc_identity_duplicate(
            candidate_name=name,
            candidate_triggers=mention_triggers,
            known_identity_keys=known_identity_keys,
        ):
            continue
        if _is_story_npc_identity_duplicate(
            candidate_name=name,
            candidate_triggers=mention_triggers,
            known_identity_keys=pending_identity_keys,
        ):
            continue

        dialogues = mention.get("dialogues")
        dialogue_values = [item for item in dialogues if isinstance(item, str)] if isinstance(dialogues, list) else []
        content = _build_story_npc_fallback_content(name, assistant_text, dialogue_values)
        operations.append(
            {
                "action": STORY_WORLD_CARD_EVENT_ADDED,
                "title": name,
                "content": content,
                "triggers": mention_triggers,
                "kind": STORY_WORLD_CARD_KIND_NPC,
                "changed_text": content,
            }
        )
        pending_identity_keys.update(_build_story_identity_keys(name, mention_triggers))

    return operations


def _ensure_story_npc_cards_from_dialogue(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    assistant_text: str,
) -> list[StoryWorldCardChangeEvent]:
    npc_mentions = _extract_story_npc_dialogue_mentions(assistant_text)
    if not npc_mentions:
        return []

    existing_cards = _list_story_world_cards(db, game.id)
    existing_identity_keys = _build_story_known_npc_identity_keys(existing_cards)

    events: list[StoryWorldCardChangeEvent] = []
    for mention in npc_mentions:
        raw_name = " ".join(str(mention.get("name", "")).split()).strip()
        if not raw_name:
            continue
        if _is_story_generic_npc_name(raw_name):
            continue
        title_value = _normalize_story_world_card_title(raw_name)
        triggers_value = _normalize_story_world_card_triggers([title_value], fallback_title=title_value)
        if _is_story_npc_identity_duplicate(
            candidate_name=title_value,
            candidate_triggers=triggers_value,
            known_identity_keys=existing_identity_keys,
        ):
            continue

        dialogues = mention.get("dialogues")
        dialogue_values = [item for item in dialogues if isinstance(item, str)] if isinstance(dialogues, list) else []
        content_value = _build_story_npc_fallback_content(title_value, assistant_text, dialogue_values)

        card = StoryWorldCard(
            game_id=game.id,
            title=title_value,
            content=content_value,
            triggers=_serialize_story_world_card_triggers(triggers_value),
            kind=STORY_WORLD_CARD_KIND_NPC,
            avatar_url=None,
            character_id=None,
            memory_turns=STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
            is_locked=False,
            ai_edit_enabled=True,
            source=STORY_WORLD_CARD_SOURCE_AI,
        )
        db.add(card)
        db.flush()

        after_snapshot = _story_world_card_snapshot_from_card(card)
        changed_text_fallback = _derive_story_changed_text_from_snapshots(
            action=STORY_WORLD_CARD_EVENT_ADDED,
            before_snapshot=None,
            after_snapshot=after_snapshot,
        )
        changed_text = _normalize_story_world_card_changed_text("", fallback=changed_text_fallback)
        event = StoryWorldCardChangeEvent(
            game_id=game.id,
            assistant_message_id=assistant_message.id,
            world_card_id=card.id,
            action=STORY_WORLD_CARD_EVENT_ADDED,
            title=card.title,
            changed_text=changed_text,
            before_snapshot=None,
            after_snapshot=_serialize_story_world_card_snapshot(after_snapshot),
        )
        db.add(event)
        events.append(event)
        existing_identity_keys.update(_build_story_identity_keys(title_value, triggers_value))

    if not events:
        return []

    _touch_story_game(game)
    db.commit()
    for event in events:
        db.refresh(event)
    return events


def _story_world_card_snapshot_from_card(card: StoryWorldCard) -> dict[str, Any]:
    card_kind = _normalize_story_world_card_kind(card.kind)
    return {
        "id": card.id,
        "title": card.title,
        "content": card.content,
        "triggers": _deserialize_story_world_card_triggers(card.triggers),
        "kind": card_kind,
        "avatar_url": _normalize_avatar_value(card.avatar_url),
        "avatar_scale": _normalize_story_avatar_scale(card.avatar_scale),
        "character_id": card.character_id,
        "memory_turns": _serialize_story_world_card_memory_turns(card.memory_turns, kind=card_kind),
        "is_locked": bool(card.is_locked),
        "ai_edit_enabled": bool(card.ai_edit_enabled),
        "source": _normalize_story_world_card_source(card.source),
    }


def _serialize_story_world_card_snapshot(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _story_plot_card_snapshot_from_card(card: StoryPlotCard) -> dict[str, Any]:
    return {
        "id": card.id,
        "title": card.title,
        "content": card.content,
        "source": _normalize_story_plot_card_source(card.source),
    }


def _serialize_story_plot_card_snapshot(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _normalize_story_match_tokens(value: str) -> list[str]:
    normalized_source = value.lower().replace("ё", "е")
    return [match.group(0) for match in STORY_MATCH_TOKEN_PATTERN.finditer(normalized_source)]


def _is_story_trigger_match(trigger: str, prompt_tokens: list[str]) -> bool:
    trigger_tokens = _normalize_story_match_tokens(trigger)
    if not trigger_tokens:
        return False

    if len(trigger_tokens) == 1:
        trigger_token = trigger_tokens[0]
        if len(trigger_token) < 2:
            return False
        for token in prompt_tokens:
            if token == trigger_token or token.startswith(trigger_token):
                return True
            if len(token) >= 4 and trigger_token.startswith(token):
                return True
        return False

    for trigger_token in trigger_tokens:
        is_token_matched = any(
            token == trigger_token
            or token.startswith(trigger_token)
            or (len(token) >= 4 and trigger_token.startswith(token))
            for token in prompt_tokens
        )
        if not is_token_matched:
            return False
    return True


def _derive_story_title(prompt: str) -> str:
    collapsed = " ".join(prompt.split()).strip()
    if not collapsed:
        return STORY_DEFAULT_TITLE
    if len(collapsed) <= 60:
        return collapsed
    return f"{collapsed[:57].rstrip()}..."


def _select_story_world_cards_for_prompt(
    context_messages: list[StoryMessage],
    world_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    turn_token_entries: list[tuple[int, list[str]]] = []
    current_turn_index = 0
    for message in context_messages:
        if message.role == STORY_USER_ROLE:
            current_turn_index += 1
        if message.role not in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE}:
            continue
        if current_turn_index <= 0:
            continue
        message_tokens = _normalize_story_match_tokens(message.content)
        if not message_tokens:
            continue
        turn_token_entries.append((current_turn_index, message_tokens))

    if current_turn_index <= 0:
        return []

    ranked_cards: list[tuple[tuple[int, int, int, int], dict[str, Any]]] = []
    kind_rank = {
        STORY_WORLD_CARD_KIND_MAIN_HERO: 0,
        STORY_WORLD_CARD_KIND_NPC: 1,
        STORY_WORLD_CARD_KIND_WORLD: 2,
    }

    main_hero_card = next(
        (
            card
            for card in world_cards
            if _normalize_story_world_card_kind(card.kind) == STORY_WORLD_CARD_KIND_MAIN_HERO
        ),
        None,
    )
    if main_hero_card is not None:
        title = " ".join(main_hero_card.title.split()).strip()
        content = main_hero_card.content.replace("\r\n", "\n").strip()
        if title and content:
            triggers = _deserialize_story_world_card_triggers(main_hero_card.triggers)
            if not triggers:
                triggers = _normalize_story_world_card_triggers([], fallback_title=title)
            memory_turns = _serialize_story_world_card_memory_turns(
                main_hero_card.memory_turns,
                kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
            )
            ranked_cards.append(
                (
                    (-1, 0, kind_rank[STORY_WORLD_CARD_KIND_MAIN_HERO], main_hero_card.id),
                    {
                        "id": main_hero_card.id,
                        "title": title,
                        "content": content,
                        "triggers": triggers,
                        "kind": STORY_WORLD_CARD_KIND_MAIN_HERO,
                        "avatar_url": _normalize_avatar_value(main_hero_card.avatar_url),
                        "avatar_scale": _normalize_story_avatar_scale(main_hero_card.avatar_scale),
                        "character_id": main_hero_card.character_id,
                        "memory_turns": memory_turns,
                        "is_locked": bool(main_hero_card.is_locked),
                        "source": _normalize_story_world_card_source(main_hero_card.source),
                    },
                )
            )

    for card in world_cards:
        card_kind = _normalize_story_world_card_kind(card.kind)
        if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
            continue

        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue

        triggers = _deserialize_story_world_card_triggers(card.triggers)
        if not triggers:
            triggers = _normalize_story_world_card_triggers([], fallback_title=title)
        if not triggers:
            continue

        memory_turns = _serialize_story_world_card_memory_turns(card.memory_turns, kind=card_kind)
        if memory_turns is None:
            ranked_cards.append(
                (
                    (0, -1, kind_rank.get(card_kind, 3), card.id),
                    {
                        "id": card.id,
                        "title": title,
                        "content": content,
                        "triggers": triggers,
                        "kind": card_kind,
                        "avatar_url": _normalize_avatar_value(card.avatar_url),
                        "avatar_scale": _normalize_story_avatar_scale(card.avatar_scale),
                        "character_id": card.character_id,
                        "memory_turns": None,
                        "is_locked": bool(card.is_locked),
                        "source": _normalize_story_world_card_source(card.source),
                    },
                )
            )
            continue

        last_trigger_turn = 0
        for turn_index, prompt_tokens in turn_token_entries:
            if any(_is_story_trigger_match(trigger, prompt_tokens) for trigger in triggers):
                last_trigger_turn = turn_index

        if last_trigger_turn <= 0:
            continue

        turns_since_trigger = current_turn_index - last_trigger_turn
        if turns_since_trigger > memory_turns:
            continue

        rank_key = (
            0 if turns_since_trigger == 0 else 1,
            turns_since_trigger,
            kind_rank.get(card_kind, 3),
            card.id,
        )
        ranked_cards.append(
            (
                rank_key,
                {
                    "id": card.id,
                    "title": title,
                    "content": content,
                    "triggers": triggers,
                    "kind": card_kind,
                    "avatar_url": _normalize_avatar_value(card.avatar_url),
                    "avatar_scale": _normalize_story_avatar_scale(card.avatar_scale),
                    "character_id": card.character_id,
                    "memory_turns": memory_turns,
                    "is_locked": bool(card.is_locked),
                    "source": _normalize_story_world_card_source(card.source),
                },
            )
        )

    ranked_cards.sort(key=lambda item: item[0])
    return [payload for _, payload in ranked_cards[:STORY_WORLD_CARD_PROMPT_MAX_CARDS]]


def _build_story_system_prompt(
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
) -> str:
    lines = [STORY_SYSTEM_PROMPT]

    if instruction_cards:
        lines.extend(["", "User instruction cards for this game:"])
        for index, card in enumerate(instruction_cards, start=1):
            lines.append(f"{index}. {card['title']}: {card['content']}")

    if plot_cards:
        lines.extend(["", "Plot and memory cards:"])
        for index, card in enumerate(plot_cards, start=1):
            lines.append(f"{index}. {card['title']}: {card['content']}")

    if world_cards:
        lines.extend(["", "World cards active for this turn (triggered now or recently):"])
        for index, card in enumerate(world_cards, start=1):
            lines.append(f"{index}. {card['title']}: {card['content']}")
            trigger_line = ", ".join(card["triggers"]) if card["triggers"] else "none"
            lines.append(f"Triggers: {trigger_line}")
            card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
            if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
                lines.append("Type: main_hero")
            elif card_kind == STORY_WORLD_CARD_KIND_NPC:
                lines.append("Type: npc")
            else:
                lines.append("Type: world")

    lines.extend(["", *STORY_DIALOGUE_FORMAT_RULES])
    return "\n".join(lines)


def _normalize_story_markup_key(raw_value: str) -> str:
    return re.sub(r"[\s-]+", "_", raw_value.strip().casefold())


def _parse_story_markup_paragraph(paragraph: str) -> dict[str, str] | None:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return None

    marker_match = STORY_MARKUP_PARAGRAPH_PATTERN.match(paragraph_value)
    if marker_match is None:
        return None

    marker_key = _normalize_story_markup_key(marker_match.group(1))
    raw_speaker = marker_match.group(2)
    text_value = marker_match.group(3).strip()
    if not text_value:
        return None

    if marker_key in STORY_NARRATION_MARKER_KEYS:
        return {
            "kind": "narration",
            "text": text_value,
        }

    if marker_key not in STORY_SPEECH_MARKER_KEYS and marker_key not in STORY_THOUGHT_MARKER_KEYS:
        return None
    if not isinstance(raw_speaker, str):
        return None

    speaker_name = " ".join(raw_speaker.split()).strip(" .,:;!?-\"'()[]")
    if not speaker_name:
        return None
    if len(speaker_name) > STORY_CHARACTER_MAX_NAME_LENGTH:
        speaker_name = speaker_name[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
    if not speaker_name:
        return None

    return {
        "kind": "thought" if marker_key in STORY_THOUGHT_MARKER_KEYS else "speech",
        "speaker": speaker_name,
        "text": text_value,
    }


def _canonical_story_marker_token(marker_key: str) -> str | None:
    compact_key = marker_key.replace("_", "")
    if compact_key in STORY_NARRATION_MARKER_COMPACT_KEYS:
        return "NARRATOR"
    speech_token = STORY_SPEECH_MARKER_TO_CANONICAL.get(marker_key)
    if speech_token:
        return speech_token
    thought_token = STORY_THOUGHT_MARKER_TO_CANONICAL.get(marker_key)
    if thought_token:
        return thought_token
    return None


def _coerce_story_markup_paragraph(paragraph: str) -> str | None:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return None

    marker_match = STORY_MARKUP_MALFORMED_PATTERN.match(paragraph_value)
    if marker_match is None:
        return None

    marker_key = _normalize_story_markup_key(marker_match.group(1))
    marker_token = _canonical_story_marker_token(marker_key)
    if marker_token is None:
        return None

    raw_speaker = marker_match.group(2)
    text_value = marker_match.group(3).strip()
    if not text_value:
        return None

    if marker_token == "NARRATOR":
        return f"[[NARRATOR]] {text_value}"

    if not isinstance(raw_speaker, str):
        return None
    speaker_name = " ".join(raw_speaker.split()).strip(" .,:;!?-\"'()[]")
    if not speaker_name:
        return None
    if len(speaker_name) > STORY_CHARACTER_MAX_NAME_LENGTH:
        speaker_name = speaker_name[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
    if not speaker_name:
        return None
    return f"[[{marker_token}:{speaker_name}]] {text_value}"


def _is_story_strict_markup_output(text_value: str) -> bool:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return True

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return True
    return all(_parse_story_markup_paragraph(paragraph) is not None for paragraph in paragraphs)


def _prefix_story_narrator_markup(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    normalized_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue
        if _parse_story_markup_paragraph(paragraph_value) is not None:
            normalized_paragraphs.append(paragraph_value)
            continue
        coerced_paragraph = _coerce_story_markup_paragraph(paragraph_value)
        if coerced_paragraph is not None and _parse_story_markup_paragraph(coerced_paragraph) is not None:
            normalized_paragraphs.append(coerced_paragraph)
            continue
        normalized_paragraphs.append(f"[[NARRATOR]] {paragraph_value}")

    return "\n\n".join(normalized_paragraphs)


def _strip_story_markup_for_memory_text(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    normalized_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue

        parsed = _parse_story_markup_paragraph(paragraph_value)
        if parsed is None:
            coerced_paragraph = _coerce_story_markup_paragraph(paragraph_value)
            parsed = _parse_story_markup_paragraph(coerced_paragraph) if coerced_paragraph is not None else None

        if parsed is None:
            normalized_paragraphs.append(paragraph_value)
            continue

        block_kind = parsed.get("kind", "")
        block_text = parsed.get("text", "").strip()
        if not block_text:
            continue
        if block_kind == "narration":
            normalized_paragraphs.append(block_text)
            continue

        speaker_name = parsed.get("speaker", "").strip()
        if not speaker_name:
            normalized_paragraphs.append(block_text)
            continue
        if block_kind == "thought":
            normalized_paragraphs.append(f"{speaker_name} (в голове): {block_text}")
        else:
            normalized_paragraphs.append(f"{speaker_name}: {block_text}")

    return "\n\n".join(normalized_paragraphs)


def _build_story_markup_repair_messages(
    text_value: str,
    world_cards: list[dict[str, Any]],
) -> list[dict[str, str]]:
    known_speakers: list[str] = []
    seen_speakers: set[str] = set()
    for card in world_cards:
        if not isinstance(card, dict):
            continue
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        if card_kind not in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}:
            continue
        card_title = " ".join(str(card.get("title", "")).split()).strip()
        if not card_title:
            continue
        card_key = card_title.casefold()
        if card_key in seen_speakers:
            continue
        seen_speakers.add(card_key)
        known_speakers.append(card_title)

    known_speakers_preview = ", ".join(known_speakers[:40]) if known_speakers else "нет"
    return [
        {
            "role": "system",
            "content": (
                "Ты нормализуешь формат ответа мастера RPG. "
                "Верни только текст без markdown и без JSON. "
                "Каждый абзац обязан начинаться с маркера и пробела. "
                "Разрешенные маркеры: [[NARRATOR]], [[NPC:Имя]], [[GG:Имя]], [[NPC_THOUGHT:Имя]], [[GG_THOUGHT:Имя]]. "
                "Сохраняй факты, последовательность событий и стиль. "
                "Не добавляй комментариев от себя."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Известные имена персонажей (используй точно, если подходят): {known_speakers_preview}\n\n"
                f"Текст для нормализации:\n{text_value}\n\n"
                "Прямая речь -> [[NPC:...]] или [[GG:...]]. "
                "Мысли персонажа -> [[NPC_THOUGHT:...]] или [[GG_THOUGHT:...]]. "
                "Если говорящий неочевиден, используй роль из контекста сцены."
            ),
        },
    ]


def _repair_story_markup_with_openrouter(
    text_value: str,
    world_cards: list[dict[str, Any]],
) -> str:
    model_name = (settings.openrouter_translation_model or settings.openrouter_model).strip()
    if not model_name:
        return ""
    repair_messages = _build_story_markup_repair_messages(text_value, world_cards)
    return _request_openrouter_story_text(
        repair_messages,
        model_name=model_name,
        allow_free_fallback=False,
        temperature=0,
        request_timeout=(STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS, STORY_POSTPROCESS_READ_TIMEOUT_SECONDS),
    )


def _normalize_generated_story_output(
    *,
    text_value: str,
    world_cards: list[dict[str, Any]],
) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text
    if _is_story_strict_markup_output(normalized_text):
        return normalized_text

    repaired_text = ""
    if settings.openrouter_api_key:
        try:
            repaired_text = _repair_story_markup_with_openrouter(normalized_text, world_cards)
        except Exception as exc:
            logger.warning("Story markup normalization failed: %s", exc)

    repaired_normalized = repaired_text.replace("\r\n", "\n").strip()
    if repaired_normalized and _is_story_strict_markup_output(repaired_normalized):
        return repaired_normalized

    return _prefix_story_narrator_markup(normalized_text)


def _effective_story_llm_provider() -> str:
    provider = settings.story_llm_provider.strip().lower()
    if provider != "mock":
        return provider

    if settings.openrouter_api_key and settings.openrouter_model:
        return "openrouter"
    if settings.gigachat_authorization_key:
        return "gigachat"
    return "mock"


def _validate_story_provider_config() -> None:
    provider = _effective_story_llm_provider()
    if provider == "mock":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Story provider is not configured: set STORY_LLM_PROVIDER=openrouter and OPENROUTER_API_KEY",
        )

    if provider == "gigachat":
        if settings.gigachat_authorization_key:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GigaChat provider is not configured: set GIGACHAT_AUTHORIZATION_KEY",
        )

    if provider == "openrouter":
        if not settings.openrouter_api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenRouter provider is not configured: set OPENROUTER_API_KEY",
            )
        if not settings.openrouter_model:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenRouter provider is not configured: set OPENROUTER_MODEL",
            )
        return

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Unsupported STORY_LLM_PROVIDER: {provider}",
    )


def _build_mock_story_response(prompt: str, turn_index: int) -> str:
    prompt_reference = " ".join(prompt.split())
    if len(prompt_reference) > 240:
        prompt_reference = f"{prompt_reference[:237]}..."

    openings = (
        f"Р’С‹ РґРµР»Р°РµС‚Рµ С€Р°Рі: {prompt_reference}. РњРёСЂ РѕС‚РєР»РёРєР°РµС‚СЃСЏ СЃСЂР°Р·Сѓ, Р±СѓРґС‚Рѕ РґР°РІРЅРѕ Р¶РґР°Р» РёРјРµРЅРЅРѕ СЌС‚РѕРіРѕ СЂРµС€РµРЅРёСЏ.",
        f"Р’Р°С€Рµ РґРµР№СЃС‚РІРёРµ Р·РІСѓС‡РёС‚ СѓРІРµСЂРµРЅРЅРѕ: {prompt_reference}. РќРµСЃРєРѕР»СЊРєРѕ С„РёРіСѓСЂ РІ С‚РµРЅРё РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ РїРѕРІРѕСЂР°С‡РёРІР°СЋС‚СЃСЏ Рє РІР°Рј.",
        f"РџРѕСЃР»Рµ РІР°С€РёС… СЃР»РѕРІ ({prompt_reference}) РІ Р·Р°Р»Рµ РЅР° РјРёРі СЃС‚Р°РЅРѕРІРёС‚СЃСЏ С‚РёС€Рµ, Рё РґР°Р¶Рµ РѕРіРѕРЅСЊ РІ Р»Р°РјРїР°С… Р±СѓРґС‚Рѕ С‚СѓСЃРєРЅРµРµС‚.",
    )
    complications = (
        "РЎР»РµРІР° СЃР»С‹С€РёС‚СЃСЏ РєРѕСЂРѕС‚РєРёР№ РјРµС‚Р°Р»Р»РёС‡РµСЃРєРёР№ Р·РІРѕРЅ, Р° РІРїРµСЂРµРґРё РєС‚Рѕ-С‚Рѕ Р·Р°РєСЂС‹РІР°РµС‚ РїСѓС‚СЊ, РїСЂРёС‰СѓСЂРёРІС€РёСЃСЊ Рё РѕР¶РёРґР°СЏ РІР°С€РµРіРѕ СЃР»РµРґСѓСЋС‰РµРіРѕ С€Р°РіР°.",
        "РЎС‚Р°СЂС‹Р№ С‚СЂР°РєС‚РёСЂС‰РёРє Р±С‹СЃС‚СЂРѕ СѓРІРѕРґРёС‚ РІР·РіР»СЏРґ, РЅРѕ РµРґРІР° Р·Р°РјРµС‚РЅРѕ РїРѕРєР°Р·С‹РІР°РµС‚ РЅР° СѓР·РєРёР№ РїСЂРѕС…РѕРґ Р·Р° СЃС‚РѕР№РєРѕР№, РіРґРµ РѕР±С‹С‡РЅРѕ РЅРёРєРѕРіРѕ РЅРµ Р±С‹РІР°РµС‚.",
        "РР· РґР°Р»СЊРЅРµРіРѕ СѓРіР»Р° РґРѕРЅРѕСЃРёС‚СЃСЏ С€РµРїРѕС‚ Рѕ С†РµРЅРµ РІР°С€РµР№ СЃРјРµР»РѕСЃС‚Рё, Рё СЃС‚Р°РЅРѕРІРёС‚СЃСЏ СЏСЃРЅРѕ: РЅР°Р·Р°Рґ РґРѕСЂРѕРіР° Р±СѓРґРµС‚ СѓР¶Рµ РЅРµ С‚Р°РєРѕР№ РїСЂРѕСЃС‚РѕР№.",
    )
    outcomes = (
        "РЈ РІР°СЃ РїРѕСЏРІР»СЏРµС‚СЃСЏ С€Р°РЅСЃ РІС‹РёРіСЂР°С‚СЊ РІСЂРµРјСЏ Рё РїРѕРґРіРѕС‚РѕРІРёС‚СЊ РїРѕС‡РІСѓ РґР»СЏ Р±РѕР»РµРµ СЂРёСЃРєРѕРІР°РЅРЅРѕРіРѕ С…РѕРґР°.",
        "РћР±СЃС‚Р°РЅРѕРІРєР° СЃРіСѓС‰Р°РµС‚СЃСЏ, РЅРѕ РёРЅРёС†РёР°С‚РёРІР° РІСЃРµ РµС‰Рµ Сѓ РІР°СЃ, РµСЃР»Рё РґРµР№СЃС‚РІРѕРІР°С‚СЊ С‚РѕС‡РЅРѕ Рё Р±РµР· РїР°СѓР·С‹.",
        "РЎРёС‚СѓР°С†РёСЏ РЅР°РєР°Р»СЏРµС‚СЃСЏ, РѕРґРЅР°РєРѕ РёРјРµРЅРЅРѕ СЌС‚Рѕ РјРѕР¶РµС‚ РґР°С‚СЊ РІР°Рј СЂРµРґРєСѓСЋ РІРѕР·РјРѕР¶РЅРѕСЃС‚СЊ РїРµСЂРµС…РІР°С‚РёС‚СЊ РєРѕРЅС‚СЂРѕР»СЊ.",
    )
    followups = (
        "Сцена продолжается, напряжение нарастает.",
        "События ускоряются, и ситуация меняется.",
        "История движется дальше, сохраняя атмосферу эпизода.",
    )

    opening = openings[(turn_index - 1) % len(openings)]
    complication = complications[(len(prompt_reference) + turn_index) % len(complications)]
    outcome = outcomes[(turn_index + len(prompt_reference) * 2) % len(outcomes)]
    follow_up = followups[(turn_index + len(prompt_reference) * 3) % len(followups)]

    paragraphs = [opening, complication, outcome, follow_up]
    return "\n\n".join(paragraphs)


def _iter_story_stream_chunks(text_value: str, chunk_size: int = 24) -> list[str]:
    return [text_value[index : index + chunk_size] for index in range(0, len(text_value), chunk_size)]


def _is_story_translation_enabled() -> bool:
    provider = _effective_story_llm_provider()
    # For Russian UI + OpenRouter we keep native generation in Russian:
    # this avoids extra translation latency and prevents English fallbacks
    # when translation model is unavailable.
    if provider == "openrouter" and settings.story_user_language == "ru":
        return False

    return (
        settings.story_translation_enabled
        and bool(settings.openrouter_api_key)
        and bool(settings.openrouter_translation_model)
        and settings.story_user_language != settings.story_model_language
    )


def _can_force_story_output_translation() -> bool:
    return (
        bool(settings.openrouter_api_key)
        and bool(settings.openrouter_translation_model)
        and bool(settings.story_user_language)
    )


def _should_force_openrouter_story_output_translation(model_name: str | None) -> bool:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return False
    if settings.story_user_language != "ru":
        return False
    if normalized_model not in STORY_OPENROUTER_TRANSLATION_FORCE_MODEL_IDS:
        return False
    return _can_force_story_output_translation()


def _can_apply_story_sampling_to_model(model_name: str | None) -> bool:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return False
    return "deepseek" not in normalized_model


def _extract_story_markup_tokens(text_value: str) -> list[str]:
    tokens = STORY_MARKUP_MARKER_PATTERN.findall(text_value)
    return [re.sub(r"\s+", "", token).casefold() for token in tokens if token.strip()]


def _is_story_markup_preserved(source_text: str, translated_text: str) -> bool:
    source_tokens = _extract_story_markup_tokens(source_text)
    if not source_tokens:
        return True
    translated_tokens = _extract_story_markup_tokens(translated_text)
    return source_tokens == translated_tokens


def _translate_text_batch_with_openrouter(
    texts: list[str],
    *,
    source_language: str,
    target_language: str,
) -> list[str]:
    if not texts:
        return []

    translation_messages = [
        {
            "role": "system",
            "content": (
                "You are a precise translator. "
                "Translate each input text to the target language while preserving meaning, tone, line breaks, and markup. "
                "Never alter, translate, remove, or reorder any [[...]] markers. "
                "Marker content inside [[...]] must remain exactly unchanged. "
                "Return strict JSON array of strings with the same order and same count as input. "
                "Do not add comments. Do not wrap JSON in markdown."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "source_language": source_language,
                    "target_language": target_language,
                    "texts": texts,
                },
                ensure_ascii=False,
            ),
        },
    ]
    raw_response = _request_openrouter_story_text(
        translation_messages,
        model_name=settings.openrouter_translation_model,
        allow_free_fallback=False,
        temperature=0,
    )
    parsed_payload = _extract_json_array_from_text(raw_response)
    if not isinstance(parsed_payload, list):
        raise RuntimeError("OpenRouter translation returned malformed payload")

    translated_texts: list[str] = []
    for item in parsed_payload:
        if isinstance(item, str):
            translated_texts.append(item)
            continue
        if isinstance(item, dict):
            text_value = item.get("text")
            if isinstance(text_value, str):
                translated_texts.append(text_value)

    if len(translated_texts) != len(texts):
        raise RuntimeError("OpenRouter translation returned incomplete translations")

    for index, (source_text, translated_text) in enumerate(zip(texts, translated_texts)):
        if _is_story_markup_preserved(source_text, translated_text):
            continue
        logger.warning("Translation changed story markup at index=%s; using source text", index)
        translated_texts[index] = source_text

    return translated_texts


def _translate_texts_with_openrouter(
    texts: list[str],
    *,
    source_language: str,
    target_language: str,
) -> list[str]:
    if not texts:
        return []
    if not _is_story_translation_enabled():
        return texts
    if source_language == target_language:
        return texts

    translated_texts = list(texts)
    non_empty_items = [(index, text_value) for index, text_value in enumerate(texts) if text_value.strip()]
    if not non_empty_items:
        return translated_texts

    max_batch_items = 12
    max_batch_chars = 12_000
    batch_indices: list[int] = []
    batch_texts: list[str] = []
    batch_chars = 0

    def flush_batch() -> None:
        nonlocal batch_indices, batch_texts, batch_chars
        if not batch_texts:
            return
        translated_batch = _translate_text_batch_with_openrouter(
            batch_texts,
            source_language=source_language,
            target_language=target_language,
        )
        for position, translated_value in zip(batch_indices, translated_batch):
            translated_texts[position] = translated_value
        batch_indices = []
        batch_texts = []
        batch_chars = 0

    for index, text_value in non_empty_items:
        text_len = len(text_value)
        should_flush = batch_texts and (
            len(batch_texts) >= max_batch_items or batch_chars + text_len > max_batch_chars
        )
        if should_flush:
            flush_batch()

        batch_indices.append(index)
        batch_texts.append(text_value)
        batch_chars += text_len

    flush_batch()
    return translated_texts


def _translate_story_messages_for_model(messages_payload: list[dict[str, str]]) -> list[dict[str, str]]:
    if not _is_story_translation_enabled():
        return messages_payload

    source_language = settings.story_user_language
    target_language = settings.story_model_language
    raw_texts = [message.get("content", "") for message in messages_payload]
    translated_texts = _translate_texts_with_openrouter(
        raw_texts,
        source_language=source_language,
        target_language=target_language,
    )
    translated_messages: list[dict[str, str]] = []
    for message, translated_content in zip(messages_payload, translated_texts):
        translated_messages.append({"role": message["role"], "content": translated_content})
    return translated_messages


def _translate_story_model_output_to_user(text_value: str) -> str:
    if not text_value.strip():
        return text_value
    if not _is_story_translation_enabled():
        return text_value
    source_language = settings.story_model_language
    target_language = settings.story_user_language
    translated = _translate_texts_with_openrouter(
        [text_value],
        source_language=source_language,
        target_language=target_language,
    )
    return translated[0] if translated else text_value


def _force_translate_story_model_output_to_user(text_value: str) -> str:
    if not text_value.strip():
        return text_value
    if not _can_force_story_output_translation():
        return text_value
    translated = _translate_text_batch_with_openrouter(
        [text_value],
        source_language="auto",
        target_language=settings.story_user_language,
    )
    return translated[0] if translated else text_value


def _trim_story_history_to_context_limit(
    history: list[dict[str, str]],
    context_limit_tokens: int,
) -> list[dict[str, str]]:
    if not history:
        return []

    limit = _normalize_story_context_limit_chars(context_limit_tokens)
    if limit <= 0:
        return []

    selected_reversed: list[dict[str, str]] = []
    consumed_tokens = 0

    for item in reversed(history):
        content = item.get("content", "")
        if not content:
            continue
        entry_cost = _estimate_story_tokens(content) + 4
        if consumed_tokens + entry_cost <= limit:
            selected_reversed.append(item)
            consumed_tokens += entry_cost
            continue

        if not selected_reversed:
            max_content_tokens = max(limit - 4, 1)
            selected_reversed.append(
                {
                    "role": item.get("role", STORY_USER_ROLE),
                    "content": _trim_story_text_tail_by_tokens(content, max_content_tokens),
                }
            )
        break

    selected_reversed.reverse()
    return selected_reversed


def _build_story_provider_messages(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    context_limit_tokens: int,
    translate_for_model: bool = False,
) -> list[dict[str, str]]:
    history = [
        {"role": message.role, "content": message.content.strip()}
        for message in context_messages
        if message.role in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE} and message.content.strip()
    ]

    system_prompt = _build_story_system_prompt(instruction_cards, plot_cards, world_cards)
    system_prompt_tokens = _estimate_story_tokens(system_prompt)
    history_budget_tokens = max(_normalize_story_context_limit_chars(context_limit_tokens) - system_prompt_tokens, 0)
    history = _trim_story_history_to_context_limit(history, history_budget_tokens)

    messages_payload = [{"role": "system", "content": system_prompt}, *history]
    if not translate_for_model:
        return messages_payload

    try:
        return _translate_story_messages_for_model(messages_payload)
    except Exception as exc:
        logger.warning("Story input translation failed: %s", exc)
        return messages_payload


def _extract_text_from_model_content(value: Any) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue

            if not isinstance(item, dict):
                continue

            text_value = item.get("text")
            if isinstance(text_value, str):
                parts.append(text_value)
                continue

            if item.get("type") == "text":
                content_value = item.get("content")
                if isinstance(content_value, str):
                    parts.append(content_value)

        return "".join(parts)

    return ""


def _extract_json_array_from_text(raw_value: str) -> Any:
    normalized = raw_value.strip()
    if not normalized:
        return []

    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        try:
            parsed_literal = ast.literal_eval(normalized)
        except (ValueError, SyntaxError):
            parsed_literal = None
        if isinstance(parsed_literal, list):
            return parsed_literal

    start_index = normalized.find("[")
    end_index = normalized.rfind("]")
    if start_index >= 0 and end_index > start_index:
        fragment = normalized[start_index : end_index + 1]
        try:
            return json.loads(fragment)
        except json.JSONDecodeError:
            try:
                parsed_literal = ast.literal_eval(fragment)
            except (ValueError, SyntaxError):
                parsed_literal = None
            if isinstance(parsed_literal, list):
                return parsed_literal
            return []

    return []


def _extract_json_object_from_text(raw_value: str) -> Any:
    normalized = raw_value.strip()
    if not normalized:
        return {}

    try:
        parsed = json.loads(normalized)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        try:
            parsed_literal = ast.literal_eval(normalized)
        except (ValueError, SyntaxError):
            parsed_literal = None
        if isinstance(parsed_literal, dict):
            return parsed_literal

    start_index = normalized.find("{")
    end_index = normalized.rfind("}")
    if start_index >= 0 and end_index > start_index:
        fragment = normalized[start_index : end_index + 1]
        try:
            parsed = json.loads(fragment)
        except json.JSONDecodeError:
            try:
                parsed_literal = ast.literal_eval(fragment)
            except (ValueError, SyntaxError):
                return {}
            if isinstance(parsed_literal, dict):
                return parsed_literal
            return {}
        if isinstance(parsed, dict):
            return parsed

    return {}


def _build_story_world_card_extraction_messages(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, str]]:
    existing_titles = [card.title.strip() for card in existing_cards if card.title.strip()]
    existing_titles_preview = ", ".join(existing_titles[:40]) if existing_titles else "нет"
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    if len(prompt_preview) > 1200:
        prompt_preview = f"{prompt_preview[:1197].rstrip()}..."
    if len(assistant_preview) > 5000:
        assistant_preview = f"{assistant_preview[:4997].rstrip()}..."

    return [
        {
            "role": "system",
            "content": (
                "Ты извлекаешь важные сущности мира из художественного фрагмента. "
                "Верни строго JSON-массив без markdown. "
                "Формат элемента: {\"title\": string, \"content\": string, \"triggers\": string[]}. "
                "Добавляй только новые и действительно важные сущности (персонажи, предметы, места, организации). "
                "Максимум 3 элемента. Если добавлять нечего, верни []"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Последний ход игрока:\n{prompt_preview}\n\n"
                f"Ответ мастера:\n{assistant_preview}\n\n"
                f"Уже существующие карточки: {existing_titles_preview}\n\n"
                "Верни только JSON-массив."
            ),
        },
    ]


def _normalize_story_world_card_candidates(
    raw_candidates: Any,
    existing_title_keys: set[str],
) -> list[dict[str, Any]]:
    if not isinstance(raw_candidates, list):
        return []

    normalized_cards: list[dict[str, Any]] = []
    seen_title_keys = set(existing_title_keys)

    for raw_item in raw_candidates:
        if not isinstance(raw_item, dict):
            continue

        title_value = raw_item.get("title")
        content_value = raw_item.get("content")
        if not isinstance(title_value, str) or not isinstance(content_value, str):
            continue

        title = " ".join(title_value.split()).strip()
        content = content_value.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        if len(title) > 120:
            title = title[:120].rstrip()
        if len(content) > 8_000:
            content = content[:8_000].rstrip()
        if not title or not content:
            continue

        title_key = title.casefold()
        if title_key in seen_title_keys:
            continue

        raw_triggers = raw_item.get("triggers")
        trigger_values: list[str] = []
        if isinstance(raw_triggers, list):
            trigger_values = [value for value in raw_triggers if isinstance(value, str)]

        triggers = _normalize_story_world_card_triggers(trigger_values, fallback_title=title)
        normalized_cards.append(
            {
                "title": title,
                "content": content,
                "triggers": triggers,
                "source": STORY_WORLD_CARD_SOURCE_AI,
            }
        )
        seen_title_keys.add(title_key)
        if len(normalized_cards) >= 3:
            break

    return normalized_cards


def _build_story_world_card_change_messages(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, str]]:
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    if len(prompt_preview) > 1200:
        prompt_preview = f"{prompt_preview[:1197].rstrip()}..."
    if len(assistant_preview) > 5200:
        assistant_preview = f"{assistant_preview[:5197].rstrip()}..."

    existing_cards_preview: list[dict[str, Any]] = []
    for card in existing_cards[:120]:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        if len(content) > 320:
            content = f"{content[:317].rstrip()}..."
        existing_cards_preview.append(
            {
                "id": card.id,
                "title": title,
                "content": content,
                "triggers": _deserialize_story_world_card_triggers(card.triggers)[:10],
                "kind": _normalize_story_world_card_kind(card.kind),
                "is_locked": bool(card.is_locked),
                "ai_edit_enabled": bool(card.ai_edit_enabled),
                "memory_turns": _serialize_story_world_card_memory_turns(
                    card.memory_turns,
                    kind=_normalize_story_world_card_kind(card.kind),
                ),
                "source": _normalize_story_world_card_source(card.source),
            }
        )

    existing_cards_json = json.dumps(existing_cards_preview, ensure_ascii=False)

    return [
        {
            "role": "system",
            "content": (
                "You update long-term world memory for an interactive RPG session. "
                "Return strict JSON array without markdown.\n"
                "Each item format:\n"
                "{"
                "\"action\":\"add|update|delete\","
                "\"card_id\": number optional,"
                "\"title\": string optional,"
                "\"content\": string optional,"
                "\"triggers\": string[] optional,"
                "\"changed_text\": string optional,"
                "\"importance\":\"critical|high|medium|low\","
                "\"kind\":\"character|npc|item|artifact|action|event|place|location|faction|organization|quest\""
                "}.\n"
                "Rules:\n"
                "1) Keep only significant details that matter in future turns.\n"
                "2) Ignore mundane transient details (food, drinks, coffee, cups, generic furniture, routine background actions).\n"
                "3) Do not add one-off scene events (visits, greetings, short episode titles). Those belong to plot memory.\n"
                "4) Prefer update for existing cards when new important details appear.\n"
                "5) Never update or delete cards with \"is_locked\": true or \"ai_edit_enabled\": false.\n"
                "6) Delete only if a card became invalid/irrelevant.\n"
                "7) For add/update provide full current card text (max 6000 chars) and useful triggers.\n"
                "8) NPC cards must describe a specific named character only, not a faceless group.\n"
                "9) For NPC add/update title must be character name; content must include appearance/personality and important details.\n"
                "10) Do not create generic NPC names like \"bandit\", \"guards\", \"soldiers\" without a unique name.\n"
                "11) If a new speaking/thinking character appears in format [[NPC:Name]] or [[NPC_THOUGHT:Name]] and there is no such NPC card yet, "
                "add it as kind \"npc\".\n"
                f"12) Return at most {STORY_WORLD_CARD_MAX_AI_CHANGES} operations. Return [] if no important changes."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Player action:\n{prompt_preview}\n\n"
                f"Game master response:\n{assistant_preview}\n\n"
                f"Existing world cards JSON:\n{existing_cards_json}\n\n"
                "Return JSON array only."
            ),
        },
    ]


def _extract_story_world_card_operation_target(
    raw_item: dict[str, Any],
    existing_by_id: dict[int, StoryWorldCard],
    existing_by_title: dict[str, StoryWorldCard],
) -> StoryWorldCard | None:
    raw_card_id = raw_item.get("card_id")
    if isinstance(raw_card_id, int) and raw_card_id > 0:
        card = existing_by_id.get(raw_card_id)
        if card is not None:
            return card
    elif isinstance(raw_card_id, str) and raw_card_id.strip().isdigit():
        parsed_card_id = int(raw_card_id.strip())
        if parsed_card_id > 0:
            card = existing_by_id.get(parsed_card_id)
            if card is not None:
                return card

    for field_name in ("target_title", "title"):
        raw_title = raw_item.get(field_name)
        if not isinstance(raw_title, str):
            continue
        normalized_title = " ".join(raw_title.split()).strip().casefold()
        if not normalized_title:
            continue
        card = existing_by_title.get(normalized_title)
        if card is not None:
            return card

    return None


def _normalize_story_world_card_change_operations(
    raw_operations: Any,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if isinstance(raw_operations, dict):
        raw_nested_operations = raw_operations.get("changes")
        if not isinstance(raw_nested_operations, list):
            raw_nested_operations = raw_operations.get("operations")
        if isinstance(raw_nested_operations, list):
            raw_operations = raw_nested_operations
        elif isinstance(raw_operations.get("action"), str) or (
            isinstance(raw_operations.get("title"), str) and isinstance(raw_operations.get("content"), str)
        ):
            raw_operations = [raw_operations]
        else:
            raw_operations = []
    if not isinstance(raw_operations, list):
        return []

    existing_by_id = {card.id: card for card in existing_cards}
    existing_by_title = {
        " ".join(card.title.split()).strip().casefold(): card
        for card in existing_cards
        if " ".join(card.title.split()).strip()
    }

    normalized_operations: list[dict[str, Any]] = []
    seen_target_ids: set[int] = set()
    seen_added_title_keys: set[str] = set()

    for raw_item in raw_operations:
        if not isinstance(raw_item, dict):
            continue

        action = _normalize_story_world_card_event_action(str(raw_item.get("action", "")))
        if not action:
            has_legacy_candidate = isinstance(raw_item.get("title"), str) and isinstance(raw_item.get("content"), str)
            if has_legacy_candidate:
                action = STORY_WORLD_CARD_EVENT_ADDED
            else:
                continue

        importance = str(raw_item.get("importance", "high")).strip().lower()
        if importance in STORY_WORLD_CARD_LOW_IMPORTANCE:
            continue

        raw_kind = str(raw_item.get("kind", "")).strip().lower()
        if raw_kind in STORY_WORLD_CARD_NON_SIGNIFICANT_KINDS and importance != "critical":
            continue
        ai_card_kind = _map_story_world_card_ai_kind(raw_kind)

        target_card = _extract_story_world_card_operation_target(raw_item, existing_by_id, existing_by_title)
        raw_changed_text = raw_item.get("changed_text")
        changed_text_source = raw_changed_text if isinstance(raw_changed_text, str) else ""

        title = ""
        content = ""
        triggers: list[str] = []

        if action in {STORY_WORLD_CARD_EVENT_ADDED, STORY_WORLD_CARD_EVENT_UPDATED}:
            raw_title = raw_item.get("title")
            raw_content = raw_item.get("content")
            if not isinstance(raw_title, str) or not isinstance(raw_content, str):
                continue
            title = " ".join(raw_title.split()).strip()
            content = raw_content.replace("\r\n", "\n").strip()
            if len(title) > 120:
                title = title[:120].rstrip()
            if len(content) > STORY_WORLD_CARD_MAX_CONTENT_LENGTH:
                content = content[:STORY_WORLD_CARD_MAX_CONTENT_LENGTH].rstrip()
            if not title or not content:
                continue

            raw_triggers = raw_item.get("triggers")
            trigger_values: list[str] = []
            if isinstance(raw_triggers, list):
                trigger_values = [item for item in raw_triggers if isinstance(item, str)]
            triggers = _normalize_story_world_card_triggers(trigger_values, fallback_title=title)

            title_key = title.casefold()
            if (
                _is_story_world_card_title_mundane(title)
                or _is_story_world_card_title_ephemeral(title)
            ) and importance != "critical":
                continue

            if action == STORY_WORLD_CARD_EVENT_ADDED and target_card is None:
                target_card = existing_by_title.get(title_key)
                if target_card is not None:
                    action = STORY_WORLD_CARD_EVENT_UPDATED

            if (
                action == STORY_WORLD_CARD_EVENT_ADDED
                and target_card is not None
                and (bool(target_card.is_locked) or not bool(target_card.ai_edit_enabled))
            ):
                continue

            if action == STORY_WORLD_CARD_EVENT_ADDED:
                if ai_card_kind == STORY_WORLD_CARD_KIND_NPC:
                    if _is_story_generic_npc_name(title):
                        continue
                    content = _normalize_story_npc_profile_content(title, content)
                if title_key in seen_added_title_keys:
                    continue
                changed_text = _normalize_story_world_card_changed_text(
                    changed_text_source,
                    fallback=content,
                )
                normalized_operations.append(
                    {
                        "action": STORY_WORLD_CARD_EVENT_ADDED,
                        "title": title,
                        "content": content,
                        "triggers": triggers,
                        "kind": ai_card_kind,
                        "changed_text": changed_text,
                    }
                )
                seen_added_title_keys.add(title_key)
                if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                    break
                continue

        if action == STORY_WORLD_CARD_EVENT_UPDATED:
            if target_card is None:
                continue
            if target_card.id in seen_target_ids:
                continue
            if bool(target_card.is_locked) or not bool(target_card.ai_edit_enabled):
                continue
            if not title or not content:
                continue
            if (
                _is_story_world_card_title_mundane(title)
                or _is_story_world_card_title_ephemeral(title)
            ) and importance != "critical":
                continue

            current_title = " ".join(target_card.title.split()).strip()
            current_content = target_card.content.replace("\r\n", "\n").strip()
            current_triggers = _deserialize_story_world_card_triggers(target_card.triggers)
            current_kind = _normalize_story_world_card_kind(target_card.kind)
            next_kind = current_kind if not raw_kind else ai_card_kind
            if next_kind == STORY_WORLD_CARD_KIND_NPC:
                if _is_story_generic_npc_name(title):
                    continue
                content = _normalize_story_npc_profile_content(title, content)
            if (
                title == current_title
                and content == current_content
                and triggers == current_triggers
                and next_kind == current_kind
            ):
                continue

            changed_text = _normalize_story_world_card_changed_text(
                changed_text_source,
                fallback=content,
            )
            normalized_operations.append(
                {
                    "action": STORY_WORLD_CARD_EVENT_UPDATED,
                    "world_card_id": target_card.id,
                    "title": title,
                    "content": content,
                    "triggers": triggers,
                    "kind": next_kind,
                    "changed_text": changed_text,
                }
            )
            seen_target_ids.add(target_card.id)
            if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                break
            continue

        if action == STORY_WORLD_CARD_EVENT_DELETED:
            if target_card is None:
                continue
            if target_card.id in seen_target_ids:
                continue
            if bool(target_card.is_locked) or not bool(target_card.ai_edit_enabled):
                continue
            if _normalize_story_world_card_kind(target_card.kind) in {
                STORY_WORLD_CARD_KIND_MAIN_HERO,
                STORY_WORLD_CARD_KIND_NPC,
            }:
                continue
            if target_card.source != STORY_WORLD_CARD_SOURCE_AI:
                continue
            changed_text = _normalize_story_world_card_changed_text(
                changed_text_source,
                fallback=target_card.content,
            )
            normalized_operations.append(
                {
                    "action": STORY_WORLD_CARD_EVENT_DELETED,
                    "world_card_id": target_card.id,
                    "title": target_card.title,
                    "changed_text": changed_text,
                }
            )
            seen_target_ids.add(target_card.id)
            if len(normalized_operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
                break

    return normalized_operations


def _request_openrouter_world_card_candidates(messages_payload: list[dict[str, str]]) -> Any:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    primary_model = settings.openrouter_world_card_model or settings.openrouter_model
    candidate_models = [primary_model]

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        payload = {
            "model": model_name,
            "messages": messages_payload,
            "stream": False,
            "temperature": 0.1,
        }
        try:
            response = HTTP_SESSION.post(
                settings.openrouter_chat_url,
                headers=headers,
                json=payload,
                timeout=(STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS, STORY_POSTPROCESS_READ_TIMEOUT_SECONDS),
            )
        except requests.RequestException as exc:
            raise RuntimeError("Failed to reach OpenRouter extraction endpoint") from exc

        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                error_value = error_payload.get("error")
                if isinstance(error_value, dict):
                    detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                elif isinstance(error_value, str):
                    detail = error_value.strip()
                if not detail:
                    detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

            error_text = f"OpenRouter extraction error ({response.status_code})"
            if detail:
                error_text = f"{error_text}: {detail}"

            if response.status_code in {402, 404, 429, 503} and model_name != candidate_models[-1]:
                last_error = RuntimeError(error_text)
                continue
            raise RuntimeError(error_text)

        try:
            payload_value = response.json()
        except ValueError as exc:
            raise RuntimeError("OpenRouter extraction returned invalid payload") from exc

        if not isinstance(payload_value, dict):
            return []
        choices = payload_value.get("choices")
        if not isinstance(choices, list) or not choices:
            return []
        choice = choices[0] if isinstance(choices[0], dict) else {}
        message_value = choice.get("message")
        if not isinstance(message_value, dict):
            return []
        raw_content = _extract_text_from_model_content(message_value.get("content"))
        return _extract_json_array_from_text(raw_content)

    if last_error is not None:
        raise last_error

    return []


def _request_gigachat_world_card_candidates(messages_payload: list[dict[str, str]]) -> Any:
    access_token = _get_gigachat_access_token()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": False,
        "temperature": 0.1,
    }

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 60),
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat extraction endpoint") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = {}

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        error_text = f"GigaChat extraction error ({response.status_code})"
        if detail:
            error_text = f"{error_text}: {detail}"
        raise RuntimeError(error_text)

    try:
        payload_value = response.json()
    except ValueError as exc:
        raise RuntimeError("GigaChat extraction returned invalid payload") from exc

    if not isinstance(payload_value, dict):
        return []
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return []
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message_value = choice.get("message")
    if not isinstance(message_value, dict):
        return []
    content_value = _extract_text_from_model_content(message_value.get("content"))
    if not content_value:
        return []
    return _extract_json_array_from_text(content_value)


def _generate_story_world_card_change_operations(
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if not assistant_text.strip() or len(assistant_text.strip()) < 80:
        return []
    if len(existing_cards) >= 240:
        return []

    messages_payload = _build_story_world_card_change_messages(prompt, assistant_text, existing_cards)

    provider = _effective_story_llm_provider()
    raw_operations: Any = []
    if provider == "openrouter":
        raw_operations = _request_openrouter_world_card_candidates(messages_payload)
    elif provider == "gigachat":
        raw_operations = _request_gigachat_world_card_candidates(messages_payload)
    else:
        return []

    normalized_operations = _normalize_story_world_card_change_operations(raw_operations, existing_cards)
    return _append_missing_story_npc_card_operations(
        operations=normalized_operations,
        assistant_text=assistant_text,
        existing_cards=existing_cards,
    )


def _apply_story_world_card_change_operations(
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    operations: list[dict[str, Any]],
) -> list[StoryWorldCardChangeEvent]:
    if not operations:
        return []

    existing_cards = _list_story_world_cards(db, game.id)
    existing_by_id = {card.id: card for card in existing_cards}
    existing_by_title = {
        " ".join(card.title.split()).strip().casefold(): card
        for card in existing_cards
        if " ".join(card.title.split()).strip()
    }
    events: list[StoryWorldCardChangeEvent] = []

    for operation in operations[:STORY_WORLD_CARD_MAX_AI_CHANGES]:
        action = _normalize_story_world_card_event_action(str(operation.get("action", "")))
        if not action:
            continue

        if action == STORY_WORLD_CARD_EVENT_ADDED:
            title_value = str(operation.get("title", "")).strip()
            content_value = str(operation.get("content", "")).strip()
            triggers_value = operation.get("triggers")
            if not title_value or not content_value or not isinstance(triggers_value, list):
                continue
            card_kind = _normalize_story_world_card_kind(str(operation.get("kind", STORY_WORLD_CARD_KIND_WORLD)))
            normalized_title = _normalize_story_world_card_title(title_value)
            normalized_content = _normalize_story_world_card_content(content_value)
            if card_kind == STORY_WORLD_CARD_KIND_NPC:
                if _is_story_generic_npc_name(normalized_title):
                    continue
                normalized_content = _normalize_story_npc_profile_content(normalized_title, normalized_content)
            normalized_triggers = _normalize_story_world_card_triggers(
                [item for item in triggers_value if isinstance(item, str)],
                fallback_title=title_value,
            )

            duplicate_npc_exists = False
            if card_kind == STORY_WORLD_CARD_KIND_NPC:
                candidate_name = normalized_title
                for existing_card in existing_by_id.values():
                    existing_kind = _normalize_story_world_card_kind(existing_card.kind)
                    if existing_kind not in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}:
                        continue
                    existing_triggers = _deserialize_story_world_card_triggers(existing_card.triggers)
                    existing_identity_keys = _build_story_identity_keys(existing_card.title, existing_triggers)
                    if _is_story_npc_identity_duplicate(
                        candidate_name=candidate_name,
                        candidate_triggers=normalized_triggers,
                        known_identity_keys=existing_identity_keys,
                    ):
                        duplicate_npc_exists = True
                        break
            if duplicate_npc_exists:
                continue

            card = StoryWorldCard(
                game_id=game.id,
                title=normalized_title,
                content=normalized_content,
                triggers=_serialize_story_world_card_triggers(
                    normalized_triggers
                ),
                kind=card_kind,
                avatar_url=None,
                character_id=None,
                memory_turns=_normalize_story_world_card_memory_turns_for_storage(
                    None,
                    kind=card_kind,
                    explicit=False,
                    current_value=None,
                ),
                is_locked=False,
                ai_edit_enabled=True,
                source=STORY_WORLD_CARD_SOURCE_AI,
            )
            db.add(card)
            db.flush()

            card_snapshot = _story_world_card_snapshot_from_card(card)
            changed_text_fallback = _derive_story_changed_text_from_snapshots(
                action=STORY_WORLD_CARD_EVENT_ADDED,
                before_snapshot=None,
                after_snapshot=card_snapshot,
            )
            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=changed_text_fallback,
            )
            if _is_story_generic_changed_text(changed_text):
                changed_text = _normalize_story_world_card_changed_text("", fallback=changed_text_fallback)
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_ADDED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=None,
                after_snapshot=_serialize_story_world_card_snapshot(card_snapshot),
            )
            db.add(event)
            events.append(event)
            existing_by_id[card.id] = card
            existing_by_title[card.title.casefold()] = card
            continue

        raw_world_card_id = operation.get("world_card_id")
        if not isinstance(raw_world_card_id, int):
            continue
        card = existing_by_id.get(raw_world_card_id)
        if card is None:
            continue

        if action == STORY_WORLD_CARD_EVENT_UPDATED:
            if bool(card.is_locked) or not bool(card.ai_edit_enabled):
                continue
            before_snapshot = _story_world_card_snapshot_from_card(card)
            previous_title_key = card.title.casefold()
            title_value = str(operation.get("title", "")).strip()
            content_value = str(operation.get("content", "")).strip()
            triggers_value = operation.get("triggers")
            if not title_value or not content_value or not isinstance(triggers_value, list):
                continue

            next_title = _normalize_story_world_card_title(title_value)
            next_content = _normalize_story_world_card_content(content_value)
            next_triggers = _normalize_story_world_card_triggers(
                [item for item in triggers_value if isinstance(item, str)],
                fallback_title=title_value,
            )
            previous_kind = _normalize_story_world_card_kind(card.kind)
            next_kind = _normalize_story_world_card_kind(str(operation.get("kind", card.kind)))
            if next_kind == STORY_WORLD_CARD_KIND_NPC:
                if _is_story_generic_npc_name(next_title):
                    continue
                next_content = _normalize_story_npc_profile_content(next_title, next_content)
            current_memory_for_next_kind = card.memory_turns if next_kind == previous_kind else None
            next_memory_turns = _normalize_story_world_card_memory_turns_for_storage(
                card.memory_turns,
                kind=next_kind,
                explicit=False,
                current_value=current_memory_for_next_kind,
            )

            card.title = next_title
            card.content = next_content
            card.triggers = _serialize_story_world_card_triggers(next_triggers)
            card.kind = next_kind
            card.memory_turns = next_memory_turns
            card.source = STORY_WORLD_CARD_SOURCE_AI
            db.flush()

            after_snapshot = _story_world_card_snapshot_from_card(card)
            if before_snapshot == after_snapshot:
                continue

            changed_text_fallback = _derive_story_changed_text_from_snapshots(
                action=STORY_WORLD_CARD_EVENT_UPDATED,
                before_snapshot=before_snapshot,
                after_snapshot=after_snapshot,
            )
            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=changed_text_fallback,
            )
            if _is_story_generic_changed_text(changed_text):
                changed_text = _normalize_story_world_card_changed_text("", fallback=changed_text_fallback)
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_UPDATED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=_serialize_story_world_card_snapshot(before_snapshot),
                after_snapshot=_serialize_story_world_card_snapshot(after_snapshot),
            )
            db.add(event)
            events.append(event)
            existing_by_title.pop(previous_title_key, None)
            existing_by_title[card.title.casefold()] = card
            continue

        if action == STORY_WORLD_CARD_EVENT_DELETED:
            if bool(card.is_locked) or not bool(card.ai_edit_enabled):
                continue
            before_snapshot = _story_world_card_snapshot_from_card(card)
            changed_text_fallback = _derive_story_changed_text_from_snapshots(
                action=STORY_WORLD_CARD_EVENT_DELETED,
                before_snapshot=before_snapshot,
                after_snapshot=None,
            )
            changed_text = _normalize_story_world_card_changed_text(
                str(operation.get("changed_text", "")),
                fallback=changed_text_fallback,
            )
            if _is_story_generic_changed_text(changed_text):
                changed_text = _normalize_story_world_card_changed_text("", fallback=changed_text_fallback)
            event = StoryWorldCardChangeEvent(
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                world_card_id=card.id,
                action=STORY_WORLD_CARD_EVENT_DELETED,
                title=card.title,
                changed_text=changed_text,
                before_snapshot=_serialize_story_world_card_snapshot(before_snapshot),
                after_snapshot=None,
            )
            db.add(event)
            events.append(event)
            existing_by_id.pop(card.id, None)
            existing_by_title.pop(card.title.casefold(), None)
            db.delete(card)
            db.flush()

    if not events:
        return []

    _touch_story_game(game)
    db.commit()
    for event in events:
        db.refresh(event)

    return events


def _persist_generated_story_world_cards(
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    prompt: str,
    assistant_text: str,
) -> list[StoryWorldCardChangeEvent]:
    existing_cards = _list_story_world_cards(db, game.id)
    assistant_text_for_memory = _strip_story_markup_for_memory_text(assistant_text)
    try:
        operations = _generate_story_world_card_change_operations(
            prompt=prompt,
            assistant_text=assistant_text_for_memory,
            existing_cards=existing_cards,
        )
    except Exception as exc:
        logger.warning("World card extraction failed: %s", exc)
        operations = []

    persisted_events: list[StoryWorldCardChangeEvent] = []
    try:
        persisted_events.extend(
            _apply_story_world_card_change_operations(
                db=db,
                game=game,
                assistant_message=assistant_message,
                operations=operations,
            )
        )
    except Exception as exc:
        logger.warning("World card persistence failed: %s", exc)

    try:
        persisted_events.extend(
            _ensure_story_npc_cards_from_dialogue(
                db=db,
                game=game,
                assistant_message=assistant_message,
                assistant_text=assistant_text,
            )
        )
    except Exception as exc:
        logger.warning("NPC dialogue world card fallback failed: %s", exc)

    return persisted_events


def _build_story_plot_card_memory_messages(
    *,
    existing_card: StoryPlotCard | None,
    assistant_messages: list[StoryMessage],
    context_limit_tokens: int,
) -> list[dict[str, str]]:
    current_memory = ""
    if existing_card is not None:
        current_memory = existing_card.content.replace("\r\n", "\n").strip()

    history_limit = min(
        _normalize_story_context_limit_chars(context_limit_tokens),
        STORY_PLOT_CARD_MEMORY_MAX_INPUT_TOKENS,
    )
    history_items = _trim_story_history_to_context_limit(
        [
            {
                "role": STORY_ASSISTANT_ROLE,
                "content": _strip_story_markup_for_memory_text(message.content),
            }
            for message in assistant_messages
        ],
        history_limit,
    )
    history_json_payload = [
        {"id": index, "content": item.get("content", "")}
        for index, item in enumerate(history_items, start=1)
    ]

    history_json = json.dumps(history_json_payload, ensure_ascii=False)
    current_title = existing_card.title.strip() if existing_card is not None else ""

    return [
        {
            "role": "system",
            "content": (
                "Ты редактор краткой долговременной памяти для RPG. "
                "Задача: максимально сократить текст без потери контекста и важных деталей. "
                "Сохраняй только управленчески важное: текущий контекст сцены, цель, конфликт/угрозу, ключевые факты, незакрытые линии. "
                "Удаляй атмосферные описания, повторы, украшения, второстепенные детали и длинные пересказы. "
                "Заголовок должен передавать суть текущего этапа истории, 3-7 слов, без шаблонов и без копирования первой строки. "
                "Верни строго JSON без markdown: "
                "{\"title\": string, \"memory_points\": string[], \"content\": string}. "
                "memory_points: 4-6 коротких пунктов по делу, каждый <=150 символов. "
                "Каждый пункт начинай с одной из меток: "
                "'Контекст:', 'Цель:', 'Конфликт:', 'Факты:', 'Риск:', 'Незакрытое:'. "
                "content: компактная версия тех же пунктов."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Текущая карточка памяти (может быть пусто):\nЗаголовок: {current_title or 'нет'}\n"
                f"Текст:\n{current_memory or 'нет'}\n\n"
                f"История ответов мастера JSON:\n{history_json}\n\n"
                "Обнови карточку памяти. Сожми без потери критичных деталей для следующего хода. Верни только JSON."
            ),
        },
    ]


def _extract_story_plot_memory_points(raw_payload: dict[str, Any]) -> list[str]:
    extracted: list[str] = []
    for key in ("memory_points", "points", "bullets", "facts", "items"):
        raw_value = raw_payload.get(key)
        if not isinstance(raw_value, list):
            continue
        for item in raw_value:
            if isinstance(item, str):
                extracted.append(item)
                continue
            if not isinstance(item, dict):
                continue
            nested_text = (
                item.get("text")
                or item.get("content")
                or item.get("value")
                or item.get("point")
            )
            if isinstance(nested_text, str):
                extracted.append(nested_text)
    return extracted


def _score_story_plot_memory_line(line: str) -> int:
    normalized = line.casefold()
    score = 0
    if ":" in line[:24]:
        score += 3
    if re.search(r"\d", line):
        score += 2
    if re.search(r"\b[А-ЯЁA-Z][а-яёa-z]{2,}\b", line):
        score += 2
    score += sum(2 for token in STORY_PLOT_CARD_MEMORY_IMPORTANT_TOKENS if token in normalized)
    if len(line) < 20:
        score -= 1
    if len(line) > STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS:
        score -= 1
    return score


def _compress_story_plot_memory_content(raw_content: str, *, preferred_lines: list[str] | None = None) -> str:
    normalized = raw_content.replace("\r\n", "\n").strip()
    if not normalized and not preferred_lines:
        return ""

    lines = [line.strip(" -•\t") for line in (preferred_lines or []) if isinstance(line, str) and line.strip()]
    if not lines and normalized:
        lines = [line.strip(" -•\t") for line in normalized.split("\n") if line.strip()]
    if len(lines) <= 1:
        sentence_candidates = re.split(r"(?<=[.!?…])\s+", re.sub(r"\s+", " ", normalized or ""))
        lines = [candidate.strip() for candidate in sentence_candidates if candidate.strip()]

    cleaned_lines: list[tuple[int, str]] = []
    seen_lines: set[str] = set()
    for index, line in enumerate(lines):
        compact = re.sub(r"\s+", " ", line).strip()
        if not compact:
            continue
        if len(compact) > STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS:
            compact = f"{compact[:STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS - 3].rstrip(' ,;:-')}..."
        compact_key = compact.casefold()
        if compact_key in seen_lines:
            continue
        seen_lines.add(compact_key)
        cleaned_lines.append((index, compact))

    if not cleaned_lines:
        single_line = re.sub(r"\s+", " ", normalized).strip()
        if len(single_line) > STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS:
            single_line = f"{single_line[:STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS - 3].rstrip()}..."
        return single_line

    ranked_lines = sorted(
        (
            (index, line, _score_story_plot_memory_line(line))
            for index, line in cleaned_lines
        ),
        key=lambda item: (-item[2], item[0]),
    )
    selected = ranked_lines[: STORY_PLOT_CARD_MEMORY_TARGET_MAX_LINES]

    latest_index, latest_line = cleaned_lines[-1]
    if latest_line and all(latest_index != index for index, _, _ in selected):
        selected.sort(key=lambda item: (item[2], -item[0]))
        selected[0] = (latest_index, latest_line, _score_story_plot_memory_line(latest_line))

    ordered_lines = [line for _, line, _ in sorted(selected, key=lambda item: item[0])]
    compact_content = "\n".join(f"- {line}" for line in ordered_lines)
    if len(compact_content) > STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS:
        compact_content = compact_content[:STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS].rstrip()
    return compact_content


def _is_story_plot_card_default_title(value: str) -> bool:
    normalized = " ".join(value.split()).strip().casefold()
    if not normalized:
        return True
    return normalized in {
        STORY_PLOT_CARD_DEFAULT_TITLE.casefold(),
        "суть эпизода",
        "текущий эпизод",
    }


def _derive_story_plot_card_title_from_content(
    raw_content: str,
    *,
    preferred_lines: list[str] | None = None,
) -> str:
    line_candidates: list[str] = []
    if preferred_lines:
        line_candidates.extend(
            line
            for line in preferred_lines
            if isinstance(line, str) and line.strip()
        )
    normalized_content = raw_content.replace("\r\n", "\n").strip()
    if normalized_content:
        line_candidates.extend(line for line in normalized_content.split("\n") if line.strip())
    if not line_candidates:
        return STORY_PLOT_CARD_DEFAULT_TITLE

    for line in line_candidates:
        compact = re.sub(r"\s+", " ", line).strip(" -•\t")
        if not compact:
            continue
        compact = STORY_PLOT_CARD_POINT_PREFIX_PATTERN.sub("", compact).strip(" ,;:-.")
        if len(compact) < 3:
            continue
        words = compact.split()
        if len(words) > STORY_PLOT_CARD_TITLE_WORD_MAX:
            compact = " ".join(words[:STORY_PLOT_CARD_TITLE_WORD_MAX]).rstrip(" ,;:-.")
        if len(compact) < 3:
            continue
        return compact[0].upper() + compact[1:]

    return STORY_PLOT_CARD_DEFAULT_TITLE


def _normalize_story_plot_card_ai_payload(
    raw_payload: Any,
    *,
    fallback_title: str = "",
) -> tuple[str, str] | None:
    if not isinstance(raw_payload, dict):
        return None

    raw_title = (
        raw_payload.get("title")
        or raw_payload.get("name")
        or raw_payload.get("heading")
        or raw_payload.get("заголовок")
    )
    raw_content = (
        raw_payload.get("content")
        or raw_payload.get("summary")
        or raw_payload.get("text")
        or raw_payload.get("текст")
    )
    raw_points = _extract_story_plot_memory_points(raw_payload)
    if not isinstance(raw_title, str) or not isinstance(raw_content, str):
        if not isinstance(raw_title, str) and isinstance(raw_content, str):
            raw_title = fallback_title or STORY_PLOT_CARD_DEFAULT_TITLE
        if not isinstance(raw_content, str) and raw_points:
            raw_content = "\n".join(raw_points)
        nested_card = raw_payload.get("card")
        if isinstance(nested_card, dict):
            return _normalize_story_plot_card_ai_payload(nested_card, fallback_title=fallback_title)
        if not isinstance(raw_title, str) or not isinstance(raw_content, str):
            return None

    title = " ".join(raw_title.split()).strip()
    content = _compress_story_plot_memory_content(raw_content, preferred_lines=raw_points)

    if len(title) < 3:
        title = ""
    if not title or _is_story_plot_card_default_title(title):
        title = fallback_title.strip()
    if not title or _is_story_plot_card_default_title(title):
        title = _derive_story_plot_card_title_from_content(content, preferred_lines=raw_points)
    if not title:
        title = STORY_PLOT_CARD_DEFAULT_TITLE
    if not content:
        return None

    if len(title) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
        title = title[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
    if len(content) > STORY_PLOT_CARD_MAX_CONTENT_LENGTH:
        content = content[:STORY_PLOT_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not title or not content:
        return None

    return (title, content)


def _build_story_plot_card_fallback_payload(
    *,
    existing_card: StoryPlotCard | None,
    assistant_messages: list[StoryMessage],
    context_limit_tokens: int,
) -> tuple[str, str] | None:
    history_limit = _normalize_story_context_limit_chars(context_limit_tokens)
    trimmed_history = _trim_story_history_to_context_limit(
        [
            {
                "role": STORY_ASSISTANT_ROLE,
                "content": _strip_story_markup_for_memory_text(message.content),
            }
            for message in assistant_messages
        ],
        history_limit,
    )
    history_parts = [item.get("content", "").replace("\r\n", "\n").strip() for item in trimmed_history if item.get("content")]

    if not history_parts:
        return None

    fallback_title = existing_card.title.strip() if existing_card is not None else ""

    combined_content = _compress_story_plot_memory_content("\n".join(history_parts[-10:]))
    if not combined_content:
        return None
    if not fallback_title or _is_story_plot_card_default_title(fallback_title):
        fallback_title = _derive_story_plot_card_title_from_content(combined_content)
    if not fallback_title:
        fallback_title = STORY_PLOT_CARD_DEFAULT_TITLE

    return (
        _normalize_story_plot_card_title(fallback_title),
        _normalize_story_plot_card_content(combined_content),
    )


def _upsert_story_plot_memory_card(
    *,
    db: Session,
    game: StoryGame,
) -> tuple[bool, list[StoryPlotCardChangeEvent]]:
    if not settings.openrouter_api_key:
        return (False, [])

    model_name = (settings.openrouter_plot_card_model or "deepseek/deepseek-r1-0528:free").strip()
    if not model_name:
        return (False, [])

    assistant_messages = db.scalars(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == STORY_ASSISTANT_ROLE,
        )
        .order_by(StoryMessage.id.asc())
    ).all()
    if len(assistant_messages) > STORY_PLOT_CARD_MAX_ASSISTANT_MESSAGES:
        assistant_messages = assistant_messages[-STORY_PLOT_CARD_MAX_ASSISTANT_MESSAGES:]
    if not assistant_messages:
        return (False, [])

    existing_cards = _list_story_plot_cards(db, game.id)
    ai_card = next(
        (
            card
            for card in existing_cards
            if _normalize_story_plot_card_source(card.source) == STORY_PLOT_CARD_SOURCE_AI
        ),
        None,
    )
    target_card = ai_card or (existing_cards[0] if existing_cards else None)
    messages_payload = _build_story_plot_card_memory_messages(
        existing_card=target_card,
        assistant_messages=assistant_messages,
        context_limit_tokens=game.context_limit_chars,
    )

    normalized_payload: tuple[str, str] | None = None
    try:
        raw_response = _request_openrouter_story_text(
            messages_payload,
            model_name=model_name,
            allow_free_fallback=False,
            temperature=0.0,
            request_timeout=(
                STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
                STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
            ),
        )
        parsed_payload = _extract_json_object_from_text(raw_response)
        fallback_title = target_card.title.strip() if target_card is not None else ""
        normalized_payload = _normalize_story_plot_card_ai_payload(
            parsed_payload,
            fallback_title=fallback_title,
        )
    except Exception as exc:
        logger.warning("Plot card memory generation failed, fallback will be used: %s", exc)

    if normalized_payload is None:
        normalized_payload = _build_story_plot_card_fallback_payload(
            existing_card=target_card,
            assistant_messages=assistant_messages,
            context_limit_tokens=game.context_limit_chars,
        )
    if normalized_payload is None:
        return (False, [])
    title, content = normalized_payload

    if target_card is None:
        new_card = StoryPlotCard(
            game_id=game.id,
            title=title,
            content=content,
            source=STORY_PLOT_CARD_SOURCE_AI,
        )
        db.add(new_card)
        db.flush()
        after_snapshot = _story_plot_card_snapshot_from_card(new_card)
        changed_text_fallback = _derive_story_changed_text_from_snapshots(
            action=STORY_WORLD_CARD_EVENT_ADDED,
            before_snapshot=None,
            after_snapshot=after_snapshot,
        )
        changed_text = _normalize_story_plot_card_changed_text("", fallback=changed_text_fallback)
        event = StoryPlotCardChangeEvent(
            game_id=game.id,
            assistant_message_id=assistant_messages[-1].id,
            plot_card_id=new_card.id,
            action=STORY_WORLD_CARD_EVENT_ADDED,
            title=new_card.title,
            changed_text=changed_text,
            before_snapshot=None,
            after_snapshot=_serialize_story_plot_card_snapshot(after_snapshot),
        )
        db.add(event)
        _touch_story_game(game)
        db.commit()
        db.refresh(event)
        return (True, [event])

    if target_card.title == title and target_card.content == content:
        return (False, [])

    before_snapshot = _story_plot_card_snapshot_from_card(target_card)
    target_card.title = title
    target_card.content = content
    target_card.source = STORY_PLOT_CARD_SOURCE_AI
    db.flush()
    after_snapshot = _story_plot_card_snapshot_from_card(target_card)
    changed_text_fallback = _derive_story_changed_text_from_snapshots(
        action=STORY_WORLD_CARD_EVENT_UPDATED,
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
    )
    changed_text = _normalize_story_plot_card_changed_text("", fallback=changed_text_fallback)
    event = StoryPlotCardChangeEvent(
        game_id=game.id,
        assistant_message_id=assistant_messages[-1].id,
        plot_card_id=target_card.id,
        action=STORY_WORLD_CARD_EVENT_UPDATED,
        title=target_card.title,
        changed_text=changed_text,
        before_snapshot=_serialize_story_plot_card_snapshot(before_snapshot),
        after_snapshot=_serialize_story_plot_card_snapshot(after_snapshot),
    )
    db.add(event)
    _touch_story_game(game)
    db.commit()
    db.refresh(event)
    return (False, [event])


def _normalize_basic_auth_header(raw_value: str) -> str:
    normalized = raw_value.strip()
    if not normalized:
        raise RuntimeError("GIGACHAT_AUTHORIZATION_KEY is missing")
    if normalized.lower().startswith("basic "):
        return normalized
    return f"Basic {normalized}"


def _get_gigachat_access_token() -> str:
    now = _utcnow()
    with GIGACHAT_TOKEN_CACHE_LOCK:
        cached_token = GIGACHAT_TOKEN_CACHE.get("access_token")
        cached_expires_at = GIGACHAT_TOKEN_CACHE.get("expires_at")

    if isinstance(cached_token, str) and cached_token and isinstance(cached_expires_at, datetime):
        if cached_expires_at > now + timedelta(seconds=30):
            return cached_token

    headers = {
        "Authorization": _normalize_basic_auth_header(settings.gigachat_authorization_key),
        "RqUID": str(uuid4()),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"scope": settings.gigachat_scope}

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_oauth_url,
            headers=headers,
            data=data,
            timeout=20,
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat OAuth endpoint") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        detail = ""
        if isinstance(payload, dict):
            detail = str(payload.get("error_description") or payload.get("message") or payload.get("error") or "").strip()
        if detail:
            raise RuntimeError(f"GigaChat OAuth error ({response.status_code}): {detail}")
        raise RuntimeError(f"GigaChat OAuth error ({response.status_code})")

    if not isinstance(payload, dict):
        raise RuntimeError("GigaChat OAuth returned invalid payload")

    access_token = str(payload.get("access_token", "")).strip()
    if not access_token:
        raise RuntimeError("GigaChat OAuth response does not contain access_token")

    expires_at_value = payload.get("expires_at")
    expires_at = now + timedelta(minutes=25)
    if isinstance(expires_at_value, int):
        expires_at = datetime.fromtimestamp(expires_at_value / 1000, tz=timezone.utc)
    elif isinstance(expires_at_value, str) and expires_at_value.isdigit():
        expires_at = datetime.fromtimestamp(int(expires_at_value) / 1000, tz=timezone.utc)

    with GIGACHAT_TOKEN_CACHE_LOCK:
        GIGACHAT_TOKEN_CACHE["access_token"] = access_token
        GIGACHAT_TOKEN_CACHE["expires_at"] = expires_at

    return access_token


def _iter_gigachat_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    context_limit_chars: int,
):
    access_token = _get_gigachat_access_token()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        context_limit_tokens=context_limit_chars,
    )
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to GigaChat")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": True,
    }

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 120),
            stream=True,
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat chat endpoint") from exc

    try:
        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

            if detail:
                raise RuntimeError(f"GigaChat chat error ({response.status_code}): {detail}")
            raise RuntimeError(f"GigaChat chat error ({response.status_code})")

        # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
        response.encoding = "utf-8"
        emitted_delta = False
        for raw_line in response.iter_lines(decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue

            raw_data = line[len("data:") :].strip()
            if raw_data == "[DONE]":
                break

            try:
                chunk_payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            choices = chunk_payload.get("choices")
            if not isinstance(choices, list) or not choices:
                continue

            choice = choices[0] if isinstance(choices[0], dict) else {}
            delta_value = choice.get("delta")
            if isinstance(delta_value, dict):
                content_delta = delta_value.get("content")
                if isinstance(content_delta, str) and content_delta:
                    emitted_delta = True
                    yield content_delta
                    continue

            if emitted_delta:
                continue

            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = message_value.get("content")
                if isinstance(content_value, str) and content_value:
                    for chunk in _iter_story_stream_chunks(content_value):
                        yield chunk
                    break
    finally:
        response.close()


def _iter_openrouter_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    context_limit_chars: int,
    model_name: str | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
):
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        context_limit_tokens=context_limit_chars,
    )
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to OpenRouter")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    primary_model = (model_name or settings.openrouter_model).strip()
    if not primary_model:
        raise RuntimeError("OpenRouter chat model is not configured")

    candidate_models = [primary_model]
    if primary_model != "openrouter/free":
        candidate_models.append("openrouter/free")

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        payload = {
            "model": model_name,
            "messages": messages_payload,
            "stream": True,
        }
        if top_k is not None:
            payload["top_k"] = top_k
        if top_p is not None:
            payload["top_p"] = top_p

        for attempt_index in range(2):
            try:
                response = HTTP_SESSION.post(
                    settings.openrouter_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=(20, 120),
                    stream=True,
                )
            except requests.RequestException as exc:
                raise RuntimeError("Failed to reach OpenRouter chat endpoint") from exc

            try:
                if response.status_code >= 400:
                    detail = ""
                    try:
                        error_payload = response.json()
                    except ValueError:
                        error_payload = {}

                    if isinstance(error_payload, dict):
                        error_value = error_payload.get("error")
                        if isinstance(error_value, dict):
                            detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                            metadata_value = error_value.get("metadata")
                            if isinstance(metadata_value, dict):
                                raw_detail = str(metadata_value.get("raw") or "").strip()
                                if raw_detail:
                                    detail = f"{detail}. {raw_detail}" if detail else raw_detail
                        elif isinstance(error_value, str):
                            detail = error_value.strip()

                        if not detail:
                            detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

                    if response.status_code == 429 and attempt_index == 0:
                        time.sleep(1.1)
                        continue

                    error_text = f"OpenRouter chat error ({response.status_code})"
                    if detail:
                        error_text = f"{error_text}: {detail}"

                    if response.status_code in {404, 429, 503} and model_name != candidate_models[-1]:
                        last_error = RuntimeError(error_text)
                        break

                    raise RuntimeError(error_text)

                # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
                response.encoding = "utf-8"
                emitted_delta = False
                for raw_line in response.iter_lines(decode_unicode=True):
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue

                    raw_data = line[len("data:") :].strip()
                    if raw_data == "[DONE]":
                        break

                    try:
                        chunk_payload = json.loads(raw_data)
                    except json.JSONDecodeError:
                        continue

                    error_value = chunk_payload.get("error")
                    if isinstance(error_value, dict):
                        error_detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                        raise RuntimeError(error_detail or "OpenRouter stream returned an error")
                    if isinstance(error_value, str) and error_value.strip():
                        raise RuntimeError(error_value.strip())

                    choices = chunk_payload.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue

                    choice = choices[0] if isinstance(choices[0], dict) else {}
                    delta_value = choice.get("delta")
                    if isinstance(delta_value, dict):
                        content_delta = _extract_text_from_model_content(delta_value.get("content"))
                        if content_delta:
                            emitted_delta = True
                            yield content_delta
                            continue

                    if emitted_delta:
                        continue

                    message_value = choice.get("message")
                    if isinstance(message_value, dict):
                        content_value = _extract_text_from_model_content(message_value.get("content"))
                        if content_value:
                            for chunk in _iter_story_stream_chunks(content_value):
                                yield chunk
                            break

                return
            finally:
                response.close()

        if model_name == candidate_models[-1] and last_error is not None:
            raise last_error

    if last_error is not None:
        raise last_error

    raise RuntimeError("OpenRouter chat request failed")


def _request_gigachat_story_text(messages_payload: list[dict[str, str]]) -> str:
    access_token = _get_gigachat_access_token()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": False,
    }

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 120),
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat chat endpoint") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = {}

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        error_text = f"GigaChat chat error ({response.status_code})"
        if detail:
            error_text = f"{error_text}: {detail}"
        raise RuntimeError(error_text)

    try:
        payload_value = response.json()
    except ValueError as exc:
        raise RuntimeError("GigaChat chat returned invalid payload") from exc

    if not isinstance(payload_value, dict):
        return ""
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message_value = choice.get("message")
    if not isinstance(message_value, dict):
        return ""
    return _extract_text_from_model_content(message_value.get("content"))


def _request_openrouter_story_text(
    messages_payload: list[dict[str, str]],
    *,
    model_name: str | None = None,
    allow_free_fallback: bool = True,
    temperature: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    request_timeout: tuple[int, int] | None = None,
) -> str:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    primary_model = (model_name or settings.openrouter_model).strip()
    if not primary_model:
        raise RuntimeError("OpenRouter chat model is not configured")

    candidate_models = [primary_model]
    if allow_free_fallback and primary_model != "openrouter/free":
        candidate_models.append("openrouter/free")

    last_error: RuntimeError | None = None
    timeout_value = request_timeout or (20, 120)
    for candidate_model in candidate_models:
        payload = {
            "model": candidate_model,
            "messages": messages_payload,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if top_k is not None:
            payload["top_k"] = top_k
        if top_p is not None:
            payload["top_p"] = top_p
        try:
            response = HTTP_SESSION.post(
                settings.openrouter_chat_url,
                headers=headers,
                json=payload,
                timeout=timeout_value,
            )
        except requests.RequestException as exc:
            raise RuntimeError("Failed to reach OpenRouter chat endpoint") from exc

        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                error_value = error_payload.get("error")
                if isinstance(error_value, dict):
                    detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                    metadata_value = error_value.get("metadata")
                    if isinstance(metadata_value, dict):
                        raw_detail = str(metadata_value.get("raw") or "").strip()
                        if raw_detail:
                            detail = f"{detail}. {raw_detail}" if detail else raw_detail
                elif isinstance(error_value, str):
                    detail = error_value.strip()
                if not detail:
                    detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

            error_text = f"OpenRouter chat error ({response.status_code})"
            if detail:
                error_text = f"{error_text}: {detail}"

            if response.status_code in {404, 429, 503} and candidate_model != candidate_models[-1]:
                last_error = RuntimeError(error_text)
                continue
            raise RuntimeError(error_text)

        try:
            payload_value = response.json()
        except ValueError as exc:
            raise RuntimeError("OpenRouter chat returned invalid payload") from exc

        if not isinstance(payload_value, dict):
            return ""
        choices = payload_value.get("choices")
        if not isinstance(choices, list) or not choices:
            return ""
        choice = choices[0] if isinstance(choices[0], dict) else {}
        message_value = choice.get("message")
        if not isinstance(message_value, dict):
            return ""
        return _extract_text_from_model_content(message_value.get("content"))

    if last_error is not None:
        raise last_error
    return ""


def _iter_story_provider_stream_chunks(
    *,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_chars: int,
    story_model_name: str | None = None,
    story_top_k: int = 0,
    story_top_r: float = 1.0,
):
    provider = _effective_story_llm_provider()

    if provider == "gigachat":
        if _is_story_translation_enabled():
            payload = _build_story_provider_messages(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                context_limit_tokens=context_limit_chars,
                translate_for_model=True,
            )
            generated_text = _request_gigachat_story_text(payload)
            try:
                translated_text = _translate_story_model_output_to_user(generated_text)
            except Exception as exc:
                logger.warning("Story output translation failed: %s", exc)
                translated_text = generated_text
            for chunk in _iter_story_stream_chunks(translated_text):
                yield chunk
            return

        yield from _iter_gigachat_story_stream_chunks(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            context_limit_chars=context_limit_chars,
        )
        return

    if provider == "openrouter":
        selected_model_name = (story_model_name or settings.openrouter_model).strip() or settings.openrouter_model
        apply_sampling = _can_apply_story_sampling_to_model(selected_model_name)
        top_k_value = story_top_k if apply_sampling else None
        top_p_value = story_top_r if apply_sampling else None
        translation_enabled = _is_story_translation_enabled()
        force_output_translation = _should_force_openrouter_story_output_translation(selected_model_name)
        if translation_enabled or force_output_translation:
            payload = _build_story_provider_messages(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                context_limit_tokens=context_limit_chars,
                translate_for_model=translation_enabled,
            )
            generated_text = _request_openrouter_story_text(
                payload,
                model_name=selected_model_name,
                top_k=top_k_value,
                top_p=top_p_value,
            )
            try:
                if force_output_translation and not translation_enabled:
                    translated_text = _force_translate_story_model_output_to_user(generated_text)
                else:
                    translated_text = _translate_story_model_output_to_user(generated_text)
            except Exception as exc:
                logger.warning("Story output translation failed: %s", exc)
                translated_text = generated_text
            for chunk in _iter_story_stream_chunks(translated_text):
                yield chunk
            return

        yield from _iter_openrouter_story_stream_chunks(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            context_limit_chars=context_limit_chars,
            model_name=selected_model_name,
            top_k=top_k_value,
            top_p=top_p_value,
        )
        return

    raise RuntimeError("Story provider is not configured: expected openrouter or gigachat")


def _build_story_runtime_deps() -> StoryRuntimeDeps:
    return StoryRuntimeDeps(
        validate_provider_config=_validate_story_provider_config,
        get_current_user=_get_current_user,
        get_user_story_game_or_404=_get_user_story_game_or_404,
        list_story_messages=_list_story_messages,
        normalize_generation_instructions=_normalize_story_generation_instructions,
        rollback_story_card_events_for_assistant_message=_rollback_story_card_events_for_assistant_message,
        normalize_text=_normalize_story_text,
        derive_story_title=_derive_story_title,
        touch_story_game=_touch_story_game,
        list_story_plot_cards=_list_story_plot_cards,
        list_story_world_cards=_list_story_world_cards,
        select_story_world_cards_for_prompt=_select_story_world_cards_for_prompt,
        normalize_context_limit_chars=_normalize_story_context_limit_chars,
        stream_story_provider_chunks=_iter_story_provider_stream_chunks,
        normalize_generated_story_output=_normalize_generated_story_output,
        persist_generated_world_cards=_persist_generated_story_world_cards,
        upsert_story_plot_memory_card=_upsert_story_plot_memory_card,
        world_card_event_to_out=_story_world_card_change_event_to_out,
        plot_card_event_to_out=_story_plot_card_change_event_to_out,
        story_default_title=STORY_DEFAULT_TITLE,
        story_user_role=STORY_USER_ROLE,
        story_assistant_role=STORY_ASSISTANT_ROLE,
        stream_persist_min_chars=STORY_STREAM_PERSIST_MIN_CHARS,
        stream_persist_max_interval_seconds=STORY_STREAM_PERSIST_MAX_INTERVAL_SECONDS,
    )


def generate_story_response_impl(
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StreamingResponse:
    return _generate_story_response(
        deps=_build_story_runtime_deps(),
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )
