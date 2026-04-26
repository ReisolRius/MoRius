from __future__ import annotations

import logging
from dataclasses import dataclass
from html import escape
from urllib.parse import urlparse

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User, UserNotification
from app.schemas import UserNotificationOut
from app.services.auth_verification import send_email_message
from app.services.media import resolve_media_display_url
from app.services.text_encoding import repair_likely_utf8_mojibake_deep, sanitize_likely_utf8_mojibake

logger = logging.getLogger(__name__)

USER_NOTIFICATION_MAX_LIMIT = 120

NOTIFICATION_KIND_COMMENT_REPLY = "comment_reply"
NOTIFICATION_KIND_WORLD_COMMENT = "world_comment"
NOTIFICATION_KIND_PUBLICATION_REVIEW = "publication_review"
NOTIFICATION_KIND_NEW_FOLLOWER = "new_follower"
NOTIFICATION_KIND_MODERATION_REPORT = "moderation_report"
NOTIFICATION_KIND_MODERATION_QUEUE = "moderation_queue"
MODERATION_NOTIFICATION_ROLE_NAMES = ("administrator", "moderator")


def _sanitize_notification_text(value: str | None) -> str:
    return sanitize_likely_utf8_mojibake(str(value or "").strip())

NOTIFICATION_PREFERENCE_FIELD_BY_KIND = {
    NOTIFICATION_KIND_COMMENT_REPLY: "notify_comment_reply",
    NOTIFICATION_KIND_WORLD_COMMENT: "notify_world_comment",
    NOTIFICATION_KIND_PUBLICATION_REVIEW: "notify_publication_review",
    NOTIFICATION_KIND_NEW_FOLLOWER: "notify_new_follower",
    NOTIFICATION_KIND_MODERATION_REPORT: "notify_moderation_report",
    NOTIFICATION_KIND_MODERATION_QUEUE: "notify_moderation_queue",
}


@dataclass(frozen=True)
class NotificationDraft:
    user_id: int
    kind: str
    title: str
    body: str
    action_url: str | None = None
    actor_user_id: int | None = None


def list_moderation_recipient_user_ids(db: Session) -> list[int]:
    return [
        int(user_id)
        for user_id in db.scalars(select(User.id).where(User.role.in_(MODERATION_NOTIFICATION_ROLE_NAMES))).all()
        if int(user_id or 0) > 0
    ]


def build_staff_notification_drafts(
    db: Session,
    *,
    kind: str,
    title: str,
    body: str,
    action_url: str | None = None,
    actor_user_id: int | None = None,
) -> list[NotificationDraft]:
    drafts: list[NotificationDraft] = []
    for recipient_user_id in list_moderation_recipient_user_ids(db):
        drafts.append(
            NotificationDraft(
                user_id=recipient_user_id,
                kind=kind,
                title=title,
                body=body,
                action_url=action_url,
                actor_user_id=actor_user_id,
            )
        )
    return drafts


def _resolve_user_display_name(user: User | None) -> str | None:
    if user is None:
        return None
    if user.display_name and user.display_name.strip():
        return user.display_name.strip()
    email = str(user.email or "").strip()
    if not email:
        return None
    return email.split("@", maxsplit=1)[0]


def _build_public_action_url(action_url: str | None) -> str | None:
    normalized_action_url = str(action_url or "").strip()
    if not normalized_action_url:
        return None
    if normalized_action_url.startswith("http://") or normalized_action_url.startswith("https://"):
        return normalized_action_url

    candidate_urls = [settings.payments_return_url, *settings.cors_origins]
    for candidate in candidate_urls:
        parsed = urlparse(str(candidate or "").strip())
        if not parsed.scheme or not parsed.netloc:
            continue
        if parsed.hostname in {"localhost", "127.0.0.1"}:
            continue
        return f"{parsed.scheme}://{parsed.netloc}{normalized_action_url}"
    return None


def _build_notification_email_subject(notification: UserNotification) -> str:
    title = _sanitize_notification_text(notification.title) or "Новое уведомление"
    compact_title = title[:96].rstrip()
    return f"MoRius: {compact_title}"


def _build_notification_email_text(notification: UserNotification) -> str:
    lines = [
        _sanitize_notification_text(notification.title) or "Новое уведомление в MoRius",
        "",
        _sanitize_notification_text(notification.body) or "У вас появилось новое уведомление.",
    ]
    action_url = _build_public_action_url(notification.action_url)
    if action_url:
        lines.extend(["", f"Открыть: {action_url}"])
    lines.extend(
        [
            "",
            "Это письмо отправлено автоматически, потому что у вас включены уведомления на почту.",
            "Если письма больше не нужны, выключите их в настройках профиля MoRius.",
        ]
    )
    return "\n".join(lines)


def _build_notification_email_html(notification: UserNotification) -> str:
    title = escape(_sanitize_notification_text(notification.title) or "Новое уведомление в MoRius")
    body = escape(_sanitize_notification_text(notification.body) or "У вас появилось новое уведомление.").replace("\n", "<br />")
    action_url = _build_public_action_url(notification.action_url)
    action_markup = ""
    if action_url:
        safe_url = escape(action_url, quote=True)
        action_markup = (
            f'<a href="{safe_url}" '
            'style="display:inline-block;padding:12px 18px;border-radius:12px;background:#d45555;'
            'color:#f8f8fb;text-decoration:none;font-weight:700;">Открыть в MoRius</a>'
        )
    return (
        "<!doctype html>"
        '<html lang="ru">'
        "<body style=\"margin:0;padding:0;background:#0b0d12;color:#e8ebf2;font-family:Arial,sans-serif;\">"
        '<div style="padding:28px 16px;">'
        '<div style="max-width:640px;margin:0 auto;border:1px solid #2a3140;border-radius:24px;'
        'background:linear-gradient(180deg,#151920 0%,#10141a 100%);overflow:hidden;">'
        '<div style="padding:22px 24px;border-bottom:1px solid #252c39;">'
        '<div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#aeb7c7;">MoRius</div>'
        f'<div style="margin-top:10px;font-size:26px;line-height:1.25;font-weight:800;color:#f3f5fa;">{title}</div>'
        "</div>"
        '<div style="padding:24px;">'
        f'<div style="font-size:15px;line-height:1.7;color:#cfd5e1;">{body}</div>'
        f'<div style="margin-top:24px;">{action_markup}</div>'
        '<div style="margin-top:24px;padding-top:18px;border-top:1px solid #252c39;'
        'font-size:12px;line-height:1.6;color:#8f99ab;">'
        "Это письмо отправлено автоматически, потому что у вас включены уведомления на почту.<br />"
        "Вы можете отключить письма в настройках профиля MoRius."
        "</div>"
        "</div>"
        "</div>"
        "</div>"
        "</body>"
        "</html>"
    )


def is_user_notification_enabled(user: User | None, kind: str | None) -> bool:
    if user is None:
        return False
    if not bool(getattr(user, "notifications_enabled", True)):
        return False
    preference_field = NOTIFICATION_PREFERENCE_FIELD_BY_KIND.get(str(kind or "").strip())
    if not preference_field:
        return True
    return bool(getattr(user, preference_field, True))


def create_user_notifications(db: Session, drafts: list[NotificationDraft]) -> list[UserNotification]:
    notifications: list[UserNotification] = []
    seen_keys: set[tuple[int, str, str, str, str | None, int | None]] = set()
    recipient_ids = sorted({int(draft.user_id) for draft in drafts if int(draft.user_id or 0) > 0})
    recipient_by_id = {
        int(recipient.id): recipient
        for recipient in db.scalars(select(User).where(User.id.in_(recipient_ids))).all()
    } if recipient_ids else {}
    for draft in drafts:
        user_id = int(draft.user_id or 0)
        if user_id <= 0:
            continue
        recipient = recipient_by_id.get(user_id)
        if not is_user_notification_enabled(recipient, draft.kind):
            continue
        title = _sanitize_notification_text(draft.title)
        body = _sanitize_notification_text(draft.body)
        if not title and not body:
            continue
        action_url = _sanitize_notification_text(draft.action_url) or None
        actor_user_id = int(draft.actor_user_id) if draft.actor_user_id is not None else None
        dedupe_key = (user_id, draft.kind, title, body, action_url, actor_user_id)
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        notification = UserNotification(
            user_id=user_id,
            actor_user_id=actor_user_id,
            kind=str(draft.kind or "").strip() or "generic",
            title=title or "Новое уведомление",
            body=body,
            action_url=action_url,
            is_read=False,
        )
        db.add(notification)
        notifications.append(notification)
    if notifications:
        db.flush()
    return notifications


def count_unread_user_notifications(db: Session, *, user_id: int) -> int:
    value = db.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(
            UserNotification.user_id == user_id,
            UserNotification.is_read.is_(False),
        )
    )
    return max(int(value or 0), 0)


def count_total_user_notifications(db: Session, *, user_id: int) -> int:
    value = db.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(UserNotification.user_id == user_id)
    )
    return max(int(value or 0), 0)


def attach_user_notification_unread_count(db: Session, user: User | None) -> User | None:
    if user is None:
        return None
    user.notification_unread_count = count_unread_user_notifications(db, user_id=int(user.id))
    return user


def list_user_notifications_out(
    db: Session,
    *,
    user_id: int,
    limit: int = USER_NOTIFICATION_MAX_LIMIT,
    offset: int = 0,
    sort_desc: bool = True,
) -> list[UserNotificationOut]:
    normalized_limit = max(1, min(int(limit or USER_NOTIFICATION_MAX_LIMIT), USER_NOTIFICATION_MAX_LIMIT))
    normalized_offset = max(0, int(offset or 0))
    order_by = (
        (UserNotification.created_at.desc(), UserNotification.id.desc())
        if sort_desc
        else (UserNotification.created_at.asc(), UserNotification.id.asc())
    )
    rows = db.execute(
        select(UserNotification, User)
        .join(User, User.id == UserNotification.actor_user_id, isouter=True)
        .where(UserNotification.user_id == user_id)
        .order_by(*order_by)
        .offset(normalized_offset)
        .limit(normalized_limit)
    ).all()
    return [
        UserNotificationOut(
            id=int(notification.id),
            kind=str(notification.kind or "").strip() or "generic",
            title=_sanitize_notification_text(notification.title),
            body=_sanitize_notification_text(notification.body),
            action_url=_sanitize_notification_text(notification.action_url) or None,
            is_read=bool(notification.is_read),
            actor_user_id=int(notification.actor_user_id) if notification.actor_user_id is not None else None,
            actor_display_name=_resolve_user_display_name(actor),
            actor_avatar_url=(
                resolve_media_display_url(
                    actor.avatar_url,
                    kind="user-avatar",
                    entity_id=actor.id,
                    version=getattr(actor, "updated_at", None),
                )
                if actor is not None
                else None
            ),
            created_at=notification.created_at,
        )
        for notification, actor in rows
    ]


def mark_all_user_notifications_read(db: Session, *, user_id: int) -> int:
    unread_ids = db.scalars(
        select(UserNotification.id).where(
            UserNotification.user_id == user_id,
            UserNotification.is_read.is_(False),
        )
    ).all()
    if not unread_ids:
        return 0
    db.execute(
        update(UserNotification)
        .where(UserNotification.id.in_(list(unread_ids)))
        .values(is_read=True)
    )
    db.flush()
    return len(unread_ids)


def delete_user_notification(
    db: Session,
    *,
    user_id: int,
    notification_id: int,
) -> bool:
    notification = db.scalar(
        select(UserNotification).where(
            UserNotification.id == notification_id,
            UserNotification.user_id == user_id,
        )
    )
    if notification is None:
        return False
    db.delete(notification)
    db.flush()
    return True


def send_notification_emails(db: Session, notifications: list[UserNotification]) -> None:
    if not notifications:
        return
    recipient_ids = sorted({int(notification.user_id) for notification in notifications if int(notification.user_id or 0) > 0})
    if not recipient_ids:
        return
    recipients = db.scalars(select(User).where(User.id.in_(recipient_ids))).all()
    recipient_by_id = {int(recipient.id): recipient for recipient in recipients}
    for notification in notifications:
        recipient = recipient_by_id.get(int(notification.user_id))
        if recipient is None:
            continue
        if not is_user_notification_enabled(recipient, notification.kind):
            continue
        if not bool(getattr(recipient, "email_notifications_enabled", False)):
            continue
        recipient_email = str(getattr(recipient, "email", "") or "").strip().lower()
        if not recipient_email:
            continue
        try:
            send_email_message(
                recipient_email=recipient_email,
                subject=_build_notification_email_subject(notification),
                text_body=_build_notification_email_text(notification),
                html_body=_build_notification_email_html(notification),
            )
        except Exception:
            logger.exception("Failed to send notification email to user_id=%s notification_id=%s", recipient.id, notification.id)
