from __future__ import annotations

from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    StoryCharacter,
    StoryGame,
    StoryInstructionTemplate,
    StoryWorldCardTemplate,
    User,
    UserGalleryImage,
)
from app.routers.profiles import _build_profile_view  # noqa: E402
from app.services.story_queries import (  # noqa: E402
    list_story_characters,
    list_story_instruction_templates,
)


class ProfilePaginationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="profile-pagination@example.com", display_name="Profile owner")
        self.db.add(self.user)
        self.db.flush()

        self.db.add_all(
            StoryGame(
                user_id=self.user.id,
                title=f"Game {index:02d}",
                visibility="public" if index < 4 else "private",
            )
            for index in range(15)
        )
        self.db.add_all(
            StoryCharacter(
                user_id=self.user.id,
                name=f"Character {index:02d}",
                description="Description",
                visibility="public" if index < 3 else "private",
            )
            for index in range(26)
        )
        self.db.add_all(
            StoryInstructionTemplate(
                user_id=self.user.id,
                title=f"Rule {index:02d}",
                content="Rule content",
                visibility="public" if index < 2 else "private",
            )
            for index in range(25)
        )
        self.db.add_all(
            StoryWorldCardTemplate(
                user_id=self.user.id,
                title=f"World card {index:02d}",
                content="World card content",
            )
            for index in range(6)
        )
        self.db.add_all(
            UserGalleryImage(user_id=self.user.id, model="image-model", prompt=f"Prompt {index:02d}")
            for index in range(11)
        )
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_profile_reports_full_totals_independent_of_initial_page_size(self) -> None:
        profile = _build_profile_view(self.db, viewer_user=self.user, target_user=self.user)

        self.assertEqual(profile.games_count, 15)
        self.assertEqual(profile.characters_count, 26)
        self.assertEqual(profile.instruction_templates_count, 25)
        self.assertEqual(profile.world_card_templates_count, 6)
        self.assertEqual(profile.gallery_images_count, 11)
        self.assertEqual(profile.published_worlds_count, 4)
        self.assertEqual(profile.published_characters_count, 3)
        self.assertEqual(profile.published_instruction_templates_count, 2)
        self.assertEqual(profile.unpublished_worlds_count, 11)

        self.assertEqual(len(profile.published_worlds), 4)
        self.assertEqual(len(profile.published_characters), 3)
        self.assertEqual(len(profile.published_instruction_templates), 2)
        self.assertEqual(len(profile.unpublished_worlds), 11)

    def test_character_and_rule_queries_keep_returning_twelve_item_pages(self) -> None:
        character_pages = [
            list_story_characters(
                self.db,
                self.user.id,
                limit=12,
                offset=offset,
                include_emotion_assets=False,
            )
            for offset in (0, 12, 24)
        ]
        rule_pages = [
            list_story_instruction_templates(self.db, self.user.id, limit=12, offset=offset)
            for offset in (0, 12, 24)
        ]

        self.assertEqual([len(page) for page in character_pages], [12, 12, 2])
        self.assertEqual([len(page) for page in rule_pages], [12, 12, 1])
        self.assertEqual(len({item.id for page in character_pages for item in page}), 26)
        self.assertEqual(len({item.id for page in rule_pages for item in page}), 25)


if __name__ == "__main__":
    unittest.main()
