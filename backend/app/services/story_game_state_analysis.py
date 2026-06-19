from __future__ import annotations

import json
import re
from typing import Any

from app.models import StoryWorldCard


_PUNCTUATION_PATTERN = re.compile(r"[^\w\sА-Яа-яЁё-]+", re.UNICODE)


def normalize_match_text(value: Any) -> str:
    normalized = str(value or "").replace("ё", "е").replace("Ё", "Е").casefold()
    normalized = _PUNCTUATION_PATTERN.sub(" ", normalized)
    return " ".join(normalized.split()).strip()


def parse_json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        if isinstance(parsed, list):
            return parsed
    return []


def world_card_to_character_payload(card: Any) -> dict[str, Any] | None:
    kind = str(getattr(card, "kind", "") if not isinstance(card, dict) else card.get("kind", "")).strip().lower()
    if kind not in {"npc", "main_hero"}:
        return None
    if isinstance(card, dict):
        card_id = card.get("id")
        title = str(card.get("title") or card.get("name") or "").strip()
        content = str(card.get("content") or "").strip()
        race = str(card.get("race") or "").strip()
        clothing = str(card.get("clothing") or "").strip()
        inventory = str(card.get("inventory") or "").strip()
        health_status = str(card.get("health_status") or "").strip()
        triggers = parse_json_list(card.get("triggers"))
        ai_edit_enabled = bool(card.get("ai_edit_enabled", True))
    else:
        card_id = getattr(card, "id", None)
        title = str(getattr(card, "title", "") or "").strip()
        content = str(getattr(card, "content", "") or "").strip()
        race = str(getattr(card, "race", "") or "").strip()
        clothing = str(getattr(card, "clothing", "") or "").strip()
        inventory = str(getattr(card, "inventory", "") or "").strip()
        health_status = str(getattr(card, "health_status", "") or "").strip()
        triggers = parse_json_list(getattr(card, "triggers", "[]"))
        ai_edit_enabled = bool(getattr(card, "ai_edit_enabled", True))
    if not title and not content:
        return None
    return {
        "id": card_id,
        "name": title,
        "kind": kind,
        "race": race or None,
        "description": content,
        "clothing": clothing,
        "inventory": inventory,
        "health_status": health_status,
        "triggers": [str(item).strip() for item in triggers if str(item or "").strip()],
        "ai_edit_enabled": ai_edit_enabled,
    }


class NpcCardDedupService:
    def build_candidates(
        self,
        *,
        cards: list[StoryWorldCard] | list[Any],
        player_turn: str,
        narrator_response: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        scene_text = normalize_match_text(f"{player_turn}\n{narrator_response}")
        if not scene_text:
            return []

        candidates: list[tuple[int, dict[str, Any]]] = []
        seen_ids: set[int] = set()
        for card in cards:
            payload = world_card_to_character_payload(card)
            if not payload:
                continue
            card_id = payload.get("id")
            if isinstance(card_id, int) and card_id in seen_ids:
                continue
            search_values = [payload.get("name"), *(payload.get("triggers") or [])]
            description = str(payload.get("description") or "")
            score = 0
            for raw_value in search_values:
                normalized = normalize_match_text(raw_value)
                if normalized and normalized in scene_text:
                    score += 100 if normalized == normalize_match_text(payload.get("name")) else 80
            description_tokens = set(normalize_match_text(description).split())
            scene_tokens = set(scene_text.split())
            if description_tokens and scene_tokens:
                overlap = len(description_tokens.intersection(scene_tokens))
                score += min(overlap * 4, 40)
            if score <= 0:
                continue
            if isinstance(card_id, int):
                seen_ids.add(card_id)
            candidates.append((score, payload))

        candidates.sort(key=lambda item: (-item[0], str(item[1].get("name") or "")))
        return [payload for _, payload in candidates[: max(1, int(limit or 1))]]

    def find_existing_match(
        self,
        *,
        cards: list[StoryWorldCard] | list[Any],
        name: str,
        triggers: list[str],
        candidates: list[dict[str, Any]] | None = None,
    ) -> Any | None:
        candidate_keys = {
            normalize_match_text(value)
            for value in [name, *triggers]
            if normalize_match_text(value)
        }
        if not candidate_keys:
            return None

        def _card_keys(card: Any) -> set[str]:
            if isinstance(card, dict):
                title = card.get("title") or card.get("name")
                raw_triggers = parse_json_list(card.get("triggers"))
            else:
                title = getattr(card, "title", "")
                raw_triggers = parse_json_list(getattr(card, "triggers", "[]"))
            return {
                normalize_match_text(value)
                for value in [title, *raw_triggers]
                if normalize_match_text(value)
            }

        for card in cards:
            if candidate_keys.intersection(_card_keys(card)):
                return card

        by_id = {
            int(candidate["id"]): candidate
            for candidate in candidates or []
            if isinstance(candidate, dict) and isinstance(candidate.get("id"), int)
        }
        if not by_id:
            return None
        for card in cards:
            card_id = int(getattr(card, "id", 0) or 0)
            if card_id <= 0 or card_id not in by_id:
                continue
            if candidate_keys.intersection(_card_keys(card)):
                return card
        return None


def build_world_card_context(cards: list[Any]) -> str:
    lines: list[str] = []
    for card in cards:
        if isinstance(card, dict):
            kind = str(card.get("kind") or "").strip()
            title = str(card.get("title") or "").strip()
            content = str(card.get("content") or "").strip()
        else:
            kind = str(getattr(card, "kind", "") or "").strip()
            title = str(getattr(card, "title", "") or "").strip()
            content = str(getattr(card, "content", "") or "").strip()
        if not title and not content:
            continue
        lines.append(f"[{kind or 'card'}] {title}\n{content}".strip())
    return "\n\n".join(lines)
