export const MORIUS_SITE_ORIGIN = 'https://morius-ai.ru'
export const MORIUS_ENTRY_PATH = '/auth'
export const MORIUS_ENTRY_URL = `${MORIUS_SITE_ORIGIN}${MORIUS_ENTRY_PATH}`
export const MORIUS_GOOGLE_AUTH_URL = `${MORIUS_SITE_ORIGIN}/api/auth/google`
export const GOOGLE_WEB_CLIENT_ID = '990879053044-vubp6ad3prcllj34ou11rto4vmin6l5k.apps.googleusercontent.com'

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function isMoriusRootUrl(url: string): boolean {
  const parsedUrl = parseUrl(url)
  if (!parsedUrl) {
    return false
  }
  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '') || '/'
  return parsedUrl.origin === MORIUS_SITE_ORIGIN && normalizedPath === '/'
}

export function buildMoriusEntryUrlFrom(url: string): string {
  const parsedUrl = parseUrl(url)
  if (!parsedUrl) {
    return MORIUS_ENTRY_URL
  }
  return `${MORIUS_ENTRY_URL}${parsedUrl.search}${parsedUrl.hash}`
}
