from __future__ import annotations

import os
from typing import Final

import uvicorn

APP_TARGETS = {
    "monolith": "app.main:app",
    "gateway": "app.microservices.gateway_main:app",
    "auth": "app.microservices.auth_main:app",
    "story": "app.microservices.story_main:app",
    "payments": "app.microservices.payments_main:app",
}

DEFAULT_PORTS = {
    "monolith": 8000,
    "gateway": 8000,
    "auth": 8001,
    "story": 8002,
    "payments": 8003,
}

DEFAULT_WORKERS = {
    "monolith": 2,
    "gateway": 2,
    "auth": 1,
    "story": 2,
    "payments": 1,
}


DEFAULT_BACKLOG: Final[int] = 2048
DEFAULT_KEEPALIVE_SECONDS: Final[int] = 5
DEFAULT_GRACEFUL_SHUTDOWN_SECONDS: Final[int] = 30


def _resolve_app_mode() -> str:
    raw_mode = os.getenv("APP_MODE", "gateway").strip().lower()
    if raw_mode in APP_TARGETS:
        return raw_mode
    return "gateway"


def _resolve_port(mode: str) -> int:
    raw_port = os.getenv("PORT", "").strip()
    if raw_port.isdigit():
        return int(raw_port)
    return DEFAULT_PORTS.get(mode, 8000)


def _resolve_positive_int(raw_value: str, fallback: int) -> int:
    if raw_value.isdigit():
        parsed = int(raw_value)
        if parsed > 0:
            return parsed
    return fallback


def _resolve_optional_positive_int(raw_value: str) -> int | None:
    if raw_value.isdigit():
        parsed = int(raw_value)
        if parsed > 0:
            return parsed
    return None


def _resolve_bool(raw_value: str, *, default: bool) -> bool:
    normalized = raw_value.strip().lower()
    if not normalized:
        return default
    return normalized in {"1", "true", "yes", "y", "on"}


def _is_sqlite_database_url(database_url: str) -> bool:
    return database_url.strip().lower().startswith("sqlite")


if __name__ == "__main__":
    mode = _resolve_app_mode()
    os.environ["APP_MODE"] = mode
    from app.config import settings as app_settings

    target = APP_TARGETS[mode]
    host = os.getenv("HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = _resolve_port(mode)
    reload_enabled = os.getenv("UVICORN_RELOAD", "0").strip().lower() in {"1", "true", "yes", "on"}
    default_workers = DEFAULT_WORKERS.get(mode, 1)
    raw_workers_override = os.getenv("WEB_CONCURRENCY", "").strip()
    if not raw_workers_override and app_settings.db_bootstrap_on_startup and mode in {"gateway", "monolith"}:
        # Prevent concurrent startup migrations by default; override with WEB_CONCURRENCY if needed.
        default_workers = 1
    if _is_sqlite_database_url(app_settings.database_url):
        # SQLite suffers from frequent write locks under multiple worker processes.
        # Keep a single worker by default unless WEB_CONCURRENCY is explicitly set.
        default_workers = 1
    raw_workers = raw_workers_override or str(default_workers)
    workers = int(raw_workers) if raw_workers.isdigit() else default_workers
    if workers < 1:
        workers = 1
    if reload_enabled:
        workers = 1

    backlog = _resolve_positive_int(os.getenv("UVICORN_BACKLOG", "").strip(), DEFAULT_BACKLOG)
    timeout_keep_alive = _resolve_positive_int(
        os.getenv("UVICORN_TIMEOUT_KEEP_ALIVE", "").strip(),
        DEFAULT_KEEPALIVE_SECONDS,
    )
    timeout_graceful_shutdown = _resolve_positive_int(
        os.getenv("UVICORN_TIMEOUT_GRACEFUL_SHUTDOWN", "").strip(),
        DEFAULT_GRACEFUL_SHUTDOWN_SECONDS,
    )
    limit_concurrency = _resolve_optional_positive_int(os.getenv("UVICORN_LIMIT_CONCURRENCY", "").strip())
    access_log = _resolve_bool(os.getenv("UVICORN_ACCESS_LOG", "").strip(), default=True)
    log_level = os.getenv("UVICORN_LOG_LEVEL", "info").strip().lower() or "info"

    print(f"[run.py] APP_MODE={mode} TARGET={target} HOST={host} PORT={port}")
    uvicorn.run(
        target,
        host=host,
        port=port,
        reload=reload_enabled,
        workers=workers,
        backlog=backlog,
        timeout_keep_alive=timeout_keep_alive,
        timeout_graceful_shutdown=timeout_graceful_shutdown,
        limit_concurrency=limit_concurrency,
        access_log=access_log,
        log_level=log_level,
        proxy_headers=app_settings.app_trust_proxy_headers,
        forwarded_allow_ips=app_settings.app_forwarded_allow_ips,
    )
