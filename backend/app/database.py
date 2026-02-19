from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def _is_sqlite_url(database_url: str) -> bool:
    return database_url.startswith("sqlite")


if _is_sqlite_url(settings.database_url):
    # Ensure sqlite target folder exists when using local file path.
    raw_path = settings.database_url.replace("sqlite:///", "")
    if raw_path and raw_path not in {":memory:", "./:memory:"}:
        sqlite_path = Path(raw_path).resolve()
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite_url(settings.database_url) else {},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True, class_=Session)


class Base(DeclarativeBase):
    pass


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
