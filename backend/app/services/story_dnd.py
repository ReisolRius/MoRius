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


# --- Roll policy -------------------------------------------------------------------------

# How readily the table reaches for dice. This is a taste setting, not a difficulty one: the
# DCs and the maths are identical either way, what changes is how much of the fiction gets
# resolved by a die instead of by the Master reading the room.
#
# ``story``  -- the default. A first attempt at talking to somebody is *played*, not rolled:
#               the narrator answers from that NPC's character and their relationship to the
#               hero. The dice come out when the player pushes against a refusal, when the
#               action is physically risky, or when failure would actually cost something.
# ``strict`` -- closer to a rules-lawyer table. Almost any contested action is a check.
STORY_DND_ROLL_POLICY_STORY = "story"
STORY_DND_ROLL_POLICY_STRICT = "strict"
STORY_DND_ROLL_POLICIES = (STORY_DND_ROLL_POLICY_STORY, STORY_DND_ROLL_POLICY_STRICT)
DEFAULT_DND_ROLL_POLICY = STORY_DND_ROLL_POLICY_STORY

DND_ROLL_POLICY_LABELS: dict[str, str] = {
    STORY_DND_ROLL_POLICY_STORY: "Живой отыгрыш",
    STORY_DND_ROLL_POLICY_STRICT: "Жёсткие правила",
}


def normalize_dnd_roll_policy(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_DND_ROLL_POLICIES:
        return normalized
    # A boolean toggle in the UI: "жёсткие правила включены" is the strict end.
    if normalized in {"true", "1", "hard", "hardcore", "rules", "жёсткие", "жесткие"}:
        return STORY_DND_ROLL_POLICY_STRICT
    return DEFAULT_DND_ROLL_POLICY


# --- Difficulty ---------------------------------------------------------------------------

# A single dial over the whole table. `dc_shift` moves every difficulty the master sets;
# `hero_bonus` is a flat modifier on the hero's own d20. Two knobs rather than one because
# lowering a DC and helping the hero feel different at the table: the first makes the world
# gentler, the second makes the character better, and easy mode wants a bit of both.
STORY_DND_DIFFICULTY_EASY = "easy"
STORY_DND_DIFFICULTY_NORMAL = "normal"
STORY_DND_DIFFICULTY_HARD = "hard"
STORY_DND_DIFFICULTY_DEADLY = "deadly"
STORY_DND_DIFFICULTIES = (
    STORY_DND_DIFFICULTY_EASY,
    STORY_DND_DIFFICULTY_NORMAL,
    STORY_DND_DIFFICULTY_HARD,
    STORY_DND_DIFFICULTY_DEADLY,
)
DEFAULT_DND_DIFFICULTY = STORY_DND_DIFFICULTY_NORMAL

# (label, dc shift, hero bonus, short description)
DND_DIFFICULTY_TABLE: dict[str, tuple[str, int, int, str]] = {
    STORY_DND_DIFFICULTY_EASY: ("Лёгкая", -3, 2, "Мир снисходителен, герой везучий."),
    STORY_DND_DIFFICULTY_NORMAL: ("Обычная", 0, 0, "Чистые правила 5e без поправок."),
    STORY_DND_DIFFICULTY_HARD: ("Сложная", 3, 0, "Мир требователен, ошибки стоят дорого."),
    STORY_DND_DIFFICULTY_DEADLY: ("Смертельная", 5, -1, "Выживание не подразумевается."),
}


def normalize_dnd_difficulty(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_DND_DIFFICULTIES:
        return normalized
    aliases = {
        "лёгкая": STORY_DND_DIFFICULTY_EASY,
        "легкая": STORY_DND_DIFFICULTY_EASY,
        "story": STORY_DND_DIFFICULTY_EASY,
        "обычная": STORY_DND_DIFFICULTY_NORMAL,
        "medium": STORY_DND_DIFFICULTY_NORMAL,
        "сложная": STORY_DND_DIFFICULTY_HARD,
        "смертельная": STORY_DND_DIFFICULTY_DEADLY,
        "nightmare": STORY_DND_DIFFICULTY_DEADLY,
    }
    return aliases.get(normalized, DEFAULT_DND_DIFFICULTY)


def difficulty_dc_shift(value: Any) -> int:
    return DND_DIFFICULTY_TABLE[normalize_dnd_difficulty(value)][1]


def difficulty_hero_bonus(value: Any) -> int:
    return DND_DIFFICULTY_TABLE[normalize_dnd_difficulty(value)][2]


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

# How many skill proficiencies a character may hold at a given level. The class kit is the
# floor; one extra slot opens at each of DND_SKILL_SLOT_LEVELS. This is what makes the sheet
# lock meaningful: after the first turn a player can only *fill* the slots a level has
# actually granted, never re-pick the ones already spent.
DND_SKILL_SLOT_LEVELS: tuple[int, ...] = (5, 10, 15, 20)
DND_MIN_SKILL_SLOTS = 2


DND_BACKGROUND_SKILL_SLOTS = 2


def skill_slots_for_level(class_id: Any, level: Any, background_id: Any = "") -> int:
    """Class kit + the two a background grants + one per DND_SKILL_SLOT_LEVELS threshold."""
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    normalized_level = normalize_dnd_level(level)
    earned = sum(1 for threshold in DND_SKILL_SLOT_LEVELS if normalized_level >= threshold)
    base = max(DND_MIN_SKILL_SLOTS, len(dnd_class.skills))
    if normalize_dnd_background_id(background_id):
        base += DND_BACKGROUND_SKILL_SLOTS
    return max(DND_MIN_SKILL_SLOTS, min(DND_MAX_SKILL_PROFICIENCIES, base + earned))


# --- Backgrounds --------------------------------------------------------------------------

@dataclass(frozen=True)
class DndBackground:
    id: str
    label: str
    summary: str
    skills: tuple[str, ...]


# Templates, not a rules table: the player may still type anything they like. They exist
# because "Предыстория" on an empty field means nothing to someone who has never opened a
# Player's Handbook, and a one-line summary is enough for the narrator to work with.
DND_BACKGROUNDS: tuple[DndBackground, ...] = (
    DndBackground("acolyte", "Служитель", "Вырос при храме: знает обряды, имеет связи среди духовенства.", ("insight", "religion")),
    DndBackground("criminal", "Преступник", "Жил с изнанки закона: контакты в подполье, чутьё на слежку.", ("deception", "stealth")),
    DndBackground("folk_hero", "Народный герой", "Простолюдин, однажды вставший против сильного. Простой люд помогает.", ("animal_handling", "survival")),
    DndBackground("noble", "Аристократ", "Имя, титул и привычка, что двери открываются сами.", ("history", "persuasion")),
    DndBackground("sage", "Мудрец", "Годы в библиотеках: знает, где искать ответ на любой вопрос.", ("arcana", "history")),
    DndBackground("soldier", "Солдат", "Служил в войске: звание, шрамы и въевшаяся дисциплина.", ("athletics", "intimidation")),
    DndBackground("charlatan", "Шарлатан", "Живёт обманом: фальшивые бумаги, чужие имена, верная улыбка.", ("deception", "sleight_of_hand")),
    DndBackground("entertainer", "Артист", "Сцена, толпа и умение держать внимание зала.", ("acrobatics", "performance")),
    DndBackground("guild_artisan", "Ремесленник", "Член гильдии: мастерство, репутация и деловые связи.", ("insight", "persuasion")),
    DndBackground("hermit", "Отшельник", "Годы в уединении ради одного открытия, о котором никто не знает.", ("medicine", "religion")),
    DndBackground("outlander", "Чужеземец", "Вырос вдали от городов: читает следы и не теряется в глуши.", ("athletics", "survival")),
    DndBackground("sailor", "Моряк", "Палуба, канаты и порты, где вас ещё помнят.", ("athletics", "perception")),
    DndBackground("urchin", "Беспризорник", "Вырос на улице: знает город снизу и умеет исчезать.", ("sleight_of_hand", "stealth")),
    DndBackground("investigator", "Дознаватель", "Учился читать людей и сцены преступлений.", ("investigation", "insight")),
    DndBackground("mercenary", "Наёмник", "Воевал за деньги: цену контракта знает лучше цены жизни.", ("athletics", "persuasion")),
    DndBackground("exile", "Изгнанник", "Когда-то был кем-то. Родина закрыта, прошлое тянется следом.", ("deception", "survival")),
)
DND_BACKGROUND_BY_ID: dict[str, DndBackground] = {item.id: item for item in DND_BACKGROUNDS}


def normalize_dnd_background_id(value: Any) -> str:
    """Map a background to a template id, or "" for free text the player typed themselves."""
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in DND_BACKGROUND_BY_ID:
        return normalized
    lowered = str(value or "").strip().lower()
    for item in DND_BACKGROUNDS:
        if item.label.lower() == lowered:
            return item.id
    return ""


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


# Classes whose kit is built around finesse or ranged weapons. For them an attack is a DEX
# roll whenever DEX is the better score -- which is why a rogue with a shortsword swings with
# Ловкость 16 (+3) and not Сила 12 (+1). The model used to pick this, and picked wrong.
DND_FINESSE_CLASSES: frozenset[str] = frozenset({"rogue", "monk", "ranger", "bard"})


def attack_ability_for_hero(hero: dict[str, Any]) -> str:
    """Which ability the hero's attacks key off.

    Faithful enough to 5e for a text game: a finesse-minded class uses the better of STR and
    DEX, a class whose primary ability is DEX uses DEX, and everyone else swings with STR.
    Spellcasters attacking with their casting stat is handled by the caster classes' primary.
    """
    abilities = hero.get("abilities") if isinstance(hero.get("abilities"), dict) else {}
    class_id = normalize_dnd_class_id(hero.get("class"))
    dnd_class = DND_CLASS_BY_ID.get(class_id, DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    strength_mod = ability_modifier(abilities.get("str"))
    dexterity_mod = ability_modifier(abilities.get("dex"))
    if class_id in DND_FINESSE_CLASSES or "dex" in dnd_class.primary:
        return "dex" if dexterity_mod >= strength_mod else "str"
    return "str"


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

# How many turns a condition may survive without the narrator mentioning it again. Being
# grappled is something that happens *in a moment*; the model that put it on the sheet is the
# same model that has to remember to take it off, and when it forgets the player is left
# "Опутан" three scenes after the hand let go. These budgets are the backstop: the fiction can
# always re-apply a condition next turn, but nothing physical lasts forever by accident.
#
# Conditions absent from this table (exhaustion, wounded, well_fed) are slow by nature and
# persist until something in the story changes them.
DND_CONDITION_TURN_BUDGET: dict[str, int] = {
    "grappled": 2,
    "restrained": 2,
    "prone": 1,
    "stunned": 1,
    "incapacitated": 2,
    "paralyzed": 2,
    "frightened": 3,
    "charmed": 3,
    "blinded": 3,
    "deafened": 3,
    "poisoned": 5,
    "petrified": 5,
    "unconscious": 8,
    "hidden": 2,
    "shielded": 1,
    "hasted": 2,
    "raging": 3,
    "inspired": 4,
    "blessed": 4,
}


def expire_dnd_conditions(conditions: Any, *, current_turn: int) -> tuple[list[dict[str, Any]], list[str]]:
    """Drop every volatile condition whose budget has run out. Returns (kept, expired ids)."""
    kept: list[dict[str, Any]] = []
    expired: list[str] = []
    for item in normalize_dnd_conditions(conditions):
        condition_id = normalize_dnd_condition_id(item.get("id"))
        budget = DND_CONDITION_TURN_BUDGET.get(condition_id)
        applied_turn = _clamp_int(item.get("turn"), 0, 10_000_000, 0)
        if budget is not None and applied_turn and int(current_turn) - applied_turn >= budget:
            expired.append(condition_id)
            continue
        kept.append(item)
    return kept, expired


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
# (id, label, canonical score, lower bound of the band)
#
# The canonical score is what picking a label by hand sets. The lower bound is what turns a
# score back into a label, and the two are deliberately different: with a single number the
# bands came out lopsided, so a single point of annoyance (-1) already read "Настороженное"
# while a whole scene of goodwill (+30) was still "Нейтральное". Neutral now spans -15..+15,
# which is what makes a relationship look like it is holding steady rather than flickering.
DND_RELATIONS: tuple[tuple[str, str, int, int], ...] = (
    ("hostile", "Враждебное", -80, -100),
    ("hateful", "Ненависть", -60, -70),
    ("wary", "Настороженное", -30, -40),
    ("neutral", "Нейтральное", 0, -15),
    ("friendly", "Дружеское", 35, 16),
    ("loyal", "Преданное", 60, 50),
    ("devoted", "Обожание", 75, 70),
    ("in_love", "Влюблена", 90, 86),
)
DND_RELATION_IDS = tuple(item[0] for item in DND_RELATIONS)
DND_RELATION_LABELS = {item[0]: item[1] for item in DND_RELATIONS}
DND_RELATION_SCORES = {item[0]: item[2] for item in DND_RELATIONS}
DND_RELATION_THRESHOLDS = {item[0]: item[3] for item in DND_RELATIONS}
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
    for relation_id, _label, _canonical, threshold in DND_RELATIONS:
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
DND_CHECK_KIND_DEATH_SAVE = "death_save"
DND_CHECK_KIND_INITIATIVE = "initiative"
DND_CHECK_KINDS = (
    DND_CHECK_KIND_ABILITY,
    DND_CHECK_KIND_SKILL,
    DND_CHECK_KIND_SAVE,
    DND_CHECK_KIND_ATTACK,
    DND_CHECK_KIND_DEATH_SAVE,
    DND_CHECK_KIND_INITIATIVE,
)


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
        "death": DND_CHECK_KIND_DEATH_SAVE,
        "deathsave": DND_CHECK_KIND_DEATH_SAVE,
        "смерть": DND_CHECK_KIND_DEATH_SAVE,
        "инициатива": DND_CHECK_KIND_INITIATIVE,
    }
    return aliases.get(normalized, DND_CHECK_KIND_SKILL)


# --- Death and dying ------------------------------------------------------------------------

# 5e as written: at 0 hit points the character is unconscious and rolls a DC 10 save each of
# their turns. Three successes stabilise, three failures kill, a natural 20 puts them back on
# their feet with one hit point and a natural 1 counts double.
DND_DEATH_SAVE_DC = 10
DND_DEATH_SAVE_SUCCESSES_TO_STABILIZE = 3
DND_DEATH_SAVE_FAILURES_TO_DIE = 3

DND_LIFE_STATE_ALIVE = "alive"
DND_LIFE_STATE_DYING = "dying"
DND_LIFE_STATE_STABLE = "stable"
DND_LIFE_STATE_DEAD = "dead"
DND_LIFE_STATE_LABELS: dict[str, str] = {
    DND_LIFE_STATE_ALIVE: "В сознании",
    DND_LIFE_STATE_DYING: "При смерти",
    DND_LIFE_STATE_STABLE: "Без сознания, стабилен",
    DND_LIFE_STATE_DEAD: "Мёртв",
}


def normalize_dnd_death_saves(value: Any) -> dict[str, int]:
    source = value if isinstance(value, dict) else {}
    return {
        "successes": _clamp_int(source.get("successes"), 0, DND_DEATH_SAVE_SUCCESSES_TO_STABILIZE, 0),
        "failures": _clamp_int(source.get("failures"), 0, DND_DEATH_SAVE_FAILURES_TO_DIE, 0),
    }


def resolve_life_state(*, hp_current: Any, death_saves: dict[str, Any], is_dead: Any) -> str:
    """The single source of truth for "is the hero up, down or gone".

    Derived rather than stored, for the same reason ability scores are: a life state that can
    be written independently of the hit points is a life state that can drift out of step with
    them, and "dead with 12 hit points" must not be representable.
    """
    saves = normalize_dnd_death_saves(death_saves)
    if bool(is_dead) or saves["failures"] >= DND_DEATH_SAVE_FAILURES_TO_DIE:
        return DND_LIFE_STATE_DEAD
    if _clamp_int(hp_current, 0, 99_999, 0) > 0:
        return DND_LIFE_STATE_ALIVE
    if saves["successes"] >= DND_DEATH_SAVE_SUCCESSES_TO_STABILIZE:
        return DND_LIFE_STATE_STABLE
    return DND_LIFE_STATE_DYING


def apply_death_save_roll(hero: dict[str, Any], *, natural: int, total: int) -> dict[str, Any]:
    """Fold one death saving throw into the hero. Returns a small summary for the client."""
    saves = normalize_dnd_death_saves(hero.get("death_saves"))
    hp = hero.get("hp") if isinstance(hero.get("hp"), dict) else {}
    revived = False
    if int(natural) == DND_DEFAULT_DIE:
        # A natural 20 is the rulebook's own rescue clause: back up with a single hit point.
        saves = {"successes": 0, "failures": 0}
        hp["current"] = 1
        hero["hp"] = hp
        revived = True
    elif int(natural) == 1:
        saves["failures"] = min(DND_DEATH_SAVE_FAILURES_TO_DIE, saves["failures"] + 2)
    elif int(total) >= DND_DEATH_SAVE_DC:
        saves["successes"] = min(DND_DEATH_SAVE_SUCCESSES_TO_STABILIZE, saves["successes"] + 1)
    else:
        saves["failures"] = min(DND_DEATH_SAVE_FAILURES_TO_DIE, saves["failures"] + 1)
    hero["death_saves"] = saves
    if saves["failures"] >= DND_DEATH_SAVE_FAILURES_TO_DIE:
        hero["is_dead"] = True
    life_state = resolve_life_state(
        hp_current=(hero.get("hp") or {}).get("current"),
        death_saves=saves,
        is_dead=hero.get("is_dead"),
    )
    hero["life_state"] = life_state
    return {"revived": revived, "death_saves": saves, "life_state": life_state}


# A d20 roll only crits on a natural 20/1. Smaller dice have no crit range in 5e, so a d6
# "luck" roll is graded purely against its DC.
def resolve_check_outcome(*, die: int, natural: int, total: int, dc: int) -> str:
    if die == DND_DEFAULT_DIE:
        if natural == DND_DEFAULT_DIE:
            return DND_OUTCOME_CRITICAL_SUCCESS
        if natural == 1:
            return DND_OUTCOME_CRITICAL_FAILURE
    return DND_OUTCOME_SUCCESS if total >= dc else DND_OUTCOME_FAILURE


# A sweeping declaration ("я убиваю их всех") is allowed to succeed -- but it is resolved as
# one roll per target rather than one roll for the sentence, so skipping a fight costs the
# same dice a fight would have. Anything the player did not beat is still standing.
DND_GROUP_MAX_TARGETS = 8
DND_GROUP_DC_STEP = 2


@dataclass
class DndGroupTargetResult:
    index: int
    label: str
    rolls: list[int]
    natural: int
    total: int
    dc: int
    outcome: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "label": self.label,
            "rolls": list(self.rolls),
            "natural": self.natural,
            "total": self.total,
            "dc": self.dc,
            "outcome": self.outcome,
            "outcome_label": DND_OUTCOME_LABELS.get(self.outcome, ""),
        }


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
    group_targets: list[DndGroupTargetResult] = field(default_factory=list)

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
            "group_targets": [item.to_dict() for item in self.group_targets],
            "group_successes": sum(
                1
                for item in self.group_targets
                if item.outcome in (DND_OUTCOME_SUCCESS, DND_OUTCOME_CRITICAL_SUCCESS)
            ),
            "group_size": len(self.group_targets),
        }


def _roll_once(*, die: int, advantage: str) -> tuple[list[int], int]:
    # Advantage/disadvantage is a d20 mechanic; on other dice the player just rolls once.
    roll_count = 2 if (advantage != DND_ADVANTAGE_NONE and die == DND_DEFAULT_DIE) else 1
    rolls = [roll_die(die) for _ in range(roll_count)]
    if roll_count == 2:
        natural = max(rolls) if advantage == DND_ADVANTAGE_ADVANTAGE else min(rolls)
    else:
        natural = rolls[0]
    return rolls, natural


def perform_roll(
    *,
    die: int,
    dc: int,
    advantage: str,
    modifier_breakdown: list[dict[str, Any]],
    group_targets: list[str] | None = None,
) -> DndRollResult:
    """One check. With ``group_targets`` it is one check *per target* instead.

    The group form is what lets a player skip a fight without being handed one for free. Each
    target gets its own die against a DC that climbs by DND_GROUP_DC_STEP down the line -- the
    first foe is caught off guard, the last one saw you coming -- and the headline outcome is
    a success only when every target went down.
    """
    normalized_die = normalize_dnd_die(die)
    normalized_dc = normalize_dnd_dc(dc)
    normalized_advantage = normalize_dnd_advantage(advantage)
    modifier_total = sum(int(item.get("value", 0) or 0) for item in modifier_breakdown)

    labels = [
        normalize_single_line(label, max_length=60) or f"Противник {index + 1}"
        for index, label in enumerate(group_targets or [])
    ][:DND_GROUP_MAX_TARGETS]

    if len(labels) > 1:
        results: list[DndGroupTargetResult] = []
        for index, label in enumerate(labels):
            target_dc = normalize_dnd_dc(normalized_dc + index * DND_GROUP_DC_STEP)
            rolls, natural = _roll_once(die=normalized_die, advantage=normalized_advantage)
            total = natural + modifier_total
            results.append(
                DndGroupTargetResult(
                    index=index,
                    label=label,
                    rolls=rolls,
                    natural=natural,
                    total=total,
                    dc=target_dc,
                    outcome=resolve_check_outcome(
                        die=normalized_die, natural=natural, total=total, dc=target_dc
                    ),
                )
            )
        successes = sum(
            1
            for item in results
            if item.outcome in (DND_OUTCOME_SUCCESS, DND_OUTCOME_CRITICAL_SUCCESS)
        )
        if successes == len(results):
            headline = (
                DND_OUTCOME_CRITICAL_SUCCESS
                if all(item.outcome == DND_OUTCOME_CRITICAL_SUCCESS for item in results)
                else DND_OUTCOME_SUCCESS
            )
        elif successes == 0:
            headline = (
                DND_OUTCOME_CRITICAL_FAILURE
                if any(item.outcome == DND_OUTCOME_CRITICAL_FAILURE for item in results)
                else DND_OUTCOME_FAILURE
            )
        else:
            headline = DND_OUTCOME_FAILURE
        first = results[0]
        return DndRollResult(
            die=normalized_die,
            rolls=list(first.rolls),
            natural=first.natural,
            advantage=normalized_advantage,
            modifier_total=modifier_total,
            modifier_breakdown=list(modifier_breakdown),
            total=first.total,
            dc=normalized_dc,
            outcome=headline,
            group_targets=results,
        )

    rolls, natural = _roll_once(die=normalized_die, advantage=normalized_advantage)
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


def _find_creature_for_check(state: dict[str, Any], target_name: Any) -> dict[str, Any] | None:
    """The creature a check is aimed at: first the current fight, then the wider roster."""
    key = normalize_single_line(target_name, max_length=80).casefold()
    if not key:
        return None
    combat = state.get("combat") if isinstance(state.get("combat"), dict) else {}
    for participant in (combat.get("participants") or []):
        if not isinstance(participant, dict):
            continue
        name = normalize_single_line(participant.get("name"), max_length=80).casefold()
        if name and (name == key or key in name or name in key):
            return participant
    for npc in (state.get("npcs") if isinstance(state.get("npcs"), list) else []):
        if not isinstance(npc, dict):
            continue
        name = normalize_single_line(npc.get("name"), max_length=80).casefold()
        if name and (name == key or key in name or name in key):
            return npc
    return None


def creature_save_dc(creature: dict[str, Any] | None) -> int:
    """The 5e monster formula: 8 + proficiency + the creature's best offensive modifier.

    Fixed for a given creature, which is the point -- resisting the same beast twice should
    be the same difficulty both times, not two different numbers a model happened to pick.
    """
    if not isinstance(creature, dict):
        return 0
    level = normalize_dnd_level(creature.get("level"))
    abilities = creature.get("abilities") if isinstance(creature.get("abilities"), dict) else {}
    best_modifier = max(
        (ability_modifier(abilities.get(ability_id)) for ability_id in ABILITY_IDS),
        default=0,
    )
    return normalize_dnd_dc(8 + proficiency_bonus(level) + best_modifier)


def resolve_check_dc(state: dict[str, Any], check: dict[str, Any]) -> tuple[int, str]:
    """The difficulty actually used, plus a short note explaining where it came from.

    Three sources, in order of authority:
      1. An attack names a target -- the DC is that creature's armour class, full stop.
      2. A saving throw against a named creature -- the DC is that creature's save DC.
      3. Anything else keeps the master's number.
    The table's difficulty dial is then applied on top of all three.
    """
    base_dc = normalize_dnd_dc(check.get("dc"))
    kind = normalize_dnd_check_kind(check.get("kind"))
    source = ""
    creature = _find_creature_for_check(state, check.get("target"))

    if kind == DND_CHECK_KIND_ATTACK and creature is not None:
        armour = _clamp_int(creature.get("armor_class"), 1, 40, 0)
        if armour:
            base_dc = normalize_dnd_dc(armour)
            source = f"КД цели «{creature.get('name')}»"
    elif kind == DND_CHECK_KIND_SAVE and creature is not None:
        creature_dc = creature_save_dc(creature)
        if creature_dc:
            base_dc = creature_dc
            source = f"сложность спасброска от «{creature.get('name')}»"

    shift = difficulty_dc_shift(state.get("difficulty"))
    if shift:
        base_dc = normalize_dnd_dc(base_dc + shift)
    return base_dc, source


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
    if kind == DND_CHECK_KIND_ATTACK:
        # Not a suggestion from the model: which arm a character swings with is a fact about
        # their class and their scores. A rogue attacks with Ловкость even when the narrator
        # wrote "сокрушительный удар".
        ability_id = attack_ability_for_hero(hero)
    if not ability_id:
        ability_id = "wis"

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

    hero_bonus = _clamp_int(check.get("difficulty_bonus"), -5, 5, 0)
    if hero_bonus:
        breakdown.append(
            {
                "key": "difficulty",
                "label": "Сложность игры",
                "value": hero_bonus,
            }
        )

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
                # The turn it was applied on, so a volatile condition can time out even when
                # the narrator never mentions it again. 0 means "unknown / always been there".
                "turn": _clamp_int(item.get("turn") if isinstance(item, dict) else 0, 0, 10_000_000, 0),
            }
        )
        if len(result) >= DND_MAX_CONDITIONS:
            break
    return result


# "Мешочек с 15 зм" is a line in the rulebook's starting kit, but it is not a *thing* the
# character carries around -- it is their starting money. Leaving it in the pack meant the
# gold counter read zero while the inventory bragged about twelve gold pieces.
_STARTING_COIN_PATTERN = re.compile(
    r"(\d{1,6})\s*(?:зм|зол(?:отых|отые|отым|отом|\.)?|gp|gold)\b",
    re.IGNORECASE,
)
_COIN_ITEM_PATTERN = re.compile(
    r"^\s*(?:мешоч?ек|кошел[ьё]к|кошель|сумка|пояс|мешок|кошелёк)\b.*$",
    re.IGNORECASE,
)


def extract_starting_gold(items: Iterable[Any]) -> tuple[int, list[str]]:
    """Split a starting kit into (coins, everything else).

    Only a line that is *about* the money is consumed -- a "Мешочек с 15 зм" becomes 15 gold
    and disappears, while a "Компонентный мешочек" (which carries no amount) stays an item.
    """
    gold = 0
    remaining: list[str] = []
    for raw in items or []:
        text = normalize_single_line(raw, max_length=120)
        if not text:
            continue
        match = _STARTING_COIN_PATTERN.search(text)
        if match and _COIN_ITEM_PATTERN.match(text):
            try:
                gold += int(match.group(1))
            except (TypeError, ValueError):
                remaining.append(text)
            continue
        remaining.append(text)
    return min(gold, 9_999_999), remaining


def default_inventory_for(class_id: str, race_id: str) -> list[str]:
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    _gold, items = extract_starting_gold(dnd_class.starting_inventory)
    race = DND_RACE_BY_ID.get(normalize_dnd_race_id(race_id))
    if race is not None and race.id == "dwarf":
        items.append("Дварфийский походный инструмент")
    if race is not None and race.id == "elf":
        items.append("Эльфийский плащ")
    return items


def default_gold_for(class_id: str) -> int:
    dnd_class = DND_CLASS_BY_ID.get(normalize_dnd_class_id(class_id), DND_CLASS_BY_ID[DEFAULT_CLASS_ID])
    gold, _items = extract_starting_gold(dnd_class.starting_inventory)
    return gold


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

    resolved_background_id = normalize_dnd_background_id(
        source.get("background_id") or source.get("background")
    )
    skill_slots = (
        DND_MAX_SKILL_PROFICIENCIES
        if play_mode == STORY_DND_PLAY_MODE_SANDBOX
        else skill_slots_for_level(class_id, level, resolved_background_id)
    )
    seen_skills: set[str] = set()
    skill_proficiencies: list[str] = []
    for item in normalize_string_list(source.get("skill_proficiencies"), max_items=DND_MAX_SKILL_PROFICIENCIES):
        skill_id = normalize_dnd_skill_id(item)
        if not skill_id or skill_id in seen_skills:
            continue
        seen_skills.add(skill_id)
        skill_proficiencies.append(skill_id)
    # The stored list is authoritative but never longer than the level allows: a blob that
    # claims six proficiencies at level 1 loses the ones it never paid for.
    skill_proficiencies = skill_proficiencies[:skill_slots]
    if not skill_proficiencies:
        skill_proficiencies = list(DND_CLASS_BY_ID[class_id].skills)[:skill_slots]

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

    raw_gold = _clamp_int(source.get("gold"), 0, 9_999_999, -1)
    inventory = normalize_dnd_inventory(source.get("inventory"))
    if not inventory:
        inventory = default_inventory_for(class_id, race_id)
        if raw_gold < 0:
            raw_gold = default_gold_for(class_id)
    else:
        # A pack written before coins were money, or one the narrator wrote a purse into:
        # move the amount to the gold line rather than leaving it as a thing on a list.
        carried_gold, inventory = extract_starting_gold(inventory)
        if carried_gold:
            raw_gold = max(raw_gold, 0) + carried_gold
    if raw_gold < 0:
        raw_gold = 0
    inventory_note = normalize_text_value(source.get("inventory_note"), max_length=DND_INVENTORY_MAX_LENGTH)

    computed_ac = armor_class(class_id, abilities.get("dex"))
    if class_id == "monk":
        computed_ac = max(computed_ac, 10 + ability_modifier(abilities.get("dex")) + ability_modifier(abilities.get("wis")))
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        computed_ac = _clamp_int(source.get("armor_class"), 1, 40, computed_ac)

    speed = DND_RACE_BY_ID.get(race_id, DND_RACE_BY_ID[DEFAULT_RACE_ID]).speed
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        speed = _clamp_int(source.get("speed"), 0, 200, speed)

    death_saves = normalize_dnd_death_saves(source.get("death_saves"))
    is_dead = bool(source.get("is_dead")) or death_saves["failures"] >= DND_DEATH_SAVE_FAILURES_TO_DIE
    if hp["current"] > 0 and not is_dead:
        # Back on your feet means the ledger resets; carrying failures across a heal is the
        # bug that quietly kills a character two fights later.
        death_saves = {"successes": 0, "failures": 0}
    life_state = resolve_life_state(hp_current=hp["current"], death_saves=death_saves, is_dead=is_dead)

    background_text = normalize_single_line(source.get("background"), max_length=80)
    background_id = resolved_background_id
    if background_id and not background_text:
        background_text = DND_BACKGROUND_BY_ID[background_id].label

    return {
        "name": normalize_single_line(source.get("name"), max_length=80),
        "race": race_id,
        "class": class_id,
        "background": background_text,
        "background_id": background_id,
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
        "gold": _clamp_int(raw_gold, 0, 9_999_999, 0),
        "conditions": normalize_dnd_conditions(source.get("conditions")),
        "death_saves": death_saves,
        "is_dead": is_dead,
        "life_state": life_state,
        "skill_slots": skill_slots,
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


# --- Combat ---------------------------------------------------------------------------------

# The service model decides *when* a fight starts and who is in it; everything about how the
# fight runs -- initiative order, whose turn it is, when a round rolls over -- is arithmetic
# and lives here. A model that hallucinates "round 47" cannot produce one.
DND_COMBAT_MAX_PARTICIPANTS = 12
DND_COMBAT_MAX_ROUNDS = 200

DND_COMBAT_PHASE_IDLE = "idle"
DND_COMBAT_PHASE_INITIATIVE = "initiative"
DND_COMBAT_PHASE_ACTIVE = "active"

DND_COMBAT_SIDE_HERO = "hero"
DND_COMBAT_SIDE_ALLY = "ally"
DND_COMBAT_SIDE_ENEMY = "enemy"
DND_COMBAT_SIDES = (DND_COMBAT_SIDE_HERO, DND_COMBAT_SIDE_ALLY, DND_COMBAT_SIDE_ENEMY)


def normalize_dnd_combat_side(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in DND_COMBAT_SIDES:
        return normalized
    aliases = {
        "player": DND_COMBAT_SIDE_HERO,
        "pc": DND_COMBAT_SIDE_HERO,
        "герой": DND_COMBAT_SIDE_HERO,
        "friend": DND_COMBAT_SIDE_ALLY,
        "companion": DND_COMBAT_SIDE_ALLY,
        "союзник": DND_COMBAT_SIDE_ALLY,
        "foe": DND_COMBAT_SIDE_ENEMY,
        "monster": DND_COMBAT_SIDE_ENEMY,
        "враг": DND_COMBAT_SIDE_ENEMY,
    }
    return aliases.get(normalized, DND_COMBAT_SIDE_ENEMY)


def normalize_dnd_combatant(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    name = normalize_single_line(value.get("name"), max_length=80)
    if not name:
        return None
    max_hp = _clamp_int((value.get("hp") or {}).get("max") if isinstance(value.get("hp"), dict) else value.get("hp_max"), 1, 9_999, 6)
    current_hp = _clamp_int(
        (value.get("hp") or {}).get("current") if isinstance(value.get("hp"), dict) else value.get("hp_current"),
        0,
        max_hp,
        max_hp,
    )
    raw_initiative = value.get("initiative")
    has_initiative = str(raw_initiative or "").strip().lstrip("-").isdigit()
    return {
        "key": normalize_single_line(value.get("key"), max_length=80).casefold() or name.casefold(),
        "name": name,
        "side": normalize_dnd_combat_side(value.get("side")),
        "role": normalize_single_line(value.get("role"), max_length=80),
        "initiative": _clamp_int(raw_initiative, -20, 60, 0) if has_initiative else None,
        "initiative_modifier": _clamp_int(value.get("initiative_modifier"), -10, 20, 0),
        "hp": {"current": current_hp, "max": max_hp},
        "armor_class": _clamp_int(value.get("armor_class"), 1, 40, 10),
        "is_down": bool(value.get("is_down")) or current_hp <= 0,
        "npc_key": normalize_single_line(value.get("npc_key"), max_length=80).casefold(),
        "world_card_id": (
            int(value.get("world_card_id"))
            if str(value.get("world_card_id") or "").strip().isdigit() and int(value.get("world_card_id")) > 0
            else None
        ),
    }


def _combat_order_key(participant: dict[str, Any]) -> tuple[int, int, str]:
    """Initiative descending, hero first on a tie, then by name so the order is stable."""
    initiative = participant.get("initiative")
    resolved = int(initiative) if isinstance(initiative, int) else -99
    side_rank = 0 if participant.get("side") == DND_COMBAT_SIDE_HERO else 1
    return (-resolved, side_rank, str(participant.get("name") or ""))


def sort_dnd_combatants(participants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(participants, key=_combat_order_key)


def normalize_dnd_combat(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    participants: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in (source.get("participants") if isinstance(source.get("participants"), list) else []):
        normalized = normalize_dnd_combatant(item)
        if normalized is None or normalized["key"] in seen:
            continue
        seen.add(normalized["key"])
        participants.append(normalized)
        if len(participants) >= DND_COMBAT_MAX_PARTICIPANTS:
            break

    phase = str(source.get("phase") or "").strip().lower()
    if phase not in (DND_COMBAT_PHASE_IDLE, DND_COMBAT_PHASE_INITIATIVE, DND_COMBAT_PHASE_ACTIVE):
        phase = DND_COMBAT_PHASE_IDLE
    active = bool(source.get("active")) and bool(participants)
    if not active:
        phase = DND_COMBAT_PHASE_IDLE
    elif phase == DND_COMBAT_PHASE_IDLE:
        phase = DND_COMBAT_PHASE_INITIATIVE
    # The order is derived, never stored: two clients cannot disagree about who acts next.
    if phase == DND_COMBAT_PHASE_ACTIVE:
        participants = sort_dnd_combatants(participants)
    turn_index = _clamp_int(source.get("turn_index"), 0, max(len(participants) - 1, 0), 0)
    return {
        "active": active,
        "phase": phase,
        "round": _clamp_int(source.get("round"), 0, DND_COMBAT_MAX_ROUNDS, 1 if active else 0),
        "turn_index": turn_index if active else 0,
        "title": normalize_single_line(source.get("title"), max_length=80),
        "participants": participants,
        "hero_initiative_rolled": bool(source.get("hero_initiative_rolled")),
    }


def create_empty_dnd_combat() -> dict[str, Any]:
    return normalize_dnd_combat({})


def combat_hero_participant(combat: dict[str, Any]) -> dict[str, Any] | None:
    for participant in (combat.get("participants") or []):
        if isinstance(participant, dict) and participant.get("side") == DND_COMBAT_SIDE_HERO:
            return participant
    return None


def roll_npc_initiatives(combat: dict[str, Any]) -> dict[str, Any]:
    """Everyone but the hero rolls the moment the fight opens. The hero taps their own die."""
    for participant in (combat.get("participants") or []):
        if not isinstance(participant, dict):
            continue
        if participant.get("side") == DND_COMBAT_SIDE_HERO:
            continue
        if participant.get("initiative") is None:
            participant["initiative"] = max(
                -20,
                min(60, roll_die(DND_DEFAULT_DIE) + int(participant.get("initiative_modifier") or 0)),
            )
    return combat


def start_dnd_combat_if_ready(combat: dict[str, Any]) -> dict[str, Any]:
    """Move from the initiative phase to the first turn once every die has landed."""
    participants = [item for item in (combat.get("participants") or []) if isinstance(item, dict)]
    if not participants or not combat.get("active"):
        return combat
    if any(item.get("initiative") is None for item in participants):
        combat["phase"] = DND_COMBAT_PHASE_INITIATIVE
        return combat
    combat["participants"] = sort_dnd_combatants(participants)
    combat["phase"] = DND_COMBAT_PHASE_ACTIVE
    combat["round"] = max(int(combat.get("round") or 0), 1)
    combat["turn_index"] = 0
    return combat


def advance_dnd_combat_turn(combat: dict[str, Any], *, steps: int = 1) -> dict[str, Any]:
    """Walk the initiative order forward, skipping anyone who is down."""
    participants = [item for item in (combat.get("participants") or []) if isinstance(item, dict)]
    if not participants or combat.get("phase") != DND_COMBAT_PHASE_ACTIVE:
        return combat
    index = _clamp_int(combat.get("turn_index"), 0, len(participants) - 1, 0)
    rounds = int(combat.get("round") or 1)
    for _ in range(max(int(steps or 1), 1)):
        for _attempt in range(len(participants)):
            index += 1
            if index >= len(participants):
                index = 0
                rounds = min(rounds + 1, DND_COMBAT_MAX_ROUNDS)
            if not participants[index].get("is_down"):
                break
    combat["turn_index"] = index
    combat["round"] = rounds
    return combat


def describe_combat_for_prompt(state: dict[str, Any]) -> str:
    combat = state.get("combat") if isinstance(state.get("combat"), dict) else {}
    if not combat.get("active"):
        return ""
    participants = [item for item in (combat.get("participants") or []) if isinstance(item, dict)]
    if not participants:
        return ""
    if combat.get("phase") == DND_COMBAT_PHASE_INITIATIVE:
        header = "Бой начинается, бросается инициатива."
    else:
        index = _clamp_int(combat.get("turn_index"), 0, len(participants) - 1, 0)
        current = participants[index]
        header = f"Раунд {combat.get('round')}. Сейчас ходит: {current.get('name')}."
    lines = [header]
    for participant in participants:
        hp = participant.get("hp") if isinstance(participant.get("hp"), dict) else {}
        side_label = {
            DND_COMBAT_SIDE_HERO: "герой",
            DND_COMBAT_SIDE_ALLY: "союзник",
            DND_COMBAT_SIDE_ENEMY: "противник",
        }.get(participant.get("side"), "участник")
        status = "повержен" if participant.get("is_down") else f"хиты {hp.get('current', 0)}/{hp.get('max', 0)}"
        initiative = participant.get("initiative")
        lines.append(
            f"- {participant.get('name')} ({side_label}): инициатива "
            f"{initiative if initiative is not None else '—'}, {status}, КД {participant.get('armor_class')}."
        )
    return "\n".join(lines)


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
        # Where the difficulty came from ("КД цели «Бандит»"), so the dice dialog can show
        # the player that the number was derived rather than guessed.
        "dc_source": normalize_single_line(value.get("dc_source"), max_length=80),
        "difficulty_bonus": _clamp_int(value.get("difficulty_bonus"), -5, 5, 0),
        "reason": normalize_single_line(value.get("reason"), max_length=200),
        "target": normalize_single_line(value.get("target"), max_length=80),
        "success_hint": normalize_single_line(value.get("success_hint"), max_length=200),
        "failure_hint": normalize_single_line(value.get("failure_hint"), max_length=200),
        "modifier_breakdown": [
            item for item in (value.get("modifier_breakdown") or []) if isinstance(item, dict)
        ],
        # A sweeping declaration against several foes: one die per name, resolved together.
        "group_targets": [
            label
            for label in (
                normalize_single_line(item, max_length=60)
                for item in (value.get("group_targets") if isinstance(value.get("group_targets"), list) else [])
            )
            if label
        ][:DND_GROUP_MAX_TARGETS],
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
        "group_targets": [
            item for item in (value.get("group_targets") or []) if isinstance(item, dict)
        ][:DND_GROUP_MAX_TARGETS],
        "group_successes": _clamp_int(value.get("group_successes"), 0, DND_GROUP_MAX_TARGETS, 0),
        "group_size": _clamp_int(value.get("group_size"), 0, DND_GROUP_MAX_TARGETS, 0),
        "death_save": bool(value.get("death_save", False)),
        "life_state": (
            str(value.get("life_state"))
            if str(value.get("life_state") or "") in DND_LIFE_STATE_LABELS
            else ""
        ),
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
        "roll_policy": normalize_dnd_roll_policy(source.get("roll_policy")),
        "difficulty": normalize_dnd_difficulty(source.get("difficulty")),
        # Where the party was standing when the last turn ended. Used to clear the stage:
        # an NPC does not follow the hero into the next location just because the last
        # scene left them flagged as present.
        "scene_location": normalize_single_line(source.get("scene_location"), max_length=160),
        "pending_check": normalize_dnd_pending_check(source.get("pending_check")),
        "last_roll": normalize_dnd_last_roll(source.get("last_roll")),
        "last_level_up": normalize_dnd_level_up(source.get("last_level_up")),
        "combat": normalize_dnd_combat(source.get("combat")),
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


# --- Sheet locks --------------------------------------------------------------------------

def dnd_sheet_locks(state: dict[str, Any]) -> dict[str, Any]:
    """What the player may still change on the character sheet, and what is now fixed.

    A tabletop character is built once and then *played*. Before the first turn everything is
    open; after it, race, class and the point-buy array are history, and skills may only be
    added into slots a level has actually granted. Sandbox stays fully open -- that is what it
    is for. The UI reads this to grey controls out; the API re-checks every field anyway.
    """
    play_mode = normalize_dnd_play_mode(state.get("play_mode"))
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    started = int(state.get("turn_count") or 0) > 0
    if play_mode == STORY_DND_PLAY_MODE_SANDBOX:
        return {
            "started": started,
            "identity_locked": False,
            "abilities_locked": False,
            "skills_locked": False,
            "skill_slots": DND_MAX_SKILL_PROFICIENCIES,
            "skills_chosen": len(hero.get("skill_proficiencies") or []),
            "free_skill_slots": max(
                DND_MAX_SKILL_PROFICIENCIES - len(hero.get("skill_proficiencies") or []), 0
            ),
            "reason": "",
        }
    level = normalize_dnd_level(hero.get("level"))
    slots = skill_slots_for_level(hero.get("class"), level, hero.get("background_id"))
    chosen = len(hero.get("skill_proficiencies") or [])
    free_slots = max(slots - chosen, 0)
    return {
        "started": started,
        "identity_locked": started,
        "abilities_locked": started,
        # Locked only when there is nothing left to spend: a level that opened a new slot
        # unlocks the picker again, and closes it as soon as the slot is filled.
        "skills_locked": started and free_slots <= 0,
        "skill_slots": slots,
        "skills_chosen": chosen,
        "free_skill_slots": free_slots,
        "next_skill_level": next(
            (threshold for threshold in DND_SKILL_SLOT_LEVELS if threshold > level),
            0,
        ),
        "reason": (
            "Персонаж уже в игре: раса, класс и базовые характеристики зафиксированы. "
            "Характеристики растут только на повышении уровня."
            if started
            else ""
        ),
    }


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
    identity = f"Имя: {hero.get('name') or 'герой'}; {race.label} {dnd_class.label}, уровень {level}"
    if hero.get("background"):
        identity += f"; предыстория: {hero.get('background')}"
    lines = [
        identity + ".",
        f"Характеристики: {ability_line}.",
        f"Хиты: {hp.get('current', 0)}/{hp.get('max', 0)}"
        + (f" (+{hp.get('temp')} врем.)" if int(hp.get("temp") or 0) > 0 else "")
        + f"; КД {hero.get('armor_class')}; бонус мастерства {format_modifier(hero.get('proficiency_bonus') or 2)}; скорость {hero.get('speed')} футов.",
        f"Золото: {int(hero.get('gold') or 0)} зм.",
    ]
    life_state = str(hero.get("life_state") or DND_LIFE_STATE_ALIVE)
    if life_state != DND_LIFE_STATE_ALIVE:
        saves = normalize_dnd_death_saves(hero.get("death_saves"))
        lines.append(
            f"СОСТОЯНИЕ: {DND_LIFE_STATE_LABELS.get(life_state, life_state)}"
            + (
                f" (спасброски от смерти: успехов {saves['successes']}, провалов {saves['failures']})"
                if life_state in (DND_LIFE_STATE_DYING, DND_LIFE_STATE_STABLE)
                else ""
            )
            + "."
        )
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


def describe_notes_for_prompt(state: dict[str, Any], *, limit: int = 6) -> str:
    """The master's own notes, handed back so a fact established ten turns ago still holds."""
    notes = [
        note
        for note in (state.get("notes") if isinstance(state.get("notes"), list) else [])
        if isinstance(note, dict) and str(note.get("text") or "").strip()
    ]
    if not notes:
        return ""
    return "\n".join(f"- {note.get('text')}" for note in notes[:limit])


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

    # A group roll is the whole point of letting a player skip a fight: the text below is what
    # stops "я убил их всех" from becoming true for the ones the dice did not kill.
    group_targets = [item for item in (roll.get("group_targets") or []) if isinstance(item, dict)]
    if len(group_targets) > 1:
        beaten = [
            item
            for item in group_targets
            if str(item.get("outcome")) in (DND_OUTCOME_SUCCESS, DND_OUTCOME_CRITICAL_SUCCESS)
        ]
        survivors = [item for item in group_targets if item not in beaten]
        lines.append("")
        lines.append("ГРУППОВОЕ ДЕЙСТВИЕ, бросок по каждой цели отдельно:")
        for item in group_targets:
            lines.append(
                f"- {item.get('label')}: {item.get('natural')} {format_modifier(modifier_total)}"
                f" = {item.get('total')} против СЛ {item.get('dc')} — "
                f"{DND_OUTCOME_LABELS.get(str(item.get('outcome')), '')}."
            )
        lines.append(
            f"ИТОГ: повержено {len(beaten)} из {len(group_targets)}."
        )
        if survivors:
            lines.append(
                "ОБЯЗАТЕЛЬНО: "
                + ", ".join(str(item.get("label")) for item in survivors)
                + " — НЕ повержены. Они живы, действуют в ответ и наносят герою урон или "
                "срывают его замысел. Не описывай их поражение ни при каких условиях."
            )
        else:
            lines.append("Все цели повержены — опиши это как заслуженный, но дорогой успех.")

    if roll.get("death_save"):
        saves = normalize_dnd_death_saves((roll.get("check") or {}).get("death_saves") or roll.get("death_saves"))
        life_state = str(roll.get("life_state") or "")
        lines.append("")
        lines.append("ЭТО СПАСБРОСОК ОТ СМЕРТИ. Герой лежит без сознания на нуле хитов.")
        if life_state == DND_LIFE_STATE_DEAD:
            lines.append(
                "ГЕРОЙ ПОГИБ. Опиши смерть коротко и с достоинством, закрой сцену и от лица "
                "рассказчика предложи игроку два выхода: продолжить историю за другого "
                "персонажа или начать новую игру. Не воскрешай его сам."
            )
        elif life_state == DND_LIFE_STATE_STABLE:
            lines.append(
                "Герой стабилизировался: он всё ещё без сознания, но больше не умирает. "
                "Опиши, кто или что его вытащило — союзник, случайный прохожий, собственная "
                "живучесть — и оставь его беспомощным до конца сцены."
            )
        elif int(roll.get("natural") or 0) == DND_DEFAULT_DIE:
            lines.append(
                "Естественная 20: герой приходит в себя с одним хитом. Опиши это как "
                "последний рывок на грани."
            )
        else:
            lines.append(
                f"Счёт спасбросков: успехов {saves['successes']}, провалов {saves['failures']}. "
                "Герой всё ещё умирает. Опиши сцену с его точки зрения — темнота, обрывки "
                "звуков — и что делают окружающие."
            )
    return "\n".join(lines)


DND_NARRATOR_RULES = (
    "Ты ведёшь партию по правилам Dungeons & Dragons 5-й редакции как Мастер (DM). "
    "Игрок управляет ТОЛЬКО своим героем. Всё остальное — мир, NPC, противники, последствия — "
    "ведёшь ты.\n"
    "\n"
    "ЗАЯВКА И ИСХОД. Текст игрока — это ЗАЯВКА НА ПОПЫТКУ, а не описание случившегося. "
    "Игрок говорит, что его герой пытается сделать; получилось ли — решаешь ты по механике и "
    "по броску. Даже если игрок написал «я украл кошелёк», «я убедил стражу», «я убил их всех» "
    "в прошедшем времени — это по-прежнему лишь попытка.\n"
    "- Никогда не позволяй игроку описывать за тебя: реакции NPC, урон противникам, свои "
    "находки, изменение мира, чужие мысли и чужие слова. Если он это сделал — вежливо "
    "перепиши сцену так, как она произошла на самом деле.\n"
    "- Игрок не может объявлять новые предметы, деньги, союзников, способности или знания, "
    "которых нет в его листе персонажа. Нет в инвентаре — значит, этого у него нет.\n"
    "- Игрок не может отменять уже случившееся, менять сцену задним числом или объявлять себя "
    "неуязвимым. Мир существует независимо от его желаний.\n"
    "- Заявка, которая физически невозможна для персонажа такого уровня, проваливается или "
    "оборачивается против него. Уровень 1 не побеждает архимага фразой.\n"
    "\n"
    "КУБИКИ. Никогда не бросай кубики в тексте и не выдумывай числа. Результат приходит "
    "отдельным блоком РЕЗУЛЬТАТ БРОСКА, и он обязателен к исполнению буквально: успех значит "
    "успех, провал значит провал, критический провал значит провал плюс осложнение.\n"
    "- Если блока РЕЗУЛЬТАТ БРОСКА нет — значит, действие решалось без броска: опиши "
    "естественный исход, но по-прежнему не выдавай игроку того, чего он не заслужил.\n"
    "- В блоке может стоять ГРУППОВОЕ ДЕЙСТВИЕ. Тогда по каждой цели свой результат: "
    "поверженные — повержены, остальные ЖИВЫ и отвечают. Это единственный способ «пропустить "
    "бой»: выиграл броски — пропустил, не выиграл — получай ответ.\n"
    "\n"
    "ЧИСЛА И СОСТОЯНИЕ. Не меняй самовольно характеристики, хиты, уровень, опыт, золото и "
    "инвентарь: ты описываешь события, а числа пересчитывает система после хода.\n"
    "- Урон, лечение, находки, траты и потери описывай словами и КОНКРЕТНО — «удар рассекает "
    "плечо», «ты отдаёшь торговцу двадцать золотых», «ты подбираешь связку ключей». Система "
    "читает именно эти фразы.\n"
    "- Расходуемое расходуется: факелы, стрелы, зелья, деньги. Ничто не появляется само.\n"
    "\n"
    "СМЕРТЬ. Герой смертен. На нуле хитов он падает без сознания и начинает бросать "
    "спасброски от смерти — этим управляет система, не ты. Три провала — персонаж мёртв "
    "окончательно; тогда закрой сцену и предложи игроку продолжить за другого персонажа или "
    "начать новую игру. Не воскрешай его и не отменяй смерть.\n"
    "- Пока герой при смерти, он ничего не делает и ничего не решает: он лежит. Описывай "
    "происходящее вокруг него.\n"
    "\n"
    "БОЙ. Если сцена перешла в бой, ты получишь блок БОЙ с порядком инициативы. Ходи строго "
    "по нему: описывай только ход того, чья очередь, и заканчивай ответ на действии героя или "
    "прямо перед ним. Не проматывай раунды целиком.\n"
    "- Удар ПО ГЕРОЮ не попадает автоматически. Когда враг атакует, описывай атаку как "
    "происходящую — замах, бросок, рывок когтей — и обрывай ответ ДО того, как станет ясно, "
    "попал он или нет. Попадание и урон решит бросок на следующем ходу. Не пиши «когти "
    "вспарывают плечо» по своей воле.\n"
    "- Единственное исключение: тебе явно передан РЕЗУЛЬТАТ БРОСКА, где герой провалил "
    "защиту. Тогда попадание описывай смело и конкретно.\n"
    "\n"
    "МИР. Соблюдай текущее время суток, сезон и погоду: они меняются постепенно и только "
    "вместе с течением игрового времени.\n"
    "- У важных NPC есть отношение к герою — веди их реплики и поступки в согласии с ним, и "
    "показывай, когда поступок героя это отношение меняет.\n"
    "- Если по ходу сцены герой получил поручение, цель или обещание — сформулируй это в "
    "тексте прямо и однозначно, одной ясной фразой, чтобы это стало заданием.\n"
    "- Не превращай сцену в таблицу: правила работают под текстом, а игрок читает живую прозу."
)

# Sandbox is not a different game, only a different rulebook: the narrator still runs the
# world, the player still cannot narrate for it. What changes is that the sheet is theirs.
DND_SANDBOX_NARRATOR_RULES = (
    "РЕЖИМ ПЕСОЧНИЦЫ. Лист персонажа игрок ведёт сам: уровень, хиты, характеристики и "
    "инвентарь заданы вручную и являются правдой о герое, даже если они выглядят "
    "невероятными. Принимай их как есть.\n"
    "- Всё остальное работает как в обычной игре: заявка игрока остаётся попыткой, броски "
    "обязательны к исполнению, NPC ведут себя по своему характеру и отношению, мир не "
    "подчиняется желаниям игрока.\n"
    "- Сложность подбирай под заявленную силу героя: персонажу 20 уровня карманник не "
    "угроза, но и стража города — не картон.\n"
    "- Время и погоду в песочнице задаёт игрок; не меняй их самовольно."
)


def build_dnd_instruction_card(
    state: dict[str, Any],
    *,
    roll: dict[str, Any] | None = None,
    location_label: str = "",
) -> dict[str, str]:
    """The single system card that carries the whole D&D layer into the narrator prompt."""
    sections: list[str] = [DND_NARRATOR_RULES]
    if normalize_dnd_play_mode(state.get("play_mode")) == STORY_DND_PLAY_MODE_SANDBOX:
        sections.extend(["", DND_SANDBOX_NARRATOR_RULES])
    sections.extend(["", "ЛИСТ ПЕРСОНАЖА:", describe_hero_for_prompt(state)])
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
        sections.extend(
            [
                "",
                "ЗНАКОМЫЕ ПЕРСОНАЖИ (их НЕТ в сцене — это справка о прошлых встречах). "
                "Не давай им реплик и не вводи их в сцену без причины из текста:",
                known_npcs,
            ]
        )
    if not active_npcs:
        sections.extend(
            [
                "",
                "В СЦЕНЕ НЕТ ЗНАКОМЫХ ПЕРСОНАЖЕЙ. Герой один или среди новых лиц — не "
                "возвращай в сцену тех, с кем он уже попрощался или от кого ушёл.",
            ]
        )
    quests = describe_quests_for_prompt(state)
    if quests:
        sections.extend(["", "АКТИВНЫЕ ЗАДАНИЯ:", quests])
    notes = describe_notes_for_prompt(state)
    if notes:
        sections.extend(["", "ЗАМЕТКИ МАСТЕРА (твоя память о прошлых ходах):", notes])
    combat_block = describe_combat_for_prompt(state)
    if combat_block:
        sections.extend(["", "БОЙ (ходи строго по этому порядку):", combat_block])
    # The hero being unconscious outranks everything else on the card: it changes what the
    # narrator is allowed to let them do at all, so it goes last where it cannot be skimmed.
    hero = state.get("hero") if isinstance(state.get("hero"), dict) else {}
    life_state = str(hero.get("life_state") or DND_LIFE_STATE_ALIVE)
    if life_state == DND_LIFE_STATE_DEAD:
        sections.extend(
            [
                "",
                "ГЕРОЙ МЁРТВ. Он не действует и не говорит. Заверши историю и предложи игроку "
                "продолжить за другого персонажа или начать новую игру.",
            ]
        )
    elif life_state in (DND_LIFE_STATE_DYING, DND_LIFE_STATE_STABLE):
        sections.extend(
            [
                "",
                "ГЕРОЙ БЕЗ СОЗНАНИЯ на нуле хитов. Что бы ни написал игрок, герой не встаёт, "
                "не говорит и не действует, пока его не вылечат или не стабилизируют. Опиши "
                "сцену вокруг него и действия окружающих.",
            ]
        )
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
        "backgrounds": [
            {
                "id": item.id,
                "label": item.label,
                "summary": item.summary,
                "skills": list(item.skills),
            }
            for item in DND_BACKGROUNDS
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
        "skill_slots": {
            "max": DND_MAX_SKILL_PROFICIENCIES,
            "min": DND_MIN_SKILL_SLOTS,
            "levels": list(DND_SKILL_SLOT_LEVELS),
        },
        "death": {
            "dc": DND_DEATH_SAVE_DC,
            "successes": DND_DEATH_SAVE_SUCCESSES_TO_STABILIZE,
            "failures": DND_DEATH_SAVE_FAILURES_TO_DIE,
            "labels": dict(DND_LIFE_STATE_LABELS),
        },
        "combat": {
            "max_participants": DND_COMBAT_MAX_PARTICIPANTS,
            "sides": list(DND_COMBAT_SIDES),
        },
        "group": {"max_targets": DND_GROUP_MAX_TARGETS, "dc_step": DND_GROUP_DC_STEP},
        "difficulties": [
            {
                "id": difficulty_id,
                "label": entry[0],
                "dc_shift": entry[1],
                "hero_bonus": entry[2],
                "description": entry[3],
            }
            for difficulty_id, entry in DND_DIFFICULTY_TABLE.items()
        ],
        "roll_policies": [
            {"id": policy_id, "label": DND_ROLL_POLICY_LABELS[policy_id]}
            for policy_id in STORY_DND_ROLL_POLICIES
        ],
    }
