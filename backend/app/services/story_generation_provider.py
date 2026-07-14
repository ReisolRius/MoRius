from __future__ import annotations

import re
from typing import Any

from app import main as monolith_main
from app.services.story_generation_cancel import (
    StoryGenerationCancelled,
    is_story_generation_cancelled,
    register_story_generation_response,
    unregister_story_generation_response,
)
from app.services.provider_resilience import (
    is_content_policy_error,
    is_retryable_provider_error,
)
from app.services.story_service_budget import consume_story_service_http_request
from app.services.text_encoding import repair_likely_utf8_mojibake_deep


def _bind_monolith_names() -> None:
    module_globals = globals()
    for name in dir(monolith_main):
        if name.startswith("__"):
            continue
        module_globals.setdefault(name, getattr(monolith_main, name))


_bind_monolith_names()

if "STORY_DEFAULT_REPETITION_PENALTY" not in globals():
    STORY_DEFAULT_REPETITION_PENALTY = 1.05

if "STORY_DISABLE_THINKING_MODEL_IDS" not in globals():
    STORY_DISABLE_THINKING_MODEL_IDS: set[str] = set()


def _build_story_provider_messages(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    use_plot_memory: bool = False,
    context_limit_tokens: int,
    response_max_tokens: int | None = None,
    translate_for_model: bool = False,
    model_name: str | None = None,
    story_narrator_mode: str | None = None,
    story_romance_enabled: bool = False,
    reroll_discarded_assistant_text: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
) -> list[dict[str, str]]:
    try:
        from app.services import story_prompt_engine

        messages_payload = story_prompt_engine._build_story_provider_messages(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_tokens=context_limit_tokens,
            response_max_tokens=response_max_tokens,
            translate_for_model=translate_for_model,
            model_name=model_name,
            story_narrator_mode=story_narrator_mode,
            story_romance_enabled=story_romance_enabled,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )
    except Exception:
        logger.exception("Story prompt engine failed; falling back to monolith prompt builder")
        messages_payload = monolith_main._build_story_provider_messages(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_tokens=context_limit_tokens,
            response_max_tokens=response_max_tokens,
            translate_for_model=translate_for_model,
            model_name=model_name,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )
    return repair_likely_utf8_mojibake_deep(messages_payload)


def _should_lock_polza_story_request_to_selected_model(model_name: str | None) -> bool:
    return _is_polza_gemini_pro_model(model_name)


def _apply_polza_story_response_limit(payload: dict[str, Any], max_tokens: int | None) -> None:
    if max_tokens is None:
        return
    normalized_limit = int(max_tokens)
    payload["max_tokens"] = normalized_limit
    payload["max_completion_tokens"] = normalized_limit


def _polza_combined_context_window_tokens(model_name: str | None) -> int | None:
    normalized_model_name = _normalize_story_model_id(model_name)
    if normalized_model_name == "aion-labs/aion-2.0":
        return int(getattr(monolith_main, "STORY_AION_CONTEXT_WINDOW_TOKENS", 131_072) or 131_072)
    return None


def _polza_context_output_reserve_tokens(model_name: str | None, max_tokens: int | None) -> int:
    if max_tokens is not None:
        return max(int(max_tokens), 1)
    if _polza_combined_context_window_tokens(model_name) is not None:
        return max(int(getattr(monolith_main, "STORY_RESPONSE_MAX_TOKENS_MAX", 3_000) or 3_000), 1)
    return 0


def _polza_message_token_cost(message: dict[str, str]) -> int:
    content = str(message.get("content") or "").strip()
    if not content:
        return 0
    return max(int(_estimate_story_tokens(content)), 1) + 4


def _estimate_polza_messages_input_tokens(messages_payload: list[dict[str, str]]) -> int:
    return sum(_polza_message_token_cost(message) for message in messages_payload) + 8


def _trim_story_text_head_by_tokens(value: str, token_limit: int) -> str:
    normalized = _normalize_story_message_content(value)
    if not normalized or token_limit <= 0:
        return ""
    matches = list(STORY_TOKEN_ESTIMATE_PATTERN.finditer(normalized.lower()))
    if not matches:
        return normalized[: max(token_limit * 4, 1)].rstrip()
    if len(matches) <= token_limit:
        return normalized
    end_char_index = matches[max(int(token_limit), 1) - 1].end()
    return normalized[:end_char_index].rstrip()


def _latest_user_message_index(messages_payload: list[dict[str, str]]) -> int | None:
    for index in range(len(messages_payload) - 1, -1, -1):
        if str(messages_payload[index].get("role") or "").strip() == STORY_USER_ROLE:
            return index
    return None


def _fit_polza_messages_to_context_window(
    messages_payload: list[dict[str, str]],
    *,
    model_name: str | None,
    max_tokens: int | None,
) -> tuple[list[dict[str, str]], int | None]:
    context_window = _polza_combined_context_window_tokens(model_name)
    if context_window is None:
        return messages_payload, max_tokens

    output_reserve_tokens = _polza_context_output_reserve_tokens(model_name, max_tokens)
    effective_max_tokens = output_reserve_tokens if max_tokens is None else max_tokens
    overhead_reserve_tokens = max(
        int(getattr(monolith_main, "STORY_AION_PROMPT_OVERHEAD_RESERVE_TOKENS", 2_048) or 2_048),
        0,
    )
    tokenizer_safety_factor = max(
        float(getattr(monolith_main, "STORY_AION_INPUT_TOKENIZER_SAFETY_FACTOR", 1.12) or 1.12),
        1.0,
    )
    input_budget_tokens = int(
        max(int(context_window) - int(output_reserve_tokens) - overhead_reserve_tokens, 1)
        / tokenizer_safety_factor
    )
    input_budget_tokens = max(input_budget_tokens, 1)
    initial_estimate = _estimate_polza_messages_input_tokens(messages_payload)
    if initial_estimate <= input_budget_tokens:
        return messages_payload, effective_max_tokens

    fitted_messages = [
        {
            "role": str(message.get("role") or STORY_USER_ROLE),
            "content": str(message.get("content") or ""),
        }
        for message in messages_payload
        if str(message.get("content") or "").strip()
    ]

    def current_estimate() -> int:
        return _estimate_polza_messages_input_tokens(fitted_messages)

    # Drop older dialogue first; prompt assembly already packed cards/history, but this
    # final guard protects against provider tokenizer drift and legacy oversized settings.
    while current_estimate() > input_budget_tokens:
        latest_user_index = _latest_user_message_index(fitted_messages)
        removable_index = next(
            (
                index
                for index, message in enumerate(fitted_messages)
                if str(message.get("role") or "").strip() != "system" and index != latest_user_index
            ),
            None,
        )
        if removable_index is None:
            break
        del fitted_messages[removable_index]

    latest_user_index = _latest_user_message_index(fitted_messages)
    if latest_user_index is not None and current_estimate() > input_budget_tokens:
        other_tokens = current_estimate() - _polza_message_token_cost(fitted_messages[latest_user_index])
        content_budget = max(input_budget_tokens - other_tokens - 4, 32)
        fitted_messages[latest_user_index]["content"] = _trim_story_text_tail_by_tokens(
            fitted_messages[latest_user_index].get("content", ""),
            content_budget,
        )

    while current_estimate() > input_budget_tokens:
        system_indices = [
            index
            for index, message in enumerate(fitted_messages)
            if str(message.get("role") or "").strip() == "system"
        ]
        if not system_indices:
            break
        trim_index = system_indices[-1]
        other_tokens = current_estimate() - _polza_message_token_cost(fitted_messages[trim_index])
        minimum_system_tokens = 256 if trim_index == 0 else 64
        content_budget = max(input_budget_tokens - other_tokens - 4, minimum_system_tokens)
        original_content = fitted_messages[trim_index].get("content", "")
        trimmed_content = _trim_story_text_head_by_tokens(original_content, content_budget)
        if trimmed_content and trimmed_content != original_content:
            fitted_messages[trim_index]["content"] = trimmed_content
            continue
        if trim_index != 0:
            del fitted_messages[trim_index]
            continue
        break

    final_estimate = current_estimate()
    logger.warning(
        "RouterAI payload trimmed to fit combined context: model=%s input_estimate=%s->%s budget=%s output_reserve=%s window=%s",
        model_name,
        initial_estimate,
        final_estimate,
        input_budget_tokens,
        output_reserve_tokens,
        context_window,
    )
    return fitted_messages, effective_max_tokens


def _should_translate_story_input_for_model(model_name: str | None) -> bool:
    _ = model_name
    return _is_story_input_translation_enabled()


def _select_story_repetition_penalty_value(
    *,
    model_name: str | None,
    story_repetition_penalty: float,
) -> float | None:
    if not _can_apply_story_sampling_to_model(model_name):
        return None
    if not math.isfinite(story_repetition_penalty):
        return None
    clamped_value = max(1.0, min(2.0, float(story_repetition_penalty)))
    return round(clamped_value, 2)


def _select_story_frequency_penalty_value(
    *,
    model_name: str | None,
) -> float | None:
    if not _can_apply_story_sampling_to_model(model_name):
        return None
    return None


def _select_story_presence_penalty_value(
    *,
    model_name: str | None,
) -> float | None:
    if not _can_apply_story_sampling_to_model(model_name):
        return None
    return None


POLZA_RETRY_DELAYS_SECONDS = (1.1, 2.4, 4.8)
POLZA_TRANSIENT_STATUS_CODES = {500, 502, 503, 504}
POLZA_RETRYABLE_REQUEST_STATUS_CODES = {408, 409, 425, 429, 499, *POLZA_TRANSIENT_STATUS_CODES}
POLZA_FALLBACK_STATUS_CODES = {404, 408, 409, 425, 429, *POLZA_TRANSIENT_STATUS_CODES}
POLZA_STORY_STREAM_CONNECT_TIMEOUT_SECONDS = 20
POLZA_STORY_STREAM_READ_TIMEOUT_SECONDS = 90
POLZA_GEMINI_PRO_STREAM_READ_TIMEOUT_SECONDS = 180
STORY_STREAM_FIRST_TOKEN_TIMEOUT_FLOOR_SECONDS = 120.0
STORY_STREAM_FIRST_TOKEN_TIMEOUT_CEILING_SECONDS = 120.0
POLZA_PROVIDER_TEMPORARY_ERROR_MARKERS = (
    "provider returned error",
    "internal server error",
    "server_error",
    "upstream",
    "temporarily overloaded",
    "overloaded",
    "capacity",
    "no endpoint",
    "no endpoints",
    "deadline exceeded",
    "model is loading",
)
POLZA_GEMINI_25_PRO_MODEL_ID = "google/gemini-2.5-pro"
POLZA_GEMINI_31_PRO_MODEL_IDS = {
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-pro",
}
POLZA_GEMINI_PRO_MODEL_IDS = {
    POLZA_GEMINI_25_PRO_MODEL_ID,
    *POLZA_GEMINI_31_PRO_MODEL_IDS,
}
POLZA_TURN_SILENT_RETRY_ATTEMPTS = 1
POLZA_TURN_RETRY_STATUS_CODES = {400, 408, 409, 425, 429, 499, 500, 502, 503, 504}


def _apply_polza_story_reasoning_preferences(
    payload: dict[str, Any],
    *,
    model_name: str | None,
) -> None:
    normalized_model_name = _normalize_story_model_id(model_name)
    if normalized_model_name in {
        "z-ai/glm-5",
        "z-ai/glm-5.1",
        "z-ai/glm-5.2",
        "z-ai/glm-4.7-flash",
        "z-ai/glm-4.7",
        STORY_SERVICE_TEXT_MODEL,
        POLZA_GEMINI_25_FLASH_LITE_MODEL,
    }:
        payload["reasoning"] = {
            "effort": "none",
            "exclude": True,
        }
        return
    if normalized_model_name == "openai/gpt-oss-120b":
        payload["reasoning"] = {
            "effort": "low",
            "exclude": True,
        }
        return
    if normalized_model_name in STORY_DISABLE_THINKING_MODEL_IDS:
        payload["reasoning"] = {"exclude": True}


def _format_polza_usage_summary(usage_payload: Any) -> str:
    if not isinstance(usage_payload, dict):
        return ""

    parts: list[str] = []
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        raw_value = usage_payload.get(key)
        if isinstance(raw_value, int):
            parts.append(f"{key}={raw_value}")
    return ", ".join(parts)


def _log_polza_completion_finish(
    *,
    mode: str,
    model_name: str | None,
    finish_reason: str | None,
    usage_payload: Any,
    max_tokens: int | None,
) -> None:
    normalized_finish_reason = str(finish_reason or "").strip()
    if not normalized_finish_reason:
        return

    usage_summary = _format_polza_usage_summary(usage_payload)
    logger.info(
        "RouterAI %s finish: model=%s finish_reason=%s max_tokens=%s usage=%s",
        mode,
        model_name,
        normalized_finish_reason,
        max_tokens,
        usage_summary or "n/a",
    )
    if normalized_finish_reason.casefold() == "length":
        logger.warning(
            "RouterAI %s response hit token limit: model=%s max_tokens=%s usage=%s",
            mode,
            model_name,
            max_tokens,
            usage_summary or "n/a",
        )


def _extract_polza_chat_error_detail(response: requests.Response) -> str:
    detail = ""
    try:
        error_payload = response.json()
    except ValueError:
        error_payload = {}

    if isinstance(error_payload, dict):
        error_value = error_payload.get("error")
        if isinstance(error_value, dict):
            detail = str(error_value.get("message") or error_value.get("code") or "").strip()
            metadata_value = error_value.get("metadata")
            if isinstance(metadata_value, dict):
                raw_detail = str(metadata_value.get("raw") or "").strip()
                if raw_detail:
                    detail = f"{detail}. {raw_detail}" if detail else raw_detail
        elif isinstance(error_value, str):
            detail = error_value.strip()
        if not detail:
            detail = str(error_payload.get("message") or error_payload.get("detail") or "").strip()

    return detail


def _is_polza_temporary_provider_failure(status_code: int, detail: str) -> bool:
    if status_code in POLZA_TRANSIENT_STATUS_CODES:
        return True
    normalized_detail = str(detail or "").casefold()
    return any(marker in normalized_detail for marker in POLZA_PROVIDER_TEMPORARY_ERROR_MARKERS)


def _should_retry_polza_chat_request(*, status_code: int, detail: str, attempt_index: int) -> bool:
    if attempt_index >= len(POLZA_RETRY_DELAYS_SECONDS):
        return False
    if is_content_policy_error(detail):
        return False
    if status_code in POLZA_RETRYABLE_REQUEST_STATUS_CODES:
        return True
    return _is_polza_temporary_provider_failure(status_code, detail) or is_retryable_provider_error(
        detail,
        status_code=status_code,
    )


def _is_polza_gemini_25_pro_model(model_name: str | None) -> bool:
    return _normalize_story_model_id(model_name) == POLZA_GEMINI_25_PRO_MODEL_ID


def _is_polza_gemini_pro_model(model_name: str | None) -> bool:
    return _normalize_story_model_id(model_name) in POLZA_GEMINI_PRO_MODEL_IDS


def _polza_story_stream_read_timeout_seconds(model_name: str | None) -> int:
    if _is_polza_gemini_pro_model(model_name):
        return POLZA_GEMINI_PRO_STREAM_READ_TIMEOUT_SECONDS
    return POLZA_STORY_STREAM_READ_TIMEOUT_SECONDS


def _story_stream_first_token_timeout_seconds(read_timeout_seconds: int | float) -> float:
    floor_seconds = float(STORY_STREAM_FIRST_TOKEN_TIMEOUT_FLOOR_SECONDS)
    ceiling_seconds = float(STORY_STREAM_FIRST_TOKEN_TIMEOUT_CEILING_SECONDS)
    return min(max(float(read_timeout_seconds or 0), floor_seconds), ceiling_seconds)


def _ensure_story_stream_within_time_budget(
    *,
    provider_label: str,
    started_at: float,
    current_time: float,
    emitted_delta: bool,
    first_token_timeout_seconds: float,
    story_generation_game_id: int | None,
    story_generation_id: str | None,
) -> None:
    if is_story_generation_cancelled(story_generation_game_id, story_generation_id):
        raise StoryGenerationCancelled("Story generation cancelled")

    elapsed_seconds = max(float(current_time) - float(started_at), 0.0)
    if not emitted_delta and elapsed_seconds >= float(first_token_timeout_seconds):
        raise RuntimeError(
            f"{provider_label} stream did not produce content within {int(first_token_timeout_seconds)}s"
        )


def _should_retry_polza_turn_failure(
    *,
    model_name: str | None,
    attempt_index: int,
    status_code: int | None = None,
    detail: str = "",
) -> bool:
    _ = model_name
    if attempt_index >= POLZA_TURN_SILENT_RETRY_ATTEMPTS:
        return False
    if is_content_policy_error(detail):
        return False
    if status_code is None:
        return True
    return int(status_code) in POLZA_TURN_RETRY_STATUS_CODES


def _is_polza_incomplete_stream_result(
    *,
    model_name: str | None,
    finish_reason: str | None,
    saw_done_marker: bool,
) -> bool:
    _ = model_name
    normalized_finish_reason = str(finish_reason or "").strip().casefold()
    if normalized_finish_reason:
        return False
    return not bool(saw_done_marker) and not normalized_finish_reason


_STORY_STREAM_CLEAN_TERMINAL_CHARS = frozenset(".!?…»”\"')]}。！？")
_STORY_STREAM_DANGLING_MARKUP_RE = re.compile(r"(?:\[\[[^\]]*|<[^>]*?)$")


def _story_stream_text_needs_tail_recovery(value: str) -> bool:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return False
    if "\ufffd" in normalized:
        return True
    if _STORY_STREAM_DANGLING_MARKUP_RE.search(normalized):
        return True
    if normalized[-1] in _STORY_STREAM_CLEAN_TERMINAL_CHARS:
        return False
    last_token_match = re.search(r"[^\s]+$", normalized)
    if not last_token_match:
        return False
    last_token = last_token_match.group(0)
    return bool(re.search(r"[A-Za-zА-Яа-яЁё]$", last_token))


def _extract_story_stream_novel_suffix(base_text: str, candidate_text: str) -> str:
    normalized_base = str(base_text or "")
    normalized_candidate = str(candidate_text or "")
    if not normalized_candidate:
        return ""
    if not normalized_base:
        return normalized_candidate
    if normalized_candidate.startswith(normalized_base):
        return normalized_candidate[len(normalized_base) :]
    overlap_limit = min(len(normalized_base), len(normalized_candidate))
    for overlap_size in range(overlap_limit, 0, -1):
        if normalized_base.endswith(normalized_candidate[:overlap_size]):
            return normalized_candidate[overlap_size:]
    return normalized_candidate


def _recover_polza_story_stream_tail(
    *,
    messages_payload: list[dict[str, str]],
    partial_text: str,
    model_name: str,
    temperature: float | None,
    top_k: int | None,
    top_p: float | None,
    max_tokens: int | None,
    read_timeout_seconds: int,
    consume_remaining_token_budget: bool = True,
) -> str:
    normalized_partial = str(partial_text or "").replace("\r\n", "\n").strip()
    if not normalized_partial:
        return ""

    remaining_max_tokens = max_tokens
    if isinstance(max_tokens, int) and consume_remaining_token_budget:
        estimated_used_tokens = max(int(_estimate_story_tokens(normalized_partial)), 1)
        remaining_max_tokens = max(int(max_tokens) - estimated_used_tokens, 0)
        if remaining_max_tokens < 64:
            return ""
        remaining_max_tokens = max(128, remaining_max_tokens)
    elif isinstance(max_tokens, int):
        max_story_tokens = int(getattr(monolith_main, "STORY_RESPONSE_MAX_TOKENS_MAX", 3_000) or 3_000)
        remaining_max_tokens = max(512, min(max(int(max_tokens), 1_200), max_story_tokens))

    continuation_messages = [
        *messages_payload,
        {"role": "assistant", "content": normalized_partial},
        {
            "role": "user",
            "content": (
                "Continue the same narrator reply from the exact final character above. "
                "Return only the missing continuation. Do not repeat, rewrite, summarize, restart, "
                "or comment on the existing text. Finish the interrupted sentence and end at a natural player decision point."
            ),
        },
    ]
    recovered_text = _request_polza_story_text(
        continuation_messages,
        model_name=model_name,
        allow_service_fallback=False,
        translate_input=False,
        fallback_model_names=[],
        temperature=temperature,
        top_k=top_k,
        top_p=top_p,
        max_tokens=remaining_max_tokens,
        request_timeout=(
            POLZA_STORY_STREAM_CONNECT_TIMEOUT_SECONDS,
            max(int(read_timeout_seconds), 120),
        ),
        retry_on_rate_limit=True,
    )
    return _extract_story_stream_novel_suffix(normalized_partial, recovered_text)


def _should_try_polza_fallback_model(
    *,
    status_code: int,
    detail: str,
    candidate_model: str,
    candidate_models: list[str],
) -> bool:
    if candidate_model == candidate_models[-1]:
        return False
    if status_code in POLZA_FALLBACK_STATUS_CODES:
        return True
    return _is_polza_temporary_provider_failure(status_code, detail)


def _sleep_polza_retry(attempt_index: int) -> None:
    normalized_index = max(0, min(attempt_index, len(POLZA_RETRY_DELAYS_SECONDS) - 1))
    time.sleep(POLZA_RETRY_DELAYS_SECONDS[normalized_index])


def _resolve_polza_story_provider_payload_for_attempt(
    model_name: str | None,
    attempt_index: int,
) -> dict[str, Any] | None:
    _ = (model_name, attempt_index)
    return None


def _resolve_polza_provider_attempt_label(provider_payload: dict[str, Any] | None) -> str:
    if not provider_payload:
        return "auto"
    order_value = provider_payload.get("order")
    if isinstance(order_value, list) and order_value:
        return ",".join(str(item).strip() for item in order_value if str(item).strip()) or "auto"
    return "auto"


def _build_polza_story_candidate_models(
    primary_model: str,
    *,
    allow_service_fallback: bool,
    fallback_model_names: list[str] | None = None,
) -> list[str]:
    normalized_primary_model = str(primary_model or "").strip()
    if not normalized_primary_model:
        return []
    candidate_models = [normalized_primary_model]
    for fallback_model in fallback_model_names or []:
        normalized_fallback_model = str(fallback_model or "").strip()
        if not normalized_fallback_model or normalized_fallback_model in candidate_models:
            continue
        candidate_models.append(normalized_fallback_model)
    if allow_service_fallback and normalized_primary_model != STORY_SERVICE_TEXT_MODEL:
        if STORY_SERVICE_TEXT_MODEL not in candidate_models:
            candidate_models.append(STORY_SERVICE_TEXT_MODEL)
    return candidate_models

def _normalize_basic_auth_header(raw_value: str) -> str:
    normalized = raw_value.strip()
    if not normalized:
        raise RuntimeError("GIGACHAT_AUTHORIZATION_KEY is missing")
    if normalized.lower().startswith("basic "):
        return normalized
    return f"Basic {normalized}"

def _get_gigachat_access_token() -> str:
    now = _utcnow()
    with GIGACHAT_TOKEN_CACHE_LOCK:
        cached_token = GIGACHAT_TOKEN_CACHE.get("access_token")
        cached_expires_at = GIGACHAT_TOKEN_CACHE.get("expires_at")

    if isinstance(cached_token, str) and cached_token and isinstance(cached_expires_at, datetime):
        if cached_expires_at > now + timedelta(seconds=30):
            return cached_token

    headers = {
        "Authorization": _normalize_basic_auth_header(settings.gigachat_authorization_key),
        "RqUID": str(uuid4()),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"scope": settings.gigachat_scope}

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_oauth_url,
            headers=headers,
            data=data,
            timeout=20,
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat OAuth endpoint") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code >= 400:
        detail = ""
        if isinstance(payload, dict):
            detail = str(payload.get("error_description") or payload.get("message") or payload.get("error") or "").strip()
        if detail:
            raise RuntimeError(f"GigaChat OAuth error ({response.status_code}): {detail}")
        raise RuntimeError(f"GigaChat OAuth error ({response.status_code})")

    if not isinstance(payload, dict):
        raise RuntimeError("GigaChat OAuth returned invalid payload")

    access_token = str(payload.get("access_token", "")).strip()
    if not access_token:
        raise RuntimeError("GigaChat OAuth response does not contain access_token")

    expires_at_value = payload.get("expires_at")
    expires_at = now + timedelta(minutes=25)
    if isinstance(expires_at_value, int):
        expires_at = datetime.fromtimestamp(expires_at_value / 1000, tz=timezone.utc)
    elif isinstance(expires_at_value, str) and expires_at_value.isdigit():
        expires_at = datetime.fromtimestamp(int(expires_at_value) / 1000, tz=timezone.utc)

    with GIGACHAT_TOKEN_CACHE_LOCK:
        GIGACHAT_TOKEN_CACHE["access_token"] = access_token
        GIGACHAT_TOKEN_CACHE["expires_at"] = expires_at

    return access_token

def _iter_gigachat_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    use_plot_memory: bool = False,
    context_limit_chars: int,
    response_max_tokens: int | None = None,
    translate_for_model: bool = False,
    story_narrator_mode: str | None = None,
    story_romance_enabled: bool = False,
    reroll_discarded_assistant_text: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
    story_generation_game_id: int | None = None,
    story_generation_id: str | None = None,
):
    access_token = _get_gigachat_access_token()
    request_started_at = time.monotonic()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        use_plot_memory=use_plot_memory,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=response_max_tokens,
        translate_for_model=translate_for_model,
        model_name=settings.gigachat_model,
        story_narrator_mode=story_narrator_mode,
        story_romance_enabled=story_romance_enabled,
        reroll_discarded_assistant_text=reroll_discarded_assistant_text,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )
    messages_payload = repair_likely_utf8_mojibake_deep(messages_payload)
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to GigaChat")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "text/event-stream",
        # Keep the SSE leg uncompressed so upstream tokens flush frame-by-frame.
        "Accept-Encoding": "identity",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": messages_payload,
        "stream": True,
    }
    if response_max_tokens is not None:
        payload["max_tokens"] = int(response_max_tokens)

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 120),
            stream=True,
            verify=settings.gigachat_verify_ssl,
        )
        register_story_generation_response(
            story_generation_game_id,
            story_generation_id,
            response,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat chat endpoint") from exc

    try:
        if response.status_code >= 400:
            detail = ""
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = {}

            if isinstance(error_payload, dict):
                detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

            if detail:
                raise RuntimeError(f"GigaChat chat error ({response.status_code}): {detail}")
            raise RuntimeError(f"GigaChat chat error ({response.status_code})")

        # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
        response.encoding = "utf-8"
        emitted_delta = False
        first_content_emitted_at: float | None = None
        read_timeout_seconds = 120
        first_token_timeout_seconds = _story_stream_first_token_timeout_seconds(read_timeout_seconds)
        for raw_line in response.iter_lines(
            chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
            decode_unicode=True,
        ):
            current_time = time.monotonic()
            _ensure_story_stream_within_time_budget(
                provider_label="GigaChat",
                started_at=request_started_at,
                current_time=current_time,
                emitted_delta=emitted_delta,
                first_token_timeout_seconds=first_token_timeout_seconds,
                story_generation_game_id=story_generation_game_id,
                story_generation_id=story_generation_id,
            )
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue

            raw_data = line[len("data:") :].strip()
            if raw_data == "[DONE]":
                break

            try:
                chunk_payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            choices = chunk_payload.get("choices")
            if not isinstance(choices, list) or not choices:
                continue

            choice = choices[0] if isinstance(choices[0], dict) else {}
            delta_value = choice.get("delta")
            if isinstance(delta_value, dict):
                content_delta = delta_value.get("content")
                if isinstance(content_delta, str) and content_delta:
                    emitted_delta = True
                    if first_content_emitted_at is None:
                        first_content_emitted_at = time.monotonic()
                        logger.info(
                            "GigaChat stream first token latency: %.3fs",
                            first_content_emitted_at - request_started_at,
                        )
                    for chunk in _yield_story_stream_chunks_with_pacing(content_delta):
                        yield chunk
                    continue

            if emitted_delta:
                continue

            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = message_value.get("content")
                if isinstance(content_value, str) and content_value:
                    if first_content_emitted_at is None:
                        first_content_emitted_at = time.monotonic()
                        logger.info(
                            "GigaChat stream first token latency (message payload): %.3fs",
                            first_content_emitted_at - request_started_at,
                        )
                    for chunk in _yield_story_stream_chunks_with_pacing(content_value):
                        yield chunk
                    break
    finally:
        unregister_story_generation_response(
            story_generation_game_id,
            story_generation_id,
            response,
        )
        response.close()

def _iter_polza_story_stream_chunks(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    use_plot_memory: bool = False,
    context_limit_chars: int,
    model_name: str | None = None,
    temperature: float | None = None,
    repetition_penalty: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    translate_for_model: bool = False,
    story_narrator_mode: str | None = None,
    story_romance_enabled: bool = False,
    reroll_discarded_assistant_text: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
    story_generation_game_id: int | None = None,
    story_generation_id: str | None = None,
):
    request_started_at = time.monotonic()
    messages_payload = _build_story_provider_messages(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        use_plot_memory=use_plot_memory,
        context_limit_tokens=context_limit_chars,
        response_max_tokens=max_tokens,
        translate_for_model=translate_for_model,
        model_name=model_name,
        story_narrator_mode=story_narrator_mode,
        story_romance_enabled=story_romance_enabled,
        reroll_discarded_assistant_text=reroll_discarded_assistant_text,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )
    messages_payload = repair_likely_utf8_mojibake_deep(messages_payload)
    if len(messages_payload) <= 1:
        raise RuntimeError("No messages to send to RouterAI")

    headers = {
        "Authorization": f"Bearer {settings.polza_api_key}",
        "Accept": "text/event-stream",
        # Keep the SSE leg uncompressed. Compressed event streams often flush only at
        # large decoder boundaries, which makes the UI receive the whole reply at once.
        "Accept-Encoding": "identity",
        "Content-Type": "application/json",
    }
    if settings.polza_site_url:
        headers["HTTP-Referer"] = settings.polza_site_url
    if settings.polza_app_name:
        headers["X-Title"] = settings.polza_app_name

    primary_model = (model_name or settings.polza_model).strip()
    if not primary_model:
        raise RuntimeError("RouterAI chat model is not configured")

    candidate_models = _build_polza_story_candidate_models(
        primary_model,
        allow_service_fallback=False,
    )

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        for attempt_index in range(len(POLZA_RETRY_DELAYS_SECONDS) + 1):
            if is_story_generation_cancelled(story_generation_game_id, story_generation_id):
                raise StoryGenerationCancelled("Story generation cancelled")
            request_messages_payload, request_max_tokens = _fit_polza_messages_to_context_window(
                messages_payload,
                model_name=model_name,
                max_tokens=max_tokens,
            )
            payload = {
                "model": model_name,
                "messages": request_messages_payload,
                "stream": True,
            }
            provider_payload = _resolve_polza_story_provider_payload_for_attempt(
                model_name,
                attempt_index,
            )
            if provider_payload is not None:
                payload["provider"] = provider_payload
            if temperature is not None:
                payload["temperature"] = temperature
            if repetition_penalty is not None:
                payload["repetition_penalty"] = repetition_penalty
            if frequency_penalty is not None:
                payload["frequency_penalty"] = frequency_penalty
            if presence_penalty is not None:
                payload["presence_penalty"] = presence_penalty
            if top_k is not None:
                payload["top_k"] = top_k
            if top_p is not None:
                payload["top_p"] = top_p
            _apply_polza_story_response_limit(payload, request_max_tokens)
            _apply_polza_story_reasoning_preferences(payload, model_name=model_name)
            provider_label = _resolve_polza_provider_attempt_label(provider_payload)
            request_started_at_attempt = time.monotonic()
            logger.info(
                "RouterAI stream request started: model=%s provider=%s attempt=%s",
                model_name,
                provider_label,
                attempt_index + 1,
            )
            read_timeout_seconds = _polza_story_stream_read_timeout_seconds(model_name)
            try:
                response = HTTP_SESSION.post(
                    settings.polza_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=(
                        POLZA_STORY_STREAM_CONNECT_TIMEOUT_SECONDS,
                        read_timeout_seconds,
                    ),
                    stream=True,
                )
                register_story_generation_response(
                    story_generation_game_id,
                    story_generation_id,
                    response,
                )
            except requests.RequestException as exc:
                if is_story_generation_cancelled(story_generation_game_id, story_generation_id):
                    raise StoryGenerationCancelled("Story generation cancelled") from exc
                if attempt_index < len(POLZA_RETRY_DELAYS_SECONDS):
                    logger.warning(
                        "RouterAI stream request transport failed; retrying: model=%s provider=%s attempt=%s error=%s",
                        model_name,
                        provider_label,
                        attempt_index + 1,
                        exc,
                    )
                    _sleep_polza_retry(attempt_index)
                    continue
                raise RuntimeError("Failed to reach RouterAI chat endpoint") from exc

            try:
                logger.info(
                    "RouterAI stream response opened: model=%s provider=%s status=%s latency=%.3fs",
                    model_name,
                    provider_label,
                    response.status_code,
                    time.monotonic() - request_started_at_attempt,
                )
                if response.status_code >= 400:
                    detail = _extract_polza_chat_error_detail(response)

                    if _should_retry_polza_chat_request(
                        status_code=response.status_code,
                        detail=detail,
                        attempt_index=attempt_index,
                    ) or _should_retry_polza_turn_failure(
                        model_name=model_name,
                        attempt_index=attempt_index,
                        status_code=response.status_code,
                        detail=detail,
                    ):
                        logger.warning(
                            "RouterAI stream temporary failure; retrying same model: model=%s provider=%s status=%s detail=%s next_attempt=%s",
                            model_name,
                            provider_label,
                            response.status_code,
                            detail or "n/a",
                            attempt_index + 2,
                        )
                        _sleep_polza_retry(attempt_index)
                        continue

                    error_text = f"RouterAI chat error ({response.status_code})"
                    if detail:
                        error_text = f"{error_text}: {detail}"

                    raise RuntimeError(error_text)

                # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
                response.encoding = "utf-8"
                emitted_delta = False
                emitted_text_parts: list[str] = []
                first_content_emitted_at: float | None = None
                last_keepalive_at = time.monotonic()
                first_token_timeout_seconds = _story_stream_first_token_timeout_seconds(read_timeout_seconds)
                finish_reason: str | None = None
                usage_payload: Any = None
                saw_done_marker = False
                try:
                    for raw_line in response.iter_lines(
                        chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
                        decode_unicode=True,
                    ):
                        current_time = time.monotonic()
                        _ensure_story_stream_within_time_budget(
                            provider_label="RouterAI",
                            started_at=request_started_at_attempt,
                            current_time=current_time,
                            emitted_delta=emitted_delta,
                            first_token_timeout_seconds=first_token_timeout_seconds,
                            story_generation_game_id=story_generation_game_id,
                            story_generation_id=story_generation_id,
                        )
                        if raw_line is None:
                            continue
                        line = raw_line.strip()
                        if not line:
                            if not emitted_delta and current_time - last_keepalive_at >= 8.0:
                                last_keepalive_at = current_time
                                yield ""
                            continue
                        if not line.startswith("data:"):
                            continue

                        raw_data = line[len("data:") :].strip()
                        if raw_data == "[DONE]":
                            saw_done_marker = True
                            break

                        try:
                            chunk_payload = json.loads(raw_data)
                        except json.JSONDecodeError as exc:
                            raise RuntimeError(
                                "RouterAI stream returned malformed SSE JSON"
                            ) from exc

                        if isinstance(chunk_payload.get("usage"), dict):
                            usage_payload = chunk_payload.get("usage")

                        error_value = chunk_payload.get("error")
                        if isinstance(error_value, dict):
                            error_detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                            raise RuntimeError(error_detail or "RouterAI stream returned an error")
                        if isinstance(error_value, str) and error_value.strip():
                            raise RuntimeError(error_value.strip())

                        choices = chunk_payload.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue

                        choice = choices[0] if isinstance(choices[0], dict) else {}
                        raw_finish_reason = choice.get("finish_reason")
                        if isinstance(raw_finish_reason, str) and raw_finish_reason.strip():
                            finish_reason = raw_finish_reason.strip()
                        delta_value = choice.get("delta")
                        if isinstance(delta_value, dict):
                            content_delta = _extract_text_from_model_content(delta_value.get("content"))
                            if content_delta:
                                emitted_delta = True
                                emitted_text_parts.append(content_delta)
                                if first_content_emitted_at is None:
                                    first_content_emitted_at = time.monotonic()
                                    logger.info(
                                        "RouterAI stream first token latency: %.3fs model=%s",
                                        first_content_emitted_at - request_started_at,
                                        model_name,
                                    )
                                for chunk in _yield_story_stream_chunks_with_pacing(content_delta):
                                    yield chunk
                            elif not emitted_delta and current_time - last_keepalive_at >= 8.0:
                                last_keepalive_at = current_time
                                yield ""

                        message_value = choice.get("message")
                        if isinstance(message_value, dict):
                            content_value = _extract_text_from_model_content(message_value.get("content"))
                            if content_value:
                                emitted_text = "".join(emitted_text_parts)
                                novel_content = _extract_story_stream_novel_suffix(emitted_text, content_value)
                                if not novel_content:
                                    continue
                                emitted_delta = True
                                emitted_text_parts.append(novel_content)
                                if first_content_emitted_at is None:
                                    first_content_emitted_at = time.monotonic()
                                    logger.info(
                                        "RouterAI stream first token latency (message payload): %.3fs model=%s",
                                        first_content_emitted_at - request_started_at,
                                        model_name,
                                    )
                                for chunk in _yield_story_stream_chunks_with_pacing(novel_content):
                                    yield chunk
                                if not emitted_text:
                                    break
                except requests.RequestException as exc:
                    if is_story_generation_cancelled(story_generation_game_id, story_generation_id):
                        raise StoryGenerationCancelled("Story generation cancelled") from exc
                    if not emitted_delta and attempt_index < len(POLZA_RETRY_DELAYS_SECONDS):
                        last_error = RuntimeError("Failed while reading RouterAI chat stream")
                        logger.warning(
                            "RouterAI stream read failed before content; silently retrying same turn: model=%s provider=%s attempt=%s error=%s",
                            model_name,
                            provider_label,
                            attempt_index + 1,
                            exc,
                        )
                        _sleep_polza_retry(attempt_index)
                        continue
                    if emitted_delta:
                        partial_text = "".join(emitted_text_parts)
                        logger.warning(
                            "RouterAI stream read failed after content; recovering only the missing tail: "
                            "model=%s provider=%s partial_chars=%s error=%s",
                            model_name,
                            provider_label,
                            len(partial_text),
                            exc,
                        )
                        recovered_tail = _recover_polza_story_stream_tail(
                            messages_payload=request_messages_payload,
                            partial_text=partial_text,
                            model_name=model_name,
                            temperature=temperature,
                            top_k=top_k,
                            top_p=top_p,
                            max_tokens=request_max_tokens,
                            read_timeout_seconds=read_timeout_seconds,
                        )
                        if recovered_tail:
                            for chunk in _yield_story_stream_chunks_with_pacing(recovered_tail):
                                yield chunk
                            return
                    raise RuntimeError("Failed while reading RouterAI chat stream") from exc
                except RuntimeError as exc:
                    if (
                        not emitted_delta
                        and attempt_index < len(POLZA_RETRY_DELAYS_SECONDS)
                        and is_retryable_provider_error(exc)
                    ):
                        last_error = RuntimeError(str(exc).strip() or "RouterAI stream returned an error")
                        logger.warning(
                            "RouterAI stream failed before content; silently retrying same turn: model=%s provider=%s attempt=%s error=%s",
                            model_name,
                            provider_label,
                            attempt_index + 1,
                            exc,
                        )
                        _sleep_polza_retry(attempt_index)
                        continue
                    if emitted_delta and is_retryable_provider_error(exc):
                        partial_text = "".join(emitted_text_parts)
                        logger.warning(
                            "RouterAI stream failed after content; recovering only the missing tail: "
                            "model=%s provider=%s partial_chars=%s error=%s",
                            model_name,
                            provider_label,
                            len(partial_text),
                            exc,
                        )
                        recovered_tail = _recover_polza_story_stream_tail(
                            messages_payload=request_messages_payload,
                            partial_text=partial_text,
                            model_name=model_name,
                            temperature=temperature,
                            top_k=top_k,
                            top_p=top_p,
                            max_tokens=request_max_tokens,
                            read_timeout_seconds=read_timeout_seconds,
                        )
                        if recovered_tail:
                            for chunk in _yield_story_stream_chunks_with_pacing(recovered_tail):
                                yield chunk
                            return
                    raise

                if is_story_generation_cancelled(story_generation_game_id, story_generation_id):
                    raise StoryGenerationCancelled("Story generation cancelled")

                if emitted_delta:
                    _log_polza_completion_finish(
                        mode="stream",
                        model_name=model_name,
                        finish_reason=finish_reason,
                        usage_payload=usage_payload,
                        max_tokens=request_max_tokens,
                    )
                    partial_text = "".join(emitted_text_parts)
                    model_hit_length_limit = str(finish_reason or "").strip().casefold() == "length"
                    if model_hit_length_limit:
                        logger.warning(
                            "RouterAI stream hit response token limit; recovering missing tail: "
                            "model=%s provider=%s partial_chars=%s max_tokens=%s",
                            model_name,
                            provider_label,
                            len(partial_text),
                            request_max_tokens,
                        )
                        recovered_tail = _recover_polza_story_stream_tail(
                            messages_payload=request_messages_payload,
                            partial_text=partial_text,
                            model_name=model_name,
                            temperature=temperature,
                            top_k=top_k,
                            top_p=top_p,
                            max_tokens=request_max_tokens,
                            read_timeout_seconds=read_timeout_seconds,
                            consume_remaining_token_budget=False,
                        )
                        if recovered_tail:
                            for chunk in _yield_story_stream_chunks_with_pacing(recovered_tail):
                                yield chunk
                            return
                        raise RuntimeError(
                            "RouterAI story response hit the token limit before a complete answer"
                        )
                    # Polza/RouterAI sometimes report finish_reason "stop" (or only send the
                    # [DONE] sentinel) even when the underlying text was cut mid-sentence, so
                    # that metadata alone is not trustworthy. Always inspect the emitted text's
                    # own shape before accepting it as a finished reply, regardless of what
                    # finish_reason/saw_done_marker claim.
                    if not _story_stream_text_needs_tail_recovery(partial_text):
                        return
                    logger.warning(
                        "RouterAI stream text looks cut off despite finish_reason=%s done=%s; "
                        "recovering only the missing tail: model=%s provider=%s partial_chars=%s",
                        finish_reason or "n/a",
                        saw_done_marker,
                        model_name,
                        provider_label,
                        len(partial_text),
                    )
                    recovered_tail = _recover_polza_story_stream_tail(
                        messages_payload=request_messages_payload,
                        partial_text=partial_text,
                        model_name=model_name,
                        temperature=temperature,
                        top_k=top_k,
                        top_p=top_p,
                        max_tokens=request_max_tokens,
                        read_timeout_seconds=read_timeout_seconds,
                    )
                    if recovered_tail:
                        for chunk in _yield_story_stream_chunks_with_pacing(recovered_tail):
                            yield chunk
                        return
                    logger.warning(
                        "RouterAI stream tail recovery returned no text; keeping emitted partial answer instead "
                        "of deleting a visible generation: model=%s provider=%s partial_chars=%s",
                        model_name,
                        provider_label,
                        len(partial_text),
                    )
                    return

                logger.warning(
                    "RouterAI stream completed without textual content: model=%s provider=%s finish_reason=%s done=%s",
                    model_name,
                    provider_label,
                    finish_reason or "",
                    saw_done_marker,
                )
                last_error = RuntimeError("RouterAI stream completed without textual content")
                if attempt_index < len(POLZA_RETRY_DELAYS_SECONDS):
                    logger.warning(
                        "RouterAI empty stream/text response; retrying same turn: model=%s provider=%s next_attempt=%s",
                        model_name,
                        provider_label,
                        attempt_index + 2,
                    )
                    _sleep_polza_retry(attempt_index)
                    continue
                raise last_error
            finally:
                unregister_story_generation_response(
                    story_generation_game_id,
                    story_generation_id,
                    response,
                )
                response.close()

        if model_name == candidate_models[-1] and last_error is not None:
            raise last_error

    if last_error is not None:
        raise last_error

    raise RuntimeError("RouterAI chat request failed")

def _request_gigachat_story_text(
    messages_payload: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
) -> str:
    access_token = _get_gigachat_access_token()
    prepared_messages_payload = _prepare_story_messages_for_model(messages_payload)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.gigachat_model,
        "messages": prepared_messages_payload,
        "stream": False,
    }
    if max_tokens is not None:
        payload["max_tokens"] = int(max_tokens)

    try:
        response = HTTP_SESSION.post(
            settings.gigachat_chat_url,
            headers=headers,
            json=payload,
            timeout=(20, 120),
            verify=settings.gigachat_verify_ssl,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach GigaChat chat endpoint") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = {}

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        error_text = f"GigaChat chat error ({response.status_code})"
        if detail:
            error_text = f"{error_text}: {detail}"
        raise RuntimeError(error_text)

    try:
        payload_value = response.json()
    except ValueError as exc:
        raise RuntimeError("GigaChat chat returned invalid payload") from exc

    if not isinstance(payload_value, dict):
        return ""
    choices = payload_value.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message_value = choice.get("message")
    if not isinstance(message_value, dict):
        return ""
    return _extract_text_from_model_content(message_value.get("content"))

def _request_polza_story_text(
    messages_payload: list[dict[str, str]],
    *,
    model_name: str | None = None,
    allow_service_fallback: bool = False,
    translate_input: bool = True,
    fallback_model_names: list[str] | None = None,
    temperature: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    request_timeout: tuple[int, int] | None = None,
    retry_on_rate_limit: bool = True,
) -> str:
    headers = {
        "Authorization": f"Bearer {settings.polza_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.polza_site_url:
        headers["HTTP-Referer"] = settings.polza_site_url
    if settings.polza_app_name:
        headers["X-Title"] = settings.polza_app_name

    primary_model = (model_name or settings.polza_model).strip()
    if not primary_model:
        raise RuntimeError("RouterAI chat model is not configured")

    candidate_models = _build_polza_story_candidate_models(
        primary_model,
        allow_service_fallback=allow_service_fallback,
        fallback_model_names=fallback_model_names,
    )

    last_error: RuntimeError | None = None
    timeout_value = request_timeout or (20, 120)
    prepared_messages_payload = _prepare_story_messages_for_model(
        messages_payload,
        translate_input=translate_input,
    )
    retry_delays = POLZA_RETRY_DELAYS_SECONDS
    for candidate_model in candidate_models:
        for attempt_index in range(len(retry_delays) + 1):
            request_messages_payload, request_max_tokens = _fit_polza_messages_to_context_window(
                prepared_messages_payload,
                model_name=candidate_model,
                max_tokens=max_tokens,
            )
            payload = {
                "model": candidate_model,
                "messages": request_messages_payload,
                "stream": False,
            }
            provider_payload = _resolve_polza_story_provider_payload_for_attempt(
                candidate_model,
                attempt_index,
            )
            if provider_payload is not None:
                payload["provider"] = provider_payload
            if temperature is not None:
                payload["temperature"] = temperature
            if frequency_penalty is not None:
                payload["frequency_penalty"] = frequency_penalty
            if presence_penalty is not None:
                payload["presence_penalty"] = presence_penalty
            if top_k is not None:
                payload["top_k"] = top_k
            if top_p is not None:
                payload["top_p"] = top_p
            _apply_polza_story_response_limit(payload, request_max_tokens)
            _apply_polza_story_reasoning_preferences(payload, model_name=candidate_model)
            provider_label = _resolve_polza_provider_attempt_label(provider_payload)
            request_started_at = time.monotonic()
            logger.info(
                "RouterAI text request started: model=%s provider=%s attempt=%s",
                candidate_model,
                provider_label,
                attempt_index + 1,
            )
            consume_story_service_http_request()
            try:
                response = HTTP_SESSION.post(
                    settings.polza_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=timeout_value,
                )
            except requests.RequestException as exc:
                if attempt_index < len(retry_delays):
                    logger.warning(
                        "RouterAI text transport failed; retrying: model=%s provider=%s attempt=%s error=%s",
                        candidate_model,
                        provider_label,
                        attempt_index + 1,
                        exc,
                    )
                    _sleep_polza_retry(attempt_index)
                    continue
                raise RuntimeError("Failed to reach RouterAI chat endpoint") from exc

            logger.info(
                "RouterAI text response received: model=%s provider=%s status=%s latency=%.3fs",
                candidate_model,
                provider_label,
                response.status_code,
                time.monotonic() - request_started_at,
            )

            if response.status_code >= 400:
                detail = _extract_polza_chat_error_detail(response)

                should_retry = (
                    _should_retry_polza_chat_request(
                        status_code=response.status_code,
                        detail=detail,
                        attempt_index=attempt_index,
                    )
                    or _should_retry_polza_turn_failure(
                        model_name=candidate_model,
                        attempt_index=attempt_index,
                        status_code=response.status_code,
                        detail=detail,
                    )
                )
                if response.status_code == 429 and not retry_on_rate_limit:
                    should_retry = False
                if should_retry:
                    logger.warning(
                        "RouterAI text temporary failure; retrying same model: model=%s provider=%s status=%s detail=%s next_attempt=%s",
                        candidate_model,
                        provider_label,
                        response.status_code,
                        detail or "n/a",
                        attempt_index + 2,
                    )
                    _sleep_polza_retry(attempt_index)
                    continue

                error_text = f"RouterAI chat error ({response.status_code})"
                if detail:
                    error_text = f"{error_text}: {detail}"

                if _should_try_polza_fallback_model(
                    status_code=response.status_code,
                    detail=detail,
                    candidate_model=candidate_model,
                    candidate_models=candidate_models,
                ):
                    logger.warning(
                        "RouterAI text failed for model=%s provider=%s; trying next configured model. status=%s detail=%s",
                        candidate_model,
                        provider_label,
                        response.status_code,
                        detail or "n/a",
                    )
                    last_error = RuntimeError(error_text)
                    break
                raise RuntimeError(error_text)

            try:
                payload_value = response.json()
            except ValueError as exc:
                last_error = RuntimeError("RouterAI chat returned invalid payload")
                if attempt_index < len(retry_delays):
                    _sleep_polza_retry(attempt_index)
                    continue
                raise last_error from exc

            if not isinstance(payload_value, dict):
                last_error = RuntimeError("RouterAI chat returned invalid payload root")
                if attempt_index < len(retry_delays):
                    _sleep_polza_retry(attempt_index)
                    continue
                raise last_error
            choices = payload_value.get("choices")
            if not isinstance(choices, list) or not choices:
                last_error = RuntimeError("RouterAI chat completed without choices")
                if attempt_index < len(retry_delays):
                    _sleep_polza_retry(attempt_index)
                    continue
                raise last_error
            choice = choices[0] if isinstance(choices[0], dict) else {}
            finish_reason = choice.get("finish_reason") if isinstance(choice.get("finish_reason"), str) else None
            _log_polza_completion_finish(
                mode="text",
                model_name=candidate_model,
                finish_reason=finish_reason,
                usage_payload=payload_value.get("usage"),
                max_tokens=request_max_tokens,
            )
            message_value = choice.get("message")
            if not isinstance(message_value, dict):
                last_error = RuntimeError("RouterAI chat completed without a message payload")
                if attempt_index < len(retry_delays):
                    _sleep_polza_retry(attempt_index)
                    continue
                raise last_error
            result_text = _extract_text_from_model_content(message_value.get("content"))
            if result_text:
                return result_text
            last_error = RuntimeError("RouterAI chat completed without textual content")
            if attempt_index < len(retry_delays):
                _sleep_polza_retry(attempt_index)
                continue
            raise last_error

    if last_error is not None:
        raise last_error
    return ""


def _iter_polza_story_stream_chunks_single_model(
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    *,
    use_plot_memory: bool,
    context_limit_chars: int,
    model_name: str | None,
    temperature: float | None,
    repetition_penalty: float | None,
    frequency_penalty: float | None,
    presence_penalty: float | None,
    top_k: int | None,
    top_p: float | None,
    max_tokens: int | None,
    translate_for_model: bool,
    story_narrator_mode: str | None,
    story_romance_enabled: bool,
    reroll_discarded_assistant_text: str | None,
    show_gg_thoughts: bool,
    show_npc_thoughts: bool,
    story_generation_game_id: int | None,
    story_generation_id: str | None,
):
    emitted_text = False
    for chunk in _iter_polza_story_stream_chunks(
        context_messages,
        instruction_cards,
        plot_cards,
        world_cards,
        use_plot_memory=use_plot_memory,
        context_limit_chars=context_limit_chars,
        model_name=model_name,
        temperature=temperature,
        repetition_penalty=repetition_penalty,
        frequency_penalty=frequency_penalty,
        presence_penalty=presence_penalty,
        top_k=top_k,
        top_p=top_p,
        max_tokens=max_tokens,
        translate_for_model=translate_for_model,
        story_narrator_mode=story_narrator_mode,
        story_romance_enabled=story_romance_enabled,
        reroll_discarded_assistant_text=reroll_discarded_assistant_text,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
        story_generation_game_id=story_generation_game_id,
        story_generation_id=story_generation_id,
    ):
        if str(chunk or "").strip():
            emitted_text = True
        yield chunk
    if not emitted_text:
        raise RuntimeError("RouterAI story stream completed without textual content")


def _iter_story_provider_stream_chunks(
    *,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_chars: int,
    story_model_name: str | None = None,
    story_temperature: float = 1.0,
    story_repetition_penalty: float = STORY_DEFAULT_REPETITION_PENALTY,
    story_top_k: int = 0,
    story_top_r: float = 1.0,
    story_response_max_tokens: int | None = None,
    story_narrator_mode: str | None = None,
    story_romance_enabled: bool = False,
    use_plot_memory: bool = False,
    reroll_discarded_assistant_text: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
    raw_output_collector: dict[str, str] | None = None,
    story_generation_game_id: int | None = None,
    story_generation_id: str | None = None,
):
    provider = _effective_story_llm_provider()

    if provider == "gigachat":
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=settings.gigachat_model,
        )
        input_translation_enabled = _should_translate_story_input_for_model(settings.gigachat_model)
        output_translation_enabled = input_translation_enabled and _is_story_output_translation_enabled()
        raw_chunk_stream = _iter_gigachat_story_stream_chunks(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_chars=context_limit_chars,
            response_max_tokens=effective_response_max_tokens,
            translate_for_model=input_translation_enabled,
            story_narrator_mode=story_narrator_mode,
            story_romance_enabled=story_romance_enabled,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
            story_generation_game_id=story_generation_game_id,
            story_generation_id=story_generation_id,
        )
        if output_translation_enabled:
            yield from _yield_story_translated_stream_chunks(
                raw_chunk_stream,
                source_model_name=settings.gigachat_model,
                force_output_translation=False,
                raw_output_collector=raw_output_collector,
            )
            return

        raw_chunks: list[str] = []
        for chunk in raw_chunk_stream:
            raw_chunks.append(chunk)
            yield chunk
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = "".join(raw_chunks)
        return

    if provider == "polza":
        selected_model_name = (story_model_name or settings.polza_model).strip() or settings.polza_model
        effective_response_max_tokens = _effective_story_response_max_tokens(
            story_response_max_tokens,
            model_name=selected_model_name,
        )
        top_k_value, top_p_value = _select_story_sampling_values(
            model_name=selected_model_name,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
        )
        temperature_value = _select_story_temperature_value(
            model_name=selected_model_name,
            story_temperature=story_temperature,
        )
        repetition_penalty_value = _select_story_repetition_penalty_value(
            model_name=selected_model_name,
            story_repetition_penalty=story_repetition_penalty,
        )
        frequency_penalty_value = _select_story_frequency_penalty_value(
            model_name=selected_model_name,
        )
        presence_penalty_value = _select_story_presence_penalty_value(
            model_name=selected_model_name,
        )
        input_translation_enabled = _should_translate_story_input_for_model(selected_model_name)
        output_translation_enabled = input_translation_enabled and _is_story_output_translation_enabled()
        if _is_story_input_translation_enabled() and not input_translation_enabled:
            logger.info("Story input translation skipped for model=%s", selected_model_name)
        if output_translation_enabled:
            raw_chunk_stream = _iter_polza_story_stream_chunks_single_model(
                context_messages,
                instruction_cards,
                plot_cards,
                world_cards,
                use_plot_memory=use_plot_memory,
                context_limit_chars=context_limit_chars,
                model_name=selected_model_name,
                temperature=temperature_value,
                repetition_penalty=repetition_penalty_value,
                frequency_penalty=frequency_penalty_value,
                presence_penalty=presence_penalty_value,
                top_k=top_k_value,
                top_p=top_p_value,
                max_tokens=effective_response_max_tokens,
                translate_for_model=input_translation_enabled,
                story_narrator_mode=story_narrator_mode,
                story_romance_enabled=story_romance_enabled,
                reroll_discarded_assistant_text=reroll_discarded_assistant_text,
                show_gg_thoughts=show_gg_thoughts,
                show_npc_thoughts=show_npc_thoughts,
                story_generation_game_id=story_generation_game_id,
                story_generation_id=story_generation_id,
            )
            yield from _yield_story_translated_stream_chunks(
                raw_chunk_stream,
                source_model_name=selected_model_name,
                force_output_translation=False,
                raw_output_collector=raw_output_collector,
            )
            return

        # Important: do not force-translate each stream chunk for force models.
        # We stream raw chunks and run one final language enforcement pass on the full text.
        raw_chunks: list[str] = []
        for chunk in _iter_polza_story_stream_chunks_single_model(
            context_messages,
            instruction_cards,
            plot_cards,
            world_cards,
            use_plot_memory=use_plot_memory,
            context_limit_chars=context_limit_chars,
            model_name=selected_model_name,
            temperature=temperature_value,
            repetition_penalty=repetition_penalty_value,
            frequency_penalty=frequency_penalty_value,
            presence_penalty=presence_penalty_value,
            top_k=top_k_value,
            top_p=top_p_value,
            max_tokens=effective_response_max_tokens,
            translate_for_model=input_translation_enabled,
            story_narrator_mode=story_narrator_mode,
            story_romance_enabled=story_romance_enabled,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
            story_generation_game_id=story_generation_game_id,
            story_generation_id=story_generation_id,
        ):
            raw_chunks.append(chunk)
            yield chunk
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = "".join(raw_chunks)
        return

    raise RuntimeError("Story provider is not configured: expected polza or gigachat")
