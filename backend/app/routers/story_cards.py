from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select, update as sa_update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryInstructionCard, StoryPlotCard, StoryPlotCardChangeEvent
from app.schemas import (
    MessageResponse,
    StoryInstructionCardCreateRequest,
    StoryInstructionCardOut,
    StoryInstructionCardUpdateRequest,
    StoryPlotCardCreateRequest,
    StoryPlotCardOut,
    StoryPlotCardUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.story_cards import (
    STORY_PLOT_CARD_SOURCE_USER,
    normalize_story_instruction_content,
    normalize_story_instruction_title,
    normalize_story_plot_card_content,
    normalize_story_plot_card_title,
    story_plot_card_to_out,
)
from app.services.story_queries import (
    get_user_story_game_or_404,
    list_story_instruction_cards,
    list_story_plot_cards,
    touch_story_game,
)

router = APIRouter()


@router.get("/api/story/games/{game_id}/instructions", response_model=list[StoryInstructionCardOut])
def list_story_instruction_cards_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryInstructionCardOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    cards = list_story_instruction_cards(db, game.id)
    return [StoryInstructionCardOut.model_validate(card) for card in cards]


@router.post("/api/story/games/{game_id}/instructions", response_model=StoryInstructionCardOut)
def create_story_instruction_card(
    game_id: int,
    payload: StoryInstructionCardCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = StoryInstructionCard(
        game_id=game.id,
        title=normalize_story_instruction_title(payload.title),
        content=normalize_story_instruction_content(payload.content),
    )
    db.add(instruction_card)
    touch_story_game(game)
    db.commit()
    db.refresh(instruction_card)
    return StoryInstructionCardOut.model_validate(instruction_card)


@router.patch("/api/story/games/{game_id}/instructions/{instruction_id}", response_model=StoryInstructionCardOut)
def update_story_instruction_card(
    game_id: int,
    instruction_id: int,
    payload: StoryInstructionCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = db.scalar(
        select(StoryInstructionCard).where(
            StoryInstructionCard.id == instruction_id,
            StoryInstructionCard.game_id == game.id,
        )
    )
    if instruction_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction card not found")

    instruction_card.title = normalize_story_instruction_title(payload.title)
    instruction_card.content = normalize_story_instruction_content(payload.content)
    touch_story_game(game)
    db.commit()
    db.refresh(instruction_card)
    return StoryInstructionCardOut.model_validate(instruction_card)


@router.delete("/api/story/games/{game_id}/instructions/{instruction_id}", response_model=MessageResponse)
def delete_story_instruction_card(
    game_id: int,
    instruction_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    instruction_card = db.scalar(
        select(StoryInstructionCard).where(
            StoryInstructionCard.id == instruction_id,
            StoryInstructionCard.game_id == game.id,
        )
    )
    if instruction_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction card not found")

    db.delete(instruction_card)
    touch_story_game(game)
    db.commit()
    return MessageResponse(message="Instruction card deleted")


@router.get("/api/story/games/{game_id}/plot-cards", response_model=list[StoryPlotCardOut])
def list_story_plot_cards_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryPlotCardOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    cards = list_story_plot_cards(db, game.id)
    return [story_plot_card_to_out(card) for card in cards]


@router.post("/api/story/games/{game_id}/plot-cards", response_model=StoryPlotCardOut)
def create_story_plot_card(
    game_id: int,
    payload: StoryPlotCardCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlotCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    plot_card = StoryPlotCard(
        game_id=game.id,
        title=normalize_story_plot_card_title(payload.title),
        content=normalize_story_plot_card_content(payload.content),
        source=STORY_PLOT_CARD_SOURCE_USER,
    )
    db.add(plot_card)
    touch_story_game(game)
    db.commit()
    db.refresh(plot_card)
    return story_plot_card_to_out(plot_card)


@router.patch("/api/story/games/{game_id}/plot-cards/{card_id}", response_model=StoryPlotCardOut)
def update_story_plot_card(
    game_id: int,
    card_id: int,
    payload: StoryPlotCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlotCardOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    plot_card = db.scalar(
        select(StoryPlotCard).where(
            StoryPlotCard.id == card_id,
            StoryPlotCard.game_id == game.id,
        )
    )
    if plot_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plot card not found")

    plot_card.title = normalize_story_plot_card_title(payload.title)
    plot_card.content = normalize_story_plot_card_content(payload.content)
    touch_story_game(game)
    db.commit()
    db.refresh(plot_card)
    return story_plot_card_to_out(plot_card)


@router.delete("/api/story/games/{game_id}/plot-cards/{card_id}", response_model=MessageResponse)
def delete_story_plot_card(
    game_id: int,
    card_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    plot_card = db.scalar(
        select(StoryPlotCard).where(
            StoryPlotCard.id == card_id,
            StoryPlotCard.game_id == game.id,
        )
    )
    if plot_card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plot card not found")

    db.execute(
        sa_update(StoryPlotCardChangeEvent)
        .where(
            StoryPlotCardChangeEvent.plot_card_id == plot_card.id,
        )
        .values(plot_card_id=None)
    )
    db.delete(plot_card)
    touch_story_game(game)
    db.commit()
    return MessageResponse(message="Plot card deleted")
