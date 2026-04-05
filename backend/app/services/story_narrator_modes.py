from __future__ import annotations

from app.services.story_games import (
    STORY_NARRATOR_MODE_HARDCORE,
    STORY_NARRATOR_MODE_NORMAL,
    STORY_NARRATOR_MODE_RISK,
    coerce_story_narrator_mode,
)


def _split_prompt_block(text: str) -> tuple[str, ...]:
    return tuple(line.rstrip() for line in text.strip().splitlines() if line.strip())


def _join_prompt_sections(*sections: tuple[str, ...]) -> tuple[str, ...]:
    merged: list[str] = []
    for section in sections:
        if not section:
            continue
        if merged:
            merged.append("")
        merged.extend(section)
    return tuple(merged)


STORY_MODE_NORMAL_RULES = _split_prompt_block(
    """
    [MODE_NORMAL]
    Game mode: normal adventure pressure.
    The world should be fair, active, and unsentimental, but not arbitrarily cruel.
    Player mistakes matter, yet the scene usually leaves room to recover, retreat, bargain, or adapt.
    Do not auto-save the player, and do not rig every scene into a clean win.
    Let strong choices create real openings. Let bad choices create real friction.
    Keep the feeling of dangerous adventure, not pointless punishment.
    """
)

STORY_MODE_RISK_RULES = _split_prompt_block(
    """
    [MODE_RISK]
    Game mode: elevated danger.
    The world protects the player less and enforces mistakes more directly.
    If the player rushes, misreads danger, trusts the wrong person, or walks in unprepared, hit with honest consequences.
    Do not soften losses just because the player tried hard.
    A good result may be survival, escape, leverage, or partial damage control rather than victory.
    Keep outcomes harsh but believable, never random for shock value alone.
    """
)

STORY_MODE_HARDCORE_RULES = _split_prompt_block(
    """
    [MODE_HARDCORE]
    Game mode: hardcore.
    The world is cold, persistent, and gives no plot armor.
    Never rescue the player for being the protagonist.
    If the player makes a terrible call, let the world break him honestly and fully.
    Defeat may be ugly, fast, humiliating, costly, permanent, or fatal when the situation truly supports it.
    Never disguise failure as a hidden reward.
    """
)

STORY_THREAT_LOGIC_RULES = _split_prompt_block(
    """
    [THREAT_LOGIC]
    Before resolving danger, silently evaluate force balance, surprise, weapons, terrain, numbers, status, readiness, exits, and cost of error.
    If the setup is bad for the player, the result must feel bad for the player.
    If the setup is lethal, do not let charisma, narrative importance, or genre convenience cancel that.
    """
)

STORY_HARDCORE_EXTRA_RULES = _split_prompt_block(
    """
    [HARDCORE_EXTRA]
    Enemies may be cowardly, unfair, opportunistic, or pragmatic.
    The world respects strength, leverage, timing, preparation, and luck more than noble intent.
    Losses should echo into future turns through debt, fear, injury, humiliation, damaged alliances, or missing resources.
    """
)

STORY_ROMANCE_RULES = _split_prompt_block(
    """
    [MODE_INTIMACY]
    Adult intimacy is allowed and may be explicit, crude, tender, awkward, selfish, or emotionally messy.
    Keep all participants clearly adult.
    NPC desire must stay autonomous: they can want, hesitate, refuse, escalate, or leave based on their own motives.
    Intimacy should change relationships, leverage, shame, trust, jealousy, attachment, or future risk.
    Do not sanitize sexual tension into generic softness.
    """
)

STORY_ROMANCE_QUALITY_RULES = _split_prompt_block(
    """
    [INTIMACY_QUALITY]
    Build attraction from character, timing, vulnerability, power balance, resentment, curiosity, need, and prior history.
    Give each NPC a distinct flirting style, appetite, rhythm, and emotional cost.
    Avoid copy-paste seduction beats, identical tenderness, or interchangeable moans and compliments.
    If the scene turns too smooth, add friction, mismatch, insecurity, selfishness, or inconvenient truth.
    """
)

STORY_ROMANCE_ANTISHABLON_RULES = _split_prompt_block(
    """
    [INTIMACY_ANTICLICHE]
    Avoid formulaic smoky-lips prose, identical pauses before kisses, and the same soft-whisper cadence in every scene.
    Prefer one sharp physical detail or one loaded line over purple atmosphere.
    Make intimacy feel specific to these people, not to the genre.
    """
)

STORY_ROMANCE_NO_PLOT_ARMOR_RULES = _split_prompt_block(
    """
    [INTIMACY_NO_PLOT_ARMOR]
    Sex, desire, and affection do not suspend danger, debt, rivalry, social fallout, or conflicting agendas.
    A hot scene may end in closeness, distance, regret, leverage, dependency, blackmail, or new trouble.
    """
)


def build_story_mode_prompt_rules(*, narrator_mode: str | None, romance_enabled: bool) -> tuple[str, ...]:
    normalized_mode = coerce_story_narrator_mode(narrator_mode)
    sections: list[tuple[str, ...]] = []

    if normalized_mode == STORY_NARRATOR_MODE_RISK:
        sections.extend((STORY_MODE_RISK_RULES, STORY_THREAT_LOGIC_RULES))
    elif normalized_mode == STORY_NARRATOR_MODE_HARDCORE:
        sections.extend((STORY_MODE_HARDCORE_RULES, STORY_THREAT_LOGIC_RULES, STORY_HARDCORE_EXTRA_RULES))
    else:
        sections.append(STORY_MODE_NORMAL_RULES)

    if romance_enabled:
        sections.extend(
            (
                STORY_ROMANCE_RULES,
                STORY_ROMANCE_QUALITY_RULES,
                STORY_ROMANCE_ANTISHABLON_RULES,
            )
        )
        if normalized_mode in {STORY_NARRATOR_MODE_RISK, STORY_NARRATOR_MODE_HARDCORE}:
            sections.append(STORY_ROMANCE_NO_PLOT_ARMOR_RULES)

    return _join_prompt_sections(*sections)
