from __future__ import annotations

from app import main as monolith_main


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

def _build_story_runtime_deps() -> StoryRuntimeDeps:
    return StoryRuntimeDeps(
        validate_provider_config=_validate_story_provider_config,
        get_current_user=_get_current_user,
        get_user_story_game_or_404=_get_user_story_game_or_404,
        list_story_messages=_list_story_messages,
        normalize_generation_instructions=_normalize_story_generation_instructions,
        rollback_story_card_events_for_assistant_message=_rollback_story_card_events_for_assistant_message,
        normalize_text=_normalize_story_text,
        derive_story_title=_derive_story_title,
        touch_story_game=_touch_story_game,
        list_story_plot_cards=_list_story_plot_cards,
        list_story_world_cards=_list_story_world_cards,
        select_story_world_cards_for_prompt=_select_story_world_cards_for_prompt,
        select_story_world_cards_triggered_by_text=_select_story_world_cards_triggered_by_text,
        normalize_context_limit_chars=_normalize_story_context_limit_chars,
        get_story_turn_cost_tokens=_get_story_turn_cost_tokens,
        spend_user_tokens_if_sufficient=_spend_user_tokens_if_sufficient,
        add_user_tokens=_add_user_tokens,
        stream_story_provider_chunks=_iter_story_provider_stream_chunks,
        normalize_generated_story_output=_normalize_generated_story_output,
        extract_story_character_state_service_payload=_extract_story_character_state_service_payload,
        persist_generated_world_cards=_persist_generated_story_world_cards,
        upsert_story_plot_memory_card=_upsert_story_plot_memory_card,
        list_story_prompt_memory_cards=_list_story_prompt_memory_cards,
        list_story_memory_blocks=_list_story_memory_blocks,
        seed_opening_scene_memory_block=_seed_story_opening_scene_memory_block,
        memory_block_to_out=_story_memory_block_to_out,
        plot_card_to_out=_story_plot_card_to_out,
        world_card_to_out=_story_world_card_to_out,
        world_card_event_to_out=_story_world_card_change_event_to_out,
        plot_card_event_to_out=_story_plot_card_change_event_to_out,
        resolve_story_ambient_profile=_resolve_story_ambient_profile,
        resolve_story_scene_emotion_payload=_request_story_scene_emotion_payload,
        resolve_story_turn_postprocess_payload=_resolve_story_turn_postprocess_payload,
        serialize_story_ambient_profile=_serialize_story_ambient_profile,
        story_game_summary_to_out=_story_game_summary_to_out,
        story_default_title=STORY_DEFAULT_TITLE,
        story_user_role=STORY_USER_ROLE,
        story_assistant_role=STORY_ASSISTANT_ROLE,
        stream_persist_min_chars=STORY_STREAM_PERSIST_MIN_CHARS,
        stream_persist_max_interval_seconds=STORY_STREAM_PERSIST_MAX_INTERVAL_SECONDS,
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
                detail=(detail or "Provider returned error")[:500],
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
                detail=(detail or "Provider returned error")[:500],
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(detail or "Story state could not be prepared before generation")[:500],
        ) from exc
