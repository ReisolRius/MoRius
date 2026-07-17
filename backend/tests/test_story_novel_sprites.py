from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    StoryCharacter,
    StoryGame,
    StoryMessage,
    StoryNovelBeat,
    StoryWorldCard,
    User,
)
from app.services.story_emotions import serialize_story_character_emotion_assets  # noqa: E402
from app.services.story_novel import (  # noqa: E402
    STORY_NOVEL_BEAT_DIALOGUE,
    STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER,
    parse_story_novel_beats,
    persist_story_novel_beats_for_message,
    resolve_story_novel_beats_for_read,
    serialize_story_novel_beats_for_stream,
)


class StoryNovelEmotionCueTests(unittest.TestCase):
    def test_reads_legacy_gg_replick_opening_marker_as_dialogue(self) -> None:
        beat = parse_story_novel_beats(
            "[[GG_REPLICK:Алисия]] (радость) Наконец-то я добралась."
        )[0]

        self.assertEqual(beat.kind, STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(beat.speaker_name, "Алисия")
        self.assertEqual(beat.emotion, "happy")
        self.assertEqual(beat.text, "Наконец-то я добралась.")

    def test_parses_emotion_after_unmodified_canonical_marker(self) -> None:
        beats = parse_story_novel_beats(
            "[[NPC:Леди Мия]] (злость) Немедленно покиньте мой дом.\n\n"
            "[[NPC_THOUGHT:Леди Мия]] (страх): Только бы он не заметил дрожь."
        )

        self.assertEqual(len(beats), 2)
        self.assertEqual(beats[0].speaker_name, "Леди Мия")
        self.assertEqual(beats[0].emotion, "angry")
        self.assertEqual(beats[0].text, "Немедленно покиньте мой дом.")
        self.assertEqual(beats[1].emotion, "scared")
        self.assertEqual(beats[1].text, "Только бы он не заметил дрожь.")

    def test_keeps_unknown_parenthetical_as_dialogue_text(self) -> None:
        beat = parse_story_novel_beats(
            "[[NPC:Леди Мия]] (глядя в окно) Кажется, дождь начинается."
        )[0]

        self.assertEqual(beat.emotion, "neutral")
        self.assertEqual(beat.text, "(глядя в окно) Кажется, дождь начинается.")


class StoryNovelSpritePipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_game_and_character(
        self,
        db,
        *,
        linked_card: bool,
    ) -> tuple[StoryGame, StoryCharacter, StoryWorldCard, StoryMessage]:
        user = User(
            email=f"vn-{id(self)}@example.com",
            password_hash="test",
            role="administrator",
        )
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="VN test", game_mode="visual_novel")
        db.add(game)
        db.flush()
        character = StoryCharacter(
            user_id=user.id,
            name="Леди Мия",
            description="Хозяйка дома",
            triggers='["Мия", "леди Мия"]',
            emotion_assets=serialize_story_character_emotion_assets(
                {
                    "neutral": "https://cdn.example.com/mia-neutral.png",
                    "angry": "https://cdn.example.com/mia-angry.png",
                }
            ),
            novel_sprite_gender="female",
        )
        db.add(character)
        db.flush()
        card = StoryWorldCard(
            game_id=game.id,
            title="Леди Мия",
            content="Хозяйка дома",
            triggers='["Мия", "леди Мия"]',
            kind="npc",
            character_id=character.id if linked_card else None,
        )
        message = StoryMessage(
            game_id=game.id,
            role="assistant",
            content="[[NPC:Леди Мия]] (злость) Прочь!",
        )
        db.add_all([card, message])
        db.flush()
        return game, character, card, message

    def test_persist_to_sse_resolves_exact_emotion_sprite(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=True)

            beats = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )
            payload = serialize_story_novel_beats_for_stream(db, beats)

            self.assertEqual(len(payload), 1)
            self.assertEqual(payload[0]["kind"], STORY_NOVEL_BEAT_DIALOGUE)
            self.assertEqual(payload[0]["speaker_character_id"], character.id)
            self.assertEqual(payload[0]["emotion"], "angry")
            self.assertEqual(payload[0]["sprite_url"], "https://cdn.example.com/mia-angry.png")
            self.assertFalse(payload[0]["sprite_incognito"])

    def test_unregistered_npc_uses_persisted_ai_gender_incognito_sprite(self) -> None:
        with self.Session() as db:
            game, _character, card, message = self._create_game_and_character(db, linked_card=True)
            message.content = (
                "[[NPC:Элина]] (радость) Я знаю короткую дорогу. "
                "{{VN_CAST|Элина|female|Радость}}"
            )
            db.flush()

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )[0]
            persisted_cast = json.loads(beat.scene_characters_json)
            payload = serialize_story_novel_beats_for_stream(db, [beat])[0]

            self.assertEqual(persisted_cast[0]["gender"], "female")
            self.assertIsNone(payload["speaker_character_id"])
            self.assertEqual(
                payload["sprite_url"],
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(payload["sprite_incognito"])
            self.assertEqual(payload["sprite_gender"], "female")
            self.assertEqual(
                payload["scene_characters"][0]["sprite_url"],
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(payload["scene_characters"][0]["incognito"])

    def test_known_character_without_requested_or_neutral_sprite_uses_incognito(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=True)
            character.emotion_assets = serialize_story_character_emotion_assets(
                {"sad": "https://cdn.example.com/mia-sad.png"}
            )
            message.content = (
                "[[NPC:Леди Мия]] (радость) Сегодня хороший день. "
                "{{VN_CAST|Леди Мия|female|Радость}}"
            )
            db.flush()

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )[0]
            payload = serialize_story_novel_beats_for_stream(db, [beat])[0]

            self.assertEqual(
                payload["sprite_url"],
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(payload["sprite_incognito"])

    def test_cast_accepts_exact_linked_profile_name_when_card_title_differs(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=True)
            card.title = "Беловолосая одноклассница"
            card.triggers = '["Беловолосая одноклассница"]'
            character.name = "Сильвия"
            character.triggers = '["Сильвия"]'
            message.content = (
                "Сильвия пытливо посмотрела на Алекса. "
                "{{VN_CAST|Сильвия|Любопытство}}"
            )
            db.flush()

            beats = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )
            persisted_cast = json.loads(beats[0].scene_characters_json)
            payload = serialize_story_novel_beats_for_stream(db, beats)[0]

            self.assertEqual(persisted_cast[0]["character_id"], character.id)
            self.assertEqual(persisted_cast[0]["emotion"], "neutral")
            self.assertEqual(payload["scene_characters"][0]["character_id"], character.id)
            self.assertEqual(
                payload["scene_characters"][0]["sprite_url"],
                "https://cdn.example.com/mia-neutral.png",
            )
            self.assertFalse(payload["scene_characters"][0]["incognito"])

    def test_unique_shortened_card_name_resolves_without_substring_matching(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=True)
            card.title = "Айри Новел"
            card.triggers = '["Айри Новел"]'
            character.name = "Айри Новел"
            character.triggers = '["Айри Новел"]'
            db.flush()

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response="[[NPC:Айри]] (удивление) Ты всё ещё в сознании?",
                world_cards=[card],
            )[0]
            payload = serialize_story_novel_beats_for_stream(db, [beat])[0]

            self.assertEqual(payload["speaker_character_id"], character.id)
            self.assertEqual(payload["sprite_url"], "https://cdn.example.com/mia-neutral.png")
            self.assertFalse(payload["sprite_incognito"])

    def test_existing_copy_with_empty_pack_uses_exact_public_source_lineage(self) -> None:
        with self.Session() as db:
            game, copied_character, card, message = self._create_game_and_character(db, linked_card=True)
            source_owner = User(
                email="vn-public-source@example.com",
                password_hash="test",
                role="administrator",
            )
            db.add(source_owner)
            db.flush()
            source_character = StoryCharacter(
                user_id=source_owner.id,
                name="Леди Мия",
                description="Публичный оригинал",
                triggers='["Леди Мия"]',
                emotion_assets=serialize_story_character_emotion_assets(
                    {"surprised": "https://cdn.example.com/source-surprised.png"}
                ),
                novel_sprite_gender="female",
                visibility="public",
            )
            db.add(source_character)
            db.flush()
            copied_character.emotion_assets = ""
            copied_character.source_character_id = source_character.id
            message.content = "[[NPC:Леди Мия]] (удивление) Как это возможно?"
            db.flush()

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )[0]
            payload = serialize_story_novel_beats_for_stream(db, [beat])[0]

            self.assertEqual(payload["speaker_character_id"], copied_character.id)
            self.assertEqual(payload["sprite_url"], "https://cdn.example.com/source-surprised.png")
            self.assertFalse(payload["sprite_incognito"])

    def test_read_relinks_legacy_beat_via_current_unlinked_card_and_owner_character(self) -> None:
        with self.Session() as db:
            game, character, _, message = self._create_game_and_character(db, linked_card=False)
            legacy_beat = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="ЛЕДИ МИЯ",
                speaker_character_id=None,
                emotion="angry",
                text="Прочь!",
            )
            db.add(legacy_beat)
            db.flush()

            payload = resolve_story_novel_beats_for_read(db, [legacy_beat])[0]

            self.assertEqual(payload.speaker_character_id, character.id)
            self.assertEqual(payload.sprite_url, "https://cdn.example.com/mia-angry.png")
            self.assertFalse(payload.sprite_incognito)
            # GET/read compatibility does not mutate historical storage as a side effect.
            self.assertIsNone(legacy_beat.speaker_character_id)

    def test_persist_recovers_missing_card_character_id_before_writing_beat(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=False)

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response="[[NPC:Мия]] (злость) Прочь!",
                world_cards=[card],
            )[0]

            self.assertEqual(beat.speaker_character_id, character.id)

    def test_ambiguous_unlinked_card_identity_never_borrows_newest_sprite_pack(self) -> None:
        with self.Session() as db:
            game, _character, _card, message = self._create_game_and_character(db, linked_card=False)
            duplicate = StoryCharacter(
                user_id=game.user_id,
                name="Леди Мия",
                description="Другой профиль с тем же именем",
                triggers='["Мия", "леди Мия"]',
                emotion_assets=serialize_story_character_emotion_assets(
                    {"angry": "https://cdn.example.com/unrelated-white-rectangle.png"}
                ),
                novel_sprite_gender="female",
            )
            db.add(duplicate)
            db.flush()
            legacy_beat = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="Леди Мия",
                speaker_character_id=None,
                emotion="angry",
                text="Прочь!",
            )
            db.add(legacy_beat)
            db.flush()

            payload = resolve_story_novel_beats_for_read(db, [legacy_beat])[0]

            self.assertIsNone(payload.speaker_character_id)
            self.assertEqual(
                payload.sprite_url,
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(payload.sprite_incognito)

    def test_stale_direct_character_id_is_corrected_by_current_card_mapping(self) -> None:
        with self.Session() as db:
            game, expected_character, _card, message = self._create_game_and_character(db, linked_card=True)
            unrelated_character = StoryCharacter(
                user_id=game.user_id,
                name="Белый маг",
                description="Совсем другой персонаж",
                triggers='["Белый маг"]',
                emotion_assets=serialize_story_character_emotion_assets(
                    {"angry": "https://cdn.example.com/unrelated-white-rectangle.png"}
                ),
                novel_sprite_gender="male",
            )
            db.add(unrelated_character)
            db.flush()
            stale_beat = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="Леди Мия",
                speaker_character_id=unrelated_character.id,
                emotion="angry",
                text="Прочь!",
            )
            db.add(stale_beat)
            db.flush()

            payload = resolve_story_novel_beats_for_read(db, [stale_beat])[0]

            self.assertEqual(payload.speaker_character_id, expected_character.id)
            self.assertEqual(payload.sprite_url, "https://cdn.example.com/mia-angry.png")
            self.assertNotEqual(payload.speaker_character_id, unrelated_character.id)

    def test_foreign_historical_character_id_is_never_loaded_as_a_sprite(self) -> None:
        with self.Session() as db:
            game, _character, _card, message = self._create_game_and_character(db, linked_card=True)
            other_user = User(
                email="foreign-vn-character@example.com",
                password_hash="test",
                role="administrator",
            )
            db.add(other_user)
            db.flush()
            foreign_character = StoryCharacter(
                user_id=other_user.id,
                name="Белый маг",
                description="Чужой приватный персонаж",
                triggers='["Белый маг"]',
                emotion_assets=serialize_story_character_emotion_assets(
                    {"neutral": "https://cdn.example.com/foreign-private.png"}
                ),
                novel_sprite_gender="male",
            )
            db.add(foreign_character)
            db.flush()
            stale_beat = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="Белый маг",
                speaker_character_id=foreign_character.id,
                emotion="neutral",
                text="Я здесь.",
                scene_characters_json=json.dumps(
                    [
                        {
                            "name": "Белый маг",
                            "emotion": "neutral",
                            "character_id": foreign_character.id,
                        }
                    ],
                    ensure_ascii=False,
                ),
            )
            db.add(stale_beat)
            db.flush()

            payload = resolve_story_novel_beats_for_read(db, [stale_beat])[0]

            self.assertIsNone(payload.speaker_character_id)
            self.assertEqual(
                payload.sprite_url,
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["male"],
            )
            self.assertTrue(payload.sprite_incognito)
            self.assertEqual(len(payload.scene_characters), 1)
            self.assertIsNone(payload.scene_characters[0].character_id)
            self.assertEqual(
                payload.scene_characters[0].sprite_url,
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["male"],
            )
            self.assertTrue(payload.scene_characters[0].incognito)

    def test_shared_trigger_between_linked_cards_is_treated_as_ambiguous(self) -> None:
        with self.Session() as db:
            game, first_character, first_card, message = self._create_game_and_character(db, linked_card=True)
            first_card.triggers = '["двойник"]'
            second_character = StoryCharacter(
                user_id=game.user_id,
                name="Леди Ния",
                description="Второй персонаж",
                triggers='["двойник"]',
                emotion_assets=serialize_story_character_emotion_assets(
                    {"neutral": "https://cdn.example.com/nia-neutral.png"}
                ),
                novel_sprite_gender="female",
            )
            db.add(second_character)
            db.flush()
            second_card = StoryWorldCard(
                game_id=game.id,
                title="Леди Ния",
                content="Второй персонаж",
                triggers='["двойник"]',
                kind="npc",
                character_id=second_character.id,
            )
            db.add(second_card)
            db.flush()
            ambiguous_beat = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="двойник",
                speaker_character_id=first_character.id,
                emotion="neutral",
                text="Который из нас?",
            )
            db.add(ambiguous_beat)
            db.flush()

            payload = resolve_story_novel_beats_for_read(db, [ambiguous_beat])[0]

            self.assertIsNone(payload.speaker_character_id)
            self.assertEqual(
                payload.sprite_url,
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["male"],
            )
            self.assertTrue(payload.sprite_incognito)

    def test_legacy_generic_gg_alias_resolves_to_active_main_hero_sprite(self) -> None:
        with self.Session() as db:
            game, character, card, message = self._create_game_and_character(db, linked_card=True)
            card.kind = "main_hero"
            game.active_main_hero_card_id = card.id
            message.content = "[[GG_REPLICK:Главный Герой]] (радость) Я готова."
            db.flush()

            beat = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=message.content,
                world_cards=[card],
            )[0]
            payload = serialize_story_novel_beats_for_stream(db, [beat])[0]

            self.assertEqual(beat.speaker_character_id, character.id)
            self.assertEqual(payload["speaker_character_id"], character.id)
            # Happy was not uploaded, so the documented neutral fallback still yields
            # the linked hero's real sprite rather than an incognito silhouette.
            self.assertEqual(payload["sprite_url"], "https://cdn.example.com/mia-neutral.png")
            self.assertFalse(payload["sprite_incognito"])


if __name__ == "__main__":
    unittest.main()
