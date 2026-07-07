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
from app.models import StoryMessage, StoryTurnImage, User
from app.schemas import (
    StoryCharacterAvatarGenerateOut,
    StoryCharacterAvatarGenerateRequest,
    StoryTurnImageGenerateOut,
    StoryTurnImageGenerateRequest,
    UserOut,
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
STORY_TURN_IMAGE_COST_BY_MODEL = monolith_main.STORY_TURN_IMAGE_COST_BY_MODEL
STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS = monolith_main.STORY_TURN_IMAGE_REQUEST_CONNECT_TIMEOUT_SECONDS
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT = monolith_main.STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_DEFAULT
STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL = monolith_main.STORY_TURN_IMAGE_REQUEST_READ_TIMEOUT_SECONDS_BY_MODEL
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT = monolith_main.STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_DEFAULT
STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM = monolith_main.STORY_TURN_IMAGE_REQUEST_PROMPT_MAX_CHARS_SEEDREAM
STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS = monolith_main.STORY_TURN_IMAGE_APPEARANCE_LOCK_KEYWORDS
STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS = monolith_main.STORY_TURN_IMAGE_HAIR_LENGTH_LOCK_KEYWORDS
STORY_WORLD_CARD_KIND_NPC = monolith_main.STORY_WORLD_CARD_KIND_NPC
STORY_WORLD_CARD_KIND_MAIN_HERO = monolith_main.STORY_WORLD_CARD_KIND_MAIN_HERO
STORY_SPRITE_IMAGE_BASE_RULES = (
    "Single character only.",
    "Clean cutout-friendly background; no extra people, text, logos, watermark, frame, or scenery unless requested.",
    "Readable face, consistent costume, anatomy, proportions, and silhouette.",
)

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
_build_polza_image_provider_payload = monolith_main._build_polza_image_provider_payload
_normalize_story_prompt_text = monolith_main._normalize_story_prompt_text
_list_story_world_cards = monolith_main._list_story_world_cards
_list_story_messages = monolith_main._list_story_messages
_select_story_world_cards_for_prompt = monolith_main._select_story_world_cards_for_prompt
_select_story_world_cards_triggered_by_text = monolith_main._select_story_world_cards_triggered_by_text
_utcnow = monolith_main._utcnow

STORY_SPRITE_REMOVAL_SESSION_LOCK = Lock()
STORY_SPRITE_REMOVAL_SESSION: Any = None
STORY_SPRITE_REMOVAL_CACHE_LOCK = Lock()
STORY_SPRITE_REMOVAL_CACHE: dict[str, str] = {}
STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS = int(
    getattr(monolith_main, "STORY_SPRITE_REMOVAL_CACHE_MAX_ITEMS", 96) or 96
)


def _validate_story_turn_image_provider_config(model_name: str | None = None) -> None:
    return monolith_main._validate_story_turn_image_provider_config(model_name)


def _normalize_story_turn_image_style_prompt(value: str | None) -> str:
    compact_value = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not compact_value:
        return ""
    return compact_value[:STORY_TURN_IMAGE_STYLE_PROMPT_MAX_CHARS].rstrip()


def _get_story_turn_image_cost_tokens(model_name: str | None) -> int:
    return monolith_main._get_story_turn_image_cost_tokens(model_name)


def _get_story_turn_image_read_timeout_seconds(model_name: str | None) -> int:
    return monolith_main._get_story_turn_image_read_timeout_seconds(model_name)


def _get_story_turn_image_request_prompt_max_chars(model_name: str | None) -> int:
    return monolith_main._get_story_turn_image_request_prompt_max_chars(model_name)


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
        _extract_story_npc_profile_field(lines, ("РїРѕР»", "gender"))
    )
    profile_gender_hint = _extract_story_turn_image_gender_hint_from_text(profile_gender)
    if profile_gender_hint:
        return profile_gender_hint

    content_gender_hint = _extract_story_turn_image_gender_hint_from_text(plain_content)
    if content_gender_hint:
        return content_gender_hint

    inferred_gender = _infer_story_npc_gender_from_context(raw_title, user_prompt, assistant_text)
    if inferred_gender in {"Р¶РµРЅСЃРєРёР№", "РјСѓР¶СЃРєРѕР№"}:
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
        return "Р¶РµРЅСЃРєРёР№"
    if male_score > female_score:
        return "РјСѓР¶СЃРєРѕР№"
    return ""


def _story_turn_image_gender_hint_for_prompt(gender_hint: str) -> str:
    normalized = str(gender_hint or "").strip().casefold()
    if normalized == "РјСѓР¶СЃРєРѕР№":
        return "male (РјСѓР¶СЃРєРѕР№)"
    if normalized == "Р¶РµРЅСЃРєРёР№":
        return "female (Р¶РµРЅСЃРєРёР№)"
    return ""


def _story_turn_image_gender_lock_for_prompt(gender_hint: str) -> str:
    normalized = str(gender_hint or "").strip().casefold()
    if normalized == "Р¶РµРЅСЃРєРёР№":
        return (
            "gender-lock female ONLY: must be clearly depicted as a woman; "
            "forbidden male/man/boy presentation."
        )
    if normalized == "РјСѓР¶СЃРєРѕР№":
        return (
            "gender-lock male ONLY: must be clearly depicted as a man; "
            "forbidden female/woman/girl presentation."
        )
    return ""


def _extract_story_turn_image_visual_sentences(plain_content: str) -> list[str]:
    visual_keywords = (
        "РІРЅРµС€",
        "РІРѕР»РѕСЃ",
        "РіР»Р°Р·",
        "РѕРґРµР¶Рґ",
        "РєСѓСЂС‚Рє",
        "СЂСѓР±Р°С€",
        "РїР»Р°С‚СЊ",
        "СЋР±Рє",
        "Р±СЂСЋРє",
        "С„СѓС‚Р±РѕР»",
        "С‚РµР»РѕСЃР»РѕР¶",
        "СЂРѕСЃС‚",
        "Р»РёС†",
        "С€СЂР°Рј",
        "РїСЂРёС‡РµСЃ",
        "С†РІРµС‚ РІРѕР»РѕСЃ",
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
    explicit_clothing = str(card.get("clothing", "") or "").replace("\r\n", " ").strip()
    if not plain_content and not explicit_clothing:
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

    if explicit_clothing:
        _append_fragment(f"CURRENT OUTFIT (EXPLICIT CARD FIELD): {explicit_clothing}", max_chars=240)

    profile_field_groups: tuple[tuple[str, ...], ...] = (
        ("РІРЅРµС€РЅРѕСЃС‚СЊ", "appearance", "РѕР±Р»РёРє"),
        ("Р»РёС†Рѕ", "С‡РµСЂС‚С‹ Р»РёС†Р°", "facial features", "face"),
        ("РІРѕР»РѕСЃС‹", "С†РІРµС‚ РІРѕР»РѕСЃ", "РґР»РёРЅР° РІРѕР»РѕСЃ", "РїСЂРёС‡РµСЃРєР°", "hair", "hair color", "hair length", "hairstyle"),
        ("РіР»Р°Р·Р°", "С†РІРµС‚ РіР»Р°Р·", "eyes", "eye color"),
        ("С‚РµР»РѕСЃР»РѕР¶РµРЅРёРµ", "СЂРѕСЃС‚", "build", "body type", "height"),
        ("РѕСЃРѕР±С‹Рµ РїСЂРёРјРµС‚С‹", "РїСЂРёРјРµС‚С‹", "С€СЂР°Рј", "С‚Р°С‚Сѓ", "marks", "scar", "tattoo"),
        ("РѕРґРµР¶РґР°", "style", "outfit", "clothes"),
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
    explicit_clothing = _normalize_story_prompt_text(
        str(card.get("clothing", "") or ""),
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_CHARACTER_APPEARANCE_CHARS,
    )
    if not plain_content and not explicit_clothing:
        return ""
    lines = [line.strip() for line in plain_content.split("\n") if line.strip()]
    profile_appearance = _sanitize_story_npc_profile_value(
        _extract_story_npc_profile_field(lines, ("РІРЅРµС€РЅРѕСЃС‚СЊ", "appearance", "РѕР±Р»РёРє"))
    )
    appearance_fragments: list[str] = []
    if explicit_clothing:
        appearance_fragments.append(f"current outfit: {explicit_clothing}")
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


def _story_turn_image_style_prompt_forbids_text(style_prompt: str) -> bool:
    normalized_style = re.sub(r"\s+", " ", str(style_prompt or "").casefold()).strip()
    if not normalized_style:
        return False

    text_ban_tokens = (
        "no text",
        "without text",
        "no readable text",
        "no typography",
        "without typography",
        "no words",
        "without words",
        "no letters",
        "without letters",
        "no captions",
        "no subtitles",
        "no speech bubbles",
        "no logos",
        "no logo",
        "no watermark",
        "no signage",
        "no signs",
        "no numbers",
        "no ui",
        "\u0431\u0435\u0437 \u0442\u0435\u043a\u0441\u0442",
        "\u0431\u0435\u0437 \u043d\u0430\u0434\u043f\u0438\u0441",
        "\u0431\u0435\u0437 \u0431\u0443\u043a\u0432",
        "\u0431\u0435\u0437 \u0441\u043b\u043e\u0432",
        "\u0431\u0435\u0437 \u0446\u0438\u0444\u0440",
        "\u0431\u0435\u0437 \u043b\u043e\u0433\u043e",
        "\u0431\u0435\u0437 \u0432\u043e\u0434\u044f\u043d",
        "\u043d\u0438\u043a\u0430\u043a\u043e\u0433\u043e \u0442\u0435\u043a\u0441",
        "\u043d\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439 \u0442\u0435\u043a\u0441",
        "\u043d\u0435 \u043f\u0438\u0448\u0438 \u0442\u0435\u043a\u0441",
        "\u0442\u0435\u043a\u0441\u0442\u0430 \u043d\u0435 \u0434\u043e\u043b\u0436\u043d\u043e",
        "\u043d\u0435 \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0442\u0435\u043a\u0441",
    )
    return any(token in normalized_style for token in text_ban_tokens)


def _story_turn_image_style_prompt_requests_anime(style_prompt: str) -> bool:
    normalized_style = re.sub(r"\s+", " ", str(style_prompt or "").casefold()).strip()
    if not normalized_style:
        return False
    anime_negation_tokens = (
        "no anime",
        "not anime",
        "without anime",
        "no manga",
        "not manga",
        "without manga",
        "\u0431\u0435\u0437 \u0430\u043d\u0438\u043c",
        "\u043d\u0435 \u0430\u043d\u0438\u043c",
        "\u0431\u0435\u0437 \u043c\u0430\u043d\u0433",
        "\u043d\u0435 \u043c\u0430\u043d\u0433",
    )
    if any(token in normalized_style for token in anime_negation_tokens):
        return False
    return any(
        token in normalized_style
        for token in ("\u0430\u043d\u0438\u043c\u0435", "anime", "\u043c\u0430\u043d\u0433\u0430", "manga")
    )


def _story_turn_image_style_prompt_requests_realism(style_prompt: str) -> bool:
    normalized_style = re.sub(r"\s+", " ", str(style_prompt or "").casefold()).strip()
    if not normalized_style:
        return False
    return any(
        token in normalized_style
        for token in (
            "\u0440\u0435\u0430\u043b",
            "\u0444\u043e\u0442\u043e\u0440\u0435\u0430\u043b",
            "\u0443\u043b\u044c\u0442\u0440\u0430\u0440\u0435\u0430\u043b",
            "photoreal",
            "photo-real",
            "realistic",
            "realism",
            "ultrareal",
            "hyperreal",
            "live action",
            "live-action",
        )
    )


def _build_story_turn_image_style_instructions(style_prompt: str) -> str:
    normalized_style = _normalize_story_turn_image_style_prompt(style_prompt)
    if not normalized_style:
        return ""

    requests_realism = _story_turn_image_style_prompt_requests_realism(normalized_style)
    requests_anime = _story_turn_image_style_prompt_requests_anime(normalized_style)
    style_parts = [
        f"USER STYLE DIRECTIVE (HIGHEST PRIORITY, MUST FOLLOW EXACTLY): {normalized_style}.",
        "This directive is mandatory, not a suggestion; apply every requested style, constraint, and prohibition to the entire final image.",
        "If any model default, scene wording, or provider bias conflicts with this directive, the directive wins for visual style and prohibited elements.",
        "Do not weaken, reinterpret, ignore, or partially apply the directive.",
        "Character cards, world cards, and reference images define identity and scene facts only; do not inherit their art style unless the user directive asks for it.",
    ]
    if _story_turn_image_style_prompt_forbids_text(normalized_style):
        style_parts.append(
            "USER TEXT BAN (ABSOLUTE): zero visible text of any kind; no letters, words, captions, subtitles, speech bubbles, signs, labels, logos, watermarks, UI, numbers, handwriting, signatures, or readable symbols."
        )
        style_parts.append(
            "Do not place text-like marks in the background, on clothing, on objects, or as decorative typography."
        )
    if requests_realism:
        style_parts.append(
            "REALISM LOCK (ABSOLUTE): render as a photorealistic live-action image with real camera optics, natural lighting, real skin texture, realistic anatomy, realistic fabric, realistic materials, and believable depth of field."
        )
        style_parts.append(
            "FORBIDDEN UNDER REALISM LOCK: anime, manga, visual-novel, cel-shading, lineart, drawn outlines, painterly illustration, stylized game art, doll-like faces, oversized anime eyes, simplified noses or mouths, toon shading, and 2D character art."
        )
        style_parts.append(
            "If characters were originally described or referenced in anime or stylized form, reinterpret only their identity, outfit, pose, and scene role as realistic humans."
        )
    elif requests_anime:
        style_parts.append(
            "Strict anime look: 2D illustration, clean lineart, cel-shading, stylized facial features."
        )
        style_parts.append(
            "Avoid photorealism, avoid semi-realistic rendering."
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
        explicit_clothing = _normalize_story_prompt_text(str(card.get("clothing", "") or ""), max_chars=240)

        line_parts = [f"{role_label}: {title}"]
        gender_label = _story_turn_image_gender_hint_for_prompt(gender_hint)
        if gender_label:
            line_parts.append(f"gender {gender_label}")
        gender_lock = _story_turn_image_gender_lock_for_prompt(gender_hint)
        if gender_lock:
            line_parts.append(gender_lock)
        if explicit_clothing:
            line_parts.append(f"clothing-lock {explicit_clothing}")
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
        explicit_clothing = _normalize_story_prompt_text(str(card.get("clothing", "") or ""), max_chars=320)
        if not plain_content and not explicit_clothing:
            continue

        lock_lines = [f"CHARACTER_CARD_LOCK_BEGIN: {role_label} | {title}"]
        if explicit_clothing:
            lock_lines.extend(
                [
                    f"EXPLICIT_CLOTHING_LOCK (HIGHEST OUTFIT PRIORITY): {explicit_clothing}",
                    "If scene text or generic card content describes different clothing, use EXPLICIT_CLOTHING_LOCK.",
                ]
            )
        if plain_content:
            lock_lines.append(plain_content)
        lock_lines.append("CHARACTER_CARD_LOCK_END")
        lock_blocks.append(
            "\n".join(lock_lines)
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
    environment_context: str | None = None,
    full_character_card_locks: list[str] | None = None,
    model_name: str | None = None,
) -> str:
    prompt_max_chars = max(_get_story_turn_image_request_prompt_max_chars(model_name), 1)
    sanitized_user_prompt = _sanitize_story_turn_image_source_text(user_prompt)
    sanitized_assistant_text = _sanitize_story_turn_image_source_text(assistant_text)
    sanitized_image_style_prompt = _sanitize_story_turn_image_source_text(image_style_prompt)
    sanitized_environment_context = _sanitize_story_turn_image_source_text(environment_context)
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
    normalized_environment_context = re.sub(
        r"\s+",
        " ",
        _normalize_story_markup_to_plain_text(sanitized_environment_context).replace("\r\n", "\n"),
    ).strip()

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
    has_clothing_lock_line = any("clothing-lock" in line for line in character_lines)
    style_instructions = _build_story_turn_image_style_instructions(normalized_image_style_prompt)
    scene_focus_text = _build_story_turn_image_latest_scene_focus_text(
        sanitized_assistant_text,
        max_chars=STORY_TURN_IMAGE_PROMPT_MAX_ASSISTANT_CHARS,
    )
    prefer_scene_focus_context = model_name in {STORY_TURN_IMAGE_MODEL_FLUX, STORY_TURN_IMAGE_MODEL_SEEDREAM}
    assistant_context_text = scene_focus_text if prefer_scene_focus_context and scene_focus_text else normalized_assistant_text
    if not assistant_context_text and scene_focus_text:
        assistant_context_text = scene_focus_text

    prompt_parts: list[str] = []
    if style_instructions:
        prompt_parts.append(style_instructions)
    prompt_parts.extend(
        [
            "GLOBAL TEXT BAN (STRICT): zero visible text, UI, watermark, logo, captions, subtitles, speech bubbles, signs, labels, letters, words, handwriting, signatures, or numbers.",
            "Single cinematic frame from one interactive RPG scene.",
            "Keep one coherent location and one coherent moment.",
        ]
    )

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
        # Keep active style and character locks above all other context if the prompt budget is too tight.
        prompt_parts = []
        if style_instructions:
            prompt_parts.append(style_instructions)
        prompt_parts.append(
            "GLOBAL TEXT BAN (STRICT): zero visible text, UI, watermark, logo, captions, subtitles, speech bubbles, signs, labels, letters, words, handwriting, signatures, or numbers."
        )
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
    _append_story_turn_image_optional_context_part(
        prompt_parts,
        part_prefix="Active place/time/weather modules: ",
        part_body=normalized_environment_context,
        part_suffix=".",
        prompt_max_chars=prompt_max_chars,
        prefer_fresh_tail=True,
    )
    if normalized_environment_context:
        _try_append_optional_line(
            "Use the active place/time/weather module facts as strict visual constraints for location, season, "
            "time of day, lighting, sky, and weather."
        )
    _try_append_optional_line(
        "Do not invent unrelated people, symbols, dream imagery, flashbacks, parallel scenes, or extra locations."
    )
    if has_full_character_card_lock:
        _try_append_optional_line(
            "CHARACTER_CARD_LOCK priority is absolute: "
            "CHARACTER_CARD_LOCK > appearance-lock > scene state."
        )
    _try_append_optional_line(
        "Visible cast must come from the latest player turn and narrator response: include every visible character in this scene, including newly mentioned characters without cards; omit characters who are not present."
    )
    _try_append_optional_line(
        "The main hero is optional: include the player character only when the current scene text places the main hero visibly in the scene."
    )
    if character_lines:
        _try_append_optional_line(
            "Character card appearance hints (use only for these listed characters when they are actually visible): "
            + " ".join(f"{index + 1}) {line}." for index, line in enumerate(character_lines))
        )
        _try_append_optional_line(
            "Do not treat listed cards as a required cast count. Add visible non-card characters from the scene text and omit listed card characters who are absent."
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
        if has_clothing_lock_line:
            _try_append_optional_line(
                "Clothing lock is absolute for the current frame. The explicit Clothing field from the character card "
                "overrides generic card prose, older scene descriptions, inferred outfits, and model defaults."
            )
            _try_append_optional_line(
                "Show the exact clothing-lock outfit without substitutions, redesigns, added uniforms, armor, dresses, coats, or accessories."
            )
        if has_main_hero_line:
            _try_append_optional_line("If the main hero is visible in the scene, show the main hero in third-person framing; if not present, do not force the main hero into the image.")
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


def _extract_polza_error_detail(response: requests.Response) -> str:
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


def _build_story_turn_image_polza_payload(
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
        }
        provider_payload = _build_polza_image_provider_payload(selected_model)
        if provider_payload:
            payload["provider"] = provider_payload
        aspect_ratio = _resolve_story_turn_image_aspect_ratio(settings.polza_image_size)
        if aspect_ratio:
            payload["image_config"] = {"aspect_ratio": aspect_ratio}
        return payload

    payload = {
        "model": selected_model,
        "prompt": prompt,
        "n": 1,
    }
    image_size = str(settings.polza_image_size or "").strip()
    if image_size:
        payload["size"] = image_size
    return payload


def _parse_polza_story_turn_image_payload(
    payload_value: Any,
    *,
    selected_model: str,
) -> dict[str, str | None]:
    if not isinstance(payload_value, dict):
        raise RuntimeError("Polza.ai image endpoint returned empty payload")

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
                raise RuntimeError("Polza.ai image endpoint returned no image URL")
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
        raise RuntimeError("Polza.ai image endpoint returned no images")

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
        raise RuntimeError("Polza.ai image endpoint returned no usable image")

    return {
        "model": str(payload_value.get("model") or selected_model),
        "image_url": image_url,
        "image_data_url": image_data_url,
        "revised_prompt": revised_prompt,
    }


def _request_polza_story_turn_image(
    *,
    prompt: str,
    model_name: str | None = None,
    reference_image_url: str | None = None,
    reference_image_data_url: str | None = None,
) -> dict[str, str | None]:
    return monolith_main._request_polza_story_turn_image(
        prompt=prompt,
        model_name=model_name,
        reference_image_url=reference_image_url,
        reference_image_data_url=reference_image_data_url,
    )




def _request_story_turn_image(
    *,
    prompt: str,
    model_name: str | None = None,
    reference_image_url: str | None = None,
    reference_image_data_url: str | None = None,
) -> dict[str, str | None]:
    return monolith_main._request_story_turn_image(
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
        *STORY_SPRITE_IMAGE_BASE_RULES,
        "Full-body framing: show the character from head to toe in a standing pose.",
        "Keep the character centered with clean margins around the silhouette.",
        "Use only the player's character appearance description below as the source of visual details.",
    ]
    if normalized_style_prompt:
        prompt_lines.append(
            f"MANDATORY USER STYLE DIRECTIVE (HIGHEST PRIORITY): {normalized_style_prompt}. "
            "Follow it exactly for style, medium, rendering, and prohibitions."
        )
    else:
        prompt_lines.append("Use high-detail stylized game art lighting and readable facial features.")
    prompt_lines.append(f"Character appearance description: {normalized_description}.")

    return "\n".join(prompt_lines).strip()


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
    lowered_url = normalized_url.lower()
    if ("polza.ai" in lowered_url or "polza.ai" in lowered_url) and settings.polza_api_key:
        request_headers["Authorization"] = f"Bearer {settings.polza_api_key}"
    if settings.polza_site_url:
        request_headers["HTTP-Referer"] = settings.polza_site_url
        request_headers["Referer"] = settings.polza_site_url
    if settings.polza_app_name:
        request_headers["X-Title"] = settings.polza_app_name

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
    character_world_cards = monolith_main._select_story_turn_image_participant_world_cards(
        latest_context=combined_context,
        all_world_cards=all_world_cards,
        active_world_cards=active_world_cards,
    )
    if not character_world_cards:
        character_world_cards = [
            card
            for card in active_world_cards
            if isinstance(card, dict)
            and _normalize_story_world_card_kind(str(card.get("kind", ""))) == STORY_WORLD_CARD_KIND_MAIN_HERO
        ]
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

    request_image_style_prompt = getattr(payload, "image_style_prompt", None)
    if request_image_style_prompt is not None:
        effective_image_style_prompt = _normalize_story_turn_image_style_prompt(request_image_style_prompt)
        game.image_style_prompt = effective_image_style_prompt
    else:
        effective_image_style_prompt = getattr(game, "image_style_prompt", "")

    selected_image_model = _coerce_story_image_model(getattr(game, "image_model", None))
    _validate_story_turn_image_provider_config(selected_image_model)
    try:
        environment_context = monolith_main._build_story_turn_image_environment_context(db=db, game=game)
    except Exception:
        environment_context = ""
    visual_prompt = _build_story_turn_image_prompt(
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=prompt_world_cards,
        character_world_cards=character_world_cards,
        image_style_prompt=effective_image_style_prompt,
        environment_context=environment_context,
        full_character_card_locks=full_character_card_locks,
        model_name=selected_image_model,
    )
    visual_prompt = monolith_main._compose_story_turn_image_prompt_with_model(
        fallback_prompt=visual_prompt,
        user_prompt=source_user_message.content,
        assistant_text=assistant_message.content,
        world_cards=prompt_world_cards,
        character_world_cards=character_world_cards,
        image_style_prompt=effective_image_style_prompt,
        environment_context=environment_context,
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
