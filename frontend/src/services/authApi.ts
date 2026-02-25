import type { AuthResponse, AuthUser } from '../types/auth'
import type { StoryCommunityWorldSummary, StoryGameSummary } from '../types/story'
import { requestJson } from './httpClient'

type MessageResponse = {
  message: string
}

export type ProfilePrivacySettings = {
  show_subscriptions: boolean
  show_public_worlds: boolean
  show_private_worlds: boolean
}

export type ProfileSubscriptionUser = {
  id: number
  display_name: string
  avatar_url: string | null
  avatar_scale: number
}

export type ProfileUserView = {
  id: number
  display_name: string
  profile_description: string
  avatar_url: string | null
  avatar_scale: number
  created_at: string
}

export type ProfileView = {
  user: ProfileUserView
  is_self: boolean
  is_following: boolean
  followers_count: number
  subscriptions_count: number
  privacy: ProfilePrivacySettings
  can_view_subscriptions: boolean
  can_view_public_worlds: boolean
  can_view_private_worlds: boolean
  subscriptions: ProfileSubscriptionUser[]
  published_worlds: StoryCommunityWorldSummary[]
  unpublished_worlds: StoryGameSummary[]
}

export type ProfileFollowState = {
  is_following: boolean
  followers_count: number
  subscriptions_count: number
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

export type AdminManagedUser = {
  id: number
  email: string
  display_name: string | null
  role: string
  coins: number
  is_banned: boolean
  ban_expires_at: string | null
  created_at: string
}

type AdminUserListResponse = {
  users: AdminManagedUser[]
}

export type AdminWorldReport = {
  world_id: number
  world_title: string
  world_cover_image_url: string | null
  world_author_name: string
  open_reports_count: number
  latest_reason: 'cp' | 'politics' | 'racism' | 'nationalism' | 'other'
  latest_description: string
  latest_created_at: string
}

type AdminWorldReportListResponse = {
  reports: AdminWorldReport[]
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
  display_name?: string
  profile_description?: string
}): Promise<AuthUser> {
  const requestBody: Record<string, string | null> = {}
  if (typeof payload.display_name === 'string') {
    requestBody.display_name = payload.display_name
  }
  if (typeof payload.profile_description === 'string') {
    requestBody.profile_description = payload.profile_description
  }
  return requestJson<AuthUser>(
    '/api/auth/me/profile',
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify(requestBody),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getProfileView(payload: {
  token: string
  user_id?: number | null
}): Promise<ProfileView> {
  const hasTargetUser = typeof payload.user_id === 'number' && Number.isFinite(payload.user_id) && payload.user_id > 0
  const path = hasTargetUser ? `/api/auth/profiles/${payload.user_id}` : '/api/auth/profiles/me'
  return requestJson<ProfileView>(
    path,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateCurrentUserProfilePrivacy(payload: {
  token: string
  show_subscriptions?: boolean
  show_public_worlds?: boolean
  show_private_worlds?: boolean
}): Promise<ProfilePrivacySettings> {
  const requestBody: Record<string, boolean> = {}
  if (typeof payload.show_subscriptions === 'boolean') {
    requestBody.show_subscriptions = payload.show_subscriptions
  }
  if (typeof payload.show_public_worlds === 'boolean') {
    requestBody.show_public_worlds = payload.show_public_worlds
  }
  if (typeof payload.show_private_worlds === 'boolean') {
    requestBody.show_private_worlds = payload.show_private_worlds
  }

  return requestJson<ProfilePrivacySettings>(
    '/api/auth/profiles/me/privacy',
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify(requestBody),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function followUserProfile(payload: {
  token: string
  user_id: number
}): Promise<ProfileFollowState> {
  return requestJson<ProfileFollowState>(
    `/api/auth/profiles/${payload.user_id}/follow`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function unfollowUserProfile(payload: {
  token: string
  user_id: number
}): Promise<ProfileFollowState> {
  return requestJson<ProfileFollowState>(
    `/api/auth/profiles/${payload.user_id}/follow`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function searchUsersForAdminPanel(payload: {
  token: string
  query?: string
  limit?: number
}): Promise<AdminManagedUser[]> {
  const query = encodeURIComponent((payload.query ?? '').trim())
  const limit = Math.max(1, Math.min(payload.limit ?? 30, 100))
  const response = await requestJson<AdminUserListResponse>(
    `/api/auth/admin/users?query=${query}&limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return response.users
}

export async function updateUserTokensAsAdmin(payload: {
  token: string
  user_id: number
  operation: 'add' | 'subtract'
  amount: number
}): Promise<AdminManagedUser> {
  return requestJson<AdminManagedUser>(
    `/api/auth/admin/users/${payload.user_id}/tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        operation: payload.operation,
        amount: payload.amount,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function banUserAsAdmin(payload: {
  token: string
  user_id: number
  duration_hours?: number | null
}): Promise<AdminManagedUser> {
  return requestJson<AdminManagedUser>(
    `/api/auth/admin/users/${payload.user_id}/ban`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        duration_hours: payload.duration_hours ?? null,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function unbanUserAsAdmin(payload: {
  token: string
  user_id: number
}): Promise<AdminManagedUser> {
  return requestJson<AdminManagedUser>(
    `/api/auth/admin/users/${payload.user_id}/unban`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function listOpenWorldReportsForAdmin(payload: {
  token: string
}): Promise<AdminWorldReport[]> {
  const response = await requestJson<AdminWorldReportListResponse>(
    '/api/auth/admin/reports',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return response.reports
}

export async function dismissWorldReportsAsAdmin(payload: {
  token: string
  world_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/worlds/${payload.world_id}/dismiss`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function removeWorldFromCommunityAsAdmin(payload: {
  token: string
  world_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/worlds/${payload.world_id}/remove`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
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
