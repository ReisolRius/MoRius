from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StoryTurnImageGenerateOut, StoryTurnImageGenerateRequest

router = APIRouter()


@router.post("/api/story/games/{game_id}/turn-image", response_model=StoryTurnImageGenerateOut)
def generate_story_turn_image_route(
    game_id: int,
    payload: StoryTurnImageGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryTurnImageGenerateOut:
    # Lazy import avoids module initialization cycle while main.py still hosts runtime implementation.
    from app import main as monolith_main

    return monolith_main.generate_story_turn_image_impl(
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )

