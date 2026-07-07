from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import POLZA_GEMINI_25_FLASH_MODEL
from app.models import StoryGame, StorySceneBackground, StoryWorldCard
from app.schemas import StorySceneBackgroundOut
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.media import resolve_media_display_url
from app.services.story_games import coerce_story_image_model, deserialize_story_game_genres
from app.services.story_llm_modules import LlmModuleService, SceneBackgroundPromptPayload
from app.services.story_novel import can_user_use_story_visual_novel, is_story_visual_novel_game
from app.services.story_world_cards import STORY_WORLD_CARD_KIND_WORLD
from app.services.text_encoding import sanitize_likely_utf8_mojibake

logger = logging.getLogger(__name__)

STORY_SCENE_BACKGROUND_LLM_MODULE_NAME = "story_scene_background_prompt"
_STORY_SCENE_BACKGROUND_MAX_PER_GAME = 60


def require_story_visual_novel_admin(game: StoryGame, user: Any) -> None:
    if not can_user_use_story_visual_novel(user) or not is_story_visual_novel_game(game):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _normalize_story_scene_background_triggers(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        text = " ".join(str(value or "").split()).strip()
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        normalized.append(text)
        if len(normalized) >= 12:
            break
    return normalized


def _serialize_story_scene_background_triggers(values: Any) -> str:
    normalized = _normalize_story_scene_background_triggers(values)
    return json.dumps(normalized, ensure_ascii=False) if normalized else "[]"


def _deserialize_story_scene_background_triggers(raw_value: str | None) -> list[str]:
    normalized_raw = str(raw_value or "").strip()
    if not normalized_raw:
        return []
    try:
        parsed = json.loads(normalized_raw)
    except (TypeError, ValueError):
        return []
    return _normalize_story_scene_background_triggers(parsed)


def story_scene_background_to_out(background: StorySceneBackground) -> StorySceneBackgroundOut:
    image_url = resolve_media_display_url(
        background.image_url or background.image_data_url,
        kind="story-scene-background",
        entity_id=int(background.id),
        version=getattr(background, "updated_at", None),
    )
    return StorySceneBackgroundOut(
        id=background.id,
        game_id=background.game_id,
        title=str(getattr(background, "title", "") or ""),
        image_url=image_url,
        triggers=_deserialize_story_scene_background_triggers(getattr(background, "triggers", None)),
        is_current=bool(getattr(background, "is_current", False)),
        created_at=background.created_at,
        updated_at=background.updated_at,
    )


def list_story_scene_backgrounds(db: Session, game_id: int) -> list[StorySceneBackground]:
    return list(
        db.scalars(
            select(StorySceneBackground)
            .where(StorySceneBackground.game_id == game_id)
            .order_by(StorySceneBackground.id.desc())
        ).all()
    )


def get_current_story_scene_background(db: Session, game_id: int) -> StorySceneBackground | None:
    return db.scalar(
        select(StorySceneBackground).where(
            StorySceneBackground.game_id == game_id,
            StorySceneBackground.is_current.is_(True),
        )
    )


def _set_current_story_scene_background(db: Session, *, game_id: int, background_id: int) -> None:
    backgrounds = db.scalars(
        select(StorySceneBackground).where(StorySceneBackground.game_id == game_id)
    ).all()
    for background in backgrounds:
        background.is_current = bool(background.id == background_id)


def _story_scene_background_match_key(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def find_matching_story_scene_background(
    db: Session,
    *,
    game_id: int,
    location_label: str | None,
) -> StorySceneBackground | None:
    """Free, no-generation memory lookup: does a saved background's trigger match the
    current location? Used so re-entering a known location swaps the background instantly
    instead of generating a new one."""
    location_key = _story_scene_background_match_key(location_label)
    if not location_key:
        return None

    backgrounds = list_story_scene_backgrounds(db, game_id)
    exact_match: StorySceneBackground | None = None
    partial_match: StorySceneBackground | None = None
    for background in backgrounds:
        candidate_keys = {_story_scene_background_match_key(background.title)}
        candidate_keys.update(
            _story_scene_background_match_key(trigger)
            for trigger in _deserialize_story_scene_background_triggers(background.triggers)
        )
        candidate_keys.discard("")
        if location_key in candidate_keys:
            exact_match = background
            break
        if partial_match is None and any(
            location_key in candidate_key or candidate_key in location_key
            for candidate_key in candidate_keys
        ):
            partial_match = background
    return exact_match or partial_match


def apply_story_scene_background_memory_for_turn(
    db: Session,
    *,
    game: StoryGame,
    location_label: str | None,
) -> StorySceneBackground | None:
    """Called once per assistant turn for Visual Novel games: if the current location matches
    a remembered background and it isn't already current, switch to it for free (no generation).
    Returns the resulting current background (possibly unchanged)."""
    matched = find_matching_story_scene_background(db, game_id=int(game.id), location_label=location_label)
    if matched is not None and not bool(matched.is_current):
        _set_current_story_scene_background(db, game_id=int(game.id), background_id=int(matched.id))
        db.flush()
    return get_current_story_scene_background(db, int(game.id))


def _resolve_story_world_card(world_cards: list[StoryWorldCard], kind: str) -> StoryWorldCard | None:
    return next(
        (card for card in world_cards if str(getattr(card, "kind", "") or "").strip().lower() == kind),
        None,
    )


def _build_scene_background_prompt_messages(
    *,
    world_title: str,
    world_content: str,
    genres: list[str],
    image_style_prompt: str,
    location_label: str,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> list[dict[str, str]]:
    genre_line = ", ".join(genre for genre in genres if genre) or "не указан"
    system_content = (
        "Ты — художник-постановщик фонов для визуальной новеллы. По карточке мира и последнему "
        "ходу сформируй один короткий детальный промпт (на английском) для генерации ОДНОГО фона "
        "сцены: только локация и обстановка, БЕЗ конкретных именованных персонажей. Если из текста "
        "явно следует, что в локации сейчас есть люди/толпа (рынок, таверна, людная улица и т.п.), "
        "можно описать безымянных людей общими словами (silhouettes, crowd, patrons, background "
        "figures), но никогда не описывай внешность конкретных героев истории. Если локация "
        "пустая или уединённая — не добавляй людей вообще.\n"
        'Return JSON only: {"prompt": string, "location_title": string, "has_people": boolean}. '
        "No markdown, no commentary, no reasoning, no extra keys."
    )
    user_content = (
        f"НАЗВАНИЕ МИРА / СЕТТИНГ:\n{world_title or 'не указано'}\n\n"
        f"ОПИСАНИЕ МИРА:\n{world_content or 'не указано'}\n\n"
        f"ЖАНРЫ: {genre_line}\n\n"
        f"ТЕКУЩАЯ ЛОКАЦИЯ: {location_label or 'не указана'}\n\n"
        f"СТИЛЬ ИЗОБРАЖЕНИЯ: {image_style_prompt or 'не указан'}\n\n"
        f"ПОСЛЕДНИЙ ХОД ИГРОКА:\n{latest_user_prompt or '(нет)'}\n\n"
        f"ОТВЕТ РАССКАЗЧИКА:\n{latest_assistant_text or '(нет)'}"
    )
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]


def _request_scene_background_prompt_text(messages: list[dict[str, str]], **kwargs: Any) -> str:
    from app.services.story_generation_provider import _request_polza_story_text

    return _request_polza_story_text(
        messages,
        model_name=str(kwargs.get("model_name") or POLZA_GEMINI_25_FLASH_MODEL),
        allow_service_fallback=False,
        translate_input=False,
        fallback_model_names=[],
        temperature=float(kwargs.get("temperature", 0.4)),
        max_tokens=int(kwargs.get("max_tokens", 500)),
        request_timeout=kwargs.get("request_timeout") or (8.0, 60.0),
        retry_on_rate_limit=True,
    )


def generate_story_scene_background_prompt(
    *,
    game: StoryGame,
    world_cards: list[StoryWorldCard],
    location_label: str,
    latest_user_prompt: str,
    latest_assistant_text: str,
) -> SceneBackgroundPromptPayload:
    world_card = _resolve_story_world_card(world_cards, STORY_WORLD_CARD_KIND_WORLD)
    world_title = sanitize_likely_utf8_mojibake(str(getattr(world_card, "title", "") or ""))
    world_content = sanitize_likely_utf8_mojibake(str(getattr(world_card, "content", "") or ""))
    genres = deserialize_story_game_genres(getattr(game, "genres", None))
    image_style_prompt = str(getattr(game, "image_style_prompt", "") or "")

    messages = _build_scene_background_prompt_messages(
        world_title=world_title,
        world_content=world_content,
        genres=genres,
        image_style_prompt=image_style_prompt,
        location_label=location_label,
        latest_user_prompt=sanitize_likely_utf8_mojibake(latest_user_prompt),
        latest_assistant_text=sanitize_likely_utf8_mojibake(latest_assistant_text),
    )
    service = LlmModuleService(
        _request_scene_background_prompt_text,
        primary_model=POLZA_GEMINI_25_FLASH_MODEL,
        fallback_models=[],
        include_configured_fallback=False,
    )
    payload, _provider_meta = service.call_json(
        messages=messages,
        schema=SceneBackgroundPromptPayload,
        module=STORY_SCENE_BACKGROUND_LLM_MODULE_NAME,
        game_id=int(game.id),
        max_tokens=500,
        temperature=0.4,
        max_attempts=2,
        request_timeout=(8.0, 60.0),
    )
    return payload


def _build_final_scene_background_image_prompt(
    *,
    scene_prompt: str,
    image_style_prompt: str,
) -> str:
    # Lazy import avoids a circular import: story_visuals.py imports the shared `logger`
    # (and other names) from app.main at module load time, and app.main imports this
    # module's router at startup.
    from app.services.story_visuals import (
        _story_turn_image_style_prompt_requests_anime,
        _story_turn_image_style_prompt_requests_realism,
    )

    style_instructions: list[str] = []
    if _story_turn_image_style_prompt_requests_anime(image_style_prompt):
        style_instructions.append("Anime / illustrated art style, no photorealism.")
    elif _story_turn_image_style_prompt_requests_realism(image_style_prompt):
        style_instructions.append("Photorealistic, cinematic lighting.")
    if image_style_prompt:
        style_instructions.append(image_style_prompt.strip())
    parts = [
        scene_prompt.strip(),
        "Wide establishing background shot, no foreground UI, no text, no watermark.",
        *style_instructions,
    ]
    return "\n".join(part for part in parts if part)


def generate_story_novel_background_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    world_cards: list[StoryWorldCard],
    location_label: str,
    latest_user_prompt: str,
    latest_assistant_text: str,
    requested_title: str | None = None,
) -> StorySceneBackgroundOut:
    from app.services.story_visuals import (
        _get_story_turn_image_cost_tokens,
        _limit_story_turn_image_request_prompt,
        _request_story_turn_image,
        _story_turn_image_style_prompt_requests_anime,
        _story_turn_image_style_prompt_requests_realism,
    )

    require_story_visual_novel_admin(game, user)

    scene_payload = generate_story_scene_background_prompt(
        game=game,
        world_cards=world_cards,
        location_label=location_label,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
    )
    image_style_prompt = str(getattr(game, "image_style_prompt", "") or "")
    final_prompt = _build_final_scene_background_image_prompt(
        scene_prompt=scene_payload.prompt or location_label or "Empty establishing background",
        image_style_prompt=image_style_prompt,
    )
    selected_image_model = coerce_story_image_model(getattr(game, "image_model", None))
    final_prompt = _limit_story_turn_image_request_prompt(final_prompt, model_name=selected_image_model)
    if not final_prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Scene context is empty")

    generation_cost = _get_story_turn_image_cost_tokens(selected_image_model)
    if not spend_user_tokens_if_sufficient(db, user_id=int(user.id), tokens=generation_cost):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Not enough sols to generate background")
    db.commit()

    try:
        generation_result = _request_story_turn_image(prompt=final_prompt, model_name=selected_image_model)
    except Exception as exc:
        try:
            add_user_tokens(db, user_id=int(user.id), tokens=generation_cost)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception(
                "Story scene background token refund failed after generation error: game_id=%s",
                game.id,
            )
        logger.exception("Story scene background generation failed: game_id=%s", game.id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Background generation failed") from exc

    location_title = (
        sanitize_likely_utf8_mojibake(str(requested_title or "").strip())
        or sanitize_likely_utf8_mojibake(str(scene_payload.location_title or "").strip())
        or sanitize_likely_utf8_mojibake(str(location_label or "").strip())
        or "Фон сцены"
    )
    triggers = _normalize_story_scene_background_triggers(
        [location_title, location_label] if location_label else [location_title]
    )

    existing_backgrounds = list_story_scene_backgrounds(db, int(game.id))
    for background in existing_backgrounds:
        background.is_current = False
    if len(existing_backgrounds) >= _STORY_SCENE_BACKGROUND_MAX_PER_GAME:
        oldest = existing_backgrounds[-1]
        db.delete(oldest)
        db.flush()

    background = StorySceneBackground(
        game_id=int(game.id),
        title=location_title,
        prompt=final_prompt,
        triggers=_serialize_story_scene_background_triggers(triggers),
        theme="",
        style=(
            "anime"
            if _story_turn_image_style_prompt_requests_anime(image_style_prompt)
            else "realism"
            if _story_turn_image_style_prompt_requests_realism(image_style_prompt)
            else ""
        ),
        model=str(generation_result.get("model") or selected_image_model),
        image_url=generation_result.get("image_url"),
        image_data_url=generation_result.get("image_data_url"),
        is_current=True,
    )
    db.add(background)
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def select_story_scene_background_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    background_id: int,
) -> StorySceneBackgroundOut:
    require_story_visual_novel_admin(game, user)
    background = db.scalar(
        select(StorySceneBackground).where(
            StorySceneBackground.id == background_id,
            StorySceneBackground.game_id == game.id,
        )
    )
    if background is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Background not found")
    _set_current_story_scene_background(db, game_id=int(game.id), background_id=int(background.id))
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def list_story_scene_backgrounds_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
) -> list[StorySceneBackgroundOut]:
    require_story_visual_novel_admin(game, user)
    return [story_scene_background_to_out(background) for background in list_story_scene_backgrounds(db, int(game.id))]
