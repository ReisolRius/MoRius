import { moriusThemeTokens, type MoriusThemeColors } from './tokens'

export const MORIUS_THEME_STORAGE_KEY = 'morius.ui.theme'

export type MoriusThemeMode = 'dark' | 'light'

export type MoriusThemeId = 'classic-dark' | 'blue-steel' | 'pastel-light' | 'gray' | 'yami-rius'

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
    'radial-gradient(ellipse 68% 38% at 50% -10%, #E6E2D9 0%, #F0ECE6 100%), linear-gradient(44deg, #E2DCCE 0%, #F0ECE6 100%)',
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
  baseText: '#000000',
}

const grayColors: MoriusThemeColors = {
  ...moriusThemeTokens.colors,
  appBackground: '#141414',
  appBase: '#141414',
  appSurface: '#242424',
  appElevated: '#242424',
  appBorder: '#323232',
  accent: '#7D9EB2',
  titleText: '#BABABA',
  textPrimary: '#BABABA',
  textSecondary: '#8F8F8F',
  buttonHover: '#2C2C2C',
  buttonActive: '#2C2C2C',
  sendButton: '#AAAAAA',
  panelGradient: 'linear-gradient(108deg, #2A2A2A 0%, #7D9EB2 100%)',
  bootBackground: '#141414',
  baseText: '#BABABA',
}

const yamiRiusColors: MoriusThemeColors = {
  ...moriusThemeTokens.colors,
  appBackground: '#292929',
  appBase: '#292929',
  appSurface: '#222222',
  appElevated: '#333333',
  appBorder: '#3A3A3A',
  accent: '#FF6666',
  titleText: '#EEEEEE',
  textPrimary: '#EEEEEE',
  textSecondary: '#CACACA',
  buttonHover: '#3A3A3A',
  buttonActive: '#3A3A3A',
  sendButton: '#FF6666',
  panelGradient: '#333333',
  bootBackground: '#292929',
  baseText: '#CACACA',
}

export const moriusThemePresets: readonly MoriusThemePreset[] = [
  {
    id: 'classic-dark',
    name: '\u041a\u043b\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0442\u0451\u043c\u043d\u0430\u044f',
    subtitle: '\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u0442\u0435\u043c\u0430',
    description: '\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u044c\u043d\u0430\u044f \u043f\u0430\u043b\u0438\u0442\u0440\u0430 Morius.',
    mode: 'dark',
    colors: classicDarkColors,
  },
  {
    id: 'blue-steel',
    name: '\u0421\u0442\u0430\u043b\u044c\u043d\u043e\u0439 \u0441\u0443\u043c\u0440\u0430\u043a',
    subtitle: '\u041d\u043e\u0432\u0430\u044f \u0442\u0451\u043c\u043d\u0430\u044f',
    description: '\u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0432 \u0445\u043e\u043b\u043e\u0434\u043d\u044b\u0435 \u0441\u0438\u043d\u0435-\u0441\u0435\u0440\u044b\u0435 \u043e\u0442\u0442\u0435\u043d\u043a\u0438.',
    mode: 'dark',
    colors: blueSteelColors,
  },
  {
    id: 'pastel-light',
    name: '\u041f\u0430\u0441\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u0441\u0432\u0435\u0442',
    subtitle: '\u0421\u0432\u0435\u0442\u043b\u0430\u044f',
    description: '\u0421\u043f\u043e\u043a\u043e\u0439\u043d\u044b\u0435 \u043f\u0430\u0441\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0442\u043e\u043d\u0430 \u0441 \u0430\u043a\u0446\u0435\u043d\u0442\u043e\u043c \u043d\u0430 \u0447\u0438\u0442\u0430\u0435\u043c\u043e\u0441\u0442\u044c.',
    mode: 'light',
    colors: pastelLightColors,
  },
  {
    id: 'gray',
    name: '\u0421\u0435\u0440\u0430\u044f',
    subtitle: '\u041d\u043e\u0432\u0430\u044f \u0442\u0451\u043c\u043d\u0430\u044f',
    description: '\u0413\u043b\u0443\u0431\u043e\u043a\u0430\u044f \u0441\u0435\u0440\u0430\u044f \u043f\u0430\u043b\u0438\u0442\u0440\u0430 \u0441 \u043f\u0440\u0438\u0433\u043b\u0443\u0448\u0451\u043d\u043d\u044b\u043c \u0430\u043a\u0446\u0435\u043d\u0442\u043e\u043c.',
    mode: 'dark',
    colors: grayColors,
  },
  {
    id: 'yami-rius',
    name: 'ЯмиРиус',
    subtitle: 'Новая тёмная',
    description: 'Контрастная темная тема без синих оттенков с акцентом #FF6666.',
    mode: 'dark',
    colors: yamiRiusColors,
  },
]

export const moriusThemePlaceholders: readonly MoriusThemePlaceholder[] = [
  {
    id: 'placeholder-twilight',
    name: '\u0421\u0443\u043c\u0435\u0440\u0435\u0447\u043d\u0430\u044f',
    description: '\u0421\u043a\u043e\u0440\u043e',
  },
  {
    id: 'placeholder-forest',
    name: '\u041b\u0435\u0441\u043d\u0430\u044f',
    description: '\u0421\u043a\u043e\u0440\u043e',
  },
  {
    id: 'placeholder-ember',
    name: '\u0422\u0451\u043f\u043b\u044b\u0439 \u044f\u043d\u0442\u0430\u0440\u044c',
    description: '\u0421\u043a\u043e\u0440\u043e',
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
