from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    CoinPurchase,
    StoryBugReport,
    StoryCharacter,
    StoryCharacterEmotionGenerationJob,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterRating,
    StoryCommunityCharacterReport,
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityInstructionTemplateReport,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionTemplate,
    User,
    UserFollow,
    UserNotification,
)

logger = logging.getLogger(__name__)

_ROLE_PRIORITY = {
    "user": 0,
    "moderator": 1,
    "administrator": 2,
}
MERGED_AUTH_PROVIDER = "merged"
MERGED_EMAIL_DOMAIN = "@merged.morius.local"


def normalize_email_casefold(email: str) -> str:
    return str(email or "").strip().lower()


def is_merged_user_account(user: User | None) -> bool:
    if user is None:
        return False
    normalized_email = normalize_email_casefold(getattr(user, "email", ""))
    normalized_provider = str(getattr(user, "auth_provider", "") or "").strip().lower()
    return normalized_provider == MERGED_AUTH_PROVIDER or normalized_email.endswith(MERGED_EMAIL_DOMAIN)


def list_users_by_email_case_insensitive(db: Session, email: str) -> list[User]:
    normalized_email = normalize_email_casefold(email)
    if not normalized_email:
        return []
    return list(
        db.scalars(
            select(User)
            .where(func.lower(func.trim(User.email)) == normalized_email)
            .order_by(User.created_at.asc(), User.id.asc())
        ).all()
    )


def find_user_by_email_case_insensitive(db: Session, email: str) -> User | None:
    users = list_users_by_email_case_insensitive(db, email)
    return users[0] if users else None


def repair_duplicate_users_for_email(
    db: Session,
    email: str,
    *,
    preferred_user_id: int | None = None,
) -> tuple[User | None, bool]:
    normalized_email = normalize_email_casefold(email)
    if not normalized_email:
        return None, False

    matched_users = list_users_by_email_case_insensitive(db, normalized_email)
    if not matched_users:
        return None, False

    changed = False
    target_user = _choose_merge_target(db, matched_users, preferred_user_id=preferred_user_id)
    if normalize_email_casefold(target_user.email) != normalized_email or target_user.email != normalized_email:
        target_user.email = normalized_email
        changed = True

    for source_user in matched_users:
        if int(source_user.id) == int(target_user.id):
            continue
        logger.warning(
            "Merging duplicate user accounts for normalized_email=%s target_user_id=%s source_user_id=%s",
            normalized_email,
            target_user.id,
            source_user.id,
        )
        _merge_user_into_target(db, target_user=target_user, source_user=source_user, normalized_email=normalized_email)
        changed = True

    return target_user, changed


def repair_all_user_accounts(db: Session) -> int:
    normalized_email_expression = func.lower(func.trim(User.email))
    normalized_emails = [
        str(value)
        for value in db.scalars(
            select(normalized_email_expression)
            .where(func.trim(User.email) != "")
            .group_by(normalized_email_expression)
            .having(func.count(User.id) > 1)
            .order_by(normalized_email_expression.asc())
        ).all()
        if str(value or "").strip()
    ]
    changed_groups = 0
    for normalized_email in normalized_emails:
        _, changed = repair_duplicate_users_for_email(db, normalized_email)
        if changed:
            changed_groups += 1
    return changed_groups


def _choose_merge_target(db: Session, matched_users: list[User], *, preferred_user_id: int | None) -> User:
    if preferred_user_id is not None:
        for user in matched_users:
            if int(user.id) == int(preferred_user_id):
                return user

    return max(
        matched_users,
        key=lambda user: _build_merge_priority(db, user),
    )


def _build_merge_priority(db: Session, user: User) -> tuple[int, int, int, int, int, int, int]:
    game_count = _count_rows(db, StoryGame, StoryGame.user_id, int(user.id))
    character_count = _count_rows(db, StoryCharacter, StoryCharacter.user_id, int(user.id))
    template_count = _count_rows(db, StoryInstructionTemplate, StoryInstructionTemplate.user_id, int(user.id))
    purchase_count = _count_rows(db, CoinPurchase, CoinPurchase.user_id, int(user.id))
    privilege_score = _ROLE_PRIORITY.get(str(user.role or "").strip().lower(), 0)
    credential_score = int(bool((user.password_hash or "").strip())) + int(bool((user.google_sub or "").strip()))
    return (
        game_count,
        character_count + template_count,
        purchase_count,
        credential_score,
        privilege_score,
        int(user.coins or 0),
        -int(user.id),
    )


def _count_rows(db: Session, model, column, user_id: int) -> int:
    value = db.scalar(select(func.count()).select_from(model).where(column == user_id))
    return int(value or 0)


def _merge_user_into_target(db: Session, *, target_user: User, source_user: User, normalized_email: str) -> None:
    _merge_user_profile(target_user=target_user, source_user=source_user, normalized_email=normalized_email)

    _reassign_simple_reference(db, StoryGame, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryInstructionTemplate, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryCharacter, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryCharacterEmotionGenerationJob, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, CoinPurchase, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, UserNotification, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, UserNotification, "actor_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryCommunityWorldComment, "user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryBugReport, "reporter_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryBugReport, "closed_by_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryGame, "publication_reviewer_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryInstructionTemplate, "publication_reviewer_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryCharacter, "publication_reviewer_user_id", source_user.id, target_user.id)

    _reassign_unique_user_reference(
        db,
        StoryCommunityWorldRating,
        user_column_name="user_id",
        key_column_names=("world_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityWorldView,
        user_column_name="user_id",
        key_column_names=("world_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityWorldLaunch,
        user_column_name="user_id",
        key_column_names=("world_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityWorldFavorite,
        user_column_name="user_id",
        key_column_names=("world_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityCharacterRating,
        user_column_name="user_id",
        key_column_names=("character_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityCharacterAddition,
        user_column_name="user_id",
        key_column_names=("character_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityInstructionTemplateRating,
        user_column_name="user_id",
        key_column_names=("template_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityInstructionTemplateAddition,
        user_column_name="user_id",
        key_column_names=("template_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityWorldReport,
        user_column_name="reporter_user_id",
        key_column_names=("world_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityCharacterReport,
        user_column_name="reporter_user_id",
        key_column_names=("character_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )
    _reassign_unique_user_reference(
        db,
        StoryCommunityInstructionTemplateReport,
        user_column_name="reporter_user_id",
        key_column_names=("template_id",),
        source_user_id=source_user.id,
        target_user_id=target_user.id,
    )

    _reassign_simple_reference(db, StoryCommunityWorldReport, "resolved_by_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(db, StoryCommunityCharacterReport, "resolved_by_user_id", source_user.id, target_user.id)
    _reassign_simple_reference(
        db,
        StoryCommunityInstructionTemplateReport,
        "resolved_by_user_id",
        source_user.id,
        target_user.id,
    )

    _reassign_follow_references(db, source_user_id=source_user.id, target_user_id=target_user.id)
    _archive_merged_user(source_user=source_user, normalized_email=normalized_email)


def _merge_user_profile(*, target_user: User, source_user: User, normalized_email: str) -> None:
    if not (target_user.display_name or "").strip() and (source_user.display_name or "").strip():
        target_user.display_name = source_user.display_name
    if not (target_user.profile_description or "").strip() and (source_user.profile_description or "").strip():
        target_user.profile_description = source_user.profile_description
    if not (target_user.avatar_url or "").strip() and (source_user.avatar_url or "").strip():
        target_user.avatar_url = source_user.avatar_url
        target_user.avatar_scale = source_user.avatar_scale or target_user.avatar_scale

    if not (target_user.password_hash or "").strip() and (source_user.password_hash or "").strip():
        target_user.password_hash = source_user.password_hash

    source_google_sub = (source_user.google_sub or "").strip()
    target_google_sub = (target_user.google_sub or "").strip()
    if source_google_sub:
        if not target_google_sub:
            target_user.google_sub = source_google_sub
        elif target_google_sub != source_google_sub:
            logger.warning(
                "Merging duplicate users with conflicting google_sub values for normalized_email=%s target_user_id=%s source_user_id=%s",
                normalized_email,
                target_user.id,
                source_user.id,
            )
        source_user.google_sub = None

    target_user.auth_provider = _provider_union(target_user.auth_provider, source_user.auth_provider)
    target_user.role = _prefer_role(target_user.role, source_user.role)
    target_user.level = max(int(target_user.level or 1), int(source_user.level or 1))
    target_user.coins = int(target_user.coins or 0) + int(source_user.coins or 0)
    target_user.notifications_enabled = bool(target_user.notifications_enabled or source_user.notifications_enabled)
    target_user.notify_comment_reply = bool(target_user.notify_comment_reply or source_user.notify_comment_reply)
    target_user.notify_world_comment = bool(target_user.notify_world_comment or source_user.notify_world_comment)
    target_user.notify_publication_review = bool(
        target_user.notify_publication_review or source_user.notify_publication_review
    )
    target_user.notify_new_follower = bool(target_user.notify_new_follower or source_user.notify_new_follower)
    target_user.notify_moderation_report = bool(
        target_user.notify_moderation_report or source_user.notify_moderation_report
    )
    target_user.notify_moderation_queue = bool(
        target_user.notify_moderation_queue or source_user.notify_moderation_queue
    )
    target_user.email_notifications_enabled = bool(
        target_user.email_notifications_enabled or source_user.email_notifications_enabled
    )

    if str(target_user.onboarding_guide_state or "").strip() in {"", "{}"} and str(source_user.onboarding_guide_state or "").strip() not in {"", "{}"}:
        target_user.onboarding_guide_state = source_user.onboarding_guide_state
    if str(target_user.theme_preferences or "").strip() in {"", "{}"} and str(source_user.theme_preferences or "").strip() not in {"", "{}"}:
        target_user.theme_preferences = source_user.theme_preferences

    target_user.email = normalized_email


def _provider_union(current_provider: str | None, next_provider: str | None) -> str:
    providers = {
        str(value).strip()
        for value in f"{current_provider or ''}+{next_provider or ''}".split("+")
        if str(value).strip()
    }
    return "+".join(sorted(providers)) if providers else "email"


def _prefer_role(current_role: str | None, incoming_role: str | None) -> str:
    current = str(current_role or "").strip().lower() or "user"
    incoming = str(incoming_role or "").strip().lower() or "user"
    return current if _ROLE_PRIORITY.get(current, 0) >= _ROLE_PRIORITY.get(incoming, 0) else incoming


def _reassign_simple_reference(
    db: Session,
    model,
    column_name: str,
    source_user_id: int,
    target_user_id: int,
) -> None:
    if source_user_id == target_user_id:
        return
    rows = db.scalars(select(model).where(getattr(model, column_name) == int(source_user_id))).all()
    for row in rows:
        setattr(row, column_name, int(target_user_id))


def _reassign_unique_user_reference(
    db: Session,
    model,
    *,
    user_column_name: str,
    key_column_names: Iterable[str],
    source_user_id: int,
    target_user_id: int,
) -> None:
    if source_user_id == target_user_id:
        return

    source_rows = db.scalars(select(model).where(getattr(model, user_column_name) == int(source_user_id))).all()
    for row in source_rows:
        filters = [getattr(model, user_column_name) == int(target_user_id), model.id != int(row.id)]
        for key_column_name in key_column_names:
            filters.append(getattr(model, key_column_name) == getattr(row, key_column_name))
        existing_row_id = db.scalar(select(model.id).where(*filters))
        if existing_row_id is not None:
            db.delete(row)
            continue
        setattr(row, user_column_name, int(target_user_id))


def _reassign_follow_references(db: Session, *, source_user_id: int, target_user_id: int) -> None:
    if source_user_id == target_user_id:
        return

    follow_rows = db.scalars(
        select(UserFollow).where(
            or_(
                UserFollow.follower_user_id == int(source_user_id),
                UserFollow.following_user_id == int(source_user_id),
            )
        )
    ).all()

    for row in follow_rows:
        next_follower_user_id = int(target_user_id) if int(row.follower_user_id) == int(source_user_id) else int(row.follower_user_id)
        next_following_user_id = (
            int(target_user_id) if int(row.following_user_id) == int(source_user_id) else int(row.following_user_id)
        )

        if next_follower_user_id == next_following_user_id:
            db.delete(row)
            continue

        existing_follow_id = db.scalar(
            select(UserFollow.id).where(
                UserFollow.follower_user_id == next_follower_user_id,
                UserFollow.following_user_id == next_following_user_id,
                UserFollow.id != int(row.id),
            )
        )
        if existing_follow_id is not None:
            db.delete(row)
            continue

        row.follower_user_id = next_follower_user_id
        row.following_user_id = next_following_user_id


def _archive_merged_user(*, source_user: User, normalized_email: str) -> None:
    source_user.email = _build_archived_email(source_user_id=int(source_user.id), normalized_email=normalized_email)
    source_user.google_sub = None
    source_user.coins = 0
    source_user.auth_provider = MERGED_AUTH_PROVIDER


def _build_archived_email(*, source_user_id: int, normalized_email: str) -> str:
    suffix = f"merged-{source_user_id}-"
    max_local_length = 64
    archived_local = f"{suffix}{normalized_email.split('@', maxsplit=1)[0]}"
    archived_local = archived_local[:max_local_length].rstrip("-._")
    if not archived_local:
        archived_local = f"merged-{source_user_id}"
    archived_email = f"{archived_local}{MERGED_EMAIL_DOMAIN}"
    return archived_email[:320]
