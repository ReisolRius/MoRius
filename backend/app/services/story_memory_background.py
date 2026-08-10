"""Off-turn memory compaction.

Compressing a finished turn costs a service-model round trip, which used to run inside the
turn's own request while the per-game generation lock was still held -- so the player waited
for it before they could act again. Compaction is not needed to answer the next turn: an
uncompressed turn is simply sent to the narrator as-is until its summary is ready. So it runs
here instead, on a small background pool, and the turn returns as soon as its own modules are
done.

Guarantees this module is responsible for:

* **At most one compaction per game at a time.** Two runs for the same game would fight over
  the same rows, so a game already queued or running is never queued twice -- a single run
  drains whatever is pending anyway.
* **Never blocks or breaks a turn.** Every failure is swallowed and logged; blocks that fail
  to compact stay marked pending and are retried by a later run.
* **Survives the player leaving.** The work is server-side and already scheduled by the time
  the response is sent, so closing the browser mid-turn does not abandon it. Work lost to a
  process restart is picked up by the next turn on that game, because the pipeline selects
  whatever is still uncompacted rather than tracking a queue in memory.
* **Does not consume the turn's service-request budget.** The budget lives in ContextVars,
  which do not propagate into these worker threads, so background compaction cannot starve
  the modules that a turn genuinely has to wait for.

The newest assistant turn is deliberately never compacted -- it is kept whole so the player
can still edit it and so the client stays in sync.
"""

from __future__ import annotations

import atexit
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from app.database import SessionLocal
from app.models import StoryGame

logger = logging.getLogger(__name__)

# Compaction is latency-tolerant, so a couple of workers is plenty: they exist to keep one
# slow game from stalling every other game's queue, not to run a game's work in parallel.
_MAX_WORKERS = 2

# Each run may spend this many service-model requests. It is off the critical path now, so it
# can drain a backlog faster than the old in-turn budget allowed without the player noticing.
_MAX_MODEL_REQUESTS_PER_RUN = 3

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
                thread_name_prefix="story-memory-compaction",
            )
            atexit.register(shutdown_story_memory_compaction)
        return _executor


def shutdown_story_memory_compaction(wait: bool = True) -> None:
    """Let in-flight compaction finish instead of tearing it down mid-transaction."""
    global _executor
    with _executor_lock:
        executor = _executor
        _executor = None
    if executor is not None:
        executor.shutdown(wait=wait)


def _run_story_memory_compaction(game_id: int) -> None:
    try:
        db = SessionLocal()
    except Exception:
        logger.exception("Background memory compaction could not open a session: game_id=%s", game_id)
        _release_scheduled_game(game_id)
        return

    try:
        game = db.get(StoryGame, game_id)
        if game is None:
            return
        from app.services import story_memory_pipeline

        # require_model_compaction stays False on purpose: a failure here has no caller to
        # report to, and raising would only lose the blocks that did compact successfully.
        # Failed blocks are left marked pending and retried by a later run.
        changed = bool(
            story_memory_pipeline._rebalance_story_memory_layers(
                db=db,
                game=game,
                max_model_requests=_MAX_MODEL_REQUESTS_PER_RUN,
                require_model_compaction=False,
                commit_each_model_compaction=True,
                prioritize_recent_transitions=True,
            )
        )
        db.commit()
        if changed:
            logger.info("Background memory compaction applied: game_id=%s", game_id)
    except Exception:
        try:
            db.rollback()
        except Exception:
            logger.exception("Background memory compaction rollback failed: game_id=%s", game_id)
        logger.warning("Background memory compaction failed: game_id=%s", game_id, exc_info=True)
    finally:
        try:
            db.close()
        except Exception:
            logger.exception("Background memory compaction could not close its session: game_id=%s", game_id)
        _release_scheduled_game(game_id)


def _release_scheduled_game(game_id: int) -> None:
    with _scheduled_lock:
        _scheduled_game_ids.discard(game_id)


def schedule_story_memory_compaction(game_id: int | None) -> bool:
    """Queue off-turn compaction for a game. Returns False when it was already queued.

    Safe to call on every turn: a game that already has a run queued or in flight is skipped,
    because that run compacts whatever is pending when it gets there.
    """
    try:
        normalized_game_id = int(game_id or 0)
    except (TypeError, ValueError):
        return False
    if normalized_game_id <= 0:
        return False

    with _scheduled_lock:
        if normalized_game_id in _scheduled_game_ids:
            return False
        _scheduled_game_ids.add(normalized_game_id)

    try:
        _get_executor().submit(_run_story_memory_compaction, normalized_game_id)
    except Exception:
        # A rejected submission (e.g. during shutdown) must not leave the game permanently
        # marked as queued, or it would never be compacted again in this process.
        _release_scheduled_game(normalized_game_id)
        logger.warning("Could not schedule background memory compaction: game_id=%s", normalized_game_id, exc_info=True)
        return False
    return True
