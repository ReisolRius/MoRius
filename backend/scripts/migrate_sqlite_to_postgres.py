from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

DEFAULT_SOURCE_SQLITE_URL = f"sqlite:///{(ROOT_DIR / 'data' / 'morius.db').resolve().as_posix()}"


def _normalize_local_sqlite_url(database_url: str) -> str:
    normalized = str(database_url or "").strip()
    sqlite_prefix = "sqlite:///"
    if not normalized.lower().startswith(sqlite_prefix):
        return normalized

    sqlite_path = normalized[len(sqlite_prefix) :]
    if not sqlite_path or sqlite_path == ":memory:":
        return normalized

    path_candidate = Path(sqlite_path)
    if path_candidate.is_absolute():
        return normalized

    resolved_path = (ROOT_DIR / path_candidate).resolve()
    return f"{sqlite_prefix}{resolved_path.as_posix()}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate the MoRius database from SQLite to PostgreSQL.",
    )
    parser.add_argument(
        "--source-sqlite-url",
        default=DEFAULT_SOURCE_SQLITE_URL,
        help="Source SQLite SQLAlchemy URL. Default: %(default)s",
    )
    parser.add_argument(
        "--target-database-url",
        default=os.getenv("DATABASE_URL", "").strip(),
        help="Target PostgreSQL SQLAlchemy URL. Defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="How many rows to insert per batch. Default: %(default)s",
    )
    parser.add_argument(
        "--skip-bootstrap",
        action="store_true",
        help="Do not run target schema bootstrap before copying rows.",
    )
    parser.add_argument(
        "--allow-non-empty-target",
        action="store_true",
        help="Allow inserting into a target database that already contains data.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect source/target and print what would be migrated without writing rows.",
    )
    return parser.parse_args()


def _row_to_payload(model: type[object], row: object) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for column in model.__table__.columns:
        payload[column.name] = getattr(row, column.name)
    return payload


def _resolve_bootstrap_defaults():
    from app.main import (
        STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
        STORY_DEFAULT_RESPONSE_MAX_TOKENS,
        STORY_GAME_VISIBILITY_PRIVATE,
        STORY_WORLD_CARD_KIND_MAIN_HERO,
        STORY_WORLD_CARD_KIND_NPC,
        STORY_WORLD_CARD_KIND_WORLD,
        STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
        STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
        STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
    )
    from app.services.db_bootstrap import StoryBootstrapDefaults

    return StoryBootstrapDefaults(
        context_limit_tokens=STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
        response_max_tokens=STORY_DEFAULT_RESPONSE_MAX_TOKENS,
        private_visibility=STORY_GAME_VISIBILITY_PRIVATE,
        world_kind=STORY_WORLD_CARD_KIND_WORLD,
        npc_kind=STORY_WORLD_CARD_KIND_NPC,
        main_hero_kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
        memory_turns_default=STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
        memory_turns_npc=STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
        memory_turns_always=STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
    )


def _reset_postgres_sequence(*, session, table, select_fn, func_fn, integer_type, text_fn) -> None:
    primary_key_columns = list(table.primary_key.columns)
    if len(primary_key_columns) != 1:
        return

    primary_key_column = primary_key_columns[0]
    if not isinstance(primary_key_column.type, integer_type):
        return

    sequence_name = session.execute(
        text_fn(
            "SELECT pg_get_serial_sequence(:table_name, :column_name)"
        ),
        {
            "table_name": table.name,
            "column_name": primary_key_column.name,
        },
    ).scalar_one_or_none()
    if not sequence_name:
        return

    max_value = session.execute(select_fn(func_fn.max(primary_key_column))).scalar_one()
    session.execute(
        text_fn("SELECT setval(CAST(:sequence_name AS regclass), :value, :is_called)"),
        {
            "sequence_name": sequence_name,
            "value": int(max_value or 1),
            "is_called": max_value is not None,
        },
    )


def _target_contains_data(
    *,
    session,
    tables,
    existing_table_names: set[str],
    select_fn,
    func_fn,
) -> tuple[str, int] | None:
    for table in tables:
        if table.name not in existing_table_names:
            continue
        row_count = int(session.execute(select_fn(func_fn.count()).select_from(table)).scalar_one() or 0)
        if row_count > 0:
            return table.name, row_count
    return None


def main() -> int:
    args = _parse_args()
    source_sqlite_url = _normalize_local_sqlite_url(args.source_sqlite_url)
    target_database_url = str(args.target_database_url or "").strip()
    if not target_database_url:
        print("Target PostgreSQL URL is required. Pass --target-database-url or set DATABASE_URL.", file=sys.stderr)
        return 1

    os.environ["DATABASE_URL"] = target_database_url

    from sqlalchemy import Integer, create_engine, func, inspect, insert, select, text
    from sqlalchemy.orm import sessionmaker

    from app.config import is_postgresql_database_url, is_sqlite_database_url, normalize_database_url
    from app.database import Base, engine as target_engine
    from app.services.db_bootstrap import bootstrap_database

    normalized_source_url = normalize_database_url(source_sqlite_url)
    normalized_target_url = normalize_database_url(target_database_url)

    if not is_sqlite_database_url(normalized_source_url):
        print(f"Source URL must point to SQLite, got: {normalized_source_url}", file=sys.stderr)
        return 1
    if not is_postgresql_database_url(normalized_target_url):
        print(f"Target URL must point to PostgreSQL, got: {normalized_target_url}", file=sys.stderr)
        return 1
    if normalized_source_url == normalized_target_url:
        print("Source and target database URLs must be different.", file=sys.stderr)
        return 1

    source_engine = create_engine(normalized_source_url, future=True)
    SourceSession = sessionmaker(
        bind=source_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        future=True,
    )
    TargetSession = sessionmaker(
        bind=target_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        future=True,
    )

    print(f"Source SQLite URL: {normalized_source_url}")
    print(f"Target PostgreSQL URL: {normalized_target_url}")

    if not args.skip_bootstrap and not args.dry_run:
        print("Bootstrapping target PostgreSQL schema...")
        bootstrap_database(
            database_url=normalized_target_url,
            defaults=_resolve_bootstrap_defaults(),
        )

    model_by_table_name = {
        mapper.local_table.name: mapper.class_
        for mapper in Base.registry.mappers
    }
    ordered_tables = list(Base.metadata.sorted_tables)
    source_inspector = inspect(source_engine)
    source_table_names = set(source_inspector.get_table_names())
    target_inspector = inspect(target_engine)
    target_table_names = set(target_inspector.get_table_names())
    batch_size = max(int(args.batch_size or 0), 1)

    try:
        with SourceSession() as source_session, TargetSession() as target_session:
            if not args.allow_non_empty_target:
                existing_target_data = _target_contains_data(
                    session=target_session,
                    tables=ordered_tables,
                    existing_table_names=target_table_names,
                    select_fn=select,
                    func_fn=func,
                )
                if existing_target_data is not None:
                    table_name, row_count = existing_target_data
                    print(
                        f"Target database already contains data in table '{table_name}' ({row_count} rows). "
                        "Re-run with --allow-non-empty-target if that is intentional.",
                        file=sys.stderr,
                    )
                    return 1

            total_rows_copied = 0
            for table in ordered_tables:
                if table.name not in source_table_names:
                    print(f"[skip] {table.name}: source table not found")
                    continue

                model = model_by_table_name.get(table.name)
                if model is None:
                    continue

                source_count = int(source_session.execute(select(func.count()).select_from(model)).scalar_one() or 0)
                if source_count <= 0:
                    print(f"[skip] {table.name}: no rows")
                    continue

                print(f"[copy] {table.name}: {source_count} rows")
                if args.dry_run:
                    total_rows_copied += source_count
                    continue

                try:
                    inserted_rows = 0
                    batch_payloads: list[dict[str, Any]] = []
                    order_by_columns = list(model.__table__.primary_key.columns)
                    source_rows = source_session.execute(select(model).order_by(*order_by_columns)).scalars()
                    for source_row in source_rows:
                        batch_payloads.append(_row_to_payload(model, source_row))
                        if len(batch_payloads) < batch_size:
                            continue
                        target_session.execute(insert(table), batch_payloads)
                        inserted_rows += len(batch_payloads)
                        batch_payloads.clear()

                    if batch_payloads:
                        target_session.execute(insert(table), batch_payloads)
                        inserted_rows += len(batch_payloads)

                    _reset_postgres_sequence(
                        session=target_session,
                        table=table,
                        select_fn=select,
                        func_fn=func,
                        integer_type=Integer,
                        text_fn=text,
                    )
                    target_session.commit()
                    total_rows_copied += inserted_rows
                    print(f"[done] {table.name}: copied {inserted_rows} rows")
                except Exception as exc:
                    target_session.rollback()
                    print(f"[error] {table.name}: {exc}", file=sys.stderr)
                    return 1

        print(f"Migration finished. Total copied rows: {total_rows_copied}")
        return 0
    finally:
        source_engine.dispose()
        target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
