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
    scene_characters: list[StoryNovelSceneCharacterOut] | None = None,
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
        if not name or len(name) > 160:
            continue
        emotion = normalize_story_character_emotion_id(item.get("emotion")) or STORY_CHARACTER_DEFAULT_EMOTION
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
    speaker_character: StoryCharacter | None,
) -> list[StoryNovelSceneCharacterOut]:
    """Resolve the whole beat cast, including narration and legacy speaker-only rows."""
    persisted = _deserialize_story_novel_scene_characters(
        getattr(beat, "scene_characters_json", None)
    )
    resolved: list[StoryNovelSceneCharacterOut] = []
    seen_keys: set[str] = set()

    for item in persisted:
        direct_character_id = int(item.get("character_id") or 0)
        character = characters.get(direct_character_id) if direct_character_id > 0 else None
        if character is None:
            recovered_character_id = _resolve_novel_speaker_character_id(item["name"], speaker_map)
            character = characters.get(recovered_character_id) if recovered_character_id else None
        character_id = int(character.id) if character is not None else (direct_character_id or None)
        dedup_key = (
            f"id:{character_id}"
            if character_id is not None
            else f"name:{_story_speaker_key(item['name'])}"
        )
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)
        emotion = normalize_story_character_emotion_id(item.get("emotion")) or STORY_CHARACTER_DEFAULT_EMOTION
        sprite_url, incognito, gender = _resolve_story_novel_sprite(character, emotion)
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
        speaker_character_id = (
            int(speaker_character.id)
            if speaker_character is not None
            else int(getattr(beat, "speaker_character_id", 0) or 0) or None
        )
        speaker_emotion = (
            normalize_story_character_emotion_id(getattr(beat, "emotion", None))
            or STORY_CHARACTER_DEFAULT_EMOTION
        )
        speaker_sprite_url, speaker_incognito, speaker_gender = _resolve_story_novel_sprite(
            speaker_character,
            speaker_emotion,
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
    scene_characters_by_beat_identity = {
        id(beat): _deserialize_story_novel_scene_characters(
            getattr(beat, "scene_characters_json", None)
        )
        for beat in beats
    }
    direct_character_ids = {
        int(beat.speaker_character_id)
        for beat in beats
        if getattr(beat, "speaker_character_id", None)
    }
    direct_character_ids.update(
        int(item["character_id"])
        for items in scene_characters_by_beat_identity.values()
        for item in items
        if item.get("character_id")
    )
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
        scene_characters = _resolve_story_novel_scene_characters(
            beat,
            speaker_map=speaker_map,
            characters=characters,
            speaker_character=character,
        )
        output.append(
            _story_novel_beat_to_out(
                beat,
                character=character,
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
            "Каждый абзац без исключения заканчивай служебным составом сцены: {{VN_CAST|Точный title|Эмоция; Другой title|Эмоция}}. Порядок персонажей — слева направо, максимум три.\n"
            "Если в абзаце нет ни одного персонажа, закончи его {{VN_CAST|-}}. Для известного персонажа копируй точный title его карточки; для нового NPC используй его устойчивое имя.\n"
            "В состав включай не только говорящего: если обычное описание затрагивает, описывает или оставляет в кадре известного персонажа, обязательно укажи его и подходящую эмоцию. Не добавляй безымянную массовку без карточек.\n"
            "Каждую реплику выноси в отдельный абзац и начинай с неизменённого универсального маркера [[NPC:Имя]] или [[GG:Имя]].\n"
            "После маркера ставь эмоцию в круглых скобках, затем текст, а состав — строго в конце. Говорящий всегда обязан входить в состав.\n"
            "Пример реплики: [[NPC:Леди Мия]] (злость) Текст реплики. {{VN_CAST|Леди Мия|Злость}}\n"
            f"Эмоция — ровно одно слово из списка: {emotion_labels}. У каждой реплики и мысли эмоция обязательна.\n"
            "[[GG:Имя]] используй только для дословной цитаты речи, введённой игроком; не придумывай за него новые реплики.\n"
            "Если активные инструкции разрешают показывать мысли, используй универсальный [[NPC_THOUGHT:Имя]] или [[GG_THOUGHT:Имя]], например: [[NPC_THOUGHT:Леди Мия]] (страх) Текст мысли. {{VN_CAST|Леди Мия|Страх}}\n"
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


def _normalize_novel_scene_character_name(value: Any) -> str | None:
    normalized = " ".join(str(value or "").split()).strip(" .,:;!?\"'()[]«»")
    if not normalized or len(normalized) > 160:
        return None
    if normalized.casefold() in {"-", "нет", "none", "empty", "пусто"}:
        return None
    return normalized


def _parse_story_novel_scene_cast(value: Any) -> tuple[tuple[str, str], ...]:
    """Parse ``Title|Emotion; ...`` metadata, deduplicated and capped at three."""
    raw_value = str(value or "").strip()
    if not raw_value or raw_value.casefold() in {"-", "нет", "none", "empty", "пусто"}:
        return ()

    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_item in raw_value.split(";"):
        raw_item = raw_item.strip()
        if not raw_item:
            continue
        raw_name, separator, raw_emotion = raw_item.rpartition("|")
        if not separator:
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
        if len(result) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return tuple(result)


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

    def flush_narration() -> None:
        if not narration_buffer:
            return
        merged = "\n".join(narration_buffer).strip()
        narration_buffer.clear()
        current_scene_characters = tuple(narration_scene_characters)
        narration_scene_characters.clear()
        for page in _split_novel_narration_pages(merged):
            beats.append(
                _NormalizedNovelBeat(
                    kind=STORY_NOVEL_BEAT_NARRATION,
                    text=page,
                    speaker_name=None,
                    emotion=None,
                    scene_characters=current_scene_characters,
                )
            )

    for raw_line in _split_story_novel_logical_paragraphs(raw_text):
        line = raw_line.strip()
        cast_match = _VN_SCENE_CAST_SUFFIX.match(line)
        if cast_match is None:
            cast_match = _VN_SCENE_CAST_PREFIX.match(line)
        has_scene_cast_metadata = cast_match is not None
        scene_characters: tuple[tuple[str, str], ...] = ()
        if cast_match is not None:
            scene_characters = _parse_story_novel_scene_cast(cast_match.group("cast"))
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
                )
            )
        else:
            if has_scene_cast_metadata:
                narration_scene_characters.extend(scene_characters)
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


def _serialize_story_novel_scene_characters(
    scene_characters: tuple[tuple[str, str], ...],
    *,
    speaker_map: dict[str, int],
) -> str:
    payload: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for name, raw_emotion in scene_characters:
        character_id = _resolve_novel_speaker_character_id(name, speaker_map)
        dedup_key = f"id:{character_id}" if character_id is not None else f"name:{_story_speaker_key(name)}"
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)
        payload.append(
            {
                "name": name,
                "emotion": normalize_story_character_emotion_id(raw_emotion)
                or STORY_CHARACTER_DEFAULT_EMOTION,
                "character_id": character_id,
            }
        )
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
) -> tuple[tuple[str, str], ...]:
    """Best-effort fallback for old/opening prose created before VN_CAST existed.

    Only exact card-title mentions that resolve to a linked character are accepted.  This keeps
    the fallback deterministic and avoids turning ordinary role words into unrelated sprites.
    """
    matches: list[tuple[int, int, str, int]] = []
    for card in world_cards:
        title = " ".join(str(getattr(card, "title", "") or "").split()).strip()
        if not title:
            continue
        character_id = _resolve_novel_speaker_character_id(title, speaker_map)
        if character_id is None:
            continue
        mention_start = story_novel_exact_mention_start(text, title)
        if mention_start is None:
            continue
        matches.append(
            (
                mention_start,
                int(getattr(card, "id", 0) or 0),
                title,
                int(character_id),
            )
        )

    result: list[tuple[str, str]] = []
    seen_character_ids: set[int] = set()
    for _position, _card_id, title, character_id in sorted(matches):
        if character_id in seen_character_ids:
            continue
        seen_character_ids.add(character_id)
        result.append((title, STORY_CHARACTER_DEFAULT_EMOTION))
        if len(result) >= STORY_NOVEL_MAX_SCENE_CHARACTERS:
            break
    return tuple(result)


def persist_story_novel_beats_for_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    raw_response: str,
    world_cards: list[StoryWorldCard] | None = None,
    infer_narration_scene_characters: bool = False,
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
        scene_characters = beat.scene_characters
        if (
            infer_narration_scene_characters
            and beat.kind == STORY_NOVEL_BEAT_NARRATION
            and not scene_characters
        ):
            scene_characters = _infer_story_novel_narration_scene_characters(
                beat.text,
                world_cards=list(world_cards or []),
                speaker_map=speaker_map,
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
