from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import StoryCommunityWorldComment, User
from app.schemas import StoryCommunityWorldCommentOut
from app.services.media import normalize_avatar_value, normalize_media_scale

STORY_COMMUNITY_WORLD_COMMENT_MAX_LENGTH = 2_000
STORY_COMMUNITY_WORLD_COMMENT_LIST_LIMIT = 200
USER_AVATAR_SCALE_MIN = 1.0
USER_AVATAR_SCALE_MAX = 3.0
USER_AVATAR_SCALE_DEFAULT = 1.0


def normalize_story_community_world_comment_content(value: str | None) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    if len(normalized) > STORY_COMMUNITY_WORLD_COMMENT_MAX_LENGTH:
        return normalized[:STORY_COMMUNITY_WORLD_COMMENT_MAX_LENGTH].rstrip()
    return normalized


def _resolve_author_name(user: User | None) -> str:
    if user is None:
        return "Unknown"
    if user.display_name and user.display_name.strip():
        return user.display_name.strip()
    return user.email.split("@", maxsplit=1)[0]


def _resolve_author_avatar_scale(user: User | None) -> float:
    if user is None:
        return USER_AVATAR_SCALE_DEFAULT
    return normalize_media_scale(
        user.avatar_scale,
        default=USER_AVATAR_SCALE_DEFAULT,
        min_value=USER_AVATAR_SCALE_MIN,
        max_value=USER_AVATAR_SCALE_MAX,
    )


def story_community_world_comment_to_out(
    comment: StoryCommunityWorldComment,
    *,
    author: User | None,
) -> StoryCommunityWorldCommentOut:
    return StoryCommunityWorldCommentOut(
        id=comment.id,
        world_id=comment.world_id,
        user_id=comment.user_id,
        user_display_name=_resolve_author_name(author),
        user_avatar_url=normalize_avatar_value(author.avatar_url) if author is not None else None,
        user_avatar_scale=_resolve_author_avatar_scale(author),
        content=(comment.content or "").strip(),
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def list_story_community_world_comments_out(
    db: Session,
    *,
    world_id: int,
    limit: int = STORY_COMMUNITY_WORLD_COMMENT_LIST_LIMIT,
) -> list[StoryCommunityWorldCommentOut]:
    normalized_limit = max(1, min(int(limit), 500))
    rows = db.execute(
        select(StoryCommunityWorldComment, User)
        .join(User, User.id == StoryCommunityWorldComment.user_id, isouter=True)
        .where(StoryCommunityWorldComment.world_id == world_id)
        .order_by(StoryCommunityWorldComment.created_at.asc(), StoryCommunityWorldComment.id.asc())
        .limit(normalized_limit)
    ).all()
    return [
        story_community_world_comment_to_out(comment, author=author)
        for comment, author in rows
    ]
