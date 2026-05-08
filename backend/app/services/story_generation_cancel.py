from __future__ import annotations

import logging
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


class StoryGenerationCancelled(RuntimeError):
    pass


_REGISTRY_LOCK = Lock()
_CURRENT_GENERATION_BY_GAME: dict[int, str] = {}
_CANCELLED_GENERATIONS: set[tuple[int, str]] = set()
_ACTIVE_RESPONSES: dict[tuple[int, str], set[Any]] = {}


def mark_story_generation_started(game_id: int, generation_id: str) -> None:
    normalized_game_id = int(game_id or 0)
    normalized_generation_id = str(generation_id or "").strip()
    if normalized_game_id <= 0 or not normalized_generation_id:
        return
    with _REGISTRY_LOCK:
        _CURRENT_GENERATION_BY_GAME[normalized_game_id] = normalized_generation_id
        _CANCELLED_GENERATIONS.discard((normalized_game_id, normalized_generation_id))


def mark_story_generation_finished(game_id: int, generation_id: str) -> None:
    normalized_game_id = int(game_id or 0)
    normalized_generation_id = str(generation_id or "").strip()
    if normalized_game_id <= 0 or not normalized_generation_id:
        return
    key = (normalized_game_id, normalized_generation_id)
    with _REGISTRY_LOCK:
        if _CURRENT_GENERATION_BY_GAME.get(normalized_game_id) == normalized_generation_id:
            _CURRENT_GENERATION_BY_GAME.pop(normalized_game_id, None)
        _CANCELLED_GENERATIONS.discard(key)
        _ACTIVE_RESPONSES.pop(key, None)


def register_story_generation_response(game_id: int | None, generation_id: str | None, response: Any) -> None:
    normalized_game_id = int(game_id or 0)
    normalized_generation_id = str(generation_id or "").strip()
    if normalized_game_id <= 0 or not normalized_generation_id or response is None:
        return
    key = (normalized_game_id, normalized_generation_id)
    should_close = False
    with _REGISTRY_LOCK:
        _ACTIVE_RESPONSES.setdefault(key, set()).add(response)
        should_close = key in _CANCELLED_GENERATIONS
    if should_close:
        try:
            response.close()
        except Exception:
            logger.debug("Failed to close already-cancelled story generation response", exc_info=True)


def unregister_story_generation_response(game_id: int | None, generation_id: str | None, response: Any) -> None:
    normalized_game_id = int(game_id or 0)
    normalized_generation_id = str(generation_id or "").strip()
    if normalized_game_id <= 0 or not normalized_generation_id or response is None:
        return
    key = (normalized_game_id, normalized_generation_id)
    with _REGISTRY_LOCK:
        responses = _ACTIVE_RESPONSES.get(key)
        if not responses:
            return
        responses.discard(response)
        if not responses:
            _ACTIVE_RESPONSES.pop(key, None)


def cancel_story_generation(game_id: int) -> bool:
    normalized_game_id = int(game_id or 0)
    if normalized_game_id <= 0:
        return False
    with _REGISTRY_LOCK:
        generation_id = _CURRENT_GENERATION_BY_GAME.get(normalized_game_id)
        if not generation_id:
            return False
        key = (normalized_game_id, generation_id)
        _CANCELLED_GENERATIONS.add(key)
        responses = list(_ACTIVE_RESPONSES.get(key, ()))
    for response in responses:
        try:
            response.close()
        except Exception:
            logger.debug("Failed to close active story generation response", exc_info=True)
    return True


def is_story_generation_cancelled(game_id: int | None, generation_id: str | None) -> bool:
    normalized_game_id = int(game_id or 0)
    normalized_generation_id = str(generation_id or "").strip()
    if normalized_game_id <= 0 or not normalized_generation_id:
        return False
    with _REGISTRY_LOCK:
        return (normalized_game_id, normalized_generation_id) in _CANCELLED_GENERATIONS
