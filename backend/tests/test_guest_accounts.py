"""Guest pseudo-accounts: issuing, resuming, the anti-abuse rules and the merge into an account."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.database import Base
from app.models import AccountDeviceMark, GuestSession, StoryCharacter, StoryGame, User
from app.routers import account as account_router
from app.routers import auth as auth_router
from app.routers import payments as payments_router
from app.routers import story_games as story_games_router
from app.schemas import (
    CoinTopUpCreateRequest,
    GuestSessionStartRequest,
    LoginRequest,
    RegisterVerifyRequest,
    StoryGameMetaUpdateRequest,
)
from app.security import hash_password, safe_decode_access_token
from app.services import guest_accounts
from app.services.guest_access import (
    ACCOUNT_REQUIRED_HEADER,
    GUEST_DEVICE_COOKIE,
    GuestAccountRequiredMiddleware,
    resolve_request_client_ip,
)
from app.models import EmailVerification


def _session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record) -> None:  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    return Session(bind=engine, future=True, expire_on_commit=False)


def _request(*, ip: str = "203.0.113.10", forwarded_for: str | None = None, scheme: str = "http") -> Request:
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode("latin-1")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/guest/session",
            "headers": headers,
            "client": (ip, 51000),
            "scheme": scheme,
            "server": ("testserver", 80),
            "query_string": b"",
        }
    )


def _cookie_from(response: Response) -> str:
    for raw_header in response.headers.getlist("set-cookie"):
        if raw_header.startswith(f"{GUEST_DEVICE_COOKIE}="):
            return raw_header.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError("device cookie was not set")


def _start(db: Session, *, cookie: str | None = None, device_id: str | None = None, ip: str = "203.0.113.10", token: str | None = None):
    response = Response()
    result = account_router.start_guest_session_route(
        GuestSessionStartRequest(device_id=device_id),
        _request(ip=ip),
        response,
        guest_token=token,
        device_cookie=cookie,
        db=db,
    )
    return result, response


def _real_user(db: Session, *, email: str, password: str | None = "correct horse", coins: int = 55) -> User:
    user = User(
        email=email,
        display_name=email.split("@", 1)[0],
        password_hash=hash_password(password) if password else None,
        auth_provider="email",
        coins=coins,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_a_new_browser_gets_a_numbered_guest_with_the_starter_sols() -> None:
    db = _session()
    first, first_response = _start(db, device_id="device-aaaaaaaaaaaaaaaaaaaa")
    assert first.status == "ok"
    guest_user = first.auth.user
    assert guest_user.is_guest is True
    assert guest_user.display_name == f"Гость №{guest_user.guest_number}"
    assert guest_user.coins == guest_accounts.GUEST_STARTER_COINS
    claims = safe_decode_access_token(first.auth.access_token)
    assert claims and claims.get("guest") is True
    assert _cookie_from(first_response)

    second, _ = _start(db, device_id="device-bbbbbbbbbbbbbbbbbbbb", ip="198.51.100.20")
    assert second.auth.user.guest_number == guest_user.guest_number + 1


def test_the_same_browser_gets_its_own_guest_back_with_what_it_has_left() -> None:
    db = _session()
    first, response = _start(db, device_id="device-aaaaaaaaaaaaaaaaaaaa")
    cookie = _cookie_from(response)
    guest = db.get(User, first.auth.user.id)
    guest.coins = 7
    db.commit()

    by_cookie, _ = _start(db, cookie=cookie)
    assert by_cookie.status == "ok"
    assert by_cookie.auth.user.id == first.auth.user.id
    assert by_cookie.auth.user.coins == 7

    # localStorage survived a cookie wipe
    by_device_id, _ = _start(db, device_id="device-aaaaaaaaaaaaaaaaaaaa", ip="198.51.100.77")
    assert by_device_id.auth.user.id == first.auth.user.id

    by_token, _ = _start(db, token=first.auth.access_token, ip="192.0.2.99")
    assert by_token.auth.user.id == first.auth.user.id
    assert db.scalar(select(func.count()).select_from(User).where(User.is_guest.is_(True))) == 1


def test_a_browser_that_signed_in_to_an_account_is_sent_to_the_login_form() -> None:
    db = _session()
    account = _real_user(db, email="owner@example.com")
    guest_accounts.remember_account_device(
        db,
        user=account,
        device_cookie=None,
        client_device_id="device-cccccccccccccccccccc",
    )
    db.commit()

    result, _ = _start(db, device_id="device-cccccccccccccccccccc")
    assert result.status == "login_required"
    assert result.reason == guest_accounts.GUEST_REFUSAL_ACCOUNT_EXISTS
    assert result.auth is None
    assert db.scalar(select(func.count()).select_from(User).where(User.is_guest.is_(True))) == 0


def test_one_network_cannot_farm_guests() -> None:
    db = _session()
    for index in range(guest_accounts.GUEST_LIMIT_PER_NETWORK_PER_DAY):
        result, _ = _start(db, device_id=f"device-net-{index:016d}", ip="203.0.113.44")
        assert result.status == "ok"
    refused, _ = _start(db, device_id="device-net-9999999999999999", ip="203.0.113.44")
    assert refused.status == "login_required"
    assert refused.reason == guest_accounts.GUEST_REFUSAL_NETWORK_LIMIT

    # The same phone rotating inside its IPv6 /64 is still the same network.
    for index in range(guest_accounts.GUEST_LIMIT_PER_NETWORK_PER_DAY):
        result, _ = _start(db, device_id=f"device-v6-{index:016d}", ip=f"2001:db8:1:2::{index + 1}")
        assert result.status == "ok"
    refused_v6, _ = _start(db, device_id="device-v6-9999999999999999", ip="2001:db8:1:2::ffff")
    assert refused_v6.reason == guest_accounts.GUEST_REFUSAL_NETWORK_LIMIT


def test_the_monthly_network_limit_outlives_the_daily_one() -> None:
    db = _session()
    today = datetime.now(timezone.utc)
    limit = guest_accounts.GUEST_LIMIT_PER_NETWORK_PER_MONTH
    # One guest a week, oldest first: the daily limit never trips, the monthly one fills up.
    for index in range(limit):
        result = guest_accounts.start_guest_session(
            db,
            guest_token=None,
            device_cookie=None,
            client_device_id=f"device-old-{index:016d}",
            client_ip="198.51.100.5",
            now=today - timedelta(days=7 * (limit - index)),
        )
        assert result.status == "ok"
    db.commit()
    refused, _ = _start(db, device_id="device-old-9999999999999999", ip="198.51.100.5")
    assert refused.reason == guest_accounts.GUEST_REFUSAL_NETWORK_LIMIT


def test_forged_forwarded_for_cannot_pick_a_fresh_network() -> None:
    # The client writes the left side itself; our proxy appends the real peer on the right,
    # and the docker hop behind it is ours too.
    request = _request(ip="10.0.0.2", forwarded_for="8.8.8.8, 93.184.216.34, 172.18.0.5")
    assert resolve_request_client_ip(request) == "93.184.216.34"
    assert resolve_request_client_ip(_request(ip="127.0.0.1")) == "127.0.0.1"


def _add_world(db: Session, user_id: int, title: str = "Мир гостя") -> StoryGame:
    game = StoryGame(user_id=user_id, title=title)
    db.add(game)
    db.commit()
    return game


def test_signing_in_takes_the_guest_along_but_not_its_free_sols() -> None:
    db = _session()
    account = _real_user(db, email="player@example.com", coins=55)
    started, response = _start(db, device_id="device-dddddddddddddddddddd")
    guest_id = started.auth.user.id
    world = _add_world(db, guest_id)
    db.add(StoryCharacter(user_id=guest_id, name="Спутник", description="Верный друг"))
    db.commit()

    login_response = Response()
    result = auth_router.login(
        LoginRequest(email="player@example.com", password="correct horse"),
        _request(),
        login_response,
        guest_token=started.auth.access_token,
        device_id="device-dddddddddddddddddddd",
        device_cookie=_cookie_from(response),
        db=db,
    )
    assert result.merged_guest is not None
    assert result.merged_guest.worlds == 1
    assert result.merged_guest.characters == 1
    assert result.merged_guest.coins_transferred == 0
    assert result.user.coins == 55
    assert db.get(StoryGame, world.id).user_id == account.id
    assert db.get(User, guest_id) is None

    session_row = db.scalar(select(GuestSession).where(GuestSession.converted_user_id == account.id))
    assert session_row is not None and session_row.status == guest_accounts.GUEST_SESSION_CONVERTED
    # From now on this browser "has an account".
    again, _ = _start(db, device_id="device-dddddddddddddddddddd")
    assert again.status == "login_required"


def test_a_new_account_inherits_what_the_guest_has_left_instead_of_a_second_grant() -> None:
    db = _session()
    started, response = _start(db, device_id="device-eeeeeeeeeeeeeeeeeeee")
    guest = db.get(User, started.auth.user.id)
    guest.coins = 12
    db.commit()
    _add_world(db, guest.id)

    db.add(
        EmailVerification(
            email="newcomer@example.com",
            code_hash=hash_password("123456"),
            password_hash=hash_password("new password"),
            display_name="Новичок",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            attempts_left=5,
        )
    )
    db.commit()

    result = auth_router.verify_registration(
        RegisterVerifyRequest(email="newcomer@example.com", code="123456"),
        _request(),
        Response(),
        guest_token=started.auth.access_token,
        device_id="device-eeeeeeeeeeeeeeeeeeee",
        device_cookie=_cookie_from(response),
        db=db,
    )
    assert result.is_new_user is True
    assert result.user.coins == 12
    assert result.merged_guest is not None
    assert result.merged_guest.coins_transferred == 12
    assert result.merged_guest.worlds == 1
    assert db.scalar(select(func.count()).select_from(User).where(User.is_guest.is_(True))) == 0


def test_guest_numbers_keep_counting_after_a_guest_is_merged_away() -> None:
    db = _session()
    first, _ = _start(db, device_id="device-ffffffffffffffffffff")
    account = _real_user(db, email="merge-target@example.com")
    guest_accounts.absorb_guest_into_account(db, guest=db.get(User, first.auth.user.id), account=account, account_is_new=False)
    db.commit()
    second, _ = _start(db, device_id="device-gggggggggggggggggggg", ip="192.0.2.1")
    assert second.auth.user.guest_number == first.auth.user.guest_number + 1


def test_an_erased_guest_comes_back_with_its_old_balance_not_a_fresh_grant() -> None:
    from app.services.account_lifecycle import delete_user_account

    db = _session()
    started, response = _start(db, device_id="device-hhhhhhhhhhhhhhhhhhhh")
    guest = db.get(User, started.auth.user.id)
    guest.coins = 3
    db.commit()
    delete_user_account(db, user=guest)
    db.commit()

    returned, _ = _start(db, cookie=_cookie_from(response))
    assert returned.status == "ok"
    assert returned.auth.user.coins == 3
    assert returned.auth.user.guest_number == started.auth.user.guest_number + 1


def _raises_account_required(call) -> str:
    with pytest.raises(HTTPException) as caught:
        call()
    assert caught.value.status_code == 403
    return caught.value.headers[ACCOUNT_REQUIRED_HEADER]


def test_a_guest_cannot_pay_publish_or_change_settings() -> None:
    db = _session()
    started, _ = _start(db, device_id="device-iiiiiiiiiiiiiiiiiiii")
    bearer = f"Bearer {started.auth.access_token}"
    world = _add_world(db, started.auth.user.id)

    assert _raises_account_required(
        lambda: payments_router.create_coin_top_up_payment(
            CoinTopUpCreateRequest(plan_id="standard"),
            authorization=bearer,
            db=db,
        )
    ) == "shop"
    assert _raises_account_required(
        lambda: story_games_router.update_story_game_meta(
            world.id,
            StoryGameMetaUpdateRequest(visibility="public"),
            authorization=bearer,
            db=db,
        )
    ) == "publish"
    from app.schemas import ProfileUpdateRequest

    assert _raises_account_required(
        lambda: auth_router.update_profile(ProfileUpdateRequest(display_name="Хакер"), authorization=bearer, db=db)
    ) == "settings"
    assert _raises_account_required(lambda: auth_router.claim_my_daily_reward(authorization=bearer, db=db)) == "rewards"

    # Keeping a world private is still fine.
    story_games_router.update_story_game_meta(
        world.id,
        StoryGameMetaUpdateRequest(title="Переименованный мир"),
        authorization=bearer,
        db=db,
    )


def _run_middleware(authorization: str | None) -> dict:
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 402, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"detail":"no sols"}'})

    messages: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    headers = [(b"authorization", authorization.encode("latin-1"))] if authorization else []
    scope = {"type": "http", "method": "POST", "path": "/api/story/games/1/generate", "headers": headers}
    asyncio.run(GuestAccountRequiredMiddleware(app)(scope, receive, send))
    return {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in messages[0]["headers"]}


def test_running_out_of_sols_tells_a_guest_to_register_and_nobody_else() -> None:
    db = _session()
    started, _ = _start(db, device_id="device-jjjjjjjjjjjjjjjjjjjj")
    guest_headers = _run_middleware(f"Bearer {started.auth.access_token}")
    assert guest_headers.get(ACCOUNT_REQUIRED_HEADER.lower()) == "sols"

    account = _real_user(db, email="payer@example.com")
    account_token = auth_router.issue_auth_response(account).access_token
    assert ACCOUNT_REQUIRED_HEADER.lower() not in _run_middleware(f"Bearer {account_token}")
    assert ACCOUNT_REQUIRED_HEADER.lower() not in _run_middleware(None)


def test_guest_placeholder_addresses_cannot_be_registered() -> None:
    from app.schemas import RegisterRequest

    db = _session()
    with pytest.raises(HTTPException) as caught:
        auth_router.register(
            RegisterRequest(
                email="guest-1-abcdef@guest.morius-ai.ru",
                password="password123",
                accepted_terms=True,
                accepted_age=True,
            ),
            db=db,
        )
    assert caught.value.status_code == 400


def test_device_marks_are_only_written_for_real_accounts() -> None:
    db = _session()
    started, _ = _start(db, device_id="device-kkkkkkkkkkkkkkkkkkkk")
    guest_accounts.remember_account_device(
        db,
        user=db.get(User, started.auth.user.id),
        device_cookie=None,
        client_device_id="device-kkkkkkkkkkkkkkkkkkkk",
    )
    db.commit()
    assert db.scalar(select(func.count()).select_from(AccountDeviceMark)) == 0


# ------------------------------------------------------------------------------ a turn's own stream
#
# A turn answers 200 and reports its failures as `error` frames, so the 402 middleware never sees
# a guest running out of sols mid-game. The frame itself has to carry the same instruction.


class _TurnSession:
    """Just enough of a Session for the turn stream to reach its billing step."""

    def __init__(self) -> None:
        self.next_id = 900

    def add(self, value: object) -> None:
        if getattr(value, "id", None) is None:
            setattr(value, "id", self.next_id)
            self.next_id += 1

    def commit(self) -> None:
        return

    def rollback(self) -> None:
        return

    def refresh(self, _value: object) -> None:
        return

    def delete(self, _value: object) -> None:
        return

    def execute(self, *_args: object, **_kwargs: object) -> None:
        return

    def close(self) -> None:
        return


def _error_payload(frames: list[str]) -> dict:
    import json

    frame = next(frame for frame in frames if frame.startswith("event: error"))
    return json.loads(frame.split("data: ", 1)[1])


def _turn_refused_before_streaming(authorization: str | None, refusal: HTTPException) -> dict:
    """The generate endpoint, with a turn the up-front balance check refuses."""
    from types import SimpleNamespace
    from unittest.mock import patch

    from app.services import story_runtime

    class _Lease:
        def release(self) -> None:
            return

    with (
        patch.object(story_runtime, "SessionLocal", return_value=_TurnSession()),
        patch.object(story_runtime, "acquire_story_game_operation_lock", return_value=_Lease()),
        patch.object(story_runtime, "_generate_story_response_locked", side_effect=refusal),
    ):
        response = story_runtime.generate_story_response(
            deps=SimpleNamespace(validate_provider_config=lambda: None),
            game_id=41,
            payload=SimpleNamespace(),
            authorization=authorization,
            db=_TurnSession(),
        )

        async def drain() -> list[str]:
            return [str(chunk) async for chunk in response.body_iterator]

        return _error_payload(asyncio.run(drain()))


def _turn_refused_at_billing(user: object) -> dict:
    """A turn whose text was generated and whose charge then failed for lack of sols."""
    from types import SimpleNamespace
    from unittest.mock import patch

    from app.services import story_runtime
    from app.services.story_generation_cancel import mark_story_generation_finished, mark_story_generation_started

    game_id = 9_300 + int(getattr(user, "id"))
    generation_id = f"guest-billing-{getattr(user, 'id')}"
    deps = SimpleNamespace(
        stream_persist_min_chars=10_000,
        stream_persist_max_interval_seconds=60.0,
        story_assistant_role="assistant",
        touch_story_game=lambda _game: None,
        stream_story_provider_chunks=lambda **_kwargs: iter(["Ответ рассказчика."]),
        spend_user_tokens_if_sufficient=lambda *_args, **_kwargs: False,
    )
    mark_story_generation_started(game_id, generation_id)
    try:
        with patch.object(story_runtime, "_checkpoint_story_raw_turn_memory", return_value=True):
            frames = list(
                story_runtime._stream_story_response(
                    deps=deps,
                    db=_TurnSession(),
                    game=SimpleNamespace(id=game_id),
                    user=user,
                    turn_cost_tokens=10,
                    source_user_message=None,
                    prompt="Ход",
                    turn_index=1,
                    context_messages=[],
                    instruction_cards=[],
                    plot_cards=[],
                    world_cards=[],
                    all_world_cards=[],
                    context_limit_chars=10_000,
                    story_model_name=None,
                    story_response_max_tokens=None,
                    story_temperature=0.7,
                    story_repetition_penalty=1.0,
                    story_top_k=40,
                    story_top_r=0.9,
                    memory_optimization_enabled=False,
                    reroll_discarded_assistant_text=None,
                    ambient_enabled=False,
                    visual_novel_enabled=False,
                    show_gg_thoughts=False,
                    show_npc_thoughts=False,
                    story_generation_id=generation_id,
                )
            )
    finally:
        mark_story_generation_finished(game_id, generation_id)
    return _error_payload(frames)


def test_a_turn_refused_for_sols_up_front_tells_a_guest_to_register() -> None:
    db = _session()
    started, _ = _start(db, device_id="device-llllllllllllllllllll")
    out_of_sols = HTTPException(status_code=402, detail="Недостаточно солов для хода")

    assert _turn_refused_before_streaming(f"Bearer {started.auth.access_token}", out_of_sols) == {
        "detail": "Недостаточно солов для хода",
        "status_code": 402,
        "account_required": "sols",
    }

    account = _real_user(db, email="reader@example.com")
    account_token = auth_router.issue_auth_response(account).access_token
    assert _turn_refused_before_streaming(f"Bearer {account_token}", out_of_sols) == {
        "detail": "Недостаточно солов для хода",
        "status_code": 402,
    }

    # Any other failure is only an error, for a guest as well.
    busy = HTTPException(status_code=409, detail="История занята")
    assert "account_required" not in _turn_refused_before_streaming(f"Bearer {started.auth.access_token}", busy)


def test_a_turn_refused_for_sols_at_billing_tells_a_guest_to_register() -> None:
    from types import SimpleNamespace

    assert _turn_refused_at_billing(SimpleNamespace(id=61, coins=0, is_guest=True)) == {
        "detail": "Недостаточно солов для хода",
        "status_code": 402,
        "account_required": "sols",
    }
    assert _turn_refused_at_billing(SimpleNamespace(id=62, coins=0, is_guest=False)) == {
        "detail": "Недостаточно солов для хода",
        "status_code": 402,
    }
