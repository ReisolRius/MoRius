from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import StoryCharacter, StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard
from app.schemas import StoryNovelBeatOut, StoryNovelSceneCharacterOut
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
STORY_NOVEL_MAX_SCENE_CHARACTERS = 3
STORY_NOVEL_SPRITE_SOURCE_MAX_DEPTH = 4
STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER = {
    "female": "/visual-novel/incognito-female.png",
    "male": "/visual-novel/incognito-male.png",
}
# The narrator is required to emit gender, but already saved beats and occasional malformed
# provider output predate that contract. Never turn such a cast member into an empty stage slot:
# infer obvious Russian/English forms locally and use a deterministic last-resort sprite.
STORY_NOVEL_DEFAULT_INCOGNITO_SPRITE_GENDER = "male"
STORY_NOVEL_FEMALE_GENDER_HINTS: tuple[tuple[str, int], ...] = (
    (r"\b(?:пол|gender|sex)\s*[:=\-]?\s*(?:жен\w*|female)\b", 20),
    (
        r"\b(?:женщин\w*|девушк\w*|девочк\w*|героин\w*|мать|мама|дочь|сестр\w*|жена|жены|"
        r"королев\w*|принцесс\w*|герцогин\w*|графин\w*|баронесс\w*|леди|"
        r"учительниц\w*|преподавательниц\w*|директрис\w*|наставниц\w*|хозяйк\w*|"
        r"служанк\w*|горничн\w*|монахин\w*|жриц\w*|ведьм\w*|волшебниц\w*|колдунь\w*|"
        r"female|woman|girl|mother|daughter|sister|queen|princess|duchess|lady|teacheress)\b",
        8,
    ),
    (r"\b(?:она|е[её]|ей|she|her)\b", 1),
)
STORY_NOVEL_MALE_GENDER_HINTS: tuple[tuple[str, int], ...] = (
    (r"\b(?:пол|gender|sex)\s*[:=\-]?\s*(?:муж\w*|male)\b", 20),
    (
        r"\b(?:мужчин\w*|парн\w*|юнош\w*|мальчик\w*|отец|папа|сын|брат|муж|"
        r"король|принц|герцог|граф|барон|лорд|учитель|преподаватель|директор|наставник|"
        r"хозяин|слуга|монах|жрец|колдун|волшебник|стражник|охранник|"
        r"male|man|boy|father|son|brother|king|prince|duke|lord)\b",
        8,
    ),
    (r"\b(?:он|его|ему|he|him|his)\b", 1),
)
STORY_NOVEL_MALE_NAME_ENDING_EXCEPTIONS = {
    "илья",
    "никита",
    "лука",
    "кузьма",
    "фома",
    "савва",
    "данила",
    "миша",
    "саша",
}
STORY_NOVEL_NON_CHARACTER_NAMES = {
    "narrator",
    "рассказчик",
    "автор",
    "система",
    "system",
    "scene",
    "сцена",
    "повествователь",
    "описание",
}
STORY_NOVEL_IDENTITY_STOP_TOKENS = STORY_NOVEL_NON_CHARACTER_NAMES | {
    "npc",
    "нпс",
    "персонаж",
    "незнакомец",
    "незнакомка",
    "голос",
    "девушка",
    "женщина",
    "мужчина",
    "парень",
    "герой",
    "героиня",
}
STORY_NOVEL_CHARACTER_WORLD_CARD_KINDS = {"npc", "main_hero"}


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


def _infer_story_novel_sprite_gender(*values: Any) -> str:
    """Infer an incognito sprite gender when historical/provider metadata omitted it."""
    normalized_values = [
        sanitize_likely_utf8_mojibake(str(value or "")).casefold().replace("ё", "е")
        for value in values
        if str(value or "").strip()
    ]
    combined = "\n".join(normalized_values)
    female_score = sum(
        weight for pattern, weight in STORY_NOVEL_FEMALE_GENDER_HINTS if re.search(pattern, combined)
    )
    male_score = sum(
        weight for pattern, weight in STORY_NOVEL_MALE_GENDER_HINTS if re.search(pattern, combined)
    )
    if female_score > male_score:
        return "female"
    if male_score > female_score:
        return "male"

    # A conservative name-ending fallback covers most Russian names while excluding common
    # masculine -а/-я names. It is used only when neither the narrator nor profile text helped.
    name_tokens = re.findall(r"[a-zа-я]+", normalized_values[0] if normalized_values else "")
    if name_tokens:
        given_name = name_tokens[-1]
        if (
            given_name not in STORY_NOVEL_MALE_NAME_ENDING_EXCEPTIONS
            and given_name.endswith(("а", "я"))
        ):
            return "female"
    return STORY_NOVEL_DEFAULT_INCOGNITO_SPRITE_GENDER


def _resolve_story_novel_sprite(
    character: StoryCharacter | None,
    emotion: str | None,
    *,
    sprite_source_character: StoryCharacter | None = None,
    fallback_gender: str | None = None,
    fallback_name: str | None = None,
) -> tuple[str | None, bool, str | None]:
    """Return (sprite_url, is_incognito, gender) for a speaking character's emotion.

    Falls back exact-emotion -> the character's neutral sprite -> the shared gender-specific
    incognito sprite. Cross-character and arbitrary-emotion fallback are never allowed.
    """
    asset_character = sprite_source_character or character
    gender = (
        normalize_story_novel_sprite_gender(getattr(character, "novel_sprite_gender", None))
        or normalize_story_novel_sprite_gender(getattr(asset_character, "novel_sprite_gender", None))
        or normalize_story_novel_sprite_gender(fallback_gender)
        or _infer_story_novel_sprite_gender(
            fallback_name,
            getattr(character, "name", None),
            getattr(character, "description", None),
            getattr(character, "note", None),
            getattr(character, "triggers", None),
            getattr(asset_character, "name", None),
            getattr(asset_character, "description", None),
            getattr(asset_character, "note", None),
            getattr(asset_character, "triggers", None),
        )
    )
    incognito_sprite_url = STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER[gender]
    if asset_character is None:
        return incognito_sprite_url, True, gender

    assets = deserialize_story_character_emotion_assets(getattr(asset_character, "emotion_assets", None))
    if not assets:
        return incognito_sprite_url, True, gender

    resolved_emotion = normalize_story_character_emotion_id(emotion) or STORY_CHARACTER_DEFAULT_EMOTION
    candidate_order = [resolved_emotion, STORY_CHARACTER_DEFAULT_EMOTION]
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
            entity_id=int(asset_character.id),
            version=getattr(asset_character, "updated_at", None),
            asset_id=emotion_candidate,
        )
        if sprite_url:
            return sprite_url, False, gender

    return incognito_sprite_url, True, gender


def _story_novel_beat_to_out(
    beat: StoryNovelBeat,
    *,
    character: StoryCharacter | None = None,
    sprite_source_character: StoryCharacter | None = None,
    scene_characters: list[StoryNovelSceneCharacterOut] | None = None,
) -> StoryNovelBeatOut:
    kind = normalize_story_novel_beat_kind(getattr(beat, "kind", None))
    emotion = normalize_story_character_emotion_id(getattr(beat, "emotion", None))
    sprite_url: str | None = None
    sprite_incognito = False
    sprite_gender: str | None = None
    if kind in STORY_NOVEL_SPEAKER_BEAT_KINDS:
        sprite_url, sprite_incognito, sprite_gender = _resolve_story_novel_sprite(
            character,
            emotion,
            sprite_source_character=sprite_source_character,
            fallback_name=getattr(beat, "speaker_name", None),
        )
        speaker_name_key = _story_speaker_key(getattr(beat, "speaker_name", None))
        matching_scene_character = next(
            (
                item
                for item in scene_characters or []
                if (
                    character is not None
                    and item.character_id == int(character.id)
                )
                or (
                    speaker_name_key
                    and _story_speaker_key(item.name) == speaker_name_key
                )
            ),
            None,
        )
        if matching_scene_character is not None:
            if sprite_url is None and matching_scene_character.sprite_url:
                sprite_url = matching_scene_character.sprite_url
                sprite_incognito = matching_scene_character.incognito
            if sprite_gender is None:
                sprite_gender = matching_scene_character.gender
    return StoryNovelBeatOut(
        id=int(beat.id),
        game_id=int(beat.game_id),
        message_id=int(beat.message_id),
        order_index=max(int(getattr(beat, "order_index", 0) or 0), 0),
        kind=kind,  # type: ignore[arg-type]
        speaker_name=(str(getattr(beat, "speaker_name", "") or "").strip() or None),
        speaker_character_id=(int(character.id) if character is not None else None),
        emotion=emotion,
        text=str(getattr(beat, "text", "") or ""),
        sprite_url=sprite_url,
        sprite_incognito=sprite_incognito,
        sprite_gender=sprite_gender,
        scene_characters=list(scene_characters or []),
        created_at=beat.created_at,
        updated_at=beat.updated_at,
    )


def _deserialize_story_novel_scene_characters(raw_value: Any) -> list[dict[str, Any]]:
    """Read the compact persisted cast metadata without trusting historical JSON."""
    try:
        parsed = json.loads(str(raw_value or "[]"))
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []

    result: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    seen_character_ids: set[int] = set()
    for item in parsed:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split()).strip(" .,:;!?\"'()[]«»")
        if not name or len(name) > 160 or _is_story_novel_non_character_name(name):
            continue
        emotion = normalize_story_character_emotion_id(item.get("emotion")) or STORY_CHARACTER_DEFAULT_EMOTION
        gender = normalize_story_novel_sprite_gender(item.get("gender")) or None
        try:
            character_id = int(item.get("character_id") or 0)
        except (TypeError, ValueError):
            character_id = 0
        character_id = character_id if character_id > 0 else 0
        name_key = _story_speaker_key(name)
        if (character_id and character_id in seen_character_ids) or name_key in seen_names:
            continue
        if character_id:
            seen_character_ids.add(character_id)
        seen_names.add(name_key)
        result.append(
            {
                "name": name,
                "emotion": emotion,
                "character_id": character_id or None,
                "gender": gender,
            }
        )
        if len(result) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return result


def _resolve_story_novel_scene_characters(
    beat: StoryNovelBeat,
    *,
    speaker_map: dict[str, int],
    characters: dict[int, StoryCharacter],
    sprite_sources: dict[int, StoryCharacter],
    speaker_character: StoryCharacter | None,
) -> list[StoryNovelSceneCharacterOut]:
    """Resolve the whole beat cast, including narration and legacy speaker-only rows."""
    persisted = _deserialize_story_novel_scene_characters(
        getattr(beat, "scene_characters_json", None)
    )
    resolved: list[StoryNovelSceneCharacterOut] = []
    seen_keys: set[str] = set()

    for item in persisted:
        character = _resolve_authorized_novel_character(
            item["name"],
            speaker_map=speaker_map,
            characters=characters,
        )
        # Historical JSON is untrusted cache metadata.  If its id no longer agrees with the
        # current, unambiguous game-card mapping, discard it instead of exposing another
        # character's sprite (or even another user's private media).
        character_id = int(character.id) if character is not None else None
        dedup_key = (
            f"id:{character_id}"
            if character_id is not None
            else f"name:{_story_speaker_key(item['name'])}"
        )
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)
        emotion = normalize_story_character_emotion_id(item.get("emotion")) or STORY_CHARACTER_DEFAULT_EMOTION
        sprite_url, incognito, gender = _resolve_story_novel_sprite(
            character,
            emotion,
            sprite_source_character=(
                sprite_sources.get(int(character.id))
                if character is not None
                else None
            ),
            fallback_gender=item.get("gender"),
            fallback_name=item.get("name"),
        )
        resolved.append(
            StoryNovelSceneCharacterOut(
                character_id=character_id,
                name=str(item["name"]),
                emotion=emotion,
                sprite_url=sprite_url,
                incognito=incognito,
                gender=gender,
            )
        )

    kind = normalize_story_novel_beat_kind(getattr(beat, "kind", None))
    speaker_name = str(getattr(beat, "speaker_name", "") or "").strip()
    if kind in STORY_NOVEL_SPEAKER_BEAT_KINDS and speaker_name:
        speaker_character_id = int(speaker_character.id) if speaker_character is not None else None
        speaker_emotion = (
            normalize_story_character_emotion_id(getattr(beat, "emotion", None))
            or STORY_CHARACTER_DEFAULT_EMOTION
        )
        speaker_name_key = _story_speaker_key(speaker_name)
        speaker_fallback_gender = next(
            (
                item.get("gender")
                for item in persisted
                if _story_speaker_key(item.get("name")) == speaker_name_key
            ),
            None,
        )
        speaker_sprite_url, speaker_incognito, speaker_gender = _resolve_story_novel_sprite(
            speaker_character,
            speaker_emotion,
            sprite_source_character=(
                sprite_sources.get(int(speaker_character.id))
                if speaker_character is not None
                else None
            ),
            fallback_gender=speaker_fallback_gender,
            fallback_name=speaker_name,
        )
        match_index: int | None = None
        for index, item in enumerate(resolved):
            if speaker_character_id is not None and item.character_id == speaker_character_id:
                match_index = index
                break
            if _story_speaker_key(item.name) == _story_speaker_key(speaker_name):
                match_index = index
                break
        speaker_out = StoryNovelSceneCharacterOut(
            character_id=speaker_character_id,
            name=(resolved[match_index].name if match_index is not None else speaker_name),
            emotion=speaker_emotion,
            sprite_url=speaker_sprite_url,
            incognito=speaker_incognito,
            gender=speaker_gender,
        )
        if match_index is not None:
            resolved[match_index] = speaker_out
        elif len(resolved) < STORY_NOVEL_MAX_SCENE_CHARACTERS:
            resolved.append(speaker_out)
        else:
            # The speaker is never hidden by malformed/legacy metadata containing 3 others.
            resolved[-1] = speaker_out

    return resolved[:STORY_NOVEL_MAX_SCENE_CHARACTERS]


def resolve_story_novel_beats_for_read(
    db: Session,
    beats: list[StoryNovelBeat],
) -> list[StoryNovelBeatOut]:
    """Serialize beats and resolve current sprites, including legacy unlinked beats.

    Early Visual Novel builds persisted only ``speaker_name`` when a world card had not yet
    been linked to its character.  Relink read-only from the game's current cards and validate
    historical ids against that mapping.  This makes old turns pick up current sprites without
    allowing a stale or foreign id to become authoritative during a GET.
    """
    if not beats:
        return []

    game_ids = {
        int(getattr(beat, "game_id", 0) or 0)
        for beat in beats
        if int(getattr(beat, "game_id", 0) or 0) > 0
    }
    games = {
        int(game.id): game
        for game in db.scalars(select(StoryGame).where(StoryGame.id.in_(game_ids))).all()
    } if game_ids else {}
    cards_by_game: dict[int, list[StoryWorldCard]] = {game_id: [] for game_id in game_ids}
    if game_ids:
        for card in db.scalars(select(StoryWorldCard).where(StoryWorldCard.game_id.in_(game_ids))).all():
            cards_by_game.setdefault(int(card.game_id), []).append(card)

    resolved_context_by_game: dict[
        int,
        tuple[dict[str, int], dict[int, StoryCharacter], dict[int, StoryCharacter]],
    ] = {}
    for game_id in game_ids:
        resolved_context_by_game[game_id] = _build_novel_speaker_character_context(
            db,
            game=games.get(game_id),
            world_cards=cards_by_game.get(game_id, []),
        )

    output: list[StoryNovelBeatOut] = []
    for beat in beats:
        game_id = int(getattr(beat, "game_id", 0) or 0)
        speaker_map, characters, sprite_sources = resolved_context_by_game.get(game_id, ({}, {}, {}))
        character = _resolve_authorized_novel_character(
            getattr(beat, "speaker_name", None),
            speaker_map=speaker_map,
            characters=characters,
        )
        scene_characters = _resolve_story_novel_scene_characters(
            beat,
            speaker_map=speaker_map,
            characters=characters,
            sprite_sources=sprite_sources,
            speaker_character=character,
        )
        output.append(
            _story_novel_beat_to_out(
                beat,
                character=character,
                sprite_source_character=(
                    sprite_sources.get(int(character.id))
                    if character is not None
                    else None
                ),
                scene_characters=scene_characters,
            )
        )
    return output


# =====================================================================================
# Visual Novel narration contract + beat parsing
# =====================================================================================

VN_MAX_BEATS_PER_MESSAGE = 48
VN_MAX_BEAT_TEXT_CHARS = 1_400
VN_NARRATION_PAGE_MAX_CHARS = 300

# Visual Novel-only metadata suffix. It is stripped before the beat text reaches the UI. A
# curly-brace suffix is deliberate: canonical dialogue still *starts* with the universal
# ``[[NPC:...]]`` / ``[[GG:...]]`` marker and the shared markup sanitizer round-trips it
# losslessly. The order is the intended left-to-right order of sprites on stage.
_VN_SCENE_CAST_SUFFIX = re.compile(
    r"^(?P<text>.*?)\s*\{\{\s*(?:VN_CAST|SCENE_CAST)\s*\|\s*(?P<cast>[^}\n]{1,600})\}\}\s*$",
    re.IGNORECASE,
)
# Read compatibility for an early prefix prototype; new output is never instructed to use it.
_VN_SCENE_CAST_PREFIX = re.compile(
    r"^\s*\[\[\s*(?:VN_CAST|SCENE_CAST)\s*:\s*(?P<cast>[^\]\n]{1,600})\]\]\s*(?P<text>.*)$",
    re.IGNORECASE,
)
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


def has_story_novel_scene_cast_metadata(value: Any) -> bool:
    normalized = str(value or "").replace("\r\n", "\n")
    return any(
        _VN_SCENE_CAST_SUFFIX.match(raw_line.strip()) is not None
        or _VN_SCENE_CAST_PREFIX.match(raw_line.strip()) is not None
        for raw_line in normalized.split("\n")
    )


def strip_story_novel_scene_cast_metadata(value: Any) -> str:
    """Remove Visual Novel-only cast markers from text exposed outside the beat API.

    The raw assistant message intentionally keeps these markers so reroll variants and edited
    messages can be parsed into beats again.  StoryMessage/SSE serializers use this helper to
    keep that private transport metadata out of the player's visible prose.
    """
    normalized = str(value or "").replace("\r\n", "\n")
    if not normalized:
        return ""

    cleaned_lines: list[str] = []
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        suffix_match = _VN_SCENE_CAST_SUFFIX.match(line)
        if suffix_match is not None:
            line = str(suffix_match.group("text") or "").strip()
        else:
            prefix_match = _VN_SCENE_CAST_PREFIX.match(line)
            if prefix_match is not None:
                line = str(prefix_match.group("text") or "").strip()
        cleaned_lines.append(line)

    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _split_story_novel_logical_paragraphs(raw_text: str) -> list[str]:
    """Coalesce provider line wrapping without merging adjacent speaker paragraphs.

    Providers occasionally put the cast suffix on its own line or wrap a long dialogue over
    multiple physical lines.  The VN contract is paragraph based, so blank lines, a new speaker
    marker, and a completed cast suffix are the reliable display boundaries.
    """
    paragraphs: list[str] = []
    buffer: list[str] = []

    def flush() -> None:
        if not buffer:
            return
        paragraph = " ".join(part for part in buffer if part).strip()
        buffer.clear()
        if paragraph:
            paragraphs.append(paragraph)

    for raw_line in raw_text.split("\n"):
        line = raw_line.strip()
        if not line:
            flush()
            continue

        starts_speaker = (
            _VN_CANONICAL_SPEAKER_LINE.match(line) is not None
            or _VN_LEGACY_SPEAKER_LINE.match(line) is not None
        )
        starts_legacy_cast_prefix = _VN_SCENE_CAST_PREFIX.match(line) is not None
        if buffer and (starts_speaker or starts_legacy_cast_prefix):
            flush()

        buffer.append(line)
        combined = " ".join(buffer).strip()
        if _VN_SCENE_CAST_SUFFIX.match(combined) is not None:
            flush()

    flush()
    return paragraphs


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
            "{{VN_CAST|...}} — обязательное системное исключение из общего запрета на служебные пометки: это не markdown и не маркер речи, интерфейс удалит его перед показом игроку. Никогда не пропускай и не удаляй этот суффикс.\n"
            "Каждый абзац без исключения заканчивай служебным составом сцены: {{VN_CAST|Точный title|female|Эмоция; Другой title|male|Эмоция}}. Порядок персонажей — слева направо, максимум три.\n"
            "VN_CAST содержит только видимых персонажей. Рассказчик, Автор, Система, Сцена и другие служебные роли никогда не являются персонажами и категорически запрещены внутри VN_CAST.\n"
            "В нарративе сохраняй в VN_CAST до трёх уже находящихся в кадре активных персонажей, пока текст явно не показывает их уход; не схлопывай состав до одного только потому, что абзац описательный. Если в кадре действительно нет ни одного персонажа, закончи его {{VN_CAST|-}}. Для известного персонажа копируй точный title его карточки; для нового NPC используй его устойчивое имя.\n"
            "У каждого персонажа в VN_CAST обязательно указывай пол строго служебным словом male или female между title и эмоцией. Определи его по карточке, описанию, имени и контексту; для нового или непрописанного NPC выбери пол сам при первом появлении и сохраняй неизменным в следующих абзацах.\n"
            "В состав включай не только говорящего: если обычное описание затрагивает, описывает или оставляет в кадре персонажа, обязательно укажи его и подходящую эмоцию. Это относится и к совершенно новому персонажу без карточки: отсутствие карточки никогда не является причиной скрывать его из VN_CAST — интерфейс сам покажет для него силуэт. Не добавляй только безымянную массовку, которая не участвует в сцене.\n"
            "Если в абзаце упомянуты несколько видимых персонажей, обязательно включи того, чьё имя или устойчивое обозначение упомянуто последним: интерфейс поставит самого свежего персонажа в центр кадра.\n"
            "Каждую реплику выноси в отдельный абзац и начинай с неизменённого универсального маркера [[NPC:Имя]] или [[GG:Имя]].\n"
            "После маркера ставь эмоцию в круглых скобках, затем текст, а состав — строго в конце. Говорящий всегда обязан входить в состав.\n"
            "Пример реплики: [[NPC:Леди Мия]] (злость) Текст реплики. {{VN_CAST|Леди Мия|female|Злость}}\n"
            f"Существует строго восемь эмоций и никаких других: {emotion_labels}. Эмоция — ровно одно слово только из этого списка; составные, близкие по смыслу и придуманные эмоции запрещены. Если сомневаешься, используй Нейтральная. У каждой реплики и мысли эмоция обязательна.\n"
            "[[GG:Имя]] используй только для дословной цитаты речи, введённой игроком; не придумывай за него новые реплики.\n"
            "Если активные инструкции разрешают показывать мысли, используй универсальный [[NPC_THOUGHT:Имя]] или [[GG_THOUGHT:Имя]], например: [[NPC_THOUGHT:Леди Мия]] (страх) Текст мысли. {{VN_CAST|Леди Мия|female|Страх}}\n"
            "Для известного персонажа всегда копируй точный title его карточки без сокращений и вариантов.\n"
            "Новому или непрописанному NPC до первой реплики дай устойчивое естественное имя и дальше не меняй его.\n"
            "Если имя по логике сцены пока нельзя раскрывать, используй конкретную устойчивую роль не длиннее четырёх слов; после раскрытия используй его имя.\n"
            "Никогда не используй общие обозначения НПС, NPC, Голос, Незнакомец и Персонаж вместо имени или конкретной роли.\n"
            "Любая произнесённая вслух реплика, включая шёпот, возглас из толпы и речь за кадром, обязана иметь маркер говорящего; не оставляй речь обычным текстом.\n"
            "Описания сцены, действия и обстановку пиши обычным текстом без маркера говорящего и завершай {{VN_CAST|...}}.\n"
            "Не ставь двоеточие после имени, не добавляй эмоцию внутрь универсального speaker-маркера и не используй других служебных пометок."
        ),
        "source_kind": "visual_novel",
    }


@dataclass(frozen=True)
class _NormalizedNovelBeat:
    kind: str
    text: str
    speaker_name: str | None
    emotion: str | None
    scene_characters: tuple[tuple[str, str], ...] = ()
    scene_character_genders: tuple[tuple[str, str], ...] = ()


def _normalize_novel_text(value: Any, *, max_length: int = VN_MAX_BEAT_TEXT_CHARS) -> str:
    normalized = sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", "\n").strip()
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip()
    return normalized


def _normalize_novel_speaker_name(value: Any) -> str | None:
    normalized = " ".join(str(value or "").split()).strip(" .,:;!?\"'()[]«»")
    if not normalized or len(normalized) > 60:
        return None
    if _is_story_novel_non_character_name(normalized):
        return None
    return normalized


def _normalize_novel_scene_character_name(value: Any) -> str | None:
    normalized = " ".join(str(value or "").split()).strip(" .,:;!?\"'()[]«»")
    if not normalized or len(normalized) > 160:
        return None
    if normalized.casefold() in {"-", "нет", "none", "empty", "пусто"}:
        return None
    if _is_story_novel_non_character_name(normalized):
        return None
    return normalized


def _parse_story_novel_scene_cast_with_genders(
    value: Any,
) -> tuple[tuple[tuple[str, str], ...], tuple[tuple[str, str], ...]]:
    """Parse current ``Title|Gender|Emotion`` and legacy ``Title|Emotion`` metadata."""
    raw_value = str(value or "").strip()
    if not raw_value or raw_value.casefold() in {"-", "нет", "none", "empty", "пусто"}:
        return (), ()

    result: list[tuple[str, str]] = []
    genders: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_item in raw_value.split(";"):
        raw_item = raw_item.strip()
        if not raw_item:
            continue
        parts = [part.strip() for part in raw_item.split("|")]
        raw_gender = ""
        if len(parts) >= 3:
            raw_name = "|".join(parts[:-2]).strip()
            first_tail, second_tail = parts[-2:]
            if normalize_story_novel_sprite_gender(first_tail):
                raw_gender = first_tail
                raw_emotion = second_tail
            elif normalize_story_novel_sprite_gender(second_tail):
                # Read compatibility for providers that accidentally swap the last two fields.
                raw_gender = second_tail
                raw_emotion = first_tail
            else:
                # Keep accepting a name containing a stray pipe as legacy Title|Emotion data.
                raw_name = "|".join(parts[:-1]).strip()
                raw_emotion = parts[-1]
        elif len(parts) == 2:
            raw_name, raw_emotion = parts
        else:
            # Tolerate a natural ``Title (Emotion)`` variant while requesting only the
            # unambiguous pipe form from the narrator.
            parenthetical = re.match(r"^(?P<name>.+?)\s*\((?P<emotion>[^)]+)\)\s*$", raw_item)
            if parenthetical is not None:
                raw_name = parenthetical.group("name")
                raw_emotion = parenthetical.group("emotion")
            else:
                raw_name = raw_item
                raw_emotion = STORY_CHARACTER_DEFAULT_EMOTION
        name = _normalize_novel_scene_character_name(raw_name)
        if not name:
            continue
        key = _story_speaker_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        emotion = normalize_story_character_emotion_id(raw_emotion) or STORY_CHARACTER_DEFAULT_EMOTION
        result.append((name, emotion))
        gender = normalize_story_novel_sprite_gender(raw_gender)
        if gender:
            genders.append((name, gender))
        if len(result) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return tuple(result), tuple(genders)


def _parse_story_novel_scene_cast(value: Any) -> tuple[tuple[str, str], ...]:
    """Backward-compatible cast view used by existing parser callers and tests."""
    scene_characters, _ = _parse_story_novel_scene_cast_with_genders(value)
    return scene_characters


def _ensure_story_novel_speaker_in_scene_cast(
    scene_characters: tuple[tuple[str, str], ...],
    *,
    speaker_name: str,
    emotion: str | None,
) -> tuple[tuple[str, str], ...]:
    """Dialogue/thought always exposes at least its speaker, including legacy output."""
    speaker_key = _story_speaker_key(speaker_name)
    speaker_emotion = normalize_story_character_emotion_id(emotion) or STORY_CHARACTER_DEFAULT_EMOTION
    items = list(scene_characters[:STORY_NOVEL_MAX_SCENE_CHARACTERS])
    for index, (name, _) in enumerate(items):
        if _story_speaker_key(name) == speaker_key:
            items[index] = (name, speaker_emotion)
            return tuple(items)
    speaker_item = (speaker_name, speaker_emotion)
    if len(items) < STORY_NOVEL_MAX_SCENE_CHARACTERS:
        items.append(speaker_item)
    else:
        items[-1] = speaker_item
    return tuple(items)


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
    narration_scene_characters: list[tuple[str, str]] = []
    narration_scene_character_genders: list[tuple[str, str]] = []

    def flush_narration() -> None:
        if not narration_buffer:
            return
        merged = "\n".join(narration_buffer).strip()
        narration_buffer.clear()
        current_scene_characters = tuple(narration_scene_characters)
        current_scene_character_genders = tuple(narration_scene_character_genders)
        narration_scene_characters.clear()
        narration_scene_character_genders.clear()
        for page in _split_novel_narration_pages(merged):
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_NARRATION,
                    text=page,
                    speaker_name=None,
                    emotion=None,
                    scene_characters=current_scene_characters,
                    scene_character_genders=current_scene_character_genders,
                )
            )

    for raw_line in _split_story_novel_logical_paragraphs(raw_text):
        line = raw_line.strip()
        cast_match = _VN_SCENE_CAST_SUFFIX.match(line)
        if cast_match is None:
            cast_match = _VN_SCENE_CAST_PREFIX.match(line)
        has_scene_cast_metadata = cast_match is not None
        scene_characters: tuple[tuple[str, str], ...] = ()
        scene_character_genders: tuple[tuple[str, str], ...] = ()
        if cast_match is not None:
            scene_characters, scene_character_genders = _parse_story_novel_scene_cast_with_genders(
                cast_match.group("cast")
            )
            line = str(cast_match.group("text") or "").strip()
            if narration_buffer:
                # Every metadata prefix starts a new display paragraph even if the model
                # omitted the blank line requested by the contract.
                flush_narration()
            if not line:
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
            scene_characters = _ensure_story_novel_speaker_in_scene_cast(
                scene_characters,
                speaker_name=speaker_name,
                emotion=emotion,
            )
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_THOUGHT if is_thought else STORY_NOVEL_BEAT_DIALOGUE,
                    text=_normalize_novel_text(text),
                    speaker_name=speaker_name,
                    emotion=emotion,
                    scene_characters=scene_characters,
                    scene_character_genders=scene_character_genders,
                )
            )
        elif legacy_match and speaker_name:
            flush_narration()
            text = legacy_match.group("text").strip()
            is_thought = text.startswith("(") and text.endswith(")")
            emotion = (
                normalize_story_character_emotion_id(legacy_match.group("emotion"))
                or STORY_CHARACTER_DEFAULT_EMOTION
            )
            scene_characters = _ensure_story_novel_speaker_in_scene_cast(
                scene_characters,
                speaker_name=speaker_name,
                emotion=emotion,
            )
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_THOUGHT if is_thought else STORY_NOVEL_BEAT_DIALOGUE,
                    text=_normalize_novel_text(text.strip("()").strip() if is_thought else text),
                    speaker_name=speaker_name,
                    emotion=emotion,
                    scene_characters=scene_characters,
                    scene_character_genders=scene_character_genders,
                )
            )
        else:
            if has_scene_cast_metadata:
                narration_scene_characters.extend(scene_characters)
                narration_scene_character_genders.extend(scene_character_genders)
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
                scene_characters=(),
            )
        ]
    return normalized_beats


def _story_speaker_key(value: str | None) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip()).casefold().replace("ё", "е")
    return normalized.strip(" .,:;!?\"'()[]«»")


def _is_story_novel_non_character_name(value: Any) -> bool:
    return _story_speaker_key(str(value or "")) in STORY_NOVEL_NON_CHARACTER_NAMES


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


def _story_media_identity_values(value: Any) -> set[str]:
    return {
        normalized
        for raw_value in value
        if (normalized := str(raw_value or "").strip())
    }


def _find_character_for_unlinked_card(
    card: StoryWorldCard,
    characters: list[StoryCharacter],
) -> StoryCharacter | None:
    """Recover a card -> character link by stable title/trigger identity.

    This is intentionally exact (case/whitespace/``ё`` insensitive), never a broad SQL name
    search.  Duplicate private characters are not interchangeable: use a matching avatar only
    when it uniquely disambiguates the old card, otherwise leave the character unresolved.
    Showing an incognito silhouette is always safer than borrowing another profile's sprites.
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
    if len(candidates) == 1:
        return candidates[0]

    card_media = _story_media_identity_values(
        (
            getattr(card, "avatar_original_url", None),
            getattr(card, "avatar_url", None),
        )
    )
    if not card_media:
        return None
    avatar_matches = [
        character
        for character in candidates
        if card_media.intersection(
            _story_media_identity_values(
                (
                    getattr(character, "avatar_original_url", None),
                    getattr(character, "avatar_url", None),
                )
            )
        )
    ]
    return avatar_matches[0] if len(avatar_matches) == 1 else None


def _story_character_has_emotion_assets(character: StoryCharacter | None) -> bool:
    return bool(
        character is not None
        and deserialize_story_character_emotion_assets(getattr(character, "emotion_assets", None))
    )


def _resolve_story_novel_sprite_source(
    db: Session,
    character: StoryCharacter,
    *,
    owner_user_id: int,
) -> StoryCharacter | None:
    """Resolve sprites through explicit copy lineage, never through a name-based donor.

    Some older publication/community-copy paths accidentally stored an empty emotion pack on
    the clone. Existing rows can still render safely from their exact ``source_character_id``.
    Private foreign profiles remain inaccessible; only the same owner's source or a public
    source is allowed.
    """
    if _story_character_has_emotion_assets(character):
        return character

    current = character
    visited = {int(character.id)}
    for _depth in range(STORY_NOVEL_SPRITE_SOURCE_MAX_DEPTH):
        source_character_id = int(getattr(current, "source_character_id", 0) or 0)
        if source_character_id <= 0 or source_character_id in visited:
            break
        visited.add(source_character_id)
        source = db.get(StoryCharacter, source_character_id)
        if source is None:
            break
        source_user_id = int(getattr(source, "user_id", 0) or 0)
        source_visibility = str(getattr(source, "visibility", "") or "").strip().lower()
        if source_user_id != owner_user_id and source_visibility != "public":
            break
        if _story_character_has_emotion_assets(source):
            return source
        current = source
    return None


def _build_novel_speaker_character_map(
    world_cards: list[StoryWorldCard],
    *,
    resolved_character_id_by_card_id: dict[int, int] | None = None,
    characters_by_id: dict[int, StoryCharacter] | None = None,
    sprite_sources_by_character_id: dict[int, StoryCharacter] | None = None,
) -> dict[str, int]:
    candidates_by_key: dict[str, set[int]] = {}
    for card in world_cards:
        card_id = int(getattr(card, "id", 0) or 0)
        character_id = (
            (resolved_character_id_by_card_id or {}).get(card_id)
            or getattr(card, "character_id", None)
        )
        if not character_id:
            continue
        # The world-card title is the canonical narrator contract, but the explicitly linked
        # reusable character profile is the same identity. Models occasionally copy the
        # profile name/trigger into VN_CAST instead of the card title. Accept those exact
        # aliases too, while preserving the ambiguity guard below. This is deliberately not a
        # fuzzy match and it never considers a character that is not linked to this game.
        lookup_keys = set(_story_world_card_lookup_keys(card))
        linked_character = (characters_by_id or {}).get(int(character_id))
        if linked_character is not None:
            lookup_keys.update(_story_character_lookup_keys(linked_character))
        sprite_source = (sprite_sources_by_character_id or {}).get(int(character_id))
        if sprite_source is not None:
            lookup_keys.update(_story_character_lookup_keys(sprite_source))
        for key in lookup_keys:
            candidates_by_key.setdefault(key, set()).add(int(character_id))
    # A shared trigger/name is ambiguous by definition.  Omitting it makes the caller render
    # incognito rather than depending on database row order to pick somebody else's sprite.
    return {
        key: next(iter(character_ids))
        for key, character_ids in candidates_by_key.items()
        if len(character_ids) == 1
    }


def _build_novel_speaker_character_context(
    db: Session,
    *,
    game: StoryGame | None,
    world_cards: list[StoryWorldCard],
) -> tuple[dict[str, int], dict[int, StoryCharacter], dict[int, StoryCharacter]]:
    """Return (speaker lookup, loaded characters, exact sprite sources)."""
    owner_user_id = int(getattr(game, "user_id", 0) or 0) if game is not None else 0
    requested_character_ids = {
        int(card.character_id)
        for card in world_cards
        if getattr(card, "character_id", None)
    }
    characters_by_id: dict[int, StoryCharacter] = {}
    if requested_character_ids:
        requested_characters_query = select(StoryCharacter).where(
            StoryCharacter.id.in_(requested_character_ids)
        )
        if owner_user_id > 0:
            requested_characters_query = requested_characters_query.where(
                StoryCharacter.user_id == owner_user_id
            )
        for character in db.scalars(requested_characters_query).all():
            characters_by_id[int(character.id)] = character

    owner_characters: list[StoryCharacter] = []
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

    sprite_sources_by_character_id = {
        character_id: sprite_source
        for character_id, character in characters_by_id.items()
        if (
            sprite_source := _resolve_story_novel_sprite_source(
                db,
                character,
                owner_user_id=owner_user_id,
            )
        ) is not None
    }

    speaker_map = _build_novel_speaker_character_map(
        world_cards,
        resolved_character_id_by_card_id=resolved_character_id_by_card_id,
        characters_by_id=characters_by_id,
        sprite_sources_by_character_id=sprite_sources_by_character_id,
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

    return speaker_map, characters_by_id, sprite_sources_by_character_id


def _resolve_novel_speaker_character_id(speaker_name: str | None, speaker_map: dict[str, int]) -> int | None:
    key = _story_speaker_key(speaker_name)
    if not key or not speaker_map or _is_story_novel_non_character_name(key):
        return None
    exact_match = speaker_map.get(key)
    if exact_match is not None:
        return exact_match

    # Models occasionally shorten a multi-word card title to its exact first name. Recover
    # only by whole normalized tokens and only when the result is unambiguous. Substring
    # matching is deliberately forbidden ("Анна" must never match "Марианна").
    speaker_tokens = {
        token
        for token in re.findall(r"[0-9a-zа-яё]+", key, flags=re.IGNORECASE)
        if len(token) >= 3 and token not in STORY_NOVEL_IDENTITY_STOP_TOKENS
    }
    if not speaker_tokens:
        return None
    candidate_ids: set[int] = set()
    for candidate_key, character_id in speaker_map.items():
        candidate_tokens = {
            token
            for token in re.findall(r"[0-9a-zа-яё]+", candidate_key, flags=re.IGNORECASE)
            if len(token) >= 3 and token not in STORY_NOVEL_IDENTITY_STOP_TOKENS
        }
        if not candidate_tokens:
            continue
        if speaker_tokens.issubset(candidate_tokens) or candidate_tokens.issubset(speaker_tokens):
            candidate_ids.add(int(character_id))
    return next(iter(candidate_ids)) if len(candidate_ids) == 1 else None


def _resolve_authorized_novel_character(
    speaker_name: str | None,
    *,
    speaker_map: dict[str, int],
    characters: dict[int, StoryCharacter],
) -> StoryCharacter | None:
    """Resolve a sprite only through the current game's unambiguous identity mapping.

    ``speaker_character_id`` and cast JSON are cached historical hints, not authorization and
    not identity proof.  A sprite is returned only through the current exact card mapping.
    """
    mapped_character_id = _resolve_novel_speaker_character_id(speaker_name, speaker_map)
    return characters.get(int(mapped_character_id)) if mapped_character_id is not None else None


def _serialize_story_novel_scene_characters(
    scene_characters: tuple[tuple[str, str], ...],
    *,
    speaker_map: dict[str, int],
    scene_character_genders: tuple[tuple[str, str], ...] = (),
) -> str:
    payload: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    gender_by_name_key = {
        _story_speaker_key(name): gender
        for name, raw_gender in scene_character_genders
        if (gender := normalize_story_novel_sprite_gender(raw_gender))
    }
    for name, raw_emotion in scene_characters:
        character_id = _resolve_novel_speaker_character_id(name, speaker_map)
        name_key = _story_speaker_key(name)
        dedup_key = f"id:{character_id}" if character_id is not None else f"name:{name_key}"
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)
        item: dict[str, Any] = {
            "name": name,
            "emotion": normalize_story_character_emotion_id(raw_emotion)
            or STORY_CHARACTER_DEFAULT_EMOTION,
            "character_id": character_id,
        }
        gender = gender_by_name_key.get(name_key) or _infer_story_novel_sprite_gender(name)
        item["gender"] = gender
        payload.append(item)
        if len(payload) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def story_novel_exact_mention_start(text: str, candidate: str) -> int | None:
    normalized_text = sanitize_likely_utf8_mojibake(str(text or "")).casefold().replace("ё", "е")
    normalized_candidate = " ".join(
        sanitize_likely_utf8_mojibake(str(candidate or "")).casefold().replace("ё", "е").split()
    ).strip()
    if not normalized_text or not normalized_candidate:
        return None
    candidate_pattern = r"\s+".join(re.escape(part) for part in normalized_candidate.split())
    match = re.search(rf"(?<!\w){candidate_pattern}(?!\w)", normalized_text, flags=re.UNICODE)
    return match.start() if match is not None else None


def _infer_story_novel_narration_scene_characters(
    text: str,
    *,
    world_cards: list[StoryWorldCard],
    speaker_map: dict[str, int],
    candidate_characters: tuple[tuple[str, str], ...] = (),
) -> tuple[tuple[str, str], ...]:
    """Repair narration cast when a provider omits the mandatory ``VN_CAST`` suffix.

    Only exact mentions of reliable identities are accepted: character-card titles and names
    already emitted as speakers/cast members in the same response. This keeps the repair
    deterministic while still allowing a brand-new, unregistered NPC to receive an incognito
    sprite before or after their first line.
    """
    matches: list[tuple[int, int, str, str, str]] = []

    def add_candidate(name: Any, raw_emotion: Any, *, stable_order: int) -> None:
        normalized_name = _normalize_novel_scene_character_name(name)
        if not normalized_name:
            return
        mention_start = story_novel_exact_mention_start(text, normalized_name)
        if mention_start is None:
            return
        character_id = _resolve_novel_speaker_character_id(normalized_name, speaker_map)
        identity_key = (
            f"id:{character_id}"
            if character_id is not None
            else f"name:{_story_speaker_key(normalized_name)}"
        )
        matches.append(
            (
                mention_start,
                stable_order,
                normalized_name,
                normalize_story_character_emotion_id(raw_emotion)
                or STORY_CHARACTER_DEFAULT_EMOTION,
                identity_key,
            )
        )

    for candidate_index, (name, raw_emotion) in enumerate(candidate_characters):
        add_candidate(name, raw_emotion, stable_order=candidate_index)

    for card in world_cards:
        card_kind = str(getattr(card, "kind", "") or "").strip().lower()
        if card_kind not in STORY_NOVEL_CHARACTER_WORLD_CARD_KINDS:
            continue
        title = " ".join(str(getattr(card, "title", "") or "").split()).strip()
        if not title:
            continue
        add_candidate(
            title,
            STORY_CHARACTER_DEFAULT_EMOTION,
            stable_order=len(candidate_characters) + int(getattr(card, "id", 0) or 0),
        )

    result: list[tuple[str, str]] = []
    seen_identity_keys: set[str] = set()
    for _position, _stable_order, name, emotion, identity_key in sorted(matches):
        if identity_key in seen_identity_keys:
            continue
        seen_identity_keys.add(identity_key)
        result.append((name, emotion))
        if len(result) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return tuple(result)


def _collect_story_novel_narration_candidates(
    parsed_beats: list[_NormalizedNovelBeat],
) -> tuple[tuple[tuple[str, str], ...], dict[str, str]]:
    """Collect trustworthy identities/genders from all beats in one provider response."""
    candidates: list[tuple[str, str]] = []
    gender_by_name_key: dict[str, str] = {}
    seen_names: set[str] = set()

    for beat in parsed_beats:
        for name, raw_gender in beat.scene_character_genders:
            normalized_gender = normalize_story_novel_sprite_gender(raw_gender)
            name_key = _story_speaker_key(name)
            if name_key and normalized_gender and name_key not in gender_by_name_key:
                gender_by_name_key[name_key] = normalized_gender

        beat_candidates = list(beat.scene_characters)
        if beat.speaker_name:
            beat_candidates.append(
                (
                    beat.speaker_name,
                    normalize_story_character_emotion_id(beat.emotion)
                    or STORY_CHARACTER_DEFAULT_EMOTION,
                )
            )
        for name, raw_emotion in beat_candidates:
            normalized_name = _normalize_novel_scene_character_name(name)
            name_key = _story_speaker_key(normalized_name)
            if not normalized_name or not name_key or name_key in seen_names:
                continue
            seen_names.add(name_key)
            candidates.append(
                (
                    normalized_name,
                    normalize_story_character_emotion_id(raw_emotion)
                    or STORY_CHARACTER_DEFAULT_EMOTION,
                )
            )

    return tuple(candidates), gender_by_name_key


def persist_story_novel_beats_for_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    raw_response: str,
    world_cards: list[StoryWorldCard] | None = None,
    infer_narration_scene_characters: bool = False,
) -> list[StoryNovelBeat]:
    """Parse an assistant turn into ordered Visual Novel beats and persist them.

    ``infer_narration_scene_characters`` is retained for call compatibility. Exact-identity cast
    repair is now safe and enabled for every turn, not only for legacy opening scenes.
    """
    parsed_beats = parse_story_novel_beats(raw_response)
    db.execute(sa_delete(StoryNovelBeat).where(StoryNovelBeat.message_id == assistant_message.id))

    speaker_map, _, _ = _build_novel_speaker_character_context(
        db,
        game=game,
        world_cards=list(world_cards or []),
    )
    narration_candidates, narration_candidate_genders = _collect_story_novel_narration_candidates(
        parsed_beats
    )
    rows: list[StoryNovelBeat] = []
    for index, beat in enumerate(parsed_beats):
        scene_characters = beat.scene_characters
        scene_character_genders = beat.scene_character_genders
        if beat.kind == STORY_NOVEL_BEAT_NARRATION and not scene_characters:
            scene_characters = _infer_story_novel_narration_scene_characters(
                beat.text,
                world_cards=list(world_cards or []),
                speaker_map=speaker_map,
                candidate_characters=narration_candidates,
            )
            scene_character_genders = tuple(
                (name, narration_candidate_genders[name_key])
                for name, _emotion in scene_characters
                if (name_key := _story_speaker_key(name)) in narration_candidate_genders
            )
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
            scene_characters_json=_serialize_story_novel_scene_characters(
                scene_characters,
                speaker_map=speaker_map,
                scene_character_genders=scene_character_genders,
            ),
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
