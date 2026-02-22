from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StoryGenerateRequest

router = APIRouter()


@router.post("/api/story/games/{game_id}/generate")
def generate_story_response_route(
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # Lazy import avoids module initialization cycle while main.py still hosts runtime implementation.
    from app import main as monolith_main

    return monolith_main.generate_story_response_impl(
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )
