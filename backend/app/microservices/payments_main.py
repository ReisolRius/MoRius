from __future__ import annotations

from app.config import settings
from app.microservices.factory import create_service_app

app = create_service_app(
    title=f"{settings.app_name} Payments Service",
    include_prefixes=("/api/payments",),
)

