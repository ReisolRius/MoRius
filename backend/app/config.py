from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

VALID_APP_MODES = {"monolith", "gateway", "auth", "story", "payments"}
ROUTERAI_API_BASE_URL = "https://routerai.ru/api/v1"
ROUTERAI_CHAT_COMPLETIONS_URL = f"{ROUTERAI_API_BASE_URL}/chat/completions"
ROUTERAI_IMAGES_URL = f"{ROUTERAI_API_BASE_URL}/images"
POLZA_CHAT_COMPLETIONS_URL = ROUTERAI_CHAT_COMPLETIONS_URL
POLZA_MEDIA_URL = ROUTERAI_IMAGES_URL
POLZA_API_BASE_URL = ROUTERAI_API_BASE_URL
PROXYAPI_ROUTERAI_BASE_URL = ROUTERAI_API_BASE_URL
AITUNNEL_API_BASE_URL = ""
POLZA_SERVICE_TEXT_MODEL = "google/gemma-4-31b-it"
POLZA_SERVICE_FALLBACK_MODEL = "nex-agi/nex-n2-pro"
POLZA_GEMINI_25_FLASH_LITE_MODEL = "google/gemini-2.5-flash-lite"
POLZA_STORY_SERVICE_TEXT_MODEL = "z-ai/glm-4.7-flash"
POLZA_DEFAULT_STORY_MODEL = "z-ai/glm-5"
POLZA_DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-pro"
# Subscription-only narrator models (accessible only with an active subscription/admin test,
# never purchasable with sols). Provider IDs are .env-overridable so routing can be tuned
# without code changes. Keep these in sync with the tier definitions in
# app/services/payments.py SUBSCRIPTION_PLANS and the frontend catalog.
SUBSCRIPTION_DEFAULT_MODEL_DEEPSEEK_V4_FLASH = "deepseek/deepseek-v4-flash"
SUBSCRIPTION_DEFAULT_MODEL_GEMINI_25_FLASH_LITE = "google/gemini-2.5-flash-lite"
SUBSCRIPTION_DEFAULT_MODEL_GLM_45_AIR = "z-ai/glm-4.5-air"
SUBSCRIPTION_DEFAULT_MODEL_GEMINI_3_FLASH_PREVIEW = "google/gemini-3-flash-preview"
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "https://mo-rius.vercel.app",
    "https://morius-ai.ru",
]
BASE_DIR = Path(__file__).resolve().parents[1]
ENV_FILE_PATH = BASE_DIR / ".env"
load_dotenv(ENV_FILE_PATH)
ENV_FILE_VALUES = dotenv_values(ENV_FILE_PATH) if ENV_FILE_PATH.exists() else {}

SQLITE_URL_PREFIX = "sqlite:///"
POSTGRES_LEGACY_URL_PREFIX = "postgres://"
POSTGRESQL_URL_PREFIX = "postgresql://"
POSTGRESQL_PSYCOPG_URL_PREFIX = "postgresql+psycopg://"


def _to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is not None and value.strip():
        return value
    file_value = ENV_FILE_VALUES.get(name)
    if file_value is not None and str(file_value).strip():
        return str(file_value)
    return default


def _env_alias(primary_name: str, legacy_name: str, default: str = "") -> str:
    return _env(primary_name, _env(legacy_name, default))


def _normalize_env_regex(value: str) -> str:
    return value.strip().replace("\\\\", "\\")


def _to_int(value: str | None, default: int, *, minimum: int = 0) -> int:
    if value is None or not value.strip():
        return max(default, minimum)
    try:
        parsed = int(value.strip())
    except ValueError:
        return max(default, minimum)
    return max(parsed, minimum)


def _to_float(value: str | None, default: float, *, minimum: float = 0.0) -> float:
    if value is None or not value.strip():
        return max(default, minimum)
    try:
        parsed = float(value.strip())
    except ValueError:
        return max(default, minimum)
    return max(parsed, minimum)


def _normalize_story_llm_provider(value: str | None) -> str:
    normalized = str(value or "routerai").strip().lower()
    if not normalized:
        return "polza"
    if normalized == "open" + "router":
        return "polza"
    if normalized in {"routerai", "router-ai", "router ai"}:
        return "polza"
    return normalized


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


def is_sqlite_database_url(database_url: str | None) -> bool:
    return str(database_url or "").strip().lower().startswith("sqlite")


def is_postgresql_database_url(database_url: str | None) -> bool:
    normalized = str(database_url or "").strip().lower()
    return normalized.startswith(POSTGRES_LEGACY_URL_PREFIX) or normalized.startswith(POSTGRESQL_URL_PREFIX)


def _normalize_sqlite_database_url(database_url: str) -> str:
    normalized = str(database_url or "").strip()
    if not normalized.lower().startswith(SQLITE_URL_PREFIX):
        return normalized

    sqlite_path = normalized[len(SQLITE_URL_PREFIX) :]
    if not sqlite_path or sqlite_path == ":memory:":
        return normalized

    path_candidate = Path(sqlite_path)
    if path_candidate.is_absolute():
        return normalized

    resolved_path = (BASE_DIR / path_candidate).resolve()
    return f"{SQLITE_URL_PREFIX}{resolved_path.as_posix()}"


def _normalize_postgresql_database_url(database_url: str) -> str:
    normalized = str(database_url or "").strip()
    normalized_lower = normalized.lower()
    if normalized_lower.startswith(POSTGRES_LEGACY_URL_PREFIX):
        return f"{POSTGRESQL_PSYCOPG_URL_PREFIX}{normalized[len(POSTGRES_LEGACY_URL_PREFIX):]}"
    if normalized_lower.startswith(POSTGRESQL_URL_PREFIX) and not normalized_lower.startswith(
        POSTGRESQL_PSYCOPG_URL_PREFIX
    ):
        return f"{POSTGRESQL_PSYCOPG_URL_PREFIX}{normalized[len(POSTGRESQL_URL_PREFIX):]}"
    return normalized


def normalize_database_url(database_url: str) -> str:
    normalized = str(database_url or "").strip()
    if is_sqlite_database_url(normalized):
        return _normalize_sqlite_database_url(normalized)
    if is_postgresql_database_url(normalized):
        return _normalize_postgresql_database_url(normalized)
    return normalized


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
        return normalize_database_url(explicit_database_url.strip())

    if _is_render_environment():
        render_disk_path = os.getenv("RENDER_DISK_PATH", "/var/data").strip() or "/var/data"
        sqlite_path = Path(render_disk_path) / "morius.db"
        return normalize_database_url(f"{SQLITE_URL_PREFIX}{sqlite_path.as_posix()}")

    return normalize_database_url(f"{SQLITE_URL_PREFIX}{(BASE_DIR / 'data' / 'morius.db').resolve().as_posix()}")


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
    yandex_client_id: str
    yandex_redirect_uri: str
    yandex_frontend_url: str
    vk_id_client_id: str
    vk_id_redirect_uri: str
    vk_id_frontend_url: str
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
    subscriptions_enabled: bool
    payments_recurring_charge_token: str
    subscription_model_deepseek_v4_flash: str
    subscription_model_gemini_25_flash_lite: str
    subscription_model_glm_45_air: str
    subscription_model_gemini_3_flash_preview: str
    story_llm_provider: str
    gigachat_authorization_key: str
    gigachat_scope: str
    gigachat_oauth_url: str
    gigachat_chat_url: str
    gigachat_model: str
    gigachat_verify_ssl: bool
    polza_api_key: str
    polza_chat_url: str
    polza_model: str
    polza_world_card_model: str
    polza_translation_model: str
    polza_plot_card_model: str
    polza_service_fallback_model: str
    polza_image_url: str
    polza_image_model: str
    polza_image_size: str
    polza_site_url: str
    polza_app_name: str
    proxyapi_key: str
    proxyapi_base_routerai: str
    aitunnel_api_key: str
    aitunnel_base_url: str
    aitunnel_image_generation_url: str
    aitunnel_image_edit_url: str
    story_translation_enabled: bool
    story_user_language: str
    story_model_language: str
    enable_canonical_state_pipeline: bool
    canonical_state_safe_fallback: bool
    ai_assistant_enabled: bool
    ai_assistant_model: str
    ai_assistant_base_url: str
    ai_assistant_min_sols: int
    ai_assistant_markup: float
    ai_assistant_rub_per_sol_cost_basis: float
    ai_assistant_max_completion_tokens: int
    ai_assistant_request_timeout_ms: int


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
    cors_origin_regex=_normalize_env_regex(
        os.getenv(
            "CORS_ORIGIN_REGEX",
            r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://mo-rius(?:-[a-z0-9-]+)?\.vercel\.app$|^https://(?:www\.)?morius-ai\.ru$",
        )
    ),
    google_client_id=os.getenv("GOOGLE_CLIENT_ID", "").strip(),
    yandex_client_id=os.getenv("YANDEX_CLIENT_ID", "").strip(),
    yandex_redirect_uri=os.getenv(
        "YANDEX_REDIRECT_URI",
        "https://morius-ai.ru/api/auth/callback/yandex",
    ).strip(),
    yandex_frontend_url=os.getenv("YANDEX_FRONTEND_URL", "https://morius-ai.ru").strip().rstrip("/"),
    vk_id_client_id=os.getenv("VK_ID_CLIENT_ID", "").strip(),
    vk_id_redirect_uri=os.getenv(
        "VK_ID_REDIRECT_URI",
        "https://morius-ai.ru/api/auth/callback/vk",
    ).strip(),
    vk_id_frontend_url=os.getenv("VK_ID_FRONTEND_URL", "https://morius-ai.ru").strip().rstrip("/"),
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
    character_avatar_max_bytes=int(os.getenv("CHARACTER_AVATAR_MAX_BYTES", str(2 * 1024 * 1024))),
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
    subscriptions_enabled=_to_bool(os.getenv("SUBSCRIPTIONS_ENABLED"), default=True),
    # Shared secret a scheduler (cron/worker) sends to POST /api/payments/subscriptions/run-recurring
    # to trigger monthly renewals. Empty → the endpoint is disabled (no anonymous renewals).
    payments_recurring_charge_token=os.getenv("PAYMENTS_RECURRING_CHARGE_TOKEN", "").strip(),
    subscription_model_deepseek_v4_flash=_env(
        "SUBSCRIPTION_MODEL_DEEPSEEK_V4_FLASH",
        SUBSCRIPTION_DEFAULT_MODEL_DEEPSEEK_V4_FLASH,
    ).strip(),
    subscription_model_gemini_25_flash_lite=_env(
        "SUBSCRIPTION_MODEL_GEMINI_25_FLASH_LITE",
        SUBSCRIPTION_DEFAULT_MODEL_GEMINI_25_FLASH_LITE,
    ).strip(),
    subscription_model_glm_45_air=_env(
        "SUBSCRIPTION_MODEL_GLM_45_AIR",
        SUBSCRIPTION_DEFAULT_MODEL_GLM_45_AIR,
    ).strip(),
    subscription_model_gemini_3_flash_preview=_env(
        "SUBSCRIPTION_MODEL_GEMINI_3_FLASH_PREVIEW",
        SUBSCRIPTION_DEFAULT_MODEL_GEMINI_3_FLASH_PREVIEW,
    ).strip(),
    story_llm_provider=_normalize_story_llm_provider(_env("STORY_LLM_PROVIDER", "routerai")),
    gigachat_authorization_key=os.getenv("GIGACHAT_AUTHORIZATION_KEY", "").strip(),
    gigachat_scope=os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS").strip(),
    gigachat_oauth_url=os.getenv("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth").strip(),
    gigachat_chat_url=os.getenv("GIGACHAT_CHAT_URL", "https://gigachat.devices.sberbank.ru/api/v1/chat/completions").strip(),
    gigachat_model=os.getenv("GIGACHAT_MODEL", "GigaChat-2-Lite").strip(),
    gigachat_verify_ssl=_to_bool(os.getenv("GIGACHAT_VERIFY_SSL"), default=True),
    polza_api_key=_env_alias("ROUTERAI_API_KEY", "POLZA_API_KEY", "").strip(),
    polza_chat_url=_env_alias("ROUTERAI_CHAT_URL", "POLZA_CHAT_URL", POLZA_CHAT_COMPLETIONS_URL).strip(),
    polza_model=_env_alias("ROUTERAI_MODEL", "POLZA_MODEL", POLZA_DEFAULT_STORY_MODEL).strip(),
    polza_world_card_model=_env_alias(
        "ROUTERAI_WORLD_CARD_MODEL",
        "POLZA_WORLD_CARD_MODEL",
        POLZA_STORY_SERVICE_TEXT_MODEL,
    ).strip(),
    polza_translation_model=_env_alias(
        "ROUTERAI_TRANSLATION_MODEL",
        "POLZA_TRANSLATION_MODEL",
        POLZA_STORY_SERVICE_TEXT_MODEL,
    ).strip(),
    polza_plot_card_model=_env_alias(
        "ROUTERAI_PLOT_CARD_MODEL",
        "POLZA_PLOT_CARD_MODEL",
        POLZA_STORY_SERVICE_TEXT_MODEL,
    ).strip(),
    polza_service_fallback_model=_env_alias(
        "ROUTERAI_SERVICE_FALLBACK_MODEL",
        "POLZA_SERVICE_FALLBACK_MODEL",
        POLZA_SERVICE_FALLBACK_MODEL,
    ).strip(),
    polza_image_url=_env_alias("ROUTERAI_IMAGE_URL", "POLZA_IMAGE_URL", POLZA_MEDIA_URL).strip(),
    polza_image_model=_env_alias("ROUTERAI_IMAGE_MODEL", "POLZA_IMAGE_MODEL", POLZA_DEFAULT_IMAGE_MODEL).strip(),
    polza_image_size=_env_alias("ROUTERAI_IMAGE_SIZE", "POLZA_IMAGE_SIZE", "1024x1024").strip(),
    polza_site_url=_env_alias("ROUTERAI_SITE_URL", "POLZA_SITE_URL", "").strip(),
    polza_app_name=_env_alias("ROUTERAI_APP_NAME", "POLZA_APP_NAME", "MoRius").strip(),
    proxyapi_key=_env("PROXYAPI_KEY", "").strip(),
    proxyapi_base_routerai=_env("PROXYAPI_BASE_ROUTERAI", PROXYAPI_ROUTERAI_BASE_URL).strip().rstrip("/"),
    aitunnel_api_key=_env("AITUNNEL_API_KEY", "").strip(),
    aitunnel_base_url=_env("AITUNNEL_BASE_URL", AITUNNEL_API_BASE_URL).strip().rstrip("/"),
    aitunnel_image_generation_url=_env(
        "AITUNNEL_IMAGE_GENERATION_URL",
        "",
    ).strip(),
    aitunnel_image_edit_url=_env(
        "AITUNNEL_IMAGE_EDIT_URL",
        "",
    ).strip(),
    story_translation_enabled=_to_bool(os.getenv("STORY_TRANSLATION_ENABLED"), default=False),
    story_user_language=os.getenv("STORY_USER_LANGUAGE", "ru").strip().lower() or "ru",
    story_model_language=os.getenv("STORY_MODEL_LANGUAGE", "en").strip().lower() or "en",
    enable_canonical_state_pipeline=_to_bool(os.getenv("ENABLE_CANONICAL_STATE_PIPELINE"), default=True),
    canonical_state_safe_fallback=_to_bool(os.getenv("CANONICAL_STATE_SAFE_FALLBACK"), default=False),
    ai_assistant_enabled=_to_bool(_env("AI_ASSISTANT_ENABLED", "false"), default=False),
    ai_assistant_model=_env("AI_ASSISTANT_MODEL", "deepseek/deepseek-v4-flash").strip(),
    ai_assistant_base_url=_env("AI_ASSISTANT_BASE_URL", ROUTERAI_API_BASE_URL).strip().rstrip("/"),
    ai_assistant_min_sols=_to_int(_env("AI_ASSISTANT_MIN_SOLS", "1"), 1, minimum=1),
    ai_assistant_markup=_to_float(_env("AI_ASSISTANT_MARKUP", "5"), 5.0, minimum=0.1),
    ai_assistant_rub_per_sol_cost_basis=_to_float(
        _env("AI_ASSISTANT_RUB_PER_SOL_COST_BASIS", "1"),
        1.0,
        minimum=0.01,
    ),
    ai_assistant_max_completion_tokens=_to_int(_env("AI_ASSISTANT_MAX_COMPLETION_TOKENS", "1800"), 1800, minimum=128),
    ai_assistant_request_timeout_ms=_to_int(_env("AI_ASSISTANT_REQUEST_TIMEOUT_MS", "60000"), 60000, minimum=1000),
)
