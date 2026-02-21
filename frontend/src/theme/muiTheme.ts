import { createTheme } from '@mui/material'
import { moriusThemeTokens } from './tokens'

export const moriusMuiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: moriusThemeTokens.colors.textPrimary,
    },
    secondary: {
      main: moriusThemeTokens.colors.textSecondary,
    },
    background: {
      default: '#111111',
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
      fontWeight: 700,
    },
    h2: {
      fontWeight: 700,
    },
    button: {
      textTransform: 'none',
      fontWeight: 700,
    },
  },
  components: {
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
    },
    MuiButton: {
      defaultProps: {
        disableRipple: true,
      },
      styleOverrides: {
        root: {
          borderRadius: moriusThemeTokens.radii.button,
          padding: '10px 22px',
          border: `1px solid ${moriusThemeTokens.colors.appBorder}`,
          backgroundColor: moriusThemeTokens.colors.appSurface,
          color: moriusThemeTokens.colors.textPrimary,
          '&:hover': {
            backgroundColor: moriusThemeTokens.colors.buttonHover,
            borderColor: '#445672',
          },
        },
      },
    },
  },
})

