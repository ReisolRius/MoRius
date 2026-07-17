import { Box, CircularProgress } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { SxProps } from '@mui/system'
import { useEffect, useState, type ReactNode } from 'react'
import { resolveApiResourceUrl } from '../../services/httpClient'

type ImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed'
type ProgressiveImageState = {
  src: string | null
  retryNonce: number
  loadStatus: ImageLoadStatus
}

const PROGRESSIVE_IMAGE_LOAD_TIMEOUT_MS = 10_000

type ProgressiveImageProps = {
  src?: string | null
  alt?: string
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'auto' | 'high' | 'low'
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  objectPosition?: string
  loaderSize?: number
  containerSx?: SxProps<Theme>
  imgSx?: SxProps<Theme>
  fallback?: ReactNode
  onLoad?: () => void
}

function buildImageRequestSrc(src: string | null, retryNonce: number): string | null {
  if (!src || retryNonce <= 0 || src.startsWith('data:') || src.startsWith('blob:')) {
    return src
  }
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}morius_img_retry=${retryNonce}`
}

export default function ProgressiveImage({
  src,
  alt = '',
  loading = 'lazy',
  fetchPriority = 'auto',
  objectFit = 'contain',
  objectPosition = 'center',
  loaderSize = 28,
  containerSx,
  imgSx,
  fallback = null,
  onLoad,
}: ProgressiveImageProps) {
  const resolvedSrc = resolveApiResourceUrl(src)
  const [imageState, setImageState] = useState<ProgressiveImageState>({
    src: resolvedSrc,
    retryNonce: 0,
    loadStatus: resolvedSrc ? 'loading' : 'idle',
  })
  const isCurrentImageState = imageState.src === resolvedSrc
  const retryNonce = isCurrentImageState ? imageState.retryNonce : 0
  const loadStatus: ImageLoadStatus = isCurrentImageState
    ? imageState.loadStatus
    : resolvedSrc
      ? 'loading'
      : 'idle'
  const requestSrc = buildImageRequestSrc(resolvedSrc, retryNonce)
  const shouldRevealImage = loadStatus === 'loaded' || loadStatus === 'idle'
  const isImageLoading = loadStatus === 'loading'
  const hasFailed = loadStatus === 'failed'

  useEffect(() => {
    if (!resolvedSrc || loadStatus !== 'loading') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setImageState((currentState) => {
        const currentRetryNonce = currentState.src === resolvedSrc ? currentState.retryNonce : retryNonce
        if (currentRetryNonce < 2) {
          return { src: resolvedSrc, retryNonce: currentRetryNonce + 1, loadStatus: 'loading' }
        }
        return { src: resolvedSrc, retryNonce: currentRetryNonce, loadStatus: 'failed' }
      })
    }, PROGRESSIVE_IMAGE_LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timeoutId)
  }, [loadStatus, resolvedSrc, retryNonce])

  useEffect(() => {
    if (!resolvedSrc) {
      return
    }

    const retryFailedImage = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      setImageState((currentState) => {
        if (currentState.src !== resolvedSrc || currentState.loadStatus !== 'failed') {
          return currentState
        }
        return { src: resolvedSrc, retryNonce: currentState.retryNonce + 1, loadStatus: 'loading' }
      })
    }

    window.addEventListener('pageshow', retryFailedImage)
    window.addEventListener('focus', retryFailedImage)
    document.addEventListener('visibilitychange', retryFailedImage)

    return () => {
      window.removeEventListener('pageshow', retryFailedImage)
      window.removeEventListener('focus', retryFailedImage)
      document.removeEventListener('visibilitychange', retryFailedImage)
    }
  }, [resolvedSrc])

  return (
    <Box
      sx={[
        {
          position: 'relative',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          width: '100%',
        },
        ...(Array.isArray(containerSx) ? containerSx : containerSx ? [containerSx] : []),
      ]}
    >
      {!resolvedSrc || hasFailed ? fallback : null}
      {resolvedSrc && !hasFailed ? (
        <>
          <Box
            component="img"
            src={requestSrc ?? resolvedSrc}
            alt={alt}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => {
              setImageState({ src: resolvedSrc, retryNonce, loadStatus: 'loaded' })
              onLoad?.()
            }}
            onError={() => {
              setImageState((currentState) => {
                const currentRetryNonce = currentState.src === resolvedSrc ? currentState.retryNonce : retryNonce
                if (currentRetryNonce < 2) {
                  return { src: resolvedSrc, retryNonce: currentRetryNonce + 1, loadStatus: 'loading' }
                }
                return { src: resolvedSrc, retryNonce: currentRetryNonce, loadStatus: 'failed' }
              })
            }}
            sx={[
              {
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit,
                objectPosition,
                opacity: shouldRevealImage ? 1 : 0,
                transition: 'opacity 180ms ease',
              },
              ...(Array.isArray(imgSx) ? imgSx : imgSx ? [imgSx] : []),
            ]}
          />
          {isImageLoading ? (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                zIndex: 1,
              }}
            >
              <CircularProgress size={loaderSize} thickness={4} sx={{ color: 'rgba(223, 232, 243, 0.88)' }} />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  )
}
