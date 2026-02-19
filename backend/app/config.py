from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _to_bool(value: str, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_origins(value: str) -> list[str]:
    if not value:
        return ["http://localhost:5173"]
    return [origin.strip() for origin in value.split(",") if origin.strip()]


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_FILE_PATH = BASE_DIR / ".env"
load_dotenv(ENV_FILE_PATH)


@dataclass(frozen=True)
class Settings:
    app_name: str
    debug: bool
    database_url: str
    jwt_secret_key: str
    jwt_algorithm: str
    access_token_ttl_minutes: int
    cors_origins: list[str]
    cors_origin_regex: str
    google_client_id: str
    email_verification_code_ttl_minutes: int
    email_verification_max_attempts: int
    email_verification_resend_cooldown_seconds: int
    resend_api_key: str
    resend_from_email: str
    resend_api_url: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from_email: str
    smtp_from_name: str
    smtp_use_tls: bool
    smtp_use_ssl: bool
    avatar_max_bytes: int
    yookassa_shop_id: str
    yookassa_secret_key: str
    yookassa_api_url: str
    payments_return_url: str


settings = Settings(
    app_name=os.getenv("APP_NAME", "MoRius API"),
    debug=_to_bool(os.getenv("DEBUG"), default=True),
    database_url=os.getenv("DATABASE_URL", "sqlite:///./data/morius.db"),
    jwt_secret_key=os.getenv("JWT_SECRET_KEY", "replace_me_in_production"),
    jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
    access_token_ttl_minutes=int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "10080")),
    cors_origins=_parse_origins(os.getenv("CORS_ORIGINS", "http://localhost:5173")),
    cors_origin_regex=os.getenv("CORS_ORIGIN_REGEX", r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$").strip(),
    google_client_id=os.getenv("GOOGLE_CLIENT_ID", "").strip(),
    email_verification_code_ttl_minutes=int(os.getenv("EMAIL_VERIFICATION_CODE_TTL_MINUTES", "10")),
    email_verification_max_attempts=int(os.getenv("EMAIL_VERIFICATION_MAX_ATTEMPTS", "5")),
    email_verification_resend_cooldown_seconds=int(
        os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", "60")
    ),
    resend_api_key=os.getenv("RESEND_API_KEY", "").strip(),
    resend_from_email=os.getenv("RESEND_FROM_EMAIL", "").strip(),
    resend_api_url=os.getenv("RESEND_API_URL", "https://api.resend.com/emails").strip(),
    smtp_host=os.getenv("SMTP_HOST", "").strip(),
    smtp_port=int(os.getenv("SMTP_PORT", "587")),
    smtp_user=os.getenv("SMTP_USER", "").strip(),
    smtp_password=os.getenv("SMTP_PASSWORD", ""),
    smtp_from_email=os.getenv("SMTP_FROM_EMAIL", "no-reply@morius.local").strip(),
    smtp_from_name=os.getenv("SMTP_FROM_NAME", "MoRius").strip(),
    smtp_use_tls=_to_bool(os.getenv("SMTP_USE_TLS"), default=True),
    smtp_use_ssl=_to_bool(os.getenv("SMTP_USE_SSL"), default=False),
    avatar_max_bytes=int(os.getenv("AVATAR_MAX_BYTES", str(2 * 1024 * 1024))),
    yookassa_shop_id=os.getenv("YOOKASSA_SHOP_ID", "").strip(),
    yookassa_secret_key=os.getenv("YOOKASSA_SECRET_KEY", "").strip(),
    yookassa_api_url=os.getenv("YOOKASSA_API_URL", "https://api.yookassa.ru/v3").strip(),
    payments_return_url=os.getenv("PAYMENTS_RETURN_URL", "http://localhost:5173/home").strip(),
)
