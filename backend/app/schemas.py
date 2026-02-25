from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None
    profile_description: str
    avatar_url: str | None
    avatar_scale: float
    auth_provider: str
    role: str
    level: int
    coins: int
    is_banned: bool
    ban_expires_at: datetime | None
    created_at: datetime


class ProfilePrivacyOut(BaseModel):
    show_subscriptions: bool
    show_public_worlds: bool
    show_private_worlds: bool


class ProfilePrivacyUpdateRequest(BaseModel):
    show_subscriptions: bool | None = None
    show_public_worlds: bool | None = None
    show_private_worlds: bool | None = None


class ProfileSubscriptionUserOut(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None
    avatar_scale: float


class ProfileUserOut(BaseModel):
    id: int
    display_name: str
    profile_description: str
    avatar_url: str | None
    avatar_scale: float
    created_at: datetime


class ProfileViewOut(BaseModel):
    user: ProfileUserOut
    is_self: bool
    is_following: bool
    followers_count: int
    subscriptions_count: int
    privacy: ProfilePrivacyOut
    can_view_subscriptions: bool
    can_view_public_worlds: bool
    can_view_private_worlds: bool
    subscriptions: list[ProfileSubscriptionUserOut]
    published_worlds: list["StoryCommunityWorldSummaryOut"]
    unpublished_worlds: list["StoryGameSummaryOut"]


class ProfileFollowStateOut(BaseModel):
    is_following: bool
    followers_count: int
    subscriptions_count: int


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
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    profile_description: str | None = Field(default=None, max_length=2_000)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MessageResponse(BaseModel):
    message: str


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str | None
    role: str
    coins: int
    is_banned: bool
    ban_expires_at: datetime | None
    created_at: datetime


class AdminUserListResponse(BaseModel):
    users: list[AdminUserOut]


class AdminUserTokensUpdateRequest(BaseModel):
    operation: Literal["add", "subtract"]
    amount: int = Field(ge=1, le=1_000_000_000)


class AdminUserBanRequest(BaseModel):
    duration_hours: int | None = Field(default=None, ge=1, le=24 * 365 * 5)


class AdminWorldReportOut(BaseModel):
    world_id: int
    world_title: str
    world_cover_image_url: str | None
    world_author_name: str
    open_reports_count: int
    latest_reason: str
    latest_description: str
    latest_created_at: datetime


class AdminWorldReportListResponse(BaseModel):
    reports: list[AdminWorldReportOut]


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
    description: str | None = Field(default=None, max_length=4_000)
    opening_scene: str | None = Field(default=None, max_length=12_000)
    visibility: str | None = Field(default=None, max_length=16)
    age_rating: str | None = Field(default=None, max_length=8)
    genres: list[str] | None = Field(default=None, max_length=3)
    cover_image_url: str | None = Field(default=None, max_length=2_000_000)
    cover_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    cover_position_x: float | None = Field(default=None, ge=0.0, le=100.0)
    cover_position_y: float | None = Field(default=None, ge=0.0, le=100.0)
    context_limit_chars: int | None = Field(default=None, ge=500, le=4_000)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    response_max_tokens_enabled: bool | None = None
    story_llm_model: str | None = Field(default=None, max_length=120)
    memory_optimization_enabled: bool | None = None
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    ambient_enabled: bool | None = None


class StoryGameCloneRequest(BaseModel):
    copy_instructions: bool = True
    copy_plot: bool = True
    copy_world: bool = True
    copy_main_hero: bool = True
    copy_history: bool = True


class StoryGameSettingsUpdateRequest(BaseModel):
    context_limit_chars: int | None = Field(default=None, ge=500, le=4_000)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    response_max_tokens_enabled: bool | None = None
    story_llm_model: str | None = Field(default=None, max_length=120)
    memory_optimization_enabled: bool | None = None
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    ambient_enabled: bool | None = None


class StoryGameMetaUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4_000)
    opening_scene: str | None = Field(default=None, max_length=12_000)
    visibility: str | None = Field(default=None, max_length=16)
    age_rating: str | None = Field(default=None, max_length=8)
    genres: list[str] | None = Field(default=None, max_length=3)
    cover_image_url: str | None = Field(default=None, max_length=2_000_000)
    cover_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    cover_position_x: float | None = Field(default=None, ge=0.0, le=100.0)
    cover_position_y: float | None = Field(default=None, ge=0.0, le=100.0)


class StoryInstructionCardInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryGenerateRequest(BaseModel):
    prompt: str | None = Field(default=None, min_length=1, max_length=8_000)
    reroll_last_response: bool = False
    instructions: list[StoryInstructionCardInput] = Field(default_factory=list, max_length=40)
    story_llm_model: str | None = Field(default=None, max_length=120)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    memory_optimization_enabled: bool | None = None
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    ambient_enabled: bool | None = None


class StoryInstructionCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionTemplateCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionTemplateUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryWorldCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=6_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    kind: str | None = Field(default=None, max_length=16)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    character_id: int | None = Field(default=None, ge=1)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=6_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardAvatarUpdateRequest(BaseModel):
    avatar_url: str | None = Field(default=None, max_length=2_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


class StoryWorldCardAiEditUpdateRequest(BaseModel):
    ai_edit_enabled: bool


class StoryCharacterCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=6_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


class StoryCharacterUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=6_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


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


class StoryCommunityWorldRatingRequest(BaseModel):
    rating: int = Field(ge=1, le=5)


class StoryCommunityWorldReportCreateRequest(BaseModel):
    reason: Literal["cp", "politics", "racism", "nationalism", "other"]
    description: str = Field(min_length=1, max_length=2_000)


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


class StoryInstructionTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
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
    avatar_scale: float
    character_id: int | None
    memory_turns: int | None
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
    avatar_scale: float
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
    avatar_scale: float
    character_id: int | None
    memory_turns: int | None
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
    id: int
    title: str
    description: str
    opening_scene: str
    visibility: str
    age_rating: str
    genres: list[str]
    cover_image_url: str | None
    cover_scale: float
    cover_position_x: float
    cover_position_y: float
    source_world_id: int | None
    community_views: int
    community_launches: int
    community_rating_avg: float
    community_rating_count: int
    context_limit_chars: int
    response_max_tokens: int
    response_max_tokens_enabled: bool
    story_llm_model: str
    memory_optimization_enabled: bool
    story_top_k: int
    story_top_r: float
    ambient_enabled: bool
    ambient_profile: dict[str, Any] | None
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class StoryCommunityWorldSummaryOut(BaseModel):
    id: int
    title: str
    description: str
    author_id: int
    author_name: str
    author_avatar_url: str | None
    age_rating: str
    genres: list[str]
    cover_image_url: str | None
    cover_scale: float
    cover_position_x: float
    cover_position_y: float
    community_views: int
    community_launches: int
    community_rating_avg: float
    community_rating_count: int
    user_rating: int | None
    is_reported_by_user: bool
    is_favorited_by_user: bool
    created_at: datetime
    updated_at: datetime


class StoryCommunityWorldOut(BaseModel):
    world: StoryCommunityWorldSummaryOut
    context_limit_chars: int
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    world_cards: list[StoryWorldCardOut]


class StoryGameOut(BaseModel):
    game: StoryGameSummaryOut
    messages: list[StoryMessageOut]
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    plot_card_events: list[StoryPlotCardChangeEventOut]
    world_cards: list[StoryWorldCardOut]
    world_card_events: list[StoryWorldCardChangeEventOut]
