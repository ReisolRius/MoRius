from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DashboardNewsCard
from app.schemas import DashboardNewsCardOut, DashboardNewsCardUpdateRequest
from app.services.auth_identity import ADMIN_PANEL_ALLOWED_ROLES, get_current_user

router = APIRouter()

DEFAULT_DASHBOARD_NEWS_CARDS: tuple[dict[str, str | int | None], ...] = (
    {
        "slot": 1,
        "category": "Обновление",
        "title": "Быстрый старт и обновлённая главная",
        "description": "На главной появился быстрый запуск приключения, новый блок новостей и более быстрые карточки миров.",
        "image_url": None,
        "date_label": "30 марта 2026",
    },
    {
        "slot": 2,
        "category": "Игровой процесс",
        "title": "Профиль и карточки стали легче",
        "description": "Карточки персонажей и миров открываются быстрее, а изображения подгружаются уже после текста и структуры.",
        "image_url": None,
        "date_label": "29 марта 2026",
    },
    {
        "slot": 3,
        "category": "Профиль",
        "title": "Медиа грузятся отдельно от данных",
        "description": "Аватары, баннеры и обложки догружаются после текста, поэтому карточки можно открыть почти сразу.",
        "image_url": None,
        "date_label": "28 марта 2026",
    },
    {
        "slot": 4,
        "category": "Сообщество",
        "title": "Новости теперь можно редактировать без деплоя",
        "description": "Администраторы и модераторы могут менять карточки новостей прямо из интерфейса, и изменения сразу увидят игроки.",
        "image_url": None,
        "date_label": "27 марта 2026",
    },
)


def _normalize_dashboard_news_text(value: str, *, field_label: str, preserve_lines: bool = False) -> str:
    normalized_source = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    if preserve_lines:
        normalized = normalized_source.strip()
    else:
        normalized = " ".join(normalized_source.split()).strip()
    if normalized:
        return normalized
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"{field_label} cannot be empty",
    )


def _normalize_dashboard_news_image_url(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if len(normalized) > 3_000_000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dashboard news image is too large",
        )
    return normalized


def _require_dashboard_news_editor(user) -> None:
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role in ADMIN_PANEL_ALLOWED_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to edit dashboard news",
    )


def _list_dashboard_news_cards(db: Session) -> list[DashboardNewsCard]:
    cards = db.scalars(select(DashboardNewsCard).order_by(DashboardNewsCard.slot.asc(), DashboardNewsCard.id.asc())).all()
    if len(cards) >= len(DEFAULT_DASHBOARD_NEWS_CARDS):
        return cards

    existing_slots = {card.slot for card in cards}
    inserted = False
    for default_card in DEFAULT_DASHBOARD_NEWS_CARDS:
        slot = int(default_card["slot"])
        if slot in existing_slots:
            continue
        db.add(
            DashboardNewsCard(
                slot=slot,
                category=str(default_card["category"]),
                title=str(default_card["title"]),
                description=str(default_card["description"]),
                image_url=_normalize_dashboard_news_image_url(default_card.get("image_url")),  # type: ignore[arg-type]
                date_label=str(default_card["date_label"]),
            )
        )
        inserted = True
    if inserted:
        db.commit()
        cards = db.scalars(select(DashboardNewsCard).order_by(DashboardNewsCard.slot.asc(), DashboardNewsCard.id.asc())).all()
    return cards


@router.get("/api/auth/dashboard-news", response_model=list[DashboardNewsCardOut])
def list_dashboard_news(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[DashboardNewsCardOut]:
    _ = get_current_user(db, authorization)
    cards = _list_dashboard_news_cards(db)
    return [DashboardNewsCardOut.model_validate(card) for card in cards]


@router.patch("/api/auth/dashboard-news/{news_id}", response_model=DashboardNewsCardOut)
def update_dashboard_news(
    news_id: int,
    payload: DashboardNewsCardUpdateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> DashboardNewsCardOut:
    user = get_current_user(db, authorization)
    _require_dashboard_news_editor(user)
    _list_dashboard_news_cards(db)

    card = db.scalar(select(DashboardNewsCard).where(DashboardNewsCard.id == news_id))
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard news card not found")

    card.category = _normalize_dashboard_news_text(payload.category, field_label="Dashboard news category")
    card.title = _normalize_dashboard_news_text(payload.title, field_label="Dashboard news title")
    card.description = _normalize_dashboard_news_text(
        payload.description,
        field_label="Dashboard news description",
        preserve_lines=True,
    )
    card.image_url = _normalize_dashboard_news_image_url(payload.image_url)
    card.date_label = _normalize_dashboard_news_text(payload.date_label, field_label="Dashboard news date")
    db.commit()
    db.refresh(card)
    return DashboardNewsCardOut.model_validate(card)
