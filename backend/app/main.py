from __future__ import annotations

import ast
import base64
import io
import json
import logging
import math
import re
import time
from binascii import Error as BinasciiError
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from threading import Lock, Thread
from typing import Any
from uuid import uuid4

import requests
from requests.adapters import HTTPAdapter
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    StoryGame,
    StoryCharacterEmotionGenerationJob,
    StoryMemoryBlock,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    User,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
)
try:
    from app.models import (
        StoryCommunityWorldFavorite,
        StoryCommunityWorldRating,
        StoryCommunityWorldReport,
    )
    STORY_COMMUNITY_OPTIONAL_MODELS_AVAILABLE = True
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    StoryCommunityWorldFavorite = None
    StoryCommunityWorldRating = None
    StoryCommunityWorldReport = None
    STORY_COMMUNITY_OPTIONAL_MODELS_AVAILABLE = False
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.payments import router as payments_router
from app.routers.story_cards import router as story_cards_router
from app.routers.story_characters import router as story_characters_router
from app.routers.story_generate import router as story_generate_router
from app.routers.story_instruction_templates import router as story_instruction_templates_router
from app.routers.story_messages import router as story_messages_router
from app.routers.story_memory import router as story_memory_router
from app.routers.story_read import router as story_read_router
from app.routers.story_turn_image import router as story_turn_image_router
from app.routers.story_undo import router as story_undo_router
from app.routers.story_world_cards import router as story_world_cards_router
from app.schemas import (
    StoryCharacterAvatarGenerateOut,
    StoryCharacterAvatarGenerateRequest,
    StoryCharacterEmotionGenerateJobOut,
    StoryCharacterEmotionGenerateOut,
    StoryCharacterEmotionGenerateRequest,
    StoryGenerateRequest,
    StoryInstructionCardInput,
    StoryPlotCardChangeEventOut,
    StoryTurnImageGenerateOut,
    StoryTurnImageGenerateRequest,
    UserOut,
    StoryWorldCardChangeEventOut,
)
try:
    from app.schemas import StoryCommunityWorldSummaryOut, StoryGameSummaryOut, StoryQuickStartRequest
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    class StoryCommunityWorldSummaryOut(BaseModel):
        model_config = {"extra": "allow"}

    class StoryGameSummaryOut(BaseModel):
        model_config = {"extra": "allow"}

    class StoryQuickStartRequest(BaseModel):
        genre: str = ""
        hero_class: str = ""
        protagonist_name: str = ""
        start_mode: str = "calm"
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
    normalize_story_character_clothing as _normalize_story_character_clothing,
    normalize_story_character_health_status as _normalize_story_character_health_status,
    normalize_story_character_inventory as _normalize_story_character_inventory,
    normalize_story_character_race as _normalize_story_character_race,
)
from app.services.story_emotions import (
    STORY_CHARACTER_EMOTION_IDS as _STORY_CHARACTER_EMOTION_IDS,
    normalize_story_character_emotion_id as _normalize_story_character_emotion_id,
    normalize_story_scene_emotion_payload as _normalize_story_scene_emotion_payload,
    serialize_story_scene_emotion_payload as _serialize_story_scene_emotion_payload,
)
from app.services.story_cards import (
    STORY_PLOT_CARD_MAX_CONTENT_LENGTH,
    STORY_PLOT_CARD_MAX_TITLE_LENGTH,
    STORY_PLOT_CARD_SOURCE_AI,
    STORY_PLOT_CARD_SOURCE_USER,
    coerce_story_plot_card_enabled as _coerce_story_plot_card_enabled,
    deserialize_story_plot_card_triggers as _deserialize_story_plot_card_triggers,
    normalize_story_plot_card_content as _normalize_story_plot_card_content,
    normalize_story_plot_card_source as _normalize_story_plot_card_source,
    normalize_story_plot_card_triggers as _normalize_story_plot_card_triggers,
    normalize_story_plot_card_title as _normalize_story_plot_card_title,
    serialize_story_plot_card_memory_turns as _serialize_story_plot_card_memory_turns,
    story_plot_card_to_out as _story_plot_card_to_out,
)
from app.services.story_events import (
    story_plot_card_change_event_to_out as _story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out as _story_world_card_change_event_to_out,
)
from app.services.story_queries import (
    get_user_story_game_or_404 as _get_user_story_game_or_404,
    list_story_memory_blocks as _list_story_memory_blocks,
    list_story_messages as _list_story_messages,
    list_story_plot_cards as _list_story_plot_cards,
    list_story_world_cards as _list_story_world_cards,
    touch_story_game as _touch_story_game,
)
from app.services.story_memory import (
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_KEY,
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_SUPER,
    normalize_story_memory_block_content as _normalize_story_memory_block_content,
    normalize_story_memory_block_title as _normalize_story_memory_block_title,
    normalize_story_memory_layer as _normalize_story_memory_layer,
    strip_story_location_time_context as _strip_story_location_time_context,
    story_memory_block_to_out as _story_memory_block_to_out,
)
try:
    from app.services.story_memory import (
        STORY_MEMORY_LAYER_LOCATION,
        STORY_MEMORY_LAYER_WEATHER,
        resolve_story_current_location_label as _resolve_story_current_location_label,
    )
    STORY_MEMORY_OPTIONAL_IMPORTS_AVAILABLE = True
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    STORY_MEMORY_LAYER_LOCATION = "location"
    STORY_MEMORY_LAYER_WEATHER = "weather"
    STORY_MEMORY_OPTIONAL_IMPORTS_AVAILABLE = False

    def _resolve_story_current_location_label(
        current_location_label: str | None,
        memory_blocks: list[Any] | None = None,
    ) -> str | None:
        normalized = " ".join(str(current_location_label or "").split()).strip()
        return normalized or None
from app.services.story_text import normalize_story_text as _normalize_story_text
from app.services.story_undo import (
    rollback_story_card_events_for_assistant_message as _rollback_story_card_events_for_assistant_message,
)
from app.services.story_games import (
    coerce_story_image_model as _coerce_story_image_model,
    get_story_turn_cost_tokens as _get_story_turn_cost_tokens,
    serialize_story_ambient_profile as _serialize_story_ambient_profile,
)
try:
    from app.services.story_games import (
        count_story_completed_turns as _count_story_completed_turns,
        resolve_story_environment_current_weather_for_output as _resolve_story_environment_current_weather_for_output,
        story_author_avatar_url as _story_author_avatar_url,
        story_author_name as _story_author_name,
        story_community_world_summary_to_out as _story_community_world_summary_to_out,
        story_game_summary_to_compact_out as _story_game_summary_to_compact_out,
        story_game_summary_to_out as _story_game_summary_to_out,
    )
    STORY_GAMES_OPTIONAL_IMPORTS_AVAILABLE = True
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    STORY_GAMES_OPTIONAL_IMPORTS_AVAILABLE = False

    def _count_story_completed_turns(messages: list[Any]) -> int:
        return 0

    def _resolve_story_environment_current_weather_for_output(game: StoryGame) -> Any:
        return None

    def _story_author_avatar_url(user: Any) -> str | None:
        return None

    def _story_author_name(user: Any) -> str:
        return ""

    def _story_community_world_summary_to_out(*args: Any, **kwargs: Any) -> StoryCommunityWorldSummaryOut:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    def _story_game_summary_to_compact_out(*args: Any, **kwargs: Any) -> StoryGameSummaryOut:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    def _story_game_summary_to_out(*args: Any, **kwargs: Any) -> StoryGameSummaryOut:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
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
    from app.routers.dashboard_news import router as dashboard_news_router
except Exception:  # pragma: no cover - optional router should not break API startup
    dashboard_news_router = None

try:
    from app.routers.media import router as media_router
except Exception:  # pragma: no cover - optional router should not break API startup
    media_router = None

try:
    from app.routers.story_games import router as story_games_router
except Exception:  # pragma: no cover - optional router should not break API startup
    story_games_router = None

try:
    from app.routers.admin_moderation import router as admin_moderation_router
except Exception:  # pragma: no cover - optional router should not break API startup
    admin_moderation_router = None

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
STORY_CONTEXT_LIMIT_MIN_TOKENS = 6_000
STORY_CONTEXT_LIMIT_MAX_TOKENS = 32_000
STORY_DEFAULT_CONTEXT_LIMIT_TOKENS = 6_000
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
STORY_PLOT_CARD_MEMORY_MODEL = "x-ai/grok-4.1-fast"
STORY_OUTPUT_TRANSLATION_MODEL = "meta-llama/llama-3.2-1b-instruct"
STORY_MEMORY_LOCATION_TITLE = "Место"
STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS = 280
STORY_MEMORY_LOCATION_REQUEST_MAX_TOKENS = 240
STORY_MEMORY_WEATHER_TITLE = "Погода и время"
STORY_MEMORY_WEATHER_CONTENT_MAX_CHARS = 1_200
STORY_MEMORY_POSTPROCESS_REQUEST_MAX_TOKENS = 1_600
STORY_ENVIRONMENT_ANALYSIS_MODEL = "x-ai/grok-4.1-fast"
STORY_ENVIRONMENT_ANALYSIS_REQUEST_MAX_TOKENS = 520
STORY_ENVIRONMENT_TIME_CARD_TITLE = "Дата и время"
STORY_ENVIRONMENT_WEEKDAY_SHORT_NAMES_RU = (
    "пн",
    "вт",
    "ср",
    "чт",
    "пт",
    "сб",
    "вс",
)
STORY_ENVIRONMENT_MONTH_NAMES_RU = (
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
STORY_ENVIRONMENT_SEASON_LABELS_RU = {
    "winter": "Зима",
    "spring": "Весна",
    "summer": "Лето",
    "autumn": "Осень",
}
STORY_MEMORY_LAYER_RAW_BUDGET_SHARE = 0.50
STORY_MEMORY_LAYER_COMPRESSED_BUDGET_SHARE = 0.30
STORY_MEMORY_LAYER_SUPER_BUDGET_SHARE = 0.20
STORY_MEMORY_OPTIMIZATION_MODE_STANDARD = "standard"
STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED = "enhanced"
STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM = "maximum"
STORY_DEFAULT_MEMORY_OPTIMIZATION_MODE = STORY_MEMORY_OPTIMIZATION_MODE_STANDARD
STORY_MEMORY_OPTIMIZATION_MODE_VALUES = {
    STORY_MEMORY_OPTIMIZATION_MODE_STANDARD,
    STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED,
    STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM,
}
STORY_MEMORY_LAYER_BUDGET_SHARES_BY_MODE = {
    STORY_MEMORY_OPTIMIZATION_MODE_STANDARD: {
        STORY_MEMORY_LAYER_RAW: 0.50,
        STORY_MEMORY_LAYER_COMPRESSED: 0.30,
        STORY_MEMORY_LAYER_SUPER: 0.20,
    },
    STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED: {
        STORY_MEMORY_LAYER_RAW: 0.30,
        STORY_MEMORY_LAYER_COMPRESSED: 0.50,
        STORY_MEMORY_LAYER_SUPER: 0.20,
    },
    STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM: {
        STORY_MEMORY_LAYER_RAW: 0.30,
        STORY_MEMORY_LAYER_COMPRESSED: 0.40,
        STORY_MEMORY_LAYER_SUPER: 0.30,
    },
}
STORY_MEMORY_KEY_BUDGET_SHARE = 0.10
STORY_MEMORY_KEY_MIN_BUDGET_TOKENS = 500
STORY_PLOT_CARD_CONTEXT_MAX_SHARE = 0.35
STORY_MEMORY_COMPRESSION_REQUEST_MAX_TOKENS = 700
STORY_MEMORY_KEY_EVENT_REQUEST_MAX_TOKENS = 500
STORY_AMBIENT_PROFILE_MODEL = "x-ai/grok-4.1-fast"
STORY_AMBIENT_PROFILE_REQUEST_MAX_TOKENS = 220
STORY_AMBIENT_HEX_COLOR_PATTERN = re.compile(r"^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$", re.IGNORECASE)
STORY_AMBIENT_DEFAULT_PROFILE: dict[str, Any] = {
    "scene": "unknown",
    "lighting": "dim",
    "primary_color": "#101826",
    "secondary_color": "#1a2436",
    "highlight_color": "#324865",
    "glow_strength": 0.2,
    "background_mix": 0.18,
    "vignette_strength": 0.34,
}
STORY_MEMORY_COMPRESSED_MAX_LINES = 8
STORY_MEMORY_SUPER_MAX_LINES = 4
STORY_MEMORY_SUPER_MAX_CHARS = 520
STORY_MEMORY_RAW_USER_MAX_LINES = 2
STORY_MEMORY_RAW_USER_MAX_CHARS = 420
STORY_MEMORY_RAW_ASSISTANT_MAX_LINES = 8
STORY_MEMORY_RAW_ASSISTANT_MAX_CHARS = 2_600
STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS = 1
STORY_MEMORY_KEY_EVENT_MIN_IMPORTANCE_SCORE = 78
STORY_MEMORY_KEY_EVENT_DEDUP_SIMILARITY = 0.72
STORY_MEMORY_KEY_EVENT_STRONG_TOKENS = (
    "квест",
    "цель",
    "смерт",
    "погиб",
    "убит",
    "предал",
    "предатель",
    "тайн",
    "раскрыл",
    "артефакт",
    "ключ",
    "плен",
    "побед",
    "поражен",
    "угроз",
    "потер",
    "нашел",
    "ритуал",
    "войн",
    "quest",
    "goal",
    "death",
    "killed",
    "betray",
    "secret",
    "artifact",
    "captur",
    "victor",
    "defeat",
    "threat",
    "lost",
    "found",
    "ritual",
    "war",
)
STORY_MEMORY_RAW_MIN_SIGNAL_SCORE = 6
STORY_MEMORY_RAW_MIN_IMPORTANT_HITS = 1
STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE = 7
STORY_MEMORY_LOW_SIGNAL_TOKENS = (
    "привет",
    "здравствуй",
    "добро пожаловать",
    "hello",
    "hi",
    "thanks",
    "thank you",
    "улыбнулся",
    "кивнул",
    "коротко ответил",
)
STORY_MEMORY_KEY_FORBIDDEN_SUBSTRINGS = (
    "ход игрока",
    "ответ мастера",
    "сухие факты",
    "краткий пересказ",
    "свежая память",
    "сжатая память",
    "суперсжатая память",
    "dev память",
    "user turn",
    "narrator reply",
    "dry facts",
    "short retelling",
    "fresh memory",
    "compressed memory",
    "super-compressed",
    "dev memory",
)
STORY_MEMORY_NOISE_PREFIXES = (
    "ход игрока",
    "ответ мастера",
    "сухие факты",
    "краткий пересказ",
    "user turn",
    "player turn",
    "narrator reply",
    "assistant reply",
    "dry facts",
    "short retelling",
)
STORY_MEMORY_RUSSIAN_MIN_CYRILLIC_LETTERS = 6
STORY_MEMORY_MAX_LATIN_RATIO = 0.24
STORY_MEMORY_MAX_LATIN_WORDS = 1
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
STORY_TURN_IMAGE_MODEL_GROK = "grok-imagine-image"
STORY_TURN_IMAGE_MODEL_GROK_LEGACY = "grok-imagine-image-pro"
STORY_TURN_IMAGE_COST_BY_MODEL = {
    STORY_TURN_IMAGE_MODEL_FLUX: 3,
    STORY_TURN_IMAGE_MODEL_SEEDREAM: 5,
    STORY_TURN_IMAGE_MODEL_NANO_BANANO: 15,
    STORY_TURN_IMAGE_MODEL_NANO_BANANO_2: 30,
    STORY_TURN_IMAGE_MODEL_GROK: 30,
    STORY_TURN_IMAGE_MODEL_GROK_LEGACY: 30,
}
STORY_CHARACTER_EMOTION_REFERENCE_MAX_CHARS = 1_600
STORY_CHARACTER_EMOTION_EDIT_STYLE_MAX_CHARS = 320
STORY_CHARACTER_EMOTION_GENERATED_VARIANTS = tuple(
    emotion_id for emotion_id in _STORY_CHARACTER_EMOTION_IDS if emotion_id != "calm"
)
STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED = "queued"
STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING = "running"
STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED = "completed"
STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED = "failed"
STORY_CHARACTER_EMOTION_JOB_TERMINAL_STATUSES = {
    STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED,
    STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED,
}
STORY_CHARACTER_EMOTION_JOB_ERROR_MAX_LENGTH = 1_000
STORY_SCENE_EMOTION_ANALYSIS_MODEL = "x-ai/grok-4.1-fast"
STORY_SCENE_EMOTION_ANALYSIS_REQUEST_MAX_TOKENS = 180
STORY_SCENE_EMOTION_MAIN_HERO_ALIASES = (
    "гг",
    "главный герой",
    "герой",
    "ты",
    "тебя",
    "тебе",
    "тобой",
    "вы",
    "вас",
    "вам",
    "вами",
    "я",
    "меня",
    "мне",
    "мной",
    "мы",
    "нас",
    "нам",
    "нами",
    "you",
    "your",
    "yours",
    "player",
    "protagonist",
    "hero",
    "mc",
)
STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS = 8
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT = 600
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL = {
    STORY_TURN_IMAGE_MODEL_NANO_BANANO_2: 600,
    STORY_TURN_IMAGE_MODEL_GROK: 600,
    STORY_TURN_IMAGE_MODEL_GROK_LEGACY: 600,
}
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT = 4_000
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
STORY_COVER_MAX_BYTES = 2 * 1024 * 1024
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
STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS = 3
STORY_WORLD_CARD_MEMORY_TURNS_OPTIONS = {3, 5, 10}
STORY_WORLD_CARD_MEMORY_TURNS_DISABLED = 0
STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS = -1
STORY_WORLD_CARD_PROMPT_MAX_CARDS = 10
STORY_PLOT_CARD_PROMPT_MAX_CARDS = 20
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
STORY_MARKUP_INLINE_SPLIT_PATTERN = re.compile(r"\[\[\s*[A-Za-z\u0400-\u04FF_ -]+(?:\s*:\s*[^\]]+?)?\s*\]\]")
STORY_CJK_CHARACTER_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
STORY_LATIN_LETTER_PATTERN = re.compile(r"[A-Za-z]")
STORY_CYRILLIC_LETTER_PATTERN = re.compile(r"[А-Яа-яЁё]")
STORY_LATIN_WORD_PATTERN = re.compile(r"\b[A-Za-z]{3,}\b")
STORY_CYRILLIC_WORD_PATTERN = re.compile(r"\b[А-Яа-яЁё]{3,}\b")
STORY_NON_RUSSIAN_SYMBOL_PATTERN = re.compile(r"[^0-9А-Яа-яЁё\s\.,!?:;…\-—–«»\"'()\[\]/%№]+")
STORY_MARKUP_PARAGRAPH_PATTERN = re.compile(
    r"^\[\[\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_MARKUP_START_PATTERN = re.compile(
    r"^\[\[\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]",
    re.IGNORECASE,
)
STORY_MARKUP_STANDALONE_PATTERN = re.compile(
    r"^\[\[\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*$",
    re.IGNORECASE,
)
STORY_MARKUP_MALFORMED_PATTERN = re.compile(
    r"^(?:\[\[|\[)?\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]+?)\s*$",
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
STORY_MARKUP_KEY_ALIAS_BY_COMPACT = {
    "narrator": "narrator",
    "narration": "narration",
    "narrative": "narrative",
    "\u0440\u0430\u0441\u0441\u043a\u0430\u0437\u0447\u0438\u043a": "narrator",
    "\u043d\u0430\u0440\u0440\u0430\u0442\u043e\u0440": "narrator",
    "\u043f\u043e\u0432\u0435\u0441\u0442\u0432\u043e\u0432\u0430\u043d\u0438\u0435": "narration",
    "npc": "npc",
    "\u043d\u043f\u0441": "npc",
    "\u043d\u043f\u043a": "npc",
    "npcreplick": "npc",
    "npcreplica": "npc",
    "npcspeech": "npc",
    "npcdialogue": "npc",
    "gg": "gg",
    "\u0433\u0433": "gg",
    "ggreplick": "gg",
    "ggreplica": "gg",
    "ggspeech": "gg",
    "ggdialogue": "gg",
    "mc": "mc",
    "mainhero": "mainhero",
    "maincharacter": "mainhero",
    "say": "say",
    "speech": "speech",
    "npcthought": "npc_thought",
    "npcthink": "npc_thought",
    "ggthought": "gg_thought",
    "ggthink": "gg_thought",
    "thought": "thought",
    "think": "think",
    "\u043d\u043f\u0441\u043c\u044b\u0441\u043b\u044c": "npc_thought",
    "\u043d\u043f\u0441\u043c\u044b\u0441\u043b\u0438": "npc_thought",
    "\u043d\u043f\u043a\u043c\u044b\u0441\u043b\u044c": "npc_thought",
    "\u043d\u043f\u043a\u043c\u044b\u0441\u043b\u0438": "npc_thought",
    "\u0433\u0433\u043c\u044b\u0441\u043b\u044c": "gg_thought",
    "\u0433\u0433\u043c\u044b\u0441\u043b\u0438": "gg_thought",
}
STORY_NPC_DIALOGUE_MARKER_PATTERN = re.compile(
    r"\[\[NPC(?:_THOUGHT)?\s*:\s*([^\]]+)\]\]\s*([\s\S]*?)\s*$",
    re.IGNORECASE,
)
STORY_NPC_SPEAKER_LINE_PATTERN = re.compile(
    r"^\s*([A-ZА-ЯЁ][^:\n]{0,80}?)(?:\s*\((?:в голове|мысленно|мысли)\))?\s*:\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
STORY_PLAIN_SPEAKER_LINE_PATTERN = re.compile(
    r"^\s*([A-ZА-ЯЁ][^:\n]{0,80}?)(?:\s*\((в голове|мысленно|мысли)\))?\s*:\s*([\s\S]+?)\s*$",
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
STORY_PROVIDER_FAILURE_DETAIL_MARKERS = (
    "provider returned error",
    "internal server error",
    "server_error",
    "upstream",
    "openrouter chat error (500)",
    "openrouter chat error (502)",
    "openrouter chat error (503)",
    "openrouter chat error (504)",
)
STORY_PRE_STREAM_CONFLICT_DETAIL = (
    "Story state could not be prepared before generation. Refresh the game and try again."
)
STORY_SPRITE_REMOVAL_SESSION_LOCK = Lock()
STORY_SPRITE_REMOVAL_SESSION: Any = None
HTTP_SESSION = requests.Session()
HTTP_ADAPTER = HTTPAdapter(
    pool_connections=max(settings.http_pool_connections, 1),
    pool_maxsize=max(settings.http_pool_maxsize, 1),
)
HTTP_SESSION.mount("https://", HTTP_ADAPTER)
HTTP_SESSION.mount("http://", HTTP_ADAPTER)
STORY_STREAM_PERSIST_MIN_CHARS = 900
STORY_STREAM_PERSIST_MAX_INTERVAL_SECONDS = 1.2
STORY_STREAM_HTTP_CHUNK_SIZE_BYTES = 256
STORY_STREAM_COALESCED_CHUNK_DELAY_SECONDS = 0.012
STORY_STREAM_TAIL_RECOVERY_MIN_CHARS = 260
STORY_STREAM_TRANSLATION_MIN_CHARS = 24
STORY_STREAM_TRANSLATION_MAX_CHARS = 180
STORY_OPENROUTER_TRANSLATION_FORCE_MODEL_IDS: set[str] = {
    "z-ai/glm-5",
    "z-ai/glm-5.1",
    "z-ai/glm-4.7",
}
STORY_FORCED_OUTPUT_TRANSLATION_MODEL_BY_STORY_MODEL: dict[str, str] = {
    "z-ai/glm-5": "z-ai/glm-5",
    "z-ai/glm-5.1": "z-ai/glm-5.1",
    "z-ai/glm-4.7": "z-ai/glm-4.7",
    "deepseek/deepseek-v3.2": "z-ai/glm-5",
    "x-ai/grok-4.1-fast": "z-ai/glm-5",
    "mistralai/mistral-nemo": "z-ai/glm-5",
    "xiaomi/mimo-v2-flash": "z-ai/glm-5",
    "xiaomi/mimo-v2-pro": "z-ai/glm-5",
    "aion-labs/aion-2.0": "z-ai/glm-5",
    "arcee-ai/trinity-large-preview:free": "z-ai/glm-5",
}
STORY_LEGACY_MODEL_ALIASES = {
    "arcee-ai/trinity-large-preview:free": "xiaomi/mimo-v2-flash",
}
STORY_NO_GG_ROLEPLAY_MODEL_IDS = {
    "deepseek/deepseek-v3.2",
}
STORY_NON_SAMPLING_MODEL_HINTS = {
    "meta-llama/llama-3.3-70b-instruct:free",
}
STORY_OPENROUTER_PROVIDER_FRIENDLI = "friendli"
STORY_OPENROUTER_PROVIDER_MISTRAL = "mistral"
STORY_OPENROUTER_PROVIDER_NOVITA_FP8 = "novita/fp8"
STORY_OPENROUTER_PROVIDER_XIAOMI_FP8 = "xiaomi/fp8"
STORY_OPENROUTER_PROVIDER_AION_LABS = "aion-labs"
STORY_OPENROUTER_PROVIDER_XAI = "xai"
STORY_OPENROUTER_PROVIDER_PINNED_BY_MODEL = {
    "z-ai/glm-5": STORY_OPENROUTER_PROVIDER_FRIENDLI,
    "z-ai/glm-5.1": STORY_OPENROUTER_PROVIDER_FRIENDLI,
    "deepseek/deepseek-v3.2": STORY_OPENROUTER_PROVIDER_NOVITA_FP8,
    "mistralai/mistral-nemo": STORY_OPENROUTER_PROVIDER_MISTRAL,
    "xiaomi/mimo-v2-pro": STORY_OPENROUTER_PROVIDER_XIAOMI_FP8,
    "aion-labs/aion-2.0": STORY_OPENROUTER_PROVIDER_AION_LABS,
    "x-ai/grok-4.1-fast": STORY_OPENROUTER_PROVIDER_XAI,
}
STORY_PAID_MODEL_HINTS = {
    "z-ai/glm-5",
    "z-ai/glm-5.1",
    "z-ai/glm-4.7",
    "deepseek/deepseek-v3.2",
    "x-ai/grok-4.1-fast",
    "mistralai/mistral-nemo",
    "xiaomi/mimo-v2-flash",
    "xiaomi/mimo-v2-pro",
    "aion-labs/aion-2.0",
    "arcee-ai/trinity",
}


def _is_story_provider_failure_detail(detail: str | None) -> bool:
    normalized_detail = str(detail or "").casefold()
    if not normalized_detail:
        return False
    return any(marker in normalized_detail for marker in STORY_PROVIDER_FAILURE_DETAIL_MARKERS)


def _public_story_provider_failure_detail(detail: str | None) -> str:
    normalized_detail = re.sub(r"\s+", " ", str(detail or "").replace("\r\n", "\n").strip())
    if normalized_detail.casefold().startswith("openrouter chat error") and "{" in normalized_detail:
        normalized_detail = normalized_detail.split("{", 1)[0].rstrip(" .:,")
    return normalized_detail[:500] or "Provider returned error"


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
STORY_LATIN_TO_CYRILLIC_NAME_DIGRAPHS: tuple[tuple[str, str], ...] = (
    ("shch", "щ"),
    ("sch", "щ"),
    ("yo", "ё"),
    ("yu", "ю"),
    ("ya", "я"),
    ("zh", "ж"),
    ("kh", "х"),
    ("ts", "ц"),
    ("ch", "ч"),
    ("sh", "ш"),
    ("ye", "е"),
)
STORY_LATIN_TO_CYRILLIC_NAME_CHAR_MAP = {
    "a": "а",
    "b": "б",
    "c": "к",
    "d": "д",
    "e": "е",
    "f": "ф",
    "g": "г",
    "h": "х",
    "i": "и",
    "j": "й",
    "k": "к",
    "l": "л",
    "m": "м",
    "n": "н",
    "o": "о",
    "p": "п",
    "q": "к",
    "r": "р",
    "s": "с",
    "t": "т",
    "u": "у",
    "v": "в",
    "w": "в",
    "x": "кс",
    "y": "и",
    "z": "з",
}
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
    "Follow LANGUAGE CONTRACT below for output language. "
    "Продолжай сцену строго по действию игрока, без советов и объяснения правил. "
    "Пиши художественно от второго лица с учетом контекста и карточек. "
    "Не выходи из роли, не упоминай ИИ и не добавляй мета-комментарии. "
    "Формат ответа: 2-5 абзацев. Протокол маркеров обязателен."
)
STORY_STRICT_ENGLISH_OUTPUT_RULES = (
    "CRITICAL LANGUAGE CONTRACT:",
    "1) All narrative, dialogue, and thought text outside [[...]] markers MUST be English.",
    "2) Never output Cyrillic outside marker labels and character names.",
    "3) Character names may remain as they are in world cards, including Cyrillic spellings.",
    "4) Before finalizing, rewrite any accidental non-English sentence into English.",
)
STORY_STRICT_RUSSIAN_OUTPUT_RULES = (
    "CRITICAL LANGUAGE CONTRACT:",
    "1) All narrative, dialogue, and thought text outside [[...]] markers MUST be Russian.",
    "2) English words are forbidden unless this is a fixed proper noun or a world-defined name.",
    "3) Keep marker labels and character names unchanged.",
    "4) Chinese/Japanese/Korean characters are forbidden in output.",
    "5) Before finalizing, rewrite accidental non-Russian fragments into natural Russian.",
    "6) Run a silent Russian quality check before every final answer: spelling, grammar, punctuation, morphology, style, and lexical purity.",
    "7) If any phrase sounds machine-translated, broken, unnatural, or semantically awkward in Russian, rewrite it immediately into fluent literary Russian.",
    "8) Prefer Russian wording for foreign terms whenever meaning can be preserved without loss.",
)
STORY_DIALOGUE_FORMAT_RULES_V2 = (
    "Следуй карточкам инструкций и мира молча, не перечисляй их.",
    "Если история и активные карточки мира конфликтуют, приоритет всегда у активных карточек мира.",
    "Если в текущей сцене введен новый именованный персонаж, используй именно это имя в [[NPC:...]] и не подменяй его другим известным персонажем.",
    "Обычный нарратив, описания, действия, паузы, реакции, жесты, мимику, молчание и окружение пиши обычным текстом без маркера.",
    "Маркер ставь только на абзац, где есть прямая речь или внутренняя мысль персонажа.",
    "Немаркированная прямая речь запрещена.",
    "Если в абзаце есть произнесенные вслух слова персонажа, абзац обязан начинаться с [[NPC:...]] или [[GG:...]].",
    "Допустимые маркеры только такие:",
    "1) [[NPC:ИмяИлиРоль]] текст",
    "2) [[GG:Имя]] текст",
    "3) [[NPC_THOUGHT:ИмяИлиРоль]] текст",
    "4) [[GG_THOUGHT:Имя]] текст",
    "Одна реплика или мысль = один абзац.",
    "Для речи используй только [[NPC:...]] и [[GG:...]].",
    "Для мыслей используй только [[NPC_THOUGHT:...]] и [[GG_THOUGHT:...]].",
    "Если имя персонажа просто упомянуто в повествовании, это не реплика и не мысль.",
    "Не помечай как [[NPC:...]] или [[GG:...]] абзац, где персонаж ничего не произносит вслух.",
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
app.include_router(story_instruction_templates_router)
app.include_router(story_messages_router)
app.include_router(story_memory_router)
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
if dashboard_news_router is not None:
    app.include_router(dashboard_news_router)
else:
    logger.warning("Dashboard news router is unavailable and will be skipped")
if media_router is not None:
    app.include_router(media_router)
else:
    logger.warning("Media router is unavailable and will be skipped")
if story_games_router is not None:
    app.include_router(story_games_router)
else:
    logger.warning("Story games router is unavailable and will be skipped")
if admin_moderation_router is not None:
    app.include_router(admin_moderation_router)
else:
    logger.warning("Admin moderation router is unavailable and will be skipped")


def _fail_abandoned_story_character_emotion_jobs() -> None:
    db = SessionLocal()
    try:
        active_jobs = db.scalars(
            select(StoryCharacterEmotionGenerationJob).where(
                StoryCharacterEmotionGenerationJob.status.in_(
                    (
                        STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED,
                        STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING,
                    )
                )
            )
        ).all()
        if not active_jobs:
            return

        completed_at = datetime.now(timezone.utc)
        for job in active_jobs:
            if int(getattr(job, "reserved_tokens", 0) or 0) > 0:
                _add_user_tokens(db, int(job.user_id), int(job.reserved_tokens))
                job.reserved_tokens = 0
            job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
            job.current_emotion_id = ""
            job.error_detail = "Emotion generation was interrupted while the service restarted"
            job.completed_at = completed_at
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to reconcile abandoned story emotion jobs on startup")
    finally:
        db.close()


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
    else:
        _fail_abandoned_story_character_emotion_jobs()


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


def _build_story_list_preview(raw_content: str | None) -> str | None:
    if not isinstance(raw_content, str):
        return None
    normalized = " ".join(raw_content.split()).strip()
    if not normalized:
        return None
    if len(normalized) <= 145:
        return normalized
    return f"{normalized[:142]}..."


def _normalize_story_quick_start_fallback_text(value: str | None, *, max_length: int, fallback: str) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        normalized = fallback.strip()
    trimmed = normalized[: max(max_length, 1)].strip()
    return trimmed or fallback.strip()


def _normalize_story_quick_start_fallback_mode(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"calm", "action"}:
        return normalized
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported quick start mode")


def _ensure_story_games_fallback_support(*, require_community_models: bool = False) -> None:
    if not STORY_GAMES_OPTIONAL_IMPORTS_AVAILABLE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if require_community_models and not STORY_COMMUNITY_OPTIONAL_MODELS_AVAILABLE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@app.get(
    "/api/story/games",
    response_model=list[StoryGameSummaryOut],
    include_in_schema=story_games_router is None,
)
def list_story_games_fallback(
    compact: bool = False,
    limit: int | None = Query(default=None, ge=1, le=200),
    authorization: str | None = Header(default=None),
) -> list[StoryGameSummaryOut]:
    if story_games_router is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    _ensure_story_games_fallback_support()

    db = SessionLocal()
    important_payload = None

    try:
        user = _get_current_user(db, authorization)
        query = (
            select(StoryGame)
            .where(StoryGame.user_id == user.id)
            .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
        )
        if limit is not None:
            query = query.limit(limit)
        games = db.scalars(query).all()
        if not games:
            return []

        summaries: list[StoryGameSummaryOut] = []
        for game in games:
            messages = db.scalars(
                select(StoryMessage).where(StoryMessage.game_id == game.id).order_by(StoryMessage.id.asc())
            ).all()
            latest_assistant_message = next(
                (
                    message
                    for message in reversed(messages)
                    if str(getattr(message, "role", "") or "").strip().lower() == "assistant"
                ),
                None,
            )
            latest_message_preview = _build_story_list_preview(
                getattr(latest_assistant_message, "content", None)
            )
            turn_count = _count_story_completed_turns(messages)
            summaries.append(
                _story_game_summary_to_compact_out(
                    game,
                    latest_message_preview=latest_message_preview,
                    turn_count=turn_count,
                )
                if compact
                else _story_game_summary_to_out(
                    game,
                    latest_message_preview=latest_message_preview,
                    turn_count=turn_count,
                )
            )
        return summaries
    finally:
        db.close()


@app.get(
    "/api/story/community/worlds",
    response_model=list[StoryCommunityWorldSummaryOut],
    include_in_schema=story_games_router is None,
)
def list_story_community_worlds_fallback(
    limit: int = Query(default=60, ge=1, le=60),
    authorization: str | None = Header(default=None),
) -> list[StoryCommunityWorldSummaryOut]:
    if story_games_router is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    _ensure_story_games_fallback_support(require_community_models=True)

    db = SessionLocal()
    try:
        _ = _get_current_user(db, authorization)
        worlds = db.scalars(
            select(StoryGame)
            .where(StoryGame.visibility == "public")
            .order_by(
                StoryGame.community_launches.desc(),
                StoryGame.community_views.desc(),
                StoryGame.community_rating_count.desc(),
                StoryGame.id.desc(),
            )
            .limit(limit)
        ).all()
        if not worlds:
            return []

        author_ids = sorted({int(world.user_id) for world in worlds})
        authors = db.scalars(select(User).where(User.id.in_(author_ids))).all() if author_ids else []
        author_by_id = {int(author.id): author for author in authors}

        return [
            _story_community_world_summary_to_out(
                world,
                author_id=int(world.user_id),
                author_name=_story_author_name(author_by_id.get(int(world.user_id))),
                author_avatar_url=_story_author_avatar_url(author_by_id.get(int(world.user_id))),
                user_rating=None,
                is_reported_by_user=False,
                is_favorited_by_user=False,
            )
            for world in worlds
        ]
    finally:
        db.close()


@app.get(
    "/api/story/community/favorites",
    response_model=list[StoryCommunityWorldSummaryOut],
    include_in_schema=story_games_router is None,
)
def list_story_community_favorites_fallback(
    authorization: str | None = Header(default=None),
) -> list[StoryCommunityWorldSummaryOut]:
    if story_games_router is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    _ensure_story_games_fallback_support(require_community_models=True)

    db = SessionLocal()
    try:
        user = _get_current_user(db, authorization)
        favorite_rows = db.scalars(
            select(StoryCommunityWorldFavorite)
            .where(StoryCommunityWorldFavorite.user_id == user.id)
            .order_by(StoryCommunityWorldFavorite.created_at.desc(), StoryCommunityWorldFavorite.id.desc())
            .limit(120)
        ).all()
        if not favorite_rows:
            return []

        ordered_world_ids: list[int] = []
        seen_world_ids: set[int] = set()
        for row in favorite_rows:
            world_id = int(getattr(row, "world_id", 0) or 0)
            if world_id <= 0 or world_id in seen_world_ids:
                continue
            seen_world_ids.add(world_id)
            ordered_world_ids.append(world_id)

        if not ordered_world_ids:
            return []

        worlds = db.scalars(
            select(StoryGame).where(
                StoryGame.id.in_(ordered_world_ids),
                StoryGame.visibility == STORY_GAME_VISIBILITY_PUBLIC,
            )
        ).all()
        if not worlds:
            return []

        world_by_id = {int(world.id): world for world in worlds}
        ordered_worlds = [world_by_id[world_id] for world_id in ordered_world_ids if world_id in world_by_id]
        if not ordered_worlds:
            return []

        world_ids = [int(world.id) for world in ordered_worlds]
        author_ids = sorted({int(world.user_id) for world in ordered_worlds})
        authors = db.scalars(select(User).where(User.id.in_(author_ids))).all() if author_ids else []
        author_by_id = {int(author.id): author for author in authors}

        user_rating_rows = db.scalars(
            select(StoryCommunityWorldRating).where(
                StoryCommunityWorldRating.user_id == user.id,
                StoryCommunityWorldRating.world_id.in_(world_ids),
            )
        ).all()
        user_rating_by_world_id = {int(row.world_id): int(row.rating) for row in user_rating_rows}

        user_report_rows = db.scalars(
            select(StoryCommunityWorldReport).where(
                StoryCommunityWorldReport.reporter_user_id == user.id,
                StoryCommunityWorldReport.world_id.in_(world_ids),
            )
        ).all()
        reported_world_ids = {int(row.world_id) for row in user_report_rows}

        return [
            _story_community_world_summary_to_out(
                world,
                author_id=int(world.user_id),
                author_name=_story_author_name(author_by_id.get(int(world.user_id))),
                author_avatar_url=_story_author_avatar_url(author_by_id.get(int(world.user_id))),
                user_rating=user_rating_by_world_id.get(int(world.id)),
                is_reported_by_user=int(world.id) in reported_world_ids,
                is_favorited_by_user=True,
            )
            for world in ordered_worlds
        ]
    finally:
        db.close()


@app.post(
    "/api/story/games/quick-start",
    response_model=StoryGameSummaryOut,
    include_in_schema=story_games_router is None,
)
def create_story_quick_start_game_fallback(
    payload: StoryQuickStartRequest,
    authorization: str | None = Header(default=None),
) -> StoryGameSummaryOut:
    if story_games_router is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    _ensure_story_games_fallback_support()

    db = SessionLocal()
    try:
        user = _get_current_user(db, authorization)
        genre = _normalize_story_quick_start_fallback_text(
            payload.genre,
            max_length=80,
            fallback="Фэнтези",
        )
        hero_class = _normalize_story_quick_start_fallback_text(
            payload.hero_class,
            max_length=80,
            fallback="Странник",
        )
        protagonist_name = _normalize_story_quick_start_fallback_text(
            payload.protagonist_name,
            max_length=120,
            fallback="Главный герой",
        )
        start_mode = _normalize_story_quick_start_fallback_mode(payload.start_mode)

        opening_scene_intro = (
            "История начинается с короткой передышки перед первым важным выбором."
            if start_mode == "calm"
            else "История стартует прямо в центре нарастающего конфликта и требует мгновенной реакции."
        )
        game_title = f"{protagonist_name} — {genre}"[:160].strip(" -—,:;") or STORY_DEFAULT_TITLE
        game_description = (
            f"{genre}. {protagonist_name} — {hero_class.lower()}. {opening_scene_intro}"
        )[:4000]
        hero_description = (
            f"{protagonist_name} — {hero_class.lower()} в жанре {genre.lower()}. "
            "У героя уже есть характер, личная цель и причина вмешаться в происходящее."
        )[:12000]
        opening_scene = (
            f"{protagonist_name} оказался на пороге новой главы. Мир вокруг уже подсказывает, что спокойной жизни не будет. "
            f"Жанр истории — {genre.lower()}, а значит даже случайная встреча быстро обернётся важным выбором.\n\n"
            + (
                "Сначала у героя есть несколько минут, чтобы осмотреться, почувствовать атмосферу места и заметить первую странность, "
                "которая ещё не выглядит катастрофой, но уже требует решения."
                if start_mode == "calm"
                else "С первых секунд вокруг слишком много движения, шума и скрытой угрозы. Ситуация уже вышла из-под контроля, "
                "и окружающие ждут, как именно герой отреагирует прямо сейчас."
            )
        )[:16000]

        game = StoryGame(
            user_id=int(user.id),
            title=game_title,
            description=game_description,
            opening_scene=opening_scene,
            visibility=STORY_GAME_VISIBILITY_PRIVATE,
            age_rating="16+",
            genres=json.dumps([genre], ensure_ascii=False),
            last_activity_at=_utcnow(),
        )
        db.add(game)
        db.flush()

        db.add(
            StoryWorldCard(
                game_id=int(game.id),
                title=protagonist_name[:120].strip() or "Главный герой",
                content=hero_description,
                triggers=_serialize_story_world_card_triggers([protagonist_name, hero_class, genre]),
                kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
                avatar_url=None,
                avatar_original_url=None,
                avatar_scale=1.0,
                character_id=None,
                memory_turns=None,
                is_locked=False,
                ai_edit_enabled=True,
                source=STORY_WORLD_CARD_SOURCE_USER,
            )
        )

        db.commit()
        db.refresh(game)
        return _story_game_summary_to_out(game)
    finally:
        db.close()

def _normalize_story_context_limit_chars(value: int | None) -> int:
    if value is None:
        return STORY_DEFAULT_CONTEXT_LIMIT_TOKENS
    normalized = int(value)
    return max(STORY_CONTEXT_LIMIT_MIN_TOKENS, min(normalized, STORY_CONTEXT_LIMIT_MAX_TOKENS))


def _normalize_story_memory_optimization_mode(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_MEMORY_OPTIMIZATION_MODE_VALUES:
        return normalized
    if normalized in {"усиленный", "enhanced"}:
        return STORY_MEMORY_OPTIMIZATION_MODE_ENHANCED
    if normalized in {"максимальные", "максимальный", "maximum", "max"}:
        return STORY_MEMORY_OPTIMIZATION_MODE_MAXIMUM
    return STORY_DEFAULT_MEMORY_OPTIMIZATION_MODE


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
        normalized_card: dict[str, str] = {"title": title, "content": content}
        source_kind = str(card.get("source_kind", "") or "").strip().lower()
        if source_kind in {"context", "memory", "plot"}:
            normalized_card["source_kind"] = source_kind
        memory_layer = str(card.get("memory_layer", "") or "").strip().lower()
        if memory_layer:
            normalized_card["memory_layer"] = memory_layer
        normalized_cards.append(normalized_card)
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

        normalized_card: dict[str, str] = {"title": title, "content": content}
        source_kind = str(card.get("source_kind", "") or "").strip().lower()
        if source_kind in {"context", "memory", "plot"}:
            normalized_card["source_kind"] = source_kind
        memory_layer = str(card.get("memory_layer", "") or "").strip().lower()
        if memory_layer:
            normalized_card["memory_layer"] = memory_layer

        entry_cost = _estimate_story_tokens(title) + _estimate_story_tokens(content) + 6
        if consumed_tokens + entry_cost <= limit:
            selected_reversed.append(normalized_card)
            consumed_tokens += entry_cost
            continue

        if not selected_reversed:
            title_cost = _estimate_story_tokens(title) + 6
            content_budget_tokens = max(limit - title_cost, 1)
            trimmed_content = _trim_story_text_tail_by_sentence_tokens(content, content_budget_tokens)
            if trimmed_content:
                selected_reversed.append({**normalized_card, "content": trimmed_content})
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
    if plot_budget_tokens <= 0:
        return []

    total_context_limit_tokens = max(_normalize_story_context_limit_chars(context_limit_tokens), 1)
    context_cards: list[dict[str, str]] = []
    key_memory_cards: list[dict[str, str]] = []
    dev_memory_cards: list[dict[str, str]] = []
    plot_memory_cards: list[dict[str, str]] = []
    for card in normalized_plot_cards:
        source_kind = str(card.get("source_kind", "") or "").strip().lower()
        memory_layer = _normalize_story_memory_layer(str(card.get("memory_layer", "") or ""))
        if source_kind == "context":
            context_cards.append(card)
            continue
        if memory_layer == STORY_MEMORY_LAYER_KEY:
            key_memory_cards.append(card)
            continue
        if source_kind == "plot":
            plot_memory_cards.append(card)
            continue
        dev_memory_cards.append(card)

    def _estimate_cards_tokens(cards: list[dict[str, str]]) -> int:
        if not cards:
            return 0
        payload = "\n".join(
            f"{index}. {str(card.get('title', '')).strip()}: {str(card.get('content', '')).strip()}"
            for index, card in enumerate(cards, start=1)
            if str(card.get("title", "")).strip() and str(card.get("content", "")).strip()
        )
        return _estimate_story_tokens(payload)

    remaining_prompt_tokens = plot_budget_tokens
    fitted_context_cards = _trim_story_plot_cards_to_context_limit(context_cards, remaining_prompt_tokens)
    remaining_prompt_tokens = max(remaining_prompt_tokens - _estimate_cards_tokens(fitted_context_cards), 0)

    key_budget_tokens = min(
        max(int(total_context_limit_tokens * STORY_MEMORY_KEY_BUDGET_SHARE), STORY_MEMORY_KEY_MIN_BUDGET_TOKENS),
        remaining_prompt_tokens,
    )
    fitted_key_memory_cards = _trim_story_plot_cards_to_context_limit(key_memory_cards, key_budget_tokens)
    remaining_prompt_tokens = max(remaining_prompt_tokens - _estimate_cards_tokens(fitted_key_memory_cards), 0)

    plot_cards_budget_tokens = min(
        int(total_context_limit_tokens * STORY_PLOT_CARD_CONTEXT_MAX_SHARE),
        remaining_prompt_tokens,
    )
    fitted_plot_memory_cards = _trim_story_plot_cards_to_context_limit(plot_memory_cards, plot_cards_budget_tokens)
    remaining_prompt_tokens = max(remaining_prompt_tokens - _estimate_cards_tokens(fitted_plot_memory_cards), 0)

    fitted_dev_memory_cards = _trim_story_plot_cards_to_context_limit(dev_memory_cards, remaining_prompt_tokens)
    fitted_plot_cards = [
        *fitted_context_cards,
        *fitted_key_memory_cards,
        *fitted_dev_memory_cards,
        *fitted_plot_memory_cards,
    ]
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
                **oldest_card,
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
        if not bool(getattr(item, "is_active", True)):
            continue
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
        if cleaned in {"always", "forever", "infinite"}:
            parsed_value = STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
        elif cleaned in {"off", "disabled", "disable", "none", "never"}:
            parsed_value = STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
        elif cleaned.lstrip("-").isdigit():
            parsed_value = int(cleaned)

    if parsed_value is None:
        return fallback_value
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS:
        return STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS
    if parsed_value == STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
        return STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
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
    if normalized_value <= STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
        return STORY_WORLD_CARD_MEMORY_TURNS_DISABLED
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

    model_name = str(settings.openrouter_world_card_model or settings.openrouter_model or OPENROUTER_GEMMA_FREE_MODEL).strip()
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
        "race": _normalize_story_character_race(getattr(card, "race", "")),
        "clothing": _normalize_story_character_clothing(getattr(card, "clothing", "")),
        "inventory": _normalize_story_character_inventory(getattr(card, "inventory", "")),
        "health_status": _normalize_story_character_health_status(getattr(card, "health_status", "")),
        "triggers": _deserialize_story_world_card_triggers(card.triggers),
        "kind": card_kind,
        "avatar_url": _normalize_avatar_value(card.avatar_url),
        "avatar_original_url": _normalize_avatar_value(getattr(card, "avatar_original_url", None)) or _normalize_avatar_value(card.avatar_url),
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
    triggers = _normalize_story_plot_card_triggers(
        _deserialize_story_plot_card_triggers(str(getattr(card, "triggers", "") or "")),
        fallback_title=card.title,
    )
    return {
        "id": card.id,
        "title": card.title,
        "content": card.content,
        "triggers": triggers,
        "memory_turns": _serialize_story_plot_card_memory_turns(getattr(card, "memory_turns", None)),
        "ai_edit_enabled": bool(card.ai_edit_enabled),
        "is_enabled": bool(getattr(card, "is_enabled", True)),
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


def _contains_story_latin_letters(value: str) -> bool:
    return STORY_LATIN_LETTER_PATTERN.search(value) is not None


def _contains_story_cyrillic_letters(value: str) -> bool:
    return STORY_CYRILLIC_LETTER_PATTERN.search(value) is not None


def _transliterate_story_latin_name_to_cyrillic(value: str) -> str:
    normalized = re.sub(r"[^a-z\s-]", " ", value.strip().lower())
    if not normalized:
        return ""

    converted = normalized
    for latin, cyrillic in STORY_LATIN_TO_CYRILLIC_NAME_DIGRAPHS:
        converted = converted.replace(latin, cyrillic)

    converted_chars: list[str] = []
    for char in converted:
        if "a" <= char <= "z":
            converted_chars.append(STORY_LATIN_TO_CYRILLIC_NAME_CHAR_MAP.get(char, char))
        else:
            converted_chars.append(char)

    return re.sub(r"\s+", " ", "".join(converted_chars)).strip(" -")


def _build_story_speaker_identity_keys(speaker_name: str) -> set[str]:
    normalized_speaker = " ".join(str(speaker_name or "").split()).strip()
    if not normalized_speaker:
        return set()

    speaker_keys = {_normalize_story_identity_key(normalized_speaker)}
    if _contains_story_latin_letters(normalized_speaker) and not _contains_story_cyrillic_letters(normalized_speaker):
        transliterated = _transliterate_story_latin_name_to_cyrillic(normalized_speaker)
        transliterated_key = _normalize_story_identity_key(transliterated)
        if transliterated_key:
            speaker_keys.add(transliterated_key)

    return {key for key in speaker_keys if key}


def _is_story_identity_key_at_least_as_specific(candidate_key: str, speaker_key: str) -> bool:
    candidate_tokens = _normalize_story_match_tokens(candidate_key)
    speaker_tokens = _normalize_story_match_tokens(speaker_key)
    if candidate_tokens and speaker_tokens and len(candidate_tokens) != len(speaker_tokens):
        return len(candidate_tokens) > len(speaker_tokens)
    return len(candidate_key) >= len(speaker_key)


def _score_story_speaker_identity_match(
    *,
    speaker_keys: set[str],
    title: str,
    candidate_keys: set[str],
) -> int:
    title_key = _normalize_story_identity_key(title)
    best_score = 0

    for speaker_key in speaker_keys:
        if not speaker_key:
            continue
        if speaker_key == title_key:
            return 120
        for candidate_key in candidate_keys:
            if not candidate_key:
                continue
            if speaker_key == candidate_key:
                best_score = max(best_score, 100 if candidate_key == title_key else 90)
                continue
            if not _are_story_identity_keys_related(speaker_key, candidate_key):
                continue
            if not _is_story_identity_key_at_least_as_specific(candidate_key, speaker_key):
                continue
            best_score = max(best_score, 70 if candidate_key == title_key else 60)

    return best_score


def _resolve_story_speaker_name_to_world_title(
    speaker_name: str,
    world_cards: list[dict[str, Any]],
) -> str | None:
    normalized_speaker = " ".join(speaker_name.split()).strip()
    if not normalized_speaker:
        return None

    speaker_keys = _build_story_speaker_identity_keys(normalized_speaker)
    if not speaker_keys:
        return None

    best_title = ""
    best_score = 0
    ambiguous = False

    for card in world_cards:
        if not isinstance(card, dict):
            continue
        card_kind = _normalize_story_world_card_kind(str(card.get("kind", "")))
        if card_kind not in {STORY_WORLD_CARD_KIND_NPC, STORY_WORLD_CARD_KIND_MAIN_HERO}:
            continue

        title = " ".join(str(card.get("title", "")).split()).strip()
        if not title:
            continue
        raw_triggers = card.get("triggers")
        if isinstance(raw_triggers, list):
            identity_triggers = _filter_story_identity_triggers(title, [trigger for trigger in raw_triggers if isinstance(trigger, str)])
        else:
            identity_triggers = []
        candidate_keys = _build_story_identity_keys(title, identity_triggers)
        score = _score_story_speaker_identity_match(
            speaker_keys=speaker_keys,
            title=title,
            candidate_keys=candidate_keys,
        )
        if score <= 0:
            continue

        if score > best_score:
            best_score = score
            best_title = title
            ambiguous = False
            continue
        if score == best_score and best_title and title.casefold() != best_title.casefold():
            ambiguous = True

    if best_title and best_score > 0 and not ambiguous:
        return best_title
    return None


def _align_story_markup_speaker_names_to_world_cards(
    text_value: str,
    world_cards: list[dict[str, Any]],
) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text or not world_cards:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    aligned_paragraphs: list[str] = []
    changed = False
    for paragraph in paragraphs:
        marker_match = STORY_MARKUP_PARAGRAPH_PATTERN.match(paragraph)
        parsed = _parse_story_markup_paragraph(paragraph)
        if marker_match is None or parsed is None or parsed.get("kind") == "narration":
            aligned_paragraphs.append(paragraph)
            continue

        raw_speaker = str(parsed.get("speaker", "")).strip()
        if not raw_speaker:
            aligned_paragraphs.append(paragraph)
            continue

        resolved_speaker = _resolve_story_speaker_name_to_world_title(raw_speaker, world_cards)
        if not resolved_speaker or resolved_speaker.casefold() == raw_speaker.casefold():
            aligned_paragraphs.append(paragraph)
            continue

        marker_token = marker_match.group(1).strip()
        paragraph_text = str(parsed.get("text", "")).strip()
        if not marker_token or not paragraph_text:
            aligned_paragraphs.append(paragraph)
            continue

        aligned_paragraphs.append(f"[[{marker_token}:{resolved_speaker}]] {paragraph_text}")
        changed = True

    if not changed:
        return normalized_text
    return "\n\n".join(aligned_paragraphs).strip()


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
        if memory_turns <= STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
            continue

        last_trigger_turn = 0
        for turn_index, prompt_tokens in turn_token_entries:
            if any(_is_story_trigger_match(trigger, prompt_tokens) for trigger in triggers):
                last_trigger_turn = turn_index

        if last_trigger_turn <= 0:
            continue

        turns_since_trigger = current_turn_index - last_trigger_turn
        if turns_since_trigger >= memory_turns:
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


def _select_story_plot_cards_for_prompt(
    context_messages: list[StoryMessage],
    plot_cards: list[StoryPlotCard],
) -> list[dict[str, str]]:
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

    ranked_cards: list[tuple[tuple[int, int, int], dict[str, str]]] = []
    for card in plot_cards:
        title = " ".join(card.title.split()).strip()
        content = card.content.replace("\r\n", "\n").strip()
        if not title or not content:
            continue

        triggers = _normalize_story_plot_card_triggers(
            _deserialize_story_plot_card_triggers(str(getattr(card, "triggers", "") or "")),
            fallback_title=title,
        )
        effective_is_enabled = _coerce_story_plot_card_enabled(
            getattr(card, "is_enabled", True),
            triggers=triggers,
        )
        if not triggers:
            if not effective_is_enabled:
                continue
            rank_key = (0, 0, card.id)
            ranked_cards.append((rank_key, {"title": title, "content": content}))
            continue

        memory_turns = _serialize_story_plot_card_memory_turns(getattr(card, "memory_turns", None))
        if memory_turns is None or current_turn_index <= 0:
            continue

        last_trigger_turn = 0
        for turn_index, prompt_tokens in turn_token_entries:
            if any(_is_story_trigger_match(trigger, prompt_tokens) for trigger in triggers):
                last_trigger_turn = turn_index

        if last_trigger_turn <= 0:
            continue

        turns_since_trigger = current_turn_index - last_trigger_turn
        if turns_since_trigger >= memory_turns:
            continue

        rank_key = (
            0 if turns_since_trigger == 0 else 1,
            turns_since_trigger,
            card.id,
        )
        ranked_cards.append((rank_key, {"title": title, "content": content}))

    ranked_cards.sort(key=lambda item: item[0])
    return [payload for _, payload in ranked_cards[:STORY_PLOT_CARD_PROMPT_MAX_CARDS]]


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
        if memory_turns is not None and memory_turns <= STORY_WORLD_CARD_MEMORY_TURNS_DISABLED:
            continue
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
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
) -> str:
    # Story cards must be passed in full for all text models.
    compact_mode = False
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
        lines.extend(
            [
                "",
                "PLAYER INSTRUCTION PRIORITY:",
                "Active player instruction cards are hard constraints for this turn.",
                "Follow every active instruction card strictly and literally whenever possible.",
                "If an instruction card conflicts with your default habits, pacing, or stylistic preference, the instruction card wins.",
                "Never ignore, weaken, or silently reinterpret player instruction cards for convenience.",
            ]
        )
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
            raw_race = " ".join(str(card.get("race", "")).replace("\r\n", " ").split()).strip()
            raw_clothing = str(card.get("clothing", "")).replace("\r\n", "\n").strip()
            raw_inventory = str(card.get("inventory", "")).replace("\r\n", "\n").strip()
            raw_health_status = str(card.get("health_status", "")).replace("\r\n", "\n").strip()
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
                explicit_fragments = []
                if raw_race:
                    explicit_fragments.append(f"race={raw_race}")
                if raw_clothing:
                    explicit_fragments.append(f"clothing={_normalize_story_prompt_text(raw_clothing, max_chars=70)}")
                if raw_inventory:
                    explicit_fragments.append(f"inventory={_normalize_story_prompt_text(raw_inventory, max_chars=70)}")
                if raw_health_status:
                    explicit_fragments.append(f"health={_normalize_story_prompt_text(raw_health_status, max_chars=70)}")
                trigger_line = _normalize_story_prompt_list(
                    trigger_values,
                    max_items=STORY_PROMPT_COMPACT_TRIGGER_MAX_ITEMS,
                    max_chars=STORY_PROMPT_COMPACT_TRIGGER_MAX_CHARS,
                )
                lines.append(
                    f"{index}. {title} [{kind_label}] tr: {trigger_line}; "
                    f"{f'{content} | Explicit: ' + '; '.join(explicit_fragments) if explicit_fragments else content}"
                )
            else:
                trigger_line = ", ".join(
                    value.strip() for value in trigger_values if isinstance(value, str) and value.strip()
                )
                lines.append(f"{index}. {title}: {content}")
                lines.append(f"Explicit race: {raw_race or 'not specified'}")
                lines.append(f"Explicit clothing: {raw_clothing or 'not specified'}")
                lines.append(f"Explicit inventory: {raw_inventory or 'not specified'}")
                lines.append(f"Explicit health status: {raw_health_status or 'not specified'}")
                lines.append(f"Триггеры: {trigger_line or 'нет'}")
                lines.append(f"Тип: {kind_label}")

        lines.extend(
            [
                "WORLD CARD OVERRIDE RULE:",
                "If a world card has explicit Race, Clothing, Inventory, or Health fields, those explicit fields override any older or conflicting mentions inside the generic description/content of the same card.",
            ]
        )

    main_hero_name = ""
    for card in world_cards_for_prompt:
        if _normalize_story_world_card_kind(str(card.get("kind", ""))) != STORY_WORLD_CARD_KIND_MAIN_HERO:
            continue
        main_hero_name = " ".join(str(card.get("title", "")).split()).strip()
        if main_hero_name:
            break

    protagonist_label = main_hero_name or "главный герой игрока"
    lines.extend(
        [
            "",
            f"Главный герой игрока: {protagonist_label}.",
            "Это персонаж пользователя. Никогда не принимай за него решения и не перехватывай управление сценой.",
            "Запрещено писать за ГГ новые действия, реплики, мысли, эмоции, выбор, инициативу, маршруты, жесты или выводы, которых игрок сам не заявлял.",
            "Можно описывать только последствия уже совершенного игроком действия и наблюдаемую реакцию мира, NPC и окружения.",
            "Если сцене нужен следующий шаг от ГГ, заканчивай ответ на точке выбора, давлении обстоятельств, вопросе NPC или новом событии, оставляя ход игроку.",
        ]
    )

    normalized_model_name = _normalize_story_model_id(model_name)
    use_english_language_contract = (
        not _is_story_output_translation_model(normalized_model_name)
        and _story_user_language_code() != "ru"
    )
    language_contract_rules = (
        STORY_STRICT_ENGLISH_OUTPUT_RULES
        if use_english_language_contract
        else STORY_STRICT_RUSSIAN_OUTPUT_RULES
    )
    lines.extend(["", *STORY_DIALOGUE_FORMAT_RULES_V2, "", *language_contract_rules])
    if "deepseek/" in normalized_model_name:
        lines.extend(
            [
                "",
                "CRITICAL FORMAT MODE (DeepSeek):",
                "Нарративные абзацы пиши обычным текстом без [[NARRATOR]] и без любого другого маркера.",
                "Маркер в начале абзаца нужен только для прямой речи и внутренних мыслей.",
                "Абзац с репликой или мыслью должен содержать ровно один маркер в самом начале.",
                "Никогда не вставляй новый [[...]] маркер в середину уже начатого абзаца.",
                "Между абзацами оставляй пустую строку.",
                "АБСОЛЮТНЫЙ ЗАПРЕТ: не используй [[GG:...]] и [[GG_THOUGHT:...]].",
                "Никогда не придумывай за ГГ новые реплики, мысли или действия, которых игрок не писал.",
                "Описывай только реакцию мира и NPC на уже совершенное действие игрока.",
            ]
        )
    if "deepseek/" in normalized_model_name:
        lines.extend(
            [
                "",
                "DEEPSEEK INSTRUCTION OVERRIDE:",
                "PLAYER INSTRUCTION CARDS are mandatory operating rules.",
                "Do not bypass them even if they reduce drama, speed, or stylistic freedom.",
            ]
        )
    if not show_npc_thoughts:
        lines.extend(
            [
                "",
                "ОГРАНИЧЕНИЕ ФОРМАТА: мысли NPC отключены в настройках игрока.",
                "Запрещено использовать [[NPC_THOUGHT:...]], [[THOUGHT:...]], [[THINK:...]] и любые внутренние мысли NPC.",
            ]
        )
    if not show_gg_thoughts:
        lines.extend(
            [
                "",
                "ОГРАНИЧЕНИЕ ФОРМАТА: мысли ГГ отключены в настройках игрока.",
                "Запрещено использовать [[GG_THOUGHT:...]] и любые внутренние мысли ГГ.",
            ]
        )
    if not show_gg_thoughts and not show_npc_thoughts:
        lines.extend(
            [
                "",
                "ОГРАНИЧЕНИЕ ФОРМАТА: внутренние мысли отключены полностью.",
                (
                    "Обычный нарратив пиши без маркера. Для прямой речи используй только [[NPC:...]]."
                    if _is_story_no_gg_roleplay_model(normalized_model_name)
                    else "Обычный нарратив пиши без маркера. Для прямой речи используй только [[NPC:...]] и [[GG:...]]."
                ),
            ]
        )
    lines.extend(
        [
            "",
            "PLAYER CHARACTER OWNERSHIP (MANDATORY):",
            f"The player character is '{protagonist_label}'. Only the player controls this character.",
            "Never invent or add new actions, movement, speech, thoughts, choices, emotions, intentions, or conclusions for the player character.",
            "Never continue, finish, or paraphrase a player-character line as a new player-character line.",
            "Do not output [[GG:...]] or [[GG_THOUGHT:...]] unless it is an exact quote explicitly present in the latest user message.",
            "Default behavior: narrate only world and NPC reactions to the already stated player move, then stop where the next move belongs to the player.",
        ]
    )
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
    normalized_key = re.sub(r"[\s-]+", "_", raw_value.strip().casefold()).replace("ё", "е")
    compact_key = normalized_key.replace("_", "")
    alias_key = STORY_MARKUP_KEY_ALIAS_BY_COMPACT.get(compact_key)
    if alias_key:
        return alias_key
    return normalized_key


def _normalize_story_markup_speaker_name(raw_value: str) -> str:
    speaker_name = " ".join(raw_value.split()).strip(" .,:;!?-\"'()[]")
    if len(speaker_name) > STORY_CHARACTER_MAX_NAME_LENGTH:
        speaker_name = speaker_name[:STORY_CHARACTER_MAX_NAME_LENGTH].rstrip()
    return speaker_name


def _resolve_story_bare_speaker_marker_name(
    raw_marker_name: str,
    raw_speaker: str | None,
    *,
    marker_key: str | None = None,
) -> str | None:
    if isinstance(raw_speaker, str) and _normalize_story_markup_speaker_name(raw_speaker):
        return None

    speaker_name = _normalize_story_markup_speaker_name(raw_marker_name)
    if not speaker_name:
        return None

    normalized_key = marker_key or _normalize_story_markup_key(speaker_name)
    if _canonical_story_marker_token(normalized_key) is not None:
        return None

    return speaker_name


def _is_story_markup_body_likely_narrative(
    text_value: str,
    speaker_name: str | None = None,
) -> bool:
    normalized_text = re.sub(r"\s+", " ", str(text_value or "")).strip()
    if not normalized_text:
        return True
    if re.search(r"[\"'\u00ab\u00bb\u201e\u201c\u201d]", normalized_text):
        return False
    if re.search(r"^\s*(?:\u2014|-)\s*\S", normalized_text):
        return False
    if re.search(r"[.!?\u2026]\s*(?:\u2014|-)\s*\S", normalized_text):
        return False
    if re.search(
        r"\b(?:я|меня|мне|мной|мы|нас|нам|наш|наша|наше|наши|ты|тебя|тебе|тобой|вы|вас|вам|вами|ваш|ваша|ваше|ваши|i|me|my|mine|we|us|our|ours|you|your|yours)\b",
        normalized_text,
        flags=re.IGNORECASE,
    ):
        return False

    normalized_line = re.sub(
        r"^[\s\"'\.,:;!\?\(\)\[\]\u00ab\u00bb\u201e\u201c\u201d-]+",
        "",
        normalized_text,
    ).casefold()
    if re.match(
        r"^(?:он|она|они|его|её|ее|их|кто-то|кто то|he|she|they|his|her|their)\b",
        normalized_line,
        flags=re.IGNORECASE,
    ):
        return True

    normalized_speaker_name = re.sub(r"\s+", " ", str(speaker_name or "")).strip().casefold()
    return bool(normalized_speaker_name) and normalized_line.startswith(f"{normalized_speaker_name} ")


def _parse_story_markup_paragraph(paragraph: str) -> dict[str, str] | None:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return None

    marker_match = STORY_MARKUP_PARAGRAPH_PATTERN.match(paragraph_value)
    if marker_match is None:
        return None

    raw_marker_name = marker_match.group(1)
    marker_key = _normalize_story_markup_key(raw_marker_name)
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
        bare_speaker_name = _resolve_story_bare_speaker_marker_name(raw_marker_name, raw_speaker, marker_key=marker_key)
        if not bare_speaker_name:
            return None
        if _is_story_markup_body_likely_narrative(text_value, bare_speaker_name):
            return {
                "kind": "narration",
                "text": text_value,
            }
        return {
            "kind": "speech",
            "speaker": bare_speaker_name,
            "text": text_value,
        }
    if not isinstance(raw_speaker, str):
        return None

    speaker_name = _normalize_story_markup_speaker_name(raw_speaker)
    if not speaker_name:
        return None

    return {
        "kind": "thought" if marker_key in STORY_THOUGHT_MARKER_KEYS else "speech",
        "speaker": speaker_name,
        "text": text_value,
    }


def _parse_story_plain_speaker_line_paragraph(paragraph: str) -> dict[str, str] | None:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return None

    speaker_match = STORY_PLAIN_SPEAKER_LINE_PATTERN.match(paragraph_value)
    if speaker_match is None:
        return None

    speaker_name = _normalize_story_markup_speaker_name(speaker_match.group(1))
    if not speaker_name:
        return None

    text_value = speaker_match.group(3).strip()
    if not text_value:
        return None

    speaker_marker_key = _normalize_story_markup_key(speaker_name)
    if speaker_marker_key in STORY_NARRATION_MARKER_KEYS:
        return {
            "kind": "narration",
            "text": text_value,
        }

    if _is_story_markup_body_likely_narrative(text_value, speaker_name):
        return None

    return {
        "kind": "thought" if isinstance(speaker_match.group(2), str) and speaker_match.group(2).strip() else "speech",
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

    raw_marker_name = marker_match.group(1)
    marker_key = _normalize_story_markup_key(raw_marker_name)
    marker_token = _canonical_story_marker_token(marker_key)

    raw_speaker = marker_match.group(2)
    text_value = marker_match.group(3).strip()
    if not text_value:
        return None

    if marker_token is None:
        bare_speaker_name = _resolve_story_bare_speaker_marker_name(raw_marker_name, raw_speaker, marker_key=marker_key)
        if not bare_speaker_name:
            return None
        if _is_story_markup_body_likely_narrative(text_value, bare_speaker_name):
            return text_value
        return f"[[NPC:{bare_speaker_name}]] {text_value}"

    if marker_token == "NARRATOR":
        return text_value

    if not isinstance(raw_speaker, str):
        return None
    speaker_name = _normalize_story_markup_speaker_name(raw_speaker)
    if not speaker_name:
        return None
    return f"[[{marker_token}:{speaker_name}]] {text_value}"


def _canonicalize_story_markup_markers(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    canonical_paragraphs: list[str] = []
    for paragraph in paragraphs:
        coerced_paragraph = _coerce_story_markup_paragraph(paragraph)
        if coerced_paragraph is not None:
            coerced_value = coerced_paragraph.strip()
            if coerced_value and ("[[" not in coerced_value or _parse_story_markup_paragraph(coerced_value) is not None):
                canonical_paragraphs.append(coerced_value)
                continue
        canonical_paragraphs.append(paragraph)

    return "\n\n".join(canonical_paragraphs).strip()


def _normalize_story_output_markup_paragraphs(text_value: str) -> str:
    normalized_text = _split_story_inline_markup_paragraphs(_merge_story_orphan_markup_paragraphs(text_value))
    if not normalized_text:
        return normalized_text

    normalized_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue

        parsed = _parse_story_markup_paragraph(paragraph_value)
        coerced_paragraph = None if parsed is not None else _coerce_story_markup_paragraph(paragraph_value)
        if parsed is None and coerced_paragraph is not None:
            coerced_value = coerced_paragraph.strip()
            if coerced_value:
                if "[[" not in coerced_value:
                    normalized_paragraphs.append(coerced_value)
                    continue
                parsed = _parse_story_markup_paragraph(coerced_value)
                if parsed is not None:
                    paragraph_value = coerced_value

        if parsed is None:
            plain_speaker_parsed = _parse_story_plain_speaker_line_paragraph(paragraph_value)
            if plain_speaker_parsed is not None:
                paragraph_text = str(plain_speaker_parsed.get("text", "")).strip()
                if plain_speaker_parsed.get("kind") == "narration":
                    if paragraph_text:
                        normalized_paragraphs.append(paragraph_text)
                        continue
                speaker_name = str(plain_speaker_parsed.get("speaker", "")).strip()
                if paragraph_text and speaker_name:
                    marker_token = "NPC_THOUGHT" if plain_speaker_parsed.get("kind") == "thought" else "NPC"
                    normalized_paragraphs.append(f"[[{marker_token}:{speaker_name}]] {paragraph_text}")
                    continue
            normalized_paragraphs.append(paragraph_value)
            continue

        paragraph_text = str(parsed.get("text", "")).strip()
        if not paragraph_text:
            continue
        if parsed.get("kind") == "narration":
            normalized_paragraphs.append(paragraph_text)
            continue
        normalized_paragraphs.append(paragraph_value)

    return "\n\n".join(normalized_paragraphs).strip()


def _split_story_paragraph_by_inline_markup(paragraph: str) -> list[str]:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return []

    matches = list(STORY_MARKUP_INLINE_SPLIT_PATTERN.finditer(paragraph_value))
    if not matches:
        return [paragraph_value]

    chunks: list[str] = []
    leading_text = paragraph_value[: matches[0].start()].strip()
    if leading_text:
        chunks.append(leading_text)

    for index, match in enumerate(matches):
        marker_token = match.group(0).strip()
        segment_start = match.end()
        segment_end = matches[index + 1].start() if index + 1 < len(matches) else len(paragraph_value)
        segment_text = paragraph_value[segment_start:segment_end].strip()
        if segment_text:
            chunks.append(f"{marker_token} {segment_text}".strip())
            continue
        chunks.append(marker_token)

    return chunks


def _is_story_sentence_likely_narrative_followup(sentence: str) -> bool:
    normalized_sentence = re.sub(r"\s+", " ", str(sentence or "")).strip()
    if not normalized_sentence:
        return False
    if re.match(r"^[\"'\u00ab\u00bb\u201e\u201c\u201d]", normalized_sentence):
        return False
    if re.match(r"^(?:\u2014|-)\s*\S", normalized_sentence):
        return False
    if re.match(
        r"^(?:я|меня|мне|мной|мы|нас|нам|наш|наша|наше|наши|ты|тебя|тебе|тобой|вы|вас|вам|вами|ваш|ваша|ваше|ваши|i|me|my|mine|we|us|our|ours|you|your|yours)\b",
        normalized_sentence,
        flags=re.IGNORECASE,
    ):
        return False
    if re.match(r"^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]*)?\s*,", normalized_sentence):
        return False
    return bool(
        re.match(
            r"^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]*)?\s+[a-zа-яё-]+",
            normalized_sentence,
        )
    )


def _split_story_paragraph_by_inline_plain_speaker_lines(paragraph: str) -> list[str]:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return []
    if "[[" in paragraph_value:
        return [paragraph_value]

    sentences = _split_story_text_into_sentences(paragraph_value)
    if len(sentences) <= 1:
        return [paragraph_value]

    chunks: list[str] = []
    pending_narrative: list[str] = []
    pending_dialogue: list[str] = []
    saw_dialogue = False

    def _flush_narrative() -> None:
        if pending_narrative:
            chunks.append(" ".join(pending_narrative).strip())
            pending_narrative.clear()

    def _flush_dialogue() -> None:
        if pending_dialogue:
            chunks.append(" ".join(pending_dialogue).strip())
            pending_dialogue.clear()

    for sentence in sentences:
        plain_speaker_parsed = _parse_story_plain_speaker_line_paragraph(sentence)
        if plain_speaker_parsed is not None and plain_speaker_parsed.get("kind") != "narration":
            _flush_narrative()
            _flush_dialogue()
            pending_dialogue.append(sentence)
            saw_dialogue = True
            continue

        if pending_dialogue:
            if _is_story_sentence_likely_narrative_followup(sentence):
                _flush_dialogue()
                pending_narrative.append(sentence)
            else:
                pending_dialogue.append(sentence)
            continue

        pending_narrative.append(sentence)

    _flush_dialogue()
    _flush_narrative()

    normalized_chunks = [chunk for chunk in chunks if chunk.strip()]
    if not saw_dialogue or not normalized_chunks:
        return [paragraph_value]
    return normalized_chunks


def _split_story_inline_markup_paragraphs(text_value: str) -> str:
    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    normalized_paragraphs: list[str] = []
    for paragraph in paragraphs:
        for chunk in _split_story_paragraph_by_inline_markup(paragraph):
            normalized_paragraphs.extend(_split_story_paragraph_by_inline_plain_speaker_lines(chunk))
    return "\n\n".join(paragraph for paragraph in normalized_paragraphs if paragraph.strip())


STORY_DIRECT_SPEECH_QUOTE_PATTERN = re.compile(r"[\"'«»“”]")
STORY_DIRECT_SPEECH_PERSON_PATTERN = re.compile(
    r"\b(?:я|мне|меня|мной|мы|нас|нам|нами|мой|моя|мои|мое|ты|тебя|тебе|тобой|вы|вас|вам|вами|ваш|ваша|ваши|ваше|i|me|my|mine|we|us|our|ours|you|your|yours)\b",
    re.IGNORECASE,
)
STORY_DIRECT_SPEECH_LEADING_TOKENS = {
    "о",
    "эй",
    "слушай",
    "послушай",
    "ну",
    "нет",
    "да",
    "ладно",
    "please",
    "hey",
}
STORY_DIRECT_SPEECH_NEGATION_TOKENS = {
    "не",
    "don't",
    "dont",
}


def _is_story_sentence_likely_unmarked_dialogue(sentence: str) -> bool:
    compact = re.sub(r"\s+", " ", str(sentence or "")).strip()
    if not compact:
        return False
    if _parse_story_plain_speaker_line_paragraph(compact) is not None:
        return True
    if _is_story_dialogue_like_fragment(compact):
        return True
    if STORY_DIRECT_SPEECH_QUOTE_PATTERN.search(compact):
        return True

    stripped = compact.lstrip("—-\"'«»“” ").strip()
    if not stripped or _is_story_sentence_likely_narrative_followup(stripped):
        return False

    words = re.findall(r"[A-Za-zА-Яа-яЁё'-]+", stripped)
    if not words:
        return False

    candidate_index = 0
    lowered_words = [word.casefold() for word in words[:4]]
    while candidate_index < len(lowered_words) and lowered_words[candidate_index] in STORY_DIRECT_SPEECH_LEADING_TOKENS:
        candidate_index += 1
    if candidate_index < len(lowered_words) and lowered_words[candidate_index] in STORY_DIRECT_SPEECH_NEGATION_TOKENS:
        candidate_index += 1

    if candidate_index < len(words):
        imperative_candidate = words[candidate_index].casefold()
        if re.fullmatch(r"[a-zа-яё-]+(?:й|йте)", imperative_candidate):
            return True

    expressive_sentence = any(char in stripped for char in "!?")
    if expressive_sentence and STORY_DIRECT_SPEECH_PERSON_PATTERN.search(stripped):
        return True

    return False


def _story_paragraph_has_unformatted_dialogue(paragraph: str) -> bool:
    paragraph_value = paragraph.strip()
    if not paragraph_value:
        return False
    if _parse_story_markup_paragraph(paragraph_value) is not None:
        return False
    if _parse_story_plain_speaker_line_paragraph(paragraph_value) is not None:
        return True
    if _is_story_dialogue_like_fragment(paragraph_value):
        return True

    sentences = _split_story_text_into_sentences(paragraph_value)
    if not sentences:
        return False
    return any(_is_story_sentence_likely_unmarked_dialogue(sentence) for sentence in sentences)


def _is_story_strict_markup_output(text_value: str) -> bool:
    normalized_text = _split_story_inline_markup_paragraphs(_merge_story_orphan_markup_paragraphs(text_value))
    if not normalized_text:
        return True

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return True
    for paragraph in paragraphs:
        if _parse_story_markup_paragraph(paragraph) is not None:
            continue
        if "[[" not in paragraph:
            continue
        coerced_paragraph = _coerce_story_markup_paragraph(paragraph)
        if coerced_paragraph is None:
            if _story_paragraph_has_unformatted_dialogue(paragraph):
                return False
            continue
        coerced_value = coerced_paragraph.strip()
        if not coerced_value:
            return False
        if "[[" in coerced_value and _parse_story_markup_paragraph(coerced_value) is None:
            return False
        if "[[" not in coerced_value and _story_paragraph_has_unformatted_dialogue(coerced_value):
            return False
    return True


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
            if STORY_MARKUP_START_PATTERN.match(first_line) is None:
                merged_paragraphs.append(f"{pending_marker} {' '.join(lines)}".strip())
                pending_marker = ""
                continue
            pending_marker = ""

        if STORY_MARKUP_STANDALONE_PATTERN.match(first_line) is not None:
            if len(lines) == 1:
                pending_marker = first_line
                continue
            trailing_text = " ".join(lines[1:]).strip()
            if not trailing_text:
                pending_marker = first_line
                continue
            if STORY_MARKUP_START_PATTERN.match(trailing_text) is not None:
                merged_paragraphs.append(trailing_text)
                continue
            merged_paragraphs.append(f"{first_line} {trailing_text}".strip())
            continue

        merged_paragraphs.append("\n".join(lines))

    return "\n\n".join(paragraph for paragraph in merged_paragraphs if paragraph.strip())


def _prefix_story_narrator_markup(text_value: str) -> str:
    return _normalize_story_output_markup_paragraphs(text_value)


def _strip_story_markup_for_memory_text(text_value: str) -> str:
    normalized_text = _split_story_inline_markup_paragraphs(_merge_story_orphan_markup_paragraphs(text_value))
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
            if coerced_paragraph is not None and "[[" not in coerced_paragraph:
                normalized_paragraphs.append(coerced_paragraph.strip())
                continue
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
                "Нарративные абзацы оставляй обычным текстом без маркера. "
                "Если в абзаце есть прямая речь или внутренняя мысль, ставь ровно один маркер в самом начале и пробел после него. "
                "Разрешенные маркеры: [[NPC:Имя]], [[GG:Имя]], [[NPC_THOUGHT:Имя]], [[GG_THOUGHT:Имя]]. "
                "Не помечай абзац репликой, если персонаж в нем ничего не говорит вслух и не думает. "
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
    *,
    model_name: str | None = None,
) -> str:
    if not settings.openrouter_api_key:
        return ""

    repair_model_name = _normalize_story_model_id(model_name)
    if not repair_model_name:
        return ""

    repair_messages = _build_story_markup_repair_messages(text_value, world_cards)
    estimated_response_tokens = max(min(_estimate_story_tokens(text_value) + 220, 1_400), 320)
    repaired_text = _request_openrouter_story_text(
        repair_messages,
        model_name=repair_model_name,
        allow_free_fallback=False,
        translate_input=False,
        fallback_model_names=[],
        temperature=0.0,
        max_tokens=estimated_response_tokens,
        request_timeout=(
            STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
            STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
        ),
    )
    return repaired_text.replace("\r\n", "\n").strip()


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


def _resolve_story_thought_owner(marker_key: str) -> str | None:
    compact_key = marker_key.replace("_", "")
    if compact_key in {"ggthought", "ggthink"}:
        return "gg"
    if compact_key in {"npcthought", "npcthink", "thought", "think"}:
        return "npc"
    return None


def _filter_story_disabled_thought_paragraphs(
    text_value: str,
    *,
    show_gg_thoughts: bool,
    show_npc_thoughts: bool,
) -> str:
    if show_gg_thoughts and show_npc_thoughts:
        return text_value

    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    filtered_paragraphs: list[str] = []
    for paragraph in paragraphs:
        marker_match = STORY_MARKUP_PARAGRAPH_PATTERN.match(paragraph)
        if marker_match is None:
            filtered_paragraphs.append(paragraph)
            continue

        marker_key = _normalize_story_markup_key(marker_match.group(1))
        thought_owner = _resolve_story_thought_owner(marker_key)
        if thought_owner == "gg" and not show_gg_thoughts:
            continue
        if thought_owner == "npc" and not show_npc_thoughts:
            continue
        filtered_paragraphs.append(paragraph)

    return "\n\n".join(filtered_paragraphs).strip()


def _is_story_no_gg_roleplay_model(model_name: str | None) -> bool:
    normalized_model_name = _normalize_story_model_id(model_name)
    return bool(normalized_model_name and normalized_model_name in STORY_NO_GG_ROLEPLAY_MODEL_IDS)


def _filter_story_gg_roleplay_paragraphs(
    text_value: str,
    *,
    model_name: str | None,
) -> str:
    if not _is_story_no_gg_roleplay_model(model_name):
        return text_value

    normalized_text = text_value.replace("\r\n", "\n").strip()
    if not normalized_text:
        return normalized_text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", normalized_text) if paragraph.strip()]
    if not paragraphs:
        return normalized_text

    filtered_paragraphs: list[str] = []
    forbidden_marker_keys = {"gg", "mc", "player", "mainhero", "maincharacter", "ggthought", "ggthink"}
    for paragraph in paragraphs:
        marker_match = STORY_MARKUP_PARAGRAPH_PATTERN.match(paragraph)
        if marker_match is None:
            filtered_paragraphs.append(paragraph)
            continue

        marker_key = _normalize_story_markup_key(marker_match.group(1))
        compact_key = marker_key.replace("_", "")
        if compact_key in forbidden_marker_keys:
            continue
        filtered_paragraphs.append(paragraph)

    filtered_text = "\n\n".join(filtered_paragraphs).strip()
    if filtered_text:
        return filtered_text
    return "Мир замирает в напряжении и ждет твоего следующего хода."


def _normalize_generated_story_output(
    *,
    text_value: str,
    world_cards: list[dict[str, Any]],
    model_name: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
) -> str:
    normalized_text = _split_story_inline_markup_paragraphs(_merge_story_orphan_markup_paragraphs(text_value))
    normalized_text = _canonicalize_story_markup_markers(normalized_text)
    normalized_text = _normalize_story_output_markup_paragraphs(normalized_text)
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
        strict_output = _enforce_story_output_language(normalized_text, model_name=model_name)
        strict_output = _normalize_story_output_markup_paragraphs(strict_output)
        strict_output = _align_story_markup_speaker_names_to_world_cards(strict_output, world_cards)
        strict_output = _filter_story_gg_roleplay_paragraphs(strict_output, model_name=model_name)
        return _filter_story_disabled_thought_paragraphs(
            strict_output,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )

    repaired_text = ""
    if settings.openrouter_api_key:
        try:
            repaired_text = _repair_story_markup_with_openrouter(
                normalized_text,
                world_cards,
                model_name=model_name,
            )
        except Exception as exc:
            logger.warning("Story markup normalization failed: %s", exc)

    repaired_normalized = _split_story_inline_markup_paragraphs(repaired_text.replace("\r\n", "\n").strip())
    repaired_normalized = _normalize_story_output_markup_paragraphs(repaired_normalized)
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
        repaired_output = _enforce_story_output_language(repaired_normalized, model_name=model_name)
        repaired_output = _normalize_story_output_markup_paragraphs(repaired_output)
        repaired_output = _align_story_markup_speaker_names_to_world_cards(repaired_output, world_cards)
        repaired_output = _filter_story_gg_roleplay_paragraphs(repaired_output, model_name=model_name)
        return _filter_story_disabled_thought_paragraphs(
            repaired_output,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )

    fallback_output = _enforce_story_output_language(
        _normalize_story_output_markup_paragraphs(normalized_text),
        model_name=model_name,
    )
    fallback_output = _normalize_story_output_markup_paragraphs(fallback_output)
    fallback_output = _align_story_markup_speaker_names_to_world_cards(fallback_output, world_cards)
    fallback_output = _filter_story_gg_roleplay_paragraphs(fallback_output, model_name=model_name)
    return _filter_story_disabled_thought_paragraphs(
        fallback_output,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )


def _effective_story_llm_provider() -> str:
    provider = settings.story_llm_provider.strip().lower()
    if provider != "mock":
        return provider

    if settings.openrouter_api_key and settings.openrouter_chat_url:
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
        if not settings.openrouter_chat_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenRouter provider is not configured: set OPENROUTER_CHAT_URL",
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


def _yield_story_stream_chunks_with_pacing(text_value: str, chunk_size: int = 24):
    chunks = _iter_story_stream_chunks(text_value, chunk_size=chunk_size)
    if not chunks:
        return
    delay_seconds = max(float(STORY_STREAM_COALESCED_CHUNK_DELAY_SECONDS), 0.0)
    has_multiple_chunks = len(chunks) > 1
    for index, chunk in enumerate(chunks):
        yield chunk
        if delay_seconds > 0 and has_multiple_chunks and index < len(chunks) - 1:
            time.sleep(delay_seconds)


def _normalize_story_language_code(value: str | None, *, fallback: str = "") -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return fallback
    normalized = normalized.replace(" ", "")
    normalized = normalized.split("-", 1)[0]
    normalized = normalized.split("_", 1)[0]
    if normalized in {"ru", "rus", "russian"}:
        return "ru"
    if normalized in {"en", "eng", "english"}:
        return "en"
    return normalized or fallback


def _story_user_language_code() -> str:
    return _normalize_story_language_code(settings.story_user_language, fallback="ru")


def _story_model_language_code() -> str:
    return _normalize_story_language_code(settings.story_model_language, fallback="en")


def _is_story_input_translation_enabled() -> bool:
    user_language = _story_user_language_code()
    model_language = _story_model_language_code()
    return (
        settings.story_translation_enabled
        and bool(settings.openrouter_api_key)
        and bool(_story_output_translation_model_name())
        and user_language != model_language
    )


def _is_story_output_translation_enabled() -> bool:
    return False


def _is_story_translation_enabled() -> bool:
    return _is_story_input_translation_enabled()


def _story_output_translation_model_name(model_name: str | None = None) -> str:
    normalized_story_model = _normalize_story_model_id(model_name)
    forced_translation_model = STORY_FORCED_OUTPUT_TRANSLATION_MODEL_BY_STORY_MODEL.get(normalized_story_model)
    if forced_translation_model:
        return forced_translation_model

    preferred_model = STORY_OUTPUT_TRANSLATION_MODEL.strip()
    if preferred_model:
        return preferred_model
    return settings.openrouter_translation_model.strip()


def _normalize_story_model_id(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    return STORY_LEGACY_MODEL_ALIASES.get(normalized, normalized)


def _is_story_output_translation_model(model_name: str | None) -> bool:
    normalized_model = _normalize_story_model_id(model_name)
    return bool(normalized_model and normalized_model in STORY_OPENROUTER_TRANSLATION_FORCE_MODEL_IDS)


def _can_force_story_output_translation(model_name: str | None = None) -> bool:
    return (
        bool(settings.openrouter_api_key)
        and bool(_story_output_translation_model_name(model_name))
        and bool(_story_user_language_code())
    )


def _should_force_openrouter_story_output_translation(model_name: str | None) -> bool:
    return _story_user_language_code() == "ru" and _can_force_story_output_translation(model_name)


def _build_openrouter_provider_payload(model_name: str | None) -> dict[str, Any] | None:
    normalized_model = _normalize_story_model_id(model_name)
    if not normalized_model:
        return None

    pinned_provider = STORY_OPENROUTER_PROVIDER_PINNED_BY_MODEL.get(normalized_model)
    if not pinned_provider:
        return None

    return {
        "order": [pinned_provider],
        "allow_fallbacks": False,
    }


def _build_openrouter_image_provider_payload(model_name: str | None) -> dict[str, Any]:
    provider_payload = dict(_build_openrouter_provider_payload(model_name) or {})
    provider_payload["require_parameters"] = True
    return provider_payload


def _can_apply_story_sampling_to_model(model_name: str | None) -> bool:
    normalized_model = _normalize_story_model_id(model_name)
    if not normalized_model:
        return False
    return all(model_hint not in normalized_model for model_hint in STORY_NON_SAMPLING_MODEL_HINTS)


def _is_story_paid_model(model_name: str | None) -> bool:
    normalized_model = _normalize_story_model_id(model_name)
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
    return normalized_limit


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


def _select_story_temperature_value(
    *,
    model_name: str | None,
    story_temperature: float,
) -> float | None:
    if not _can_apply_story_sampling_to_model(model_name):
        return None
    if not math.isfinite(story_temperature):
        return None
    clamped_value = max(0.0, min(2.0, float(story_temperature)))
    return round(clamped_value, 2)


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
    translation_model_name: str | None = None,
) -> list[str]:
    if not texts:
        return []
    selected_translation_model = (translation_model_name or _story_output_translation_model_name()).strip()
    if not selected_translation_model:
        raise RuntimeError("OpenRouter translation model is not configured")

    translation_messages = [
        {
            "role": "system",
            "content": (
                "You are a precise translator. "
                "Translate each input text to the target language while preserving meaning, tone, line breaks, and markup. "
                "Never alter, translate, remove, or reorder any [[...]] markers. "
                "Marker content inside [[...]] must remain exactly unchanged. "
                "Do not translate or transliterate proper names, character names, card titles, or world-defined terms when they act as identifiers; keep their original spelling. "
                "If the target language is Russian, output only natural Russian text with correct spelling, grammar, punctuation, morphology, and style. "
                "If the target language is Russian, remove any accidental English or CJK leakage unless it is an explicitly fixed identifier that must stay unchanged. "
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
    source_tokens_estimate = sum(max(_estimate_story_tokens(text_value), 1) for text_value in texts)
    translation_max_tokens = max(256, min(source_tokens_estimate * 2 + 256, 3_200))
    raw_response = _request_openrouter_story_text(
        translation_messages,
        model_name=selected_translation_model,
        allow_free_fallback=False,
        translate_input=False,
        temperature=0,
        max_tokens=translation_max_tokens,
        request_timeout=(
            STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS,
            max(STORY_POSTPROCESS_READ_TIMEOUT_SECONDS, 30),
        ),
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
    if not _is_story_input_translation_enabled():
        return messages_payload

    source_language = "auto"
    target_language = _story_model_language_code()
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


def _prepare_story_messages_for_model(
    messages_payload: list[dict[str, str]],
    *,
    translate_input: bool = True,
) -> list[dict[str, str]]:
    if not translate_input:
        return messages_payload
    try:
        return _translate_story_messages_for_model(messages_payload)
    except Exception as exc:
        logger.warning("Story input translation failed: %s", exc)
        return messages_payload


def _translate_story_model_output_to_user(text_value: str) -> str:
    if not text_value.strip():
        return text_value
    if not _is_story_output_translation_enabled():
        return text_value
    source_language = "auto"
    target_language = _story_user_language_code()
    translated = _translate_texts_with_openrouter(
        [text_value],
        source_language=source_language,
        target_language=target_language,
    )
    return translated[0] if translated else text_value


def _force_translate_story_model_output_to_user(
    text_value: str,
    *,
    source_model_name: str | None = None,
) -> str:
    if not text_value.strip():
        return text_value
    if not _can_force_story_output_translation(source_model_name):
        return text_value
    target_language = "ru" if _is_story_output_translation_model(source_model_name) else _story_user_language_code()
    translated = _translate_text_batch_with_openrouter(
        [text_value],
        source_language="auto",
        target_language=target_language,
        translation_model_name=_story_output_translation_model_name(source_model_name),
    )
    return translated[0] if translated else text_value


def _split_story_translation_stream_buffer(
    buffer: str,
    *,
    force: bool = False,
) -> tuple[str, str]:
    if not buffer:
        return ("", "")

    min_chars = max(int(STORY_STREAM_TRANSLATION_MIN_CHARS), 1)
    max_chars = max(int(STORY_STREAM_TRANSLATION_MAX_CHARS), min_chars)
    if not force and len(buffer) < min_chars:
        return ("", buffer)

    search_limit = min(len(buffer), max_chars)
    cut_index = -1
    for index in range(search_limit - 1, -1, -1):
        if buffer[index] in {".", "!", "?", "…", "\n"}:
            cut_index = index + 1
            break

    if cut_index < min_chars:
        if not force and len(buffer) <= max_chars:
            return ("", buffer)
        cut_index = search_limit
        if cut_index < len(buffer):
            whitespace_index = buffer.rfind(" ", min_chars, cut_index)
            if whitespace_index >= min_chars:
                cut_index = whitespace_index + 1

    if cut_index <= 0:
        return ("", buffer)

    return (buffer[:cut_index], buffer[cut_index:])


def _translate_story_stream_output_chunk(
    text_value: str,
    *,
    source_model_name: str | None = None,
    force_output_translation: bool = False,
) -> str:
    if not text_value:
        return text_value
    should_apply_russian_contract = _story_user_language_code() == "ru"
    try:
        if force_output_translation and not _is_story_output_translation_enabled():
            translated = _force_translate_story_model_output_to_user(
                text_value,
                source_model_name=source_model_name,
            )
            if should_apply_russian_contract:
                translated = _sanitize_story_russian_output_contract(translated)
            return translated
        translated = _translate_story_model_output_to_user(text_value)
        if should_apply_russian_contract:
            translated = _sanitize_story_russian_output_contract(translated)
        return translated
    except Exception as exc:
        logger.warning("Story output streaming translation failed: %s", exc)
        if should_apply_russian_contract:
            fallback = _sanitize_story_russian_output_contract(text_value)
            if fallback:
                return fallback
        return text_value


def _yield_story_translated_stream_chunks(
    raw_chunks: Any,
    *,
    source_model_name: str | None = None,
    force_output_translation: bool = False,
    raw_output_collector: dict[str, str] | None = None,
):
    raw_chunks_collected: list[str] = []
    pending_buffer = ""

    for raw_chunk in raw_chunks:
        if not isinstance(raw_chunk, str):
            continue
        raw_chunks_collected.append(raw_chunk)
        if not raw_chunk:
            continue

        pending_buffer += raw_chunk
        while pending_buffer:
            segment, remainder = _split_story_translation_stream_buffer(
                pending_buffer,
                force=False,
            )
            if not segment:
                break
            pending_buffer = remainder
            translated_segment = _translate_story_stream_output_chunk(
                segment,
                source_model_name=source_model_name,
                force_output_translation=force_output_translation,
            )
            if not translated_segment:
                continue
            for chunk in _yield_story_stream_chunks_with_pacing(translated_segment):
                yield chunk

    while pending_buffer:
        segment, remainder = _split_story_translation_stream_buffer(
            pending_buffer,
            force=True,
        )
        if not segment:
            segment, remainder = pending_buffer, ""
        pending_buffer = remainder
        translated_segment = _translate_story_stream_output_chunk(
            segment,
            source_model_name=source_model_name,
            force_output_translation=force_output_translation,
        )
        if not translated_segment:
            continue
        for chunk in _yield_story_stream_chunks_with_pacing(translated_segment):
            yield chunk

    if raw_output_collector is not None:
        raw_output_collector["raw_output"] = "".join(raw_chunks_collected)


def _strip_story_markup_for_language_detection(text_value: str) -> str:
    normalized = text_value.replace("\r\n", "\n")
    return STORY_MARKUP_MARKER_PATTERN.sub(" ", normalized)


def _should_force_story_output_to_russian(text_value: str, *, model_name: str | None = None) -> bool:
    if _story_user_language_code() != "ru":
        return False
    if not _can_force_story_output_translation(model_name):
        return False

    stripped = _strip_story_markup_for_language_detection(text_value).strip()
    if not stripped:
        return False
    if STORY_CJK_CHARACTER_PATTERN.search(stripped):
        return True

    cyrillic_letters = len(STORY_CYRILLIC_LETTER_PATTERN.findall(stripped))
    latin_letters = len(STORY_LATIN_LETTER_PATTERN.findall(stripped))
    latin_words = len(STORY_LATIN_WORD_PATTERN.findall(stripped))

    if cyrillic_letters == 0 and latin_letters >= 2:
        return True
    if latin_words >= 1:
        return True
    if latin_letters >= 2 and cyrillic_letters == 0:
        return True
    if latin_letters >= 2 and latin_letters > cyrillic_letters * 0.03:
        return True
    if latin_letters >= 1 and latin_letters > max(cyrillic_letters, 1) * 0.12:
        return True
    return False


def _sanitize_story_russian_output_segment(text_value: str) -> str:
    normalized = text_value.replace("\r\n", "\n")
    if not normalized:
        return normalized

    cleaned = STORY_CJK_CHARACTER_PATTERN.sub(" ", normalized)
    cleaned = cleaned.translate(STORY_LATIN_TO_CYRILLIC_LOOKALIKE_TABLE)
    cleaned = re.sub(r"\b[A-Za-z][A-Za-z0-9'-]{0,48}\b", " ", cleaned)
    cleaned = re.sub(r"[A-Za-z]+", " ", cleaned)
    cleaned = STORY_NON_RUSSIAN_SYMBOL_PATTERN.sub(" ", cleaned)
    cleaned = re.sub(r"([.,!?;:])(?![\s\n»”\"')\]])", r"\1 ", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _sanitize_story_russian_output_contract(text_value: str) -> str:
    normalized = text_value.replace("\r\n", "\n").strip()
    if not normalized:
        return normalized

    fragments: list[str] = []
    cursor = 0
    for marker_match in STORY_MARKUP_MARKER_PATTERN.finditer(normalized):
        marker_start, marker_end = marker_match.span()
        if marker_start > cursor:
            fragments.append(_sanitize_story_russian_output_segment(normalized[cursor:marker_start]))
        fragments.append(marker_match.group(0))
        cursor = marker_end

    if cursor < len(normalized):
        fragments.append(_sanitize_story_russian_output_segment(normalized[cursor:]))

    sanitized = "".join(fragments).strip()
    if not sanitized:
        return normalized
    sanitized = re.sub(r"[ \t]+\n", "\n", sanitized)
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    return sanitized.strip()


def _enforce_story_output_language(text_value: str, *, model_name: str | None = None) -> str:
    normalized = text_value.replace("\r\n", "\n").strip()
    _ = model_name
    return normalized


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

    # When plot-memory optimization is enabled, do not send dialogue history.
    # Keep only the latest user turn, except turn 1 where opening scene context
    # (seeded as the first assistant message) must be preserved.
    latest_user_index: int | None = None
    latest_user_content = ""
    user_turn_count = 0
    for index, item in enumerate(history):
        role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
        content = str(item.get("content", "")).strip()
        if role != STORY_USER_ROLE or not content:
            continue
        user_turn_count += 1
        latest_user_index = index
        latest_user_content = content

    if latest_user_index is None:
        return []

    latest_user_turn = {"role": STORY_USER_ROLE, "content": latest_user_content}

    # Ensure the opening scene is present for the very first user turn.
    # Runtime seeds opening_scene as the first assistant message before turn 1.
    if user_turn_count == 1:
        for item in reversed(history[:latest_user_index]):
            role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            content = str(item.get("content", "")).strip()
            if role != STORY_ASSISTANT_ROLE or not content:
                continue
            return [
                {"role": STORY_ASSISTANT_ROLE, "content": content},
                latest_user_turn,
            ]

    return [latest_user_turn]


def _build_story_provider_messages(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    use_plot_memory: bool = False,
    context_limit_tokens: int,
    response_max_tokens: int | None = None,
    translate_for_model: bool = False,
    model_name: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
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
    selected_history = _select_story_history_source(
        full_history,
        use_plot_memory=use_plot_memory,
    )
    reserved_history_tokens = _estimate_story_history_tokens(selected_history)
    plot_cards_for_prompt = _fit_story_plot_cards_to_context_limit(
        instruction_cards=instruction_cards,
        plot_cards=plot_cards,
        world_cards=world_cards,
        context_limit_tokens=effective_context_limit_tokens,
        reserved_history_tokens=reserved_history_tokens,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    history = selected_history
    if instruction_cards:
        included_instruction_cards = [
            card
            for card in instruction_cards
            if str(card.get("title", "")).strip() and str(card.get("content", "")).strip()
        ]
        logger.info(
            "Story instruction cards included in prompt: input=%s included=%s context_limit=%s",
            len(instruction_cards),
            len(included_instruction_cards),
            effective_context_limit_tokens,
        )

    system_prompt = _build_story_system_prompt(
        instruction_cards,
        plot_cards_for_prompt,
        world_cards,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )
    system_prompt_tokens = _estimate_story_tokens(system_prompt)
    history_budget_tokens = max(effective_context_limit_tokens - system_prompt_tokens, 0)
    history = _trim_story_history_to_context_limit(history, history_budget_tokens)

    # Large system prompts (for example, with many cards + model-specific rules)
    # can consume the whole budget. Keep at least one recent user turn so OpenRouter
    # always receives actionable dialogue context.
    if not history and full_history:
        fallback_history_item: dict[str, str] | None = None
        for item in reversed(full_history):
            role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            content = str(item.get("content", "")).strip()
            if role == STORY_USER_ROLE and content:
                fallback_history_item = {"role": role, "content": content}
                break
        if fallback_history_item is None:
            fallback_source = full_history[-1]
            fallback_role = str(fallback_source.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            fallback_content = str(fallback_source.get("content", "")).strip()
            if fallback_content:
                fallback_history_item = {"role": fallback_role, "content": fallback_content}

        if fallback_history_item is not None:
            fallback_budget_tokens = max(min(effective_context_limit_tokens // 6, 240), 48)
            history = [
                {
                    "role": fallback_history_item["role"],
                    "content": _trim_story_text_tail_by_tokens(
                        fallback_history_item["content"],
                        fallback_budget_tokens,
                    ),
                }
            ]

    messages_payload = [{"role": "system", "content": system_prompt}, *history]
    if not translate_for_model:
        return messages_payload

    return _prepare_story_messages_for_model(messages_payload)


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


def _clamp_story_ambient_value(
    raw_value: Any,
    *,
    minimum: float,
    maximum: float,
    fallback: float,
) -> float:
    try:
        numeric_value = float(raw_value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(numeric_value):
        return fallback
    return max(minimum, min(maximum, numeric_value))


def _normalize_story_ambient_hex_color(raw_value: Any, *, fallback: str) -> str:
    if not isinstance(raw_value, str):
        return fallback
    normalized = raw_value.strip().lower()
    if not normalized or not STORY_AMBIENT_HEX_COLOR_PATTERN.fullmatch(normalized):
        return fallback
    color_value = normalized[1:] if normalized.startswith("#") else normalized
    if len(color_value) == 3:
        color_value = "".join(char * 2 for char in color_value)
    return f"#{color_value}"


def _normalize_story_ambient_profile_payload(
    raw_payload: dict[str, Any] | None,
    *,
    fallback_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    default_profile = fallback_profile if isinstance(fallback_profile, dict) else STORY_AMBIENT_DEFAULT_PROFILE

    scene_value = ""
    lighting_value = ""
    if isinstance(raw_payload, dict):
        scene_value = str(raw_payload.get("scene") or "").replace("\r\n", " ").strip()
        lighting_value = str(raw_payload.get("lighting") or "").replace("\r\n", " ").strip()

    scene = re.sub(r"\s+", " ", scene_value)[:80] or str(default_profile.get("scene", "unknown"))
    lighting = re.sub(r"\s+", " ", lighting_value)[:80] or str(default_profile.get("lighting", "dim"))

    fallback_primary = str(default_profile.get("primary_color", STORY_AMBIENT_DEFAULT_PROFILE["primary_color"]))
    fallback_secondary = str(default_profile.get("secondary_color", STORY_AMBIENT_DEFAULT_PROFILE["secondary_color"]))
    fallback_highlight = str(default_profile.get("highlight_color", STORY_AMBIENT_DEFAULT_PROFILE["highlight_color"]))
    fallback_glow = float(default_profile.get("glow_strength", STORY_AMBIENT_DEFAULT_PROFILE["glow_strength"]))
    fallback_mix = float(default_profile.get("background_mix", STORY_AMBIENT_DEFAULT_PROFILE["background_mix"]))
    fallback_vignette = float(default_profile.get("vignette_strength", STORY_AMBIENT_DEFAULT_PROFILE["vignette_strength"]))

    primary_color = _normalize_story_ambient_hex_color(
        raw_payload.get("primary_color") if isinstance(raw_payload, dict) else None,
        fallback=fallback_primary,
    )
    secondary_color = _normalize_story_ambient_hex_color(
        raw_payload.get("secondary_color") if isinstance(raw_payload, dict) else None,
        fallback=fallback_secondary,
    )
    highlight_color = _normalize_story_ambient_hex_color(
        raw_payload.get("highlight_color") if isinstance(raw_payload, dict) else None,
        fallback=fallback_highlight,
    )
    glow_strength = _clamp_story_ambient_value(
        raw_payload.get("glow_strength") if isinstance(raw_payload, dict) else None,
        minimum=0.0,
        maximum=1.0,
        fallback=fallback_glow,
    )
    background_mix = _clamp_story_ambient_value(
        raw_payload.get("background_mix") if isinstance(raw_payload, dict) else None,
        minimum=0.0,
        maximum=1.0,
        fallback=fallback_mix,
    )
    vignette_strength = _clamp_story_ambient_value(
        raw_payload.get("vignette_strength") if isinstance(raw_payload, dict) else None,
        minimum=0.0,
        maximum=1.0,
        fallback=fallback_vignette,
    )

    return {
        "scene": scene,
        "lighting": lighting,
        "primary_color": primary_color,
        "secondary_color": secondary_color,
        "highlight_color": highlight_color,
        "glow_strength": round(glow_strength, 3),
        "background_mix": round(background_mix, 3),
        "vignette_strength": round(vignette_strength, 3),
    }


def _infer_story_ambient_profile_from_text(
    *,
    latest_assistant_text: str,
) -> dict[str, Any]:
    combined = latest_assistant_text.strip().casefold() if isinstance(latest_assistant_text, str) else ""
    if not combined:
        return dict(STORY_AMBIENT_DEFAULT_PROFILE)

    is_forest = any(token in combined for token in ("forest", "jungle", "\u043b\u0435\u0441", "\u0442\u0430\u0439\u0433"))
    is_night = any(token in combined for token in ("night", "moon", "\u043d\u043e\u0447", "\u043b\u0443\u043d"))
    is_sunset = any(
        token in combined
        for token in ("sunset", "dusk", "twilight", "golden hour", "\u0437\u0430\u043a\u0430\u0442", "\u0441\u0443\u043c\u0435\u0440")
    )
    is_cave = any(
        token in combined
        for token in ("cave", "underground", "dungeon", "\u043f\u0435\u0449\u0435\u0440", "\u043f\u043e\u0434\u0437\u0435\u043c")
    )
    is_fire = any(
        token in combined
        for token in ("fire", "flame", "lava", "ember", "\u043a\u043e\u0441\u0442\u0435\u0440", "\u043e\u0433\u043e\u043d", "\u043b\u0430\u0432")
    )

    if is_forest and is_night:
        return {
            "scene": "night forest",
            "lighting": "low moonlight",
            "primary_color": "#11291c",
            "secondary_color": "#0b1b14",
            "highlight_color": "#2f6f4a",
            "glow_strength": 0.24,
            "background_mix": 0.2,
            "vignette_strength": 0.44,
        }
    if is_sunset:
        return {
            "scene": "sunset",
            "lighting": "warm dusk",
            "primary_color": "#40221a",
            "secondary_color": "#2b1712",
            "highlight_color": "#e57a2c",
            "glow_strength": 0.28,
            "background_mix": 0.24,
            "vignette_strength": 0.36,
        }
    if is_fire:
        return {
            "scene": "firelight",
            "lighting": "hot contrast",
            "primary_color": "#3b1a14",
            "secondary_color": "#25110f",
            "highlight_color": "#ff6b2f",
            "glow_strength": 0.32,
            "background_mix": 0.24,
            "vignette_strength": 0.38,
        }
    if is_cave:
        return {
            "scene": "cave",
            "lighting": "low",
            "primary_color": "#1a212d",
            "secondary_color": "#101722",
            "highlight_color": "#4f6a91",
            "glow_strength": 0.19,
            "background_mix": 0.16,
            "vignette_strength": 0.46,
        }
    if is_forest:
        return {
            "scene": "forest",
            "lighting": "natural",
            "primary_color": "#1b3524",
            "secondary_color": "#12251a",
            "highlight_color": "#4f9962",
            "glow_strength": 0.23,
            "background_mix": 0.21,
            "vignette_strength": 0.33,
        }
    if is_night:
        return {
            "scene": "night",
            "lighting": "dim",
            "primary_color": "#101a2b",
            "secondary_color": "#0a111d",
            "highlight_color": "#3b5c8c",
            "glow_strength": 0.2,
            "background_mix": 0.18,
            "vignette_strength": 0.42,
        }
    return dict(STORY_AMBIENT_DEFAULT_PROFILE)


def _resolve_story_ambient_profile(
    *,
    latest_assistant_text: str,
    resolved_payload_override: dict[str, Any] | None = None,
    allow_model_request: bool = True,
) -> dict[str, Any]:
    fallback_profile = _normalize_story_ambient_profile_payload(
        _infer_story_ambient_profile_from_text(
            latest_assistant_text=latest_assistant_text,
        )
    )
    if isinstance(resolved_payload_override, dict):
        normalized_override = _normalize_story_ambient_profile_payload(
            resolved_payload_override,
            fallback_profile=fallback_profile,
        )
        if isinstance(normalized_override, dict):
            return normalized_override
        return fallback_profile
    if not allow_model_request:
        return fallback_profile
    if not settings.openrouter_api_key:
        return fallback_profile

    assistant_preview = _normalize_story_prompt_text(latest_assistant_text, max_chars=2_200)
    if not assistant_preview:
        return fallback_profile

    messages_payload = [
        {
            "role": "system",
            "content": (
                "You are an ambient color director for an interactive RPG UI. "
                "Return strict JSON only, no markdown: "
                "{\"scene\": string, \"lighting\": string, \"primary_color\": \"#RRGGBB\", "
                "\"secondary_color\": \"#RRGGBB\", \"highlight_color\": \"#RRGGBB\", "
                "\"glow_strength\": number, \"background_mix\": number, \"vignette_strength\": number}. "
                "Pick 2-3 harmonious colors from environment and surroundings only. "
                "Ignore character appearance, clothing, skin, and eye colors. "
                "Focus on background scene lighting: sky, weather, terrain, interior, effects. "
                "Do not use a generic blue palette unless the environment is actually cold/blue. "
                "Examples: forest -> green shades, night forest -> dark green with moon tint, sunset -> red/amber/yellow. "
                "All numbers must be in range 0..1."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Narrator reply:\n{assistant_preview or 'none'}\n\n"
                "Extract the ambient palette from the described environment only.\n"
                "Return JSON only."
            ),
        },
    ]

    try:
        raw_response = _request_openrouter_story_text(
            messages_payload,
            model_name=STORY_AMBIENT_PROFILE_MODEL,
            allow_free_fallback=False,
            fallback_model_names=[],
            temperature=0.0,
            max_tokens=STORY_AMBIENT_PROFILE_REQUEST_MAX_TOKENS,
            request_timeout=(
                STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
                STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
            ),
        )
    except Exception as exc:
        logger.warning("Ambient profile extraction failed, using fallback palette: %s", exc)
        return fallback_profile

    raw_payload = _extract_json_object_from_text(raw_response)
    if not isinstance(raw_payload, dict):
        return fallback_profile
    return _normalize_story_ambient_profile_payload(raw_payload, fallback_profile=fallback_profile)


def _resolve_story_turn_postprocess_payload(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    previous_assistant_text: str | None = None,
    world_cards: list[dict[str, Any]] | None = None,
    raw_memory_enabled: bool = False,
    location_enabled: bool = True,
    environment_enabled: bool | None = None,
    character_state_enabled: bool = False,
    important_event_enabled: bool = False,
    ambient_enabled: bool = False,
    emotion_visualization_enabled: bool = False,
) -> dict[str, Any] | None:
    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:
        return None

    try:
        from app.services import story_memory_pipeline
    except Exception as exc:
        logger.warning(
            "Story unified post-process bootstrap failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )
        return None

    resolved_previous_assistant_text = (
        previous_assistant_text.replace("\r\n", "\n").strip()
        if isinstance(previous_assistant_text, str)
        else ""
    )
    if not resolved_previous_assistant_text:
        previous_assistant_message = db.scalar(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == game.id,
                StoryMessage.role == STORY_ASSISTANT_ROLE,
                StoryMessage.id < assistant_message.id,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(1)
        )
        if isinstance(previous_assistant_message, StoryMessage):
            resolved_previous_assistant_text = _strip_story_markup_for_memory_text(
                previous_assistant_message.content
            ).replace("\r\n", "\n").strip()
            if not resolved_previous_assistant_text:
                resolved_previous_assistant_text = _normalize_story_markup_to_plain_text(
                    previous_assistant_message.content
                ).replace("\r\n", "\n").strip()
            if not resolved_previous_assistant_text:
                resolved_previous_assistant_text = previous_assistant_message.content.replace("\r\n", "\n").strip()

    resolved_environment_enabled = (
        story_memory_pipeline._normalize_story_environment_enabled(getattr(game, "environment_enabled", None))
        if environment_enabled is None
        else bool(environment_enabled)
    )
    active_scene_world_cards = world_cards if isinstance(world_cards, list) else []
    if character_state_enabled:
        try:
            from app.services.story_character_state_fields import sync_story_character_state_payload_from_world_cards

            sync_story_character_state_payload_from_world_cards(
                db=db,
                game=game,
                sync_manual_snapshot=False,
            )
        except Exception as exc:
            logger.warning(
                "Story character-state pre-sync failed: game_id=%s assistant_message_id=%s error=%s",
                game.id,
                assistant_message.id,
                exc,
            )
    scene_emotion_active_cast_entries = (
        _build_story_scene_emotion_active_cast_entries(
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            world_cards=active_scene_world_cards,
        )
        if emotion_visualization_enabled
        else []
    )

    try:
        return story_memory_pipeline._extract_story_postprocess_memory_payload(
            db=db,
            game=game,
            current_location_content=story_memory_pipeline._get_story_latest_location_memory_content(
                db=db,
                game_id=game.id,
            ),
            latest_user_prompt=latest_user_prompt,
            previous_assistant_text=resolved_previous_assistant_text,
            latest_assistant_text=latest_assistant_text,
            raw_memory_enabled=raw_memory_enabled,
            location_enabled=location_enabled,
            environment_enabled=resolved_environment_enabled,
            character_state_enabled=character_state_enabled,
            important_event_enabled=important_event_enabled,
            ambient_enabled=ambient_enabled,
            scene_emotion_enabled=emotion_visualization_enabled,
            scene_emotion_active_cast_entries=scene_emotion_active_cast_entries,
            scene_emotion_allowed_emotions=sorted(_STORY_CHARACTER_EMOTION_IDS),
        )
    except Exception as exc:
        logger.warning(
            "Story unified post-process failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )
        return None


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
        prepared_messages_payload = _prepare_story_messages_for_model(messages_payload)
        payload = {
            "model": model_name,
            "messages": prepared_messages_payload,
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


def _request_story_scene_emotion_payload(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    world_cards: list[dict[str, Any]],
    resolved_payload_override: dict[str, Any] | None = None,
    allow_model_request: bool = True,
) -> str | None:
    if isinstance(resolved_payload_override, dict):
        normalized_override = _normalize_story_scene_emotion_payload(resolved_payload_override)
        normalized_override = _canonicalize_story_scene_emotion_payload(
            normalized_override,
            world_cards=world_cards,
        )
        if isinstance(normalized_override, dict):
            return _serialize_story_scene_emotion_payload(normalized_override)

    fallback_payload = _build_story_scene_emotion_keyword_fallback_payload(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        world_cards=world_cards,
    )
    if not allow_model_request:
        if fallback_payload:
            return fallback_payload
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "postprocess_only",
                "participants": [],
            }
        )

    if not settings.openrouter_api_key or not settings.openrouter_chat_url:
        if fallback_payload:
            return fallback_payload
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_not_configured",
                "participants": [],
            }
        )

    normalized_user_prompt = latest_user_prompt.replace("\r\n", "\n").strip()
    normalized_assistant_text = latest_assistant_text.replace("\r\n", "\n").strip()
    if not normalized_assistant_text:
        if fallback_payload:
            return fallback_payload
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "empty_assistant_text",
                "participants": [],
            }
        )

    active_cast_entries = _build_story_scene_emotion_active_cast_entries(
        latest_user_prompt=normalized_user_prompt,
        latest_assistant_text=normalized_assistant_text,
        world_cards=world_cards,
    )
    messages_payload = _build_story_scene_emotion_analysis_messages(
        latest_user_prompt=normalized_user_prompt,
        latest_assistant_text=normalized_assistant_text,
        active_cast_entries=active_cast_entries,
    )
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    payload: dict[str, Any] = {
        "model": STORY_SCENE_EMOTION_ANALYSIS_MODEL,
        "messages": _prepare_story_messages_for_model(messages_payload),
        "stream": False,
        "temperature": 0,
        "max_tokens": STORY_SCENE_EMOTION_ANALYSIS_REQUEST_MAX_TOKENS,
        "plugins": [{"id": "response-healing"}],
    }

    try:
        response = HTTP_SESSION.post(
            settings.openrouter_chat_url,
            headers=headers,
            json=payload,
            timeout=(STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS, STORY_POSTPROCESS_READ_TIMEOUT_SECONDS),
        )
    except requests.RequestException:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_request_failed",
                "participants": [],
            }
        )

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

        reason = "model_http_error"
        if detail:
            normalized_detail = re.sub(r"[^0-9a-z_]+", "_", detail.lower()).strip("_")
            if normalized_detail:
                reason = f"model_http_error_{normalized_detail[:40]}"
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": reason,
                "participants": [],
            }
        )

    try:
        payload_value = response.json()
    except ValueError:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_invalid_payload",
                "participants": [],
            }
        )

    if not isinstance(payload_value, dict):
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_invalid_json_root",
                "participants": [],
            }
        )
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_empty_choices",
                "participants": [],
            }
        )
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message_value = choice.get("message")
    if not isinstance(message_value, dict):
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_missing_message",
                "participants": [],
            }
        )

    parsed_payload: Any = None
    raw_tool_calls = message_value.get("tool_calls")
    if isinstance(raw_tool_calls, list):
        for raw_tool_call in raw_tool_calls:
            if not isinstance(raw_tool_call, dict):
                continue
            function_value = raw_tool_call.get("function")
            if not isinstance(function_value, dict):
                continue
            if str(function_value.get("name") or "").strip() != "report_scene_emotions":
                continue
            raw_arguments = function_value.get("arguments")
            if isinstance(raw_arguments, dict):
                parsed_payload = raw_arguments
                break
            if isinstance(raw_arguments, str):
                try:
                    parsed_payload = json.loads(raw_arguments)
                except (TypeError, ValueError):
                    parsed_payload = _extract_json_object_from_text(raw_arguments)
                break

    if parsed_payload is None:
        raw_content = _extract_text_from_model_content(message_value.get("content"))
        if raw_content:
            parsed_payload = _extract_json_object_from_text(raw_content)
        else:
            return _serialize_story_scene_emotion_payload(
                {
                    "show_visualization": False,
                    "reason": "model_missing_tool_call",
                    "participants": [],
                }
            )

    normalized_payload = _normalize_story_scene_emotion_payload(parsed_payload)
    normalized_payload = _canonicalize_story_scene_emotion_payload(
        normalized_payload,
        world_cards=world_cards,
    )
    if isinstance(normalized_payload, dict):
        return _serialize_story_scene_emotion_payload(normalized_payload)

    return _serialize_story_scene_emotion_payload(
        {
            "show_visualization": False,
            "reason": "model_empty_payload",
            "participants": [],
        }
    )


def _request_gigachat_world_card_candidates(messages_payload: list[dict[str, str]]) -> Any:
    access_token = _get_gigachat_access_token()
    prepared_messages_payload = _prepare_story_messages_for_model(messages_payload)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": prepared_messages_payload,
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
            enable_secondary_npc_profile_generation=False,
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

    if should_generate_title:
        output_format_hint = (
            "Верни строго JSON без markdown: {\"title\": string, \"content\": string}. "
            "title обязателен (3-7 слов, без шаблонов). content обязателен. "
            "И title, и content должны быть только на русском языке."
        )
        existing_memory_block = ""
        task_hint = "Сформируй новый компактный блок карточки памяти по текущему ходу."
    else:
        output_format_hint = (
            "Верни только один НОВЫЙ компактный блок по текущему ходу "
            "(обычный текст, без JSON, без markdown, без заголовка). "
            "Не переписывай и не повторяй существующую карточку памяти. "
            "Блок должен быть только на русском языке."
        )
        existing_memory_block = ""
        task_hint = "Сожми только текущий ход в новый блок."

    return [
        {
            "role": "system",
            "content": (
                "Ты сжимаешь память RPG. Сохраняй ключевые факты, убирай воду и повторы, не выдумывай факты. "
                "Если карточка уже существует, возвращай только НОВЫЙ сжатый блок текущего хода. "
                "Пиши только на русском языке."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{output_format_hint}\n\n"
                + existing_memory_block
                + f"Ход игрока:\n{current_prompt or 'нет'}\n\n"
                + f"Ответ мастера:\n{current_assistant_text or 'нет'}\n\n"
                + task_hint
            ),
        },
    ]


def _resolve_story_plot_memory_model_name() -> str:
    # Memory extraction is pinned to Grok for stable quality.
    return STORY_PLOT_CARD_MEMORY_MODEL


def _resolve_story_plot_memory_fallback_models(primary_model: str) -> list[str]:
    _ = primary_model
    return []


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
    content = _compress_story_plot_memory_content(content, preferred_lines=raw_points)
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
    content = _compress_story_plot_memory_content(content)
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

    merged_raw = _append_story_plot_memory_content_raw(existing_normalized, new_normalized)
    merged_lines: list[str] = []
    seen_keys: set[str] = set()
    for raw_line in merged_raw.split("\n"):
        normalized_line = _normalize_story_plot_memory_line(raw_line)
        if not normalized_line:
            continue
        normalized_key = normalized_line.casefold()
        if normalized_key in seen_keys:
            continue
        seen_keys.add(normalized_key)
        merged_lines.append(normalized_line)
    if not merged_lines:
        return merged_raw.strip()
    return "\n".join(merged_lines).strip()


def _append_story_plot_memory_content_raw(existing_content: str, new_content: str) -> str:
    existing_normalized = existing_content.replace("\r\n", "\n").strip()
    new_normalized = new_content.replace("\r\n", "\n").strip()
    if not existing_normalized:
        return new_normalized
    if not new_normalized:
        return existing_normalized
    if existing_normalized.casefold() == new_normalized.casefold():
        return existing_normalized
    return f"{existing_normalized}\n\n{new_normalized}"


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


def _build_story_memory_layer_budgets(
    context_limit_tokens: int,
    *,
    optimization_mode: str | None = None,
) -> dict[str, int]:
    total_limit = max(_normalize_story_context_limit_chars(context_limit_tokens), 1)
    key_budget = min(
        max(int(total_limit * STORY_MEMORY_KEY_BUDGET_SHARE), STORY_MEMORY_KEY_MIN_BUDGET_TOKENS),
        total_limit,
    )
    non_key_budget = max(total_limit - key_budget, 1)
    normalized_mode = _normalize_story_memory_optimization_mode(optimization_mode)
    budget_shares = STORY_MEMORY_LAYER_BUDGET_SHARES_BY_MODE.get(
        normalized_mode,
        STORY_MEMORY_LAYER_BUDGET_SHARES_BY_MODE[STORY_DEFAULT_MEMORY_OPTIMIZATION_MODE],
    )
    raw_budget = max(int(non_key_budget * budget_shares[STORY_MEMORY_LAYER_RAW]), 1)
    compressed_budget = max(int(non_key_budget * budget_shares[STORY_MEMORY_LAYER_COMPRESSED]), 1)
    super_budget = max(non_key_budget - raw_budget - compressed_budget, 1)
    return {
        STORY_MEMORY_LAYER_KEY: key_budget,
        STORY_MEMORY_LAYER_RAW: raw_budget,
        STORY_MEMORY_LAYER_COMPRESSED: compressed_budget,
        STORY_MEMORY_LAYER_SUPER: super_budget,
    }


def _estimate_story_memory_block_tokens(block: StoryMemoryBlock) -> int:
    if isinstance(block.token_count, int) and block.token_count > 0:
        return block.token_count
    return max(_estimate_story_tokens(block.content), 1)


def _is_story_memory_line_russian(value: str) -> bool:
    stripped = STORY_MARKUP_MARKER_PATTERN.sub(" ", value).strip()
    if not stripped:
        return False
    if STORY_CJK_CHARACTER_PATTERN.search(stripped):
        return False

    cyrillic_letters = len(STORY_CYRILLIC_LETTER_PATTERN.findall(stripped))
    latin_letters = len(STORY_LATIN_LETTER_PATTERN.findall(stripped))
    latin_words = len(STORY_LATIN_WORD_PATTERN.findall(stripped))

    if cyrillic_letters < STORY_MEMORY_RUSSIAN_MIN_CYRILLIC_LETTERS:
        return False
    if latin_letters == 0:
        return True
    if latin_words > STORY_MEMORY_MAX_LATIN_WORDS:
        return False
    return latin_letters <= max(int(cyrillic_letters * STORY_MEMORY_MAX_LATIN_RATIO), 1)


def _normalize_story_memory_sentence_candidate(raw_value: str) -> str:
    compact = re.sub(r"\s+", " ", raw_value.strip(" -•\t\"'«»")).strip()
    if not compact:
        return ""

    compact = re.sub(r"(?i)\(\s*полный\s+текст\s*\)", "", compact).strip()
    compact = STORY_MARKUP_MARKER_PATTERN.sub(" ", compact)
    compact = re.sub(r"\s+", " ", compact).strip()
    compact = re.sub(
        r"^(?:user turn|player turn|narrator reply|assistant reply|ход игрока|ответ мастера|ответ рассказчика)[^:\n]{0,120}:\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    ).strip()
    compact = re.sub(
        r"^(?:ход игрока|ответ мастера|ответ рассказчика)\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    ).strip()
    compact = re.sub(r"^[,.;:()\[\]\-–—]+\s*", "", compact).strip()
    if not compact:
        return ""

    compact_lower = compact.casefold()
    if any(token in compact_lower for token in STORY_MEMORY_KEY_FORBIDDEN_SUBSTRINGS):
        return ""
    if any(compact_lower.startswith(prefix) for prefix in STORY_MEMORY_NOISE_PREFIXES):
        return ""

    compact = re.sub(r"\b[A-Za-z][A-Za-z'-]{1,32}\b", " ", compact)
    compact = re.sub(r"[A-Za-z]{2,}", " ", compact)
    compact = re.sub(r"\s+", " ", compact).strip(" ,;:-")
    if not compact:
        return ""
    if not _is_story_memory_line_russian(compact):
        return ""
    if len(compact) < 18:
        return ""

    if compact[-1] not in ".!?…":
        compact = f"{compact}."
    return compact[:1].upper() + compact[1:]


def _build_story_raw_memory_block_content(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    player_turn_label: str | None = None,
    known_character_names: list[str] | None = None,
    preserve_user_text: bool = False,
    preserve_assistant_text: bool = False,
) -> str:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._build_story_raw_memory_block_content(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        player_turn_label=player_turn_label,
        known_character_names=known_character_names,
        preserve_user_text=preserve_user_text,
        preserve_assistant_text=preserve_assistant_text,
    )


def _get_story_main_hero_name_for_memory(db: Session, *, game_id: int) -> str:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._get_story_main_hero_name_for_memory(db, game_id=game_id)


def _count_story_user_turns_before_assistant_message(
    db: Session,
    *,
    game_id: int,
    assistant_message_id: int,
) -> int:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._count_story_user_turns_before_assistant_message(
        db,
        game_id=game_id,
        assistant_message_id=assistant_message_id,
    )


def _build_story_memory_block_title(content: str, *, fallback_prefix: str) -> str:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._build_story_memory_block_title(
        content,
        fallback_prefix=fallback_prefix,
    )


def _create_story_memory_block(
    *,
    db: Session,
    game_id: int,
    assistant_message_id: int | None,
    layer: str,
    title: str,
    content: str,
    preserve_content: bool = False,
) -> StoryMemoryBlock:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._create_story_memory_block(
        db=db,
        game_id=game_id,
        assistant_message_id=assistant_message_id,
        layer=layer,
        title=title,
        content=content,
        preserve_content=preserve_content,
    )


def _list_story_latest_assistant_message_ids(
    db: Session,
    game_id: int,
    *,
    limit: int,
) -> list[int]:
    normalized_limit = max(int(limit), 0)
    if normalized_limit <= 0:
        return []
    return [
        int(message_id)
        for message_id in db.scalars(
            select(StoryMessage.id)
            .where(
                StoryMessage.game_id == game_id,
                StoryMessage.role == STORY_ASSISTANT_ROLE,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(normalized_limit)
        ).all()
    ]


def _extract_story_memory_sentences(raw_content: str) -> list[str]:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._extract_story_memory_sentences(raw_content)


def _build_story_memory_summary_without_truncation(
    raw_content: str,
    *,
    super_mode: bool,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,
) -> str:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._build_story_memory_summary_without_truncation(
        raw_content,
        super_mode=super_mode,
        player_name=player_name,
        known_character_names=known_character_names,
    )


def _evaluate_story_turn_memory_signal(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> dict[str, int]:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._evaluate_story_turn_memory_signal(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )


def _should_store_story_raw_memory_turn(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> bool:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._should_store_story_raw_memory_turn(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )


def _sanitize_story_key_memory_content(raw_content: str) -> str:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._sanitize_story_key_memory_content(raw_content)


def _is_story_key_memory_content_valid(content: str) -> bool:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._is_story_key_memory_content_valid(content)


def _extract_story_important_plot_card_payload_locally(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> tuple[str, str] | None:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._extract_story_important_plot_card_payload_locally(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )


def _compress_story_memory_block_locally(
    raw_content: str,
    *,
    super_mode: bool,
) -> tuple[str, str]:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._compress_story_memory_block_locally(
        raw_content,
        super_mode=super_mode,
    )


def _compress_story_memory_block_with_model(
    *,
    raw_content: str,
    model_name: str,
    fallback_model_names: list[str],
    super_mode: bool,
) -> tuple[str, str]:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._compress_story_memory_block_with_model(
        raw_content=raw_content,
        model_name=model_name,
        fallback_model_names=fallback_model_names,
        super_mode=super_mode,
    )


def _rebalance_story_memory_layers(
    *,
    db: Session,
    game: StoryGame,
    max_model_requests: int | None = None,
) -> None:
    from app.services import story_memory_pipeline as unified_memory_pipeline

    unified_rebalance_fn = getattr(unified_memory_pipeline, "_rebalance_story_memory_layers", None)
    if not callable(unified_rebalance_fn) or unified_rebalance_fn is _rebalance_story_memory_layers:
        raise RuntimeError("Unified story memory rebalance pipeline is unavailable")
    unified_rebalance_fn(
        db=db,
        game=game,
        max_model_requests=max_model_requests,
    )


def _extract_story_important_plot_card_payload(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> tuple[str, str] | None:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._extract_story_important_plot_card_payload(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )


def _estimate_story_memory_similarity(left_value: str, right_value: str) -> float:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._estimate_story_memory_similarity(left_value, right_value)


def _create_story_key_memory_block(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    title: str,
    content: str,
) -> bool:
    from app.services import story_memory_pipeline as _story_memory_pipeline

    return _story_memory_pipeline._create_story_key_memory_block(
        db=db,
        game=game,
        assistant_message=assistant_message,
        title=title,
        content=content,
    )


_STORY_LOCATION_BROAD_CONTEXT_PATTERNS = (
    (re.compile(r"\b(?:в|во)\s+(?:самой\s+)?столиц[еыуа]\b", re.IGNORECASE), lambda _match: "Столица"),
    (
        re.compile(r"\b(?:в|во)\s+город[еау]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,40})", re.IGNORECASE),
        lambda match: f"Город {' '.join(str(match.group('name') or '').split()).strip()}",
    ),
    (
        re.compile(r"\b(?:в|во)\s+деревн[еиу]\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,40})", re.IGNORECASE),
        lambda match: f"Деревня {' '.join(str(match.group('name') or '').split()).strip()}",
    ),
)

_STORY_LOCATION_SCENE_NAME_STRIP_CHARS = "\"«»"


_STORY_LOCATION_SCENE_CONTEXT_PATTERNS = (
    (
        re.compile(r"\bтаверн[аеиыу]?\s+[\"«'](?P<name>[^\"»']{1,60})[\"»']", re.IGNORECASE),
        lambda match: f"Таверна «{' '.join(str(match.group('name') or '').split()).strip()}»",
    ),
    (
        re.compile(
            r"\b(?:в|во|внутри|у|к|за\s+стойкой)\s+таверн[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
            re.IGNORECASE,
        ),
        lambda match: f"Таверна {' '.join(str(match.group('name') or '').split()).strip(_STORY_LOCATION_SCENE_NAME_STRIP_CHARS)}",
    ),
    (
        re.compile(r"\bтрактир[аеиыу]?\s+[\"«'](?P<name>[^\"»']{1,60})[\"»']", re.IGNORECASE),
        lambda match: f"Трактир «{' '.join(str(match.group('name') or '').split()).strip()}»",
    ),
    (
        re.compile(
            r"\b(?:в|во|внутри|у|к|за\s+стойкой)\s+трактир[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
            re.IGNORECASE,
        ),
        lambda match: f"Трактир {' '.join(str(match.group('name') or '').split()).strip(_STORY_LOCATION_SCENE_NAME_STRIP_CHARS)}",
    ),
    (
        re.compile(r"\bгостиниц[аеиыу]?\s+[\"«'](?P<name>[^\"»']{1,60})[\"»']", re.IGNORECASE),
        lambda match: f"Гостиница «{' '.join(str(match.group('name') or '').split()).strip()}»",
    ),
    (
        re.compile(
            r"\b(?:в|во|внутри|у|к)\s+гостиниц[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
            re.IGNORECASE,
        ),
        lambda match: f"Гостиница {' '.join(str(match.group('name') or '').split()).strip(_STORY_LOCATION_SCENE_NAME_STRIP_CHARS)}",
    ),
    (re.compile(r"\b(?:в|во|внутри|за\s+стойкой)\s+таверн[аеиыу]?\b", re.IGNORECASE), lambda _match: "Таверна"),
    (re.compile(r"\b(?:в|во|внутри)\s+трактир[аеиыу]?\b", re.IGNORECASE), lambda _match: "Трактир"),
    (re.compile(r"\b(?:в|во|внутри)\s+гостиниц[аеиыу]?\b", re.IGNORECASE), lambda _match: "Гостиница"),
    (re.compile(r"\b(?:на|по)\s+(?:[A-Za-zА-Яа-яЁё-]+\s+)?улиц[еуы]\b", re.IGNORECASE), lambda _match: "Улица"),
    (re.compile(r"\b(?:в|во)\s+(?:[A-Za-zА-Яа-яЁё-]+\s+)?переулк[еуыи]\b", re.IGNORECASE), lambda _match: "Переулок"),
    (re.compile(r"\b(?:на|по)\s+(?:[A-Za-zА-Яа-яЁё-]+\s+)?площад[иеу]\b", re.IGNORECASE), lambda _match: "Площадь"),
    (re.compile(r"\b(?:на|в)\s+рынк[еу]\b", re.IGNORECASE), lambda _match: "Рынок"),
    (re.compile(r"\b(?:в|во)\s+порт[еу]?\b", re.IGNORECASE), lambda _match: "Порт"),
    (re.compile(r"\b(?:в|во)\s+дворц[еуа]?\b", re.IGNORECASE), lambda _match: "Дворец"),
    (re.compile(r"\b(?:в|во)\s+замк[еуа]?\b", re.IGNORECASE), lambda _match: "Замок"),
    (re.compile(r"\b(?:в|во)\s+лесу\b", re.IGNORECASE), lambda _match: "Лес"),
    (re.compile(r"\b(?:на|у)\s+берегу\b", re.IGNORECASE), lambda _match: "Берег"),
)


def _extract_story_location_fallback_label_from_patterns(
    *,
    story_memory_pipeline: Any,
    source_text: str,
    patterns: tuple[tuple[re.Pattern[str], Any], ...],
) -> str:
    normalized_text = story_memory_pipeline._normalize_story_prompt_text(source_text, max_chars=2_400)
    if not normalized_text:
        return ""

    best_label = ""
    best_match_end = -1
    for pattern, builder in patterns:
        for match in pattern.finditer(normalized_text):
            candidate_label = builder(match) if callable(builder) else str(builder or "")
            normalized_label = story_memory_pipeline._resolve_story_location_memory_label(label=candidate_label)
            if not normalized_label:
                continue
            if match.end() >= best_match_end:
                best_match_end = match.end()
                best_label = normalized_label
    return best_label


_STORY_LOCATION_FALLBACK_TOKEN_STOPWORDS = {
    "в",
    "во",
    "на",
    "у",
    "к",
    "внутри",
    "действие",
    "происходит",
    "события",
    "происходят",
    "столица",
    "город",
    "деревня",
    "улица",
    "переулок",
    "площадь",
    "рынок",
    "порт",
    "дворец",
    "замок",
    "лес",
    "берег",
    "ночью",
}


def _extract_story_location_anchor_tokens(label: str) -> set[str]:
    return {
        token.casefold()
        for token in re.findall(r"[A-Za-zА-Яа-яЁё0-9-]+", str(label or ""))
        if len(token) >= 3 and token.casefold() not in _STORY_LOCATION_FALLBACK_TOKEN_STOPWORDS
    }


def _should_prefer_story_scene_location_fallback(
    *,
    model_label: str,
    fallback_label: str,
) -> bool:
    normalized_fallback_label = str(fallback_label or "").strip()
    if not normalized_fallback_label:
        return False

    fallback_tokens = _extract_story_location_anchor_tokens(normalized_fallback_label)
    if not fallback_tokens:
        return False

    model_tokens = _extract_story_location_anchor_tokens(model_label)
    if not model_tokens:
        return True

    return not bool(model_tokens & fallback_tokens)


_STORY_LOCATION_NAME_STOPWORDS = {
    "в",
    "во",
    "на",
    "у",
    "к",
    "из",
    "от",
    "до",
    "по",
    "под",
    "над",
    "перед",
    "за",
    "и",
    "или",
    "но",
    "а",
    "же",
    "что",
    "когда",
    "если",
    "как",
    "где",
    "потом",
    "сейчас",
    "ночью",
    "утром",
    "днем",
    "вечером",
    "столице",
    "городе",
}


def _extract_story_named_location_tail_after_keyword(
    *,
    source_text: str,
    keyword_root: str,
) -> str:
    normalized_text = str(source_text or "")
    lowered_text = normalized_text.casefold()
    keyword_positions: list[int] = []
    search_start = 0
    while True:
        keyword_position = lowered_text.find(keyword_root.casefold(), search_start)
        if keyword_position < 0:
            break
        keyword_positions.append(keyword_position)
        search_start = keyword_position + len(keyword_root)

    if not keyword_positions:
        return ""

    for keyword_position in reversed(keyword_positions):
        word_end = keyword_position
        while word_end < len(normalized_text) and (
            normalized_text[word_end].isalnum() or normalized_text[word_end] in {"-", "ё", "Ё"}
        ):
            word_end += 1

        tail = normalized_text[word_end:].lstrip(" \t\r\n\"«'")
        if not tail:
            continue

        tail_tokens = re.findall(r"[A-Za-zА-Яа-яЁё0-9-]+", tail[:80])
        if not tail_tokens:
            continue

        first_token = tail_tokens[0]
        if not first_token[:1].isupper():
            continue
        if first_token.casefold() in _STORY_LOCATION_NAME_STOPWORDS:
            continue

        candidate_tokens = [first_token]
        for token in tail_tokens[1:]:
            if token.casefold() in _STORY_LOCATION_NAME_STOPWORDS:
                break
            candidate_tokens.append(token)
            if len(candidate_tokens) >= 4:
                break

        candidate = " ".join(candidate_tokens).strip(" ,.;:-")
        if candidate:
            return candidate

    return ""


def _extract_story_scene_establishment_label(source_text: str) -> str:
    normalized_text = str(source_text or "")
    lowered_text = normalized_text.casefold()

    for keyword_root, label in (
        ("таверн", "Таверна"),
        ("трактир", "Трактир"),
        ("гостиниц", "Гостиница"),
    ):
        if keyword_root not in lowered_text:
            continue
        name_tail = _extract_story_named_location_tail_after_keyword(
            source_text=normalized_text,
            keyword_root=keyword_root,
        )
        if name_tail:
            return f"{label} {name_tail}".strip()
        if any(
            marker in lowered_text
            for marker in (
                f"в {keyword_root}",
                f"во {keyword_root}",
                f"внутри {keyword_root}",
                f"за стойкой {keyword_root}",
            )
        ):
            return label

    return ""


def _legacy_build_story_location_fallback_payload_from_scene_text(
    *,
    story_memory_pipeline: Any,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> dict[str, str] | None:
    normalized_latest_assistant = story_memory_pipeline._normalize_story_prompt_text(
        latest_assistant_text,
        max_chars=1_800,
    )
    normalized_user_prompt = story_memory_pipeline._normalize_story_prompt_text(
        latest_user_prompt,
        max_chars=900,
    )
    combined_text = "\n".join(
        part
        for part in (normalized_user_prompt, normalized_latest_assistant)
        if isinstance(part, str) and part.strip()
    )
    if not combined_text:
        return None

    explicit_scene_label = _extract_story_scene_establishment_label(combined_text)
    broad_label = _extract_story_location_fallback_label_from_patterns(
        story_memory_pipeline=story_memory_pipeline,
        source_text=combined_text,
        patterns=_STORY_LOCATION_BROAD_CONTEXT_PATTERNS,
    )
    scene_label = explicit_scene_label or _extract_story_location_fallback_label_from_patterns(
        story_memory_pipeline=story_memory_pipeline,
        source_text=combined_text,
        patterns=_STORY_LOCATION_SCENE_CONTEXT_PATTERNS,
    )
    if scene_label and broad_label and scene_label.casefold() != broad_label.casefold():
        combined_label = f"{broad_label}, {scene_label}"
    else:
        combined_label = scene_label or broad_label
    combined_label = story_memory_pipeline._resolve_story_location_memory_label(label=combined_label)
    if not combined_label:
        return None

    normalized_content = story_memory_pipeline._normalize_story_location_memory_content(
        f"Действие происходит {combined_label}."
    )
    if not normalized_content:
        return None
    return {
        "action": "update",
        "content": normalized_content,
        "label": story_memory_pipeline._resolve_story_location_memory_label(content=normalized_content),
    }


def _build_story_location_fallback_payload_from_scene_text(
    *,
    story_memory_pipeline: Any,
    latest_user_prompt: str,
    latest_assistant_text: str,
    previous_assistant_text: str = "",
    opening_scene_text: str = "",
) -> dict[str, str] | None:
    normalized_latest_assistant = story_memory_pipeline._normalize_story_prompt_text(
        latest_assistant_text,
        max_chars=1_800,
    )
    normalized_previous_assistant = story_memory_pipeline._normalize_story_prompt_text(
        previous_assistant_text,
        max_chars=1_200,
    )
    normalized_opening_scene = story_memory_pipeline._normalize_story_prompt_text(
        opening_scene_text,
        max_chars=1_200,
    )
    normalized_user_prompt = story_memory_pipeline._normalize_story_prompt_text(
        latest_user_prompt,
        max_chars=900,
    )
    source_parts = [
        part
        for part in (
            normalized_latest_assistant,
            normalized_previous_assistant,
            normalized_opening_scene,
            normalized_user_prompt,
        )
        if isinstance(part, str) and part.strip()
    ]
    if not source_parts:
        return None

    def _clean_named_place(raw_value: str) -> str:
        normalized_value = str(raw_value or "").replace("\r", " ").replace("\n", " ")
        normalized_value = re.split(r"[,.!?:;]", normalized_value, maxsplit=1)[0]
        normalized_value = normalized_value.strip(" \"«»'")
        if not normalized_value:
            return ""

        tokens = re.findall(r"[A-Za-zА-Яа-яЁё0-9-]+", normalized_value)
        if not tokens:
            return ""
        if not tokens[0][:1].isupper():
            return ""

        stop_tokens = {
            "в",
            "во",
            "на",
            "у",
            "к",
            "и",
            "но",
            "а",
            "что",
            "когда",
            "где",
            "пока",
            "после",
            "перед",
            "внутри",
            "снаружи",
            "вечер",
            "ночь",
            "утро",
            "день",
        }
        candidate_tokens = [tokens[0]]
        for token in tokens[1:]:
            if token.casefold() in stop_tokens:
                break
            candidate_tokens.append(token)
            if len(candidate_tokens) >= 4:
                break
        return " ".join(candidate_tokens).strip()

    def _resolve_broad_label(text_value: str) -> str:
        if re.search(r"\b(?:в|во)\s+(?:самой\s+)?столиц[еыуа]\b", text_value, flags=re.IGNORECASE):
            return "Столица"
        city_match = re.search(
            r"\b(?:в|во)\s+город[еау]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,40})",
            text_value,
            flags=re.IGNORECASE,
        )
        if city_match:
            city_name = _clean_named_place(str(city_match.group("name") or ""))
            if city_name:
                return f"Город {city_name}"
        village_match = re.search(
            r"\b(?:в|во)\s+деревн[ееиу]\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,40})",
            text_value,
            flags=re.IGNORECASE,
        )
        if village_match:
            village_name = _clean_named_place(str(village_match.group("name") or ""))
            if village_name:
                return f"Деревня {village_name}"
        return ""

    def _resolve_scene_label(text_value: str) -> str:
        named_patterns = (
            (r"\bтаверн[аеиыу]?\s+[«\"](?P<name>[^\"»\n]{1,60})[»\"]", "Таверна"),
            (r"\bтрактир[аеиыу]?\s+[«\"](?P<name>[^\"»\n]{1,60})[»\"]", "Трактир"),
            (r"\bгостиниц[аеиыу]?\s+[«\"](?P<name>[^\"»\n]{1,60})[»\"]", "Гостиница"),
            (
                r"\b(?:в|во|внутри|у|к|за\s+стойкой)\s+таверн[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
                "Таверна",
            ),
            (
                r"\b(?:в|во|внутри|у|к|за\s+стойкой)\s+трактир[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
                "Трактир",
            ),
            (
                r"\b(?:в|во|внутри|у|к)\s+гостиниц[аеиыу]?\s+(?P<name>[A-ZА-ЯЁ][^,.!?:;\n]{1,60})",
                "Гостиница",
            ),
        )
        best_label = ""
        best_match_end = -1
        for pattern, prefix in named_patterns:
            for match in re.finditer(pattern, text_value, flags=re.IGNORECASE):
                candidate_name = _clean_named_place(str(match.group("name") or ""))
                if not candidate_name:
                    continue
                candidate_label = f"{prefix} {candidate_name}".strip()
                if match.end() >= best_match_end:
                    best_match_end = match.end()
                    best_label = candidate_label
        if best_label:
            return best_label

        for pattern, label in (
            (r"\b(?:в|во|внутри|за\s+стойкой)\s+таверн[аеиыу]?\b", "Таверна"),
            (r"\b(?:в|во|внутри|за\s+стойкой)\s+трактир[аеиыу]?\b", "Трактир"),
            (r"\b(?:в|во|внутри)\s+гостиниц[аеиыу]?\b", "Гостиница"),
        ):
            if re.search(pattern, text_value, flags=re.IGNORECASE):
                return label
        return ""

    broad_label = ""
    scene_label = ""
    generic_scene_label = ""
    for part in source_parts:
        if not broad_label:
            broad_label = _resolve_broad_label(part)
        candidate_scene_label = _resolve_scene_label(part)
        if candidate_scene_label:
            if len(candidate_scene_label.split()) > 1:
                scene_label = candidate_scene_label
                break
            if not generic_scene_label:
                generic_scene_label = candidate_scene_label

    if not scene_label:
        scene_label = generic_scene_label

    if not scene_label and not broad_label:
        return None

    combined_label = (
        f"{broad_label}, {scene_label}"
        if scene_label and broad_label and scene_label.casefold() != broad_label.casefold()
        else scene_label or broad_label
    )
    combined_label = story_memory_pipeline._resolve_story_location_memory_label(label=combined_label)
    if not combined_label:
        return None

    normalized_content = story_memory_pipeline._normalize_story_location_memory_content(
        f"Действие происходит {combined_label}."
    )
    if not normalized_content:
        normalized_content = f"Действие происходит {combined_label}."
    return {
        "action": "update",
        "content": normalized_content,
        "label": story_memory_pipeline._resolve_story_location_memory_label(
            label=combined_label,
            content=normalized_content,
        ),
    }


def _build_story_prompt_context_cards(
    *,
    game: StoryGame,
    memory_blocks: list[StoryMemoryBlock],
) -> list[dict[str, str]]:
    context_cards: list[dict[str, str]] = []
    resolved_location_label = _resolve_story_current_location_label(
        str(getattr(game, "current_location_label", "") or ""),
        memory_blocks,
    )
    resolved_location_label = _strip_story_location_time_context(resolved_location_label).strip(" .,:;!?…")
    if resolved_location_label:
        context_cards.append(
            {
                "title": "Место: Текущая сцена",
                "content": f"Текущее место действия: {resolved_location_label}.",
            }
        )

    try:
        from app.services import story_memory_pipeline
    except Exception:
        story_memory_pipeline = None

    weather_prompt_card = None
    if story_memory_pipeline is not None:
        time_prompt_card = story_memory_pipeline._build_story_environment_time_prompt_card(game)
        if isinstance(time_prompt_card, dict):
            title = " ".join(str(time_prompt_card.get("title", "")).split()).strip()
            content = str(time_prompt_card.get("content", "")).replace("\r\n", "\n").strip()
            if title and content:
                context_cards.append({"title": title, "content": content})
        weather_prompt_card = story_memory_pipeline._build_story_environment_weather_prompt_card(game)
        try:
            weather_content = story_memory_pipeline._build_story_weather_prompt_content_compact(
                current_weather=_resolve_story_environment_current_weather_for_output(game),
                tomorrow_weather=story_memory_pipeline._deserialize_story_environment_weather(
                    str(getattr(game, "environment_tomorrow_weather", "") or "")
                ),
            )
        except Exception:
            weather_content = ""
        if weather_content:
            weather_prompt_card = {
                "title": f"Погода: {getattr(story_memory_pipeline, 'STORY_MEMORY_WEATHER_TITLE', 'Текущая погода')}",
                "content": weather_content,
            }
    if isinstance(weather_prompt_card, dict):
        title = " ".join(str(weather_prompt_card.get("title", "")).split()).strip()
        content = str(weather_prompt_card.get("content", "")).replace("\r\n", "\n").strip()
        if title and content:
            context_cards.append({"title": title, "content": content})

    return context_cards


def _list_story_prompt_memory_cards(
    db: Session,
    game: StoryGame,
    memory_optimization_enabled: bool,
    context_messages: list[StoryMessage] | None = None,
) -> list[dict[str, str]]:
    memory_blocks = _list_story_memory_blocks(db, game.id)
    context_cards = [
        {**card, "source_kind": "context"}
        for card in _build_story_prompt_context_cards(game=game, memory_blocks=memory_blocks)
    ]
    _ = memory_optimization_enabled

    all_plot_cards = _list_story_plot_cards(db, game.id)
    if context_messages is None:
        active_plot_cards: list[dict[str, str]] = []
        for card in all_plot_cards:
            title = card.title.replace("\r\n", " ").strip()
            content = card.content.replace("\r\n", "\n").strip()
            if not title or not content:
                continue
            triggers = _normalize_story_plot_card_triggers(
                _deserialize_story_plot_card_triggers(str(getattr(card, "triggers", "") or "")),
                fallback_title=title,
            )
            if triggers:
                continue
            if not _coerce_story_plot_card_enabled(getattr(card, "is_enabled", True), triggers=triggers):
                continue
            active_plot_cards.append(
                {
                    "title": title,
                    "content": content,
                    "source_kind": "plot",
                }
            )
    else:
        active_plot_cards = [
            {**card, "source_kind": "plot"}
            for card in _select_story_plot_cards_for_prompt(context_messages, all_plot_cards)
        ]

    combined_cards: list[dict[str, str]] = list(context_cards)
    if memory_blocks:
        layer_order = {
            STORY_MEMORY_LAYER_KEY: 0,
            STORY_MEMORY_LAYER_SUPER: 1,
            STORY_MEMORY_LAYER_COMPRESSED: 2,
            STORY_MEMORY_LAYER_RAW: 3,
        }
        layer_label = {
            STORY_MEMORY_LAYER_KEY: "Важный момент",
            STORY_MEMORY_LAYER_SUPER: "Суперсжатая память",
            STORY_MEMORY_LAYER_COMPRESSED: "Сжатая память",
            STORY_MEMORY_LAYER_RAW: "Свежая память",
        }
        ordered_blocks = sorted(
            memory_blocks,
            key=lambda block: (layer_order.get(_normalize_story_memory_layer(block.layer), 99), block.id),
        )
        for block in ordered_blocks:
            content = block.content.replace("\r\n", "\n").strip()
            title = " ".join(block.title.replace("\r\n", " ").split()).strip()
            if not content:
                continue
            layer = _normalize_story_memory_layer(block.layer)
            if layer in {STORY_MEMORY_LAYER_LOCATION, STORY_MEMORY_LAYER_WEATHER}:
                continue
            title_prefix = layer_label.get(layer, "Память")
            full_title = " ".join(f"{title_prefix}: {title or 'Блок'}".split()).strip()
            if len(full_title) > STORY_PLOT_CARD_MAX_TITLE_LENGTH:
                full_title = full_title[:STORY_PLOT_CARD_MAX_TITLE_LENGTH].rstrip()
            combined_cards.append(
                {
                    "title": full_title,
                    "content": content,
                    "source_kind": "memory",
                    "memory_layer": layer,
                }
            )

    combined_cards.extend(active_plot_cards)
    return [
        card
        for card in combined_cards
        if card.get("title", "").strip() and card.get("content", "").strip()
    ]


def _seed_story_opening_scene_memory_block(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    opening_scene_text: str,
) -> bool:
    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:
        return False

    normalized_opening_scene = opening_scene_text.replace("\r\n", "\n").strip()
    if not normalized_opening_scene:
        return False

    existing_block_id = db.scalar(
        select(StoryMemoryBlock.id)
        .where(
            StoryMemoryBlock.game_id == game.id,
            StoryMemoryBlock.assistant_message_id == assistant_message.id,
            StoryMemoryBlock.undone_at.is_(None),
        )
        .limit(1)
    )
    if existing_block_id is not None:
        return False

    raw_block_content = _build_story_raw_memory_block_content(
        latest_user_prompt="",
        latest_assistant_text=normalized_opening_scene,
        preserve_assistant_text=True,
    )
    if not raw_block_content:
        return False

    created_opening_scene_memory = False
    try:
        with db.begin_nested():
            _create_story_memory_block(
                db=db,
                game_id=game.id,
                assistant_message_id=assistant_message.id,
                layer=STORY_MEMORY_LAYER_RAW,
                title=_build_story_memory_block_title(raw_block_content, fallback_prefix="Свежая память"),
                content=raw_block_content,
                preserve_content=True,
            )
        created_opening_scene_memory = True
    except Exception as exc:
        logger.warning(
            "Opening scene memory sync failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )
        return False
    try:
        _rebalance_story_memory_layers(db=db, game=game)
    except Exception as exc:
        logger.warning(
            "Opening scene memory rebalance failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )
    return created_opening_scene_memory


def _upsert_story_plot_memory_card(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt_override: str | None = None,
    latest_assistant_text_override: str | None = None,
    resolved_postprocess_payload_override: dict[str, Any] | None = None,
    memory_optimization_enabled: bool = True,
    allow_model_postprocess_request: bool = True,
) -> tuple[bool, list[StoryPlotCardChangeEvent]]:
    memory_optimization_enabled = True
    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:
        return (False, [])

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
        return (False, [])

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
    previous_assistant_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == STORY_ASSISTANT_ROLE,
            StoryMessage.id < assistant_message.id,
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    if isinstance(previous_assistant_message, StoryMessage):
        previous_assistant_text = _strip_story_markup_for_memory_text(previous_assistant_message.content).replace(
            "\r\n",
            "\n",
        ).strip()
        if not previous_assistant_text:
            previous_assistant_text = _normalize_story_markup_to_plain_text(previous_assistant_message.content).replace(
                "\r\n",
                "\n",
            ).strip()
        if not previous_assistant_text:
            previous_assistant_text = previous_assistant_message.content.replace("\r\n", "\n").strip()
    else:
        previous_assistant_text = ""
    important_payload = None
    key_memory_created_any = False
    latest_assistant_message_ids = _list_story_latest_assistant_message_ids(
        db,
        game.id,
        limit=STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS,
    ) if memory_optimization_enabled else []
    main_hero_name_for_memory = (
        _get_story_main_hero_name_for_memory(db, game_id=game.id)
        if memory_optimization_enabled
        else ""
    )
    preserve_assistant_text_for_raw_block = (
        memory_optimization_enabled and assistant_message.id in latest_assistant_message_ids
    )
    preserve_user_text_for_raw_block = preserve_assistant_text_for_raw_block if memory_optimization_enabled else False

    raw_turn_has_meaningful_signal = memory_optimization_enabled and _should_store_story_raw_memory_turn(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    should_store_raw_block = memory_optimization_enabled and bool(latest_user_prompt or latest_assistant_text)
    should_force_memory_rebalance = memory_optimization_enabled and bool(latest_user_prompt or latest_assistant_text)
    if should_store_raw_block:
        raw_block_created = False
        raw_memory_resynced = False
        original_memory_optimization_enabled = getattr(game, "memory_optimization_enabled", None)
        should_restore_memory_optimization_enabled = (
            original_memory_optimization_enabled is not None
            and bool(original_memory_optimization_enabled) != bool(memory_optimization_enabled)
        )
        try:
            from app.services import story_memory_pipeline as raw_memory_pipeline

            if should_restore_memory_optimization_enabled:
                game.memory_optimization_enabled = bool(memory_optimization_enabled)
            raw_block_created = bool(
                raw_memory_pipeline._upsert_story_raw_memory_block(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=latest_user_prompt,
                    latest_assistant_text=latest_assistant_text,
                    preserve_user_text=preserve_user_text_for_raw_block,
                    preserve_assistant_text=preserve_assistant_text_for_raw_block,
                )
            )
            raw_memory_resync_fn = getattr(raw_memory_pipeline, "_sync_story_raw_memory_blocks_for_recent_turns", None)
            if callable(raw_memory_resync_fn):
                raw_memory_resynced = bool(
                    raw_memory_resync_fn(
                        db=db,
                        game=game,
                        additional_assistant_message_ids=[int(assistant_message.id)],
                    )
                )
        except Exception as exc:
            logger.warning(
                "Raw story memory sync failed: game_id=%s assistant_message_id=%s error=%s",
                game.id,
                assistant_message.id,
                exc,
            )
        finally:
            if should_restore_memory_optimization_enabled:
                game.memory_optimization_enabled = original_memory_optimization_enabled
        if raw_block_created or raw_memory_resynced:
            try:
                _rebalance_story_memory_layers(db=db, game=game)
            except Exception as exc:
                logger.warning(
                    "Raw story memory rebalance failed: game_id=%s assistant_message_id=%s error=%s",
                    game.id,
                    assistant_message.id,
                    exc,
                )

    should_extract_important_payload = memory_optimization_enabled

    try:
        from app.services import story_memory_pipeline

        current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
            db=db,
            game_id=game.id,
        )
        environment_enabled = story_memory_pipeline._normalize_story_environment_enabled(
            getattr(game, "environment_enabled", None)
        )
        postprocess_payload = (
            resolved_postprocess_payload_override
            if isinstance(resolved_postprocess_payload_override, dict)
            else None
        )

        if postprocess_payload is None and allow_model_postprocess_request:
            try:
                postprocess_payload = story_memory_pipeline._extract_story_postprocess_memory_payload(
                    db=db,
                    game=game,
                    current_location_content=current_location_content,
                    latest_user_prompt=latest_user_prompt,
                    previous_assistant_text=previous_assistant_text,
                    latest_assistant_text=latest_assistant_text,
                    raw_memory_enabled=False,
                    location_enabled=True,
                    environment_enabled=environment_enabled,
                    character_state_enabled=bool(getattr(game, "character_state_enabled", None)),
                    important_event_enabled=should_extract_important_payload,
                    ambient_enabled=False,
                    scene_emotion_enabled=False,
                )
            except Exception as exc:
                logger.warning(
                    "Story bundled memory/environment analysis failed: game_id=%s assistant_message_id=%s error=%s",
                    game.id,
                    assistant_message.id,
                    exc,
                )

        location_payload_for_sync = (
            postprocess_payload.get("location")
            if isinstance(postprocess_payload, dict)
            and isinstance(postprocess_payload.get("location"), dict)
            else None
        )
        environment_payload_for_sync = (
            postprocess_payload.get("environment")
            if isinstance(postprocess_payload, dict)
            and isinstance(postprocess_payload.get("environment"), dict)
            else None
        )
        character_state_payload_for_sync = (
            postprocess_payload.get("character_state")
            if isinstance(postprocess_payload, dict)
            and isinstance(postprocess_payload.get("character_state"), dict)
            else None
        )
        important_payload = (
            postprocess_payload.get("important_event")
            if memory_optimization_enabled
            and isinstance(postprocess_payload, dict)
            and isinstance(postprocess_payload.get("important_event"), tuple)
            else important_payload
        )

        story_memory_pipeline._upsert_story_location_memory_block(
            db=db,
            game=game,
            assistant_message=assistant_message,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            previous_assistant_text=previous_assistant_text,
            resolved_payload_override=location_payload_for_sync,
        )
        current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
            db=db,
            game_id=game.id,
        )
        if bool(getattr(game, "character_state_enabled", None)):
            try:
                story_memory_pipeline._sync_story_character_state_cards(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    resolved_payload_override=character_state_payload_for_sync,
                    current_location_content=current_location_content,
                )
                from app.services.story_character_state_fields import apply_story_character_state_payload_to_world_cards

                apply_story_character_state_payload_to_world_cards(
                    db=db,
                    game=game,
                )
            except Exception as exc:
                logger.warning(
                    "Story character-state post-process failed: game_id=%s assistant_message_id=%s error=%s",
                    game.id,
                    assistant_message.id,
                    exc,
                )
        if environment_enabled:
            try:
                story_memory_pipeline._sync_story_environment_state_for_assistant_message(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=latest_user_prompt,
                    latest_assistant_text=latest_assistant_text,
                    previous_assistant_text=previous_assistant_text,
                    current_location_content_override=current_location_content,
                    resolved_payload_override=environment_payload_for_sync,
                    allow_weather_seed=False,
                    allow_model_request=allow_model_postprocess_request,
                )
            except Exception as exc:
                logger.warning(
                    "Story environment post-process failed: game_id=%s assistant_message_id=%s error=%s",
                    game.id,
                    assistant_message.id,
                    exc,
                )
    except Exception as exc:
        logger.warning(
            "Story location post-process bootstrap failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )

    if memory_optimization_enabled and important_payload is not None:
        title, content = important_payload
        key_memory_created = False
        try:
            from app.services import story_memory_pipeline as key_memory_pipeline

            with db.begin_nested():
                key_memory_created = bool(
                    key_memory_pipeline._create_story_key_memory_block(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    title=title,
                    content=content,
                    )
                )
        except Exception as exc:
            logger.warning(
                "Key story memory sync failed: game_id=%s assistant_message_id=%s error=%s",
                game.id,
                assistant_message.id,
                exc,
            )
        if key_memory_created:
            key_memory_created_any = True
            try:
                _rebalance_story_memory_layers(db=db, game=game)
            except Exception as exc:
                logger.warning(
                    "Key story memory rebalance failed: game_id=%s assistant_message_id=%s error=%s",
                    game.id,
                    assistant_message.id,
                    exc,
                )

    if should_force_memory_rebalance:
        try:
            _rebalance_story_memory_layers(db=db, game=game)
        except Exception as exc:
            logger.warning(
                "Final story memory rebalance failed: game_id=%s assistant_message_id=%s error=%s",
                game.id,
                assistant_message.id,
                exc,
            )

    _touch_story_game(game)
    db.commit()
    return (key_memory_created_any, [])


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
    use_plot_memory: bool = False,
    context_limit_chars: int,
    response_max_tokens: int | None = None,
    translate_for_model: bool = False,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
):
    access_token = _get_gigachat_access_token()
    request_started_at = time.monotonic()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        use_plot_memory=use_plot_memory,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=response_max_tokens,
        translate_for_model=translate_for_model,
        model_name=settings.gigachat_model,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
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
        first_content_emitted_at: float | None = None
        for raw_line in response.iter_lines(
            chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
            decode_unicode=True,
        ):
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
                    if first_content_emitted_at is None:
                        first_content_emitted_at = time.monotonic()
                        logger.info(
                            "GigaChat stream first token latency: %.3fs",
                            first_content_emitted_at - request_started_at,
                        )
                    for chunk in _yield_story_stream_chunks_with_pacing(content_delta):
                        yield chunk
                    continue

            if emitted_delta:
                continue

            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = message_value.get("content")
                if isinstance(content_value, str) and content_value:
                    if first_content_emitted_at is None:
                        first_content_emitted_at = time.monotonic()
                        logger.info(
                            "GigaChat stream first token latency (message payload): %.3fs",
                            first_content_emitted_at - request_started_at,
                        )
                    for chunk in _yield_story_stream_chunks_with_pacing(content_value):
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
    use_plot_memory: bool = False,
    context_limit_chars: int,
    model_name: str | None = None,
    temperature: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    translate_for_model: bool = False,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
):
    def _extract_story_novel_suffix(base_text: str, candidate_text: str) -> str:
        normalized_base = base_text or ""
        normalized_candidate = candidate_text or ""
        if not normalized_candidate:
            return ""
        if not normalized_base:
            return normalized_candidate
        if normalized_candidate.startswith(normalized_base):
            return normalized_candidate[len(normalized_base) :]
        overlap_limit = min(len(normalized_base), len(normalized_candidate))
        for overlap_size in range(overlap_limit, 0, -1):
            if normalized_base.endswith(normalized_candidate[:overlap_size]):
                return normalized_candidate[overlap_size:]
        return normalized_candidate

    request_started_at = time.monotonic()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        use_plot_memory=use_plot_memory,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=max_tokens,
        translate_for_model=translate_for_model,
        model_name=model_name,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
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
    allow_free_model_fallback = (
        primary_model != "openrouter/free"
        and not _is_story_paid_model(primary_model)
    )
    if allow_free_model_fallback:
        candidate_models.append("openrouter/free")

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        payload = {
            "model": model_name,
            "messages": messages_payload,
            "stream": True,
        }
        provider_payload = _build_openrouter_provider_payload(model_name)
        if provider_payload is not None:
            payload["provider"] = provider_payload
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
                emitted_text_parts: list[str] = []
                first_content_emitted_at: float | None = None
                last_keepalive_at = time.monotonic()
                saw_done_marker = False
                finish_reason: str | None = None
                for raw_line in response.iter_lines(
                    chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
                    decode_unicode=True,
                ):
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue

                    raw_data = line[len("data:") :].strip()
                    if raw_data == "[DONE]":
                        saw_done_marker = True
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
                    raw_finish_reason = choice.get("finish_reason")
                    if isinstance(raw_finish_reason, str) and raw_finish_reason.strip():
                        finish_reason = raw_finish_reason.strip()
                    delta_value = choice.get("delta")
                    if isinstance(delta_value, dict):
                        content_delta = _extract_text_from_model_content(delta_value.get("content"))
                        if content_delta:
                            emitted_delta = True
                            emitted_text_parts.append(content_delta)
                            if first_content_emitted_at is None:
                                first_content_emitted_at = time.monotonic()
                                logger.info(
                                    "OpenRouter stream first token latency: %.3fs model=%s",
                                    first_content_emitted_at - request_started_at,
                                    model_name,
                                )
                            for chunk in _yield_story_stream_chunks_with_pacing(content_delta):
                                yield chunk
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
                            emitted_text_parts.append(content_value)
                            if first_content_emitted_at is None:
                                first_content_emitted_at = time.monotonic()
                                logger.info(
                                    "OpenRouter stream first token latency (message payload): %.3fs model=%s",
                                    first_content_emitted_at - request_started_at,
                                    model_name,
                                )
                            for chunk in _yield_story_stream_chunks_with_pacing(content_value):
                                yield chunk
                            break

                if emitted_delta:
                    emitted_text = "".join(emitted_text_parts)
                    stream_closed_unexpectedly = not saw_done_marker and not str(finish_reason or "").strip()
                    model_hit_length_limit = str(finish_reason or "").strip().casefold() == "length"
                    stream_closed_and_short = (
                        stream_closed_unexpectedly
                        and len(emitted_text.strip()) < STORY_STREAM_TAIL_RECOVERY_MIN_CHARS
                    )
                    should_try_recovery = stream_closed_and_short or (model_hit_length_limit and max_tokens is None)
                    if should_try_recovery:
                        fallback_max_tokens = max_tokens
                        if fallback_max_tokens is None and model_hit_length_limit:
                            fallback_max_tokens = max(STORY_DEFAULT_RESPONSE_MAX_TOKENS * 3, 1_200)
                        logger.warning(
                            "OpenRouter stream may be incomplete; attempting tail recovery: model=%s finish_reason=%s done=%s fallback_max_tokens=%s",
                            model_name,
                            finish_reason or "",
                            saw_done_marker,
                            fallback_max_tokens,
                        )
                        try:
                            fallback_text = _request_openrouter_story_text(
                                messages_payload,
                                model_name=model_name,
                                allow_free_fallback=False,
                                temperature=temperature,
                                top_k=top_k,
                                top_p=top_p,
                                max_tokens=fallback_max_tokens,
                            )
                        except Exception as recovery_exc:
                            logger.warning(
                                "OpenRouter stream tail recovery failed: model=%s error=%s",
                                model_name,
                                recovery_exc,
                            )
                            fallback_text = ""
                        suffix_text = _extract_story_novel_suffix(emitted_text, fallback_text)
                        if suffix_text:
                            logger.info(
                                "OpenRouter stream recovery appended tail: model=%s chars=%s",
                                model_name,
                                len(suffix_text),
                            )
                            for chunk in _yield_story_stream_chunks_with_pacing(suffix_text):
                                yield chunk
                    return

                # Fallback when stream completed without textual content chunks.
                fallback_text = _request_openrouter_story_text(
                    messages_payload,
                    model_name=model_name,
                    allow_free_fallback=False,
                    temperature=temperature,
                    top_k=top_k,
                    top_p=top_p,
                    max_tokens=max_tokens,
                )
                if fallback_text:
                    for chunk in _yield_story_stream_chunks_with_pacing(fallback_text):
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
    prepared_messages_payload = _prepare_story_messages_for_model(messages_payload)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": prepared_messages_payload,
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
    translate_input: bool = True,
    fallback_model_names: list[str] | None = None,
    temperature: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    request_timeout: tuple[int, int] | None = None,
    retry_on_rate_limit: bool = True,
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
    prepared_messages_payload = _prepare_story_messages_for_model(
        messages_payload,
        translate_input=translate_input,
    )
    for candidate_model in candidate_models:
        payload = {
            "model": candidate_model,
            "messages": prepared_messages_payload,
            "stream": False,
        }
        provider_payload = _build_openrouter_provider_payload(candidate_model)
        if provider_payload is not None:
            payload["provider"] = provider_payload
        if temperature is not None:
            payload["temperature"] = temperature
        if top_k is not None:
            payload["top_k"] = top_k
        if top_p is not None:
            payload["top_p"] = top_p
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)
        attempts_per_model = 2 if retry_on_rate_limit else 1
        for attempt_index in range(attempts_per_model):
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

                if retry_on_rate_limit and response.status_code == 429 and attempt_index == 0:
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


def _is_story_turn_image_xai_model(model_name: str | None) -> bool:
    normalized_model = str(model_name or "").strip()
    return normalized_model in {STORY_TURN_IMAGE_MODEL_GROK, STORY_TURN_IMAGE_MODEL_GROK_LEGACY}


def _validate_story_turn_image_provider_config(model_name: str | None = None) -> None:
    if _is_story_turn_image_xai_model(model_name):
        if not settings.xai_image_api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="xAI image provider is not configured: set XAI_IMAGE_API_KEY",
            )
        if not settings.xai_image_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="xAI image endpoint is not configured: set XAI_IMAGE_URL",
            )
        return

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
    if body_budget < 12:
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
    world_cards: list[dict[str, Any]],
    max_cards: int | None = None,
) -> list[dict[str, Any]]:
    selected_cards: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    def _get_card_key(card: dict[str, Any]) -> str:
        card_id = card.get("id")
        if isinstance(card_id, int):
            return f"id:{card_id}"
        return (
            f"{_normalize_story_world_card_kind(str(card.get('kind', '')))}:"
            f"{str(card.get('title', '')).strip().casefold()}"
        )

    def _append_card(card: dict[str, Any]) -> bool:
        title = str(card.get("title", "")).strip()
        if not title:
            return False
        dedupe_key = _get_card_key(card)
        if dedupe_key in seen_keys:
            return False
        seen_keys.add(dedupe_key)
        selected_cards.append(card)
        return True

    normalized_max_cards = max_cards
    if normalized_max_cards is not None and normalized_max_cards <= 0:
        return []

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
        _append_card(main_hero_card)
        if normalized_max_cards is not None and len(selected_cards) >= normalized_max_cards:
            return selected_cards[:normalized_max_cards]

    for card in world_cards:
        if not isinstance(card, dict):
            continue
        if _normalize_story_world_card_kind(str(card.get("kind", ""))) != STORY_WORLD_CARD_KIND_NPC:
            continue
        appended = _append_card(card)
        if not appended:
            continue
        if normalized_max_cards is not None and len(selected_cards) >= normalized_max_cards:
            break

    if normalized_max_cards is None:
        return selected_cards
    return selected_cards[:normalized_max_cards]


def _build_story_turn_image_character_lines(
    *,
    user_prompt: str,
    assistant_text: str,
    world_cards: list[dict[str, Any]],
    max_cards: int | None = STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS,
) -> list[str]:
    character_cards = _select_story_turn_image_character_cards(
        world_cards=world_cards,
        max_cards=max_cards,
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
    _ = (user_prompt, assistant_text)
    selected_cards = _select_story_turn_image_character_cards(
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

    logger.warning(
        "Story turn image character card locks exceed token budget: %s > %s. "
        "Prompt builder will trim non-critical context to fit request limits.",
        total_tokens,
        STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS,
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
    character_world_cards: list[dict[str, Any]] | None = None,
    image_style_prompt: str | None = None,
    full_character_card_locks: list[str] | None = None,
    model_name: str | None = None,
) -> str:
    prompt_max_chars = max(_get_story_turn_image_request_prompt_max_chars(model_name), 1)
    normalized_user_prompt = re.sub(
        r"\s+",
        " ",
        _normalize_story_markup_to_plain_text(user_prompt).replace("\r\n", "\n"),
    ).strip()
    normalized_assistant_text = re.sub(
        r"\s+",
        " ",
        _normalize_story_markup_to_plain_text(assistant_text).replace("\r\n", "\n"),
    ).strip()
    normalized_image_style_prompt = _normalize_story_turn_image_style_prompt(image_style_prompt)
    effective_character_world_cards = character_world_cards if character_world_cards is not None else world_cards

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
        world_cards=effective_character_world_cards,
        max_cards=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS,
    )
    if full_character_card_locks is None:
        full_character_card_locks = _build_story_turn_image_full_character_card_locks(
            user_prompt=user_prompt,
            assistant_text=assistant_text,
            world_cards=effective_character_world_cards,
        )
    has_main_hero_line = any(line.startswith("main_hero:") for line in character_lines)
    has_gender_lock_line = any("gender-lock" in line for line in character_lines)
    has_appearance_lock_line = any("appearance-lock" in line for line in character_lines)
    style_instructions = _build_story_turn_image_style_instructions(normalized_image_style_prompt)
    scene_focus_text = _build_story_turn_image_latest_scene_focus_text(
        assistant_text,
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    assistant_context_text = normalized_assistant_text
    if not assistant_context_text and scene_focus_text:
        assistant_context_text = scene_focus_text

    prompt_parts = [
        "Single cinematic frame from one interactive RPG scene.",
        "Keep one coherent location and one coherent moment.",
    ]

    def _append_part_if_fit(value: str) -> bool:
        normalized_value = str(value or "").strip()
        if not normalized_value:
            return False
        candidate_prompt = _join_story_turn_image_prompt_parts([*prompt_parts, normalized_value])
        if len(candidate_prompt) > prompt_max_chars:
            return False
        prompt_parts.append(normalized_value)
        return True

    def _append_full_character_locks() -> list[str]:
        appended_locks: list[str] = []
        if not full_character_card_locks:
            return appended_locks
        _append_part_if_fit("CHARACTER_CARD_LOCKS (FULL, STRICT, MANDATORY):")
        for card_lock in full_character_card_locks:
            if _append_part_if_fit(card_lock):
                appended_locks.append(card_lock)
        return appended_locks

    effective_full_character_card_locks = _append_full_character_locks()
    if full_character_card_locks and not effective_full_character_card_locks:
        # Keep active character locks above all other context if the prompt budget is too tight.
        prompt_parts = []
        effective_full_character_card_locks = _append_full_character_locks()

    has_full_character_card_lock = bool(effective_full_character_card_locks)
    has_hair_length_lock = _story_turn_image_has_hair_length_lock(effective_full_character_card_locks)

    def _try_append_optional_line(value: str) -> None:
        normalized_value = str(value or "").strip()
        if not normalized_value:
            return
        candidate_prompt = _join_story_turn_image_prompt_parts([*prompt_parts, normalized_value])
        if len(candidate_prompt) <= prompt_max_chars:
            prompt_parts.append(normalized_value)

    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Player prompt: ",
        part_body=normalized_user_prompt,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Latest AI response: ",
        part_body=assistant_context_text,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    _try_append_optional_line(
        "No text, UI, watermark, logo, captions, speech bubbles, signs, letters, words, or numbers."
    )
    if has_full_character_card_lock:
        _try_append_optional_line(
            "CHARACTER_CARD_LOCK priority is absolute: "
            "CHARACTER_CARD_LOCK > appearance-lock > scene state."
        )
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
            lowered_raw_text = raw_text.lower()
            if "<!doctype" in lowered_raw_text or "<html" in lowered_raw_text:
                if "not available in your region" in lowered_raw_text:
                    detail = "This service is not available in your region."
            else:
                detail = raw_text[:500]
    if not detail:
        reason = str(getattr(response, "reason", "") or "").strip()
        if reason:
            detail = reason
    if detail:
        detail = re.sub(r"\s+", " ", detail).strip()
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


def _resolve_story_turn_image_xai_aspect_ratio(image_size: str) -> str | None:
    aspect_ratio = _resolve_story_turn_image_aspect_ratio(image_size)
    if aspect_ratio in {"1:1", "4:3", "3:4", "16:9", "9:16"}:
        return aspect_ratio
    return None


def _resolve_story_turn_image_xai_resolution(image_size: str) -> str | None:
    normalized_size = str(image_size or "").strip().lower()
    if not normalized_size:
        return None

    size_match = re.match(r"^\s*(\d{2,5})\s*[x:]\s*(\d{2,5})\s*$", normalized_size)
    if size_match is None:
        return None

    width = max(int(size_match.group(1)), 1)
    height = max(int(size_match.group(2)), 1)
    return "2k" if max(width, height) >= 1536 else "1k"


def _build_story_turn_image_openrouter_payload(
    *,
    prompt: str,
    selected_model: str,
    use_chat_completions: bool,
    reference_image_input: str | None = None,
) -> dict[str, Any]:
    if use_chat_completions:
        normalized_reference_image_input = str(reference_image_input or "").strip()
        message_content: str | list[dict[str, Any]]
        if normalized_reference_image_input:
            message_content = [{"type": "text", "text": prompt}]
        else:
            message_content = prompt
        if normalized_reference_image_input:
            message_content.append(
                {"type": "image_url", "image_url": {"url": normalized_reference_image_input}}
            )
        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": [{"role": "user", "content": message_content}],
            "modalities": ["image"],
            "stream": False,
            "provider": _build_openrouter_image_provider_payload(selected_model),
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
            raw_b64_payload = (
                str(
                    raw_value.get("b64_json")
                    or raw_value.get("image_base64")
                    or raw_value.get("base64")
                    or ""
                ).strip()
            )
            if raw_b64_payload:
                b64_payload = re.sub(r"\s+", "", raw_b64_payload)
                raw_mime_type = str(
                    raw_value.get("mime_type")
                    or raw_value.get("mimeType")
                    or raw_value.get("format")
                    or "image/png"
                ).strip().lower()
                mime_type = raw_mime_type if "/" in raw_mime_type else f"image/{raw_mime_type}"
                image_candidates.append(f"data:{mime_type};base64,{b64_payload}")

            for nested_key in ("url", "image_url", "imageUrl", "data_url", "dataUrl", "src"):
                nested_value = raw_value.get(nested_key)
                if nested_value is None:
                    continue
                if isinstance(nested_value, dict):
                    _append_image_candidate(nested_value)
                    continue
                candidate = str(nested_value or "").strip()
                if candidate:
                    image_candidates.append(candidate)
            return
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
                part_type = str(part.get("type") or "").strip().lower()
                if part_type == "text":
                    text_value = str(part.get("text") or "").strip()
                    if text_value:
                        text_parts.append(text_value)
                    continue
                if part_type in {"image", "image_url", "output_image", "input_image"}:
                    _append_image_candidate(part.get("image_url"))
                    _append_image_candidate(part.get("imageUrl"))
                    _append_image_candidate(part.get("url"))
                    _append_image_candidate(part.get("data_url"))
                    _append_image_candidate(part.get("dataUrl"))
                    _append_image_candidate(part)
            if text_parts:
                revised_prompt = " ".join(text_parts).strip()

        raw_images = message_value.get("images")
        if isinstance(raw_images, list):
            for raw_image in raw_images:
                if not isinstance(raw_image, dict):
                    _append_image_candidate(raw_image)
                    continue
                _append_image_candidate(raw_image)

        _append_image_candidate(message_value.get("image_url"))
        _append_image_candidate(message_value.get("imageUrl"))
        _append_image_candidate(message_value.get("url"))
        _append_image_candidate(message_value.get("data_url"))
        _append_image_candidate(message_value.get("dataUrl"))
        _append_image_candidate(choice.get("image_url"))
        _append_image_candidate(choice.get("imageUrl"))
        _append_image_candidate(choice.get("url"))
        _append_image_candidate(choice.get("data_url"))
        _append_image_candidate(choice.get("dataUrl"))

    _append_image_candidate(payload_value.get("image_url"))
    _append_image_candidate(payload_value.get("imageUrl"))
    _append_image_candidate(payload_value.get("url"))
    _append_image_candidate(payload_value.get("data_url"))
    _append_image_candidate(payload_value.get("dataUrl"))

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
    reference_image_url: str | None = None,
    reference_image_data_url: str | None = None,
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
    normalized_reference_image_url = str(reference_image_url or "").strip()
    normalized_reference_image_data_url = str(reference_image_data_url or "").strip()
    normalized_reference_image_input = (
        normalized_reference_image_url
        if normalized_reference_image_url.startswith(("https://", "http://"))
        else normalized_reference_image_data_url
    )
    if image_url and image_url not in {chat_url} and not normalized_reference_image_input:
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
            reference_image_input=normalized_reference_image_input,
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


def _request_xai_story_turn_image(
    *,
    prompt: str,
    model_name: str | None = None,
    reference_image_data_url: str | None = None,
) -> dict[str, str | None]:
    selected_model = (model_name or STORY_TURN_IMAGE_MODEL_GROK).strip()
    if selected_model == STORY_TURN_IMAGE_MODEL_GROK_LEGACY:
        selected_model = STORY_TURN_IMAGE_MODEL_GROK
    if not selected_model:
        raise RuntimeError("xAI image model is not configured")

    endpoint_url = str(settings.xai_image_url or "").strip()
    if not endpoint_url:
        raise RuntimeError("xAI image endpoint is not configured")

    headers = {
        "Authorization": f"Bearer {settings.xai_image_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    request_payload: dict[str, Any] = {
        "model": selected_model,
        "prompt": prompt,
        "n": 1,
    }
    normalized_reference_image_data_url = str(reference_image_data_url or "").strip()
    if normalized_reference_image_data_url:
        request_payload["image_url"] = normalized_reference_image_data_url
    image_size = str(settings.openrouter_image_size or "").strip()
    aspect_ratio = _resolve_story_turn_image_xai_aspect_ratio(image_size)
    if aspect_ratio:
        request_payload["aspect_ratio"] = aspect_ratio
    resolution = _resolve_story_turn_image_xai_resolution(image_size)
    if resolution:
        request_payload["resolution"] = resolution

    read_timeout_seconds = _get_story_turn_image_read_timeout_seconds(selected_model)
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
        raise RuntimeError("Failed to reach xAI image endpoint") from exc

    if response.status_code >= 400:
        detail = _extract_openrouter_error_detail(response)
        detail_lower = detail.lower()
        if response.status_code == status.HTTP_403_FORBIDDEN and "not available in your region" in detail_lower:
            raise RuntimeError(
                "Сервис генерации xAI недоступен в текущем регионе сервера. "
                "Выберите другую модель изображения или разверните backend в регионе, поддерживаемом xAI."
            )
        error_text = f"xAI image error ({response.status_code})"
        if detail:
            error_text = f"{error_text}: {detail}"
        raise RuntimeError(error_text)

    try:
        payload_value = response.json()
    except ValueError as exc:
        raise RuntimeError("xAI image endpoint returned invalid payload") from exc

    return _parse_openrouter_story_turn_image_payload(
        payload_value,
        selected_model=selected_model,
    )


def _request_story_turn_image(
    *,
    prompt: str,
    model_name: str | None = None,
    reference_image_url: str | None = None,
    reference_image_data_url: str | None = None,
) -> dict[str, str | None]:
    if _is_story_turn_image_xai_model(model_name):
        return _request_xai_story_turn_image(
            prompt=prompt,
            model_name=model_name,
            reference_image_data_url=reference_image_data_url,
        )
    return _request_openrouter_story_turn_image(
        prompt=prompt,
        model_name=model_name,
        reference_image_url=reference_image_url,
        reference_image_data_url=reference_image_data_url,
    )


def _compact_story_character_avatar_prompt_text(value: str | None, *, max_chars: int) -> str:
    normalized = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        return ""
    return normalized[:max_chars].rstrip()


def _normalize_story_character_avatar_prompt_triggers(values: list[str] | None) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized_values: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        if not isinstance(raw_value, str):
            continue
        trigger_value = _compact_story_character_avatar_prompt_text(raw_value, max_chars=120)
        if not trigger_value:
            continue
        key = trigger_value.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized_values.append(trigger_value)
        if len(normalized_values) >= 12:
            break
    return normalized_values


def _build_story_character_avatar_prompt(
    *,
    name: str | None,
    description: str | None,
    style_prompt: str | None,
    triggers: list[str] | None,
) -> str:
    normalized_description = _compact_story_character_avatar_prompt_text(description, max_chars=1600)
    normalized_style_prompt = _compact_story_character_avatar_prompt_text(style_prompt, max_chars=320)
    if not normalized_description:
        return ""

    prompt_lines = [
        "Create a character reference illustration.",
        "Single character only.",
        "Full-body framing: show the character from head to toe in a standing pose.",
        "Keep the character centered with clean margins around the silhouette.",
        "No extra people, no text, no logos, no watermark, no frame.",
        "Use high-detail stylized game art lighting and readable facial features.",
        "Use only the player's character appearance description below as the source of visual details.",
        f"Character appearance description: {normalized_description}.",
    ]
    if normalized_style_prompt:
        prompt_lines.append(f"Preferred visual style: {normalized_style_prompt}.")

    return "\n".join(prompt_lines).strip()


def _build_story_character_emotion_reference_prompt(
    *,
    description: str | None,
    style_prompt: str | None,
) -> str:
    normalized_description = _compact_story_character_avatar_prompt_text(
        description,
        max_chars=STORY_CHARACTER_EMOTION_REFERENCE_MAX_CHARS,
    )
    normalized_style_prompt = _compact_story_character_avatar_prompt_text(
        style_prompt,
        max_chars=STORY_CHARACTER_EMOTION_EDIT_STYLE_MAX_CHARS,
    )
    if not normalized_description:
        return ""

    prompt_lines = [
        "Create a visual novel character reference sprite.",
        "Single character only.",
        "Belt-line sprite framing: show the character from head down to the hips or belt line, so the legs are outside the frame but the torso is mostly visible.",
        "Keep the character centered with clean margins around the silhouette.",
        "Use a plain pure white studio background or another flat cutout-friendly background with no scenery so the character can be extracted as a transparent sprite.",
        "No props, no weapons unless explicitly described, no scenery, no text, no watermark, no frame.",
        "Readable face, consistent costume, consistent anatomy, consistent proportions.",
        f"Character appearance description: {normalized_description}.",
    ]
    if normalized_style_prompt:
        prompt_lines.append(f"Preferred visual style: {normalized_style_prompt}.")
    return "\n".join(prompt_lines).strip()


def _build_story_character_emotion_prompt_lock(
    *,
    description: str | None,
    style_prompt: str | None,
) -> str:
    normalized_description = _compact_story_character_avatar_prompt_text(
        description,
        max_chars=STORY_CHARACTER_EMOTION_REFERENCE_MAX_CHARS,
    )
    normalized_style_prompt = _compact_story_character_avatar_prompt_text(
        style_prompt,
        max_chars=STORY_CHARACTER_EMOTION_EDIT_STYLE_MAX_CHARS,
    )
    prompt_lines = [
        "Keep the exact same character identity as in the reference image.",
        "Preserve face shape, eye shape, hair color, hairstyle, skin tone, body proportions, clothing, accessories, and art style.",
        "Do not change the outfit, age, body type, gender presentation, or core silhouette.",
        "Keep the camera framing in the visual-novel sprite range: head to upper hips or belt buckle, readable face, readable chest, visible waist, and most of the torso visible.",
        "Hide the legs below the hips; the frame should stop around the belt line.",
        "Emotion variants may change arm pose, hand placement, shoulder angle, torso angle, and body language when needed.",
        "Do not freeze every emotion into the same pose template.",
    ]
    if normalized_description:
        prompt_lines.append(f"Identity brief: {normalized_description}.")
    if normalized_style_prompt:
        prompt_lines.append(f"Style lock: {normalized_style_prompt}.")
    return "\n".join(prompt_lines).strip()


def _resolve_story_character_emotion_descriptor(emotion_id: str) -> str:
    descriptor_by_emotion = {
        "calm": "calm and composed",
        "angry": "angry and tense",
        "irritated": "irritated and impatient",
        "stern": "stern, strict, and authoritative",
        "cheerful": "cheerful and lively",
        "smiling": "warm and smiling",
        "sly": "sly and cunning",
        "alert": "alert and wary",
        "scared": "scared and shaken",
        "happy": "happy and openly joyful",
        "embarrassed": "embarrassed, bashful, and visibly flustered",
        "confused": "confused, hesitant, and somewhat disoriented",
        "thoughtful": "thoughtful, pensive, and visibly lost in thought",
    }
    return descriptor_by_emotion.get(emotion_id, "calm and composed")


def _build_story_character_emotion_edit_prompt(
    *,
    emotion_id: str,
    emotion_prompt_lock: str,
) -> str:
    descriptor = _resolve_story_character_emotion_descriptor(emotion_id)
    prompt_lines = [
        "Edit the provided character reference image into a visual novel sprite.",
        "Single character only.",
        emotion_prompt_lock,
        f"Change the facial expression, hands, shoulders, torso angle, and pose so the character clearly reads as {descriptor}.",
        "Use emotion-appropriate upper-body posing, for example crossed arms for anger or strictness, recoiling posture for fear, open posture for joy, wary tension for alertness, bashful hand-to-face gestures for embarrassment, or reflective hand/chin posing for thoughtful scenes when suitable.",
        "Allow strong emotion-appropriate body language and a genuinely different upper-body pose when it helps readability.",
        "Keep the same character identity, outfit, and art style, but do not freeze the sprite into the exact same pose.",
        "Frame the sprite from the head down to the upper hips or belt buckle area, with the full face, chest, waist, and hands visible when possible.",
        "Legs below the belt line should stay out of frame.",
        "Use a plain pure white or near-white flat studio background with no scenery so post-processing can extract a clean transparent PNG sprite.",
        "No props, no scenery, no extra people, no text, no watermark, no frame.",
    ]
    return "\n".join(line for line in prompt_lines if line).strip()


def _normalize_story_scene_emotion_lookup_value(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("ё", "е")
    normalized = re.sub(r"[^0-9a-zа-я\s-]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _build_story_scene_emotion_cast_entries(world_cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen_display_names: set[str] = set()

    for card in world_cards[:24]:
        if not isinstance(card, dict):
            continue
        kind = str(card.get("kind") or "").strip().lower()
        if kind not in {"npc", "main_hero"}:
            continue

        display_name = " ".join(str(card.get("title") or "").split()).strip()
        if not display_name:
            continue

        display_name_key = display_name.casefold()
        if display_name_key in seen_display_names:
            continue
        seen_display_names.add(display_name_key)

        aliases: set[str] = set()

        def _append_alias(raw_alias: Any) -> None:
            normalized_alias = _normalize_story_scene_emotion_lookup_value(raw_alias)
            if not normalized_alias:
                return
            aliases.add(normalized_alias)
            for token in normalized_alias.split():
                if len(token) >= 2:
                    aliases.add(token)

        _append_alias(display_name)
        raw_triggers = card.get("triggers")
        trigger_values = raw_triggers if isinstance(raw_triggers, list) else []
        for trigger_value in trigger_values:
            _append_alias(trigger_value)

        if kind == "main_hero":
            for alias in STORY_SCENE_EMOTION_MAIN_HERO_ALIASES:
                _append_alias(alias)

        if not aliases:
            continue
        entries.append(
            {
                "display_name": display_name,
                "aliases": aliases,
                "is_main_hero": kind == "main_hero",
            }
        )

    return entries


def _story_scene_text_contains_alias(normalized_text: str, alias: str) -> bool:
    if not normalized_text or not alias:
        return False
    haystack = f" {normalized_text} "
    needle = f" {alias} "
    return needle in haystack


def _match_story_scene_emotion_cast_entry(
    raw_name: str,
    cast_entries: list[dict[str, Any]],
) -> dict[str, Any] | None:
    normalized_name = _normalize_story_scene_emotion_lookup_value(raw_name)
    if not normalized_name:
        return None

    for entry in cast_entries:
        aliases = entry.get("aliases")
        if isinstance(aliases, set) and normalized_name in aliases:
            return entry

    for entry in cast_entries:
        aliases = entry.get("aliases")
        if not isinstance(aliases, set):
            continue
        if any(
            normalized_name.startswith(alias)
            or alias.startswith(normalized_name)
            or _story_scene_text_contains_alias(normalized_name, alias)
            or _story_scene_text_contains_alias(alias, normalized_name)
            for alias in aliases
            if alias
        ):
            return entry

    return None


def _canonicalize_story_scene_emotion_payload(
    payload: dict[str, Any] | None,
    *,
    world_cards: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    cast_entries = _build_story_scene_emotion_cast_entries(world_cards)
    if not cast_entries:
        return payload

    raw_participants = payload.get("participants")
    participants = raw_participants if isinstance(raw_participants, list) else []
    resolved_participants: list[dict[str, str]] = []
    seen_names: set[str] = set()

    for index, participant in enumerate(participants):
        if not isinstance(participant, dict):
            continue
        raw_name = str(participant.get("name") or "").strip()
        if not raw_name:
            continue
        matched_entry = _match_story_scene_emotion_cast_entry(raw_name, cast_entries)
        resolved_name = str(matched_entry.get("display_name") or "").strip() if matched_entry else raw_name
        if not resolved_name:
            continue
        resolved_name_key = resolved_name.casefold()
        if resolved_name_key in seen_names:
            continue
        seen_names.add(resolved_name_key)
        resolved_participants.append(
            {
                "name": resolved_name,
                "emotion": str(participant.get("emotion") or "").strip(),
                "importance": "primary"
                if index == 0
                else ("secondary" if str(participant.get("importance") or "").strip().lower() == "secondary" else "primary"),
            }
        )

    normalized_payload = {
        "show_visualization": bool(payload.get("show_visualization")) and len(resolved_participants) > 0,
        "reason": str(payload.get("reason") or "").strip() or "interaction",
        "participants": resolved_participants,
    }
    return _normalize_story_scene_emotion_payload(normalized_payload)


def _build_story_scene_emotion_active_cast_entries(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    world_cards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cast_entries = _build_story_scene_emotion_cast_entries(world_cards)
    if not cast_entries:
        return []

    normalized_combined_text = _normalize_story_scene_emotion_lookup_value(
        "\n".join(part for part in (latest_user_prompt, latest_assistant_text) if part)
    )
    main_hero_entry = next((entry for entry in cast_entries if entry.get("is_main_hero")), None)
    active_entries: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    def _append_entry(entry: dict[str, Any]) -> None:
        display_name = str(entry.get("display_name") or "").strip()
        if not display_name:
            return
        display_name_key = display_name.casefold()
        if display_name_key in seen_names:
            return
        seen_names.add(display_name_key)
        active_entries.append(entry)

    if main_hero_entry is not None:
        _append_entry(main_hero_entry)

    scored_entries: list[tuple[int, dict[str, Any]]] = []
    for entry in cast_entries:
        if entry.get("is_main_hero"):
            continue
        aliases = entry.get("aliases")
        if not isinstance(aliases, set):
            continue
        alias_scores = [len(alias) for alias in aliases if _story_scene_text_contains_alias(normalized_combined_text, alias)]
        if alias_scores:
            scored_entries.append((max(alias_scores), entry))

    scored_entries.sort(key=lambda item: item[0], reverse=True)
    for _, entry in scored_entries:
        _append_entry(entry)
        if len(active_entries) >= 4:
            break

    if not active_entries:
        for entry in cast_entries[:4]:
            _append_entry(entry)

    return active_entries[:4]


def _build_story_scene_emotion_tool_definition(active_cast_entries: list[dict[str, Any]]) -> dict[str, Any]:
    active_names = [
        str(entry.get("display_name") or "").strip()
        for entry in active_cast_entries
        if str(entry.get("display_name") or "").strip()
    ]
    if not active_names:
        active_names = ["Main Hero"]

    return {
        "type": "function",
        "function": {
            "name": "report_scene_emotions",
            "description": (
                "Decide whether the current scene should show visual-novel emotion sprites and "
                "report exact emotion ids for the active characters only."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "show_visualization": {
                        "type": "boolean",
                    },
                    "reason": {
                        "type": "string",
                        "maxLength": 64,
                    },
                    "participants": {
                        "type": "array",
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "enum": active_names,
                                },
                                "emotion": {
                                    "type": "string",
                                    "enum": list(_STORY_CHARACTER_EMOTION_IDS),
                                },
                                "importance": {
                                    "type": "string",
                                    "enum": ["primary", "secondary"],
                                },
                            },
                            "required": ["name", "emotion", "importance"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["show_visualization", "reason", "participants"],
                "additionalProperties": False,
            },
        },
    }


def _detect_story_scene_emotion_keyword(normalized_text: str) -> str | None:
    if not normalized_text:
        return None

    keyword_map: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("embarrassed", ("смущ", "неловк", "румян", "засмущ", "fluster", "blush", "awkward", "bashful")),
        ("confused", ("растерян", "замешатель", "не понима", "сбит с толку", "confus", "disorient", "hesitan")),
        ("scared", ("испуган", "напуган", "страх", "боит", "ужас", "дрож", "terrified", "afraid", "scared")),
        ("angry", ("зл", "гнев", "ярост", "в бешен", "furious", "angry", "rage")),
        ("irritated", ("раздраж", "недоволь", "ворчит", "annoy", "irritat", "impatient")),
        ("alert", ("насторож", "подозр", "напряг", "угроз", "опасн", "враг", "бандит", "alert", "wary", "danger")),
        ("happy", ("счастлив", "счастье", "радост", "доволен", "happy", "joyful", "delighted")),
        ("cheerful", ("весел", "оживлен", "бодр", "cheerful", "lively", "playful")),
        ("smiling", ("улыба", "улыб", "smiling", "smile", "grin")),
        ("sly", ("хитр", "лукав", "усмеш", "sly", "cunning", "smirk")),
        ("calm", ("споко", "ровно", "calm", "composed", "steady")),
    )
    keyword_map += (
        ("stern", ("strict", "authoritative", "severe")),
        ("thoughtful", ("thoughtful", "pensive", "lost in thought")),
    )

    for emotion_id, keywords in keyword_map:
        if any(keyword in normalized_text for keyword in keywords):
            return emotion_id
    return None


def _build_story_scene_emotion_keyword_fallback_payload(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    world_cards: list[dict[str, Any]],
) -> str | None:
    normalized_user_prompt = _normalize_story_scene_emotion_lookup_value(latest_user_prompt)
    normalized_assistant_text = _normalize_story_scene_emotion_lookup_value(latest_assistant_text)
    combined_text = " ".join(part for part in (normalized_user_prompt, normalized_assistant_text) if part).strip()
    if not combined_text:
        return None

    emotion_id = _detect_story_scene_emotion_keyword(combined_text)
    if emotion_id is None:
        return None

    cast_entries = _build_story_scene_emotion_cast_entries(world_cards)
    if not cast_entries:
        return None

    main_hero_entry = next((entry for entry in cast_entries if entry.get("is_main_hero")), None)
    hero_is_involved = (
        main_hero_entry is not None
        and any(_story_scene_text_contains_alias(combined_text, alias) for alias in STORY_SCENE_EMOTION_MAIN_HERO_ALIASES)
    )
    mentioned_entries = [
        entry
        for entry in cast_entries
        if any(_story_scene_text_contains_alias(combined_text, alias) for alias in entry.get("aliases", set()))
    ]
    non_hero_entries = [entry for entry in mentioned_entries if not entry.get("is_main_hero")]

    original_assistant_text = latest_assistant_text or ""
    has_dialogue = any(token in original_assistant_text for token in ("—", "«", "»", "\""))
    interaction_markers = (
        " рядом с ",
        " вместе ",
        " говорит ",
        " сказал ",
        " сказала ",
        " отвечает ",
        " ответил ",
        " ответила ",
        " встрет",
        " смотрит на ",
        " идет с ",
        " идешь с ",
        " пошел с ",
        " пошла с ",
        " мы оба ",
        " оба ",
    )
    has_interaction = has_dialogue or any(marker in f" {combined_text} " for marker in interaction_markers)
    if not has_interaction and len(non_hero_entries) >= 2:
        has_interaction = True
    if not has_interaction and hero_is_involved and non_hero_entries:
        has_interaction = True
    if not has_interaction:
        return None

    selected_entries: list[dict[str, Any]] = []
    if hero_is_involved and main_hero_entry is not None:
        selected_entries.append(main_hero_entry)
    for entry in non_hero_entries:
        if any(existing.get("display_name") == entry.get("display_name") for existing in selected_entries):
            continue
        selected_entries.append(entry)
        if len(selected_entries) >= 2:
            break

    if not selected_entries and mentioned_entries:
        selected_entries.append(mentioned_entries[0])
    if len(selected_entries) == 1 and main_hero_entry is not None and non_hero_entries and not selected_entries[0].get("is_main_hero"):
        selected_entries = [main_hero_entry, selected_entries[0]]
    if not selected_entries:
        return None

    fallback_payload = {
        "show_visualization": True,
        "reason": "keyword_fallback",
        "participants": [
            {
                "name": str(entry.get("display_name") or "").strip(),
                "emotion": emotion_id,
                "importance": "primary" if index == 0 else "secondary",
            }
            for index, entry in enumerate(selected_entries[:2])
            if str(entry.get("display_name") or "").strip()
        ],
    }
    normalized_payload = _normalize_story_scene_emotion_payload(fallback_payload)
    if not isinstance(normalized_payload, dict) or not normalized_payload.get("show_visualization"):
        return None
    return _serialize_story_scene_emotion_payload(normalized_payload)


def _build_story_scene_emotion_analysis_messages(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    active_cast_entries: list[dict[str, Any]],
) -> list[dict[str, str]]:
    character_lines: list[str] = []
    emotion_lines = [
        f"- {emotion_id}: {_resolve_story_character_emotion_descriptor(emotion_id)}"
        for emotion_id in _STORY_CHARACTER_EMOTION_IDS
    ]
    for index, entry in enumerate(active_cast_entries[:6], start=1):
        title = " ".join(str(entry.get("display_name") or "").split()).strip()
        if not title:
            continue
        kind = "main_hero" if entry.get("is_main_hero") else "npc"
        aliases = entry.get("aliases")
        alias_values = aliases if isinstance(aliases, set) else set()
        trigger_line = ", ".join(
            alias
            for alias in sorted(alias_values, key=len, reverse=True)[:6]
            if isinstance(alias, str) and alias.strip()
        )
        character_lines.append(
            f"{index}. {title} [{kind}]"
            + (f" aliases: {trigger_line}" if trigger_line else "")
        )

    system_prompt = "\n".join(
        [
            "You decide whether a scene should show visual-novel emotion sprites.",
            "Respond with exactly one minified JSON object and nothing else.",
            'Use this schema: {"show_visualization":boolean,"reason":string,"participants":[{"name":string,"emotion":string,"importance":"primary"|"secondary"}]}.',
            "Decide only for the active characters provided below.",
            "Rules:",
            "- Use show_visualization=true only for direct interaction, dialogue, coordinated movement between named characters, or a meaningful encounter/threat affecting a named character.",
            "- Use false for solo travel, pure scenery, routine narration, generic atmosphere, or any scene without a meaningful character interaction hook.",
            "- Use only these emotion ids: calm, angry, irritated, stern, cheerful, smiling, sly, alert, scared, happy, embarrassed, confused, thoughtful.",
            "- If the main hero is active and show_visualization=true, include the main hero as the first participant.",
            "- Include the involved NPCs after the main hero when they are part of the interaction.",
            "- Include at most four participants total.",
            "- Use only exact names from the active character list, never pronouns like you, he, she, they, the girl, or the boy.",
            "- If a named character encounters danger, choose alert or scared depending on the severity.",
            "- If the scene is interactive but emotion is mild, use calm or smiling.",
            "- Use embarrassed for shyness, awkwardness, blush, or social discomfort.",
            "- Use confused for uncertainty, disorientation, misunderstanding, or visible confusion.",
            "- Use stern for authoritative, strict, cold, severe, or hard-line reactions.",
            "- Use thoughtful for reflective pauses, deep thinking, hesitation with introspection, or pensive silence.",
        ]
    )
    user_prompt = "\n".join(
        [
            "Supported emotion ids:",
            "\n".join(emotion_lines),
            "",
            "Active characters for this turn:",
            "\n".join(character_lines) if character_lines else "No active characters detected.",
            "",
            "Latest player action:",
            latest_user_prompt or "None.",
            "",
            "Latest narrator response:",
            latest_assistant_text or "None.",
        ]
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def _try_fetch_story_character_avatar_data_url(image_url: str | None) -> str | None:
    normalized_url = str(image_url or "").strip()
    if not normalized_url:
        return None
    if normalized_url.lower().startswith("data:image/"):
        return normalized_url
    if not normalized_url.lower().startswith(("https://", "http://")):
        return None

    request_headers = {
        "Accept": "image/*,*/*;q=0.8",
        "User-Agent": "MoRius/1.0",
    }
    if "openrouter.ai" in normalized_url.lower() and settings.openrouter_api_key:
        request_headers["Authorization"] = f"Bearer {settings.openrouter_api_key}"
    if settings.openrouter_site_url:
        request_headers["Referer"] = settings.openrouter_site_url

    try:
        response = HTTP_SESSION.get(
            normalized_url,
            headers=request_headers,
            timeout=(
                STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS,
                STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT,
            ),
        )
    except requests.RequestException:
        return None

    if response.status_code >= 400:
        return None
    payload = response.content
    if not payload:
        return None

    content_type = str(response.headers.get("Content-Type") or "").split(";", maxsplit=1)[0].strip().lower()
    if not content_type.startswith("image/"):
        content_type = "image/png"
    encoded_payload = base64.b64encode(payload).decode("ascii")
    return f"data:{content_type};base64,{encoded_payload}"


def _decode_story_image_data_url_payload(data_url: str | None) -> tuple[bytes, str] | None:
    normalized_data_url = str(data_url or "").strip()
    if not normalized_data_url.lower().startswith("data:image/"):
        return None
    header, separator, payload = normalized_data_url.partition(",")
    if separator != "," or ";base64" not in header.lower():
        return None
    mime_type = header[5:].split(";", maxsplit=1)[0].strip().lower() or "image/png"
    try:
        decoded_payload = base64.b64decode(payload, validate=True)
    except (BinasciiError, ValueError):
        return None
    if not decoded_payload:
        return None
    return decoded_payload, mime_type


def _encode_story_image_data_url(payload: bytes, *, mime_type: str) -> str | None:
    if not payload:
        return None
    encoded_payload = base64.b64encode(payload).decode("ascii")
    normalized_mime_type = str(mime_type or "").strip().lower() or "image/png"
    return f"data:{normalized_mime_type};base64,{encoded_payload}"


def _trim_story_sprite_transparent_bounds(image: Image.Image, *, padding: int = 18) -> Image.Image:
    rgba_image = image.convert("RGBA")
    alpha_channel = rgba_image.getchannel("A")
    bounding_box = alpha_channel.getbbox()
    if bounding_box is None:
        return rgba_image

    left, top, right, bottom = bounding_box
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(rgba_image.width, right + padding)
    bottom = min(rgba_image.height, bottom + padding)
    return rgba_image.crop((left, top, right, bottom))


def _clean_story_sprite_edge_halo(image: Image.Image) -> Image.Image:
    from PIL import ImageFilter

    rgba_image = image.convert("RGBA")
    softened_alpha = rgba_image.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(radius=0.7))
    rgba_image.putalpha(softened_alpha)

    pixel_access = rgba_image.load()
    width, height = rgba_image.size
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixel_access[x, y]
            if alpha == 0:
                pixel_access[x, y] = (0, 0, 0, 0)
                continue
            if alpha >= 250:
                continue
            channel_min = min(red, green, blue)
            channel_max = max(red, green, blue)
            if channel_max - channel_min > 48 or channel_max < 170:
                continue
            edge_factor = 1.0 - (alpha / 255.0)
            darken_factor = max(0.62, 1.0 - edge_factor * 0.46)
            pixel_access[x, y] = (
                int(red * darken_factor),
                int(green * darken_factor),
                int(blue * darken_factor),
                alpha,
            )
    return rgba_image


def _serialize_story_sprite_image(image: Image.Image) -> str | None:
    from PIL import Image as PilImage

    image_resampling_lanczos = getattr(getattr(PilImage, "Resampling", PilImage), "LANCZOS")
    prepared_image = image.convert("RGBA")
    max_dimension = 1024
    if prepared_image.width > max_dimension or prepared_image.height > max_dimension:
        resized_image = prepared_image.copy()
        resized_image.thumbnail((max_dimension, max_dimension), image_resampling_lanczos)
        prepared_image = resized_image

    target_max_bytes = 420 * 1024
    scale_candidates = (1.0, 0.92, 0.84, 0.76)
    quality_candidates = (92, 88, 84, 80, 76, 72)
    best_payload: bytes | None = None
    best_mime_type = "image/webp"

    for scale in scale_candidates:
        if scale >= 0.999:
            scaled_image = prepared_image
        else:
            scaled_width = max(1, int(round(prepared_image.width * scale)))
            scaled_height = max(1, int(round(prepared_image.height * scale)))
            scaled_image = prepared_image.resize((scaled_width, scaled_height), image_resampling_lanczos)

        for quality in quality_candidates:
            output_buffer = io.BytesIO()
            scaled_image.save(
                output_buffer,
                format="WEBP",
                quality=quality,
                alpha_quality=95,
                method=6,
            )
            candidate_payload = output_buffer.getvalue()
            if best_payload is None or len(candidate_payload) < len(best_payload):
                best_payload = candidate_payload
            if len(candidate_payload) <= target_max_bytes:
                return _encode_story_image_data_url(candidate_payload, mime_type="image/webp")

    if best_payload:
        return _encode_story_image_data_url(best_payload, mime_type=best_mime_type)

    output_buffer = io.BytesIO()
    prepared_image.save(output_buffer, format="PNG")
    return _encode_story_image_data_url(output_buffer.getvalue(), mime_type="image/png")


def _get_story_sprite_removal_session() -> Any:
    global STORY_SPRITE_REMOVAL_SESSION

    if STORY_SPRITE_REMOVAL_SESSION is not None:
        return STORY_SPRITE_REMOVAL_SESSION

    with STORY_SPRITE_REMOVAL_SESSION_LOCK:
        if STORY_SPRITE_REMOVAL_SESSION is not None:
            return STORY_SPRITE_REMOVAL_SESSION
        try:
            from rembg import new_session as rembg_new_session
        except Exception:
            return None
        for model_name in ("isnet-anime", "u2net"):
            try:
                STORY_SPRITE_REMOVAL_SESSION = rembg_new_session(model_name)
                return STORY_SPRITE_REMOVAL_SESSION
            except Exception:
                logger.warning("Story sprite removal session init failed for model=%s", model_name, exc_info=True)
        return None


def _remove_story_sprite_background_data_url(data_url: str | None) -> str | None:
    decoded_payload = _decode_story_image_data_url_payload(data_url)
    if decoded_payload is None:
        return data_url

    payload_bytes, _mime_type = decoded_payload
    session = _get_story_sprite_removal_session()
    if session is None:
        return data_url

    try:
        from rembg import remove as rembg_remove
        from PIL import Image
    except Exception:
        return data_url

    try:
        cleaned_payload = rembg_remove(
            payload_bytes,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=8,
            alpha_matting_erode_size=8,
            post_process_mask=True,
        )
    except Exception:
        logger.warning("Story sprite background removal failed; returning original asset", exc_info=True)
        return data_url

    try:
        with Image.open(io.BytesIO(cleaned_payload)) as cleaned_image:
            processed_image = _clean_story_sprite_edge_halo(_trim_story_sprite_transparent_bounds(cleaned_image))
            output_buffer = io.BytesIO()
            processed_image.save(output_buffer, format="PNG")
    except Exception:
        logger.warning("Story sprite post-processing failed; returning original asset", exc_info=True)
        return data_url

    return _serialize_story_sprite_image(processed_image) or data_url


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
    story_temperature: float = 1.0,
    story_top_k: int = 0,
    story_top_r: float = 1.0,
    story_response_max_tokens: int | None = None,
    use_plot_memory: bool = False,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
    raw_output_collector: dict[str, str] | None = None,
):
    provider = _effective_story_llm_provider()

    if provider == "gigachat":
        logger.info(
            "Story stream provider dispatch: provider=%s model=%s use_plot_memory=%s",
            provider,
            settings.gigachat_model,
            use_plot_memory,
        )
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=settings.gigachat_model,
        )
        input_translation_enabled = _is_story_input_translation_enabled()
        output_translation_enabled = _is_story_output_translation_enabled()
        raw_chunk_stream = _iter_gigachat_story_stream_chunks(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_chars=context_limit_chars,
            response_max_tokens=effective_response_max_tokens,
            translate_for_model=input_translation_enabled,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )
        if output_translation_enabled:
            yield from _yield_story_translated_stream_chunks(
                raw_chunk_stream,
                source_model_name=settings.gigachat_model,
                force_output_translation=False,
                raw_output_collector=raw_output_collector,
            )
            return

        raw_chunks: list[str] = []
        for chunk in raw_chunk_stream:
            raw_chunks.append(chunk)
            yield chunk
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = "".join(raw_chunks)
        return

    if provider == "openrouter":
        selected_model_name = (story_model_name or settings.openrouter_model).strip() or settings.openrouter_model
        logger.info(
            "Story stream provider dispatch: provider=%s model=%s use_plot_memory=%s",
            provider,
            selected_model_name,
            use_plot_memory,
        )
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=selected_model_name,
        )
        top_k_value, top_p_value = _select_story_sampling_values(
            model_name=selected_model_name,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
        )
        temperature_value = _select_story_temperature_value(
            model_name=selected_model_name,
            story_temperature=story_temperature,
        )
        input_translation_enabled = _is_story_input_translation_enabled()
        output_translation_enabled = _is_story_output_translation_enabled()
        if output_translation_enabled:
            raw_chunk_stream = _iter_openrouter_story_stream_chunks(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                use_plot_memory=use_plot_memory,
                context_limit_chars=context_limit_chars,
                model_name=selected_model_name,
                temperature=temperature_value,
                top_k=top_k_value,
                top_p=top_p_value,
                max_tokens=effective_response_max_tokens,
                translate_for_model=input_translation_enabled,
                show_gg_thoughts=show_gg_thoughts,
                show_npc_thoughts=show_npc_thoughts,
            )
            yield from _yield_story_translated_stream_chunks(
                raw_chunk_stream,
                source_model_name=selected_model_name,
                force_output_translation=False,
                raw_output_collector=raw_output_collector,
            )
            return

        # Important: do not force-translate each stream chunk for force models.
        # We stream raw chunks and run one final language enforcement pass on the full text.
        raw_chunks: list[str] = []
        for chunk in _iter_openrouter_story_stream_chunks(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_chars=context_limit_chars,
            model_name=selected_model_name,
            temperature=temperature_value,
            top_k=top_k_value,
            top_p=top_p_value,
            max_tokens=effective_response_max_tokens,
            translate_for_model=input_translation_enabled,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        ):
            raw_chunks.append(chunk)
            yield chunk
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = "".join(raw_chunks)
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
        list_story_prompt_memory_cards=_list_story_prompt_memory_cards,
        list_story_memory_blocks=_list_story_memory_blocks,
        seed_opening_scene_memory_block=_seed_story_opening_scene_memory_block,
        memory_block_to_out=_story_memory_block_to_out,
        plot_card_to_out=_story_plot_card_to_out,
        world_card_to_out=_story_world_card_to_out,
        world_card_event_to_out=_story_world_card_change_event_to_out,
        plot_card_event_to_out=_story_plot_card_change_event_to_out,
        resolve_story_ambient_profile=_resolve_story_ambient_profile,
        resolve_story_scene_emotion_payload=_request_story_scene_emotion_payload,
        resolve_story_turn_postprocess_payload=_resolve_story_turn_postprocess_payload,
        serialize_story_ambient_profile=_serialize_story_ambient_profile,
        story_game_summary_to_out=_story_game_summary_to_out,
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
    try:
        return _generate_story_response(
            deps=_build_story_runtime_deps(),
            game_id=game_id,
            payload=payload,
            authorization=authorization,
            db=db,
        )
    except HTTPException as exc:
        detail = str(getattr(exc, "detail", "") or "").strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(
            "Story generate request failed before stream start: game_id=%s status=%s detail=%s",
            game_id,
            exc.status_code,
            detail or "n/a",
        )
        if exc.status_code == status.HTTP_400_BAD_REQUEST and _is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_public_story_provider_failure_detail(detail),
            ) from exc
        raise
    except Exception as exc:
        detail = str(exc).strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception(
            "Story generate request crashed before stream start: game_id=%s detail=%s",
            game_id,
            detail or "n/a",
        )
        if _is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_public_story_provider_failure_detail(detail),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(detail or "Story state could not be prepared before generation")[:500],
        ) from exc


def generate_story_character_avatar_impl(
    payload: StoryCharacterAvatarGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryCharacterAvatarGenerateOut:
    selected_image_model = _coerce_story_image_model(getattr(payload, "image_model", None))
    _validate_story_turn_image_provider_config(selected_image_model)
    user = _get_current_user(db, authorization)

    visual_prompt = _build_story_character_avatar_prompt(
        name=getattr(payload, "name", None),
        description=getattr(payload, "description", None),
        style_prompt=getattr(payload, "style_prompt", None),
        triggers=getattr(payload, "triggers", None),
    )
    visual_prompt = _limit_story_turn_image_request_prompt(
        visual_prompt,
        model_name=selected_image_model,
    )
    if not visual_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Character description is required for avatar generation",
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

    try:
        generation_payload = _request_story_turn_image(
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
            logger.exception("Story character avatar token refund failed after generation error: user_id=%s", user.id)
        detail = str(exc).strip() or "Image generation failed"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail[:500]) from exc

    resolved_model = str(generation_payload.get("model") or selected_image_model).strip() or selected_image_model
    resolved_revised_prompt = str(generation_payload.get("revised_prompt") or "").strip() or None
    resolved_image_url = str(generation_payload.get("image_url") or "").strip() or None
    resolved_image_data_url = str(generation_payload.get("image_data_url") or "").strip() or None
    if resolved_image_data_url is None and resolved_image_url is not None:
        resolved_image_data_url = _try_fetch_story_character_avatar_data_url(resolved_image_url)

    if resolved_image_url is None and resolved_image_data_url is None:
        try:
            _add_user_tokens(db, int(user.id), image_generation_cost)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            logger.exception(
                "Story character avatar token refund failed after empty payload: user_id=%s",
                user.id,
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image generation returned no image payload",
        )

    return StoryCharacterAvatarGenerateOut(
        model=resolved_model,
        prompt=visual_prompt,
        revised_prompt=resolved_revised_prompt,
        image_url=resolved_image_url,
        image_data_url=resolved_image_data_url,
        user=UserOut.model_validate(user),
    )


def _resolve_story_character_reference_image_data_url(reference_avatar_url: str | None) -> tuple[str | None, str | None]:
    normalized_reference_avatar_url = str(reference_avatar_url or "").strip()
    if not normalized_reference_avatar_url:
        return None, None
    if normalized_reference_avatar_url.lower().startswith("data:image/"):
        return None, normalized_reference_avatar_url
    return normalized_reference_avatar_url, _try_fetch_story_character_avatar_data_url(normalized_reference_avatar_url)


def _finalize_story_character_emotion_asset(
    *,
    image_url: str | None = None,
    image_data_url: str | None = None,
) -> str | None:
    resolved_image_data_url = str(image_data_url or "").strip() or None
    resolved_image_url = str(image_url or "").strip() or None
    if resolved_image_data_url is None and resolved_image_url is not None:
        resolved_image_data_url = _try_fetch_story_character_avatar_data_url(resolved_image_url)
    if resolved_image_data_url:
        cleaned_image_data_url = _remove_story_sprite_background_data_url(resolved_image_data_url)
        return str(cleaned_image_data_url or resolved_image_data_url).strip() or None
    return resolved_image_url


def _serialize_story_character_emotion_job_request_payload(
    payload: StoryCharacterEmotionGenerateRequest,
) -> str:
    return json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"))


def _deserialize_story_character_emotion_job_request_payload(
    raw_value: str | None,
) -> StoryCharacterEmotionGenerateRequest | None:
    normalized_raw_value = str(raw_value or "").strip()
    if not normalized_raw_value:
        return None
    try:
        parsed_payload = json.loads(normalized_raw_value)
    except (TypeError, ValueError):
        return None
    try:
        return StoryCharacterEmotionGenerateRequest.model_validate(parsed_payload)
    except Exception:
        return None


def _serialize_story_character_emotion_job_result_payload(
    payload: StoryCharacterEmotionGenerateOut,
) -> str:
    return json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"))


def _deserialize_story_character_emotion_job_result_payload(
    raw_value: str | None,
) -> StoryCharacterEmotionGenerateOut | None:
    normalized_raw_value = str(raw_value or "").strip()
    if not normalized_raw_value:
        return None
    try:
        parsed_payload = json.loads(normalized_raw_value)
    except (TypeError, ValueError):
        return None
    try:
        return StoryCharacterEmotionGenerateOut.model_validate(parsed_payload)
    except Exception:
        return None


def _normalize_story_character_emotion_job_error_detail(value: str | None) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        return ""
    return normalized[:STORY_CHARACTER_EMOTION_JOB_ERROR_MAX_LENGTH].rstrip()


def _resolve_story_character_emotion_selection(raw_values: Any) -> tuple[str, ...]:
    if not isinstance(raw_values, list):
        return tuple(_STORY_CHARACTER_EMOTION_IDS)

    normalized_values: list[str] = []
    seen: set[str] = set()
    for raw_value in raw_values:
        emotion_id = _normalize_story_character_emotion_id(raw_value)
        if emotion_id is None or emotion_id in seen:
            continue
        seen.add(emotion_id)
        normalized_values.append(emotion_id)

    if not normalized_values:
        return tuple(_STORY_CHARACTER_EMOTION_IDS)
    return tuple(normalized_values)


def _build_story_character_emotion_generation_plan(
    payload: StoryCharacterEmotionGenerateRequest,
) -> dict[str, Any]:
    selected_image_model = _coerce_story_image_model(getattr(payload, "image_model", None))
    _validate_story_turn_image_provider_config(selected_image_model)
    selected_emotion_ids = _resolve_story_character_emotion_selection(getattr(payload, "emotion_ids", None))
    reference_image_url, reference_image_data_url = _resolve_story_character_reference_image_data_url(
        getattr(payload, "reference_avatar_url", None)
    )
    reference_prompt = _build_story_character_emotion_reference_prompt(
        description=getattr(payload, "description", None),
        style_prompt=getattr(payload, "style_prompt", None),
    )
    emotion_prompt_lock = _build_story_character_emotion_prompt_lock(
        description=getattr(payload, "description", None),
        style_prompt=getattr(payload, "style_prompt", None),
    )
    if reference_image_data_url is None and not reference_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Character description or a reference avatar is required for emotion generation",
        )

    reference_image_available = bool(reference_image_data_url or reference_image_url)
    generated_image_count = len(selected_emotion_ids)
    if not reference_image_available:
        generated_image_count += 1
    image_generation_cost = _get_story_turn_image_cost_tokens(selected_image_model) * generated_image_count
    return {
        "selected_image_model": selected_image_model,
        "selected_emotion_ids": list(selected_emotion_ids),
        "reference_image_url": reference_image_url,
        "reference_image_data_url": reference_image_data_url,
        "reference_prompt": reference_prompt,
        "emotion_prompt_lock": emotion_prompt_lock,
        "image_generation_cost": image_generation_cost,
        "total_variants": max(len(selected_emotion_ids), 1),
    }


def _run_story_character_emotion_pack_generation(
    *,
    plan: dict[str, Any],
    user: User,
    db: Session,
    charge_tokens: bool,
    progress_callback: Any = None,
) -> StoryCharacterEmotionGenerateOut:
    selected_image_model = str(plan.get("selected_image_model") or "").strip() or STORY_TURN_IMAGE_MODEL_FLUX
    selected_emotion_ids = _resolve_story_character_emotion_selection(plan.get("selected_emotion_ids"))
    reference_image_url = str(plan.get("reference_image_url") or "").strip() or None
    reference_image_data_url = str(plan.get("reference_image_data_url") or "").strip() or None
    reference_prompt = str(plan.get("reference_prompt") or "").strip()
    emotion_prompt_lock = str(plan.get("emotion_prompt_lock") or "").strip()
    image_generation_cost = max(int(plan.get("image_generation_cost") or 0), 0)
    total_variants = max(int(plan.get("total_variants") or len(selected_emotion_ids)), 1)

    if charge_tokens and not _spend_user_tokens_if_sufficient(db, int(user.id), image_generation_cost):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Not enough sols to generate image",
        )
    if charge_tokens:
        db.commit()
        db.refresh(user)

    try:
        if reference_image_data_url is None:
            limited_reference_prompt = _limit_story_turn_image_request_prompt(
                reference_prompt,
                model_name=selected_image_model,
            )
            reference_generation_payload = _request_story_turn_image(
                prompt=limited_reference_prompt,
                model_name=selected_image_model,
            )
            reference_image_url = str(reference_generation_payload.get("image_url") or "").strip() or None
            reference_image_data_url = str(reference_generation_payload.get("image_data_url") or "").strip() or None
            if reference_image_data_url is None and reference_image_url is not None:
                reference_image_data_url = _try_fetch_story_character_avatar_data_url(reference_image_url)
            if reference_image_url is None and reference_image_data_url is None:
                raise RuntimeError("Reference sprite generation returned no image payload")

        emotion_assets: dict[str, str] = {}
        completed_variants = 0
        generated_variants = list(selected_emotion_ids)
        for emotion_index, emotion_id in enumerate(generated_variants):
            if callable(progress_callback):
                progress_callback(emotion_id, completed_variants, total_variants)
            emotion_prompt = _build_story_character_emotion_edit_prompt(
                emotion_id=emotion_id,
                emotion_prompt_lock=emotion_prompt_lock,
            )
            emotion_prompt = _limit_story_turn_image_request_prompt(
                emotion_prompt,
                model_name=selected_image_model,
            )
            generated_emotion_payload = _request_story_turn_image(
                prompt=emotion_prompt,
                model_name=selected_image_model,
                reference_image_url=reference_image_url,
                reference_image_data_url=reference_image_data_url,
            )
            generated_emotion_image_url = str(generated_emotion_payload.get("image_url") or "").strip() or None
            generated_emotion_image_data_url = str(generated_emotion_payload.get("image_data_url") or "").strip() or None
            generated_emotion_asset = _finalize_story_character_emotion_asset(
                image_url=generated_emotion_image_url,
                image_data_url=generated_emotion_image_data_url,
            )
            if generated_emotion_asset is None:
                raise RuntimeError(f"Emotion generation returned no image for {emotion_id}")
            emotion_assets[emotion_id] = generated_emotion_asset
            completed_variants += 1
            if callable(progress_callback):
                next_emotion_id = generated_variants[emotion_index + 1] if emotion_index + 1 < len(generated_variants) else None
                progress_callback(next_emotion_id, completed_variants, total_variants)
    except Exception as exc:
        if charge_tokens:
            try:
                _add_user_tokens(db, int(user.id), image_generation_cost)
                db.commit()
                db.refresh(user)
            except Exception:
                db.rollback()
                logger.exception("Story character emotion token refund failed after generation error: user_id=%s", user.id)
            detail = str(exc).strip() or "Emotion generation failed"
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail[:500]) from exc
        raise

    return StoryCharacterEmotionGenerateOut(
        model=selected_image_model,
        avatar_prompt=reference_prompt,
        emotion_prompt_lock=emotion_prompt_lock or None,
        reference_image_url=reference_image_url,
        reference_image_data_url=reference_image_data_url,
        emotion_assets=emotion_assets,
        user=UserOut.model_validate(user),
    )


def _story_character_emotion_generation_job_to_out(
    job: StoryCharacterEmotionGenerationJob,
    *,
    user: User | None = None,
) -> StoryCharacterEmotionGenerateJobOut:
    result_payload = _deserialize_story_character_emotion_job_result_payload(getattr(job, "result_payload", ""))
    current_emotion_id = _normalize_story_character_emotion_id(getattr(job, "current_emotion_id", "")) or None
    status_value = str(getattr(job, "status", "") or "").strip().lower()
    if status_value not in {
        STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED,
        STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING,
        STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED,
        STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED,
    }:
        status_value = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
    user_payload = UserOut.model_validate(user) if user is not None else (result_payload.user if result_payload is not None else None)
    return StoryCharacterEmotionGenerateJobOut(
        id=int(job.id),
        status=status_value,
        image_model=str(getattr(job, "image_model", "") or "").strip(),
        completed_variants=max(int(getattr(job, "completed_variants", 0) or 0), 0),
        total_variants=max(int(getattr(job, "total_variants", 0) or 0), 0),
        current_emotion_id=current_emotion_id,
        error_detail=_normalize_story_character_emotion_job_error_detail(getattr(job, "error_detail", "")) or None,
        result=result_payload,
        user=user_payload,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=getattr(job, "started_at", None),
        completed_at=getattr(job, "completed_at", None),
    )


def _set_story_character_emotion_job_progress(
    db: Session,
    job: StoryCharacterEmotionGenerationJob,
    *,
    current_emotion_id: str | None,
    completed_variants: int,
    total_variants: int,
) -> None:
    job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING
    job.current_emotion_id = _normalize_story_character_emotion_id(current_emotion_id) or ""
    job.completed_variants = max(0, min(int(completed_variants), max(int(total_variants), 0)))
    job.total_variants = max(int(total_variants), 0)
    db.commit()


def _process_story_character_emotion_generation_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.scalar(
            select(StoryCharacterEmotionGenerationJob).where(StoryCharacterEmotionGenerationJob.id == job_id)
        )
        if job is None or str(job.status or "").strip().lower() in STORY_CHARACTER_EMOTION_JOB_TERMINAL_STATUSES:
            return

        user = db.scalar(select(User).where(User.id == job.user_id))
        if user is None:
            job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
            job.error_detail = "Emotion generation owner was not found"
            job.current_emotion_id = ""
            job.completed_at = datetime.now(timezone.utc)
            job.reserved_tokens = 0
            db.commit()
            return

        job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING
        job.error_detail = ""
        job.current_emotion_id = ""
        if job.started_at is None:
            job.started_at = datetime.now(timezone.utc)
        db.commit()

        payload = _deserialize_story_character_emotion_job_request_payload(job.request_payload)
        if payload is None:
            raise RuntimeError("Emotion generation job payload is invalid")

        plan = _build_story_character_emotion_generation_plan(payload)
        job.image_model = str(plan.get("selected_image_model") or "").strip()
        job.total_variants = max(int(plan.get("total_variants") or 0), 0)
        db.commit()

        result_payload = _run_story_character_emotion_pack_generation(
            plan=plan,
            user=user,
            db=db,
            charge_tokens=False,
            progress_callback=lambda current_emotion_id, completed_variants, total_variants: _set_story_character_emotion_job_progress(
                db,
                job,
                current_emotion_id=current_emotion_id,
                completed_variants=completed_variants,
                total_variants=total_variants,
            ),
        )

        job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED
        job.current_emotion_id = ""
        job.completed_variants = max(int(job.total_variants or len(_resolve_story_character_emotion_selection(plan.get("selected_emotion_ids")))), 0)
        job.result_payload = _serialize_story_character_emotion_job_result_payload(result_payload)
        job.error_detail = ""
        job.completed_at = datetime.now(timezone.utc)
        job.reserved_tokens = 0
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.scalar(
            select(StoryCharacterEmotionGenerationJob).where(StoryCharacterEmotionGenerationJob.id == job_id)
        )
        if job is None:
            logger.exception("Story character emotion job failed before persistence: job_id=%s", job_id)
            return

        detail = _normalize_story_character_emotion_job_error_detail(str(exc).strip() or "Emotion generation failed")
        try:
            if int(getattr(job, "reserved_tokens", 0) or 0) > 0:
                _add_user_tokens(db, int(job.user_id), int(job.reserved_tokens))
                job.reserved_tokens = 0
            job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
            job.current_emotion_id = ""
            job.error_detail = detail or "Emotion generation failed"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Story character emotion job refund failed: job_id=%s", job_id)
            try:
                job = db.scalar(
                    select(StoryCharacterEmotionGenerationJob).where(StoryCharacterEmotionGenerationJob.id == job_id)
                )
                if job is not None:
                    job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
                    job.current_emotion_id = ""
                    job.error_detail = detail or "Emotion generation failed"
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
            except Exception:
                db.rollback()
                logger.exception("Story character emotion job failure state persistence failed: job_id=%s", job_id)
    finally:
        db.close()


def _start_story_character_emotion_generation_job(job_id: int) -> None:
    worker = Thread(
        target=_process_story_character_emotion_generation_job,
        args=(int(job_id),),
        name=f"story-emotion-job-{int(job_id)}",
        daemon=True,
    )
    worker.start()


def _fail_story_character_emotion_job_after_spawn_error(job_id: int, error_text: str) -> None:
    db = SessionLocal()
    try:
        job = db.scalar(
            select(StoryCharacterEmotionGenerationJob).where(StoryCharacterEmotionGenerationJob.id == int(job_id))
        )
        if job is None:
            return
        detail = _normalize_story_character_emotion_job_error_detail(error_text) or "Emotion generation failed to start"
        if int(getattr(job, "reserved_tokens", 0) or 0) > 0:
            _add_user_tokens(db, int(job.user_id), int(job.reserved_tokens))
            job.reserved_tokens = 0
        job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
        job.current_emotion_id = ""
        job.error_detail = detail
        job.completed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Story character emotion spawn recovery failed: job_id=%s", job_id)
    finally:
        db.close()


def queue_story_character_emotion_generation_job_impl(
    payload: StoryCharacterEmotionGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryCharacterEmotionGenerateJobOut:
    user = _get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    plan = _build_story_character_emotion_generation_plan(payload)
    image_generation_cost = max(int(plan.get("image_generation_cost") or 0), 0)
    if not _spend_user_tokens_if_sufficient(db, int(user.id), image_generation_cost):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Not enough sols to generate image",
        )

    job = StoryCharacterEmotionGenerationJob(
        user_id=int(user.id),
        status=STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED,
        image_model=str(plan.get("selected_image_model") or "").strip(),
        request_payload=_serialize_story_character_emotion_job_request_payload(payload),
        result_payload="",
        error_detail="",
        current_emotion_id="",
        completed_variants=0,
        total_variants=max(int(plan.get("total_variants") or 0), 0),
        reserved_tokens=image_generation_cost,
        started_at=None,
        completed_at=None,
    )
    db.add(job)
    db.commit()
    db.refresh(user)
    db.refresh(job)

    try:
        _start_story_character_emotion_generation_job(job.id)
    except Exception as exc:
        logger.exception("Failed to start story character emotion job thread: job_id=%s", job.id)
        _fail_story_character_emotion_job_after_spawn_error(job.id, str(exc).strip() or "Emotion generation failed to start")
        db.refresh(user)
        db.refresh(job)

    return _story_character_emotion_generation_job_to_out(job, user=user)


def get_story_character_emotion_generation_job_impl(
    job_id: int,
    authorization: str | None,
    db: Session,
) -> StoryCharacterEmotionGenerateJobOut:
    user = _get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    job = db.scalar(
        select(StoryCharacterEmotionGenerationJob).where(
            StoryCharacterEmotionGenerationJob.id == int(job_id),
            StoryCharacterEmotionGenerationJob.user_id == int(user.id),
        )
    )
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emotion generation job not found")
    db.refresh(user)
    return _story_character_emotion_generation_job_to_out(job, user=user)


def generate_story_character_emotion_pack_impl(
    payload: StoryCharacterEmotionGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryCharacterEmotionGenerateOut:
    user = _get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    plan = _build_story_character_emotion_generation_plan(payload)
    return _run_story_character_emotion_pack_generation(
        plan=plan,
        user=user,
        db=db,
        charge_tokens=True,
    )


def generate_story_turn_image_impl(
    game_id: int,
    payload: StoryTurnImageGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryTurnImageGenerateOut:
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
    character_world_cards = relevant_world_cards if relevant_world_cards else active_world_cards
    prompt_world_cards = _merge_story_turn_image_world_cards(
        relevant_world_cards,
        all_world_cards,
    )

    full_character_card_locks = _build_story_turn_image_full_character_card_locks(
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=character_world_cards,
    )
    _validate_story_turn_image_character_card_lock_budget(full_character_card_locks)

    selected_image_model = _coerce_story_image_model(getattr(game, "image_model", None))
    _validate_story_turn_image_provider_config(selected_image_model)
    visual_prompt = _build_story_turn_image_prompt(
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=prompt_world_cards,
        character_world_cards=character_world_cards,
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
        generation_payload = _request_story_turn_image(
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
        active_turn_images = db.scalars(
            select(StoryTurnImage).where(
                StoryTurnImage.game_id == game.id,
                StoryTurnImage.assistant_message_id == assistant_message.id,
                StoryTurnImage.undone_at.is_(None),
            )
        ).all()
        if active_turn_images:
            replaced_at = _utcnow()
            for previous_turn_image in active_turn_images:
                previous_turn_image.undone_at = replaced_at

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

