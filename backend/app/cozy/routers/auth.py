from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.cozy.database import get_db
from app.cozy.mail import send_password_reset_code, send_registration_code
from app.cozy.models import CozyEmailCode, CozyGoogleLogin, CozyPlayer
from app.cozy.schemas import (
    AuthOut,
    CodeIn,
    GooglePollOut,
    GoogleStartOut,
    LoginIn,
    MessageOut,
    PlayerOut,
    RegisterIn,
    ResetIn,
    ResetVerifyIn,
)
from app.cozy.security import (
    current_player,
    generate_code,
    generate_state,
    hash_password,
    issue_token,
    normalize_email,
    verify_password,
)
from app.cozy.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

PURPOSE_REGISTER = "register"
PURPOSE_RESET = "reset"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Said to everybody who asks for a reset, whether or not the address is known. An honest "no such
# player" here is a way to find out which addresses have accounts.
RESET_SENT_MESSAGE = "Если такой аккаунт есть, код отправлен на почту"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _name_from_email(email: str) -> str:
    local = normalize_email(email).split("@", maxsplit=1)[0]
    return (local or "Житель")[:64]


def _serialize(player: CozyPlayer) -> PlayerOut:
    return PlayerOut(
        id=player.id,
        email=player.email,
        display_name=player.display_name or _name_from_email(player.email),
        provider=player.auth_provider,
        has_password=bool(player.password_hash),
    )


def _auth(player: CozyPlayer, *, is_new: bool = False) -> AuthOut:
    return AuthOut(access_token=issue_token(player), player=_serialize(player), is_new_player=is_new)


def _sync_provider(player: CozyPlayer) -> None:
    providers = []
    if player.password_hash:
        providers.append("email")
    if player.google_sub:
        providers.append("google")
    player.auth_provider = "+".join(providers) if providers else "email"


def _issue_code(
    db: Session,
    *,
    email: str,
    purpose: str,
    password_hash: str = "",
) -> str:
    """Puts a fresh code in the table, replacing whatever was there for this address and purpose.

    The cooldown is read off the row rather than kept in a dictionary beside it: a process-local
    tracker is a tracker that resets every deploy and disagrees with itself the moment there are
    two workers.
    """
    existing = db.scalar(
        select(CozyEmailCode).where(CozyEmailCode.email == email, CozyEmailCode.purpose == purpose)
    )

    now = _now()
    if existing is not None and settings.email_resend_cooldown_seconds > 0:
        elapsed = (now - _as_utc(existing.created_at)).total_seconds()
        remaining = int(settings.email_resend_cooldown_seconds - elapsed)
        if remaining > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Новый код можно запросить через {remaining} с",
            )

    code = generate_code()
    expires_at = now + timedelta(minutes=settings.email_code_ttl_minutes)

    if existing is None:
        existing = CozyEmailCode(email=email, purpose=purpose)
        db.add(existing)

    existing.code_hash = hash_password(code)
    existing.password_hash = password_hash
    existing.expires_at = expires_at
    existing.attempts_left = settings.email_code_max_attempts
    existing.created_at = now
    return code


def _take_code(db: Session, *, email: str, purpose: str, code: str) -> CozyEmailCode:
    """Checks a code and consumes an attempt. Returns the row so the caller can read what it held."""
    row = db.scalar(
        select(CozyEmailCode).where(CozyEmailCode.email == email, CozyEmailCode.purpose == purpose)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код не запрашивали")

    if _as_utc(row.expires_at) <= _now():
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истёк, запросите новый")

    if not verify_password(code.strip(), row.code_hash):
        row.attempts_left -= 1
        if row.attempts_left <= 0:
            db.delete(row)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код неверный, запросите новый")

        left = row.attempts_left
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Код неверный. Попыток: {left}")

    return row


# ---------------------------------------------------------------- email and password


@router.post("/api/cozy/auth/register", response_model=MessageOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)) -> MessageOut:
    email = normalize_email(payload.email)

    existing = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))
    if existing is not None and existing.password_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Такой аккаунт уже есть")

    code = _issue_code(db, email=email, purpose=PURPOSE_REGISTER, password_hash=hash_password(payload.password))

    try:
        send_registration_code(email, code)
    except Exception as exc:
        db.rollback()
        logger.exception("Cozy: failed to send registration code")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось отправить письмо",
        ) from exc

    db.commit()
    return MessageOut(message="Код отправлен на почту")


@router.post("/api/cozy/auth/register/verify", response_model=AuthOut)
def register_verify(payload: CodeIn, db: Session = Depends(get_db)) -> AuthOut:
    email = normalize_email(payload.email)
    row = _take_code(db, email=email, purpose=PURPOSE_REGISTER, code=payload.code)

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))
    is_new = player is None

    if player is None:
        player = CozyPlayer(email=email, display_name=_name_from_email(email))
        db.add(player)
    elif player.password_hash:
        # Somebody registered the same address twice and got here with the older code.
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Такой аккаунт уже есть")

    player.password_hash = row.password_hash
    _sync_provider(player)

    db.delete(row)
    db.commit()
    db.refresh(player)
    return _auth(player, is_new=is_new)


@router.post("/api/cozy/auth/login", response_model=AuthOut)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> AuthOut:
    email = normalize_email(payload.email)
    player = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))

    if player is None or not player.password_hash or not verify_password(payload.password, player.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверная почта или пароль")

    if player.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт заблокирован")

    return _auth(player)


@router.post("/api/cozy/auth/password-reset", response_model=MessageOut)
def password_reset(payload: ResetIn, db: Session = Depends(get_db)) -> MessageOut:
    email = normalize_email(payload.email)
    player = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))
    if player is None:
        return MessageOut(message=RESET_SENT_MESSAGE)

    code = _issue_code(db, email=email, purpose=PURPOSE_RESET)

    try:
        send_password_reset_code(email, code)
    except Exception as exc:
        db.rollback()
        logger.exception("Cozy: failed to send password reset code")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось отправить письмо",
        ) from exc

    db.commit()
    return MessageOut(message=RESET_SENT_MESSAGE)


@router.post("/api/cozy/auth/password-reset/verify", response_model=AuthOut)
def password_reset_verify(payload: ResetVerifyIn, db: Session = Depends(get_db)) -> AuthOut:
    email = normalize_email(payload.email)
    row = _take_code(db, email=email, purpose=PURPOSE_RESET, code=payload.code)

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))
    if player is None:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код неверный")

    player.password_hash = hash_password(payload.password)
    _sync_provider(player)

    db.delete(row)
    db.commit()
    db.refresh(player)
    return _auth(player)


@router.get("/api/cozy/auth/me", response_model=PlayerOut)
def me(player: CozyPlayer = Depends(current_player)) -> PlayerOut:
    return _serialize(player)


# ---------------------------------------------------------------- google


def _google_player(db: Session, claims: dict[str, Any]) -> tuple[CozyPlayer, bool]:
    """Finds or makes the player behind a verified Google token.

    Matched on the subject first and only then on the address. The subject is what Google
    guarantees is the same person forever; an address can be changed, given up and handed to
    somebody else, so trusting it first is how one player ends up in another player's village.

    Matching on it second is still right: a player who registered with a password and later taps
    the Google button is the same person, and the alternative is two accounts, one of which holds
    their village and neither of which they can tell apart.
    """
    subject = str(claims.get("sub", "")).strip()
    email = normalize_email(str(claims.get("email", "")))

    if not subject or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google не вернул адрес")

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.google_sub == subject))
    if player is not None:
        return player, False

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.email == email))
    if player is not None:
        player.google_sub = subject
        _sync_provider(player)
        return player, False

    player = CozyPlayer(
        email=email,
        google_sub=subject,
        display_name=str(claims.get("name", "")).strip()[:64] or _name_from_email(email),
        auth_provider="google",
    )
    db.add(player)
    return player, True


def _verify_google_id_token(id_token: str) -> dict[str, Any]:
    response = requests.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token}, timeout=(4, 10))
    if response.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google отклонил вход")

    claims = response.json()
    if not isinstance(claims, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google вернул мусор")

    audience = str(claims.get("aud", ""))
    if audience and audience not in settings.google_client_ids:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Чужой Google-клиент")

    return claims


@router.get("/api/cozy/auth/google/config", include_in_schema=False)
def google_config() -> dict[str, Any]:
    """What is and is not set up, without saying anything secret.

    Exists because "вход через Google не работает" has four possible causes and three of them are
    in a console on somebody else's screen. The client id and the redirect URI are public - they
    travel in the consent URL - so the only thing this hides is whether the secret is right, and
    it can still say whether there is one.
    """
    client_id = settings.google_auth_client_id
    return {
        "ready": settings.google_configured,
        "client_id_set": bool(client_id),
        # The head, not the tail: every Google client id ends in the same
        # ".apps.googleusercontent.com", so the last characters are the one part that cannot tell
        # two of them apart - which is the only thing this field is for. The secret has to belong
        # to *this* client, and the number below says how many others are merely trusted.
        "client_id_head": client_id.split("-", maxsplit=1)[0] if client_id else "",
        "client_ids_accepted": len(settings.google_client_ids),
        "client_secret_set": bool(settings.google_client_secret),
        "redirect_uri": settings.google_redirect_uri,
    }


@router.post("/api/cozy/auth/google/start", response_model=GoogleStartOut)
def google_start(db: Session = Depends(get_db)) -> GoogleStartOut:
    """Hands the app a ticket and the address of the consent screen.

    The phone opens that address in the system browser rather than in a plugin. That is not a
    shortcut: a native Google SDK on Android means a signing-certificate fingerprint registered in
    a console, which means the sign-in works in one build and silently fails in the next one built
    on another machine. This works in the editor, in a debug APK and in a signed release without
    knowing anything about any of them.
    """
    if not settings.google_configured:
        # Named, not generic. The player cannot fix any of this, but the person reading the crash
        # report can - and "не настроен" sends them to check all three.
        missing = []
        if not settings.google_client_id:
            missing.append("client id")
        if not settings.google_client_secret:
            missing.append("client secret")
        if not settings.google_redirect_uri:
            missing.append("redirect uri")

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Вход через Google не настроен на сервере: нет " + ", ".join(missing),
        )

    # Cheap sweep: anything long dead goes at the moment somebody starts a new one.
    db.execute(delete(CozyGoogleLogin).where(CozyGoogleLogin.expires_at < _now()))

    state = generate_state()
    db.add(
        CozyGoogleLogin(
            state=state,
            expires_at=_now() + timedelta(seconds=settings.google_login_ttl_seconds),
        )
    )
    db.commit()

    query = urlencode(
        {
            # One id, not the list. See CozySettings.google_auth_client_id.
            "client_id": settings.google_auth_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            # The phone is shared, and "sign in with Google" that silently reuses whoever signed in
            # last is how a player ends up in somebody else's village without being asked anything.
            "prompt": "select_account",
        }
    )

    return GoogleStartOut(
        state=state,
        auth_url=f"{GOOGLE_AUTH_URL}?{query}",
        expires_in=settings.google_login_ttl_seconds,
    )


def _browser_page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cozy Village</title>
<style>
 body {{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
        background:#f6ead3; color:#4a3a28; font:16px/1.5 system-ui,-apple-system,sans-serif; }}
 .card {{ max-width:420px; padding:32px 28px; text-align:center; background:#fdf6e8;
          border-radius:22px; box-shadow:0 10px 30px rgba(74,58,40,.18); }}
 h1 {{ font-size:22px; margin:0 0 10px; }}
 p {{ margin:0; opacity:.8; }}
</style></head><body><div class="card"><h1>{title}</h1><p>{body}</p></div></body></html>"""
    )


@router.get("/api/cozy/auth/google/callback", include_in_schema=False)
def google_callback(
    state: str = "",
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
) -> HTMLResponse:
    row = db.scalar(select(CozyGoogleLogin).where(CozyGoogleLogin.state == state))
    if row is None or _as_utc(row.expires_at) <= _now():
        return _browser_page("Ссылка устарела", "Вернитесь в игру и попробуйте войти ещё раз.")

    if error or not code:
        row.status = "failed"
        row.error = (error or "no_code")[:255]
        db.commit()
        return _browser_page("Вход отменён", "Можно закрыть эту страницу и вернуться в игру.")

    try:
        token_response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                # The same single id the code was asked for with: an exchange is signed by the
                # client that made the request, so these two must never drift apart.
                "client_id": settings.google_auth_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.google_redirect_uri,
            },
            timeout=(4, 15),
        )
        token_payload = token_response.json() if token_response.content else {}
        id_token = str(token_payload.get("id_token", "")) if isinstance(token_payload, dict) else ""
        if token_response.status_code >= 400 or not id_token:
            raise RuntimeError(f"google token exchange failed ({token_response.status_code})")

        claims = _verify_google_id_token(id_token)
        player, is_new = _google_player(db, claims)
        db.flush()

        row.status = "ready"
        row.player_id = player.id
        row.access_token = issue_token(player)
        row.error = "1" if is_new else ""
        db.commit()
    except Exception as exc:  # noqa: BLE001 - the browser gets a page either way
        db.rollback()
        logger.exception("Cozy: google callback failed")
        failed = db.scalar(select(CozyGoogleLogin).where(CozyGoogleLogin.state == state))
        if failed is not None:
            failed.status = "failed"
            failed.error = str(exc)[:255]
            db.commit()
        return _browser_page("Не получилось", "Вернитесь в игру и попробуйте ещё раз.")

    return _browser_page("Готово!", "Можно закрыть эту вкладку и вернуться в Cozy Village.")


@router.get("/api/cozy/auth/google/poll", response_model=GooglePollOut)
def google_poll(state: str = "", db: Session = Depends(get_db)) -> GooglePollOut:
    row = db.scalar(select(CozyGoogleLogin).where(CozyGoogleLogin.state == state))
    if row is None:
        return GooglePollOut(status="failed", error="Сессия входа не найдена")

    if _as_utc(row.expires_at) <= _now():
        db.delete(row)
        db.commit()
        return GooglePollOut(status="failed", error="Время входа истекло")

    if row.status == "pending":
        return GooglePollOut(status="pending")

    if row.status != "ready" or not row.access_token:
        error = row.error or "Не удалось войти"
        db.delete(row)
        db.commit()
        return GooglePollOut(status="failed", error=error)

    player = db.scalar(select(CozyPlayer).where(CozyPlayer.id == row.player_id))
    if player is None:
        db.delete(row)
        db.commit()
        return GooglePollOut(status="failed", error="Игрок не найден")

    payload = AuthOut(
        access_token=row.access_token,
        player=_serialize(player),
        is_new_player=row.error == "1",
    )

    # Single use. A ticket that keeps answering is a session token lying in a table with a
    # guessable name on it.
    db.delete(row)
    db.commit()
    return GooglePollOut(status="ready", auth=payload)
