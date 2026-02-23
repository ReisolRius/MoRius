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

type MoriusThemeControllerValue = {
  themeId: MoriusThemeId
  activeTheme: MoriusThemePreset
  cssVariables: ReturnType<typeof createMoriusCssVariables>
  muiTheme: ReturnType<typeof createMoriusMuiTheme>
  themes: readonly MoriusThemePreset[]
  placeholders: typeof moriusThemePlaceholders
  setTheme: (themeId: MoriusThemeId) => void
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

type MoriusThemeProviderProps = {
  children: ReactNode
}

export function MoriusThemeProvider({ children }: MoriusThemeProviderProps) {
  const [themeId, setThemeId] = useState<MoriusThemeId>(() => readInitialThemeId())

  const activeTheme = useMemo(() => getMoriusThemeById(themeId), [themeId])
  const cssVariables = useMemo(() => createMoriusCssVariables(activeTheme.colors), [activeTheme.colors])
  const muiTheme = useMemo(() => createMoriusMuiTheme(activeTheme.colors, activeTheme.mode), [activeTheme.colors, activeTheme.mode])

  useEffect(() => {
    try {
      window.localStorage.setItem(MORIUS_THEME_STORAGE_KEY, activeTheme.id)
    } catch {
      // Ignore localStorage failures (private mode / strict browser policies).
    }
  }, [activeTheme.id])

  const setTheme = useCallback((nextThemeId: MoriusThemeId) => {
    setThemeId(getMoriusThemeById(nextThemeId).id)
  }, [])

  const value = useMemo<MoriusThemeControllerValue>(
    () => ({
      themeId: activeTheme.id,
      activeTheme,
      cssVariables,
      muiTheme,
      themes: moriusThemePresets,
      placeholders: moriusThemePlaceholders,
      setTheme,
    }),
    [activeTheme, cssVariables, muiTheme, setTheme],
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
