from __future__ import annotations

from http.cookies import SimpleCookie
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi import Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import User
from app.routers import auth as auth_router
from app.schemas import AuthMethodPasswordRequest, YandexOAuthStartRequest
from app.security import create_access_token, hash_password
from app.services.yandex_oauth import YandexIdentity


def _read_cookie(response: Response, name: str) -> str:
    for header_value in response.headers.getlist("set-cookie"):
        parsed = SimpleCookie()
        parsed.load(header_value)
        if name in parsed:
            return parsed[name].value
    raise AssertionError(f"Cookie {name!r} was not set")


def _create_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return Session(bind=engine, future=True)


def test_yandex_login_flow_uses_pkce_and_completes_without_secret(monkeypatch) -> None:
    monkeypatch.setattr(
        auth_router,
        "settings",
        SimpleNamespace(
            yandex_client_id="test-client-id",
            yandex_redirect_uri="https://morius-ai.ru/api/auth/callback/yandex",
            yandex_frontend_url="https://morius-ai.ru",
        ),
    )
    monkeypatch.setattr(auth_router, "exchange_yandex_code", lambda **_: "provider-access-token")
    monkeypatch.setattr(
        auth_router,
        "fetch_yandex_identity",
        lambda **_: YandexIdentity(
            subject="yandex-user-1",
            email="player@example.com",
            display_name="Player",
            avatar_url="https://avatars.yandex.net/avatar",
        ),
    )

    db = _create_session()
    try:
        start_response = Response()
        start_payload = auth_router.start_yandex_oauth(
            YandexOAuthStartRequest(action="login", return_path="/auth"),
            start_response,
            authorization=None,
            db=db,
        )
        authorization_query = parse_qs(urlparse(start_payload.authorization_url).query)
        assert authorization_query["client_id"] == ["test-client-id"]
        assert authorization_query["code_challenge_method"] == ["S256"]
        assert authorization_query.get("client_secret") is None

        callback_response = auth_router.yandex_oauth_callback(
            code="authorization-code",
            state_token=authorization_query["state"][0],
            provider_error=None,
            flow_cookie=_read_cookie(start_response, auth_router.YANDEX_OAUTH_FLOW_COOKIE),
            db=db,
        )
        assert callback_response.status_code == 303
        assert "yandex_oauth=complete" in callback_response.headers["location"]

        completion_response = Response()
        completed = auth_router.complete_yandex_oauth(
            completion_response,
            completion_cookie=_read_cookie(callback_response, auth_router.YANDEX_OAUTH_COMPLETION_COOKIE),
            db=db,
        )
        assert completed.oauth_action == "login"
        assert completed.is_new_user is True
        assert completed.user.email == "player@example.com"
        assert completed.user.auth_provider == "yandex"
        assert completed.access_token
    finally:
        db.close()


def test_linking_yandex_replaces_google_on_existing_profile() -> None:
    db = _create_session()
    try:
        user = User(
            email="owner@example.com",
            display_name="Owner",
            google_sub="google-user-1",
            auth_provider="google",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        linked = auth_router._link_yandex_identity(
            db,
            user_id=int(user.id),
            identity=YandexIdentity(
                subject="yandex-user-2",
                email="another-address@yandex.ru",
                display_name="Owner",
                avatar_url=None,
            ),
        )
        db.commit()

        assert linked.id == user.id
        assert linked.google_sub is None
        assert linked.yandex_sub == "yandex-user-2"
        assert linked.auth_provider == "yandex"
        assert linked.email == "another-address@yandex.ru"
    finally:
        db.close()


def test_password_relink_keeps_profile_and_removes_oauth_bindings() -> None:
    db = _create_session()
    try:
        user = User(
            email="Owner@gmail.com",
            display_name="Owner",
            google_sub="google-user-2",
            yandex_sub="yandex-user-3",
            vk_id_sub="vk-id-user-1",
            vk_id_provider="mail",
            auth_provider="google+yandex",
        )
        db.add(user)
        db.add(
            User(
                email="owner@gmail.com",
                display_name="Duplicate",
                password_hash=hash_password("old-password-123"),
                auth_provider="email",
            )
        )
        db.commit()
        db.refresh(user)
        token = create_access_token(subject=str(user.id), claims={"email": user.email})

        updated = auth_router.replace_auth_method_with_password(
            AuthMethodPasswordRequest(password="new-password-123", confirm_password="new-password-123"),
            authorization=f"Bearer {token}",
            db=db,
        )
        stored = db.scalar(select(User).where(User.id == user.id))

        assert updated.id == user.id
        assert updated.auth_provider == "email"
        assert stored is not None
        assert stored.password_hash
        assert stored.google_sub is None
        assert stored.yandex_sub is None
        assert stored.vk_id_sub is None
        assert stored.vk_id_provider is None
        active_same_email_count = db.scalar(
            select(func.count(User.id)).where(func.lower(User.email) == "owner@gmail.com")
        )
        assert active_same_email_count == 1
    finally:
        db.close()
