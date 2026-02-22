from __future__ import annotations

from app.config import settings
from app.microservices.factory import create_service_app

app = create_service_app(
    title=f"{settings.app_name} Gateway",
    include_prefixes=(
        "/api/auth",
        "/api/story",
        "/api/payments",
        "/api/health",
    ),
    include_health_route=False,
)

