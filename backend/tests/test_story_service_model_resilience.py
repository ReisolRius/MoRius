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


class _FakeStreamResponse(_FakeResponse):
    def __init__(self, lines: list[str], *, status_code: int = 200, payload: dict | None = None) -> None:
        super().__init__(status_code, payload or {})
        self._lines = lines
        self.encoding = ""
        self.closed = False

    def iter_lines(self, **_kwargs):
        yield from self._lines

    def close(self) -> None:
        self.closed = True


class StoryServiceModelResilienceTests(unittest.TestCase):
    def test_story_response_limit_remains_3000_tokens(self) -> None:
        self.assertEqual(monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX, 3_000)

    def test_aion_openrouter_request_is_fitted_inside_combined_context_window(self) -> None:
        oversized_messages = [
            {"role": "system", "content": "system rules"},
            {"role": "assistant", "content": "old scene " * 140_000},
            {"role": "user", "content": "latest turn"},
        ]
        response = _FakeResponse(
            200,
            {
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": "ok"},
                    }
                ]
            },
        )

        with patch.object(story_generation_provider.HTTP_SESSION, "post", return_value=response) as post_mock:
            result = story_generation_provider._request_polza_story_text(
                oversized_messages,
                model_name="aion-labs/aion-2.0",
                translate_input=False,
                max_tokens=None,
            )

        self.assertEqual(result, "ok")
        request_payload = post_mock.call_args.kwargs["json"]
        self.assertEqual(request_payload["max_tokens"], 3_000)
        self.assertEqual(request_payload["max_completion_tokens"], 3_000)
        fitted_messages = request_payload["messages"]
        self.assertEqual(fitted_messages[-1]["role"], "user")
        self.assertEqual(fitted_messages[-1]["content"], "latest turn")

        input_budget = int(
            (
                monolith_main.STORY_AION_CONTEXT_WINDOW_TOKENS
                - monolith_main.STORY_RESPONSE_MAX_TOKENS_MAX
                - monolith_main.STORY_AION_PROMPT_OVERHEAD_RESERVE_TOKENS
            )
            / monolith_main.STORY_AION_INPUT_TOKENIZER_SAFETY_FACTOR
        )
        self.assertLessEqual(
            story_generation_provider._estimate_polza_messages_input_tokens(fitted_messages),
            input_budget,
        )

    def test_openrouter_turn_retry_covers_transient_gateway_and_timeout_statuses(self) -> None:
        for status_code in (408, 409, 425, 429, 499, 500, 502, 503, 504):
            with self.subTest(status_code=status_code):
                self.assertTrue(
                    story_generation_provider._should_retry_polza_chat_request(
                        status_code=status_code,
                        detail="temporary upstream failure",
                        attempt_index=0,
                    )
                )

        self.assertFalse(
            story_generation_provider._should_retry_polza_chat_request(
                status_code=400,
                detail="maximum context length exceeded",
                attempt_index=0,
            )
        )

    def test_content_policy_error_is_never_retried(self) -> None:
        self.assertFalse(
            story_generation_provider._should_retry_polza_chat_request(
                status_code=400,
                detail="Prohibited request: content policy violation",
                attempt_index=0,
            )
        )
        self.assertFalse(
            story_generation_provider._should_retry_polza_turn_failure(
                model_name="google/gemini-3.1-pro-preview",
                attempt_index=0,
                status_code=400,
                detail="request is prohibited by safety policy",
            )
        )

    def test_incomplete_stream_is_rejected_for_every_narrator_model(self) -> None:
        for model_name in (
            "google/gemini-3.1-pro-preview",
            "aion-labs/aion-2.0",
            "minimax/minimax-m2-her",
            "google/gemini-3.1-flash-lite",
            "deepseek/deepseek-v3.2",
            "z-ai/glm-5.1",
        ):
            with self.subTest(model_name=model_name):
                self.assertTrue(
                    story_generation_provider._is_polza_incomplete_stream_result(
                        model_name=model_name,
                        finish_reason=None,
                        saw_done_marker=False,
                    )
                )
                self.assertFalse(
                    story_generation_provider._is_polza_incomplete_stream_result(
                        model_name=model_name,
                        finish_reason="length",
                        saw_done_marker=True,
                    )
                )

    def test_turn_retry_policy_applies_to_every_narrator_model(self) -> None:
        for model_name in (
            "google/gemini-3.1-pro-preview",
            "aion-labs/aion-2.0",
            "minimax/minimax-m2-her",
            "google/gemini-3.1-flash-lite",
            "deepseek/deepseek-v3.2",
            "z-ai/glm-5.1",
            "anthropic/claude-sonnet-4.6",
        ):
            with self.subTest(model_name=model_name):
                self.assertTrue(
                    story_generation_provider._should_retry_polza_turn_failure(
                        model_name=model_name,
                        attempt_index=0,
                        status_code=500,
                        detail="internal server error",
                    )
                )

    def test_background_text_request_retries_transient_failure_on_same_model(self) -> None:
        success = _FakeResponse(
            200,
            {"choices": [{"message": {"content": "{\"ok\":true}"}}]},
        )
        for model_name in (
            "google/gemini-2.5-flash",
            "aion-labs/aion-2.0",
            "deepseek/deepseek-v3.2",
            "z-ai/glm-5.1",
        ):
            with self.subTest(model_name=model_name):
                temporary_failure = _FakeResponse(
                    500,
                    {"error": {"message": "temporary upstream failure"}},
                )
                with (
                    patch.object(
                        monolith_main.HTTP_SESSION,
                        "post",
                        side_effect=[temporary_failure, success],
                    ) as post_mock,
                    patch.object(monolith_main.time, "sleep", return_value=None),
                ):
                    result = monolith_main._request_polza_story_text(
                        [{"role": "user", "content": "test"}],
                        model_name=model_name,
                        fallback_model_names=[],
                        allow_service_fallback=False,
                        retry_on_rate_limit=True,
                    )

                self.assertEqual(result, "{\"ok\":true}")
                self.assertEqual(post_mock.call_count, 2)
                self.assertEqual(
                    [call.kwargs["json"]["model"] for call in post_mock.call_args_list],
                    [model_name, model_name],
                )

    def test_background_text_request_never_retries_content_policy_error(self) -> None:
        prohibited = _FakeResponse(
            400,
            {"error": {"message": "Prohibited request: content policy violation"}},
        )
        with (
            patch.object(monolith_main.HTTP_SESSION, "post", return_value=prohibited) as post_mock,
            patch.object(monolith_main.time, "sleep", return_value=None),
        ):
            with self.assertRaisesRegex(RuntimeError, "Prohibited request"):
                monolith_main._request_polza_story_text(
                    [{"role": "user", "content": "test"}],
                    model_name="google/gemini-2.5-flash",
                    fallback_model_names=[],
                    allow_service_fallback=False,
                    retry_on_rate_limit=True,
                )

        self.assertEqual(post_mock.call_count, 1)

    def test_successful_stream_keeps_final_message_tail_after_deltas(self) -> None:
        response = _FakeStreamResponse(
            [
                'data: {"choices":[{"delta":{"content":"Начало "}}]}',
                (
                    'data: {"choices":[{"delta":{"content":"и "},'
                    '"message":{"content":"Начало и конец."},'
                    '"finish_reason":"stop"}]}'
                ),
                "data: [DONE]",
            ]
        )
        with (
            patch.object(
                story_generation_provider,
                "_build_story_provider_messages",
                return_value=[
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": "turn"},
                ],
            ),
            patch.object(story_generation_provider.HTTP_SESSION, "post", return_value=response) as post_mock,
            patch.object(story_generation_provider, "_recover_polza_story_stream_tail") as recover_mock,
        ):
            chunks = list(
                story_generation_provider._iter_polza_story_stream_chunks(
                    [],
                    [],
                    [],
                    [],
                    context_limit_chars=6_000,
                    model_name="google/gemini-3.1-pro-preview",
                    max_tokens=4_500,
                )
            )

        self.assertEqual("".join(chunks), "Начало и конец.")
        self.assertTrue(response.closed)
        self.assertEqual(post_mock.call_args.kwargs["headers"]["Accept-Encoding"], "identity")
        recover_mock.assert_not_called()

    def test_broken_stream_recovers_only_missing_tail_without_full_restart(self) -> None:
        response = _FakeStreamResponse(
            ['data: {"choices":[{"delta":{"content":"Начало "}}]}']
        )
        with (
            patch.object(
                story_generation_provider,
                "_build_story_provider_messages",
                return_value=[
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": "turn"},
                ],
            ),
            patch.object(story_generation_provider.HTTP_SESSION, "post", return_value=response) as post_mock,
            patch.object(
                story_generation_provider,
                "_recover_polza_story_stream_tail",
                return_value="и продолжение.",
            ) as recover_mock,
        ):
            chunks = list(
                story_generation_provider._iter_polza_story_stream_chunks(
                    [],
                    [],
                    [],
                    [],
                    context_limit_chars=6_000,
                    model_name="deepseek/deepseek-v3.2",
                    max_tokens=4_500,
                )
            )

        self.assertEqual("".join(chunks), "Начало и продолжение.")
        self.assertEqual(post_mock.call_count, 1)
        recover_mock.assert_called_once()

    def test_stream_recovers_tail_even_when_provider_falsely_reports_stop(self) -> None:
        # Regression guard: Polza/OpenRouter can report finish_reason "stop" (and send [DONE])
        # even though the emitted text was cut off mid-sentence. The dangling-text heuristic
        # must still trigger tail recovery instead of trusting that metadata at face value.
        response = _FakeStreamResponse(
            [
                (
                    'data: {"choices":[{"delta":{"content":"Начало обрыва"},'
                    '"finish_reason":"stop"}]}'
                ),
                "data: [DONE]",
            ]
        )
        with (
            patch.object(
                story_generation_provider,
                "_build_story_provider_messages",
                return_value=[
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": "turn"},
                ],
            ),
            patch.object(story_generation_provider.HTTP_SESSION, "post", return_value=response) as post_mock,
            patch.object(
                story_generation_provider,
                "_recover_polza_story_stream_tail",
                return_value=" и завершение.",
            ) as recover_mock,
        ):
            chunks = list(
                story_generation_provider._iter_polza_story_stream_chunks(
                    [],
                    [],
                    [],
                    [],
                    context_limit_chars=6_000,
                    model_name="deepseek/deepseek-v3.2",
                    max_tokens=3_000,
                )
            )

        self.assertEqual("".join(chunks), "Начало обрыва и завершение.")
        self.assertEqual(post_mock.call_count, 1)
        recover_mock.assert_called_once()

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

    def test_accelerated_flag_is_ignored_by_service_model_pair(self) -> None:
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
            "google/gemini-2.5-flash",
        )
        self.assertEqual(
            request_mock.call_args.kwargs["fallback_model_names"],
            ["nex-agi/nex-n2-pro:free"],
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

    def test_story_reasoning_is_excluded_for_problematic_and_agentic_models(self) -> None:
        for model_name in (
            "aion-labs/aion-2.0",
            "google/gemini-2.5-pro",
            "google/gemini-3.1-pro-preview",
            "minimax/minimax-m2-her",
            "google/gemini-3.1-flash-lite",
        ):
            with self.subTest(model_name=model_name):
                payload: dict = {}

                monolith_main._apply_polza_story_reasoning_preferences(
                    payload,
                    model_name=model_name,
                )

                self.assertEqual(payload["reasoning"], {"exclude": True})

    def test_slow_story_models_do_not_wait_five_minutes_for_first_token(self) -> None:
        self.assertEqual(
            story_generation_provider._polza_story_stream_read_timeout_seconds("google/gemini-2.5-pro"),
            180,
        )
        self.assertEqual(story_generation_provider._story_stream_first_token_timeout_seconds(300), 120.0)
        self.assertEqual(story_generation_provider._story_stream_first_token_timeout_seconds(90), 120.0)

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

    def test_explicit_service_fallback_uses_exactly_two_http_requests(self) -> None:
        rate_limited = _FakeResponse(429, {"error": {"message": "rate limited"}})
        success = _FakeResponse(
            200,
            {"choices": [{"message": {"content": "{\"ok\":true}"}}]},
        )

        with patch.object(monolith_main.HTTP_SESSION, "post", side_effect=[rate_limited, success]) as post_mock:
            result = monolith_main._request_polza_story_text(
                [{"role": "user", "content": "test"}],
                model_name="google/gemini-2.5-flash",
                fallback_model_names=["nex-agi/nex-n2-pro:free"],
                allow_service_fallback=False,
                retry_on_rate_limit=False,
            )

        self.assertEqual(result, "{\"ok\":true}")
        self.assertEqual(post_mock.call_count, 2)
        self.assertEqual(
            [call.kwargs["json"]["model"] for call in post_mock.call_args_list],
            ["google/gemini-2.5-flash", "nex-agi/nex-n2-pro:free"],
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
                return_value=(
                    '{"location":{"should_update":false},'
                    '"auto_state":{"character_updates":[]},'
                    '"npc_cards":{"actions":[]}}'
                ),
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

        self.assertEqual(payload["npc_cards"]["actions"], [])
        self.assertEqual(payload["auto_npcs"], [])
        self.assertEqual(request_mock.call_count, 1)
        self.assertTrue(request_mock.call_args.kwargs["retry_on_rate_limit"])
        user_prompt = request_mock.call_args.args[0][1]["content"]
        self.assertIn('"npc_cards"', user_prompt)

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

    def test_memory_compression_uses_one_request_when_primary_returns_valid_json(self) -> None:
        valid_memory_json = (
            '{"summary":"Alex вошел в зал и закрыл дверь.",'
            '"important_entities":[],"state_changes":[],"open_threads":[]}'
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
                return_value=valid_memory_json,
            ) as request_mock,
        ):
            _, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content="PLAYER_TURN:\nAlex enters.\n\nNARRATOR_RESPONSE:\nAlex вошел в зал.",
                model_name="google/gemma-4-31b-it:free",
                fallback_model_names=[],
                super_mode=False,
                player_name="Alex",
                known_character_names=["Alex"],
            )

        self.assertEqual(content, "Alex вошел в зал и закрыл дверь.")
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(request_mock.call_args.kwargs["model_name"], story_memory_pipeline.POLZA_GEMINI_25_FLASH_MODEL)
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])
        self.assertTrue(request_mock.call_args.kwargs["retry_on_rate_limit"])

    def test_memory_compression_does_not_retry_after_invalid_json(self) -> None:
        valid_memory_json = (
            '{"summary":"Alex entered the hall.",'
            '"important_entities":[],"state_changes":[],"open_threads":[]}'
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            side_effect=["not json", valid_memory_json],
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "LLM_DETAILED_MEMORY_PROMPT LLM JSON call failed"):
                story_memory_pipeline._compress_story_memory_block_with_model(
                    raw_content="PLAYER_TURN:\nAlex enters.\n\nNARRATOR_RESPONSE:\nAlex entered the hall.",
                )

        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(
            [call.kwargs["model_name"] for call in request_mock.call_args_list],
            [
                story_memory_pipeline.POLZA_GEMINI_25_FLASH_MODEL,
            ],
        )
        self.assertTrue(all(call.kwargs["fallback_model_names"] == [] for call in request_mock.call_args_list))

    def test_important_memory_uses_only_gemini_flash_and_creates_no_manual_fallback(self) -> None:
        class FakeSession:
            def scalars(self, *_args, **_kwargs):
                return []

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=(
                '{"should_store":true,"title":"Broken oath",'
                '"summary":"Mira broke her oath to Alex and joined the enemy.",'
                '"significance":"The betrayal changes their alliance."}'
            ),
        ) as request_mock:
            payload = story_memory_pipeline._extract_story_important_plot_card_payload(
                db=FakeSession(),
                game=SimpleNamespace(id=77),
                latest_user_prompt="Alex asks Mira to honor the oath.",
                latest_assistant_text="Mira breaks the oath and joins the enemy.",
            )

        self.assertEqual(
            payload,
            ("Broken oath", "Mira broke her oath to Alex and joined the enemy."),
        )
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(
            request_mock.call_args.kwargs["model_name"],
            "google/gemini-2.5-flash",
        )
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])
        self.assertFalse(request_mock.call_args.kwargs["allow_service_fallback"])
        self.assertFalse(request_mock.call_args.kwargs["include_configured_service_fallback"])

    def test_important_memory_skips_routine_turn_when_gemini_marks_it_unimportant(self) -> None:
        class FakeSession:
            def scalars(self, *_args, **_kwargs):
                return []

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value='{"should_store":false,"title":"","summary":"","significance":"routine action"}',
        ):
            payload = story_memory_pipeline._extract_story_important_plot_card_payload(
                db=FakeSession(),
                game=SimpleNamespace(id=78),
                latest_user_prompt="Alex sits down.",
                latest_assistant_text="Alex sits by the window.",
            )

        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
