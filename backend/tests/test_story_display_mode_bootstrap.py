from __future__ import annotations

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest


class StoryDisplayModeBootstrapTests(unittest.TestCase):
    def test_bootstrap_adds_display_mode_column_to_sqlite_story_games(self) -> None:
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

                raw_path = settings.database_url.replace("sqlite:///", "")
                connection = sqlite3.connect(raw_path)
                try:
                    columns = {row[1] for row in connection.execute("PRAGMA table_info(story_games)")}
                    assert "display_mode" in columns, columns
                    assert "story_message_segments" in {
                        row[0]
                        for row in connection.execute(
                            "SELECT name FROM sqlite_master WHERE type = 'table'"
                        )
                    }
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
