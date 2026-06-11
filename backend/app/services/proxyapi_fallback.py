from __future__ import annotations

import re
from typing import Any

import requests

from app.config import settings


class ProxyApiFallbackError(RuntimeError):
    pass


TEXT_MODEL_ALIASES: dict[str, str] = {
    "deepseek/deepseek-chat-v3-0324": "deepseek/deepseek-chat",
    "__legacy_removed__/story-model-2": "z-ai/glm-5",
}

TEXT_MODEL_FALLBACKS: dict[str, list[str]] = {
    "*": ["deepseek/deepseek-chat", "z-ai/glm-5"],
}

IMAGE_MODEL_ALIASES: dict[str, str] = {
    "flux.2-pro": "black-forest-labs/flux.2-pro",
    "black-forest-labs/flux.2-pro": "black-forest-labs/flux.2-pro",
    "flux.2-klein-4b": "black-forest-labs/flux.2-klein-4b",
    "black-forest-labs/flux.2-klein-4b": "black-forest-labs/flux.2-klein-4b",
    "seedream-4.5": "bytedance-seed/seedream-4.5",
    "bytedance/seedream-4.5": "bytedance-seed/seedream-4.5",
    "bytedance-seed/seedream-4.5": "bytedance-seed/seedream-4.5",
    "google/gemini-2.5-flash-image": "google/gemini-2.5-flash-image-preview",
    "google/gemini-2.5-flash-image-preview": "google/gemini-2.5-flash-image-preview",
    "google/gemini-3.1-flash-image-preview": "google/gemini-3.1-flash-image-preview",
    "qwen-image-edit": "qwen/qwen-image-edit",
    "qwen/qwen-image-edit": "qwen/qwen-image-edit",
}

IMAGE_MODEL_FALLBACKS: dict[str, list[str]] = {
    "black-forest-labs/flux.2-pro": ["black-forest-labs/flux.2-pro:free"],
}


def is_configured() -> bool:
    return bool(str(settings.proxyapi_key or "").strip())


def _chat_completions_url() -> str:
    base_url = str(settings.proxyapi_base_openrouter or "").strip().rstrip("/")
    if not base_url:
        base_url = "https://api.proxyapi.ru/openrouter/v1"
    return f"{base_url}/chat/completions"


def _headers() -> dict[str, str]:
    api_key = str(settings.proxyapi_key or "").strip()
    if not api_key:
        raise ProxyApiFallbackError("ProxyAPI fallback is not configured: set PROXYAPI_KEY")
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _extract_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip()[:500]
    if not isinstance(payload, dict):
        return ""
    error_value = payload.get("error")
    if isinstance(error_value, dict):
        detail = str(error_value.get("message") or error_value.get("code") or "").strip()
        metadata = error_value.get("metadata")
        if isinstance(metadata, dict):
            raw_detail = str(metadata.get("raw") or metadata.get("message") or "").strip()
            if raw_detail:
                detail = f"{detail}. {raw_detail}" if detail else raw_detail
        return detail
    if isinstance(error_value, str):
        return error_value.strip()
    return str(payload.get("message") or payload.get("detail") or "").strip()


def _raise_for_status(response: requests.Response, *, route: str, model_name: str) -> None:
    if response.status_code < 400:
        return
    detail = _extract_error_detail(response)
    if response.status_code in {401, 403}:
        message = "ProxyAPI key is invalid or lacks access"
    elif response.status_code == 404:
        message = "Model is not available through ProxyAPI OpenRouter route"
    elif response.status_code == 429:
        message = "ProxyAPI rate limit or quota exceeded"
    elif response.status_code >= 500:
        message = "ProxyAPI/OpenRouter upstream error"
    else:
        message = f"ProxyAPI request failed ({response.status_code})"
    if detail:
        message = f"{message}: {detail}"
    raise ProxyApiFallbackError(f"{message} [route={route} model={model_name}]")


def _extract_text_from_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                if item:
                    parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text_value = (
                item.get("text")
                or item.get("content")
                or item.get("output_text")
                or item.get("value")
                or ""
            )
            if isinstance(text_value, str) and text_value:
                parts.append(text_value)
        return "".join(parts)
    if isinstance(value, dict):
        text_value = (
            value.get("text")
            or value.get("content")
            or value.get("output_text")
            or value.get("value")
            or ""
        )
        return text_value if isinstance(text_value, str) else ""
    return ""


def _extract_text_response(payload_value: Any) -> str:
    if not isinstance(payload_value, dict):
        return ""
    choices = payload_value.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message_value = choice.get("message")
            if isinstance(message_value, dict):
                text = _extract_text_from_content(message_value.get("content"))
                if text:
                    return text
            delta_value = choice.get("delta")
            if isinstance(delta_value, dict):
                text = _extract_text_from_content(delta_value.get("content"))
                if text:
                    return text
            text = _extract_text_from_content(choice.get("text"))
            if text:
                return text
    return _extract_text_from_content(payload_value.get("content") or payload_value.get("text"))


def _candidate_models(model_name: str | None, aliases: dict[str, str], fallbacks: dict[str, list[str]] | None = None) -> list[str]:
    normalized = str(model_name or "").strip()
    resolved = aliases.get(normalized, normalized)
    candidates: list[str] = []
    for candidate in (resolved, normalized):
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    if fallbacks is not None:
        for fallback_model in fallbacks.get(resolved, []):
            if fallback_model and fallback_model not in candidates:
                candidates.append(fallback_model)
        for fallback_model in fallbacks.get("*", []):
            if fallback_model and fallback_model not in candidates:
                candidates.append(fallback_model)
    return candidates


def request_text(
    *,
    messages: list[dict[str, Any]],
    model_name: str | None,
    temperature: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    http_session: requests.Session | None = None,
    timeout: tuple[int, int] = (20, 180),
) -> dict[str, Any]:
    candidates = _candidate_models(model_name, TEXT_MODEL_ALIASES, TEXT_MODEL_FALLBACKS)
    if not candidates:
        raise ProxyApiFallbackError("ProxyAPI text model is not configured")

    session = http_session or requests.Session()
    headers = _headers()
    url = _chat_completions_url()
    last_error: Exception | None = None
    for candidate_model in candidates:
        payload: dict[str, Any] = {
            "model": candidate_model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if frequency_penalty is not None:
            payload["frequency_penalty"] = frequency_penalty
        if presence_penalty is not None:
            payload["presence_penalty"] = presence_penalty
        if top_k is not None and int(top_k) > 0:
            payload["top_k"] = int(top_k)
        if top_p is not None:
            payload["top_p"] = top_p
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)

        try:
            response = session.post(url, headers=headers, json=payload, timeout=timeout)
            _raise_for_status(response, route="proxyapi_openrouter", model_name=candidate_model)
            try:
                payload_value = response.json()
            except ValueError as exc:
                raise ProxyApiFallbackError("ProxyAPI text fallback returned invalid JSON") from exc
            text = _extract_text_response(payload_value).strip()
            if not text:
                raise ProxyApiFallbackError("ProxyAPI text fallback returned empty response")
            return {
                "model": str(payload_value.get("model") or candidate_model) if isinstance(payload_value, dict) else candidate_model,
                "text": text,
                "usage": payload_value.get("usage") if isinstance(payload_value, dict) else None,
            }
        except (ProxyApiFallbackError, requests.RequestException) as exc:
            last_error = exc
            continue

    raise ProxyApiFallbackError(str(last_error or "ProxyAPI text fallback failed"))


def _append_image_candidate(image_candidates: list[str], raw_value: Any) -> None:
    if raw_value is None:
        return
    if isinstance(raw_value, list):
        for item in raw_value:
            _append_image_candidate(image_candidates, item)
        return
    if isinstance(raw_value, dict):
        raw_b64_payload = str(
            raw_value.get("b64_json")
            or raw_value.get("image_base64")
            or raw_value.get("base64")
            or ""
        ).strip()
        if raw_b64_payload:
            b64_payload = re.sub(r"\s+", "", raw_b64_payload)
            raw_mime_type = str(
                raw_value.get("mime_type")
                or raw_value.get("mimeType")
                or raw_value.get("format")
                or "image/png"
            ).strip().lower()
            mime_type = raw_mime_type if "/" in raw_mime_type else f"image/{raw_mime_type}"
            image_candidates.append(f"data:{mime_type};base64,{b64_payload}")
        for nested_key in ("url", "image_url", "imageUrl", "data_url", "dataUrl", "src"):
            nested_value = raw_value.get(nested_key)
            if nested_value is not None:
                _append_image_candidate(image_candidates, nested_value)
        return
    candidate = str(raw_value or "").strip()
    if candidate:
        image_candidates.append(candidate)


def _parse_image_response(payload_value: Any, *, selected_model: str) -> dict[str, str | None]:
    if not isinstance(payload_value, dict):
        raise ProxyApiFallbackError("ProxyAPI image fallback returned empty payload")

    image_candidates: list[str] = []
    revised_prompt: str | None = None

    data_items = payload_value.get("data")
    if isinstance(data_items, list):
        _append_image_candidate(image_candidates, data_items)

    choices = payload_value.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = message_value.get("content")
                text_value = _extract_text_from_content(content_value).strip()
                if text_value:
                    revised_prompt = text_value
                if isinstance(content_value, list):
                    for part in content_value:
                        if isinstance(part, dict):
                            _append_image_candidate(image_candidates, part)
                _append_image_candidate(image_candidates, message_value.get("images"))
                _append_image_candidate(image_candidates, message_value.get("image_url"))
                _append_image_candidate(image_candidates, message_value.get("imageUrl"))
                _append_image_candidate(image_candidates, message_value.get("url"))
                _append_image_candidate(image_candidates, message_value.get("data_url"))
                _append_image_candidate(image_candidates, message_value.get("dataUrl"))
            _append_image_candidate(image_candidates, choice.get("image_url"))
            _append_image_candidate(image_candidates, choice.get("imageUrl"))
            _append_image_candidate(image_candidates, choice.get("url"))
            _append_image_candidate(image_candidates, choice.get("data_url"))
            _append_image_candidate(image_candidates, choice.get("dataUrl"))

    _append_image_candidate(image_candidates, payload_value.get("image_url"))
    _append_image_candidate(image_candidates, payload_value.get("imageUrl"))
    _append_image_candidate(image_candidates, payload_value.get("url"))
    _append_image_candidate(image_candidates, payload_value.get("data_url"))
    _append_image_candidate(image_candidates, payload_value.get("dataUrl"))

    image_data_url = next(
        (value for value in image_candidates if value.lower().startswith("data:image/")),
        None,
    )
    image_url = next(
        (value for value in image_candidates if value and not value.lower().startswith("data:image/")),
        None,
    )
    if image_url is None and image_data_url is None:
        raise ProxyApiFallbackError("ProxyAPI image fallback returned no usable image")
    return {
        "model": str(payload_value.get("model") or selected_model),
        "image_url": image_url,
        "image_data_url": image_data_url,
        "revised_prompt": revised_prompt,
    }


def request_image(
    *,
    prompt: str,
    model_name: str | None,
    reference_image_url: str | None = None,
    reference_image_data_url: str | None = None,
    image_size: str | None = None,
    http_session: requests.Session | None = None,
    timeout: tuple[int, int] = (20, 300),
) -> dict[str, str | None]:
    candidates = _candidate_models(model_name, IMAGE_MODEL_ALIASES, IMAGE_MODEL_FALLBACKS)
    if not candidates:
        raise ProxyApiFallbackError("ProxyAPI image model is not configured")

    normalized_reference = str(reference_image_url or "").strip()
    if not normalized_reference:
        normalized_reference = str(reference_image_data_url or "").strip()

    session = http_session or requests.Session()
    headers = _headers()
    url = _chat_completions_url()
    last_error: Exception | None = None
    for candidate_model in candidates:
        message_content: str | list[dict[str, Any]]
        if normalized_reference:
            message_content = [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": normalized_reference}},
            ]
        else:
            message_content = prompt

        payload: dict[str, Any] = {
            "model": candidate_model,
            "modalities": ["image"],
            "messages": [{"role": "user", "content": message_content}],
            "stream": False,
        }
        aspect_ratio = _image_size_to_aspect_ratio(image_size)
        if aspect_ratio:
            payload["image_config"] = {"aspect_ratio": aspect_ratio}

        try:
            response = session.post(url, headers=headers, json=payload, timeout=timeout)
            _raise_for_status(response, route="proxyapi_openrouter_image", model_name=candidate_model)
            try:
                payload_value = response.json()
            except ValueError as exc:
                raise ProxyApiFallbackError("ProxyAPI image fallback returned invalid JSON") from exc
            return _parse_image_response(payload_value, selected_model=candidate_model)
        except (ProxyApiFallbackError, requests.RequestException) as exc:
            last_error = exc
            continue

    raise ProxyApiFallbackError(str(last_error or "ProxyAPI image fallback failed"))


def _image_size_to_aspect_ratio(image_size: str | None) -> str:
    value = str(image_size or "").strip().lower()
    match = re.fullmatch(r"(\d{2,5})x(\d{2,5})", value)
    if not match:
        return ""
    width = int(match.group(1))
    height = int(match.group(2))
    if width <= 0 or height <= 0:
        return ""
    if width == height:
        return "1:1"
    if width > height:
        return "16:9" if width / height >= 1.4 else "4:3"
    return "9:16" if height / width >= 1.4 else "3:4"
