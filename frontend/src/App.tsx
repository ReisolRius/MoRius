import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  getCurrentUser,
  getCurrentUserThemeSettings,
  type CurrentUserThemeSettings,
} from './services/authApi'
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from './constants/legalDocuments'
import type { ReactNode } from 'react'
import type { AuthResponse, AuthUser } from './types/auth'
import FantasyRouteTransition from './components/navigation/FantasyRouteTransition'
import { getMoriusThemeById, useMoriusThemeController } from './theme'
import { buildPresetFromCustomTheme } from './theme/customTheme'

const TOKEN_STORAGE_KEY = 'morius.auth.token'
const USER_STORAGE_KEY = 'morius.auth.user'
const YANDEX_METRIKA_ID = 106989437
const SCROLLBAR_ACTIVE_CLASS = 'morius-scroll-active'
const SCROLLBAR_HIDE_DELAY_MS = 2000

type AuthSession = {
  token: string | null
  user: AuthUser | null
}

type WorldEditSource = 'my-games' | 'my-publications'
type PageLoader = () => Promise<unknown>

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

function normalizeNavigationTarget(targetPath: string): { pathname: string; href: string } {
  const parsedTarget = new URL(targetPath, window.location.origin)
  const normalizedPathname = normalizePath(parsedTarget.pathname)
  return {
    pathname: normalizedPathname,
    href: `${normalizedPathname}${parsedTarget.search}${parsedTarget.hash}`,
  }
}

function getCurrentNavigationHref(): string {
  const currentPathname = normalizePath(window.location.pathname)
  return `${currentPathname}${window.location.search}${window.location.hash}`
}

function isAuthenticatedPath(pathname: string): boolean {
  return (
    pathname === '/home' ||
    pathname.startsWith('/home/') ||
    pathname === '/dashboard' ||
    pathname === '/games' ||
    pathname === '/games/publications' ||
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

function extractAdminBugReportId(pathname: string): number | null {
  const match = /^\/home\/reports\/(\d+)$/.exec(pathname)
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

function extractWorldEditSource(search: string): WorldEditSource | null {
  const params = new URLSearchParams(search)
  const source = params.get('source')
  if (source === 'my-games' || source === 'my-publications') {
    return source
  }
  return null
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
    notifications_enabled: typeof value.notifications_enabled === 'boolean' ? value.notifications_enabled : true,
    notify_comment_reply: typeof value.notify_comment_reply === 'boolean' ? value.notify_comment_reply : true,
    notify_world_comment: typeof value.notify_world_comment === 'boolean' ? value.notify_world_comment : true,
    notify_publication_review:
      typeof value.notify_publication_review === 'boolean' ? value.notify_publication_review : true,
    notify_new_follower: typeof value.notify_new_follower === 'boolean' ? value.notify_new_follower : true,
    notify_moderation_report:
      typeof value.notify_moderation_report === 'boolean' ? value.notify_moderation_report : true,
    notify_moderation_queue:
      typeof value.notify_moderation_queue === 'boolean' ? value.notify_moderation_queue : true,
    email_notifications_enabled:
      typeof value.email_notifications_enabled === 'boolean' ? value.email_notifications_enabled : false,
    show_subscriptions: typeof value.show_subscriptions === 'boolean' ? value.show_subscriptions : false,
    show_public_worlds: typeof value.show_public_worlds === 'boolean' ? value.show_public_worlds : false,
    show_private_worlds: typeof value.show_private_worlds === 'boolean' ? value.show_private_worlds : false,
    show_public_characters: typeof value.show_public_characters === 'boolean' ? value.show_public_characters : false,
    show_public_instruction_templates:
      typeof value.show_public_instruction_templates === 'boolean' ? value.show_public_instruction_templates : false,
    active_theme_id:
      typeof value.active_theme_id === 'string' && value.active_theme_id.trim() ? value.active_theme_id : null,
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
const loadPublicLandingPage = () => import('./pages/PublicLandingPage')
const loadAuthenticatedHomePage = () => import('./pages/AuthenticatedHomePage')
const loadStoryGamePage = () => import('./pages/StoryGamePage')
const loadAdminBugReportPage = () => import('./pages/AdminBugReportPage')
const loadMyGamesPage = () => import('./pages/MyGamesPage')
const loadMyPublicationsPage = () => import('./pages/MyPublicationsPage')
const loadCommunityWorldsPage = () => import('./pages/CommunityWorldsPage')
const loadWorldCreatePage = () => import('./pages/WorldCreatePage')
const loadLegalDocumentPage = () => import('./pages/LegalDocumentPage')
const loadProfilePage = () => import('./pages/ProfilePage')
const loadOnboardingTour = () => import('./components/onboarding/OnboardingTour')

const PublicLandingPage = lazy(loadPublicLandingPage)
const AuthenticatedHomePage = lazy(loadAuthenticatedHomePage)
const StoryGamePage = lazy(loadStoryGamePage)
const AdminBugReportPage = lazy(loadAdminBugReportPage)
const MyGamesPage = lazy(loadMyGamesPage)
const MyPublicationsPage = lazy(loadMyPublicationsPage)
const CommunityWorldsPage = lazy(loadCommunityWorldsPage)
const WorldCreatePage = lazy(loadWorldCreatePage)
const LegalDocumentPage = lazy(loadLegalDocumentPage)
const ProfilePage = lazy(loadProfilePage)
const OnboardingTour = lazy(loadOnboardingTour)

function warmPageLoaders(loaders: PageLoader[]): () => void {
  if (typeof window === 'undefined' || loaders.length === 0) {
    return () => undefined
  }

  const timerIds: number[] = []
  let idleCallbackId: number | null = null

  const runWarmup = () => {
    loaders.forEach((loader, index) => {
      const timerId = window.setTimeout(() => {
        void loader()
      }, index * 120)
      timerIds.push(timerId)
    })
  }

  if (typeof window.requestIdleCallback === 'function') {
    idleCallbackId = window.requestIdleCallback(runWarmup, { timeout: 1500 })
  } else {
    timerIds.push(window.setTimeout(runWarmup, 500))
  }

  return () => {
    if (idleCallbackId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleCallbackId)
    }
    timerIds.forEach((timerId) => window.clearTimeout(timerId))
  }
}

function App() {
  const { setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, setTheme } = useMoriusThemeController()
  const [path, setPath] = useState(() => normalizePath(window.location.pathname))
  const [authToken, setAuthToken] = useState<string | null>(initialSession.token)
  const [authUser, setAuthUser] = useState<AuthUser | null>(initialSession.user)
  const [isHydratingSession, setIsHydratingSession] = useState(Boolean(initialSession.token))
  const [isRouteTransitionVisible, setIsRouteTransitionVisible] = useState(false)
  const hasTrackedInitialRouteRef = useRef(false)
  const routeTransitionTimerRef = useRef<number | null>(null)
  const isAuthenticated = Boolean(authToken && authUser)

  const triggerRouteTransition = useCallback(() => {
    if (routeTransitionTimerRef.current !== null) {
      window.clearTimeout(routeTransitionTimerRef.current)
    }
    setIsRouteTransitionVisible(true)
    routeTransitionTimerRef.current = window.setTimeout(() => {
      setIsRouteTransitionVisible(false)
      routeTransitionTimerRef.current = null
    }, 560)
  }, [])

  const applyResolvedThemeSettings = useCallback((settings: CurrentUserThemeSettings | null) => {
    if (!settings) {
      return
    }
    if (settings.active_theme_kind === 'custom') {
      const selectedCustomTheme = settings.custom_themes.find((item) => item.id === settings.active_theme_id)
      if (selectedCustomTheme) {
        setCustomTheme(buildPresetFromCustomTheme(selectedCustomTheme))
      } else {
        setCustomTheme(null)
        setTheme(getMoriusThemeById('rius-dungeon').id)
      }
    } else {
      setCustomTheme(null)
      setTheme(getMoriusThemeById(settings.active_theme_id).id)
    }
    setStoryHistoryFontFamily(settings.story.font_family)
    setStoryHistoryFontWeight(settings.story.font_weight)
  }, [setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, setTheme])

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
    const handlePopState = () => {
      triggerRouteTransition()
      setPath(normalizePath(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [triggerRouteTransition])

  useEffect(() => {
    return () => {
      if (routeTransitionTimerRef.current !== null) {
        window.clearTimeout(routeTransitionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const loaders = isAuthenticated
      ? [
          loadProfilePage,
          loadCommunityWorldsPage,
          loadStoryGamePage,
          loadMyGamesPage,
        ]
      : [loadPublicLandingPage]

    return warmPageLoaders(loaders)
  }, [isAuthenticated])

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
    const normalizedTarget = normalizeNavigationTarget(targetPath)
    if (getCurrentNavigationHref() !== normalizedTarget.href) {
      triggerRouteTransition()
      if (options?.replace) {
        window.history.replaceState({}, '', normalizedTarget.href)
      } else {
        window.history.pushState({}, '', normalizedTarget.href)
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setPath(normalizedTarget.pathname)
  }, [triggerRouteTransition])

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
    if (!authToken) {
      return
    }

    let active = true
    void getCurrentUserThemeSettings({ token: authToken })
      .then((settings) => {
        if (!active) {
          return
        }
        applyResolvedThemeSettings(settings)
      })
      .catch(() => {
        if (!active) {
          return
        }
        setCustomTheme(null)
        if (authUser?.active_theme_id && getMoriusThemeById(authUser.active_theme_id).id === authUser.active_theme_id) {
          setTheme(authUser.active_theme_id)
          return
        }
        setTheme(getMoriusThemeById('rius-dungeon').id)
      })

    return () => {
      active = false
    }
  }, [applyResolvedThemeSettings, authToken, authUser?.active_theme_id, setCustomTheme, setTheme])

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

  const adminBugReportId = extractAdminBugReportId(path)
  const initialGameId = extractStoryGameId(path)
  const worldEditGameId = extractWorldEditGameId(path)
  const worldEditSource = worldEditGameId !== null ? extractWorldEditSource(window.location.search) : null
  const profileUserId = extractProfileUserId(path)
  const shouldShowBugReportPage = isAuthenticated && adminBugReportId !== null
  const shouldShowStoryGamePage = isAuthenticated && (path === '/home' || path.startsWith('/home/')) && !shouldShowBugReportPage
  const shouldShowDashboardPage = isAuthenticated && path === '/dashboard'
  const shouldShowMyGamesPage = isAuthenticated && path === '/games'
  const shouldShowMyPublicationsPage = isAuthenticated && path === '/games/publications'
  const shouldShowCommunityWorldsPage = isAuthenticated && path === '/games/all'
  const shouldShowWorldCreatePage = isAuthenticated && (path === '/worlds/new' || worldEditGameId !== null)
  const shouldShowProfilePage = isAuthenticated && (path === '/profile' || profileUserId !== null)
  const shouldShowPrivacyPolicyPage = path === '/privacy-policy'
  const shouldShowTermsPage = path === '/terms-of-service'

  let pageContent: ReactNode

  if (shouldShowPrivacyPolicyPage) {
    pageContent = (
      <Suspense fallback={null}>
        <LegalDocumentPage
          title="Политика конфиденциальности"
          content={PRIVACY_POLICY_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowTermsPage) {
    pageContent = (
      <Suspense fallback={null}>
        <LegalDocumentPage
          title="Пользовательское соглашение"
          content={TERMS_OF_SERVICE_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowStoryGamePage && authUser) {
    pageContent = (
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
  } else if (shouldShowMyGamesPage && authUser) {
    pageContent = (
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
  } else if (shouldShowCommunityWorldsPage && authUser) {
    pageContent = (
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
  } else if (shouldShowDashboardPage && authUser) {
    pageContent = (
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
  } else if (shouldShowWorldCreatePage && authUser) {
    pageContent = (
      <Suspense fallback={null}>
        <WorldCreatePage
          user={authUser}
          authToken={authToken!}
          editingGameId={worldEditGameId}
          editSource={worldEditSource}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowMyPublicationsPage && authUser) {
    pageContent = (
      <Suspense fallback={null}>
        <MyPublicationsPage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowBugReportPage && authUser && adminBugReportId !== null) {
    pageContent = (
      <Suspense fallback={null}>
        <AdminBugReportPage
          authToken={authToken!}
          reportId={adminBugReportId}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowProfilePage && authUser) {
    pageContent = (
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
  } else {
    pageContent = (
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

  return (
    <>
      <FantasyRouteTransition active={isRouteTransitionVisible} />
      {pageContent}
      {isAuthenticated && authUser && !shouldShowPrivacyPolicyPage && !shouldShowTermsPage ? (
        <Suspense fallback={null}>
          <OnboardingTour userId={authUser.id} authToken={authToken!} path={path} onNavigate={navigate} />
        </Suspense>
      ) : null}
    </>
  )
}

export default App



