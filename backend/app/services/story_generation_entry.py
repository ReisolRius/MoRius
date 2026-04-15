from __future__ import annotations

from dataclasses import replace

from app import main as monolith_main
from app.services.story_generation_provider import (
    _iter_story_provider_stream_chunks as _service_iter_story_provider_stream_chunks,
)


def _bind_monolith_names() -> None:
    module_globals = globals()
    for name in dir(monolith_main):
        if name.startswith("__"):
            continue
        module_globals.setdefault(name, getattr(monolith_main, name))


_bind_monolith_names()

STORY_PROVIDER_FAILURE_DETAIL_MARKERS = (
    "provider returned error",
    "internal server error",
    "server_error",
    "upstream",
    "openrouter chat error (500)",
    "openrouter chat error (502)",
    "openrouter chat error (503)",
    "openrouter chat error (504)",
)

STORY_PRE_STREAM_CONFLICT_DETAIL = (
    "Story state could not be prepared before generation. Refresh the game and try again."
)


def _is_story_provider_failure_detail(detail: str | None) -> bool:
    normalized_detail = str(detail or "").casefold()
    if not normalized_detail:
        return False
    return any(marker in normalized_detail for marker in STORY_PROVIDER_FAILURE_DETAIL_MARKERS)


def _public_story_provider_failure_detail(detail: str | None) -> str:
    normalized_detail = str(detail or "").replace("\r\n", "\n").strip()
    normalized_detail = " ".join(normalized_detail.split())
    if normalized_detail.casefold().startswith("openrouter chat error") and "{" in normalized_detail:
        normalized_detail = normalized_detail.split("{", 1)[0].rstrip(" .:,")
    return normalized_detail[:500] or "Provider returned error"

def _build_story_runtime_deps() -> StoryRuntimeDeps:
    base_builder = getattr(monolith_main, "_build_story_runtime_deps", None)
    if not callable(base_builder):
        raise RuntimeError("Story runtime dependencies builder is unavailable")
    return replace(
        base_builder(),
        stream_story_provider_chunks=_service_iter_story_provider_stream_chunks,
    )

def generate_story_response_impl(
    game_id: int,
    payload: StoryGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StreamingResponse:
    prompt_length = len(str(payload.prompt or "").strip())
    logger.info(
        "Story generate request received: game_id=%s reroll=%s discard_steps=%s prompt_chars=%s model_override=%s",
        game_id,
        bool(payload.reroll_last_response),
        int(payload.discard_last_assistant_steps or 0),
        prompt_length,
        str(payload.story_llm_model or "").strip() or "inherit",
    )
    try:
        return _generate_story_response(
            deps=_build_story_runtime_deps(),
            game_id=game_id,
            payload=payload,
            authorization=authorization,
            db=db,
        )
    except HTTPException as exc:
        detail = str(getattr(exc, "detail", "") or "").strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(
            "Story generate request failed before stream start: game_id=%s status=%s detail=%s",
            game_id,
            exc.status_code,
            detail or "n/a",
        )
        if exc.status_code == status.HTTP_400_BAD_REQUEST and _is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_public_story_provider_failure_detail(detail),
            ) from exc
        raise
    except Exception as exc:
        detail = str(exc).strip()
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception(
            "Story generate request crashed before stream start: game_id=%s detail=%s",
            game_id,
            detail or "n/a",
        )
        if _is_story_provider_failure_detail(detail):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=_public_story_provider_failure_detail(detail),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(detail or "Story state could not be prepared before generation")[:500],
        ) from exc
