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


def test_story_system_prompt_includes_glm51_model_hint() -> None:
    prompt = _story_prompt(model_name="z-ai/glm-5.1")

    assert "ОСОБЕННОСТЬ ЭТОЙ МОДЕЛИ:" in prompt
    assert "z-ai/glm-5.1" in main.STORY_MODEL_HINTS
    assert main.STORY_MODEL_HINTS["z-ai/glm-5.1"][0] in prompt
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

    # The hardened protocol + example deliberately trades a little length for unbreakable
    # formatting; keep a ceiling so the base prompt cannot bloat unbounded.
    assert len(prompt) <= 7000


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
