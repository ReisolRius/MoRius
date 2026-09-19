"""Erasing an account must reach every table that points at it - and nothing else."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    AccountDeviceMark,
    AccountTombstone,
    AiAssistantConversation,
    AiAssistantMessage,
    AiAssistantUsage,
    CoinPurchase,
    GuestSession,
    ReferralReward,
    SavedPaymentMethod,
    StoryCharacter,
    StoryCommunityCharacterRating,
    StoryCommunityWorldComment,
    StoryCommunityWorldRating,
    StoryGame,
    StoryInstructionTemplate,
    StoryMemoryBlock,
    StoryMessage,
    StoryWorldCard,
    Subscription,
    User,
    UserFollow,
    UserGalleryImage,
    UserNotification,
)
from app.routers import account as account_router
from app.routers import admin as admin_router
from app.schemas import AccountDeleteRequest
from app.services.account_lifecycle import (
    ACCOUNT_DELETE_CONFIRMATION_WORD,
    NEW_ACCOUNT_STARTER_COINS,
    USER_REFERENCES,
    delete_user_account,
    starter_coins_for_new_account,
)
from app.services.auth_identity import issue_auth_response

# Plain integer columns that name a user without a foreign key. Keep this list honest: a new one
# belongs in USER_REFERENCES as well.
_PLAIN_USER_COLUMNS = {
    ("story_games", "publication_reviewer_user_id"),
    ("story_characters", "publication_reviewer_user_id"),
    ("story_instruction_templates", "publication_reviewer_user_id"),
    ("guest_sessions", "user_id"),
    ("guest_sessions", "converted_user_id"),
    ("account_device_marks", "user_id"),
}


def _session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record) -> None:  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    return Session(bind=engine, future=True, expire_on_commit=False)


def test_every_column_that_points_at_a_user_is_in_the_registry() -> None:
    registered = {(reference.model.__tablename__, reference.column) for reference in USER_REFERENCES}
    foreign_keys = {
        (table.name, column.name)
        for table in Base.metadata.sorted_tables
        for column in table.columns
        for foreign_key in column.foreign_keys
        if foreign_key.column.table.name == "users"
    }
    missing = sorted((foreign_keys | _PLAIN_USER_COLUMNS) - registered)
    assert not missing, f"Add these to USER_REFERENCES in services/account_lifecycle.py: {missing}"


def _user(db: Session, email: str, **fields) -> User:
    user = User(email=email, display_name=email.split("@", 1)[0], auth_provider="email", **fields)
    db.add(user)
    db.flush()
    return user


def _populate(db: Session) -> tuple[User, User, dict[str, int]]:
    """A doomed account with a bit of everything, and a bystander whose data must survive."""
    doomed = _user(db, "doomed@example.com", coins=77, google_sub="google-doomed")
    bystander = _user(db, "bystander@example.com", coins=10)
    ids: dict[str, int] = {}

    doomed_world = StoryGame(user_id=doomed.id, title="Doomed world")
    bystander_world = StoryGame(
        user_id=bystander.id,
        title="Bystander world",
        visibility="public",
        community_rating_sum=9,
        community_rating_count=2,
    )
    db.add_all([doomed_world, bystander_world])
    db.flush()
    ids["bystander_world"] = bystander_world.id

    message = StoryMessage(game_id=doomed_world.id, role="assistant", content="Once upon a time")
    db.add(message)
    db.flush()
    db.add(StoryMemoryBlock(game_id=doomed_world.id, assistant_message_id=message.id, layer="raw", content="memory"))

    doomed_character = StoryCharacter(
        user_id=doomed.id,
        name="Doomed hero",
        description="to be erased",
        visibility="public",
        community_rating_sum=4,
        community_rating_count=1,
    )
    db.add(doomed_character)
    db.flush()
    # The bystander rated the doomed character and placed it in their own world.
    db.add(StoryCommunityCharacterRating(character_id=doomed_character.id, user_id=bystander.id, rating=4))
    bystander_card = StoryWorldCard(
        game_id=bystander_world.id,
        title="Borrowed hero",
        content="card",
        character_id=doomed_character.id,
    )
    db.add(bystander_card)
    db.flush()
    ids["bystander_card"] = bystander_card.id

    db.add(StoryInstructionTemplate(user_id=doomed.id, title="Rule", content="Be kind"))
    # The doomed user rated and commented on the bystander's world.
    db.add(StoryCommunityWorldRating(world_id=bystander_world.id, user_id=doomed.id, rating=5))
    db.add(StoryCommunityWorldComment(world_id=bystander_world.id, user_id=doomed.id, content="Nice"))

    db.add_all(
        [
            UserFollow(follower_user_id=doomed.id, following_user_id=bystander.id),
            UserFollow(follower_user_id=bystander.id, following_user_id=doomed.id),
        ]
    )
    bystander_notification = UserNotification(user_id=bystander.id, actor_user_id=doomed.id, title="New follower")
    db.add(bystander_notification)
    db.add(UserNotification(user_id=doomed.id, title="Own notification"))
    db.flush()
    ids["bystander_notification"] = bystander_notification.id

    purchase = CoinPurchase(
        user_id=doomed.id,
        provider_payment_id="pay-1",
        plan_id="standard",
        plan_title="Standard",
        amount_rub=399,
        coins=125,
        status="succeeded",
    )
    db.add(purchase)
    db.flush()
    db.add(
        ReferralReward(
            referrer_user_id=bystander.id,
            referred_user_id=doomed.id,
            triggering_purchase_id=purchase.id,
        )
    )
    method = SavedPaymentMethod(user_id=doomed.id, provider_payment_method_id="pm-1", title="Visa •••• 4242")
    db.add(method)
    db.flush()
    db.add(
        Subscription(
            user_id=doomed.id,
            plan_id="spark",
            plan_title="Искра",
            price_rub=299,
            status="active",
            payment_method_id=method.id,
            next_charge_at=datetime.now(timezone.utc) + timedelta(days=20),
        )
    )
    db.add(UserGalleryImage(user_id=doomed.id, model="image", prompt="a castle"))

    conversation = AiAssistantConversation(id="conversation-1", user_id=doomed.id, title="Help")
    db.add(conversation)
    db.flush()
    assistant_message = AiAssistantMessage(conversation_id=conversation.id, role="assistant", content="Hi")
    db.add(assistant_message)
    db.flush()
    db.add(AiAssistantUsage(user_id=doomed.id, conversation_id=conversation.id, message_id=assistant_message.id))

    db.add(AccountDeviceMark(device_hash="a" * 64, user_id=doomed.id))
    db.add(GuestSession(status="converted", converted_user_id=doomed.id, device_cookie_hash="b" * 64))
    bystander.referred_by_user_id = doomed.id
    db.commit()
    return doomed, bystander, ids


def test_erasing_an_account_removes_everything_it_owns_and_only_that() -> None:
    db = _session()
    doomed, bystander, ids = _populate(db)
    doomed_id = doomed.id

    summary = delete_user_account(db, user=doomed)
    db.commit()

    assert summary.worlds == 1
    assert summary.characters == 1
    assert summary.instruction_templates == 1
    assert summary.purchases == 1
    assert summary.subscriptions == 1

    assert db.get(User, doomed_id) is None
    for reference in USER_REFERENCES:
        column = getattr(reference.model, reference.column)
        remaining = db.scalar(select(func.count()).select_from(reference.model).where(column == doomed_id))
        assert remaining == 0, f"{reference.model.__tablename__}.{reference.column} still points at the erased user"

    assert db.scalar(select(func.count()).select_from(StoryMessage)) == 0
    assert db.scalar(select(func.count()).select_from(StoryMemoryBlock)) == 0
    assert db.scalar(select(func.count()).select_from(CoinPurchase)) == 0
    assert db.scalar(select(func.count()).select_from(ReferralReward)) == 0
    assert db.scalar(select(func.count()).select_from(AiAssistantMessage)) == 0

    # The bystander keeps their world, their card and their notification...
    bystander_world = db.get(StoryGame, ids["bystander_world"])
    assert bystander_world is not None
    # ...minus the erased user's 5-star rating.
    assert (bystander_world.community_rating_sum, bystander_world.community_rating_count) == (4, 1)
    assert db.get(StoryWorldCard, ids["bystander_card"]).character_id is None
    assert db.get(UserNotification, ids["bystander_notification"]).actor_user_id is None
    assert db.get(User, bystander.id).referred_by_user_id is None

    # Registry rows survive without the user in them.
    session_row = db.scalar(select(GuestSession))
    assert session_row is not None and session_row.converted_user_id is None


def test_a_deleted_identity_does_not_get_the_starter_sols_twice() -> None:
    db = _session()
    doomed, _, _ = _populate(db)
    assert starter_coins_for_new_account(db, email="doomed@example.com") == NEW_ACCOUNT_STARTER_COINS

    delete_user_account(db, user=doomed)
    db.commit()

    assert db.scalar(select(func.count()).select_from(AccountTombstone)) >= 2
    assert starter_coins_for_new_account(db, email="Doomed@Example.com") == 0
    assert starter_coins_for_new_account(db, google_sub="google-doomed") == 0
    assert starter_coins_for_new_account(db, email="someone-else@example.com") == NEW_ACCOUNT_STARTER_COINS


def test_self_service_deletion_needs_the_typed_word() -> None:
    db = _session()
    user = _user(db, "tired@example.com")
    db.commit()
    bearer = f"Bearer {issue_auth_response(user).access_token}"

    with pytest.raises(HTTPException) as caught:
        account_router.delete_my_account_route(AccountDeleteRequest(confirmation="да"), authorization=bearer, db=db)
    assert caught.value.status_code == 400
    assert db.get(User, user.id) is not None

    result = account_router.delete_my_account_route(
        AccountDeleteRequest(confirmation=ACCOUNT_DELETE_CONFIRMATION_WORD.lower()),
        authorization=bearer,
        db=db,
    )
    assert result.deleted_user_id == user.id
    assert db.scalar(select(func.count()).select_from(User).where(User.email == "tired@example.com")) == 0


def test_only_an_administrator_can_erase_someone_else() -> None:
    db = _session()
    administrator = _user(db, "iltteam@yandex.ru", role="administrator")
    moderator = _user(db, "mod@example.com", role="moderator")
    target = _user(db, "target@example.com")
    db.commit()
    admin_bearer = f"Bearer {issue_auth_response(administrator).access_token}"
    moderator_bearer = f"Bearer {issue_auth_response(moderator).access_token}"
    confirmation = AccountDeleteRequest(confirmation=ACCOUNT_DELETE_CONFIRMATION_WORD)

    with pytest.raises(HTTPException) as caught:
        admin_router.delete_user_account_as_admin(target.id, confirmation, authorization=moderator_bearer, db=db)
    assert caught.value.status_code == 403

    with pytest.raises(HTTPException) as caught:
        admin_router.delete_user_account_as_admin(administrator.id, confirmation, authorization=admin_bearer, db=db)
    assert caught.value.status_code == 400

    result = admin_router.delete_user_account_as_admin(target.id, confirmation, authorization=admin_bearer, db=db)
    assert result.deleted_user_id == target.id
    assert db.get(User, target.id) is None
