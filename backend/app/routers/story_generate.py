from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import StoryGame, StoryMessage
from app.schemas import StoryGenerateRequest
from app.services.auth_identity import get_current_user
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.story_cards import (
    coerce_story_plot_card_enabled,
    deserialize_story_plot_card_triggers,
    normalize_story_plot_card_triggers,
    story_plot_card_to_out,
)
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_games import (
    STORY_DEFAULT_TITLE,
    coerce_story_llm_model,
    deserialize_story_environment_weather,
    get_story_turn_cost_tokens,
    normalize_story_context_limit_chars,
    normalize_story_environment_enabled,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_temperature,
    normalize_story_top_k,
    normalize_story_top_r,
    resolve_story_environment_current_weather_for_output,
    serialize_story_ambient_profile,
    story_game_summary_to_out,
)
from app.services.story_memory import story_memory_block_to_out
from app.services.story_queries import (
    get_user_story_game_or_404,
    list_story_memory_blocks,
    list_story_messages,
    list_story_plot_cards,
    list_story_world_cards,
    touch_story_game,
)
from app.services.story_runtime import StoryRuntimeDeps, generate_story_response
from app.services.story_text import normalize_story_text
from app.services.story_undo import rollback_story_card_events_for_assistant_message
from app.services.story_world_cards import (
    deserialize_story_world_card_triggers,
    story_world_card_to_out,
)

router = APIRouter()
logger = logging.getLogger(__name__)

_FALLBACK_STREAM_PERSIST_MIN_CHARS = 120
_FALLBACK_STREAM_PERSIST_MAX_INTERVAL_SECONDS = 1.5
_FALLBACK_OPENROUTER_FAILURE_MARKERS = (
    "provider returned error",
    "internal server error",
    "server_error",
    "upstream",
    "openrouter chat error (500)",
    "openrouter chat error (502)",
    "openrouter chat error (503)",
    "openrouter chat error (504)",
)
_FALLBACK_REROLL_REFERENCE_MAX_CHARS = 1_800


def _normalize_story_reroll_reference_text(value: str | None) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return ""

    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    if len(normalized) <= _FALLBACK_REROLL_REFERENCE_MAX_CHARS:
        return normalized

    head_chars = 1_000
    tail_chars = 650
    head = normalized[:head_chars].rstrip()
    tail = normalized[-tail_chars:].lstrip()
    if not head:
        return tail
    if not tail:
        return head
    return f"{head}\n...\n{tail}"


def _fallback_is_story_provider_failure_detail(detail: str | None) -> bool:
    normalized_detail = str(detail or "").casefold()
    if not normalized_detail:
        return False
    return any(marker in normalized_detail for marker in _FALLBACK_OPENROUTER_FAILURE_MARKERS)


def _fallback_public_story_provider_failure_detail(detail: str | None) -> str:
    normalized_detail = re.sub(r"\s+", " ", str(detail or "").replace("\r\n", "\n").strip())
    if normalized_detail.casefold().startswith("openrouter chat error") and "{" in normalized_detail:
        normalized_detail = normalized_detail.split("{", 1)[0].rstrip(" .:,")
    return normalized_detail[:500] or "Provider returned error"


def _fallback_derive_story_title(prompt: str) -> str:
    normalized = " ".join(str(prompt or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized:
        return STORY_DEFAULT_TITLE
    first_sentence = re.split(r"[.!?\n]", normalized, maxsplit=1)[0].strip(" -,:;")
    if not first_sentence:
        first_sentence = normalized
    if len(first_sentence) > 60:
        first_sentence = first_sentence[:60].rstrip(" -,:;")
    return first_sentence or STORY_DEFAULT_TITLE


def _fallback_normalize_generation_instructions(instructions: list[Any]) -> list[dict[str, str]]:
    normalized_cards: list[dict[str, str]] = []
    for item in instructions or []:
        title = " ".join(str(getattr(item, "title", "") or "").split()).strip()
        content = str(getattr(item, "content", "") or "").replace("\r\n", "\n").strip()
        is_active = bool(getattr(item, "is_active", True))
        if not is_active or not title or not content:
            continue
        normalized_cards.append({"title": title[:120], "content": content[:8_000]})
    return normalized_cards[:40]


def _fallback_trim_history_messages(context_messages: list[StoryMessage], *, max_chars: int) -> list[StoryMessage]:
    selected: list[StoryMessage] = []
    used_chars = 0
    for message in reversed(context_messages):
        if message.role not in {"user", "assistant"}:
            continue
        content = str(getattr(message, "content", "") or "").replace("\r\n", "\n").strip()
        if not content:
            continue
        content_length = len(content)
        if selected and used_chars + content_length > max_chars:
            break
        selected.append(message)
        used_chars += content_length
    selected.reverse()
    return selected


def _fallback_world_card_to_prompt_payload(card: Any) -> dict[str, Any] | None:
    title = " ".join(str(getattr(card, "title", "") or "").split()).strip()
    content = str(getattr(card, "content", "") or "").replace("\r\n", "\n").strip()
    if not title or not content:
        return None
    triggers = deserialize_story_world_card_triggers(str(getattr(card, "triggers", "") or ""))
    return {
        "id": int(getattr(card, "id", 0) or 0),
        "title": title[:120],
        "content": content[:6_000],
        "triggers": triggers[:20],
        "kind": str(getattr(card, "kind", "") or "").strip().lower(),
    }


def _fallback_world_card_matches_text(card_payload: dict[str, Any], text: str) -> bool:
    normalized_text = str(text or "").casefold()
    if not normalized_text:
        return False
    for trigger in card_payload.get("triggers", []):
        normalized_trigger = str(trigger or "").casefold().strip()
        if normalized_trigger and normalized_trigger in normalized_text:
            return True
    title_value = str(card_payload.get("title", "") or "").casefold()
    return bool(title_value and title_value in normalized_text)


def _fallback_select_story_world_cards_for_prompt(
    context_messages: list[StoryMessage],
    world_cards: list[Any],
) -> list[dict[str, Any]]:
    normalized_cards = [
        payload
        for payload in (_fallback_world_card_to_prompt_payload(card) for card in world_cards)
        if isinstance(payload, dict)
    ]
    if not normalized_cards:
        return []

    recent_text = "\n".join(
        str(getattr(message, "content", "") or "").replace("\r\n", "\n").strip()
        for message in context_messages[-8:]
        if str(getattr(message, "content", "") or "").strip()
    )

    selected: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for payload in normalized_cards:
        if payload.get("kind") == "main_hero":
            selected.append(payload)
            seen_ids.add(int(payload.get("id") or 0))

    for payload in normalized_cards:
        payload_id = int(payload.get("id") or 0)
        if payload_id in seen_ids:
            continue
        if _fallback_world_card_matches_text(payload, recent_text):
            selected.append(payload)
            seen_ids.add(payload_id)

    if not selected:
        selected = normalized_cards[:8]
    elif len(selected) < 8:
        for payload in normalized_cards:
            payload_id = int(payload.get("id") or 0)
            if payload_id in seen_ids:
                continue
            selected.append(payload)
            seen_ids.add(payload_id)
            if len(selected) >= 8:
                break

    return selected[:12]


def _fallback_select_story_world_cards_triggered_by_text(
    text_value: str,
    world_cards: list[Any],
) -> list[dict[str, Any]]:
    normalized_cards = [
        payload
        for payload in (_fallback_world_card_to_prompt_payload(card) for card in world_cards)
        if isinstance(payload, dict)
    ]
    triggered_cards = [
        payload for payload in normalized_cards if _fallback_world_card_matches_text(payload, text_value)
    ]
    return triggered_cards[:12]


def _fallback_normalize_generated_story_output(
    *,
    text_value: str,
    world_cards: list[dict[str, Any]] | None = None,
    model_name: str | None = None,
    show_gg_thoughts: bool = False,
    show_npc_thoughts: bool = False,
) -> str:
    normalized_world_cards = world_cards if isinstance(world_cards, list) else []
    try:
        from app import main as monolith_main

        monolith_normalizer = getattr(monolith_main, "_normalize_generated_story_output", None)
        if callable(monolith_normalizer):
            normalized = monolith_normalizer(
                text_value=text_value,
                world_cards=normalized_world_cards,
                model_name=model_name,
                show_gg_thoughts=show_gg_thoughts,
                show_npc_thoughts=show_npc_thoughts,
            )
            return str(normalized or "").replace("\r\n", "\n").strip()
    except Exception:
        logger.exception("Fallback runtime failed to use monolith story output normalizer")

    normalized = str(text_value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return normalized
    normalized_paragraphs: list[str] = []
    for paragraph in re.split(r"\n{2,}", normalized):
        paragraph_text = paragraph.strip()
        if not paragraph_text:
            continue
        if paragraph_text.startswith("[["):
            normalized_paragraphs.append(paragraph_text)
            continue
        normalized_paragraphs.append(f"[[NARRATOR]] {paragraph_text}")
    return "\n\n".join(normalized_paragraphs).strip()


def _fallback_list_story_prompt_memory_cards(
    db: Session,
    game: StoryGame,
    memory_optimization_enabled: bool,
    context_messages: list[StoryMessage] | None = None,
) -> list[dict[str, str]]:
    _ = memory_optimization_enabled
    cards_payload: list[dict[str, str]] = []
    for card in list_story_plot_cards(db, game.id):
        title = " ".join(str(getattr(card, "title", "") or "").split()).strip()
        content = str(getattr(card, "content", "") or "").replace("\r\n", "\n").strip()
        if not title or not content:
            continue
        triggers = normalize_story_plot_card_triggers(
            deserialize_story_plot_card_triggers(str(getattr(card, "triggers", "") or "")),
            fallback_title=title,
        )
        if triggers:
            continue
        if not coerce_story_plot_card_enabled(getattr(card, "is_enabled", True), triggers=triggers):
            continue
        cards_payload.append({"title": title[:160], "content": content[:6_000]})
    return cards_payload[:12]


def _fallback_seed_story_opening_scene_memory_block(**kwargs: Any) -> bool:
    return False


def _fallback_persist_generated_world_cards(**kwargs: Any) -> list[Any]:
    return []


def _fallback_extract_openrouter_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            detail = error_payload.get("message") or error_payload.get("detail")
            if isinstance(detail, str) and detail.strip():
                return detail.strip()
        for key in ("detail", "message"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return response.text.strip()[:500] or f"OpenRouter chat error ({response.status_code})"


def _fallback_extract_openrouter_content(response_payload: dict[str, Any]) -> str:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0] if isinstance(choices[0], dict) else {}
    message_payload = first_choice.get("message")
    if isinstance(message_payload, dict):
        content = message_payload.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return "".join(parts)
    return ""


def _fallback_extract_text_from_model_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text_value = item.get("text")
            if isinstance(text_value, str):
                parts.append(text_value)
                continue
            if item.get("type") == "text":
                content_value = item.get("content")
                if isinstance(content_value, str):
                    parts.append(content_value)
        return "".join(parts)
    return ""


def _fallback_yield_coalesced_chunks(
    text_value: str,
    *,
    chunk_size: int = 28,
    delay_seconds: float = 0.015,
):
    if not text_value:
        return
    chunks = [text_value[index : index + chunk_size] for index in range(0, len(text_value), chunk_size)]
    if not chunks:
        return
    for index, chunk in enumerate(chunks):
        yield chunk
        if delay_seconds > 0 and index < len(chunks) - 1:
            time.sleep(delay_seconds)


def _fallback_build_environment_prompt_lines(game: StoryGame | None) -> list[str]:
    if game is None:
        return []
    lines: list[str] = []
    current_location_label = " ".join(str(getattr(game, "current_location_label", "") or "").split()).strip()
    if current_location_label:
        lines.append(f"Текущее место: {current_location_label}.")
    if normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        current_datetime = str(getattr(game, "environment_current_datetime", "") or "").strip()
        if current_datetime:
            lines.append(f"Игровые дата и время: {current_datetime}.")
        current_weather = resolve_story_environment_current_weather_for_output(game)
        if isinstance(current_weather, dict):
            lines.append(
                "Погода сейчас: "
                + " ".join(
                    part
                    for part in (
                        str(current_weather.get("summary") or "").strip(),
                        (
                            f"{int(current_weather.get('temperature_c')):+d}°"
                            if isinstance(current_weather.get("temperature_c"), int)
                            else ""
                        ),
                    )
                    if part
                )
                + "."
            )
        tomorrow_weather = deserialize_story_environment_weather(
            str(getattr(game, "environment_tomorrow_weather", "") or "")
        )
        if isinstance(tomorrow_weather, dict):
            tomorrow_line = " ".join(
                part
                for part in (
                    str(tomorrow_weather.get("summary") or "").strip(),
                    (
                        f"{int(tomorrow_weather.get('temperature_c')):+d}°"
                        if isinstance(tomorrow_weather.get("temperature_c"), int)
                        else ""
                    ),
                )
                if part
            ).strip()
            if tomorrow_line:
                lines.append(f"Прогноз на завтра: {tomorrow_line}.")
    return lines


def _fallback_build_provider_messages(
    *,
    game: StoryGame | None,
    prompt: str,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_chars: int,
    reroll_discarded_assistant_text: str | None = None,
) -> list[dict[str, str]]:
    system_prompt = (
        "Ты рассказчик интерактивной текстовой RPG. "
        "Пиши только на русском. "
        "Продолжай текущую сцену естественно и последовательно. "
        "Не используй markdown, не показывай служебные заметки и не объясняй правила. "
        "Не принимай решений за игрока сверх уже указанного хода; развивай последствия его действия и реакции мира."
    )
    known_npc_names: list[str] = []
    known_gg_names: list[str] = []
    for card in world_cards:
        if not isinstance(card, dict):
            continue
        card_title = " ".join(str(card.get("title", "")).split()).strip()
        if not card_title:
            continue
        card_kind = str(card.get("kind", "")).strip().lower()
        if card_kind == "main_hero":
            known_gg_names.append(card_title)
        elif card_kind == "npc":
            known_npc_names.append(card_title)

    known_npc_preview = ", ".join(dict.fromkeys(known_npc_names).keys())[:1_200] or "none"
    known_gg_preview = ", ".join(dict.fromkeys(known_gg_names).keys())[:400] or "none"
    protagonist_label = known_gg_names[0] if known_gg_names else "player character"
    system_prompt = (
        f"{system_prompt}\n\n"
        "STRICT OUTPUT FORMAT (MANDATORY):\n"
        "Each paragraph must start with exactly one marker and a space.\n"
        "Allowed markers only:\n"
        "1) [[NARRATOR]] text\n"
        "2) [[NPC:Name]] text\n"
        "3) [[GG:Name]] text\n"
        "4) [[NPC_THOUGHT:Name]] text\n"
        "5) [[GG_THOUGHT:Name]] text\n\n"
        "Rules:\n"
        "- Never output plain text without a marker.\n"
        "- Narration must use [[NARRATOR]].\n"
        "- Spoken character lines must use [[NPC:Name]] or [[GG:Name]].\n"
        "- Thoughts must use [[NPC_THOUGHT:Name]] or [[GG_THOUGHT:Name]].\n"
        "- Keep names consistent with known cards when possible.\n"
        f"- Known NPC names: {known_npc_preview}\n"
        f"- Known GG names: {known_gg_preview}\n\n"
        "PLAYER CHARACTER OWNERSHIP (MANDATORY):\n"
        f"- The player character is '{protagonist_label}'. Only the player controls this character.\n"
        "- Never invent or add new actions, movement, speech, thoughts, choices, emotions, intentions, or conclusions for the player character.\n"
        "- Never continue, finish, or paraphrase a player-character line as a new player-character line.\n"
        "- Do not output [[GG:...]] or [[GG_THOUGHT:...]] unless it is an exact quote explicitly present in the latest user message.\n"
        "- Default behavior: narrate only world and NPC reactions to the already stated player move, then stop where the next move belongs to the player."
    )

    context_sections: list[str] = []
    environment_lines = _fallback_build_environment_prompt_lines(game)
    if environment_lines:
        context_sections.append("Контекст окружения:\n" + "\n".join(f"- {line}" for line in environment_lines))
    context_sections.append(f"Known NPC names: {known_npc_preview}")
    context_sections.append(f"Known GG names: {known_gg_preview}")
    if instruction_cards:
        context_sections.append(
            "Инструкции:\n"
            + "\n".join(f"- {card['title']}: {card['content']}" for card in instruction_cards if card.get("content"))
        )
    if plot_cards:
        context_sections.append(
            "Актуальная память сюжета:\n"
            + "\n".join(f"- {card['title']}: {card['content']}" for card in plot_cards if card.get("content"))
        )
    if world_cards:
        world_lines: list[str] = []
        for card in world_cards:
            title = str(card.get("title", "")).strip()
            content = str(card.get("content", "")).strip()
            if not title or not content:
                continue
            triggers = ", ".join(str(trigger).strip() for trigger in card.get("triggers", []) if str(trigger).strip())
            line = f"- {title} ({str(card.get('kind', '')).strip().lower() or 'unknown'}): {content}"
            if triggers:
                line += f" | triggers: {triggers}"
            world_lines.append(line)
        if world_lines:
            context_sections.append("Карточки мира:\n" + "\n".join(world_lines[:12]))

    history_budget = max(context_limit_chars * 3, 6_000)
    trimmed_history = _fallback_trim_history_messages(context_messages, max_chars=history_budget)
    payload_messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    normalized_reroll_reference = _normalize_story_reroll_reference_text(reroll_discarded_assistant_text)
    if normalized_reroll_reference:
        payload_messages.append(
            {
                "role": "system",
                "content": (
                    "REROLL REQUIREMENTS:\n"
                    "- You are regenerating the discarded last assistant turn for the same player action.\n"
                    "- Keep the same user intent, established facts, and current world state.\n"
                    "- Produce a genuinely different continuation.\n"
                    "- Do not reuse the discarded answer's opening, structure, sequence of beats, or conclusion.\n"
                    "- Do not paraphrase or lightly edit the discarded answer.\n\n"
                    "Discarded assistant answer:\n"
                    f"{normalized_reroll_reference}"
                ),
            }
        )
    if context_sections:
        payload_messages.append({"role": "system", "content": "\n\n".join(context_sections)})
    for message in trimmed_history:
        role = "assistant" if message.role == "assistant" else "user"
        content = str(getattr(message, "content", "") or "").replace("\r\n", "\n").strip()
        if content:
            payload_messages.append({"role": role, "content": content})
    if not trimmed_history or trimmed_history[-1].role != "user":
        payload_messages.append({"role": "user", "content": prompt})
    return payload_messages


def _fallback_iter_story_provider_chunks(
    *,
    prompt: str,
    turn_index: int,
    context_messages: list[StoryMessage],
    instruction_cards: list[dict[str, str]],
    plot_cards: list[dict[str, str]],
    world_cards: list[dict[str, Any]],
    context_limit_chars: int,
    story_model_name: str | None,
    story_response_max_tokens: int | None,
    story_temperature: float,
    story_repetition_penalty: float,
    story_top_k: int,
    story_top_r: float,
    use_plot_memory: bool,
    reroll_discarded_assistant_text: str | None = None,
    show_gg_thoughts: bool,
    show_npc_thoughts: bool,
    raw_output_collector: dict[str, str] | None = None,
):
    def _extract_novel_suffix(base_text: str, candidate_text: str) -> str:
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

    monolith_streamer = None
    try:
        from app import main as monolith_main

        monolith_streamer = getattr(monolith_main, "_iter_story_provider_stream_chunks", None)
    except Exception:
        logger.exception("Fallback runtime failed to resolve monolith story stream provider")

    if callable(monolith_streamer):
        yield from monolith_streamer(
            prompt=prompt,
            turn_index=turn_index,
            context_messages=context_messages,
            instruction_cards=instruction_cards,
            plot_cards=plot_cards,
            world_cards=world_cards,
            context_limit_chars=context_limit_chars,
            story_model_name=story_model_name,
            story_response_max_tokens=story_response_max_tokens,
            story_temperature=story_temperature,
            story_repetition_penalty=story_repetition_penalty,
            story_top_k=story_top_k,
            story_top_r=story_top_r,
            use_plot_memory=use_plot_memory,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
            show_gg_thoughts=show_gg_thoughts,
            show_npc_thoughts=show_npc_thoughts,
            raw_output_collector=raw_output_collector,
        )
        return

    selected_model_name = (story_model_name or settings.openrouter_model).strip()
    if not settings.openrouter_api_key or not settings.openrouter_chat_url or not selected_model_name:
        raise RuntimeError(
            "OpenRouter chat error (503): story provider is not configured for the fallback runtime"
        )

    if not context_messages:
        raise RuntimeError("OpenRouter chat error (500): story context is empty")

    game: StoryGame | None = None
    latest_message = context_messages[-1] if context_messages else None
    if latest_message is not None:
        try:
            maybe_game = getattr(latest_message, "game", None)
        except Exception:
            maybe_game = None
        if isinstance(maybe_game, StoryGame):
            game = maybe_game

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    request_payload = {
        "model": selected_model_name,
        "messages": _fallback_build_provider_messages(
            game=game,
            prompt=prompt,
            context_messages=context_messages,
            instruction_cards=instruction_cards,
            plot_cards=plot_cards if use_plot_memory else [],
            world_cards=world_cards,
            context_limit_chars=context_limit_chars,
            reroll_discarded_assistant_text=reroll_discarded_assistant_text,
        ),
        "temperature": float(story_temperature),
        "repetition_penalty": float(story_repetition_penalty),
        "top_p": float(story_top_r),
        "stream": True,
    }
    if story_response_max_tokens is not None:
        request_payload["max_tokens"] = int(story_response_max_tokens)

    try:
        response = requests.post(
            settings.openrouter_chat_url,
            headers=headers,
            json=request_payload,
            timeout=(20, 180),
            stream=True,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"OpenRouter chat error (503): {exc}") from exc

    if response.status_code >= 400:
        detail = _fallback_extract_openrouter_error_detail(response)
        raise RuntimeError(f"OpenRouter chat error ({response.status_code}): {detail}")

    response.encoding = "utf-8"
    raw_chunks: list[str] = []
    emitted_delta = False
    saw_done_marker = False
    finish_reason: str | None = None
    try:
        for raw_line in response.iter_lines(chunk_size=256, decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue
            raw_data = line[len("data:") :].strip()
            if raw_data == "[DONE]":
                saw_done_marker = True
                break
            try:
                chunk_payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

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
                content_delta = _fallback_extract_text_from_model_content(delta_value.get("content"))
                if content_delta:
                    emitted_delta = True
                    raw_chunks.append(content_delta)
                    yield content_delta
                    continue

            if emitted_delta:
                continue

            message_value = choice.get("message")
            if isinstance(message_value, dict):
                content_value = _fallback_extract_text_from_model_content(message_value.get("content"))
                if content_value:
                    emitted_delta = True
                    raw_chunks.append(content_value)
                    for chunk in _fallback_yield_coalesced_chunks(content_value):
                        yield chunk
                    break
    finally:
        response.close()

    output_text = "".join(raw_chunks).replace("\r\n", "\n").strip()
    model_hit_length_limit = str(finish_reason or "").strip().casefold() == "length"
    stream_closed_unexpectedly = bool(output_text) and not saw_done_marker and not str(finish_reason or "").strip()
    should_recover_tail = stream_closed_unexpectedly or (model_hit_length_limit and story_response_max_tokens is None)
    if output_text and not should_recover_tail:
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = output_text
        return

    fallback_payload = dict(request_payload)
    fallback_payload["stream"] = False
    if (
        model_hit_length_limit
        and story_response_max_tokens is None
        and "max_tokens" not in fallback_payload
    ):
        fallback_payload["max_tokens"] = max(normalize_story_response_max_tokens(None) * 3, 1_200)
    try:
        fallback_response = requests.post(
            settings.openrouter_chat_url,
            headers={key: value for key, value in headers.items() if key != "Accept"},
            json=fallback_payload,
            timeout=(20, 180),
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"OpenRouter chat error (503): {exc}") from exc

    if fallback_response.status_code >= 400:
        detail = _fallback_extract_openrouter_error_detail(fallback_response)
        raise RuntimeError(f"OpenRouter chat error ({fallback_response.status_code}): {detail}")
    try:
        fallback_response_payload = fallback_response.json()
    except ValueError as exc:
        raise RuntimeError("OpenRouter chat error (500): invalid JSON response") from exc

    fallback_output_text = _fallback_extract_openrouter_content(fallback_response_payload).replace("\r\n", "\n").strip()
    if not fallback_output_text and output_text:
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = output_text
        return
    if not fallback_output_text:
        raise RuntimeError("OpenRouter chat error (500): empty response")
    if output_text:
        suffix_text = _extract_novel_suffix(output_text, fallback_output_text)
        merged_output = f"{output_text}{suffix_text}"
        if raw_output_collector is not None:
            raw_output_collector["raw_output"] = merged_output
        if suffix_text:
            for chunk in _fallback_yield_coalesced_chunks(suffix_text):
                yield chunk
        return
    if raw_output_collector is not None:
        raw_output_collector["raw_output"] = fallback_output_text
    for chunk in _fallback_yield_coalesced_chunks(fallback_output_text):
        yield chunk


def _fallback_resolve_story_turn_postprocess_payload(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt: str,
    latest_assistant_text: str,
    world_cards: list[dict[str, Any]] | None = None,
    raw_memory_enabled: bool = False,
    location_enabled: bool = True,
    environment_enabled: bool = False,
    character_state_enabled: bool = False,
    important_event_enabled: bool = False,
    ambient_enabled: bool = False,
    emotion_visualization_enabled: bool = False,
) -> dict[str, Any] | None:
    try:
        from app import main as monolith_main

        monolith_resolver = getattr(monolith_main, "_resolve_story_turn_postprocess_payload", None)
    except Exception:
        monolith_resolver = None
        logger.exception(
            "Fallback runtime failed to import monolith unified post-process resolver: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )

    if callable(monolith_resolver):
        try:
            resolved_payload = monolith_resolver(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt=latest_user_prompt,
                latest_assistant_text=latest_assistant_text,
                world_cards=world_cards,
                raw_memory_enabled=raw_memory_enabled,
                location_enabled=location_enabled,
                environment_enabled=environment_enabled,
                character_state_enabled=character_state_enabled,
                important_event_enabled=important_event_enabled,
                ambient_enabled=ambient_enabled,
                emotion_visualization_enabled=emotion_visualization_enabled,
            )
            if isinstance(resolved_payload, dict) and resolved_payload:
                return resolved_payload
        except HTTPException:
            raise
        except Exception:
            logger.exception(
                "Fallback runtime failed to delegate unified post-process resolver to monolith: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )

    try:
        from app.routers import story_games as story_games_router
    except Exception:
        logger.exception("Fallback runtime failed to import story_games router for environment sync")
        return None

    previous_assistant_text = ""
    for message in reversed(list_story_messages(db, game.id)):
        if int(getattr(message, "id", 0) or 0) == int(getattr(assistant_message, "id", 0) or 0):
            continue
        if str(getattr(message, "role", "") or "") != "assistant":
            continue
        previous_assistant_text = str(getattr(message, "content", "") or "").replace("\r\n", "\n").strip()
        if previous_assistant_text:
            break

    try:
        return story_games_router._build_story_grok_environment_postprocess_payload(
            game=game,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            previous_assistant_text=previous_assistant_text,
            include_location=False,
            include_weather=bool(environment_enabled),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Fallback runtime failed to obtain Grok environment payload: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        return None


def _fallback_apply_story_grok_postprocess_payload(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    payload: dict[str, Any],
) -> bool:
    try:
        from app.routers import story_games as story_games_router
    except Exception:
        logger.exception("Fallback runtime failed to import story_games router for post-process apply")
        return False

    try:
        story_games_router._apply_story_grok_environment_postprocess_payload(
            db=db,
            game=game,
            assistant_message=assistant_message,
            payload=payload,
        )
        touch_story_game(game)
        db.commit()
        db.refresh(game)
        return True
    except Exception:
        logger.exception(
            "Fallback runtime failed to apply Grok environment payload: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        db.rollback()
        return False


def _fallback_sync_story_memory_and_environment(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt_override: str | None = None,
    latest_assistant_text_override: str | None = None,
    resolved_postprocess_payload_override: dict[str, Any] | None = None,
    memory_optimization_enabled: bool = True,
) -> bool:
    try:
        from app.services import story_memory_pipeline
    except Exception:
        logger.exception(
            "Fallback runtime failed to import story memory pipeline: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        if isinstance(resolved_postprocess_payload_override, dict):
            return _fallback_apply_story_grok_postprocess_payload(
                db=db,
                game=game,
                assistant_message=assistant_message,
                payload=resolved_postprocess_payload_override,
            )
        return False

    latest_user_prompt = (
        latest_user_prompt_override.replace("\r\n", "\n").strip()
        if isinstance(latest_user_prompt_override, str)
        else story_memory_pipeline._get_story_user_prompt_before_assistant_message(
            db,
            game_id=game.id,
            assistant_message_id=assistant_message.id,
        )
    )
    latest_assistant_text = (
        story_memory_pipeline._normalize_story_assistant_text_for_memory(latest_assistant_text_override)
        if isinstance(latest_assistant_text_override, str)
        else story_memory_pipeline._normalize_story_assistant_text_for_memory(assistant_message.content)
    )
    if not latest_assistant_text:
        latest_assistant_text = str(getattr(assistant_message, "content", "") or "").replace("\r\n", "\n").strip()
    previous_assistant_text = story_memory_pipeline._get_story_previous_assistant_text_before_message(
        db,
        game_id=game.id,
        assistant_message_id=assistant_message.id,
    )

    postprocess_payload = (
        resolved_postprocess_payload_override
        if isinstance(resolved_postprocess_payload_override, dict)
        else None
    )
    environment_enabled = story_memory_pipeline._normalize_story_environment_enabled(
        getattr(game, "environment_enabled", None)
    )
    latest_assistant_message_ids = set(
        story_memory_pipeline._list_story_latest_assistant_message_ids(
            db,
            game.id,
            limit=max(
                1,
                int(
                    getattr(
                        story_memory_pipeline,
                        "STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS",
                        1,
                    )
                    or 1
                ),
            ),
        )
    )
    preserve_assistant_text = (
        bool(memory_optimization_enabled)
        and int(getattr(assistant_message, "id", 0) or 0) in latest_assistant_message_ids
    )
    should_force_memory_rebalance = bool(memory_optimization_enabled) and bool(
        latest_user_prompt or latest_assistant_text
    )

    location_payload_for_sync = (
        postprocess_payload.get("location")
        if isinstance(postprocess_payload, dict) and isinstance(postprocess_payload.get("location"), dict)
        else {"action": "keep"}
    )
    environment_payload_for_sync = (
        postprocess_payload.get("environment")
        if environment_enabled
        and isinstance(postprocess_payload, dict)
        and isinstance(postprocess_payload.get("environment"), dict)
        else None
    )
    important_payload = (
        postprocess_payload.get("important_event")
        if bool(memory_optimization_enabled)
        and isinstance(postprocess_payload, dict)
        and isinstance(postprocess_payload.get("important_event"), tuple)
        else None
    )
    # Memory optimization is mandatory for runtime and fallback paths.
    if not bool(getattr(game, "memory_optimization_enabled", True)):
        game.memory_optimization_enabled = True

    memory_changed = False
    raw_memory_resynced = False
    key_memory_changed = False
    location_changed = False
    environment_changed = False
    rebalance_changed = False

    try:
        memory_changed = story_memory_pipeline._upsert_story_raw_memory_block(
            db=db,
            game=game,
            assistant_message=assistant_message,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            preserve_user_text=preserve_assistant_text,
            preserve_assistant_text=preserve_assistant_text,
        )
        raw_memory_resync_fn = getattr(
            story_memory_pipeline,
            "_sync_story_raw_memory_blocks_for_recent_turns",
            None,
        )
        if callable(raw_memory_resync_fn):
            raw_memory_resynced = bool(
                raw_memory_resync_fn(
                    db=db,
                    game=game,
                    additional_assistant_message_ids=[int(getattr(assistant_message, "id", 0) or 0)],
                )
            )
            memory_changed = bool(memory_changed or raw_memory_resynced)
        location_changed = story_memory_pipeline._upsert_story_location_memory_block(
            db=db,
            game=game,
            assistant_message=assistant_message,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            previous_assistant_text=previous_assistant_text,
            resolved_payload_override=location_payload_for_sync,
        )
        current_location_content = story_memory_pipeline._get_story_latest_location_memory_content(
            db=db,
            game_id=game.id,
        )
        if environment_enabled:
            environment_changed = story_memory_pipeline._sync_story_environment_state_for_assistant_message(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt=latest_user_prompt,
                latest_assistant_text=latest_assistant_text,
                previous_assistant_text=previous_assistant_text,
                current_location_content_override=current_location_content,
                resolved_payload_override=environment_payload_for_sync,
                allow_weather_seed=False,
                allow_model_request=False,
            )
        if isinstance(important_payload, tuple) and len(important_payload) == 2:
            key_memory_changed = bool(
                story_memory_pipeline._create_story_key_memory_block(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    title=str(important_payload[0] or ""),
                    content=str(important_payload[1] or ""),
                )
            )
        if should_force_memory_rebalance or memory_changed or key_memory_changed:
            try:
                story_memory_pipeline._rebalance_story_memory_layers(db=db, game=game)
                rebalance_changed = True
            except Exception:
                logger.exception(
                    "Fallback runtime failed to rebalance story memory layers: game_id=%s assistant_message_id=%s",
                    game.id,
                    assistant_message.id,
                )
        if memory_changed or location_changed or environment_changed or key_memory_changed or rebalance_changed:
            touch_story_game(game)
            db.commit()
            db.refresh(game)
            try:
                db.refresh(assistant_message)
            except Exception:
                pass
            return True
        return False
    except Exception:
        logger.exception(
            "Fallback runtime failed to sync direct story memory/environment pipeline: game_id=%s assistant_message_id=%s",
            game.id,
            assistant_message.id,
        )
        db.rollback()
        if isinstance(resolved_postprocess_payload_override, dict):
            return _fallback_apply_story_grok_postprocess_payload(
                db=db,
                game=game,
                assistant_message=assistant_message,
                payload=resolved_postprocess_payload_override,
            )
        return False


def _fallback_upsert_story_plot_memory_card(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    latest_user_prompt_override: str | None = None,
    latest_assistant_text_override: str | None = None,
    resolved_postprocess_payload_override: dict[str, Any] | None = None,
    memory_optimization_enabled: bool = True,
    allow_model_postprocess_request: bool = False,
) -> tuple[bool, list[Any]]:
    memory_optimization_enabled = True
    try:
        from app import main as monolith_main

        monolith_upsert = getattr(monolith_main, "_upsert_story_plot_memory_card", None)
    except Exception:
        monolith_upsert = None
        logger.exception("Fallback runtime failed to import monolith memory upsert")

    if callable(monolith_upsert):
        try:
            return monolith_upsert(
                db=db,
                game=game,
                assistant_message=assistant_message,
                latest_user_prompt_override=latest_user_prompt_override,
                latest_assistant_text_override=latest_assistant_text_override,
                resolved_postprocess_payload_override=resolved_postprocess_payload_override,
                memory_optimization_enabled=memory_optimization_enabled,
                allow_model_postprocess_request=allow_model_postprocess_request,
            )
        except Exception:
            logger.exception(
                "Fallback runtime failed to delegate memory upsert to monolith: game_id=%s assistant_message_id=%s",
                game.id,
                assistant_message.id,
            )
            db.rollback()
    _fallback_sync_story_memory_and_environment(
        db=db,
        game=game,
        assistant_message=assistant_message,
        latest_user_prompt_override=latest_user_prompt_override,
        latest_assistant_text_override=latest_assistant_text_override,
        resolved_postprocess_payload_override=resolved_postprocess_payload_override,
        memory_optimization_enabled=memory_optimization_enabled,
    )
    return (False, [])


def _fallback_build_story_runtime_deps() -> StoryRuntimeDeps:
    return StoryRuntimeDeps(
        validate_provider_config=_fallback_validate_provider_config,
        get_current_user=get_current_user,
        get_user_story_game_or_404=get_user_story_game_or_404,
        list_story_messages=list_story_messages,
        normalize_generation_instructions=_fallback_normalize_generation_instructions,
        rollback_story_card_events_for_assistant_message=rollback_story_card_events_for_assistant_message,
        normalize_text=normalize_story_text,
        derive_story_title=_fallback_derive_story_title,
        touch_story_game=touch_story_game,
        list_story_plot_cards=list_story_plot_cards,
        list_story_world_cards=list_story_world_cards,
        select_story_world_cards_for_prompt=_fallback_select_story_world_cards_for_prompt,
        select_story_world_cards_triggered_by_text=_fallback_select_story_world_cards_triggered_by_text,
        normalize_context_limit_chars=normalize_story_context_limit_chars,
        get_story_turn_cost_tokens=get_story_turn_cost_tokens,
        spend_user_tokens_if_sufficient=_fallback_spend_user_tokens_if_sufficient,
        add_user_tokens=_fallback_add_user_tokens,
        stream_story_provider_chunks=_fallback_iter_story_provider_chunks,
        normalize_generated_story_output=_fallback_normalize_generated_story_output,
        persist_generated_world_cards=_fallback_persist_generated_world_cards,
        upsert_story_plot_memory_card=_fallback_upsert_story_plot_memory_card,
        list_story_prompt_memory_cards=_fallback_list_story_prompt_memory_cards,
        list_story_memory_blocks=list_story_memory_blocks,
        seed_opening_scene_memory_block=_fallback_seed_story_opening_scene_memory_block,
        memory_block_to_out=story_memory_block_to_out,
        plot_card_to_out=story_plot_card_to_out,
        world_card_to_out=story_world_card_to_out,
        world_card_event_to_out=story_world_card_change_event_to_out,
        plot_card_event_to_out=story_plot_card_change_event_to_out,
        resolve_story_ambient_profile=lambda **kwargs: None,
        resolve_story_scene_emotion_payload=lambda **kwargs: None,
        resolve_story_turn_postprocess_payload=_fallback_resolve_story_turn_postprocess_payload,
        serialize_story_ambient_profile=serialize_story_ambient_profile,
        story_game_summary_to_out=story_game_summary_to_out,
        story_default_title=STORY_DEFAULT_TITLE,
        story_user_role="user",
        story_assistant_role="assistant",
        stream_persist_min_chars=_FALLBACK_STREAM_PERSIST_MIN_CHARS,
        stream_persist_max_interval_seconds=_FALLBACK_STREAM_PERSIST_MAX_INTERVAL_SECONDS,
    )


def _fallback_validate_provider_config() -> None:
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Story provider is not configured: missing OPENROUTER_API_KEY",
        )
    if not settings.openrouter_chat_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Story provider is not configured: missing OPENROUTER_CHAT_URL",
        )


def _fallback_spend_user_tokens_if_sufficient(db: Session, user_id: int, tokens: int) -> bool:
    return spend_user_tokens_if_sufficient(
        db,
        user_id=int(user_id),
        tokens=int(tokens),
    )


def _fallback_add_user_tokens(db: Session, user_id: int, tokens: int) -> None:
    add_user_tokens(
        db,
        user_id=int(user_id),
        tokens=int(tokens),
    )


def _generate_story_response_fallback_impl(
    *,
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StreamingResponse:
    try:
        return generate_story_response(
            deps=_fallback_build_story_runtime_deps(),
            game_id=game_id,
            payload=payload,
            authorization=authorization,
            db=db,
        )
    except HTTPException as exc:
        detail = str(getattr(exc, "detail", "") or "").strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(
            "Fallback story generate request failed before stream start: game_id=%s status=%s detail=%s",
            game_id,
            exc.status_code,
            detail or "n/a",
        )
        if exc.status_code == status.HTTP_400_BAD_REQUEST and _fallback_is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_fallback_public_story_provider_failure_detail(detail),
            ) from exc
        raise
    except Exception as exc:
        detail = str(exc).strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception(
            "Fallback story generate request crashed before stream start: game_id=%s detail=%s",
            game_id,
            detail or "n/a",
        )
        if _fallback_is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_fallback_public_story_provider_failure_detail(detail),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(detail or "Story state could not be prepared before generation")[:500],
        ) from exc


@router.post("/api/story/games/{game_id}/generate")
def generate_story_response_route(
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        from app.services.story_generation_entry import (
            generate_story_response_impl as primary_generate_story_response_impl,
        )
    except Exception:
        logger.exception("Primary story runtime import failed before generate route dispatch: game_id=%s", game_id)
        return _generate_story_response_fallback_impl(
            game_id=game_id,
            payload=payload,
            authorization=authorization,
            db=db,
        )

    try:
        return primary_generate_story_response_impl(
            game_id=game_id,
            payload=payload,
            authorization=authorization,
            db=db,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Primary story generate crashed before stream start, falling back: game_id=%s",
            game_id,
        )
    return _generate_story_response_fallback_impl(
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )
