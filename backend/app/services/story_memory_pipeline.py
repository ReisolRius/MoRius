from __future__ import annotations



from app import main as monolith_main
from app.services.story_character_state_snapshots import (
    create_story_character_state_assistant_snapshot as _create_story_character_state_assistant_snapshot,
    ensure_story_character_state_snapshot_baseline as _ensure_story_character_state_snapshot_baseline,
)
from app.services.story_games import (
    deserialize_story_character_state_cards_payload as _deserialize_story_character_state_cards_payload,
    deserialize_story_environment_datetime as _deserialize_story_environment_datetime,
    deserialize_story_environment_weather as _deserialize_story_environment_weather,
    normalize_story_environment_enabled as _normalize_story_environment_enabled,
    normalize_story_environment_turn_step_minutes as _normalize_story_environment_turn_step_minutes,
    serialize_story_character_state_cards_payload as _serialize_story_character_state_cards_payload,
    serialize_story_environment_datetime as _serialize_story_environment_datetime,
    serialize_story_environment_weather as _serialize_story_environment_weather,
)




def _bind_monolith_names() -> None:

    module_globals = globals()

    for name in dir(monolith_main):

        if name.startswith("__"):

            continue

        module_globals.setdefault(name, getattr(monolith_main, name))





_bind_monolith_names()

STORY_CHARACTER_STATE_KIND_MAIN_HERO = getattr(monolith_main, "STORY_CHARACTER_STATE_KIND_MAIN_HERO", "main_hero")
STORY_CHARACTER_STATE_KIND_NPC = getattr(monolith_main, "STORY_CHARACTER_STATE_KIND_NPC", "npc")
STORY_CHARACTER_STATE_REQUEST_MAX_TOKENS = getattr(monolith_main, "STORY_CHARACTER_STATE_REQUEST_MAX_TOKENS", 700)
STORY_CHARACTER_STATE_CARD_CONTENT_MAX_CHARS = getattr(
    monolith_main,
    "STORY_CHARACTER_STATE_CARD_CONTENT_MAX_CHARS",
    900,
)
STORY_CHARACTER_STATE_MAIN_HERO_PROMPT_TITLE = getattr(
    monolith_main,
    "STORY_CHARACTER_STATE_MAIN_HERO_PROMPT_TITLE",
    "Состояние: Главный герой",
)
STORY_CHARACTER_STATE_NPC_PROMPT_TITLE_PREFIX = getattr(
    monolith_main,
    "STORY_CHARACTER_STATE_NPC_PROMPT_TITLE_PREFIX",
    "Состояние NPC:",
)
STORY_CHARACTER_STATE_SERVICE_TAG_OPEN = getattr(
    monolith_main,
    "STORY_CHARACTER_STATE_SERVICE_TAG_OPEN",
    "<character_state_service>",
)
STORY_CHARACTER_STATE_SERVICE_TAG_CLOSE = getattr(
    monolith_main,
    "STORY_CHARACTER_STATE_SERVICE_TAG_CLOSE",
    "</character_state_service>",
)
STORY_CHARACTER_STATE_ATTITUDE_TO_HERO_LABELS = tuple(
    getattr(
        monolith_main,
        "STORY_CHARACTER_STATE_ATTITUDE_TO_HERO_LABELS",
        (
            "нейтральное",
            "доброжелательное",
            "заинтересованное",
            "доверительное",
            "дружественное",
            "зависимое",
            "романтическое",
            "враждебное",
        ),
    )
)



def _normalize_story_environment_datetime(value: str | None) -> str:

    return _serialize_story_environment_datetime(_deserialize_story_environment_datetime(value))


def _normalize_story_character_state_cards_payload(value: Any) -> list[dict[str, Any]]:

    if isinstance(value, str):

        return _deserialize_story_character_state_cards_payload(value)

    try:

        return _deserialize_story_character_state_cards_payload(json.dumps(value or [], ensure_ascii=False))

    except (TypeError, ValueError):

        return []



def _normalize_story_character_state_enabled(value: Any) -> bool:

    if isinstance(value, bool):

        return value

    if value is None:

        return False

    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}



def _normalize_story_character_state_monitor_inactive_always(value: Any) -> bool:

    if isinstance(value, bool):

        return value

    if value is None:

        return True

    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}



def _normalize_story_environment_weather_text(value: Any, *, max_chars: int = 80) -> str:

    normalized = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip(" ,;:-.!?…")

    if not normalized:

        return ""

    if len(normalized) > max_chars:

        normalized = normalized[: max_chars - 1].rstrip(" ,;:-.!?…") + "…"

    if normalized and normalized[0].islower():

        normalized = normalized[:1].upper() + normalized[1:]

    return normalized



def _normalize_story_environment_clock_label(value: Any) -> str:

    normalized = str(value or "").strip().replace(".", ":")

    match = re.fullmatch(r"(\d{1,2}):(\d{2})", normalized)

    if not match:

        return ""

    hours = int(match.group(1))

    minutes = int(match.group(2))

    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:

        return ""

    return f"{hours:02d}:{minutes:02d}"



def _normalize_story_environment_temperature_value(value: Any) -> int | None:

    if isinstance(value, bool):

        return None

    if isinstance(value, (int, float)):

        numeric_value = float(value)

    else:

        match = re.search(r"[-+]?\d+(?:[.,]\d+)?", str(value or ""))

        if not match:

            return None

        try:

            numeric_value = float(match.group(0).replace(",", "."))

        except ValueError:

            return None

    if numeric_value != numeric_value or numeric_value in {float("inf"), float("-inf")}:

        return None

    return int(round(numeric_value))



def _normalize_story_environment_weather_timeline_entry(value: Any) -> dict[str, Any] | None:

    if not isinstance(value, dict):

        return None

    start_time = _normalize_story_environment_clock_label(value.get("start_time"))

    end_time = _normalize_story_environment_clock_label(value.get("end_time"))

    if not start_time or not end_time or start_time == end_time:

        return None

    normalized_entry: dict[str, Any] = {

        "start_time": start_time,

        "end_time": end_time,

    }

    summary = _normalize_story_environment_weather_text(value.get("summary"), max_chars=96)

    if summary:

        normalized_entry["summary"] = summary

    temperature_c = _normalize_story_environment_temperature_value(value.get("temperature_c"))

    if temperature_c is not None:

        normalized_entry["temperature_c"] = temperature_c

    for field_name, max_chars in (("fog", 48), ("humidity", 48), ("wind", 48)):

        field_value = _normalize_story_environment_weather_text(value.get(field_name), max_chars=max_chars)

        if field_value:

            normalized_entry[field_name] = field_value

    if len(normalized_entry) <= 2:

        return None

    return normalized_entry



def _build_story_environment_fallback_timeline(weather_payload: dict[str, Any]) -> list[dict[str, Any]]:

    summary = _normalize_story_environment_weather_text(weather_payload.get("summary"), max_chars=96)

    temperature_c = _normalize_story_environment_temperature_value(weather_payload.get("temperature_c"))

    fog = _normalize_story_environment_weather_text(weather_payload.get("fog"), max_chars=48)

    humidity = _normalize_story_environment_weather_text(weather_payload.get("humidity"), max_chars=48)

    wind = _normalize_story_environment_weather_text(weather_payload.get("wind"), max_chars=48)

    if not any((summary, temperature_c is not None, fog, humidity, wind)):

        return []

    fallback_timeline: list[dict[str, Any]] = []

    default_periods = (

        ("06:00", "12:00", -2),

        ("12:00", "17:00", 0),

        ("17:00", "22:00", -1),

        ("22:00", "00:00", -3),

    )

    for start_time, end_time, temperature_delta in default_periods:

        entry: dict[str, Any] = {

            "start_time": start_time,

            "end_time": end_time,

        }

        if summary:

            entry["summary"] = summary

        if temperature_c is not None:

            entry["temperature_c"] = temperature_c + temperature_delta

        if fog:

            entry["fog"] = fog

        if humidity:

            entry["humidity"] = humidity

        if wind:

            entry["wind"] = wind

        normalized_entry = _normalize_story_environment_weather_timeline_entry(entry)

        if normalized_entry:

            fallback_timeline.append(normalized_entry)

    return fallback_timeline



def _normalize_story_environment_weather_payload(value: Any) -> dict[str, Any] | None:

    if not isinstance(value, dict):

        return None

    normalized_weather: dict[str, Any] = {}

    summary = _normalize_story_environment_weather_text(value.get("summary"), max_chars=96)

    if summary:

        normalized_weather["summary"] = summary

    temperature_c = _normalize_story_environment_temperature_value(value.get("temperature_c"))

    if temperature_c is not None:

        normalized_weather["temperature_c"] = temperature_c

    for field_name, max_chars in (("fog", 48), ("humidity", 48), ("wind", 48)):

        field_value = _normalize_story_environment_weather_text(value.get(field_name), max_chars=max_chars)

        if field_value:

            normalized_weather[field_name] = field_value

    day_date = str(value.get("day_date") or "").strip()

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_date):

        normalized_weather["day_date"] = day_date

    raw_timeline = value.get("timeline")

    if isinstance(raw_timeline, list):

        seen_ranges: set[tuple[str, str]] = set()

        normalized_timeline: list[dict[str, Any]] = []

        for raw_entry in raw_timeline:

            normalized_entry = _normalize_story_environment_weather_timeline_entry(raw_entry)

            if not normalized_entry:

                continue

            range_key = (

                str(normalized_entry.get("start_time") or ""),

                str(normalized_entry.get("end_time") or ""),

            )

            if range_key in seen_ranges:

                continue

            seen_ranges.add(range_key)

            normalized_timeline.append(normalized_entry)

        normalized_timeline.sort(

            key=lambda entry: _story_environment_clock_time_to_minutes(str(entry.get("start_time") or "")) or 0

        )

        if normalized_timeline:

            normalized_weather["timeline"] = normalized_timeline[:8]

            if "summary" not in normalized_weather:

                first_summary = _normalize_story_environment_weather_text(

                    normalized_timeline[0].get("summary"),

                    max_chars=96,

                )

                if first_summary:

                    normalized_weather["summary"] = first_summary

            if "temperature_c" not in normalized_weather:

                first_temperature = _normalize_story_environment_temperature_value(

                    normalized_timeline[0].get("temperature_c")

                )

                if first_temperature is not None:

                    normalized_weather["temperature_c"] = first_temperature

    return normalized_weather or None


_STORY_ENVIRONMENT_CANONICAL_TIMELINE_SLOTS = (
    ("00:00", "06:00", 3),
    ("06:00", "12:00", 9),
    ("12:00", "18:00", 15),
    ("18:00", "00:00", 21),
)

_STORY_ENVIRONMENT_FALLBACK_BASE_TEMPS = {
    "winter": (-10, -5, -1, -6),
    "spring": (4, 10, 16, 11),
    "summer": (12, 17, 23, 18),
    "autumn": (7, 11, 16, 10),
}

_STORY_ENVIRONMENT_FALLBACK_PATTERNS = {
    "winter": (
        (
            "Ясная морозная ночь",
            "Солнечное морозное утро",
            "Холодный ясный день",
            "Тихий морозный вечер",
        ),
        (
            "Облачная зимняя ночь",
            "Пасмурное зимнее утро",
            "Холодный пасмурный день",
            "Зимний вечер с облаками",
        ),
        (
            "Снежная ночь",
            "Снегопад к утру",
            "Холодный снег с ветром",
            "Снежный вечер",
        ),
        (
            "Туманная зимняя ночь",
            "Серое зимнее утро",
            "Прохладный день с прояснениями",
            "Спокойный холодный вечер",
        ),
    ),
    "spring": (
        (
            "Ясная весенняя ночь",
            "Солнечное весеннее утро",
            "Тёплый ясный день",
            "Спокойный весенний вечер",
        ),
        (
            "Ночь с редкими облаками",
            "Солнечно с облаками",
            "Тепло, облака с прояснениями",
            "Мягкий вечер с облаками",
        ),
        (
            "Сырая весенняя ночь",
            "Пасмурное утро",
            "Короткий весенний дождь",
            "Прохладный влажный вечер",
        ),
        (
            "Туманная весенняя ночь",
            "Туман рассеивается",
            "Свежий день с прояснениями",
            "Тихий прохладный вечер",
        ),
    ),
    "summer": (
        (
            "Ясная ночь",
            "Солнечное утро",
            "Тёплый ясный день",
            "Спокойный летний вечер",
        ),
        (
            "Тёплая ночь с облаками",
            "Солнечно с облаками",
            "Тепло, облака с прояснениями",
            "Тёплый вечер с облаками",
        ),
        (
            "Облачная летняя ночь",
            "Пасмурное утро",
            "Короткий летний дождь",
            "Прохладный вечер после дождя",
        ),
        (
            "Туманная летняя ночь",
            "Туман рассеивается",
            "Тёплый день с прояснениями",
            "Тихий вечер",
        ),
    ),
    "autumn": (
        (
            "Ясная осенняя ночь",
            "Свежее солнечное утро",
            "Прохладный ясный день",
            "Тихий осенний вечер",
        ),
        (
            "Ночь с плотными облаками",
            "Облачно с прояснениями",
            "Прохладный день с облаками",
            "Осенний вечер с облаками",
        ),
        (
            "Сырая осенняя ночь",
            "Пасмурное утро",
            "Осенний дождь",
            "Холодный влажный вечер",
        ),
        (
            "Туманная осенняя ночь",
            "Серое осеннее утро",
            "Прохладный день с прояснениями",
            "Спокойный вечер после сырости",
        ),
    ),
}

_STORY_ENVIRONMENT_FALLBACK_PATTERN_TEMPERATURE_SHIFTS = (
    (0, 0, 1, 0),
    (0, 0, 0, -1),
    (-1, -1, -2, -2),
    (-1, 0, 0, -1),
)


def _build_story_environment_non_generic_fallback_weather_payload(

    *,

    reference_datetime: datetime | None,

    target_day_date: str,

    supporting_text: str,

    ensure_timeline: bool = False,

) -> dict[str, Any] | None:

    resolved_datetime = reference_datetime or _story_environment_datetime_from_day_date(target_day_date, hour=12)
    if not isinstance(resolved_datetime, datetime):

        return None

    month = resolved_datetime.month
    if month in {12, 1, 2}:

        season_key = "winter"
    elif month in {3, 4, 5}:

        season_key = "spring"
    elif month in {6, 7, 8}:

        season_key = "summer"
    else:

        season_key = "autumn"

    normalized_supporting_text = str(supporting_text or "").casefold()
    seed_source = f"{target_day_date}|{normalized_supporting_text[:320]}"
    seed_value = sum((index + 1) * ord(character) for index, character in enumerate(seed_source))
    pattern_index = seed_value % len(_STORY_ENVIRONMENT_FALLBACK_PATTERNS[season_key])
    if re.search(r"\b(?:дожд|ливн|морос|гроза|снегопад|снег)\w*\b", normalized_supporting_text):

        pattern_index = 2
    elif re.search(r"\b(?:туман|дымк|мгла)\w*\b", normalized_supporting_text):

        pattern_index = 3
    elif re.search(r"\b(?:ясн|луна|лунн|звезд|звёзд|солнеч)\w*\b", normalized_supporting_text):

        pattern_index = 0

    climate_shift = 0
    if re.search(r"\b(?:север|тундр|лед|лёд|снег|гор|перевал|стуж|мороз)\w*\b", normalized_supporting_text):

        climate_shift -= 4
    elif re.search(r"\b(?:пустын|зной|жар|палящ|раскал)\w*\b", normalized_supporting_text):

        climate_shift += 4

    daily_shift = (seed_value % 5) - 2
    base_temperatures = _STORY_ENVIRONMENT_FALLBACK_BASE_TEMPS[season_key]
    pattern_summaries = _STORY_ENVIRONMENT_FALLBACK_PATTERNS[season_key][pattern_index]
    pattern_temperature_shifts = _STORY_ENVIRONMENT_FALLBACK_PATTERN_TEMPERATURE_SHIFTS[pattern_index]
    fog_by_pattern = ("Лёгкий в низинах", "Нет", "Нет", "Лёгкий")
    humidity_by_pattern = ("Высокая", "Средняя", "Высокая", "Высокая")
    wind_by_pattern = ("Слабый", "Лёгкий", "Умеренный", "Штиль")

    canonical_timeline: list[dict[str, Any]] = []
    for slot_index, (start_time, end_time, _anchor_hour) in enumerate(_STORY_ENVIRONMENT_CANONICAL_TIMELINE_SLOTS):

        next_entry = _normalize_story_environment_weather_timeline_entry(
            {
                "start_time": start_time,
                "end_time": end_time,
                "summary": pattern_summaries[slot_index],
                "temperature_c": base_temperatures[slot_index] + pattern_temperature_shifts[slot_index] + daily_shift + climate_shift,
                "fog": fog_by_pattern[pattern_index] if slot_index in {0, 1} else "Нет",
                "humidity": humidity_by_pattern[pattern_index],
                "wind": wind_by_pattern[pattern_index],
            }
        )
        if next_entry:

            canonical_timeline.append(next_entry)

    if not canonical_timeline:

        return None

    if ensure_timeline:

        active_timeline_entry = _resolve_story_environment_weather_timeline_entry(
            weather_payload={"timeline": canonical_timeline, "day_date": target_day_date},
            current_datetime=resolved_datetime,
        )
        active_summary = str((active_timeline_entry or {}).get("summary") or pattern_summaries[0]).strip()
        active_temperature = (active_timeline_entry or {}).get("temperature_c")
        active_fog = str((active_timeline_entry or {}).get("fog") or "").strip()
        active_humidity = str((active_timeline_entry or {}).get("humidity") or "").strip()
        active_wind = str((active_timeline_entry or {}).get("wind") or "").strip()
        return _normalize_story_environment_weather_payload(
            {
                "summary": active_summary,
                "temperature_c": active_temperature,
                "fog": active_fog,
                "humidity": active_humidity,
                "wind": active_wind,
                "day_date": target_day_date,
                "timeline": canonical_timeline,
            }
        )

    daytime_entry = canonical_timeline[2]
    return _normalize_story_environment_weather_payload(
        {
            "summary": daytime_entry.get("summary"),
            "temperature_c": daytime_entry.get("temperature_c"),
            "fog": daytime_entry.get("fog"),
            "humidity": daytime_entry.get("humidity"),
            "wind": daytime_entry.get("wind"),
            "day_date": target_day_date,
        }
    )


def _build_story_environment_canonical_timeline(

    weather_payload: dict[str, Any] | None,

    *,

    target_day_date: str,

) -> list[dict[str, Any]]:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return []

    resolved_day_date = str(target_day_date or normalized_weather.get("day_date") or "").strip()
    fallback_summary = _normalize_story_environment_weather_text(normalized_weather.get("summary"), max_chars=96)
    fallback_temperature = _normalize_story_environment_temperature_value(normalized_weather.get("temperature_c"))
    fallback_fog = _normalize_story_environment_weather_text(normalized_weather.get("fog"), max_chars=48)
    fallback_humidity = _normalize_story_environment_weather_text(normalized_weather.get("humidity"), max_chars=48)
    fallback_wind = _normalize_story_environment_weather_text(normalized_weather.get("wind"), max_chars=48)
    canonical_timeline: list[dict[str, Any]] = []

    for start_time, end_time, anchor_hour in _STORY_ENVIRONMENT_CANONICAL_TIMELINE_SLOTS:

        anchor_datetime = _story_environment_datetime_from_day_date(resolved_day_date, hour=anchor_hour)
        source_entry = (
            _resolve_story_environment_weather_timeline_entry(
                weather_payload=normalized_weather,
                current_datetime=anchor_datetime,
            )
            if isinstance(anchor_datetime, datetime)
            else None
        )
        source_payload = source_entry if isinstance(source_entry, dict) else normalized_weather
        next_entry: dict[str, Any] = {
            "start_time": start_time,
            "end_time": end_time,
        }

        summary = _normalize_story_environment_weather_text(source_payload.get("summary"), max_chars=96) or fallback_summary
        if summary:

            next_entry["summary"] = summary

        temperature_c = _normalize_story_environment_temperature_value(source_payload.get("temperature_c"))
        if temperature_c is None:

            temperature_c = fallback_temperature
        if temperature_c is not None:

            next_entry["temperature_c"] = temperature_c

        for field_name, fallback_value, max_chars in (
            ("fog", fallback_fog, 48),
            ("humidity", fallback_humidity, 48),
            ("wind", fallback_wind, 48),
        ):

            field_value = _normalize_story_environment_weather_text(source_payload.get(field_name), max_chars=max_chars) or fallback_value
            if field_value:

                next_entry[field_name] = field_value

        normalized_entry = _normalize_story_environment_weather_timeline_entry(next_entry)
        if normalized_entry:

            canonical_timeline.append(normalized_entry)

    return canonical_timeline


def _repair_story_environment_weather_payload(

    weather_payload: dict[str, Any] | None,

    *,

    reference_datetime: datetime | None,

    supporting_text: str,

    target_day_date: str,

    ensure_timeline: bool = False,

    align_to_current_period: bool = False,

) -> dict[str, Any] | None:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return None

    next_weather = dict(normalized_weather)

    resolved_day_date = str(target_day_date or next_weather.get("day_date") or "").strip()

    if resolved_day_date:

        next_weather["day_date"] = resolved_day_date

    if ensure_timeline:

        canonical_timeline = _build_story_environment_canonical_timeline(
            next_weather,
            target_day_date=resolved_day_date,
        )
        if canonical_timeline:

            next_weather["timeline"] = canonical_timeline

    repaired_weather = _normalize_story_environment_weather_payload(next_weather)

    if not isinstance(repaired_weather, dict):

        return None

    if align_to_current_period:

        aligned_weather = _align_story_environment_weather_to_datetime(

            weather_payload=repaired_weather,

            current_datetime=reference_datetime,

            target_day_date=resolved_day_date or None,

        )

        if isinstance(aligned_weather, dict):

            repaired_weather = aligned_weather

    guarded_weather = _apply_story_environment_temperature_guardrails(

        weather_payload=repaired_weather,

        reference_datetime=reference_datetime,

        supporting_text=supporting_text,

    )

    return _normalize_story_environment_weather_payload(guarded_weather or repaired_weather)



def _normalize_story_assistant_text_for_memory(content: Any) -> str:
    safe_content = str(content or "")
    normalized = _strip_story_markup_for_memory_text(safe_content).replace("\r\n", "\n").strip()

    if normalized:

        return normalized

    normalized = _normalize_story_markup_to_plain_text(safe_content).replace("\r\n", "\n").strip()

    if normalized:

        return normalized

    return safe_content.replace("\r\n", "\n").strip()





def _get_story_user_prompt_before_assistant_message(

    db: Session,

    *,

    game_id: int,

    assistant_message_id: int,

) -> str:

    latest_user_message = db.scalar(

        select(StoryMessage)

        .where(

            StoryMessage.game_id == game_id,

            StoryMessage.role == STORY_USER_ROLE,

            StoryMessage.id < assistant_message_id,

            StoryMessage.undone_at.is_(None),

        )

        .order_by(StoryMessage.id.desc())

        .limit(1)

    )

    if not isinstance(latest_user_message, StoryMessage):

        return ""

    return latest_user_message.content.replace("\r\n", "\n").strip()





def _get_story_previous_assistant_text_before_message(

    db: Session,

    *,

    game_id: int,

    assistant_message_id: int,

) -> str:

    previous_assistant_message = db.scalar(

        select(StoryMessage)

        .where(

            StoryMessage.game_id == game_id,

            StoryMessage.role == STORY_ASSISTANT_ROLE,

            StoryMessage.id < assistant_message_id,

            StoryMessage.undone_at.is_(None),

        )

        .order_by(StoryMessage.id.desc())

        .limit(1)

    )

    if not isinstance(previous_assistant_message, StoryMessage):

        return ""

    return _normalize_story_assistant_text_for_memory(previous_assistant_message.content)





def _legacy__normalize_story_location_memory_content_v1(value: str) -> str:
    normalized = " ".join(value.replace("\r\n", " ").split()).strip()

    if not normalized:

        return ""

    if len(normalized) > STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS:

        normalized = normalized[: STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?…") + "."

    if normalized[-1] not in ".!?…":

        normalized = f"{normalized}."

    normalized_casefold = normalized.casefold()

    if normalized_casefold.startswith("действие происходит"):

        suffix = normalized[len("действие происходит") :].lstrip()

        normalized = f"Действие происходит{f' {suffix}' if suffix else ''}"

        return normalized

    if normalized_casefold.startswith("события происходят"):

        suffix = normalized[len("события происходят") :].lstrip()

        normalized = f"События происходят{f' {suffix}' if suffix else ''}"

        return normalized

    return ""


def _legacy__normalize_story_location_memory_label_v1(value: str) -> str:

    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip(" .,:;!?…")

    if not normalized:

        return ""

    normalized_casefold = normalized.casefold()

    for prefix in ("действие происходит ", "события происходят "):

        if normalized_casefold.startswith(prefix):

            normalized = normalized[len(prefix):].strip(" .,:;!?…")

            break

    if not normalized:

        return ""

    if len(normalized) > 160:

        normalized = normalized[:159].rstrip(" ,;:-.!?…") + "…"

    if normalized and normalized[0].islower():

        normalized = normalized[:1].upper() + normalized[1:]

    return normalized


def _legacy__resolve_story_location_memory_label_v1(*, label: str | None = None, content: str | None = None) -> str:

    normalized_label = _normalize_story_location_memory_label(label or "")

    if normalized_label:

        return normalized_label

    return _normalize_story_location_memory_label(content or "")


def _legacy__sync_story_game_current_location_label_v1(game: StoryGame, label: str | None) -> bool:

    normalized_label = _normalize_story_location_memory_label(label or "")

    current_label = " ".join(str(getattr(game, "current_location_label", "") or "").split()).strip()

    if current_label == normalized_label:


        return False

    game.current_location_label = normalized_label

    return True

STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS = (
    "таверн",
    "трактир",
    "постоял",
    "гостин",
    "лагер",
    "лес",
    "рощ",
    "полян",
    "пещер",
    "шахт",
    "катакомб",
    "болот",
    "дорог",
    "тракт",
    "город",
    "деревн",
    "сел",
    "квартал",
    "улиц",
    "площад",
    "рынок",
    "дом",
    "комнат",
    "камер",
    "зал",
    "коридор",
    "двор",
    "подвал",
    "чердак",
    "крыша",
    "башн",
    "замок",
    "крепост",
    "храм",
    "святилищ",
    "порт",
    "кораб",
    "берег",
    "пристан",
    "конюш",
    "кузниц",
    "лавк",
    "магазин",
    "мастерск",
    "кабинет",
    "библиотек",
    "сад",
    "кладбищ",
    "алле",
    "гавань",
    "река",
    "озер",
    "остров",
    "переулк",
    "мост",
    "тоннел",
    "платформ",
    "станц",
    "вагон",
    "шатер",
    "палатк",
)
STORY_LOCATION_FALLBACK_PLAYER_TURN_PATTERN = re.compile(
    r"\b(?:иду|идем|идём|пойду|подхожу|подойду|захожу|зайду|вхожу|войду|вбегаю|вбегу|"
    r"проникаю|проникну|возвращаюсь|вернусь|еду|приеду|направляюсь|отправляюсь|"
    r"остаюсь|останусь|нахожусь|сижу|стою|жду|двигаюсь|пробираюсь|спускаюсь|поднимаюсь)\s+"
    r"(?P<phrase>(?:в|во|на|у|под|над|около|возле|рядом с|среди|между|внутри|посреди|"
    r"за|перед|напротив)\s+[^,.!?:;\n]{2,120})",
    re.IGNORECASE,
)
STORY_LOCATION_FALLBACK_ASSISTANT_BLOCKER_PATTERN = re.compile(
    r"\b(?:не\s+(?:доход(?:ит|я)|добира(?:юсь|ется|лся|лась)|вход(?:ишь|ите|ят|ил|ила)|"
    r"заход(?:ишь|ите|ят|ил|ила)|попада(?:ю|ет|ют|л|ла)|успева(?:ю|ет|ют|л|ла)|"
    r"проника(?:ю|ет|ют|л|ла)|вбега(?:ю|ет|ют|л|ла))|у\s+входа|на\s+пороге|снаружи|"
    r"останавлива(?:ет|ют|л|ла)|прегражда(?:ет|ют|л|ла)|не\s+пуска(?:ет|ют|л|ла))\b",
    re.IGNORECASE,
)


def _legacy__story_location_phrase_looks_concrete_v1(value: str) -> bool:

    normalized = " ".join(str(value or "").split()).strip(" ,.;:-")

    if len(normalized) < 4:

        return False

    lowered = normalized.casefold()

    if lowered.startswith(
        (
            "в него",
            "в нее",
            "в неё",
            "в них",
            "в это",
            "в этом",
            "на него",
            "на нее",
            "на неё",
            "на них",
            "на это",
            "у него",
            "у нее",
            "у неё",
            "у них",
            "рядом с ним",
            "рядом с ней",
        )
    ):

        return False

    if any(fragment in lowered for fragment in STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS):

        return True

    if re.search(r"[«\"'][^«»\"']{1,80}[»\"']", normalized):

        return True

    return bool(re.search(r"\b[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'-]{2,}\b", normalized))


def _legacy__build_story_location_fallback_payload_from_player_turn_v1(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> dict[str, str] | None:

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=900)

    if not normalized_user_prompt:

        return None

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=1_800)

    if normalized_latest_assistant and STORY_LOCATION_FALLBACK_ASSISTANT_BLOCKER_PATTERN.search(
        normalized_latest_assistant
    ):

        return None

    matches = list(STORY_LOCATION_FALLBACK_PLAYER_TURN_PATTERN.finditer(normalized_user_prompt))

    for match in reversed(matches):

        phrase = " ".join(str(match.group("phrase") or "").split()).strip(" ,.;:-")

        if not _story_location_phrase_looks_concrete(phrase):

            continue

        normalized_content = _normalize_story_location_memory_content(f"Действие происходит {phrase}.")

        if not normalized_content:

            continue

        return {
            "action": "update",
            "content": normalized_content,
            "label": _resolve_story_location_memory_label(content=normalized_content),
        }

    return None


def _legacy__normalize_story_location_memory_content_v2(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS:
        normalized = normalized[: STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?…") + "."
    if normalized[-1] not in ".!?…":
        normalized = f"{normalized}."

    normalized_casefold = normalized.casefold()
    for source_prefix, normalized_prefix in (
        ("действие происходит", "Действие происходит"),
        ("события происходят", "События происходят"),
    ):
        if normalized_casefold.startswith(source_prefix):
            suffix = normalized[len(source_prefix) :].lstrip()
            return f"{normalized_prefix}{f' {suffix}' if suffix else ''}"
    return ""


def _legacy__normalize_story_location_memory_label_v2(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip(" .,:;!?…")
    if not normalized:
        return ""

    normalized_casefold = normalized.casefold()
    for prefix in ("действие происходит ", "события происходят "):
        if normalized_casefold.startswith(prefix):
            normalized = normalized[len(prefix) :].strip(" .,:;!?…")
            break

    if not normalized:
        return ""
    if len(normalized) > 160:
        normalized = normalized[:159].rstrip(" ,;:-.!?…") + "…"
    if normalized and normalized[0].islower():
        normalized = normalized[:1].upper() + normalized[1:]
    return normalized


def _legacy__resolve_story_location_memory_label_v2(*, label: str | None = None, content: str | None = None) -> str:
    normalized_label = _normalize_story_location_memory_label(label or "")
    if normalized_label:
        return normalized_label
    return _normalize_story_location_memory_label(content or "")


def _legacy__sync_story_game_current_location_label_v2(game: StoryGame, label: str | None) -> bool:
    normalized_label = _normalize_story_location_memory_label(label or "")
    current_label = " ".join(str(getattr(game, "current_location_label", "") or "").split()).strip()
    if current_label == normalized_label:
        return False
    game.current_location_label = normalized_label
    return True


STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS = (
    "таверн",
    "трактир",
    "постоял",
    "гостин",
    "лагер",
    "лес",
    "рощ",
    "полян",
    "пещер",
    "шахт",
    "катакомб",
    "болот",
    "дорог",
    "тракт",
    "город",
    "столиц",
    "деревн",
    "сел",
    "квартал",
    "улиц",
    "площад",
    "рынок",
    "дом",
    "комнат",
    "камер",
    "зал",
    "коридор",
    "двор",
    "подвал",
    "чердак",
    "крыша",
    "башн",
    "замок",
    "крепост",
    "храм",
    "святилищ",
    "порт",
    "кораб",
    "берег",
    "пристан",
    "конюш",
    "кузниц",
    "лавк",
    "магазин",
    "мастерск",
    "кабинет",
    "библиотек",
    "сад",
    "кладбищ",
    "алле",
    "гавань",
    "река",
    "озер",
    "остров",
    "переулк",
    "мост",
    "тоннел",
    "платформ",
    "станц",
    "вагон",
    "шатер",
    "палатк",
)
STORY_LOCATION_FALLBACK_PLAYER_TURN_PATTERN = re.compile(
    r"\b(?:иду|идем|идём|пойду|подхожу|подойду|захожу|зайду|вхожу|войду|вбегаю|вбегу|"
    r"проникаю|проникну|возвращаюсь|вернусь|еду|приеду|направляюсь|отправляюсь|"
    r"остаюсь|останусь|нахожусь|сижу|стою|жду|двигаюсь|пробираюсь|спускаюсь|поднимаюсь)\s+"
    r"(?P<phrase>(?:в|во|на|у|под|над|около|возле|рядом с|среди|между|внутри|посреди|"
    r"за|перед|напротив)\s+[^,.!?:;\n]{2,120})",
    re.IGNORECASE,
)
STORY_LOCATION_FALLBACK_ASSISTANT_BLOCKER_PATTERN = re.compile(
    r"\b(?:не\s+(?:доходит|добира(?:юсь|ется|лся|лась)|входит|заходит|попадает|успевает|проникает|вбегает)"
    r"|у\s+входа|на\s+пороге|снаружи|останавливает|преграждает|не\s+пускает)\b",
    re.IGNORECASE,
)


def _legacy__story_location_phrase_looks_concrete_v2(value: str) -> bool:
    normalized = " ".join(str(value or "").split()).strip(" ,.;:-")
    if len(normalized) < 4:
        return False

    lowered = normalized.casefold()
    if lowered.startswith(
        (
            "в него",
            "в нее",
            "в неё",
            "в них",
            "в это",
            "в этом",
            "на него",
            "на нее",
            "на неё",
            "на них",
            "на это",
            "у него",
            "у нее",
            "у неё",
            "у них",
            "рядом с ним",
            "рядом с ней",
        )
    ):
        return False

    if any(fragment in lowered for fragment in STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS):
        return True
    if re.search(r"[«\"'][^«»\"']{1,80}[»\"']", normalized):
        return True
    return bool(re.search(r"\b[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'-]{2,}\b", normalized))


def _legacy__build_story_location_fallback_payload_from_player_turn_v2(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> dict[str, str] | None:
    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=900)
    if not normalized_user_prompt:
        return None

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=1_800)
    if normalized_latest_assistant and STORY_LOCATION_FALLBACK_ASSISTANT_BLOCKER_PATTERN.search(
        normalized_latest_assistant
    ):
        return None

    matches = list(STORY_LOCATION_FALLBACK_PLAYER_TURN_PATTERN.finditer(normalized_user_prompt))
    for match in reversed(matches):
        phrase = " ".join(str(match.group("phrase") or "").split()).strip(" ,.;:-")
        if not _story_location_phrase_looks_concrete(phrase):
            continue

        normalized_content = _normalize_story_location_memory_content(f"Действие происходит {phrase}.")
        if not normalized_content:
            continue

        return {
            "action": "update",
            "content": normalized_content,
            "label": _resolve_story_location_memory_label(content=normalized_content),
        }
    return None


def _legacy__extract_story_location_memory_payload_v1(
    *,

    current_location_content: str,

    latest_user_prompt: str,

    previous_assistant_text: str,

    latest_assistant_text: str,

) -> dict[str, str] | None:

    normalized_current_location = _normalize_story_location_memory_content(current_location_content)

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_200)

    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=2_400)

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=3_200)
    fallback_from_player_turn = _build_story_location_fallback_payload_from_player_turn(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    if not normalized_current_location and not normalized_previous_assistant and not normalized_latest_assistant:

        return fallback_from_player_turn

    if not settings.openrouter_api_key:

        return fallback_from_player_turn

    if not normalized_current_location and not normalized_previous_assistant and not normalized_latest_assistant:
        return None

    if not settings.openrouter_api_key:

        return None



    messages_payload = [

        {

            "role": "system",

            "content": (

                "Determine the current location of the active scene for RPG continuity. "

                "Use explicit evidence from the latest two narrator replies as the primary source. "
                "The latest player turn may also establish or refine the current place when it explicitly states where the hero enters, goes, stands, remains, or moves, "
                "and the newest narrator reply continues that same scene without contradicting that place. "
                "Never invent, expand, rename, or embellish a place. "
                "Never add a city, capital, district, country, kingdom, or world name just to make the place sound fuller. If that broader geography is not explicitly present in the recent scene text, omit it. "

                "Prefer the most specific currently active location that also keeps the wider context when it is explicit, "
                "and prefer the closest physical anchor of the current scene: doorway, entrance, threshold, counter, table, corridor, room, hall, yard, alley, stair, gate, platform, carriage, bank, shore, campfire, or similar immediate sublocation, when it is explicit. "

                "for example use 'Действие происходит в лагере разбойников в лесу.' instead of only '...в лагере разбойников.' "

                "Keep immediate enclosing context like forest, cave, district, temple wing, mountain pass, cellar, or shoreline when the narrator explicitly gives it. "
                "Do not widen a precise scene into a broader area. If the text gives 'Сѓ РІС…РѕРґР° РІ Р·РґР°РЅРёРµ РіРёР»СЊРґРёРё Р°РІР°РЅС‚СЋСЂРёСЃС‚РѕРІ', do not reduce it to 'РЅР° СѓР»РёС†Р°С… РіРѕСЂРѕРґР°', 'Сѓ РіРёР»СЊРґРёРё', or another broader outdoor label. "

                "If the newest narrator reply does not clearly restate a current place, keep the saved place when it is still valid. "
                "If there is no valid saved place yet, you may use the latest explicit player-stated place only when the newest narrator reply continues that same scene without contradiction. "
                "If the newest narrator reply suddenly conflicts with the saved location but there is no explicit transition, travel, arrival, exit, or sustained scene change across the last two narrator replies, return keep. "

                "Return strict JSON only without markdown. "

                "Valid outputs are exactly: "

                "{\"action\":\"keep\"} "

                "or "

                "{\"action\":\"update\",\"content\":\"Действие происходит ...\",\"label\":\"В ...\"}. "
                "For action=update, content must be exactly one short Russian sentence starting with "

                "\"Действие происходит\" or \"События происходят\". "

                "For action=update, label must be a short Russian UI label without a final period, "

                "2-12 words, max 160 chars, with the explicit place and immediate context, for example "

                "\"В школьной библиотеке\" or \"В лагере разбойников в лесу\". "

                "Do not use pronouns, placeholders, or vague labels like \"здесь\"."
            ),

        },

        {

            "role": "user",

            "content": (

                f"Текущее сохраненное место:\n{normalized_current_location or 'нет'}\n\n"

                f"Последний ход игрока:\n{normalized_user_prompt or 'нет'}\n\n"

                f"Предыдущий ответ мастера:\n{normalized_previous_assistant or 'нет'}\n\n"

                f"Новый ответ мастера:\n{normalized_latest_assistant or 'нет'}"

            ),

        },

    ]

    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name="x-ai/grok-4.1-fast",
                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.0,

                max_tokens=STORY_MEMORY_LOCATION_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story location memory extraction failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.25)

                continue

            return None



        normalized_response = raw_response.replace("\r\n", "\n").strip()

        if not normalized_response:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None

        if normalized_response.upper() == "KEEP":

            return {"action": "keep"}



        parsed_payload = _extract_json_object_from_text(normalized_response)

        if not isinstance(parsed_payload, dict) or not parsed_payload:
            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None



        raw_action = str(parsed_payload.get("action") or "").strip().lower()

        if raw_action in {"keep", "leave", "preserve", "unchanged", "same"}:

            return {"action": "keep"}



        raw_content = (

            parsed_payload.get("content")

            or parsed_payload.get("location_sentence")

            or ""

        )

        normalized_content = _normalize_story_location_memory_content(str(raw_content))

        if normalized_content:

            return {

                "action": "update",

                "content": normalized_content,

                "label": _resolve_story_location_memory_label(

                    label=str(parsed_payload.get("label") or parsed_payload.get("short_label") or ""),

                    content=normalized_content,

                ),

            }


        if attempt_index == 0:

            time.sleep(0.15)

            continue

        return None



    return None





def _extract_story_location_memory_payload(
    *,
    current_location_content: str,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
) -> dict[str, str] | None:

    normalized_current_location = _normalize_story_location_memory_content(current_location_content)
    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_200)
    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=2_400)
    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=3_200)
    if (
        not normalized_current_location
        and not normalized_user_prompt
        and not normalized_previous_assistant
        and not normalized_latest_assistant
    ):
        return None

    if not settings.openrouter_api_key:
        return None


    messages_payload = [
        {
            "role": "system",
            "content": (
                "Determine the current location of the active scene for RPG continuity. "
                "Use explicit evidence from the latest two narrator replies as the primary source. "
                "The latest player turn may also establish or refine the current place when it explicitly states where the hero enters, goes, stands, remains, or moves, "
                "and the newest narrator reply continues that same scene without contradicting that place. "
                "Never invent, expand, rename, or embellish a place. "
                "Never add a city, capital, district, country, kingdom, or world name just to make the place sound fuller. If that broader geography is not explicitly present in the recent scene text, omit it. "
                "Prefer the most specific currently active location that also keeps the wider context when it is explicit, "
                "for example use 'Действие происходит в лагере разбойников в лесу.' instead of only '...в лагере разбойников.' "
                "Keep immediate enclosing context like forest, cave, district, temple wing, mountain pass, cellar, or shoreline when the narrator explicitly gives it. "
                "If the newest narrator reply does not clearly restate a current place, keep the saved place when it is still valid. "
                "If there is no valid saved place yet, you may use the latest explicit player-stated place only when the newest narrator reply continues that same scene without contradiction. "
                "If the newest narrator reply suddenly conflicts with the saved location but there is no explicit transition, travel, arrival, exit, or sustained scene change across the last two narrator replies, return keep. "
                "If the text only gives a local scene like hot springs near Tokyo, a school corridor, a bench by the library, or a room in an inn, do not replace it with a made-up city, capital, kingdom, tavern, or world label. "
                "Prefer the closest physical anchor of the current scene when it is explicit: doorway, entrance, threshold, counter, table, corridor, room, hall, yard, alley, stair, gate, platform, carriage, bank, shore, campfire, or similar immediate sublocation. "
                "Do not widen a precise scene into a broader area. If the text gives 'Сѓ РІС…РѕРґР° РІ Р·РґР°РЅРёРµ РіРёР»СЊРґРёРё Р°РІР°РЅС‚СЋСЂРёСЃС‚РѕРІ', do not reduce it to 'РЅР° СѓР»РёС†Р°С… РіРѕСЂРѕРґР°', 'Сѓ РіРёР»СЊРґРёРё', or another broader outdoor label. "
                "Remove time-of-day wording from the location itself. Keep the place, but drop suffixes like 'РЅРѕС‡СЊСЋ', 'РІРµС‡РµСЂРѕРј', 'СѓС‚СЂРѕРј', 'РІ 16:00', or similar time markers. "
                "Return strict JSON only without markdown. "
                "Valid outputs are exactly: "
                "{\"action\":\"keep\"} "
                "or "
                "{\"action\":\"update\",\"content\":\"Действие происходит ...\",\"label\":\"В ...\"}. "
                "For action=update, content must be exactly one short Russian sentence starting with "
                "\"Действие происходит\" or \"События происходят\". "
                "For action=update, label must be a short Russian UI label without a final period, "
                "2-12 words, max 160 chars, with the explicit place and immediate context, for example "
                "\"В школьной библиотеке\" or \"В лагере разбойников в лесу\". "
                "Do not use pronouns, placeholders, or vague labels like \"здесь\"."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Текущее сохраненное место:\n{normalized_current_location or 'нет'}\n\n"
                f"Последний ход игрока:\n{normalized_user_prompt or 'нет'}\n\n"
                f"Предыдущий ответ мастера:\n{normalized_previous_assistant or 'нет'}\n\n"
                f"Новый ответ мастера:\n{normalized_latest_assistant or 'нет'}"
            ),
        },
    ]

    for attempt_index in range(2):
        try:
            raw_response = _request_openrouter_story_text(
                messages_payload,
                model_name="x-ai/grok-4.1-fast",
                allow_free_fallback=False,
                translate_input=False,
                fallback_model_names=[],
                temperature=0.0,
                max_tokens=STORY_MEMORY_LOCATION_REQUEST_MAX_TOKENS,
                request_timeout=(
                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
                ),
            )
        except Exception as exc:
            logger.warning(
                "Story location memory extraction failed on attempt %s/2: %s",
                attempt_index + 1,
                exc,
            )
            if attempt_index == 0:
                time.sleep(0.25)
                continue
            return None

        normalized_response = raw_response.replace("\r\n", "\n").strip()
        if not normalized_response:
            if attempt_index == 0:
                time.sleep(0.15)
                continue
            return None

        if normalized_response.upper() == "KEEP":
            return {"action": "keep"}

        parsed_payload = _extract_json_object_from_text(normalized_response)
        if not isinstance(parsed_payload, dict) or not parsed_payload:
            if attempt_index == 0:
                time.sleep(0.15)
                continue
            return None

        raw_action = str(parsed_payload.get("action") or "").strip().lower()
        if raw_action in {"keep", "leave", "preserve", "unchanged", "same"}:
            return {"action": "keep"}

        raw_content = (
            parsed_payload.get("content")
            or parsed_payload.get("location_sentence")
            or ""
        )
        normalized_content = _normalize_story_location_memory_content(str(raw_content))
        if normalized_content:
            return {
                "action": "update",
                "content": normalized_content,
                "label": _resolve_story_location_memory_label(
                    label=str(parsed_payload.get("label") or parsed_payload.get("short_label") or ""),
                    content=normalized_content,
                ),
            }

        if attempt_index == 0:
            time.sleep(0.15)
            continue

        return None

    return None


_LOCATION_SENTENCE_ACTION_LOWER = (
    "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442"
)
_LOCATION_SENTENCE_ACTION = (
    "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u0438\u0442"
)
_LOCATION_SENTENCE_EVENTS_LOWER = (
    "\u0441\u043e\u0431\u044b\u0442\u0438\u044f \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u044f\u0442"
)
_LOCATION_SENTENCE_EVENTS = (
    "\u0421\u043e\u0431\u044b\u0442\u0438\u044f \u043f\u0440\u043e\u0438\u0441\u0445\u043e\u0434\u044f\u0442"
)
_LOCATION_LABEL_STRIP_CHARS = " .,:;!?\u2026"
_LOCATION_FALLBACK_BAD_PREFIXES = (
    "\u0432 \u043d\u0435\u0433\u043e",
    "\u0432 \u043d\u0435\u0435",
    "\u0432 \u043d\u0435\u0451",
    "\u0432 \u043d\u0438\u0445",
    "\u0432 \u044d\u0442\u043e",
    "\u0432 \u044d\u0442\u043e\u043c",
    "\u043d\u0430 \u043d\u0435\u0433\u043e",
    "\u043d\u0430 \u043d\u0435\u0435",
    "\u043d\u0430 \u043d\u0435\u0451",
    "\u043d\u0430 \u043d\u0438\u0445",
    "\u043d\u0430 \u044d\u0442\u043e",
    "\u0443 \u043d\u0435\u0433\u043e",
    "\u0443 \u043d\u0435\u0435",
    "\u0443 \u043d\u0435\u0451",
    "\u0443 \u043d\u0438\u0445",
    "\u0440\u044f\u0434\u043e\u043c \u0441 \u043d\u0438\u043c",
    "\u0440\u044f\u0434\u043e\u043c \u0441 \u043d\u0435\u0439",
)
STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS = (
    "\u0442\u0430\u0432\u0435\u0440\u043d",
    "\u0442\u0440\u0430\u043a\u0442\u0438\u0440",
    "\u043b\u0430\u0433\u0435\u0440",
    "\u043b\u0435\u0441",
    "\u043f\u043e\u043b\u044f\u043d",
    "\u043f\u0435\u0449\u0435\u0440",
    "\u0431\u043e\u043b\u043e\u0442",
    "\u0434\u043e\u0440\u043e\u0433",
    "\u0442\u0440\u0430\u043a\u0442",
    "\u0433\u043e\u0440\u043e\u0434",
    "\u0441\u0442\u043e\u043b\u0438\u0446",
    "\u0434\u0435\u0440\u0435\u0432\u043d",
    "\u0441\u0435\u043b",
    "\u043a\u0432\u0430\u0440\u0442\u0430\u043b",
    "\u0443\u043b\u0438\u0446",
    "\u043f\u043b\u043e\u0449\u0430\u0434",
    "\u0440\u044b\u043d\u043e\u043a",
    "\u0434\u043e\u043c",
    "\u043a\u043e\u043c\u043d\u0430\u0442",
    "\u043a\u0430\u043c\u0435\u0440",
    "\u0437\u0430\u043b",
    "\u043a\u043e\u0440\u0438\u0434\u043e\u0440",
    "\u0434\u0432\u043e\u0440",
    "\u043f\u043e\u0434\u0432\u0430\u043b",
    "\u0447\u0435\u0440\u0434\u0430\u043a",
    "\u043a\u0440\u044b\u0448",
    "\u0431\u0430\u0448\u043d",
    "\u0437\u0430\u043c\u043e\u043a",
    "\u043a\u0440\u0435\u043f\u043e\u0441\u0442",
    "\u0445\u0440\u0430\u043c",
    "\u0441\u0432\u044f\u0442\u0438\u043b\u0438\u0449",
    "\u043f\u043e\u0440\u0442",
    "\u043a\u043e\u0440\u0430\u0431",
    "\u0431\u0435\u0440\u0435\u0433",
    "\u043f\u0440\u0438\u0441\u0442\u0430\u043d",
    "\u043a\u0443\u0437\u043d\u0438\u0446",
    "\u043b\u0430\u0432\u043a",
    "\u043c\u0430\u0433\u0430\u0437\u0438\u043d",
    "\u043a\u0430\u0431\u0438\u043d\u0435\u0442",
    "\u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a",
    "\u0441\u0430\u0434",
    "\u043a\u043b\u0430\u0434\u0431\u0438\u0449",
    "\u0433\u0430\u0432\u0430\u043d\u044c",
    "\u0440\u0435\u043a\u0430",
    "\u043e\u0437\u0435\u0440",
    "\u043e\u0441\u0442\u0440\u043e\u0432",
    "\u043f\u0435\u0440\u0435\u0443\u043b\u043e\u043a",
    "\u043c\u043e\u0441\u0442",
    "\u0442\u043e\u043d\u043d\u0435\u043b",
    "\u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c",
    "\u0441\u0442\u0430\u043d\u0446",
    "\u0432\u0430\u0433\u043e\u043d",
    "\u0448\u0430\u0442\u0435\u0440",
    "\u043f\u0430\u043b\u0430\u0442\u043a",
)
STORY_LOCATION_FALLBACK_PLAYER_TURN_PATTERN = re.compile(
    r"\b(?:"
    r"\u0438\u0434\u0443|\u0438\u0434\u0435\u043c|\u0438\u0434\u0451\u043c|"
    r"\u043f\u043e\u0439\u0434\u0443|\u043f\u043e\u0434\u0445\u043e\u0436\u0443|\u043f\u043e\u0434\u043e\u0439\u0434\u0443|"
    r"\u0437\u0430\u0445\u043e\u0436\u0443|\u0437\u0430\u0439\u0434\u0443|"
    r"\u0432\u0445\u043e\u0436\u0443|\u0432\u043e\u0439\u0434\u0443|"
    r"\u0432\u0431\u0435\u0433\u0430\u044e|\u0432\u0431\u0435\u0433\u0443|"
    r"\u043f\u0440\u043e\u043d\u0438\u043a\u0430\u044e|\u043f\u0440\u043e\u043d\u0438\u043a\u043d\u0443|"
    r"\u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u044e\u0441\u044c|\u0432\u0435\u0440\u043d\u0443\u0441\u044c|"
    r"\u0435\u0434\u0443|\u043f\u0440\u0438\u0435\u0434\u0443|"
    r"\u043d\u0430\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0441\u044c|\u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u0441\u044c|"
    r"\u043e\u0441\u0442\u0430\u044e\u0441\u044c|\u043e\u0441\u0442\u0430\u043d\u0443\u0441\u044c|"
    r"\u043d\u0430\u0445\u043e\u0436\u0443\u0441\u044c|\u0441\u0438\u0436\u0443|\u0441\u0442\u043e\u044e|\u0436\u0434\u0443|"
    r"\u0434\u0432\u0438\u0433\u0430\u044e\u0441\u044c|\u043f\u0440\u043e\u0431\u0438\u0440\u0430\u044e\u0441\u044c|"
    r"\u0441\u043f\u0443\u0441\u043a\u0430\u044e\u0441\u044c|\u043f\u043e\u0434\u043d\u0438\u043c\u0430\u044e\u0441\u044c"
    r")\s+"
    r"(?P<phrase>(?:"
    r"\u0432|\u0432\u043e|\u043d\u0430|\u0443|\u043f\u043e\u0434|\u043d\u0430\u0434|"
    r"\u043e\u043a\u043e\u043b\u043e|\u0432\u043e\u0437\u043b\u0435|"
    r"\u0440\u044f\u0434\u043e\u043c \u0441|\u0441\u0440\u0435\u0434\u0438|"
    r"\u043c\u0435\u0436\u0434\u0443|\u0432\u043d\u0443\u0442\u0440\u0438|\u043f\u043e\u0441\u0440\u0435\u0434\u0438|"
    r"\u0437\u0430|\u043f\u0435\u0440\u0435\u0434|\u043d\u0430\u043f\u0440\u043e\u0442\u0438\u0432"
    r")\s+[^,.!?:;\n]{2,120})",
    re.IGNORECASE,
)
STORY_LOCATION_FALLBACK_ASSISTANT_BLOCKER_PATTERN = re.compile(
    r"\b(?:"
    r"\u043d\u0435\s+(?:"
    r"\u0434\u043e\u0445\u043e\u0434\u0438\u0442|"
    r"\u0434\u043e\u0431\u0438\u0440\u0430(?:\u044e\u0441\u044c|\u0435\u0442\u0441\u044f|\u043b\u0441\u044f|\u043b\u0430\u0441\u044c)|"
    r"\u0432\u0445\u043e\u0434\u0438\u0442|"
    r"\u0437\u0430\u0445\u043e\u0434\u0438\u0442|"
    r"\u043f\u043e\u043f\u0430\u0434\u0430\u0435\u0442|"
    r"\u0443\u0441\u043f\u0435\u0432\u0430\u0435\u0442|"
    r"\u043f\u0440\u043e\u043d\u0438\u043a\u0430\u0435\u0442|"
    r"\u0432\u0431\u0435\u0433\u0430\u0435\u0442"
    r")|"
    r"\u0443\s+\u0432\u0445\u043e\u0434\u0430|"
    r"\u043d\u0430\s+\u043f\u043e\u0440\u043e\u0433\u0435|"
    r"\u0441\u043d\u0430\u0440\u0443\u0436\u0438|"
    r"\u043e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u0442|"
    r"\u043f\u0440\u0435\u0433\u0440\u0430\u0436\u0434\u0430\u0435\u0442|"
    r"\u043d\u0435\s+\u043f\u0443\u0441\u043a\u0430\u0435\u0442"
    r")\b",
    re.IGNORECASE,
)


def _legacy__normalize_story_location_memory_content_v3(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS:
        normalized = normalized[: STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?\u2026") + "."
    if normalized[-1] not in ".!?\u2026":
        normalized = f"{normalized}."

    normalized_casefold = normalized.casefold()
    for source_prefix, normalized_prefix in (
        (_LOCATION_SENTENCE_ACTION_LOWER, _LOCATION_SENTENCE_ACTION),
        (_LOCATION_SENTENCE_EVENTS_LOWER, _LOCATION_SENTENCE_EVENTS),
    ):
        if normalized_casefold.startswith(source_prefix):
            suffix = normalized[len(source_prefix) :].lstrip()
            return f"{normalized_prefix}{f' {suffix}' if suffix else ''}"
    return ""


def _legacy__normalize_story_location_memory_label_v3(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip(_LOCATION_LABEL_STRIP_CHARS)
    if not normalized:
        return ""

    normalized_casefold = normalized.casefold()
    for prefix in (f"{_LOCATION_SENTENCE_ACTION_LOWER} ", f"{_LOCATION_SENTENCE_EVENTS_LOWER} "):
        if normalized_casefold.startswith(prefix):
            normalized = normalized[len(prefix) :].strip(_LOCATION_LABEL_STRIP_CHARS)
            break

    if not normalized:
        return ""
    if len(normalized) > 160:
        normalized = normalized[:159].rstrip(" ,;:-.!?\u2026") + "\u2026"
    if normalized and normalized[0].islower():
        normalized = normalized[:1].upper() + normalized[1:]
    return normalized


def _legacy__resolve_story_location_memory_label_v3(*, label: str | None = None, content: str | None = None) -> str:
    normalized_label = _normalize_story_location_memory_label(label or "")
    if normalized_label:
        return normalized_label
    return _normalize_story_location_memory_label(content or "")


def _sync_story_game_current_location_label(game: StoryGame, label: str | None) -> bool:
    normalized_label = _normalize_story_location_memory_label(label or "")
    current_label = " ".join(str(getattr(game, "current_location_label", "") or "").split()).strip()
    if current_label == normalized_label:
        return False
    game.current_location_label = normalized_label
    return True


def _story_location_phrase_looks_concrete(value: str) -> bool:
    normalized = " ".join(str(value or "").split()).strip(" ,.;:-")
    if len(normalized) < 4:
        return False

    lowered = normalized.casefold()
    if lowered.startswith(_LOCATION_FALLBACK_BAD_PREFIXES):
        return False
    if any(fragment in lowered for fragment in STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS):
        return True
    if re.search(r"[«\"'][^«»\"']{1,80}[»\"']", normalized):
        return True
    return bool(
        re.search(
            r"\b[\u0410-\u042f\u0401][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451'-]{2,}\b",
            normalized,
        )
    )


def _build_story_location_fallback_payload_from_player_turn(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> dict[str, str] | None:
    return None


def _normalize_story_location_memory_content(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS:
        normalized = normalized[: STORY_MEMORY_LOCATION_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?\u2026") + "."
    if normalized[-1] not in ".!?\u2026":
        normalized = f"{normalized}."
    normalized = _strip_story_location_time_context(normalized)
    if not normalized:
        return ""

    normalized_casefold = normalized.casefold()
    for source_prefix, normalized_prefix in (
        (_LOCATION_SENTENCE_ACTION_LOWER, _LOCATION_SENTENCE_ACTION),
        (_LOCATION_SENTENCE_EVENTS_LOWER, _LOCATION_SENTENCE_EVENTS),
    ):
        if normalized_casefold.startswith(source_prefix):
            suffix = normalized[len(source_prefix) :].lstrip()
            return f"{normalized_prefix}{f' {suffix}' if suffix else ''}"
    return ""


def _normalize_story_location_memory_label(value: str) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").split()).strip(_LOCATION_LABEL_STRIP_CHARS)
    if not normalized:
        return ""

    normalized_casefold = normalized.casefold()
    for prefix in (f"{_LOCATION_SENTENCE_ACTION_LOWER} ", f"{_LOCATION_SENTENCE_EVENTS_LOWER} "):
        if normalized_casefold.startswith(prefix):
            normalized = normalized[len(prefix) :].strip(_LOCATION_LABEL_STRIP_CHARS)
            break
    normalized = _strip_story_location_time_context(normalized).strip(_LOCATION_LABEL_STRIP_CHARS)

    if not normalized:
        return ""
    if len(normalized) > 160:
        normalized = normalized[:159].rstrip(" ,;:-.!?\u2026") + "\u2026"
    if normalized and normalized[0].islower():
        normalized = normalized[:1].upper() + normalized[1:]
    return normalized


def _resolve_story_location_memory_label(*, label: str | None = None, content: str | None = None) -> str:
    normalized_label = _normalize_story_location_memory_label(label or "")
    if normalized_label:
        return normalized_label
    return _normalize_story_location_memory_label(content or "")


_STORY_LOCATION_TRAILING_NAMED_TAIL_PATTERN = re.compile(
    r"(?P<head>.+)\s+(?P<tail>(?:в|во|на|у|около|возле|рядом с|внутри|посреди|за|перед|напротив)\s+(?:[а-яё-]+\s+){0,4}[А-ЯЁA-Z][^,.!?:;\n]{1,96})$",
    re.IGNORECASE,
)

_STORY_LOCATION_NAMED_TOKEN_STOPWORDS = {
    "действие",
    "события",
    "в",
    "во",
    "на",
    "у",
    "около",
    "возле",
    "рядом",
    "с",
    "внутри",
    "посреди",
    "за",
    "перед",
    "напротив",
    "городе",
    "город",
    "столице",
    "столица",
    "районе",
    "район",
    "квартале",
    "квартал",
    "стране",
    "страна",
    "королевстве",
    "королевство",
    "империи",
    "империя",
    "провинции",
    "провинция",
    "области",
    "область",
}


def _story_location_phrase_has_local_keyword_fragment(value: str) -> bool:
    lowered = " ".join(str(value or "").split()).casefold()
    if not lowered:
        return False
    return any(fragment in lowered for fragment in STORY_LOCATION_FALLBACK_KEYWORD_FRAGMENTS)


def _extract_story_location_named_tokens_for_support(value: str) -> list[str]:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        return []
    named_tokens: list[str] = []
    seen_tokens: set[str] = set()
    for token in re.findall(r"\b[А-ЯЁA-Z][A-Za-zА-Яа-яЁё'-]{2,}\b", normalized):
        lowered = token.casefold()
        if lowered in _STORY_LOCATION_NAMED_TOKEN_STOPWORDS:
            continue
        if lowered in seen_tokens:
            continue
        seen_tokens.add(lowered)
        named_tokens.append(token)
    return named_tokens


def _sanitize_story_location_memory_content_against_recent_scene(
    *,
    content: str,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
) -> str:
    normalized_content = _normalize_story_location_memory_content(content)
    if not normalized_content:
        return ""

    phrase = _normalize_story_location_memory_label(normalized_content)
    if not phrase:
        return normalized_content

    recent_source_text = " ".join(
        part.casefold()
        for part in (
            _normalize_story_prompt_text(latest_user_prompt, max_chars=1_200),
            _normalize_story_prompt_text(previous_assistant_text, max_chars=2_400),
            _normalize_story_prompt_text(latest_assistant_text, max_chars=3_200),
        )
        if part
    ).strip()
    if not recent_source_text:
        return normalized_content

    current_phrase = phrase
    for _ in range(3):
        tail_match = _STORY_LOCATION_TRAILING_NAMED_TAIL_PATTERN.search(current_phrase)
        if not tail_match:
            break
        candidate_head = " ".join(str(tail_match.group("head") or "").split()).strip(_LOCATION_LABEL_STRIP_CHARS)
        candidate_tail = " ".join(str(tail_match.group("tail") or "").split()).strip(_LOCATION_LABEL_STRIP_CHARS)
        tail_named_tokens = _extract_story_location_named_tokens_for_support(candidate_tail)
        if not tail_named_tokens:
            break
        unsupported_tail_tokens = [
            token for token in tail_named_tokens if token.casefold() not in recent_source_text
        ]
        if not unsupported_tail_tokens:
            break
        if not candidate_head or not _story_location_phrase_looks_concrete(candidate_head):
            return ""
        current_phrase = candidate_head

    remaining_named_tokens = _extract_story_location_named_tokens_for_support(current_phrase)
    unsupported_remaining_tokens = [
        token for token in remaining_named_tokens if token.casefold() not in recent_source_text
    ]
    if unsupported_remaining_tokens and not _story_location_phrase_has_local_keyword_fragment(current_phrase):
        return ""

    if current_phrase and current_phrase[0].isupper():
        current_phrase = current_phrase[:1].lower() + current_phrase[1:]

    return _normalize_story_location_memory_content(f"{_LOCATION_SENTENCE_ACTION} {current_phrase}.")


def _upsert_story_location_memory_block(
    *,
    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage,

    latest_user_prompt: str | None = None,

    latest_assistant_text: str | None = None,

    previous_assistant_text: str | None = None,

    resolved_payload_override: dict[str, str] | None = None,

) -> bool:

    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:

        return False



    resolved_latest_user_prompt = (

        latest_user_prompt.replace("\r\n", "\n").strip()

        if isinstance(latest_user_prompt, str)

        else _get_story_user_prompt_before_assistant_message(

            db,

            game_id=game.id,

            assistant_message_id=assistant_message.id,

        )

    )

    resolved_latest_assistant_text = (

        latest_assistant_text.replace("\r\n", "\n").strip()

        if isinstance(latest_assistant_text, str)

        else _normalize_story_assistant_text_for_memory(assistant_message.content)

    )

    if not resolved_latest_assistant_text:

        resolved_latest_assistant_text = assistant_message.content.replace("\r\n", "\n").strip()

    if not resolved_latest_assistant_text:

        return False



    location_blocks_desc = sorted(

        [

            block

            for block in _list_story_memory_blocks(db, game.id)

            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_LOCATION

        ],

        key=lambda block: block.id,

        reverse=True,

    )

    current_blocks = [

        block

        for block in location_blocks_desc

        if int(getattr(block, "assistant_message_id", 0) or 0) == assistant_message.id

    ]

    current_block = current_blocks[0] if current_blocks else None

    duplicate_blocks = current_blocks[1:]

    previous_location_block = next(

        (

            block

            for block in location_blocks_desc

            if int(getattr(block, "assistant_message_id", 0) or 0) != assistant_message.id

        ),

        None,

    )

    previous_location_content = (

        _normalize_story_location_memory_content(previous_location_block.content)

        if isinstance(previous_location_block, StoryMemoryBlock)

        else ""

    )

    previous_location_label = _resolve_story_location_memory_label(

        label=str(getattr(game, "current_location_label", "") or ""),

        content=previous_location_content,

    )
    resolved_previous_assistant_text = (
        previous_assistant_text.replace("\r\n", "\n").strip()

        if isinstance(previous_assistant_text, str)

        else _get_story_previous_assistant_text_before_message(

            db,

            game_id=game.id,

            assistant_message_id=assistant_message.id,

        )

    )

    resolved_payload = (
        _normalize_story_location_analysis_payload(resolved_payload_override)
        if isinstance(resolved_payload_override, dict)
        else _extract_story_location_memory_payload(
            current_location_content=previous_location_content,
            latest_user_prompt=resolved_latest_user_prompt,
            previous_assistant_text=resolved_previous_assistant_text,
            latest_assistant_text=resolved_latest_assistant_text,
        )
    )



    changed = False

    if resolved_payload is None:

        if duplicate_blocks:

            for block in duplicate_blocks:

                db.delete(block)

            db.flush()

            return True
        return False



    if resolved_payload.get("action") == "keep":

        current_location_content = (
            _normalize_story_location_memory_content(current_block.content)
            if isinstance(current_block, StoryMemoryBlock)
            else ""
        )
        current_location_label = _resolve_story_location_memory_label(
            label="",
            content=current_location_content,
        )
        label_changed = _sync_story_game_current_location_label(
            game,
            current_location_label or previous_location_label,
        )
        if current_block is not None:
            changed = False
            for block in duplicate_blocks:

                db.delete(block)
                changed = True

            if changed or label_changed:

                db.flush()

                logger.info(

                    "Story location memory preserved existing block: game_id=%s assistant_message_id=%s current=%s",

                    game.id,

                    assistant_message.id,

                    current_location_content or previous_location_content or "none",

                )

                return True

            return False

        if label_changed:

            db.flush()

            return True

        return False



    normalized_content = _normalize_story_location_memory_content(
        str(resolved_payload.get("content") or "")
    )
    normalized_label = _resolve_story_location_memory_label(

        label=str(resolved_payload.get("label") or ""),

        content=normalized_content,

    )
    if not normalized_content:

        label_changed = _sync_story_game_current_location_label(
            game,
            previous_location_label,
        )
        if duplicate_blocks:

            for block in duplicate_blocks:

                db.delete(block)

            db.flush()

            return True

        if label_changed:

            db.flush()

            return True

        return False



    if previous_location_content and normalized_content.casefold() == previous_location_content.casefold():

        label_changed = _sync_story_game_current_location_label(game, normalized_label or previous_location_label)
        if current_blocks:
            for block in current_blocks:

                db.delete(block)

            db.flush()

            return True

        if label_changed:

            db.flush()

            return True

        return False



    normalized_title = _normalize_story_memory_block_title(
        STORY_MEMORY_LOCATION_TITLE,

        fallback=STORY_MEMORY_LOCATION_TITLE,

    )

    if current_block is not None:

        next_token_count = max(_estimate_story_tokens(normalized_content), 1)

        if (

            current_block.title != normalized_title

            or current_block.content != normalized_content

            or int(getattr(current_block, "token_count", 0) or 0) != next_token_count

        ):

            current_block.title = normalized_title

            current_block.content = normalized_content

            current_block.token_count = next_token_count

            changed = True

        for block in duplicate_blocks:

            db.delete(block)

            changed = True

        if changed:

            db.flush()

    else:

        _create_story_memory_block(

            db=db,

            game_id=game.id,

            assistant_message_id=assistant_message.id,

            layer=STORY_MEMORY_LAYER_LOCATION,

            title=normalized_title,

            content=normalized_content,

            preserve_content=True,

        )

        changed = True



    if _sync_story_game_current_location_label(game, normalized_label):

        changed = True

        db.flush()

    if changed:
        logger.info(

            "Story location memory updated: game_id=%s assistant_message_id=%s location=%s",

            game.id,

            assistant_message.id,

            normalized_content,

        )

    return changed





def _get_story_latest_memory_block_by_layer(

    *,

    db: Session,

    game_id: int,

    layer: str,

) -> StoryMemoryBlock | None:

    normalized_layer = _normalize_story_memory_layer(layer)

    return next(

        (

            block

            for block in sorted(_list_story_memory_blocks(db, game_id), key=lambda item: item.id, reverse=True)

            if _normalize_story_memory_layer(block.layer) == normalized_layer

        ),

        None,

    )





def _get_story_latest_location_memory_content(

    *,

    db: Session,

    game_id: int,

) -> str:

    latest_block = _get_story_latest_memory_block_by_layer(

        db=db,

        game_id=game_id,

        layer=STORY_MEMORY_LAYER_LOCATION,

    )

    if not isinstance(latest_block, StoryMemoryBlock):

        return ""

    return _normalize_story_location_memory_content(latest_block.content)





def _describe_story_environment_time_of_day(value: datetime | None) -> str:

    if not isinstance(value, datetime):

        return ""

    hour = int(value.hour)

    if 5 <= hour < 12:

        return "утро"

    if 12 <= hour < 18:

        return "день"

    if 18 <= hour < 23:

        return "вечер"

    return "ночь"





def _story_environment_season_key(value: datetime | None) -> str:

    if not isinstance(value, datetime):

        return ""

    month = int(value.month)

    if month in {12, 1, 2}:

        return "winter"

    if month in {3, 4, 5}:

        return "spring"

    if month in {6, 7, 8}:

        return "summer"

    return "autumn"





def _story_environment_season_label(value: datetime | None) -> str:

    return STORY_ENVIRONMENT_SEASON_LABELS_RU.get(_story_environment_season_key(value), "")





def _story_environment_weekday_short_label(value: datetime | None) -> str:

    if not isinstance(value, datetime):

        return ""

    weekday_index = max(0, min(int(value.weekday()), len(STORY_ENVIRONMENT_WEEKDAY_SHORT_NAMES_RU) - 1))

    return STORY_ENVIRONMENT_WEEKDAY_SHORT_NAMES_RU[weekday_index]





def _format_story_environment_datetime_label(value: datetime | None) -> str:

    if not isinstance(value, datetime):

        return ""

    month_label = STORY_ENVIRONMENT_MONTH_NAMES_RU[max(min(value.month, 12), 1) - 1]

    time_of_day = _describe_story_environment_time_of_day(value)

    weekday_label = _story_environment_weekday_short_label(value)

    season_label = _story_environment_season_label(value)

    meta_prefix = " · ".join(part for part in [weekday_label, season_label] if part)

    return (

        f"{meta_prefix + '. ' if meta_prefix else ''}"

        f"{value.day} {month_label} {value.year} года, {time_of_day}. "

        f"Время: {value.strftime('%H:%M')}."

    )





def _format_story_environment_datetime_prompt_facts(value: datetime | None) -> str:

    if not isinstance(value, datetime):

        return ""

    month_label = STORY_ENVIRONMENT_MONTH_NAMES_RU[max(min(value.month, 12), 1) - 1]

    time_of_day = _describe_story_environment_time_of_day(value)

    weekday_label = _story_environment_weekday_short_label(value)

    season_label = _story_environment_season_label(value)

    return (

        f"Дата: {value.day} {month_label} {value.year} года.\n"

        f"День недели: {weekday_label or 'не определен'}.\n"

        f"Сезон: {season_label or 'не определен'}.\n"

        f"Точное время сейчас: {value.strftime('%H:%M')}.\n"

        f"Часть суток: {time_of_day}.\n"

        "Грубые разговорные формулировки вроде 'два ночи', 'около трех' или 'под утро' "

        "считай приблизительными и не меняющими точные минуты сами по себе."

    )





STORY_ENVIRONMENT_PRECISE_CLOCK_PATTERN = re.compile(r"\b(?:[01]?\d|2[0-3])[:.](?:[0-5]\d)\b", re.IGNORECASE)

STORY_ENVIRONMENT_APPROXIMATE_HOUR_PATTERN = re.compile(

    r"\b(?:около|примерно|где-?то\s+около|почти|уже|лишь|под)?\s*"

    r"(?:полноч[ьи]|полдень|[01]?\d|2[0-3])\s*"

    r"(?:час(?:а|ов)?|ночи|утра|дня|вечера)\b"

    r"|\bпод\s+утро\b|\bк\s+утру\b|\bк\s+вечеру\b",

    re.IGNORECASE,

)

STORY_ENVIRONMENT_EXPLICIT_SKIP_PATTERN = re.compile(

    r"\b(?:"

    r"спустя|через|прош(?:ел|ло|ла|ли)|минул(?:о|и)|"

    r"на\s+следующ(?:ее|ий|ую)\s+(?:утро|день|вечер|ночь)|"

    r"следующ(?:им|ей)\s+(?:утром|днем|вечером|ночью)|"

    r"до\s+(?:утра|вечера|рассвета|полудня)|"

    r"к\s+(?:утру|вечеру|рассвету|полудню)|"

    r"ночь\s+прошла|день\s+прошел|вечер\s+прошел"

    r")\b",

    re.IGNORECASE,

)





def _story_environment_has_precise_clock_reference(text: str) -> bool:

    return bool(STORY_ENVIRONMENT_PRECISE_CLOCK_PATTERN.search(str(text or "")))





def _story_environment_has_approximate_hour_reference(text: str) -> bool:

    return bool(STORY_ENVIRONMENT_APPROXIMATE_HOUR_PATTERN.search(str(text or "")))





def _story_environment_has_explicit_time_skip(text: str) -> bool:

    normalized_text = str(text or "")

    if not normalized_text.strip():

        return False

    if STORY_ENVIRONMENT_EXPLICIT_SKIP_PATTERN.search(normalized_text):

        return True

    return bool(

        re.search(

            r"\b(?:через|спустя|прош(?:ел|ло|ла|ли)|минул(?:о|и))\s+"

            r"(?:\d+|полтора|пару|несколько)\s+"

            r"(?:минут(?:ы)?|час(?:а|ов)?|дн(?:я|ей)|недел(?:ю|и|ь)|месяц(?:а|ев)?|год(?:а|ов)?|лет)\b",

            normalized_text,

            re.IGNORECASE,

        )

    )





def _estimate_story_environment_elapsed_minutes(text: str) -> int | None:

    normalized_text = " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized_text:
        return None
    normalized_lower = normalized_text.casefold()

    def _clamp_elapsed_minutes(value: int | float | None) -> int | None:
        if value is None:
            return None
        try:
            normalized_value = int(round(float(value)))
        except Exception:
            return None
        return max(1, min(normalized_value, 12 * 60))

    explicit_range_match = re.search(
        r"\b(\d{1,3})\s*(?:-|–|—|до)\s*(\d{1,3})\s*(минут(?:ы)?|час(?:а|ов)?|дн(?:я|ей)|сут(?:ки|ок)?)\b",
        normalized_lower,
        re.IGNORECASE,
    )
    if explicit_range_match:
        left_value = int(explicit_range_match.group(1))
        right_value = int(explicit_range_match.group(2))
        unit_value = explicit_range_match.group(3)
        average_value = (left_value + right_value) / 2
        if unit_value.startswith("час"):
            return _clamp_elapsed_minutes(average_value * 60)
        if unit_value.startswith("дн") or unit_value.startswith("сут"):
            return _clamp_elapsed_minutes(average_value * 24 * 60)
        return _clamp_elapsed_minutes(average_value)

    explicit_duration_patterns: tuple[tuple[str, int], ...] = (
        (r"\bпол(?:\s*|-)?час(?:а|ика)?\b", 30),
        (r"\bчетверть\s+часа\b", 15),
        (r"\bполтора\s+часа\b", 90),
        (r"\bпару\s+минут\b|\bпара\s+минут\b|\bминут[уы]?\s+другую\b", 4),
        (r"\bнесколько\s+минут\b", 8),
        (r"\bпару\s+час(?:ов|а)\b|\bпара\s+час(?:ов|а)\b", 120),
        (r"\bнесколько\s+час(?:ов|а)\b", 180),
        (r"\bвсю\s+ночь\b|\bдо\s+утра\b|\bк\s+рассвету\b", 360),
        (r"\bвесь\s+день\b|\bдо\s+вечера\b", 480),
        (r"\bмгновени[ея]\b|\bмгновенно\b|\bна\s+миг\b|\bсразу\b|\bтотчас\b|\bсекунд[ауы]?\b", 1),
    )
    for pattern, minutes_value in explicit_duration_patterns:
        if re.search(pattern, normalized_lower, re.IGNORECASE):
            return _clamp_elapsed_minutes(minutes_value)

    explicit_numeric_match = re.search(
        r"\b(\d{1,3})\s*(минут(?:ы)?|час(?:а|ов)?|дн(?:я|ей)|сут(?:ки|ок)?)\b",
        normalized_lower,
        re.IGNORECASE,
    )
    if explicit_numeric_match:
        numeric_value = int(explicit_numeric_match.group(1))
        unit_value = explicit_numeric_match.group(2)
        if unit_value.startswith("час"):
            return _clamp_elapsed_minutes(numeric_value * 60)
        if unit_value.startswith("дн") or unit_value.startswith("сут"):
            return _clamp_elapsed_minutes(numeric_value * 24 * 60)
        return _clamp_elapsed_minutes(numeric_value)

    spelled_number_patterns: tuple[tuple[str, int], ...] = (
        (r"\b(?:один|одна|одну)\s+час(?:а|ов)?\b", 60),
        (r"\b(?:два|две)\s+час(?:а|ов)?\b", 120),
        (r"\b(?:три)\s+час(?:а|ов)?\b", 180),
        (r"\b(?:четыре)\s+час(?:а|ов)?\b", 240),
        (r"\b(?:пять)\s+час(?:а|ов)?\b", 300),
        (r"\b(?:один|одна|одну)\s+минут(?:у|ы)?\b", 1),
        (r"\b(?:две|два)\s+минут(?:ы)?\b", 2),
        (r"\b(?:три)\s+минут(?:ы)?\b", 3),
        (r"\b(?:четыре)\s+минут(?:ы)?\b", 4),
        (r"\b(?:пять)\s+минут(?:ы)?\b", 5),
        (r"\b(?:десять)\s+минут(?:ы)?\b", 10),
        (r"\b(?:пятнадцать)\s+минут(?:ы)?\b", 15),
        (r"\b(?:двадцать)\s+минут(?:ы)?\b", 20),
        (r"\b(?:тридцать)\s+минут(?:ы)?\b", 30),
    )
    for pattern, minutes_value in spelled_number_patterns:
        if re.search(pattern, normalized_lower, re.IGNORECASE):
            return _clamp_elapsed_minutes(minutes_value)

    inferred_minutes: int | None = None
    inference_patterns: tuple[tuple[str, int], ...] = (
        (r"\b(?:убегал|убегала|убегали|бежал|бежала|бежали|мчал(?:ся|ась|ись)|погоня|гнал(?:ся|ась|ись)|догонял(?:а|и)?)\b", 6),
        (r"\b(?:шел|шла|шли|брел|брела|брели|ехал|ехала|ехали|добирал(?:ся|ась|ись)|дорога|путь)\b", 4),
        (r"\b(?:лечил|лечила|лечили|перевязывал(?:а|и)?|обрабатывал(?:а|и)?|осматривал(?:а|и)?|искал(?:а|и)?|обыскивал(?:а|и)?)\b", 6),
        (r"\b(?:ждал(?:а|и)?|ожидал(?:а|и)?|отдыхал(?:а|и)?|сидел(?:а|и)?|стоял(?:а|и)?)\b", 3),
        (r"\b(?:говорил(?:а|и)?|сказал(?:а|и)?|ответил(?:а|и)?|спросил(?:а|и)?|кивнул(?:а|и)?)\b", 2),
    )
    for pattern, minutes_value in inference_patterns:
        if re.search(pattern, normalized_lower, re.IGNORECASE):
            inferred_minutes = max(inferred_minutes or 0, minutes_value)

    has_long_duration_signal = bool(
        re.search(
            r"\b(?:долго|долг(?:о|ий|ая|ие)|длительн(?:о|ый|ая|ые)|продолжительн(?:о|ый|ая|ые)|какое-то\s+время|некоторое\s+время|изрядно)\b",
            normalized_lower,
            re.IGNORECASE,
        )
    )
    has_heavy_effort_signal = bool(
        re.search(
            r"\b(?:вспотел(?:а|и)?|потел(?:а|и)?|выбил(?:ся|ась|ись)\s+из\s+сил|тяжело\s+дышал(?:а|и)?|запыхал(?:ся|ась|ись)|устал(?:а|и)?)\b",
            normalized_lower,
            re.IGNORECASE,
        )
    )
    has_brief_signal = bool(
        re.search(
            r"\b(?:быстро|коротк(?:о|ий|ая)|ненадолго|мигом|мимолетно)\b",
            normalized_lower,
            re.IGNORECASE,
        )
    )

    if inferred_minutes is None and has_long_duration_signal:
        inferred_minutes = 12
    if inferred_minutes is None and has_brief_signal:
        inferred_minutes = 2
    if inferred_minutes is None:
        return None

    if has_long_duration_signal:
        inferred_minutes = max(int(round(inferred_minutes * 1.5)), 10)
    if has_heavy_effort_signal:
        inferred_minutes = max(int(round(inferred_minutes * 1.35)), inferred_minutes + 3)
    if has_brief_signal and not has_long_duration_signal:
        inferred_minutes = min(inferred_minutes, 3)

    return _clamp_elapsed_minutes(inferred_minutes)


def _story_environment_has_brief_scene_signal(text: str) -> bool:

    normalized_text = " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not normalized_text:
        return False
    return bool(
        re.search(
            r"\b(?:коридор(?:е|у|ом)?|к\s+выходу|у\s+выхода|у\s+двери|на\s+пороге|пара\s+фраз|несколько\s+слов|коротк(?:о|ий|ая)|тихо\s+сказал(?:а|и)?|быстро\s+ответил(?:а|и)?|кивнул(?:а|и)?|одной\s+реплик(?:ой|ой))\b",
            normalized_text,
            re.IGNORECASE,
        )
    )


_STORY_ENVIRONMENT_CONTEXTUAL_TIME_ANCHORS: tuple[tuple[str, re.Pattern[str], int, int, int], ...] = (
    (
        "breakfast",
        re.compile(
            r"\b(?:завтрак(?:а|у|ом)?|время\s+завтрака|к\s+завтраку|утренн(?:ий|ее)\s+прием\s+пищи|breakfast)\b",
            re.IGNORECASE,
        ),
        6 * 60,
        10 * 60 + 30,
        8 * 60,
    ),
    (
        "dawn",
        re.compile(
            r"\b(?:рассвет(?:е|а|ом)?|на\s+рассвете|с\s+рассветом|предрассветн(?:ое|ый|им)|early\s+dawn)\b",
            re.IGNORECASE,
        ),
        4 * 60,
        7 * 60 + 30,
        5 * 60 + 30,
    ),
    (
        "morning",
        re.compile(
            r"\b(?:утр(?:о|ом|а)|с\s+утра|ранн(?:ее|им)\s+утро|утренн(?:ий|яя|ее)|morning)\b",
            re.IGNORECASE,
        ),
        5 * 60,
        11 * 60 + 30,
        8 * 60 + 30,
    ),
    (
        "lunch",
        re.compile(
            r"\b(?:обед(?:а|у|ом)?|обеденн(?:ое|ый)\s+время|время\s+обеда|обеденный\s+перерыв|на\s+обеде|полдень|к\s+полудню|lunch)\b",
            re.IGNORECASE,
        ),
        11 * 60 + 30,
        14 * 60 + 30,
        13 * 60,
    ),
    (
        "after_school",
        re.compile(
            r"\b(?:уроки\s+(?:уже\s+)?законч(?:ились|илисься)|после\s+уроков|после\s+школы|после\s+пар|после\s+последнего\s+урока|после\s+занятий|занятия\s+законч(?:ились|ены)|учебный\s+день\s+законч(?:ился|ен)|школа\s+законч(?:илась|ена)|пары\s+законч(?:ились|илисься)|classes?\s+(?:are\s+)?over|after\s+school)\b",
            re.IGNORECASE,
        ),
        12 * 60 + 30,
        17 * 60,
        14 * 60 + 30,
    ),
    (
        "afternoon",
        re.compile(
            r"\b(?:после\s+обеда|днем|дн[её]м|дневн(?:ое|ой|ая)|afternoon)\b",
            re.IGNORECASE,
        ),
        12 * 60,
        17 * 60 + 30,
        15 * 60,
    ),
    (
        "after_work",
        re.compile(
            r"\b(?:после\s+работы|рабочий\s+день\s+законч(?:ился|ен)|смена\s+законч(?:илась|ена)|workday\s+ended|after\s+work)\b",
            re.IGNORECASE,
        ),
        17 * 60,
        21 * 60,
        18 * 60 + 30,
    ),
    (
        "dinner",
        re.compile(
            r"\b(?:ужин(?:а|у|ом|ать)?|время\s+ужина|к\s+ужину|dinner|supper)\b",
            re.IGNORECASE,
        ),
        17 * 60 + 30,
        21 * 60 + 30,
        19 * 60,
    ),
    (
        "evening",
        re.compile(
            r"\b(?:вечер(?:ом|а)?|под\s+вечер|к\s+вечеру|закат(?:е|а|ом)?|на\s+закате|evening|sunset)\b",
            re.IGNORECASE,
        ),
        18 * 60,
        22 * 60 + 30,
        19 * 60 + 30,
    ),
    (
        "night",
        re.compile(
            r"\b(?:ноч(?:ь|ью|и)|поздн(?:яя|ей)\s+ноч(?:ь|ью)|глубок(?:ая|ой)\s+ноч(?:ь|ью)|за\s+полночь|полноч(?:ь|и)|night|midnight)\b",
            re.IGNORECASE,
        ),
        22 * 60,
        4 * 60 + 30,
        23 * 60 + 30,
    ),
)


def _story_environment_minutes_in_window(minutes_value: int, start_minutes: int, end_minutes: int) -> bool:
    normalized_minutes = int(minutes_value) % (24 * 60)
    normalized_start = int(start_minutes) % (24 * 60)
    normalized_end = int(end_minutes) % (24 * 60)
    if normalized_start <= normalized_end:
        return normalized_start <= normalized_minutes <= normalized_end
    return normalized_minutes >= normalized_start or normalized_minutes <= normalized_end


def _extract_story_environment_contextual_time_anchor(
    * ,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> tuple[int, int, int] | None:
    combined_sources = (
        str(latest_user_prompt or "").strip(),
        str(latest_assistant_text or "").strip(),
    )
    for source_text in combined_sources:
        if not source_text:
            continue
        for _, pattern, start_minutes, end_minutes, target_minutes in _STORY_ENVIRONMENT_CONTEXTUAL_TIME_ANCHORS:
            if pattern.search(source_text):
                return (start_minutes, end_minutes, target_minutes)
    return None


def _reconcile_story_environment_datetime_with_contextual_time_anchors(
    *,
    saved_datetime: datetime | None,
    candidate_datetime: datetime | None,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> tuple[datetime | None, bool]:
    base_datetime = (
        candidate_datetime
        if isinstance(candidate_datetime, datetime)
        else saved_datetime
        if isinstance(saved_datetime, datetime)
        else None
    )
    if not isinstance(base_datetime, datetime):
        return (candidate_datetime, False)

    source_text = "\n".join(
        part.strip()
        for part in (latest_user_prompt, latest_assistant_text)
        if isinstance(part, str) and part.strip()
    )
    if not source_text or _story_environment_has_precise_clock_reference(source_text):
        return (candidate_datetime, False)

    contextual_anchor = _extract_story_environment_contextual_time_anchor(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    if contextual_anchor is None:
        return (candidate_datetime, False)

    start_minutes, end_minutes, target_minutes = contextual_anchor
    current_minutes = base_datetime.hour * 60 + base_datetime.minute
    if _story_environment_minutes_in_window(current_minutes, start_minutes, end_minutes):
        return (base_datetime, False)

    normalized_target_minutes = int(target_minutes) % (24 * 60)
    resolved_datetime = base_datetime.replace(
        hour=normalized_target_minutes // 60,
        minute=normalized_target_minutes % 60,
        second=0,
        microsecond=0,
        tzinfo=None,
    )
    return (resolved_datetime, True)


def _reconcile_story_environment_datetime_with_coarse_time_mentions(
    *,

    game: StoryGame,

    saved_datetime: datetime | None,

    candidate_datetime: datetime | None,

    latest_user_prompt: str,

    latest_assistant_text: str,

) -> datetime | None:

    if not isinstance(saved_datetime, datetime) or not isinstance(candidate_datetime, datetime):

        return candidate_datetime



    source_text = "\n".join(

        part.strip()

        for part in (latest_user_prompt, latest_assistant_text)

        if isinstance(part, str) and part.strip()

    )

    if not source_text:

        return candidate_datetime

    if _story_environment_has_precise_clock_reference(source_text):

        return candidate_datetime

    if _story_environment_has_explicit_time_skip(source_text):

        return candidate_datetime

    estimated_elapsed_minutes = _estimate_story_environment_elapsed_minutes(source_text)
    if _story_environment_has_brief_scene_signal(source_text) and estimated_elapsed_minutes is not None:
        estimated_elapsed_minutes = min(estimated_elapsed_minutes, 4)
    fallback_step_minutes = estimated_elapsed_minutes
    if fallback_step_minutes is None:
        fallback_step_minutes = max(
            1,
            _normalize_story_environment_turn_step_minutes(
                getattr(game, "environment_turn_step_minutes", None)
            ),
        )

    delta_minutes = int((candidate_datetime - saved_datetime).total_seconds() // 60)
    max_reasonable_delta = max(
        5,
        fallback_step_minutes + 2,
        int(round(fallback_step_minutes * 1.4)),
    )
    if estimated_elapsed_minutes is not None and estimated_elapsed_minutes <= 4:
        max_reasonable_delta = min(max_reasonable_delta, estimated_elapsed_minutes + 2)
    if delta_minutes > max_reasonable_delta:
        fallback_datetime = saved_datetime + timedelta(minutes=fallback_step_minutes)
        return fallback_datetime.replace(second=0, microsecond=0, tzinfo=None)

    if not _story_environment_has_approximate_hour_reference(source_text):

        return candidate_datetime

    if candidate_datetime.minute != 0:

        return candidate_datetime

    if saved_datetime.minute == 0:

        return candidate_datetime



    if delta_minutes > 180 or delta_minutes < -15:

        return candidate_datetime



    fallback_datetime = saved_datetime + timedelta(minutes=fallback_step_minutes)

    if fallback_datetime <= saved_datetime:

        fallback_datetime = saved_datetime + timedelta(minutes=1)

    return fallback_datetime.replace(second=0, microsecond=0, tzinfo=None)





def _build_story_environment_time_prompt_card(game: StoryGame) -> dict[str, str] | None:

    if not _normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):

        return None

    current_datetime = _deserialize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    if not isinstance(current_datetime, datetime):

        return None

    content = _format_story_environment_datetime_prompt_facts(current_datetime).strip()

    if not content:

        return None

    return {"title": f"Окружение: {STORY_ENVIRONMENT_TIME_CARD_TITLE}", "content": content}





def _story_environment_date_key_from_value(value: datetime | str | None) -> str:

    parsed_value = (

        value

        if isinstance(value, datetime)

        else _deserialize_story_environment_datetime(str(value or ""))

    )

    if not isinstance(parsed_value, datetime):

        return ""

    return parsed_value.date().isoformat()





def _story_environment_next_date_key(value: str) -> str:

    normalized = str(value or "").strip()

    if not normalized:

        return ""

    try:

        parsed_date = datetime.fromisoformat(f"{normalized}T00:00")

    except ValueError:

        return ""

    return (parsed_date + timedelta(days=1)).date().isoformat()





def _story_environment_datetime_from_day_date(value: str, *, hour: int = 12) -> datetime | None:

    normalized = str(value or "").strip()

    if not normalized:

        return None

    try:

        parsed = datetime.fromisoformat(f"{normalized}T{max(0, min(hour, 23)):02d}:00")

    except ValueError:

        return None

    return parsed.replace(second=0, microsecond=0, tzinfo=None)





def _story_environment_clock_time_to_minutes(value: str, *, treat_midnight_as_end_of_day: bool = False) -> int | None:

    normalized = str(value or "").strip()

    match = re.fullmatch(r"(\d{2}):(\d{2})", normalized)

    if not match:

        return None

    hours = int(match.group(1))

    minutes = int(match.group(2))

    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:

        return None

    total_minutes = hours * 60 + minutes

    if treat_midnight_as_end_of_day and total_minutes == 0:

        return 24 * 60

    return total_minutes





def _story_environment_weather_matches_day(

    weather_payload: dict[str, Any] | None,

    expected_day_date: str,

) -> bool:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return False

    if str(normalized_weather.get("day_date") or "").strip() != str(expected_day_date or "").strip():

        return False

    return any(

        [

            str(normalized_weather.get("summary") or "").strip(),

            isinstance(normalized_weather.get("temperature_c"), int),

            str(normalized_weather.get("fog") or "").strip(),

            str(normalized_weather.get("humidity") or "").strip(),

            str(normalized_weather.get("wind") or "").strip(),

            bool(normalized_weather.get("timeline")),

        ]

    )





def _story_environment_weather_has_timeline_for_day(

    weather_payload: dict[str, Any] | None,

    expected_day_date: str,

) -> bool:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return False

    if str(normalized_weather.get("day_date") or "").strip() != str(expected_day_date or "").strip():

        return False

    timeline = normalized_weather.get("timeline")

    return isinstance(timeline, list) and any(isinstance(entry, dict) for entry in timeline)





STORY_ENVIRONMENT_GENERIC_WEATHER_SUMMARY_PATTERN = re.compile(
    r"^(?:переменная\s+облачность|облачно(?:\s+с\s+прояснениями)?|пасмурно|partly\s+cloudy|cloudy|overcast)$",
    re.IGNORECASE,
)


def _is_story_environment_generic_weather_summary(value: Any) -> bool:
    normalized = re.sub(r"\s+", " ", str(value or "").strip()).casefold()
    if not normalized:
        return True
    return bool(STORY_ENVIRONMENT_GENERIC_WEATHER_SUMMARY_PATTERN.fullmatch(normalized))


def _story_environment_weather_has_meaningful_timeline_variation(
    weather_payload: dict[str, Any] | None,
) -> bool:
    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)
    if not isinstance(normalized_weather, dict):
        return False
    raw_timeline = normalized_weather.get("timeline")
    if not isinstance(raw_timeline, list):
        return False
    distinct_summaries = {
        re.sub(r"\s+", " ", str(entry.get("summary") or "").strip()).casefold()
        for entry in raw_timeline
        if isinstance(entry, dict) and str(entry.get("summary") or "").strip()
    }
    return len(distinct_summaries) >= 2


def _story_environment_weather_specificity_score(
    weather_payload: dict[str, Any] | None,
    *,
    require_timeline: bool = False,
) -> int:
    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)
    if not isinstance(normalized_weather, dict):
        return -1

    score = 0
    summary = str(normalized_weather.get("summary") or "").strip()
    if summary:
        score += 1
        if not _is_story_environment_generic_weather_summary(summary):
            score += 2

    if isinstance(normalized_weather.get("temperature_c"), int):
        score += 1

    for field_name in ("fog", "humidity", "wind"):
        if str(normalized_weather.get(field_name) or "").strip():
            score += 1

    raw_timeline = normalized_weather.get("timeline")
    if isinstance(raw_timeline, list):
        timeline_entries = [entry for entry in raw_timeline if isinstance(entry, dict)]
        if timeline_entries:
            score += 2
            populated_summaries = [
                re.sub(r"\s+", " ", str(entry.get("summary") or "").strip()).casefold()
                for entry in timeline_entries
                if str(entry.get("summary") or "").strip()
            ]
            score += min(len(populated_summaries), 4)
            if len(set(populated_summaries)) >= 2:
                score += 4
        elif require_timeline:
            score -= 2
    elif require_timeline:
        score -= 2

    return score


def _story_environment_weather_is_stale_generic(
    weather_payload: dict[str, Any] | None,
    *,
    expected_day_date: str,
    require_timeline: bool = False,
) -> bool:
    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)
    if not isinstance(normalized_weather, dict):
        return False
    if str(normalized_weather.get("day_date") or "").strip() != str(expected_day_date or "").strip():
        return False
    if require_timeline and not _story_environment_weather_has_timeline_for_day(
        normalized_weather,
        expected_day_date,
    ):
        return False

    summary = str(normalized_weather.get("summary") or "").strip()
    return _is_story_environment_generic_weather_summary(summary) and not _story_environment_weather_has_meaningful_timeline_variation(
        normalized_weather
    )


def _story_environment_should_refresh_saved_weather(
    saved_weather: dict[str, Any] | None,
    candidate_weather: dict[str, Any] | None,
    *,
    expected_day_date: str,
    require_timeline: bool = False,
) -> bool:
    normalized_candidate = _normalize_story_environment_weather_payload(candidate_weather)
    if not isinstance(normalized_candidate, dict):
        return False
    if str(normalized_candidate.get("day_date") or "").strip() != str(expected_day_date or "").strip():
        return False
    if require_timeline and not _story_environment_weather_has_timeline_for_day(
        normalized_candidate,
        expected_day_date,
    ):
        return False

    normalized_saved = _normalize_story_environment_weather_payload(saved_weather)
    if not isinstance(normalized_saved, dict):
        return True

    saved_is_stale_generic = _story_environment_weather_is_stale_generic(
        normalized_saved,
        expected_day_date=expected_day_date,
        require_timeline=require_timeline,
    )
    candidate_is_specific = (
        not _is_story_environment_generic_weather_summary(normalized_candidate.get("summary"))
        or _story_environment_weather_has_meaningful_timeline_variation(normalized_candidate)
        or any(str(normalized_candidate.get(field_name) or "").strip() for field_name in ("fog", "humidity", "wind"))
    )
    if saved_is_stale_generic and candidate_is_specific:
        return True

    return _story_environment_weather_specificity_score(
        normalized_candidate,
        require_timeline=require_timeline,
    ) > _story_environment_weather_specificity_score(
        normalized_saved,
        require_timeline=require_timeline,
    )


def _legacy__resolve_story_environment_weather_timeline_entry_v1(
    *,

    weather_payload: dict[str, Any] | None,

    current_datetime: datetime | None,

) -> dict[str, Any] | None:

    if not isinstance(current_datetime, datetime):

        return None

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return None

    raw_timeline = normalized_weather.get("timeline")

    if not isinstance(raw_timeline, list):

        return None



    timeline_entries = [entry for entry in raw_timeline if isinstance(entry, dict)]

    if not timeline_entries:

        return None

    timeline_entries.sort(

        key=lambda entry: _story_environment_clock_time_to_minutes(str(entry.get("start_time") or "")) or 0

    )



    current_minutes = current_datetime.hour * 60 + current_datetime.minute

    fallback_entry = timeline_entries[-1]

    for entry in timeline_entries:

        start_minutes = _story_environment_clock_time_to_minutes(str(entry.get("start_time") or ""))

        end_minutes = _story_environment_clock_time_to_minutes(

            str(entry.get("end_time") or ""),

            treat_midnight_as_end_of_day=(str(entry.get("start_time") or "").strip() != "00:00"),

        )

        if start_minutes is None or end_minutes is None:

            continue

        if current_minutes < start_minutes:

            return entry

        if start_minutes <= current_minutes < end_minutes:

            return entry

        fallback_entry = entry

    return fallback_entry





def _align_story_environment_weather_to_datetime(

    *,

    weather_payload: dict[str, Any] | None,

    current_datetime: datetime | None,

    target_day_date: str | None = None,

) -> dict[str, Any] | None:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return None



    resolved_day_date = str(target_day_date or _story_environment_date_key_from_value(current_datetime) or "").strip()

    if resolved_day_date:

        normalized_weather["day_date"] = resolved_day_date



    active_timeline_entry = _resolve_story_environment_weather_timeline_entry(

        weather_payload=normalized_weather,

        current_datetime=current_datetime,

    )

    if not isinstance(active_timeline_entry, dict):

        return _normalize_story_environment_weather_payload(normalized_weather)



    next_weather = dict(normalized_weather)

    timeline_summary = str(active_timeline_entry.get("summary") or "").strip()

    if timeline_summary:

        next_weather["summary"] = timeline_summary

    timeline_temperature = active_timeline_entry.get("temperature_c")

    if isinstance(timeline_temperature, int):

        next_weather["temperature_c"] = timeline_temperature

    for field_name in ("fog", "humidity", "wind"):

        timeline_value = str(active_timeline_entry.get(field_name) or "").strip()

        if timeline_value:

            next_weather[field_name] = timeline_value

    return _normalize_story_environment_weather_payload(next_weather)





STORY_ENVIRONMENT_STRONG_COLD_CUE_PATTERN = re.compile(

    r"\b(?:север|поляр|тундр|ледник|вечн(?:ая|ой|ую)?\s+мерзлот|высокогор|горн(?:ый|ая|ом)\s+перевал|"

    r"снег|снеж|лед|ледян|метел|вьюг|мороз|стуж|замороз|аномальн(?:ый|ая)?\s+холод|магическ(?:ий|ая)?\s+холод)\w*\b",

    re.IGNORECASE,

)

STORY_ENVIRONMENT_STRONG_HEAT_CUE_PATTERN = re.compile(

    r"\b(?:пустын|джунгл|тропик|экватор|саванн|зной|пекл|жар(?:а|кий)|палящ|раскален)\w*\b",

    re.IGNORECASE,

)





def _story_environment_temperature_bounds_for_datetime(

    *,

    reference_datetime: datetime | None,

    supporting_text: str,

) -> tuple[int, int] | None:

    if not isinstance(reference_datetime, datetime):

        return None



    normalized_supporting_text = str(supporting_text or "").strip()

    allows_strong_cold = bool(STORY_ENVIRONMENT_STRONG_COLD_CUE_PATTERN.search(normalized_supporting_text))

    allows_strong_heat = bool(STORY_ENVIRONMENT_STRONG_HEAT_CUE_PATTERN.search(normalized_supporting_text))

    month = int(reference_datetime.month)



    if month in {12, 1, 2}:

        return (-35 if allows_strong_cold else -25, 18 if allows_strong_heat else 12)

    if month in {3, 4, 5}:

        return (-12 if allows_strong_cold else -4, 32 if allows_strong_heat else 24)

    if month in {6, 7, 8}:

        return (2 if allows_strong_cold else 12, 46 if allows_strong_heat else 38)

    return (-12 if allows_strong_cold else -4, 32 if allows_strong_heat else 24)





def _apply_story_environment_temperature_guardrails(

    *,

    weather_payload: dict[str, Any] | None,

    reference_datetime: datetime | None,

    supporting_text: str,

) -> dict[str, Any] | None:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return None



    resolved_reference_datetime = reference_datetime

    if not isinstance(resolved_reference_datetime, datetime):

        resolved_reference_datetime = _story_environment_datetime_from_day_date(

            str(normalized_weather.get("day_date") or ""),

            hour=12,

        )

    temperature_bounds = _story_environment_temperature_bounds_for_datetime(

        reference_datetime=resolved_reference_datetime,

        supporting_text=supporting_text,

    )

    if temperature_bounds is None:

        return normalized_weather



    min_temperature, max_temperature = temperature_bounds

    changed = False

    next_weather = dict(normalized_weather)



    resolved_temperature = next_weather.get("temperature_c")

    if isinstance(resolved_temperature, int):

        clamped_temperature = max(min_temperature, min(resolved_temperature, max_temperature))

        if clamped_temperature != resolved_temperature:

            next_weather["temperature_c"] = clamped_temperature

            changed = True



    raw_timeline = next_weather.get("timeline")

    if isinstance(raw_timeline, list) and raw_timeline:

        next_timeline: list[dict[str, Any]] = []

        timeline_changed = False

        for entry in raw_timeline:

            if not isinstance(entry, dict):

                continue

            next_entry = dict(entry)

            entry_supporting_text = "\n".join(

                part for part in [supporting_text, str(entry.get("summary") or "").strip()] if part

            )

            entry_bounds = _story_environment_temperature_bounds_for_datetime(

                reference_datetime=resolved_reference_datetime,

                supporting_text=entry_supporting_text,

            )

            entry_temperature = next_entry.get("temperature_c")

            if entry_bounds is not None and isinstance(entry_temperature, int):

                entry_min_temperature, entry_max_temperature = entry_bounds

                clamped_entry_temperature = max(entry_min_temperature, min(entry_temperature, entry_max_temperature))

                if clamped_entry_temperature != entry_temperature:

                    next_entry["temperature_c"] = clamped_entry_temperature

                    timeline_changed = True

            next_timeline.append(next_entry)

        if timeline_changed:

            next_weather["timeline"] = next_timeline

            changed = True



    return _normalize_story_environment_weather_payload(next_weather) if changed else normalized_weather





def _format_story_environment_weather_timeline_line(

    *,

    label: str,

    weather_payload: dict[str, Any] | None,

) -> str:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return ""

    raw_timeline = normalized_weather.get("timeline")

    if not isinstance(raw_timeline, list):

        return ""



    rendered_segments: list[str] = []

    for entry in raw_timeline:

        if not isinstance(entry, dict):

            continue

        start_time = str(entry.get("start_time") or "").strip()

        end_time = str(entry.get("end_time") or "").strip()

        if not start_time or not end_time:

            continue

        summary = str(entry.get("summary") or "").strip()

        temperature_c = entry.get("temperature_c")

        segment_parts = [f"{start_time}-{end_time}"]

        if summary:

            segment_parts.append(summary)

        elif isinstance(temperature_c, int):

            segment_parts.append(f"{temperature_c:+d}°C")

        rendered_segments.append(" ".join(segment_parts).strip())

        if len(rendered_segments) >= 6:

            break



    if not rendered_segments:

        return ""

    return f"{label}: {'; '.join(rendered_segments)}."





def _resolve_story_environment_weather_state(
    *,
    game: StoryGame,
    current_datetime: datetime | None,
    current_location_content: str,

    latest_user_prompt: str,

    previous_assistant_text: str,

    latest_assistant_text: str,

    extracted_current_weather: dict[str, Any] | None,

    extracted_tomorrow_weather: dict[str, Any] | None,

    allow_weather_seed: bool = True,

) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    current_day_date = _story_environment_date_key_from_value(current_datetime)
    tomorrow_day_date = _story_environment_next_date_key(current_day_date)
    weather_supporting_text = "\n".join(
        part.strip()
        for part in [
            current_location_content,
            latest_user_prompt,
            previous_assistant_text,
            latest_assistant_text,
        ]
        if isinstance(part, str) and part.strip()
    )
    tomorrow_reference_datetime = _story_environment_datetime_from_day_date(tomorrow_day_date, hour=12)
    saved_current_weather = _deserialize_story_environment_weather(
        str(getattr(game, "environment_current_weather", "") or "")
    )
    saved_tomorrow_weather = _deserialize_story_environment_weather(
        str(getattr(game, "environment_tomorrow_weather", "") or "")
    )
    normalized_extracted_current_weather = (
        _normalize_story_environment_weather_payload(
            {
                **extracted_current_weather,
                "day_date": current_day_date or extracted_current_weather.get("day_date"),
            }
        )
        if isinstance(extracted_current_weather, dict)
        else None
    )
    normalized_extracted_tomorrow_weather = (
        _normalize_story_environment_weather_payload(
            {
                **extracted_tomorrow_weather,
                "day_date": tomorrow_day_date or extracted_tomorrow_weather.get("day_date"),
            }
        )
        if isinstance(extracted_tomorrow_weather, dict)
        else None
    )
    usable_extracted_current_weather = (
        normalized_extracted_current_weather
        if _story_environment_weather_has_timeline_for_day(
            normalized_extracted_current_weather,
            current_day_date,
        )
        else None
    )
    usable_extracted_tomorrow_weather = (
        normalized_extracted_tomorrow_weather
        if isinstance(usable_extracted_current_weather, dict)
        and _story_environment_weather_matches_day(
            normalized_extracted_tomorrow_weather,
            tomorrow_day_date,
        )
        else None
    )


    can_reuse_current_timeline = _story_environment_weather_has_timeline_for_day(
        saved_current_weather,
        current_day_date,
    )
    can_reuse_tomorrow_forecast = _story_environment_weather_matches_day(
        saved_tomorrow_weather,
        tomorrow_day_date,
    )
    prefer_saved_current_timeline = can_reuse_current_timeline
    prefer_saved_tomorrow_forecast = can_reuse_tomorrow_forecast

    if prefer_saved_current_timeline and prefer_saved_tomorrow_forecast:
        return (
            _repair_story_environment_weather_payload(
                saved_current_weather,
                reference_datetime=current_datetime,
                supporting_text=weather_supporting_text,
                target_day_date=current_day_date,
                ensure_timeline=True,
                align_to_current_period=True,
            ),
            _repair_story_environment_weather_payload(
                saved_tomorrow_weather,
                reference_datetime=tomorrow_reference_datetime,
                supporting_text=weather_supporting_text,
                target_day_date=tomorrow_day_date,
            ),
        )


    seeded_payload = (

        _seed_story_environment_weather_payload(

            game=game,

            current_location_content=current_location_content,

            latest_user_prompt=latest_user_prompt,

            previous_assistant_text=previous_assistant_text,

            latest_assistant_text=latest_assistant_text,

            current_datetime_override=(

                _serialize_story_environment_datetime(current_datetime)

                if isinstance(current_datetime, datetime)

                else None

            ),

        )

        if allow_weather_seed
        and not isinstance(usable_extracted_current_weather, dict)
        and not isinstance(usable_extracted_tomorrow_weather, dict)

        else None

    )



    seeded_current_weather = (

        seeded_payload.get("current_weather")

        if isinstance(seeded_payload, dict)

        else None

    )

    seeded_tomorrow_weather = (

        seeded_payload.get("tomorrow_weather")

        if isinstance(seeded_payload, dict)

        else None

    )



    if prefer_saved_current_timeline:
        resolved_current_weather = saved_current_weather
    else:
        promoted_tomorrow_as_current = None
        if _story_environment_weather_matches_day(saved_tomorrow_weather, current_day_date):
            promoted_tomorrow_as_current = _normalize_story_environment_weather_payload(
                {

                    **(saved_tomorrow_weather or {}),

                    "day_date": current_day_date,

                    "timeline": [],

                }

            )

        current_source = (

            usable_extracted_current_weather

            if isinstance(usable_extracted_current_weather, dict)

            else promoted_tomorrow_as_current

            if isinstance(promoted_tomorrow_as_current, dict)

            else saved_current_weather
            if _story_environment_weather_matches_day(saved_current_weather, current_day_date)
            else seeded_current_weather
            if isinstance(seeded_current_weather, dict)
            else None

        )

        resolved_current_weather = _normalize_story_environment_weather_payload(

            {

                **(current_source or {}),

                "day_date": current_day_date or (current_source or {}).get("day_date"),

            }

        )



    if prefer_saved_tomorrow_forecast:
        resolved_tomorrow_weather = saved_tomorrow_weather
    else:
        tomorrow_source = (
            usable_extracted_tomorrow_weather
            if isinstance(usable_extracted_tomorrow_weather, dict)
            else saved_tomorrow_weather
            if _story_environment_weather_matches_day(saved_tomorrow_weather, tomorrow_day_date)
            else seeded_tomorrow_weather
            if isinstance(seeded_tomorrow_weather, dict)
            else None

        )

        resolved_tomorrow_weather = _normalize_story_environment_weather_payload(
            {
                **(tomorrow_source or {}),
                "day_date": tomorrow_day_date or (tomorrow_source or {}).get("day_date"),
            }
        )

    return (
        _repair_story_environment_weather_payload(
            resolved_current_weather,
            reference_datetime=current_datetime,
            supporting_text=weather_supporting_text,
            target_day_date=current_day_date,
            ensure_timeline=True,
            align_to_current_period=True,
        ),
        _repair_story_environment_weather_payload(
            resolved_tomorrow_weather,
            reference_datetime=tomorrow_reference_datetime,
            supporting_text=weather_supporting_text,
            target_day_date=tomorrow_day_date,
        ),
    )




def _format_story_environment_weather_line(

    *,

    label: str,

    weather_payload: dict[str, Any] | None,

) -> str:

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

    if not isinstance(normalized_weather, dict):

        return ""



    parts: list[str] = []

    summary = str(normalized_weather.get("summary") or "").strip()

    if summary:

        parts.append(summary)

    temperature_c = normalized_weather.get("temperature_c")

    if isinstance(temperature_c, int):

        parts.append(f"{temperature_c:+d}°C")

    fog = str(normalized_weather.get("fog") or "").strip()

    if fog:

        parts.append(f"туман: {fog}")

    humidity = str(normalized_weather.get("humidity") or "").strip()

    if humidity:

        parts.append(f"влажность: {humidity}")

    wind = str(normalized_weather.get("wind") or "").strip()

    if wind:

        parts.append(f"ветер: {wind}")



    if not parts:

        return ""

    return f"{label}: {', '.join(parts)}."





def _build_story_weather_memory_content(
    *,
    current_weather: dict[str, Any] | None,
    tomorrow_weather: dict[str, Any] | None,
) -> str:
    lines = [

        line

        for line in (

            _format_story_environment_weather_line(label="Сейчас", weather_payload=current_weather),

            _format_story_environment_weather_timeline_line(label="Сегодня по времени", weather_payload=current_weather),

            _format_story_environment_weather_line(label="Завтра", weather_payload=tomorrow_weather),

        )

        if line

    ]

    if not lines:

        return ""

    normalized = "\n".join(lines).strip()

    if len(normalized) > STORY_MEMORY_WEATHER_CONTENT_MAX_CHARS:
        normalized = normalized[: STORY_MEMORY_WEATHER_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?…") + "."
    return normalized


def _normalize_story_weather_memory_content(value: str) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return ""

    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    if len(normalized) > STORY_MEMORY_WEATHER_CONTENT_MAX_CHARS:
        normalized = normalized[: STORY_MEMORY_WEATHER_CONTENT_MAX_CHARS - 1].rstrip(" ,;:-.!?…") + "."
    return normalized




def _build_story_environment_snapshot_payload(
    *,
    game: StoryGame,
) -> dict[str, Any]:
    current_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_weather = _normalize_story_environment_weather_payload(

        _deserialize_story_environment_weather(

            str(getattr(game, "environment_current_weather", "") or "")

        )

    )

    tomorrow_weather = _normalize_story_environment_weather_payload(

        _deserialize_story_environment_weather(

            str(getattr(game, "environment_tomorrow_weather", "") or "")

        )

    )

    payload: dict[str, Any] = {

        "current_datetime": current_datetime,

    }

    if isinstance(current_weather, dict):

        payload["current_weather"] = current_weather

    if isinstance(tomorrow_weather, dict):
        payload["tomorrow_weather"] = tomorrow_weather
    return payload


STORY_ENVIRONMENT_SNAPSHOT_TAG_OPEN = "<story-environment-snapshot>"
STORY_ENVIRONMENT_SNAPSHOT_TAG_CLOSE = "</story-environment-snapshot>"


def _normalize_story_environment_snapshot_payload(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    payload: dict[str, Any] = {}
    current_datetime = _normalize_story_environment_datetime(str(value.get("current_datetime") or ""))
    if current_datetime:
        payload["current_datetime"] = current_datetime

    current_weather = _normalize_story_environment_weather_payload(value.get("current_weather"))
    if isinstance(current_weather, dict):
        payload["current_weather"] = current_weather

    tomorrow_weather = _normalize_story_environment_weather_payload(value.get("tomorrow_weather"))
    if isinstance(tomorrow_weather, dict):
        payload["tomorrow_weather"] = tomorrow_weather

    return payload or None


def _embed_story_environment_snapshot_in_memory_content(
    content: str,
    snapshot_payload: dict[str, Any] | None,
) -> str:
    normalized_content = _normalize_story_weather_memory_content(content)
    normalized_snapshot = _normalize_story_environment_snapshot_payload(snapshot_payload)
    if not isinstance(normalized_snapshot, dict):
        return normalized_content

    try:
        snapshot_json = json.dumps(normalized_snapshot, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return normalized_content

    if not normalized_content:
        return (
            f"{STORY_ENVIRONMENT_SNAPSHOT_TAG_OPEN}{snapshot_json}{STORY_ENVIRONMENT_SNAPSHOT_TAG_CLOSE}"
        )

    return (
        f"{normalized_content}\n\n"
        f"{STORY_ENVIRONMENT_SNAPSHOT_TAG_OPEN}{snapshot_json}{STORY_ENVIRONMENT_SNAPSHOT_TAG_CLOSE}"
    )


def _split_story_environment_snapshot_from_memory_content(
    text_value: str,
) -> tuple[dict[str, Any] | None, str]:
    normalized_text = str(text_value or "").replace("\r\n", "\n").strip()
    if not normalized_text:
        return (None, "")

    snapshot_pattern = re.compile(
        rf"{re.escape(STORY_ENVIRONMENT_SNAPSHOT_TAG_OPEN)}\s*([\s\S]*?)\s*{re.escape(STORY_ENVIRONMENT_SNAPSHOT_TAG_CLOSE)}",
        re.IGNORECASE,
    )
    extracted_payload: dict[str, Any] | None = None

    def _replace_snapshot_block(match: re.Match[str]) -> str:
        nonlocal extracted_payload
        if extracted_payload is None:
            raw_payload = _extract_json_object_from_text(str(match.group(1) or "").strip())
            normalized_payload = _normalize_story_environment_snapshot_payload(raw_payload)
            if isinstance(normalized_payload, dict):
                extracted_payload = normalized_payload
        return ""

    cleaned_text = snapshot_pattern.sub(_replace_snapshot_block, normalized_text)
    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()
    return (extracted_payload, cleaned_text)


def _strip_story_environment_snapshot_from_memory_content(text_value: str) -> str:
    return _split_story_environment_snapshot_from_memory_content(text_value)[1]




def _build_story_environment_snapshot_signature(snapshot_payload: dict[str, Any] | None) -> tuple[str, str, str]:

    if not isinstance(snapshot_payload, dict):

        return ("", "", "")

    raw_current_datetime = str(snapshot_payload.get("current_datetime") or "").strip()

    current_datetime = (

        _normalize_story_environment_datetime(raw_current_datetime)

        if raw_current_datetime

        else ""

    )

    current_weather = _serialize_story_environment_weather(

        _normalize_story_environment_weather_payload(snapshot_payload.get("current_weather"))

    )

    tomorrow_weather = _serialize_story_environment_weather(

        _normalize_story_environment_weather_payload(snapshot_payload.get("tomorrow_weather"))

    )

    return (current_datetime, current_weather, tomorrow_weather)





def _build_story_weather_prompt_content(
    *,
    current_weather: dict[str, Any] | None,
    tomorrow_weather: dict[str, Any] | None,
) -> str:
    def _render_compact_weather_line(label: str, weather_payload: dict[str, Any] | None) -> str:

        normalized_weather = _normalize_story_environment_weather_payload(weather_payload)

        if not isinstance(normalized_weather, dict):

            return ""



        facts: list[str] = []

        temperature_c = normalized_weather.get("temperature_c")

        if isinstance(temperature_c, int):

            facts.append(f"{temperature_c:+d}°C")

        fog = str(normalized_weather.get("fog") or "").strip()

        if fog:

            facts.append(f"туман: {fog}")

        humidity = str(normalized_weather.get("humidity") or "").strip()

        if humidity:

            facts.append(f"влажность: {humidity}")

        wind = str(normalized_weather.get("wind") or "").strip()

        if wind:

            facts.append(f"ветер: {wind}")

        if not facts:

            return ""

        return f"{label}: {'; '.join(facts)}."



    lines = [

        line

        for line in (

            _render_compact_weather_line("Сейчас", current_weather),

            _render_compact_weather_line("Завтра", tomorrow_weather),

        )

        if line

    ]

    if not lines:
        return ""
    return "\n".join(lines).strip()


def _build_story_weather_prompt_content_compact(
    *,
    current_weather: dict[str, Any] | None,
    tomorrow_weather: dict[str, Any] | None,
) -> str:
    def _render_compact_weather_line(label: str, weather_payload: dict[str, Any] | None) -> str:
        normalized_weather = _normalize_story_environment_weather_payload(weather_payload)
        if not isinstance(normalized_weather, dict):
            return ""

        facts: list[str] = []
        summary = str(normalized_weather.get("summary") or "").strip()
        if summary:
            facts.append(f"summary={summary}")
        temperature_c = normalized_weather.get("temperature_c")
        if isinstance(temperature_c, int):
            facts.append(f"temp={temperature_c:+d}В°C")
        fog = str(normalized_weather.get("fog") or "").strip()
        if fog:
            facts.append(f"fog={fog}")
        humidity = str(normalized_weather.get("humidity") or "").strip()
        if humidity:
            facts.append(f"humidity={humidity}")
        wind = str(normalized_weather.get("wind") or "").strip()
        if wind:
            facts.append(f"wind={wind}")
        if not facts:
            return ""
        return f"{label}: {' | '.join(facts)}"

    lines = [
        line
        for line in (
            _render_compact_weather_line("Сейчас", current_weather),
            _render_compact_weather_line("Завтра", tomorrow_weather),
        )
        if line
    ]
    if not lines:
        return ""
    return "\n".join(lines).strip()


def _resolve_story_environment_weather_timeline_entry(
    *,
    weather_payload: dict[str, Any] | None,
    current_datetime: datetime | None,
) -> dict[str, Any] | None:
    if not isinstance(current_datetime, datetime):
        return None

    normalized_weather = _normalize_story_environment_weather_payload(weather_payload)
    if not isinstance(normalized_weather, dict):
        return None

    raw_timeline = normalized_weather.get("timeline")
    if not isinstance(raw_timeline, list):
        return None

    timeline_entries = [entry for entry in raw_timeline if isinstance(entry, dict)]
    if not timeline_entries:
        return None

    timeline_entries.sort(
        key=lambda entry: _story_environment_clock_time_to_minutes(str(entry.get("start_time") or "")) or 0
    )
    current_minutes = current_datetime.hour * 60 + current_datetime.minute
    fallback_entry = timeline_entries[-1]

    for entry in timeline_entries:
        start_minutes = _story_environment_clock_time_to_minutes(str(entry.get("start_time") or ""))
        end_minutes = _story_environment_clock_time_to_minutes(
            str(entry.get("end_time") or ""),
            treat_midnight_as_end_of_day=(str(entry.get("start_time") or "").strip() != "00:00"),
        )
        if start_minutes is None or end_minutes is None:
            continue
        if current_minutes < start_minutes:
            return fallback_entry
        if start_minutes <= current_minutes < end_minutes:
            return entry
        fallback_entry = entry
    return fallback_entry


def _build_story_environment_weather_prompt_card(game: StoryGame) -> dict[str, str] | None:
    if not _normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        return None
    content = _build_story_weather_prompt_content_compact(
        current_weather=_deserialize_story_environment_weather(
            str(getattr(game, "environment_current_weather", "") or "")
        ),
        tomorrow_weather=_deserialize_story_environment_weather(

            str(getattr(game, "environment_tomorrow_weather", "") or "")

        ),

    )

    if not content:

        return None

    return {"title": f"Погода: {STORY_MEMORY_WEATHER_TITLE}", "content": content}





def _story_character_state_cards_from_game(game: StoryGame) -> list[dict[str, Any]]:

    return _deserialize_story_character_state_cards_payload(

        str(getattr(game, "character_state_payload", "") or "")

    )





def _story_character_state_card_key(card: dict[str, Any]) -> str:

    world_card_id = card.get("world_card_id")

    if isinstance(world_card_id, int) and world_card_id > 0:

        return f"id:{world_card_id}"

    kind = str(card.get("kind") or STORY_CHARACTER_STATE_KIND_NPC).strip().lower()

    name = " ".join(str(card.get("name") or "").split()).strip().casefold()

    return f"{kind}:{name}"





def _is_story_character_state_location_placeholder(value: Any) -> bool:

    normalized = " ".join(str(value or "").split()).strip(" .,!?:;").casefold()

    if not normalized:

        return True

    return normalized in {

        "не указан",

        "не указана",

        "не указано",

        "неизвестно",

        "unknown",

        "n/a",

        "none",

        "нет",

    }





def _story_character_state_location_from_scene(value: str) -> str:

    normalized = _normalize_story_location_memory_content(value)

    if not normalized:

        return ""

    compact = re.sub(

        r"^(?:действие происходит|события происходят)\s*",

        "",

        normalized,

        flags=re.IGNORECASE,

    ).rstrip(" .!?…")

    compact = " ".join(compact.split()).strip()

    return compact or normalized.rstrip(" .!?…")





def _merge_story_character_state_text_field(
    *,
    field_name: str,
    existing_card: dict[str, Any],
    updated_card: dict[str, Any],
    scene_location_fallback: str,
    consume_manual_override_turns: bool = False,
) -> str:
    existing_value = str(existing_card.get(field_name) or "").strip()
    updated_value = str(updated_card.get(field_name) or "").strip()
    if _get_story_character_state_manual_override_turns(existing_card, field_name) > 0:
        return existing_value

    if field_name == "location":
        if updated_value and not _is_story_character_state_location_placeholder(updated_value):

            return updated_value

        if existing_value and not _is_story_character_state_location_placeholder(existing_value):

            return existing_value

        is_active = bool(updated_card.get("is_active", existing_card.get("is_active", True)))

        if is_active and scene_location_fallback:
            return scene_location_fallback
        return ""

    return updated_value or existing_value


def _get_story_character_state_manual_override_turns(
    card: dict[str, Any],
    field_name: str,
) -> int:
    lock_key = {
        "status": "status_manual_override_turns",
        "clothing": "clothing_manual_override_turns",
        "equipment": "equipment_manual_override_turns",
        "mood": "mood_manual_override_turns",
        "attitude_to_hero": "attitude_to_hero_manual_override_turns",
    }.get(str(field_name or "").strip())
    if not lock_key:
        return 0

    raw_value = card.get(lock_key)
    if isinstance(raw_value, bool):
        return 0
    if isinstance(raw_value, int):
        return max(raw_value, 0)
    if isinstance(raw_value, float):
        return max(int(raw_value), 0)

    normalized = str(raw_value or "").strip()
    if normalized.isdigit():
        return max(int(normalized), 0)
    return 0


def _build_story_character_state_card_prompt_content(card: dict[str, Any]) -> str:
    normalized_cards = _normalize_story_character_state_cards_payload([card])
    if not normalized_cards:
        return ""
    normalized_card = normalized_cards[0]
    lines = [

        f"мя: {str(normalized_card.get('name') or '').strip()}",

        f"Состояние здоровья: {str(normalized_card.get('status') or '').strip() or 'не указано'}",

        f"Одежда: {str(normalized_card.get('clothing') or '').strip() or 'не указано'}",

        f"Местоположение: {str(normalized_card.get('location') or '').strip() or 'не указано'}",

        f"Снаряжение: {str(normalized_card.get('equipment') or '').strip() or 'не указано'}",

    ]

    if str(normalized_card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_NPC:
        lines.insert(1, f"Активность: {'активен' if bool(normalized_card.get('is_active', True)) else 'неактивен'}")
        lines.extend(
            [
                f"Текущее настроение на начало этой сцены: {str(normalized_card.get('mood') or '').strip() or 'не указано'}",
                f"Текущее отношение к ГГ на начало этой сцены: {str(normalized_card.get('attitude_to_hero') or '').strip() or 'не указано'}",
                f"Характер: {str(normalized_card.get('personality') or '').strip() or 'не указано'}",
            ]
        )
        mood_manual_override_turns = _get_story_character_state_manual_override_turns(
            normalized_card,
            "mood",
        )
        if mood_manual_override_turns > 0 and str(normalized_card.get("mood") or "").strip():
            lines.append(
                "Ручная фиксация игроком: это настроение обязательно должно явно читаться в ближайшем ответе мастера."
            )
        attitude_manual_override_turns = _get_story_character_state_manual_override_turns(
            normalized_card,
            "attitude_to_hero",
        )
        if attitude_manual_override_turns > 0 and str(normalized_card.get("attitude_to_hero") or "").strip():
            lines.append(
                "Ручная фиксация игроком: это отношение к ГГ обязательно должно явно читаться в ближайшем ответе мастера."
            )
    if str(normalized_card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_MAIN_HERO:
        status_manual_override_turns = _get_story_character_state_manual_override_turns(
            normalized_card,
            "status",
        )
        if status_manual_override_turns > 0 and str(normalized_card.get("status") or "").strip():
            lines.append(
                "Ручная фиксация игроком: состояние здоровья героя обязательно для ближайшего ответа, пока сцена явно не меняет его."
            )
    content = "\n".join(line for line in lines if line.strip()).strip()
    if len(content) > STORY_CHARACTER_STATE_CARD_CONTENT_MAX_CHARS:

        content = content[: STORY_CHARACTER_STATE_CARD_CONTENT_MAX_CHARS].rstrip()

    return content





def _build_story_character_state_prompt_cards(game: StoryGame) -> list[dict[str, str]]:

    if not _normalize_story_character_state_enabled(getattr(game, "character_state_enabled", None)):

        return []

    prompt_cards: list[dict[str, str]] = []

    for card in _story_character_state_cards_from_game(game):

        kind = str(card.get("kind") or "").strip().lower()

        if kind == STORY_CHARACTER_STATE_KIND_NPC and not bool(card.get("is_active", True)):

            continue

        title = (

            STORY_CHARACTER_STATE_MAIN_HERO_PROMPT_TITLE

            if kind == STORY_CHARACTER_STATE_KIND_MAIN_HERO

            else f"{STORY_CHARACTER_STATE_NPC_PROMPT_TITLE_PREFIX} {str(card.get('name') or '').strip()}"

        )

        normalized_title = " ".join(title.split()).strip()

        content = _build_story_character_state_card_prompt_content(card)

        if normalized_title and content:

            prompt_cards.append({"title": normalized_title[:120].rstrip(), "content": content})

    return prompt_cards





def _extract_story_character_state_service_payload(

    text_value: str,

) -> tuple[str, dict[str, Any] | None]:

    normalized_text = str(text_value or "").replace("\r\n", "\n").strip()

    if not normalized_text:

        return ("", None)



    service_pattern = re.compile(

        rf"{re.escape(STORY_CHARACTER_STATE_SERVICE_TAG_OPEN)}\s*([\s\S]*?)\s*{re.escape(STORY_CHARACTER_STATE_SERVICE_TAG_CLOSE)}",

        re.IGNORECASE,

    )

    extracted_payload: dict[str, Any] | None = None



    def _replace_service_block(match: re.Match[str]) -> str:

        nonlocal extracted_payload

        if extracted_payload is None:

            raw_payload = _extract_json_object_from_text(str(match.group(1) or "").strip())

            if isinstance(raw_payload, dict) and raw_payload:

                extracted_payload = raw_payload

        return ""



    cleaned_text = service_pattern.sub(_replace_service_block, normalized_text)

    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()

    return (cleaned_text, extracted_payload)





def _normalize_story_character_state_service_name(value: Any) -> str:

    return " ".join(str(value or "").split()).strip().casefold()





def _normalize_story_character_state_service_text(value: Any, *, max_length: int = 400) -> str:

    normalized = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()

    if not normalized:

        return ""

    if len(normalized) > max_length:

        normalized = normalized[:max_length].rstrip()

    return normalized





def _apply_story_character_state_storyteller_service_payload(

    *,

    existing_cards: list[dict[str, Any]],

    base_payload: dict[str, Any] | None,

    storyteller_payload: dict[str, Any] | None,

) -> dict[str, Any] | None:

    if not existing_cards:

        return base_payload

    if not isinstance(storyteller_payload, dict) or not storyteller_payload:

        return base_payload



    raw_entries = storyteller_payload.get("npc_states")

    if not isinstance(raw_entries, list):

        raw_entries = storyteller_payload.get("cards")

    if not isinstance(raw_entries, list):

        return base_payload



    normalized_existing_cards = _normalize_story_character_state_cards_payload(existing_cards)

    existing_npc_by_name = {

        _normalize_story_character_state_service_name(card.get("name")): card

        for card in normalized_existing_cards

        if str(card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_NPC

        and _normalize_story_character_state_service_name(card.get("name"))

    }

    if not existing_npc_by_name:

        return base_payload



    base_cards_raw = base_payload.get("cards") if isinstance(base_payload, dict) else existing_cards

    normalized_base_cards = _normalize_story_character_state_cards_payload(base_cards_raw)

    base_by_key = {

        _story_character_state_card_key(card): dict(card)

        for card in normalized_base_cards

    }



    applied_override = False
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            continue
        target_name = _normalize_story_character_state_service_name(raw_entry.get("name"))

        if not target_name:

            continue

        target_card = existing_npc_by_name.get(target_name)

        if target_card is None:

            continue

        target_key = _story_character_state_card_key(target_card)

        next_card = dict(base_by_key.get(target_key, target_card))

        next_mood = _normalize_story_character_state_service_text(

            raw_entry.get("mood"),

        )

        next_attitude = _normalize_story_character_state_service_text(

            raw_entry.get("attitude_to_hero"),

        )

        if not next_mood and not next_attitude:
            continue
        current_mood = _normalize_story_character_state_service_text(next_card.get("mood"))
        current_attitude = _normalize_story_character_state_service_text(
            next_card.get("attitude_to_hero")
        )
        if next_mood and next_mood != current_mood:
            next_card["mood"] = next_mood
            applied_override = True
        if next_attitude and next_attitude != current_attitude:
            next_card["attitude_to_hero"] = next_attitude
            applied_override = True
        base_by_key[target_key] = next_card

    if not applied_override:
        return base_payload


    merged_cards = [

        dict(base_by_key.get(_story_character_state_card_key(card), card))

        for card in normalized_existing_cards

    ]

    normalized_merged_cards = _normalize_story_character_state_cards_payload(merged_cards)

    if not normalized_merged_cards:

        return base_payload

    return {"cards": normalized_merged_cards}





def _score_story_character_state_update_card(card: dict[str, Any]) -> int:

    score = 0

    for field_name in (

        "status",

        "clothing",

        "location",

        "equipment",

        "mood",

        "attitude_to_hero",

        "personality",

    ):

        if str(card.get(field_name) or "").strip():

            score += 1

    if bool(card.get("is_active", False)):

        score += 1

    if isinstance(card.get("world_card_id"), int):

        score += 1

    return score





def _resolve_story_character_state_existing_key(

    *,

    updated_card: dict[str, Any],

    existing_by_key: dict[str, dict[str, Any]],

    existing_key_by_world_card_id: dict[int, str],

    existing_keys_by_name: dict[str, list[str]],

) -> str | None:

    exact_key = _story_character_state_card_key(updated_card)

    if exact_key in existing_by_key:

        return exact_key



    world_card_id = updated_card.get("world_card_id")

    if isinstance(world_card_id, int):

        resolved_key = existing_key_by_world_card_id.get(world_card_id)

        if resolved_key:

            return resolved_key



    name_key = " ".join(str(updated_card.get("name") or "").split()).strip().casefold()

    if not name_key:

        return None



    candidate_keys = existing_keys_by_name.get(name_key, [])

    if not candidate_keys:

        return None

    if len(candidate_keys) == 1:

        return candidate_keys[0]



    updated_kind = str(updated_card.get("kind") or "").strip().lower()

    for candidate_key in candidate_keys:

        existing_card = existing_by_key.get(candidate_key)

        if existing_card is None:

            continue

        if str(existing_card.get("kind") or "").strip().lower() == updated_kind:

            return candidate_key

    return candidate_keys[0]





def _normalize_story_character_state_update_payload(
    raw_payload: Any,
    *,
    existing_cards: list[dict[str, Any]],
    current_location_content: str = "",
    consume_manual_override_turns: bool = False,
) -> dict[str, Any] | None:
    if not existing_cards:

        return None



    candidate_payload = raw_payload

    if isinstance(raw_payload, dict):

        candidate_payload = raw_payload.get("cards")

    normalized_updated_cards = _normalize_story_character_state_cards_payload(candidate_payload)

    if not normalized_updated_cards:

        return None



    normalized_existing_cards = _normalize_story_character_state_cards_payload(existing_cards)

    existing_by_key = {

        _story_character_state_card_key(card): card

        for card in normalized_existing_cards

    }

    existing_key_by_world_card_id = {

        int(card.get("world_card_id")): key

        for key, card in existing_by_key.items()

        if isinstance(card.get("world_card_id"), int)

    }

    existing_keys_by_name: dict[str, list[str]] = {}

    for key, card in existing_by_key.items():

        name_key = " ".join(str(card.get("name") or "").split()).strip().casefold()

        if not name_key:

            continue

        existing_keys_by_name.setdefault(name_key, []).append(key)



    updated_by_key: dict[str, dict[str, Any]] = {}

    for updated_card in normalized_updated_cards:

        resolved_key = _resolve_story_character_state_existing_key(

            updated_card=updated_card,

            existing_by_key=existing_by_key,

            existing_key_by_world_card_id=existing_key_by_world_card_id,

            existing_keys_by_name=existing_keys_by_name,

        )

        if not resolved_key:

            continue

        previous_card = updated_by_key.get(resolved_key)

        if previous_card is None or _score_story_character_state_update_card(updated_card) >= _score_story_character_state_update_card(previous_card):

            updated_by_key[resolved_key] = updated_card



    scene_location_fallback = _story_character_state_location_from_scene(current_location_content)



    merged_cards: list[dict[str, Any]] = []
    for key, existing_card in existing_by_key.items():
        updated_card = updated_by_key.get(key)
        if updated_card is None:
            merged_card = dict(existing_card)
            for protected_field_name in ("status", "clothing", "equipment", "mood", "attitude_to_hero"):
                protected_turns = _get_story_character_state_manual_override_turns(
                    existing_card,
                    protected_field_name,
                )
                lock_key = {
                    "status": "status_manual_override_turns",
                    "clothing": "clothing_manual_override_turns",
                    "equipment": "equipment_manual_override_turns",
                    "mood": "mood_manual_override_turns",
                    "attitude_to_hero": "attitude_to_hero_manual_override_turns",
                }.get(protected_field_name)
                if not lock_key or protected_turns <= 0:
                    continue
                if consume_manual_override_turns:
                    protected_turns -= 1
                if protected_turns > 0:
                    merged_card[lock_key] = protected_turns
                else:
                    merged_card.pop(lock_key, None)
            merged_cards.append(merged_card)
            continue

        merged_card = dict(existing_card)
        merged_card["world_card_id"] = existing_card.get("world_card_id")

        merged_card["kind"] = existing_card.get("kind") or updated_card.get("kind")

        merged_card["is_active"] = bool(updated_card.get("is_active", existing_card.get("is_active", True)))

        merged_card["name"] = str(updated_card.get("name") or existing_card.get("name") or "").strip()

        for field_name in (
            "status",
            "clothing",
            "location",
            "equipment",
            "mood",
            "attitude_to_hero",
            "personality",
        ):
            merged_card[field_name] = _merge_story_character_state_text_field(
                field_name=field_name,
                existing_card=existing_card,
                updated_card=updated_card,
                scene_location_fallback=scene_location_fallback,
                consume_manual_override_turns=consume_manual_override_turns,
            )
        for protected_field_name in ("status", "clothing", "equipment", "mood", "attitude_to_hero"):
            protected_turns = _get_story_character_state_manual_override_turns(
                existing_card,
                protected_field_name,
            )
            lock_key = {
                "status": "status_manual_override_turns",
                "clothing": "clothing_manual_override_turns",
                "equipment": "equipment_manual_override_turns",
                "mood": "mood_manual_override_turns",
                "attitude_to_hero": "attitude_to_hero_manual_override_turns",
            }.get(protected_field_name)
            if not lock_key or protected_turns <= 0:
                continue
            if consume_manual_override_turns:
                protected_turns -= 1
            if protected_turns > 0:
                merged_card[lock_key] = protected_turns
            else:
                merged_card.pop(lock_key, None)
        merged_cards.append(merged_card)


    normalized_merged_cards = _normalize_story_character_state_cards_payload(merged_cards)

    if not normalized_merged_cards:
        return None
    return {"cards": normalized_merged_cards}


def _get_story_main_hero_state_card(cards: list[dict[str, Any]]) -> dict[str, Any] | None:
    for card in _normalize_story_character_state_cards_payload(cards):
        if str(card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_MAIN_HERO:
            return card
    return None


def _collect_story_main_hero_explicit_state_evidence_sentences(
    latest_user_prompt: str,
) -> list[str]:
    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_600)
    if not normalized_user_prompt:
        return []

    sentence_candidates = _extract_story_memory_sentences(normalized_user_prompt)
    if not sentence_candidates:
        sentence_candidates = [
            " ".join(str(part or "").split()).strip()
            for part in re.split(r"(?<=[.!?…])\s+|\n+", normalized_user_prompt)
            if str(part or "").strip()
        ]

    first_person_markers = (
        " я ",
        " мне ",
        " меня ",
        " мой ",
        " моя ",
        " моё ",
        " мое ",
        " мои ",
        " у меня ",
        " со мной ",
        " моих ",
        " мою ",
        " моем ",
        " моём ",
        " моему ",
        " моей ",
    )
    explicit_state_markers = (
        "болез",
        "болен",
        "больна",
        "болею",
        "подцеп",
        "подхват",
        "забол",
        "симптом",
        "терниц",
        "тремор",
        "дрож",
        "озноб",
        "жар",
        "лихорад",
        "слабост",
        "обессил",
        "истощ",
        "тошнот",
        "рвот",
        "боль",
        "болит",
        "головокруж",
        "кашл",
        "ран",
        "кровотеч",
        "отрав",
        "яд",
        "проклят",
        "одет",
        "одета",
        "на мне",
        "снял",
        "сняла",
        "надел",
        "надела",
        "переод",
        "держу",
        "несу",
        "вооруж",
        "меч",
        "кинжал",
        "клинок",
        "лук",
        "арбалет",
        "щит",
        "посох",
        "сумк",
        "рюкзак",
        "плащ",
        "куртк",
        "сапог",
        "ботин",
        "перчат",
        "рубах",
        "корсет",
        "брюк",
        "голод",
        "устал",
        "раздраж",
        "зол",
        "сердит",
        "спокоен",
        "напуган",
        "взволнован",
        "тревож",
    )

    evidence_sentences: list[str] = []
    seen_sentences: set[str] = set()
    for raw_sentence in sentence_candidates:
        compact_sentence = " ".join(str(raw_sentence or "").split()).strip()
        if not compact_sentence:
            continue
        lowered_sentence = f" {compact_sentence.casefold()} "
        if not any(marker in lowered_sentence for marker in first_person_markers):
            continue
        if not any(marker in lowered_sentence for marker in explicit_state_markers):
            continue
        sentence_key = compact_sentence.casefold()
        if sentence_key in seen_sentences:
            continue
        seen_sentences.add(sentence_key)
        evidence_sentences.append(compact_sentence[:260].rstrip())
        if len(evidence_sentences) >= 4:
            break
    return evidence_sentences


def _normalize_story_main_hero_overlay_phrase(raw_value: str) -> str:
    normalized = " ".join(str(raw_value or "").replace("\r", " ").replace("\n", " ").split()).strip(" ,.;:-")
    if not normalized:
        return ""
    normalized = re.split(
        r"\b(?:и|но|а|однако|поэтому|потому что|так что|когда|где|чтобы|я|едва|еле|почти|словно|будто)\b",
        normalized,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" ,.;:-")
    normalized = re.sub(
        r"^(?:такую|такой|такая|эту|этой|это|свою|свой|свое|своё|сильную|л[её]гкую|болезнь|болезнью|болезни|состояние|симптомы|симптом|как)\s+",
        "",
        normalized,
        flags=re.IGNORECASE,
    ).strip(" ,.;:-")
    normalized = re.sub(r"\s+", " ", normalized).strip(" ,.;:-")
    if not normalized:
        return ""
    replacement_map = {
        "тремора": "тремор",
        "озноба": "озноб",
        "жара": "жар",
        "лихорадки": "лихорадка",
        "тошноты": "тошнота",
        "слабости": "слабость",
        "кашля": "кашель",
    }
    lowered_normalized = normalized.casefold()
    for source_value, target_value in replacement_map.items():
        if lowered_normalized == source_value:
            normalized = target_value
            break
        if lowered_normalized.startswith(f"{source_value} "):
            normalized = f"{target_value}{normalized[len(source_value):]}"
            break
    words = normalized.split()
    if len(words) > 6:
        normalized = " ".join(words[:6]).rstrip(" ,.;:-")
    return normalized


def _extract_story_main_hero_explicit_status_fragments(
    evidence_sentences: list[str],
) -> list[str]:
    if not evidence_sentences:
        return []

    phrase_patterns = (
        r"\b(?:болезн(?:ь|ью|и|ю)\s+как)\s+([^,.!?:;\n]+)",
        r"\b(?:болен|больна|болею|страдаю от)\s+([^,.!?:;\n]+)",
        r"\b(?:подцепил(?:а|и)?|подхватил(?:а|и)?|заразил(?:ся|ась)|заболел(?:а|и)?)\s+([^,.!?:;\n]+)",
        r"\b(?:у меня|мне)\s+([^,.!?:;\n]*(?:тремор|дрожь|озноб|жар|лихорад\w*|слабост\w*|тошнот\w*|боль|болит|головокруж\w*|каш[её]л\w*|ран\w*|кровотеч\w*)[^,.!?:;\n]*)",
        r"\b(?:из-за|от)\s+([^,.!?:;\n]*(?:тремор|дрож\w*|озноб|жар|лихорад\w*|слабост\w*|тошнот\w*|боль\w*|головокруж\w*|кашл\w*)[^,.!?:;\n]*)",
    )
    token_patterns = (
        r"\bтерниц\w*\b",
        r"\bтремор(?:\s+\w+){0,2}",
        r"\bдрож\w*(?:\s+\w+){0,2}",
        r"\bозноб(?:\s+\w+){0,2}",
        r"\bжар(?:\s+\w+){0,2}",
        r"\bлихорад\w*(?:\s+\w+){0,2}",
        r"\bслабост\w*(?:\s+\w+){0,2}",
        r"\bтошнот\w*(?:\s+\w+){0,2}",
        r"\bголовокруж\w*(?:\s+\w+){0,2}",
        r"\bкаш[её]л\w*(?:\s+\w+){0,2}",
        r"\bотрав\w*(?:\s+\w+){0,2}",
        r"\bяд\w*(?:\s+\w+){0,2}",
        r"\bпроклят\w*(?:\s+\w+){0,2}",
        r"\bран\w*(?:\s+\w+){0,2}",
        r"\bкровотеч\w*(?:\s+\w+){0,2}",
    )

    fragments: list[str] = []
    seen_fragments: set[str] = set()

    for sentence in evidence_sentences:
        for pattern in phrase_patterns:
            for match in re.finditer(pattern, sentence, flags=re.IGNORECASE):
                fragment = _normalize_story_main_hero_overlay_phrase(str(match.group(1) or ""))
                if not fragment:
                    continue
                fragment_key = fragment.casefold()
                if any(
                    fragment_key == existing_key
                    or fragment_key in existing_key
                    or existing_key in fragment_key
                    for existing_key in seen_fragments
                ):
                    continue
                seen_fragments.add(fragment_key)
                fragments.append(fragment)
                if len(fragments) >= 4:
                    return fragments

        for pattern in token_patterns:
            for match in re.finditer(pattern, sentence, flags=re.IGNORECASE):
                fragment = _normalize_story_main_hero_overlay_phrase(str(match.group(0) or ""))
                if not fragment:
                    continue
                fragment_key = fragment.casefold()
                if any(
                    fragment_key == existing_key
                    or fragment_key in existing_key
                    or existing_key in fragment_key
                    for existing_key in seen_fragments
                ):
                    continue
                seen_fragments.add(fragment_key)
                fragments.append(fragment)
                if len(fragments) >= 4:
                    return fragments

    return fragments


def _build_story_main_hero_explicit_state_evidence_text(
    latest_user_prompt: str,
) -> str:
    evidence_sentences = _collect_story_main_hero_explicit_state_evidence_sentences(latest_user_prompt)
    if not evidence_sentences:
        return ""
    return "\n".join(f"- {sentence}" for sentence in evidence_sentences).strip()


def _extract_story_main_hero_explicit_state_overlay(
    *,
    latest_user_prompt: str,
    existing_cards: list[dict[str, Any]],
) -> dict[str, str] | None:
    if not _normalize_story_prompt_text(latest_user_prompt, max_chars=1_600):
        return None

    main_hero_card = _get_story_main_hero_state_card(existing_cards)
    if not isinstance(main_hero_card, dict):
        return None

    evidence_sentences = _collect_story_main_hero_explicit_state_evidence_sentences(latest_user_prompt)
    if not evidence_sentences:
        return None

    status_fragments = _extract_story_main_hero_explicit_status_fragments(evidence_sentences)
    raw_overlay_values = {
        "status": ", ".join(status_fragments[:3]).strip(),
        "clothing": "",
        "equipment": "",
        "mood": "",
    }
    if not any(raw_overlay_values.values()):
        return None

    candidate_card = dict(main_hero_card)
    for field_name, field_value in raw_overlay_values.items():
        if field_value:
            candidate_card[field_name] = field_value
    normalized_candidate_cards = _normalize_story_character_state_cards_payload([candidate_card])
    if not normalized_candidate_cards:
        return None
    normalized_candidate = normalized_candidate_cards[0]

    overlay: dict[str, str] = {}
    for field_name, field_value in raw_overlay_values.items():
        if field_value:
            normalized_value = str(normalized_candidate.get(field_name) or "").strip()
            if normalized_value:
                overlay[field_name] = normalized_value
    return overlay or None


def _apply_story_main_hero_explicit_state_overlay(
    *,
    existing_cards: list[dict[str, Any]],
    base_payload: dict[str, Any] | None,
    overlay: dict[str, str] | None,
) -> dict[str, Any] | None:
    if not overlay:
        return base_payload

    normalized_existing_cards = _normalize_story_character_state_cards_payload(existing_cards)
    if not normalized_existing_cards:
        return base_payload

    main_hero_card = _get_story_main_hero_state_card(normalized_existing_cards)
    if not isinstance(main_hero_card, dict):
        return base_payload
    main_hero_key = _story_character_state_card_key(main_hero_card)

    base_cards_raw = base_payload.get("cards") if isinstance(base_payload, dict) else normalized_existing_cards
    normalized_base_cards = _normalize_story_character_state_cards_payload(base_cards_raw)
    if not normalized_base_cards:
        normalized_base_cards = normalized_existing_cards
    if not normalized_base_cards:
        return base_payload

    base_by_key = {
        _story_character_state_card_key(card): dict(card)
        for card in normalized_base_cards
    }
    next_card = dict(base_by_key.get(main_hero_key, main_hero_card))
    for field_name in ("status", "clothing", "equipment", "mood"):
        overlay_value = str(overlay.get(field_name) or "").strip()
        if overlay_value:
            next_card[field_name] = overlay_value
    base_by_key[main_hero_key] = next_card

    merged_cards = [
        dict(base_by_key.get(_story_character_state_card_key(card), card))
        for card in normalized_base_cards
    ]
    normalized_merged_cards = _normalize_story_character_state_cards_payload(merged_cards)
    if not normalized_merged_cards:
        return base_payload
    return {"cards": normalized_merged_cards}


def _list_story_character_state_seed_candidates(
    *,
    db: Session,
    game: StoryGame,
    only_missing_npc: bool = False,

) -> list[dict[str, Any]]:

    existing_cards = _story_character_state_cards_from_game(game)

    existing_card_ids = {

        int(card.get("world_card_id"))

        for card in existing_cards

        if isinstance(card.get("world_card_id"), int)

    }

    candidates: list[dict[str, Any]] = []

    for world_card in _list_story_world_cards(db, game.id):

        kind = str(getattr(world_card, "kind", "") or "").strip().lower()

        if kind not in {STORY_CHARACTER_STATE_KIND_MAIN_HERO, STORY_CHARACTER_STATE_KIND_NPC}:

            continue

        if only_missing_npc:

            if kind != STORY_CHARACTER_STATE_KIND_NPC:

                continue

            if int(world_card.id) in existing_card_ids:

                continue

        title = " ".join(str(getattr(world_card, "title", "") or "").split()).strip()

        content = str(getattr(world_card, "content", "") or "").replace("\r\n", "\n").strip()

        if not title:

            continue

        candidates.append(

            {

                "world_card_id": int(world_card.id),

                "name": title,

                "kind": kind,

                "content": content,

                "triggers": getattr(world_card, "triggers", None),

                "character_id": getattr(world_card, "character_id", None),

            }

        )

    candidates.sort(

        key=lambda card: (

            0 if str(card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_MAIN_HERO else 1,

            str(card.get("name") or "").casefold(),

        )

    )

    return candidates





def _build_story_character_state_recent_context(

    *,

    db: Session,

    game: StoryGame,

    max_messages: int = 6,

    max_chars: int = 3_600,

) -> str:

    parts: list[str] = []



    opening_scene = _normalize_story_prompt_text(

        str(getattr(game, "opening_scene", "") or ""),

        max_chars=1_000,

    )

    if opening_scene:

        parts.append(f"Открывающая сцена:\n{opening_scene}")



    recent_messages = list(

        db.scalars(

            select(StoryMessage)

            .where(

                StoryMessage.game_id == game.id,

                StoryMessage.undone_at.is_(None),

            )

            .order_by(StoryMessage.id.desc())

            .limit(max(max_messages, 1))

        )

    )

    if recent_messages:

        rendered_messages: list[str] = []

        for message in reversed(recent_messages):

            raw_content = str(getattr(message, "content", "") or "").replace("\r\n", "\n").strip()

            if not raw_content:

                continue

            normalized_content = raw_content

            if str(getattr(message, "role", "") or "").strip() == STORY_ASSISTANT_ROLE:

                normalized_content = _strip_story_markup_for_memory_text(raw_content).replace("\r\n", "\n").strip()

                if not normalized_content:

                    normalized_content = _normalize_story_markup_to_plain_text(raw_content).replace("\r\n", "\n").strip()

                if not normalized_content:

                    normalized_content = raw_content

            normalized_content = _normalize_story_prompt_text(normalized_content, max_chars=900)

            if not normalized_content:

                continue

            role_value = str(getattr(message, "role", "") or "").strip()

            role_label = "грок" if role_value == STORY_USER_ROLE else "Мастер" if role_value == STORY_ASSISTANT_ROLE else "Система"

            rendered_messages.append(f"{role_label}:\n{normalized_content}")

        if rendered_messages:

            rendered_story_context = "\n\n".join(rendered_messages)

            parts.append(f"Недавний сюжетный контекст:\n{rendered_story_context}")



    combined = "\n\n".join(part for part in parts if part.strip()).strip()

    if not combined:

        return ""

    if len(combined) > max_chars:

        combined = combined[:max_chars].rstrip()

    return combined





def _request_story_character_state_seed_cards(

    *,

    db: Session,

    game: StoryGame,

    candidates: list[dict[str, Any]],

) -> list[dict[str, Any]]:

    normalized_candidates = [

        {

            "world_card_id": int(card.get("world_card_id")),

            "name": str(card.get("name") or "").strip(),

            "kind": str(card.get("kind") or "").strip(),

            "content": str(card.get("content") or "").replace("\r\n", "\n").strip(),

            "triggers": getattr(card.get("triggers"), "copy", lambda: card.get("triggers"))()

            if card.get("triggers") is not None

            else [],

            "character_id": card.get("character_id"),

        }

        for card in candidates

        if isinstance(card.get("world_card_id"), int) and str(card.get("name") or "").strip()

    ]

    if not normalized_candidates or not settings.openrouter_api_key:

        return []



    current_location_content = _get_story_latest_location_memory_content(db=db, game_id=game.id)

    current_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_datetime_facts = _format_story_environment_datetime_prompt_facts(

        _deserialize_story_environment_datetime(current_datetime)

    )

    current_weather = _deserialize_story_environment_weather(
        str(getattr(game, "environment_current_weather", "") or "")

    )

    tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )

    recent_story_context = _build_story_character_state_recent_context(

        db=db,

        game=game,

    )

    messages_payload = [

        {

            "role": "system",

            "content": (

                "Create persistent RPG character-state cards for an admin continuity panel. "

                "Return strict JSON only without markdown in this shape: "

                "{\"cards\":[{\"world_card_id\":123,\"name\":\"...\",\"kind\":\"main_hero\"|\"npc\",\"is_active\":true,"

                "\"status\":\"...\",\"clothing\":\"...\",\"location\":\"...\",\"equipment\":\"...\","

                "\"mood\":\"...\",\"attitude_to_hero\":\"...\",\"personality\":\"...\"}]}. "

                "Main hero must always be active. "

                "For NPC cards, include realistic mood, attitude, and personality. "

                "If exact details are missing, infer conservatively from the character card and current story continuity. "

                "Use the opening scene and recent story context as real evidence when they are provided. "

                "For the main hero, explicit player-stated bodily facts in recent story context are authoritative unless later narration clearly contradicts or resolves them. "

                "Do not invent impossible teleports or sudden character flips. "

                "If an NPC is not currently in the active scene, you may mark is_active=false. "

                "status and clothing must never be empty for the main hero or for any NPC card with is_active=true. "

                "If either of those fields is missing, infer and fill it conservatively from recent story context and that target character's own source description. "

                "Do not borrow clothing or health details from other characters. "

                "status must describe only bodily or health condition: wounds, illness, poison, exhaustion, intoxication, or normal physical state. "

                "If the source card or current continuity explicitly names a disease, poison, curse, chronic condition, disability, pregnancy, wound, or other abnormal physical state, preserve that exact condition in status instead of flattening it to 'нормальное'. "

                "Use 'нормальное' only when the available source material truly gives no evidence of any abnormal physical condition. "

                "Never use action, pose, mood, or location in status. "

                "clothing must describe what is worn on specific body areas: head, upper body, outer layer, lower body, feet, hands, and visible accessories when relevant. "

                "Do not use generic phrases like 'обычная одежда', 'одежда авантюристки', or 'легкая одежда' without concrete breakdown. "

                "Track small but persistent clothing details when they matter to continuity: one boot removed, torn sleeve, loosened belt, wet hem, broken clasp, blood stains, dirt, missing glove, hood up or down. "

                "Be detailed but practical, without turning into obsessive inventory. "

                "location must never be empty, 'неизвестно', 'не указано', or vague filler. "

                "Every card must receive one plausible concrete current location. If the exact place is unstated, infer the most likely current place from the current scene, recent story context, world facts, role, home, workplace, faction, duties, or routine. "

                "equipment must be concrete and definite. Never write alternatives or uncertainty such as 'или', '/', 'возможно', or 'скорее всего'. "

                "If details are unclear, choose one conservative concrete version instead of listing options. "

                "attitude_to_hero is not mood: it must describe the interpersonal bond to the hero and its intensity. "

                "Infer it like a human reader from the character's behavior, initiative, boundaries, generosity, sacrifice, risk, protectiveness, vulnerability, dependency, jealousy, distance, warmth, hostility, and willingness to share time, resources, trust, or private space with the hero. "

                "Do not wait for explicit labels like 'влюблена', 'доверяет', or 'ненавидит'; read the situation and subtext. "

                "If the NPC's actions show personal investment in the hero beyond routine politeness, duty, or a purely transactional exchange, attitude_to_hero must reflect that and should not stay lazily 'нейтральное'. "

                "Use 'нейтральное' only when the interaction is genuinely impersonal, routine, professional, transactional, or there is too little evidence for anything more specific. "

                "If the relationship is mixed or currently shifting, use a short specific mixed bond state instead of flattening it to 'дружественное' or 'нейтральное'. "

                "attitude_to_hero describes the noun 'отношение', so use grammatically neuter Russian forms such as 'нейтральное', 'доброжелательное', 'заинтересованное', 'доверительное', 'зависимое', 'романтическое', or 'враждебное'. "

                "All text must be in Russian and practical, not flowery."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Текущее место:\n{current_location_content or 'нет'}\n\n"

                f"Текущее время:\n{current_datetime or 'нет'}\n\n"

                f"Текущая погода:\n{json.dumps(current_weather, ensure_ascii=False) if isinstance(current_weather, dict) else 'нет'}\n\n"

                f"Погода завтра:\n{json.dumps(tomorrow_weather, ensure_ascii=False) if isinstance(tomorrow_weather, dict) else 'нет'}\n\n"

                f"Сюжетный контекст:\n{recent_story_context or 'нет'}\n\n"

                f"Нужно создать карточки для:\n{json.dumps(normalized_candidates, ensure_ascii=False)}"

            ),

        },

    ]



    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=STORY_CHARACTER_STATE_GENERATION_MODEL,

                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.2,

                max_tokens=STORY_CHARACTER_STATE_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story character-state seed failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.25)

                continue

            return []



        parsed_payload = _extract_json_object_from_text(raw_response.replace("\r\n", "\n").strip())
        if not isinstance(parsed_payload, dict) or not parsed_payload:
            if attempt_index == 0:
                time.sleep(0.15)
                continue
            return []

        normalized_cards = _normalize_story_character_state_cards_payload(parsed_payload.get("cards"))
        if normalized_cards:
            has_user_messages = bool(
                db.scalar(
                    select(StoryMessage.id)
                    .where(
                        StoryMessage.game_id == game.id,
                        StoryMessage.role == STORY_USER_ROLE,
                        StoryMessage.undone_at.is_(None),
                    )
                    .limit(1)
                )
            )
            if not has_user_messages:
                adjusted_cards: list[dict[str, Any]] = []
                for card in normalized_cards:
                    if str(card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_MAIN_HERO:
                        adjusted_card = dict(card)
                        adjusted_card["status"] = "нормальное"
                        adjusted_cards.append(adjusted_card)
                    else:
                        adjusted_cards.append(card)
                normalized_cards = _normalize_story_character_state_cards_payload(adjusted_cards)
            return normalized_cards
        if attempt_index == 0:
            time.sleep(0.15)
    return []





def _request_story_character_state_missing_location_cards(

    *,

    db: Session,

    game: StoryGame,

    cards: list[dict[str, Any]],

    only_npc: bool = True,

) -> list[dict[str, Any]]:

    normalized_cards = _normalize_story_character_state_cards_payload(cards)

    if not normalized_cards or not settings.openrouter_api_key:

        return []



    world_cards_by_id = {

        int(getattr(world_card, "id")): {

            "world_card_id": int(getattr(world_card, "id")),

            "name": " ".join(str(getattr(world_card, "title", "") or "").split()).strip(),

            "kind": str(getattr(world_card, "kind", "") or "").strip().lower(),

            "content": str(getattr(world_card, "content", "") or "").replace("\r\n", "\n").strip(),

            "triggers": getattr(world_card, "triggers", None),

            "character_id": getattr(world_card, "character_id", None),

        }

        for world_card in _list_story_world_cards(db, game.id)

        if isinstance(getattr(world_card, "id", None), int)

    }



    target_cards: list[dict[str, Any]] = []

    for card in normalized_cards:

        kind = str(card.get("kind") or "").strip().lower()

        if only_npc and kind != STORY_CHARACTER_STATE_KIND_NPC:

            continue

        if not _is_story_character_state_location_placeholder(card.get("location")):

            continue

        world_card_payload = world_cards_by_id.get(int(card.get("world_card_id") or 0), {})

        target_cards.append(

            {

                "world_card_id": card.get("world_card_id"),

                "name": str(card.get("name") or "").strip(),

                "kind": kind or STORY_CHARACTER_STATE_KIND_NPC,

                "is_active": bool(card.get("is_active", True)),

                "current_location": str(card.get("location") or "").strip(),

                "world_card_content": str(world_card_payload.get("content") or "").strip(),

                "world_card_triggers": world_card_payload.get("triggers") or [],

                "character_id": world_card_payload.get("character_id"),

            }

        )

    if not target_cards:

        return []



    current_location_content = _get_story_latest_location_memory_content(db=db, game_id=game.id)

    current_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_current_weather", "") or "")

    )

    tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )

    recent_story_context = _build_story_character_state_recent_context(

        db=db,

        game=game,

    )



    messages_payload = [

        {

            "role": "system",

            "content": (

                "Fill only missing RPG character-state locations for an admin continuity panel. "

                "Return strict JSON only without markdown in this shape: "

                "{\"cards\":[{\"world_card_id\":123,\"name\":\"...\",\"kind\":\"npc\",\"is_active\":false,\"location\":\"...\"}]}. "

                "Update only the provided target cards. "

                "Do not invent new cards and do not touch cards with already known locations because they are not part of the request. "

                "location must never be empty, 'неизвестно', 'не указано', or vague filler. "

                "Infer one plausible concrete current location for each target from the opening scene, recent story context, current scene location, time, weather, world card content, role, home, workplace, faction, duties, habits, or daily routine. "

                "If a target card is active and the current scene location is known, prefer keeping that character in the current scene unless the texts clearly place them elsewhere. "

                "For inactive NPCs without direct evidence, choose one conservative routine place logically tied to the character instead of leaving location blank. "

                "All text must be in Russian and practical."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Текущее место сцены:\n{current_location_content or 'нет'}\n\n"

                f"Текущее время:\n{current_datetime or 'нет'}\n\n"

                f"Текущая погода:\n{json.dumps(current_weather, ensure_ascii=False) if isinstance(current_weather, dict) else 'нет'}\n\n"

                f"Погода завтра:\n{json.dumps(tomorrow_weather, ensure_ascii=False) if isinstance(tomorrow_weather, dict) else 'нет'}\n\n"

                f"Сюжетный контекст:\n{recent_story_context or 'нет'}\n\n"

                f"Текущие карточки состояния:\n{json.dumps(normalized_cards, ensure_ascii=False)}\n\n"

                f"Карточки с пустым местоположением:\n{json.dumps(target_cards, ensure_ascii=False)}"

            ),

        },

    ]



    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=STORY_CHARACTER_STATE_GENERATION_MODEL,

                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.2,

                max_tokens=STORY_CHARACTER_STATE_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story character-state location resolution failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.25)

                continue

            return []



        parsed_payload = _extract_json_object_from_text(raw_response.replace("\r\n", "\n").strip())

        if not isinstance(parsed_payload, dict) or not parsed_payload:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return []



        normalized_location_cards = _normalize_story_character_state_cards_payload(parsed_payload.get("cards"))

        if normalized_location_cards:

            return [

                card

                for card in normalized_location_cards

                if not _is_story_character_state_location_placeholder(card.get("location"))

            ]

        if attempt_index == 0:

            time.sleep(0.15)

    return []


def _request_story_character_state_missing_body_field_cards(
    *,
    db: Session,
    game: StoryGame,
    cards: list[dict[str, Any]],
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
) -> list[dict[str, Any]]:
    normalized_cards = _normalize_story_character_state_cards_payload(cards)
    if not normalized_cards or not settings.openrouter_api_key:
        return []

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_600)
    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=2_200)
    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=2_800)
    if not normalized_user_prompt and not normalized_previous_assistant and not normalized_latest_assistant:
        return []

    world_cards_by_id = {
        int(getattr(world_card, "id")): {
            "world_card_id": int(getattr(world_card, "id")),
            "name": " ".join(str(getattr(world_card, "title", "") or "").split()).strip(),
            "kind": str(getattr(world_card, "kind", "") or "").strip().lower(),
            "content": str(getattr(world_card, "content", "") or "").replace("\r\n", "\n").strip(),
            "triggers": getattr(world_card, "triggers", None),
            "character_id": getattr(world_card, "character_id", None),
        }
        for world_card in _list_story_world_cards(db, game.id)
        if isinstance(getattr(world_card, "id", None), int)
    }

    target_cards: list[dict[str, Any]] = []
    target_world_card_ids: set[int] = set()
    for card in normalized_cards:
        kind = str(card.get("kind") or "").strip().lower()
        is_active = bool(card.get("is_active", True))
        if kind not in {STORY_CHARACTER_STATE_KIND_MAIN_HERO, STORY_CHARACTER_STATE_KIND_NPC}:
            continue
        if kind == STORY_CHARACTER_STATE_KIND_NPC and not is_active:
            continue

        current_status = str(card.get("status") or "").strip()
        current_clothing = str(card.get("clothing") or "").strip()
        missing_fields = [
            field_name
            for field_name, field_value in (
                ("status", current_status),
                ("clothing", current_clothing),
            )
            if not field_value
        ]
        if not missing_fields:
            continue

        world_card_id = int(card.get("world_card_id") or 0)
        if world_card_id > 0:
            target_world_card_ids.add(world_card_id)
        world_card_payload = world_cards_by_id.get(world_card_id, {})
        target_cards.append(
            {
                "world_card_id": card.get("world_card_id"),
                "name": str(card.get("name") or "").strip(),
                "kind": kind,
                "is_active": is_active,
                "missing_fields": missing_fields,
                "current_status": current_status,
                "current_clothing": current_clothing,
                "current_location": str(card.get("location") or "").strip(),
                "current_equipment": str(card.get("equipment") or "").strip(),
                "source_description": str(world_card_payload.get("content") or "").strip(),
                "source_triggers": world_card_payload.get("triggers") or [],
                "character_id": world_card_payload.get("character_id"),
            }
        )

    if not target_cards:
        return []

    current_location_content = _get_story_latest_location_memory_content(db=db, game_id=game.id)
    recent_story_context = _build_story_character_state_recent_context(
        db=db,
        game=game,
        max_messages=6,
        max_chars=2_800,
    )

    target_by_key = {
        _story_character_state_card_key(card): card
        for card in normalized_cards
        if int(card.get("world_card_id") or 0) in target_world_card_ids
    }
    existing_key_by_world_card_id = {
        int(card.get("world_card_id")): key
        for key, card in target_by_key.items()
        if isinstance(card.get("world_card_id"), int)
    }
    existing_keys_by_name: dict[str, list[str]] = {}
    for key, card in target_by_key.items():
        name_key = " ".join(str(card.get("name") or "").split()).strip().casefold()
        if not name_key:
            continue
        existing_keys_by_name.setdefault(name_key, []).append(key)

    messages_payload = [
        {
            "role": "system",
            "content": (
                "Fill only missing status and clothing fields for the provided RPG character-state target cards. "
                "Return strict JSON only without markdown in this shape: "
                "{\"cards\":[{\"world_card_id\":123,\"name\":\"...\",\"kind\":\"main_hero\"|\"npc\",\"is_active\":true,"
                "\"status\":\"...\",\"clothing\":\"...\"}]}. "
                "Use only the provided target cards. Do not invent or return any other cards. "
                "These target cards already represent only the main hero and active NPCs that currently have missing fields. "
                "Ignore inactive NPCs and everyone else. "
                "Use evidence in this priority order: latest player turn, newest narrator reply, and the target character's own source description. "
                "Use the previous narrator reply only when needed to disambiguate continuity. "
                "For the main hero, explicit player-stated bodily or clothing facts override softer inference unless the newest narrator reply clearly contradicts them. "
                "If a target already has one of these two fields filled, preserve that filled field and only infer the missing one. "
                "status must never be empty. It must describe bodily or health condition only. "
                "If there is no evidence of illness, poison, injury, exhaustion, intoxication, or another abnormal condition, use 'нормальное'. "
                "Never put mood, action, pose, role, or location into status. "
                "clothing must never be empty. It must be a short concrete Russian description of what is worn. "
                "If the exact outfit is not stated directly, infer one conservative concrete outfit from the target character's own description, role, and current scene continuity. "
                "Do not use vague clothing like 'обычная одежда', 'подходящая одежда', 'неизвестно', or 'не указано'. "
                "Do not borrow clothing or health details from other characters' descriptions. "
                "All output text must be in practical Russian."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Current scene location:\n{current_location_content or 'none'}\n\n"
                f"Recent story context:\n{recent_story_context or 'none'}\n\n"
                f"Latest player turn:\n{normalized_user_prompt or 'none'}\n\n"
                f"Previous narrator reply:\n{normalized_previous_assistant or 'none'}\n\n"
                f"Newest narrator reply:\n{normalized_latest_assistant or 'none'}\n\n"
                f"Target cards that require filling:\n{json.dumps(target_cards, ensure_ascii=False)}"
            ),
        },
    ]

    for attempt_index in range(2):
        try:
            raw_response = _request_openrouter_story_text(
                messages_payload,
                model_name="x-ai/grok-4.1-fast",
                allow_free_fallback=False,
                translate_input=False,
                fallback_model_names=[],
                temperature=0.0,
                max_tokens=min(STORY_CHARACTER_STATE_REQUEST_MAX_TOKENS, 700),
                request_timeout=(
                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,
                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,
                ),
            )
        except Exception as exc:
            logger.warning(
                "Story character-state missing body-field fill failed on attempt %s/2: %s",
                attempt_index + 1,
                exc,
            )
            if attempt_index == 0:
                time.sleep(0.25)
                continue
            return []

        parsed_payload = _extract_json_object_from_text(raw_response.replace("\r\n", "\n").strip())
        if not isinstance(parsed_payload, dict) or not parsed_payload:
            if attempt_index == 0:
                time.sleep(0.15)
                continue
            return []

        normalized_response_cards = _normalize_story_character_state_cards_payload(parsed_payload.get("cards"))
        if not normalized_response_cards:
            if attempt_index == 0:
                time.sleep(0.15)
                continue
            return []

        resolved_cards: list[dict[str, Any]] = []
        for response_card in normalized_response_cards:
            resolved_key = _resolve_story_character_state_existing_key(
                updated_card=response_card,
                existing_by_key=target_by_key,
                existing_key_by_world_card_id=existing_key_by_world_card_id,
                existing_keys_by_name=existing_keys_by_name,
            )
            if not resolved_key:
                continue

            base_target_card = target_by_key.get(resolved_key)
            if base_target_card is None:
                continue

            next_status = str(response_card.get("status") or base_target_card.get("status") or "").strip()
            next_clothing = str(response_card.get("clothing") or base_target_card.get("clothing") or "").strip()
            if not next_status and not next_clothing:
                continue

            resolved_cards.append(
                {
                    "world_card_id": base_target_card.get("world_card_id"),
                    "name": str(base_target_card.get("name") or "").strip(),
                    "kind": str(base_target_card.get("kind") or "").strip().lower(),
                    "is_active": bool(base_target_card.get("is_active", True)),
                    "status": next_status,
                    "clothing": next_clothing,
                }
            )

        if resolved_cards:
            return _normalize_story_character_state_cards_payload(resolved_cards)
        if attempt_index == 0:
            time.sleep(0.15)

    return []


def _fill_story_character_state_missing_body_fields_payload(
    *,
    db: Session,
    game: StoryGame,
    existing_cards: list[dict[str, Any]],
    base_payload: dict[str, Any] | None,
    current_location_content: str,
    latest_user_prompt: str,
    previous_assistant_text: str,
    latest_assistant_text: str,
) -> dict[str, Any] | None:
    base_cards_raw = base_payload.get("cards") if isinstance(base_payload, dict) else existing_cards
    normalized_base_cards = _normalize_story_character_state_cards_payload(base_cards_raw)
    if not normalized_base_cards:
        return base_payload

    fill_cards = _request_story_character_state_missing_body_field_cards(
        db=db,
        game=game,
        cards=normalized_base_cards,
        latest_user_prompt=latest_user_prompt,
        previous_assistant_text=previous_assistant_text,
        latest_assistant_text=latest_assistant_text,
    )
    if not fill_cards:
        return base_payload

    merged_payload = _normalize_story_character_state_update_payload(
        {"cards": fill_cards},
        existing_cards=normalized_base_cards,
        current_location_content=current_location_content,
    )
    if not isinstance(merged_payload, dict):
        return base_payload
    return merged_payload


def _sync_story_character_state_cards(

    *,

    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage | None = None,

    resolved_payload_override: dict[str, Any] | None = None,

    current_location_content: str = "",

) -> bool:

    if not _normalize_story_character_state_enabled(getattr(game, "character_state_enabled", None)):

        return False

    existing_cards = _story_character_state_cards_from_game(game)

    if not existing_cards or not isinstance(resolved_payload_override, dict):

        return False

    normalized_payload = _normalize_story_character_state_update_payload(
        resolved_payload_override,
        existing_cards=existing_cards,
        current_location_content=current_location_content,
        consume_manual_override_turns=True,
    )
    if not isinstance(normalized_payload, dict):

        return False

    next_cards_raw = normalized_payload.get("cards")

    next_cards = _normalize_story_character_state_cards_payload(next_cards_raw)

    next_payload = _serialize_story_character_state_cards_payload(next_cards)

    if str(getattr(game, "character_state_payload", "") or "") == next_payload:

        return False

    if isinstance(assistant_message, StoryMessage):

        _ensure_story_character_state_snapshot_baseline(db=db, game=game)

    game.character_state_payload = next_payload

    if isinstance(assistant_message, StoryMessage):

        _create_story_character_state_assistant_snapshot(

            db=db,

            game=game,

            assistant_message=assistant_message,

        )

    logger.info(

        "Story character-state updated: game_id=%s cards=%s",

        game.id,

        len(next_cards),

    )

    return True




def _upsert_story_weather_memory_block(

    *,

    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage | None = None,

) -> bool:

    target_assistant_message_id = (

        int(assistant_message.id)

        if isinstance(assistant_message, StoryMessage)

        else None

    )

    weather_blocks_desc = sorted(

        [

            block

            for block in _list_story_memory_blocks(db, game.id)

            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_WEATHER

        ],

        key=lambda block: block.id,

        reverse=True,

    )

    current_blocks = [

        block

        for block in weather_blocks_desc

        if (

            target_assistant_message_id is None

            and block.assistant_message_id is None

        )

        or (

            target_assistant_message_id is not None

            and int(getattr(block, "assistant_message_id", 0) or 0) == target_assistant_message_id

        )

    ]

    current_block = current_blocks[0] if current_blocks else None

    duplicate_blocks = current_blocks[1:]

    previous_weather_block = next(

        (

            block

            for block in weather_blocks_desc

            if not (

                (

                    target_assistant_message_id is None

                    and block.assistant_message_id is None

                )

                or (

                    target_assistant_message_id is not None

                    and int(getattr(block, "assistant_message_id", 0) or 0) == target_assistant_message_id

                )

            )

        ),

        None,

    )

    previous_weather_content = (

        _strip_story_environment_snapshot_from_memory_content(

            str(getattr(previous_weather_block, "content", "") or "")

        )

        if isinstance(previous_weather_block, StoryMemoryBlock)

        else ""

    )

    previous_weather_snapshot = (

        _split_story_environment_snapshot_from_memory_content(

            str(getattr(previous_weather_block, "content", "") or "")

        )[0]

        if isinstance(previous_weather_block, StoryMemoryBlock)

        else None

    )

    normalized_content = _build_story_weather_memory_content(

        current_weather=_deserialize_story_environment_weather(

            str(getattr(game, "environment_current_weather", "") or "")

        ),

        tomorrow_weather=_deserialize_story_environment_weather(

            str(getattr(game, "environment_tomorrow_weather", "") or "")

        ),

    )

    snapshot_payload = _build_story_environment_snapshot_payload(game=game)

    storage_content = _embed_story_environment_snapshot_in_memory_content(

        normalized_content,

        snapshot_payload,

    )



    changed = False

    if not normalized_content:

        if current_blocks:

            for block in current_blocks:

                db.delete(block)

            db.flush()

            return True

        return False



    if (

        target_assistant_message_id is not None

        and (

        previous_weather_content

        and normalized_content.casefold() == previous_weather_content.casefold()

        and _build_story_environment_snapshot_signature(previous_weather_snapshot)

        == _build_story_environment_snapshot_signature(snapshot_payload)

        )

    ):

        if current_blocks:

            for block in current_blocks:

                db.delete(block)

            db.flush()

            return True

        return False



    normalized_title = _normalize_story_memory_block_title(

        STORY_MEMORY_WEATHER_TITLE,

        fallback=STORY_MEMORY_WEATHER_TITLE,

    )

    next_token_count = max(_estimate_story_tokens(normalized_content), 1)

    if current_block is not None:

        if (

            current_block.title != normalized_title

            or current_block.content != storage_content

            or int(getattr(current_block, "token_count", 0) or 0) != next_token_count

        ):

            current_block.title = normalized_title

            current_block.content = storage_content

            current_block.token_count = next_token_count

            changed = True

        for block in duplicate_blocks:

            db.delete(block)

            changed = True

        if changed:

            db.flush()

    else:

        _create_story_memory_block(

            db=db,

            game_id=game.id,

            assistant_message_id=target_assistant_message_id,

            layer=STORY_MEMORY_LAYER_WEATHER,

            title=normalized_title,

            content=storage_content,

            preserve_content=True,

        )

        created_block = db.scalar(

            select(StoryMemoryBlock)

            .where(

                StoryMemoryBlock.game_id == game.id,

                StoryMemoryBlock.assistant_message_id == target_assistant_message_id,

                StoryMemoryBlock.layer == STORY_MEMORY_LAYER_WEATHER,

            )

            .order_by(StoryMemoryBlock.id.desc())

        )

        if isinstance(created_block, StoryMemoryBlock) and int(getattr(created_block, "token_count", 0) or 0) != next_token_count:

            created_block.token_count = next_token_count

            db.flush()

        changed = True



    if changed:

        logger.info(

            "Story weather memory updated: game_id=%s assistant_message_id=%s content=%s",

            game.id,

            target_assistant_message_id,

            normalized_content,

        )

    return changed





def _restore_story_environment_state_from_latest_weather_memory_block(

    *,

    db: Session,

    game: StoryGame,

) -> bool:

    if not _normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):

        return False



    latest_weather_blocks = [

        block

        for block in reversed(_list_story_memory_blocks(db, game.id))

        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_WEATHER

    ]

    for block in latest_weather_blocks:

        snapshot_payload, _ = _split_story_environment_snapshot_from_memory_content(

            str(getattr(block, "content", "") or "")

        )

        if not isinstance(snapshot_payload, dict) or not snapshot_payload:

            continue



        next_datetime, next_current_weather, next_tomorrow_weather = _build_story_environment_snapshot_signature(

            snapshot_payload

        )

        if not next_datetime:

            continue



        changed = False

        if str(getattr(game, "environment_current_datetime", "") or "") != next_datetime:

            game.environment_current_datetime = next_datetime

            changed = True

        if str(getattr(game, "environment_current_weather", "") or "") != next_current_weather:

            game.environment_current_weather = next_current_weather

            changed = True

        if str(getattr(game, "environment_tomorrow_weather", "") or "") != next_tomorrow_weather:

            game.environment_tomorrow_weather = next_tomorrow_weather

            changed = True

        if changed:

            db.flush()

        return changed



    return False





def _normalize_story_location_analysis_payload(raw_payload: Any) -> dict[str, str] | None:

    if isinstance(raw_payload, str):

        normalized_response = raw_payload.replace("\r\n", "\n").strip()

        if not normalized_response:

            return None

        if normalized_response.upper() == "KEEP":

            return {"action": "keep"}

        return None

    if not isinstance(raw_payload, dict) or not raw_payload:

        return None



    raw_action = str(raw_payload.get("action") or "").strip().lower()

    if raw_action in {"keep", "leave", "preserve", "unchanged", "same"}:

        return {"action": "keep"}



    raw_content = (

        raw_payload.get("content")

        or raw_payload.get("location_sentence")

        or ""

    )

    normalized_content = _normalize_story_location_memory_content(str(raw_content or ""))

    if not normalized_content:

        return None

    return {
        "action": "update",
        "content": normalized_content,
        "label": _resolve_story_location_memory_label(
            label=str(raw_payload.get("label") or raw_payload.get("short_label") or ""),
            content=normalized_content,
        ),
    }





def _normalize_story_environment_analysis_payload(

    raw_payload: Any,

    *,

    current_datetime: str,

    current_weather: dict[str, Any] | None,

    tomorrow_weather: dict[str, Any] | None,

) -> dict[str, Any] | None:

    if not isinstance(raw_payload, dict) or not raw_payload:

        return None



    raw_action = str(raw_payload.get("action") or "").strip().lower()

    if raw_action in {"keep", "leave", "preserve", "unchanged", "same"}:

        return {"action": "keep"}



    raw_current_datetime = (

        raw_payload.get("current_datetime")

        or raw_payload.get("datetime")

        or raw_payload.get("current_time")

        or ""

    )

    normalized_datetime = _normalize_story_environment_datetime(

        str(raw_current_datetime or current_datetime or "")

    )

    normalized_current_weather = _normalize_story_environment_weather_payload(

        raw_payload.get("current_weather")

    )

    if normalized_current_weather is None and isinstance(current_weather, dict):

        normalized_current_weather = current_weather

    normalized_tomorrow_weather = _normalize_story_environment_weather_payload(

        raw_payload.get("tomorrow_weather")

    )

    if normalized_tomorrow_weather is None and isinstance(tomorrow_weather, dict):

        normalized_tomorrow_weather = tomorrow_weather

    return {

        "action": "update",

        "current_datetime": normalized_datetime,

        "current_weather": normalized_current_weather,

        "tomorrow_weather": normalized_tomorrow_weather,

    }





def _normalize_story_important_event_analysis_payload(
    raw_payload: Any,
    *,
    latest_user_prompt: str = "",
    latest_assistant_text: str = "",
) -> tuple[str, str] | None:

    if not isinstance(raw_payload, dict) or not raw_payload:

        return None



    raw_is_important = raw_payload.get("is_important")

    is_important = False

    if isinstance(raw_is_important, bool):

        is_important = raw_is_important

    elif isinstance(raw_is_important, (int, float)):

        is_important = bool(raw_is_important)

    elif isinstance(raw_is_important, str):

        is_important = raw_is_important.strip().lower() in {"1", "true", "yes"}



    raw_importance_score = raw_payload.get("importance_score")

    importance_score = 0

    if isinstance(raw_importance_score, bool):

        importance_score = 100 if raw_importance_score else 0

    elif isinstance(raw_importance_score, (int, float)):

        importance_score = int(raw_importance_score)

    elif isinstance(raw_importance_score, str):

        score_match = re.search(r"-?\d+", raw_importance_score.strip())

        if score_match is not None:

            try:

                importance_score = int(score_match.group(0))

            except Exception:

                importance_score = 0

    importance_score = max(min(importance_score, 100), 0)



    if not is_important or importance_score < STORY_MEMORY_KEY_EVENT_MIN_IMPORTANCE_SCORE:

        return None



    raw_title = str(raw_payload.get("title") or "").replace("\r\n", " ").strip()

    raw_content = str(raw_payload.get("content") or "").replace("\r\n", "\n").strip()

    sanitized_content = _sanitize_story_key_memory_content(raw_content)

    if not sanitized_content or not _is_story_key_memory_content_valid(sanitized_content):

        return None



    normalized_title = _normalize_story_memory_block_title(raw_title, fallback="Важный момент")
    if not _should_accept_story_important_event_candidate(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        title=normalized_title,
        content=sanitized_content,
        importance_score=importance_score,
    ):
        return None

    return (normalized_title, sanitized_content)





def _resolve_story_postprocess_section_payload(

    *,

    parsed_payload: dict[str, Any],

    section_name: str,

    requested_sections: list[str],

) -> Any:

    direct_value = parsed_payload.get(section_name)

    if direct_value is not None:

        return direct_value



    is_single_requested_section = len(requested_sections) == 1 and requested_sections[0] == section_name

    top_level_keys = set(parsed_payload.keys())

    section_keys = {"location", "environment", "character_state", "important_event", "raw_memory"}



    if section_name == "character_state":

        if "cards" in top_level_keys and "character_state" not in top_level_keys:

            return parsed_payload

        return parsed_payload if is_single_requested_section and top_level_keys else None



    if section_name == "location":

        has_location_fields = any(key in top_level_keys for key in ("content", "location_sentence"))

        has_flat_location_value = "location" in top_level_keys and not isinstance(parsed_payload.get("location"), dict)

        if has_location_fields or has_flat_location_value:

            return parsed_payload

        if is_single_requested_section and "action" in top_level_keys and not (top_level_keys & (section_keys - {"location"})):

            return parsed_payload

        return None



    if section_name == "environment":

        has_environment_fields = any(

            key in top_level_keys

            for key in ("current_datetime", "datetime", "current_time", "current_weather", "tomorrow_weather")

        )

        if has_environment_fields:

            return parsed_payload

        if is_single_requested_section and "action" in top_level_keys and not (top_level_keys & (section_keys - {"environment"})):

            return parsed_payload

        return None



    if section_name == "important_event":

        has_important_event_fields = any(

            key in top_level_keys for key in ("is_important", "importance_score", "title", "content")

        )

        if has_important_event_fields:

            return parsed_payload

        return parsed_payload if is_single_requested_section and top_level_keys else None



    if section_name == "raw_memory":

        has_raw_memory_fields = any(

            key in top_level_keys

            for key in (

                "player_turn",

                "user_turn",

                "player",

                "prompt",

                "assistant_reply",

                "narrator_reply",

                "master_reply",

                "assistant",

                "reply",

            )

        )

        if has_raw_memory_fields:

            return parsed_payload

        return parsed_payload if is_single_requested_section and top_level_keys else None



    return None





def _build_story_character_state_source_cards_payload(

    *,

    db: Session,

    game: StoryGame,

    existing_cards: list[dict[str, Any]],

) -> list[dict[str, Any]]:

    normalized_existing_cards = _normalize_story_character_state_cards_payload(existing_cards)

    if not normalized_existing_cards:

        return []



    existing_by_world_card_id = {

        int(card.get("world_card_id")): card

        for card in normalized_existing_cards

        if isinstance(card.get("world_card_id"), int)

    }

    if not existing_by_world_card_id:

        return []



    source_cards: list[dict[str, Any]] = []

    for world_card in _list_story_world_cards(db, game.id):

        world_card_id = getattr(world_card, "id", None)

        if not isinstance(world_card_id, int) or world_card_id not in existing_by_world_card_id:

            continue



        existing_card = existing_by_world_card_id.get(world_card_id, {})

        kind = str(getattr(world_card, "kind", "") or existing_card.get("kind") or "").strip().lower()

        if kind not in {STORY_CHARACTER_STATE_KIND_MAIN_HERO, STORY_CHARACTER_STATE_KIND_NPC}:

            continue

        is_active_hint = bool(existing_card.get("is_active", kind == STORY_CHARACTER_STATE_KIND_MAIN_HERO))

        if kind == STORY_CHARACTER_STATE_KIND_NPC and not is_active_hint:

            continue



        source_cards.append(

            {

                "world_card_id": world_card_id,

                "name": " ".join(str(getattr(world_card, "title", "") or "").split()).strip(),

                "kind": kind,

                "is_active_hint": is_active_hint,

                "source_description": str(getattr(world_card, "content", "") or "").replace("\r\n", "\n").strip(),

                "source_race": str(getattr(world_card, "race", "") or "").strip(),

                "source_clothing": str(getattr(world_card, "clothing", "") or "").strip(),

                "source_health_status": str(getattr(world_card, "health_status", "") or "").strip(),

                "source_inventory": str(getattr(world_card, "inventory", "") or "").strip(),

            }

        )



    source_cards.sort(

        key=lambda card: (

            0 if str(card.get("kind") or "") == STORY_CHARACTER_STATE_KIND_MAIN_HERO else 1,

            0 if bool(card.get("is_active_hint")) else 1,

            str(card.get("name") or "").casefold(),

        )

    )

    return source_cards



def _extract_story_postprocess_memory_payload(

    *,

    db: Session,

    game: StoryGame,

    current_location_content: str,

    latest_user_prompt: str,

    previous_assistant_text: str,

    latest_assistant_text: str,

    raw_memory_enabled: bool,

    location_enabled: bool,

    environment_enabled: bool,

    character_state_enabled: bool,

    important_event_enabled: bool,
    ambient_enabled: bool = False,
    scene_emotion_enabled: bool = False,
    scene_emotion_active_cast_entries: list[dict[str, Any]] | None = None,
    scene_emotion_allowed_emotions: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any] | None:

    if not settings.openrouter_api_key:

        return None

    if not any(
        (
            raw_memory_enabled,
            location_enabled,
            environment_enabled,
            character_state_enabled,
            important_event_enabled,
            ambient_enabled,
            scene_emotion_enabled,
        )
    ):
        return None



    normalized_current_location = _normalize_story_location_memory_content(current_location_content)

    current_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_current_weather", "") or "")

    )

    tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_600)

    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=2_200)

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=2_800)

    if not normalized_previous_assistant and not normalized_latest_assistant and not normalized_user_prompt:

        return None

    current_datetime_facts = _format_story_environment_datetime_prompt_facts(

        _deserialize_story_environment_datetime(current_datetime)

    )

    turn_step_minutes = _normalize_story_environment_turn_step_minutes(
        getattr(game, "environment_turn_step_minutes", None)

    )

    existing_character_state_cards = (
        _story_character_state_cards_from_game(game)
        if character_state_enabled
        else []
    )
    character_state_source_cards = (
        _build_story_character_state_source_cards_payload(
            db=db,
            game=game,
            existing_cards=existing_character_state_cards,
        )
        if character_state_enabled and existing_character_state_cards
        else []
    )
    main_hero_explicit_state_evidence = (
        _build_story_main_hero_explicit_state_evidence_text(latest_user_prompt)
        if character_state_enabled and existing_character_state_cards
        else ""
    )
    main_hero_explicit_state_overlay = (
        _extract_story_main_hero_explicit_state_overlay(
            latest_user_prompt=latest_user_prompt,
            existing_cards=existing_character_state_cards,
        )
        if character_state_enabled and existing_character_state_cards
        else None
    )
    monitor_inactive_always = _normalize_story_character_state_monitor_inactive_always(
        getattr(game, "character_state_monitor_inactive_always", None)
    )
    scene_emotion_active_names = [
        " ".join(str(entry.get("display_name") or "").split()).strip()
        for entry in (scene_emotion_active_cast_entries or [])
        if isinstance(entry, dict) and " ".join(str(entry.get("display_name") or "").split()).strip()
    ][:4]
    scene_emotion_allowed_values = [
        " ".join(str(value or "").split()).strip()
        for value in (scene_emotion_allowed_emotions or [])
        if " ".join(str(value or "").split()).strip()
    ]
    main_hero_name_for_memory = _get_story_main_hero_name_for_memory(db, game_id=game.id)
    known_character_names_for_memory = _list_story_known_character_names_for_memory(
        db,
        game_id=game.id,
        player_turn_label=main_hero_name_for_memory,
    )
    memory_identity_names = _collect_story_memory_identity_names(
        player_name=main_hero_name_for_memory,
        known_character_names=known_character_names_for_memory,
    )


    requested_sections: list[str] = []

    if raw_memory_enabled:
        requested_sections.append("raw_memory")
    if location_enabled:

        requested_sections.append("location")

    if environment_enabled:

        requested_sections.append("environment")

    if character_state_enabled and existing_character_state_cards:

        requested_sections.append("character_state")

    if important_event_enabled:

        requested_sections.append("important_event")

    if ambient_enabled:

        requested_sections.append("ambient")

    if scene_emotion_enabled:

        requested_sections.append("scene_emotion")

    ambient_system_parts = (
        [
            "For ambient: extract a UI ambient palette from the described environment only.",
            "ambient must contain scene, lighting, primary_color, secondary_color, highlight_color, glow_strength, background_mix, and vignette_strength.",
            "Ignore character appearance, clothing, skin, and eye colors.",
            "Focus only on environment lighting, sky, weather, terrain, interior mood, and scene effects.",
            "All colors must be #RRGGBB and all numeric strengths must stay in range 0..1.",
        ]
        if ambient_enabled
        else []
    )
    scene_emotion_system_parts = (
        [
            "For scene_emotion: decide whether the scene should show visual-novel emotion sprites.",
            "scene_emotion must contain show_visualization, reason, and participants.",
            "Use show_visualization=true only for direct interaction, dialogue, coordinated movement between named characters, or a meaningful encounter or threat affecting a named character.",
            "Use show_visualization=false for pure scenery, solo travel, routine narration, or scenes without a meaningful interaction hook.",
            (
                "Use only these exact participant names in scene_emotion.participants: "
                + ", ".join(repr(name) for name in scene_emotion_active_names)
                + "."
                if scene_emotion_active_names
                else "If no active cast list is provided, keep scene_emotion.participants empty."
            ),
            (
                "Use only these exact emotion ids in scene_emotion.participants.emotion: "
                + ", ".join(repr(value) for value in scene_emotion_allowed_values)
                + "."
                if scene_emotion_allowed_values
                else ""
            ),
            "If the main hero is active and show_visualization=true, include the main hero first when clearly involved.",
        ]
        if scene_emotion_enabled
        else []
    )


    system_parts = [

        "Analyze exactly one RPG turn for continuity and memory.",

        "Use the newest narrator reply and the previous narrator reply as the primary evidence.",

        "Use the latest player turn to interpret transitions, explicit time skips, or commitments, and also as authoritative evidence for explicit self-described main-hero continuity facts such as symptoms, illness, pain, injuries, exhaustion, clothing changes, and carried equipment unless the newest narrator reply clearly contradicts them.",

        "Never invent unsupported scene facts.",

        "Return strict JSON only without markdown.",

        f"Enabled sections: {', '.join(requested_sections)}.",

        "Omit any disabled sections from the JSON.",
        "CRITICAL NAME CONTINUITY RULE: if the player turn or narrator reply explicitly names a character, hero, NPC, speaker, creature, or other named entity, keep that exact name in every enabled memory section where it appears.",
        "Never replace an explicit name with a pronoun or a generic role like player, hero, he, she, they, man, woman, girl, guy, stranger, companion, NPC, or someone.",
        "If the main hero has an explicit name, use that exact name instead of player, hero, or you whenever the reference is unambiguous.",
        "If multiple named characters are involved in one event, do not compress them into a faceless group and do not omit who exactly acted, spoke, suffered, promised, decided, or received something.",
        *(
            [
                "Known continuity names that must stay exact when present in the source: "
                + ", ".join(repr(name) for name in memory_identity_names)
                + "."
            ]
            if memory_identity_names
            else []
        ),
        *ambient_system_parts,
        *scene_emotion_system_parts,
    ]

    if raw_memory_enabled:

        system_parts.extend(

            [

                "For raw_memory: produce a short factual storage summary of this turn.",

                "raw_memory.player_turn must describe only the player's latest move in 1 to 2 short Russian sentences.",

                "raw_memory.assistant_reply must describe only the newest narrator reply in 1 to 3 short Russian sentences.",
                "raw_memory.player_turn and raw_memory.assistant_reply must keep exact names for all explicitly named participants, speakers, addressees, and targets of actions.",
                "If the main hero has an explicit name, raw_memory.player_turn must use that exact name instead of player, hero, or you whenever the source clearly refers to the main hero.",
                "Do not replace multiple named characters with they or companions when the source makes it clear who exactly did or said something.",

                "Preserve exact named entities and concrete nouns from the source whenever they are explicit: names, diseases, demons, people, monsters, food, items, locations, titles, curses, medicines, and symptoms.",

                "Do not replace one concrete entity with another similar one.",

                "If the source says картошка, do not write каша. If it says демоны, do not write люди. If it says терница, do not turn it into a person.",

                "If a pronoun is not resolved unambiguously in the source, do not invent a new subject like женщина or мужчина just for clarity.",

            ]

        )

    if location_enabled:

        system_parts.extend(

            [

                "For location: determine the current active location of the scene.",

                "Prefer the most specific currently active location that also keeps the wider explicit context.",
                "Prefer the closest physical anchor of the current scene when it is explicit: doorway, entrance, threshold, counter, table, corridor, room, hall, yard, alley, stair, gate, platform, carriage, bank, shore, campfire, or similar immediate sublocation.",
                "When the active action is clearly inside a named establishment or room, keep that exact interior place instead of downgrading it to the street, district, or city outside.",
                "If the narrator shows the hero behind a tavern counter, at an inn table, inside a shop, room, hall, chamber, cabin, or shrine, the location is that interior scene, not the road outside.",
                "Do not widen a precise scene into a broader area. If the text gives 'Сѓ РІС…РѕРґР° РІ Р·РґР°РЅРёРµ РіРёР»СЊРґРёРё Р°РІР°РЅС‚СЋСЂРёСЃС‚РѕРІ', do not reduce it to 'РЅР° СѓР»РёС†Р°С… РіРѕСЂРѕРґР°', 'Сѓ РіРёР»СЊРґРёРё', or another broader outdoor label.",
                "Preserve named establishments and rooms such as 'таверна Ржавый якорь' whenever the current scene is still happening there.",
                "Never add a city, capital, district, country, kingdom, or world name just to make the place sound fuller. If that broader geography is not explicitly present in the recent scene text, omit it.",
                "Use the latest player turn as supporting evidence, and allow it to establish or refine the place when it explicitly states where the hero enters, goes, stands, remains, or moves and the newest narrator reply continues that same scene without contradiction.",

                "If the newest narrator reply does not clearly confirm a new place, keep the saved place when it is still valid. If there is no valid saved place yet, you may use the latest explicit player-stated place only when the newest narrator reply continues that same scene without contradiction.",
                "Never return location.action=keep when there is no valid saved place and the newest player turn or narrator reply explicitly names the active current place.",
                "Remove time-of-day wording from the location itself. Keep the place, but drop suffixes like 'РЅРѕС‡СЊСЋ', 'РІРµС‡РµСЂРѕРј', 'СѓС‚СЂРѕРј', 'РІ 16:00', or similar time markers.",
                "If you do update, location.content must be exactly one short Russian sentence starting with "

                "\"Действие происходит\" or \"События происходят\".",

            ]

        )

    if environment_enabled:

        system_parts.extend(

            [

                "For environment: manage only the current in-world date/time and weather state.",

                "Grok alone manages in-world time progression for environment continuity.",
                f"Minimal fallback step is {turn_step_minutes} minutes if the scene clearly continues but the exact elapsed time stays ambiguous.",
                "For short dialogue turns, a glance, a few phrases, or one quick action, advance only a few minutes rather than 30-60 minutes.",
                "Do not jump forward by half an hour or more unless the text clearly contains travel, waiting, treatment, work, search, sleep, or another extended process.",
                "Respect explicit time skips such as 'спустя 2 месяца', 'через полтора часа', travel, sleep, waiting, or scene skips.",
                "Treat the latest player turn as authoritative for clear current-time context such as lunch time, dinner time, after lessons, after work, dawn, late evening, or similar cues even when no HH:MM is written.",
                "If the newest turn clearly implies lunch, after-school daytime, dinner, or another broad time-of-day, move current_datetime into a believable range for that cue instead of lazily preserving an old morning or night clock.",

                "Treat precise HH:MM in the saved state as authoritative.",

                "If the new turn uses only a coarse in-character reference like 'два ночи', 'около трех', or 'под утро', do not snap the clock to a rounded hour or erase saved minutes.",

                "Always return environment.current_datetime, environment.current_weather, and environment.tomorrow_weather when environment is enabled.",

                "Do not change tomorrow's forecast unless the in-world date advances or the text explicitly establishes a multi-day skip.",

                "If weather is not mentioned, keep it coherent and stable.",
                "Do not lazily preserve or repeat a generic placeholder like 'переменная облачность' across the whole day unless the scene evidence truly supports that exact result.",
                "If the saved weather is generic but the location, season, date, time, or scene details allow a more grounded forecast, replace it with a more specific believable weather state.",
                "Do not invent dramatic weather changes without evidence.",

                "Temperatures must stay seasonally believable for the date and location unless the text clearly supports an anomaly, mountains, far north, magical cold, desert heat, or similar extremes.",

                "Without explicit cold-climate evidence, summer weather should not drift into near-freezing values just because the weather field was vague.",

                "For current_weather.timeline, return exactly four broad periods for today in this order: 00:00-06:00, 06:00-12:00, 12:00-18:00, 18:00-00:00.",
                "Do not omit the night block. Do not duplicate sub-periods like late morning or late afternoon.",
                "The active current_weather summary/details must match the period containing the current time.",
                "If the current time is between 00:00 and 05:59, current_weather must describe the night block rather than a daytime placeholder.",
            ]

        )

    if character_state_enabled and existing_character_state_cards:

        system_parts.extend(

            [

                "For character_state: update only the provided tracked state cards and return the full cards array again.",

                "Each card must preserve identity by world_card_id and kind.",

                "For NPC cards, is_active must stay true only when that NPC is physically present in the current active scene or directly encountered in the newest narrator reply; otherwise set is_active=false.",

                "Keep NPC reactions realistic, independent, and causally consistent with personality, distance, and prior relationship.",

                "Do not teleport characters, instantly forgive without cause, or bend off-screen continuity to help the hero.",

                (

                    "Monitor inactive NPCs continuously."

                    if monitor_inactive_always

                    else "For inactive NPCs, keep off-screen cards unchanged unless the newest turn clearly mentions or encounters them."

                ),

                (

                    "When environment is enabled, use the saved date, weekday, season, time of day, and weather as continuity anchors for off-screen NPC routines and occasional location changes."

                    if environment_enabled

                    else "When environment is disabled but off-screen monitoring is enabled, allow only a small occasional chance that one monitored NPC changes location to a very plausible routine place."

                ),

                (

                    "At most one inactive NPC may occasionally change off-screen location when the saved time, routine, work schedule, meals, sleep, travel, inspections, errands, or day-off logic clearly support it. Do not manufacture such movement every turn."

                    if environment_enabled

                    else "Such unsignaled off-screen movement should stay infrequent, modest, and believable: shop to home, tavern to street, palace hall to private chambers, lunch break, short ride, brief errand."

                ),

                "Workers, shopkeepers, guards, nobles, and rulers should not remain frozen forever in one room: let them logically move between work, meals, home, rest, private chambers, travel, inspections, errands, or day-off routines as time advances.",

                (

                    "When the saved time is late night or pre-dawn, ordinary inactive NPCs should usually no longer remain in public daytime work spaces such as a shop counter, market stall, public workshop room, or audience hall unless the texts clearly establish night duty, an emergency, living on site, or sleeping there."

                    if environment_enabled

                    else "If there is no explicit time context, do not overuse off-screen relocation."

                ),

                "If an NPC is in another city or place, keep that location unless the texts or a believable off-screen routine clearly establish movement there.",

                "location must stay the last known concrete place for that character, not a guessy placeholder.",

                "If the newest texts do not clearly move a character elsewhere, keep the saved concrete location unchanged.",

                "Never replace a known location with vague filler such as 'неизвестно', 'не указано', 'unknown', or an empty value.",

                "status must describe only bodily or health condition: wounds, illness, poison, exhaustion, intoxication, or normal physical state.",
                "For the main hero card, explicit player-stated bodily facts are valid evidence: symptoms, illness names, poison, curses, injuries, exhaustion, medication, trembling, fever, nausea, pain, weakness, clothing changes, and carried equipment.",
                "If a separate distilled block of explicit main-hero self-description from the latest player turn is provided, treat it as high-priority evidence and preserve its named conditions and symptoms literally unless the newest narrator reply clearly resolves or contradicts them.",
                "For the main hero card, do not introduce a new non-normal status from subtext, atmosphere, genre expectation, or loose implication alone; require explicit player evidence or an unmistakable direct scene consequence in the newest texts.",
                "If the player or narrator explicitly names a disease, poison, curse, wound, or other abnormal condition, keep that exact named condition in status instead of flattening it to 'нормальное' or other generic healthy wording.",
                "Do not downgrade an established non-normal health state to normal unless the newest texts clearly show recovery, cure, treatment success, or that the earlier condition was mistaken.",

                "Never put action, pose, mood, scene role, or location into status. If an existing status contains that, rewrite it into proper health/body state.",

                "For the main hero and any NPC whose is_active=true in this turn, status must never be empty.",

                "clothing must describe what is worn on specific body areas: head, upper body, outer layer, lower body, feet, hands, and visible accessories when relevant.",

                "For the main hero and any NPC whose is_active=true in this turn, clothing must never be empty.",

                "If either status or clothing is currently missing, infer and fill it from these sources in order: latest player turn, newest narrator reply, and that character's own source description.",

                "If a source_cards block is provided in the user content, match it strictly by world_card_id and use only that exact character's own source card as the character-description evidence.",

                "You may use the saved current scene location, date/time, and weather only as supporting continuity context for a plausible concrete result; they do not override the target character's own description or the newest turn text.",

                "If the direct scene text is sparse, still return one conservative concrete status and one conservative concrete clothing description for the main hero and any NPC you mark active=true, derived from the combined evidence instead of leaving the field empty.",

                "Use other characters' descriptions only as scene background, never as the source of the target character's clothing or health facts.",

                "Do not use generic phrases like 'обычная одежда', 'одежда авантюристки', or 'легкая одежда' without concrete breakdown.",

                "Track small but persistent clothing details when they matter to continuity: one boot removed, torn sleeve, loosened belt, wet hem, broken clasp, blood stains, dirt, missing glove, hood up or down.",

                "Be detailed but practical, without turning into obsessive inventory.",

                "equipment must be concrete and definite. Never write alternatives or uncertainty such as 'или', '/', 'возможно', or 'скорее всего'.",

                "If details are unclear, choose one conservative concrete version instead of listing options.",

                "Do not erase a specific saved status, clothing state, equipment detail, or personality trait into a vaguer generic value unless the newest texts clearly justify that loss of detail or change.",
                "For mood and attitude_to_hero, start from the saved values in the current cards as the active state at the beginning of this turn when character_state is enabled.",
                "If a current card contains status_manual_override_turns, clothing_manual_override_turns, equipment_manual_override_turns, mood_manual_override_turns, or attitude_to_hero_manual_override_turns above 0, treat the corresponding saved field as player-fixed start-of-turn continuity for this turn.",
                "Do not overwrite a player-fixed field on weak, ambiguous, or purely tonal evidence.",
                "A player-fixed field may still change, but only if the newest player and storyteller texts make that transition explicit and clearly legible inside the scene itself.",
                "Change saved mood or saved attitude_to_hero only when the newest player and storyteller texts clearly establish a meaningful shift, trigger, escalation, or de-escalation in this scene.",
                "mood must reflect the character's current emotional state in this exact scene.",
                "mood must stay short, practical, and scene-grounded.",
                "attitude_to_hero is not mood: it must be one short practical relationship label toward the hero, not a descriptive sentence or poetic formulation.",
                "Do not treat saved mood or saved attitude_to_hero as disposable just because the newest storyteller reply sounds emotionally colored.",
                "Mirror the dominant relationship mode only when the newest turn clearly establishes it through dialogue, tone, body language, initiative, distance, protectiveness, tenderness, impatience, irritation, fear, resentment, attraction, trust, dependence, hostility, or other strong subtext.",
                "On early, ambiguous, or mixed evidence, preserve the saved baseline instead of silently escalating or flipping it.",
                f"Use only one short Russian label for attitude_to_hero from this fixed list: {', '.join(repr(label) for label in STORY_CHARACTER_STATE_ATTITUDE_TO_HERO_LABELS)}.",
                "Use 'нейтральное' only when the storyteller reply leaves the interaction truly impersonal, ordinary, professional, transactional, or too underdetermined for a stronger conclusion.",
                "Prefer the single dominant relationship label for this moment instead of mixed formulas like 'забота с оттенком собственничества' or other multi-part shades.",
                "If protectiveness, tenderness, jealousy, possessiveness, flirting, or obvious attraction clearly dominate beyond ordinary care, prefer 'романтическое' over abstract euphemisms.",
                "attitude_to_hero describes the noun 'отношение', so it must stay in short grammatically neuter Russian form.",

                "Return short practical Russian fields for status, clothing, location, equipment, mood, attitude_to_hero, and personality.",

                "Main hero must remain active.",

            ]

        )

    if important_event_enabled:

        system_parts.extend(

            [

                "For important_event: decide whether this turn created a meaningful long-term plot event.",

                "Mark only major irreversible outcomes, decisive commitments, new long-term obligations/goals, key revelations, critical alliance/trust shifts, high-impact gains/losses, or new constraints that will matter in future turns.",

                "Routine actions, atmosphere, ordinary dialogue, small emotions, or cosmetic details are not important events.",
                "A vivid sentence, silence, hesitation, or a short emotional beat without a new long-term consequence is not an important event.",
                "Self-description, mood, loneliness, a tired look, skipping lunch, or one ordinary social remark are not important events unless they create a new lasting consequence.",
                "If nothing clearly changed long-term, return is_important=false with empty title/content.",

                "important_event.content must be 1-2 short factual Russian sentences in past tense.",

            ]

        )



    messages_payload = [

        {

            "role": "system",

            "content": " ".join(part.strip() for part in system_parts if part.strip())

            + " JSON shape: "

            + "{\"raw_memory\":{\"player_turn\":\"...\",\"assistant_reply\":\"...\"},"

            + "\"location\":{\"action\":\"keep\"}|{\"action\":\"update\",\"content\":\"Действие происходит ...\"},"

            + "\"environment\":{\"action\":\"keep\"}|{\"action\":\"update\",\"current_datetime\":\"YYYY-MM-DDTHH:MM\","

            + "\"current_weather\":{\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\",\"timeline\":[{\"start_time\":\"06:00\",\"end_time\":\"10:00\",\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"}]},"

            + "\"tomorrow_weather\":{\"summary\":\"...\",\"temperature_c\":10,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\"}},"

            + "\"character_state\":{\"cards\":[{\"world_card_id\":123,\"name\":\"...\",\"kind\":\"main_hero\"|\"npc\",\"is_active\":true,\"status\":\"...\",\"clothing\":\"...\",\"location\":\"...\",\"equipment\":\"...\",\"mood\":\"...\",\"attitude_to_hero\":\"...\",\"personality\":\"...\"}]},"

            + "\"important_event\":{\"is_important\":true,\"importance_score\":88,\"title\":\"...\",\"content\":\"...\"},"

            + "\"ambient\":{\"scene\":\"...\",\"lighting\":\"...\",\"primary_color\":\"#112233\",\"secondary_color\":\"#223344\",\"highlight_color\":\"#445566\",\"glow_strength\":0.2,\"background_mix\":0.2,\"vignette_strength\":0.4},"

            + "\"scene_emotion\":{\"show_visualization\":true,\"reason\":\"interaction\",\"participants\":[{\"name\":\"...\",\"emotion\":\"calm\",\"importance\":\"primary\"}]}}.",
        },

        {

            "role": "user",

            "content": (

                (

                    f"Текущее сохраненное место:\n{normalized_current_location or 'нет'}\n\n"

                    if (location_enabled or character_state_enabled)

                    else ""

                )

                + (

                    f"Сохраненные дата и время:\n{current_datetime_facts or current_datetime or 'нет'}\n\n"

                    f"Текущая погода:\n{json.dumps(current_weather, ensure_ascii=False) if isinstance(current_weather, dict) else 'нет'}\n\n"

                    f"Прогноз на завтра:\n{json.dumps(tomorrow_weather, ensure_ascii=False) if isinstance(tomorrow_weather, dict) else 'нет'}\n\n"

                    if environment_enabled

                    else ""

                )

                + (
                    f"Текущие карточки состояния персонажей:\n{json.dumps(existing_character_state_cards, ensure_ascii=False) if existing_character_state_cards else 'нет'}\n\n"
                    if character_state_enabled and existing_character_state_cards
                    else ""
                )
                + (
                    f"РљР°СЂС‚РѕС‡РєРё-РёСЃС‚РѕС‡РЅРёРєРё РїРµСЂСЃРѕРЅР°Р¶РµР№ (РѕРїРёСЃР°РЅРёРµ Рё СЏРІРЅС‹Рµ РїРѕР»СЏ):\n{json.dumps(character_state_source_cards, ensure_ascii=False) if character_state_source_cards else 'РЅРµС‚'}\n\n"
                    if character_state_enabled and character_state_source_cards
                    else ""
                )
                + (
                    f"Явные самоописания ГГ из хода игрока:\n{main_hero_explicit_state_evidence}\n\n"
                    if character_state_enabled and main_hero_explicit_state_evidence
                    else ""
                )
                + (
                    f"Known names that must stay exact in memory if mentioned:\n{json.dumps(memory_identity_names, ensure_ascii=False)}\n\n"
                    if memory_identity_names
                    else ""
                )
                + f"Последний ход игрока:\n{normalized_user_prompt or 'нет'}\n\n"
                + f"Предыдущий ответ мастера:\n{normalized_previous_assistant or 'нет'}\n\n"
                + f"Новый ответ мастера:\n{normalized_latest_assistant or 'нет'}"
            ),
        },
    ]



    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name="x-ai/grok-4.1-fast",
                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.0,

                max_tokens=STORY_MEMORY_POSTPROCESS_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(
                "Story unified post-process request failed: %s",
                exc,
            )
            return None



        parsed_payload = _extract_json_object_from_text(raw_response.replace("\r\n", "\n").strip())

        if not isinstance(parsed_payload, dict) or not parsed_payload:
            return None



        normalized_payload: dict[str, Any] = {}

        raw_location_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="location",

            requested_sections=requested_sections,

        )

        raw_environment_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="environment",

            requested_sections=requested_sections,

        )

        raw_raw_memory_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="raw_memory",

            requested_sections=requested_sections,

        )

        raw_character_state_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="character_state",

            requested_sections=requested_sections,

        )

        raw_important_event_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="important_event",

            requested_sections=requested_sections,

        )

        raw_ambient_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="ambient",

            requested_sections=requested_sections,

        )
        raw_scene_emotion_payload = _resolve_story_postprocess_section_payload(

            parsed_payload=parsed_payload,

            section_name="scene_emotion",

            requested_sections=requested_sections,

        )

        if raw_memory_enabled:
            raw_memory_payload = _normalize_story_raw_memory_summary_payload(raw_raw_memory_payload)

            if raw_memory_payload is not None:

                normalized_payload["raw_memory"] = raw_memory_payload

        if location_enabled:

            location_payload = _normalize_story_location_analysis_payload(raw_location_payload)

            if location_payload is not None:

                normalized_payload["location"] = location_payload

        if environment_enabled:

            environment_payload = _normalize_story_environment_analysis_payload(

                raw_environment_payload,

                current_datetime=current_datetime,

                current_weather=current_weather if isinstance(current_weather, dict) else None,

                tomorrow_weather=tomorrow_weather if isinstance(tomorrow_weather, dict) else None,

            )

            if environment_payload is not None:

                normalized_payload["environment"] = environment_payload

        if character_state_enabled and existing_character_state_cards:
            character_state_payload = _normalize_story_character_state_update_payload(
                raw_character_state_payload,
                existing_cards=existing_character_state_cards,
                current_location_content=current_location_content,
            )
            character_state_payload = _apply_story_main_hero_explicit_state_overlay(
                existing_cards=existing_character_state_cards,
                base_payload=character_state_payload,
                overlay=main_hero_explicit_state_overlay,
            )
            if character_state_payload is not None:
                normalized_payload["character_state"] = character_state_payload
        if important_event_enabled:

            important_payload = _normalize_story_important_event_analysis_payload(

                raw_important_event_payload,
                latest_user_prompt=normalized_user_prompt,
                latest_assistant_text=normalized_latest_assistant,

            )

            if important_payload is not None:

                normalized_payload["important_event"] = important_payload

        if ambient_enabled and isinstance(raw_ambient_payload, dict):

            normalized_payload["ambient"] = dict(raw_ambient_payload)
        if scene_emotion_enabled and isinstance(raw_scene_emotion_payload, dict):

            normalized_payload["scene_emotion"] = dict(raw_scene_emotion_payload)

        return normalized_payload


    return None





def _extract_story_environment_state_payload(

    *,

    game: StoryGame,

    current_location_content: str,

    latest_user_prompt: str,

    previous_assistant_text: str,

    latest_assistant_text: str,

) -> dict[str, Any] | None:

    if not settings.openrouter_api_key:

        return None



    normalized_current_location = _normalize_story_location_memory_content(current_location_content)

    current_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_current_weather", "") or "")

    )

    tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=1_600)

    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=2_200)

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=2_800)

    if not normalized_previous_assistant and not normalized_latest_assistant and not normalized_user_prompt:

        return None



    turn_step_minutes = _normalize_story_environment_turn_step_minutes(

        getattr(game, "environment_turn_step_minutes", None)

    )



    messages_payload = [

        {

            "role": "system",

            "content": (

                "Update persistent RPG environment continuity. "

                "You manage only the current in-world date/time and weather state. "

                "Use the newest narrator reply and the previous narrator reply as the primary evidence. "

                "Use the latest player turn to interpret transitions, explicit time skips, and clear current-time context such as lunch time, dinner time, after lessons, after work, dawn, late evening, or similar cues even when no HH:MM is given. "
                "If the newest turn clearly implies lunch, after-school daytime, dinner, or another broad time-of-day, move current_datetime into a believable range for that cue instead of lazily preserving an old morning or night clock. "

                "Never invent scene facts that are unsupported by the provided text. "

                "Never move time backward unless the text explicitly establishes a flashback, rewind, dream, or past-tense retelling now becoming active. "

                "Keep weather coherent with the saved location, season, time of day, and recent scene description when you do return weather fields. "

                "Do not create sudden dramatic weather changes without explicit support. "

                "If weather is not mentioned, keep it stable. "

                "Temperatures must remain seasonally believable for the date and location unless the text clearly supports extreme cold, mountains, far north, magical anomalies, desert heat, or similar reasons. "

                "Treat precise HH:MM in the saved state as authoritative. "

                "If the turn only contains coarse speech like 'два ночи', 'около трех', or 'под утро', do not snap the clock to a rounded hour or discard saved minutes. "

                "Do not change tomorrow's forecast unless the in-world date has advanced to a new day or the text explicitly establishes a multi-day skip. "

                "Grok alone manages in-world time progression for environment continuity. "
                f"Minimal fallback step is {turn_step_minutes} minutes if the scene clearly continues but the exact elapsed time stays ambiguous. "
                "For short dialogue turns, a glance, a few phrases, or one quick action, advance only a few minutes rather than 30-60 minutes. "
                "Do not jump forward by half an hour or more unless the text clearly contains travel, waiting, treatment, work, search, sleep, or another extended process. "
                "Return keep only when the scene truly stays in the same moment with no meaningful time passage, or when a rewind/flashback makes an update unsafe. "
                "Return strict JSON only without markdown. "
                "Valid outputs are exactly "

                "{\"action\":\"keep\"} "

                "or "

                "{\"action\":\"update\",\"current_datetime\":\"YYYY-MM-DDTHH:MM\",\"current_weather\":{\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"},\"tomorrow_weather\":{\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"}}. "

                "You may omit current_weather and tomorrow_weather when only time changes are needed. "

                "If you cannot confidently determine a better state than the saved one, return keep."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Текущее место:\n{normalized_current_location or 'нет'}\n\n"

                f"Сохраненные дата и время:\n{_format_story_environment_datetime_prompt_facts(_deserialize_story_environment_datetime(current_datetime)) or current_datetime or 'нет'}\n\n"
                f"Текущая погода:\n{json.dumps(current_weather, ensure_ascii=False) if isinstance(current_weather, dict) else 'нет'}\n\n"

                f"Прогноз на завтра:\n{json.dumps(tomorrow_weather, ensure_ascii=False) if isinstance(tomorrow_weather, dict) else 'нет'}\n\n"

                f"Последний ход игрока:\n{normalized_user_prompt or 'нет'}\n\n"

                f"Предыдущий ответ мастера:\n{normalized_previous_assistant or 'нет'}\n\n"

                f"Новый ответ мастера:\n{normalized_latest_assistant or 'нет'}"

            ),

        },

    ]

    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=STORY_ENVIRONMENT_ANALYSIS_MODEL,

                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.0,

                max_tokens=STORY_ENVIRONMENT_ANALYSIS_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story environment analysis failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.25)

                continue

            return None



        normalized_response = raw_response.replace("\r\n", "\n").strip()

        if not normalized_response:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None

        if normalized_response.upper() == "KEEP":

            return {"action": "keep"}



        parsed_payload = _extract_json_object_from_text(normalized_response)

        if not isinstance(parsed_payload, dict) or not parsed_payload:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None



        raw_action = str(parsed_payload.get("action") or "").strip().lower()

        if raw_action in {"keep", "leave", "preserve", "unchanged", "same"}:

            return {"action": "keep"}



        raw_current_datetime = (

            parsed_payload.get("current_datetime")

            or parsed_payload.get("datetime")

            or parsed_payload.get("current_time")

            or ""

        )

        normalized_datetime = _normalize_story_environment_datetime(

            str(raw_current_datetime or current_datetime or "")

        )

        normalized_current_weather = _normalize_story_environment_weather_payload(

            parsed_payload.get("current_weather")

        )

        if normalized_current_weather is None and isinstance(current_weather, dict):

            normalized_current_weather = current_weather

        normalized_tomorrow_weather = _normalize_story_environment_weather_payload(

            parsed_payload.get("tomorrow_weather")

        )

        if normalized_tomorrow_weather is None and isinstance(tomorrow_weather, dict):

            normalized_tomorrow_weather = tomorrow_weather

        return {

            "action": "update",

            "current_datetime": normalized_datetime,

            "current_weather": normalized_current_weather,

            "tomorrow_weather": normalized_tomorrow_weather,

        }



    return None





def _sync_story_environment_state_for_assistant_message(

    *,

    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage,

    latest_user_prompt: str | None = None,

    latest_assistant_text: str | None = None,

    previous_assistant_text: str | None = None,

    current_location_content_override: str | None = None,

    resolved_payload_override: dict[str, Any] | None = None,

    allow_weather_seed: bool = True,

    allow_model_request: bool = True,

) -> bool:

    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:

        return False

    if not _normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):

        return False



    resolved_latest_user_prompt = (

        latest_user_prompt.replace("\r\n", "\n").strip()

        if isinstance(latest_user_prompt, str)

        else _get_story_user_prompt_before_assistant_message(

            db,

            game_id=game.id,

            assistant_message_id=assistant_message.id,

        )

    )

    resolved_latest_assistant_text = (

        latest_assistant_text.replace("\r\n", "\n").strip()

        if isinstance(latest_assistant_text, str)

        else _normalize_story_assistant_text_for_memory(assistant_message.content)

    )

    if not resolved_latest_assistant_text:

        resolved_latest_assistant_text = assistant_message.content.replace("\r\n", "\n").strip()

    if not resolved_latest_assistant_text:

        return False



    resolved_previous_assistant_text = (

        previous_assistant_text.replace("\r\n", "\n").strip()

        if isinstance(previous_assistant_text, str)

        else _get_story_previous_assistant_text_before_message(

            db,

            game_id=game.id,

            assistant_message_id=assistant_message.id,

        )

    )

    current_location_content = (

        current_location_content_override.replace("\r\n", "\n").strip()

        if isinstance(current_location_content_override, str)

        else _get_story_latest_location_memory_content(

            db=db,

            game_id=game.id,

        )

    )

    if isinstance(resolved_payload_override, dict):
        resolved_payload = resolved_payload_override
    elif allow_model_request:
        resolved_payload = _extract_story_environment_state_payload(
            game=game,
            current_location_content=current_location_content,
            latest_user_prompt=resolved_latest_user_prompt,
            previous_assistant_text=resolved_previous_assistant_text,
            latest_assistant_text=resolved_latest_assistant_text,
        )
    else:
        resolved_payload = None

    payload_action = str((resolved_payload or {}).get("action") or "").strip().lower()
    keep_environment_state = resolved_payload is None or payload_action == "keep"


    saved_current_datetime = _deserialize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    next_datetime = _normalize_story_environment_datetime(
        str((resolved_payload or {}).get("current_datetime") or getattr(game, "environment_current_datetime", "") or "")
    )
    resolved_current_datetime = _deserialize_story_environment_datetime(next_datetime)
    if resolved_current_datetime is None and isinstance(saved_current_datetime, datetime):
        resolved_current_datetime = saved_current_datetime
    if not keep_environment_state:
        resolved_current_datetime = _reconcile_story_environment_datetime_with_coarse_time_mentions(
            game=game,
            saved_datetime=saved_current_datetime,
            candidate_datetime=resolved_current_datetime,
            latest_user_prompt=resolved_latest_user_prompt,
            latest_assistant_text=resolved_latest_assistant_text,
        )
    resolved_current_datetime, contextual_time_anchor_applied = _reconcile_story_environment_datetime_with_contextual_time_anchors(
        saved_datetime=saved_current_datetime,
        candidate_datetime=resolved_current_datetime,
        latest_user_prompt=resolved_latest_user_prompt,
        latest_assistant_text=resolved_latest_assistant_text,
    )
    source_text_for_time_progress = "\n".join(
        part.strip()
        for part in (resolved_latest_user_prompt, resolved_latest_assistant_text)
        if isinstance(part, str) and part.strip()
    )
    estimated_elapsed_minutes = _estimate_story_environment_elapsed_minutes(source_text_for_time_progress)
    if _story_environment_has_brief_scene_signal(source_text_for_time_progress) and estimated_elapsed_minutes is not None:
        estimated_elapsed_minutes = min(estimated_elapsed_minutes, 4)
    should_force_time_progress = (
        isinstance(saved_current_datetime, datetime)
        and bool(source_text_for_time_progress)
        and not contextual_time_anchor_applied
        and (
            resolved_current_datetime is None
            or resolved_current_datetime <= saved_current_datetime
            or (payload_action == "keep" and resolved_current_datetime == saved_current_datetime)
        )
    )
    if should_force_time_progress:
        fallback_step_minutes = estimated_elapsed_minutes
        if fallback_step_minutes is None and not _story_environment_has_precise_clock_reference(source_text_for_time_progress):
            fallback_step_minutes = max(
                1,
                _normalize_story_environment_turn_step_minutes(getattr(game, "environment_turn_step_minutes", None)),
            )
        if isinstance(fallback_step_minutes, int) and fallback_step_minutes > 0:
            resolved_current_datetime = (saved_current_datetime + timedelta(minutes=fallback_step_minutes)).replace(
                second=0,
                microsecond=0,
                tzinfo=None,
            )
    next_datetime = _serialize_story_environment_datetime(resolved_current_datetime)

    changed = False
    if str(getattr(game, "environment_current_datetime", "") or "") != next_datetime:
        game.environment_current_datetime = next_datetime
        changed = True

    try:
        resolved_current_weather, resolved_tomorrow_weather = _resolve_story_environment_weather_state(
            game=game,
            current_datetime=resolved_current_datetime,
            current_location_content=current_location_content,
            latest_user_prompt=resolved_latest_user_prompt,
            previous_assistant_text=resolved_previous_assistant_text,
            latest_assistant_text=resolved_latest_assistant_text,
            extracted_current_weather=_normalize_story_environment_weather_payload(
                (resolved_payload or {}).get("current_weather")
            ),
            extracted_tomorrow_weather=_normalize_story_environment_weather_payload(
                (resolved_payload or {}).get("tomorrow_weather")
            ),
            allow_weather_seed=allow_weather_seed,
        )
    except Exception as exc:
        logger.warning(
            "Story environment weather resolution failed: game_id=%s assistant_message_id=%s error=%s",
            game.id,
            assistant_message.id,
            exc,
        )
        resolved_current_weather = _deserialize_story_environment_weather(
            str(getattr(game, "environment_current_weather", "") or "")
        )
        resolved_tomorrow_weather = _deserialize_story_environment_weather(
            str(getattr(game, "environment_tomorrow_weather", "") or "")
        )

    next_current_weather = _serialize_story_environment_weather(resolved_current_weather)
    next_tomorrow_weather = _serialize_story_environment_weather(resolved_tomorrow_weather)

    if str(getattr(game, "environment_current_weather", "") or "") != next_current_weather:
        game.environment_current_weather = next_current_weather
        changed = True
    if str(getattr(game, "environment_tomorrow_weather", "") or "") != next_tomorrow_weather:

        game.environment_tomorrow_weather = next_tomorrow_weather

        changed = True



    weather_memory_changed = _upsert_story_weather_memory_block(

        db=db,

        game=game,

        assistant_message=assistant_message,

    )

    if changed or weather_memory_changed:

        logger.info(

            "Story environment updated: game_id=%s assistant_message_id=%s datetime=%s current_weather=%s tomorrow_weather=%s",

            game.id,

            assistant_message.id,

            str(getattr(game, "environment_current_datetime", "") or ""),

            str(getattr(game, "environment_current_weather", "") or ""),

            str(getattr(game, "environment_tomorrow_weather", "") or ""),

        )

    return changed or weather_memory_changed





def _sync_story_manual_environment_memory_blocks(

    *,

    db: Session,

    game: StoryGame,

) -> bool:

    return _upsert_story_weather_memory_block(

        db=db,

        game=game,

        assistant_message=None,

    )


def _build_story_raw_memory_block_content(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    player_turn_label: str | None = None,
    known_character_names: list[str] | None = None,
    preserve_user_text: bool = False,
    preserve_assistant_text: bool = False,
) -> str:
    def _build_detailed_turn_summary(text_value: str, *, preserve_full_text: bool) -> tuple[str, str]:
        normalized_value = str(text_value or "").replace("\r\n", "\n").strip()
        if not normalized_value:
            return ("", "")
        if preserve_full_text:
            return ("полный текст", normalized_value)
        summarized_value = _build_story_memory_summary_without_truncation(
            normalized_value,
            super_mode=False,
            player_name=normalized_player_turn_label,
            known_character_names=known_character_names,
        ).strip()
        if not summarized_value:
            summarized_value = normalized_value
        return ("подробный пересказ", summarized_value)

    def _normalize_story_memory_turn_actor_label(value: str | None, *, fallback: str) -> str:
        normalized = " ".join(str(value or "").split()).strip()
        return normalized[:120].rstrip() if normalized else fallback

    normalized_prompt = str(latest_user_prompt or "").replace("\r\n", "\n").strip()
    normalized_assistant = str(latest_assistant_text or "").replace("\r\n", "\n").strip()
    if not normalized_prompt and not normalized_assistant:
        return ""

    normalized_player_turn_label = _normalize_story_memory_turn_actor_label(
        player_turn_label,
        fallback="грок",
    )
    prompt_label, prompt_body = _build_detailed_turn_summary(
        normalized_prompt,
        preserve_full_text=bool(preserve_user_text),
    )
    assistant_label, assistant_body = _build_detailed_turn_summary(
        normalized_assistant,
        preserve_full_text=bool(preserve_assistant_text),
    )
    parts: list[str] = []
    if prompt_body:
        parts.append(
            f"Ход игрока: {normalized_player_turn_label} ({prompt_label}):\n"
            f"{prompt_body}"
        )
    if assistant_body:
        parts.append(
            f"Ответ рассказчика ({assistant_label}):\n"
            f"{assistant_body}"
        )
    return "\n\n".join(parts).strip()


def _get_story_main_hero_name_for_memory(db: Session, *, game_id: int) -> str:
    main_hero_title = db.scalar(
        select(StoryWorldCard.title)
        .where(
            StoryWorldCard.game_id == game_id,
            StoryWorldCard.kind == STORY_WORLD_CARD_KIND_MAIN_HERO,
        )
        .order_by(StoryWorldCard.id.desc())
        .limit(1)
    )
    return " ".join(str(main_hero_title or "").split()).strip()


def _list_story_known_character_names_for_memory(
    db: Session,
    *,
    game_id: int,
    player_turn_label: str | None = None,
) -> list[str]:
    names: list[str] = []
    seen_names: set[str] = set()

    def _append_name(raw_value: Any) -> None:
        normalized_value = " ".join(str(raw_value or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
        if not normalized_value:
            return
        normalized_key = normalized_value.casefold()
        if normalized_key in seen_names:
            return
        seen_names.add(normalized_key)
        names.append(normalized_value)

    _append_name(player_turn_label)
    for card in _list_story_world_cards(db, game_id):
        card_kind = _normalize_story_world_card_kind(getattr(card, "kind", None))
        if card_kind not in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}:
            continue
        _append_name(getattr(card, "title", ""))

    return names


def _collect_story_memory_identity_names(
    *,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,
) -> list[str]:
    names: list[str] = []
    seen_names: set[str] = set()

    def _append_name(raw_value: Any) -> None:
        normalized_value = " ".join(str(raw_value or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?В«В»")
        if not normalized_value:
            return
        normalized_key = normalized_value.casefold()
        if normalized_key in seen_names:
            return
        seen_names.add(normalized_key)
        names.append(normalized_value)

    _append_name(player_name)
    for raw_name in list(known_character_names or []):
        _append_name(raw_name)
    return names


def _count_story_user_turns_before_assistant_message(
    db: Session,
    *,
    game_id: int,
    assistant_message_id: int,
) -> int:
    total_turns = db.scalar(
        select(func.count())
        .select_from(StoryMessage)
        .where(
            StoryMessage.game_id == game_id,
            StoryMessage.role == STORY_USER_ROLE,
            StoryMessage.id < assistant_message_id,
            StoryMessage.undone_at.is_(None),
        )
    )
    return max(int(total_turns or 0), 0)


def _build_story_memory_block_title(content: str, *, fallback_prefix: str) -> str:
    derived_title = _derive_story_plot_card_title_from_content(content)
    if not derived_title or _is_story_plot_card_default_title(derived_title):
        derived_title = fallback_prefix
    return _normalize_story_memory_block_title(
        derived_title,
        fallback=fallback_prefix,
    )


def _create_story_memory_block(
    *,
    db: Session,
    game_id: int,
    assistant_message_id: int | None,
    layer: str,
    title: str,
    content: str,
    preserve_content: bool = False,
) -> StoryMemoryBlock:
    normalized_layer = _normalize_story_memory_layer(layer)
    normalized_raw_content = str(content or "").replace("\r\n", "\n").strip()

    if normalized_layer == STORY_MEMORY_LAYER_RAW and "[[" in normalized_raw_content:
        normalized_raw_content = STORY_MARKUP_MARKER_PATTERN.sub(" ", normalized_raw_content)
        normalized_raw_content = re.sub(r"\[\[[^\]]*$", " ", normalized_raw_content)
        normalized_raw_content = re.sub(r"[ \t]+\n", "\n", normalized_raw_content)
        normalized_raw_content = re.sub(r"\n{3,}", "\n\n", normalized_raw_content).strip()

    should_preserve_content = bool(preserve_content) or normalized_layer in {
        STORY_MEMORY_LAYER_RAW,
        STORY_MEMORY_LAYER_COMPRESSED,
        STORY_MEMORY_LAYER_SUPER,
    }
    if should_preserve_content:
        content_for_storage = normalized_raw_content
    else:
        extracted_sentences = _extract_story_memory_sentences(normalized_raw_content)
        if extracted_sentences:
            if normalized_layer == STORY_MEMORY_LAYER_KEY:
                content_for_storage = "\n".join(extracted_sentences).strip()
            else:
                content_for_storage = "\n".join(f"- {line}" for line in extracted_sentences).strip()
        else:
            fallback_sentence = _normalize_story_memory_sentence_candidate(normalized_raw_content)
            if fallback_sentence:
                content_for_storage = (
                    fallback_sentence
                    if normalized_layer == STORY_MEMORY_LAYER_KEY
                    else f"- {fallback_sentence}"
                )
            else:
                content_for_storage = "Существенных фактов не выделено."

    normalized_content = _normalize_story_memory_block_content(content_for_storage)
    normalized_raw_title = str(title or "").replace("\r\n", " ").strip()
    title_candidate = _normalize_story_memory_sentence_candidate(normalized_raw_title).rstrip(".!?…").strip()
    title_for_storage = title_candidate or normalized_raw_title
    normalized_title = _normalize_story_memory_block_title(
        title_for_storage,
        fallback="Блок памяти",
    )
    block = StoryMemoryBlock(
        game_id=game_id,
        assistant_message_id=assistant_message_id,
        layer=normalized_layer,
        title=normalized_title,
        content=normalized_content,
        token_count=max(_estimate_story_tokens(normalized_content), 1),
    )
    db.add(block)
    db.flush()
    return block





def _seed_story_environment_weather_payload(

    *,

    game: StoryGame,

    current_location_content: str,

    latest_user_prompt: str,

    previous_assistant_text: str,

    latest_assistant_text: str,

    current_datetime_override: str | None = None,

) -> dict[str, Any] | None:

    if not settings.openrouter_api_key:

        return None



    current_datetime = _normalize_story_environment_datetime(

        current_datetime_override

        if isinstance(current_datetime_override, str) and current_datetime_override.strip()

        else str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_day_date = _story_environment_date_key_from_value(current_datetime)

    tomorrow_day_date = _story_environment_next_date_key(current_day_date)

    normalized_current_location = _normalize_story_location_memory_content(current_location_content)

    normalized_user_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=900)

    normalized_previous_assistant = _normalize_story_prompt_text(previous_assistant_text, max_chars=1_500)

    normalized_latest_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=1_800)

    if not any([normalized_current_location, normalized_previous_assistant, normalized_latest_assistant, normalized_user_prompt]):

        return None

    current_datetime_facts = _format_story_environment_datetime_prompt_facts(

        _deserialize_story_environment_datetime(current_datetime)

    )



    saved_current_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_current_weather", "") or "")

    )

    saved_tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )



    messages_payload = [

        {

            "role": "system",

            "content": (

                "Initialize current RPG weather continuity for the active scene. "

                "You must infer grounded current weather for today and a stable forecast for tomorrow from the scene location, date, time, season, and recent scene descriptions. "

                "For current_weather.timeline, return exactly four broad periods for the current date in this order: 00:00-06:00, 06:00-12:00, 12:00-18:00, 18:00-00:00. "
                "Do not split one part of the day into duplicates such as morning and late morning, or afternoon and late afternoon. "

                "Do not omit the night block and do not default it to a daytime placeholder when the current time is after midnight. "
                "The final time range must end at 00:00 so the day timeline closes at midnight. "

                "The active current_weather summary and details must match the period that contains the current time. "
                "If the current time is between 00:00 and 05:59, current_weather must describe the night block and must not default to a daytime placeholder. "
                "Tomorrow_weather is only one compact forecast for the next day, not a full hourly plan. "

                "If weather is not explicit, infer a believable state from the date, season, place, terrain, and recent scene details instead of leaving it blank. "
                "Do not lazily default both today and tomorrow to the same generic state like 'переменная облачность' unless the provided evidence really supports that outcome. "
                "Prefer specific but grounded summaries, and make tomorrow meaningfully differ when the date, location, or conditions plausibly suggest a different forecast. "
                "Do not invent extreme storms, magic anomalies, or dramatic shifts without evidence. "

                "Keep temperatures seasonally believable for the date and location. In a default temperate setting, summer should not sit near winter temperatures without explicit evidence such as mountains, far north, magical cold, or a severe anomaly. "

                "Keep the daily progression internally logical. For example a cool misty morning can lead to a clearer day, then wind or light rain by evening, but not random chaos. "

                "Keep outputs short, practical, and in Russian. "

                "Return strict JSON only without markdown in this shape: "

                "{\"current_weather\":{\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\",\"timeline\":[{\"start_time\":\"06:00\",\"end_time\":\"10:00\",\"summary\":\"...\",\"temperature_c\":12,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\"}]},"

                "\"tomorrow_weather\":{\"summary\":\"...\",\"temperature_c\":10,\"fog\":\"...\",\"humidity\":\"...\",\"wind\":\"...\",\"day_date\":\"YYYY-MM-DD\"}}."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Текущие дата и время:\n{current_datetime_facts or current_datetime}\n\n"

                f"Текущая дата для current_weather:\n{current_day_date or 'нет'}\n\n"

                f"Дата прогноза для tomorrow_weather:\n{tomorrow_day_date or 'нет'}\n\n"

                f"Текущее место:\n{normalized_current_location or 'нет'}\n\n"

                f"Сохраненная погода на сегодня:\n{json.dumps(saved_current_weather, ensure_ascii=False) if isinstance(saved_current_weather, dict) else 'нет'}\n\n"

                f"Сохраненный прогноз на завтра:\n{json.dumps(saved_tomorrow_weather, ensure_ascii=False) if isinstance(saved_tomorrow_weather, dict) else 'нет'}\n\n"

                f"Последний ход игрока:\n{normalized_user_prompt or 'нет'}\n\n"

                f"Предыдущий ответ мастера:\n{normalized_previous_assistant or 'нет'}\n\n"

                f"Новый ответ мастера:\n{normalized_latest_assistant or 'нет'}"

            ),

        },

    ]



    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=STORY_ENVIRONMENT_ANALYSIS_MODEL,

                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=[],

                temperature=0.15,

                max_tokens=min(STORY_ENVIRONMENT_ANALYSIS_REQUEST_MAX_TOKENS, 560),

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story environment weather seed failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.2)

                continue

            return None



        parsed_payload = _extract_json_object_from_text(raw_response.replace("\r\n", "\n").strip())

        if not isinstance(parsed_payload, dict) or not parsed_payload:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None



        current_weather = _normalize_story_environment_weather_payload(parsed_payload.get("current_weather"))

        tomorrow_weather = _normalize_story_environment_weather_payload(parsed_payload.get("tomorrow_weather"))

        if current_weather is None and tomorrow_weather is None:

            if attempt_index == 0:

                time.sleep(0.15)

                continue

            return None

        if isinstance(current_weather, dict):

            current_weather = _normalize_story_environment_weather_payload(

                {

                    **current_weather,

                    "day_date": current_day_date or current_weather.get("day_date"),

                }

            )

        if isinstance(tomorrow_weather, dict):

            tomorrow_weather = _normalize_story_environment_weather_payload(

                {

                    **tomorrow_weather,

                    "day_date": tomorrow_day_date or tomorrow_weather.get("day_date"),

                }

            )

        return {

            "current_weather": current_weather,

            "tomorrow_weather": tomorrow_weather,

        }



    return None





def _ensure_story_environment_seeded(

    *,

    db: Session,

    game: StoryGame,

) -> bool:

    if not _normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):

        return False



    changed = False

    normalized_datetime = _normalize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    if str(getattr(game, "environment_current_datetime", "") or "") != normalized_datetime:

        game.environment_current_datetime = normalized_datetime

        changed = True



    resolved_current_datetime = _deserialize_story_environment_datetime(

        str(getattr(game, "environment_current_datetime", "") or "")

    )

    current_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_current_weather", "") or "")

    )

    tomorrow_weather = _deserialize_story_environment_weather(

        str(getattr(game, "environment_tomorrow_weather", "") or "")

    )



    assistant_messages = [

        message

        for message in reversed(_list_story_messages(db, game.id))

        if message.role == STORY_ASSISTANT_ROLE and message.content.strip()

    ]

    latest_assistant_text = (

        _normalize_story_assistant_text_for_memory(assistant_messages[0].content)

        if len(assistant_messages) >= 1

        else str(getattr(game, "opening_scene", "") or "").replace("\r\n", "\n").strip()

    )

    previous_assistant_text = (

        _normalize_story_assistant_text_for_memory(assistant_messages[1].content)

        if len(assistant_messages) >= 2

        else ""

    )

    latest_user_message = next(

        (

            message

            for message in reversed(_list_story_messages(db, game.id))

            if message.role == STORY_USER_ROLE and message.content.strip()

        ),

        None,

    )

    latest_user_prompt = (

        latest_user_message.content.replace("\r\n", "\n").strip()

        if isinstance(latest_user_message, StoryMessage)

        else ""

    )

    current_location_content = _get_story_latest_location_memory_content(

        db=db,

        game_id=game.id,

    )



    resolved_current_weather, resolved_tomorrow_weather = _resolve_story_environment_weather_state(

        game=game,

        current_datetime=resolved_current_datetime,

        current_location_content=current_location_content,

        latest_user_prompt=latest_user_prompt,

        previous_assistant_text=previous_assistant_text,

        latest_assistant_text=latest_assistant_text,

        extracted_current_weather=current_weather if isinstance(current_weather, dict) else None,

        extracted_tomorrow_weather=tomorrow_weather if isinstance(tomorrow_weather, dict) else None,

    )

    next_current_weather = _serialize_story_environment_weather(resolved_current_weather)

    next_tomorrow_weather = _serialize_story_environment_weather(resolved_tomorrow_weather)

    if str(getattr(game, "environment_current_weather", "") or "") != next_current_weather:

        game.environment_current_weather = next_current_weather

        changed = True

    if str(getattr(game, "environment_tomorrow_weather", "") or "") != next_tomorrow_weather:

        game.environment_tomorrow_weather = next_tomorrow_weather

        changed = True



    memory_changed = _sync_story_manual_environment_memory_blocks(db=db, game=game)

    return changed or memory_changed





def _upsert_story_raw_memory_block(

    *,

    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage,

    latest_user_prompt: str | None = None,

    latest_assistant_text: str | None = None,

    preserve_user_text: bool | None = None,

    preserve_assistant_text: bool = False,

) -> bool:

    if assistant_message.game_id != game.id or assistant_message.role != STORY_ASSISTANT_ROLE:

        return False

    if not bool(getattr(game, "memory_optimization_enabled", True)):
        game.memory_optimization_enabled = True

    resolved_latest_user_prompt = (
        latest_user_prompt.replace("\r\n", "\n").strip()
        if isinstance(latest_user_prompt, str)
        else _get_story_user_prompt_before_assistant_message(
            db,
            game_id=game.id,
            assistant_message_id=assistant_message.id,
        )
    )
    resolved_latest_assistant_text = (
        latest_assistant_text.replace("\r\n", "\n").strip()
        if isinstance(latest_assistant_text, str)
        else _normalize_story_assistant_text_for_memory(assistant_message.content)
    )
    if not resolved_latest_assistant_text:
        resolved_latest_assistant_text = assistant_message.content.replace("\r\n", "\n").strip()

    turn_memory_blocks = [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if int(getattr(block, "assistant_message_id", 0) or 0) == assistant_message.id
        and _normalize_story_memory_layer(block.layer)
        in {
            STORY_MEMORY_LAYER_RAW,
            STORY_MEMORY_LAYER_COMPRESSED,
            STORY_MEMORY_LAYER_SUPER,
        }
    ]
    raw_blocks = [
        block
        for block in turn_memory_blocks
        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
    ]
    stale_compact_blocks = [
        block
        for block in turn_memory_blocks
        if _normalize_story_memory_layer(block.layer)
        in {
            STORY_MEMORY_LAYER_COMPRESSED,
            STORY_MEMORY_LAYER_SUPER,
        }
    ]

    if not resolved_latest_user_prompt and not resolved_latest_assistant_text:
        changed = False
        for block in raw_blocks:
            db.delete(block)
            changed = True
        for block in stale_compact_blocks:
            db.delete(block)
            changed = True
        if changed:
            db.flush()
        return changed

    main_hero_name_for_memory = _get_story_main_hero_name_for_memory(db, game_id=game.id)
    known_character_names_for_memory = _list_story_known_character_names_for_memory(
        db,
        game_id=game.id,
        player_turn_label=main_hero_name_for_memory,
    )
    resolved_preserve_user_text = (
        bool(preserve_user_text)
        if isinstance(preserve_user_text, bool)
        else (
            _count_story_user_turns_before_assistant_message(
                db,
                game_id=game.id,
                assistant_message_id=assistant_message.id,
            )
            <= STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS
        )
    )
    raw_block_content = _build_story_raw_memory_block_content(
        latest_user_prompt=resolved_latest_user_prompt,
        latest_assistant_text=resolved_latest_assistant_text,
        player_turn_label=main_hero_name_for_memory,
        known_character_names=known_character_names_for_memory,
        preserve_user_text=resolved_preserve_user_text,
        preserve_assistant_text=bool(preserve_assistant_text),
    )

    if not raw_block_content:
        for block in raw_blocks:
            db.delete(block)
        return bool(raw_blocks)

    normalized_title = _build_story_memory_block_title(
        raw_block_content,
        fallback_prefix="Fresh memory",
    )
    normalized_content = _normalize_story_memory_block_content(raw_block_content)

    changed = False
    for block in stale_compact_blocks:
        db.delete(block)
        changed = True

    primary_block = raw_blocks[0] if raw_blocks else None
    if isinstance(primary_block, StoryMemoryBlock):
        next_token_count = max(_estimate_story_tokens(normalized_content), 1)
        if primary_block.title != normalized_title:
            primary_block.title = normalized_title
            changed = True
        if primary_block.content != normalized_content:
            primary_block.content = normalized_content
            changed = True
        if int(getattr(primary_block, "token_count", 0) or 0) != next_token_count:
            primary_block.token_count = next_token_count
            changed = True
        for duplicate_block in raw_blocks[1:]:
            db.delete(duplicate_block)
            changed = True
        if changed:
            db.flush()
        return changed

    _create_story_memory_block(
        db=db,
        game_id=game.id,
        assistant_message_id=assistant_message.id,
        layer=STORY_MEMORY_LAYER_RAW,
        title=normalized_title,
        content=raw_block_content,
        preserve_content=bool(preserve_assistant_text),
    )
    return True


def _sync_story_raw_memory_blocks_for_recent_turns(
    *,

    db: Session,

    game: StoryGame,

    additional_assistant_message_ids: list[int] | None = None,

    run_rebalance: bool = True,

) -> bool:
    def _safe_int(value: Any, *, default: int = 0) -> int:
        try:
            normalized = int(value)
        except Exception:
            return default
        return normalized

    latest_assistant_message_ids = _list_story_latest_assistant_message_ids(

        db,

        game.id,

        limit=STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS,

    )

    protected_assistant_message_ids = {
        assistant_message_id
        for assistant_message_id in (_safe_int(item) for item in latest_assistant_message_ids)
        if assistant_message_id > 0
    }

    logger.info(
        "Story raw-memory sync started: game_id=%s latest_assistant_ids=%s additional_ids=%s",
        game.id,
        ",".join(str(item) for item in latest_assistant_message_ids) or "none",
        ",".join(str(_safe_int(item)) for item in (additional_assistant_message_ids or [])) or "none",
    )



    target_assistant_message_ids: list[int] = []

    seen_assistant_message_ids: set[int] = set()



    raw_blocks = [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
    ]

    for block in raw_blocks:
        assistant_message_id = _safe_int(getattr(block, "assistant_message_id", 0))
        if assistant_message_id <= 0:
            continue
        if assistant_message_id in seen_assistant_message_ids:
            continue
        seen_assistant_message_ids.add(assistant_message_id)
        target_assistant_message_ids.append(assistant_message_id)



    for assistant_message_id in latest_assistant_message_ids:
        normalized_assistant_message_id = _safe_int(assistant_message_id)
        if normalized_assistant_message_id <= 0:
            continue
        if normalized_assistant_message_id in seen_assistant_message_ids:
            continue
        seen_assistant_message_ids.add(normalized_assistant_message_id)
        target_assistant_message_ids.append(normalized_assistant_message_id)



    for assistant_message_id in additional_assistant_message_ids or []:
        normalized_assistant_message_id = _safe_int(assistant_message_id)
        if normalized_assistant_message_id <= 0:
            continue
        if normalized_assistant_message_id in seen_assistant_message_ids:
            continue
        seen_assistant_message_ids.add(normalized_assistant_message_id)
        target_assistant_message_ids.append(normalized_assistant_message_id)



    updated_any_block = False

    for assistant_message_id in target_assistant_message_ids:
        try:
            with db.begin_nested():
                assistant_message = db.scalar(
                    select(StoryMessage).where(
                        StoryMessage.id == assistant_message_id,
                        StoryMessage.game_id == game.id,
                        StoryMessage.role == STORY_ASSISTANT_ROLE,
                        StoryMessage.undone_at.is_(None),
                    )
                )

                if assistant_message is None:
                    continue

                latest_user_prompt = _get_story_user_prompt_before_assistant_message(
                    db,
                    game_id=game.id,
                    assistant_message_id=assistant_message_id,
                )
                latest_assistant_text = _normalize_story_assistant_text_for_memory(
                    getattr(assistant_message, "content", "")
                )
                preserve_assistant_text = assistant_message_id in protected_assistant_message_ids

                updated_any_block = (
                    _upsert_story_raw_memory_block(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        latest_user_prompt=latest_user_prompt,
                        latest_assistant_text=latest_assistant_text,
                        preserve_user_text=preserve_assistant_text,
                        preserve_assistant_text=preserve_assistant_text,
                    )
                    or updated_any_block
                )
        except Exception:
            logger.exception(
                "Story raw-memory resync skipped broken assistant message: game_id=%s assistant_message_id=%s",
                game.id,
                _safe_int(assistant_message_id),
            )

    raw_keep_limit = max(int(STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS or 0), 1)
    latest_raw_assistant_ids = {
        assistant_message_id
        for assistant_message_id in (_safe_int(item) for item in latest_assistant_message_ids)
        if assistant_message_id > 0
    }
    raw_blocks_after_sync = [
        block
        for block in _list_story_memory_blocks(db, game.id)
        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
    ]
    needs_rebalance = len(raw_blocks_after_sync) > raw_keep_limit
    if not needs_rebalance:
        seen_raw_assistant_ids: set[int] = set()
        for raw_block in raw_blocks_after_sync:
            assistant_message_id = _safe_int(getattr(raw_block, "assistant_message_id", 0))
            if assistant_message_id <= 0:
                needs_rebalance = True
                break
            if assistant_message_id in seen_raw_assistant_ids:
                needs_rebalance = True
                break
            seen_raw_assistant_ids.add(assistant_message_id)
            if assistant_message_id not in latest_raw_assistant_ids:
                needs_rebalance = True
                break

    rebalance_succeeded = False
    rebalance_changed = False
    if run_rebalance and (updated_any_block or needs_rebalance):
        before_rebalance_layers = (
            len(
                [
                    block
                    for block in _list_story_memory_blocks(db, game.id)
                    if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
                ]
            ),
            len(
                [
                    block
                    for block in _list_story_memory_blocks(db, game.id)
                    if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_COMPRESSED
                ]
            ),
            len(
                [
                    block
                    for block in _list_story_memory_blocks(db, game.id)
                    if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_SUPER
                ]
            ),
        )
        try:
            _rebalance_story_memory_layers(db=db, game=game)
            rebalance_succeeded = True
            after_rebalance_layers = (
                len(
                    [
                        block
                        for block in _list_story_memory_blocks(db, game.id)
                        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
                    ]
                ),
                len(
                    [
                        block
                        for block in _list_story_memory_blocks(db, game.id)
                        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_COMPRESSED
                    ]
                ),
                len(
                    [
                        block
                        for block in _list_story_memory_blocks(db, game.id)
                        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_SUPER
                    ]
                ),
            )
            rebalance_changed = before_rebalance_layers != after_rebalance_layers
        except Exception:
            logger.exception("Story raw-memory resync rebalance failed: game_id=%s", game.id)

    return updated_any_block or (run_rebalance and rebalance_succeeded and rebalance_changed)


def _resync_story_continuity_from_assistant_message(

    *,

    db: Session,

    game: StoryGame,

    starting_assistant_message_id: int,

    max_assistant_messages: int = 6,

    run_rebalance: bool = True,

) -> bool:

    normalized_starting_assistant_message_id = max(int(starting_assistant_message_id or 0), 0)
    if normalized_starting_assistant_message_id <= 0:
        return False

    normalized_limit = max(int(max_assistant_messages or 0), 1)
    protected_assistant_message_ids = set(
        _list_story_latest_assistant_message_ids(
            db,
            game.id,
            limit=STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS,
        )
    )
    assistant_messages = list(
        db.scalars(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == game.id,
                StoryMessage.role == STORY_ASSISTANT_ROLE,
                StoryMessage.id >= normalized_starting_assistant_message_id,
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.asc())
            .limit(normalized_limit)
        )
    )
    if not assistant_messages:
        return False

    memory_changed = False
    any_changed = False
    environment_enabled = _normalize_story_environment_enabled(getattr(game, "environment_enabled", None))

    for assistant_message in assistant_messages:
        try:
            with db.begin_nested():
                latest_user_prompt = _get_story_user_prompt_before_assistant_message(
                    db,
                    game_id=game.id,
                    assistant_message_id=assistant_message.id,
                )
                latest_assistant_text = _normalize_story_assistant_text_for_memory(
                    getattr(assistant_message, "content", "")
                )
                previous_assistant_text = _get_story_previous_assistant_text_before_message(
                    db,
                    game_id=game.id,
                    assistant_message_id=assistant_message.id,
                )

                memory_changed = (
                    _upsert_story_raw_memory_block(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        latest_user_prompt=latest_user_prompt,
                        latest_assistant_text=latest_assistant_text,
                        preserve_user_text=assistant_message.id in protected_assistant_message_ids,
                        preserve_assistant_text=assistant_message.id in protected_assistant_message_ids,
                    )
                    or memory_changed
                )

                location_changed = _upsert_story_location_memory_block(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=latest_user_prompt,
                    latest_assistant_text=latest_assistant_text,
                    previous_assistant_text=previous_assistant_text,
                )
                current_location_content = _get_story_latest_location_memory_content(
                    db=db,
                    game_id=game.id,
                )
                environment_changed = False
                if environment_enabled:
                    environment_changed = _sync_story_environment_state_for_assistant_message(
                        db=db,
                        game=game,
                        assistant_message=assistant_message,
                        latest_user_prompt=latest_user_prompt,
                        latest_assistant_text=latest_assistant_text,
                        previous_assistant_text=previous_assistant_text,
                        current_location_content_override=current_location_content,
                        resolved_payload_override={"action": "keep"},
                        allow_weather_seed=False,
                    )
                any_changed = location_changed or environment_changed or any_changed
        except Exception:
            logger.exception(
                "Story continuity resync skipped broken assistant message: game_id=%s assistant_message_id=%s",
                game.id,
                int(getattr(assistant_message, "id", 0) or 0),
            )
            continue

    if run_rebalance and memory_changed:
        try:
            _rebalance_story_memory_layers(db=db, game=game)
        except Exception:
            logger.exception(
                "Story continuity resync rebalance failed: game_id=%s starting_assistant_message_id=%s",
                game.id,
                normalized_starting_assistant_message_id,
            )

    return memory_changed or any_changed


def _optimize_story_memory_state(

    *,

    db: Session,

    game: StoryGame,

    starting_assistant_message_id: int | None = None,

    max_assistant_messages: int = 48,

    max_model_requests: int | None = None,

    require_model_compaction: bool = False,

) -> bool:

    normalized_starting_assistant_message_id = max(int(starting_assistant_message_id or 0), 0)

    normalized_max_assistant_messages = max(int(max_assistant_messages or 0), 1)

    changed = False

    stage_succeeded = False

    stage_errors: list[tuple[str, Exception]] = []

    if normalized_starting_assistant_message_id > 0:

        try:

            with db.begin_nested():

                changed = (

                    _resync_story_continuity_from_assistant_message(

                        db=db,

                        game=game,

                        starting_assistant_message_id=normalized_starting_assistant_message_id,

                        max_assistant_messages=normalized_max_assistant_messages,

                        run_rebalance=False,

                    )

                    or changed

                )

            stage_succeeded = True

        except Exception as exc:

            logger.exception(

                "Story memory optimize continuity resync failed: game_id=%s starting_assistant_message_id=%s",

                game.id,

                normalized_starting_assistant_message_id,

            )
            stage_errors.append(("continuity_resync", exc))

    try:

        with db.begin_nested():

            changed = _sync_story_raw_memory_blocks_for_recent_turns(

                db=db,

                game=game,

                run_rebalance=False,

            ) or changed

        stage_succeeded = True

    except Exception as exc:

        logger.exception(

            "Story memory optimize raw-sync failed: game_id=%s",

            game.id,

        )
        stage_errors.append(("raw_sync", exc))

    if require_model_compaction and changed:
        try:
            db.commit()
            db.refresh(game)
        except Exception as exc:
            logger.exception(
                "Story memory optimize pre-rebalance commit failed: game_id=%s",
                game.id,
            )
            stage_errors.append(("pre_rebalance_commit", exc))

    try:
        if require_model_compaction:
            _rebalance_story_memory_layers(

                db=db,

                game=game,

                max_model_requests=max_model_requests,

                require_model_compaction=require_model_compaction,

                backfill_existing_compact_layers=not require_model_compaction,

                prioritize_recent_transitions=require_model_compaction,

                commit_each_model_compaction=require_model_compaction,

            )
        else:
            with db.begin_nested():
                _rebalance_story_memory_layers(

                    db=db,

                    game=game,

                    max_model_requests=max_model_requests,

                    require_model_compaction=require_model_compaction,

                    backfill_existing_compact_layers=not require_model_compaction,

                    prioritize_recent_transitions=require_model_compaction,

                    commit_each_model_compaction=require_model_compaction,

                )

        stage_succeeded = True

        changed = True

    except Exception as exc:

        logger.exception(

            "Story memory optimize rebalance failed: game_id=%s starting_assistant_message_id=%s",

            game.id,

            normalized_starting_assistant_message_id or None,

        )
        stage_errors.append(("rebalance", exc))

    if not stage_succeeded:

        error_summary = " | ".join(
            f"{stage}: {type(exc).__name__}: {str(exc).strip() or 'n/a'}"
            for stage, exc in stage_errors
        ).strip()
        if error_summary:
            raise RuntimeError(f"Story memory optimization pipeline failed: {error_summary[:400]}")
        raise RuntimeError("Story memory optimization pipeline failed")

    return changed


def _list_story_latest_assistant_message_ids(
    db: Session,

    game_id: int,

    *,

    limit: int,

) -> list[int]:

    normalized_limit = max(int(limit), 0)

    if normalized_limit <= 0:

        return []

    return [

        int(message_id)

        for message_id in db.scalars(

            select(StoryMessage.id)

            .where(

                StoryMessage.game_id == game_id,

                StoryMessage.role == STORY_ASSISTANT_ROLE,

                StoryMessage.undone_at.is_(None),

            )

            .order_by(StoryMessage.id.desc())

            .limit(normalized_limit)

        ).all()

    ]





def _extract_story_memory_sentences(raw_content: str) -> list[str]:

    normalized = raw_content.replace("\r\n", "\n").strip()

    if not normalized:

        return []

    extracted: list[str] = []

    seen_sentences: set[str] = set()

    for raw_line in normalized.split("\n"):

        compact_line = re.sub(r"^\s*[-•]\s*", "", raw_line).strip()

        if not compact_line:

            continue

        sentence_candidates = re.split(r"(?<=[.!?…])\s+", re.sub(r"\s+", " ", compact_line))

        for sentence in sentence_candidates:

            compact_sentence = _normalize_story_memory_sentence_candidate(sentence)

            if not compact_sentence:

                continue

            sentence_key = compact_sentence.casefold()

            if sentence_key in seen_sentences:

                continue

            seen_sentences.add(sentence_key)

            extracted.append(compact_sentence)

    return extracted


def _extract_story_memory_player_name_from_block(raw_content: str) -> str:
    normalized = str(raw_content or "").replace("\r\n", "\n")
    if not normalized:
        return ""

    player_match = re.search(r"Ход игрока:\s*([^\n(]{1,120}?)\s*\(", normalized, flags=re.IGNORECASE)
    if not player_match:
        return ""
    return " ".join(player_match.group(1).split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")


def _extract_story_memory_capitalized_name_candidates(sentence: str) -> list[str]:
    normalized_sentence = str(sentence or "").replace("\r\n", "\n").strip()
    if not normalized_sentence:
        return []

    stopwords = {
        "Ход",
        "грок",
        "грока",
        "Ответ",
        "Рассказчик",
        "Рассказчика",
        "Полный",
        "Подробный",
        "Пересказ",
        "Текст",
        "Fresh",
        "Memory",
    }
    matches = re.findall(
        r"(?<![\w-])([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]{2,}(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]{2,}){0,2})(?![\w-])",
        normalized_sentence,
    )

    candidates: list[str] = []
    seen_candidates: set[str] = set()
    for raw_match in matches:
        candidate = " ".join(str(raw_match or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
        if not candidate or candidate in stopwords:
            continue
        candidate_key = candidate.casefold()
        if candidate_key in seen_candidates:
            continue
        seen_candidates.add(candidate_key)
        candidates.append(candidate)

    return candidates


def _sentence_contains_story_name(sentence: str, name: str) -> bool:
    normalized_sentence = str(sentence or "").casefold()
    normalized_name = " ".join(str(name or "").split()).strip().casefold()
    if not normalized_sentence or not normalized_name:
        return False
    return bool(re.search(rf"(?<![\w-]){re.escape(normalized_name)}(?![\w-])", normalized_sentence))


def _extract_story_memory_explicit_name_mentions(
    sentence: str,
    *,
    known_character_names: list[str],
) -> list[str]:
    if not sentence:
        return []

    explicit_mentions: list[str] = []
    seen_mentions: set[str] = set()
    for name in known_character_names:
        normalized_name = " ".join(str(name or "").split()).strip()
        if not normalized_name or not _sentence_contains_story_name(sentence, normalized_name):
            continue
        mention_key = normalized_name.casefold()
        if mention_key in seen_mentions:
            continue
        seen_mentions.add(mention_key)
        explicit_mentions.append(normalized_name)

    if explicit_mentions:
        return explicit_mentions

    for candidate in _extract_story_memory_capitalized_name_candidates(sentence):
        candidate_key = candidate.casefold()
        if candidate_key in seen_mentions:
            continue
        seen_mentions.add(candidate_key)
        explicit_mentions.append(candidate)

    return explicit_mentions


def _build_story_memory_name_keys(value: str) -> set[str]:
    normalized_value = " ".join(str(value or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
    if not normalized_value:
        return set()

    identity_builder = globals().get("_build_story_identity_keys")
    if callable(identity_builder):
        try:
            candidate_keys = {
                str(item).strip()
                for item in identity_builder(normalized_value, [normalized_value])
                if str(item).strip()
            }
            if candidate_keys:
                return candidate_keys
        except Exception:
            pass

    identity_key_builder = globals().get("_normalize_story_identity_key")
    if callable(identity_key_builder):
        try:
            identity_key = str(identity_key_builder(normalized_value) or "").strip()
            if identity_key:
                return {identity_key}
        except Exception:
            pass

    return {normalized_value.casefold()}


def _story_memory_names_match(left: str, right: str) -> bool:
    left_keys = _build_story_memory_name_keys(left)
    right_keys = _build_story_memory_name_keys(right)
    if not left_keys or not right_keys:
        return False

    related_identity_keys = globals().get("_are_story_identity_keys_related")
    if callable(related_identity_keys):
        for left_key in left_keys:
            for right_key in right_keys:
                try:
                    if related_identity_keys(left_key, right_key):
                        return True
                except Exception:
                    continue

    return bool(left_keys.intersection(right_keys))


def _story_memory_text_mentions_name(text_value: str, name: str) -> bool:
    normalized_text = str(text_value or "").replace("\r\n", "\n").strip()
    normalized_name = " ".join(str(name or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
    if not normalized_text or not normalized_name:
        return False
    if _sentence_contains_story_name(normalized_text, normalized_name):
        return True

    explicit_name_extractor = globals().get("_extract_story_explicit_person_names_from_text")
    if callable(explicit_name_extractor):
        try:
            extracted_names = explicit_name_extractor(normalized_text)
        except Exception:
            extracted_names = []
        for extracted_name in extracted_names:
            if _story_memory_names_match(extracted_name, normalized_name):
                return True

    return False


def _story_memory_text_covers_names(text_value: str, required_names: list[str]) -> bool:
    return all(_story_memory_text_mentions_name(text_value, name) for name in required_names)


def _extract_story_memory_required_explicit_names(
    text_value: str,
    *,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,
) -> list[str]:
    normalized_text = str(text_value or "").replace("\r\n", "\n").strip()
    if not normalized_text:
        return []

    required_names: list[str] = []

    def _append_name(raw_value: Any) -> None:
        normalized_value = " ".join(str(raw_value or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
        if not normalized_value:
            return
        if any(_story_memory_names_match(normalized_value, existing_name) for existing_name in required_names):
            return
        required_names.append(normalized_value)

    for known_name in _collect_story_memory_identity_names(
        player_name=player_name,
        known_character_names=known_character_names,
    ):
        if _story_memory_text_mentions_name(normalized_text, known_name):
            _append_name(known_name)

    explicit_name_extractor = globals().get("_extract_story_explicit_person_names_from_text")
    if callable(explicit_name_extractor):
        try:
            extracted_names = explicit_name_extractor(normalized_text)
        except Exception:
            extracted_names = []
        for extracted_name in extracted_names:
            _append_name(extracted_name)

    return required_names


def _replace_story_memory_player_possessives(sentence: str, *, player_name: str) -> str:
    normalized_sentence = str(sentence or "").strip()
    normalized_player_name = " ".join(str(player_name or "").split()).strip()
    if not normalized_sentence or not normalized_player_name:
        return normalized_sentence

    possessive_patterns = (
        r"\bтвой\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bтвоя\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bтвоё\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bтвое\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bтвои\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bТвой\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bТвоя\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bТвоё\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bТвое\s+([A-Za-zА-Яа-яЁё-]+)",
        r"\bТвои\s+([A-Za-zА-Яа-яЁё-]+)",
    )

    def _replace_possessive(match: re.Match[str]) -> str:
        raw_noun = str(match.group(1) or "").strip()
        if not raw_noun:
            return match.group(0)
        noun_value = raw_noun[:1].upper() + raw_noun[1:] if match.group(0)[:1].isupper() else raw_noun
        return f"{noun_value} {normalized_player_name}"

    rewritten = normalized_sentence
    for pattern in possessive_patterns:
        rewritten = re.sub(pattern, _replace_possessive, rewritten)

    return rewritten


def _replace_story_memory_subject_pronouns(sentence: str, *, resolved_name: str) -> str:
    normalized_sentence = str(sentence or "").strip()
    normalized_name = " ".join(str(resolved_name or "").split()).strip()
    if not normalized_sentence or not normalized_name:
        return normalized_sentence

    def _replace_subject(match: re.Match[str]) -> str:
        raw_value = str(match.group(0) or "")
        if not raw_value:
            return normalized_name
        return normalized_name[:1].upper() + normalized_name[1:] if raw_value[:1].isupper() else normalized_name

    return re.sub(r"\b(?:он|она|Он|Она)\b", _replace_subject, normalized_sentence)


def _clarify_story_memory_summary_sentences(
    sentences: list[str],
    *,
    raw_content: str,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,
) -> list[str]:
    if not sentences:
        return []

    normalized_player_name = " ".join(str(player_name or "").split()).strip()
    if not normalized_player_name:
        normalized_player_name = _extract_story_memory_player_name_from_block(raw_content)

    effective_known_names: list[str] = []
    seen_names: set[str] = set()
    for raw_name in list(known_character_names or []):
        normalized_name = " ".join(str(raw_name or "").split()).strip(" \t\r\n\"'()[]{}.,:;!?«»")
        if not normalized_name:
            continue
        normalized_key = normalized_name.casefold()
        if normalized_key in seen_names:
            continue
        seen_names.add(normalized_key)
        effective_known_names.append(normalized_name)

    if normalized_player_name and normalized_player_name.casefold() not in seen_names:
        seen_names.add(normalized_player_name.casefold())
        effective_known_names.insert(0, normalized_player_name)

    active_character_name = ""
    clarified_sentences: list[str] = []
    for raw_sentence in sentences:
        normalized_sentence = _replace_story_memory_player_possessives(
            raw_sentence,
            player_name=normalized_player_name,
        )
        explicit_mentions = _extract_story_memory_explicit_name_mentions(
            normalized_sentence,
            known_character_names=effective_known_names,
        )
        non_player_mentions = [
            name
            for name in explicit_mentions
            if not normalized_player_name or name.casefold() != normalized_player_name.casefold()
        ]

        if not non_player_mentions and active_character_name:
            normalized_sentence = _replace_story_memory_subject_pronouns(
                normalized_sentence,
                resolved_name=active_character_name,
            )

        if len(non_player_mentions) == 1:
            active_character_name = non_player_mentions[0]
        elif len(non_player_mentions) > 1:
            active_character_name = ""

        clarified_sentences.append(normalized_sentence)

    return clarified_sentences


def _join_story_memory_sentences_as_prose(sentences: list[str], *, max_chars: int) -> str:
    normalized_sentences: list[str] = []
    seen: set[str] = set()
    for sentence in sentences:
        normalized_sentence = _normalize_story_memory_sentence_candidate(sentence)
        if not normalized_sentence:
            continue
        sentence_key = normalized_sentence.casefold()
        if sentence_key in seen:
            continue
        seen.add(sentence_key)
        normalized_sentences.append(normalized_sentence)

    if not normalized_sentences:
        return ""

    joined = " ".join(normalized_sentences)
    joined = re.sub(r"\s+", " ", joined).strip()
    if len(joined) > max(int(max_chars), 1):
        joined = joined[: max(int(max_chars), 1) - 1].rstrip(" ,;:-.!?…") + "…"
    if joined and joined[-1] not in ".!?…":
        joined = f"{joined}."
    return joined



def _select_story_memory_ranked_entries(

    entries: list[tuple[int, str, int]],

    *,

    limit: int,

    preserve_opening: bool,

    preserve_latest: bool,

    preserve_priority: bool,

) -> list[tuple[int, str, int]]:
    if not entries:
        return []

    normalized_limit = max(int(limit or 0), 1)
    ranked_entries = sorted(entries, key=lambda item: (-item[2], item[0]))

    forced_candidates: list[tuple[int, str, int]] = []
    if preserve_priority and ranked_entries:
        forced_candidates.append(ranked_entries[0])
    if preserve_latest and entries:
        forced_candidates.append(entries[-1])
    if preserve_opening and entries:
        forced_candidates.append(entries[0])

    forced_entries: list[tuple[int, str, int]] = []
    forced_ids: set[int] = set()
    for entry in forced_candidates:
        entry_id = int(entry[0])
        if entry_id in forced_ids:
            continue
        forced_ids.add(entry_id)
        forced_entries.append(entry)

    if len(forced_entries) > normalized_limit:
        forced_entries = forced_entries[:normalized_limit]
        forced_ids = {int(item[0]) for item in forced_entries}

    selected_entries = list(forced_entries)
    for entry in ranked_entries:
        entry_id = int(entry[0])
        if entry_id in forced_ids:
            continue
        selected_entries.append(entry)
        if len(selected_entries) >= normalized_limit:
            break

    return selected_entries[:normalized_limit]



def _build_story_memory_summary_without_truncation(

    raw_content: str,

    *,

    super_mode: bool,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,

) -> str:

    sentences = _extract_story_memory_sentences(raw_content)

    if not sentences:

        return ""

    effective_known_names = _collect_story_memory_identity_names(
        player_name=player_name,
        known_character_names=known_character_names,
    )
    required_explicit_names = _extract_story_memory_required_explicit_names(
        raw_content,
        player_name=player_name,
        known_character_names=known_character_names,
    )

    unique_entries: list[tuple[int, str, int]] = []
    sentence_name_mentions: dict[int, list[str]] = {}

    seen_sentences: set[str] = set()

    for index, sentence in enumerate(sentences):

        sentence_key = sentence.casefold()

        if sentence_key in seen_sentences:

            continue

        seen_sentences.add(sentence_key)

        score = _score_story_plot_memory_line(sentence)
        explicit_name_mentions = _extract_story_memory_explicit_name_mentions(
            sentence,
            known_character_names=effective_known_names,
        )
        sentence_name_mentions[index] = explicit_name_mentions
        if explicit_name_mentions:
            score += 5 + min(len(explicit_name_mentions), 2)

        if super_mode:

            # Super-compressed layer keeps dry facts; penalize emotional/dialogue-heavy fragments.

            if re.search(r"[!?]", sentence):

                score -= 2

            if any(token in sentence for token in ('"', "«", "»")):

                score -= 1

        unique_entries.append((index, sentence, score))



    if not unique_entries:

        return ""



    max_lines = STORY_MEMORY_SUPER_MAX_LINES if super_mode else STORY_MEMORY_COMPRESSED_MAX_LINES

    candidate_entries = unique_entries

    if super_mode:

        factual_entries = [

            entry

            for entry in unique_entries

            if sentence_name_mentions.get(entry[0])
            or not re.search(r"[!?]", entry[1])

            and not any(token in entry[1] for token in ('"', "«", "»", "—"))

        ]

        if factual_entries:

            candidate_entries = factual_entries



    ranked_entries = sorted(

        candidate_entries,

        key=lambda item: (-item[2], item[0]),

    )

    selected_entries = _select_story_memory_ranked_entries(

        candidate_entries,

        limit=max(max_lines, 1),

        preserve_opening=not super_mode,

        preserve_latest=True,

        preserve_priority=True,

    )


    # Keep recency signal for compressed layer, but never trim selected sentences.

    if not super_mode and unique_entries:

        latest_index, latest_sentence, _ = unique_entries[-1]

        if all(latest_index != index for index, _, _ in selected_entries):

            if selected_entries:

                selected_entries.sort(key=lambda item: (item[2], -item[0]))

                selected_entries[0] = (

                    latest_index,

                    latest_sentence,

                    _score_story_plot_memory_line(latest_sentence),

                )

            else:

                selected_entries = [(latest_index, latest_sentence, _score_story_plot_memory_line(latest_sentence))]



    if required_explicit_names:
        selected_ids = {int(entry[0]) for entry in selected_entries}
        selected_text = "\n".join(sentence for _, sentence, _ in selected_entries)
        missing_names = [
            name
            for name in required_explicit_names
            if not _story_memory_text_mentions_name(selected_text, name)
        ]
        for missing_name in missing_names:
            candidate_entries_for_name = [
                entry
                for entry in unique_entries
                if _story_memory_text_mentions_name(entry[1], missing_name)
            ]
            if not candidate_entries_for_name:
                continue
            best_entry = sorted(candidate_entries_for_name, key=lambda item: (-item[2], item[0]))[0]
            best_entry_id = int(best_entry[0])
            if best_entry_id in selected_ids:
                continue
            selected_entries.append(best_entry)
            selected_ids.add(best_entry_id)

    ordered_sentences = [sentence for _, sentence, _ in sorted(selected_entries, key=lambda item: item[0])]
    ordered_sentences = _clarify_story_memory_summary_sentences(
        ordered_sentences,
        raw_content=raw_content,
        player_name=player_name,
        known_character_names=known_character_names,
    )

    max_chars = STORY_MEMORY_SUPER_MAX_CHARS if super_mode else STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS

    summary_text = _join_story_memory_sentences_as_prose(ordered_sentences, max_chars=max_chars)
    if required_explicit_names and not _story_memory_text_covers_names(summary_text, required_explicit_names):
        relaxed_max_chars = max(max_chars, len(" ".join(ordered_sentences)) + 8)
        summary_text = _join_story_memory_sentences_as_prose(ordered_sentences, max_chars=relaxed_max_chars)
    return summary_text





def _evaluate_story_turn_memory_signal(

    *,

    latest_user_prompt: str,

    latest_assistant_text: str,

) -> dict[str, int]:

    normalized_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=2_800)

    normalized_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=6_500)

    combined_text = "\n".join(part for part in (normalized_prompt, normalized_assistant) if part).strip()

    sentences = _extract_story_memory_sentences(combined_text)

    if not sentences:

        return {

            "sentence_count": 0,

            "top_score": 0,

            "important_hits": 0,

            "strong_hits": 0,

            "low_signal_hits": 0,

            "has_numeric": 0,

            "prompt_len": len(normalized_prompt),

            "assistant_len": len(normalized_assistant),

        }



    top_score = max(_score_story_plot_memory_line(sentence) for sentence in sentences)

    combined_lower = combined_text.casefold()

    important_hits = sum(1 for token in STORY_PLOT_CARD_MEMORY_IMPORTANT_TOKENS if token in combined_lower)

    strong_hits = sum(1 for token in STORY_MEMORY_KEY_EVENT_STRONG_TOKENS if token in combined_lower)

    low_signal_hits = sum(1 for token in STORY_MEMORY_LOW_SIGNAL_TOKENS if token in combined_lower)

    has_numeric = 1 if re.search(r"\d", combined_text) else 0



    return {

        "sentence_count": len(sentences),

        "top_score": max(top_score, 0),

        "important_hits": max(important_hits, 0),

        "strong_hits": max(strong_hits, 0),

        "low_signal_hits": max(low_signal_hits, 0),

        "has_numeric": has_numeric,

        "prompt_len": len(normalized_prompt),

        "assistant_len": len(normalized_assistant),

    }





def _should_store_story_raw_memory_turn(

    *,

    latest_user_prompt: str,

    latest_assistant_text: str,

) -> bool:

    signal = _evaluate_story_turn_memory_signal(

        latest_user_prompt=latest_user_prompt,

        latest_assistant_text=latest_assistant_text,

    )

    sentence_count = int(signal.get("sentence_count", 0))

    if sentence_count <= 0:

        return False



    top_score = int(signal.get("top_score", 0))

    important_hits = int(signal.get("important_hits", 0))

    strong_hits = int(signal.get("strong_hits", 0))

    low_signal_hits = int(signal.get("low_signal_hits", 0))

    has_numeric = int(signal.get("has_numeric", 0)) > 0

    prompt_len = int(signal.get("prompt_len", 0))

    assistant_len = int(signal.get("assistant_len", 0))



    if strong_hits > 0:

        return True

    if important_hits >= STORY_MEMORY_RAW_MIN_IMPORTANT_HITS:

        return True

    if top_score >= STORY_MEMORY_RAW_MIN_SIGNAL_SCORE:

        return True

    if has_numeric and top_score >= STORY_MEMORY_RAW_MIN_SIGNAL_SCORE - 2:

        return True



    long_or_dense_turn = assistant_len >= 520 or prompt_len >= 320 or sentence_count >= 5

    if long_or_dense_turn and top_score >= STORY_MEMORY_RAW_MIN_SIGNAL_SCORE - 3:

        return True

    if sentence_count >= 3 and top_score >= 4:

        return True



    short_turn = assistant_len < 260 and prompt_len < 180

    if short_turn and low_signal_hits > 0:

        return False

    return False





def _sanitize_story_key_memory_content(raw_content: str) -> str:

    normalized = raw_content.replace("\r\n", "\n").strip()

    if not normalized:

        return ""



    sentence_candidates = _extract_story_memory_sentences(normalized)

    if not sentence_candidates:

        sentence_candidates = [line for line in normalized.split("\n") if line.strip()]



    cleaned_lines: list[str] = []

    seen_lines: set[str] = set()

    for line in sentence_candidates:

        compact = re.sub(r"\s+", " ", line.strip(" -•\t\"'«»")).strip()

        if not compact:

            continue

        compact = re.sub(

            r"^(?:user turn|player turn|narrator reply|assistant reply|ход игрока|ответ рассказчика)\s*:\s*",

            "",

            compact,

            flags=re.IGNORECASE,

        ).strip()

        compact = re.sub(r"^[,.;:()\[\]\-–—]+\s*", "", compact).strip()

        if not compact:

            continue

        if STORY_CJK_CHARACTER_PATTERN.search(compact):

            continue

        if len(STORY_CYRILLIC_LETTER_PATTERN.findall(compact)) < 6:

            continue

        compact_lower = compact.casefold()

        if any(token in compact_lower for token in STORY_MEMORY_KEY_FORBIDDEN_SUBSTRINGS):

            continue

        if len(compact) < 18:

            continue

        if compact[-1] not in ".!?…":

            compact = f"{compact}."

        compact = compact[:1].upper() + compact[1:]

        compact_key = compact.casefold()

        if compact_key in seen_lines:

            continue

        seen_lines.add(compact_key)

        cleaned_lines.append(compact)

        if len(cleaned_lines) >= 2:

            break



    if not cleaned_lines:

        return ""



    normalized_content = "\n".join(cleaned_lines).strip()

    normalized_lower = normalized_content.casefold()

    if any(token in normalized_lower for token in STORY_MEMORY_KEY_FORBIDDEN_SUBSTRINGS):

        return ""



    try:

        normalized_summary = _normalize_story_memory_block_content(normalized_content)

    except HTTPException:

        return ""

    return normalized_summary





def _is_story_key_memory_content_valid(content: str) -> bool:

    normalized = content.replace("\r\n", "\n").strip()

    if not normalized:

        return False

    normalized_lower = normalized.casefold()

    if any(token in normalized_lower for token in STORY_MEMORY_KEY_FORBIDDEN_SUBSTRINGS):

        return False

    if STORY_CJK_CHARACTER_PATTERN.search(normalized):

        return False



    lines = _extract_story_memory_sentences(normalized)

    if not lines:

        return False

    if max(len(line) for line in lines) < 18:

        return False



    top_score = max(_score_story_plot_memory_line(line) for line in lines)

    strong_hits = sum(1 for token in STORY_MEMORY_KEY_EVENT_STRONG_TOKENS if token in normalized_lower)

    if strong_hits > 0:

        return True

    if top_score >= max(STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE - 2, 6):

        return True

    return len(STORY_CYRILLIC_LETTER_PATTERN.findall(normalized)) >= 10


def _build_story_key_memory_candidate_signal(
    *,
    title: str,
    content: str,
) -> dict[str, int]:
    normalized_text = "\n".join(
        part.strip()
        for part in (str(title or "").strip(), str(content or "").strip())
        if str(part or "").strip()
    ).strip()
    lines = _extract_story_memory_sentences(normalized_text)
    normalized_lower = normalized_text.casefold()
    top_score = max((_score_story_plot_memory_line(line) for line in lines), default=0)
    return {
        "line_count": len(lines),
        "top_score": max(top_score, 0),
        "important_hits": sum(1 for token in STORY_PLOT_CARD_MEMORY_IMPORTANT_TOKENS if token in normalized_lower),
        "strong_hits": sum(1 for token in STORY_MEMORY_KEY_EVENT_STRONG_TOKENS if token in normalized_lower),
        "low_signal_hits": sum(1 for token in STORY_MEMORY_LOW_SIGNAL_TOKENS if token in normalized_lower),
    }


_STORY_IMPORTANT_EVENT_FIRST_PERSON_PRONOUN_PATTERN = re.compile(
    r"\b(?:я|мне|меня|мной|мой|моя|моё|мое|мои|мы|нас|нам|нами|наш|наша|наше|наши)\b",
    re.IGNORECASE,
)

_STORY_IMPORTANT_EVENT_FIRST_PERSON_VERB_PATTERN = re.compile(
    r"(?im)(?:^|[.!?…]\s+|\n)(?:[А-ЯЁA-Z][^:\n]{1,40}:\s*)?(?:не\s+)?[а-яё-]{3,}(?:юсь|усь|ю|у|ем|ём|им|емся|ёмся|имся)\b",
    re.IGNORECASE,
)

_STORY_IMPORTANT_EVENT_LOW_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"\b(?:одинок\w*|одиночеств\w*|игнор\w*|уставш\w*|взгляд\w*|тишин\w*|молчани\w*|пауз\w*|вздох\w*|улыб\w*|кивн\w*|настроени\w*|эмоци\w*|смущени\w*|неловк\w*|тоск\w*|печал\w*|груст\w*|апат\w*|задумчив\w*)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:никому\s+не\s+нужн\w*|не\s+привлекая\s+внимани\w*|снова\s+не\s+пош[её]л\s+в\s+столов\w*)",
        re.IGNORECASE,
    ),
)

_STORY_IMPORTANT_EVENT_CHANGE_MARKERS: tuple[str, ...] = (
    "решил",
    "решила",
    "решили",
    "решение",
    "пообещал",
    "пообещала",
    "согласился",
    "согласилась",
    "отказался",
    "отказалась",
    "признал",
    "признала",
    "призналась",
    "раскрыл",
    "раскрыла",
    "узнал",
    "узнала",
    "выяснил",
    "выяснила",
    "договорились",
    "заключил",
    "заключила",
    "предал",
    "предала",
    "нашел",
    "нашла",
    "получил",
    "получила",
    "потерял",
    "потеряла",
    "спас",
    "спасла",
    "погиб",
    "умер",
    "атаковал",
    "атаковала",
    "напал",
    "напала",
    "захватил",
    "захватила",
    "арестовал",
    "арестовала",
    "сбежал",
    "сбежала",
    "отправился",
    "отправилась",
    "вступил",
    "вступила",
    "поклялся",
    "поклялась",
)


def _count_story_important_event_pattern_matches(text: str, patterns: tuple[re.Pattern[str], ...]) -> int:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return 0
    return sum(1 for pattern in patterns if pattern.search(normalized_text))


def _count_story_important_event_change_markers(text: str) -> int:
    normalized_lower = str(text or "").casefold()
    if not normalized_lower:
        return 0
    return sum(1 for token in _STORY_IMPORTANT_EVENT_CHANGE_MARKERS if token in normalized_lower)


def _story_important_event_contains_first_person_perspective(text: str) -> bool:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return False
    return bool(
        _STORY_IMPORTANT_EVENT_FIRST_PERSON_PRONOUN_PATTERN.search(normalized_text)
        or _STORY_IMPORTANT_EVENT_FIRST_PERSON_VERB_PATTERN.search(normalized_text)
    )


def _is_story_important_event_obviously_low_value(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    title: str,
    content: str,
    turn_important_hits: int,
    turn_strong_hits: int,
    candidate_important_hits: int,
    candidate_strong_hits: int,
    candidate_top_score: int,
) -> bool:
    candidate_text = "\n".join(
        part.strip()
        for part in (str(title or "").strip(), str(content or "").strip())
        if part and str(part).strip()
    ).strip()
    turn_text = "\n".join(
        part.strip()
        for part in (str(latest_user_prompt or "").strip(), str(latest_assistant_text or "").strip())
        if part and str(part).strip()
    ).strip()
    if not candidate_text:
        return True

    candidate_low_value_hits = _count_story_important_event_pattern_matches(
        candidate_text,
        _STORY_IMPORTANT_EVENT_LOW_VALUE_PATTERNS,
    )
    turn_low_value_hits = _count_story_important_event_pattern_matches(
        turn_text,
        _STORY_IMPORTANT_EVENT_LOW_VALUE_PATTERNS,
    )
    candidate_change_hits = _count_story_important_event_change_markers(candidate_text)
    turn_change_hits = _count_story_important_event_change_markers(turn_text)
    candidate_first_person = _story_important_event_contains_first_person_perspective(content)

    if candidate_first_person and candidate_change_hits <= 0 and candidate_strong_hits <= 0:
        return True

    if (
        candidate_low_value_hits > 0
        and candidate_change_hits <= 0
        and candidate_strong_hits <= 0
        and candidate_important_hits <= 1
        and candidate_top_score < max(STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE + 3, 10)
    ):
        return True

    if (
        candidate_low_value_hits > 0
        and turn_low_value_hits > 0
        and candidate_change_hits <= 0
        and turn_change_hits <= 0
        and turn_strong_hits <= 0
        and candidate_strong_hits <= 0
        and turn_important_hits <= 1
        and candidate_important_hits <= 1
    ):
        return True

    return False


def _should_accept_story_important_event_candidate(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
    title: str,
    content: str,
    importance_score: int,
) -> bool:
    if importance_score < STORY_MEMORY_KEY_EVENT_MIN_IMPORTANCE_SCORE:
        return False

    turn_signal = _evaluate_story_turn_memory_signal(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    if int(turn_signal.get("sentence_count", 0)) <= 0:
        return False

    candidate_signal = _build_story_key_memory_candidate_signal(title=title, content=content)
    turn_top_score = int(turn_signal.get("top_score", 0))
    turn_important_hits = int(turn_signal.get("important_hits", 0))
    turn_strong_hits = int(turn_signal.get("strong_hits", 0))
    turn_low_signal_hits = int(turn_signal.get("low_signal_hits", 0))
    candidate_top_score = int(candidate_signal.get("top_score", 0))
    candidate_important_hits = int(candidate_signal.get("important_hits", 0))
    candidate_strong_hits = int(candidate_signal.get("strong_hits", 0))
    candidate_low_signal_hits = int(candidate_signal.get("low_signal_hits", 0))

    if _is_story_important_event_obviously_low_value(
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        title=title,
        content=content,
        turn_important_hits=turn_important_hits,
        turn_strong_hits=turn_strong_hits,
        candidate_important_hits=candidate_important_hits,
        candidate_strong_hits=candidate_strong_hits,
        candidate_top_score=candidate_top_score,
    ):
        return False

    if (
        turn_low_signal_hits > 0
        and turn_important_hits <= 0
        and turn_strong_hits <= 0
        and turn_top_score < STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE
        and importance_score < 92
    ):
        return False

    if (
        candidate_low_signal_hits > 0
        and candidate_important_hits <= 0
        and candidate_strong_hits <= 0
        and candidate_top_score < max(STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE + 1, 8)
    ):
        return False

    if turn_strong_hits > 0 or candidate_strong_hits > 0:
        return True

    if turn_important_hits > 0 and candidate_important_hits > 0:
        return turn_top_score >= max(STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE, STORY_MEMORY_RAW_MIN_SIGNAL_SCORE)

    if importance_score >= 92:
        return candidate_top_score >= max(STORY_MEMORY_KEY_EVENT_MIN_LINE_SCORE + 1, 8)

    return False


def _extract_story_important_plot_card_payload_locally(
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> tuple[str, str] | None:
    normalized_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=2_800)
    normalized_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=6_500)
    if not normalized_prompt and not normalized_assistant:
        return None

    signal = _evaluate_story_turn_memory_signal(
        latest_user_prompt=normalized_prompt,
        latest_assistant_text=normalized_assistant,
    )
    sentence_count = int(signal.get("sentence_count", 0))
    top_score = int(signal.get("top_score", 0))
    important_hits = int(signal.get("important_hits", 0))
    strong_hits = int(signal.get("strong_hits", 0))
    should_promote = (
        strong_hits > 0
        or (important_hits > 0 and top_score >= max(STORY_MEMORY_RAW_MIN_SIGNAL_SCORE, 6))
    )
    if not should_promote:
        return None

    combined_text = "\n".join(
        part
        for part in (
            f"Player turn: {normalized_prompt}" if normalized_prompt else "",
            f"Narrator reply: {normalized_assistant}" if normalized_assistant else "",
        )
        if part
    ).strip()
    if not combined_text:
        return None

    summary = _build_story_memory_summary_without_truncation(combined_text, super_mode=True)
    content = _sanitize_story_key_memory_content(summary or combined_text)
    if not content or not _is_story_key_memory_content_valid(content):
        return None
    if len(content) < 30:
        return None

    derived_importance_score = (
        94
        if strong_hits > 0
        else max(
            STORY_MEMORY_KEY_EVENT_MIN_IMPORTANCE_SCORE,
            min(91, 72 + top_score * 3 + important_hits * 4),
        )
    )

    title = _normalize_story_memory_block_title(
        f"Важно: {_derive_story_plot_card_title_from_content(content)}",
        fallback="Важно: Важное событие",
    )
    if not _should_accept_story_important_event_candidate(
        latest_user_prompt=normalized_prompt,
        latest_assistant_text=normalized_assistant,
        title=title,
        content=content,
        importance_score=derived_importance_score,
    ):
        return None
    return (title, content)





def _compress_story_memory_block_locally(

    raw_content: str,

    *,

    super_mode: bool,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,

) -> tuple[str, str]:

    compressed = _build_story_memory_summary_without_truncation(

        raw_content,

        super_mode=super_mode,
        player_name=player_name,
        known_character_names=known_character_names,

    )

    if not compressed:

        fallback_sentences = _extract_story_memory_sentences(raw_content)

        if fallback_sentences:

            max_lines = STORY_MEMORY_SUPER_MAX_LINES if super_mode else STORY_MEMORY_COMPRESSED_MAX_LINES

            max_chars = STORY_MEMORY_SUPER_MAX_CHARS if super_mode else STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS

            compressed = _join_story_memory_sentences_as_prose(

                fallback_sentences[: max(max_lines, 1)],

                max_chars=max_chars,

            ).strip()

        else:

            compressed = "Существенных фактов не выделено."

    fallback_prefix = "Суперсжатая память" if super_mode else "Сжатая память"

    title = _build_story_memory_block_title(compressed, fallback_prefix=fallback_prefix)

    return (title, compressed)





def _compress_story_memory_block_with_model(

    *,

    raw_content: str,

    model_name: str,

    fallback_model_names: list[str],

    super_mode: bool,
    player_name: str | None = None,
    known_character_names: list[str] | None = None,

    allow_local_fallback: bool = True,

    max_attempts: int = 2,

) -> tuple[str, str]:

    normalized_raw_content = raw_content.replace("\r\n", "\n").strip()
    memory_identity_names = _collect_story_memory_identity_names(
        player_name=player_name,
        known_character_names=known_character_names,
    )
    source_required_names = _extract_story_memory_required_explicit_names(
        normalized_raw_content,
        player_name=player_name,
        known_character_names=known_character_names,
    )

    if not normalized_raw_content:

        return _compress_story_memory_block_locally(
            raw_content,
            super_mode=super_mode,
            player_name=player_name,
            known_character_names=known_character_names,
        )

    if not settings.openrouter_api_key:

        if allow_local_fallback:

            return _compress_story_memory_block_locally(
                raw_content,
                super_mode=super_mode,
                player_name=player_name,
                known_character_names=known_character_names,
            )

        raise RuntimeError("Story memory compression model is unavailable")

    def _is_model_compression_output_usable(source_text: str, compressed_text: str) -> bool:
        source_sentences = _extract_story_memory_sentences(source_text)
        output_sentences = _extract_story_memory_sentences(compressed_text)
        if not output_sentences:
            return False
        if not source_sentences:
            return True

        normalized_output = " ".join(output_sentences).casefold()
        if "существенных фактов не выделено" in normalized_output:
            return False
        if source_required_names and not _story_memory_text_covers_names(compressed_text, source_required_names):
            return False

        source_tokens = {
            token
            for token in re.findall(
                r"[0-9A-Za-zА-Яа-яЁё_]{4,}",
                " ".join(source_sentences).casefold(),
            )
            if token
            not in {
                "игрок",
                "игрока",
                "ответ",
                "мастера",
                "рассказчика",
                "сухие",
                "факты",
                "краткий",
                "пересказ",
            }
        }
        if not source_tokens:
            return True

        output_tokens = set(re.findall(r"[0-9A-Za-zА-Яа-яЁё_]{4,}", normalized_output))
        return bool(source_tokens.intersection(output_tokens))



    target_description = (
        "Перескажи максимально коротко: сохрани суть, важнейшие факты, прямые последствия и все явно названные имена, убери только второстепенные детали."
        if super_mode
        else "Перескажи короче и суше своими словами: сохрани ключевые факты, последствия, опорный контекст и все явно названные имена, но убери лишние подробности."
    )
    messages_payload = [

        {

            "role": "system",

            "content": (

                "Ты аккуратно сжимаешь блоки памяти для текстовой RPG. "

                "Пиши только на русском. "

                "Не используй списки, буллеты, markdown, заголовки или кавычки. "

                "Ничего не выдумывай и не добавляй от себя. "

                "Сохраняй смысл и общий стиль исходного текста, но убирай лишние подробности. "

                "CRITICAL NAME RULE: if the source explicitly names a character, hero, NPC, speaker, creature, or other named entity, keep that exact name in the compressed memory. "
                "Never replace an explicit name with a pronoun or a generic role like player, hero, he, she, they, man, woman, girl, guy, stranger, companion, or NPC. "
                "If the main hero has an explicit name, use that exact name instead of 'игрок', 'герой', or 'ты' whenever the reference is unambiguous. "
                "If multiple named characters appear in one event, do not merge them into 'they' and do not drop who exactly acted, spoke, suffered, promised, decided, or was targeted. "
                "HARD VALIDATION RULE: if even one explicit name from the source disappears in the compressed result, that result is invalid. "
                "Before you finish, verify that every explicit name from the source block is still present in the final compressed text. "
                + (
                    "Known continuity names that must stay exact when present in the source: "
                    + ", ".join(repr(name) for name in memory_identity_names)
                    + ". "
                    if memory_identity_names
                    else ""
                )
                + (
                    "Exact explicit names found in this source block and mandatory to preserve: "
                    + ", ".join(repr(name) for name in source_required_names)
                    + ". "
                    if source_required_names
                    else ""
                )

                + "КРИТИЧЕСКОЕ ПРАВИЛО: в сжатой памяти всегда должно быть ясно, кто именно что сделал или сказал. "

                "Если из исходника субъект назван явно, сохраняй именно это имя, роль или сущность. "
                "Если местоимение он, она, его, ее, ему, ей или они однозначно указывает на уже названного персонажа или героя игрока, замени местоимение на точное имя из исходника. "

                "Если местоимение или ссылка в исходнике не раскрыты однозначно, не выдумывай нового человека или сущность вроде 'женщина', 'мужчина', 'девушка', 'охранник', 'незнакомец'. "

                "В таком случае лучше сохрани осторожную формулировку без домысливания, чем подставляй неверный субъект. "

                "Никогда не превращай болезнь, существо, демона, предмет, еду, место или абстрактный объект в человека только ради ясности. "

                "Не меняй конкретную сущность на похожую или более общую: картошка не становится кашей, демоны не становятся людьми."

            ),

        },

        {

            "role": "user",

            "content": (

                f"{target_description}\n"

                "Keep concrete continuity facts even if they seem mundane: employer, task, contract, order, duty, named location, and scene-state facts such as empty, quiet, noisy, crowded, closed, or abandoned.\n"
                + (
                    f"Known names that must stay exact if mentioned:\n{json.dumps(memory_identity_names, ensure_ascii=False)}\n"
                    if memory_identity_names
                    else ""
                )
                + (
                    f"Exact explicit names from this source block that must not disappear:\n{json.dumps(source_required_names, ensure_ascii=False)}\n"
                    if source_required_names
                    else ""
                )
                + "Сохрани явные субъекты, объекты действия и говорящих.\n"

                "Верни только готовый сжатый текст без пояснений.\n\n"

                f"Исходный блок памяти:\n{normalized_raw_content}"

            ),

        },

    ]



    normalized_max_attempts = max(int(max_attempts or 0), 1)

    for attempt_index in range(normalized_max_attempts):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=model_name,

                allow_free_fallback=False,

                translate_input=False,

                fallback_model_names=fallback_model_names,

                temperature=0.15 if super_mode else 0.2,

                max_tokens=STORY_MEMORY_COMPRESSION_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Story memory compression request failed on attempt %s/%s: %s",

                attempt_index + 1,

                normalized_max_attempts,

                exc,

            )

            if attempt_index + 1 < normalized_max_attempts:

                time.sleep(0.2)

                continue

            if allow_local_fallback:

                return _compress_story_memory_block_locally(
                    raw_content,
                    super_mode=super_mode,
                    player_name=player_name,
                    known_character_names=known_character_names,
                )

            raise RuntimeError("Story memory compression request failed") from exc



        normalized_response = _normalize_story_prompt_text(

            raw_response,

            max_chars=STORY_MEMORY_SUPER_MAX_CHARS if super_mode else STORY_PLOT_CARD_MEMORY_TARGET_MAX_CHARS,

        )

        normalized_response = re.sub(r"^\s*[-•]+\s*", "", normalized_response).strip()

        if normalized_response:

            normalized_response = _normalize_story_memory_block_content(normalized_response)

            if not _is_model_compression_output_usable(normalized_raw_content, normalized_response):
                logger.warning(
                    "Story memory compression returned unusable model payload on attempt %s/%s",
                    attempt_index + 1,
                    normalized_max_attempts,
                )
                if attempt_index + 1 < normalized_max_attempts:
                    time.sleep(0.15)
                    continue
                if allow_local_fallback:
                    return _compress_story_memory_block_locally(
                        raw_content,
                        super_mode=super_mode,
                        player_name=player_name,
                        known_character_names=known_character_names,
                    )
                raise RuntimeError("Story memory compression returned unusable model payload")

            title = _build_story_memory_block_title(

                normalized_response,

                fallback_prefix="Суперсжатая память" if super_mode else "Сжатая память",

            )

            return (title, normalized_response)



        if attempt_index + 1 < normalized_max_attempts:

            time.sleep(0.15)



    if allow_local_fallback:

        return _compress_story_memory_block_locally(
            raw_content,
            super_mode=super_mode,
            player_name=player_name,
            known_character_names=known_character_names,
        )

    raise RuntimeError("Story memory compression returned empty model payload")





def _rebalance_story_memory_layers(

    *,

    db: Session,

    game: StoryGame,

    max_model_requests: int | None = None,

    require_model_compaction: bool = False,

    backfill_existing_compact_layers: bool = True,

    prioritize_recent_transitions: bool = False,

    commit_each_model_compaction: bool = False,

) -> None:
    def _safe_int(value: Any, *, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return default

    raw_before = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
        ]
    )
    compressed_before = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_COMPRESSED
        ]
    )
    super_before = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_SUPER
        ]
    )

    raw_keep_limit = max(int(STORY_MEMORY_RAW_KEEP_LATEST_ASSISTANT_FULL_TURNS or 0), 1)
    compressed_keep_recent_limit = max(raw_keep_limit * 2, 4)
    context_limit_tokens = _normalize_story_context_limit_chars(game.context_limit_chars)
    effective_memory_budget_tokens = max(context_limit_tokens, 1)
    budgets = _build_story_memory_layer_budgets(
        effective_memory_budget_tokens,
        optimization_mode=getattr(game, "memory_optimization_mode", None),
    )
    latest_raw_assistant_ids = {
        normalized_message_id
        for normalized_message_id in (
            _safe_int(message_id)
            for message_id in _list_story_latest_assistant_message_ids(
                db,
                game.id,
                limit=raw_keep_limit,
            )
        )
        if normalized_message_id > 0
    }
    model_name = _resolve_story_plot_memory_model_name()
    fallback_model_names = _resolve_story_plot_memory_fallback_models(model_name)
    normalized_max_model_requests = (
        None
        if max_model_requests is None
        else max(int(max_model_requests or 0), 0)
    )
    model_requests_used = 0
    failed_raw_block_ids: set[int] = set()
    failed_compressed_block_ids: set[int] = set()

    logger.info(
        "Story memory rebalance started: game_id=%s raw_before=%s compressed_before=%s super_before=%s raw_keep_limit=%s compressed_keep_limit=%s latest_raw_ids=%s",
        game.id,
        raw_before,
        compressed_before,
        super_before,
        raw_keep_limit,
        compressed_keep_recent_limit,
        ",".join(str(item) for item in sorted(latest_raw_assistant_ids)) or "none",
    )
    main_hero_name_for_memory = _get_story_main_hero_name_for_memory(db, game_id=game.id)
    known_character_names_for_memory = _list_story_known_character_names_for_memory(
        db,
        game_id=game.id,
        player_turn_label=main_hero_name_for_memory,
    )

    def _layer_order_key(block: StoryMemoryBlock) -> tuple[int, int]:
        assistant_message_id = _safe_int(getattr(block, "assistant_message_id", 0))
        block_id = _safe_int(getattr(block, "id", 0))
        if assistant_message_id > 0:
            return (assistant_message_id, block_id)
        return (1_000_000_000 + block_id, block_id)

    def _layer_blocks(layer: str) -> list[StoryMemoryBlock]:
        normalized_layer = _normalize_story_memory_layer(layer)
        blocks = [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == normalized_layer
        ]
        return sorted(blocks, key=_layer_order_key)

    def _layer_tokens(layer: str) -> int:
        return sum(_estimate_story_memory_block_tokens(block) for block in _layer_blocks(layer))

    def _budgeted_memory_blocks() -> list[StoryMemoryBlock]:
        return [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer)
            not in {STORY_MEMORY_LAYER_LOCATION, STORY_MEMORY_LAYER_WEATHER}
        ]

    def _total_budgeted_tokens() -> int:
        return sum(_estimate_story_memory_block_tokens(block) for block in _budgeted_memory_blocks())

    def _looks_like_uncompressed_block(value: str) -> bool:
        normalized = str(value or "").replace("\r\n", "\n").strip()
        if not normalized:
            return False
        lowered = normalized.casefold()
        has_full_text = "full text" in lowered or "полный текст" in lowered
        has_turn = any(
            marker in lowered
            for marker in (
                "player turn",
                "user turn",
                "ход игрока",
            )
        )
        has_reply = any(
            marker in lowered
            for marker in (
                "narrator reply",
                "assistant reply",
                "ответ мастера",
                "ответ рассказчика",
            )
        )
        labeled_sections = len(re.findall(r"(?im)^\s*[^:\n]{1,80}:\s*", normalized))
        return has_full_text or (has_turn and has_reply) or labeled_sections >= 2

    def _prepare_compaction_content(raw_value: str) -> str:
        normalized = str(raw_value or "").replace("\r\n", "\n").strip()
        if not normalized:
            return ""
        normalized = STORY_MARKUP_MARKER_PATTERN.sub(" ", normalized)
        normalized = re.sub(r"\[\[[^\]]*$", " ", normalized)
        normalized = re.sub(
            (
                r"(?im)^\s*(?:"
                r"player turn|user turn|narrator reply|assistant reply|"
                r"ход игрока|ответ мастера|ответ рассказчика"
                r")[^:\n]{0,120}:\s*"
            ),
            "",
            normalized,
        )
        normalized = re.sub(
            r"(?im)\(\s*(?:full\s+text|short\s+summary|полный\s+текст|краткий\s+пересказ|сухие\s+факты)\s*\)",
            "",
            normalized,
        )
        normalized = re.sub(r"[ \t]+\n", "\n", normalized)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized.strip()

    def _sanitize_compact_layers() -> None:
        changed = False
        for layer_value in (STORY_MEMORY_LAYER_COMPRESSED, STORY_MEMORY_LAYER_SUPER):
            super_mode = layer_value == STORY_MEMORY_LAYER_SUPER
            for block in _layer_blocks(layer_value):
                original_title = str(getattr(block, "title", "") or "")
                original_content = str(getattr(block, "content", "") or "")
                if not (
                    _looks_like_uncompressed_block(original_title)
                    or _looks_like_uncompressed_block(original_content)
                ):
                    continue
                prepared_content = _prepare_compaction_content(original_content)
                if not prepared_content:
                    continue
                compact_title, compact_content = _compress_story_memory_block_locally(
                    prepared_content,
                    super_mode=super_mode,
                    player_name=main_hero_name_for_memory,
                    known_character_names=known_character_names_for_memory,
                )
                normalized_content = _normalize_story_memory_block_content(compact_content)
                next_token_count = max(_estimate_story_tokens(normalized_content), 1)
                if str(getattr(block, "title", "") or "") != compact_title:
                    block.title = compact_title
                    changed = True
                if str(getattr(block, "content", "") or "") != normalized_content:
                    block.content = normalized_content
                    changed = True
                if int(getattr(block, "token_count", 0) or 0) != next_token_count:
                    block.token_count = next_token_count
                    changed = True
        if changed:
            db.flush()

    def _cleanup_low_value_key_memory_blocks() -> None:
        changed = False
        for block in _layer_blocks(STORY_MEMORY_LAYER_KEY):
            normalized_title = str(getattr(block, "title", "") or "").strip()
            normalized_content = str(getattr(block, "content", "") or "").strip()
            if not normalized_content:
                db.delete(block)
                changed = True
                continue
            candidate_signal = _build_story_key_memory_candidate_signal(
                title=normalized_title,
                content=normalized_content,
            )
            if _is_story_important_event_obviously_low_value(
                latest_user_prompt="",
                latest_assistant_text="",
                title=normalized_title,
                content=normalized_content,
                turn_important_hits=0,
                turn_strong_hits=0,
                candidate_important_hits=int(candidate_signal.get("important_hits", 0)),
                candidate_strong_hits=int(candidate_signal.get("strong_hits", 0)),
                candidate_top_score=int(candidate_signal.get("top_score", 0)),
            ):
                db.delete(block)
                changed = True
        if changed:
            db.flush()

    def _compact_raw_block(block: StoryMemoryBlock) -> bool:
        nonlocal model_requests_used
        source_block_id = _safe_int(getattr(block, "id", 0))
        source_assistant_message_id = _safe_int(getattr(block, "assistant_message_id", 0))
        prepared_content = _prepare_compaction_content(str(getattr(block, "content", "") or ""))
        if not prepared_content:
            try:
                with db.begin_nested():
                    current_block = db.get(StoryMemoryBlock, source_block_id)
                    if current_block is None:
                        return True
                    db.delete(current_block)
                    db.flush()
                if commit_each_model_compaction:
                    db.commit()
                return True
            except Exception as exc:
                logger.warning(
                    "Story raw cleanup failed: game_id=%s source_block_id=%s error=%s",
                    game.id,
                    source_block_id,
                    exc,
                )
                return False
        try:
            model_allowed = (
                normalized_max_model_requests is None
                or model_requests_used < normalized_max_model_requests
            )
            if model_allowed:
                model_requests_used += 1
                try:
                    compressed_title, compressed_content = _compress_story_memory_block_with_model(
                        raw_content=prepared_content,
                        model_name=model_name,
                        fallback_model_names=fallback_model_names,
                        super_mode=False,
                        player_name=main_hero_name_for_memory,
                        known_character_names=known_character_names_for_memory,
                        allow_local_fallback=not require_model_compaction,
                        max_attempts=1 if require_model_compaction else 2,
                    )
                except Exception:
                    if require_model_compaction:
                        raise
                    compressed_title, compressed_content = _compress_story_memory_block_locally(
                        prepared_content,
                        super_mode=False,
                        player_name=main_hero_name_for_memory,
                        known_character_names=known_character_names_for_memory,
                    )
            else:
                if require_model_compaction:
                    raise RuntimeError("Story memory compaction model request budget exhausted")
                compressed_title, compressed_content = _compress_story_memory_block_locally(
                    prepared_content,
                    super_mode=False,
                    player_name=main_hero_name_for_memory,
                    known_character_names=known_character_names_for_memory,
                )
            with db.begin_nested():
                current_block = db.get(StoryMemoryBlock, source_block_id)
                if current_block is None:
                    return True
                _create_story_memory_block(
                    db=db,
                    game_id=game.id,
                    assistant_message_id=source_assistant_message_id or current_block.assistant_message_id,
                    layer=STORY_MEMORY_LAYER_COMPRESSED,
                    title=compressed_title,
                    content=compressed_content,
                )
                db.delete(current_block)
                db.flush()
            if commit_each_model_compaction:
                db.commit()
            return True
        except Exception as exc:
            logger.warning(
                "Story raw->compressed compaction failed: game_id=%s source_block_id=%s error=%s",
                game.id,
                source_block_id,
                exc,
            )
            return False

    def _compact_compressed_block(block: StoryMemoryBlock) -> bool:
        nonlocal model_requests_used
        source_block_id = _safe_int(getattr(block, "id", 0))
        source_assistant_message_id = _safe_int(getattr(block, "assistant_message_id", 0))
        prepared_content = _prepare_compaction_content(str(getattr(block, "content", "") or ""))
        if not prepared_content:
            try:
                with db.begin_nested():
                    current_block = db.get(StoryMemoryBlock, source_block_id)
                    if current_block is None:
                        return True
                    db.delete(current_block)
                    db.flush()
                if commit_each_model_compaction:
                    db.commit()
                return True
            except Exception as exc:
                logger.warning(
                    "Story compressed cleanup failed: game_id=%s source_block_id=%s error=%s",
                    game.id,
                    source_block_id,
                    exc,
                )
                return False
        try:
            model_allowed = (
                normalized_max_model_requests is None
                or model_requests_used < normalized_max_model_requests
            )
            if model_allowed:
                model_requests_used += 1
                try:
                    super_title, super_content = _compress_story_memory_block_with_model(
                        raw_content=prepared_content,
                        model_name=model_name,
                        fallback_model_names=fallback_model_names,
                        super_mode=True,
                        player_name=main_hero_name_for_memory,
                        known_character_names=known_character_names_for_memory,
                        allow_local_fallback=not require_model_compaction,
                        max_attempts=1 if require_model_compaction else 2,
                    )
                except Exception:
                    if require_model_compaction:
                        raise
                    super_title, super_content = _compress_story_memory_block_locally(
                        prepared_content,
                        super_mode=True,
                        player_name=main_hero_name_for_memory,
                        known_character_names=known_character_names_for_memory,
                    )
            else:
                if require_model_compaction:
                    raise RuntimeError("Story memory super-compaction model request budget exhausted")
                super_title, super_content = _compress_story_memory_block_locally(
                    prepared_content,
                    super_mode=True,
                    player_name=main_hero_name_for_memory,
                    known_character_names=known_character_names_for_memory,
                )
            with db.begin_nested():
                current_block = db.get(StoryMemoryBlock, source_block_id)
                if current_block is None:
                    return True
                _create_story_memory_block(
                    db=db,
                    game_id=game.id,
                    assistant_message_id=source_assistant_message_id or current_block.assistant_message_id,
                    layer=STORY_MEMORY_LAYER_SUPER,
                    title=super_title,
                    content=super_content,
                )
                db.delete(current_block)
                db.flush()
            if commit_each_model_compaction:
                db.commit()
            return True
        except Exception as exc:
            logger.warning(
                "Story compressed->super compaction failed: game_id=%s source_block_id=%s error=%s",
                game.id,
                source_block_id,
                exc,
            )
            return False

    def _compact_first_viable_raw(candidates: list[StoryMemoryBlock]) -> bool:
        ordered_candidates = sorted(candidates, key=_layer_order_key, reverse=prioritize_recent_transitions)
        for candidate in ordered_candidates:
            candidate_id = _safe_int(getattr(candidate, "id", 0))
            if candidate_id > 0 and candidate_id in failed_raw_block_ids:
                continue
            if _compact_raw_block(candidate):
                failed_raw_block_ids.discard(candidate_id)
                return True
            if candidate_id > 0:
                failed_raw_block_ids.add(candidate_id)
        return False

    def _compact_first_viable_compressed(candidates: list[StoryMemoryBlock]) -> bool:
        ordered_candidates = sorted(candidates, key=_layer_order_key, reverse=prioritize_recent_transitions)
        for candidate in ordered_candidates:
            candidate_id = _safe_int(getattr(candidate, "id", 0))
            if candidate_id > 0 and candidate_id in failed_compressed_block_ids:
                continue
            if _compact_compressed_block(candidate):
                failed_compressed_block_ids.discard(candidate_id)
                return True
            if candidate_id > 0:
                failed_compressed_block_ids.add(candidate_id)
        return False

    def _raw_compaction_candidates(*, include_protected: bool) -> list[StoryMemoryBlock]:
        raw_blocks = _layer_blocks(STORY_MEMORY_LAYER_RAW)
        if not raw_blocks:
            return []
        raw_budget_tokens = max(int(budgets.get(STORY_MEMORY_LAYER_RAW, 0) or 0), 1)
        raw_tokens = _layer_tokens(STORY_MEMORY_LAYER_RAW)
        raw_over_budget = raw_tokens > raw_budget_tokens
        stale_blocks = [
            block
            for block in raw_blocks
            if _safe_int(getattr(block, "assistant_message_id", 0)) not in latest_raw_assistant_ids
        ]
        if stale_blocks and raw_over_budget:
            return sorted(stale_blocks, key=_layer_order_key, reverse=prioritize_recent_transitions)
        if include_protected and len(raw_blocks) > 1 and raw_over_budget:
            protected_candidates = raw_blocks[:-1]
            return sorted(protected_candidates, key=_layer_order_key, reverse=prioritize_recent_transitions)
        return []

    def _dedupe_layer_by_assistant_message_id(layer_value: str) -> bool:
        grouped_blocks: dict[int, list[StoryMemoryBlock]] = {}
        for memory_block in _layer_blocks(layer_value):
            assistant_message_id = _safe_int(getattr(memory_block, "assistant_message_id", 0))
            if assistant_message_id <= 0:
                continue
            grouped_blocks.setdefault(assistant_message_id, []).append(memory_block)

        changed = False
        for grouped_layer_blocks in grouped_blocks.values():
            if len(grouped_layer_blocks) <= 1:
                continue
            for duplicate_block in grouped_layer_blocks[:-1]:
                db.delete(duplicate_block)
                changed = True

        if changed:
            db.flush()
        return changed

    if backfill_existing_compact_layers:
        _sanitize_compact_layers()

    _cleanup_low_value_key_memory_blocks()

    _dedupe_layer_by_assistant_message_id(STORY_MEMORY_LAYER_COMPRESSED)
    _dedupe_layer_by_assistant_message_id(STORY_MEMORY_LAYER_SUPER)

    while True:
        grouped_raw_blocks: dict[int, list[StoryMemoryBlock]] = {}
        for raw_block in _layer_blocks(STORY_MEMORY_LAYER_RAW):
            grouped_raw_blocks.setdefault(_safe_int(getattr(raw_block, "assistant_message_id", 0)), []).append(raw_block)
        duplicate_raw_blocks: list[StoryMemoryBlock] = []
        for grouped_blocks in grouped_raw_blocks.values():
            if len(grouped_blocks) <= 1:
                continue
            duplicate_raw_blocks.extend(grouped_blocks[:-1])
        if not duplicate_raw_blocks:
            break
        if not _compact_first_viable_raw(duplicate_raw_blocks):
            break

    while True:
        stale_raw_blocks = _raw_compaction_candidates(include_protected=False)
        if not stale_raw_blocks:
            break
        if not _compact_first_viable_raw(stale_raw_blocks):
            break

    while len(_layer_blocks(STORY_MEMORY_LAYER_RAW)) > raw_keep_limit:
        forced_raw_blocks = _raw_compaction_candidates(include_protected=True)
        if not forced_raw_blocks:
            break
        if not _compact_first_viable_raw(forced_raw_blocks):
            break

    while _layer_tokens(STORY_MEMORY_LAYER_RAW) > budgets[STORY_MEMORY_LAYER_RAW]:
        budget_raw_blocks = _raw_compaction_candidates(include_protected=True)
        if not budget_raw_blocks:
            break
        if not _compact_first_viable_raw(budget_raw_blocks):
            break

    while len(_layer_blocks(STORY_MEMORY_LAYER_COMPRESSED)) > compressed_keep_recent_limit:
        if not _compact_first_viable_compressed(_layer_blocks(STORY_MEMORY_LAYER_COMPRESSED)):
            break

    while _layer_tokens(STORY_MEMORY_LAYER_COMPRESSED) > budgets[STORY_MEMORY_LAYER_COMPRESSED]:
        if not _compact_first_viable_compressed(_layer_blocks(STORY_MEMORY_LAYER_COMPRESSED)):
            break

    while _total_budgeted_tokens() > effective_memory_budget_tokens:
        if _compact_first_viable_compressed(_layer_blocks(STORY_MEMORY_LAYER_COMPRESSED)):
            continue
        if _compact_first_viable_raw(_raw_compaction_candidates(include_protected=True)):
            continue
        removable_blocks = _budgeted_memory_blocks()
        if not removable_blocks:
            break
        removal_candidate: StoryMemoryBlock | None = None
        for layer in (
            STORY_MEMORY_LAYER_SUPER,
            STORY_MEMORY_LAYER_COMPRESSED,
            STORY_MEMORY_LAYER_RAW,
            STORY_MEMORY_LAYER_KEY,
        ):
            layer_blocks = [
                block
                for block in removable_blocks
                if _normalize_story_memory_layer(block.layer) == layer
            ]
            if not layer_blocks:
                continue
            if layer == STORY_MEMORY_LAYER_RAW:
                layer_blocks = _raw_compaction_candidates(include_protected=True)
                if not layer_blocks:
                    continue
            removal_candidate = layer_blocks[0]
            break
        if removal_candidate is None:
            break
        db.delete(removal_candidate)
        db.flush()

    raw_after = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_RAW
        ]
    )
    compressed_after = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_COMPRESSED
        ]
    )
    super_after = len(
        [
            block
            for block in _list_story_memory_blocks(db, game.id)
            if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_SUPER
        ]
    )
    if (raw_before, compressed_before, super_before) != (raw_after, compressed_after, super_after):
        logger.info(
            "Story memory rebalance changed layers: game_id=%s raw %s->%s compressed %s->%s super %s->%s",
            game.id,
            raw_before,
            raw_after,
            compressed_before,
            compressed_after,
            super_before,
            super_after,
        )

def _extract_story_important_plot_card_payload(

    *,

    latest_user_prompt: str,

    latest_assistant_text: str,

) -> tuple[str, str] | None:

    normalized_prompt = _normalize_story_prompt_text(latest_user_prompt, max_chars=2_800)

    normalized_assistant = _normalize_story_prompt_text(latest_assistant_text, max_chars=6_500)

    if not normalized_prompt and not normalized_assistant:

        return None



    if not settings.openrouter_api_key:

        return None



    model_name = _resolve_story_plot_memory_model_name()

    fallback_model_names = _resolve_story_plot_memory_fallback_models(model_name)

    messages_payload = [

        {

            "role": "system",

            "content": (

                "Analyze exactly one RPG turn and decide whether there is an important long-term plot event. "

                "Return strict JSON only, without markdown: "

                "{\"is_important\": boolean, \"importance_score\": number, \"title\": string, \"content\": string}. "

                "importance_score must be in range 0..100. "

                "Set is_important=true for meaningful events with likely consequences in future turns. "

                "Do not mark routine actions, atmosphere, small emotions, ordinary dialogue, or cosmetic details. "

                "Do not mark silence, a short reaction, or a vivid phrase unless they create a clear long-term consequence. "
                "Do not mark self-description, mood, loneliness, a tired look, skipping lunch, or one ordinary social remark unless they create a new lasting consequence. "

                "title must be a short Russian event label without generic phrases like \"Важный момент\". "

                "Assume the final memory title will start with \"Важно:\" and keep only the core event essence. "

                "content must be 1-2 short factual Russian sentences in past tense, "

                "with concrete actor+event wording and no bullet list. "

                "Never write in first person. "

                "Always write in third person and explicitly name key actors whenever their names are present in the turn."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Player turn:\n{normalized_prompt or 'none'}\n\n"

                f"Narrator reply:\n{normalized_assistant or 'none'}\n\n"

                "Treat as important events like: major irreversible outcomes, a decisive choice or commitment, "

                "new long-term goal/obligation, key secret revealed, critical alliance/trust shift, "

                "high-impact gain/loss of resource/artifact/ability, or a new constraint that changes next turns. "

                "If the turn only adds tone, tension, or a short exchange without new lasting consequences, return is_important=false. "

                "If there is no such event, return is_important=false, importance_score<=55, title=\"\", content=\"\"."

            ),

        },

    ]

    for attempt_index in range(2):

        try:

            raw_response = _request_openrouter_story_text(

                messages_payload,

                model_name=model_name,

                allow_free_fallback=False,

                fallback_model_names=fallback_model_names,

                temperature=0.0,

                max_tokens=STORY_MEMORY_KEY_EVENT_REQUEST_MAX_TOKENS,

                request_timeout=(

                    STORY_PLOT_CARD_REQUEST_CONNECT_TIMEOUT_SECONDS,

                    STORY_PLOT_CARD_REQUEST_READ_TIMEOUT_SECONDS,

                ),

            )

        except Exception as exc:

            logger.warning(

                "Important plot event extraction request failed on attempt %s/2: %s",

                attempt_index + 1,

                exc,

            )

            if attempt_index == 0:

                time.sleep(0.35)

                continue

            return None



        parsed_payload = _extract_json_object_from_text(raw_response)

        if not isinstance(parsed_payload, dict):

            logger.warning(

                "Important plot event extraction returned malformed payload on attempt %s/2",

                attempt_index + 1,

            )

            if attempt_index == 0:

                time.sleep(0.2)

                continue

            return None



        raw_is_important = parsed_payload.get("is_important")

        is_important = False

        if isinstance(raw_is_important, bool):

            is_important = raw_is_important

        elif isinstance(raw_is_important, (int, float)):

            is_important = bool(raw_is_important)

        elif isinstance(raw_is_important, str):

            is_important = raw_is_important.strip().lower() in {"1", "true", "yes"}



        raw_importance_score = parsed_payload.get("importance_score")

        importance_score = 0

        if isinstance(raw_importance_score, bool):

            importance_score = 100 if raw_importance_score else 0

        elif isinstance(raw_importance_score, (int, float)):

            importance_score = int(raw_importance_score)

        elif isinstance(raw_importance_score, str):

            score_match = re.search(r"-?\d+", raw_importance_score.strip())

            if score_match is not None:

                try:

                    importance_score = int(score_match.group(0))

                except Exception:

                    importance_score = 0

        importance_score = max(min(importance_score, 100), 0)



        if not is_important or importance_score < STORY_MEMORY_KEY_EVENT_MIN_IMPORTANCE_SCORE:

            return None



        raw_title = str(parsed_payload.get("title") or parsed_payload.get("name") or "").strip()

        raw_content = str(parsed_payload.get("content") or parsed_payload.get("summary") or "").strip()

        if not raw_content:

            logger.warning(

                "Important plot event extraction returned empty content on attempt %s/2",

                attempt_index + 1,

            )

            if attempt_index == 0:

                time.sleep(0.2)

                continue

            return None



        content = _sanitize_story_key_memory_content(raw_content)

        if not content or not _is_story_key_memory_content_valid(content) or len(content) < 30:

            logger.warning(

                "Important plot event extraction returned invalid content on attempt %s/2",

                attempt_index + 1,

            )

            if attempt_index == 0:

                time.sleep(0.2)

                continue

            return None



        title = raw_title if raw_title else _derive_story_plot_card_title_from_content(content)

        title = _normalize_story_memory_block_title(f"Важно: {title}", fallback="Важно: Важное событие")
        if not _should_accept_story_important_event_candidate(
            latest_user_prompt=normalized_prompt,
            latest_assistant_text=normalized_assistant,
            title=title,
            content=content,
            importance_score=importance_score,
        ):
            return None

        return (title, content)



    return None





def _estimate_story_memory_similarity(left_value: str, right_value: str) -> float:

    left_tokens = set(_normalize_story_match_tokens(left_value))

    right_tokens = set(_normalize_story_match_tokens(right_value))

    if not left_tokens or not right_tokens:

        return 0.0

    overlap_size = len(left_tokens.intersection(right_tokens))

    baseline = max(min(len(left_tokens), len(right_tokens)), 1)

    return overlap_size / baseline





def _create_story_key_memory_block(

    *,

    db: Session,

    game: StoryGame,

    assistant_message: StoryMessage,

    title: str,

    content: str,

) -> bool:

    normalized_title = _normalize_story_memory_block_title(title, fallback="Важно: Важное событие")
    if not normalized_title.casefold().startswith("важно:"):
        normalized_title = _normalize_story_memory_block_title(
            f"Важно: {normalized_title}",
            fallback="Важно: Важное событие",
        )

    sanitized_content = _sanitize_story_key_memory_content(content)

    if not sanitized_content or not _is_story_key_memory_content_valid(sanitized_content):

        return False

    candidate_signal = _build_story_key_memory_candidate_signal(
        title=normalized_title,
        content=sanitized_content,
    )
    if _is_story_important_event_obviously_low_value(
        latest_user_prompt="",
        latest_assistant_text="",
        title=normalized_title,
        content=sanitized_content,
        turn_important_hits=0,
        turn_strong_hits=0,
        candidate_important_hits=int(candidate_signal.get("important_hits", 0)),
        candidate_strong_hits=int(candidate_signal.get("strong_hits", 0)),
        candidate_top_score=int(candidate_signal.get("top_score", 0)),
    ):
        return False

    normalized_content = _normalize_story_memory_block_content(sanitized_content)

    existing_blocks = [

        block

        for block in _list_story_memory_blocks(db, game.id)

        if _normalize_story_memory_layer(block.layer) == STORY_MEMORY_LAYER_KEY

    ]

    for block in reversed(existing_blocks[-40:]):

        existing_title = block.title.replace("\r\n", " ").strip()

        existing_content = block.content.replace("\r\n", "\n").strip()

        if (

            existing_title.casefold() == normalized_title.casefold()

            and existing_content.casefold() == normalized_content.casefold()

        ):

            return False

        if (

            _estimate_story_memory_similarity(existing_content, normalized_content)

            >= STORY_MEMORY_KEY_EVENT_DEDUP_SIMILARITY

        ):

            return False



    _create_story_memory_block(

        db=db,

        game_id=game.id,

        assistant_message_id=assistant_message.id,

        layer=STORY_MEMORY_LAYER_KEY,

        title=normalized_title,

        content=normalized_content,

    )

    return True
