from __future__ import annotations

from collections.abc import Callable
from typing import Any
import requests

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryCharacter, StoryGame, StoryTurnImage, StoryWorldCard, User
from app.services.story_emotions import deserialize_story_character_emotion_assets
from app.services.media import (
    MEDIA_URL_PREFIX,
    decode_media_data_url,
    normalize_media_cache_version,
    normalize_proxyable_remote_media_url,
    parse_media_token,
)

router = APIRouter()
REMOTE_MEDIA_TIMEOUT_SECONDS = (3.05, 8.0)
REMOTE_MEDIA_MAX_BYTES = 5 * 1024 * 1024

MEDIA_KIND_SPECS: dict[str, tuple[type[Any], Callable[[Any, dict[str, Any]], Any], Callable[[Any], Any]]] = {
    "user-avatar": (
        User,
        lambda record, _: getattr(record, "avatar_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-game-cover": (
        StoryGame,
        lambda record, _: getattr(record, "cover_image_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-character-avatar": (
        StoryCharacter,
        lambda record, _: getattr(record, "avatar_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-character-avatar-original": (
        StoryCharacter,
        lambda record, _: getattr(record, "avatar_original_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-character-emotion-asset": (
        StoryCharacter,
        lambda record, payload: deserialize_story_character_emotion_assets(
            getattr(record, "emotion_assets", None)
        ).get(str(payload.get("asset_id") or "").strip()),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-world-card-avatar": (
        StoryWorldCard,
        lambda record, _: getattr(record, "avatar_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-world-card-avatar-original": (
        StoryWorldCard,
        lambda record, _: getattr(record, "avatar_original_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-turn-image-url": (
        StoryTurnImage,
        lambda record, _: getattr(record, "image_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
    "story-turn-image-data": (
        StoryTurnImage,
        lambda record, _: getattr(record, "image_data_url", None),
        lambda record: getattr(record, "updated_at", None),
    ),
}


def _fetch_remote_media_payload(raw_value: str | None) -> tuple[str, bytes] | None:
    normalized_remote_url = normalize_proxyable_remote_media_url(raw_value)
    if normalized_remote_url is None:
        return None
    try:
        response = requests.get(
            normalized_remote_url,
            timeout=REMOTE_MEDIA_TIMEOUT_SECONDS,
            stream=True,
            allow_redirects=True,
            headers={"User-Agent": "MoRius Media Proxy/1.0"},
        )
    except requests.RequestException:
        return None

    with response:
        if not response.ok:
            return None
        content_type = str(response.headers.get("Content-Type") or "").split(";", maxsplit=1)[0].strip().lower()
        if not content_type.startswith("image/"):
            return None
        content_length_header = str(response.headers.get("Content-Length") or "").strip()
        if content_length_header:
            try:
                if int(content_length_header) > REMOTE_MEDIA_MAX_BYTES:
                    return None
            except ValueError:
                pass

        payload_chunks: list[bytes] = []
        total_bytes = 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total_bytes += len(chunk)
                if total_bytes > REMOTE_MEDIA_MAX_BYTES:
                    return None
                payload_chunks.append(chunk)
        except requests.RequestException:
            return None
        if not payload_chunks:
            return None
        return content_type, b"".join(payload_chunks)


def _load_media_source_value_from_payload(db: Session, payload: dict[str, Any]) -> Any | None:
    kind = str(payload.get("kind") or "").strip()
    entity_id_raw = payload.get("entity_id")
    try:
        entity_id = int(entity_id_raw)
    except (TypeError, ValueError):
        return None

    spec = MEDIA_KIND_SPECS.get(kind)
    if spec is None:
        return None

    model_class, value_getter, _ = spec
    record = db.get(model_class, entity_id)
    if record is None:
        return None
    return value_getter(record, payload)


def _resolve_nested_media_source_value(
    db: Session,
    raw_value: Any,
    *,
    max_depth: int = 4,
    visited_tokens: set[str] | None = None,
) -> str | None:
    normalized_value = str(raw_value or "").strip() if isinstance(raw_value, str) else None
    if normalized_value is None:
        return None
    if not normalized_value.startswith(MEDIA_URL_PREFIX):
        return normalized_value or None
    if max_depth <= 0:
        return None

    token = normalized_value[len(MEDIA_URL_PREFIX) :].strip()
    if not token:
        return None

    known_tokens = visited_tokens or set()
    if token in known_tokens:
        return None
    known_tokens.add(token)

    payload = parse_media_token(token)
    if payload is None:
        return None

    nested_source_value = _load_media_source_value_from_payload(db, payload)
    return _resolve_nested_media_source_value(
        db,
        nested_source_value,
        max_depth=max_depth - 1,
        visited_tokens=known_tokens,
    )


@router.get("/api/media/{token}")
def get_media_asset(
    token: str,
    db: Session = Depends(get_db),
) -> Response:
    payload = parse_media_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    kind = str(payload["kind"])
    entity_id = int(payload["entity_id"])
    expected_version = str(payload["version"])

    spec = MEDIA_KIND_SPECS.get(kind)
    if spec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    model_class, value_getter, version_getter = spec
    record = db.get(model_class, entity_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    current_version = normalize_media_cache_version(version_getter(record))
    if current_version != expected_version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")

    source_value = _resolve_nested_media_source_value(db, value_getter(record, payload))
    media_payload = decode_media_data_url(source_value)
    if media_payload is None:
        media_payload = _fetch_remote_media_payload(source_value)
    if media_payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    mime_type, raw_bytes = media_payload

    return Response(
        content=raw_bytes,
        media_type=mime_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Encoding": "identity",
            "Content-Length": str(len(raw_bytes)),
            "X-Content-Type-Options": "nosniff",
        },
    )
