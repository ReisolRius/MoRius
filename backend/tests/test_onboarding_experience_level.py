"""The level question has to be asked exactly once, so its answer must survive a round trip.

`onboarding_guide_state` is one JSON blob, written by older builds that knew nothing about a
level. These cover the two things that make "once" hold: an unanswered player reads back as
`None` (which is what makes the dialog appear), and an answer written once reads back unchanged -
including out of a blob that predates the field.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import User
from app.routers.auth import (
    _read_onboarding_guide_state,
    _serialize_onboarding_guide_state,
    _store_onboarding_guide_state,
)


def _session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(bind=engine)
    return Session(bind=engine, future=True, expire_on_commit=False)


def _user(db: Session, onboarding_guide_state: str) -> User:
    user = User(
        email="player@example.com",
        display_name="player",
        auth_provider="email",
        onboarding_guide_state=onboarding_guide_state,
    )
    db.add(user)
    db.flush()
    return user


def test_a_player_who_never_answered_reads_back_as_unanswered() -> None:
    with _session() as db:
        user = _user(db, "{}")
        state = _read_onboarding_guide_state(user)

        assert state["experience_level"] is None
        assert state["starter_tour_status"] == "pending"


def test_a_blob_written_before_the_field_existed_still_parses() -> None:
    legacy_blob = json.dumps({"status": "completed", "current_step_id": None, "tutorial_game_id": 7})
    with _session() as db:
        user = _user(db, legacy_blob)
        state = _read_onboarding_guide_state(user)

        # The old fields survive untouched, and the new ones take their defaults rather than
        # blowing up - an existing player is simply asked the question once.
        assert state["status"] == "completed"
        assert state["tutorial_game_id"] == 7
        assert state["experience_level"] is None
        assert state["starter_tour_status"] == "pending"


@pytest.mark.parametrize("level", ["novice", "expert"])
def test_an_answer_survives_the_round_trip(level: str) -> None:
    with _session() as db:
        user = _user(db, "{}")
        _store_onboarding_guide_state(user, {"status": "pending", "experience_level": level})

        assert _read_onboarding_guide_state(user)["experience_level"] == level
        assert _serialize_onboarding_guide_state(user).experience_level == level


def test_a_junk_level_is_dropped_rather_than_stored() -> None:
    with _session() as db:
        user = _user(db, json.dumps({"experience_level": "wizard"}))

        # Anything outside the two known modes reads as unanswered, so the dialog asks again
        # instead of the game screen guessing which half of the UI to hide.
        assert _read_onboarding_guide_state(user)["experience_level"] is None


def test_finishing_the_starter_tour_sticks() -> None:
    with _session() as db:
        user = _user(db, "{}")
        _store_onboarding_guide_state(
            user,
            {"status": "pending", "experience_level": "novice", "starter_tour_status": "completed"},
        )

        state = _read_onboarding_guide_state(user)
        assert state["starter_tour_status"] == "completed"
        assert state["experience_level"] == "novice"


def test_the_level_is_independent_of_the_long_guide_status() -> None:
    with _session() as db:
        user = _user(db, "{}")
        # Skipping the old chapter guide clears its step id; the level must not travel with it.
        _store_onboarding_guide_state(
            user,
            {"status": "skipped", "current_step_id": "intro-welcome", "experience_level": "expert"},
        )

        state = _read_onboarding_guide_state(user)
        assert state["current_step_id"] is None
        assert state["experience_level"] == "expert"
