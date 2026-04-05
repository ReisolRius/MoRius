from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateReport,
    StoryCommunityInstructionTemplateRating,
    StoryInstructionTemplate,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryCommunityInstructionTemplateSummaryOut,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryInstructionTemplateCreateRequest,
    StoryInstructionTemplateOut,
    StoryInstructionTemplateUpdateRequest,
)
from app.services.auth_identity import get_current_user
from app.services.concurrency import (
    apply_story_instruction_template_rating_insert,
    apply_story_instruction_template_rating_update,
    increment_story_instruction_template_additions,
)
from app.services.story_cards import (
    STORY_TEMPLATE_VISIBILITY_PRIVATE,
    STORY_TEMPLATE_VISIBILITY_PUBLIC,
    coerce_story_instruction_template_visibility,
    normalize_story_instruction_content,
    normalize_story_instruction_template_visibility,
    normalize_story_instruction_title,
    story_instruction_template_rating_average,
    story_instruction_template_to_out,
)
from app.services.story_games import story_author_avatar_url, story_author_name
try:
    from app.services.story_publication_moderation import clear_story_publication_state, mark_story_publication_pending
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    def mark_story_publication_pending(record: object) -> None:
        if hasattr(record, "publication_status"):
            setattr(record, "publication_status", "pending")

    def clear_story_publication_state(record: object) -> None:
        if hasattr(record, "publication_status"):
            setattr(record, "publication_status", "none")
        if hasattr(record, "publication_requested_at"):
            setattr(record, "publication_requested_at", None)
        if hasattr(record, "publication_reviewed_at"):
            setattr(record, "publication_reviewed_at", None)
        if hasattr(record, "publication_reviewer_user_id"):
            setattr(record, "publication_reviewer_user_id", None)
        if hasattr(record, "publication_rejection_reason"):
            setattr(record, "publication_rejection_reason", None)
from app.services.story_queries import (
    get_public_story_instruction_template_or_404,
    get_story_instruction_template_for_user_or_404,
    list_story_instruction_templates,
)
try:
    from app.services.notifications import (
        NOTIFICATION_KIND_MODERATION_QUEUE,
        NOTIFICATION_KIND_MODERATION_REPORT,
        NotificationDraft,
        build_staff_notification_drafts,
        create_user_notifications,
        send_notification_emails,
    )
except Exception:  # pragma: no cover - compatibility fallback for partial deploys
    NOTIFICATION_KIND_MODERATION_QUEUE = "moderation_queue"
    NOTIFICATION_KIND_MODERATION_REPORT = "moderation_report"

    class NotificationDraft:
        def __init__(
            self,
            *,
            user_id: int,
            kind: str,
            title: str,
            body: str,
            action_url: str | None = None,
            actor_user_id: int | None = None,
        ) -> None:
            self.user_id = user_id
            self.kind = kind
            self.title = title
            self.body = body
            self.action_url = action_url
            self.actor_user_id = actor_user_id

    def build_staff_notification_drafts(
        db: Session,
        *,
        kind: str,
        title: str,
        body: str,
        action_url: str | None = None,
        actor_user_id: int | None = None,
    ) -> list[NotificationDraft]:
        _ = (db, kind, title, body, action_url, actor_user_id)
        return []

    def create_user_notifications(db: Session, drafts: list[NotificationDraft]) -> list[object]:
        _ = (db, drafts)
        return []

    def send_notification_emails(db: Session, notifications: list[object]) -> None:
        _ = (db, notifications)
        return None

router = APIRouter()
STORY_INSTRUCTION_TEMPLATE_REPORT_STATUS_OPEN = "open"


def _persist_notifications(db: Session, drafts: list[NotificationDraft]) -> None:
    notifications = create_user_notifications(db, drafts=drafts)
    if not notifications:
        return
    db.commit()
    send_notification_emails(db, notifications)


def _notify_staff(
    db: Session,
    *,
    kind: str,
    title: str,
    body: str,
    action_url: str | None = None,
    actor_user_id: int | None = None,
) -> None:
    _persist_notifications(
        db,
        build_staff_notification_drafts(
            db,
            kind=kind,
            title=title,
            body=body,
            action_url=action_url,
            actor_user_id=actor_user_id,
        ),
    )


def _build_story_community_instruction_template_summary(
    db: Session,
    *,
    user_id: int,
    template: StoryInstructionTemplate,
    user_rating_override: int | None = None,
    is_added_by_user_override: bool | None = None,
    is_reported_by_user_override: bool | None = None,
) -> StoryCommunityInstructionTemplateSummaryOut:
    author = db.scalar(select(User).where(User.id == template.user_id))
    if user_rating_override is None:
        user_rating_value = db.scalar(
            select(StoryCommunityInstructionTemplateRating.rating).where(
                StoryCommunityInstructionTemplateRating.template_id == template.id,
                StoryCommunityInstructionTemplateRating.user_id == user_id,
            )
        )
        user_rating = int(user_rating_value) if user_rating_value is not None else None
    else:
        user_rating = int(user_rating_override)

    if is_added_by_user_override is None:
        user_template_copy_id = db.scalar(
            select(StoryInstructionTemplate.id).where(
                StoryInstructionTemplate.user_id == user_id,
                StoryInstructionTemplate.source_template_id == template.id,
            )
        )
        is_added_by_user = user_template_copy_id is not None
    else:
        is_added_by_user = bool(is_added_by_user_override)

    if is_reported_by_user_override is None:
        user_report_id = db.scalar(
            select(StoryCommunityInstructionTemplateReport.id).where(
                StoryCommunityInstructionTemplateReport.template_id == template.id,
                StoryCommunityInstructionTemplateReport.reporter_user_id == user_id,
            )
        )
        is_reported_by_user = user_report_id is not None
    else:
        is_reported_by_user = bool(is_reported_by_user_override)

    return StoryCommunityInstructionTemplateSummaryOut(
        id=template.id,
        title=template.title,
        content=template.content,
        visibility=coerce_story_instruction_template_visibility(getattr(template, "visibility", None)),
        author_id=template.user_id,
        author_name=story_author_name(author),
        author_avatar_url=story_author_avatar_url(author),
        community_rating_avg=story_instruction_template_rating_average(template),
        community_rating_count=max(int(getattr(template, "community_rating_count", 0) or 0), 0),
        community_additions_count=max(int(getattr(template, "community_additions_count", 0) or 0), 0),
        user_rating=user_rating,
        is_added_by_user=is_added_by_user,
        is_reported_by_user=is_reported_by_user,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def _create_story_instruction_template_publication_copy_from_source(
    db: Session,
    *,
    source_template: StoryInstructionTemplate,
) -> StoryInstructionTemplate:
    publication = StoryInstructionTemplate(
        user_id=source_template.user_id,
        title=source_template.title,
        content=source_template.content,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
        source_template_id=source_template.id,
        community_rating_sum=0,
        community_rating_count=0,
        community_additions_count=0,
    )
    db.add(publication)
    db.flush()
    return publication


def _delete_story_instruction_template_with_relations(db: Session, *, template_id: int) -> None:
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateRating).where(
            StoryCommunityInstructionTemplateRating.template_id == template_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateAddition).where(
            StoryCommunityInstructionTemplateAddition.template_id == template_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityInstructionTemplateReport).where(
            StoryCommunityInstructionTemplateReport.template_id == template_id,
        )
    )
    template = db.scalar(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id == template_id))
    if template is not None:
        db.delete(template)


def _get_story_instruction_template_publication_copy(
    db: Session,
    *,
    source_template_id: int,
) -> StoryInstructionTemplate | None:
    return db.scalar(
        select(StoryInstructionTemplate)
        .where(StoryInstructionTemplate.source_template_id == source_template_id)
        .order_by(StoryInstructionTemplate.id.asc())
    )


@router.get("/api/story/instruction-templates", response_model=list[StoryInstructionTemplateOut])
def list_story_instruction_templates_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryInstructionTemplateOut]:
    user = get_current_user(db, authorization)
    templates = list_story_instruction_templates(db, user.id)
    return [story_instruction_template_to_out(template) for template in templates]


@router.get("/api/story/community/instruction-templates", response_model=list[StoryCommunityInstructionTemplateSummaryOut])
def list_story_community_instruction_templates(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityInstructionTemplateSummaryOut]:
    user = get_current_user(db, authorization)
    templates = db.scalars(
        select(StoryInstructionTemplate)
        .where(
            StoryInstructionTemplate.visibility == "public",
        )
        .order_by(
            StoryInstructionTemplate.community_additions_count.desc(),
            StoryInstructionTemplate.community_rating_count.desc(),
            StoryInstructionTemplate.id.desc(),
        )
        .limit(80)
    ).all()
    if not templates:
        return []

    template_ids = [template.id for template in templates]
    author_ids = sorted({template.user_id for template in templates})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityInstructionTemplateRating).where(
            StoryCommunityInstructionTemplateRating.user_id == user.id,
            StoryCommunityInstructionTemplateRating.template_id.in_(template_ids),
        )
    ).all()
    user_rating_by_template_id = {row.template_id: int(row.rating) for row in user_rating_rows}

    user_added_template_source_ids = db.scalars(
        select(StoryInstructionTemplate.source_template_id).where(
            StoryInstructionTemplate.user_id == user.id,
            StoryInstructionTemplate.source_template_id.in_(template_ids),
        )
    ).all()
    added_template_ids = {
        int(source_template_id)
        for source_template_id in user_added_template_source_ids
        if isinstance(source_template_id, int)
    }

    user_report_rows = db.scalars(
        select(StoryCommunityInstructionTemplateReport).where(
            StoryCommunityInstructionTemplateReport.reporter_user_id == user.id,
            StoryCommunityInstructionTemplateReport.template_id.in_(template_ids),
        )
    ).all()
    reported_template_ids = {row.template_id for row in user_report_rows}

    return [
        StoryCommunityInstructionTemplateSummaryOut(
            id=template.id,
            title=template.title,
            content=template.content,
            visibility=coerce_story_instruction_template_visibility(getattr(template, "visibility", None)),
            author_id=template.user_id,
            author_name=author_name_by_id.get(template.user_id, "Unknown"),
            author_avatar_url=author_avatar_by_id.get(template.user_id),
            community_rating_avg=story_instruction_template_rating_average(template),
            community_rating_count=max(int(getattr(template, "community_rating_count", 0) or 0), 0),
            community_additions_count=max(int(getattr(template, "community_additions_count", 0) or 0), 0),
            user_rating=user_rating_by_template_id.get(template.id),
            is_added_by_user=template.id in added_template_ids,
            is_reported_by_user=template.id in reported_template_ids,
            created_at=template.created_at,
            updated_at=template.updated_at,
        )
        for template in templates
    ]


@router.get("/api/story/community/instruction-templates/{template_id}", response_model=StoryCommunityInstructionTemplateSummaryOut)
def get_story_community_instruction_template(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityInstructionTemplateSummaryOut:
    user = get_current_user(db, authorization)
    template = get_public_story_instruction_template_or_404(db, template_id)
    return _build_story_community_instruction_template_summary(
        db,
        user_id=user.id,
        template=template,
    )


@router.post("/api/story/community/instruction-templates/{template_id}/rating", response_model=StoryCommunityInstructionTemplateSummaryOut)
def rate_story_community_instruction_template(
    template_id: int,
    payload: StoryCommunityWorldRatingRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityInstructionTemplateSummaryOut:
    user = get_current_user(db, authorization)
    template = get_public_story_instruction_template_or_404(db, template_id)
    rating_value = int(payload.rating)
    if rating_value <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rating should be between 1 and 5")

    existing_rating = db.scalar(
        select(StoryCommunityInstructionTemplateRating).where(
            StoryCommunityInstructionTemplateRating.template_id == template.id,
            StoryCommunityInstructionTemplateRating.user_id == user.id,
        )
    )
    if existing_rating is None:
        inserted_rating: StoryCommunityInstructionTemplateRating | None = None
        try:
            with db.begin_nested():
                inserted_rating = StoryCommunityInstructionTemplateRating(
                    template_id=template.id,
                    user_id=user.id,
                    rating=rating_value,
                )
                db.add(inserted_rating)
                db.flush()
            apply_story_instruction_template_rating_insert(db, template.id, rating_value)
            existing_rating = inserted_rating
        except IntegrityError:
            existing_rating = db.scalar(
                select(StoryCommunityInstructionTemplateRating).where(
                    StoryCommunityInstructionTemplateRating.template_id == template.id,
                    StoryCommunityInstructionTemplateRating.user_id == user.id,
                )
            )

    if existing_rating is not None:
        previous_rating = int(existing_rating.rating)
        if previous_rating != rating_value:
            existing_rating.rating = rating_value
            apply_story_instruction_template_rating_update(db, template.id, rating_value - previous_rating)

    db.commit()
    db.refresh(template)
    return _build_story_community_instruction_template_summary(
        db,
        user_id=user.id,
        template=template,
        user_rating_override=rating_value,
    )


@router.post("/api/story/community/instruction-templates/{template_id}/report", response_model=StoryCommunityInstructionTemplateSummaryOut)
def report_story_community_instruction_template(
    template_id: int,
    payload: StoryCommunityWorldReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityInstructionTemplateSummaryOut:
    user = get_current_user(db, authorization)
    template = get_public_story_instruction_template_or_404(db, template_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report description should not be empty",
        )

    existing_report_id = db.scalar(
        select(StoryCommunityInstructionTemplateReport.id).where(
            StoryCommunityInstructionTemplateReport.template_id == template.id,
            StoryCommunityInstructionTemplateReport.reporter_user_id == user.id,
        )
    )
    if existing_report_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this instruction template",
        )

    db.add(
        StoryCommunityInstructionTemplateReport(
            template_id=template.id,
            reporter_user_id=user.id,
            reason=payload.reason,
            description=description,
            status=STORY_INSTRUCTION_TEMPLATE_REPORT_STATUS_OPEN,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this instruction template",
        ) from None

    reporter_name = story_author_name(user)
    template_title = str(template.title or "").strip() or f"Карточка #{int(template.id)}"
    _notify_staff(
        db,
        kind=NOTIFICATION_KIND_MODERATION_REPORT,
        title="Новая жалоба на инструкцию",
        body=f"{reporter_name} отправил жалобу на инструкцию \"{template_title}\".",
        action_url="/profile",
        actor_user_id=int(user.id),
    )
    db.refresh(template)
    return _build_story_community_instruction_template_summary(
        db,
        user_id=user.id,
        template=template,
        is_reported_by_user_override=True,
    )


@router.post("/api/story/community/instruction-templates/{template_id}/add", response_model=StoryCommunityInstructionTemplateSummaryOut)
def add_story_community_instruction_template_to_account(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityInstructionTemplateSummaryOut:
    user = get_current_user(db, authorization)
    template = get_public_story_instruction_template_or_404(db, template_id)
    if template.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot add your own public instruction template",
        )

    existing_addition_id = db.scalar(
        select(StoryCommunityInstructionTemplateAddition.id).where(
            StoryCommunityInstructionTemplateAddition.template_id == template.id,
            StoryCommunityInstructionTemplateAddition.user_id == user.id,
        )
    )
    addition_inserted = False
    if existing_addition_id is None:
        try:
            with db.begin_nested():
                db.add(
                    StoryCommunityInstructionTemplateAddition(
                        template_id=template.id,
                        user_id=user.id,
                    )
                )
                db.flush()
            addition_inserted = True
        except IntegrityError:
            addition_inserted = False

    if addition_inserted:
        increment_story_instruction_template_additions(db, template.id)

    existing_copy_id = db.scalar(
        select(StoryInstructionTemplate.id).where(
            StoryInstructionTemplate.user_id == user.id,
            StoryInstructionTemplate.source_template_id == template.id,
        )
    )
    if existing_copy_id is None:
        db.add(
            StoryInstructionTemplate(
                user_id=user.id,
                title=template.title,
                content=template.content,
                visibility=STORY_TEMPLATE_VISIBILITY_PRIVATE,
                source_template_id=template.id,
                community_rating_sum=0,
                community_rating_count=0,
                community_additions_count=0,
            )
        )

    db.commit()
    db.refresh(template)
    return _build_story_community_instruction_template_summary(
        db,
        user_id=user.id,
        template=template,
        is_added_by_user_override=True,
    )


@router.post("/api/story/instruction-templates", response_model=StoryInstructionTemplateOut)
def create_story_instruction_template(
    payload: StoryInstructionTemplateCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionTemplateOut:
    user = get_current_user(db, authorization)
    requested_visibility = normalize_story_instruction_template_visibility(payload.visibility)
    template = StoryInstructionTemplate(
        user_id=user.id,
        title=normalize_story_instruction_title(payload.title),
        content=normalize_story_instruction_content(payload.content),
        visibility=STORY_TEMPLATE_VISIBILITY_PRIVATE,
        source_template_id=None,
        community_rating_sum=0,
        community_rating_count=0,
        community_additions_count=0,
    )
    db.add(template)
    db.flush()
    if requested_visibility == STORY_TEMPLATE_VISIBILITY_PUBLIC:
        mark_story_publication_pending(template)
    db.commit()
    db.refresh(template)
    if requested_visibility == STORY_TEMPLATE_VISIBILITY_PUBLIC:
        template_title = str(template.title or "").strip() or f"Карточка #{int(template.id)}"
        author_name = story_author_name(user)
        _notify_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Новая инструкция на модерации",
            body=f"{author_name} отправил на модерацию инструкцию \"{template_title}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return story_instruction_template_to_out(template)


@router.patch("/api/story/instruction-templates/{template_id}", response_model=StoryInstructionTemplateOut)
def update_story_instruction_template(
    template_id: int,
    payload: StoryInstructionTemplateUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryInstructionTemplateOut:
    user = get_current_user(db, authorization)
    template = get_story_instruction_template_for_user_or_404(db, user.id, template_id)
    previous_publication_status = str(getattr(template, "publication_status", "") or "").strip().lower()
    template.title = normalize_story_instruction_title(payload.title)
    template.content = normalize_story_instruction_content(payload.content)
    requested_visibility: str | None = None
    should_notify_publication_queue = False
    if payload.visibility is not None:
        requested_visibility = normalize_story_instruction_template_visibility(payload.visibility)
    if requested_visibility is not None:
        if requested_visibility == STORY_TEMPLATE_VISIBILITY_PUBLIC and template.source_template_id is None:
            mark_story_publication_pending(template)
            template.visibility = STORY_TEMPLATE_VISIBILITY_PRIVATE
            should_notify_publication_queue = previous_publication_status != "pending"
        else:
            if requested_visibility == STORY_TEMPLATE_VISIBILITY_PRIVATE and template.source_template_id is None:
                clear_story_publication_state(template)
                publication_copy = _get_story_instruction_template_publication_copy(
                    db,
                    source_template_id=int(template.id),
                )
                if publication_copy is not None:
                    _delete_story_instruction_template_with_relations(db, template_id=int(publication_copy.id))
            template.visibility = requested_visibility
    db.commit()
    db.refresh(template)
    if should_notify_publication_queue:
        template_title = str(template.title or "").strip() or f"Карточка #{int(template.id)}"
        author_name = story_author_name(user)
        _notify_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Инструкция отправлена на модерацию",
            body=f"{author_name} отправил на модерацию инструкцию \"{template_title}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return story_instruction_template_to_out(template)


@router.delete("/api/story/instruction-templates/{template_id}", response_model=MessageResponse)
def delete_story_instruction_template(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    template = get_story_instruction_template_for_user_or_404(db, user.id, template_id)
    _delete_story_instruction_template_with_relations(db, template_id=template.id)
    db.commit()
    return MessageResponse(message="Instruction template deleted")
