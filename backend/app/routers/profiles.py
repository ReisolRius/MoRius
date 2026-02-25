from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityWorldFavorite,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryGame,
    User,
    UserFollow,
)
from app.schemas import (
    ProfileFollowStateOut,
    ProfilePrivacyOut,
    ProfilePrivacyUpdateRequest,
    ProfileSubscriptionUserOut,
    ProfileUserOut,
    ProfileViewOut,
)
from app.services.auth_identity import get_current_user
from app.services.media import normalize_avatar_value, normalize_media_scale
from app.services.story_games import STORY_GAME_VISIBILITY_PUBLIC, story_author_name, story_community_world_summary_to_out, story_game_summary_to_out

router = APIRouter()

PROFILE_LIST_LIMIT = 120
AVATAR_SCALE_MIN = 1.0
AVATAR_SCALE_MAX = 3.0
AVATAR_SCALE_DEFAULT = 1.0


def _resolve_user_or_404(db: Session, user_id: int) -> User:
    target_user = db.scalar(select(User).where(User.id == user_id))
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target_user


def _count_followers(db: Session, *, user_id: int) -> int:
    value = db.scalar(
        select(func.count())
        .select_from(UserFollow)
        .where(UserFollow.following_user_id == user_id)
    )
    return int(value or 0)


def _count_subscriptions(db: Session, *, user_id: int) -> int:
    value = db.scalar(
        select(func.count())
        .select_from(UserFollow)
        .where(UserFollow.follower_user_id == user_id)
    )
    return int(value or 0)


def _serialize_privacy(user: User) -> ProfilePrivacyOut:
    return ProfilePrivacyOut(
        show_subscriptions=bool(user.show_subscriptions),
        show_public_worlds=bool(user.show_public_worlds),
        show_private_worlds=bool(user.show_private_worlds),
    )


def _normalize_user_avatar_scale(user: User) -> float:
    return normalize_media_scale(
        user.avatar_scale,
        default=AVATAR_SCALE_DEFAULT,
        min_value=AVATAR_SCALE_MIN,
        max_value=AVATAR_SCALE_MAX,
    )


def _build_profile_user(user: User) -> ProfileUserOut:
    return ProfileUserOut(
        id=user.id,
        display_name=story_author_name(user),
        profile_description=(user.profile_description or "").strip(),
        avatar_url=normalize_avatar_value(user.avatar_url),
        avatar_scale=_normalize_user_avatar_scale(user),
        created_at=user.created_at,
    )


def _list_subscriptions(db: Session, *, user_id: int) -> list[ProfileSubscriptionUserOut]:
    rows = db.execute(
        select(UserFollow, User)
        .join(User, User.id == UserFollow.following_user_id)
        .where(UserFollow.follower_user_id == user_id)
        .order_by(UserFollow.created_at.desc(), UserFollow.id.desc())
        .limit(PROFILE_LIST_LIMIT)
    ).all()
    if not rows:
        return []

    return [
        ProfileSubscriptionUserOut(
            id=followed_user.id,
            display_name=story_author_name(followed_user),
            avatar_url=normalize_avatar_value(followed_user.avatar_url),
            avatar_scale=_normalize_user_avatar_scale(followed_user),
        )
        for _, followed_user in rows
    ]


def _load_world_rating_by_id(db: Session, *, viewer_user_id: int, world_ids: list[int]) -> dict[int, int]:
    rating_rows = db.scalars(
        select(StoryCommunityWorldRating).where(
            StoryCommunityWorldRating.user_id == viewer_user_id,
            StoryCommunityWorldRating.world_id.in_(world_ids),
        )
    ).all()
    return {row.world_id: int(row.rating) for row in rating_rows}


def _load_reported_world_ids(db: Session, *, viewer_user_id: int, world_ids: list[int]) -> set[int]:
    report_rows = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.reporter_user_id == viewer_user_id,
            StoryCommunityWorldReport.world_id.in_(world_ids),
        )
    ).all()
    return {row.world_id for row in report_rows}


def _load_favorited_world_ids(db: Session, *, viewer_user_id: int, world_ids: list[int]) -> set[int]:
    favorite_rows = db.scalars(
        select(StoryCommunityWorldFavorite).where(
            StoryCommunityWorldFavorite.user_id == viewer_user_id,
            StoryCommunityWorldFavorite.world_id.in_(world_ids),
        )
    ).all()
    return {row.world_id for row in favorite_rows}


def _list_published_worlds(
    db: Session,
    *,
    owner_user: User,
    viewer_user_id: int,
) -> list:
    worlds = db.scalars(
        select(StoryGame)
        .where(
            StoryGame.user_id == owner_user.id,
            StoryGame.visibility == STORY_GAME_VISIBILITY_PUBLIC,
            StoryGame.source_world_id.is_(None),
        )
        .order_by(StoryGame.updated_at.desc(), StoryGame.id.desc())
        .limit(PROFILE_LIST_LIMIT)
    ).all()
    if not worlds:
        return []

    world_ids = [world.id for world in worlds]
    user_rating_by_world_id = _load_world_rating_by_id(db, viewer_user_id=viewer_user_id, world_ids=world_ids)
    reported_world_ids = _load_reported_world_ids(db, viewer_user_id=viewer_user_id, world_ids=world_ids)
    favorited_world_ids = _load_favorited_world_ids(db, viewer_user_id=viewer_user_id, world_ids=world_ids)
    author_name = story_author_name(owner_user)
    author_avatar_url = normalize_avatar_value(owner_user.avatar_url)

    return [
        story_community_world_summary_to_out(
            world,
            author_id=owner_user.id,
            author_name=author_name,
            author_avatar_url=author_avatar_url,
            user_rating=user_rating_by_world_id.get(world.id),
            is_reported_by_user=world.id in reported_world_ids,
            is_favorited_by_user=world.id in favorited_world_ids,
        )
        for world in worlds
    ]


def _list_unpublished_worlds(db: Session, *, owner_user_id: int) -> list:
    worlds = db.scalars(
        select(StoryGame)
        .where(
            StoryGame.user_id == owner_user_id,
            StoryGame.visibility != STORY_GAME_VISIBILITY_PUBLIC,
        )
        .order_by(StoryGame.updated_at.desc(), StoryGame.id.desc())
        .limit(PROFILE_LIST_LIMIT)
    ).all()
    return [story_game_summary_to_out(world) for world in worlds]


def _build_profile_view(db: Session, *, viewer_user: User, target_user: User) -> ProfileViewOut:
    is_self = viewer_user.id == target_user.id
    privacy = _serialize_privacy(target_user)

    can_view_subscriptions = is_self or privacy.show_subscriptions
    can_view_public_worlds = is_self or privacy.show_public_worlds
    can_view_private_worlds = is_self or privacy.show_private_worlds

    is_following = False
    if not is_self:
        is_following = db.scalar(
            select(UserFollow.id).where(
                UserFollow.follower_user_id == viewer_user.id,
                UserFollow.following_user_id == target_user.id,
            )
        ) is not None

    followers_count = _count_followers(db, user_id=target_user.id)
    subscriptions_count = _count_subscriptions(db, user_id=target_user.id)

    subscriptions = _list_subscriptions(db, user_id=target_user.id) if can_view_subscriptions else []
    published_worlds = _list_published_worlds(db, owner_user=target_user, viewer_user_id=viewer_user.id) if can_view_public_worlds else []
    unpublished_worlds = _list_unpublished_worlds(db, owner_user_id=target_user.id) if can_view_private_worlds else []

    return ProfileViewOut(
        user=_build_profile_user(target_user),
        is_self=is_self,
        is_following=is_following,
        followers_count=followers_count,
        subscriptions_count=subscriptions_count,
        privacy=privacy,
        can_view_subscriptions=can_view_subscriptions,
        can_view_public_worlds=can_view_public_worlds,
        can_view_private_worlds=can_view_private_worlds,
        subscriptions=subscriptions,
        published_worlds=published_worlds,
        unpublished_worlds=unpublished_worlds,
    )


def _build_follow_state(
    db: Session,
    *,
    viewer_user_id: int,
    target_user_id: int,
) -> ProfileFollowStateOut:
    is_following = db.scalar(
        select(UserFollow.id).where(
            UserFollow.follower_user_id == viewer_user_id,
            UserFollow.following_user_id == target_user_id,
        )
    ) is not None
    return ProfileFollowStateOut(
        is_following=is_following,
        followers_count=_count_followers(db, user_id=target_user_id),
        subscriptions_count=_count_subscriptions(db, user_id=viewer_user_id),
    )


@router.get("/api/auth/profiles/me", response_model=ProfileViewOut)
def get_my_profile(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ProfileViewOut:
    viewer_user = get_current_user(db, authorization)
    return _build_profile_view(db, viewer_user=viewer_user, target_user=viewer_user)


@router.get("/api/auth/profiles/{user_id}", response_model=ProfileViewOut)
def get_user_profile(
    user_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ProfileViewOut:
    viewer_user = get_current_user(db, authorization)
    target_user = _resolve_user_or_404(db, user_id)
    return _build_profile_view(db, viewer_user=viewer_user, target_user=target_user)


@router.patch("/api/auth/profiles/me/privacy", response_model=ProfilePrivacyOut)
def update_my_profile_privacy(
    payload: ProfilePrivacyUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ProfilePrivacyOut:
    user = get_current_user(db, authorization)
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one privacy setting should be provided",
        )

    if "show_subscriptions" in payload.model_fields_set:
        user.show_subscriptions = bool(payload.show_subscriptions)
    if "show_public_worlds" in payload.model_fields_set:
        user.show_public_worlds = bool(payload.show_public_worlds)
    if "show_private_worlds" in payload.model_fields_set:
        user.show_private_worlds = bool(payload.show_private_worlds)

    db.commit()
    db.refresh(user)
    return _serialize_privacy(user)


@router.post("/api/auth/profiles/{user_id}/follow", response_model=ProfileFollowStateOut)
def follow_user_profile(
    user_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ProfileFollowStateOut:
    viewer_user = get_current_user(db, authorization)
    if viewer_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot follow your own profile",
        )
    _resolve_user_or_404(db, user_id)

    existing_follow = db.scalar(
        select(UserFollow).where(
            UserFollow.follower_user_id == viewer_user.id,
            UserFollow.following_user_id == user_id,
        )
    )
    if existing_follow is None:
        db.add(
            UserFollow(
                follower_user_id=viewer_user.id,
                following_user_id=user_id,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

    return _build_follow_state(db, viewer_user_id=viewer_user.id, target_user_id=user_id)


@router.delete("/api/auth/profiles/{user_id}/follow", response_model=ProfileFollowStateOut)
def unfollow_user_profile(
    user_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ProfileFollowStateOut:
    viewer_user = get_current_user(db, authorization)
    if viewer_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot unfollow your own profile",
        )
    _resolve_user_or_404(db, user_id)

    existing_follow = db.scalar(
        select(UserFollow).where(
            UserFollow.follower_user_id == viewer_user.id,
            UserFollow.following_user_id == user_id,
        )
    )
    if existing_follow is not None:
        db.delete(existing_follow)
        db.commit()

    return _build_follow_state(db, viewer_user_id=viewer_user.id, target_user_id=user_id)
