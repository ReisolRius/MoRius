from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cozy.database import get_db
from app.cozy.models import CozyPlayer
from app.cozy.settings import TOKEN_AUDIENCE, settings
from app.security import create_access_token, hash_password, safe_decode_access_token, verify_password

__all__ = [
    "hash_password",
    "verify_password",
    "generate_code",
    "generate_state",
    "issue_token",
    "current_player",
    "normalize_email",
]


def normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def generate_state() -> str:
    return secrets.token_urlsafe(24)


def issue_token(player: CozyPlayer) -> str:
    """A long-lived session for a phone.

    Half a year rather than MoRius's hours: this is a game that is opened for two minutes at a
    time and whose whole promise is that the village is still there. Being asked to type a password
    again because a token expired overnight is the shape of losing a save, whether or not anything
    was lost.
    """
    return create_access_token(
        subject=str(player.id),
        claims={"email": player.email, "app": TOKEN_AUDIENCE},
        expires_delta=timedelta(days=settings.access_token_ttl_days),
    )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def current_player(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CozyPlayer:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Missing authorization token")

    payload = safe_decode_access_token(authorization[7:].strip())
    if not payload:
        raise _unauthorized("Invalid or expired token")

    # The check that keeps the two products from being one. A MoRius token decodes here - same
    # secret, same algorithm - and without this line it would name a Cozy player by a MoRius id.
    if str(payload.get("app", "")) != TOKEN_AUDIENCE:
        raise _unauthorized("Token was not issued for this game")

    try:
        player_id = int(str(payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise _unauthorized("Invalid token payload") from exc

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.id == player_id))
    if player is None:
        raise _unauthorized("Player not found")

    if normalize_email(str(payload.get("email", ""))) != normalize_email(player.email):
        raise _unauthorized("Token does not match player identity")

    if player.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is banned")

    player.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return player
