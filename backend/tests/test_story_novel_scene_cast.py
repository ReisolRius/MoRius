from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import StoryCharacter, StoryGame, StoryMessage, StoryNovelBeat, StoryWorldCard, User  # noqa: E402
from app.services.story_emotions import serialize_story_character_emotion_assets  # noqa: E402
from app.services.story_novel import (  # noqa: E402
    STORY_NOVEL_BEAT_DIALOGUE,
    STORY_NOVEL_BEAT_NARRATION,
    STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER,
    STORY_NOVEL_MAX_SCENE_CHARACTERS,
    build_story_novel_instruction_card,
    parse_story_novel_beats,
    persist_story_novel_beats_for_message,
    resolve_story_novel_beats_for_read,
    serialize_story_novel_beats_for_stream,
    strip_story_novel_scene_cast_metadata,
)
from app.services.story_novel_bootstrap import ensure_story_novel_opening_scene_beats  # noqa: E402
from app.services.story_messages import story_message_to_out  # noqa: E402


class StoryNovelSceneCastContractTests(unittest.TestCase):
    def test_prompt_requires_cast_for_every_paragraph_without_changing_speaker_marker(self) -> None:
        content = build_story_novel_instruction_card()["content"]

        self.assertIn("Каждый абзац без исключения", content)
        self.assertIn("{{VN_CAST|Точный title|female|Эмоция; Другой title|male|Эмоция}}", content)
        self.assertIn("{{VN_CAST|-}}", content)
        self.assertIn("максимум три", content)
        self.assertIn("Рассказчик", content)
        self.assertIn("никогда не являются персонажами", content)
        self.assertIn("Существует строго восемь эмоций", content)
        self.assertIn("обычное описание затрагивает", content)
        self.assertIn("отсутствие карточки никогда не является причиной скрывать его из VN_CAST", content)
        self.assertIn("интерфейс сам покажет для него силуэт", content)
        self.assertIn("[[NPC:Имя]]", content)
        self.assertIn("[[GG:Имя]]", content)
        self.assertNotIn("Имя [эмоция]:", content)

    def test_parser_extracts_narration_cast_and_deduplicates_to_three(self) -> None:
        beats = parse_story_novel_beats(
            "Мия нервно переплела пальцы, а Алисия следила за дверью. "
            "{{VN_CAST|Леди Мия|female|Страх; Алисия|female|Радость; "
            "Леди Мия|female|Злость; Страж|male|Нейтральная}}"
        )

        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0].kind, STORY_NOVEL_BEAT_NARRATION)
        self.assertEqual(
            beats[0].scene_characters,
            (("Леди Мия", "scared"), ("Алисия", "happy"), ("Страж", "neutral")),
        )
        self.assertEqual(
            beats[0].scene_character_genders,
            (("Леди Мия", "female"), ("Алисия", "female"), ("Страж", "male")),
        )
        self.assertNotIn("VN_CAST", beats[0].text)

    def test_parser_never_turns_narrator_into_a_scene_character(self) -> None:
        beat = parse_story_novel_beats(
            "Леди Мия посмотрела на огонь. "
            "{{VN_CAST|Рассказчик|male|Нейтральная; Леди Мия|female|Удивление; "
            "Автор|male|Грусть}}"
        )[0]

        self.assertEqual(beat.kind, STORY_NOVEL_BEAT_NARRATION)
        self.assertEqual(beat.scene_characters, (("Леди Мия", "surprised"),))

    def test_parser_guarantees_dialogue_speaker_inside_full_cast(self) -> None:
        beat = parse_story_novel_beats(
            "[[NPC:Леди Мия]] (злость) Немедленно уходите. "
            "{{VN_CAST|Алисия|Страх; Страж|Нейтральная; Слуга|Грусть}}"
        )[0]

        self.assertEqual(beat.kind, STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(len(beat.scene_characters), STORY_NOVEL_MAX_SCENE_CHARACTERS)
        self.assertIn(("Леди Мия", "angry"), beat.scene_characters)
        self.assertEqual(beat.text, "Немедленно уходите.")

    def test_legacy_dialogue_gets_speaker_only_cast(self) -> None:
        beat = parse_story_novel_beats("[[NPC:Леди Мия]] (радость) Я здесь.")[0]
        self.assertEqual(beat.scene_characters, (("Леди Мия", "happy"),))

    def test_parser_attaches_cast_suffix_from_its_own_line(self) -> None:
        beat = parse_story_novel_beats(
            "Леди Мия нервно обернулась.\n{{VN_CAST|Леди Мия|Страх}}"
        )[0]

        self.assertEqual(beat.kind, STORY_NOVEL_BEAT_NARRATION)
        self.assertEqual(beat.text, "Леди Мия нервно обернулась.")
        self.assertEqual(beat.scene_characters, (("Леди Мия", "scared"),))

    def test_parser_keeps_wrapped_dialogue_in_one_beat(self) -> None:
        beats = parse_story_novel_beats(
            "[[NPC:Леди Мия]] (злость) Я сказала тебе:\n"
            "уходи немедленно.\n{{VN_CAST|Леди Мия|Злость}}"
        )

        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0].kind, STORY_NOVEL_BEAT_DIALOGUE)
        self.assertEqual(beats[0].text, "Я сказала тебе: уходи немедленно.")
        self.assertEqual(beats[0].scene_characters, (("Леди Мия", "angry"),))

    def test_public_text_strips_cast_but_raw_text_remains_parseable(self) -> None:
        raw = (
            "[[NPC:Леди Мия]] (злость) Уходи.\n"
            "{{VN_CAST|Леди Мия|Злость}}"
        )

        public_text = strip_story_novel_scene_cast_metadata(raw)

        self.assertNotIn("VN_CAST", public_text)
        self.assertEqual(public_text, "[[NPC:Леди Мия]] (злость) Уходи.")
        self.assertEqual(parse_story_novel_beats(raw)[0].scene_characters, (("Леди Мия", "angry"),))

    def test_cast_suffix_survives_shared_markup_sanitizer(self) -> None:
        from app.main import _sanitize_story_stream_markup_formatting

        raw = (
            "[[NPC:Леди Мия]] (злость) Уходи. "
            "{{VN_CAST|Леди Мия|Злость; Алисия|Страх}}"
        )
        sanitized = _sanitize_story_stream_markup_formatting(raw)

        self.assertEqual(sanitized, raw)
        beat = parse_story_novel_beats(sanitized)[0]
        self.assertEqual(
            beat.scene_characters,
            (("Леди Мия", "angry"), ("Алисия", "scared")),
        )


class StoryNovelSceneCastPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed(self, db):
        user = User(email="vn-cast@example.com", password_hash="test", role="administrator")
        db.add(user)
        db.flush()
        game = StoryGame(user_id=user.id, title="Cast VN", game_mode="visual_novel")
        db.add(game)
        db.flush()

        character_specs = (
            ("Леди Мия", "female", "scared", "mia-scared.png"),
            ("Алисия", "female", "happy", "alice-happy.png"),
            ("Страж", "male", "neutral", "guard-neutral.png"),
        )
        characters: dict[str, StoryCharacter] = {}
        cards: list[StoryWorldCard] = []
        for name, gender, emotion, asset in character_specs:
            character = StoryCharacter(
                user_id=user.id,
                name=name,
                description=name,
                triggers=json.dumps([name], ensure_ascii=False),
                emotion_assets=serialize_story_character_emotion_assets(
                    {emotion: f"https://cdn.example.com/{asset}"}
                ),
                novel_sprite_gender=gender,
            )
            db.add(character)
            db.flush()
            card = StoryWorldCard(
                game_id=game.id,
                title=name,
                content=name,
                triggers=json.dumps([name], ensure_ascii=False),
                kind="npc",
                character_id=character.id,
            )
            db.add(card)
            characters[name] = character
            cards.append(card)

        message = StoryMessage(game_id=game.id, role="assistant", content="scene")
        db.add(message)
        db.flush()
        return game, characters, cards, message

    def test_persist_and_read_resolve_three_cast_sprites_for_narration_and_dialogue(self) -> None:
        with self.Session() as db:
            game, characters, cards, message = self._seed(db)
            raw = (
                "Мия замерла, а Алисия ободряюще улыбнулась. "
                "{{VN_CAST|Леди Мия|female|Страх; Алисия|female|Радость}}\n\n"
                "[[NPC:Леди Мия]] (злость) Не приближайся. "
                "{{VN_CAST|Леди Мия|female|Злость; Алисия|female|Страх; "
                "Страж|male|Нейтральная}}"
            )

            rows = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=raw,
                world_cards=cards,
            )

            persisted_narration_cast = json.loads(rows[0].scene_characters_json)
            self.assertEqual(len(persisted_narration_cast), 2)
            self.assertEqual(persisted_narration_cast[0]["character_id"], characters["Леди Мия"].id)
            self.assertEqual(persisted_narration_cast[0]["gender"], "female")

            payload = serialize_story_novel_beats_for_stream(db, rows)
            narration = payload[0]
            dialogue = payload[1]
            self.assertEqual(narration["kind"], STORY_NOVEL_BEAT_NARRATION)
            self.assertEqual(len(narration["scene_characters"]), 2)
            self.assertEqual(narration["scene_characters"][0]["emotion"], "scared")
            self.assertEqual(
                narration["scene_characters"][0]["sprite_url"],
                "https://cdn.example.com/mia-scared.png",
            )
            self.assertFalse(narration["scene_characters"][0]["incognito"])
            self.assertEqual(narration["scene_characters"][0]["gender"], "female")
            self.assertEqual(len(dialogue["scene_characters"]), 3)
            self.assertIn(
                characters["Леди Мия"].id,
                {item["character_id"] for item in dialogue["scene_characters"]},
            )

    def test_missing_cast_recovers_unregistered_npc_from_same_response_speaker(self) -> None:
        with self.Session() as db:
            game, _characters, cards, message = self._seed(db)
            raw = (
                "Из тени бесшумно вышла Элина и остановилась у двери.\n\n"
                "[[NPC:Элина]] (страх) Здесь небезопасно."
            )

            rows = persist_story_novel_beats_for_message(
                db=db,
                game=game,
                assistant_message=message,
                raw_response=raw,
                world_cards=cards,
            )
            narration_cast = json.loads(rows[0].scene_characters_json)
            payload = serialize_story_novel_beats_for_stream(db, rows)

            self.assertEqual(narration_cast[0]["name"], "Элина")
            self.assertIsNone(narration_cast[0]["character_id"])
            self.assertEqual(narration_cast[0]["gender"], "female")
            self.assertEqual(
                payload[0]["scene_characters"][0]["sprite_url"],
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(payload[0]["scene_characters"][0]["incognito"])

    def test_read_adds_speaker_cast_to_legacy_database_row(self) -> None:
        with self.Session() as db:
            game, characters, cards, message = self._seed(db)
            legacy = StoryNovelBeat(
                game_id=game.id,
                message_id=message.id,
                order_index=0,
                kind="dialogue",
                speaker_name="Леди Мия",
                speaker_character_id=characters["Леди Мия"].id,
                emotion="scared",
                text="Тише.",
                scene_characters_json="[]",
            )
            db.add(legacy)
            db.flush()

            output = resolve_story_novel_beats_for_read(db, [legacy])[0]

            self.assertEqual(len(output.scene_characters), 1)
            self.assertEqual(output.scene_characters[0].character_id, characters["Леди Мия"].id)
            self.assertEqual(output.scene_characters[0].emotion, "scared")
            self.assertFalse(output.scene_characters[0].incognito)

    def test_opening_narration_without_neutral_slot_uses_gender_incognito(self) -> None:
        with self.Session() as db:
            game, characters, cards, message = self._seed(db)
            game.opening_scene = "Леди Мия замерла у двери."
            message.content = game.opening_scene
            db.add(
                StoryNovelBeat(
                    game_id=game.id,
                    message_id=message.id,
                    order_index=0,
                    kind="narration",
                    scene_characters_json="[]",
                    text=game.opening_scene,
                )
            )
            db.flush()

            result = ensure_story_novel_opening_scene_beats(
                db=db,
                game=game,
                world_cards=cards,
            )
            rows = list(
                db.scalars(
                    select(StoryNovelBeat)
                    .where(StoryNovelBeat.message_id == int(message.id))
                    .order_by(StoryNovelBeat.order_index.asc())
                ).all()
            )
            output = resolve_story_novel_beats_for_read(db, rows)[0]

            self.assertTrue(result.changed)
            self.assertEqual(len(output.scene_characters), 1)
            self.assertEqual(output.scene_characters[0].character_id, characters["Леди Мия"].id)
            self.assertEqual(output.scene_characters[0].emotion, "neutral")
            self.assertEqual(
                output.scene_characters[0].sprite_url,
                STORY_NOVEL_INCOGNITO_SPRITE_URL_BY_GENDER["female"],
            )
            self.assertTrue(output.scene_characters[0].incognito)

    def test_story_message_serializer_hides_cast_in_content_and_variants(self) -> None:
        with self.Session() as db:
            _game, _characters, _cards, message = self._seed(db)
            raw = "Мия вошла. {{VN_CAST|Леди Мия|Страх}}"
            message.content = raw
            message.variant_history_json = json.dumps(
                [{"content": raw, "created_at": "2026-07-16T00:00:00Z"}],
                ensure_ascii=False,
            )
            db.flush()

            output = story_message_to_out(message)

            self.assertNotIn("VN_CAST", output.content)
            self.assertNotIn("VN_CAST", output.variant_history[0].content)
            self.assertIn("VN_CAST", message.content)


if __name__ == "__main__":
    unittest.main()
