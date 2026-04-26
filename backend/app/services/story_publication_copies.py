from __future__ import annotations

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacter,
    StoryInstructionCard,
    StoryInstructionTemplate,
    StoryPlotCard,
    StoryPlotCardChangeEvent,
    StoryWorldCard,
    StoryWorldCardChangeEvent,
    StoryGame,
)
from app.services.story_cards import STORY_TEMPLATE_VISIBILITY_PUBLIC
from app.services.story_characters import (
    STORY_CHARACTER_VISIBILITY_PUBLIC,
    normalize_story_avatar_scale,
    normalize_story_character_avatar_original_url,
    normalize_story_character_avatar_url,
    normalize_story_character_clothing,
    normalize_story_character_health_status,
    normalize_story_character_inventory,
    normalize_story_character_note,
    normalize_story_character_race,
    normalize_story_character_source,
    serialize_triggers,
    deserialize_triggers,
)
from app.services.story_emotions import (
    serialize_story_character_emotion_assets,
)
from app.services.story_games import (
    STORY_GAME_VISIBILITY_PUBLIC,
    clone_story_world_cards_to_game,
    delete_story_game_with_relations,
    normalize_story_cover_image_url,
    normalize_story_memory_optimization_mode,
    serialize_story_environment_weather,
    refresh_story_game_public_card_snapshots,
    serialize_story_ambient_profile,
    serialize_story_game_genres,
    story_game_summary_to_out,
)
from app.services.story_publication_moderation import mark_story_publication_approved


def _is_story_game_publication_copy_candidate(game: StoryGame) -> bool:
    publication_status = str(getattr(game, "publication_status", "") or "").strip().lower()
    return (
        str(getattr(game, "visibility", "") or "").strip().lower() == STORY_GAME_VISIBILITY_PUBLIC
        or publication_status in {"pending", "approved", "rejected"}
    )


def _copy_publication_review_state(source, target, *, reviewer_user_id: int | None = None) -> None:
    requested_at = getattr(source, "publication_requested_at", None)
    reviewed_at = getattr(source, "publication_reviewed_at", None)
    target.publication_requested_at = requested_at
    target.publication_reviewed_at = reviewed_at
    target.publication_reviewer_user_id = reviewer_user_id
    target.publication_rejection_reason = None


def upsert_story_character_publication_copy_from_source(
    db: Session,
    *,
    source_character: StoryCharacter,
    reviewer_user_id: int | None = None,
) -> StoryCharacter:
    publication = db.scalar(
        select(StoryCharacter).where(
            StoryCharacter.user_id == source_character.user_id,
            StoryCharacter.source_character_id == source_character.id,
        ).order_by(StoryCharacter.id.asc())
    )
    if publication is None:
        publication = StoryCharacter(
            user_id=source_character.user_id,
            name=source_character.name,
            description=source_character.description,
            race=normalize_story_character_race(getattr(source_character, "race", "")),
            clothing=normalize_story_character_clothing(getattr(source_character, "clothing", "")),
            inventory=normalize_story_character_inventory(getattr(source_character, "inventory", "")),
            health_status=normalize_story_character_health_status(getattr(source_character, "health_status", "")),
            note=normalize_story_character_note(source_character.note),
            triggers=serialize_triggers(deserialize_triggers(source_character.triggers)),
            avatar_url=normalize_story_character_avatar_url(source_character.avatar_url, db=db),
            avatar_original_url=(
                normalize_story_character_avatar_original_url(
                    getattr(source_character, "avatar_original_url", None),
                    db=db,
                )
                if getattr(source_character, "avatar_url", None)
                else None
            ),
            avatar_scale=normalize_story_avatar_scale(source_character.avatar_scale),
            emotion_assets=serialize_story_character_emotion_assets(getattr(source_character, "emotion_assets", "")),
            emotion_model=str(getattr(source_character, "emotion_model", "") or "").strip(),
            emotion_prompt_lock=str(getattr(source_character, "emotion_prompt_lock", "") or "").strip(),
            source=normalize_story_character_source(source_character.source),
            visibility=STORY_CHARACTER_VISIBILITY_PUBLIC,
            source_character_id=source_character.id,
            community_rating_sum=0,
            community_rating_count=0,
            community_additions_count=0,
        )
        try:
            with db.begin_nested():
                db.add(publication)
                db.flush()
        except IntegrityError:
            publication = db.scalar(
                select(StoryCharacter).where(
                    StoryCharacter.user_id == source_character.user_id,
                    StoryCharacter.source_character_id == source_character.id,
                ).order_by(StoryCharacter.id.asc())
            )
            if publication is None:
                raise

    publication.name = source_character.name
    publication.description = source_character.description
    publication.race = normalize_story_character_race(getattr(source_character, "race", ""))
    publication.clothing = normalize_story_character_clothing(getattr(source_character, "clothing", ""))
    publication.inventory = normalize_story_character_inventory(getattr(source_character, "inventory", ""))
    publication.health_status = normalize_story_character_health_status(getattr(source_character, "health_status", ""))
    publication.note = normalize_story_character_note(source_character.note)
    publication.triggers = serialize_triggers(deserialize_triggers(source_character.triggers))
    publication.avatar_url = normalize_story_character_avatar_url(source_character.avatar_url, db=db)
    publication.avatar_original_url = (
        normalize_story_character_avatar_original_url(
            getattr(source_character, "avatar_original_url", None),
            db=db,
        )
        if getattr(source_character, "avatar_url", None)
        else None
    )
    publication.avatar_scale = normalize_story_avatar_scale(source_character.avatar_scale)
    publication.emotion_assets = serialize_story_character_emotion_assets(getattr(source_character, "emotion_assets", ""))
    publication.emotion_model = str(getattr(source_character, "emotion_model", "") or "").strip()
    publication.emotion_prompt_lock = str(getattr(source_character, "emotion_prompt_lock", "") or "").strip()
    publication.source = normalize_story_character_source(source_character.source)
    publication.visibility = STORY_CHARACTER_VISIBILITY_PUBLIC
    publication.source_character_id = source_character.id
    mark_story_publication_approved(publication, reviewer_user_id=reviewer_user_id)
    _copy_publication_review_state(source_character, publication, reviewer_user_id=reviewer_user_id)
    db.flush()
    return publication


def upsert_story_instruction_template_publication_copy_from_source(
    db: Session,
    *,
    source_template: StoryInstructionTemplate,
    reviewer_user_id: int | None = None,
) -> StoryInstructionTemplate:
    publication = db.scalar(
        select(StoryInstructionTemplate).where(
            StoryInstructionTemplate.user_id == source_template.user_id,
            StoryInstructionTemplate.source_template_id == source_template.id,
        ).order_by(StoryInstructionTemplate.id.asc())
    )
    if publication is None:
        publication = StoryInstructionTemplate(
            user_id=source_template.user_id,
            title=source_template.title,
            content=source_template.content,
            visibility=STORY_TEMPLATE_VISIBILITY_PUBLIC,
            source_template_id=source_template.id,
            community_rating_sum=0,
            community_rating_count=0,
            community_additions_count=0,
        )
        try:
            with db.begin_nested():
                db.add(publication)
                db.flush()
        except IntegrityError:
            publication = db.scalar(
                select(StoryInstructionTemplate).where(
                    StoryInstructionTemplate.user_id == source_template.user_id,
                    StoryInstructionTemplate.source_template_id == source_template.id,
                ).order_by(StoryInstructionTemplate.id.asc())
            )
            if publication is None:
                raise

    publication.title = source_template.title
    publication.content = source_template.content
    publication.visibility = STORY_TEMPLATE_VISIBILITY_PUBLIC
    publication.source_template_id = source_template.id
    mark_story_publication_approved(publication, reviewer_user_id=reviewer_user_id)
    _copy_publication_review_state(source_template, publication, reviewer_user_id=reviewer_user_id)
    db.flush()
    return publication


def upsert_story_game_publication_copy_from_source(
    db: Session,
    *,
    source_game: StoryGame,
    copy_cards: bool,
    reviewer_user_id: int | None = None,
) -> StoryGame:
    normalized_source = story_game_summary_to_out(source_game)
    raw_cover_image_url = normalize_story_cover_image_url(getattr(source_game, "cover_image_url", None), db=db)
    story_narrator_mode = str(getattr(source_game, "story_narrator_mode", "") or "normal").strip() or "normal"
    story_romance_enabled = bool(getattr(source_game, "story_romance_enabled", False))
    publication_candidates = [
        candidate
        for candidate in db.scalars(
            select(StoryGame)
            .where(
                StoryGame.user_id == source_game.user_id,
                StoryGame.source_world_id == source_game.id,
            )
            .order_by(StoryGame.id.asc())
        ).all()
        if _is_story_game_publication_copy_candidate(candidate)
    ]
    publication = publication_candidates[0] if publication_candidates else None
    for duplicate_publication in publication_candidates[1:]:
        delete_story_game_with_relations(db, game_id=int(duplicate_publication.id))
    if publication is None:
        publication = StoryGame(
            user_id=source_game.user_id,
            title=normalized_source.title,
            description=normalized_source.description,
            opening_scene=normalized_source.opening_scene,
            visibility=STORY_GAME_VISIBILITY_PUBLIC,
            age_rating=normalized_source.age_rating,
            genres=serialize_story_game_genres(normalized_source.genres),
            cover_image_url=raw_cover_image_url,
            cover_scale=normalized_source.cover_scale,
            cover_position_x=normalized_source.cover_position_x,
            cover_position_y=normalized_source.cover_position_y,
            source_world_id=source_game.id,
            community_views=0,
            community_launches=0,
            community_rating_sum=0,
            community_rating_count=0,
            context_limit_chars=normalized_source.context_limit_chars,
            response_max_tokens=normalized_source.response_max_tokens,
            response_max_tokens_enabled=normalized_source.response_max_tokens_enabled,
            story_llm_model=normalized_source.story_llm_model,
            image_model=normalized_source.image_model,
            image_style_prompt=normalized_source.image_style_prompt,
            memory_optimization_enabled=normalized_source.memory_optimization_enabled,
            memory_optimization_mode=normalize_story_memory_optimization_mode(
                getattr(normalized_source, "memory_optimization_mode", None)
            ),
            story_top_k=normalized_source.story_top_k,
            story_top_r=normalized_source.story_top_r,
            story_temperature=normalized_source.story_temperature,
            story_repetition_penalty=normalized_source.story_repetition_penalty,
            story_narrator_mode=story_narrator_mode,
            story_romance_enabled=story_romance_enabled,
            show_gg_thoughts=normalized_source.show_gg_thoughts,
            show_npc_thoughts=normalized_source.show_npc_thoughts,
            ambient_enabled=normalized_source.ambient_enabled,
            environment_enabled=normalized_source.environment_enabled,
            environment_time_enabled=normalized_source.environment_time_enabled,
            environment_weather_enabled=normalized_source.environment_weather_enabled,
            environment_current_datetime=str(normalized_source.environment_current_datetime or ""),
            environment_current_weather=serialize_story_environment_weather(
                normalized_source.environment_current_weather
            ),
            environment_tomorrow_weather=serialize_story_environment_weather(
                normalized_source.environment_tomorrow_weather
            ),
            emotion_visualization_enabled=normalized_source.emotion_visualization_enabled,
            ambient_profile=serialize_story_ambient_profile(normalized_source.ambient_profile),
            last_activity_at=normalized_source.last_activity_at,
        )
        try:
            with db.begin_nested():
                db.add(publication)
                db.flush()
        except IntegrityError:
            publication = next(
                (
                    candidate
                    for candidate in db.scalars(
                        select(StoryGame)
                        .where(
                            StoryGame.user_id == source_game.user_id,
                            StoryGame.source_world_id == source_game.id,
                        )
                        .order_by(StoryGame.id.asc())
                    ).all()
                    if _is_story_game_publication_copy_candidate(candidate)
                ),
                None,
            )
            if publication is None:
                raise

    publication.title = normalized_source.title
    publication.description = normalized_source.description
    publication.opening_scene = normalized_source.opening_scene
    publication.visibility = STORY_GAME_VISIBILITY_PUBLIC
    publication.age_rating = normalized_source.age_rating
    publication.genres = serialize_story_game_genres(normalized_source.genres)
    publication.cover_image_url = raw_cover_image_url
    publication.cover_scale = normalized_source.cover_scale
    publication.cover_position_x = normalized_source.cover_position_x
    publication.cover_position_y = normalized_source.cover_position_y
    publication.source_world_id = source_game.id
    publication.context_limit_chars = normalized_source.context_limit_chars
    publication.response_max_tokens = normalized_source.response_max_tokens
    publication.response_max_tokens_enabled = normalized_source.response_max_tokens_enabled
    publication.story_llm_model = normalized_source.story_llm_model
    publication.image_model = normalized_source.image_model
    publication.image_style_prompt = normalized_source.image_style_prompt
    publication.memory_optimization_enabled = normalized_source.memory_optimization_enabled
    publication.memory_optimization_mode = normalize_story_memory_optimization_mode(
        getattr(normalized_source, "memory_optimization_mode", None)
    )
    publication.story_top_k = normalized_source.story_top_k
    publication.story_top_r = normalized_source.story_top_r
    publication.story_temperature = normalized_source.story_temperature
    publication.story_repetition_penalty = normalized_source.story_repetition_penalty
    publication.story_narrator_mode = story_narrator_mode
    publication.story_romance_enabled = story_romance_enabled
    publication.show_gg_thoughts = normalized_source.show_gg_thoughts
    publication.show_npc_thoughts = normalized_source.show_npc_thoughts
    publication.ambient_enabled = normalized_source.ambient_enabled
    publication.environment_enabled = normalized_source.environment_enabled
    publication.environment_time_enabled = normalized_source.environment_time_enabled
    publication.environment_weather_enabled = normalized_source.environment_weather_enabled
    publication.environment_current_datetime = str(normalized_source.environment_current_datetime or "")
    publication.environment_current_weather = serialize_story_environment_weather(
        normalized_source.environment_current_weather
    )
    publication.environment_tomorrow_weather = serialize_story_environment_weather(
        normalized_source.environment_tomorrow_weather
    )
    publication.emotion_visualization_enabled = normalized_source.emotion_visualization_enabled
    publication.ambient_profile = serialize_story_ambient_profile(normalized_source.ambient_profile)
    publication.last_activity_at = normalized_source.last_activity_at
    mark_story_publication_approved(publication, reviewer_user_id=reviewer_user_id)
    _copy_publication_review_state(source_game, publication, reviewer_user_id=reviewer_user_id)

    if copy_cards:
        db.execute(
            sa_delete(StoryWorldCardChangeEvent).where(
                StoryWorldCardChangeEvent.game_id == publication.id,
            )
        )
        db.execute(
            sa_delete(StoryPlotCardChangeEvent).where(
                StoryPlotCardChangeEvent.game_id == publication.id,
            )
        )
        db.execute(sa_delete(StoryInstructionCard).where(StoryInstructionCard.game_id == publication.id))
        db.execute(sa_delete(StoryPlotCard).where(StoryPlotCard.game_id == publication.id))
        db.execute(sa_delete(StoryWorldCard).where(StoryWorldCard.game_id == publication.id))
        clone_story_world_cards_to_game(
            db,
            source_world_id=source_game.id,
            target_game_id=publication.id,
            copy_main_hero=False,
        )
        refresh_story_game_public_card_snapshots(db, publication)

    db.flush()
    return publication
