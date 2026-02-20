import { useCallback, useEffect, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import PublicLandingPage from './pages/PublicLandingPage'
import AuthenticatedHomePage from './pages/AuthenticatedHomePage'
import StoryGamePage from './pages/StoryGamePage'
import { getCurrentUser } from './services/authApi'
import { brandLogo, heroBackground } from './assets'
import type { AuthResponse, AuthUser } from './types/auth'

const TOKEN_STORAGE_KEY = 'morius.auth.token'
const USER_STORAGE_KEY = 'morius.auth.user'
const MIN_BOOT_SPLASH_MS = 650

type AuthSession = {
  token: string | null
  user: AuthUser | null
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '').toLowerCase()
  return normalized || '/'
}

function isAuthenticatedPath(pathname: string): boolean {
  return pathname === '/home' || pathname.startsWith('/home/') || pathname === '/dashboard'
}

function loadAuthSession(): AuthSession {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    const rawUser = localStorage.getItem(USER_STORAGE_KEY)
    const user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null
    return { token, user }
  } catch {
    return { token: null, user: null }
  }
}

function persistAuthSession(payload: AuthResponse): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, payload.access_token)
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user))
}

function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(USER_STORAGE_KEY)
}

const initialSession = loadAuthSession()

function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname))
  const [authToken, setAuthToken] = useState<string | null>(initialSession.token)
  const [authUser, setAuthUser] = useState<AuthUser | null>(initialSession.user)
  const [isHydratingSession, setIsHydratingSession] = useState(Boolean(initialSession.token))
  const [isBootSplashActive, setIsBootSplashActive] = useState(true)

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsBootSplashActive(false), MIN_BOOT_SPLASH_MS)
    return () => window.clearTimeout(timerId)
  }, [])

  useEffect(() => {
    const handlePopState = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((targetPath: string) => {
    const normalizedTarget = normalizePath(targetPath)
    if (normalizePath(window.location.pathname) !== normalizedTarget) {
      window.history.pushState({}, '', normalizedTarget)
    }
    setPath(normalizedTarget)
  }, [])

  const resetSession = useCallback(() => {
    clearAuthSession()
    setAuthToken(null)
    setAuthUser(null)
  }, [])

  useEffect(() => {
    if (!authToken) {
      setIsHydratingSession(false)
      return
    }

    let active = true
    getCurrentUser(authToken)
      .then((user) => {
        if (!active) {
          return
        }
        setAuthUser(user)
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
      })
      .catch(() => {
        if (!active) {
          return
        }
        resetSession()
        if (isAuthenticatedPath(path)) {
          window.history.replaceState({}, '', '/')
          setPath('/')
        }
      })
      .finally(() => {
        if (active) {
          setIsHydratingSession(false)
        }
      })

    return () => {
      active = false
    }
  }, [authToken, path, resetSession])

  useEffect(() => {
    if (isHydratingSession || !authToken || !authUser) {
      return
    }

    if (!isAuthenticatedPath(path)) {
      window.history.replaceState({}, '', '/home')
      setPath('/home')
    }
  }, [authToken, authUser, isHydratingSession, path])

  useEffect(() => {
    const isAuthenticated = Boolean(authToken && authUser)
    if (isHydratingSession || isAuthenticated) {
      return
    }

    if (isAuthenticatedPath(path)) {
      window.history.replaceState({}, '', '/')
      setPath('/')
    }
  }, [authToken, authUser, isHydratingSession, path])

  const handleAuthSuccess = useCallback(
    (payload: AuthResponse) => {
      persistAuthSession(payload)
      setAuthToken(payload.access_token)
      setAuthUser(payload.user)
      setIsHydratingSession(false)
      navigate('/home')
    },
    [navigate],
  )

  const handleLogout = useCallback(() => {
    resetSession()
    navigate('/')
  }, [navigate, resetSession])

  const handleUserUpdate = useCallback((nextUser: AuthUser) => {
    setAuthUser(nextUser)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser))
  }, [])

  const isAuthenticated = Boolean(authToken && authUser)
  const shouldShowStoryGamePage = isAuthenticated && (path === '/home' || path.startsWith('/home/'))
  const shouldShowDashboardPage = isAuthenticated && path === '/dashboard'
  const shouldShowBootScreen = isBootSplashActive || isHydratingSession

  if (shouldShowBootScreen) {
    return (
      <Box
        sx={{
          minHeight: '100svh',
          backgroundColor: '#040507',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(180deg, rgba(3, 5, 8, 0.84) 0%, rgba(3, 5, 8, 0.96) 100%), url(${heroBackground})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            opacity: 0.52,
            filter: 'saturate(0.72)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 50% 30%, rgba(195, 121, 44, 0.2) 0%, rgba(195, 121, 44, 0.06) 36%, transparent 72%)',
          }}
        />
        <Stack
          alignItems="center"
          spacing={2}
          sx={{
            position: 'relative',
            zIndex: 1,
            animation: 'morius-fade-up 460ms ease both',
          }}
        >
          <Box component="img" src={brandLogo} alt="Morius" sx={{ width: { xs: 200, md: 250 }, mb: 0.3 }} />
          <CircularProgress
            size={34}
            thickness={4.2}
            sx={{
              color: '#d9e4f2',
            }}
          />
          <Typography sx={{ color: 'text.secondary' }}>Проверяем вашу сессию...</Typography>
        </Stack>
      </Box>
    )
  }

  if (shouldShowStoryGamePage && authUser) {
    return (
      <StoryGamePage
        user={authUser}
        authToken={authToken!}
        onNavigate={navigate}
        onLogout={handleLogout}
        onUserUpdate={handleUserUpdate}
      />
    )
  }

  if (shouldShowDashboardPage && authUser) {
    return (
      <AuthenticatedHomePage
        user={authUser}
        authToken={authToken!}
        onNavigate={navigate}
        onUserUpdate={handleUserUpdate}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <PublicLandingPage
      isAuthenticated={isAuthenticated}
      onGoHome={() => navigate('/home')}
      onAuthSuccess={handleAuthSuccess}
    />
  )
}

export default App
