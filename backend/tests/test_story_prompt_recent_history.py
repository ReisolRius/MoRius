from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_prompt_engine import (  # noqa: E402
    STORY_CONTINUE_PROMPT_REPLACEMENT,
    STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES,
    _select_story_history_source,
)


def test_memory_optimization_keeps_bounded_exact_recent_turns() -> None:
    history: list[dict[str, str]] = []
    for turn in range(1, 7):
        history.append({"role": "user", "content": f"ход игрока {turn}"})
        history.append({"role": "assistant", "content": f"ответ рассказчика {turn}"})
    history.append({"role": "user", "content": "новый ход"})

    selected = _select_story_history_source(history, use_plot_memory=True)

    assert len(selected) == STORY_PLOT_MEMORY_RECENT_HISTORY_MAX_MESSAGES
    assert selected[-1] == {"role": "user", "content": "новый ход"}
    assert any(item["content"] == "ответ рассказчика 6" for item in selected)
    assert any(item["content"] == "ход игрока 5" for item in selected)


def test_continue_marker_preserves_recent_scene_and_rewrites_only_latest_command() -> None:
    selected = _select_story_history_source(
        [
            {"role": "user", "content": "Мы вышли из таверны."},
            {"role": "assistant", "content": "Группа дошла до подножия горы."},
            {"role": "user", "content": "Продолжай"},
        ],
        use_plot_memory=True,
    )

    assert selected[0]["content"] == "Мы вышли из таверны."
    assert selected[1]["content"] == "Группа дошла до подножия горы."
    assert selected[-1]["content"] == STORY_CONTINUE_PROMPT_REPLACEMENT
