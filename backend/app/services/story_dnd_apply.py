"""Applying D&D upkeep to the game state, with every clamp in one place.

The service model proposes; this module disposes. Nothing that arrives from an LLM is
trusted as a final number here: damage is bounded by the hero's own maximum, relationships
can only drift a little per turn, the clock can only move as far as the declared elapsed
time allows, and the season is computed from the calendar rather than accepted from text.

That separation is the point. If a prompt regresses, or a provider returns something wild,
the worst case is a turn that changes less than it should -- never a character wiped out or
a mid-summer blizzard.
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.story_dnd import (
    ABILITY_IDS,
    DND_MAX_NOTES,
    DND_MAX_NPCS,
    DND_MAX_QUESTS,
    DND_RELATION_MAX_TURN_DELTA,
    DND_TIME_IDS,
    DND_WEATHER_LABELS,
    STORY_DND_PLAY_MODE_SANDBOX,
    advance_environment_season,
    ability_modifier,
    award_experience,
    clamp_relation_score,
    normalize_dnd_condition_id,
    normalize_dnd_conditions,
    normalize_dnd_environment,
    normalize_dnd_inventory,
    normalize_dnd_level,
    normalize_dnd_play_mode,
    normalize_dnd_relation_id,
    normalize_dnd_state,
    normalize_dnd_time_of_day,
    normalize_dnd_weather,
    normalize_single_line,
    normalize_text_value,
    relation_id_for_score,
)
from app.services.story_dnd_service import (
    DND_ELAPSED_BOUNDS,
    normalize_dnd_elapsed,
)


logger = logging.getLogger(__name__)

# A single turn can never take a character from full health to dead through a bad parse: the
# most one upkeep pass may move hit points is the hero's own maximum. A genuinely lethal blow
# still reaches 0, which is what matters narratively.
HP_DELTA_ABSOLUTE_CEILING = 400
GOLD_DELTA_CEILING = 100_000
NPC_HP_DELTA_CEILING = 400
TEMP_HP_CEILING = 99


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _npc_match_key(value: Any) -> str:
    return normalize_single_line(value, max_length=80).casefold()


# --- Hit points, gold, experience -------------------------------------------------------------

def _apply_hero_vitals(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    changes: list[str] = []
    hero = _as_dict(state.get("hero"))
    hp = _as_dict(hero.get("hp"))
    max_hp = max(int(hp.get("max") or 1), 1)

    hp_update = _as_dict(payload.get("hp"))
    if hp_update.get("should_update"):
        try:
            delta = int(hp_update.get("delta") or 0)
        except (TypeError, ValueError):
            delta = 0
        delta = max(-min(max_hp, HP_DELTA_ABSOLUTE_CEILING), min(min(max_hp, HP_DELTA_ABSOLUTE_CEILING), delta))
        if delta:
            current = max(int(hp.get("current") or 0), 0)
            temp = max(int(hp.get("temp") or 0), 0)
            if delta < 0 and temp > 0:
                # Temporary hit points soak damage first, exactly as in the rulebook.
                absorbed = min(temp, -delta)
                temp -= absorbed
                delta += absorbed
            next_current = max(0, min(max_hp, current + delta))
            hp["current"] = next_current
            hp["temp"] = temp
            changes.append(f"hp {current}->{next_current}")

    temp_update = _as_dict(payload.get("temp_hp"))
    if temp_update.get("should_update"):
        try:
            value = int(temp_update.get("value") or 0)
        except (TypeError, ValueError):
            value = 0
        hp["temp"] = max(0, min(TEMP_HP_CEILING, value))
        changes.append(f"temp_hp={hp['temp']}")

    hero["hp"] = hp

    gold_update = _as_dict(payload.get("gold"))
    if gold_update.get("should_update"):
        try:
            delta = int(gold_update.get("delta") or 0)
        except (TypeError, ValueError):
            delta = 0
        delta = max(-GOLD_DELTA_CEILING, min(GOLD_DELTA_CEILING, delta))
        if delta:
            hero["gold"] = max(0, int(hero.get("gold") or 0) + delta)
            changes.append(f"gold{delta:+d}")

    state["hero"] = hero
    return changes


def _apply_inventory(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    inventory_update = _as_dict(payload.get("inventory"))
    if not inventory_update.get("should_update"):
        return []
    hero = _as_dict(state.get("hero"))
    # Sandbox inventory is the player's own free text; the narrator must not rewrite it.
    if normalize_dnd_play_mode(state.get("play_mode")) == STORY_DND_PLAY_MODE_SANDBOX:
        return []
    current = list(normalize_dnd_inventory(hero.get("inventory")))
    removed_keys = {
        _npc_match_key(item) for item in _as_list(inventory_update.get("removed")) if str(item or "").strip()
    }
    kept = [item for item in current if _npc_match_key(item) not in removed_keys]
    added = [
        normalize_single_line(item, max_length=120)
        for item in _as_list(inventory_update.get("added"))
        if normalize_single_line(item, max_length=120)
    ]
    existing_keys = {_npc_match_key(item) for item in kept}
    for item in added:
        if _npc_match_key(item) in existing_keys:
            continue
        existing_keys.add(_npc_match_key(item))
        kept.append(item)
    next_inventory = normalize_dnd_inventory(kept)
    if next_inventory == current:
        return []
    hero["inventory"] = next_inventory
    state["hero"] = hero
    return [f"inventory {len(current)}->{len(next_inventory)}"]


def _apply_conditions(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    conditions_update = _as_dict(payload.get("conditions"))
    if not conditions_update.get("should_update"):
        return []
    hero = _as_dict(state.get("hero"))
    current = [item for item in _as_list(hero.get("conditions")) if isinstance(item, dict)]
    removed_ids = {
        normalize_dnd_condition_id(item)
        for item in _as_list(conditions_update.get("removed"))
    }
    removed_ids.discard("")
    kept = [item for item in current if normalize_dnd_condition_id(item.get("id")) not in removed_ids]
    for raw_added in _as_list(conditions_update.get("added")):
        condition_id = normalize_dnd_condition_id(
            raw_added.get("id") if isinstance(raw_added, dict) else raw_added
        )
        if not condition_id:
            continue
        note = normalize_single_line(
            raw_added.get("note") if isinstance(raw_added, dict) else "", max_length=120
        )
        kept = [item for item in kept if normalize_dnd_condition_id(item.get("id")) != condition_id]
        kept.append({"id": condition_id, "note": note})
    next_conditions = normalize_dnd_conditions(kept)
    if next_conditions == normalize_dnd_conditions(current):
        return []
    hero["conditions"] = next_conditions
    state["hero"] = hero
    return [f"conditions={len(next_conditions)}"]


def _apply_experience(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    bucket = str(payload.get("xp_bucket") or "none")
    if bucket == "none":
        return []
    before_level = normalize_dnd_level(_as_dict(state.get("hero")).get("level"))
    before_xp = int(_as_dict(state.get("hero")).get("xp") or 0)
    award_experience(state, bucket, reason=str(payload.get("xp_reason") or ""))
    after = _as_dict(state.get("hero"))
    changes = [f"xp {before_xp}->{after.get('xp')}"]
    if normalize_dnd_level(after.get("level")) > before_level:
        changes.append(f"level {before_level}->{after.get('level')}")
    return changes


# --- Time and weather ------------------------------------------------------------------------

def _apply_environment(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    """Move the clock by no more than the declared elapsed time allows.

    This is the rule the player asked for in plain words: a scene that did not move must not
    become night, and winter must not arrive out of nowhere. Both are enforced structurally --
    the time-of-day may only step forward within the elapsed budget, and the season is not an
    input at all, it follows from the day counter.
    """
    if normalize_dnd_play_mode(state.get("play_mode")) == STORY_DND_PLAY_MODE_SANDBOX:
        # Sandbox weather and time belong to the player.
        return []
    environment_update = _as_dict(payload.get("environment"))
    environment = normalize_dnd_environment(_as_dict(state.get("environment")), locked=True)
    elapsed = normalize_dnd_elapsed(environment_update.get("elapsed"))
    max_slots, min_days, max_days = DND_ELAPSED_BOUNDS[elapsed]
    changes: list[str] = []

    current_time = normalize_dnd_time_of_day(environment.get("time_of_day"))
    requested_time = str(environment_update.get("time_of_day") or "").strip()
    day_rollovers = 0
    if requested_time and max_slots > 0:
        target_time = normalize_dnd_time_of_day(requested_time)
        current_index = DND_TIME_IDS.index(current_time)
        target_index = DND_TIME_IDS.index(target_time)
        forward_steps = (target_index - current_index) % len(DND_TIME_IDS)
        if forward_steps == 0:
            pass
        elif forward_steps <= max_slots:
            environment["time_of_day"] = target_time
            # Crossing back past midnight means a new day even when the model said nothing.
            if target_index <= current_index:
                day_rollovers = 1
            changes.append(f"time {current_time}->{target_time}")
        else:
            # Asked for more than the elapsed time allows: advance as far as it does allow,
            # so a long scene still feels like it moved without teleporting to nightfall.
            capped_index = (current_index + max_slots) % len(DND_TIME_IDS)
            environment["time_of_day"] = DND_TIME_IDS[capped_index]
            if capped_index <= current_index:
                day_rollovers = 1
            changes.append(f"time {current_time}->{DND_TIME_IDS[capped_index]} (capped)")

    try:
        requested_days = int(environment_update.get("day_delta") or 0)
    except (TypeError, ValueError):
        requested_days = 0
    day_delta = max(min_days, min(max_days, max(requested_days, 0)))
    day_delta = max(day_delta, day_rollovers if max_days >= day_rollovers else 0)
    if day_delta:
        environment["day"] = max(1, int(environment.get("day") or 1) + day_delta)
        changes.append(f"day+{day_delta}")

    environment = advance_environment_season(environment)

    requested_weather = str(environment_update.get("weather") or "").strip()
    # Weather is a slow variable: it may only turn over once real in-game time has passed.
    if requested_weather and max_slots > 0:
        next_weather = normalize_dnd_weather(requested_weather, season=environment.get("season"))
        if next_weather != environment.get("weather"):
            environment["weather"] = next_weather
            changes.append(f"weather->{DND_WEATHER_LABELS.get(next_weather, next_weather)}")
    weather_note = normalize_single_line(environment_update.get("weather_note"), max_length=80)
    if weather_note:
        environment["weather_note"] = weather_note

    state["environment"] = environment
    return changes


# --- Quests and master notes --------------------------------------------------------------------

def _apply_quests(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    quests_update = _as_dict(payload.get("quests"))
    quests = [item for item in _as_list(state.get("quests")) if isinstance(item, dict)]
    changes: list[str] = []
    by_key = {_npc_match_key(quest.get("title")): quest for quest in quests}

    for raw_added in _as_list(quests_update.get("added")):
        title = normalize_single_line(
            raw_added.get("title") if isinstance(raw_added, dict) else raw_added, max_length=120
        )
        if not title or _npc_match_key(title) in by_key:
            continue
        quest = {
            "title": title,
            "detail": normalize_text_value(
                raw_added.get("detail") if isinstance(raw_added, dict) else "", max_length=600
            ),
            "status": "active",
        }
        quests.append(quest)
        by_key[_npc_match_key(title)] = quest
        changes.append(f"quest+{title}")

    for status, key in (("done", "completed"), ("failed", "failed")):
        for raw_title in _as_list(quests_update.get(key)):
            quest = by_key.get(_npc_match_key(raw_title))
            if quest is None or quest.get("status") == status:
                continue
            quest["status"] = status
            changes.append(f"quest {status}: {quest.get('title')}")

    # Finished quests stay visible for a while but must never crowd out live ones.
    active = [quest for quest in quests if quest.get("status") == "active"]
    finished = [quest for quest in quests if quest.get("status") != "active"]
    state["quests"] = (active + finished)[:DND_MAX_QUESTS]
    return changes


def _apply_master_notes(state: dict[str, Any], payload: dict[str, Any], *, turn_index: int) -> list[str]:
    raw_notes = [
        normalize_text_value(note, max_length=500)
        for note in _as_list(payload.get("master_notes"))
    ]
    fresh = [note for note in raw_notes if note]
    if not fresh:
        return []
    existing = [item for item in _as_list(state.get("notes")) if isinstance(item, dict)]
    existing_keys = {_npc_match_key(item.get("text")) for item in existing}
    added = 0
    for note in fresh:
        if _npc_match_key(note) in existing_keys:
            continue
        existing_keys.add(_npc_match_key(note))
        existing.insert(0, {"text": note, "turn": max(int(turn_index or 0), 0)})
        added += 1
    state["notes"] = existing[:DND_MAX_NOTES]
    return [f"notes+{added}"] if added else []


# --- NPCs ------------------------------------------------------------------------------------

def _default_npc_entry(*, name: str, world_card_id: int | None, role: str, level: int) -> dict[str, Any]:
    normalized_level = normalize_dnd_level(level)
    abilities = {ability_id: 10 for ability_id in ABILITY_IDS}
    max_hp = max(4, 6 * normalized_level)
    return {
        "key": _npc_match_key(name),
        "world_card_id": world_card_id,
        "name": name,
        "role": role,
        "relation": "neutral",
        "relation_score": 0,
        "relation_note": "",
        "level": normalized_level,
        "abilities": abilities,
        "hp": {"current": max_hp, "max": max_hp, "temp": 0},
        "armor_class": 10 + ability_modifier(abilities["dex"]),
        "conditions": [],
        "is_active": False,
        "stats_source": "ai",
        "notes": "",
    }


def _find_npc_entry(npcs: list[dict[str, Any]], *, name: str, world_card_id: Any) -> dict[str, Any] | None:
    normalized_card_id = (
        int(world_card_id)
        if str(world_card_id or "").strip().isdigit() and int(world_card_id) > 0
        else None
    )
    if normalized_card_id is not None:
        for npc in npcs:
            if npc.get("world_card_id") == normalized_card_id:
                return npc
    key = _npc_match_key(name)
    if not key:
        return None
    for npc in npcs:
        if _npc_match_key(npc.get("name")) == key or str(npc.get("key") or "") == key:
            return npc
    return None


def _apply_npcs(state: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    updates = [item for item in _as_list(payload.get("npcs")) if isinstance(item, dict)]
    if not updates:
        return []
    npcs = [item for item in _as_list(state.get("npcs")) if isinstance(item, dict)]
    changes: list[str] = []
    touched_keys: set[str] = set()

    for update in updates:
        name = normalize_single_line(update.get("name"), max_length=80)
        if not name:
            continue
        entry = _find_npc_entry(npcs, name=name, world_card_id=update.get("world_card_id"))
        if entry is None:
            if len(npcs) >= DND_MAX_NPCS:
                continue
            entry = _default_npc_entry(
                name=name,
                world_card_id=(
                    int(update.get("world_card_id"))
                    if str(update.get("world_card_id") or "").strip().isdigit()
                    and int(update.get("world_card_id")) > 0
                    else None
                ),
                role=normalize_single_line(update.get("role"), max_length=80),
                level=int(update.get("level") or 1),
            )
            npcs.append(entry)
            changes.append(f"npc+{name}")
        touched_keys.add(_npc_match_key(entry.get("name")))

        if update.get("role") and not entry.get("role"):
            entry["role"] = normalize_single_line(update.get("role"), max_length=80)
        entry["is_active"] = bool(update.get("is_active"))

        try:
            relation_delta = int(update.get("relation_delta") or 0)
        except (TypeError, ValueError):
            relation_delta = 0
        relation_delta = max(-DND_RELATION_MAX_TURN_DELTA, min(DND_RELATION_MAX_TURN_DELTA, relation_delta))
        if relation_delta:
            next_score = clamp_relation_score(int(entry.get("relation_score") or 0) + relation_delta)
            previous_relation = normalize_dnd_relation_id(entry.get("relation"))
            entry["relation_score"] = next_score
            entry["relation"] = relation_id_for_score(next_score)
            if entry["relation"] != previous_relation:
                changes.append(f"{name}: {previous_relation}->{entry['relation']}")
        relation_note = normalize_single_line(update.get("relation_note"), max_length=140)
        if relation_note:
            entry["relation_note"] = relation_note

        try:
            hp_delta = int(update.get("hp_delta") or 0)
        except (TypeError, ValueError):
            hp_delta = 0
        if hp_delta:
            npc_hp = _as_dict(entry.get("hp"))
            npc_max = max(int(npc_hp.get("max") or 1), 1)
            bounded = max(-min(npc_max, NPC_HP_DELTA_CEILING), min(min(npc_max, NPC_HP_DELTA_CEILING), hp_delta))
            npc_hp["current"] = max(0, min(npc_max, int(npc_hp.get("current") or 0) + bounded))
            entry["hp"] = npc_hp
            changes.append(f"{name}: hp{bounded:+d}")

        # An NPC level set by the player is deliberate (an archmage should stay an archmage),
        # so the service model may only raise a level it previously chose itself.
        raw_level = update.get("level")
        if raw_level is not None and str(entry.get("stats_source") or "ai") != "manual":
            next_level = normalize_dnd_level(raw_level)
            if next_level > normalize_dnd_level(entry.get("level")):
                entry["level"] = next_level
                changes.append(f"{name}: level->{next_level}")

    # Anyone the turn did not mention is no longer on stage.
    for npc in npcs:
        if _npc_match_key(npc.get("name")) not in touched_keys:
            npc["is_active"] = False

    state["npcs"] = npcs
    return changes


# --- Entry point ---------------------------------------------------------------------------------

def apply_dnd_turn_upkeep(
    state: dict[str, Any],
    payload: dict[str, Any],
    *,
    turn_index: int = 0,
) -> tuple[dict[str, Any], list[str]]:
    """Apply one upkeep payload. Returns the normalized next state and a change log."""
    working = normalize_dnd_state(state)
    if not isinstance(payload, dict):
        return working, []
    changes: list[str] = []
    changes.extend(_apply_hero_vitals(working, payload))
    changes.extend(_apply_inventory(working, payload))
    changes.extend(_apply_conditions(working, payload))
    changes.extend(_apply_experience(working, payload))
    changes.extend(_apply_environment(working, payload))
    changes.extend(_apply_quests(working, payload))
    changes.extend(_apply_master_notes(working, payload, turn_index=turn_index))
    changes.extend(_apply_npcs(working, payload))
    return normalize_dnd_state(working), changes


def sync_dnd_npcs_from_world_cards(
    state: dict[str, Any],
    world_cards: list[Any],
) -> dict[str, Any]:
    """Give every NPC card in the game a D&D entry, and keep names/avatars in step.

    The existing auto-NPC module already decides which characters are worth a card -- it
    invents names for important unnamed figures and skips crowds. Reusing that judgement is
    what keeps "Бандит 1" out of the codex while the head of the thieves' guild gets in.
    """
    working = normalize_dnd_state(state)
    npcs = [item for item in _as_list(working.get("npcs")) if isinstance(item, dict)]
    by_card_id = {npc.get("world_card_id"): npc for npc in npcs if npc.get("world_card_id")}
    by_name = {_npc_match_key(npc.get("name")): npc for npc in npcs}

    for card in world_cards or []:
        kind = str(getattr(card, "kind", "") or "").strip().lower()
        if kind != "npc":
            continue
        card_id = int(getattr(card, "id", 0) or 0)
        title = normalize_single_line(getattr(card, "title", ""), max_length=80)
        if not card_id or not title:
            continue
        entry = by_card_id.get(card_id) or by_name.get(_npc_match_key(title))
        if entry is None:
            if len(npcs) >= DND_MAX_NPCS:
                continue
            entry = _default_npc_entry(name=title, world_card_id=card_id, role="", level=1)
            npcs.append(entry)
            by_name[_npc_match_key(title)] = entry
        entry["world_card_id"] = card_id
        entry["name"] = title
        by_card_id[card_id] = entry

    working["npcs"] = npcs
    return normalize_dnd_state(working)
