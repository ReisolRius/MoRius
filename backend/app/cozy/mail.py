from __future__ import annotations

from app.cozy.settings import settings
from app.services.auth_verification import send_email_message

# The mailer itself is MoRius's and stays MoRius's: it already knows about Resend, about SMTP and
# about which of the two is configured, and a second copy of that decision would be a second thing
# to fix the day the provider changes. What is ours is what the letter says.
#
# The sender is the same address, and that is the owner's call - it is the same company. So the
# letter has to say which game it is for in its first line, because an address that sends codes
# for two products and does not name them is an address whose codes look like phishing.

_SIGNATURE = "Если вы не запрашивали код — просто не отвечайте на это письмо."


def send_registration_code(recipient_email: str, code: str) -> None:
    send_email_message(
        recipient_email=recipient_email,
        subject="Cozy Village: код подтверждения",
        text_body=(
            "Код подтверждения для регистрации в игре Cozy Village:\n"
            f"{code}\n\n"
            f"Код действует {settings.email_code_ttl_minutes} минут.\n"
            f"{_SIGNATURE}"
        ),
    )


def send_password_reset_code(recipient_email: str, code: str) -> None:
    send_email_message(
        recipient_email=recipient_email,
        subject="Cozy Village: восстановление пароля",
        text_body=(
            "Код для смены пароля в игре Cozy Village:\n"
            f"{code}\n\n"
            f"Код действует {settings.email_code_ttl_minutes} минут.\n"
            f"{_SIGNATURE}"
        ),
    )
