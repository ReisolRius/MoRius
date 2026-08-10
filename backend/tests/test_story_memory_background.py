from __future__ import annotations

from pathlib import Path
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import story_memory_background  # noqa: E402


class _FakeSession:
    def __init__(self, game: object | None) -> None:
        self._game = game
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def get(self, _model, _pk):
        return self._game

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


class StoryMemoryBackgroundTests(unittest.TestCase):
    def setUp(self) -> None:
        story_memory_background._scheduled_game_ids.clear()

    def tearDown(self) -> None:
        story_memory_background._scheduled_game_ids.clear()

    def test_scheduling_the_same_game_twice_queues_only_one_run(self) -> None:
        # Two runs for one game would fight over the same rows, and a single run drains
        # whatever is pending anyway -- so a game already queued must not be queued again.
        submitted: list[int] = []
        release = threading.Event()

        def fake_submit(fn, game_id):
            submitted.append(game_id)
            release.wait(timeout=1)
            return SimpleNamespace()

        with patch.object(
            story_memory_background,
            "_get_executor",
            return_value=SimpleNamespace(submit=fake_submit),
        ):
            self.assertTrue(story_memory_background.schedule_story_memory_compaction(7))
            self.assertFalse(story_memory_background.schedule_story_memory_compaction(7))
            self.assertTrue(story_memory_background.schedule_story_memory_compaction(8))

        release.set()
        self.assertEqual(submitted, [7, 8])

    def test_a_game_can_be_scheduled_again_after_its_run_finishes(self) -> None:
        game = SimpleNamespace(id=11)
        session = _FakeSession(game)
        with (
            patch.object(story_memory_background, "SessionLocal", return_value=session),
            patch.dict(sys.modules),
        ):
            with patch(
                "app.services.story_memory_pipeline._rebalance_story_memory_layers",
                return_value=True,
            ):
                story_memory_background._scheduled_game_ids.add(11)
                story_memory_background._run_story_memory_compaction(11)

        self.assertTrue(session.committed)
        self.assertTrue(session.closed)
        self.assertNotIn(11, story_memory_background._scheduled_game_ids)

    def test_a_failing_run_is_swallowed_and_frees_the_game_for_a_retry(self) -> None:
        # Compaction has no caller to report to. A failure must not escape, and must not
        # leave the game permanently marked as queued, or it would never compact again.
        session = _FakeSession(SimpleNamespace(id=12))
        with patch.object(story_memory_background, "SessionLocal", return_value=session):
            with patch(
                "app.services.story_memory_pipeline._rebalance_story_memory_layers",
                side_effect=RuntimeError("service model down"),
            ):
                story_memory_background._scheduled_game_ids.add(12)
                story_memory_background._run_story_memory_compaction(12)

        self.assertTrue(session.rolled_back)
        self.assertTrue(session.closed)
        self.assertNotIn(12, story_memory_background._scheduled_game_ids)

    def test_a_rejected_submission_does_not_strand_the_game_as_queued(self) -> None:
        def rejecting_submit(_fn, _game_id):
            raise RuntimeError("executor is shutting down")

        with patch.object(
            story_memory_background,
            "_get_executor",
            return_value=SimpleNamespace(submit=rejecting_submit),
        ):
            self.assertFalse(story_memory_background.schedule_story_memory_compaction(13))

        self.assertNotIn(13, story_memory_background._scheduled_game_ids)

    def test_missing_game_is_a_no_op_that_still_releases_the_slot(self) -> None:
        session = _FakeSession(None)
        with patch.object(story_memory_background, "SessionLocal", return_value=session):
            story_memory_background._scheduled_game_ids.add(14)
            story_memory_background._run_story_memory_compaction(14)

        self.assertTrue(session.closed)
        self.assertNotIn(14, story_memory_background._scheduled_game_ids)

    def test_invalid_game_ids_are_rejected_without_queuing(self) -> None:
        for value in (None, 0, -3, "abc"):
            with self.subTest(value=value):
                self.assertFalse(story_memory_background.schedule_story_memory_compaction(value))
        self.assertEqual(story_memory_background._scheduled_game_ids, set())


class StoryTurnDoesNotAwaitCompactionTests(unittest.TestCase):
    def test_turn_postprocess_schedules_compaction_instead_of_running_it(self) -> None:
        # The whole point of the change: the turn must queue compaction, never perform it,
        # because it runs while the per-game generation lock is still held.
        from app import main

        source = Path(main.__file__).read_text(encoding="utf-8")
        upsert_start = source.index("def _upsert_story_plot_memory_card(")
        upsert_end = source.index("\ndef ", upsert_start + 1)
        upsert_body = source[upsert_start:upsert_end]

        self.assertIn("schedule_story_memory_compaction", upsert_body)
        self.assertNotIn("_rebalance_story_memory_layers(", upsert_body)


if __name__ == "__main__":
    unittest.main()
