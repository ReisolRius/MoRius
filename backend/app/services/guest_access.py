"""What a guest may not do, and how the web client learns that it has to register.

A guest is a real `User` row with `is_guest=True` (see services/guest_accounts.py). It can play,
create worlds and spend the starter sols it was given, but paying, publishing, posting and
changing account settings need an account.

Every refusal carries the `X-Moru-Account-Required` header. The client turns that header - and
nothing else - into a jump to the sign-up form, so one mechanism covers every endpoint,
including the ones that will be added later. A 402 "not enough sols" answered to a guest gets
the same header from `GuestAccountRequiredMiddleware`, which is how "the starter sols ran out"
becomes "register to continue" without touching the dozen places that charge sols.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import secrets
from typing import Any

from fastapi import HTTPException, Request, Response, status
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings
from app.security import safe_decode_access_token

ACCOUNT_REQUIRED_HEADER = "X-Moru-Account-Required"
GUEST_TOKEN_HEADER = "X-Moru-Guest-Token"
DEVICE_ID_HEADER = "X-Moru-Device"
GUEST_TOKEN_CLAIM = "guest"

# HttpOnly, so page scripts cannot read or forge it, and scoped to /api/auth so it travels with
# the guest endpoints, every sign-in request and the OAuth callbacks - and nowhere else.
GUEST_DEVICE_COOKIE = "morius_device"
GUEST_DEVICE_COOKIE_PATH = "/api/auth"
GUEST_DEVICE_COOKIE_MAX_AGE_SECONDS = 2 * 365 * 24 * 60 * 60
_DEVICE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")

ACCOUNT_REQUIRED_REASON_SOLS = "sols"
ACCOUNT_REQUIRED_REASON_SETTINGS = "settings"
ACCOUNT_REQUIRED_REASON_SHOP = "shop"
ACCOUNT_REQUIRED_REASON_PUBLISH = "publish"
ACCOUNT_REQUIRED_REASON_SOCIAL = "social"
ACCOUNT_REQUIRED_REASON_REWARDS = "rewards"

ACCOUNT_REQUIRED_MESSAGES: dict[str, str] = {
    ACCOUNT_REQUIRED_REASON_SOLS: (
        "Стартовые солы закончились. Зарегистрируйся, чтобы играть дальше — всё, что ты создал, сохранится."
    ),
    ACCOUNT_REQUIRED_REASON_SETTINGS: "Настройки аккаунта доступны после регистрации.",
    ACCOUNT_REQUIRED_REASON_SHOP: "Покупки доступны только с аккаунтом.",
    ACCOUNT_REQUIRED_REASON_PUBLISH: "Публиковать миры, персонажей и инструкции можно только с аккаунтом.",
    ACCOUNT_REQUIRED_REASON_SOCIAL: "Комментарии, оценки, жалобы и подписки доступны после регистрации.",
    ACCOUNT_REQUIRED_REASON_REWARDS: "Ежедневные награды доступны после регистрации.",
}
ACCOUNT_REQUIRED_DEFAULT_MESSAGE = "Это действие доступно только с аккаунтом."


def is_guest_user(user: Any) -> bool:
    return bool(getattr(user, "is_guest", False))


def account_required_error(reason: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=ACCOUNT_REQUIRED_MESSAGES.get(reason, ACCOUNT_REQUIRED_DEFAULT_MESSAGE),
        headers={ACCOUNT_REQUIRED_HEADER: reason},
    )


def ensure_account_user(user: Any, *, reason: str) -> None:
    """Refuse a guest. Call it right after `get_current_user` in any endpoint a guest may not use."""
    if is_guest_user(user):
        raise account_required_error(reason)


def optional_str(value: Any) -> str | None:
    """A header or cookie parameter as a plain string.

    Endpoint functions are also called directly in tests, where an omitted `Header(...)` or
    `Cookie(...)` default arrives as the FastAPI marker object rather than as None.
    """
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def hash_identity(kind: str, value: str) -> str:
    """A keyed one-way hash. Device ids, networks and deleted sign-in identities are stored only as this."""
    key = str(settings.jwt_secret_key or "").encode("utf-8")
    return hmac.new(key, f"{kind}:{value}".encode("utf-8"), hashlib.sha256).hexdigest()


def normalize_device_token(value: Any) -> str | None:
    normalized = optional_str(value)
    if normalized is None or not _DEVICE_TOKEN_PATTERN.fullmatch(normalized):
        return None
    return normalized


def device_cookie_hash(value: Any) -> str | None:
    token = normalize_device_token(value)
    return hash_identity("device-cookie", token) if token else None


def client_device_hash(value: Any) -> str | None:
    token = normalize_device_token(value)
    return hash_identity("device-client", token) if token else None


def new_device_cookie_value() -> str:
    return secrets.token_urlsafe(32)


def request_is_secure(request: Request | None) -> bool:
    if request is None:
        return False
    forwarded_proto = str(request.headers.get("x-forwarded-proto", "") or "").split(",", 1)[0].strip().lower()
    if forwarded_proto:
        return forwarded_proto == "https"
    return request.url.scheme == "https"


def set_device_cookie(response: Response, value: str, *, secure: bool) -> None:
    response.set_cookie(
        key=GUEST_DEVICE_COOKIE,
        value=value,
        max_age=GUEST_DEVICE_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=GUEST_DEVICE_COOKIE_PATH,
    )


def _parse_ip(raw_value: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    candidate = str(raw_value or "").strip().strip('"')
    if not candidate:
        return None
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    elif candidate.count(":") == 1 and "." in candidate:
        candidate = candidate.split(":", 1)[0]
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _is_internal_hop(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Our own infrastructure: docker bridges, the host's proxy, loopback."""
    return address.is_loopback or address.is_link_local or address.is_private


def resolve_request_client_ip(request: Request | None) -> str:
    """The address of whoever is on the other end, as far as our own proxies can vouch for it.

    uvicorn is started with forwarded_allow_ips="*", so `request.client.host` is the *leftmost*
    X-Forwarded-For entry - which the client writes itself. Our proxies append to the right, so
    walking from the right past our own internal hops finds the first address a proxy of ours
    actually saw on the wire.
    """
    if request is None:
        return ""
    forwarded_parts = [
        part.strip()
        for part in str(request.headers.get("x-forwarded-for", "") or "").split(",")
        if part.strip()
    ]
    for raw_part in reversed(forwarded_parts):
        parsed = _parse_ip(raw_part)
        if parsed is not None and not _is_internal_hop(parsed):
            return str(parsed)
    real_ip = _parse_ip(request.headers.get("x-real-ip"))
    if real_ip is not None and not _is_internal_hop(real_ip):
        return str(real_ip)
    if forwarded_parts:
        # Every hop internal: a LAN or a local test. Our own proxy's view is still the rightmost.
        parsed = _parse_ip(forwarded_parts[-1])
        if parsed is not None:
            return str(parsed)
    if real_ip is not None:
        return str(real_ip)
    return str(request.client.host) if request.client is not None else ""


def network_hash(client_ip: str | None) -> str | None:
    """The network a request came from, hashed. An IPv6 address counts by its /64: a single phone
    is handed a whole /64 and can rotate through it at will."""
    parsed = _parse_ip(client_ip)
    if parsed is None:
        return None
    if isinstance(parsed, ipaddress.IPv6Address):
        if parsed.ipv4_mapped is not None:
            return hash_identity("network", str(parsed.ipv4_mapped))
        network = ipaddress.IPv6Network(f"{parsed}/64", strict=False)
        return hash_identity("network", str(network.network_address))
    return hash_identity("network", str(parsed))


def bearer_token_is_guest(authorization: str | None) -> bool:
    raw_value = str(authorization or "").strip()
    if not raw_value.lower().startswith("bearer "):
        return False
    payload = safe_decode_access_token(raw_value[7:].strip())
    return bool(isinstance(payload, dict) and payload.get(GUEST_TOKEN_CLAIM))


def _scope_authorization(scope: Scope) -> str | None:
    for key, value in scope.get("headers") or []:
        if key == b"authorization":
            try:
                return value.decode("latin-1")
            except Exception:
                return None
    return None


class GuestAccountRequiredMiddleware:
    """Marks every 402 a guest receives as "register to continue".

    Sols are charged in many places - turns, images, maps, backgrounds, the assistant, D&D - and
    each answers 402 on its own. For a guest that answer means the starter grant is gone, so the
    client must open the sign-up form instead of the top-up dialog a guest cannot use. Doing it
    here keeps every one of those call sites untouched. The token is only decoded when a 402
    actually goes out.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message.get("type") == "http.response.start" and int(message.get("status") or 0) == 402:
                if bearer_token_is_guest(_scope_authorization(scope)):
                    headers = MutableHeaders(scope=message)
                    if ACCOUNT_REQUIRED_HEADER not in headers:
                        headers[ACCOUNT_REQUIRED_HEADER] = ACCOUNT_REQUIRED_REASON_SOLS
            await send(message)

        await self.app(scope, receive, send_wrapper)
