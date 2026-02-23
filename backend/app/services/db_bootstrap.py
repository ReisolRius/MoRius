from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import inspect, text

from app.database import Base, engine
from app.models import (
    CoinPurchase,
    StoryCharacter,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionCard,
    StoryMessage,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    User,
)


@dataclass(frozen=True)
class StoryBootstrapDefaults:
    context_limit_tokens: int
    private_visibility: str
    world_kind: str
    npc_kind: str
    main_hero_kind: str
    memory_turns_default: int
    memory_turns_npc: int
    memory_turns_always: int


def _ensure_user_coins_column_exists() -> None:
    inspector = inspect(engine)
    if not inspector.has_table(User.__tablename__):
        return

    user_columns = {column["name"] for column in inspector.get_columns(User.__tablename__)}
    alter_statements: list[str] = []
    if "coins" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0")
    if "avatar_scale" not in user_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0")

    if not alter_statements:
        return

    with engine.begin() as connection:
        for statement in alter_statements:
            connection.execute(text(statement))


def _ensure_story_game_context_limit_column_exists(default_context_limit_tokens: int) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(StoryGame.__tablename__):
        return

    game_columns = {column["name"] for column in inspector.get_columns(StoryGame.__tablename__)}
    if "context_limit_chars" in game_columns:
        return

    with engine.begin() as connection:
        connection.execute(
            text(
                f"ALTER TABLE {StoryGame.__tablename__} "
                f"ADD COLUMN context_limit_chars INTEGER NOT NULL DEFAULT {default_context_limit_tokens}"
            )
        )


def _ensure_story_game_community_columns_exist(private_visibility: str) -> None:
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
            connection.execute(text(statement))


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
            connection.execute(text(statement))
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
        connection.execute(
            text(
                f"ALTER TABLE {StoryCharacter.__tablename__} "
                "ADD COLUMN avatar_scale FLOAT NOT NULL DEFAULT 1.0"
            )
        )


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
        "CREATE INDEX IF NOT EXISTS ix_story_instruction_cards_game_id_id "
        f"ON {StoryInstructionCard.__tablename__} (game_id, id)",
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
        "CREATE INDEX IF NOT EXISTS ix_coin_purchases_user_status_granted "
        f"ON {CoinPurchase.__tablename__} (user_id, status, coins_granted_at)",
    )
    with engine.begin() as connection:
        for statement in index_statements:
            connection.execute(text(statement))


def bootstrap_database(*, database_url: str, defaults: StoryBootstrapDefaults) -> None:
    if database_url.startswith("sqlite:///"):
        raw_path = database_url.replace("sqlite:///", "")
        if raw_path and raw_path != ":memory:":
            db_path = Path(raw_path).resolve()
            db_path.parent.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)
    _ensure_user_coins_column_exists()
    _ensure_story_game_context_limit_column_exists(defaults.context_limit_tokens)
    _ensure_story_game_community_columns_exist(defaults.private_visibility)
    _ensure_story_world_card_extended_columns_exist(defaults)
    _ensure_story_character_avatar_scale_column_exists()
    _ensure_performance_indexes_exist()
