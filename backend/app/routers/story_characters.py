from __future__ import annotations

import json

from sqlalchemy import case, delete as sa_delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session, load_only

from app.database import get_db
from app.models import (
    StoryCharacter,
    StoryCharacterEmotionGenerationJob,
    StoryCharacterRace,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterReport,
    StoryCommunityCharacterRating,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryCharacterAvatarGenerateOut,
    StoryCharacterAvatarGenerateRequest,
    StoryCharacterEmotionGenerateJobOut,
    StoryCharacterEmotionGenerateOut,
    StoryCharacterEmotionGenerateRequest,
    StoryCommunityCharacterSummaryOut,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryCharacterCreateRequest,
    StoryCharacterRaceCreateRequest,
    StoryCharacterRaceOut,
    StoryCharacterOut,
    StoryCharacterUpdateRequest,
)
from app.services.concurrency import (
    apply_story_character_rating_insert,
    apply_story_character_rating_update,
    increment_story_character_additions,
)
from app.services.auth_identity import get_current_user
from app.services.story_characters import (
    STORY_CHARACTER_VISIBILITY_PRIVATE,
    STORY_CHARACTER_VISIBILITY_PUBLIC,
    coerce_story_character_visibility,
    deserialize_triggers,
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_description,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_name,
    normalize_story_character_note,
    normalize_story_character_race,
    normalize_story_character_source,
    normalize_story_character_triggers,
    normalize_story_character_visibility,
    serialize_triggers,
    story_character_rating_average,
    story_character_to_out,
    unlink_story_character_from_world_cards,
    upsert_story_character_race,
)
from app.services.story_games import story_author_avatar_url, story_author_name
from app.services.story_emotions import (
    deserialize_story_character_emotion_assets,
    normalize_story_character_emotion_assets,
    serialize_story_character_emotion_assets,
)
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
    get_public_story_character_or_404,
    get_story_character_for_user_or_404,
    list_story_characters,
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
STORY_COMMUNITY_CHARACTER_SORT_OPTIONS = {"updated_desc", "rating_desc", "additions_desc"}
STORY_COMMUNITY_ADDED_FILTER_OPTIONS = {"all", "added", "not_added"}


def _normalize_story_community_character_sort(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_COMMUNITY_CHARACTER_SORT_OPTIONS:
        return normalized
    return "additions_desc"


def _normalize_story_community_added_filter(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_COMMUNITY_ADDED_FILTER_OPTIONS:
        return normalized
    return "all"


def _normalize_story_community_search_query(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip()


STORY_CHARACTER_REPORT_STATUS_OPEN = "open"


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


def _is_story_emotion_admin(user: User) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == "administrator"


def _normalize_optional_emotion_prompt_lock(value: str | None) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if not normalized:
        return ""
    return normalized[:8_000].rstrip()


def _normalize_optional_emotion_model(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    return normalized[:120].rstrip()


def _resolve_story_character_emotion_payload_for_write(
    db: Session,
    *,
    user: User,
    payload: StoryCharacterCreateRequest | StoryCharacterUpdateRequest,
    avatar_url: str | None,
    current_character: StoryCharacter | None = None,
) -> tuple[dict[str, str], str, str]:
    if not _is_story_emotion_admin(user) or not avatar_url:
        return {}, "", ""

    emotion_generation_job_id = getattr(payload, "emotion_generation_job_id", None)
    if emotion_generation_job_id is not None:
        job = db.scalar(
            select(StoryCharacterEmotionGenerationJob).where(
                StoryCharacterEmotionGenerationJob.id == int(emotion_generation_job_id),
                StoryCharacterEmotionGenerationJob.user_id == int(user.id),
            )
        )
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emotion generation job not found")
        if str(getattr(job, "status", "") or "").strip().lower() != "completed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Emotion generation job is not completed yet")

        try:
            raw_result_payload = json.loads(str(getattr(job, "result_payload", "") or "").strip() or "{}")
            result_payload = StoryCharacterEmotionGenerateOut.model_validate(raw_result_payload)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Emotion generation job payload is invalid",
            ) from exc

        emotion_assets = normalize_story_character_emotion_assets(result_payload.emotion_assets)
        emotion_model = _normalize_optional_emotion_model(result_payload.model) if emotion_assets else ""
        emotion_prompt_lock = _normalize_optional_emotion_prompt_lock(result_payload.emotion_prompt_lock) if emotion_assets else ""
        return emotion_assets, emotion_model, emotion_prompt_lock

    if bool(getattr(payload, "preserve_existing_emotions", False)) and current_character is not None:
        emotion_assets = normalize_story_character_emotion_assets(getattr(current_character, "emotion_assets", ""))
        emotion_model = _normalize_optional_emotion_model(getattr(current_character, "emotion_model", "")) if emotion_assets else ""
        emotion_prompt_lock = (
            _normalize_optional_emotion_prompt_lock(getattr(current_character, "emotion_prompt_lock", ""))
            if emotion_assets
            else ""
        )
        return emotion_assets, emotion_model, emotion_prompt_lock

    emotion_assets = normalize_story_character_emotion_assets(payload.emotion_assets)
    emotion_model = _normalize_optional_emotion_model(payload.emotion_model) if emotion_assets else ""
    emotion_prompt_lock = _normalize_optional_emotion_prompt_lock(payload.emotion_prompt_lock) if emotion_assets else ""
    return emotion_assets, emotion_model, emotion_prompt_lock


def _build_story_community_character_summary(
    db: Session,
    *,
    user_id: int,
    character: StoryCharacter,
    user_rating_override: int | None = None,
    is_added_by_user_override: bool | None = None,
    is_reported_by_user_override: bool | None = None,
) -> StoryCommunityCharacterSummaryOut:
    author = db.scalar(select(User).where(User.id == character.user_id))
    character_out = story_character_to_out(character)
    if user_rating_override is None:
        user_rating_value = db.scalar(
            select(StoryCommunityCharacterRating.rating).where(
                StoryCommunityCharacterRating.character_id == character.id,
                StoryCommunityCharacterRating.user_id == user_id,
            )
        )
        user_rating = int(user_rating_value) if user_rating_value is not None else None
    else:
        user_rating = int(user_rating_override)

    if is_added_by_user_override is None:
        user_character_copy_id = db.scalar(
            select(StoryCharacter.id).where(
                StoryCharacter.user_id == user_id,
                StoryCharacter.source_character_id == character.id,
            )
        )
        is_added_by_user = user_character_copy_id is not None
    else:
        is_added_by_user = bool(is_added_by_user_override)

    if is_reported_by_user_override is None:
        user_report_id = db.scalar(
            select(StoryCommunityCharacterReport.id).where(
                StoryCommunityCharacterReport.character_id == character.id,
                StoryCommunityCharacterReport.reporter_user_id == user_id,
            )
        )
        is_reported_by_user = user_report_id is not None
    else:
        is_reported_by_user = bool(is_reported_by_user_override)

    return StoryCommunityCharacterSummaryOut(
        id=character_out.id,
        name=character_out.name,
        description=character_out.description,
        race=character_out.race,
        clothing=character_out.clothing,
        inventory=character_out.inventory,
        health_status=character_out.health_status,
        note=character_out.note,
        triggers=character_out.triggers,
        avatar_url=character_out.avatar_url,
        avatar_original_url=character_out.avatar_original_url,
        avatar_scale=character_out.avatar_scale,
        emotion_assets=character_out.emotion_assets,
        emotion_model=character_out.emotion_model,
        emotion_prompt_lock=character_out.emotion_prompt_lock,
        visibility=character_out.visibility,
        author_id=character.user_id,
        author_name=story_author_name(author),
        author_avatar_url=story_author_avatar_url(author),
        community_rating_avg=story_character_rating_average(character),
        community_rating_count=max(int(getattr(character, "community_rating_count", 0) or 0), 0),
        community_additions_count=max(int(getattr(character, "community_additions_count", 0) or 0), 0),
        user_rating=user_rating,
        is_added_by_user=is_added_by_user,
        is_reported_by_user=is_reported_by_user,
        created_at=character.created_at,
        updated_at=character.updated_at,
    )


def _create_story_character_publication_copy_from_source(
    db: Session,
    *,
    source_character: StoryCharacter,
) -> StoryCharacter:
    publication = StoryCharacter(
        user_id=source_character.user_id,
        name=source_character.name,
        description=source_character.description,
        race=normalize_story_character_race(getattr(source_character, "race", "")),
        clothing=normalize_story_character_clothing(getattr(source_character, "clothing", "")),
        inventory=normalize_story_character_inventory(getattr(source_character, "inventory", "")),
        health_status=normalize_story_character_health_status(getattr(source_character, "health_status", "")),
        note=normalize_story_character_note(source_character.note),
        triggers=serialize_triggers(deserialize_triggers(source_character.triggers)),
        avatar_url=normalize_story_character_avatar_url(source_character.avatar_url, db=db),
        avatar_original_url=(
            normalize_story_character_avatar_original_url(
                getattr(source_character, "avatar_original_url", None),
                db=db,
            )
            if getattr(source_character, "avatar_url", None)
            else None
        ),
        avatar_scale=normalize_story_avatar_scale(source_character.avatar_scale),
        emotion_assets=serialize_story_character_emotion_assets(getattr(source_character, "emotion_assets", "")),
        emotion_model=_normalize_optional_emotion_model(getattr(source_character, "emotion_model", "")),
        emotion_prompt_lock=_normalize_optional_emotion_prompt_lock(getattr(source_character, "emotion_prompt_lock", "")),
        source=normalize_story_character_source(source_character.source),
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
        source_character_id=source_character.id,
        community_rating_sum=0,
        community_rating_count=0,
        community_additions_count=0,
    )
    db.add(publication)
    db.flush()
    return publication


def _delete_story_character_with_relations(db: Session, *, character_id: int) -> None:
    db.execute(
        sa_delete(StoryCommunityCharacterRating).where(
            StoryCommunityCharacterRating.character_id == character_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityCharacterAddition).where(
            StoryCommunityCharacterAddition.character_id == character_id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityCharacterReport).where(
            StoryCommunityCharacterReport.character_id == character_id,
        )
    )
    unlink_story_character_from_world_cards(db, character_id=character_id)
    character = db.scalar(select(StoryCharacter).where(StoryCharacter.id == character_id))
    if character is not None:
        db.delete(character)


def _get_story_character_publication_copy(db: Session, *, source_character_id: int) -> StoryCharacter | None:
    return db.scalar(
        select(StoryCharacter)
        .where(StoryCharacter.source_character_id == source_character_id)
        .order_by(StoryCharacter.id.asc())
    )


def _story_character_race_to_out(race: StoryCharacterRace) -> StoryCharacterRaceOut:
    return StoryCharacterRaceOut(
        id=int(race.id),
        name=normalize_story_character_race(getattr(race, "name", "")),
        created_at=race.created_at,
        updated_at=race.updated_at,
    )


@router.get("/api/story/characters", response_model=list[StoryCharacterOut])
def list_story_characters_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCharacterOut]:
    user = get_current_user(db, authorization)
    characters = list_story_characters(db, user.id)
    return [story_character_to_out(character) for character in characters]


@router.get("/api/story/character-races", response_model=list[StoryCharacterRaceOut])
def list_story_character_races(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCharacterRaceOut]:
    user = get_current_user(db, authorization)
    races = db.scalars(
        select(StoryCharacterRace)
        .where(StoryCharacterRace.user_id == int(user.id))
        .order_by(func.lower(StoryCharacterRace.name).asc(), StoryCharacterRace.id.asc())
    ).all()
    return [_story_character_race_to_out(race) for race in races]


@router.post("/api/story/character-races", response_model=StoryCharacterRaceOut)
def create_story_character_race(
    payload: StoryCharacterRaceCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterRaceOut:
    user = get_current_user(db, authorization)
    race = upsert_story_character_race(
        db,
        user_id=int(user.id),
        name=payload.name,
    )
    if race is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Character race cannot be empty")
    db.commit()
    db.refresh(race)
    return _story_character_race_to_out(race)


@router.get("/api/story/community/characters", response_model=list[StoryCommunityCharacterSummaryOut])
def list_story_community_characters(
    limit: int = Query(default=80, ge=1, le=80),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="additions_desc"),
    query: str = Query(default="", max_length=120),
    added_filter: str = Query(default="all"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityCharacterSummaryOut]:
    user = get_current_user(db, authorization)
    normalized_sort = _normalize_story_community_character_sort(sort)
    normalized_query = _normalize_story_community_search_query(query)
    normalized_added_filter = _normalize_story_community_added_filter(added_filter)
    rating_average_expr = case(
        (
            StoryCharacter.community_rating_count > 0,
            (StoryCharacter.community_rating_sum * 1.0) / StoryCharacter.community_rating_count,
        ),
        else_=0.0,
    )
    added_by_user_exists = (
        select(StoryCommunityCharacterAddition.id)
        .where(
            StoryCommunityCharacterAddition.character_id == StoryCharacter.id,
            StoryCommunityCharacterAddition.user_id == user.id,
        )
        .exists()
    )

    statement = (
        select(StoryCharacter)
        .options(
            load_only(
                StoryCharacter.id,
                StoryCharacter.user_id,
                StoryCharacter.name,
                StoryCharacter.race,
                StoryCharacter.description,
                StoryCharacter.clothing,
                StoryCharacter.inventory,
                StoryCharacter.health_status,
                StoryCharacter.note,
                StoryCharacter.triggers,
                StoryCharacter.avatar_url,
                StoryCharacter.avatar_original_url,
                StoryCharacter.avatar_scale,
                StoryCharacter.emotion_model,
                StoryCharacter.emotion_prompt_lock,
                StoryCharacter.visibility,
                StoryCharacter.community_rating_sum,
                StoryCharacter.community_rating_count,
                StoryCharacter.community_additions_count,
                StoryCharacter.created_at,
                StoryCharacter.updated_at,
            )
        )
        .join(User, User.id == StoryCharacter.user_id)
        .where(StoryCharacter.visibility == "public")
    )
    if normalized_query:
        like_pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                StoryCharacter.name.ilike(like_pattern),
                StoryCharacter.description.ilike(like_pattern),
                StoryCharacter.note.ilike(like_pattern),
            )
        )
    if normalized_added_filter == "added":
        statement = statement.where(added_by_user_exists)
    elif normalized_added_filter == "not_added":
        statement = statement.where(~added_by_user_exists)

    if normalized_sort == "updated_desc":
        statement = statement.order_by(StoryCharacter.updated_at.desc(), StoryCharacter.id.desc())
    elif normalized_sort == "rating_desc":
        statement = statement.order_by(
            rating_average_expr.desc(),
            StoryCharacter.community_rating_count.desc(),
            StoryCharacter.updated_at.desc(),
            StoryCharacter.id.desc(),
        )
    else:
        statement = statement.order_by(
            StoryCharacter.community_additions_count.desc(),
            StoryCharacter.updated_at.desc(),
            StoryCharacter.id.desc(),
        )

    characters = db.scalars(statement.offset(offset).limit(limit)).all()
    if not characters:
        return []

    character_ids = [character.id for character in characters]
    author_ids = sorted({character.user_id for character in characters})
    authors = db.scalars(
        select(User)
        .options(
            load_only(
                User.id,
                User.email,
                User.display_name,
                User.avatar_url,
                User.updated_at,
            )
        )
        .where(User.id.in_(author_ids))
    ).all()
    author_name_by_id = {author.id: story_author_name(author) for author in authors}
    author_avatar_by_id = {author.id: story_author_avatar_url(author) for author in authors}

    user_rating_rows = db.scalars(
        select(StoryCommunityCharacterRating).where(
            StoryCommunityCharacterRating.user_id == user.id,
            StoryCommunityCharacterRating.character_id.in_(character_ids),
        )
    ).all()
    user_rating_by_character_id = {row.character_id: int(row.rating) for row in user_rating_rows}

    user_added_character_source_ids = db.scalars(
        select(StoryCharacter.source_character_id).where(
            StoryCharacter.user_id == user.id,
            StoryCharacter.source_character_id.in_(character_ids),
        )
    ).all()
    added_character_ids = {
        int(source_character_id)
        for source_character_id in user_added_character_source_ids
        if isinstance(source_character_id, int)
    }

    user_report_rows = db.scalars(
        select(StoryCommunityCharacterReport).where(
            StoryCommunityCharacterReport.reporter_user_id == user.id,
            StoryCommunityCharacterReport.character_id.in_(character_ids),
        )
    ).all()
    reported_character_ids = {row.character_id for row in user_report_rows}

    summaries: list[StoryCommunityCharacterSummaryOut] = []
    for character in characters:
        character_out = story_character_to_out(character, include_emotion_assets=False)
        summaries.append(
            StoryCommunityCharacterSummaryOut(
                id=character_out.id,
                name=character_out.name,
                description=character_out.description,
                race=character_out.race,
                clothing=character_out.clothing,
                inventory=character_out.inventory,
                health_status=character_out.health_status,
                note=character_out.note,
                triggers=character_out.triggers,
                avatar_url=character_out.avatar_url,
                avatar_original_url=character_out.avatar_original_url,
                avatar_scale=character_out.avatar_scale,
                emotion_assets=character_out.emotion_assets,
                emotion_model=character_out.emotion_model,
                emotion_prompt_lock=character_out.emotion_prompt_lock,
                visibility=character_out.visibility,
                author_id=character.user_id,
                author_name=author_name_by_id.get(character.user_id, "Unknown"),
                author_avatar_url=author_avatar_by_id.get(character.user_id),
                community_rating_avg=story_character_rating_average(character),
                community_rating_count=max(int(getattr(character, "community_rating_count", 0) or 0), 0),
                community_additions_count=max(int(getattr(character, "community_additions_count", 0) or 0), 0),
                user_rating=user_rating_by_character_id.get(character.id),
                is_added_by_user=character.id in added_character_ids,
                is_reported_by_user=character.id in reported_character_ids,
                created_at=character.created_at,
                updated_at=character.updated_at,
            )
        )
    return summaries


@router.get("/api/story/community/characters/{character_id}", response_model=StoryCommunityCharacterSummaryOut)
def get_story_community_character(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityCharacterSummaryOut:
    user = get_current_user(db, authorization)
    character = get_public_story_character_or_404(db, character_id)
    return _build_story_community_character_summary(
        db,
        user_id=user.id,
        character=character,
    )


@router.post("/api/story/community/characters/{character_id}/rating", response_model=StoryCommunityCharacterSummaryOut)
def rate_story_community_character(
    character_id: int,
    payload: StoryCommunityWorldRatingRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityCharacterSummaryOut:
    user = get_current_user(db, authorization)
    character = get_public_story_character_or_404(db, character_id)
    rating_value = int(payload.rating)
    if rating_value <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rating should be between 1 and 5")

    existing_rating = db.scalar(
        select(StoryCommunityCharacterRating).where(
            StoryCommunityCharacterRating.character_id == character.id,
            StoryCommunityCharacterRating.user_id == user.id,
        )
    )
    if existing_rating is None:
        inserted_rating: StoryCommunityCharacterRating | None = None
        try:
            with db.begin_nested():
                inserted_rating = StoryCommunityCharacterRating(
                    character_id=character.id,
                    user_id=user.id,
                    rating=rating_value,
                )
                db.add(inserted_rating)
                db.flush()
            apply_story_character_rating_insert(db, character.id, rating_value)
            existing_rating = inserted_rating
        except IntegrityError:
            existing_rating = db.scalar(
                select(StoryCommunityCharacterRating).where(
                    StoryCommunityCharacterRating.character_id == character.id,
                    StoryCommunityCharacterRating.user_id == user.id,
                )
            )

    if existing_rating is not None:
        previous_rating = int(existing_rating.rating)
        if previous_rating != rating_value:
            existing_rating.rating = rating_value
            apply_story_character_rating_update(db, character.id, rating_value - previous_rating)

    db.commit()
    db.refresh(character)
    return _build_story_community_character_summary(
        db,
        user_id=user.id,
        character=character,
        user_rating_override=rating_value,
    )


@router.post("/api/story/community/characters/{character_id}/report", response_model=StoryCommunityCharacterSummaryOut)
def report_story_community_character(
    character_id: int,
    payload: StoryCommunityWorldReportCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityCharacterSummaryOut:
    user = get_current_user(db, authorization)
    character = get_public_story_character_or_404(db, character_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report description should not be empty",
        )

    existing_report_id = db.scalar(
        select(StoryCommunityCharacterReport.id).where(
            StoryCommunityCharacterReport.character_id == character.id,
            StoryCommunityCharacterReport.reporter_user_id == user.id,
        )
    )
    if existing_report_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this character",
        )

    db.add(
        StoryCommunityCharacterReport(
            character_id=character.id,
            reporter_user_id=user.id,
            reason=payload.reason,
            description=description,
            status=STORY_CHARACTER_REPORT_STATUS_OPEN,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reported this character",
        ) from None

    reporter_name = story_author_name(user)
    character_name = str(character.name or "").strip() or f"Персонаж #{int(character.id)}"
    _notify_staff(
        db,
        kind=NOTIFICATION_KIND_MODERATION_REPORT,
        title="Новая жалоба на персонажа",
        body=f"{reporter_name} отправил жалобу на персонажа \"{character_name}\".",
        action_url="/profile",
        actor_user_id=int(user.id),
    )
    db.refresh(character)
    return _build_story_community_character_summary(
        db,
        user_id=user.id,
        character=character,
        is_reported_by_user_override=True,
    )


@router.post("/api/story/community/characters/{character_id}/add", response_model=StoryCommunityCharacterSummaryOut)
def add_story_community_character_to_account(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCommunityCharacterSummaryOut:
    user = get_current_user(db, authorization)
    character = get_public_story_character_or_404(db, character_id)
    if character.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot add your own public character",
        )

    existing_addition_id = db.scalar(
        select(StoryCommunityCharacterAddition.id).where(
            StoryCommunityCharacterAddition.character_id == character.id,
            StoryCommunityCharacterAddition.user_id == user.id,
        )
    )
    addition_inserted = False
    if existing_addition_id is None:
        try:
            with db.begin_nested():
                db.add(
                    StoryCommunityCharacterAddition(
                        character_id=character.id,
                        user_id=user.id,
                    )
                )
                db.flush()
            addition_inserted = True
        except IntegrityError:
            addition_inserted = False

    if addition_inserted:
        increment_story_character_additions(db, character.id)

    existing_copy_id = db.scalar(
        select(StoryCharacter.id).where(
            StoryCharacter.user_id == user.id,
            StoryCharacter.source_character_id == character.id,
        )
    )
    if existing_copy_id is None:
        db.add(
            StoryCharacter(
                user_id=user.id,
                name=character.name,
                description=character.description,
                race=normalize_story_character_race(getattr(character, "race", "")),
                clothing=normalize_story_character_clothing(getattr(character, "clothing", "")),
                inventory=normalize_story_character_inventory(getattr(character, "inventory", "")),
                health_status=normalize_story_character_health_status(getattr(character, "health_status", "")),
                note=normalize_story_character_note(getattr(character, "note", "")),
                triggers=serialize_triggers(deserialize_triggers(character.triggers)),
                avatar_url=normalize_story_character_avatar_url(character.avatar_url, db=db),
                avatar_original_url=(
                    normalize_story_character_avatar_original_url(
                        getattr(character, "avatar_original_url", None),
                        db=db,
                    )
                    if getattr(character, "avatar_url", None)
                    else None
                ),
                avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
                emotion_assets=serialize_story_character_emotion_assets(getattr(character, "emotion_assets", "")),
                emotion_model=_normalize_optional_emotion_model(getattr(character, "emotion_model", "")),
                emotion_prompt_lock=_normalize_optional_emotion_prompt_lock(
                    getattr(character, "emotion_prompt_lock", "")
                ),
                source=normalize_story_character_source(character.source),
                visibility=STORY_CHARACTER_VISIBILITY_PRIVATE,
                source_character_id=character.id,
                community_rating_sum=0,
                community_rating_count=0,
                community_additions_count=0,
            )
        )
        upsert_story_character_race(db, user_id=int(user.id), name=getattr(character, "race", ""))

    db.commit()
    db.refresh(character)
    return _build_story_community_character_summary(
        db,
        user_id=user.id,
        character=character,
        is_added_by_user_override=True,
    )


@router.post("/api/story/characters/avatar/generate", response_model=StoryCharacterAvatarGenerateOut)
def generate_story_character_avatar(
    payload: StoryCharacterAvatarGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterAvatarGenerateOut:
    from app import main as monolith_main

    return monolith_main.generate_story_character_avatar_impl(
        payload=payload,
        authorization=authorization,
        db=db,
    )


@router.post(
    "/api/story/characters/emotions/generate",
    response_model=StoryCharacterEmotionGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_story_character_emotions(
    payload: StoryCharacterEmotionGenerateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterEmotionGenerateJobOut:
    user = get_current_user(db, authorization)
    if not _is_story_emotion_admin(user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    from app import main as monolith_main

    return monolith_main.queue_story_character_emotion_generation_job_impl(
        payload=payload,
        authorization=authorization,
        db=db,
    )


@router.get(
    "/api/story/characters/emotions/generate/{job_id}",
    response_model=StoryCharacterEmotionGenerateJobOut,
)
def get_story_character_emotion_generation_job(
    job_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterEmotionGenerateJobOut:
    user = get_current_user(db, authorization)
    if not _is_story_emotion_admin(user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    from app import main as monolith_main

    return monolith_main.get_story_character_emotion_generation_job_impl(
        job_id=job_id,
        authorization=authorization,
        db=db,
    )


@router.post("/api/story/characters", response_model=StoryCharacterOut)
def create_story_character(
    payload: StoryCharacterCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterOut:
    user = get_current_user(db, authorization)
    normalized_name = normalize_story_character_name(payload.name)
    normalized_description = normalize_story_character_description(payload.description)
    normalized_race = normalize_story_character_race(payload.race)
    normalized_clothing = normalize_story_character_clothing(payload.clothing)
    normalized_inventory = normalize_story_character_inventory(payload.inventory)
    normalized_health_status = normalize_story_character_health_status(payload.health_status)
    normalized_note = normalize_story_character_note(payload.note)
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url, db=db)
    avatar_original_url = normalize_story_character_avatar_original_url(payload.avatar_original_url, db=db)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    if avatar_url and not avatar_original_url:
        avatar_original_url = avatar_url
    emotion_assets, emotion_model, emotion_prompt_lock = _resolve_story_character_emotion_payload_for_write(
        db,
        user=user,
        payload=payload,
        avatar_url=avatar_url,
    )
    requested_visibility = normalize_story_character_visibility(payload.visibility)
    character = StoryCharacter(
        user_id=user.id,
        name=normalized_name,
        description=normalized_description,
        race=normalized_race,
        clothing=normalized_clothing,
        inventory=normalized_inventory,
        health_status=normalized_health_status,
        note=normalized_note,
        triggers=serialize_triggers(normalized_triggers),
        avatar_url=avatar_url,
        avatar_original_url=avatar_original_url if avatar_url else None,
        avatar_scale=avatar_scale,
        emotion_assets=serialize_story_character_emotion_assets(emotion_assets),
        emotion_model=emotion_model,
        emotion_prompt_lock=emotion_prompt_lock,
        source="user",
        visibility=STORY_CHARACTER_VISIBILITY_PRIVATE,
        source_character_id=None,
        community_rating_sum=0,
        community_rating_count=0,
        community_additions_count=0,
    )
    db.add(character)
    db.flush()
    upsert_story_character_race(db, user_id=int(user.id), name=normalized_race)
    if requested_visibility == STORY_CHARACTER_VISIBILITY_PUBLIC:
        mark_story_publication_pending(character)
    db.commit()
    db.refresh(character)
    if requested_visibility == STORY_CHARACTER_VISIBILITY_PUBLIC:
        character_name = str(character.name or "").strip() or f"Персонаж #{int(character.id)}"
        author_name = story_author_name(user)
        _notify_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Новый персонаж на модерации",
            body=f"{author_name} отправил на модерацию персонажа \"{character_name}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return story_character_to_out(character)


@router.patch("/api/story/characters/{character_id}", response_model=StoryCharacterOut)
def update_story_character(
    character_id: int,
    payload: StoryCharacterUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StoryCharacterOut:
    user = get_current_user(db, authorization)
    character = get_story_character_for_user_or_404(db, user.id, character_id)
    previous_publication_status = str(getattr(character, "publication_status", "") or "").strip().lower()
    normalized_name = normalize_story_character_name(payload.name)
    normalized_description = normalize_story_character_description(payload.description)
    normalized_race = normalize_story_character_race(payload.race)
    normalized_clothing = normalize_story_character_clothing(payload.clothing)
    normalized_inventory = normalize_story_character_inventory(payload.inventory)
    normalized_health_status = normalize_story_character_health_status(payload.health_status)
    normalized_note = normalize_story_character_note(payload.note)
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url, db=db)
    avatar_original_url = normalize_story_character_avatar_original_url(payload.avatar_original_url, db=db)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    if avatar_url and not avatar_original_url:
        avatar_original_url = avatar_url
    emotion_assets, emotion_model, emotion_prompt_lock = _resolve_story_character_emotion_payload_for_write(
        db,
        user=user,
        payload=payload,
        avatar_url=avatar_url,
        current_character=character,
    )
    character.name = normalized_name
    character.description = normalized_description
    character.race = normalized_race
    character.clothing = normalized_clothing
    character.inventory = normalized_inventory
    character.health_status = normalized_health_status
    character.note = normalized_note
    character.triggers = serialize_triggers(normalized_triggers)
    character.avatar_url = avatar_url
    character.avatar_original_url = avatar_original_url if avatar_url else None
    character.avatar_scale = avatar_scale
    character.emotion_assets = serialize_story_character_emotion_assets(emotion_assets)
    character.emotion_model = emotion_model
    character.emotion_prompt_lock = emotion_prompt_lock
    character.source = normalize_story_character_source(character.source)
    requested_visibility: str | None = None
    should_notify_publication_queue = False
    if payload.visibility is not None:
        requested_visibility = normalize_story_character_visibility(payload.visibility)
    if requested_visibility is not None:
        if requested_visibility == STORY_CHARACTER_VISIBILITY_PUBLIC and character.source_character_id is None:
            mark_story_publication_pending(character)
            character.visibility = STORY_CHARACTER_VISIBILITY_PRIVATE
            should_notify_publication_queue = previous_publication_status != "pending"
        else:
            if requested_visibility == STORY_CHARACTER_VISIBILITY_PRIVATE and character.source_character_id is None:
                clear_story_publication_state(character)
                publication_copy = _get_story_character_publication_copy(db, source_character_id=int(character.id))
                if publication_copy is not None:
                    _delete_story_character_with_relations(db, character_id=int(publication_copy.id))
            character.visibility = requested_visibility
    upsert_story_character_race(db, user_id=int(user.id), name=normalized_race)
    db.commit()
    db.refresh(character)
    if should_notify_publication_queue:
        character_name = str(character.name or "").strip() or f"Персонаж #{int(character.id)}"
        author_name = story_author_name(user)
        _notify_staff(
            db,
            kind=NOTIFICATION_KIND_MODERATION_QUEUE,
            title="Персонаж отправлен на модерацию",
            body=f"{author_name} отправил на модерацию персонажа \"{character_name}\".",
            action_url="/profile",
            actor_user_id=int(user.id),
        )
    return story_character_to_out(character)


@router.delete("/api/story/characters/{character_id}", response_model=MessageResponse)
def delete_story_character(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    character = get_story_character_for_user_or_404(db, user.id, character_id)
    _delete_story_character_with_relations(db, character_id=character.id)
    db.commit()
    return MessageResponse(message="Character deleted")
