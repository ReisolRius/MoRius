from __future__ import annotations

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StorySummaryGenerateRequest, StorySummaryJobOut

router = APIRouter()


@router.post(
    "/api/story/games/{game_id}/summary",
    response_model=StorySummaryJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def queue_story_summary_job_route(
    game_id: int,
    payload: StorySummaryGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySummaryJobOut:
    # Lazy import avoids module initialization cycle while main.py still hosts runtime implementation.
    from app import main as monolith_main

    return monolith_main.queue_story_summary_job_impl(
        game_id=game_id,
        payload=payload,
        authorization=authorization,
        db=db,
    )


@router.get(
    "/api/story/games/{game_id}/summary/{job_id}",
    response_model=StorySummaryJobOut,
)
def get_story_summary_job_route(
    game_id: int,
    job_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySummaryJobOut:
    from app import main as monolith_main

    return monolith_main.get_story_summary_job_impl(
        game_id=game_id,
        job_id=job_id,
        authorization=authorization,
        db=db,
    )
