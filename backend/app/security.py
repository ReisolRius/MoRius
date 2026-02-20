from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from app.config import settings


# NOTE:
# We intentionally use PBKDF2 here. passlib+bcrypt combinations can break
# with newer bcrypt releases and cause 500s on registration/login.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _is_bcrypt_hash(value: str) -> bool:
    return value.startswith(("$2a$", "$2b$", "$2y$"))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except (UnknownHashError, ValueError):
        if _is_bcrypt_hash(password_hash):
            try:
                return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
            except ValueError:
                return False
        return False


def create_access_token(
    subject: str,
    *,
    claims: dict[str, Any] | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    issued_at = datetime.now(timezone.utc)
    expire_at = issued_at + (expires_delta or timedelta(minutes=settings.access_token_ttl_minutes))
    payload: dict[str, Any] = {"sub": subject, "iat": issued_at, "exp": expire_at}
    if claims:
        payload.update(claims)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def safe_decode_access_token(token: str) -> dict | None:
    try:
        return decode_access_token(token)
    except JWTError:
        return None
