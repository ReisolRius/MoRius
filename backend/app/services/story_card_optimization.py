from __future__ import annotations

from app import main as monolith_main


def _bind_monolith_names() -> None:
    module_globals = globals()
    for name in dir(monolith_main):
        if name.startswith("__"):
            continue
        module_globals.setdefault(name, getattr(monolith_main, name))


_bind_monolith_names()

def _normalize_story_text_optimization_target(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"character", "instruction", "plot"}:
        return normalized
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported optimization target")


def _finalize_optimized_story_card_text(
    *,
    target: str,
    text: str,
    raw_fallback: str,
) -> str:
    normalized_target = _normalize_story_text_optimization_target(target)
    max_chars_by_target = {
        "character": STORY_WORLD_CARD_MAX_CONTENT_LENGTH,
        "instruction": 8_000,
        "plot": STORY_PLOT_CARD_MAX_CONTENT_LENGTH,
    }
    optimized_text = _normalize_story_prompt_text(
        text,
        max_chars=max_chars_by_target[normalized_target],
    )
    optimized_text = re.sub(
        r"^\s*(?:оптимизированный текст|оптимизированная версия|optimized text|result)\s*:\s*",
        "",
        optimized_text,
        flags=re.IGNORECASE,
    ).strip()
    if not optimized_text:
        optimized_text = raw_fallback

    try:
        if normalized_target == "instruction":
            return normalize_story_instruction_content(optimized_text)
        if normalized_target == "plot":
            return normalize_story_plot_card_content(optimized_text)
        return _normalize_story_world_card_content(optimized_text)
    except HTTPException:
        if normalized_target == "instruction":
            return normalize_story_instruction_content(raw_fallback)
        if normalized_target == "plot":
            return normalize_story_plot_card_content(raw_fallback)
        return _normalize_story_world_card_content(raw_fallback)


def _optimize_story_card_text_content_locally(
    *,
    target: str,
    content: str,
) -> str:
    normalized_target = _normalize_story_text_optimization_target(target)
    raw_content = str(content or "").replace("\r\n", "\n").strip()
    if not raw_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Text to optimize cannot be empty")

    selected_char_budget_by_target = {
        "character": 1_400,
        "instruction": 2_400,
        "plot": 1_200,
    }
    max_lines_by_target = {
        "character": 7,
        "instruction": 10,
        "plot": 7,
    }

    sentence_candidates = _extract_story_memory_sentences(raw_content)
    if not sentence_candidates:
        sentence_candidates = []
        for raw_line in raw_content.split("\n"):
            compact_line = re.sub(r"\s+", " ", raw_line.strip(" \t-•")).strip()
            if not compact_line:
                continue
            if compact_line[-1] not in ".!?…:":
                compact_line = f"{compact_line}."
            sentence_candidates.append(compact_line)

    ranked_entries: list[tuple[int, str, int]] = []
    seen_sentences: set[str] = set()
    for index, sentence in enumerate(sentence_candidates):
        compact_sentence = re.sub(r"\s+", " ", str(sentence or "")).strip()
        if not compact_sentence:
            continue
        sentence_key = compact_sentence.casefold()
        if sentence_key in seen_sentences:
            continue
        seen_sentences.add(sentence_key)

        score = _score_story_plot_memory_line(compact_sentence)
        if normalized_target == "instruction":
            if re.search(r"(?i)\b(?:нельзя|запрещено|обязательно|всегда|никогда|должен|должна|нужно|следует|must|never|always)\b", compact_sentence):
                score += 4
            if ":" in compact_sentence:
                score += 1
        elif normalized_target == "character":
            if re.search(r"\d", compact_sentence):
                score += 1
            if re.search(r"(?i)(волос|глаз|внешност|возраст|роль|характер|статус|отношен|связ|цель|навык)", compact_sentence):
                score += 2
        else:
            if re.search(r"(?i)(обеща|долг|тайн|угроз|риск|последств|узнал|решил|план|цель|крючок)", compact_sentence):
                score += 2
        ranked_entries.append((index, compact_sentence, score))

    if not ranked_entries:
        return _finalize_optimized_story_card_text(
            target=normalized_target,
            text=raw_content,
            raw_fallback=raw_content,
        )

    selected_entries = sorted(
        sorted(ranked_entries, key=lambda item: (-item[2], item[0]))[: max_lines_by_target[normalized_target]],
        key=lambda item: item[0],
    )
    selected_sentences = [sentence for _, sentence, _ in selected_entries]
    if normalized_target == "instruction":
        selected_lines: list[str] = []
        for sentence in selected_sentences:
            candidate = "\n".join([*selected_lines, sentence]).strip()
            if selected_lines and len(candidate) > selected_char_budget_by_target[normalized_target]:
                break
            selected_lines.append(sentence)
        optimized_text = "\n".join(selected_lines).strip()
    else:
        optimized_text = _join_story_memory_sentences_as_prose(
            selected_sentences,
            max_chars=selected_char_budget_by_target[normalized_target],
        ).strip()

    if not optimized_text:
        optimized_text = raw_content
    return _finalize_optimized_story_card_text(
        target=normalized_target,
        text=optimized_text,
        raw_fallback=raw_content,
    )


def _optimize_story_card_text_content(
    *,
    target: str,
    content: str,
) -> str:
    normalized_target = _normalize_story_text_optimization_target(target)
    raw_content = str(content or "").replace("\r\n", "\n").strip()
    if not raw_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Text to optimize cannot be empty")

    target_prompt_rules = {
        "character": (
            "This is a character description/world-card profile. "
            "Preserve name anchors, appearance, role, relationships, notable traits, status, and any facts important for recognition. "
            "Prefer compact factual Russian sentences with explicit actors instead of ambiguous pronouns."
        ),
        "instruction": (
            "This is an active instruction card for the storyteller. "
            "Preserve hard constraints, forbidden things, tone, format rules, priorities, and mandatory style requirements. "
            "Make it short, unambiguous, and easy for another model to follow."
        ),
        "plot": (
            "This is a plot memory card. "
            "Preserve names, promises, consequences, unresolved hooks, who did what, and what characters know. "
            "Keep causal links and actor clarity. Remove decoration and repetition."
        ),
    }
    model_name = _resolve_story_plot_memory_model_name()
    fallback_model_names = _resolve_story_plot_memory_fallback_models(model_name)
    messages_payload = [
        {
            "role": "system",
            "content": (
                "You optimize RPG prompt-card text for another language model. "
                "Return only the optimized Russian text without markdown fences, headings, explanations, or comments. "
                "Shorten aggressively but do not lose meaning, names, constraints, consequences, or who performed each action. "
                "Remove fluff, repetition, empty adjectives, duplicate sentences, and decorative phrasing. "
                "Make the result easier and faster for a storyteller model to consume."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Target type: {normalized_target}\n"
                f"Rules: {target_prompt_rules[normalized_target]}\n\n"
                "Optimize and compress this text:\n"
                f"{raw_content}"
            ),
        },
    ]
    try:
        optimized_raw = _request_openrouter_story_text(
            messages_payload,
            model_name=model_name,
            allow_free_fallback=False,
            translate_input=False,
            fallback_model_names=fallback_model_names,
            temperature=0.2,
            max_tokens=700,
            request_timeout=(8, 45),
        )
    except Exception:
        logger.exception("Story card text optimization request failed: target=%s", normalized_target)
        return _optimize_story_card_text_content_locally(
            target=normalized_target,
            content=raw_content,
        )

    try:
        return _finalize_optimized_story_card_text(
            target=normalized_target,
            text=optimized_raw,
            raw_fallback=raw_content,
        )
    except Exception:
        logger.exception("Story card text optimization post-processing failed: target=%s", normalized_target)
        return _optimize_story_card_text_content_locally(
            target=normalized_target,
            content=raw_content,
        )
