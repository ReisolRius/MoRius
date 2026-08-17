from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.cozy.settings import settings

logger = logging.getLogger(__name__)


class CozyBase(DeclarativeBase):
    """Its own metadata, deliberately.

    Sharing MoRius's Base would put the game's tables into MoRius's `create_all` and MoRius's into
    the game's - which is how "two separate databases" quietly becomes "both databases hold both
    schemas, and one of them is empty".
    """


def _is_sqlite(url: str) -> bool:
    return str(url or "").strip().lower().startswith("sqlite")


if _is_sqlite(settings.database_url):
    raw_path = settings.database_url.replace("sqlite:///", "")
    if raw_path and raw_path not in {":memory:", "./:memory:"}:
        Path(raw_path).resolve().parent.mkdir(parents=True, exist_ok=True)

engine_kwargs: dict[str, object] = {"future": True, "pool_pre_ping": True}
connect_args: dict[str, object] = {}

if _is_sqlite(settings.database_url):
    connect_args = {"check_same_thread": False, "timeout": 10}
else:
    # A phone game autosaves; it does not hold connections open. Small pool, generous recycle.
    engine_kwargs.update({"pool_size": 5, "max_overflow": 5, "pool_timeout": 20, "pool_recycle": 1800})

engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
    class_=Session,
)


def ensure_database_exists() -> None:
    """Creates the game's database on the shared Postgres server if nobody has yet.

    The alternative was an init script in the Postgres image, and that only runs against an empty
    data directory - which this server has not had for a long time. So the game makes its own bed:
    connect to the maintenance database, look for the name, create it if it is not there. Once.
    """
    if _is_sqlite(settings.database_url):
        return

    url = make_url(settings.database_url)
    database_name = url.database
    if not database_name:
        return

    admin_url = url.set(database="postgres")
    admin_engine = create_engine(admin_url, future=True, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": database_name},
            ).scalar()
            if exists:
                return

            # Identifiers cannot be bound as parameters, and this one comes from our own env rather
            # than from a request - but it is still quoted rather than interpolated raw.
            try:
                connection.execute(text(f'CREATE DATABASE "{database_name}"'))
                logger.info("Created Cozy Village database %s", database_name)
            except Exception:
                # Two processes can reach this line at once now that the game answers from more
                # than one app, and the loser of that race gets "database already exists" - which
                # is the state it wanted. Anything else is worth re-raising, so it is checked
                # rather than swallowed.
                exists_now = connection.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": database_name},
                ).scalar()
                if not exists_now:
                    raise
                logger.info("Cozy Village database %s was created by another process", database_name)
    finally:
        admin_engine.dispose()


def bootstrap_database() -> None:
    from app.cozy import models  # noqa: F401  (import registers the tables on CozyBase)

    ensure_database_exists()
    CozyBase.metadata.create_all(bind=engine)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    finally:
        db.close()
