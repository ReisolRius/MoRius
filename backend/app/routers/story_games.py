from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryCommunityWorldRatingRequest,
    StoryCommunityWorldSummaryOut,
    StoryGameCreateRequest,
    StoryGameMetaUpdateRequest,
    StoryGameSettingsUpdateRequest,
    StoryGameSummaryOut,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import (
    apply_story_world_rating_insert,
    apply_story_world_rating_update,
    increment_story_world_launches,
)
from app.services.story_games import (
    STORY_DEFAULT_TITLE,
    STORY_GAME_VISIBILITY_PRIVATE,
    clone_story_world_cards_to_game,
    coerce_story_llm_model,
    coerce_story_game_age_rating,
    deserialize_story_game_genres,
    normalize_story_context_limit_chars,
    normalize_story_cover_image_url,
    normalize_story_cover_position,
    normalize_story_cover_scale,
    normalize_story_game_age_rating,
    normalize_story_game_description,
    normalize_story_game_genres,
    normalize_story_game_opening_scene,
    normalize_story_game_visibility,
    normalize_story_llm_model,
    normalize_story_memory_optimization_enabled,
    normalize_story_top_k,
    normalize_story_top_r,
    serialize_story_game_genres,
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_out,
)
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    touch_story_game,
)

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/api/story/games", response_model=list[StoryGameSummaryOut])
def list_story_games(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryGameSummaryOut]:
    user = get_current_user(db, authorization)
    games = db.scalars(
        select(StoryGame)
        .where(StoryGame.user_id == user.id)
        .order_by(StoryGame.last_activity_at.desc(), StoryGame.id.desc())
    ).all()
    return [story_game_summary_to_out(game) for game in games]


@router.get("/api/story/community/worlds", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_worlds(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
    worlds = db.scalars(
        select(StoryGame)
        .where(
            StoryGame.visibility == "public",
            StoryGame.source_world_id.is_(None),
        )
        .order_by(
            StoryGame.community_launches.desc(),
            StoryGame.community_views.desc(),
            StoryGame.community_rating_count.desc(),
            StoryGame.id.desc(),
        )
        .limit(60)
    ).all()
    if not worlds:
        return []

    world_ids = [world.id for world in worlds]
    author_ids = sorted({world.user_id for world in worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            user_rating=user_rating_by_world_id.get(world.id),
        )
        for world in worlds
    ]


@router.post("/api/story/community/worlds/{world_id}/launch", response_model=StoryGameSummaryOut)
def launch_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    title = world.title.strip() or STORY_DEFAULT_TITLE

    cloned_game = StoryGame(
        user_id=user.id,
        title=title,
        description=world.description or "",
        opening_scene=world.opening_scene or "",
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(world.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(world.genres)),
        cover_image_url=normalize_story_cover_image_url(world.cover_image_url),
        cover_scale=normalize_story_cover_scale(world.cover_scale),
        cover_position_x=normalize_story_cover_position(world.cover_position_x),
        cover_position_y=normalize_story_cover_position(world.cover_position_y),
        source_world_id=world.id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(world.context_limit_chars),
        story_llm_model=coerce_story_llm_model(getattr(world, "story_llm_model", None)),
        memory_optimization_enabled=bool(getattr(world, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(world, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(world, "story_top_r", None)),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    clone_story_world_cards_to_game(
        db,
        source_world_id=world.id,
        target_game_id=cloned_game.id,
    )

    launch_inserted = False
    try:
        with db.begin_nested():
            db.add(
                StoryCommunityWorldLaunch(
                    world_id=world.id,
                    user_id=user.id,
                )
            )
            db.flush()
        launch_inserted = True
    except IntegrityError:
        launch_inserted = False

    if launch_inserted:
        increment_story_world_launches(db, world.id)
    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return story_game_summary_to_out(cloned_game)


@router.post("/api/story/community/worlds/{world_id}/rating", response_model=StoryCommunityWorldSummaryOut)
def rate_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldRatingRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    rating_value = int(payload.rating)

    existing_rating = db.scalar(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == world.id,
            StoryCommunityWorldRating.user_id == user.id,
        )
    )
    if existing_rating is None:
        inserted_rating: StoryCommunityWorldRating | None = None
        try:
            with db.begin_nested():
                inserted_rating = StoryCommunityWorldRating(
                    world_id=world.id,
                    user_id=user.id,
                    rating=rating_value,
                )
                db.add(inserted_rating)
                db.flush()
            apply_story_world_rating_insert(db, world.id, rating_value)
            existing_rating = inserted_rating
        except IntegrityError:
            existing_rating = db.scalar(
                select(StoryCommunityWorldRating).where(
                    StoryCommunityWorldRating.world_id == world.id,
                    StoryCommunityWorldRating.user_id == user.id,
                )
            )

    if existing_rating is not None:
        previous_rating = int(existing_rating.rating)
        if previous_rating != rating_value:
            existing_rating.rating = rating_value
            apply_story_world_rating_update(db, world.id, rating_value - previous_rating)

    db.commit()
    db.refresh(world)
    author = db.scalar(select(User).where(User.id == world.user_id))
    return story_community_world_summary_to_out(
        world,
        author_name=story_author_name(author),
        user_rating=rating_value,
    )


@router.post("/api/story/games", response_model=StoryGameSummaryOut)
def create_story_game(
    payload: StoryGameCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    title = payload.title.strip() if payload.title else STORY_DEFAULT_TITLE
    if not title:
        title = STORY_DEFAULT_TITLE
    description = normalize_story_game_description(payload.description)
    opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    visibility = normalize_story_game_visibility(payload.visibility)
    age_rating = normalize_story_game_age_rating(payload.age_rating)
    genres = normalize_story_game_genres(payload.genres)
    cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    cover_scale = normalize_story_cover_scale(payload.cover_scale)
    cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    cover_position_y = normalize_story_cover_position(payload.cover_position_y)
    context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    memory_optimization_enabled = normalize_story_memory_optimization_enabled(payload.memory_optimization_enabled)
    story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(payload.story_top_r)

    game = StoryGame(
        user_id=user.id,
        title=title,
        description=description,
        opening_scene=opening_scene,
        visibility=visibility,
        age_rating=age_rating,
        genres=serialize_story_game_genres(genres),
        cover_image_url=cover_image_url,
        cover_scale=cover_scale,
        cover_position_x=cover_position_x,
        cover_position_y=cover_position_y,
        source_world_id=None,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=context_limit_chars,
        story_llm_model=story_llm_model,
        memory_optimization_enabled=memory_optimization_enabled,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.patch("/api/story/games/{game_id}/settings", response_model=StoryGameSummaryOut)
def update_story_game_settings(
    game_id: int,
    payload: StoryGameSettingsUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)
    if payload.context_limit_chars is not None:
        game.context_limit_chars = normalize_story_context_limit_chars(payload.context_limit_chars)
    if payload.story_llm_model is not None:
        game.story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    if payload.memory_optimization_enabled is not None:
        game.memory_optimization_enabled = bool(payload.memory_optimization_enabled)
    if payload.story_top_k is not None:
        game.story_top_k = normalize_story_top_k(payload.story_top_k)
    if payload.story_top_r is not None:
        game.story_top_r = normalize_story_top_r(payload.story_top_r)
    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.patch("/api/story/games/{game_id}/meta", response_model=StoryGameSummaryOut)
def update_story_game_meta(
    game_id: int,
    payload: StoryGameMetaUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    if payload.title is not None:
        normalized_title = payload.title.strip()
        game.title = normalized_title or STORY_DEFAULT_TITLE
    if payload.description is not None:
        game.description = normalize_story_game_description(payload.description)
    if payload.opening_scene is not None:
        game.opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    if payload.visibility is not None:
        game.visibility = normalize_story_game_visibility(payload.visibility)
    if payload.age_rating is not None:
        game.age_rating = normalize_story_game_age_rating(payload.age_rating)
    if payload.genres is not None:
        game.genres = serialize_story_game_genres(normalize_story_game_genres(payload.genres))
    if payload.cover_image_url is not None:
        game.cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    if payload.cover_scale is not None:
        game.cover_scale = normalize_story_cover_scale(payload.cover_scale)
    if payload.cover_position_x is not None:
        game.cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    if payload.cover_position_y is not None:
        game.cover_position_y = normalize_story_cover_position(payload.cover_position_y)

    touch_story_game(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.delete("/api/story/games/{game_id}", response_model=MessageResponse)
def delete_story_game(
    game_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    game = get_user_story_game_or_404(db, user.id, game_id)

    db.execute(
        sa_delete(StoryWorldCardChangeEvent).where(
            StoryWorldCardChangeEvent.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCardChangeEvent).where(
            StoryPlotCardChangeEvent.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryMessage).where(
            StoryMessage.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryInstructionCard).where(
            StoryInstructionCard.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryPlotCard).where(
            StoryPlotCard.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryWorldCard).where(
            StoryWorldCard.game_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.world_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldView).where(
            StoryCommunityWorldView.world_id == game.id,
        )
    )
    db.delete(game)
    db.commit()
    return MessageResponse(message="Game deleted")
