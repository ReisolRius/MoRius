from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_pipeline  # noqa: E402
from app.services.story_service_budget import (  # noqa: E402
    StoryServiceHttpRequestBudget,
    consume_story_service_http_request,
    use_story_service_http_request_budget,
    use_story_service_http_request_budget_or_reserve,
    use_story_turn_hard_budget,
)


class StoryMemoryCompressionTests(unittest.TestCase):
    def test_latest_full_memory_preserves_player_and_narrator_text_without_manual_summary(self) -> None:
        user_tail = "Финальный приказ игрока должен остаться в памяти целиком."
        assistant_tail = "Финальная реплика рассказчика должна остаться без обрезки."
        content = story_memory_pipeline._build_story_raw_memory_block_content(
            latest_user_prompt=("Алекс объясняет план отхода через северные ворота. " * 20) + user_tail,
            latest_assistant_text=(
                "[[NPC:Марина]] Алисия отмечает, что стража уже меняет караул. " * 20
            )
            + assistant_tail,
            preserve_user_text=False,
            preserve_assistant_text=False,
        )

        self.assertIn("PLAYER_TURN:\n", content)
        self.assertIn("NARRATOR_RESPONSE:\n", content)
        self.assertIn(user_tail, content)
        self.assertIn(assistant_tail, content)
        self.assertNotIn("подробный пересказ", content.casefold())
        self.assertNotIn("[[NPC:", content)

    def test_model_compression_requires_strict_json_and_formats_detailed_memory(self) -> None:
        raw_content = story_memory_pipeline._build_story_raw_memory_block_content(
            latest_user_prompt="Alex входит в зал и закрывает дверь.",
            latest_assistant_text="Марина остается у входа и слушает шаги за стеной.",
        )
        llm_payload = (
            '{"summary":"Alex вошел в зал, закрыл дверь, а Марина осталась слушать шаги.",'
            '"important_entities":[{"name":"Марина","type":"npc","note":"ждет у входа"}],'
            '"state_changes":["дверь закрыта"],'
            '"open_threads":["за стеной слышны шаги"]}'
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=llm_payload,
        ) as request_mock:
            title, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content=raw_content,
                model_name="ignored-old-model",
                fallback_model_names=["ignored-old-fallback"],
                super_mode=False,
                player_name="Alex",
                known_character_names=["Alex", "Марина"],
            )

        self.assertEqual(title, "Подробная память")
        self.assertIn("Alex вошел в зал", content)
        self.assertIn("Марина (npc)", content)
        self.assertIn("дверь закрыта", content)
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(request_mock.call_args.kwargs["model_name"], story_memory_pipeline.POLZA_STORY_SERVICE_TEXT_MODEL)
        self.assertTrue(request_mock.call_args.kwargs["retry_on_rate_limit"])
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])

    def test_invalid_model_payload_raises_without_local_summary_fallback(self) -> None:
        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value="not json",
        ):
            with self.assertRaisesRegex(RuntimeError, "LLM JSON call failed"):
                story_memory_pipeline._compress_story_memory_block_with_model(
                    raw_content="PLAYER_TURN:\nI enter.\n\nNARRATOR_RESPONSE:\nThe room is quiet.",
                )

    def test_missing_terminal_outcome_is_repaired_without_rejecting_compaction(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nГруппа возвращается после задания.\n\n"
            "NARRATOR_RESPONSE:\nГруппа выполнила задание и вернулась в лагерь."
        )
        compressed_without_outcome = json.dumps(
            {
                "summary": "Группа снова находится в лагере.",
                "important_entities": [],
                "state_changes": [],
                "open_threads": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=compressed_without_outcome,
        ) as request_mock:
            title, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content=raw_content,
            )

        self.assertEqual(title, "Подробная память")
        self.assertIn("Группа снова находится в лагере.", content)
        self.assertIn("Группа выполнила задание и вернулась в лагерь.", content)
        story_memory_pipeline._validate_story_memory_terminal_statuses(
            source_content=raw_content,
            result_content=content,
        )
        self.assertEqual(request_mock.call_count, 1)

    def test_memory_compression_has_reserved_service_budget_after_postprocess_budget_is_exhausted(self) -> None:
        valid_memory_json = (
            '{"summary":"Alex entered the hall.",'
            '"important_entities":[],"state_changes":[],"open_threads":[]}'
        )
        outer_budget = StoryServiceHttpRequestBudget(max_requests=1)

        def request_with_budget(*_args, **_kwargs):
            consume_story_service_http_request()
            return valid_memory_json

        with (
            patch.object(
                story_memory_pipeline,
                "_request_polza_story_text",
                side_effect=request_with_budget,
            ) as request_mock,
            use_story_service_http_request_budget(outer_budget),
        ):
            consume_story_service_http_request()
            _, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content="PLAYER_TURN:\nAlex enters.\n\nNARRATOR_RESPONSE:\nAlex entered the hall.",
            )

        self.assertEqual(content, "Alex entered the hall.")
        self.assertEqual(outer_budget.used_requests, 1)
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(
            request_mock.call_args.kwargs["model_name"],
            story_memory_pipeline.POLZA_STORY_SERVICE_TEXT_MODEL,
        )
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])

    def test_turn_hard_budget_caps_total_across_independent_module_budgets(self) -> None:
        # A single turn may fan out into several independent service modules (Call A «Мир»,
        # Call B «Персонажи», сжатие памяти через or_reserve, важные события, граф, baseline).
        # Each keeps its own budget so they don't starve each other, but the turn-wide hard
        # ceiling must still cap the grand total — otherwise a turn can balloon to 10+ requests.
        turn_ceiling = StoryServiceHttpRequestBudget(max_requests=3)
        consumed = 0
        with use_story_turn_hard_budget(turn_ceiling):
            # Module with its own budget of 1.
            with use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=1)):
                consume_story_service_http_request()
                consumed += 1
            # Memory-style reserved (independent) budgets, one request each.
            for _ in range(5):
                try:
                    with use_story_service_http_request_budget_or_reserve(1):
                        consume_story_service_http_request()
                        consumed += 1
                except RuntimeError:
                    break
        self.assertEqual(consumed, 3)
        self.assertEqual(turn_ceiling.used_requests, 3)

    def test_reserved_budgets_stay_independent_without_a_turn_ceiling(self) -> None:
        # Backward compatibility: with no turn ceiling set, reserved module budgets remain
        # independent (the deliberate no-starvation design), so nothing is capped globally.
        consumed = 0
        for _ in range(5):
            with use_story_service_http_request_budget_or_reserve(1):
                consume_story_service_http_request()
                consumed += 1
        self.assertEqual(consumed, 5)

    def test_copy_like_detailed_memory_payload_is_not_retried(self) -> None:
        narrator_response = (
            "Marina raises the silver lantern beside the broken arch and tells Alex to wait until the guard patrol passes. "
            * 16
        ).strip()
        raw_content = (
            "PLAYER_TURN:\nAlex signals Marina to stop near the arch.\n\n"
            f"NARRATOR_RESPONSE:\n{narrator_response}"
        )
        copied_payload = json.dumps(
            {
                "summary": narrator_response,
                "important_entities": [],
                "state_changes": [],
                "open_threads": [],
            }
        )
        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=copied_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "semantic validation"):
                story_memory_pipeline._compress_story_memory_block_with_model(raw_content=raw_content)

        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(request_mock.call_args.kwargs["model_name"], story_memory_pipeline.POLZA_STORY_SERVICE_TEXT_MODEL)
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])

    def test_copy_like_detailed_memory_payload_raises_without_manual_fallback(self) -> None:
        narrator_response = (
            "Marina raises the silver lantern beside the broken arch and tells Alex to wait until the guard patrol passes. "
            * 16
        ).strip()
        copied_payload = json.dumps(
            {
                "summary": narrator_response,
                "important_entities": [],
                "state_changes": [],
                "open_threads": [],
            }
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=copied_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "semantic validation"):
                story_memory_pipeline._compress_story_memory_block_with_model(
                    raw_content=(
                        "PLAYER_TURN:\nAlex signals Marina to stop near the arch.\n\n"
                        f"NARRATOR_RESPONSE:\n{narrator_response}"
                    )
                )

        self.assertEqual(request_mock.call_count, story_memory_pipeline.STORY_MEMORY_MODEL_MAX_ATTEMPTS)

    def test_super_mode_formats_fact_memory_from_strict_json(self) -> None:
        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value='{"facts":["Alex owns a brass key"],"persistent_state":["door is locked"],"open_threads":[]}',
        ):
            title, content = story_memory_pipeline._compress_story_memory_block_with_model(
                raw_content="compressed source",
                super_mode=True,
            )

        self.assertEqual(title, "Факты памяти")
        self.assertIn("Alex owns a brass key", content)
        self.assertIn("door is locked", content)


if __name__ == "__main__":
    unittest.main()
