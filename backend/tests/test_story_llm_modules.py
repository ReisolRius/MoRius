from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_llm_modules import strict_json_loads  # noqa: E402


class StoryLlmModuleTests(unittest.TestCase):
    def test_json_loader_accepts_fenced_provider_response(self) -> None:
        parsed = strict_json_loads(
            '```json\n{"summary":"compressed","open_threads":[]}\n```'
        )

        self.assertEqual(parsed["summary"], "compressed")

    def test_json_loader_rejects_response_without_json_object(self) -> None:
        with self.assertRaises(ValueError):
            strict_json_loads("no structured payload")


if __name__ == "__main__":
    unittest.main()
