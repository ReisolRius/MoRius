function readEnvString(name: 'VITE_API_URL' | 'VITE_AUTH_API_URL' | 'VITE_STORY_API_URL' | 'VITE_PAYMENTS_API_URL'): {
  value: string
  isDefined: boolean
} {
  const rawValue = import.meta.env[name] as string | undefined
  if (rawValue === undefined) {
    return { value: '', isDefined: false }
  }
  return { value: rawValue.trim(), isDefined: true }
}

const apiUrlEnv = readEnvString('VITE_API_URL')
const authApiUrlEnv = readEnvString('VITE_AUTH_API_URL')
const storyApiUrlEnv = readEnvString('VITE_STORY_API_URL')
const paymentsApiUrlEnv = readEnvString('VITE_PAYMENTS_API_URL')
const rawGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()

const isBrowserRuntime = typeof window !== 'undefined'
const runtimeHostname = isBrowserRuntime ? window.location.hostname : ''
const isLocalRuntime =
  runtimeHostname === 'localhost' ||
  runtimeHostname === '127.0.0.1' ||
  runtimeHostname === '::1' ||
  runtimeHostname === '[::1]'
const defaultApiUrl = isLocalRuntime ? 'http://localhost:8000' : ''

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')
    )
  } catch {
    return false
  }
}

function resolveConfiguredApiUrl(envValue: { value: string; isDefined: boolean }): string | undefined {
  if (!envValue.isDefined) {
    return undefined
  }
  if (!envValue.value) {
    // Explicit empty value means same-origin (/api/...).
    return ''
  }
  // Safety: on public domains ignore accidental localhost config.
  if (!isLocalRuntime && isLoopbackHttpUrl(envValue.value)) {
    return ''
  }
  return envValue.value
}

const isGoogleClientIdPlaceholder =
  !rawGoogleClientId ||
  rawGoogleClientId.includes('your_google_client_id') ||
  rawGoogleClientId === 'undefined'

const configuredApiBaseUrl = resolveConfiguredApiUrl(apiUrlEnv)
const configuredAuthApiUrl = resolveConfiguredApiUrl(authApiUrlEnv)
const configuredStoryApiUrl = resolveConfiguredApiUrl(storyApiUrlEnv)
const configuredPaymentsApiUrl = resolveConfiguredApiUrl(paymentsApiUrlEnv)

export const API_BASE_URL = configuredApiBaseUrl ?? defaultApiUrl
export const AUTH_API_BASE_URL = configuredAuthApiUrl ?? API_BASE_URL
export const STORY_API_BASE_URL = configuredStoryApiUrl ?? API_BASE_URL
export const PAYMENTS_API_BASE_URL = configuredPaymentsApiUrl ?? API_BASE_URL

export const GOOGLE_CLIENT_ID = isGoogleClientIdPlaceholder ? null : rawGoogleClientId

export const IS_GOOGLE_AUTH_CONFIGURED =
  Boolean(GOOGLE_CLIENT_ID) && GOOGLE_CLIENT_ID!.endsWith('.apps.googleusercontent.com')
