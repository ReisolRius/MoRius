from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterRating,
    StoryCommunityCharacterReport,
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityInstructionTemplateReport,
    StoryCharacterStateSnapshot,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryCharacter,
    StoryGame,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryMapImage,
    StoryMemoryBlock,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryTurnImage,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)
from app.schemas import (
    AdminModerationAuthorOut,
    AdminModerationCharacterDetailOut,
    AdminModerationCharacterUpdateRequest,
    AdminModerationInstructionTemplateDetailOut,
    AdminModerationInstructionTemplateUpdateRequest,
    AdminModerationQueueItemOut,
    AdminModerationQueueResponse,
    AdminModerationRejectRequest,
    AdminModerationWorldDetailOut,
    AdminModerationWorldUpdateRequest,
    MessageResponse,
    StoryInstructionCardOut,
    StoryPlotCardOut,
    StoryPublicationStateOut,
    StoryWorldCardOut,
)
from app.services.auth_identity import get_current_user, user_has_admin_panel_access
from app.services.story_cards import (
    normalize_story_instruction_content,
    normalize_story_instruction_title,
    normalize_story_plot_card_content,
    normalize_story_plot_card_memory_turns_for_storage,
    normalize_story_plot_card_title,
    normalize_story_plot_card_triggers,
    serialize_story_plot_card_triggers,
    story_instruction_card_to_out,
    story_instruction_template_to_out,
    story_plot_card_to_out,
)
from app.services.story_characters import (
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_description,
    normalize_story_character_name,
    normalize_story_character_note,
    normalize_story_character_triggers,
    serialize_triggers,
    story_character_to_out,
    unlink_story_character_from_world_cards,
)
from app.services.story_games import (
    normalize_story_cover_image_url,
    normalize_story_cover_position,
    normalize_story_cover_scale,
    normalize_story_game_age_rating,
    normalize_story_game_description,
    normalize_story_game_genres,
    normalize_story_game_opening_scene,
    serialize_story_game_genres,
    story_author_avatar_url,
    story_author_name,
    story_game_summary_to_out,
)
from app.services.story_publication_copies import (
    upsert_story_character_publication_copy_from_source,
    upsert_story_game_publication_copy_from_source,
    upsert_story_instruction_template_publication_copy_from_source,
)
from app.services.story_publication_moderation import (
    STORY_PUBLICATION_STATUS_APPROVED,
    STORY_PUBLICATION_STATUS_PENDING,
    clear_story_publication_state,
    coerce_story_publication_status,
    mark_story_publication_pending,
    mark_story_publication_approved,
    mark_story_publication_rejected,
)
try:
    from app.services.notifications import (
        NOTIFICATION_KIND_PUBLICATION_REVIEW,
        NotificationDraft,
        create_user_notifications,
        send_notification_emails,
    )
except ImportError:  # pragma: no cover - keeps moderation router alive on partial legacy installs
    NOTIFICATION_KIND_PUBLICATION_REVIEW = "publication_review"

    @dataclass(frozen=True)
    class NotificationDraft:
        user_id: int
        kind: str
        title: str
        body: str
        action_url: str | None = None
        actor_user_id: int | None = None

    def create_user_notifications(db: Session, drafts: list[NotificationDraft]) -> list[object]:
        return []

    def send_notification_emails(db: Session, notifications: list[object]) -> None:
        return None
from app.services.media import resolve_media_display_url
from app.services.story_queries import (
    list_story_instruction_cards,
    list_story_plot_cards,
    list_story_world_cards,
    touch_story_game,
)
from app.services.story_world_cards import (
    STORY_WORLD_CARD_KIND_NPC,
    normalize_story_npc_profile_content,
    normalize_story_world_card_content,
    normalize_story_world_card_memory_turns_for_storage,
    normalize_story_world_card_title,
    normalize_story_world_card_triggers,
    serialize_story_world_card_triggers,
    story_world_card_to_out,
)

router = APIRouter()
logger = logging.getLogger(__name__)

MODERATION_PREVIEW_MAX_CHARS = 180


def _is_sqlite_locked_error(exc: Exception) -> bool:
    if not isinstance(exc, OperationalError):
        return False
    detail = str(exc).strip().lower()
    return "database is locked" in detail or "database schema is locked" in detail


def _commit_admin_moderation_write(db: Session, *, action_label: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Moderation data changed. Reload the page and try again.",
        ) from exc
    except OperationalError as exc:
        db.rollback()
        if _is_sqlite_locked_error(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Moderation is busy right now. Please try again in a moment.",
            ) from exc
        raise
    except Exception:
        db.rollback()
        logger.exception("Failed while %s", action_label)
        raise


def _get_admin_user(*, db: Session, authorization: str | None) -> User:
    user = get_current_user(db, authorization)
    if not user_has_admin_panel_access(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin panel access denied",
        )
    return user


def _build_publication_state(record, *, is_public: bool = False) -> StoryPublicationStateOut:
    return StoryPublicationStateOut(
        status=coerce_story_publication_status(
            getattr(record, "publication_status", None),
            is_public=is_public,
        ),
        requested_at=getattr(record, "publication_requested_at", None),
        reviewed_at=getattr(record, "publication_reviewed_at", None),
        reviewer_user_id=getattr(record, "publication_reviewer_user_id", None),
        rejection_reason=str(getattr(record, "publication_rejection_reason", "") or "").strip() or None,
    )


def _build_author_out(author: User) -> AdminModerationAuthorOut:
    return AdminModerationAuthorOut(
        id=int(author.id),
        email=author.email,
        display_name=story_author_name(author),
        avatar_url=story_author_avatar_url(author),
        role=str(getattr(author, "role", "") or "").strip() or "user",
    )


def _preview_text(value: str | None) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        return ""
    if len(normalized) <= MODERATION_PREVIEW_MAX_CHARS:
        return normalized
    return f"{normalized[: MODERATION_PREVIEW_MAX_CHARS - 3].rstrip()}..."


def _resolve_admin_preview_url(
    raw_value: str | None,
    *,
    kind: str,
    entity_id: int,
    version,
) -> str | None:
    return resolve_media_display_url(
        raw_value,
        kind=kind,
        entity_id=entity_id,
        version=version,
    )


def _normalize_story_game_title_for_moderation(value: str) -> str:
    normalized = " ".join(str(value or "").split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="World title cannot be empty")
    return normalized[:160].rstrip()


def _ensure_unique_ids(values: list[int], *, entity_name: str) -> None:
    if len(values) != len(set(values)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Duplicate {entity_name} ids are not allowed",
        )


def _get_pending_world_or_404(db: Session, *, world_id: int) -> StoryGame:
    world = db.scalar(
        select(StoryGame).where(
            StoryGame.id == world_id,
            StoryGame.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryGame.visibility != "public",
        )
    )
    if world is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending world submission not found")
    return world


def _get_pending_character_or_404(db: Session, *, character_id: int) -> StoryCharacter:
    character = db.scalar(
        select(StoryCharacter).where(
            StoryCharacter.id == character_id,
            StoryCharacter.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryCharacter.visibility != "public",
        )
    )
    if character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending character submission not found")
    return character


def _get_pending_instruction_template_or_404(db: Session, *, template_id: int) -> StoryInstructionTemplate:
    template = db.scalar(
        select(StoryInstructionTemplate).where(
            StoryInstructionTemplate.id == template_id,
            StoryInstructionTemplate.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryInstructionTemplate.visibility != "public",
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending instruction submission not found")
    return template


def _is_public_visibility(record) -> bool:
    return str(getattr(record, "visibility", "") or "").strip().lower() == "public"


def _get_returnable_world_or_404(db: Session, *, world_id: int) -> tuple[StoryGame, StoryGame | None]:
    target_world = db.scalar(select(StoryGame).where(StoryGame.id == world_id))
    if target_world is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published world not found")

    publication_copy: StoryGame | None = None
    source_world = target_world
    if target_world.source_world_id is not None:
        publication_copy = target_world
        source_world = db.scalar(select(StoryGame).where(StoryGame.id == target_world.source_world_id))
        if source_world is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World source was not found")
    else:
        publication_copy = db.scalar(
            select(StoryGame)
            .where(StoryGame.source_world_id == target_world.id)
            .order_by(StoryGame.id.asc())
        )

    if source_world.source_world_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published world source was not found")

    source_status = coerce_story_publication_status(
        getattr(source_world, "publication_status", None),
        is_public=_is_public_visibility(source_world),
    )
    publication_is_public = publication_copy is not None and _is_public_visibility(publication_copy)
    if source_status != STORY_PUBLICATION_STATUS_APPROVED and not _is_public_visibility(source_world) and not publication_is_public:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published world not found")

    return source_world, publication_copy


def _get_returnable_character_or_404(db: Session, *, character_id: int) -> tuple[StoryCharacter, StoryCharacter | None]:
    target_character = db.scalar(select(StoryCharacter).where(StoryCharacter.id == character_id))
    if target_character is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published character not found")

    publication_copy: StoryCharacter | None = None
    source_character = target_character
    if target_character.source_character_id is not None:
        publication_copy = target_character
        source_character = db.scalar(select(StoryCharacter).where(StoryCharacter.id == target_character.source_character_id))
        if source_character is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character source was not found")
    else:
        publication_copy = db.scalar(
            select(StoryCharacter)
            .where(StoryCharacter.source_character_id == target_character.id)
            .order_by(StoryCharacter.id.asc())
        )

    if source_character.source_character_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published character source was not found")

    source_status = coerce_story_publication_status(
        getattr(source_character, "publication_status", None),
        is_public=_is_public_visibility(source_character),
    )
    publication_is_public = publication_copy is not None and _is_public_visibility(publication_copy)
    if (
        source_status != STORY_PUBLICATION_STATUS_APPROVED
        and not _is_public_visibility(source_character)
        and not publication_is_public
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published character not found")

    return source_character, publication_copy


def _get_returnable_instruction_template_or_404(
    db: Session,
    *,
    template_id: int,
) -> tuple[StoryInstructionTemplate, StoryInstructionTemplate | None]:
    target_template = db.scalar(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id == template_id))
    if target_template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published instruction template not found")

    publication_copy: StoryInstructionTemplate | None = None
    source_template = target_template
    if target_template.source_template_id is not None:
        publication_copy = target_template
        source_template = db.scalar(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id == target_template.source_template_id))
        if source_template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction template source was not found")
    else:
        publication_copy = db.scalar(
            select(StoryInstructionTemplate)
            .where(StoryInstructionTemplate.source_template_id == target_template.id)
            .order_by(StoryInstructionTemplate.id.asc())
        )

    if source_template.source_template_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published instruction template source was not found")

    source_status = coerce_story_publication_status(
        getattr(source_template, "publication_status", None),
        is_public=_is_public_visibility(source_template),
    )
    publication_is_public = publication_copy is not None and _is_public_visibility(publication_copy)
    if (
        source_status != STORY_PUBLICATION_STATUS_APPROVED
        and not _is_public_visibility(source_template)
        and not publication_is_public
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published instruction template not found")

    return source_template, publication_copy


def _get_author_or_404(db: Session, *, user_id: int) -> User:
    author = db.scalar(select(User).where(User.id == user_id))
    if author is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found")
    return author


def _build_world_instruction_cards_out(db: Session, *, game_id: int) -> list[StoryInstructionCardOut]:
    cards_out: list[StoryInstructionCardOut] = []
    for card in list_story_instruction_cards(db, game_id):
        try:
            cards_out.append(story_instruction_card_to_out(card))
        except Exception:
            logger.exception(
                "Skipping invalid instruction card in admin moderation response: game_id=%s card_id=%s",
                game_id,
                getattr(card, "id", None),
            )
    return cards_out


def _build_world_plot_cards_out(db: Session, *, game_id: int) -> list[StoryPlotCardOut]:
    cards_out: list[StoryPlotCardOut] = []
    for card in list_story_plot_cards(db, game_id):
        try:
            cards_out.append(story_plot_card_to_out(card))
        except Exception:
            logger.exception(
                "Skipping invalid plot card in admin moderation response: game_id=%s card_id=%s",
                game_id,
                getattr(card, "id", None),
            )
    return cards_out


def _build_world_world_cards_out(db: Session, *, game_id: int) -> list[StoryWorldCardOut]:
    cards_out: list[StoryWorldCardOut] = []
    for card in list_story_world_cards(db, game_id):
        try:
            cards_out.append(story_world_card_to_out(card))
        except Exception:
            logger.exception(
                "Skipping invalid world card in admin moderation response: game_id=%s card_id=%s",
                game_id,
                getattr(card, "id", None),
            )
    return cards_out


def _build_world_detail_out(db: Session, world: StoryGame, author: User) -> AdminModerationWorldDetailOut:
    return AdminModerationWorldDetailOut(
        author=_build_author_out(author),
        game=story_game_summary_to_out(world),
        instruction_cards=_build_world_instruction_cards_out(db, game_id=int(world.id)),
        plot_cards=_build_world_plot_cards_out(db, game_id=int(world.id)),
        world_cards=_build_world_world_cards_out(db, game_id=int(world.id)),
    )


def _build_character_detail_out(author: User, character: StoryCharacter) -> AdminModerationCharacterDetailOut:
    return AdminModerationCharacterDetailOut(
        author=_build_author_out(author),
        character=story_character_to_out(character, include_emotion_assets=True),
    )


def _build_instruction_template_detail_out(
    author: User,
    template: StoryInstructionTemplate,
) -> AdminModerationInstructionTemplateDetailOut:
    return AdminModerationInstructionTemplateDetailOut(
        author=_build_author_out(author),
        template=story_instruction_template_to_out(template),
    )


def _build_publication_review_notification(
    *,
    target_user_id: int,
    actor_user_id: int,
    title: str,
    body: str,
) -> NotificationDraft:
    return NotificationDraft(
        user_id=target_user_id,
        actor_user_id=actor_user_id,
        kind=NOTIFICATION_KIND_PUBLICATION_REVIEW,
        title=title,
        body=body,
        action_url="/games/publications",
    )


def _build_publication_return_notification(
    *,
    target_user_id: int,
    actor_user_id: int,
    title: str,
    body: str,
) -> NotificationDraft:
    return NotificationDraft(
        user_id=target_user_id,
        actor_user_id=actor_user_id,
        kind=NOTIFICATION_KIND_PUBLICATION_REVIEW,
        title=title,
        body=body,
        action_url="/games/publications",
    )


def _delete_story_game_publication_copy_with_relations(db: Session, *, game_id: int) -> None:
    db.execute(sa_delete(StoryWorldCardChangeEvent).where(StoryWorldCardChangeEvent.game_id == game_id))
    db.execute(sa_delete(StoryPlotCardChangeEvent).where(StoryPlotCardChangeEvent.game_id == game_id))
    db.execute(sa_delete(StoryTurnImage).where(StoryTurnImage.game_id == game_id))
    db.execute(sa_delete(StoryMapImage).where(StoryMapImage.game_id == game_id))
    db.execute(sa_delete(StoryMemoryBlock).where(StoryMemoryBlock.game_id == game_id))
    db.execute(sa_delete(StoryCharacterStateSnapshot).where(StoryCharacterStateSnapshot.game_id == game_id))
    db.execute(sa_delete(StoryMessage).where(StoryMessage.game_id == game_id))
    db.execute(sa_delete(StoryInstructionCard).where(StoryInstructionCard.game_id == game_id))
    db.execute(sa_delete(StoryPlotCard).where(StoryPlotCard.game_id == game_id))
    db.execute(sa_delete(StoryWorldCard).where(StoryWorldCard.game_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldComment).where(StoryCommunityWorldComment.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldRating).where(StoryCommunityWorldRating.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldView).where(StoryCommunityWorldView.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldLaunch).where(StoryCommunityWorldLaunch.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldFavorite).where(StoryCommunityWorldFavorite.world_id == game_id))
    db.execute(sa_delete(StoryCommunityWorldReport).where(StoryCommunityWorldReport.world_id == game_id))
    game = db.scalar(select(StoryGame).where(StoryGame.id == game_id))
    if game is not None:
        db.delete(game)


def _delete_story_character_publication_copy_with_relations(db: Session, *, character_id: int) -> None:
    db.execute(sa_delete(StoryCommunityCharacterRating).where(StoryCommunityCharacterRating.character_id == character_id))
    db.execute(sa_delete(StoryCommunityCharacterAddition).where(StoryCommunityCharacterAddition.character_id == character_id))
    db.execute(sa_delete(StoryCommunityCharacterReport).where(StoryCommunityCharacterReport.character_id == character_id))
    unlink_story_character_from_world_cards(db, character_id=character_id)
    character = db.scalar(select(StoryCharacter).where(StoryCharacter.id == character_id))
    if character is not None:
        db.delete(character)


def _delete_story_instruction_template_publication_copy_with_relations(db: Session, *, template_id: int) -> None:
    db.execute(sa_delete(StoryCommunityInstructionTemplateRating).where(StoryCommunityInstructionTemplateRating.template_id == template_id))
    db.execute(sa_delete(StoryCommunityInstructionTemplateAddition).where(StoryCommunityInstructionTemplateAddition.template_id == template_id))
    db.execute(sa_delete(StoryCommunityInstructionTemplateReport).where(StoryCommunityInstructionTemplateReport.template_id == template_id))
    template = db.scalar(select(StoryInstructionTemplate).where(StoryInstructionTemplate.id == template_id))
    if template is not None:
        db.delete(template)


@router.get("/api/auth/admin/moderation", response_model=AdminModerationQueueResponse)
def list_pending_publication_submissions(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationQueueResponse:
    _get_admin_user(db=db, authorization=authorization)

    worlds = db.scalars(
        select(StoryGame).where(
            StoryGame.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryGame.visibility != "public",
        )
    ).all()
    characters = db.scalars(
        select(StoryCharacter).where(
            StoryCharacter.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryCharacter.visibility != "public",
        )
    ).all()
    templates = db.scalars(
        select(StoryInstructionTemplate).where(
            StoryInstructionTemplate.publication_status == STORY_PUBLICATION_STATUS_PENDING,
            StoryInstructionTemplate.visibility != "public",
        )
    ).all()

    author_ids = {
        *[int(item.user_id) for item in worlds],
        *[int(item.user_id) for item in characters],
        *[int(item.user_id) for item in templates],
    }
    authors = db.scalars(select(User).where(User.id.in_(sorted(author_ids)))).all() if author_ids else []
    author_by_id = {int(author.id): author for author in authors}

    items: list[AdminModerationQueueItemOut] = []
    for world in worlds:
        author = author_by_id.get(int(world.user_id))
        if author is None:
            continue
        items.append(
            AdminModerationQueueItemOut(
                target_type="world",
                target_id=int(world.id),
                target_title=str(world.title or "").strip() or f"World #{int(world.id)}",
                target_description=_preview_text(world.description or world.opening_scene),
                target_preview_image_url=_resolve_admin_preview_url(
                    getattr(world, "cover_image_url", None),
                    kind="story-game-cover",
                    entity_id=int(world.id),
                    version=getattr(world, "updated_at", None),
                ),
                author=_build_author_out(author),
                publication=_build_publication_state(world),
                created_at=world.created_at,
                updated_at=world.updated_at,
            )
        )
    for character in characters:
        author = author_by_id.get(int(character.user_id))
        if author is None:
            continue
        items.append(
            AdminModerationQueueItemOut(
                target_type="character",
                target_id=int(character.id),
                target_title=str(character.name or "").strip() or f"Character #{int(character.id)}",
                target_description=_preview_text(character.description),
                target_preview_image_url=_resolve_admin_preview_url(
                    getattr(character, "avatar_url", None),
                    kind="story-character-avatar",
                    entity_id=int(character.id),
                    version=getattr(character, "updated_at", None),
                ),
                author=_build_author_out(author),
                publication=_build_publication_state(character),
                created_at=character.created_at,
                updated_at=character.updated_at,
            )
        )
    for template in templates:
        author = author_by_id.get(int(template.user_id))
        if author is None:
            continue
        items.append(
            AdminModerationQueueItemOut(
                target_type="instruction_template",
                target_id=int(template.id),
                target_title=str(template.title or "").strip() or f"Instruction #{int(template.id)}",
                target_description=_preview_text(template.content),
                target_preview_image_url=None,
                author=_build_author_out(author),
                publication=_build_publication_state(template),
                created_at=template.created_at,
                updated_at=template.updated_at,
            )
        )

    items.sort(
        key=lambda item: (
            item.publication.requested_at or item.updated_at,
            item.updated_at,
            item.target_id,
        ),
        reverse=True,
    )
    return AdminModerationQueueResponse(items=items)


@router.get("/api/auth/admin/moderation/worlds/{world_id}", response_model=AdminModerationWorldDetailOut)
def get_pending_world_submission(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationWorldDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    world = _get_pending_world_or_404(db, world_id=world_id)
    author = _get_author_or_404(db, user_id=int(world.user_id))
    return _build_world_detail_out(db, world, author)


@router.patch("/api/auth/admin/moderation/worlds/{world_id}", response_model=AdminModerationWorldDetailOut)
def update_pending_world_submission(
    world_id: int,
    payload: AdminModerationWorldUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationWorldDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    world = _get_pending_world_or_404(db, world_id=world_id)
    author = _get_author_or_404(db, user_id=int(world.user_id))
    payload_fields = payload.model_fields_set

    world.title = _normalize_story_game_title_for_moderation(payload.title)
    world.description = normalize_story_game_description(payload.description)
    world.opening_scene = normalize_story_game_opening_scene(payload.opening_scene)
    world.age_rating = normalize_story_game_age_rating(payload.age_rating)
    world.genres = serialize_story_game_genres(normalize_story_game_genres(payload.genres))
    if "cover_image_url" in payload_fields:
        world.cover_image_url = normalize_story_cover_image_url(payload.cover_image_url)
    world.cover_scale = normalize_story_cover_scale(payload.cover_scale)
    world.cover_position_x = normalize_story_cover_position(payload.cover_position_x)
    world.cover_position_y = normalize_story_cover_position(payload.cover_position_y)

    instruction_ids = [card.id for card in payload.instruction_cards]
    plot_ids = [card.id for card in payload.plot_cards]
    world_card_ids = [card.id for card in payload.world_cards]
    _ensure_unique_ids(instruction_ids, entity_name="instruction card")
    _ensure_unique_ids(plot_ids, entity_name="plot card")
    _ensure_unique_ids(world_card_ids, entity_name="world card")

    instruction_cards_by_id = {
        int(card.id): card
        for card in db.scalars(
            select(StoryInstructionCard).where(
                StoryInstructionCard.game_id == world.id,
                StoryInstructionCard.id.in_(instruction_ids or [-1]),
            )
        ).all()
    }
    for card_payload in payload.instruction_cards:
        card = instruction_cards_by_id.get(card_payload.id)
        if card is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instruction card not found")
        card.title = normalize_story_instruction_title(card_payload.title)
        card.content = normalize_story_instruction_content(card_payload.content)
        card.is_active = bool(card_payload.is_active)

    plot_cards_by_id = {
        int(card.id): card
        for card in db.scalars(
            select(StoryPlotCard).where(
                StoryPlotCard.game_id == world.id,
                StoryPlotCard.id.in_(plot_ids or [-1]),
            )
        ).all()
    }
    for card_payload in payload.plot_cards:
        card = plot_cards_by_id.get(card_payload.id)
        if card is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plot card not found")
        card.title = normalize_story_plot_card_title(card_payload.title)
        card.content = normalize_story_plot_card_content(card_payload.content)
        card.triggers = serialize_story_plot_card_triggers(
            normalize_story_plot_card_triggers(card_payload.triggers, fallback_title=card.title)
        )
        card.memory_turns = normalize_story_plot_card_memory_turns_for_storage(
            card_payload.memory_turns,
            explicit=True,
            current_value=getattr(card, "memory_turns", None),
        )
        card.is_enabled = bool(card_payload.is_enabled)

    world_cards_by_id = {
        int(card.id): card
        for card in db.scalars(
            select(StoryWorldCard).where(
                StoryWorldCard.game_id == world.id,
                StoryWorldCard.id.in_(world_card_ids or [-1]),
            )
        ).all()
    }
    for card_payload in payload.world_cards:
        card = world_cards_by_id.get(card_payload.id)
        if card is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="World card not found")
        card_payload_fields = card_payload.model_fields_set
        normalized_title = normalize_story_world_card_title(card_payload.title)
        normalized_content = normalize_story_world_card_content(card_payload.content)
        if str(getattr(card, "kind", "") or "").strip().lower() == STORY_WORLD_CARD_KIND_NPC:
            normalized_content = normalize_story_npc_profile_content(normalized_title, normalized_content)
        card.title = normalized_title
        card.content = normalized_content
        card.triggers = serialize_story_world_card_triggers(
            normalize_story_world_card_triggers(card_payload.triggers, fallback_title=normalized_title)
        )
        if "avatar_url" in card_payload_fields:
            normalized_avatar_url = normalize_story_character_avatar_url(card_payload.avatar_url)
            card.avatar_url = normalized_avatar_url
            if normalized_avatar_url is None:
                card.avatar_original_url = None
            elif "avatar_original_url" in card_payload_fields:
                card.avatar_original_url = normalize_story_character_avatar_original_url(card_payload.avatar_original_url)
            else:
                card.avatar_original_url = normalize_story_character_avatar_original_url(
                    getattr(card, "avatar_original_url", None) or normalized_avatar_url
                )
        elif "avatar_original_url" in card_payload_fields and getattr(card, "avatar_url", None):
            card.avatar_original_url = normalize_story_character_avatar_original_url(card_payload.avatar_original_url)
        card.avatar_scale = normalize_story_avatar_scale(card_payload.avatar_scale)
        card.memory_turns = normalize_story_world_card_memory_turns_for_storage(
            card_payload.memory_turns,
            kind=str(getattr(card, "kind", "") or ""),
            explicit=True,
            current_value=getattr(card, "memory_turns", None),
        )

    touch_story_game(world)
    _commit_admin_moderation_write(db, action_label="updating pending world submission")
    db.refresh(world)
    return _build_world_detail_out(db, world, author)


@router.post("/api/auth/admin/moderation/worlds/{world_id}/approve", response_model=AdminModerationWorldDetailOut)
def approve_pending_world_submission(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationWorldDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    world = _get_pending_world_or_404(db, world_id=world_id)
    author = _get_author_or_404(db, user_id=int(world.user_id))
    mark_story_publication_approved(world, reviewer_user_id=int(admin_user.id))
    upsert_story_game_publication_copy_from_source(
        db,
        source_game=world,
        copy_cards=True,
        reviewer_user_id=int(admin_user.id),
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация мира одобрена",
                body=f"Модерация одобрила публикацию мира \"{str(world.title or '').strip() or f'World #{int(world.id)}'}\".",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="approving pending world submission")
    db.refresh(world)
    send_notification_emails(db, notifications)
    return _build_world_detail_out(db, world, author)


@router.post("/api/auth/admin/moderation/worlds/{world_id}/reject", response_model=AdminModerationWorldDetailOut)
def reject_pending_world_submission(
    world_id: int,
    payload: AdminModerationRejectRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationWorldDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    world = _get_pending_world_or_404(db, world_id=world_id)
    author = _get_author_or_404(db, user_id=int(world.user_id))
    mark_story_publication_rejected(
        world,
        reviewer_user_id=int(admin_user.id),
        rejection_reason=payload.rejection_reason,
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация мира отклонена",
                body=f"Модерация отклонила публикацию мира \"{str(world.title or '').strip() or f'World #{int(world.id)}'}\": {str(world.publication_rejection_reason or '').strip() or 'причина не указана'}.",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="rejecting pending world submission")
    db.refresh(world)
    send_notification_emails(db, notifications)
    return _build_world_detail_out(db, world, author)


@router.post("/api/auth/admin/moderation/worlds/{world_id}/return", response_model=MessageResponse)
def return_published_world_to_moderation(
    world_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    source_world, publication_copy = _get_returnable_world_or_404(db, world_id=world_id)
    author = _get_author_or_404(db, user_id=int(source_world.user_id))

    mark_story_publication_pending(source_world)
    source_world.visibility = "private"
    touch_story_game(source_world)
    if publication_copy is not None:
        _delete_story_game_publication_copy_with_relations(db, game_id=int(publication_copy.id))

    notifications = create_user_notifications(
        db,
        [
            _build_publication_return_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация мира возвращена на модерацию",
                body=(
                    f"Модерация вернула мир "
                    f"\"{str(source_world.title or '').strip() or f'World #{int(source_world.id)}'}\" "
                    "на повторную проверку."
                ),
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="returning published world to moderation")
    send_notification_emails(db, notifications)
    return MessageResponse(message="World was returned to moderation")


@router.get("/api/auth/admin/moderation/characters/{character_id}", response_model=AdminModerationCharacterDetailOut)
def get_pending_character_submission(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationCharacterDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    character = _get_pending_character_or_404(db, character_id=character_id)
    author = _get_author_or_404(db, user_id=int(character.user_id))
    return _build_character_detail_out(author, character)


@router.patch("/api/auth/admin/moderation/characters/{character_id}", response_model=AdminModerationCharacterDetailOut)
def update_pending_character_submission(
    character_id: int,
    payload: AdminModerationCharacterUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationCharacterDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    character = _get_pending_character_or_404(db, character_id=character_id)
    author = _get_author_or_404(db, user_id=int(character.user_id))
    payload_fields = payload.model_fields_set

    character.name = normalize_story_character_name(payload.name)
    character.description = normalize_story_character_description(payload.description)
    character.note = normalize_story_character_note(payload.note)
    character.triggers = serialize_triggers(
        normalize_story_character_triggers(payload.triggers, fallback_name=character.name)
    )
    if "avatar_url" in payload_fields:
        normalized_avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
        character.avatar_url = normalized_avatar_url
        if normalized_avatar_url is None:
            character.avatar_original_url = None
        elif "avatar_original_url" in payload_fields:
            character.avatar_original_url = normalize_story_character_avatar_original_url(payload.avatar_original_url)
        else:
            character.avatar_original_url = normalize_story_character_avatar_original_url(
                getattr(character, "avatar_original_url", None) or normalized_avatar_url
            )
    elif "avatar_original_url" in payload_fields and getattr(character, "avatar_url", None):
        character.avatar_original_url = normalize_story_character_avatar_original_url(payload.avatar_original_url)
    character.avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)

    _commit_admin_moderation_write(db, action_label="updating pending character submission")
    db.refresh(character)
    return _build_character_detail_out(author, character)


@router.post("/api/auth/admin/moderation/characters/{character_id}/approve", response_model=AdminModerationCharacterDetailOut)
def approve_pending_character_submission(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationCharacterDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    character = _get_pending_character_or_404(db, character_id=character_id)
    author = _get_author_or_404(db, user_id=int(character.user_id))
    mark_story_publication_approved(character, reviewer_user_id=int(admin_user.id))
    upsert_story_character_publication_copy_from_source(
        db,
        source_character=character,
        reviewer_user_id=int(admin_user.id),
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация персонажа одобрена",
                body=f"Модерация одобрила публикацию персонажа \"{character.name}\".",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="approving pending character submission")
    db.refresh(character)
    send_notification_emails(db, notifications)
    return _build_character_detail_out(author, character)


@router.post("/api/auth/admin/moderation/characters/{character_id}/reject", response_model=AdminModerationCharacterDetailOut)
def reject_pending_character_submission(
    character_id: int,
    payload: AdminModerationRejectRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationCharacterDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    character = _get_pending_character_or_404(db, character_id=character_id)
    author = _get_author_or_404(db, user_id=int(character.user_id))
    mark_story_publication_rejected(
        character,
        reviewer_user_id=int(admin_user.id),
        rejection_reason=payload.rejection_reason,
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация персонажа отклонена",
                body=f"Модерация отклонила публикацию персонажа \"{character.name}\": {str(character.publication_rejection_reason or '').strip() or 'причина не указана'}.",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="rejecting pending character submission")
    db.refresh(character)
    send_notification_emails(db, notifications)
    return _build_character_detail_out(author, character)


@router.post("/api/auth/admin/moderation/characters/{character_id}/return", response_model=MessageResponse)
def return_published_character_to_moderation(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    source_character, publication_copy = _get_returnable_character_or_404(db, character_id=character_id)
    author = _get_author_or_404(db, user_id=int(source_character.user_id))

    mark_story_publication_pending(source_character)
    source_character.visibility = "private"
    if publication_copy is not None:
        _delete_story_character_publication_copy_with_relations(db, character_id=int(publication_copy.id))

    notifications = create_user_notifications(
        db,
        [
            _build_publication_return_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация персонажа возвращена на модерацию",
                body=f"Модерация вернула персонажа \"{source_character.name}\" на повторную проверку.",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="returning published character to moderation")
    send_notification_emails(db, notifications)
    return MessageResponse(message="Character was returned to moderation")


@router.get(
    "/api/auth/admin/moderation/instruction-templates/{template_id}",
    response_model=AdminModerationInstructionTemplateDetailOut,
)
def get_pending_instruction_template_submission(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationInstructionTemplateDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    template = _get_pending_instruction_template_or_404(db, template_id=template_id)
    author = _get_author_or_404(db, user_id=int(template.user_id))
    return _build_instruction_template_detail_out(author, template)


@router.patch(
    "/api/auth/admin/moderation/instruction-templates/{template_id}",
    response_model=AdminModerationInstructionTemplateDetailOut,
)
def update_pending_instruction_template_submission(
    template_id: int,
    payload: AdminModerationInstructionTemplateUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationInstructionTemplateDetailOut:
    _get_admin_user(db=db, authorization=authorization)
    template = _get_pending_instruction_template_or_404(db, template_id=template_id)
    author = _get_author_or_404(db, user_id=int(template.user_id))
    template.title = normalize_story_instruction_title(payload.title)
    template.content = normalize_story_instruction_content(payload.content)
    _commit_admin_moderation_write(db, action_label="updating pending instruction template submission")
    db.refresh(template)
    return _build_instruction_template_detail_out(author, template)


@router.post(
    "/api/auth/admin/moderation/instruction-templates/{template_id}/approve",
    response_model=AdminModerationInstructionTemplateDetailOut,
)
def approve_pending_instruction_template_submission(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationInstructionTemplateDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    template = _get_pending_instruction_template_or_404(db, template_id=template_id)
    author = _get_author_or_404(db, user_id=int(template.user_id))
    mark_story_publication_approved(template, reviewer_user_id=int(admin_user.id))
    upsert_story_instruction_template_publication_copy_from_source(
        db,
        source_template=template,
        reviewer_user_id=int(admin_user.id),
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация карточки одобрена",
                body=f"Модерация одобрила публикацию карточки \"{template.title}\".",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="approving pending instruction template submission")
    db.refresh(template)
    send_notification_emails(db, notifications)
    return _build_instruction_template_detail_out(author, template)


@router.post(
    "/api/auth/admin/moderation/instruction-templates/{template_id}/return",
    response_model=MessageResponse,
)
def return_published_instruction_template_to_moderation(
    template_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    source_template, publication_copy = _get_returnable_instruction_template_or_404(db, template_id=template_id)
    author = _get_author_or_404(db, user_id=int(source_template.user_id))

    mark_story_publication_pending(source_template)
    source_template.visibility = "private"
    if publication_copy is not None:
        _delete_story_instruction_template_publication_copy_with_relations(db, template_id=int(publication_copy.id))

    notifications = create_user_notifications(
        db,
        [
            _build_publication_return_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация инструкции возвращена на модерацию",
                body=f"Модерация вернула инструкцию \"{source_template.title}\" на повторную проверку.",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="returning published instruction template to moderation")
    send_notification_emails(db, notifications)
    return MessageResponse(message="Instruction template was returned to moderation")


@router.post(
    "/api/auth/admin/moderation/instruction-templates/{template_id}/reject",
    response_model=AdminModerationInstructionTemplateDetailOut,
)
def reject_pending_instruction_template_submission(
    template_id: int,
    payload: AdminModerationRejectRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminModerationInstructionTemplateDetailOut:
    admin_user = _get_admin_user(db=db, authorization=authorization)
    template = _get_pending_instruction_template_or_404(db, template_id=template_id)
    author = _get_author_or_404(db, user_id=int(template.user_id))
    mark_story_publication_rejected(
        template,
        reviewer_user_id=int(admin_user.id),
        rejection_reason=payload.rejection_reason,
    )
    notifications = create_user_notifications(
        db,
        [
            _build_publication_review_notification(
                target_user_id=int(author.id),
                actor_user_id=int(admin_user.id),
                title="Публикация карточки отклонена",
                body=f"Модерация отклонила публикацию карточки \"{template.title}\": {str(template.publication_rejection_reason or '').strip() or 'причина не указана'}.",
            )
        ],
    )
    _commit_admin_moderation_write(db, action_label="rejecting pending instruction template submission")
    db.refresh(template)
    send_notification_emails(db, notifications)
    return _build_instruction_template_detail_out(author, template)
