import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createMoriusMuiTheme } from './muiTheme'
import {
  MORIUS_DEFAULT_THEME_ID,
  MORIUS_THEME_STORAGE_KEY,
  getMoriusThemeById,
  moriusThemePlaceholders,
  moriusThemePresets,
  type MoriusThemeId,
  type MoriusThemePreset,
} from './presets'
import { createMoriusCssVariables } from './tokens'

export type StoryHistoryFontFamilyId = 'default' | 'inter' | 'verdana'
export type StoryHistoryFontWeightId = 'regular' | 'medium' | 'bold'

type StoryHistoryFontFamilyOption = {
  id: StoryHistoryFontFamilyId
  title: string
  cssFontFamily: string
}

type StoryHistoryFontWeightOption = {
  id: StoryHistoryFontWeightId
  title: string
  cssFontWeight: number
}

export const STORY_HISTORY_FONT_FAMILY_STORAGE_KEY = 'morius.story.history-font-family'
export const STORY_HISTORY_FONT_WEIGHT_STORAGE_KEY = 'morius.story.history-font-weight'
export const VOICE_INPUT_ENABLED_STORAGE_KEY = 'morius.story.voice-input-enabled'
export const MORIUS_CUSTOM_THEME_STORAGE_KEY = 'morius.ui.custom-theme'

const STORY_HISTORY_FONT_FAMILY_OPTIONS: readonly StoryHistoryFontFamilyOption[] = [
  {
    id: 'default',
    title: 'Nunito Sans',
    cssFontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
  },
  {
    id: 'inter',
    title: 'Inter',
    cssFontFamily: '"Inter", "Segoe UI", sans-serif',
  },
  {
    id: 'verdana',
    title: 'Verdana',
    cssFontFamily: 'Verdana, "Segoe UI", sans-serif',
  },
]

const STORY_HISTORY_FONT_WEIGHT_OPTIONS: readonly StoryHistoryFontWeightOption[] = [
  {
    id: 'regular',
    title: 'Regular',
    cssFontWeight: 400,
  },
  {
    id: 'medium',
    title: 'Medium',
    cssFontWeight: 500,
  },
  {
    id: 'bold',
    title: 'Bold',
    cssFontWeight: 700,
  },
]

function normalizeStoryHistoryFontFamilyId(value: string | null | undefined): StoryHistoryFontFamilyId {
  const normalized = (value ?? '').trim() as StoryHistoryFontFamilyId
  if (STORY_HISTORY_FONT_FAMILY_OPTIONS.some((option) => option.id === normalized)) {
    return normalized
  }
  return 'default'
}

function normalizeStoryHistoryFontWeightId(value: string | null | undefined): StoryHistoryFontWeightId {
  const normalized = (value ?? '').trim() as StoryHistoryFontWeightId
  if (STORY_HISTORY_FONT_WEIGHT_OPTIONS.some((option) => option.id === normalized)) {
    return normalized
  }
  return 'regular'
}

type MoriusThemeControllerValue = {
  themeId: MoriusThemeId
  activeTheme: MoriusThemePreset
  customTheme: MoriusThemePreset | null
  cssVariables: ReturnType<typeof createMoriusCssVariables>
  muiTheme: ReturnType<typeof createMoriusMuiTheme>
  themes: readonly MoriusThemePreset[]
  placeholders: typeof moriusThemePlaceholders
  setTheme: (themeId: MoriusThemeId) => void
  setCustomTheme: (theme: MoriusThemePreset | null) => void
  storyHistoryFontFamily: StoryHistoryFontFamilyId
  storyHistoryFontWeight: StoryHistoryFontWeightId
  voiceInputEnabled: boolean
  storyHistoryFontFamilyOptions: readonly StoryHistoryFontFamilyOption[]
  storyHistoryFontWeightOptions: readonly StoryHistoryFontWeightOption[]
  setStoryHistoryFontFamily: (fontFamily: StoryHistoryFontFamilyId) => void
  setStoryHistoryFontWeight: (fontWeight: StoryHistoryFontWeightId) => void
  setVoiceInputEnabled: (enabled: boolean) => void
}

const MoriusThemeControllerContext = createContext<MoriusThemeControllerValue | null>(null)

function readInitialThemeId(): MoriusThemeId {
  if (typeof window === 'undefined') {
    return MORIUS_DEFAULT_THEME_ID
  }

  try {
    const rawThemeId = window.localStorage.getItem(MORIUS_THEME_STORAGE_KEY)
    return getMoriusThemeById(rawThemeId).id
  } catch {
    return MORIUS_DEFAULT_THEME_ID
  }
}

function readInitialStoryHistoryFontFamilyId(): StoryHistoryFontFamilyId {
  if (typeof window === 'undefined') {
    return 'default'
  }

  try {
    return normalizeStoryHistoryFontFamilyId(window.localStorage.getItem(STORY_HISTORY_FONT_FAMILY_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

function readInitialStoryHistoryFontWeightId(): StoryHistoryFontWeightId {
  if (typeof window === 'undefined') {
    return 'regular'
  }

  try {
    return normalizeStoryHistoryFontWeightId(window.localStorage.getItem(STORY_HISTORY_FONT_WEIGHT_STORAGE_KEY))
  } catch {
    return 'regular'
  }
}

function readInitialCustomTheme(): MoriusThemePreset | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(MORIUS_CUSTOM_THEME_STORAGE_KEY)
    if (!rawValue) {
      return null
    }
    const parsed = JSON.parse(rawValue) as Partial<MoriusThemePreset> | null
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string' || typeof parsed.name !== 'string') {
      return null
    }
    const baseTheme = getMoriusThemeById('classic-dark')
    return {
      ...baseTheme,
      id: parsed.id,
      name: parsed.name,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : 'Пользовательская тема',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      mode: parsed.mode === 'light' ? 'light' : 'dark',
      colors: {
        ...baseTheme.colors,
        ...(parsed.colors ?? {}),
      },
      story:
        parsed.story && typeof parsed.story === 'object'
          ? {
              correctedTextColor:
                typeof (parsed.story as { correctedTextColor?: unknown }).correctedTextColor === 'string'
                  ? (parsed.story as { correctedTextColor: string }).correctedTextColor
                  : baseTheme.story?.correctedTextColor ?? baseTheme.colors.accent,
              playerTextColor:
                typeof (parsed.story as { playerTextColor?: unknown }).playerTextColor === 'string'
                  ? (parsed.story as { playerTextColor: string }).playerTextColor
                  : baseTheme.story?.playerTextColor ?? baseTheme.colors.textSecondary,
              assistantTextColor:
                typeof (parsed.story as { assistantTextColor?: unknown }).assistantTextColor === 'string'
                  ? (parsed.story as { assistantTextColor: string }).assistantTextColor
                  : baseTheme.story?.assistantTextColor ?? baseTheme.colors.textPrimary,
            }
          : baseTheme.story,
    }
  } catch {
    return null
  }
}

function readInitialVoiceInputEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const rawValue = window.localStorage.getItem(VOICE_INPUT_ENABLED_STORAGE_KEY)
    if (rawValue === '0') {
      return false
    }
    if (rawValue === '1') {
      return true
    }
    return false
  } catch {
    return false
  }
}

type MoriusThemeProviderProps = {
  children: ReactNode
}

export function MoriusThemeProvider({ children }: MoriusThemeProviderProps) {
  const [themeId, setThemeId] = useState<MoriusThemeId>(() => readInitialThemeId())
  const [customTheme, setCustomThemeState] = useState<MoriusThemePreset | null>(() => readInitialCustomTheme())
  const [storyHistoryFontFamily, setStoryHistoryFontFamilyState] = useState<StoryHistoryFontFamilyId>(
    () => readInitialStoryHistoryFontFamilyId(),
  )
  const [storyHistoryFontWeight, setStoryHistoryFontWeightState] = useState<StoryHistoryFontWeightId>(
    () => readInitialStoryHistoryFontWeightId(),
  )
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState<boolean>(() => readInitialVoiceInputEnabled())

  const activeTheme = useMemo(() => {
    if (customTheme && customTheme.id === themeId) {
      return customTheme
    }
    return getMoriusThemeById(themeId)
  }, [customTheme, themeId])
  const cssVariables = useMemo(() => createMoriusCssVariables(activeTheme.colors), [activeTheme.colors])
  const muiTheme = useMemo(() => createMoriusMuiTheme(activeTheme.colors, activeTheme.mode), [activeTheme.colors, activeTheme.mode])

  useEffect(() => {
    try {
      window.localStorage.setItem(MORIUS_THEME_STORAGE_KEY, activeTheme.id)
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [activeTheme.id])

  useEffect(() => {
    try {
      if (!customTheme) {
        window.localStorage.removeItem(MORIUS_CUSTOM_THEME_STORAGE_KEY)
        return
      }
      window.localStorage.setItem(MORIUS_CUSTOM_THEME_STORAGE_KEY, JSON.stringify(customTheme))
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [customTheme])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORY_HISTORY_FONT_FAMILY_STORAGE_KEY, storyHistoryFontFamily)
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [storyHistoryFontFamily])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORY_HISTORY_FONT_WEIGHT_STORAGE_KEY, storyHistoryFontWeight)
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [storyHistoryFontWeight])

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_INPUT_ENABLED_STORAGE_KEY, voiceInputEnabled ? '1' : '0')
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [voiceInputEnabled])

  const setTheme = useCallback((nextThemeId: MoriusThemeId) => {
    setThemeId(getMoriusThemeById(nextThemeId).id)
  }, [])

  const setCustomTheme = useCallback((nextTheme: MoriusThemePreset | null) => {
    setCustomThemeState(nextTheme)
    if (nextTheme) {
      setThemeId(nextTheme.id)
      return
    }
    setThemeId(MORIUS_DEFAULT_THEME_ID)
  }, [])

  const setStoryHistoryFontFamily = useCallback((nextFontFamily: StoryHistoryFontFamilyId) => {
    setStoryHistoryFontFamilyState(normalizeStoryHistoryFontFamilyId(nextFontFamily))
  }, [])

  const setStoryHistoryFontWeight = useCallback((nextFontWeight: StoryHistoryFontWeightId) => {
    setStoryHistoryFontWeightState(normalizeStoryHistoryFontWeightId(nextFontWeight))
  }, [])

  const setVoiceInputEnabled = useCallback((nextEnabled: boolean) => {
    setVoiceInputEnabledState(Boolean(nextEnabled))
  }, [])

  const value = useMemo<MoriusThemeControllerValue>(
    () => ({
      themeId: activeTheme.id,
      activeTheme,
      customTheme,
      cssVariables,
      muiTheme,
      themes: moriusThemePresets,
      placeholders: moriusThemePlaceholders,
      setTheme,
      setCustomTheme,
      storyHistoryFontFamily,
      storyHistoryFontWeight,
      voiceInputEnabled,
      storyHistoryFontFamilyOptions: STORY_HISTORY_FONT_FAMILY_OPTIONS,
      storyHistoryFontWeightOptions: STORY_HISTORY_FONT_WEIGHT_OPTIONS,
      setStoryHistoryFontFamily,
      setStoryHistoryFontWeight,
      setVoiceInputEnabled,
    }),
    [
      activeTheme,
      customTheme,
      cssVariables,
      muiTheme,
      setTheme,
      setCustomTheme,
      storyHistoryFontFamily,
      storyHistoryFontWeight,
      voiceInputEnabled,
      setStoryHistoryFontFamily,
      setStoryHistoryFontWeight,
      setVoiceInputEnabled,
    ],
  )

  return <MoriusThemeControllerContext.Provider value={value}>{children}</MoriusThemeControllerContext.Provider>
}

export function useMoriusThemeController(): MoriusThemeControllerValue {
  const context = useContext(MoriusThemeControllerContext)
  if (!context) {
    throw new Error('useMoriusThemeController must be used inside MoriusThemeProvider')
  }

  return context
}
