from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    StoryGame,
    StoryGraphEdge,
    StoryGraphEvent,
    StoryGraphNode,
    StoryGraphSuggestion,
    StoryMemoryBlock,
    StoryMessage,
    StoryWorldCard,
    User,
)
from app.schemas import (  # noqa: E402
    StoryGraphCardSummaryOut,
    StoryGraphEdgeCreateRequest,
    StoryGraphEdgeUpdateRequest,
    StoryGraphNodeCreateRequest,
)
from app.services.story_graph import (  # noqa: E402
    GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS,
    _GraphAnalysisPayload,
    _apply_graph_analysis_payload,
    _build_graph_analysis_messages,
    _select_graph_analysis_cards,
    _validate_graph_analysis_evidence,
    analyze_story_graph_for_api,
    build_story_graph_context_instruction,
    create_story_graph_edge,
    create_story_graph_node,
    delete_story_graph_card_references,
    get_story_graph,
    request_gemini_graph_analysis,
    require_story_graph_access,
    update_story_graph_edge,
)
from app.services.story_runtime import (  # noqa: E402
    STORY_GRAPH_MAX_SERVICE_REQUESTS,
    STORY_POSTPROCESS_MAX_SERVICE_REQUESTS,
)
from app.services.story_undo import (  # noqa: E402
    reapply_story_card_events_for_assistant_message,
    rollback_story_card_events_for_assistant_message,
)


def _create_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return Session(bind=engine, future=True)


def _close_session(db: Session) -> None:
    bind = db.get_bind()
    db.close()
    dispose = getattr(bind, "dispose", None)
    if callable(dispose):
        dispose()


def _seed_game(db: Session, *, role: str = "administrator") -> tuple[User, StoryGame, StoryWorldCard, StoryWorldCard]:
    user = User(email=f"{role}@example.com", display_name=role, role=role)
    db.add(user)
    db.flush()
    game = StoryGame(user_id=int(user.id), title="Graph test")
    db.add(game)
    db.flush()
    first = StoryWorldCard(
        game_id=int(game.id),
        title="Mira",
        content="Scout captain.",
        kind="npc",
        triggers='["Mira"]',
    )
    second = StoryWorldCard(
        game_id=int(game.id),
        title="North Gate",
        content="Fortified entrance.",
        kind="world",
        triggers='["gate"]',
    )
    db.add_all([first, second])
    db.commit()
    db.refresh(user)
    db.refresh(game)
    db.refresh(first)
    db.refresh(second)
    return user, game, first, second


class StoryGraphTests(unittest.TestCase):
    def test_story_microservice_registers_graph_routes(self) -> None:
        from app.microservices.story_main import app

        route_paths = {getattr(route, "path", "") for route in app.routes}

        self.assertIn("/api/story/games/{game_id}/graph", route_paths)
        self.assertIn("/api/story/games/{game_id}/graph/nodes", route_paths)
        self.assertIn("/api/story/games/{game_id}/graph/edges", route_paths)

    def test_story_graph_access_is_admin_or_moderator_only(self) -> None:
        ordinary_user = User(email="player@example.com", role="user")
        moderator = User(email="mod@example.com", role="moderator")

        with self.assertLogs("app.services.story_graph", level="WARNING"):
            with self.assertRaises(HTTPException) as exc_info:
                require_story_graph_access(ordinary_user)

        self.assertEqual(exc_info.exception.status_code, 403)
        require_story_graph_access(moderator)

    def test_story_graph_node_edge_crud_and_card_cleanup(self) -> None:
        db = _create_session()
        try:
            _, game, first, second = _seed_game(db)
            first_node = create_story_graph_node(
                db,
                game,
                StoryGraphNodeCreateRequest(card_type="world_card", card_id=int(first.id), x=100, y=120),
            )
            second_node = create_story_graph_node(
                db,
                game,
                StoryGraphNodeCreateRequest(card_type="world_card", card_id=int(second.id), x=420, y=120),
            )
            edge = create_story_graph_edge(
                db,
                game,
                StoryGraphEdgeCreateRequest(
                    source_node_id=first_node.id,
                    target_node_id=second_node.id,
                    relation_type="located_in",
                    label="guards",
                    description="Mira watches the gate.",
                    direction="directed",
                    scope="both",
                    importance=5,
                ),
            )

            graph = get_story_graph(db, game)

            self.assertEqual([node.card_id for node in graph.nodes], [first.id, second.id])
            self.assertEqual(graph.edges[0].id, edge.id)
            self.assertEqual(graph.edges[0].label, "guards")

            deleted_count = delete_story_graph_card_references(
                db,
                game_id=int(game.id),
                card_type="world_card",
                card_id=int(first.id),
            )
            db.flush()

            self.assertEqual(deleted_count, 2)
            self.assertEqual(db.scalars(select(StoryGraphNode)).all(), [db.get(StoryGraphNode, second_node.id)])
            self.assertEqual(db.scalars(select(StoryGraphEdge)).all(), [])
        finally:
            _close_session(db)

    def test_story_graph_context_instruction_includes_active_edges(self) -> None:
        db = _create_session()
        try:
            _, game, first, second = _seed_game(db)
            first_node = create_story_graph_node(
                db,
                game,
                StoryGraphNodeCreateRequest(card_type="world_card", card_id=int(first.id), x=100, y=120),
            )
            second_node = create_story_graph_node(
                db,
                game,
                StoryGraphNodeCreateRequest(card_type="world_card", card_id=int(second.id), x=420, y=120),
            )
            create_story_graph_edge(
                db,
                game,
                StoryGraphEdgeCreateRequest(
                    source_node_id=first_node.id,
                    target_node_id=second_node.id,
                    relation_type="located_in",
                    label="guards",
                    description="Mira watches the gate.",
                    direction="directed",
                    scope="location_specific",
                    importance=5,
                ),
            )
            db.flush()

            context = build_story_graph_context_instruction(
                db,
                game,
                context_messages=[],
                world_cards=[{"id": int(first.id)}],
                plot_cards=[],
                instruction_cards=[],
            )

            self.assertIn("Mira", context)
            self.assertIn("North Gate", context)
            self.assertIn("guards", context)
            self.assertIn("scope=location_specific", context)
        finally:
            _close_session(db)

    def test_story_graph_exposes_only_important_memory_cards(self) -> None:
        db = _create_session()
        try:
            _, game, _, _ = _seed_game(db)
            raw_memory = StoryMemoryBlock(
                game_id=game.id,
                layer="raw",
                title="Developer memory",
                content="Internal raw turn payload.",
            )
            key_memory = StoryMemoryBlock(
                game_id=game.id,
                layer="key",
                title="Important memory",
                content="A durable fact visible to players.",
            )
            db.add_all([raw_memory, key_memory])
            db.commit()

            graph = get_story_graph(db, game)
            memory_cards = [card for card in graph.available_cards if card.card_type == "memory_block"]

            self.assertEqual([card.card_id for card in memory_cards], [key_memory.id])
        finally:
            _close_session(db)

    def test_story_graph_prioritizes_main_hero_in_available_cards(self) -> None:
        db = _create_session()
        try:
            _, game, _, _ = _seed_game(db)
            hero = StoryWorldCard(
                game_id=game.id,
                title="Hero",
                content="The player character.",
                kind="main_hero",
                triggers='["Hero"]',
            )
            db.add(hero)
            db.commit()

            graph = get_story_graph(db, game)

            self.assertEqual(graph.available_cards[0].card_id, hero.id)
            self.assertEqual(graph.available_cards[0].kind, "main_hero")
        finally:
            _close_session(db)

    def test_gemini_payload_creates_missing_entity_node_and_edge(self) -> None:
        db = _create_session()
        try:
            _, game, first, _ = _seed_game(db)
            result = _apply_graph_analysis_payload(
                db,
                game,
                {
                    "createCards": [
                        {
                            "key": "fate-guild",
                            "type": "organization",
                            "name": "Fate",
                            "description": "Гильдия искателей.",
                            "extra": {"detailType": "Гильдия"},
                            "confidence": 0.97,
                        }
                    ],
                    "createEdges": [
                        {
                            "sourceCardRef": f"world_card:{first.id}",
                            "targetCardRef": "fate-guild",
                            "relationType": "member_of",
                            "label": "вступила в гильдию, ранг S",
                            "description": "Прошла вступительные испытания.",
                            "direction": "directed",
                            "scope": "organization_specific",
                            "importance": 5,
                            "confidence": 0.96,
                        }
                    ],
                },
                apply_high_confidence=True,
                confidence_threshold=0.78,
                confirm_low_confidence=True,
                source_turn_id=None,
                allow_node_actions=True,
                allow_edge_actions=True,
            )
            db.flush()

            created_card = db.scalar(
                select(StoryWorldCard).where(
                    StoryWorldCard.game_id == game.id,
                    StoryWorldCard.title == "Fate",
                )
            )
            self.assertIsNotNone(created_card)
            self.assertEqual(created_card.detail_type, "Гильдия")
            self.assertEqual(result["applied_cards"], 1)
            self.assertEqual(result["applied_nodes"], 2)
            self.assertEqual(result["applied_edges"], 1)
            self.assertEqual(len(db.scalars(select(StoryGraphNode)).all()), 2)
            edge = db.scalar(select(StoryGraphEdge))
            self.assertIsNotNone(edge)
            self.assertEqual(edge.relation_type, "member_of")
            self.assertIn("ранг S", edge.label)
        finally:
            _close_session(db)

    def test_graph_analysis_prioritizes_recently_mentioned_cards_beyond_limit(self) -> None:
        cards = [
            StoryGraphCardSummaryOut(
                card_type="world_card",
                card_id=index,
                title=f"Card {index}",
            )
            for index in range(1, 231)
        ]
        cards[-1].title = "Fate"

        selected = _select_graph_analysis_cards(
            cards,
            nodes=[],
            edges=[],
            latest_user_prompt="Акеми вступила в гильдию Fate.",
            latest_assistant_text="",
            limit=220,
        )

        self.assertEqual(len(selected), 220)
        self.assertIn(230, {card.card_id for card in selected})

    def test_high_confidence_edges_apply_all_ai_created_dependencies(self) -> None:
        db = _create_session()
        try:
            _, game, first, _ = _seed_game(db)
            create_cards = []
            create_edges = []
            for index in range(5):
                key = f"entity-{index}"
                create_cards.append(
                    {
                        "key": key,
                        "type": "organization" if index % 2 == 0 else "location",
                        "name": f"Entity {index}",
                        "description": f"Durable entity {index}.",
                        "confidence": 0.72,
                    }
                )
                create_edges.append(
                    {
                        "sourceCardRef": f"world_card:{first.id}",
                        "targetCardRef": key,
                        "relationType": "member_of" if index % 2 == 0 else "located_in",
                        "label": f"relation {index}",
                        "description": f"Detailed relationship {index}.",
                        "direction": "directed",
                        "scope": "both",
                        "importance": 4,
                        "confidence": 0.97,
                    }
                )

            result = _apply_graph_analysis_payload(
                db,
                game,
                {"createCards": create_cards, "createEdges": create_edges},
                apply_high_confidence=True,
                confidence_threshold=0.92,
                confirm_low_confidence=True,
                source_turn_id=None,
                allow_node_actions=True,
                allow_edge_actions=True,
            )
            db.flush()

            self.assertEqual(result["applied_cards"], 5)
            self.assertEqual(result["applied_edges"], 5)
            self.assertEqual(result["applied_nodes"], 6)
            self.assertEqual(len(db.scalars(select(StoryGraphEdge)).all()), 5)
            self.assertEqual(len(db.scalars(select(StoryGraphNode)).all()), 6)
        finally:
            _close_session(db)

    def test_graph_gemini_request_uses_ten_thousand_output_tokens(self) -> None:
        game = StoryGame(id=77, user_id=1, title="Token budget")
        with patch(
            "app.services.story_llm_modules.LlmModuleService.call_json",
            return_value=(_GraphAnalysisPayload(), {}),
        ) as call_json_mock:
            payload = request_gemini_graph_analysis(
                game=game,
                latest_user_prompt="Turn",
                latest_assistant_text="Narration",
                cards=[],
                nodes=[],
                edges=[],
            )

        self.assertEqual(payload["createCards"], [])
        self.assertEqual(call_json_mock.call_args.kwargs["max_tokens"], GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS)
        self.assertEqual(call_json_mock.call_args.kwargs["max_attempts"], 1)
        self.assertEqual(call_json_mock.call_count, 1)
        self.assertEqual(GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS, 10_000)

    def test_graph_prompt_requires_durable_relationship_copy_from_gemini(self) -> None:
        db = _create_session()
        try:
            _, game, _, _ = _seed_game(db)
            messages = _build_graph_analysis_messages(
                game=game,
                latest_user_prompt="One character asks another for advice.",
                latest_assistant_text="They remember that they have trusted each other for years.",
                cards=[],
                nodes=[],
                edges=[],
            )

            system_prompt = messages[0]["content"]
            self.assertIn("final copy", system_prompt)
            self.assertIn("durable semantic relationship", system_prompt)
            self.assertIn("not by itself a relationship", system_prompt)
            self.assertIn("will not rewrite or complete them", system_prompt)
        finally:
            _close_session(db)

    def test_graph_rejects_unfinished_ai_relationship_copy_without_rewriting_it(self) -> None:
        db = _create_session()
        try:
            _, game, first, second = _seed_game(db)
            result = _apply_graph_analysis_payload(
                db,
                game,
                {
                    "createEdges": [
                        {
                            "sourceCardRef": f"world_card:{first.id}",
                            "targetCardRef": f"world_card:{second.id}",
                            "relationType": "custom",
                            "label": "received advice from",
                            "description": "The current scene revealed a lasting relationship.",
                            "direction": "directed",
                            "scope": "both",
                            "importance": 3,
                            "confidence": 0.99,
                        }
                    ]
                },
                apply_high_confidence=True,
                confidence_threshold=0.78,
                confirm_low_confidence=True,
                source_turn_id=None,
            )

            self.assertEqual(result["applied_edges"], 0)
            self.assertTrue(any("dangling preposition" in reason for reason in result["skipped"]))
            self.assertEqual(db.scalars(select(StoryGraphEdge)).all(), [])
        finally:
            _close_session(db)

    def test_graph_evidence_warning_does_not_retry_or_discard_gemini_actions(self) -> None:
        game = StoryGame(id=78, user_id=1, title="Evidence tolerance")
        model_payload = _GraphAnalysisPayload.model_validate(
            {
                "createCards": [
                    {
                        "key": "temp-fate",
                        "type": "organization",
                        "name": "Fate",
                        "description": "Гильдия.",
                        "evidence": "перефразированная цитата",
                        "confidence": 0.97,
                    }
                ]
            }
        )
        with patch(
            "app.services.story_llm_modules.LlmModuleService.call_json",
            return_value=(model_payload, {}),
        ) as call_json_mock:
            payload = request_gemini_graph_analysis(
                game=game,
                latest_user_prompt="Акеми вступила в Fate.",
                latest_assistant_text="Она получила ранг S.",
                cards=[],
                nodes=[],
                edges=[],
            )

        self.assertEqual(call_json_mock.call_count, 1)
        self.assertEqual(payload["createCards"][0]["name"], "Fate")
        self.assertTrue(payload["_validationWarnings"])

    def test_graph_schema_drops_only_malformed_actions(self) -> None:
        payload = _GraphAnalysisPayload.model_validate(
            {
                "createCards": [
                    "invalid action",
                    {
                        "key": "temp-fate",
                        "type": "organization",
                        "name": "Fate",
                        "confidence": "0.97",
                    },
                ],
                "createEdges": None,
            }
        ).model_dump(mode="json", by_alias=True)

        self.assertEqual(len(payload["createCards"]), 1)
        self.assertEqual(payload["createCards"][0]["name"], "Fate")
        self.assertEqual(payload["createEdges"], [])

    def test_manual_graph_ai_failure_returns_graph_instead_of_server_error(self) -> None:
        db = _create_session()
        try:
            _, game, _, _ = _seed_game(db)
            db.add_all(
                [
                    StoryMessage(game_id=game.id, role="user", content="Акеми вступила в Fate."),
                    StoryMessage(game_id=game.id, role="assistant", content="Она получила ранг S."),
                ]
            )
            db.commit()

            with patch(
                "app.services.story_graph.request_gemini_graph_analysis",
                side_effect=RuntimeError("provider unavailable"),
            ):
                result = analyze_story_graph_for_api(
                    db,
                    game,
                    assistant_message_id=None,
                    latest_user_prompt=None,
                    latest_assistant_text=None,
                    apply_high_confidence=True,
                    confidence_threshold=None,
                    confirm_low_confidence=True,
                )

            self.assertEqual(result.applied_nodes, 0)
            self.assertIn("provider unavailable", result.skipped[0])
            self.assertEqual(result.graph.game_id, game.id)
        finally:
            _close_session(db)

    def test_story_turn_service_request_caps_reserve_one_graph_call(self) -> None:
        self.assertEqual(STORY_POSTPROCESS_MAX_SERVICE_REQUESTS, 3)
        self.assertEqual(STORY_GRAPH_MAX_SERVICE_REQUESTS, 1)

    def test_reroll_can_delete_message_referenced_by_graph_rows(self) -> None:
        db = _create_session()
        try:
            db.execute(text("PRAGMA foreign_keys=ON"))
            _, game, first, second = _seed_game(db)
            assistant_message = StoryMessage(game_id=game.id, role="assistant", content="Turn with graph changes")
            db.add(assistant_message)
            db.flush()
            first_node = StoryGraphNode(
                game_id=game.id,
                card_type="world_card",
                card_id=first.id,
                x=100,
                y=100,
                created_by="ai",
                source_turn_id=assistant_message.id,
            )
            second_node = StoryGraphNode(
                game_id=game.id,
                card_type="world_card",
                card_id=second.id,
                x=400,
                y=100,
                created_by="ai",
                source_turn_id=assistant_message.id,
            )
            db.add_all([first_node, second_node])
            db.flush()
            db.add_all(
                [
                    StoryGraphEdge(
                        game_id=game.id,
                        source_node_id=first_node.id,
                        target_node_id=second_node.id,
                        source_card_type="world_card",
                        source_card_id=first.id,
                        target_card_type="world_card",
                        target_card_id=second.id,
                        relation_type="member_of",
                        label="member",
                        source_turn_id=assistant_message.id,
                        created_by="ai",
                    ),
                    StoryGraphSuggestion(
                        game_id=game.id,
                        kind="create_edge",
                        payload="{}",
                        source_turn_id=assistant_message.id,
                    ),
                    StoryGraphEvent(
                        game_id=game.id,
                        assistant_message_id=assistant_message.id,
                        event_type="analysis_applied",
                        message="Applied",
                        payload="{}",
                    ),
                ]
            )
            db.commit()

            rollback_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=assistant_message.id,
                commit=False,
                purge_events=True,
                touch_game=False,
            )
            db.delete(assistant_message)
            db.commit()

            self.assertEqual(db.scalars(select(StoryGraphEdge)).all(), [])
            self.assertEqual(db.scalars(select(StoryGraphSuggestion)).all(), [])
            self.assertEqual(db.scalars(select(StoryGraphEvent)).all(), [])
            self.assertEqual(db.scalars(select(StoryGraphNode)).all(), [])
            self.assertIsNone(db.get(StoryMessage, assistant_message.id))
        finally:
            _close_session(db)

    def test_undo_and_redo_hide_and_restore_graph_nodes_edges_and_updates(self) -> None:
        db = _create_session()
        try:
            _, game, first, second = _seed_game(db)
            assistant_message = StoryMessage(game_id=game.id, role="assistant", content="Graph-changing turn")
            db.add(assistant_message)
            db.flush()
            first_node = StoryGraphNode(
                game_id=game.id,
                card_type="world_card",
                card_id=first.id,
                x=100,
                y=100,
                created_by="user",
            )
            second_node = StoryGraphNode(
                game_id=game.id,
                card_type="world_card",
                card_id=second.id,
                x=400,
                y=100,
                created_by="ai",
                source_turn_id=assistant_message.id,
            )
            db.add_all([first_node, second_node])
            db.flush()
            edge = StoryGraphEdge(
                game_id=game.id,
                source_node_id=first_node.id,
                target_node_id=second_node.id,
                source_card_type="world_card",
                source_card_id=first.id,
                target_card_type="world_card",
                target_card_id=second.id,
                relation_type="acquaintance",
                label="newly acquainted",
                description="They met during this turn.",
                source_turn_id=assistant_message.id,
                created_by="ai",
            )
            db.add(edge)
            db.commit()

            rollback_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=assistant_message.id,
                purge_events=False,
            )
            graph_after_undo = get_story_graph(db, game)
            self.assertEqual([node.id for node in graph_after_undo.nodes], [first_node.id])
            self.assertEqual(graph_after_undo.edges, [])

            reapply_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=assistant_message.id,
            )
            graph_after_redo = get_story_graph(db, game)
            self.assertEqual({node.id for node in graph_after_redo.nodes}, {first_node.id, second_node.id})
            self.assertEqual([item.id for item in graph_after_redo.edges], [edge.id])

            update_story_graph_edge(
                db,
                game,
                edge.id,
                StoryGraphEdgeUpdateRequest(
                    label="longtime allies",
                    description="They have relied on each other for years.",
                    importance=5,
                ),
                source_turn_id=assistant_message.id,
            )
            db.commit()
            rollback_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=assistant_message.id,
                purge_events=False,
            )
            db.refresh(edge)
            self.assertEqual(edge.label, "newly acquainted")

            reapply_story_card_events_for_assistant_message(
                db=db,
                game=game,
                assistant_message_id=assistant_message.id,
            )
            db.refresh(edge)
            self.assertEqual(edge.label, "longtime allies")
        finally:
            _close_session(db)

    def test_graph_ai_evidence_must_come_from_current_turn(self) -> None:
        valid_payload = {
            "createCards": [
                {
                    "key": "temp-guild",
                    "type": "organization",
                    "name": "Fate",
                    "evidence": "вступила в гильдию Fate",
                }
            ],
            "createEdges": [
                {
                    "sourceCardRef": "world_card:1",
                    "targetCardRef": "temp-guild",
                    "evidence": "вступила в гильдию Fate",
                }
            ],
        }
        invalid_payload = {
            "createCards": [
                {
                    "key": "temp-unrelated",
                    "type": "location",
                    "name": "Sector S",
                    "evidence": "находится рядом с древними руинами",
                }
            ]
        }

        self.assertEqual(
            _validate_graph_analysis_evidence(
                valid_payload,
                latest_user_prompt="Акеми вступила в гильдию Fate.",
                latest_assistant_text="Она получила ранг S.",
            ),
            [],
        )
        errors = _validate_graph_analysis_evidence(
            invalid_payload,
            latest_user_prompt="Акеми вступила в гильдию Fate.",
            latest_assistant_text="Она получила ранг S.",
        )
        self.assertTrue(errors)
        self.assertTrue(any("evidence" in error for error in errors))
        self.assertTrue(any("entity name" in error for error in errors))

    def test_manual_ai_analysis_uses_latest_turn_when_request_has_no_text(self) -> None:
        db = _create_session()
        try:
            _, game, _, _ = _seed_game(db)
            db.add_all(
                [
                    StoryMessage(game_id=game.id, role="user", content="Акеми вступает в гильдию Fate."),
                    StoryMessage(game_id=game.id, role="assistant", content="Её принимают после испытаний."),
                ]
            )
            db.commit()

            with patch(
                "app.services.story_graph.request_gemini_graph_analysis",
                return_value={"doNothingReason": "No changes"},
            ) as request_mock:
                result = analyze_story_graph_for_api(
                    db,
                    game,
                    assistant_message_id=None,
                    latest_user_prompt=None,
                    latest_assistant_text=None,
                    apply_high_confidence=False,
                    confidence_threshold=None,
                    confirm_low_confidence=True,
                )

            self.assertEqual(result.applied_edges, 0)
            request_kwargs = request_mock.call_args.kwargs
            self.assertIn("Акеми", request_kwargs["latest_user_prompt"])
            self.assertIn("принимают", request_kwargs["latest_assistant_text"])
        finally:
            _close_session(db)


if __name__ == "__main__":
    unittest.main()
