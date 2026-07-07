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
            int(beat.speaker_character_id) if getattr(beat, "speaker_character_id", None) else None
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
    """Serialize beats for the read/stream payload, resolving speaker sprites in one query."""
    character_ids = {
        int(beat.speaker_character_id)
        for beat in beats
        if getattr(beat, "speaker_character_id", None)
    }
    characters: dict[int, StoryCharacter] = {}
    if character_ids:
        characters = {
            int(character.id): character
            for character in db.scalars(
                select(StoryCharacter).where(StoryCharacter.id.in_(character_ids))
            ).all()
        }
    return [
        _story_novel_beat_to_out(
            beat,
            character=characters.get(int(beat.speaker_character_id))
            if getattr(beat, "speaker_character_id", None)
            else None,
        )
        for beat in beats
    ]


# =====================================================================================
# Visual Novel narration contract + beat parsing
# =====================================================================================

VN_MAX_BEATS_PER_MESSAGE = 48
VN_MAX_BEAT_TEXT_CHARS = 1_400
VN_NARRATION_PAGE_MAX_CHARS = 300

# A spoken line looks like:  Имя [эмоция]: текст   or   Имя: текст
_VN_SPEAKER_LINE = re.compile(
    r"^\s*(?:[-–—]\s*)?(?P<name>[^:\n\[\]]{1,60}?)\s*(?:\[(?P<emotion>[^\]]{1,40})\])?\s*:\s+(?P<text>.+)$"
)
_VN_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+(?=[«\"A-ZА-ЯЁ0-9])")


def build_story_novel_instruction_card() -> dict[str, str]:
    """The extra narrator instruction injected only for admin Visual Novel games.

    It asks the base narrator to tag each character line with one of the 8 preset emotions so
    the parser can split the answer into beats and the UI can show the matching sprite.
    """
    emotion_labels = ", ".join(
        STORY_CHARACTER_EMOTION_LABELS.get(emotion_id, emotion_id) for emotion_id in STORY_CHARACTER_EMOTION_IDS
    )
    return {
        "title": "Формат визуальной новеллы",
        "content": (
            "[РЕЖИМ ВИЗУАЛЬНОЙ НОВЕЛЛЫ]\n"
            "Оформляй ответ так, чтобы его можно было показывать по репликам.\n"
            "Каждую реплику персонажа пиши отдельной строкой в формате: Имя [эмоция]: текст реплики.\n"
            f"«эмоция» — ровно одно слово из списка: {emotion_labels}.\n"
            "Мысли персонажа оформляй так: Имя [эмоция]: (текст мысли) — мысль в круглых скобках.\n"
            "Описания сцены, действия и обстановку пиши обычными абзацами без имени и без пометок.\n"
            "Всегда указывай эмоцию у реплик и мыслей. Не используй других служебных пометок."
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
        match = _VN_SPEAKER_LINE.match(line)
        speaker_name = _normalize_novel_speaker_name(match.group("name")) if match else None
        if match and speaker_name:
            flush_narration()
            emotion = normalize_story_character_emotion_id(match.group("emotion"))
            text = match.group("text").strip()
            is_thought = text.startswith("(") and text.endswith(")")
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_THOUGHT if is_thought else STORY_NOVEL_BEAT_DIALOGUE,
                    text=_normalize_novel_text(text.strip("()").strip() if is_thought else text),
                    speaker_name=speaker_name,
                    emotion=emotion or STORY_CHARACTER_DEFAULT_EMOTION,
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
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


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


def _build_novel_speaker_character_map(world_cards: list[StoryWorldCard]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for card in world_cards:
        character_id = getattr(card, "character_id", None)
        if not character_id:
            continue
        keys = [getattr(card, "title", None), *_deserialize_world_card_triggers(getattr(card, "triggers", None))]
        for key_value in keys:
            key = _story_speaker_key(key_value)
            if key:
                mapping.setdefault(key, int(character_id))
    return mapping


def _resolve_novel_speaker_character_id(speaker_name: str | None, speaker_map: dict[str, int]) -> int | None:
    key = _story_speaker_key(speaker_name)
    if not key or not speaker_map:
        return None
    if key in speaker_map:
        return speaker_map[key]
    for candidate_key, character_id in speaker_map.items():
        if key in candidate_key or candidate_key in key:
            return character_id
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

    speaker_map = _build_novel_speaker_character_map(list(world_cards or []))
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
