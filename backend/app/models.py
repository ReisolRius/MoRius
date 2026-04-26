from __future__ import annotations

from datetime import datetime
import json

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    profile_description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    avatar_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    show_subscriptions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    show_public_worlds: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    show_private_worlds: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    show_public_characters: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    show_public_instruction_templates: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    publication_visibility_initialized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(32), default="email", nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="user", server_default="user")
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    coins: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_banned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    ban_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    onboarding_guide_state: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    theme_preferences: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_comment_reply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_world_comment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_publication_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_new_follower: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_moderation_report: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notify_moderation_queue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    daily_reward_claimed_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    daily_reward_last_claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_reward_cycle_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_reward_claim_month: Mapped[str] = mapped_column(String(7), nullable=False, default="", server_default="")
    daily_reward_claim_mask: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    referral_code: Mapped[str | None] = mapped_column(String(24), unique=True, nullable=True, index=True)
    referred_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    referral_applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    referral_bonus_claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    @property
    def active_theme_id(self) -> str | None:
        raw_value = str(self.theme_preferences or "").strip()
        if not raw_value:
            return None
        try:
            parsed = json.loads(raw_value)
        except Exception:
            return None
        if not isinstance(parsed, dict):
            return None
        value = str(parsed.get("active_theme_id") or "").strip()
        return value or None


class UserFollow(Base):
    __tablename__ = "user_follows"
    __table_args__ = (
        UniqueConstraint("follower_user_id", "following_user_id", name="uq_user_follows_follower_following"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    follower_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    following_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="generic", server_default="generic")
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    action_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts_left: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CoinPurchase(Base):
    __tablename__ = "coin_purchases"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="yookassa")
    provider_payment_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    plan_title: Mapped[str] = mapped_column(String(120), nullable=False)
    amount_rub: Mapped[int] = mapped_column(Integer, nullable=False)
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    confirmation_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    coins_granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class ReferralReward(Base):
    __tablename__ = "referral_rewards"
    __table_args__ = (
        UniqueConstraint("referred_user_id", name="uq_referral_rewards_referred_user"),
        UniqueConstraint("triggering_purchase_id", name="uq_referral_rewards_triggering_purchase"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    referrer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    referred_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    triggering_purchase_id: Mapped[int] = mapped_column(ForeignKey("coin_purchases.id"), nullable=False, index=True)
    referrer_reward_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=500, server_default="500")
    referred_reward_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=500, server_default="500")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="granted", server_default="granted")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DashboardNewsCard(Base):
    __tablename__ = "dashboard_news_cards"
    __table_args__ = (
        UniqueConstraint("slot", name="uq_dashboard_news_cards_slot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    slot: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    date_label: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryGame(Base):
    __tablename__ = "story_games"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="Новая игра")
    context_limit_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=6000, server_default="6000")
    response_max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=400, server_default="400")
    response_max_tokens_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    story_llm_model: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        default="deepseek/deepseek-chat-v3-0324",
        server_default="deepseek/deepseek-chat-v3-0324",
    )
    image_model: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        default="black-forest-labs/flux.2-pro",
        server_default="black-forest-labs/flux.2-pro",
    )
    image_style_prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    memory_optimization_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    memory_optimization_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="standard",
        server_default="standard",
    )
    story_top_k: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=55,
        server_default="55",
    )
    story_top_r: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.85,
        server_default="0.85",
    )
    story_temperature: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.85,
        server_default="0.85",
    )
    show_gg_thoughts: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    show_npc_thoughts: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    ambient_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    emotion_visualization_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    environment_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    environment_time_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    environment_weather_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    environment_time_mode: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="fixed",
        server_default="fixed",
    )
    environment_turn_step_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3,
        server_default="3",
    )
    environment_current_datetime: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="",
        server_default="",
    )
    environment_current_weather: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    environment_tomorrow_weather: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    current_location_label: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
        default="",
        server_default="",
    )
    character_state_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    character_state_monitor_inactive_always: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    character_state_payload: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    canonical_state_payload: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    canonical_state_pipeline_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    canonical_state_safe_fallback_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    ambient_profile: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        server_default="",
    )
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    opening_scene: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="private", server_default="private")
    age_rating: Mapped[str] = mapped_column(String(8), nullable=False, default="16+", server_default="16+")
    genres: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    cover_image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    cover_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    cover_position_x: Mapped[float] = mapped_column(Float, nullable=False, default=50.0, server_default="50.0")
    cover_position_y: Mapped[float] = mapped_column(Float, nullable=False, default=50.0, server_default="50.0")
    source_world_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    published_instruction_cards_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_plot_cards_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_world_cards_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    publication_status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="none",
        server_default="none",
    )
    publication_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewer_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    story_repetition_penalty: Mapped[float] = mapped_column(Float, nullable=False, default=1.05, server_default="1.05")
    story_narrator_mode: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="normal",
        server_default="normal",
    )
    story_romance_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    story_map_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    story_map_payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    community_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_launches: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_rating_sum: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityWorldRating(Base):
    __tablename__ = "story_community_world_ratings"
    __table_args__ = (
        UniqueConstraint("world_id", "user_id", name="uq_story_community_world_ratings_world_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityWorldView(Base):
    __tablename__ = "story_community_world_views"
    __table_args__ = (
        UniqueConstraint("world_id", "user_id", name="uq_story_community_world_views_world_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryCommunityWorldLaunch(Base):
    __tablename__ = "story_community_world_launches"
    __table_args__ = (
        UniqueConstraint("world_id", "user_id", name="uq_story_community_world_launches_world_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryCommunityWorldFavorite(Base):
    __tablename__ = "story_community_world_favorites"
    __table_args__ = (
        UniqueConstraint("world_id", "user_id", name="uq_story_community_world_favorites_world_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryCommunityWorldComment(Base):
    __tablename__ = "story_community_world_comments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityWorldReport(Base):
    __tablename__ = "story_community_world_reports"
    __table_args__ = (
        UniqueConstraint("world_id", "reporter_user_id", name="uq_story_community_world_reports_world_reporter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    world_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    resolved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityCharacterReport(Base):
    __tablename__ = "story_community_character_reports"
    __table_args__ = (
        UniqueConstraint("character_id", "reporter_user_id", name="uq_story_community_character_reports_character_reporter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("story_characters.id"), nullable=False, index=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    resolved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityInstructionTemplateReport(Base):
    __tablename__ = "story_community_instruction_template_reports"
    __table_args__ = (
        UniqueConstraint("template_id", "reporter_user_id", name="uq_story_community_instruction_template_reports_template_reporter"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("story_instruction_templates.id"), nullable=False, index=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    resolved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryBugReport(Base):
    __tablename__ = "story_bug_reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    source_game_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    source_game_title: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reporter_display_name: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    snapshot_payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    closed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryMessage(Base):
    __tablename__ = "story_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scene_emotion_payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryTurnImage(Base):
    __tablename__ = "story_turn_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    assistant_message_id: Mapped[int] = mapped_column(ForeignKey("story_messages.id"), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    revised_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryInstructionCard(Base):
    __tablename__ = "story_instruction_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryInstructionTemplate(Base):
    __tablename__ = "story_instruction_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="private", server_default="private")
    source_template_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    community_rating_sum: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_additions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    publication_status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="none",
        server_default="none",
    )
    publication_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewer_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCharacter(Base):
    __tablename__ = "story_characters"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    race: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    clothing: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    inventory: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    health_status: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    note: Mapped[str] = mapped_column(String(20), nullable=False, default="", server_default="")
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_original_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    emotion_assets: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    emotion_model: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    emotion_prompt_lock: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="private", server_default="private")
    source_character_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    community_rating_sum: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    community_additions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    publication_status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="none",
        server_default="none",
    )
    publication_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_reviewer_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    publication_rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCharacterRace(Base):
    __tablename__ = "story_character_races"
    __table_args__ = (
        UniqueConstraint("user_id", "name_key", name="uq_story_character_races_user_name_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryWorldDetailType(Base):
    __tablename__ = "story_world_detail_types"
    __table_args__ = (
        UniqueConstraint("user_id", "name_key", name="uq_story_world_detail_types_user_name_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryWorldCardTemplate(Base):
    __tablename__ = "story_world_card_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="world_profile", server_default="world_profile")
    detail_type: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_original_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    memory_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCharacterEmotionGenerationJob(Base):
    __tablename__ = "story_character_emotion_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", server_default="queued", index=True)
    image_model: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    request_payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    result_payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    error_detail: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    current_emotion_id: Mapped[str] = mapped_column(String(32), nullable=False, default="", server_default="")
    completed_variants: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_variants: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    reserved_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityCharacterRating(Base):
    __tablename__ = "story_community_character_ratings"
    __table_args__ = (
        UniqueConstraint("character_id", "user_id", name="uq_story_community_character_ratings_character_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("story_characters.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityCharacterAddition(Base):
    __tablename__ = "story_community_character_additions"
    __table_args__ = (
        UniqueConstraint("character_id", "user_id", name="uq_story_community_character_additions_character_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("story_characters.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryCommunityInstructionTemplateRating(Base):
    __tablename__ = "story_community_instruction_template_ratings"
    __table_args__ = (
        UniqueConstraint("template_id", "user_id", name="uq_story_community_instruction_template_ratings_template_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("story_instruction_templates.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCommunityInstructionTemplateAddition(Base):
    __tablename__ = "story_community_instruction_template_additions"
    __table_args__ = (
        UniqueConstraint("template_id", "user_id", name="uq_story_community_instruction_template_additions_template_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("story_instruction_templates.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryWorldCard(Base):
    __tablename__ = "story_world_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    race: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    clothing: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    inventory: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    health_status: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="world", server_default="world")
    detail_type: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_original_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    character_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    memory_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    ai_edit_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryPlotCard(Base):
    __tablename__ = "story_plot_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    memory_turns: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    ai_edit_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryCharacterStateSnapshot(Base):
    __tablename__ = "story_character_state_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    assistant_message_id: Mapped[int | None] = mapped_column(ForeignKey("story_messages.id"), nullable=True, index=True)
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryMapImage(Base):
    __tablename__ = "story_map_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="world", server_default="world")
    target_region_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    target_location_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    target_label: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    revised_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    image_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryMemoryBlock(Base):
    __tablename__ = "story_memory_blocks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    assistant_message_id: Mapped[int | None] = mapped_column(ForeignKey("story_messages.id"), nullable=True, index=True)
    layer: Mapped[str] = mapped_column(String(16), nullable=False, default="raw", server_default="raw")
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryPlotCardChangeEvent(Base):
    __tablename__ = "story_plot_card_change_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    assistant_message_id: Mapped[int] = mapped_column(ForeignKey("story_messages.id"), nullable=False, index=True)
    plot_card_id: Mapped[int | None] = mapped_column(ForeignKey("story_plot_cards.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    changed_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryWorldCardChangeEvent(Base):
    __tablename__ = "story_world_card_change_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    assistant_message_id: Mapped[int] = mapped_column(ForeignKey("story_messages.id"), nullable=False, index=True)
    world_card_id: Mapped[int | None] = mapped_column(ForeignKey("story_world_cards.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    changed_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
