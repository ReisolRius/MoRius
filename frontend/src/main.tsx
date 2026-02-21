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
import { moriusCssVariables, moriusMuiTheme, moriusThemeTokens } from './theme'

const appNode = (
  <ThemeProvider theme={moriusMuiTheme}>
    <CssBaseline />
    <GlobalStyles
      styles={{
        ':root': moriusCssVariables,
        'html, body, #root': {
          backgroundColor: moriusThemeTokens.colors.bootBackground,
          color: moriusThemeTokens.colors.baseText,
        },
      }}
    />
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
