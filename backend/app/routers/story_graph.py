from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    MessageResponse,
    StoryGraphAiAnalyzeOut,
    StoryGraphAiAnalyzeRequest,
    StoryGraphApplySuggestionsOut,
    StoryGraphApplySuggestionsRequest,
    StoryGraphEdgeCreateRequest,
    StoryGraphEdgeOut,
    StoryGraphEdgeUpdateRequest,
    StoryGraphNodeCreateRequest,
    StoryGraphNodeDeleteRequest,
    StoryGraphNodeLayoutUpdateRequest,
    StoryGraphNodeOut,
    StoryGraphOut,
)
from app.services.auth_identity import get_current_user
from app.services.story_graph import (
    analyze_story_graph_for_api,
    apply_story_graph_suggestions,
    auto_layout_story_graph,
    create_story_graph_edge,
    create_story_graph_node,
    decline_story_graph_suggestion,
    delete_story_graph_edge,
    delete_story_graph_node,
    get_story_graph,
    get_user_story_game_for_graph_or_404,
    update_story_graph_edge,
    update_story_graph_node_layout,
)
from app.services.story_queries import touch_story_game


router = APIRouter()


@router.get("/api/story/games/{game_id}/graph", response_model=StoryGraphOut)
def get_story_graph_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    return get_story_graph(db, game)


@router.post("/api/story/games/{game_id}/graph/nodes", response_model=StoryGraphNodeOut)
def create_story_graph_node_route(
    game_id: int,
    payload: StoryGraphNodeCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphNodeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    node = create_story_graph_node(db, game, payload, created_by="user")
    touch_story_game(game)
    db.commit()
    return node


@router.patch("/api/story/games/{game_id}/graph/nodes/{node_id}/layout", response_model=StoryGraphNodeOut)
def update_story_graph_node_layout_route(
    game_id: int,
    node_id: int,
    payload: StoryGraphNodeLayoutUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphNodeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    node = update_story_graph_node_layout(db, game, node_id, payload)
    touch_story_game(game)
    db.commit()
    return node


@router.delete("/api/story/games/{game_id}/graph/nodes/{node_id}", response_model=MessageResponse)
def delete_story_graph_node_route(
    game_id: int,
    node_id: int,
    payload: StoryGraphNodeDeleteRequest | None = None,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    connected_edges = delete_story_graph_node(db, game, node_id, delete_edges=bool(payload and payload.delete_edges))
    touch_story_game(game)
    db.commit()
    return MessageResponse(message=f"Graph node removed. Deleted edges: {connected_edges}")


@router.post("/api/story/games/{game_id}/graph/edges", response_model=StoryGraphEdgeOut)
def create_story_graph_edge_route(
    game_id: int,
    payload: StoryGraphEdgeCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphEdgeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    edge = create_story_graph_edge(db, game, payload, created_by="user")
    touch_story_game(game)
    db.commit()
    return edge


@router.patch("/api/story/games/{game_id}/graph/edges/{edge_id}", response_model=StoryGraphEdgeOut)
def update_story_graph_edge_route(
    game_id: int,
    edge_id: int,
    payload: StoryGraphEdgeUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphEdgeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    edge = update_story_graph_edge(db, game, edge_id, payload)
    touch_story_game(game)
    db.commit()
    return edge


@router.delete("/api/story/games/{game_id}/graph/edges/{edge_id}", response_model=MessageResponse)
def delete_story_graph_edge_route(
    game_id: int,
    edge_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    delete_story_graph_edge(db, game, edge_id)
    touch_story_game(game)
    db.commit()
    return MessageResponse(message="Graph edge deleted")


@router.post("/api/story/games/{game_id}/graph/auto-layout", response_model=StoryGraphOut)
def auto_layout_story_graph_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    graph = auto_layout_story_graph(db, game)
    touch_story_game(game)
    db.commit()
    return graph


@router.post("/api/story/games/{game_id}/graph/ai/analyze-after-turn", response_model=StoryGraphAiAnalyzeOut)
def analyze_story_graph_after_turn_route(
    game_id: int,
    payload: StoryGraphAiAnalyzeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphAiAnalyzeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    result = analyze_story_graph_for_api(
        db,
        game,
        assistant_message_id=payload.assistant_message_id,
        latest_user_prompt=payload.latest_user_prompt,
        latest_assistant_text=payload.latest_assistant_text,
        apply_high_confidence=payload.apply_high_confidence,
        confidence_threshold=payload.confidence_threshold,
        confirm_low_confidence=payload.confirm_low_confidence,
    )
    touch_story_game(game)
    db.commit()
    return result


@router.post("/api/story/games/{game_id}/graph/ai/suggest-graph-relations", response_model=StoryGraphAiAnalyzeOut)
def suggest_story_graph_relations_route(
    game_id: int,
    payload: StoryGraphAiAnalyzeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphAiAnalyzeOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    result = analyze_story_graph_for_api(
        db,
        game,
        assistant_message_id=payload.assistant_message_id,
        latest_user_prompt=payload.latest_user_prompt,
        latest_assistant_text=payload.latest_assistant_text,
        apply_high_confidence=False,
        confidence_threshold=payload.confidence_threshold,
        confirm_low_confidence=True,
    )
    touch_story_game(game)
    db.commit()
    return result


@router.post("/api/story/games/{game_id}/graph/ai/apply-graph-suggestions", response_model=StoryGraphApplySuggestionsOut)
def apply_story_graph_suggestions_route(
    game_id: int,
    payload: StoryGraphApplySuggestionsRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphApplySuggestionsOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    result = apply_story_graph_suggestions(
        db,
        game,
        suggestion_ids=payload.suggestion_ids,
        edits_by_id=payload.edits_by_id,
    )
    touch_story_game(game)
    db.commit()
    return result


@router.post("/api/story/games/{game_id}/graph/ai/suggestions/{suggestion_id}/decline", response_model=StoryGraphOut)
def decline_story_graph_suggestion_route(
    game_id: int,
    suggestion_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGraphOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_for_graph_or_404(db, user, game_id)
    decline_story_graph_suggestion(db, game, suggestion_id)
    touch_story_game(game)
    db.commit()
    return get_story_graph(db, game)
