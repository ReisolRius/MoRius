"""Moving and erasing whole accounts.

Two things happen to an account as a whole, and both must reach every table that points at it:

* a guest's belongings move into the account the player signs in to
  (`reassign_user_references`, driven by services/guest_accounts.py);
* an account is erased on request - from the settings dialog or from the admin panel
  (`delete_user_account`).

`USER_REFERENCES` is the single list of every column that refers to a user. Both operations
walk it, and tests/test_account_lifecycle.py fails as soon as a model gains a user column that
is missing here: an erase that silently leaves one table behind is exactly the bug this module
exists to prevent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import delete as sa_delete, func, inspect, or_, select, text, update as sa_update
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    AccountDeviceMark,
    AccountTombstone,
    AiAssistantActionBatch,
    AiAssistantConversation,
    AiAssistantMessage,
    AiAssistantUsage,
    CoinPurchase,
    CosmeticItem,
    CreatorMonthSlot,
    EmailVerification,
    GuestSession,
    PasswordResetVerification,
    ReferralReward,
    SavedPaymentMethod,
    StoryBugReport,
    StoryCharacter,
    StoryCharacterRace,
    StoryCommunityCharacterAddition,
    StoryCommunityCharacterRating,
    StoryCommunityCharacterReport,
    StoryCommunityInstructionTemplateAddition,
    StoryCommunityInstructionTemplateRating,
    StoryCommunityInstructionTemplateReport,
    StoryCommunityWorldComment,
    StoryCommunityWorldFavorite,
    StoryCommunityWorldLaunch,
    StoryCommunityWorldRating,
    StoryCommunityWorldReport,
    StoryCommunityWorldView,
    StoryGame,
    StoryInstructionTemplate,
    StoryPlaceTemplate,
    StorySummaryJob,
    StoryWorldCard,
    StoryWorldCardTemplate,
    StoryWorldDetailType,
    Subscription,
    User,
    UserCosmeticPurchase,
    UserEncouragement,
    UserFollow,
    UserGalleryImage,
    UserNotification,
    WikiArticle,
)
from app.services.guest_access import hash_identity

logger = logging.getLogger(__name__)

# Sol economy v2: 50 old sols bought ~12 cheap turns, 30 new ones buy 30. Given once per person:
# a guest gets it, and the account that guest turns into inherits what is left instead of a
# second grant (see guest_accounts.absorb_guest_into_account).
NEW_ACCOUNT_STARTER_COINS = 30

# What the player types to confirm an erase, in the settings dialog and in the admin panel.
ACCOUNT_DELETE_CONFIRMATION_WORD = "УДАЛИТЬ"

ReferenceRole = Literal["owned", "actor", "registry"]


@dataclass(frozen=True)
class UserReference:
    model: type
    column: str
    # owned    - the row belongs to the user: it moves with a merge and dies with the account.
    # actor    - the user only acted on someone else's row: it moves with a merge, becomes NULL.
    # registry - anti-abuse memory that must outlive the user: never moved, NULLed on erase.
    role: ReferenceRole
    # For owned rows under a uniqueness constraint that includes the user column: the other
    # columns of that constraint (an empty tuple means one row per user). A row whose twin
    # already exists on the merge target is dropped instead of moved.
    unique_with: tuple[str, ...] | None = None


USER_REFERENCES: tuple[UserReference, ...] = (
    UserReference(User, "referred_by_user_id", "actor"),
    UserReference(UserFollow, "follower_user_id", "owned"),
    UserReference(UserFollow, "following_user_id", "owned"),
    UserReference(UserNotification, "user_id", "owned"),
    UserReference(UserNotification, "actor_user_id", "actor"),
    UserReference(CoinPurchase, "user_id", "owned"),
    UserReference(SavedPaymentMethod, "user_id", "owned"),
    UserReference(Subscription, "user_id", "owned"),
    UserReference(CosmeticItem, "created_by_user_id", "actor"),
    UserReference(UserCosmeticPurchase, "user_id", "owned", unique_with=("item_id",)),
    UserReference(UserEncouragement, "sender_user_id", "owned"),
    UserReference(UserEncouragement, "recipient_user_id", "owned"),
    UserReference(CreatorMonthSlot, "user_id", "actor"),
    UserReference(ReferralReward, "referrer_user_id", "owned"),
    UserReference(ReferralReward, "referred_user_id", "owned", unique_with=()),
    UserReference(WikiArticle, "author_id", "actor"),
    UserReference(StoryGame, "user_id", "owned"),
    UserReference(StoryGame, "publication_reviewer_user_id", "actor"),
    UserReference(StoryCommunityWorldRating, "user_id", "owned", unique_with=("world_id",)),
    UserReference(StoryCommunityWorldView, "user_id", "owned", unique_with=("world_id",)),
    UserReference(StoryCommunityWorldLaunch, "user_id", "owned", unique_with=("world_id",)),
    UserReference(StoryCommunityWorldFavorite, "user_id", "owned", unique_with=("world_id",)),
    UserReference(StoryCommunityWorldComment, "user_id", "owned"),
    UserReference(StoryCommunityWorldReport, "reporter_user_id", "owned", unique_with=("world_id",)),
    UserReference(StoryCommunityWorldReport, "resolved_by_user_id", "actor"),
    UserReference(StoryCommunityCharacterReport, "reporter_user_id", "owned", unique_with=("character_id",)),
    UserReference(StoryCommunityCharacterReport, "resolved_by_user_id", "actor"),
    UserReference(StoryCommunityInstructionTemplateReport, "reporter_user_id", "owned", unique_with=("template_id",)),
    UserReference(StoryCommunityInstructionTemplateReport, "resolved_by_user_id", "actor"),
    UserReference(StoryBugReport, "reporter_user_id", "owned"),
    UserReference(StoryBugReport, "closed_by_user_id", "actor"),
    UserReference(StoryPlaceTemplate, "user_id", "owned"),
    UserReference(UserGalleryImage, "user_id", "owned", unique_with=("turn_image_id",)),
    UserReference(StoryInstructionTemplate, "user_id", "owned"),
    UserReference(StoryInstructionTemplate, "publication_reviewer_user_id", "actor"),
    UserReference(StoryCharacter, "user_id", "owned"),
    UserReference(StoryCharacter, "publication_reviewer_user_id", "actor"),
    UserReference(StoryCharacterRace, "user_id", "owned", unique_with=("name_key",)),
    UserReference(StoryWorldDetailType, "user_id", "owned", unique_with=("name_key",)),
    UserReference(StoryWorldCardTemplate, "user_id", "owned"),
    UserReference(StorySummaryJob, "user_id", "owned"),
    UserReference(StoryCommunityCharacterRating, "user_id", "owned", unique_with=("character_id",)),
    UserReference(StoryCommunityCharacterAddition, "user_id", "owned", unique_with=("character_id",)),
    UserReference(StoryCommunityInstructionTemplateRating, "user_id", "owned", unique_with=("template_id",)),
    UserReference(StoryCommunityInstructionTemplateAddition, "user_id", "owned", unique_with=("template_id",)),
    UserReference(AiAssistantConversation, "user_id", "owned"),
    UserReference(AiAssistantActionBatch, "user_id", "owned"),
    UserReference(AiAssistantUsage, "user_id", "owned"),
    UserReference(AccountDeviceMark, "user_id", "owned", unique_with=("device_hash",)),
    UserReference(GuestSession, "user_id", "registry"),
    UserReference(GuestSession, "converted_user_id", "registry"),
)

# Tables that still carry a foreign key to users but no longer have a model. A database that
# has been migrated in place for a year keeps them: `story_gallery_images` is the old name of
# `user_gallery_images`, `story_character_emotion_jobs` outlived the feature that wrote it. The
# registry above is built from the models, so it cannot know about them -- and the final
# DELETE FROM users fails on their foreign key. This is resolved against the live database
# rather than hard-coded, so the next table to be renamed does not bring deletion down again.
def _legacy_user_reference_columns(db: Session) -> tuple[tuple[str, str], ...]:
    """(table, column) pairs pointing at users that no model describes.

    Reflection runs on the SESSION's own connection, never on the engine: taking a second
    connection mid-erase rolls back the deletions already staged on the first one, and the
    final DELETE FROM users then trips over the children that came back. Deleting an account is
    a rare, human-initiated action, so this is resolved per call rather than cached -- a cache
    keyed by engine URL collides across in-memory databases and goes stale on migrations.
    """
    found: list[tuple[str, str]] = []
    try:
        inspector = inspect(db.connection())
        model_tables = set(Base.metadata.tables)
        for table_name in inspector.get_table_names():
            if table_name in model_tables:
                # A model table missing from USER_REFERENCES is a bug that
                # tests/test_account_lifecycle.py fails on; do not paper over it at runtime.
                continue
            for foreign_key in inspector.get_foreign_keys(table_name):
                if str(foreign_key.get("referred_table") or "") != User.__tablename__:
                    continue
                for column_name in foreign_key.get("constrained_columns") or []:
                    found.append((table_name, str(column_name)))
    except Exception:
        logger.warning("Could not inspect the schema for legacy user references", exc_info=True)
        return ()
    return tuple(found)


def _clear_legacy_user_references(db: Session, user_id: int) -> None:
    for table_name, column_name in _legacy_user_reference_columns(db):
        try:
            db.execute(
                text(f'DELETE FROM "{table_name}" WHERE "{column_name}" = :user_id'),
                {"user_id": user_id},
            )
            logger.info(
                "Cleared legacy reference %s.%s for user_id=%s",
                table_name,
                column_name,
                user_id,
            )
        except Exception:
            logger.warning(
                "Could not clear legacy reference %s.%s for user_id=%s",
                table_name,
                column_name,
                user_id,
                exc_info=True,
            )


# A rating or an addition is also counted into its target's denormalized totals. Whenever such a
# row disappears without its owner undoing it, the totals are brought back in step with it.
_RATING_TARGETS: dict[type, tuple[str, type]] = {
    StoryCommunityWorldRating: ("world_id", StoryGame),
    StoryCommunityCharacterRating: ("character_id", StoryCharacter),
    StoryCommunityInstructionTemplateRating: ("template_id", StoryInstructionTemplate),
}
_ADDITION_TARGETS: dict[type, tuple[str, type]] = {
    StoryCommunityCharacterAddition: ("character_id", StoryCharacter),
    StoryCommunityInstructionTemplateAddition: ("template_id", StoryInstructionTemplate),
}


@dataclass
class AccountErasureSummary:
    user_id: int
    worlds: int = 0
    characters: int = 0
    instruction_templates: int = 0
    purchases: int = 0
    subscriptions: int = 0
    details: dict[str, int] = field(default_factory=dict)


def _bulk(statement):
    return statement.execution_options(synchronize_session=False)


def _release_community_contribution(db: Session, model: type, row_id: int) -> None:
    """Take one rating or addition row out of its target's totals, then delete the row."""
    if model in _RATING_TARGETS:
        target_column, target_model = _RATING_TARGETS[model]
        row = db.execute(
            select(getattr(model, target_column), model.rating).where(model.id == int(row_id))
        ).first()
        if row is not None:
            target_id, rating_value = int(row[0]), max(int(row[1] or 0), 0)
            target = db.get(target_model, target_id)
            if target is not None:
                target.community_rating_sum = max(int(target.community_rating_sum or 0) - rating_value, 0)
                target.community_rating_count = max(int(target.community_rating_count or 0) - 1, 0)
    elif model in _ADDITION_TARGETS:
        target_column, target_model = _ADDITION_TARGETS[model]
        target_id = db.scalar(select(getattr(model, target_column)).where(model.id == int(row_id)))
        if target_id is not None:
            target = db.get(target_model, int(target_id))
            if target is not None:
                target.community_additions_count = max(int(target.community_additions_count or 0) - 1, 0)
    db.execute(_bulk(sa_delete(model).where(model.id == int(row_id))))


def _reassign_follows(db: Session, *, source_user_id: int, target_user_id: int) -> None:
    rows = db.execute(
        select(UserFollow.id, UserFollow.follower_user_id, UserFollow.following_user_id).where(
            or_(
                UserFollow.follower_user_id == source_user_id,
                UserFollow.following_user_id == source_user_id,
            )
        )
    ).all()
    for row_id, follower_id, following_id in rows:
        next_follower = target_user_id if int(follower_id) == source_user_id else int(follower_id)
        next_following = target_user_id if int(following_id) == source_user_id else int(following_id)
        twin = None
        if next_follower != next_following:
            twin = db.scalar(
                select(UserFollow.id).where(
                    UserFollow.follower_user_id == next_follower,
                    UserFollow.following_user_id == next_following,
                    UserFollow.id != int(row_id),
                )
            )
        if next_follower == next_following or twin is not None:
            db.execute(_bulk(sa_delete(UserFollow).where(UserFollow.id == int(row_id))))
            continue
        db.execute(
            _bulk(
                sa_update(UserFollow)
                .where(UserFollow.id == int(row_id))
                .values(follower_user_id=next_follower, following_user_id=next_following)
            )
        )


def reassign_user_references(db: Session, *, source_user_id: int, target_user_id: int) -> None:
    """Move everything that points at `source_user_id` over to `target_user_id`.

    Registry columns stay where they are - the guest session row is closed by the caller.
    """
    source_user_id = int(source_user_id)
    target_user_id = int(target_user_id)
    if source_user_id == target_user_id:
        return
    for reference in USER_REFERENCES:
        if reference.role == "registry" or reference.model is UserFollow:
            continue
        column = getattr(reference.model, reference.column)
        if reference.unique_with is None:
            db.execute(
                _bulk(
                    sa_update(reference.model)
                    .where(column == source_user_id)
                    .values({reference.column: target_user_id})
                )
            )
            continue
        key_columns = [getattr(reference.model, name) for name in reference.unique_with]
        rows = db.execute(select(reference.model.id, *key_columns).where(column == source_user_id)).all()
        for row in rows:
            row_id = int(row[0])
            filters = [column == target_user_id, reference.model.id != row_id]
            filters.extend(key_column == key_value for key_column, key_value in zip(key_columns, row[1:]))
            twin_id = db.scalar(select(reference.model.id).where(*filters).limit(1))
            if twin_id is not None:
                _release_community_contribution(db, reference.model, row_id)
                continue
            db.execute(
                _bulk(
                    sa_update(reference.model)
                    .where(reference.model.id == row_id)
                    .values({reference.column: target_user_id})
                )
            )
    _reassign_follows(db, source_user_id=source_user_id, target_user_id=target_user_id)


# --------------------------------------------------------------------------- deleted identities


def account_identity_hashes(
    *,
    email: str | None = None,
    google_sub: str | None = None,
    yandex_sub: str | None = None,
    vk_id_sub: str | None = None,
) -> list[str]:
    hashes: list[str] = []
    normalized_email = str(email or "").strip().lower()
    if normalized_email:
        hashes.append(hash_identity("account-email", normalized_email))
    for kind, value in (("account-google", google_sub), ("account-yandex", yandex_sub), ("account-vk", vk_id_sub)):
        normalized_value = str(value or "").strip()
        if normalized_value:
            hashes.append(hash_identity(kind, normalized_value))
    return hashes


def starter_coins_for_new_account(
    db: Session,
    *,
    email: str | None = None,
    google_sub: str | None = None,
    yandex_sub: str | None = None,
    vk_id_sub: str | None = None,
) -> int:
    """The starter grant for an account being created now: none if the identity was deleted before."""
    hashes = account_identity_hashes(email=email, google_sub=google_sub, yandex_sub=yandex_sub, vk_id_sub=vk_id_sub)
    if hashes and db.scalar(
        select(AccountTombstone.id).where(AccountTombstone.identity_hash.in_(hashes)).limit(1)
    ) is not None:
        return 0
    return NEW_ACCOUNT_STARTER_COINS


def _remember_deleted_identities(db: Session, user: User) -> None:
    hashes = account_identity_hashes(
        email=user.email,
        google_sub=user.google_sub,
        yandex_sub=getattr(user, "yandex_sub", None),
        vk_id_sub=getattr(user, "vk_id_sub", None),
    )
    if not hashes:
        return
    existing = set(db.scalars(select(AccountTombstone.identity_hash).where(AccountTombstone.identity_hash.in_(hashes))).all())
    for identity_hash in hashes:
        if identity_hash not in existing:
            db.add(AccountTombstone(identity_hash=identity_hash))
            existing.add(identity_hash)


# --------------------------------------------------------------------------- erase


def _cancel_running_generations(game_ids: list[int]) -> None:
    try:
        from app.services.story_generation_cancel import cancel_story_generation
    except Exception:  # pragma: no cover - partial deploys
        return
    for game_id in game_ids:
        try:
            cancel_story_generation(int(game_id))
        except Exception:
            logger.warning("Could not cancel a running generation before erasing game_id=%s", game_id)


def _delete_owned_character(db: Session, character_id: int) -> None:
    db.execute(_bulk(sa_delete(StoryCommunityCharacterRating).where(StoryCommunityCharacterRating.character_id == character_id)))
    db.execute(_bulk(sa_delete(StoryCommunityCharacterAddition).where(StoryCommunityCharacterAddition.character_id == character_id)))
    db.execute(_bulk(sa_delete(StoryCommunityCharacterReport).where(StoryCommunityCharacterReport.character_id == character_id)))
    # Other players who placed this character in their own worlds keep the card they made from
    # it; it only stops pointing at a character that no longer exists.
    db.execute(_bulk(sa_update(StoryWorldCard).where(StoryWorldCard.character_id == character_id).values(character_id=None)))
    db.execute(_bulk(sa_delete(StoryCharacter).where(StoryCharacter.id == character_id)))


def _delete_owned_instruction_template(db: Session, template_id: int) -> None:
    db.execute(_bulk(sa_delete(StoryCommunityInstructionTemplateRating).where(StoryCommunityInstructionTemplateRating.template_id == template_id)))
    db.execute(_bulk(sa_delete(StoryCommunityInstructionTemplateAddition).where(StoryCommunityInstructionTemplateAddition.template_id == template_id)))
    db.execute(_bulk(sa_delete(StoryCommunityInstructionTemplateReport).where(StoryCommunityInstructionTemplateReport.template_id == template_id)))
    db.execute(_bulk(sa_delete(StoryInstructionTemplate).where(StoryInstructionTemplate.id == template_id)))


def delete_user_account(db: Session, *, user: User) -> AccountErasureSummary:
    """Erase an account and everything it owns: worlds and their stories, characters, templates,
    purchases and donation history, subscriptions and saved cards, social traces, the assistant's
    history. Other players' own worlds survive untouched.

    Flushes but does not commit - the caller owns the transaction.
    """
    from app.services.story_games import delete_story_game_with_relations

    user_id = int(user.id)
    summary = AccountErasureSummary(user_id=user_id)
    is_guest = bool(getattr(user, "is_guest", False))
    if not is_guest:
        _remember_deleted_identities(db, user)

    # 1. Worlds, including their publication copies (which the same user owns) and everything
    #    that hangs off a game: messages, memory, cards, images, graph, other players' ratings.
    game_ids = [int(value) for value in db.scalars(select(StoryGame.id).where(StoryGame.user_id == user_id)).all()]
    summary.worlds = len(game_ids)
    _cancel_running_generations(game_ids)
    db.execute(_bulk(sa_delete(StorySummaryJob).where(StorySummaryJob.user_id == user_id)))
    for game_id in game_ids:
        delete_story_game_with_relations(db, game_id=game_id)
    db.flush()

    # 2. Characters and instruction templates, with every rating, addition and report on them.
    character_ids = [int(value) for value in db.scalars(select(StoryCharacter.id).where(StoryCharacter.user_id == user_id)).all()]
    summary.characters = len(character_ids)
    for character_id in character_ids:
        _delete_owned_character(db, character_id)
    template_ids = [
        int(value)
        for value in db.scalars(select(StoryInstructionTemplate.id).where(StoryInstructionTemplate.user_id == user_id)).all()
    ]
    summary.instruction_templates = len(template_ids)
    for template_id in template_ids:
        _delete_owned_instruction_template(db, template_id)

    # 3. The user's marks on other people's publications. Ratings and additions are also taken
    #    out of the totals those publications display.
    for model in (*_RATING_TARGETS.keys(), *_ADDITION_TARGETS.keys()):
        for row_id in db.scalars(select(model.id).where(model.user_id == user_id)).all():
            _release_community_contribution(db, model, int(row_id))

    # 4. The assistant: usage and action batches point at messages and conversations.
    conversation_ids = list(db.scalars(select(AiAssistantConversation.id).where(AiAssistantConversation.user_id == user_id)).all())
    db.execute(_bulk(sa_delete(AiAssistantUsage).where(AiAssistantUsage.user_id == user_id)))
    db.execute(_bulk(sa_delete(AiAssistantActionBatch).where(AiAssistantActionBatch.user_id == user_id)))
    if conversation_ids:
        db.execute(_bulk(sa_delete(AiAssistantUsage).where(AiAssistantUsage.conversation_id.in_(conversation_ids))))
        db.execute(_bulk(sa_delete(AiAssistantActionBatch).where(AiAssistantActionBatch.conversation_id.in_(conversation_ids))))
        db.execute(_bulk(sa_delete(AiAssistantMessage).where(AiAssistantMessage.conversation_id.in_(conversation_ids))))
        db.execute(_bulk(sa_delete(AiAssistantConversation).where(AiAssistantConversation.id.in_(conversation_ids))))

    # 5. Money. Referral rewards point at purchases, subscriptions at saved cards. Deleting the
    #    saved card is the merchant-side unbinding: it is never charged again.
    purchase_ids = [int(value) for value in db.scalars(select(CoinPurchase.id).where(CoinPurchase.user_id == user_id)).all()]
    summary.purchases = len(purchase_ids)
    referral_filters = [ReferralReward.referrer_user_id == user_id, ReferralReward.referred_user_id == user_id]
    if purchase_ids:
        referral_filters.append(ReferralReward.triggering_purchase_id.in_(purchase_ids))
    db.execute(_bulk(sa_delete(ReferralReward).where(or_(*referral_filters))))
    method_ids = [int(value) for value in db.scalars(select(SavedPaymentMethod.id).where(SavedPaymentMethod.user_id == user_id)).all()]
    summary.subscriptions = int(
        db.scalar(select(func.count()).select_from(Subscription).where(Subscription.user_id == user_id)) or 0
    )
    db.execute(_bulk(sa_delete(Subscription).where(Subscription.user_id == user_id)))
    if method_ids:
        db.execute(
            _bulk(sa_update(Subscription).where(Subscription.payment_method_id.in_(method_ids)).values(payment_method_id=None))
        )
    db.execute(_bulk(sa_delete(SavedPaymentMethod).where(SavedPaymentMethod.user_id == user_id)))
    db.execute(_bulk(sa_delete(CoinPurchase).where(CoinPurchase.user_id == user_id)))

    # 6. Everything else the registry knows about: owned rows go, references to the user as an
    #    actor on someone else's row become NULL.
    for reference in USER_REFERENCES:
        column = getattr(reference.model, reference.column)
        if reference.role == "owned":
            db.execute(_bulk(sa_delete(reference.model).where(column == user_id)))
        elif reference.model is not GuestSession:
            db.execute(_bulk(sa_update(reference.model).where(column == user_id).values({reference.column: None})))

    # 7. The guest registry keeps its anonymous memory of the device and network, not the user.
    guest_session_rows = db.scalars(
        select(GuestSession).where(or_(GuestSession.user_id == user_id, GuestSession.converted_user_id == user_id))
    ).all()
    for session_row in guest_session_rows:
        if session_row.user_id == user_id and session_row.status == "active":
            session_row.status = "deleted"
            session_row.coins_at_close = max(int(user.coins or 0), 0)
            if session_row.closed_at is None:
                session_row.closed_at = datetime.now(timezone.utc)
        if session_row.user_id == user_id:
            session_row.user_id = None
        if session_row.converted_user_id == user_id:
            session_row.converted_user_id = None

    # 8. Legacy tables that still point at users but have no model left.
    _clear_legacy_user_references(db, user_id)

    # 9. Pending e-mail codes for this address.
    normalized_email = str(user.email or "").strip().lower()
    if normalized_email:
        db.execute(_bulk(sa_delete(EmailVerification).where(EmailVerification.email == normalized_email)))
        db.execute(_bulk(sa_delete(PasswordResetVerification).where(PasswordResetVerification.email == normalized_email)))

    db.flush()
    db.execute(_bulk(sa_delete(User).where(User.id == user_id)))
    db.flush()
    try:
        db.expunge(user)
    except Exception:
        pass
    # Everything above ran as bulk statements; nothing this session loaded may be trusted now.
    db.expire_all()
    logger.info(
        "Account erased: user_id=%s guest=%s worlds=%s characters=%s templates=%s purchases=%s subscriptions=%s",
        user_id,
        is_guest,
        summary.worlds,
        summary.characters,
        summary.instruction_templates,
        summary.purchases,
        summary.subscriptions,
    )
    return summary
