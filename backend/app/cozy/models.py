from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.cozy.database import CozyBase


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CozyPlayer(CozyBase):
    """One account in the game.

    Not a MoRius user, and the table name says so. The same person may hold both; they are two
    accounts on purpose, and the only thing they will ever share is an address in the email column
    of two different databases.
    """

    __tablename__ = "cozy_players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)

    # Empty for an account that has only ever come in through Google. Setting a password later is
    # what the reset flow does, and it is what turns such an account into both at once.
    password_hash: Mapped[str] = mapped_column(String(255), default="", nullable=False)

    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)

    display_name: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    auth_provider: Mapped[str] = mapped_column(String(32), default="email", nullable=False)

    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class CozyEmailCode(CozyBase):
    """A six-digit code in flight.

    One row per address per purpose, overwritten by every resend: a code that is still valid after
    a newer one has been sent is a code somebody can be talked into reading out.

    The password being registered waits here too, hashed. It has nowhere else to be - the account
    does not exist until the code comes back - and storing it hashed means an abandoned
    registration leaves nothing readable behind.
    """

    __tablename__ = "cozy_email_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)

    # "register" or "reset". Two codes for one address can be in flight at once and they must not
    # be interchangeable: a registration code that also resets a password is a way in.
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)

    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), default="", nullable=False)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts_left: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (Index("ix_cozy_email_codes_email_purpose", "email", "purpose", unique=True),)


class CozySave(CozyBase):
    """The village, as the game wrote it.

    Opaque on purpose. The client already serialises its whole state to one checksummed string and
    already knows how to migrate an old one; a server that parsed it would be a second reader of
    that format, and a second reader is a second thing that has to be updated on the day a field
    is added. What the server does keep outside the blob is only what it needs to answer "which of
    these two saves is further along" without opening either.
    """

    __tablename__ = "cozy_saves"

    player_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cozy_players.id", ondelete="CASCADE"), primary_key=True
    )

    payload: Mapped[str] = mapped_column(Text, nullable=False)

    save_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # How long this village has been played, in seconds, and the wall clock it was written on.
    # Together they are the whole conflict rule: the further-along save wins.
    play_seconds: Mapped[float] = mapped_column(BigInteger, default=0, nullable=False)
    saved_at_unix: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # Goes up on every accepted write. The client sends back the one it holds, which is how a
    # second device that has been offline for a week finds out it is behind rather than silently
    # flattening the week.
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class CozyGoogleLogin(CozyBase):
    """One trip out to the browser and back.

    The phone has no Google SDK in it - the sign-in happens in the system browser and comes back
    to this server, not to the app. So the app is given a one-time ticket before it opens the
    browser and asks about that ticket afterwards; this row is the ticket. Single use, short
    lived, and it holds the finished token for exactly as long as it takes the app to ask.
    """

    __tablename__ = "cozy_google_logins"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # "pending", "ready" or "failed".
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    access_token: Mapped[str] = mapped_column(Text, default="", nullable=False)
    player_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class CozyPurchase(CozyBase):
    """Money that has been taken, and gems that have not been handed over yet.

    The gems live in the save on the phone, so a payment cannot simply add them to a column here.
    What the server owns is the entitlement: paid, and not yet collected. The game collects it on
    the next launch it manages to make - which is also what makes a purchase survive the player
    closing the app on the payment page, or reinstalling before the receipt arrives.
    """

    __tablename__ = "cozy_purchases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cozy_players.id", ondelete="CASCADE"), index=True, nullable=False
    )

    # What was bought, in the game's own words: a gem pack id, or "noads".
    product_id: Mapped[str] = mapped_column(String(32), nullable=False)
    gems: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    amount_roubles: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # "created" -> "paid" -> "granted", or "canceled".
    status: Mapped[str] = mapped_column(String(16), default="created", nullable=False)

    provider: Mapped[str] = mapped_column(String(32), default="yookassa", nullable=False)
    provider_payment_id: Mapped[str] = mapped_column(String(64), default="", index=True, nullable=False)
    confirmation_url: Mapped[str] = mapped_column(Text, default="", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
