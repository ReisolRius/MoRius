from __future__ import annotations

from app import main as monolith_main
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
    _ = (story_narrator_mode, story_romance_enabled)
    return monolith_main._build_story_provider_messages(
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


def _should_lock_openrouter_story_request_to_selected_model(model_name: str | None) -> bool:
    _ = model_name
    return False


def _apply_openrouter_story_response_limit(payload: dict[str, Any], max_tokens: int | None) -> None:
    if max_tokens is None:
        return
    payload["max_tokens"] = int(max_tokens)


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


OPENROUTER_RETRY_DELAYS_SECONDS = (1.1, 2.4)
OPENROUTER_TRANSIENT_STATUS_CODES = {500, 502, 503, 504}
OPENROUTER_FALLBACK_STATUS_CODES = {404, 429, *OPENROUTER_TRANSIENT_STATUS_CODES}
OPENROUTER_PROVIDER_TEMPORARY_ERROR_MARKERS = (
    "provider returned error",
    "internal server error",
    "server_error",
    "upstream",
)


def _apply_openrouter_story_reasoning_preferences(
    payload: dict[str, Any],
    *,
    model_name: str | None,
) -> None:
    normalized_model_name = _normalize_story_model_id(model_name)
    if normalized_model_name in {"z-ai/glm-5", "z-ai/glm-5.1"}:
        payload["reasoning"] = {
            "effort": "minimal",
            "exclude": True,
        }
        return
    if normalized_model_name in STORY_DISABLE_THINKING_MODEL_IDS:
        payload["reasoning"] = {"exclude": True}


def _format_openrouter_usage_summary(usage_payload: Any) -> str:
    if not isinstance(usage_payload, dict):
        return ""

    parts: list[str] = []
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        raw_value = usage_payload.get(key)
        if isinstance(raw_value, int):
            parts.append(f"{key}={raw_value}")
    return ", ".join(parts)


def _log_openrouter_completion_finish(
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

    usage_summary = _format_openrouter_usage_summary(usage_payload)
    logger.info(
        "OpenRouter %s finish: model=%s finish_reason=%s max_tokens=%s usage=%s",
        mode,
        model_name,
        normalized_finish_reason,
        max_tokens,
        usage_summary or "n/a",
    )
    if normalized_finish_reason.casefold() == "length":
        logger.warning(
            "OpenRouter %s response hit token limit: model=%s max_tokens=%s usage=%s",
            mode,
            model_name,
            max_tokens,
            usage_summary or "n/a",
        )


def _extract_openrouter_chat_error_detail(response: requests.Response) -> str:
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


def _is_openrouter_temporary_provider_failure(status_code: int, detail: str) -> bool:
    if status_code in OPENROUTER_TRANSIENT_STATUS_CODES:
        return True
    normalized_detail = str(detail or "").casefold()
    return any(marker in normalized_detail for marker in OPENROUTER_PROVIDER_TEMPORARY_ERROR_MARKERS)


def _should_retry_openrouter_chat_request(*, status_code: int, detail: str, attempt_index: int) -> bool:
    if attempt_index >= len(OPENROUTER_RETRY_DELAYS_SECONDS):
        return False
    if status_code == 429:
        return True
    return _is_openrouter_temporary_provider_failure(status_code, detail)


def _should_try_openrouter_fallback_model(
    *,
    status_code: int,
    detail: str,
    candidate_model: str,
    candidate_models: list[str],
) -> bool:
    if candidate_model == candidate_models[-1]:
        return False
    if status_code in OPENROUTER_FALLBACK_STATUS_CODES:
        return True
    return _is_openrouter_temporary_provider_failure(status_code, detail)


def _sleep_openrouter_retry(attempt_index: int) -> None:
    normalized_index = max(0, min(attempt_index, len(OPENROUTER_RETRY_DELAYS_SECONDS) - 1))
    time.sleep(OPENROUTER_RETRY_DELAYS_SECONDS[normalized_index])


def _resolve_openrouter_story_provider_payload_for_attempt(
    model_name: str | None,
    attempt_index: int,
) -> dict[str, Any] | None:
    provider_payload = _build_openrouter_provider_payload(model_name)
    if provider_payload is None:
        return None
    if attempt_index == 0:
        return provider_payload
    return None


def _resolve_openrouter_provider_attempt_label(provider_payload: dict[str, Any] | None) -> str:
    if not provider_payload:
        return "auto"
    order_value = provider_payload.get("order")
    if isinstance(order_value, list) and order_value:
        return ",".join(str(item).strip() for item in order_value if str(item).strip()) or "auto"
    return "auto"


def _build_openrouter_story_candidate_models(
    primary_model: str,
    *,
    allow_free_fallback: bool,
    fallback_model_names: list[str] | None = None,
) -> list[str]:
    candidate_models = [primary_model]
    normalized_primary_model = _normalize_story_model_id(primary_model)

    if normalized_primary_model == "aion-labs/aion-2.0":
        for fallback_model in ("deepseek/deepseek-v3.2", "z-ai/glm-5"):
            if fallback_model not in candidate_models:
                candidate_models.append(fallback_model)

    if fallback_model_names:
        for fallback_model in fallback_model_names:
            normalized_fallback_model = str(fallback_model or "").strip()
            if not normalized_fallback_model or normalized_fallback_model in candidate_models:
                continue
            candidate_models.append(normalized_fallback_model)

    if allow_free_fallback and primary_model != "openrouter/free" and "openrouter/free" not in candidate_models:
        candidate_models.append("openrouter/free")

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
        for raw_line in response.iter_lines(
            chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
            decode_unicode=True,
        ):
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
        response.close()

def _iter_openrouter_story_stream_chunks(
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
):
    def _extract_story_novel_suffix(base_text: str, candidate_text: str) -> str:
        normalized_base = base_text or ""
        normalized_candidate = candidate_text or ""
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
        raise RuntimeError("No messages to send to OpenRouter")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    primary_model = (model_name or settings.openrouter_model).strip()
    if not primary_model:
        raise RuntimeError("OpenRouter chat model is not configured")

    candidate_models = _build_openrouter_story_candidate_models(
        primary_model,
        allow_free_fallback=not _should_lock_openrouter_story_request_to_selected_model(primary_model),
    )

    last_error: RuntimeError | None = None

    for model_name in candidate_models:
        for attempt_index in range(len(OPENROUTER_RETRY_DELAYS_SECONDS) + 1):
            payload = {
                "model": model_name,
                "messages": messages_payload,
                "stream": True,
            }
            provider_payload = _resolve_openrouter_story_provider_payload_for_attempt(
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
            _apply_openrouter_story_response_limit(payload, max_tokens)
            _apply_openrouter_story_reasoning_preferences(payload, model_name=model_name)
            provider_label = _resolve_openrouter_provider_attempt_label(provider_payload)
            request_started_at_attempt = time.monotonic()
            logger.info(
                "OpenRouter stream request started: model=%s provider=%s attempt=%s",
                model_name,
                provider_label,
                attempt_index + 1,
            )
            try:
                response = HTTP_SESSION.post(
                    settings.openrouter_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=(20, 120),
                    stream=True,
                )
            except requests.RequestException as exc:
                if attempt_index < len(OPENROUTER_RETRY_DELAYS_SECONDS):
                    logger.warning(
                        "OpenRouter stream request transport failed; retrying: model=%s provider=%s attempt=%s error=%s",
                        model_name,
                        provider_label,
                        attempt_index + 1,
                        exc,
                    )
                    _sleep_openrouter_retry(attempt_index)
                    continue
                raise RuntimeError("Failed to reach OpenRouter chat endpoint") from exc

            try:
                logger.info(
                    "OpenRouter stream response opened: model=%s provider=%s status=%s latency=%.3fs",
                    model_name,
                    provider_label,
                    response.status_code,
                    time.monotonic() - request_started_at_attempt,
                )
                if response.status_code >= 400:
                    detail = _extract_openrouter_chat_error_detail(response)

                    if _should_retry_openrouter_chat_request(
                        status_code=response.status_code,
                        detail=detail,
                        attempt_index=attempt_index,
                    ):
                        logger.warning(
                            "OpenRouter stream temporary failure; retrying same model: model=%s provider=%s status=%s detail=%s next_attempt=%s",
                            model_name,
                            provider_label,
                            response.status_code,
                            detail or "n/a",
                            attempt_index + 2,
                        )
                        _sleep_openrouter_retry(attempt_index)
                        continue

                    error_text = f"OpenRouter chat error ({response.status_code})"
                    if detail:
                        error_text = f"{error_text}: {detail}"

                    if _should_try_openrouter_fallback_model(
                        status_code=response.status_code,
                        detail=detail,
                        candidate_model=model_name,
                        candidate_models=candidate_models,
                    ):
                        logger.warning(
                            "OpenRouter stream failed for model=%s provider=%s; trying fallback model. status=%s detail=%s",
                            model_name,
                            provider_label,
                            response.status_code,
                            detail or "n/a",
                        )
                        last_error = RuntimeError(error_text)
                        break

                    raise RuntimeError(error_text)

                # SSE stream text is UTF-8; requests may default text/* to latin-1 without charset.
                response.encoding = "utf-8"
                emitted_delta = False
                emitted_text_parts: list[str] = []
                first_content_emitted_at: float | None = None
                last_keepalive_at = time.monotonic()
                finish_reason: str | None = None
                usage_payload: Any = None
                saw_done_marker = False
                try:
                    for raw_line in response.iter_lines(
                        chunk_size=STORY_STREAM_HTTP_CHUNK_SIZE_BYTES,
                        decode_unicode=True,
                    ):
                        current_time = time.monotonic()
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
                        except json.JSONDecodeError:
                            continue

                        if isinstance(chunk_payload.get("usage"), dict):
                            usage_payload = chunk_payload.get("usage")

                        error_value = chunk_payload.get("error")
                        if isinstance(error_value, dict):
                            error_detail = str(error_value.get("message") or error_value.get("code") or "").strip()
                            raise RuntimeError(error_detail or "OpenRouter stream returned an error")
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
                                        "OpenRouter stream first token latency: %.3fs model=%s",
                                        first_content_emitted_at - request_started_at,
                                        model_name,
                                    )
                                for chunk in _yield_story_stream_chunks_with_pacing(content_delta):
                                    yield chunk
                                continue
                            if not emitted_delta and current_time - last_keepalive_at >= 8.0:
                                last_keepalive_at = current_time
                                yield ""

                        if emitted_delta:
                            continue

                        message_value = choice.get("message")
                        if isinstance(message_value, dict):
                            content_value = _extract_text_from_model_content(message_value.get("content"))
                            if content_value:
                                emitted_delta = True
                                emitted_text_parts.append(content_value)
                                if first_content_emitted_at is None:
                                    first_content_emitted_at = time.monotonic()
                                    logger.info(
                                        "OpenRouter stream first token latency (message payload): %.3fs model=%s",
                                        first_content_emitted_at - request_started_at,
                                        model_name,
                                    )
                                for chunk in _yield_story_stream_chunks_with_pacing(content_value):
                                    yield chunk
                                break
                except requests.RequestException as exc:
                    raise RuntimeError("Failed while reading OpenRouter chat stream") from exc

                if emitted_delta:
                    _log_openrouter_completion_finish(
                        mode="stream",
                        model_name=model_name,
                        finish_reason=finish_reason,
                        usage_payload=usage_payload,
                        max_tokens=max_tokens,
                    )
                    emitted_text = "".join(emitted_text_parts)
                    stream_closed_unexpectedly = not saw_done_marker and not str(finish_reason or "").strip()
                    model_hit_length_limit = str(finish_reason or "").strip().casefold() == "length"
                    should_try_recovery = stream_closed_unexpectedly or (model_hit_length_limit and max_tokens is None)
                    if should_try_recovery:
                        fallback_max_tokens = max_tokens
                        if fallback_max_tokens is None and model_hit_length_limit:
                            fallback_max_tokens = max(STORY_DEFAULT_RESPONSE_MAX_TOKENS * 3, 1_200)
                        logger.warning(
                            "OpenRouter stream may be incomplete; attempting tail recovery: model=%s finish_reason=%s done=%s fallback_max_tokens=%s",
                            model_name,
                            finish_reason or "",
                            saw_done_marker,
                            fallback_max_tokens,
                        )
                        fallback_text = _request_openrouter_story_text(
                            messages_payload,
                            model_name=model_name,
                            allow_free_fallback=False,
                            temperature=temperature,
                            top_k=top_k,
                            top_p=top_p,
                            max_tokens=fallback_max_tokens,
                        )
                        suffix_text = _extract_story_novel_suffix(emitted_text, fallback_text)
                        if suffix_text:
                            logger.info(
                                "OpenRouter stream recovery appended tail: model=%s chars=%s",
                                model_name,
                                len(suffix_text),
                            )
                            for chunk in _yield_story_stream_chunks_with_pacing(suffix_text):
                                yield chunk
                    return

                raise RuntimeError("OpenRouter stream completed without textual content")
            finally:
                response.close()

        if model_name == candidate_models[-1] and last_error is not None:
            raise last_error

    if last_error is not None:
        raise last_error

    raise RuntimeError("OpenRouter chat request failed")

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

def _request_openrouter_story_text(
    messages_payload: list[dict[str, str]],
    *,
    model_name: str | None = None,
    allow_free_fallback: bool = True,
    translate_input: bool = True,
    fallback_model_names: list[str] | None = None,
    temperature: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
    top_k: int | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    request_timeout: tuple[int, int] | None = None,
) -> str:
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    primary_model = (model_name or settings.openrouter_model).strip()
    if not primary_model:
        raise RuntimeError("OpenRouter chat model is not configured")

    candidate_models = _build_openrouter_story_candidate_models(
        primary_model,
        allow_free_fallback=allow_free_fallback,
        fallback_model_names=fallback_model_names,
    )

    last_error: RuntimeError | None = None
    timeout_value = request_timeout or (20, 120)
    prepared_messages_payload = _prepare_story_messages_for_model(
        messages_payload,
        translate_input=translate_input,
    )
    for candidate_model in candidate_models:
        for attempt_index in range(len(OPENROUTER_RETRY_DELAYS_SECONDS) + 1):
            payload = {
                "model": candidate_model,
                "messages": prepared_messages_payload,
                "stream": False,
            }
            provider_payload = _resolve_openrouter_story_provider_payload_for_attempt(
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
            _apply_openrouter_story_response_limit(payload, max_tokens)
            _apply_openrouter_story_reasoning_preferences(payload, model_name=candidate_model)
            provider_label = _resolve_openrouter_provider_attempt_label(provider_payload)
            request_started_at = time.monotonic()
            logger.info(
                "OpenRouter text request started: model=%s provider=%s attempt=%s",
                candidate_model,
                provider_label,
                attempt_index + 1,
            )
            try:
                response = HTTP_SESSION.post(
                    settings.openrouter_chat_url,
                    headers=headers,
                    json=payload,
                    timeout=timeout_value,
                )
            except requests.RequestException as exc:
                if attempt_index < len(OPENROUTER_RETRY_DELAYS_SECONDS):
                    logger.warning(
                        "OpenRouter text transport failed; retrying: model=%s provider=%s attempt=%s error=%s",
                        candidate_model,
                        provider_label,
                        attempt_index + 1,
                        exc,
                    )
                    _sleep_openrouter_retry(attempt_index)
                    continue
                raise RuntimeError("Failed to reach OpenRouter chat endpoint") from exc

            logger.info(
                "OpenRouter text response received: model=%s provider=%s status=%s latency=%.3fs",
                candidate_model,
                provider_label,
                response.status_code,
                time.monotonic() - request_started_at,
            )

            if response.status_code >= 400:
                detail = _extract_openrouter_chat_error_detail(response)

                if _should_retry_openrouter_chat_request(
                    status_code=response.status_code,
                    detail=detail,
                    attempt_index=attempt_index,
                ):
                    logger.warning(
                        "OpenRouter text temporary failure; retrying same model: model=%s provider=%s status=%s detail=%s next_attempt=%s",
                        candidate_model,
                        provider_label,
                        response.status_code,
                        detail or "n/a",
                        attempt_index + 2,
                    )
                    _sleep_openrouter_retry(attempt_index)
                    continue

                error_text = f"OpenRouter chat error ({response.status_code})"
                if detail:
                    error_text = f"{error_text}: {detail}"

                if _should_try_openrouter_fallback_model(
                    status_code=response.status_code,
                    detail=detail,
                    candidate_model=candidate_model,
                    candidate_models=candidate_models,
                ):
                    logger.warning(
                        "OpenRouter text failed for model=%s provider=%s; trying fallback model. status=%s detail=%s",
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
                raise RuntimeError("OpenRouter chat returned invalid payload") from exc

            if not isinstance(payload_value, dict):
                return ""
            choices = payload_value.get("choices")
            if not isinstance(choices, list) or not choices:
                return ""
            choice = choices[0] if isinstance(choices[0], dict) else {}
            finish_reason = choice.get("finish_reason") if isinstance(choice.get("finish_reason"), str) else None
            _log_openrouter_completion_finish(
                mode="text",
                model_name=candidate_model,
                finish_reason=finish_reason,
                usage_payload=payload_value.get("usage"),
                max_tokens=max_tokens,
            )
            message_value = choice.get("message")
            if not isinstance(message_value, dict):
                return ""
            return _extract_text_from_model_content(message_value.get("content"))

    if last_error is not None:
        raise last_error
    return ""

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

    if provider == "openrouter":
        selected_model_name = (story_model_name or settings.openrouter_model).strip() or settings.openrouter_model
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
            raw_chunk_stream = _iter_openrouter_story_stream_chunks(
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
        for chunk in _iter_openrouter_story_stream_chunks(
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
        ):
            raw_chunks.append(chunk)
            yield chunk
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = "".join(raw_chunks)
        return

    raise RuntimeError("Story provider is not configured: expected openrouter or gigachat")
