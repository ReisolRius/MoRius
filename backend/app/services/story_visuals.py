from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import re
from binascii import Error as BinasciiError
from datetime import datetime, timezone
from threading import Lock, Thread
from typing import Any

import requests
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import main as monolith_main
from app.database import SessionLocal
from app.models import StoryCharacterEmotionGenerationJob, StoryMessage, StoryTurnImage, User
from app.schemas import (
    StoryCharacterAvatarGenerateOut,
    StoryCharacterAvatarGenerateRequest,
    StoryCharacterEmotionGenerateJobOut,
    StoryCharacterEmotionGenerateOut,
    StoryCharacterEmotionGenerateRequest,
    StorySpriteCutoutOut,
    StorySpriteCutoutRequest,
    StoryTurnImageGenerateOut,
    StoryTurnImageGenerateRequest,
    UserOut,
)
from app.services.story_emotions import (
    STORY_CHARACTER_EMOTION_IDS as _STORY_CHARACTER_EMOTION_IDS,
    normalize_story_character_emotion_id as _normalize_story_character_emotion_id,
    normalize_story_scene_emotion_payload as _normalize_story_scene_emotion_payload,
    serialize_story_scene_emotion_payload as _serialize_story_scene_emotion_payload,
)
from app.services.text_encoding import repair_likely_utf8_mojibake_deep, sanitize_likely_utf8_mojibake

settings = monolith_main.settings
logger = monolith_main.logger
HTTP_SESSION = monolith_main.HTTP_SESSION

STORY_USER_ROLE = monolith_main.STORY_USER_ROLE
STORY_ASSISTANT_ROLE = monolith_main.STORY_ASSISTANT_ROLE
STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS = monolith_main.STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS
STORY_POSTPROCESS_READ_TIMEOUT_SECONDS = monolith_main.STORY_POSTPROCESS_READ_TIMEOUT_SECONDS
STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARDS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARDS
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_TITLE_CHARS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_TITLE_CHARS
STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_CONTENT_CHARS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_WORLD_CARD_CONTENT_CHARS
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_CHARS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_CHARS
STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS = monolith_main.STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_LOCK_FRAGMENTS
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS = monolith_main.STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_MAX_TOKENS
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_SCOPE = monolith_main.STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_SCOPE
STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_REQUIRED = monolith_main.STORY_TURN_IMAGE_CHARACTER_CARD_LOCK_REQUIRED
STORY_TURN_IMAGE_STYLE_PROMPT_MAX_CHARS = monolith_main.STORY_TURN_IMAGE_STYLE_PROMPT_MAX_CHARS
STORY_TURN_IMAGE_GENDER_PATTERNS_FEMALE = monolith_main.STORY_TURN_IMAGE_GENDER_PATTERNS_FEMALE
STORY_TURN_IMAGE_GENDER_PATTERNS_MALE = monolith_main.STORY_TURN_IMAGE_GENDER_PATTERNS_MALE
STORY_TURN_IMAGE_MODEL_FLUX = monolith_main.STORY_TURN_IMAGE_MODEL_FLUX
STORY_TURN_IMAGE_MODEL_SEEDREAM = monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM
STORY_TURN_IMAGE_MODEL_GROK = monolith_main.STORY_TURN_IMAGE_MODEL_GROK
STORY_TURN_IMAGE_MODEL_GROK_LEGACY = monolith_main.STORY_TURN_IMAGE_MODEL_GROK_LEGACY
STORY_TURN_IMAGE_COST_BY_MODEL = monolith_main.STORY_TURN_IMAGE_COST_BY_MODEL
STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED = monolith_main.STORY_CHARACTER_EMOTION_JOB_STATUS_QUEUED
STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING = monolith_main.STORY_CHARACTER_EMOTION_JOB_STATUS_RUNNING
STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED = monolith_main.STORY_CHARACTER_EMOTION_JOB_STATUS_COMPLETED
STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED = monolith_main.STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
STORY_CHARACTER_EMOTION_REFERENCE_MAX_CHARS = monolith_main.STORY_CHARACTER_EMOTION_REFERENCE_MAX_CHARS
STORY_CHARACTER_EMOTION_EDIT_STYLE_MAX_CHARS = monolith_main.STORY_CHARACTER_EMOTION_EDIT_STYLE_MAX_CHARS
STORY_CHARACTER_EMOTION_JOB_ERROR_MAX_LENGTH = monolith_main.STORY_CHARACTER_EMOTION_JOB_ERROR_MAX_LENGTH
STORY_SCENE_EMOTION_ANALYSIS_MODEL = monolith_main.STORY_SCENE_EMOTION_ANALYSIS_MODEL
STORY_SCENE_EMOTION_ANALYSIS_REQUEST_MAX_TOKENS = monolith_main.STORY_SCENE_EMOTION_ANALYSIS_REQUEST_MAX_TOKENS
STORY_SCENE_EMOTION_MAIN_HERO_ALIASES = monolith_main.STORY_SCENE_EMOTION_MAIN_HERO_ALIASES
STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS = monolith_main.STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT = monolith_main.STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL = monolith_main.STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT = monolith_main.STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM = monolith_main.STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM
STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS = monolith_main.STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS
STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS = monolith_main.STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS
STORY_WORLD_CARD_KIND_NPC = monolith_main.STORY_WORLD_CARD_KIND_NPC
STORY_WORLD_CARD_KIND_MAIN_HERO = monolith_main.STORY_WORLD_CARD_KIND_MAIN_HERO

_get_current_user = monolith_main._get_current_user
_get_user_story_game_or_404 = monolith_main._get_user_story_game_or_404
_coerce_story_image_model = monolith_main._coerce_story_image_model
_spend_user_tokens_if_sufficient = monolith_main._spend_user_tokens_if_sufficient
_add_user_tokens = monolith_main._add_user_tokens
_estimate_story_tokens = monolith_main._estimate_story_tokens
_split_story_text_into_sentences = monolith_main._split_story_text_into_sentences
_normalize_story_world_card_kind = monolith_main._normalize_story_world_card_kind
_infer_story_npc_gender_from_context = monolith_main._infer_story_npc_gender_from_context
_extract_story_npc_profile_field = monolith_main._extract_story_npc_profile_field
_sanitize_story_npc_profile_value = monolith_main._sanitize_story_npc_profile_value
_is_story_dialogue_like_fragment = monolith_main._is_story_dialogue_like_fragment
_normalize_story_markup_to_plain_text = monolith_main._normalize_story_markup_to_plain_text
_build_openrouter_image_provider_payload = monolith_main._build_openrouter_image_provider_payload
_normalize_story_prompt_text = monolith_main._normalize_story_prompt_text
_prepare_story_messages_for_model = monolith_main._prepare_story_messages_for_model
_extract_text_from_model_content = monolith_main._extract_text_from_model_content
_extract_json_object_from_text = monolith_main._extract_json_object_from_text
_split_story_inline_markup_paragraphs = monolith_main._split_story_inline_markup_paragraphs
_merge_story_orphan_markup_paragraphs = monolith_main._merge_story_orphan_markup_paragraphs
_parse_story_markup_paragraph = monolith_main._parse_story_markup_paragraph
_coerce_story_markup_paragraph = monolith_main._coerce_story_markup_paragraph
_list_story_world_cards = monolith_main._list_story_world_cards
_list_story_messages = monolith_main._list_story_messages
_select_story_world_cards_for_prompt = monolith_main._select_story_world_cards_for_prompt
_select_story_world_cards_triggered_by_text = monolith_main._select_story_world_cards_triggered_by_text
_utcnow = monolith_main._utcnow
_normalize_avatar_value = monolith_main._normalize_avatar_value
_validate_avatar_url = monolith_main._validate_avatar_url

STORY_SPRITE_REMOVAL_SESSION_LOCK = Lock()
STORY_SPRITE_REMOVAL_SESSION: Any = None
STORY_SPRITE_REMOVAL_CACHE_LOCK = Lock()
STORY_SPRITE_REMOVAL_CACHE: dict[str, str] = {}
STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS = int(
    getattr(monolith_main, "STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS", 96) or 96
)


def _normalize_story_message_content(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _request_story_scene_emotion_payload(
    *,
    latest_user_prompt: str | None,
    latest_assistant_text: str | None,
    world_cards: list[dict[str, Any]],
) -> str | None:
    if not settings.openrouter_api_key or not settings.openrouter_chat_url:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_not_configured",
                "participants": [],
            }
        )

    normalized_user_prompt = _normalize_story_message_content(latest_user_prompt)
    normalized_assistant_text = _normalize_story_message_content(latest_assistant_text)
    if not normalized_assistant_text:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "empty_assistant_text",
                "participants": [],
                "blocks": [],
            }
        )

    scene_blocks = _extract_story_scene_emotion_blocks(normalized_assistant_text)
    if not scene_blocks:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "empty_scene_blocks",
                "participants": [],
                "blocks": [],
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
        scene_blocks=scene_blocks,
    )
    tool_definition = _build_story_scene_emotion_tool_definition(active_cast_entries, scene_blocks)
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
        "tools": [tool_definition],
        "tool_choice": {
            "type": "function",
            "function": {
                "name": "report_scene_emotions",
            },
        },
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
                "blocks": [],
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
                "blocks": [],
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
                "blocks": [],
            }
        )

    if not isinstance(payload_value, dict):
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_invalid_json_root",
                "participants": [],
                "blocks": [],
            }
        )
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return _serialize_story_scene_emotion_payload(
            {
                "show_visualization": False,
                "reason": "model_empty_choices",
                "participants": [],
                "blocks": [],
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
                "blocks": [],
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
                    "blocks": [],
                }
            )

    normalized_payload = _normalize_story_scene_emotion_payload(parsed_payload)
    normalized_payload = _canonicalize_story_scene_emotion_payload(
        normalized_payload,
        world_cards=world_cards,
    )
    if isinstance(normalized_payload, dict):
        normalized_blocks = normalized_payload.get("blocks")
        if normalized_payload.get("show_visualization") and isinstance(normalized_blocks, list):
            expected_block_indices = {int(block.get("block_index") or 0) for block in scene_blocks}
            received_block_indices = {
                int(block.get("block_index") or 0)
                for block in normalized_blocks
                if isinstance(block, dict)
            }
            if expected_block_indices != received_block_indices:
                return _serialize_story_scene_emotion_payload(
                    {
                        "show_visualization": False,
                        "reason": "model_incomplete_blocks",
                        "participants": [],
                        "blocks": [],
                    }
                )
        return _serialize_story_scene_emotion_payload(normalized_payload)

    return _serialize_story_scene_emotion_payload(
        {
            "show_visualization": False,
            "reason": "model_empty_payload",
            "participants": [],
            "blocks": [],
        }
    )
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
    normalized_prompt = sanitize_likely_utf8_mojibake(
        str(prompt or "").replace("\x00", "").replace("\r\n", "\n")
    ).strip()
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


def _sanitize_story_turn_image_source_text(value: str | None) -> str:
    return sanitize_likely_utf8_mojibake(
        str(value or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    ).strip()


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
        f"STYLE LOCK (ABSOLUTE PRIORITY): {normalized_style}.",
        "This style instruction overrides any default renderer bias or fallback aesthetic.",
        "Treat the style as mandatory for linework, rendering language, proportions, and overall visual identity.",
        "Do not weaken, reinterpret, or partially apply the requested style.",
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
    sanitized_user_prompt = _sanitize_story_turn_image_source_text(user_prompt)
    sanitized_assistant_text = _sanitize_story_turn_image_source_text(assistant_text)
    sanitized_image_style_prompt = _sanitize_story_turn_image_source_text(image_style_prompt)
    sanitized_world_cards = repair_likely_utf8_mojibake_deep(world_cards)
    effective_character_world_cards = repair_likely_utf8_mojibake_deep(
        character_world_cards if character_world_cards is not None else world_cards
    )
    repaired_full_character_card_locks = repair_likely_utf8_mojibake_deep(full_character_card_locks)
    normalized_user_prompt = re.sub(
        r"\s+",
        " ",
        _normalize_story_markup_to_plain_text(sanitized_user_prompt).replace("\r\n", "\n"),
    ).strip()
    normalized_assistant_text = re.sub(
        r"\s+",
        " ",
        _normalize_story_markup_to_plain_text(sanitized_assistant_text).replace("\r\n", "\n"),
    ).strip()
    normalized_image_style_prompt = _normalize_story_turn_image_style_prompt(sanitized_image_style_prompt)

    world_context_items: list[str] = []
    for card in sanitized_world_cards:
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
        user_prompt=sanitized_user_prompt,
        assistant_text=sanitized_assistant_text,
        world_cards=effective_character_world_cards,
        max_cards=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_HINTS,
    )
    if repaired_full_character_card_locks is None:
        repaired_full_character_card_locks = _build_story_turn_image_full_character_card_locks(
            user_prompt=sanitized_user_prompt,
            assistant_text=sanitized_assistant_text,
            world_cards=effective_character_world_cards,
        )
    has_main_hero_line = any(line.startswith("main_hero:") for line in character_lines)
    has_gender_lock_line = any("gender-lock" in line for line in character_lines)
    has_appearance_lock_line = any("appearance-lock" in line for line in character_lines)
    style_instructions = _build_story_turn_image_style_instructions(normalized_image_style_prompt)
    scene_focus_text = _build_story_turn_image_latest_scene_focus_text(
        sanitized_assistant_text,
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    prefer_scene_focus_context = model_name in {STORY_TURN_IMAGE_MODEL_FLUX, STORY_TURN_IMAGE_MODEL_SEEDREAM}
    assistant_context_text = scene_focus_text if prefer_scene_focus_context and scene_focus_text else normalized_assistant_text
    if not assistant_context_text and scene_focus_text:
        assistant_context_text = scene_focus_text

    prompt_parts = [
        "Single cinematic frame from one interactive RPG scene.",
        "Keep one coherent location and one coherent moment.",
    ]
    if style_instructions:
        prompt_parts.append(style_instructions)

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
        if not repaired_full_character_card_locks:
            return appended_locks
        _append_part_if_fit("CHARACTER_CARD_LOCKS (FULL, STRICT, MANDATORY):")
        for card_lock in repaired_full_character_card_locks:
            if _append_part_if_fit(card_lock):
                appended_locks.append(card_lock)
        return appended_locks

    effective_full_character_card_locks = _append_full_character_locks()
    if repaired_full_character_card_locks and not effective_full_character_card_locks:
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
        part_prefix="Scene now: ",
        part_body=scene_focus_text,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Latest AI response: ",
        part_body=assistant_context_text if assistant_context_text != scene_focus_text else "",
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    _try_append_optional_line(
        "No text, UI, watermark, logo, captions, speech bubbles, signs, letters, words, or numbers."
    )
    _try_append_optional_line(
        "Do not invent unrelated people, symbols, dream imagery, flashbacks, parallel scenes, or extra locations."
    )
    if has_full_character_card_lock:
        _try_append_optional_line(
            "CHARACTER_CARD_LOCK priority is absolute: "
            "CHARACTER_CARD_LOCK > appearance-lock > scene state."
        )
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
        "Full-body sprite framing: show the entire character from head to feet.",
        "Do not crop at the waist, hips, knees, or shins. Boots, shoes, and the full silhouette must be visible.",
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
        "Keep the camera framing in full-body visual-novel sprite range: head to feet, with the whole silhouette visible inside frame.",
        "Do not zoom into a portrait crop. The sprite must include legs and feet, not stop at the waist or knees.",
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
        "Use emotion-appropriate whole-body posing, for example crossed arms and grounded stance for anger or strictness, recoiling posture for fear, open posture for joy, wary footing for alertness, bashful hand-to-face gestures for embarrassment, or reflective hand/chin posing for thoughtful scenes when suitable.",
        "Allow strong emotion-appropriate body language and a genuinely different full-body pose when it helps readability.",
        "Keep the same character identity, outfit, and art style, but do not freeze the sprite into the exact same pose.",
        "Frame the sprite from head to feet with the entire body visible.",
        "Do not return a face portrait, chest crop, or waist crop. Legs and feet must stay inside frame.",
        "Use a plain pure white or near-white flat studio background with no scenery so post-processing can extract a clean transparent PNG sprite.",
        "No props, no scenery, no extra people, no text, no watermark, no frame.",
    ]
    return "\n".join(line for line in prompt_lines if line).strip()


def _normalize_story_scene_emotion_lookup_value(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("ё", "е")
    normalized = re.sub(r"[^0-9a-z\u0400-\u04FF\s-]+", " ", normalized)
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

    main_hero_entry = next((entry for entry in cast_entries if entry.get("is_main_hero")), None)
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

    raw_blocks = payload.get("blocks")
    blocks = raw_blocks if isinstance(raw_blocks, list) else []
    resolved_blocks: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue

        normalized_block: dict[str, Any] = {
            "block_index": int(block.get("block_index", 0)),
            "hero_emotion": str(block.get("hero_emotion") or "").strip(),
            "npc_name": "",
            "npc_emotion": "",
        }
        raw_block_kind = str(block.get("block_kind") or "").strip().lower()
        if raw_block_kind in {"narrative", "speech", "thought"}:
            normalized_block["block_kind"] = raw_block_kind

        raw_npc_name = str(block.get("npc_name") or "").strip()
        if raw_npc_name:
            matched_entry = _match_story_scene_emotion_cast_entry(raw_npc_name, cast_entries)
            if matched_entry is not None and not matched_entry.get("is_main_hero"):
                normalized_block["npc_name"] = str(matched_entry.get("display_name") or "").strip()
                normalized_block["npc_emotion"] = str(block.get("npc_emotion") or "").strip()
            elif main_hero_entry is None or raw_npc_name.casefold() != str(main_hero_entry.get("display_name") or "").casefold():
                normalized_block["npc_name"] = raw_npc_name
                normalized_block["npc_emotion"] = str(block.get("npc_emotion") or "").strip()

        resolved_blocks.append(normalized_block)

    if not resolved_participants and resolved_blocks and main_hero_entry is not None:
        latest_block = resolved_blocks[-1]
        hero_name = str(main_hero_entry.get("display_name") or "").strip()
        hero_emotion = str(latest_block.get("hero_emotion") or "").strip()
        if hero_name and hero_emotion:
            resolved_participants.append(
                {
                    "name": hero_name,
                    "emotion": hero_emotion,
                    "importance": "primary",
                }
            )
        latest_npc_name = str(latest_block.get("npc_name") or "").strip()
        latest_npc_emotion = str(latest_block.get("npc_emotion") or "").strip()
        if latest_npc_name and latest_npc_emotion:
            resolved_participants.append(
                {
                    "name": latest_npc_name,
                    "emotion": latest_npc_emotion,
                    "importance": "secondary",
                }
            )

    normalized_payload = {
        "show_visualization": bool(payload.get("show_visualization"))
        and (len(resolved_participants) > 0 or len(resolved_blocks) > 0),
        "reason": str(payload.get("reason") or "").strip() or "interaction",
        "participants": resolved_participants,
        "blocks": resolved_blocks,
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


def _extract_story_scene_emotion_blocks(text_value: str) -> list[dict[str, str]]:
    normalized_text = _split_story_inline_markup_paragraphs(_merge_story_orphan_markup_paragraphs(text_value))
    if not normalized_text:
        return []

    blocks: list[dict[str, str]] = []
    for paragraph in re.split(r"\n{2,}", normalized_text):
        paragraph_value = paragraph.strip()
        if not paragraph_value:
            continue

        parsed = _parse_story_markup_paragraph(paragraph_value)
        if parsed is None:
            coerced_paragraph = _coerce_story_markup_paragraph(paragraph_value)
            parsed = _parse_story_markup_paragraph(coerced_paragraph) if coerced_paragraph is not None else None

        if parsed is None:
            block_text = " ".join(paragraph_value.replace("\r", " ").replace("\n", " ").split()).strip()
            if not block_text:
                continue
            blocks.append(
                {
                    "block_index": str(len(blocks)),
                    "block_kind": "narrative",
                    "speaker_name": "",
                    "text": block_text[:320].rstrip(),
                }
            )
        else:
            block_kind = str(parsed.get("kind") or "").strip().lower()
            serialized_block_kind = "narrative" if block_kind == "narration" else ("thought" if block_kind == "thought" else "speech")
            block_text = " ".join(str(parsed.get("text") or "").replace("\r", " ").replace("\n", " ").split()).strip()
            if not block_text:
                continue
            blocks.append(
                {
                    "block_index": str(len(blocks)),
                    "block_kind": serialized_block_kind,
                    "speaker_name": str(parsed.get("speaker") or "").strip(),
                    "text": block_text[:320].rstrip(),
                }
            )

        if len(blocks) >= 24:
            break

    return blocks


def _build_story_scene_emotion_tool_definition(
    active_cast_entries: list[dict[str, Any]],
    scene_blocks: list[dict[str, str]],
) -> dict[str, Any]:
    active_npc_names = [
        str(entry.get("display_name") or "").strip()
        for entry in active_cast_entries
        if str(entry.get("display_name") or "").strip() and not bool(entry.get("is_main_hero"))
    ]
    block_indices = [int(block.get("block_index") or 0) for block in scene_blocks]

    return {
        "type": "function",
        "function": {
            "name": "report_scene_emotions",
            "description": "Build a per-block visual-novel emotion timeline for the current narrator response.",
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
                    "blocks": {
                        "type": "array",
                        "minItems": 0,
                        "maxItems": len(block_indices),
                        "items": {
                            "type": "object",
                            "properties": {
                                "block_index": {
                                    "type": "integer",
                                    "enum": block_indices,
                                },
                                "block_kind": {
                                    "type": "string",
                                    "enum": ["narrative", "speech", "thought"],
                                },
                                "hero_emotion": {
                                    "type": "string",
                                    "enum": list(_STORY_CHARACTER_EMOTION_IDS),
                                },
                                "npc_name": {
                                    "type": "string",
                                    "enum": ["", *active_npc_names],
                                },
                                "npc_emotion": {
                                    "type": "string",
                                    "enum": ["", *list(_STORY_CHARACTER_EMOTION_IDS)],
                                },
                            },
                            "required": ["block_index", "block_kind", "hero_emotion", "npc_name", "npc_emotion"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["show_visualization", "reason", "blocks"],
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
    scene_blocks: list[dict[str, str]],
) -> list[dict[str, str]]:
    character_lines: list[str] = []
    emotion_lines = [
        f"- {emotion_id}: {_resolve_story_character_emotion_descriptor(emotion_id)}"
        for emotion_id in _STORY_CHARACTER_EMOTION_IDS
    ]
    block_lines = [
        f'{block.get("block_index", "0")}. [{block.get("block_kind", "narrative")}] '
        + (f'{block.get("speaker_name", "").strip()}: ' if str(block.get("speaker_name") or "").strip() else "")
        + str(block.get("text") or "").strip()
        for block in scene_blocks
        if str(block.get("text") or "").strip()
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
            "You annotate a narrator response for a visual-novel screen.",
            "Return one exact timeline object via the report_scene_emotions tool.",
            "The narrator response is already split into numbered blocks. Respect the block order exactly.",
            "Rules:",
            "- If the response has at least one usable block, set show_visualization=true and return one block object for every listed block index.",
            "- Use show_visualization=false only when the response is empty or unusable for a visual-novel timeline. In that case return blocks=[].",
            "- The main hero is always shown on the left. Every block must have one hero_emotion.",
            "- Show at most one NPC on the right in each block.",
            "- Use npc_name and npc_emotion only when a concrete NPC should be visible on the right in that exact block.",
            "- Usually NPC speech and NPC thought blocks should show that same NPC on the right.",
            "- For narration blocks, show an NPC on the right only when the narration clearly focuses on a named NPC in that block.",
            "- Never invent characters. Use only exact NPC names from the active character list.",
            "- Never use pronouns instead of names.",
            "- Use only these emotion ids: calm, angry, irritated, stern, cheerful, smiling, sly, alert, scared, happy, embarrassed, confused, thoughtful.",
            "- If a named character encounters danger, choose alert or scared depending on the severity.",
            "- If the scene is interactive but emotion is mild, use calm or smiling.",
            "- Use embarrassed for shyness, awkwardness, blush, or social discomfort.",
            "- If a block explicitly describes blush, shy body language, awkward silence, bashfulness, fluster, смущение, смущённую улыбку, неловкость, or a hesitant romantic reaction, npc_emotion must be embarrassed.",
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
            "Response blocks:",
            "\n".join(block_lines) if block_lines else "No blocks detected.",
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
        request_headers["HTTP-Referer"] = settings.openrouter_site_url
        request_headers["Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        request_headers["X-Title"] = settings.openrouter_app_name

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


def _ensure_story_vendor_dir_on_path() -> None:
    import sys
    from pathlib import Path

    vendor_dir = Path(__file__).resolve().parents[1] / ".vendor"
    if not vendor_dir.exists():
        return
    vendor_dir_str = str(vendor_dir)
    if vendor_dir_str not in sys.path:
        sys.path.insert(0, vendor_dir_str)


def _get_story_sprite_processing_modules() -> tuple[Any, Any, Any]:
    _ensure_story_vendor_dir_on_path()
    from PIL import Image, ImageFilter
    from rembg import remove as rembg_remove

    return Image, ImageFilter, rembg_remove


def _story_image_data_url_has_visible_transparency(data_url: str | None) -> bool:
    decoded_payload = _decode_story_image_data_url_payload(data_url)
    if decoded_payload is None:
        return False
    payload_bytes, _mime_type = decoded_payload
    try:
        _ensure_story_vendor_dir_on_path()
        from PIL import Image
    except Exception:
        return False
    try:
        with Image.open(io.BytesIO(payload_bytes)) as image:
            rgba_image = image.convert("RGBA")
            alpha_extrema = rgba_image.getchannel("A").getextrema()
    except Exception:
        return False
    if not alpha_extrema:
        return False
    minimum_alpha, maximum_alpha = alpha_extrema
    return minimum_alpha < 245 and maximum_alpha > 0


def _remove_story_flat_background_data_url(data_url: str | None) -> str | None:
    decoded_payload = _decode_story_image_data_url_payload(data_url)
    if decoded_payload is None:
        return None
    payload_bytes, _mime_type = decoded_payload
    try:
        _ensure_story_vendor_dir_on_path()
        from PIL import Image
    except Exception:
        return None

    try:
        with Image.open(io.BytesIO(payload_bytes)) as image:
            rgba_image = image.convert("RGBA")
    except Exception:
        return None

    width, height = rgba_image.size
    if width < 2 or height < 2:
        return None

    pixel_access = rgba_image.load()
    border_margin_x = max(6, int(round(width * 0.08)))
    border_margin_y = max(6, int(round(height * 0.08)))
    sample_pixels: list[tuple[int, int, int, float, int]] = []

    def _get_pixel_values(x: int, y: int) -> tuple[int, int, int, int, int, int, float, int]:
        red, green, blue, alpha = pixel_access[x, y]
        min_channel = min(red, green, blue)
        max_channel = max(red, green, blue)
        luma = red * 0.299 + green * 0.587 + blue * 0.114
        chroma = max_channel - min_channel
        return red, green, blue, alpha, min_channel, max_channel, luma, chroma

    def _is_within_sampling_border(x: int, y: int) -> bool:
        return (
            y < border_margin_y
            or x < border_margin_x
            or x >= width - border_margin_x
            or (y >= height - border_margin_y and (x < border_margin_x or x >= width - border_margin_x))
        )

    for y in range(height):
        for x in range(width):
            if not _is_within_sampling_border(x, y):
                continue
            red, green, blue, alpha, _min_channel, _max_channel, luma, chroma = _get_pixel_values(x, y)
            if alpha == 0:
                continue
            if luma < 176 or chroma > 72:
                continue
            sample_pixels.append((red, green, blue, luma, chroma))

    if not sample_pixels:
        sample_pixels.append((255, 255, 255, 255.0, 0))

    sample_count = max(1, len(sample_pixels))
    background_red = sum(item[0] for item in sample_pixels) / sample_count
    background_green = sum(item[1] for item in sample_pixels) / sample_count
    background_blue = sum(item[2] for item in sample_pixels) / sample_count
    background_luma = sum(item[3] for item in sample_pixels) / sample_count
    background_chroma = sum(item[4] for item in sample_pixels) / sample_count
    background_distances = sorted(
        math.sqrt(
            (item[0] - background_red) ** 2
            + (item[1] - background_green) ** 2
            + (item[2] - background_blue) ** 2
        )
        for item in sample_pixels
    )
    distance_percentile_index = min(
        len(background_distances) - 1,
        max(0, int(round(len(background_distances) * 0.9))),
    )
    background_distance_threshold = max(
        18,
        min(74, int(round((background_distances[distance_percentile_index] if background_distances else 22) + 14))),
    )
    background_luma_floor = max(164, min(252, int(round(min(background_luma - 34, 232)))))
    background_chroma_ceiling = max(18, min(86, int(round(max(background_chroma + 18, 30)))))
    edge_softness = 20
    crop_padding = 18

    background_mask = bytearray(width * height)
    queue: list[tuple[int, int]] = []

    def _edge_strength(x: int, y: int) -> int:
        red, green, blue, _alpha, _min_channel, _max_channel, _luma, _chroma = _get_pixel_values(x, y)
        max_delta = 0
        for neighbor_x, neighbor_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if neighbor_x < 0 or neighbor_y < 0 or neighbor_x >= width or neighbor_y >= height:
                continue
            neighbor_red, neighbor_green, neighbor_blue, _neighbor_alpha, *_rest = _get_pixel_values(neighbor_x, neighbor_y)
            delta = max(
                abs(red - neighbor_red),
                abs(green - neighbor_green),
                abs(blue - neighbor_blue),
            )
            if delta > max_delta:
                max_delta = delta
        return max_delta

    def _is_background_candidate(x: int, y: int) -> bool:
        red, green, blue, alpha, min_channel, _max_channel, luma, chroma = _get_pixel_values(x, y)
        if alpha == 0:
            return True
        if luma < background_luma_floor or luma < 146:
            return False
        distance_to_background = math.sqrt(
            (red - background_red) ** 2
            + (green - background_green) ** 2
            + (blue - background_blue) ** 2
        )
        edge_strength = _edge_strength(x, y)
        definitely_background = (
            min_channel >= 238
            and chroma <= background_chroma_ceiling
            and distance_to_background <= background_distance_threshold + 10
        )
        maybe_background = (
            luma >= background_luma_floor
            and chroma <= background_chroma_ceiling
            and distance_to_background <= background_distance_threshold
        )
        if not definitely_background and not maybe_background:
            return False
        if edge_strength > 60 and distance_to_background > background_distance_threshold * 0.7:
            return False
        return True

    def _enqueue(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= width or y >= height:
            return
        index = y * width + x
        if background_mask[index] == 1 or not _is_background_candidate(x, y):
            return
        background_mask[index] = 1
        queue.append((x, y))

    for x in range(width):
        _enqueue(x, 0)
        _enqueue(x, height - 1)
    for y in range(height):
        _enqueue(0, y)
        _enqueue(width - 1, y)

    cursor = 0
    while cursor < len(queue):
        x, y = queue[cursor]
        cursor += 1
        _enqueue(x + 1, y)
        _enqueue(x - 1, y)
        _enqueue(x, y + 1)
        _enqueue(x, y - 1)

    for y in range(height):
        for x in range(width):
            if background_mask[y * width + x] == 1:
                red, green, blue, _alpha = pixel_access[x, y]
                pixel_access[x, y] = (red, green, blue, 0)

    for _pass in range(2):
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                index = y * width + x
                if background_mask[index] == 1 or not _is_background_candidate(x, y):
                    continue
                masked_neighbors = 0
                for offset_y in (-1, 0, 1):
                    for offset_x in (-1, 0, 1):
                        if offset_x == 0 and offset_y == 0:
                            continue
                        if background_mask[(y + offset_y) * width + (x + offset_x)] == 1:
                            masked_neighbors += 1
                if masked_neighbors >= 5:
                    background_mask[index] = 1
                    red, green, blue, _alpha = pixel_access[x, y]
                    pixel_access[x, y] = (red, green, blue, 0)

    softness_floor = max(0, background_luma_floor - edge_softness * 2)
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            index = y * width + x
            if background_mask[index] == 1:
                continue
            has_background_neighbor = (
                background_mask[index - 1] == 1
                or background_mask[index + 1] == 1
                or background_mask[index - width] == 1
                or background_mask[index + width] == 1
            )
            if not has_background_neighbor:
                continue
            red, green, blue, alpha, _min_channel, _max_channel, luma, chroma = _get_pixel_values(x, y)
            if alpha == 0:
                continue
            distance_to_background = math.sqrt(
                (red - background_red) ** 2
                + (green - background_green) ** 2
                + (blue - background_blue) ** 2
            )
            if luma < softness_floor or chroma > background_chroma_ceiling + 12:
                continue
            luma_progress = min(1.0, max(0.0, (luma - softness_floor) / max(1.0, background_luma - softness_floor)))
            distance_progress = min(1.0, distance_to_background / max(1.0, background_distance_threshold + 12))
            alpha_multiplier = max(0.02, distance_progress * (1.0 - luma_progress * 0.9))
            next_alpha = max(0, min(255, int(round(alpha * alpha_multiplier))))
            if 0 < next_alpha < 255:
                normalized_alpha = next_alpha / 255.0
                red = max(0, min(255, int(round((red - background_red * (1.0 - normalized_alpha)) / normalized_alpha))))
                green = max(0, min(255, int(round((green - background_green * (1.0 - normalized_alpha)) / normalized_alpha))))
                blue = max(0, min(255, int(round((blue - background_blue * (1.0 - normalized_alpha)) / normalized_alpha))))
            pixel_access[x, y] = (red, green, blue, next_alpha)

    for y in range(1, height - 1):
        for x in range(1, width - 1):
            index = y * width + x
            red, green, blue, alpha, _min_channel, _max_channel, luma, _chroma = _get_pixel_values(x, y)
            if alpha == 0 or background_mask[index] == 1:
                continue
            transparent_neighbors = 0
            for offset_y in (-1, 0, 1):
                for offset_x in (-1, 0, 1):
                    if offset_x == 0 and offset_y == 0:
                        continue
                    neighbor_alpha = pixel_access[x + offset_x, y + offset_y][3]
                    if neighbor_alpha == 0:
                        transparent_neighbors += 1
            if transparent_neighbors < 2:
                continue
            distance_to_background = math.sqrt(
                (red - background_red) ** 2
                + (green - background_green) ** 2
                + (blue - background_blue) ** 2
            )
            if distance_to_background > background_distance_threshold * 0.82 or luma < background_luma_floor - 18:
                continue
            cleanup_multiplier = 0.0 if transparent_neighbors >= 5 else 0.2 if transparent_neighbors >= 4 else 0.45
            next_alpha = max(0, min(255, int(round(alpha * cleanup_multiplier))))
            pixel_access[x, y] = (red, green, blue, 0 if next_alpha <= 10 else next_alpha)

    alpha_channel = rgba_image.getchannel("A")
    alpha_extrema = alpha_channel.getextrema()
    if not alpha_extrema or alpha_extrema[0] >= 245:
        return None

    bounding_box = alpha_channel.getbbox()
    if bounding_box is None:
        return None
    trimmed_image = (
        rgba_image
        if bounding_box[0] <= 1 and bounding_box[1] <= 1 and bounding_box[2] >= width - 1 and bounding_box[3] >= height - 1
        else _trim_story_sprite_transparent_bounds(rgba_image, padding=crop_padding)
    )
    processed_image = _clean_story_sprite_edge_halo(trimmed_image)
    serialized_image = _serialize_story_sprite_image(processed_image)
    if serialized_image and _story_image_data_url_has_visible_transparency(serialized_image):
        return serialized_image
    return None


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
            if alpha < 28:
                pixel_access[x, y] = (0, 0, 0, 0)
                continue
            if alpha >= 250:
                continue
            channel_min = min(red, green, blue)
            channel_max = max(red, green, blue)
            if channel_max - channel_min > 48 or channel_max < 170:
                continue
            if alpha <= 186 and channel_min >= 208:
                reduced_alpha = int(alpha * 0.38)
                if reduced_alpha < 18:
                    pixel_access[x, y] = (0, 0, 0, 0)
                    continue
                pixel_access[x, y] = (red, green, blue, reduced_alpha)
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
            _ensure_story_vendor_dir_on_path()
            from rembg import new_session as rembg_new_session
        except Exception:
            return None
        for model_name in ("u2net",):
            try:
                STORY_SPRITE_REMOVAL_SESSION = rembg_new_session(model_name)
                return STORY_SPRITE_REMOVAL_SESSION
            except Exception:
                logger.warning("Story sprite removal session init failed for model=%s", model_name, exc_info=True)
        return None


def _remove_story_sprite_background_data_url(data_url: str | None) -> str | None:
    normalized_data_url = str(data_url or "").strip()
    if not normalized_data_url:
        return data_url

    cache_key = hashlib.sha1(normalized_data_url.encode("utf-8")).hexdigest()
    with STORY_SPRITE_REMOVAL_CACHE_LOCK:
        cached_value = STORY_SPRITE_REMOVAL_CACHE.get(cache_key)
    if cached_value:
        return cached_value

    decoded_payload = _decode_story_image_data_url_payload(normalized_data_url)
    if decoded_payload is None:
        return data_url

    flat_background_result = _remove_story_flat_background_data_url(normalized_data_url)
    if flat_background_result and _story_image_data_url_has_visible_transparency(flat_background_result):
        with STORY_SPRITE_REMOVAL_CACHE_LOCK:
            if len(STORY_SPRITE_REMOVAL_CACHE) >= STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS:
                STORY_SPRITE_REMOVAL_CACHE.pop(next(iter(STORY_SPRITE_REMOVAL_CACHE)), None)
            STORY_SPRITE_REMOVAL_CACHE[cache_key] = flat_background_result
        return flat_background_result

    payload_bytes, _mime_type = decoded_payload
    session = _get_story_sprite_removal_session()
    if session is None:
        return data_url

    try:
        Image, _image_filter, rembg_remove = _get_story_sprite_processing_modules()
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

    processed_data_url = _serialize_story_sprite_image(processed_image) or normalized_data_url
    with STORY_SPRITE_REMOVAL_CACHE_LOCK:
        if len(STORY_SPRITE_REMOVAL_CACHE) >= STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS:
            STORY_SPRITE_REMOVAL_CACHE.pop(next(iter(STORY_SPRITE_REMOVAL_CACHE)), None)
        STORY_SPRITE_REMOVAL_CACHE[cache_key] = processed_data_url
    return processed_data_url
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


class _StoryCharacterEmotionGenerationFailure(RuntimeError):
    def __init__(
        self,
        detail: str,
        *,
        partial_result: StoryCharacterEmotionGenerateOut | None = None,
        completed_variants: int = 0,
        consumed_image_count: int = 0,
    ) -> None:
        super().__init__(detail)
        self.partial_result = partial_result
        self.completed_variants = max(int(completed_variants), 0)
        self.consumed_image_count = max(int(consumed_image_count), 0)


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
    image_generation_unit_cost = _get_story_turn_image_cost_tokens(selected_image_model)

    if charge_tokens and not _spend_user_tokens_if_sufficient(db, int(user.id), image_generation_cost):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Not enough sols to generate image",
        )
    if charge_tokens:
        db.commit()
        db.refresh(user)

    emotion_assets: dict[str, str] = {}
    completed_variants = 0
    generated_variants = list(selected_emotion_ids)
    generated_reference_in_run = False

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
            generated_reference_in_run = True
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
        partial_result = StoryCharacterEmotionGenerateOut(
            model=selected_image_model,
            avatar_prompt=reference_prompt,
            emotion_prompt_lock=emotion_prompt_lock or None,
            reference_image_url=reference_image_url,
            reference_image_data_url=reference_image_data_url,
            emotion_assets=emotion_assets,
            user=UserOut.model_validate(user),
        )
        consumed_image_count = completed_variants + (1 if generated_reference_in_run else 0)
        if charge_tokens:
            try:
                refund_tokens = max(image_generation_cost - image_generation_unit_cost * consumed_image_count, 0)
                if refund_tokens > 0:
                    _add_user_tokens(db, int(user.id), refund_tokens)
                db.commit()
                db.refresh(user)
            except Exception:
                db.rollback()
                logger.exception("Story character emotion token refund failed after generation error: user_id=%s", user.id)
            detail = str(exc).strip() or "Emotion generation failed"
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail[:500]) from exc
        detail = str(exc).strip() or "Emotion generation failed"
        raise _StoryCharacterEmotionGenerationFailure(
            detail[:500],
            partial_result=partial_result,
            completed_variants=completed_variants,
            consumed_image_count=consumed_image_count,
        ) from exc

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
        partial_result = exc.partial_result if isinstance(exc, _StoryCharacterEmotionGenerationFailure) else None
        completed_variants = (
            exc.completed_variants
            if isinstance(exc, _StoryCharacterEmotionGenerationFailure)
            else max(int(getattr(job, "completed_variants", 0) or 0), 0)
        )
        consumed_image_count = (
            exc.consumed_image_count if isinstance(exc, _StoryCharacterEmotionGenerationFailure) else 0
        )
        try:
            if int(getattr(job, "reserved_tokens", 0) or 0) > 0:
                reserved_tokens = int(getattr(job, "reserved_tokens", 0) or 0)
                refund_tokens = reserved_tokens
                if consumed_image_count > 0:
                    image_unit_cost = _get_story_turn_image_cost_tokens(
                        str(getattr(job, "image_model", "") or "").strip() or STORY_TURN_IMAGE_MODEL_FLUX
                    )
                    refund_tokens = max(reserved_tokens - image_unit_cost * consumed_image_count, 0)
                if refund_tokens > 0:
                    _add_user_tokens(db, int(job.user_id), refund_tokens)
                job.reserved_tokens = 0
            job.status = STORY_CHARACTER_EMOTION_JOB_STATUS_FAILED
            job.current_emotion_id = ""
            job.completed_variants = max(int(getattr(job, "completed_variants", 0) or 0), completed_variants)
            if partial_result is not None:
                job.result_payload = _serialize_story_character_emotion_job_result_payload(partial_result)
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
                    job.completed_variants = max(int(getattr(job, "completed_variants", 0) or 0), completed_variants)
                    if partial_result is not None:
                        job.result_payload = _serialize_story_character_emotion_job_result_payload(partial_result)
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


def cutout_story_sprite_assets_impl(
    payload: StorySpriteCutoutRequest,
    authorization: str | None,
    db: Session,
) -> StorySpriteCutoutOut:
    user = _get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    processed_assets: list[str] = []
    raw_sources = payload.sources if isinstance(payload.sources, list) else []
    for raw_source in raw_sources[:8]:
        normalized_source = _normalize_avatar_value(raw_source if isinstance(raw_source, str) else None)
        if normalized_source is None:
            processed_assets.append("")
            continue
        try:
            validated_source = _validate_avatar_url(normalized_source, max_bytes=0)
        except Exception:
            processed_assets.append("")
            continue
        source_has_visible_transparency = False
        if validated_source.lower().startswith("data:image/"):
            source_has_visible_transparency = _story_image_data_url_has_visible_transparency(validated_source)
        processed_asset = _finalize_story_character_emotion_asset(
            image_data_url=validated_source if validated_source.lower().startswith("data:image/") else None,
            image_url=validated_source if validated_source.lower().startswith(("https://", "http://")) else None,
        )
        normalized_processed_asset = str(processed_asset or "").strip()
        if normalized_processed_asset and normalized_processed_asset != validated_source:
            processed_assets.append(normalized_processed_asset)
            continue
        if source_has_visible_transparency:
            processed_assets.append(validated_source)
            continue
        processed_assets.append("")

    return StorySpriteCutoutOut(assets=processed_assets)


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
    combined_context = _sanitize_story_turn_image_source_text(combined_context)
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
