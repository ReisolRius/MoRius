from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import StoryGame, StoryWorldCard
from app.services.story_character_state_snapshots import sync_story_character_state_manual_snapshot
from app.services.story_characters import (
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
)
from app.services.story_queries import list_story_world_cards
from app.services.story_world_cards import (
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    STORY_WORLD_CARD_KIND_NPC,
    normalize_story_world_card_kind,
)

STORY_CHARACTER_STATE_DIRECT_EDIT_LOCK_TURNS = 1
_WORLD_CARD_STATE_LOCK_KEYS: dict[str, str] = {
    "status": "status_manual_override_turns",
    "clothing": "clothing_manual_override_turns",
    "equipment": "equipment_manual_override_turns",
}


def _iter_story_tracked_world_cards(db: Session, game_id: int) -> list[StoryWorldCard]:
    return [
        world_card
        for world_card in list_story_world_cards(db, game_id)
        if normalize_story_world_card_kind(getattr(world_card, "kind", None))
        in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}
    ]


def _build_story_character_state_card_from_world_card(
    world_card: StoryWorldCard,
    existing_card: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not bool(getattr(world_card, "ai_edit_enabled", True)):
        return None

    normalized_name = " ".join(str(getattr(world_card, "title", "") or "").split()).strip()
    normalized_kind = normalize_story_world_card_kind(getattr(world_card, "kind", None))
    if not normalized_name or normalized_kind not in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}:
        return None

    existing_card = existing_card or {}
    next_card: dict[str, Any] = {
        "world_card_id": int(world_card.id),
        "name": normalized_name,
        "kind": normalized_kind,
        "is_active": bool(existing_card.get("is_active", True)),
        "status": normalize_story_character_health_status(getattr(world_card, "health_status", "")),
        "clothing": normalize_story_character_clothing(getattr(world_card, "clothing", "")),
        "location": str(existing_card.get("location") or "").strip(),
        "equipment": normalize_story_character_inventory(getattr(world_card, "inventory", "")),
        "mood": str(existing_card.get("mood") or "").strip(),
        "attitude_to_hero": str(existing_card.get("attitude_to_hero") or "").strip(),
        "personality": str(existing_card.get("personality") or "").strip(),
    }
    for lock_key in (
        "status_manual_override_turns",
        "clothing_manual_override_turns",
        "equipment_manual_override_turns",
        "mood_manual_override_turns",
        "attitude_to_hero_manual_override_turns",
    ):
        existing_lock_value = existing_card.get(lock_key)
        if isinstance(existing_lock_value, int) and existing_lock_value > 0:
            next_card[lock_key] = existing_lock_value
    if existing_card:
        for field_name, lock_key in _WORLD_CARD_STATE_LOCK_KEYS.items():
            if str(existing_card.get(field_name) or "").strip() == str(next_card.get(field_name) or "").strip():
                continue
            next_card[lock_key] = STORY_CHARACTER_STATE_DIRECT_EDIT_LOCK_TURNS
    return next_card


def sync_story_character_state_payload_from_world_cards(
    *,
    db: Session,
    game: StoryGame,
    sync_manual_snapshot: bool = False,
) -> bool:
    from app.services import story_memory_pipeline

    existing_cards = story_memory_pipeline._story_character_state_cards_from_game(game)
    existing_by_world_card_id = {
        int(card.get("world_card_id")): card
        for card in existing_cards
        if isinstance(card, dict) and isinstance(card.get("world_card_id"), int)
    }
    next_cards: list[dict[str, Any]] = []
    for world_card in _iter_story_tracked_world_cards(db, int(game.id)):
        next_card = _build_story_character_state_card_from_world_card(
            world_card,
            existing_by_world_card_id.get(int(world_card.id)),
        )
        if next_card is not None:
            next_cards.append(next_card)

    next_payload = story_memory_pipeline._serialize_story_character_state_cards_payload(next_cards)
    changed = str(getattr(game, "character_state_payload", "") or "") != next_payload
    if changed:
        game.character_state_payload = next_payload
    if sync_manual_snapshot:
        sync_story_character_state_manual_snapshot(db=db, game=game)
    return changed


def apply_story_character_state_payload_to_world_cards(
    *,
    db: Session,
    game: StoryGame,
) -> bool:
    from app.services import story_memory_pipeline

    state_cards = story_memory_pipeline._story_character_state_cards_from_game(game)
    state_by_world_card_id = {
        int(card.get("world_card_id")): card
        for card in state_cards
        if isinstance(card, dict) and isinstance(card.get("world_card_id"), int)
    }

    changed = False
    for world_card in _iter_story_tracked_world_cards(db, int(game.id)):
        if not bool(getattr(world_card, "ai_edit_enabled", True)):
            continue
        state_card = state_by_world_card_id.get(int(world_card.id))
        if state_card is None:
            continue

        next_health_status = normalize_story_character_health_status(state_card.get("status"))
        next_clothing = normalize_story_character_clothing(state_card.get("clothing"))
        next_inventory = normalize_story_character_inventory(state_card.get("equipment"))

        if str(getattr(world_card, "health_status", "") or "").strip() != next_health_status:
            world_card.health_status = next_health_status
            changed = True
        if str(getattr(world_card, "clothing", "") or "").strip() != next_clothing:
            world_card.clothing = next_clothing
            changed = True
        if str(getattr(world_card, "inventory", "") or "").strip() != next_inventory:
            world_card.inventory = next_inventory
            changed = True

    return changed
