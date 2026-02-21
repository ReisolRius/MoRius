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
    context_limit_chars: int | None = Field(default=None, ge=500, le=5_000)


class StoryGameSettingsUpdateRequest(BaseModel):
    context_limit_chars: int = Field(ge=500, le=5_000)


class StoryInstructionCardInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryGenerateRequest(BaseModel):
    prompt: str | None = Field(default=None, min_length=1, max_length=8_000)
    reroll_last_response: bool = False
    instructions: list[StoryInstructionCardInput] = Field(default_factory=list, max_length=40)


class StoryInstructionCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryWorldCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=1_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    kind: str | None = Field(default=None, max_length=16)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)
    character_id: int | None = Field(default=None, ge=1)


class StoryWorldCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=1_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)


class StoryWorldCardAvatarUpdateRequest(BaseModel):
    avatar_url: str | None = Field(default=None, max_length=2_000_000)


class StoryWorldCardAiEditUpdateRequest(BaseModel):
    ai_edit_enabled: bool


class StoryCharacterCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=4_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)


class StoryCharacterUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=4_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)


class StoryCharacterAssignRequest(BaseModel):
    character_id: int = Field(ge=1)


class StoryPlotCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=16_000)


class StoryPlotCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=16_000)


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


class StoryInstructionCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    title: str
    content: str
    created_at: datetime
    updated_at: datetime


class StoryWorldCardOut(BaseModel):
    id: int
    game_id: int
    title: str
    content: str
    triggers: list[str]
    kind: str
    avatar_url: str | None
    character_id: int | None
    is_locked: bool
    ai_edit_enabled: bool
    source: str
    created_at: datetime
    updated_at: datetime


class StoryCharacterOut(BaseModel):
    id: int
    user_id: int
    name: str
    description: str
    triggers: list[str]
    avatar_url: str | None
    source: str
    created_at: datetime
    updated_at: datetime


class StoryPlotCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    title: str
    content: str
    source: str
    created_at: datetime
    updated_at: datetime


class StoryPlotCardSnapshotOut(BaseModel):
    id: int | None
    title: str
    content: str
    source: str


class StoryPlotCardChangeEventOut(BaseModel):
    id: int
    game_id: int
    assistant_message_id: int
    plot_card_id: int | None
    action: str
    title: str
    changed_text: str
    before_snapshot: StoryPlotCardSnapshotOut | None
    after_snapshot: StoryPlotCardSnapshotOut | None
    created_at: datetime


class StoryWorldCardSnapshotOut(BaseModel):
    id: int | None
    title: str
    content: str
    triggers: list[str]
    kind: str
    avatar_url: str | None
    character_id: int | None
    is_locked: bool
    ai_edit_enabled: bool
    source: str


class StoryWorldCardChangeEventOut(BaseModel):
    id: int
    game_id: int
    assistant_message_id: int
    world_card_id: int | None
    action: str
    title: str
    changed_text: str
    before_snapshot: StoryWorldCardSnapshotOut | None
    after_snapshot: StoryWorldCardSnapshotOut | None
    created_at: datetime


class StoryGameSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    context_limit_chars: int
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class StoryGameOut(BaseModel):
    game: StoryGameSummaryOut
    messages: list[StoryMessageOut]
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    plot_card_events: list[StoryPlotCardChangeEventOut]
    world_cards: list[StoryWorldCardOut]
    world_card_events: list[StoryWorldCardChangeEventOut]
