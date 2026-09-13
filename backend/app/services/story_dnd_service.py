"""Service-model modules for D&D mode.

Three bounded JSON calls, all on POLZA_STORY_SERVICE_TEXT_MODEL, all charged one sol per
HTTP request exactly like the existing environment/character/graph modules:

1. :func:`analyze_dnd_action_check` -- before the turn: does the player's action need a dice
   roll, and if so which one and against what DC.
2. :func:`resolve_dnd_turn_upkeep`  -- after the turn: hit points, experience, inventory,
   conditions, quests, master notes, NPC relationships and the passage of time.
3. :func:`suggest_dnd_npc_stats`    -- on demand: a stat block inferred from an NPC card.

Nothing here writes to the database. Each function returns a validated payload and the
callers (`routers/story_dnd`, `services/story_runtime`) decide what to apply, which keeps
every clamp in one place -- :mod:`app.services.story_dnd_apply`.

Prompt size is capped deliberately: these run on every turn, and an unbounded scene tail is
how a one-sol module quietly turns into a five-sol one.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import POLZA_STORY_SERVICE_TEXT_MODEL
from app.services.story_dnd import (
    ABILITY_IDS,
    ABILITY_SHORT_LABELS,
    DND_CONDITION_BY_ID,
    DND_GROUP_MAX_TARGETS,
    DND_MOOD_LABELS,
    DND_RELATION_LABELS,
    DND_SEASON_LABELS,
    DND_SKILL_ABILITY,
    DND_SKILL_LABELS,
    DND_TIME_LABELS,
    DND_WEATHER_LABELS,
    DND_XP_AWARD_BUCKETS,
    STORY_DND_ROLL_POLICY_STRICT,
    ability_modifier,
    describe_combat_for_prompt,
    describe_environment,
    describe_hero_for_prompt,
    get_dnd_currency,
    normalize_dnd_class_id,
    normalize_dnd_race_id,
    normalize_dnd_roll_policy,
)


logger = logging.getLogger(__name__)

DND_CHECK_LLM_MODULE = "dnd_action_check"
DND_UPKEEP_LLM_MODULE = "dnd_turn_upkeep"
DND_NPC_STATS_LLM_MODULE = "dnd_npc_stats"

DND_CHECK_MAX_OUTPUT_TOKENS = 420
DND_UPKEEP_MAX_OUTPUT_TOKENS = 1_800
DND_NPC_STATS_MAX_OUTPUT_TOKENS = 420

# Input caps. The narrator's own context already carries the story; these modules only need
# the tail of it, and paying for more would push a one-sol call past its margin.
DND_SCENE_TAIL_MAX_CHARS = 2_400
# How much of the conversation the judge sees. One message was not enough: "иду к реке"
# right after an NPC hands out an errand reads as fleeing when the errand is invisible.
# A few exchanges tell "leaving on a job" from "running away" without turning a one-sol
# module into a context-sized one.
DND_CHECK_RECENT_TURNS = 3
DND_CHECK_HISTORY_MAX_CHARS = 2_600
DND_PLAYER_ACTION_MAX_CHARS = 1_200
DND_NPC_DESCRIPTION_MAX_CHARS = 1_200

DND_CHECK_REQUEST_TIMEOUT = (8.0, 45.0)
DND_UPKEEP_REQUEST_TIMEOUT = (8.0, 90.0)


# --- Elapsed time ---------------------------------------------------------------------------

# How far one turn may push the clock. The service model picks a label, and these tables turn
# that label into hard bounds -- so a scene the party never left cannot jump to nightfall, and
# a week of travel is allowed to bring a different sky.
DND_ELAPSED_LABELS: dict[str, str] = {
    "none": "сцена не сдвинулась",
    "minutes": "несколько минут",
    "hours": "несколько часов",
    "half_day": "полдня",
    "day": "сутки",
    "days": "несколько дней",
    "weeks": "недели",
}
# (max time-of-day slots forward, min whole days, max whole days)
DND_ELAPSED_BOUNDS: dict[str, tuple[int, int, int]] = {
    "none": (0, 0, 0),
    "minutes": (0, 0, 0),
    "hours": (2, 0, 1),
    "half_day": (4, 0, 1),
    "day": (8, 1, 1),
    "days": (8, 1, 7),
    "weeks": (8, 7, 30),
}
DND_DEFAULT_ELAPSED = "minutes"


def normalize_dnd_elapsed(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_ELAPSED_BOUNDS:
        return normalized
    aliases = {
        "instant": "none",
        "moment": "minutes",
        "minute": "minutes",
        "hour": "hours",
        "halfday": "half_day",
        "evening": "hours",
        "night": "half_day",
        "week": "weeks",
        "month": "weeks",
        "months": "weeks",
    }
    return aliases.get(normalized, DND_DEFAULT_ELAPSED)


# --- Payload schemas --------------------------------------------------------------------------

# The top-level keys each payload is recognised by. A parsed object sharing none of them is
# not that payload -- it is a fragment the JSON recovery scan pulled out of a truncated
# answer, and accepting it would report "nothing changed" for a turn that changed plenty.
_CHECK_PAYLOAD_KEYS = frozenset(
    {"needs_check", "kind", "skill", "ability", "dc", "die", "advantage", "reason", "group_targets"}
)
_UPKEEP_PAYLOAD_KEYS = frozenset(
    {
        "hp",
        "temp_hp",
        "gold",
        "xp_bucket",
        "inventory",
        "conditions",
        "environment",
        "quests",
        "master_notes",
        "npcs",
        "combat",
    }
)


class DndCheckPayload(BaseModel):
    """Whether the player's declared action needs a roll, and which one."""

    model_config = ConfigDict(extra="ignore")

    needs_check: bool = False
    kind: str = "skill"
    skill: str = ""
    ability: str = ""
    die: int = 20
    dc: int = 15
    advantage: str = "none"
    situational_modifier: int = 0
    situational_label: str = ""
    reason: str = ""
    target: str = ""
    success_hint: str = ""
    failure_hint: str = ""
    # Populated only when the player swings at several named foes in one sentence: each name
    # gets its own die, which is what keeps "я убиваю их всех" honest.
    group_targets: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _reject_truncated_fragment(cls, value: Any) -> Any:
        if isinstance(value, dict) and not (set(value) & _CHECK_PAYLOAD_KEYS):
            raise ValueError("check payload is missing every known field (truncated response?)")
        return value

    @field_validator("group_targets", mode="before")
    @classmethod
    def _coerce_targets(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            value = [part for part in re.split(r"[,;]", value) if part.strip()]
        if not isinstance(value, list):
            return []
        result: list[str] = []
        for item in value:
            text = " ".join(str(item or "").split()).strip()[:60]
            if text and text.lower() not in {entry.lower() for entry in result}:
                result.append(text)
        return result[:DND_GROUP_MAX_TARGETS]

    @field_validator("die", mode="before")
    @classmethod
    def _coerce_die(cls, value: Any) -> int:
        text = str(value or "20").strip().lower().lstrip("dд")
        try:
            return int(text)
        except (TypeError, ValueError):
            return 20

    @field_validator("dc", "situational_modifier", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return 0


class DndValueUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    should_update: bool = False
    delta: int = 0
    value: int = 0
    reason: str = ""
    # Money only: {"gp": 3, "cp": -5}. Present so a five-copper bribe costs five coppers
    # rather than being rounded up to the one denomination a flat `delta` could express.
    coins: dict[str, int] = Field(default_factory=dict)

    @field_validator("coins", mode="before")
    @classmethod
    def _coerce_coins(cls, value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, int] = {}
        for key, raw in value.items():
            try:
                result[str(key or "").strip().lower()] = int(round(float(str(raw).strip())))
            except (TypeError, ValueError):
                continue
        return result

    @field_validator("delta", "value", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(round(float(str(value).strip().replace(",", "."))))
        except (TypeError, ValueError):
            return 0


class DndInventoryUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    should_update: bool = False
    added: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)


class DndConditionChange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    note: str = ""


class DndConditionsUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    should_update: bool = False
    added: list[DndConditionChange] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)


class DndEnvironmentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    elapsed: str = DND_DEFAULT_ELAPSED
    time_of_day: str = ""
    weather: str = ""
    weather_note: str = ""
    day_delta: int = 0
    # Set when the *player* narrated the jump ("вечером я пошёл в гильдию", "прошла неделя").
    # The elapsed budget exists to stop a model from teleporting a standing scene to nightfall;
    # it has no business overruling a player who said out loud what time it is.
    player_declared: bool = False

    @field_validator("day_delta", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return 0


class DndQuestChange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = ""
    detail: str = ""


class DndQuestsUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    added: list[DndQuestChange] = Field(default_factory=list)
    completed: list[str] = Field(default_factory=list)
    failed: list[str] = Field(default_factory=list)


class DndNpcUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    world_card_id: int | None = None
    role: str = ""
    is_active: bool = False
    relation_delta: int = 0
    relation_note: str = ""
    hp_delta: int = 0
    level: int | None = None
    # Where this character physically is, in a few words. Without it the narrator loses track
    # of the room: a bodyguard standing behind a chair turns up in the doorway next turn.
    position: str = ""
    # How they feel right now, as opposed to how they feel about the hero in general.
    mood: str = ""
    mood_note: str = ""
    # The label this character was known by before they were named, so "Слуга Алисии" and
    # "Томас" end up as one person instead of two.
    was_called: str = ""

    @field_validator("relation_delta", "hp_delta", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(round(float(str(value).strip().replace(",", "."))))
        except (TypeError, ValueError):
            return 0

    @field_validator("world_card_id", "level", mode="before")
    @classmethod
    def _coerce_optional_int(cls, value: Any) -> int | None:
        text = str(value or "").strip()
        if not text or not text.lstrip("-").isdigit():
            return None
        return int(text)


class DndCombatantUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    side: str = "enemy"
    role: str = ""
    max_hp: int = 0
    armor_class: int = 0
    dex_modifier: int = 0

    @field_validator("max_hp", "armor_class", "dex_modifier", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return 0


class DndCombatUpdate(BaseModel):
    """Whether the scene is a fight. The model decides that; the order is arithmetic."""

    model_config = ConfigDict(extra="ignore")

    started: bool = False
    ended: bool = False
    in_combat: bool = False
    title: str = ""
    participants: list[DndCombatantUpdate] = Field(default_factory=list)
    defeated: list[str] = Field(default_factory=list)
    advance_turns: int = 0

    @field_validator("advance_turns", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return max(0, min(12, int(str(value).strip())))
        except (TypeError, ValueError):
            return 0


class DndUpkeepPayload(BaseModel):
    """Everything the D&D layer learns from one narrator response."""

    model_config = ConfigDict(extra="ignore")

    hp: DndValueUpdate = Field(default_factory=DndValueUpdate)
    temp_hp: DndValueUpdate = Field(default_factory=DndValueUpdate)
    gold: DndValueUpdate = Field(default_factory=DndValueUpdate)
    xp_bucket: str = "none"
    xp_reason: str = ""
    inventory: DndInventoryUpdate = Field(default_factory=DndInventoryUpdate)
    conditions: DndConditionsUpdate = Field(default_factory=DndConditionsUpdate)
    environment: DndEnvironmentUpdate = Field(default_factory=DndEnvironmentUpdate)
    quests: DndQuestsUpdate = Field(default_factory=DndQuestsUpdate)
    master_notes: list[str] = Field(default_factory=list)
    retired_notes: list[str] = Field(default_factory=list)
    npcs: list[DndNpcUpdate] = Field(default_factory=list)
    combat: DndCombatUpdate = Field(default_factory=DndCombatUpdate)

    @model_validator(mode="before")
    @classmethod
    def _reject_truncated_fragment(cls, value: Any) -> Any:
        if isinstance(value, dict) and not (set(value) & _UPKEEP_PAYLOAD_KEYS):
            raise ValueError("upkeep payload is missing every known field (truncated response?)")
        return value

    @field_validator("xp_bucket", mode="before")
    @classmethod
    def _coerce_bucket(cls, value: Any) -> str:
        normalized = str(value or "none").strip().lower()
        return normalized if normalized in DND_XP_AWARD_BUCKETS else "none"


class DndNpcStatsPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level: int = 1
    abilities: dict[str, int] = Field(default_factory=dict)
    max_hp: int = 0
    armor_class: int = 0
    role: str = ""
    relation: str = ""
    rationale: str = ""

    @field_validator("level", "max_hp", "armor_class", mode="before")
    @classmethod
    def _coerce_int(cls, value: Any) -> int:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return 0

    @field_validator("abilities", mode="before")
    @classmethod
    def _coerce_abilities(cls, value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, int] = {}
        for key, raw in value.items():
            normalized_key = str(key or "").strip().lower()[:3]
            if normalized_key not in ABILITY_IDS:
                continue
            try:
                result[normalized_key] = int(str(raw).strip())
            except (TypeError, ValueError):
                continue
        return result


# --- Prompt helpers ----------------------------------------------------------------------------

def _dump_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


def _tail(text: Any, limit: int) -> str:
    normalized = str(text or "").replace("\r\n", "\n").strip()
    if len(normalized) <= limit:
        return normalized
    return "…" + normalized[-limit:]


def _head(text: Any, limit: int) -> str:
    normalized = str(text or "").replace("\r\n", "\n").strip()
    return normalized[:limit]


def _skill_catalog_line() -> str:
    return ", ".join(f"{skill_id} ({label})" for skill_id, label in DND_SKILL_LABELS.items())


def _condition_catalog_line() -> str:
    return ", ".join(f"{item.id} ({item.label})" for item in DND_CONDITION_BY_ID.values())


def _llm_service():
    from app.services.story_generation_provider import _request_polza_story_text
    from app.services.story_llm_modules import LlmModuleService

    def request_text(messages_payload: list[dict[str, str]], **kwargs: Any) -> str:
        # Only the keywords the provider actually declares. LlmModuleService hands this
        # wrapper its whole kwargs bag, and forwarding an unknown one turns every D&D
        # service call into a TypeError before a single HTTP request goes out.
        return _request_polza_story_text(
            messages_payload,
            model_name=str(kwargs.get("model_name") or POLZA_STORY_SERVICE_TEXT_MODEL),
            allow_service_fallback=False,
            translate_input=False,
            fallback_model_names=[],
            temperature=float(kwargs.get("temperature", 0.0)),
            max_tokens=int(kwargs.get("max_tokens", DND_UPKEEP_MAX_OUTPUT_TOKENS)),
            request_timeout=kwargs.get("request_timeout") or DND_UPKEEP_REQUEST_TIMEOUT,
            retry_on_rate_limit=True,
        )

    return LlmModuleService(
        request_text,
        primary_model=POLZA_STORY_SERVICE_TEXT_MODEL,
        fallback_models=[],
        include_configured_fallback=False,
    )


# --- 1. Pre-turn check detection -----------------------------------------------------------------

# Actions that provably need no roll. Every pattern is anchored end to end and allows only a
# single optional direction word, so a sentence that *starts* inert but goes on to something
# real ("иду дальше и взламываю замок") does not match. A false positive here would silently
# remove a roll the player should have made, which is far worse than paying for one call.
_INERT_ACTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"^(?:я\s+)?(?:иду|идём|идем|пойду|пойдём|пойдем|шагаю|двигаюсь|бреду)"
        r"(?:\s+(?:дальше|вперёд|вперед|туда|сюда|обратно|назад|домой))?\s*[.!…]*$",
        re.IGNORECASE,
    ),
    re.compile(r"^(?:я\s+)?продолжаю\s+путь\s*[.!…]*$", re.IGNORECASE),
    re.compile(r"^(?:я\s+)?смотрю\s+по\s+сторонам\s*[.!…]*$", re.IGNORECASE),
    re.compile(
        r"^(?:я\s+)?(?:осматриваюсь|оглядываюсь|жду|отдыхаю|молчу|киваю|сажусь|встаю)"
        r"(?:\s+(?:вокруг|немного|тут|здесь))?\s*[.!…]*$",
        re.IGNORECASE,
    ),
    re.compile(r"^(?:продолжить|дальше|далее|ок|окей|ладно|да|нет|угу)\s*[.!…]*$", re.IGNORECASE),
)
_CHECK_MIN_ACTION_LENGTH = 8


def dnd_action_needs_model_check(player_action: Any) -> bool:
    """Cheap local gate, so an inert turn never pays for the check module.

    Only rejects text that cannot contain an attempt. Anything with real content still goes
    to the model, because guessing "no check needed" from keywords is exactly how a stealth
    attempt ends up resolved without a roll.
    """
    normalized = " ".join(str(player_action or "").split()).strip()
    if len(normalized) < _CHECK_MIN_ACTION_LENGTH:
        return False
    for pattern in _INERT_ACTION_PATTERNS:
        if pattern.match(normalized):
            return False
    return True


# Keyword -> skill, used only when the service model could not answer. It is deliberately
# conservative about DC (a flat 15, the 5e "medium" rung) and deliberately generous about
# firing: a missed roll is the failure the player actually notices, and paying for a roll that
# was not strictly needed costs nobody anything.
_FALLBACK_CHECK_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("sleight_of_hand", "attack_no", re.compile(r"\b(?:красть|кра(?:ду|л|сть)|воров|обворов|обокра|стащ|стянуть|спер|карман|подмен|подлож|подсун|вытащ(?:ить|ил)\s+(?:кошел|кинжал|ключ))", re.IGNORECASE)),
    ("stealth", "attack_no", re.compile(r"\b(?:крад(?:усь|ётся|ется)|прячусь|спрят|незамет|тихонько|бесшумно|скрытн|подкра|слеж|проследить|затаи)", re.IGNORECASE)),
    ("persuasion", "attack_no", re.compile(r"\b(?:убеж(?:даю|дать|дить)|уговар|уговор|упрош|умоля|торгу|договор|склон(?:яю|ить))", re.IGNORECASE)),
    ("deception", "attack_no", re.compile(r"\b(?:вру|лгу|солга|обман(?:ываю|уть)|притвор|выдаю\s+себя|блеф)", re.IGNORECASE)),
    ("intimidation", "attack_no", re.compile(r"\b(?:запуг|угрож|пригроз|припугн|давлю\s+на)", re.IGNORECASE)),
    ("investigation", "attack_no", re.compile(r"\b(?:обыск|ищу\s+(?:тайник|улик|след)|исслед|взлам|вскры(?:ваю|ть)\s+(?:замок|дверь|сундук)|отмыч)", re.IGNORECASE)),
    ("perception", "attack_no", re.compile(r"\b(?:прислушив|высматрив|ищу\s+взглядом|замеча|приглядыв|осматриваю\s+внимательно)", re.IGNORECASE)),
    ("athletics", "attack_no", re.compile(r"\b(?:взбира|караб|лезу\s+(?:на|вверх)|перепрыг|подтягив|выламыв|толкаю\s+изо\s+всех)", re.IGNORECASE)),
    ("acrobatics", "attack_no", re.compile(r"\b(?:кувыр|переворот|балансир|уворач|увернуть|проскольз|пролез)", re.IGNORECASE)),
    ("medicine", "attack_no", re.compile(r"\b(?:перевяз|лечу|исцел|останов(?:ить|ить)\s+кровь|откач)", re.IGNORECASE)),
    ("arcana", "attack_no", re.compile(r"\b(?:колду|заклин|плету\s+закл|развеять\s+маг|читаю\s+руны)", re.IGNORECASE)),
    ("", "attack_yes", re.compile(r"\b(?:атак|бью|ударяю|руб(?:лю|ить)|коло|стреля|мечу|напада|убива|зарез|душу|пронза|замахив|вонза)", re.IGNORECASE)),
)
_FALLBACK_DC = 15
_FALLBACK_GROUP_PATTERN = re.compile(
    r"\b(?:всех|обоих|обеих|каждого|всю\s+(?:группу|банду|стражу)|троих|четверых|пятерых|остальных)\b",
    re.IGNORECASE,
)


def build_local_check_fallback(player_action: Any) -> dict[str, Any]:
    """A deterministic check for when the service model is unreachable.

    Without this, a provider hiccup silently deletes the roll and the player quietly gets
    whatever they typed -- exactly the failure this mode exists to prevent. Returning a plain
    DC 15 check is worse than a well-judged one and far better than none.
    """
    text = " ".join(str(player_action or "").split())
    if not dnd_action_needs_model_check(text):
        return {"needs_check": False}
    for skill_id, mode, pattern in _FALLBACK_CHECK_PATTERNS:
        if not pattern.search(text):
            continue
        is_attack = mode == "attack_yes"
        return {
            "needs_check": True,
            "kind": "attack" if is_attack else "skill",
            "skill": "" if is_attack else skill_id,
            "ability": "str" if is_attack else DND_SKILL_ABILITY.get(skill_id, ""),
            "die": 20,
            "dc": _FALLBACK_DC,
            "advantage": "none",
            "situational_modifier": 0,
            "situational_label": "",
            "reason": "Сервисная модель недоступна — проверка по правилам по умолчанию.",
            "target": "",
            "success_hint": "",
            "failure_hint": "",
            "group_targets": (
                ["Первый противник", "Второй противник", "Третий противник"]
                if is_attack and _FALLBACK_GROUP_PATTERN.search(text)
                else []
            ),
        }
    return {"needs_check": False}


def _describe_active_npcs_for_check(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Who is in the scene, and what kind of person they are.

    Difficulty for a social action is mostly a fact about the other person: a warm innkeeper
    who already likes the hero is not the same DC as a cold archmage who caught them stealing.
    Without the character notes the judge was pricing every conversation the same.
    """
    result: list[dict[str, Any]] = []
    for npc in (state.get("npcs") if isinstance(state.get("npcs"), list) else []):
        if not isinstance(npc, dict) or not npc.get("is_active"):
            continue
        result.append(
            {
                "name": npc.get("name"),
                "role": npc.get("role"),
                "level": npc.get("level"),
                "relation": npc.get("relation"),
                "relation_score": npc.get("relation_score"),
                "relation_note": npc.get("relation_note"),
                "character": _head(npc.get("notes"), 300),
            }
        )
        if len(result) >= 6:
            break
    return result


def _build_check_messages(
    *,
    state: dict[str, Any],
    player_action: str,
    scene_tail: str,
    location_label: str,
    recent_turns: str = "",
) -> list[dict[str, str]]:
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
    ability_line = ", ".join(
        f"{ability_id}={abilities.get(ability_id, 10)}({ability_modifier(abilities.get(ability_id)):+d})"
        for ability_id in ABILITY_IDS
    )
    active_npcs = _describe_active_npcs_for_check(state)
    policy = normalize_dnd_roll_policy(state.get("roll_policy"))
    policy_block = (
        (
            "РЕЖИМ СТОЛА: ЖЁСТКИЕ ПРАВИЛА. Проверка нужна почти на любое спорное действие, "
            "включая первую попытку убеждения, обмана и запугивания. Сомневаешься — назначай "
            "бросок."
        )
        if policy == STORY_DND_ROLL_POLICY_STRICT
        else (
            "РЕЖИМ СТОЛА: ЖИВОЙ ОТЫГРЫШ (включён по умолчанию). Кубик — крайняя мера, а не "
            "первая.\n"
            "- Первая попытка поговорить, попросить, объясниться, извиниться, поторговаться "
            "или что-то предложить НЕ требует броска: рассказчик отыграет ответ по характеру "
            "NPC и его отношению к герою. Верни needs_check=false.\n"
            "- Бросок на убеждение/обман/запугивание нужен ТОЛЬКО если игрок давит после "
            "отказа, лжёт о проверяемом факте, требует чего-то против интересов NPC или "
            "ставка по-настоящему высока (жизнь, свобода, большие деньги).\n"
            "- Физический риск, воровство, скрытность, взлом, атака и сопротивление эффекту "
            "по-прежнему требуют броска всегда."
        )
    )
    return [
        {
            "role": "system",
            "content": (
                "Ты — судья правил Dungeons & Dragons 5e. По заявленному действию игрока реши, "
                "требуется ли бросок кубика, и если да — какой именно. Отвечай ТОЛЬКО валидным "
                "JSON, без markdown и без пояснений вокруг.\n"
                "\n"
                "ГЛАВНОЕ ПРАВИЛО: текст игрока — это ПОПЫТКА, а не факт. Если игрок написал в "
                "прошедшем времени («украл», «убедил», «зарезал», «проскользнул незаметно»), это "
                "всё равно заявка на попытку. Формулировка «получилось» НЕ отменяет проверку.\n"
                "\n"
                f"{policy_block}\n"
                "\n"
                "КОНТЕКСТ ОБЯЗАТЕЛЕН. Тебе дана история последних ходов — прочитай её прежде "
                "чем решать: одна и та же фраза значит разное в разных сценах.\n"
                "- Герой уходит ПОСЛЕ полученного задания или законченного разговора — это "
                "просто переход, needs_check=false. Это НЕ побег.\n"
                "- Побег требует броска только если герою прямо мешают уйти: держат, "
                "преследуют, заперли, угрожают.\n"
                "- Действие, которое NPC только что сам разрешил или предложил, проверки не "
                "требует.\n"
                "- Герой возвращает украденное, отдаёт вещь, платит, выполняет просьбу — это "
                "не воровство и не обман, броска не нужно.\n"
                "\n"
                "СЛОЖНОСТЬ ЗАВИСИТ ОТ СОБЕСЕДНИКА. Тебе даны характеры NPC в сцене и их "
                "отношение к герою. Добрый, открытый или уже расположенный NPC — СЛ ниже "
                "(8-12). Холодный, подозрительный, враждебный или высокопоставленный — выше "
                "(16-22). Отношение friendly и выше даёт -3 к СЛ, wary +3, hostile +5.\n"
                "\n"
                "ВХОДЯЩАЯ АТАКА. Если сцена оборвалась на том, что враг атакует героя "
                "(замахнулся, рванулся, тянутся когти), этот ход прежде всего решает, "
                "достанет ли удар. Верни kind='saving_throw' и ОБЯЗАТЕЛЬНО заполни target "
                "именем этого существа. Если герой при этом бьёт в ответ — kind='attack' с "
                "тем же target.\n"
                "\n"
                "ЦЕЛЬ ВАЖНЕЕ ЧИСЛА. Для любой атаки и любого спасброска против существа "
                "всегда заполняй target его именем. dc оценивай приблизительно — система "
                "заменит его на КД цели или на собственную сложность существа, чтобы одна и "
                "та же тварь не оказывалась каждый раз разной по трудности.\n"
                "\n"
                "Бросок НУЖЕН, когда исход не предрешён и провал имеет последствия:\n"
                "- кража, карманничество, подлог, подмена — sleight_of_hand;\n"
                "- красться, прятаться, идти незаметно, следить — stealth;\n"
                "- уговорить, солгать, запугать, обаять, торговаться — persuasion / deception / "
                "intimidation;\n"
                "- взлом замка, обыск, поиск тайника, чтение следов — investigation / perception;\n"
                "- прыжок, лазание, бег по крышам, удержать равновесие — athletics / acrobatics;\n"
                "- любая атака, угроза оружием, попытка обезоружить — kind 'attack';\n"
                "- сопротивление яду, страху, магии, падению — kind 'saving_throw';\n"
                "- вспомнить факт, опознать герб, разобрать руны — history / arcana / religion / "
                "nature;\n"
                "- перевязать, откачать, успокоить животное — medicine / animal_handling.\n"
                "Если действие затрагивает другого персонажа против его воли — бросок нужен "
                "практически всегда.\n"
                "\n"
                "Бросок НЕ нужен для: перемещения и ухода из сцены, осмотра без поиска "
                "скрытого, обычного разговора и вопросов, бытовых действий (сесть, поесть, "
                "достать свою вещь, передать предмет), выполнения чужой просьбы и того, что "
                "герой заведомо умеет и никто ему не мешает. Лишний бросок раздражает игрока "
                "сильнее пропущенного: сомневаешься в бытовой сцене — значит не нужен.\n"
                "\n"
                "Сложность (dc) по шкале 5e: 5 очень легко, 10 легко, 15 средне, 20 сложно, "
                "25 очень сложно, 30 почти невозможно. Учитывай цель: обокрасть пьяного "
                "крестьянина — 10, обокрасть внимательного стражника — 15, обокрасть архимага "
                "или мастера гильдии — 20-25.\n"
                "advantage: 'advantage' если обстоятельства явно помогают, 'disadvantage' если "
                "явно мешают, иначе 'none'. situational_modifier только -5..5 и только при "
                "конкретной причине.\n"
                "die почти всегда 20. Другой кубик (4, 6, 8, 10, 12) — только для мелкого "
                "случайного исхода без проверки характеристики.\n"
                "\n"
                "group_targets: если игрок одной заявкой атакует или обезвреживает НЕСКОЛЬКИХ "
                "противников («убиваю всех», «вырубаю обоих стражников»), перечисли их по "
                f"именам или описаниям, максимум {DND_GROUP_MAX_TARGETS}. Тогда бросок пройдёт "
                "по каждому отдельно. Для одной цели оставь список пустым.\n"
                "\n"
                f"Допустимые skill: {_skill_catalog_line()}.\n"
                "Допустимые ability: str, dex, con, int, wis, cha. "
                "kind: skill | ability | saving_throw | attack."
            ),
        },
        {
            "role": "user",
            "content": (
                f"ГЕРОЙ: уровень {hero.get('level')}, {normalize_dnd_race_id(hero.get('race'))} "
                f"{normalize_dnd_class_id(hero.get('class'))}, характеристики {ability_line}, "
                f"владение навыками {_dump_json(hero.get('skill_proficiencies') or [])}, "
                f"состояния {_dump_json([item.get('id') for item in (hero.get('conditions') or []) if isinstance(item, dict)])}.\n"
                f"МЕСТО: {location_label or 'неизвестно'}\n"
                f"ОБСТАНОВКА: {describe_environment(state)}\n"
                f"NPC В СЦЕНЕ (их характер решает сложность): {_dump_json(active_npcs)}\n"
                + (f"БОЙ ИДЁТ:\n{describe_combat_for_prompt(state)}\n" if describe_combat_for_prompt(state) else "")
                + "\n"
                f"ИСТОРИЯ ПОСЛЕДНИХ ХОДОВ (читай, чтобы понять смысл действия):\n"
                f"{recent_turns or 'нет'}\n\n"
                f"ПРЕДЫДУЩАЯ СЦЕНА:\n{scene_tail or 'нет'}\n\n"
                f"ДЕЙСТВИЕ ИГРОКА:\n{player_action}\n\n"
                "Верни JSON строго такого вида:\n"
                '{"needs_check": true, "kind": "skill", "skill": "stealth", "ability": "dex", '
                '"die": 20, "dc": 15, "advantage": "none", "situational_modifier": 0, '
                '"situational_label": "", "reason": "Короткое пояснение для игрока", '
                '"target": "Кого или что затрагивает", "success_hint": "Что произойдёт при успехе", '
                '"failure_hint": "Что произойдёт при провале", "group_targets": []}\n'
                "Если бросок не нужен — верни {\"needs_check\": false} и пустые остальные поля."
            ),
        },
    ]


def analyze_dnd_action_check(
    *,
    state: dict[str, Any],
    player_action: str,
    scene_tail: str = "",
    location_label: str = "",
    recent_turns: str = "",
    game_id: int | None = None,
) -> dict[str, Any]:
    """One service request. Raises on transport failure; callers treat that as "no check"."""
    messages = _build_check_messages(
        state=state,
        player_action=_head(player_action, DND_PLAYER_ACTION_MAX_CHARS),
        scene_tail=_tail(scene_tail, DND_SCENE_TAIL_MAX_CHARS),
        location_label=str(location_label or "").strip()[:160],
        recent_turns=_tail(recent_turns, DND_CHECK_HISTORY_MAX_CHARS),
    )
    payload, _meta = _llm_service().call_json(
        messages=messages,
        schema=DndCheckPayload,
        module=DND_CHECK_LLM_MODULE,
        game_id=game_id,
        max_tokens=DND_CHECK_MAX_OUTPUT_TOKENS,
        temperature=0.0,
        max_attempts=1,
        request_timeout=DND_CHECK_REQUEST_TIMEOUT,
        translate_input=False,
    )
    return payload.model_dump(mode="json")


# --- 2. Post-turn upkeep --------------------------------------------------------------------------

def _build_upkeep_messages(
    *,
    state: dict[str, Any],
    player_action: str,
    narrator_text: str,
    roll_summary: str,
    location_label: str,
    existing_npc_cards: list[dict[str, Any]],
) -> list[dict[str, str]]:
    environment = state.get("environment") if isinstance(state.get("environment"), dict) else {}
    money = get_dnd_currency(state.get("currency"))
    money_line = ", ".join(
        f"{denomination.id} — {denomination.label} ({denomination.short})"
        for denomination in money.denominations
    )
    money_main = money.main.label
    mood_line = ", ".join(f"{mood_id} ({label.lower()})" for mood_id, label in DND_MOOD_LABELS.items())
    known_npcs = [
        {
            "name": npc.get("name"),
            "aliases": npc.get("aliases"),
            "world_card_id": npc.get("world_card_id"),
            "relation": npc.get("relation"),
            "relation_score": npc.get("relation_score"),
            "mood": npc.get("mood"),
            "position": npc.get("position"),
            "hp": npc.get("hp"),
            "level": npc.get("level"),
        }
        for npc in (state.get("npcs") if isinstance(state.get("npcs"), list) else [])
        if isinstance(npc, dict)
    ][:20]
    quests = [
        {"title": quest.get("title"), "status": quest.get("status")}
        for quest in (state.get("quests") if isinstance(state.get("quests"), list) else [])
        if isinstance(quest, dict)
    ]
    hero_for_conditions = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    current_conditions = [
        {"id": item.get("id"), "label": item.get("label"), "note": item.get("note")}
        for item in (hero_for_conditions.get("conditions") or [])
        if isinstance(item, dict)
    ]
    return [
        {
            "role": "system",
            "content": (
                "Ты — механический учётчик партии Dungeons & Dragons 5e. По тексту хода определи, "
                "что фактически изменилось в состоянии героя, спутников и мира. Отвечай ТОЛЬКО "
                "валидным JSON, без markdown. Ничего не выдумывай: опирайся строго на описанные "
                "события. Если событие не описано — не отмечай его.\n"
                "\n"
                "- hp.delta: отрицательное при уроне, положительное при лечении, 0 если хиты не "
                "менялись. Оценивай урон по здравому смыслу 5e (удар кинжалом 2-6, меч 5-10, "
                "падение с высоты 5-20, смертельная ловушка 15-40). should_update=true только "
                "когда урон или лечение действительно описаны.\n"
                "- gold: деньги героя. Заполняй gold.coins монетами ТОГО номинала, который "
                f"назван в тексте. Доступные номиналы: {money_line}. «Отдаёшь пять медяков» — "
                "это coins с -5 по мелкой монете, «получил двадцать золотых» — +20 по крупной. "
                "Система сама разменяет крупные монеты, поэтому НЕ округляй мелкую трату до "
                f"крупной. Если номинал не назван — считай, что речь о «{money_main}», и "
                "заполни gold.delta числом этих монет. Деньги НЕ являются предметом инвентаря "
                "— никогда не пиши их в inventory.\n"
                "- xp_bucket: none (ничего значимого), minor (мелкое препятствие, полезная "
                "находка), notable (реальный бой, трудная проверка, сцена разрешена), major "
                "(опасная схватка или важная цель), milestone (завершён квест, побеждён босс, "
                "закрыта глава). Большинство ходов — none или minor.\n"
                "- inventory.added / removed: только предметы, явно полученные или потраченные. "
                "Деньги сюда не пиши.\n"
                f"- conditions: только из списка {_condition_catalog_line()}.\n"
                "  СНИМАТЬ состояния так же важно, как вешать. Тебе дан список текущих "
                "состояний героя. Если по тексту хода состояние больше не действует — впиши "
                "его id в conditions.removed и поставь should_update=true. Отпустили из "
                "захвата — сними grappled и restrained. Встал — prone. Пришёл в себя, "
                "успокоился, вылечился, вышел из боя — сними соответствующее. Не оставляй "
                "висеть то, чего в сцене уже нет.\n"
                "- environment.elapsed: сколько игрового времени заняла сцена — "
                f"{', '.join(f'{key} ({label})' for key, label in DND_ELAPSED_LABELS.items())}. "
                "Если герой просто поговорил или прошёл десяток шагов — 'minutes' или 'none'. "
                "Время суток и погоду меняй только когда это действительно следует из текста; "
                "сезон не указывай — его считает система по календарю.\n"
                "  ЕСЛИ ВРЕМЯ НАЗВАЛ САМ ИГРОК в своём ходе («вечером я пошёл», «прошла "
                "неделя», «ночью мы приехали», «на следующее утро») — поставь "
                "player_declared=true, укажи нужное time_of_day и, если прошли сутки и больше, "
                "day_delta. Игрок вправе перескочить время, и система обязана это принять. "
                "elapsed выбирай по названному сроку: с утра до вечера — 'half_day', сутки — "
                "'day', неделя — 'weeks'.\n"
                "\n"
                "- quests.added: ОБЯЗАТЕЛЬНО добавляй задание каждый раз, когда герою дали "
                "поручение, задачу, цель или он взял на себя обязательство — даже если слово "
                "«задание» не прозвучало. «Отнеси кристалл Рябому в портовые склады», «найди "
                "пропавшую дочь», «приходи на рассвет к воротам» — это всё задания. title — "
                "короткая формулировка цели, detail — кто дал и что конкретно нужно сделать. "
                "quests.completed / failed — по названию уже существующего задания.\n"
                "\n"
                "- master_notes: короткие факты, которые мастеру важно помнить в следующих ходах "
                "и которые нельзя восстановить из листа персонажа: данные обещания, названные "
                "имена и места, раскрытые тайны, угрозы в адрес героя, долги, репутация. "
                "Пиши 1-3 заметки за ход, когда такое произошло; пустой список, когда ничего "
                "нового не открылось. Не пересказывай сцену — только факт.\n"
                "- retired_notes: заметки из списка ТЕКУЩИЕ ЗАМЕТКИ, которые перестали быть "
                "правдой или потеряли смысл — обещание выполнено, угроза снята, персонаж ушёл "
                "из истории, тайна раскрыта. Перечисли их текст или узнаваемую часть. Мусор в "
                "памяти мастера вреднее, чем его отсутствие.\n"
                "\n"
                "- npcs: по одному объекту на каждого важного именованного NPC, участвовавшего в "
                "сцене. is_active=true СТРОГО если он физически находится рядом с героем в "
                "конце этого хода. Герой ушёл, уехал, вошёл в другое помещение, попрощался — "
                "значит оставшиеся позади НЕ активны (is_active=false). Упоминание в мыслях, "
                "воспоминание или голос издалека активностью не считаются. relation_delta "
                "от -18 до 18 — насколько изменилось отношение К ГЕРОЮ за этот ход. Меняй его "
                "ВСЕГДА, когда герой сделал что-то значимое для этого NPC: помог (+3..+10), спас "
                "(+10..+18), сделал подарок (+2..+6), солгал и был пойман (-4..-10), попытался "
                "обокрасть или ударить (-8..-18), оскорбил (-3..-8), выполнил поручение "
                "(+6..+14). 0 ставь только когда между ними правда ничего не произошло. "
                "relation_note — одна фраза почему. Безымянную массовку не включай.\n"
                "  position — где персонаж физически находится в конце хода, несколько слов: "
                "«за спиной госпожи», «в дверях», «за столиком напротив». Заполняй для каждого "
                "активного NPC: без этого рассказчик теряет расстановку и переставляет людей "
                "по комнате сам.\n"
                f"  mood — что персонаж чувствует ПРЯМО СЕЙЧАС, отдельно от общего отношения: "
                f"{mood_line}. Отношение меняется медленно, настроение — за одну сцену. "
                "Влюблённый может злиться, враг — быть благодарным. mood_note — одна фраза "
                "почему.\n"
                "  was_called — ОБЯЗАТЕЛЬНО, если персонаж раньше обозначался безлико, а в "
                "этом ходу получил имя: укажи прежнее обозначение («Слуга Алисии», "
                "«незнакомец»). Это единственный способ не завести на одного человека две "
                "карточки.\n"
                "\n"
                "- combat: сцена перешла в бой? started=true в тот ход, когда бой НАЧАЛСЯ "
                "(обнажили оружие, напали, засада). in_combat=true, пока бой идёт. ended=true, "
                "когда бой закончился (все противники повержены, бегство, перемирие). "
                "Пиши кратко: detail, reason и заметки — одно предложение, без пересказа сцены.\n"
                "participants — все, кто дерётся, включая героя: side 'hero' для героя, 'ally' "
                "для его союзников, 'enemy' для противников; max_hp и armor_class оцени по "
                "описанию (обычный бандит 11 хитов КД 12, ветеран 58 хитов КД 17, дракон 200+); "
                "dex_modifier от -3 до 5 для инициативы. defeated — имена тех, кто в этом ходе "
                "выбыл. advance_turns — сколько ходов инициативы прошло за этот ответ "
                "рассказчика (обычно 1-2)."
            ),
        },
        {
            "role": "user",
            "content": (
                f"ЛИСТ ПЕРСОНАЖА:\n{describe_hero_for_prompt(state)}\n\n"
                f"ТЕКУЩИЕ СОСТОЯНИЯ ГЕРОЯ (сними те, что уже не действуют): "
                f"{_dump_json(current_conditions)}\n"
                f"ТЕКУЩЕЕ ВРЕМЯ И ПОГОДА: {describe_environment(state)} "
                f"(season={environment.get('season')}, time_of_day={environment.get('time_of_day')}, "
                f"weather={environment.get('weather')}, day={environment.get('day')})\n"
                f"МЕСТО: {location_label or 'неизвестно'}\n"
                + (f"ТЕКУЩИЙ БОЙ:\n{describe_combat_for_prompt(state)}\n" if describe_combat_for_prompt(state) else "")
                + f"ИЗВЕСТНЫЕ NPC: {_dump_json(known_npcs)}\n"
                f"КАРТОЧКИ ПЕРСОНАЖЕЙ ИГРЫ: {_dump_json(existing_npc_cards[:20])}\n"
                f"АКТИВНЫЕ ЗАДАНИЯ: {_dump_json(quests)}\n\n"
                f"РЕЗУЛЬТАТ БРОСКА В ЭТОМ ХОДЕ: {roll_summary or 'броска не было'}\n\n"
                f"ДЕЙСТВИЕ ИГРОКА:\n{player_action or 'нет'}\n\n"
                f"ОТВЕТ РАССКАЗЧИКА:\n{narrator_text or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                '{"hp": {"should_update": false, "delta": 0, "reason": ""}, '
                '"temp_hp": {"should_update": false, "value": 0}, '
                '"gold": {"should_update": false, "delta": 0, "coins": {}}, '
                '"xp_bucket": "none", "xp_reason": "", '
                '"inventory": {"should_update": false, "added": [], "removed": []}, '
                '"conditions": {"should_update": false, "added": [{"id": "poisoned", "note": ""}], "removed": []}, '
                '"environment": {"elapsed": "minutes", "time_of_day": "", "weather": "", '
                '"weather_note": "", "day_delta": 0, "player_declared": false}, '
                '"quests": {"added": [{"title": "", "detail": ""}], "completed": [], "failed": []}, '
                '"master_notes": ["Короткий важный факт для мастера"], "retired_notes": [], '
                '"npcs": [{"name": "Имя", "world_card_id": null, "role": "кто он", "is_active": true, '
                '"relation_delta": 0, "relation_note": "", "hp_delta": 0, "level": null, '
                '"position": "где стоит", "mood": "calm", "mood_note": "", "was_called": ""}], '
                '"combat": {"started": false, "in_combat": false, "ended": false, "title": "", '
                '"participants": [{"name": "Имя", "side": "enemy", "role": "", "max_hp": 11, '
                '"armor_class": 12, "dex_modifier": 1}], "defeated": [], "advance_turns": 0}}'
            ),
        },
    ]


def resolve_dnd_turn_upkeep(
    *,
    state: dict[str, Any],
    player_action: str,
    narrator_text: str,
    roll_summary: str = "",
    location_label: str = "",
    existing_npc_cards: list[dict[str, Any]] | None = None,
    game_id: int | None = None,
) -> dict[str, Any]:
    messages = _build_upkeep_messages(
        state=state,
        player_action=_head(player_action, DND_PLAYER_ACTION_MAX_CHARS),
        narrator_text=_tail(narrator_text, DND_SCENE_TAIL_MAX_CHARS),
        roll_summary=_head(roll_summary, 600),
        location_label=str(location_label or "").strip()[:160],
        existing_npc_cards=existing_npc_cards or [],
    )
    payload, _meta = _llm_service().call_json(
        messages=messages,
        schema=DndUpkeepPayload,
        module=DND_UPKEEP_LLM_MODULE,
        game_id=game_id,
        max_tokens=DND_UPKEEP_MAX_OUTPUT_TOKENS,
        temperature=0.0,
        max_attempts=1,
        request_timeout=DND_UPKEEP_REQUEST_TIMEOUT,
        translate_input=False,
    )
    return payload.model_dump(mode="json")


# --- 3. NPC stat block ----------------------------------------------------------------------------

def _build_npc_stats_messages(
    *,
    name: str,
    description: str,
    role: str,
    hero_level: int,
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты — Мастер Dungeons & Dragons 5e. По описанию NPC подбери правдоподобный "
                "статблок. Отвечай ТОЛЬКО валидным JSON.\n"
                "Правила: обычный горожанин — уровень 1, характеристики 8-12, хиты 4-9, КД 10-12. "
                "Опытный воин или капитан стражи — уровень 4-7, ключевая характеристика 15-17. "
                "Легендарная фигура (архимаг, глава гильдии, генерал) — уровень 12-20, ключевая "
                "характеристика 18-20, хиты 90-250. Характеристики в диапазоне 3-25, они должны "
                "отражать именно описание: силача не делай хилым, мудреца — глупым.\n"
                f"Допустимые отношения к герою: {', '.join(f'{key} ({label})' for key, label in DND_RELATION_LABELS.items())}."
            ),
        },
        {
            "role": "user",
            "content": (
                f"УРОВЕНЬ ГЕРОЯ ИГРОКА: {hero_level}\n"
                f"ИМЯ NPC: {name}\n"
                f"РОЛЬ: {role or 'не указана'}\n"
                f"ОПИСАНИЕ:\n{description or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                '{"level": 3, "abilities": {"str": 12, "dex": 14, "con": 12, "int": 10, "wis": 11, "cha": 13}, '
                '"max_hp": 24, "armor_class": 13, "role": "Короткая роль", "relation": "neutral", '
                '"rationale": "Одна фраза, почему такие числа"}'
            ),
        },
    ]


def suggest_dnd_npc_stats(
    *,
    name: str,
    description: str,
    role: str = "",
    hero_level: int = 1,
    game_id: int | None = None,
) -> dict[str, Any]:
    messages = _build_npc_stats_messages(
        name=str(name or "").strip()[:80],
        description=_head(description, DND_NPC_DESCRIPTION_MAX_CHARS),
        role=str(role or "").strip()[:80],
        hero_level=max(int(hero_level or 1), 1),
    )
    payload, _meta = _llm_service().call_json(
        messages=messages,
        schema=DndNpcStatsPayload,
        module=DND_NPC_STATS_LLM_MODULE,
        game_id=game_id,
        max_tokens=DND_NPC_STATS_MAX_OUTPUT_TOKENS,
        temperature=0.1,
        max_attempts=1,
        request_timeout=DND_CHECK_REQUEST_TIMEOUT,
        translate_input=False,
    )
    return payload.model_dump(mode="json")


# --- Meeting prompt -------------------------------------------------------------------------------

def build_dnd_meeting_prompt(*, npc_name: str, npc_role: str, relation_label: str, npc_notes: str) -> str:
    """The player's turn text for "встретиться" -- an ordinary turn, so it costs an ordinary turn."""
    parts = [f"Я ищу встречи с персонажем по имени {npc_name}"]
    if npc_role:
        parts.append(f" ({npc_role})")
    parts.append(
        ". Опиши, как и где мы встречаемся, опираясь на его описание, характер и наши "
        "прошлые отношения"
    )
    if relation_label:
        parts.append(f" (сейчас отношение ко мне: {relation_label.lower()})")
    if npc_notes:
        parts.append(f". Важное о нём: {npc_notes[:300]}")
    parts.append(".")
    return "".join(parts)


# --- Human-readable labels for logs ----------------------------------------------------------------

def describe_upkeep_for_log(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return "empty"
    hp = payload.get("hp") if isinstance(payload.get("hp"), dict) else {}
    environment = payload.get("environment") if isinstance(payload.get("environment"), dict) else {}
    return (
        f"hp_delta={hp.get('delta', 0)} xp={payload.get('xp_bucket')} "
        f"elapsed={environment.get('elapsed')} npcs={len(payload.get('npcs') or [])}"
    )


_ = (DND_SEASON_LABELS, DND_TIME_LABELS, DND_WEATHER_LABELS, ABILITY_SHORT_LABELS)
