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
  is_banned: boolean
  ban_expires_at: string | null
  created_at: string
}

export type AuthResponse = {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
}
