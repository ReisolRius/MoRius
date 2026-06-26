import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  applyReferralCode,
  completeVKIDOAuth,
  completeYandexOAuth,
  getCurrentUser,
  getCurrentUserThemeSettings,
  getMaintenanceSettings,
  type CurrentUserThemeSettings,
  type MaintenanceSettings,
} from './services/authApi'
import { Alert, Snackbar } from '@mui/material'
import { PRIVACY_POLICY_TEXT, PUBLICATION_RULES_TEXT, SUBSCRIPTION_TERMS_TEXT, TERMS_OF_SERVICE_TEXT } from './constants/legalDocuments'
import type { ReactNode } from 'react'
import type { AuthResponse, AuthUser } from './types/auth'
import FantasyRouteTransition from './components/navigation/FantasyRouteTransition'
import AiAssistantPanel from './components/ai/AiAssistantPanel'
import { AI_ASSISTANT_OPEN_EVENT } from './components/ai/aiAssistantEvents'
import { getMoriusThemeById, useMoriusThemeController } from './theme'
import { buildPresetFromCustomTheme } from './theme/customTheme'
import {
  clearPendingReferralCode,
  extractReferralCodeFromLocation,
  readPendingReferralCode,
  savePendingReferralCode,
} from './utils/referrals'
import { normalizeProfileBannerId } from './constants/profileBanners'
import { normalizeAvatarFrameId } from './constants/avatarFrames'
import { ServiceUnavailableOverlay } from './components/ServiceUnavailableOverlay'

const TOKEN_STORAGE_KEY = 'morius.auth.token'
const USER_STORAGE_KEY = 'morius.auth.user'
const YANDEX_METRIKA_ID = 106989437
const SCROLLBAR_ACTIVE_CLASS = 'morius-scroll-active'
const SCROLLBAR_HIDE_DELAY_MS = 2000
const MAINTENANCE_REFRESH_INTERVAL_MS = 30_000

type AuthSession = {
  token: string | null
  user: AuthUser | null
}

type WorldEditSource = 'my-games' | 'my-publications'
type AuthRouteMode = 'login' | 'register' | 'reset'
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
    pathname === '/shop' ||
    pathname === '/profile' ||
    /^\/profile\/\d+$/.test(pathname) ||
    pathname === '/worlds/new' ||
    /^\/worlds\/\d+\/edit$/.test(pathname)
  )
}

function isLegalPath(pathname: string): boolean {
  return (
    pathname === '/privacy-policy' ||
    pathname === '/terms-of-service' ||
    pathname === '/publication-rules' ||
    pathname === '/subscription-terms'
  )
}

function parseAuthRouteMode(search: string): AuthRouteMode {
  const mode = new URLSearchParams(search).get('mode')
  if (mode === 'register' || mode === 'reset') {
    return mode
  }
  return 'login'
}

function isReferralPath(pathname: string): boolean {
  return /^\/ref\/[^/?#]+\/?$/.test(pathname)
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
    profile_banner_id: normalizeProfileBannerId(value.profile_banner_id),
    avatar_frame_id: normalizeAvatarFrameId(value.avatar_frame_id),
    avatar_frame_image_url: typeof value.avatar_frame_image_url === 'string' ? value.avatar_frame_image_url : null,
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
    ai_assistant_visible: typeof value.ai_assistant_visible === 'boolean' ? value.ai_assistant_visible : true,
    email_notifications_enabled:
      typeof value.email_notifications_enabled === 'boolean' ? value.email_notifications_enabled : false,
    show_subscriptions: typeof value.show_subscriptions === 'boolean' ? value.show_subscriptions : false,
    show_public_worlds: typeof value.show_public_worlds === 'boolean' ? value.show_public_worlds : false,
    show_private_worlds: typeof value.show_private_worlds === 'boolean' ? value.show_private_worlds : false,
    show_public_characters: typeof value.show_public_characters === 'boolean' ? value.show_public_characters : false,
    show_public_instruction_templates:
      typeof value.show_public_instruction_templates === 'boolean' ? value.show_public_instruction_templates : false,
    referral_code: typeof value.referral_code === 'string' && value.referral_code.trim() ? value.referral_code : null,
    referred_by_user_id:
      typeof value.referred_by_user_id === 'number' && Number.isFinite(value.referred_by_user_id)
        ? Math.trunc(value.referred_by_user_id)
        : null,
    referral_applied_at: typeof value.referral_applied_at === 'string' ? value.referral_applied_at : null,
    referral_bonus_claimed_at:
      typeof value.referral_bonus_claimed_at === 'string' ? value.referral_bonus_claimed_at : null,
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
const loadAuthPage = () => import('./pages/AuthPage')
const loadAuthenticatedHomePage = () => import('./pages/AuthenticatedHomePage')
const loadStoryGamePage = () => import('./pages/StoryGamePage')
const loadAdminBugReportPage = () => import('./pages/AdminBugReportPage')
const loadMyGamesPage = () => import('./pages/MyGamesPage')
const loadMyPublicationsPage = () => import('./pages/MyPublicationsPage')
const loadCommunityWorldsPage = () => import('./pages/CommunityWorldsPage')
const loadWorldCreatePage = () => import('./pages/WorldCreatePage')
const loadLegalDocumentPage = () => import('./pages/LegalDocumentPage')
const loadProfilePage = () => import('./pages/ProfilePage')
const loadShopPage = () => import('./pages/ShopPage')
const loadMaintenancePage = () => import('./pages/MaintenancePage')

const PublicLandingPage = lazy(loadPublicLandingPage)
const AuthPage = lazy(loadAuthPage)
const AuthenticatedHomePage = lazy(loadAuthenticatedHomePage)
const StoryGamePage = lazy(loadStoryGamePage)
const AdminBugReportPage = lazy(loadAdminBugReportPage)
const MyGamesPage = lazy(loadMyGamesPage)
const MyPublicationsPage = lazy(loadMyPublicationsPage)
const CommunityWorldsPage = lazy(loadCommunityWorldsPage)
const WorldCreatePage = lazy(loadWorldCreatePage)
const LegalDocumentPage = lazy(loadLegalDocumentPage)
const ProfilePage = lazy(loadProfilePage)
const ShopPage = lazy(loadShopPage)
const MaintenancePage = lazy(loadMaintenancePage)

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

function RouteTransitionFallback() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsVisible(true), 140)
    return () => window.clearTimeout(timerId)
  }, [])

  return <FantasyRouteTransition active={isVisible} />
}

function App() {
  const { setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, setTheme } = useMoriusThemeController()
  const [path, setPath] = useState(() => normalizePath(window.location.pathname))
  const [authToken, setAuthToken] = useState<string | null>(initialSession.token)
  const [authUser, setAuthUser] = useState<AuthUser | null>(initialSession.user)
  const [isHydratingSession, setIsHydratingSession] = useState(Boolean(initialSession.token))
  const [pendingReferralCode, setPendingReferralCode] = useState(() => readPendingReferralCode())
  const [shouldOpenAiAssistantAfterAuth, setShouldOpenAiAssistantAfterAuth] = useState(false)
  const [maintenanceSettings, setMaintenanceSettings] = useState<MaintenanceSettings | null>(null)
  const [authNotice, setAuthNotice] = useState<{ severity: 'success' | 'error'; message: string } | null>(null)
  const hasTrackedInitialRouteRef = useRef(false)
  const vkIDCompletionStartedRef = useRef(false)
  const yandexCompletionStartedRef = useRef(false)
  const isAuthenticated = Boolean(authToken && authUser)
  const currentUserRole = authUser?.role.trim().toLowerCase() ?? ''
  const canCurrentUserBypassMaintenance = currentUserRole === 'administrator' || currentUserRole === 'moderator'

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
      const nextPath = normalizePath(window.location.pathname)
      setPath(nextPath)
    }
    window.addEventListener('popstate', handlePopState)
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const loaders = isAuthenticated
      ? [
          loadProfilePage,
          loadShopPage,
          loadCommunityWorldsPage,
          loadStoryGamePage,
          loadMyGamesPage,
        ]
      : [loadPublicLandingPage, loadAuthPage]

    return warmPageLoaders(loaders)
  }, [isAuthenticated])

  useEffect(() => {
    let active = true

    const loadMaintenanceSettings = () => {
      void getMaintenanceSettings()
        .then((settings) => {
          if (active) {
            setMaintenanceSettings(settings)
          }
        })
        .catch(() => {
          if (active) {
            setMaintenanceSettings(null)
          }
        })
    }

    loadMaintenanceSettings()
    const intervalId = window.setInterval(loadMaintenanceSettings, MAINTENANCE_REFRESH_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
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
    const normalizedTarget = normalizeNavigationTarget(targetPath)
    if (getCurrentNavigationHref() !== normalizedTarget.href) {
      if (options?.replace) {
        window.history.replaceState({}, '', normalizedTarget.href)
      } else {
        window.history.pushState({}, '', normalizedTarget.href)
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setPath(normalizedTarget.pathname)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('yandex_oauth_error')
    const shouldComplete = params.get('yandex_oauth') === 'complete'
    if (!oauthError && !shouldComplete) {
      return
    }

    if (oauthError) {
      params.delete('yandex_oauth_error')
      const nextSearch = params.toString()
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
      )
      window.setTimeout(() => {
        const message =
          oauthError === 'access_denied'
            ? 'Вход через Яндекс отменён.'
            : oauthError === 'account_conflict'
              ? 'Этот Яндекс-аккаунт уже привязан к другому профилю.'
              : 'Не удалось завершить вход через Яндекс.'
        setAuthNotice({
          severity: 'error',
          message,
        })
      }, 0)
    }
    if (!shouldComplete || yandexCompletionStartedRef.current) {
      return
    }

    yandexCompletionStartedRef.current = true
    window.setTimeout(() => setIsHydratingSession(true), 0)
    void completeYandexOAuth()
      .then((payload) => {
        persistAuthSession(payload)
        setAuthToken(payload.access_token)
        setAuthUser(payload.user)
        setShouldOpenAiAssistantAfterAuth(Boolean(payload.is_new_user))
        if (payload.oauth_action === 'link') {
          setAuthNotice({ severity: 'success', message: 'Аккаунт успешно перепривязан к Яндексу.' })
          navigate('/profile', { replace: true })
        } else {
          navigate('/dashboard', { replace: true })
        }
      })
      .catch((error) => {
        setAuthNotice({
          severity: 'error',
          message: error instanceof Error ? error.message : 'Не удалось завершить вход через Яндекс.',
        })
        params.delete('yandex_oauth')
        const nextSearch = params.toString()
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
        )
      })
      .finally(() => {
        setIsHydratingSession(false)
      })
  }, [navigate])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('vk_id_oauth_error')
    const shouldComplete = params.get('vk_id_oauth') === 'complete'
    if (!oauthError && !shouldComplete) {
      return
    }

    if (oauthError) {
      params.delete('vk_id_oauth_error')
      const nextSearch = params.toString()
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
      )
      window.setTimeout(() => {
        const message =
          oauthError === 'access_denied'
            ? 'Вход через VK ID отменён.'
            : oauthError === 'session_expired'
              ? 'Сессия входа через VK ID устарела. Попробуйте войти ещё раз.'
            : oauthError === 'invalid_scope'
              ? 'VK ID отклонил запрошенные доступы. Проверьте email в настройках приложения VK ID.'
            : oauthError === 'invalid_grant' || oauthError === 'invalid_request'
              ? 'VK ID отклонил код входа. Попробуйте войти ещё раз.'
            : oauthError === 'missing_email'
              ? 'VK ID не вернул email. Проверьте доступ email в настройках приложения VK ID.'
            : oauthError === 'state_mismatch'
              ? 'VK ID вернул несовпадающую сессию входа. Попробуйте ещё раз.'
            : oauthError === 'account_conflict'
              ? 'Этот VK ID уже привязан к другому профилю.'
              : 'Не удалось завершить вход через VK ID.'
        setAuthNotice({ severity: 'error', message })
      }, 0)
    }
    if (!shouldComplete || vkIDCompletionStartedRef.current) {
      return
    }

    vkIDCompletionStartedRef.current = true
    window.setTimeout(() => setIsHydratingSession(true), 0)
    void completeVKIDOAuth()
      .then((payload) => {
        persistAuthSession(payload)
        setAuthToken(payload.access_token)
        setAuthUser(payload.user)
        setShouldOpenAiAssistantAfterAuth(Boolean(payload.is_new_user))
        if (payload.oauth_action === 'link') {
          const providerLabel = payload.oauth_provider === 'mail' ? 'Mail' : 'VK'
          setAuthNotice({ severity: 'success', message: `Аккаунт успешно перепривязан к ${providerLabel}.` })
          navigate('/profile', { replace: true })
        } else {
          navigate('/dashboard', { replace: true })
        }
      })
      .catch((error) => {
        setAuthNotice({
          severity: 'error',
          message: error instanceof Error ? error.message : 'Не удалось завершить вход через VK ID.',
        })
        params.delete('vk_id_oauth')
        const nextSearch = params.toString()
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
        )
      })
      .finally(() => {
        setIsHydratingSession(false)
      })
  }, [navigate])

  useEffect(() => {
    const referralCode = extractReferralCodeFromLocation(window.location)
    if (!referralCode) {
      return
    }
    const savedCode = savePendingReferralCode(referralCode)
    const timerIds: number[] = []
    if (savedCode) {
      timerIds.push(window.setTimeout(() => setPendingReferralCode(savedCode), 0))
    }
    if (isReferralPath(path)) {
      timerIds.push(window.setTimeout(() => navigate(`/?ref=${encodeURIComponent(referralCode)}`, { replace: true }), 0))
    }
    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [navigate, path])

  useEffect(() => {
    if (!authToken || !pendingReferralCode) {
      return
    }

    let active = true
    void applyReferralCode({
      token: authToken,
      code: pendingReferralCode,
    })
      .then(() => {
        if (!active) {
          return
        }
        clearPendingReferralCode()
        setPendingReferralCode('')
      })
      .catch(() => {
        // Keep the pending code for a later retry if the network is temporarily unavailable.
      })

    return () => {
      active = false
    }
  }, [authToken, pendingReferralCode])

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

  useEffect(() => {
    if (
      !shouldOpenAiAssistantAfterAuth ||
      !authToken ||
      !authUser ||
      isLegalPath(path)
    ) {
      return
    }

    const timerId = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(AI_ASSISTANT_OPEN_EVENT))
      setShouldOpenAiAssistantAfterAuth(false)
    }, 320)

    return () => window.clearTimeout(timerId)
  }, [authToken, authUser, path, shouldOpenAiAssistantAfterAuth])

  const handleAuthSuccess = useCallback(
    (payload: AuthResponse) => {
      persistAuthSession(payload)
      setAuthToken(payload.access_token)
      setAuthUser(payload.user)
      setIsHydratingSession(false)
      setShouldOpenAiAssistantAfterAuth(Boolean(payload.is_new_user))
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
  const shouldShowMyGamesPage = false
  const shouldShowMyPublicationsPage = isAuthenticated && path === '/games/publications'
  const shouldShowCommunityWorldsPage = isAuthenticated && path === '/games/all'
  const shouldShowShopPage = isAuthenticated && path === '/shop'
  const shouldShowWorldCreatePage = isAuthenticated && (path === '/worlds/new' || worldEditGameId !== null)
  const shouldShowProfilePage = isAuthenticated && (path === '/profile' || path === '/games' || profileUserId !== null)
  const shouldShowPrivacyPolicyPage = path === '/privacy-policy'
  const shouldShowTermsPage = path === '/terms-of-service'
  const shouldShowPublicationRulesPage = path === '/publication-rules'
  const shouldShowSubscriptionTermsPage = path === '/subscription-terms'
  const shouldShowAuthPage = !isAuthenticated && path === '/auth'
  const shouldAllowMaintenanceAuthBypass = !isAuthenticated && path === '/auth'
  const shouldShowMaintenancePage = Boolean(
    maintenanceSettings?.enabled && !canCurrentUserBypassMaintenance && !shouldAllowMaintenanceAuthBypass,
  )
  const routeTransitionFallback = <RouteTransitionFallback />

  let pageContent: ReactNode

  if (shouldShowMaintenancePage && maintenanceSettings) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <MaintenancePage settings={maintenanceSettings} />
      </Suspense>
    )
  } else if (shouldShowPrivacyPolicyPage) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <LegalDocumentPage
          title="Политика конфиденциальности"
          content={PRIVACY_POLICY_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowTermsPage) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <LegalDocumentPage
          title="Пользовательское соглашение"
          content={TERMS_OF_SERVICE_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowPublicationRulesPage) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <LegalDocumentPage
          title="Правила публикаций"
          content={PUBLICATION_RULES_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowSubscriptionTermsPage) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <LegalDocumentPage
          title="Условия подписки и автосписаний"
          content={SUBSCRIPTION_TERMS_TEXT}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowAuthPage) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <AuthPage
          initialMode={parseAuthRouteMode(window.location.search)}
          onNavigate={navigate}
          onAuthSuccess={handleAuthSuccess}
        />
      </Suspense>
    )
  } else if (shouldShowStoryGamePage && authUser) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
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
      <Suspense fallback={routeTransitionFallback}>
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
      <Suspense fallback={routeTransitionFallback}>
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
      <Suspense fallback={routeTransitionFallback}>
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
      <Suspense fallback={routeTransitionFallback}>
        <WorldCreatePage
          user={authUser}
          authToken={authToken!}
          editingGameId={worldEditGameId}
          editSource={worldEditSource}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowShopPage && authUser) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <ShopPage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  } else if (shouldShowMyPublicationsPage && authUser) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <MyPublicationsPage
          user={authUser}
          authToken={authToken!}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
          onLogout={handleLogout}
        />
      </Suspense>
    )
  } else if (shouldShowBugReportPage && authUser && adminBugReportId !== null) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
        <AdminBugReportPage
          authToken={authToken!}
          reportId={adminBugReportId}
          onNavigate={navigate}
        />
      </Suspense>
    )
  } else if (shouldShowProfilePage && authUser) {
    pageContent = (
      <Suspense fallback={routeTransitionFallback}>
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
      <Suspense fallback={routeTransitionFallback}>
        <PublicLandingPage
          isAuthenticated={isAuthenticated}
          pendingReferralCode={pendingReferralCode}
          onNavigate={navigate}
          onGoHome={() => navigate('/dashboard')}
        />
      </Suspense>
    )
  }

  return (
    <>
      {pageContent}
      {isAuthenticated && authUser && authToken && !shouldShowPrivacyPolicyPage && !shouldShowTermsPage && !shouldShowMaintenancePage ? (
        <AiAssistantPanel
          user={authUser}
          authToken={authToken}
          path={path}
          onNavigate={navigate}
          onUserUpdate={handleUserUpdate}
        />
      ) : null}
      <Snackbar
        open={Boolean(authNotice)}
        autoHideDuration={5000}
        onClose={() => setAuthNotice(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          severity={authNotice?.severity ?? 'success'}
          onClose={() => setAuthNotice(null)}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {authNotice?.message ?? ''}
        </Alert>
      </Snackbar>
      <ServiceUnavailableOverlay />
    </>
  )
}

export default App



