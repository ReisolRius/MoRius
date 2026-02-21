from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
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

engine_kwargs: dict[str, object] = {
    "future": True,
    "pool_pre_ping": settings.db_pool_pre_ping,
}
connect_args: dict[str, object] = {}

if _is_sqlite_url(settings.database_url):
    connect_args = {
        "check_same_thread": False,
        "timeout": max(settings.sqlite_busy_timeout_ms, 1000) / 1000,
    }
else:
    engine_kwargs.update(
        {
            "pool_size": settings.db_pool_size,
            "max_overflow": settings.db_max_overflow,
            "pool_timeout": settings.db_pool_timeout_seconds,
            "pool_recycle": settings.db_pool_recycle_seconds,
        }
    )

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    **engine_kwargs,
)

if _is_sqlite_url(settings.database_url):

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute(f"PRAGMA busy_timeout={max(settings.sqlite_busy_timeout_ms, 1000)}")
        cursor.execute("PRAGMA foreign_keys=ON")
        if settings.sqlite_enable_wal:
            # WAL allows concurrent readers while a writer is active.
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
    class_=Session,
)


class Base(DeclarativeBase):
    pass


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
