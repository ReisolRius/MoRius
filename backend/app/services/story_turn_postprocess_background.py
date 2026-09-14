"""Off-turn catch-up for everything a finished turn does not have to wait for.

Why this module exists
----------------------

A story turn used to hold the per-game operation lock from the moment the narrator started
streaming until the very last post-process module had finished: memory sync, the knowledge
graph, the D&D upkeep and a baseline re-sync, each one a service-model round trip. On a busy
turn that is minutes. Every action the player took meanwhile -- the next turn, a reroll, an
undo, editing a message, editing memory -- queued behind that lock, timed out, and came back
as *"Ход еще синхронизируется"*. Worse, the waiter cancelled the generation it was queued
behind in order to get in, so a turn the player had already paid for was thrown away: the
same bug ate the balance it interrupted.

None of that work is needed to answer the next turn. Memory that has not been summarised yet
is simply sent to the narrator as-is; a graph edge that lands a few seconds late changes
nothing the player can see; the D&D sheet catches up with the client's next refresh. So it
runs here instead, and the turn's own request ends as soon as the text is final, paid for and
(when those modules are enabled) the world/time/weather pass has been applied.

The rules this module holds itself to
-------------------------------------

* **Never make the player wait.** Every step checks
  ``story_game_operation_preempt_requested`` before it starts and gives up its slot the
  instant a player-facing operation queues behind it. A skipped step is not lost -- the run
  loops and retries it once the game is quiet again.
* **Resolve first, apply second.** The slow half of a step is a service-model HTTP request
  that touches nothing; only the apply needs the lock, and the apply is sub-second. The lock
  is therefore held for milliseconds at a time, not for the length of a provider call.
* **Never apply to a turn that is no longer there.** Between resolving and applying, the
  player may have undone or rerolled the turn. Every apply re-checks that the assistant
  message is still live and discards its work if it is not, so a cancelled or rolled-back
  turn cannot leave anything behind.
* **Never block or break anything.** Every failure is swallowed and logged. A module that
  fails is simply not applied; the existing pipeline already treats missing post-process as
  retryable on a later turn.
* **One run per game at a time.** Two runs would fight over the same rows.
"""

from __future__ import annotations

import atexit
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from sqlalchemy import select

from app.database import SessionLocal
from app.models import StoryGame, StoryMessage
from app.services.story_game_operation_lock import (
    STORY_LOCK_PRIORITY_BACKGROUND,
    StoryGameOperationBusyError,
    acquire_story_game_operation_lock,
    story_game_operation_preempt_requested,
)
from app.services.story_service_budget import (
    StoryServiceHttpRequestBudget,
    use_story_service_http_request_budget,
    use_story_turn_service_deadline,
)

logger = logging.getLogger(__name__)

# Catch-up is latency tolerant; a couple of workers only exist so one slow game cannot stall
# every other game's queue.
_MAX_WORKERS = 4

# Wall-clock ceiling for a single service-model request made off-turn. Generous compared with
# the inline budget -- nobody is watching -- but still bounded, so a hung provider call cannot
# pin a worker thread for minutes.
_SERVICE_DEADLINE_SECONDS = 40.0

# How long an apply burst may wait for the game lock. The apply itself is pure row work, so
# this only has to cover somebody else's equally short burst.
_APPLY_LOCK_WAIT_SECONDS = 5.0

# When a step is skipped because the player is busy with the game, wait this long before
# looking again. Patience is bounded by _RUN_DEADLINE_SECONDS rather than an attempt count, so
# one stubbornly busy game cannot pin a worker thread indefinitely -- whatever is left undone
# is picked up by the next turn's run anyway.
_PREEMPTED_RETRY_DELAY_SECONDS = 3.0
_PREEMPTED_MAX_ATTEMPTS = 20
# Total wall clock one game's catch-up may occupy a worker. A normal run finishes in seconds;
# this only bites when a player keeps the game busy the whole time.
_RUN_DEADLINE_SECONDS = 150.0

# Mirrors STORY_GRAPH_MAX_SERVICE_REQUESTS in story_runtime: the graph's worst case, which is
# also what the turn pre-charges for it.
_GRAPH_MAX_SERVICE_REQUESTS = 5

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_scheduled_game_ids: set[int] = set()
_scheduled_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=_MAX_WORKERS,
                thread_name_prefix="story-turn-postprocess",
            )
            atexit.register(shutdown_story_turn_postprocess)
        return _executor


def shutdown_story_turn_postprocess(wait: bool = True) -> None:
    """Let in-flight catch-up finish instead of tearing it down mid-transaction."""
    global _executor
    with _executor_lock:
        executor = _executor
        _executor = None
    if executor is not None:
        executor.shutdown(wait=wait)


def _release_scheduled_game(game_id: int) -> None:
    with _scheduled_lock:
        _scheduled_game_ids.discard(game_id)


def _service_call_scope():
    """One bounded service-model request, outside any turn's budget.

    The turn's request budget and deadline live in ContextVars, which deliberately do not
    propagate into worker threads: off-turn catch-up must not be able to starve the modules a
    turn genuinely waits for, and must not inherit a deadline that has already expired.
    """
    return (
        use_story_turn_service_deadline(_SERVICE_DEADLINE_SECONDS),
        use_story_service_http_request_budget(StoryServiceHttpRequestBudget(max_requests=1)),
    )


def _assistant_message_is_live(db, *, game_id: int, assistant_message_id: int) -> bool:
    return (
        db.scalar(
            select(StoryMessage.id).where(
                StoryMessage.id == int(assistant_message_id),
                StoryMessage.game_id == int(game_id),
                StoryMessage.undone_at.is_(None),
            )
        )
        is not None
    )


def _run_apply_burst(
    *,
    game_id: int,
    assistant_message_id: int,
    step: str,
    apply: Callable[[Any, StoryGame], None],
    deadline: float,
) -> bool:
    """Take the game lock just long enough to write one step's result.

    Retries patiently rather than dropping the work: the player is the one who decides when
    the game is free, and this side of the turn is in no hurry. Returns False only when the
    game stayed busy for the whole patience window.
    """
    for attempt in range(_PREEMPTED_MAX_ATTEMPTS):
        if attempt:
            if time.monotonic() >= deadline:
                break
            time.sleep(_PREEMPTED_RETRY_DELAY_SECONDS)
        if story_game_operation_preempt_requested(game_id):
            continue
        if _try_apply_burst(
            game_id=game_id,
            assistant_message_id=assistant_message_id,
            step=step,
            apply=apply,
        ):
            return True
    logger.info(
        "Story turn post-process step gave up while the game stayed busy: "
        "game_id=%s assistant_message_id=%s step=%s",
        game_id,
        assistant_message_id,
        step,
    )
    return False


def _try_apply_burst(
    *,
    game_id: int,
    assistant_message_id: int,
    step: str,
    apply: Callable[[Any, StoryGame], None],
) -> bool:
    try:
        lease = acquire_story_game_operation_lock(
            game_id,
            operation=f"story_turn_postprocess_{step}",
            wait_timeout_seconds=_APPLY_LOCK_WAIT_SECONDS,
            priority=STORY_LOCK_PRIORITY_BACKGROUND,
        )
    except StoryGameOperationBusyError:
        return False

    db = None
    try:
        db = SessionLocal()
        game = db.get(StoryGame, int(game_id))
        if game is None:
            return True
        if not _assistant_message_is_live(db, game_id=game_id, assistant_message_id=assistant_message_id):
            # Undone, rerolled or cancelled while we were resolving. Dropping the result here
            # is the whole point: a turn the player threw away must not leave memory, graph
            # edges or a D&D sheet update behind for the context budget to keep paying for.
            logger.info(
                "Story turn post-process discarded, turn is gone: game_id=%s assistant_message_id=%s step=%s",
                game_id,
                assistant_message_id,
                step,
            )
            return True
        apply(db, game)
        db.commit()
        return True
    except Exception:
        logger.warning(
            "Story turn post-process apply failed: game_id=%s assistant_message_id=%s step=%s",
            game_id,
            assistant_message_id,
            step,
            exc_info=True,
        )
        if db is not None:
            try:
                db.rollback()
            except Exception:
                logger.debug("Story turn post-process rollback failed", exc_info=True)
        return True
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                logger.debug("Story turn post-process session close failed", exc_info=True)
        lease.release()


def _wait_for_a_quiet_moment(game_id: int, deadline: float) -> bool:
    """Block until nobody is queued on this game's lock. False if the player never lets up."""
    for _ in range(_PREEMPTED_MAX_ATTEMPTS):
        if not story_game_operation_preempt_requested(game_id):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(_PREEMPTED_RETRY_DELAY_SECONDS)
    return not story_game_operation_preempt_requested(game_id)


def _load_turn_context(game_id: int, assistant_message_id: int) -> dict[str, Any] | None:
    """Re-derive everything a deferred step needs, from the database rather than the request.

    Passing the turn's state across thread boundaries would mean carrying detached ORM objects
    into a different session; reading it back is both simpler and self-correcting, since the
    player may have edited the text in the meantime.
    """
    db = SessionLocal()
    try:
        game = db.get(StoryGame, int(game_id))
        if game is None:
            return None
        assistant_message = db.scalar(
            select(StoryMessage).where(
                StoryMessage.id == int(assistant_message_id),
                StoryMessage.game_id == int(game_id),
                StoryMessage.undone_at.is_(None),
            )
        )
        if assistant_message is None:
            return None
        user_message = db.scalar(
            select(StoryMessage)
            .where(
                StoryMessage.game_id == int(game_id),
                StoryMessage.role == "user",
                StoryMessage.id < int(assistant_message_id),
                StoryMessage.undone_at.is_(None),
            )
            .order_by(StoryMessage.id.desc())
            .limit(1)
        )
        return {
            "assistant_text": str(getattr(assistant_message, "content", "") or ""),
            "user_prompt": str(getattr(user_message, "content", "") or ""),
            "character_state_enabled": bool(getattr(game, "character_state_enabled", None)),
            "auto_npc_cards_enabled": bool(getattr(game, "auto_npc_cards_enabled", False)),
            "graph_nodes_enabled": bool(getattr(game, "auto_graph_nodes_enabled", False)),
            "graph_edges_enabled": bool(getattr(game, "auto_graph_edges_enabled", False)),
            "graph_confidence": getattr(game, "graph_auto_apply_confidence", None),
            "graph_confirm_low": getattr(game, "graph_confirm_low_confidence", None),
            "location_label": str(getattr(game, "current_location_label", "") or ""),
            "memory_optimization_enabled": bool(getattr(game, "memory_optimization_enabled", True)),
        }
    finally:
        try:
            db.close()
        except Exception:
            logger.debug("Story turn post-process context session close failed", exc_info=True)


def _run_character_analysis_step(*, game_id: int, assistant_message_id: int, context: dict[str, Any], deadline: float) -> None:
    """Call B «Персонажи»: auto character state and auto NPC cards."""
    if not (context["character_state_enabled"] or context["auto_npc_cards_enabled"]):
        return
    if not _wait_for_a_quiet_moment(game_id, deadline):
        return

    from app import main as monolith_main

    def resolve() -> dict[str, Any] | None:
        db = SessionLocal()
        try:
            game = db.get(StoryGame, int(game_id))
            assistant_message = db.get(StoryMessage, int(assistant_message_id))
            if game is None or assistant_message is None:
                return None
            world_cards = monolith_main._select_story_world_cards_for_prompt(
                monolith_main._list_story_messages(db, int(game_id)),
                monolith_main._list_story_world_cards(db, int(game_id)),
            )
            deadline_scope, budget_scope = _service_call_scope()
            with deadline_scope, budget_scope:
                return monolith_main._resolve_story_turn_postprocess_payload(
                    db=db,
                    game=game,
                    assistant_message=assistant_message,
                    latest_user_prompt=context["user_prompt"],
                    latest_assistant_text=context["assistant_text"],
                    world_cards=world_cards,
                    raw_memory_enabled=False,
                    # The world half (place / time / weather / important event / ambient)
                    # already ran inline, while the player was still watching the turn land.
                    location_enabled=False,
                    environment_enabled=False,
                    important_event_enabled=False,
                    ambient_enabled=False,
                    character_state_enabled=context["character_state_enabled"],
                    auto_npc_cards_enabled=context["auto_npc_cards_enabled"],
                )
        finally:
            try:
                db.close()
            except Exception:
                logger.debug("Story character analysis session close failed", exc_info=True)

    try:
        payload = resolve()
    except Exception:
        logger.warning(
            "Story character analysis (Call B) failed off-turn: game_id=%s assistant_message_id=%s",
            game_id,
            assistant_message_id,
            exc_info=True,
        )
        return
    if not isinstance(payload, dict):
        return

    def apply(db, game: StoryGame) -> None:
        assistant_message = db.get(StoryMessage, int(assistant_message_id))
        if assistant_message is None:
            return
        monolith_main._upsert_story_plot_memory_card(
            db=db,
            game=game,
            assistant_message=assistant_message,
            latest_user_prompt_override=context["user_prompt"],
            latest_assistant_text_override=context["assistant_text"],
            resolved_postprocess_payload_override=payload,
            memory_optimization_enabled=context["memory_optimization_enabled"],
            # Everything this step needs is already resolved; no further provider call.
            allow_model_postprocess_request=False,
        )

    _run_apply_burst(
        game_id=game_id,
        assistant_message_id=assistant_message_id,
        step="characters",
        apply=apply,
        deadline=deadline,
    )


def _run_graph_step(*, game_id: int, assistant_message_id: int, context: dict[str, Any], deadline: float) -> int:
    """Run the knowledge-graph pass. Returns how many service requests it actually spent."""
    if not (context["graph_nodes_enabled"] or context["graph_edges_enabled"]):
        return 0
    if not _wait_for_a_quiet_moment(game_id, deadline):
        return 0

    from app.services.story_graph import analyze_story_graph_after_turn

    # The graph analyser resolves and applies in one pass, so this step does need the lock for
    # its provider call. It is taken at background priority and only once the game is quiet,
    # and the analyser's own deadline bounds how long that can last.
    budget = StoryServiceHttpRequestBudget(max_requests=_GRAPH_MAX_SERVICE_REQUESTS)

    def apply(db, game: StoryGame) -> None:
        with use_story_turn_service_deadline(_SERVICE_DEADLINE_SECONDS), use_story_service_http_request_budget(budget):
            analyze_story_graph_after_turn(
                db=db,
                game=game,
                latest_user_prompt=context["user_prompt"],
                latest_assistant_text=context["assistant_text"],
                assistant_message_id=int(assistant_message_id),
                apply_high_confidence=True,
                confidence_threshold=context["graph_confidence"],
                confirm_low_confidence=context["graph_confirm_low"],
                allow_model_request=True,
                allow_node_actions=context["graph_nodes_enabled"],
                allow_edge_actions=context["graph_edges_enabled"],
            )

    _run_apply_burst(
        game_id=game_id,
        assistant_message_id=assistant_message_id,
        step="graph",
        apply=apply,
        deadline=deadline,
    )
    used = int(budget.used_requests or 0)
    return max(1, min(used, _GRAPH_MAX_SERVICE_REQUESTS)) if used > 0 else 0


def _settle_graph_precharge(*, game_id: int, owner_user_id: int, precharged: int, actually_used: int) -> None:
    """Give back the part of the graph pre-charge the analysis did not spend.

    The turn charges the graph's worst case up front and refunds the difference, which used to
    happen inline because the analysis did. Now that it runs here, so does the refund. Only
    ever adds sols, so it cannot fail on a player who has since spent their balance.
    """
    refund = max(int(precharged or 0) - max(int(actually_used or 0), 0), 0)
    if refund <= 0 or int(owner_user_id or 0) <= 0:
        return
    db = SessionLocal()
    try:
        from app.services.concurrency import add_user_tokens

        add_user_tokens(db, user_id=int(owner_user_id), tokens=refund)
        db.commit()
        logger.info(
            "Refunded unused graph AI turn cost off-turn: game_id=%s user_id=%s refund=%s",
            game_id,
            owner_user_id,
            refund,
        )
    except Exception:
        logger.warning(
            "Could not refund unused graph AI turn cost: game_id=%s user_id=%s refund=%s",
            game_id,
            owner_user_id,
            refund,
            exc_info=True,
        )
        try:
            db.rollback()
        except Exception:
            logger.debug("Graph refund rollback failed", exc_info=True)
    finally:
        try:
            db.close()
        except Exception:
            logger.debug("Graph refund session close failed", exc_info=True)


def _run_dnd_step(
    *,
    game_id: int,
    assistant_message_id: int,
    context: dict[str, Any],
    dnd_consumed_roll: dict[str, Any] | None,
    turn_index: int,
    deadline: float,
) -> None:
    if not _wait_for_a_quiet_moment(game_id, deadline):
        return

    from app.services.story_dnd import (
        describe_roll_for_prompt,
        get_game_dnd_state,
        set_game_dnd_state,
    )
    from app.services.story_dnd_apply import apply_dnd_turn_upkeep, sync_dnd_npcs_from_world_cards
    from app.services.story_dnd_service import describe_upkeep_for_log, resolve_dnd_turn_upkeep
    from app.services.story_queries import list_story_world_cards

    def resolve() -> dict[str, Any] | None:
        db = SessionLocal()
        try:
            game = db.get(StoryGame, int(game_id))
            if game is None:
                return None
            world_cards = list_story_world_cards(db, int(game_id))
            state = sync_dnd_npcs_from_world_cards(get_game_dnd_state(game), world_cards)
            deadline_scope, budget_scope = _service_call_scope()
            with deadline_scope, budget_scope:
                return resolve_dnd_turn_upkeep(
                    state=state,
                    player_action=context["user_prompt"],
                    narrator_text=context["assistant_text"],
                    roll_summary=describe_roll_for_prompt(dnd_consumed_roll),
                    location_label=context["location_label"],
                    existing_npc_cards=[
                        {
                            "id": int(getattr(card, "id", 0) or 0),
                            "name": str(getattr(card, "title", "") or ""),
                        }
                        for card in world_cards
                        if str(getattr(card, "kind", "") or "").strip().lower() == "npc"
                    ],
                    game_id=int(game_id),
                )
        finally:
            try:
                db.close()
            except Exception:
                logger.debug("Story D&D upkeep session close failed", exc_info=True)

    upkeep_payload: dict[str, Any] | None = None
    try:
        upkeep_payload = resolve()
    except Exception:
        # The sheet falling one turn behind is survivable; the turn counter below is not, so
        # the apply still runs with an empty payload.
        logger.warning(
            "Story D&D upkeep failed off-turn: game_id=%s assistant_message_id=%s",
            game_id,
            assistant_message_id,
            exc_info=True,
        )

    def apply(db, game: StoryGame) -> None:
        from app.services.story_queries import touch_story_game

        assistant_message = db.get(StoryMessage, int(assistant_message_id))
        current_state = sync_dnd_npcs_from_world_cards(
            get_game_dnd_state(game),
            list_story_world_cards(db, int(game_id)),
        )
        next_state, changes = apply_dnd_turn_upkeep(
            current_state,
            upkeep_payload or {},
            turn_index=int(turn_index or 0),
            location_label=str(getattr(game, "current_location_label", "") or ""),
        )
        next_state["turn_count"] = max(int(current_state.get("turn_count") or 0), 0) + 1
        if isinstance(next_state.get("last_roll"), dict) and dnd_consumed_roll is not None:
            next_state["last_roll"]["consumed"] = True
        set_game_dnd_state(game, next_state)
        if assistant_message is not None:
            # Stamp the turn with the sheet it produced, so undo can put it back.
            assistant_message.dnd_state_snapshot = str(getattr(game, "dnd_state_payload", "") or "")
        touch_story_game(game)
        logger.info(
            "Story D&D upkeep applied off-turn: game_id=%s assistant_message_id=%s %s changes=%s",
            game_id,
            assistant_message_id,
            describe_upkeep_for_log(upkeep_payload or {}),
            "; ".join(changes[:12]) or "none",
        )

    _run_apply_burst(
        game_id=game_id,
        assistant_message_id=assistant_message_id,
        step="dnd",
        apply=apply,
        deadline=deadline,
    )


def _run_story_turn_postprocess(
    *,
    game_id: int,
    assistant_message_id: int,
    dnd_enabled: bool,
    dnd_consumed_roll: dict[str, Any] | None,
    turn_index: int,
    precharged_graph_cost_tokens: int = 0,
    owner_user_id: int = 0,
) -> None:
    graph_requests_used = 0
    deadline = time.monotonic() + _RUN_DEADLINE_SECONDS
    try:
        context = _load_turn_context(game_id, assistant_message_id)
        if context is None:
            return

        _run_character_analysis_step(
            game_id=game_id,
            assistant_message_id=assistant_message_id,
            context=context,
            deadline=deadline,
        )
        graph_requests_used = _run_graph_step(
            game_id=game_id,
            assistant_message_id=assistant_message_id,
            context=context,
            deadline=deadline,
        )
        if dnd_enabled:
            _run_dnd_step(
                game_id=game_id,
                assistant_message_id=assistant_message_id,
                context=context,
                dnd_consumed_roll=dnd_consumed_roll,
                turn_index=turn_index,
                deadline=deadline,
            )
    except Exception:
        logger.warning(
            "Story turn post-process run failed: game_id=%s assistant_message_id=%s",
            game_id,
            assistant_message_id,
            exc_info=True,
        )
    finally:
        # Settle the graph pre-charge whatever happened above -- including a run that never got
        # a quiet moment, where the whole pre-charge goes back.
        _settle_graph_precharge(
            game_id=game_id,
            owner_user_id=owner_user_id,
            precharged=precharged_graph_cost_tokens,
            actually_used=graph_requests_used,
        )
        _release_scheduled_game(int(game_id))
        try:
            from app.services.story_memory_background import schedule_story_memory_compaction

            schedule_story_memory_compaction(int(game_id))
        except Exception:
            logger.debug("Could not chain memory compaction after turn post-process", exc_info=True)


def schedule_story_turn_postprocess(
    *,
    game_id: int | None,
    assistant_message_id: int | None,
    dnd_enabled: bool = False,
    dnd_consumed_roll: dict[str, Any] | None = None,
    turn_index: int = 0,
    precharged_graph_cost_tokens: int = 0,
    owner_user_id: int = 0,
) -> bool:
    """Queue the deferred half of a turn's post-process. False when already queued."""
    try:
        normalized_game_id = int(game_id or 0)
        normalized_assistant_message_id = int(assistant_message_id or 0)
    except (TypeError, ValueError):
        return False
    if normalized_game_id <= 0 or normalized_assistant_message_id <= 0:
        return False

    with _scheduled_lock:
        if normalized_game_id in _scheduled_game_ids:
            return False
        _scheduled_game_ids.add(normalized_game_id)

    try:
        _get_executor().submit(
            _run_story_turn_postprocess,
            game_id=normalized_game_id,
            assistant_message_id=normalized_assistant_message_id,
            dnd_enabled=bool(dnd_enabled),
            dnd_consumed_roll=dnd_consumed_roll,
            turn_index=int(turn_index or 0),
            precharged_graph_cost_tokens=int(precharged_graph_cost_tokens or 0),
            owner_user_id=int(owner_user_id or 0),
        )
    except Exception:
        _release_scheduled_game(normalized_game_id)
        logger.warning(
            "Could not schedule story turn post-process: game_id=%s", normalized_game_id, exc_info=True
        )
        return False
    return True
