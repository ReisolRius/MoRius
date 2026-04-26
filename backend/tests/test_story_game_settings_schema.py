from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import StoryGameSettingsUpdateRequest  # noqa: E402


class StoryGameSettingsSchemaTests(unittest.TestCase):
    def test_canonical_admin_fields_exist_when_omitted(self) -> None:
        payload = StoryGameSettingsUpdateRequest(story_llm_model="z-ai/glm-5.1")

        self.assertIsNone(payload.canonical_state_pipeline_enabled)
        self.assertIsNone(payload.canonical_state_safe_fallback_enabled)

    def test_canonical_admin_fields_are_tracked_when_sent(self) -> None:
        payload = StoryGameSettingsUpdateRequest(
            canonical_state_pipeline_enabled=False,
            canonical_state_safe_fallback_enabled=True,
        )

        self.assertFalse(payload.canonical_state_pipeline_enabled)
        self.assertTrue(payload.canonical_state_safe_fallback_enabled)
        self.assertIn("canonical_state_pipeline_enabled", payload.model_fields_set)
        self.assertIn("canonical_state_safe_fallback_enabled", payload.model_fields_set)


if __name__ == "__main__":
    unittest.main()
