import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createMoriusMuiTheme } from './muiTheme'
import {
  MORIUS_DEFAULT_THEME_ID,
  MORIUS_LEGACY_THEME_ID,
  getMoriusThemeById,
  type MoriusThemeId,
  type MoriusThemePreset,
} from './presets'
import { createMoriusCssVariables, type MoriusThemeSurface } from './tokens'

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

const STORY_HISTORY_FONT_FAMILY_OPTIONS: readonly StoryHistoryFontFamilyOption[] = [
  {
    id: 'default',
    title: 'Onest',
    cssFontFamily: '"Onest", "Segoe UI", sans-serif',
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
  surface: MoriusThemeSurface
  setSurface: (surface: MoriusThemeSurface) => void
  cssVariables: ReturnType<typeof createMoriusCssVariables>
  muiTheme: ReturnType<typeof createMoriusMuiTheme>
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

/**
 * The presentation landing and the auth screen stay on the pre-redesign look. Resolving the
 * surface from the URL up front keeps those screens from flashing the new palette on first paint;
 * App then keeps it in sync with whatever page it actually renders.
 */
function readInitialSurface(): MoriusThemeSurface {
  if (typeof window === 'undefined') {
    return 'app'
  }
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/'
  return pathname === '/' || pathname === '/auth' || pathname.startsWith('/ref/') ? 'legacy' : 'app'
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
  const [storyHistoryFontFamily, setStoryHistoryFontFamilyState] = useState<StoryHistoryFontFamilyId>(
    () => readInitialStoryHistoryFontFamilyId(),
  )
  const [storyHistoryFontWeight, setStoryHistoryFontWeightState] = useState<StoryHistoryFontWeightId>(
    () => readInitialStoryHistoryFontWeightId(),
  )
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState<boolean>(() => readInitialVoiceInputEnabled())
  const [surface, setSurfaceState] = useState<MoriusThemeSurface>(() => readInitialSurface())

  const activeTheme = useMemo(
    () => getMoriusThemeById(surface === 'legacy' ? MORIUS_LEGACY_THEME_ID : MORIUS_DEFAULT_THEME_ID),
    [surface],
  )
  const cssVariables = useMemo(() => createMoriusCssVariables(activeTheme.colors, surface), [activeTheme.colors, surface])
  const muiTheme = useMemo(
    () => createMoriusMuiTheme(activeTheme.colors, activeTheme.mode, surface),
    [activeTheme.colors, activeTheme.mode, surface],
  )

  useEffect(() => {
    try {
      const root = document.documentElement
      root.setAttribute('data-morius-theme', activeTheme.id)
      root.setAttribute('data-morius-surface', surface)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', surface === 'legacy' ? '#0b0b0d' : activeTheme.colors.appBase)
    } catch {
      // Ignore in case of SSR or other restrictions
    }
  }, [activeTheme.colors.appBase, activeTheme.id, surface])

  const setSurface = useCallback((nextSurface: MoriusThemeSurface) => {
    setSurfaceState(nextSurface === 'legacy' ? 'legacy' : 'app')
  }, [])

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
      surface,
      setSurface,
      cssVariables,
      muiTheme,
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
      surface,
      setSurface,
      cssVariables,
      muiTheme,
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
