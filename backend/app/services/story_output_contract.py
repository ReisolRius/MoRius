from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal


UiBlockType = Literal["narration", "dialogue", "thought"]

STORY_AI_OUTPUT_CONTRACT_NAME = "morius_markup_v2"

_MARKER_START_PATTERN = re.compile(
    r"^\[\[\s*([^\]:]+?)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]*)$",
    re.IGNORECASE,
)
_MARKER_INLINE_PATTERN = re.compile(
    r"\[\[\s*[^\]:]+?(?:\s*:\s*[^\]]+?)?\s*\]",
    re.IGNORECASE,
)
_MARKER_DANGLING_PATTERN = re.compile(r"\[\[[^\]]*$")
_PLAIN_SPEAKER_LINE_PATTERN = re.compile(
    r"^\s*([A-ZА-ЯЁ][^:\n]{0,80}?)(?:\s*\(((?:в голове|мысленно|мысли))\))?\s*:\s*([\s\S]+?)\s*$",
    re.IGNORECASE,
)
_STRUCTURED_TAG_PATTERN = re.compile(
    r"^<\s*([A-Za-zА-Яа-яЁё_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)<\/\s*([A-Za-zА-Яа-яЁё_ -]+)\s*>$",
    re.IGNORECASE,
)
_SPEAKER_TOKEN_PATTERN = re.compile(r"^[0-9A-Za-zА-Яа-яЁё'\u2019-]+$")
_SPEAKER_DISALLOWED_PUNCTUATION_PATTERN = re.compile(r"[,;.!?]")

_MARKER_ALIAS_BY_COMPACT = {
    "narrator": "narration",
    "narration": "narration",
    "narrative": "narration",
    "рассказчик": "narration",
    "нарратор": "narration",
    "повествование": "narration",
    "npc": "npc",
    "нпс": "npc",
    "нпк": "npc",
    "npcreplick": "npc",
    "npcreplica": "npc",
    "npcspeech": "npc",
    "npcdialogue": "npc",
    "gg": "gg",
    "гг": "gg",
    "mc": "gg",
    "mainhero": "gg",
    "maincharacter": "gg",
    "say": "npc",
    "speech": "npc",
    "npcthought": "npc_thought",
    "npcthink": "npc_thought",
    "thought": "npc_thought",
    "think": "npc_thought",
    "ggthought": "gg_thought",
    "ggthink": "gg_thought",
    "нпсмысль": "npc_thought",
    "нпсмысли": "npc_thought",
    "нпкмысль": "npc_thought",
    "нпкмысли": "npc_thought",
    "ггмысль": "gg_thought",
    "ггмысли": "gg_thought",
}

_SPEECH_MARKERS = {"npc", "gg"}
_THOUGHT_MARKERS = {"npc_thought", "gg_thought"}
_NARRATION_MARKERS = {"narration"}


@dataclass(frozen=True)
class UiBlock:
    type: UiBlockType
    content: str
    speaker_name: str | None = None
    marker: str | None = None


@dataclass(frozen=True)
class ContractIssue:
    code: str
    severity: Literal["low", "medium", "high", "fatal"]
    message: str


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    issues: list[ContractIssue]


def normalize_ai_output_text(value: str | None) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def normalize_marker_key(raw_value: str | None) -> str:
    normalized = re.sub(r"[\s-]+", "_", str(raw_value or "").strip().casefold()).replace("ё", "е")
    compact = normalized.replace("_", "")
    return _MARKER_ALIAS_BY_COMPACT.get(compact, normalized)


def normalize_speaker_name(raw_value: str | None) -> str:
    return (
        str(raw_value or "")
        .replace("\r\n", " ")
        .replace("\n", " ")
        .strip()
        .strip(" .,:;!?-\"'()[]«»„“”")
    )


def is_likely_speaker_name(raw_value: str | None) -> bool:
    normalized = normalize_speaker_name(raw_value)
    if not normalized or _SPEAKER_DISALLOWED_PUNCTUATION_PATTERN.search(normalized):
        return False
    words = [word for word in normalized.split() if word]
    if not words or len(words) > 4:
        return False
    return all(_SPEAKER_TOKEN_PATTERN.fullmatch(word) is not None for word in words)


def _split_paragraphs_and_inline_markers(raw: str) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", raw) if paragraph.strip()]
    chunks: list[str] = []
    for paragraph in paragraphs:
        matches = list(_MARKER_INLINE_PATTERN.finditer(paragraph))
        if len(matches) <= 1:
            chunks.append(paragraph)
            continue

        leading = paragraph[: matches[0].start()].strip()
        if leading:
            chunks.append(leading)
        for index, match in enumerate(matches):
            marker = match.group(0).strip()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(paragraph)
            body = paragraph[match.end() : end].strip()
            chunks.append(f"{marker} {body}".strip() if body else marker)
    return chunks


def _parse_marker_paragraph(paragraph: str) -> UiBlock | None:
    match = _MARKER_START_PATTERN.match(paragraph)
    if match is None:
        return None

    raw_marker = match.group(1)
    marker_key = normalize_marker_key(raw_marker)
    raw_speaker = match.group(2)
    body = normalize_ai_output_text(match.group(3))
    if not body:
        return None

    if marker_key in _NARRATION_MARKERS:
        return UiBlock(type="narration", content=body, marker="NARRATOR")

    if marker_key in _SPEECH_MARKERS or marker_key in _THOUGHT_MARKERS:
        speaker_name = normalize_speaker_name(raw_speaker)
        if not speaker_name:
            return None
        marker = "GG" if marker_key == "gg" else "GG_THOUGHT" if marker_key == "gg_thought" else "NPC_THOUGHT" if marker_key == "npc_thought" else "NPC"
        return UiBlock(
            type="thought" if marker_key in _THOUGHT_MARKERS else "dialogue",
            speaker_name=speaker_name,
            content=body,
            marker=marker,
        )

    bare_speaker = normalize_speaker_name(raw_marker)
    if is_likely_speaker_name(bare_speaker):
        return UiBlock(type="dialogue", speaker_name=bare_speaker, content=body, marker="NPC")
    return None


def _parse_plain_speaker_line(paragraph: str) -> UiBlock | None:
    match = _PLAIN_SPEAKER_LINE_PATTERN.match(paragraph)
    if match is None:
        return None

    speaker_name = normalize_speaker_name(match.group(1))
    body = normalize_ai_output_text(match.group(3))
    if not is_likely_speaker_name(speaker_name) or not body:
        return None

    return UiBlock(
        type="thought" if str(match.group(2) or "").strip() else "dialogue",
        speaker_name=speaker_name,
        content=body,
        marker="NPC_THOUGHT" if str(match.group(2) or "").strip() else "NPC",
    )


def _parse_tagged_paragraph(paragraph: str) -> UiBlock | None:
    match = _STRUCTURED_TAG_PATTERN.match(paragraph)
    if match is None:
        return None

    opening_key = normalize_marker_key(match.group(1))
    closing_key = normalize_marker_key(match.group(4))
    if opening_key != closing_key:
        return None

    body = normalize_ai_output_text(match.group(3))
    if not body:
        return None
    if opening_key in _NARRATION_MARKERS:
        return UiBlock(type="narration", content=body, marker="NARRATOR")
    if opening_key not in _SPEECH_MARKERS and opening_key not in _THOUGHT_MARKERS:
        return None

    speaker_name = normalize_speaker_name(match.group(2)) or "НПС"
    if not is_likely_speaker_name(speaker_name):
        return None
    marker = "GG" if opening_key == "gg" else "GG_THOUGHT" if opening_key == "gg_thought" else "NPC_THOUGHT" if opening_key == "npc_thought" else "NPC"
    return UiBlock(
        type="thought" if opening_key in _THOUGHT_MARKERS else "dialogue",
        speaker_name=speaker_name,
        content=body,
        marker=marker,
    )


def parse_ai_output_to_ui_blocks(raw: str | None) -> list[UiBlock]:
    normalized = normalize_ai_output_text(raw)
    if not normalized:
        return []

    blocks: list[UiBlock] = []
    for paragraph in _split_paragraphs_and_inline_markers(normalized):
        parsed = (
            _parse_marker_paragraph(paragraph)
            or _parse_tagged_paragraph(paragraph)
            or _parse_plain_speaker_line(paragraph)
        )
        if parsed is not None:
            blocks.append(parsed)
            continue
        cleaned = _MARKER_DANGLING_PATTERN.sub("", paragraph).strip()
        if cleaned:
            blocks.append(UiBlock(type="narration", content=cleaned))
    return blocks


def serialize_ui_blocks_to_existing_ai_output(blocks: list[UiBlock]) -> str:
    paragraphs: list[str] = []
    for block in blocks:
        content = normalize_ai_output_text(block.content)
        if not content:
            continue
        if block.type == "narration":
            paragraphs.append(content)
            continue

        speaker_name = normalize_speaker_name(block.speaker_name) or "НПС"
        marker = str(block.marker or "").strip().upper()
        if marker not in {"NPC", "GG", "NPC_THOUGHT", "GG_THOUGHT"}:
            marker = "NPC_THOUGHT" if block.type == "thought" else "NPC"
        if block.type == "dialogue" and marker.endswith("_THOUGHT"):
            marker = "NPC"
        if block.type == "thought" and not marker.endswith("_THOUGHT"):
            marker = "NPC_THOUGHT"
        paragraphs.append(f"[[{marker}:{speaker_name}]] {content}")
    return "\n\n".join(paragraphs).strip()


def validate_ai_output_contract(raw: str | None) -> ValidationResult:
    normalized = normalize_ai_output_text(raw)
    issues: list[ContractIssue] = []
    if not normalized:
        return ValidationResult(
            ok=False,
            issues=[
                ContractIssue(
                    code="empty_output",
                    severity="fatal",
                    message="AI output is empty.",
                )
            ],
        )

    if _MARKER_DANGLING_PATTERN.search(normalized):
        issues.append(
            ContractIssue(
                code="dangling_marker",
                severity="high",
                message="Output contains an unfinished [[...]] marker.",
            )
        )

    paragraphs = _split_paragraphs_and_inline_markers(normalized)
    for paragraph in paragraphs:
        marker_count = len(_MARKER_INLINE_PATTERN.findall(paragraph))
        if marker_count > 1:
            issues.append(
                ContractIssue(
                    code="multiple_markers_in_paragraph",
                    severity="medium",
                    message="A single paragraph contains several speaker markers.",
                )
            )
        if "[[" not in paragraph and "]]" not in paragraph:
            continue
        if _parse_marker_paragraph(paragraph) is None:
            issues.append(
                ContractIssue(
                    code="unparseable_marker",
                    severity="high",
                    message="A structured speaker marker cannot be parsed by the compatibility contract.",
                )
            )

    blocks = parse_ai_output_to_ui_blocks(normalized)
    if not blocks:
        issues.append(
            ContractIssue(
                code="no_ui_blocks",
                severity="fatal",
                message="AI output cannot be converted into UI blocks.",
            )
        )

    ok = not any(issue.severity in {"high", "fatal"} for issue in issues)
    return ValidationResult(ok=ok, issues=issues)


def iter_user_visible_text(raw: str | None) -> list[str]:
    return [block.content for block in parse_ai_output_to_ui_blocks(raw) if block.content]


def get_ai_output_contract_notes() -> list[str]:
    return [
        "Обычный нарратив пишется простым текстом без маркера.",
        "Реплика NPC: [[NPC:Имя]] текст реплики.",
        "Реплика главного героя допустима только как точная цитата игрока: [[GG:Имя]] текст.",
        "Мысли: [[NPC_THOUGHT:Имя]] текст или [[GG_THOUGHT:Имя]] текст, если они включены настройками.",
        "Один абзац содержит максимум один speaker marker в самом начале.",
        "Фронт использует speaker name для поиска карточки персонажа и аватарки.",
    ]
