from __future__ import annotations

import json
from typing import Any

from app.services.media import normalize_avatar_value, validate_avatar_url

STORY_CHARACTER_EMOTION_IDS: tuple[str, ...] = (
    "calm",
    "angry",
    "irritated",
    "stern",
    "cheerful",
    "smiling",
    "sly",
    "alert",
    "scared",
    "happy",
    "embarrassed",
    "confused",
    "thoughtful",
)
STORY_CHARACTER_EMOTION_ID_SET = set(STORY_CHARACTER_EMOTION_IDS)
STORY_SCENE_EMOTION_MAX_PARTICIPANTS = 4
STORY_SCENE_EMOTION_IMPORTANCE_VALUES = {"primary", "secondary"}
STORY_SCENE_EMOTION_REASON_MAX_LENGTH = 64
STORY_SCENE_EMOTION_NAME_MAX_LENGTH = 120
def normalize_story_character_emotion_id(value: Any) -> str | None:
    normalized = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    if normalized not in STORY_CHARACTER_EMOTION_ID_SET:
        return None
    return normalized


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


def normalize_story_scene_emotion_payload(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    raw_reason = " ".join(str(value.get("reason") or "").split()).strip()
    reason = raw_reason[:STORY_SCENE_EMOTION_REASON_MAX_LENGTH].rstrip() or "no_interaction"
    raw_participants = value.get("participants")
    normalized_participants: list[dict[str, str]] = []
    seen_names: set[str] = set()

    if isinstance(raw_participants, list):
        for raw_participant in raw_participants:
            if not isinstance(raw_participant, dict):
                continue
            participant_name = " ".join(str(raw_participant.get("name") or "").split()).strip(" .,:;!?\"'()[]")
            if not participant_name:
                continue
            participant_name = participant_name[:STORY_SCENE_EMOTION_NAME_MAX_LENGTH].rstrip()
            if not participant_name:
                continue
            name_key = participant_name.casefold()
            if name_key in seen_names:
                continue
            seen_names.add(name_key)

            emotion_id = normalize_story_character_emotion_id(raw_participant.get("emotion"))
            if emotion_id is None:
                continue

            raw_importance = str(raw_participant.get("importance") or "").strip().lower()
            importance = (
                raw_importance
                if raw_importance in STORY_SCENE_EMOTION_IMPORTANCE_VALUES
                else ("primary" if not normalized_participants else "secondary")
            )

            normalized_participants.append(
                {
                    "name": participant_name,
                    "emotion": emotion_id,
                    "importance": importance,
                }
            )
            if len(normalized_participants) >= STORY_SCENE_EMOTION_MAX_PARTICIPANTS:
                break

    raw_show_visualization = bool(value.get("show_visualization"))
    show_visualization = raw_show_visualization and len(normalized_participants) > 0
    if not show_visualization:
        return {
            "show_visualization": False,
            "reason": reason,
            "participants": [],
        }

    return {
        "show_visualization": True,
        "reason": reason,
        "participants": normalized_participants,
    }


def serialize_story_scene_emotion_payload(value: Any) -> str:
    normalized_payload = normalize_story_scene_emotion_payload(value)
    if normalized_payload is None:
        return ""
    return json.dumps(normalized_payload, ensure_ascii=False, separators=(",", ":"))


def deserialize_story_scene_emotion_payload(raw_value: str | None) -> dict[str, Any] | None:
    normalized_raw_value = str(raw_value or "").strip()
    if not normalized_raw_value:
        return None

    try:
        parsed_value = json.loads(normalized_raw_value)
    except (TypeError, ValueError):
        return None

    return normalize_story_scene_emotion_payload(parsed_value)
