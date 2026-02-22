from __future__ import annotations

import base64
import binascii
import math

from fastapi import HTTPException, status

from app.config import settings

ALLOWED_AVATAR_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def normalize_avatar_value(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    cleaned = raw_value.strip()
    if not cleaned:
        return None
    return cleaned


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


def validate_avatar_url(avatar_url: str, *, max_bytes: int | None = None) -> str:
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

    max_allowed_bytes = max(1, max_bytes if max_bytes is not None else settings.avatar_max_bytes)
    if len(raw_bytes) > max_allowed_bytes:
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

