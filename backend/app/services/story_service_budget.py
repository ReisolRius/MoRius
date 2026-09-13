from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import time
from typing import Iterator


@dataclass
class StoryServiceHttpRequestBudget:
    max_requests: int
    used_requests: int = 0

    def consume(self) -> None:
        if self.used_requests >= self.max_requests:
            raise RuntimeError(
                f"Story service HTTP request budget exhausted ({self.max_requests})"
            )
        self.used_requests += 1


_active_story_service_http_budget: ContextVar[
    StoryServiceHttpRequestBudget | None
] = ContextVar("active_story_service_http_budget", default=None)

# Turn-wide hard ceiling on ALL service-model HTTP requests of a single turn. This is a
# SEPARATE budget from the per-module one above: individual modules (Call A «Мир», Call B
# «Персонажи», сжатие памяти через or_reserve, важные события, граф) each keep their own
# independent budget so they don't starve each other, but every request also decrements this
# turn-wide counter. That guarantees a hard "≤ N per turn" cap no matter how many code paths
# fire (baseline-sync re-runs, retries, etc.). When it is not set, behaviour is unchanged.
_active_story_turn_hard_budget: ContextVar[
    StoryServiceHttpRequestBudget | None
] = ContextVar("active_story_turn_hard_budget", default=None)


@contextmanager
def use_story_service_http_request_budget(
    budget: StoryServiceHttpRequestBudget,
) -> Iterator[StoryServiceHttpRequestBudget]:
    token = _active_story_service_http_budget.set(budget)
    try:
        yield budget
    finally:
        _active_story_service_http_budget.reset(token)


@contextmanager
def use_story_turn_hard_budget(
    budget: StoryServiceHttpRequestBudget,
) -> Iterator[StoryServiceHttpRequestBudget]:
    """Set the turn-wide hard ceiling shared by every service module of the current turn.

    Nested per-module budgets (``use_story_service_http_request_budget`` /
    ``use_story_service_http_request_budget_or_reserve``) replace only the per-module context
    var, never this one, so a request consumed inside a reserved module budget still counts
    against the turn ceiling.
    """
    token = _active_story_turn_hard_budget.set(budget)
    try:
        yield budget
    finally:
        _active_story_turn_hard_budget.reset(token)


@contextmanager
def use_story_service_http_request_budget_or_reserve(
    max_requests: int,
) -> Iterator[StoryServiceHttpRequestBudget]:
    """Reserve a fresh bounded budget for an independent service module.

    Story turn post-processing uses several independent Gemini modules. A saturated location,
    character or graph budget must not starve memory compaction, and memory compaction must still
    have its own explicit ceiling.
    """
    budget = StoryServiceHttpRequestBudget(max_requests=max_requests)
    token = _active_story_service_http_budget.set(budget)
    try:
        yield budget
    finally:
        _active_story_service_http_budget.reset(token)


class StoryTurnServiceDeadlineExceeded(RuntimeError):
    """The turn spent its whole service-time allowance before this request started."""


@dataclass
class StoryTurnServiceDeadline:
    """Wall-clock ceiling for the service-model work that follows one narrator turn.

    The request budgets above cap how *many* service calls a turn may make, which says
    nothing about how long they take: two modules that each sit on a 120-second read timeout
    keep the per-game operation lock for four minutes, and every action the player takes in
    the meantime comes back as "the turn is still syncing". This bounds the whole phase
    instead. Modules that run out of time are simply reported as failed -- the post-process
    pipeline already treats a failed module as retryable and picks it up on a later turn.

    Deliberately NOT applied to the narrator request itself: that one is the turn, and the
    player is watching it stream.
    """

    deadline_monotonic: float

    def remaining_seconds(self) -> float:
        return max(self.deadline_monotonic - time.monotonic(), 0.0)

    def expired(self) -> bool:
        return time.monotonic() >= self.deadline_monotonic


_active_story_turn_service_deadline: ContextVar[
    StoryTurnServiceDeadline | None
] = ContextVar("active_story_turn_service_deadline", default=None)


@contextmanager
def use_story_turn_service_deadline(
    total_seconds: float,
) -> Iterator[StoryTurnServiceDeadline]:
    deadline = StoryTurnServiceDeadline(
        deadline_monotonic=time.monotonic() + max(float(total_seconds), 0.0)
    )
    token = _active_story_turn_service_deadline.set(deadline)
    try:
        yield deadline
    finally:
        _active_story_turn_service_deadline.reset(token)


def story_turn_service_deadline_remaining_seconds() -> float | None:
    """Seconds of service time this turn has left, or None when no deadline is in force."""
    deadline = _active_story_turn_service_deadline.get()
    if deadline is None:
        return None
    return deadline.remaining_seconds()


def ensure_story_turn_service_deadline() -> None:
    deadline = _active_story_turn_service_deadline.get()
    if deadline is not None and deadline.expired():
        raise StoryTurnServiceDeadlineExceeded(
            "Story turn service time budget exhausted"
        )


def clamp_timeout_to_story_turn_service_deadline(
    timeout: tuple[float, float] | float | None,
    *,
    minimum_read_seconds: float = 15.0,
) -> tuple[float, float] | float | None:
    """Shrink a request timeout so one slow call cannot outlive the turn's allowance.

    Floored at `minimum_read_seconds` so a nearly-spent budget hands out a timeout the
    provider could never answer within, turning a slow module into a guaranteed failure.
    """
    remaining = story_turn_service_deadline_remaining_seconds()
    if remaining is None or timeout is None:
        return timeout
    capped_read = max(float(remaining), float(minimum_read_seconds))
    if isinstance(timeout, tuple):
        connect_seconds, read_seconds = timeout
        return (connect_seconds, min(float(read_seconds), capped_read))
    return min(float(timeout), capped_read)


def consume_story_service_http_request() -> None:
    ensure_story_turn_service_deadline()
    turn_budget = _active_story_turn_hard_budget.get()
    module_budget = _active_story_service_http_budget.get()
    # Enforce the turn-wide ceiling first so hitting it never half-consumes a module budget.
    if turn_budget is not None and turn_budget.used_requests >= turn_budget.max_requests:
        raise RuntimeError(
            f"Story turn service HTTP request budget exhausted ({turn_budget.max_requests})"
        )
    if module_budget is not None:
        module_budget.consume()
    if turn_budget is not None:
        turn_budget.consume()
