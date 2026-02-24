from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

VALID_APP_MODES = {"monolith", "gateway", "auth", "story", "payments"}
OPENROUTER_GEMMA_FREE_MODEL = "google/gemma-3-12b-it:free"
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "https://mo-rius.vercel.app",
    "https://morius-ai.ru",
]


def _to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _to_int(value: str | None, default: int, *, minimum: int = 0) -> int:
    if value is None or not value.strip():
        return max(default, minimum)
    try:
        parsed = int(value.strip())
    except ValueError:
        return max(default, minimum)
    return max(parsed, minimum)


def _parse_origins(value: str) -> list[str]:
    if not value:
        return list(DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def _parse_hosts(value: str) -> list[str]:
    if not value:
        return ["*"]
    parsed = [host.strip() for host in value.split(",") if host.strip()]
    return parsed or ["*"]


def _is_render_environment() -> bool:
    return _to_bool(os.getenv("RENDER"), default=False) or bool(os.getenv("RENDER_SERVICE_ID"))


def _default_app_mode() -> str:
    raw_mode = (os.getenv("APP_MODE") or "gateway").strip().lower()
    if raw_mode in VALID_APP_MODES:
        return raw_mode
    return "gateway"


def _default_db_bootstrap_on_startup(app_mode: str) -> bool:
    # Gateway/monolith should own schema bootstrap; leaf services should skip it by default.
    return app_mode in {"gateway", "monolith"}


def _default_db_pool_size(app_mode: str) -> int:
    if app_mode == "story":
        return 16
    if app_mode in {"auth", "payments"}:
        return 8
    return 20


def _default_db_max_overflow(app_mode: str) -> int:
    if app_mode == "story":
        return 24
    if app_mode in {"auth", "payments"}:
        return 12
    return 40


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
DEFAULT_APP_MODE = _default_app_mode()


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_mode: str
    debug: bool
    db_bootstrap_on_startup: bool
    app_trust_proxy_headers: bool
    app_forwarded_allow_ips: str
    app_allowed_hosts: list[str]
    app_gzip_enabled: bool
    app_gzip_minimum_size: int
    database_url: str
    db_pool_size: int
    db_max_overflow: int
    db_pool_timeout_seconds: int
    db_pool_recycle_seconds: int
    db_pool_pre_ping: bool
    sqlite_busy_timeout_ms: int
    sqlite_enable_wal: bool
    http_pool_connections: int
    http_pool_maxsize: int
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
    yookassa_webhook_token: str
    yookassa_webhook_trusted_ips_only: bool
    yookassa_receipt_enabled: bool
    yookassa_receipt_tax_system_code: int
    yookassa_receipt_vat_code: int
    yookassa_receipt_payment_mode: str
    yookassa_receipt_payment_subject: str
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
    app_mode=DEFAULT_APP_MODE,
    debug=_to_bool(os.getenv("DEBUG"), default=True),
    db_bootstrap_on_startup=_to_bool(
        os.getenv("DB_BOOTSTRAP_ON_STARTUP"),
        default=_default_db_bootstrap_on_startup(DEFAULT_APP_MODE),
    ),
    app_trust_proxy_headers=_to_bool(os.getenv("APP_TRUST_PROXY_HEADERS"), default=True),
    app_forwarded_allow_ips=os.getenv("APP_FORWARDED_ALLOW_IPS", "*").strip() or "*",
    app_allowed_hosts=_parse_hosts(os.getenv("APP_ALLOWED_HOSTS", "*")),
    app_gzip_enabled=_to_bool(os.getenv("APP_GZIP_ENABLED"), default=True),
    app_gzip_minimum_size=max(int(os.getenv("APP_GZIP_MINIMUM_SIZE", "1024")), 100),
    database_url=_default_database_url(),
    db_pool_size=_to_int(
        os.getenv("DB_POOL_SIZE"),
        _default_db_pool_size(DEFAULT_APP_MODE),
        minimum=1,
    ),
    db_max_overflow=_to_int(
        os.getenv("DB_MAX_OVERFLOW"),
        _default_db_max_overflow(DEFAULT_APP_MODE),
        minimum=0,
    ),
    db_pool_timeout_seconds=max(int(os.getenv("DB_POOL_TIMEOUT_SECONDS", "30")), 1),
    db_pool_recycle_seconds=max(int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")), 30),
    db_pool_pre_ping=_to_bool(os.getenv("DB_POOL_PRE_PING"), default=True),
    sqlite_busy_timeout_ms=max(int(os.getenv("SQLITE_BUSY_TIMEOUT_MS", "10000")), 1000),
    sqlite_enable_wal=_to_bool(os.getenv("SQLITE_ENABLE_WAL"), default=True),
    http_pool_connections=max(int(os.getenv("HTTP_POOL_CONNECTIONS", "32")), 1),
    http_pool_maxsize=max(int(os.getenv("HTTP_POOL_MAXSIZE", "64")), 1),
    jwt_secret_key=os.getenv("JWT_SECRET_KEY", "replace_me_in_production"),
    jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
    access_token_ttl_minutes=int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "10080")),
    cors_origins=_parse_origins(os.getenv("CORS_ORIGINS", "")),
    cors_origin_regex=os.getenv(
        "CORS_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://mo-rius(?:-[a-z0-9-]+)?\.vercel\.app$|^https://(?:www\.)?morius-ai\.ru$",
    ).strip(),
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
    character_avatar_max_bytes=int(os.getenv("CHARACTER_AVATAR_MAX_BYTES", str(500 * 1024))),
    yookassa_shop_id=os.getenv("YOOKASSA_SHOP_ID", "").strip(),
    yookassa_secret_key=os.getenv("YOOKASSA_SECRET_KEY", "").strip(),
    yookassa_api_url=os.getenv("YOOKASSA_API_URL", "https://api.yookassa.ru/v3").strip(),
    payments_return_url=os.getenv("PAYMENTS_RETURN_URL", "").strip(),
    yookassa_webhook_token=os.getenv("YOOKASSA_WEBHOOK_TOKEN", "").strip(),
    yookassa_webhook_trusted_ips_only=_to_bool(os.getenv("YOOKASSA_WEBHOOK_TRUSTED_IPS_ONLY"), default=False),
    yookassa_receipt_enabled=_to_bool(os.getenv("YOOKASSA_RECEIPT_ENABLED"), default=False),
    yookassa_receipt_tax_system_code=min(_to_int(os.getenv("YOOKASSA_RECEIPT_TAX_SYSTEM_CODE"), 0, minimum=0), 6),
    yookassa_receipt_vat_code=min(_to_int(os.getenv("YOOKASSA_RECEIPT_VAT_CODE"), 1, minimum=1), 6),
    yookassa_receipt_payment_mode=os.getenv("YOOKASSA_RECEIPT_PAYMENT_MODE", "full_payment").strip(),
    yookassa_receipt_payment_subject=os.getenv("YOOKASSA_RECEIPT_PAYMENT_SUBJECT", "service").strip(),
    story_llm_provider=os.getenv("STORY_LLM_PROVIDER", "openrouter").strip().lower(),
    gigachat_authorization_key=os.getenv("GIGACHAT_AUTHORIZATION_KEY", "").strip(),
    gigachat_scope=os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS").strip(),
    gigachat_oauth_url=os.getenv("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth").strip(),
    gigachat_chat_url=os.getenv("GIGACHAT_CHAT_URL", "https://gigachat.devices.sberbank.ru/api/v1/chat/completions").strip(),
    gigachat_model=os.getenv("GIGACHAT_MODEL", "GigaChat-2-Lite").strip(),
    gigachat_verify_ssl=_to_bool(os.getenv("GIGACHAT_VERIFY_SSL"), default=True),
    openrouter_api_key=os.getenv("OPENROUTER_API_KEY", "").strip(),
    openrouter_chat_url=os.getenv("OPENROUTER_CHAT_URL", "https://openrouter.ai/api/v1/chat/completions").strip(),
    openrouter_model=os.getenv("OPENROUTER_MODEL", "z-ai/glm-5").strip(),
    openrouter_world_card_model=os.getenv(
        "OPENROUTER_WORLD_CARD_MODEL",
        OPENROUTER_GEMMA_FREE_MODEL,
    ).strip(),
    openrouter_translation_model=os.getenv(
        "OPENROUTER_TRANSLATION_MODEL",
        OPENROUTER_GEMMA_FREE_MODEL,
    ).strip(),
    openrouter_plot_card_model=os.getenv(
        "OPENROUTER_PLOT_CARD_MODEL",
        OPENROUTER_GEMMA_FREE_MODEL,
    ).strip(),
    openrouter_site_url=os.getenv("OPENROUTER_SITE_URL", "").strip(),
    openrouter_app_name=os.getenv("OPENROUTER_APP_NAME", "MoRius").strip(),
    story_translation_enabled=_to_bool(os.getenv("STORY_TRANSLATION_ENABLED"), default=False),
    story_user_language=os.getenv("STORY_USER_LANGUAGE", "ru").strip().lower() or "ru",
    story_model_language=os.getenv("STORY_MODEL_LANGUAGE", "ru").strip().lower() or "ru",
)
