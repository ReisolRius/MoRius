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

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import POLZA_STORY_SERVICE_TEXT_MODEL
from app.services.story_dnd import (
    ABILITY_IDS,
    ABILITY_SHORT_LABELS,
    DND_CONDITION_BY_ID,
    DND_RELATION_LABELS,
    DND_SEASON_LABELS,
    DND_SKILL_LABELS,
    DND_TIME_LABELS,
    DND_WEATHER_LABELS,
    DND_XP_AWARD_BUCKETS,
    ability_modifier,
    describe_environment,
    describe_hero_for_prompt,
    normalize_dnd_class_id,
    normalize_dnd_race_id,
)


logger = logging.getLogger(__name__)

DND_CHECK_LLM_MODULE = "dnd_action_check"
DND_UPKEEP_LLM_MODULE = "dnd_turn_upkeep"
DND_NPC_STATS_LLM_MODULE = "dnd_npc_stats"

DND_CHECK_MAX_OUTPUT_TOKENS = 420
DND_UPKEEP_MAX_OUTPUT_TOKENS = 900
DND_NPC_STATS_MAX_OUTPUT_TOKENS = 420

# Input caps. The narrator's own context already carries the story; these modules only need
# the tail of it, and paying for more would push a one-sol call past its margin.
DND_SCENE_TAIL_MAX_CHARS = 2_400
DND_PLAYER_ACTION_MAX_CHARS = 1_200
DND_NPC_DESCRIPTION_MAX_CHARS = 1_200

DND_CHECK_REQUEST_TIMEOUT = (8.0, 45.0)
DND_UPKEEP_REQUEST_TIMEOUT = (8.0, 60.0)


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
    npcs: list[DndNpcUpdate] = Field(default_factory=list)

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
        return _request_polza_story_text(
            messages_payload,
            model_name=str(kwargs.get("model_name") or POLZA_STORY_SERVICE_TEXT_MODEL),
            allow_service_fallback=False,
            include_configured_service_fallback=False,
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


def _build_check_messages(
    *,
    state: dict[str, Any],
    player_action: str,
    scene_tail: str,
    location_label: str,
) -> list[dict[str, str]]:
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
    ability_line = ", ".join(
        f"{ability_id}={abilities.get(ability_id, 10)}({ability_modifier(abilities.get(ability_id)):+d})"
        for ability_id in ABILITY_IDS
    )
    active_npcs = [
        {"name": npc.get("name"), "role": npc.get("role"), "relation": npc.get("relation")}
        for npc in (state.get("npcs") if isinstance(state.get("npcs"), list) else [])
        if isinstance(npc, dict) and npc.get("is_active")
    ][:6]
    return [
        {
            "role": "system",
            "content": (
                "Ты — судья правил Dungeons & Dragons 5e. По заявленному действию игрока реши, "
                "требуется ли бросок кубика, и если да — какой именно. Отвечай ТОЛЬКО валидным JSON.\n"
                "Бросок нужен, когда исход действия не предрешён и провал имеет последствия: "
                "скрытность, воровство, убеждение/обман/запугивание, взлом, акробатика, атлетика, "
                "атака, сопротивление эффекту (спасбросок), поиск скрытого, лечение, знание.\n"
                "Бросок НЕ нужен для перемещения, осмотра, обычного разговора без давления, "
                "простых бытовых действий и действий, которые герой заведомо выполнит.\n"
                "Сложность (dc) по шкале 5e: 5 очень легко, 10 легко, 15 средне, 20 сложно, "
                "25 очень сложно, 30 почти невозможно. Выбирай честно по описанной ситуации.\n"
                "advantage: 'advantage' если обстоятельства явно помогают, 'disadvantage' если "
                "явно мешают, иначе 'none'. situational_modifier только -5..5 и только при "
                "конкретной причине.\n"
                "die почти всегда 20. Другой кубик (4, 6, 8, 10, 12) — только для мелкого "
                "случайного исхода без проверки характеристики.\n"
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
                f"NPC В СЦЕНЕ: {_dump_json(active_npcs)}\n\n"
                f"ПРЕДЫДУЩАЯ СЦЕНА:\n{scene_tail or 'нет'}\n\n"
                f"ДЕЙСТВИЕ ИГРОКА:\n{player_action}\n\n"
                "Верни JSON строго такого вида:\n"
                '{"needs_check": true, "kind": "skill", "skill": "stealth", "ability": "dex", '
                '"die": 20, "dc": 15, "advantage": "none", "situational_modifier": 0, '
                '"situational_label": "", "reason": "Короткое пояснение для игрока", '
                '"target": "Кого или что затрагивает", "success_hint": "Что произойдёт при успехе", '
                '"failure_hint": "Что произойдёт при провале"}\n'
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
    game_id: int | None = None,
) -> dict[str, Any]:
    """One service request. Raises on transport failure; callers treat that as "no check"."""
    messages = _build_check_messages(
        state=state,
        player_action=_head(player_action, DND_PLAYER_ACTION_MAX_CHARS),
        scene_tail=_tail(scene_tail, DND_SCENE_TAIL_MAX_CHARS),
        location_label=str(location_label or "").strip()[:160],
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
    known_npcs = [
        {
            "name": npc.get("name"),
            "world_card_id": npc.get("world_card_id"),
            "relation": npc.get("relation"),
            "relation_score": npc.get("relation_score"),
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
    return [
        {
            "role": "system",
            "content": (
                "Ты — механический учётчик партии Dungeons & Dragons 5e. По тексту хода определи, "
                "что фактически изменилось в состоянии героя, спутников и мира. Отвечай ТОЛЬКО "
                "валидным JSON. Ничего не выдумывай: опирайся строго на описанные события.\n"
                "- hp.delta: отрицательное при уроне, положительное при лечении, 0 если хиты не "
                "менялись. Оценивай урон по здравому смыслу 5e (удар кинжалом 2-6, меч 5-10, "
                "падение с высоты 5-20, смертельная ловушка 15-40).\n"
                "- xp_bucket: none (ничего значимого), minor (мелкое препятствие, полезная находка), "
                "notable (реальный бой, трудная проверка, сцена разрешена), major (опасная схватка "
                "или важная цель), milestone (завершён квест, побеждён босс, закрыта глава). "
                "Большинство ходов — none или minor.\n"
                "- inventory.added / removed: только предметы, явно полученные или потраченные.\n"
                f"- conditions: только из списка {_condition_catalog_line()}.\n"
                "- environment.elapsed: сколько игрового времени заняла сцена — "
                f"{', '.join(f'{key} ({label})' for key, label in DND_ELAPSED_LABELS.items())}. "
                "Если герой просто поговорил или прошёл десяток шагов — 'minutes' или 'none'. "
                "Время суток и погоду меняй только когда это действительно следует из текста; "
                "сезон не указывай — его считает система по календарю.\n"
                "- npcs: по одному объекту на каждого важного именованного NPC, участвовавшего в "
                "сцене. is_active=true, если он присутствует в сцене прямо сейчас. relation_delta "
                "от -18 до 18 — насколько изменилось отношение К ГЕРОЮ за этот ход; 0, если ничего "
                "особенного не произошло. Безымянную массовку не включай."
            ),
        },
        {
            "role": "user",
            "content": (
                f"ЛИСТ ПЕРСОНАЖА:\n{describe_hero_for_prompt(state)}\n\n"
                f"ТЕКУЩЕЕ ВРЕМЯ И ПОГОДА: {describe_environment(state)} "
                f"(season={environment.get('season')}, time_of_day={environment.get('time_of_day')}, "
                f"weather={environment.get('weather')}, day={environment.get('day')})\n"
                f"МЕСТО: {location_label or 'неизвестно'}\n"
                f"ИЗВЕСТНЫЕ NPC: {_dump_json(known_npcs)}\n"
                f"КАРТОЧКИ ПЕРСОНАЖЕЙ ИГРЫ: {_dump_json(existing_npc_cards[:20])}\n"
                f"АКТИВНЫЕ ЗАДАНИЯ: {_dump_json(quests)}\n\n"
                f"РЕЗУЛЬТАТ БРОСКА В ЭТОМ ХОДЕ: {roll_summary or 'броска не было'}\n\n"
                f"ДЕЙСТВИЕ ИГРОКА:\n{player_action or 'нет'}\n\n"
                f"ОТВЕТ РАССКАЗЧИКА:\n{narrator_text or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                '{"hp": {"should_update": false, "delta": 0, "reason": ""}, '
                '"temp_hp": {"should_update": false, "value": 0}, '
                '"gold": {"should_update": false, "delta": 0}, '
                '"xp_bucket": "none", "xp_reason": "", '
                '"inventory": {"should_update": false, "added": [], "removed": []}, '
                '"conditions": {"should_update": false, "added": [{"id": "poisoned", "note": ""}], "removed": []}, '
                '"environment": {"elapsed": "minutes", "time_of_day": "", "weather": "", "weather_note": "", "day_delta": 0}, '
                '"quests": {"added": [{"title": "", "detail": ""}], "completed": [], "failed": []}, '
                '"master_notes": ["Короткий важный факт для мастера"], '
                '"npcs": [{"name": "Имя", "world_card_id": null, "role": "кто он", "is_active": true, '
                '"relation_delta": 0, "relation_note": "", "hp_delta": 0, "level": null}]}'
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
