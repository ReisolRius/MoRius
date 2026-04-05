from __future__ import annotations

import json
from typing import Any

from app.models import User

THEME_KIND_PRESET = "preset"
THEME_KIND_CUSTOM = "custom"
THEME_KIND_VALUES = {THEME_KIND_PRESET, THEME_KIND_CUSTOM}

THEME_STORY_FONT_FAMILY_DEFAULT = "default"
THEME_STORY_FONT_FAMILY_VALUES = {"default", "inter", "verdana"}

THEME_STORY_FONT_WEIGHT_DEFAULT = "regular"
THEME_STORY_FONT_WEIGHT_VALUES = {"regular", "medium", "bold"}

DEFAULT_THEME_STORY = {
    "font_family": THEME_STORY_FONT_FAMILY_DEFAULT,
    "font_weight": THEME_STORY_FONT_WEIGHT_DEFAULT,
    "narrative_italic": False,
    "corrected_text_color": "#578EEE",
    "player_text_color": "#A4ADB6",
    "assistant_text_color": "#DBDDE7",
}

DEFAULT_THEME_PALETTE = {
    "title_text": "#F4F1EA",
    "text_primary": "#E5E0D8",
    "background": "#111111",
    "surface": "#171716",
    "front": "#578EEE",
    "input": "#262624",
}

DEFAULT_THEME_SETTINGS = {
    "active_theme_kind": THEME_KIND_PRESET,
    "active_theme_id": "classic-dark",
    "story": dict(DEFAULT_THEME_STORY),
    "custom_themes": [],
}

MAX_CUSTOM_THEMES_PER_USER = 24
THEME_COLOR_MAX_LENGTH = 64
THEME_NAME_MAX_LENGTH = 80
THEME_DESCRIPTION_MAX_LENGTH = 240


def _normalize_non_empty_string(value: Any, *, default: str = "", max_length: int) -> str:
    normalized = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        return default
    return normalized[:max_length]


def normalize_theme_boolean(value: Any, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def normalize_story_preferences(payload: Any) -> dict[str, Any]:
    value = payload if isinstance(payload, dict) else {}
    font_family = str(value.get("font_family") or "").strip().lower()
    if font_family not in THEME_STORY_FONT_FAMILY_VALUES:
        font_family = THEME_STORY_FONT_FAMILY_DEFAULT

    font_weight = str(value.get("font_weight") or "").strip().lower()
    if font_weight not in THEME_STORY_FONT_WEIGHT_VALUES:
        font_weight = THEME_STORY_FONT_WEIGHT_DEFAULT

    return {
        "font_family": font_family,
        "font_weight": font_weight,
        "narrative_italic": normalize_theme_boolean(
            value.get("narrative_italic"),
            default=DEFAULT_THEME_STORY["narrative_italic"],
        ),
        "corrected_text_color": normalize_theme_color(
            value.get("corrected_text_color"),
            default=DEFAULT_THEME_STORY["corrected_text_color"],
        ),
        "player_text_color": normalize_theme_color(
            value.get("player_text_color"),
            default=DEFAULT_THEME_STORY["player_text_color"],
        ),
        "assistant_text_color": normalize_theme_color(
            value.get("assistant_text_color"),
            default=DEFAULT_THEME_STORY["assistant_text_color"],
        ),
    }


def normalize_theme_color(value: Any, *, default: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return default
    return normalized[:THEME_COLOR_MAX_LENGTH]


def normalize_theme_palette(payload: Any) -> dict[str, str]:
    value = payload if isinstance(payload, dict) else {}
    return {
        "title_text": normalize_theme_color(value.get("title_text"), default=DEFAULT_THEME_PALETTE["title_text"]),
        "text_primary": normalize_theme_color(value.get("text_primary"), default=DEFAULT_THEME_PALETTE["text_primary"]),
        "background": normalize_theme_color(value.get("background"), default=DEFAULT_THEME_PALETTE["background"]),
        "surface": normalize_theme_color(value.get("surface"), default=DEFAULT_THEME_PALETTE["surface"]),
        "front": normalize_theme_color(value.get("front"), default=DEFAULT_THEME_PALETTE["front"]),
        "input": normalize_theme_color(value.get("input"), default=DEFAULT_THEME_PALETTE["input"]),
    }


def normalize_custom_theme(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    theme_id = _normalize_non_empty_string(payload.get("id"), max_length=80)
    if not theme_id:
        return None

    name = _normalize_non_empty_string(payload.get("name"), max_length=THEME_NAME_MAX_LENGTH)
    if not name:
        return None

    return {
        "id": theme_id,
        "name": name,
        "description": _normalize_non_empty_string(
            payload.get("description"),
            max_length=THEME_DESCRIPTION_MAX_LENGTH,
        ),
        "palette": normalize_theme_palette(payload.get("palette")),
        "story": normalize_story_preferences(payload.get("story")),
    }


def read_theme_settings(user: User) -> dict[str, Any]:
    raw_value = str(getattr(user, "theme_preferences", "") or "").strip()
    parsed_value: dict[str, Any] = {}
    if raw_value:
        try:
            candidate = json.loads(raw_value)
            if isinstance(candidate, dict):
                parsed_value = candidate
        except Exception:
            parsed_value = {}

    active_theme_kind = str(parsed_value.get("active_theme_kind") or "").strip().lower()
    if active_theme_kind not in THEME_KIND_VALUES:
        active_theme_kind = DEFAULT_THEME_SETTINGS["active_theme_kind"]

    active_theme_id = _normalize_non_empty_string(
        parsed_value.get("active_theme_id"),
        default=DEFAULT_THEME_SETTINGS["active_theme_id"],
        max_length=80,
    )

    custom_themes_raw = parsed_value.get("custom_themes")
    normalized_custom_themes: list[dict[str, Any]] = []
    if isinstance(custom_themes_raw, list):
        for item in custom_themes_raw[:MAX_CUSTOM_THEMES_PER_USER]:
            normalized_theme = normalize_custom_theme(item)
            if normalized_theme is None:
                continue
            normalized_custom_themes.append(normalized_theme)

    if active_theme_kind == THEME_KIND_CUSTOM:
        active_custom_theme = next(
            (item for item in normalized_custom_themes if item["id"] == active_theme_id),
            None,
        )
        if active_custom_theme is None:
            active_theme_kind = DEFAULT_THEME_SETTINGS["active_theme_kind"]
            active_theme_id = DEFAULT_THEME_SETTINGS["active_theme_id"]
            story = normalize_story_preferences(parsed_value.get("story"))
        else:
            story = dict(active_custom_theme["story"])
    else:
        story = normalize_story_preferences(parsed_value.get("story"))

    return {
        "active_theme_kind": active_theme_kind,
        "active_theme_id": active_theme_id,
        "story": story,
        "custom_themes": normalized_custom_themes,
    }


def write_theme_settings(user: User, payload: Any) -> dict[str, Any]:
    normalized = read_theme_settings_payload(payload)
    user.theme_preferences = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    return normalized


def read_theme_settings_payload(payload: Any) -> dict[str, Any]:
    value = payload if isinstance(payload, dict) else {}
    active_theme_kind = str(value.get("active_theme_kind") or "").strip().lower()
    if active_theme_kind not in THEME_KIND_VALUES:
        active_theme_kind = DEFAULT_THEME_SETTINGS["active_theme_kind"]

    active_theme_id = _normalize_non_empty_string(
        value.get("active_theme_id"),
        default=DEFAULT_THEME_SETTINGS["active_theme_id"],
        max_length=80,
    )

    custom_themes: list[dict[str, Any]] = []
    raw_custom_themes = value.get("custom_themes")
    if isinstance(raw_custom_themes, list):
        for item in raw_custom_themes[:MAX_CUSTOM_THEMES_PER_USER]:
            normalized_theme = normalize_custom_theme(item)
            if normalized_theme is None:
                continue
            custom_themes.append(normalized_theme)

    story = normalize_story_preferences(value.get("story"))

    if active_theme_kind == THEME_KIND_CUSTOM:
        active_custom_theme = next((item for item in custom_themes if item["id"] == active_theme_id), None)
        if active_custom_theme is not None:
            story = dict(active_custom_theme["story"])
        else:
            active_theme_kind = DEFAULT_THEME_SETTINGS["active_theme_kind"]
            active_theme_id = DEFAULT_THEME_SETTINGS["active_theme_id"]

    return {
        "active_theme_kind": active_theme_kind,
        "active_theme_id": active_theme_id,
        "story": story,
        "custom_themes": custom_themes,
    }
