from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMapImage, StoryMessage
from app.schemas import (
    StoryGameSummaryOut,
    StoryMapImageGenerateOut,
    StoryMapImageGenerateRequest,
    StoryMapImageOut,
    StoryMapInitializeRequest,
    StoryMapTravelPreviewOut,
    StoryMapTravelRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_games import (
    mask_story_game_admin_only_state,
    story_game_summary_to_out,
)
from app.services.story_map_runtime import (
    build_story_map_travel_preview,
    disable_story_map_for_game,
    get_story_map_state_or_400,
    initialize_story_map_for_game,
    sync_story_map_after_assistant_message,
    travel_story_map_to_location,
)
from app.services.story_queries import get_user_story_game_or_404, touch_story_game

router = APIRouter()


def _require_story_map_admin(user) -> None:
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _story_game_summary_to_out_for_admin(game) -> StoryGameSummaryOut:
    return mask_story_game_admin_only_state(
        story_game_summary_to_out(game),
        include_character_state=True,
        include_story_map=True,
    )


def _soft_remove_story_map_images(db: Session, *, game_id: int) -> None:
    active_images = db.scalars(
        select(StoryMapImage).where(
            StoryMapImage.game_id == game_id,
            StoryMapImage.undone_at.is_(None),
        )
    ).all()
    if not active_images:
        return
    removed_at = datetime.now(timezone.utc)
    for image in active_images:
        image.undone_at = removed_at


@router.post("/api/story/games/{game_id}/map/initialize", response_model=StoryGameSummaryOut)
def initialize_story_map_route(
    game_id: int,
    payload: StoryMapInitializeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    initialize_story_map_for_game(
        game=game,
        world_description=payload.world_description,
        start_location=payload.start_location,
        theme=payload.theme,
    )
    _soft_remove_story_map_images(db, game_id=game.id)
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return _story_game_summary_to_out_for_admin(game)


@router.post("/api/story/games/{game_id}/map/resync", response_model=StoryGameSummaryOut)
def resync_story_map_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    if not bool(getattr(game, "story_map_enabled", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story map is disabled")

    latest_assistant_message = db.scalar(
        select(StoryMessage)
        .where(
            StoryMessage.game_id == game.id,
            StoryMessage.role == "assistant",
            StoryMessage.undone_at.is_(None),
        )
        .order_by(StoryMessage.id.desc())
        .limit(1)
    )
    sync_story_map_after_assistant_message(
        db=db,
        game=game,
        assistant_message=latest_assistant_message,
        latest_assistant_text=(
            latest_assistant_message.content
            if isinstance(latest_assistant_message, StoryMessage)
            else ""
        ),
    )
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return _story_game_summary_to_out_for_admin(game)


@router.delete("/api/story/games/{game_id}/map", response_model=StoryGameSummaryOut)
def disable_story_map_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    disable_story_map_for_game(game=game)
    _soft_remove_story_map_images(db, game_id=game.id)
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return _story_game_summary_to_out_for_admin(game)


@router.get("/api/story/games/{game_id}/map/images", response_model=list[StoryMapImageOut])
def list_story_map_images_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryMapImageOut]:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    get_story_map_state_or_400(game)
    return []


@router.post("/api/story/games/{game_id}/map/image", response_model=StoryMapImageGenerateOut)
def generate_story_map_image_route(
    game_id: int,
    payload: StoryMapImageGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMapImageGenerateOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="AI map layers were removed. The map now renders directly from structured world data.",
    )


@router.post("/api/story/games/{game_id}/map/travel-preview", response_model=StoryMapTravelPreviewOut)
def preview_story_map_travel_route(
    game_id: int,
    payload: StoryMapTravelRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryMapTravelPreviewOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    map_payload = get_story_map_state_or_400(game)
    return build_story_map_travel_preview(
        game=game,
        payload=map_payload,
        destination_location_id=payload.destination_location_id,
        destination_poi_id=payload.destination_poi_id,
        travel_mode=payload.travel_mode,
        destination_x=payload.destination_x,
        destination_y=payload.destination_y,
        destination_label=payload.destination_label,
    )


@router.post("/api/story/games/{game_id}/map/travel", response_model=StoryGameSummaryOut)
def travel_story_map_route(
    game_id: int,
    payload: StoryMapTravelRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    _require_story_map_admin(user)
    game = get_user_story_game_or_404(db, user.id, game_id)
    travel_story_map_to_location(
        game=game,
        destination_location_id=payload.destination_location_id,
        destination_poi_id=payload.destination_poi_id,
        travel_mode=payload.travel_mode,
        destination_x=payload.destination_x,
        destination_y=payload.destination_y,
        destination_label=payload.destination_label,
    )
    db.commit()
    db.refresh(game)
    return _story_game_summary_to_out_for_admin(game)
