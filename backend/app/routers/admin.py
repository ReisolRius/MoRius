from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete as sa_delete, func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityWorldComment,
    StoryCharacter,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterReport,
    StoryCommunityCharacterRating,
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityInstructionTemplateReport,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldReport,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    AdminReportListResponse,
    AdminReportOut,
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
from app.services.story_characters import unlink_story_character_from_world_cards
from app.services.story_games import story_author_name

router = APIRouter()

DEFAULT_SEARCH_LIMIT = 30
MAX_SEARCH_LIMIT = 100
SEARCH_QUERY_MAX_LENGTH = 120
STORY_REPORT_STATUS_OPEN = "open"
STORY_REPORT_STATUS_DISMISSED = "dismissed"


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


def _get_world_or_404(db: Session, *, world_id: int) -> StoryGame:
    world = db.scalar(select(StoryGame).where(StoryGame.id == world_id))
    if world is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World not found")
    return world


def _get_character_or_404(db: Session, *, character_id: int) -> StoryCharacter:
    character = db.scalar(select(StoryCharacter).where(StoryCharacter.id == character_id))
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")
    return character


def _get_instruction_template_or_404(db: Session, *, template_id: int) -> StoryInstructionTemplate:
    template = db.scalar(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id == template_id))
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction template not found")
    return template


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


def _author_name_by_user_id(db: Session, *, user_ids: list[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    authors = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    return {int(author.id): story_author_name(author) for author in authors}


def _list_open_world_reports(db: Session) -> list[AdminReportOut]:
    open_reports = db.scalars(
        select(StoryCommunityWorldReport)
        .where(StoryCommunityWorldReport.status == STORY_REPORT_STATUS_OPEN)
        .order_by(StoryCommunityWorldReport.created_at.desc(), StoryCommunityWorldReport.id.desc())
    ).all()
    if not open_reports:
        return []

    world_ids = sorted({int(report.world_id) for report in open_reports})
    worlds = db.scalars(select(StoryGame).where(StoryGame.id.in_(world_ids))).all()
    world_by_id = {int(world.id): world for world in worlds}

    author_ids = sorted({int(world.user_id) for world in worlds})
    author_name_by_id = _author_name_by_user_id(db, user_ids=author_ids)

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
        aggregated[world_id] = {
            "target_type": "world",
            "target_id": world_id,
            "target_title": normalized_title,
            "target_preview_image_url": str(world.cover_image_url or "").strip() or None,
            "target_author_name": author_name_by_id.get(int(world.user_id), "Unknown"),
            "open_reports_count": 1,
            "latest_reason": str(report.reason or "").strip().lower() or "other",
            "latest_description": str(report.description or "").strip(),
            "latest_created_at": report.created_at,
        }

    return [AdminReportOut(**item) for item in aggregated.values()]


def _list_open_character_reports(db: Session) -> list[AdminReportOut]:
    open_reports = db.scalars(
        select(StoryCommunityCharacterReport)
        .where(StoryCommunityCharacterReport.status == STORY_REPORT_STATUS_OPEN)
        .order_by(StoryCommunityCharacterReport.created_at.desc(), StoryCommunityCharacterReport.id.desc())
    ).all()
    if not open_reports:
        return []

    character_ids = sorted({int(report.character_id) for report in open_reports})
    characters = db.scalars(select(StoryCharacter).where(StoryCharacter.id.in_(character_ids))).all()
    character_by_id = {int(character.id): character for character in characters}

    author_ids = sorted({int(character.user_id) for character in characters})
    author_name_by_id = _author_name_by_user_id(db, user_ids=author_ids)

    aggregated: dict[int, dict[str, object]] = {}
    for report in open_reports:
        character = character_by_id.get(int(report.character_id))
        if character is None:
            continue
        character_id = int(character.id)

        existing = aggregated.get(character_id)
        if existing is not None:
            existing["open_reports_count"] = int(existing["open_reports_count"]) + 1
            continue

        normalized_name = str(character.name or "").strip() or f"Character #{character_id}"
        aggregated[character_id] = {
            "target_type": "character",
            "target_id": character_id,
            "target_title": normalized_name,
            "target_preview_image_url": str(character.avatar_url or "").strip() or None,
            "target_author_name": author_name_by_id.get(int(character.user_id), "Unknown"),
            "open_reports_count": 1,
            "latest_reason": str(report.reason or "").strip().lower() or "other",
            "latest_description": str(report.description or "").strip(),
            "latest_created_at": report.created_at,
        }

    return [AdminReportOut(**item) for item in aggregated.values()]


def _list_open_instruction_template_reports(db: Session) -> list[AdminReportOut]:
    open_reports = db.scalars(
        select(StoryCommunityInstructionTemplateReport)
        .where(StoryCommunityInstructionTemplateReport.status == STORY_REPORT_STATUS_OPEN)
        .order_by(StoryCommunityInstructionTemplateReport.created_at.desc(), StoryCommunityInstructionTemplateReport.id.desc())
    ).all()
    if not open_reports:
        return []

    template_ids = sorted({int(report.template_id) for report in open_reports})
    templates = db.scalars(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id.in_(template_ids))).all()
    template_by_id = {int(template.id): template for template in templates}

    author_ids = sorted({int(template.user_id) for template in templates})
    author_name_by_id = _author_name_by_user_id(db, user_ids=author_ids)

    aggregated: dict[int, dict[str, object]] = {}
    for report in open_reports:
        template = template_by_id.get(int(report.template_id))
        if template is None:
            continue
        template_id = int(template.id)

        existing = aggregated.get(template_id)
        if existing is not None:
            existing["open_reports_count"] = int(existing["open_reports_count"]) + 1
            continue

        normalized_title = str(template.title or "").strip() or f"Instruction #{template_id}"
        aggregated[template_id] = {
            "target_type": "instruction_template",
            "target_id": template_id,
            "target_title": normalized_title,
            "target_preview_image_url": None,
            "target_author_name": author_name_by_id.get(int(template.user_id), "Unknown"),
            "open_reports_count": 1,
            "latest_reason": str(report.reason or "").strip().lower() or "other",
            "latest_description": str(report.description or "").strip(),
            "latest_created_at": report.created_at,
        }

    return [AdminReportOut(**item) for item in aggregated.values()]


def _list_open_reports(db: Session) -> list[AdminReportOut]:
    reports = [
        *_list_open_world_reports(db),
        *_list_open_character_reports(db),
        *_list_open_instruction_template_reports(db),
    ]
    return sorted(reports, key=lambda item: item.latest_created_at, reverse=True)


def _close_world_reports(
    *,
    db: Session,
    world_id: int,
    resolved_by_user_id: int,
) -> int:
    open_reports = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == world_id,
            StoryCommunityWorldReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for world were not found")

    now = datetime.now(timezone.utc)
    for report in open_reports:
        report.status = STORY_REPORT_STATUS_DISMISSED
        report.resolved_by_user_id = resolved_by_user_id
        report.resolved_at = now

    db.commit()
    return len(open_reports)


def _close_character_reports(
    *,
    db: Session,
    character_id: int,
    resolved_by_user_id: int,
) -> int:
    open_reports = db.scalars(
        select(StoryCommunityCharacterReport).where(
            StoryCommunityCharacterReport.character_id == character_id,
            StoryCommunityCharacterReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for character were not found")

    now = datetime.now(timezone.utc)
    for report in open_reports:
        report.status = STORY_REPORT_STATUS_DISMISSED
        report.resolved_by_user_id = resolved_by_user_id
        report.resolved_at = now

    db.commit()
    return len(open_reports)


def _close_instruction_template_reports(
    *,
    db: Session,
    template_id: int,
    resolved_by_user_id: int,
) -> int:
    open_reports = db.scalars(
        select(StoryCommunityInstructionTemplateReport).where(
            StoryCommunityInstructionTemplateReport.template_id == template_id,
            StoryCommunityInstructionTemplateReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for instruction template were not found")

    now = datetime.now(timezone.utc)
    for report in open_reports:
        report.status = STORY_REPORT_STATUS_DISMISSED
        report.resolved_by_user_id = resolved_by_user_id
        report.resolved_at = now

    db.commit()
    return len(open_reports)


def _delete_world_with_relations(db: Session, *, world: StoryGame) -> None:
    db.execute(sa_delete(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == world.id))
    db.execute(sa_delete(StoryPlotCardChangeEvent).where(StoryPlotCardChangeEvent.game_id == world.id))
    db.execute(sa_delete(StoryTurnImage).where(StoryTurnImage.game_id == world.id))
    db.execute(sa_delete(StoryMessage).where(StoryMessage.game_id == world.id))
    db.execute(sa_delete(StoryInstructionCard).where(StoryInstructionCard.game_id == world.id))
    db.execute(sa_delete(StoryPlotCard).where(StoryPlotCard.game_id == world.id))
    db.execute(sa_delete(StoryWorldCard).where(StoryWorldCard.game_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldComment).where(StoryCommunityWorldComment.world_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldRating).where(StoryCommunityWorldRating.world_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldView).where(StoryCommunityWorldView.world_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldLaunch).where(StoryCommunityWorldLaunch.world_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldFavorite).where(StoryCommunityWorldFavorite.world_id == world.id))
    db.execute(sa_delete(StoryCommunityWorldReport).where(StoryCommunityWorldReport.world_id == world.id))
    db.delete(world)


def _delete_character_with_relations(db: Session, *, character: StoryCharacter) -> None:
    db.execute(sa_delete(StoryCommunityCharacterRating).where(StoryCommunityCharacterRating.character_id == character.id))
    db.execute(sa_delete(StoryCommunityCharacterAddition).where(StoryCommunityCharacterAddition.character_id == character.id))
    db.execute(sa_delete(StoryCommunityCharacterReport).where(StoryCommunityCharacterReport.character_id == character.id))
    unlink_story_character_from_world_cards(db, character_id=character.id)
    db.delete(character)


def _delete_instruction_template_with_relations(db: Session, *, template: StoryInstructionTemplate) -> None:
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateRating).where(
            StoryCommunityInstructionTemplateRating.template_id == template.id
        )
    )
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateAddition).where(
            StoryCommunityInstructionTemplateAddition.template_id == template.id
        )
    )
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateReport).where(
            StoryCommunityInstructionTemplateReport.template_id == template.id
        )
    )
    db.delete(template)


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
            detail="Insufficient sols for subtraction",
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


@router.get("/api/auth/admin/reports", response_model=AdminReportListResponse)
def list_reports(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminReportListResponse:
    _get_admin_user(db=db, authorization=authorization)
    return AdminReportListResponse(reports=_list_open_reports(db))


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
    )
    return MessageResponse(message=f"Dismissed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/worlds/{world_id}/remove", response_model=MessageResponse)
def remove_world_by_reports(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    _get_admin_user(db=db, authorization=authorization)
    open_reports = db.scalars(
        select(StoryCommunityWorldReport).where(
            StoryCommunityWorldReport.world_id == world_id,
            StoryCommunityWorldReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for world were not found")

    world = _get_world_or_404(db, world_id=world_id)
    closed_reports_count = len(open_reports)
    _delete_world_with_relations(db, world=world)
    db.commit()
    return MessageResponse(message=f"World deleted permanently. Closed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/characters/{character_id}/dismiss", response_model=MessageResponse)
def dismiss_character_reports(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    closed_reports_count = _close_character_reports(
        db=db,
        character_id=character_id,
        resolved_by_user_id=int(admin_user.id),
    )
    return MessageResponse(message=f"Dismissed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/characters/{character_id}/remove", response_model=MessageResponse)
def remove_character_by_reports(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    _get_admin_user(db=db, authorization=authorization)
    open_reports = db.scalars(
        select(StoryCommunityCharacterReport).where(
            StoryCommunityCharacterReport.character_id == character_id,
            StoryCommunityCharacterReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for character were not found")

    character = _get_character_or_404(db, character_id=character_id)
    closed_reports_count = len(open_reports)
    _delete_character_with_relations(db, character=character)
    db.commit()
    return MessageResponse(message=f"Character deleted permanently. Closed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/instruction-templates/{template_id}/dismiss", response_model=MessageResponse)
def dismiss_instruction_template_reports(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    closed_reports_count = _close_instruction_template_reports(
        db=db,
        template_id=template_id,
        resolved_by_user_id=int(admin_user.id),
    )
    return MessageResponse(message=f"Dismissed reports: {closed_reports_count}")


@router.post("/api/auth/admin/reports/instruction-templates/{template_id}/remove", response_model=MessageResponse)
def remove_instruction_template_by_reports(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    _get_admin_user(db=db, authorization=authorization)
    open_reports = db.scalars(
        select(StoryCommunityInstructionTemplateReport).where(
            StoryCommunityInstructionTemplateReport.template_id == template_id,
            StoryCommunityInstructionTemplateReport.status == STORY_REPORT_STATUS_OPEN,
        )
    ).all()
    if not open_reports:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Open reports for instruction template were not found")

    template = _get_instruction_template_or_404(db, template_id=template_id)
    closed_reports_count = len(open_reports)
    _delete_instruction_template_with_relations(db, template=template)
    db.commit()
    return MessageResponse(message=f"Instruction template deleted permanently. Closed reports: {closed_reports_count}")
