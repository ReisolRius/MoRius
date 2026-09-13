"""D&D 5e rules core for the direct tabletop mode.

This module owns everything the mode knows about rules and nothing about HTTP, the LLM or
the turn pipeline: ability scores, point buy, races/classes, skills, hit points, experience,
conditions, dice and the canonical shape of the per-game state blob. The service-model
modules live in ``story_dnd_service`` and the endpoints in ``routers/story_dnd``.

Two play modes, chosen per game and switchable at any time:

* ``game``   -- strict 5e character creation. Abilities come from the standard 27-point buy
                over 8..15 plus the racial bonus, so no stat can start above 17 and the
                array always costs exactly what the rulebook says it costs. Levelling gives
                the usual +2 ASI points at 4/8/12/16/19, capped at 20. Inventory and HP are
                driven by the class/race tables and by the narrator, never typed in freely.
* ``sandbox``-- anything between SANDBOX_ABILITY_MIN and SANDBOX_ABILITY_MAX, free HP/level,
                free-text inventory, editable weather and time. For testing and for players
                who want to be a god rather than an adventurer.

The state is one JSON blob on ``StoryGame.dnd_state_payload``. Everything is normalized on
read, so a blob written by an older build, by a half-failed service call or by hand can
never crash a turn -- unknown keys are dropped and missing ones fall back to the defaults.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
import secrets
from typing import Any, Iterable

from app.services.story_novel import (
    STORY_GAME_MODE_DND,
    is_story_user_administrator,
    normalize_story_game_mode,
)
from app.services.text_encoding import sanitize_likely_utf8_mojibake


# --- Access ------------------------------------------------------------------------------

def is_story_dnd_game(game: Any) -> bool:
    return normalize_story_game_mode(getattr(game, "game_mode", None)) == STORY_GAME_MODE_DND


def can_user_use_story_dnd(user: Any) -> bool:
    """D&D mode is administrator-only while it is being tested on production data."""
    return user is not None and is_story_user_administrator(user)


def is_story_dnd_enabled(game: Any, user: Any) -> bool:
    return can_user_use_story_dnd(user) and is_story_dnd_game(game)


# --- Play mode ---------------------------------------------------------------------------

STORY_DND_PLAY_MODE_GAME = "game"
STORY_DND_PLAY_MODE_SANDBOX = "sandbox"
STORY_DND_PLAY_MODES = (STORY_DND_PLAY_MODE_GAME, STORY_DND_PLAY_MODE_SANDBOX)


def normalize_dnd_play_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_DND_PLAY_MODES:
        return normalized
    if normalized in {"песочница", "free", "creative", "test"}:
        return STORY_DND_PLAY_MODE_SANDBOX
    return STORY_DND_PLAY_MODE_GAME


# --- Abilities ---------------------------------------------------------------------------

ABILITY_IDS: tuple[str, ...] = ("str", "dex", "con", "int", "wis", "cha")
ABILITY_LABELS: dict[str, str] = {
    "str": "Сила",
    "dex": "Ловкость",
    "con": "Телосложение",
    "int": "Интеллект",
    "wis": "Мудрость",
    "cha": "Харизма",
}
ABILITY_SHORT_LABELS: dict[str, str] = {
    "str": "СИЛ",
    "dex": "ЛОВ",
    "con": "ТЕЛ",
    "int": "ИНТ",
    "wis": "МДР",
    "cha": "ХАР",
}

# Strict mode: the rulebook's point buy. 27 points, every base score in 8..15, racial bonus
# applied on top -- which is exactly why a level 1 character cannot exceed 17 in anything.
POINT_BUY_BUDGET = 27
POINT_BUY_MIN = 8
POINT_BUY_MAX = 15
POINT_BUY_COST: dict[int, int] = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9}
ABILITY_HARD_CAP = 20  # 5e ceiling for player characters without epic boons
SANDBOX_ABILITY_MIN = 1
SANDBOX_ABILITY_MAX = 30
DEFAULT_ABILITY_SCORE = 10


def ability_modifier(score: Any) -> int:
    """5e modifier: floor((score - 10) / 2). Works for 1..30 alike."""
    try:
        normalized = int(score)
    except (TypeError, ValueError):
        normalized = DEFAULT_ABILITY_SCORE
    return (normalized - 10) // 2


def format_modifier(value: int) -> str:
    return f"+{int(value)}" if int(value) >= 0 else str(int(value))


def point_buy_cost(score: Any) -> int | None:
    try:
        normalized = int(score)
    except (TypeError, ValueError):
        return None
    return POINT_BUY_COST.get(normalized)


def point_buy_total_cost(base_scores: dict[str, Any]) -> int | None:
    """Total point-buy cost, or None when any score sits outside the legal 8..15 band."""
    total = 0
    for ability_id in ABILITY_IDS:
        cost = point_buy_cost(base_scores.get(ability_id))
        if cost is None:
            return None
        total += cost
    return total


# --- Races -------------------------------------------------------------------------------

@dataclass(frozen=True)
class DndRace:
    id: str
    label: str
    bonuses: dict[str, int]
    speed: int
    traits: tuple[str, ...] = ()


DND_RACES: tuple[DndRace, ...] = (
    DndRace("human", "Человек", {"str": 1, "dex": 1, "con": 1, "int": 1, "wis": 1, "cha": 1}, 30,
            ("Универсальность: +1 ко всем характеристикам",)),
    DndRace("elf", "Эльф", {"dex": 2, "int": 1}, 30,
            ("Тёмное зрение", "Обострённые чувства (Восприятие)", "Транс вместо сна")),
    DndRace("dwarf", "Дварф", {"con": 2, "wis": 1}, 25,
            ("Тёмное зрение", "Дварфийская устойчивость к яду", "Владение боевым топором и молотом")),
    DndRace("halfling", "Полурослик", {"dex": 2, "cha": 1}, 25,
            ("Везучий: перебрасывает «1» на d20", "Храбрый: преимущество против страха")),
    DndRace("half_elf", "Полуэльф", {"cha": 2, "dex": 1, "wis": 1}, 30,
            ("Тёмное зрение", "Наследие фей: преимущество против очарования")),
    DndRace("half_orc", "Полуорк", {"str": 2, "con": 1}, 30,
            ("Тёмное зрение", "Непоколебимая стойкость: остаётся на 1 хите вместо смерти",
             "Свирепые атаки: усиленный крит")),
    DndRace("dragonborn", "Драконорождённый", {"str": 2, "cha": 1}, 30,
            ("Оружие дыхания", "Сопротивление стихии своего наследия")),
    DndRace("gnome", "Гном", {"int": 2, "con": 1}, 25,
            ("Тёмное зрение", "Гномья хитрость: преимущество на спасброски ИНТ/МДР/ХАР от магии")),
    DndRace("tiefling", "Тифлинг", {"cha": 2, "int": 1}, 30,
            ("Тёмное зрение", "Адское сопротивление огню")),
)
DND_RACE_BY_ID: dict[str, DndRace] = {race.id: race for race in DND_RACES}
DEFAULT_RACE_ID = "human"


def normalize_dnd_race_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_RACE_BY_ID:
        return normalized
    for race in DND_RACES:
        if race.label.lower() == str(value or "").strip().lower():
            return race.id
    return DEFAULT_RACE_ID


# --- Classes -----------------------------------------------------------------------------

@dataclass(frozen=True)
class DndClass:
    id: str
    label: str
    hit_die: int
    primary: tuple[str, ...]
    saving_throws: tuple[str, ...]
    skills: tuple[str, ...]
    starting_inventory: tuple[str, ...]
    base_armor: int  # armour class granted by the starting kit, before the DEX modifier
    armor_dex_cap: int | None  # None = no cap (light/none), 2 = medium, 0 = heavy


DND_CLASSES: tuple[DndClass, ...] = (
    DndClass("fighter", "Воин", 10, ("str",), ("str", "con"),
             ("athletics", "intimidation"),
             ("Кольчуга", "Щит", "Длинный меч", "Лёгкий арбалет и 20 болтов",
              "Набор искателя приключений", "Мешочек с 15 зм"),
             16, 0),
    DndClass("barbarian", "Варвар", 12, ("str",), ("str", "con"),
             ("athletics", "survival"),
             ("Две ручные секиры", "Большой топор", "Четыре метательных копья",
              "Набор путешественника", "Мешочек с 10 зм"),
             12, None),
    DndClass("rogue", "Плут", 8, ("dex",), ("dex", "int"),
             ("stealth", "sleight_of_hand", "perception", "deception"),
             ("Короткий меч", "Короткий лук и 20 стрел", "Кожаный доспех",
              "Воровские инструменты", "Набор взломщика", "Мешочек с 12 зм"),
             11, None),
    DndClass("ranger", "Следопыт", 10, ("dex", "wis"), ("str", "dex"),
             ("survival", "perception", "nature"),
             ("Кожаный доспех", "Два коротких меча", "Длинный лук и 20 стрел",
              "Набор исследователя", "Мешочек с 10 зм"),
             11, None),
    DndClass("paladin", "Паладин", 10, ("str", "cha"), ("wis", "cha"),
             ("religion", "persuasion"),
             ("Кольчуга", "Щит", "Боевой молот", "Пять метательных копий",
              "Священный символ", "Набор священника", "Мешочек с 12 зм"),
             16, 0),
    DndClass("monk", "Монах", 8, ("dex", "wis"), ("str", "dex"),
             ("acrobatics", "insight"),
             ("Короткий меч", "Десять дротиков", "Набор путешественника"),
             10, None),
    DndClass("cleric", "Жрец", 8, ("wis",), ("wis", "cha"),
             ("medicine", "religion", "insight"),
             ("Кольчужная рубаха", "Щит", "Булава", "Священный символ",
              "Набор священника", "Мешочек с 15 зм"),
             13, 2),
    DndClass("druid", "Друид", 8, ("wis",), ("int", "wis"),
             ("nature", "animal_handling", "medicine"),
             ("Кожаный доспех", "Деревянный щит", "Серп", "Друидическая фокусировка",
              "Набор путешественника"),
             11, None),
    DndClass("wizard", "Волшебник", 6, ("int",), ("int", "wis"),
             ("arcana", "history", "investigation"),
             ("Посох", "Книга заклинаний", "Компонентный мешочек",
              "Набор учёного", "Мешочек с 10 зм"),
             10, None),
    DndClass("sorcerer", "Чародей", 6, ("cha",), ("con", "cha"),
             ("arcana", "persuasion", "deception"),
             ("Лёгкий арбалет и 20 болтов", "Два кинжала", "Компонентный мешочек",
              "Набор путешественника", "Мешочек с 12 зм"),
             10, None),
    DndClass("warlock", "Колдун", 8, ("cha",), ("wis", "cha"),
             ("arcana", "deception", "intimidation"),
             ("Кожаный доспех", "Лёгкий арбалет и 20 болтов", "Два кинжала",
              "Мистическая фокусировка", "Набор учёного", "Мешочек с 15 зм"),
             11, None),
    DndClass("bard", "Бард", 8, ("cha",), ("dex", "cha"),
             ("performance", "persuasion", "deception"),
             ("Кожаный доспех", "Рапира", "Лютня", "Набор дипломата", "Мешочек с 15 зм"),
             11, None),
)
DND_CLASS_BY_ID: dict[str, DndClass] = {item.id: item for item in DND_CLASSES}
DEFAULT_CLASS_ID = "fighter"


def normalize_dnd_class_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_CLASS_BY_ID:
        return normalized
    for item in DND_CLASSES:
        if item.label.lower() == str(value or "").strip().lower():
            return item.id
    return DEFAULT_CLASS_ID


# --- Skills ------------------------------------------------------------------------------

DND_SKILLS: tuple[tuple[str, str, str], ...] = (
    ("acrobatics", "Акробатика", "dex"),
    ("animal_handling", "Уход за животными", "wis"),
    ("arcana", "Магия", "int"),
    ("athletics", "Атлетика", "str"),
    ("deception", "Обман", "cha"),
    ("history", "История", "int"),
    ("insight", "Проницательность", "wis"),
    ("intimidation", "Запугивание", "cha"),
    ("investigation", "Анализ", "int"),
    ("medicine", "Медицина", "wis"),
    ("nature", "Природа", "int"),
    ("perception", "Восприятие", "wis"),
    ("performance", "Выступление", "cha"),
    ("persuasion", "Убеждение", "cha"),
    ("religion", "Религия", "int"),
    ("sleight_of_hand", "Ловкость рук", "dex"),
    ("stealth", "Скрытность", "dex"),
    ("survival", "Выживание", "wis"),
)
DND_SKILL_ABILITY: dict[str, str] = {skill_id: ability for skill_id, _label, ability in DND_SKILLS}
DND_SKILL_LABELS: dict[str, str] = {skill_id: label for skill_id, label, _ability in DND_SKILLS}
DND_MAX_SKILL_PROFICIENCIES = 6


def normalize_dnd_skill_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_SKILL_ABILITY:
        return normalized
    lowered = str(value or "").strip().lower()
    for skill_id, label in DND_SKILL_LABELS.items():
        if label.lower() == lowered:
            return skill_id
    return ""


def normalize_dnd_ability_id(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ABILITY_IDS:
        return normalized
    aliases = {
        "strength": "str", "сила": "str", "сил": "str",
        "dexterity": "dex", "ловкость": "dex", "лов": "dex",
        "constitution": "con", "телосложение": "con", "тел": "con",
        "intelligence": "int", "интеллект": "int", "инт": "int",
        "wisdom": "wis", "мудрость": "wis", "мдр": "wis",
        "charisma": "cha", "харизма": "cha", "хар": "cha",
    }
    return aliases.get(normalized, "")


# --- Levels, proficiency, experience -----------------------------------------------------

DND_MAX_LEVEL = 20
# Cumulative experience needed to *reach* each level, index 0 == level 1. This is a
# deliberately compressed curve, not the rulebook's: 5e assumes a multi-hour session per
# encounter, while a text game produces a turn every couple of minutes. At the award sizes
# below (see DND_XP_AWARD_BUCKETS) levels 1-5 land in a few dozen turns and the late game
# still takes real investment.
DND_XP_THRESHOLDS: tuple[int, ...] = (
    0, 120, 320, 640, 1_100, 1_750, 2_600, 3_700, 5_100, 6_800,
    8_900, 11_400, 14_400, 17_900, 22_000, 26_700, 32_100, 38_200, 45_100, 52_800,
)
# What a single turn may be worth. The service model picks a bucket, never a raw number, so
# a hallucinated "9999" cannot exist -- and DND_XP_MAX_PER_TURN is the last-ditch clamp.
DND_XP_AWARD_BUCKETS: dict[str, int] = {
    "none": 0,
    "minor": 10,        # a small obstacle handled, a useful discovery
    "notable": 30,      # a real fight, a hard check, a scene resolved
    "major": 70,        # a dangerous encounter or an important goal reached
    "milestone": 150,   # a chapter closed, a boss beaten, a quest completed
}
DND_XP_MAX_PER_TURN = 150
DND_ASI_LEVELS = (4, 8, 12, 16, 19)
DND_ASI_POINTS = 2


def proficiency_bonus(level: Any) -> int:
    normalized = normalize_dnd_level(level)
    return 2 + (normalized - 1) // 4


def normalize_dnd_level(value: Any) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = 1
    return max(1, min(DND_MAX_LEVEL, normalized))


def xp_threshold_for_level(level: Any) -> int:
    normalized = normalize_dnd_level(level)
    return DND_XP_THRESHOLDS[normalized - 1]


def xp_next_level_threshold(level: Any) -> int | None:
    """Total XP needed for the next level, or None at the cap."""
    normalized = normalize_dnd_level(level)
    if normalized >= DND_MAX_LEVEL:
        return None
    return DND_XP_THRESHOLDS[normalized]


def level_for_total_xp(total_xp: Any) -> int:
    try:
        normalized = max(int(total_xp), 0)
    except (TypeError, ValueError):
        normalized = 0
    level = 1
    for index, threshold in enumerate(DND_XP_THRESHOLDS, start=1):
        if normalized >= threshold:
            level = index
    return level


def asi_points_earned_through_level(level: Any) -> int:
    normalized = normalize_dnd_level(level)
    return sum(DND_ASI_POINTS for asi_level in DND_ASI_LEVELS if normalized >= asi_level)


# --- Hit points --------------------------------------------------------------------------

def max_hit_points(class_id: str, con_score: Any, level: Any) -> int:
    """Level 1 takes the full hit die; later levels take the 5e fixed average (die/2 + 1)."""
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    normalized_level = normalize_dnd_level(level)
    con_mod = ability_modifier(con_score)
    average_per_level = dnd_class.hit_die // 2 + 1
    total = dnd_class.hit_die + con_mod
    total += (average_per_level + con_mod) * (normalized_level - 1)
    # Even a con 1 wizard gains at least one hit point per level, same as the rulebook.
    return max(normalized_level, total)


def armor_class(class_id: str, dex_score: Any) -> int:
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    dex_mod = ability_modifier(dex_score)
    if dnd_class.armor_dex_cap is not None:
        dex_mod = min(dex_mod, dnd_class.armor_dex_cap)
    if dnd_class.id == "monk":
        # Unarmoured defence: 10 + DEX + WIS is handled by the caller when WIS is known; the
        # base here keeps monks from reading as if they wore plate.
        return max(10, 10 + dex_mod)
    return max(10, dnd_class.base_armor + dex_mod)


# --- Conditions (buffs / debuffs) ---------------------------------------------------------

@dataclass(frozen=True)
class DndCondition:
    id: str
    label: str
    kind: str  # "buff" | "debuff"
    icon: str
    description: str


DND_CONDITIONS: tuple[DndCondition, ...] = (
    DndCondition("blinded", "Ослеплён", "debuff", "eye-off", "Провал проверок на зрение, помеха на атаки."),
    DndCondition("charmed", "Очарован", "debuff", "heart", "Не может атаковать источник очарования."),
    DndCondition("deafened", "Оглушён", "debuff", "ear-off", "Провал проверок на слух."),
    DndCondition("frightened", "Напуган", "debuff", "skull", "Помеха на проверки и атаки, пока источник виден."),
    DndCondition("grappled", "Схвачен", "debuff", "grab", "Скорость равна 0."),
    DndCondition("incapacitated", "Недееспособен", "debuff", "ban", "Не может совершать действия и реакции."),
    DndCondition("paralyzed", "Парализован", "debuff", "zap-off", "Недееспособен, атаки вблизи — автокрит."),
    DndCondition("petrified", "Окаменел", "debuff", "gem", "Превращён в камень, не осознаёт окружение."),
    DndCondition("poisoned", "Отравлен", "debuff", "flask", "Помеха на броски атаки и проверки характеристик."),
    DndCondition("prone", "Сбит с ног", "debuff", "arrow-down", "Помеха на атаки, атаки вблизи — с преимуществом."),
    DndCondition("restrained", "Опутан", "debuff", "chain", "Скорость 0, помеха на атаки и спасброски ЛОВ."),
    DndCondition("stunned", "Ошеломлён", "debuff", "stars", "Недееспособен, автопровал спасбросков СИЛ и ЛОВ."),
    DndCondition("unconscious", "Без сознания", "debuff", "moon", "Недееспособен, роняет всё, падает ничком."),
    DndCondition("exhaustion", "Истощение", "debuff", "battery-low", "Помеха на проверки характеристик."),
    DndCondition("wounded", "Ранен", "debuff", "bandage", "Открытая рана: помеха на длительные нагрузки."),
    DndCondition("hidden", "Скрыт", "buff", "ghost", "Преимущество на атаку из укрытия."),
    DndCondition("blessed", "Благословлён", "buff", "sparkle", "+1d4 к броскам атаки и спасброскам."),
    DndCondition("inspired", "Вдохновлён", "buff", "music", "Кость вдохновения барда к одной проверке."),
    DndCondition("hasted", "Ускорен", "buff", "wind", "Удвоенная скорость, +2 к КД."),
    DndCondition("raging", "В ярости", "buff", "flame", "Бонус к урону и сопротивление физическому урону."),
    DndCondition("shielded", "Под щитом", "buff", "shield", "+5 к КД до начала следующего хода."),
    DndCondition("well_fed", "Сыт и отдохнул", "buff", "leaf", "Преимущество на спасброски ТЕЛ на этот день."),
)
DND_CONDITION_BY_ID: dict[str, DndCondition] = {item.id: item for item in DND_CONDITIONS}
DND_MAX_CONDITIONS = 8


def normalize_dnd_condition_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_CONDITION_BY_ID:
        return normalized
    lowered = str(value or "").strip().lower()
    for condition in DND_CONDITIONS:
        if condition.label.lower() == lowered:
            return condition.id
    return ""


# --- Environment: season, time of day, weather --------------------------------------------

DND_SEASONS: tuple[tuple[str, str], ...] = (
    ("spring", "Весна"),
    ("summer", "Лето"),
    ("autumn", "Осень"),
    ("winter", "Зима"),
)
DND_SEASON_IDS = tuple(item[0] for item in DND_SEASONS)
DND_SEASON_LABELS = dict(DND_SEASONS)
DEFAULT_SEASON = "summer"

# Ordered: the drift rules below rely on adjacency, so a scene that lasted an hour can move
# from "день" to "вечер" but never straight to "ночь".
DND_TIMES_OF_DAY: tuple[tuple[str, str], ...] = (
    ("dawn", "Рассвет"),
    ("morning", "Утро"),
    ("noon", "Полдень"),
    ("afternoon", "День"),
    ("evening", "Вечер"),
    ("dusk", "Сумерки"),
    ("night", "Ночь"),
    ("midnight", "Глубокая ночь"),
)
DND_TIME_IDS = tuple(item[0] for item in DND_TIMES_OF_DAY)
DND_TIME_LABELS = dict(DND_TIMES_OF_DAY)
DEFAULT_TIME_OF_DAY = "morning"

DND_WEATHERS: tuple[tuple[str, str], ...] = (
    ("clear", "Ясно"),
    ("sunny", "Солнечно"),
    ("cloudy", "Облачно"),
    ("overcast", "Пасмурно"),
    ("fog", "Туман"),
    ("rain", "Дождь"),
    ("storm", "Гроза"),
    ("snow", "Снег"),
    ("blizzard", "Метель"),
    ("wind", "Ветрено"),
    ("heat", "Зной"),
)
DND_WEATHER_IDS = tuple(item[0] for item in DND_WEATHERS)
DND_WEATHER_LABELS = dict(DND_WEATHERS)
DEFAULT_WEATHER = "clear"

# Weather that simply cannot happen in a season. A week of travel may bring winter, but a
# scene that has not moved must never flip to a blizzard in midsummer.
DND_SEASON_WEATHER_ALLOWED: dict[str, set[str]] = {
    "spring": {"clear", "sunny", "cloudy", "overcast", "fog", "rain", "storm", "wind"},
    "summer": {"clear", "sunny", "cloudy", "overcast", "fog", "rain", "storm", "wind", "heat"},
    "autumn": {"clear", "sunny", "cloudy", "overcast", "fog", "rain", "storm", "wind", "snow"},
    "winter": {"clear", "sunny", "cloudy", "overcast", "fog", "snow", "blizzard", "wind", "storm"},
}


def normalize_dnd_season(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in DND_SEASON_IDS:
        return normalized
    for season_id, label in DND_SEASONS:
        if label.lower() == normalized:
            return season_id
    return DEFAULT_SEASON


def normalize_dnd_time_of_day(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in DND_TIME_IDS:
        return normalized
    for time_id, label in DND_TIMES_OF_DAY:
        if label.lower() == normalized:
            return time_id
    return DEFAULT_TIME_OF_DAY


def normalize_dnd_weather(value: Any, *, season: str | None = None) -> str:
    normalized = str(value or "").strip().lower()
    resolved = ""
    if normalized in DND_WEATHER_IDS:
        resolved = normalized
    else:
        for weather_id, label in DND_WEATHERS:
            if label.lower() == normalized:
                resolved = weather_id
                break
    if not resolved:
        resolved = DEFAULT_WEATHER
    if season:
        allowed = DND_SEASON_WEATHER_ALLOWED.get(normalize_dnd_season(season), set(DND_WEATHER_IDS))
        if resolved not in allowed:
            resolved = DEFAULT_WEATHER
    return resolved


def time_of_day_distance(from_id: str, to_id: str) -> int:
    """How many slots apart two times of day are on the 8-slot daily wheel."""
    try:
        from_index = DND_TIME_IDS.index(normalize_dnd_time_of_day(from_id))
        to_index = DND_TIME_IDS.index(normalize_dnd_time_of_day(to_id))
    except ValueError:
        return 0
    forward = (to_index - from_index) % len(DND_TIME_IDS)
    return forward


# --- Relationships -------------------------------------------------------------------------

# Ordered worst to best. The service model returns a label, never a number, and the score is
# what actually drives drift so a single rude line cannot jump an ally straight to "враждебное".
DND_RELATIONS: tuple[tuple[str, str, int], ...] = (
    ("hostile", "Враждебное", -80),
    ("hateful", "Ненависть", -60),
    ("wary", "Настороженное", -30),
    ("neutral", "Нейтральное", 0),
    ("friendly", "Дружеское", 35),
    ("loyal", "Преданное", 60),
    ("devoted", "Обожание", 75),
    ("in_love", "Влюблена", 90),
)
DND_RELATION_IDS = tuple(item[0] for item in DND_RELATIONS)
DND_RELATION_LABELS = {item[0]: item[1] for item in DND_RELATIONS}
DND_RELATION_SCORES = {item[0]: item[2] for item in DND_RELATIONS}
DEFAULT_RELATION = "neutral"
DND_RELATION_SCORE_MIN = -100
DND_RELATION_SCORE_MAX = 100
# Cap on how far one turn may move a relationship. Stops "I said hello" from creating love.
DND_RELATION_MAX_TURN_DELTA = 18


def normalize_dnd_relation_id(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_RELATION_LABELS:
        return normalized
    lowered = str(value or "").strip().lower()
    for relation_id, label in DND_RELATION_LABELS.items():
        if label.lower() == lowered:
            return relation_id
    return DEFAULT_RELATION


def relation_id_for_score(score: Any) -> str:
    """The band a score falls into: the highest threshold it still reaches.

    DND_RELATIONS is ordered worst-to-best, so walking it and keeping the last threshold at
    or below the score lands on the right band in both directions. A score below the lowest
    threshold stays in that lowest band rather than wrapping round to neutral.
    """
    try:
        normalized = int(score)
    except (TypeError, ValueError):
        normalized = 0
    best_id = DND_RELATIONS[0][0]
    for relation_id, _label, threshold in DND_RELATIONS:
        if normalized >= threshold:
            best_id = relation_id
    return best_id


def clamp_relation_score(value: Any) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = 0
    return max(DND_RELATION_SCORE_MIN, min(DND_RELATION_SCORE_MAX, normalized))


# --- Dice --------------------------------------------------------------------------------

DND_DICE_SIDES: tuple[int, ...] = (4, 6, 8, 10, 12, 20, 100)
DND_DEFAULT_DIE = 20
_DICE_NOTATION_PATTERN = re.compile(r"^\s*(\d*)\s*[dд]\s*(\d+)\s*$", re.IGNORECASE)


def normalize_dnd_die(value: Any) -> int:
    """Accepts 20, "20", "d20", "д20", "1d20"; anything else falls back to d20."""
    if isinstance(value, bool):
        return DND_DEFAULT_DIE
    if isinstance(value, int):
        return value if value in DND_DICE_SIDES else DND_DEFAULT_DIE
    text = str(value or "").strip()
    if not text:
        return DND_DEFAULT_DIE
    if text.isdigit():
        sides = int(text)
        return sides if sides in DND_DICE_SIDES else DND_DEFAULT_DIE
    match = _DICE_NOTATION_PATTERN.match(text)
    if match:
        sides = int(match.group(2))
        return sides if sides in DND_DICE_SIDES else DND_DEFAULT_DIE
    return DND_DEFAULT_DIE


def roll_die(sides: int) -> int:
    """One fair die. Uses secrets so a player cannot predict or replay a roll."""
    normalized = sides if sides in DND_DICE_SIDES else DND_DEFAULT_DIE
    return secrets.randbelow(normalized) + 1


DND_ADVANTAGE_NONE = "none"
DND_ADVANTAGE_ADVANTAGE = "advantage"
DND_ADVANTAGE_DISADVANTAGE = "disadvantage"
DND_ADVANTAGE_MODES = (DND_ADVANTAGE_NONE, DND_ADVANTAGE_ADVANTAGE, DND_ADVANTAGE_DISADVANTAGE)


def normalize_dnd_advantage(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in DND_ADVANTAGE_MODES:
        return normalized
    if normalized in {"adv", "преимущество", "+"}:
        return DND_ADVANTAGE_ADVANTAGE
    if normalized in {"dis", "disadv", "помеха", "-"}:
        return DND_ADVANTAGE_DISADVANTAGE
    return DND_ADVANTAGE_NONE


# --- Difficulty ---------------------------------------------------------------------------

DND_DC_MIN = 5
DND_DC_MAX = 30
DND_DC_LABELS: tuple[tuple[int, str], ...] = (
    (5, "Очень легко"),
    (10, "Легко"),
    (15, "Средне"),
    (20, "Сложно"),
    (25, "Очень сложно"),
    (30, "Почти невозможно"),
)


def normalize_dnd_dc(value: Any) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = 15
    return max(DND_DC_MIN, min(DND_DC_MAX, normalized))


def dc_label(value: Any) -> str:
    normalized = normalize_dnd_dc(value)
    label = DND_DC_LABELS[0][1]
    for threshold, text in DND_DC_LABELS:
        if normalized >= threshold:
            label = text
    return label


# --- Check outcomes -------------------------------------------------------------------------

DND_OUTCOME_CRITICAL_SUCCESS = "critical_success"
DND_OUTCOME_SUCCESS = "success"
DND_OUTCOME_FAILURE = "failure"
DND_OUTCOME_CRITICAL_FAILURE = "critical_failure"
DND_OUTCOME_LABELS: dict[str, str] = {
    DND_OUTCOME_CRITICAL_SUCCESS: "Критический успех",
    DND_OUTCOME_SUCCESS: "Успех",
    DND_OUTCOME_FAILURE: "Провал",
    DND_OUTCOME_CRITICAL_FAILURE: "Критический провал",
}

DND_CHECK_KIND_ABILITY = "ability"
DND_CHECK_KIND_SKILL = "skill"
DND_CHECK_KIND_SAVE = "saving_throw"
DND_CHECK_KIND_ATTACK = "attack"
DND_CHECK_KINDS = (DND_CHECK_KIND_ABILITY, DND_CHECK_KIND_SKILL, DND_CHECK_KIND_SAVE, DND_CHECK_KIND_ATTACK)


def normalize_dnd_check_kind(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_CHECK_KINDS:
        return normalized
    aliases = {
        "save": DND_CHECK_KIND_SAVE,
        "saving": DND_CHECK_KIND_SAVE,
        "спасбросок": DND_CHECK_KIND_SAVE,
        "навык": DND_CHECK_KIND_SKILL,
        "атака": DND_CHECK_KIND_ATTACK,
        "характеристика": DND_CHECK_KIND_ABILITY,
    }
    return aliases.get(normalized, DND_CHECK_KIND_SKILL)


# A d20 roll only crits on a natural 20/1. Smaller dice have no crit range in 5e, so a d6
# "luck" roll is graded purely against its DC.
def resolve_check_outcome(*, die: int, natural: int, total: int, dc: int) -> str:
    if die == DND_DEFAULT_DIE:
        if natural == DND_DEFAULT_DIE:
            return DND_OUTCOME_CRITICAL_SUCCESS
        if natural == 1:
            return DND_OUTCOME_CRITICAL_FAILURE
    return DND_OUTCOME_SUCCESS if total >= dc else DND_OUTCOME_FAILURE


@dataclass
class DndRollResult:
    die: int
    rolls: list[int]
    natural: int
    advantage: str
    modifier_total: int
    modifier_breakdown: list[dict[str, Any]]
    total: int
    dc: int
    outcome: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "die": self.die,
            "rolls": list(self.rolls),
            "natural": self.natural,
            "advantage": self.advantage,
            "modifier_total": self.modifier_total,
            "modifier_breakdown": list(self.modifier_breakdown),
            "total": self.total,
            "dc": self.dc,
            "outcome": self.outcome,
            "outcome_label": DND_OUTCOME_LABELS.get(self.outcome, ""),
        }


def perform_roll(
    *,
    die: int,
    dc: int,
    advantage: str,
    modifier_breakdown: list[dict[str, Any]],
) -> DndRollResult:
    normalized_die = normalize_dnd_die(die)
    normalized_dc = normalize_dnd_dc(dc)
    normalized_advantage = normalize_dnd_advantage(advantage)
    # Advantage/disadvantage is a d20 mechanic; on other dice the player just rolls once.
    roll_count = 2 if (normalized_advantage != DND_ADVANTAGE_NONE and normalized_die == DND_DEFAULT_DIE) else 1
    rolls = [roll_die(normalized_die) for _ in range(roll_count)]
    if roll_count == 2:
        natural = max(rolls) if normalized_advantage == DND_ADVANTAGE_ADVANTAGE else min(rolls)
    else:
        natural = rolls[0]
    modifier_total = sum(int(item.get("value", 0) or 0) for item in modifier_breakdown)
    total = natural + modifier_total
    return DndRollResult(
        die=normalized_die,
        rolls=rolls,
        natural=natural,
        advantage=normalized_advantage,
        modifier_total=modifier_total,
        modifier_breakdown=list(modifier_breakdown),
        total=total,
        dc=normalized_dc,
        outcome=resolve_check_outcome(die=normalized_die, natural=natural, total=total, dc=normalized_dc),
    )


def build_check_modifier_breakdown(hero: dict[str, Any], check: dict[str, Any]) -> list[dict[str, Any]]:
    """Every number that lands on the die, itemised so the dialog can show its maths."""
    breakdown: list[dict[str, Any]] = []
    abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
    level = normalize_dnd_level(hero.get("level"))
    kind = normalize_dnd_check_kind(check.get("kind"))
    skill_id = normalize_dnd_skill_id(check.get("skill"))
    ability_id = normalize_dnd_ability_id(check.get("ability"))
    if not ability_id and skill_id:
        ability_id = DND_SKILL_ABILITY.get(skill_id, "")
    if not ability_id:
        ability_id = "dex" if kind == DND_CHECK_KIND_ATTACK else "wis"

    ability_mod = ability_modifier(abilities.get(ability_id, DEFAULT_ABILITY_SCORE))
    breakdown.append(
        {
            "key": f"ability:{ability_id}",
            "label": ABILITY_SHORT_LABELS.get(ability_id, ability_id.upper()),
            "value": ability_mod,
        }
    )

    is_proficient = False
    if kind == DND_CHECK_KIND_SKILL and skill_id:
        is_proficient = skill_id in normalize_string_list(hero.get("skill_proficiencies"))
    elif kind == DND_CHECK_KIND_SAVE and ability_id:
        is_proficient = ability_id in normalize_string_list(hero.get("saving_throw_proficiencies"))
    elif kind == DND_CHECK_KIND_ATTACK:
        is_proficient = True  # every class is proficient with its own starting weapons
    if is_proficient:
        breakdown.append(
            {"key": "proficiency", "label": "Владение", "value": proficiency_bonus(level)}
        )

    # Conditions that mechanically shift the number rather than the advantage state.
    condition_ids = {
        normalize_dnd_condition_id(item.get("id") if isinstance(item, dict) else item)
        for item in (hero.get("conditions") if isinstance(hero.get("conditions"), list) else [])
    }
    if "blessed" in condition_ids:
        breakdown.append({"key": "condition:blessed", "label": "Благословение", "value": 2})
    if "exhaustion" in condition_ids:
        breakdown.append({"key": "condition:exhaustion", "label": "Истощение", "value": -2})
    if "inspired" in condition_ids:
        breakdown.append({"key": "condition:inspired", "label": "Вдохновение", "value": 2})

    situational = check.get("situational_modifier")
    try:
        situational_value = int(situational)
    except (TypeError, ValueError):
        situational_value = 0
    situational_value = max(-5, min(5, situational_value))
    if situational_value:
        breakdown.append(
            {
                "key": "situational",
                "label": str(check.get("situational_label") or "Обстоятельства")[:60],
                "value": situational_value,
            }
        )
    return breakdown


def resolve_check_advantage(hero: dict[str, Any], check: dict[str, Any]) -> str:
    """Combine the narrator's advantage call with the hero's conditions, 5e style."""
    requested = normalize_dnd_advantage(check.get("advantage"))
    condition_ids = {
        normalize_dnd_condition_id(item.get("id") if isinstance(item, dict) else item)
        for item in (hero.get("conditions") if isinstance(hero.get("conditions"), list) else [])
    }
    grants_advantage = bool(condition_ids & {"hidden", "hasted", "raging"})
    grants_disadvantage = bool(
        condition_ids & {"poisoned", "frightened", "prone", "restrained", "blinded", "exhaustion"}
    )
    if requested == DND_ADVANTAGE_ADVANTAGE:
        grants_advantage = True
    if requested == DND_ADVANTAGE_DISADVANTAGE:
        grants_disadvantage = True
    if grants_advantage and grants_disadvantage:
        return DND_ADVANTAGE_NONE  # they cancel, exactly as the rulebook says
    if grants_advantage:
        return DND_ADVANTAGE_ADVANTAGE
    if grants_disadvantage:
        return DND_ADVANTAGE_DISADVANTAGE
    return DND_ADVANTAGE_NONE


# --- Small normalizers --------------------------------------------------------------------

def normalize_text_value(value: Any, *, max_length: int = 400) -> str:
    normalized = sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:max_length].rstrip()


def normalize_single_line(value: Any, *, max_length: int = 160) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(str(value or "")).split()).strip()
    return normalized[:max_length].rstrip()


def normalize_string_list(value: Any, *, max_items: int = 24, max_length: int = 120) -> list[str]:
    if isinstance(value, str):
        raw_items: Iterable[Any] = [part for part in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        raw_items = value
    else:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in raw_items:
        normalized = normalize_single_line(item, max_length=max_length)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
        if len(result) >= max_items:
            break
    return result


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, normalized))


# --- State shape ----------------------------------------------------------------------------

STORY_DND_STATE_VERSION = 1
DND_MAX_QUESTS = 12
DND_MAX_NOTES = 12
DND_MAX_NPCS = 60
DND_INVENTORY_MAX_LENGTH = 2_000
DND_MAX_INVENTORY_ITEMS = 40


def normalize_dnd_abilities(value: Any, *, play_mode: str) -> dict[str, int]:
    minimum = SANDBOX_ABILITY_MIN if play_mode == STORY_DND_PLAY_MODE_SANDBOX else 1
    maximum = SANDBOX_ABILITY_MAX if play_mode == STORY_DND_PLAY_MODE_SANDBOX else ABILITY_HARD_CAP
    source = value if isinstance(value, dict) else {}
    return {
        ability_id: _clamp_int(source.get(ability_id), minimum, maximum, DEFAULT_ABILITY_SCORE)
        for ability_id in ABILITY_IDS
    }


def normalize_dnd_conditions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        raw_id = item.get("id") if isinstance(item, dict) else item
        condition_id = normalize_dnd_condition_id(raw_id)
        if not condition_id or condition_id in seen:
            continue
        seen.add(condition_id)
        condition = DND_CONDITION_BY_ID[condition_id]
        note = normalize_single_line(item.get("note") if isinstance(item, dict) else "", max_length=120)
        result.append(
            {
                "id": condition.id,
                "label": condition.label,
                "kind": condition.kind,
                "icon": condition.icon,
                "description": condition.description,
                "note": note,
            }
        )
        if len(result) >= DND_MAX_CONDITIONS:
            break
    return result


def default_inventory_for(class_id: str, race_id: str) -> list[str]:
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    items = list(dnd_class.starting_inventory)
    race = DND_RACE_BY_ID.get(normalize_dnd_race_id(race_id))
    if race is not None and race.id == "dwarf":
        items.append("Дварфийский походный инструмент")
    if race is not None and race.id == "elf":
        items.append("Эльфийский плащ")
    return items


def normalize_dnd_inventory(value: Any) -> list[str]:
    return normalize_string_list(value, max_items=DND_MAX_INVENTORY_ITEMS, max_length=120)


def normalize_dnd_hp(value: Any, *, max_hp: int) -> dict[str, int]:
    source = value if isinstance(value, dict) else {}
    normalized_max = max(1, int(max_hp or 1))
    current = _clamp_int(source.get("current"), 0, normalized_max, normalized_max)
    temp = _clamp_int(source.get("temp"), 0, 999, 0)
    return {"current": current, "max": normalized_max, "temp": temp}


def fit_base_abilities_to_point_buy(base_abilities: dict[str, Any]) -> dict[str, int]:
    """Force an array into the legal 27-point buy, whatever it claimed to be.

    ``validate_hero_sheet`` rejects an illegal array at the API boundary with an explanation;
    this is the silent last line of defence for a stored blob -- hand-edited, written by an
    older build, or left behind by a half-applied migration. Scores are clamped into 8..15 and
    then the most expensive ones are walked down until the array costs what it is allowed to.
    """
    scores = {
        ability_id: max(POINT_BUY_MIN, min(POINT_BUY_MAX, _clamp_int(base_abilities.get(ability_id), 1, 30, DEFAULT_ABILITY_SCORE)))
        for ability_id in ABILITY_IDS
    }
    spent = point_buy_total_cost(scores) or 0
    # Each pass removes one point from the priciest score, which is the cheapest way back
    # under budget and terminates because every score bottoms out at POINT_BUY_MIN.
    while spent > POINT_BUY_BUDGET:
        reducible = [ability_id for ability_id in ABILITY_IDS if scores[ability_id] > POINT_BUY_MIN]
        if not reducible:
            break
        target = max(reducible, key=lambda ability_id: scores[ability_id])
        scores[target] -= 1
        spent = point_buy_total_cost(scores) or 0
    return scores


def normalize_dnd_asi_allocation(value: Any) -> dict[str, int]:
    """Ability score improvements the player has already spent, per ability.

    Kept separately from the rolled-up ``abilities`` so that saving the sheet -- which
    recomputes abilities from base + race + ASI -- cannot quietly undo a level-up.
    """
    source = value if isinstance(value, dict) else {}
    result: dict[str, int] = {}
    for ability_id in ABILITY_IDS:
        points = _clamp_int(source.get(ability_id), 0, 20, 0)
        if points:
            result[ability_id] = points
    return result


def normalize_dnd_hero(value: Any, *, play_mode: str) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    race_id = normalize_dnd_race_id(source.get("race"))
    class_id = normalize_dnd_class_id(source.get("class"))
    abilities = normalize_dnd_abilities(source.get("abilities"), play_mode=play_mode)

    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        level = _clamp_int(source.get("level"), 1, DND_MAX_LEVEL, 1)
        xp = _clamp_int(source.get("xp"), 0, DND_XP_THRESHOLDS[-1] * 4, 0)
    else:
        xp = _clamp_int(source.get("xp"), 0, DND_XP_THRESHOLDS[-1] * 4, 0)
        # In strict mode the level is derived from experience, never stored independently:
        # it is the one number a tampered payload could otherwise inflate for free.
        level = level_for_total_xp(xp)

    base_abilities = normalize_dnd_abilities(source.get("base_abilities") or abilities, play_mode=play_mode)
    asi_allocation = normalize_dnd_asi_allocation(source.get("asi_allocation"))
    if play_mode != STORY_DND_PLAY_MODE_SANDBOX:
        base_abilities = fit_base_abilities_to_point_buy(base_abilities)
        # In strict mode the working abilities are always *derived*, never stored: base score
        # from point buy, plus the racial bonus, plus the improvements actually earned. A
        # payload that claims 20s without paying for them simply gets recomputed away.
        allowed_asi = asi_points_earned_through_level(level)
        while sum(asi_allocation.values()) > allowed_asi and asi_allocation:
            worst = max(asi_allocation, key=lambda key: asi_allocation[key])
            asi_allocation[worst] -= 1
            if asi_allocation[worst] <= 0:
                asi_allocation.pop(worst)
        abilities = {
            ability_id: min(
                ABILITY_HARD_CAP,
                base_abilities.get(ability_id, DEFAULT_ABILITY_SCORE)
                + DND_RACE_BY_ID.get(race_id, DND_RACE_BY_ID[DEFAULT_RACE_ID]).bonuses.get(ability_id, 0)
                + asi_allocation.get(ability_id, 0),
            )
            for ability_id in ABILITY_IDS
        }
        computed_pending_asi = max(allowed_asi - sum(asi_allocation.values()), 0)
    else:
        computed_pending_asi = _clamp_int(source.get("pending_asi_points"), 0, 40, 0)

    skill_proficiencies = [
        skill_id
        for skill_id in (
            normalize_dnd_skill_id(item)
            for item in normalize_string_list(source.get("skill_proficiencies"), max_items=DND_MAX_SKILL_PROFICIENCIES)
        )
        if skill_id
    ][:DND_MAX_SKILL_PROFICIENCIES]
    if not skill_proficiencies:
        skill_proficiencies = list(DND_CLASS_BY_ID[class_id].skills)[:DND_MAX_SKILL_PROFICIENCIES]

    saving_throw_proficiencies = [
        ability_id
        for ability_id in (
            normalize_dnd_ability_id(item) for item in normalize_string_list(source.get("saving_throw_proficiencies"))
        )
        if ability_id
    ][:2]
    if not saving_throw_proficiencies:
        saving_throw_proficiencies = list(DND_CLASS_BY_ID[class_id].saving_throws)

    computed_max_hp = max_hit_points(class_id, abilities.get("con"), level)
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        raw_max = source.get("hp", {}).get("max") if isinstance(source.get("hp"), dict) else None
        computed_max_hp = _clamp_int(raw_max, 1, 9_999, computed_max_hp)
    hp = normalize_dnd_hp(source.get("hp"), max_hp=computed_max_hp)

    inventory = normalize_dnd_inventory(source.get("inventory"))
    if not inventory:
        inventory = default_inventory_for(class_id, race_id)
    inventory_note = normalize_text_value(source.get("inventory_note"), max_length=DND_INVENTORY_MAX_LENGTH)

    computed_ac = armor_class(class_id, abilities.get("dex"))
    if class_id == "monk":
        computed_ac = max(computed_ac, 10 + ability_modifier(abilities.get("dex")) + ability_modifier(abilities.get("wis")))
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        computed_ac = _clamp_int(source.get("armor_class"), 1, 40, computed_ac)

    speed = DND_RACE_BY_ID.get(race_id, DND_RACE_BY_ID[DEFAULT_RACE_ID]).speed
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        speed = _clamp_int(source.get("speed"), 0, 200, speed)

    return {
        "name": normalize_single_line(source.get("name"), max_length=80),
        "race": race_id,
        "class": class_id,
        "background": normalize_single_line(source.get("background"), max_length=80),
        "level": level,
        "xp": xp,
        "abilities": abilities,
        "base_abilities": base_abilities,
        "asi_allocation": asi_allocation,
        "skill_proficiencies": skill_proficiencies,
        "saving_throw_proficiencies": saving_throw_proficiencies,
        "hp": hp,
        "armor_class": computed_ac,
        "speed": speed,
        "proficiency_bonus": proficiency_bonus(level),
        "inventory": inventory,
        "inventory_note": inventory_note,
        "gold": _clamp_int(source.get("gold"), 0, 9_999_999, 0),
        "conditions": normalize_dnd_conditions(source.get("conditions")),
        "avatar_world_card_id": (
            int(source.get("avatar_world_card_id"))
            if str(source.get("avatar_world_card_id") or "").strip().lstrip("-").isdigit()
            and int(source.get("avatar_world_card_id")) > 0
            else None
        ),
        "pending_asi_points": computed_pending_asi,
    }


# How many in-game days a season lasts. Seasons are derived from the day counter rather than
# chosen by the service model, which is what makes "we stood still, so winter cannot arrive"
# a property of the data instead of a request the model might ignore.
DND_DAYS_PER_SEASON = 90


def normalize_dnd_environment(value: Any, *, locked: bool) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    season = normalize_dnd_season(source.get("season"))
    day = _clamp_int(source.get("day"), 1, 100_000, 1)
    return {
        "season": season,
        "season_started_day": _clamp_int(source.get("season_started_day"), 1, 100_000, day),
        "time_of_day": normalize_dnd_time_of_day(source.get("time_of_day")),
        "weather": normalize_dnd_weather(source.get("weather"), season=season),
        "weather_note": normalize_single_line(source.get("weather_note"), max_length=80),
        "day": day,
        "locked": bool(locked),
    }


def advance_environment_season(environment: dict[str, Any]) -> dict[str, Any]:
    """Roll the season forward for every full DND_DAYS_PER_SEASON the calendar has passed."""
    season = normalize_dnd_season(environment.get("season"))
    day = _clamp_int(environment.get("day"), 1, 100_000, 1)
    started = _clamp_int(environment.get("season_started_day"), 1, 100_000, day)
    if started > day:
        started = day
    season_index = DND_SEASON_IDS.index(season)
    while day - started >= DND_DAYS_PER_SEASON:
        started += DND_DAYS_PER_SEASON
        season_index = (season_index + 1) % len(DND_SEASON_IDS)
    environment["season"] = DND_SEASON_IDS[season_index]
    environment["season_started_day"] = started
    environment["weather"] = normalize_dnd_weather(environment.get("weather"), season=environment["season"])
    return environment


def normalize_dnd_npc(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    name = normalize_single_line(value.get("name"), max_length=80)
    if not name:
        return None
    level = _clamp_int(value.get("level"), 1, DND_MAX_LEVEL, 1)
    abilities = normalize_dnd_abilities(value.get("abilities"), play_mode=STORY_DND_PLAY_MODE_SANDBOX)
    raw_max_hp = value.get("hp", {}).get("max") if isinstance(value.get("hp"), dict) else None
    default_max_hp = max(4, 6 * level + ability_modifier(abilities.get("con")) * level)
    max_hp = _clamp_int(raw_max_hp, 1, 9_999, default_max_hp)
    relation_score = clamp_relation_score(value.get("relation_score"))
    explicit_relation = normalize_dnd_relation_id(value.get("relation")) if value.get("relation") else ""
    relation = explicit_relation or relation_id_for_score(relation_score)
    if explicit_relation and not str(value.get("relation_score") or "").strip().lstrip("-").isdigit():
        relation_score = DND_RELATION_SCORES.get(explicit_relation, 0)
    world_card_id = value.get("world_card_id")
    return {
        "key": normalize_single_line(value.get("key") or name, max_length=80).lower(),
        "world_card_id": (
            int(world_card_id)
            if str(world_card_id or "").strip().isdigit() and int(world_card_id) > 0
            else None
        ),
        "name": name,
        "role": normalize_single_line(value.get("role"), max_length=80),
        "relation": relation,
        "relation_score": relation_score,
        "relation_note": normalize_single_line(value.get("relation_note"), max_length=140),
        "level": level,
        "abilities": abilities,
        "hp": normalize_dnd_hp(value.get("hp"), max_hp=max_hp),
        "armor_class": _clamp_int(value.get("armor_class"), 1, 40, 10 + ability_modifier(abilities.get("dex"))),
        "conditions": normalize_dnd_conditions(value.get("conditions")),
        "is_active": bool(value.get("is_active", False)),
        "stats_source": "manual" if str(value.get("stats_source") or "") == "manual" else "ai",
        "notes": normalize_text_value(value.get("notes"), max_length=600),
    }


def normalize_dnd_quests(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        title = normalize_single_line(item.get("title"), max_length=120)
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        status = str(item.get("status") or "active").strip().lower()
        if status not in {"active", "done", "failed"}:
            status = "active"
        result.append(
            {
                "title": title,
                "detail": normalize_text_value(item.get("detail"), max_length=600),
                "status": status,
            }
        )
        if len(result) >= DND_MAX_QUESTS:
            break
    return result


def normalize_dnd_notes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, str):
            item = {"text": item}
        if not isinstance(item, dict):
            continue
        text = normalize_text_value(item.get("text"), max_length=500)
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        result.append({"text": text, "turn": _clamp_int(item.get("turn"), 0, 1_000_000, 0)})
        if len(result) >= DND_MAX_NOTES:
            break
    return result


def normalize_dnd_pending_check(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    prompt = normalize_text_value(value.get("prompt"), max_length=4_000)
    if not prompt:
        return None
    kind = normalize_dnd_check_kind(value.get("kind"))
    skill_id = normalize_dnd_skill_id(value.get("skill"))
    ability_id = normalize_dnd_ability_id(value.get("ability")) or DND_SKILL_ABILITY.get(skill_id, "")
    return {
        "id": normalize_single_line(value.get("id"), max_length=40) or secrets.token_hex(8),
        "prompt": prompt,
        "kind": kind,
        "skill": skill_id,
        "ability": ability_id,
        "die": normalize_dnd_die(value.get("die")),
        "dc": normalize_dnd_dc(value.get("dc")),
        "advantage": normalize_dnd_advantage(value.get("advantage")),
        "situational_modifier": _clamp_int(value.get("situational_modifier"), -5, 5, 0),
        "situational_label": normalize_single_line(value.get("situational_label"), max_length=60),
        "reason": normalize_single_line(value.get("reason"), max_length=200),
        "target": normalize_single_line(value.get("target"), max_length=80),
        "success_hint": normalize_single_line(value.get("success_hint"), max_length=200),
        "failure_hint": normalize_single_line(value.get("failure_hint"), max_length=200),
        "modifier_breakdown": [
            item for item in (value.get("modifier_breakdown") or []) if isinstance(item, dict)
        ],
    }


def normalize_dnd_last_roll(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if not str(value.get("outcome") or "").strip():
        return None
    return {
        "id": normalize_single_line(value.get("id"), max_length=40),
        "check": normalize_dnd_pending_check(value.get("check")),
        "die": normalize_dnd_die(value.get("die")),
        "rolls": [
            _clamp_int(item, 1, 100, 1)
            for item in (value.get("rolls") if isinstance(value.get("rolls"), list) else [])
        ][:2],
        "natural": _clamp_int(value.get("natural"), 1, 100, 1),
        "advantage": normalize_dnd_advantage(value.get("advantage")),
        "modifier_total": _clamp_int(value.get("modifier_total"), -50, 50, 0),
        "modifier_breakdown": [
            item for item in (value.get("modifier_breakdown") or []) if isinstance(item, dict)
        ],
        "total": _clamp_int(value.get("total"), -50, 200, 0),
        "dc": normalize_dnd_dc(value.get("dc")),
        "outcome": (
            str(value.get("outcome")).strip()
            if str(value.get("outcome")).strip() in DND_OUTCOME_LABELS
            else DND_OUTCOME_FAILURE
        ),
        "consumed": bool(value.get("consumed", False)),
    }


def normalize_dnd_state(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    play_mode = normalize_dnd_play_mode(source.get("play_mode"))
    turn_count = _clamp_int(source.get("turn_count"), 0, 10_000_000, 0)
    hero = normalize_dnd_hero(source.get("hero"), play_mode=play_mode)

    npcs: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    raw_npcs = source.get("npcs")
    if isinstance(raw_npcs, dict):
        raw_npcs = list(raw_npcs.values())
    if isinstance(raw_npcs, list):
        for item in raw_npcs:
            normalized = normalize_dnd_npc(item)
            if normalized is None or normalized["key"] in seen_keys:
                continue
            seen_keys.add(normalized["key"])
            npcs.append(normalized)
            if len(npcs) >= DND_MAX_NPCS:
                break

    return {
        "version": STORY_DND_STATE_VERSION,
        "play_mode": play_mode,
        "setup_completed": bool(source.get("setup_completed", False)),
        "turn_count": turn_count,
        "hero": hero,
        # Environment is player-editable only before the first turn, or in sandbox.
        "environment": normalize_dnd_environment(
            source.get("environment"),
            locked=bool(turn_count > 0 and play_mode != STORY_DND_PLAY_MODE_SANDBOX),
        ),
        "npcs": npcs,
        "quests": normalize_dnd_quests(source.get("quests")),
        "notes": normalize_dnd_notes(source.get("notes")),
        "pending_check": normalize_dnd_pending_check(source.get("pending_check")),
        "last_roll": normalize_dnd_last_roll(source.get("last_roll")),
        "last_level_up": normalize_dnd_level_up(source.get("last_level_up")),
    }


def normalize_dnd_level_up(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    to_level = normalize_dnd_level(value.get("to_level"))
    from_level = normalize_dnd_level(value.get("from_level"))
    if to_level <= from_level:
        return None
    return {
        "from_level": from_level,
        "to_level": to_level,
        "asi_points": _clamp_int(value.get("asi_points"), 0, 40, 0),
        "max_hp": _clamp_int(value.get("max_hp"), 1, 9_999, 1),
        "reason": normalize_single_line(value.get("reason"), max_length=160),
        "acknowledged": bool(value.get("acknowledged", False)),
    }


def create_default_dnd_state() -> dict[str, Any]:
    return normalize_dnd_state({})


def serialize_dnd_state(state: dict[str, Any]) -> str:
    try:
        return json.dumps(normalize_dnd_state(state), ensure_ascii=False)
    except (TypeError, ValueError):
        return json.dumps(create_default_dnd_state(), ensure_ascii=False)


def deserialize_dnd_state(raw_value: Any) -> dict[str, Any]:
    if isinstance(raw_value, dict):
        return normalize_dnd_state(raw_value)
    text = str(raw_value or "").strip()
    if not text:
        return create_default_dnd_state()
    try:
        loaded = json.loads(text)
    except (TypeError, ValueError):
        return create_default_dnd_state()
    return normalize_dnd_state(loaded)


def get_game_dnd_state(game: Any) -> dict[str, Any]:
    return deserialize_dnd_state(getattr(game, "dnd_state_payload", ""))


def set_game_dnd_state(game: Any, state: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_dnd_state(state)
    game.dnd_state_payload = json.dumps(normalized, ensure_ascii=False)
    return normalized


# --- Validation for player-authored sheets ---------------------------------------------------

@dataclass
class DndSheetValidation:
    ok: bool
    errors: list[str] = field(default_factory=list)
    point_buy_spent: int = 0
    point_buy_budget: int = POINT_BUY_BUDGET


def validate_hero_sheet(
    *,
    play_mode: str,
    race_id: str,
    class_id: str,
    base_abilities: dict[str, Any],
    level: int,
    spent_asi: dict[str, Any] | None = None,
) -> DndSheetValidation:
    """Reject a cheated sheet in strict mode; in sandbox only enforce the absolute bounds."""
    normalized_play_mode = normalize_dnd_play_mode(play_mode)
    errors: list[str] = []

    if normalized_play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        for ability_id in ABILITY_IDS:
            try:
                score = int(base_abilities.get(ability_id))
            except (TypeError, ValueError):
                errors.append(f"{ABILITY_LABELS[ability_id]}: значение должно быть числом")
                continue
            if not (SANDBOX_ABILITY_MIN <= score <= SANDBOX_ABILITY_MAX):
                errors.append(
                    f"{ABILITY_LABELS[ability_id]}: допустимо {SANDBOX_ABILITY_MIN}–{SANDBOX_ABILITY_MAX}"
                )
        return DndSheetValidation(ok=not errors, errors=errors, point_buy_spent=0)

    for ability_id in ABILITY_IDS:
        cost = point_buy_cost(base_abilities.get(ability_id))
        if cost is None:
            errors.append(
                f"{ABILITY_LABELS[ability_id]}: в режиме игры базовое значение только "
                f"{POINT_BUY_MIN}–{POINT_BUY_MAX} (закупка очков D&D 5e)"
            )
    spent = point_buy_total_cost(base_abilities)
    if spent is None:
        return DndSheetValidation(ok=False, errors=errors or ["Некорректные характеристики"], point_buy_spent=0)
    if spent > POINT_BUY_BUDGET:
        errors.append(f"Потрачено {spent} очков из {POINT_BUY_BUDGET} — уберите лишнее")

    normalized_level = normalize_dnd_level(level)
    available_asi = asi_points_earned_through_level(normalized_level)
    used_asi = 0
    if spent_asi:
        for ability_id, raw_points in spent_asi.items():
            if normalize_dnd_ability_id(ability_id) not in ABILITY_IDS:
                continue
            try:
                used_asi += max(int(raw_points), 0)
            except (TypeError, ValueError):
                continue
    if used_asi > available_asi:
        errors.append(
            f"Очков повышения характеристик доступно {available_asi}, распределено {used_asi}"
        )

    race = DND_RACE_BY_ID.get(normalize_dnd_race_id(race_id), DND_RACE_BY_ID[DEFAULT_RACE_ID])
    for ability_id in ABILITY_IDS:
        base = point_buy_cost(base_abilities.get(ability_id))
        if base is None:
            continue
        total = int(base_abilities.get(ability_id)) + race.bonuses.get(ability_id, 0)
        total += max(int((spent_asi or {}).get(ability_id, 0) or 0), 0)
        if total > ABILITY_HARD_CAP:
            errors.append(
                f"{ABILITY_LABELS[ability_id]}: итог {total} выше предела {ABILITY_HARD_CAP}"
            )

    _ = normalize_dnd_class_id(class_id)
    return DndSheetValidation(ok=not errors, errors=errors, point_buy_spent=spent)


def apply_race_bonuses(base_abilities: dict[str, Any], race_id: str, spent_asi: dict[str, Any] | None = None) -> dict[str, int]:
    race = DND_RACE_BY_ID.get(normalize_dnd_race_id(race_id), DND_RACE_BY_ID[DEFAULT_RACE_ID])
    result: dict[str, int] = {}
    for ability_id in ABILITY_IDS:
        try:
            base = int(base_abilities.get(ability_id, DEFAULT_ABILITY_SCORE))
        except (TypeError, ValueError):
            base = DEFAULT_ABILITY_SCORE
        bonus = race.bonuses.get(ability_id, 0)
        asi = 0
        if spent_asi:
            try:
                asi = max(int(spent_asi.get(ability_id, 0) or 0), 0)
            except (TypeError, ValueError):
                asi = 0
        result[ability_id] = base + bonus + asi
    return result


# --- Experience and levelling -------------------------------------------------------------

def award_experience(state: dict[str, Any], bucket: Any, *, reason: str = "") -> dict[str, Any]:
    """Add one turn's XP and, if it crosses a threshold, record the pending level-up.

    The level itself always follows from total XP, so an interrupted turn can never leave a
    character levelled but unpaid for, or paid for but not levelled.
    """
    normalized_bucket = str(bucket or "none").strip().lower()
    gained = DND_XP_AWARD_BUCKETS.get(normalized_bucket)
    if gained is None:
        gained = 0
    gained = max(0, min(int(gained), DND_XP_MAX_PER_TURN))
    if gained <= 0:
        return state

    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    previous_level = normalize_dnd_level(hero.get("level"))
    previous_xp = max(int(hero.get("xp") or 0), 0)
    next_xp = previous_xp + gained
    hero["xp"] = next_xp

    if normalize_dnd_play_mode(state.get("play_mode")) == STORY_DND_PLAY_MODE_SANDBOX:
        # Sandbox keeps the level under the player's control, so XP is only a counter there.
        state["hero"] = hero
        return state

    next_level = level_for_total_xp(next_xp)
    if next_level > previous_level:
        hero["level"] = next_level
        hero["proficiency_bonus"] = proficiency_bonus(next_level)
        gained_asi = sum(
            DND_ASI_POINTS
            for asi_level in DND_ASI_LEVELS
            if previous_level < asi_level <= next_level
        )
        hero["pending_asi_points"] = max(int(hero.get("pending_asi_points") or 0), 0) + gained_asi
        abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
        new_max_hp = max_hit_points(hero.get("class"), abilities.get("con"), next_level)
        current_hp = hero.get("hp") if isinstance(hero.get("hp"), dict) else {}
        previous_max = max(int(current_hp.get("max") or 1), 1)
        healed = max(0, new_max_hp - previous_max)
        hero["hp"] = {
            "current": min(new_max_hp, max(int(current_hp.get("current") or 0), 0) + healed),
            "max": new_max_hp,
            "temp": max(int(current_hp.get("temp") or 0), 0),
        }
        state["last_level_up"] = {
            "from_level": previous_level,
            "to_level": next_level,
            "asi_points": gained_asi,
            "max_hp": new_max_hp,
            "reason": normalize_single_line(reason, max_length=160),
        }
    state["hero"] = hero
    return state


# --- Prompt-facing summary -------------------------------------------------------------------

def describe_environment(state: dict[str, Any]) -> str:
    environment = state.get("environment") if isinstance(state.get("environment"), dict) else {}
    season = DND_SEASON_LABELS.get(normalize_dnd_season(environment.get("season")), "")
    time_of_day = DND_TIME_LABELS.get(normalize_dnd_time_of_day(environment.get("time_of_day")), "")
    weather = DND_WEATHER_LABELS.get(normalize_dnd_weather(environment.get("weather")), "")
    day = max(int(environment.get("day") or 1), 1)
    note = normalize_single_line(environment.get("weather_note"), max_length=80)
    parts = [part for part in (season, time_of_day, weather) if part]
    line = ", ".join(parts)
    if note:
        line = f"{line} ({note})" if line else note
    return f"День {day}. {line}".strip()


def describe_hero_for_prompt(state: dict[str, Any]) -> str:
    """The character sheet as the narrator sees it. Compact on purpose: this rides along on
    every single turn, so every line here is paid for in context tokens."""
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
    race = DND_RACE_BY_ID.get(normalize_dnd_race_id(hero.get("race")), DND_RACE_BY_ID[DEFAULT_RACE_ID])
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(hero.get("class")), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    level = normalize_dnd_level(hero.get("level"))
    hp = hero.get("hp") if isinstance(hero.get("hp"), dict) else {}
    ability_line = " ".join(
        f"{ABILITY_SHORT_LABELS[ability_id]} {abilities.get(ability_id, DEFAULT_ABILITY_SCORE)}"
        f"({format_modifier(ability_modifier(abilities.get(ability_id)))})"
        for ability_id in ABILITY_IDS
    )
    lines = [
        f"Имя: {hero.get('name') or 'герой'}; {race.label} {dnd_class.label}, уровень {level}.",
        f"Характеристики: {ability_line}.",
        f"Хиты: {hp.get('current', 0)}/{hp.get('max', 0)}"
        + (f" (+{hp.get('temp')} врем.)" if int(hp.get("temp") or 0) > 0 else "")
        + f"; КД {hero.get('armor_class')}; бонус мастерства {format_modifier(hero.get('proficiency_bonus') or 2)}; скорость {hero.get('speed')} футов.",
    ]
    skills = [DND_SKILL_LABELS.get(skill_id, skill_id) for skill_id in (hero.get("skill_proficiencies") or [])]
    if skills:
        lines.append("Владение навыками: " + ", ".join(skills) + ".")
    inventory = hero.get("inventory") or []
    if inventory:
        lines.append("Инвентарь: " + ", ".join(inventory) + ".")
    note = normalize_text_value(hero.get("inventory_note"), max_length=600)
    if note:
        lines.append("Особое снаряжение: " + note)
    conditions = hero.get("conditions") or []
    if conditions:
        lines.append(
            "Состояния: "
            + ", ".join(
                f"{item.get('label')}" + (f" — {item.get('note')}" if item.get("note") else "")
                for item in conditions
                if isinstance(item, dict)
            )
            + "."
        )
    return "\n".join(lines)


def describe_npcs_for_prompt(state: dict[str, Any], *, only_active: bool = False, limit: int = 12) -> str:
    npcs = state.get("npcs") if isinstance(state.get("npcs"), list) else []
    selected = [npc for npc in npcs if isinstance(npc, dict) and (not only_active or npc.get("is_active"))]
    if not selected:
        return ""
    lines: list[str] = []
    for npc in selected[:limit]:
        hp = npc.get("hp") if isinstance(npc.get("hp"), dict) else {}
        relation_label = DND_RELATION_LABELS.get(normalize_dnd_relation_id(npc.get("relation")), "")
        role = npc.get("role")
        line = (
            f"- {npc.get('name')}"
            + (f" ({role})" if role else "")
            + f": уровень {npc.get('level')}, хиты {hp.get('current', 0)}/{hp.get('max', 0)},"
            f" отношение к герою — {relation_label}"
        )
        if npc.get("relation_note"):
            line += f" ({npc.get('relation_note')})"
        lines.append(line + ".")
    return "\n".join(lines)


def describe_quests_for_prompt(state: dict[str, Any]) -> str:
    quests = [
        quest
        for quest in (state.get("quests") if isinstance(state.get("quests"), list) else [])
        if isinstance(quest, dict) and quest.get("status") == "active"
    ]
    if not quests:
        return ""
    return "\n".join(
        f"- {quest.get('title')}" + (f": {quest.get('detail')}" if quest.get("detail") else "")
        for quest in quests[:DND_MAX_QUESTS]
    )


def describe_roll_for_prompt(roll: dict[str, Any] | None) -> str:
    """The line that makes the narrator honour the dice instead of inventing an outcome."""
    if not isinstance(roll, dict):
        return ""
    check = roll.get("check") if isinstance(roll.get("check"), dict) else {}
    outcome = str(roll.get("outcome") or "")
    outcome_label = DND_OUTCOME_LABELS.get(outcome, "")
    skill_id = normalize_dnd_skill_id(check.get("skill"))
    ability_id = normalize_dnd_ability_id(check.get("ability"))
    subject = DND_SKILL_LABELS.get(skill_id) or ABILITY_LABELS.get(ability_id) or "проверка"
    kind = normalize_dnd_check_kind(check.get("kind"))
    kind_label = {
        DND_CHECK_KIND_SKILL: "Проверка навыка",
        DND_CHECK_KIND_ABILITY: "Проверка характеристики",
        DND_CHECK_KIND_SAVE: "Спасбросок",
        DND_CHECK_KIND_ATTACK: "Бросок атаки",
    }.get(kind, "Проверка")
    modifier_total = int(roll.get("modifier_total") or 0)
    lines = [
        f"{kind_label}: {subject}. Сложность (СЛ) {roll.get('dc')}.",
        f"Бросок d{roll.get('die')}: выпало {roll.get('natural')}"
        + (f" (преимущество, броски {roll.get('rolls')})" if roll.get("advantage") == DND_ADVANTAGE_ADVANTAGE else "")
        + (f" (помеха, броски {roll.get('rolls')})" if roll.get("advantage") == DND_ADVANTAGE_DISADVANTAGE else "")
        + f", модификаторы {format_modifier(modifier_total)}, итог {roll.get('total')}.",
        f"РЕЗУЛЬТАТ: {outcome_label}.",
    ]
    if outcome == DND_OUTCOME_CRITICAL_SUCCESS:
        lines.append("Опиши исход как выдающийся успех с дополнительной выгодой сверх задуманного.")
    elif outcome == DND_OUTCOME_SUCCESS:
        lines.append("Опиши исход как успех: задуманное получилось.")
    elif outcome == DND_OUTCOME_FAILURE:
        lines.append("Опиши исход как неудачу: задуманное не вышло, но сцена движется дальше.")
    else:
        lines.append("Опиши исход как критический провал: неудача плюс осложнение или урон.")
    if check.get("success_hint") and outcome in {DND_OUTCOME_SUCCESS, DND_OUTCOME_CRITICAL_SUCCESS}:
        lines.append(f"Ориентир исхода: {check.get('success_hint')}")
    if check.get("failure_hint") and outcome in {DND_OUTCOME_FAILURE, DND_OUTCOME_CRITICAL_FAILURE}:
        lines.append(f"Ориентир исхода: {check.get('failure_hint')}")
    return "\n".join(lines)


DND_NARRATOR_RULES = (
    "Ты ведёшь партию по правилам Dungeons & Dragons 5-й редакции как Мастер (DM).\n"
    "- Описывай последствия честно по механике: успех значит успех, провал значит провал.\n"
    "- Никогда не бросай кубики в тексте и не выдумывай числа бросков: результат проверки "
    "приходит тебе отдельным блоком РЕЗУЛЬТАТ БРОСКА, и он обязателен к исполнению.\n"
    "- Не меняй самовольно характеристики, хиты, уровень, опыт и инвентарь героя: ты описываешь "
    "события, а числовое состояние пересчитывает система после хода.\n"
    "- Урон, лечение, находки и потери описывай словами и конкретно (например «удар рассекает плечо», "
    "«ты подбираешь связку ключей»), чтобы система могла их учесть.\n"
    "- Соблюдай текущее время суток, сезон и погоду: они меняются постепенно и только вместе с "
    "течением игрового времени.\n"
    "- У важных NPC есть отношение к герою; веди их реплики и поступки в согласии с ним.\n"
    "- Не превращай сцену в таблицу: правила работают под текстом, а игрок читает живую прозу."
)


def build_dnd_instruction_card(
    state: dict[str, Any],
    *,
    roll: dict[str, Any] | None = None,
    location_label: str = "",
) -> dict[str, str]:
    """The single system card that carries the whole D&D layer into the narrator prompt."""
    sections: list[str] = [DND_NARRATOR_RULES, "", "ЛИСТ ПЕРСОНАЖА:", describe_hero_for_prompt(state)]
    environment_line = describe_environment(state)
    if environment_line:
        sections.extend(["", "ВРЕМЯ И ПОГОДА: " + environment_line])
    if location_label:
        sections.append("МЕСТО: " + location_label)
    active_npcs = describe_npcs_for_prompt(state, only_active=True, limit=6)
    if active_npcs:
        sections.extend(["", "NPC В СЦЕНЕ:", active_npcs])
    known_npcs = describe_npcs_for_prompt(state, only_active=False, limit=12)
    if known_npcs and known_npcs != active_npcs:
        sections.extend(["", "ЗНАКОМЫЕ ПЕРСОНАЖИ:", known_npcs])
    quests = describe_quests_for_prompt(state)
    if quests:
        sections.extend(["", "АКТИВНЫЕ ЗАДАНИЯ:", quests])
    roll_block = describe_roll_for_prompt(roll)
    if roll_block:
        sections.extend(["", "РЕЗУЛЬТАТ БРОСКА (ОБЯЗАТЕЛЕН К ИСПОЛНЕНИЮ):", roll_block])
    return {
        "title": "Режим D&D 5e",
        "content": "\n".join(sections).strip(),
        "source_kind": "dnd",
    }


# --- Catalogue for the client ------------------------------------------------------------------

def build_dnd_catalog() -> dict[str, Any]:
    """Static rules data the UI needs: races, classes, skills, conditions, tables."""
    return {
        "abilities": [
            {"id": ability_id, "label": ABILITY_LABELS[ability_id], "short": ABILITY_SHORT_LABELS[ability_id]}
            for ability_id in ABILITY_IDS
        ],
        "races": [
            {
                "id": race.id,
                "label": race.label,
                "bonuses": race.bonuses,
                "speed": race.speed,
                "traits": list(race.traits),
            }
            for race in DND_RACES
        ],
        "classes": [
            {
                "id": item.id,
                "label": item.label,
                "hit_die": item.hit_die,
                "primary": list(item.primary),
                "saving_throws": list(item.saving_throws),
                "skills": list(item.skills),
                "starting_inventory": list(item.starting_inventory),
            }
            for item in DND_CLASSES
        ],
        "skills": [
            {"id": skill_id, "label": label, "ability": ability}
            for skill_id, label, ability in DND_SKILLS
        ],
        "conditions": [
            {
                "id": item.id,
                "label": item.label,
                "kind": item.kind,
                "icon": item.icon,
                "description": item.description,
            }
            for item in DND_CONDITIONS
        ],
        "relations": [
            {"id": relation_id, "label": label, "score": DND_RELATION_SCORES[relation_id]}
            for relation_id, label in DND_RELATION_LABELS.items()
        ],
        "seasons": [{"id": season_id, "label": label} for season_id, label in DND_SEASONS],
        "times_of_day": [{"id": time_id, "label": label} for time_id, label in DND_TIMES_OF_DAY],
        "weathers": [{"id": weather_id, "label": label} for weather_id, label in DND_WEATHERS],
        "season_weather": {season: sorted(values) for season, values in DND_SEASON_WEATHER_ALLOWED.items()},
        "point_buy": {
            "budget": POINT_BUY_BUDGET,
            "min": POINT_BUY_MIN,
            "max": POINT_BUY_MAX,
            "cost": POINT_BUY_COST,
            "hard_cap": ABILITY_HARD_CAP,
        },
        "sandbox": {"min": SANDBOX_ABILITY_MIN, "max": SANDBOX_ABILITY_MAX},
        "xp_thresholds": list(DND_XP_THRESHOLDS),
        "xp_buckets": dict(DND_XP_AWARD_BUCKETS),
        "asi_levels": list(DND_ASI_LEVELS),
        "max_level": DND_MAX_LEVEL,
        "dice": list(DND_DICE_SIDES),
        "dc_labels": [{"value": value, "label": label} for value, label in DND_DC_LABELS],
        "outcomes": dict(DND_OUTCOME_LABELS),
    }
