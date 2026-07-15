from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import story_games, story_generate  # noqa: E402
from app.services import story_generation_provider  # noqa: E402


class StoryRouterSpeakerPromptTests(unittest.TestCase):
    def test_fallback_story_prompt_requires_specific_stable_npc_speakers(self) -> None:
        messages = story_generate._fallback_build_provider_messages(
            game=None,
            prompt="Осматриваюсь.",
            context_messages=[],
            instruction_cards=[],
            plot_cards=[],
            world_cards=[
                {"kind": "main_hero", "title": "Айри", "content": "Главная героиня."},
                {"kind": "npc", "title": "Леди Эвелина", "content": "Аристократка."},
            ],
            context_limit_chars=12_000,
        )

        system_prompt = messages[0]["content"]
        self.assertIn("точный title карточки", system_prompt)
        self.assertIn("до первой реплики придумай естественное устойчивое имя", system_prompt)
        self.assertIn("длиной не более 4 слов", system_prompt)
        self.assertIn("всегда начинается с [[NPC:...]]", system_prompt)
        self.assertIn("НПС, NPC, Голос, Незнакомец и Персонаж", system_prompt)
        self.assertIn("Known NPC names: Леди Эвелина", system_prompt)
        self.assertIn("Known GG names: Айри", system_prompt)

    def test_quick_start_opening_scene_prompt_requires_morius_speaker_markers(self) -> None:
        captured_messages: list[list[dict[str, str]]] = []

        def fake_request(messages: list[dict[str, str]], **_: object) -> str:
            captured_messages.append(messages)
            if len(captured_messages) == 1:
                return (
                    '{"game_title":"Пепельный тракт","game_description":"Начало пути.",'
                    '"hero_description":"Айри — молодая следопытка.",'
                    '"hero_triggers":["Айри","следопытка","тракт","пепел"]}'
                )
            return '{"opening_scene":"Туман стелется по тракту.\\n\\n[[NPC:Марек]] Стойте!"}'

        with patch.object(story_generation_provider, "_request_polza_story_text", side_effect=fake_request):
            payload = story_games._generate_story_quick_start_payload(
                genre="тёмное фэнтези",
                hero_class="следопытка",
                protagonist_name="Айри",
                start_mode="action",
            )

        self.assertEqual(len(captured_messages), 2)
        scene_prompt = "\n".join(message["content"] for message in captured_messages[1])
        self.assertIn("every spoken line or included thought", scene_prompt)
        self.assertIn("[[NPC_THOUGHT:Name]]", scene_prompt)
        self.assertIn("Before a new NPC's first line, invent a natural stable name", scene_prompt)
        self.assertIn("no more than 4 words", scene_prompt)
        self.assertIn("Every NPC line", scene_prompt)
        self.assertIn("НПС, NPC, Голос, Незнакомец", scene_prompt)
        self.assertEqual(payload["opening_scene"], "Туман стелется по тракту.\n\n[[NPC:Марек]] Стойте!")


if __name__ == "__main__":
    unittest.main()
