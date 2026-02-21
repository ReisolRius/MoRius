export const moriusThemeTokens = {
  fonts: {
    primary: '"Nunito Sans", "Segoe UI", sans-serif',
  },
  colors: {
    appBackground: 'radial-gradient(circle at 50% -24%, #141f2d 0%, #111111 62%)',
    appSurface: '#15181c',
    appBorder: '#31302e',
    textPrimary: '#dbdde7',
    textSecondary: '#a4adb6',
    buttonHover: '#1d2738',
    buttonActive: '#25354d',
    bootBackground: '#040507',
    baseText: '#ecf1f8',
  },
  radii: {
    app: 14,
    button: 12,
    menu: 14,
  },
  layout: {
    headerHeight: 74,
    headerTopOffset: 12,
    headerSideOffset: 20,
    headerMenuTop: 82,
    headerMenuWidthXs: 252,
    headerMenuWidthMd: 276,
    headerButtonSize: 44,
    headerLogoWidth: 76,
  },
} as const

export const moriusCssVariables = {
  '--morius-app-bg': moriusThemeTokens.colors.appBackground,
  '--morius-card-bg': moriusThemeTokens.colors.appSurface,
  '--morius-card-border': moriusThemeTokens.colors.appBorder,
  '--morius-text-primary': moriusThemeTokens.colors.textPrimary,
  '--morius-text-secondary': moriusThemeTokens.colors.textSecondary,
  '--morius-button-hover': moriusThemeTokens.colors.buttonHover,
  '--morius-button-active': moriusThemeTokens.colors.buttonActive,
  '--morius-header-height': `${moriusThemeTokens.layout.headerHeight}px`,
  '--morius-header-top-offset': `${moriusThemeTokens.layout.headerTopOffset}px`,
  '--morius-header-side-offset': `${moriusThemeTokens.layout.headerSideOffset}px`,
  '--morius-header-menu-top': `${moriusThemeTokens.layout.headerMenuTop}px`,
} as const

