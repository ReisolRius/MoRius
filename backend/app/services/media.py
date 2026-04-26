from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from typing import Any

from fastapi import HTTPException, status

from app.config import settings

ALLOWED_AVATAR_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MEDIA_TOKEN_VERSION = "v1"
MEDIA_TOKEN_SEPARATOR = "."
MEDIA_URL_PREFIX = "/api/media/"
REMOTE_MEDIA_PROXY_HOST_SUFFIXES = (
    "googleusercontent.com",
    "ggpht.com",
)


def _ensure_media_vendor_dir_on_path() -> None:
    vendor_dir = Path(__file__).resolve().parents[1] / ".vendor"
    if not vendor_dir.exists():
        return
    vendor_dir_str = str(vendor_dir)
    if vendor_dir_str not in sys.path:
        sys.path.insert(0, vendor_dir_str)


def _load_pillow_modules() -> tuple[Any, Any, Any] | None:
    try:
        _ensure_media_vendor_dir_on_path()
        from PIL import Image, ImageFilter, ImageOps
    except Exception:
        return None
    return Image, ImageFilter, ImageOps


def normalize_avatar_value(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    cleaned = raw_value.strip()
    if not cleaned:
        return None
    return cleaned


def normalize_proxyable_remote_media_url(raw_value: str | None) -> str | None:
    normalized_value = normalize_avatar_value(raw_value)
    if normalized_value is None:
        return None
    if not normalized_value.startswith(("https://", "http://")):
        return None
    try:
        parsed = urlparse(normalized_value)
    except ValueError:
        return None
    hostname = str(parsed.hostname or "").strip().lower()
    if not hostname:
        return None
    if not any(hostname == suffix or hostname.endswith(f".{suffix}") for suffix in REMOTE_MEDIA_PROXY_HOST_SUFFIXES):
        return None
    normalized_scheme = "https" if parsed.scheme.lower() == "http" else parsed.scheme.lower()
    if normalized_scheme not in {"http", "https"}:
        return None
    return urlunparse(parsed._replace(scheme=normalized_scheme))


def _encode_media_token_part(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_media_token_part(payload: str) -> bytes | None:
    normalized_payload = str(payload or "").strip()
    if not normalized_payload:
        return None
    padding = "=" * (-len(normalized_payload) % 4)
    try:
        return base64.urlsafe_b64decode(normalized_payload + padding)
    except (ValueError, binascii.Error):
        return None


def normalize_media_cache_version(raw_value: Any) -> str:
    if isinstance(raw_value, datetime):
        if raw_value.tzinfo is None:
            normalized_datetime = raw_value.replace(tzinfo=timezone.utc)
        else:
            normalized_datetime = raw_value.astimezone(timezone.utc)
        return normalized_datetime.isoformat(timespec="microseconds").replace("+00:00", "Z")

    normalized_value = str(raw_value or "").strip()
    if not normalized_value:
        return "0"
    return normalized_value[:160]


def _normalize_media_token_payload_extra(extra: dict[str, Any]) -> dict[str, Any]:
    normalized_extra: dict[str, Any] = {}
    for key in sorted(extra):
        normalized_key = str(key or "").strip()
        if not normalized_key.replace("_", "").isalnum():
            continue
        raw_value = extra[key]
        if raw_value is None:
            continue
        if isinstance(raw_value, bool):
            normalized_extra[normalized_key] = raw_value
            continue
        if isinstance(raw_value, int):
            normalized_extra[normalized_key] = int(raw_value)
            continue
        if isinstance(raw_value, float):
            if math.isfinite(raw_value):
                normalized_extra[normalized_key] = raw_value
            continue
        normalized_value = str(raw_value).strip()
        if not normalized_value:
            continue
        normalized_extra[normalized_key] = normalized_value[:160]
    return normalized_extra


def _sign_media_token_payload(payload: bytes) -> bytes:
    secret = settings.jwt_secret_key.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).digest()[:24]


def build_media_token(
    *,
    kind: str,
    entity_id: int,
    version: Any,
    **extra: Any,
) -> str:
    payload: dict[str, Any] = {
        "v": MEDIA_TOKEN_VERSION,
        "kind": str(kind or "").strip(),
        "entity_id": max(int(entity_id), 0),
        "version": normalize_media_cache_version(version),
    }
    payload.update(_normalize_media_token_payload_extra(extra))
    payload_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature_bytes = _sign_media_token_payload(payload_bytes)
    return (
        f"{_encode_media_token_part(payload_bytes)}"
        f"{MEDIA_TOKEN_SEPARATOR}"
        f"{_encode_media_token_part(signature_bytes)}"
    )


def parse_media_token(token: str) -> dict[str, Any] | None:
    normalized_token = str(token or "").strip()
    if not normalized_token or MEDIA_TOKEN_SEPARATOR not in normalized_token:
        return None

    payload_part, signature_part = normalized_token.split(MEDIA_TOKEN_SEPARATOR, maxsplit=1)
    payload_bytes = _decode_media_token_part(payload_part)
    signature_bytes = _decode_media_token_part(signature_part)
    if payload_bytes is None or signature_bytes is None:
        return None
    if not hmac.compare_digest(_sign_media_token_payload(payload_bytes), signature_bytes):
        return None

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None

    if str(payload.get("v") or "") != MEDIA_TOKEN_VERSION:
        return None
    kind = str(payload.get("kind") or "").strip()
    if not kind:
        return None
    try:
        entity_id = int(payload.get("entity_id"))
    except (TypeError, ValueError):
        return None
    version = normalize_media_cache_version(payload.get("version"))
    normalized_payload: dict[str, Any] = {
        "kind": kind,
        "entity_id": entity_id,
        "version": version,
    }
    for key, raw_value in payload.items():
        if key in {"v", "kind", "entity_id", "version"}:
            continue
        normalized_key = str(key or "").strip()
        if not normalized_key.replace("_", "").isalnum():
            continue
        normalized_payload[normalized_key] = raw_value
    return normalized_payload


def _load_media_storage_source_value(db: Any, payload: dict[str, Any]) -> Any | None:
    kind = str(payload.get("kind") or "").strip()
    entity_id_raw = payload.get("entity_id")
    try:
        entity_id = int(entity_id_raw)
    except (TypeError, ValueError):
        return None

    from app.models import StoryCharacter, StoryGame, StoryTurnImage, StoryWorldCard, StoryWorldCardTemplate, User
    from app.services.story_emotions import deserialize_story_character_emotion_assets

    media_kind_specs: dict[str, tuple[type[Any], Any]] = {
        "user-avatar": (User, lambda record, _: getattr(record, "avatar_url", None)),
        "story-game-cover": (StoryGame, lambda record, _: getattr(record, "cover_image_url", None)),
        "story-character-avatar": (StoryCharacter, lambda record, _: getattr(record, "avatar_url", None)),
        "story-character-avatar-original": (StoryCharacter, lambda record, _: getattr(record, "avatar_original_url", None)),
        "story-character-emotion-asset": (
            StoryCharacter,
            lambda record, source_payload: deserialize_story_character_emotion_assets(
                getattr(record, "emotion_assets", None)
            ).get(str(source_payload.get("asset_id") or "").strip()),
        ),
        "story-world-card-avatar": (StoryWorldCard, lambda record, _: getattr(record, "avatar_url", None)),
        "story-world-card-avatar-original": (
            StoryWorldCard,
            lambda record, _: getattr(record, "avatar_original_url", None),
        ),
        "story-world-card-template-avatar": (
            StoryWorldCardTemplate,
            lambda record, _: getattr(record, "avatar_url", None),
        ),
        "story-world-card-template-avatar-original": (
            StoryWorldCardTemplate,
            lambda record, _: getattr(record, "avatar_original_url", None),
        ),
        "story-turn-image-url": (StoryTurnImage, lambda record, _: getattr(record, "image_url", None)),
        "story-turn-image-data": (StoryTurnImage, lambda record, _: getattr(record, "image_data_url", None)),
    }

    spec = media_kind_specs.get(kind)
    if spec is None:
        return None

    model_class, value_getter = spec
    record = db.get(model_class, entity_id)
    if record is None:
        return None
    return value_getter(record, payload)


def resolve_media_storage_value(
    db: Any,
    raw_value: str | None,
    *,
    max_depth: int = 6,
    visited_tokens: set[str] | None = None,
) -> str | None:
    normalized_value = normalize_avatar_value(raw_value)
    if normalized_value is None:
        return None
    if not normalized_value.startswith(MEDIA_URL_PREFIX):
        return normalized_value
    if max_depth <= 0:
        return normalized_value

    token = normalized_value[len(MEDIA_URL_PREFIX) :].strip()
    if not token:
        return normalized_value

    known_tokens = visited_tokens or set()
    if token in known_tokens:
        return normalized_value
    known_tokens.add(token)

    payload = parse_media_token(token)
    if payload is None:
        return normalized_value

    nested_value = _load_media_storage_source_value(db, payload)
    if nested_value is None:
        return normalized_value

    resolved_value = resolve_media_storage_value(
        db,
        nested_value,
        max_depth=max_depth - 1,
        visited_tokens=known_tokens,
    )
    return normalize_avatar_value(resolved_value) or normalized_value


def build_media_display_url(
    *,
    kind: str,
    entity_id: int,
    version: Any,
    **extra: Any,
) -> str:
    token = build_media_token(
        kind=kind,
        entity_id=entity_id,
        version=version,
        **extra,
    )
    return f"{MEDIA_URL_PREFIX}{token}"


def resolve_media_display_url(
    raw_value: str | None,
    *,
    kind: str,
    entity_id: int,
    version: Any,
    **extra: Any,
) -> str | None:
    normalized_value = normalize_avatar_value(raw_value)
    if normalized_value is None:
        return None
    if normalized_value.startswith("data:"):
        return build_media_display_url(
            kind=kind,
            entity_id=entity_id,
            version=version,
            **extra,
        )
    normalized_remote_url = normalize_proxyable_remote_media_url(normalized_value)
    if normalized_remote_url is not None:
        return normalized_remote_url
    return normalized_value


def normalize_media_scale(
    raw_value: float | int | str | None,
    *,
    default: float,
    min_value: float,
    max_value: float,
) -> float:
    if raw_value is None:
        return default
    try:
        numeric = float(raw_value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(numeric):
        return default
    return round(min(max(numeric, min_value), max_value), 2)


def normalize_media_position(
    raw_value: float | int | str | None,
    *,
    default: float,
    min_value: float,
    max_value: float,
) -> float:
    return normalize_media_scale(
        raw_value,
        default=default,
        min_value=min_value,
        max_value=max_value,
    )


def decode_media_data_url(data_url: str | None) -> tuple[str, bytes] | None:
    normalized_value = normalize_avatar_value(data_url)
    if normalized_value is None or not normalized_value.startswith("data:"):
        return None
    if "," not in normalized_value:
        return None

    header, payload = normalized_value.split(",", maxsplit=1)
    if ";base64" not in header:
        return None

    mime_type = header[len("data:") :].split(";", maxsplit=1)[0].lower()
    if mime_type not in ALLOWED_AVATAR_MIME_TYPES:
        return None

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error):
        return None
    return mime_type, raw_bytes


def validate_avatar_url(avatar_url: str, *, max_bytes: int | None = None) -> str:
    if avatar_url.startswith(MEDIA_URL_PREFIX):
        return avatar_url

    if avatar_url.startswith(("https://", "http://")):
        if len(avatar_url) > 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Avatar URL is too long",
            )
        return avatar_url

    if not avatar_url.startswith("data:"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar must be an absolute URL or data URL",
        )

    if "," not in avatar_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar data URL is malformed",
        )

    header, payload = avatar_url.split(",", maxsplit=1)
    if ";base64" not in header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar data URL must be base64 encoded",
        )

    mime_type = header[len("data:") :].split(";", maxsplit=1)[0].lower()
    if mime_type not in ALLOWED_AVATAR_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG, JPEG, WEBP or GIF avatars are supported",
        )

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar payload is not valid base64",
        ) from exc

    if max_bytes is None:
        max_allowed_bytes: int | None = max(1, settings.avatar_max_bytes)
    elif max_bytes <= 0:
        max_allowed_bytes = None
    else:
        max_allowed_bytes = max(1, max_bytes)

    if max_allowed_bytes is not None and len(raw_bytes) > max_allowed_bytes:
        if max_allowed_bytes < 1024 * 1024:
            max_kb = max_allowed_bytes / 1024
            detail = f"Avatar is too large. Max size is {max_kb:.0f} KB"
        else:
            max_mb = max_allowed_bytes / (1024 * 1024)
            detail = f"Avatar is too large. Max size is {max_mb:.1f} MB"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )

    return avatar_url
