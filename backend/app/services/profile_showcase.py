from __future__ import annotations

import json
from typing import Any


PROFILE_SHOWCASE_STATIC_KINDS = {"banner", "avatar_frame", "badge"}
PROFILE_SHOWCASE_ENTITY_KINDS = {"game", "character"}
PROFILE_SHOWCASE_KINDS = PROFILE_SHOWCASE_STATIC_KINDS | PROFILE_SHOWCASE_ENTITY_KINDS
PROFILE_SHOWCASE_MAX_ITEMS = len(PROFILE_SHOWCASE_KINDS)
DEFAULT_PROFILE_SHOWCASE = [
    {"kind": "banner", "entity_id": None},
    {"kind": "avatar_frame", "entity_id": None},
    {"kind": "badge", "entity_id": None},
]


def normalize_profile_showcase(value: Any) -> list[dict[str, Any]]:
    parsed_value = value
    if isinstance(value, str):
        try:
            parsed_value = json.loads(value)
        except (TypeError, ValueError):
            parsed_value = None

    if not isinstance(parsed_value, list):
        return [dict(item) for item in DEFAULT_PROFILE_SHOWCASE]

    normalized_items: list[dict[str, Any]] = []
    seen_kinds: set[str] = set()
    for raw_item in parsed_value:
        if not isinstance(raw_item, dict):
            continue
        kind = str(raw_item.get("kind") or "").strip().lower()
        if kind not in PROFILE_SHOWCASE_KINDS or kind in seen_kinds:
            continue

        entity_id: int | None = None
        if kind in PROFILE_SHOWCASE_ENTITY_KINDS:
            raw_entity_id = raw_item.get("entity_id")
            if isinstance(raw_entity_id, bool):
                continue
            try:
                entity_id = int(raw_entity_id)
            except (TypeError, ValueError):
                continue
            if entity_id <= 0:
                continue

        normalized_items.append({"kind": kind, "entity_id": entity_id})
        seen_kinds.add(kind)
        if len(normalized_items) >= PROFILE_SHOWCASE_MAX_ITEMS:
            break

    return normalized_items or [dict(item) for item in DEFAULT_PROFILE_SHOWCASE]


def serialize_profile_showcase(value: Any) -> str:
    return json.dumps(normalize_profile_showcase(value), ensure_ascii=False, separators=(",", ":"))
