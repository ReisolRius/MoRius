from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None
    avatar_url: str | None
    auth_provider: str
    coins: int
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(min_length=1)


class AvatarUpdateRequest(BaseModel):
    avatar_url: str | None = Field(default=None, max_length=2_000_000)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MessageResponse(BaseModel):
    message: str


class CoinPlanOut(BaseModel):
    id: str
    title: str
    description: str
    price_rub: int
    coins: int


class CoinPlanListResponse(BaseModel):
    plans: list[CoinPlanOut]


class CoinTopUpCreateRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=32)


class CoinTopUpCreateResponse(BaseModel):
    payment_id: str
    confirmation_url: str
    status: str


class CoinTopUpSyncResponse(BaseModel):
    payment_id: str
    status: str
    coins: int
    user: UserOut


class StoryGameCreateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)


class StoryGenerateRequest(BaseModel):
    prompt: str | None = Field(default=None, min_length=1, max_length=8_000)
    reroll_last_response: bool = False


class StoryMessageUpdateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=20_000)


class StoryMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    role: str
    content: str
    created_at: datetime
    updated_at: datetime


class StoryGameSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class StoryGameOut(BaseModel):
    game: StoryGameSummaryOut
    messages: list[StoryMessageOut]
