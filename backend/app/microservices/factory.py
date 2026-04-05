from __future__ import annotations

import importlib
import logging
from collections.abc import Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.config import settings

logger = logging.getLogger(__name__)

_PREFIX_TO_ROUTER_MODULES: dict[str, tuple[str, ...]] = {
    "/api/health": ("app.routers.health",),
    "/api/auth": (
        "app.routers.auth",
        "app.routers.profiles",
        "app.routers.admin",
        "app.routers.dashboard_news",
        "app.routers.admin_moderation",
    ),
    "/api/payments": ("app.routers.payments",),
    "/api/media": ("app.routers.media",),
    "/api/story": (
        "app.routers.story_cards",
        "app.routers.story_characters",
        "app.routers.story_generate",
        "app.routers.story_games",
        "app.routers.story_instruction_templates",
        "app.routers.story_map",
        "app.routers.story_memory",
        "app.routers.story_messages",
        "app.routers.story_read",
        "app.routers.story_turn_audio",
        "app.routers.story_turn_image",
        "app.routers.story_undo",
        "app.routers.story_world_cards",
    ),
}

_BOOTSTRAP_DEFAULTS = {
    "context_limit_tokens": 1_500,
    "response_max_tokens": 400,
    "private_visibility": "private",
    "world_kind": "world",
    "npc_kind": "npc",
    "main_hero_kind": "main_hero",
    "memory_turns_default": 5,
    "memory_turns_npc": 3,
    "memory_turns_always": -1,
}


def _normalize_prefix(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return "/"
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    if normalized != "/":
        normalized = normalized.rstrip("/")
    return normalized


def _resolve_router_module_paths(include_prefixes: Iterable[str]) -> list[str]:
    module_paths: list[str] = []
    seen_paths: set[str] = set()
    for prefix in include_prefixes:
        normalized_prefix = _normalize_prefix(prefix)
        for module_path in _PREFIX_TO_ROUTER_MODULES.get(normalized_prefix, ()):
            if module_path in seen_paths:
                continue
            seen_paths.add(module_path)
            module_paths.append(module_path)
    return module_paths


def _include_router_module(service_app: FastAPI, module_path: str) -> bool:
    try:
        module = importlib.import_module(module_path)
    except Exception:
        logger.exception("Failed to import router module %s for service app startup", module_path)
        return False

    router = getattr(module, "router", None)
    if router is None:
        logger.warning("Router module %s does not export `router` and will be skipped", module_path)
        return False
    service_app.include_router(router)
    return True


def _include_story_fallback_router(service_app: FastAPI, router_attr_name: str) -> None:
    try:
        module = importlib.import_module("app.routers.story_critical_fallback")
    except Exception:
        logger.exception("Failed to import story critical fallback router module")
        return

    router = getattr(module, router_attr_name, None)
    if router is None:
        logger.warning("Story critical fallback module does not export %s", router_attr_name)
        return
    service_app.include_router(router)


def _include_service_routers(
    service_app: FastAPI,
    *,
    include_prefixes: Iterable[str],
    include_health_route: bool,
) -> None:
    target_prefixes = list(include_prefixes)
    if include_health_route:
        target_prefixes.append("/api/health")

    failed_module_paths: set[str] = set()
    for module_path in _resolve_router_module_paths(target_prefixes):
        if not _include_router_module(service_app, module_path):
            failed_module_paths.add(module_path)

    if "app.routers.story_games" in failed_module_paths:
        logger.warning("Story games router import failed; enabling critical fallback list router")
        _include_story_fallback_router(service_app, "games_router")
    if "app.routers.story_read" in failed_module_paths:
        logger.warning("Story read router import failed; enabling critical fallback read router")
        _include_story_fallback_router(service_app, "read_router")


def _register_service_lifecycle(service_app: FastAPI) -> None:
    @service_app.on_event("startup")
    def _on_startup() -> None:
        if not settings.db_bootstrap_on_startup:
            logger.info(
                "Skipping database bootstrap on startup for app_mode=%s (DB_BOOTSTRAP_ON_STARTUP=%s)",
                settings.app_mode,
                settings.db_bootstrap_on_startup,
            )
            return

        try:
            from app.services.db_bootstrap import StoryBootstrapDefaults, bootstrap_database

            bootstrap_database(
                database_url=settings.database_url,
                defaults=StoryBootstrapDefaults(**_BOOTSTRAP_DEFAULTS),
            )
        except Exception:
            logger.exception("Database bootstrap failed during startup; continuing without blocking API process")

    @service_app.on_event("shutdown")
    def _on_shutdown() -> None:
        try:
            from app.services.auth_verification import close_http_session as close_auth_verification_http_session

            close_auth_verification_http_session()
        except Exception:
            logger.exception("Failed to close auth verification HTTP session on shutdown")

        try:
            from app.services.payments import close_http_session as close_payments_http_session

            close_payments_http_session()
        except Exception:
            logger.exception("Failed to close payments HTTP session on shutdown")


def create_service_app(
    *,
    title: str,
    include_prefixes: Iterable[str],
    include_health_route: bool = True,
) -> FastAPI:
    service_app = FastAPI(title=title, debug=settings.debug)
    if settings.app_allowed_hosts and settings.app_allowed_hosts != ["*"]:
        service_app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.app_allowed_hosts,
        )
    if settings.app_gzip_enabled:
        service_app.add_middleware(
            GZipMiddleware,
            minimum_size=settings.app_gzip_minimum_size,
        )
    service_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    _register_service_lifecycle(service_app)
    _include_service_routers(
        service_app,
        include_prefixes=include_prefixes,
        include_health_route=include_health_route,
    )
    return service_app
