from __future__ import annotations

import re
from typing import Any


SMART_REGENERATION_OPTIONS: tuple[str, ...] = (
    "fix_language",
    "make_more_alive",
    "make_shorter",
    "make_more_detailed",
    "more_action",
    "more_dialogue",
    "less_pathos",
    "stricter_facts",
    "remove_repetition",
    "preserve_format",
)

SMART_REGENERATION_MODES: tuple[str, ...] = ("new_variant", "improve_existing")
DEFAULT_SMART_REGENERATION_MODE = "new_variant"

SMART_REGENERATION_INSTRUCTION_ORDER: tuple[str, ...] = (
    "preserve_format",
    "stricter_facts",
    "fix_language",
    "remove_repetition",
    "make_shorter",
    "make_more_detailed",
    "more_dialogue",
    "more_action",
    "make_more_alive",
    "less_pathos",
)

SMART_REGENERATION_CONFLICTS: dict[str, tuple[str, ...]] = {
    "make_shorter": ("make_more_detailed",),
    "make_more_detailed": ("make_shorter",),
}

SMART_REGENERATION_PREVIOUS_RESPONSE_MAX_CHARS = 1_800

SMART_REGENERATION_OPTION_INSTRUCTIONS: dict[str, tuple[str, ...]] = {
    "preserve_format": (
        "СОХРАНИТЬ ФОРМАТ РЕПЛИК:",
        "Сохрани output contract ответа без изменений.",
        "Не меняй структуру блоков, speaker_id, character_id, имена персонажей, JSON-ключи, теги, delimiters и служебные маркеры.",
        "Особенно сохраняй маркеры проекта: [[NARRATOR]], [[NPC:Name]], [[GG:Name]], [[NPC_THOUGHT:Name]], [[GG_THOUGHT:Name]].",
        "Меняй только видимый художественный текст там, где это нужно.",
        "Ответ должен по-прежнему корректно парситься фронтом на блоки реплик, имена и аватарки.",
        "Если добавляется больше диалога, оформляй новые реплики тем же валидным способом, что и существующие speaker blocks проекта.",
    ),
    "stricter_facts": (
        "СТРОЖЕ ПО ФАКТАМ:",
        "Канон сцены важнее красивого текста.",
        "Не меняй предметы в руках персонажей.",
        "Не меняй содержимое предметов: чай не становится кофе, вода не становится вином и т.д.",
        "Не меняй одежду, здоровье, локацию, позу и положение персонажей без явной причины.",
        "Не путай адресата реплики.",
        "Если персонаж уже рядом, не описывай повторное приближение.",
        "Если информации не хватает, формулируй нейтрально и не выдумывай.",
        "Свежий ход игрока, canonical state и специализированные модули состояния важнее сжатой памяти и художественных догадок.",
    ),
    "fix_language": (
        "ИСПРАВИТЬ ЯЗЫК:",
        "Видимый игроку текст должен быть на естественном русском языке.",
        "Убери случайные английские слова, китайские символы, машинные кальки, неестественные обороты и выдуманные русские слова.",
        "Не трогай служебные id, speaker_id, character_id, JSON-ключи, теги, delimiters, имена персонажей и названия, если они являются частью формата или лора.",
        "Реплики должны звучать так, будто их написал русскоязычный автор, а не машинный переводчик.",
        "Не меняй факты сцены ради стилистической правки.",
    ),
    "remove_repetition": (
        "УБРАТЬ ПОВТОР:",
        "Избегай повторов из предыдущего ответа и последних ходов.",
        "Не повторяй те же opening/ending patterns, жесты, улыбки, взгляды, приближения, паузы и однотипные фразы.",
        "Не начинай сцену тем же способом, если это уже повторялось.",
        "Не используй повторное \"подошёл/подошла\", если персонаж уже рядом.",
        "В режиме \"Новый вариант\" нельзя сохранять ту же последовательность сценических beats, кроме фактов, обязательных по канону.",
        "Замени шаблонные реакции на более конкретные и подходящие сцене.",
    ),
    "make_shorter": (
        "СДЕЛАТЬ КОРОЧЕ:",
        "Новый ответ должен быть заметно короче обычного: ориентир 40-70% от длины предыдущего ответа, если предыдущий ответ доступен.",
        "Убери воду, повторяющиеся описания, лишние пояснения и затянутые внутренние монологи.",
        "Сохрани ключевые действия, реплики, атмосферу, факты и формат ответа.",
        "Не обрывай сцену слишком резко.",
        "Не удаляй служебные блоки/маркеры, нужные для фронта.",
    ),
    "make_more_detailed": (
        "СДЕЛАТЬ ПОДРОБНЕЕ:",
        "Ответ должен быть заметно подробнее обычного: ориентир 130-180% от длины предыдущего ответа, если предыдущий ответ доступен.",
        "Добавь уместные сенсорные детали, микрореакции, атмосферу, плавные переходы и конкретику сцены.",
        "Не меняй канон, предметы, позиции, адресатов, одежду, здоровье и содержимое объектов.",
        "Не растягивай ответ пустыми повторами.",
        "Детали должны усиливать сцену, а не заменять действие.",
    ),
    "more_dialogue": (
        "БОЛЬШЕ ДИАЛОГА:",
        "Ответ должен заметно сильнее опираться на прямую речь персонажей.",
        "Если в сцене есть активный NPC или игрок обратился к конкретному NPC, добавь прямую реплику этого NPC.",
        "Если формат проекта поддерживает отдельные dialogue/speaker blocks, создай или сохрани такие блоки так, чтобы фронт показал имя и аватарку говорящего.",
        "Минимальная цель: хотя бы одна содержательная реплика NPC, а лучше короткий обмен из 2-3 реплик, если это уместно и не ломает формат.",
        "Реплика должна отвечать на ход игрока или продвигать сцену, а не быть декоративной.",
        "Сократи долю чистого описания, если оно мешает диалогу.",
        "Не заставляй другого персонажа отвечать без явной причины.",
        "Если игрок обратился к конкретному NPC, по умолчанию отвечает именно этот NPC.",
        "В режиме \"Новый вариант\" структура ответа должна отличаться от предыдущей и иметь заметно больше прямой речи.",
    ),
    "more_action": (
        "БОЛЬШЕ ДЕЙСТВИЯ:",
        "Ответ должен заметно сильнее двигать сцену через конкретные внешние действия.",
        "Добавь минимум одно ощутимое событие, движение, физическую реакцию, изменение ситуации или последствие хода игрока.",
        "Не ограничивайся внутренними чувствами, описанием взгляда или атмосферой.",
        "Не решай за игрока важные действия его персонажа.",
        "Не телепортируй персонажей и не нарушай их текущие позиции.",
        "Если персонаж уже рядом, не пиши, что он снова подошёл; дай действие на месте.",
        "В режиме \"Новый вариант\" придумай другой action beat, а не повторяй действие из предыдущего ответа.",
    ),
    "make_more_alive": (
        "СДЕЛАТЬ ЖИВЕЕ:",
        "Ответ должен ощущаться менее сухим и более сценичным.",
        "Добавь конкретные живые реакции персонажей: пауза, взгляд, жест, изменение интонации, короткое действие, неловкость, раздражение, сомнение или другая уместная микрореакция.",
        "Показывай эмоции через поведение, а не только называй их словами.",
        "Не используй шаблонные реакции вроде постоянной мягкой улыбки, наклона головы или бесконечных взглядов, если они уже повторялись.",
        "Не добавляй чрезмерный пафос.",
        "Не добавляй новые крупные события только ради выразительности.",
    ),
    "less_pathos": (
        "МЕНЬШЕ ПАФОСА:",
        "Сделай стиль проще, естественнее и менее театральным.",
        "Убери чрезмерную драматичность, высокопарные метафоры, искусственное напряжение и фразы, которые звучат как трейлер.",
        "Сохрани эмоциональность, но сделай её человеческой, конкретной и приземлённой.",
        "Не превращай ответ в сухой отчёт.",
    ),
}


def normalize_smart_regeneration_mode(mode: Any | None) -> str:
    if mode is None:
        return DEFAULT_SMART_REGENERATION_MODE

    normalized_mode = str(mode or "").strip()
    if not normalized_mode:
        return DEFAULT_SMART_REGENERATION_MODE
    if normalized_mode not in SMART_REGENERATION_MODES:
        raise ValueError(f"Unknown smart regeneration mode: {normalized_mode}")
    return normalized_mode


def normalize_smart_regeneration_options(options: list[Any] | tuple[Any, ...] | None) -> list[str]:
    if not options:
        return []

    allowed_options = set(SMART_REGENERATION_OPTIONS)
    normalized_options: list[str] = []
    seen_options: set[str] = set()
    unknown_options: list[str] = []
    for raw_option in options:
        option = str(raw_option or "").strip()
        if not option:
            continue
        if option not in allowed_options:
            unknown_options.append(option)
            continue
        if option in seen_options:
            continue
        seen_options.add(option)
        normalized_options.append(option)

    if unknown_options:
        raise ValueError(f"Unknown smart regeneration option: {unknown_options[0]}")

    for option, conflicts in SMART_REGENERATION_CONFLICTS.items():
        if option in seen_options and any(conflict in seen_options for conflict in conflicts):
            raise ValueError("make_shorter conflicts with make_more_detailed")

    if "preserve_format" not in seen_options:
        normalized_options.append("preserve_format")

    order_index = {option: index for index, option in enumerate(SMART_REGENERATION_INSTRUCTION_ORDER)}
    return sorted(normalized_options, key=lambda option: order_index.get(option, len(order_index)))


def build_smart_regeneration_instructions(
    options: list[Any] | tuple[Any, ...] | None,
    *,
    mode: Any | None = None,
    previous_assistant_text: str | None = None,
) -> str:
    normalized_options = normalize_smart_regeneration_options(options)
    if not normalized_options:
        return ""
    normalized_mode = normalize_smart_regeneration_mode(mode)

    previous_text = _normalize_previous_assistant_text(previous_assistant_text)
    lines = _build_smart_regeneration_mode_base_lines(
        normalized_mode,
        previous_assistant_text=previous_text,
    )

    lines.extend(["", "Выбранные параметры:"])
    seen_instruction_lines: set[str] = set()
    for option in normalized_options:
        for instruction in SMART_REGENERATION_OPTION_INSTRUCTIONS.get(option, ()):
            normalized_instruction = " ".join(instruction.split()).strip()
            if not normalized_instruction or normalized_instruction in seen_instruction_lines:
                continue
            seen_instruction_lines.add(normalized_instruction)
            lines.append(f"- {normalized_instruction}")

    return "\n".join(lines).strip()


def build_smart_regeneration_instruction_card(
    smart_regeneration: Any,
    *,
    previous_assistant_text: str | None = None,
) -> dict[str, str] | None:
    if smart_regeneration is None:
        return None

    enabled = bool(getattr(smart_regeneration, "enabled", False))
    mode = (
        normalize_smart_regeneration_mode(getattr(smart_regeneration, "mode", None))
        if enabled
        else DEFAULT_SMART_REGENERATION_MODE
    )
    options = list(getattr(smart_regeneration, "options", []) or [])
    if not enabled or not options:
        return None

    instructions = build_smart_regeneration_instructions(
        options,
        mode=mode,
        previous_assistant_text=previous_assistant_text,
    )
    if not instructions:
        return None

    return {
        "title": "Продвинутая перегенерация",
        "content": instructions,
        "source_kind": "smart_regeneration",
    }


def _build_smart_regeneration_mode_base_lines(
    mode: str,
    *,
    previous_assistant_text: str,
) -> list[str]:
    if mode == "improve_existing":
        lines = [
            "ИНСТРУКЦИЯ ДЛЯ ПРОДВИНУТОЙ ПЕРЕГЕНЕРАЦИИ",
            "",
            "РЕЖИМ: УЛУЧШИТЬ ТЕКУЩИЙ",
            "",
            "Игроку в целом подходит смысл предыдущего ответа, но он хочет улучшить выбранные аспекты.",
            "Исправь текущий ответ, сохранив его основную суть, порядок событий, говорящих и канон.",
        ]
        if previous_assistant_text:
            lines.extend(["", "Предыдущий ответ:", previous_assistant_text])
        lines.extend(
            [
                "",
                "Обязательно:",
                "- Не менять основные события без необходимости.",
                "- Не добавлять крупные новые события.",
                "- Сохранить output contract для фронта.",
                "- Исправить только выбранные аспекты.",
                "- Сохранить естественный русский язык.",
            ]
        )
        return lines

    lines = [
        "ИНСТРУКЦИЯ ДЛЯ ПРОДВИНУТОЙ ПЕРЕГЕНЕРАЦИИ",
        "",
        "РЕЖИМ: НОВЫЙ ВАРИАНТ",
        "",
        "Игрок просит не редактуру старого текста, а новый альтернативный вариант ответа на последний ход.",
        "Сгенерируй другой вариант развития сцены с учётом выбранных параметров.",
    ]
    if previous_assistant_text:
        lines.extend(
            [
                "",
                "Предыдущий ответ:",
                previous_assistant_text,
                "",
                "Предыдущий ответ использовать только как антипример: он уже не подошёл игроку.",
            ]
        )
    lines.extend(
        [
            "Не копируй его текст, структуру, порядок сценических beats, opening, ending, жесты и повторы.",
            "Не делай микроправку. Нужен реально новый вариант.",
            "Допустимо сохранить только обязательные факты канона. Всё остальное: формулировки, порядок реакции, жесты, темп, структура и реплики — сделай новым вариантом.",
            "",
            "Запрещено:",
            "- Копировать предыдущий ответ.",
            "- Сохранять ту же последовательность сценических beats, если это не требуется каноном.",
            "- Повторять те же формулировки, opening, ending, жесты и структуру.",
            "- Менять факты канона ради новизны.",
            "- Ломать формат ответа для фронта.",
            "",
            "Нужно:",
            "- Написать реально новый вариант развития сцены.",
            "- Сохранить канон, состояние сцены, предметы, позиции, адресатов, одежду, здоровье и формат реплик.",
            "- Учесть выбранные параметры перегенерации.",
            "- Если выбран \"Больше диалога\", новый вариант должен заметно сильнее опираться на реплики.",
            "- Если выбран \"Больше действия\", новый вариант должен заметно сильнее продвигать событие/движение сцены.",
        ]
    )
    return lines


def _normalize_previous_assistant_text(value: str | None) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return ""

    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    if len(normalized) <= SMART_REGENERATION_PREVIOUS_RESPONSE_MAX_CHARS:
        return normalized

    head = normalized[:1_000].rstrip()
    tail = normalized[-650:].lstrip()
    if not head:
        return tail
    if not tail:
        return head
    return f"{head}\n...\n{tail}"
