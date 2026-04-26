export type AuthUser = {
  id: number
  email: string
  display_name: string | null
  profile_description: string
  avatar_url: string | null
  avatar_scale: number
  auth_provider: string
  role: string
  level: number
  coins: number
  notifications_enabled?: boolean
  notify_comment_reply?: boolean
  notify_world_comment?: boolean
  notify_publication_review?: boolean
  notify_new_follower?: boolean
  notify_moderation_report?: boolean
  notify_moderation_queue?: boolean
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
  is_banned: boolean
  ban_expires_at: string | null
  created_at: string
}

export type AuthResponse = {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
}
