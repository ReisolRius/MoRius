from __future__ import annotations

from datetime import datetime

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
    show_public_worlds: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    show_private_worlds: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(32), default="email", nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="user", server_default="user")
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    coins: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_banned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    ban_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class UserFollow(Base):
    __tablename__ = "user_follows"
    __table_args__ = (
        UniqueConstraint("follower_user_id", "following_user_id", name="uq_user_follows_follower_following"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    follower_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    following_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
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


class StoryGame(Base):
    __tablename__ = "story_games"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="Новая игра")
    context_limit_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=1500, server_default="1500")
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
        default="z-ai/glm-5",
        server_default="z-ai/glm-5",
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
    story_top_k: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    story_top_r: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
        server_default="1.0",
    )
    ambient_enabled: Mapped[bool] = mapped_column(
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


class StoryMessage(Base):
    __tablename__ = "story_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
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
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1.0")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StoryWorldCard(Base):
    __tablename__ = "story_world_cards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("story_games.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    triggers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="world", server_default="world")
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
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
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
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
