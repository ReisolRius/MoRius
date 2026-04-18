import { createTheme } from '@mui/material'
import { moriusThemeTokens, type MoriusThemeColors } from './tokens'

export function createMoriusMuiTheme(colors: MoriusThemeColors = moriusThemeTokens.colors, mode: 'dark' | 'light' = 'dark') {
  const inputBorderColor = colors.inputBorder ?? (colors.appBorder === 'transparent' ? 'transparent' : colors.appBorder)
  const inputBorderWidth = inputBorderColor === 'transparent' ? '0px' : `${moriusThemeTokens.borders.width}px`

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
      fontFamily: moriusThemeTokens.fonts.primary,
      h1: {
        fontSize: `${moriusThemeTokens.typography.headingSize}px`,
        fontWeight: 700,
        color: colors.titleText,
      },
      h2: {
        fontSize: `${moriusThemeTokens.typography.subheadingSize}px`,
        fontWeight: 700,
        color: colors.titleText,
      },
      body1: {
        fontSize: `${moriusThemeTokens.typography.bodySize}px`,
        color: colors.textSecondary,
      },
      body2: {
        fontSize: `${moriusThemeTokens.typography.bodySize}px`,
        color: colors.textSecondary,
      },
      button: {
        textTransform: 'none',
        fontWeight: 700,
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
            backgroundColor: colors.appSurface,
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
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            color: colors.textSecondary,
            backgroundColor: colors.appBorder === 'transparent' ? colors.appElevated : colors.appElevated,
            '&:hover': {
              backgroundColor: colors.appBorder === 'transparent' ? colors.appElevated : 'transparent',
              color: colors.accent,
            },
            '&:active': {
              backgroundColor: colors.appBorder === 'transparent' ? colors.appElevated : 'transparent',
              color: colors.accent,
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
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            backgroundColor: colors.appElevated,
            color: colors.accent,
            '&:hover': {
              backgroundColor: colors.appBorder === 'transparent' ? colors.appElevated : 'transparent',
              color: colors.accent,
              borderColor: colors.appBorder,
            },
            '&:active': {
              backgroundColor: colors.appBorder === 'transparent' ? colors.appElevated : 'transparent',
              color: colors.accent,
              borderColor: colors.appBorder,
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
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: moriusThemeTokens.radii.app,
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            backgroundColor: 'var(--morius-dialog-bg) !important',
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
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: moriusThemeTokens.radii.menu,
            border: colors.appBorder === 'transparent' ? 'none' : `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            backgroundColor: colors.appSurface,
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
