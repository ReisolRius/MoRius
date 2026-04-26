from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from sqlalchemy import inspect, or_, text

from app.database import Base, SessionLocal, engine
from app.models import (
    CoinPurchase,
    ReferralReward,
    StoryCharacter,
    StoryCharacterRace,
    StoryWorldCardTemplate,
    StoryWorldDetailType,
    StoryBugReport,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterReport,
    StoryCommunityCharacterRating,
    StoryCommunityWorldComment,
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateReport,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldReport,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryMemoryBlock,
    StoryMessage,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
    UserFollow,
)
from app.services.media import MEDIA_URL_PREFIX, parse_media_token


@dataclass(frozen=True)
class StoryBootstrapDefaults:
    context_limit_tokens: int
    response_max_tokens: int
    private_visibility: str
    world_kind: str
    npc_kind: str
    main_hero_kind: str
    memory_turns_default: int
    memory_turns_npc: int
    memory_turns_always: int


DEFAULT_USER_ROLE = "user"
PRIVILEGED_ROLE_BY_EMAIL = {
    "alexunderstood8@gmail.com": "administrator",
    "borisow.n2011@gmail.com": "moderator",
}
BOOLEAN_COLUMN_ADD_STATEMENT_PATTERN = re.compile(
    r"ALTER TABLE (?P<table>[A-Za-z_][A-Za-z0-9_]*) "
    r"ADD COLUMN (?P<column>[A-Za-z_][A-Za-z0-9_]*) "
    r"INTEGER NOT NULL DEFAULT (?P<default>[01])\Z"
)
POSTGRES_BOOLEAN_COLUMN_DEFAULTS: dict[tuple[str, str], bool] = {
    (User.__tablename__, "show_subscriptions"): False,
    (User.__tablename__, "show_public_worlds"): True,
    (User.__tablename__, "show_private_worlds"): False,
    (User.__tablename__, "show_public_characters"): True,
    (User.__tablename__, "show_public_instruction_templates"): True,
    (User.__tablename__, "publication_visibility_initialized"): False,
    (User.__tablename__, "is_banned"): False,
    (User.__tablename__, "email_notifications_enabled"): False,
    (User.__tablename__, "notifications_enabled"): True,
    (User.__tablename__, "notify_comment_reply"): True,
    (User.__tablename__, "notify_world_comment"): True,
    (User.__tablename__, "notify_publication_review"): True,
    (User.__tablename__, "notify_new_follower"): True,
    (User.__tablename__, "notify_moderation_report"): True,
    (User.__tablename__, "notify_moderation_queue"): True,
    (StoryGame.__tablename__, "response_max_tokens_enabled"): False,
    (StoryGame.__tablename__, "memory_optimization_enabled"): True,
    (StoryGame.__tablename__, "show_gg_thoughts"): False,
    (StoryGame.__tablename__, "show_npc_thoughts"): False,
    (StoryGame.__tablename__, "ambient_enabled"): False,
    (StoryGame.__tablename__, "emotion_visualization_enabled"): False,
    (StoryGame.__tablename__, "environment_time_enabled"): False,
    (StoryGame.__tablename__, "environment_weather_enabled"): False,
    (StoryGame.__tablename__, "canonical_state_pipeline_enabled"): True,
    (StoryGame.__tablename__, "canonical_state_safe_fallback_enabled"): False,
    (StoryWorldCard.__tablename__, "is_locked"): False,
    (StoryWorldCard.__tablename__, "ai_edit_enabled"): True,
    (StoryInstructionCard.__tablename__, "is_active"): True,
    (StoryPlotCard.__tablename__, "ai_edit_enabled"): True,
    (StoryPlotCard.__tablename__, "is_enabled"): True,
}


def _is_duplicate_schema_error(exc: Exception) -> bool:
    error_text = str(getattr(exc, "orig", exc) or "").casefold()
    duplicate_markers = (
        "already exists",
        "duplicate column",
        "duplicate key",
        "duplicate table",
        "duplicate object",
    )
    return any(marker in error_text for marker in duplicate_markers)


def _sql_boolean_literal(value: bool) -> str:
    if engine.dialect.name == "postgresql":
        return "TRUE" if value else "FALSE"
    return "1" if value else "0"


def _normalize_schema_statement_for_dialect(statement: str) -> str:
    if engine.dialect.name != "postgresql":
        return statement

    normalized = " ".join(str(statement or "").split())
    match = BOOLEAN_COLUMN_ADD_STATEMENT_PATTERN.fullmatch(normalized)
    if match is None:
        return statement

    key = (match.group("table"), match.group("column"))
    default_value = POSTGRES_BOOLEAN_COLUMN_DEFAULTS.get(key)
    if default_value is None:
        return statement

    return (
        f"ALTER TABLE {match.group('table')} "
        f"ADD COLUMN {match.group('column')} "
        f"BOOLEAN NOT NULL DEFAULT {_sql_boolean_literal(default_value)}"
    )


def _execute_schema_statement(connection, statement: str) -> None:
    rendered_statement = _normalize_schema_statement_for_dialect(statement)
    try:
        connection.execute(text(rendered_statement))
    except Exception as exc:  # pragma: no cover - depends on database driver wording
        if _is_duplicate_schema_error(exc):
            return
        raise


def _ensure_user_account_columns_exist() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(User.__tablename__):
        return

    user_columns = {column["name"] for column in inspector.get_columns(User.__tablename__)}
    alter_statements: list[str] = []
    if "avatar_url" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(1024)")
    if "coins" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0")
    if "profile_description" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN profile_description TEXT NOT NULL DEFAULT ''")
    if "avatar_scale" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0")
    if "show_subscriptions" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_subscriptions INTEGER NOT NULL DEFAULT 0")
    if "show_public_worlds" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_public_worlds INTEGER NOT NULL DEFAULT 1")
    if "show_private_worlds" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_private_worlds INTEGER NOT NULL DEFAULT 0")
    if "show_public_characters" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_public_characters INTEGER NOT NULL DEFAULT 1")
    if "show_public_instruction_templates" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_public_instruction_templates INTEGER NOT NULL DEFAULT 1")
    if "publication_visibility_initialized" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN publication_visibility_initialized INTEGER NOT NULL DEFAULT 0")
    if "google_sub" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)")
    if "auth_provider" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN auth_provider VARCHAR(32) NOT NULL DEFAULT 'email'")
    if "role" not in user_columns:
        alter_statements.append(f"ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT '{DEFAULT_USER_ROLE}'")
    if "level" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1")
    if "is_banned" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0")
    if "ban_expires_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN ban_expires_at TIMESTAMP WITH TIME ZONE")
    if "onboarding_guide_state" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN onboarding_guide_state TEXT NOT NULL DEFAULT '{}'")
    if "theme_preferences" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN theme_preferences TEXT NOT NULL DEFAULT '{}'")
    if "email_notifications_enabled" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN email_notifications_enabled INTEGER NOT NULL DEFAULT 0")
    if "notifications_enabled" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1")
    if "notify_comment_reply" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_comment_reply INTEGER NOT NULL DEFAULT 1")
    if "notify_world_comment" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_world_comment INTEGER NOT NULL DEFAULT 1")
    if "notify_publication_review" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_publication_review INTEGER NOT NULL DEFAULT 1")
    if "notify_new_follower" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_new_follower INTEGER NOT NULL DEFAULT 1")
    if "notify_moderation_report" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_moderation_report INTEGER NOT NULL DEFAULT 1")
    if "notify_moderation_queue" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN notify_moderation_queue INTEGER NOT NULL DEFAULT 1")
    if "daily_reward_claimed_days" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN daily_reward_claimed_days INTEGER NOT NULL DEFAULT 0")
    if "daily_reward_last_claimed_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN daily_reward_last_claimed_at TIMESTAMP WITH TIME ZONE")
    if "daily_reward_cycle_started_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN daily_reward_cycle_started_at TIMESTAMP WITH TIME ZONE")
    if "daily_reward_claim_month" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN daily_reward_claim_month VARCHAR(7) NOT NULL DEFAULT ''")
    if "daily_reward_claim_mask" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN daily_reward_claim_mask INTEGER NOT NULL DEFAULT 0")
    if "referral_code" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN referral_code VARCHAR(24)")
    if "referred_by_user_id" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN referred_by_user_id INTEGER")
    if "referral_applied_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN referral_applied_at TIMESTAMP WITH TIME ZONE")
    if "referral_bonus_claimed_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN referral_bonus_claimed_at TIMESTAMP WITH TIME ZONE")

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _enforce_privileged_roles() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(User.__tablename__):
        return

    with engine.begin() as connection:
        for email, role in PRIVILEGED_ROLE_BY_EMAIL.items():
            connection.execute(
                text(
                    f"UPDATE {User.__tablename__} "
                    "SET role = :role "
                    "WHERE lower(email) = :email"
                ),
                {
                    "role": role,
                    "email": email,
                },
            )

        email_params = {f"email_{index}": email for index, email in enumerate(PRIVILEGED_ROLE_BY_EMAIL.keys())}
        placeholders = ", ".join(f":{name}" for name in email_params)
        if placeholders:
            connection.execute(
                text(
                    f"UPDATE {User.__tablename__} "
                    "SET role = :user_role "
                    f"WHERE lower(email) NOT IN ({placeholders}) "
                    "AND role != :user_role"
                ),
                {
                    "user_role": DEFAULT_USER_ROLE,
                    **email_params,
                },
            )


def _ensure_story_game_context_limit_column_exists(default_context_limit_tokens: int) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryGame.__tablename__):
        return

    game_columns = {column["name"] for column in inspector.get_columns(StoryGame.__tablename__)}
    if "context_limit_chars" in game_columns:
        return

    with engine.begin() as connection:
        _execute_schema_statement(
            connection,
            f"ALTER TABLE {StoryGame.__tablename__} "
            f"ADD COLUMN context_limit_chars INTEGER NOT NULL DEFAULT {default_context_limit_tokens}",
        )


def _ensure_story_game_community_columns_exist(private_visibility: str, default_response_max_tokens: int) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryGame.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryGame.__tablename__)}
    alter_statements: list[str] = []
    added_environment_time_enabled = False
    added_environment_weather_enabled = False

    if "description" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN description TEXT NOT NULL DEFAULT ''"
        )
    if "opening_scene" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN opening_scene TEXT NOT NULL DEFAULT ''"
        )
    if "visibility" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            f"ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT '{private_visibility}'"
        )
    if "age_rating" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN age_rating VARCHAR(8) NOT NULL DEFAULT '16+'"
        )
    if "genres" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'"
        )
    if "cover_image_url" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN cover_image_url VARCHAR(2048)"
        )
    if "cover_scale" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN cover_scale FLOAT NOT NULL DEFAULT 1.0"
        )
    if "cover_position_x" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN cover_position_x FLOAT NOT NULL DEFAULT 50.0"
        )
    if "cover_position_y" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN cover_position_y FLOAT NOT NULL DEFAULT 50.0"
        )
    if "story_llm_model" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN story_llm_model VARCHAR(120) NOT NULL DEFAULT 'deepseek/deepseek-chat-v3-0324'"
        )
    if "image_model" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN image_model VARCHAR(120) NOT NULL DEFAULT 'black-forest-labs/flux.2-pro'"
        )
    if "image_style_prompt" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN image_style_prompt TEXT NOT NULL DEFAULT ''"
        )
    if "response_max_tokens" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            f"ADD COLUMN response_max_tokens INTEGER NOT NULL DEFAULT {int(default_response_max_tokens)}"
        )
    if "response_max_tokens_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN response_max_tokens_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "memory_optimization_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN memory_optimization_enabled INTEGER NOT NULL DEFAULT 1"
        )
    if "memory_optimization_mode" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN memory_optimization_mode VARCHAR(32) NOT NULL DEFAULT 'standard'"
        )
    if "story_repetition_penalty" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN story_repetition_penalty FLOAT NOT NULL DEFAULT 1.05"
        )
    if "story_top_k" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN story_top_k INTEGER NOT NULL DEFAULT 0"
        )
    if "story_top_r" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN story_top_r FLOAT NOT NULL DEFAULT 1.0"
        )
    if "story_temperature" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN story_temperature FLOAT NOT NULL DEFAULT 1.0"
        )
    if "show_gg_thoughts" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN show_gg_thoughts INTEGER NOT NULL DEFAULT 0"
        )
    if "show_npc_thoughts" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN show_npc_thoughts INTEGER NOT NULL DEFAULT 0"
        )
    if "ambient_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN ambient_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "emotion_visualization_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN emotion_visualization_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "environment_time_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN environment_time_enabled INTEGER NOT NULL DEFAULT 0"
        )
        added_environment_time_enabled = True
    if "environment_weather_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN environment_weather_enabled INTEGER NOT NULL DEFAULT 0"
        )
        added_environment_weather_enabled = True
    if "ambient_profile" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN ambient_profile TEXT NOT NULL DEFAULT ''"
        )
    if "canonical_state_payload" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN canonical_state_payload TEXT NOT NULL DEFAULT ''"
        )
    if "canonical_state_pipeline_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN canonical_state_pipeline_enabled INTEGER NOT NULL DEFAULT 1"
        )
    if "canonical_state_safe_fallback_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN canonical_state_safe_fallback_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "current_location_label" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN current_location_label VARCHAR(160) NOT NULL DEFAULT ''"
        )
    if "source_world_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN source_world_id INTEGER"
        )
    if "published_instruction_cards_snapshot" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN published_instruction_cards_snapshot TEXT"
        )
    if "published_plot_cards_snapshot" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN published_plot_cards_snapshot TEXT"
        )
    if "published_world_cards_snapshot" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN published_world_cards_snapshot TEXT"
        )
    if "community_views" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN community_views INTEGER NOT NULL DEFAULT 0"
        )
    if "community_launches" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN community_launches INTEGER NOT NULL DEFAULT 0"
        )
    if "community_rating_sum" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN community_rating_sum INTEGER NOT NULL DEFAULT 0"
        )
    if "community_rating_count" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN community_rating_count INTEGER NOT NULL DEFAULT 0"
        )
    if "publication_status" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN publication_status VARCHAR(16) NOT NULL DEFAULT 'none'"
        )
    if "publication_requested_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN publication_requested_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewed_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN publication_reviewed_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewer_user_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN publication_reviewer_user_id INTEGER"
        )
    if "publication_rejection_reason" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN publication_rejection_reason TEXT"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_story_world_card_extended_columns_exist(defaults: StoryBootstrapDefaults) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryWorldCard.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryWorldCard.__tablename__)}
    alter_statements: list[str] = []
    memory_turns_column_added = False

    if "kind" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            f"ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT '{defaults.world_kind}'"
        )
    if "detail_type" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN detail_type VARCHAR(120) NOT NULL DEFAULT ''"
        )
    if "avatar_url" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN avatar_url VARCHAR(2048)"
        )
    if "avatar_original_url" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN avatar_original_url VARCHAR(2048)"
        )
    if "avatar_scale" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0"
        )
    if "character_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN character_id INTEGER"
        )
    if "race" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN race VARCHAR(120) NOT NULL DEFAULT ''"
        )
    if "clothing" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN clothing TEXT NOT NULL DEFAULT ''"
        )
    if "inventory" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN inventory TEXT NOT NULL DEFAULT ''"
        )
    if "health_status" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN health_status TEXT NOT NULL DEFAULT ''"
        )
    if "memory_turns" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            f"ADD COLUMN memory_turns INTEGER NOT NULL DEFAULT {defaults.memory_turns_default}"
        )
        memory_turns_column_added = True
    if "is_locked" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0"
        )
    if "ai_edit_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN ai_edit_enabled INTEGER NOT NULL DEFAULT 1"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)
        if "environment_enabled" in existing_columns and (
            added_environment_time_enabled or added_environment_weather_enabled
        ):
            assignments: list[str] = []
            if added_environment_time_enabled:
                assignments.append("environment_time_enabled = environment_enabled")
            if added_environment_weather_enabled:
                assignments.append("environment_weather_enabled = environment_enabled")
            if assignments:
                connection.execute(
                    text(
                        f"UPDATE {StoryGame.__tablename__} "
                        f"SET {', '.join(assignments)}"
                    )
                )
        if "avatar_original_url" not in existing_columns:
            connection.execute(
                text(
                    f"UPDATE {StoryWorldCard.__tablename__} "
                    "SET avatar_original_url = avatar_url "
                    "WHERE avatar_original_url IS NULL AND avatar_url IS NOT NULL"
                )
            )
        if memory_turns_column_added:
            connection.execute(
                text(
                    f"UPDATE {StoryWorldCard.__tablename__} "
                    f"SET memory_turns = {defaults.memory_turns_npc} "
                    f"WHERE kind = '{defaults.npc_kind}'"
                )
            )
            connection.execute(
                text(
                    f"UPDATE {StoryWorldCard.__tablename__} "
                    f"SET memory_turns = {defaults.memory_turns_always} "
                    f"WHERE kind = '{defaults.main_hero_kind}'"
                )
            )


def _initialize_user_publication_visibility_defaults() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(User.__tablename__):
        return

    user_columns = {column["name"] for column in inspector.get_columns(User.__tablename__)}
    required_columns = {
        "publication_visibility_initialized",
        "show_public_worlds",
        "show_public_characters",
        "show_public_instruction_templates",
    }
    if not required_columns.issubset(user_columns):
        return

    true_literal = _sql_boolean_literal(True)
    false_literal = _sql_boolean_literal(False)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"UPDATE {User.__tablename__} "
                f"SET show_public_worlds = {true_literal}, "
                f"show_public_characters = {true_literal}, "
                f"show_public_instruction_templates = {true_literal}, "
                f"publication_visibility_initialized = {true_literal} "
                f"WHERE COALESCE(publication_visibility_initialized, {false_literal}) = {false_literal}"
            )
        )


def _ensure_story_instruction_card_extended_columns_exist() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryInstructionCard.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryInstructionCard.__tablename__)}
    alter_statements: list[str] = []

    if "is_active" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionCard.__tablename__} "
            "ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_story_plot_card_extended_columns_exist() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryPlotCard.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryPlotCard.__tablename__)}
    alter_statements: list[str] = []

    if "ai_edit_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryPlotCard.__tablename__} "
            "ADD COLUMN ai_edit_enabled INTEGER NOT NULL DEFAULT 1"
        )
    if "is_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryPlotCard.__tablename__} "
            "ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1"
        )
    if "triggers" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryPlotCard.__tablename__} "
            "ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]'"
        )
    if "memory_turns" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryPlotCard.__tablename__} "
            "ADD COLUMN memory_turns INTEGER NOT NULL DEFAULT 2"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_story_character_avatar_scale_column_exists() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryCharacter.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryCharacter.__tablename__)}
    alter_statements: list[str] = []
    if "avatar_scale" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0"
        )
    if "avatar_original_url" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN avatar_original_url VARCHAR(2048)"
        )
    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)
        if "avatar_original_url" not in existing_columns:
            connection.execute(
                text(
                    f"UPDATE {StoryCharacter.__tablename__} "
                    "SET avatar_original_url = avatar_url "
                    "WHERE avatar_original_url IS NULL AND avatar_url IS NOT NULL"
                )
            )


def _ensure_story_character_community_columns_exist(private_visibility: str) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryCharacter.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryCharacter.__tablename__)}
    alter_statements: list[str] = []

    if "note" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN note VARCHAR(20) NOT NULL DEFAULT ''"
        )
    if "race" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN race VARCHAR(120) NOT NULL DEFAULT ''"
        )
    if "clothing" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN clothing TEXT NOT NULL DEFAULT ''"
        )
    if "inventory" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN inventory TEXT NOT NULL DEFAULT ''"
        )
    if "health_status" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN health_status TEXT NOT NULL DEFAULT ''"
        )
    if "visibility" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            f"ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT '{private_visibility}'"
        )
    if "source_character_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN source_character_id INTEGER"
        )
    if "community_rating_sum" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN community_rating_sum INTEGER NOT NULL DEFAULT 0"
        )
    if "community_rating_count" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN community_rating_count INTEGER NOT NULL DEFAULT 0"
        )
    if "community_additions_count" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN community_additions_count INTEGER NOT NULL DEFAULT 0"
        )
    if "emotion_assets" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN emotion_assets TEXT NOT NULL DEFAULT ''"
        )
    if "emotion_model" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN emotion_model VARCHAR(120) NOT NULL DEFAULT ''"
        )
    if "emotion_prompt_lock" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN emotion_prompt_lock TEXT NOT NULL DEFAULT ''"
        )
    if "publication_status" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN publication_status VARCHAR(16) NOT NULL DEFAULT 'none'"
        )
    if "publication_requested_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN publication_requested_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewed_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN publication_reviewed_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewer_user_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN publication_reviewer_user_id INTEGER"
        )
    if "publication_rejection_reason" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN publication_rejection_reason TEXT"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_story_character_races_schema() -> None:
    StoryCharacterRace.__table__.create(bind=engine, checkfirst=True)


def _ensure_story_instruction_template_community_columns_exist(private_visibility: str) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryInstructionTemplate.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryInstructionTemplate.__tablename__)}
    alter_statements: list[str] = []

    if "visibility" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            f"ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT '{private_visibility}'"
        )
    if "source_template_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN source_template_id INTEGER"
        )
    if "community_rating_sum" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN community_rating_sum INTEGER NOT NULL DEFAULT 0"
        )
    if "community_rating_count" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN community_rating_count INTEGER NOT NULL DEFAULT 0"
        )
    if "community_additions_count" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN community_additions_count INTEGER NOT NULL DEFAULT 0"
        )
    if "publication_status" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN publication_status VARCHAR(16) NOT NULL DEFAULT 'none'"
        )
    if "publication_requested_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN publication_requested_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewed_at" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN publication_reviewed_at TIMESTAMP WITH TIME ZONE"
        )
    if "publication_reviewer_user_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN publication_reviewer_user_id INTEGER"
        )
    if "publication_rejection_reason" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryInstructionTemplate.__tablename__} "
            "ADD COLUMN publication_rejection_reason TEXT"
        )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_story_turn_image_history_schema() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryTurnImage.__tablename__):
        return

    unique_constraints = inspector.get_unique_constraints(StoryTurnImage.__tablename__)
    has_legacy_assistant_unique_constraint = any(
        (constraint.get("column_names") or []) == ["assistant_message_id"]
        for constraint in unique_constraints
    )
    if not has_legacy_assistant_unique_constraint:
        return

    table_name = StoryTurnImage.__tablename__
    dialect_name = str(engine.dialect.name or "").lower()

    with engine.begin() as connection:
        if dialect_name == "postgresql":
            _execute_schema_statement(
                connection,
                f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS uq_story_turn_images_assistant_message",
            )
            return

        if dialect_name == "sqlite":
            legacy_table_name = f"{table_name}_legacy"
            _execute_schema_statement(connection, "PRAGMA foreign_keys=OFF")
            _execute_schema_statement(connection, f"DROP TABLE IF EXISTS {legacy_table_name}")
            _execute_schema_statement(connection, f"ALTER TABLE {table_name} RENAME TO {legacy_table_name}")
            _execute_schema_statement(
                connection,
                f"""
                CREATE TABLE {table_name} (
                    id INTEGER NOT NULL,
                    game_id INTEGER NOT NULL,
                    assistant_message_id INTEGER NOT NULL,
                    model VARCHAR(120) NOT NULL DEFAULT '',
                    prompt TEXT NOT NULL DEFAULT '',
                    revised_prompt TEXT,
                    image_url TEXT,
                    image_data_url TEXT,
                    undone_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    FOREIGN KEY(game_id) REFERENCES story_games (id),
                    FOREIGN KEY(assistant_message_id) REFERENCES story_messages (id)
                )
                """,
            )
            _execute_schema_statement(
                connection,
                f"""
                INSERT INTO {table_name} (
                    id,
                    game_id,
                    assistant_message_id,
                    model,
                    prompt,
                    revised_prompt,
                    image_url,
                    image_data_url,
                    created_at,
                    updated_at
                )
                SELECT
                    id,
                    game_id,
                    assistant_message_id,
                    model,
                    prompt,
                    revised_prompt,
                    image_url,
                    image_data_url,
                    NULL AS undone_at,
                    created_at,
                    updated_at
                FROM {legacy_table_name}
                ORDER BY id ASC
                """,
            )
            _execute_schema_statement(connection, f"DROP TABLE IF EXISTS {legacy_table_name}")
            _execute_schema_statement(connection, "PRAGMA foreign_keys=ON")
            return

        for constraint in unique_constraints:
            if (constraint.get("column_names") or []) != ["assistant_message_id"]:
                continue
            constraint_name = str(constraint.get("name") or "").strip()
            if not constraint_name:
                continue
            _execute_schema_statement(
                connection,
                f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}",
            )


def _ensure_story_soft_undo_columns_exist() -> None:
    inspector = inspect(engine)
    alter_statements: list[str] = []

    if inspector.has_table(StoryMessage.__tablename__):
        message_columns = {column["name"] for column in inspector.get_columns(StoryMessage.__tablename__)}
        if "undone_at" not in message_columns:
            alter_statements.append(
                f"ALTER TABLE {StoryMessage.__tablename__} "
                "ADD COLUMN undone_at TIMESTAMP WITH TIME ZONE"
            )
        if "scene_emotion_payload" not in message_columns:
            alter_statements.append(
                f"ALTER TABLE {StoryMessage.__tablename__} "
                "ADD COLUMN scene_emotion_payload TEXT NOT NULL DEFAULT ''"
            )

    if inspector.has_table(StoryTurnImage.__tablename__):
        image_columns = {column["name"] for column in inspector.get_columns(StoryTurnImage.__tablename__)}
        if "undone_at" not in image_columns:
            alter_statements.append(
                f"ALTER TABLE {StoryTurnImage.__tablename__} "
                "ADD COLUMN undone_at TIMESTAMP WITH TIME ZONE"
            )

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


def _ensure_performance_indexes_exist() -> None:
    index_statements = (
        "CREATE INDEX IF NOT EXISTS ix_story_games_user_activity_id "
        f"ON {StoryGame.__tablename__} (user_id, last_activity_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_games_visibility_source_id "
        f"ON {StoryGame.__tablename__} (visibility, source_world_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_games_visibility_rank_id "
        f"ON {StoryGame.__tablename__} "
        "(visibility, source_world_id, community_launches, community_views, community_rating_count, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_games_source_world_id_id "
        f"ON {StoryGame.__tablename__} (source_world_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_messages_game_id_id "
        f"ON {StoryMessage.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_messages_game_undone_id "
        f"ON {StoryMessage.__tablename__} (game_id, undone_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_turn_images_game_assistant_id "
        f"ON {StoryTurnImage.__tablename__} (game_id, assistant_message_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_turn_images_game_undone_id "
        f"ON {StoryTurnImage.__tablename__} (game_id, undone_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_instruction_cards_game_id_id "
        f"ON {StoryInstructionCard.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_instruction_templates_user_id_id "
        f"ON {StoryInstructionTemplate.__tablename__} (user_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_instruction_templates_visibility_source_id "
        f"ON {StoryInstructionTemplate.__tablename__} (visibility, source_template_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_instruction_templates_source_template_id_id "
        f"ON {StoryInstructionTemplate.__tablename__} (source_template_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_plot_cards_game_id_id "
        f"ON {StoryPlotCard.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_plot_cards_game_enabled_id "
        f"ON {StoryPlotCard.__tablename__} (game_id, is_enabled, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_memory_blocks_game_id_id "
        f"ON {StoryMemoryBlock.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_memory_blocks_game_layer_id "
        f"ON {StoryMemoryBlock.__tablename__} (game_id, layer, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_memory_blocks_game_undone_id "
        f"ON {StoryMemoryBlock.__tablename__} (game_id, undone_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_memory_blocks_assistant_id "
        f"ON {StoryMemoryBlock.__tablename__} (assistant_message_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_cards_game_id_id "
        f"ON {StoryWorldCard.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_cards_game_kind_id "
        f"ON {StoryWorldCard.__tablename__} (game_id, kind, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_cards_game_kind_character_id "
        f"ON {StoryWorldCard.__tablename__} (game_id, kind, character_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_characters_user_id_id "
        f"ON {StoryCharacter.__tablename__} (user_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_characters_visibility_source_id "
        f"ON {StoryCharacter.__tablename__} (visibility, source_character_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_characters_source_character_id_id "
        f"ON {StoryCharacter.__tablename__} (source_character_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_character_races_user_name_id "
        f"ON {StoryCharacterRace.__tablename__} (user_id, name, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_character_races_user_name_key_id "
        f"ON {StoryCharacterRace.__tablename__} (user_id, name_key, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_detail_types_user_name_id "
        f"ON {StoryWorldDetailType.__tablename__} (user_id, name, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_detail_types_user_name_key_id "
        f"ON {StoryWorldDetailType.__tablename__} (user_id, name_key, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_card_templates_user_kind_id "
        f"ON {StoryWorldCardTemplate.__tablename__} (user_id, kind, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_card_templates_user_updated_id "
        f"ON {StoryWorldCardTemplate.__tablename__} (user_id, updated_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_events_game_id_id "
        f"ON {StoryWorldCardChangeEvent.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_world_events_game_undone_id "
        f"ON {StoryWorldCardChangeEvent.__tablename__} (game_id, undone_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_plot_events_game_id_id "
        f"ON {StoryPlotCardChangeEvent.__tablename__} (game_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_plot_events_game_undone_id "
        f"ON {StoryPlotCardChangeEvent.__tablename__} (game_id, undone_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_ratings_world_user_id "
        f"ON {StoryCommunityWorldRating.__tablename__} (world_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_views_world_user_id "
        f"ON {StoryCommunityWorldView.__tablename__} (world_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_launches_world_user_id "
        f"ON {StoryCommunityWorldLaunch.__tablename__} (world_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_favorites_world_user_id "
        f"ON {StoryCommunityWorldFavorite.__tablename__} (world_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_favorites_user_world_id "
        f"ON {StoryCommunityWorldFavorite.__tablename__} (user_id, world_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_comments_world_created_id "
        f"ON {StoryCommunityWorldComment.__tablename__} (world_id, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_comments_user_created_id "
        f"ON {StoryCommunityWorldComment.__tablename__} (user_id, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_reports_world_status_id "
        f"ON {StoryCommunityWorldReport.__tablename__} (world_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_reports_reporter_world_id "
        f"ON {StoryCommunityWorldReport.__tablename__} (reporter_user_id, world_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_world_reports_status_created_id "
        f"ON {StoryCommunityWorldReport.__tablename__} (status, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_ratings_character_user_id "
        f"ON {StoryCommunityCharacterRating.__tablename__} (character_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_additions_character_user_id "
        f"ON {StoryCommunityCharacterAddition.__tablename__} (character_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_additions_user_character_id "
        f"ON {StoryCommunityCharacterAddition.__tablename__} (user_id, character_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_reports_character_status_id "
        f"ON {StoryCommunityCharacterReport.__tablename__} (character_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_reports_reporter_character_id "
        f"ON {StoryCommunityCharacterReport.__tablename__} (reporter_user_id, character_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_character_reports_status_created_id "
        f"ON {StoryCommunityCharacterReport.__tablename__} (status, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_ratings_template_user_id "
        f"ON {StoryCommunityInstructionTemplateRating.__tablename__} (template_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_additions_template_user_id "
        f"ON {StoryCommunityInstructionTemplateAddition.__tablename__} (template_id, user_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_additions_user_template_id "
        f"ON {StoryCommunityInstructionTemplateAddition.__tablename__} (user_id, template_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_reports_template_status_id "
        f"ON {StoryCommunityInstructionTemplateReport.__tablename__} (template_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_reports_reporter_template_id "
        f"ON {StoryCommunityInstructionTemplateReport.__tablename__} (reporter_user_id, template_id)",
        "CREATE INDEX IF NOT EXISTS ix_story_community_instruction_template_reports_status_created_id "
        f"ON {StoryCommunityInstructionTemplateReport.__tablename__} (status, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_bug_reports_status_created_id "
        f"ON {StoryBugReport.__tablename__} (status, created_at, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_bug_reports_source_game_status_id "
        f"ON {StoryBugReport.__tablename__} (source_game_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_story_bug_reports_reporter_status_id "
        f"ON {StoryBugReport.__tablename__} (reporter_user_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_coin_purchases_user_status_granted "
        f"ON {CoinPurchase.__tablename__} (user_id, status, coins_granted_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_referral_code "
        f"ON {User.__tablename__} (referral_code)",
        "CREATE INDEX IF NOT EXISTS ix_users_referred_by_user_id "
        f"ON {User.__tablename__} (referred_by_user_id)",
        "CREATE INDEX IF NOT EXISTS ix_referral_rewards_referrer_status_id "
        f"ON {ReferralReward.__tablename__} (referrer_user_id, status, id)",
        "CREATE INDEX IF NOT EXISTS ix_referral_rewards_referred_id "
        f"ON {ReferralReward.__tablename__} (referred_user_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_user_follows_follower_following_id "
        f"ON {UserFollow.__tablename__} (follower_user_id, following_user_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_user_follows_following_follower_id "
        f"ON {UserFollow.__tablename__} (following_user_id, follower_user_id, id)",
    )
    with engine.begin() as connection:
        for statement in index_statements:
            _execute_schema_statement(connection, statement)


LEGACY_STORY_AVATAR_MEDIA_SPECS: dict[str, tuple[type[object], str]] = {
    "story-game-cover": (StoryGame, "cover_image_url"),
    "story-character-avatar": (StoryCharacter, "avatar_url"),
    "story-character-avatar-original": (StoryCharacter, "avatar_original_url"),
    "story-world-card-avatar": (StoryWorldCard, "avatar_url"),
    "story-world-card-avatar-original": (StoryWorldCard, "avatar_original_url"),
    "story-world-card-template-avatar": (StoryWorldCardTemplate, "avatar_url"),
    "story-world-card-template-avatar-original": (StoryWorldCardTemplate, "avatar_original_url"),
}


def _resolve_legacy_story_avatar_media_value(
    raw_value: str | None,
    *,
    db,
    max_depth: int = 6,
    visited_tokens: set[str] | None = None,
) -> str | None:
    normalized_value = str(raw_value or "").strip()
    if not normalized_value:
        return None
    if not normalized_value.startswith(MEDIA_URL_PREFIX):
        return normalized_value
    if max_depth <= 0:
        return normalized_value

    token = normalized_value[len(MEDIA_URL_PREFIX) :].strip()
    if not token:
        return normalized_value

    known_tokens = visited_tokens or set()
    if token in known_tokens:
        return normalized_value
    known_tokens.add(token)

    payload = parse_media_token(token)
    if payload is None:
        return normalized_value

    kind = str(payload.get("kind") or "").strip()
    entity_id_raw = payload.get("entity_id")
    try:
        entity_id = int(entity_id_raw)
    except (TypeError, ValueError):
        return None

    spec = LEGACY_STORY_AVATAR_MEDIA_SPECS.get(kind)
    if spec is None:
        return normalized_value

    model_class, field_name = spec
    record = db.get(model_class, entity_id)
    if record is None:
        return normalized_value

    nested_value = getattr(record, field_name, None)
    resolved_value = _resolve_legacy_story_avatar_media_value(
        nested_value,
        db=db,
        max_depth=max_depth - 1,
        visited_tokens=known_tokens,
    )
    return str(resolved_value or "").strip() or normalized_value


def _repair_legacy_story_avatar_media_tokens() -> None:
    with SessionLocal() as db:
        changed = False
        world_records = (
            db.query(StoryGame)
            .filter(StoryGame.cover_image_url.like(f"{MEDIA_URL_PREFIX}%"))
            .all()
        )
        for world in world_records:
            resolved_cover_image_url = _resolve_legacy_story_avatar_media_value(
                getattr(world, "cover_image_url", None),
                db=db,
            )
            if resolved_cover_image_url != getattr(world, "cover_image_url", None):
                world.cover_image_url = resolved_cover_image_url
                changed = True

        character_records = (
            db.query(StoryCharacter)
            .filter(
                or_(
                    StoryCharacter.avatar_url.like(f"{MEDIA_URL_PREFIX}%"),
                    StoryCharacter.avatar_original_url.like(f"{MEDIA_URL_PREFIX}%"),
                )
            )
            .all()
        )
        for character in character_records:
            resolved_avatar_url = _resolve_legacy_story_avatar_media_value(
                getattr(character, "avatar_url", None),
                db=db,
            )
            resolved_avatar_original_url = _resolve_legacy_story_avatar_media_value(
                getattr(character, "avatar_original_url", None),
                db=db,
            )
            if resolved_avatar_url is None and resolved_avatar_original_url is not None:
                resolved_avatar_url = resolved_avatar_original_url
            if resolved_avatar_original_url is None and resolved_avatar_url is not None:
                resolved_avatar_original_url = resolved_avatar_url

            if resolved_avatar_url != getattr(character, "avatar_url", None):
                character.avatar_url = resolved_avatar_url
                changed = True
            if resolved_avatar_original_url != getattr(character, "avatar_original_url", None):
                character.avatar_original_url = resolved_avatar_original_url
                changed = True

        world_card_records = (
            db.query(StoryWorldCard)
            .filter(
                or_(
                    StoryWorldCard.avatar_url.like(f"{MEDIA_URL_PREFIX}%"),
                    StoryWorldCard.avatar_original_url.like(f"{MEDIA_URL_PREFIX}%"),
                )
            )
            .all()
        )
        for world_card in world_card_records:
            resolved_avatar_url = _resolve_legacy_story_avatar_media_value(
                getattr(world_card, "avatar_url", None),
                db=db,
            )
            resolved_avatar_original_url = _resolve_legacy_story_avatar_media_value(
                getattr(world_card, "avatar_original_url", None),
                db=db,
            )
            if resolved_avatar_url is None and resolved_avatar_original_url is not None:
                resolved_avatar_url = resolved_avatar_original_url
            if resolved_avatar_original_url is None and resolved_avatar_url is not None:
                resolved_avatar_original_url = resolved_avatar_url

            if resolved_avatar_url != getattr(world_card, "avatar_url", None):
                world_card.avatar_url = resolved_avatar_url
                changed = True
            if resolved_avatar_original_url != getattr(world_card, "avatar_original_url", None):
                world_card.avatar_original_url = resolved_avatar_original_url
                changed = True

        template_records = (
            db.query(StoryWorldCardTemplate)
            .filter(
                or_(
                    StoryWorldCardTemplate.avatar_url.like(f"{MEDIA_URL_PREFIX}%"),
                    StoryWorldCardTemplate.avatar_original_url.like(f"{MEDIA_URL_PREFIX}%"),
                )
            )
            .all()
        )
        for template in template_records:
            resolved_avatar_url = _resolve_legacy_story_avatar_media_value(
                getattr(template, "avatar_url", None),
                db=db,
            )
            resolved_avatar_original_url = _resolve_legacy_story_avatar_media_value(
                getattr(template, "avatar_original_url", None),
                db=db,
            )
            if resolved_avatar_url is None and resolved_avatar_original_url is not None:
                resolved_avatar_url = resolved_avatar_original_url
            if resolved_avatar_original_url is None and resolved_avatar_url is not None:
                resolved_avatar_original_url = resolved_avatar_url

            if resolved_avatar_url != getattr(template, "avatar_url", None):
                template.avatar_url = resolved_avatar_url
                changed = True
            if resolved_avatar_original_url != getattr(template, "avatar_original_url", None):
                template.avatar_original_url = resolved_avatar_original_url
                changed = True

        if changed:
            db.commit()


def bootstrap_database(*, database_url: str, defaults: StoryBootstrapDefaults) -> None:
    if database_url.startswith("sqlite:///"):
        raw_path = database_url.replace("sqlite:///", "")
        if raw_path and raw_path != ":memory:":
            db_path = Path(raw_path).resolve()
            db_path.parent.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)
    _ensure_user_account_columns_exist()
    _initialize_user_publication_visibility_defaults()
    _enforce_privileged_roles()
    _ensure_story_game_context_limit_column_exists(defaults.context_limit_tokens)
    _ensure_story_game_community_columns_exist(
        defaults.private_visibility,
        defaults.response_max_tokens,
    )
    _ensure_story_instruction_card_extended_columns_exist()
    _ensure_story_world_card_extended_columns_exist(defaults)
    _ensure_story_plot_card_extended_columns_exist()
    _ensure_story_character_avatar_scale_column_exists()
    _ensure_story_character_community_columns_exist(defaults.private_visibility)
    _ensure_story_character_races_schema()
    _ensure_story_instruction_template_community_columns_exist(defaults.private_visibility)
    _ensure_story_turn_image_history_schema()
    _ensure_story_soft_undo_columns_exist()
    _repair_legacy_story_avatar_media_tokens()
    _ensure_performance_indexes_exist()
