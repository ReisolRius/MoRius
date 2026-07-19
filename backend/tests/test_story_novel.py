from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_emotions import (  # noqa: E402
    deserialize_story_character_emotion_assets,
    serialize_story_character_emotion_assets,
)
from app.services.auth_identity import sync_user_role_with_email  # noqa: E402
from app.services.story_novel import (  # noqa: E402
    STORY_GAME_MODE_RPG,
    STORY_GAME_MODE_VISUAL_NOVEL,
    STORY_NOVEL_BEAT_DIALOGUE,
    STORY_NOVEL_BEAT_NARRATION,
    STORY_NOVEL_BEAT_THOUGHT,
    STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER,
    _resolve_story_novel_sprite,
    build_story_novel_instruction_card,
    can_user_use_story_visual_novel,
    is_story_visual_novel_enabled,
    is_story_visual_novel_game,
    normalize_story_game_mode,
    parse_story_novel_beats,
)


class NormalizeStoryGameModeTests(unittest.TestCase):
    def test_defaults_to_rpg_for_unknown_values(self) -> None:
        self.assertEqual(normalize_story_game_mode(None), STORY_GAME_MODE_RPG)
        self.assertEqual(normalize_story_game_mode(""), STORY_GAME_MODE_RPG)
        self.assertEqual(normalize_story_game_mode("something_else"), STORY_GAME_MODE_RPG)

    def test_accepts_visual_novel_and_aliases(self) -> None:
        self.assertEqual(normalize_story_game_mode("visual_novel"), STORY_GAME_MODE_VISUAL_NOVEL)
        self.assertEqual(normalize_story_game_mode("novel"), STORY_GAME_MODE_VISUAL_NOVEL)
        self.assertEqual(normalize_story_game_mode("VN"), STORY_GAME_MODE_VISUAL_NOVEL)


class VisualNovelRoleGatingTests(unittest.TestCase):
    def test_administrator_and_beta_tester_can_use_visual_novel(self) -> None:
        admin = SimpleNamespace(role="administrator")
        beta_tester = SimpleNamespace(role="beta_tester")
        player = SimpleNamespace(role="user")
        moderator = SimpleNamespace(role="moderator")

        self.assertTrue(can_user_use_story_visual_novel(admin))
        self.assertTrue(can_user_use_story_visual_novel(beta_tester))
        self.assertFalse(can_user_use_story_visual_novel(player))
        self.assertFalse(can_user_use_story_visual_novel(moderator))

    def test_is_story_visual_novel_enabled_requires_access_and_game_mode(self) -> None:
        admin = SimpleNamespace(role="administrator")
        beta_tester = SimpleNamespace(role="beta_tester")
        player = SimpleNamespace(role="user")
        vn_game = SimpleNamespace(game_mode="visual_novel")
        rpg_game = SimpleNamespace(game_mode="rpg")

        self.assertTrue(is_story_visual_novel_game(vn_game))
        self.assertFalse(is_story_visual_novel_game(rpg_game))
        self.assertTrue(is_story_visual_novel_enabled(vn_game, admin))
        self.assertTrue(is_story_visual_novel_enabled(vn_game, beta_tester))
        self.assertFalse(is_story_visual_novel_enabled(vn_game, player))
        self.assertFalse(is_story_visual_novel_enabled(rpg_game, admin))

    def test_beta_tester_role_survives_auth_role_sync(self) -> None:
        beta_tester = SimpleNamespace(email="beta@example.com", role="beta_tester")

        self.assertFalse(sync_user_role_with_email(beta_tester))
        self.assertEqual(beta_tester.role, "beta_tester")


class ParseStoryNovelBeatsTests(unittest.TestCase):
    def test_splits_canonical_narration_dialogue_and_thought_paragraphs(self) -> None:
        raw = (
            "Таверна встречает тебя запахом эля и дымом очага.\n\n"
            "[[NPC:Мия]] Наконец-то! Я думала, ты не придёшь.\n\n"
            "[[NPC_THOUGHT:Мия]] Только бы он не заметил, как я нервничаю.\n\n"
            "Дверь скрипит, впуская сквозняк с улицы."
        )
        beats = parse_story_novel_beats(raw)

        kinds = [beat.kind for beat in beats]
        self.assertIn(STORY_NOVEL_BEAT_NARRATION, kinds)
        self.assertIn(STORY_NOVEL_BEAT_DIALOGUE, kinds)
        self.assertIn(STORY_NOVEL_BEAT_THOUGHT, kinds)

        dialogue_beat = next(beat for beat in beats if beat.kind == STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(dialogue_beat.speaker_name, "Мия")
        self.assertEqual(dialogue_beat.emotion, "neutral")
        self.assertIn("Наконец-то", dialogue_beat.text)

        thought_beat = next(beat for beat in beats if beat.kind == STORY_NOVEL_BEAT_THOUGHT)
        self.assertEqual(thought_beat.speaker_name, "Мия")
        self.assertEqual(thought_beat.emotion, "neutral")
        self.assertIn("Только бы", thought_beat.text)

    def test_parses_canonical_gg_speech_with_neutral_emotion(self) -> None:
        beats = parse_story_novel_beats("[[GG:Алисия]] Здравствуй, путник.")
        dialogue_beat = next(beat for beat in beats if beat.kind == STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(dialogue_beat.speaker_name, "Алисия")
        self.assertEqual(dialogue_beat.emotion, "neutral")

    def test_keeps_legacy_speaker_lines_readable_without_requesting_them(self) -> None:
        beats = parse_story_novel_beats(
            "Мия [радость]: Наконец-то!\n"
            "Мия [страх]: (Только бы он не заметил.)"
        )
        self.assertEqual(beats[0].kind, STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(beats[0].emotion, "happy")
        self.assertEqual(beats[1].kind, STORY_NOVEL_BEAT_THOUGHT)
        self.assertEqual(beats[1].emotion, "scared")

    def test_falls_back_to_single_narration_beat_for_unparsable_text(self) -> None:
        beats = parse_story_novel_beats("   ")
        self.assertEqual(beats, [])

        beats = parse_story_novel_beats("Просто голый текст без разметки.")
        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0].kind, STORY_NOVEL_BEAT_NARRATION)


class ResolveStoryNovelSpriteTests(unittest.TestCase):
    def test_serialized_emotion_pack_can_be_safely_reserialized_during_copy(self) -> None:
        original = serialize_story_character_emotion_assets(
            {
                "neutral": "https://cdn.example.com/neutral.png",
                "surprised": "https://cdn.example.com/surprised.png",
            }
        )

        copied = serialize_story_character_emotion_assets(original)

        self.assertEqual(deserialize_story_character_emotion_assets(copied), {
            "neutral": "https://cdn.example.com/neutral.png",
            "surprised": "https://cdn.example.com/surprised.png",
        })

    def test_no_character_without_gender_still_returns_a_visible_incognito_sprite(self) -> None:
        sprite_url, incognito, gender = _resolve_story_novel_sprite(None, "happy")
        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["male"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "male")

    def test_legacy_female_role_name_infers_female_incognito_sprite(self) -> None:
        sprite_url, incognito, gender = _resolve_story_novel_sprite(
            None,
            "angry",
            fallback_name="Учительница Ирис",
        )

        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "female")

    def test_character_profile_text_supplies_missing_sprite_gender(self) -> None:
        character = SimpleNamespace(
            id=11,
            updated_at=None,
            name="Ирис",
            description="Пол: женский. Преподавательница боевой магии.",
            note="",
            triggers="",
            novel_sprite_gender="",
            emotion_assets="",
        )

        sprite_url, incognito, gender = _resolve_story_novel_sprite(character, "angry")

        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "female")

    def test_unregistered_character_uses_ai_gender_incognito_sprite(self) -> None:
        sprite_url, incognito, gender = _resolve_story_novel_sprite(
            None,
            "happy",
            fallback_gender="female",
        )

        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "female")

    def test_character_without_uploaded_sprites_is_incognito_by_gender(self) -> None:
        character = SimpleNamespace(id=1, updated_at=None, novel_sprite_gender="female", emotion_assets="")
        sprite_url, incognito, gender = _resolve_story_novel_sprite(character, "happy")
        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "female")

    def test_character_with_matching_emotion_sprite_resolves_url(self) -> None:
        character = SimpleNamespace(
            id=2,
            updated_at=None,
            novel_sprite_gender="male",
            emotion_assets='{"happy": "https://cdn.example.com/happy.png"}',
        )
        sprite_url, incognito, gender = _resolve_story_novel_sprite(character, "happy")
        self.assertIsNotNone(sprite_url)
        self.assertFalse(incognito)
        self.assertEqual(gender, "male")

    def test_character_without_requested_or_neutral_slot_uses_gender_incognito(self) -> None:
        character = SimpleNamespace(
            id=3,
            updated_at=None,
            novel_sprite_gender="",
            emotion_assets='{"sad": "https://cdn.example.com/sad.png"}',
        )
        sprite_url, incognito, gender = _resolve_story_novel_sprite(
            character,
            "happy",
            fallback_gender="male",
        )

        self.assertEqual(sprite_url, STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["male"])
        self.assertTrue(incognito)
        self.assertEqual(gender, "male")

    def test_unknown_ninth_emotion_uses_neutral_sprite_instead_of_incognito(self) -> None:
        character = SimpleNamespace(
            id=4,
            updated_at=None,
            novel_sprite_gender="female",
            emotion_assets='{"neutral": "https://cdn.example.com/neutral.png"}',
        )

        sprite_url, incognito, gender = _resolve_story_novel_sprite(character, "curiosity")

        self.assertEqual(sprite_url, "https://cdn.example.com/neutral.png")
        self.assertFalse(incognito)
        self.assertEqual(gender, "female")


class BuildStoryNovelInstructionCardTests(unittest.TestCase):
    def test_card_reinforces_the_shared_canonical_speaker_contract(self) -> None:
        card = build_story_novel_instruction_card()
        self.assertEqual(card["source_kind"], "visual_novel")
        content = card["content"]
        for marker in ("[[NPC:Имя]]", "[[GG:Имя]]", "[[NPC_THOUGHT:Имя]]", "[[GG_THOUGHT:Имя]]"):
            self.assertIn(marker, content)
        self.assertIn("точный title", content)
        self.assertIn("устойчивое естественное имя", content)
        self.assertIn("не длиннее четырёх слов", content)
        self.assertIn("НПС, NPC, Голос, Незнакомец и Персонаж", content)
        self.assertIn("не оставляй речь обычным текстом", content)
        self.assertIn("{{VN_CAST|Точный title|female|Эмоция; Другой title|male|Эмоция}}", content)
        self.assertIn("обязательно указывай пол", content)
        self.assertNotIn("Имя [эмоция]:", content)


if __name__ == "__main__":
    unittest.main()
