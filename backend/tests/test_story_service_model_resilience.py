from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as monolith_main  # noqa: E402
from app.services import story_generation_provider, story_memory_pipeline  # noqa: E402
from app.services.story_service_budget import (  # noqa: E402
    StoryServiceHttpRequestBudget,
    use_story_service_http_request_budget,
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class StoryServiceModelResilienceTests(unittest.TestCase):
    def test_candidate_models_keep_explicit_fallback_when_service_fallback_is_disabled(self) -> None:
        candidates = story_generation_provider._build_polza_story_candidate_models(
            "google/gemma-4-31b-it:free",
            allow_service_fallback=False,
            fallback_model_names=["nex-agi/nex-n2-pro:free"],
        )

        self.assertEqual(
            candidates,
            [
                "google/gemma-4-31b-it:free",
                "nex-agi/nex-n2-pro:free",
            ],
        )

    def test_memory_service_calls_always_receive_configured_service_fallback(self) -> None:
        with patch.object(monolith_main, "_request_polza_story_text", return_value="{}") as request_mock:
            story_memory_pipeline._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                model_name=story_memory_pipeline.STORY_TURN_POSTPROCESS_MODEL,
                allow_service_fallback=False,
                fallback_model_names=[],
            )

        fallback_models = request_mock.call_args.kwargs["fallback_model_names"]
        self.assertIn(monolith_main.settings.polza_service_fallback_model, fallback_models)

    def test_memory_compression_can_disable_implicit_service_fallback(self) -> None:
        with patch.object(monolith_main, "_request_polza_story_text", return_value="ok") as request_mock:
            story_memory_pipeline._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                model_name=story_memory_pipeline.STORY_TURN_POSTPROCESS_MODEL,
                allow_service_fallback=False,
                fallback_model_names=[],
                include_configured_service_fallback=False,
            )

        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])

    def test_accelerated_game_routes_service_call_to_paid_model_pair(self) -> None:
        game = SimpleNamespace(accelerated_service_enabled=True)

        with patch.object(monolith_main, "_request_polza_story_text", return_value="{}") as request_mock:
            story_memory_pipeline._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                service_game=game,
                model_name=story_memory_pipeline.STORY_TURN_POSTPROCESS_MODEL,
                fallback_model_names=[],
            )

        self.assertEqual(
            request_mock.call_args.kwargs["model_name"],
            "google/gemini-2.5-flash-lite",
        )
        self.assertEqual(
            request_mock.call_args.kwargs["fallback_model_names"],
            ["openai/gpt-oss-120b"],
        )

    def test_standard_game_uses_gemini_flash_service_model_pair(self) -> None:
        primary_model, fallback_models = monolith_main._resolve_story_service_model_pair(
            SimpleNamespace(accelerated_service_enabled=False)
        )

        self.assertEqual(primary_model, "google/gemini-2.5-flash")
        self.assertEqual(fallback_models, ["nex-agi/nex-n2-pro:free"])

    def test_gpt_oss_fallback_keeps_required_reasoning_but_excludes_it_from_output(self) -> None:
        payload: dict = {}

        monolith_main._apply_polza_story_reasoning_preferences(
            payload,
            model_name="openai/gpt-oss-120b",
        )

        self.assertEqual(payload["reasoning"], {"effort": "low", "exclude": True})

    def test_openrouter_service_request_falls_back_after_primary_model_rate_limit(self) -> None:
        rate_limited = _FakeResponse(
            429,
            {
                "error": {
                    "message": "Provider returned error",
                    "metadata": {"raw": "temporarily rate-limited upstream"},
                }
            },
        )
        success = _FakeResponse(
            200,
            {
                "choices": [
                    {
                        "message": {"content": "{\"ok\":true}"},
                    }
                ]
            },
        )

        with patch.object(monolith_main.HTTP_SESSION, "post", side_effect=[rate_limited, success]) as post_mock:
            result = monolith_main._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                model_name="google/gemma-4-31b-it:free",
                fallback_model_names=["nex-agi/nex-n2-pro:free"],
                allow_service_fallback=False,
                retry_on_rate_limit=False,
            )

        self.assertEqual(result, "{\"ok\":true}")
        requested_models = [call.kwargs["json"]["model"] for call in post_mock.call_args_list]
        self.assertEqual(
            requested_models,
            [
                "google/gemma-4-31b-it:free",
                "nex-agi/nex-n2-pro:free",
            ],
        )

    def test_accelerated_service_fallback_uses_exactly_two_http_requests(self) -> None:
        rate_limited = _FakeResponse(429, {"error": {"message": "rate limited"}})
        success = _FakeResponse(
            200,
            {"choices": [{"message": {"content": "{\"ok\":true}"}}]},
        )

        with patch.object(monolith_main.HTTP_SESSION, "post", side_effect=[rate_limited, success]) as post_mock:
            result = monolith_main._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                model_name="google/gemini-2.5-flash-lite",
                fallback_model_names=["openai/gpt-oss-120b"],
                allow_service_fallback=False,
                retry_on_rate_limit=False,
            )

        self.assertEqual(result, "{\"ok\":true}")
        self.assertEqual(post_mock.call_count, 2)
        self.assertEqual(
            [call.kwargs["json"]["model"] for call in post_mock.call_args_list],
            ["google/gemini-2.5-flash-lite", "openai/gpt-oss-120b"],
        )

    def test_turn_service_http_budget_blocks_fourth_request(self) -> None:
        success = _FakeResponse(
            200,
            {"choices": [{"message": {"content": "{\"ok\":true}"}}]},
        )
        budget = StoryServiceHttpRequestBudget(max_requests=3)

        with (
            patch.object(monolith_main.HTTP_SESSION, "post", return_value=success) as post_mock,
            use_story_service_http_request_budget(budget),
        ):
            for _ in range(3):
                monolith_main._request_polza_story_text(
                    [{"role": "user", "content": "test"}],
                    model_name="google/gemma-4-31b-it:free",
                    fallback_model_names=[],
                    retry_on_rate_limit=False,
                )
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                monolith_main._request_polza_story_text(
                    [{"role": "user", "content": "blocked"}],
                    model_name="google/gemma-4-31b-it:free",
                    fallback_model_names=[],
                    retry_on_rate_limit=False,
                )

        self.assertEqual(post_mock.call_count, 3)
        self.assertEqual(budget.used_requests, 3)

    def test_unified_postprocess_adds_auto_npcs_without_extra_model_call(self) -> None:
        game = SimpleNamespace(
            id=7,
            environment_current_datetime="",
            environment_current_weather="",
            environment_tomorrow_weather="",
            environment_turn_step_minutes=5,
        )

        with (
            patch.object(
                story_memory_pipeline,
                "settings",
                SimpleNamespace(polza_api_key="test-key"),
            ),
            patch.object(story_memory_pipeline, "_get_story_main_hero_name_for_memory", return_value="Alex"),
            patch.object(story_memory_pipeline, "_list_story_known_character_names_for_memory", return_value=["Alex"]),
            patch.object(
                story_memory_pipeline,
                "_request_polza_story_text",
                return_value='{"auto_npcs":[]}',
            ) as request_mock,
        ):
            payload = story_memory_pipeline._extract_story_postprocess_memory_payload(
                db=SimpleNamespace(),
                game=game,
                current_location_content="",
                latest_user_prompt="I greet Mira.",
                previous_assistant_text="",
                latest_assistant_text="Mira answers.",
                raw_memory_enabled=False,
                location_enabled=False,
                environment_enabled=False,
                character_state_enabled=False,
                important_event_enabled=False,
                auto_npc_cards_enabled=True,
            )

        self.assertEqual(payload, {"auto_npcs": []})
        self.assertEqual(request_mock.call_count, 1)
        self.assertFalse(request_mock.call_args.kwargs["retry_on_rate_limit"])
        system_prompt = request_mock.call_args.args[0][0]["content"]
        self.assertIn("Enabled sections: auto_npcs", system_prompt)

    def test_auto_npc_override_never_starts_separate_model_request(self) -> None:
        game = SimpleNamespace(id=7, auto_npc_cards_enabled=True)

        with (
            patch.object(story_memory_pipeline, "_list_story_world_cards", return_value=[]),
            patch.object(story_memory_pipeline, "_request_polza_story_text") as request_mock,
        ):
            created = story_memory_pipeline._sync_story_auto_npc_cards_for_assistant_message(
                db=SimpleNamespace(),
                game=game,
                assistant_message=SimpleNamespace(id=11),
                latest_user_prompt="I enter.",
                latest_assistant_text="The room is empty.",
                resolved_payload_override=[],
                allow_model_request=False,
            )

        self.assertEqual(created, [])
        request_mock.assert_not_called()

    def test_memory_compression_uses_one_request_without_retry(self) -> None:
        valid_memory_text = (
            "Alex \u0432\u043e\u0448\u0435\u043b \u0432 \u0437\u0430\u043b "
            "\u0438 \u0437\u0430\u043a\u0440\u044b\u043b \u0434\u0432\u0435\u0440\u044c."
        )
        with (
            patch.object(
                story_memory_pipeline,
                "settings",
                SimpleNamespace(polza_api_key="test-key"),
            ),
            patch.object(
                story_memory_pipeline,
                "_request_polza_story_text",
                return_value=valid_memory_text,
            ) as request_mock,
        ):
            _, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content=valid_memory_text,
                model_name="google/gemma-4-31b-it:free",
                fallback_model_names=[],
                super_mode=False,
                player_name="Alex",
                known_character_names=["Alex"],
            )

        self.assertEqual(content, valid_memory_text)
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])
        self.assertFalse(request_mock.call_args.kwargs["retry_on_rate_limit"])


if __name__ == "__main__":
    unittest.main()
