from __future__ import annotations

from app import main


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
