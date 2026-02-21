import type { AuthResponse, AuthUser } from '../types/auth'
import { API_BASE_URL } from '../config/env'

type RequestOptions = RequestInit & {
  skipJsonContentType?: boolean
}

type MessageResponse = {
  message: string
}

export type CoinTopUpPlan = {
  id: string
  title: string
  description: string
  price_rub: number
  coins: number
}

type CoinPlanListResponse = {
  plans: CoinTopUpPlan[]
}

export type CoinTopUpCreateResponse = {
  payment_id: string
  confirmation_url: string
  status: string
}

export type CoinTopUpSyncResponse = {
  payment_id: string
  status: string
  coins: number
  user: AuthUser
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  if (!options.skipJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
  } catch {
    throw new Error(
      `Не удалось подключиться к API (${API_BASE_URL}). Проверьте, что backend запущен и CORS разрешает ваш origin.`,
    )
  }

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = (await response.json()) as { detail?: string }
      detail = payload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}

export async function registerWithEmail(payload: {
  email: string
  password: string
}): Promise<MessageResponse> {
  return request<MessageResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function verifyEmailRegistration(payload: {
  email: string
  code: string
}): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginWithEmail(payload: {
  email: string
  password: string
}): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken }),
  })
}

export async function getCurrentUser(token: string): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function updateCurrentUserAvatar(payload: {
  token: string
  avatar_url: string | null
  avatar_scale?: number
}): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/me/avatar', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      avatar_url: payload.avatar_url,
      avatar_scale: payload.avatar_scale ?? null,
    }),
  })
}

export async function getCoinTopUpPlans(): Promise<CoinTopUpPlan[]> {
  const response = await request<CoinPlanListResponse>('/api/payments/plans', {
    method: 'GET',
  })
  return response.plans
}

export async function createCoinTopUpPayment(payload: {
  token: string
  plan_id: string
}): Promise<CoinTopUpCreateResponse> {
  return request<CoinTopUpCreateResponse>('/api/payments/create', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({ plan_id: payload.plan_id }),
  })
}

export async function syncCoinTopUpPayment(payload: {
  token: string
  payment_id: string
}): Promise<CoinTopUpSyncResponse> {
  return request<CoinTopUpSyncResponse>(`/api/payments/${payload.payment_id}/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}
