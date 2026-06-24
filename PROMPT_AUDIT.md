# MoRius Backend Prompt Audit

Date: 2026-06-24

Scope: backend prompt assembly, LLM message builders, and prompt-only tests. No route, database, payment, or sol-charging logic is in scope.

## Main Story Prompt

| Function / constant | Purpose | Current size | Findings | Action |
| --- | --- | ---: | --- | --- |
| `STORY_SYSTEM_PROMPT` in `backend/app/main.py` | Base story narrator identity | ~230 chars | Useful, but generic. | Keep short and sharper. |
| `STORY_CREATIVE_WRITING_RULES` | Style/narration rules | ~1,100 chars | Duplicates later anti-repetition and model hints. | Replace with `STORY_NARRATOR_CORE_RULES`. |
| `STORY_ANTI_REPETITION_RULES` | Anti-template rules | ~850 chars | Not wired into `_build_story_system_prompt`; overlaps model hints. | Remove from active assembly. |
| `STORY_HIDDEN_REASONING_OUTPUT_RULES` | Hidden reasoning ban | ~520 chars | Inserted twice in `_build_story_system_prompt`. | Replace with `STORY_HIDDEN_OUTPUT_RULES`, insert once. |
| `STORY_DIALOGUE_FORMAT_RULES_V2` | Speaker/thought markers | ~1,350 chars | Inserted twice; treated as style instead of internal UI protocol. | Replace with `STORY_TRANSPORT_PROTOCOL_RULES`, insert once before cards. |
| `STORY_STRICT_RUSSIAN_OUTPUT_RULES` | Russian output contract | ~900 chars | Useful but too long for every story call. | Replace with short `STORY_LANGUAGE_RULES_RU`. |
| `STORY_MODEL_SPECIFIC_RULES` | Per-model directives | ~5,800 chars | Defined but not wired into `_build_story_system_prompt`; includes removed legacy model; repeats marker/GG/card rules. | Replace with compact `STORY_MODEL_HINTS` and wire after hidden rules. |
| `_build_story_narrator_guardrail_rules` | Latest-turn and GG guardrails | ~900 chars | Duplicates transport, cards, and GG ownership blocks. | Shrink to 4 lines and use once. |
| `_build_story_system_prompt` | Final system prompt assembly | base no-card prompt ~8,518 chars | Duplicate transport/hidden blocks; long instruction-card priority; long GG ownership; no model hints. | Reorder to base -> transport -> narrator -> cards priority -> language -> hidden -> model hint -> cards/locks -> final check. Target no-card prompt <= 2,600 chars. |

`STORY_CREATIVE_WRITING_RULES`, `STORY_ANTI_REPETITION_RULES`, and `STORY_MODEL_SPECIFIC_RULES` were checked: the creative and anti-repetition constants were not active in `_build_story_system_prompt`, and the model-specific dict was also not wired into the prompt builder.

## Service Prompts

| Function | Purpose | Findings | Action |
| --- | --- | --- | --- |
| `_build_story_markup_repair_messages` | Repair MoRius speaker markers | Prompt is okay but verbose; not JSON. | Shorten while preserving exact marker contract. |
| `_translate_text_batch_with_polza` in `main.py` and `story_prompt_engine.py` | Batch translation | Good contract, slightly duplicated and wordy. | Compact; keep `Return JSON only` and marker preservation. |
| `_resolve_story_ambient_profile` | UI ambient palette JSON | JSON-only prompt already present but verbose examples. | Compact; preserve schema/ranges. |
| `_build_story_world_card_extraction_messages` | New world-card extraction JSON | JSON-only present; duplicate schema wording. | Compact and keep only durable entities. |
| `_build_story_world_card_change_messages` | World-card update JSON | Very long split compact/non-compact branches. | Use one compact schema/rule block for both branches. |
| `_build_story_plot_card_memory_messages` | Plot memory compression | New-card branch JSON-only; update branch plain text. | Keep behavior; make JSON branch explicit, reduce wording. |
| `_generate_story_plot_card_title_with_polza` | Plot title JSON | JSON-only present. | Shorten. |
| `_build_story_turn_image_prompt_composer_messages` | Image prompt composition | Long system/user requirements. | Compact while preserving style lock, card facts, visible cast, and text ban. |
| Avatar/emotion prompts in `main.py` and `story_visuals.py` | Character reference and sprite variants | Similar blocks duplicated. | Add/consume `STORY_SPRITE_IMAGE_BASE_RULES`; shorten per-function prompts. |
| Scene emotion/VN analysis in `main.py` and `story_visuals.py` | JSON/tool emotion payloads | Verbose emotion rules. | Shorten; keep strict tool/JSON output and exact names. |

## Risk Notes

- Transport protocol must outrank cards because the frontend parses `[[NPC:...]]`, `[[GG:...]]`, `[[NPC_THOUGHT:...]]`, and `[[GG_THOUGHT:...]]`.
- Player cards remain high-priority content rules after the MoRius protocol, not prompt text that can override UI markers or GG ownership.
- The narrator must never play as the main hero; only consequences of the player's stated actions can be narrated.
- Under-the-hood JSON prompts should explicitly ask for JSON only and no reasoning/commentary.
