import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { GoogleOAuthProvider } from '@react-oauth/google'
import '@fontsource/nunito-sans/400.css'
import '@fontsource/nunito-sans/600.css'
import '@fontsource/nunito-sans/700.css'
import './index.css'
import App from './App.tsx'
import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from './config/env'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#d9e4f2',
    },
    secondary: {
      main: '#9c7a4c',
    },
    background: {
      default: '#040507',
      paper: '#0d1016',
    },
    text: {
      primary: '#ecf1f8',
      secondary: 'rgba(223, 229, 239, 0.74)',
    },
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
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
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: '10px 22px',
        },
      },
    },
  },
})

const appNode = (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {IS_GOOGLE_AUTH_CONFIGURED && GOOGLE_CLIENT_ID ? (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{appNode}</GoogleOAuthProvider>
    ) : (
      appNode
    )}
  </StrictMode>,
)
