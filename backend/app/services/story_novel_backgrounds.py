from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import POLZA_STORY_SERVICE_TEXT_MODEL
from app.models import StoryGame, StoryPlaceTemplate, StorySceneBackground, StoryWorldCard
from app.schemas import StoryPlaceTemplateOut, StorySceneBackgroundOut
from app.services.concurrency import add_user_tokens, spend_user_tokens_if_sufficient
from app.services.media import resolve_media_display_url, resolve_media_storage_value, validate_avatar_url
from app.services.story_games import coerce_story_image_model, deserialize_story_game_genres
from app.services.story_llm_modules import LlmModuleService, SceneBackgroundPromptPayload
from app.services.story_novel import can_user_use_story_visual_novel, is_story_visual_novel_game
from app.services.story_world_cards import (
    STORY_WORLD_CARD_KIND_MAIN_HERO,
    STORY_WORLD_CARD_KIND_NPC,
    STORY_WORLD_CARD_KIND_WORLD,
    STORY_WORLD_CARD_KIND_WORLD_PROFILE,
)
from app.services.text_encoding import sanitize_likely_utf8_mojibake

logger = logging.getLogger(__name__)

STORY_SCENE_BACKGROUND_LLM_MODULE_NAME = "story_scene_background_prompt"
_STORY_SCENE_BACKGROUND_MAX_PER_GAME = 60
_STORY_PLACE_IMAGE_MAX_BYTES = 8 * 1024 * 1024


def require_story_visual_novel_admin(game: StoryGame, user: Any) -> None:
    if not can_user_use_story_visual_novel(user) or not is_story_visual_novel_game(game):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def require_story_visual_novel_profile_admin(user: Any) -> None:
    if not can_user_use_story_visual_novel(user):
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
        prompt=str(getattr(background, "prompt", "") or ""),
        image_url=image_url,
        triggers=_deserialize_story_scene_background_triggers(getattr(background, "triggers", None)),
        theme=str(getattr(background, "theme", "") or ""),
        style=str(getattr(background, "style", "") or ""),
        model=str(getattr(background, "model", "") or ""),
        is_current=bool(getattr(background, "is_current", False)),
        created_at=background.created_at,
        updated_at=background.updated_at,
    )


def story_place_template_to_out(place: StoryPlaceTemplate) -> StoryPlaceTemplateOut:
    image_url = resolve_media_display_url(
        place.image_url or place.image_data_url,
        kind="story-place-template",
        entity_id=int(place.id),
        version=getattr(place, "updated_at", None),
    )
    return StoryPlaceTemplateOut(
        id=int(place.id),
        user_id=int(place.user_id),
        title=str(place.title or ""),
        image_url=image_url,
        triggers=_deserialize_story_scene_background_triggers(getattr(place, "triggers", None)),
        created_at=place.created_at,
        updated_at=place.updated_at,
    )


def _normalize_story_place_title(value: str | None) -> str:
    normalized = " ".join(sanitize_likely_utf8_mojibake(str(value or "")).split()).strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Place title cannot be empty")
    return normalized[:160]


def _set_story_place_image(db: Session, place: Any, raw_image_url: str | None) -> None:
    """Store remote images and data URLs separately while accepting media-token URLs.

    Keeping data URLs in their own column lets the public media route stream them without
    returning huge JSON payloads from place-list endpoints.
    """
    storage_value = resolve_media_storage_value(db, raw_image_url)
    if storage_value is None:
        place.image_url = None
        place.image_data_url = None
        return
    validated = validate_avatar_url(storage_value, max_bytes=_STORY_PLACE_IMAGE_MAX_BYTES)
    if validated.startswith("data:"):
        place.image_url = None
        place.image_data_url = validated
    else:
        place.image_url = validated
        place.image_data_url = None


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


def _get_story_scene_background_or_404(
    db: Session,
    *,
    game_id: int,
    background_id: int,
) -> StorySceneBackground:
    background = db.scalar(
        select(StorySceneBackground).where(
            StorySceneBackground.id == int(background_id),
            StorySceneBackground.game_id == int(game_id),
        )
    )
    if background is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return background


def _ensure_story_scene_background_capacity(db: Session, game_id: int) -> None:
    if len(list_story_scene_backgrounds(db, game_id)) >= _STORY_SCENE_BACKGROUND_MAX_PER_GAME:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A game can contain at most {_STORY_SCENE_BACKGROUND_MAX_PER_GAME} places",
        )


def create_story_scene_background_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    title: str,
    triggers: list[str],
    image_url: str | None,
    make_current: bool = False,
) -> StorySceneBackgroundOut:
    require_story_visual_novel_admin(game, user)
    _ensure_story_scene_background_capacity(db, int(game.id))
    if make_current:
        for existing in list_story_scene_backgrounds(db, int(game.id)):
            existing.is_current = False
    background = StorySceneBackground(
        game_id=int(game.id),
        title=_normalize_story_place_title(title),
        prompt="",
        triggers=_serialize_story_scene_background_triggers(triggers),
        theme="",
        style="",
        model="",
        is_current=bool(make_current),
    )
    _set_story_place_image(db, background, image_url)
    db.add(background)
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def update_story_scene_background_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    background_id: int,
    fields: set[str],
    title: str | None = None,
    triggers: list[str] | None = None,
    image_url: str | None = None,
) -> StorySceneBackgroundOut:
    require_story_visual_novel_admin(game, user)
    background = _get_story_scene_background_or_404(
        db,
        game_id=int(game.id),
        background_id=background_id,
    )
    if "title" in fields:
        background.title = _normalize_story_place_title(title)
    if "triggers" in fields:
        background.triggers = _serialize_story_scene_background_triggers(triggers or [])
    if "image_url" in fields:
        _set_story_place_image(db, background, image_url)
        # A manual replacement no longer represents the old generated prompt/model.
        background.prompt = ""
        background.model = ""
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def delete_story_scene_background_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    background_id: int,
) -> None:
    require_story_visual_novel_admin(game, user)
    background = _get_story_scene_background_or_404(
        db,
        game_id=int(game.id),
        background_id=background_id,
    )
    db.delete(background)
    db.commit()


def import_story_place_template_impl(
    *,
    db: Session,
    game: StoryGame,
    user: Any,
    library_place_id: int,
    make_current: bool = False,
) -> StorySceneBackgroundOut:
    require_story_visual_novel_admin(game, user)
    template = db.scalar(
        select(StoryPlaceTemplate).where(
            StoryPlaceTemplate.id == int(library_place_id),
            StoryPlaceTemplate.user_id == int(user.id),
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place template not found")
    _ensure_story_scene_background_capacity(db, int(game.id))
    if make_current:
        for existing in list_story_scene_backgrounds(db, int(game.id)):
            existing.is_current = False
    background = StorySceneBackground(
        game_id=int(game.id),
        title=_normalize_story_place_title(template.title),
        prompt="",
        triggers=str(template.triggers or "[]"),
        theme="",
        style="",
        model="",
        image_url=template.image_url,
        image_data_url=template.image_data_url,
        is_current=bool(make_current),
    )
    db.add(background)
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def list_story_place_templates_impl(*, db: Session, user: Any) -> list[StoryPlaceTemplateOut]:
    require_story_visual_novel_profile_admin(user)
    templates = db.scalars(
        select(StoryPlaceTemplate)
        .where(StoryPlaceTemplate.user_id == int(user.id))
        .order_by(StoryPlaceTemplate.updated_at.desc(), StoryPlaceTemplate.id.desc())
    ).all()
    return [story_place_template_to_out(template) for template in templates]


def create_story_place_template_impl(
    *,
    db: Session,
    user: Any,
    title: str,
    triggers: list[str],
    image_url: str | None,
) -> StoryPlaceTemplateOut:
    require_story_visual_novel_profile_admin(user)
    template = StoryPlaceTemplate(
        user_id=int(user.id),
        title=_normalize_story_place_title(title),
        triggers=_serialize_story_scene_background_triggers(triggers),
    )
    _set_story_place_image(db, template, image_url)
    db.add(template)
    db.commit()
    db.refresh(template)
    return story_place_template_to_out(template)


def update_story_place_template_impl(
    *,
    db: Session,
    user: Any,
    template_id: int,
    fields: set[str],
    title: str | None = None,
    triggers: list[str] | None = None,
    image_url: str | None = None,
) -> StoryPlaceTemplateOut:
    require_story_visual_novel_profile_admin(user)
    template = db.scalar(
        select(StoryPlaceTemplate).where(
            StoryPlaceTemplate.id == int(template_id),
            StoryPlaceTemplate.user_id == int(user.id),
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place template not found")
    if "title" in fields:
        template.title = _normalize_story_place_title(title)
    if "triggers" in fields:
        template.triggers = _serialize_story_scene_background_triggers(triggers or [])
    if "image_url" in fields:
        _set_story_place_image(db, template, image_url)
    db.commit()
    db.refresh(template)
    return story_place_template_to_out(template)


def delete_story_place_template_impl(*, db: Session, user: Any, template_id: int) -> None:
    require_story_visual_novel_profile_admin(user)
    template = db.scalar(
        select(StoryPlaceTemplate).where(
            StoryPlaceTemplate.id == int(template_id),
            StoryPlaceTemplate.user_id == int(user.id),
        )
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place template not found")
    db.delete(template)
    db.commit()


def _set_current_story_scene_background(db: Session, *, game_id: int, background_id: int) -> None:
    backgrounds = db.scalars(
        select(StorySceneBackground).where(StorySceneBackground.game_id == game_id)
    ).all()
    for background in backgrounds:
        background.is_current = bool(background.id == background_id)


def _clear_current_story_scene_background(db: Session, *, game_id: int) -> None:
    """Drop back to the neutral gradient by unsetting whichever background is current."""
    backgrounds = db.scalars(
        select(StorySceneBackground).where(
            StorySceneBackground.game_id == game_id,
            StorySceneBackground.is_current.is_(True),
        )
    ).all()
    for background in backgrounds:
        background.is_current = False


def _story_scene_background_match_key(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def _story_scene_text_has_trigger(scene_text: str | None, trigger: str) -> bool:
    normalized_text = sanitize_likely_utf8_mojibake(str(scene_text or "")).casefold()
    normalized_trigger = _story_scene_background_match_key(trigger)
    if not normalized_text or not normalized_trigger:
        return False
    # Explicit Unicode word boundaries avoid accidental matches such as "лес" inside
    # "колесо", while multi-word triggers still tolerate arbitrary whitespace.
    trigger_pattern = r"\s+".join(re.escape(part) for part in normalized_trigger.split())
    return re.search(rf"(?<!\w){trigger_pattern}(?!\w)", normalized_text, flags=re.UNICODE) is not None


def find_matching_story_scene_background(
    db: Session,
    *,
    game_id: int,
    location_label: str | None,
    scene_text: str | None = None,
) -> StorySceneBackground | None:
    """Free, no-generation memory lookup: does a saved background's trigger match the
    current location? Used so re-entering a known location swaps the background instantly
    instead of generating a new one."""
    location_key = _story_scene_background_match_key(location_label)
    backgrounds = list_story_scene_backgrounds(db, game_id)
    exact_match: StorySceneBackground | None = None
    partial_matches: list[tuple[int, StorySceneBackground]] = []
    scene_matches: list[tuple[int, StorySceneBackground]] = []
    for background in backgrounds:
        trigger_values = _deserialize_story_scene_background_triggers(background.triggers)
        # Titles are presentation only. Activation is intentionally opt-in through triggers;
        # freshly generated cards have none and therefore cannot switch scenes by accident.
        candidate_keys = {_story_scene_background_match_key(trigger) for trigger in trigger_values}
        candidate_keys.discard("")
        if location_key and exact_match is None and location_key in candidate_keys:
            exact_match = background
        elif location_key:
            matching_partial_lengths = [
                len(candidate_key)
                for candidate_key in candidate_keys
                if _story_scene_text_has_trigger(location_key, candidate_key)
                or _story_scene_text_has_trigger(candidate_key, location_key)
            ]
            if matching_partial_lengths:
                partial_matches.append((max(matching_partial_lengths), background))

        matched_trigger_lengths = [
            len(_story_scene_background_match_key(trigger))
            for trigger in trigger_values
            if _story_scene_text_has_trigger(scene_text, trigger)
        ]
        if matched_trigger_lengths:
            scene_matches.append((max(matched_trigger_lengths), background))

    # A trigger explicitly present in the new scene is stronger than a stale location-memory
    # label. Prefer another place so mentioning the current place does not mask a real switch.
    non_current_scene_matches = [item for item in scene_matches if not bool(item[1].is_current)]
    if non_current_scene_matches:
        return max(non_current_scene_matches, key=lambda item: (item[0], int(item[1].id)))[1]
    if scene_matches:
        return max(scene_matches, key=lambda item: (item[0], int(item[1].id)))[1]
    if exact_match is not None:
        return exact_match
    if partial_matches:
        return max(partial_matches, key=lambda item: (item[0], int(item[1].id)))[1]
    return None


def _story_scene_background_matches_location(
    background: StorySceneBackground, location_label: str | None
) -> bool:
    """True when ``background`` still corresponds to the tracked location.

    A generated place may have no activation triggers yet, but its title still identifies the
    location where it was made. If the tracked location clearly changes, that old image must be
    cleared even when the new location has no saved card. When there is no reliable location label
    we conservatively keep the current image.
    """
    location_key = _story_scene_background_match_key(location_label)
    if not location_key:
        return True
    triggers = _deserialize_story_scene_background_triggers(getattr(background, "triggers", None))
    identity_values: list[str] = [str(getattr(background, "title", "") or ""), *triggers]
    for value in identity_values:
        value_key = _story_scene_background_match_key(value)
        if not value_key:
            continue
        if (
            value_key == location_key
            or value_key in location_key
            or location_key in value_key
            or _story_scene_text_has_trigger(location_label, value)
            or _story_scene_text_has_trigger(value, location_label)
        ):
            return True
    return False


def apply_story_scene_background_memory_for_turn(
    db: Session,
    *,
    game: StoryGame,
    location_label: str | None,
    scene_text: str | None = None,
) -> StorySceneBackground | None:
    """Called once per assistant turn for Visual Novel games.

    If the current location matches a remembered background and it isn't already current, switch
    to it for free (no generation). Otherwise, when the scene has clearly moved away from the
    current background (its triggers/title no longer match the tracked location) and nothing else
    matches, drop to the neutral gradient instead of stranding the previous location's art.
    Returns the resulting current background (``None`` == neutral gradient).
    """
    matched = find_matching_story_scene_background(
        db,
        game_id=int(game.id),
        location_label=location_label,
        scene_text=scene_text,
    )
    if matched is not None:
        if not bool(matched.is_current):
            _set_current_story_scene_background(db, game_id=int(game.id), background_id=int(matched.id))
            db.flush()
        return get_current_story_scene_background(db, int(game.id))

    current = get_current_story_scene_background(db, int(game.id))
    if current is not None and not _story_scene_background_matches_location(current, location_label):
        _clear_current_story_scene_background(db, game_id=int(game.id))
        db.flush()
        return None
    return current


# The under-the-hood service model (GLM 4.7) used for the extra per-turn place analysis.
STORY_NOVEL_SCENE_BACKGROUND_ANALYSIS_MODEL = POLZA_STORY_SERVICE_TEXT_MODEL


def _build_story_novel_scene_background_candidate_lines(
    backgrounds: list[StorySceneBackground],
) -> tuple[str, set[int]]:
    """Render saved places as ``id | title | triggers`` lines for the analysis prompt."""
    lines: list[str] = []
    valid_ids: set[int] = set()
    for background in backgrounds:
        bg_id = int(getattr(background, "id", 0) or 0)
        if bg_id <= 0:
            continue
        title = str(getattr(background, "title", "") or "").strip() or "без названия"
        triggers = _deserialize_story_scene_background_triggers(getattr(background, "triggers", None))
        triggers_text = ", ".join(triggers) if triggers else "—"
        lines.append(f'- id={bg_id} | название="{title}" | триггеры=[{triggers_text}]')
        valid_ids.add(bg_id)
    return "\n".join(lines), valid_ids


def _parse_story_novel_scene_background_decision(raw_response: str, valid_ids: set[int]) -> int | None:
    """Parse ``{"place_id": N}``.

    Returns the chosen background id, ``0`` for the neutral gradient, or ``None`` when the answer
    is unusable (unparseable or a hallucinated id) so the caller can fall back safely.
    """
    text = str(raw_response or "").strip()
    if not text:
        return None
    candidate_id: Any = None
    for match in re.finditer(r"\{[^{}]*\}", text, flags=re.DOTALL):
        try:
            data = json.loads(match.group(0))
        except (TypeError, ValueError):
            continue
        if isinstance(data, dict) and "place_id" in data:
            candidate_id = data.get("place_id")
            break
    if candidate_id is None:
        number_match = re.search(r"-?\d+", text)
        if number_match is not None:
            candidate_id = number_match.group(0)
    try:
        chosen = int(candidate_id)
    except (TypeError, ValueError):
        return None
    if chosen <= 0:
        return 0
    return chosen if chosen in valid_ids else None


def analyze_and_apply_story_novel_scene_background(
    db: Session,
    *,
    game: StoryGame,
    location_label: str | None,
    scene_text: str | None,
    latest_user_text: str | None,
    request_text: Callable[[list[dict[str, str]]], str],
) -> StorySceneBackground | None:
    """Visual-novel-only smarter background resolution (one extra GLM 4.7 call per turn).

    The under-the-hood model reads the tracked location, the latest player action and narrator
    reply, and the list of saved places (titles + triggers), then decides which saved place the
    CURRENT scene is in — tolerating imprecise/contextual wording (e.g. "пошли домой к Айри" →
    place "Дом Айри"). We switch the background to that place, keep it when the scene has not
    moved, or drop to the neutral gradient when the scene is somewhere not saved. Any failure
    falls back to the literal trigger memory so behaviour only ever degrades, never breaks.
    """
    backgrounds = list_story_scene_backgrounds(db, int(game.id))
    candidate_lines, valid_ids = _build_story_novel_scene_background_candidate_lines(backgrounds)
    if not valid_ids:
        # Nothing to match against — keep the literal-memory behaviour (also handles clearing).
        return apply_story_scene_background_memory_for_turn(
            db, game=game, location_label=location_label, scene_text=scene_text
        )

    current = get_current_story_scene_background(db, int(game.id))
    current_id = int(getattr(current, "id", 0) or 0) if current is not None else 0
    current_title = str(getattr(current, "title", "") or "").strip() if current is not None else ""

    scene_excerpt = sanitize_likely_utf8_mojibake(str(scene_text or "")).replace("\r\n", "\n").strip()
    if len(scene_excerpt) > 2000:
        scene_excerpt = scene_excerpt[-2000:].lstrip()
    user_excerpt = sanitize_likely_utf8_mojibake(str(latest_user_text or "")).replace("\r\n", "\n").strip()
    if len(user_excerpt) > 600:
        user_excerpt = user_excerpt[-600:].lstrip()
    location_line = sanitize_likely_utf8_mojibake(str(location_label or "").strip()) or "не указана"
    current_line = f'id={current_id} "{current_title}"' if current_id > 0 else "пустой (нейтральный фон)"

    system_content = (
        "Ты — режиссёр фонов визуальной новеллы. По ПОСЛЕДНЕМУ ОТВЕТУ РАССКАЗЧИКА и ходу игрока "
        "определи, где ФИЗИЧЕСКИ сейчас происходит сцена, и подбери подходящий фон из списка "
        "сохранённых мест.\n"
        "Главный источник истины — текст сцены (ответ рассказчика). Подсказка «локация из памяти» "
        "может отставать: если она противоречит тексту сцены, доверяй тексту сцены.\n"
        "Как выбирать:\n"
        "- Если сцена происходит в одном из сохранённых мест — даже если слова неточные, но по "
        "смыслу это оно (напр. «пошли домой к Айри» → «Дом Айри») — верни id этого места.\n"
        "- Если сцена происходит там, где НЕТ подходящего сохранённого места — верни 0. Это "
        "нормальный и правильный ответ, фон станет пустым. Не выбирай место «на всякий случай» и "
        "не держись за старый фон, если сцена явно переместилась в другое место.\n"
        "- Если сцена всё ещё в том же месте, что и текущий фон — верни id текущего фона.\n"
        'Отвечай строго JSON, без markdown и рассуждений: {"place_id": <id из списка или 0>}.'
    )
    user_content = (
        f"ПОСЛЕДНИЙ ОТВЕТ РАССКАЗЧИКА (главный источник — где мы сейчас):\n{scene_excerpt or '—'}\n\n"
        f"Последний ход игрока: {user_excerpt or '—'}\n"
        f"Подсказка — локация из памяти (может отставать): {location_line}\n"
        f"Текущий показанный фон: {current_line}\n\n"
        f"Сохранённые места (id | название | триггеры):\n{candidate_lines}\n\n"
        'Верни только JSON: {"place_id": <id из списка или 0>}.'
    )

    try:
        raw_response = request_text(
            [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ]
        )
    except Exception:
        logger.warning(
            "Novel scene background analysis LLM call failed; falling back to trigger memory: game_id=%s",
            getattr(game, "id", None),
        )
        return apply_story_scene_background_memory_for_turn(
            db, game=game, location_label=location_label, scene_text=scene_text
        )

    decision = _parse_story_novel_scene_background_decision(raw_response, valid_ids)
    logger.info(
        "VN scene background analysis: game_id=%s location=%r current_id=%s decision=%s valid_ids=%s raw=%r",
        getattr(game, "id", None),
        location_label,
        current_id,
        decision,
        sorted(valid_ids),
        str(raw_response or "")[:200],
    )
    if decision is None:
        # Unparseable / hallucinated id: never disrupt the scene on a bad answer.
        return apply_story_scene_background_memory_for_turn(
            db, game=game, location_label=location_label, scene_text=scene_text
        )

    if decision > 0:
        if decision != current_id:
            _set_current_story_scene_background(db, game_id=int(game.id), background_id=decision)
            db.flush()
        return get_current_story_scene_background(db, int(game.id))

    # decision == 0 → the scene is at an unremembered location → drop to the neutral gradient.
    if current is not None:
        _clear_current_story_scene_background(db, game_id=int(game.id))
        db.flush()
    return None


def _collect_story_world_setting(world_cards: list[StoryWorldCard]) -> tuple[str, str]:
    """Assemble the setting/lore text that drives the background's genre, era and aesthetic.

    The primary setting lives on the ``world_profile`` card (the "Мир" profile at the top of the
    right panel — e.g. a fantasy or cyberpunk premise); ``world`` cards add locations/lore. NPC and
    main-hero cards are deliberately excluded so the background never depicts named story characters.
    Returns ``(primary_title, combined_description)``.
    """
    primary_title = ""
    sections: list[str] = []
    for kind in (STORY_WORLD_CARD_KIND_WORLD_PROFILE, STORY_WORLD_CARD_KIND_WORLD):
        for card in world_cards:
            if str(getattr(card, "kind", "") or "").strip().lower() != kind:
                continue
            title = sanitize_likely_utf8_mojibake(str(getattr(card, "title", "") or "")).strip()
            content = sanitize_likely_utf8_mojibake(str(getattr(card, "content", "") or "")).strip()
            if kind == STORY_WORLD_CARD_KIND_WORLD_PROFILE and not primary_title and title:
                primary_title = title
            block = "\n".join(part for part in (title, content) if part)
            if block:
                sections.append(block)
    return primary_title, "\n\n".join(sections)


def _collect_story_active_character_context(world_cards: list[StoryWorldCard]) -> str:
    """Compact enabled character cards for conditional environment inference."""
    sections: list[str] = []
    for card in world_cards:
        kind = str(getattr(card, "kind", "") or "").strip().lower()
        if kind not in {STORY_WORLD_CARD_KIND_MAIN_HERO, STORY_WORLD_CARD_KIND_NPC}:
            continue
        if kind == STORY_WORLD_CARD_KIND_NPC and getattr(card, "memory_turns", None) == 0:
            continue
        title = sanitize_likely_utf8_mojibake(str(getattr(card, "title", "") or "")).strip()
        content = sanitize_likely_utf8_mojibake(str(getattr(card, "content", "") or "")).strip()
        if not title or not content:
            continue
        details: list[str] = []
        for label, field_name in (
            ("race", "race"),
            ("clothing", "clothing"),
            ("inventory", "inventory"),
            ("health", "health_status"),
        ):
            value = sanitize_likely_utf8_mojibake(str(getattr(card, field_name, "") or "")).strip()
            if value:
                details.append(f"{label}: {value[:320]}")
        role = "player protagonist" if kind == STORY_WORLD_CARD_KIND_MAIN_HERO else "NPC"
        sections.append("\n".join([f"{role}: {title}", content[:1_600], *details]))
    return "\n\n".join(sections)


def _build_scene_background_prompt_messages(
    *,
    world_title: str,
    world_content: str,
    genres: list[str],
    image_style_prompt: str,
    location_label: str,
    latest_user_prompt: str,
    latest_assistant_text: str,
    active_character_context: str = "",
    requested_description: str = "",
) -> list[dict[str, str]]:
    genre_line = ", ".join(genre for genre in genres if genre) or "не указан"
    system_content = (
        "Ты — художник-постановщик фонов для визуальной новеллы. Сформируй один короткий детальный "
        "промпт (на английском) для генерации ОДНОГО фона сцены — только локация и обстановка.\n"
        "СЕТТИНГ ГЛАВНЕЕ ВСЕГО: жанр, эпоха, технологии и общая эстетика мира заданы КАРТОЧКОЙ МИРА "
        "и являются обязательными. Если мир фэнтезийный — фон должен быть фэнтезийным (никаких "
        "небоскрёбов, машин, неона), если киберпанк — киберпанковым, и т.д. НЕ переноси сеттинг из "
        "слов последнего хода: текст хода задаёт только КОНКРЕТНОЕ место внутри этого мира и есть ли "
        "там сейчас люди, но НЕ меняет эпоху/жанр мира.\n"
        "ПЕРСОНАЖИ: категорически БЕЗ именованных персонажей истории и БЕЗ главного героя (ГГ) — их "
        "вообще не должно быть на фоне. Если из сцены явно следует, что локация сейчас людная "
        "(рынок, таверна, клуб, площадь, людная улица) — допустима только безымянная массовка общими "
        "словами (distant anonymous crowd, silhouettes, background figures), без узнаваемых лиц и "
        "деталей. Если сцена уединённая, ночная пустая улица, чей-то дом и т.п. — людей не добавляй "
        "вообще.\n"
        "КАРТОЧКИ ПЕРСОНАЖЕЙ — ТОЛЬКО УСЛОВНЫЙ КОНТЕКСТ МЕСТА: они не доказывают присутствие в кадре. "
        "Используй достаток, культуру, профессию, класс, привычки или магическую/технологическую специализацию "
        "персонажа только если фон явно является его домом, комнатой, владением, рабочим местом либо иначе прямо "
        "связан с ним. Переводи свойства в детали окружения: материалы, мебель, инструменты, символы и следы образа "
        "жизни. Если связь не подтверждена названием, описанием или сценой — полностью игнорируй карточку. Не смешивай "
        "свойства разных персонажей, не придумывай владельца и никогда не изображай именованного персонажа.\n"
        'Return JSON only: {"prompt": string, "location_title": string, "has_people": boolean}. '
        "has_people=true только если нужна массовка. No markdown, no commentary, no reasoning, no extra keys."
    )
    user_content = (
        f"КАРТОЧКА МИРА (СЕТТИНГ — ОБЯЗАТЕЛЕН):\n{world_title or 'не указано'}\n"
        f"{world_content or 'не указано'}\n\n"
        f"ЖАНРЫ: {genre_line}\n\n"
        f"ТЕКУЩАЯ ЛОКАЦИЯ (место внутри мира): {location_label or 'не указана'}\n\n"
        f"СТИЛЬ ИЗОБРАЖЕНИЯ: {image_style_prompt or 'не указан'}\n\n"
        f"ОПИСАНИЕ ФОНА ОТ ИГРОКА (при наличии это главный запрос к месту):\n{requested_description or '(нет)'}\n\n"
        f"АКТИВНЫЕ ПЕРСОНАЖИ (использовать только при доказанной связи с местом):\n{active_character_context or '(нет)'}\n\n"
        f"ПОСЛЕДНИЙ ХОД ИГРОКА (только для выбора места и наличия людей):\n{latest_user_prompt or '(нет)'}\n\n"
        f"ОТВЕТ РАССКАЗЧИКА (только для выбора места и наличия людей):\n{latest_assistant_text or '(нет)'}"
    )
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]


def _request_scene_background_prompt_text(messages: list[dict[str, str]], **kwargs: Any) -> str:
    from app.services.story_generation_provider import _request_polza_story_text

    return _request_polza_story_text(
        messages,
        model_name=str(kwargs.get("model_name") or POLZA_STORY_SERVICE_TEXT_MODEL),
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
    requested_description: str = "",
    requested_style_prompt: str | None = None,
) -> SceneBackgroundPromptPayload:
    world_title, world_content = _collect_story_world_setting(world_cards)
    active_character_context = _collect_story_active_character_context(world_cards)
    genres = deserialize_story_game_genres(getattr(game, "genres", None))
    image_style_prompt = str(
        requested_style_prompt
        if requested_style_prompt is not None
        else getattr(game, "image_style_prompt", "") or ""
    )

    messages = _build_scene_background_prompt_messages(
        world_title=world_title,
        world_content=world_content,
        genres=genres,
        image_style_prompt=image_style_prompt,
        location_label=location_label,
        latest_user_prompt=sanitize_likely_utf8_mojibake(latest_user_prompt),
        latest_assistant_text=sanitize_likely_utf8_mojibake(latest_assistant_text),
        active_character_context=active_character_context,
        requested_description=sanitize_likely_utf8_mojibake(requested_description),
    )
    service = LlmModuleService(
        _request_scene_background_prompt_text,
        primary_model=POLZA_STORY_SERVICE_TEXT_MODEL,
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
    allow_background_crowd: bool = False,
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
        "Wide establishing environmental background shot, no foreground UI, no text, no watermark.",
        (
            "No named, main, recognizable, or foreground characters. Anonymous distant crowd "
            "figures are allowed only because this is a naturally populated public place."
            if allow_background_crowd
            else "Completely empty of people and characters; environment and scenery only."
        ),
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
    assistant_message_id: int | None = None,
    requested_title: str | None = None,
    place_id: int | None = None,
    requested_description: str | None = None,
    requested_style_prompt: str | None = None,
    requested_image_model: str | None = None,
    requested_triggers: list[str] | None = None,
    make_current: bool | None = None,
    create_new_place: bool = False,
) -> StorySceneBackgroundOut:
    from app.services.story_visuals import (
        _get_story_turn_image_cost_tokens,
        _limit_story_turn_image_request_prompt,
        _request_story_turn_image,
        _story_turn_image_style_prompt_requests_anime,
        _story_turn_image_style_prompt_requests_realism,
    )

    require_story_visual_novel_admin(game, user)

    if place_id is not None:
        target_background = _get_story_scene_background_or_404(
            db,
            game_id=int(game.id),
            background_id=int(place_id),
        )
    elif create_new_place:
        target_background = None
    else:
        current_background = get_current_story_scene_background(db, int(game.id))
        generated_turn_id = (
            int(getattr(current_background, "generated_for_assistant_message_id", 0) or 0)
            if current_background is not None
            else 0
        )
        # Compatibility for games created before turn ownership existed: without a turn id,
        # preserve the old same-card behavior. Normal API calls always provide the latest id.
        target_background = (
            current_background
            if assistant_message_id is None or generated_turn_id == int(assistant_message_id)
            else None
        )
    if target_background is None:
        _ensure_story_scene_background_capacity(db, int(game.id))

    composer_location_label = (
        sanitize_likely_utf8_mojibake(str(requested_title or "")).strip()
        if requested_description or create_new_place
        else ""
    ) or location_label
    scene_payload = generate_story_scene_background_prompt(
        game=game,
        world_cards=world_cards,
        location_label=composer_location_label,
        latest_user_prompt=latest_user_prompt,
        latest_assistant_text=latest_assistant_text,
        requested_description=str(requested_description or ""),
        requested_style_prompt=requested_style_prompt,
    )
    image_style_prompt = str(
        requested_style_prompt
        if requested_style_prompt is not None
        else getattr(game, "image_style_prompt", "") or ""
    )
    final_prompt = _build_final_scene_background_image_prompt(
        scene_prompt=scene_payload.prompt or composer_location_label or "Empty establishing background",
        image_style_prompt=image_style_prompt,
        allow_background_crowd=bool(scene_payload.has_people),
    )
    selected_image_model = coerce_story_image_model(
        requested_image_model if requested_image_model else getattr(game, "image_model", None)
    )
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

    generated_location_title = (
        sanitize_likely_utf8_mojibake(str(scene_payload.location_title or "").strip())
        or sanitize_likely_utf8_mojibake(str(location_label or "").strip())
        or "Фон сцены"
    )
    requested_location_title = sanitize_likely_utf8_mojibake(str(requested_title or "").strip())
    location_title = (
        requested_location_title
        or (str(target_background.title or "").strip() if target_background is not None else "")
        or generated_location_title
    )

    effective_make_current = (not create_new_place) if make_current is None else bool(make_current)
    if effective_make_current:
        existing_backgrounds = list_story_scene_backgrounds(db, int(game.id))
        for existing_background in existing_backgrounds:
            existing_background.is_current = False

    background = target_background
    if background is None:
        # Generation creates a place card, but activation triggers remain an explicit player
        # choice. We must not silently teach an imprecise LLM-derived trigger.
        background = StorySceneBackground(
            game_id=int(game.id),
            title=_normalize_story_place_title(location_title),
            prompt="",
            triggers=_serialize_story_scene_background_triggers(requested_triggers or []),
            theme="",
            style="",
            model="",
            is_current=effective_make_current,
        )
        db.add(background)
    elif requested_location_title:
        background.title = _normalize_story_place_title(requested_location_title)
    if background is not None and requested_triggers is not None:
        background.triggers = _serialize_story_scene_background_triggers(requested_triggers)

    background.prompt = final_prompt
    background.style = (
        "anime"
        if _story_turn_image_style_prompt_requests_anime(image_style_prompt)
        else "realism"
        if _story_turn_image_style_prompt_requests_realism(image_style_prompt)
        else ""
    )
    background.model = str(generation_result.get("model") or selected_image_model)
    background.image_url = generation_result.get("image_url")
    background.image_data_url = generation_result.get("image_data_url")
    background.generated_for_assistant_message_id = assistant_message_id
    background.is_current = effective_make_current or bool(background.is_current)
    db.commit()
    db.refresh(background)
    return story_scene_background_to_out(background)


def generate_story_place_template_background_impl(
    *,
    db: Session,
    user: Any,
    title: str,
    description: str,
    style_prompt: str | None,
    image_model: str | None,
    triggers: list[str],
    template_id: int | None = None,
) -> StoryPlaceTemplateOut:
    from app.services.story_visuals import (
        _get_story_turn_image_cost_tokens,
        _limit_story_turn_image_request_prompt,
        _request_story_turn_image,
    )

    require_story_visual_novel_profile_admin(user)
    template = None
    if template_id is not None:
        template = db.scalar(
            select(StoryPlaceTemplate).where(
                StoryPlaceTemplate.id == int(template_id),
                StoryPlaceTemplate.user_id == int(user.id),
            )
        )
        if template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place template not found")
    normalized_title = _normalize_story_place_title(title)
    normalized_description = sanitize_likely_utf8_mojibake(str(description or "")).strip()
    if not normalized_description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Background description cannot be empty")
    normalized_style = sanitize_likely_utf8_mojibake(str(style_prompt or "")).strip()
    selected_image_model = coerce_story_image_model(image_model)
    final_prompt = _build_final_scene_background_image_prompt(
        scene_prompt=(
            f"Location: {normalized_title}. {normalized_description}. "
            "Environment-only visual novel background; express the requested place through architecture, materials, objects and atmosphere."
        ),
        image_style_prompt=normalized_style,
        allow_background_crowd=False,
    )
    final_prompt = _limit_story_turn_image_request_prompt(final_prompt, model_name=selected_image_model)
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
            logger.exception("Story place template token refund failed: user_id=%s", user.id)
        logger.exception("Story place template background generation failed: user_id=%s", user.id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Background generation failed") from exc

    if template is None:
        template = StoryPlaceTemplate(user_id=int(user.id), title=normalized_title, triggers="[]")
        db.add(template)
    template.title = normalized_title
    template.triggers = _serialize_story_scene_background_triggers(triggers)
    _set_story_place_image(
        db,
        template,
        generation_result.get("image_data_url") or generation_result.get("image_url"),
    )
    db.commit()
    db.refresh(template)
    return story_place_template_to_out(template)


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
