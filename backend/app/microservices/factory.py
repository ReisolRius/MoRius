from __future__ import annotations

from collections.abc import Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.routing import APIRoute

from app import main as monolith
from app.config import settings


def _normalize_prefix(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return "/"
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    if normalized != "/":
        normalized = normalized.rstrip("/")
    return normalized


def _matches_prefix(path: str, prefix: str) -> bool:
    if prefix == "/":
        return True
    return path == prefix or path.startswith(f"{prefix}/")


def _clone_route_to_app(target_app: FastAPI, route: APIRoute) -> None:
    methods = sorted(route.methods) if route.methods else None
    tags = list(route.tags) if route.tags else None
    dependencies = list(route.dependencies) if route.dependencies else None
    callbacks = list(route.callbacks) if route.callbacks else None
    responses = dict(route.responses) if route.responses else None

    target_app.add_api_route(
        path=route.path,
        endpoint=route.endpoint,
        methods=methods,
        name=route.name,
        response_model=route.response_model,
        status_code=route.status_code,
        tags=tags,
        dependencies=dependencies,
        summary=route.summary,
        description=route.description,
        response_description=route.response_description,
        responses=responses,
        deprecated=route.deprecated,
        operation_id=route.operation_id,
        response_model_include=route.response_model_include,
        response_model_exclude=route.response_model_exclude,
        response_model_by_alias=route.response_model_by_alias,
        response_model_exclude_unset=route.response_model_exclude_unset,
        response_model_exclude_defaults=route.response_model_exclude_defaults,
        response_model_exclude_none=route.response_model_exclude_none,
        include_in_schema=route.include_in_schema,
        response_class=route.response_class,
        callbacks=callbacks,
        openapi_extra=route.openapi_extra,
    )


def _clone_monolith_routes(
    target_app: FastAPI,
    *,
    include_prefixes: Iterable[str],
) -> None:
    normalized_prefixes = tuple(_normalize_prefix(prefix) for prefix in include_prefixes)
    included_route_keys: set[tuple[str, tuple[str, ...]]] = set()

    for source_route in monolith.app.routes:
        if not isinstance(source_route, APIRoute):
            continue
        if not any(_matches_prefix(source_route.path, prefix) for prefix in normalized_prefixes):
            continue

        methods = tuple(sorted(source_route.methods or []))
        route_key = (source_route.path, methods)
        if route_key in included_route_keys:
            continue

        _clone_route_to_app(target_app, source_route)
        included_route_keys.add(route_key)


def _register_service_lifecycle(service_app: FastAPI) -> None:
    @service_app.on_event("startup")
    def _on_startup() -> None:
        monolith.on_startup()

    @service_app.on_event("shutdown")
    def _on_shutdown() -> None:
        monolith.on_shutdown()


def create_service_app(
    *,
    title: str,
    include_prefixes: Iterable[str],
    include_health_route: bool = True,
) -> FastAPI:
    service_app = FastAPI(title=title, debug=settings.debug)
    service_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
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
    _register_service_lifecycle(service_app)
    _clone_monolith_routes(service_app, include_prefixes=include_prefixes)

    if include_health_route:
        _clone_monolith_routes(service_app, include_prefixes=("/api/health",))

    return service_app
