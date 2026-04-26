from __future__ import annotations

from dataclasses import asdict, dataclass, field
from copy import deepcopy
import json
import logging
import re
from typing import Any, Literal

from app.services.story_output_contract import (
    ContractIssue,
    UiBlock,
    ValidationResult,
    get_ai_output_contract_notes,
    iter_user_visible_text,
    parse_ai_output_to_ui_blocks,
    serialize_ui_blocks_to_existing_ai_output,
    validate_ai_output_contract,
)
from app.services.text_encoding import is_likely_utf8_mojibake, sanitize_likely_utf8_mojibake


logger = logging.getLogger(__name__)


def _decoded_byte_chars(encoding: str) -> str:
    return bytes(range(0x80, 0xC0)).decode(encoding, errors="ignore")


_CP1251_MOJIBAKE_TAIL_CHARS = re.escape(_decoded_byte_chars("cp1251"))
_CP1252_MOJIBAKE_TAIL_CHARS = re.escape(
    _decoded_byte_chars("cp1252") + "".join(chr(value) for value in range(0x80, 0xC0))
)
_CP1251_MOJIBAKE_RUN_PATTERN = re.compile(rf"(?:[РС][{_CP1251_MOJIBAKE_TAIL_CHARS}]){{2,}}")
_CP1252_MOJIBAKE_RUN_PATTERN = re.compile(rf"(?:[ÐÑ][{_CP1252_MOJIBAKE_TAIL_CHARS}]){{2,}}")
_CJK_PATTERN = re.compile(r"[\u4E00-\u9FFF]")
_COMMON_VISIBLE_MOJIBAKE_PATTERN = re.compile(
    r"(?:Рџ|РЎ|Рґ|Рµ|Рё|РЅ|Р°|Рѕ|Р»|Рј|СЃ|С‚|СЊ|С‹|СЋ|СЏ|вЂ|Ð|Ñ|Ã)"
)
_LATIN_WORD_PATTERN = re.compile(r"\b[A-Za-z]{3,}\b")
_CYRILLIC_PATTERN = re.compile(r"[А-Яа-яЁё]")
_APPROACH_PATTERN = re.compile(r"\b(?:подош[её]л|подошла|подошли|приблизил[асься]+|шагнул[аи]? к|шагнула к)\b", re.IGNORECASE)
_COFFEE_PATTERN = re.compile(r"\bкофе\b", re.IGNORECASE)
_TEA_PATTERN = re.compile(r"\b(?:чай|ча[её]м|чая|чаю)\b", re.IGNORECASE)
_PICKUP_PATTERN = re.compile(
    r"\b(?:беру|берёт|взял[аи]?|поднимаю|поднял[аи]?|подобрал[аи]?|хватаю|схватил[аи]?)\s+([^.!?\n]{1,80})",
    re.IGNORECASE,
)
_DROP_PATTERN = re.compile(
    r"\b(?:ставлю|поставил[аи]?|кладу|положил[аи]?|бросаю|бросил[аи]?|отпускаю)\s+([^.!?\n]{1,80})",
    re.IGNORECASE,
)
_DIALOGUE_PATTERN = re.compile(r"[\"«„“].+?[\"»”]|(?:говорю|сказал[аи]?|спрашиваю|спросил[аи]?|отвечаю|ответил[аи]?|обращаюсь)", re.IGNORECASE)
CANONICAL_STATE_PAYLOAD_ATTR = "canonical_state_payload"
CANONICAL_STATE_VERSION = 1


@dataclass
class HeldItem:
    object_id: str
    name: str = ""
    contents: str = ""


@dataclass
class CanonicalScene:
    location_id: str | None = None
    location_name: str | None = None
    zone_id: str | None = None
    time_of_day: str | None = None
    weather: str | None = None


@dataclass
class CanonicalPlayer:
    character_id: str | None = "player"
    zone_id: str | None = None
    posture: str = "unknown"
    facing: str | None = None
    left_hand: HeldItem | None = None
    right_hand: HeldItem | None = None
    clothing: list[str] = field(default_factory=list)
    health: list[str] = field(default_factory=list)


@dataclass
class CanonicalNpc:
    character_id: str
    name: str = ""
    zone_id: str | None = None
    distance_to_player: str = "unknown"
    posture: str = "unknown"
    facing: str | None = None
    clothing: list[str] = field(default_factory=list)
    health: list[str] = field(default_factory=list)
    current_intent: str | None = None


@dataclass
class CanonicalObject:
    object_id: str
    type: str = "item"
    name: str = ""
    contents: str = ""
    holder_character_id: str | None = None
    zone_id: str | None = None
    state: str = ""


@dataclass
class CanonicalConversation:
    active_speaker_id: str | None = None
    active_addressee_id: str | None = None
    last_speaker_id: str | None = None
    last_addressee_id: str | None = None


@dataclass
class NarrativePatterns:
    recent_openings: list[str] = field(default_factory=list)
    recent_actions: list[str] = field(default_factory=list)
    recent_endings: list[str] = field(default_factory=list)
    repeated_phrases: list[str] = field(default_factory=list)


@dataclass
class CanonicalStateV1:
    version: Literal[1] = 1
    language: Literal["ru"] = "ru"
    scene: CanonicalScene = field(default_factory=CanonicalScene)
    player: CanonicalPlayer = field(default_factory=CanonicalPlayer)
    npcs: dict[str, CanonicalNpc] = field(default_factory=dict)
    objects: dict[str, CanonicalObject] = field(default_factory=dict)
    conversation: CanonicalConversation = field(default_factory=CanonicalConversation)
    narrative_patterns: NarrativePatterns = field(default_factory=NarrativePatterns)
    uncertainties: list[str] = field(default_factory=list)


@dataclass
class ObjectInteraction:
    verb: str
    object_name: str = ""
    object_id: str | None = None
    target_hand: Literal["left", "right", "unspecified"] = "unspecified"


@dataclass
class ParsedDialogue:
    speaker_id: str
    addressee_id: str | None = None
    addressee_name: str | None = None
    text: str | None = None


@dataclass
class ParsedMovement:
    from_zone_id: str | None = None
    to_zone_id: str | None = None
    relation_to_target: str | None = None


@dataclass
class ParsedPlayerTurn:
    actor_id: str = "player"
    action_types: list[str] = field(default_factory=list)
    object_interactions: list[ObjectInteraction] = field(default_factory=list)
    movement: ParsedMovement | None = None
    dialogue: ParsedDialogue | None = None
    posture_change: str | None = None
    uncertainties: list[str] = field(default_factory=list)


@dataclass
class StateDelta:
    path: str
    old_value: Any
    new_value: Any
    reason: str
    confidence: float


@dataclass
class StateValidationIssue:
    code: str
    severity: Literal["low", "medium", "high", "fatal"]
    message: str


@dataclass
class StateValidationReport:
    ok: bool
    issues: list[StateValidationIssue] = field(default_factory=list)


@dataclass
class ScenePlan:
    response_mode: Literal["narration", "dialogue", "mixed"] = "narration"
    main_responder_id: str | None = None
    beats: list[str] = field(default_factory=list)
    forbidden_beats: list[str] = field(default_factory=list)
    required_facts: list[str] = field(default_factory=list)
    emotional_direction: str | None = None
    output_contract_notes: list[str] = field(default_factory=list)


@dataclass
class QualityIssue:
    code: str
    severity: Literal["low", "medium", "high", "fatal"]
    message: str
    suggested_fix: str | None = None


@dataclass
class QualityReport:
    ok: bool
    issues: list[QualityIssue] = field(default_factory=list)


@dataclass
class CanonicalPipelineContext:
    state: CanonicalStateV1
    parsed_turn: ParsedPlayerTurn
    next_state: CanonicalStateV1
    deltas: list[StateDelta]
    validation: StateValidationReport
    scene_plan: ScenePlan


@dataclass
class OutputGuardResult:
    output: str
    contract: ValidationResult
    language: QualityReport
    quality: QualityReport
    patched: bool = False
    fallback_used: bool = False
    state: CanonicalStateV1 | None = None


def _normalize_text(value: Any) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _compact(value: Any, *, max_chars: int = 240) -> str:
    normalized = " ".join(_normalize_text(value).split())
    return normalized[:max_chars].rstrip()


def _state_debug_summary(state: CanonicalStateV1) -> dict[str, Any]:
    return {
        "version": state.version,
        "scene_zone": state.scene.zone_id,
        "player_zone": state.player.zone_id,
        "npc_count": len(state.npcs),
        "object_count": len(state.objects),
        "active_addressee_id": state.conversation.active_addressee_id,
        "held_left": bool(state.player.left_hand),
        "held_right": bool(state.player.right_hand),
    }


def serialize_canonical_state(state: CanonicalStateV1) -> str:
    payload = asdict(state)
    payload["version"] = CANONICAL_STATE_VERSION
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def deserialize_canonical_state_payload(raw_value: Any) -> CanonicalStateV1 | None:
    raw_text = str(raw_value or "").strip()
    if not raw_text:
        return None
    try:
        parsed = json.loads(raw_text)
    except Exception:
        logger.warning("Failed to parse canonical state payload", exc_info=True)
        return None
    if not isinstance(parsed, dict):
        return None
    if int(parsed.get("version") or 0) != CANONICAL_STATE_VERSION:
        return None
    return _canonical_state_from_dict(parsed)


def persist_canonical_state_to_game(game: Any | None, state: CanonicalStateV1) -> bool:
    if game is None:
        return False
    try:
        setattr(game, CANONICAL_STATE_PAYLOAD_ATTR, serialize_canonical_state(state))
    except Exception:
        logger.exception("Failed to attach canonical state payload to game")
        return False
    return True


def clear_canonical_state_payload(game: Any | None) -> bool:
    if game is None or not hasattr(game, CANONICAL_STATE_PAYLOAD_ATTR):
        return False
    try:
        setattr(game, CANONICAL_STATE_PAYLOAD_ATTR, "")
    except Exception:
        logger.exception("Failed to clear canonical state payload from game")
        return False
    return True


def _canonical_state_from_dict(payload: dict[str, Any]) -> CanonicalStateV1:
    state = CanonicalStateV1()
    state.scene = CanonicalScene(**_pick_dict(payload.get("scene"), {"location_id", "location_name", "zone_id", "time_of_day", "weather"}))
    player_payload = _pick_dict(
        payload.get("player"),
        {"character_id", "zone_id", "posture", "facing", "clothing", "health"},
    )
    state.player = CanonicalPlayer(
        character_id=_optional_str(player_payload.get("character_id"), fallback="player"),
        zone_id=_optional_str(player_payload.get("zone_id")),
        posture=str(player_payload.get("posture") or "unknown"),
        facing=_optional_str(player_payload.get("facing")),
        left_hand=_held_item_from_dict(_as_dict(payload.get("player")).get("left_hand")),
        right_hand=_held_item_from_dict(_as_dict(payload.get("player")).get("right_hand")),
        clothing=_coerce_str_list(player_payload.get("clothing")),
        health=_coerce_str_list(player_payload.get("health")),
    )

    state.npcs = {}
    for npc_id, raw_npc in _as_dict(payload.get("npcs")).items():
        npc_payload = _as_dict(raw_npc)
        character_id = str(npc_payload.get("character_id") or npc_id).strip()
        if not character_id:
            continue
        state.npcs[character_id] = CanonicalNpc(
            character_id=character_id,
            name=str(npc_payload.get("name") or "").strip(),
            zone_id=_optional_str(npc_payload.get("zone_id")),
            distance_to_player=str(npc_payload.get("distance_to_player") or "unknown"),
            posture=str(npc_payload.get("posture") or "unknown"),
            facing=_optional_str(npc_payload.get("facing")),
            clothing=_coerce_str_list(npc_payload.get("clothing")),
            health=_coerce_str_list(npc_payload.get("health")),
            current_intent=_optional_str(npc_payload.get("current_intent")),
        )

    state.objects = {}
    for object_id, raw_object in _as_dict(payload.get("objects")).items():
        object_payload = _as_dict(raw_object)
        resolved_object_id = str(object_payload.get("object_id") or object_id).strip()
        if not resolved_object_id:
            continue
        state.objects[resolved_object_id] = CanonicalObject(
            object_id=resolved_object_id,
            type=str(object_payload.get("type") or "item"),
            name=str(object_payload.get("name") or "").strip(),
            contents=str(object_payload.get("contents") or "").strip(),
            holder_character_id=_optional_str(object_payload.get("holder_character_id")),
            zone_id=_optional_str(object_payload.get("zone_id")),
            state=str(object_payload.get("state") or "").strip(),
        )

    conversation_payload = _as_dict(payload.get("conversation"))
    state.conversation = CanonicalConversation(
        active_speaker_id=_optional_str(conversation_payload.get("active_speaker_id")),
        active_addressee_id=_optional_str(conversation_payload.get("active_addressee_id")),
        last_speaker_id=_optional_str(conversation_payload.get("last_speaker_id")),
        last_addressee_id=_optional_str(conversation_payload.get("last_addressee_id")),
    )

    patterns_payload = _as_dict(payload.get("narrative_patterns"))
    state.narrative_patterns = NarrativePatterns(
        recent_openings=_coerce_str_list(patterns_payload.get("recent_openings"), max_items=8),
        recent_actions=_coerce_str_list(patterns_payload.get("recent_actions"), max_items=12),
        recent_endings=_coerce_str_list(patterns_payload.get("recent_endings"), max_items=8),
        repeated_phrases=_coerce_str_list(patterns_payload.get("repeated_phrases"), max_items=12),
    )
    state.uncertainties = _coerce_str_list(payload.get("uncertainties"), max_items=20)
    return state


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _pick_dict(value: Any, keys: set[str]) -> dict[str, Any]:
    raw = _as_dict(value)
    return {key: raw.get(key) for key in keys}


def _optional_str(value: Any, *, fallback: str | None = None) -> str | None:
    normalized = str(value if value is not None else fallback or "").strip()
    return normalized or None


def _coerce_str_list(value: Any, *, max_items: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized: list[str] = []
    for item in value:
        text = _compact(item, max_chars=160)
        if text:
            normalized.append(text)
        if len(normalized) >= max_items:
            break
    return normalized


def _held_item_from_dict(value: Any) -> HeldItem | None:
    raw = _as_dict(value)
    object_id = str(raw.get("object_id") or "").strip()
    if not object_id:
        return None
    return HeldItem(
        object_id=object_id,
        name=str(raw.get("name") or "").strip(),
        contents=str(raw.get("contents") or "").strip(),
    )


def _get_value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _normalize_kind(value: Any) -> str:
    return str(value or "").strip().lower()


def _split_list_field(value: Any, *, max_items: int = 8) -> list[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []
    parts = re.split(r"[,;\n]+", normalized)
    return [_compact(part, max_chars=120) for part in parts if _compact(part, max_chars=120)][:max_items]


def _card_character_id(card: Any, fallback_prefix: str) -> str:
    character_id = _get_value(card, "character_id")
    if isinstance(character_id, int) and character_id > 0:
        return f"character_{character_id}"
    card_id = _get_value(card, "id")
    if isinstance(card_id, int) and card_id > 0:
        return f"{fallback_prefix}_{card_id}"
    title = _compact(_get_value(card, "title"), max_chars=80).casefold()
    slug = re.sub(r"[^0-9a-zа-яё]+", "_", title, flags=re.IGNORECASE).strip("_")
    return f"{fallback_prefix}_{slug or 'unknown'}"


def _latest_message_content(context_messages: list[Any], role: str) -> str:
    for message in reversed(context_messages or []):
        if str(_get_value(message, "role", "") or "").strip().lower() != role:
            continue
        content = _normalize_text(_get_value(message, "content"))
        if content:
            return content
    return ""


def _npc_aliases(state: CanonicalStateV1) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for npc_id, npc in state.npcs.items():
        values = [npc.name, npc.character_id]
        for value in values:
            normalized = _compact(value, max_chars=120).casefold()
            if normalized:
                aliases[normalized] = npc_id
    return aliases


def _find_npc_in_text(text: str, state: CanonicalStateV1) -> tuple[str | None, str | None]:
    normalized_text = f" {_compact(text, max_chars=2000).casefold()} "
    best: tuple[str | None, str | None] = (None, None)
    for alias, npc_id in _npc_aliases(state).items():
        if not alias or len(alias) < 2:
            continue
        if f" {alias} " in normalized_text or alias in normalized_text:
            npc = state.npcs.get(npc_id)
            if npc is not None:
                best = (npc_id, npc.name or alias)
                break
        alias_stem = alias[:-1]
        if len(alias_stem) >= 3 and re.search(rf"\b{re.escape(alias_stem)}[а-яё]*\b", normalized_text, re.IGNORECASE):
            npc = state.npcs.get(npc_id)
            if npc is not None:
                best = (npc_id, npc.name or alias)
                break
    return best


def load_or_init_canonical_state(
    *,
    game: Any | None = None,
    world_cards: list[Any] | None = None,
    context_messages: list[Any] | None = None,
) -> CanonicalStateV1:
    state = deserialize_canonical_state_payload(_get_value(game, CANONICAL_STATE_PAYLOAD_ATTR)) or CanonicalStateV1()
    _refresh_scene_from_game(state, game)
    _merge_world_cards_into_state(state, world_cards or [])

    latest_assistant = _latest_message_content(context_messages or [], "assistant")
    latest_user = _latest_message_content(context_messages or [], "user")
    _hydrate_conversation_from_recent_text(state, latest_assistant=latest_assistant, latest_user=latest_user)
    state.narrative_patterns = _merge_narrative_patterns(
        state.narrative_patterns,
        extract_narrative_patterns(latest_assistant),
    )
    return state


def _refresh_scene_from_game(state: CanonicalStateV1, game: Any | None) -> None:
    location_name = _compact(_get_value(game, "current_location_label"), max_chars=160)
    if location_name:
        state.scene.location_name = location_name
    if not state.scene.zone_id:
        state.scene.zone_id = "current_scene"
    time_of_day = _compact(_get_value(game, "environment_current_datetime"), max_chars=80)
    if time_of_day:
        state.scene.time_of_day = time_of_day
    weather = _compact(_get_value(game, "environment_current_weather"), max_chars=200)
    if weather:
        state.scene.weather = weather
    if not state.player.zone_id:
        state.player.zone_id = state.scene.zone_id


def _merge_world_cards_into_state(state: CanonicalStateV1, world_cards: list[Any]) -> None:
    for card in world_cards or []:
        kind = _normalize_kind(_get_value(card, "kind"))
        title = _compact(_get_value(card, "title"), max_chars=120)
        if not title:
            continue
        if kind == "main_hero":
            card_player_id = _card_character_id(card, "player")
            if not state.player.character_id or state.player.character_id == "player":
                state.player.character_id = card_player_id
            if not state.player.clothing:
                state.player.clothing = _split_list_field(_get_value(card, "clothing"))
            if not state.player.health:
                state.player.health = _split_list_field(_get_value(card, "health_status"))
            _add_inventory_objects(state, card, holder_character_id=state.player.character_id)
            continue
        if kind != "npc":
            continue
        npc_id = _card_character_id(card, "npc")
        existing_npc = state.npcs.get(npc_id)
        if existing_npc is None:
            state.npcs[npc_id] = CanonicalNpc(
                character_id=npc_id,
                name=title,
                zone_id=state.scene.zone_id,
                distance_to_player="unknown",
                clothing=_split_list_field(_get_value(card, "clothing")),
                health=_split_list_field(_get_value(card, "health_status")),
            )
        else:
            if not existing_npc.name:
                existing_npc.name = title
            if not existing_npc.zone_id:
                existing_npc.zone_id = state.scene.zone_id
            if not existing_npc.clothing:
                existing_npc.clothing = _split_list_field(_get_value(card, "clothing"))
            if not existing_npc.health:
                existing_npc.health = _split_list_field(_get_value(card, "health_status"))
        _add_inventory_objects(state, card, holder_character_id=npc_id)


def _add_inventory_objects(state: CanonicalStateV1, card: Any, *, holder_character_id: str | None) -> None:
    inventory_items = _split_list_field(_get_value(card, "inventory"), max_items=12)
    card_id = _get_value(card, "id")
    title_slug = re.sub(r"[^0-9a-zа-яё]+", "_", _compact(_get_value(card, "title"), max_chars=80).casefold(), flags=re.IGNORECASE).strip("_")
    base_id = str(card_id if isinstance(card_id, int) and card_id > 0 else title_slug or "unknown")
    for index, item_name in enumerate(inventory_items, start=1):
        object_id = f"inventory_{base_id}_{index}"
        existing_item = state.objects.get(object_id)
        if existing_item is not None:
            if not existing_item.name:
                existing_item.name = item_name
            continue
        state.objects[object_id] = CanonicalObject(
            object_id=object_id,
            name=item_name,
            holder_character_id=holder_character_id,
            zone_id=None,
        )


def _hydrate_conversation_from_recent_text(
    state: CanonicalStateV1,
    *,
    latest_assistant: str,
    latest_user: str,
) -> None:
    blocks = parse_ai_output_to_ui_blocks(latest_assistant)
    last_character_block = next((block for block in reversed(blocks) if block.type in {"dialogue", "thought"}), None)
    if last_character_block and last_character_block.speaker_name:
        speaker_id, _ = _find_npc_in_text(last_character_block.speaker_name, state)
        state.conversation.last_speaker_id = speaker_id or last_character_block.speaker_name

    addressee_id, _ = _find_npc_in_text(latest_user, state)
    if addressee_id:
        state.conversation.active_addressee_id = addressee_id


def _merge_narrative_patterns(left: NarrativePatterns, right: NarrativePatterns) -> NarrativePatterns:
    return NarrativePatterns(
        recent_openings=_merge_limited_strings(left.recent_openings, right.recent_openings, limit=8),
        recent_actions=_merge_limited_strings(left.recent_actions, right.recent_actions, limit=12),
        recent_endings=_merge_limited_strings(left.recent_endings, right.recent_endings, limit=8),
        repeated_phrases=_merge_limited_strings(left.repeated_phrases, right.repeated_phrases, limit=12),
    )


def _merge_limited_strings(first: list[str], second: list[str], *, limit: int) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for value in [*first, *second]:
        normalized = _compact(value, max_chars=160)
        key = normalized.casefold()
        if not normalized or key in seen:
            continue
        seen.add(key)
        merged.append(normalized)
    return merged[-limit:]


def safe_parse_player_turn(player_text: str, state: CanonicalStateV1) -> ParsedPlayerTurn:
    normalized = _normalize_text(player_text)
    parsed = ParsedPlayerTurn()
    action_types: set[str] = set()
    if not normalized:
        parsed.uncertainties.append("Пустой ход игрока.")
        return parsed

    addressee_id, addressee_name = _find_npc_in_text(normalized, state)
    if _DIALOGUE_PATTERN.search(normalized) or addressee_id:
        action_types.add("dialogue")
        parsed.dialogue = ParsedDialogue(
            speaker_id="player",
            addressee_id=addressee_id,
            addressee_name=addressee_name,
            text=_extract_quoted_text(normalized),
        )

    for match in _PICKUP_PATTERN.finditer(normalized):
        action_types.add("object_interaction")
        parsed.object_interactions.append(
            ObjectInteraction(
                verb="pickup",
                object_name=_clean_object_name(match.group(1)),
                target_hand=_detect_target_hand(normalized),
            )
        )

    for match in _DROP_PATTERN.finditer(normalized):
        action_types.add("object_interaction")
        parsed.object_interactions.append(
            ObjectInteraction(
                verb="drop",
                object_name=_clean_object_name(match.group(1)),
                target_hand=_detect_target_hand(normalized),
            )
        )

    lowered = normalized.casefold()
    if any(token in lowered for token in ("подхожу", "подошел", "подошла", "иду к", "приближаюсь")):
        action_types.add("movement")
        parsed.movement = ParsedMovement(
            from_zone_id=state.player.zone_id,
            to_zone_id=state.player.zone_id,
            relation_to_target="near",
        )
    elif any(token in lowered for token in ("отхожу", "ухожу", "отступаю")):
        action_types.add("movement")
        parsed.movement = ParsedMovement(
            from_zone_id=state.player.zone_id,
            to_zone_id=state.player.zone_id,
            relation_to_target="away",
        )

    posture = _detect_posture_change(lowered)
    if posture:
        action_types.add("posture")
        parsed.posture_change = posture

    parsed.action_types = sorted(action_types)
    if not parsed.action_types:
        parsed.uncertainties.append("Не удалось уверенно извлечь структурированное действие; используем старый контекст без блокировки хода.")
    return parsed


def _extract_quoted_text(text: str) -> str | None:
    match = re.search(r"[\"«„“]([^\"»”]+)[\"»”]", text)
    if match is None:
        return None
    return _compact(match.group(1), max_chars=500) or None


def _clean_object_name(value: str) -> str:
    return re.split(r"\b(?:в|на|из|к|и|,)\b", _compact(value, max_chars=120), maxsplit=1, flags=re.IGNORECASE)[0].strip(" .,:;!?")


def _detect_target_hand(text: str) -> Literal["left", "right", "unspecified"]:
    lowered = text.casefold()
    if "лев" in lowered:
        return "left"
    if "прав" in lowered:
        return "right"
    return "unspecified"


def _detect_posture_change(lowered_text: str) -> str | None:
    if any(token in lowered_text for token in ("сажусь", "сел", "села", "присаживаюсь")):
        return "sitting"
    if any(token in lowered_text for token in ("встаю", "встал", "встала", "поднимаюсь")):
        return "standing"
    if any(token in lowered_text for token in ("ложусь", "лег", "легла")):
        return "lying"
    if any(token in lowered_text for token in ("на колени", "становлюсь на колени")):
        return "kneeling"
    return None


def resolve_state_delta(
    state: CanonicalStateV1,
    parsed_turn: ParsedPlayerTurn,
) -> tuple[CanonicalStateV1, list[StateDelta]]:
    next_state = deepcopy(state)
    deltas: list[StateDelta] = []

    if parsed_turn.dialogue and parsed_turn.dialogue.addressee_id:
        old_value = next_state.conversation.active_addressee_id
        next_state.conversation.active_speaker_id = "player"
        next_state.conversation.active_addressee_id = parsed_turn.dialogue.addressee_id
        next_state.conversation.last_addressee_id = parsed_turn.dialogue.addressee_id
        if old_value != parsed_turn.dialogue.addressee_id:
            deltas.append(
                StateDelta(
                    path="conversation.active_addressee_id",
                    old_value=old_value,
                    new_value=parsed_turn.dialogue.addressee_id,
                    reason="Игрок явно обратился к персонажу в текущем ходе.",
                    confidence=0.85,
                )
            )

    if parsed_turn.posture_change:
        old_value = next_state.player.posture
        next_state.player.posture = parsed_turn.posture_change
        if old_value != parsed_turn.posture_change:
            deltas.append(
                StateDelta(
                    path="player.posture",
                    old_value=old_value,
                    new_value=parsed_turn.posture_change,
                    reason="В ходе игрока обнаружено изменение позы.",
                    confidence=0.75,
                )
            )

    for interaction in parsed_turn.object_interactions:
        _apply_object_interaction(next_state, interaction, deltas)

    if parsed_turn.movement and parsed_turn.dialogue and parsed_turn.dialogue.addressee_id:
        _apply_relative_movement(next_state, parsed_turn.movement, parsed_turn.dialogue.addressee_id, deltas)

    next_state.uncertainties.extend(parsed_turn.uncertainties)
    return next_state, deltas


def _apply_relative_movement(
    state: CanonicalStateV1,
    movement: ParsedMovement,
    target_npc_id: str,
    deltas: list[StateDelta],
) -> None:
    npc = state.npcs.get(target_npc_id)
    if npc is None:
        return
    next_distance = None
    if movement.relation_to_target == "near":
        next_distance = "near"
    elif movement.relation_to_target == "away":
        next_distance = "away"
    if next_distance is None or npc.distance_to_player == next_distance:
        return
    old_distance = npc.distance_to_player
    npc.distance_to_player = next_distance
    deltas.append(
        StateDelta(
            path=f"npcs.{target_npc_id}.distance_to_player",
            old_value=old_distance,
            new_value=next_distance,
            reason="Игрок явно изменил дистанцию до активного персонажа.",
            confidence=0.72,
        )
    )


def _apply_object_interaction(
    state: CanonicalStateV1,
    interaction: ObjectInteraction,
    deltas: list[StateDelta],
) -> None:
    object_id = interaction.object_id or _find_object_id(interaction.object_name, state)
    if not object_id:
        state.uncertainties.append(f"Неизвестный предмет в действии игрока: {interaction.object_name or 'без названия'}.")
        return
    item = state.objects.get(object_id)
    if item is None:
        return

    player_id = state.player.character_id or "player"
    if interaction.verb == "pickup":
        hand_name = _select_hand_for_pickup(state, interaction.target_hand)
        if hand_name is None:
            state.uncertainties.append(f"Нет свободной руки для предмета: {item.name or item.object_id}.")
            return
        old_hand = getattr(state.player, hand_name)
        held_item = HeldItem(object_id=item.object_id, name=item.name, contents=item.contents)
        setattr(state.player, hand_name, held_item)
        old_holder = item.holder_character_id
        item.holder_character_id = player_id
        item.zone_id = None
        deltas.append(
            StateDelta(
                path=f"player.{hand_name}",
                old_value=asdict(old_hand) if old_hand else None,
                new_value=asdict(held_item),
                reason="Игрок взял предмет.",
                confidence=0.75,
            )
        )
        if old_holder != player_id:
            deltas.append(
                StateDelta(
                    path=f"objects.{item.object_id}.holder_character_id",
                    old_value=old_holder,
                    new_value=player_id,
                    reason="Синхронизация держателя предмета с рукой игрока.",
                    confidence=0.75,
                )
            )
        return

    if interaction.verb == "drop":
        for hand_name in ("left_hand", "right_hand"):
            held = getattr(state.player, hand_name)
            if held is None or held.object_id != item.object_id:
                continue
            setattr(state.player, hand_name, None)
            item.holder_character_id = None
            item.zone_id = state.player.zone_id
            deltas.append(
                StateDelta(
                    path=f"player.{hand_name}",
                    old_value=asdict(held),
                    new_value=None,
                    reason="Игрок отпустил или поставил предмет.",
                    confidence=0.75,
                )
            )
            return
        state.uncertainties.append(f"Игрок отпустил предмет, но он не найден в руках: {item.name or item.object_id}.")


def _find_object_id(object_name: str, state: CanonicalStateV1) -> str | None:
    normalized_name = _compact(object_name, max_chars=120).casefold()
    if not normalized_name:
        return None
    for object_id, item in state.objects.items():
        item_name = _compact(item.name, max_chars=120).casefold()
        if item_name and (item_name in normalized_name or normalized_name in item_name):
            return object_id
    return None


def _select_hand_for_pickup(
    state: CanonicalStateV1,
    target_hand: Literal["left", "right", "unspecified"],
) -> str | None:
    if target_hand == "left":
        return "left_hand" if state.player.left_hand is None else None
    if target_hand == "right":
        return "right_hand" if state.player.right_hand is None else None
    if state.player.right_hand is None:
        return "right_hand"
    if state.player.left_hand is None:
        return "left_hand"
    return None


def validate_canonical_state(state: CanonicalStateV1) -> StateValidationReport:
    issues: list[StateValidationIssue] = []
    held_ids = [
        state.player.left_hand.object_id if state.player.left_hand else None,
        state.player.right_hand.object_id if state.player.right_hand else None,
    ]
    if held_ids[0] and held_ids[0] == held_ids[1]:
        issues.append(
            StateValidationIssue(
                code="same_object_in_two_hands",
                severity="high",
                message="Один и тот же предмет указан в обеих руках игрока.",
            )
        )

    player_id = state.player.character_id or "player"
    for hand_name, held in (("left_hand", state.player.left_hand), ("right_hand", state.player.right_hand)):
        if held is None:
            continue
        item = state.objects.get(held.object_id)
        if item is None:
            issues.append(
                StateValidationIssue(
                    code="held_object_missing",
                    severity="medium",
                    message=f"Предмет в {hand_name} отсутствует в objects: {held.object_id}.",
                )
            )
            continue
        if item.holder_character_id not in {None, player_id}:
            issues.append(
                StateValidationIssue(
                    code="held_object_holder_conflict",
                    severity="high",
                    message=f"Предмет {held.object_id} в руке игрока, но holderCharacterId={item.holder_character_id}.",
                )
            )

    addressee_id = state.conversation.active_addressee_id
    if addressee_id and addressee_id not in state.npcs and addressee_id != player_id:
        issues.append(
            StateValidationIssue(
                code="unknown_active_addressee",
                severity="medium",
                message=f"activeAddresseeId не найден среди активных персонажей: {addressee_id}.",
            )
        )

    return StateValidationReport(
        ok=not any(issue.severity in {"high", "fatal"} for issue in issues),
        issues=issues,
    )


def build_scene_plan(
    *,
    player_text: str,
    state: CanonicalStateV1,
    parsed_turn: ParsedPlayerTurn,
    deltas: list[StateDelta],
    validation: StateValidationReport,
) -> ScenePlan:
    plan = ScenePlan()
    plan.output_contract_notes = get_ai_output_contract_notes()
    if parsed_turn.dialogue:
        plan.response_mode = "dialogue"
        plan.main_responder_id = parsed_turn.dialogue.addressee_id
        if parsed_turn.dialogue.addressee_name:
            plan.beats.append(f"По умолчанию отвечает {parsed_turn.dialogue.addressee_name}.")
    elif parsed_turn.action_types:
        plan.response_mode = "mixed"

    plan.required_facts.extend(_render_required_state_facts(state))
    for delta in deltas[:8]:
        plan.required_facts.append(f"{delta.reason}: {delta.path} -> {delta.new_value}.")
    for issue in validation.issues[:6]:
        plan.forbidden_beats.append(f"Не нарушай валидацию состояния: {issue.message}")

    addressee_id = state.conversation.active_addressee_id
    if addressee_id and addressee_id in state.npcs:
        npc = state.npcs[addressee_id]
        if npc.distance_to_player in {"adjacent", "same_zone", "near"}:
            plan.forbidden_beats.append(f"{npc.name or addressee_id} уже рядом; не описывай повторное приближение без нового movement delta.")

    plan.forbidden_beats.extend(
        f"Избегай повторения недавнего паттерна: {pattern}"
        for pattern in state.narrative_patterns.recent_actions[:4]
    )
    if not plan.beats:
        plan.beats.append("Опиши только последствия уже совершенного хода игрока и реакцию мира/NPC.")
    plan.beats.append("Сохрани текущий формат реплик, чтобы фронт распознал speaker/name/avatar.")
    if parsed_turn.uncertainties:
        plan.forbidden_beats.append("При сомнении оставляй факт нейтральным, не выдумывай точные предметы, позиции или адресатов.")
    _ = player_text
    return plan


def _render_required_state_facts(state: CanonicalStateV1) -> list[str]:
    facts: list[str] = []
    if state.scene.location_name:
        facts.append(f"Текущая локация: {state.scene.location_name}.")
    if state.scene.weather:
        facts.append(f"Погода/среда: {_compact(state.scene.weather, max_chars=180)}.")
    for label, held in (("левая рука", state.player.left_hand), ("правая рука", state.player.right_hand)):
        if held is not None:
            contents = f", содержимое: {held.contents}" if held.contents else ""
            facts.append(f"У игрока в {label}: {held.name or held.object_id}{contents}.")
    addressee_id = state.conversation.active_addressee_id
    if addressee_id and addressee_id in state.npcs:
        npc = state.npcs[addressee_id]
        facts.append(f"Активный адресат диалога: {npc.name or addressee_id}.")
    return facts[:10]


def build_canonical_pipeline_context(
    *,
    player_text: str,
    game: Any | None = None,
    world_cards: list[Any] | None = None,
    context_messages: list[Any] | None = None,
) -> CanonicalPipelineContext:
    state = load_or_init_canonical_state(
        game=game,
        world_cards=world_cards,
        context_messages=context_messages,
    )
    parsed_turn = safe_parse_player_turn(player_text, state)
    next_state, deltas = resolve_state_delta(state, parsed_turn)
    validation = validate_canonical_state(next_state)
    scene_plan = build_scene_plan(
        player_text=player_text,
        state=next_state,
        parsed_turn=parsed_turn,
        deltas=deltas,
        validation=validation,
    )
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "Canonical pipeline context built: before=%s after=%s action_types=%s delta_paths=%s validation_codes=%s scene_plan=%s",
            _state_debug_summary(state),
            _state_debug_summary(next_state),
            parsed_turn.action_types,
            [delta.path for delta in deltas[:12]],
            [issue.code for issue in validation.issues[:12]],
            {
                "mode": scene_plan.response_mode,
                "main_responder_id": scene_plan.main_responder_id,
                "beat_count": len(scene_plan.beats),
                "forbidden_count": len(scene_plan.forbidden_beats),
            },
        )
    return CanonicalPipelineContext(
        state=state,
        parsed_turn=parsed_turn,
        next_state=next_state,
        deltas=deltas,
        validation=validation,
        scene_plan=scene_plan,
    )


def build_canonical_generation_prompt(
    *,
    player_text: str,
    game: Any | None = None,
    world_cards: list[Any] | None = None,
    context_messages: list[Any] | None = None,
) -> str:
    context = build_canonical_pipeline_context(
        player_text=player_text,
        game=game,
        world_cards=world_cards,
        context_messages=context_messages,
    )
    state = context.next_state
    plan = context.scene_plan
    lines = [
        "CANONICAL STATE PIPELINE V1 (MANDATORY, UI-COMPATIBLE):",
        "Источник истины по фактам: свежий ход игрока > canonical state/модули состояния > важная память > последние ходы > карточки > сжатая память > стиль.",
        "Если источники противоречат друг другу, canonical state важнее художественного текста; при сомнении оставляй факт нейтральным.",
        "Не меняй предметы, содержимое предметов, позиции, одежду, здоровье и активного адресата без явного основания в ходе игрока.",
        "",
        "КАНОН СЦЕНЫ:",
    ]
    facts = _render_required_state_facts(state)
    lines.extend(f"- {fact}" for fact in (facts or ["Нет обязательных фактов сверх текущих карточек и истории."]))
    if state.uncertainties:
        lines.append("- Неуверенности: " + "; ".join(state.uncertainties[:4]))

    active_scene_facts = _render_active_scene_facts(state)
    if active_scene_facts:
        lines.extend(["", "АКТИВНАЯ СЦЕНА:"])
        lines.extend(f"- {fact}" for fact in active_scene_facts)

    repetition_facts = _render_anti_repetition_facts(state)
    if repetition_facts:
        lines.extend(["", "АНТИ-ПОВТОР:"])
        lines.extend(f"- {fact}" for fact in repetition_facts)

    lines.extend(["", "ПЛАН СЦЕНЫ:"])
    if plan.main_responder_id and plan.main_responder_id in state.npcs:
        lines.append(f"- Основной отвечающий: {state.npcs[plan.main_responder_id].name or plan.main_responder_id}.")
    lines.extend(f"- {beat}" for beat in plan.beats[:6])
    if plan.forbidden_beats:
        lines.extend(["", "ЗАПРЕЩЕНО В ЭТОМ ОТВЕТЕ:"])
        lines.extend(f"- {beat}" for beat in plan.forbidden_beats[:8])

    lines.extend(["", "ФОРМАТ ОТВЕТА ДЛЯ ФРОНТА:"])
    lines.extend(f"- {note}" for note in plan.output_contract_notes)
    lines.extend(
        [
            "- Не добавляй новые маркеры, которых не понимает фронт.",
            "- Лор/стиль используй только если он уместен для текущей активной сцены.",
        ]
    )
    return "\n".join(lines).strip()


def _render_active_scene_facts(state: CanonicalStateV1) -> list[str]:
    facts: list[str] = []
    for npc in list(state.npcs.values())[:6]:
        name = npc.name or npc.character_id
        distance = npc.distance_to_player if npc.distance_to_player != "unknown" else "дистанция не уточнена"
        posture = f", поза: {npc.posture}" if npc.posture and npc.posture != "unknown" else ""
        facts.append(f"NPC {name}: {distance}{posture}.")
    visible_objects = [
        item
        for item in state.objects.values()
        if item.zone_id == state.player.zone_id and not item.holder_character_id
    ][:6]
    for item in visible_objects:
        facts.append(f"Предмет рядом: {item.name or item.object_id}.")
    return facts[:10]


def _render_anti_repetition_facts(state: CanonicalStateV1) -> list[str]:
    facts: list[str] = []
    for opening in state.narrative_patterns.recent_openings[-3:]:
        facts.append(f"Не начинай ответ так же: {opening}")
    for action in state.narrative_patterns.recent_actions[-4:]:
        facts.append(f"Не повторяй без нового основания действие/жест: {action}")
    return facts[:8]


def detect_language_issues(raw_output: str) -> QualityReport:
    issues: list[QualityIssue] = []
    for index, text in enumerate(iter_user_visible_text(raw_output)):
        if _CJK_PATTERN.search(text):
            issues.append(
                QualityIssue(
                    code="cjk_visible_text",
                    severity="high",
                    message=f"В видимом тексте блока {index + 1} найдены китайские иероглифы.",
                    suggested_fix="Переписать только видимый текст на русский, сохранив маркеры.",
                )
            )
        if _has_visible_mojibake(text):
            issues.append(
                QualityIssue(
                    code="mojibake_visible_text",
                    severity="high",
                    message=f"В видимом тексте блока {index + 1} найдена вероятно битая кодировка.",
                    suggested_fix="Восстановить UTF-8 только в видимом тексте.",
                )
            )
        latin_words = _LATIN_WORD_PATTERN.findall(_strip_allowed_latin_fragments(text))
        cyrillic_count = len(_CYRILLIC_PATTERN.findall(text))
        latin_chars = sum(len(word) for word in latin_words)
        if latin_chars > max(30, int(cyrillic_count * 0.35)):
            issues.append(
                QualityIssue(
                    code="excessive_latin_visible_text",
                    severity="medium",
                    message=f"В видимом тексте блока {index + 1} слишком много латиницы.",
                    suggested_fix="Переписать случайные английские вставки на русский.",
                )
            )
    return QualityReport(ok=not any(issue.severity in {"medium", "high", "fatal"} for issue in issues), issues=issues)


def _strip_allowed_latin_fragments(text: str) -> str:
    without_urls = re.sub(r"https?://\S+", " ", text)
    without_markers = re.sub(r"\[\[[^\]]+\]\]", " ", without_urls)
    return re.sub(r"\b(?:NPC|GG|JSON|UI|API|OpenRouter|id|URL)\b", " ", without_markers, flags=re.IGNORECASE)


def _has_visible_mojibake(text: str) -> bool:
    return bool(
        _COMMON_VISIBLE_MOJIBAKE_PATTERN.search(text)
        or _CP1251_MOJIBAKE_RUN_PATTERN.search(text)
        or _CP1252_MOJIBAKE_RUN_PATTERN.search(text)
    )


def critique_narrative(
    *,
    output: str,
    state: CanonicalStateV1,
    scene_plan: ScenePlan,
    contract_check: ValidationResult,
    language_check: QualityReport,
) -> QualityReport:
    issues: list[QualityIssue] = []
    issues.extend(
        QualityIssue(
            code=issue.code,
            severity=issue.severity,
            message=issue.message,
            suggested_fix="Сохранить output contract для фронта.",
        )
        for issue in contract_check.issues
        if issue.severity in {"medium", "high", "fatal"}
    )
    issues.extend(language_check.issues)

    visible_text = "\n".join(iter_user_visible_text(output))
    output_patterns = extract_narrative_patterns(output)
    for opening in output_patterns.recent_openings[:1]:
        opening_key = opening.casefold()
        if opening_key and opening_key in {value.casefold() for value in state.narrative_patterns.recent_openings}:
            issues.append(
                QualityIssue(
                    code="repeated_recent_opening",
                    severity="medium",
                    message="Ответ повторяет недавнее начало сцены.",
                    suggested_fix="Начать ответ с нового ракурса или сразу с последствия хода игрока.",
                )
            )
            break

    if _state_has_tea_object(state) and _COFFEE_PATTERN.search(visible_text) and not _TEA_PATTERN.search(visible_text):
        issues.append(
            QualityIssue(
                code="tea_became_coffee",
                severity="high",
                message="В canonical state есть чай, но в ответе видимый текст заменил его на кофе.",
                suggested_fix="Вернуть чай и не менять содержимое предмета.",
            )
        )

    for npc_id, npc in state.npcs.items():
        if npc.distance_to_player not in {"adjacent", "same_zone", "near"}:
            continue
        if not npc.name:
            continue
        if npc.name.casefold() in visible_text.casefold() and _APPROACH_PATTERN.search(visible_text):
            issues.append(
                QualityIssue(
                    code="npc_reapproached_when_already_near",
                    severity="medium",
                    message=f"{npc.name} уже рядом по canonical state, но ответ снова описывает приближение.",
                    suggested_fix="Заменить повторное приближение на жест, реплику или реакцию на месте.",
                )
            )

    if scene_plan.main_responder_id and scene_plan.main_responder_id in state.npcs:
        expected_name = state.npcs[scene_plan.main_responder_id].name
        first_dialogue = next((block for block in parse_ai_output_to_ui_blocks(output) if block.type == "dialogue"), None)
        if first_dialogue and expected_name and first_dialogue.speaker_name:
            if first_dialogue.speaker_name.casefold() != expected_name.casefold():
                issues.append(
                    QualityIssue(
                        code="wrong_dialogue_addressee",
                        severity="medium",
                        message=f"Ожидался ответ от {expected_name}, но первая реплика принадлежит {first_dialogue.speaker_name}.",
                        suggested_fix="Сохранить активного адресата диалога из хода игрока.",
                    )
                )

    return QualityReport(ok=not any(issue.severity in {"medium", "high", "fatal"} for issue in issues), issues=issues)


def _state_has_tea_object(state: CanonicalStateV1) -> bool:
    values: list[str] = []
    for item in state.objects.values():
        values.extend([item.name, item.contents])
    for held in (state.player.left_hand, state.player.right_hand):
        if held is not None:
            values.extend([held.name, held.contents])
    return any(_TEA_PATTERN.search(value or "") for value in values)


def repair_visible_text_mojibake(raw_output: str) -> str:
    blocks = parse_ai_output_to_ui_blocks(raw_output)
    if not blocks:
        return raw_output
    patched_blocks: list[UiBlock] = []
    changed = False
    for block in blocks:
        repaired = _repair_mojibake_text(block.content)
        if repaired != block.content:
            changed = True
        patched_blocks.append(
            UiBlock(
                type=block.type,
                speaker_name=block.speaker_name,
                content=repaired,
                marker=block.marker,
            )
        )
    if not changed:
        return raw_output
    return serialize_ui_blocks_to_existing_ai_output(patched_blocks) or raw_output


def _repair_mojibake_text(value: str) -> str:
    repaired = sanitize_likely_utf8_mojibake(value)
    if repaired != value and "\ufffd" not in repaired:
        return repaired

    original_score = _mojibake_score(value)
    segmented = _repair_mojibake_runs(value)
    if segmented != value and _mojibake_score(segmented) < original_score:
        return segmented

    best_candidate = value
    best_score = original_score
    for source_encoding in ("cp1251", "latin1"):
        try:
            candidate = value.encode(source_encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if "\ufffd" in candidate:
            continue
        candidate_score = _mojibake_score(candidate)
        if candidate_score < best_score:
            best_candidate = candidate
            best_score = candidate_score
    return best_candidate


def _repair_mojibake_runs(value: str) -> str:
    repaired = value
    for pattern, source_encoding in (
        (_CP1251_MOJIBAKE_RUN_PATTERN, "cp1251"),
        (_CP1252_MOJIBAKE_RUN_PATTERN, "cp1252"),
        (_CP1252_MOJIBAKE_RUN_PATTERN, "latin1"),
    ):
        repaired = pattern.sub(
            lambda match, encoding=source_encoding: _repair_mojibake_run(match.group(0), encoding),
            repaired,
        )
    return repaired


def _repair_mojibake_run(value: str, source_encoding: str) -> str:
    try:
        candidate = value.encode(source_encoding).decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    if "\ufffd" in candidate:
        return value
    return candidate if _mojibake_score(candidate) < _mojibake_score(value) else value


def _mojibake_score(value: str) -> int:
    score = len(_COMMON_VISIBLE_MOJIBAKE_PATTERN.findall(value))
    if _CP1251_MOJIBAKE_RUN_PATTERN.search(value):
        score += 2
    if _CP1252_MOJIBAKE_RUN_PATTERN.search(value):
        score += 2
    return score


def build_safe_contract_fallback(scene_plan: ScenePlan) -> str:
    responder_note = ""
    if scene_plan.main_responder_id:
        responder_note = " Адресат сцены сохранен; продолжите ходом игрока, чтобы уточнить реакцию."
    return (
        "Сцена на мгновение замирает. Рассказчик не смог безопасно продолжить ответ без риска сломать факты или формат реплик."
        f"{responder_note}"
    )


def finalize_canonical_state_after_output(
    *,
    state: CanonicalStateV1,
    output: str,
    scene_plan: ScenePlan,
) -> CanonicalStateV1:
    next_state = deepcopy(state)
    dialogue_blocks = [block for block in parse_ai_output_to_ui_blocks(output) if block.type == "dialogue"]
    first_dialogue = dialogue_blocks[0] if dialogue_blocks else None
    last_dialogue = dialogue_blocks[-1] if dialogue_blocks else None

    resolved_speaker_id: str | None = None
    if first_dialogue and first_dialogue.speaker_name:
        speaker_id, _ = _find_npc_in_text(first_dialogue.speaker_name, next_state)
        resolved_speaker_id = speaker_id
    if resolved_speaker_id is None and scene_plan.main_responder_id in next_state.npcs:
        resolved_speaker_id = scene_plan.main_responder_id
    if resolved_speaker_id:
        next_state.conversation.active_speaker_id = resolved_speaker_id
        next_state.conversation.last_speaker_id = resolved_speaker_id

    if last_dialogue and last_dialogue.speaker_name:
        last_speaker_id, _ = _find_npc_in_text(last_dialogue.speaker_name, next_state)
        if last_speaker_id:
            next_state.conversation.last_speaker_id = last_speaker_id

    if scene_plan.main_responder_id:
        next_state.conversation.active_addressee_id = scene_plan.main_responder_id
        next_state.conversation.last_addressee_id = scene_plan.main_responder_id

    next_state.narrative_patterns = _merge_narrative_patterns(
        next_state.narrative_patterns,
        extract_narrative_patterns(output),
    )
    next_state.uncertainties = _merge_limited_strings(next_state.uncertainties, [], limit=20)
    return next_state


def guard_generated_story_output(
    *,
    output: str,
    player_text: str,
    game: Any | None = None,
    world_cards: list[Any] | None = None,
    context_messages: list[Any] | None = None,
    use_safe_fallback: bool = False,
) -> OutputGuardResult:
    context = build_canonical_pipeline_context(
        player_text=player_text,
        game=game,
        world_cards=world_cards,
        context_messages=context_messages,
    )
    candidate = output
    contract = validate_ai_output_contract(candidate)
    language = detect_language_issues(candidate)
    patched = False
    if any(issue.code == "mojibake_visible_text" for issue in language.issues):
        repaired = repair_visible_text_mojibake(candidate)
        if repaired != candidate:
            candidate = repaired
            patched = True
            contract = validate_ai_output_contract(candidate)
            language = detect_language_issues(candidate)

    quality = critique_narrative(
        output=candidate,
        state=context.next_state,
        scene_plan=context.scene_plan,
        contract_check=contract,
        language_check=language,
    )
    fallback_used = False
    if use_safe_fallback and (not contract.ok or not language.ok or not quality.ok):
        candidate = build_safe_contract_fallback(context.scene_plan)
        fallback_used = True
        contract = validate_ai_output_contract(candidate)
        language = detect_language_issues(candidate)
        quality = critique_narrative(
            output=candidate,
            state=context.next_state,
            scene_plan=context.scene_plan,
            contract_check=contract,
            language_check=language,
        )

    final_state = finalize_canonical_state_after_output(
        state=context.next_state,
        output=candidate,
        scene_plan=context.scene_plan,
    )
    if quality.issues:
        logger.warning(
            "Canonical output guard issues: issues=%s patched=%s fallback_used=%s",
            [asdict(issue) for issue in quality.issues[:8]],
            patched,
            fallback_used,
        )
    logger.debug(
        "Canonical output guard result: contract_ok=%s language_ok=%s quality_ok=%s patched=%s fallback_used=%s issue_codes=%s",
        contract.ok,
        language.ok,
        quality.ok,
        patched,
        fallback_used,
        [issue.code for issue in quality.issues[:12]],
    )
    return OutputGuardResult(
        output=candidate,
        contract=contract,
        language=language,
        quality=quality,
        patched=patched,
        fallback_used=fallback_used,
        state=final_state,
    )


def extract_narrative_patterns(text: str) -> NarrativePatterns:
    visible = [value for value in iter_user_visible_text(text) if value.strip()]
    openings: list[str] = []
    endings: list[str] = []
    actions: list[str] = []
    for block_text in visible[-6:]:
        sentences = [sentence.strip() for sentence in re.findall(r"[^.!?…]+[.!?…]?", block_text) if sentence.strip()]
        if sentences:
            openings.append(_compact(sentences[0], max_chars=120))
            endings.append(_compact(sentences[-1], max_chars=120))
        for match in re.finditer(r"\b(?:улыбнул[асься]+|кивнул[аи]?|вздохнул[аи]?|подош[её]л|подошла|посмотрел[аи]?)\b", block_text, re.IGNORECASE):
            actions.append(match.group(0).casefold())
    repeated = sorted({action for action in actions if actions.count(action) > 1})
    return NarrativePatterns(
        recent_openings=openings[-6:],
        recent_actions=actions[-8:],
        recent_endings=endings[-6:],
        repeated_phrases=repeated[:8],
    )
