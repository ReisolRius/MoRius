from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import requests


YANDEX_AUTHORIZE_URL = "https://oauth.yandex.ru/authorize"
YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token"
YANDEX_USERINFO_URL = "https://login.yandex.ru/info"
YANDEX_SCOPES = "login:info login:email login:avatar"


class YandexOAuthError(RuntimeError):
    pass


@dataclass(frozen=True)
class YandexIdentity:
    subject: str
    email: str
    display_name: str | None
    avatar_url: str | None


def build_yandex_authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    code_challenge: str,
    force_confirm: bool,
) -> str:
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": YANDEX_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if force_confirm:
        query["force_confirm"] = "yes"
    return f"{YANDEX_AUTHORIZE_URL}?{urlencode(query)}"


def exchange_yandex_code(
    *,
    client_id: str,
    code: str,
    code_verifier: str,
) -> str:
    try:
        response = requests.post(
            YANDEX_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "code_verifier": code_verifier,
            },
            timeout=(4, 12),
        )
    except requests.RequestException as exc:
        raise YandexOAuthError("Failed to reach Yandex OAuth token endpoint") from exc

    try:
        payload: Any = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 500:
        raise YandexOAuthError(f"Yandex OAuth token endpoint is unavailable ({response.status_code})")
    if response.status_code >= 400 or not isinstance(payload, dict):
        provider_detail = str(payload.get("error_description") or payload.get("error") or "").strip()
        raise YandexOAuthError(provider_detail or "Yandex rejected the authorization code")

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise YandexOAuthError("Yandex OAuth response did not include an access token")
    return access_token


def fetch_yandex_identity(*, access_token: str, expected_client_id: str) -> YandexIdentity:
    try:
        response = requests.get(
            YANDEX_USERINFO_URL,
            params={"format": "json"},
            headers={"Authorization": f"OAuth {access_token}"},
            timeout=(4, 12),
        )
    except requests.RequestException as exc:
        raise YandexOAuthError("Failed to reach Yandex user information endpoint") from exc

    try:
        payload: Any = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 500:
        raise YandexOAuthError(f"Yandex user information endpoint is unavailable ({response.status_code})")
    if response.status_code >= 400 or not isinstance(payload, dict):
        raise YandexOAuthError("Yandex user information request was rejected")

    response_client_id = str(payload.get("client_id") or "").strip()
    if response_client_id != expected_client_id:
        raise YandexOAuthError("Yandex token was issued for another application")

    subject = str(payload.get("psuid") or payload.get("id") or "").strip()
    email = str(payload.get("default_email") or "").strip().lower()
    if not subject:
        raise YandexOAuthError("Yandex account identifier is missing")
    if not email:
        raise YandexOAuthError(
            "Yandex did not provide an email address. Enable the email permission in the OAuth application."
        )

    display_name = str(
        payload.get("display_name")
        or payload.get("real_name")
        or payload.get("login")
        or ""
    ).strip() or None
    avatar_id = str(payload.get("default_avatar_id") or "").strip()
    is_avatar_empty = bool(payload.get("is_avatar_empty"))
    avatar_url = None
    if avatar_id and not is_avatar_empty:
        avatar_url = f"https://avatars.yandex.net/get-yapic/{avatar_id}/islands-200"

    return YandexIdentity(
        subject=subject,
        email=email,
        display_name=display_name,
        avatar_url=avatar_url,
    )
