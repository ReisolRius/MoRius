from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryMessage
from app.schemas import (
    MessageResponse,
    StoryNovelBackgroundGenerateRequest,
    StoryNovelBackgroundSelectRequest,
    StoryPlaceBackgroundGenerateRequest,
    StoryPlaceCreateRequest,
    StoryPlaceImageUpdateRequest,
    StoryPlaceImportRequest,
    StoryPlaceTemplateOut,
    StoryPlaceUpdateRequest,
    StorySceneBackgroundOut,
)
from app.services.auth_identity import get_current_user
from app.services.story_novel_backgrounds import (
    create_story_place_template_impl,
    create_story_scene_background_impl,
    delete_story_place_template_impl,
    delete_story_scene_background_impl,
    generate_story_novel_background_impl,
    generate_story_place_template_background_impl,
    import_story_place_template_impl,
    list_story_place_templates_impl,
    list_story_scene_backgrounds_impl,
    select_story_scene_background_impl,
    update_story_place_template_impl,
    update_story_scene_background_impl,
)
from app.services.story_queries import get_user_story_game_or_404, list_story_messages, list_story_world_cards

router = APIRouter()


def _latest_story_turn_context(db: Session, game_id: int) -> tuple[str, str, int | None]:
    messages = list_story_messages(db, game_id)
    latest_assistant_text = ""
    latest_assistant_message_id: int | None = None
    latest_user_prompt = ""
    for message in reversed(messages):
        if not isinstance(message, StoryMessage) or getattr(message, "undone_at", None) is not None:
            continue
        if latest_assistant_message_id is None and message.role == "assistant":
            latest_assistant_text = str(message.content or "")
            latest_assistant_message_id = int(message.id)
            continue
        if latest_assistant_message_id is not None and not latest_user_prompt and message.role == "user":
            latest_user_prompt = str(message.content or "")
            break
    return latest_user_prompt, latest_assistant_text, latest_assistant_message_id


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

    latest_user_prompt, latest_assistant_text, latest_assistant_message_id = _latest_story_turn_context(db, game.id)
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
        assistant_message_id=latest_assistant_message_id,
        requested_title=payload.title,
        place_id=payload.place_id,
        requested_description=payload.description,
        requested_style_prompt=payload.style_prompt,
        requested_image_model=payload.image_model,
        requested_triggers=payload.triggers,
        make_current=payload.make_current,
        create_new_place=payload.create_new_place,
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


@router.get(
    "/api/story/games/{game_id}/novel/places",
    response_model=list[StorySceneBackgroundOut],
)
def list_story_novel_places_route(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StorySceneBackgroundOut]:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return list_story_scene_backgrounds_impl(db=db, game=game, user=user)


@router.post(
    "/api/story/games/{game_id}/novel/places",
    response_model=StorySceneBackgroundOut,
)
def create_story_novel_place_route(
    game_id: int,
    payload: StoryPlaceCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return create_story_scene_background_impl(
        db=db,
        game=game,
        user=user,
        title=payload.title,
        triggers=payload.triggers,
        image_url=payload.image_url,
        make_current=payload.make_current,
    )


@router.patch(
    "/api/story/games/{game_id}/novel/places/{place_id}",
    response_model=StorySceneBackgroundOut,
)
def update_story_novel_place_route(
    game_id: int,
    place_id: int,
    payload: StoryPlaceUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return update_story_scene_background_impl(
        db=db,
        game=game,
        user=user,
        background_id=place_id,
        fields=set(payload.model_fields_set),
        title=payload.title,
        triggers=payload.triggers,
        image_url=payload.image_url,
    )


@router.put(
    "/api/story/games/{game_id}/novel/places/{place_id}/image",
    response_model=StorySceneBackgroundOut,
)
def upload_story_novel_place_image_route(
    game_id: int,
    place_id: int,
    payload: StoryPlaceImageUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return update_story_scene_background_impl(
        db=db,
        game=game,
        user=user,
        background_id=place_id,
        fields={"image_url"},
        image_url=payload.image_url,
    )


@router.delete(
    "/api/story/games/{game_id}/novel/places/{place_id}",
    response_model=MessageResponse,
)
def delete_story_novel_place_route(
    game_id: int,
    place_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    delete_story_scene_background_impl(
        db=db,
        game=game,
        user=user,
        background_id=place_id,
    )
    return MessageResponse(message="Place deleted")


@router.post(
    "/api/story/games/{game_id}/novel/places/{place_id}/select",
    response_model=StorySceneBackgroundOut,
)
def select_story_novel_place_route(
    game_id: int,
    place_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return select_story_scene_background_impl(db=db, game=game, user=user, background_id=place_id)


@router.post(
    "/api/story/games/{game_id}/novel/places/import",
    response_model=StorySceneBackgroundOut,
)
def import_story_novel_place_route(
    game_id: int,
    payload: StoryPlaceImportRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StorySceneBackgroundOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    return import_story_place_template_impl(
        db=db,
        game=game,
        user=user,
        library_place_id=payload.library_place_id,
        make_current=payload.make_current,
    )


@router.get("/api/story/novel/place-templates", response_model=list[StoryPlaceTemplateOut])
def list_story_place_templates_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryPlaceTemplateOut]:
    user = get_current_user(db, authorization)
    return list_story_place_templates_impl(db=db, user=user)


@router.post(
    "/api/story/novel/place-templates/background/generate",
    response_model=StoryPlaceTemplateOut,
)
def generate_story_place_template_background_route(
    payload: StoryPlaceBackgroundGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlaceTemplateOut:
    user = get_current_user(db, authorization)
    return generate_story_place_template_background_impl(
        db=db,
        user=user,
        title=payload.title,
        description=payload.description,
        style_prompt=payload.style_prompt,
        image_model=payload.image_model,
        triggers=payload.triggers,
        template_id=payload.template_id,
    )


@router.post("/api/story/novel/place-templates", response_model=StoryPlaceTemplateOut)
def create_story_place_template_route(
    payload: StoryPlaceCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlaceTemplateOut:
    user = get_current_user(db, authorization)
    return create_story_place_template_impl(
        db=db,
        user=user,
        title=payload.title,
        triggers=payload.triggers,
        image_url=payload.image_url,
    )


@router.patch("/api/story/novel/place-templates/{template_id}", response_model=StoryPlaceTemplateOut)
def update_story_place_template_route(
    template_id: int,
    payload: StoryPlaceUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlaceTemplateOut:
    user = get_current_user(db, authorization)
    return update_story_place_template_impl(
        db=db,
        user=user,
        template_id=template_id,
        fields=set(payload.model_fields_set),
        title=payload.title,
        triggers=payload.triggers,
        image_url=payload.image_url,
    )


@router.put("/api/story/novel/place-templates/{template_id}/image", response_model=StoryPlaceTemplateOut)
def upload_story_place_template_image_route(
    template_id: int,
    payload: StoryPlaceImageUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryPlaceTemplateOut:
    user = get_current_user(db, authorization)
    return update_story_place_template_impl(
        db=db,
        user=user,
        template_id=template_id,
        fields={"image_url"},
        image_url=payload.image_url,
    )


@router.delete("/api/story/novel/place-templates/{template_id}", response_model=MessageResponse)
def delete_story_place_template_route(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    delete_story_place_template_impl(db=db, user=user, template_id=template_id)
    return MessageResponse(message="Place template deleted")
