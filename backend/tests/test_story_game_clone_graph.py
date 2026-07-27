from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    StoryGame,
    StoryGraphEdge,
    StoryGraphNode,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryWorldCard,
    User,
)
from app.routers.story_games import clone_story_game  # noqa: E402
from app.schemas import StoryGameCloneRequest  # noqa: E402


class StoryGameCloneGraphTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed_graph(self, db):
        user = User(email="graph-clone@example.com", password_hash="test", role="administrator")
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="Граф")
        db.add(game)
        db.flush()
        message = StoryMessage(game_id=game.id, role="assistant", content="Факт")
        world_card = StoryWorldCard(game_id=game.id, title="Город", content="Столица", kind="detail")
        instruction_card = StoryInstructionCard(game_id=game.id, title="Правило", content="Не лгать")
        memory_block = StoryMemoryBlock(
            game_id=game.id,
            layer="key",
            title="Ключевой факт",
            content="Герой знает тайну",
            token_count=5,
        )
        db.add_all([message, world_card, instruction_card, memory_block])
        db.flush()
        world_node = StoryGraphNode(
            game_id=game.id,
            card_type="world_card",
            card_id=world_card.id,
            x=12.5,
            y=25.0,
            color="#123456",
            source_turn_id=message.id,
        )
        instruction_node = StoryGraphNode(
            game_id=game.id,
            card_type="instruction_card",
            card_id=instruction_card.id,
            x=300.0,
            y=40.0,
            collapsed=True,
        )
        memory_node = StoryGraphNode(
            game_id=game.id,
            card_type="memory_block",
            card_id=memory_block.id,
            x=600.0,
            y=80.0,
        )
        db.add_all([world_node, instruction_node, memory_node])
        db.flush()
        db.add_all(
            [
                StoryGraphEdge(
                    game_id=game.id,
                    source_node_id=world_node.id,
                    target_node_id=instruction_node.id,
                    source_card_type="world_card",
                    source_card_id=world_card.id,
                    target_card_type="instruction_card",
                    target_card_id=instruction_card.id,
                    relation_type="rule_applies_to",
                    label="Ограничивает",
                    description="Связь должна сохраниться",
                    importance=5,
                    source_turn_id=message.id,
                ),
                StoryGraphEdge(
                    game_id=game.id,
                    source_node_id=memory_node.id,
                    target_node_id=world_node.id,
                    source_card_type="memory_block",
                    source_card_id=memory_block.id,
                    target_card_type="world_card",
                    target_card_id=world_card.id,
                    relation_type="memory_about",
                ),
            ]
        )
        db.commit()
        return user, game, message

    def test_copy_nodes_remaps_cards_edges_and_turn_references(self) -> None:
        with self.Session() as db:
            user, source_game, source_message = self._seed_graph(db)
            with patch("app.routers.story_games.get_current_user", return_value=user):
                cloned = clone_story_game(
                    game_id=source_game.id,
                    payload=StoryGameCloneRequest(),
                    authorization="Bearer test",
                    db=db,
                )

            target_nodes = list(
                db.scalars(
                    select(StoryGraphNode)
                    .where(StoryGraphNode.game_id == cloned.id)
                    .order_by(StoryGraphNode.id.asc())
                ).all()
            )
            target_edges = list(
                db.scalars(
                    select(StoryGraphEdge)
                    .where(StoryGraphEdge.game_id == cloned.id)
                    .order_by(StoryGraphEdge.id.asc())
                ).all()
            )
            target_message = db.scalar(select(StoryMessage).where(StoryMessage.game_id == cloned.id))

            self.assertEqual(len(target_nodes), 3)
            self.assertEqual(len(target_edges), 2)
            self.assertIsNotNone(target_message)
            self.assertNotEqual(target_message.id, source_message.id)
            self.assertEqual(
                {node.source_turn_id for node in target_nodes if node.source_turn_id is not None},
                {target_message.id},
            )
            self.assertEqual(
                {edge.source_turn_id for edge in target_edges if edge.source_turn_id is not None},
                {target_message.id},
            )

            target_node_ids = {node.id for node in target_nodes}
            self.assertTrue(
                all(
                    edge.source_node_id in target_node_ids and edge.target_node_id in target_node_ids
                    for edge in target_edges
                )
            )
            for node in target_nodes:
                model = {
                    "world_card": StoryWorldCard,
                    "instruction_card": StoryInstructionCard,
                    "memory_block": StoryMemoryBlock,
                }[node.card_type]
                linked_game_id = db.scalar(select(model.game_id).where(model.id == node.card_id))
                self.assertEqual(linked_game_id, cloned.id)

            cloned_world_node = next(node for node in target_nodes if node.card_type == "world_card")
            self.assertEqual(cloned_world_node.x, 12.5)
            self.assertEqual(cloned_world_node.y, 25.0)
            self.assertEqual(cloned_world_node.color, "#123456")
            self.assertEqual(target_edges[0].label, "Ограничивает")
            self.assertEqual(target_edges[0].importance, 5)

    def test_copy_nodes_false_keeps_target_graph_empty(self) -> None:
        with self.Session() as db:
            user, source_game, _ = self._seed_graph(db)
            with patch("app.routers.story_games.get_current_user", return_value=user):
                cloned = clone_story_game(
                    game_id=source_game.id,
                    payload=StoryGameCloneRequest(copy_nodes=False),
                    authorization="Bearer test",
                    db=db,
                )

            node_count = db.scalar(
                select(func.count()).select_from(StoryGraphNode).where(StoryGraphNode.game_id == cloned.id)
            )
            edge_count = db.scalar(
                select(func.count()).select_from(StoryGraphEdge).where(StoryGraphEdge.game_id == cloned.id)
            )
            self.assertEqual(node_count, 0)
            self.assertEqual(edge_count, 0)

    def test_nodes_for_unselected_card_sections_are_skipped_without_dangling_edges(self) -> None:
        with self.Session() as db:
            user, source_game, _ = self._seed_graph(db)
            with patch("app.routers.story_games.get_current_user", return_value=user):
                cloned = clone_story_game(
                    game_id=source_game.id,
                    payload=StoryGameCloneRequest(copy_world=False, copy_nodes=True),
                    authorization="Bearer test",
                    db=db,
                )

            target_nodes = list(
                db.scalars(select(StoryGraphNode).where(StoryGraphNode.game_id == cloned.id)).all()
            )
            target_edges = list(
                db.scalars(select(StoryGraphEdge).where(StoryGraphEdge.game_id == cloned.id)).all()
            )
            self.assertEqual({node.card_type for node in target_nodes}, {"instruction_card", "memory_block"})
            self.assertEqual(target_edges, [])


if __name__ == "__main__":
    unittest.main()
