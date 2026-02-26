import { moriusThemeTokens, type MoriusThemeColors } from './tokens'

export const MORIUS_THEME_STORAGE_KEY = 'morius.ui.theme'

export type MoriusThemeMode = 'dark' | 'light'

export type MoriusThemeId = 'classic-dark' | 'blue-steel' | 'pastel-light'

export type MoriusThemePreset = {
  id: MoriusThemeId
  name: string
  subtitle: string
  description: string
  mode: MoriusThemeMode
  colors: MoriusThemeColors
}

export type MoriusThemePlaceholder = {
  id: string
  name: string
  description: string
}

const classicDarkColors: MoriusThemeColors = { ...moriusThemeTokens.colors }

const blueSteelColors: MoriusThemeColors = {
  ...moriusThemeTokens.colors,
  appBackground:
    'radial-gradient(ellipse 64% 30% at 50% -8%, #1C2533 0%, #0F1218 100%), linear-gradient(44deg, #1A2330 0%, #0F1218 100%)',
  appBase: '#0F1218',
  appSurface: '#15181C',
  appElevated: '#262C33',
  appBorder: '#333C47',
  accent: '#C2D1DE',
  titleText: '#DEE8F2',
  textPrimary: '#DCE6F1',
  textSecondary: '#AAB7C5',
  buttonHover: '#434E5A',
  buttonActive: '#434E5A',
  sendButton: '#C2D1DE',
  panelGradient: 'linear-gradient(108deg, #333C47 0%, #C2D1DE 100%)',
  bootBackground: '#0F1218',
  baseText: '#AAB7C5',
}

const pastelLightColors: MoriusThemeColors = {
  ...moriusThemeTokens.colors,
  appBackground:
    'radial-gradient(ellipse 68% 38% at 50% -10%, #F5F2EC 0%, #F0ECE6 100%), linear-gradient(44deg, #EEE9E0 0%, #F0ECE6 100%)',
  appBase: '#F0ECE6',
  appSurface: '#E2DCCE',
  appElevated: '#E6E2D9',
  appBorder: '#D2CCBE',
  accent: '#000000',
  titleText: '#000000',
  textPrimary: '#1A1A1A',
  textSecondary: '#000000',
  buttonHover: '#DDD7C9',
  buttonActive: '#D4CEC0',
  sendButton: '#000000',
  panelGradient: 'linear-gradient(108deg, #E2DCCE 0%, #F0ECE6 100%)',
  bootBackground: '#F0ECE6',
  baseText: '#1A1A1A',
}

export const moriusThemePresets: readonly MoriusThemePreset[] = [
  {
    id: 'classic-dark',
    name: 'Классическая тёмная',
    subtitle: 'Текущая тема',
    description: 'Оригинальная палитра Morius.',
    mode: 'dark',
    colors: classicDarkColors,
  },
  {
    id: 'blue-steel',
    name: 'Стальной сумрак',
    subtitle: 'Новая тёмная',
    description: 'Смещение в холодные сине-серые оттенки.',
    mode: 'dark',
    colors: blueSteelColors,
  },
  {
    id: 'pastel-light',
    name: 'Пастельный свет',
    subtitle: 'Светлая',
    description: 'Спокойные пастельные тона с акцентом на читаемость.',
    mode: 'light',
    colors: pastelLightColors,
  },
]

export const moriusThemePlaceholders: readonly MoriusThemePlaceholder[] = [
  {
    id: 'placeholder-twilight',
    name: 'Сумеречная',
    description: 'Скоро',
  },
  {
    id: 'placeholder-forest',
    name: 'Лесная',
    description: 'Скоро',
  },
  {
    id: 'placeholder-ember',
    name: 'Тёплый янтарь',
    description: 'Скоро',
  },
]

export const MORIUS_DEFAULT_THEME_ID: MoriusThemeId = moriusThemePresets[0].id

export function getMoriusThemeById(themeId: string | null | undefined): MoriusThemePreset {
  if (!themeId) {
    return moriusThemePresets[0]
  }

  const foundTheme = moriusThemePresets.find((theme) => theme.id === themeId)
  return foundTheme ?? moriusThemePresets[0]
}
