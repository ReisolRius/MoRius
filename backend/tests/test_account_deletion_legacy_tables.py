"""Erasing an account must survive tables that outlived their model.

A database migrated in place keeps old tables with foreign keys to `users` -- `story_gallery_images`
(renamed to `user_gallery_images`) and `story_character_emotion_jobs` are both present in this
project's own database. `USER_REFERENCES` is built from the models, so it cannot know about them,
and the final `DELETE FROM users` fails on their foreign key. In production that surfaced as a bare
503 from the admin panel.

These tests build exactly that shape: a real schema plus a legacy table the models never describe.
"""
from __future__ import annotations

from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session as OrmSession

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.services import account_lifecycle  # noqa: E402
from app.services.account_lifecycle import delete_user_account  # noqa: E402

LEGACY_TABLES = (
    # (table, DDL) -- the two this project actually carries, plus their foreign key.
    (
        "story_gallery_images",
        """
        CREATE TABLE story_gallery_images (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            image_url VARCHAR(1024) NOT NULL DEFAULT ''
        )
        """,
    ),
    (
        "story_character_emotion_jobs",
        """
        CREATE TABLE story_character_emotion_jobs (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            status VARCHAR(32) NOT NULL DEFAULT 'queued'
        )
        """,
    ),
)


class AccountDeletionWithLegacyTablesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)

        @event.listens_for(self.engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record) -> None:  # pragma: no cover - driver hook
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(bind=self.engine)
        self.db = OrmSession(bind=self.engine, future=True)
        for _, ddl in LEGACY_TABLES:
            self.db.execute(text(ddl))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _make_user(self, email: str) -> User:
        user = User(email=email, password_hash="x")
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def test_legacy_rows_are_detected(self) -> None:
        found = dict(account_lifecycle._legacy_user_reference_columns(self.db))
        for table_name, _ in LEGACY_TABLES:
            with self.subTest(table=table_name):
                self.assertEqual(found.get(table_name), "user_id")

    def test_account_with_legacy_rows_can_still_be_erased(self) -> None:
        user = self._make_user("legacy-owner@example.com")
        user_id = int(user.id)
        self.db.execute(
            text("INSERT INTO story_gallery_images (user_id, image_url) VALUES (:uid, 'x')"),
            {"uid": user_id},
        )
        for _ in range(3):
            self.db.execute(
                text("INSERT INTO story_character_emotion_jobs (user_id) VALUES (:uid)"),
                {"uid": user_id},
            )
        self.db.commit()

        delete_user_account(self.db, user=user)
        self.db.commit()

        self.assertIsNone(self.db.get(User, user_id))
        for table_name, _ in LEGACY_TABLES:
            with self.subTest(table=table_name):
                left = self.db.execute(
                    text(f"SELECT COUNT(*) FROM {table_name} WHERE user_id = :uid"), {"uid": user_id}
                ).scalar_one()
                self.assertEqual(left, 0)

    def test_other_accounts_keep_their_legacy_rows(self) -> None:
        doomed = self._make_user("doomed@example.com")
        bystander = self._make_user("bystander@example.com")
        for owner in (doomed, bystander):
            self.db.execute(
                text("INSERT INTO story_character_emotion_jobs (user_id) VALUES (:uid)"),
                {"uid": int(owner.id)},
            )
        self.db.commit()
        bystander_id = int(bystander.id)

        delete_user_account(self.db, user=doomed)
        self.db.commit()

        left = self.db.execute(
            text("SELECT COUNT(*) FROM story_character_emotion_jobs WHERE user_id = :uid"),
            {"uid": bystander_id},
        ).scalar_one()
        self.assertEqual(left, 1)
        self.assertIsNotNone(self.db.get(User, bystander_id))


if __name__ == "__main__":
    unittest.main()
