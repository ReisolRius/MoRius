"""Guest sessions and account deletion.

Lives under /api/auth so it is served by the auth service, next to sign-in: the guest endpoints
set and read the same device cookie the sign-in endpoints do.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    AccountDeleteRequest,
    AccountDeleteResponse,
    GuestClaimRequest,
    GuestClaimResponse,
    GuestSessionStartRequest,
    GuestSessionStartResponse,
)
from app.services.account_lifecycle import ACCOUNT_DELETE_CONFIRMATION_WORD, delete_user_account
from app.services.auth_identity import (
    ensure_user_not_banned,
    get_current_user,
    is_privileged_email,
    issue_auth_response,
    serialize_user_out,
    sync_user_access_state,
)
from app.services.guest_access import (
    ACCOUNT_REQUIRED_REASON_SETTINGS,
    DEVICE_ID_HEADER,
    GUEST_DEVICE_COOKIE,
    GUEST_TOKEN_HEADER,
    ensure_account_user,
    optional_str,
    request_is_secure,
    resolve_request_client_ip,
    set_device_cookie,
)
from app.services.guest_accounts import (
    GUEST_REFUSAL_MESSAGES,
    absorb_guest_into_account,
    remember_account_device,
    resolve_guest_from_token,
    start_guest_session,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def confirmation_matches(value: str | None) -> bool:
    return str(value or "").strip().casefold() == ACCOUNT_DELETE_CONFIRMATION_WORD.casefold()


@router.post("/api/auth/guest/session", response_model=GuestSessionStartResponse)
def start_guest_session_route(
    payload: GuestSessionStartRequest,
    request: Request,
    response: Response,
    guest_token: str | None = Header(default=None, alias=GUEST_TOKEN_HEADER),
    device_cookie: str | None = Cookie(default=None, alias=GUEST_DEVICE_COOKIE),
    db: Session = Depends(get_db),
) -> GuestSessionStartResponse:
    """"Начать игру" without an account: this browser's guest, resumed or newly issued."""
    result = start_guest_session(
        db,
        guest_token=optional_str(guest_token),
        device_cookie=optional_str(device_cookie),
        client_device_id=payload.device_id,
        client_ip=resolve_request_client_ip(request),
    )
    if result.device_cookie:
        set_device_cookie(response, result.device_cookie, secure=request_is_secure(request))
    if result.status != "ok" or result.user is None:
        db.rollback()
        return GuestSessionStartResponse(
            status="login_required",
            reason=result.reason,
            message=GUEST_REFUSAL_MESSAGES.get(str(result.reason or "")),
        )
    guest = result.user
    sync_user_access_state(guest)
    ensure_user_not_banned(guest)
    db.commit()
    db.refresh(guest)
    return GuestSessionStartResponse(status="ok", auth=issue_auth_response(guest, db=db))


@router.post("/api/auth/guest/claim", response_model=GuestClaimResponse)
def claim_guest_session_route(
    payload: GuestClaimRequest,
    authorization: str | None = Header(default=None),
    device_id: str | None = Header(default=None, alias=DEVICE_ID_HEADER),
    device_cookie: str | None = Cookie(default=None, alias=GUEST_DEVICE_COOKIE),
    db: Session = Depends(get_db),
) -> GuestClaimResponse:
    """The safety net for a sign-in that could not take the guest along by itself.

    Treated as an existing account: the guest's worlds and characters move, its starter sols do
    not - the account the player signed in to already had its own starter grant.
    """
    account = get_current_user(db, authorization)
    ensure_account_user(account, reason=ACCOUNT_REQUIRED_REASON_SETTINGS)
    guest = resolve_guest_from_token(db, payload.guest_token)
    merged = None
    if guest is not None and int(guest.id) != int(account.id):
        merged = absorb_guest_into_account(db, guest=guest, account=account, account_is_new=False)
    remember_account_device(
        db,
        user=account,
        device_cookie=optional_str(device_cookie),
        client_device_id=optional_str(device_id),
    )
    db.commit()
    db.refresh(account)
    return GuestClaimResponse(user=serialize_user_out(account, db=db), merged_guest=merged)


@router.post("/api/auth/me/delete", response_model=AccountDeleteResponse)
def delete_my_account_route(
    payload: AccountDeleteRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AccountDeleteResponse:
    user = get_current_user(db, authorization)
    ensure_account_user(user, reason=ACCOUNT_REQUIRED_REASON_SETTINGS)
    if not confirmation_matches(payload.confirmation):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Чтобы удалить аккаунт, введите слово «{ACCOUNT_DELETE_CONFIRMATION_WORD}».",
        )
    if is_privileged_email(user.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Служебный аккаунт нельзя удалить из настроек.",
        )
    user_id = int(user.id)
    try:
        delete_user_account(db, user=user)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Self-service account deletion failed: user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Не удалось удалить аккаунт. Попробуйте ещё раз через минуту.",
        ) from exc
    return AccountDeleteResponse(message="Аккаунт удалён", deleted_user_id=user_id)
