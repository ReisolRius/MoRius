from __future__ import annotations

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    StoryCharacter,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterReport,
    StoryCommunityCharacterRating,
    User,
)
from app.schemas import (
    MessageResponse,
    StoryCommunityCharacterSummaryOut,
    StoryCommunityWorldReportCreateRequest,
    StoryCommunityWorldRatingRequest,
    StoryCharacterCreateRequest,
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
    coerce_story_character_visibility,
    deserialize_triggers,
    normalize_story_avatar_scale,
    normalize_story_character_avatar_url,
    normalize_story_character_description,
    normalize_story_character_name,
    normalize_story_character_source,
    normalize_story_character_triggers,
    normalize_story_character_visibility,
    serialize_triggers,
    story_character_rating_average,
    story_character_to_out,
    unlink_story_character_from_world_cards,
)
from app.services.story_games import story_author_avatar_url, story_author_name
from app.services.story_queries import (
    get_public_story_character_or_404,
    get_story_character_for_user_or_404,
    list_story_characters,
)

router = APIRouter()
STORY_CHARACTER_REPORT_STATUS_OPEN = "open"


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
        id=character.id,
        name=character.name,
        description=character.description,
        triggers=deserialize_triggers(character.triggers),
        avatar_url=character.avatar_url,
        avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
        visibility=coerce_story_character_visibility(getattr(character, "visibility", None)),
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


@router.get("/api/story/characters", response_model=list[StoryCharacterOut])
def list_story_characters_route(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCharacterOut]:
    user = get_current_user(db, authorization)
    characters = list_story_characters(db, user.id)
    return [story_character_to_out(character) for character in characters]


@router.get("/api/story/community/characters", response_model=list[StoryCommunityCharacterSummaryOut])
def list_story_community_characters(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[StoryCommunityCharacterSummaryOut]:
    user = get_current_user(db, authorization)
    characters = db.scalars(
        select(StoryCharacter)
        .where(
            StoryCharacter.visibility == "public",
            StoryCharacter.source_character_id.is_(None),
        )
        .order_by(
            StoryCharacter.community_additions_count.desc(),
            StoryCharacter.community_rating_count.desc(),
            StoryCharacter.id.desc(),
        )
        .limit(80)
    ).all()
    if not characters:
        return []

    character_ids = [character.id for character in characters]
    author_ids = sorted({character.user_id for character in characters})
    authors = db.scalars(select(User).where(User.id.in_(author_ids))).all()
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

    return [
        StoryCommunityCharacterSummaryOut(
            id=character.id,
            name=character.name,
            description=character.description,
            triggers=deserialize_triggers(character.triggers),
            avatar_url=character.avatar_url,
            avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
            visibility=coerce_story_character_visibility(getattr(character, "visibility", None)),
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
        for character in characters
    ]


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
                triggers=serialize_triggers(deserialize_triggers(character.triggers)),
                avatar_url=normalize_story_character_avatar_url(character.avatar_url),
                avatar_scale=normalize_story_avatar_scale(character.avatar_scale),
                source=normalize_story_character_source(character.source),
                visibility=STORY_CHARACTER_VISIBILITY_PRIVATE,
                source_character_id=character.id,
                community_rating_sum=0,
                community_rating_count=0,
                community_additions_count=0,
            )
        )

    db.commit()
    db.refresh(character)
    return _build_story_community_character_summary(
        db,
        user_id=user.id,
        character=character,
        is_added_by_user_override=True,
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
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    visibility = normalize_story_character_visibility(payload.visibility)
    character = StoryCharacter(
        user_id=user.id,
        name=normalized_name,
        description=normalized_description,
        triggers=serialize_triggers(normalized_triggers),
        avatar_url=avatar_url,
        avatar_scale=avatar_scale,
        source="user",
        visibility=visibility,
        source_character_id=None,
        community_rating_sum=0,
        community_rating_count=0,
        community_additions_count=0,
    )
    db.add(character)
    db.commit()
    db.refresh(character)
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
    normalized_name = normalize_story_character_name(payload.name)
    normalized_description = normalize_story_character_description(payload.description)
    normalized_triggers = normalize_story_character_triggers(payload.triggers, fallback_name=normalized_name)
    avatar_url = normalize_story_character_avatar_url(payload.avatar_url)
    avatar_scale = normalize_story_avatar_scale(payload.avatar_scale)
    character.name = normalized_name
    character.description = normalized_description
    character.triggers = serialize_triggers(normalized_triggers)
    character.avatar_url = avatar_url
    character.avatar_scale = avatar_scale
    character.source = normalize_story_character_source(character.source)
    if payload.visibility is not None:
        character.visibility = normalize_story_character_visibility(payload.visibility)
    db.commit()
    db.refresh(character)
    return story_character_to_out(character)


@router.delete("/api/story/characters/{character_id}", response_model=MessageResponse)
def delete_story_character(
    character_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    character = get_story_character_for_user_or_404(db, user.id, character_id)
    db.execute(
        sa_delete(StoryCommunityCharacterRating).where(
            StoryCommunityCharacterRating.character_id == character.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityCharacterAddition).where(
            StoryCommunityCharacterAddition.character_id == character.id,
        )
    )
    db.execute(
        sa_delete(StoryCommunityCharacterReport).where(
            StoryCommunityCharacterReport.character_id == character.id,
        )
    )
    unlink_story_character_from_world_cards(db, character_id=character.id)
    db.delete(character)
    db.commit()
    return MessageResponse(message="Character deleted")
