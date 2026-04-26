from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status

from app.models import StoryMemoryBlock
from app.schemas import StoryMemoryBlockOut
from app.services.text_encoding import sanitize_likely_utf8_mojibake

STORY_MEMORY_LAYER_RAW = "raw"
STORY_MEMORY_LAYER_COMPRESSED = "compressed"
STORY_MEMORY_LAYER_SUPER = "super"
STORY_MEMORY_LAYER_KEY = "key"
STORY_MEMORY_LAYER_LOCATION = "location"
STORY_MEMORY_LAYER_WEATHER = "weather"
STORY_MEMORY_LAYERS = {
    STORY_MEMORY_LAYER_RAW,
    STORY_MEMORY_LAYER_COMPRESSED,
    STORY_MEMORY_LAYER_SUPER,
    STORY_MEMORY_LAYER_KEY,
    STORY_MEMORY_LAYER_LOCATION,
    STORY_MEMORY_LAYER_WEATHER,
}
STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH = 160
STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH = 64_000
STORY_LOCATION_MEMORY_UI_PREFIXES = (
    "Действие происходит ",
    "События происходят ",
)
STORY_MEMORY_OUTPUT_MARKUP_PATTERN = re.compile(r"\[\[[^\]]+\]\]")
STORY_MEMORY_OUTPUT_DANGLING_MARKUP_PATTERN = re.compile(r"\[\[[^\]]*$")
STORY_MEMORY_OUTPUT_NAMED_MARKUP_PATTERN = re.compile(
    r"\[\[\s*([A-Za-z_]+)(?:\s*(?::|-)\s*|\s+)?([^\]]*?)\s*\]\]"
)

STORY_LOCATION_TIME_TRAILING_PATTERNS = (
    re.compile(
        r"(?:,\s*|\s+)(?:(?:сейчас|сегодня|теперь|этим|этой)\s+)?(?:ночью|утром|днем|днём|вечером)$",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:,\s*|\s+)(?:под\s+утро|под\s+вечер|к\s+утру|к\s+вечеру|на\s+рассвете|на\s+закате|на\s+восходе|в\s+сумерках|в\s+предрассветных\s+сумерках|после\s+заката|до\s+рассвета)$",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:,\s*|\s+)(?:(?:около|примерно|где-?то\s+около|почти|уже|лишь|под)\s+)?(?:в\s*)?(?:полноч[ьи]|полдень|[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:час(?:а|ов)?|ночи|утра|дня|вечера))?$",
        re.IGNORECASE,
    ),
)


def _strip_story_location_time_suffix(value: str) -> str:
    normalized = " ".join(
        sanitize_likely_utf8_mojibake(value).replace("\r", " ").replace("\n", " ").split()
    ).strip(" .,:;!?…")
    previous = ""
    while normalized and normalized != previous:
        previous = normalized
        for pattern in STORY_LOCATION_TIME_TRAILING_PATTERNS:
            normalized = pattern.sub("", normalized).strip(" .,:;!?…")
    return normalized


def strip_story_location_time_context(value: str) -> str:
    normalized = " ".join(
        sanitize_likely_utf8_mojibake(value).replace("\r", " ").replace("\n", " ").split()
    ).strip()
    if not normalized:
        return ""

    matched_prefix = ""
    body = normalized
    for prefix in STORY_LOCATION_MEMORY_UI_PREFIXES:
        if body.casefold().startswith(prefix.casefold()):
            matched_prefix = prefix
            body = body[len(prefix) :].strip(" .,:;!?…")
            break

    cleaned_body = _strip_story_location_time_suffix(body)
    if not cleaned_body:
        cleaned_body = body.strip(" .,:;!?…")
    if not cleaned_body:
        return ""
    if matched_prefix:
        return f"{matched_prefix}{cleaned_body}."
    return cleaned_body


def normalize_story_memory_layer(value: str | None) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized in STORY_MEMORY_LAYERS:
        return normalized
    return STORY_MEMORY_LAYER_RAW


def normalize_story_memory_block_title(value: str, *, fallback: str = "Блок памяти") -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(value).split()).strip()
    if not normalized:
        normalized = fallback
    if len(normalized) > STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH:
        normalized = normalized[:STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH].rstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Memory block title cannot be empty")
    return normalized


def normalize_story_memory_block_content(value: str) -> str:
    normalized = sanitize_likely_utf8_mojibake(value).replace("\r\n", "\n").strip()
    if len(normalized) > STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH:
        normalized = normalized[-STORY_MEMORY_BLOCK_MAX_CONTENT_LENGTH :].lstrip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Memory block text cannot be empty")
    return normalized


def story_memory_block_to_out(block: StoryMemoryBlock) -> StoryMemoryBlockOut:
    def _replace_markup_with_names(value: str) -> str:
        def _replace_match(match: re.Match[str]) -> str:
            marker_key = str(match.group(1) or "").strip().upper()
            marker_name = " ".join(str(match.group(2) or "").split()).strip()
            if marker_key in {"NPC", "GG"}:
                return f"{marker_name}: " if marker_name else ""
            if marker_key in {"NPC_THOUGHT", "GG_THOUGHT"}:
                return f"{marker_name} (мысль): " if marker_name else "(мысль): "
            if marker_key == "NARRATOR":
                return ""
            return marker_name or ""

        return STORY_MEMORY_OUTPUT_NAMED_MARKUP_PATTERN.sub(
            _replace_match,
            sanitize_likely_utf8_mojibake(value),
        )

    layer_value = normalize_story_memory_layer(block.layer)
    normalized_title = sanitize_likely_utf8_mojibake(str(block.title or "")).strip()
    normalized_content = sanitize_likely_utf8_mojibake(str(block.content or ""))
    if layer_value in {
        STORY_MEMORY_LAYER_RAW,
        STORY_MEMORY_LAYER_COMPRESSED,
        STORY_MEMORY_LAYER_SUPER,
        STORY_MEMORY_LAYER_KEY,
    }:
        normalized_title = _replace_markup_with_names(normalized_title)
        normalized_title = STORY_MEMORY_OUTPUT_MARKUP_PATTERN.sub(" ", normalized_title)
        normalized_title = STORY_MEMORY_OUTPUT_DANGLING_MARKUP_PATTERN.sub(" ", normalized_title)
        normalized_title = " ".join(normalized_title.split()).strip() or normalized_title
        normalized_content = _replace_markup_with_names(normalized_content)
        normalized_content = STORY_MEMORY_OUTPUT_MARKUP_PATTERN.sub(" ", normalized_content)
        normalized_content = STORY_MEMORY_OUTPUT_DANGLING_MARKUP_PATTERN.sub(" ", normalized_content)
        normalized_content = re.sub(r"[ \t]+\n", "\n", normalized_content)
        normalized_content = re.sub(r"\n{3,}", "\n\n", normalized_content).strip()
    elif layer_value == STORY_MEMORY_LAYER_LOCATION:
        normalized_content = strip_story_location_time_context(normalized_content)

    return StoryMemoryBlockOut(
        id=block.id,
        game_id=block.game_id,
        assistant_message_id=block.assistant_message_id,
        layer=layer_value,
        title=normalized_title or str(block.title or ""),
        content=normalized_content or str(block.content or ""),
        token_count=max(int(getattr(block, "token_count", 0) or 0), 0),
        created_at=block.created_at,
        updated_at=block.updated_at,
    )


def extract_story_location_label_from_content(value: str | None) -> str:
    normalized = " ".join(
        sanitize_likely_utf8_mojibake(value).replace("\r", " ").replace("\n", " ").split()
    ).strip(" .,:;!?…")
    if not normalized:
        return ""
    normalized_casefold = normalized.casefold()
    for prefix in STORY_LOCATION_MEMORY_UI_PREFIXES:
        if normalized_casefold.startswith(prefix.casefold()):
            normalized = normalized[len(prefix) :].strip(" .,:;!?…")
            break
    normalized = _strip_story_location_time_suffix(normalized)
    if not normalized:
        return ""
    if len(normalized) > STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH:
        normalized = normalized[: STORY_MEMORY_BLOCK_MAX_TITLE_LENGTH - 1].rstrip(" ,;:-.!?…") + "…"
    if normalized and normalized[0].islower():
        normalized = normalized[:1].upper() + normalized[1:]
    return normalized


def resolve_story_current_location_label(
    current_location_label: str | None,
    memory_blocks: list[Any] | None = None,
) -> str | None:
    for block in reversed(list(memory_blocks or [])):
        if isinstance(block, dict):
            layer_value = normalize_story_memory_layer(str(block.get("layer") or ""))
            content_value = block.get("content")
        else:
            layer_value = normalize_story_memory_layer(str(getattr(block, "layer", "") or ""))
            content_value = getattr(block, "content", "")
        if layer_value != STORY_MEMORY_LAYER_LOCATION:
            continue
        normalized_location_label = extract_story_location_label_from_content(str(content_value or ""))
        if normalized_location_label:
            return normalized_location_label

    normalized_current_location_label = extract_story_location_label_from_content(current_location_label)
    if normalized_current_location_label:
        return normalized_current_location_label

    return None
