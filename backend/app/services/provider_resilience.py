from __future__ import annotations

import re
from typing import Any


TRANSIENT_HTTP_STATUS_CODES = {408, 409, 425, 429, 499, 500, 502, 503, 504}

_CONTENT_POLICY_MARKERS = (
    "prohibited request",
    "request is prohibited",
    "content policy",
    "policy violation",
    "safety policy",
    "blocked by safety",
    "blocked for safety",
    "content_filter",
    "content filter",
    "moderation block",
    "moderation blocked",
    "unsafe content",
)

_NON_RETRYABLE_REQUEST_MARKERS = (
    "maximum context length",
    "context length exceeded",
    "context window exceeded",
    "invalid api key",
    "unauthorized",
    "authentication failed",
    "insufficient balance",
    "not enough credits",
    "unsupported model",
    "model is not supported",
    "invalid request",
)

_TRANSIENT_ERROR_MARKERS = (
    "timed out",
    "timeout",
    "connection reset",
    "connection aborted",
    "connection error",
    "failed to reach",
    "failed while reading",
    "stream ended incomplete",
    "stream ended unexpectedly",
    "stream closed unexpectedly",
    "completed without textual content",
    "empty response",
    "empty payload",
    "no usable image",
    "returned no image",
    "internal server error",
    "provider returned error",
    "server_error",
    "upstream",
    "temporarily unavailable",
    "rate limit",
    "rate-limit",
    "too many requests",
    "gateway",
)


def normalize_provider_error_detail(value: Any) -> str:
    return " ".join(str(value or "").replace("\r\n", "\n").split()).strip()


def is_content_policy_error(value: Any) -> bool:
    normalized = normalize_provider_error_detail(value).casefold()
    return bool(normalized) and any(marker in normalized for marker in _CONTENT_POLICY_MARKERS)


def extract_http_status_code(value: Any) -> int | None:
    normalized = normalize_provider_error_detail(value)
    if not normalized:
        return None
    matches = re.findall(r"\b([1-5]\d{2})\b", normalized)
    for raw_status in matches:
        status_code = int(raw_status)
        if status_code in TRANSIENT_HTTP_STATUS_CODES or status_code in {400, 401, 403, 404, 422}:
            return status_code
    return None


def is_retryable_provider_error(value: Any, *, status_code: int | None = None) -> bool:
    normalized = normalize_provider_error_detail(value).casefold()
    if is_content_policy_error(normalized):
        return False
    if any(marker in normalized for marker in _NON_RETRYABLE_REQUEST_MARKERS):
        return False
    resolved_status = status_code if status_code is not None else extract_http_status_code(normalized)
    if resolved_status in TRANSIENT_HTTP_STATUS_CODES:
        return True
    return any(marker in normalized for marker in _TRANSIENT_ERROR_MARKERS)
