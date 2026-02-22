import { createTheme } from '@mui/material'
import { moriusThemeTokens } from './tokens'

export const moriusMuiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: moriusThemeTokens.colors.accent,
    },
    secondary: {
      main: moriusThemeTokens.colors.textSecondary,
    },
    background: {
      default: moriusThemeTokens.colors.appBase,
      paper: moriusThemeTokens.colors.appSurface,
    },
    text: {
      primary: moriusThemeTokens.colors.textPrimary,
      secondary: moriusThemeTokens.colors.textSecondary,
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
      color: moriusThemeTokens.colors.titleText,
    },
    h2: {
      fontSize: `${moriusThemeTokens.typography.subheadingSize}px`,
      fontWeight: 700,
      color: moriusThemeTokens.colors.titleText,
    },
    body1: {
      fontSize: `${moriusThemeTokens.typography.bodySize}px`,
      color: moriusThemeTokens.colors.textSecondary,
    },
    body2: {
      fontSize: `${moriusThemeTokens.typography.bodySize}px`,
      color: moriusThemeTokens.colors.textSecondary,
    },
    button: {
      textTransform: 'none',
      fontWeight: 700,
      color: moriusThemeTokens.colors.accent,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: moriusThemeTokens.radii.app,
          borderColor: moriusThemeTokens.colors.appBorder,
          borderWidth: `${moriusThemeTokens.borders.width}px`,
          backgroundColor: moriusThemeTokens.colors.appSurface,
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
          border: `${moriusThemeTokens.borders.width}px solid ${moriusThemeTokens.colors.appBorder}`,
          color: moriusThemeTokens.colors.accent,
          backgroundColor: moriusThemeTokens.colors.appElevated,
          '&:hover': {
            backgroundColor: moriusThemeTokens.colors.buttonHover,
          },
          '&:active': {
            backgroundColor: moriusThemeTokens.colors.buttonActive,
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
          border: `${moriusThemeTokens.borders.width}px solid ${moriusThemeTokens.colors.appBorder}`,
          backgroundColor: moriusThemeTokens.colors.appElevated,
          color: moriusThemeTokens.colors.accent,
          '&:hover': {
            backgroundColor: moriusThemeTokens.colors.buttonHover,
            borderColor: moriusThemeTokens.colors.appBorder,
          },
          '&:active': {
            backgroundColor: moriusThemeTokens.colors.buttonActive,
            borderColor: moriusThemeTokens.colors.appBorder,
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: moriusThemeTokens.radii.button,
          backgroundColor: moriusThemeTokens.colors.appElevated,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: moriusThemeTokens.colors.appBorder,
            borderWidth: `${moriusThemeTokens.borders.width}px`,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: moriusThemeTokens.radii.app,
          border: `${moriusThemeTokens.borders.width}px solid ${moriusThemeTokens.colors.appBorder}`,
          backgroundColor: moriusThemeTokens.colors.appSurface,
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
          border: `${moriusThemeTokens.borders.width}px solid ${moriusThemeTokens.colors.appBorder}`,
        },
      },
    },
  },
})
