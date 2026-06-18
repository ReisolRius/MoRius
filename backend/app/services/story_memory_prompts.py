from __future__ import annotations

import json
from typing import Any


LLM_DETAILED_MEMORY_PROMPT_NAME = "LLM_DETAILED_MEMORY_PROMPT"
LLM_COMPRESSED_MEMORY_PROMPT_NAME = "LLM_COMPRESSED_MEMORY_PROMPT"
LLM_FACT_MEMORY_PROMPT_NAME = "LLM_FACT_MEMORY_PROMPT"
LLM_GAME_STATE_ANALYSIS_PROMPT_NAME = "LLM_GAME_STATE_ANALYSIS_PROMPT"


def _dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def build_detailed_memory_messages(*, player_turn: str, narrator_response: str) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты модуль памяти текстовой RPG. Твоя задача — превратить один полный ход игры в подробный, "
                "но немного более короткий пересказ для долговременной памяти. Ты не рассказчик и не продолжаешь "
                "сцену. Ты только сжимаешь уже произошедшее.\n\n"
                "Критически важно:\n"
                "- сохрани, кто именно что сказал;\n"
                "- сохрани, кто именно что сделал;\n"
                "- не путай персонажей;\n"
                "- не заменяй имена местоимениями, если может возникнуть неоднозначность;\n"
                "- сохрани причинно-следственные связи;\n"
                "- сохрани важные эмоции, намерения, решения, конфликты, обещания, угрозы, травмы, предметы, "
                "изменения одежды/состояния/локации, если они были;\n"
                "- не выдумывай новых фактов;\n"
                "- не добавляй продолжение сцены;\n"
                "- не делай литературный рерайт ради красоты;\n"
                "- пиши на языке исходного текста;\n"
                "- итог должен быть короче исходника, но не ценой потери сути.\n\n"
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Сожми этот завершенный ход RPG в подробный memory block уровня 50%.\n\n"
                f"PLAYER_TURN:\n{player_turn or 'нет'}\n\n"
                f"NARRATOR_RESPONSE:\n{narrator_response or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "summary": "Подробный пересказ произошедшего. Должно быть понятно, кто что сказал и кто что сделал.",\n'
                '  "important_entities": [{"name": "Имя/роль сущности", "type": "character|place|item|organization|other", "note": "Почему это важно для памяти"}],\n'
                '  "state_changes": ["Короткий факт об изменении состояния, инвентаря, отношений, положения, здоровья, одежды, цели или конфликта"],\n'
                '  "open_threads": ["Нерешенный конфликт, обещание, угроза, план или вопрос, который может быть важен позже"]\n'
                "}\n\n"
                "Если important_entities/state_changes/open_threads отсутствуют, верни пустые массивы. "
                "summary должен быть связным пересказом. Не используй фразы вроде “в тексте сказано”."
            ),
        },
    ]


def build_compressed_memory_messages(*, detailed_blocks: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты модуль памяти текстовой RPG. Твоя задача — сжать несколько подробных memory blocks "
                "в более компактный пересказ уровня 30%. Это не степень сжатия, а другой слой памяти: "
                "меньше деталей, но полностью сохранена суть.\n\n"
                "Критически важно: сохрани хронологию, имена, действия, важные реплики, связи, изменения "
                "состояния/здоровья/одежды/инвентаря/локации/отношений/целей. Убери второстепенные описания "
                "и повторы. Не выдумывай, не продолжай сцену, пиши на языке исходного текста. "
                "Не используй местоимения там, где можно перепутать персонажей.\n\n"
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Сожми эти detailed memory blocks уровня 50% в один compact memory block уровня 30%.\n\n"
                f"DETAILED_BLOCKS:\n{_dump_json(detailed_blocks)}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "summary": "Компактный пересказ. Меньше деталей, но ясно, кто что сделал, кто что сказал и почему это важно.",\n'
                '  "key_facts": ["Самостоятельный факт с именами/ролями без неоднозначных местоимений"],\n'
                '  "open_threads": ["То, что важно помнить для будущих сцен"]\n'
                "}\n\n"
                "summary должен быть связным. key_facts должны быть самостоятельными. Не теряй причинно-следственные связи."
            ),
        },
    ]


def build_fact_memory_messages(*, compressed_blocks: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты модуль долговременной памяти текстовой RPG. Твоя задача — сжать compact memory blocks "
                "уровня 30% в слой чистых фактов уровня 20%.\n\n"
                "Оставляй только факты, которые могут понадобиться позже. Каждый факт должен быть самостоятельным, "
                "с явными именами/ролями. Сохраняй действия, решения, последствия, отношения, травмы, предметы, "
                "цели, локации, обещания, угрозы и раскрытую информацию. Не выдумывай и не продолжай сцену. "
                "Пиши на языке исходного текста.\n\n"
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Сожми эти compact memory blocks уровня 30% в factual memory block уровня 20%.\n\n"
                f"COMPRESSED_BLOCKS:\n{_dump_json(compressed_blocks)}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "facts": ["Самостоятельный факт. Без неоднозначных местоимений."],\n'
                '  "persistent_state": ["Долгосрочное состояние персонажа, мира, отношений, инвентаря, здоровья, локации или конфликта"],\n'
                '  "open_threads": ["Нерешенный сюжетный крючок, долг, угроза, цель, тайна или обещание"]\n'
                "}\n\n"
                "Не добавляй факты, которых не было во входе. Лучше меньше фактов, но каждый должен быть полезным."
            ),
        },
    ]


def build_game_state_analysis_messages(
    *,
    requested_modules: list[str],
    world_card: str,
    previous_location: dict[str, Any] | None,
    player_character_card: dict[str, Any] | None,
    existing_character_cards: list[dict[str, Any]],
    npc_dedup_candidates: list[dict[str, Any]],
    current_character_states: list[dict[str, Any]],
    player_turn: str,
    narrator_response: str,
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты служебный аналитический модуль текстовой RPG. Ты не рассказчик. Ты не продолжаешь сцену. "
                "Ты анализируешь только уже произошедший последний ход игрока и ответ рассказчика.\n\n"
                "Твоя задача — вернуть структурированный JSON для игровых модулей: location, auto_state, npc_cards. "
                "Работай универсально для любого жанра, мира, эпохи и языка. Не делай keyword hacks. Не привязывайся "
                "к конкретным примерам ролей, мест или имен. Используй карточку мира как источник лора. "
                "Не выдумывай сюжетные события.\n\n"
                "Для одежды можно делать разумные жанровые и ситуационные предположения, если текст прямо не описывает "
                "одежду. Для инвентаря учитывай только явные получения/потери/передачи/использования предметов. "
                "Для здоровья по умолчанию состояние normal, если нет явных признаков проблем.\n\n"
                "Для NPC-карточек создавай карточку только если персонаж может понадобиться позже. Не создавай массовку "
                "и не создавай дубль, если персонаж уже есть в existing_character_cards или candidates. Если персонаж "
                "уже существует, возвращай update_existing_card. Триггеры карточки — имя, фамилия, прозвище, роль или "
                "устойчивое обозначение.\n\n"
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Проанализируй последний ход RPG.\n\n"
                f"REQUESTED_MODULES:\n{_dump_json(requested_modules)}\n\n"
                f"WORLD_CARD:\n{world_card or 'нет'}\n\n"
                f"PREVIOUS_LOCATION:\n{_dump_json(previous_location or {})}\n\n"
                f"PLAYER_CHARACTER_CARD:\n{_dump_json(player_character_card or {})}\n\n"
                f"EXISTING_CHARACTER_CARDS:\n{_dump_json(existing_character_cards)}\n\n"
                f"NPC_DEDUP_CANDIDATES:\n{_dump_json(npc_dedup_candidates)}\n\n"
                f"CURRENT_CHARACTER_STATES:\n{_dump_json(current_character_states)}\n\n"
                f"PLAYER_TURN:\n{player_turn or 'нет'}\n\n"
                f"NARRATOR_RESPONSE:\n{narrator_response or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "location": {"changed": true, "confidence": "high|medium|low", "current": {"country": null, "region": null, "city": null, "district": null, "street": null, "place_name": null, "place_type": null, "room_or_area": null, "display": "Короткая понятная строка текущей локации"}, "evidence": "Кратко, на чем основан вывод", "should_update": true},\n'
                '  "auto_state": {"character_updates": [{"character_ref": {"id": null, "name": "Имя персонажа"}, "clothing": {"value": "Описание сверху вниз", "source": "explicit|inferred|mixed|unchanged", "should_update": true}, "inventory_changes": [{"action": "gained|lost|gave|received|used|unknown_change", "item": "Название предмета", "details": "Детали", "confidence": "high|medium|low"}], "health": {"value": "normal или конкретное состояние", "source": "explicit|inferred|default|unchanged", "should_update": true}}]},\n'
                '  "npc_cards": {"actions": [{"type": "create_card|update_existing_card|no_action", "existing_card_id": null, "new_card": {"name": "Имя", "race": null, "description": "Описание", "personality": "Характер", "triggers": ["Имя"], "importance_reason": "Причина"}, "update_existing": {"add_triggers": ["Новые триггеры"], "notes": "Заметки"}, "evidence": "Почему"}]}\n'
                "}\n\n"
                "Если requested_modules не содержит auto_state, верни пустой auto_state. "
                "Если requested_modules не содержит npc_cards, верни пустой npc_cards. "
                "Если requested_modules не содержит location, верни location с should_update=false. "
                "Не заполняй country/city случайно: неизвестное оставляй null."
            ),
        },
    ]
