from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WikiArticle, WikiArticleImage
from app.schemas import (
    WikiArticleDetailOut,
    WikiArticleImageOut,
    WikiArticleListItemOut,
    WikiArticleSaveRequest,
    WikiReorderRequest,
)
from app.services.auth_identity import ROLE_ADMINISTRATOR, get_current_user
from app.services.media import resolve_media_display_url, validate_avatar_url

router = APIRouter()

WIKI_IMAGE_MAX_BYTES = 3_000_000
_IMAGE_PLACEHOLDER_RE = re.compile(r"\[\[image:([^\]\n]+)\]\]")
_MARKUP_STRIP_RE = re.compile(r"[#>*_`\-]+")


def _require_wiki_editor(authorization: str | None, db: Session) -> "object":
    """Only administrators may create, edit, reorder or delete wiki articles."""
    user = get_current_user(db, authorization)
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role != ROLE_ADMINISTRATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только администратор может редактировать вики",
        )
    return user


def _normalize_body(value: str) -> str:
    normalized = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.split("\n")]
    return "\n".join(lines).strip()


def _build_search_text(title: str, summary: str, body: str) -> str:
    body_without_images = _IMAGE_PLACEHOLDER_RE.sub(" ", body or "")
    stripped = _MARKUP_STRIP_RE.sub(" ", body_without_images)
    combined = " ".join(part for part in (title, summary, stripped) if part)
    return " ".join(combined.split()).lower()


def _ordered_body_keys(body: str) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for match in _IMAGE_PLACEHOLDER_RE.finditer(body or ""):
        key = match.group(1).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def _resolve_wiki_image_url(image: WikiArticleImage) -> str | None:
    return resolve_media_display_url(
        image.image_url,
        kind="wiki-article-image",
        entity_id=image.id,
        version=image.updated_at,
    )


def _load_article_images(db: Session, article_id: int) -> list[WikiArticleImage]:
    return list(
        db.scalars(
            select(WikiArticleImage)
            .where(WikiArticleImage.article_id == article_id)
            .order_by(WikiArticleImage.position.asc(), WikiArticleImage.id.asc())
        ).all()
    )


def _serialize_detail(db: Session, article: WikiArticle) -> WikiArticleDetailOut:
    images_out: list[WikiArticleImageOut] = []
    for image in _load_article_images(db, article.id):
        resolved = _resolve_wiki_image_url(image)
        if resolved:
            images_out.append(WikiArticleImageOut(id=image.id, url=resolved))
    return WikiArticleDetailOut(
        id=article.id,
        title=article.title,
        category=article.category or "",
        summary=article.summary or "",
        body=article.body or "",
        position=article.position,
        images=images_out,
        created_at=article.created_at,
        updated_at=article.updated_at,
    )


def _apply_article_save(db: Session, article: WikiArticle, payload: WikiArticleSaveRequest) -> None:
    title = " ".join(str(payload.title or "").split()).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Заголовок не может быть пустым")
    category = " ".join(str(payload.category or "").split()).strip()
    summary = str(payload.summary or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    body = _normalize_body(payload.body)

    article.title = title
    article.category = category
    article.summary = summary

    # Ensure the article has an id so freshly-created images can reference it.
    if article.id is None:
        db.add(article)
        db.flush()

    existing_images = {image.id: image for image in _load_article_images(db, article.id)}
    payload_by_key = {str(item.key).strip(): item for item in payload.images if str(item.key).strip()}

    key_to_final_id: dict[str, int | None] = {}
    for position, key in enumerate(_ordered_body_keys(body)):
        entry = payload_by_key.get(key)
        final_id: int | None = None
        if entry is not None and entry.data_url and str(entry.data_url).strip():
            validated = validate_avatar_url(str(entry.data_url).strip(), max_bytes=WIKI_IMAGE_MAX_BYTES)
            new_image = WikiArticleImage(article_id=article.id, image_url=validated, position=position)
            db.add(new_image)
            db.flush()
            final_id = new_image.id
        elif entry is not None and entry.image_id is not None and int(entry.image_id) in existing_images:
            reused = existing_images[int(entry.image_id)]
            reused.position = position
            final_id = reused.id
        elif key.isdigit() and int(key) in existing_images:
            reused = existing_images[int(key)]
            reused.position = position
            final_id = reused.id
        key_to_final_id[key] = final_id

    def _replace(match: "re.Match[str]") -> str:
        key = match.group(1).strip()
        final_id = key_to_final_id.get(key)
        if final_id is None:
            return ""
        return f"[[image:{final_id}]]"

    rewritten_body = _IMAGE_PLACEHOLDER_RE.sub(_replace, body)
    referenced_ids = {value for value in key_to_final_id.values() if value is not None}

    for image_id, image in existing_images.items():
        if image_id not in referenced_ids:
            db.delete(image)

    article.body = rewritten_body
    article.search_text = _build_search_text(title, summary, rewritten_body)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/api/auth/wiki/articles", response_model=list[WikiArticleListItemOut])
def list_wiki_articles(
    query: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
) -> list[WikiArticleListItemOut]:
    """Public: list wiki articles (optionally filtered by a case-insensitive search)."""
    statement = select(WikiArticle).order_by(
        WikiArticle.position.asc(),
        WikiArticle.id.asc(),
    )
    normalized_query = " ".join(str(query or "").split()).strip().lower()
    if normalized_query:
        pattern = f"%{_escape_like(normalized_query)}%"
        statement = statement.where(WikiArticle.search_text.like(pattern, escape="\\"))

    articles = db.scalars(statement).all()
    return [
        WikiArticleListItemOut(
            id=article.id,
            title=article.title,
            category=article.category or "",
            summary=article.summary or "",
            position=article.position,
            updated_at=article.updated_at,
        )
        for article in articles
    ]


@router.get("/api/auth/wiki/articles/{article_id}", response_model=WikiArticleDetailOut)
def get_wiki_article(
    article_id: int,
    db: Session = Depends(get_db),
) -> WikiArticleDetailOut:
    """Public: read a single wiki article with its images."""
    article = db.get(WikiArticle, article_id)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Статья не найдена")
    return _serialize_detail(db, article)


@router.post("/api/auth/wiki/articles", response_model=WikiArticleDetailOut, status_code=status.HTTP_201_CREATED)
def create_wiki_article(
    payload: WikiArticleSaveRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> WikiArticleDetailOut:
    user = _require_wiki_editor(authorization, db)
    next_position = int(db.scalar(select(func.coalesce(func.max(WikiArticle.position), -1))) or -1) + 1
    article = WikiArticle(position=next_position, author_id=getattr(user, "id", None))
    _apply_article_save(db, article, payload)
    db.commit()
    db.refresh(article)
    return _serialize_detail(db, article)


@router.put("/api/auth/wiki/articles/{article_id}", response_model=WikiArticleDetailOut)
def update_wiki_article(
    article_id: int,
    payload: WikiArticleSaveRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> WikiArticleDetailOut:
    _require_wiki_editor(authorization, db)
    article = db.get(WikiArticle, article_id)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Статья не найдена")
    _apply_article_save(db, article, payload)
    db.commit()
    db.refresh(article)
    return _serialize_detail(db, article)


@router.delete("/api/auth/wiki/articles/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_wiki_article(
    article_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    _require_wiki_editor(authorization, db)
    article = db.get(WikiArticle, article_id)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Статья не найдена")
    db.execute(delete(WikiArticleImage).where(WikiArticleImage.article_id == article_id))
    db.delete(article)
    db.commit()


@router.post("/api/auth/wiki/articles/reorder", response_model=list[WikiArticleListItemOut])
def reorder_wiki_articles(
    payload: WikiReorderRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[WikiArticleListItemOut]:
    _require_wiki_editor(authorization, db)
    position = 0
    seen: set[int] = set()
    for raw_id in payload.ordered_ids:
        try:
            article_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if article_id in seen:
            continue
        article = db.get(WikiArticle, article_id)
        if article is None:
            continue
        article.position = position
        seen.add(article_id)
        position += 1
    db.commit()
    return list_wiki_articles(query=None, db=db)
