from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.routers.admin import update_user_role  # noqa: E402
from app.schemas import AdminUserRoleUpdateRequest  # noqa: E402


class AdminBetaTesterRoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        self.db = Session(bind=self.engine, future=True)
        self.admin = User(email="admin-role-test@example.com", role="administrator")
        self.player = User(email="player-role-test@example.com", role="user")
        self.db.add_all([self.admin, self.player])
        self.db.commit()
        self.db.refresh(self.admin)
        self.db.refresh(self.player)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _update_role(self, role: str) -> None:
        with patch("app.routers.admin._require_administrator", return_value=self.admin):
            update_user_role(
                int(self.player.id),
                AdminUserRoleUpdateRequest(role=role),
                authorization=None,
                db=self.db,
            )
        self.db.refresh(self.player)

    def test_administrator_can_assign_and_revoke_beta_tester(self) -> None:
        self._update_role("beta_tester")
        self.assertEqual(self.player.role, "beta_tester")

        self._update_role("user")
        self.assertEqual(self.player.role, "user")


if __name__ == "__main__":
    unittest.main()
