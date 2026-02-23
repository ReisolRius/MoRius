import { createTheme } from '@mui/material'
import { moriusThemeTokens, type MoriusThemeColors } from './tokens'

export function createMoriusMuiTheme(colors: MoriusThemeColors = moriusThemeTokens.colors, mode: 'dark' | 'light' = 'dark') {
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
            border: `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            color: colors.accent,
            backgroundColor: colors.appElevated,
            '&:hover': {
              backgroundColor: colors.buttonHover,
            },
            '&:active': {
              backgroundColor: colors.buttonActive,
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
            border: `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            backgroundColor: colors.appElevated,
            color: colors.accent,
            '&:hover': {
              backgroundColor: colors.buttonHover,
              borderColor: colors.appBorder,
            },
            '&:active': {
              backgroundColor: colors.buttonActive,
              borderColor: colors.appBorder,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: moriusThemeTokens.radii.button,
            backgroundColor: colors.appElevated,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: colors.appBorder,
              borderWidth: `${moriusThemeTokens.borders.width}px`,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: moriusThemeTokens.radii.app,
            border: `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
            backgroundColor: colors.appSurface,
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
            border: `${moriusThemeTokens.borders.width}px solid ${colors.appBorder}`,
          },
        },
      },
    },
  })
}

export const moriusMuiTheme = createMoriusMuiTheme()
