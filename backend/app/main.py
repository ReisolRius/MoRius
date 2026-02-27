from __future__ import annotations

import ast
import json
import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
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

from app.config import OPENROUTER_GLM_AIR_FREE_MODEL, settings
from app.models import (
    StoryGame,
    StoryMessage,
    StoryTurnImage,
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
from app.routers.story_instruction_templates import router as story_instruction_templates_router
from app.routers.story_messages import router as story_messages_router
from app.routers.story_read import router as story_read_router
from app.routers.story_turn_image import router as story_turn_image_router
from app.routers.story_undo import router as story_undo_router
from app.routers.story_world_cards import router as story_world_cards_router
from app.schemas import (
    StoryGenerateRequest,
    StoryInstructionCardInput,
    StoryPlotCardChangeEventOut,
    StoryTurnImageGenerateOut,
    StoryTurnImageGenerateRequest,
    UserOut,
    StoryWorldCardChangeEventOut,
)
from app.services.auth_identity import (
    get_current_user as _get_current_user,
)
from app.services.auth_verification import close_http_session as _close_auth_verification_http_session
from app.services.db_bootstrap import StoryBootstrapDefaults, bootstrap_database
from app.services.concurrency import (
    add_user_tokens as _add_user_tokens_raw,
    spend_user_tokens_if_sufficient as _spend_user_tokens_if_sufficient_raw,
)
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
    story_plot_card_to_out as _story_plot_card_to_out,
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
from app.services.story_games import (
    coerce_story_image_model as _coerce_story_image_model,
    get_story_turn_cost_tokens as _get_story_turn_cost_tokens,
)
from app.services.story_world_cards import (
    story_world_card_to_out as _story_world_card_to_out,
)
from app.services.story_runtime import (
    StoryRuntimeDeps,
    generate_story_response as _generate_story_response,
)

try:
    from app.routers.admin import router as admin_router
except Exception:  # pragma: no cover - optional router should not break API startup
    admin_router = None

try:
    from app.routers.profiles import router as profiles_router
except Exception:  # pragma: no cover - optional router should not break API startup
    profiles_router = None

try:
    import pymorphy3
except Exception:  # pragma: no cover - optional dependency in runtime
    pymorphy3 = None

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
STORY_CONTEXT_LIMIT_MAX_TOKENS = 4_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 1_500
STORY_RESPONSE_MAX_TOKENS_MIN = 200
STORY_RESPONSE_MAX_TOKENS_MAX = 800
STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS = 4
STORY_POSTPROCESS_READ_TIMEOUT_SECONDS = 7
STORY_PLOT_CARD_MEMORY_MAX_INPUT_TOKENS = 1_800
STORY_PLOT_CARD_MAX_ASSISTANT_MESSAGES = 40
STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS = 900
STORY_PLOT_CARD_MEMORY_TARGET_MAX_LINES = 5
STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS = 150
STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES = 4
STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_TOKENS = 600
STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS = 6
STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS = 25
STORY_PLOT_CARD_REQUEST_MAX_TOKENS = 700
STORY_PLOT_CARD_MEMORY_FREE_MODEL = "z-ai/glm-4.5-air:free"
STORY_TURN_IMAGE_PROMPT_MAX_USER_CHARS = 460
STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS = 1_600
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARDS = 5
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_TITLE_CHARS = 80
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_CONTENT_CHARS = 360
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS = 3
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS = 420
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_CHARS = 620
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS = 6
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS = 3_000
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_SCOPE = {"main_hero", "npc"}
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_REQUIRED = True
STORY_TURN_IMAGE_STYLE_PROMPT_MAX_CHARS = 320
STORY_TURN_IMAGE_MODEL_FLUX = "black-forest-labs/flux.2-pro"
STORY_TURN_IMAGE_MODEL_SEEDREAM = "bytedance-seed/seedream-4.5"
STORY_TURN_IMAGE_MODEL_NANO_BANANO = "google/gemini-2.5-flash-image"
STORY_TURN_IMAGE_MODEL_NANO_BANANO_2 = "google/gemini-3.1-flash-image-preview"
STORY_TURN_IMAGE_COST_BY_MODEL = {
    STORY_TURN_IMAGE_MODEL_FLUX: 3,
    STORY_TURN_IMAGE_MODEL_SEEDREAM: 5,
    STORY_TURN_IMAGE_MODEL_NANO_BANANO: 15,
    STORY_TURN_IMAGE_MODEL_NANO_BANANO_2: 30,
}
STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS = 8
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT = 45
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL = {
    STORY_TURN_IMAGE_MODEL_NANO_BANANO_2: 180,
}
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT = 2_600
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM = 8_000
STORY_TURN_IMAGE_GENDER_PATTERNS_FEMALE: tuple[tuple[str, int], ...] = (
    (r"\bпол\s*[:=-]?\s*жен\w*\b", 10),
    (r"\bgender\s*[:=-]?\s*female\b", 10),
    (r"\bsex\s*[:=-]?\s*female\b", 10),
    (r"\bженщин\w*\b", 6),
    (r"\bдевушк\w*\b", 6),
    (r"\bдевочк\w*\b", 6),
    (r"\bженск\w*\b", 4),
    (r"\bгероин\w*\b", 4),
    (r"\bfemale\b", 6),
    (r"\bwoman\b", 6),
    (r"\bgirl\b", 6),
    (r"\bshe\b", 2),
    (r"\bher\b", 1),
    (r"\bона\b", 2),
    (r"\bе[её]\b", 1),
)
STORY_TURN_IMAGE_GENDER_PATTERNS_MALE: tuple[tuple[str, int], ...] = (
    (r"\bпол\s*[:=-]?\s*муж\w*\b", 10),
    (r"\bgender\s*[:=-]?\s*male\b", 10),
    (r"\bsex\s*[:=-]?\s*male\b", 10),
    (r"\bмужчин\w*\b", 6),
    (r"\bпарн\w*\b", 6),
    (r"\bюнош\w*\b", 6),
    (r"\bмальчик\w*\b", 6),
    (r"\bмальчиш\w*\b", 6),
    (r"\bмужск\w*\b", 4),
    (r"\bmale\b", 6),
    (r"\bman\b", 6),
    (r"\bboy\b", 6),
    (r"\bhe\b", 2),
    (r"\bhim\b", 1),
    (r"\bhis\b", 1),
    (r"\bон\b", 2),
    (r"\bего\b", 1),
    (r"\bему\b", 1),
)
STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS: tuple[str, ...] = (
    "внеш",
    "лиц",
    "черты лица",
    "волос",
    "цвет волос",
    "длина волос",
    "причес",
    "глаз",
    "цвет глаз",
    "бров",
    "ресниц",
    "губ",
    "нос",
    "челюст",
    "скул",
    "кожа",
    "родинк",
    "веснуш",
    "шрам",
    "тату",
    "piercing",
    "appearance",
    "face",
    "facial",
    "hair",
    "hair color",
    "hair length",
    "hairstyle",
    "eyes",
    "eye color",
    "eyebrow",
    "lips",
    "nose",
    "jaw",
    "cheek",
    "skin",
    "freckle",
    "scar",
    "tattoo",
)
STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS: tuple[str, ...] = (
    "длина волос",
    "ниже лопаток",
    "до лопаток",
    "до плеч",
    "до талии",
    "ниже плеч",
    "длинные волосы",
    "короткие волосы",
    "очень короткие волосы",
    "каре",
    "hair length",
    "below the shoulder blades",
    "to shoulder blades",
    "to shoulders",
    "to the waist",
    "long hair",
    "short hair",
    "bob cut",
)
STORY_NPC_PROFILE_CONTEXT_MAX_EXISTING_CARDS = 40
STORY_NPC_PROFILE_CONTEXT_CARD_CONTENT_MAX_CHARS = 260
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
    "девушка",
    "девчонка",
    "женщина",
    "парень",
    "мужчина",
    "юноша",
    "старик",
    "старуха",
    "ребенок",
    "ребёнок",
    "подросток",
    "child",
    "girl",
    "boy",
    "woman",
    "man",
    "teen",
    "teenager",
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
STORY_NPC_NON_NAME_TOKENS = {
    "он",
    "она",
    "оно",
    "они",
    "его",
    "ее",
    "её",
    "ему",
    "ей",
    "им",
    "ими",
    "их",
    "кто",
    "что",
    "который",
    "которая",
    "которое",
    "которые",
    "которого",
    "которой",
    "которую",
    "которым",
    "которыми",
    "которых",
    "этот",
    "эта",
    "это",
    "эти",
    "тот",
    "та",
    "те",
    "я",
    "ты",
    "мы",
    "вы",
    "мне",
    "меня",
    "мной",
    "нам",
    "нас",
    "тебе",
    "тебя",
    "тобой",
    "вам",
    "вас",
    "вами",
    "себя",
    "собой",
    "свой",
    "своя",
    "свои",
    "свое",
    "мой",
    "моя",
    "мои",
    "мое",
    "твой",
    "твоя",
    "твои",
    "твое",
    "наш",
    "наша",
    "наши",
    "ваш",
    "ваша",
    "ваши",
    "тихо",
    "громко",
    "быстро",
    "медленно",
    "просто",
    "дальше",
    "позже",
    "сейчас",
    "согласен",
    "согласна",
    "зная",
    "знает",
    "знаю",
    "знаешь",
    "знают",
    "говорит",
    "сказал",
    "сказала",
    "сказали",
    "ответил",
    "ответила",
}
STORY_NPC_SINGLE_TOKEN_NON_NAME_SUFFIXES = {
    "ая",
    "яя",
    "ое",
    "ее",
    "ого",
    "ему",
    "ому",
    "ыми",
    "ими",
    "ую",
    "юю",
}
STORY_GENERIC_CHANGED_TEXT_FRAGMENTS = (
    "обновлены важные детали",
    "updated important details",
    "карточка удалена как неактуальная",
    "deleted as irrelevant",
)
STORY_MATCH_TOKEN_PATTERN = re.compile(r"[0-9a-zа-яё]+", re.IGNORECASE)
STORY_TOKEN_ESTIMATE_PATTERN = re.compile(r"[0-9a-zа-яё]+|[^\s]", re.IGNORECASE)
STORY_SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?…])\s+")
STORY_BULLET_PREFIX_PATTERN = re.compile(r"^\s*[-•*]+\s*")
STORY_CYRILLIC_TOKEN_PATTERN = re.compile(r"^[а-яё]+$", re.IGNORECASE)
STORY_MARKUP_MARKER_PATTERN = re.compile(r"\[\[[^\]]+\]\]")
STORY_CJK_CHARACTER_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
STORY_LATIN_LETTER_PATTERN = re.compile(r"[A-Za-z]")
STORY_CYRILLIC_LETTER_PATTERN = re.compile(r"[А-Яа-яЁё]")
STORY_LATIN_WORD_PATTERN = re.compile(r"\b[A-Za-z]{3,}\b")
STORY_CYRILLIC_WORD_PATTERN = re.compile(r"\b[А-Яа-яЁё]{3,}\b")
STORY_MARKUP_PARAGRAPH_PATTERN = re.compile(
    r"^\[\[\s*([a-z_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_MARKUP_STANDALONE_PATTERN = re.compile(
    r"^\[\[\s*([a-z_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*$",
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
STORY_NPC_SPEAKER_LINE_PATTERN = re.compile(
    r"^\s*([A-ZА-ЯЁ][^:\n]{0,80}?)(?:\s*\((?:в голове|мысленно|мысли)\))?\s*:\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_NPC_ROLE_SUFFIX_PATTERN = re.compile(
    r"\s*\((?:г|р|gg|mc|npc|pc|hero|player|main_hero|mainhero)\)\s*$",
    re.IGNORECASE,
)
STORY_NPC_NARRATIVE_NAME_BEFORE_VERB_PATTERN = re.compile(
    r"\b([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ][а-яё]{2,})?)\b(?:\s+|,\s*)(?:[а-яё-]+\s+){0,4}(?:"
    r"вош\w*|заш\w*|переступ\w*|сказ\w*|произн\w*|говор\w*|улыб\w*|кив\w*|подош\w*|смотр\w*|"
    r"ответ\w*|шеп\w*|спрос\w*|появ\w*|обня\w*|вздох\w*|махн\w*"
    r")\b",
)
STORY_NPC_NARRATIVE_VERB_BEFORE_NAME_PATTERN = re.compile(
    r"\b(?:вош\w*|заш\w*|переступ\w*|подош\w*|появ\w*|сказ\w*|произн\w*|говор\w*|ответ\w*|шеп\w*|спрос\w*)\b"
    r"(?:\s+|,\s*)(?:[а-яё-]+\s+){0,4}([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ][а-яё]{2,})?)\b",
)
STORY_EXPLICIT_PERSON_NAME_PATTERN = re.compile(
    r"\b([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ][а-яё]{2,})?)\b",
)
STORY_NPC_NAME_EXCLUDED_TOKENS = {
    "игрок",
    "ии",
    "мастер",
    "рассказчик",
    "narrator",
    "narration",
    "gg",
    "mc",
}
STORY_NPC_RELATION_HINT_PATTERN = re.compile(
    r"\b(брат|сестр|подруг|друг|мать|отец|сын|доч|жена|муж|коллег|родствен|семь[ия]|любим)\w*\b",
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
STORY_NON_SAMPLING_MODEL_HINTS = {
    "meta-llama/llama-3.3-70b-instruct:free",
}
STORY_PAID_MODEL_HINTS = {
    "z-ai/glm-5",
    "arcee-ai/trinity",
    "moonshotai/kimi-k2",
}
STORY_PAID_MODEL_CONTEXT_LIMIT_FACTOR = 0.75
STORY_PAID_MODEL_CONTEXT_LIMIT_MIN = 1_200
STORY_PROMPT_COMPACT_MAX_INSTRUCTION_CARDS = 12
STORY_PROMPT_COMPACT_MAX_PLOT_CARDS = 8
STORY_PROMPT_COMPACT_MAX_WORLD_CARDS = 10
STORY_PROMPT_COMPACT_TITLE_MAX_CHARS = 90
STORY_PROMPT_COMPACT_INSTRUCTION_MAX_CHARS = 320
STORY_PROMPT_COMPACT_PLOT_MAX_CHARS = 300
STORY_PROMPT_COMPACT_WORLD_MAX_CHARS = 280
STORY_PROMPT_COMPACT_TRIGGER_MAX_ITEMS = 4
STORY_PROMPT_COMPACT_TRIGGER_MAX_CHARS = 36
STORY_TEXT_CHARACTER_CARD_LOCK_SCOPE = {
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    STORY_WORLD_CARD_KIND_NPC,
}
STORY_RUSSIAN_INFLECTION_ENDINGS = tuple(
    sorted(
        {
            "иями",
            "ями",
            "ами",
            "его",
            "ого",
            "ему",
            "ому",
            "ыми",
            "ими",
            "иях",
            "ях",
            "ах",
            "ов",
            "ев",
            "ей",
            "ой",
            "ий",
            "ый",
            "ая",
            "яя",
            "ое",
            "ее",
            "ую",
            "юю",
            "ою",
            "ею",
            "ам",
            "ям",
            "ом",
            "ем",
            "ую",
            "юю",
            "ия",
            "ья",
            "ие",
            "ье",
            "ию",
            "ью",
            "ию",
            "ая",
            "яя",
            "ам",
            "ям",
            "ах",
            "ях",
            "а",
            "я",
            "ы",
            "и",
            "у",
            "ю",
            "е",
            "о",
            "й",
            "ь",
        },
        key=len,
        reverse=True,
    )
)
STORY_LATIN_TO_CYRILLIC_LOOKALIKE_TABLE = str.maketrans(
    {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "h": "н",
        "k": "к",
        "m": "м",
        "o": "о",
        "p": "р",
        "t": "т",
        "x": "х",
        "y": "у",
    }
)
STORY_RESPONSE_BUDGET_TARGET_FACTOR = 0.85
STORY_RESPONSE_MIN_TARGET_TOKENS = 120
STORY_OUTPUT_SENTENCE_END_CHARS = ".!?…"
STORY_OUTPUT_CLOSING_CHARS = "\"'”»)]}"
STORY_OUTPUT_TERMINAL_CHARS = STORY_OUTPUT_SENTENCE_END_CHARS + STORY_OUTPUT_CLOSING_CHARS
STORY_MORPH_ANALYZER: Any | bool | None = None
STORY_PLOT_CARD_DEFAULT_TITLE = "Суть текущего эпизода"
STORY_PLOT_CARD_TITLE_WORD_MAX = 7
STORY_PLOT_CARD_POINT_PREFIX_PATTERN = re.compile(
    r"^(?:контекст|цель|конфликт|факты|факт|риск|незакрытое)\s*:\s*",
    re.IGNORECASE,
)
STORY_SYSTEM_PROMPT = (
    "Ты ведущий интерактивной текстовой RPG и пишешь как рассказчик. "
    "Отвечай только на русском языке. "
    "Продолжай сцену строго по действию игрока, без советов и объяснения правил. "
    "Пиши художественно от второго лица с учетом контекста и карточек. "
    "Не выходи из роли, не упоминай ИИ и не добавляй мета-комментарии. "
    "Формат ответа: 2-5 абзацев. Протокол маркеров обязателен."
)
STORY_DIALOGUE_FORMAT_RULES = (
    "Следуй карточкам инструкций и мира молча, не перечисляй их.",
    "Если история и активные карточки мира конфликтуют, приоритет всегда у активных карточек мира.",
    "Если в текущей сцене введен новый именованный персонаж, используй именно это имя в [[NPC:...]] и не подменяй его другим известным персонажем.",
    "Каждый абзац начинается ровно одним маркером и пробелом.",
    "Допустимые маркеры:",
    "1) [[NARRATOR]] текст",
    "2) [[NPC:ИмяИлиРоль]] текст",
    "3) [[GG:Имя]] текст",
    "4) [[NPC_THOUGHT:ИмяИлиРоль]] текст",
    "5) [[GG_THOUGHT:Имя]] текст",
    "Одна реплика или мысль = один абзац.",
    "Для речи используй только [[NPC:...]] и [[GG:...]].",
    "Для мыслей используй только [[NPC_THOUGHT:...]] и [[GG_THOUGHT:...]].",
    "Не используй заглушки типа НПС/NPC/Персонаж/Реплика/Голос.",
    "Если говорящий есть в карточке мира или героя, используй точный title карточки.",
    "Без JSON, markdown, списков и код-блоков.",
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
app.include_router(story_turn_image_router)
app.include_router(story_games_router)
app.include_router(story_instruction_templates_router)
app.include_router(story_messages_router)
app.include_router(story_read_router)
app.include_router(story_undo_router)
app.include_router(story_world_cards_router)
if admin_router is not None:
    app.include_router(admin_router)
else:
    logger.warning("Admin router is unavailable and will be skipped")
if profiles_router is not None:
    app.include_router(profiles_router)
else:
    logger.warning("Profiles router is unavailable and will be skipped")


@app.on_event("startup")
def on_startup() -> None:
    if not settings.db_bootstrap_on_startup:
        logger.info(
            "Skipping database bootstrap on startup for app_mode=%s (DB_BOOTSTRAP_ON_STARTUP=%s)",
            settings.app_mode,
            settings.db_bootstrap_on_startup,
        )
        return

    try:
        bootstrap_database(
            database_url=settings.database_url,
            defaults=StoryBootstrapDefaults(
                context_limit_tokens=STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
                response_max_tokens=STORY_DEFAULT_RESPONSE_MAX_TOKENS,
                private_visibility=STORY_GAME_VISIBILITY_PRIVATE,
                world_kind=STORY_WORLD_CARD_KIND_WORLD,
                npc_kind=STORY_WORLD_CARD_KIND_NPC,
                main_hero_kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
                memory_turns_default=STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
                memory_turns_npc=STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
                memory_turns_always=STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
            ),
        )
    except Exception:
        logger.exception("Database bootstrap failed during startup; continuing without blocking API process")


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


def _normalize_story_response_max_tokens(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_RESPONSE_MAX_TOKENS
    normalized = int(value)
    if STORY_RESPONSE_MAX_TOKENS_MIN <= normalized <= STORY_RESPONSE_MAX_TOKENS_MAX:
        return normalized
    return STORY_DEFAULT_RESPONSE_MAX_TOKENS


def _spend_user_tokens_if_sufficient(db: Session, user_id: int, tokens: int) -> bool:
    return _spend_user_tokens_if_sufficient_raw(
        db,
        user_id=int(user_id),
        tokens=max(int(tokens), 0),
    )


def _add_user_tokens(db: Session, user_id: int, tokens: int) -> None:
    _add_user_tokens_raw(
        db,
        user_id=int(user_id),
        tokens=max(int(tokens), 0),
    )


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


def _split_story_text_into_sentences(value: str) -> list[str]:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return []

    sentences: list[str] = []
    for raw_line in normalized.split("\n"):
        line = STORY_BULLET_PREFIX_PATTERN.sub("", raw_line).strip()
        if not line:
            continue
        compact_line = re.sub(r"\s+", " ", line).strip()
        if not compact_line:
            continue
        for sentence in STORY_SENTENCE_SPLIT_PATTERN.split(compact_line):
            compact_sentence = sentence.strip()
            if compact_sentence:
                sentences.append(compact_sentence)
    return sentences


def _format_story_sentences(sentences: list[str], *, use_bullets: bool) -> str:
    if not sentences:
        return ""
    if use_bullets:
        return "\n".join(f"- {sentence}" for sentence in sentences)
    return " ".join(sentences)


def _trim_story_text_tail_by_sentence_tokens(value: str, token_limit: int) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    if token_limit <= 0:
        return ""

    sentences = _split_story_text_into_sentences(normalized)
    if not sentences:
        return _trim_story_text_tail_by_tokens(normalized, token_limit)

    use_bullets = any(STORY_BULLET_PREFIX_PATTERN.match(line) for line in normalized.split("\n"))
    selected_reversed: list[str] = []
    consumed_tokens = 0

    for sentence in reversed(sentences):
        sentence_cost = _estimate_story_tokens(sentence) + 1
        if consumed_tokens + sentence_cost <= token_limit:
            selected_reversed.append(sentence)
            consumed_tokens += sentence_cost
            continue
        if not selected_reversed:
            fallback_tail = _trim_story_text_tail_by_tokens(sentence, max(token_limit, 1))
            if fallback_tail:
                selected_reversed.append(fallback_tail)
        break

    selected = list(reversed(selected_reversed))
    return _format_story_sentences(selected, use_bullets=use_bullets)


def _drop_story_oldest_sentence(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        return ""

    sentences = _split_story_text_into_sentences(normalized)
    if len(sentences) <= 1:
        return ""

    use_bullets = any(STORY_BULLET_PREFIX_PATTERN.match(line) for line in normalized.split("\n"))
    return _format_story_sentences(sentences[1:], use_bullets=use_bullets)


def _normalize_story_plot_cards_for_prompt(plot_cards: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized_cards: list[dict[str, str]] = []
    for card in plot_cards:
        title = " ".join(str(card.get("title", "")).replace("\r\n", " ").split()).strip()
        content = str(card.get("content", "")).replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        normalized_cards.append({"title": title, "content": content})
    return normalized_cards


def _trim_story_plot_cards_to_context_limit(
    plot_cards: list[dict[str, str]],
    context_limit_tokens: int,
) -> list[dict[str, str]]:
    if not plot_cards:
        return []

    limit = max(int(context_limit_tokens), 0)
    if limit <= 0:
        return []

    selected_reversed: list[dict[str, str]] = []
    consumed_tokens = 0

    for card in reversed(plot_cards):
        title = " ".join(str(card.get("title", "")).replace("\r\n", " ").split()).strip()
        content = str(card.get("content", "")).replace("\r\n", "\n").strip()
        if not title or not content:
            continue

        entry_cost = _estimate_story_tokens(title) + _estimate_story_tokens(content) + 6
        if consumed_tokens + entry_cost <= limit:
            selected_reversed.append({"title": title, "content": content})
            consumed_tokens += entry_cost
            continue

        if not selected_reversed:
            title_cost = _estimate_story_tokens(title) + 6
            content_budget_tokens = max(limit - title_cost, 1)
            trimmed_content = _trim_story_text_tail_by_sentence_tokens(content, content_budget_tokens)
            if trimmed_content:
                selected_reversed.append({"title": title, "content": trimmed_content})
        break

    selected_reversed.reverse()
    return selected_reversed


def _fit_story_plot_cards_to_context_limit(
    *,
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_tokens: int,
    reserved_history_tokens: int = 0,
    model_name: str | None = None,
    response_max_tokens: int | None = None,
) -> list[dict[str, str]]:
    normalized_plot_cards = _normalize_story_plot_cards_for_prompt(plot_cards)
    if not normalized_plot_cards:
        return []
    system_budget_tokens = max(int(context_limit_tokens) - max(int(reserved_history_tokens), 0), 0)
    if system_budget_tokens <= 0:
        return []

    base_system_prompt = _build_story_system_prompt(
        instruction_cards,
        [],
        world_cards,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    base_system_tokens = _estimate_story_tokens(base_system_prompt)
    if base_system_tokens >= system_budget_tokens:
        return []

    plot_section_overhead_tokens = _estimate_story_tokens("Карточки памяти сюжета:")
    plot_budget_tokens = max(system_budget_tokens - base_system_tokens - plot_section_overhead_tokens, 0)
    fitted_plot_cards = _trim_story_plot_cards_to_context_limit(normalized_plot_cards, plot_budget_tokens)
    if not fitted_plot_cards:
        return []

    system_prompt = _build_story_system_prompt(
        instruction_cards,
        fitted_plot_cards,
        world_cards,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    iteration_count = 0
    while (
        _estimate_story_tokens(system_prompt) > system_budget_tokens
        and fitted_plot_cards
        and iteration_count < 400
    ):
        oldest_card = fitted_plot_cards[0]
        shortened_content = _drop_story_oldest_sentence(oldest_card.get("content", ""))
        if shortened_content:
            fitted_plot_cards[0] = {
                "title": oldest_card.get("title", "").strip(),
                "content": shortened_content,
            }
        else:
            fitted_plot_cards = fitted_plot_cards[1:]
        system_prompt = _build_story_system_prompt(
            instruction_cards,
            fitted_plot_cards,
            world_cards,
            model_name=model_name,
            response_max_tokens=response_max_tokens,
        )
        iteration_count += 1

    return [
        card
        for card in fitted_plot_cards
        if str(card.get("title", "")).strip() and str(card.get("content", "")).strip()
    ]


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


def _split_story_world_trigger_candidates(value: str) -> list[str]:
    normalized = value.replace("\r\n", "\n")
    parts = re.split(r"[,;\n]+", normalized)
    return [part.strip() for part in parts if part.strip()]


def _normalize_story_world_card_triggers(values: list[str], *, fallback_title: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        candidate_values = _split_story_world_trigger_candidates(raw_value)
        if not candidate_values:
            candidate_values = [raw_value]
        for candidate in candidate_values:
            trigger = _normalize_story_world_card_trigger(candidate)
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
        candidate_values = _split_story_world_trigger_candidates(item)
        if not candidate_values:
            candidate_values = [item]
        for candidate in candidate_values:
            trigger = _normalize_story_world_card_trigger(candidate)
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


def _cleanup_story_npc_candidate_name(value: str) -> str:
    normalized = " ".join(str(value or "").split()).strip(" .,:;!?-\"'[]")
    if not normalized:
        return ""
    without_role_suffix = STORY_NPC_ROLE_SUFFIX_PATTERN.sub("", normalized).strip(" .,:;!?-\"'()[]")
    if len(without_role_suffix) > STORY_CHARACTER_MAX_NAME_LENGTH:
        without_role_suffix = without_role_suffix[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
    return without_role_suffix


def _is_story_npc_single_token_person_name_like(token: str) -> bool:
    normalized_token = token.strip().casefold()
    if not normalized_token:
        return False
    if normalized_token in STORY_NPC_GENERIC_NAME_TOKENS or normalized_token in STORY_NPC_NON_NAME_TOKENS:
        return False
    if normalized_token.isdigit():
        return False

    analyzer = _get_story_morph_analyzer()
    if analyzer is not None:
        try:
            parsed_variants = analyzer.parse(normalized_token)
        except Exception:
            parsed_variants = []
        has_non_name_grammar = False
        for parsed_variant in parsed_variants[:6]:
            tag_value = str(getattr(parsed_variant, "tag", ""))
            if any(marker in tag_value for marker in ("Name", "Surn", "Patr")):
                return True
            if any(marker in tag_value for marker in ("ADJF", "ADJS", "NUMR", "NPRO")):
                has_non_name_grammar = True
        if has_non_name_grammar:
            return False

    if len(normalized_token) >= 7 and any(
        normalized_token.endswith(suffix) for suffix in STORY_NPC_SINGLE_TOKEN_NON_NAME_SUFFIXES
    ):
        return False
    return True


def _is_story_generic_npc_name(value: str) -> bool:
    compact_value = _cleanup_story_npc_candidate_name(value)
    if not compact_value:
        return True
    has_uppercase_letter = any(char.isalpha() and char.isupper() for char in compact_value)
    if not has_uppercase_letter:
        return True

    tokens = _normalize_story_match_tokens(compact_value)
    if not tokens:
        return True
    if len(tokens) > 4:
        return True
    if any(len(token) < 2 for token in tokens):
        return True
    if any(token in STORY_NPC_NON_NAME_TOKENS for token in tokens):
        return True
    if len(tokens) == 1:
        token = tokens[0]
        if token in STORY_NPC_GENERIC_NAME_TOKENS:
            return True
        return not _is_story_npc_single_token_person_name_like(token)
    if len(tokens) <= 3:
        if all(token in STORY_NPC_GENERIC_NAME_TOKENS for token in tokens):
            return True
        return not _is_story_npc_single_token_person_name_like(tokens[0])
    return False


def _infer_story_npc_gender_from_context(name: str, prompt: str, assistant_text: str) -> str:
    name_key = name.casefold()
    prompt_text = prompt.replace("\r\n", "\n").strip()
    assistant_text_value = assistant_text.replace("\r\n", "\n").strip()
    combined_context = f"{prompt_text}\n{assistant_text_value}"
    plain_context = _normalize_story_markup_to_plain_text(combined_context).casefold()
    if not plain_context or not name_key:
        return ""

    female_cues = ("она", "её", "ее", "ей", "сестра", "девушка", "женщина", "дочь", "сказала", "улыбнулась")
    male_cues = ("он", "его", "ему", "брат", "парень", "мужчина", "сын", "сказал", "улыбнулся")

    female_score = 0
    male_score = 0
    for cue in female_cues:
        if re.search(rf"(?:{re.escape(name_key)}[^\n]{{0,100}}\b{cue}\b|\b{cue}\b[^\n]{{0,100}}{re.escape(name_key)})", plain_context):
            female_score += 1
    for cue in male_cues:
        if re.search(rf"(?:{re.escape(name_key)}[^\n]{{0,100}}\b{cue}\b|\b{cue}\b[^\n]{{0,100}}{re.escape(name_key)})", plain_context):
            male_score += 1

    if female_score > male_score and female_score > 0:
        return "женский"
    if male_score > female_score and male_score > 0:
        return "мужской"
    return ""


def _extract_story_npc_profile_field(lines: list[str], prefixes: tuple[str, ...]) -> str:
    for line in lines:
        lowered = line.casefold()
        for prefix in prefixes:
            normalized_prefix = prefix.casefold()
            if not lowered.startswith(normalized_prefix):
                continue
            value = line.split(":", 1)[1].strip() if ":" in line else line[len(prefix) :].strip(" -:\t")
            value = " ".join(value.split()).strip()
            if value:
                return value
    return ""


def _strip_story_npc_profile_nested_prefixes(value: str) -> str:
    compact = " ".join(str(value or "").split()).strip(" -")
    if not compact:
        return ""

    known_prefixes = (
        "пол",
        "gender",
        "возраст",
        "age",
        "внешность",
        "appearance",
        "облик",
        "черты и роль",
        "traits_role",
        "traits",
        "характер",
        "personality",
        "связи и важное",
        "relations_important",
        "important",
        "важное",
        "связи",
        "роль",
    )
    previous = ""
    current = compact
    while current and current != previous:
        previous = current
        for prefix in known_prefixes:
            current = re.sub(rf"^{re.escape(prefix)}\s*:\s*", "", current, flags=re.IGNORECASE).strip(" -")
    return current


def _sanitize_story_npc_profile_value(value: str) -> str:
    plain = _normalize_story_markup_to_plain_text(str(value or ""))
    compact = " ".join(plain.replace("\r", " ").replace("\n", " ").split()).strip(" -")
    if not compact:
        return ""
    return _strip_story_npc_profile_nested_prefixes(compact)


def _is_story_npc_profile_placeholder(value: str) -> bool:
    compact = " ".join(str(value or "").split()).strip().casefold()
    if not compact:
        return True
    return compact in {
        "не указан",
        "не указана",
        "не указано",
        "неизвестно",
        "unknown",
        "n/a",
        "нет",
        "none",
    }


def _clean_story_npc_profile_fragment(value: str, *, name: str) -> str:
    plain = _normalize_story_markup_to_plain_text(value)
    compact = " ".join(plain.replace("\r", " ").replace("\n", " ").split()).strip(" -")
    if not compact:
        return ""
    compact = re.sub(
        rf"^{re.escape(name)}\s*:\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    ).strip(" -")
    compact = re.sub(r"^[—-]+\s*", "", compact).strip()
    compact = re.sub(r"\s*[—-]{2,}\s*", ". ", compact).strip()
    if not compact:
        return ""
    return compact


def _is_story_dialogue_like_fragment(value: str) -> bool:
    compact = " ".join(value.split()).strip()
    if not compact:
        return False
    if re.match(r"^[^:]{1,40}:\s*[—\-\"«*]", compact):
        return True
    if re.match(r"^[^:]{1,40}\([^)]{1,30}\)\s*:\s*[*\"«—\-]", compact):
        return True
    if compact.count("—") >= 2:
        return True
    if "*" in compact and ":" in compact:
        return True
    if "сказал" in compact.casefold() or "сказала" in compact.casefold():
        return True
    if re.search(r"[!?]\s*[—-]", compact):
        return True
    if re.search(r"\b(привет|привеет|эй|слушай|алло|постой)\b", compact, flags=re.IGNORECASE):
        if "—" in compact or "!" in compact or "?" in compact:
            return True
    if "(в голове)" in compact.casefold():
        return True
    return False


def _normalize_story_npc_profile_content(name: str, content: str) -> str:
    plain_content = _normalize_story_markup_to_plain_text(str(content or ""))
    normalized_content = _normalize_story_world_card_content(plain_content or content)
    if not normalized_content:
        return normalized_content

    raw_lines = [line.strip() for line in normalized_content.split("\n") if line.strip()]
    cleaned_lines = [_clean_story_npc_profile_fragment(line, name=name) for line in raw_lines]
    cleaned_lines = [line for line in cleaned_lines if line]

    gender_value = _sanitize_story_npc_profile_value(_extract_story_npc_profile_field(cleaned_lines, ("пол", "gender")))
    age_value = _sanitize_story_npc_profile_value(_extract_story_npc_profile_field(cleaned_lines, ("возраст", "age")))
    appearance_value = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(cleaned_lines, ("внешность", "appearance", "облик"))
    )
    traits_value = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(
            cleaned_lines,
            ("черты и роль", "traits_role", "traits", "характер", "personality", "манеры", "поведение"),
        )
    )
    important_value = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(
            cleaned_lines,
            ("связи и важное", "relations_important", "важное", "important", "связи"),
        )
    )

    if _is_story_dialogue_like_fragment(appearance_value):
        appearance_value = ""
    if _is_story_dialogue_like_fragment(traits_value):
        traits_value = ""
    if _is_story_dialogue_like_fragment(important_value):
        important_value = ""
    if _is_story_npc_profile_placeholder(gender_value):
        gender_value = ""
    if _is_story_npc_profile_placeholder(age_value):
        age_value = ""
    if _is_story_npc_profile_placeholder(traits_value):
        traits_value = ""
    if _is_story_npc_profile_placeholder(important_value):
        important_value = ""

    narrative_lines: list[str] = []
    for line in cleaned_lines:
        candidate = _sanitize_story_npc_profile_value(line)
        if not candidate:
            continue
        if _is_story_dialogue_like_fragment(candidate):
            continue
        if candidate not in narrative_lines:
            narrative_lines.append(candidate)

    if not appearance_value:
        appearance_candidates = [
            line
            for line in narrative_lines
            if re.search(r"\b(внеш|волос|глаз|одежд|рост|лиц|телослож|фигур|походк|голос)\w*\b", line.casefold())
        ]
        if appearance_candidates:
            appearance_value = appearance_candidates[0]
    if not traits_value:
        traits_candidates = [
            line
            for line in narrative_lines
            if any(token in line.casefold() for token in ("характер", "манер", "повед", "роль", "привыч", "темпер"))
        ]
        if traits_candidates:
            traits_value = traits_candidates[0]
    if not traits_value:
        fallback_traits = [line for line in narrative_lines if line != appearance_value]
        if fallback_traits:
            traits_value = fallback_traits[0]
    if not important_value:
        important_candidates = [
            line for line in narrative_lines if any(token in line.casefold() for token in ("цель", "роль", "связ", "важ"))
        ]
        if important_candidates:
            important_value = important_candidates[0]

    gender_value = gender_value or "не указано"
    age_value = age_value or "не указан"
    appearance_value = appearance_value or "опрятная внешность; заметные черты и стиль уточняются в ходе сюжета."
    traits_value = traits_value or "характер и роль уточняются по мере развития сцены."
    important_value = important_value or f"{name} участвует в текущем эпизоде и влияет на ход сцены."

    return _normalize_story_world_card_content(
        (
            f"Пол: {gender_value}\n"
            f"Возраст: {age_value}\n"
            f"Внешность: {appearance_value}\n"
            f"Черты и роль: {traits_value}\n"
            f"Связи и важное: {important_value}"
        )
    )


def _has_story_valid_npc_appearance(content: str) -> bool:
    normalized_content = str(content or "").replace("\r\n", "\n").strip()
    if not normalized_content:
        return False
    lines = [line.strip() for line in normalized_content.split("\n") if line.strip()]
    appearance_value = _extract_story_npc_profile_field(lines, ("внешность", "appearance", "облик"))
    appearance_value = _sanitize_story_npc_profile_value(appearance_value)
    if not appearance_value:
        return False
    if _is_story_dialogue_like_fragment(appearance_value):
        return False
    lowered = appearance_value.casefold()
    if "заметные черты и стиль уточняются" in lowered:
        return False
    if _is_story_npc_profile_placeholder(appearance_value):
        return False
    return True


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


def _filter_story_identity_triggers(title: str, triggers: list[str]) -> list[str]:
    title_key = _normalize_story_identity_key(title)
    title_tokens = _normalize_story_match_tokens(title)
    primary_title_token = title_tokens[0] if title_tokens else ""
    filtered: list[str] = []

    for trigger in triggers:
        trigger_value = str(trigger or "").strip()
        if not trigger_value:
            continue
        trigger_key = _normalize_story_identity_key(trigger_value)
        if not trigger_key:
            continue

        if title_key and _are_story_identity_keys_related(trigger_key, title_key):
            filtered.append(trigger_value)
            continue

        trigger_tokens = _normalize_story_match_tokens(trigger_value)
        if not trigger_tokens or not primary_title_token:
            continue
        primary_trigger_token = trigger_tokens[0]
        if (
            primary_trigger_token == primary_title_token
            or primary_trigger_token.startswith(primary_title_token)
            or primary_title_token.startswith(primary_trigger_token)
        ):
            filtered.append(trigger_value)

    return filtered


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
        raw_triggers = _deserialize_story_world_card_triggers(card.triggers)
        identity_triggers = _filter_story_identity_triggers(card.title, raw_triggers)
        known_keys.update(_build_story_identity_keys(card.title, identity_triggers))
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
        raw_name = _cleanup_story_npc_candidate_name(marker_match.group(1))
        if not raw_name:
            continue
        if _is_story_generic_npc_name(raw_name):
            continue

        dialogue_text = " ".join(
            _normalize_story_markup_to_plain_text(marker_match.group(2)).replace("\r", " ").replace("\n", " ").split()
        ).strip()
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


def _extract_story_npc_speaker_line_mentions(assistant_text: str) -> list[dict[str, Any]]:
    mentions_by_key: dict[str, dict[str, Any]] = {}
    plain_text = _normalize_story_markup_to_plain_text(assistant_text)
    for paragraph in re.split(r"\n{2,}", plain_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue

        speaker_match = STORY_NPC_SPEAKER_LINE_PATTERN.match(paragraph_value)
        if speaker_match is None:
            continue
        raw_name = _cleanup_story_npc_candidate_name(speaker_match.group(1))
        if not raw_name:
            continue
        if _is_story_generic_npc_name(raw_name):
            continue

        dialogue_text = " ".join(speaker_match.group(2).replace("\r", " ").replace("\n", " ").split()).strip()
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


def _extract_story_npc_narrative_mentions(assistant_text: str) -> list[dict[str, Any]]:
    mentions_by_key: dict[str, dict[str, Any]] = {}
    plain_text = _normalize_story_markup_to_plain_text(assistant_text)
    for sentence in _split_story_text_into_sentences(plain_text):
        compact_sentence = re.sub(r"\s+", " ", sentence).strip()
        if not compact_sentence:
            continue
        candidate_matches = [
            *STORY_NPC_NARRATIVE_NAME_BEFORE_VERB_PATTERN.finditer(compact_sentence),
            *STORY_NPC_NARRATIVE_VERB_BEFORE_NAME_PATTERN.finditer(compact_sentence),
        ]
        for match in candidate_matches:
            raw_name = _cleanup_story_npc_candidate_name(match.group(1))
            if not raw_name:
                continue
            raw_name_key = raw_name.casefold()
            if raw_name_key in STORY_NPC_NAME_EXCLUDED_TOKENS:
                continue
            if _is_story_generic_npc_name(raw_name):
                continue

            mention = mentions_by_key.get(raw_name_key)
            if mention is None:
                mention = {"name": raw_name, "dialogues": [], "snippets": []}
                mentions_by_key[raw_name_key] = mention
            snippets_value = mention["snippets"]
            if compact_sentence not in snippets_value:
                snippets_value.append(compact_sentence)

    return list(mentions_by_key.values())


def _merge_story_npc_mentions(*sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mentions_by_key: dict[str, dict[str, Any]] = {}
    for source in sources:
        for mention in source:
            if not isinstance(mention, dict):
                continue
            raw_name = " ".join(str(mention.get("name", "")).split()).strip()
            if not raw_name:
                continue
            mention_key = raw_name.casefold()
            target = mentions_by_key.get(mention_key)
            if target is None:
                target = {"name": raw_name, "dialogues": [], "snippets": []}
                mentions_by_key[mention_key] = target

            dialogues = mention.get("dialogues")
            if isinstance(dialogues, list):
                for value in dialogues:
                    if not isinstance(value, str):
                        continue
                    compact = " ".join(value.replace("\r", " ").replace("\n", " ").split()).strip()
                    if compact and compact not in target["dialogues"]:
                        target["dialogues"].append(compact)

            snippets = mention.get("snippets")
            if isinstance(snippets, list):
                for value in snippets:
                    if not isinstance(value, str):
                        continue
                    compact = " ".join(value.replace("\r", " ").replace("\n", " ").split()).strip()
                    if compact and compact not in target["snippets"]:
                        target["snippets"].append(compact)
    return list(mentions_by_key.values())


def _is_story_secondary_npc_mention(mention: dict[str, Any]) -> bool:
    dialogues = mention.get("dialogues")
    dialogue_values = [value for value in dialogues if isinstance(value, str) and value.strip()] if isinstance(dialogues, list) else []
    if dialogue_values:
        return True

    snippets = mention.get("snippets")
    snippet_values = [value for value in snippets if isinstance(value, str) and value.strip()] if isinstance(snippets, list) else []
    if len(snippet_values) >= 2:
        return True
    if any(STORY_NPC_RELATION_HINT_PATTERN.search(value) is not None for value in snippet_values):
        return True
    return False


def _is_story_npc_title_matching_requested_name(requested_name: str, candidate_title: str) -> bool:
    requested_tokens = _normalize_story_match_tokens(requested_name)
    candidate_tokens = _normalize_story_match_tokens(candidate_title)
    if not requested_tokens or not candidate_tokens:
        return False
    primary_requested = requested_tokens[0]
    return primary_requested in candidate_tokens


def _build_story_npc_profile_context_cards_preview(
    *,
    existing_cards: list[StoryWorldCard],
    requested_name: str,
) -> str:
    requested_tokens = _normalize_story_match_tokens(requested_name)
    requested_key = requested_tokens[0] if requested_tokens else ""
    preview_payload: list[dict[str, Any]] = []

    for card in existing_cards:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        kind = _normalize_story_world_card_kind(card.kind)
        triggers = _deserialize_story_world_card_triggers(card.triggers)
        plain_content = _normalize_story_markup_to_plain_text(content)
        content_for_context = plain_content or content
        card_search_space = " ".join([title, *triggers, content_for_context]).casefold()
        is_related = (
            requested_key in card_search_space
            if requested_key
            else False
        )
        is_character_card = kind in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}
        if not is_related and not is_character_card:
            continue

        content_preview = _normalize_story_prompt_text(
            content_for_context,
            max_chars=STORY_NPC_PROFILE_CONTEXT_CARD_CONTENT_MAX_CHARS,
        )
        trigger_preview = [
            _normalize_story_prompt_text(trigger, max_chars=70)
            for trigger in triggers[:8]
            if isinstance(trigger, str) and trigger.strip()
        ]
        trigger_preview = [value for value in trigger_preview if value]
        preview_payload.append(
            {
                "title": title,
                "kind": kind,
                "triggers": trigger_preview,
                "content": content_preview,
            }
        )
        if len(preview_payload) >= STORY_NPC_PROFILE_CONTEXT_MAX_EXISTING_CARDS:
            break

    if not preview_payload:
        return "[]"
    return json.dumps(preview_payload, ensure_ascii=False)


def _build_story_npc_name_triggers(name: str) -> list[str]:
    normalized_name = _normalize_story_world_card_title(name)
    if not normalized_name:
        return []

    trigger_candidates = [normalized_name]
    name_parts = [part for part in normalized_name.replace(",", " ").split() if part]
    if len(name_parts) >= 2:
        surname = name_parts[-1].strip()
        if surname and surname.casefold() != normalized_name.casefold():
            trigger_candidates.append(surname)
    return _normalize_story_world_card_triggers(trigger_candidates, fallback_title=normalized_name)


def _build_story_npc_fallback_profile_content(
    *,
    name: str,
    prompt: str,
    assistant_text: str,
    dialogues: list[str],
    snippets: list[str],
    existing_cards: list[StoryWorldCard],
) -> str:
    inferred_gender = _infer_story_npc_gender_from_context(name, prompt, assistant_text) or "не указано"
    _ = (dialogues, snippets)  # Intentionally ignored: fallback must not copy raw GLM text into profile fields.
    requested_tokens = _normalize_story_match_tokens(name)
    requested_key = requested_tokens[0] if requested_tokens else ""
    important = ""
    if requested_key:
        for card in existing_cards:
            content = card.content.replace("\r\n", "\n").strip()
            if not content:
                continue
            content_plain = _normalize_story_markup_to_plain_text(content)
            search_space = f"{card.title} {content_plain or content}".casefold()
            if requested_key not in search_space:
                continue
            for sentence in _split_story_text_into_sentences(content_plain or content):
                compact_sentence = _normalize_story_prompt_text(sentence, max_chars=220)
                if not compact_sentence:
                    continue
                if STORY_NPC_RELATION_HINT_PATTERN.search(compact_sentence) is None:
                    continue
                important = compact_sentence
                break
            if important:
                break

    if inferred_gender == "женский":
        appearance = "девушка с опрятной внешностью и повседневным стилем одежды."
    elif inferred_gender == "мужской":
        appearance = "мужчина с опрятной внешностью и повседневным стилем одежды."
    else:
        appearance = "опрятный человек с узнаваемыми чертами внешности и повседневным стилем одежды."

    traits_role = "второстепенный участник сцены; манера общения и роль уточняются по ходу истории."
    important = important or f"{name} участвует в текущем эпизоде и влияет на развитие сцены."

    return _normalize_story_npc_profile_content(
        name,
        (
            f"Пол: {inferred_gender}\n"
            "Возраст: не указан\n"
            f"Внешность: {appearance}\n"
            f"Черты и роль: {traits_role}\n"
            f"Связи и важное: {important}"
        ),
    )


def _generate_story_npc_profile_with_openrouter(
    *,
    name: str,
    prompt: str,
    assistant_text: str,
    dialogues: list[str],
    snippets: list[str],
    existing_cards: list[StoryWorldCard],
) -> tuple[str, list[str], str] | None:
    if not settings.openrouter_api_key:
        return None

    model_name = OPENROUTER_GLM_AIR_FREE_MODEL
    if not model_name:
        return None

    normalized_name = " ".join(name.split()).strip()
    if not normalized_name or _is_story_generic_npc_name(normalized_name):
        return None
    title = _normalize_story_world_card_title(normalized_name)
    if not title:
        return None
    triggers = _build_story_npc_name_triggers(title)

    snippets_preview_lines: list[str] = []
    for raw_item in [*snippets[:6], *dialogues[:4]]:
        if not isinstance(raw_item, str) or not raw_item.strip():
            continue
        cleaned_item = _normalize_story_prompt_text(
            _normalize_story_markup_to_plain_text(raw_item),
            max_chars=280,
        )
        if not cleaned_item:
            continue
        snippets_preview_lines.append(f"- {cleaned_item}")
        if len(snippets_preview_lines) >= 8:
            break
    snippets_preview = "\n".join(snippets_preview_lines)
    if not snippets_preview:
        snippets_preview = "- Контекст о персонаже минимален."

    text_preview = _normalize_story_prompt_text(
        _normalize_story_markup_to_plain_text(assistant_text),
        max_chars=2200,
    )
    prompt_preview = _normalize_story_prompt_text(
        _normalize_story_markup_to_plain_text(prompt),
        max_chars=900,
    )
    existing_cards_preview = _build_story_npc_profile_context_cards_preview(
        existing_cards=existing_cards,
        requested_name=title,
    )

    base_system_content = (
        "Ты создаешь профиль ИМЕНОВАННОГО NPC для RPG. "
        "Верни только текст и только 5 строк в строгом шаблоне:\n"
        "Пол: ...\n"
        "Возраст: ...\n"
        "Внешность: ...\n"
        "Черты и роль: ...\n"
        "Связи и важное: ...\n"
        "Нельзя возвращать JSON, markdown или комментарии. "
        "Нельзя подменять имя персонажа. "
        "Запрещены маркеры [[...]], реплики с префиксом 'Имя:' и служебные теги."
    )
    base_user_content = (
        f"Имя нового персонажа: {title}\n\n"
        f"Последний ход игрока:\n{prompt_preview or 'нет'}\n\n"
        f"Фрагменты из сцены:\n{snippets_preview}\n\n"
        f"Контекст ответа мастера:\n{text_preview}\n\n"
        f"Уже существующие карточки мира (JSON):\n{existing_cards_preview}\n\n"
        "Верни только 5 строк в указанном шаблоне."
    )

    previous_attempt_response = ""
    for attempt_index in range(2):
        system_content = base_system_content
        user_content = base_user_content
        if attempt_index > 0:
            system_content += (
                " КРИТИЧНО: строка 'Внешность:' обязательна, без реплик и без диалога; "
                "она должна описывать только внешний вид персонажа."
            )
            if previous_attempt_response:
                previous_preview = _normalize_story_prompt_text(previous_attempt_response, max_chars=1200)
                user_content += (
                    "\n\nПредыдущий ответ был невалиден (для исправления):\n"
                    f"{previous_preview}\n\n"
                    "Исправь и верни новый ответ строго по шаблону 5 строк."
                )

        messages_payload = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        try:
            raw_response = _request_openrouter_story_text(
                messages_payload,
                model_name=model_name,
                allow_free_fallback=False,
                temperature=0.0,
                request_timeout=(
                    12,
                    45,
                ),
            )
        except Exception as exc:
            logger.warning("NPC profile generation failed: %s", exc)
            if attempt_index == 1:
                return None
            continue

        cleaned_response = _normalize_story_markup_to_plain_text(raw_response).replace("\r\n", "\n").strip()
        if not cleaned_response:
            logger.warning("NPC profile generation returned empty payload for name=%s", title)
            if attempt_index == 1:
                return None
            continue

        content = _normalize_story_npc_profile_content(title, cleaned_response)
        if _has_story_valid_npc_appearance(content):
            return (title, triggers, content)
        previous_attempt_response = cleaned_response
        logger.warning("NPC profile generation returned invalid appearance for name=%s", title)

    return None


def _build_story_npc_card_payload(
    *,
    name: str,
    prompt: str,
    assistant_text: str,
    dialogues: list[str],
    snippets: list[str],
    existing_cards: list[StoryWorldCard],
) -> tuple[str, list[str], str] | None:
    generated_payload = _generate_story_npc_profile_with_openrouter(
        name=name,
        prompt=prompt,
        assistant_text=assistant_text,
        dialogues=dialogues,
        snippets=snippets,
        existing_cards=existing_cards,
    )
    if generated_payload is not None:
        return generated_payload

    normalized_name = _normalize_story_world_card_title(" ".join(name.split()).strip())
    if not normalized_name or _is_story_generic_npc_name(normalized_name):
        return None
    triggers = _build_story_npc_name_triggers(normalized_name)
    content = _build_story_npc_fallback_profile_content(
        name=normalized_name,
        prompt=prompt,
        assistant_text=assistant_text,
        dialogues=dialogues,
        snippets=snippets,
        existing_cards=existing_cards,
    )
    return (normalized_name, triggers, content)


def _append_missing_story_npc_card_operations(
    *,
    operations: list[dict[str, Any]],
    prompt: str,
    assistant_text: str,
    existing_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    if len(operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
        return operations

    npc_mentions = _merge_story_npc_mentions(
        _extract_story_npc_dialogue_mentions(assistant_text),
        _extract_story_npc_speaker_line_mentions(assistant_text),
        _extract_story_npc_narrative_mentions(assistant_text),
    )
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
        identity_operation_triggers = _filter_story_identity_triggers(operation_title, operation_triggers)
        pending_identity_keys.update(_build_story_identity_keys(operation_title, identity_operation_triggers))

    for mention in npc_mentions:
        if len(operations) >= STORY_WORLD_CARD_MAX_AI_CHANGES:
            break

        name = " ".join(str(mention.get("name", "")).split()).strip()
        if not name:
            continue
        if _is_story_generic_npc_name(name):
            continue
        if not _is_story_secondary_npc_mention(mention):
            continue
        mention_dialogues = mention.get("dialogues")
        dialogue_values = [item for item in mention_dialogues if isinstance(item, str)] if isinstance(mention_dialogues, list) else []
        mention_snippets = mention.get("snippets")
        snippet_values = [item for item in mention_snippets if isinstance(item, str)] if isinstance(mention_snippets, list) else []
        payload = _build_story_npc_card_payload(
            name=name,
            prompt=prompt,
            assistant_text=assistant_text,
            dialogues=dialogue_values,
            snippets=snippet_values,
            existing_cards=existing_cards,
        )
        if payload is None:
            continue
        title_value, mention_triggers, content = payload
        identity_triggers = _filter_story_identity_triggers(title_value, mention_triggers)
        if not identity_triggers:
            identity_triggers = [title_value]
        if _is_story_npc_identity_duplicate(
            candidate_name=title_value,
            candidate_triggers=identity_triggers,
            known_identity_keys=known_identity_keys,
        ):
            continue
        if _is_story_npc_identity_duplicate(
            candidate_name=title_value,
            candidate_triggers=identity_triggers,
            known_identity_keys=pending_identity_keys,
        ):
            continue

        operations.append(
            {
                "action": STORY_WORLD_CARD_EVENT_ADDED,
                "title": title_value,
                "content": content,
                "triggers": mention_triggers,
                "kind": STORY_WORLD_CARD_KIND_NPC,
                "changed_text": content,
            }
        )
        pending_identity_keys.update(_build_story_identity_keys(title_value, identity_triggers))

    return operations


def _ensure_story_npc_cards_from_dialogue(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    prompt: str,
    assistant_text: str,
) -> list[StoryWorldCardChangeEvent]:
    npc_mentions = _merge_story_npc_mentions(
        _extract_story_npc_dialogue_mentions(assistant_text),
        _extract_story_npc_speaker_line_mentions(assistant_text),
        _extract_story_npc_narrative_mentions(assistant_text),
    )
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
        if not _is_story_secondary_npc_mention(mention):
            continue
        mention_dialogues = mention.get("dialogues")
        dialogue_values = [item for item in mention_dialogues if isinstance(item, str)] if isinstance(mention_dialogues, list) else []
        mention_snippets = mention.get("snippets")
        snippet_values = [item for item in mention_snippets if isinstance(item, str)] if isinstance(mention_snippets, list) else []
        payload = _build_story_npc_card_payload(
            name=raw_name,
            prompt=prompt,
            assistant_text=assistant_text,
            dialogues=dialogue_values,
            snippets=snippet_values,
            existing_cards=existing_cards,
        )
        if payload is None:
            continue
        title_value, triggers_value, content_value = payload
        identity_triggers = _filter_story_identity_triggers(title_value, triggers_value)
        if not identity_triggers:
            identity_triggers = [title_value]
        if _is_story_npc_identity_duplicate(
            candidate_name=title_value,
            candidate_triggers=identity_triggers,
            known_identity_keys=existing_identity_keys,
        ):
            continue

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
        existing_identity_keys.update(_build_story_identity_keys(title_value, identity_triggers))

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
    return [
        _normalize_story_match_token_script(match.group(0))
        for match in STORY_MATCH_TOKEN_PATTERN.finditer(normalized_source)
    ]


def _normalize_story_match_token_script(token: str) -> str:
    normalized = token.strip().lower().replace("ё", "е")
    if not normalized:
        return ""
    has_cyrillic = any("а" <= char <= "я" for char in normalized)
    has_latin = any("a" <= char <= "z" for char in normalized)
    if has_cyrillic and has_latin:
        return normalized.translate(STORY_LATIN_TO_CYRILLIC_LOOKALIKE_TABLE)
    return normalized


def _get_story_morph_analyzer() -> Any | None:
    global STORY_MORPH_ANALYZER
    if pymorphy3 is None:
        return None
    if STORY_MORPH_ANALYZER is False:
        return None
    if STORY_MORPH_ANALYZER is None:
        try:
            STORY_MORPH_ANALYZER = pymorphy3.MorphAnalyzer(lang="ru")
        except Exception:
            STORY_MORPH_ANALYZER = False
            return None
    if STORY_MORPH_ANALYZER is False:
        return None
    return STORY_MORPH_ANALYZER


def _derive_story_russian_stems(token: str) -> set[str]:
    if len(token) < 4:
        return {token}
    if STORY_CYRILLIC_TOKEN_PATTERN.fullmatch(token) is None:
        return {token}

    stems: set[str] = {token}
    candidate = token
    for _ in range(2):
        stripped = False
        for ending in STORY_RUSSIAN_INFLECTION_ENDINGS:
            if len(candidate) - len(ending) < 3:
                continue
            if not candidate.endswith(ending):
                continue
            candidate = candidate[: len(candidate) - len(ending)]
            if candidate:
                stems.add(candidate)
                compact_candidate = candidate.rstrip("ьй")
                if len(compact_candidate) >= 3:
                    stems.add(compact_candidate)
            stripped = True
            break
        if not stripped:
            break

    return stems


@lru_cache(maxsize=20000)
def _build_story_token_match_forms(token: str) -> tuple[str, ...]:
    normalized = _normalize_story_match_token_script(token)
    if not normalized:
        return tuple()

    forms: set[str] = {normalized}
    if STORY_CYRILLIC_TOKEN_PATTERN.fullmatch(normalized):
        forms.update(_derive_story_russian_stems(normalized))
        analyzer = _get_story_morph_analyzer()
        if analyzer is not None:
            try:
                parsed_variants = analyzer.parse(normalized)
            except Exception:
                parsed_variants = []
            for parsed in parsed_variants[:4]:
                lemma = str(getattr(parsed, "normal_form", "")).strip().lower().replace("ё", "е")
                if lemma:
                    forms.add(_normalize_story_match_token_script(lemma))
                    forms.update(_derive_story_russian_stems(lemma))
                lexeme_values = getattr(parsed, "lexeme", None)
                if isinstance(lexeme_values, list):
                    for lexeme_item in lexeme_values[:96]:
                        word = str(getattr(lexeme_item, "word", "")).strip().lower().replace("ё", "е")
                        if not word:
                            continue
                        normalized_word = _normalize_story_match_token_script(word)
                        if not normalized_word:
                            continue
                        forms.add(normalized_word)
                        forms.update(_derive_story_russian_stems(normalized_word))

    return tuple(sorted(form for form in forms if form))


def _is_story_token_match(trigger_token: str, prompt_token: str) -> bool:
    trigger_forms = _build_story_token_match_forms(trigger_token)
    prompt_forms = _build_story_token_match_forms(prompt_token)
    if not trigger_forms or not prompt_forms:
        return False

    if any(trigger_form == prompt_form for trigger_form in trigger_forms for prompt_form in prompt_forms):
        return True

    for trigger_form in trigger_forms:
        if len(trigger_form) < 4:
            continue
        for prompt_form in prompt_forms:
            if len(prompt_form) < 4:
                continue
            if prompt_form.startswith(trigger_form):
                return True
            if trigger_form.startswith(prompt_form):
                return True
            shorter, longer = (
                (trigger_form, prompt_form)
                if len(trigger_form) <= len(prompt_form)
                else (prompt_form, trigger_form)
            )
            if len(shorter) >= 5 and longer.startswith(shorter):
                return True

    return False


def _is_story_trigger_match(trigger: str, prompt_tokens: list[str]) -> bool:
    trigger_candidates = _split_story_world_trigger_candidates(trigger)
    if len(trigger_candidates) > 1:
        return any(_is_story_trigger_match(candidate, prompt_tokens) for candidate in trigger_candidates)

    trigger_tokens = [token for token in _normalize_story_match_tokens(trigger) if len(token) >= 2]
    if not trigger_tokens:
        return False

    if len(trigger_tokens) == 1:
        trigger_token = trigger_tokens[0]
        return any(_is_story_token_match(trigger_token, token) for token in prompt_tokens)

    for trigger_token in trigger_tokens:
        is_token_matched = any(_is_story_token_match(trigger_token, token) for token in prompt_tokens)
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
                        "character_id": None,
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
                        "character_id": None,
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
                    "character_id": None,
                    "memory_turns": memory_turns,
                    "is_locked": bool(card.is_locked),
                    "source": _normalize_story_world_card_source(card.source),
                },
            )
        )

    ranked_cards.sort(key=lambda item: item[0])
    return [payload for _, payload in ranked_cards[:STORY_WORLD_CARD_PROMPT_MAX_CARDS]]


def _select_story_world_cards_triggered_by_text(
    text_value: str,
    world_cards: list[StoryWorldCard],
) -> list[dict[str, Any]]:
    prompt_tokens = _normalize_story_match_tokens(text_value)
    if not prompt_tokens:
        return []

    ranked_cards: list[tuple[tuple[int, int], dict[str, Any]]] = []
    kind_rank = {
        STORY_WORLD_CARD_KIND_MAIN_HERO: 0,
        STORY_WORLD_CARD_KIND_NPC: 1,
        STORY_WORLD_CARD_KIND_WORLD: 2,
    }

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

        if not any(_is_story_trigger_match(trigger, prompt_tokens) for trigger in triggers):
            continue

        memory_turns = _serialize_story_world_card_memory_turns(card.memory_turns, kind=card_kind)
        ranked_cards.append(
            (
                (kind_rank.get(card_kind, 3), card.id),
                {
                    "id": card.id,
                    "title": title,
                    "content": content,
                    "triggers": triggers,
                    "kind": card_kind,
                    "avatar_url": _normalize_avatar_value(card.avatar_url),
                    "avatar_scale": _normalize_story_avatar_scale(card.avatar_scale),
                    "character_id": None,
                    "memory_turns": memory_turns,
                    "is_locked": bool(card.is_locked),
                    "source": _normalize_story_world_card_source(card.source),
                },
            )
        )

    ranked_cards.sort(key=lambda item: item[0])
    return [payload for _, payload in ranked_cards]


def _build_story_text_character_card_locks(world_cards: list[dict[str, Any]]) -> list[str]:
    character_card_locks: list[str] = []
    seen_keys: set[str] = set()
    for card in world_cards:
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        if card_kind not in STORY_TEXT_CHARACTER_CARD_LOCK_SCOPE:
            continue

        title = " ".join(str(card.get("title", "")).replace("\r\n", " ").split()).strip()
        raw_content = str(card.get("content", "")).replace("\r\n", "\n").strip()
        if not title or not raw_content:
            continue

        role_label = "main_hero" if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO else "npc"
        dedupe_key = f"{role_label}:{title.casefold()}"
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        plain_content = _normalize_story_markup_to_plain_text(raw_content).replace("\r\n", "\n").strip()
        if not plain_content:
            plain_content = raw_content
        if not plain_content:
            continue

        appearance_lock = _extract_story_turn_image_appearance_lock_from_card({"content": plain_content})
        lock_lines = [f"CHARACTER_CARD_LOCK_BEGIN: {role_label} | {title}"]
        if appearance_lock:
            lock_lines.append(f"APPEARANCE_LOCK: {appearance_lock}")
        lock_lines.append(plain_content)
        lock_lines.append("CHARACTER_CARD_LOCK_END")
        character_card_locks.append("\n".join(lock_lines))

    return character_card_locks


def _build_story_system_prompt(
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    model_name: str | None = None,
    response_max_tokens: int | None = None,
) -> str:
    compact_mode = _is_story_paid_model(model_name)
    instruction_cards_for_prompt = (
        instruction_cards[:STORY_PROMPT_COMPACT_MAX_INSTRUCTION_CARDS]
        if compact_mode
        else instruction_cards
    )
    plot_cards_for_prompt = (
        plot_cards[:STORY_PROMPT_COMPACT_MAX_PLOT_CARDS]
        if compact_mode
        else plot_cards
    )
    world_cards_for_prompt = (
        world_cards[:STORY_PROMPT_COMPACT_MAX_WORLD_CARDS]
        if compact_mode
        else world_cards
    )
    lines = [STORY_SYSTEM_PROMPT]
    character_card_locks = _build_story_text_character_card_locks(world_cards)

    if character_card_locks:
        lines.extend(
            [
                "",
                "CHARACTER_CARD_LOCKS (ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ):",
                "\n\n".join(character_card_locks),
                "Правила CHARACTER_CARD_LOCK:",
                "1) Все факты внешности из CHARACTER_CARD_LOCK обязательны и неизменны между ходами, если в сцене не было явного события, которое их меняет.",
                "2) Нельзя подменять или обобщать признаки внешности: цвет глаз, цвет волос, длину волос, прическу, черты лица, телосложение.",
                "3) Если в карточке сказано \"зеленые глаза\" или \"каштановые волосы\", используй именно эти признаки без замены на другие.",
                "4) При конфликте источников приоритет такой: CHARACTER_CARD_LOCK > активные карточки мира > текст сцены.",
                "5) Если признак внешности не указан в карточке, не утверждай его как новый факт без явного основания в сцене.",
            ]
        )

    if instruction_cards_for_prompt:
        lines.extend(["", "Карточки инструкций игрока:"])
        for index, card in enumerate(instruction_cards_for_prompt, start=1):
            raw_title = str(card.get("title", "")).replace("\r\n", " ").strip()
            raw_content = str(card.get("content", "")).replace("\r\n", "\n").strip()
            if compact_mode:
                title = _normalize_story_prompt_text(raw_title, max_chars=STORY_PROMPT_COMPACT_TITLE_MAX_CHARS)
                content = _normalize_story_prompt_text(
                    raw_content,
                    max_chars=STORY_PROMPT_COMPACT_INSTRUCTION_MAX_CHARS,
                )
            else:
                title = " ".join(raw_title.split()).strip()
                content = raw_content
            if not title or not content:
                continue
            lines.append(f"{index}. {title}: {content}")

    if plot_cards_for_prompt:
        lines.extend(["", "Карточки памяти сюжета:"])
        for index, card in enumerate(plot_cards_for_prompt, start=1):
            raw_title = str(card.get("title", "")).replace("\r\n", " ").strip()
            raw_content = str(card.get("content", "")).replace("\r\n", "\n").strip()
            if compact_mode:
                title = _normalize_story_prompt_text(raw_title, max_chars=STORY_PROMPT_COMPACT_TITLE_MAX_CHARS)
                content = _normalize_story_prompt_text(
                    raw_content,
                    max_chars=STORY_PROMPT_COMPACT_PLOT_MAX_CHARS,
                )
            else:
                title = " ".join(raw_title.split()).strip()
                content = raw_content
            if not title or not content:
                continue
            lines.append(f"{index}. {title}: {content}")

    if world_cards_for_prompt:
        lines.extend(["", "Активные карточки мира в этом ходе:"])
        for index, card in enumerate(world_cards_for_prompt, start=1):
            raw_title = str(card.get("title", "")).replace("\r\n", " ").strip()
            raw_content = str(card.get("content", "")).replace("\r\n", "\n").strip()
            card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
            if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO:
                kind_label = "главный_герой"
            elif card_kind == STORY_WORLD_CARD_KIND_NPC:
                kind_label = "npc"
            else:
                kind_label = "мир"
            if compact_mode:
                title = _normalize_story_prompt_text(raw_title, max_chars=STORY_PROMPT_COMPACT_TITLE_MAX_CHARS)
                content = _normalize_story_prompt_text(
                    raw_content,
                    max_chars=STORY_PROMPT_COMPACT_WORLD_MAX_CHARS,
                )
            else:
                title = " ".join(raw_title.split()).strip()
                content = raw_content
            if not title or not content:
                continue
            raw_triggers = card.get("triggers")
            trigger_values = raw_triggers if isinstance(raw_triggers, list) else []
            if compact_mode:
                trigger_line = _normalize_story_prompt_list(
                    trigger_values,
                    max_items=STORY_PROMPT_COMPACT_TRIGGER_MAX_ITEMS,
                    max_chars=STORY_PROMPT_COMPACT_TRIGGER_MAX_CHARS,
                )
                lines.append(f"{index}. {title} [{kind_label}] tr: {trigger_line}; {content}")
            else:
                trigger_line = ", ".join(
                    value.strip() for value in trigger_values if isinstance(value, str) and value.strip()
                )
                lines.append(f"{index}. {title}: {content}")
                lines.append(f"Триггеры: {trigger_line or 'нет'}")
                lines.append(f"Тип: {kind_label}")

    lines.extend(["", *STORY_DIALOGUE_FORMAT_RULES])
    if response_max_tokens is not None:
        normalized_limit = _normalize_story_response_max_tokens(response_max_tokens)
        target_tokens = max(
            min(normalized_limit, int(normalized_limit * STORY_RESPONSE_BUDGET_TARGET_FACTOR)),
            STORY_RESPONSE_MIN_TARGET_TOKENS,
        )
        lines.extend(
            [
                "",
                (
                    f"Бюджет ответа: ориентируйся до {target_tokens} токенов "
                    f"(жесткий максимум {normalized_limit}). "
                    "Планируй объем заранее и завершай финальную фразу полностью, без обрыва."
                ),
            ]
        )
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
    normalized_text = _merge_story_orphan_markup_paragraphs(text_value)
    if not normalized_text:
        return True

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return True
    return all(_parse_story_markup_paragraph(paragraph) is not None for paragraph in paragraphs)


def _merge_story_orphan_markup_paragraphs(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    merged_paragraphs: list[str] = []
    pending_marker = ""
    for paragraph in paragraphs:
        lines = [line.strip() for line in paragraph.split("\n") if line.strip()]
        if not lines:
            continue

        first_line = lines[0]
        if pending_marker:
            if STORY_MARKUP_STANDALONE_PATTERN.match(first_line) is not None:
                merged_paragraphs.append(pending_marker)
            else:
                merged_paragraphs.append(f"{pending_marker} {' '.join(lines)}".strip())
                pending_marker = ""
                continue
            pending_marker = ""

        if STORY_MARKUP_STANDALONE_PATTERN.match(first_line) is not None:
            if len(lines) == 1:
                pending_marker = first_line
                continue
            merged_paragraphs.append(f"{first_line} {' '.join(lines[1:])}".strip())
            continue

        merged_paragraphs.append("\n".join(lines))

    if pending_marker:
        merged_paragraphs.append(pending_marker)

    return "\n\n".join(paragraph for paragraph in merged_paragraphs if paragraph.strip())


def _prefix_story_narrator_markup(text_value: str) -> str:
    normalized_text = _merge_story_orphan_markup_paragraphs(text_value)
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
    normalized_text = _merge_story_orphan_markup_paragraphs(text_value)
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


def _normalize_story_markup_to_plain_text(text_value: str) -> str:
    normalized_text = _strip_story_markup_for_memory_text(text_value).replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    legacy_tag_pattern = re.compile(
        r"<\s*([a-z_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)</\s*([a-z_ -]+)\s*>",
        re.IGNORECASE,
    )

    normalized_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue

        tag_match = legacy_tag_pattern.fullmatch(paragraph_value)
        if tag_match is None:
            normalized_paragraphs.append(paragraph_value)
            continue

        opening_key = _normalize_story_markup_key(tag_match.group(1))
        closing_key = _normalize_story_markup_key(tag_match.group(4))
        if opening_key != closing_key:
            normalized_paragraphs.append(paragraph_value)
            continue

        compact_key = opening_key.replace("_", "")
        text_body = tag_match.group(3).strip()
        if not text_body:
            continue
        raw_speaker = " ".join(str(tag_match.group(2) or "").split()).strip(" .,:;!?-\"'()[]")

        if compact_key in {"narrator", "narration", "narrative"}:
            normalized_paragraphs.append(text_body)
            continue
        if compact_key in {"npcthought", "npcthink", "ggthought", "ggthink"} and raw_speaker:
            normalized_paragraphs.append(f"{raw_speaker} (в голове): {text_body}")
            continue
        if compact_key in {
            "npc",
            "npcreplick",
            "npcreplica",
            "npcspeech",
            "npcdialogue",
            "gg",
            "ggreplick",
            "ggreplica",
            "ggspeech",
            "ggdialogue",
        } and raw_speaker:
            normalized_paragraphs.append(f"{raw_speaker}: {text_body}")
            continue

        normalized_paragraphs.append(paragraph_value)

    return "\n\n".join(normalized_paragraphs)


def _extract_story_explicit_person_names_from_text(text_value: str) -> list[str]:
    plain_text = _normalize_story_markup_to_plain_text(text_value)
    if not plain_text:
        return []

    names: list[str] = []
    seen_keys: set[str] = set()
    for match in STORY_EXPLICIT_PERSON_NAME_PATTERN.finditer(plain_text):
        candidate_name = _cleanup_story_npc_candidate_name(match.group(1))
        if not candidate_name:
            continue
        candidate_key = candidate_name.casefold()
        if candidate_key in seen_keys:
            continue
        if candidate_key in STORY_NPC_NAME_EXCLUDED_TOKENS:
            continue
        if _is_story_generic_npc_name(candidate_name):
            continue
        seen_keys.add(candidate_key)
        names.append(candidate_name)
        if len(names) >= 20:
            break
    return names


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
    scene_names = _extract_story_explicit_person_names_from_text(text_value)
    scene_names_preview = ", ".join(scene_names[:20]) if scene_names else "нет"
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
                f"Имена, явно встречающиеся в текущем тексте: {scene_names_preview}\n\n"
                f"Текст для нормализации:\n{text_value}\n\n"
                "Прямая речь -> [[NPC:...]] или [[GG:...]]. "
                "Мысли персонажа -> [[NPC_THOUGHT:...]] или [[GG_THOUGHT:...]]. "
                "Если говорящий неочевиден, используй роль из контекста сцены. "
                "Не заменяй новое имя персонажа на другое известное имя. "
                "Если в тексте явно указано имя (например, 'Мия сказала'), используй именно это имя."
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


def _trim_story_trailing_incomplete_fragment(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").rstrip()
    if not normalized_text:
        return ""

    if normalized_text[-1] in STORY_OUTPUT_TERMINAL_CHARS:
        return normalized_text

    # Drop obviously broken tails like unfinished marker fragments.
    dangling_markup_match = re.search(r"(?:\[\[[^\]]*|<[^>]*?)$", normalized_text)
    if dangling_markup_match is not None:
        candidate = normalized_text[:dangling_markup_match.start()].rstrip(" ,;:-")
        if candidate:
            normalized_text = candidate
            if normalized_text[-1] in STORY_OUTPUT_TERMINAL_CHARS:
                return normalized_text

    if "\ufffd" in normalized_text:
        replacement_index = normalized_text.rfind("\ufffd")
        candidate = normalized_text[:replacement_index].rstrip(" ,;:-")
        if candidate:
            normalized_text = candidate
            if normalized_text[-1] in STORY_OUTPUT_TERMINAL_CHARS:
                return normalized_text

    # If there is no sentence ending and text ends with a word-like token,
    # cut the last token to avoid half-word endings.
    tail_token_match = re.search(r"[^\s]+$", normalized_text)
    if tail_token_match is None:
        return normalized_text

    tail_token = tail_token_match.group(0)
    if re.search(r"[A-Za-zА-Яа-яЁё]", tail_token) is None:
        return normalized_text

    word_count = len(normalized_text.split())
    if word_count < 2:
        return normalized_text

    candidate = normalized_text[:tail_token_match.start()].rstrip(" ,;:-")
    if candidate:
        return candidate
    return normalized_text


def _normalize_generated_story_output(
    *,
    text_value: str,
    world_cards: list[dict[str, Any]],
) -> str:
    normalized_text = _merge_story_orphan_markup_paragraphs(text_value)
    if normalized_text and normalized_text[-1] not in STORY_OUTPUT_TERMINAL_CHARS:
        sentence_end_index = -1
        for char in STORY_OUTPUT_SENTENCE_END_CHARS:
            sentence_end_index = max(sentence_end_index, normalized_text.rfind(char))
        if sentence_end_index >= 0:
            tail_index = sentence_end_index + 1
            while tail_index < len(normalized_text) and normalized_text[tail_index] in STORY_OUTPUT_CLOSING_CHARS:
                tail_index += 1
            normalized_text = normalized_text[:tail_index].rstrip()
        else:
            line_break_index = normalized_text.rfind("\n")
            if line_break_index > 0:
                normalized_text = normalized_text[:line_break_index].rstrip()
    normalized_text = _trim_story_trailing_incomplete_fragment(normalized_text)

    if not normalized_text:
        return normalized_text
    if _is_story_strict_markup_output(normalized_text):
        return _enforce_story_output_language(normalized_text)

    repaired_text = ""
    if settings.openrouter_api_key:
        try:
            repaired_text = _repair_story_markup_with_openrouter(normalized_text, world_cards)
        except Exception as exc:
            logger.warning("Story markup normalization failed: %s", exc)

    repaired_normalized = repaired_text.replace("\r\n", "\n").strip()
    if repaired_normalized and repaired_normalized[-1] not in STORY_OUTPUT_TERMINAL_CHARS:
        sentence_end_index = -1
        for char in STORY_OUTPUT_SENTENCE_END_CHARS:
            sentence_end_index = max(sentence_end_index, repaired_normalized.rfind(char))
        if sentence_end_index >= 0:
            tail_index = sentence_end_index + 1
            while tail_index < len(repaired_normalized) and repaired_normalized[tail_index] in STORY_OUTPUT_CLOSING_CHARS:
                tail_index += 1
            repaired_normalized = repaired_normalized[:tail_index].rstrip()
        else:
            line_break_index = repaired_normalized.rfind("\n")
            if line_break_index > 0:
                repaired_normalized = repaired_normalized[:line_break_index].rstrip()
    repaired_normalized = _trim_story_trailing_incomplete_fragment(repaired_normalized)

    if repaired_normalized and _is_story_strict_markup_output(repaired_normalized):
        return _enforce_story_output_language(repaired_normalized)

    return _enforce_story_output_language(_prefix_story_narrator_markup(normalized_text))


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
        f"Вы делаете шаг: {prompt_reference}. Мир откликается сразу, будто давно ждал именно этого решения.",
        f"Ваше действие звучит уверенно: {prompt_reference}. Несколько фигур в тени одновременно поворачиваются к вам.",
        f"После ваших слов ({prompt_reference}) в зале на миг становится тише, и даже огонь в лампах будто тускнеет.",
    )
    complications = (
        "Слева слышится короткий металлический звон, а впереди кто-то закрывает путь, прищурившись и ожидая вашего следующего шага.",
        "Старый трактирщик быстро уводит взгляд, но едва заметно показывает на узкий проход за стойкой, где обычно никого не бывает.",
        "Из дальнего угла доносится шепот о цене вашей смелости, и становится ясно: назад дорога будет уже не такой простой.",
    )
    outcomes = (
        "У вас появляется шанс выиграть время и подготовить почву для более рискованного хода.",
        "Обстановка сгущается, но инициатива все еще у вас, если действовать точно и без паузы.",
        "Ситуация накаляется, однако именно это может дать вам редкую возможность перехватить контроль.",
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
    # Emergency safeguard: forced post-translation makes generation fully non-streaming
    # for some models and may trigger upstream/proxy chunk interruptions.
    # Keep direct model output streaming until provider-side stability is confirmed.
    return False


def _can_apply_story_sampling_to_model(model_name: str | None) -> bool:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return False
    return all(model_hint not in normalized_model for model_hint in STORY_NON_SAMPLING_MODEL_HINTS)


def _is_story_paid_model(model_name: str | None) -> bool:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return False
    return any(model_hint in normalized_model for model_hint in STORY_PAID_MODEL_HINTS)


def _normalize_story_prompt_text(value: str, *, max_chars: int) -> str:
    normalized = re.sub(r"\s+", " ", value.replace("\r\n", "\n")).strip()
    if not normalized:
        return ""
    if len(normalized) <= max_chars:
        return normalized
    if max_chars <= 3:
        return normalized[:max_chars]
    return f"{normalized[:max_chars - 3].rstrip(' ,;:-')}..."


def _normalize_story_prompt_list(values: list[Any], *, max_items: int, max_chars: int) -> str:
    normalized_values = [
        _normalize_story_prompt_text(value, max_chars=max_chars)
        for value in values
        if isinstance(value, str) and value.strip()
    ]
    normalized_values = [value for value in normalized_values if value]
    if not normalized_values:
        return "нет"
    return ", ".join(normalized_values[:max_items])


def _effective_story_context_limit_tokens(context_limit_tokens: int, *, model_name: str | None) -> int:
    normalized_limit = _normalize_story_context_limit_chars(context_limit_tokens)
    if not _is_story_paid_model(model_name):
        return normalized_limit
    if normalized_limit <= STORY_PAID_MODEL_CONTEXT_LIMIT_MIN:
        return normalized_limit
    optimized_limit = int(normalized_limit * STORY_PAID_MODEL_CONTEXT_LIMIT_FACTOR)
    return max(min(normalized_limit, optimized_limit), STORY_PAID_MODEL_CONTEXT_LIMIT_MIN)


def _effective_story_response_max_tokens(response_max_tokens: int | None, *, model_name: str | None) -> int | None:
    if response_max_tokens is None:
        return None
    normalized_limit = _normalize_story_response_max_tokens(response_max_tokens)
    return normalized_limit


def _select_story_sampling_values(
    *,
    model_name: str | None,
    story_top_k: int,
    story_top_r: float,
) -> tuple[int | None, float | None]:
    if not _can_apply_story_sampling_to_model(model_name):
        return (None, None)
    top_k_value = story_top_k if story_top_k > 0 else None
    top_p_value = story_top_r if story_top_r < 0.999 else None
    return (top_k_value, top_p_value)


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


def _strip_story_markup_for_language_detection(text_value: str) -> str:
    normalized = text_value.replace("\r\n", "\n")
    return STORY_MARKUP_MARKER_PATTERN.sub(" ", normalized)


def _should_force_story_output_to_russian(text_value: str) -> bool:
    if settings.story_user_language != "ru":
        return False
    if not _can_force_story_output_translation():
        return False

    stripped = _strip_story_markup_for_language_detection(text_value).strip()
    if not stripped:
        return False
    if STORY_CJK_CHARACTER_PATTERN.search(stripped):
        return True

    cyrillic_letters = len(STORY_CYRILLIC_LETTER_PATTERN.findall(stripped))
    latin_letters = len(STORY_LATIN_LETTER_PATTERN.findall(stripped))
    latin_words = len(STORY_LATIN_WORD_PATTERN.findall(stripped))
    cyrillic_words = len(STORY_CYRILLIC_WORD_PATTERN.findall(stripped))

    if cyrillic_letters == 0 and latin_letters >= 6:
        return True
    if latin_letters >= 12 and latin_letters > cyrillic_letters * 0.35:
        return True
    if latin_words >= 4 and latin_words > max(cyrillic_words, 1):
        return True
    return False


def _enforce_story_output_language(text_value: str) -> str:
    normalized = text_value.replace("\r\n", "\n").strip()
    if not normalized:
        return normalized
    if not _should_force_story_output_to_russian(normalized):
        return normalized

    try:
        translated = _force_translate_story_model_output_to_user(normalized)
    except Exception as exc:
        logger.warning("Forced story output translation failed: %s", exc)
        return normalized

    translated_normalized = translated.replace("\r\n", "\n").strip()
    if not translated_normalized:
        return normalized
    return translated_normalized


def _trim_story_history_to_context_limit(
    history: list[dict[str, str]],
    context_limit_tokens: int,
) -> list[dict[str, str]]:
    if not history:
        return []

    limit = max(int(context_limit_tokens), 0)
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


def _estimate_story_history_tokens(history: list[dict[str, str]]) -> int:
    total = 0
    for item in history:
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        total += _estimate_story_tokens(content) + 4
    return total


def _select_story_history_source(
    history: list[dict[str, str]],
    *,
    use_plot_memory: bool,
) -> list[dict[str, str]]:
    if not use_plot_memory:
        return history

    # Plot memory replaces long chat history, but we keep a short recent tail
    # so the model preserves immediate scene coherence.
    selected_reversed: list[dict[str, str]] = []
    consumed_tokens = 0

    for item in reversed(history):
        role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
        content = str(item.get("content", "")).strip()
        if role not in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE} or not content:
            continue
        entry_cost = _estimate_story_tokens(content) + 4
        if (
            selected_reversed
            and consumed_tokens + entry_cost > STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_TOKENS
        ):
            break
        selected_reversed.append({"role": role, "content": content})
        consumed_tokens += entry_cost
        if len(selected_reversed) >= STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES:
            break

    if not selected_reversed:
        return []

    selected = list(reversed(selected_reversed))
    if selected[-1].get("role") != STORY_USER_ROLE:
        for item in reversed(history):
            content = str(item.get("content", "")).strip()
            if str(item.get("role", "")).strip() == STORY_USER_ROLE and content:
                selected.append({"role": STORY_USER_ROLE, "content": content})
                break
    return selected


def _build_story_provider_messages(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    context_limit_tokens: int,
    response_max_tokens: int | None = None,
    translate_for_model: bool = False,
    model_name: str | None = None,
) -> list[dict[str, str]]:
    full_history = [
        {"role": message.role, "content": message.content.strip()}
        for message in context_messages
        if message.role in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE} and message.content.strip()
    ]
    effective_context_limit_tokens = _effective_story_context_limit_tokens(
        context_limit_tokens,
        model_name=model_name,
    )
    recent_history_for_plot_memory = _select_story_history_source(
        full_history,
        use_plot_memory=True,
    )
    reserved_history_tokens = _estimate_story_history_tokens(recent_history_for_plot_memory)
    plot_cards_for_prompt = _fit_story_plot_cards_to_context_limit(
        instruction_cards=instruction_cards,
        plot_cards=plot_cards,
        world_cards=world_cards,
        context_limit_tokens=effective_context_limit_tokens,
        reserved_history_tokens=reserved_history_tokens,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    history = recent_history_for_plot_memory if plot_cards_for_prompt else full_history

    system_prompt = _build_story_system_prompt(
        instruction_cards,
        plot_cards_for_prompt,
        world_cards,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    system_prompt_tokens = _estimate_story_tokens(system_prompt)
    history_budget_tokens = max(effective_context_limit_tokens - system_prompt_tokens, 0)
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
    model_name = (settings.openrouter_world_card_model or settings.openrouter_model).strip()
    compact_mode = _is_story_paid_model(model_name)
    existing_titles = [card.title.strip() for card in existing_cards if card.title.strip()]
    existing_title_items = [
        _normalize_story_prompt_text(title, max_chars=48 if compact_mode else 90)
        for title in existing_titles[: (24 if compact_mode else 40)]
    ]
    existing_title_items = [title for title in existing_title_items if title]
    existing_titles_preview = ", ".join(existing_title_items) if existing_title_items else "нет"
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    prompt_preview = _normalize_story_prompt_text(
        prompt_preview,
        max_chars=700 if compact_mode else 1_200,
    )
    assistant_preview = _normalize_story_prompt_text(
        assistant_preview,
        max_chars=2_600 if compact_mode else 5_000,
    )

    return [
        {
            "role": "system",
            "content": (
                "Выдели долгосрочные сущности мира из фрагмента RPG. "
                "Верни строго JSON-массив без markdown: "
                "[{\"title\": string, \"content\": string, \"triggers\": string[]}]. "
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
    model_name = (settings.openrouter_world_card_model or settings.openrouter_model).strip()
    compact_mode = _is_story_paid_model(model_name)
    prompt_preview = prompt.strip()
    assistant_preview = assistant_text.strip()
    prompt_preview = _normalize_story_prompt_text(
        prompt_preview,
        max_chars=700 if compact_mode else 1_200,
    )
    assistant_preview = _normalize_story_prompt_text(
        assistant_preview,
        max_chars=2_800 if compact_mode else 5_200,
    )

    existing_cards_preview: list[dict[str, Any]] = []
    for card in existing_cards[: (70 if compact_mode else 120)]:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        content = _normalize_story_prompt_text(
            content,
            max_chars=220 if compact_mode else 320,
        )
        if not content:
            continue
        trigger_limit = 5 if compact_mode else 10
        trigger_text_limit = 36 if compact_mode else 70
        triggers_preview = [
            _normalize_story_prompt_text(trigger, max_chars=trigger_text_limit)
            for trigger in _deserialize_story_world_card_triggers(card.triggers)[:trigger_limit]
            if isinstance(trigger, str) and trigger.strip()
        ]
        triggers_preview = [trigger for trigger in triggers_preview if trigger]
        existing_cards_preview.append(
            {
                "id": card.id,
                "title": title,
                "content": content,
                "triggers": triggers_preview,
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
                "Обнови долгосрочные карточки мира RPG. "
                "Верни строго JSON-массив без markdown. "
                "Формат элемента: "
                "{\"action\":\"add|update|delete\",\"card_id\":number?,\"title\":string?,\"content\":string?,"
                "\"triggers\":string[]?,\"changed_text\":string?,\"importance\":\"critical|high|medium|low\","
                "\"kind\":\"character|npc|item|artifact|action|event|place|location|faction|organization|quest\"}. "
                "Правила: "
                "1) Только важные долгосрочные факты; бытовые и одноразовые детали игнорируй. "
                "2) Одноразовые события держи в plot memory, а не в world cards. "
                "3) Предпочитай update существующей карточки вместо add дубля. "
                "4) Не update/delete карточки с is_locked=true или ai_edit_enabled=false. "
                "5) Для add/update давай полный актуальный content и полезные triggers. "
                "6) NPC должен быть конкретным именованным персонажем, без generic названий. "
                f"7) Максимум {STORY_WORLD_CARD_MAX_AI_CHANGES} операций; если изменений нет, верни []."
            ) if compact_mode else (
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
                f"Ход игрока:\n{prompt_preview}\n\n"
                f"Ответ мастера:\n{assistant_preview}\n\n"
                f"Текущие world cards JSON:\n{existing_cards_json}\n\n"
                "Верни только JSON-массив."
            ) if compact_mode else (
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
            if ai_card_kind == STORY_WORLD_CARD_KIND_NPC:
                cleaned_npc_title = _cleanup_story_npc_candidate_name(title)
                if cleaned_npc_title:
                    title = cleaned_npc_title
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
    *,
    enable_secondary_npc_profile_generation: bool = True,
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
    if not enable_secondary_npc_profile_generation:
        return normalized_operations
    return _append_missing_story_npc_card_operations(
        operations=normalized_operations,
        prompt=prompt,
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
            if card_kind == STORY_WORLD_CARD_KIND_NPC:
                cleaned_npc_title = _cleanup_story_npc_candidate_name(title_value)
                if cleaned_npc_title:
                    title_value = cleaned_npc_title
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
                    raw_existing_triggers = _deserialize_story_world_card_triggers(existing_card.triggers)
                    existing_identity_triggers = _filter_story_identity_triggers(existing_card.title, raw_existing_triggers)
                    existing_identity_keys = _build_story_identity_keys(existing_card.title, existing_identity_triggers)
                    candidate_identity_triggers = _filter_story_identity_triggers(candidate_name, normalized_triggers)
                    if not candidate_identity_triggers:
                        candidate_identity_triggers = [candidate_name]
                    if _is_story_npc_identity_duplicate(
                        candidate_name=candidate_name,
                        candidate_triggers=candidate_identity_triggers,
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
            try:
                db.refresh(card)
            except Exception:
                continue
            if bool(card.is_locked) or not bool(card.ai_edit_enabled):
                continue
            before_snapshot = _story_world_card_snapshot_from_card(card)
            previous_title_key = card.title.casefold()
            title_value = str(operation.get("title", "")).strip()
            content_value = str(operation.get("content", "")).strip()
            triggers_value = operation.get("triggers")
            if not title_value or not content_value or not isinstance(triggers_value, list):
                continue

            next_kind = _normalize_story_world_card_kind(str(operation.get("kind", card.kind)))
            if next_kind == STORY_WORLD_CARD_KIND_NPC:
                cleaned_npc_title = _cleanup_story_npc_candidate_name(title_value)
                if cleaned_npc_title:
                    title_value = cleaned_npc_title
            next_title = _normalize_story_world_card_title(title_value)
            next_content = _normalize_story_world_card_content(content_value)
            next_triggers = _normalize_story_world_card_triggers(
                [item for item in triggers_value if isinstance(item, str)],
                fallback_title=title_value,
            )
            previous_kind = _normalize_story_world_card_kind(card.kind)
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
            try:
                db.refresh(card)
            except Exception:
                continue
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
    *,
    memory_optimization_enabled: bool = True,
) -> list[StoryWorldCardChangeEvent]:
    existing_cards = _list_story_world_cards(db, game.id)
    assistant_text_for_memory = _strip_story_markup_for_memory_text(assistant_text)
    try:
        operations = _generate_story_world_card_change_operations(
            prompt=prompt,
            assistant_text=assistant_text_for_memory,
            existing_cards=existing_cards,
            enable_secondary_npc_profile_generation=memory_optimization_enabled,
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

    if memory_optimization_enabled:
        try:
            persisted_events.extend(
                _ensure_story_npc_cards_from_dialogue(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    prompt=prompt,
                    assistant_text=assistant_text,
                )
            )
        except Exception as exc:
            logger.warning("NPC dialogue world card fallback failed: %s", exc)

    return persisted_events


def _build_story_plot_card_memory_messages(
    *,
    existing_card: StoryPlotCard | None,
    latest_assistant_text: str,
    latest_user_prompt: str,
    latest_turn_memory_delta: str,
    model_name: str | None = None,
) -> list[dict[str, str]]:
    compact_mode = _is_story_paid_model(model_name)
    should_generate_title = existing_card is None
    current_prompt = latest_user_prompt.replace("\r\n", "\n").strip()
    current_assistant_text = latest_assistant_text.replace("\r\n", "\n").strip()
    prompt_max_chars = 700 if compact_mode else 1_500
    assistant_max_chars = 2_000 if compact_mode else 4_500
    current_prompt = _normalize_story_prompt_text(current_prompt, max_chars=prompt_max_chars)
    current_assistant_text = _normalize_story_prompt_text(current_assistant_text, max_chars=assistant_max_chars)
    _ = latest_turn_memory_delta

    return [
        {
            "role": "system",
            "content": (
                "Ты редактор памяти RPG. "
                "Сожми текущий ход (действие игрока + ответ мастера) без потери смысла и важных деталей. "
                "Не выдумывай факты и не теряй важные детали."
            ),
        },
        {
            "role": "user",
            "content": (
                (
                    (
                        "Верни строго JSON без markdown: {\"title\": string, \"content\": string}. "
                        "title обязателен (3-7 слов, без шаблонов). content обязателен.\n\n"
                    )
                    if should_generate_title
                    else "Верни только сжатый текст (без JSON, без markdown, без заголовка).\n\n"
                )
                + f"Ход игрока:\n{current_prompt or 'нет'}\n\n"
                + f"Ответ мастера:\n{current_assistant_text or 'нет'}\n\n"
                + "Сожми этот ход без потери смысла и важных деталей."
            ),
        },
    ]


def _resolve_story_plot_memory_model_name() -> str:
    configured_model = str(settings.openrouter_plot_card_model or "").strip()
    if configured_model == OPENROUTER_GLM_AIR_FREE_MODEL:
        return configured_model
    return STORY_PLOT_CARD_MEMORY_FREE_MODEL


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
    allow_title_from_content: bool = True,
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
            return _normalize_story_plot_card_ai_payload(
                nested_card,
                fallback_title=fallback_title,
                allow_title_from_content=allow_title_from_content,
            )
        if not isinstance(raw_content, str):
            return None

    title = " ".join(raw_title.split()).strip() if isinstance(raw_title, str) else ""
    content = raw_content.replace("\r\n", "\n").strip()
    if not content and raw_points:
        content = "\n".join(point for point in raw_points if isinstance(point, str) and point.strip()).strip()

    if len(title) < 3:
        title = ""
    if not title or _is_story_plot_card_default_title(title):
        title = fallback_title.strip()
    if (not title or _is_story_plot_card_default_title(title)) and allow_title_from_content:
        title = _derive_story_plot_card_title_from_content(content, preferred_lines=raw_points)
    if _is_story_plot_card_default_title(title):
        title = ""
    if not content:
        return None

    if title and len(title) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
        title = title[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
    if len(content) > STORY_PLOT_CARD_MAX_CONTENT_LENGTH:
        content = content[:STORY_PLOT_CARD_MAX_CONTENT_LENGTH].rstrip()
    if not content:
        return None

    return (title, content)


def _normalize_story_plot_card_ai_response(
    *,
    raw_response: str,
    existing_card: StoryPlotCard | None,
    should_generate_title: bool,
) -> tuple[str, str] | None:
    fallback_title = existing_card.title.strip() if existing_card is not None else ""
    parsed_payload = _extract_json_object_from_text(raw_response)
    normalized_payload = _normalize_story_plot_card_ai_payload(
        parsed_payload,
        fallback_title=fallback_title,
        allow_title_from_content=should_generate_title,
    )
    if normalized_payload is not None:
        return normalized_payload

    plain_response = str(raw_response or "").replace("\r\n", "\n").strip()
    if not plain_response:
        return None

    title = fallback_title
    content = plain_response
    if should_generate_title:
        title_line_match = re.search(
            r"(?im)^\s*(?:title|заголовок)\s*:\s*(.+?)\s*$",
            plain_response,
        )
        if title_line_match:
            raw_title_line = " ".join(title_line_match.group(1).split()).strip()
            if len(raw_title_line) >= 3:
                title = raw_title_line
            content = re.sub(r"(?im)^\s*(?:title|заголовок)\s*:\s*.+?\s*$", "", content).strip()
            content = re.sub(r"(?im)^\s*```(?:json)?\s*$", "", content).strip()
            content = re.sub(r"(?im)^\s*```\s*$", "", content).strip()
        if not title or _is_story_plot_card_default_title(title):
            title = _derive_story_plot_card_title_from_content(content)

    content = content.strip()
    if not content:
        return None
    return (title, content)


def _resolve_story_plot_card_title_locally(
    *,
    existing_title: str,
    suggested_title: str,
    compressed_content: str,
    latest_user_prompt: str,
) -> str:
    normalized_existing = " ".join(existing_title.split()).strip()
    normalized_suggested = " ".join(suggested_title.split()).strip()
    if normalized_suggested and not _is_story_plot_card_default_title(normalized_suggested):
        return normalized_suggested
    if normalized_existing and not _is_story_plot_card_default_title(normalized_existing):
        return normalized_existing

    derived_from_content = _derive_story_plot_card_title_from_content(compressed_content)
    if derived_from_content and not _is_story_plot_card_default_title(derived_from_content):
        return derived_from_content

    derived_from_prompt = _derive_story_plot_card_title_from_content(latest_user_prompt)
    if derived_from_prompt and not _is_story_plot_card_default_title(derived_from_prompt):
        return derived_from_prompt

    return STORY_PLOT_CARD_DEFAULT_TITLE


def _normalize_story_plot_memory_line(value: str) -> str:
    compact = re.sub(r"\s+", " ", value).strip(" -•\t")
    if not compact:
        return ""
    if len(compact) > STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS:
        compact = f"{compact[:STORY_PLOT_CARD_MEMORY_TARGET_LINE_MAX_CHARS - 3].rstrip(' ,;:-')}..."
    return compact


def _build_story_plot_turn_memory_delta(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> str:
    normalized_prompt = latest_user_prompt.replace("\r\n", "\n").strip()
    normalized_assistant = latest_assistant_text.replace("\r\n", "\n").strip()
    if not normalized_prompt and not normalized_assistant:
        return ""

    delta_parts: list[str] = []
    if normalized_prompt:
        delta_parts.append(
            "Ход игрока:\n"
            + _normalize_story_prompt_text(
                normalized_prompt,
                max_chars=3_000,
            )
        )
    if normalized_assistant:
        delta_parts.append(
            "Ответ мастера:\n"
            + _normalize_story_prompt_text(
                normalized_assistant,
                max_chars=8_000,
            )
        )
    return "\n\n".join(part for part in delta_parts if part.strip()).strip()


def _merge_story_plot_memory_content(existing_content: str, new_content: str) -> str:
    existing_normalized = existing_content.replace("\r\n", "\n").strip()
    new_normalized = new_content.replace("\r\n", "\n").strip()
    if not existing_normalized:
        return new_normalized
    if not new_normalized:
        return existing_normalized
    if existing_normalized.casefold() == new_normalized.casefold():
        return existing_normalized
    return f"{existing_normalized}\n\n{new_normalized}".strip()


def _append_story_plot_memory_content_raw(existing_content: str, new_content: str) -> str:
    existing_normalized = existing_content.replace("\r\n", "\n").strip()
    new_normalized = new_content.replace("\r\n", "\n").strip()
    if not existing_normalized:
        return new_normalized
    if not new_normalized:
        return existing_normalized
    return f"{existing_normalized}\n{new_normalized}"


def _trim_story_plot_card_content_for_context(
    content: str,
    *,
    context_limit_tokens: int,
) -> str:
    normalized = content.replace("\r\n", "\n").strip()
    if not normalized:
        return normalized
    limit = max(int(context_limit_tokens), 1)
    normalized_tokens = _estimate_story_tokens(normalized)
    if normalized_tokens <= limit:
        return normalized
    return _trim_story_text_tail_by_sentence_tokens(normalized, limit)


def _generate_story_plot_card_title_with_openrouter(
    *,
    model_name: str,
    latest_assistant_text: str,
    latest_user_prompt: str,
    latest_turn_memory_delta: str,
    current_title: str,
) -> str:
    compact_mode = _is_story_paid_model(model_name)
    normalized_assistant = latest_assistant_text.replace("\r\n", "\n").strip()
    normalized_prompt = latest_user_prompt.replace("\r\n", "\n").strip()
    summary_basis = latest_turn_memory_delta.replace("\r\n", "\n").strip()
    if not summary_basis:
        summary_basis = "\n\n".join(
            part for part in [
                f"Ход игрока:\n{normalized_prompt}" if normalized_prompt else "",
                f"Ответ мастера:\n{normalized_assistant}" if normalized_assistant else "",
            ] if part.strip()
        ).strip()
    if not summary_basis:
        return ""

    prompt_max_chars = 500 if compact_mode else 1_000
    summary_max_chars = 1_100 if compact_mode else 2_000
    title_max_chars = 90 if compact_mode else 120
    normalized_prompt = _normalize_story_prompt_text(normalized_prompt, max_chars=prompt_max_chars)
    summary_basis = _normalize_story_prompt_text(summary_basis, max_chars=summary_max_chars)
    normalized_title = _normalize_story_prompt_text(current_title, max_chars=title_max_chars)

    messages_payload = [
        {
            "role": "system",
            "content": (
                "Сформируй заголовок карточки памяти RPG. "
                "Верни строго JSON без markdown: {\"title\": string}. "
                "Требования: 3-7 слов, только русский, по сути эпизода, "
                "без шаблонов ('Суть эпизода') и без копирования первой фразы."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Текущий заголовок: {normalized_title or 'нет'}\n\n"
                f"Последний ход игрока:\n{normalized_prompt or 'нет'}\n\n"
                f"Сжатая суть нового хода (игрок + мастер):\n{summary_basis or 'нет'}\n\n"
                "Сформируй один заголовок. Верни только JSON."
            ),
        },
    ]
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
    raw_title: Any = ""
    if isinstance(parsed_payload, dict):
        raw_title = (
            parsed_payload.get("title")
            or parsed_payload.get("name")
            or parsed_payload.get("heading")
            or parsed_payload.get("заголовок")
        )
    if not isinstance(raw_title, str):
        return ""
    title = " ".join(raw_title.split()).strip()
    if len(title) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
        title = title[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
    if len(title) < 3 or _is_story_plot_card_default_title(title):
        return ""
    return title


def _resolve_story_plot_card_title(
    *,
    model_name: str,
    existing_title: str,
    suggested_title: str,
    latest_assistant_text: str,
    latest_user_prompt: str,
    latest_turn_memory_delta: str,
    prefer_fresh_title: bool = False,
) -> str:
    normalized_existing = " ".join(existing_title.split()).strip()
    normalized_suggested = " ".join(suggested_title.split()).strip()
    has_existing_title = bool(normalized_existing and not _is_story_plot_card_default_title(normalized_existing))
    has_suggested_title = bool(normalized_suggested and not _is_story_plot_card_default_title(normalized_suggested))

    if not prefer_fresh_title:
        if has_existing_title:
            return normalized_existing
        if has_suggested_title:
            return normalized_suggested
    elif has_suggested_title and normalized_suggested != normalized_existing:
        return normalized_suggested

    try:
        generated_title = _generate_story_plot_card_title_with_openrouter(
            model_name=model_name,
            latest_assistant_text=latest_assistant_text,
            latest_user_prompt=latest_user_prompt,
            latest_turn_memory_delta=latest_turn_memory_delta,
            current_title=normalized_existing,
        )
    except Exception as exc:
        logger.warning("Plot card title generation via memory model failed; keeping existing/suggested title: %s", exc)
        generated_title = ""
    if generated_title:
        return generated_title
    if has_suggested_title:
        return normalized_suggested
    if has_existing_title:
        return normalized_existing
    return ""


def _upsert_story_plot_memory_card(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt_override: str | None = None,
    latest_assistant_text_override: str | None = None,
) -> tuple[bool, list[StoryPlotCardChangeEvent]]:
    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:
        return (False, [])
    logger.info(
        "Plot memory upsert started: game_id=%s assistant_message_id=%s",
        game.id,
        assistant_message.id,
    )
    assistant_text_source = (
        latest_assistant_text_override
        if isinstance(latest_assistant_text_override, str)
        else assistant_message.content
    )
    latest_assistant_text = _strip_story_markup_for_memory_text(assistant_text_source).replace("\r\n", "\n").strip()
    if not latest_assistant_text:
        latest_assistant_text = _normalize_story_markup_to_plain_text(assistant_text_source).replace("\r\n", "\n").strip()
    if not latest_assistant_text:
        latest_assistant_text = assistant_text_source.replace("\r\n", "\n").strip()
    if not latest_assistant_text:
        raise RuntimeError(
            "Plot memory generation failed: assistant text is empty after normalization"
        )

    if isinstance(latest_user_prompt_override, str):
        latest_user_prompt = latest_user_prompt_override.replace("\r\n", "\n").strip()
    else:
        latest_user_message = db.scalar(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == game.id,
                StoryMessage.role == STORY_USER_ROLE,
                StoryMessage.id < assistant_message.id,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(1)
        )
        latest_user_prompt = (
            latest_user_message.content.replace("\r\n", "\n").strip()
            if isinstance(latest_user_message, StoryMessage)
            else ""
        )
    latest_turn_memory_delta = _build_story_plot_turn_memory_delta(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )

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
    target_is_user_source = (
        target_card is not None
        and _normalize_story_plot_card_source(target_card.source) == STORY_PLOT_CARD_SOURCE_USER
    )

    if not settings.openrouter_api_key:
        raise RuntimeError("Plot memory generation failed: OPENROUTER_API_KEY is missing")

    model_name = _resolve_story_plot_memory_model_name()
    if not model_name:
        raise RuntimeError("Plot memory generation failed: memory model is not configured")

    messages_payload = _build_story_plot_card_memory_messages(
        existing_card=target_card,
        latest_assistant_text=latest_assistant_text,
        latest_user_prompt=latest_user_prompt,
        latest_turn_memory_delta=latest_turn_memory_delta,
        model_name=model_name,
    )

    logger.info(
        "Plot memory input prepared: game_id=%s assistant_message_id=%s user_chars=%s assistant_chars=%s",
        game.id,
        assistant_message.id,
        len(latest_user_prompt),
        len(latest_assistant_text),
    )
    logger.info(
        "Plot memory model request started: game_id=%s assistant_message_id=%s model=%s",
        game.id,
        assistant_message.id,
        model_name,
    )
    raw_response = _request_openrouter_story_text(
        messages_payload,
        model_name=model_name,
        allow_free_fallback=False,
        temperature=0.0,
        max_tokens=STORY_PLOT_CARD_REQUEST_MAX_TOKENS,
        request_timeout=(
            STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
            STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
        ),
    )
    logger.info(
        "Plot memory model response received: game_id=%s assistant_message_id=%s chars=%s",
        game.id,
        assistant_message.id,
        len(raw_response),
    )
    normalized_payload = _normalize_story_plot_card_ai_response(
        raw_response=raw_response,
        existing_card=target_card,
        should_generate_title=target_card is None,
    )
    if normalized_payload is None:
        raise RuntimeError(
            "Plot memory generation failed: memory model returned empty or invalid payload"
        )

    suggested_title, delta_content = normalized_payload
    delta_content = delta_content.replace("\r\n", "\n").strip()
    if not delta_content:
        raise RuntimeError(
            "Plot memory generation failed: memory model returned empty compressed text"
        )

    if target_card is None:
        resolved_title = _resolve_story_plot_card_title_locally(
            existing_title="",
            suggested_title=suggested_title,
            compressed_content=delta_content,
            latest_user_prompt=latest_user_prompt,
        )
        title = _normalize_story_plot_card_title(resolved_title)
        content = _normalize_story_plot_card_content(delta_content, preserve_tail=True)
        trimmed_content = _trim_story_plot_card_content_for_context(
            content,
            context_limit_tokens=game.context_limit_chars,
        )
        if trimmed_content.strip():
            content = _normalize_story_plot_card_content(trimmed_content, preserve_tail=True)
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
            assistant_message_id=assistant_message.id,
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
        logger.info(
            "Plot memory created: game_id=%s assistant_message_id=%s plot_card_id=%s",
            game.id,
            assistant_message.id,
            new_card.id,
        )
        return (True, [event])
    else:
        merged_content_raw = _merge_story_plot_memory_content(target_card.content, delta_content)
        if not merged_content_raw:
            return (False, [])
        content = _normalize_story_plot_card_content(merged_content_raw, preserve_tail=True)
        content = _trim_story_plot_card_content_for_context(
            content,
            context_limit_tokens=game.context_limit_chars,
        )
        content = _normalize_story_plot_card_content(content, preserve_tail=True)
        resolved_title = _resolve_story_plot_card_title_locally(
            existing_title=target_card.title,
            suggested_title=suggested_title,
            compressed_content=delta_content,
            latest_user_prompt=latest_user_prompt,
        )
        title = _normalize_story_plot_card_title(resolved_title)
        if target_card.title == title and target_card.content == content:
            return (False, [])

        before_snapshot = _story_plot_card_snapshot_from_card(target_card)
        target_card.title = title
        target_card.content = content
        target_card.source = STORY_PLOT_CARD_SOURCE_USER if target_is_user_source else STORY_PLOT_CARD_SOURCE_AI
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
            assistant_message_id=assistant_message.id,
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
        logger.info(
            "Plot memory updated: game_id=%s assistant_message_id=%s plot_card_id=%s",
            game.id,
            assistant_message.id,
            target_card.id,
        )
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
    response_max_tokens: int | None = None,
):
    access_token = _get_gigachat_access_token()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=response_max_tokens,
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
    if response_max_tokens is not None:
        payload["max_tokens"] = int(response_max_tokens)

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
    max_tokens: int | None = None,
):
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=max_tokens,
        model_name=model_name,
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
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)

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
                last_keepalive_at = time.monotonic()
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
                        # Keep downstream SSE alive while model emits non-content deltas.
                        if not emitted_delta and time.monotonic() - last_keepalive_at >= 8.0:
                            last_keepalive_at = time.monotonic()
                            yield ""

                    if emitted_delta:
                        continue

                    message_value = choice.get("message")
                    if isinstance(message_value, dict):
                        content_value = _extract_text_from_model_content(message_value.get("content"))
                        if content_value:
                            emitted_delta = True
                            for chunk in _iter_story_stream_chunks(content_value):
                                yield chunk
                            break

                if emitted_delta:
                    return

                # Fallback when stream completed without textual content chunks.
                fallback_text = _request_openrouter_story_text(
                    messages_payload,
                    model_name=model_name,
                    allow_free_fallback=False,
                    top_k=top_k,
                    top_p=top_p,
                    max_tokens=max_tokens,
                )
                if fallback_text:
                    for chunk in _iter_story_stream_chunks(fallback_text):
                        yield chunk
                return
            finally:
                response.close()

        if model_name == candidate_models[-1] and last_error is not None:
            raise last_error

    if last_error is not None:
        raise last_error

    raise RuntimeError("OpenRouter chat request failed")


def _request_gigachat_story_text(
    messages_payload: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
) -> str:
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
    if max_tokens is not None:
        payload["max_tokens"] = int(max_tokens)

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
    fallback_model_names: list[str] | None = None,
    temperature: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
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
    if fallback_model_names:
        for fallback_model in fallback_model_names:
            normalized_fallback_model = str(fallback_model or "").strip()
            if not normalized_fallback_model or normalized_fallback_model in candidate_models:
                continue
            candidate_models.append(normalized_fallback_model)
    if allow_free_fallback and primary_model != "openrouter/free":
        if "openrouter/free" not in candidate_models:
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
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)
        for attempt_index in range(2):
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

                if response.status_code == 429 and attempt_index == 0:
                    logger.warning(
                        "OpenRouter chat rate-limited; retrying once: model=%s status=%s",
                        candidate_model,
                        response.status_code,
                    )
                    time.sleep(1.1)
                    continue

                error_text = f"OpenRouter chat error ({response.status_code})"
                if detail:
                    error_text = f"{error_text}: {detail}"

                if response.status_code in {404, 429, 503} and candidate_model != candidate_models[-1]:
                    logger.warning(
                        "OpenRouter chat failed for model=%s; trying fallback model. status=%s detail=%s",
                        candidate_model,
                        response.status_code,
                        detail or "n/a",
                    )
                    last_error = RuntimeError(error_text)
                    break
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


def _validate_story_turn_image_provider_config() -> None:
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter provider is not configured: set OPENROUTER_API_KEY",
        )
    if not settings.openrouter_chat_url and not settings.openrouter_image_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter image endpoint is not configured: set OPENROUTER_CHAT_URL or OPENROUTER_IMAGE_URL",
        )


def _normalize_story_turn_image_style_prompt(value: str | None) -> str:
    compact_value = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not compact_value:
        return ""
    return compact_value[:STORY_TURN_IMAGE_STYLE_PROMPT_MAX_CHARS].rstrip()


def _get_story_turn_image_cost_tokens(model_name: str | None) -> int:
    normalized_model = str(model_name or "").strip()
    if not normalized_model:
        normalized_model = STORY_TURN_IMAGE_MODEL_FLUX
    return max(int(STORY_TURN_IMAGE_COST_BY_MODEL.get(normalized_model, STORY_TURN_IMAGE_COST_BY_MODEL[STORY_TURN_IMAGE_MODEL_FLUX])), 0)


def _get_story_turn_image_read_timeout_seconds(model_name: str | None) -> int:
    normalized_model = str(model_name or "").strip()
    if not normalized_model:
        return STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT
    return max(
        int(
            STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL.get(
                normalized_model,
                STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT,
            )
        ),
        STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT,
    )


def _get_story_turn_image_request_prompt_max_chars(model_name: str | None) -> int:
    normalized_model = str(model_name or "").strip()
    if normalized_model == STORY_TURN_IMAGE_MODEL_SEEDREAM:
        return STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM
    return STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT


def _limit_story_turn_image_request_prompt(prompt: str, *, model_name: str | None) -> str:
    normalized_prompt = str(prompt or "").replace("\r\n", "\n").strip()
    if not normalized_prompt:
        return ""
    max_chars = max(_get_story_turn_image_request_prompt_max_chars(model_name), 1)
    if len(normalized_prompt) <= max_chars:
        return normalized_prompt
    if "CHARACTER_CARD_LOCK_BEGIN:" in normalized_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Character card locks exceed image prompt limit "
                f"({len(normalized_prompt)} > {max_chars} chars). "
                "Shorten character cards to keep full locks intact."
            ),
        )
    return normalized_prompt[:max_chars].rstrip()


def _join_story_turn_image_prompt_parts(parts: list[str]) -> str:
    return " ".join(
        part.strip()
        for part in parts
        if isinstance(part, str) and part.strip()
    )


def _trim_story_turn_image_prompt_tail_text(value: str, *, max_chars: int) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").replace("\r\n", "\n")).strip()
    if not normalized or max_chars <= 0:
        return ""
    if len(normalized) <= max_chars:
        return normalized
    if max_chars <= 3:
        return normalized[-max_chars:]
    tail = normalized[-(max_chars - 3):].lstrip(" ,;:-")
    if not tail:
        tail = normalized[-(max_chars - 3):]
    return f"...{tail}"


def _append_story_turn_image_optional_context_part(
    prompt_parts: list[str],
    *,
    part_prefix: str,
    part_body: str,
    part_suffix: str,
    prompt_max_chars: int,
    prefer_fresh_tail: bool,
) -> None:
    normalized_body = re.sub(r"\s+", " ", str(part_body or "").replace("\r\n", "\n")).strip()
    if not normalized_body:
        return

    full_part = f"{part_prefix}{normalized_body}{part_suffix}"
    full_candidate = _join_story_turn_image_prompt_parts([*prompt_parts, full_part])
    if len(full_candidate) <= prompt_max_chars:
        prompt_parts.append(full_part)
        return

    current_prompt = _join_story_turn_image_prompt_parts(prompt_parts)
    remaining_chars = prompt_max_chars - len(current_prompt)
    if remaining_chars <= 0:
        return
    join_overhead = 1 if prompt_parts else 0
    body_budget = remaining_chars - join_overhead - len(part_prefix) - len(part_suffix)
    if body_budget < 40:
        return

    if prefer_fresh_tail:
        trimmed_body = _trim_story_turn_image_prompt_tail_text(normalized_body, max_chars=body_budget)
    else:
        trimmed_body = _normalize_story_prompt_text(normalized_body, max_chars=body_budget)
    if not trimmed_body:
        return

    trimmed_part = f"{part_prefix}{trimmed_body}{part_suffix}"
    trimmed_candidate = _join_story_turn_image_prompt_parts([*prompt_parts, trimmed_part])
    if len(trimmed_candidate) <= prompt_max_chars:
        prompt_parts.append(trimmed_part)


def _extract_story_turn_image_gender_hint_from_card(
    *,
    card: dict[str, Any],
    user_prompt: str,
    assistant_text: str,
) -> str:
    raw_title = str(card.get("title", "")).strip()
    plain_content = _normalize_story_markup_to_plain_text(str(card.get("content", ""))).replace("\r\n", "\n").strip()
    lines = [line.strip() for line in plain_content.split("\n") if line.strip()]

    profile_gender = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(lines, ("пол", "gender"))
    )
    profile_gender_hint = _extract_story_turn_image_gender_hint_from_text(profile_gender)
    if profile_gender_hint:
        return profile_gender_hint

    content_gender_hint = _extract_story_turn_image_gender_hint_from_text(plain_content)
    if content_gender_hint:
        return content_gender_hint

    inferred_gender = _infer_story_npc_gender_from_context(raw_title, user_prompt, assistant_text)
    if inferred_gender in {"женский", "мужской"}:
        return inferred_gender
    return ""


def _score_story_turn_image_gender_patterns(
    text: str,
    patterns: tuple[tuple[str, int], ...],
) -> int:
    score = 0
    for pattern, weight in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            score += max(int(weight), 0)
    return score


def _extract_story_turn_image_gender_hint_from_text(text: str) -> str:
    normalized_text = _normalize_story_markup_to_plain_text(str(text or "")).replace("\r\n", "\n").strip()
    if not normalized_text:
        return ""

    female_score = _score_story_turn_image_gender_patterns(
        normalized_text,
        STORY_TURN_IMAGE_GENDER_PATTERNS_FEMALE,
    )
    male_score = _score_story_turn_image_gender_patterns(
        normalized_text,
        STORY_TURN_IMAGE_GENDER_PATTERNS_MALE,
    )
    if female_score <= 0 and male_score <= 0:
        return ""
    if female_score > male_score:
        return "женский"
    if male_score > female_score:
        return "мужской"
    return ""


def _story_turn_image_gender_hint_for_prompt(gender_hint: str) -> str:
    normalized = str(gender_hint or "").strip().casefold()
    if normalized == "мужской":
        return "male (мужской)"
    if normalized == "женский":
        return "female (женский)"
    return ""


def _story_turn_image_gender_lock_for_prompt(gender_hint: str) -> str:
    normalized = str(gender_hint or "").strip().casefold()
    if normalized == "женский":
        return (
            "gender-lock female ONLY: must be clearly depicted as a woman; "
            "forbidden male/man/boy presentation."
        )
    if normalized == "мужской":
        return (
            "gender-lock male ONLY: must be clearly depicted as a man; "
            "forbidden female/woman/girl presentation."
        )
    return ""


def _extract_story_turn_image_visual_sentences(plain_content: str) -> list[str]:
    visual_keywords = (
        "внеш",
        "волос",
        "глаз",
        "одежд",
        "куртк",
        "рубаш",
        "плать",
        "юбк",
        "брюк",
        "футбол",
        "телослож",
        "рост",
        "лиц",
        "шрам",
        "причес",
        "цвет волос",
        "hair",
        "eyes",
        "outfit",
        "clothes",
        "shirt",
        "dress",
        "skirt",
        "jacket",
        "appearance",
    )
    visual_sentences: list[str] = []
    for sentence in _split_story_text_into_sentences(plain_content):
        normalized_sentence = _normalize_story_prompt_text(
            sentence,
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS,
        )
        if not normalized_sentence or _is_story_dialogue_like_fragment(normalized_sentence):
            continue
        lowered_sentence = normalized_sentence.casefold()
        if not any(keyword in lowered_sentence for keyword in visual_keywords):
            continue
        if normalized_sentence not in visual_sentences:
            visual_sentences.append(normalized_sentence)
        if len(visual_sentences) >= 4:
            break
    return visual_sentences


def _extract_story_turn_image_appearance_lock_from_card(card: dict[str, Any]) -> str:
    plain_content = _normalize_story_markup_to_plain_text(str(card.get("content", ""))).replace("\r\n", "\n").strip()
    if not plain_content:
        return ""
    lines = [line.strip() for line in plain_content.split("\n") if line.strip()]

    appearance_fragments: list[str] = []
    seen_fragments: set[str] = set()

    def _append_fragment(raw_value: str, *, max_chars: int = 180) -> None:
        if len(appearance_fragments) >= STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS:
            return
        sanitized_value = _sanitize_story_npc_profile_value(raw_value)
        if not sanitized_value or _is_story_dialogue_like_fragment(sanitized_value):
            return
        normalized_value = _normalize_story_prompt_text(sanitized_value, max_chars=max_chars)
        if not normalized_value:
            return
        dedupe_key = normalized_value.casefold()
        if dedupe_key in seen_fragments:
            return
        seen_fragments.add(dedupe_key)
        appearance_fragments.append(normalized_value)

    profile_field_groups: tuple[tuple[str, ...], ...] = (
        ("внешность", "appearance", "облик"),
        ("лицо", "черты лица", "facial features", "face"),
        ("волосы", "цвет волос", "длина волос", "прическа", "hair", "hair color", "hair length", "hairstyle"),
        ("глаза", "цвет глаз", "eyes", "eye color"),
        ("телосложение", "рост", "build", "body type", "height"),
        ("особые приметы", "приметы", "шрам", "тату", "marks", "scar", "tattoo"),
        ("одежда", "style", "outfit", "clothes"),
    )
    for prefixes in profile_field_groups:
        field_value = _extract_story_npc_profile_field(lines, prefixes)
        _append_fragment(field_value)
        if len(appearance_fragments) >= STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS:
            break

    for sentence in _split_story_text_into_sentences(plain_content):
        if len(appearance_fragments) >= STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS:
            break
        normalized_sentence = _normalize_story_prompt_text(
            sentence,
            max_chars=220,
        )
        if not normalized_sentence or _is_story_dialogue_like_fragment(normalized_sentence):
            continue
        lowered_sentence = normalized_sentence.casefold()
        if not any(keyword in lowered_sentence for keyword in STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS):
            continue
        _append_fragment(normalized_sentence, max_chars=220)

    if not appearance_fragments:
        return ""
    return _normalize_story_prompt_text(
        "; ".join(appearance_fragments),
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_CHARS,
    )


def _extract_story_turn_image_appearance_hint_from_card(card: dict[str, Any]) -> str:
    plain_content = _normalize_story_markup_to_plain_text(str(card.get("content", ""))).replace("\r\n", "\n").strip()
    if not plain_content:
        return ""
    lines = [line.strip() for line in plain_content.split("\n") if line.strip()]
    profile_appearance = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(lines, ("внешность", "appearance", "облик"))
    )
    appearance_fragments: list[str] = []
    if profile_appearance and not _is_story_dialogue_like_fragment(profile_appearance):
        normalized_profile = _normalize_story_prompt_text(
            profile_appearance,
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS,
        )
        if normalized_profile:
            appearance_fragments.append(normalized_profile)

    for visual_sentence in _extract_story_turn_image_visual_sentences(plain_content):
        if visual_sentence not in appearance_fragments:
            appearance_fragments.append(visual_sentence)
        if len(appearance_fragments) >= 4:
            break

    if not appearance_fragments:
        for sentence in _split_story_text_into_sentences(plain_content):
            normalized_sentence = _normalize_story_prompt_text(
                sentence,
                max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS,
            )
            if not normalized_sentence or _is_story_dialogue_like_fragment(normalized_sentence):
                continue
            appearance_fragments.append(normalized_sentence)
            break

    if not appearance_fragments:
        return ""

    merged_appearance = "; ".join(appearance_fragments)
    return _normalize_story_prompt_text(
        merged_appearance,
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS,
    )


def _build_story_turn_image_style_instructions(style_prompt: str) -> str:
    normalized_style = _normalize_story_turn_image_style_prompt(style_prompt)
    if not normalized_style:
        return ""

    normalized_casefold = normalized_style.casefold()
    style_parts = [
        f"STYLE PRIORITY (HIGHEST): {normalized_style}.",
        "The final image must strictly follow this style and must not fall back to default style.",
    ]
    if any(token in normalized_casefold for token in ("аниме", "anime", "манга", "manga")):
        style_parts.append(
            "Strict anime look: 2D illustration, clean lineart, cel-shading, stylized facial features."
        )
        style_parts.append(
            "Avoid photorealism, avoid semi-realistic rendering."
        )
    if any(token in normalized_casefold for token in ("реал", "photoreal", "realistic")):
        style_parts.append(
            "Keep realistic human proportions, lighting, and materials."
        )

    return " ".join(style_parts)


def _select_story_turn_image_character_cards(
    *,
    user_prompt: str,
    assistant_text: str,
    world_cards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    context_tokens = _normalize_story_match_tokens(f"{user_prompt}\n{assistant_text}")
    selected_cards: list[dict[str, Any]] = []

    main_hero_card = next(
        (
            card
            for card in world_cards
            if isinstance(card, dict)
            and _normalize_story_world_card_kind(str(card.get("kind", ""))) == STORY_WORLD_CARD_KIND_MAIN_HERO
            and str(card.get("title", "")).strip()
        ),
        None,
    )
    if main_hero_card is not None:
        selected_cards.append(main_hero_card)

    matched_npc_cards: list[tuple[int, dict[str, Any]]] = []
    fallback_npc_cards: list[tuple[int, dict[str, Any]]] = []
    for card in world_cards:
        if not isinstance(card, dict):
            continue
        if _normalize_story_world_card_kind(str(card.get("kind", ""))) != STORY_WORLD_CARD_KIND_NPC:
            continue

        title = str(card.get("title", "")).strip()
        if not title:
            continue
        title_tokens = _normalize_story_match_tokens(title)
        triggers = [
            str(trigger).strip()
            for trigger in card.get("triggers", [])
            if isinstance(trigger, str) and trigger.strip()
        ]
        matched_by_name = bool(context_tokens) and any(token in context_tokens for token in title_tokens)
        matched_by_trigger = bool(context_tokens) and any(
            _is_story_trigger_match(trigger, context_tokens)
            for trigger in triggers
        )

        card_id_raw = card.get("id")
        if isinstance(card_id_raw, int):
            card_id_rank = card_id_raw
        else:
            card_id_rank = 10**9 + len(matched_npc_cards) + len(fallback_npc_cards)

        if matched_by_name or matched_by_trigger:
            matched_npc_cards.append((card_id_rank, card))
        else:
            fallback_npc_cards.append((card_id_rank, card))

    ranked_candidates = matched_npc_cards if matched_npc_cards else fallback_npc_cards
    ranked_candidates.sort(key=lambda value: value[0])
    for _, npc_card in ranked_candidates:
        if len(selected_cards) >= STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS:
            break
        selected_cards.append(npc_card)

    return selected_cards[:STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS]


def _build_story_turn_image_character_lines(
    *,
    user_prompt: str,
    assistant_text: str,
    world_cards: list[dict[str, Any]],
) -> list[str]:
    character_cards = _select_story_turn_image_character_cards(
        user_prompt=user_prompt,
        assistant_text=assistant_text,
        world_cards=world_cards,
    )
    character_lines: list[str] = []
    for card in character_cards:
        title = _normalize_story_prompt_text(
            str(card.get("title", "")),
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_TITLE_CHARS,
        )
        if not title:
            continue
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        role_label = "main_hero" if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO else "npc"
        gender_hint = _extract_story_turn_image_gender_hint_from_card(
            card=card,
            user_prompt=user_prompt,
            assistant_text=assistant_text,
        )
        appearance_hint = _extract_story_turn_image_appearance_hint_from_card(card)
        appearance_lock = _extract_story_turn_image_appearance_lock_from_card(card)

        line_parts = [f"{role_label}: {title}"]
        gender_label = _story_turn_image_gender_hint_for_prompt(gender_hint)
        if gender_label:
            line_parts.append(f"gender {gender_label}")
        gender_lock = _story_turn_image_gender_lock_for_prompt(gender_hint)
        if gender_lock:
            line_parts.append(gender_lock)
        if appearance_lock:
            line_parts.append(f"appearance-lock {appearance_lock}")
        if appearance_hint:
            line_parts.append(f"appearance {appearance_hint}")
        character_lines.append("; ".join(line_parts))
    return character_lines


def _build_story_turn_image_full_character_card_locks(
    *,
    user_prompt: str,
    assistant_text: str,
    world_cards: list[dict[str, Any]],
) -> list[str]:
    selected_cards = _select_story_turn_image_character_cards(
        user_prompt=user_prompt,
        assistant_text=assistant_text,
        world_cards=world_cards,
    )
    lock_blocks: list[str] = []
    for card in selected_cards:
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        if card_kind not in STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_SCOPE:
            continue

        role_label = "main_hero" if card_kind == STORY_WORLD_CARD_KIND_MAIN_HERO else "npc"
        title = " ".join(str(card.get("title", "")).split()).strip()
        if not title:
            continue

        raw_content = str(card.get("content", ""))
        plain_content = _normalize_story_markup_to_plain_text(raw_content).replace("\r\n", "\n").strip()
        if not plain_content:
            continue

        lock_blocks.append(
            f"CHARACTER_CARD_LOCK_BEGIN: {role_label} | {title}\n"
            f"{plain_content}\n"
            "CHARACTER_CARD_LOCK_END"
        )
    return lock_blocks


def _validate_story_turn_image_character_card_lock_budget(card_blocks: list[str]) -> None:
    if not STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_REQUIRED:
        return
    if not card_blocks:
        return

    total_tokens = sum(_estimate_story_tokens(block) for block in card_blocks)
    if total_tokens <= STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS:
        return

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Full character cards do not fit into image prompt budget "
            f"({total_tokens} > {STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS} tokens). "
            "Shorten character cards or reduce the number of visible characters."
        ),
    )


def _story_turn_image_has_hair_length_lock(card_blocks: list[str]) -> bool:
    if not card_blocks:
        return False
    combined_lock_text = "\n".join(card_blocks).casefold()
    return any(keyword in combined_lock_text for keyword in STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS)


def _merge_story_turn_image_world_cards(
    primary_cards: list[dict[str, Any]],
    fallback_cards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged_cards: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for card in [*primary_cards, *fallback_cards]:
        if not isinstance(card, dict):
            continue
        card_id = card.get("id")
        if isinstance(card_id, int):
            dedupe_key = f"id:{card_id}"
        else:
            dedupe_key = (
                f"{_normalize_story_world_card_kind(str(card.get('kind', '')))}:"
                f"{str(card.get('title', '')).strip().casefold()}"
            )
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        merged_cards.append(card)

    return merged_cards


def _build_story_turn_image_latest_scene_focus_text(assistant_text: str, *, max_chars: int) -> str:
    normalized_text = _normalize_story_prompt_text(
        _normalize_story_markup_to_plain_text(assistant_text),
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    if not normalized_text:
        return ""

    sentences = _split_story_text_into_sentences(normalized_text)
    if not sentences:
        return _trim_story_turn_image_prompt_tail_text(normalized_text, max_chars=max_chars)

    selected_sentences_reversed: list[str] = []
    selected_length = 0
    for sentence in reversed(sentences):
        normalized_sentence = _normalize_story_prompt_text(sentence, max_chars=max_chars)
        if not normalized_sentence:
            continue
        next_length = selected_length + len(normalized_sentence) + (1 if selected_sentences_reversed else 0)
        if selected_sentences_reversed and next_length > max_chars:
            break
        if not selected_sentences_reversed and len(normalized_sentence) > max_chars:
            return _trim_story_turn_image_prompt_tail_text(normalized_sentence, max_chars=max_chars)
        selected_sentences_reversed.append(normalized_sentence)
        selected_length = next_length
        if len(selected_sentences_reversed) >= 5:
            break

    selected_sentences = list(reversed(selected_sentences_reversed))
    merged_scene_focus = " ".join(selected_sentences).strip()
    if not merged_scene_focus:
        return _trim_story_turn_image_prompt_tail_text(normalized_text, max_chars=max_chars)
    if len(merged_scene_focus) <= max_chars:
        return merged_scene_focus
    return _trim_story_turn_image_prompt_tail_text(merged_scene_focus, max_chars=max_chars)


def _build_story_turn_image_prompt(
    *,
    user_prompt: str,
    assistant_text: str,
    world_cards: list[dict[str, Any]],
    image_style_prompt: str | None = None,
    full_character_card_locks: list[str] | None = None,
    model_name: str | None = None,
) -> str:
    prompt_max_chars = max(_get_story_turn_image_request_prompt_max_chars(model_name), 1)
    normalized_user_prompt = _normalize_story_prompt_text(
        _normalize_story_markup_to_plain_text(user_prompt),
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_USER_CHARS,
    )
    normalized_assistant_text = _normalize_story_prompt_text(
        _normalize_story_markup_to_plain_text(assistant_text),
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    normalized_image_style_prompt = _normalize_story_turn_image_style_prompt(image_style_prompt)

    world_context_items: list[str] = []
    for card in world_cards:
        if not isinstance(card, dict):
            continue
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        if card_kind in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}:
            continue
        card_title = _normalize_story_prompt_text(
            str(card.get("title", "")),
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_TITLE_CHARS,
        )
        card_content = _normalize_story_prompt_text(
            _normalize_story_markup_to_plain_text(str(card.get("content", ""))),
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_CONTENT_CHARS,
        )
        if not card_title or not card_content:
            continue
        world_context_items.append(f"{card_title}: {card_content}")
        if len(world_context_items) >= STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARDS:
            break
    world_context = "; ".join(world_context_items)

    character_lines = _build_story_turn_image_character_lines(
        user_prompt=user_prompt,
        assistant_text=assistant_text,
        world_cards=world_cards,
    )
    if full_character_card_locks is None:
        full_character_card_locks = _build_story_turn_image_full_character_card_locks(
            user_prompt=user_prompt,
            assistant_text=assistant_text,
            world_cards=world_cards,
        )
    has_full_character_card_lock = bool(full_character_card_locks)
    has_main_hero_line = any(line.startswith("main_hero:") for line in character_lines)
    has_gender_lock_line = any("gender-lock" in line for line in character_lines)
    has_appearance_lock_line = any("appearance-lock" in line for line in character_lines)
    has_hair_length_lock = _story_turn_image_has_hair_length_lock(full_character_card_locks)
    style_instructions = _build_story_turn_image_style_instructions(normalized_image_style_prompt)
    scene_focus_text = _build_story_turn_image_latest_scene_focus_text(
        assistant_text,
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    if not scene_focus_text and normalized_assistant_text:
        scene_focus_text = _trim_story_turn_image_prompt_tail_text(
            normalized_assistant_text,
            max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
        )

    mandatory_prompt_parts = [
        "Single cinematic frame from one interactive RPG scene.",
        "Hard constraints: no text, no UI, no watermark, no logo, no collage, no random symbols on clothes or objects.",
        "Never render any readable text: no letters, no words, no numbers, no captions, no speech bubbles, no signs.",
        "Keep one coherent location and one coherent moment.",
    ]
    if has_full_character_card_lock:
        mandatory_prompt_parts.append(
            "CHARACTER_CARD_LOCKS (FULL, STRICT, MANDATORY):\n"
            + "\n\n".join(full_character_card_locks)
        )
        mandatory_prompt_parts.append(
            "CHARACTER_CARD_LOCK priority is absolute: "
            "CHARACTER_CARD_LOCK > appearance-lock > scene state."
        )

    mandatory_prompt = _join_story_turn_image_prompt_parts(mandatory_prompt_parts)
    if len(mandatory_prompt) > prompt_max_chars:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Character card locks exceed image prompt limit "
                f"({len(mandatory_prompt)} > {prompt_max_chars} chars). "
                "Shorten character cards so full locks fit."
            ),
        )

    prompt_parts = list(mandatory_prompt_parts)

    def _try_append_optional_line(value: str) -> None:
        normalized_value = str(value or "").strip()
        if not normalized_value:
            return
        candidate_prompt = _join_story_turn_image_prompt_parts([*prompt_parts, normalized_value])
        if len(candidate_prompt) <= prompt_max_chars:
            prompt_parts.append(normalized_value)

    _try_append_optional_line(style_instructions)

    if character_lines:
        _try_append_optional_line(
            "Mandatory visible cast (must match exactly): "
            + " ".join(f"{index + 1}) {line}." for index, line in enumerate(character_lines))
        )
        _try_append_optional_line(
            f"Exactly {len(character_lines)} visible people in the frame. "
            "Do not add, remove, replace, or duplicate any character."
        )
        _try_append_optional_line("Keep each listed character's role, gender, and key appearance.")
        if has_gender_lock_line:
            _try_append_optional_line(
                "Gender lock is absolute and has highest priority. "
                "If a character is marked with gender-lock, never swap gender due to strength, MMA/combat role, "
                "muscular body, short haircut, clothing style, or pose."
            )
            if has_full_character_card_lock:
                _try_append_optional_line("Gender lock is part of CHARACTER_CARD_LOCK and cannot be overridden.")
        if has_appearance_lock_line:
            _try_append_optional_line(
                "Appearance lock is absolute and has highest priority. "
                "For each character marked with appearance-lock, every listed trait is mandatory and must match exactly."
            )
            if has_full_character_card_lock:
                _try_append_optional_line(
                    "Appearance-lock is a compact helper; if it conflicts with CHARACTER_CARD_LOCK, follow CHARACTER_CARD_LOCK."
                )
            _try_append_optional_line(
                "No reinterpretation or substitution for locked traits: never alter face shape, facial features, eye color, "
                "hair color, hair length, hairstyle, skin details, scars, tattoos, or other distinctive marks when specified."
            )
            _try_append_optional_line(
                "Choose framing and lighting so locked facial and hair details remain clearly readable."
            )
        if has_main_hero_line:
            _try_append_optional_line("Main hero must be visible in-frame. Do not switch to first-person POV.")
    if has_hair_length_lock:
        _try_append_optional_line("Hair length lock: hair length must match exactly.")
        _try_append_optional_line("Hair length lock: forbidden conflicting hair lengths.")
        _try_append_optional_line(
            "Composition for hair length lock: keep head and visible hair in frame so the true length is readable; "
            "do not hide hair with pose, clothing, crop, or camera angle."
        )

    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Current scene state (latest events): ",
        part_body=scene_focus_text,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Hero action right before this frame: ",
        part_body=normalized_user_prompt,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=False,
    )
    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Environment context: ",
        part_body=world_context,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )

    _try_append_optional_line(
        "Use a medium-wide or medium, side or three-quarter camera angle so all listed characters are clearly visible and identifiable."
    )
    _try_append_optional_line(
        "Show only what is happening in this exact scene right now."
    )
    return _join_story_turn_image_prompt_parts(prompt_parts)


def _extract_openrouter_error_detail(response: requests.Response) -> str:
    detail = ""
    error_payload: Any = None
    try:
        error_payload = response.json()
    except ValueError:
        error_payload = None

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

    if not detail:
        raw_text = str(response.text or "").strip()
        if raw_text:
            detail = raw_text[:500]
    if not detail:
        reason = str(getattr(response, "reason", "") or "").strip()
        if reason:
            detail = reason
    return detail


def _resolve_story_turn_image_aspect_ratio(image_size: str) -> str | None:
    normalized_size = str(image_size or "").strip().lower()
    if not normalized_size:
        return None

    size_match = re.match(r"^\s*(\d{2,5})\s*[x:]\s*(\d{2,5})\s*$", normalized_size)
    if size_match is None:
        return None

    width = max(int(size_match.group(1)), 1)
    height = max(int(size_match.group(2)), 1)
    common_divisor = math.gcd(width, height)
    normalized_ratio = f"{width // common_divisor}:{height // common_divisor}"

    supported_ratios = {"1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"}
    if normalized_ratio in supported_ratios:
        return normalized_ratio

    ratio_value = width / height
    ratio_candidates = {
        "1:1": 1.0,
        "4:3": 4 / 3,
        "3:4": 3 / 4,
        "16:9": 16 / 9,
        "9:16": 9 / 16,
        "21:9": 21 / 9,
        "9:21": 9 / 21,
    }
    closest_ratio = min(
        ratio_candidates.items(),
        key=lambda item: abs(item[1] - ratio_value),
    )[0]
    return closest_ratio


def _build_story_turn_image_openrouter_payload(
    *,
    prompt: str,
    selected_model: str,
    use_chat_completions: bool,
) -> dict[str, Any]:
    if use_chat_completions:
        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": [{"role": "user", "content": prompt}],
            "modalities": ["image"],
        }
        aspect_ratio = _resolve_story_turn_image_aspect_ratio(settings.openrouter_image_size)
        if aspect_ratio:
            payload["image_config"] = {"aspect_ratio": aspect_ratio}
        return payload

    payload = {
        "model": selected_model,
        "prompt": prompt,
        "n": 1,
    }
    image_size = str(settings.openrouter_image_size or "").strip()
    if image_size:
        payload["size"] = image_size
    return payload


def _parse_openrouter_story_turn_image_payload(
    payload_value: Any,
    *,
    selected_model: str,
) -> dict[str, str | None]:
    if not isinstance(payload_value, dict):
        raise RuntimeError("OpenRouter image endpoint returned empty payload")

    # Legacy OpenAI-style response: {"data":[{"url":...}]}
    data_items = payload_value.get("data")
    if isinstance(data_items, list):
        image_item = next((item for item in data_items if isinstance(item, dict)), None)
        if image_item is not None:
            image_url = str(image_item.get("url") or image_item.get("image_url") or "").strip() or None
            raw_b64_payload = (
                str(
                    image_item.get("b64_json")
                    or image_item.get("image_base64")
                    or image_item.get("base64")
                    or ""
                ).strip()
            )
            b64_payload = re.sub(r"\s+", "", raw_b64_payload) if raw_b64_payload else ""
            raw_mime_type = str(image_item.get("mime_type") or image_item.get("format") or "image/png").strip().lower()
            mime_type = raw_mime_type if "/" in raw_mime_type else f"image/{raw_mime_type}"
            image_data_url = f"data:{mime_type};base64,{b64_payload}" if b64_payload else None
            if image_url is None and image_data_url is None:
                raise RuntimeError("OpenRouter image endpoint returned no image URL")
            revised_prompt = (
                str(image_item.get("revised_prompt") or payload_value.get("revised_prompt") or "").strip() or None
            )
            return {
                "model": str(payload_value.get("model") or selected_model),
                "image_url": image_url,
                "image_data_url": image_data_url,
                "revised_prompt": revised_prompt,
            }

    # Chat-completions response with image modalities.
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("OpenRouter image endpoint returned no images")

    image_candidates: list[str] = []
    revised_prompt: str | None = None

    def _append_image_candidate(raw_value: Any) -> None:
        if isinstance(raw_value, dict):
            raw_value = raw_value.get("url")
        candidate = str(raw_value or "").strip()
        if candidate:
            image_candidates.append(candidate)

    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message_value = choice.get("message")
        if not isinstance(message_value, dict):
            continue

        content_value = message_value.get("content")
        if isinstance(content_value, str) and content_value.strip():
            revised_prompt = content_value.strip()
        elif isinstance(content_value, list):
            text_parts: list[str] = []
            for part in content_value:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "").strip().lower() != "text":
                    continue
                text_value = str(part.get("text") or "").strip()
                if text_value:
                    text_parts.append(text_value)
            if text_parts:
                revised_prompt = " ".join(text_parts).strip()

        raw_images = message_value.get("images")
        if isinstance(raw_images, list):
            for raw_image in raw_images:
                if not isinstance(raw_image, dict):
                    continue
                _append_image_candidate(raw_image.get("image_url"))
                _append_image_candidate(raw_image.get("url"))
                _append_image_candidate(raw_image.get("data_url"))

                raw_b64_payload = (
                    str(
                        raw_image.get("b64_json")
                        or raw_image.get("image_base64")
                        or raw_image.get("base64")
                        or ""
                    ).strip()
                )
                if raw_b64_payload:
                    b64_payload = re.sub(r"\s+", "", raw_b64_payload)
                    raw_mime_type = str(raw_image.get("mime_type") or raw_image.get("format") or "image/png").strip().lower()
                    mime_type = raw_mime_type if "/" in raw_mime_type else f"image/{raw_mime_type}"
                    image_candidates.append(f"data:{mime_type};base64,{b64_payload}")

        _append_image_candidate(message_value.get("image_url"))
        _append_image_candidate(message_value.get("url"))
        _append_image_candidate(choice.get("image_url"))
        _append_image_candidate(choice.get("url"))

    _append_image_candidate(payload_value.get("image_url"))
    _append_image_candidate(payload_value.get("url"))

    image_data_url = next(
        (value for value in image_candidates if value.lower().startswith("data:image/")),
        None,
    )
    image_url = next(
        (value for value in image_candidates if value and not value.lower().startswith("data:image/")),
        None,
    )

    if image_url is None and image_data_url is None:
        raise RuntimeError("OpenRouter image endpoint returned no usable image")

    return {
        "model": str(payload_value.get("model") or selected_model),
        "image_url": image_url,
        "image_data_url": image_data_url,
        "revised_prompt": revised_prompt,
    }


def _request_openrouter_story_turn_image(
    *,
    prompt: str,
    model_name: str | None = None,
) -> dict[str, str | None]:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    selected_model = (model_name or settings.openrouter_image_model or STORY_TURN_IMAGE_MODEL_FLUX).strip()
    if not selected_model:
        raise RuntimeError("OpenRouter image model is not configured")

    endpoint_candidates: list[tuple[str, str, bool]] = []
    chat_url = str(settings.openrouter_chat_url or "").strip()
    if chat_url:
        endpoint_candidates.append(("chat", chat_url, True))
    image_url = str(settings.openrouter_image_url or "").strip()
    if image_url and image_url not in {chat_url}:
        endpoint_candidates.append(("images", image_url, False))

    if not endpoint_candidates:
        raise RuntimeError("OpenRouter image endpoint is not configured")

    last_error: RuntimeError | None = None
    for index, (endpoint_kind, endpoint_url, use_chat_completions) in enumerate(endpoint_candidates):
        read_timeout_seconds = _get_story_turn_image_read_timeout_seconds(selected_model)
        request_payload = _build_story_turn_image_openrouter_payload(
            prompt=prompt,
            selected_model=selected_model,
            use_chat_completions=use_chat_completions,
        )
        try:
            response = HTTP_SESSION.post(
                endpoint_url,
                headers=headers,
                json=request_payload,
                timeout=(
                    STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS,
                    read_timeout_seconds,
                ),
            )
        except requests.RequestException as exc:
            last_error = RuntimeError("Failed to reach OpenRouter image endpoint")
            if index < len(endpoint_candidates) - 1:
                logger.warning(
                    "OpenRouter image request transport failed, trying fallback endpoint: model=%s endpoint=%s",
                    selected_model,
                    endpoint_kind,
                )
                continue
            raise last_error from exc

        if response.status_code >= 400:
            detail = _extract_openrouter_error_detail(response)
            error_text = f"OpenRouter image error ({response.status_code})"
            if detail:
                error_text = f"{error_text}: {detail}"
            last_error = RuntimeError(error_text)

            can_fallback = index < len(endpoint_candidates) - 1 and response.status_code in {404, 405, 415, 422}
            if can_fallback:
                logger.warning(
                    "OpenRouter image request returned %s via %s, trying fallback endpoint for model=%s",
                    response.status_code,
                    endpoint_kind,
                    selected_model,
                )
                continue
            raise last_error

        try:
            payload_value = response.json()
        except ValueError as exc:
            last_error = RuntimeError("OpenRouter image endpoint returned invalid payload")
            if index < len(endpoint_candidates) - 1:
                logger.warning(
                    "OpenRouter image payload parsing failed via %s, trying fallback endpoint for model=%s",
                    endpoint_kind,
                    selected_model,
                )
                continue
            raise last_error from exc

        try:
            return _parse_openrouter_story_turn_image_payload(
                payload_value,
                selected_model=selected_model,
            )
        except RuntimeError as exc:
            last_error = exc
            if index < len(endpoint_candidates) - 1:
                logger.warning(
                    "OpenRouter image payload shape mismatch via %s, trying fallback endpoint for model=%s: %s",
                    endpoint_kind,
                    selected_model,
                    exc,
                )
                continue
            raise

    if last_error is not None:
        raise last_error
    raise RuntimeError("OpenRouter image endpoint is unavailable")


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
    story_response_max_tokens: int | None = None,
):
    provider = _effective_story_llm_provider()

    if provider == "gigachat":
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=settings.gigachat_model,
        )
        if _is_story_translation_enabled():
            payload = _build_story_provider_messages(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                context_limit_tokens=context_limit_chars,
                response_max_tokens=effective_response_max_tokens,
                translate_for_model=True,
            )
            generated_text = _request_gigachat_story_text(
                payload,
                max_tokens=effective_response_max_tokens,
            )
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
            response_max_tokens=effective_response_max_tokens,
        )
        return

    if provider == "openrouter":
        selected_model_name = (story_model_name or settings.openrouter_model).strip() or settings.openrouter_model
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=selected_model_name,
        )
        top_k_value, top_p_value = _select_story_sampling_values(
            model_name=selected_model_name,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
        )
        translation_enabled = _is_story_translation_enabled()
        force_output_translation = _should_force_openrouter_story_output_translation(selected_model_name)
        if translation_enabled or force_output_translation:
            payload = _build_story_provider_messages(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                context_limit_tokens=context_limit_chars,
                response_max_tokens=effective_response_max_tokens,
                translate_for_model=translation_enabled,
                model_name=selected_model_name,
            )
            generated_text = _request_openrouter_story_text(
                payload,
                model_name=selected_model_name,
                top_k=top_k_value,
                top_p=top_p_value,
                max_tokens=effective_response_max_tokens,
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
            max_tokens=effective_response_max_tokens,
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
        select_story_world_cards_triggered_by_text=_select_story_world_cards_triggered_by_text,
        normalize_context_limit_chars=_normalize_story_context_limit_chars,
        get_story_turn_cost_tokens=_get_story_turn_cost_tokens,
        spend_user_tokens_if_sufficient=_spend_user_tokens_if_sufficient,
        add_user_tokens=_add_user_tokens,
        stream_story_provider_chunks=_iter_story_provider_stream_chunks,
        normalize_generated_story_output=_normalize_generated_story_output,
        persist_generated_world_cards=_persist_generated_story_world_cards,
        upsert_story_plot_memory_card=_upsert_story_plot_memory_card,
        plot_card_to_out=_story_plot_card_to_out,
        world_card_to_out=_story_world_card_to_out,
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


def generate_story_turn_image_impl(
    game_id: int,
    payload: StoryTurnImageGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryTurnImageGenerateOut:
    _validate_story_turn_image_provider_config()
    user = _get_current_user(db, authorization)
    game = _get_user_story_game_or_404(db, user.id, game_id)

    assistant_message = db.scalar(
        select(StoryMessage).where(
            StoryMessage.id == payload.assistant_message_id,
            StoryMessage.game_id == game.id,
            StoryMessage.undone_at.is_(None),
        )
    )
    if assistant_message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant message not found")
    if assistant_message.role != STORY_ASSISTANT_ROLE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only assistant messages can be used for image generation",
        )

    source_user_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == STORY_USER_ROLE,
            StoryMessage.id < assistant_message.id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
    )
    if source_user_message is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User prompt for this assistant message was not found",
        )

    all_world_cards = _list_story_world_cards(db, game.id)
    active_world_cards = _select_story_world_cards_for_prompt(
        _list_story_messages(db, game.id),
        all_world_cards,
    )
    combined_context = "\n".join(
        value.strip()
        for value in [source_user_message.content, assistant_message.content]
        if isinstance(value, str) and value.strip()
    )
    triggered_world_cards = (
        _select_story_world_cards_triggered_by_text(combined_context, all_world_cards)
        if combined_context
        else []
    )
    relevant_world_cards = _merge_story_turn_image_world_cards(
        triggered_world_cards,
        active_world_cards,
    )
    if not relevant_world_cards:
        relevant_world_cards = active_world_cards
    prompt_world_cards = _merge_story_turn_image_world_cards(
        relevant_world_cards,
        all_world_cards,
    )

    full_character_card_locks = _build_story_turn_image_full_character_card_locks(
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=prompt_world_cards,
    )
    _validate_story_turn_image_character_card_lock_budget(full_character_card_locks)

    selected_image_model = _coerce_story_image_model(getattr(game, "image_model", None))
    visual_prompt = _build_story_turn_image_prompt(
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=prompt_world_cards,
        image_style_prompt=getattr(game, "image_style_prompt", ""),
        full_character_card_locks=full_character_card_locks,
        model_name=selected_image_model,
    )
    visual_prompt = _limit_story_turn_image_request_prompt(
        visual_prompt,
        model_name=selected_image_model,
    )
    if not visual_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Turn context is empty and cannot be rendered",
        )

    image_generation_cost = _get_story_turn_image_cost_tokens(selected_image_model)
    if not _spend_user_tokens_if_sufficient(db, int(user.id), image_generation_cost):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Not enough sols to generate image",
        )
    db.commit()
    db.refresh(user)

    logger.info(
        "Story turn image generation started: game_id=%s assistant_message_id=%s model=%s cost=%s",
        game.id,
        assistant_message.id,
        selected_image_model,
        image_generation_cost,
    )
    try:
        generation_payload = _request_openrouter_story_turn_image(
            prompt=visual_prompt,
            model_name=selected_image_model,
        )
    except Exception as exc:
        try:
            _add_user_tokens(db, int(user.id), image_generation_cost)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            logger.exception(
                "Story turn image token refund failed after generation error: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
        logger.exception(
            "Story turn image generation failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        detail = str(exc).strip() or "Image generation failed"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail[:500]) from exc
    logger.info(
        "Story turn image generation finished: game_id=%s assistant_message_id=%s",
        game.id,
        assistant_message.id,
    )

    resolved_model = str(generation_payload.get("model") or selected_image_model).strip() or selected_image_model
    resolved_revised_prompt = str(generation_payload.get("revised_prompt") or "").strip() or None
    resolved_image_url = str(generation_payload.get("image_url") or "").strip() or None
    resolved_image_data_url = str(generation_payload.get("image_data_url") or "").strip() or None

    try:
        persisted_turn_image = StoryTurnImage(
            game_id=game.id,
            assistant_message_id=assistant_message.id,
            model=resolved_model,
            prompt=visual_prompt,
            revised_prompt=resolved_revised_prompt,
            image_url=resolved_image_url,
            image_data_url=resolved_image_data_url,
        )
        db.add(persisted_turn_image)
        db.commit()
        db.refresh(persisted_turn_image)
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        try:
            _add_user_tokens(db, int(user.id), image_generation_cost)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            logger.exception(
                "Story turn image token refund failed after persistence error: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
        logger.exception(
            "Story turn image generated but persistence failed: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Image generated but failed to persist: {str(exc).strip()[:500] or 'database write failed'}",
        ) from exc

    return StoryTurnImageGenerateOut(
        id=persisted_turn_image.id,
        assistant_message_id=assistant_message.id,
        model=persisted_turn_image.model,
        prompt=persisted_turn_image.prompt,
        revised_prompt=persisted_turn_image.revised_prompt,
        image_url=persisted_turn_image.image_url,
        image_data_url=persisted_turn_image.image_data_url,
        user=UserOut.model_validate(user),
    )
