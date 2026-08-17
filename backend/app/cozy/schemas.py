from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class MessageOut(BaseModel):
    message: str


class PlayerOut(BaseModel):
    id: int
    email: str
    display_name: str
    provider: str
    has_password: bool


class AuthOut(BaseModel):
    access_token: str
    player: PlayerOut
    is_new_player: bool = False


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=64)


class CodeIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)


class ResetIn(BaseModel):
    email: EmailStr


class ResetVerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleStartOut(BaseModel):
    state: str
    auth_url: str
    expires_in: int


class GooglePollOut(BaseModel):
    """Three answers, and the app has to be able to tell them apart.

    "pending" is the normal case for most of a minute while somebody types a password into a
    browser, so it cannot be an error; "failed" has to carry a reason, because the failure
    happened on a page the app never saw.
    """

    status: str
    auth: AuthOut | None = None
    error: str = ""


class SaveOut(BaseModel):
    exists: bool
    payload: str = ""
    save_version: int = 0
    play_seconds: int = 0
    saved_at_unix: int = 0
    revision: int = 0


class SaveIn(BaseModel):
    payload: str
    save_version: int = 0
    play_seconds: int = 0
    saved_at_unix: int = 0

    # What the client believes the server is holding. Zero means "I have never synced", which is
    # the honest state of a fresh install and is not the same as "I am at revision zero".
    base_revision: int = 0

    # Set when the player has been told what they are overwriting and said yes anyway.
    force: bool = False


class SavePushOut(BaseModel):
    accepted: bool
    revision: int
    conflict: bool = False
    server: SaveOut | None = None


class PurchaseOut(BaseModel):
    id: int
    product_id: str
    gems: int
    amount_roubles: int
    status: str
    confirmation_url: str = ""


class PurchaseCreateIn(BaseModel):
    product_id: str = Field(max_length=32)
    gems: int = Field(default=0, ge=0)
    amount_roubles: int = Field(ge=1)


class PurchaseListOut(BaseModel):
    purchases: list[PurchaseOut]


class PaymentsStatusOut(BaseModel):
    configured: bool
    provider: str
    message: str
