import type { AuthResponse, AuthUser } from '../types/auth'
import { requestJson } from './httpClient'

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

const AUTH_NETWORK_ERROR =
  'Не удалось подключиться к API. Проверьте, что backend запущен и CORS разрешает ваш origin.'

export async function registerWithEmail(payload: { email: string; password: string }): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    '/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function verifyEmailRegistration(payload: { email: string; code: string }): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/api/auth/register/verify',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function loginWithEmail(payload: { email: string; password: string }): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/api/auth/google',
    {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getCurrentUser(token: string): Promise<AuthUser> {
  return requestJson<AuthUser>(
    '/api/auth/me',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateCurrentUserAvatar(payload: {
  token: string
  avatar_url: string | null
  avatar_scale?: number
}): Promise<AuthUser> {
  return requestJson<AuthUser>(
    '/api/auth/me/avatar',
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        avatar_url: payload.avatar_url,
        avatar_scale: payload.avatar_scale ?? null,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateCurrentUserProfile(payload: {
  token: string
  display_name: string
}): Promise<AuthUser> {
  return requestJson<AuthUser>(
    '/api/auth/me/profile',
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        display_name: payload.display_name,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getCoinTopUpPlans(): Promise<CoinTopUpPlan[]> {
  const response = await requestJson<CoinPlanListResponse>('/api/payments/plans', { method: 'GET' })
  return response.plans
}

export async function createCoinTopUpPayment(payload: {
  token: string
  plan_id: string
}): Promise<CoinTopUpCreateResponse> {
  return requestJson<CoinTopUpCreateResponse>(
    '/api/payments/create',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({ plan_id: payload.plan_id }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function syncCoinTopUpPayment(payload: {
  token: string
  payment_id: string
}): Promise<CoinTopUpSyncResponse> {
  return requestJson<CoinTopUpSyncResponse>(
    `/api/payments/${payload.payment_id}/sync`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}
