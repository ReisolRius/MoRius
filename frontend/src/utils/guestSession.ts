import { useSyncExternalStore } from 'react'
import type { AuthUser } from '../types/auth'

/**
 * The client half of guest play. "Начать игру" without an account gives the browser a guest
 * ("Гость №N"): a real server-side user that can play and create, but not pay, publish, post or
 * open account settings. The server marks every such refusal with `X-Moru-Account-Required`;
 * httpClient turns that header into `ACCOUNT_REQUIRED_EVENT`, and App answers the event by
 * opening the sign-up form. UI entry points that never reach the server (the settings dialog,
 * the top-up dialog) raise the same event themselves through `guardGuestAction`.
 */

export const ACCOUNT_REQUIRED_EVENT = 'morius:account-required'
/** Raised after the player erased their own account; App clears the session and goes home. */
export const ACCOUNT_DELETED_EVENT = 'morius:account-deleted'
export const ACCOUNT_REQUIRED_HEADER = 'X-Moru-Account-Required'
export const GUEST_TOKEN_HEADER = 'X-Moru-Guest-Token'
export const DEVICE_ID_HEADER = 'X-Moru-Device'

const GUEST_TOKEN_STORAGE_KEY = 'morius.guest.token'
const GUEST_NAME_STORAGE_KEY = 'morius.guest.name'
const DEVICE_ID_STORAGE_KEY = 'morius.device.id'
const KNOWN_ACCOUNT_STORAGE_KEY = 'morius.auth.known_account'
// Per tab, so it survives the OAuth round trip but never leaks into another tab's sign-in.
const AUTH_RETURN_PATH_STORAGE_KEY = 'morius.auth.return_to'
const AUTH_RETURN_PATH_TTL_MS = 30 * 60 * 1000
/** Browser-side state the game keeps per user as `<prefix>:<userId>:<gameId>`: unsent turns. */
const PER_USER_DRAFT_STORAGE_PREFIXES = ['morius.story.composer-draft.v1', 'morius.story.composer-pending.v1']

export type AccountRequiredReason =
  | 'sols'
  | 'settings'
  | 'shop'
  | 'publish'
  | 'social'
  | 'rewards'
  | 'account_exists'
  | 'network_limit'
  | 'busy'
  | 'guest'

export type AccountRequiredDetail = {
  reason: AccountRequiredReason
  mode: 'register' | 'login'
  /** Where signing up should bring the player back to. The page they are on when not given. */
  returnTo?: string | null
}

const KNOWN_REASONS: ReadonlySet<string> = new Set<AccountRequiredReason>([
  'sols',
  'settings',
  'shop',
  'publish',
  'social',
  'rewards',
  'account_exists',
  'network_limit',
  'busy',
  'guest',
])

/** The line the sign-in page shows above the form, keyed by why the player was sent there. */
export const ACCOUNT_REQUIRED_MESSAGES: Record<AccountRequiredReason, string> = {
  sols: 'Стартовые солы закончились. Зарегистрируйся, чтобы играть дальше — всё, что ты создал, сохранится.',
  settings: 'Настройки аккаунта доступны после регистрации.',
  shop: 'Покупки доступны только с аккаунтом.',
  publish: 'Публиковать миры, персонажей и инструкции можно только с аккаунтом.',
  social: 'Комментарии, оценки, жалобы и подписки доступны после регистрации.',
  rewards: 'Ежедневные награды доступны после регистрации.',
  account_exists: 'С этого устройства уже входили в аккаунт Moru. Войди, чтобы продолжить свою историю.',
  network_limit: 'С этой сети недавно уже начинали игру без регистрации. Войди или зарегистрируйся — это бесплатно.',
  busy: 'Слишком много новых гостей прямо сейчас. Войди или зарегистрируйся, чтобы начать.',
  guest: 'Сохрани прогресс: зарегистрируйся, и всё, что ты создал, перейдёт в твой аккаунт.',
}

export function normalizeAccountRequiredReason(value: string | null | undefined): AccountRequiredReason | null {
  const normalized = (value ?? '').trim().toLowerCase()
  return KNOWN_REASONS.has(normalized) ? (normalized as AccountRequiredReason) : null
}

// ------------------------------------------------------------------------------ storage

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // Private modes can refuse storage; guest play still works for the current page life.
  }
}

function createDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through to the manual id below.
  }
  const bytes = new Uint8Array(18)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A random id for this browser. Survives sign-out on purpose - it is how "this device already
 *  had a guest" is recognised even after the HttpOnly cookie is gone. */
export function getOrCreateDeviceId(): string {
  const existing = readStorage(DEVICE_ID_STORAGE_KEY)
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) {
    return existing
  }
  const created = createDeviceId()
  writeStorage(DEVICE_ID_STORAGE_KEY, created)
  return created
}

export function readGuestToken(): string | null {
  const token = readStorage(GUEST_TOKEN_STORAGE_KEY)
  return token && token.trim() ? token.trim() : null
}

export function readStoredGuestName(): string | null {
  const name = readStorage(GUEST_NAME_STORAGE_KEY)
  return name && name.trim() ? name.trim() : null
}

/** Kept apart from the session itself so the sign-up form can still take the guest along after
 *  the player signed out of it. */
export function rememberGuestSession(token: string, user: Pick<AuthUser, 'display_name'>): void {
  writeStorage(GUEST_TOKEN_STORAGE_KEY, token)
  writeStorage(GUEST_NAME_STORAGE_KEY, (user.display_name ?? '').trim() || null)
}

export function forgetGuestSession(): void {
  writeStorage(GUEST_TOKEN_STORAGE_KEY, null)
  writeStorage(GUEST_NAME_STORAGE_KEY, null)
}

/** Set on every real sign-in. From then on "Начать игру" on this browser opens the login form. */
export function markKnownAccountOnDevice(): void {
  writeStorage(KNOWN_ACCOUNT_STORAGE_KEY, '1')
}

export function hasKnownAccountOnDevice(): boolean {
  return readStorage(KNOWN_ACCOUNT_STORAGE_KEY) === '1'
}

/**
 * Moves the unsent turn a guest was typing - usually the one it tried to send when the starter
 * sols ran out - to the account it just became. The games keep their ids through the merge, so
 * only the user part of the key changes. A draft the account already has for that game wins.
 */
export function carryGuestDraftsToAccount(guestUserId: number, accountUserId: number): void {
  if (!Number.isInteger(guestUserId) || guestUserId <= 0 || guestUserId === accountUserId) {
    return
  }
  try {
    const moves: Array<[string, string]> = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) {
        continue
      }
      for (const prefix of PER_USER_DRAFT_STORAGE_PREFIXES) {
        const guestPrefix = `${prefix}:${guestUserId}:`
        if (key.startsWith(guestPrefix)) {
          moves.push([key, `${prefix}:${accountUserId}:${key.slice(guestPrefix.length)}`])
        }
      }
    }
    for (const [fromKey, toKey] of moves) {
      const value = localStorage.getItem(fromKey)
      if (value !== null && localStorage.getItem(toKey) === null) {
        localStorage.setItem(toKey, value)
      }
      localStorage.removeItem(fromKey)
    }
  } catch {
    // Storage can be unavailable; the draft is a convenience, the merge itself is on the server.
  }
}

// ------------------------------------------------------------------------------ return after sign-in

function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSessionStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, value)
    }
  } catch {
    // Without storage the player simply lands on the home page after signing up.
  }
}

/** A path inside the app - never another origin, never the sign-in page itself. */
export function sanitizeAppReturnPath(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.length > 512) {
    return null
  }
  const pathname = trimmed.split(/[?#]/, 1)[0]
  if (pathname === '/' || pathname === '/auth' || pathname.startsWith('/auth/')) {
    return null
  }
  return trimmed
}

/** Remembers the page a guest was sent to the sign-up form from. Invalid paths are ignored. */
export function rememberAuthReturnPath(path: string | null | undefined): void {
  const safePath = sanitizeAppReturnPath(path)
  if (safePath) {
    writeSessionStorage(AUTH_RETURN_PATH_STORAGE_KEY, JSON.stringify({ path: safePath, at: Date.now() }))
  }
}

export function peekAuthReturnPath(): string | null {
  const raw = readSessionStorage(AUTH_RETURN_PATH_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown }
    const savedAt = typeof parsed.at === 'number' ? parsed.at : 0
    if (Date.now() - savedAt > AUTH_RETURN_PATH_TTL_MS) {
      return null
    }
    return sanitizeAppReturnPath(typeof parsed.path === 'string' ? parsed.path : null)
  } catch {
    return null
  }
}

export function clearAuthReturnPath(): void {
  writeSessionStorage(AUTH_RETURN_PATH_STORAGE_KEY, null)
}

/** Read once: every sign-in consumes it, so an old page never hijacks a later one. */
export function takeAuthReturnPath(): string | null {
  const path = peekAuthReturnPath()
  clearAuthReturnPath()
  return path
}

// ------------------------------------------------------------------------------ request headers

const GUEST_AWARE_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register/verify',
  '/api/auth/password-reset/verify',
  '/api/auth/google',
  '/api/auth/yandex/start',
  '/api/auth/vk/start',
  '/api/auth/guest/session',
  '/api/auth/guest/claim',
])

/** Sign-in requests carry the browser's guest so the server can move it into the account. */
export function buildGuestAwareHeaders(path: string): Record<string, string> {
  const pathname = path.split('?', 1)[0]
  if (!GUEST_AWARE_AUTH_PATHS.has(pathname)) {
    return {}
  }
  const headers: Record<string, string> = { [DEVICE_ID_HEADER]: getOrCreateDeviceId() }
  const guestToken = readGuestToken()
  if (guestToken && pathname !== '/api/auth/guest/claim') {
    headers[GUEST_TOKEN_HEADER] = guestToken
  }
  return headers
}

// ------------------------------------------------------------------------------ live session flag

let guestSessionActive = false
const guestSessionListeners = new Set<() => void>()

export function setGuestSessionActive(value: boolean): void {
  if (guestSessionActive === value) {
    return
  }
  guestSessionActive = value
  guestSessionListeners.forEach((listener) => listener())
}

export function isGuestSessionActive(): boolean {
  return guestSessionActive
}

function subscribeGuestSession(listener: () => void): () => void {
  guestSessionListeners.add(listener)
  return () => guestSessionListeners.delete(listener)
}

/** True while the signed-in player is a guest. For components that are not handed the user. */
export function useIsGuestSession(): boolean {
  return useSyncExternalStore(subscribeGuestSession, isGuestSessionActive, () => false)
}

// ------------------------------------------------------------------------------ the event

let lastDispatchAt = 0
let lastDispatchReason = ''

export function requestAccount(
  reason: AccountRequiredReason,
  mode: 'register' | 'login' = 'register',
  options?: { returnTo?: string | null },
): void {
  if (typeof window === 'undefined') {
    return
  }
  const now = Date.now()
  // Several requests failing together (a page loading in parallel) must open the form once.
  if (reason === lastDispatchReason && now - lastDispatchAt < 1500) {
    return
  }
  lastDispatchAt = now
  lastDispatchReason = reason
  window.dispatchEvent(
    new CustomEvent<AccountRequiredDetail>(ACCOUNT_REQUIRED_EVENT, {
      detail: { reason, mode, returnTo: options?.returnTo ?? null },
    }),
  )
}

/**
 * For UI entry points that need an account. Returns true - and sends the guest to the sign-up
 * form - when the current player is a guest; the caller then simply stops.
 */
export function guardGuestAction(reason: AccountRequiredReason): boolean {
  if (!guestSessionActive) {
    return false
  }
  requestAccount(reason)
  return true
}

export function notifyAccountDeleted(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT))
}

/** Called by httpClient for every failed response. */
export function handleAccountRequiredResponse(response: Response): void {
  const reason = normalizeAccountRequiredReason(response.headers.get(ACCOUNT_REQUIRED_HEADER))
  if (reason) {
    requestAccount(reason)
  }
}
