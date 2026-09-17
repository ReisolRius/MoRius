import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
import { GoogleOAuthProvider } from '@react-oauth/google'
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
          'html, body': {
            backgroundColor: activeTheme.colors.bootBackground,
            // The page gradient lives here as well as on AppBackdropGlow, so screens that are not
            // wrapped in `.morius-app-shell` - and the overscroll area on mobile - are never
            // flatly black. `fixed` keeps it pinned to the viewport while the page scrolls.
            backgroundImage: 'var(--morius-app-backdrop, none)',
            backgroundAttachment: 'fixed',
            color: activeTheme.colors.baseText,
            transition: 'background-color 180ms ease, color 180ms ease',
          },
          // Opaque here would hide the gradient above for every page at once.
          '#root': {
            backgroundColor: 'transparent',
            color: activeTheme.colors.baseText,
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
