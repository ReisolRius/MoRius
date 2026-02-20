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
      main: '#DBDDE7',
    },
    secondary: {
      main: '#A4ADB6',
    },
    background: {
      default: '#111111',
      paper: '#15181C',
    },
    text: {
      primary: '#DBDDE7',
      secondary: '#A4ADB6',
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
          border: '1px solid #31302E',
          backgroundColor: '#15181C',
          color: '#DBDDE7',
          '&:hover': {
            backgroundColor: '#1D2738',
            borderColor: '#445672',
          },
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
