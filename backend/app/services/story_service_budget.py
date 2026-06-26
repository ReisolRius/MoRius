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
    budget = _active_story_service_http_budget.get()
    if budget is not None:
        budget.consume()
