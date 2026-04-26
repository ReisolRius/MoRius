from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.services.media import normalize_media_scale, resolve_media_display_url


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
    notifications_enabled: bool = True
    notify_comment_reply: bool = True
    notify_world_comment: bool = True
    notify_publication_review: bool = True
    notify_new_follower: bool = True
    notify_moderation_report: bool = True
    notify_moderation_queue: bool = True
    email_notifications_enabled: bool = False
    show_subscriptions: bool = False
    show_public_worlds: bool = False
    show_private_worlds: bool = False
    show_public_characters: bool = False
    show_public_instruction_templates: bool = False
    active_theme_id: str | None = None
    is_banned: bool
    ban_expires_at: datetime | None
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _resolve_avatar_payload(cls, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, dict):
            payload = dict(value)
            user_id = payload.get("id")
            version = payload.get("updated_at") or payload.get("created_at")
        else:
            payload = {field_name: getattr(value, field_name, None) for field_name in cls.model_fields}
            user_id = getattr(value, "id", None)
            version = getattr(value, "updated_at", None) or getattr(value, "created_at", None)

        if user_id is not None:
            try:
                payload["avatar_url"] = resolve_media_display_url(
                    payload.get("avatar_url"),
                    kind="user-avatar",
                    entity_id=int(user_id),
                    version=version,
                )
            except (TypeError, ValueError):
                payload["avatar_url"] = payload.get("avatar_url")
        payload["avatar_scale"] = normalize_media_scale(
            payload.get("avatar_scale"),
            default=1.0,
            min_value=1.0,
            max_value=3.0,
        )
        return payload


class UserNotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str
    action_url: str | None = None
    is_read: bool
    actor_user_id: int | None = None
    actor_display_name: str | None = None
    actor_avatar_url: str | None = None
    created_at: datetime


class UserNotificationUnreadCountOut(BaseModel):
    unread_count: int = Field(default=0, ge=0)
    total_count: int = Field(default=0, ge=0)


class UserNotificationListResponseOut(BaseModel):
    items: list[UserNotificationOut]
    unread_count: int = Field(default=0, ge=0)
    total_count: int = Field(default=0, ge=0)
    limit: int = Field(default=0, ge=0)
    offset: int = Field(default=0, ge=0)
    has_more: bool = False


class OnboardingGuideStateOut(BaseModel):
    status: Literal["pending", "completed", "skipped"]
    current_step_id: str | None
    tutorial_game_id: int | None


class OnboardingGuideStateUpdateRequest(BaseModel):
    status: Literal["pending", "completed", "skipped"] | None = None
    current_step_id: str | None = Field(default=None, max_length=120)
    tutorial_game_id: int | None = Field(default=None, ge=1)


class ProfilePrivacyOut(BaseModel):
    show_subscriptions: bool
    show_public_worlds: bool
    show_private_worlds: bool
    show_public_characters: bool = False
    show_public_instruction_templates: bool = False


class ProfilePrivacyUpdateRequest(BaseModel):
    show_subscriptions: bool | None = None
    show_public_worlds: bool | None = None
    show_private_worlds: bool | None = None
    show_public_characters: bool | None = None
    show_public_instruction_templates: bool | None = None


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
    world_card_templates_count: int = 0
    privacy: ProfilePrivacyOut
    can_view_subscriptions: bool
    can_view_public_worlds: bool
    can_view_public_characters: bool = False
    can_view_public_instruction_templates: bool = False
    can_view_private_worlds: bool
    subscriptions: list[ProfileSubscriptionUserOut]
    published_worlds: list["StoryCommunityWorldSummaryOut"] = Field(default_factory=list)
    published_characters: list["StoryCommunityCharacterSummaryOut"] = Field(default_factory=list)
    published_instruction_templates: list["StoryCommunityInstructionTemplateSummaryOut"] = Field(default_factory=list)
    unpublished_worlds: list["StoryGameSummaryOut"] = Field(default_factory=list)


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
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    profile_description: str | None = Field(default=None, max_length=2_000)
    notifications_enabled: bool | None = None
    notify_comment_reply: bool | None = None
    notify_world_comment: bool | None = None
    notify_publication_review: bool | None = None
    notify_new_follower: bool | None = None
    notify_moderation_report: bool | None = None
    notify_moderation_queue: bool | None = None
    email_notifications_enabled: bool | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MessageResponse(BaseModel):
    message: str


class DailyRewardDayOut(BaseModel):
    day: int
    amount: int
    is_claimed: bool
    is_current: bool
    is_locked: bool


class DailyRewardStatusOut(BaseModel):
    server_time: datetime
    current_day: int | None
    claimed_days: int
    can_claim: bool
    is_completed: bool
    next_claim_at: datetime | None
    last_claimed_at: datetime | None
    cycle_started_at: datetime | None
    reward_amount: int | None
    claimed_reward_amount: int | None = None
    claimed_reward_day: int | None = None
    days: list[DailyRewardDayOut]


class ThemeSettingsUpdateRequest(BaseModel):
    active_theme_kind: str | None = Field(default=None, max_length=32)
    active_theme_id: str | None = Field(default=None, max_length=80)
    story: dict[str, Any] | None = None
    custom_themes: list[dict[str, Any]] | None = None


class ThemeSettingsOut(BaseModel):
    active_theme_kind: str
    active_theme_id: str
    story: dict[str, Any]
    custom_themes: list[dict[str, Any]]


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
    total_count: int = Field(default=0, ge=0)
    has_more: bool = False


class AdminUserTokensUpdateRequest(BaseModel):
    operation: Literal["add", "subtract"]
    amount: int = Field(ge=1, le=1_000_000_000)


class AdminUserModeratorUpdateRequest(BaseModel):
    is_moderator: bool


class AdminUserBanRequest(BaseModel):
    duration_hours: int | None = Field(default=None, ge=1, le=24 * 365 * 5)


class AdminReportOut(BaseModel):
    target_type: Literal["world", "character", "instruction_template"]
    target_id: int
    target_title: str
    target_preview_image_url: str | None
    target_author_name: str
    open_reports_count: int
    latest_reason: str
    latest_description: str
    latest_created_at: datetime


class AdminReportListResponse(BaseModel):
    reports: list[AdminReportOut]


class AdminBugReportSummaryOut(BaseModel):
    id: int
    source_game_id: int
    source_game_title: str
    reporter_user_id: int
    reporter_name: str
    title: str
    description: str
    created_at: datetime


class AdminBugReportListResponse(BaseModel):
    reports: list[AdminBugReportSummaryOut]


class AdminBugReportDetailOut(BaseModel):
    id: int
    source_game_id: int
    source_game_title: str
    reporter_user_id: int
    reporter_name: str
    title: str
    description: str
    created_at: datetime
    snapshot: dict[str, Any]


class CoinPlanOut(BaseModel):
    id: str
    title: str
    description: str
    price_rub: int
    coins: int


class CoinPlanListResponse(BaseModel):
    plans: list[CoinPlanOut]


class DashboardNewsCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slot: int
    category: str
    title: str
    description: str
    image_url: str | None
    date_label: str


class DashboardNewsCardUpdateRequest(BaseModel):
    category: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10_000)
    image_url: str | None = Field(default=None, max_length=3_000_000)
    date_label: str = Field(min_length=1, max_length=80)


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
    cover_image_url: str | None = Field(default=None, max_length=3_000_000)
    cover_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    cover_position_x: float | None = Field(default=None, ge=0.0, le=100.0)
    cover_position_y: float | None = Field(default=None, ge=0.0, le=100.0)
    context_limit_chars: int | None = Field(default=None, ge=6_000, le=32_000)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    response_max_tokens_enabled: bool | None = None
    story_llm_model: str | None = Field(default=None, max_length=120)
    image_model: str | None = Field(default=None, max_length=120)
    image_style_prompt: str | None = Field(default=None, max_length=320)
    memory_optimization_enabled: bool | None = None
    memory_optimization_mode: str | None = Field(default=None, max_length=32)
    story_repetition_penalty: float | None = Field(default=None, ge=1.0, le=2.0)
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    story_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    show_gg_thoughts: bool | None = None
    show_npc_thoughts: bool | None = None
    ambient_enabled: bool | None = None
    emotion_visualization_enabled: bool | None = None
    canonical_state_pipeline_enabled: bool | None = None
    canonical_state_safe_fallback_enabled: bool | None = None
    environment_enabled: bool | None = None
    environment_time_enabled: bool | None = None
    environment_weather_enabled: bool | None = None


class StoryQuickStartRequest(BaseModel):
    genre: str = Field(min_length=1, max_length=80)
    hero_class: str = Field(min_length=1, max_length=80)
    protagonist_name: str = Field(min_length=1, max_length=120)
    start_mode: str = Field(min_length=1, max_length=16)


class StoryGameCloneRequest(BaseModel):
    copy_instructions: bool = True
    copy_plot: bool = True
    copy_world: bool = True
    copy_main_hero: bool = True
    copy_history: bool = True


class StoryGameSettingsUpdateRequest(BaseModel):
    context_limit_chars: int | None = Field(default=None, ge=6_000, le=32_000)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    response_max_tokens_enabled: bool | None = None
    story_llm_model: str | None = Field(default=None, max_length=120)
    image_model: str | None = Field(default=None, max_length=120)
    image_style_prompt: str | None = Field(default=None, max_length=320)
    memory_optimization_enabled: bool | None = None
    memory_optimization_mode: str | None = Field(default=None, max_length=32)
    story_repetition_penalty: float | None = Field(default=None, ge=1.0, le=2.0)
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    story_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    show_gg_thoughts: bool | None = None
    show_npc_thoughts: bool | None = None
    ambient_enabled: bool | None = None
    emotion_visualization_enabled: bool | None = None
    canonical_state_pipeline_enabled: bool | None = None
    canonical_state_safe_fallback_enabled: bool | None = None
    environment_enabled: bool | None = None
    environment_time_enabled: bool | None = None
    environment_weather_enabled: bool | None = None
    character_state_enabled: bool | None = None
    environment_current_datetime: str | None = Field(default=None, max_length=64)
    environment_current_weather: dict[str, Any] | None = None
    environment_tomorrow_weather: dict[str, Any] | None = None
    current_location_label: str | None = Field(default=None, max_length=160)


class StoryGameMetaUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4_000)
    opening_scene: str | None = Field(default=None, max_length=12_000)
    visibility: str | None = Field(default=None, max_length=16)
    age_rating: str | None = Field(default=None, max_length=8)
    genres: list[str] | None = Field(default=None, max_length=3)
    cover_image_url: str | None = Field(default=None, max_length=3_000_000)
    cover_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    cover_position_x: float | None = Field(default=None, ge=0.0, le=100.0)
    cover_position_y: float | None = Field(default=None, ge=0.0, le=100.0)


class StoryInstructionCardInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    is_active: bool = True


class StorySmartRegenerationRequest(BaseModel):
    enabled: bool = True
    mode: str | None = Field(default=None, max_length=32)
    options: list[str] = Field(default_factory=list, max_length=10)


class StoryGenerateRequest(BaseModel):
    prompt: str | None = Field(default=None, min_length=1, max_length=4_000)
    reroll_last_response: bool = False
    discard_last_assistant_steps: int = Field(default=0, ge=0, le=50)
    instructions: list[StoryInstructionCardInput] = Field(default_factory=list, max_length=40)
    smart_regeneration: StorySmartRegenerationRequest | None = None
    story_llm_model: str | None = Field(default=None, max_length=120)
    response_max_tokens: int | None = Field(default=None, ge=200, le=800)
    memory_optimization_enabled: bool | None = None
    story_repetition_penalty: float | None = Field(default=None, ge=1.0, le=2.0)
    story_top_k: int | None = Field(default=None, ge=0, le=200)
    story_top_r: float | None = Field(default=None, ge=0.1, le=1.0)
    story_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    show_gg_thoughts: bool | None = None
    show_npc_thoughts: bool | None = None
    ambient_enabled: bool | None = None
    environment_enabled: bool | None = None
    environment_time_enabled: bool | None = None
    environment_weather_enabled: bool | None = None
    emotion_visualization_enabled: bool | None = None


class StoryTurnImageGenerateRequest(BaseModel):
    assistant_message_id: int = Field(ge=1)


class StoryTurnImageGenerateOut(BaseModel):
    id: int
    assistant_message_id: int
    model: str
    prompt: str
    revised_prompt: str | None
    image_url: str | None
    image_data_url: str | None
    user: UserOut | None = None


class StoryTurnAudioGenerateRequest(BaseModel):
    assistant_message_id: int = Field(ge=1)


class StoryTurnAudioGenerateOut(BaseModel):
    assistant_message_id: int
    audio_url: str | None = None
    audio_data_url: str | None = None
    transcript: str | None = None
    duration_seconds: float | None = None
    user: UserOut | None = None


class StoryMapPointOut(BaseModel):
    x: float
    y: float


class StoryMapRegionOut(BaseModel):
    id: str
    name: str
    kind: str = ""
    color: str = ""
    description: str = ""
    polygon: list[StoryMapPointOut] = Field(default_factory=list)


class StoryMapLocationOut(BaseModel):
    id: str
    region_id: str = ""
    name: str
    kind: str = ""
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    x: float
    y: float
    importance: float = 0.0


class StoryMapPoiOut(BaseModel):
    id: str
    location_id: str = ""
    name: str
    kind: str = ""
    aliases: list[str] = Field(default_factory=list)
    x: float
    y: float
    importance: float = 0.0


class StoryMapRouteOut(BaseModel):
    id: str
    from_location_id: str
    to_location_id: str
    kind: str = ""
    travel_minutes: int = 0
    path: list[StoryMapPointOut] = Field(default_factory=list)


class StoryMapLandmarkOut(BaseModel):
    id: str
    region_id: str = ""
    name: str = ""
    kind: str = ""
    description: str = ""
    x: float
    y: float


class StoryMapTravelModeOut(BaseModel):
    id: str
    label: str
    description: str = ""
    speed_multiplier: float = 1.0
    is_default: bool = False


class StoryMapTravelStepOut(BaseModel):
    route_id: str
    from_location_id: str
    to_location_id: str
    from_name: str = ""
    to_name: str = ""
    kind: str = ""
    travel_minutes: int = 0


class StoryMapTravelLogEntryOut(BaseModel):
    assistant_message_id: int | None = None
    from_location_id: str
    to_location_id: str
    route_ids: list[str] = Field(default_factory=list)
    travel_minutes: int = 0
    weather_multiplier: float = 1.0
    travel_mode: str = ""
    travel_mode_label: str = ""
    distance_km: float = 0.0
    arrived_at: str | None = None
    summary: str = ""


class StoryMapStateOut(BaseModel):
    is_enabled: bool
    theme: str
    seed: str
    canvas_width: int
    canvas_height: int
    layout_version: int = 1
    world_description: str
    start_location: str
    overlay_mode: str
    default_view: str
    current_location_id: str | None = None
    current_region_id: str | None = None
    current_poi_id: str | None = None
    current_location_label: str = ""
    current_poi_label: str = ""
    current_anchor_x: float | None = None
    current_anchor_y: float | None = None
    current_anchor_label: str = ""
    current_anchor_scope: Literal["location", "poi", "waypoint"] = "location"
    last_sync_warning: str = ""
    regions: list[StoryMapRegionOut] = Field(default_factory=list)
    locations: list[StoryMapLocationOut] = Field(default_factory=list)
    pois: list[StoryMapPoiOut] = Field(default_factory=list)
    routes: list[StoryMapRouteOut] = Field(default_factory=list)
    landmarks: list[StoryMapLandmarkOut] = Field(default_factory=list)
    travel_log: list[StoryMapTravelLogEntryOut] = Field(default_factory=list)
    updated_at: str | None = None


class StoryMapInitializeRequest(BaseModel):
    world_description: str = Field(default="", max_length=1_500)
    start_location: str = Field(default="", max_length=300)
    theme: str | None = Field(default=None, max_length=80)


class StoryMapImageOut(BaseModel):
    id: int
    scope: str
    target_region_id: str | None = None
    target_location_id: str | None = None
    target_label: str = ""
    model: str = ""
    prompt: str = ""
    revised_prompt: str | None = None
    image_url: str | None = None
    image_data_url: str | None = None
    created_at: datetime
    updated_at: datetime


class StoryMapImageGenerateRequest(BaseModel):
    scope: str = Field(default="world", max_length=32)
    image_model: str | None = Field(default=None, max_length=120)
    target_region_id: str | None = Field(default=None, max_length=48)
    target_location_id: str | None = Field(default=None, max_length=48)


class StoryMapImageGenerateOut(StoryMapImageOut):
    user: UserOut | None = None


class StoryMapTravelRequest(BaseModel):
    destination_location_id: str | None = Field(default=None, max_length=48)
    destination_poi_id: str | None = Field(default=None, max_length=48)
    travel_mode: str | None = Field(default=None, max_length=32)
    destination_x: float | None = None
    destination_y: float | None = None
    destination_label: str | None = Field(default=None, max_length=160)


class StoryMapTravelPreviewOut(BaseModel):
    reachable: bool
    destination_location_id: str
    destination_name: str | None = None
    destination_poi_id: str | None = None
    destination_poi_name: str | None = None
    destination_label: str | None = None
    from_location_id: str | None = None
    from_location_name: str | None = None
    from_poi_id: str | None = None
    from_poi_name: str | None = None
    route_ids: list[str] = Field(default_factory=list)
    route_steps: list[StoryMapTravelStepOut] = Field(default_factory=list)
    base_travel_minutes: int = 0
    adjusted_travel_minutes: int = 0
    weather_multiplier: float = 1.0
    environment_time_enabled: bool = False
    travel_mode: str | None = None
    travel_mode_label: str | None = None
    available_modes: list[StoryMapTravelModeOut] = Field(default_factory=list)
    distance_km: float = 0.0
    arrival_datetime: str | None = None
    detail: str = ""
    scope: Literal["location", "poi", "waypoint"] = "location"


class StoryCharacterAvatarGenerateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=6_000)
    style_prompt: str | None = Field(default=None, max_length=320)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    image_model: str | None = Field(default=None, max_length=120)


class StoryCharacterAvatarGenerateOut(BaseModel):
    model: str
    prompt: str
    revised_prompt: str | None
    image_url: str | None
    image_data_url: str | None
    user: UserOut | None = None


class StoryCharacterEmotionGenerateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=6_000)
    style_prompt: str | None = Field(default=None, max_length=320)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    image_model: str | None = Field(default=None, max_length=120)
    reference_avatar_url: str | None = Field(default=None, max_length=3_000_000)
    emotion_ids: list[str] = Field(default_factory=list, max_length=20)


class StoryCharacterEmotionGenerateOut(BaseModel):
    model: str
    avatar_prompt: str
    emotion_prompt_lock: str | None
    reference_image_url: str | None
    reference_image_data_url: str | None
    emotion_assets: dict[str, str] = Field(default_factory=dict)
    user: UserOut | None = None


StoryCharacterEmotionJobStatus = Literal["queued", "running", "completed", "failed"]


class StoryCharacterEmotionGenerateJobOut(BaseModel):
    id: int
    status: StoryCharacterEmotionJobStatus
    image_model: str
    completed_variants: int
    total_variants: int
    current_emotion_id: str | None
    error_detail: str | None
    result: StoryCharacterEmotionGenerateOut | None = None
    user: UserOut | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class StoryInstructionCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class StoryInstructionCardActiveUpdateRequest(BaseModel):
    is_active: bool


class StoryInstructionTemplateCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    visibility: str | None = Field(default=None, max_length=16)


class StoryInstructionTemplateUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    visibility: str | None = Field(default=None, max_length=16)


class StoryWorldCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    race: str = Field(default="", max_length=120)
    clothing: str = Field(default="", max_length=1_000)
    inventory: str = Field(default="", max_length=1_000)
    health_status: str = Field(default="", max_length=1_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    kind: str | None = Field(default=None, max_length=16)
    detail_type: str = Field(default="", max_length=120)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    character_id: int | None = Field(default=None, ge=1)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    race: str = Field(default="", max_length=120)
    clothing: str = Field(default="", max_length=1_000)
    inventory: str = Field(default="", max_length=1_000)
    health_status: str = Field(default="", max_length=1_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    detail_type: str = Field(default="", max_length=120)
    character_id: int | None = Field(default=None, ge=1)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardAvatarUpdateRequest(BaseModel):
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)


class StoryWorldCardAiEditUpdateRequest(BaseModel):
    ai_edit_enabled: bool


class StoryPlotCardAiEditUpdateRequest(BaseModel):
    ai_edit_enabled: bool


class StoryPlotCardEnabledUpdateRequest(BaseModel):
    is_enabled: bool


class StoryCharacterCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=6_000)
    race: str = Field(default="", max_length=120)
    clothing: str = Field(default="", max_length=1_000)
    inventory: str = Field(default="", max_length=1_000)
    health_status: str = Field(default="", max_length=1_000)
    note: str = Field(default="", max_length=20)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    emotion_assets: dict[str, str] = Field(default_factory=dict)
    emotion_model: str | None = Field(default=None, max_length=120)
    emotion_prompt_lock: str | None = Field(default=None, max_length=8_000)
    emotion_generation_job_id: int | None = Field(default=None, ge=1)
    preserve_existing_emotions: bool | None = None
    visibility: str | None = Field(default=None, max_length=16)


class StoryCharacterUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=6_000)
    race: str = Field(default="", max_length=120)
    clothing: str = Field(default="", max_length=1_000)
    inventory: str = Field(default="", max_length=1_000)
    health_status: str = Field(default="", max_length=1_000)
    note: str = Field(default="", max_length=20)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    emotion_assets: dict[str, str] = Field(default_factory=dict)
    emotion_model: str | None = Field(default=None, max_length=120)
    emotion_prompt_lock: str | None = Field(default=None, max_length=8_000)
    emotion_generation_job_id: int | None = Field(default=None, ge=1)
    preserve_existing_emotions: bool | None = None
    visibility: str | None = Field(default=None, max_length=16)


class StoryCharacterAssignRequest(BaseModel):
    character_id: int = Field(ge=1)


class StoryPlotCardCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=32_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    memory_turns: int | None = Field(default=None)
    is_enabled: bool | None = Field(default=None)


class StoryPlotCardUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=32_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    memory_turns: int | None = Field(default=None)
    is_enabled: bool | None = Field(default=None)


class StoryMemoryBlockCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=64_000)


class StoryMemoryBlockUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=64_000)


class StoryMemoryOptimizeRequest(BaseModel):
    message_id: int | None = Field(default=None, ge=1)
    max_assistant_messages: int | None = Field(default=None, ge=1, le=128)


class StoryMessageUpdateRequest(BaseModel):
    content: str = Field(min_length=0, max_length=20_000)


class StoryCommunityWorldRatingRequest(BaseModel):
    rating: int = Field(ge=0, le=5)


class StoryCommunityWorldReportCreateRequest(BaseModel):
    reason: Literal["cp", "politics", "racism", "nationalism", "other"]
    description: str = Field(min_length=1, max_length=2_000)


class StoryBugReportCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=8_000)


class StoryCommunityWorldCommentCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2_000)


class StoryCommunityWorldCommentUpdateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2_000)


class StoryMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    role: str
    content: str
    scene_emotion_payload: str | None = None
    created_at: datetime
    updated_at: datetime


class StoryTurnImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assistant_message_id: int
    model: str
    prompt: str
    revised_prompt: str | None
    image_url: str | None
    image_data_url: str | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _resolve_turn_image_payload(cls, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, dict):
            payload = dict(value)
            image_id = payload.get("id")
            version = payload.get("updated_at") or payload.get("created_at")
        else:
            payload = {field_name: getattr(value, field_name, None) for field_name in cls.model_fields}
            image_id = getattr(value, "id", None)
            version = getattr(value, "updated_at", None) or getattr(value, "created_at", None)

        if image_id is None:
            return payload

        try:
            entity_id = int(image_id)
        except (TypeError, ValueError):
            return payload

        raw_image_data_url = payload.get("image_data_url")
        resolved_data_url = resolve_media_display_url(
            raw_image_data_url,
            kind="story-turn-image-data",
            entity_id=entity_id,
            version=version,
        )
        if resolved_data_url and str(raw_image_data_url or "").strip().startswith("data:"):
            payload["image_url"] = resolved_data_url
            payload["image_data_url"] = None
            return payload

        raw_image_url = payload.get("image_url")
        resolved_image_url = resolve_media_display_url(
            raw_image_url,
            kind="story-turn-image-url",
            entity_id=entity_id,
            version=version,
        )
        payload["image_url"] = resolved_image_url
        payload["image_data_url"] = None
        return payload


class StoryInstructionCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    title: str
    content: str
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class StoryPublicationStateOut(BaseModel):
    status: Literal["none", "pending", "approved", "rejected"]
    requested_at: datetime | None = None
    reviewed_at: datetime | None = None
    reviewer_user_id: int | None = None
    rejection_reason: str | None = None


class StoryInstructionTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    content: str
    visibility: str
    publication: StoryPublicationStateOut
    source_template_id: int | None
    community_rating_avg: float
    community_rating_count: int
    community_additions_count: int
    created_at: datetime
    updated_at: datetime


class StoryWorldCardOut(BaseModel):
    id: int
    game_id: int
    title: str
    content: str
    race: str = ""
    clothing: str = ""
    inventory: str = ""
    health_status: str = ""
    triggers: list[str]
    kind: str
    detail_type: str = ""
    avatar_url: str | None
    avatar_original_url: str | None = None
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
    race: str = ""
    clothing: str = ""
    inventory: str = ""
    health_status: str = ""
    note: str
    triggers: list[str]
    avatar_url: str | None
    avatar_original_url: str | None = None
    avatar_scale: float
    emotion_assets: dict[str, str] = Field(default_factory=dict)
    emotion_model: str = ""
    emotion_prompt_lock: str | None = None
    source: str
    visibility: str
    publication: StoryPublicationStateOut
    source_character_id: int | None
    community_rating_avg: float
    community_rating_count: int
    community_additions_count: int
    created_at: datetime
    updated_at: datetime


class StoryPlotCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    game_id: int
    title: str
    content: str
    triggers: list[str]
    memory_turns: int | None
    ai_edit_enabled: bool
    is_enabled: bool
    source: str
    created_at: datetime
    updated_at: datetime


class StoryPlotCardSnapshotOut(BaseModel):
    id: int | None
    title: str
    content: str
    triggers: list[str]
    memory_turns: int | None
    ai_edit_enabled: bool
    is_enabled: bool
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


class StoryMemoryBlockOut(BaseModel):
    id: int
    game_id: int
    assistant_message_id: int | None
    layer: Literal["raw", "compressed", "super", "key", "location", "weather"]
    title: str
    content: str
    token_count: int
    created_at: datetime
    updated_at: datetime


class StoryWorldCardSnapshotOut(BaseModel):
    id: int | None
    title: str
    content: str
    race: str = ""
    clothing: str = ""
    inventory: str = ""
    health_status: str = ""
    triggers: list[str]
    kind: str
    detail_type: str = ""
    avatar_url: str | None
    avatar_original_url: str | None = None
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
    latest_message_preview: str | None = None
    turn_count: int = 0
    opening_scene: str
    visibility: str
    publication: StoryPublicationStateOut
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
    image_model: str
    image_style_prompt: str
    memory_optimization_enabled: bool
    memory_optimization_mode: str
    story_repetition_penalty: float
    story_top_k: int
    story_top_r: float
    story_temperature: float
    show_gg_thoughts: bool
    show_npc_thoughts: bool
    ambient_enabled: bool
    character_state_enabled: bool = False
    canonical_state_pipeline_enabled: bool = True
    canonical_state_safe_fallback_enabled: bool = False
    environment_enabled: bool = False
    environment_time_enabled: bool = False
    environment_weather_enabled: bool = False
    emotion_visualization_enabled: bool
    ambient_profile: dict[str, Any] | None
    environment_current_datetime: str | None = None
    environment_current_weather: dict[str, Any] | None = None
    environment_tomorrow_weather: dict[str, Any] | None = None
    current_location_label: str | None = None
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


class StoryCommunityWorldCommentOut(BaseModel):
    id: int
    world_id: int
    user_id: int
    user_display_name: str
    user_avatar_url: str | None
    user_avatar_scale: float
    content: str
    created_at: datetime
    updated_at: datetime


class StoryCommunityWorldOut(BaseModel):
    world: StoryCommunityWorldSummaryOut
    context_limit_chars: int
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    world_cards: list[StoryWorldCardOut]
    comments: list[StoryCommunityWorldCommentOut]


class StoryCommunityCharacterSummaryOut(BaseModel):
    id: int
    name: str
    description: str
    race: str = ""
    clothing: str = ""
    inventory: str = ""
    health_status: str = ""
    note: str
    triggers: list[str]
    avatar_url: str | None
    avatar_original_url: str | None = None
    avatar_scale: float
    emotion_assets: dict[str, str] = Field(default_factory=dict)
    emotion_model: str = ""
    emotion_prompt_lock: str | None = None
    visibility: str
    author_id: int
    author_name: str
    author_avatar_url: str | None
    community_rating_avg: float
    community_rating_count: int
    community_additions_count: int
    user_rating: int | None
    is_added_by_user: bool
    is_reported_by_user: bool
    created_at: datetime
    updated_at: datetime


class StoryCommunityInstructionTemplateSummaryOut(BaseModel):
    id: int
    title: str
    content: str
    visibility: str
    author_id: int
    author_name: str
    author_avatar_url: str | None
    community_rating_avg: float
    community_rating_count: int
    community_additions_count: int
    user_rating: int | None
    is_added_by_user: bool
    is_reported_by_user: bool
    created_at: datetime
    updated_at: datetime


class StoryGameOut(BaseModel):
    game: StoryGameSummaryOut
    messages: list[StoryMessageOut]
    has_older_messages: bool = False
    turn_images: list[StoryTurnImageOut]
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    plot_card_events: list[StoryPlotCardChangeEventOut]
    memory_blocks: list[StoryMemoryBlockOut] = Field(default_factory=list)
    world_cards: list[StoryWorldCardOut]
    world_card_events: list[StoryWorldCardChangeEventOut]
    can_redo_assistant_step: bool = False


class AdminModerationAuthorOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    avatar_url: str | None = None
    role: str


class AdminModerationQueueItemOut(BaseModel):
    target_type: Literal["world", "character", "instruction_template"]
    target_id: int
    target_title: str
    target_description: str
    target_preview_image_url: str | None = None
    author: AdminModerationAuthorOut
    publication: StoryPublicationStateOut
    created_at: datetime
    updated_at: datetime


class StoryCharacterRaceOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime


class StoryCharacterRaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class StoryWorldDetailTypeOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime


class StoryWorldDetailTypeCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class StoryWorldCardTemplateCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    kind: str | None = Field(default=None, max_length=16)
    detail_type: str = Field(default="", max_length=120)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardTemplateUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    triggers: list[str] = Field(default_factory=list, max_length=40)
    detail_type: str = Field(default="", max_length=120)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float | None = Field(default=None, ge=1.0, le=3.0)
    memory_turns: int | None = Field(default=None)


class StoryWorldCardTemplateOut(BaseModel):
    id: int
    user_id: int
    title: str
    content: str
    triggers: list[str]
    kind: str
    detail_type: str = ""
    avatar_url: str | None
    avatar_original_url: str | None = None
    avatar_scale: float
    memory_turns: int | None
    created_at: datetime
    updated_at: datetime


class AdminModerationQueueResponse(BaseModel):
    items: list[AdminModerationQueueItemOut] = Field(default_factory=list)


class AdminModerationInstructionCardUpdateRequest(BaseModel):
    id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    is_active: bool = True


class AdminModerationPlotCardUpdateRequest(BaseModel):
    id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=32_000)
    triggers: list[str] = Field(default_factory=list, max_length=80)
    memory_turns: int | None = None
    is_enabled: bool = True


class AdminModerationWorldCardUpdateRequest(BaseModel):
    id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)
    triggers: list[str] = Field(default_factory=list, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float = Field(default=1.0, ge=1.0, le=3.0)
    memory_turns: int | None = None


class AdminModerationWorldUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4_000)
    opening_scene: str = Field(default="", max_length=12_000)
    age_rating: str = Field(default="16+", max_length=8)
    genres: list[str] = Field(default_factory=list, max_length=3)
    cover_image_url: str | None = Field(default=None, max_length=3_000_000)
    cover_scale: float = Field(default=1.0, ge=1.0, le=3.0)
    cover_position_x: float = Field(default=50.0, ge=0.0, le=100.0)
    cover_position_y: float = Field(default=50.0, ge=0.0, le=100.0)
    instruction_cards: list[AdminModerationInstructionCardUpdateRequest] = Field(default_factory=list, max_length=200)
    plot_cards: list[AdminModerationPlotCardUpdateRequest] = Field(default_factory=list, max_length=200)
    world_cards: list[AdminModerationWorldCardUpdateRequest] = Field(default_factory=list, max_length=200)


class AdminModerationCharacterUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=6_000)
    note: str = Field(default="", max_length=20)
    triggers: list[str] = Field(default_factory=list, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_original_url: str | None = Field(default=None, max_length=3_000_000)
    avatar_scale: float = Field(default=1.0, ge=1.0, le=3.0)


class AdminModerationInstructionTemplateUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8_000)


class AdminModerationRejectRequest(BaseModel):
    rejection_reason: str = Field(min_length=1, max_length=4_000)


class AdminModerationWorldDetailOut(BaseModel):
    author: AdminModerationAuthorOut
    game: StoryGameSummaryOut
    instruction_cards: list[StoryInstructionCardOut]
    plot_cards: list[StoryPlotCardOut]
    world_cards: list[StoryWorldCardOut]


class AdminModerationCharacterDetailOut(BaseModel):
    author: AdminModerationAuthorOut
    character: StoryCharacterOut


class AdminModerationInstructionTemplateDetailOut(BaseModel):
    author: AdminModerationAuthorOut
    template: StoryInstructionTemplateOut
