from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StoryCommunityWorldReport, StoryGame, User
from app.schemas import (
    AdminWorldReportListResponse,
    AdminWorldReportOut,
    AdminUserBanRequest,
    AdminUserListResponse,
    AdminUserOut,
    AdminUserTokensUpdateRequest,
    MessageResponse,
)
from app.services.auth_identity import (
    get_current_user,
    is_privileged_email,
    sync_user_access_state,
    user_has_admin_panel_access,
)
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.story_games import story_author_name

router = APIRouter()

DEFAULT_SEARCH_LIMIT = 30
MAX_SEARCH_LIMIT = 100
SEARCH_QUERY_MAX_LENGTH = 120
STORY_WORLD_REPORT_STATUS_OPEN = "open"
STORY_WORLD_REPORT_STATUS_DISMISSED = "dismissed"
STORY_WORLD_REPORT_STATUS_WORLD_REMOVED = "world_removed"


def _get_admin_user(
    *,
    db: Session,
    authorization: str | None,
) -> User:
    user = get_current_user(db, authorization)
    if not user_has_admin_panel_access(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin panel access denied",
        )
    return user


def _get_target_user_or_404(db: Session, *, user_id: int) -> User:
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _sync_users_access_state(db: Session, users: list[User]) -> None:
    changed = False
    now = datetime.now(timezone.utc)
    for candidate in users:
        if sync_user_access_state(candidate, now=now):
            changed = True
    if changed:
        db.commit()
        for candidate in users:
            db.refresh(candidate)


def _list_open_world_reports(db: Session) -> list[AdminWorldReportOut]:
    open_reports = db.scalars(
        select(StoryCommunityWorldReport)
        .where(StoryCommunityWorldReport.status == STORY_WORLD_REPORT_STATUS_OPEN)
        .order_by(StoryCommunityWorldReport.created_at.desc(), StoryCommunityWorldReport.id.desc())
    ).all()
    if not open_reports:
        return []

    world_ids = sorted({int(report.world_id) for report in open_reports})
    worlds = db.scalars(select(StoryGame).where(StoryGame.id.in_(world_ids))).all()
    world_by_id = {int(world.id): world for world in worlds}

    author_ids = sorted({int(world.user_id) for world in worlds})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all() if author_ids else []
    author_by_id = {int(author.id): author for author in authors}

    aggregated: dict[int, dict[str, object]] = {}
    for report in open_reports:
        world = world_by_id.get(int(report.world_id))
        if world is None:
            continue

        world_id = int(world.id)
        existing = aggregated.get(world_id)
        if existing is not None:
            existing["open_reports_count"] = int(existing["open_reports_count"]) + 1
            continue

        normalized_title = str(world.title or "").strip() or f"World #{world_id}"
        author_name = story_author_name(author_by_id.get(int(world.user_id)))
        aggregated[world_id] = {
            "world_id": world_id,
            "world_title": normalized_title,
            "world_cover_image_url": str(world.cover_image_url or "").strip() or None,
            "world_author_name": author_name,
            "open_reports_count": 1,
            "latest_reason": str(report.reason or "").strip().lower() or "other",
            "latest_description": str(report.description or "").strip(),
            "latest_created_at": report.created_at,
        }

    report_items = [AdminWorldReportOut(**item) for item in aggregated.values()]
    return sorted(report_items, key=lambda item: item.latest_created_at, reverse=True)


def _close_world_reports(
    *,
    db: Session,
    world_id: int,
    resolved_by_user_id: int,
    final_status: str,
    hide_world_from_community: bool,
) -> int:
    open_reports = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == world_id,
            StoryCommunityWorldReport.status == STORY_WORLD_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for world were not found")

    world = db.scalar(select(StoryGame).where(StoryGame.id == world_id))
    if world is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found")

    if hide_world_from_community:
        world.visibility = "private"

    now = datetime.now(timezone.utc)
    for report in open_reports:
        report.status = final_status
        report.resolved_by_user_id = resolved_by_user_id
        report.resolved_at = now

    db.commit()
    return len(open_reports)


@router.get("/api/auth/admin/users", response_model=AdminUserListResponse)
def search_users(
    query: str = Query(default="", max_length=SEARCH_QUERY_MAX_LENGTH),
    limit: int = Query(default=DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUserListResponse:
    _get_admin_user(db=db, authorization=authorization)

    normalized_query = query.strip().lower()
    statement = (
        select(User)
        .order_by(User.created_at.desc(), User.id.desc())
        .limit(limit)
    )
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                func.lower(User.email).like(pattern),
                func.lower(func.coalesce(User.display_name, "")).like(pattern),
            )
        )

    users = list(db.scalars(statement).all())
    _sync_users_access_state(db, users)
    return AdminUserListResponse(users=[AdminUserOut.model_validate(user) for user in users])


@router.post("/api/auth/admin/users/{user_id}/tokens", response_model=AdminUserOut)
def update_user_tokens(
    user_id: int,
    payload: AdminUserTokensUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    _get_admin_user(db=db, authorization=authorization)
    target_user = _get_target_user_or_404(db, user_id=user_id)

    if payload.operation == "add":
        add_user_tokens(
            db,
            user_id=int(target_user.id),
            tokens=int(payload.amount),
        )
    elif not spend_user_tokens_if_sufficient(
        db,
        user_id=int(target_user.id),
        tokens=int(payload.amount),
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Insufficient tokens for subtraction",
        )

    sync_user_access_state(target_user)
    db.commit()
    db.refresh(target_user)
    return AdminUserOut.model_validate(target_user)


@router.post("/api/auth/admin/users/{user_id}/ban", response_model=AdminUserOut)
def ban_user(
    user_id: int,
    payload: AdminUserBanRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    _get_admin_user(db=db, authorization=authorization)
    target_user = _get_target_user_or_404(db, user_id=user_id)

    if is_privileged_email(target_user.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Privileged accounts cannot be banned",
        )

    target_user.is_banned = True
    target_user.ban_expires_at = (
        datetime.now(timezone.utc) + timedelta(hours=payload.duration_hours)
        if payload.duration_hours is not None
        else None
    )
    sync_user_access_state(target_user)
    db.commit()
    db.refresh(target_user)
    return AdminUserOut.model_validate(target_user)


@router.post("/api/auth/admin/users/{user_id}/unban", response_model=AdminUserOut)
def unban_user(
    user_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    _get_admin_user(db=db, authorization=authorization)
    target_user = _get_target_user_or_404(db, user_id=user_id)

    target_user.is_banned = False
    target_user.ban_expires_at = None
    sync_user_access_state(target_user)
    db.commit()
    db.refresh(target_user)
    return AdminUserOut.model_validate(target_user)


@router.get("/api/auth/admin/reports", response_model=AdminWorldReportListResponse)
def list_world_reports(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminWorldReportListResponse:
    _get_admin_user(db=db, authorization=authorization)
    return AdminWorldReportListResponse(reports=_list_open_world_reports(db))


@router.post("/api/auth/admin/reports/worlds/{world_id}/dismiss", response_model=MessageResponse)
def dismiss_world_reports(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    closed_reports_count = _close_world_reports(
        db=db,
        world_id=world_id,
        resolved_by_user_id=int(admin_user.id),
        final_status=STORY_WORLD_REPORT_STATUS_DISMISSED,
        hide_world_from_community=False,
    )
    return MessageResponse(message=f"Dismissed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/worlds/{world_id}/remove", response_model=MessageResponse)
def remove_world_by_reports(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    closed_reports_count = _close_world_reports(
        db=db,
        world_id=world_id,
        resolved_by_user_id=int(admin_user.id),
        final_status=STORY_WORLD_REPORT_STATUS_WORLD_REMOVED,
        hide_world_from_community=True,
    )
    return MessageResponse(message=f"World removed from community. Closed reports: {closed_reports_count}")
