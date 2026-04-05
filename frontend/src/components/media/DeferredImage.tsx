import { Box, CircularProgress } from '@mui/material'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { useVisibilityTrigger } from '../../hooks/useVisibilityTrigger'
import { resolveApiResourceUrl } from '../../services/httpClient'

const DEFERRED_IMAGE_LOAD_TIMEOUT_MS = 8000

type DeferredImageProps = {
  src?: string | null
  alt?: string
  rootMargin?: string
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  objectPosition?: string
  sx?: SxProps<Theme>
  imgSx?: SxProps<Theme>
  fetchPriority?: 'auto' | 'high' | 'low'
}

export default function DeferredImage({
  src,
  alt = '',
  rootMargin = '360px 0px',
  objectFit = 'cover',
  objectPosition = 'center',
  sx,
  imgSx,
  fetchPriority = 'low',
}: DeferredImageProps) {
  const normalizedSrc = resolveApiResourceUrl(src) ?? ''
  const { ref, isVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin,
    disabled: !normalizedSrc,
  })
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)
  const rootSx = [
    {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    },
    ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
  ] as SxProps<Theme>
  const imageSx = [
    {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit,
      objectPosition,
      opacity: isLoaded ? 1 : 0,
      transition: 'opacity 220ms ease',
    },
    ...(Array.isArray(imgSx) ? imgSx : imgSx ? [imgSx] : []),
  ] as SxProps<Theme>

  useEffect(() => {
    setIsLoaded(false)
    setHasFailed(false)
  }, [normalizedSrc])

  useEffect(() => {
    if (!isVisible || !normalizedSrc || isLoaded || hasFailed) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setHasFailed((currentValue) => (isLoaded ? currentValue : true))
    }, DEFERRED_IMAGE_LOAD_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasFailed, isLoaded, isVisible, normalizedSrc])

  if (!normalizedSrc || hasFailed) {
    return null
  }

  return (
    <Box
      ref={ref}
      sx={rootSx}
    >
      {isVisible ? (
        <>
          {!isLoaded ? (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <CircularProgress
                size={30}
                thickness={4}
                sx={{ color: 'rgba(223, 232, 243, 0.88)' }}
              />
            </Box>
          ) : null}
          <Box
            component="img"
            src={normalizedSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            fetchPriority={fetchPriority}
            onLoad={() => setIsLoaded(true)}
            onError={() => {
              setHasFailed(true)
              setIsLoaded(false)
            }}
            sx={imageSx}
          />
        </>
      ) : null}
    </Box>
  )
}
