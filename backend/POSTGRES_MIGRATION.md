# PostgreSQL Migration

This backend now treats PostgreSQL as the primary production database.

## 1. Configure PostgreSQL

Set `DATABASE_URL` to a PostgreSQL DSN that uses the `psycopg` driver:

```bash
DATABASE_URL=postgresql+psycopg://morius:change_me@localhost:5432/morius
```

Legacy `postgres://...` and bare `postgresql://...` URLs are normalized automatically to `postgresql+psycopg://...`.

## 2. Bootstrap The Target Schema

The app bootstrap can create and repair the schema on startup when `DB_BOOTSTRAP_ON_STARTUP=true`.

For a new deployment, start the backend once against the PostgreSQL database:

```bash
python run.py
```

## 3. Migrate Existing SQLite Data

If you already have production data in SQLite, run:

```bash
python scripts/migrate_sqlite_to_postgres.py \
  --source-sqlite-url sqlite:///./data/morius.db \
  --target-database-url postgresql+psycopg://morius:change_me@localhost:5432/morius
```

Helpful flags:

- `--dry-run` checks what would be copied without writing rows.
- `--skip-bootstrap` skips schema bootstrap if the target is already prepared.
- `--allow-non-empty-target` disables the default safety check for non-empty target databases.
- `--batch-size 1000` adjusts insert batch size.

## 4. Production Notes

- PostgreSQL advisory locks are now used for story game operations, so concurrent workers stay coordinated across processes.
- SQLite-specific settings such as `SQLITE_BUSY_TIMEOUT_MS` and `SQLITE_ENABLE_WAL` are ignored when PostgreSQL is active.
- With PostgreSQL, `WEB_CONCURRENCY=2` is a reasonable default starting point for the gateway/monolith service.
