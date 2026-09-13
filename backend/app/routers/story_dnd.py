"""HTTP surface for D&D mode.

Everything here is gated twice: the game must be ``game_mode='dnd'`` and the caller must be
an administrator (see ``can_user_use_story_dnd``). While the mode is being tested that keeps
it invisible to players, and a game that somehow carries the mode without the role simply
behaves as an ordinary RPG.

Billing: every endpoint that reaches the service model charges sols before the model is
called and refunds nothing on success, matching the one-sol-per-service-request unit the
environment, character and graph modules already use. Endpoints that only read or edit local
state are free.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMessage
from app.schemas import (
    StoryDndCheckOut,
    StoryDndCheckRequest,
    StoryDndCombatAdvanceRequest,
    StoryDndDeathSaveOut,
    StoryDndDifficultyRequest,
    StoryDndEnvironmentRequest,
    StoryDndHeroUpdateRequest,
    StoryDndInitiativeOut,
    StoryDndLevelUpRequest,
    StoryDndMeetingPromptOut,
    StoryDndNpcStatsOut,
    StoryDndNpcUpdateRequest,
    StoryDndPlayModeRequest,
    StoryDndRollOut,
    StoryDndRollPolicyRequest,
    StoryDndRollRequest,
    StoryDndStateOut,
    UserOut,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.story_dnd import (
    ABILITY_IDS,
    DND_CLASS_BY_ID,
    DND_COMBAT_PHASE_ACTIVE,
    DND_COMBAT_PHASE_INITIATIVE,
    DND_DEATH_SAVE_DC,
    DND_DEFAULT_DIE,
    DND_LIFE_STATE_ALIVE,
    DND_LIFE_STATE_DEAD,
    DND_MAX_SKILL_PROFICIENCIES,
    DND_RELATION_LABELS,
    STORY_DND_PLAY_MODE_SANDBOX,
    ability_modifier,
    advance_dnd_combat_turn,
    apply_death_save_roll,
    apply_race_bonuses,
    armor_class,
    asi_points_earned_through_level,
    build_check_modifier_breakdown,
    build_dnd_catalog,
    can_user_use_story_dnd,
    clamp_relation_score,
    combat_hero_participant,
    create_empty_dnd_combat,
    default_inventory_for,
    difficulty_hero_bonus,
    dnd_sheet_locks,
    get_game_dnd_state,
    is_story_dnd_game,
    max_hit_points,
    normalize_dnd_ability_id,
    normalize_dnd_background_id,
    normalize_dnd_check_kind,
    normalize_dnd_class_id,
    normalize_dnd_conditions,
    normalize_dnd_difficulty,
    normalize_dnd_die,
    normalize_dnd_environment,
    normalize_dnd_inventory,
    normalize_dnd_level,
    normalize_dnd_pending_check,
    normalize_dnd_play_mode,
    normalize_dnd_race_id,
    normalize_dnd_relation_id,
    normalize_dnd_roll_policy,
    normalize_dnd_season,
    normalize_dnd_skill_id,
    normalize_dnd_state,
    normalize_dnd_time_of_day,
    normalize_dnd_weather,
    normalize_single_line,
    normalize_text_value,
    perform_roll,
    proficiency_bonus,
    relation_id_for_score,
    resolve_check_advantage,
    resolve_check_dc,
    roll_npc_initiatives,
    set_game_dnd_state,
    start_dnd_combat_if_ready,
    validate_hero_sheet,
)
from app.services.story_dnd_apply import sync_dnd_npcs_from_world_cards
from app.services.story_dnd_service import (
    DND_CHECK_RECENT_TURNS,
    build_dnd_meeting_prompt,
    dnd_action_needs_model_check,
)
from app.services.story_game_operation_lock import (
    STORY_GAME_OPERATION_BUSY_DETAIL,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)
from app.services.story_queries import (
    get_user_story_game_or_404,
    list_story_world_cards,
    touch_story_game,
)


router = APIRouter()
logger = logging.getLogger(__name__)

_STORY_OPERATION_LOCK_TIMEOUT_SECONDS = 15.0

# One service-model HTTP request each, priced on the same basis as the existing per-turn
# service modules (see STORY_ENVIRONMENT_TIME_TURN_SURCHARGE_TOKENS in story_runtime): one
# sol per bounded request keeps the >= 55% margin the rest of the pricing table is built on.
DND_CHECK_COST_TOKENS = 1
DND_NPC_STATS_COST_TOKENS = 1


def _acquire_lease_or_409(*, game_id: int, operation: str):
    try:
        return acquire_story_game_operation_lock(
            game_id,
            operation=operation,
            wait_timeout_seconds=_STORY_OPERATION_LOCK_TIMEOUT_SECONDS,
        )
    except StoryGameOperationBusyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=STORY_GAME_OPERATION_BUSY_DETAIL,
        ) from exc


def _refund_service_tokens(db: Session, *, user, tokens: int) -> None:
    """Give a sol back when the service model never produced an answer.

    The mode charges before the call, like every other service module. That is fine while the
    call works -- and unfair the moment it does not, so a failed module hands the coin back
    instead of keeping it.
    """
    if tokens <= 0:
        return
    try:
        add_user_tokens(db, user_id=int(user.id), tokens=int(tokens))
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        logger.exception("Failed to refund D&D service tokens: user_id=%s", getattr(user, "id", None))


def _require_dnd_game(db: Session, *, game_id: int, authorization: str | None):
    user = get_current_user(db, authorization)
    if not can_user_use_story_dnd(user):
        # Deliberately a 404, not a 403: the mode should not be discoverable by probing.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    game = get_user_story_game_or_404(db, user.id, game_id)
    if not is_story_dnd_game(game):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return user, game


def _latest_assistant_text(db: Session, game_id: int) -> str:
    message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == int(game_id),
            StoryMessage.role == "assistant",
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    return str(getattr(message, "content", "") or "")


def _recent_turns_transcript(db: Session, game_id: int, *, turns: int = 3) -> str:
    """The last few exchanges, oldest first, as plain "Игрок:/Мастер:" lines.

    The judge used to see only the newest narrator message, which is not enough to tell
    "leaving on the errand I was just given" from "running away" -- the errand was in the
    message before. A few exchanges is the smallest window that makes intent legible.
    """
    limit = max(int(turns), 1) * 2
    rows = db.scalars(
        select(StoryMessage)
        .where(StoryMessage.game_id == int(game_id), StoryMessage.undone_at.is_(None))
        .order_by(StoryMessage.id.desc())
        .limit(limit)
    ).all()
    lines: list[str] = []
    for message in reversed(rows):
        text = " ".join(str(getattr(message, "content", "") or "").split()).strip()
        if not text:
            continue
        speaker = "Игрок" if str(getattr(message, "role", "")) == "user" else "Мастер"
        lines.append(f"{speaker}: {text[:900]}")
    return "\n".join(lines)


def _load_state(db: Session, game) -> dict[str, Any]:
    """Read the state and keep the NPC roster in step with the game's character cards."""
    state = get_game_dnd_state(game)
    try:
        synced = sync_dnd_npcs_from_world_cards(state, list_story_world_cards(db, int(game.id)))
    except Exception:
        logger.exception("Failed to sync D&D NPCs from world cards: game_id=%s", game.id)
        return state
    if synced != state:
        set_game_dnd_state(game, synced)
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Failed to persist synced D&D NPC roster: game_id=%s", game.id)
            return state
        return synced
    return state


def _with_sheet_locks(state: dict[str, Any]) -> dict[str, Any]:
    """Attach the derived "what may still be edited" block to every state the client sees.

    Derived rather than stored: the lock follows from the turn counter and the level, and a
    copy of it in the blob would just be a copy that can go stale.
    """
    enriched = dict(state)
    enriched["locks"] = dnd_sheet_locks(state)
    return enriched


def _persist_state(db: Session, game, state: dict[str, Any]) -> dict[str, Any]:
    normalized = set_game_dnd_state(game, state)
    touch_story_game(game)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to persist D&D state: game_id=%s", game.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось сохранить состояние D&D",
        ) from exc
    return normalized


@router.get("/api/story/games/{game_id}/dnd", response_model=StoryDndStateOut)
def read_story_dnd_state(
    game_id: int,
    include_catalog: bool = True,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    state = _load_state(db, game)
    return StoryDndStateOut(
        game_id=int(game.id),
        state=_with_sheet_locks(state),
        catalog=build_dnd_catalog() if include_catalog else None,
    )


@router.put("/api/story/games/{game_id}/dnd/play-mode", response_model=StoryDndStateOut)
def update_story_dnd_play_mode(
    game_id: int,
    payload: StoryDndPlayModeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_play_mode"):
        state = _load_state(db, game)
        next_play_mode = normalize_dnd_play_mode(payload.play_mode)
        if next_play_mode == STORY_DND_PLAY_MODE_SANDBOX:
            # Sandbox edits the scores directly instead of a point-buy base plus bonuses, so
            # carry the character's *effective* numbers across. Otherwise switching modes
            # would silently strip the racial bonus and every improvement already earned.
            hero = dict(state.get("hero") or {})
            hero["base_abilities"] = dict(hero.get("abilities") or {})
            state["hero"] = hero
        state["play_mode"] = next_play_mode
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.put("/api/story/games/{game_id}/dnd/difficulty", response_model=StoryDndStateOut)
def update_story_dnd_difficulty(
    game_id: int,
    payload: StoryDndDifficultyRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Set how hard the world pushes back. Free, and applies from the next check onward."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_difficulty"):
        state = _load_state(db, game)
        state["difficulty"] = normalize_dnd_difficulty(payload.difficulty)
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.put("/api/story/games/{game_id}/dnd/roll-policy", response_model=StoryDndStateOut)
def update_story_dnd_roll_policy(
    game_id: int,
    payload: StoryDndRollPolicyRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Switch between living roleplay and a rules-lawyer table. Free: it changes no numbers."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_roll_policy"):
        state = _load_state(db, game)
        state["roll_policy"] = normalize_dnd_roll_policy(payload.roll_policy)
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.put("/api/story/games/{game_id}/dnd/hero", response_model=StoryDndStateOut)
def update_story_dnd_hero(
    game_id: int,
    payload: StoryDndHeroUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Save the character sheet.

    In ``game`` play mode the ability scores are re-validated against the 5e point buy and
    the racial bonus is applied server-side, so the client can only ever submit a legal
    array -- the cheat check lives here, not in the UI.
    """
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_hero"):
        state = _load_state(db, game)
        play_mode = normalize_dnd_play_mode(state.get("play_mode"))
        locks = dnd_sheet_locks(state)
        hero = dict(state.get("hero") or {})

        if payload.name is not None:
            hero["name"] = normalize_single_line(payload.name, max_length=80)
        if payload.background is not None:
            hero["background"] = normalize_single_line(payload.background, max_length=80)
        if payload.background_id is not None:
            hero["background_id"] = normalize_dnd_background_id(payload.background_id)

        previous_race_id = normalize_dnd_race_id(hero.get("race"))
        previous_class_id = normalize_dnd_class_id(hero.get("class"))
        race_id = normalize_dnd_race_id(payload.race) if payload.race is not None else previous_race_id
        class_id = (
            normalize_dnd_class_id(payload.character_class)
            if payload.character_class is not None
            else previous_class_id
        )
        # The lock lives here, not in the UI: a character that has already played a turn keeps
        # the race and class it played it with, whatever the client submits.
        if locks.get("identity_locked") and (race_id != previous_race_id or class_id != previous_class_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Раса и класс зафиксированы после первого хода",
            )
        class_changed = class_id != previous_class_id
        hero["race"] = race_id
        hero["class"] = class_id

        base_abilities = dict(hero.get("base_abilities") or {})
        if payload.base_abilities is not None:
            requested_abilities = {
                ability_id: payload.base_abilities.get(ability_id, base_abilities.get(ability_id, 10))
                for ability_id in ABILITY_IDS
            }
            if locks.get("abilities_locked") and requested_abilities != {
                ability_id: int(base_abilities.get(ability_id, 10)) for ability_id in ABILITY_IDS
            }:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Характеристики зафиксированы после первого хода: "
                        "их можно повысить только при получении уровня"
                    ),
                )
            base_abilities = requested_abilities

        # Improvements already earned survive a plain sheet save: only an explicit
        # asi_allocation in the request replaces them.
        asi_allocation = dict(hero.get("asi_allocation") or {})
        if payload.asi_allocation is not None:
            asi_allocation = {}
            for raw_key, raw_value in payload.asi_allocation.items():
                ability_id = normalize_dnd_ability_id(raw_key)
                if not ability_id:
                    continue
                try:
                    asi_allocation[ability_id] = max(int(raw_value), 0)
                except (TypeError, ValueError):
                    continue

        level = normalize_dnd_level(payload.level if payload.level is not None else hero.get("level"))
        if play_mode != STORY_DND_PLAY_MODE_SANDBOX:
            # Strict mode derives the level from experience; a level in the request is ignored.
            level = normalize_dnd_level(hero.get("level"))

        validation = validate_hero_sheet(
            play_mode=play_mode,
            race_id=race_id,
            class_id=class_id,
            base_abilities=base_abilities,
            level=level,
            spent_asi=asi_allocation,
        )
        if not validation.ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=" ".join(validation.errors)[:500] or "Некорректный лист персонажа",
            )

        hero["base_abilities"] = base_abilities
        hero["asi_allocation"] = asi_allocation
        hero["level"] = level
        hero["proficiency_bonus"] = proficiency_bonus(level)
        if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
            hero["abilities"] = {
                ability_id: int(base_abilities.get(ability_id, 10)) for ability_id in ABILITY_IDS
            }
        else:
            # normalize_dnd_hero re-derives these from base + race + ASI on save; computing
            # them here too keeps the response below consistent within this request.
            hero["abilities"] = apply_race_bonuses(base_abilities, race_id, asi_allocation)
            used_asi = sum(max(int(value), 0) for value in asi_allocation.values())
            hero["pending_asi_points"] = max(asi_points_earned_through_level(level) - used_asi, 0)

        if payload.skill_proficiencies is not None:
            requested_skills: list[str] = []
            for item in payload.skill_proficiencies:
                skill_id = normalize_dnd_skill_id(item)
                if skill_id and skill_id not in requested_skills:
                    requested_skills.append(skill_id)
            previous_skills = [
                skill_id
                for skill_id in (
                    normalize_dnd_skill_id(item) for item in (hero.get("skill_proficiencies") or [])
                )
                if skill_id
            ]
            if locks.get("started") and play_mode != STORY_DND_PLAY_MODE_SANDBOX:
                # Once play has started a proficiency is a thing the character *has*. New ones
                # go into slots a level opened; nothing already learned can be traded away.
                dropped = [skill_id for skill_id in previous_skills if skill_id not in requested_skills]
                if dropped:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Уже освоенный навык нельзя убрать — его можно только дополнить новым",
                    )
                allowed = int(locks.get("skill_slots") or DND_MAX_SKILL_PROFICIENCIES)
                if len(requested_skills) > allowed:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Доступно владений навыками: {allowed}. Новые открываются с уровнем.",
                    )
            hero["skill_proficiencies"] = requested_skills[:DND_MAX_SKILL_PROFICIENCIES]
        elif class_changed:
            hero["skill_proficiencies"] = list(DND_CLASS_BY_ID[class_id].skills)[:DND_MAX_SKILL_PROFICIENCIES]
        if class_changed:
            hero["saving_throw_proficiencies"] = list(DND_CLASS_BY_ID[class_id].saving_throws)

        abilities = hero["abilities"]
        computed_max_hp = max_hit_points(class_id, abilities.get("con"), level)
        if play_mode == STORY_DND_PLAY_MODE_SANDBOX and payload.hp_max is not None:
            computed_max_hp = max(1, int(payload.hp_max))
        current_hp = int((hero.get("hp") or {}).get("current") or computed_max_hp)
        if int(state.get("turn_count") or 0) <= 0 and payload.hp_current is None:
            # Still building the character: a sheet change means a new character, not a
            # wounded one, so hit points start full rather than stuck at the old maximum.
            current_hp = computed_max_hp
        if payload.hp_current is not None:
            current_hp = int(payload.hp_current)
        hero["hp"] = {
            "current": max(0, min(computed_max_hp, current_hp)),
            "max": computed_max_hp,
            "temp": max(int((hero.get("hp") or {}).get("temp") or 0), 0),
        }
        hero["armor_class"] = (
            max(1, int(payload.armor_class))
            if (play_mode == STORY_DND_PLAY_MODE_SANDBOX and payload.armor_class is not None)
            else armor_class(class_id, abilities.get("dex"))
        )
        if play_mode == STORY_DND_PLAY_MODE_SANDBOX and payload.speed is not None:
            hero["speed"] = max(0, int(payload.speed))
        if payload.gold is not None:
            hero["gold"] = max(0, int(payload.gold))

        if payload.inventory is not None:
            hero["inventory"] = normalize_dnd_inventory(payload.inventory)
        elif class_changed:
            hero["inventory"] = default_inventory_for(class_id, race_id)
        if payload.inventory_note is not None:
            hero["inventory_note"] = normalize_text_value(payload.inventory_note, max_length=2_000)
        if payload.conditions is not None:
            hero["conditions"] = normalize_dnd_conditions(payload.conditions)
        if payload.avatar_world_card_id is not None:
            hero["avatar_world_card_id"] = int(payload.avatar_world_card_id)

        state["hero"] = hero
        state["setup_completed"] = True
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.post("/api/story/games/{game_id}/dnd/level-up", response_model=StoryDndStateOut)
def apply_story_dnd_level_up(
    game_id: int,
    payload: StoryDndLevelUpRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Spend the ability score improvement points a level-up granted."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_level_up"):
        state = _load_state(db, game)
        hero = dict(state.get("hero") or {})
        available = max(int(hero.get("pending_asi_points") or 0), 0)
        allocation: dict[str, int] = {}
        for raw_key, raw_value in (payload.asi_allocation or {}).items():
            ability_id = normalize_dnd_ability_id(raw_key)
            if not ability_id:
                continue
            try:
                points = max(int(raw_value), 0)
            except (TypeError, ValueError):
                continue
            if points:
                allocation[ability_id] = points
        spent = sum(allocation.values())
        if spent > available:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Доступно очков: {available}, распределено: {spent}",
            )

        abilities = dict(hero.get("abilities") or {})
        merged_allocation = dict(hero.get("asi_allocation") or {})
        for ability_id, points in allocation.items():
            next_score = int(abilities.get(ability_id, 10)) + points
            if next_score > 20:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Характеристика не может превышать 20",
                )
            abilities[ability_id] = next_score
            merged_allocation[ability_id] = int(merged_allocation.get(ability_id, 0)) + points
        hero["abilities"] = abilities
        hero["asi_allocation"] = merged_allocation
        hero["pending_asi_points"] = available - spent

        level = normalize_dnd_level(hero.get("level"))
        new_max_hp = max_hit_points(hero.get("class"), abilities.get("con"), level)
        previous_hp = dict(hero.get("hp") or {})
        previous_max = max(int(previous_hp.get("max") or 1), 1)
        healed = max(0, new_max_hp - previous_max)
        hero["hp"] = {
            "current": min(new_max_hp, max(int(previous_hp.get("current") or 0), 0) + healed),
            "max": new_max_hp,
            "temp": max(int(previous_hp.get("temp") or 0), 0),
        }
        hero["armor_class"] = armor_class(hero.get("class"), abilities.get("dex"))
        state["hero"] = hero
        last_level_up = state.get("last_level_up")
        if isinstance(last_level_up, dict) and hero["pending_asi_points"] <= 0:
            last_level_up["acknowledged"] = True
            state["last_level_up"] = last_level_up
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.put("/api/story/games/{game_id}/dnd/environment", response_model=StoryDndStateOut)
def update_story_dnd_environment(
    game_id: int,
    payload: StoryDndEnvironmentRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Set the starting season/time/weather.

    Editable freely before the first turn; after that only sandbox mode may touch it, because
    in a real game the clock belongs to the story and not to the player.
    """
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_environment"):
        state = _load_state(db, game)
        play_mode = normalize_dnd_play_mode(state.get("play_mode"))
        locked = bool(state.get("turn_count", 0) > 0) and play_mode != STORY_DND_PLAY_MODE_SANDBOX
        if locked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="После первого хода время и погоду можно менять только в режиме песочницы",
            )
        environment = dict(state.get("environment") or {})
        if payload.season is not None:
            environment["season"] = normalize_dnd_season(payload.season)
            environment["season_started_day"] = int(environment.get("day") or 1)
        if payload.time_of_day is not None:
            environment["time_of_day"] = normalize_dnd_time_of_day(payload.time_of_day)
        if payload.day is not None:
            environment["day"] = max(1, int(payload.day))
            environment["season_started_day"] = min(
                int(environment.get("season_started_day") or 1), int(environment["day"])
            )
        if payload.weather is not None:
            environment["weather"] = normalize_dnd_weather(
                payload.weather, season=environment.get("season")
            )
        if payload.weather_note is not None:
            environment["weather_note"] = normalize_single_line(payload.weather_note, max_length=80)
        state["environment"] = normalize_dnd_environment(environment, locked=locked)
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.put("/api/story/games/{game_id}/dnd/npcs/{npc_key}", response_model=StoryDndStateOut)
def update_story_dnd_npc(
    game_id: int,
    npc_key: str,
    payload: StoryDndNpcUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    normalized_key = normalize_single_line(npc_key, max_length=80).casefold()
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_npc"):
        state = _load_state(db, game)
        npcs = [item for item in (state.get("npcs") or []) if isinstance(item, dict)]
        entry = next(
            (
                npc
                for npc in npcs
                if str(npc.get("key") or "").casefold() == normalized_key
                or normalize_single_line(npc.get("name"), max_length=80).casefold() == normalized_key
            ),
            None,
        )
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Персонаж не найден")

        if payload.name is not None:
            entry["name"] = normalize_single_line(payload.name, max_length=80)
        if payload.role is not None:
            entry["role"] = normalize_single_line(payload.role, max_length=80)
        if payload.relation is not None:
            relation_id = normalize_dnd_relation_id(payload.relation)
            entry["relation"] = relation_id
            if payload.relation_score is None:
                from app.services.story_dnd import DND_RELATION_SCORES

                entry["relation_score"] = DND_RELATION_SCORES.get(relation_id, 0)
        if payload.relation_score is not None:
            entry["relation_score"] = clamp_relation_score(payload.relation_score)
            if payload.relation is None:
                entry["relation"] = relation_id_for_score(entry["relation_score"])
        if payload.relation_note is not None:
            entry["relation_note"] = normalize_single_line(payload.relation_note, max_length=140)
        if payload.level is not None:
            entry["level"] = normalize_dnd_level(payload.level)
            entry["stats_source"] = "manual"
        if payload.abilities is not None:
            abilities = dict(entry.get("abilities") or {})
            for raw_key, raw_value in payload.abilities.items():
                ability_id = normalize_dnd_ability_id(raw_key)
                if not ability_id:
                    continue
                try:
                    abilities[ability_id] = max(1, min(30, int(raw_value)))
                except (TypeError, ValueError):
                    continue
            entry["abilities"] = abilities
            entry["stats_source"] = "manual"
        hp = dict(entry.get("hp") or {})
        if payload.hp_max is not None:
            hp["max"] = max(1, int(payload.hp_max))
            entry["stats_source"] = "manual"
        if payload.hp_current is not None:
            hp["current"] = max(0, int(payload.hp_current))
        hp["current"] = max(0, min(int(hp.get("max") or 1), int(hp.get("current") or 0)))
        entry["hp"] = hp
        if payload.armor_class is not None:
            entry["armor_class"] = max(1, min(40, int(payload.armor_class)))
            entry["stats_source"] = "manual"
        if payload.notes is not None:
            entry["notes"] = normalize_text_value(payload.notes, max_length=600)
        if payload.is_active is not None:
            entry["is_active"] = bool(payload.is_active)

        state["npcs"] = npcs
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.post("/api/story/games/{game_id}/dnd/npcs/{npc_key}/ai-stats", response_model=StoryDndNpcStatsOut)
def suggest_story_dnd_npc_stats(
    game_id: int,
    npc_key: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndNpcStatsOut:
    """Ask the service model for a stat block that matches the NPC's own card. Costs 1 sol."""
    user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    normalized_key = normalize_single_line(npc_key, max_length=80).casefold()
    state = _load_state(db, game)
    npcs = [item for item in (state.get("npcs") or []) if isinstance(item, dict)]
    entry = next(
        (
            npc
            for npc in npcs
            if str(npc.get("key") or "").casefold() == normalized_key
            or normalize_single_line(npc.get("name"), max_length=80).casefold() == normalized_key
        ),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Персонаж не найден")

    description = str(entry.get("notes") or "")
    card_id = entry.get("world_card_id")
    if card_id:
        for card in list_story_world_cards(db, int(game.id)):
            if int(getattr(card, "id", 0) or 0) == int(card_id):
                description = "\n".join(
                    part
                    for part in (
                        str(getattr(card, "content", "") or ""),
                        str(getattr(card, "race", "") or ""),
                        str(getattr(card, "health_status", "") or ""),
                    )
                    if part.strip()
                )
                break

    if not spend_user_tokens_if_sufficient(db, user_id=int(user.id), tokens=DND_NPC_STATS_COST_TOKENS):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Недостаточно солов для подбора характеристик",
        )
    db.commit()
    db.refresh(user)

    from app.services.story_dnd_service import suggest_dnd_npc_stats

    try:
        suggestion = suggest_dnd_npc_stats(
            name=str(entry.get("name") or ""),
            description=description,
            role=str(entry.get("role") or ""),
            hero_level=normalize_dnd_level((state.get("hero") or {}).get("level")),
            game_id=int(game.id),
        )
    except Exception as exc:
        logger.warning("D&D NPC stat suggestion failed: game_id=%s error=%s", game.id, exc)
        _refund_service_tokens(db, user=user, tokens=DND_NPC_STATS_COST_TOKENS)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Сервисная модель недоступна, попробуйте ещё раз",
        ) from exc

    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_npc_stats"):
        state = _load_state(db, game)
        npcs = [item for item in (state.get("npcs") or []) if isinstance(item, dict)]
        entry = next(
            (
                npc
                for npc in npcs
                if str(npc.get("key") or "").casefold() == normalized_key
                or normalize_single_line(npc.get("name"), max_length=80).casefold() == normalized_key
            ),
            None,
        )
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Персонаж не найден")
        abilities = dict(entry.get("abilities") or {})
        for ability_id, raw_value in (suggestion.get("abilities") or {}).items():
            normalized_ability = normalize_dnd_ability_id(ability_id)
            if not normalized_ability:
                continue
            abilities[normalized_ability] = max(1, min(30, int(raw_value)))
        entry["abilities"] = abilities
        entry["level"] = normalize_dnd_level(suggestion.get("level") or entry.get("level"))
        suggested_max_hp = max(1, min(9_999, int(suggestion.get("max_hp") or 0) or int((entry.get("hp") or {}).get("max") or 1)))
        entry["hp"] = {"current": suggested_max_hp, "max": suggested_max_hp, "temp": 0}
        if suggestion.get("armor_class"):
            entry["armor_class"] = max(1, min(40, int(suggestion["armor_class"])))
        if suggestion.get("role") and not entry.get("role"):
            entry["role"] = normalize_single_line(suggestion["role"], max_length=80)
        suggested_relation = normalize_dnd_relation_id(suggestion.get("relation")) if suggestion.get("relation") else ""
        if suggested_relation and not entry.get("relation_note"):
            entry["relation"] = suggested_relation
        entry["stats_source"] = "ai"
        state["npcs"] = npcs
        normalized = _persist_state(db, game, state)

    return StoryDndNpcStatsOut(
        state=normalized,
        charged_tokens=DND_NPC_STATS_COST_TOKENS,
        user=UserOut.model_validate(user),
        rationale=normalize_single_line(suggestion.get("rationale"), max_length=200),
    )


@router.post("/api/story/games/{game_id}/dnd/npcs/{npc_key}/meeting-prompt", response_model=StoryDndMeetingPromptOut)
def build_story_dnd_meeting_prompt(
    game_id: int,
    npc_key: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndMeetingPromptOut:
    """Text for the "встретиться" action. Free: the player still pays for the turn itself."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    normalized_key = normalize_single_line(npc_key, max_length=80).casefold()
    state = _load_state(db, game)
    entry = next(
        (
            npc
            for npc in (state.get("npcs") or [])
            if isinstance(npc, dict)
            and (
                str(npc.get("key") or "").casefold() == normalized_key
                or normalize_single_line(npc.get("name"), max_length=80).casefold() == normalized_key
            )
        ),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Персонаж не найден")
    return StoryDndMeetingPromptOut(
        prompt=build_dnd_meeting_prompt(
            npc_name=str(entry.get("name") or ""),
            npc_role=str(entry.get("role") or ""),
            relation_label=DND_RELATION_LABELS.get(normalize_dnd_relation_id(entry.get("relation")), ""),
            npc_notes=str(entry.get("notes") or ""),
        )
    )


def _build_death_save_check(state: dict[str, Any], prompt_text: str) -> dict[str, Any]:
    """A death saving throw, shaped like any other pending check so one dialog serves both."""
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    saves = hero.get("death_saves") if isinstance(hero.get("death_saves"), dict) else {}
    return normalize_dnd_pending_check(
        {
            "id": secrets.token_hex(8),
            # The player's sentence is kept so the narrator still sees what they wanted to do,
            # even though the hero is in no condition to do it.
            "prompt": prompt_text or "Герой лежит без сознания",
            "kind": "death_save",
            "skill": "",
            "ability": "con",
            "die": DND_DEFAULT_DIE,
            "dc": DND_DEATH_SAVE_DC,
            "advantage": "none",
            "situational_modifier": 0,
            "reason": (
                f"Спасбросок от смерти. Успехов {int(saves.get('successes') or 0)}/3, "
                f"провалов {int(saves.get('failures') or 0)}/3."
            ),
            "success_hint": "Ещё один шаг к тому, чтобы выжить.",
            "failure_hint": "Ещё один шаг к смерти.",
            # No ability modifier and no proficiency: a death save is a bare d20 in 5e.
            "modifier_breakdown": [],
        }
    )


@router.post("/api/story/games/{game_id}/dnd/death-save", response_model=StoryDndDeathSaveOut)
def roll_story_dnd_death_save(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndDeathSaveOut:
    """Roll one death saving throw. Server-side and free, like every other die here."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_death_save"):
        state = _load_state(db, game)
        hero = dict(state.get("hero") or {})
        if str(hero.get("life_state") or DND_LIFE_STATE_ALIVE) != "dying":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Спасбросок от смерти сейчас не нужен",
            )
        check = state.get("pending_check")
        if not isinstance(check, dict) or normalize_dnd_check_kind(check.get("kind")) != "death_save":
            check = _build_death_save_check(state, "")
        result = perform_roll(die=DND_DEFAULT_DIE, dc=DND_DEATH_SAVE_DC, advantage="none", modifier_breakdown=[])
        summary = apply_death_save_roll(hero, natural=result.natural, total=result.total)
        state["hero"] = hero
        roll_payload = {
            **result.to_dict(),
            "id": str(check.get("id") or secrets.token_hex(8)),
            "check": check,
            "consumed": False,
            "death_save": True,
            "life_state": summary["life_state"],
        }
        state["last_roll"] = roll_payload
        state["pending_check"] = None
        if summary["life_state"] == DND_LIFE_STATE_DEAD:
            state["combat"] = create_empty_dnd_combat()
        normalized = _persist_state(db, game, state)
    return StoryDndDeathSaveOut(state=_with_sheet_locks(normalized), roll=normalized.get("last_roll") or roll_payload)


@router.post("/api/story/games/{game_id}/dnd/combat/initiative", response_model=StoryDndInitiativeOut)
def roll_story_dnd_initiative(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndInitiativeOut:
    """The player's own initiative die. The rest of the table rolled when the fight opened."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_initiative"):
        state = _load_state(db, game)
        combat = dict(state.get("combat") or {})
        if not combat.get("active"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Бой не идёт")
        participant = combat_hero_participant(combat)
        if participant is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Герой не участвует в бою")
        if participant.get("initiative") is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Инициатива уже брошена")
        hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
        modifier = ability_modifier((hero.get("abilities") or {}).get("dex"))
        result = perform_roll(
            die=DND_DEFAULT_DIE,
            dc=10,
            advantage="none",
            modifier_breakdown=[{"key": "ability:dex", "label": "ЛОВ", "value": modifier}],
        )
        participant["initiative"] = max(-20, min(60, result.total))
        participant["initiative_modifier"] = modifier
        combat["hero_initiative_rolled"] = True
        combat = roll_npc_initiatives(combat)
        combat = start_dnd_combat_if_ready(combat)
        state["combat"] = combat
        normalized = _persist_state(db, game, state)
    return StoryDndInitiativeOut(
        state=_with_sheet_locks(normalized),
        natural=result.natural,
        modifier=modifier,
        total=int(participant["initiative"]),
    )


@router.post("/api/story/games/{game_id}/dnd/combat/advance", response_model=StoryDndStateOut)
def advance_story_dnd_combat(
    game_id: int,
    payload: StoryDndCombatAdvanceRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Hand the initiative to the next combatant. Free: it is arithmetic, not a model call."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_combat_advance"):
        state = _load_state(db, game)
        combat = dict(state.get("combat") or {})
        if not combat.get("active") or combat.get("phase") != DND_COMBAT_PHASE_ACTIVE:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Бой ещё не начался")
        state["combat"] = advance_dnd_combat_turn(combat, steps=int(payload.steps or 1))
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.delete("/api/story/games/{game_id}/dnd/combat", response_model=StoryDndStateOut)
def end_story_dnd_combat(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Call the fight off by hand. The escape hatch for a combat the narrator forgot to close."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_combat_end"):
        state = _load_state(db, game)
        state["combat"] = create_empty_dnd_combat()
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.post("/api/story/games/{game_id}/dnd/check", response_model=StoryDndCheckOut)
def analyze_story_dnd_check(
    game_id: int,
    payload: StoryDndCheckRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndCheckOut:
    """Decide whether the player's action needs a dice roll.

    Called by the client just before it sends the turn. Costs 1 sol only when the service
    model actually runs -- an inert action ("иду дальше") is filtered out locally and free.
    """
    user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    state = _load_state(db, game)
    prompt_text = str(payload.prompt or "").strip()

    # At zero hit points the only roll on the table is the one for the character's life, and
    # it is free: the dice that decide whether a player loses their character are not a
    # billable feature.
    hero_state = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    life_state = str(hero_state.get("life_state") or DND_LIFE_STATE_ALIVE)
    if life_state == "dying":
        death_check = _build_death_save_check(state, prompt_text)
        with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_check"):
            state = _load_state(db, game)
            state["pending_check"] = death_check
            normalized = _persist_state(db, game, state)
        return StoryDndCheckOut(
            needs_check=True,
            check=normalized.get("pending_check"),
            charged_tokens=0,
            user=None,
            state=_with_sheet_locks(normalized),
        )

    if not dnd_action_needs_model_check(prompt_text):
        return StoryDndCheckOut(needs_check=False, check=None, charged_tokens=0, user=None, state=None)

    if not spend_user_tokens_if_sufficient(db, user_id=int(user.id), tokens=DND_CHECK_COST_TOKENS):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Недостаточно солов для проверки действия",
        )
    db.commit()
    db.refresh(user)
    charged_tokens = DND_CHECK_COST_TOKENS

    from app.services.story_dnd_service import analyze_dnd_action_check, build_local_check_fallback

    try:
        analysis = analyze_dnd_action_check(
            state=state,
            player_action=prompt_text,
            scene_tail=_latest_assistant_text(db, int(game.id)),
            location_label=str(getattr(game, "current_location_label", "") or ""),
            recent_turns=_recent_turns_transcript(db, int(game.id), turns=DND_CHECK_RECENT_TURNS),
            game_id=int(game.id),
        )
    except Exception as exc:
        # A provider hiccup must not quietly hand the player whatever they typed. Fall back to
        # the local keyword rules: a plain DC 15 check is worse than a well-judged one and far
        # better than the silent "no roll needed" this used to return.
        logger.warning("D&D check analysis failed, using local fallback: game_id=%s error=%s", game.id, exc)
        analysis = build_local_check_fallback(prompt_text)
        # The player paid for a judged check and got a keyword guess: give the sol back.
        _refund_service_tokens(db, user=user, tokens=DND_CHECK_COST_TOKENS)
        charged_tokens = 0

    if not analysis.get("needs_check"):
        with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_check"):
            state = _load_state(db, game)
            state["pending_check"] = None
            normalized = _persist_state(db, game, state)
        return StoryDndCheckOut(
            needs_check=False,
            check=None,
            charged_tokens=charged_tokens,
            user=UserOut.model_validate(user),
            state=_with_sheet_locks(normalized),
        )

    check = normalize_dnd_pending_check(
        {
            **analysis,
            "id": secrets.token_hex(8),
            "prompt": prompt_text,
            "die": normalize_dnd_die(analysis.get("die")),
        }
    )
    if check is None:
        return StoryDndCheckOut(
            needs_check=False,
            check=None,
            charged_tokens=charged_tokens,
            user=UserOut.model_validate(user),
            state=None,
        )

    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    # An attack's difficulty is the target's armour class and a creature's save DC is the
    # creature's own number -- neither is the model's to invent, so both are re-derived here
    # before the die is ever offered. The table's difficulty dial lands on top.
    resolved_dc, dc_source = resolve_check_dc(state, check)
    check["dc"] = resolved_dc
    check["dc_source"] = dc_source
    check["difficulty_bonus"] = difficulty_hero_bonus(state.get("difficulty"))
    check["modifier_breakdown"] = build_check_modifier_breakdown(hero, check)
    check["advantage"] = resolve_check_advantage(hero, check)

    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_check"):
        state = _load_state(db, game)
        state["pending_check"] = check
        normalized = _persist_state(db, game, state)

    return StoryDndCheckOut(
        needs_check=True,
        check=normalized.get("pending_check"),
        charged_tokens=charged_tokens,
        user=UserOut.model_validate(user),
        state=_with_sheet_locks(normalized),
    )


@router.post("/api/story/games/{game_id}/dnd/roll", response_model=StoryDndRollOut)
def roll_story_dnd_check(
    game_id: int,
    payload: StoryDndRollRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndRollOut:
    """Roll the pending check. Server-side and free -- the dice are not a paid feature."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_roll"):
        state = _load_state(db, game)
        check = state.get("pending_check")
        if not isinstance(check, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет ожидающей проверки")
        requested_id = normalize_single_line(payload.check_id, max_length=40)
        if requested_id and requested_id != str(check.get("id") or ""):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Проверка устарела, повторите ход")

        hero = dict(state.get("hero") or {})
        if normalize_dnd_check_kind(check.get("kind")) == "death_save":
            # One dialog, one button, two very different rolls: the client does not have to
            # know which endpoint to call, because the pending check already says.
            result = perform_roll(
                die=DND_DEFAULT_DIE, dc=DND_DEATH_SAVE_DC, advantage="none", modifier_breakdown=[]
            )
            summary = apply_death_save_roll(hero, natural=result.natural, total=result.total)
            state["hero"] = hero
            roll_payload = {
                **result.to_dict(),
                "id": str(check.get("id") or secrets.token_hex(8)),
                "check": check,
                "consumed": False,
                "death_save": True,
                "life_state": summary["life_state"],
            }
            state["last_roll"] = roll_payload
            state["pending_check"] = None
            if summary["life_state"] == DND_LIFE_STATE_DEAD:
                state["combat"] = create_empty_dnd_combat()
            normalized = _persist_state(db, game, state)
            return StoryDndRollOut(
                roll=normalized.get("last_roll") or roll_payload, state=_with_sheet_locks(normalized)
            )

        breakdown = check.get("modifier_breakdown")
        if not isinstance(breakdown, list) or not breakdown:
            breakdown = build_check_modifier_breakdown(hero, check)
        result = perform_roll(
            die=check.get("die"),
            dc=check.get("dc"),
            advantage=check.get("advantage") or resolve_check_advantage(hero, check),
            modifier_breakdown=breakdown,
            group_targets=[
                str(item) for item in (check.get("group_targets") or []) if str(item or "").strip()
            ],
        )
        roll_payload = {
            **result.to_dict(),
            "id": str(check.get("id") or secrets.token_hex(8)),
            "check": check,
            "consumed": False,
        }
        state["last_roll"] = roll_payload
        state["pending_check"] = None
        normalized = _persist_state(db, game, state)

    return StoryDndRollOut(roll=normalized.get("last_roll") or roll_payload, state=_with_sheet_locks(normalized))


@router.delete("/api/story/games/{game_id}/dnd/check", response_model=StoryDndStateOut)
def discard_story_dnd_check(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Drop a pending check (the player cancelled the turn before rolling)."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_check_discard"):
        state = _load_state(db, game)
        state["pending_check"] = None
        normalized = _persist_state(db, game, state)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=None)


@router.post("/api/story/games/{game_id}/dnd/reset", response_model=StoryDndStateOut)
def reset_story_dnd_state(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryDndStateOut:
    """Start the sheet over. Only the sheet -- the story, memory and cards are untouched."""
    _user, game = _require_dnd_game(db, game_id=game_id, authorization=authorization)
    with _acquire_lease_or_409(game_id=int(game.id), operation="dnd_reset"):
        state = _load_state(db, game)
        fresh = normalize_dnd_state({"play_mode": state.get("play_mode"), "turn_count": state.get("turn_count")})
        # Keep the roster: the NPCs belong to the story, not to the sheet.
        fresh["npcs"] = state.get("npcs") or []
        fresh["quests"] = state.get("quests") or []
        fresh["notes"] = state.get("notes") or []
        normalized = _persist_state(db, game, fresh)
    return StoryDndStateOut(game_id=int(game.id), state=_with_sheet_locks(normalized), catalog=build_dnd_catalog())
