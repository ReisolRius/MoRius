import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { getCurrentUser } from './services/authApi'
import { brandLogo, heroBackground } from './assets'
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from './constants/legalDocuments'
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
  return (
    pathname === '/home' ||
    pathname.startsWith('/home/') ||
    pathname === '/dashboard' ||
    pathname === '/games' ||
    pathname.startsWith('/games/') ||
    pathname === '/worlds/new' ||
    /^\/worlds\/\d+\/edit$/.test(pathname)
  )
}

function isLegalPath(pathname: string): boolean {
  return pathname === '/privacy-policy' || pathname === '/terms-of-service'
}

function extractStoryGameId(pathname: string): number | null {
  const match = /^\/home\/(\d+)$/.exec(pathname)
  if (!match) {
    return null
  }

  const parsed = Number.parseInt(match[1], 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function extractWorldEditGameId(pathname: string): number | null {
  const match = /^\/worlds\/(\d+)\/edit$/.exec(pathname)
  if (!match) {
    return null
  }

  const parsed = Number.parseInt(match[1], 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null
  }
  return parsed
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
const PublicLandingPage = lazy(() => import('./pages/PublicLandingPage'))
const AuthenticatedHomePage = lazy(() => import('./pages/AuthenticatedHomePage'))
const StoryGamePage = lazy(() => import('./pages/StoryGamePage'))
const MyGamesPage = lazy(() => import('./pages/MyGamesPage'))
const CommunityWorldsPage = lazy(() => import('./pages/CommunityWorldsPage'))
const WorldCreatePage = lazy(() => import('./pages/WorldCreatePage'))
const LegalDocumentPage = lazy(() => import('./pages/LegalDocumentPage'))

function BootSplash({ message }: { message: string }) {
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
        <Typography sx={{ color: 'text.secondary' }}>{message}</Typography>
      </Stack>
    </Box>
  )
}

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
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((targetPath: string, options?: { replace?: boolean }) => {
    const normalizedTarget = normalizePath(targetPath)
    if (normalizePath(window.location.pathname) !== normalizedTarget) {
      if (options?.replace) {
        window.history.replaceState({}, '', normalizedTarget)
      } else {
        window.history.pushState({}, '', normalizedTarget)
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setPath(normalizedTarget)
  }, [])

  const resetSession = useCallback(() => {
    clearAuthSession()
    setAuthToken(null)
    setAuthUser(null)
    setIsHydratingSession(false)
  }, [])

  useEffect(() => {
    if (!authToken) {
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
          navigate('/', { replace: true })
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
  }, [authToken, navigate, path, resetSession])

  useEffect(() => {
    if (isHydratingSession || !authToken || !authUser) {
      return
    }

    if (!isAuthenticatedPath(path) && !isLegalPath(path)) {
      const redirectId = window.setTimeout(() => {
        navigate('/dashboard', { replace: true })
      }, 0)
      return () => window.clearTimeout(redirectId)
    }
  }, [authToken, authUser, isHydratingSession, navigate, path])

  useEffect(() => {
    const isAuthenticated = Boolean(authToken && authUser)
    if (isHydratingSession || isAuthenticated) {
      return
    }

    if (isAuthenticatedPath(path)) {
      const redirectId = window.setTimeout(() => {
        navigate('/', { replace: true })
      }, 0)
      return () => window.clearTimeout(redirectId)
    }
  }, [authToken, authUser, isHydratingSession, navigate, path])

  const handleAuthSuccess = useCallback(
    (payload: AuthResponse) => {
      persistAuthSession(payload)
      setAuthToken(payload.access_token)
      setAuthUser(payload.user)
      setIsHydratingSession(false)
      navigate('/dashboard')
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
  const initialGameId = extractStoryGameId(path)
  const worldEditGameId = extractWorldEditGameId(path)
  const shouldShowStoryGamePage = isAuthenticated && (path === '/home' || path.startsWith('/home/'))
  const shouldShowDashboardPage = isAuthenticated && path === '/dashboard'
  const shouldShowMyGamesPage = isAuthenticated && path === '/games'
  const shouldShowCommunityWorldsPage = isAuthenticated && path === '/games/all'
  const shouldShowWorldCreatePage = isAuthenticated && (path === '/worlds/new' || worldEditGameId !== null)
  const shouldShowPrivacyPolicyPage = path === '/privacy-policy'
  const shouldShowTermsPage = path === '/terms-of-service'
  const shouldShowBootScreen = isBootSplashActive || isHydratingSession

  if (shouldShowBootScreen) {
    return <BootSplash message="Checking session..." />
  }

  if (shouldShowPrivacyPolicyPage) {
    return (
      <Suspense fallback={<BootSplash message="Loading document..." />}>
        <LegalDocumentPage
          title="Политика конфиденциальности"
          content={PRIVACY_POLICY_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  }

  if (shouldShowTermsPage) {
    return (
      <Suspense fallback={<BootSplash message="Loading document..." />}>
        <LegalDocumentPage
          title="Пользовательское соглашение"
          content={TERMS_OF_SERVICE_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  }

  if (shouldShowStoryGamePage && authUser) {
    return (
      <Suspense fallback={<BootSplash message="Loading interface..." />}>
        <StoryGamePage
          user={authUser}
          authToken={authToken!}
          initialGameId={initialGameId}
          onNavigate={navigate}
          onLogout={handleLogout}
          onUserUpdate={handleUserUpdate}
        />
      </Suspense>
    )
  }

  if (shouldShowMyGamesPage && authUser) {
    return (
      <Suspense fallback={<BootSplash message="Loading interface..." />}>
        <MyGamesPage
          user={authUser}
          authToken={authToken!}
          mode="my"
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  }

  if (shouldShowCommunityWorldsPage && authUser) {
    return (
      <Suspense fallback={<BootSplash message="Loading interface..." />}>
        <CommunityWorldsPage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  }

  if (shouldShowDashboardPage && authUser) {
    return (
      <Suspense fallback={<BootSplash message="Loading interface..." />}>
        <AuthenticatedHomePage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  }

  if (shouldShowWorldCreatePage && authUser) {
    return (
      <Suspense fallback={<BootSplash message="Loading interface..." />}>
        <WorldCreatePage
          user={authUser}
          authToken={authToken!}
          editingGameId={worldEditGameId}
          onNavigate={navigate}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<BootSplash message="Loading interface..." />}>
      <PublicLandingPage
        isAuthenticated={isAuthenticated}
        onNavigate={navigate}
        onGoHome={() => navigate('/dashboard')}
        onAuthSuccess={handleAuthSuccess}
      />
    </Suspense>
  )
}

export default App



