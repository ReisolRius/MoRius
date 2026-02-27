from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import inspect, text

from app.database import Base, engine
from app.models import (
    CoinPurchase,
    StoryCharacter,
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
    StoryMessage,
    StoryTurnImage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
    UserFollow,
)


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


def _execute_schema_statement(connection, statement: str) -> None:
    try:
        connection.execute(text(statement))
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
    if "coins" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0")
    if "profile_description" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN profile_description TEXT NOT NULL DEFAULT ''")
    if "avatar_scale" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0")
    if "show_subscriptions" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_subscriptions INTEGER NOT NULL DEFAULT 0")
    if "show_public_worlds" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_public_worlds INTEGER NOT NULL DEFAULT 0")
    if "show_private_worlds" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN show_private_worlds INTEGER NOT NULL DEFAULT 0")
    if "role" not in user_columns:
        alter_statements.append(f"ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT '{DEFAULT_USER_ROLE}'")
    if "level" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1")
    if "is_banned" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0")
    if "ban_expires_at" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN ban_expires_at TIMESTAMP WITH TIME ZONE")

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
            "ADD COLUMN story_llm_model VARCHAR(120) NOT NULL DEFAULT 'z-ai/glm-5'"
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
    if "ambient_enabled" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN ambient_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "ambient_profile" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN ambient_profile TEXT NOT NULL DEFAULT ''"
        )
    if "source_world_id" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryGame.__tablename__} "
            "ADD COLUMN source_world_id INTEGER"
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
    if "avatar_url" not in existing_columns:
        alter_statements.append(
            f"ALTER TABLE {StoryWorldCard.__tablename__} "
            "ADD COLUMN avatar_url VARCHAR(2048)"
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


def _ensure_story_character_avatar_scale_column_exists() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryCharacter.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryCharacter.__tablename__)}
    if "avatar_scale" in existing_columns:
        return

    with engine.begin() as connection:
        _execute_schema_statement(
            connection,
            f"ALTER TABLE {StoryCharacter.__tablename__} "
            "ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0",
        )


def _ensure_story_character_community_columns_exist(private_visibility: str) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryCharacter.__tablename__):
        return

    existing_columns = {column["name"] for column in inspector.get_columns(StoryCharacter.__tablename__)}
    alter_statements: list[str] = []

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

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            _execute_schema_statement(connection, statement)


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
        "CREATE INDEX IF NOT EXISTS ix_coin_purchases_user_status_granted "
        f"ON {CoinPurchase.__tablename__} (user_id, status, coins_granted_at)",
        "CREATE INDEX IF NOT EXISTS ix_user_follows_follower_following_id "
        f"ON {UserFollow.__tablename__} (follower_user_id, following_user_id, id)",
        "CREATE INDEX IF NOT EXISTS ix_user_follows_following_follower_id "
        f"ON {UserFollow.__tablename__} (following_user_id, follower_user_id, id)",
    )
    with engine.begin() as connection:
        for statement in index_statements:
            _execute_schema_statement(connection, statement)


def bootstrap_database(*, database_url: str, defaults: StoryBootstrapDefaults) -> None:
    if database_url.startswith("sqlite:///"):
        raw_path = database_url.replace("sqlite:///", "")
        if raw_path and raw_path != ":memory:":
            db_path = Path(raw_path).resolve()
            db_path.parent.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)
    _ensure_user_account_columns_exist()
    _enforce_privileged_roles()
    _ensure_story_game_context_limit_column_exists(defaults.context_limit_tokens)
    _ensure_story_game_community_columns_exist(
        defaults.private_visibility,
        defaults.response_max_tokens,
    )
    _ensure_story_world_card_extended_columns_exist(defaults)
    _ensure_story_character_avatar_scale_column_exists()
    _ensure_story_character_community_columns_exist(defaults.private_visibility)
    _ensure_story_instruction_template_community_columns_exist(defaults.private_visibility)
    _ensure_story_turn_image_history_schema()
    _ensure_story_soft_undo_columns_exist()
    _ensure_performance_indexes_exist()
