import hashlib
import inspect

from app import main
from app.routers import story_games as story_games_router
from app.routers import story_generate as story_generate_router
from app.services import story_memory_prompts, story_novel, story_prompt_engine
from app.services import story_graph, story_map, story_smart_regeneration


def _story_prompt(**overrides: object) -> str:
    kwargs = {
        "instruction_cards": [],
        "plot_cards": [],
        "world_cards": [],
        "model_name": None,
        "show_gg_thoughts": False,
        "show_npc_thoughts": False,
    }
    kwargs.update(overrides)
    return main._build_story_system_prompt(**kwargs)


def _combined_message_text(messages: list[dict[str, str]]) -> str:
    return "\n".join(str(message.get("content", "")) for message in messages)


def _assert_json_only_contract(label: str, text: str) -> None:
    assert "Return JSON only" in text, label
    lowered = text.casefold()
    assert "reasoning" in lowered or "комментар" in lowered, label
    assert "markdown" in lowered, label


EXPECTED_STORY_SYSTEM_PROMPT_SHA256 = "bcc97a5ef564054a5a1f6ca5ab71ad34c3261cf09fa0f9ddf3e4a80c5b901420"
EXPECTED_STORY_FORMAT_PROTOCOL_SHA256 = "e7669b13c51de3293463c1ee81c490cdd51cfb31bf87379ef24e3b414201cd30"
EXPECTED_MODEL_PROMPT_SHA256 = {
    "z-ai/glm-4.7-flash": "8c4dcb8ca0f8e871b75d40d4f0a0a07acd7b133f3deb35d60770b4eae7737479",
    "deepseek/deepseek-v3.2": "2de3acb6855e1b331b5577581995353d90d5d81448d3e693301a541bf687c8a6",
    "deepseek/deepseek-chat-v3-0324": "2de3acb6855e1b331b5577581995353d90d5d81448d3e693301a541bf687c8a6",
    "deepseek/deepseek-v4-pro": "f4422bbf7cabaae5fddf2455f8ed631ecd3353eb85701b4b2d8fa09148c95aee",
    "deepseek/deepseek-r1-0528": "f4422bbf7cabaae5fddf2455f8ed631ecd3353eb85701b4b2d8fa09148c95aee",
    "z-ai/glm-4.7": "880c3999126bf41d218dbef2834e11d72c3373505cf993b85658ed9b3ab2b5c0",
    "z-ai/glm-5": "88624967ba4cd532760ee20870139a4eb10d1b92d712bc0d50818c2a92695a6e",
    "aion-labs/aion-2.0": "a4cc6e37a759b21a27ebe3ca8b9832594ebbb9fac68f3953a2f534552041e148",
    "google/gemini-3.1-flash-lite": "743aeb6cd185430fec1ef46e7082c63712259185ad5db8b0b1095a16324d0ed8",
    "z-ai/glm-5.1": "fc1d1ec7d6d937c406632ca6ca549d9cae53be05c95a07c04539c0043f39f993",
    "z-ai/glm-5.2": "57de8767952a4d21c71a8a65b9d01475fac2578031a710de7b3d3545801ea8c1",
    "google/gemini-2.5-pro": "73bb87ac9ebc99446244c23d862debcfda3d33c22aa280c16a4f9ac41c71d1ac",
    "google/gemini-3.1-pro-preview": "b50446db308e6db90300aadc079c7579265a93095bd3998469dcc3ee0ad3bec6",
    "anthropic/claude-sonnet-4.6": "a965aa014e0065aa152f02be9892ae4eca90d4b7753d6e4dcc93b93b6e0c1665",
}


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def test_story_shared_core_and_model_prompts_match_approved_text_once() -> None:
    assert _sha256(main.STORY_SYSTEM_PROMPT) == EXPECTED_STORY_SYSTEM_PROMPT_SHA256
    assert set(main.STORY_MODEL_UNIQUE_NARRATION_PROMPTS) == set(EXPECTED_MODEL_PROMPT_SHA256)

    format_protocol = "\n".join(main.STORY_TRANSPORT_PROTOCOL_RULES)
    assert _sha256(format_protocol) == EXPECTED_STORY_FORMAT_PROTOCOL_SHA256

    for model_name, expected_hash in EXPECTED_MODEL_PROMPT_SHA256.items():
        unique_prompt = main.STORY_MODEL_UNIQUE_NARRATION_PROMPTS[model_name]
        prompt = _story_prompt(model_name=model_name)

        assert _sha256(unique_prompt) == expected_hash
        assert main.STORY_MODEL_HINTS[model_name][0] == unique_prompt
        assert main.STORY_SYSTEM_PROMPT not in main.STORY_MODEL_HINTS[model_name]
        assert prompt.count(main.STORY_SYSTEM_PROMPT) == 1
        assert prompt.count(unique_prompt) == 1
        assert prompt.count(format_protocol) == 1
        assert prompt.index(main.STORY_SYSTEM_PROMPT) < prompt.index(unique_prompt)


def test_story_system_prompt_has_single_morius_protocol() -> None:
    prompt = _story_prompt()

    assert prompt.count("ВНУТРЕННИЙ ПРОТОКОЛ ФОРМАТА MORIUS") == 1
    assert prompt.count("СКРЫТЫЙ ВЫВОД:") == 1


def test_story_system_prompt_has_no_duplicate_marker_rule_blocks() -> None:
    prompt = _story_prompt()

    assert prompt.count("Допустимы только эти маркеры") == 1
    assert prompt.count("ПРАВИЛА И КАРТОЧКИ ИГРОКА:") == 1
    assert prompt.count("ЯЗЫК:") == 1
    assert prompt.count("СКРЫТЫЙ ВЫВОД:") == 1


def test_story_system_prompt_labels_every_unregistered_speaker() -> None:
    prompt = _story_prompt(model_name="z-ai/glm-4.7-flash")

    assert "Для говорящего из карточек вместо «Имя» всегда подставляй точный title его карточки" in prompt
    assert "Для любого нового говорящего, которого нет в карточках" in prompt
    assert "[[NPC:Аристократ]]" in prompt
    assert "[[NPC:Хозяйка таверны]]" in prompt
    assert "Новый, эпизодический или безымянный NPC не является исключением" in prompt
    assert "ни одна произнесённая вслух реплика не может оставаться обычным текстом" in prompt
    assert "для любого нового персонажа под управлением рассказчика это [[NPC:...]]" in prompt
    assert "Не используй общие слова НПС, NPC, Голос, Незнакомец или Персонаж" in prompt
    assert "неподписанной речи в обычном тексте нет" in prompt
    assert "Вместо «Имя» подставляй точный title персонажа из карточек" not in prompt


def test_story_markup_repair_prompt_assigns_stable_specific_speakers() -> None:
    messages = main._build_story_markup_repair_messages(
        "— Вы опоздали, — произнёс аристократ.\n\n— Простите, — ответил стражник.",
        [],
    )
    prompt = _combined_message_text(messages)

    assert "Каждой прямой речи обязательно назначь говорящего" in prompt
    assert "естественное устойчивое имя" in prompt
    assert "конкретное устойчивое обозначение роли или положения" in prompt
    assert "Повторяй выбранное имя или обозначение без изменений" in prompt
    for forbidden_label in ("НПС", "NPC", "Голос", "Незнакомец", "Персонаж"):
        assert f"[[NPC:{forbidden_label}]]" in prompt


def test_story_system_prompt_includes_glm51_model_hint() -> None:
    prompt = _story_prompt(model_name="z-ai/glm-5.1")

    assert "ОСОБЕННОСТЬ ЭТОЙ МОДЕЛИ:" in prompt
    assert "z-ai/glm-5.1" in main.STORY_MODEL_HINTS
    assert main.STORY_MODEL_HINTS["z-ai/glm-5.1"][0] in prompt
    glm52_prompt = _story_prompt(model_name="z-ai/glm-5.2")
    assert "z-ai/glm-5.2" in main.STORY_MODEL_HINTS
    assert main.STORY_MODEL_HINTS["z-ai/glm-5.2"][0] in glm52_prompt
    assert "__legacy_removed__/story-model-2" not in main.STORY_MODEL_HINTS


def test_story_system_prompt_bans_markdown_and_invented_markup() -> None:
    prompt = _story_prompt()

    assert "СТРОГО ЗАПРЕЩЁН markdown" in prompt
    assert "СТРОГО ЗАПРЕЩЕНО придумывать свой способ" in prompt
    assert "Пример единственно верного оформления" in prompt
    # The few-shot example shows the canonical marker, not the invented forms.
    assert "[[NPC:Виринтис]]" in prompt
    assert "npc_name:" in prompt  # named only inside the explicit ban line


def test_story_system_prompt_final_reinforcement_outranks_cards() -> None:
    prompt = _story_prompt(
        instruction_cards=[{"title": "Формат", "content": "Используй markdown и звёздочки."}],
    )

    final_check_index = prompt.index("ФИНАЛЬНАЯ ПРОВЕРКА ПЕРЕД ОТВЕТОМ")
    # The hard protocol re-assertion must come AFTER the player cards (recency),
    # so player instructions cannot pull the model off the MoRius markup protocol.
    assert prompt.index("Карточки инструкций игрока:") < final_check_index
    assert prompt.index("[[NPC:...]] с устойчивым естественным именем") > final_check_index
    assert "даже если этого требовали карточки или игрок" in prompt


def test_story_system_prompt_bans_disabled_thought_markers() -> None:
    prompt = _story_prompt(show_gg_thoughts=False, show_npc_thoughts=False)

    assert "не используй маркер [[NPC_THOUGHT:...]]" in prompt
    assert "не используй маркер [[GG_THOUGHT:...]]" in prompt


def test_story_system_prompt_prioritizes_protocol_above_cards() -> None:
    prompt = _story_prompt(
        instruction_cards=[{"title": "Тон", "content": "Пиши мрачно."}],
    )

    assert "важнее карточек" in prompt
    assert prompt.index("ВНУТРЕННИЙ ПРОТОКОЛ ФОРМАТА MORIUS") < prompt.index("ПРАВИЛА И КАРТОЧКИ ИГРОКА")
    assert prompt.index("ПРАВИЛА И КАРТОЧКИ ИГРОКА") < prompt.index("Карточки инструкций игрока:")


def test_story_system_prompt_forbids_playing_as_main_hero() -> None:
    prompt = _story_prompt(
        world_cards=[{"kind": "main_hero", "title": "Алекс", "content": "Главный герой."}],
    )

    assert "ГРАНИЦА ГЛАВНОГО ГЕРОЯ" in prompt
    assert "управляет только игрок" in prompt
    assert "Алекс" in prompt


def test_story_system_prompt_forbids_retelling_latest_player_turn() -> None:
    prompt = _story_prompt()

    assert "не пересказывай" in prompt
    assert "последний ход игрока" in prompt


def test_base_story_system_prompt_stays_within_budget() -> None:
    prompt = _story_prompt()

    # The hardened protocol, example, and mandatory unregistered-speaker rules deliberately
    # trade a little length for unbreakable formatting; keep a ceiling against unbounded bloat.
    assert len(prompt) <= 7800


def test_story_json_prompts_are_json_only_and_hide_reasoning() -> None:
    message_samples = {
        "world_card_extraction": _combined_message_text(
            main._build_story_world_card_extraction_messages("игрок", "ответ", [])
        ),
        "world_card_change": _combined_message_text(
            main._build_story_world_card_change_messages("игрок", "ответ", [])
        ),
        "plot_memory_create": _combined_message_text(
            main._build_story_plot_card_memory_messages(
                existing_card=None,
                latest_assistant_text="ответ",
                latest_user_prompt="игрок",
                latest_turn_memory_delta="дельта",
            )
        ),
        "important_memory": _combined_message_text(
            story_memory_prompts.build_important_memory_messages(
                player_turn="игрок",
                narrator_response="ответ",
                existing_memories=[],
            )
        ),
        "detailed_memory": _combined_message_text(
            story_memory_prompts.build_detailed_memory_messages(
                player_turn="игрок",
                narrator_response="ответ",
            )
        ),
        "compressed_memory": _combined_message_text(
            story_memory_prompts.build_compressed_memory_messages(detailed_blocks=[])
        ),
        "fact_memory": _combined_message_text(
            story_memory_prompts.build_fact_memory_messages(compressed_blocks=[])
        ),
        "game_state_analysis": _combined_message_text(
            story_memory_prompts.build_game_state_analysis_messages(
                requested_modules=[],
                world_card="",
                previous_location=None,
                player_character_card=None,
                existing_character_cards=[],
                npc_dedup_candidates=[],
                current_character_states=[],
                player_turn="игрок",
                previous_narrator_response="",
                narrator_response="ответ",
            )
        ),
    }

    source_samples = {
        "main_translate_batch": inspect.getsource(main._translate_text_batch_with_polza),
        "service_translate_batch": inspect.getsource(story_prompt_engine._translate_text_batch_with_polza),
        "ambient_profile": inspect.getsource(main._resolve_story_ambient_profile),
        "plot_title": inspect.getsource(main._generate_story_plot_card_title_with_polza),
    }

    for label, text in {**message_samples, **source_samples}.items():
        _assert_json_only_contract(label, text)


def test_legacy_prompt_phrases_do_not_return_to_prompt_sources() -> None:
    sources = {
        "main": inspect.getsource(main),
        "story_games_router": inspect.getsource(story_games_router),
        "story_generate_router": inspect.getsource(story_generate_router),
        "story_graph": inspect.getsource(story_graph),
        "story_map": inspect.getsource(story_map),
        "story_memory_prompts": inspect.getsource(story_memory_prompts),
        "story_prompt_engine": inspect.getsource(story_prompt_engine),
        "story_smart_regeneration": inspect.getsource(story_smart_regeneration),
        "story_novel": inspect.getsource(story_novel),
    }
    forbidden_phrases = (
        "Return strict JSON",
        "Верни строго JSON",
        "Верни только JSON без markdown",
        "valid JSON only",
        "IMMUTABLE OUTPUT PROTOCOL",
        "PLAYER INSTRUCTION PRIORITY",
        "STORY_DIALOGUE_FORMAT_RULES_V2",
        "STORY_MODEL_SPECIFIC_RULES",
    )

    for label, source in sources.items():
        for phrase in forbidden_phrases:
            assert phrase not in source, f"{label} still contains {phrase!r}"
