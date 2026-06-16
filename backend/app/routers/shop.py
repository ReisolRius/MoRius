from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import and_, delete as sa_delete, func, or_, select, update as sa_update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    CosmeticItem,
    CreatorMonthSlot,
    StoryCharacter,
    StoryCommunityCharacterRating,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityWorldRating,
    StoryGame,
    StoryInstructionTemplate,
    User,
    UserCosmeticPurchase,
    UserEncouragement,
)
from app.schemas import (
    CoinPlanOut,
    CosmeticItemCreateRequest,
    CosmeticItemOut,
    CosmeticItemUpdateRequest,
    CosmeticPurchaseOut,
    CreatorCandidateListOut,
    CreatorCandidateOut,
    CreatorMonthListOut,
    CreatorMonthSlotOut,
    CreatorMonthSlotUpdateRequest,
    CreatorStatsOut,
    EncouragementCreateRequest,
    EncouragementOut,
    MessageResponse,
    ProfileUserOut,
    ShopCatalogOut,
    UserOut,
)
from app.services.auth_identity import get_current_user, serialize_user_out, user_has_admin_panel_access
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.cosmetics import (
    COSMETIC_KIND_AVATAR_FRAME,
    COSMETIC_KIND_PROFILE_BANNER,
    cosmetic_selection_id,
    cosmetic_item_to_out,
    list_user_owned_cosmetic_item_ids,
    list_user_owned_selection_ids,
    normalize_cosmetic_kind,
    resolve_cosmetic_image_url_by_selection_id,
)
from app.services.media import normalize_media_scale, resolve_media_display_url
from app.services.payments import COIN_TOP_UP_PLANS
from app.services.story_games import STORY_GAME_VISIBILITY_PUBLIC, story_author_avatar_frame_image_url, story_author_name
from app.services.story_characters import STORY_CHARACTER_VISIBILITY_PUBLIC
from app.services.story_cards import STORY_TEMPLATE_VISIBILITY_PUBLIC

router = APIRouter()

CREATOR_SLOT_VALUES = (1, 2, 3)
PROFILE_AVATAR_SCALE_DEFAULT = 1.0
CREATOR_CANDIDATE_SORT_VALUES = {
    "rating_desc",
    "publications_desc",
    "worlds_desc",
    "characters_desc",
    "instructions_desc",
    "newest",
}
CREATOR_CANDIDATE_DEFAULT_LIMIT = 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _default_creator_period() -> tuple[datetime, datetime]:
    end = _utcnow()
    return end - timedelta(days=30), end


def _resolve_period(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    default_start, default_end = _default_creator_period()
    resolved_start = start or default_start
    resolved_end = end or default_end
    if end is not None and resolved_end.time().replace(tzinfo=None) == datetime.min.time():
        resolved_end = resolved_end + timedelta(days=1) - timedelta(microseconds=1)
    if resolved_end <= resolved_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Period end should be after start")
    return resolved_start, resolved_end


def _require_staff(user: User) -> None:
    if not user_has_admin_panel_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or moderator access required")


def _require_administrator(user: User) -> None:
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")


def _validate_cosmetic_image_url(image_url: str) -> None:
    if not image_url.startswith("data:image/") and not image_url.startswith("/api/media/") and not image_url.startswith("http") and not image_url.startswith("/shop-assets/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image should be PNG/WebP/JPEG data URL or media URL")


def _profile_user_to_out(db: Session, user: User) -> ProfileUserOut:
    profile_banner_id = str(getattr(user, "profile_banner_id", "") or "").strip() or "none"
    return ProfileUserOut(
        id=int(user.id),
        display_name=story_author_name(user),
        profile_description=str(getattr(user, "profile_description", "") or "").strip(),
        profile_banner_id=profile_banner_id,
        profile_banner_image_url=resolve_cosmetic_image_url_by_selection_id(
            db,
            value=profile_banner_id,
            kind=COSMETIC_KIND_PROFILE_BANNER,
        ),
        avatar_frame_id=str(getattr(user, "avatar_frame_id", "") or "").strip() or "none",
        avatar_frame_image_url=story_author_avatar_frame_image_url(db, user),
        avatar_url=resolve_media_display_url(
            getattr(user, "avatar_url", None),
            kind="user-avatar",
            entity_id=int(user.id),
            version=getattr(user, "updated_at", None),
        ),
        avatar_scale=normalize_media_scale(
            getattr(user, "avatar_scale", None),
            default=PROFILE_AVATAR_SCALE_DEFAULT,
            min_value=1.0,
            max_value=3.0,
        ),
        created_at=user.created_at,
    )


def _coin_plans_to_out() -> list[CoinPlanOut]:
    return [
        CoinPlanOut(
            id=str(plan["id"]),
            title=str(plan["title"]),
            description=str(plan["description"]),
            price_rub=int(plan["price_rub"]),
            coins=int(plan["coins"]),
        )
        for plan in COIN_TOP_UP_PLANS
    ]


def _creator_publication_count(db: Session, model, *, user_id: int, visibility: str) -> int:
    value = db.scalar(
        select(func.count(model.id)).where(
            model.user_id == int(user_id),
            model.visibility == visibility,
        )
    )
    return int(value or 0)


def _creator_rating_totals(
    db: Session,
    model,
    rating_model,
    rating_target_column,
    *,
    user_id: int,
    start: datetime,
    end: datetime,
    visibility: str,
) -> tuple[int, int]:
    rating_period_expr = func.coalesce(rating_model.updated_at, rating_model.created_at)
    rating_sum, rating_count = db.execute(
        select(
            func.coalesce(func.sum(rating_model.rating), 0),
            func.count(rating_model.id),
        )
        .join(model, rating_target_column == model.id)
        .where(
            model.user_id == int(user_id),
            model.visibility == visibility,
            rating_period_expr >= start,
            rating_period_expr <= end,
        )
    ).one()
    return int(rating_sum or 0), int(rating_count or 0)


def _creator_publication_counts_by_user(db: Session, model, *, user_ids: list[int], visibility: str) -> dict[int, int]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(model.user_id, func.count(model.id))
        .where(
            model.user_id.in_(user_ids),
            model.visibility == visibility,
        )
        .group_by(model.user_id)
    ).all()
    return {int(user_id): int(count or 0) for user_id, count in rows}


def _creator_rating_totals_by_user(
    db: Session,
    model,
    rating_model,
    rating_target_column,
    *,
    user_ids: list[int],
    start: datetime,
    end: datetime,
    visibility: str,
) -> dict[int, tuple[int, int]]:
    if not user_ids:
        return {}
    rating_period_expr = func.coalesce(rating_model.updated_at, rating_model.created_at)
    rows = db.execute(
        select(
            model.user_id,
            func.coalesce(func.sum(rating_model.rating), 0),
            func.count(rating_model.id),
        )
        .join(model, rating_target_column == model.id)
        .where(
            model.user_id.in_(user_ids),
            model.visibility == visibility,
            rating_period_expr >= start,
            rating_period_expr <= end,
        )
        .group_by(model.user_id)
    ).all()
    return {int(user_id): (int(rating_sum or 0), int(rating_count or 0)) for user_id, rating_sum, rating_count in rows}


def _creator_period_key(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    return (start, end)


def _creator_stats_by_slot(
    db: Session,
    *,
    slot_periods: dict[int, tuple[int, datetime, datetime]],
) -> dict[int, CreatorStatsOut]:
    if not slot_periods:
        return {}

    user_ids = sorted({int(user_id) for user_id, _, _ in slot_periods.values()})
    worlds_by_user = _creator_publication_counts_by_user(
        db,
        StoryGame,
        user_ids=user_ids,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
    )
    characters_by_user = _creator_publication_counts_by_user(
        db,
        StoryCharacter,
        user_ids=user_ids,
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
    )
    templates_by_user = _creator_publication_counts_by_user(
        db,
        StoryInstructionTemplate,
        user_ids=user_ids,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
    )

    period_keys = {_creator_period_key(start, end) for _, start, end in slot_periods.values()}
    world_ratings_by_slot: dict[int, tuple[int, int]] = {}
    character_ratings_by_slot: dict[int, tuple[int, int]] = {}
    template_ratings_by_slot: dict[int, tuple[int, int]] = {}

    if len(period_keys) == 1:
        period_start, period_end = next(iter(period_keys))
        world_ratings_by_user = _creator_rating_totals_by_user(
            db,
            StoryGame,
            StoryCommunityWorldRating,
            StoryCommunityWorldRating.world_id,
            user_ids=user_ids,
            start=period_start,
            end=period_end,
            visibility=STORY_GAME_VISIBILITY_PUBLIC,
        )
        character_ratings_by_user = _creator_rating_totals_by_user(
            db,
            StoryCharacter,
            StoryCommunityCharacterRating,
            StoryCommunityCharacterRating.character_id,
            user_ids=user_ids,
            start=period_start,
            end=period_end,
            visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
        )
        template_ratings_by_user = _creator_rating_totals_by_user(
            db,
            StoryInstructionTemplate,
            StoryCommunityInstructionTemplateRating,
            StoryCommunityInstructionTemplateRating.template_id,
            user_ids=user_ids,
            start=period_start,
            end=period_end,
            visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
        )
        for slot, (user_id, _, _) in slot_periods.items():
            world_ratings_by_slot[slot] = world_ratings_by_user.get(int(user_id), (0, 0))
            character_ratings_by_slot[slot] = character_ratings_by_user.get(int(user_id), (0, 0))
            template_ratings_by_slot[slot] = template_ratings_by_user.get(int(user_id), (0, 0))
    else:
        for slot, (user_id, period_start, period_end) in slot_periods.items():
            world_ratings_by_slot[slot] = _creator_rating_totals(
                db,
                StoryGame,
                StoryCommunityWorldRating,
                StoryCommunityWorldRating.world_id,
                user_id=user_id,
                start=period_start,
                end=period_end,
                visibility=STORY_GAME_VISIBILITY_PUBLIC,
            )
            character_ratings_by_slot[slot] = _creator_rating_totals(
                db,
                StoryCharacter,
                StoryCommunityCharacterRating,
                StoryCommunityCharacterRating.character_id,
                user_id=user_id,
                start=period_start,
                end=period_end,
                visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
            )
            template_ratings_by_slot[slot] = _creator_rating_totals(
                db,
                StoryInstructionTemplate,
                StoryCommunityInstructionTemplateRating,
                StoryCommunityInstructionTemplateRating.template_id,
                user_id=user_id,
                start=period_start,
                end=period_end,
                visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
            )

    stats_by_slot: dict[int, CreatorStatsOut] = {}
    for slot, (user_id, _, _) in slot_periods.items():
        world_rating_sum, world_rating_count = world_ratings_by_slot.get(slot, (0, 0))
        character_rating_sum, character_rating_count = character_ratings_by_slot.get(slot, (0, 0))
        template_rating_sum, template_rating_count = template_ratings_by_slot.get(slot, (0, 0))
        stats_by_slot[slot] = _creator_stats_from_values(
            worlds=worlds_by_user.get(int(user_id), 0),
            characters=characters_by_user.get(int(user_id), 0),
            templates=templates_by_user.get(int(user_id), 0),
            rating_sum=world_rating_sum + character_rating_sum + template_rating_sum,
            rating_count=world_rating_count + character_rating_count + template_rating_count,
        )
    return stats_by_slot


def _creator_stats_from_values(
    *,
    worlds: int,
    characters: int,
    templates: int,
    rating_sum: int,
    rating_count: int,
) -> CreatorStatsOut:
    total_rating_count = max(int(rating_count or 0), 0)
    return CreatorStatsOut(
        worlds_count=max(int(worlds or 0), 0),
        characters_count=max(int(characters or 0), 0),
        instruction_templates_count=max(int(templates or 0), 0),
        publications_count=max(int(worlds or 0), 0) + max(int(characters or 0), 0) + max(int(templates or 0), 0),
        average_rating=round(max(int(rating_sum or 0), 0) / total_rating_count, 2) if total_rating_count > 0 else 0.0,
        rating_count=total_rating_count,
    )


def _creator_stats(db: Session, *, user_id: int, start: datetime, end: datetime) -> CreatorStatsOut:
    worlds = _creator_publication_count(
        db,
        StoryGame,
        user_id=user_id,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
    )
    characters = _creator_publication_count(
        db,
        StoryCharacter,
        user_id=user_id,
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
    )
    templates = _creator_publication_count(
        db,
        StoryInstructionTemplate,
        user_id=user_id,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
    )
    world_rating_sum, world_rating_count = _creator_rating_totals(
        db,
        StoryGame,
        StoryCommunityWorldRating,
        StoryCommunityWorldRating.world_id,
        user_id=user_id,
        start=start,
        end=end,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
    )
    character_rating_sum, character_rating_count = _creator_rating_totals(
        db,
        StoryCharacter,
        StoryCommunityCharacterRating,
        StoryCommunityCharacterRating.character_id,
        user_id=user_id,
        start=start,
        end=end,
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
    )
    template_rating_sum, template_rating_count = _creator_rating_totals(
        db,
        StoryInstructionTemplate,
        StoryCommunityInstructionTemplateRating,
        StoryCommunityInstructionTemplateRating.template_id,
        user_id=user_id,
        start=start,
        end=end,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
    )
    return _creator_stats_from_values(
        worlds=worlds,
        characters=characters,
        templates=templates,
        rating_sum=world_rating_sum + character_rating_sum + template_rating_sum,
        rating_count=world_rating_count + character_rating_count + template_rating_count,
    )


def _creator_publication_stats_subquery(model, *, visibility: str, count_label: str):
    return (
        select(
            model.user_id.label("user_id"),
            func.count(model.id).label(count_label),
        )
        .where(
            model.visibility == visibility,
        )
        .group_by(model.user_id)
        .subquery()
    )


def _creator_rating_stats_subquery(
    model,
    rating_model,
    rating_target_column,
    *,
    start: datetime,
    end: datetime,
    visibility: str,
    sum_label: str,
    count_label: str,
):
    rating_period_expr = func.coalesce(rating_model.updated_at, rating_model.created_at)
    return (
        select(
            model.user_id.label("user_id"),
            func.coalesce(func.sum(rating_model.rating), 0).label(sum_label),
            func.count(rating_model.id).label(count_label),
        )
        .join(model, rating_target_column == model.id)
        .where(
            model.visibility == visibility,
            rating_period_expr >= start,
            rating_period_expr <= end,
        )
        .group_by(model.user_id)
        .subquery()
    )


def _normalize_creator_candidate_sort(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in CREATOR_CANDIDATE_SORT_VALUES else "rating_desc"


def _creator_slot_to_out(db: Session, *, slot: int, row: CreatorMonthSlot | None, default_start: datetime, default_end: datetime) -> CreatorMonthSlotOut:
    period_start = row.period_start if row and row.period_start is not None else default_start
    period_end = row.period_end if row and row.period_end is not None else default_end
    user = db.get(User, int(row.user_id)) if row is not None and row.user_id is not None else None
    stats = _creator_stats(db, user_id=int(user.id), start=period_start, end=period_end) if user is not None else CreatorStatsOut()
    return CreatorMonthSlotOut(
        slot=slot,
        user=_profile_user_to_out(db, user) if user is not None else None,
        stats=stats,
        period_start=period_start,
        period_end=period_end,
    )


def _creator_slot_to_out_from_values(
    db: Session,
    *,
    slot: int,
    row: CreatorMonthSlot | None,
    user: User | None,
    stats: CreatorStatsOut | None,
    default_start: datetime,
    default_end: datetime,
) -> CreatorMonthSlotOut:
    period_start = row.period_start if row and row.period_start is not None else default_start
    period_end = row.period_end if row and row.period_end is not None else default_end
    return CreatorMonthSlotOut(
        slot=slot,
        user=_profile_user_to_out(db, user) if user is not None else None,
        stats=stats if stats is not None else CreatorStatsOut(),
        period_start=period_start,
        period_end=period_end,
    )


def _resolve_encouragement_target(db: Session, *, target_type: str, target_id: int) -> User:
    if target_type == "world":
        target = db.scalar(
            select(StoryGame).where(
                StoryGame.id == int(target_id),
                StoryGame.visibility == STORY_GAME_VISIBILITY_PUBLIC,
            )
        )
    elif target_type == "character":
        target = db.scalar(
            select(StoryCharacter).where(
                StoryCharacter.id == int(target_id),
                StoryCharacter.visibility == STORY_CHARACTER_VISIBILITY_PUBLIC,
            )
        )
    else:
        target = db.scalar(
            select(StoryInstructionTemplate).where(
                StoryInstructionTemplate.id == int(target_id),
                StoryInstructionTemplate.visibility == STORY_TEMPLATE_VISIBILITY_PUBLIC,
            )
        )
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publication not found")
    recipient = db.get(User, int(target.user_id))
    if recipient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found")
    return recipient


@router.get("/api/shop/catalog", response_model=ShopCatalogOut)
def get_shop_catalog(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ShopCatalogOut:
    user = get_current_user(db, authorization)
    owned_item_ids = list_user_owned_cosmetic_item_ids(db, user_id=int(user.id))
    can_manage_shop = user_has_admin_panel_access(user)
    statement = select(CosmeticItem)
    if can_manage_shop:
        statement = statement.order_by(CosmeticItem.is_active.desc(), CosmeticItem.kind.asc(), CosmeticItem.price_coins.asc(), CosmeticItem.id.asc())
    else:
        statement = (
            statement
            .where(
                or_(
                    and_(CosmeticItem.is_active.is_(True), CosmeticItem.price_coins > 0),
                    CosmeticItem.id.in_(owned_item_ids) if owned_item_ids else False,
                )
            )
            .order_by(CosmeticItem.price_coins.asc(), CosmeticItem.id.asc())
        )
    items = db.scalars(statement).all()
    frames: list[CosmeticItemOut] = []
    banners: list[CosmeticItemOut] = []
    for item in items:
        item_out = cosmetic_item_to_out(item, owned_item_ids=owned_item_ids)
        if item_out.kind == COSMETIC_KIND_AVATAR_FRAME:
            frames.append(item_out)
        elif item_out.kind == COSMETIC_KIND_PROFILE_BANNER:
            banners.append(item_out)
    return ShopCatalogOut(
        plans=_coin_plans_to_out(),
        avatar_frames=frames,
        profile_banners=banners,
        owned_selection_ids=list_user_owned_selection_ids(db, user_id=int(user.id)),
    )


@router.post("/api/shop/cosmetics", response_model=CosmeticItemOut)
def create_shop_cosmetic_item(
    payload: CosmeticItemCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CosmeticItemOut:
    user = get_current_user(db, authorization)
    _require_staff(user)
    image_url = str(payload.image_url or "").strip()
    _validate_cosmetic_image_url(image_url)
    item = CosmeticItem(
        kind=normalize_cosmetic_kind(payload.kind),
        title=" ".join(payload.title.split()).strip(),
        description=str(payload.description or "").strip(),
        image_url=image_url,
        price_coins=int(payload.price_coins),
        is_active=True,
        created_by_user_id=int(user.id),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return cosmetic_item_to_out(item, owned_item_ids=set())


@router.patch("/api/shop/cosmetics/{item_id}", response_model=CosmeticItemOut)
def update_shop_cosmetic_item(
    item_id: int,
    payload: CosmeticItemUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CosmeticItemOut:
    user = get_current_user(db, authorization)
    _require_staff(user)
    item = db.get(CosmeticItem, int(item_id))
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cosmetic item not found")

    if payload.title is not None:
        item.title = " ".join(payload.title.split()).strip()
    if payload.description is not None:
        item.description = str(payload.description or "").strip()
    if payload.image_url is not None:
        image_url = str(payload.image_url or "").strip()
        _validate_cosmetic_image_url(image_url)
        item.image_url = image_url
    if payload.price_coins is not None:
        item.price_coins = int(payload.price_coins)
    if payload.is_active is not None:
        item.is_active = bool(payload.is_active)

    db.commit()
    db.refresh(item)
    owned_item_ids = list_user_owned_cosmetic_item_ids(db, user_id=int(user.id))
    return cosmetic_item_to_out(item, owned_item_ids=owned_item_ids)


@router.delete("/api/shop/cosmetics/{item_id}", response_model=MessageResponse)
def delete_shop_cosmetic_item(
    item_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_current_user(db, authorization)
    _require_staff(user)
    item = db.get(CosmeticItem, int(item_id))
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cosmetic item not found")

    selection_id = cosmetic_selection_id(item)
    item_kind = normalize_cosmetic_kind(item.kind)
    if item_kind == COSMETIC_KIND_AVATAR_FRAME:
        db.execute(
            sa_update(User)
            .where(User.avatar_frame_id == selection_id)
            .values(avatar_frame_id="none")
        )
    elif item_kind == COSMETIC_KIND_PROFILE_BANNER:
        db.execute(
            sa_update(User)
            .where(User.profile_banner_id == selection_id)
            .values(profile_banner_id="none")
        )
    db.execute(sa_delete(UserCosmeticPurchase).where(UserCosmeticPurchase.item_id == int(item.id)))
    db.delete(item)
    db.commit()
    return MessageResponse(message="Cosmetic item deleted")


@router.post("/api/shop/cosmetics/{item_id}/purchase", response_model=CosmeticPurchaseOut)
def purchase_shop_cosmetic_item(
    item_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CosmeticPurchaseOut:
    user = get_current_user(db, authorization)
    item = db.scalar(select(CosmeticItem).where(CosmeticItem.id == int(item_id), CosmeticItem.is_active.is_(True)))
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cosmetic item not found")
    price = max(int(item.price_coins or 0), 0)
    if price <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cosmetic item is not available for purchase")
    existing_purchase = db.scalar(
        select(UserCosmeticPurchase).where(
            UserCosmeticPurchase.user_id == int(user.id),
            UserCosmeticPurchase.item_id == int(item.id),
        )
    )
    if existing_purchase is None:
        if not spend_user_tokens_if_sufficient(db, user_id=int(user.id), tokens=price):
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Недостаточно солов")
        db.add(
            UserCosmeticPurchase(
                user_id=int(user.id),
                item_id=int(item.id),
                price_coins=price,
            )
        )
        db.flush()
    db.commit()
    db.refresh(user)
    owned_item_ids = list_user_owned_cosmetic_item_ids(db, user_id=int(user.id))
    return CosmeticPurchaseOut(
        item=cosmetic_item_to_out(item, owned_item_ids=owned_item_ids),
        coins=max(int(user.coins or 0), 0),
        user=serialize_user_out(user, db=db),
    )


@router.post("/api/shop/encouragements", response_model=EncouragementOut)
def create_publication_encouragement(
    payload: EncouragementCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> EncouragementOut:
    sender = get_current_user(db, authorization)
    amount = max(int(payload.amount_coins or 0), 0)
    if amount < 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Минимум для поддержки — 5 солов")
    recipient = _resolve_encouragement_target(db, target_type=payload.target_type, target_id=int(payload.target_id))
    if int(recipient.id) == int(sender.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя поддержать свою публикацию")
    if not spend_user_tokens_if_sufficient(db, user_id=int(sender.id), tokens=amount):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Недостаточно солов")
    add_user_tokens(db, user_id=int(recipient.id), tokens=amount)
    encouragement = UserEncouragement(
        sender_user_id=int(sender.id),
        recipient_user_id=int(recipient.id),
        target_type=payload.target_type,
        target_id=int(payload.target_id),
        amount_coins=amount,
        message=str(payload.message or "").strip(),
    )
    db.add(encouragement)
    db.commit()
    db.refresh(sender)
    db.refresh(encouragement)
    return EncouragementOut(
        id=int(encouragement.id),
        sender_user_id=int(encouragement.sender_user_id),
        recipient_user_id=int(encouragement.recipient_user_id),
        target_type=encouragement.target_type,
        target_id=int(encouragement.target_id),
        amount_coins=int(encouragement.amount_coins),
        message=str(encouragement.message or ""),
        created_at=encouragement.created_at,
        user=serialize_user_out(sender, db=db),
    )


@router.get("/api/shop/creators/month", response_model=CreatorMonthListOut)
def get_creator_month_slots(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CreatorMonthListOut:
    get_current_user(db, authorization)
    default_start, default_end = _default_creator_period()
    rows = db.scalars(select(CreatorMonthSlot).where(CreatorMonthSlot.slot.in_(CREATOR_SLOT_VALUES))).all()
    row_by_slot = {int(row.slot): row for row in rows}
    user_ids = sorted(
        {
            int(row.user_id)
            for row in rows
            if row.user_id is not None
        }
    )
    users_by_id = {
        int(user.id): user
        for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}
    slot_periods = {
        slot: (
            int(row.user_id),
            row.period_start if row.period_start is not None else default_start,
            row.period_end if row.period_end is not None else default_end,
        )
        for slot, row in row_by_slot.items()
        if row.user_id is not None and int(row.user_id) in users_by_id
    }
    stats_by_slot = _creator_stats_by_slot(db, slot_periods=slot_periods)
    return CreatorMonthListOut(
        slots=[
            _creator_slot_to_out_from_values(
                db,
                slot=slot,
                row=row_by_slot.get(slot),
                user=users_by_id.get(int(row_by_slot[slot].user_id)) if row_by_slot.get(slot) is not None and row_by_slot[slot].user_id is not None else None,
                stats=stats_by_slot.get(slot),
                default_start=default_start,
                default_end=default_end,
            )
            for slot in CREATOR_SLOT_VALUES
        ],
        period_start=default_start,
        period_end=default_end,
    )


@router.put("/api/shop/creators/month/{slot}", response_model=CreatorMonthSlotOut)
def update_creator_month_slot(
    slot: int,
    payload: CreatorMonthSlotUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CreatorMonthSlotOut:
    user = get_current_user(db, authorization)
    _require_staff(user)
    if slot not in CREATOR_SLOT_VALUES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Creator slot not found")
    period_start, period_end = _resolve_period(payload.period_start, payload.period_end)
    target_user = db.get(User, int(payload.user_id)) if payload.user_id is not None else None
    if payload.user_id is not None and target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row = db.scalar(select(CreatorMonthSlot).where(CreatorMonthSlot.slot == int(slot)))
    if row is None:
        row = CreatorMonthSlot(slot=int(slot))
        db.add(row)
        db.flush()
    row.user_id = int(target_user.id) if target_user is not None else None
    row.period_start = period_start
    row.period_end = period_end
    db.commit()
    db.refresh(row)
    return _creator_slot_to_out(db, slot=slot, row=row, default_start=period_start, default_end=period_end)


@router.get("/api/shop/creators/candidates", response_model=CreatorCandidateListOut)
def list_creator_candidates(
    query: str = Query(default="", max_length=120),
    period_start: datetime | None = Query(default=None),
    period_end: datetime | None = Query(default=None),
    sort: str = Query(default="rating_desc"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=CREATOR_CANDIDATE_DEFAULT_LIMIT, ge=1, le=60),
    has_publications: bool = Query(default=False),
    has_ratings: bool = Query(default=False),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CreatorCandidateListOut:
    user = get_current_user(db, authorization)
    _require_staff(user)
    start, end = _resolve_period(period_start, period_end)
    normalized_query = " ".join(str(query or "").split()).strip()
    normalized_sort = _normalize_creator_candidate_sort(sort)

    world_publications = _creator_publication_stats_subquery(
        StoryGame,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
        count_label="worlds_count",
    )
    character_publications = _creator_publication_stats_subquery(
        StoryCharacter,
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
        count_label="characters_count",
    )
    template_publications = _creator_publication_stats_subquery(
        StoryInstructionTemplate,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
        count_label="templates_count",
    )
    world_ratings = _creator_rating_stats_subquery(
        StoryGame,
        StoryCommunityWorldRating,
        StoryCommunityWorldRating.world_id,
        start=start,
        end=end,
        visibility=STORY_GAME_VISIBILITY_PUBLIC,
        sum_label="world_rating_sum",
        count_label="world_rating_count",
    )
    character_ratings = _creator_rating_stats_subquery(
        StoryCharacter,
        StoryCommunityCharacterRating,
        StoryCommunityCharacterRating.character_id,
        start=start,
        end=end,
        visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
        sum_label="character_rating_sum",
        count_label="character_rating_count",
    )
    template_ratings = _creator_rating_stats_subquery(
        StoryInstructionTemplate,
        StoryCommunityInstructionTemplateRating,
        StoryCommunityInstructionTemplateRating.template_id,
        start=start,
        end=end,
        visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
        sum_label="template_rating_sum",
        count_label="template_rating_count",
    )

    worlds_expr = func.coalesce(world_publications.c.worlds_count, 0)
    characters_expr = func.coalesce(character_publications.c.characters_count, 0)
    templates_expr = func.coalesce(template_publications.c.templates_count, 0)
    publications_expr = worlds_expr + characters_expr + templates_expr
    rating_sum_expr = (
        func.coalesce(world_ratings.c.world_rating_sum, 0)
        + func.coalesce(character_ratings.c.character_rating_sum, 0)
        + func.coalesce(template_ratings.c.template_rating_sum, 0)
    )
    rating_count_expr = (
        func.coalesce(world_ratings.c.world_rating_count, 0)
        + func.coalesce(character_ratings.c.character_rating_count, 0)
        + func.coalesce(template_ratings.c.template_rating_count, 0)
    )
    rating_average_expr = func.coalesce((rating_sum_expr * 1.0) / func.nullif(rating_count_expr, 0), 0.0)

    statement = (
        select(
            User,
            worlds_expr.label("worlds_count"),
            characters_expr.label("characters_count"),
            templates_expr.label("templates_count"),
            rating_sum_expr.label("rating_sum"),
            rating_count_expr.label("rating_count"),
        )
        .outerjoin(world_publications, world_publications.c.user_id == User.id)
        .outerjoin(character_publications, character_publications.c.user_id == User.id)
        .outerjoin(template_publications, template_publications.c.user_id == User.id)
        .outerjoin(world_ratings, world_ratings.c.user_id == User.id)
        .outerjoin(character_ratings, character_ratings.c.user_id == User.id)
        .outerjoin(template_ratings, template_ratings.c.user_id == User.id)
    )
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(or_(User.email.ilike(pattern), User.display_name.ilike(pattern)))
    if has_publications:
        statement = statement.where(publications_expr > 0)
    if has_ratings:
        statement = statement.where(rating_count_expr > 0)

    total = int(db.scalar(select(func.count()).select_from(statement.with_only_columns(User.id).order_by(None).subquery())) or 0)

    if normalized_sort == "publications_desc":
        statement = statement.order_by(publications_expr.desc(), rating_average_expr.desc(), rating_count_expr.desc(), User.created_at.desc(), User.id.desc())
    elif normalized_sort == "worlds_desc":
        statement = statement.order_by(worlds_expr.desc(), rating_average_expr.desc(), publications_expr.desc(), User.created_at.desc(), User.id.desc())
    elif normalized_sort == "characters_desc":
        statement = statement.order_by(characters_expr.desc(), rating_average_expr.desc(), publications_expr.desc(), User.created_at.desc(), User.id.desc())
    elif normalized_sort == "instructions_desc":
        statement = statement.order_by(templates_expr.desc(), rating_average_expr.desc(), publications_expr.desc(), User.created_at.desc(), User.id.desc())
    elif normalized_sort == "newest":
        statement = statement.order_by(User.created_at.desc(), User.id.desc())
    else:
        statement = statement.order_by(rating_average_expr.desc(), rating_count_expr.desc(), publications_expr.desc(), User.created_at.desc(), User.id.desc())

    rows = db.execute(statement.offset(offset).limit(limit)).all()
    items: list[CreatorCandidateOut] = []
    for row in rows:
        candidate = row[0]
        mapping = row._mapping
        items.append(
            CreatorCandidateOut(
                user=_profile_user_to_out(db, candidate),
                stats=_creator_stats_from_values(
                    worlds=int(mapping["worlds_count"] or 0),
                    characters=int(mapping["characters_count"] or 0),
                    templates=int(mapping["templates_count"] or 0),
                    rating_sum=int(mapping["rating_sum"] or 0),
                    rating_count=int(mapping["rating_count"] or 0),
                ),
            )
        )
    return CreatorCandidateListOut(
        items=items,
        period_start=start,
        period_end=end,
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )
