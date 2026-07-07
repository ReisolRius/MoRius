from __future__ import annotations

import json

from app.models import StoryMessage
from app.schemas import StoryMessageOut, StoryMessageVariantOut
from app.services.text_encoding import sanitize_likely_utf8_mojibake


def parse_story_message_variant_history(raw_json: object) -> list[dict[str, str]]:
    try:
        parsed = json.loads(raw_json or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    variants: list[dict[str, str]] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        content = str(entry.get("content") or "").replace("\r\n", "\n").strip()
        if not content:
            continue
        variants.append(
            {
                "content": content,
                "created_at": str(entry.get("created_at") or ""),
            }
        )
    return variants


def story_message_to_out(message: StoryMessage) -> StoryMessageOut:
    variant_history = parse_story_message_variant_history(getattr(message, "variant_history_json", None))
    active_variant_index = int(getattr(message, "active_variant_index", 0) or 0)
    if variant_history:
        active_variant_index = max(0, min(active_variant_index, len(variant_history) - 1))
    else:
        active_variant_index = 0
    return StoryMessageOut(
        id=message.id,
        game_id=message.game_id,
        role=message.role,
        content=sanitize_likely_utf8_mojibake(message.content),
        created_at=message.created_at,
        updated_at=message.updated_at,
        variant_history=[
            StoryMessageVariantOut(
                content=sanitize_likely_utf8_mojibake(variant["content"]),
                created_at=variant.get("created_at") or None,
            )
            for variant in variant_history
        ],
        active_variant_index=active_variant_index,
    )
