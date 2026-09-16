from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryCharacter, StoryGame, User  # noqa: E402
from app.routers.dashboard_news import get_dashboard_stats, list_dashboard_news, reorder_dashboard_news  # noqa: E402
from app.schemas import DashboardNewsReorderRequest  # noqa: E402


class DashboardNewsOrderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_administrator_order_is_persisted_and_shared(self) -> None:
        with self.Session() as db:
            administrator = User(email="news-admin@example.com", role="administrator")
            db.add(administrator)
            db.commit()

            initial_response = Response()
            with patch("app.routers.dashboard_news.get_current_user", return_value=administrator):
                initial = list_dashboard_news(response=initial_response, authorization="Bearer admin", db=db)

            ordered_ids = [initial[2].id, initial[0].id, initial[1].id, *[item.id for item in initial[3:]]]
            reorder_response = Response()
            with patch("app.routers.dashboard_news.get_current_user", return_value=administrator):
                reordered = reorder_dashboard_news(
                    payload=DashboardNewsReorderRequest(ordered_ids=ordered_ids),
                    response=reorder_response,
                    authorization="Bearer admin",
                    db=db,
                )

            self.assertEqual([item.id for item in reordered], ordered_ids)
            self.assertEqual([item.slot for item in reordered], list(range(1, len(reordered) + 1)))
            self.assertEqual(reorder_response.headers["cache-control"], "no-store, max-age=0")

        # A new request/session represents another player or application worker.
        with self.Session() as db:
            player = User(email="news-player@example.com", role="user")
            db.add(player)
            db.commit()
            player_response = Response()
            with patch("app.routers.dashboard_news.get_current_user", return_value=player):
                shared = list_dashboard_news(response=player_response, authorization="Bearer player", db=db)

            self.assertEqual([item.id for item in shared], ordered_ids)
            self.assertEqual(player_response.headers["cache-control"], "no-store, max-age=0")

    def test_moderator_cannot_reorder_news(self) -> None:
        with self.Session() as db:
            moderator = User(email="news-moderator@example.com", role="moderator")
            db.add(moderator)
            db.commit()
            with patch("app.routers.dashboard_news.get_current_user", return_value=moderator):
                initial = list_dashboard_news(response=Response(), authorization="Bearer moderator", db=db)
                with self.assertRaises(HTTPException) as error:
                    reorder_dashboard_news(
                        payload=DashboardNewsReorderRequest(ordered_ids=[item.id for item in initial]),
                        response=Response(),
                        authorization="Bearer moderator",
                        db=db,
                    )
            self.assertEqual(error.exception.status_code, 403)

    def test_dashboard_stats_count_only_public_games_and_characters(self) -> None:
        with self.Session() as db:
            player = User(email="stats-player@example.com", role="user")
            second_player = User(email="stats-second@example.com", role="user")
            db.add_all([player, second_player])
            db.flush()
            db.add_all(
                [
                    StoryGame(user_id=player.id, title="Public game", visibility="public"),
                    StoryGame(user_id=player.id, title="Private game", visibility="private"),
                    StoryCharacter(user_id=player.id, name="Public character", description="Public", visibility="public"),
                    StoryCharacter(user_id=player.id, name="Private character", description="Private", visibility="private"),
                ]
            )
            db.commit()

            response = Response()
            with patch("app.routers.dashboard_news.get_current_user", return_value=player):
                stats = get_dashboard_stats(response=response, authorization="Bearer player", db=db)

            self.assertEqual(stats.published_games_count, 1)
            self.assertEqual(stats.published_characters_count, 1)
            self.assertEqual(stats.players_count, 2)
            self.assertEqual(response.headers["cache-control"], "no-store, max-age=0")


if __name__ == "__main__":
    unittest.main()
