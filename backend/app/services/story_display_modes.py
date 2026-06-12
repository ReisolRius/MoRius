from __future__ import annotations

from typing import Any

STORY_DISPLAY_MODE_TEXT = "text"
STORY_DISPLAY_MODE_VISUAL_NOVEL = "visual_novel"
STORY_DISPLAY_MODES = {
    STORY_DISPLAY_MODE_TEXT,
    STORY_DISPLAY_MODE_VISUAL_NOVEL,
}


def normalize_story_display_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in STORY_DISPLAY_MODES:
        return normalized
    return STORY_DISPLAY_MODE_TEXT


def can_user_use_visual_novel_mode(user: Any) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == "administrator"
