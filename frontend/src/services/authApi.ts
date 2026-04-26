import type { AuthResponse, AuthUser } from '../types/auth'
import type {
  StoryCharacter,
  StoryCommunityCharacterSummary,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldSummary,
  StoryGamePayload,
  StoryGameSummary,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryPlotCard,
  StoryPublicationState,
  StoryWorldCard,
} from '../types/story'
import { requestJson } from './httpClient'

type MessageResponse = {
  message: string
}

export type ProfilePrivacySettings = {
  show_subscriptions: boolean
  show_public_worlds: boolean
  show_private_worlds: boolean
  show_public_characters?: boolean
  show_public_instruction_templates?: boolean
}

export type DailyRewardDay = {
  day: number
  amount: number
  is_claimed: boolean
  is_current: boolean
  is_locked: boolean
}

export type DailyRewardStatus = {
  server_time: string
  current_day: number | null
  claimed_days: number
  can_claim: boolean
  is_completed: boolean
  next_claim_at: string | null
  last_claimed_at: string | null
  cycle_started_at: string | null
  reward_amount: number | null
  claimed_reward_amount?: number | null
  claimed_reward_day?: number | null
  days: DailyRewardDay[]
}

export type ThemeStorySettings = {
  font_family: 'default' | 'inter' | 'verdana'
  font_weight: 'regular' | 'medium' | 'bold'
  narrative_italic: boolean
  corrected_text_color: string
  player_text_color: string
  assistant_text_color: string
}

export type UserCustomTheme = {
  id: string
  name: string
  description: string
  palette: {
    title_text: string
    text_primary: string
    background: string
    surface: string
    front: string
    input: string
  }
  story: ThemeStorySettings
}

export type CurrentUserThemeSettings = {
  active_theme_kind: 'preset' | 'custom'
  active_theme_id: string
  story: ThemeStorySettings
  custom_themes: UserCustomTheme[]
}

export const CURRENT_USER_CUSTOM_THEME_LIMIT = 5
export type AdminModerationAuthor = {
  id: number
  email: string
  display_name: string
  avatar_url: string | null
  role: string
}

export type AdminModerationQueueItem = {
  target_type: 'world' | 'character' | 'instruction_template'
  target_id: number
  target_title: string
  target_description: string
  target_preview_image_url: string | null
  author: AdminModerationAuthor
  publication: StoryPublicationState
  created_at: string
  updated_at: string
}

export type AdminModerationWorldDetail = {
  author: AdminModerationAuthor
  game: StoryGameSummary
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  world_cards: StoryWorldCard[]
}

export type AdminModerationCharacterDetail = {
  author: AdminModerationAuthor
  character: StoryCharacter
}

export type AdminModerationInstructionTemplateDetail = {
  author: AdminModerationAuthor
  template: StoryInstructionTemplate
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
  world_card_templates_count: number
  privacy: ProfilePrivacySettings
  can_view_subscriptions: boolean
  can_view_public_worlds: boolean
  can_view_public_characters: boolean
  can_view_public_instruction_templates: boolean
  can_view_private_worlds: boolean
  subscriptions: ProfileSubscriptionUser[]
  published_worlds: StoryCommunityWorldSummary[]
  published_characters: StoryCommunityCharacterSummary[]
  published_instruction_templates: StoryCommunityInstructionTemplateSummary[]
  unpublished_worlds: StoryGameSummary[]
}

export type UserNotification = {
  id: number
  kind: string
  title: string
  body: string
  action_url: string | null
  is_read: boolean
  actor_user_id: number | null
  actor_display_name: string | null
  actor_avatar_url: string | null
  created_at: string
}

export type UserNotificationCounters = {
  unread_count: number
  total_count: number
}

export type ProfileFollowState = {
  is_following: boolean
  followers_count: number
  subscriptions_count: number
}

export type DashboardNewsCard = {
  id: number
  slot: number
  category: string
  title: string
  description: string
  image_url: string | null
  date_label: string
}

export type OnboardingGuideStatus = 'pending' | 'completed' | 'skipped'

export type OnboardingGuideState = {
  status: OnboardingGuideStatus
  current_step_id: string | null
  tutorial_game_id: number | null
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
  referral_bonus_granted?: boolean
  referral_bonus_amount?: number
  user: AuthUser
}

export type ReferralSummary = {
  referral_code: string
  paid_referrals_count: number
  referral_pending_purchase: boolean
  pending_bonus_amount: number
}

export type ReferralApplyResponse = {
  ok: boolean
  reason: string
  message: string
  referral_pending_purchase: boolean
  pending_bonus_amount: number
  referrer_user_id: number | null
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
  total_count: number
  has_more: boolean
}

export type UserNotificationListResponse = {
  items: UserNotification[]
  unread_count: number
  total_count: number
  limit: number
  offset: number
  has_more: boolean
}

export type AdminReportTargetType = 'world' | 'character' | 'instruction_template'
export type AdminReportReason = 'cp' | 'politics' | 'racism' | 'nationalism' | 'other'

export type AdminReport = {
  target_type: AdminReportTargetType
  target_id: number
  target_title: string
  target_preview_image_url: string | null
  target_author_name: string
  open_reports_count: number
  latest_reason: AdminReportReason
  latest_description: string
  latest_created_at: string
}

type AdminReportListResponse = {
  reports: AdminReport[]
}

export type AdminBugReportSummary = {
  id: number
  source_game_id: number
  source_game_title: string
  reporter_user_id: number
  reporter_name: string
  title: string
  description: string
  created_at: string
}

type AdminBugReportListResponse = {
  reports: AdminBugReportSummary[]
}

export type AdminBugReportDetail = {
  id: number
  source_game_id: number
  source_game_title: string
  reporter_user_id: number
  reporter_name: string
  title: string
  description: string
  created_at: string
  snapshot: StoryGamePayload
}

const AUTH_NETWORK_ERROR =
  'Не удалось подключиться к API. Проверьте, что backend запущен и CORS разрешает ваш origin.'

function normalizeProfilePrivacySettings(value: ProfilePrivacySettings | null | undefined): ProfilePrivacySettings {
  return {
    show_subscriptions: Boolean(value?.show_subscriptions),
    show_public_worlds: Boolean(value?.show_public_worlds),
    show_private_worlds: Boolean(value?.show_private_worlds),
    show_public_characters: Boolean(value?.show_public_characters),
    show_public_instruction_templates: Boolean(value?.show_public_instruction_templates),
  }
}

function normalizeDailyRewardStatus(value: DailyRewardStatus | null | undefined): DailyRewardStatus {
  const rawDays = Array.isArray(value?.days) ? value?.days : []
  return {
    server_time: typeof value?.server_time === 'string' ? value.server_time : new Date().toISOString(),
    current_day: typeof value?.current_day === 'number' && Number.isFinite(value.current_day) ? Math.trunc(value.current_day) : null,
    claimed_days: typeof value?.claimed_days === 'number' && Number.isFinite(value.claimed_days) ? Math.max(0, Math.trunc(value.claimed_days)) : 0,
    can_claim: Boolean(value?.can_claim),
    is_completed: Boolean(value?.is_completed),
    next_claim_at: typeof value?.next_claim_at === 'string' ? value.next_claim_at : null,
    last_claimed_at: typeof value?.last_claimed_at === 'string' ? value.last_claimed_at : null,
    cycle_started_at: typeof value?.cycle_started_at === 'string' ? value.cycle_started_at : null,
    reward_amount: typeof value?.reward_amount === 'number' && Number.isFinite(value.reward_amount) ? Math.trunc(value.reward_amount) : null,
    claimed_reward_amount:
      typeof value?.claimed_reward_amount === 'number' && Number.isFinite(value.claimed_reward_amount)
        ? Math.trunc(value.claimed_reward_amount)
        : null,
    claimed_reward_day:
      typeof value?.claimed_reward_day === 'number' && Number.isFinite(value.claimed_reward_day)
        ? Math.trunc(value.claimed_reward_day)
        : null,
    days: rawDays.map((item, index) => ({
      day: typeof item?.day === 'number' && Number.isFinite(item.day) ? Math.trunc(item.day) : index + 1,
      amount: typeof item?.amount === 'number' && Number.isFinite(item.amount) ? Math.trunc(item.amount) : 0,
      is_claimed: Boolean(item?.is_claimed),
      is_current: Boolean(item?.is_current),
      is_locked: Boolean(item?.is_locked),
    })),
  }
}

function normalizeCurrentUserThemeSettings(
  value: CurrentUserThemeSettings | null | undefined,
): CurrentUserThemeSettings {
  const story = value?.story
  const customThemes = Array.isArray(value?.custom_themes) ? value.custom_themes : []
  return {
    active_theme_kind: value?.active_theme_kind === 'custom' ? 'custom' : 'preset',
    active_theme_id: typeof value?.active_theme_id === 'string' && value.active_theme_id.trim() ? value.active_theme_id : 'classic-dark',
    story: {
      font_family: story?.font_family === 'inter' || story?.font_family === 'verdana' ? story.font_family : 'default',
      font_weight: story?.font_weight === 'medium' || story?.font_weight === 'bold' ? story.font_weight : 'regular',
      narrative_italic: Boolean(story?.narrative_italic),
      corrected_text_color:
        typeof story?.corrected_text_color === 'string' && story.corrected_text_color.trim()
          ? story.corrected_text_color
          : '#578EEE',
      player_text_color:
        typeof story?.player_text_color === 'string' && story.player_text_color.trim()
          ? story.player_text_color
          : '#A4ADB6',
      assistant_text_color:
        typeof story?.assistant_text_color === 'string' && story.assistant_text_color.trim()
          ? story.assistant_text_color
          : '#DBDDE7',
    },
    custom_themes: customThemes
      .filter((item): item is UserCustomTheme => Boolean(item) && typeof item === 'object')
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `custom-${index + 1}`,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : `Тема ${index + 1}`,
        description: typeof item.description === 'string' ? item.description : '',
        palette: {
          title_text: typeof item.palette?.title_text === 'string' ? item.palette.title_text : '#F4F1EA',
          text_primary: typeof item.palette?.text_primary === 'string' ? item.palette.text_primary : '#E5E0D8',
          background: typeof item.palette?.background === 'string' ? item.palette.background : '#111111',
          surface: typeof item.palette?.surface === 'string' ? item.palette.surface : '#171716',
          front: typeof item.palette?.front === 'string' ? item.palette.front : '#578EEE',
          input: typeof item.palette?.input === 'string' ? item.palette.input : '#262624',
        },
        story: normalizeCurrentUserThemeSettings({
          active_theme_kind: 'preset',
          active_theme_id: 'classic-dark',
          story: item.story,
          custom_themes: [],
        }).story,
      })),
  }
}

function extractCompatToken(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && typeof (value as { token?: unknown }).token === 'string') {
    return (value as { token: string }).token
  }
  return ''
}

function extractCompatNumber(value: unknown, ...keys: string[]): number {
  if (!value || typeof value !== 'object') {
    return 0
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.trunc(candidate)
    }
  }
  return 0
}

function buildCompatAuthHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function normalizeProfileSubscriptionUsers(
  value: ProfileView['subscriptions'] | null | undefined,
): ProfileSubscriptionUser[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is ProfileSubscriptionUser => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'number' && Number.isFinite(item.id) ? Math.trunc(item.id) : 0,
      display_name: typeof item.display_name === 'string' ? item.display_name : '',
      avatar_url: typeof item.avatar_url === 'string' ? item.avatar_url : null,
      avatar_scale:
        typeof item.avatar_scale === 'number' && Number.isFinite(item.avatar_scale)
          ? Math.max(1, Math.min(3, item.avatar_scale))
          : 1,
    }))
    .filter((item) => item.id > 0)
}

function normalizeProfileUserView(value: ProfileView['user'] | null | undefined): ProfileView['user'] {
  if (!value) {
    return {
      id: 0,
      display_name: '',
      profile_description: '',
      avatar_url: null,
      avatar_scale: 1,
      created_at: new Date(0).toISOString(),
    }
  }
  return {
    id: typeof value.id === 'number' && Number.isFinite(value.id) ? Math.trunc(value.id) : 0,
    display_name: typeof value.display_name === 'string' ? value.display_name : '',
    profile_description: typeof value.profile_description === 'string' ? value.profile_description : '',
    avatar_url: typeof value.avatar_url === 'string' ? value.avatar_url : null,
    avatar_scale:
      typeof value.avatar_scale === 'number' && Number.isFinite(value.avatar_scale)
        ? Math.max(1, Math.min(3, value.avatar_scale))
        : 1,
    created_at: typeof value.created_at === 'string' ? value.created_at : new Date(0).toISOString(),
  }
}

function normalizeProfileViewPayload(rawView: ProfileView): ProfileView {
  const view = rawView as Partial<ProfileView>
  return {
    user: normalizeProfileUserView(view.user ?? null),
    is_self: Boolean(view.is_self),
    is_following: Boolean(view.is_following),
    followers_count:
      typeof view.followers_count === 'number' && Number.isFinite(view.followers_count)
        ? Math.max(0, Math.trunc(view.followers_count))
        : 0,
    subscriptions_count:
      typeof view.subscriptions_count === 'number' && Number.isFinite(view.subscriptions_count)
        ? Math.max(0, Math.trunc(view.subscriptions_count))
        : 0,
    world_card_templates_count:
      typeof view.world_card_templates_count === 'number' && Number.isFinite(view.world_card_templates_count)
        ? Math.max(0, Math.trunc(view.world_card_templates_count))
        : 0,
    privacy: normalizeProfilePrivacySettings(view.privacy ?? null),
    can_view_subscriptions: Boolean(view.can_view_subscriptions),
    can_view_public_worlds: Boolean(view.can_view_public_worlds),
    can_view_public_characters: Boolean(view.can_view_public_characters),
    can_view_public_instruction_templates: Boolean(view.can_view_public_instruction_templates),
    can_view_private_worlds: Boolean(view.can_view_private_worlds),
    subscriptions: normalizeProfileSubscriptionUsers(view.subscriptions ?? []),
    published_worlds: Array.isArray(view.published_worlds) ? view.published_worlds : [],
    published_characters: Array.isArray(view.published_characters) ? view.published_characters : [],
    published_instruction_templates: Array.isArray(view.published_instruction_templates) ? view.published_instruction_templates : [],
    unpublished_worlds: Array.isArray(view.unpublished_worlds) ? view.unpublished_worlds : [],
  }
}

function normalizeUserNotification(
  value: UserNotification | null | undefined,
): UserNotification {
  return {
    id: typeof value?.id === 'number' && Number.isFinite(value.id) ? Math.trunc(value.id) : 0,
    kind: typeof value?.kind === 'string' && value.kind.trim() ? value.kind : 'generic',
    title: typeof value?.title === 'string' ? value.title : '',
    body: typeof value?.body === 'string' ? value.body : '',
    action_url: typeof value?.action_url === 'string' && value.action_url.trim() ? value.action_url : null,
    is_read: Boolean(value?.is_read),
    actor_user_id:
      typeof value?.actor_user_id === 'number' && Number.isFinite(value.actor_user_id)
        ? Math.trunc(value.actor_user_id)
        : null,
    actor_display_name: typeof value?.actor_display_name === 'string' ? value.actor_display_name : null,
    actor_avatar_url: typeof value?.actor_avatar_url === 'string' ? value.actor_avatar_url : null,
    created_at: typeof value?.created_at === 'string' ? value.created_at : new Date(0).toISOString(),
  }
}

function normalizeUserNotifications(
  value: UserNotification[] | null | undefined,
): UserNotification[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is UserNotification => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeUserNotification(item))
    .filter((item) => item.id > 0)
}

function normalizeUserNotificationCounters(
  value: UserNotificationCounters | null | undefined,
): UserNotificationCounters {
  return {
    unread_count:
      typeof value?.unread_count === 'number' && Number.isFinite(value.unread_count)
        ? Math.max(0, Math.trunc(value.unread_count))
        : 0,
    total_count:
      typeof value?.total_count === 'number' && Number.isFinite(value.total_count)
        ? Math.max(0, Math.trunc(value.total_count))
        : 0,
  }
}

function normalizeUserNotificationListResponse(
  value: UserNotificationListResponse | null | undefined,
): UserNotificationListResponse {
  return {
    items: normalizeUserNotifications(value?.items),
    unread_count: normalizeUserNotificationCounters(value).unread_count,
    total_count: normalizeUserNotificationCounters(value).total_count,
    limit:
      typeof value?.limit === 'number' && Number.isFinite(value.limit)
        ? Math.max(0, Math.trunc(value.limit))
        : 0,
    offset:
      typeof value?.offset === 'number' && Number.isFinite(value.offset)
        ? Math.max(0, Math.trunc(value.offset))
        : 0,
    has_more: Boolean(value?.has_more),
  }
}

function normalizeOnboardingGuideState(rawState: OnboardingGuideState | null | undefined): OnboardingGuideState {
  const status = rawState?.status === 'completed' || rawState?.status === 'skipped' ? rawState.status : 'pending'
  return {
    status,
    current_step_id: typeof rawState?.current_step_id === 'string' && rawState.current_step_id.trim() ? rawState.current_step_id.trim() : null,
    tutorial_game_id:
      typeof rawState?.tutorial_game_id === 'number' && Number.isFinite(rawState.tutorial_game_id) && rawState.tutorial_game_id > 0
        ? Math.trunc(rawState.tutorial_game_id)
        : null,
  }
}

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

export async function getOnboardingGuideState(token: string): Promise<OnboardingGuideState> {
  const response = await requestJson<OnboardingGuideState>(
    '/api/auth/me/onboarding-guide',
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeOnboardingGuideState(response)
}

export async function updateOnboardingGuideState(
  token: string,
  payload: Partial<OnboardingGuideState>,
): Promise<OnboardingGuideState> {
  const requestPayload: Record<string, OnboardingGuideState[keyof OnboardingGuideState] | null | undefined> = {}
  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    requestPayload.status = payload.status
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'current_step_id')) {
    requestPayload.current_step_id = payload.current_step_id ?? null
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'tutorial_game_id')) {
    requestPayload.tutorial_game_id = payload.tutorial_game_id ?? null
  }
  const response = await requestJson<OnboardingGuideState>(
    '/api/auth/me/onboarding-guide',
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestPayload),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeOnboardingGuideState(response)
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
  notifications_enabled?: boolean
  notify_comment_reply?: boolean
  notify_world_comment?: boolean
  notify_publication_review?: boolean
  notify_new_follower?: boolean
  notify_moderation_report?: boolean
  notify_moderation_queue?: boolean
  email_notifications_enabled?: boolean
}): Promise<AuthUser> {
  const requestBody: Record<string, string | boolean | null> = {}
  if (typeof payload.display_name === 'string') {
    requestBody.display_name = payload.display_name
  }
  if (typeof payload.profile_description === 'string') {
    requestBody.profile_description = payload.profile_description
  }
  if (typeof payload.notifications_enabled === 'boolean') {
    requestBody.notifications_enabled = payload.notifications_enabled
  }
  if (typeof payload.notify_comment_reply === 'boolean') {
    requestBody.notify_comment_reply = payload.notify_comment_reply
  }
  if (typeof payload.notify_world_comment === 'boolean') {
    requestBody.notify_world_comment = payload.notify_world_comment
  }
  if (typeof payload.notify_publication_review === 'boolean') {
    requestBody.notify_publication_review = payload.notify_publication_review
  }
  if (typeof payload.notify_new_follower === 'boolean') {
    requestBody.notify_new_follower = payload.notify_new_follower
  }
  if (typeof payload.notify_moderation_report === 'boolean') {
    requestBody.notify_moderation_report = payload.notify_moderation_report
  }
  if (typeof payload.notify_moderation_queue === 'boolean') {
    requestBody.notify_moderation_queue = payload.notify_moderation_queue
  }
  if (typeof payload.email_notifications_enabled === 'boolean') {
    requestBody.email_notifications_enabled = payload.email_notifications_enabled
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

export async function listCurrentUserNotifications(payload: {
  token: string
  limit?: number
  offset?: number
  order?: 'asc' | 'desc'
}): Promise<UserNotificationListResponse> {
  const params = new URLSearchParams()
  if (typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0) {
    params.set('limit', String(Math.max(1, Math.trunc(payload.limit))))
  }
  if (typeof payload.offset === 'number' && Number.isFinite(payload.offset) && payload.offset >= 0) {
    params.set('offset', String(Math.max(0, Math.trunc(payload.offset))))
  }
  if (payload.order === 'asc' || payload.order === 'desc') {
    params.set('order', payload.order)
  }
  const query = params.toString()
  const response = await requestJson<UserNotificationListResponse>(
    query ? `/api/auth/me/notifications?${query}` : '/api/auth/me/notifications',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeUserNotificationListResponse(response)
}

export async function getCurrentUserNotificationUnreadCount(payload: {
  token: string
}): Promise<UserNotificationCounters> {
  const response = await requestJson<UserNotificationCounters>(
    '/api/auth/me/notifications/unread-count',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeUserNotificationCounters(response)
}

export async function getCurrentUserNotificationSummary(payload: {
  token: string
}): Promise<UserNotificationCounters> {
  const response = await requestJson<UserNotificationCounters>(
    '/api/auth/me/notifications/summary',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeUserNotificationCounters(response)
}

export async function markAllCurrentUserNotificationsRead(payload: {
  token: string
}): Promise<UserNotificationCounters> {
  const response = await requestJson<UserNotificationCounters>(
    '/api/auth/me/notifications/read-all',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({}),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeUserNotificationCounters(response)
}

export async function deleteCurrentUserNotification(payload: {
  token: string
  notificationId: number
}): Promise<UserNotificationCounters> {
  const response = await requestJson<UserNotificationCounters>(
    `/api/auth/me/notifications/${payload.notificationId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeUserNotificationCounters(response)
}

export async function getProfileView(payload: {
  token: string
  user_id?: number | null
}): Promise<ProfileView> {
  const hasTargetUser = typeof payload.user_id === 'number' && Number.isFinite(payload.user_id) && payload.user_id > 0
  const path = hasTargetUser ? `/api/auth/profiles/${payload.user_id}` : '/api/auth/profiles/me'
  const response = await requestJson<ProfileView>(
    path,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeProfileViewPayload(response)
}

export async function updateCurrentUserProfilePrivacy(payload: {
  token: string
  show_subscriptions?: boolean
  show_public_worlds?: boolean
  show_private_worlds?: boolean
  show_public_characters?: boolean
  show_public_instruction_templates?: boolean
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
  if (typeof payload.show_public_characters === 'boolean') {
    requestBody.show_public_characters = payload.show_public_characters
  }
  if (typeof payload.show_public_instruction_templates === 'boolean') {
    requestBody.show_public_instruction_templates = payload.show_public_instruction_templates
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

export async function listDashboardNews(payload: { token: string }): Promise<DashboardNewsCard[]> {
  return requestJson<DashboardNewsCard[]>(
    '/api/auth/dashboard-news',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateDashboardNews(payload: {
  token: string
  news_id: number
  category: string
  title: string
  description: string
  image_url?: string | null
  date_label: string
}): Promise<DashboardNewsCard> {
  return requestJson<DashboardNewsCard>(
    `/api/auth/dashboard-news/${payload.news_id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        category: payload.category,
        title: payload.title,
        description: payload.description,
        image_url: payload.image_url ?? null,
        date_label: payload.date_label,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function searchUsersForAdminPanel(payload: {
  token: string
  query?: string
  limit?: number
  offset?: number
  sort?: 'created_desc' | 'coins_desc' | 'coins_asc'
}): Promise<AdminUserListResponse> {
  const query = encodeURIComponent((payload.query ?? '').trim())
  const limit = Math.max(1, Math.min(payload.limit ?? 30, 100))
  const offset = Math.max(0, Math.trunc(payload.offset ?? 0))
  const sort = encodeURIComponent(payload.sort ?? 'created_desc')
  return requestJson<AdminUserListResponse>(
    `/api/auth/admin/users?query=${query}&limit=${limit}&offset=${offset}&sort=${sort}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
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

export async function updateModeratorRoleAsAdmin(payload: {
  token: string
  user_id: number
  is_moderator: boolean
}): Promise<AdminManagedUser> {
  return requestJson<AdminManagedUser>(
    `/api/auth/admin/users/${payload.user_id}/moderator`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        is_moderator: payload.is_moderator,
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

export async function listOpenReportsForAdmin(payload: {
  token: string
}): Promise<AdminReport[]> {
  const response = await requestJson<AdminReportListResponse>(
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

export async function listBugReportsForAdmin(payload: {
  token: string
}): Promise<AdminBugReportSummary[]> {
  const response = await requestJson<AdminBugReportListResponse>(
    '/api/auth/admin/bug-reports',
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

export async function getBugReportForAdmin(payload: {
  token: string
  report_id: number
}): Promise<AdminBugReportDetail> {
  return requestJson<AdminBugReportDetail>(
    `/api/auth/admin/bug-reports/${payload.report_id}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function closeBugReportForAdmin(payload: {
  token: string
  report_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/bug-reports/${payload.report_id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
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

export async function dismissCharacterReportsAsAdmin(payload: {
  token: string
  character_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/characters/${payload.character_id}/dismiss`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function removeCharacterFromCommunityAsAdmin(payload: {
  token: string
  character_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/characters/${payload.character_id}/remove`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function dismissInstructionTemplateReportsAsAdmin(payload: {
  token: string
  template_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/instruction-templates/${payload.template_id}/dismiss`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function removeInstructionTemplateFromCommunityAsAdmin(payload: {
  token: string
  template_id: number
}): Promise<MessageResponse> {
  return requestJson<MessageResponse>(
    `/api/auth/admin/reports/instruction-templates/${payload.template_id}/remove`,
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

export async function getCurrentUserReferralSummary(payload: { token: string } | string): Promise<ReferralSummary> {
  const token = extractCompatToken(payload)
  const response = await requestJson<ReferralSummary>(
    '/api/referrals/me',
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
  return {
    referral_code: typeof response.referral_code === 'string' ? response.referral_code : '',
    paid_referrals_count:
      typeof response.paid_referrals_count === 'number' && Number.isFinite(response.paid_referrals_count)
        ? Math.max(0, Math.trunc(response.paid_referrals_count))
        : 0,
    referral_pending_purchase: Boolean(response.referral_pending_purchase),
    pending_bonus_amount:
      typeof response.pending_bonus_amount === 'number' && Number.isFinite(response.pending_bonus_amount)
        ? Math.max(0, Math.trunc(response.pending_bonus_amount))
        : 0,
  }
}

export async function applyReferralCode(payload: {
  token: string
  code: string
}): Promise<ReferralApplyResponse> {
  const response = await requestJson<ReferralApplyResponse>(
    '/api/referrals/apply',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({ code: payload.code }),
    },
    AUTH_NETWORK_ERROR,
  )
  return {
    ok: Boolean(response.ok),
    reason: typeof response.reason === 'string' ? response.reason : '',
    message: typeof response.message === 'string' ? response.message : '',
    referral_pending_purchase: Boolean(response.referral_pending_purchase),
    pending_bonus_amount:
      typeof response.pending_bonus_amount === 'number' && Number.isFinite(response.pending_bonus_amount)
        ? Math.max(0, Math.trunc(response.pending_bonus_amount))
        : 0,
    referrer_user_id:
      typeof response.referrer_user_id === 'number' && Number.isFinite(response.referrer_user_id)
        ? Math.trunc(response.referrer_user_id)
        : null,
  }
}

export async function getCurrentUserThemeSettings(payload: { token: string } | string): Promise<CurrentUserThemeSettings> {
  const token = extractCompatToken(payload)
  const response = await requestJson<CurrentUserThemeSettings>(
    '/api/auth/me/theme-settings',
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeCurrentUserThemeSettings(response)
}

export async function updateCurrentUserThemeSelection(payload: {
  token: string
  active_theme_kind: 'preset' | 'custom'
  active_theme_id: string
}): Promise<CurrentUserThemeSettings> {
  const response = await requestJson<CurrentUserThemeSettings>(
    '/api/auth/me/theme-settings',
    {
      method: 'PUT',
      headers: buildCompatAuthHeaders(payload.token),
      body: JSON.stringify({
        active_theme_kind: payload.active_theme_kind,
        active_theme_id: payload.active_theme_id,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeCurrentUserThemeSettings(response)
}

export async function createCurrentUserCustomTheme(payload: {
  token: string
  theme: UserCustomTheme
}): Promise<CurrentUserThemeSettings> {
  const currentSettings = await getCurrentUserThemeSettings(payload.token)
  const existingThemeIndex = currentSettings.custom_themes.findIndex((item) => item.id === payload.theme.id)
  if (existingThemeIndex < 0 && currentSettings.custom_themes.length >= CURRENT_USER_CUSTOM_THEME_LIMIT) {
    throw new Error(`Можно создать не более ${CURRENT_USER_CUSTOM_THEME_LIMIT} пользовательских тем.`)
  }
  const nextThemes =
    existingThemeIndex >= 0
      ? currentSettings.custom_themes.map((item) => (item.id === payload.theme.id ? payload.theme : item))
      : currentSettings.custom_themes.concat(payload.theme)
  const response = await requestJson<CurrentUserThemeSettings>(
    '/api/auth/me/theme-settings',
    {
      method: 'PUT',
      headers: buildCompatAuthHeaders(payload.token),
      body: JSON.stringify({
        active_theme_kind: 'custom',
        active_theme_id: payload.theme.id,
        story: payload.theme.story,
        custom_themes: nextThemes,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeCurrentUserThemeSettings(response)
}

export async function updateCurrentUserCustomTheme(payload: {
  token: string
  theme: UserCustomTheme
}): Promise<CurrentUserThemeSettings> {
  const currentSettings = await getCurrentUserThemeSettings(payload.token)
  const themeExists = currentSettings.custom_themes.some((item) => item.id === payload.theme.id)
  if (!themeExists) {
    return createCurrentUserCustomTheme(payload)
  }
  const response = await requestJson<CurrentUserThemeSettings>(
    '/api/auth/me/theme-settings',
    {
      method: 'PUT',
      headers: buildCompatAuthHeaders(payload.token),
      body: JSON.stringify({
        active_theme_kind: 'custom',
        active_theme_id: payload.theme.id,
        story: payload.theme.story,
        custom_themes: currentSettings.custom_themes.map((item) => (item.id === payload.theme.id ? payload.theme : item)),
      }),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeCurrentUserThemeSettings(response)
}

export async function deleteCurrentUserCustomTheme(payload: {
  token: string
  theme_id: string
}): Promise<CurrentUserThemeSettings> {
  const currentSettings = await getCurrentUserThemeSettings(payload.token)
  const nextThemes = currentSettings.custom_themes.filter((item) => item.id !== payload.theme_id)
  const nextActiveThemeId = currentSettings.active_theme_id === payload.theme_id ? 'classic-dark' : currentSettings.active_theme_id
  const nextActiveThemeKind =
    currentSettings.active_theme_kind === 'custom' && currentSettings.active_theme_id === payload.theme_id ? 'preset' : currentSettings.active_theme_kind
  const response = await requestJson<CurrentUserThemeSettings>(
    '/api/auth/me/theme-settings',
    {
      method: 'PUT',
      headers: buildCompatAuthHeaders(payload.token),
      body: JSON.stringify({
        active_theme_kind: nextActiveThemeKind,
        active_theme_id: nextActiveThemeId,
        custom_themes: nextThemes,
      }),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeCurrentUserThemeSettings(response)
}

export async function getCurrentUserDailyRewards(payload: { token: string } | string): Promise<DailyRewardStatus> {
  const token = extractCompatToken(payload)
  const response = await requestJson<DailyRewardStatus>(
    '/api/auth/me/daily-rewards',
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeDailyRewardStatus(response)
}

export async function claimCurrentUserDailyReward(payload: { token: string } | string): Promise<DailyRewardStatus> {
  const token = extractCompatToken(payload)
  const response = await requestJson<DailyRewardStatus>(
    '/api/auth/me/daily-rewards/claim',
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
  return normalizeDailyRewardStatus(response)
}

export async function listPendingModerationItemsForAdmin(payload: any): Promise<{ items: AdminModerationQueueItem[] }> {
  const token = extractCompatToken(payload)
  return requestJson<{ items: AdminModerationQueueItem[] }>(
    '/api/auth/admin/moderation',
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getModerationCharacterForAdmin(payload: any): Promise<AdminModerationCharacterDetail> {
  const token = extractCompatToken(payload)
  const characterId = extractCompatNumber(payload, 'character_id', 'characterId', 'id')
  return requestJson<AdminModerationCharacterDetail>(
    `/api/auth/admin/moderation/characters/${characterId}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateModerationCharacterForAdmin(payload: any): Promise<AdminModerationCharacterDetail> {
  const token = extractCompatToken(payload)
  const characterId = extractCompatNumber(payload, 'character_id', 'characterId', 'id')
  return requestJson<AdminModerationCharacterDetail>(
    `/api/auth/admin/moderation/characters/${characterId}`,
    {
      method: 'PATCH',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function approveModerationCharacterForAdmin(payload: any): Promise<AdminModerationCharacterDetail> {
  const token = extractCompatToken(payload)
  const characterId = extractCompatNumber(payload, 'character_id', 'characterId', 'id')
  return requestJson<AdminModerationCharacterDetail>(
    `/api/auth/admin/moderation/characters/${characterId}/approve`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function rejectModerationCharacterForAdmin(payload: any): Promise<AdminModerationCharacterDetail> {
  const token = extractCompatToken(payload)
  const characterId = extractCompatNumber(payload, 'character_id', 'characterId', 'id')
  return requestJson<AdminModerationCharacterDetail>(
    `/api/auth/admin/moderation/characters/${characterId}/reject`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getModerationInstructionTemplateForAdmin(payload: any): Promise<AdminModerationInstructionTemplateDetail> {
  const token = extractCompatToken(payload)
  const templateId = extractCompatNumber(payload, 'template_id', 'templateId', 'instruction_template_id', 'id')
  return requestJson<AdminModerationInstructionTemplateDetail>(
    `/api/auth/admin/moderation/instruction-templates/${templateId}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateModerationInstructionTemplateForAdmin(payload: any): Promise<AdminModerationInstructionTemplateDetail> {
  const token = extractCompatToken(payload)
  const templateId = extractCompatNumber(payload, 'template_id', 'templateId', 'instruction_template_id', 'id')
  return requestJson<AdminModerationInstructionTemplateDetail>(
    `/api/auth/admin/moderation/instruction-templates/${templateId}`,
    {
      method: 'PATCH',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function approveModerationInstructionTemplateForAdmin(payload: any): Promise<AdminModerationInstructionTemplateDetail> {
  const token = extractCompatToken(payload)
  const templateId = extractCompatNumber(payload, 'template_id', 'templateId', 'instruction_template_id', 'id')
  return requestJson<AdminModerationInstructionTemplateDetail>(
    `/api/auth/admin/moderation/instruction-templates/${templateId}/approve`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function rejectModerationInstructionTemplateForAdmin(payload: any): Promise<AdminModerationInstructionTemplateDetail> {
  const token = extractCompatToken(payload)
  const templateId = extractCompatNumber(payload, 'template_id', 'templateId', 'instruction_template_id', 'id')
  return requestJson<AdminModerationInstructionTemplateDetail>(
    `/api/auth/admin/moderation/instruction-templates/${templateId}/reject`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function getModerationWorldForAdmin(payload: any): Promise<AdminModerationWorldDetail> {
  const token = extractCompatToken(payload)
  const worldId = extractCompatNumber(payload, 'world_id', 'worldId', 'id')
  return requestJson<AdminModerationWorldDetail>(
    `/api/auth/admin/moderation/worlds/${worldId}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function updateModerationWorldForAdmin(payload: any): Promise<AdminModerationWorldDetail> {
  const token = extractCompatToken(payload)
  const worldId = extractCompatNumber(payload, 'world_id', 'worldId', 'id')
  return requestJson<AdminModerationWorldDetail>(
    `/api/auth/admin/moderation/worlds/${worldId}`,
    {
      method: 'PATCH',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function approveModerationWorldForAdmin(payload: any): Promise<AdminModerationWorldDetail> {
  const token = extractCompatToken(payload)
  const worldId = extractCompatNumber(payload, 'world_id', 'worldId', 'id')
  return requestJson<AdminModerationWorldDetail>(
    `/api/auth/admin/moderation/worlds/${worldId}/approve`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
    },
    AUTH_NETWORK_ERROR,
  )
}

export async function rejectModerationWorldForAdmin(payload: any): Promise<AdminModerationWorldDetail> {
  const token = extractCompatToken(payload)
  const worldId = extractCompatNumber(payload, 'world_id', 'worldId', 'id')
  return requestJson<AdminModerationWorldDetail>(
    `/api/auth/admin/moderation/worlds/${worldId}/reject`,
    {
      method: 'POST',
      headers: buildCompatAuthHeaders(token),
      body: JSON.stringify(payload),
    },
    AUTH_NETWORK_ERROR,
  )
}
