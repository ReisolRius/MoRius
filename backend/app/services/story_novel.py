from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import StoryCharacter, StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard
from app.schemas import StoryNovelBeatOut
from app.services.media import resolve_media_display_url
from app.services.story_emotions import (
    STORY_CHARACTER_DEFAULT_EMOTION,
    STORY_CHARACTER_EMOTION_IDS,
    STORY_CHARACTER_EMOTION_LABELS,
    deserialize_story_character_emotion_assets,
    normalize_story_character_emotion_id,
    normalize_story_novel_sprite_gender,
)
from app.services.text_encoding import sanitize_likely_utf8_mojibake

# --- Game mode (chosen once at creation; Visual Novel is admin-only) -------------------
STORY_GAME_MODE_RPG = "rpg"
STORY_GAME_MODE_VISUAL_NOVEL = "visual_novel"
STORY_GAME_MODES = {STORY_GAME_MODE_RPG, STORY_GAME_MODE_VISUAL_NOVEL}

# --- Visual Novel beat kinds (one beat == one "Далее" page) ----------------------------
STORY_NOVEL_BEAT_NARRATION = "narration"
STORY_NOVEL_BEAT_DIALOGUE = "dialogue"
STORY_NOVEL_BEAT_THOUGHT = "thought"
STORY_NOVEL_BEAT_KINDS = {
    STORY_NOVEL_BEAT_NARRATION,
    STORY_NOVEL_BEAT_DIALOGUE,
    STORY_NOVEL_BEAT_THOUGHT,
}
STORY_NOVEL_SPEAKER_BEAT_KINDS = {STORY_NOVEL_BEAT_DIALOGUE, STORY_NOVEL_BEAT_THOUGHT}


def normalize_story_game_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in STORY_GAME_MODES:
        return normalized
    if normalized in {"vn", "novel", "visual", "visualnovel", "visual_novella", "novella"}:
        return STORY_GAME_MODE_VISUAL_NOVEL
    return STORY_GAME_MODE_RPG


def is_story_user_administrator(user: Any) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == "administrator"


def is_story_visual_novel_game(game: Any) -> bool:
    return normalize_story_game_mode(getattr(game, "game_mode", None)) == STORY_GAME_MODE_VISUAL_NOVEL


def can_user_use_story_visual_novel(user: Any) -> bool:
    """Visual Novel mode is an admin-only feature while it is being developed/tested."""
    return is_story_user_administrator(user)


def is_story_visual_novel_enabled(game: Any, user: Any) -> bool:
    return can_user_use_story_visual_novel(user) and is_story_visual_novel_game(game)


def normalize_story_novel_beat_kind(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in STORY_NOVEL_BEAT_KINDS:
        return normalized
    return STORY_NOVEL_BEAT_NARRATION


def _resolve_story_novel_sprite(
    character: StoryCharacter | None,
    emotion: str | None,
) -> tuple[str | None, bool, str | None]:
    """Return (sprite_url, is_incognito, gender) for a speaking character's emotion.

    Falls back exact-emotion -> neutral -> any uploaded sprite; if the character has no
    uploaded sprites at all, returns the incognito silhouette by gender.
    """
    if character is None:
        return None, True, None

    gender = normalize_story_novel_sprite_gender(getattr(character, "novel_sprite_gender", None)) or None
    assets = deserialize_story_character_emotion_assets(getattr(character, "emotion_assets", None))
    if not assets:
        return None, True, gender

    resolved_emotion = normalize_story_character_emotion_id(emotion) or STORY_CHARACTER_DEFAULT_EMOTION
    candidate_order = [resolved_emotion, STORY_CHARACTER_DEFAULT_EMOTION, *assets.keys()]
    seen: set[str] = set()
    for emotion_candidate in candidate_order:
        if not emotion_candidate or emotion_candidate in seen:
            continue
        seen.add(emotion_candidate)
        raw_asset = assets.get(emotion_candidate)
        if not raw_asset:
            continue
        sprite_url = resolve_media_display_url(
            raw_asset,
            kind="story-character-emotion-asset",
            entity_id=int(character.id),
            version=getattr(character, "updated_at", None),
            asset_id=emotion_candidate,
        )
        if sprite_url:
            return sprite_url, False, gender

    return None, True, gender


def _story_novel_beat_to_out(
    beat: StoryNovelBeat,
    *,
    character: StoryCharacter | None = None,
) -> StoryNovelBeatOut:
    kind = normalize_story_novel_beat_kind(getattr(beat, "kind", None))
    emotion = normalize_story_character_emotion_id(getattr(beat, "emotion", None))
    sprite_url: str | None = None
    sprite_incognito = False
    sprite_gender: str | None = None
    if kind in STORY_NOVEL_SPEAKER_BEAT_KINDS:
        sprite_url, sprite_incognito, sprite_gender = _resolve_story_novel_sprite(character, emotion)
    return StoryNovelBeatOut(
        id=int(beat.id),
        game_id=int(beat.game_id),
        message_id=int(beat.message_id),
        order_index=max(int(getattr(beat, "order_index", 0) or 0), 0),
        kind=kind,  # type: ignore[arg-type]
        speaker_name=(str(getattr(beat, "speaker_name", "") or "").strip() or None),
        speaker_character_id=(
            int(character.id)
            if character is not None
            else int(beat.speaker_character_id)
            if getattr(beat, "speaker_character_id", None)
            else None
        ),
        emotion=emotion,
        text=str(getattr(beat, "text", "") or ""),
        sprite_url=sprite_url,
        sprite_incognito=sprite_incognito,
        sprite_gender=sprite_gender,
        created_at=beat.created_at,
        updated_at=beat.updated_at,
    )


def resolve_story_novel_beats_for_read(
    db: Session,
    beats: list[StoryNovelBeat],
) -> list[StoryNovelBeatOut]:
    """Serialize beats and resolve current sprites, including legacy unlinked beats.

    Early Visual Novel builds persisted only ``speaker_name`` when a world card had not yet
    been linked to its character.  Treat ``speaker_character_id`` as the fast path, then relink
    read-only from the game's current cards.  This makes old turns and cards linked after the
    turn immediately pick up their uploaded emotion sprites without rewriting history in a GET.
    """
    if not beats:
        return []

    game_ids = {
        int(getattr(beat, "game_id", 0) or 0)
        for beat in beats
        if int(getattr(beat, "game_id", 0) or 0) > 0
    }
    direct_character_ids = {
        int(beat.speaker_character_id)
        for beat in beats
        if getattr(beat, "speaker_character_id", None)
    }
    games = {
        int(game.id): game
        for game in db.scalars(select(StoryGame).where(StoryGame.id.in_(game_ids))).all()
    } if game_ids else {}
    cards_by_game: dict[int, list[StoryWorldCard]] = {game_id: [] for game_id in game_ids}
    if game_ids:
        for card in db.scalars(select(StoryWorldCard).where(StoryWorldCard.game_id.in_(game_ids))).all():
            cards_by_game.setdefault(int(card.game_id), []).append(card)

    resolved_context_by_game: dict[int, tuple[dict[str, int], dict[int, StoryCharacter]]] = {}
    for game_id in game_ids:
        resolved_context_by_game[game_id] = _build_novel_speaker_character_context(
            db,
            game=games.get(game_id),
            world_cards=cards_by_game.get(game_id, []),
            extra_character_ids=direct_character_ids,
        )

    output: list[StoryNovelBeatOut] = []
    for beat in beats:
        game_id = int(getattr(beat, "game_id", 0) or 0)
        speaker_map, characters = resolved_context_by_game.get(game_id, ({}, {}))
        direct_character_id = int(getattr(beat, "speaker_character_id", 0) or 0)
        character = characters.get(direct_character_id) if direct_character_id > 0 else None
        if character is None:
            recovered_character_id = _resolve_novel_speaker_character_id(
                getattr(beat, "speaker_name", None),
                speaker_map,
            )
            character = characters.get(recovered_character_id) if recovered_character_id else None
        output.append(_story_novel_beat_to_out(beat, character=character))
    return output


# =====================================================================================
# Visual Novel narration contract + beat parsing
# =====================================================================================

VN_MAX_BEATS_PER_MESSAGE = 48
VN_MAX_BEAT_TEXT_CHARS = 1_400
VN_NARRATION_PAGE_MAX_CHARS = 300

# Visual Novel mode consumes the same canonical speaker protocol as every other story mode.
_VN_CANONICAL_SPEAKER_LINE = re.compile(
    # GG_REPLICK is read-only compatibility for saved/generated opening scenes from the
    # pre-canonical prototype.  New instructions and generated turns use [[GG:...]] only.
    r"^\s*\[\[\s*(?P<marker>NPC|GG|GG_REPLICK|NPC_THOUGHT|GG_THOUGHT)\s*:\s*"
    r"(?P<name>[^\]\n]{1,60}?)\s*\]\]\s+(?P<text>.+)$",
    re.IGNORECASE,
)
# Visual Novel-only emotion cue.  It lives in the body, not inside the universal marker, so
# ``[[NPC:Exact title]]`` remains byte-for-byte compatible with the shared MoRius protocol.
# Unknown parenthesized prose is deliberately left untouched.
_VN_CANONICAL_EMOTION_PREFIX = re.compile(
    r"^\s*\((?P<emotion>[^)\n]{1,40})\)\s*:?[ \t]*(?P<text>.+)$",
    re.IGNORECASE,
)
# Read-only compatibility for replies produced before Visual Novel mode adopted the shared
# marker contract. New narrator instructions never request this legacy shape.
_VN_LEGACY_SPEAKER_LINE = re.compile(
    r"^\s*(?:[-–—]\s*)?(?P<name>[^:\n\[\]]{1,60}?)\s*"
    r"(?:\[(?P<emotion>[^\]]{1,40})\])?\s*:\s+(?P<text>.+)$"
)
_VN_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+(?=[«\"A-ZА-ЯЁ0-9])")


def build_story_novel_instruction_card() -> dict[str, str]:
    """The extra narrator instruction injected only for admin Visual Novel games.

    It reinforces the universal MoRius speaker markers so the parser can split the answer into
    beats without introducing a competing Visual Novel-only dialogue syntax.
    """
    emotion_labels = ", ".join(
        STORY_CHARACTER_EMOTION_LABELS.get(emotion_id, emotion_id)
        for emotion_id in STORY_CHARACTER_EMOTION_IDS
    )
    return {
        "title": "Формат визуальной новеллы",
        "content": (
            "[РЕЖИМ ВИЗУАЛЬНОЙ НОВЕЛЛЫ]\n"
            "Оформляй ответ так, чтобы его можно было показывать по отдельным репликам.\n"
            "Каждую реплику выноси в отдельный абзац и начинай только с [[NPC:Имя]] или [[GG:Имя]].\n"
            "Сразу после маркера ставь эмоцию в круглых скобках, затем текст: [[NPC:Точный title]] (злость) Текст реплики.\n"
            f"Эмоция — ровно одно слово из списка: {emotion_labels}. У каждой реплики и мысли эмоция обязательна.\n"
            "[[GG:Имя]] используй только для дословной цитаты речи, введённой игроком; не придумывай за него новые реплики.\n"
            "Если активные инструкции разрешают показывать мысли, оформляй их отдельными абзацами: [[NPC_THOUGHT:Имя]] (эмоция) Текст мысли или [[GG_THOUGHT:Имя]] (эмоция) Текст мысли.\n"
            "Для известного персонажа всегда копируй точный title его карточки без сокращений и вариантов.\n"
            "Новому или непрописанному NPC до первой реплики дай устойчивое естественное имя и дальше не меняй его.\n"
            "Если имя по логике сцены пока нельзя раскрывать, используй конкретную устойчивую роль не длиннее четырёх слов; после раскрытия используй его имя.\n"
            "Никогда не используй общие обозначения НПС, NPC, Голос, Незнакомец и Персонаж вместо имени или конкретной роли.\n"
            "Любая произнесённая вслух реплика, включая шёпот, возглас из толпы и речь за кадром, обязана иметь маркер говорящего; не оставляй речь обычным текстом.\n"
            "Описания сцены, действия и обстановку пиши обычными абзацами без маркера.\n"
            "Не ставь двоеточие после имени, не добавляй эмоцию внутрь [[...]]-маркера и не используй других служебных пометок."
        ),
        "source_kind": "visual_novel",
    }


@dataclass(frozen=True)
class _NormalizedNovelBeat:
    kind: str
    text: str
    speaker_name: str | None
    emotion: str | None


def _normalize_novel_text(value: Any, *, max_length: int = VN_MAX_BEAT_TEXT_CHARS) -> str:
    normalized = sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", "\n").strip()
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip()
    return normalized


def _normalize_novel_speaker_name(value: Any) -> str | None:
    normalized = " ".join(str(value or "").split()).strip(" .,:;!?\"'()[]«»")
    if not normalized or len(normalized) > 60:
        return None
    if normalized.casefold() in {"narrator", "рассказчик", "автор", "система", "system", "scene", "сцена"}:
        return None
    return normalized


def _split_novel_narration_pages(text: str) -> list[str]:
    normalized = _normalize_novel_text(text)
    if not normalized:
        return []
    if len(normalized) <= VN_NARRATION_PAGE_MAX_CHARS:
        return [normalized]
    pages: list[str] = []
    current = ""
    for sentence in _VN_SENTENCE_SPLIT.split(normalized):
        candidate = f"{current} {sentence}".strip() if current else sentence.strip()
        if current and len(candidate) > VN_NARRATION_PAGE_MAX_CHARS:
            pages.append(current)
            current = sentence.strip()
        else:
            current = candidate
    if current:
        pages.append(current)
    return pages or [normalized]


def parse_story_novel_beats(raw_response: str) -> list[_NormalizedNovelBeat]:
    raw_text = sanitize_likely_utf8_mojibake(str(raw_response or "")).replace("\r\n", "\n").strip()
    if not raw_text:
        return []

    beats: list[_NormalizedNovelBeat] = []
    narration_buffer: list[str] = []

    def flush_narration() -> None:
        if not narration_buffer:
            return
        merged = "\n".join(narration_buffer).strip()
        narration_buffer.clear()
        for page in _split_novel_narration_pages(merged):
            beats.append(
                _NormalizedNovelBeat(kind=STORY_NOVEL_BEAT_NARRATION, text=page, speaker_name=None, emotion=None)
            )

    for raw_line in raw_text.split("\n"):
        line = raw_line.strip()
        if not line:
            flush_narration()
            continue
        canonical_match = _VN_CANONICAL_SPEAKER_LINE.match(line)
        legacy_match = None if canonical_match else _VN_LEGACY_SPEAKER_LINE.match(line)
        match = canonical_match or legacy_match
        speaker_name = _normalize_novel_speaker_name(match.group("name")) if match else None
        if canonical_match and speaker_name:
            flush_narration()
            marker = str(canonical_match.group("marker") or "").strip().upper()
            text = canonical_match.group("text").strip()
            emotion = STORY_CHARACTER_DEFAULT_EMOTION
            emotion_match = _VN_CANONICAL_EMOTION_PREFIX.match(text)
            if emotion_match is not None:
                parsed_emotion = normalize_story_character_emotion_id(emotion_match.group("emotion"))
                if parsed_emotion is not None:
                    emotion = parsed_emotion
                    text = emotion_match.group("text").strip()
            is_thought = marker in {"NPC_THOUGHT", "GG_THOUGHT"}
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_THOUGHT if is_thought else STORY_NOVEL_BEAT_DIALOGUE,
                    text=_normalize_novel_text(text),
                    speaker_name=speaker_name,
                    emotion=emotion,
                )
            )
        elif legacy_match and speaker_name:
            flush_narration()
            text = legacy_match.group("text").strip()
            is_thought = text.startswith("(") and text.endswith(")")
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_THOUGHT if is_thought else STORY_NOVEL_BEAT_DIALOGUE,
                    text=_normalize_novel_text(text.strip("()").strip() if is_thought else text),
                    speaker_name=speaker_name,
                    emotion=(
                        normalize_story_character_emotion_id(legacy_match.group("emotion"))
                        or STORY_CHARACTER_DEFAULT_EMOTION
                    ),
                )
            )
        else:
            narration_buffer.append(line)
        if len(beats) >= VN_MAX_BEATS_PER_MESSAGE:
            break
    flush_narration()

    normalized_beats = [beat for beat in beats if beat.text][:VN_MAX_BEATS_PER_MESSAGE]
    if not normalized_beats and raw_text:
        normalized_beats = [
            _NormalizedNovelBeat(
                kind=STORY_NOVEL_BEAT_NARRATION,
                text=_normalize_novel_text(raw_text),
                speaker_name=None,
                emotion=None,
            )
        ]
    return normalized_beats


def _story_speaker_key(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip()).casefold().replace("ё", "е")
    return normalized.strip(" .,:;!?\"'()[]«»")


def _deserialize_world_card_triggers(raw_value: str | None) -> list[str]:
    normalized = str(raw_value or "").strip()
    if not normalized:
        return []
    try:
        parsed = json.loads(normalized)
    except (TypeError, ValueError):
        parsed = [item.strip() for item in normalized.split(",")]
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item or "").strip()]


def _story_character_lookup_keys(character: StoryCharacter) -> set[str]:
    return _story_character_identity_lookup_keys(
        getattr(character, "name", None),
        getattr(character, "triggers", None),
    )


def _story_character_identity_lookup_keys(name: Any, triggers: Any) -> set[str]:
    values = [
        name,
        *_deserialize_world_card_triggers(triggers),
    ]
    return {key for value in values if (key := _story_speaker_key(value))}


def _story_world_card_lookup_keys(card: StoryWorldCard) -> set[str]:
    values = [
        getattr(card, "title", None),
        *_deserialize_world_card_triggers(getattr(card, "triggers", None)),
    ]
    return {key for value in values if (key := _story_speaker_key(value))}


def _story_character_sprite_priority(character: StoryCharacter) -> tuple[int, int]:
    has_uploaded_sprite = bool(
        deserialize_story_character_emotion_assets(getattr(character, "emotion_assets", None))
    )
    return (1 if has_uploaded_sprite else 0, int(getattr(character, "id", 0) or 0))


def _find_character_for_unlinked_card(
    card: StoryWorldCard,
    characters: list[StoryCharacter],
) -> StoryCharacter | None:
    """Recover a card -> character link by stable title/trigger identity.

    This is intentionally exact (case/whitespace/``ё`` insensitive), never a broad SQL name
    search.  If duplicate private characters share the identity, the newest one with an
    uploaded sprite wins, which is the useful migration path for cards created before emotion
    packs forced a persistent ``character_id``.
    """
    card_keys = _story_world_card_lookup_keys(card)
    if not card_keys:
        return None
    candidates = [
        character
        for character in characters
        if card_keys.intersection(_story_character_lookup_keys(character))
    ]
    if not candidates:
        return None
    return max(candidates, key=_story_character_sprite_priority)


def _build_novel_speaker_character_map(
    world_cards: list[StoryWorldCard],
    *,
    resolved_character_id_by_card_id: dict[int, int] | None = None,
) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for card in world_cards:
        card_id = int(getattr(card, "id", 0) or 0)
        character_id = (
            (resolved_character_id_by_card_id or {}).get(card_id)
            or getattr(card, "character_id", None)
        )
        if not character_id:
            continue
        for key in _story_world_card_lookup_keys(card):
            mapping.setdefault(key, int(character_id))
    return mapping


def _build_novel_speaker_character_context(
    db: Session,
    *,
    game: StoryGame | None,
    world_cards: list[StoryWorldCard],
    extra_character_ids: set[int] | None = None,
) -> tuple[dict[str, int], dict[int, StoryCharacter]]:
    """Return (speaker lookup, loaded characters) for persist, SSE and historical reads."""
    requested_character_ids = {
        int(character_id)
        for character_id in [
            *(extra_character_ids or set()),
            *(getattr(card, "character_id", None) for card in world_cards),
        ]
        if character_id
    }
    characters_by_id: dict[int, StoryCharacter] = {}
    if requested_character_ids:
        for character in db.scalars(
            select(StoryCharacter).where(StoryCharacter.id.in_(requested_character_ids))
        ).all():
            characters_by_id[int(character.id)] = character

    owner_characters: list[StoryCharacter] = []
    owner_user_id = int(getattr(game, "user_id", 0) or 0) if game is not None else 0
    if owner_user_id > 0:
        # Emotion packs may contain large data URLs.  Scan only lightweight identity columns,
        # then hydrate the handful of characters that can actually match a card in this game.
        card_lookup_keys = {
            key
            for card in world_cards
            for key in _story_world_card_lookup_keys(card)
        }
        matching_owner_character_ids = {
            int(row.id)
            for row in db.execute(
                select(StoryCharacter.id, StoryCharacter.name, StoryCharacter.triggers).where(
                    StoryCharacter.user_id == owner_user_id
                )
            ).all()
            if card_lookup_keys.intersection(
                _story_character_identity_lookup_keys(row.name, row.triggers)
            )
        }
        missing_owner_character_ids = matching_owner_character_ids.difference(characters_by_id)
        if missing_owner_character_ids:
            for character in db.scalars(
                select(StoryCharacter).where(StoryCharacter.id.in_(missing_owner_character_ids))
            ).all():
                characters_by_id[int(character.id)] = character
        owner_characters = [
            characters_by_id[character_id]
            for character_id in matching_owner_character_ids
            if character_id in characters_by_id
        ]

    resolved_character_id_by_card_id: dict[int, int] = {}
    for card in world_cards:
        card_id = int(getattr(card, "id", 0) or 0)
        linked_character_id = int(getattr(card, "character_id", 0) or 0)
        if linked_character_id > 0 and linked_character_id in characters_by_id:
            resolved_character_id_by_card_id[card_id] = linked_character_id
            continue
        recovered_character = _find_character_for_unlinked_card(card, owner_characters)
        if recovered_character is not None:
            resolved_character_id_by_card_id[card_id] = int(recovered_character.id)

    speaker_map = _build_novel_speaker_character_map(
        world_cards,
        resolved_character_id_by_card_id=resolved_character_id_by_card_id,
    )

    # Old opening-scene builders used a generic GG label rather than the main hero card's
    # exact title.  Resolve that reserved alias only to the explicitly active hero (or the sole
    # main-hero card as a safe fallback); never fuzzy-match it against arbitrary characters.
    active_main_hero_card: StoryWorldCard | None = None
    active_main_hero_card_id = int(getattr(game, "active_main_hero_card_id", 0) or 0) if game is not None else 0
    if active_main_hero_card_id > 0:
        active_main_hero_card = next(
            (
                card
                for card in world_cards
                if int(getattr(card, "id", 0) or 0) == active_main_hero_card_id
            ),
            None,
        )
    if active_main_hero_card is None:
        main_hero_cards = [
            card
            for card in world_cards
            if str(getattr(card, "kind", "") or "").strip().lower().replace("-", "_") == "main_hero"
        ]
        if len(main_hero_cards) == 1:
            active_main_hero_card = main_hero_cards[0]
    if active_main_hero_card is not None:
        main_hero_card_id = int(getattr(active_main_hero_card, "id", 0) or 0)
        main_hero_character_id = (
            resolved_character_id_by_card_id.get(main_hero_card_id)
            or int(getattr(active_main_hero_card, "character_id", 0) or 0)
        )
        if main_hero_character_id in characters_by_id:
            for alias in ("Главный Герой", "ГГ", "Main Hero"):
                speaker_map[_story_speaker_key(alias)] = int(main_hero_character_id)

    return speaker_map, characters_by_id


def _resolve_novel_speaker_character_id(speaker_name: str | None, speaker_map: dict[str, int]) -> int | None:
    key = _story_speaker_key(speaker_name)
    if not key or not speaker_map:
        return None
    if key in speaker_map:
        return speaker_map[key]
    # Legacy narrators sometimes shortened a multi-word title.  Accept only a unique
    # token-boundary match; raw substring matching made "Анна" collide with "Марианна".
    padded_key = f" {key} "
    fuzzy_character_ids = {
        character_id
        for candidate_key, character_id in speaker_map.items()
        if len(key) >= 3
        and (
            padded_key in f" {candidate_key} "
            or f" {candidate_key} " in padded_key
        )
    }
    if len(fuzzy_character_ids) == 1:
        return next(iter(fuzzy_character_ids))
    return None


def persist_story_novel_beats_for_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    raw_response: str,
    world_cards: list[StoryWorldCard] | None = None,
) -> list[StoryNovelBeat]:
    """Parse an assistant turn into ordered Visual Novel beats and persist them."""
    parsed_beats = parse_story_novel_beats(raw_response)
    db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.message_id == assistant_message.id))

    speaker_map, _ = _build_novel_speaker_character_context(
        db,
        game=game,
        world_cards=list(world_cards or []),
    )
    rows: list[StoryNovelBeat] = []
    for index, beat in enumerate(parsed_beats):
        row = StoryNovelBeat(
            game_id=int(game.id),
            message_id=int(assistant_message.id),
            order_index=index,
            kind=beat.kind,
            speaker_name=beat.speaker_name,
            speaker_character_id=(
                _resolve_novel_speaker_character_id(beat.speaker_name, speaker_map)
                if beat.speaker_name
                else None
            ),
            emotion=beat.emotion,
            text=beat.text,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def serialize_story_novel_beats_for_stream(
    db: Session,
    beats: list[StoryNovelBeat],
) -> list[dict[str, Any]]:
    return [out.model_dump(mode="json") for out in resolve_story_novel_beats_for_read(db, beats)]
