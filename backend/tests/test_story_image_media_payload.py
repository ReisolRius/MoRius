from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as monolith_main  # noqa: E402


class StoryImageMediaPayloadTests(unittest.TestCase):
    def test_image_media_payload_uses_polza_auto_provider_routing(self) -> None:
        for model in (
            monolith_main.STORY_TURN_IMAGE_MODEL_FLUX,
            monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM,
            monolith_main.STORY_TURN_IMAGE_MODEL_NANO_BANANO,
            monolith_main.STORY_TURN_IMAGE_MODEL_NANO_BANANO_2,
        ):
            payload = monolith_main._build_story_turn_image_media_payload(
                prompt="test image",
                selected_model=model,
            )

            self.assertNotIn("provider", payload)

    def test_text_model_provider_pinning_still_uses_shared_routing(self) -> None:
        payload = monolith_main._build_polza_provider_payload("anthropic/claude-sonnet-4.6")

        self.assertEqual(payload, {"order": [monolith_main.STORY_POLZA_PROVIDER_MIE], "allow_fallbacks": True})

    def test_seedream_prompt_limit_matches_media_api_cap(self) -> None:
        self.assertEqual(
            monolith_main._get_story_turn_image_request_prompt_max_chars(
                monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM,
            ),
            3_000,
        )
        limited_prompt = monolith_main._limit_story_turn_image_request_prompt(
            "x" * 3_500,
            model_name=monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM,
        )

        self.assertEqual(len(limited_prompt), 3_000)

    def test_media_parser_accepts_output_url_payload(self) -> None:
        parsed = monolith_main._parse_polza_story_turn_image_payload(
            {
                "object": "media.generation",
                "status": "completed",
                "model": monolith_main.STORY_TURN_IMAGE_MODEL_FLUX,
                "output": {"url": "https://cdn.example/image.png"},
            },
            selected_model=monolith_main.STORY_TURN_IMAGE_MODEL_FLUX,
        )

        self.assertEqual(parsed["image_url"], "https://cdn.example/image.png")
        self.assertIsNone(parsed["image_data_url"])


if __name__ == "__main__":
    unittest.main()
