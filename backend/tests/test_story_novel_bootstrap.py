from __future__ import annotations

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest


class StoryNovelBootstrapMigrationTests(unittest.TestCase):
    def test_bootstrap_adds_game_mode_and_novel_sprite_gender_and_drops_legacy_tables(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "morius.db"
            env = os.environ.copy()
            env["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
            env["APP_MODE"] = "gateway"
            env["DB_BOOTSTRAP_ON_STARTUP"] = "true"

            script = textwrap.dedent(
                """
                import sqlite3

                from app.config import settings
                from app.services.db_bootstrap import StoryBootstrapDefaults, bootstrap_database
                from app.services.story_games import (
                    STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
                    STORY_DEFAULT_RESPONSE_MAX_TOKENS,
                    STORY_GAME_VISIBILITY_PRIVATE,
                    STORY_WORLD_CARD_KIND_MAIN_HERO,
                    STORY_WORLD_CARD_KIND_NPC,
                    STORY_WORLD_CARD_KIND_WORLD,
                    STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
                    STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
                    STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
                )

                # Simulate a pre-refactor database that still has the old, now-removed
                # sprite-generation-job table lying around, to prove bootstrap drops it.
                raw_path = settings.database_url.replace("sqlite:///", "")
                seed_connection = sqlite3.connect(raw_path)
                try:
                    seed_connection.execute(
                        "CREATE TABLE story_character_emotion_generation_jobs (id INTEGER PRIMARY KEY)"
                    )
                    seed_connection.execute(
                        "CREATE TABLE story_message_segments (id INTEGER PRIMARY KEY)"
                    )
                    # Simulate the first VN beat schema, before per-paragraph scene casts.
                    seed_connection.execute(
                        "CREATE TABLE story_novel_beats ("
                        "id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL, "
                        "message_id INTEGER NOT NULL, order_index INTEGER NOT NULL, "
                        "kind VARCHAR(16) NOT NULL DEFAULT 'narration', "
                        "speaker_name VARCHAR(160), speaker_character_id INTEGER, "
                        "emotion VARCHAR(24), text TEXT NOT NULL DEFAULT '', "
                        "created_at TIMESTAMP, updated_at TIMESTAMP)"
                    )
                    seed_connection.commit()
                finally:
                    seed_connection.close()

                bootstrap_database(
                    database_url=settings.database_url,
                    defaults=StoryBootstrapDefaults(
                        context_limit_tokens=STORY_DEFAULT_CONTEXT_LIMIT_TOKENS,
                        response_max_tokens=STORY_DEFAULT_RESPONSE_MAX_TOKENS,
                        private_visibility=STORY_GAME_VISIBILITY_PRIVATE,
                        world_kind=STORY_WORLD_CARD_KIND_WORLD,
                        npc_kind=STORY_WORLD_CARD_KIND_NPC,
                        main_hero_kind=STORY_WORLD_CARD_KIND_MAIN_HERO,
                        memory_turns_default=STORY_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
                        memory_turns_npc=STORY_WORLD_CARD_NPC_TRIGGER_ACTIVE_TURNS,
                        memory_turns_always=STORY_WORLD_CARD_MEMORY_TURNS_ALWAYS,
                    ),
                )

                connection = sqlite3.connect(raw_path)
                try:
                    game_columns = {row[1] for row in connection.execute("PRAGMA table_info(story_games)")}
                    assert "game_mode" in game_columns, game_columns
                    assert "display_mode" not in game_columns, game_columns
                    assert "emotion_visualization_enabled" not in game_columns, game_columns

                    character_columns = {
                        row[1] for row in connection.execute("PRAGMA table_info(story_characters)")
                    }
                    assert "novel_sprite_gender" in character_columns, character_columns
                    assert "emotion_model" not in character_columns, character_columns
                    assert "emotion_prompt_lock" not in character_columns, character_columns

                    table_names = {
                        row[0]
                        for row in connection.execute(
                            "SELECT name FROM sqlite_master WHERE type = 'table'"
                        )
                    }
                    assert "story_novel_beats" in table_names, table_names
                    assert "story_scene_backgrounds" in table_names, table_names
                    assert "story_place_templates" in table_names, table_names
                    assert "story_character_emotion_generation_jobs" not in table_names, table_names
                    assert "story_message_segments" not in table_names, table_names
                    novel_beat_columns = {
                        row[1] for row in connection.execute("PRAGMA table_info(story_novel_beats)")
                    }
                    assert "scene_characters_json" in novel_beat_columns, novel_beat_columns
                finally:
                    connection.close()
                """
            )

            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=backend_root,
                env=env,
                text=True,
                capture_output=True,
                timeout=90,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
            )


if __name__ == "__main__":
    unittest.main()
