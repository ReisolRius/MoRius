from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as monolith_main  # noqa: E402


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = ""
        self.reason = ""

    def json(self) -> dict:
        return self._payload


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

    def test_text_model_provider_pinning_is_disabled_for_openrouter(self) -> None:
        payload = monolith_main._build_polza_provider_payload("anthropic/claude-sonnet-4.6")

        self.assertIsNone(payload)

    def test_seedream_prompt_limit_matches_media_api_cap(self) -> None:
        self.assertEqual(
            monolith_main._get_story_turn_image_request_prompt_max_chars(
                monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM,
            ),
            20_000,
        )
        limited_prompt = monolith_main._limit_story_turn_image_request_prompt(
            "x" * 20_500,
            model_name=monolith_main.STORY_TURN_IMAGE_MODEL_SEEDREAM,
        )

        self.assertEqual(len(limited_prompt), 20_000)

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

    def test_image_request_retries_504_and_returns_success_without_exposing_error(self) -> None:
        gateway_timeout = _FakeResponse(
            504,
            {"error": {"message": "temporary upstream gateway timeout"}},
        )
        success = _FakeResponse(
            200,
            {
                "model": monolith_main.STORY_TURN_IMAGE_MODEL_FLUX,
                "choices": [
                    {
                        "message": {
                            "images": [
                                {"image_url": {"url": "https://cdn.example/recovered.png"}},
                            ]
                        }
                    }
                ],
            },
        )

        patched_settings = replace(
            monolith_main.settings,
            polza_api_key="test-key",
            polza_chat_url="https://example.test/v1/chat/completions",
            polza_image_url="",
        )
        with (
            patch.object(monolith_main, "settings", patched_settings),
            patch.object(monolith_main.HTTP_SESSION, "post", side_effect=[gateway_timeout, success]) as post_mock,
            patch.object(monolith_main.time, "sleep", return_value=None),
        ):
            payload = monolith_main._request_polza_story_turn_image(
                prompt="scene",
                model_name=monolith_main.STORY_TURN_IMAGE_MODEL_FLUX,
            )

        self.assertEqual(payload["image_url"], "https://cdn.example/recovered.png")
        self.assertEqual(post_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
