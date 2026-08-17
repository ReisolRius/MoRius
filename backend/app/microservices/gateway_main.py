from __future__ import annotations

import logging

from app.config import settings
from app.microservices.factory import create_service_app

logger = logging.getLogger(__name__)

app = create_service_app(
    title=f"{settings.app_name} Gateway",
    include_prefixes=(
        "/api/auth",
        "/api/admin",
        "/api/referrals",
        "/api/downloads",
        "/api/story",
        "/api/payments",
        "/api/shop",
        "/api/media",
        "/api/health",
    ),
    include_health_route=False,
)

# Cozy Village, on the gateway as well as in its own container. The game must answer wherever
# /api/ is actually being served - see app/cozy/mount.py.
try:
    from app.cozy.mount import mount_cozy

    mount_cozy(app)
except Exception:
    logger.exception("Cozy Village endpoints were not mounted on the gateway")

