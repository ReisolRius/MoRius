from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pydantic import BaseModel
import requests
from sqlalchemy import delete as sa_delete, func, select, update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

from app.database import get_db
from app.config import settings
from app.models import (
    StoryBugReport,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldReport,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryBugReportCreateRequest,
    StoryCommunityWorldCommentCreateRequest,
    StoryCommunityWorldCommentOut,
    StoryCommunityWorldCommentUpdateRequest,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryCommunityWorldSummaryOut,
    StoryGameCloneRequest,
    StoryGameCreateRequest,
    StoryGameOut,
    StoryGameMetaUpdateRequest,
    StoryGameSettingsUpdateRequest,
    StoryGameSummaryOut,
    StoryInstructionCardOut,
    StoryMemoryBlockOut,
    StoryMessageOut,
    StoryTurnImageOut,
)
try:
    from app.schemas import StoryQuickStartRequest
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    class StoryQuickStartRequest(BaseModel):
        genre: str
        hero_class: str
        protagonist_name: str
        start_mode: str

from app.services.auth_identity import get_current_user
from app.services.concurrency import (
    apply_story_world_rating_delete,
    apply_story_world_rating_insert,
    apply_story_world_rating_update,
    increment_story_world_launches,
)
from app.services.story_games import (
    STORY_DEFAULT_TITLE,
    STORY_GAME_VISIBILITY_PRIVATE,
    STORY_GAME_VISIBILITY_PUBLIC,
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    count_story_completed_turns,
    clone_story_world_cards_to_game,
    coerce_story_llm_model,
    coerce_story_image_model,
    coerce_story_game_age_rating,
    ensure_story_game_public_card_snapshots,
    deserialize_story_game_genres,
    get_story_game_public_cards_out,
    normalize_story_ambient_enabled,
    normalize_story_context_limit_chars,
    normalize_story_cover_image_url,
    normalize_story_cover_position,
    normalize_story_cover_scale,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_emotion_visualization_enabled,
    normalize_story_game_age_rating,
    normalize_story_game_description,
    normalize_story_game_genres,
    normalize_story_image_style_prompt,
    normalize_story_image_model,
    normalize_story_game_opening_scene,
    normalize_story_game_visibility,
    normalize_story_llm_model,
    normalize_story_memory_optimization_enabled,
    normalize_story_show_gg_thoughts,
    normalize_story_show_npc_thoughts,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
    refresh_story_game_public_card_snapshots,
    serialize_story_game_genres,
    story_author_avatar_url,
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_compact_out,
    story_game_summary_to_out,
)
from app.services.story_cards import story_plot_card_to_out
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_memory import (
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_LOCATION,
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_SUPER,
    normalize_story_memory_block_content,
    normalize_story_memory_layer,
    normalize_story_memory_block_title,
    resolve_story_current_location_label,
    story_memory_block_to_out,
)
from app.services.story_messages import story_message_to_out
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    has_story_assistant_redo_step,
    list_story_instruction_cards,
    list_story_memory_blocks,
    list_story_messages,
    list_story_plot_card_events,
    list_story_plot_cards,
    touch_story_game,
    list_story_turn_images,
    list_story_world_card_events,
    list_story_world_cards,
)
from app.services.story_world_comments import (
    list_story_community_world_comments_out,
    normalize_story_community_world_comment_content,
    story_community_world_comment_to_out,
)
from app.services.story_world_cards import story_world_card_to_out
try:
    from app.services.notifications import (
        NOTIFICATION_KIND_MODERATION_QUEUE,
        NOTIFICATION_KIND_MODERATION_REPORT,
        NOTIFICATION_KIND_WORLD_COMMENT,
        NotificationDraft,
        build_staff_notification_drafts,
        create_user_notifications,
        send_notification_emails,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    NOTIFICATION_KIND_MODERATION_QUEUE = "moderation_queue"
    NOTIFICATION_KIND_MODERATION_REPORT = "moderation_report"
    NOTIFICATION_KIND_WORLD_COMMENT = "world_comment"

    class NotificationDraft:
        def __init__(
            self,
            *,
            user_id: int,
            kind: str,
            title: str,
            body: str,
            action_url: str | None = None,
            actor_user_id: int | None = None,
        ) -> None:
            self.user_id = user_id
            self.kind = kind
            self.title = title
            self.body = body
            self.action_url = action_url
            self.actor_user_id = actor_user_id

    def build_staff_notification_drafts(
        db: Session,
        *,
        kind: str,
        title: str,
        body: str,
        action_url: str | None = None,
        actor_user_id: int | None = None,
    ) -> list[NotificationDraft]:
        _ = (db, kind, title, body, action_url, actor_user_id)
        return []

    def create_user_notifications(db: Session, drafts: list[NotificationDraft]) -> list[object]:
        _ = (db, drafts)
        return []

    def send_notification_emails(db: Session, notifications: list[object]) -> None:
        _ = (db, notifications)
        return None

try:
    from app.services.story_games import (
        deserialize_story_environment_datetime,
        deserialize_story_environment_weather,
        normalize_story_environment_enabled,
        normalize_story_environment_turn_step_minutes,
        coerce_story_environment_time_mode,
        serialize_story_environment_datetime,
        serialize_story_environment_weather,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def normalize_story_environment_enabled(value: bool | None) -> bool:
        return bool(value) if value is not None else False

    def coerce_story_environment_time_mode(value: str | None) -> str:
        _ = value
        return "grok"

    def normalize_story_environment_turn_step_minutes(value: int | None) -> int:
        _ = value
        return 20

    def deserialize_story_environment_datetime(raw_value: str | None):
        normalized = str(raw_value or "").strip()
        if not normalized:
            return None
        try:
            return __import__("datetime").datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None

    def serialize_story_environment_datetime(value) -> str:
        if value is None:
            return ""
        try:
            return value.isoformat()
        except AttributeError:
            return ""

    def deserialize_story_environment_weather(raw_value: str | None) -> dict[str, Any] | None:
        if not raw_value:
            return None
        try:
            parsed = json.loads(raw_value)
        except (TypeError, ValueError):
            return None
        return parsed if isinstance(parsed, dict) else None

    def serialize_story_environment_weather(value: dict[str, Any] | None) -> str:
        if not isinstance(value, dict):
            return ""
        try:
            return json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            return ""

try:
    from app.services.story_publication_moderation import (
        clear_story_publication_state,
        mark_story_publication_pending,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def mark_story_publication_pending(game: StoryGame) -> None:
        setattr(game, "publication_status", "pending")
        setattr(game, "publication_requested_at", _utcnow())
        setattr(game, "publication_reviewed_at", None)
        setattr(game, "publication_reviewer_user_id", None)
        setattr(game, "publication_rejection_reason", None)

    def clear_story_publication_state(game: StoryGame) -> None:
        setattr(game, "publication_status", "none")
        setattr(game, "publication_requested_at", None)
        setattr(game, "publication_reviewed_at", None)
        setattr(game, "publication_reviewer_user_id", None)
        setattr(game, "publication_rejection_reason", None)

try:
    from app.services.text_encoding import sanitize_likely_utf8_mojibake
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def sanitize_likely_utf8_mojibake(value: str) -> str:
        return str(value or "")

try:
    from app.services.story_world_cards import (
        STORY_WORLD_CARD_SOURCE_USER,
        normalize_story_world_card_content,
        normalize_story_world_card_title,
        normalize_story_world_card_triggers,
        serialize_story_world_card_triggers,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    STORY_WORLD_CARD_SOURCE_USER = "user"

    def normalize_story_world_card_title(value: str) -> str:
        normalized = " ".join(str(value or "").split()).strip()
        if not normalized:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World card title should not be empty")
        return normalized[:120].rstrip()

    def normalize_story_world_card_content(value: str) -> str:
        normalized = str(value or "").replace("\r\n", "\n").strip()
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="World card content should not be empty",
            )
        return normalized[:6000]

    def normalize_story_world_card_triggers(values: list[str] | None, fallback_title: str = "") -> list[str]:
        normalized_values: list[str] = []
        seen: set[str] = set()
        for raw_value in values or []:
            trigger = " ".join(str(raw_value or "").split()).strip()
            if not trigger:
                continue
            trigger_key = trigger.casefold()
            if trigger_key in seen:
                continue
            seen.add(trigger_key)
            normalized_values.append(trigger[:120])
        if normalized_values:
            return normalized_values[:20]
        fallback = " ".join(str(fallback_title or "").split()).strip()
        return [fallback[:120]] if fallback else []

    def serialize_story_world_card_triggers(values: list[str]) -> str:
        return json.dumps(values, ensure_ascii=False)

router = APIRouter()
logger = logging.getLogger(__name__)

STORY_WORLD_REPORT_STATUS_OPEN = "open"
STORY_BUG_REPORT_STATUS_OPEN = "open"
STORY_BUG_REPORT_TITLE_MAX_LENGTH = 160
STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH = 8_000
STORY_GAME_TITLE_MAX_LENGTH = 160
STORY_CLONE_TITLE_SUFFIX = " (копия)"
PRIVILEGED_WORLD_COMMENT_ROLES = {"administrator", "moderator"}
STORY_LIST_PREVIEW_MAX_CHARS = 145
STORY_LIST_PREVIEW_MAX_CHARS_WITH_ELLIPSIS = 142
STORY_QUICK_START_MAX_TOKENS = 1_100
STORY_QUICK_START_ALLOWED_START_MODES = {"calm", "action"}
STORY_CLONE_DISPLAY_SUFFIX = " (\u043a\u043e\u043f\u0438\u044f)"
STORY_CLONE_DISPLAY_SUFFIX_PATTERN = re.compile(
    r"(?:\s*(?:[\(\[]\s*)?\u043a\u043e\u043f\u0438\u044f(?:\s*[\)\]])?)+\s*$",
    re.IGNORECASE,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _persist_notifications(db: Session, drafts: list[NotificationDraft]) -> None:
    notifications = create_user_notifications(db, drafts=drafts)
    if not notifications:
        return
    db.commit()
    send_notification_emails(db, notifications)


def _notify_story_staff(
    db: Session,
    *,
    kind: str,
    title: str,
    body: str,
    action_url: str | None = None,
    actor_user_id: int | None = None,
) -> None:
    _persist_notifications(
        db,
        build_staff_notification_drafts(
            db,
            kind=kind,
            title=title,
            body=body,
            action_url=action_url,
            actor_user_id=actor_user_id,
        ),
    )


_STORY_ENVIRONMENT_EMERGENCY_BASE_TEMPS: dict[str, tuple[int, int, int, int]] = {
    "winter": (-10, -5, -1, -6),
    "spring": (4, 10, 16, 11),
    "summer": (12, 17, 23, 18),
    "autumn": (7, 11, 16, 10),
}

_STORY_ENVIRONMENT_EMERGENCY_PATTERNS: dict[str, tuple[tuple[str, str, str, str], ...]] = {
    "winter": (
        ("Ясная морозная ночь", "Солнечное морозное утро", "Холодный ясный день", "Тихий морозный вечер"),
        ("Облачная зимняя ночь", "Пасмурное зимнее утро", "Холодный пасмурный день", "Зимний вечер с облаками"),
        ("Снежная ночь", "Снегопад к утру", "Холодный снег с ветром", "Снежный вечер"),
        ("Туманная ночь", "Зябкое утро с дымкой", "Сырой зимний день", "Промозглый вечер"),
    ),
    "spring": (
        ("Прохладная ночь с облаками", "Солнечное весеннее утро", "Тёплый весенний день", "Свежий вечер"),
        ("Ясная прохладная ночь", "Светлое утро", "Ясный мягкий день", "Тихий ясный вечер"),
        ("Влажная ночь", "Пасмурное утро", "Морось", "Дождливый вечер"),
        ("Туманная ночь", "Утро с дымкой", "Облачно", "Сырой прохладный вечер"),
    ),
    "summer": (
        ("Тёплая ночь с облаками", "Солнечно с облаками", "Тепло, облака с прояснениями", "Тёплый вечер с облаками"),
        ("Ясная летняя ночь", "Свежое солнечное утро", "Солнечный тёплый день", "Ясный летний вечер"),
        ("Влажная ночь", "Пасмурное утро", "Морось", "Дождливый вечер"),
        ("Туманная ночь", "Лёгкая дымка", "Облачно", "Прохладный вечер"),
    ),
    "autumn": (
        ("Прохладная ночь", "Светлое осеннее утро", "Сухой осенний день", "Свежий осенний вечер"),
        ("Облачная ночь", "Пасмурное утро", "Хмурый день", "Облачный вечер"),
        ("Сырая ночь", "Дождливое утро", "Морось", "Ветреный дождливый вечер"),
        ("Туманная ночь", "Холодное утро с дымкой", "Сырой серый день", "Зябкий вечер"),
    ),
}

_STORY_ENVIRONMENT_EMERGENCY_TIMELINE_SLOTS: tuple[tuple[str, str], ...] = (
    ("00:00", "06:00"),
    ("06:00", "12:00"),
    ("12:00", "18:00"),
    ("18:00", "00:00"),
)


def _story_environment_emergency_season_key(value: datetime) -> str:
    if value.month in {12, 1, 2}:
        return "winter"
    if value.month in {3, 4, 5}:
        return "spring"
    if value.month in {6, 7, 8}:
        return "summer"
    return "autumn"


def _story_environment_emergency_active_index(value: datetime) -> int:
    if value.hour < 6:
        return 0
    if value.hour < 12:
        return 1
    if value.hour < 18:
        return 2
    return 3


def _build_story_environment_emergency_weather_payloads(*, game: StoryGame) -> tuple[dict[str, Any], dict[str, Any]]:
    current_datetime = deserialize_story_environment_datetime(str(getattr(game, "environment_current_datetime", "") or ""))
    if current_datetime is None:
        current_datetime = _utcnow()

    season_key = _story_environment_emergency_season_key(current_datetime)
    context_text = "\n".join(
        part
        for part in (
            str(getattr(game, "current_location_label", "") or "").strip(),
            str(getattr(game, "opening_scene", "") or "").strip(),
        )
        if part
    ).casefold()
    pattern_count = len(_STORY_ENVIRONMENT_EMERGENCY_PATTERNS[season_key])
    pattern_index = (int(_utcnow().timestamp()) + int(getattr(game, "id", 0) or 0)) % pattern_count
    if re.search(r"\b(?:дожд|ливн|морос|гроза|снегопад|снег)\w*\b", context_text):
        pattern_index = 2
    elif re.search(r"\b(?:туман|дымк|мгла)\w*\b", context_text):
        pattern_index = 3
    elif re.search(r"\b(?:ясн|луна|лунн|звезд|звёзд|солнеч)\w*\b", context_text):
        pattern_index = 1

    tomorrow_pattern_index = (pattern_index + 1) % pattern_count
    base_temps = _STORY_ENVIRONMENT_EMERGENCY_BASE_TEMPS[season_key]
    daily_shift = (int(getattr(game, "id", 0) or 0) % 5) - 2
    humidity_by_pattern = ("Высокая", "Средняя", "Высокая", "Высокая")
    wind_by_pattern = ("Слабый", "Лёгкий", "Умеренный", "Слабый")
    fog_by_pattern = ("Нет", "Нет", "Нет", "Лёгкий")

    def _build_weather_payload(day_datetime: datetime, selected_pattern_index: int, include_timeline: bool) -> dict[str, Any]:
        summaries = _STORY_ENVIRONMENT_EMERGENCY_PATTERNS[_story_environment_emergency_season_key(day_datetime)][
            selected_pattern_index
        ]
        timeline: list[dict[str, Any]] = []
        for slot_index, (start_time, end_time) in enumerate(_STORY_ENVIRONMENT_EMERGENCY_TIMELINE_SLOTS):
            timeline.append(
                {
                    "start_time": start_time,
                    "end_time": end_time,
                    "summary": summaries[slot_index],
                    "temperature_c": base_temps[slot_index] + daily_shift + (selected_pattern_index - 1),
                    "fog": fog_by_pattern[selected_pattern_index] if slot_index in {0, 1} else "Нет",
                    "humidity": humidity_by_pattern[selected_pattern_index],
                    "wind": wind_by_pattern[selected_pattern_index],
                }
            )

        active_index = _story_environment_emergency_active_index(day_datetime)
        active_entry = timeline[active_index if include_timeline else 2]
        payload: dict[str, Any] = {
            "summary": str(active_entry.get("summary") or ""),
            "temperature_c": int(active_entry.get("temperature_c") or 0),
            "fog": str(active_entry.get("fog") or "Нет"),
            "humidity": str(active_entry.get("humidity") or "Средняя"),
            "wind": str(active_entry.get("wind") or "Слабый"),
            "day_date": day_datetime.date().isoformat(),
        }
        if include_timeline:
            payload["timeline"] = timeline
        return payload

    current_weather = _build_weather_payload(current_datetime, pattern_index, include_timeline=True)
    tomorrow_weather = _build_weather_payload(current_datetime + timedelta(days=1), tomorrow_pattern_index, include_timeline=False)
    return current_weather, tomorrow_weather


def _normalize_story_quick_start_text(value: str, *, field_label: str, max_length: int) -> str:
    normalized = " ".join(str(sanitize_likely_utf8_mojibake(value) or "").split()).strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_label} should not be empty",
        )
    return normalized[:max_length].rstrip()


def _normalize_story_quick_start_mode(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_QUICK_START_ALLOWED_START_MODES:
        return normalized
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported quick start mode")


def _extract_story_quick_start_json(raw_value: str) -> dict[str, object] | None:
    stripped = str(raw_value or "").strip()
    if not stripped:
        return None
    try:
        parsed = json.loads(stripped)
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, dict):
        return parsed
    match = re.search(r"\{[\s\S]*\}", stripped)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(0))
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _build_story_quick_start_fallback_payload(
    *,
    genre: str,
    hero_class: str,
    protagonist_name: str,
    start_mode: str,
) -> dict[str, object]:
    normalized_genre = " ".join(genre.split()).strip() or "Приключение"
    normalized_class = " ".join(hero_class.split()).strip() or "герой"
    normalized_name = " ".join(protagonist_name.split()).strip() or "Герой"
    opening_mode_label = "спокойный вход" if start_mode == "calm" else "сразу в гуще событий"
    game_title = f"{normalized_name} — {normalized_genre}"[:60].rstrip(" -—,:;") or normalized_name or STORY_DEFAULT_TITLE
    return {
        "game_title": game_title,
        "game_description": f"{normalized_genre}. История о герое {normalized_name}.",
        "hero_description": f"{normalized_name} — {normalized_class.lower()}.",
        "hero_triggers": [normalized_name, normalized_class, normalized_genre, "главный герой"],
        "opening_scene": f"{normalized_name} делает первый шаг в новую историю. Режим старта: {opening_mode_label}.",
    }


def _generate_story_quick_start_payload(
    *,
    genre: str,
    hero_class: str,
    protagonist_name: str,
    start_mode: str,
) -> dict[str, object]:
    from app.services.story_generation_provider import _request_openrouter_story_text

    normalized_genre = " ".join(genre.split()).strip()
    normalized_class = " ".join(hero_class.split()).strip()
    normalized_name = " ".join(protagonist_name.split()).strip()
    start_mode_label = "спокойный" if start_mode == "calm" else "в гуще событий"
    fallback_payload = _build_story_quick_start_fallback_payload(
        genre=genre,
        hero_class=hero_class,
        protagonist_name=protagonist_name,
        start_mode=start_mode,
    )

    profile_messages = [
        {
            "role": "system",
            "content": (
                "You create the protagonist setup for a Russian text RPG. "
                "Return strict JSON only without markdown. "
                "Write all fields in Russian. "
                "Use exactly these keys: game_title, game_description, hero_description, hero_triggers. "
                "hero_description must feel specific, authored, and non-generic. "
                "hero_triggers must be a JSON array with 4-6 short strings."
            ),
        },
        {
            "role": "user",
            "content": (
                "Собери профиль для быстрого старта текстовой RPG.\n"
                f"Жанр: {normalized_genre}\n"
                f"Класс героя: {normalized_class}\n"
                f"Имя главного героя: {normalized_name}\n"
                f"Режим старта: {start_mode_label}\n\n"
                "Требования:\n"
                "1. game_title: короткое название до 60 символов.\n"
                "2. game_description: 1-2 предложения для карточки мира.\n"
                "3. hero_description: 4-6 предложений, конкретно и без шаблонной воды.\n"
                "4. hero_triggers: массив из 4-6 коротких триггеров.\n"
                "5. Героя называй только указанным именем."
            ),
        },
    ]

    scene_messages = [
        {
            "role": "system",
            "content": (
                "You write only the opening scene for a Russian interactive RPG. "
                "Return strict JSON only without markdown. "
                "Use exactly one key: opening_scene. "
                "The scene must be vivid, specific, and unique, not generic filler."
            ),
        },
        {
            "role": "user",
            "content": (
                "Напиши только стартовую сцену для быстрого старта текстовой RPG.\n"
                f"Жанр: {normalized_genre}\n"
                f"Класс героя: {normalized_class}\n"
                f"Имя главного героя: {normalized_name}\n"
                f"Режим старта: {start_mode_label}\n\n"
                "Требования:\n"
                "1. opening_scene: 2-4 абзаца живого текста без markdown.\n"
                "2. Если режим спокойный, начни с мягкого входа, но дай крючок.\n"
                "3. Если режим в гуще событий, начни сразу с активной напряженной ситуации.\n"
                "4. Сцена должна звучать как первая сцена уникального мира, а не общая болванка.\n"
                "5. Героя называй только указанным именем."
            ),
        },
    ]

    try:
        profile_response = _request_openrouter_story_text(
            profile_messages,
            model_name="x-ai/grok-4.1-fast",
            allow_free_fallback=False,
            translate_input=False,
            fallback_model_names=[],
            temperature=0.7,
            max_tokens=min(STORY_QUICK_START_MAX_TOKENS, 1200),
            request_timeout=(12, 70),
        )
        parsed_profile = _extract_story_quick_start_json(profile_response)
        if isinstance(parsed_profile, dict):
            for key in ("game_title", "game_description", "hero_description", "hero_triggers"):
                value = parsed_profile.get(key)
                if value is not None:
                    fallback_payload[key] = value
    except Exception:
        pass

    try:
        scene_response = _request_openrouter_story_text(
            scene_messages,
            model_name="deepseek/deepseek-v3.2",
            allow_free_fallback=False,
            translate_input=False,
            fallback_model_names=[],
            temperature=0.92,
            max_tokens=STORY_QUICK_START_MAX_TOKENS,
            request_timeout=(12, 70),
        )
        parsed_scene = _extract_story_quick_start_json(scene_response)
        if isinstance(parsed_scene, dict) and parsed_scene.get("opening_scene") is not None:
            fallback_payload["opening_scene"] = parsed_scene.get("opening_scene")
    except Exception:
        pass

    return fallback_payload


def _build_story_clone_title(source_title: str) -> str:
    normalized_source_title = " ".join(source_title.split()).strip() or STORY_DEFAULT_TITLE
    normalized_source_title = STORY_CLONE_DISPLAY_SUFFIX_PATTERN.sub("", normalized_source_title).rstrip(" -_.,")
    if not normalized_source_title:
        normalized_source_title = STORY_DEFAULT_TITLE
    max_base_length = STORY_GAME_TITLE_MAX_LENGTH - len(STORY_CLONE_DISPLAY_SUFFIX)
    trimmed_source_title = normalized_source_title[: max(max_base_length, 0)].rstrip()
    if not trimmed_source_title:
        trimmed_source_title = STORY_DEFAULT_TITLE[: max(max_base_length, 0)].rstrip() or STORY_DEFAULT_TITLE
    return f"{trimmed_source_title}{STORY_CLONE_DISPLAY_SUFFIX}"[:STORY_GAME_TITLE_MAX_LENGTH]


def _build_story_list_preview(raw_content: str | None) -> str | None:
    if not isinstance(raw_content, str):
        return None
    normalized = " ".join(raw_content.split()).strip()
    if not normalized:
        return None
    if len(normalized) <= STORY_LIST_PREVIEW_MAX_CHARS:
        return normalized
    return f"{normalized[:STORY_LIST_PREVIEW_MAX_CHARS_WITH_ELLIPSIS]}..."


def _normalize_story_bug_report_title(value: str) -> str:
    normalized = " ".join(str(value).replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bug report title should not be empty")
    return normalized[:STORY_BUG_REPORT_TITLE_MAX_LENGTH].rstrip()


def _normalize_story_bug_report_description(value: str) -> str:
    normalized = str(value).replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bug report description should not be empty")
    return normalized[:STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH].rstrip()


def _normalize_story_environment_location_label(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\r", " ").replace("\n", " ").split()).strip()[:160]


_STORY_ENVIRONMENT_GROK_MODEL = "x-ai/grok-4.1-fast"
_STORY_ENVIRONMENT_TIMELINE_SLOTS: tuple[tuple[str, str], ...] = (
    ("00:00", "06:00"),
    ("06:00", "12:00"),
    ("12:00", "18:00"),
    ("18:00", "00:00"),
)
_STORY_INTERIOR_LOCATION_KEYWORDS: tuple[str, ...] = (
    "таверн",
    "трактир",
    "постоял",
    "корчм",
    "гостин",
    "каба",
    "харчевн",
    "зал",
    "комнат",
    "номер",
    "кабинет",
    "храм",
    "святилищ",
    "гильди",
)


def _extract_story_json_object(raw_value: str) -> dict[str, Any] | None:
    stripped = str(raw_value or "").strip()
    if not stripped:
        return None
    try:
        parsed = json.loads(stripped)
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, dict):
        return parsed
    match = re.search(r"\{[\s\S]*\}", stripped)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(0))
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _story_environment_active_timeline_index(value: datetime | None) -> int:
    if value is None:
        return 2
    if value.hour < 6:
        return 0
    if value.hour < 12:
        return 1
    if value.hour < 18:
        return 2
    return 3


def _coerce_story_environment_temperature_c(value: Any, *, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value))
    try:
        return int(round(float(str(value or "").replace(",", "."))))
    except (TypeError, ValueError):
        return fallback


def _normalize_story_environment_slot_payload(
    raw_entry: dict[str, Any] | None,
    *,
    start_time: str,
    end_time: str,
    fallback_temperature: int,
) -> dict[str, Any] | None:
    if not isinstance(raw_entry, dict):
        return None
    summary = " ".join(str(raw_entry.get("summary") or "").split()).strip()
    if not summary:
        return None
    return {
        "start_time": start_time,
        "end_time": end_time,
        "summary": summary[:120],
        "temperature_c": _coerce_story_environment_temperature_c(
            raw_entry.get("temperature_c"),
            fallback=fallback_temperature,
        ),
        "fog": " ".join(str(raw_entry.get("fog") or "нет").split()).strip()[:80] or "нет",
        "humidity": " ".join(str(raw_entry.get("humidity") or "средняя").split()).strip()[:80] or "средняя",
        "wind": " ".join(str(raw_entry.get("wind") or "слабый").split()).strip()[:80] or "слабый",
    }


def _normalize_story_environment_weather_payload_from_grok(
    raw_payload: dict[str, Any] | None,
    *,
    reference_datetime: datetime | None,
    include_timeline: bool,
) -> dict[str, Any] | None:
    if not isinstance(raw_payload, dict):
        return None
    base_temperature = _coerce_story_environment_temperature_c(raw_payload.get("temperature_c"), fallback=18)
    day_date = " ".join(str(raw_payload.get("day_date") or "").split()).strip()
    if not day_date and reference_datetime is not None:
        day_date = reference_datetime.date().isoformat()

    normalized_timeline: list[dict[str, Any]] = []
    if include_timeline:
        raw_timeline = raw_payload.get("timeline")
        if not isinstance(raw_timeline, list) or len(raw_timeline) != len(_STORY_ENVIRONMENT_TIMELINE_SLOTS):
            return None
        for index, (slot_bounds, raw_entry) in enumerate(zip(_STORY_ENVIRONMENT_TIMELINE_SLOTS, raw_timeline)):
            fallback_temperature = base_temperature + (index - 1)
            normalized_entry = _normalize_story_environment_slot_payload(
                raw_entry if isinstance(raw_entry, dict) else None,
                start_time=slot_bounds[0],
                end_time=slot_bounds[1],
                fallback_temperature=fallback_temperature,
            )
            if normalized_entry is None:
                return None
            normalized_timeline.append(normalized_entry)

    active_index = _story_environment_active_timeline_index(reference_datetime)
    active_entry = normalized_timeline[active_index] if normalized_timeline else raw_payload
    active_summary = " ".join(str(active_entry.get("summary") or "").split()).strip()
    if not active_summary:
        return None

    normalized_payload: dict[str, Any] = {
        "summary": active_summary[:120],
        "temperature_c": _coerce_story_environment_temperature_c(
            active_entry.get("temperature_c"),
            fallback=base_temperature,
        ),
        "fog": " ".join(str(active_entry.get("fog") or raw_payload.get("fog") or "нет").split()).strip()[:80] or "нет",
        "humidity": (
            " ".join(str(active_entry.get("humidity") or raw_payload.get("humidity") or "средняя").split()).strip()[:80]
            or "средняя"
        ),
        "wind": " ".join(str(active_entry.get("wind") or raw_payload.get("wind") or "слабый").split()).strip()[:80] or "слабый",
        "day_date": day_date,
    }
    if include_timeline:
        normalized_payload["timeline"] = normalized_timeline
    return normalized_payload


def _story_weather_payload_is_suspiciously_generic(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return True
    summary = str(payload.get("summary") or "").casefold()
    if not summary:
        return True
    generic_markers = (
        "переменная облачность",
        "облачно",
        "пасмурно",
    )
    timeline = payload.get("timeline")
    if not isinstance(timeline, list):
        return summary in generic_markers
    timeline_summaries = [
        " ".join(str(entry.get("summary") or "").split()).strip().casefold()
        for entry in timeline
        if isinstance(entry, dict)
    ]
    if len(timeline_summaries) != len(_STORY_ENVIRONMENT_TIMELINE_SLOTS):
        return True
    unique_summaries = {value for value in timeline_summaries if value}
    if len(unique_summaries) <= 1:
        return True
    return all(any(marker in value for marker in generic_markers) for value in unique_summaries)


def _extract_story_specific_scene_location_label(
    *,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    opening_scene_text: str,
    current_location_label: str,
) -> str:
    combined_text = "\n".join(
        part
        for part in (
            current_location_label,
            opening_scene_text,
            previous_assistant_text,
            latest_assistant_text,
            latest_user_prompt,
        )
        if str(part or "").strip()
    )
    normalized_text = combined_text.replace("\r\n", "\n")
    if not normalized_text.strip():
        return ""

    broader_location = ""
    if re.search(r"\bстолиц[аеиыуеой]+\b|\bв столице\b", normalized_text, flags=re.IGNORECASE):
        broader_location = "Столица"
    elif re.search(r"\bгород[аеуом]?\b|\bв городе\b", normalized_text, flags=re.IGNORECASE):
        broader_location = "Город"
    elif re.search(r"\bдеревн[яеиоуы]\b|\bв деревне\b", normalized_text, flags=re.IGNORECASE):
        broader_location = "Деревня"
    elif re.search(r"\bпорт[ауеом]?\b|\bв порту\b", normalized_text, flags=re.IGNORECASE):
        broader_location = "Порт"

    named_location_patterns: tuple[tuple[str, str], ...] = (
        (r"\bтаверн[аеиоуы]\s+[«\"]?([А-ЯЁA-Z][^\"»\n,.;:]{1,60})", "Таверна"),
        (r"\bтрактир[аеиоуы]?\s+[«\"]?([А-ЯЁA-Z][^\"»\n,.;:]{1,60})", "Трактир"),
        (r"\bпостоял(?:ый|ого|ом|ом дворе|ый двор)\s+[«\"]?([А-ЯЁA-Z][^\"»\n,.;:]{1,60})", "Постоялый двор"),
        (r"\bгильди[яеиоуы]\s+[«\"]?([А-ЯЁA-Z][^\"»\n,.;:]{1,60})", "Гильдия"),
    )

    venue_label = ""
    for pattern, prefix in named_location_patterns:
        match = re.search(pattern, normalized_text, flags=re.IGNORECASE)
        if match is None:
            continue
        raw_name = " ".join(str(match.group(1) or "").split()).strip(" .,:;!?-\"'«»")
        raw_name = re.split(
            r"\s+(?:в|на|у|возле|около|где|когда|пока)\b",
            raw_name,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        if not raw_name:
            continue
        venue_label = f"{prefix} {raw_name}"
        break

    if not venue_label:
        generic_patterns: tuple[tuple[str, str], ...] = (
            (r"\bтаверн[аеиоуы]\b", "Таверна"),
            (r"\bтрактир[аеиоуы]?\b", "Трактир"),
            (r"\bпостоял(?:ый|ого|ом|ый двор)\b", "Постоялый двор"),
            (r"\bгильди[яеиоуы]\b", "Гильдия"),
            (r"\bкомнат[аеуы]\b", "Комната"),
            (r"\bзал[аеуы]\b", "Зал"),
            (r"\bхрам[аеуы]\b", "Храм"),
        )
        for pattern, label in generic_patterns:
            if re.search(pattern, normalized_text, flags=re.IGNORECASE):
                venue_label = label
                break

    resolved_label = venue_label or broader_location
    if resolved_label and broader_location and venue_label and not venue_label.casefold().startswith(broader_location.casefold()):
        resolved_label = f"{broader_location}, {venue_label}"
    return _normalize_story_environment_location_label(resolved_label)


def _story_location_label_is_too_broad(label: str, *, combined_text: str) -> bool:
    normalized_label = _normalize_story_environment_location_label(label).casefold()
    if not normalized_label:
        return True
    if normalized_label in {"улица", "столица", "город", "деревня", "порт", "столица, улица", "город, улица"}:
        return True
    interior_mentioned = any(keyword in combined_text.casefold() for keyword in _STORY_INTERIOR_LOCATION_KEYWORDS)
    if interior_mentioned and "улица" in normalized_label:
        return True
    return False


def _extract_story_openrouter_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            detail = error_payload.get("message") or error_payload.get("detail")
            if isinstance(detail, str) and detail.strip():
                return detail.strip()
        for key in ("detail", "message"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return response.text.strip()[:500] or f"OpenRouter chat error ({response.status_code})"


def _request_story_grok_environment_postprocess_payload(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    include_location: bool,
    include_weather: bool,
) -> dict[str, Any] | None:
    if not include_location and not include_weather:
        return None
    if not settings.openrouter_api_key or not settings.openrouter_chat_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter is not configured for story environment generation",
        )

    current_datetime = deserialize_story_environment_datetime(str(getattr(game, "environment_current_datetime", "") or ""))
    if current_datetime is None:
        current_datetime = _utcnow()
    current_datetime_iso = serialize_story_environment_datetime(current_datetime)
    existing_current_weather = deserialize_story_environment_weather(
        str(getattr(game, "environment_current_weather", "") or "")
    )
    existing_tomorrow_weather = deserialize_story_environment_weather(
        str(getattr(game, "environment_tomorrow_weather", "") or "")
    )
    current_location_label = _normalize_story_environment_location_label(
        str(getattr(game, "current_location_label", "") or "")
    )
    opening_scene_text = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
    combined_text = "\n\n".join(
        part
        for part in (
            current_location_label,
            opening_scene_text,
            previous_assistant_text,
            latest_assistant_text,
            latest_user_prompt,
        )
        if str(part or "").strip()
    )

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    system_prompt = (
        "You analyze a Russian fantasy RPG scene and return strict JSON only without markdown. "
        "All human-readable values must be in Russian. "
        "Return object keys only from this schema: "
        "{\"current_location_label\":\"...\",\"current_weather\":{\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\","
        "\"timeline\":[{\"start_time\":\"00:00\",\"end_time\":\"06:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"06:00\",\"end_time\":\"12:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"12:00\",\"end_time\":\"18:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"18:00\",\"end_time\":\"00:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"}]},"
        "\"tomorrow_weather\":{\"summary\":\"...\",\"temperature_c\":14,\"fog\":\"...\",\"humidity\":\"...\","
        "\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\"}}. "
        "Infer the most specific stable current location. Prefer indoor named venues over broad geography. "
        "If the scene is inside a tavern, inn, room, guild hall, temple, or another interior, current_location_label must include that place and must not collapse to a street. "
        "Example of good specificity: \"Столица, таверна Ржавый якорь\". "
        "For weather, base the forecast on the current season and month, keep it realistic, and make today internally consistent. "
        "current_weather.timeline must contain exactly four broad periods in this order: 00:00-06:00, 06:00-12:00, 12:00-18:00, 18:00-00:00. "
        "The active current_weather summary/details must match the period containing the supplied current time. "
        "Do not use the same weather summary for all four periods unless extreme weather is explicitly described by the scene. "
        "Avoid lazy placeholder outputs like endless 'Переменная облачность' across the whole day."
    )
    user_prompt = (
        f"Игровые дата и время сейчас:\n{current_datetime_iso}\n\n"
        f"Текущее сохраненное место:\n{current_location_label or 'нет'}\n\n"
        f"Сохраненная погода на сегодня:\n{json.dumps(existing_current_weather, ensure_ascii=False) if isinstance(existing_current_weather, dict) else 'нет'}\n\n"
        f"Сохраненный прогноз на завтра:\n{json.dumps(existing_tomorrow_weather, ensure_ascii=False) if isinstance(existing_tomorrow_weather, dict) else 'нет'}\n\n"
        f"Открывающая сцена:\n{opening_scene_text or 'нет'}\n\n"
        f"Последний ход игрока:\n{latest_user_prompt or 'нет'}\n\n"
        f"Предыдущий ответ рассказчика:\n{previous_assistant_text or 'нет'}\n\n"
        f"Новый ответ рассказчика:\n{latest_assistant_text or 'нет'}\n\n"
        "Нужно вернуть только JSON. "
        f"Требуется определить место: {'да' if include_location else 'нет'}. "
        f"Требуется определить погоду: {'да' if include_weather else 'нет'}."
    )

    retry_note = ""
    for attempt_index in range(2):
        request_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt + (f"\n\nИсправление предыдущего ответа:\n{retry_note}" if retry_note else "")},
        ]
        payload = {
            "model": _STORY_ENVIRONMENT_GROK_MODEL,
            "messages": request_messages,
            "temperature": 0.95,
            "max_tokens": 1_000,
        }
        try:
            response = requests.post(
                settings.openrouter_chat_url,
                headers=headers,
                json=payload,
                timeout=(12, 70),
            )
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"OpenRouter request failed: {exc}",
            ) from exc
        if response.status_code >= 400:
            detail = _extract_story_openrouter_error_detail(response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=detail[:500] or f"OpenRouter chat error ({response.status_code})",
            )
        try:
            response_payload = response.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="OpenRouter returned invalid JSON",
            ) from exc

        raw_content = ""
        choices = response_payload.get("choices")
        if isinstance(choices, list) and choices:
            first_choice = choices[0] if isinstance(choices[0], dict) else {}
            message_payload = first_choice.get("message")
            if isinstance(message_payload, dict):
                raw_content = str(message_payload.get("content") or "")
        parsed_payload = _extract_story_json_object(raw_content)
        if not isinstance(parsed_payload, dict):
            retry_note = (
                "Ответ был невалидным JSON. Верни только один корректный JSON-объект без markdown и без лишнего текста."
            )
            continue

        resolved_location_label = ""
        if include_location:
            resolved_location_label = _normalize_story_environment_location_label(
                str(parsed_payload.get("current_location_label") or parsed_payload.get("location_label") or "")
            )
            scene_location_label = _extract_story_specific_scene_location_label(
                latest_user_prompt=latest_user_prompt,
                previous_assistant_text=previous_assistant_text,
                latest_assistant_text=latest_assistant_text,
                opening_scene_text=opening_scene_text,
                current_location_label=current_location_label,
            )
            if scene_location_label and (
                not resolved_location_label
                or _story_location_label_is_too_broad(resolved_location_label, combined_text=combined_text)
            ):
                resolved_location_label = scene_location_label
            if resolved_location_label and "," not in resolved_location_label:
                current_location_prefix = _normalize_story_environment_location_label(
                    str(current_location_label or "").split(",", maxsplit=1)[0]
                )
                if current_location_prefix in {"Столица", "Город", "Деревня", "Порт"}:
                    resolved_location_label = f"{current_location_prefix}, {resolved_location_label}"

        next_current_weather = None
        next_tomorrow_weather = None
        if include_weather:
            next_current_weather = _normalize_story_environment_weather_payload_from_grok(
                parsed_payload.get("current_weather") if isinstance(parsed_payload.get("current_weather"), dict) else None,
                reference_datetime=current_datetime,
                include_timeline=True,
            )
            next_tomorrow_weather = _normalize_story_environment_weather_payload_from_grok(
                parsed_payload.get("tomorrow_weather") if isinstance(parsed_payload.get("tomorrow_weather"), dict) else None,
                reference_datetime=current_datetime + timedelta(days=1),
                include_timeline=False,
            )

        location_invalid = include_location and not resolved_location_label
        weather_invalid = include_weather and (
            not isinstance(next_current_weather, dict)
            or not isinstance(next_tomorrow_weather, dict)
            or _story_weather_payload_is_suspiciously_generic(next_current_weather)
        )
        if not location_invalid and not weather_invalid:
            normalized_payload: dict[str, Any] = {}
            if include_location:
                normalized_payload["location"] = {
                    "action": "update",
                    "label": resolved_location_label,
                    "content": f"Действие происходит {resolved_location_label}.",
                }
            if include_weather:
                normalized_payload["environment"] = {
                    "action": "update",
                    "current_datetime": current_datetime_iso,
                    "current_weather": next_current_weather,
                    "tomorrow_weather": next_tomorrow_weather,
                }
            return normalized_payload or None

        retry_messages: list[str] = []
        if location_invalid:
            retry_messages.append(
                "Место было пустым или слишком общим. Верни наиболее точную текущую локацию, а для интерьера не своди ее к улице."
            )
        if weather_invalid:
            retry_messages.append(
                "Погода на сегодня была слишком общей или ленивой. Нужны 4 разные реалистичные периода для сегодняшнего дня, а текущая summary должна совпадать с активным периодом."
            )
        retry_note = " ".join(retry_messages) or "Исправь ответ по схеме."

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Failed to obtain a valid Grok environment payload",
    )


def _apply_story_grok_environment_postprocess_payload(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage | None,
    payload: dict[str, Any] | None,
) -> None:
    if not isinstance(payload, dict):
        return
    location_payload = payload.get("location")
    if isinstance(location_payload, dict) and str(location_payload.get("action") or "").strip().lower() == "update":
        location_label = _normalize_story_environment_location_label(location_payload.get("label"))
        if location_label:
            game.current_location_label = location_label
            content = (
                normalize_story_memory_block_content(
                    str(location_payload.get("content") or f"Действие происходит {location_label}.")
                )
                if str(location_payload.get("content") or "").strip()
                else f"Действие происходит {location_label}."
            )
            location_block = db.scalar(
                select(StoryMemoryBlock)
                .where(
                    StoryMemoryBlock.game_id == game.id,
                    StoryMemoryBlock.layer == STORY_MEMORY_LAYER_LOCATION,
                )
                .order_by(StoryMemoryBlock.id.desc())
                .limit(1)
            )
            if location_block is None:
                db.add(
                    StoryMemoryBlock(
                        game_id=game.id,
                        assistant_message_id=getattr(assistant_message, "id", None),
                        layer=STORY_MEMORY_LAYER_LOCATION,
                        title=normalize_story_memory_block_title("Место"),
                        content=content,
                        token_count=0,
                    )
                )
            else:
                location_block.assistant_message_id = getattr(assistant_message, "id", None)
                location_block.title = normalize_story_memory_block_title("Место")
                location_block.content = content
                location_block.token_count = 0

    environment_payload = payload.get("environment")
    if isinstance(environment_payload, dict) and str(environment_payload.get("action") or "").strip().lower() == "update":
        current_datetime = deserialize_story_environment_datetime(str(environment_payload.get("current_datetime") or ""))
        if current_datetime is not None:
            game.environment_current_datetime = serialize_story_environment_datetime(current_datetime)
        current_weather = (
            environment_payload.get("current_weather")
            if isinstance(environment_payload.get("current_weather"), dict)
            else None
        )
        tomorrow_weather = (
            environment_payload.get("tomorrow_weather")
            if isinstance(environment_payload.get("tomorrow_weather"), dict)
            else None
        )
        if isinstance(current_weather, dict):
            game.environment_current_weather = serialize_story_environment_weather(current_weather)
        if isinstance(tomorrow_weather, dict):
            game.environment_tomorrow_weather = serialize_story_environment_weather(tomorrow_weather)


def _build_story_grok_environment_postprocess_payload(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    previous_assistant_text: str,
    include_location: bool,
    include_weather: bool,
) -> dict[str, Any] | None:
    return _request_story_grok_environment_postprocess_payload(
        game=game,
        latest_user_prompt=latest_user_prompt,
        previous_assistant_text=previous_assistant_text,
        latest_assistant_text=latest_assistant_text,
        include_location=include_location,
        include_weather=include_weather,
    )


def _story_game_summary_response(
    db: Session,
    game: StoryGame,
    *,
    turn_count: int = 0,
) -> StoryGameSummaryOut:
    summary = story_game_summary_to_out(game, turn_count=turn_count)
    resolved_current_location_label = resolve_story_current_location_label(
        getattr(summary, "current_location_label", None),
        list_story_memory_blocks(db, game.id),
    )
    if resolved_current_location_label != getattr(summary, "current_location_label", None):
        summary = summary.model_copy(update={"current_location_label": resolved_current_location_label})
    return summary


def _build_story_game_snapshot_payload(db: Session, game: StoryGame) -> dict[str, object]:
    messages = list_story_messages(db, game.id)
    turn_images = list_story_turn_images(db, game.id)
    instruction_cards = list_story_instruction_cards(db, game.id)
    plot_cards = list_story_plot_cards(db, game.id)
    plot_card_events = list_story_plot_card_events(db, game.id)
    memory_blocks = list_story_memory_blocks(db, game.id)
    world_cards = list_story_world_cards(db, game.id)
    world_card_events = list_story_world_card_events(db, game.id)
    can_redo_assistant_step = has_story_assistant_redo_step(db, game.id)

    payload = StoryGameOut(
        game=_story_game_summary_response(db, game, turn_count=count_story_completed_turns(messages)),
        messages=[story_message_to_out(message) for message in messages],
        turn_images=[StoryTurnImageOut.model_validate(item) for item in turn_images],
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        plot_cards=[story_plot_card_to_out(card) for card in plot_cards],
        plot_card_events=[story_plot_card_change_event_to_out(event) for event in plot_card_events],
        memory_blocks=[StoryMemoryBlockOut.model_validate(story_memory_block_to_out(block)) for block in memory_blocks],
        world_cards=[story_world_card_to_out(card) for card in world_cards],
        world_card_events=[story_world_card_change_event_to_out(event) for event in world_card_events],
        can_redo_assistant_step=can_redo_assistant_step,
    )
    return payload.model_dump(mode="json")


def _load_latest_story_message_preview_by_game_id(
    db: Session,
    *,
    game_ids: list[int],
) -> dict[int, str]:
    if not game_ids:
        return {}

    latest_message_ids_subquery = (
        select(
            StoryMessage.game_id.label("game_id"),
            func.max(StoryMessage.id).label("max_message_id"),
        )
        .where(
            StoryMessage.game_id.in_(game_ids),
            StoryMessage.undone_at.is_(None),
        )
        .group_by(StoryMessage.game_id)
        .subquery()
    )
    rows = db.execute(
        select(StoryMessage.game_id, StoryMessage.content).join(
            latest_message_ids_subquery,
            (StoryMessage.game_id == latest_message_ids_subquery.c.game_id)
            & (StoryMessage.id == latest_message_ids_subquery.c.max_message_id),
        )
    ).all()

    preview_by_game_id: dict[int, str] = {}
    for game_id, message_content in rows:
        preview = _build_story_list_preview(message_content)
        if preview:
            preview_by_game_id[int(game_id)] = preview
    return preview_by_game_id


def _load_story_turn_count_by_game_id(
    db: Session,
    *,
    game_ids: list[int],
) -> dict[int, int]:
    if not game_ids:
        return {}

    rows = db.execute(
        select(StoryMessage.game_id, StoryMessage.role)
        .where(
            StoryMessage.game_id.in_(game_ids),
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.game_id.asc(), StoryMessage.id.asc())
    ).all()

    turn_count_by_game_id: dict[int, int] = {}
    current_game_id: int | None = None
    has_pending_user_turn = False

    for raw_game_id, raw_role in rows:
        game_id = int(raw_game_id)
        if current_game_id != game_id:
            current_game_id = game_id
            has_pending_user_turn = False
            turn_count_by_game_id.setdefault(game_id, 0)

        role = str(raw_role or "").strip().lower()
        if role == "user":
            has_pending_user_turn = True
            continue
        if role == "assistant" and has_pending_user_turn:
            turn_count_by_game_id[game_id] = turn_count_by_game_id.get(game_id, 0) + 1
            has_pending_user_turn = False

    return turn_count_by_game_id


def _build_story_community_world_summary(
    db: Session,
    *,
    user_id: int,
    world: StoryGame,
    user_rating_override: int | None = None,
    is_reported_by_user_override: bool | None = None,
    is_favorited_by_user_override: bool | None = None,
) -> StoryCommunityWorldSummaryOut:
    author = db.scalar(select(User).where(User.id == world.user_id))

    if user_rating_override is None:
        user_rating_value = db.scalar(
            select(StoryCommunityWorldRating.rating).where(
                StoryCommunityWorldRating.world_id == world.id,
                StoryCommunityWorldRating.user_id == user_id,
            )
        )
        user_rating = int(user_rating_value) if user_rating_value is not None else None
    else:
        user_rating = int(user_rating_override)

    if is_reported_by_user_override is None:
        user_report_id = db.scalar(
            select(StoryCommunityWorldReport.id).where(
                StoryCommunityWorldReport.world_id == world.id,
                StoryCommunityWorldReport.reporter_user_id == user_id,
            )
        )
        is_reported_by_user = user_report_id is not None
    else:
        is_reported_by_user = bool(is_reported_by_user_override)

    if is_favorited_by_user_override is None:
        user_favorite_id = db.scalar(
            select(StoryCommunityWorldFavorite.id).where(
                StoryCommunityWorldFavorite.world_id == world.id,
                StoryCommunityWorldFavorite.user_id == user_id,
            )
        )
        is_favorited_by_user = user_favorite_id is not None
    else:
        is_favorited_by_user = bool(is_favorited_by_user_override)

    return story_community_world_summary_to_out(
        world,
        author_id=world.user_id,
        author_name=story_author_name(author),
        author_avatar_url=story_author_avatar_url(author),
        user_rating=user_rating,
        is_reported_by_user=is_reported_by_user,
        is_favorited_by_user=is_favorited_by_user,
    )


def _get_story_game_publication_copy(db: Session, *, source_game_id: int) -> StoryGame | None:
    return db.scalar(
        select(StoryGame)
        .where(StoryGame.source_world_id == source_game_id)
        .order_by(StoryGame.id.asc())
    )


def _create_story_game_publication_copy_from_source(
    db: Session,
    *,
    source_game: StoryGame,
    copy_cards: bool,
) -> StoryGame:
    publication = StoryGame(
        user_id=source_game.user_id,
        title=source_game.title,
        description=source_game.description,
        opening_scene=source_game.opening_scene,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
        age_rating=source_game.age_rating,
        genres=source_game.genres,
        cover_image_url=source_game.cover_image_url,
        cover_scale=source_game.cover_scale,
        cover_position_x=source_game.cover_position_x,
        cover_position_y=source_game.cover_position_y,
        source_world_id=source_game.id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=source_game.context_limit_chars,
        response_max_tokens=source_game.response_max_tokens,
        response_max_tokens_enabled=source_game.response_max_tokens_enabled,
        story_llm_model=source_game.story_llm_model,
        image_model=source_game.image_model,
        image_style_prompt=source_game.image_style_prompt,
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(
            getattr(source_game, "memory_optimization_enabled", None)
        ),
        story_top_k=source_game.story_top_k,
        story_top_r=source_game.story_top_r,
        story_temperature=source_game.story_temperature,
        show_gg_thoughts=source_game.show_gg_thoughts,
        show_npc_thoughts=source_game.show_npc_thoughts,
        ambient_enabled=source_game.ambient_enabled,
        emotion_visualization_enabled=source_game.emotion_visualization_enabled,
        ambient_profile=source_game.ambient_profile,
        last_activity_at=_utcnow(),
    )
    db.add(publication)
    db.flush()

    if copy_cards:
        clone_story_world_cards_to_game(
            db,
            source_world_id=source_game.id,
            target_game_id=publication.id,
            copy_main_hero=False,
        )
        refresh_story_game_public_card_snapshots(db, publication)

    return publication


def _delete_story_game_with_relations(db: Session, *, game_id: int) -> None:
    db.execute(
        sa_delete(StoryWorldCardChangeEvent).where(
            StoryWorldCardChangeEvent.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCardChangeEvent).where(
            StoryPlotCardChangeEvent.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryTurnImage).where(
            StoryTurnImage.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryMemoryBlock).where(
            StoryMemoryBlock.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryMessage).where(
            StoryMessage.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryInstructionCard).where(
            StoryInstructionCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCard).where(
            StoryPlotCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryWorldCard).where(
            StoryWorldCard.game_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldView).where(
            StoryCommunityWorldView.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldLaunch).where(
            StoryCommunityWorldLaunch.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == game_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == game_id,
        )
    )
    game = db.scalar(select(StoryGame).where(StoryGame.id == game_id))
    if game is not None:
        db.delete(game)


@router.get("/api/story/games", response_model=list[StoryGameSummaryOut])
def list_story_games(
    response: Response,
    compact: bool = False,
    limit: int | None = Query(default=None, ge=1, le=200),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryGameSummaryOut]:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Vary"] = "Authorization"
    user = get_current_user(db, authorization)
    query = (
        select(StoryGame)
        .where(StoryGame.user_id == user.id)
        .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
    )
    if compact:
        query = query.options(
            load_only(
                StoryGame.id,
                StoryGame.title,
                StoryGame.description,
                StoryGame.visibility,
                StoryGame.age_rating,
                StoryGame.genres,
                StoryGame.cover_image_url,
                StoryGame.cover_scale,
                StoryGame.cover_position_x,
                StoryGame.cover_position_y,
                StoryGame.source_world_id,
                StoryGame.community_views,
                StoryGame.community_launches,
                StoryGame.community_rating_sum,
                StoryGame.community_rating_count,
                StoryGame.context_limit_chars,
                StoryGame.response_max_tokens,
                StoryGame.response_max_tokens_enabled,
                StoryGame.story_llm_model,
                StoryGame.image_model,
                StoryGame.memory_optimization_enabled,
                StoryGame.story_top_k,
                StoryGame.story_top_r,
                StoryGame.story_temperature,
                StoryGame.show_gg_thoughts,
                StoryGame.show_npc_thoughts,
                StoryGame.ambient_enabled,
                StoryGame.last_activity_at,
                StoryGame.created_at,
                StoryGame.updated_at,
            )
        )
    if limit is not None:
        query = query.limit(limit)
    games = db.scalars(query).all()
    turn_count_by_game_id = _load_story_turn_count_by_game_id(
        db,
        game_ids=[game.id for game in games],
    )
    if not compact:
        return [
            story_game_summary_to_out(
                game,
                turn_count=turn_count_by_game_id.get(game.id, 0),
            )
            for game in games
        ]

    preview_by_game_id = _load_latest_story_message_preview_by_game_id(
        db,
        game_ids=[game.id for game in games],
    )
    return [
        story_game_summary_to_compact_out(
            game,
            latest_message_preview=preview_by_game_id.get(game.id),
            turn_count=turn_count_by_game_id.get(game.id, 0),
        )
        for game in games
    ]


@router.get("/api/story/community/worlds", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_worlds(
    limit: int = Query(default=60, ge=1, le=60),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
    worlds = db.scalars(
        select(StoryGame)
        .where(
            StoryGame.visibility == "public",
        )
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

    world_ids = [world.id for world in worlds]
    author_ids = sorted({world.user_id for world in worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}
    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}
    user_favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.user_id == user.id,
            StoryCommunityWorldFavorite.world_id.in_(world_ids),
        )
    ).all()
    favorited_world_ids = {row.world_id for row in user_favorite_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=world.id in favorited_world_ids,
        )
        for world in worlds
    ]


@router.get("/api/story/community/favorites", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_favorites(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
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
        world_id = int(row.world_id)
        if world_id in seen_world_ids:
            continue
        seen_world_ids.add(world_id)
        ordered_world_ids.append(world_id)

    worlds = db.scalars(
        select(StoryGame).where(
            StoryGame.id.in_(ordered_world_ids),
            StoryGame.visibility == "public",
        )
    ).all()
    if not worlds:
        return []

    world_by_id = {world.id: world for world in worlds}
    ordered_worlds = [world_by_id[world_id] for world_id in ordered_world_ids if world_id in world_by_id]
    if not ordered_worlds:
        return []

    world_ids = [world.id for world in ordered_worlds]
    author_ids = sorted({world.user_id for world in ordered_worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}

    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=True,
        )
        for world in ordered_worlds
    ]


@router.post("/api/story/community/worlds/{world_id}/launch", response_model=StoryGameSummaryOut)
def launch_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    title = world.title.strip() or STORY_DEFAULT_TITLE

    cloned_game = StoryGame(
        user_id=user.id,
        title=title,
        description=world.description or "",
        opening_scene=world.opening_scene or "",
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(world.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(world.genres)),
        cover_image_url=normalize_story_cover_image_url(world.cover_image_url),
        cover_scale=normalize_story_cover_scale(world.cover_scale),
        cover_position_x=normalize_story_cover_position(world.cover_position_x),
        cover_position_y=normalize_story_cover_position(world.cover_position_y),
        source_world_id=world.id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(world.context_limit_chars),
        response_max_tokens=normalize_story_response_max_tokens(getattr(world, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(world, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(world, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(world, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(world, "image_style_prompt", None)),
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(
            getattr(world, "memory_optimization_enabled", None)
        ),
        story_top_k=normalize_story_top_k(getattr(world, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(world, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(world, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(world, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(world, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(world, "ambient_enabled", None)),
        emotion_visualization_enabled=normalize_story_emotion_visualization_enabled(
            getattr(world, "emotion_visualization_enabled", None)
        ),
        ambient_profile=str(getattr(world, "ambient_profile", "") or ""),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    ensure_story_game_public_card_snapshots(db, world)
    source_instruction_cards, source_plot_cards, source_world_cards = get_story_game_public_cards_out(db, world)
    clone_story_world_cards_to_game(
        db,
        source_world_id=world.id,
        target_game_id=cloned_game.id,
        source_instruction_cards_out=source_instruction_cards,
        source_plot_cards_out=source_plot_cards,
        source_world_cards_out=source_world_cards,
    )

    launch_inserted = False
    try:
        with db.begin_nested():
            db.add(
                StoryCommunityWorldLaunch(
                    world_id=world.id,
                    user_id=user.id,
                )
            )
            db.flush()
        launch_inserted = True
    except IntegrityError:
        launch_inserted = False

    if launch_inserted:
        increment_story_world_launches(db, world.id)
    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return _story_game_summary_response(db, cloned_game)


@router.post("/api/story/community/worlds/{world_id}/rating", response_model=StoryCommunityWorldSummaryOut)
def rate_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldRatingRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    rating_value = int(payload.rating)

    existing_rating = db.scalar(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == world.id,
            StoryCommunityWorldRating.user_id == user.id,
        )
    )
    if rating_value <= 0:
        if existing_rating is not None:
            previous_rating = int(existing_rating.rating)
            db.delete(existing_rating)
            apply_story_world_rating_delete(db, world.id, previous_rating)
        db.commit()
        db.refresh(world)
        return _build_story_community_world_summary(
            db,
            user_id=user.id,
            world=world,
            user_rating_override=None,
        )

    if existing_rating is None:
        inserted_rating: StoryCommunityWorldRating | None = None
        try:
            with db.begin_nested():
                inserted_rating = StoryCommunityWorldRating(
                    world_id=world.id,
                    user_id=user.id,
                    rating=rating_value,
                )
                db.add(inserted_rating)
                db.flush()
            apply_story_world_rating_insert(db, world.id, rating_value)
            existing_rating = inserted_rating
        except IntegrityError:
            existing_rating = db.scalar(
                select(StoryCommunityWorldRating).where(
                    StoryCommunityWorldRating.world_id == world.id,
                    StoryCommunityWorldRating.user_id == user.id,
                )
            )

    if existing_rating is not None:
        previous_rating = int(existing_rating.rating)
        if previous_rating != rating_value:
            existing_rating.rating = rating_value
            apply_story_world_rating_update(db, world.id, rating_value - previous_rating)

    db.commit()
    db.refresh(world)
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        user_rating_override=rating_value,
    )


@router.post("/api/story/community/worlds/{world_id}/report", response_model=StoryCommunityWorldSummaryOut)
def report_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report description should not be empty",
        )

    existing_report_id = db.scalar(
        select(StoryCommunityWorldReport.id).where(
            StoryCommunityWorldReport.world_id == world.id,
            StoryCommunityWorldReport.reporter_user_id == user.id,
        )
    )
    if existing_report_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        )

    db.add(
        StoryCommunityWorldReport(
            world_id=world.id,
            reporter_user_id=user.id,
            reason=payload.reason,
            description=description,
            status=STORY_WORLD_REPORT_STATUS_OPEN,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        ) from None

    reporter_name = story_author_name(user)
    world_title = str(world.title or "").strip() or f"Мир #{int(world.id)}"
    _notify_story_staff(
        db,
        kind=NOTIFICATION_KIND_MODERATION_REPORT,
        title="Новая жалоба на мир",
        body=f"{reporter_name} отправил жалобу на мир \"{world_title}\".",
        action_url="/profile",
        actor_user_id=int(user.id),
    )
    db.refresh(world)
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_reported_by_user_override=True,
    )


@router.get("/api/story/community/worlds/{world_id}/comments", response_model=list[StoryCommunityWorldCommentOut])
def list_story_community_world_comments(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldCommentOut]:
    get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    return list_story_community_world_comments_out(db, world_id=world.id)


@router.post("/api/story/community/worlds/{world_id}/comments", response_model=StoryCommunityWorldCommentOut)
def create_story_community_world_comment(
    world_id: int,
    payload: StoryCommunityWorldCommentCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment = StoryCommunityWorldComment(
        world_id=world.id,
        user_id=user.id,
        content=content,
    )
    db.add(comment)
    db.flush()
    owner_notification_drafts: list[NotificationDraft] = []
    if int(world.user_id) != int(user.id):
        world_title = str(world.title or "").strip() or f"Мир #{int(world.id)}"
        commenter_name = story_author_name(user)
        owner_notification_drafts.append(
            NotificationDraft(
                user_id=int(world.user_id),
                kind=NOTIFICATION_KIND_WORLD_COMMENT,
                title="Новый комментарий к миру",
                body=f"{commenter_name} оставил комментарий к миру \"{world_title}\".",
                action_url=f"/games/all?worldId={int(world.id)}",
                actor_user_id=int(user.id),
            )
        )
    db.commit()
    if owner_notification_drafts:
        _persist_notifications(db, owner_notification_drafts)
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.patch("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=StoryCommunityWorldCommentOut)
def update_story_community_world_comment(
    world_id: int,
    comment_id: int,
    payload: StoryCommunityWorldCommentUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit this comment")

    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment.content = content
    db.commit()
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.delete("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=MessageResponse)
def delete_story_community_world_comment(
    world_id: int,
    comment_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id and user.role not in PRIVILEGED_WORLD_COMMENT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this comment")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="Comment deleted")


@router.post("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def favorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    existing_favorite_id = db.scalar(
        select(StoryCommunityWorldFavorite.id).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if existing_favorite_id is None:
        db.add(
            StoryCommunityWorldFavorite(
                world_id=world.id,
                user_id=user.id,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=True,
    )


@router.delete("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def unfavorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    favorite_row = db.scalar(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if favorite_row is not None:
        db.delete(favorite_row)
        db.commit()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=False,
    )


@router.post("/api/story/games", response_model=StoryGameSummaryOut)
def create_story_game(
    payload: StoryGameCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    title = payload.title.strip() if payload.title else STORY_DEFAULT_TITLE
    if not title:
        title = STORY_DEFAULT_TITLE
    description = normalize_story_game_description(payload.description)
    opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    requested_visibility = normalize_story_game_visibility(payload.visibility)
    age_rating = normalize_story_game_age_rating(payload.age_rating)
    genres = normalize_story_game_genres(payload.genres)
    cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    cover_scale = normalize_story_cover_scale(payload.cover_scale)
    cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    cover_position_y = normalize_story_cover_position(payload.cover_position_y)
    context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(payload.response_max_tokens_enabled)
    story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    image_model = normalize_story_image_model(payload.image_model)
    image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    memory_optimization_enabled = normalize_story_memory_optimization_enabled(payload.memory_optimization_enabled)
    story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(payload.story_top_r)
    story_temperature = normalize_story_temperature(payload.story_temperature)
    show_gg_thoughts = normalize_story_show_gg_thoughts(payload.show_gg_thoughts)
    show_npc_thoughts = normalize_story_show_npc_thoughts(payload.show_npc_thoughts)
    ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)
    environment_enabled = normalize_story_environment_enabled(payload.environment_enabled)
    emotion_visualization_enabled = (
        normalize_story_emotion_visualization_enabled(payload.emotion_visualization_enabled)
        if user.role == "administrator"
        else False
    )

    game = StoryGame(
        user_id=user.id,
        title=title,
        description=description,
        opening_scene=opening_scene,
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=age_rating,
        genres=serialize_story_game_genres(genres),
        cover_image_url=cover_image_url,
        cover_scale=cover_scale,
        cover_position_x=cover_position_x,
        cover_position_y=cover_position_y,
        source_world_id=None,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=context_limit_chars,
        response_max_tokens=response_max_tokens,
        response_max_tokens_enabled=response_max_tokens_enabled,
        story_llm_model=story_llm_model,
        image_model=image_model,
        image_style_prompt=image_style_prompt,
        memory_optimization_enabled=memory_optimization_enabled,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        story_temperature=story_temperature,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
        ambient_enabled=ambient_enabled,
        environment_enabled=environment_enabled,
        environment_time_mode=coerce_story_environment_time_mode(None),
        environment_turn_step_minutes=normalize_story_environment_turn_step_minutes(None),
        emotion_visualization_enabled=emotion_visualization_enabled,
        ambient_profile="",
        environment_current_datetime="",
        environment_current_weather="",
        environment_tomorrow_weather="",
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.flush()
    if requested_visibility == STORY_GAME_VISIBILITY_PUBLIC:
        mark_story_publication_pending(game)
    db.commit()
    db.refresh(game)
    if requested_visibility == STORY_GAME_VISIBILITY_PUBLIC:
        game_title = str(game.title or "").strip() or f"Мир #{int(game.id)}"
        author_name = story_author_name(user)
        _notify_story_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Новый мир на модерации",
            body=f"{author_name} отправил на модерацию мир \"{game_title}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return _story_game_summary_response(db, game)


@router.post("/api/story/games/quick-start", response_model=StoryGameSummaryOut)
def create_story_quick_start_game(
    payload: StoryQuickStartRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    genre = _normalize_story_quick_start_text(payload.genre, field_label="Quick start genre", max_length=80)
    hero_class = _normalize_story_quick_start_text(payload.hero_class, field_label="Quick start class", max_length=80)
    protagonist_name = _normalize_story_quick_start_text(
        payload.protagonist_name,
        field_label="Quick start protagonist name",
        max_length=120,
    )
    start_mode = _normalize_story_quick_start_mode(payload.start_mode)

    generated_payload = _generate_story_quick_start_payload(
        genre=genre,
        hero_class=hero_class,
        protagonist_name=protagonist_name,
        start_mode=start_mode,
    )

    raw_game_title = str(generated_payload.get("game_title") or "").strip()
    raw_game_description = str(generated_payload.get("game_description") or "").strip()
    raw_hero_description = str(generated_payload.get("hero_description") or "").strip()
    raw_opening_scene = str(generated_payload.get("opening_scene") or "").strip()
    raw_hero_triggers = generated_payload.get("hero_triggers")

    game_title = (raw_game_title or f"{genre}: {protagonist_name}")[:160].strip() or STORY_DEFAULT_TITLE
    game_description = normalize_story_game_description(raw_game_description or f"{genre}. {hero_class}. {protagonist_name}.")
    hero_description = normalize_story_world_card_content(raw_hero_description or f"{protagonist_name} — {hero_class} жанра {genre}.")
    opening_scene = normalize_story_game_opening_scene(raw_opening_scene or game_description)
    if isinstance(raw_hero_triggers, list):
        hero_triggers_source = [
            str(value).strip()
            for value in raw_hero_triggers
            if isinstance(value, str) and str(value).strip()
        ]
    else:
        hero_triggers_source = [protagonist_name, hero_class, genre]
    hero_triggers = normalize_story_world_card_triggers(hero_triggers_source, fallback_title=protagonist_name)

    game = StoryGame(
        user_id=user.id,
        title=game_title,
        description=game_description,
        opening_scene=opening_scene,
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=normalize_story_game_age_rating("16+"),
        genres=serialize_story_game_genres(normalize_story_game_genres([genre])),
        cover_image_url=None,
        cover_scale=normalize_story_cover_scale(None),
        cover_position_x=normalize_story_cover_position(None),
        cover_position_y=normalize_story_cover_position(None),
        source_world_id=None,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(None),
        response_max_tokens=normalize_story_response_max_tokens(None),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(None),
        story_llm_model=normalize_story_llm_model(None),
        image_model=normalize_story_image_model(None),
        image_style_prompt=normalize_story_image_style_prompt(None),
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(None),
        story_top_k=normalize_story_top_k(None),
        story_top_r=normalize_story_top_r(None),
        story_temperature=normalize_story_temperature(None),
        show_gg_thoughts=normalize_story_show_gg_thoughts(None),
        show_npc_thoughts=normalize_story_show_npc_thoughts(None),
        ambient_enabled=normalize_story_ambient_enabled(None),
        environment_enabled=normalize_story_environment_enabled(None),
        environment_time_mode=coerce_story_environment_time_mode(None),
        environment_turn_step_minutes=normalize_story_environment_turn_step_minutes(None),
        emotion_visualization_enabled=False,
        ambient_profile="",
        environment_current_datetime="",
        environment_current_weather="",
        environment_tomorrow_weather="",
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.flush()

    db.add(
        StoryWorldCard(
            game_id=game.id,
            title=normalize_story_world_card_title(protagonist_name),
            content=hero_description,
            triggers=serialize_story_world_card_triggers(hero_triggers),
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
    return _story_game_summary_response(db, game)


@router.post("/api/story/games/{game_id}/clone", response_model=StoryGameSummaryOut)
def clone_story_game(
    game_id: int,
    payload: StoryGameCloneRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    source_game = get_user_story_game_or_404(db, user.id, game_id)

    cloned_game = StoryGame(
        user_id=user.id,
        title=_build_story_clone_title(source_game.title or ""),
        description=normalize_story_game_description(source_game.description),
        opening_scene=normalize_story_game_opening_scene(source_game.opening_scene),
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(source_game.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(source_game.genres)),
        cover_image_url=normalize_story_cover_image_url(source_game.cover_image_url),
        cover_scale=normalize_story_cover_scale(source_game.cover_scale),
        cover_position_x=normalize_story_cover_position(source_game.cover_position_x),
        cover_position_y=normalize_story_cover_position(source_game.cover_position_y),
        source_world_id=source_game.source_world_id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(source_game.context_limit_chars),
        response_max_tokens=normalize_story_response_max_tokens(getattr(source_game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(source_game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(source_game, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(source_game, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(source_game, "image_style_prompt", None)),
        memory_optimization_enabled=normalize_story_memory_optimization_enabled(
            getattr(source_game, "memory_optimization_enabled", None)
        ),
        story_top_k=normalize_story_top_k(getattr(source_game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(source_game, "story_top_r", None)),
        story_temperature=normalize_story_temperature(getattr(source_game, "story_temperature", None)),
        show_gg_thoughts=normalize_story_show_gg_thoughts(getattr(source_game, "show_gg_thoughts", None)),
        show_npc_thoughts=normalize_story_show_npc_thoughts(getattr(source_game, "show_npc_thoughts", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(source_game, "ambient_enabled", None)),
        environment_enabled=normalize_story_environment_enabled(getattr(source_game, "environment_enabled", None)),
        environment_time_mode=coerce_story_environment_time_mode(None),
        environment_turn_step_minutes=normalize_story_environment_turn_step_minutes(None),
        emotion_visualization_enabled=normalize_story_emotion_visualization_enabled(
            getattr(source_game, "emotion_visualization_enabled", None)
        ),
        ambient_profile=str(getattr(source_game, "ambient_profile", "") or ""),
        environment_current_datetime=str(getattr(source_game, "environment_current_datetime", "") or ""),
        environment_current_weather=str(getattr(source_game, "environment_current_weather", "") or ""),
        environment_tomorrow_weather=str(getattr(source_game, "environment_tomorrow_weather", "") or ""),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    clone_story_world_cards_to_game(
        db,
        source_world_id=source_game.id,
        target_game_id=cloned_game.id,
        copy_instructions=payload.copy_instructions,
        copy_plot=payload.copy_plot,
        copy_world=payload.copy_world,
        copy_main_hero=payload.copy_main_hero,
    )

    if payload.copy_history:
        source_messages = list_story_messages(db, source_game.id)
        message_id_map: dict[int, int] = {}
        for message in source_messages:
            cloned_message = StoryMessage(
                game_id=cloned_game.id,
                role=message.role,
                content=message.content,
            )
            db.add(cloned_message)
            db.flush()
            message_id_map[int(message.id)] = int(cloned_message.id)

        source_memory_blocks = list_story_memory_blocks(db, source_game.id)
        for block in source_memory_blocks:
            block_layer = normalize_story_memory_layer(getattr(block, "layer", None))
            if block_layer in {
                STORY_MEMORY_LAYER_RAW,
                STORY_MEMORY_LAYER_COMPRESSED,
                STORY_MEMORY_LAYER_SUPER,
            }:
                continue
            source_assistant_message_id = getattr(block, "assistant_message_id", None)
            target_assistant_message_id: int | None = None
            if source_assistant_message_id is not None:
                target_assistant_message_id = message_id_map.get(int(source_assistant_message_id))
            cloned_memory_block = StoryMemoryBlock(
                game_id=cloned_game.id,
                assistant_message_id=target_assistant_message_id,
                layer=block_layer,
                title=str(block.title or ""),
                content=str(block.content or ""),
                token_count=max(int(getattr(block, "token_count", 0) or 0), 0),
            )
            db.add(cloned_memory_block)

    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return _story_game_summary_response(db, cloned_game)


@router.post("/api/story/games/{game_id}/bug-reports", response_model=MessageResponse)
def create_story_bug_report(
    game_id: int,
    payload: StoryBugReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    title = _normalize_story_bug_report_title(payload.title)
    description = _normalize_story_bug_report_description(payload.description)
    snapshot_payload = _build_story_game_snapshot_payload(db, game)
    snapshot_payload_json = json.dumps(snapshot_payload, ensure_ascii=False, separators=(",", ":"))
    source_game_title = (str(game.title or "").strip() or f"Game #{int(game.id)}")[:STORY_GAME_TITLE_MAX_LENGTH]

    report = StoryBugReport(
        source_game_id=int(game.id),
        source_game_title=source_game_title,
        reporter_user_id=int(user.id),
        reporter_display_name=story_author_name(user),
        title=title,
        description=description,
        snapshot_payload=snapshot_payload_json,
        status=STORY_BUG_REPORT_STATUS_OPEN,
        closed_by_user_id=None,
        closed_at=None,
    )
    db.add(report)
    db.commit()
    source_game_label = str(game.title or "").strip() or f"Мир #{int(game.id)}"
    reporter_name = story_author_name(user)
    _notify_story_staff(
        db,
        kind=NOTIFICATION_KIND_MODERATION_REPORT,
        title="Новый bug report",
        body=f"{reporter_name} отправил bug report по миру \"{source_game_label}\": {title}.",
        action_url="/profile",
        actor_user_id=int(user.id),
    )
    return MessageResponse(message="Bug report submitted")


@router.patch("/api/story/games/{game_id}/settings", response_model=StoryGameSummaryOut)
def update_story_game_settings(
    game_id: int,
    payload: StoryGameSettingsUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    if payload.context_limit_chars is not None:
        game.context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    if payload.response_max_tokens is not None:
        game.response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    if payload.response_max_tokens_enabled is not None:
        game.response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(
            payload.response_max_tokens_enabled
        )
    if payload.story_llm_model is not None:
        game.story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    if payload.image_model is not None:
        game.image_model = normalize_story_image_model(payload.image_model)
    if payload.image_style_prompt is not None:
        game.image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    # Memory optimization is mandatory and cannot be disabled.
    game.memory_optimization_enabled = normalize_story_memory_optimization_enabled(
        payload.memory_optimization_enabled
    )
    if payload.story_top_k is not None:
        game.story_top_k = normalize_story_top_k(payload.story_top_k)
    if payload.story_top_r is not None:
        game.story_top_r = normalize_story_top_r(payload.story_top_r)
    if payload.story_temperature is not None:
        game.story_temperature = normalize_story_temperature(payload.story_temperature)
    if payload.show_gg_thoughts is not None:
        game.show_gg_thoughts = normalize_story_show_gg_thoughts(payload.show_gg_thoughts)
    if payload.show_npc_thoughts is not None:
        game.show_npc_thoughts = normalize_story_show_npc_thoughts(payload.show_npc_thoughts)
    if payload.ambient_enabled is not None:
        game.ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)
    if payload.environment_enabled is not None:
        game.environment_enabled = normalize_story_environment_enabled(payload.environment_enabled)
    if "environment_current_datetime" in payload.model_fields_set:
        game.environment_current_datetime = serialize_story_environment_datetime(
            deserialize_story_environment_datetime(payload.environment_current_datetime)
        )
    if "environment_current_weather" in payload.model_fields_set:
        game.environment_current_weather = serialize_story_environment_weather(payload.environment_current_weather)
    if "environment_tomorrow_weather" in payload.model_fields_set:
        game.environment_tomorrow_weather = serialize_story_environment_weather(payload.environment_tomorrow_weather)
    if "current_location_label" in payload.model_fields_set:
        game.current_location_label = _normalize_story_environment_location_label(payload.current_location_label)
    if payload.emotion_visualization_enabled is not None and user.role == "administrator":
        game.emotion_visualization_enabled = normalize_story_emotion_visualization_enabled(
            payload.emotion_visualization_enabled
        )
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return _story_game_summary_response(db, game)


def _regenerate_story_game_environment_weather_safe(
    *,
    user: User,
    game: StoryGame,
    db: Session,
) -> StoryGameSummaryOut:
    messages = list_story_messages(db, game.id)
    assistant_messages = [
        message
        for message in messages
        if str(getattr(message, "role", "") or "") == "assistant"
        and str(getattr(message, "content", "") or "").strip()
    ]
    latest_assistant_message = assistant_messages[-1] if assistant_messages else None
    previous_assistant_message = assistant_messages[-2] if len(assistant_messages) > 1 else None
    latest_user_message = next(
        (
            message
            for message in reversed(messages)
            if str(getattr(message, "role", "") or "") == "user"
            and str(getattr(message, "content", "") or "").strip()
        ),
        None,
    )

    latest_assistant_text = (
        str(getattr(latest_assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(latest_assistant_message, StoryMessage)
        else ""
    )
    if not latest_assistant_text:
        latest_assistant_text = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
    previous_assistant_text = (
        str(getattr(previous_assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(previous_assistant_message, StoryMessage)
        else ""
    )
    latest_user_prompt = (
        str(getattr(latest_user_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(latest_user_message, StoryMessage)
        else ""
    )

    current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
        db=db,
        game_id=game.id,
    )
    if not current_location_content:
        current_location_label = _normalize_story_environment_location_label(
            str(getattr(game, "current_location_label", "") or "")
        )
        if current_location_label:
            current_location_content = (
                story_memory_pipeline._normalize_story_location_memory_content(
                    f"Р”РµР№СЃС‚РІРёРµ РїСЂРѕРёСЃС…РѕРґРёС‚ {current_location_label}."
                )
                or current_location_label
            )

    try:
        seeded_payload = story_memory_pipeline._seed_story_environment_weather_payload(
            game=game,
            current_location_content=current_location_content,
            latest_user_prompt=latest_user_prompt,
            previous_assistant_text=previous_assistant_text,
            latest_assistant_text=latest_assistant_text,
            current_datetime_override=str(getattr(game, "environment_current_datetime", "") or ""),
        )
    except Exception:
        db.rollback()
        logger.exception(
            "Story environment weather seed crashed: game_id=%s user_id=%s",
            game.id,
            user.id,
        )
        db.refresh(game)
        return _story_game_summary_response(db, game)

    if not isinstance(seeded_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РїСЂРѕРіРЅРѕР·",
        )

    try:
        current_datetime = story_memory_pipeline._deserialize_story_environment_datetime(
            str(getattr(game, "environment_current_datetime", "") or "")
        )
        current_day_date = story_memory_pipeline._story_environment_date_key_from_value(
            current_datetime
            or (
                seeded_payload.get("current_weather", {})
                if isinstance(seeded_payload.get("current_weather"), dict)
                else {}
            ).get("day_date")
        )
        tomorrow_day_date = story_memory_pipeline._story_environment_date_key_from_value(
            (
                seeded_payload.get("tomorrow_weather", {})
                if isinstance(seeded_payload.get("tomorrow_weather"), dict)
                else {}
            ).get("day_date")
        )
        if not tomorrow_day_date and current_day_date:
            tomorrow_day_date = story_memory_pipeline._story_environment_next_date_key(current_day_date)

        supporting_text = "\n\n".join(
            part
            for part in (
                current_location_content,
                latest_user_prompt,
                previous_assistant_text,
                latest_assistant_text,
            )
            if str(part or "").strip()
        )
        next_current_weather = story_memory_pipeline._repair_story_environment_weather_payload(
            (
                seeded_payload.get("current_weather")
                if isinstance(seeded_payload.get("current_weather"), dict)
                else None
            ),
            reference_datetime=current_datetime,
            supporting_text=supporting_text,
            target_day_date=current_day_date,
            ensure_timeline=True,
            align_to_current_period=current_datetime is not None,
        )
        next_tomorrow_weather = story_memory_pipeline._repair_story_environment_weather_payload(
            (
                seeded_payload.get("tomorrow_weather")
                if isinstance(seeded_payload.get("tomorrow_weather"), dict)
                else None
            ),
            reference_datetime=story_memory_pipeline._story_environment_datetime_from_day_date(
                tomorrow_day_date,
                hour=12,
            ),
            supporting_text=supporting_text,
            target_day_date=tomorrow_day_date,
        )
        if not isinstance(next_current_weather, dict) or not isinstance(next_tomorrow_weather, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РїРѕР»РЅС‹Р№ РїСЂРѕРіРЅРѕР· РЅР° СЃРµРіРѕРґРЅСЏ Рё Р·Р°РІС‚СЂР°",
            )

        game.environment_current_weather = serialize_story_environment_weather(next_current_weather)
        game.environment_tomorrow_weather = serialize_story_environment_weather(next_tomorrow_weather)
        story_memory_pipeline._sync_story_manual_environment_memory_blocks(db=db, game=game)
        touch_story_game(game)
        db.commit()
        db.refresh(game)
        return _story_game_summary_response(db, game)
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Story environment regenerate finalize crashed: game_id=%s user_id=%s",
            game.id,
            user.id,
        )
        db.refresh(game)
        return _story_game_summary_response(db, game)
def _regenerate_story_game_environment_weather_grok_safe(
    *,
    user: User,
    game: StoryGame,
    db: Session,
) -> StoryGameSummaryOut:
    messages = list_story_messages(db, game.id)
    assistant_messages = [
        message
        for message in messages
        if str(getattr(message, "role", "") or "") == "assistant"
        and str(getattr(message, "content", "") or "").strip()
    ]
    latest_assistant_message = assistant_messages[-1] if assistant_messages else None
    previous_assistant_message = assistant_messages[-2] if len(assistant_messages) > 1 else None
    latest_user_message = next(
        (
            message
            for message in reversed(messages)
            if str(getattr(message, "role", "") or "") == "user"
            and str(getattr(message, "content", "") or "").strip()
        ),
        None,
    )
    latest_assistant_text = (
        str(getattr(latest_assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(latest_assistant_message, StoryMessage)
        else ""
    )
    if not latest_assistant_text:
        latest_assistant_text = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
    previous_assistant_text = (
        str(getattr(previous_assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(previous_assistant_message, StoryMessage)
        else ""
    )
    latest_user_prompt = (
        str(getattr(latest_user_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(latest_user_message, StoryMessage)
        else ""
    )

    try:
        postprocess_payload = _build_story_grok_environment_postprocess_payload(
            game=game,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            previous_assistant_text=previous_assistant_text,
            include_location=True,
            include_weather=True,
            force_weather_refresh=True,
        )
        _apply_story_grok_environment_postprocess_payload(
            db=db,
            game=game,
            assistant_message=latest_assistant_message if isinstance(latest_assistant_message, StoryMessage) else None,
            payload=postprocess_payload,
        )
        touch_story_game(game)
        db.commit()
        db.refresh(game)
        return _story_game_summary_response(db, game)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Story environment regenerate via Grok crashed: game_id=%s user_id=%s",
            game.id,
            user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to regenerate story environment with Grok",
        )


@router.post("/api/story/games/{game_id}/environment/regenerate", response_model=StoryGameSummaryOut)
def regenerate_story_game_environment_weather(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    if not normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Блок окружения выключен",
        )
    return _regenerate_story_game_environment_weather_grok_safe(user=user, game=game, db=db)

    from app.services import story_memory_pipeline

    messages = list_story_messages(db, game.id)
    assistant_messages = [
        message
        for message in messages
        if str(getattr(message, "role", "") or "") == "assistant"
        and str(getattr(message, "content", "") or "").strip()
    ]
    latest_assistant_message = assistant_messages[-1] if assistant_messages else None
    previous_assistant_message = assistant_messages[-2] if len(assistant_messages) > 1 else None
    latest_user_message = next(
        (
            message
            for message in reversed(messages)
            if str(getattr(message, "role", "") or "") == "user"
            and str(getattr(message, "content", "") or "").strip()
        ),
        None,
    )

    latest_assistant_text = (
        story_memory_pipeline._normalize_story_assistant_text_for_memory(latest_assistant_message.content)
        if isinstance(latest_assistant_message, StoryMessage)
        else ""
    )
    if not latest_assistant_text:
        latest_assistant_text = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
    previous_assistant_text = (
        story_memory_pipeline._normalize_story_assistant_text_for_memory(previous_assistant_message.content)
        if isinstance(previous_assistant_message, StoryMessage)
        else ""
    )
    latest_user_prompt = (
        str(getattr(latest_user_message, "content", "") or "").replace("\r\n", "\n").strip()
        if isinstance(latest_user_message, StoryMessage)
        else ""
    )

    seeded_payload = story_memory_pipeline._seed_story_environment_weather_payload(
        game=game,
        current_location_content=current_location_content,
        latest_user_prompt=latest_user_prompt,
        previous_assistant_text=previous_assistant_text,
        latest_assistant_text=latest_assistant_text,
        current_datetime_override=str(getattr(game, "environment_current_datetime", "") or ""),
    )
    if not isinstance(seeded_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось перегенерировать прогноз",
        )

    current_datetime = story_memory_pipeline._deserialize_story_environment_datetime(
        str(getattr(game, "environment_current_datetime", "") or "")
    )
    current_day_date = story_memory_pipeline._story_environment_date_key_from_value(
        current_datetime
        or (
            seeded_payload.get("current_weather", {})
            if isinstance(seeded_payload.get("current_weather"), dict)
            else {}
        ).get("day_date")
    )
    tomorrow_day_date = story_memory_pipeline._story_environment_date_key_from_value(
        (
            seeded_payload.get("tomorrow_weather", {})
            if isinstance(seeded_payload.get("tomorrow_weather"), dict)
            else {}
        ).get("day_date")
    )
    if not tomorrow_day_date and current_day_date:
        tomorrow_day_date = story_memory_pipeline._story_environment_next_date_key(current_day_date)

    supporting_text = "\n\n".join(
        part
        for part in (
            current_location_content,
            latest_user_prompt,
            previous_assistant_text,
            latest_assistant_text,
        )
        if str(part or "").strip()
    )
    next_current_weather = story_memory_pipeline._repair_story_environment_weather_payload(
        (
            seeded_payload.get("current_weather")
            if isinstance(seeded_payload.get("current_weather"), dict)
            else None
        ),
        reference_datetime=current_datetime,
        supporting_text=supporting_text,
        target_day_date=current_day_date,
        ensure_timeline=True,
        align_to_current_period=current_datetime is not None,
    )
    next_tomorrow_weather = story_memory_pipeline._repair_story_environment_weather_payload(
        (
            seeded_payload.get("tomorrow_weather")
            if isinstance(seeded_payload.get("tomorrow_weather"), dict)
            else None
        ),
        reference_datetime=story_memory_pipeline._story_environment_datetime_from_day_date(
            tomorrow_day_date,
            hour=12,
        ),
        supporting_text=supporting_text,
        target_day_date=tomorrow_day_date,
    )
    if not isinstance(next_current_weather, dict) or not isinstance(next_tomorrow_weather, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось получить полный прогноз на сегодня и завтра",
        )

    game.environment_current_weather = serialize_story_environment_weather(next_current_weather)
    game.environment_tomorrow_weather = serialize_story_environment_weather(next_tomorrow_weather)
    story_memory_pipeline._sync_story_manual_environment_memory_blocks(db=db, game=game)
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return _story_game_summary_response(db, game)


# NOTE: Critical hotfix overrides.
# The module currently contains legacy mojibake literals in earlier helper definitions.
# We override the environment post-process helpers here with UTF-safe logic.
_STORY_INTERIOR_LOCATION_KEYWORDS = (
    "\u0442\u0430\u0432\u0435\u0440\u043d",
    "\u0442\u0440\u0430\u043a\u0442\u0438\u0440",
    "\u043f\u043e\u0441\u0442\u043e\u044f\u043b",
    "\u043a\u043e\u0440\u0447\u043c",
    "\u0433\u043e\u0441\u0442\u0438\u043d",
    "\u043a\u0430\u0431\u0430",
    "\u0445\u0430\u0440\u0447\u0435\u0432\u043d",
    "\u0437\u0430\u043b",
    "\u043a\u043e\u043c\u043d\u0430\u0442",
    "\u043d\u043e\u043c\u0435\u0440",
    "\u043a\u0430\u0431\u0438\u043d\u0435\u0442",
    "\u0445\u0440\u0430\u043c",
    "\u0441\u0432\u044f\u0442\u0438\u043b\u0438\u0449",
    "\u0433\u0438\u043b\u044c\u0434\u0438",
)


def _story_weather_payload_signature(
    payload: dict[str, Any] | None,
    *,
    reference_datetime: datetime | None,
    include_timeline: bool,
) -> str:
    normalized_payload = _normalize_story_environment_weather_payload_from_grok(
        payload if isinstance(payload, dict) else None,
        reference_datetime=reference_datetime,
        include_timeline=include_timeline,
    )
    if not isinstance(normalized_payload, dict):
        return ""
    return json.dumps(
        normalized_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _story_weather_payload_is_suspiciously_generic(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return True
    summary = " ".join(str(payload.get("summary") or "").split()).strip().casefold()
    if not summary:
        return True
    generic_markers = (
        "\u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f \u043e\u0431\u043b\u0430\u0447\u043d\u043e\u0441\u0442\u044c",
        "\u043e\u0431\u043b\u0430\u0447\u043d\u043e",
        "\u043f\u0430\u0441\u043c\u0443\u0440\u043d\u043e",
    )
    timeline = payload.get("timeline")
    if not isinstance(timeline, list):
        return summary in generic_markers

    timeline_summaries = [
        " ".join(str(entry.get("summary") or "").split()).strip().casefold()
        for entry in timeline
        if isinstance(entry, dict)
    ]
    if len(timeline_summaries) != len(_STORY_ENVIRONMENT_TIMELINE_SLOTS):
        return True
    unique_summaries = {item for item in timeline_summaries if item}
    if len(unique_summaries) <= 1:
        return True

    generic_only = all(any(marker in item for marker in generic_markers) for item in unique_summaries)
    if generic_only:
        return True

    generic_entries = sum(
        1 for item in timeline_summaries if any(marker in item for marker in generic_markers)
    )
    return generic_entries >= len(_STORY_ENVIRONMENT_TIMELINE_SLOTS) - 1


def _extract_story_specific_scene_location_label(
    *,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    opening_scene_text: str,
    current_location_label: str,
) -> str:
    combined_text = "\n".join(
        part
        for part in (
            current_location_label,
            opening_scene_text,
            previous_assistant_text,
            latest_assistant_text,
            latest_user_prompt,
        )
        if str(part or "").strip()
    )
    normalized_text = combined_text.replace("\r\n", "\n")
    if not normalized_text.strip():
        return ""

    lowered = normalized_text.casefold()
    broader_location = ""
    if "\u0441\u0442\u043e\u043b\u0438\u0446" in lowered:
        broader_location = "\u0421\u0442\u043e\u043b\u0438\u0446\u0430"
    elif "\u0433\u043e\u0440\u043e\u0434" in lowered:
        broader_location = "\u0413\u043e\u0440\u043e\u0434"
    elif "\u0434\u0435\u0440\u0435\u0432\u043d" in lowered:
        broader_location = "\u0414\u0435\u0440\u0435\u0432\u043d\u044f"
    elif "\u043f\u043e\u0440\u0442" in lowered:
        broader_location = "\u041f\u043e\u0440\u0442"

    named_location_patterns: tuple[tuple[str, str], ...] = (
        ("\\b\u0442\u0430\u0432\u0435\u0440\u043d[\u0430-\u044f\u0451]*\\s+[\"']?([^\"'\\n,.;:]{1,60})", "\u0422\u0430\u0432\u0435\u0440\u043d\u0430"),
        ("\\b\u0442\u0440\u0430\u043a\u0442\u0438\u0440[\u0430-\u044f\u0451]*\\s+[\"']?([^\"'\\n,.;:]{1,60})", "\u0422\u0440\u0430\u043a\u0442\u0438\u0440"),
        ("\\b\u043f\u043e\u0441\u0442\u043e\u044f\u043b[\u0430-\u044f\u0451\\s]*\\s+[\"']?([^\"'\\n,.;:]{1,60})", "\u041f\u043e\u0441\u0442\u043e\u044f\u043b\u044b\u0439 \u0434\u0432\u043e\u0440"),
        ("\\b\u0433\u0438\u043b\u044c\u0434\u0438[\u044f\u0435\u0438\u043e\u0443\u044b]*\\s+[\"']?([^\"'\\n,.;:]{1,60})", "\u0413\u0438\u043b\u044c\u0434\u0438\u044f"),
    )

    venue_label = ""
    for pattern, prefix in named_location_patterns:
        match = re.search(pattern, normalized_text, flags=re.IGNORECASE)
        if match is None:
            continue
        raw_name = " ".join(str(match.group(1) or "").split()).strip(" .,:;!?-\"'")
        raw_name = re.split(
            "\\s+(?:\u0432|\u043d\u0430|\u0443|\u0432\u043e\u0437\u043b\u0435|\u043e\u043a\u043e\u043b\u043e|\u0433\u0434\u0435|\u043a\u043e\u0433\u0434\u0430|\u043f\u043e\u043a\u0430)\\b",
            raw_name,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" .,:;!?-\"'")
        if not raw_name:
            continue
        venue_label = f"{prefix} {raw_name}"
        break

    if not venue_label:
        generic_by_stem: tuple[tuple[str, str], ...] = (
            ("\u0442\u0430\u0432\u0435\u0440\u043d", "\u0422\u0430\u0432\u0435\u0440\u043d\u0430"),
            ("\u0442\u0440\u0430\u043a\u0442\u0438\u0440", "\u0422\u0440\u0430\u043a\u0442\u0438\u0440"),
            ("\u043f\u043e\u0441\u0442\u043e\u044f\u043b", "\u041f\u043e\u0441\u0442\u043e\u044f\u043b\u044b\u0439 \u0434\u0432\u043e\u0440"),
            ("\u0433\u0438\u043b\u044c\u0434\u0438", "\u0413\u0438\u043b\u044c\u0434\u0438\u044f"),
            ("\u043a\u043e\u043c\u043d\u0430\u0442", "\u041a\u043e\u043c\u043d\u0430\u0442\u0430"),
            ("\u0437\u0430\u043b", "\u0417\u0430\u043b"),
            ("\u0445\u0440\u0430\u043c", "\u0425\u0440\u0430\u043c"),
        )
        for stem, label in generic_by_stem:
            if stem in lowered:
                venue_label = label
                break

    resolved_label = venue_label or broader_location
    if (
        resolved_label
        and broader_location
        and venue_label
        and not venue_label.casefold().startswith(broader_location.casefold())
    ):
        resolved_label = f"{broader_location}, {venue_label}"
    return _normalize_story_environment_location_label(resolved_label)


def _story_location_label_is_too_broad(label: str, *, combined_text: str) -> bool:
    normalized_label = _normalize_story_environment_location_label(label).casefold()
    if not normalized_label:
        return True
    broad_labels = {
        "\u0443\u043b\u0438\u0446\u0430",
        "\u0441\u0442\u043e\u043b\u0438\u0446\u0430, \u0443\u043b\u0438\u0446\u0430",
        "\u0433\u043e\u0440\u043e\u0434, \u0443\u043b\u0438\u0446\u0430",
    }
    if normalized_label in broad_labels:
        return True
    combined_lower = combined_text.casefold()
    interior_mentioned = any(keyword in combined_lower for keyword in _STORY_INTERIOR_LOCATION_KEYWORDS)
    if interior_mentioned and (
        "\u0443\u043b\u0438\u0446" in normalized_label
        or normalized_label in {"\u0441\u0442\u043e\u043b\u0438\u0446\u0430", "\u0433\u043e\u0440\u043e\u0434", "\u0434\u0435\u0440\u0435\u0432\u043d\u044f", "\u043f\u043e\u0440\u0442"}
    ):
        return True
    return False


def _request_story_grok_environment_postprocess_payload(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
    include_location: bool,
    include_weather: bool,
    force_weather_refresh: bool = False,
) -> dict[str, Any] | None:
    if not include_location and not include_weather:
        return None
    if not settings.openrouter_api_key or not settings.openrouter_chat_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenRouter is not configured for story environment generation",
        )

    current_datetime = deserialize_story_environment_datetime(
        str(getattr(game, "environment_current_datetime", "") or "")
    )
    if current_datetime is None:
        current_datetime = _utcnow()
    current_datetime_iso = serialize_story_environment_datetime(current_datetime)
    existing_current_weather = deserialize_story_environment_weather(
        str(getattr(game, "environment_current_weather", "") or "")
    )
    existing_tomorrow_weather = deserialize_story_environment_weather(
        str(getattr(game, "environment_tomorrow_weather", "") or "")
    )
    existing_current_signature = _story_weather_payload_signature(
        existing_current_weather if isinstance(existing_current_weather, dict) else None,
        reference_datetime=current_datetime,
        include_timeline=True,
    )
    existing_tomorrow_signature = _story_weather_payload_signature(
        existing_tomorrow_weather if isinstance(existing_tomorrow_weather, dict) else None,
        reference_datetime=current_datetime + timedelta(days=1),
        include_timeline=False,
    )
    current_location_label = _normalize_story_environment_location_label(
        str(getattr(game, "current_location_label", "") or "")
    )
    opening_scene_text = str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()
    combined_text = "\n\n".join(
        part
        for part in (
            current_location_label,
            opening_scene_text,
            previous_assistant_text,
            latest_assistant_text,
            latest_user_prompt,
        )
        if str(part or "").strip()
    )

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    system_prompt = (
        "You analyze a Russian fantasy RPG scene and return strict JSON only without markdown. "
        "All human-readable values must be in Russian. "
        "Return object keys only from this schema: "
        "{\"current_location_label\":\"...\",\"current_weather\":{\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\","
        "\"timeline\":[{\"start_time\":\"00:00\",\"end_time\":\"06:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"06:00\",\"end_time\":\"12:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"12:00\",\"end_time\":\"18:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},"
        "{\"start_time\":\"18:00\",\"end_time\":\"00:00\",\"summary\":\"...\",\"temperature_c\":12,"
        "\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"}]},"
        "\"tomorrow_weather\":{\"summary\":\"...\",\"temperature_c\":14,\"fog\":\"...\",\"humidity\":\"...\","
        "\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\"}}. "
        "Infer the most specific stable current location. Prefer indoor named venues over broad geography. "
        "If the scene is inside a tavern, inn, room, guild hall, temple, or another interior, "
        "current_location_label must include that place and must not collapse to a street. "
        "Example of good specificity: \"Столица, таверна Ржавый якорь\". "
        "For weather, base the forecast on month and season, keep it realistic, and make today internally consistent. "
        "current_weather.timeline must contain exactly four periods in this order: 00:00-06:00, 06:00-12:00, 12:00-18:00, 18:00-00:00. "
        "The active current_weather summary/details must match the period containing the supplied current time. "
        "Do not use the same weather summary for all periods unless extreme weather is explicitly described by the scene. "
        "Avoid lazy placeholder outputs like endless 'Переменная облачность'."
    )
    if force_weather_refresh and include_weather:
        system_prompt += (
            " This is a manual weather regenerate request. "
            "Return a new forecast for today and tomorrow that differs from the existing saved forecast, "
            "especially for today's active period and timeline."
        )

    user_prompt = (
        f"Current in-game datetime:\n{current_datetime_iso}\n\n"
        f"Current saved location:\n{current_location_label or 'none'}\n\n"
        f"Saved weather for today:\n{json.dumps(existing_current_weather, ensure_ascii=False) if isinstance(existing_current_weather, dict) else 'none'}\n\n"
        f"Saved weather for tomorrow:\n{json.dumps(existing_tomorrow_weather, ensure_ascii=False) if isinstance(existing_tomorrow_weather, dict) else 'none'}\n\n"
        f"Opening scene:\n{opening_scene_text or 'none'}\n\n"
        f"Latest player move:\n{latest_user_prompt or 'none'}\n\n"
        f"Previous narrator reply:\n{previous_assistant_text or 'none'}\n\n"
        f"Latest narrator reply:\n{latest_assistant_text or 'none'}\n\n"
        f"Need location: {'yes' if include_location else 'no'}.\n"
        f"Need weather: {'yes' if include_weather else 'no'}.\n"
        "Return JSON only."
    )

    retry_note = ""
    total_attempts = 3 if force_weather_refresh and include_weather else 2
    for _ in range(total_attempts):
        request_messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": user_prompt + (f"\n\nFix previous answer:\n{retry_note}" if retry_note else ""),
            },
        ]
        payload = {
            "model": _STORY_ENVIRONMENT_GROK_MODEL,
            "messages": request_messages,
            "temperature": 1.05 if force_weather_refresh and include_weather else 0.95,
            "max_tokens": 1_000,
        }
        try:
            response = requests.post(
                settings.openrouter_chat_url,
                headers=headers,
                json=payload,
                timeout=(12, 70),
            )
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"OpenRouter request failed: {exc}",
            ) from exc
        if response.status_code >= 400:
            detail = _extract_story_openrouter_error_detail(response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=detail[:500] or f"OpenRouter chat error ({response.status_code})",
            )

        try:
            response_payload = response.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="OpenRouter returned invalid JSON",
            ) from exc

        raw_content = ""
        choices = response_payload.get("choices")
        if isinstance(choices, list) and choices:
            first_choice = choices[0] if isinstance(choices[0], dict) else {}
            message_payload = first_choice.get("message")
            if isinstance(message_payload, dict):
                raw_content = str(message_payload.get("content") or "")
        parsed_payload = _extract_story_json_object(raw_content)
        if not isinstance(parsed_payload, dict):
            retry_note = (
                "Response was not valid JSON. Return exactly one valid JSON object with no markdown and no extra text."
            )
            continue

        resolved_location_label = ""
        if include_location:
            resolved_location_label = _normalize_story_environment_location_label(
                str(parsed_payload.get("current_location_label") or parsed_payload.get("location_label") or "")
            )
            scene_location_label = _extract_story_specific_scene_location_label(
                latest_user_prompt=latest_user_prompt,
                previous_assistant_text=previous_assistant_text,
                latest_assistant_text=latest_assistant_text,
                opening_scene_text=opening_scene_text,
                current_location_label=current_location_label,
            )
            if scene_location_label and (
                not resolved_location_label
                or _story_location_label_is_too_broad(resolved_location_label, combined_text=combined_text)
            ):
                resolved_location_label = scene_location_label
            if resolved_location_label and "," not in resolved_location_label:
                current_location_prefix = _normalize_story_environment_location_label(
                    str(current_location_label or "").split(",", maxsplit=1)[0]
                )
                if current_location_prefix in {"\u0421\u0442\u043e\u043b\u0438\u0446\u0430", "\u0413\u043e\u0440\u043e\u0434", "\u0414\u0435\u0440\u0435\u0432\u043d\u044f", "\u041f\u043e\u0440\u0442"}:
                    resolved_location_label = f"{current_location_prefix}, {resolved_location_label}"
            if not resolved_location_label and current_location_label:
                resolved_location_label = current_location_label

        next_current_weather = None
        next_tomorrow_weather = None
        generated_current_signature = ""
        generated_tomorrow_signature = ""
        if include_weather:
            next_current_weather = _normalize_story_environment_weather_payload_from_grok(
                parsed_payload.get("current_weather")
                if isinstance(parsed_payload.get("current_weather"), dict)
                else None,
                reference_datetime=current_datetime,
                include_timeline=True,
            )
            next_tomorrow_weather = _normalize_story_environment_weather_payload_from_grok(
                parsed_payload.get("tomorrow_weather")
                if isinstance(parsed_payload.get("tomorrow_weather"), dict)
                else None,
                reference_datetime=current_datetime + timedelta(days=1),
                include_timeline=False,
            )
            generated_current_signature = _story_weather_payload_signature(
                next_current_weather if isinstance(next_current_weather, dict) else None,
                reference_datetime=current_datetime,
                include_timeline=True,
            )
            generated_tomorrow_signature = _story_weather_payload_signature(
                next_tomorrow_weather if isinstance(next_tomorrow_weather, dict) else None,
                reference_datetime=current_datetime + timedelta(days=1),
                include_timeline=False,
            )

        location_invalid = include_location and not resolved_location_label
        weather_invalid = include_weather and (
            not isinstance(next_current_weather, dict)
            or not isinstance(next_tomorrow_weather, dict)
            or _story_weather_payload_is_suspiciously_generic(next_current_weather)
        )
        weather_unchanged = (
            include_weather
            and force_weather_refresh
            and bool(existing_current_signature)
            and bool(generated_current_signature)
            and generated_current_signature == existing_current_signature
        )
        if not weather_unchanged and include_weather and force_weather_refresh:
            if (
                not existing_current_signature
                and bool(existing_tomorrow_signature)
                and bool(generated_tomorrow_signature)
                and generated_tomorrow_signature == existing_tomorrow_signature
            ):
                weather_unchanged = True
        if weather_unchanged:
            weather_invalid = True

        if not location_invalid and not weather_invalid:
            normalized_payload: dict[str, Any] = {}
            if include_location:
                normalized_payload["location"] = {
                    "action": "update",
                    "label": resolved_location_label,
                    "content": f"\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442: {resolved_location_label}.",
                }
            if include_weather:
                normalized_payload["environment"] = {
                    "action": "update",
                    "current_datetime": current_datetime_iso,
                    "current_weather": next_current_weather,
                    "tomorrow_weather": next_tomorrow_weather,
                }
            return normalized_payload or None

        retry_messages: list[str] = []
        if location_invalid:
            retry_messages.append(
                "Location is empty or too broad. Return the most specific current scene location. "
                "If the scene is inside a tavern or room, do not collapse it to a street."
            )
        if weather_invalid:
            retry_messages.append(
                "Weather is invalid or too generic. Provide four distinct realistic periods for today and align current summary to the active period."
            )
        if weather_unchanged:
            retry_messages.append(
                "Manual regenerate requires a changed forecast. Today's forecast must differ from the saved one."
            )
        retry_note = " ".join(retry_messages) or "Fix JSON by schema."

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Failed to obtain a valid Grok environment payload",
    )


def _build_story_grok_environment_postprocess_payload(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    previous_assistant_text: str,
    include_location: bool,
    include_weather: bool,
    force_weather_refresh: bool = False,
) -> dict[str, Any] | None:
    return _request_story_grok_environment_postprocess_payload(
        game=game,
        latest_user_prompt=latest_user_prompt,
        previous_assistant_text=previous_assistant_text,
        latest_assistant_text=latest_assistant_text,
        include_location=include_location,
        include_weather=include_weather,
        force_weather_refresh=force_weather_refresh,
    )


@router.patch("/api/story/games/{game_id}/meta", response_model=StoryGameSummaryOut)
def update_story_game_meta(
    game_id: int,
    payload: StoryGameMetaUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    previous_publication_status = str(getattr(game, "publication_status", "") or "").strip().lower()
    requested_visibility: str | None = None
    should_notify_publication_queue = False
    if payload.title is not None:
        normalized_title = payload.title.strip()
        game.title = normalized_title or STORY_DEFAULT_TITLE
    if payload.description is not None:
        game.description = normalize_story_game_description(payload.description)
    if payload.opening_scene is not None:
        game.opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    if payload.visibility is not None:
        requested_visibility = normalize_story_game_visibility(payload.visibility)
    if payload.age_rating is not None:
        game.age_rating = normalize_story_game_age_rating(payload.age_rating)
    if payload.genres is not None:
        game.genres = serialize_story_game_genres(normalize_story_game_genres(payload.genres))
    if payload.cover_image_url is not None:
        game.cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    if payload.cover_scale is not None:
        game.cover_scale = normalize_story_cover_scale(payload.cover_scale)
    if payload.cover_position_x is not None:
        game.cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    if payload.cover_position_y is not None:
        game.cover_position_y = normalize_story_cover_position(payload.cover_position_y)
    if requested_visibility is not None:
        if requested_visibility == STORY_GAME_VISIBILITY_PUBLIC and game.source_world_id is None:
            mark_story_publication_pending(game)
            game.visibility = STORY_GAME_VISIBILITY_PRIVATE
            should_notify_publication_queue = previous_publication_status != "pending"
        else:
            if requested_visibility == STORY_GAME_VISIBILITY_PRIVATE and game.source_world_id is None:
                clear_story_publication_state(game)
                publication_copy = _get_story_game_publication_copy(db, source_game_id=int(game.id))
                if publication_copy is not None:
                    _delete_story_game_with_relations(db, game_id=int(publication_copy.id))
            game.visibility = requested_visibility
    if (str(game.visibility or "").strip().lower() == STORY_GAME_VISIBILITY_PUBLIC):
        main_hero_card_ids = db.scalars(
            select(StoryWorldCard.id).where(
                StoryWorldCard.game_id == game.id,
                StoryWorldCard.kind == STORY_WORLD_CARD_KIND_MAIN_HERO,
            )
        ).all()
        if main_hero_card_ids:
            db.execute(
                sa_update(StoryWorldCardChangeEvent)
                .where(StoryWorldCardChangeEvent.world_card_id.in_(main_hero_card_ids))
                .values(world_card_id=None)
            )
        db.execute(
            sa_delete(StoryWorldCard).where(
                StoryWorldCard.game_id == game.id,
                StoryWorldCard.kind == STORY_WORLD_CARD_KIND_MAIN_HERO,
            )
        )
        refresh_story_game_public_card_snapshots(db, game)

    touch_story_game(game)
    db.commit()
    db.refresh(game)
    if should_notify_publication_queue:
        game_title = str(game.title or "").strip() or f"Мир #{int(game.id)}"
        author_name = story_author_name(user)
        _notify_story_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Мир отправлен на модерацию",
            body=f"{author_name} отправил на модерацию мир \"{game_title}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return _story_game_summary_response(db, game)


@router.delete("/api/story/games/{game_id}", response_model=MessageResponse)
def delete_story_game(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    _delete_story_game_with_relations(db, game_id=game.id)
    db.commit()
    return MessageResponse(message="Game deleted")

