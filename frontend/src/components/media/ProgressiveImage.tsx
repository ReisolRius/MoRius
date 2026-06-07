import { Box, CircularProgress } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { SxProps } from '@mui/system'
import { useEffect, useState, type ReactNode } from 'react'
import { resolveApiResourceUrl } from '../../services/httpClient'

type ImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed'

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
}: ProgressiveImageProps) {
  const resolvedSrc = resolveApiResourceUrl(src)
  const [retryNonce, setRetryNonce] = useState(0)
  const [loadStatus, setLoadStatus] = useState<ImageLoadStatus>(resolvedSrc ? 'loading' : 'idle')
  const requestSrc = buildImageRequestSrc(resolvedSrc, retryNonce)
  const shouldRevealImage = loadStatus === 'loaded' || loadStatus === 'idle'
  const isImageLoading = loadStatus === 'loading'
  const hasFailed = loadStatus === 'failed'

  useEffect(() => {
    if (!resolvedSrc) {
      setRetryNonce(0)
      setLoadStatus('idle')
      return
    }

    setRetryNonce(0)
    setLoadStatus('loading')
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
            onLoad={() => setLoadStatus('loaded')}
            onError={() => {
              if (retryNonce < 2) {
                setLoadStatus('loading')
                setRetryNonce((current) => current + 1)
              } else {
                setLoadStatus('failed')
              }
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
