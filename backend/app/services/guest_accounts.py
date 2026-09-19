"""Guest pseudo-accounts: "Начать игру" without registering.

A guest is an ordinary `User` row with `is_guest=True`, named "Гость №N", holding the starter
sols. It plays and creates like anyone else; services/guest_access.py lists what it may not do.
When the player registers or signs in, everything the guest made moves into that account and the
guest row is deleted (`absorb_guest_into_account`).

The free sols are the part worth abusing, so a new guest is only minted for a browser and a
network that have not already had one:

* the browser is recognised by an HttpOnly cookie plus an id kept in localStorage;
* a browser that ever signed in to a real account is sent to the login form instead;
* a browser that already had a guest gets that same guest back, with whatever sols it has left;
* a network (an IPv4 address or an IPv6 /64) gets a few guests a day and a few a month, and
  after that the login form as well.

`GuestSession` is the registry behind all of that. Its rows are never deleted, and its id is the
guest's number, so numbers keep counting up even after old guests are merged away.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import AccountDeviceMark, GuestSession, StoryCharacter, StoryGame, StoryInstructionTemplate, User
from app.schemas import GuestMergeSummaryOut
from app.security import safe_decode_access_token
from app.services.account_lifecycle import NEW_ACCOUNT_STARTER_COINS, reassign_user_references
from app.services.guest_access import (
    GUEST_TOKEN_CLAIM,
    client_device_hash,
    device_cookie_hash,
    network_hash,
    new_device_cookie_value,
    normalize_device_token,
)

logger = logging.getLogger(__name__)

GUEST_STARTER_COINS = NEW_ACCOUNT_STARTER_COINS
GUEST_EMAIL_DOMAIN = "guest.morius-ai.ru"
GUEST_AUTH_PROVIDER = "guest"

# Per network. Every refusal still leaves registration open - these only decide when a free,
# account-less start stops being offered - so they lean strict.
GUEST_LIMIT_PER_NETWORK_PER_DAY = 2
GUEST_LIMIT_PER_NETWORK_PER_MONTH = 4
# Across the whole service: a burst beyond this is a script, not people.
GUEST_LIMIT_GLOBAL_PER_MINUTE = 40

GUEST_SESSION_ACTIVE = "active"
GUEST_SESSION_CONVERTED = "converted"
GUEST_SESSION_DELETED = "deleted"

GUEST_REFUSAL_ACCOUNT_EXISTS = "account_exists"
GUEST_REFUSAL_NETWORK_LIMIT = "network_limit"
GUEST_REFUSAL_BUSY = "busy"

GUEST_REFUSAL_MESSAGES: dict[str, str] = {
    GUEST_REFUSAL_ACCOUNT_EXISTS: "С этого устройства уже входили в аккаунт Moru. Войди, чтобы продолжить свою историю.",
    GUEST_REFUSAL_NETWORK_LIMIT: (
        "С этой сети недавно уже начинали игру без регистрации. Войди или зарегистрируйся — это бесплатно."
    ),
    GUEST_REFUSAL_BUSY: "Слишком много новых гостей прямо сейчас. Войди или зарегистрируйся, чтобы начать.",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def guest_display_name(number: int) -> str:
    return f"Гость №{int(number)}"


@dataclass
class GuestStartResult:
    status: Literal["ok", "login_required"]
    reason: str | None = None
    user: User | None = None
    created: bool = False
    # The value the endpoint must (re)set as the device cookie.
    device_cookie: str | None = None


def resolve_guest_from_token(db: Session, token: str | None) -> User | None:
    """The live guest a guest token belongs to. Tokens of real accounts never resolve here."""
    raw_token = str(token or "").strip()
    if not raw_token:
        return None
    payload = safe_decode_access_token(raw_token)
    if not isinstance(payload, dict) or not payload.get(GUEST_TOKEN_CLAIM):
        return None
    try:
        user_id = int(str(payload.get("sub")))
    except (TypeError, ValueError):
        return None
    user = db.get(User, user_id)
    if user is None or not bool(user.is_guest):
        return None
    if str(user.email or "").strip().lower() != str(payload.get("email") or "").strip().lower():
        return None
    return user


def _live_guest_for_session(db: Session, session_row: GuestSession) -> User | None:
    if session_row.status != GUEST_SESSION_ACTIVE or session_row.user_id is None:
        return None
    user = db.get(User, int(session_row.user_id))
    if user is None or not bool(user.is_guest):
        return None
    return user


def resolve_guest_from_device_cookie(db: Session, cookie_value: str | None) -> User | None:
    cookie_hash = device_cookie_hash(cookie_value)
    if not cookie_hash:
        return None
    session_rows = db.scalars(
        select(GuestSession)
        .where(GuestSession.device_cookie_hash == cookie_hash, GuestSession.status == GUEST_SESSION_ACTIVE)
        .order_by(GuestSession.id.desc())
    ).all()
    for session_row in session_rows:
        guest = _live_guest_for_session(db, session_row)
        if guest is not None:
            return guest
    return None


def resolve_request_guest(db: Session, *, guest_token: str | None, device_cookie: str | None) -> User | None:
    """The guest this browser is playing as: its token first, its device cookie second."""
    return resolve_guest_from_token(db, guest_token) or resolve_guest_from_device_cookie(db, device_cookie)


def _guest_session_for_user(db: Session, user_id: int) -> GuestSession | None:
    return db.scalar(
        select(GuestSession).where(GuestSession.user_id == int(user_id)).order_by(GuestSession.id.desc()).limit(1)
    )


def _device_hashes(device_cookie: str | None, client_device_id: str | None) -> list[str]:
    return [value for value in (device_cookie_hash(device_cookie), client_device_hash(client_device_id)) if value]


def remember_account_device(
    db: Session,
    *,
    user: User,
    device_cookie: str | None,
    client_device_id: str | None,
) -> None:
    """Record that a real account signed in from this browser. Never for a guest."""
    if user is None or bool(getattr(user, "is_guest", False)) or getattr(user, "id", None) is None:
        return
    hashes = _device_hashes(device_cookie, client_device_id)
    if not hashes:
        return
    now = _utcnow()
    existing = {
        mark.device_hash: mark
        for mark in db.scalars(
            select(AccountDeviceMark).where(
                AccountDeviceMark.user_id == int(user.id),
                AccountDeviceMark.device_hash.in_(hashes),
            )
        ).all()
    }
    for device_hash in hashes:
        mark = existing.get(device_hash)
        if mark is None:
            db.add(AccountDeviceMark(device_hash=device_hash, user_id=int(user.id), last_seen_at=now))
        else:
            mark.last_seen_at = now


def _attach_device_to_session(session_row: GuestSession, *, cookie_hash: str | None, client_hash: str | None) -> None:
    if cookie_hash and not session_row.device_cookie_hash:
        session_row.device_cookie_hash = cookie_hash
    if client_hash and not session_row.client_device_hash:
        session_row.client_device_hash = client_hash


def _resume(db: Session, guest: User, *, cookie_value: str, cookie_hash: str | None, client_hash: str | None) -> GuestStartResult:
    session_row = _guest_session_for_user(db, int(guest.id))
    if session_row is not None:
        _attach_device_to_session(session_row, cookie_hash=cookie_hash, client_hash=client_hash)
        session_row.last_seen_at = _utcnow()
    return GuestStartResult(status="ok", user=guest, created=False, device_cookie=cookie_value)


def start_guest_session(
    db: Session,
    *,
    guest_token: str | None,
    device_cookie: str | None,
    client_device_id: str | None,
    client_ip: str | None,
    now: datetime | None = None,
) -> GuestStartResult:
    """Resume this browser's guest, or mint a new one if the browser and network have earned it.

    Flushes; the caller commits.
    """
    current_time = now or _utcnow()
    cookie_value = normalize_device_token(device_cookie) or new_device_cookie_value()
    cookie_hash = device_cookie_hash(cookie_value)
    client_hash = client_device_hash(client_device_id)
    device_hashes = [value for value in (cookie_hash, client_hash) if value]

    # 1. The browser still holds its guest token.
    token_guest = resolve_guest_from_token(db, guest_token)
    if token_guest is not None:
        return _resume(db, token_guest, cookie_value=cookie_value, cookie_hash=cookie_hash, client_hash=client_hash)

    # 2. Somebody signed in to a real account from this browser.
    if device_hashes and db.scalar(
        select(AccountDeviceMark.id).where(AccountDeviceMark.device_hash.in_(device_hashes)).limit(1)
    ) is not None:
        return GuestStartResult(status="login_required", reason=GUEST_REFUSAL_ACCOUNT_EXISTS, device_cookie=cookie_value)

    # 3. This browser already had a guest.
    carried_coins: int | None = None
    if device_hashes:
        known_sessions = db.scalars(
            select(GuestSession)
            .where(
                or_(
                    GuestSession.device_cookie_hash.in_(device_hashes),
                    GuestSession.client_device_hash.in_(device_hashes),
                )
            )
            .order_by(GuestSession.id.desc())
        ).all()
        for session_row in known_sessions:
            live_guest = _live_guest_for_session(db, session_row)
            if live_guest is not None:
                return _resume(db, live_guest, cookie_value=cookie_value, cookie_hash=cookie_hash, client_hash=client_hash)
        if any(session_row.status == GUEST_SESSION_CONVERTED for session_row in known_sessions):
            # That guest became an account; the account is where this player continues.
            return GuestStartResult(status="login_required", reason=GUEST_REFUSAL_ACCOUNT_EXISTS, device_cookie=cookie_value)
        if known_sessions:
            # The old guest was erased. The new one starts from what the old one had left, not
            # from a fresh grant.
            carried_coins = max(int(known_sessions[0].coins_at_close or 0), 0)

    # 4. The network and the service as a whole.
    ip_hash = network_hash(client_ip)
    if carried_coins is None:
        if ip_hash:
            created_today = int(
                db.scalar(
                    select(func.count())
                    .select_from(GuestSession)
                    .where(GuestSession.ip_hash == ip_hash, GuestSession.created_at >= current_time - timedelta(days=1))
                )
                or 0
            )
            created_this_month = int(
                db.scalar(
                    select(func.count())
                    .select_from(GuestSession)
                    .where(GuestSession.ip_hash == ip_hash, GuestSession.created_at >= current_time - timedelta(days=30))
                )
                or 0
            )
            if created_today >= GUEST_LIMIT_PER_NETWORK_PER_DAY or created_this_month >= GUEST_LIMIT_PER_NETWORK_PER_MONTH:
                return GuestStartResult(status="login_required", reason=GUEST_REFUSAL_NETWORK_LIMIT, device_cookie=cookie_value)
        created_last_minute = int(
            db.scalar(
                select(func.count())
                .select_from(GuestSession)
                .where(GuestSession.created_at >= current_time - timedelta(minutes=1))
            )
            or 0
        )
        if created_last_minute >= GUEST_LIMIT_GLOBAL_PER_MINUTE:
            return GuestStartResult(status="login_required", reason=GUEST_REFUSAL_BUSY, device_cookie=cookie_value)

    # 5. A new guest.
    session_row = GuestSession(
        status=GUEST_SESSION_ACTIVE,
        device_cookie_hash=cookie_hash or "",
        client_device_hash=client_hash or "",
        ip_hash=ip_hash or "",
        last_seen_at=current_time,
        created_at=current_time,
    )
    db.add(session_row)
    db.flush()
    guest_number = int(session_row.id)
    guest = User(
        email=f"guest-{guest_number}-{secrets.token_hex(6)}@{GUEST_EMAIL_DOMAIN}",
        password_hash=None,
        display_name=guest_display_name(guest_number),
        auth_provider=GUEST_AUTH_PROVIDER,
        role="user",
        coins=GUEST_STARTER_COINS if carried_coins is None else carried_coins,
        is_guest=True,
        guest_number=guest_number,
        email_notifications_enabled=False,
    )
    db.add(guest)
    db.flush()
    session_row.user_id = int(guest.id)
    logger.info("Guest issued: number=%s user_id=%s carried_coins=%s", guest_number, guest.id, carried_coins)
    return GuestStartResult(status="ok", user=guest, created=True, device_cookie=cookie_value)


def _count_owned(db: Session, model, user_id: int) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(model.user_id == int(user_id))) or 0)


def _is_default_json_blob(value: str | None) -> bool:
    return str(value or "").strip() in {"", "{}"}


def absorb_guest_into_account(
    db: Session,
    *,
    guest: User,
    account: User,
    account_is_new: bool,
) -> GuestMergeSummaryOut:
    """Move everything a guest made into `account`, then delete the guest.

    Sols: a brand-new account takes over the guest's balance *instead of* its own starter grant -
    the grant was already handed out once, to the guest. An existing account keeps its balance
    and the guest's leftover starter sols are not added to it, otherwise signing out, playing as
    a guest and signing back in would be a way to farm sols.

    Flushes; the caller commits.
    """
    if not bool(getattr(guest, "is_guest", False)):
        raise ValueError("Only a guest can be absorbed into an account")
    if bool(getattr(account, "is_guest", False)):
        raise ValueError("A guest cannot absorb another guest")
    if int(guest.id) == int(account.id):
        raise ValueError("A guest cannot be absorbed into itself")

    guest_id = int(guest.id)
    account_id = int(account.id)
    guest_name = str(guest.display_name or "").strip() or guest_display_name(int(guest.guest_number or 0))
    guest_coins = max(int(guest.coins or 0), 0)
    summary = GuestMergeSummaryOut(
        guest_user_id=guest_id,
        guest_name=guest_name,
        worlds=_count_owned(db, StoryGame, guest_id),
        characters=_count_owned(db, StoryCharacter, guest_id),
        instruction_templates=_count_owned(db, StoryInstructionTemplate, guest_id),
        coins_transferred=guest_coins if account_is_new else 0,
    )

    now = _utcnow()
    session_row = _guest_session_for_user(db, guest_id)
    if session_row is not None:
        session_row.status = GUEST_SESSION_CONVERTED
        session_row.converted_user_id = account_id
        session_row.user_id = None
        session_row.coins_at_close = guest_coins
        session_row.closed_at = now
        # The browser that played as this guest now belongs to an account: the next "Начать игру"
        # from it opens the login form.
        for device_hash in (session_row.device_cookie_hash, session_row.client_device_hash):
            if device_hash and db.scalar(
                select(AccountDeviceMark.id).where(
                    AccountDeviceMark.device_hash == device_hash,
                    AccountDeviceMark.user_id == account_id,
                )
            ) is None:
                db.add(AccountDeviceMark(device_hash=device_hash, user_id=account_id, last_seen_at=now))
        db.flush()

    reassign_user_references(db, source_user_id=guest_id, target_user_id=account_id)
    # The moves above are bulk statements; anything this session already loaded still shows the
    # guest as its owner until it is read again.
    db.flush()
    db.expire_all()

    if account_is_new:
        account.coins = guest_coins
        if _is_default_json_blob(account.onboarding_guide_state) and not _is_default_json_blob(guest.onboarding_guide_state):
            account.onboarding_guide_state = guest.onboarding_guide_state
        if _is_default_json_blob(account.theme_preferences) and not _is_default_json_blob(guest.theme_preferences):
            account.theme_preferences = guest.theme_preferences

    db.flush()
    db.delete(guest)
    db.flush()
    logger.info(
        "Guest absorbed: guest_id=%s account_id=%s new_account=%s worlds=%s characters=%s coins=%s",
        guest_id,
        account_id,
        account_is_new,
        summary.worlds,
        summary.characters,
        summary.coins_transferred,
    )
    return summary


def resolve_guest_by_id(db: Session, guest_user_id: int | None) -> User | None:
    """A guest named by a server-signed value (the OAuth state). Never trust an id from a client."""
    if guest_user_id is None:
        return None
    try:
        user = db.get(User, int(guest_user_id))
    except (TypeError, ValueError):
        return None
    if user is None or not bool(user.is_guest):
        return None
    return user


def absorb_request_guest_safely(
    db: Session,
    *,
    account: User,
    account_is_new: bool,
    guest_token: str | None,
    device_cookie: str | None,
    client_device_id: str | None,
    guest_user_id: int | None = None,
) -> GuestMergeSummaryOut | None:
    """Merge the browser's guest (if any) into `account` after a successful sign-in, and mark the
    browser as belonging to an account.

    Runs in its own transaction after the sign-in itself was committed, so a failure here can
    never cost the player the sign-in: it is logged, rolled back, and the guest stays where it
    was for the client to claim again.
    """
    if account is None or bool(getattr(account, "is_guest", False)):
        return None
    account_id = int(account.id)
    merged: GuestMergeSummaryOut | None = None
    try:
        guest = resolve_guest_by_id(db, guest_user_id) or resolve_request_guest(
            db,
            guest_token=guest_token,
            device_cookie=device_cookie,
        )
        if guest is not None and int(guest.id) != account_id:
            merged = absorb_guest_into_account(db, guest=guest, account=account, account_is_new=account_is_new)
        remember_account_device(db, user=account, device_cookie=device_cookie, client_device_id=client_device_id)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Guest merge after sign-in failed: account_id=%s", account_id)
        merged = None
    try:
        db.refresh(account)
    except Exception:
        pass
    return merged
