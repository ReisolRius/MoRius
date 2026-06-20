from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete as sa_delete, func, or_, select
from sqlalchemy.orm import Session

from app.config import POLZA_GEMINI_25_FLASH_MODEL
from app.models import (
    StoryGame,
    StoryGraphEdge,
    StoryGraphEvent,
    StoryGraphNode,
    StoryGraphSuggestion,
    StoryInstructionCard,
    StoryMemoryBlock,
    StoryMessage,
    StoryPlotCard,
    StoryWorldCard,
    User,
)
from app.schemas import (
    StoryGraphAiAnalyzeOut,
    StoryGraphApplySuggestionsOut,
    StoryGraphCardSummaryOut,
    StoryGraphEdgeCreateRequest,
    StoryGraphEdgeOut,
    StoryGraphEdgeUpdateRequest,
    StoryGraphNodeCreateRequest,
    StoryGraphNodeLayoutUpdateRequest,
    StoryGraphNodeOut,
    StoryGraphOut,
    StoryGraphSuggestionOut,
)
from app.services.auth_identity import ROLE_ADMINISTRATOR, ROLE_MODERATOR
from app.services.media import resolve_media_display_url
from app.services.story_cards import deserialize_story_plot_card_triggers, story_plot_card_to_out
from app.services.story_memory import story_memory_block_to_out
from app.services.story_queries import get_user_story_game_or_404
from app.services.story_world_cards import story_world_card_to_out
from app.services.text_encoding import sanitize_likely_utf8_mojibake


logger = logging.getLogger(__name__)

GRAPH_ACCESS_ROLES = {ROLE_ADMINISTRATOR, ROLE_MODERATOR}
GRAPH_CARD_TYPE_WORLD_CARD = "world_card"
GRAPH_CARD_TYPE_INSTRUCTION_CARD = "instruction_card"
GRAPH_CARD_TYPE_PLOT_CARD = "plot_card"
GRAPH_CARD_TYPE_MEMORY_BLOCK = "memory_block"
GRAPH_CARD_TYPES = {
    GRAPH_CARD_TYPE_WORLD_CARD,
    GRAPH_CARD_TYPE_INSTRUCTION_CARD,
    GRAPH_CARD_TYPE_PLOT_CARD,
    GRAPH_CARD_TYPE_MEMORY_BLOCK,
}
GRAPH_RELATION_TYPES = {
    "acquaintance",
    "friend",
    "enemy",
    "member_of",
    "leader_of",
    "works_for",
    "owns",
    "located_in",
    "knows_about",
    "rule_applies_to",
    "plot_about",
    "backstory_for",
    "future_arc_for",
    "memory_about",
    "custom",
}
GRAPH_DIRECTIONS = {"directed", "undirected"}
GRAPH_SCOPES = {
    "global",
    "source_only",
    "target_only",
    "both",
    "character_specific",
    "location_specific",
    "organization_specific",
    "custom",
}
GRAPH_CREATED_BY_VALUES = {"user", "ai", "system"}
GRAPH_SUGGESTION_PENDING = "pending"
GRAPH_SUGGESTION_ACCEPTED = "accepted"
GRAPH_SUGGESTION_DECLINED = "declined"
GRAPH_NODE_DEFAULT_WIDTH = 260.0
GRAPH_NODE_DEFAULT_HEIGHT = 140.0
GRAPH_CONTEXT_MAX_EDGES = 28
GRAPH_CONTEXT_MAX_CHARS = 5_600
GRAPH_ANALYSIS_MAX_CARDS = 220
GRAPH_ANALYSIS_MAX_NODES = 220
GRAPH_ANALYSIS_MAX_EDGES = 260
GRAPH_LLM_MODULE_NAME = "story_graph_analysis"
GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS = 10_000
GRAPH_ANALYSIS_MAX_TURN_CHARS = 30_000
GRAPH_DANGLING_RELATION_WORDS = {
    "about",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "to",
    "with",
    "без",
    "в",
    "для",
    "до",
    "за",
    "из",
    "к",
    "на",
    "о",
    "об",
    "от",
    "по",
    "под",
    "при",
    "про",
    "с",
    "со",
    "у",
}


class _GraphAnalysisPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    create_cards: list[dict[str, Any]] = Field(default_factory=list, alias="createCards")
    add_nodes: list[dict[str, Any]] = Field(default_factory=list, alias="addNodes")
    create_edges: list[dict[str, Any]] = Field(default_factory=list, alias="createEdges")
    update_edges: list[dict[str, Any]] = Field(default_factory=list, alias="updateEdges")
    do_nothing_reason: Any = Field(default="", alias="doNothingReason")

    @field_validator("create_cards", "add_nodes", "create_edges", "update_edges", mode="before")
    @classmethod
    def keep_object_actions(cls, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]


def _compact_text(value: Any, *, max_chars: int | None = None) -> str:
    normalized = " ".join(str(value or "").replace("\r\n", " ").replace("\n", " ").split()).strip()
    normalized = sanitize_likely_utf8_mojibake(normalized)
    if max_chars is not None and len(normalized) > max_chars:
        return normalized[:max_chars].rstrip()
    return normalized


def _json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError):
        return "{}"


def _json_loads_dict(value: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value or "") or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_key(value: Any) -> str:
    normalized = _compact_text(value).casefold()
    return re.sub(r"[^0-9a-zа-яё]+", "", normalized, flags=re.IGNORECASE)


def _normalize_label_key(value: Any) -> str:
    return _normalize_key(value)


def _safe_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned.isdigit():
            return int(cleaned)
    return 0


def _safe_float(value: Any, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(numeric):
        return fallback
    return numeric


def _normalize_confidence(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric):
        return None
    return max(0.0, min(numeric, 1.0))


def _normalize_importance(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return 3
    return max(1, min(numeric, 5))


def _validate_ai_relationship_copy(
    *,
    label: Any,
    description: Any,
    require_label: bool,
    require_description: bool,
) -> str | None:
    normalized_label = _compact_text(label, max_chars=160)
    normalized_description = _compact_text(description, max_chars=4_000)
    if require_label and not normalized_label:
        return "relationship label is missing"
    if normalized_label:
        label_words = re.findall(r"[^\W_]+", normalized_label.casefold(), flags=re.UNICODE)
        if normalized_label.endswith(("-", "—", "–", ":", ",", ";", "/")):
            return "relationship label is unfinished"
        if label_words and label_words[-1] in GRAPH_DANGLING_RELATION_WORDS:
            return "relationship label ends with a dangling preposition"
    if require_description and not normalized_description:
        return "relationship description is missing"
    if normalized_description:
        if re.search(r"[.!?…](?:[\"'»”)\]]*)$", normalized_description) is None:
            return "relationship description is not a complete sentence"
    return None


def _normalize_card_type(value: Any) -> str:
    normalized = _compact_text(value).casefold().replace("-", "_").replace(" ", "_")
    aliases = {
        "world": GRAPH_CARD_TYPE_WORLD_CARD,
        "world_profile": GRAPH_CARD_TYPE_WORLD_CARD,
        "world_detail": GRAPH_CARD_TYPE_WORLD_CARD,
        "detail": GRAPH_CARD_TYPE_WORLD_CARD,
        "character": GRAPH_CARD_TYPE_WORLD_CARD,
        "npc": GRAPH_CARD_TYPE_WORLD_CARD,
        "main_hero": GRAPH_CARD_TYPE_WORLD_CARD,
        "rule": GRAPH_CARD_TYPE_INSTRUCTION_CARD,
        "instruction": GRAPH_CARD_TYPE_INSTRUCTION_CARD,
        "instruction_card": GRAPH_CARD_TYPE_INSTRUCTION_CARD,
        "plot": GRAPH_CARD_TYPE_PLOT_CARD,
        "plot_card": GRAPH_CARD_TYPE_PLOT_CARD,
        "memory": GRAPH_CARD_TYPE_MEMORY_BLOCK,
        "memory_block": GRAPH_CARD_TYPE_MEMORY_BLOCK,
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in GRAPH_CARD_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported graph card type")
    return normalized


def _normalize_relation_type(value: Any) -> str:
    normalized = _compact_text(value).casefold().replace("-", "_").replace(" ", "_")
    return normalized if normalized in GRAPH_RELATION_TYPES else "custom"


def _normalize_direction(value: Any) -> str:
    normalized = _compact_text(value).casefold()
    return normalized if normalized in GRAPH_DIRECTIONS else "directed"


def _normalize_scope(value: Any) -> str:
    normalized = _compact_text(value).casefold().replace("-", "_").replace(" ", "_")
    return normalized if normalized in GRAPH_SCOPES else "both"


def _normalize_created_by(value: Any) -> str:
    normalized = _compact_text(value).casefold()
    return normalized if normalized in GRAPH_CREATED_BY_VALUES else "user"


def _normalize_color(value: Any) -> str:
    normalized = _compact_text(value, max_chars=16)
    if re.fullmatch(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?", normalized):
        return normalized
    return ""


def _default_node_color(card: StoryGraphCardSummaryOut | None) -> str:
    if card is None:
        return "#78909c"
    if card.card_type == GRAPH_CARD_TYPE_INSTRUCTION_CARD:
        return "#f6c85f"
    if card.card_type == GRAPH_CARD_TYPE_PLOT_CARD:
        return "#c084fc"
    if card.card_type == GRAPH_CARD_TYPE_MEMORY_BLOCK:
        return "#81c784"
    if card.kind == "main_hero":
        return "#4fc3f7"
    if card.kind == "npc":
        return "#ff8a65"
    if card.kind == "world_profile":
        return "#64b5f6"
    return "#4db6ac"


def require_story_graph_access(user: User) -> None:
    role = _compact_text(getattr(user, "role", "")).casefold()
    if role not in GRAPH_ACCESS_ROLES:
        logger.warning(
            "Story graph access denied: user_id=%s role=%s",
            getattr(user, "id", None),
            role or "unknown",
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Graph access is restricted")


def get_user_story_game_for_graph_or_404(db: Session, user: User, game_id: int) -> StoryGame:
    require_story_graph_access(user)
    return get_user_story_game_or_404(db, int(user.id), int(game_id))


def delete_story_graph_card_references(db: Session, *, game_id: int, card_type: str, card_id: int) -> int:
    normalized_type = _normalize_card_type(card_type)
    normalized_id = int(card_id)
    node_ids = [
        int(node_id)
        for node_id in db.scalars(
            select(StoryGraphNode.id).where(
                StoryGraphNode.game_id == int(game_id),
                StoryGraphNode.card_type == normalized_type,
                StoryGraphNode.card_id == normalized_id,
            )
        ).all()
    ]
    precise_edge_filter = or_(
        (StoryGraphEdge.source_card_type == normalized_type) & (StoryGraphEdge.source_card_id == normalized_id),
        (StoryGraphEdge.target_card_type == normalized_type) & (StoryGraphEdge.target_card_id == normalized_id),
    )
    if node_ids:
        precise_edge_filter = or_(
            precise_edge_filter,
            StoryGraphEdge.source_node_id.in_(node_ids),
            StoryGraphEdge.target_node_id.in_(node_ids),
        )
    deleted_edges = db.execute(
        sa_delete(StoryGraphEdge).where(
            StoryGraphEdge.game_id == int(game_id),
            precise_edge_filter,
        )
    ).rowcount or 0
    deleted_nodes = db.execute(
        sa_delete(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game_id),
            StoryGraphNode.card_type == normalized_type,
            StoryGraphNode.card_id == normalized_id,
        )
    ).rowcount or 0
    if deleted_edges or deleted_nodes:
        logger.info(
            "Story graph card references deleted: game_id=%s card_type=%s card_id=%s nodes=%s edges=%s",
            game_id,
            normalized_type,
            normalized_id,
            deleted_nodes,
            deleted_edges,
        )
    return int(deleted_nodes + deleted_edges)


def _world_card_to_summary(card: StoryWorldCard) -> StoryGraphCardSummaryOut:
    out = story_world_card_to_out(card)
    avatar_url = resolve_media_display_url(
        getattr(card, "avatar_url", None),
        kind="story-world-card-avatar",
        entity_id=int(card.id),
        version=getattr(card, "updated_at", None),
    )
    avatar_original_url = resolve_media_display_url(
        getattr(card, "avatar_original_url", None),
        kind="story-world-card-avatar-original",
        entity_id=int(card.id),
        version=getattr(card, "updated_at", None),
    )
    return StoryGraphCardSummaryOut(
        card_type=GRAPH_CARD_TYPE_WORLD_CARD,
        card_id=int(card.id),
        title=out.title,
        description=out.content,
        kind=out.kind,
        detail_type=out.detail_type,
        avatar_url=avatar_url or out.avatar_url,
        avatar_original_url=avatar_original_url or out.avatar_original_url,
        avatar_scale=out.avatar_scale,
        race=out.race,
        memory_turns=out.memory_turns,
        active=not bool(getattr(card, "is_locked", False)),
        source=out.source,
        updated_at=out.updated_at,
    )


def _instruction_card_to_summary(card: StoryInstructionCard) -> StoryGraphCardSummaryOut:
    return StoryGraphCardSummaryOut(
        card_type=GRAPH_CARD_TYPE_INSTRUCTION_CARD,
        card_id=int(card.id),
        title=_compact_text(card.title, max_chars=160),
        description=_compact_text(card.content, max_chars=2_000),
        kind="rule",
        active=bool(getattr(card, "is_active", True)),
        source="user",
        updated_at=getattr(card, "updated_at", None),
    )


def _plot_card_to_summary(card: StoryPlotCard) -> StoryGraphCardSummaryOut:
    out = story_plot_card_to_out(card)
    return StoryGraphCardSummaryOut(
        card_type=GRAPH_CARD_TYPE_PLOT_CARD,
        card_id=int(card.id),
        title=out.title,
        description=out.content,
        kind="plot",
        memory_turns=out.memory_turns,
        active=bool(out.is_enabled),
        source=out.source,
        updated_at=out.updated_at,
    )


def _memory_block_to_summary(block: StoryMemoryBlock) -> StoryGraphCardSummaryOut:
    out = story_memory_block_to_out(block)
    return StoryGraphCardSummaryOut(
        card_type=GRAPH_CARD_TYPE_MEMORY_BLOCK,
        card_id=int(block.id),
        title=out.title or f"Memory #{int(block.id)}",
        description=out.content,
        kind=out.layer,
        active=getattr(block, "undone_at", None) is None,
        source="ai",
        updated_at=out.updated_at,
    )


def _card_key(card_type: str, card_id: int) -> tuple[str, int]:
    return (_normalize_card_type(card_type), int(card_id))


def _list_card_summaries(db: Session, game_id: int) -> list[StoryGraphCardSummaryOut]:
    world_cards = db.scalars(
        select(StoryWorldCard).where(StoryWorldCard.game_id == int(game_id)).order_by(StoryWorldCard.id.asc())
    ).all()
    instruction_cards = db.scalars(
        select(StoryInstructionCard)
        .where(StoryInstructionCard.game_id == int(game_id))
        .order_by(StoryInstructionCard.id.asc())
    ).all()
    plot_cards = db.scalars(
        select(StoryPlotCard).where(StoryPlotCard.game_id == int(game_id)).order_by(StoryPlotCard.id.asc())
    ).all()
    memory_blocks = db.scalars(
        select(StoryMemoryBlock)
        .where(
            StoryMemoryBlock.game_id == int(game_id),
            StoryMemoryBlock.layer == "key",
            StoryMemoryBlock.undone_at.is_(None),
        )
        .order_by(StoryMemoryBlock.id.asc())
    ).all()
    return [
        *[_world_card_to_summary(card) for card in world_cards],
        *[_instruction_card_to_summary(card) for card in instruction_cards],
        *[_plot_card_to_summary(card) for card in plot_cards],
        *[_memory_block_to_summary(block) for block in memory_blocks],
    ]


def _list_card_summaries_for_keys(
    db: Session,
    game_id: int,
    card_keys: set[tuple[str, int]],
) -> list[StoryGraphCardSummaryOut]:
    if not card_keys:
        return []
    ids_by_type: dict[str, list[int]] = {
        card_type: sorted({card_id for key_type, card_id in card_keys if key_type == card_type and card_id > 0})
        for card_type in GRAPH_CARD_TYPES
    }
    summaries: list[StoryGraphCardSummaryOut] = []
    world_card_ids = ids_by_type[GRAPH_CARD_TYPE_WORLD_CARD]
    if world_card_ids:
        summaries.extend(
            _world_card_to_summary(card)
            for card in db.scalars(
                select(StoryWorldCard).where(
                    StoryWorldCard.game_id == int(game_id),
                    StoryWorldCard.id.in_(world_card_ids),
                )
            ).all()
        )
    instruction_card_ids = ids_by_type[GRAPH_CARD_TYPE_INSTRUCTION_CARD]
    if instruction_card_ids:
        summaries.extend(
            _instruction_card_to_summary(card)
            for card in db.scalars(
                select(StoryInstructionCard).where(
                    StoryInstructionCard.game_id == int(game_id),
                    StoryInstructionCard.id.in_(instruction_card_ids),
                )
            ).all()
        )
    plot_card_ids = ids_by_type[GRAPH_CARD_TYPE_PLOT_CARD]
    if plot_card_ids:
        summaries.extend(
            _plot_card_to_summary(card)
            for card in db.scalars(
                select(StoryPlotCard).where(
                    StoryPlotCard.game_id == int(game_id),
                    StoryPlotCard.id.in_(plot_card_ids),
                )
            ).all()
        )
    memory_block_ids = ids_by_type[GRAPH_CARD_TYPE_MEMORY_BLOCK]
    if memory_block_ids:
        summaries.extend(
            _memory_block_to_summary(block)
            for block in db.scalars(
                select(StoryMemoryBlock).where(
                    StoryMemoryBlock.game_id == int(game_id),
                    StoryMemoryBlock.id.in_(memory_block_ids),
                    StoryMemoryBlock.layer == "key",
                    StoryMemoryBlock.undone_at.is_(None),
                )
            ).all()
        )
    return summaries


def _card_summary_map(cards: list[StoryGraphCardSummaryOut]) -> dict[tuple[str, int], StoryGraphCardSummaryOut]:
    return {_card_key(card.card_type, card.card_id): card for card in cards}


def _get_card_summary_or_404(db: Session, game_id: int, card_type: str, card_id: int) -> StoryGraphCardSummaryOut:
    normalized_type = _normalize_card_type(card_type)
    normalized_id = int(card_id)
    if normalized_type == GRAPH_CARD_TYPE_WORLD_CARD:
        card = db.scalar(
            select(StoryWorldCard).where(StoryWorldCard.game_id == int(game_id), StoryWorldCard.id == normalized_id)
        )
        if card is not None:
            return _world_card_to_summary(card)
    elif normalized_type == GRAPH_CARD_TYPE_INSTRUCTION_CARD:
        card = db.scalar(
            select(StoryInstructionCard).where(
                StoryInstructionCard.game_id == int(game_id),
                StoryInstructionCard.id == normalized_id,
            )
        )
        if card is not None:
            return _instruction_card_to_summary(card)
    elif normalized_type == GRAPH_CARD_TYPE_PLOT_CARD:
        card = db.scalar(
            select(StoryPlotCard).where(StoryPlotCard.game_id == int(game_id), StoryPlotCard.id == normalized_id)
        )
        if card is not None:
            return _plot_card_to_summary(card)
    elif normalized_type == GRAPH_CARD_TYPE_MEMORY_BLOCK:
        block = db.scalar(
            select(StoryMemoryBlock).where(
                StoryMemoryBlock.game_id == int(game_id),
                StoryMemoryBlock.id == normalized_id,
                StoryMemoryBlock.layer == "key",
                StoryMemoryBlock.undone_at.is_(None),
            )
        )
        if block is not None:
            return _memory_block_to_summary(block)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph card source not found")


def _node_to_out(
    node: StoryGraphNode,
    *,
    card_by_key: dict[tuple[str, int], StoryGraphCardSummaryOut],
) -> StoryGraphNodeOut:
    return StoryGraphNodeOut(
        id=int(node.id),
        game_id=int(node.game_id),
        card_type=_normalize_card_type(node.card_type),
        card_id=int(node.card_id),
        x=float(node.x),
        y=float(node.y),
        width=float(node.width),
        height=float(node.height),
        collapsed=bool(node.collapsed),
        color=str(node.color or ""),
        created_by=str(node.created_by or "user"),
        card=card_by_key.get(_card_key(node.card_type, int(node.card_id))),
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def _edge_to_out(edge: StoryGraphEdge) -> StoryGraphEdgeOut:
    return StoryGraphEdgeOut(
        id=int(edge.id),
        game_id=int(edge.game_id),
        source_node_id=int(edge.source_node_id),
        target_node_id=int(edge.target_node_id),
        source_card_type=_normalize_card_type(edge.source_card_type),
        source_card_id=int(edge.source_card_id),
        target_card_type=_normalize_card_type(edge.target_card_type),
        target_card_id=int(edge.target_card_id),
        relation_type=_normalize_relation_type(edge.relation_type),
        label=str(edge.label or ""),
        description=str(edge.description or ""),
        direction=_normalize_direction(edge.direction),
        scope=_normalize_scope(edge.scope),
        importance=_normalize_importance(edge.importance),
        active=bool(edge.active),
        created_by=str(edge.created_by or "user"),
        confidence=_normalize_confidence(edge.confidence),
        source_turn_id=int(edge.source_turn_id) if edge.source_turn_id is not None else None,
        created_at=edge.created_at,
        updated_at=edge.updated_at,
    )


def _graph_edge_snapshot(edge: StoryGraphEdge) -> dict[str, Any]:
    return {
        "relation_type": _normalize_relation_type(edge.relation_type),
        "label": str(edge.label or ""),
        "description": str(edge.description or ""),
        "direction": _normalize_direction(edge.direction),
        "scope": _normalize_scope(edge.scope),
        "importance": _normalize_importance(edge.importance),
        "active": bool(edge.active),
    }


def _suggestion_to_out(suggestion: StoryGraphSuggestion) -> StoryGraphSuggestionOut:
    return StoryGraphSuggestionOut(
        id=int(suggestion.id),
        game_id=int(suggestion.game_id),
        kind=str(suggestion.kind or ""),
        status=str(suggestion.status or GRAPH_SUGGESTION_PENDING),
        payload=_json_loads_dict(suggestion.payload),
        reason=str(suggestion.reason or ""),
        confidence=_normalize_confidence(suggestion.confidence),
        source_turn_id=int(suggestion.source_turn_id) if suggestion.source_turn_id is not None else None,
        created_at=suggestion.created_at,
        updated_at=suggestion.updated_at,
    )


def get_story_graph(db: Session, game: StoryGame) -> StoryGraphOut:
    cards = _list_card_summaries(db, int(game.id))
    card_by_key = _card_summary_map(cards)
    stored_nodes = db.scalars(
        select(StoryGraphNode)
        .where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.undone_at.is_(None),
        )
        .order_by(StoryGraphNode.id.asc())
    ).all()
    nodes = [
        node
        for node in stored_nodes
        if _card_key(node.card_type, int(node.card_id)) in card_by_key
    ]
    visible_node_ids = {int(node.id) for node in nodes}
    edges = (
        db.scalars(
            select(StoryGraphEdge)
            .where(
                StoryGraphEdge.game_id == int(game.id),
                StoryGraphEdge.undone_at.is_(None),
            )
            .order_by(StoryGraphEdge.id.asc())
        ).all()
        if visible_node_ids
        else []
    )
    edges = [
        edge
        for edge in edges
        if int(edge.source_node_id) in visible_node_ids and int(edge.target_node_id) in visible_node_ids
    ]
    suggestions = db.scalars(
        select(StoryGraphSuggestion)
        .where(
            StoryGraphSuggestion.game_id == int(game.id),
            StoryGraphSuggestion.status == GRAPH_SUGGESTION_PENDING,
            StoryGraphSuggestion.undone_at.is_(None),
        )
        .order_by(StoryGraphSuggestion.id.desc())
        .limit(100)
    ).all()
    used_card_keys = {_card_key(node.card_type, int(node.card_id)) for node in nodes}
    available_cards = [
        card.model_copy(update={"description": _compact_text(card.description, max_chars=240)})
        for card in cards
        if _card_key(card.card_type, card.card_id) not in used_card_keys
    ]
    available_cards.sort(
        key=lambda card: (
            0 if card.kind == "main_hero" else 1,
            _compact_text(card.title).casefold(),
            int(card.card_id),
        )
    )
    return StoryGraphOut(
        game_id=int(game.id),
        nodes=[_node_to_out(node, card_by_key=card_by_key) for node in nodes],
        edges=[_edge_to_out(edge) for edge in edges],
        available_cards=available_cards,
        suggestions=[_suggestion_to_out(suggestion) for suggestion in suggestions],
        can_edit=True,
    )


def _next_node_position(db: Session, game_id: int) -> tuple[float, float]:
    count_value = int(
        db.scalar(
            select(func.count())
            .select_from(StoryGraphNode)
            .where(
                StoryGraphNode.game_id == int(game_id),
                StoryGraphNode.undone_at.is_(None),
            )
        )
        or 0
    )
    column = count_value % 4
    row = count_value // 4
    return (80.0 + column * 310.0, 80.0 + row * 190.0)


def ensure_graph_node_for_card(
    db: Session,
    game: StoryGame,
    *,
    card_type: str,
    card_id: int,
    created_by: str = "system",
    source_turn_id: int | None = None,
) -> StoryGraphNode:
    normalized_type = _normalize_card_type(card_type)
    normalized_id = int(card_id)
    existing = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.card_type == normalized_type,
            StoryGraphNode.card_id == normalized_id,
        )
    )
    if existing is not None:
        if existing.undone_at is not None:
            existing.undone_at = None
            existing.source_turn_id = int(source_turn_id) if source_turn_id else None
            existing.created_by = _normalize_created_by(created_by)
            db.flush()
        return existing
    card = _get_card_summary_or_404(db, int(game.id), normalized_type, normalized_id)
    x, y = _next_node_position(db, int(game.id))
    node = StoryGraphNode(
        game_id=int(game.id),
        card_type=normalized_type,
        card_id=normalized_id,
        x=x,
        y=y,
        width=GRAPH_NODE_DEFAULT_WIDTH,
        height=GRAPH_NODE_DEFAULT_HEIGHT,
        collapsed=False,
        color=_default_node_color(card),
        created_by=_normalize_created_by(created_by),
        source_turn_id=int(source_turn_id) if source_turn_id else None,
    )
    db.add(node)
    db.flush()
    return node


def create_story_graph_node(
    db: Session,
    game: StoryGame,
    payload: StoryGraphNodeCreateRequest,
    *,
    created_by: str = "user",
) -> StoryGraphNodeOut:
    card = _get_card_summary_or_404(db, int(game.id), payload.card_type, payload.card_id)
    existing = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.card_type == card.card_type,
            StoryGraphNode.card_id == int(card.card_id),
        )
    )
    if existing is not None:
        if existing.undone_at is not None:
            existing.undone_at = None
            existing.source_turn_id = None
            existing.created_by = _normalize_created_by(created_by)
        if payload.x is not None:
            existing.x = _safe_float(payload.x, existing.x)
        if payload.y is not None:
            existing.y = _safe_float(payload.y, existing.y)
        if payload.width is not None:
            existing.width = _safe_float(payload.width, existing.width)
        if payload.height is not None:
            existing.height = _safe_float(payload.height, existing.height)
        existing.collapsed = bool(payload.collapsed)
        if payload.color is not None:
            existing.color = _normalize_color(payload.color) or _default_node_color(card)
        db.flush()
        return _node_to_out(existing, card_by_key={_card_key(card.card_type, card.card_id): card})

    default_x, default_y = _next_node_position(db, int(game.id))
    node = StoryGraphNode(
        game_id=int(game.id),
        card_type=card.card_type,
        card_id=int(card.card_id),
        x=_safe_float(payload.x, default_x) if payload.x is not None else default_x,
        y=_safe_float(payload.y, default_y) if payload.y is not None else default_y,
        width=_safe_float(payload.width, GRAPH_NODE_DEFAULT_WIDTH) if payload.width is not None else GRAPH_NODE_DEFAULT_WIDTH,
        height=_safe_float(payload.height, GRAPH_NODE_DEFAULT_HEIGHT) if payload.height is not None else GRAPH_NODE_DEFAULT_HEIGHT,
        collapsed=bool(payload.collapsed),
        color=_normalize_color(payload.color) or _default_node_color(card),
        created_by=_normalize_created_by(created_by),
    )
    db.add(node)
    db.flush()
    return _node_to_out(node, card_by_key={_card_key(card.card_type, card.card_id): card})


def update_story_graph_node_layout(
    db: Session,
    game: StoryGame,
    node_id: int,
    payload: StoryGraphNodeLayoutUpdateRequest,
) -> StoryGraphNodeOut:
    node = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.id == int(node_id),
            StoryGraphNode.undone_at.is_(None),
        )
    )
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph node not found")
    if payload.x is not None:
        node.x = _safe_float(payload.x, node.x)
    if payload.y is not None:
        node.y = _safe_float(payload.y, node.y)
    if payload.width is not None:
        node.width = _safe_float(payload.width, node.width)
    if payload.height is not None:
        node.height = _safe_float(payload.height, node.height)
    if payload.collapsed is not None:
        node.collapsed = bool(payload.collapsed)
    if payload.color is not None:
        node.color = _normalize_color(payload.color)
    db.flush()
    card = _get_card_summary_or_404(db, int(game.id), node.card_type, int(node.card_id))
    return _node_to_out(node, card_by_key={_card_key(card.card_type, card.card_id): card})


def delete_story_graph_node(db: Session, game: StoryGame, node_id: int, *, delete_edges: bool) -> int:
    node = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.id == int(node_id),
            StoryGraphNode.undone_at.is_(None),
        )
    )
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph node not found")
    connected_edges_count = int(
        db.scalar(
            select(func.count()).select_from(StoryGraphEdge).where(
                StoryGraphEdge.game_id == int(game.id),
                StoryGraphEdge.undone_at.is_(None),
                or_(StoryGraphEdge.source_node_id == int(node.id), StoryGraphEdge.target_node_id == int(node.id)),
            )
        )
        or 0
    )
    if connected_edges_count > 0 and not delete_edges:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Graph node has connected edges", "connected_edges": connected_edges_count},
        )
    if connected_edges_count > 0:
        db.execute(
            sa_delete(StoryGraphEdge).where(
                StoryGraphEdge.game_id == int(game.id),
                or_(StoryGraphEdge.source_node_id == int(node.id), StoryGraphEdge.target_node_id == int(node.id)),
            )
        )
    db.delete(node)
    db.flush()
    return connected_edges_count


def _find_duplicate_edge(
    db: Session,
    game: StoryGame,
    *,
    source_card_type: str,
    source_card_id: int,
    target_card_type: str,
    target_card_id: int,
    relation_type: str,
    label: str,
    exclude_edge_id: int | None = None,
) -> StoryGraphEdge | None:
    query = select(StoryGraphEdge).where(
        StoryGraphEdge.game_id == int(game.id),
        StoryGraphEdge.source_card_type == _normalize_card_type(source_card_type),
        StoryGraphEdge.source_card_id == int(source_card_id),
        StoryGraphEdge.target_card_type == _normalize_card_type(target_card_type),
        StoryGraphEdge.target_card_id == int(target_card_id),
        StoryGraphEdge.relation_type == _normalize_relation_type(relation_type),
        StoryGraphEdge.undone_at.is_(None),
    )
    if exclude_edge_id is not None:
        query = query.where(StoryGraphEdge.id != int(exclude_edge_id))
    label_key = _normalize_label_key(label)
    for edge in db.scalars(query).all():
        existing_label_key = _normalize_label_key(edge.label)
        if not label_key or not existing_label_key or label_key == existing_label_key:
            return edge
    return None


def create_story_graph_edge(
    db: Session,
    game: StoryGame,
    payload: StoryGraphEdgeCreateRequest,
    *,
    created_by: str = "user",
    confidence: float | None = None,
    source_turn_id: int | None = None,
) -> StoryGraphEdgeOut:
    if int(payload.source_node_id) == int(payload.target_node_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot connect a node to itself")
    source_node = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.id == int(payload.source_node_id),
            StoryGraphNode.undone_at.is_(None),
        )
    )
    target_node = db.scalar(
        select(StoryGraphNode).where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.id == int(payload.target_node_id),
            StoryGraphNode.undone_at.is_(None),
        )
    )
    if source_node is None or target_node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph node not found")
    relation_type = _normalize_relation_type(payload.relation_type)
    label = _compact_text(payload.label, max_chars=160)
    duplicate = _find_duplicate_edge(
        db,
        game,
        source_card_type=source_node.card_type,
        source_card_id=int(source_node.card_id),
        target_card_type=target_node.card_type,
        target_card_id=int(target_node.card_id),
        relation_type=relation_type,
        label=label,
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Similar graph edge already exists")
    edge = StoryGraphEdge(
        game_id=int(game.id),
        source_node_id=int(source_node.id),
        target_node_id=int(target_node.id),
        source_card_type=_normalize_card_type(source_node.card_type),
        source_card_id=int(source_node.card_id),
        target_card_type=_normalize_card_type(target_node.card_type),
        target_card_id=int(target_node.card_id),
        relation_type=relation_type,
        label=label,
        description=_compact_text(payload.description, max_chars=4_000),
        direction=_normalize_direction(payload.direction),
        scope=_normalize_scope(payload.scope),
        importance=_normalize_importance(payload.importance),
        active=bool(payload.active),
        created_by=_normalize_created_by(created_by),
        confidence=_normalize_confidence(confidence),
        source_turn_id=int(source_turn_id) if source_turn_id else None,
        undone_at=None,
    )
    db.add(edge)
    db.flush()
    return _edge_to_out(edge)


def update_story_graph_edge(
    db: Session,
    game: StoryGame,
    edge_id: int,
    payload: StoryGraphEdgeUpdateRequest,
    *,
    source_turn_id: int | None = None,
) -> StoryGraphEdgeOut:
    edge = db.scalar(
        select(StoryGraphEdge).where(
            StoryGraphEdge.game_id == int(game.id),
            StoryGraphEdge.id == int(edge_id),
            StoryGraphEdge.undone_at.is_(None),
        )
    )
    if edge is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph edge not found")
    next_relation_type = _normalize_relation_type(payload.relation_type) if payload.relation_type is not None else edge.relation_type
    next_label = _compact_text(payload.label, max_chars=160) if payload.label is not None else edge.label
    duplicate = _find_duplicate_edge(
        db,
        game,
        source_card_type=edge.source_card_type,
        source_card_id=int(edge.source_card_id),
        target_card_type=edge.target_card_type,
        target_card_id=int(edge.target_card_id),
        relation_type=next_relation_type,
        label=next_label,
        exclude_edge_id=int(edge.id),
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Similar graph edge already exists")
    before_snapshot = _graph_edge_snapshot(edge) if source_turn_id else None
    edge.relation_type = next_relation_type
    edge.label = next_label
    if payload.description is not None:
        edge.description = _compact_text(payload.description, max_chars=4_000)
    if payload.direction is not None:
        edge.direction = _normalize_direction(payload.direction)
    if payload.scope is not None:
        edge.scope = _normalize_scope(payload.scope)
    if payload.importance is not None:
        edge.importance = _normalize_importance(payload.importance)
    if payload.active is not None:
        edge.active = bool(payload.active)
    db.flush()
    if source_turn_id and before_snapshot != _graph_edge_snapshot(edge):
        _record_graph_event(
            db,
            game,
            event_type="edge_updated",
            message="Gemini updated an existing graph relationship",
            payload={
                "edge_id": int(edge.id),
                "before": before_snapshot,
                "after": _graph_edge_snapshot(edge),
            },
            assistant_message_id=source_turn_id,
        )
    return _edge_to_out(edge)


def delete_story_graph_edge(db: Session, game: StoryGame, edge_id: int) -> None:
    edge = db.scalar(
        select(StoryGraphEdge).where(
            StoryGraphEdge.game_id == int(game.id),
            StoryGraphEdge.id == int(edge_id),
            StoryGraphEdge.undone_at.is_(None),
        )
    )
    if edge is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph edge not found")
    db.delete(edge)
    db.flush()


def auto_layout_story_graph(db: Session, game: StoryGame) -> StoryGraphOut:
    cards = _list_card_summaries(db, int(game.id))
    card_by_key = _card_summary_map(cards)
    nodes = db.scalars(
        select(StoryGraphNode)
        .where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.undone_at.is_(None),
        )
        .order_by(StoryGraphNode.id.asc())
    ).all()
    nodes = [
        node
        for node in nodes
        if _card_key(node.card_type, int(node.card_id)) in card_by_key
    ]
    if not nodes:
        return get_story_graph(db, game)

    node_by_id = {int(node.id): node for node in nodes}
    adjacency: dict[int, set[int]] = {node_id: set() for node_id in node_by_id}
    edges = db.scalars(
        select(StoryGraphEdge)
        .where(
            StoryGraphEdge.game_id == int(game.id),
            StoryGraphEdge.undone_at.is_(None),
        )
        .order_by(StoryGraphEdge.importance.desc(), StoryGraphEdge.id.asc())
    ).all()
    for edge in edges:
        source_id = int(edge.source_node_id)
        target_id = int(edge.target_node_id)
        if source_id not in adjacency or target_id not in adjacency or source_id == target_id:
            continue
        adjacency[source_id].add(target_id)
        adjacency[target_id].add(source_id)

    card_type_rank = {
        GRAPH_CARD_TYPE_WORLD_CARD: 0,
        GRAPH_CARD_TYPE_INSTRUCTION_CARD: 1,
        GRAPH_CARD_TYPE_PLOT_CARD: 2,
        GRAPH_CARD_TYPE_MEMORY_BLOCK: 3,
    }

    def node_priority(node_id: int) -> tuple[int, int, int, int]:
        node = node_by_id[node_id]
        card = card_by_key.get(_card_key(node.card_type, int(node.card_id)))
        is_main_hero = bool(card and card.kind == "main_hero")
        return (
            0 if is_main_hero else 1,
            -len(adjacency[node_id]),
            card_type_rank.get(node.card_type, 9),
            node_id,
        )

    components: list[list[int]] = []
    unvisited = set(node_by_id)
    while unvisited:
        start_id = min(unvisited, key=node_priority)
        queue = [start_id]
        unvisited.remove(start_id)
        component: list[int] = []
        queue_index = 0
        while queue_index < len(queue):
            node_id = queue[queue_index]
            queue_index += 1
            component.append(node_id)
            for neighbor_id in sorted(adjacency[node_id], key=node_priority):
                if neighbor_id not in unvisited:
                    continue
                unvisited.remove(neighbor_id)
                queue.append(neighbor_id)
        components.append(component)

    components.sort(
        key=lambda component: (
            min(node_priority(node_id)[0] for node_id in component),
            -len(component),
            min(component),
        )
    )

    horizontal_gap = 150.0
    vertical_gap = 70.0
    component_gap = 220.0
    workspace_margin = 180.0
    shelf_width = 9_600.0
    max_rows_per_column = 10
    component_layouts: list[tuple[float, float, dict[int, tuple[float, float]]]] = []

    for component in components:
        root_id = min(component, key=node_priority)
        depth_by_id = {root_id: 0}
        queue = [root_id]
        queue_index = 0
        while queue_index < len(queue):
            node_id = queue[queue_index]
            queue_index += 1
            for neighbor_id in sorted(adjacency[node_id], key=node_priority):
                if neighbor_id not in component or neighbor_id in depth_by_id:
                    continue
                depth_by_id[neighbor_id] = depth_by_id[node_id] + 1
                queue.append(neighbor_id)

        levels: dict[int, list[int]] = {}
        for node_id in component:
            levels.setdefault(depth_by_id.get(node_id, 0), []).append(node_id)

        previous_order: dict[int, int] = {}
        ordered_levels: list[list[int]] = []
        for depth in sorted(levels):
            level_node_ids = levels[depth]
            if depth == 0:
                level_node_ids.sort(key=node_priority)
            else:
                level_node_ids.sort(
                    key=lambda node_id: (
                        min(
                            (previous_order[neighbor_id] for neighbor_id in adjacency[node_id] if neighbor_id in previous_order),
                            default=10_000,
                        ),
                        node_priority(node_id),
                    )
                )
            ordered_levels.append(level_node_ids)
            previous_order = {node_id: index for index, node_id in enumerate(level_node_ids)}

        column_specs: list[tuple[float, list[int], float]] = []
        for level_node_ids in ordered_levels:
            for start_index in range(0, len(level_node_ids), max_rows_per_column):
                chunk = level_node_ids[start_index : start_index + max_rows_per_column]
                column_width = max(
                    max(float(node_by_id[node_id].width or GRAPH_NODE_DEFAULT_WIDTH), GRAPH_NODE_DEFAULT_WIDTH)
                    for node_id in chunk
                )
                column_height = sum(
                    max(float(node_by_id[node_id].height or GRAPH_NODE_DEFAULT_HEIGHT), GRAPH_NODE_DEFAULT_HEIGHT)
                    for node_id in chunk
                ) + vertical_gap * max(len(chunk) - 1, 0)
                column_specs.append((column_width, chunk, column_height))

        component_height = max((column_height for _, _, column_height in column_specs), default=GRAPH_NODE_DEFAULT_HEIGHT)
        local_positions: dict[int, tuple[float, float]] = {}
        local_x = 0.0
        for column_width, chunk, column_height in column_specs:
            local_y = (component_height - column_height) / 2
            for node_id in chunk:
                node = node_by_id[node_id]
                node_height = max(float(node.height or GRAPH_NODE_DEFAULT_HEIGHT), GRAPH_NODE_DEFAULT_HEIGHT)
                local_positions[node_id] = (local_x, local_y)
                local_y += node_height + vertical_gap
            local_x += column_width + horizontal_gap
        component_width = max(local_x - horizontal_gap, GRAPH_NODE_DEFAULT_WIDTH)
        component_layouts.append((component_width, component_height, local_positions))

    shelf_x = workspace_margin
    shelf_y = workspace_margin
    shelf_row_height = 0.0
    for component_width, component_height, local_positions in component_layouts:
        if shelf_x > workspace_margin and shelf_x + component_width > shelf_width:
            shelf_x = workspace_margin
            shelf_y += shelf_row_height + component_gap
            shelf_row_height = 0.0
        for node_id, (local_x, local_y) in local_positions.items():
            node_by_id[node_id].x = shelf_x + local_x
            node_by_id[node_id].y = shelf_y + local_y
        shelf_x += component_width + component_gap
        shelf_row_height = max(shelf_row_height, component_height)

    db.flush()
    return get_story_graph(db, game)


def _record_graph_event(
    db: Session,
    game: StoryGame,
    *,
    event_type: str,
    message: str,
    payload: Any | None = None,
    assistant_message_id: int | None = None,
) -> None:
    db.add(
        StoryGraphEvent(
            game_id=int(game.id),
            assistant_message_id=int(assistant_message_id) if assistant_message_id else None,
            event_type=_compact_text(event_type, max_chars=32) or "event",
            message=_compact_text(message, max_chars=1_000),
            payload=_json_dumps(payload or {}),
        )
    )
    logger.info("Story graph event: game_id=%s type=%s message=%s", game.id, event_type, message)


def _suggestion_exists(db: Session, game: StoryGame, *, kind: str, payload: dict[str, Any]) -> bool:
    rendered_payload = _json_dumps(payload)
    existing_id = db.scalar(
        select(StoryGraphSuggestion.id).where(
            StoryGraphSuggestion.game_id == int(game.id),
            StoryGraphSuggestion.kind == kind,
            StoryGraphSuggestion.status == GRAPH_SUGGESTION_PENDING,
            StoryGraphSuggestion.payload == rendered_payload,
            StoryGraphSuggestion.undone_at.is_(None),
        )
    )
    return existing_id is not None


def _create_suggestion(
    db: Session,
    game: StoryGame,
    *,
    kind: str,
    payload: dict[str, Any],
    reason: str = "",
    confidence: float | None = None,
    source_turn_id: int | None = None,
) -> bool:
    if _suggestion_exists(db, game, kind=kind, payload=payload):
        return False
    db.add(
        StoryGraphSuggestion(
            game_id=int(game.id),
            kind=_compact_text(kind, max_chars=32),
            status=GRAPH_SUGGESTION_PENDING,
            payload=_json_dumps(payload),
            reason=_compact_text(reason, max_chars=1_000),
            confidence=_normalize_confidence(confidence),
            source_turn_id=int(source_turn_id) if source_turn_id else None,
        )
    )
    return True


def _find_similar_card(
    cards_by_key: dict[tuple[str, int], StoryGraphCardSummaryOut],
    *,
    card_type: str,
    title: str,
) -> StoryGraphCardSummaryOut | None:
    title_key = _normalize_key(title)
    if not title_key:
        return None
    for card in cards_by_key.values():
        if card.card_type != card_type:
            continue
        existing_key = _normalize_key(card.title)
        if existing_key and (existing_key == title_key or existing_key in title_key or title_key in existing_key):
            return card
    return None


def _graph_card_ref_string(card_type: str, card_id: int) -> str:
    return f"{_normalize_card_type(card_type)}:{int(card_id)}"


def _build_cards_ref_index(cards: list[StoryGraphCardSummaryOut]) -> dict[str, tuple[str, int]]:
    index: dict[str, tuple[str, int]] = {}
    for card in cards:
        key = _card_key(card.card_type, int(card.card_id))
        index[_graph_card_ref_string(card.card_type, card.card_id)] = key
        index[str(card.card_id)] = key
        title_key = _normalize_key(card.title)
        if title_key:
            index[f"{card.card_type}:{title_key}"] = key
            index[title_key] = key
    return index


def _resolve_card_ref(
    value: Any,
    *,
    temp_refs: dict[str, tuple[str, int]],
    ref_index: dict[str, tuple[str, int]],
) -> tuple[str, int] | None:
    if isinstance(value, dict):
        raw_type = value.get("card_type") or value.get("cardType") or value.get("type")
        raw_id = value.get("card_id") or value.get("cardId") or value.get("id")
        card_id = _safe_int(raw_id)
        if card_id > 0:
            try:
                return _card_key(_normalize_card_type(raw_type), card_id)
            except HTTPException:
                return None
    if isinstance(value, int):
        return ref_index.get(str(value))
    normalized = _compact_text(value)
    if not normalized:
        return None
    if normalized in temp_refs:
        return temp_refs[normalized]
    normalized_lower = normalized.casefold()
    if normalized_lower in temp_refs:
        return temp_refs[normalized_lower]
    if normalized_lower in ref_index:
        return ref_index[normalized_lower]
    if ":" in normalized_lower:
        prefix, suffix = normalized_lower.split(":", maxsplit=1)
        card_id = _safe_int(suffix)
        if card_id > 0:
            try:
                return _card_key(_normalize_card_type(prefix), card_id)
            except HTTPException:
                return None
    key = _normalize_key(normalized)
    return ref_index.get(key)


def _create_card_from_ai(
    db: Session,
    game: StoryGame,
    raw_card: dict[str, Any],
    *,
    temp_refs: dict[str, tuple[str, int]],
    cards_by_key: dict[tuple[str, int], StoryGraphCardSummaryOut],
) -> tuple[tuple[str, int] | None, str | None]:
    raw_type = _compact_text(raw_card.get("type") or raw_card.get("cardType") or raw_card.get("card_type"))
    normalized_input_type = raw_type.casefold().replace("-", "_").replace(" ", "_")
    title = _compact_text(raw_card.get("name") or raw_card.get("title"), max_chars=120)
    description = _compact_text(raw_card.get("description") or raw_card.get("content"), max_chars=8_000)
    if not title:
        return None, "missing title"
    character_types = {"character", "npc", "main_hero", "person", "protagonist"}
    world_detail_types = {
        "world",
        "world_detail",
        "world_profile",
        "organization",
        "organisation",
        "guild",
        "faction",
        "location",
        "place",
        "settlement",
        "city",
        "country",
        "region",
        "item",
        "object",
        "artifact",
        "lore",
        "concept",
        "event",
    }
    if normalized_input_type in {*character_types, *world_detail_types}:
        card_type = GRAPH_CARD_TYPE_WORLD_CARD
    elif normalized_input_type in {"rule", "instruction", "instruction_card"}:
        card_type = GRAPH_CARD_TYPE_INSTRUCTION_CARD
    elif normalized_input_type in {"plot", "plot_card"}:
        card_type = GRAPH_CARD_TYPE_PLOT_CARD
    elif normalized_input_type in {"memory", "memory_block"}:
        card_type = GRAPH_CARD_TYPE_MEMORY_BLOCK
    else:
        return None, "unsupported card type"
    existing = _find_similar_card(cards_by_key, card_type=card_type, title=title)
    if existing is not None:
        key = _card_key(existing.card_type, existing.card_id)
        _index_temp_card_ref(raw_card, title=title, key=key, temp_refs=temp_refs)
        return key, "similar card already exists"

    if card_type == GRAPH_CARD_TYPE_WORLD_CARD:
        extra = raw_card.get("extra") if isinstance(raw_card.get("extra"), dict) else {}
        kind = "npc" if normalized_input_type in character_types else "world"
        if normalized_input_type == "world_profile":
            kind = "world_profile"
        detail_type = _compact_text(
            extra.get("detail_type")
            or extra.get("detailType")
            or raw_card.get("detailType")
            or raw_card.get("detail_type"),
            max_chars=120,
        )
        if not detail_type and normalized_input_type in world_detail_types - {"world", "world_detail", "world_profile"}:
            detail_type = normalized_input_type.replace("_", " ")
        card = StoryWorldCard(
            game_id=int(game.id),
            title=title,
            content=description or title,
            race=_compact_text(extra.get("race") or raw_card.get("race"), max_chars=120),
            clothing=_compact_text(extra.get("clothing") or raw_card.get("clothing"), max_chars=2_000),
            inventory=_compact_text(extra.get("inventory") or raw_card.get("inventory"), max_chars=2_000),
            health_status=_compact_text(extra.get("health_status") or raw_card.get("health_status"), max_chars=2_000),
            triggers=json.dumps([title], ensure_ascii=False),
            kind=kind,
            detail_type=detail_type,
            source="ai",
        )
        db.add(card)
        db.flush()
        summary = _world_card_to_summary(card)
    elif card_type == GRAPH_CARD_TYPE_INSTRUCTION_CARD:
        card = StoryInstructionCard(game_id=int(game.id), title=title, content=description or title, is_active=True)
        db.add(card)
        db.flush()
        summary = _instruction_card_to_summary(card)
    elif card_type == GRAPH_CARD_TYPE_PLOT_CARD:
        card = StoryPlotCard(
            game_id=int(game.id),
            title=title,
            content=description or title,
            triggers=json.dumps([title], ensure_ascii=False),
            memory_turns=2,
            ai_edit_enabled=True,
            is_enabled=True,
            source="ai",
        )
        db.add(card)
        db.flush()
        summary = _plot_card_to_summary(card)
    else:
        block = StoryMemoryBlock(
            game_id=int(game.id),
            assistant_message_id=None,
            layer="key",
            title=title,
            content=description or title,
            token_count=0,
        )
        db.add(block)
        db.flush()
        summary = _memory_block_to_summary(block)

    key = _card_key(summary.card_type, summary.card_id)
    cards_by_key[key] = summary
    _index_temp_card_ref(raw_card, title=title, key=key, temp_refs=temp_refs)
    return key, None


def _select_graph_analysis_cards(
    cards: list[StoryGraphCardSummaryOut],
    *,
    nodes: list[StoryGraphNode],
    edges: list[StoryGraphEdge],
    latest_user_prompt: str,
    latest_assistant_text: str,
    limit: int = GRAPH_ANALYSIS_MAX_CARDS,
) -> list[StoryGraphCardSummaryOut]:
    if len(cards) <= limit:
        return list(cards)
    recent_text = f"{latest_user_prompt}\n{latest_assistant_text}".casefold()
    graph_keys = {
        *(_card_key(node.card_type, int(node.card_id)) for node in nodes),
        *(_card_key(edge.source_card_type, int(edge.source_card_id)) for edge in edges),
        *(_card_key(edge.target_card_type, int(edge.target_card_id)) for edge in edges),
    }

    def updated_rank(card: StoryGraphCardSummaryOut) -> float:
        updated_at = card.updated_at
        if updated_at is None:
            return 0.0
        try:
            return float(updated_at.timestamp())
        except (AttributeError, OSError, OverflowError, ValueError):
            return 0.0

    def is_mentioned(card: StoryGraphCardSummaryOut) -> bool:
        normalized_title = _compact_text(card.title).casefold()
        return bool(normalized_title) and normalized_title in recent_text

    ranked = sorted(
        cards,
        key=lambda card: (
            1 if is_mentioned(card) else 0,
            1 if _card_key(card.card_type, card.card_id) in graph_keys else 0,
            updated_rank(card),
            int(card.card_id),
        ),
        reverse=True,
    )
    return ranked[: max(1, int(limit))]


def _index_temp_card_ref(
    raw_card: dict[str, Any],
    *,
    title: str,
    key: tuple[str, int],
    temp_refs: dict[str, tuple[str, int]],
) -> None:
    for candidate in (
        raw_card.get("key"),
        raw_card.get("id"),
        raw_card.get("tempKey"),
        raw_card.get("temp_key"),
        raw_card.get("cardRef"),
        title,
    ):
        normalized = _compact_text(candidate)
        if normalized:
            temp_refs[normalized] = key
            temp_refs[normalized.casefold()] = key
            temp_refs[_normalize_key(normalized)] = key


def _build_graph_analysis_messages(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    cards: list[StoryGraphCardSummaryOut],
    nodes: list[StoryGraphNode],
    edges: list[StoryGraphEdge],
) -> list[dict[str, str]]:
    selected_cards = _select_graph_analysis_cards(
        cards,
        nodes=nodes,
        edges=edges,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    cards_payload = [
        {
            "ref": _graph_card_ref_string(card.card_type, card.card_id),
            "type": card.card_type,
            "title": card.title,
            "kind": card.kind,
            "description": _compact_text(card.description, max_chars=700),
            "active": card.active,
        }
        for card in selected_cards
    ]
    nodes_payload = [
        {
            "id": int(node.id),
            "cardRef": _graph_card_ref_string(node.card_type, int(node.card_id)),
        }
        for node in nodes[:GRAPH_ANALYSIS_MAX_NODES]
    ]
    edges_payload = [
        {
            "id": int(edge.id),
            "sourceCardRef": _graph_card_ref_string(edge.source_card_type, int(edge.source_card_id)),
            "targetCardRef": _graph_card_ref_string(edge.target_card_type, int(edge.target_card_id)),
            "relationType": edge.relation_type,
            "label": edge.label,
            "description": _compact_text(edge.description, max_chars=600),
            "direction": edge.direction,
            "scope": edge.scope,
            "importance": int(edge.importance or 3),
            "active": bool(edge.active),
        }
        for edge in edges[:GRAPH_ANALYSIS_MAX_EDGES]
    ]
    expected_shape = {
        "createCards": [
            {
                "key": "temp-entity-1",
                "type": "character | organization | location | item | world_detail | plot | memory | rule",
                "name": "...",
                "description": "...",
                "extra": {},
                "evidence": "exact short quote from the current turn",
                "reason": "...",
                "confidence": 0.0,
            }
        ],
        "addNodes": [
            {
                "cardRef": "world_card:1 or temp-entity-1",
                "evidence": "exact short quote from the current turn",
                "reason": "...",
                "confidence": 0.0,
            }
        ],
        "createEdges": [
            {
                "sourceCardRef": "world_card:1 or temp-entity-1",
                "targetCardRef": "world_card:2 or temp-entity-2",
                "relationType": "acquaintance",
                "label": "...",
                "description": "...",
                "direction": "directed | undirected",
                "scope": "both",
                "importance": 3,
                "evidence": "exact short quote proving this relationship",
                "reason": "...",
                "confidence": 0.0,
            }
        ],
        "updateEdges": [
            {
                "edgeId": 1,
                "label": "...",
                "description": "...",
                "importance": 3,
                "evidence": "exact short quote proving the update",
                "reason": "...",
                "confidence": 0.0,
            }
        ],
        "doNothingReason": "",
    }
    user_payload = {
        "game": {"id": int(game.id), "title": _compact_text(getattr(game, "title", ""), max_chars=160)},
        "latestUserPrompt": _compact_text(latest_user_prompt, max_chars=8_000),
        "latestAssistantText": _compact_text(latest_assistant_text, max_chars=GRAPH_ANALYSIS_MAX_TURN_CHARS),
        "existingCards": cards_payload,
        "existingNodes": nodes_payload,
        "existingEdges": edges_payload,
        "allowedRelationTypes": sorted(GRAPH_RELATION_TYPES),
        "allowedScopes": sorted(GRAPH_SCOPES),
        "expectedJsonShape": expected_shape,
    }
    return [
        {
            "role": "system",
            "content": (
                "You analyze a text RPG turn for a card relationship graph. Return strict JSON only. "
                "All user-visible card names, relationship labels, and relationship descriptions in your JSON are final copy: "
                "the application will display them as written and will not rewrite or complete them. "
                "Use Gemini-level semantic judgment, but never invent relationships that are not stated or clearly earned by the current scene. "
                "Create missing cards for any important named entity required by a new relationship, including characters, "
                "organizations, factions, guilds, locations, items, world details, rules, plots, and memories. "
                "Extract every durable fact and relationship explicitly revealed in the turn, even when it is background information "
                "rather than a newly performed action: memberships, ranks, jobs, alliances, rivalries, ownership, residence, location, "
                "knowledge, obligations, history, discoveries, and named items all belong in the graph. "
                "A graph edge must express a durable semantic relationship between its source and target, not merely repeat a one-time action "
                "from the scene. A gift, warning, conversation, rescue, order, or piece of advice is not by itself a relationship. "
                "Create an edge only when that event reveals or changes a lasting state such as acquaintance, friendship, trust, mentorship, "
                "loyalty, rivalry, debt, membership, ownership, knowledge, protection, residence, or another persistent connection. "
                "Put the durable relationship in label; put the scene event that revealed or changed it in description as supporting context. "
                "For example, prefer relationship predicates such as 'longtime allies', 'trusts their judgment', or 'serves as mentor' "
                "over event summaries such as 'received advice from', 'gave an item to', or 'spoke with'. "
                "Write label as a concise, complete relational predicate that reads naturally between source and target, normally 2-8 words. "
                "Never leave a dangling preposition, unfinished clause, placeholder, or sentence fragment. "
                "Write description as one or two complete, specific sentences explaining the durable relationship and why the current turn matters. "
                "Use the language of the current turn for every user-visible field. Check grammar, names, direction, and who relates to whom. "
                "Use undirected for genuinely mutual relationships such as acquaintance, friendship, alliance, rivalry, or kinship; "
                "use directed only when the relationship is asymmetric. "
                "A single turn may produce many cards and many edges; return all supported changes without an arbitrary count limit. "
                "For a relationship directly stated by the player or narrator, use confidence 0.95 or higher. "
                "Every action must include evidence copied verbatim as a short exact quote from latestUserPrompt or latestAssistantText. "
                "Keep entity names in the same spelling and language used by the current turn. "
                "Every newly created entity that belongs on the graph must be referenced by addNodes and/or createEdges. "
                "If a similar card or edge already exists, reference it or return updateEdges instead of duplicate createEdges. "
                "If the turn contains only transient interactions and no durable relationship or graph fact, return no edge action and explain why "
                "in doNothingReason. "
                "Do not use markdown. Confidence must be 0..1."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(user_payload, ensure_ascii=False, indent=2),
        },
    ]


def _normalize_evidence_text(value: Any) -> str:
    return _compact_text(value).strip(" \t\r\n\"'«»“”„").casefold()


def _validate_graph_analysis_evidence(
    payload: dict[str, Any],
    *,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> list[str]:
    source_text = _normalize_evidence_text(f"{latest_user_prompt}\n{latest_assistant_text}")
    source_key = _normalize_key(source_text)
    errors: list[str] = []
    action_groups = ("createCards", "addNodes", "createEdges", "updateEdges")
    for group_name in action_groups:
        actions = payload.get(group_name)
        if not isinstance(actions, list):
            continue
        for index, action in enumerate(actions):
            if not isinstance(action, dict):
                errors.append(f"{group_name}[{index}] is not an object")
                continue
            evidence = _normalize_evidence_text(action.get("evidence"))
            if not evidence or evidence not in source_text:
                errors.append(f"{group_name}[{index}] evidence is not an exact quote from the current turn")
            if group_name != "createCards":
                continue
            raw_type = _compact_text(action.get("type")).casefold().replace("-", "_").replace(" ", "_")
            if raw_type not in {
                "character",
                "npc",
                "main_hero",
                "person",
                "protagonist",
                "organization",
                "organisation",
                "guild",
                "faction",
                "location",
                "place",
                "settlement",
                "city",
                "country",
                "region",
                "item",
                "object",
                "artifact",
                "world",
                "world_detail",
                "world_profile",
            }:
                continue
            name_tokens = re.findall(r"[0-9a-zа-яё]+", _compact_text(action.get("name")).casefold())
            name_anchors = {
                token[: min(len(token), 6)]
                for token in name_tokens
                if len(token) >= 4
            }
            if not name_anchors or not any(anchor in source_key for anchor in name_anchors):
                errors.append(f"{group_name}[{index}] entity name is not anchored in the current turn")
    return errors


def request_gemini_graph_analysis(
    *,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    cards: list[StoryGraphCardSummaryOut],
    nodes: list[StoryGraphNode],
    edges: list[StoryGraphEdge],
) -> dict[str, Any]:
    from app.services.story_generation_provider import _request_polza_story_text
    from app.services.story_llm_modules import LlmModuleService

    messages = _build_graph_analysis_messages(
        game=game,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        cards=cards,
        nodes=nodes,
        edges=edges,
    )

    def request_text(messages_payload: list[dict[str, str]], **kwargs: Any) -> str:
        return _request_polza_story_text(
            messages_payload,
            model_name=str(kwargs.get("model_name") or POLZA_GEMINI_25_FLASH_MODEL),
            allow_service_fallback=False,
            translate_input=False,
            fallback_model_names=[],
            temperature=float(kwargs.get("temperature", 0.1)),
            max_tokens=int(kwargs.get("max_tokens", GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS)),
            request_timeout=kwargs.get("request_timeout") or (8, 150),
            retry_on_rate_limit=False,
        )

    service = LlmModuleService(
        request_text,
        primary_model=POLZA_GEMINI_25_FLASH_MODEL,
        fallback_models=[],
        include_configured_fallback=False,
    )
    payload, _provider_meta = service.call_json(
        messages=messages,
        schema=_GraphAnalysisPayload,
        module=GRAPH_LLM_MODULE_NAME,
        game_id=int(game.id),
        max_tokens=GRAPH_ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature=0.1,
        max_attempts=1,
        request_timeout=(8.0, 150.0),
    )
    dumped_payload = payload.model_dump(mode="json", by_alias=True)
    evidence_warnings = _validate_graph_analysis_evidence(
        dumped_payload,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    if evidence_warnings:
        # Evidence protects diagnostics, but a punctuation or declension
        # mismatch must not discard every otherwise valid Gemini action.
        logger.warning(
            "Story graph evidence warnings: game_id=%s warnings=%s",
            game.id,
            "; ".join(evidence_warnings[:20]),
        )
        dumped_payload["_validationWarnings"] = evidence_warnings[:50]
    return dumped_payload


def _should_apply_ai_action(
    *,
    confidence: float | None,
    threshold: float,
    apply_high_confidence: bool,
) -> bool:
    if not apply_high_confidence:
        return False
    return (confidence if confidence is not None else 0.0) >= threshold


def _apply_graph_analysis_payload(
    db: Session,
    game: StoryGame,
    payload: dict[str, Any],
    *,
    apply_high_confidence: bool,
    confidence_threshold: float,
    confirm_low_confidence: bool,
    source_turn_id: int | None,
    allow_node_actions: bool = True,
    allow_edge_actions: bool = True,
    cards_override: list[StoryGraphCardSummaryOut] | None = None,
) -> dict[str, Any]:
    cards = list(cards_override) if cards_override is not None else _list_card_summaries(db, int(game.id))
    cards_by_key = _card_summary_map(cards)
    ref_index = _build_cards_ref_index(cards)
    temp_refs: dict[str, tuple[str, int]] = {}
    result = {
        "applied_cards": 0,
        "applied_nodes": 0,
        "applied_edges": 0,
        "updated_edges": 0,
        "suggestions_created": 0,
        "skipped": [],
    }

    def add_skip(reason: str) -> None:
        if reason:
            result["skipped"].append(reason)

    required_temp_refs: set[str] = set()

    def add_required_temp_ref(value: Any) -> None:
        normalized = _compact_text(value)
        if not normalized:
            return
        required_temp_refs.add(normalized)
        required_temp_refs.add(normalized.casefold())
        required_temp_refs.add(_normalize_key(normalized))

    for raw_node in payload.get("addNodes", []) if isinstance(payload.get("addNodes"), list) else []:
        if not isinstance(raw_node, dict) or not allow_node_actions:
            continue
        if _should_apply_ai_action(
            confidence=_normalize_confidence(raw_node.get("confidence")),
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ):
            add_required_temp_ref(raw_node.get("cardRef"))
    for raw_edge in payload.get("createEdges", []) if isinstance(payload.get("createEdges"), list) else []:
        if not isinstance(raw_edge, dict) or not allow_edge_actions:
            continue
        if _should_apply_ai_action(
            confidence=_normalize_confidence(raw_edge.get("confidence")),
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ):
            add_required_temp_ref(raw_edge.get("sourceCardRef"))
            add_required_temp_ref(raw_edge.get("targetCardRef"))

    def is_required_card_dependency(raw_card: dict[str, Any]) -> bool:
        for candidate in (
            raw_card.get("key"),
            raw_card.get("id"),
            raw_card.get("tempKey"),
            raw_card.get("temp_key"),
            raw_card.get("cardRef"),
            raw_card.get("name"),
            raw_card.get("title"),
        ):
            normalized = _compact_text(candidate)
            if normalized and {
                normalized,
                normalized.casefold(),
                _normalize_key(normalized),
            }.intersection(required_temp_refs):
                return True
        return False

    for raw_card in payload.get("createCards", []) if isinstance(payload.get("createCards"), list) else []:
        if not isinstance(raw_card, dict):
            continue
        if not allow_node_actions:
            continue
        confidence = _normalize_confidence(raw_card.get("confidence"))
        should_apply_card = _should_apply_ai_action(
            confidence=confidence,
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ) or is_required_card_dependency(raw_card)
        if should_apply_card:
            key, skip_reason = _create_card_from_ai(
                db,
                game,
                raw_card,
                temp_refs=temp_refs,
                cards_by_key=cards_by_key,
            )
            if key is not None:
                if skip_reason is None:
                    result["applied_cards"] += 1
                ref_index.update(_build_cards_ref_index(list(cards_by_key.values())))
                existing_node_id = db.scalar(
                    select(StoryGraphNode.id).where(
                        StoryGraphNode.game_id == int(game.id),
                        StoryGraphNode.card_type == key[0],
                        StoryGraphNode.card_id == key[1],
                        StoryGraphNode.undone_at.is_(None),
                    )
                )
                ensure_graph_node_for_card(
                    db,
                    game,
                    card_type=key[0],
                    card_id=key[1],
                    created_by="ai",
                    source_turn_id=source_turn_id,
                )
                if existing_node_id is None:
                    result["applied_nodes"] += 1
            elif skip_reason:
                add_skip(skip_reason)
        elif confirm_low_confidence and _create_suggestion(
            db,
            game,
            kind="create_card",
            payload=raw_card,
            reason=str(raw_card.get("reason") or ""),
            confidence=confidence,
            source_turn_id=source_turn_id,
        ):
            result["suggestions_created"] += 1

    for raw_node in payload.get("addNodes", []) if isinstance(payload.get("addNodes"), list) else []:
        if not isinstance(raw_node, dict):
            continue
        if not allow_node_actions:
            continue
        confidence = _normalize_confidence(raw_node.get("confidence"))
        card_ref = _resolve_card_ref(raw_node.get("cardRef"), temp_refs=temp_refs, ref_index=ref_index)
        if card_ref is None:
            add_skip("node card ref not found")
            continue
        if _should_apply_ai_action(
            confidence=confidence,
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ):
            existing_node_id = db.scalar(
                select(StoryGraphNode.id).where(
                    StoryGraphNode.game_id == int(game.id),
                    StoryGraphNode.card_type == card_ref[0],
                    StoryGraphNode.card_id == card_ref[1],
                    StoryGraphNode.undone_at.is_(None),
                )
            )
            ensure_graph_node_for_card(
                db,
                game,
                card_type=card_ref[0],
                card_id=card_ref[1],
                created_by="ai",
                source_turn_id=source_turn_id,
            )
            if existing_node_id is None:
                result["applied_nodes"] += 1
        elif confirm_low_confidence and _create_suggestion(
            db,
            game,
            kind="add_node",
            payload={**raw_node, "cardRef": _graph_card_ref_string(card_ref[0], card_ref[1])},
            reason=str(raw_node.get("reason") or ""),
            confidence=confidence,
            source_turn_id=source_turn_id,
        ):
            result["suggestions_created"] += 1

    for raw_edge in payload.get("createEdges", []) if isinstance(payload.get("createEdges"), list) else []:
        if not isinstance(raw_edge, dict):
            continue
        if not allow_edge_actions:
            continue
        confidence = _normalize_confidence(raw_edge.get("confidence"))
        source_ref = _resolve_card_ref(raw_edge.get("sourceCardRef"), temp_refs=temp_refs, ref_index=ref_index)
        target_ref = _resolve_card_ref(raw_edge.get("targetCardRef"), temp_refs=temp_refs, ref_index=ref_index)
        if source_ref is None or target_ref is None:
            add_skip("edge card ref not found")
            continue
        if source_ref == target_ref:
            add_skip("edge cannot connect a card to itself")
            continue
        relation_type = _normalize_relation_type(raw_edge.get("relationType"))
        label = _compact_text(raw_edge.get("label"), max_chars=160)
        description = _compact_text(raw_edge.get("description"), max_chars=4_000)
        copy_error = _validate_ai_relationship_copy(
            label=label,
            description=description,
            require_label=True,
            require_description=True,
        )
        if copy_error:
            add_skip(copy_error)
            continue
        duplicate = _find_duplicate_edge(
            db,
            game,
            source_card_type=source_ref[0],
            source_card_id=source_ref[1],
            target_card_type=target_ref[0],
            target_card_id=target_ref[1],
            relation_type=relation_type,
            label=label,
        )
        if duplicate is not None:
            add_skip("similar edge already exists")
            continue
        if _should_apply_ai_action(
            confidence=confidence,
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ):
            source_node_id = db.scalar(
                select(StoryGraphNode.id).where(
                    StoryGraphNode.game_id == int(game.id),
                    StoryGraphNode.card_type == source_ref[0],
                    StoryGraphNode.card_id == source_ref[1],
                    StoryGraphNode.undone_at.is_(None),
                )
            )
            target_node_id = db.scalar(
                select(StoryGraphNode.id).where(
                    StoryGraphNode.game_id == int(game.id),
                    StoryGraphNode.card_type == target_ref[0],
                    StoryGraphNode.card_id == target_ref[1],
                    StoryGraphNode.undone_at.is_(None),
                )
            )
            source_node = ensure_graph_node_for_card(
                db,
                game,
                card_type=source_ref[0],
                card_id=source_ref[1],
                created_by="ai",
                source_turn_id=source_turn_id,
            )
            target_node = ensure_graph_node_for_card(
                db,
                game,
                card_type=target_ref[0],
                card_id=target_ref[1],
                created_by="ai",
                source_turn_id=source_turn_id,
            )
            if source_node_id is None:
                result["applied_nodes"] += 1
            if target_node_id is None and target_ref != source_ref:
                result["applied_nodes"] += 1
            create_story_graph_edge(
                db,
                game,
                StoryGraphEdgeCreateRequest(
                    source_node_id=int(source_node.id),
                    target_node_id=int(target_node.id),
                    relation_type=relation_type,
                    label=label,
                    description=description,
                    direction=_normalize_direction(raw_edge.get("direction")),
                    scope=_normalize_scope(raw_edge.get("scope")),
                    importance=_normalize_importance(raw_edge.get("importance")),
                    active=True,
                ),
                created_by="ai",
                confidence=confidence,
                source_turn_id=source_turn_id,
            )
            result["applied_edges"] += 1
        elif confirm_low_confidence and _create_suggestion(
            db,
            game,
            kind="create_edge",
            payload={
                **raw_edge,
                "sourceCardRef": _graph_card_ref_string(source_ref[0], source_ref[1]),
                "targetCardRef": _graph_card_ref_string(target_ref[0], target_ref[1]),
            },
            reason=str(raw_edge.get("reason") or ""),
            confidence=confidence,
            source_turn_id=source_turn_id,
        ):
            result["suggestions_created"] += 1

    for raw_update in payload.get("updateEdges", []) if isinstance(payload.get("updateEdges"), list) else []:
        if not isinstance(raw_update, dict):
            continue
        if not allow_edge_actions:
            continue
        edge_id = _safe_int(raw_update.get("edgeId") or raw_update.get("edge_id") or raw_update.get("id"))
        if edge_id <= 0:
            add_skip("update edge id missing")
            continue
        edge = db.scalar(
            select(StoryGraphEdge).where(
                StoryGraphEdge.game_id == int(game.id),
                StoryGraphEdge.id == edge_id,
                StoryGraphEdge.undone_at.is_(None),
            )
        )
        if edge is None:
            add_skip("update edge not found")
            continue
        raw_label = raw_update.get("label")
        raw_description = raw_update.get("description")
        copy_error = _validate_ai_relationship_copy(
            label=raw_label,
            description=raw_description,
            require_label=raw_label is not None,
            require_description=raw_description is not None,
        )
        if copy_error:
            add_skip(copy_error)
            continue
        confidence = _normalize_confidence(raw_update.get("confidence"))
        if _should_apply_ai_action(
            confidence=confidence,
            threshold=confidence_threshold,
            apply_high_confidence=apply_high_confidence,
        ):
            update_story_graph_edge(
                db,
                game,
                edge_id,
                StoryGraphEdgeUpdateRequest(
                    label=_compact_text(raw_update.get("label"), max_chars=160) or edge.label,
                    description=_compact_text(raw_update.get("description"), max_chars=4_000) or edge.description,
                    importance=_normalize_importance(raw_update.get("importance") or edge.importance),
                ),
                source_turn_id=source_turn_id,
            )
            result["updated_edges"] += 1
        elif confirm_low_confidence and _create_suggestion(
            db,
            game,
            kind="update_edge",
            payload=raw_update,
            reason=str(raw_update.get("reason") or ""),
            confidence=confidence,
            source_turn_id=source_turn_id,
        ):
            result["suggestions_created"] += 1

    return result


def analyze_story_graph_after_turn(
    *,
    db: Session,
    game: StoryGame,
    latest_user_prompt: str,
    latest_assistant_text: str,
    assistant_message_id: int | None = None,
    apply_high_confidence: bool = True,
    confidence_threshold: float | None = None,
    confirm_low_confidence: bool | None = None,
    resolved_payload_override: Any = None,
    allow_model_request: bool = True,
    allow_node_actions: bool = True,
    allow_edge_actions: bool = True,
) -> dict[str, Any]:
    threshold = _safe_float(confidence_threshold, _safe_float(getattr(game, "graph_auto_apply_confidence", None), 0.78))
    threshold = max(0.0, min(threshold, 1.0))
    confirm_low = bool(
        getattr(game, "graph_confirm_low_confidence", True)
        if confirm_low_confidence is None
        else confirm_low_confidence
    )
    cards = _list_card_summaries(db, int(game.id))
    nodes = db.scalars(
        select(StoryGraphNode)
        .where(
            StoryGraphNode.game_id == int(game.id),
            StoryGraphNode.undone_at.is_(None),
        )
        .order_by(StoryGraphNode.id.asc())
    ).all()
    edges = db.scalars(
        select(StoryGraphEdge)
        .where(
            StoryGraphEdge.game_id == int(game.id),
            StoryGraphEdge.undone_at.is_(None),
        )
        .order_by(StoryGraphEdge.id.asc())
    ).all()
    card_keys = set(_card_summary_map(cards))
    nodes = [
        node
        for node in nodes
        if _card_key(node.card_type, int(node.card_id)) in card_keys
    ]
    visible_node_ids = {int(node.id) for node in nodes}
    edges = [
        edge
        for edge in edges
        if int(edge.source_node_id) in visible_node_ids and int(edge.target_node_id) in visible_node_ids
    ]
    payload = resolved_payload_override if isinstance(resolved_payload_override, dict) else None
    if payload is None and allow_model_request:
        logger.info(
            "Story graph Gemini analysis started: game_id=%s assistant_message_id=%s cards=%s nodes=%s edges=%s",
            game.id,
            assistant_message_id,
            len(cards),
            len(nodes),
            len(edges),
        )
        _record_graph_event(
            db,
            game,
            event_type="gemini_called",
            message="Gemini graph analysis requested",
            payload={"cards": len(cards), "nodes": len(nodes), "edges": len(edges)},
            assistant_message_id=assistant_message_id,
        )
        payload = request_gemini_graph_analysis(
            game=game,
            latest_user_prompt=latest_user_prompt,
            latest_assistant_text=latest_assistant_text,
            cards=cards,
            nodes=nodes,
            edges=edges,
        )
    if not isinstance(payload, dict) or not payload:
        _record_graph_event(
            db,
            game,
            event_type="empty_payload",
            message="Gemini graph analysis returned empty payload",
            assistant_message_id=assistant_message_id,
        )
        return {
            "applied_cards": 0,
            "applied_nodes": 0,
            "applied_edges": 0,
            "updated_edges": 0,
            "suggestions_created": 0,
            "skipped": ["empty payload"],
        }
    _record_graph_event(
        db,
        game,
        event_type="gemini_response",
        message="Gemini graph analysis returned structured actions",
        payload={
            "create_cards": len(payload.get("createCards", [])) if isinstance(payload.get("createCards"), list) else 0,
            "add_nodes": len(payload.get("addNodes", [])) if isinstance(payload.get("addNodes"), list) else 0,
            "create_edges": len(payload.get("createEdges", [])) if isinstance(payload.get("createEdges"), list) else 0,
            "update_edges": len(payload.get("updateEdges", [])) if isinstance(payload.get("updateEdges"), list) else 0,
            "validation_warnings": len(payload.get("_validationWarnings", []))
            if isinstance(payload.get("_validationWarnings"), list)
            else 0,
            "do_nothing_reason": _compact_text(payload.get("doNothingReason"), max_chars=500),
        },
        assistant_message_id=assistant_message_id,
    )
    result = _apply_graph_analysis_payload(
        db,
        game,
        payload,
        apply_high_confidence=apply_high_confidence,
        confidence_threshold=threshold,
        confirm_low_confidence=confirm_low,
        source_turn_id=assistant_message_id,
        allow_node_actions=allow_node_actions,
        allow_edge_actions=allow_edge_actions,
        cards_override=cards,
    )
    action_count = sum(
        len(payload.get(key, [])) if isinstance(payload.get(key), list) else 0
        for key in ("createCards", "addNodes", "createEdges", "updateEdges")
    )
    if action_count == 0:
        do_nothing_reason = _compact_text(payload.get("doNothingReason"), max_chars=500)
        if do_nothing_reason:
            result["skipped"].append(do_nothing_reason)
    _record_graph_event(
        db,
        game,
        event_type="analysis_applied",
        message="Gemini graph analysis processed",
        payload=result,
        assistant_message_id=assistant_message_id,
    )
    logger.info(
        "Story graph Gemini analysis processed: game_id=%s assistant_message_id=%s cards=%s nodes=%s edges=%s updates=%s suggestions=%s skipped=%s",
        game.id,
        assistant_message_id,
        result["applied_cards"],
        result["applied_nodes"],
        result["applied_edges"],
        result["updated_edges"],
        result["suggestions_created"],
        len(result["skipped"]),
    )
    return result


def analyze_story_graph_for_api(
    db: Session,
    game: StoryGame,
    *,
    assistant_message_id: int | None,
    latest_user_prompt: str | None,
    latest_assistant_text: str | None,
    apply_high_confidence: bool,
    confidence_threshold: float | None,
    confirm_low_confidence: bool | None,
) -> StoryGraphAiAnalyzeOut:
    user_prompt = _compact_text(latest_user_prompt, max_chars=4_000)
    assistant_text = _compact_text(latest_assistant_text, max_chars=GRAPH_ANALYSIS_MAX_TURN_CHARS)
    resolved_assistant_message_id = int(assistant_message_id) if assistant_message_id else None
    if not user_prompt or not assistant_text:
        assistant_message_query = select(StoryMessage).where(
            StoryMessage.game_id == int(game.id),
            StoryMessage.role == "assistant",
            StoryMessage.undone_at.is_(None),
        )
        if resolved_assistant_message_id is not None:
            assistant_message_query = assistant_message_query.where(
                StoryMessage.id == resolved_assistant_message_id
            )
        else:
            assistant_message_query = assistant_message_query.order_by(StoryMessage.id.desc()).limit(1)
        assistant_message = db.scalar(assistant_message_query)
        if assistant_message is None:
            if resolved_assistant_message_id is not None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant message not found")
        else:
            resolved_assistant_message_id = int(assistant_message.id)
            assistant_text = assistant_text or _compact_text(
                assistant_message.content,
                max_chars=GRAPH_ANALYSIS_MAX_TURN_CHARS,
            )
            user_message = db.scalar(
                select(StoryMessage)
                .where(
                    StoryMessage.game_id == int(game.id),
                    StoryMessage.role == "user",
                    StoryMessage.id < int(assistant_message.id),
                    StoryMessage.undone_at.is_(None),
                )
                .order_by(StoryMessage.id.desc())
            )
            if user_message is not None:
                user_prompt = user_prompt or _compact_text(user_message.content, max_chars=4_000)
    if not user_prompt and not assistant_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Graph analysis needs turn text")
    try:
        result = analyze_story_graph_after_turn(
            db=db,
            game=game,
            latest_user_prompt=user_prompt,
            latest_assistant_text=assistant_text,
            assistant_message_id=resolved_assistant_message_id,
            apply_high_confidence=apply_high_confidence,
            confidence_threshold=confidence_threshold,
            confirm_low_confidence=confirm_low_confidence,
            allow_model_request=True,
        )
    except Exception as exc:
        logger.exception(
            "Manual story graph analysis failed: game_id=%s assistant_message_id=%s",
            game.id,
            resolved_assistant_message_id,
        )
        db.rollback()
        error_detail = _compact_text(exc, max_chars=500) or "unknown graph analysis error"
        _record_graph_event(
            db,
            game,
            event_type="analysis_failed",
            message="Manual Gemini graph analysis failed",
            payload={"error": error_detail},
            assistant_message_id=resolved_assistant_message_id,
        )
        db.flush()
        result = {
            "applied_cards": 0,
            "applied_nodes": 0,
            "applied_edges": 0,
            "updated_edges": 0,
            "suggestions_created": 0,
            "skipped": [f"Gemini graph analysis failed: {error_detail}"],
        }
    db.flush()
    return StoryGraphAiAnalyzeOut(
        applied_cards=int(result["applied_cards"]),
        applied_nodes=int(result["applied_nodes"]),
        applied_edges=int(result["applied_edges"]),
        updated_edges=int(result["updated_edges"]),
        suggestions_created=int(result["suggestions_created"]),
        skipped=list(result["skipped"]),
        graph=get_story_graph(db, game),
    )


def apply_story_graph_suggestions(
    db: Session,
    game: StoryGame,
    *,
    suggestion_ids: list[int],
    edits_by_id: dict[int, dict[str, Any]] | None = None,
) -> StoryGraphApplySuggestionsOut:
    edits = edits_by_id or {}
    applied = 0
    skipped: list[str] = []
    suggestions = db.scalars(
        select(StoryGraphSuggestion).where(
            StoryGraphSuggestion.game_id == int(game.id),
            StoryGraphSuggestion.status == GRAPH_SUGGESTION_PENDING,
            StoryGraphSuggestion.id.in_([int(item) for item in suggestion_ids if int(item) > 0]),
            StoryGraphSuggestion.undone_at.is_(None),
        )
    ).all()
    for suggestion in suggestions:
        payload = _json_loads_dict(suggestion.payload)
        edit_payload = edits.get(int(suggestion.id)) or edits.get(str(suggestion.id)) or {}
        if isinstance(edit_payload, dict):
            payload.update(edit_payload)
        before = get_story_graph(db, game)
        try:
            synthetic_payload: dict[str, Any]
            if suggestion.kind == "create_card":
                synthetic_payload = {"createCards": [payload]}
            elif suggestion.kind == "add_node":
                synthetic_payload = {"addNodes": [payload]}
            elif suggestion.kind == "create_edge":
                synthetic_payload = {"createEdges": [payload]}
            elif suggestion.kind == "update_edge":
                synthetic_payload = {"updateEdges": [payload]}
            else:
                skipped.append(f"Unsupported suggestion kind: {suggestion.kind}")
                continue
            result = _apply_graph_analysis_payload(
                db,
                game,
                synthetic_payload,
                apply_high_confidence=True,
                confidence_threshold=0.0,
                confirm_low_confidence=False,
                source_turn_id=int(suggestion.source_turn_id) if suggestion.source_turn_id else None,
            )
            changed = (
                result["applied_cards"]
                or result["applied_nodes"]
                or result["applied_edges"]
                or result["updated_edges"]
            )
            if changed:
                suggestion.status = GRAPH_SUGGESTION_ACCEPTED
                applied += 1
            else:
                after = get_story_graph(db, game)
                if before != after:
                    suggestion.status = GRAPH_SUGGESTION_ACCEPTED
                    applied += 1
                else:
                    skipped.extend(result["skipped"] or ["Suggestion did not change graph"])
        except HTTPException as exc:
            skipped.append(str(exc.detail))
    db.flush()
    return StoryGraphApplySuggestionsOut(applied=applied, declined=0, skipped=skipped, graph=get_story_graph(db, game))


def decline_story_graph_suggestion(db: Session, game: StoryGame, suggestion_id: int) -> None:
    suggestion = db.scalar(
        select(StoryGraphSuggestion).where(
            StoryGraphSuggestion.game_id == int(game.id),
            StoryGraphSuggestion.id == int(suggestion_id),
            StoryGraphSuggestion.status == GRAPH_SUGGESTION_PENDING,
            StoryGraphSuggestion.undone_at.is_(None),
        )
    )
    if suggestion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph suggestion not found")
    suggestion.status = GRAPH_SUGGESTION_DECLINED
    db.flush()


def build_story_graph_context_instruction(
    db: Session,
    game: StoryGame,
    *,
    context_messages: list[StoryMessage],
    world_cards: list[dict[str, Any]],
    plot_cards: list[dict[str, Any]],
    instruction_cards: list[dict[str, Any]],
) -> str:
    edges = db.scalars(
        select(StoryGraphEdge)
        .where(
            StoryGraphEdge.game_id == int(game.id),
            StoryGraphEdge.active.is_(True),
            StoryGraphEdge.undone_at.is_(None),
        )
        .order_by(StoryGraphEdge.importance.desc(), StoryGraphEdge.updated_at.desc(), StoryGraphEdge.id.desc())
    ).all()
    if not edges:
        return ""
    referenced_card_keys = {
        *(_card_key(edge.source_card_type, int(edge.source_card_id)) for edge in edges),
        *(_card_key(edge.target_card_type, int(edge.target_card_id)) for edge in edges),
    }
    cards = _list_card_summaries_for_keys(db, int(game.id), referenced_card_keys)
    card_by_key = _card_summary_map(cards)
    active_keys: set[tuple[str, int]] = set()

    def add_payload_keys(items: list[dict[str, Any]], card_type: str) -> None:
        normalized_titles: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            card_id = item.get("id")
            if isinstance(card_id, int):
                active_keys.add(_card_key(card_type, int(card_id)))
                continue
            title = _compact_text(item.get("title"), max_chars=240).casefold()
            if title:
                normalized_titles.add(title)
        if not normalized_titles:
            return
        for key, card in card_by_key.items():
            if key[0] == card_type and _compact_text(card.title, max_chars=240).casefold() in normalized_titles:
                active_keys.add(key)

    add_payload_keys(world_cards, GRAPH_CARD_TYPE_WORLD_CARD)
    add_payload_keys(plot_cards, GRAPH_CARD_TYPE_PLOT_CARD)
    add_payload_keys(instruction_cards, GRAPH_CARD_TYPE_INSTRUCTION_CARD)
    if not active_keys:
        return ""

    contextual_card_types = {
        GRAPH_CARD_TYPE_INSTRUCTION_CARD,
        GRAPH_CARD_TYPE_PLOT_CARD,
        GRAPH_CARD_TYPE_MEMORY_BLOCK,
    }
    expanded_active_keys = set(active_keys)
    for edge in edges:
        source_key = _card_key(edge.source_card_type, int(edge.source_card_id))
        target_key = _card_key(edge.target_card_type, int(edge.target_card_id))
        if source_key in active_keys and target_key[0] in contextual_card_types:
            expanded_active_keys.add(target_key)
        if target_key in active_keys and source_key[0] in contextual_card_types:
            expanded_active_keys.add(source_key)

    selected_edges = [
        edge
        for edge in edges
        if _card_key(edge.source_card_type, int(edge.source_card_id)) in expanded_active_keys
        and _card_key(edge.target_card_type, int(edge.target_card_id)) in expanded_active_keys
    ]
    if not selected_edges:
        return ""

    def edge_score(edge: StoryGraphEdge) -> tuple[int, int]:
        score = int(edge.importance or 3) * 10
        source_key = _card_key(edge.source_card_type, int(edge.source_card_id))
        target_key = _card_key(edge.target_card_type, int(edge.target_card_id))
        if source_key in active_keys and target_key in active_keys:
            score += 60
        elif source_key in active_keys or target_key in active_keys:
            score += 40
        return (score, int(edge.id))

    selected_edges = sorted(selected_edges, key=edge_score, reverse=True)
    if len(selected_edges) > GRAPH_CONTEXT_MAX_EDGES:
        selected_edges = selected_edges[:GRAPH_CONTEXT_MAX_EDGES]
    selected_card_keys: set[tuple[str, int]] = set()
    for edge in selected_edges:
        selected_card_keys.add(_card_key(edge.source_card_type, int(edge.source_card_id)))
        selected_card_keys.add(_card_key(edge.target_card_type, int(edge.target_card_id)))
    node_lines: list[str] = []
    for key in sorted(selected_card_keys, key=lambda item: (item[0], item[1])):
        card = card_by_key.get(key)
        if card is None:
            continue
        descriptor = card.kind or card.card_type
        description = _compact_text(card.description, max_chars=220)
        line = f"- {card.title} — {descriptor}"
        if description:
            line += f": {description}"
        node_lines.append(line)
    edge_lines: list[str] = []
    scoped_lines: list[str] = []
    for edge in selected_edges:
        source = card_by_key.get(_card_key(edge.source_card_type, int(edge.source_card_id)))
        target = card_by_key.get(_card_key(edge.target_card_type, int(edge.target_card_id)))
        if source is None or target is None:
            continue
        arrow = "—" if _normalize_direction(edge.direction) == "undirected" else "->"
        label = _compact_text(edge.label, max_chars=120) or _normalize_relation_type(edge.relation_type)
        description = _compact_text(edge.description, max_chars=360)
        line = f"- {source.title} {arrow} {target.title}: \"{label}\""
        if description:
            line += f". Детали: {description}"
        line += f" [type={_normalize_relation_type(edge.relation_type)}, scope={_normalize_scope(edge.scope)}, importance={_normalize_importance(edge.importance)}]"
        edge_lines.append(line)
        if _normalize_relation_type(edge.relation_type) == "rule_applies_to" or _normalize_scope(edge.scope) in {
            "character_specific",
            "source_only",
            "target_only",
            "location_specific",
            "organization_specific",
        }:
            scoped_lines.append(
                f"- Связь \"{label}\" имеет scope={_normalize_scope(edge.scope)}: применяй ее только к указанным сущностям ({source.title} и {target.title}), не глобально."
            )
    if not edge_lines:
        return ""
    sections = [
        "[АКТИВНЫЙ ПОДГРАФ СВЯЗЕЙ КАРТОЧЕК]",
        "Здесь только связи карточек, активных в текущем ходе, плюс напрямую связанные с ними правила, сюжет и важная память.",
        "Используй только перечисленные связи. Не подтягивай остальные ноды графа и не делай выводов об отсутствующих здесь связях.",
    ]
    if node_lines:
        sections.append("Ноды:\n" + "\n".join(node_lines))
    sections.append("Связи:\n" + "\n".join(edge_lines))
    if scoped_lines:
        sections.append("Scoped rules:\n" + "\n".join(scoped_lines[:12]))
    rendered = "\n\n".join(sections).strip()
    return rendered[:GRAPH_CONTEXT_MAX_CHARS].rstrip()
