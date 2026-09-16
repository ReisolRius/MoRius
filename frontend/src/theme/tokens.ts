export type MoriusThemeSurface = 'app' | 'legacy'

export const moriusThemeTokens = {
  fonts: {
    primary: '"Onest", "Segoe UI", sans-serif',
    heading: '"Literata", Georgia, "Times New Roman", serif',
  },
  /** The presentation landing and the auth screen keep the pre-redesign typography. */
  legacyFonts: {
    primary: '"Manrope", "Segoe UI", sans-serif',
    heading: '"Spectral", "Times New Roman", serif',
  },
  colors: {
    appBackground: '#151820',
    appBase: '#151820',
    appSurface: '#2b2f37',
    appElevated: '#292d34',
    inputBg: '#252931',
    inputBorder: 'rgba(255,255,255,0.1)',
    appBorder: 'rgba(255,255,255,0.09)',
    accent: '#6d70e8',
    titleText: '#edeff5',
    textPrimary: '#e4e7ef',
    textSecondary: '#a9b0c0',
    buttonHover: 'rgba(255,255,255,0.09)',
    buttonActive: 'color-mix(in srgb, #6d70e8 18%, transparent)',
    sendButton: '#6d70e8',
    panelGradient: '#292d36',
    bootBackground: '#151820',
    baseText: '#a9b0c0',
    dialogBg: '#2c3039',
  },
  legacyColors: {
    appBackground: '#090909',
    appBase: '#090909',
    appSurface: '#17171c',
    appElevated: '#16161b',
    inputBg: '#111114',
    inputBorder: 'rgba(255,255,255,0.09)',
    appBorder: 'rgba(255,255,255,0.07)',
    accent: '#4c8dff',
    titleText: '#fbf9f4',
    textPrimary: '#f3f1ec',
    textSecondary: '#9b9aa0',
    buttonHover: 'rgba(255,255,255,0.06)',
    buttonActive: 'color-mix(in srgb, #4c8dff 11%, transparent)',
    sendButton: '#4c8dff',
    panelGradient: '#121216',
    bootBackground: '#090909',
    baseText: '#9b9aa0',
    dialogBg: '#111114',
  },
  radii: {
    app: 14,
    button: 12,
    menu: 18,
  },
  borders: {
    width: 1,
  },
  typography: {
    headingSize: 40,
    subheadingSize: 26,
    bodySize: 14,
  },
  layout: {
    headerHeight: 66,
    headerTopOffset: 11,
    headerSideOffset: 20,
    headerMenuTop: 66,
    headerMenuWidthXs: 252,
    headerMenuWidthMd: 276,
    headerButtonSize: 44,
    headerLogoWidth: 86,
    interfaceGap: 20,
    sectionGap: 20,
    cardsToTitleGap: 40,
    actionButtonSize: 40,
    actionIconSize: 20,
    storyRightCardPadding: 10,
    storyMessageGap: 20,
    iconGap: 20,
    scrollbarOffset: 10,
    contentGap: 20,
    titleTopGap: 24,
    titleBottomGap: 14,
    menuVerticalGap: 10,
    ratingStarGap: 10,
  },
} as const

export type MoriusThemeColors = {
  appBackground: string
  appBase: string
  appSurface: string
  appElevated: string
  inputBg: string
  inputBorder?: string
  appBorder: string
  accent: string
  titleText: string
  textPrimary: string
  textSecondary: string
  buttonHover: string
  buttonActive: string
  sendButton: string
  panelGradient: string
  bootBackground: string
  baseText: string
  dialogBg: string
}

/**
 * Decorative values that are not derived from a palette: card gradients, glass, the gold of the
 * currency. The redesigned app and the untouched legacy screens each get their own set.
 */
function resolveSurfaceDecor(colors: MoriusThemeColors, surface: MoriusThemeSurface) {
  if (surface === 'legacy') {
    return {
      '--morius-font-ui': moriusThemeTokens.legacyFonts.primary,
      '--morius-font-heading': moriusThemeTokens.legacyFonts.heading,
      '--morius-heading-weight': '700',
      '--morius-menu-border': 'rgba(255,255,255,0.09)',
      '--morius-card-gradient': 'linear-gradient(180deg, #17171c, #121216)',
      '--morius-card-alt-gradient': 'linear-gradient(180deg, #16161b, #111114)',
      '--morius-chip-bg': 'rgba(255,255,255,0.03)',
      '--morius-chip-border': 'rgba(255,255,255,0.06)',
      '--morius-divider-color': 'rgba(255,255,255,0.05)',
      '--morius-hover-border': 'rgba(255,255,255,0.18)',
      '--morius-muted-text': '#7d7c83',
      '--morius-quiet-text': '#6e6d74',
      '--morius-gold': '#cda659',
      '--morius-rating-gold': '#d8a64a',
      '--morius-gold-gradient': 'linear-gradient(135deg, #ecd596, #cca251)',
      '--morius-neutral-shadow': '0 22px 46px -20px rgba(0,0,0,0.75)',
      '--morius-accent-gradient': `linear-gradient(180deg, color-mix(in srgb, ${colors.accent} 82%, #ffffff 18%), ${colors.accent})`,
      '--morius-accent-shadow': 'none',
      '--morius-glass-bg': 'linear-gradient(180deg, rgba(11,11,13,0.94), rgba(11,11,13,0.66))',
      '--morius-dialog-gradient': 'linear-gradient(180deg, #17171c, #111114)',
      '--morius-menu-gradient': 'linear-gradient(180deg, #1a1a1e, #141417)',
      '--morius-backdrop': 'rgba(2, 5, 10, 0.76)',
      '--morius-inset-bg': 'rgba(255,255,255,0.03)',
      '--morius-accent-soft': `color-mix(in srgb, ${colors.accent} 11%, transparent)`,
      '--morius-accent-border': `color-mix(in srgb, ${colors.accent} 32%, transparent)`,
    } as const
  }
  return {
    '--morius-font-ui': moriusThemeTokens.fonts.primary,
    '--morius-font-heading': moriusThemeTokens.fonts.heading,
    '--morius-heading-weight': '600',
    '--morius-menu-border': 'rgba(255,255,255,0.1)',
    '--morius-card-gradient': 'linear-gradient(165deg, #2f343d, #282c34)',
    '--morius-card-alt-gradient': 'linear-gradient(165deg, #2e333c, #282c34)',
    '--morius-chip-bg': 'rgba(255,255,255,0.04)',
    '--morius-chip-border': 'rgba(255,255,255,0.08)',
    '--morius-divider-color': 'rgba(255,255,255,0.07)',
    '--morius-hover-border': 'rgba(255,255,255,0.18)',
    '--morius-muted-text': '#8d95a8',
    '--morius-quiet-text': '#7e869a',
    '--morius-gold': '#e3c07f',
    '--morius-rating-gold': '#e3c07f',
    '--morius-gold-gradient': 'linear-gradient(135deg, #e3c07f, #c9a05e)',
    '--morius-neutral-shadow': '0 30px 70px -40px rgba(0,0,0,0.9)',
    '--morius-accent-gradient': `linear-gradient(135deg, ${colors.accent}, color-mix(in oklab, ${colors.accent} 72%, #14161d))`,
    '--morius-accent-shadow': `0 8px 22px -10px color-mix(in oklab, ${colors.accent} 90%, transparent)`,
    '--morius-glass-bg': 'rgba(33,36,44,0.78)',
    '--morius-dialog-gradient': 'linear-gradient(170deg, #333845, #292d36)',
    '--morius-menu-gradient': 'linear-gradient(170deg, #343945, #2a2e37)',
    '--morius-backdrop': 'rgba(14, 15, 19, 0.72)',
    '--morius-inset-bg': 'rgba(255,255,255,0.04)',
    '--morius-accent-soft': `color-mix(in oklab, ${colors.accent} 12%, rgba(255,255,255,0.03))`,
    '--morius-accent-border': `color-mix(in oklab, ${colors.accent} 40%, transparent)`,
  } as const
}

export function createMoriusCssVariables(
  colors: MoriusThemeColors = moriusThemeTokens.colors,
  surface: MoriusThemeSurface = 'app',
) {
  return {
    '--accent': colors.accent,
    '--morius-app-bg': colors.appBackground,
    '--morius-app-base': colors.appBase,
    '--morius-dialog-bg': colors.dialogBg,
    '--morius-card-bg': colors.appSurface,
    ...resolveSurfaceDecor(colors, surface),
    '--morius-elevated-bg': colors.appElevated,
    '--morius-input-bg': colors.inputBg,
    '--morius-input-border': colors.inputBorder ?? colors.appBorder,
    '--morius-card-border': colors.appBorder,
    '--morius-accent': colors.accent,
    '--morius-title-text': colors.titleText,
    '--morius-text-primary': colors.textPrimary,
    '--morius-text-secondary': colors.textSecondary,
    '--morius-button-hover': colors.buttonHover,
    '--morius-button-active': colors.buttonActive,
    '--morius-send-button-bg': colors.sendButton,
    '--morius-panel-gradient': colors.panelGradient,
    '--morius-radius': `${moriusThemeTokens.radii.app}px`,
    '--morius-border-width': `${moriusThemeTokens.borders.width}px`,
    '--morius-heading-size': `${moriusThemeTokens.typography.headingSize}px`,
    '--morius-subheading-size': `${moriusThemeTokens.typography.subheadingSize}px`,
    '--morius-body-size': `${moriusThemeTokens.typography.bodySize}px`,
    '--morius-header-height': `${moriusThemeTokens.layout.headerHeight}px`,
    '--morius-header-top-offset': `${moriusThemeTokens.layout.headerTopOffset}px`,
    '--morius-header-side-offset': `${moriusThemeTokens.layout.headerSideOffset}px`,
    '--morius-header-menu-top': `${moriusThemeTokens.layout.headerMenuTop}px`,
    '--morius-interface-gap': `${moriusThemeTokens.layout.interfaceGap}px`,
    '--morius-section-gap': `${moriusThemeTokens.layout.sectionGap}px`,
    '--morius-cards-title-gap': `${moriusThemeTokens.layout.cardsToTitleGap}px`,
    '--morius-action-size': `${moriusThemeTokens.layout.actionButtonSize}px`,
    '--morius-action-icon-size': `${moriusThemeTokens.layout.actionIconSize}px`,
    '--morius-story-right-padding': `${moriusThemeTokens.layout.storyRightCardPadding}px`,
    '--morius-story-message-gap': `${moriusThemeTokens.layout.storyMessageGap}px`,
    '--morius-icon-gap': `${moriusThemeTokens.layout.iconGap}px`,
    '--morius-scrollbar-offset': `${moriusThemeTokens.layout.scrollbarOffset}px`,
    '--morius-content-gap': `${moriusThemeTokens.layout.contentGap}px`,
    '--morius-title-top-gap': `${moriusThemeTokens.layout.titleTopGap}px`,
    '--morius-title-bottom-gap': `${moriusThemeTokens.layout.titleBottomGap}px`,
    '--morius-menu-vertical-gap': `${moriusThemeTokens.layout.menuVerticalGap}px`,
    '--morius-rating-star-gap': `${moriusThemeTokens.layout.ratingStarGap}px`,
  } as const
}

export const moriusCssVariables = createMoriusCssVariables()
