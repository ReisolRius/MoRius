from __future__ import annotations

import json
from http.cookies import SimpleCookie
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import User
from app.routers import auth as auth_router
from app.schemas import VKIDOAuthStartRequest
from app.services.vk_id_oauth import VKIDIdentity


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


def test_mail_login_uses_vk_id_pkce_and_callback_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        auth_router,
        "settings",
        SimpleNamespace(
            vk_id_client_id="54637263",
            vk_id_redirect_uri="https://morius-ai.ru/api/auth/callback/vk",
            vk_id_frontend_url="https://morius-ai.ru",
        ),
    )
    monkeypatch.setattr(auth_router, "exchange_vk_id_code", lambda **_: "provider-access-token")
    monkeypatch.setattr(
        auth_router,
        "fetch_vk_id_identity",
        lambda **_: VKIDIdentity(
            subject="vk-id-user-1",
            email="player@mail.ru",
            display_name="Mail Player",
            avatar_url="https://example.com/avatar.png",
            provider="mail",
        ),
    )

    db = _create_session()
    try:
        start_response = Response()
        start_payload = auth_router.start_vk_id_oauth(
            VKIDOAuthStartRequest(action="login", provider="mail", return_path="/auth"),
            start_response,
            authorization=None,
            db=db,
        )
        authorization_query = parse_qs(urlparse(start_payload.authorization_url).query)
        assert authorization_query["client_id"] == ["54637263"]
        assert authorization_query["provider"] == ["mail_ru"]
        assert authorization_query["code_challenge_method"] == ["S256"]
        assert authorization_query.get("client_secret") is None

        callback_response = auth_router.vk_id_oauth_callback(
            payload=json.dumps(
                {
                    "code": "authorization-code",
                    "state": authorization_query["state"][0],
                    "device_id": "device-1",
                }
            ),
            code=None,
            state_token=None,
            device_id=None,
            provider_error=None,
            flow_cookie=_read_cookie(start_response, auth_router.VK_ID_OAUTH_FLOW_COOKIE),
            db=db,
        )
        assert callback_response.status_code == 303
        assert "vk_id_oauth=complete" in callback_response.headers["location"]

        completed = auth_router.complete_vk_id_oauth(
            Response(),
            completion_cookie=_read_cookie(callback_response, auth_router.VK_ID_OAUTH_COMPLETION_COOKIE),
            db=db,
        )
        assert completed.oauth_action == "login"
        assert completed.oauth_provider == "mail"
        assert completed.is_new_user is True
        assert completed.user.email == "player@mail.ru"
        assert completed.user.auth_provider == "mail"
    finally:
        db.close()


def test_linking_vk_replaces_yandex_updates_email_and_merges_duplicate() -> None:
    db = _create_session()
    try:
        user = User(
            email="old@example.com",
            display_name="Owner",
            yandex_sub="yandex-user-1",
            auth_provider="yandex",
            coins=5,
        )
        duplicate = User(
            email="owner@vk.ru",
            display_name="Old duplicate",
            password_hash="old-password-hash",
            auth_provider="email",
            coins=17,
        )
        db.add_all([user, duplicate])
        db.commit()
        db.refresh(user)
        db.refresh(duplicate)
        original_user_id = int(user.id)
        duplicate_user_id = int(duplicate.id)

        linked = auth_router._link_vk_id_identity(
            db,
            user_id=original_user_id,
            identity=VKIDIdentity(
                subject="vk-id-user-2",
                email="owner@vk.ru",
                display_name="Owner",
                avatar_url=None,
                provider="vk",
            ),
        )
        db.commit()
        db.refresh(linked)
        archived_duplicate = db.get(User, duplicate_user_id)

        assert linked.id == original_user_id
        assert linked.email == "owner@vk.ru"
        assert linked.yandex_sub is None
        assert linked.password_hash is None
        assert linked.vk_id_sub == "vk-id-user-2"
        assert linked.vk_id_provider == "vk"
        assert linked.auth_provider == "vk"
        assert linked.coins == 22
        assert archived_duplicate is not None
        assert archived_duplicate.email.endswith("@merged.morius.local")
        assert archived_duplicate.auth_provider == "merged"
        assert archived_duplicate.coins == 0
    finally:
        db.close()
