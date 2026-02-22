from __future__ import annotations

from fastapi import HTTPException, status


def normalize_story_text(value: str) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story text cannot be empty")
    return normalized
