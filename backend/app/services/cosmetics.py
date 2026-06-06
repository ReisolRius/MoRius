from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CosmeticItem, UserCosmeticPurchase
from app.schemas import CosmeticItemOut
from app.services.media import resolve_media_display_url

COSMETIC_KIND_AVATAR_FRAME = "avatar_frame"
COSMETIC_KIND_PROFILE_BANNER = "profile_banner"
COSMETIC_KINDS = {COSMETIC_KIND_AVATAR_FRAME, COSMETIC_KIND_PROFILE_BANNER}
PROFILE_BANNER_FREE_IDS = {"none", "1", "2", "3", "4", "5"}
AVATAR_FRAME_FREE_IDS = {"none", "p2", "p3", "p4", "p5"}
PROFILE_BANNER_DEFAULT_ID = "none"
AVATAR_FRAME_DEFAULT_ID = "none"
COSMETIC_SELECTION_PATTERN = re.compile(r"^(?P<prefix>[fb])(?P<item_id>[1-9][0-9]*)$")


def normalize_cosmetic_kind(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in COSMETIC_KINDS:
        return normalized
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported cosmetic kind")


def cosmetic_selection_id(item: CosmeticItem) -> str:
    prefix = "f" if str(item.kind) == COSMETIC_KIND_AVATAR_FRAME else "b"
    return f"{prefix}{int(item.id)}"


def parse_cosmetic_selection_id(value: str | None, *, kind: str) -> int | None:
    normalized = str(value or "").strip()
    match = COSMETIC_SELECTION_PATTERN.fullmatch(normalized)
    if not match:
        return None
    prefix = match.group("prefix")
    expected_prefix = "f" if kind == COSMETIC_KIND_AVATAR_FRAME else "b"
    if prefix != expected_prefix:
        return None
    return int(match.group("item_id"))


def is_free_cosmetic_selection(value: str | None, *, kind: str) -> bool:
    normalized = str(value or "").strip() or "none"
    if kind == COSMETIC_KIND_AVATAR_FRAME:
        return normalized in AVATAR_FRAME_FREE_IDS
    return normalized in PROFILE_BANNER_FREE_IDS


def list_user_owned_cosmetic_item_ids(db: Session, *, user_id: int) -> set[int]:
    rows = db.scalars(
        select(UserCosmeticPurchase.item_id).where(UserCosmeticPurchase.user_id == int(user_id))
    ).all()
    return {int(item_id) for item_id in rows if isinstance(item_id, int)}


def list_user_owned_selection_ids(db: Session, *, user_id: int) -> list[str]:
    owned_item_ids = list_user_owned_cosmetic_item_ids(db, user_id=user_id)
    if not owned_item_ids:
        return []
    items = db.scalars(
        select(CosmeticItem)
        .where(CosmeticItem.id.in_(owned_item_ids))
        .order_by(CosmeticItem.kind.asc(), CosmeticItem.id.asc())
    ).all()
    return [cosmetic_selection_id(item) for item in items]


def cosmetic_item_to_out(
    item: CosmeticItem,
    *,
    owned_item_ids: set[int] | None = None,
) -> CosmeticItemOut:
    owned_ids = owned_item_ids or set()
    image_url = resolve_media_display_url(
        str(item.image_url or "").strip() or None,
        kind="cosmetic-item-image",
        entity_id=int(item.id),
        version=getattr(item, "updated_at", None),
    )
    return CosmeticItemOut(
        id=int(item.id),
        kind=normalize_cosmetic_kind(item.kind),
        selection_id=cosmetic_selection_id(item),
        title=str(item.title or "").strip(),
        description=str(item.description or "").strip(),
        image_url=image_url or "",
        price_coins=max(int(item.price_coins or 0), 0),
        is_active=bool(item.is_active),
        is_owned=int(item.id) in owned_ids or max(int(item.price_coins or 0), 0) <= 0,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def get_active_cosmetic_item_by_selection_id(
    db: Session,
    *,
    value: str | None,
    kind: str,
) -> CosmeticItem | None:
    item_id = parse_cosmetic_selection_id(value, kind=kind)
    if item_id is None:
        return None
    return db.scalar(
        select(CosmeticItem).where(
            CosmeticItem.id == item_id,
            CosmeticItem.kind == kind,
            CosmeticItem.is_active.is_(True),
        )
    )


def get_cosmetic_item_by_selection_id(
    db: Session,
    *,
    value: str | None,
    kind: str,
) -> CosmeticItem | None:
    item_id = parse_cosmetic_selection_id(value, kind=kind)
    if item_id is None:
        return None
    return db.scalar(
        select(CosmeticItem).where(
            CosmeticItem.id == item_id,
            CosmeticItem.kind == kind,
        )
    )


def resolve_cosmetic_image_url_by_selection_id(
    db: Session,
    *,
    value: str | None,
    kind: str,
) -> str | None:
    item = get_cosmetic_item_by_selection_id(db, value=value, kind=kind)
    if item is None:
        return None
    return resolve_media_display_url(
        str(getattr(item, "image_url", "") or "").strip() or None,
        kind="cosmetic-item-image",
        entity_id=int(item.id),
        version=getattr(item, "updated_at", None),
    )


def user_owns_cosmetic_item(db: Session, *, user_id: int, item: CosmeticItem) -> bool:
    if max(int(item.price_coins or 0), 0) <= 0:
        return True
    purchase_id = db.scalar(
        select(UserCosmeticPurchase.id).where(
            UserCosmeticPurchase.user_id == int(user_id),
            UserCosmeticPurchase.item_id == int(item.id),
        )
    )
    return purchase_id is not None


def normalize_profile_banner_selection_for_user(db: Session, *, user_id: int, value: str | None) -> str:
    normalized = str(value or "").strip() or PROFILE_BANNER_DEFAULT_ID
    if is_free_cosmetic_selection(normalized, kind=COSMETIC_KIND_PROFILE_BANNER):
        return normalized
    item = get_cosmetic_item_by_selection_id(db, value=normalized, kind=COSMETIC_KIND_PROFILE_BANNER)
    if item is not None and user_owns_cosmetic_item(db, user_id=user_id, item=item):
        return cosmetic_selection_id(item)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile banner is not available")


def normalize_avatar_frame_selection_for_user(db: Session, *, user_id: int, value: str | None) -> str:
    normalized = str(value or "").strip() or AVATAR_FRAME_DEFAULT_ID
    if is_free_cosmetic_selection(normalized, kind=COSMETIC_KIND_AVATAR_FRAME):
        return normalized
    item = get_cosmetic_item_by_selection_id(db, value=normalized, kind=COSMETIC_KIND_AVATAR_FRAME)
    if item is not None and user_owns_cosmetic_item(db, user_id=user_id, item=item):
        return cosmetic_selection_id(item)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar frame is not available")
