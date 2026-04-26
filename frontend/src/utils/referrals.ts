const PENDING_REFERRAL_STORAGE_KEY = 'morius.pending.referral.code'
const PENDING_REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REFERRAL_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/

type StoredPendingReferral = {
  code: string
  savedAt: number
}

export function normalizeReferralCode(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : ''
}

export function extractReferralCodeFromLocation(location: Pick<Location, 'pathname' | 'search'>): string {
  const params = new URLSearchParams(location.search)
  const queryCode = normalizeReferralCode(params.get('ref'))
  if (queryCode) {
    return queryCode
  }

  const match = /^\/ref\/([^/?#]+)\/?$/i.exec(location.pathname)
  if (!match) {
    return ''
  }
  try {
    return normalizeReferralCode(decodeURIComponent(match[1]))
  } catch {
    return normalizeReferralCode(match[1])
  }
}

export function savePendingReferralCode(code: string): string {
  const normalized = normalizeReferralCode(code)
  if (!normalized) {
    return ''
  }
  try {
    const payload: StoredPendingReferral = {
      code: normalized,
      savedAt: Date.now(),
    }
    localStorage.setItem(PENDING_REFERRAL_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage can be unavailable in private modes; keep in-memory flow alive.
  }
  return normalized
}

export function readPendingReferralCode(): string {
  try {
    const rawValue = localStorage.getItem(PENDING_REFERRAL_STORAGE_KEY)
    if (!rawValue) {
      return ''
    }
    const parsed = JSON.parse(rawValue) as Partial<StoredPendingReferral>
    const code = normalizeReferralCode(parsed.code)
    const savedAt = typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0
    if (!code || Date.now() - savedAt > PENDING_REFERRAL_TTL_MS) {
      localStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY)
      return ''
    }
    return code
  } catch {
    return ''
  }
}

export function clearPendingReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY)
  } catch {
    // Ignore storage failures; the server remains the source of truth.
  }
}

export function buildReferralLink(code: string): string {
  const normalized = normalizeReferralCode(code)
  if (!normalized || typeof window === 'undefined') {
    return ''
  }
  return `${window.location.origin}/ref/${encodeURIComponent(normalized)}`
}
