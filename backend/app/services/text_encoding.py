from __future__ import annotations

import re
from typing import Any

_MOJIBAKE_MARKER_PATTERN = re.compile(
    "(?:"
    "\u0420[\u0400-\u04ff\u2010-\u203f\u2116]"
    "|"
    "\u0421[\u0400-\u04ff\u2010-\u203f\u2116]"
    "|"
    "\u0432\u0402"
    "|"
    "\u0412\u00b7"
    "|"
    "\u00d0"
    "|"
    "\u00d1"
    "|"
    "\u00c2"
    "|"
    "\u00c3"
    "|"
    "\u00e2"
    ")"
)


def _mojibake_marker_score(value: str) -> int:
    return len(_MOJIBAKE_MARKER_PATTERN.findall(value))


def is_likely_utf8_mojibake(value: str | None) -> bool:
    normalized = str(value or "").strip()
    if len(normalized) < 4:
        return False
    return _mojibake_marker_score(normalized) >= 2


def _decode_utf8_mojibake_candidate(value: str, *, source_encoding: str) -> str | None:
    try:
        return value.encode(source_encoding).decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None


def repair_likely_utf8_mojibake(value: str | None) -> str:
    current_value = str(value or "")
    if not current_value or not is_likely_utf8_mojibake(current_value):
        return current_value

    for _ in range(4):
        original_marker_score = _mojibake_marker_score(current_value)
        if original_marker_score <= 0:
            break

        best_candidate = current_value
        best_marker_score = original_marker_score

        for source_encoding in ("cp1251", "latin1"):
            candidate = _decode_utf8_mojibake_candidate(current_value, source_encoding=source_encoding)
            if not candidate or "\ufffd" in candidate:
                continue
            candidate_marker_score = _mojibake_marker_score(candidate)
            if candidate_marker_score >= best_marker_score:
                continue
            best_candidate = candidate
            best_marker_score = candidate_marker_score

        if best_candidate == current_value:
            break
        current_value = best_candidate

    return current_value


def strip_unserializable_unicode(value: str | None) -> str:
    current_value = str(value or "")
    if not current_value:
        return ""
    return current_value.encode("utf-8", errors="ignore").decode("utf-8")


def sanitize_likely_utf8_mojibake(value: str | None) -> str:
    return strip_unserializable_unicode(repair_likely_utf8_mojibake(value))


def repair_likely_utf8_mojibake_deep(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_likely_utf8_mojibake(value)
    if isinstance(value, list):
        return [repair_likely_utf8_mojibake_deep(item) for item in value]
    if isinstance(value, tuple):
        return tuple(repair_likely_utf8_mojibake_deep(item) for item in value)
    if isinstance(value, dict):
        return {
            repair_likely_utf8_mojibake_deep(key) if isinstance(key, str) else key: repair_likely_utf8_mojibake_deep(item)
            for key, item in value.items()
        }
    return value
