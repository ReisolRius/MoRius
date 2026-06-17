import { useEffect, useState } from 'react'
import { Box, CircularProgress, Stack } from '@mui/material'
import type { AuthUser } from '../../types/auth'
import { resolveApiResourceUrl } from '../../services/httpClient'
import { useVisibilityTrigger } from '../../hooks/useVisibilityTrigger'
import AvatarFrame from './AvatarFrame'

const AVATAR_LOAD_TIMEOUT_MS = 8000
type ImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed'

export type AvatarPlaceholderProps = {
  fallbackLabel: string
  size: number
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
  priority?: boolean
  frameImageUrl?: string | null
  withFrame?: boolean
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

function UserAvatar({ user, size = 44, priority = true, frameImageUrl = null, withFrame = true }: UserAvatarProps) {
  const [loadStatus, setLoadStatus] = useState<ImageLoadStatus>('idle')
  const fallbackLabel = user.display_name || user.email
  const avatarScale = Math.max(1, Math.min(3, user.avatar_scale ?? 1))
  const resolvedAvatarUrl = resolveApiResourceUrl(user.avatar_url)
  const { ref, isVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin: priority ? '320px 0px' : '220px 0px',
    disabled: !resolvedAvatarUrl,
  })
  const shouldLoadAvatar = Boolean(resolvedAvatarUrl) && (priority || isVisible)
  const isImageLoaded = loadStatus === 'loaded'
  const isImageLoading = loadStatus === 'loading'
  const shouldRevealAvatar = isImageLoaded || (shouldLoadAvatar && loadStatus === 'idle')

  useEffect(() => {
    if (!resolvedAvatarUrl) {
      setLoadStatus('idle')
      return
    }
    if (!shouldLoadAvatar) {
      setLoadStatus((currentStatus) => (currentStatus === 'loaded' ? currentStatus : 'idle'))
      return
    }

    let isCancelled = false
    const image = new Image()
    const timeoutId = window.setTimeout(() => {
      if (isCancelled) {
        return
      }
      setLoadStatus((currentStatus) => (currentStatus === 'loading' ? 'idle' : currentStatus))
    }, AVATAR_LOAD_TIMEOUT_MS)

    setLoadStatus('loading')
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      if (isCancelled) {
        return
      }
      window.clearTimeout(timeoutId)
      setLoadStatus('loaded')
    }
    image.onerror = () => {
      if (isCancelled) {
        return
      }
      window.clearTimeout(timeoutId)
      setLoadStatus('failed')
    }
    image.src = resolvedAvatarUrl

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
    }
  }, [resolvedAvatarUrl, shouldLoadAvatar])

  const avatarNode = resolvedAvatarUrl && loadStatus !== 'failed' ? (
      <Box
        ref={ref}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 84%, black)',
        }}
      >
        {!isImageLoaded ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
          </Box>
        ) : null}
        {isImageLoading ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <CircularProgress size={Math.max(16, Math.round(size * 0.34))} thickness={4} />
          </Box>
        ) : null}
        {shouldLoadAvatar ? (
          <Box
            component="img"
            src={resolvedAvatarUrl}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            referrerPolicy="no-referrer"
            sx={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
              transform: `scale(${avatarScale})`,
              transformOrigin: 'center center',
              opacity: shouldRevealAvatar ? 1 : 0,
              transition: 'opacity 180ms ease',
            }}
          />
        ) : null}
      </Box>
  ) : (
    <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
  )

  if (!withFrame) {
    return avatarNode
  }

  return (
    <AvatarFrame frameId={user.avatar_frame_id} frameImageUrl={frameImageUrl ?? user.avatar_frame_image_url ?? null} size={size}>
      {avatarNode}
    </AvatarFrame>
  )
}

export default UserAvatar
