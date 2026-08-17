from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.cozy.routers import auth as auth_router
from app.cozy.routers import payments as payments_router
from app.cozy.routers import save as save_router
from app.cozy.settings import settings

logger = logging.getLogger(__name__)


def create_cozy_app() -> FastAPI:
    app = FastAPI(title="Cozy Village API")

    # No allowed-hosts middleware and no credentialed CORS: the only client is a phone, which
    # sends a bearer token and no cookie. Copying MoRius's browser-shaped middleware here would be
    # copying answers to questions this service is never asked.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup() -> None:
        if not settings.db_bootstrap_on_startup:
            return

        try:
            from app.cozy.database import bootstrap_database

            bootstrap_database()
            logger.info("Cozy Village database ready")
        except Exception:
            # Same rule the rest of this backend follows: a database that is not ready yet must not
            # stop the process from coming up and saying so on /api/health.
            logger.exception("Cozy Village database bootstrap failed")

    @app.get("/api/health")
    @app.get("/api/cozy/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": "cozy",
            "payments": settings.payments_configured,
            "google": settings.google_configured,
        }

    app.include_router(auth_router.router)
    app.include_router(save_router.router)
    app.include_router(payments_router.router)
    return app
