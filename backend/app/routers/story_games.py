from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldReport,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMessage,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryCommunityWorldCommentCreateRequest,
    StoryCommunityWorldCommentOut,
    StoryCommunityWorldCommentUpdateRequest,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryCommunityWorldSummaryOut,
    StoryGameCloneRequest,
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
    coerce_story_image_model,
    coerce_story_game_age_rating,
    deserialize_story_game_genres,
    normalize_story_ambient_enabled,
    normalize_story_context_limit_chars,
    normalize_story_cover_image_url,
    normalize_story_cover_position,
    normalize_story_cover_scale,
    normalize_story_response_max_tokens,
    normalize_story_response_max_tokens_enabled,
    normalize_story_game_age_rating,
    normalize_story_game_description,
    normalize_story_game_genres,
    normalize_story_image_style_prompt,
    normalize_story_image_model,
    normalize_story_game_opening_scene,
    normalize_story_game_visibility,
    normalize_story_llm_model,
    normalize_story_memory_optimization_enabled,
    normalize_story_top_k,
    normalize_story_top_r,
    serialize_story_game_genres,
    story_author_avatar_url,
    story_author_name,
    story_community_world_summary_to_out,
    story_game_summary_to_out,
)
from app.services.story_queries import (
    get_public_story_world_or_404,
    get_user_story_game_or_404,
    list_story_messages,
    touch_story_game,
)
from app.services.story_world_comments import (
    list_story_community_world_comments_out,
    normalize_story_community_world_comment_content,
    story_community_world_comment_to_out,
)

router = APIRouter()

STORY_WORLD_REPORT_STATUS_OPEN = "open"
STORY_GAME_TITLE_MAX_LENGTH = 160
STORY_CLONE_TITLE_SUFFIX = " (копия)"
PRIVILEGED_WORLD_COMMENT_ROLES = {"administrator", "moderator"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _build_story_clone_title(source_title: str) -> str:
    normalized_source_title = source_title.strip() or STORY_DEFAULT_TITLE
    max_base_length = STORY_GAME_TITLE_MAX_LENGTH - len(STORY_CLONE_TITLE_SUFFIX)
    trimmed_source_title = normalized_source_title[: max(max_base_length, 0)].rstrip()
    if not trimmed_source_title:
        trimmed_source_title = STORY_DEFAULT_TITLE[: max(max_base_length, 0)].rstrip() or STORY_DEFAULT_TITLE
    return f"{trimmed_source_title}{STORY_CLONE_TITLE_SUFFIX}"[:STORY_GAME_TITLE_MAX_LENGTH]


def _build_story_community_world_summary(
    db: Session,
    *,
    user_id: int,
    world: StoryGame,
    user_rating_override: int | None = None,
    is_reported_by_user_override: bool | None = None,
    is_favorited_by_user_override: bool | None = None,
) -> StoryCommunityWorldSummaryOut:
    author = db.scalar(select(User).where(User.id == world.user_id))

    if user_rating_override is None:
        user_rating_value = db.scalar(
            select(StoryCommunityWorldRating.rating).where(
                StoryCommunityWorldRating.world_id == world.id,
                StoryCommunityWorldRating.user_id == user_id,
            )
        )
        user_rating = int(user_rating_value) if user_rating_value is not None else None
    else:
        user_rating = int(user_rating_override)

    if is_reported_by_user_override is None:
        user_report_id = db.scalar(
            select(StoryCommunityWorldReport.id).where(
                StoryCommunityWorldReport.world_id == world.id,
                StoryCommunityWorldReport.reporter_user_id == user_id,
            )
        )
        is_reported_by_user = user_report_id is not None
    else:
        is_reported_by_user = bool(is_reported_by_user_override)

    if is_favorited_by_user_override is None:
        user_favorite_id = db.scalar(
            select(StoryCommunityWorldFavorite.id).where(
                StoryCommunityWorldFavorite.world_id == world.id,
                StoryCommunityWorldFavorite.user_id == user_id,
            )
        )
        is_favorited_by_user = user_favorite_id is not None
    else:
        is_favorited_by_user = bool(is_favorited_by_user_override)

    return story_community_world_summary_to_out(
        world,
        author_id=world.user_id,
        author_name=story_author_name(author),
        author_avatar_url=story_author_avatar_url(author),
        user_rating=user_rating,
        is_reported_by_user=is_reported_by_user,
        is_favorited_by_user=is_favorited_by_user,
    )


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
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}
    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}
    user_favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.user_id == user.id,
            StoryCommunityWorldFavorite.world_id.in_(world_ids),
        )
    ).all()
    favorited_world_ids = {row.world_id for row in user_favorite_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=world.id in favorited_world_ids,
        )
        for world in worlds
    ]


@router.get("/api/story/community/favorites", response_model=list[StoryCommunityWorldSummaryOut])
def list_story_community_favorites(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldSummaryOut]:
    user = get_current_user(db, authorization)
    favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite)
        .where(StoryCommunityWorldFavorite.user_id == user.id)
        .order_by(StoryCommunityWorldFavorite.created_at.desc(), StoryCommunityWorldFavorite.id.desc())
        .limit(120)
    ).all()
    if not favorite_rows:
        return []

    ordered_world_ids: list[int] = []
    seen_world_ids: set[int] = set()
    for row in favorite_rows:
        world_id = int(row.world_id)
        if world_id in seen_world_ids:
            continue
        seen_world_ids.add(world_id)
        ordered_world_ids.append(world_id)

    worlds = db.scalars(
        select(StoryGame).where(
            StoryGame.id.in_(ordered_world_ids),
            StoryGame.visibility == "public",
            StoryGame.source_world_id.is_(None),
        )
    ).all()
    if not worlds:
        return []

    world_by_id = {world.id: world for world in worlds}
    ordered_worlds = [world_by_id[world_id] for world_id in ordered_world_ids if world_id in world_by_id]
    if not ordered_worlds:
        return []

    world_ids = [world.id for world in ordered_worlds]
    author_ids = sorted({world.user_id for world in ordered_worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == user.id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    user_rating_by_world_id = {row.world_id: int(row.rating) for row in user_rating_rows}

    user_report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == user.id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    reported_world_ids = {row.world_id for row in user_report_rows}

    return [
        story_community_world_summary_to_out(
            world,
            author_id=world.user_id,
            author_name=author_name_by_id.get(world.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(world.user_id),
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=True,
        )
        for world in ordered_worlds
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
        response_max_tokens=normalize_story_response_max_tokens(getattr(world, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(world, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(world, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(world, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(world, "image_style_prompt", None)),
        memory_optimization_enabled=bool(getattr(world, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(world, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(world, "story_top_r", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(world, "ambient_enabled", None)),
        ambient_profile=str(getattr(world, "ambient_profile", "") or ""),
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
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        user_rating_override=rating_value,
    )


@router.post("/api/story/community/worlds/{world_id}/report", response_model=StoryCommunityWorldSummaryOut)
def report_story_community_world(
    world_id: int,
    payload: StoryCommunityWorldReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report description should not be empty",
        )

    existing_report_id = db.scalar(
        select(StoryCommunityWorldReport.id).where(
            StoryCommunityWorldReport.world_id == world.id,
            StoryCommunityWorldReport.reporter_user_id == user.id,
        )
    )
    if existing_report_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        )

    db.add(
        StoryCommunityWorldReport(
            world_id=world.id,
            reporter_user_id=user.id,
            reason=payload.reason,
            description=description,
            status=STORY_WORLD_REPORT_STATUS_OPEN,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this world",
        ) from None

    db.refresh(world)
    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_reported_by_user_override=True,
    )


@router.get("/api/story/community/worlds/{world_id}/comments", response_model=list[StoryCommunityWorldCommentOut])
def list_story_community_world_comments(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityWorldCommentOut]:
    get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    return list_story_community_world_comments_out(db, world_id=world.id)


@router.post("/api/story/community/worlds/{world_id}/comments", response_model=StoryCommunityWorldCommentOut)
def create_story_community_world_comment(
    world_id: int,
    payload: StoryCommunityWorldCommentCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment = StoryCommunityWorldComment(
        world_id=world.id,
        user_id=user.id,
        content=content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.patch("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=StoryCommunityWorldCommentOut)
def update_story_community_world_comment(
    world_id: int,
    comment_id: int,
    payload: StoryCommunityWorldCommentUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldCommentOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit this comment")

    content = normalize_story_community_world_comment_content(payload.content)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment should not be empty",
        )

    comment.content = content
    db.commit()
    db.refresh(comment)
    return story_community_world_comment_to_out(comment, author=user)


@router.delete("/api/story/community/worlds/{world_id}/comments/{comment_id}", response_model=MessageResponse)
def delete_story_community_world_comment(
    world_id: int,
    comment_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    comment = db.scalar(
        select(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.id == comment_id,
            StoryCommunityWorldComment.world_id == world.id,
        )
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id and user.role not in PRIVILEGED_WORLD_COMMENT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this comment")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="Comment deleted")


@router.post("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def favorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    existing_favorite_id = db.scalar(
        select(StoryCommunityWorldFavorite.id).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if existing_favorite_id is None:
        db.add(
            StoryCommunityWorldFavorite(
                world_id=world.id,
                user_id=user.id,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=True,
    )


@router.delete("/api/story/community/worlds/{world_id}/favorite", response_model=StoryCommunityWorldSummaryOut)
def unfavorite_story_community_world(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityWorldSummaryOut:
    user = get_current_user(db, authorization)
    world = get_public_story_world_or_404(db, world_id)
    favorite_row = db.scalar(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == world.id,
            StoryCommunityWorldFavorite.user_id == user.id,
        )
    )
    if favorite_row is not None:
        db.delete(favorite_row)
        db.commit()

    return _build_story_community_world_summary(
        db,
        user_id=user.id,
        world=world,
        is_favorited_by_user_override=False,
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
    response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(payload.response_max_tokens_enabled)
    story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    image_model = normalize_story_image_model(payload.image_model)
    image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    memory_optimization_enabled = normalize_story_memory_optimization_enabled(payload.memory_optimization_enabled)
    story_top_k = normalize_story_top_k(payload.story_top_k)
    story_top_r = normalize_story_top_r(payload.story_top_r)
    ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)

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
        response_max_tokens=response_max_tokens,
        response_max_tokens_enabled=response_max_tokens_enabled,
        story_llm_model=story_llm_model,
        image_model=image_model,
        image_style_prompt=image_style_prompt,
        memory_optimization_enabled=memory_optimization_enabled,
        story_top_k=story_top_k,
        story_top_r=story_top_r,
        ambient_enabled=ambient_enabled,
        ambient_profile="",
        last_activity_at=_utcnow(),
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return story_game_summary_to_out(game)


@router.post("/api/story/games/{game_id}/clone", response_model=StoryGameSummaryOut)
def clone_story_game(
    game_id: int,
    payload: StoryGameCloneRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryGameSummaryOut:
    user = get_current_user(db, authorization)
    source_game = get_user_story_game_or_404(db, user.id, game_id)

    cloned_game = StoryGame(
        user_id=user.id,
        title=_build_story_clone_title(source_game.title or ""),
        description=normalize_story_game_description(source_game.description),
        opening_scene=normalize_story_game_opening_scene(source_game.opening_scene),
        visibility=STORY_GAME_VISIBILITY_PRIVATE,
        age_rating=coerce_story_game_age_rating(source_game.age_rating),
        genres=serialize_story_game_genres(deserialize_story_game_genres(source_game.genres)),
        cover_image_url=normalize_story_cover_image_url(source_game.cover_image_url),
        cover_scale=normalize_story_cover_scale(source_game.cover_scale),
        cover_position_x=normalize_story_cover_position(source_game.cover_position_x),
        cover_position_y=normalize_story_cover_position(source_game.cover_position_y),
        source_world_id=source_game.source_world_id,
        community_views=0,
        community_launches=0,
        community_rating_sum=0,
        community_rating_count=0,
        context_limit_chars=normalize_story_context_limit_chars(source_game.context_limit_chars),
        response_max_tokens=normalize_story_response_max_tokens(getattr(source_game, "response_max_tokens", None)),
        response_max_tokens_enabled=normalize_story_response_max_tokens_enabled(
            getattr(source_game, "response_max_tokens_enabled", None)
        ),
        story_llm_model=coerce_story_llm_model(getattr(source_game, "story_llm_model", None)),
        image_model=coerce_story_image_model(getattr(source_game, "image_model", None)),
        image_style_prompt=normalize_story_image_style_prompt(getattr(source_game, "image_style_prompt", None)),
        memory_optimization_enabled=bool(getattr(source_game, "memory_optimization_enabled", True)),
        story_top_k=normalize_story_top_k(getattr(source_game, "story_top_k", None)),
        story_top_r=normalize_story_top_r(getattr(source_game, "story_top_r", None)),
        ambient_enabled=normalize_story_ambient_enabled(getattr(source_game, "ambient_enabled", None)),
        ambient_profile=str(getattr(source_game, "ambient_profile", "") or ""),
        last_activity_at=_utcnow(),
    )
    db.add(cloned_game)
    db.flush()

    clone_story_world_cards_to_game(
        db,
        source_world_id=source_game.id,
        target_game_id=cloned_game.id,
        copy_instructions=payload.copy_instructions,
        copy_plot=payload.copy_plot,
        copy_world=payload.copy_world,
        copy_main_hero=payload.copy_main_hero,
    )

    if payload.copy_history:
        source_messages = list_story_messages(db, source_game.id)
        for message in source_messages:
            db.add(
                StoryMessage(
                    game_id=cloned_game.id,
                    role=message.role,
                    content=message.content,
                )
            )

    touch_story_game(cloned_game)
    db.commit()
    db.refresh(cloned_game)
    return story_game_summary_to_out(cloned_game)


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
    if payload.response_max_tokens is not None:
        game.response_max_tokens = normalize_story_response_max_tokens(payload.response_max_tokens)
    if payload.response_max_tokens_enabled is not None:
        game.response_max_tokens_enabled = normalize_story_response_max_tokens_enabled(
            payload.response_max_tokens_enabled
        )
    if payload.story_llm_model is not None:
        game.story_llm_model = normalize_story_llm_model(payload.story_llm_model)
    if payload.image_model is not None:
        game.image_model = normalize_story_image_model(payload.image_model)
    if payload.image_style_prompt is not None:
        game.image_style_prompt = normalize_story_image_style_prompt(payload.image_style_prompt)
    if payload.memory_optimization_enabled is not None:
        game.memory_optimization_enabled = bool(payload.memory_optimization_enabled)
    if payload.story_top_k is not None:
        game.story_top_k = normalize_story_top_k(payload.story_top_k)
    if payload.story_top_r is not None:
        game.story_top_r = normalize_story_top_r(payload.story_top_r)
    if payload.ambient_enabled is not None:
        game.ambient_enabled = normalize_story_ambient_enabled(payload.ambient_enabled)
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
        sa_delete(StoryTurnImage).where(
            StoryTurnImage.game_id == game.id,
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
        sa_delete(StoryCommunityWorldComment).where(
            StoryCommunityWorldComment.world_id == game.id,
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
    db.execute(
        sa_delete(StoryCommunityWorldLaunch).where(
            StoryCommunityWorldLaunch.world_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.world_id == game.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == game.id,
        )
    )
    db.delete(game)
    db.commit()
    return MessageResponse(message="Game deleted")
