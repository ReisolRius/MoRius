from __future__ import annotations

import os
from dataclasses import dataclass

from app.config import settings as morius_settings

# The game's own audience. It is written into every token this package issues and checked on every
# token it accepts, which is what keeps the two products apart while they share one secret: without
# it a MoRius session token would decode perfectly here and be read as player #5 of Cozy Village
# because it says user #5 of MoRius.
TOKEN_AUDIENCE = "cozy-village"


def _to_bool(raw_value: str | None, *, default: bool) -> bool:
    normalized = str(raw_value or "").strip().lower()
    if not normalized:
        return default
    return normalized in {"1", "true", "yes", "y", "on"}


def _to_int(raw_value: str | None, fallback: int, *, minimum: int = 0) -> int:
    normalized = str(raw_value or "").strip()
    if not normalized.isdigit():
        return fallback
    return max(int(normalized), minimum)


def _default_database_url() -> str:
    """The game's database, on whatever server MoRius is already using.

    Derived from MoRius's own URL rather than written out again: the two live on the same Postgres
    container, and a hand-written copy of the host, the user and the password is three things that
    stop being true the day one of them is rotated. Only the database name differs - which is the
    whole point, and the reason accounts cannot collide even by accident.
    """
    explicit = os.getenv("COZY_DATABASE_URL", "").strip()
    if explicit:
        return explicit

    source = str(morius_settings.database_url or "").strip()
    database_name = os.getenv("COZY_DATABASE_NAME", "cozyvillage").strip() or "cozyvillage"

    if source.lower().startswith("sqlite"):
        # Local development. Beside the MoRius file, not inside it.
        return f"sqlite:///{os.path.join(os.getcwd(), 'data', database_name + '.db')}"

    head, _, _ = source.rpartition("/")
    if not head:
        return source
    return f"{head}/{database_name}"


@dataclass(frozen=True)
class CozySettings:
    database_url: str
    db_bootstrap_on_startup: bool

    access_token_ttl_days: int

    email_code_ttl_minutes: int
    email_code_max_attempts: int
    email_resend_cooldown_seconds: int

    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_login_ttl_seconds: int

    save_max_bytes: int

    yookassa_shop_id: str
    yookassa_secret_key: str
    yookassa_api_url: str
    yookassa_return_url: str
    yookassa_webhook_token: str

    @property
    def payments_configured(self) -> bool:
        return bool(self.yookassa_shop_id and self.yookassa_secret_key and self.yookassa_return_url)

    @property
    def google_client_ids(self) -> tuple[str, ...]:
        """Every client whose tokens are accepted.

        MoRius keeps several here - a site accumulates them, and a token minted by any of them
        belongs to the same people. Verification has to take the whole list.
        """
        return tuple(item.strip() for item in self.google_client_id.split(",") if item.strip())

    @property
    def google_auth_client_id(self) -> str:
        """The one client the game actually signs in with.

        Not the same question as the list above, and the difference is not cosmetic: a consent URL
        carries exactly one client id, so handing it a comma-separated list produces a link Google
        refuses. Verification is plural because a token can come from any of them; asking for one
        is singular because a request is made by one.

        The first entry, and that is also which secret has to be configured - a code exchange is
        signed by the client that asked for the code.
        """
        ids = self.google_client_ids
        return ids[0] if ids else ""

    @property
    def google_configured(self) -> bool:
        return bool(self.google_auth_client_id and self.google_client_secret and self.google_redirect_uri)


settings = CozySettings(
    database_url=_default_database_url(),
    db_bootstrap_on_startup=_to_bool(os.getenv("COZY_DB_BOOTSTRAP_ON_STARTUP"), default=True),
    access_token_ttl_days=_to_int(os.getenv("COZY_ACCESS_TOKEN_TTL_DAYS"), 180, minimum=1),
    email_code_ttl_minutes=_to_int(os.getenv("COZY_EMAIL_CODE_TTL_MINUTES"), 15, minimum=1),
    email_code_max_attempts=_to_int(os.getenv("COZY_EMAIL_CODE_MAX_ATTEMPTS"), 5, minimum=1),
    email_resend_cooldown_seconds=_to_int(os.getenv("COZY_EMAIL_RESEND_COOLDOWN_SECONDS"), 60),
    # The game has no website, so it borrows MoRius's Google client by default: the consent screen
    # is the same company either way, and one client id is one thing to keep registered.
    #
    # `or` rather than a getenv default, because compose sets these to an empty string rather than
    # leaving them unset - and an empty string is a value, so a default would never be reached.
    google_client_id=(os.getenv("COZY_GOOGLE_CLIENT_ID", "").strip() or morius_settings.google_client_id),
    google_client_secret=(
        os.getenv("COZY_GOOGLE_CLIENT_SECRET", "").strip() or os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    ),
    google_redirect_uri=(
        os.getenv("COZY_GOOGLE_REDIRECT_URI", "").strip()
        or "https://morius-ai.ru/api/cozy/auth/google/callback"
    ),
    google_login_ttl_seconds=_to_int(os.getenv("COZY_GOOGLE_LOGIN_TTL_SECONDS"), 600, minimum=60),
    # A whole village as JSON. Fifty kilobytes is roughly ten times the largest save the game
    # currently writes, and a ceiling is the difference between a bug and a full disk.
    save_max_bytes=_to_int(os.getenv("COZY_SAVE_MAX_BYTES"), 512 * 1024, minimum=4096),
    yookassa_shop_id=os.getenv("COZY_YOOKASSA_SHOP_ID", "").strip(),
    yookassa_secret_key=os.getenv("COZY_YOOKASSA_SECRET_KEY", "").strip(),
    yookassa_api_url=os.getenv("COZY_YOOKASSA_API_URL", "https://api.yookassa.ru/v3").strip(),
    yookassa_return_url=os.getenv("COZY_YOOKASSA_RETURN_URL", "").strip(),
    yookassa_webhook_token=os.getenv("COZY_YOOKASSA_WEBHOOK_TOKEN", "").strip(),
)
