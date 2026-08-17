from __future__ import annotations

import dataclasses
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cozy import routers  # noqa: E402,F401
from app.cozy.database import CozyBase  # noqa: E402
from app.cozy.models import CozyPlayer, CozyPurchase, CozySave  # noqa: E402
from app.cozy.routers import auth as cozy_auth  # noqa: E402
from app.cozy.routers import payments as cozy_payments  # noqa: E402
from app.cozy.routers import save as cozy_save  # noqa: E402
from app.cozy.schemas import CodeIn, LoginIn, RegisterIn, ResetIn, ResetVerifyIn, SaveIn  # noqa: E402
from app.cozy.security import current_player  # noqa: E402
from app.security import create_access_token  # noqa: E402


class _FakeResponse:
    """Google, as far as the code exchange can tell."""

    def __init__(self, payload: dict, status_code: int) -> None:
        self._payload = payload
        self.status_code = status_code
        self.content = b"{}"

    def json(self) -> dict:
        return self._payload


class CozyBackendTests(unittest.TestCase):
    """The game's own auth and cloud save, exercised without a network or a mail server."""

    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        CozyBase.metadata.create_all(bind=self.engine)
        self.db = Session(bind=self.engine, future=True)
        self.codes: dict[str, str] = {}

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    # ------------------------------------------------------------------ helpers

    def _register(self, email: str = "player@example.com", password: str = "hunter22") -> CozyPlayer:
        def capture(recipient: str, code: str) -> None:
            self.codes[recipient] = code

        with patch.object(cozy_auth, "send_registration_code", side_effect=capture):
            cozy_auth.register(RegisterIn(email=email, password=password), db=self.db)

        auth = cozy_auth.register_verify(
            CodeIn(email=email, code=self.codes[email.strip().lower()]), db=self.db
        )
        self.token = auth.access_token
        return self.db.get(CozyPlayer, auth.player.id)

    # ------------------------------------------------------------------ registration

    def test_registration_needs_the_emailed_code(self) -> None:
        with patch.object(cozy_auth, "send_registration_code", side_effect=lambda e, c: self.codes.update({e: c})):
            cozy_auth.register(RegisterIn(email="Player@Example.COM", password="hunter22"), db=self.db)

        # Nothing exists until the code comes back.
        self.assertIsNone(self.db.query(CozyPlayer).first())

        with self.assertRaises(HTTPException) as wrong:
            cozy_auth.register_verify(CodeIn(email="player@example.com", code="000000"), db=self.db)
        self.assertEqual(wrong.exception.status_code, 400)

        auth = cozy_auth.register_verify(
            CodeIn(email="player@example.com", code=self.codes["player@example.com"]), db=self.db
        )
        self.assertTrue(auth.is_new_player)
        self.assertEqual(auth.player.email, "player@example.com")

    def test_resend_is_rate_limited(self) -> None:
        with patch.object(cozy_auth, "send_registration_code", side_effect=lambda e, c: None):
            cozy_auth.register(RegisterIn(email="player@example.com", password="hunter22"), db=self.db)
            with self.assertRaises(HTTPException) as again:
                cozy_auth.register(RegisterIn(email="player@example.com", password="hunter22"), db=self.db)
        self.assertEqual(again.exception.status_code, 429)

    def test_login_checks_the_password(self) -> None:
        self._register()

        with self.assertRaises(HTTPException) as wrong:
            cozy_auth.login(LoginIn(email="player@example.com", password="nope"), db=self.db)
        self.assertEqual(wrong.exception.status_code, 401)

        auth = cozy_auth.login(LoginIn(email="player@example.com", password="hunter22"), db=self.db)
        self.assertFalse(auth.is_new_player)

    def test_password_reset_keeps_the_village(self) -> None:
        player = self._register()
        cozy_save.write_save(SaveIn(payload="sum\n{}", play_seconds=99), player=player, db=self.db)

        with patch.object(cozy_auth, "send_password_reset_code", side_effect=lambda e, c: self.codes.update({e: c})):
            cozy_auth.password_reset(ResetIn(email="player@example.com"), db=self.db)

        cozy_auth.password_reset_verify(
            ResetVerifyIn(
                email="player@example.com",
                code=self.codes["player@example.com"],
                password="newpass1",
            ),
            db=self.db,
        )

        cozy_auth.login(LoginIn(email="player@example.com", password="newpass1"), db=self.db)
        self.assertTrue(cozy_save.read_save(player=player, db=self.db).exists)

    def test_reset_for_an_unknown_address_says_nothing(self) -> None:
        # Answering honestly here would turn the endpoint into a way to test which addresses have
        # accounts.
        answer = cozy_auth.password_reset(ResetIn(email="nobody@example.com"), db=self.db)
        self.assertEqual(answer.message, cozy_auth.RESET_SENT_MESSAGE)

    # ------------------------------------------------------------------ tokens

    def test_a_morius_token_cannot_open_a_cozy_account(self) -> None:
        """The whole reason the token carries an audience: same secret, two products."""
        player = self._register()
        morius_token = create_access_token(subject=str(player.id), claims={"email": player.email})

        with self.assertRaises(HTTPException) as refused:
            current_player(authorization=f"Bearer {morius_token}", db=self.db)
        self.assertEqual(refused.exception.status_code, 401)

        # The game's own token for the same player is accepted.
        self.assertEqual(current_player(authorization=f"Bearer {self.token}", db=self.db).id, player.id)

    def test_a_missing_token_is_refused(self) -> None:
        with self.assertRaises(HTTPException) as refused:
            current_player(authorization=None, db=self.db)
        self.assertEqual(refused.exception.status_code, 401)

    # ------------------------------------------------------------------ cloud saves

    def test_push_and_pull(self) -> None:
        player = self._register()
        self.assertFalse(cozy_save.read_save(player=player, db=self.db).exists)

        first = cozy_save.write_save(
            SaveIn(payload="sum\n{\"a\":1}", save_version=17, play_seconds=3600, base_revision=0),
            player=player,
            db=self.db,
        )
        self.assertTrue(first.accepted)
        self.assertEqual(first.revision, 1)

        stored = cozy_save.read_save(player=player, db=self.db)
        self.assertEqual(stored.play_seconds, 3600)
        self.assertEqual(stored.save_version, 17)

    def test_a_stale_push_is_a_conflict_and_a_forced_one_is_not(self) -> None:
        """A reinstall reports revision zero, and that must not silently flatten a live village."""
        player = self._register()
        cozy_save.write_save(SaveIn(payload="one\n{}", play_seconds=3600), player=player, db=self.db)

        stale = cozy_save.write_save(SaveIn(payload="two\n{}", base_revision=0), player=player, db=self.db)
        self.assertTrue(stale.conflict)
        self.assertFalse(stale.accepted)
        self.assertIsNotNone(stale.server)
        self.assertEqual(stale.server.play_seconds, 3600)

        forced = cozy_save.write_save(
            SaveIn(payload="two\n{}", base_revision=0, force=True), player=player, db=self.db
        )
        self.assertTrue(forced.accepted)
        self.assertEqual(forced.revision, 2)

    def test_an_empty_save_is_refused(self) -> None:
        player = self._register()
        with self.assertRaises(HTTPException) as refused:
            cozy_save.write_save(SaveIn(payload="   "), player=player, db=self.db)
        self.assertEqual(refused.exception.status_code, 400)

    def test_saves_belong_to_one_player(self) -> None:
        first = self._register(email="one@example.com")
        cozy_save.write_save(SaveIn(payload="one\n{}"), player=first, db=self.db)

        second = self._register(email="two@example.com")
        self.assertFalse(cozy_save.read_save(player=second, db=self.db).exists)
        self.assertEqual(self.db.query(CozySave).count(), 1)

    # ------------------------------------------------------------------ google

    @staticmethod
    def _google_settings(**overrides: str):
        """Settings with Google filled in.

        Replaced whole rather than field by field: CozySettings is a frozen dataclass, which is
        the right shape for something read from the environment once and never written - and it
        means a test has to build a new one instead of poking at the live one.
        """
        return dataclasses.replace(
            cozy_auth.settings,
            google_client_id=overrides.get("client_id", "cozy-test-client"),
            google_client_secret=overrides.get("client_secret", "cozy-test-secret"),
            google_redirect_uri=overrides.get(
                "redirect_uri", "https://example.test/api/cozy/auth/google/callback"
            ),
        )

    def _google_round_trip(self, claims: dict, *, state: str | None = None) -> str:
        """Drives start -> callback -> poll with Google itself replaced.

        Everything on this path is ours except two HTTP calls, and those two are the only part a
        test cannot honestly run. So they are stubbed and the rest is real: the ticket table, the
        single-use rule, the subject-before-email matching and the token that comes out.
        """
        with patch.object(cozy_auth, "settings", self._google_settings()):
            if state is None:
                start = cozy_auth.google_start(db=self.db)
                state = start.state
                self.assertIn("cozy-test-client", start.auth_url)
                self.assertIn("prompt=select_account", start.auth_url)

            exchange = _FakeResponse({"id_token": "fake-id-token"}, 200)
            with patch.object(cozy_auth.requests, "post", return_value=exchange), patch.object(
                cozy_auth, "_verify_google_id_token", return_value=claims
            ):
                page = cozy_auth.google_callback(state=state, code="fake-code", db=self.db)
                self.assertEqual(page.status_code, 200)

        return state

    def test_google_creates_a_player_and_the_ticket_is_single_use(self) -> None:
        state = self._google_round_trip({"sub": "g-1", "email": "Gamer@Gmail.COM", "name": "Gamer"})

        answer = cozy_auth.google_poll(state=state, db=self.db)
        self.assertEqual(answer.status, "ready")
        self.assertIsNotNone(answer.auth)
        self.assertTrue(answer.auth.is_new_player)
        self.assertEqual(answer.auth.player.email, "gamer@gmail.com")
        self.assertEqual(answer.auth.player.provider, "google")

        # The token works, which is the whole point of the round trip.
        player = current_player(authorization=f"Bearer {answer.auth.access_token}", db=self.db)
        self.assertEqual(player.email, "gamer@gmail.com")

        # Asked twice, answered once: a ticket that keeps replying is a session token sitting in a
        # table under a guessable name.
        again = cozy_auth.google_poll(state=state, db=self.db)
        self.assertEqual(again.status, "failed")

    def test_google_polls_pending_until_the_browser_comes_back(self) -> None:
        with patch.object(cozy_auth, "settings", self._google_settings()):
            start = cozy_auth.google_start(db=self.db)

        # This is what the app sees for most of a minute while somebody types a password.
        self.assertEqual(cozy_auth.google_poll(state=start.state, db=self.db).status, "pending")

    def test_google_matches_on_subject_not_on_address(self) -> None:
        """An address can change hands; the subject is what Google promises stays the same."""
        first = self._google_round_trip({"sub": "g-7", "email": "old@gmail.com"})
        created = cozy_auth.google_poll(state=first, db=self.db).auth.player.id

        second = self._google_round_trip({"sub": "g-7", "email": "renamed@gmail.com"})
        answer = cozy_auth.google_poll(state=second, db=self.db)

        self.assertFalse(answer.auth.is_new_player)
        self.assertEqual(answer.auth.player.id, created)
        self.assertEqual(self.db.query(CozyPlayer).count(), 1)

    def test_google_links_to_an_existing_password_account(self) -> None:
        """Same person, one village. Two accounts would be two, and only one holds it."""
        player = self._register(email="both@example.com")
        cozy_save.write_save(SaveIn(payload="village\n{}", play_seconds=500), player=player, db=self.db)

        state = self._google_round_trip({"sub": "g-9", "email": "both@example.com"})
        answer = cozy_auth.google_poll(state=state, db=self.db)

        self.assertEqual(answer.auth.player.id, player.id)
        self.assertEqual(answer.auth.player.provider, "email+google")
        self.assertEqual(self.db.query(CozyPlayer).count(), 1)

        # And the village is still theirs.
        self.assertTrue(cozy_save.read_save(player=player, db=self.db).exists)

        # Both doors still open.
        cozy_auth.login(LoginIn(email="both@example.com", password="hunter22"), db=self.db)

    def test_a_cancelled_google_login_fails_cleanly(self) -> None:
        with patch.object(cozy_auth, "settings", self._google_settings()):
            start = cozy_auth.google_start(db=self.db)

        cozy_auth.google_callback(state=start.state, error="access_denied", db=self.db)

        answer = cozy_auth.google_poll(state=start.state, db=self.db)
        self.assertEqual(answer.status, "failed")
        self.assertTrue(answer.error)

    def test_a_list_of_client_ids_still_makes_one_consent_url(self) -> None:
        """MoRius keeps several client ids in one variable; a consent URL may carry exactly one.

        Handing Google the whole comma-separated string produces a link it refuses, and the game
        inherits that variable by default - so this is the shape the real deployment has, not a
        hypothetical one.
        """
        pair = "111-aaa.apps.googleusercontent.com,222-bbb.apps.googleusercontent.com"

        with patch.object(cozy_auth, "settings", self._google_settings(client_id=pair)):
            start = cozy_auth.google_start(db=self.db)

            self.assertIn("client_id=111-aaa.apps.googleusercontent.com", start.auth_url)
            self.assertNotIn("%2C", start.auth_url)
            self.assertNotIn("222-bbb", start.auth_url)

            # The second one is still trusted - a token minted by it belongs to the same people.
            self.assertEqual(len(cozy_auth.settings.google_client_ids), 2)

    def test_a_token_from_another_client_is_refused(self) -> None:
        state = self._google_round_trip({"sub": "g-3", "email": "someone@gmail.com"})
        self.assertEqual(cozy_auth.google_poll(state=state, db=self.db).status, "ready")

        # Same flow, but Google hands back a token minted for somebody else's app.
        with patch.object(cozy_auth, "settings", self._google_settings()):
            start = cozy_auth.google_start(db=self.db)
            exchange = _FakeResponse({"id_token": "fake"}, 200)
            with patch.object(cozy_auth.requests, "post", return_value=exchange), patch.object(
                cozy_auth.requests,
                "get",
                return_value=_FakeResponse(
                    {"sub": "g-4", "email": "evil@gmail.com", "aud": "somebody-else"}, 200
                ),
            ):
                cozy_auth.google_callback(state=start.state, code="c", db=self.db)

        self.assertEqual(cozy_auth.google_poll(state=start.state, db=self.db).status, "failed")

    def test_google_says_which_setting_is_missing(self) -> None:
        """Four things can be wrong and three of them are in a console. Name the one that is."""
        with patch.object(cozy_auth, "settings", self._google_settings(client_secret="")):
            with self.assertRaises(HTTPException) as refused:
                cozy_auth.google_start(db=self.db)

        self.assertEqual(refused.exception.status_code, 503)
        self.assertIn("client secret", refused.exception.detail)
        self.assertNotIn("client id", refused.exception.detail)

    # ------------------------------------------------------------------ payments

    def test_buying_without_a_till_is_refused_out_loud(self) -> None:
        player = self._register()
        self.assertFalse(cozy_payments.payments_status().configured)

        with self.assertRaises(HTTPException) as refused:
            cozy_payments.create_purchase(
                cozy_payments.PurchaseCreateIn(product_id="1", gems=100, amount_roubles=149),
                player=player,
                db=self.db,
            )
        self.assertEqual(refused.exception.status_code, 503)

    def test_a_paid_purchase_is_handed_over_once(self) -> None:
        """Gems live in the save on the phone, so the server holds an entitlement, not a balance."""
        player = self._register()
        purchase = CozyPurchase(
            player_id=player.id, product_id="1", gems=100, amount_roubles=149, status="paid"
        )
        self.db.add(purchase)
        self.db.commit()

        pending = cozy_payments.pending_purchases(player=player, db=self.db)
        self.assertEqual([item.gems for item in pending.purchases], [100])

        cozy_payments.acknowledge_purchase(purchase.id, player=player, db=self.db)
        self.assertEqual(cozy_payments.pending_purchases(player=player, db=self.db).purchases, [])

    def test_one_player_cannot_collect_another_players_purchase(self) -> None:
        buyer = self._register(email="buyer@example.com")
        thief = self._register(email="thief@example.com")

        purchase = CozyPurchase(player_id=buyer.id, product_id="1", gems=100, amount_roubles=149, status="paid")
        self.db.add(purchase)
        self.db.commit()

        with self.assertRaises(HTTPException) as refused:
            cozy_payments.acknowledge_purchase(purchase.id, player=thief, db=self.db)
        self.assertEqual(refused.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
