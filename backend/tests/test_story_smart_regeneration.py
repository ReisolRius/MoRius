from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_smart_regeneration import (  # noqa: E402
    build_smart_regeneration_instruction_card,
    build_smart_regeneration_instructions,
    normalize_smart_regeneration_mode,
    normalize_smart_regeneration_options,
)


class StorySmartRegenerationTests(unittest.TestCase):
    def test_preserve_format_is_always_enforced(self) -> None:
        options = normalize_smart_regeneration_options(["fix_language"])

        self.assertEqual(options, ["preserve_format", "fix_language"])

    def test_conflicting_length_options_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "make_shorter conflicts"):
            normalize_smart_regeneration_options(["make_shorter", "make_more_detailed"])

    def test_unknown_option_is_rejected_without_500(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown smart regeneration option"):
            normalize_smart_regeneration_options(["unknown_option"])

    def test_default_mode_is_new_variant(self) -> None:
        self.assertEqual(normalize_smart_regeneration_mode(None), "new_variant")
        self.assertEqual(normalize_smart_regeneration_mode(""), "new_variant")

    def test_unknown_mode_is_rejected_without_500(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown smart regeneration mode"):
            normalize_smart_regeneration_mode("patch_current")

    def test_instruction_order_and_output_contract_are_stable(self) -> None:
        instructions = build_smart_regeneration_instructions(
            ["remove_repetition", "stricter_facts", "fix_language"],
            mode="new_variant",
            previous_assistant_text="[[NPC:Мира]] Привет.",
        )

        self.assertIn("[[NPC:Name]]", instructions)
        self.assertIn("Предыдущий ответ:", instructions)
        self.assertLess(instructions.index("СОХРАНИТЬ ФОРМАТ РЕПЛИК"), instructions.index("СТРОЖЕ ПО ФАКТАМ"))
        self.assertLess(instructions.index("СТРОЖЕ ПО ФАКТАМ"), instructions.index("ИСПРАВИТЬ ЯЗЫК"))
        self.assertLess(instructions.index("ИСПРАВИТЬ ЯЗЫК"), instructions.index("УБРАТЬ ПОВТОР"))

    def test_new_variant_prompt_is_full_alternative_generation(self) -> None:
        instructions = build_smart_regeneration_instructions(
            ["more_dialogue"],
            mode="new_variant",
            previous_assistant_text="Старый ответ с теми же жестами.",
        )

        self.assertIn("РЕЖИМ: НОВЫЙ ВАРИАНТ", instructions)
        self.assertIn("не редактуру старого текста", instructions)
        self.assertIn("Не копируй его текст, структуру", instructions)
        self.assertIn("хотя бы одна содержательная реплика NPC".casefold(), instructions.casefold())

    def test_improve_existing_prompt_keeps_essence(self) -> None:
        instructions = build_smart_regeneration_instructions(
            ["fix_language"],
            mode="improve_existing",
            previous_assistant_text="Текущий смысл сцены.",
        )

        self.assertIn("РЕЖИМ: УЛУЧШИТЬ ТЕКУЩИЙ", instructions)
        self.assertIn("сохранив его основную суть", instructions)
        self.assertIn("Исправить только выбранные аспекты", instructions)

    def test_disabled_or_empty_request_returns_no_card(self) -> None:
        self.assertIsNone(build_smart_regeneration_instruction_card(None))
        self.assertIsNone(build_smart_regeneration_instruction_card(SimpleNamespace(enabled=True, options=[])))
        self.assertIsNone(build_smart_regeneration_instruction_card(SimpleNamespace(enabled=False, options=["fix_language"])))

    def test_enabled_request_builds_instruction_card(self) -> None:
        card = build_smart_regeneration_instruction_card(
            SimpleNamespace(enabled=True, mode="improve_existing", options=["make_shorter"]),
            previous_assistant_text="Слишком длинный ответ.",
        )

        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card["title"], "Продвинутая перегенерация")
        self.assertIn("РЕЖИМ: УЛУЧШИТЬ ТЕКУЩИЙ", card["content"])
        self.assertIn("СДЕЛАТЬ КОРОЧЕ", card["content"])
        self.assertIn("Сохрани output contract", card["content"])


if __name__ == "__main__":
    unittest.main()
