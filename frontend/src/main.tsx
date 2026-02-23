import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
import { GoogleOAuthProvider } from '@react-oauth/google'
import '@fontsource/nunito-sans/400.css'
import '@fontsource/nunito-sans/600.css'
import '@fontsource/nunito-sans/700.css'
import './index.css'
import App from './App.tsx'
import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from './config/env'
import { MoriusThemeProvider, useMoriusThemeController } from './theme'

function ThemedApp() {
  const { activeTheme, cssVariables, muiTheme } = useMoriusThemeController()

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          ':root': cssVariables,
          'html, body, #root': {
            backgroundColor: activeTheme.colors.bootBackground,
            color: activeTheme.colors.baseText,
            transition: 'background-color 180ms ease, color 180ms ease',
          },
        }}
      />
      <App />
    </ThemeProvider>
  )
}

const appNode = (
  <MoriusThemeProvider>
    <ThemedApp />
  </MoriusThemeProvider>
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
