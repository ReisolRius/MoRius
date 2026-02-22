import { useState } from 'react'
import { Box, Stack } from '@mui/material'
import type { AuthUser } from '../../types/auth'

export type AvatarPlaceholderProps = {
  fallbackLabel: string
  size: number
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
}

export function AvatarPlaceholder({ fallbackLabel, size }: AvatarPlaceholderProps) {
  const headSize = Math.max(13, Math.round(size * 0.27))
  const bodyWidth = Math.max(20, Math.round(size * 0.42))
  const bodyHeight = Math.max(10, Math.round(size * 0.21))

  return (
    <Box
      aria-label="Нет аватарки"
      title={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Stack alignItems="center" spacing={0.45}>
        <Box
          sx={{
            width: headSize,
            height: headSize,
            borderRadius: '50%',
            backgroundColor: 'rgba(200, 212, 228, 0.92)',
          }}
        />
        <Box
          sx={{
            width: bodyWidth,
            height: bodyHeight,
            borderRadius: '10px 10px 7px 7px',
            backgroundColor: 'rgba(200, 212, 228, 0.92)',
          }}
        />
      </Stack>
    </Box>
  )
}

function UserAvatar({ user, size = 44 }: UserAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const fallbackLabel = user.display_name || user.email
  const avatarScale = Math.max(1, Math.min(3, user.avatar_scale ?? 1))

  if (user.avatar_url && user.avatar_url !== failedImageUrl) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        <Box
          component="img"
          src={user.avatar_url}
          alt={fallbackLabel}
          onError={() => setFailedImageUrl(user.avatar_url)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${avatarScale})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
    )
  }

  return <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
}

export default UserAvatar
