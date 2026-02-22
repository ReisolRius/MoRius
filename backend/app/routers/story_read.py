from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryCommunityWorldRating, StoryCommunityWorldView, User
from app.schemas import (
    StoryCommunityWorldOut,
    StoryGameOut,
    StoryInstructionCardOut,
    StoryMessageOut,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import increment_story_world_views
from app.services.story_cards import story_plot_card_to_out
from app.services.story_events import (
    story_plot_card_change_event_to_out,
    story_world_card_change_event_to_out,
)
from app.services.story_games import (
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_out,
)
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    list_story_instruction_cards,
    list_story_messages,
    list_story_plot_card_events,
    list_story_plot_cards,
    list_story_world_card_events,
    list_story_world_cards,
)
from app.services.story_world_cards import story_world_card_to_out

router = APIRouter()


@router.get("/api/story/community/worlds/{world_id}", response_model=StoryCommunityWorldOut)
def get_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    view_inserted = False
    try:
        with db.begin_nested():
            db.add(
                StoryCommunityWorldView(
                    world_id=world.id,
                    user_id=user.id,
                )
            )
            db.flush()
        view_inserted = True
    except IntegrityError:
        view_inserted = False

    if view_inserted:
        increment_story_world_views(db, world.id)
        db.commit()
        db.refresh(world)

    author = db.scalar(select(User).where(User.id == world.user_id))
    user_rating = db.scalar(
        select(StoryCommunityWorldRating.rating).where(
            StoryCommunityWorldRating.world_id == world.id,
            StoryCommunityWorldRating.user_id == user.id,
        )
    )
    instruction_cards = list_story_instruction_cards(db, world.id)
    plot_cards = list_story_plot_cards(db, world.id)
    world_cards = list_story_world_cards(db, world.id)

    return StoryCommunityWorldOut(
        world=story_community_world_summary_to_out(
            world,
            author_name=story_author_name(author),
            user_rating=int(user_rating) if user_rating is not None else None,
        ),
        context_limit_chars=world.context_limit_chars,
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        plot_cards=[story_plot_card_to_out(card) for card in plot_cards],
        world_cards=[story_world_card_to_out(card) for card in world_cards],
    )


@router.get("/api/story/games/{game_id}", response_model=StoryGameOut)
def get_story_game(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    messages = list_story_messages(db, game.id)
    instruction_cards = list_story_instruction_cards(db, game.id)
    plot_cards = list_story_plot_cards(db, game.id)
    plot_card_events = list_story_plot_card_events(db, game.id)
    world_cards = list_story_world_cards(db, game.id)
    world_card_events = list_story_world_card_events(db, game.id)
    return StoryGameOut(
        game=story_game_summary_to_out(game),
        messages=[StoryMessageOut.model_validate(message) for message in messages],
        instruction_cards=[StoryInstructionCardOut.model_validate(card) for card in instruction_cards],
        plot_cards=[story_plot_card_to_out(card) for card in plot_cards],
        plot_card_events=[story_plot_card_change_event_to_out(event) for event in plot_card_events],
        world_cards=[story_world_card_to_out(card) for card in world_cards],
        world_card_events=[story_world_card_change_event_to_out(event) for event in world_card_events],
    )
