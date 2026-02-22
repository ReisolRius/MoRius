from __future__ import annotations

from fastapi import APIRouter

from app.schemas import MessageResponse

router = APIRouter()


@router.get("/api/health", response_model=MessageResponse)
def health_check() -> MessageResponse:
    return MessageResponse(message="ok")

