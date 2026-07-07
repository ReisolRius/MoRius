from __future__ import annotations

import json
from typing import Any

from app.services.media import normalize_avatar_value, validate_avatar_url

# Visual Novel preset emotions. Used both for the manual sprite-upload slots on a character
# and for the emotion tag the narrator attaches to each dialogue/thought beat. 8 base moods.
STORY_CHARACTER_EMOTION_IDS: tuple[str, ...] = (
    "neutral",
    "happy",
    "sad",
    "angry",
    "surprised",
    "shy",
    "scared",
    "smug",
)
STORY_CHARACTER_EMOTION_ID_SET = set(STORY_CHARACTER_EMOTION_IDS)
STORY_CHARACTER_DEFAULT_EMOTION = "neutral"

# Human-readable Russian labels for the UI (upload cards, tooltips).
STORY_CHARACTER_EMOTION_LABELS: dict[str, str] = {
    "neutral": "Нейтральная",
    "happy": "Радость",
    "sad": "Грусть",
    "angry": "Злость",
    "surprised": "Удивление",
    "shy": "Смущение",
    "scared": "Страх",
    "smug": "Ухмылка",
}

# Aliases the narrator model (or legacy data) may emit, mapped onto the 8 canonical ids.
# Keys are matched exactly first, then as a substring (handles Russian word inflections).
_STORY_CHARACTER_EMOTION_ALIASES: dict[str, str] = {
    "calm": "neutral",
    "normal": "neutral",
    "serious": "neutral",
    "stern": "angry",
    "joy": "happy",
    "glad": "happy",
    "cheerful": "happy",
    "smiling": "happy",
    "smile": "happy",
    "sorrow": "sad",
    "upset": "sad",
    "crying": "sad",
    "mad": "angry",
    "irritated": "angry",
    "furious": "angry",
    "annoyed": "angry",
    "surprise": "surprised",
    "shocked": "surprised",
    "alert": "surprised",
    "confused": "surprised",
    "embarrassed": "shy",
    "blush": "shy",
    "awkward": "shy",
    "afraid": "scared",
    "fear": "scared",
    "terrified": "scared",
    "sly": "smug",
    "grin": "smug",
    "smirk": "smug",
    "thoughtful": "neutral",
    # Russian word stems
    "нейтр": "neutral",
    "спокой": "neutral",
    "радост": "happy",
    "весел": "happy",
    "улыб": "happy",
    "счаст": "happy",
    "груст": "sad",
    "печал": "sad",
    "слёз": "sad",
    "слез": "sad",
    "злост": "angry",
    "гнев": "angry",
    "раздраж": "angry",
    "ярост": "angry",
    "удивл": "surprised",
    "изумл": "surprised",
    "шок": "surprised",
    "смущ": "shy",
    "стеснен": "shy",
    "робо": "shy",
    "страх": "scared",
    "испуг": "scared",
    "ужас": "scared",
    "ухмыл": "smug",
    "усмеш": "smug",
    "хитр": "smug",
    "самодовол": "smug",
}


def normalize_story_character_emotion_id(value: Any) -> str | None:
    normalized = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not normalized:
        return None
    if normalized in STORY_CHARACTER_EMOTION_ID_SET:
        return normalized
    if normalized in _STORY_CHARACTER_EMOTION_ALIASES:
        return _STORY_CHARACTER_EMOTION_ALIASES[normalized]
    for alias, emotion_id in _STORY_CHARACTER_EMOTION_ALIASES.items():
        if alias and alias in normalized:
            return emotion_id
    return None


def coerce_story_character_emotion_id(value: Any) -> str:
    return normalize_story_character_emotion_id(value) or STORY_CHARACTER_DEFAULT_EMOTION


def normalize_story_character_emotion_assets(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}

    normalized_assets: dict[str, str] = {}
    for emotion_id in STORY_CHARACTER_EMOTION_IDS:
        raw_asset = value.get(emotion_id)
        normalized_asset = normalize_avatar_value(raw_asset if isinstance(raw_asset, str) else None)
        if normalized_asset is None:
            continue
        normalized_assets[emotion_id] = validate_avatar_url(
            normalized_asset,
            max_bytes=0,
        )
    return normalized_assets


def serialize_story_character_emotion_assets(value: Any) -> str:
    normalized_assets = normalize_story_character_emotion_assets(value)
    if not normalized_assets:
        return ""
    return json.dumps(normalized_assets, ensure_ascii=False, separators=(",", ":"))


def deserialize_story_character_emotion_assets(raw_value: str | None) -> dict[str, str]:
    normalized_raw_value = str(raw_value or "").strip()
    if not normalized_raw_value:
        return {}

    try:
        parsed_value = json.loads(normalized_raw_value)
    except (TypeError, ValueError):
        return {}

    return normalize_story_character_emotion_assets(parsed_value)


STORY_NOVEL_SPRITE_GENDERS = ("", "male", "female")


def normalize_story_novel_sprite_gender(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"m", "man", "male", "муж", "мужской", "мужчина", "парень"}:
        return "male"
    if normalized in {"f", "w", "woman", "female", "жен", "женский", "женщина", "девушка"}:
        return "female"
    return ""
