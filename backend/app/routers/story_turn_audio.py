from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StoryTurnAudioGenerateOut, StoryTurnAudioGenerateRequest

router = APIRouter()


@router.post("/api/story/games/{game_id}/turn-audio", response_model=StoryTurnAudioGenerateOut)
def generate_story_turn_audio_route(
    game_id: int,
    payload: StoryTurnAudioGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryTurnAudioGenerateOut:
    # Lazy import avoids module initialization cycle while main.py still hosts runtime implementation.
    from app import main as monolith_main

    return monolith_main.generate_story_turn_audio_impl(
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )
