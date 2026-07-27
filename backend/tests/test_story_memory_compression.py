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
from app.services.story_runtime import STORY_GRAPH_MAX_SERVICE_REQUESTS  # noqa: E402


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
        self.assertIn("Марина:", content)

    def test_model_compression_requires_strict_json_and_formats_detailed_memory(self) -> None:
        raw_content = story_memory_pipeline._build_story_raw_memory_block_content(
            latest_user_prompt="Alex входит в зал и закрывает дверь.",
            latest_assistant_text="Марина остается у входа и слушает шаги за стеной.",
        )
        llm_payload = (
            '{"summary":"Alex вошел в зал, закрыл дверь, а Марина осталась слушать шаги.",'
            '"open_threads":["за стеной слышны шаги"],'
            '"active_plans":["Alex должен выяснить, кто идет"]}'
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
        self.assertIn("Open threads:\n- за стеной слышны шаги", content)
        self.assertIn("Active plans:\n- Alex должен выяснить, кто идет", content)
        self.assertNotIn("Important entities:", content)
        self.assertNotIn("State changes:", content)
        self.assertNotIn("Scene anchor:", content)
        self.assertNotIn("Character knowledge:", content)
        self.assertEqual(request_mock.call_count, 1)
        self.assertEqual(request_mock.call_args.kwargs["model_name"], story_memory_pipeline.POLZA_STORY_SERVICE_TEXT_MODEL)
        self.assertFalse(request_mock.call_args.kwargs["retry_on_rate_limit"])
        self.assertFalse(request_mock.call_args.kwargs["retry_on_temporary_failure"])
        self.assertFalse(request_mock.call_args.kwargs["translate_input"])
        self.assertEqual(request_mock.call_args.kwargs["fallback_model_names"], [])
        self.assertGreaterEqual(request_mock.call_args.kwargs["max_tokens"], 1_200)
        prompt_text = "\n".join(message["content"] for message in request_mock.call_args.args[0])
        self.assertIn("ПЕРВЫЙ, ПОДРОБНЫЙ слой памяти", prompt_text)
        self.assertIn("примерно 60-85%", prompt_text)
        self.assertIn("PLAYER_CHARACTER_NAME:\nAlex", prompt_text)
        self.assertIn('"Alex"', prompt_text)
        self.assertIn('"Марина"', prompt_text)
        self.assertIn("неоднозначные местоимения", prompt_text)

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

    def test_deeper_memory_layers_keep_only_summary_threads_and_plans(self) -> None:
        compressed = story_memory_pipeline._format_compressed_memory_content(
            story_memory_pipeline.CompressedMemoryPayload(
                summary="Герои вернулись в лагерь.",
                open_threads=["Неизвестно, кто оставил письмо."],
                active_plans=["Алекс должен прочитать письмо."],
            )
        )
        facts = story_memory_pipeline._format_fact_memory_content(
            story_memory_pipeline.FactMemoryPayload(
                summary="Герои вернулись в лагерь.",
                open_threads=["Неизвестно, кто оставил письмо."],
                active_plans=["Алекс должен прочитать письмо."],
            )
        )

        for content in (compressed, facts):
            self.assertIn("Open threads:", content)
            self.assertIn("Active plans:", content)
            for removed_section in (
                "Key facts:",
                "Scene state:",
                "Character knowledge:",
                "Persistent state:",
                "Active commitments:",
            ):
                self.assertNotIn(removed_section, content)

    def test_detailed_rejects_omitted_terminal_outcome_without_retry(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nГруппа возвращается после задания.\n\n"
            "NARRATOR_RESPONSE:\nГруппа выполнила задание и вернулась в лагерь."
        )
        compressed_without_outcome = json.dumps(
            {
                "summary": "Группа снова находится в лагере.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=compressed_without_outcome,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "omitted terminal story status"):
                story_memory_pipeline._compress_story_memory_block_with_model(raw_content=raw_content)

        self.assertEqual(request_mock.call_count, 1)

    def test_terminal_validation_ignores_finished_phrase_without_story_goal(self) -> None:
        story_memory_pipeline._validate_story_memory_terminal_statuses(
            source_content="Артур закончил фразу и отказался от вина.",
            result_content="Артур замолчал и не стал пить вино.",
        )

    def test_terminal_validation_ignores_finished_phrase_near_plan(self) -> None:
        story_memory_pipeline._validate_story_memory_terminal_statuses(
            source_content="Артур объяснил план Марине. Затем Артур закончил фразу и замолчал.",
            result_content="Артур объяснил план Марине и замолчал.",
        )

    def test_detailed_rejects_ultra_short_lossy_summary_for_long_turn(self) -> None:
        raw_content = (
            "PLAYER_TURN:\n"
            "Алекс передал Лейре три пачки сигарет, спросил о планах на обед и пообещал помочь с домом.\n\n"
            "NARRATOR_RESPONSE:\n"
            "Лейра поблагодарила Алекса, спрятала две пачки, открыла третью, попросила обнять Лейру за талию, "
            "напомнила Алексу о карточке с требованиями заботы и сказала, что ждёт рассказа об обеде."
        )
        lossy_payload = json.dumps(
            {
                "summary": "Алекс и Лейра поговорили.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=lossy_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "over-compressed"):
                story_memory_pipeline._compress_story_memory_block_with_model(raw_content=raw_content)

        self.assertEqual(request_mock.call_count, 1)

    def test_detailed_rejects_lossy_summary_for_short_eventful_turn(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nАлекс передал Лейре письмо и попросил прочитать письмо.\n\n"
            "NARRATOR_RESPONSE:\nЛейра спрятала письмо, отказалась читать письмо и ушла."
        )
        lossy_payload = json.dumps(
            {
                "summary": "Алекс и Лейра поговорили.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=lossy_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "over-compressed"):
                story_memory_pipeline._compress_story_memory_block_with_model(raw_content=raw_content)

        self.assertEqual(request_mock.call_count, 1)

    def test_detailed_accepts_clear_high_detail_retelling_with_explicit_names(self) -> None:
        source_content = (
            "PLAYER_TURN:\n"
            "Алекс протянул Лейре три пачки сигарет и, смутившись, спросил, собирается ли Лейра дальше "
            "ходить в одном белье. Алекс напомнил Лейре, что собирался рассказать про обед.\n\n"
            "NARRATOR_RESPONSE:\n"
            "Лейра с радостью приняла сигареты, надорвала край мужской футболки и прижалась к Алексу всем "
            "телом. Лейра потребовала ласки и заботы, напомнила Алексу о мелком шрифте на карточке с "
            "требованиями дома, тепла и любви, а затем сказала, что голодна и хочет услышать рассказ об обеде."
        )
        payload = story_memory_pipeline.DetailedMemoryPayload(
            summary=(
                "Алекс передал Лейре три пачки сигарет, смущённо спросил Лейру о намерении продолжать ходить "
                "в одном белье и напомнил про обещанный рассказ об обеде. Лейра обрадовалась сигаретам, "
                "надорвала мужскую футболку, тесно прижалась к Алексу и потребовала от Алекса ласки и заботы. "
                "Лейра также напомнила Алексу о карточке с требованиями дома, тепла и любви, сообщила о голоде "
                "и попросила Алекса рассказать об обеде."
            ),
            open_threads=["Лейра всё ещё ждёт от Алекса рассказа об обеде."],
            active_plans=["Алекс должен рассказать Лейре об обеде."],
        )
        result_content = story_memory_pipeline._format_detailed_memory_content(payload)

        story_memory_pipeline._validate_detailed_memory_model_result(
            source_content=source_content,
            payload=payload,
            result_content=result_content,
            player_name="Алекс",
            known_character_names=["Алекс", "Лейра"],
        )

    def test_detailed_accepts_high_detail_retelling_close_to_source_wording(self) -> None:
        sentences = [
            "Alex placed the brass lantern beside the northern arch while Marina watched the empty corridor.",
            "Marina closed the oak door and checked the iron lock before Alex unfolded the marked city map.",
            "Alex showed Marina the river route and named the bridge where the patrol changes at midnight.",
            "Marina copied the route into the red notebook and hid the notebook inside the leather satchel.",
            "Alex moved the food supplies onto the lower shelf and counted every sealed travel flask.",
            "Marina inspected the window latch and warned Alex about fresh footprints below the balcony.",
            "Alex wrapped the silver key in cloth and placed the silver key beside the folded map.",
            "Marina extinguished the candle after memorizing the route through the market district.",
        ]
        source_body = " ".join(sentences)
        summary = " ".join(
            [
                *sentences[:6],
                "Alex wrapped the silver key and left the silver key beside the map.",
                "Marina memorized the market route and extinguished the candle.",
            ]
        )
        copied_ratio = story_memory_pipeline._story_memory_copied_ngram_ratio(
            source_content=source_body,
            candidate_content=summary,
        )
        self.assertGreater(copied_ratio, 0.70)
        self.assertLessEqual(copied_ratio, story_memory_pipeline.STORY_MEMORY_DETAILED_COPY_RATIO_LIMIT)
        payload = story_memory_pipeline.DetailedMemoryPayload(
            summary=summary,
            open_threads=[],
            active_plans=[],
        )

        story_memory_pipeline._validate_detailed_memory_model_result(
            source_content=f"PLAYER_TURN:\n{sentences[0]}\n\nNARRATOR_RESPONSE:\n{' '.join(sentences[1:])}",
            payload=payload,
            result_content=summary,
            player_name="Alex",
            known_character_names=["Alex", "Marina"],
        )

    def test_detailed_rejects_repeated_generic_padding(self) -> None:
        source_content = (
            "PLAYER_TURN:\nАлекс передал Лейре 3 пачки сигарет и спросил Лейру об обеде.\n\n"
            "NARRATOR_RESPONSE:\nЛейра открыла пачку сигарет, надорвала футболку, обняла Алекса, напомнила "
            "Алексу о карточке с требованиями заботы и сказала Алексу, что голодна."
        )
        repeated = "Алекс и Лейра обсудили 3 предмета и важные события."
        payload = story_memory_pipeline.DetailedMemoryPayload(
            summary=" ".join([repeated] * 6),
            open_threads=[],
            active_plans=[],
        )

        with self.assertRaisesRegex(RuntimeError, "over-compressed"):
            story_memory_pipeline._validate_detailed_memory_model_result(
                source_content=source_content,
                payload=payload,
                result_content=payload.summary,
                player_name="Алекс",
                known_character_names=["Алекс", "Лейра"],
            )

    def test_detailed_rejects_empty_technical_sections_for_explicit_pending_items(self) -> None:
        source_content = (
            "PLAYER_TURN:\nАлекс пообещал Лейре рассказать об обеде после разговора.\n\n"
            "NARRATOR_RESPONSE:\nЛейра поблагодарила Алекса и ждёт рассказа Алекса об обеде."
        )
        payload = story_memory_pipeline.DetailedMemoryPayload(
            summary=(
                "Алекс пообещал Лейре рассказать об обеде после разговора, а Лейра поблагодарила Алекса "
                "и всё ещё ждёт рассказа Алекса об обеде."
            ),
            open_threads=[],
            active_plans=[],
        )

        with self.assertRaisesRegex(RuntimeError, "omitted open threads|omitted active plans"):
            story_memory_pipeline._validate_detailed_memory_model_result(
                source_content=source_content,
                payload=payload,
                result_content=payload.summary,
                player_name="Алекс",
                known_character_names=["Алекс", "Лейра"],
            )

    def test_detailed_rejects_ambiguous_pronouns_without_retry(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nАлекс протянул Лейре ключ.\n\n"
            "NARRATOR_RESPONSE:\nЛейра взяла ключ у Алекса и положила ключ в карман."
        )
        ambiguous_payload = json.dumps(
            {
                "summary": "Лейра взяла ключ у Алекса и положила его в карман.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=ambiguous_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "ambiguous pronoun"):
                story_memory_pipeline._compress_story_memory_block_with_model(raw_content=raw_content)

        self.assertEqual(request_mock.call_count, 1)

    def test_detailed_rejects_missing_known_character_and_numeric_fact(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nЯ передал Марине 3 ключа.\n\n"
            "NARRATOR_RESPONSE:\nМарина пересчитала 3 ключа и спрятала 3 ключа в сумку."
        )
        missing_fact_payload = json.dumps(
            {
                "summary": "Марина убрала ключи в сумку после разговора.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=missing_fact_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "omitted character: Алекс"):
                story_memory_pipeline._compress_story_memory_block_with_model(
                    raw_content=raw_content,
                    player_name="Алекс",
                    known_character_names=["Алекс", "Марина"],
                )

        self.assertEqual(request_mock.call_count, 1)

    def test_detailed_rejects_missing_numeric_fact(self) -> None:
        raw_content = (
            "PLAYER_TURN:\nАлекс передал Марине 3 ключа.\n\n"
            "NARRATOR_RESPONSE:\nМарина пересчитала 3 ключа и спрятала 3 ключа в сумку."
        )
        missing_number_payload = json.dumps(
            {
                "summary": "Алекс передал Марине ключи, после чего Марина пересчитала ключи и убрала ключи в сумку.",
                "open_threads": [],
                "active_plans": [],
            },
            ensure_ascii=False,
        )

        with patch.object(
            story_memory_pipeline,
            "_request_polza_story_text",
            return_value=missing_number_payload,
        ) as request_mock:
            with self.assertRaisesRegex(RuntimeError, "omitted numeric facts: 3"):
                story_memory_pipeline._compress_story_memory_block_with_model(
                    raw_content=raw_content,
                    player_name="Алекс",
                    known_character_names=["Алекс", "Марина"],
                )

        self.assertEqual(request_mock.call_count, 1)

    def test_detailed_minimum_ratio_ignores_exact_source_repetition(self) -> None:
        repeated_sentence = "Марина закрыла дверь и проверила замок."
        source_content = (
            "PLAYER_TURN:\nАлекс остался у окна.\n\n"
            f"NARRATOR_RESPONSE:\n{(' ' + repeated_sentence) * 12}"
        )
        payload = story_memory_pipeline.DetailedMemoryPayload(
            summary="Марина закрыла дверь, проверила замок, а Алекс остался у окна.",
            open_threads=[],
            active_plans=[],
        )

        story_memory_pipeline._validate_detailed_memory_model_result(
            source_content=source_content,
            payload=payload,
            result_content=payload.summary,
            player_name="Алекс",
            known_character_names=["Алекс", "Марина"],
        )

    def test_deeper_memory_rejects_dropped_threads_and_plans(self) -> None:
        source_content = (
            "Алекс и Лейра нашли запертую дверь.\n\n"
            "Open threads:\n- Неизвестно, кто запер дверь.\n\n"
            "Active plans:\n- Алекс должен найти ключ."
        )

        with self.assertRaisesRegex(RuntimeError, "omitted open threads"):
            story_memory_pipeline._validate_promoted_memory_model_result(
                source_contents=[source_content],
                result_content="Алекс и Лейра нашли запертую дверь.",
                open_threads=[],
                active_plans=["Алекс должен найти ключ."],
            )
        with self.assertRaisesRegex(RuntimeError, "omitted active plans"):
            story_memory_pipeline._validate_promoted_memory_model_result(
                source_contents=[source_content],
                result_content="Алекс и Лейра нашли запертую дверь.",
                open_threads=["Неизвестно, кто запер дверь."],
                active_plans=[],
            )

    def test_deeper_memory_rejects_partial_lists_and_empty_summary(self) -> None:
        source_content = (
            "Алекс и Лейра нашли запертую дверь.\n\n"
            "Open threads:\n- Неизвестно, кто запер дверь.\n- Неизвестно, где лежит ключ.\n\n"
            "Active plans:\n- Алекс должен осмотреть коридор.\n- Лейра должна проверить окно."
        )

        with self.assertRaisesRegex(RuntimeError, "omitted open threads"):
            story_memory_pipeline._validate_promoted_memory_model_result(
                source_contents=[source_content],
                result_content="Алекс и Лейра нашли дверь.\n\nOpen threads:\n- Неизвестно, кто запер дверь.",
                open_threads=["Неизвестно, кто запер дверь."],
                active_plans=["Алекс должен осмотреть коридор.", "Лейра должна проверить окно."],
            )
        with self.assertRaisesRegex(RuntimeError, "empty summary"):
            story_memory_pipeline._validate_promoted_memory_model_result(
                source_contents=[source_content],
                result_content="Open threads:\n- Неизвестно, кто запер дверь.",
                open_threads=["Неизвестно, кто запер дверь.", "Неизвестно, где лежит ключ."],
                active_plans=["Алекс должен осмотреть коридор.", "Лейра должна проверить окно."],
            )

    def test_memory_compression_has_reserved_service_budget_after_postprocess_budget_is_exhausted(self) -> None:
        valid_memory_json = (
            '{"summary":"Alex entered the hall.",'
            '"open_threads":[],"active_plans":[]}'
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
        # Call B «Персонажи», сжатие памяти через or_reserve, важные события, baseline).
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

    def test_graph_uses_its_own_five_request_budget_after_turn_budget_is_exhausted(self) -> None:
        turn_budget = StoryServiceHttpRequestBudget(max_requests=1)
        with (
            use_story_turn_hard_budget(turn_budget),
            use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=1)),
        ):
            consume_story_service_http_request()

        graph_budget = StoryServiceHttpRequestBudget(max_requests=STORY_GRAPH_MAX_SERVICE_REQUESTS)
        with use_story_service_http_request_budget(graph_budget):
            for _ in range(STORY_GRAPH_MAX_SERVICE_REQUESTS):
                consume_story_service_http_request()

        self.assertEqual(turn_budget.used_requests, 1)
        self.assertEqual(STORY_GRAPH_MAX_SERVICE_REQUESTS, 5)
        self.assertEqual(graph_budget.used_requests, 5)

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
                "open_threads": [],
                "active_plans": [],
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
                "open_threads": [],
                "active_plans": [],
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
            return_value=(
                '{"summary":"Alex owns a brass key; the door is locked.",'
                '"open_threads":[],"active_plans":[]}'
            ),
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
