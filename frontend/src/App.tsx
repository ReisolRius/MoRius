import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentUser } from './services/authApi'
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from './constants/legalDocuments'
import ProfilePage from './pages/ProfilePage'
import type { AuthResponse, AuthUser } from './types/auth'

const TOKEN_STORAGE_KEY = 'morius.auth.token'
const USER_STORAGE_KEY = 'morius.auth.user'
const YANDEX_METRIKA_ID = 106989437
const SCROLLBAR_ACTIVE_CLASS = 'morius-scroll-active'
const SCROLLBAR_HIDE_DELAY_MS = 2000

type AuthSession = {
  token: string | null
  user: AuthUser | null
}

function resolveScrollTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target
  }
  if (target instanceof Document) {
    const scrollingElement = target.scrollingElement ?? target.documentElement
    return scrollingElement instanceof HTMLElement ? scrollingElement : null
  }
  return null
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
    pathname === '/profile' ||
    /^\/profile\/\d+$/.test(pathname) ||
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

function extractProfileUserId(pathname: string): number | null {
  const match = /^\/profile\/(\d+)$/.exec(pathname)
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
    const user = rawUser ? normalizeStoredAuthUser(JSON.parse(rawUser)) : null
    return { token, user }
  } catch {
    return { token: null, user: null }
  }
}

function normalizeStoredAuthUser(rawValue: unknown): AuthUser | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null
  }
  const value = rawValue as Partial<AuthUser>
  if (typeof value.id !== 'number' || typeof value.email !== 'string') {
    return null
  }

  return {
    id: value.id,
    email: value.email,
    display_name: typeof value.display_name === 'string' ? value.display_name : null,
    profile_description: typeof value.profile_description === 'string' ? value.profile_description : '',
    avatar_url: typeof value.avatar_url === 'string' ? value.avatar_url : null,
    avatar_scale: typeof value.avatar_scale === 'number' ? value.avatar_scale : 1,
    auth_provider: typeof value.auth_provider === 'string' ? value.auth_provider : 'email',
    role: typeof value.role === 'string' ? value.role : 'user',
    level: typeof value.level === 'number' && Number.isFinite(value.level) ? Math.max(1, Math.trunc(value.level)) : 1,
    coins: typeof value.coins === 'number' && Number.isFinite(value.coins) ? Math.max(0, Math.trunc(value.coins)) : 0,
    is_banned: Boolean(value.is_banned),
    ban_expires_at: typeof value.ban_expires_at === 'string' ? value.ban_expires_at : null,
    created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
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

function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname))
  const [authToken, setAuthToken] = useState<string | null>(initialSession.token)
  const [authUser, setAuthUser] = useState<AuthUser | null>(initialSession.user)
  const [isHydratingSession, setIsHydratingSession] = useState(Boolean(initialSession.token))
  const hasTrackedInitialRouteRef = useRef(false)

  useEffect(() => {
    const ym = (window as Window & { ym?: (...args: unknown[]) => void }).ym
    if (typeof ym !== 'function') {
      return
    }
    if (!hasTrackedInitialRouteRef.current) {
      hasTrackedInitialRouteRef.current = true
      return
    }
    ym(YANDEX_METRIKA_ID, 'hit', window.location.href)
  }, [path])

  useEffect(() => {
    const handlePopState = () => setPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const hideTimers = new Map<HTMLElement, number>()

    const markElementAsScrolling = (element: HTMLElement) => {
      const hasScrollableAxis = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
      if (!hasScrollableAxis) {
        return
      }

      element.classList.add(SCROLLBAR_ACTIVE_CLASS)
      const existingTimer = hideTimers.get(element)
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer)
      }

      const timerId = window.setTimeout(() => {
        element.classList.remove(SCROLLBAR_ACTIVE_CLASS)
        hideTimers.delete(element)
      }, SCROLLBAR_HIDE_DELAY_MS)
      hideTimers.set(element, timerId)
    }

    const handleScroll = (event: Event) => {
      const scrollTarget = resolveScrollTargetElement(event.target)
      if (!scrollTarget) {
        return
      }
      markElementAsScrolling(scrollTarget)
    }

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      hideTimers.forEach((timerId, element) => {
        window.clearTimeout(timerId)
        element.classList.remove(SCROLLBAR_ACTIVE_CLASS)
      })
      hideTimers.clear()
    }
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
  const profileUserId = extractProfileUserId(path)
  const shouldShowStoryGamePage = isAuthenticated && (path === '/home' || path.startsWith('/home/'))
  const shouldShowDashboardPage = isAuthenticated && path === '/dashboard'
  const shouldShowMyGamesPage = isAuthenticated && path === '/games'
  const shouldShowCommunityWorldsPage = isAuthenticated && path === '/games/all'
  const shouldShowWorldCreatePage = isAuthenticated && (path === '/worlds/new' || worldEditGameId !== null)
  const shouldShowProfilePage = isAuthenticated && (path === '/profile' || profileUserId !== null)
  const shouldShowPrivacyPolicyPage = path === '/privacy-policy'
  const shouldShowTermsPage = path === '/terms-of-service'

  if (shouldShowPrivacyPolicyPage) {
    return (
      <Suspense fallback={null}>
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
      <Suspense fallback={null}>
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
      <Suspense fallback={null}>
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
      <Suspense fallback={null}>
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
      <Suspense fallback={null}>
        <CommunityWorldsPage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  }

  if (shouldShowDashboardPage && authUser) {
    return (
      <Suspense fallback={null}>
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
      <Suspense fallback={null}>
        <WorldCreatePage
          user={authUser}
          authToken={authToken!}
          editingGameId={worldEditGameId}
          onNavigate={navigate}
        />
      </Suspense>
    )
  }

  if (shouldShowProfilePage && authUser) {
    return (
      <Suspense fallback={null}>
        <ProfilePage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
          viewedUserId={profileUserId}
        />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={null}>
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



