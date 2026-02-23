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
    'radial-gradient(ellipse 68% 38% at 50% -10%, #DEE7F2 0%, #EFF3F8 100%), linear-gradient(44deg, #E3EAF4 0%, #F5F8FC 100%)',
  appBase: '#ECF1F7',
  appSurface: '#F7FAFD',
  appElevated: '#EAF0F7',
  appBorder: '#C2CFDD',
  accent: '#50657B',
  titleText: '#243141',
  textPrimary: '#2B3A4A',
  textSecondary: '#5D6D7E',
  buttonHover: '#D7E1ED',
  buttonActive: '#C9D5E5',
  sendButton: '#5C738C',
  panelGradient: 'linear-gradient(108deg, #CED9E8 0%, #F7FAFD 100%)',
  bootBackground: '#ECF1F7',
  baseText: '#5D6D7E',
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
