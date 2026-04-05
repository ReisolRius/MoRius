import { useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'
import { resolveApiResourceUrl } from '../../services/httpClient'
import { useVisibilityTrigger } from '../../hooks/useVisibilityTrigger'

const AVATAR_LOAD_TIMEOUT_MS = 8000
type ImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed'

type ProgressiveAvatarProps = {
  src?: string | null
  fallbackLabel: string
  alt?: string
  size?: number
  scale?: number
  priority?: boolean
  sx?: SxProps<Theme>
  imgSx?: SxProps<Theme>
}

function resolveFallbackSymbol(value: string): string {
  return value.trim().charAt(0).toUpperCase() || '•'
}

function ProgressiveAvatar({
  src,
  fallbackLabel,
  alt = '',
  size = 44,
  scale = 1,
  priority = false,
  sx,
  imgSx,
}: ProgressiveAvatarProps) {
  const resolvedSrc = resolveApiResourceUrl(src)
  const { ref, isVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin: priority ? '320px 0px' : '220px 0px',
    disabled: !resolvedSrc,
  })
  const [loadStatus, setLoadStatus] = useState<ImageLoadStatus>('idle')
  const fallbackSymbol = resolveFallbackSymbol(fallbackLabel)
  const normalizedScale = Math.max(1, Math.min(3, scale))
  const shouldAttemptImage = Boolean(resolvedSrc)
  const shouldLoadImage = shouldAttemptImage && (priority || isVisible)
  const isImageLoaded = loadStatus === 'loaded'
  const isImageLoading = loadStatus === 'loading'
  const shouldShowFallbackSymbol = !shouldAttemptImage || loadStatus === 'failed'

  useEffect(() => {
    if (!resolvedSrc) {
      setLoadStatus('idle')
      return
    }
    if (!shouldLoadImage) {
      setLoadStatus((currentStatus) => (currentStatus === 'loaded' ? currentStatus : 'idle'))
      return
    }

    let isCancelled = false
    const image = new Image()
    const timeoutId = window.setTimeout(() => {
      if (isCancelled) {
        return
      }
      setLoadStatus('failed')
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
    image.src = resolvedSrc

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
    }
  }, [resolvedSrc, shouldLoadImage])

  const rootSx = [
    {
      position: 'relative',
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      display: 'grid',
      placeItems: 'center',
      flexShrink: 0,
      backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 84%, black)',
      color: 'rgba(219, 227, 236, 0.94)',
      fontSize: Math.max(14, Math.round(size * 0.38)),
      fontWeight: 700,
    },
    ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
  ] as SxProps<Theme>

  const imageSx = [
    {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: 'cover',
      transform: `scale(${normalizedScale})`,
      transformOrigin: 'center center',
      opacity: isImageLoaded ? 1 : 0,
      transition: 'opacity 180ms ease',
    },
    ...(Array.isArray(imgSx) ? imgSx : imgSx ? [imgSx] : []),
  ] as SxProps<Theme>

  return (
    <Box ref={ref} title={fallbackLabel} aria-label={fallbackLabel} sx={rootSx}>
      <Box
        component="span"
        sx={{
          position: 'relative',
          zIndex: 1,
          lineHeight: 1,
          opacity: shouldShowFallbackSymbol ? 1 : 0,
          transition: 'opacity 180ms ease',
        }}
      >
        {fallbackSymbol}
      </Box>
      {shouldLoadImage && isImageLoaded ? (
        <Box
          component="img"
          src={resolvedSrc ?? undefined}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          referrerPolicy="no-referrer"
          sx={imageSx}
        />
      ) : null}
      {shouldLoadImage ? (
        <>
          {isImageLoading ? (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                zIndex: 2,
                background:
                  'radial-gradient(circle at center, rgba(16, 24, 36, 0.14) 0%, rgba(16, 24, 36, 0.04) 54%, transparent 74%)',
              }}
            >
              <CircularProgress
                size={Math.max(14, Math.round(size * 0.42))}
                thickness={4}
                sx={{ color: 'rgba(223, 232, 243, 0.88)' }}
              />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  )
}

export default ProgressiveAvatar
