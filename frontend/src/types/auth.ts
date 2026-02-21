export type AuthUser = {
  id: number
  email: string
  display_name: string | null
  avatar_url: string | null
  avatar_scale: number
  auth_provider: string
  coins: number
  created_at: string
}

export type AuthResponse = {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
}
