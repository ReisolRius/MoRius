"""End-to-end behaviour of a turn, against a real database and a stubbed narrator.

These drive ``_stream_story_response`` itself rather than a transcription of it, so they fail
if the handoff between the turn and its off-turn catch-up ever regresses:

* the turn hands this game's lock back before it sends ``done`` -- that release is the entire
  reason the next thing the player does no longer queues behind bookkeeping;
* exactly one service-model call happens while that lock is held (Call A «Мир»), and the
  character / graph / D&D work is handed to the background instead;
* a cancellation that lands after the player has been charged keeps the turn and still
  delivers it, instead of throwing away something they paid for.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import json
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryGame, StoryMemoryBlock, StoryMessage, User  # noqa: E402
from app.services import story_runtime  # noqa: E402


def _sse_events(chunks: list[str]) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for chunk in chunks:
        if not chunk.startswith("event: "):
            continue
        name, _, rest = chunk[len("event: ") :].partition("\n")
        payload: dict = {}
        for line in rest.split("\n"):
            if line.startswith("data: "):
                try:
                    payload = json.loads(line[len("data: ") :])
                except json.JSONDecodeError:
                    payload = {}
        events.append((name.strip(), payload))
    return events


class StoryTurnStreamHandoffTests(unittest.TestCase):
    game_id = 501
    user_id = 77

    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)
        self.db = self.Session()

        self.user = User(id=self.user_id, email="player@example.com", password_hash="x", coins=1_000)
        self.db.add(self.user)
        self.game = StoryGame(
            id=self.game_id,
            user_id=self.user_id,
            title="handoff",
            character_state_enabled=True,
            auto_npc_cards_enabled=True,
        )
        self.db.add(self.game)
        self.db.flush()
        self.source_user_message = StoryMessage(
            game_id=self.game_id, role="user", content="Я захожу в таверну."
        )
        self.db.add(self.source_user_message)
        self.db.commit()

        self.released_at: list[str] = []
        self.service_calls_while_locked: list[str] = []
        self.scheduled_deferred: list[dict] = []

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    # -- the stubbed world ---------------------------------------------------------------
    def _deps(self, *, character_state: bool = True, auto_npc: bool = True) -> SimpleNamespace:
        outer = self

        def stream_chunks(**_kwargs):
            yield "Трактирщик поднимает взгляд. "
            yield "«Комната или неприятности?»"

        def resolve_postprocess(**kwargs):
            # Records that this happened while the lock was still held, and with which half.
            outer.service_calls_while_locked.append(
                "world"
                if kwargs.get("location_enabled") or kwargs.get("environment_enabled")
                else "characters"
            )
            outer.postprocess_kwargs = dict(kwargs)
            return {"location": {"action": "keep"}}

        def upsert_plot_memory(**kwargs):
            outer.upsert_kwargs = dict(kwargs)
            if kwargs.get("allow_model_postprocess_request"):
                outer.service_calls_while_locked.append("plot_memory_model_call")
            return (False, [])

        return SimpleNamespace(
            story_user_role="user",
            story_assistant_role="assistant",
            stream_persist_min_chars=10_000,
            stream_persist_max_interval_seconds=60.0,
            touch_story_game=lambda game: None,
            stream_story_provider_chunks=stream_chunks,
            normalize_generated_story_output=None,
            spend_user_tokens_if_sufficient=lambda db, user_id, tokens: True,
            add_user_tokens=lambda db, user_id, tokens: None,
            select_story_world_cards_triggered_by_text=lambda text, cards: [],
            resolve_story_turn_postprocess_payload=resolve_postprocess,
            resolve_story_ambient_profile=lambda **_kwargs: None,
            serialize_story_ambient_profile=lambda value: "",
            upsert_story_plot_memory_card=upsert_plot_memory,
            list_story_memory_blocks=lambda db, game_id: list(
                db.scalars(
                    select(StoryMemoryBlock).where(StoryMemoryBlock.game_id == game_id)
                ).all()
            ),
            list_story_plot_cards=lambda db, game_id: [],
            list_story_world_cards=lambda db, game_id: [],
            list_story_messages=lambda db, game_id: list(
                db.scalars(
                    select(StoryMessage).where(
                        StoryMessage.game_id == game_id, StoryMessage.undone_at.is_(None)
                    )
                ).all()
            ),
            memory_block_to_out=lambda block: {"id": block.id, "layer": block.layer},
            plot_card_to_out=lambda card: {},
            world_card_to_out=lambda card: {},
            story_game_summary_to_out=lambda game: {"id": game.id, "current_location_label": ""},
        )

    def _run_turn(self, *, deps: SimpleNamespace, cancel_at_stage: str | None = None) -> list[str]:
        cancelled = {"value": False}

        def fake_is_cancelled(_game_id, _generation_id) -> bool:
            return cancelled["value"]

        def fake_checkpoint(**_kwargs) -> bool:
            return True

        def spend_tokens(_db, _user_id, _tokens) -> bool:
            # The player has now paid. Anything that cancels from here on -- the next turn, a
            # reroll, an undo, all of which used to cancel to jump the lock queue -- must not
            # be able to take the turn away from them.
            if cancel_at_stage == "after_billing":
                cancelled["value"] = True
            return True

        deps.spend_user_tokens_if_sufficient = spend_tokens

        def fake_schedule(**kwargs) -> bool:
            self.scheduled_deferred.append(dict(kwargs))
            return True

        with (
            patch.object(story_runtime, "is_story_generation_cancelled", side_effect=fake_is_cancelled),
            patch.object(story_runtime, "_checkpoint_story_raw_turn_memory", side_effect=fake_checkpoint),
            patch.object(
                story_runtime,
                "_schedule_deferred_story_turn_postprocess",
                side_effect=fake_schedule,
            ),
        ):
            stream = story_runtime._stream_story_response(
                deps=deps,
                db=self.db,
                game=self.game,
                user=self.user,
                turn_cost_tokens=5,
                source_user_message=self.source_user_message,
                prompt="Я захожу в таверну.",
                turn_index=1,
                context_messages=[self.source_user_message],
                instruction_cards=[],
                plot_cards=[],
                world_cards=[],
                all_world_cards=[],
                context_limit_chars=6_000,
                story_model_name="aion-labs/aion-3.0-mini",
                story_response_max_tokens=3_000,
                story_temperature=0.8,
                story_repetition_penalty=1.05,
                story_top_k=50,
                story_top_r=0.9,
                memory_optimization_enabled=True,
                reroll_discarded_assistant_text=None,
                ambient_enabled=False,
                visual_novel_enabled=False,
                show_gg_thoughts=False,
                show_npc_thoughts=False,
                story_generation_id="gen-test",
                release_turn_lock=lambda: self.released_at.append(self._latest_event_name),
            # (the recorded name is the last event SENT before the release)
            )
            chunks: list[str] = []
            self._latest_event_name = "start_of_stream"
            for chunk in stream:
                chunks.append(chunk)
                if chunk.startswith("event: "):
                    self._latest_event_name = chunk[len("event: ") :].partition("\n")[0].strip()
        self._last_chunks = chunks
        return chunks

    # -- the properties ------------------------------------------------------------------
    def test_a_normal_turn_releases_the_lock_before_sending_done(self) -> None:
        chunks = self._run_turn(deps=self._deps())
        events = _sse_events(chunks)
        names = [name for name, _ in events]

        self.assertIn("done", names, f"the turn never completed: {names}")
        self.assertEqual(len(self.released_at), 1, "the lock must be handed back exactly once")
        self.assertNotEqual(
            self.released_at[0],
            "done",
            "the lock must be handed back BEFORE the done event, not after it",
        )
        self.assertEqual(names[-1], "done")

    def test_only_the_world_half_runs_while_the_lock_is_held(self) -> None:
        self._run_turn(deps=self._deps())

        self.assertEqual(
            self.service_calls_while_locked,
            ["world"],
            "exactly one service-model call may happen on the turn's lock",
        )
        self.assertFalse(self.postprocess_kwargs["character_state_enabled"])
        self.assertFalse(self.postprocess_kwargs["auto_npc_cards_enabled"])
        self.assertTrue(self.postprocess_kwargs["location_enabled"])
        self.assertFalse(
            self.upsert_kwargs["allow_model_postprocess_request"],
            "the inline apply must not be able to start a provider call of its own",
        )

    def test_the_rest_of_the_post_process_is_handed_to_the_background(self) -> None:
        self._run_turn(deps=self._deps())

        self.assertEqual(len(self.scheduled_deferred), 1)
        scheduled = self.scheduled_deferred[0]
        self.assertEqual(scheduled["game_id"], self.game_id)
        self.assertTrue(scheduled["character_state_enabled"] or scheduled["auto_npc_cards_enabled"])

        done_payload = next(payload for name, payload in _sse_events(self._last_chunks) if name == "done")
        self.assertTrue(
            done_payload["postprocess_deferred"],
            "the client has to know late results are still coming, or it never refreshes",
        )
        self.assertFalse(
            done_payload["postprocess_pending"],
            "deferred work is the normal path, not a failed module the client should hammer",
        )

    def test_a_cancellation_after_billing_still_delivers_the_paid_turn(self) -> None:
        chunks = self._run_turn(deps=self._deps(), cancel_at_stage="after_billing")
        events = _sse_events(chunks)
        names = [name for name, _ in events]

        self.assertIn("done", names, f"a paid turn was thrown away by a cancellation: {names}")
        # The optional extras are skipped -- that is what "stopped" means once the text is paid
        # for -- but the turn itself lands and the message survives.
        self.assertEqual(self.service_calls_while_locked, [])
        self.assertEqual(self.scheduled_deferred, [])

        assistant_message = self.db.scalar(
            select(StoryMessage).where(
                StoryMessage.game_id == self.game_id,
                StoryMessage.role == "assistant",
                StoryMessage.undone_at.is_(None),
            )
        )
        self.assertIsNotNone(assistant_message)
        self.assertIn("Трактирщик", str(assistant_message.content))


if __name__ == "__main__":
    unittest.main()
