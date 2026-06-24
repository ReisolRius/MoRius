from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models import (
    StoryCharacter,
    StoryCharacterSpriteAsset,
    StoryGame,
    StoryMessage,
    StoryMessageSegment,
    StoryWorldCard,
)
from app.schemas import StoryVNBeatOut
from app.services.media import resolve_media_display_url
from app.services.story_display_modes import (
    STORY_DISPLAY_MODE_VISUAL_NOVEL,
    can_user_use_visual_novel_mode,
    normalize_story_display_mode,
)
from app.services.story_emotions import (
    STORY_CHARACTER_EMOTION_IDS,
    deserialize_story_character_emotion_assets,
    normalize_story_character_emotion_id,
)
from app.services.text_encoding import sanitize_likely_utf8_mojibake

VN_BEAT_TYPE_NARRATION = "narration"
VN_BEAT_TYPE_DIALOGUE = "dialogue"
VN_BEAT_TYPE_THOUGHT = "thought"
VN_BEAT_TYPE_SYSTEM = "system"
VN_BEAT_TYPES = {
    VN_BEAT_TYPE_NARRATION,
    VN_BEAT_TYPE_DIALOGUE,
    VN_BEAT_TYPE_THOUGHT,
    VN_BEAT_TYPE_SYSTEM,
}
VN_MAX_BEATS_PER_MESSAGE = 36
VN_MAX_BEAT_TEXT_CHARS = 2_800
_JSON_DECODER = json.JSONDecoder()
_SPEAKER_LINE_PATTERN = re.compile(r"^\s*(?:[-\u2013\u2014]\s*)?([^:\n]{1,80})\s*[:\u2014-]\s+(.+)$")

_EMOTION_ALIASES: dict[str, str] = {
    "neutral": "calm",
    "normal": "calm",
    "serious": "stern",
    "strict": "stern",
    "grin": "sly",
    "smile": "smiling",
    "joy": "happy",
    "glad": "happy",
    "fear": "scared",
    "afraid": "scared",
    "shy": "embarrassed",
    "awkward": "embarrassed",
    "thinking": "thoughtful",
    "pensive": "thoughtful",
    "angry": "angry",
    "mad": "angry",
    "annoyed": "irritated",
    "irritated": "irritated",
    "calm": "calm",
    "cheerful": "cheerful",
    "alert": "alert",
    "confused": "confused",
    "stern": "stern",
    "sly": "sly",
    "happy": "happy",
    "embarrassed": "embarrassed",
    "thoughtful": "thoughtful",
    "scared": "scared",
    "spokojno": "calm",
    "calmly": "calm",
    "zlo": "angry",
    "angrily": "angry",
}

_BEAT_TYPE_ALIASES: dict[str, str] = {
    "narrator": VN_BEAT_TYPE_NARRATION,
    "narrative": VN_BEAT_TYPE_NARRATION,
    "description": VN_BEAT_TYPE_NARRATION,
    "scene": VN_BEAT_TYPE_NARRATION,
    "dialog": VN_BEAT_TYPE_DIALOGUE,
    "dialogue": VN_BEAT_TYPE_DIALOGUE,
    "speech": VN_BEAT_TYPE_DIALOGUE,
    "line": VN_BEAT_TYPE_DIALOGUE,
    "thought": VN_BEAT_TYPE_THOUGHT,
    "inner": VN_BEAT_TYPE_THOUGHT,
    "internal": VN_BEAT_TYPE_THOUGHT,
    "system": VN_BEAT_TYPE_SYSTEM,
}


@dataclass(frozen=True)
class NormalizedVNBeat:
    beat_type: str
    text: str
    speaker_name: str | None = None
    speaker_character_id: int | None = None
    emotion: str | None = None
    sprite_asset_id: int | None = None
    background_image_url: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class NormalizedVNResponse:
    beats: list[NormalizedVNBeat]
    source_format: str
    rendered_text: str


@dataclass(frozen=True)
class _SpeakerRef:
    name: str
    card: StoryWorldCard | None
    character: StoryCharacter | None


def is_story_visual_novel_enabled_for_user(game: StoryGame, user: Any) -> bool:
    return (
        can_user_use_visual_novel_mode(user)
        and normalize_story_display_mode(getattr(game, "display_mode", None)) == STORY_DISPLAY_MODE_VISUAL_NOVEL
    )


def build_visual_novel_instruction_card() -> dict[str, str]:
    return {
        "title": "Visual Novel Beat Contract",
        "content": (
            "For this admin-only game mode, Return JSON only; no markdown, reasoning, or commentary. "
            "Schema: {\"beats\":[{\"type\":\"narration|dialogue|thought|system\","
            "\"speaker\":string|null,\"emotion\":\"calm|angry|irritated|stern|cheerful|smiling|sly|alert|scared|happy|embarrassed|confused|thoughtful\","
            "\"text\":string,\"visual_hint\":string|null,\"background_hint\":string|null}]}. "
            "Use narration for scene text, dialogue for spoken lines, thought for private thoughts, and system only for concise mechanical results. "
            "Keep story content in Russian when the game is in Russian. Do not include markdown or prose outside the JSON object."
        ),
        "source_kind": "visual_novel",
    }


def _normalize_text(value: Any, *, max_length: int = VN_MAX_BEAT_TEXT_CHARS) -> str:
    normalized = sanitize_likely_utf8_mojibake(str(value or "")).replace("\r\n", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip()
    return normalized


def _normalize_beat_type(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in VN_BEAT_TYPES:
        return normalized
    return _BEAT_TYPE_ALIASES.get(normalized, VN_BEAT_TYPE_NARRATION)


def _normalize_emotion(value: Any) -> str | None:
    normalized = normalize_story_character_emotion_id(value)
    if normalized is not None:
        return normalized
    alias_key = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    alias_value = _EMOTION_ALIASES.get(alias_key)
    if alias_value is not None:
        return alias_value
    return None


def _safe_json_dump(value: dict[str, Any] | None) -> str:
    try:
        return json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return "{}"


def _safe_json_load_dict(raw_value: str | None) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _extract_json_payload(raw_text: str) -> Any | None:
    normalized = raw_text.strip()
    if not normalized:
        return None
    if normalized.startswith("```"):
        normalized = re.sub(r"^\s*```(?:json)?\s*", "", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\s*```\s*$", "", normalized)
    starts = [index for index in (normalized.find("{"), normalized.find("[")) if index >= 0]
    if not starts:
        return None
    start_index = min(starts)
    try:
        parsed, _end_index = _JSON_DECODER.raw_decode(normalized[start_index:])
    except (TypeError, ValueError):
        return None
    return parsed


def _iter_json_beats(parsed_payload: Any) -> list[dict[str, Any]]:
    if isinstance(parsed_payload, dict):
        raw_beats = parsed_payload.get("beats")
        if isinstance(raw_beats, list):
            return [item for item in raw_beats if isinstance(item, dict)]
        if isinstance(parsed_payload.get("segments"), list):
            return [item for item in parsed_payload["segments"] if isinstance(item, dict)]
    if isinstance(parsed_payload, list):
        return [item for item in parsed_payload if isinstance(item, dict)]
    return []


def _normalize_speaker_name(value: Any) -> str | None:
    normalized = " ".join(str(value or "").replace("\r\n", "\n").split()).strip(" .,:;!?\"'()[]")
    if not normalized:
        return None
    lowered = normalized.casefold()
    if lowered in {"narrator", "author", "scene", "system", "story"}:
        return None
    return normalized[:120].rstrip() or None


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


def _speaker_lookup_key(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _build_speaker_refs(db: Session, world_cards: list[StoryWorldCard]) -> dict[str, _SpeakerRef]:
    character_ids = {
        int(character_id)
        for card in world_cards
        if (character_id := getattr(card, "character_id", None)) is not None and int(character_id or 0) > 0
    }
    characters_by_id: dict[int, StoryCharacter] = {}
    if character_ids:
        characters_by_id = {
            int(character.id): character
            for character in db.scalars(select(StoryCharacter).where(StoryCharacter.id.in_(character_ids))).all()
        }

    refs: dict[str, _SpeakerRef] = {}
    for card in world_cards:
        title = _normalize_speaker_name(getattr(card, "title", None))
        if not title:
            continue
        character_id = getattr(card, "character_id", None)
        character = characters_by_id.get(int(character_id)) if character_id is not None else None
        ref = _SpeakerRef(name=title, card=card, character=character)
        for key_value in [title, *(_deserialize_world_card_triggers(getattr(card, "triggers", None)))]:
            key = _speaker_lookup_key(key_value)
            if key:
                refs.setdefault(key, ref)
    return refs


def _resolve_speaker_ref(speaker_name: str | None, refs: dict[str, _SpeakerRef]) -> _SpeakerRef | None:
    if not speaker_name:
        return None
    key = _speaker_lookup_key(speaker_name)
    if not key:
        return None
    if key in refs:
        return refs[key]
    for candidate_key, ref in refs.items():
        if key in candidate_key or candidate_key in key:
            return ref
    return None


def _resolve_sprite_asset_from_registry(
    db: Session,
    *,
    character_id: int,
    emotion: str,
) -> tuple[int | None, str | None]:
    emotion_candidates = [emotion, "calm", *STORY_CHARACTER_EMOTION_IDS]
    seen: set[str] = set()
    for emotion_candidate in emotion_candidates:
        if emotion_candidate in seen:
            continue
        seen.add(emotion_candidate)
        asset = db.scalar(
            select(StoryCharacterSpriteAsset)
            .where(
                StoryCharacterSpriteAsset.character_id == character_id,
                StoryCharacterSpriteAsset.emotion == emotion_candidate,
                StoryCharacterSpriteAsset.processing_status == "ready",
                StoryCharacterSpriteAsset.processed_image_url.is_not(None),
            )
            .order_by(StoryCharacterSpriteAsset.id.desc())
            .limit(1)
        )
        if asset is None:
            continue
        raw_url = (
            getattr(asset, "desktop_image_url", None)
            or getattr(asset, "processed_image_url", None)
            or getattr(asset, "mobile_image_url", None)
            or getattr(asset, "original_image_url", None)
        )
        if raw_url:
            return int(asset.id), str(raw_url)
    return None, None


def _resolve_sprite_for_beat(
    db: Session,
    *,
    speaker_ref: _SpeakerRef | None,
    emotion: str | None,
) -> tuple[int | None, str | None, str, bool]:
    resolved_emotion = emotion or "calm"
    if speaker_ref is None:
        return None, None, "none", True

    character = speaker_ref.character
    if character is not None:
        character_id = int(character.id)
        registry_asset_id, registry_url = _resolve_sprite_asset_from_registry(
            db,
            character_id=character_id,
            emotion=resolved_emotion,
        )
        if registry_url:
            return registry_asset_id, registry_url, "sprite_registry", False

        raw_assets = deserialize_story_character_emotion_assets(getattr(character, "emotion_assets", None))
        emotion_candidates = [resolved_emotion, "calm", *STORY_CHARACTER_EMOTION_IDS]
        seen: set[str] = set()
        for emotion_candidate in emotion_candidates:
            if emotion_candidate in seen:
                continue
            seen.add(emotion_candidate)
            raw_asset = raw_assets.get(emotion_candidate)
            if not raw_asset:
                continue
            resolved_asset = resolve_media_display_url(
                raw_asset,
                kind="story-character-emotion-asset",
                entity_id=character_id,
                version=getattr(character, "updated_at", None),
                asset_id=emotion_candidate,
            )
            if resolved_asset:
                return None, resolved_asset, "character_emotion_asset", False

        character_avatar = resolve_media_display_url(
            getattr(character, "avatar_url", None),
            kind="story-character-avatar",
            entity_id=character_id,
            version=getattr(character, "updated_at", None),
        )
        if character_avatar:
            return None, character_avatar, "character_avatar", False

    card = speaker_ref.card
    if card is not None:
        card_avatar = resolve_media_display_url(
            getattr(card, "avatar_url", None),
            kind="story-world-card-avatar",
            entity_id=int(card.id),
            version=getattr(card, "updated_at", None),
        )
        if card_avatar:
            return None, card_avatar, "world_card_avatar", False

    return None, None, "placeholder", True


def _normalize_json_beat(raw_beat: dict[str, Any]) -> NormalizedVNBeat | None:
    beat_type = _normalize_beat_type(raw_beat.get("type") or raw_beat.get("beat_type") or raw_beat.get("kind"))
    text = _normalize_text(raw_beat.get("text") or raw_beat.get("content") or raw_beat.get("line"))
    if not text:
        return None
    speaker_name = _normalize_speaker_name(raw_beat.get("speaker") or raw_beat.get("speaker_name") or raw_beat.get("name"))
    if speaker_name and beat_type == VN_BEAT_TYPE_NARRATION:
        beat_type = VN_BEAT_TYPE_DIALOGUE
    emotion = _normalize_emotion(raw_beat.get("emotion"))
    metadata = {
        "visual_hint": _normalize_text(raw_beat.get("visual_hint"), max_length=420) or None,
        "background_hint": _normalize_text(raw_beat.get("background_hint"), max_length=420) or None,
        "source": "json",
    }
    return NormalizedVNBeat(
        beat_type=beat_type,
        text=text,
        speaker_name=speaker_name,
        emotion=emotion,
        background_image_url=(
            _normalize_text(raw_beat.get("background_image_url"), max_length=2048)
            or _normalize_text(raw_beat.get("background"), max_length=2048)
            or None
        ),
        metadata={key: value for key, value in metadata.items() if value is not None},
    )


def _looks_like_thought(speaker_name: str | None, text: str) -> bool:
    lowered_speaker = str(speaker_name or "").casefold()
    lowered_text = text.casefold()
    return (
        "thought" in lowered_speaker
        or "inner" in lowered_speaker
        or lowered_text.startswith("(")
        and lowered_text.endswith(")")
    )


def _split_fallback_blocks(raw_text: str) -> list[str]:
    normalized = raw_text.replace("\r\n", "\n").strip()
    if not normalized:
        return []
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", normalized) if item.strip()]
    if len(paragraphs) > 1:
        return paragraphs
    return [item.strip() for item in normalized.split("\n") if item.strip()]


def _normalize_fallback_block(block: str) -> list[NormalizedVNBeat]:
    marker_match = re.match(r"^\s*\[\[(?P<kind>[A-Z_]+)(?::(?P<speaker>[^\]]+))?\]\]\s*(?P<text>.+)$", block, re.DOTALL)
    if marker_match is not None:
        kind = marker_match.group("kind").casefold()
        speaker_name = _normalize_speaker_name(marker_match.group("speaker"))
        text = _normalize_text(marker_match.group("text"))
        if not text:
            return []
        beat_type = VN_BEAT_TYPE_THOUGHT if "thought" in kind else VN_BEAT_TYPE_DIALOGUE if speaker_name else VN_BEAT_TYPE_NARRATION
        return [
            NormalizedVNBeat(
                beat_type=beat_type,
                text=text,
                speaker_name=speaker_name,
                emotion="thoughtful" if beat_type == VN_BEAT_TYPE_THOUGHT else None,
                metadata={"source": "fallback_marker"},
            )
        ]

    speaker_match = _SPEAKER_LINE_PATTERN.match(block)
    if speaker_match is not None:
        speaker_name = _normalize_speaker_name(speaker_match.group(1))
        text = _normalize_text(speaker_match.group(2))
        if text:
            beat_type = VN_BEAT_TYPE_THOUGHT if _looks_like_thought(speaker_name, text) else VN_BEAT_TYPE_DIALOGUE
            return [
                NormalizedVNBeat(
                    beat_type=beat_type,
                    text=text.strip("()") if beat_type == VN_BEAT_TYPE_THOUGHT else text,
                    speaker_name=speaker_name,
                    emotion="thoughtful" if beat_type == VN_BEAT_TYPE_THOUGHT else None,
                    metadata={"source": "fallback_speaker_line"},
                )
            ]

    text = _normalize_text(block)
    if not text:
        return []
    return [NormalizedVNBeat(beat_type=VN_BEAT_TYPE_NARRATION, text=text, metadata={"source": "fallback_text"})]


def _render_story_text(beats: list[NormalizedVNBeat]) -> str:
    lines: list[str] = []
    for beat in beats:
        speaker_name = _normalize_speaker_name(beat.speaker_name)
        text = _normalize_text(beat.text)
        if not text:
            continue
        if speaker_name and beat.beat_type in {VN_BEAT_TYPE_DIALOGUE, VN_BEAT_TYPE_THOUGHT}:
            rendered_text = f"{speaker_name}: {text}"
            if beat.beat_type == VN_BEAT_TYPE_THOUGHT:
                rendered_text = f"{speaker_name} (thought): {text}"
            lines.append(rendered_text)
        else:
            lines.append(text)
    return "\n\n".join(lines).strip()


def normalize_visual_novel_response(
    raw_response: str,
    *,
    db: Session | None = None,
    world_cards: list[StoryWorldCard] | None = None,
) -> NormalizedVNResponse:
    raw_text = str(raw_response or "").replace("\r\n", "\n").strip()
    parsed_payload = _extract_json_payload(raw_text)
    raw_beats = _iter_json_beats(parsed_payload)
    source_format = "json" if raw_beats else "text"

    beats: list[NormalizedVNBeat] = []
    if raw_beats:
        for raw_beat in raw_beats:
            normalized_beat = _normalize_json_beat(raw_beat)
            if normalized_beat is not None:
                beats.append(normalized_beat)
            if len(beats) >= VN_MAX_BEATS_PER_MESSAGE:
                break
    else:
        for block in _split_fallback_blocks(raw_text):
            beats.extend(_normalize_fallback_block(block))
            if len(beats) >= VN_MAX_BEATS_PER_MESSAGE:
                beats = beats[:VN_MAX_BEATS_PER_MESSAGE]
                break

    if not beats and raw_text:
        beats = [NormalizedVNBeat(beat_type=VN_BEAT_TYPE_NARRATION, text=_normalize_text(raw_text))]

    if db is not None and world_cards is not None and beats:
        refs = _build_speaker_refs(db, world_cards)
        resolved_beats: list[NormalizedVNBeat] = []
        for beat in beats:
            speaker_ref = _resolve_speaker_ref(beat.speaker_name, refs)
            resolved_speaker_name = beat.speaker_name
            speaker_character_id = beat.speaker_character_id
            if speaker_ref is not None:
                resolved_speaker_name = speaker_ref.name
                if speaker_ref.character is not None:
                    speaker_character_id = int(speaker_ref.character.id)
            emotion = beat.emotion or ("calm" if beat.beat_type in {VN_BEAT_TYPE_DIALOGUE, VN_BEAT_TYPE_THOUGHT} else None)
            sprite_asset_id, sprite_url, sprite_source, sprite_placeholder = _resolve_sprite_for_beat(
                db,
                speaker_ref=speaker_ref,
                emotion=emotion,
            )
            metadata = dict(beat.metadata or {})
            if sprite_url:
                metadata["sprite_url"] = sprite_url
            metadata["sprite_source"] = sprite_source
            metadata["sprite_placeholder"] = sprite_placeholder
            if speaker_ref is not None and speaker_ref.card is not None:
                metadata["world_card_id"] = int(speaker_ref.card.id)
                metadata["world_card_kind"] = str(getattr(speaker_ref.card, "kind", "") or "")
            resolved_beats.append(
                NormalizedVNBeat(
                    beat_type=beat.beat_type,
                    text=beat.text,
                    speaker_name=resolved_speaker_name,
                    speaker_character_id=speaker_character_id,
                    emotion=emotion,
                    sprite_asset_id=sprite_asset_id if sprite_asset_id is not None else beat.sprite_asset_id,
                    background_image_url=beat.background_image_url,
                    metadata=metadata,
                )
            )
        beats = resolved_beats

    return NormalizedVNResponse(
        beats=beats,
        source_format=source_format,
        rendered_text=_render_story_text(beats) or raw_text,
    )


def persist_visual_novel_beats_for_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage,
    raw_response: str,
    world_cards: list[StoryWorldCard],
) -> list[StoryMessageSegment]:
    normalized_response = normalize_visual_novel_response(
        raw_response,
        db=db,
        world_cards=world_cards,
    )
    db.execute(sa_delete(StoryMessageSegment).where(StoryMessageSegment.message_id == assistant_message.id))
    assistant_message.vn_raw_response = str(raw_response or "").replace("\r\n", "\n").strip()
    if normalized_response.source_format == "json":
        assistant_message.content = normalized_response.rendered_text

    rows: list[StoryMessageSegment] = []
    for index, beat in enumerate(normalized_response.beats):
        row = StoryMessageSegment(
            game_id=int(game.id),
            message_id=int(assistant_message.id),
            order_index=index,
            beat_type=beat.beat_type,
            speaker_character_id=beat.speaker_character_id,
            speaker_name=beat.speaker_name,
            emotion=beat.emotion,
            text=beat.text,
            sprite_asset_id=beat.sprite_asset_id,
            background_image_url=beat.background_image_url,
            metadata_json=_safe_json_dump(
                {
                    **(beat.metadata or {}),
                    "source_format": normalized_response.source_format,
                }
            ),
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def story_vn_beat_to_out(segment: StoryMessageSegment) -> StoryVNBeatOut:
    beat_type = _normalize_beat_type(getattr(segment, "beat_type", None))
    if beat_type not in VN_BEAT_TYPES:
        beat_type = VN_BEAT_TYPE_NARRATION
    return StoryVNBeatOut(
        id=int(segment.id),
        game_id=int(segment.game_id),
        message_id=int(segment.message_id),
        order_index=max(int(getattr(segment, "order_index", 0) or 0), 0),
        beat_type=beat_type,  # type: ignore[arg-type]
        speaker_character_id=(
            int(segment.speaker_character_id)
            if getattr(segment, "speaker_character_id", None) is not None
            else None
        ),
        speaker_name=_normalize_speaker_name(getattr(segment, "speaker_name", None)),
        emotion=_normalize_emotion(getattr(segment, "emotion", None)),
        text=_normalize_text(getattr(segment, "text", "")),
        sprite_asset_id=(
            int(segment.sprite_asset_id)
            if getattr(segment, "sprite_asset_id", None) is not None
            else None
        ),
        background_image_url=str(getattr(segment, "background_image_url", "") or "").strip() or None,
        metadata=_safe_json_load_dict(getattr(segment, "metadata_json", None)),
        created_at=segment.created_at,
        updated_at=segment.updated_at,
    )


def serialize_story_vn_beats_for_stream(segments: list[StoryMessageSegment]) -> list[dict[str, Any]]:
    return [story_vn_beat_to_out(segment).model_dump(mode="json") for segment in segments]
