from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import User, UserFollow  # noqa: E402
from app.routers.profiles import _build_profile_view, list_profile_connections  # noqa: E402


class ProfileConnectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_owner_can_list_followers_and_following(self) -> None:
        with self.Session() as db:
            owner = User(email="owner@example.com", display_name="Владелец", show_subscriptions=False)
            follower = User(email="follower@example.com", display_name="Подписчик")
            followed = User(email="followed@example.com", display_name="Автор")
            db.add_all([owner, follower, followed])
            db.flush()
            db.add_all(
                [
                    UserFollow(follower_user_id=follower.id, following_user_id=owner.id),
                    UserFollow(follower_user_id=owner.id, following_user_id=followed.id),
                ]
            )
            db.commit()

            with patch("app.routers.profiles.get_current_user", return_value=owner):
                followers = list_profile_connections(
                    user_id=owner.id,
                    connection_kind="followers",
                    limit=100,
                    offset=0,
                    authorization="Bearer owner",
                    db=db,
                )
                following = list_profile_connections(
                    user_id=owner.id,
                    connection_kind="following",
                    limit=100,
                    offset=0,
                    authorization="Bearer owner",
                    db=db,
                )

            self.assertEqual([(item.id, item.display_name) for item in followers], [(follower.id, "Подписчик")])
            self.assertEqual([(item.id, item.display_name) for item in following], [(followed.id, "Автор")])

    def test_other_viewer_cannot_read_private_relationship_lists(self) -> None:
        with self.Session() as db:
            owner = User(email="private-owner@example.com", show_subscriptions=False)
            viewer = User(email="viewer@example.com")
            followed = User(email="private-followed@example.com")
            db.add_all([owner, viewer, followed])
            db.flush()
            db.add(UserFollow(follower_user_id=owner.id, following_user_id=followed.id))
            db.commit()

            with patch("app.routers.profiles.get_current_user", return_value=viewer):
                for kind in ("followers", "following"):
                    with self.assertRaises(HTTPException) as error:
                        list_profile_connections(
                            user_id=owner.id,
                            connection_kind=kind,
                            limit=100,
                            offset=0,
                            authorization="Bearer viewer",
                            db=db,
                        )
                    self.assertEqual(error.exception.status_code, 403)

                private_view = _build_profile_view(db, viewer_user=viewer, target_user=owner)
                self.assertFalse(private_view.can_view_subscriptions)
                self.assertEqual(private_view.subscriptions_count, 0)
                self.assertEqual(private_view.subscriptions, [])

                owner.show_subscriptions = True
                db.commit()
                public_following = list_profile_connections(
                    user_id=owner.id,
                    connection_kind="following",
                    limit=100,
                    offset=0,
                    authorization="Bearer viewer",
                    db=db,
                )

            self.assertEqual([item.id for item in public_following], [followed.id])


if __name__ == "__main__":
    unittest.main()
