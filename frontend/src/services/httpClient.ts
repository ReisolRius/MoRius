import {
  API_BASE_URL,
  AUTH_API_BASE_URL,
  PAYMENTS_API_BASE_URL,
  STORY_API_BASE_URL,
} from '../config/env'

export type RequestOptions = RequestInit & {
  skipJsonContentType?: boolean
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function resolveApiBaseUrl(path: string): string {
  if (path.startsWith('/api/auth')) {
    return AUTH_API_BASE_URL
  }
  if (path.startsWith('/api/story')) {
    return STORY_API_BASE_URL
  }
  if (path.startsWith('/api/payments')) {
    return PAYMENTS_API_BASE_URL
  }
  return API_BASE_URL
}

function buildOriginAndBasePath(baseUrl: string): { origin: string; basePath: string } {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl.trim())
  if (!normalizedBaseUrl) {
    return { origin: '', basePath: '' }
  }

  if (/^https?:\/\//i.test(normalizedBaseUrl)) {
    try {
      const parsed = new URL(normalizedBaseUrl)
      return {
        origin: `${parsed.protocol}//${parsed.host}`,
        basePath: trimTrailingSlash(parsed.pathname),
      }
    } catch {
      return { origin: normalizedBaseUrl, basePath: '' }
    }
  }

  return {
    origin: '',
    basePath: `/${trimLeadingSlash(normalizedBaseUrl)}`,
  }
}

export function buildApiUrl(path: string): string {
  const { origin, basePath } = buildOriginAndBasePath(resolveApiBaseUrl(path))
  if (!basePath || basePath === '/') {
    return `${origin}${path}`
  }
  if (path === basePath || path.startsWith(`${basePath}/`)) {
    return `${origin}${path}`
  }
  return `${origin}${basePath}${path}`
}

function buildNetworkErrorMessage(path: string, customMessage?: string): string {
  if (customMessage && customMessage.trim()) {
    return customMessage
  }
  const resolved = resolveApiBaseUrl(path).trim()
  const endpoint = resolved || 'same-origin'
  return `Failed to connect to API (${endpoint}).`
}

export async function parseApiError(response: Response, fallbackDetail = 'Request failed'): Promise<Error> {
  let detail = fallbackDetail
  try {
    const payload = (await response.json()) as { detail?: string }
    detail = payload.detail || detail
  } catch {
    // Keep fallback detail.
  }
  return new Error(detail)
}

async function executeRequest(
  path: string,
  options: RequestOptions = {},
  networkErrorMessage?: string,
): Promise<Response> {
  const headers = new Headers(options.headers ?? {})
  if (!options.skipJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  try {
    return await fetch(buildApiUrl(path), {
      ...options,
      headers,
    })
  } catch {
    throw new Error(buildNetworkErrorMessage(path, networkErrorMessage))
  }
}

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
  networkErrorMessage?: string,
): Promise<T> {
  const response = await executeRequest(path, options, networkErrorMessage)
  if (!response.ok) {
    throw await parseApiError(response)
  }
  return (await response.json()) as T
}

export async function requestNoContent(
  path: string,
  options: RequestOptions = {},
  networkErrorMessage?: string,
): Promise<void> {
  const response = await executeRequest(path, options, networkErrorMessage)
  if (!response.ok) {
    throw await parseApiError(response)
  }
}
