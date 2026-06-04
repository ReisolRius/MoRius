from __future__ import annotations

from datetime import datetime
import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import AppSetting


MAINTENANCE_SETTINGS_KEY = "maintenance_page"
DEFAULT_MAINTENANCE_TITLE = "Извините, идут технические работы"
DEFAULT_MAINTENANCE_MESSAGE = (
    "Мы обновляем MoRius и проверяем важные системы. "
    "Скоро сайт снова будет доступен, а ваши миры, истории и прогресс останутся на месте."
)
DEFAULT_MAINTENANCE_ETA_LABEL = "Ориентировочно скоро вернемся"


def _normalize_text(value: Any, *, fallback: str, max_length: int) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        normalized = fallback
    return normalized[:max_length]


def _normalize_multiline_text(value: Any, *, fallback: str, max_length: int) -> str:
    raw_value = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines = [" ".join(line.split()).strip() for line in raw_value.split("\n")]
    normalized = "\n".join(normalized_lines).strip()
    if not normalized:
        normalized = fallback
    return normalized[:max_length]


def _load_payload(raw_value: str | None) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def normalize_maintenance_settings(
    value: dict[str, Any] | None,
    *,
    updated_at: datetime | None = None,
) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    return {
        "enabled": bool(payload.get("enabled")),
        "title": _normalize_text(
            payload.get("title"),
            fallback=DEFAULT_MAINTENANCE_TITLE,
            max_length=140,
        ),
        "message": _normalize_multiline_text(
            payload.get("message"),
            fallback=DEFAULT_MAINTENANCE_MESSAGE,
            max_length=2_000,
        ),
        "eta_label": _normalize_text(
            payload.get("eta_label"),
            fallback=DEFAULT_MAINTENANCE_ETA_LABEL,
            max_length=120,
        ),
        "updated_at": updated_at,
    }


def read_maintenance_settings(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, MAINTENANCE_SETTINGS_KEY)
    if row is None:
        return normalize_maintenance_settings(None)
    return normalize_maintenance_settings(
        _load_payload(row.value),
        updated_at=getattr(row, "updated_at", None),
    )


def write_maintenance_settings(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    current = read_maintenance_settings(db)
    next_settings = normalize_maintenance_settings(
        {
            "enabled": payload.get("enabled", current["enabled"]),
            "title": payload.get("title", current["title"]),
            "message": payload.get("message", current["message"]),
            "eta_label": payload.get("eta_label", current["eta_label"]),
        }
    )

    row = db.get(AppSetting, MAINTENANCE_SETTINGS_KEY)
    if row is None:
        row = AppSetting(key=MAINTENANCE_SETTINGS_KEY)
        db.add(row)
    row.value = json.dumps(
        {
            "enabled": next_settings["enabled"],
            "title": next_settings["title"],
            "message": next_settings["message"],
            "eta_label": next_settings["eta_label"],
        },
        ensure_ascii=False,
    )
    db.commit()
    db.refresh(row)
    return read_maintenance_settings(db)
