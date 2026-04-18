import { getMoriusThemeById, type MoriusThemePreset } from './presets'
import type { MoriusThemeColors } from './tokens'

type CustomThemePalette = {
  title_text: string
  text_primary: string
  background: string
  surface: string
  front: string
  input: string
}

type CustomThemeStory = {
  corrected_text_color: string
  player_text_color: string
  assistant_text_color: string
}

type CustomThemeLike = {
  id: string
  name: string
  description: string
  palette: CustomThemePalette
  story: CustomThemeStory
}

type DialogBgThemeColorSource = Partial<Pick<MoriusThemeColors, 'dialogBg' | 'appBase' | 'appSurface' | 'inputBg'>>

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null
  }

  const normalized = trimmed.toUpperCase()
  if (normalized.length === 4) {
    const [, r, g, b] = normalized
    return `#${r}${r}${g}${g}${b}${b}`
  }

  return normalized
}

function toLinearChannel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function calculateRelativeLuminance(hexColor: string): number {
  const r = Number.parseInt(hexColor.slice(1, 3), 16)
  const g = Number.parseInt(hexColor.slice(3, 5), 16)
  const b = Number.parseInt(hexColor.slice(5, 7), 16)

  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b)
}

function resolveDarkestHexColor(candidateValues: Array<string | null | undefined>, fallback: string): string {
  const normalizedCandidates = candidateValues
    .map((candidateValue) => normalizeHexColor(candidateValue))
    .filter((candidateValue): candidateValue is string => Boolean(candidateValue))

  if (normalizedCandidates.length === 0) {
    return fallback
  }

  return normalizedCandidates.reduce((darkestColor, candidateColor) =>
    calculateRelativeLuminance(candidateColor) < calculateRelativeLuminance(darkestColor)
      ? candidateColor
      : darkestColor,
  )
}

export function resolveDialogBgFromPalette(palette: CustomThemePalette, fallback: string): string {
  return resolveDarkestHexColor([palette.background, palette.surface, palette.input], fallback)
}

export function resolveDialogBgFromThemeColors(colors: DialogBgThemeColorSource, fallback: string): string {
  return resolveDarkestHexColor([colors.dialogBg, colors.appBase, colors.appSurface, colors.inputBg], fallback)
}

export function buildPresetFromCustomTheme(theme: CustomThemeLike): MoriusThemePreset {
  const fallback = getMoriusThemeById('classic-dark')

  return {
    ...fallback,
    id: theme.id,
    name: theme.name,
    subtitle: 'Пользовательская тема',
    description: theme.description || 'Пользовательская палитра',
    colors: {
      ...fallback.colors,
      titleText: theme.palette.title_text,
      textPrimary: theme.palette.text_primary,
      textSecondary: theme.story.player_text_color,
      appBackground: theme.palette.background,
      appBase: theme.palette.background,
      appSurface: theme.palette.surface,
      appElevated: theme.palette.surface,
      inputBg: theme.palette.input,
      accent: theme.palette.front,
      sendButton: theme.palette.front,
      panelGradient: theme.palette.surface,
      bootBackground: theme.palette.background,
      baseText: theme.story.player_text_color,
      dialogBg: resolveDialogBgFromPalette(theme.palette, fallback.colors.dialogBg),
    },
    story: {
      correctedTextColor: theme.story.corrected_text_color,
      playerTextColor: theme.story.player_text_color,
      assistantTextColor: theme.story.assistant_text_color,
    },
  }
}
