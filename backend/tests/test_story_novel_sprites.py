from __future__ import annotations

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
            # Happy was not uploaded, so the documented neutral/any fallback still yields
            # the linked hero's real sprite rather than an incognito silhouette.
            self.assertEqual(payload["sprite_url"], "https://cdn.example.com/mia-neutral.png")
            self.assertFalse(payload["sprite_incognito"])


if __name__ == "__main__":
    unittest.main()
