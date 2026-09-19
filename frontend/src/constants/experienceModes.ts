import type { ExperienceMode } from '../utils/experienceMode'

/**
 * One description of the two modes, shared by the welcome dialog and the Сложность tab in the
 * profile settings - so the promise made on the first screen is the promise the settings keep.
 */
export type ExperienceModePreset = {
  id: ExperienceMode
  /** Short label for the settings tab and the switch confirmation. */
  label: string
  /** Headline on the welcome card. */
  title: string
  /** One line under the headline. */
  tagline: string
  /** What the player gets, spelled out. */
  bullets: string[]
}

export const EXPERIENCE_MODE_PRESETS: ExperienceModePreset[] = [
  {
    id: 'novice',
    label: 'Простой',
    title: 'Я новичок',
    tagline: 'Первый раз в ролевой игре с ИИ. Хочу лёгкий старт без лишних настроек.',
    bullets: [
      'В игре остаётся только главное: рассказчик, художник, память и персонажи',
      'Длину ответа, мысли NPC и печать настраиваем за вас',
      'Показываем короткую инструкцию, где что находится',
    ],
  },
  {
    id: 'expert',
    label: 'Продвинутый',
    title: 'Я опытный',
    tagline: 'Знаю толк в РП с ИИ: разбираюсь в моделях, промптах и настройках.',
    bullets: [
      'Полная панель рассказчика: рассуждение, длина ответа, память контекста',
      'Движок, модули времени и погоды, ноды и стиль изображений',
      'Никаких подсказок — сразу к игре',
    ],
  },
]

export const DEFAULT_EXPERIENCE_MODE: ExperienceMode = 'expert'

/** The one line that has to appear wherever the choice is offered. */
export const EXPERIENCE_MODE_SWITCH_HINT =
  'Режим можно поменять в любой момент: профиль → настройки → Сложность.'

export function getExperienceModePreset(mode: ExperienceMode): ExperienceModePreset {
  return EXPERIENCE_MODE_PRESETS.find((preset) => preset.id === mode) ?? EXPERIENCE_MODE_PRESETS[1]
}
