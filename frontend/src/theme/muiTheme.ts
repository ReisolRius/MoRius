import { createTheme } from '@mui/material'
import { moriusThemeTokens, type MoriusThemeColors, type MoriusThemeSurface } from './tokens'

export function createMoriusMuiTheme(
  colors: MoriusThemeColors = moriusThemeTokens.colors,
  mode: 'dark' | 'light' = 'dark',
  surface: MoriusThemeSurface = 'app',
) {
  const isLegacySurface = surface === 'legacy'
  const fonts = isLegacySurface ? moriusThemeTokens.legacyFonts : moriusThemeTokens.fonts
  const inputBorderColor = colors.inputBorder ?? (colors.appBorder === 'transparent' ? 'transparent' : colors.appBorder)
  const inputBorderWidth = inputBorderColor === 'transparent' ? '0px' : `${moriusThemeTokens.borders.width}px`
  const menuBackground = isLegacySurface ? 'linear-gradient(180deg, #1a1a1e, #141417)' : 'var(--morius-menu-gradient)'
  const tooltipBackground = isLegacySurface ? colors.appSurface : '#343844'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: colors.accent,
      },
      secondary: {
        main: colors.textSecondary,
      },
      background: {
        default: colors.appBase,
        paper: colors.appSurface,
      },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
    },
    shape: {
      borderRadius: moriusThemeTokens.radii.app,
    },
    typography: {
      fontFamily: fonts.primary,
      h1: {
        fontSize: `${moriusThemeTokens.typography.headingSize}px`,
        fontFamily: fonts.heading,
        fontWeight: isLegacySurface ? 700 : 600,
        lineHeight: 1.1,
        letterSpacing: 0,
        color: colors.titleText,
      },
      h2: {
        fontSize: `${moriusThemeTokens.typography.subheadingSize}px`,
        fontFamily: fonts.heading,
        fontWeight: isLegacySurface ? 700 : 600,
        lineHeight: 1.2,
        letterSpacing: 0,
        color: colors.titleText,
      },
      body1: {
        fontSize: `${moriusThemeTokens.typography.bodySize}px`,
        lineHeight: 1.5,
        letterSpacing: 0,
        fontWeight: 400,
        color: colors.textSecondary,
      },
      body2: {
        fontSize: '14px',
        lineHeight: 1.5,
        letterSpacing: 0,
        fontWeight: 400,
        color: colors.textSecondary,
      },
      button: {
        textTransform: 'none',
        fontSize: '15px',
        lineHeight: 1.35,
        fontWeight: isLegacySurface ? 700 : 600,
        color: colors.accent,
      },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: moriusThemeTokens.radii.app,
            borderColor: colors.appBorder,
            borderWidth: `${moriusThemeTokens.borders.width}px`,
            background: 'var(--morius-card-gradient)',
          },
        },
      },
      MuiButtonBase: {
        defaultProps: {
          disableRipple: true,
          disableTouchRipple: true,
        },
      },
      MuiIconButton: {
        defaultProps: {
          disableRipple: true,
        },
        styleOverrides: {
          root: {
            width: `${moriusThemeTokens.layout.actionButtonSize}px`,
            height: `${moriusThemeTokens.layout.actionButtonSize}px`,
            borderRadius: moriusThemeTokens.radii.button,
            // Buttons are borderless by design: rely on a light background tint for affordance.
            border: 'none',
            color: colors.textSecondary,
            backgroundColor: colors.appElevated,
            '&:hover': {
              backgroundColor: colors.buttonHover,
              color: colors.titleText,
            },
            '&:active': {
              backgroundColor: colors.buttonActive,
              color: colors.titleText,
            },
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableRipple: true,
        },
        styleOverrides: {
          root: {
            borderRadius: moriusThemeTokens.radii.button,
            minHeight: `${moriusThemeTokens.layout.actionButtonSize}px`,
            padding: '10px 20px',
            // Buttons are borderless by design: rely on a light background tint for affordance.
            border: 'none',
            backgroundColor: colors.appElevated,
            color: colors.accent,
            '&:hover': {
              backgroundColor: colors.buttonHover,
              color: colors.titleText,
            },
            '&:active': {
              backgroundColor: colors.buttonActive,
              color: colors.titleText,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: moriusThemeTokens.radii.button,
            backgroundColor: colors.inputBg,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: inputBorderColor,
              borderWidth: inputBorderWidth,
            },
            ...(isLegacySurface
              ? {}
              : {
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255,255,255,0.18)',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: `color-mix(in oklab, ${colors.accent} 70%, transparent)`,
                  },
                }),
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: isLegacySurface ? moriusThemeTokens.radii.app : 22,
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${isLegacySurface ? colors.appBorder : 'rgba(255,255,255,0.1)'}`,
            backgroundColor: 'var(--morius-dialog-bg) !important',
            ...(isLegacySurface ? {} : { backgroundImage: 'var(--morius-dialog-gradient)' }),
          },
        },
      },
      MuiBackdrop: {
        styleOverrides: {
          root: isLegacySurface
            ? {}
            : {
                '&:not(.MuiBackdrop-invisible)': {
                  backgroundColor: 'var(--morius-backdrop)',
                  backdropFilter: 'blur(10px)',
                },
              },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            paddingLeft: 'var(--morius-content-gap)',
            paddingRight: 'var(--morius-content-gap)',
            paddingTop: 'var(--morius-title-top-gap)',
            paddingBottom: 'var(--morius-title-bottom-gap)',
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            paddingLeft: 'var(--morius-content-gap)',
            paddingRight: 'var(--morius-content-gap)',
            paddingTop: 0,
            paddingBottom: 'var(--morius-content-gap)',
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            paddingLeft: 'var(--morius-content-gap)',
            paddingRight: 'var(--morius-content-gap)',
            paddingTop: 0,
            paddingBottom: 'var(--morius-content-gap)',
            gap: 'var(--morius-content-gap)',
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: isLegacySurface ? moriusThemeTokens.radii.app : 11,
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${isLegacySurface ? colors.appBorder : 'rgba(255,255,255,0.1)'}`,
            backgroundColor: tooltipBackground,
            color: colors.textPrimary,
            fontSize: '13px',
            lineHeight: 1.4,
            boxShadow: '0 16px 38px rgba(0, 0, 0, 0.44)',
          },
          arrow: {
            color: tooltipBackground,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: moriusThemeTokens.radii.menu,
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${isLegacySurface ? colors.appBorder : 'rgba(255,255,255,0.1)'}`,
            background: menuBackground,
            boxShadow: '0 30px 70px -20px rgba(0,0,0,0.85)',
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            backgroundColor: 'transparent',
            borderBottom: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
          },
          indicator: {
            backgroundColor: colors.accent,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            color: colors.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            '&.Mui-selected': {
              backgroundColor: colors.appElevated,
              color: colors.accent,
            },
            '&:hover': {
              backgroundColor: colors.appElevated,
              color: colors.accent,
            },
          },
        },
      },
    },
  })
}

export const moriusMuiTheme = createMoriusMuiTheme()
