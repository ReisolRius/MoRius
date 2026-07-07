from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMessage
from app.schemas import (
    StoryNovelBackgroundGenerateRequest,
    StoryNovelBackgroundSelectRequest,
    StorySceneBackgroundOut,
)
from app.services.auth_identity import get_current_user
from app.services.story_novel_backgrounds import (
    generate_story_novel_background_impl,
    list_story_scene_backgrounds_impl,
    select_story_scene_background_impl,
)
from app.services.story_queries import get_user_story_game_or_404, list_story_messages, list_story_world_cards

router = APIRouter()


def _latest_story_turn_texts(db: Session, game_id: int) -> tuple[str, str]:
    messages = list_story_messages(db, game_id)
    latest_assistant_text = ""
    latest_user_prompt = ""
    for message in reversed(messages):
        if not isinstance(message, StoryMessage) or getattr(message, "undone_at", None) is not None:
            continue
        if not latest_assistant_text and message.role == "assistant":
            latest_assistant_text = str(message.content or "")
            continue
        if latest_assistant_text and not latest_user_prompt and message.role == "user":
            latest_user_prompt = str(message.content or "")
            break
    return latest_user_prompt, latest_assistant_text


@router.post(
    "/api/story/games/{game_id}/novel/background/generate",
    response_model=StorySceneBackgroundOut,
)
def generate_story_novel_background_route(
    game_id: int,
    payload: StoryNovelBackgroundGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    latest_user_prompt, latest_assistant_text = _latest_story_turn_texts(db, game.id)
    world_cards = list_story_world_cards(db, game.id)
    location_label = str(getattr(game, "current_location_label", "") or "").strip()

    return generate_story_novel_background_impl(
        db=db,
        game=game,
        user=user,
        world_cards=world_cards,
        location_label=location_label,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        requested_title=payload.title,
    )


@router.get(
    "/api/story/games/{game_id}/novel/backgrounds",
    response_model=list[StorySceneBackgroundOut],
)
def list_story_novel_backgrounds_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StorySceneBackgroundOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return list_story_scene_backgrounds_impl(db=db, game=game, user=user)


@router.post(
    "/api/story/games/{game_id}/novel/background/select",
    response_model=StorySceneBackgroundOut,
)
def select_story_novel_background_route(
    game_id: int,
    payload: StoryNovelBackgroundSelectRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return select_story_scene_background_impl(db=db, game=game, user=user, background_id=payload.background_id)
