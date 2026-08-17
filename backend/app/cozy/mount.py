from __future__ import annotations

import logging

from fastapi import FastAPI

logger = logging.getLogger(__name__)


def mount_cozy(app: FastAPI) -> bool:
    """Hangs the game's endpoints on an existing MoRius app.

    The game has its own container, and that is still the right way to run it. This exists because
    "the right way" and "what is actually serving /api/ on the box" are two different questions,
    and only one of them can be answered from a repository: a deployment may be running the
    monolith, or the gateway, or an edge whose config predates the game - and in every one of those
    cases a player taps Register and a MoRius process answers 404.

    Mounting costs nothing to be wrong about. The routers hold their own engine, their own tables
    and their own tokens, so a second process serving them is a second reader of one database, not
    a second copy of anything.

    Every failure in here is swallowed and logged. The game arriving badly must never be a reason
    MoRius does not come up - that is the whole contract of being a guest in someone else's
    process.
    """
    try:
        from app.cozy.routers import auth as cozy_auth
        from app.cozy.routers import payments as cozy_payments
        from app.cozy.routers import save as cozy_save
    except Exception:
        logger.exception("Cozy Village routers failed to import; the game will answer 404")
        return False

    for router in (cozy_auth.router, cozy_save.router, cozy_payments.router):
        try:
            app.include_router(router)
        except Exception:
            logger.exception("Failed to include a Cozy Village router")
            return False

    @app.on_event("startup")
    def _bootstrap_cozy() -> None:
        try:
            from app.cozy.database import bootstrap_database
            from app.cozy.settings import settings as cozy_settings

            if not cozy_settings.db_bootstrap_on_startup:
                return

            bootstrap_database()
            logger.info("Cozy Village database ready")
        except Exception:
            logger.exception("Cozy Village database bootstrap failed")

    @app.get("/api/cozy/health", include_in_schema=False)
    def _cozy_health() -> dict[str, object]:
        # Deliberately duplicated from the standalone app rather than shared: this one is the
        # answer to "is the game reachable on whatever is actually running", and it has to exist
        # even if every other part of the game is broken.
        from app.cozy.settings import settings as cozy_settings

        return {
            "status": "ok",
            "service": "cozy",
            "mounted": True,
            "payments": cozy_settings.payments_configured,
            "google": cozy_settings.google_configured,
        }

    logger.info("Cozy Village endpoints mounted on %s", app.title)
    return True
