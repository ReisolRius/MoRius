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
  /**
   * The palette is lifted from AI Dungeon: a black page, their `core` neutral ramp for surfaces,
   * a cool-tinted translucent white for card fills and borders, and the amber `primary` accent.
   */
  colors: {
    appBackground: '#000000',
    appBase: '#000000',
    appSurface: '#1b1f22',
    appElevated: '#272c30',
    inputBg: '#1b1f22',
    inputBorder: 'rgba(199,231,255,0.13)',
    appBorder: 'rgba(199,231,255,0.13)',
    accent: '#f8ae2c',
    titleText: '#f9f7f4',
    textPrimary: '#f9f7f4',
    textSecondary: '#828a92',
    buttonHover: '#272c30',
    buttonActive: '#1b1f22',
    sendButton: '#f8ae2c',
    panelGradient: '#1b1f22',
    bootBackground: '#000000',
    baseText: '#afafaf',
    dialogBg: '#131313',
  },
  legacyColors: {
    appBackground: '#090909',
    appBase: '#090909',
    appSurface: '#17171c',
    appElevated: '#16161b',
    inputBg: '#111114',
    inputBorder: 'rgba(255,255,255,0.09)',
    appBorder: 'rgba(255,255,255,0.07)',
    accent: '#f8ae2c',
    titleText: '#fbf9f4',
    textPrimary: '#f3f1ec',
    textSecondary: '#9b9aa0',
    buttonHover: 'rgba(255,255,255,0.06)',
    buttonActive: 'color-mix(in srgb, #f8ae2c 11%, transparent)',
    sendButton: '#f8ae2c',
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
      '--morius-gold': '#deab27',
      '--morius-rating-gold': '#deab27',
      '--morius-gold-gradient': '#deab27',
      '--morius-neutral-shadow': '0 22px 46px -20px rgba(0,0,0,0.75)',
      '--morius-accent-gradient': colors.accent,
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
    '--morius-menu-border': 'rgba(199,231,255,0.13)',
    // Cards are a cool-tinted translucent white over the black page, the way AI Dungeon fills them.
    '--morius-card-gradient': 'linear-gradient(180deg, rgba(199,231,255,0.145), rgba(199,231,255,0.115))',
    '--morius-card-alt-gradient': 'linear-gradient(180deg, rgba(199,231,255,0.115), rgba(199,231,255,0.09))',
    '--morius-chip-bg': 'rgba(199,231,255,0.06)',
    '--morius-chip-border': 'rgba(199,231,255,0.13)',
    '--morius-divider-color': 'rgba(199,231,255,0.1)',
    '--morius-hover-border': 'rgba(219,241,255,0.22)',
    '--morius-muted-text': '#666d75',
    '--morius-quiet-text': '#586067',
    '--morius-gold': '#deab27',
    '--morius-rating-gold': '#deab27',
    '--morius-gold-gradient': '#deab27',
    '--morius-neutral-shadow': '0 30px 70px -40px rgba(0,0,0,0.9)',
    '--morius-accent-gradient': colors.accent,
    '--morius-accent-shadow': 'none',
    '--morius-glass-bg': 'rgba(1,6,10,0.7)',
    '--morius-dialog-gradient': 'linear-gradient(180deg, #1b1f22, #131313)',
    '--morius-menu-gradient': 'linear-gradient(180deg, #272c30, #1b1f22)',
    '--morius-backdrop': 'rgba(0, 0, 0, 0.72)',
    '--morius-inset-bg': 'rgba(199,231,255,0.05)',
    '--morius-accent-soft': `color-mix(in oklab, ${colors.accent} 14%, transparent)`,
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
