from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import main
from app.services import story_runtime


def _sanitize(text: str) -> str:
    return main._sanitize_story_stream_markup_formatting(text)


def test_sanitizer_rewrites_deepseek_invented_inline_markup() -> None:
    # The exact failure players reported on DeepSeek V4 Pro: markdown code fences wrapping a
    # made-up ``markup:: npc_name:'Имя'`` tag instead of the canonical [[NPC:Имя]] marker.
    broken = "``markup:: npc_name:'Виринтис'`` Ты опоздал."

    assert _sanitize(broken) == "[[NPC:Виринтис]] Ты опоздал."


def test_sanitizer_merges_speaker_only_invented_tag_with_following_paragraph() -> None:
    broken = "``markup:: npc_name:'Виринтис'``\n\n«Сообщение промаркировали как экстренное.»"

    assert _sanitize(broken) == "[[NPC:Виринтис]] «Сообщение промаркировали как экстренное.»"


def test_sanitizer_strips_markdown_emphasis_around_plain_speaker_line() -> None:
    assert _sanitize("**Акари:** Привет, друг.") == "[[NPC:Акари]] Привет, друг."


def test_sanitizer_handles_angle_and_thought_forms() -> None:
    assert _sanitize("<npc:Мия> Привет!") == "[[NPC:Мия]] Привет!"
    assert _sanitize("<gg_thought: Алекс> Надо бежать.") == "[[GG_THOUGHT:Алекс]] Надо бежать."


def test_sanitizer_unwraps_fenced_canonical_markers() -> None:
    assert _sanitize("```\n[[NPC:Лина]] Слушай меня.\n```") == "[[NPC:Лина]] Слушай меня."


def test_sanitizer_is_idempotent_on_clean_output() -> None:
    clean = "Дверь скрипнула.\n\n[[NPC:Акари]] Ты пришёл.\n\n[[NPC_THOUGHT:Акари]] Наконец-то."

    assert _sanitize(clean) == clean
    assert _sanitize(_sanitize(clean)) == clean


def test_sanitizer_keeps_plain_narration_untouched() -> None:
    narration = "Холодный ветер ворвался в комнату и качнул пламя свечи."

    assert _sanitize(narration) == narration


def test_sanitizer_returns_empty_for_empty_input() -> None:
    assert _sanitize("") == ""
    assert _sanitize("   \n  ") == ""


SCREENSHOT_LIKE_UNMARKED_DIALOGUE = (
    "Его лицо вытянулось, а напудренные щёки пошли красными пятнами. "
    "Он явно не ожидал такого ответа.\n"
    "Ты... ты хоть понимаешь, к кому обращаешься, грязная деревенщина?!\n"
    "Его рука в светлой перчатке нервно легла на эфес кинжала."
)


def test_strict_guard_rejects_screenshot_like_bare_utterance_and_dash_speech() -> None:
    assert main._story_paragraph_has_unformatted_dialogue(SCREENSHOT_LIKE_UNMARKED_DIALOGUE)
    assert not main._is_story_strict_markup_output(SCREENSHOT_LIKE_UNMARKED_DIALOGUE)
    assert not main._is_story_strict_markup_output("— Ты опоздал, — сказал аристократ.")


def test_strict_guard_keeps_plain_narration_out_of_repair() -> None:
    ordinary_narration = (
        "Холодный ветер ворвался в комнату и качнул пламя свечи.\n\n"
        "Над дверью висела вывеска «Заря», потемневшая от дождя.\n\n"
        "Он ничего не сказал и молча вышел из комнаты.\n\n"
        "Она посмотрела на тебя!"
    )
    normalizer = Mock(return_value="этот результат не должен использоваться")

    assert main._is_story_strict_markup_output(ordinary_narration)
    assert (
        story_runtime._sanitize_streamed_story_markup(
            ordinary_narration,
            normalize_generated_story_output=normalizer,
        )
        == ordinary_narration
    )
    normalizer.assert_not_called()


def test_streamed_guard_calls_existing_model_assisted_repair_for_bare_utterance() -> None:
    repaired = (
        "Его лицо вытянулось, а напудренные щёки пошли красными пятнами.\n\n"
        "[[NPC:Аристократ]] Ты... ты хоть понимаешь, к кому обращаешься?!\n\n"
        "Его рука легла на эфес кинжала."
    )
    normalizer = Mock(return_value=repaired)
    world_cards = [{"kind": "npc", "title": "Лорд Эдвин", "content": "..."}]

    result = story_runtime._sanitize_streamed_story_markup(
        SCREENSHOT_LIKE_UNMARKED_DIALOGUE,
        normalize_generated_story_output=normalizer,
        world_cards=world_cards,
        model_name="z-ai/glm-4.7-flash",
        show_gg_thoughts=True,
        show_npc_thoughts=False,
    )

    assert result == repaired
    normalizer.assert_called_once()
    call_kwargs = normalizer.call_args.kwargs
    assert call_kwargs["world_cards"] == world_cards
    assert call_kwargs["model_name"] == "z-ai/glm-4.7-flash"
    assert call_kwargs["show_gg_thoughts"] is True
    assert call_kwargs["show_npc_thoughts"] is False


def test_generated_output_normalizer_reaches_markup_repair_for_bare_utterance() -> None:
    repaired = "[[NPC:Аристократ]] Ты хоть понимаешь, к кому обращаешься?!"
    with (
        patch.object(main, "settings", SimpleNamespace(polza_api_key="test-key")),
        patch.object(main, "_repair_story_markup_with_polza", return_value=repaired) as repair_mock,
    ):
        result = main._normalize_generated_story_output(
            text_value=SCREENSHOT_LIKE_UNMARKED_DIALOGUE,
            world_cards=[],
            model_name="z-ai/glm-4.7-flash",
        )

    assert result == repaired
    repair_mock.assert_called_once()


def test_streamed_guard_is_idempotent_for_canonical_markers() -> None:
    clean = "Дверь скрипнула.\n\n[[NPC:Акари]] Ты пришёл."
    normalizer = Mock(return_value="не должно использоваться")

    assert (
        story_runtime._sanitize_streamed_story_markup(
            clean,
            normalize_generated_story_output=normalizer,
        )
        == clean
    )
    normalizer.assert_not_called()


def test_strict_guard_repairs_only_forbidden_generic_speaker_labels() -> None:
    for generic_label in ("НПС", "NPC", "Голос", "Незнакомец", "Персонаж"):
        assert not main._is_story_strict_markup_output(
            f"[[NPC:{generic_label}]] Ты опоздал."
        )

    assert main._is_story_strict_markup_output("[[NPC:Аристократ]] Ты опоздал.")
    assert main._is_story_strict_markup_output("[[NPC:Лорд Эдвин]] Ты опоздал.")
