from __future__ import annotations

import math
import secrets
import smtplib
from datetime import datetime
from email.message import EmailMessage
from threading import Lock

import requests
from requests.adapters import HTTPAdapter

from app.config import settings

EMAIL_RESEND_TRACKER: dict[str, datetime] = {}
EMAIL_RESEND_TRACKER_LOCK = Lock()

HTTP_SESSION = requests.Session()
HTTP_ADAPTER = HTTPAdapter(
    pool_connections=max(settings.http_pool_connections, 1),
    pool_maxsize=max(settings.http_pool_maxsize, 1),
)
HTTP_SESSION.mount("https://", HTTP_ADAPTER)
HTTP_SESSION.mount("http://", HTTP_ADAPTER)


def generate_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def get_resend_cooldown_remaining_seconds(email: str, now: datetime) -> int:
    cooldown_seconds = max(settings.email_verification_resend_cooldown_seconds, 0)
    if cooldown_seconds <= 0:
        return 0

    with EMAIL_RESEND_TRACKER_LOCK:
        last_sent_at = EMAIL_RESEND_TRACKER.get(email)

    if last_sent_at is None:
        return 0

    elapsed_seconds = (now - last_sent_at).total_seconds()
    remaining_seconds = max(math.ceil(cooldown_seconds - elapsed_seconds), 0)
    if remaining_seconds > 0:
        return remaining_seconds

    with EMAIL_RESEND_TRACKER_LOCK:
        if EMAIL_RESEND_TRACKER.get(email) == last_sent_at:
            EMAIL_RESEND_TRACKER.pop(email, None)

    return 0


def mark_verification_code_sent(email: str, now: datetime) -> None:
    if settings.email_verification_resend_cooldown_seconds <= 0:
        return

    with EMAIL_RESEND_TRACKER_LOCK:
        EMAIL_RESEND_TRACKER[email] = now


def clear_verification_code_cooldown(email: str) -> None:
    with EMAIL_RESEND_TRACKER_LOCK:
        EMAIL_RESEND_TRACKER.pop(email, None)


def _build_mail_from_header_for_email(from_email: str) -> str:
    if settings.smtp_from_name:
        return f"{settings.smtp_from_name} <{from_email}>"
    return from_email


def _build_mail_from_header() -> str:
    return _build_mail_from_header_for_email(settings.smtp_from_email)


def _send_email_verification_code_via_resend(
    *,
    recipient_email: str,
    from_header: str,
    subject: str,
    text_body: str,
) -> None:
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": from_header,
        "to": [recipient_email],
        "subject": subject,
        "text": text_body,
    }

    try:
        response = HTTP_SESSION.post(
            settings.resend_api_url,
            json=payload,
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach Resend API") from exc

    if response.status_code >= 400:
        detail = ""
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None

        if isinstance(error_payload, dict):
            detail = str(error_payload.get("message") or error_payload.get("error") or "").strip()

        if detail:
            raise RuntimeError(f"Resend API error ({response.status_code}): {detail}")
        raise RuntimeError(f"Resend API error ({response.status_code})")


def send_email_verification_code(recipient_email: str, verification_code: str) -> None:
    ttl_minutes = max(settings.email_verification_code_ttl_minutes, 1)
    message = EmailMessage()
    message["Subject"] = "MoRius: РєРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ email"
    message["From"] = _build_mail_from_header()
    message["To"] = recipient_email
    message.set_content(
        "РљРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РґР»СЏ СЂРµРіРёСЃС‚СЂР°С†РёРё РІ MoRius:\n"
        f"{verification_code}\n\n"
        f"РљРѕРґ РґРµР№СЃС‚РІСѓРµС‚ {ttl_minutes} РјРёРЅСѓС‚.\n"
        "Р•СЃР»Рё РІС‹ РЅРµ Р·Р°РїСЂР°С€РёРІР°Р»Рё РєРѕРґ, РїСЂРѕСЃС‚Рѕ РїСЂРѕРёРіРЅРѕСЂРёСЂСѓР№С‚Рµ СЌС‚Рѕ РїРёСЃСЊРјРѕ."
    )

    if settings.resend_api_key:
        if not settings.resend_from_email:
            raise RuntimeError("RESEND_FROM_EMAIL is required when RESEND_API_KEY is set")

        _send_email_verification_code_via_resend(
            recipient_email=recipient_email,
            from_header=_build_mail_from_header_for_email(settings.resend_from_email),
            subject=str(message["Subject"]),
            text_body=message.get_content(),
        )
        return

    if not settings.smtp_host:
        raise RuntimeError(
            "Email provider is not configured. Set RESEND_API_KEY + RESEND_FROM_EMAIL, "
            "or configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL and SMTP_FROM_NAME."
        )

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.ehlo()
        if settings.smtp_use_tls:
            smtp.starttls()
            smtp.ehlo()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def close_http_session() -> None:
    HTTP_SESSION.close()
