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


def _is_render_environment() -> bool:
    return _to_bool(os.getenv("RENDER"), default=False) or bool(os.getenv("RENDER_SERVICE_ID"))


def _default_database_url() -> str:
    explicit_database_url = os.getenv("DATABASE_URL")
    if explicit_database_url and explicit_database_url.strip():
        return explicit_database_url.strip()

    if _is_render_environment():
        render_disk_path = os.getenv("RENDER_DISK_PATH", "/var/data").strip() or "/var/data"
        sqlite_path = Path(render_disk_path) / "morius.db"
        return f"sqlite:///{sqlite_path.as_posix()}"

    return "sqlite:///./data/morius.db"


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
    character_avatar_max_bytes: int
    yookassa_shop_id: str
    yookassa_secret_key: str
    yookassa_api_url: str
    payments_return_url: str
    story_llm_provider: str
    gigachat_authorization_key: str
    gigachat_scope: str
    gigachat_oauth_url: str
    gigachat_chat_url: str
    gigachat_model: str
    gigachat_verify_ssl: bool
    openrouter_api_key: str
    openrouter_chat_url: str
    openrouter_model: str
    openrouter_world_card_model: str
    openrouter_translation_model: str
    openrouter_plot_card_model: str
    openrouter_site_url: str
    openrouter_app_name: str
    story_translation_enabled: bool
    story_user_language: str
    story_model_language: str


settings = Settings(
    app_name=os.getenv("APP_NAME", "MoRius API"),
    debug=_to_bool(os.getenv("DEBUG"), default=True),
    database_url=_default_database_url(),
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
    character_avatar_max_bytes=int(os.getenv("CHARACTER_AVATAR_MAX_BYTES", str(200 * 1024))),
    yookassa_shop_id=os.getenv("YOOKASSA_SHOP_ID", "").strip(),
    yookassa_secret_key=os.getenv("YOOKASSA_SECRET_KEY", "").strip(),
    yookassa_api_url=os.getenv("YOOKASSA_API_URL", "https://api.yookassa.ru/v3").strip(),
    payments_return_url=os.getenv("PAYMENTS_RETURN_URL", "http://localhost:5173/home").strip(),
    story_llm_provider=os.getenv("STORY_LLM_PROVIDER", "mock").strip().lower(),
    gigachat_authorization_key=os.getenv("GIGACHAT_AUTHORIZATION_KEY", "").strip(),
    gigachat_scope=os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS").strip(),
    gigachat_oauth_url=os.getenv("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth").strip(),
    gigachat_chat_url=os.getenv("GIGACHAT_CHAT_URL", "https://gigachat.devices.sberbank.ru/api/v1/chat/completions").strip(),
    gigachat_model=os.getenv("GIGACHAT_MODEL", "GigaChat-2-Lite").strip(),
    gigachat_verify_ssl=_to_bool(os.getenv("GIGACHAT_VERIFY_SSL"), default=True),
    openrouter_api_key=os.getenv("OPENROUTER_API_KEY", "").strip(),
    openrouter_chat_url=os.getenv("OPENROUTER_CHAT_URL", "https://openrouter.ai/api/v1/chat/completions").strip(),
    openrouter_model=os.getenv("OPENROUTER_MODEL", "openrouter/free").strip(),
    openrouter_world_card_model=os.getenv(
        "OPENROUTER_WORLD_CARD_MODEL",
        "qwen/qwen3-next-80b-a3b-instruct:free",
    ).strip(),
    openrouter_translation_model=os.getenv(
        "OPENROUTER_TRANSLATION_MODEL",
        "qwen/qwen3-next-80b-a3b-instruct:free",
    ).strip(),
    openrouter_plot_card_model=os.getenv(
        "OPENROUTER_PLOT_CARD_MODEL",
        "qwen/qwen3-next-80b-a3b-instruct:free",
    ).strip(),
    openrouter_site_url=os.getenv("OPENROUTER_SITE_URL", "").strip(),
    openrouter_app_name=os.getenv("OPENROUTER_APP_NAME", "MoRius").strip(),
    story_translation_enabled=_to_bool(os.getenv("STORY_TRANSLATION_ENABLED"), default=True),
    story_user_language=os.getenv("STORY_USER_LANGUAGE", "ru").strip().lower() or "ru",
    story_model_language=os.getenv("STORY_MODEL_LANGUAGE", "en").strip().lower() or "en",
)
