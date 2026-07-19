export type AuthUser = {
  id: number
  email: string
  display_name: string | null
  profile_description: string
  profile_banner_id: string
  profile_banner_image_url?: string | null
  avatar_frame_id: string
  avatar_frame_image_url?: string | null
  avatar_url: string | null
  avatar_scale: number
  auth_provider: string
  role: string
  profile_tag?: string
  level: number
  coins: number
  notifications_enabled?: boolean
  notify_comment_reply?: boolean
  notify_world_comment?: boolean
  notify_publication_review?: boolean
  notify_new_follower?: boolean
  notify_moderation_report?: boolean
  notify_moderation_queue?: boolean
  ai_assistant_visible?: boolean
  email_notifications_enabled?: boolean
  show_subscriptions?: boolean
  show_public_worlds?: boolean
  show_private_worlds?: boolean
  show_public_characters?: boolean
  show_public_instruction_templates?: boolean
  referral_code?: string | null
  referred_by_user_id?: number | null
  referral_applied_at?: string | null
  referral_bonus_claimed_at?: string | null
  active_theme_id?: string | null
  subscription?: UserSubscription | null
  is_banned: boolean
  ban_expires_at: string | null
  created_at: string
}

export type UserSubscription = {
  plan_id: string
  plan_title: string
  daily_turn_limit: number
  daily_turns_used: number
  daily_turns_remaining: number
  memory_token_cap: number
  models: string[]
  is_mock: boolean
}

export type AuthResponse = {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
  is_new_user?: boolean
}

const ROLE_BADGE_LABELS: Record<string, string> = {
  administrator: 'Разработчик',
  moderator: 'Модератор',
  beta_tester: 'Бета-тестер',
  user: 'Игрок',
}

export function normalizeUserRole(role: string | null | undefined): string {
  return (role ?? '').trim().toLowerCase()
}

export function isAdministratorRole(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === 'administrator'
}

export function canUseVisualNovelFeatures(role: string | null | undefined): boolean {
  const normalizedRole = normalizeUserRole(role)
  return normalizedRole === 'administrator' || normalizedRole === 'beta_tester'
}

export function canUseStoryGraphFeatures(role: string | null | undefined): boolean {
  const normalizedRole = normalizeUserRole(role)
  return normalizedRole === 'administrator' || normalizedRole === 'moderator' || normalizedRole === 'beta_tester'
}

export function getRoleBadgeLabel(role: string | null | undefined): string {
  const normalizedRole = normalizeUserRole(role)
  return ROLE_BADGE_LABELS[normalizedRole] ?? ROLE_BADGE_LABELS.user
}

export function getDisplayedTagLabel(role: string | null | undefined, profileTag: string | null | undefined): string {
  const customTag = (profileTag ?? '').trim()
  return customTag || getRoleBadgeLabel(role)
}
