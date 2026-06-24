from __future__ import annotations

from app import main as monolith_main
from app.services.text_encoding import repair_likely_utf8_mojibake_deep, sanitize_likely_utf8_mojibake


def _bind_monolith_names() -> None:
    module_globals = globals()
    for name in dir(monolith_main):
        if name.startswith("__"):
            continue
        module_globals.setdefault(name, getattr(monolith_main, name))


_bind_monolith_names()


def _normalize_story_message_content(value: str | None) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


STORY_CONTINUE_PROMPT_MARKERS = {
    "продолжай",
    "продолжить",
    "continue",
}
STORY_CONTINUE_PROMPT_REPLACEMENT = (
    "Продолжай текущую сцену строго с того места, где остановился предыдущий ответ рассказчика. "
    "Не повторяй уже написанные фразы, описания и действия. Добавь новое событие, реакцию, последствие или выбор, "
    "сохраняя стиль и причинно-следственную связь."
)


def _normalize_story_continue_prompt_marker(value: str) -> str:
    return " ".join(value.replace("\r\n", " ").replace("\n", " ").split()).strip(" \t.!?…:;,-").casefold()


def _is_story_continue_prompt(value: str) -> bool:
    return _normalize_story_continue_prompt_marker(value) in STORY_CONTINUE_PROMPT_MARKERS


def _translate_text_batch_with_polza(
    texts: list[str],
    *,
    source_language: str,
    target_language: str,
    translation_model_name: str | None = None,
) -> list[str]:
    if not texts:
        return []
    selected_translation_model = (translation_model_name or _story_output_translation_model_name()).strip()
    if not selected_translation_model:
        raise RuntimeError("Polza.ai translation model is not configured")

    translation_messages = [
        {
            "role": "system",
            "content": (
                "Translate each text preserving meaning, tone, line breaks, and every [[...]] marker exactly. "
                "Keep identifier names/card titles unchanged. For Russian, write natural Russian and remove accidental English/CJK leakage unless fixed. "
                "Return JSON only: an array of strings in the same order and count. No reasoning, comments, or markdown."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "source_language": source_language,
                    "target_language": target_language,
                    "texts": texts,
                },
                ensure_ascii=False,
            ),
        },
    ]
    source_tokens_estimate = sum(max(_estimate_story_tokens(text_value), 1) for text_value in texts)
    translation_max_tokens = max(256, min(source_tokens_estimate * 2 + 256, 3_200))
    raw_response = _request_polza_story_text(
        translation_messages,
        model_name=selected_translation_model,
        allow_service_fallback=False,
        translate_input=False,
        temperature=0,
        max_tokens=translation_max_tokens,
        request_timeout=(
            STORY_POSTPROCESS_CONNECT_TIMEOUT_SECONDS,
            max(STORY_POSTPROCESS_READ_TIMEOUT_SECONDS, 30),
        ),
    )
    parsed_payload = _extract_json_array_from_text(raw_response)
    if not isinstance(parsed_payload, list):
        raise RuntimeError("Polza.ai translation returned malformed payload")

    translated_texts: list[str] = []
    for item in parsed_payload:
        if isinstance(item, str):
            translated_texts.append(item)
            continue
        if isinstance(item, dict):
            text_value = item.get("text")
            if isinstance(text_value, str):
                translated_texts.append(text_value)

    if len(translated_texts) != len(texts):
        raise RuntimeError("Polza.ai translation returned incomplete translations")

    for index, (source_text, translated_text) in enumerate(zip(texts, translated_texts)):
        if _is_story_markup_preserved(source_text, translated_text):
            continue
        logger.warning("Translation changed story markup at index=%s; using source text", index)
        translated_texts[index] = source_text

    return translated_texts

def _translate_texts_with_polza(
    texts: list[str],
    *,
    source_language: str,
    target_language: str,
) -> list[str]:
    if not texts:
        return []
    if source_language == target_language:
        return texts

    translated_texts = list(texts)
    non_empty_items = [(index, text_value) for index, text_value in enumerate(texts) if text_value.strip()]
    if not non_empty_items:
        return translated_texts

    max_batch_items = 12
    max_batch_chars = 12_000
    batch_indices: list[int] = []
    batch_texts: list[str] = []
    batch_chars = 0

    def flush_batch() -> None:
        nonlocal batch_indices, batch_texts, batch_chars
        if not batch_texts:
            return
        translated_batch = _translate_text_batch_with_polza(
            batch_texts,
            source_language=source_language,
            target_language=target_language,
        )
        for position, translated_value in zip(batch_indices, translated_batch):
            translated_texts[position] = translated_value
        batch_indices = []
        batch_texts = []
        batch_chars = 0

    for index, text_value in non_empty_items:
        text_len = len(text_value)
        should_flush = batch_texts and (
            len(batch_texts) >= max_batch_items or batch_chars + text_len > max_batch_chars
        )
        if should_flush:
            flush_batch()

        batch_indices.append(index)
        batch_texts.append(text_value)
        batch_chars += text_len

    flush_batch()
    return translated_texts

def _translate_story_messages_for_model(messages_payload: list[dict[str, str]]) -> list[dict[str, str]]:
    if not _is_story_input_translation_enabled():
        return messages_payload

    source_language = "auto"
    target_language = _story_model_language_code()
    raw_texts = [message.get("content", "") for message in messages_payload]
    translated_texts = _translate_texts_with_polza(
        raw_texts,
        source_language=source_language,
        target_language=target_language,
    )
    translated_messages: list[dict[str, str]] = []
    for message, translated_content in zip(messages_payload, translated_texts):
        translated_messages.append({"role": message["role"], "content": translated_content})
    return translated_messages

def _prepare_story_messages_for_model(
    messages_payload: list[dict[str, str]],
    *,
    translate_input: bool = True,
) -> list[dict[str, str]]:
    if not translate_input:
        return messages_payload
    try:
        return _translate_story_messages_for_model(messages_payload)
    except Exception as exc:
        logger.warning("Story input translation failed: %s", exc)
        return messages_payload

def _translate_story_model_output_to_user(text_value: str) -> str:
    if not text_value.strip():
        return text_value
    if not _is_story_output_translation_enabled():
        return text_value
    source_language = "auto"
    target_language = _story_user_language_code()
    translated = _translate_texts_with_polza(
        [text_value],
        source_language=source_language,
        target_language=target_language,
    )
    return translated[0] if translated else text_value

def _force_translate_story_model_output_to_user(
    text_value: str,
    *,
    source_model_name: str | None = None,
) -> str:
    if not text_value.strip():
        return text_value
    if not _can_force_story_output_translation(source_model_name):
        return text_value
    target_language = "ru" if _is_story_output_translation_model(source_model_name) else _story_user_language_code()
    translated = _translate_text_batch_with_polza(
        [text_value],
        source_language="auto",
        target_language=target_language,
        translation_model_name=_story_output_translation_model_name(source_model_name),
    )
    return translated[0] if translated else text_value

def _split_story_translation_stream_buffer(
    buffer: str,
    *,
    force: bool = False,
) -> tuple[str, str]:
    if not buffer:
        return ("", "")

    min_chars = max(int(STORY_STREAM_TRANSLATION_MIN_CHARS), 1)
    max_chars = max(int(STORY_STREAM_TRANSLATION_MAX_CHARS), min_chars)
    if not force and len(buffer) < min_chars:
        return ("", buffer)

    search_limit = min(len(buffer), max_chars)
    cut_index = -1
    for index in range(search_limit - 1, -1, -1):
        if buffer[index] in {".", "!", "?", "…", "\n"}:
            cut_index = index + 1
            break

    if cut_index < min_chars:
        if not force and len(buffer) <= max_chars:
            return ("", buffer)
        cut_index = search_limit
        if cut_index < len(buffer):
            whitespace_index = buffer.rfind(" ", min_chars, cut_index)
            if whitespace_index >= min_chars:
                cut_index = whitespace_index + 1

    if cut_index <= 0:
        return ("", buffer)

    return (buffer[:cut_index], buffer[cut_index:])

def _translate_story_stream_output_chunk(
    text_value: str,
    *,
    source_model_name: str | None = None,
    force_output_translation: bool = False,
) -> str:
    if not text_value:
        return text_value
    if _story_user_language_code() == "ru":
        return text_value
    try:
        if force_output_translation and not _is_story_output_translation_enabled():
            return _force_translate_story_model_output_to_user(
                text_value,
                source_model_name=source_model_name,
            )
        return _translate_story_model_output_to_user(text_value)
    except Exception as exc:
        logger.warning("Story output streaming translation failed: %s", exc)
        return text_value

def _yield_story_translated_stream_chunks(
    raw_chunks: Any,
    *,
    source_model_name: str | None = None,
    force_output_translation: bool = False,
    raw_output_collector: dict[str, str] | None = None,
):
    raw_chunks_collected: list[str] = []
    pending_buffer = ""

    for raw_chunk in raw_chunks:
        if not isinstance(raw_chunk, str):
            continue
        raw_chunks_collected.append(raw_chunk)
        if not raw_chunk:
            continue

        pending_buffer += raw_chunk
        while pending_buffer:
            segment, remainder = _split_story_translation_stream_buffer(
                pending_buffer,
                force=False,
            )
            if not segment:
                break
            pending_buffer = remainder
            translated_segment = _translate_story_stream_output_chunk(
                segment,
                source_model_name=source_model_name,
                force_output_translation=force_output_translation,
            )
            if not translated_segment:
                continue
            for chunk in _yield_story_stream_chunks_with_pacing(translated_segment):
                yield chunk

    while pending_buffer:
        segment, remainder = _split_story_translation_stream_buffer(
            pending_buffer,
            force=True,
        )
        if not segment:
            segment, remainder = pending_buffer, ""
        pending_buffer = remainder
        translated_segment = _translate_story_stream_output_chunk(
            segment,
            source_model_name=source_model_name,
            force_output_translation=force_output_translation,
        )
        if not translated_segment:
            continue
        for chunk in _yield_story_stream_chunks_with_pacing(translated_segment):
            yield chunk

    if raw_output_collector is not None:
        raw_output_collector["raw_output"] = "".join(raw_chunks_collected)

def _strip_story_markup_for_language_detection(text_value: str) -> str:
    normalized = _normalize_story_message_content(text_value)
    return STORY_MARKUP_MARKER_PATTERN.sub(" ", normalized)

def _should_force_story_output_to_russian(text_value: str, *, model_name: str | None = None) -> bool:
    if _story_user_language_code() != "ru":
        return False
    if not _can_force_story_output_translation(model_name):
        return False

    stripped = _strip_story_markup_for_language_detection(text_value).strip()
    if not stripped:
        return False
    if STORY_CJK_CHARACTER_PATTERN.search(stripped):
        return True

    cyrillic_letters = len(STORY_CYRILLIC_LETTER_PATTERN.findall(stripped))
    latin_letters = len(STORY_LATIN_LETTER_PATTERN.findall(stripped))
    latin_words = len(STORY_LATIN_WORD_PATTERN.findall(stripped))

    if cyrillic_letters == 0 and latin_letters >= 2:
        return True
    if latin_words >= 1:
        return True
    if latin_letters >= 2 and cyrillic_letters == 0:
        return True
    if latin_letters >= 2 and latin_letters > cyrillic_letters * 0.03:
        return True
    if latin_letters >= 1 and latin_letters > max(cyrillic_letters, 1) * 0.12:
        return True
    return False

def _sanitize_story_mixed_script_token(token: str) -> str:
    has_cyrillic = STORY_CYRILLIC_LETTER_PATTERN.search(token) is not None
    has_latin = STORY_LATIN_LETTER_PATTERN.search(token) is not None
    if has_cyrillic and has_latin:
        return token.translate(STORY_LATIN_TO_CYRILLIC_LOOKALIKE_TABLE)
    return token

def _sanitize_story_russian_output_segment(text_value: str) -> str:
    normalized = _normalize_story_message_content(text_value)
    if not normalized:
        return normalized

    cleaned = STORY_CJK_CHARACTER_PATTERN.sub(" ", normalized)
    cleaned = re.sub(
        r"[A-Za-z\u0400-\u04FF0-9'-]+",
        lambda match: _sanitize_story_mixed_script_token(match.group(0)),
        cleaned,
    )
    cleaned = STORY_NON_RUSSIAN_SYMBOL_PATTERN.sub(" ", cleaned)
    cleaned = re.sub(r"([.,!?;:])(?![\s\n»”\"')\]])", r"\1 ", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def _sanitize_story_russian_output_contract(text_value: str) -> str:
    normalized = _normalize_story_message_content(text_value)
    if not normalized:
        return normalized

    fragments: list[str] = []
    cursor = 0
    for marker_match in STORY_MARKUP_MARKER_PATTERN.finditer(normalized):
        marker_start, marker_end = marker_match.span()
        if marker_start > cursor:
            fragments.append(_sanitize_story_russian_output_segment(normalized[cursor:marker_start]))
        fragments.append(marker_match.group(0))
        cursor = marker_end

    if cursor < len(normalized):
        fragments.append(_sanitize_story_russian_output_segment(normalized[cursor:]))

    sanitized = "".join(fragments).strip()
    if not sanitized:
        return normalized
    sanitized = re.sub(r"[ \t]+\n", "\n", sanitized)
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    return sanitized.strip()

def _enforce_story_output_language(text_value: str, *, model_name: str | None = None) -> str:
    normalized = _normalize_story_message_content(text_value)
    if not normalized:
        return normalized

    normalized = _strip_story_model_meta_preamble(normalized)
    if _story_user_language_code() == "ru":
        candidate_output = normalized
        if _should_force_story_output_to_russian(candidate_output, model_name=model_name):
            try:
                translated = _force_translate_story_model_output_to_user(candidate_output, source_model_name=model_name)
                translated_normalized = _strip_story_model_meta_preamble(_normalize_story_message_content(translated))
                if translated_normalized:
                    candidate_output = translated_normalized
            except Exception as exc:
                logger.warning("Forced Russian story output translation failed: %s", exc)

        return candidate_output

    should_force_russian = _should_force_story_output_to_russian(normalized, model_name=model_name)
    candidate_output = normalized

    if should_force_russian:
        try:
            translated = _force_translate_story_model_output_to_user(normalized, source_model_name=model_name)
            translated_normalized = _normalize_story_message_content(translated)
            if translated_normalized:
                candidate_output = translated_normalized
        except Exception as exc:
            logger.warning("Forced story output translation failed: %s", exc)

    return candidate_output

def _trim_story_history_to_context_limit(
    history: list[dict[str, str]],
    context_limit_tokens: int,
) -> list[dict[str, str]]:
    if not history:
        return []

    limit = max(int(context_limit_tokens), 0)
    if limit <= 0:
        return []

    selected_reversed: list[dict[str, str]] = []
    consumed_tokens = 0

    for item in reversed(history):
        content = item.get("content", "")
        if not content:
            continue
        entry_cost = _estimate_story_tokens(content) + 4
        if consumed_tokens + entry_cost <= limit:
            selected_reversed.append(item)
            consumed_tokens += entry_cost
            continue

        if not selected_reversed:
            max_content_tokens = max(limit - 4, 1)
            selected_reversed.append(
                {
                    "role": item.get("role", STORY_USER_ROLE),
                    "content": _trim_story_text_tail_by_tokens(content, max_content_tokens),
                }
            )
        break

    selected_reversed.reverse()
    return selected_reversed

def _estimate_story_history_tokens(history: list[dict[str, str]]) -> int:
    total = 0
    for item in history:
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        total += _estimate_story_tokens(content) + 4
    return total

def _summarize_story_prompt_memory_cards(plot_cards: list[dict[str, str]]) -> tuple[dict[str, int], str]:
    summary = {
        "key": 0,
        "location": 0,
        "environment": 0,
        "weather": 0,
        "raw": 0,
        "compressed": 0,
        "super": 0,
        "other": 0,
    }
    preview_titles: list[str] = []

    for card in plot_cards:
        title = " ".join(str(card.get("title", "")).replace("\r\n", " ").split()).strip()
        if not title:
            continue
        if title.startswith("Важный момент:"):
            summary["key"] += 1
        elif title.startswith("Место:"):
            summary["location"] += 1
        elif title.startswith("Окружение:"):
            summary["environment"] += 1
        elif title.startswith("Погода:"):
            summary["weather"] += 1
        elif title.startswith("Свежая память:"):
            summary["raw"] += 1
        elif title.startswith("Сжатая память:"):
            summary["compressed"] += 1
        elif title.startswith("Суперсжатая память:"):
            summary["super"] += 1
        else:
            summary["other"] += 1
        if len(preview_titles) < 6:
            preview_titles.append(_normalize_story_prompt_text(title, max_chars=48))

    return (summary, " | ".join(title for title in preview_titles if title))

def _select_story_history_source(
    history: list[dict[str, str]],
    *,
    use_plot_memory: bool,
) -> list[dict[str, str]]:
    if not use_plot_memory:
        return history

    # When plot-memory optimization is enabled, do not send dialogue history.
    # Keep only the latest user turn, except turn 1 where opening scene context
    # (seeded as the first assistant message) must be preserved.
    latest_user_index: int | None = None
    latest_user_content = ""
    user_turn_count = 0
    for index, item in enumerate(history):
        role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
        content = str(item.get("content", "")).strip()
        if role != STORY_USER_ROLE or not content:
            continue
        user_turn_count += 1
        latest_user_index = index
        latest_user_content = content

    if latest_user_index is None:
        return []

    latest_user_turn = {"role": STORY_USER_ROLE, "content": latest_user_content}

    if _is_story_continue_prompt(latest_user_content):
        latest_user_turn = {"role": STORY_USER_ROLE, "content": STORY_CONTINUE_PROMPT_REPLACEMENT}
        previous_assistant_turn: dict[str, str] | None = None
        previous_user_turn: dict[str, str] | None = None
        previous_assistant_index: int | None = None
        for index in range(latest_user_index - 1, -1, -1):
            item = history[index]
            role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            content = str(item.get("content", "")).strip()
            if role != STORY_ASSISTANT_ROLE or not content:
                continue
            previous_assistant_turn = {"role": STORY_ASSISTANT_ROLE, "content": content}
            previous_assistant_index = index
            break
        if previous_assistant_index is not None:
            for item in reversed(history[:previous_assistant_index]):
                role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
                content = str(item.get("content", "")).strip()
                if role != STORY_USER_ROLE or not content:
                    continue
                previous_user_turn = {"role": STORY_USER_ROLE, "content": content}
                break
        selected_turns = [
            item
            for item in (previous_user_turn, previous_assistant_turn, latest_user_turn)
            if item is not None
        ]
        if selected_turns:
            return selected_turns

    # Ensure the opening scene is present for the very first user turn.
    # Runtime seeds opening_scene as the first assistant message before turn 1.
    if user_turn_count == 1:
        for item in reversed(history[:latest_user_index]):
            role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            content = str(item.get("content", "")).strip()
            if role != STORY_ASSISTANT_ROLE or not content:
                continue
            return [
                {"role": STORY_ASSISTANT_ROLE, "content": content},
                latest_user_turn,
            ]

    return [latest_user_turn]


def _extract_story_character_state_prompt_cards_for_guidance(
    plot_cards: list[dict[str, str]],
) -> list[dict[str, str]]:
    is_prompt_card = getattr(monolith_main, "_is_story_character_state_prompt_card", None)
    main_hero_title = sanitize_likely_utf8_mojibake(
        str(getattr(monolith_main, "STORY_CHARACTER_STATE_MAIN_HERO_PROMPT_TITLE", "Состояние: Главный герой"))
    )
    npc_title_prefix = sanitize_likely_utf8_mojibake(
        str(getattr(monolith_main, "STORY_CHARACTER_STATE_NPC_PROMPT_TITLE_PREFIX", "Состояние NPC:"))
    )
    extracted_cards: list[dict[str, str]] = []
    for card in plot_cards:
        title = " ".join(sanitize_likely_utf8_mojibake(str(card.get("title", ""))).replace("\r\n", " ").split()).strip()
        content = sanitize_likely_utf8_mojibake(str(card.get("content", ""))).replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        if callable(is_prompt_card):
            try:
                if not bool(is_prompt_card(title)):
                    continue
            except Exception:
                if title != main_hero_title and not title.startswith(f"{npc_title_prefix} "):
                    continue
        elif title != main_hero_title and not title.startswith(f"{npc_title_prefix} "):
            continue
        extracted_cards.append({"title": title, "content": content})
    return extracted_cards


def _extract_story_character_state_prompt_field_local(content: str, label: str) -> str:
    extractor = getattr(monolith_main, "_extract_story_character_state_prompt_field", None)
    normalized_label = sanitize_likely_utf8_mojibake(label)
    normalized_content_for_extractor = sanitize_likely_utf8_mojibake(content)
    if callable(extractor):
        try:
            return str(extractor(normalized_content_for_extractor, normalized_label) or "").strip()
        except Exception:
            pass
    normalized_content = str(normalized_content_for_extractor or "").replace("\r\n", "\n").strip()
    if not normalized_content or not normalized_label:
        return ""
    for raw_line in normalized_content.split("\n"):
        line = raw_line.strip()
        if not line.startswith(normalized_label):
            continue
        return line[len(normalized_label) :].strip()
    return ""


def _build_story_character_state_guidance_cards_payload(
    plot_cards: list[dict[str, str]],
) -> list[dict[str, Any]]:
    main_hero_title = sanitize_likely_utf8_mojibake(
        str(getattr(monolith_main, "STORY_CHARACTER_STATE_MAIN_HERO_PROMPT_TITLE", "Состояние: Главный герой"))
    )
    npc_title_prefix = sanitize_likely_utf8_mojibake(
        str(getattr(monolith_main, "STORY_CHARACTER_STATE_NPC_PROMPT_TITLE_PREFIX", "Состояние NPC:"))
    )
    guidance_cards: list[dict[str, Any]] = []
    for card in _extract_story_character_state_prompt_cards_for_guidance(plot_cards):
        raw_title = card["title"]
        raw_content = sanitize_likely_utf8_mojibake(card["content"])
        if raw_title == main_hero_title:
            kind = "main_hero"
            name = "Main hero"
        elif raw_title.startswith(f"{npc_title_prefix} "):
            kind = "npc"
            name = raw_title[len(f"{npc_title_prefix} ") :].strip() or "NPC"
        else:
            kind = "npc"
            name = raw_title

        status_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Состояние здоровья:",
        )
        clothing_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Одежда:",
        )
        equipment_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Снаряжение:",
        )
        mood_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Текущее настроение на начало этой сцены:",
        )
        attitude_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Текущее отношение к ГГ на начало этой сцены:",
        )
        personality_value = _extract_story_character_state_prompt_field_local(
            raw_content,
            "Характер:",
        )
        manual_fixed_fields: list[str] = []
        if (
            "Ручная фиксация игроком: это настроение обязательно должно явно читаться в ближайшем ответе мастера."
            in raw_content
            and mood_value
        ):
            manual_fixed_fields.append("mood")
        if (
            "Ручная фиксация игроком: это отношение к ГГ обязательно должно явно читаться в ближайшем ответе мастера."
            in raw_content
            and attitude_value
        ):
            manual_fixed_fields.append("attitude_to_hero")
        if (
            "Ручная фиксация игроком: состояние здоровья героя обязательно для ближайшего ответа, пока сцена явно не меняет его."
            in raw_content
            and status_value
        ):
            manual_fixed_fields.append("status")

        guidance_card = {
            "name": name,
            "kind": kind,
            "status": status_value,
            "clothing": clothing_value,
            "equipment": equipment_value,
            "mood": mood_value,
            "attitude_to_hero": attitude_value,
            "personality": personality_value,
            "manual_fixed_fields": manual_fixed_fields,
        }
        if any(
            str(guidance_card.get(field_name) or "").strip()
            for field_name in ("status", "clothing", "equipment", "mood", "attitude_to_hero", "personality")
        ):
            guidance_cards.append(guidance_card)
    return guidance_cards


def _request_story_character_state_scene_guidance(
    *,
    plot_cards: list[dict[str, str]],
    history: list[dict[str, str]],
) -> list[str]:
    guidance_cards = _build_story_character_state_guidance_cards_payload(plot_cards)
    if not guidance_cards:
        return []

    directives: list[str] = []
    latest_user_turn = ""
    for item in reversed(history):
        role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
        content = str(item.get("content", "")).replace("\r\n", "\n").strip()
        if role == STORY_USER_ROLE and content:
            latest_user_turn = " ".join(content.split())
            break

    for guidance_card in guidance_cards:
        character_name = " ".join(str(guidance_card.get("name") or "").split()).strip() or "Character"
        character_kind = str(guidance_card.get("kind") or "").strip().lower()
        status_value = " ".join(str(guidance_card.get("status") or "").split()).strip()
        clothing_value = " ".join(str(guidance_card.get("clothing") or "").split()).strip()
        equipment_value = " ".join(str(guidance_card.get("equipment") or "").split()).strip()
        mood_value = " ".join(str(guidance_card.get("mood") or "").split()).strip()
        attitude_value = " ".join(str(guidance_card.get("attitude_to_hero") or "").split()).strip()
        personality_value = " ".join(str(guidance_card.get("personality") or "").split()).strip()
        manual_fixed_fields = [
            str(field_name or "").strip()
            for field_name in guidance_card.get("manual_fixed_fields", [])
            if str(field_name or "").strip()
        ] 

        state_parts: list[str] = []
        if status_value:
            state_parts.append(f"health_status='{status_value}'")
        if clothing_value:
            state_parts.append(f"clothing='{clothing_value}'")
        if equipment_value:
            state_parts.append(f"equipment='{equipment_value}'")
        if mood_value:
            state_parts.append(f"mood='{mood_value}'")
        if attitude_value:
            state_parts.append(f"attitude_to_hero='{attitude_value}'")
        if personality_value:
            state_parts.append(f"personality='{personality_value}'")
        if state_parts:
            directives.append(
                f"{character_name}: start the very next reply from the saved live state {', '.join(state_parts)}."
            )
            directives.append(
                f"{character_name}: make that state visible through dialogue wording, initiative, distance, boundaries, patience, warmth or coldness, symptoms, and body language instead of writing neutral prose that contradicts the card."
            )

        if manual_fixed_fields:
            rendered_manual_fields: list[str] = []
            if "status" in manual_fixed_fields and status_value:
                rendered_manual_fields.append(f"health_status='{status_value}'")
            if "mood" in manual_fixed_fields and mood_value:
                rendered_manual_fields.append(f"mood='{mood_value}'")
            if "attitude_to_hero" in manual_fixed_fields and attitude_value:
                rendered_manual_fields.append(f"attitude_to_hero='{attitude_value}'")
            if rendered_manual_fields:
                directives.append(
                    f"{character_name}: the player manually fixed {', '.join(rendered_manual_fields)} for the next reply, so treat it as authoritative start-of-scene continuity."
                )
                directives.append(
                    f"{character_name}: do not silently pre-shift a manually fixed field before the scene itself visibly earns that change."
                )

        if character_kind == "npc" and attitude_value.casefold() == "нейтральное":
            directives.append(
                f"{character_name}: if attitude_to_hero starts neutral, keep the interaction ordinary and bounded unless this very reply clearly earns a stronger shift."
            )
        if character_kind == "main_hero" and status_value:
            directives.append(
                f"{character_name}: when the saved health status affects movement, speech, stamina, pain, steadiness, or symptoms, let the narration respect those limits."
            )

    if latest_user_turn and directives:
        directives.append(
            f"Use the newest player move as the immediate trigger context, but do not let it erase the saved start-of-scene state before the reply begins: '{latest_user_turn[:220].rstrip()}'."
        )

    normalized_directives: list[str] = []
    for raw_item in directives:
        normalized = " ".join(str(raw_item or "").replace("\r\n", " ").split()).strip()
        if not normalized:
            continue
        normalized_directives.append(normalized[:320].rstrip())
        if len(normalized_directives) >= 16:
            break
    return normalized_directives

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
    full_history = [
        {"role": message.role, "content": message.content.strip()}
        for message in context_messages
        if message.role in {STORY_USER_ROLE, STORY_ASSISTANT_ROLE} and message.content.strip()
    ]
    effective_context_limit_tokens = _effective_story_context_limit_tokens(
        context_limit_tokens,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    selected_history = _select_story_history_source(
        full_history,
        use_plot_memory=use_plot_memory,
    )
    history = selected_history
    instruction_cards_for_prompt = [
        card
        for card in instruction_cards
        if str(card.get("title", "")).strip() and str(card.get("content", "")).strip()
    ]
    reserved_history_tokens = _estimate_story_history_tokens(history)
    plot_cards_for_prompt = _fit_story_plot_cards_to_context_limit(
        instruction_cards=instruction_cards_for_prompt,
        plot_cards=plot_cards,
        world_cards=world_cards,
        context_limit_tokens=effective_context_limit_tokens,
        reserved_history_tokens=reserved_history_tokens,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
    )
    if use_plot_memory:
        memory_summary, memory_preview = _summarize_story_prompt_memory_cards(plot_cards_for_prompt)
        logger.info(
            "Story prompt memory payload: model=%s total_cards=%s key=%s location=%s environment=%s weather=%s raw=%s compressed=%s super=%s other=%s history_messages=%s history_tokens=%s preview=%s",
            _normalize_story_model_id(model_name) or "unknown",
            len(plot_cards_for_prompt),
            memory_summary["key"],
            memory_summary["location"],
            memory_summary["environment"],
            memory_summary["weather"],
            memory_summary["raw"],
            memory_summary["compressed"],
            memory_summary["super"],
            memory_summary["other"],
            len(history),
            _estimate_story_history_tokens(history),
            memory_preview or "none",
        )

    system_prompt = _build_story_system_prompt(
        instruction_cards_for_prompt,
        plot_cards_for_prompt,
        world_cards,
        model_name=model_name,
        response_max_tokens=response_max_tokens,
        show_gg_thoughts=show_gg_thoughts,
        show_npc_thoughts=show_npc_thoughts,
    )
    system_prompt_tokens = _estimate_story_tokens(system_prompt)
    if system_prompt_tokens > effective_context_limit_tokens and plot_cards_for_prompt:
        plot_cards_for_prompt = _fit_story_plot_cards_to_context_limit(
            instruction_cards=instruction_cards_for_prompt,
            plot_cards=plot_cards_for_prompt,
            world_cards=world_cards,
            context_limit_tokens=effective_context_limit_tokens,
            reserved_history_tokens=0,
            model_name=model_name,
            response_max_tokens=response_max_tokens,
        )
        system_prompt = _build_story_system_prompt(
            instruction_cards_for_prompt,
            plot_cards_for_prompt,
            world_cards,
            model_name=model_name,
            response_max_tokens=response_max_tokens,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
        )
        system_prompt_tokens = _estimate_story_tokens(system_prompt)
    state_guidance_directives = _request_story_character_state_scene_guidance(
        plot_cards=plot_cards_for_prompt,
        history=history,
    )
    state_guidance_prompt = ""
    if state_guidance_directives:
        state_guidance_prompt = (
            "CHARACTER STATE SCENE GUIDANCE (MANDATORY FOR THE NEXT REPLY):\n"
            + "\n".join(
                f"{index}. {directive}"
                for index, directive in enumerate(state_guidance_directives, start=1)
            )
        )
    state_guidance_tokens = _estimate_story_tokens(state_guidance_prompt) if state_guidance_prompt else 0
    history_budget_tokens = max(effective_context_limit_tokens - system_prompt_tokens - state_guidance_tokens, 0)
    history = _trim_story_history_to_context_limit(history, history_budget_tokens)

    # Large system prompts (for example, with many cards + model-specific rules)
    # can consume the whole budget. Keep at least one recent user turn so Polza.ai
    # always receives actionable dialogue context.
    if not history and full_history:
        fallback_history_item: dict[str, str] | None = None
        for item in reversed(full_history):
            role = str(item.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            content = str(item.get("content", "")).strip()
            if role == STORY_USER_ROLE and content:
                fallback_history_item = {"role": role, "content": content}
                break
        if fallback_history_item is None:
            fallback_source = full_history[-1]
            fallback_role = str(fallback_source.get("role", STORY_USER_ROLE)).strip() or STORY_USER_ROLE
            fallback_content = str(fallback_source.get("content", "")).strip()
            if fallback_content:
                fallback_history_item = {"role": fallback_role, "content": fallback_content}

        if fallback_history_item is not None:
            fallback_budget_tokens = max(min(effective_context_limit_tokens // 6, 240), 48)
            history = [
                {
                    "role": fallback_history_item["role"],
                    "content": _trim_story_text_tail_by_tokens(
                        fallback_history_item["content"],
                        fallback_budget_tokens,
                    ),
                }
            ]

    messages_payload = [{"role": "system", "content": system_prompt}]
    reroll_system_message = _build_story_reroll_system_message(reroll_discarded_assistant_text)
    if reroll_system_message is not None:
        messages_payload.append(reroll_system_message)
    if state_guidance_prompt:
        messages_payload.append({"role": "system", "content": state_guidance_prompt})
    messages_payload.extend(history)
    messages_payload = repair_likely_utf8_mojibake_deep(messages_payload)
    if not translate_for_model:
        return messages_payload

    return _prepare_story_messages_for_model(messages_payload)
