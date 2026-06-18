from __future__ import annotations

import json
import logging
from typing import Any, Callable, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.config import POLZA_GEMINI_25_FLASH_MODEL, settings


logger = logging.getLogger(__name__)
SchemaT = TypeVar("SchemaT", bound=BaseModel)


class ImportantEntityPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    type: str = "other"
    note: str = ""


class DetailedMemoryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: str
    important_entities: list[ImportantEntityPayload] = Field(default_factory=list)
    state_changes: list[str] = Field(default_factory=list)
    open_threads: list[str] = Field(default_factory=list)


class CompressedMemoryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: str
    key_facts: list[str] = Field(default_factory=list)
    open_threads: list[str] = Field(default_factory=list)


class FactMemoryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    facts: list[str] = Field(default_factory=list)
    persistent_state: list[str] = Field(default_factory=list)
    open_threads: list[str] = Field(default_factory=list)


class LocationCurrentPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    country: str | None = None
    region: str | None = None
    city: str | None = None
    district: str | None = None
    street: str | None = None
    place_name: str | None = None
    place_type: str | None = None
    room_or_area: str | None = None
    display: str = ""


class LocationPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    changed: bool = False
    confidence: str = "low"
    current: LocationCurrentPayload = Field(default_factory=LocationCurrentPayload)
    evidence: str = ""
    should_update: bool = False

    @field_validator("confidence")
    @classmethod
    def _normalize_confidence(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        return normalized if normalized in {"high", "medium", "low"} else "low"


class CharacterRefPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int | str | None = None
    name: str = ""


class ClothingPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str = ""
    source: str = "unchanged"
    should_update: bool = False


class InventoryChangePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    action: str = "unknown_change"
    item: str = ""
    details: str = ""
    confidence: str = "low"


class HealthPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str = "normal"
    source: str = "default"
    should_update: bool = False


class CharacterUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    character_ref: CharacterRefPayload = Field(default_factory=CharacterRefPayload)
    clothing: ClothingPayload = Field(default_factory=ClothingPayload)
    inventory_changes: list[InventoryChangePayload] = Field(default_factory=list)
    health: HealthPayload = Field(default_factory=HealthPayload)


class AutoStatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    character_updates: list[CharacterUpdatePayload] = Field(default_factory=list)


class NewNpcCardPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    race: str | None = None
    description: str = ""
    personality: str = ""
    triggers: list[str] = Field(default_factory=list)
    importance_reason: str = ""


class UpdateExistingNpcPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    add_triggers: list[str] = Field(default_factory=list)
    notes: str = ""


class NpcCardActionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = "no_action"
    existing_card_id: int | str | None = None
    new_card: NewNpcCardPayload | None = None
    update_existing: UpdateExistingNpcPayload | None = None
    evidence: str = ""


class NpcCardsPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actions: list[NpcCardActionPayload] = Field(default_factory=list)


class GameStateAnalysisPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location: LocationPayload = Field(default_factory=LocationPayload)
    auto_state: AutoStatePayload = Field(default_factory=AutoStatePayload)
    npc_cards: NpcCardsPayload = Field(default_factory=NpcCardsPayload)


def strict_json_loads(raw_response: str) -> dict[str, Any]:
    normalized = str(raw_response or "").strip()
    if not normalized:
        raise ValueError("LLM returned empty response")
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError as direct_error:
        decoder = json.JSONDecoder()
        parsed = None
        for index, character in enumerate(normalized):
            if character != "{":
                continue
            try:
                candidate, _end_index = decoder.raw_decode(normalized[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                parsed = candidate
                break
        if parsed is None:
            raise direct_error
    if not isinstance(parsed, dict):
        raise ValueError("LLM response root must be a JSON object")
    return parsed


class LlmModuleService:
    def __init__(
        self,
        request_text: Callable[..., str],
        *,
        primary_model: str | None = None,
        fallback_models: list[str] | None = None,
    ) -> None:
        configured_primary = str(primary_model or POLZA_GEMINI_25_FLASH_MODEL).strip()
        self.primary_model = configured_primary or POLZA_GEMINI_25_FLASH_MODEL
        configured_fallback = str(settings.polza_service_fallback_model or "").strip()
        resolved_fallbacks = [str(item or "").strip() for item in (fallback_models or []) if str(item or "").strip()]
        if configured_fallback and configured_fallback != self.primary_model and configured_fallback not in resolved_fallbacks:
            resolved_fallbacks.append(configured_fallback)
        self.fallback_models = resolved_fallbacks
        self._request_text = request_text

    def call_json(
        self,
        *,
        messages: list[dict[str, str]],
        schema: type[SchemaT],
        module: str,
        game_id: int | None = None,
        turn_id: int | None = None,
        max_tokens: int = 900,
        temperature: float = 0.0,
        max_attempts: int = 2,
        request_timeout: tuple[float, float] | None = (8.0, 60.0),
    ) -> tuple[SchemaT, dict[str, Any]]:
        attempts = max(1, int(max_attempts or 1))
        candidate_models = list(
            dict.fromkeys(
                candidate
                for candidate in (self.primary_model, *self.fallback_models)
                if str(candidate or "").strip()
            )
        )
        if not candidate_models:
            candidate_models = [self.primary_model]
        last_error: Exception | None = None
        for attempt_index in range(attempts):
            candidate_model = candidate_models[min(attempt_index, len(candidate_models) - 1)]
            fallback_used = candidate_model != self.primary_model
            raw_response = ""
            try:
                raw_response = self._request_text(
                    messages,
                    model_name=candidate_model,
                    fallback_model_names=[],
                    allow_service_fallback=False,
                    include_configured_service_fallback=False,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    request_timeout=request_timeout,
                    retry_on_rate_limit=False,
                )
                parsed = strict_json_loads(raw_response)
                payload = schema.model_validate(parsed)
                provider_meta = {
                    "provider": candidate_model,
                    "fallbackUsed": fallback_used,
                    "attempt": attempt_index + 1,
                    "llmModule": module,
                    "gameId": game_id,
                    "turnId": turn_id,
                }
                logger.info(
                    "Story LLM module JSON ok",
                    extra={
                        "gameId": game_id,
                        "turnId": turn_id,
                        "llmModule": module,
                        "provider": candidate_model,
                        "fallbackUsed": fallback_used,
                        "callCount": attempt_index + 1,
                    },
                )
                return payload, provider_meta
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                last_error = exc
                logger.warning(
                    "Story LLM module JSON validation failed",
                    extra={
                        "gameId": game_id,
                        "turnId": turn_id,
                        "llmModule": module,
                        "provider": candidate_model,
                        "fallbackUsed": fallback_used,
                        "callCount": attempt_index + 1,
                        "validationErrors": str(exc),
                    },
                )
                if attempt_index + 1 >= attempts:
                    break
                messages = [
                    *messages,
                    {
                        "role": "user",
                        "content": (
                            "Предыдущий ответ не прошел strict JSON validation. "
                            "Верни только валидный JSON строго по указанной схеме, без markdown и без пояснений."
                        ),
                    },
                ]
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Story LLM module request failed",
                    extra={
                        "gameId": game_id,
                        "turnId": turn_id,
                        "llmModule": module,
                        "provider": candidate_model,
                        "fallbackUsed": fallback_used,
                        "callCount": attempt_index + 1,
                        "validationErrors": str(exc),
                    },
                )
                if attempt_index + 1 >= attempts:
                    break
        raise RuntimeError(f"{module} LLM JSON call failed: {last_error}") from last_error
