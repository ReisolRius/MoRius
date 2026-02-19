const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
const rawGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()

const isGoogleClientIdPlaceholder =
  !rawGoogleClientId ||
  rawGoogleClientId.includes('your_google_client_id') ||
  rawGoogleClientId === 'undefined'

export const API_BASE_URL = rawApiUrl || 'http://localhost:8000'

export const GOOGLE_CLIENT_ID = isGoogleClientIdPlaceholder ? null : rawGoogleClientId

export const IS_GOOGLE_AUTH_CONFIGURED =
  Boolean(GOOGLE_CLIENT_ID) && GOOGLE_CLIENT_ID!.endsWith('.apps.googleusercontent.com')
