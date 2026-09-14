"""Guarantees of the off-turn catch-up worker.

The turn hands this module the half of its post-process that nobody is waiting for. In
exchange the module promises never to make a player wait, and never to write anything on
behalf of a turn the player has since thrown away.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMessage, User  # noqa: E402
from app.services import story_turn_postprocess_background as background  # noqa: E402
from app.services.story_game_operation_lock import (  # noqa: E402
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
)


class StoryTurnPostprocessBackgroundTests(unittest.TestCase):
    game_id = 8_801

    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite:///:memory:",
            future=True,
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

        with self.Session() as db:
            db.add(User(id=5, email="p@example.com", password_hash="x", coins=100))
            db.add(StoryGame(id=self.game_id, user_id=5, title="background"))
            db.flush()
            assistant = StoryMessage(game_id=self.game_id, role="assistant", content="Сцена.")
            db.add(assistant)
            db.commit()
            self.assistant_message_id = int(assistant.id)

        session_patch = patch.object(background, "SessionLocal", self.Session)
        session_patch.start()
        self.addCleanup(session_patch.stop)
        pg_patch = patch(
            "app.services.story_game_operation_lock._should_use_postgresql_advisory_locks",
            return_value=False,
        )
        pg_patch.start()
        self.addCleanup(pg_patch.stop)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _undo_the_turn(self) -> None:
        with self.Session() as db:
            message = db.get(StoryMessage, self.assistant_message_id)
            message.undone_at = datetime.now(timezone.utc)
            db.commit()

    def test_a_live_turn_gets_its_result_applied(self) -> None:
        applied: list[int] = []

        def apply(_db, game: StoryGame) -> None:
            applied.append(int(game.id))

        self.assertTrue(
            background._run_apply_burst(
                game_id=self.game_id,
                assistant_message_id=self.assistant_message_id,
                step="characters",
                apply=apply,
                deadline=time.monotonic() + 5.0,
            )
        )
        self.assertEqual(applied, [self.game_id])

    def test_work_for_a_turn_the_player_threw_away_is_discarded(self) -> None:
        # Undone between resolving and applying: a reroll, an undo, or a cancellation. The
        # result must not be written, or a turn the player removed keeps costing them context.
        self._undo_the_turn()
        applied: list[int] = []

        self.assertTrue(
            background._run_apply_burst(
                game_id=self.game_id,
                assistant_message_id=self.assistant_message_id,
                step="graph",
                apply=lambda _db, game: applied.append(int(game.id)),
                deadline=time.monotonic() + 5.0,
            )
        )
        self.assertEqual(applied, [], "a discarded turn must leave nothing behind")

    def test_it_steps_aside_while_a_player_holds_the_game(self) -> None:
        held = acquire_story_game_operation_lock(
            self.game_id,
            operation="story_generate",
            wait_timeout_seconds=None,
        )
        applied: list[int] = []
        finished = threading.Event()

        def run() -> None:
            try:
                background._run_apply_burst(
                    game_id=self.game_id,
                    assistant_message_id=self.assistant_message_id,
                    step="dnd",
                    apply=lambda _db, game: applied.append(int(game.id)),
                    # Short deadline: the point is that it gives up rather than fighting.
                    deadline=time.monotonic() + 0.4,
                )
            finally:
                finished.set()

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        self.assertTrue(finished.wait(timeout=20.0), "background work must not block forever")
        self.assertEqual(applied, [], "it must not have written while the player held the game")

        # And the player's hold was never contested: the lock is still theirs and still works.
        with self.assertRaises(StoryGameOperationBusyError):
            acquire_story_game_operation_lock(
                self.game_id,
                operation="story_generate",
                wait_timeout_seconds=0.05,
            )
        held.release()

    def test_an_unused_graph_precharge_is_given_back(self) -> None:
        background._settle_graph_precharge(
            game_id=self.game_id,
            owner_user_id=5,
            precharged=5,
            actually_used=2,
        )
        with self.Session() as db:
            self.assertEqual(db.get(User, 5).coins, 103)

    def test_a_fully_spent_graph_precharge_refunds_nothing(self) -> None:
        background._settle_graph_precharge(
            game_id=self.game_id,
            owner_user_id=5,
            precharged=5,
            actually_used=5,
        )
        with self.Session() as db:
            self.assertEqual(db.get(User, 5).coins, 100)

    def test_a_graph_step_that_never_ran_refunds_the_whole_precharge(self) -> None:
        background._settle_graph_precharge(
            game_id=self.game_id,
            owner_user_id=5,
            precharged=5,
            actually_used=0,
        )
        with self.Session() as db:
            self.assertEqual(db.get(User, 5).coins, 105)

    def test_one_run_per_game_at_a_time(self) -> None:
        with patch.object(background, "_get_executor") as executor:
            executor.return_value.submit.return_value = None
            self.assertTrue(
                background.schedule_story_turn_postprocess(
                    game_id=self.game_id, assistant_message_id=self.assistant_message_id
                )
            )
            self.assertFalse(
                background.schedule_story_turn_postprocess(
                    game_id=self.game_id, assistant_message_id=self.assistant_message_id
                ),
                "two runs for one game would fight over the same rows",
            )
        background._release_scheduled_game(self.game_id)


if __name__ == "__main__":
    unittest.main()
