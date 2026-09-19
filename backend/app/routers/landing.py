from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryCharacter, StoryGame, User
from app.schemas import LandingShowcaseOut
from app.services.media import resolve_media_display_url

router = APIRouter()

# The avatar stack on the presentation page. Enough faces to fill the row on a wide screen
# without turning the endpoint into a user directory.
LANDING_AVATAR_LIMIT = 12


@router.get("/api/public/landing/showcase", response_model=LandingShowcaseOut)
def read_landing_showcase(db: Session = Depends(get_db)) -> LandingShowcaseOut:
    """Public counters and avatars for the presentation page.

    Deliberately anonymous: only the avatar image URL is returned, never a name, email or id.
    The page shows a stack of faces, so it needs pictures and nothing else.
    """
    # Guests are passers-by, not players: a counter they inflate would claim more than is true.
    players = int(
        db.execute(
            select(func.count()).select_from(User).where(User.is_banned.is_(False), User.is_guest.is_(False))
        ).scalar()
        or 0
    )
    worlds = int(db.execute(select(func.count()).select_from(StoryGame)).scalar() or 0)
    characters = int(db.execute(select(func.count()).select_from(StoryCharacter)).scalar() or 0)

    # Newest first so the row keeps changing as people join, and only users who actually set a
    # picture - a stack of fallback initials is what the mockup already had.
    candidates = (
        db.execute(
            select(User)
            .where(User.is_banned.is_(False))
            .where(User.is_guest.is_(False))
            .where(User.avatar_url.is_not(None))
            .where(User.avatar_url != "")
            .order_by(User.id.desc())
            .limit(LANDING_AVATAR_LIMIT * 4)
        )
        .scalars()
        .all()
    )

    avatars: list[str] = []
    for user in candidates:
        if len(avatars) >= LANDING_AVATAR_LIMIT:
            break
        url = resolve_media_display_url(
            getattr(user, "avatar_url", None),
            kind="user-avatar",
            entity_id=int(user.id),
            version=getattr(user, "updated_at", None),
        )
        if url:
            avatars.append(url)

    return LandingShowcaseOut(players=players, worlds=worlds, characters=characters, avatars=avatars)
