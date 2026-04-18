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

export function resolveApiResourceUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return null
  }
  if (
    /^https?:\/\//i.test(normalizedValue) ||
    normalizedValue.startsWith('data:') ||
    normalizedValue.startsWith('blob:')
  ) {
    return normalizedValue
  }
  if (normalizedValue.startsWith('/api/media/')) {
    return buildApiUrl(normalizedValue)
  }
  return normalizedValue
}

export function normalizeApiMediaPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApiMediaPayload(item)) as T
  }

  if (typeof value === 'string') {
    return resolveApiResourceUrl(value) as T
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const entries = Object.entries(value as Record<string, unknown>)
  let hasChanges = false
  const nextObject: Record<string, unknown> = {}

  entries.forEach(([key, entryValue]) => {
    const nextValue = normalizeApiMediaPayload(entryValue)
    nextObject[key] = nextValue
    if (!Object.is(nextValue, entryValue)) {
      hasChanges = true
    }
  })

  return (hasChanges ? nextObject : value) as T
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
  if (detail === fallbackDetail) {
    if (response.status === 413) {
      detail =
        'Слишком большой запрос (HTTP 413). Обычно это значит, что итоговое изображение после кропа и кодирования стало слишком тяжёлым для отправки, даже если исходный файл был меньше лимита.'
    } else {
      detail = `${fallbackDetail} (HTTP ${response.status})`
    }
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
    const method = String(options.method ?? 'GET').toUpperCase()
    return await fetch(buildApiUrl(path), {
      ...options,
      headers,
      cache: options.cache ?? (method === 'GET' || method === 'HEAD' ? 'no-store' : undefined),
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
  return normalizeApiMediaPayload((await response.json()) as T)
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
