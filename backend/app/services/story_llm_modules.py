from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.config import POLZA_GEMINI_25_FLASH_MODEL, settings
from app.services.provider_resilience import is_content_policy_error


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


class ImportantMemoryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    should_store: bool = False
    significance_score: int = 0
    title: str = ""
    summary: str = ""
    significance: str = ""

    @model_validator(mode="before")
    @classmethod
    def _accept_imperfect_important_memory_shapes(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if payload.get("significance_score") is None and bool(payload.get("should_store")):
            has_content = bool(str(payload.get("title") or "").strip()) and bool(
                str(payload.get("summary") or "").strip()
            )
            if has_content:
                payload["significance_score"] = 7
        return payload

    @model_validator(mode="after")
    def _validate_important_memory(self) -> "ImportantMemoryPayload":
        try:
            self.significance_score = max(0, min(10, int(self.significance_score)))
        except (TypeError, ValueError):
            self.significance_score = 0
        self.title = " ".join(str(self.title or "").split()).strip()[:160].rstrip()
        self.summary = " ".join(str(self.summary or "").split()).strip()[:1200].rstrip()
        self.significance = " ".join(str(self.significance or "").split()).strip()[:500].rstrip()
        if self.should_store and (not self.title or not self.summary):
            raise ValueError("important memory requires non-empty title and summary")
        if not self.should_store:
            self.title = ""
            self.summary = ""
        return self


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

    @model_validator(mode="before")
    @classmethod
    def _accept_common_location_shapes(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        current = payload.get("current")
        if not isinstance(current, dict):
            current = {}
        else:
            current = dict(current)
        display = (
            current.get("display")
            or payload.get("display")
            or payload.get("label")
            or payload.get("current_location_label")
            or payload.get("location_label")
            or payload.get("content")
        )
        if display and not current.get("display"):
            current["display"] = display
        if not isinstance(current.get("display"), str):
            current["display"] = ""
        payload["current"] = current
        if payload.get("changed") and payload.get("should_update") is None:
            payload["should_update"] = True
        return payload

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


class InventoryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str = ""
    source: str = "unchanged"
    should_update: bool = False


class HealthPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str = ""
    source: str = "unchanged"
    should_update: bool = False


class CharacterUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    character_ref: CharacterRefPayload = Field(default_factory=CharacterRefPayload)
    clothing: ClothingPayload = Field(default_factory=ClothingPayload)
    inventory: InventoryPayload = Field(default_factory=InventoryPayload)
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
    clothing: str = ""
    inventory: str = ""
    health_status: str = ""
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

    @model_validator(mode="after")
    def _validate_action_payload(self) -> "NpcCardActionPayload":
        action_type = str(self.type or "").strip()
        if action_type == "create_card":
            if self.new_card is None:
                self.type = "no_action"
                return self
            if not str(self.new_card.name or "").strip():
                self.type = "no_action"
                return self
            if not any(str(trigger or "").strip() for trigger in self.new_card.triggers):
                self.new_card.triggers = [self.new_card.name]
        elif action_type == "update_existing_card":
            raw_id = str(self.existing_card_id or "").strip()
            if not raw_id.isdigit() or int(raw_id) <= 0:
                self.type = "no_action"
                return self
        elif action_type != "no_action":
            self.type = "no_action"
        return self


class NpcCardsPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    actions: list[NpcCardActionPayload] = Field(default_factory=list)

    @field_validator("actions", mode="before")
    @classmethod
    def _keep_only_action_objects(cls, value: Any) -> list[dict[str, Any]]:
        if isinstance(value, dict) and isinstance(value.get("actions"), list):
            value = value.get("actions")
        if not isinstance(value, list):
            return []
        cleaned: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            action_type = str(item.get("type") or item.get("action") or "").strip()
            if action_type in {"create", "new", "add", "add_card", "create_npc", "create_character"}:
                action_type = "create_card"
            elif action_type in {"update", "update_card", "update_npc", "update_character"}:
                action_type = "update_existing_card"
            if not action_type:
                action_type = (
                    "create_card"
                    if isinstance(item.get("new_card"), dict) or str(item.get("name") or "").strip()
                    else "update_existing_card"
                    if str(item.get("existing_card_id") or item.get("card_id") or "").strip()
                    else "no_action"
                )
            if action_type not in {"create_card", "update_existing_card", "no_action"}:
                continue
            if action_type == "create_card":
                new_card = item.get("new_card")
                if not isinstance(new_card, dict):
                    new_card = {
                        key: item.get(key)
                        for key in (
                            "name",
                            "race",
                            "description",
                            "personality",
                            "clothing",
                            "inventory",
                            "health_status",
                            "triggers",
                            "importance_reason",
                        )
                        if key in item
                    }
                if not str(new_card.get("name") or "").strip():
                    continue
                item = {**item, "type": action_type, "new_card": new_card}
            elif action_type == "update_existing_card":
                raw_id = str(item.get("existing_card_id") or item.get("card_id") or "").strip()
                if not raw_id.isdigit() or int(raw_id) <= 0:
                    continue
                item = {**item, "type": action_type, "existing_card_id": raw_id}
            else:
                item = {**item, "type": action_type}
            cleaned.append(item)
        return cleaned


class GameStateAnalysisPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location: LocationPayload = Field(default_factory=LocationPayload)
    auto_state: AutoStatePayload = Field(default_factory=AutoStatePayload)
    npc_cards: NpcCardsPayload = Field(default_factory=NpcCardsPayload)


class AmbientPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scene: str = ""
    lighting: str = ""
    primary_color: str = ""
    secondary_color: str = ""
    highlight_color: str = ""
    glow_strength: float | None = None
    background_mix: float | None = None
    vignette_strength: float | None = None


class EnvironmentWeatherPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: str = ""
    temperature_c: int | None = None
    fog: str = ""
    humidity: str = ""
    wind: str = ""


class EnvironmentPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    should_update: bool = False
    advance_minutes: int = 0
    weather: EnvironmentWeatherPayload | None = None

    @model_validator(mode="before")
    @classmethod
    def _accept_common_environment_shapes(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if "advance_minutes" not in payload:
            for alias in ("advanceMinutes", "minutes", "elapsed_minutes", "time_delta_minutes"):
                if alias in payload:
                    payload["advance_minutes"] = payload.get(alias)
                    break
        if payload.get("advance_minutes") and payload.get("should_update") is None:
            payload["should_update"] = True
        return payload

    @field_validator("advance_minutes", mode="before")
    @classmethod
    def _coerce_advance_minutes(cls, value: Any) -> int:
        try:
            minutes = int(float(value))
        except (TypeError, ValueError):
            return 0
        # In-game time only ever moves forward, and a single turn cannot leap more
        # than a week. Clamp here so a hallucinated huge value can never corrupt the clock.
        return max(0, min(minutes, 7 * 24 * 60))


class WorldAnalysisPayload(BaseModel):
    """Call A — единый «мировой» анализ хода.

    Все секции опциональны: в промпт попадают только включённые модули, поэтому
    отключённый модуль не описывается в инструкции и остаётся значением по умолчанию.
    """

    model_config = ConfigDict(extra="ignore")

    location: LocationPayload = Field(default_factory=LocationPayload)
    environment: EnvironmentPayload = Field(default_factory=EnvironmentPayload)
    important_memory: ImportantMemoryPayload = Field(default_factory=ImportantMemoryPayload)
    ambient: AmbientPayload | None = None


class SceneBackgroundPromptPayload(BaseModel):
    """Visual Novel scene background prompt (admin-triggered, Gemini 2.5 flash).

    An empty scene (just the location) unless the last turn implies a crowd/people present,
    in which case generic (unnamed) figures may be described -- never specific named characters.
    """

    model_config = ConfigDict(extra="ignore")

    prompt: str = ""
    location_title: str = ""
    has_people: bool = False


def _strip_json_markdown_fence(value: str) -> str:
    normalized = str(value or "").strip()
    fenced_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", normalized, flags=re.IGNORECASE | re.DOTALL)
    if fenced_match:
        return fenced_match.group(1).strip()
    return normalized


def strict_json_loads(raw_response: str) -> dict[str, Any]:
    normalized = _strip_json_markdown_fence(raw_response)
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
        include_configured_fallback: bool = True,
    ) -> None:
        configured_primary = str(primary_model or POLZA_GEMINI_25_FLASH_MODEL).strip()
        self.primary_model = configured_primary or POLZA_GEMINI_25_FLASH_MODEL
        configured_fallback = str(settings.polza_service_fallback_model or "").strip()
        resolved_fallbacks = [str(item or "").strip() for item in (fallback_models or []) if str(item or "").strip()]
        if (
            include_configured_fallback
            and configured_fallback
            and configured_fallback != self.primary_model
            and configured_fallback not in resolved_fallbacks
        ):
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
                    retry_on_rate_limit=True,
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
                if is_content_policy_error(exc):
                    raise RuntimeError(f"{module} request was prohibited by content policy") from exc
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
