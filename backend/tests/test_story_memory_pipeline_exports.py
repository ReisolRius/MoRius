from __future__ import annotations

import ast
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402


class StoryMemoryPipelineExportTests(unittest.TestCase):
    def test_all_app_references_to_story_memory_pipeline_exist(self) -> None:
        app_root = Path(__file__).resolve().parents[1] / "app"
        referenced: set[str] = set()
        for path in app_root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                    if node.value.id in {"story_memory_pipeline", "_story_memory_pipeline"}:
                        referenced.add(node.attr)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "getattr":
                    args = node.args
                    if (
                        len(args) >= 2
                        and isinstance(args[0], ast.Name)
                        and args[0].id in {"story_memory_pipeline", "_story_memory_pipeline"}
                        and isinstance(args[1], ast.Constant)
                        and isinstance(args[1].value, str)
                    ):
                        referenced.add(args[1].value)

        missing = sorted(name for name in referenced if not hasattr(story_memory_pipeline, name))

        self.assertEqual(missing, [])

    def test_environment_time_and_weather_prompt_cards_are_available(self) -> None:
        game = SimpleNamespace(
            environment_enabled=True,
            environment_time_enabled=True,
            environment_weather_enabled=True,
            environment_current_datetime="2026-06-19T14:30:00",
            environment_current_weather=(
                '{"summary":"тепло и облачно","temperature_c":22,'
                '"wind":"слабый","humidity":"умеренная","day_date":"2026-06-19"}'
            ),
            environment_tomorrow_weather='{"summary":"яснее","temperature_c":24,"day_date":"2026-06-20"}',
        )

        time_card = story_memory_pipeline._build_story_environment_time_prompt_card(game)
        weather_card = story_memory_pipeline._build_story_environment_weather_prompt_card(game)

        self.assertIsInstance(time_card, dict)
        self.assertIn("14:30", time_card["content"])
        self.assertIsInstance(weather_card, dict)
        self.assertIn("тепло и облачно", weather_card["content"])
        self.assertIn("яснее", weather_card["content"])

    def test_environment_seed_and_repair_are_deterministic_without_llm(self) -> None:
        game = SimpleNamespace(
            id=7,
            environment_enabled=True,
            environment_time_enabled=True,
            environment_weather_enabled=True,
            environment_current_datetime="2026-06-19T14:30:00",
            environment_current_weather="",
            environment_tomorrow_weather="",
            current_location_label="лесная дорога",
            opening_scene="",
        )

        class FakeSession:
            def flush(self):
                return None

        changed = story_memory_pipeline._ensure_story_environment_seeded(db=FakeSession(), game=game)
        current_weather = story_memory_pipeline._deserialize_story_environment_weather(game.environment_current_weather)
        tomorrow_weather = story_memory_pipeline._deserialize_story_environment_weather(game.environment_tomorrow_weather)

        self.assertTrue(changed)
        self.assertIsInstance(current_weather, dict)
        self.assertIsInstance(tomorrow_weather, dict)
        self.assertEqual(current_weather["day_date"], "2026-06-19")
        self.assertEqual(tomorrow_weather["day_date"], "2026-06-20")
        self.assertIsInstance(current_weather.get("timeline"), list)


if __name__ == "__main__":
    unittest.main()
