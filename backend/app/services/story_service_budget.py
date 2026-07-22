from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
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


def consume_story_service_http_request() -> None:
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
