from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlencode

import requests


VK_ID_AUTHORIZE_URL = "https://id.vk.ru/authorize"
VK_ID_TOKEN_URL = "https://id.vk.ru/oauth2/auth"
VK_ID_USERINFO_URL = "https://id.vk.ru/oauth2/user_info"
VK_ID_SDK_VERSION = "2.6.5"
VK_ID_SCOPE = "email"
VK_ID_PROVIDER_VALUES = {
    "vk": "vkid",
    "mail": "mail_ru",
}


class VKIDOAuthError(RuntimeError):
    def __init__(self, message: str, *, code: str = "provider_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VKIDIdentity:
    subject: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    provider: Literal["vk", "mail"]


def build_vk_id_authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    code_challenge: str,
    provider: Literal["vk", "mail"],
    force_login: bool,
) -> str:
    query = {
        "response_type": "code",
        "client_id": client_id,
        "app_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": VK_ID_SCOPE,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "provider": VK_ID_PROVIDER_VALUES[provider],
        "v": VK_ID_SDK_VERSION,
        "sdk_type": "vkid",
    }
    if force_login or provider == "mail":
        query["prompt"] = "login"
    return f"{VK_ID_AUTHORIZE_URL}?{urlencode(query)}"


def exchange_vk_id_code(
    *,
    client_id: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
    device_id: str,
    state: str,
) -> str:
    query = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "device_id": device_id,
        "state": state,
    }
    try:
        response = requests.post(
            f"{VK_ID_TOKEN_URL}?{urlencode(query)}",
            data={"code": code},
            timeout=(4, 12),
        )
    except requests.RequestException as exc:
        raise VKIDOAuthError("Failed to reach VK ID token endpoint") from exc

    try:
        payload: Any = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 500:
        raise VKIDOAuthError(f"VK ID token endpoint is unavailable ({response.status_code})")
    if response.status_code >= 400 or not isinstance(payload, dict):
        provider_error = str(payload.get("error") or "").strip()
        provider_detail = str(payload.get("error_description") or payload.get("error") or "").strip()
        raise VKIDOAuthError(
            provider_detail or "VK ID rejected the authorization code",
            code=provider_error or "provider_error",
        )

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise VKIDOAuthError("VK ID response did not include an access token", code="missing_access_token")
    return access_token


def fetch_vk_id_identity(
    *,
    access_token: str,
    client_id: str,
    provider: Literal["vk", "mail"],
) -> VKIDIdentity:
    try:
        response = requests.post(
            f"{VK_ID_USERINFO_URL}?{urlencode({'client_id': client_id})}",
            data={"access_token": access_token},
            timeout=(4, 12),
        )
    except requests.RequestException as exc:
        raise VKIDOAuthError("Failed to reach VK ID user information endpoint") from exc

    try:
        payload: Any = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 500:
        raise VKIDOAuthError(f"VK ID user information endpoint is unavailable ({response.status_code})")
    if response.status_code >= 400 or not isinstance(payload, dict):
        provider_error = str(payload.get("error") or "").strip()
        provider_detail = str(payload.get("error_description") or payload.get("error") or "").strip()
        raise VKIDOAuthError(
            provider_detail or "VK ID user information request was rejected",
            code=provider_error or "user_info_rejected",
        )

    user_payload = payload.get("user")
    if not isinstance(user_payload, dict):
        raise VKIDOAuthError("VK ID user information response is invalid", code="invalid_user_info")
    subject = str(user_payload.get("user_id") or payload.get("user_id") or "").strip()
    email = str(user_payload.get("email") or payload.get("email") or "").strip().lower()
    if not subject:
        raise VKIDOAuthError("VK ID account identifier is missing", code="missing_user_id")

    display_name = " ".join(
        part
        for part in (
            str(user_payload.get("first_name") or "").strip(),
            str(user_payload.get("last_name") or "").strip(),
        )
        if part
    ) or None
    avatar_url = str(user_payload.get("avatar") or "").strip() or None
    return VKIDIdentity(
        subject=subject,
        email=email,
        display_name=display_name,
        avatar_url=avatar_url,
        provider=provider,
    )
