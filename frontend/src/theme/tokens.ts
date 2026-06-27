export const moriusThemeTokens = {
  fonts: {
    primary: '"Manrope", "Segoe UI", sans-serif',
    heading: '"Spectral", "Times New Roman", serif',
  },
  colors: {
    appBackground: '#090909',
    appBase: '#090909',
    appSurface: '#17171c',
    appElevated: '#16161b',
    inputBg: '#111114',
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

export function createMoriusCssVariables(colors: MoriusThemeColors = moriusThemeTokens.colors) {
  return {
    '--accent': colors.accent,
    '--morius-app-bg': colors.appBackground,
    '--morius-app-base': colors.appBase,
    '--morius-dialog-bg': colors.dialogBg,
    '--morius-card-bg': colors.appSurface,
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
    '--morius-elevated-bg': colors.appElevated,
    '--morius-input-bg': colors.inputBg,
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
