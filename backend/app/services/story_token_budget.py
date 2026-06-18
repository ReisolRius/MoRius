from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any, Iterable


_TOKEN_PATTERN = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+|[^\s]", re.UNICODE)


@dataclass(frozen=True)
class MemoryBudgetProfile:
    fresh: float
    compressed: float
    facts: float

    def validate(self) -> "MemoryBudgetProfile":
        values = (self.fresh, self.compressed, self.facts)
        if any(value < 0 for value in values):
            raise ValueError("Memory budget profile values cannot be negative")
        if sum(values) > 1.000001:
            raise ValueError("Memory budget profile total cannot exceed 1.0")
        return self


@dataclass(frozen=True)
class TokenBudgetResult:
    user_memory_token_limit: int
    active_cards_token_count: int
    available_history_tokens: int
    fresh_budget: int
    compressed_budget: int
    facts_budget: int
    profile_name: str
    profile: MemoryBudgetProfile


MEMORY_BUDGET_PROFILES: dict[str, MemoryBudgetProfile] = {
    "standard": MemoryBudgetProfile(fresh=0.50, compressed=0.30, facts=0.20),
    "enhanced": MemoryBudgetProfile(fresh=0.30, compressed=0.35, facts=0.35),
    "maximum": MemoryBudgetProfile(fresh=0.60, compressed=0.25, facts=0.15),
}


class TokenCounter:
    """Token counter adapter with a conservative local fallback.

    A provider-native count API can be wired behind this class later. The local
    estimate is token-like, not character-count based, and handles Cyrillic by
    counting words/punctuation with a safety margin.
    """

    def __init__(self, *, safety_margin: float = 1.15) -> None:
        self.safety_margin = max(float(safety_margin), 1.0)

    def count_text(self, value: Any, *, apply_margin: bool = True) -> int:
        normalized = str(value or "").replace("\r\n", "\n").strip()
        if not normalized:
            return 0
        raw_count = len(_TOKEN_PATTERN.findall(normalized))
        if raw_count <= 0:
            raw_count = 1
        if not apply_margin:
            return raw_count
        return max(1, int(math.ceil(raw_count * self.safety_margin)))


class TokenBudgetService:
    def __init__(self, token_counter: TokenCounter | None = None) -> None:
        self.token_counter = token_counter or TokenCounter()

    def resolve_profile(self, optimization_mode: str | None) -> tuple[str, MemoryBudgetProfile]:
        profile_name = str(optimization_mode or "").strip().lower() or "standard"
        profile = MEMORY_BUDGET_PROFILES.get(profile_name)
        if profile is None:
            profile_name = "standard"
            profile = MEMORY_BUDGET_PROFILES[profile_name]
        return profile_name, profile.validate()

    def calculate(
        self,
        *,
        user_memory_token_limit: int,
        active_cards_token_count: int,
        optimization_mode: str | None,
    ) -> TokenBudgetResult:
        limit = max(int(user_memory_token_limit or 0), 0)
        card_tokens = max(int(active_cards_token_count or 0), 0)
        available = max(0, limit - card_tokens)
        profile_name, profile = self.resolve_profile(optimization_mode)
        return TokenBudgetResult(
            user_memory_token_limit=limit,
            active_cards_token_count=card_tokens,
            available_history_tokens=available,
            fresh_budget=int(available * profile.fresh),
            compressed_budget=int(available * profile.compressed),
            facts_budget=int(available * profile.facts),
            profile_name=profile_name,
            profile=profile,
        )

    def count_card_tokens(self, card: Any) -> int:
        if isinstance(card, dict):
            title = str(card.get("title") or card.get("name") or "").strip()
            content = str(card.get("content") or card.get("description") or "").strip()
            kind = str(card.get("kind") or "").strip()
            triggers = card.get("triggers")
        else:
            title = str(getattr(card, "title", "") or getattr(card, "name", "") or "").strip()
            content = str(getattr(card, "content", "") or getattr(card, "description", "") or "").strip()
            kind = str(getattr(card, "kind", "") or "").strip()
            triggers = getattr(card, "triggers", None)
        trigger_text = ""
        if isinstance(triggers, str):
            trigger_text = triggers
        elif isinstance(triggers, Iterable):
            trigger_text = ", ".join(str(item) for item in triggers if str(item or "").strip())
        payload = "\n".join(part for part in (kind, title, content, trigger_text) if part)
        return self.token_counter.count_text(payload)

    def count_active_cards(self, cards: Iterable[Any]) -> int:
        return sum(self.count_card_tokens(card) for card in cards)

    def count_block_tokens(self, block: Any) -> int:
        explicit_count = int(getattr(block, "token_count", 0) or 0)
        if explicit_count > 0:
            return explicit_count
        return self.token_counter.count_text(getattr(block, "content", ""))

    def choose_blocks_that_fit(self, blocks: Iterable[Any], budget_tokens: int) -> list[Any]:
        selected: list[Any] = []
        consumed = 0
        budget = max(int(budget_tokens or 0), 0)
        for block in blocks:
            block_tokens = max(self.count_block_tokens(block), 1)
            if consumed + block_tokens > budget:
                continue
            selected.append(block)
            consumed += block_tokens
        return selected
