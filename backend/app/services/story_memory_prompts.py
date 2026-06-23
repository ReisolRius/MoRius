from __future__ import annotations

import json
from typing import Any


LLM_DETAILED_MEMORY_PROMPT_NAME = "LLM_DETAILED_MEMORY_PROMPT"
LLM_COMPRESSED_MEMORY_PROMPT_NAME = "LLM_COMPRESSED_MEMORY_PROMPT"
LLM_FACT_MEMORY_PROMPT_NAME = "LLM_FACT_MEMORY_PROMPT"
LLM_GAME_STATE_ANALYSIS_PROMPT_NAME = "LLM_GAME_STATE_ANALYSIS_PROMPT"
LLM_IMPORTANT_MEMORY_PROMPT_NAME = "LLM_IMPORTANT_MEMORY_PROMPT"


def _dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def build_important_memory_messages(
    *,
    player_turn: str,
    narrator_response: str,
    existing_memories: list[dict[str, str]],
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "Ты — модуль важной долговременной памяти текстовой RPG. "
                "Проанализируй только уже произошедшее в ходе игрока и ответе рассказчика. "
                "Создавай не более одной карточки за ход и только для действительно значимого события, "
                "которое важно помнить в будущих сценах.\n\n"
                "Сохраняй: необратимые или крупные изменения мира и персонажей; смерть, тяжёлую травму, "
                "исчезновение или спасение; важное раскрытие тайны или личности; принятое обязательство, "
                "клятву, договор, предательство, разрыв или заметный перелом отношений; получение, потерю "
                "или уничтожение уникального предмета; новую долгосрочную цель, миссию, запрет или угрозу; "
                "решение с длительными последствиями.\n\n"
                "Не сохраняй: обычное перемещение, атмосферные детали, бытовые действия, флирт без последствий, "
                "повтор уже известного факта, рядовую реплику, краткую эмоцию, мелкую находку, обычный бой без "
                "долгосрочных последствий и любые технические инструкции. Если значимого события нет или оно "
                "уже отражено в существующей памяти, верни should_store=false.\n\n"
                "Не выдумывай фактов и не продолжай сцену. Заголовок должен быть коротким и конкретным. "
                "Summary — краткий самостоятельный пересказ с именами, причиной и последствием. "
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                f"EXISTING_IMPORTANT_MEMORIES:\n{_dump_json(existing_memories)}\n\n"
                f"PLAYER_TURN:\n{player_turn or 'нет'}\n\n"
                f"NARRATOR_RESPONSE:\n{narrator_response or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "should_store": true,\n'
                '  "title": "Короткий заголовок события",\n'
                '  "summary": "Краткий фактический пересказ значимого события и его последствия",\n'
                '  "significance": "Почему это потребуется помнить позже"\n'
                "}\n"
                "Если важного нового события нет, верни: "
                '{"should_store":false,"title":"","summary":"","significance":""}'
            ),
        },
    ]


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
    previous_narrator_response: str,
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
                "AUTO_STATE — это текущее состояние, а не журнал событий. Обработай каждого персонажа, который участвует "
                "в текущей сцене, а также любого персонажа с пустыми отслеживаемыми полями, если его состояние можно "
                "установить по карточкам или недавнему контексту. Одежду описывай сухо, от головы к ногам. "
                "Допустимы как полный перечень надетого, так и краткая общая категория, если подробности неизвестны. "
                "Всегда сохраняй известную неизменившуюся основу одежды из CURRENT_CHARACTER_STATES. Если вещь снята, "
                "надета, заменена, расстегнута, испачкана, намокла, повреждена или иначе изменилась, отрази точное "
                "актуальное состояние и сторону/часть тела, когда это важно. Не превращай подробное описание в общее "
                "без причины из сцены. Если clothing пуст, обязательно инициализируй его по явно видимой одежде, "
                "описанию внешности, роли и условиям сцены; разрешено разумное жанровое предположение, не противоречащее "
                "миру. Не оставляй clothing пустым для присутствующего в сцене персонажа.\n\n"
                "Инвентарь — только актуальный перечень принадлежащих или переносимых предметов: названия через запятую "
                "и пробел, без глаголов, истории получения и служебных пометок. Меняй его только при явно произошедшем "
                "получении, потере, передаче, расходовании, уничтожении или ином изменении владения/наличия. При изменении "
                "вычисли полный итоговый список на основе текущего equipment. Если inventory/equipment пуст, собери "
                "стартовый список из всех предметов, оружия, инструментов и других переносимых вещей, явно закреплённых "
                "за персонажем в EXISTING_CHARACTER_CARDS, PLAYER_CHARACTER_CARD, предыдущем ответе или текущем ходе. "
                "Не выдумывай предметы только ради непустого поля: если ни одного предмета не установлено, оставь пусто.\n\n"
                "Здоровье по умолчанию записывай одним словом «Нормальное». При травме, болезни, отравлении или другом "
                "отклонении записывай само актуальное состояние кратко и конкретно, без универсальных префиксов вроде "
                "«Ранен:». Не считай усталость, эмоцию или грязную одежду заболеванием, если текст этого не подтверждает. "
                "Если health/status пуст, обязательно верни его инициализацию.\n\n"
                "Для NPC-карточек создавай карточку только если индивидуальный персонаж вероятно понадобится позже. "
                "Отсутствие названного в тексте имени не запрещает карточку: важному безымянному NPC обязательно придумай "
                "личное каноническое имя, естественное для языка, культуры, эпохи, жанра и лора мира. Никогда не используй "
                "в качестве имени одну лишь профессию, роль, вид, принадлежность или внешнюю примету. Не создавай массовку "
                "и случайных статистов. Не создавай дубль, если тот же персонаж уже есть в existing_character_cards или "
                "candidates, даже когда в текущем тексте его назвали только ролью, местоимением или описанием: возвращай "
                "update_existing_card с точным id.\n\n"
                "Описание новой NPC-карточки пиши на языке игры как три коротких фактических раздела, эквивалентных "
                "«Возраст: ... Внешность: ... Характер: ...». Если точный возраст не указан, дай правдоподобную оценку "
                "без ложной точности. Внешность должна объединять все известные устойчивые признаки; недостающие детали "
                "можно осторожно достроить в соответствии с миром, не противореча сцене. Характер выводи из поведения и "
                "роли персонажа. Не включай в описание причины важности, будущие события или технические комментарии.\n\n"
                "Первым триггером новой карточки ставь точное придуманное имя. Затем добавляй встречавшиеся в сцене "
                "фамилию, прозвище, титул, роль и устойчивое отличительное обозначение, чтобы следующий ход снова связал "
                "этого NPC с той же карточкой. Слишком общий триггер используй только когда он однозначен в данной сцене; "
                "если похожих персонажей несколько, добавляй различающие признаки.\n\n"
                "Перед формированием npc_cards сначала перечисли про себя всех разных NPC из PREVIOUS_NARRATOR_RESPONSE "
                "и NARRATOR_RESPONSE и сопоставь каждого с полным EXISTING_CHARACTER_CARDS. Именованный NPC, который "
                "говорит, думает, действует индивидуально или участвует в прямом взаимодействии, по умолчанию считается "
                "важным. Для каждого такого отсутствующего NPC верни отдельный create_card. Для каждого существующего, "
                "которому нужны новые алиасы или факты, верни отдельный update_existing_card. Не останавливайся после "
                "первого найденного персонажа: в actions может и должно быть несколько действий за один ход. Лимита "
                "«одна новая карточка за ход» нет. Не объединяй двух разных персонажей в одну карточку.\n\n"
                "Для новой NPC-карточки также сразу верни текущее состояние, определённое тобой по сцене: clothing — "
                "одежда сверху вниз, inventory — актуальные явно известные предметы через запятую, health_status — "
                "«Нормальное» либо конкретная травма/болезнь. Это часть AI-ответа; не оставляй clothing и health_status "
                "пустыми. Если персонаж действительно без одежды, явно напиши эквивалент «Без одежды». inventory может "
                "быть пустым только когда сцена и карточки не устанавливают ни одного предмета.\n\n"
                "Верни только JSON без markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Проанализируй последний ход RPG.\n\n"
                f"REQUESTED_MODULES:\n{_dump_json(requested_modules)}\n\n"
                "STRICT MODULE RULES:\n"
                "- auto_state: character_ref.id and character_ref.name must be copied exactly from "
                "CURRENT_CHARACTER_STATES or EXISTING_CHARACTER_CARDS. Update only listed characters. "
                "Only return updates for cards where ai_edit_enabled is true. "
                "If a character cannot be matched, do not return an update for that character. Return fields that "
                "actually changed in this turn and initialize blank tracked fields from AI-visible evidence. For every "
                "scene participant with empty clothing, return clothing.should_update=true and a non-empty complete "
                "current value. For every empty health/status, return health.should_update=true. For empty inventory, "
                "return inventory.should_update=true when at least one carried/owned item is established; otherwise "
                "leave it unchanged and empty. Never overwrite a non-empty unchanged field. clothing.value is the complete current top-to-bottom clothing state. "
                "inventory.value is the complete current comma-separated item list, not a change log. health.value is "
                "either «Нормальное» or the concrete current condition. Never invent inventory changes.\n"
                "- npc_cards: create_card is allowed only for a newly introduced, narratively important NPC who is "
                "absent from the complete EXISTING_CHARACTER_CARDS list. For update_existing_card, existing_card_id "
                "must be copied exactly from that list. If no important new NPC or useful update exists, return "
                "no_action only for a specific NPC who needs neither creation nor update; do not add a single global "
                "no_action when other NPCs require actions. Do not create cards for crowds, incidental extras, or the player character. An important "
                "unnamed NPC is not an extra: invent a lore-appropriate personal name and keep the original scene "
                "designation among the triggers so later mentions resolve to the same card. Return one action per "
                "distinct important NPC and include every qualifying NPC from both recent narrator responses.\n\n"
                f"WORLD_CARD:\n{world_card or 'нет'}\n\n"
                f"PREVIOUS_LOCATION:\n{_dump_json(previous_location or {})}\n\n"
                f"PLAYER_CHARACTER_CARD:\n{_dump_json(player_character_card or {})}\n\n"
                f"EXISTING_CHARACTER_CARDS:\n{_dump_json(existing_character_cards)}\n\n"
                f"NPC_DEDUP_CANDIDATES:\n{_dump_json(npc_dedup_candidates)}\n\n"
                f"CURRENT_CHARACTER_STATES:\n{_dump_json(current_character_states)}\n\n"
                f"PLAYER_TURN:\n{player_turn or 'нет'}\n\n"
                f"PREVIOUS_NARRATOR_RESPONSE:\n{previous_narrator_response or 'нет'}\n\n"
                f"NARRATOR_RESPONSE:\n{narrator_response or 'нет'}\n\n"
                "Верни JSON строго такого вида:\n"
                "{\n"
                '  "location": {"changed": true, "confidence": "high|medium|low", "current": {"country": null, "region": null, "city": null, "district": null, "street": null, "place_name": null, "place_type": null, "room_or_area": null, "display": "Короткая понятная строка текущей локации"}, "evidence": "Кратко, на чем основан вывод", "should_update": true},\n'
                '  "auto_state": {"character_updates": [{"character_ref": {"id": null, "name": "Имя персонажа"}, "clothing": {"value": "Полное актуальное описание сверху вниз", "source": "explicit|inferred|mixed|unchanged", "should_update": true}, "inventory": {"value": "Предмет один, предмет два", "source": "explicit|unchanged", "should_update": true}, "health": {"value": "Нормальное или конкретное состояние", "source": "explicit|inferred|default|unchanged", "should_update": true}}]},\n'
                '  "npc_cards": {"actions": [{"type": "create_card|update_existing_card|no_action", "existing_card_id": null, "new_card": {"name": "Личное каноническое имя", "race": null, "description": "Возраст: ... Внешность: ... Характер: ...", "personality": "Краткая суть характера", "clothing": "Полная текущая одежда сверху вниз", "inventory": "Предмет один, предмет два", "health_status": "Нормальное или конкретное состояние", "triggers": ["Точное имя", "Устойчивое обозначение из сцены"], "importance_reason": "Причина"}, "update_existing": {"add_triggers": ["Новые устойчивые обозначения"], "notes": "Новые факты без дублирования карточки"}, "evidence": "Почему"}]}\n'
                "}\n\n"
                "Если requested_modules не содержит auto_state, верни пустой auto_state. "
                "Если requested_modules не содержит npc_cards, верни пустой npc_cards. "
                "Если requested_modules не содержит location, верни location с should_update=false. "
                "Не заполняй country/city случайно: неизвестное оставляй null."
            ),
        },
    ]
