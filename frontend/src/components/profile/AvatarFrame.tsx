import { Box, CircularProgress } from '@mui/material'
import { getAvatarFramePreset, normalizeAvatarFrameId } from '../../constants/avatarFrames'
import { resolveApiResourceUrl } from '../../services/httpClient'
import { resolveAvatarFrameImageUrl } from '../../utils/cosmeticImageFallbacks'
import { useEffect, useState, type ReactNode } from 'react'

type AvatarFrameProps = {
  children: ReactNode
  frameId?: string | null
  frameImageUrl?: string | null
  size: number
}

type AvatarFrameImageState = {
  imageSrc: string | null
  retryNonce: number
  isLoaded: boolean
  hasError: boolean
}

const AVATAR_FRAME_LOAD_TIMEOUT_MS = 10_000

function resolveFrameImage(frameId: string, frameImageUrl?: string | null): string | null {
  const resolvedDynamicImage = resolveApiResourceUrl(resolveAvatarFrameImageUrl(frameId, frameImageUrl))
  if (resolvedDynamicImage) {
    return resolvedDynamicImage
  }
  const preset = getAvatarFramePreset(frameId)
  return preset.imageSrc
}

function buildFrameImageRequestSrc(imageSrc: string | null, retryNonce: number): string | null {
  if (!imageSrc || retryNonce <= 0 || imageSrc.startsWith('data:') || imageSrc.startsWith('blob:')) {
    return imageSrc
  }
  const separator = imageSrc.includes('?') ? '&' : '?'
  return `${imageSrc}${separator}morius_frame_retry=${retryNonce}`
}

function AvatarFrame({ children, frameId, frameImageUrl, size }: AvatarFrameProps) {
  const normalizedFrameId = normalizeAvatarFrameId(frameId)
  const preset = getAvatarFramePreset(normalizedFrameId)
  const imageSrc = resolveFrameImage(normalizedFrameId, frameImageUrl)
  const [frameImageState, setFrameImageState] = useState<AvatarFrameImageState>({
    imageSrc,
    retryNonce: 0,
    isLoaded: false,
    hasError: false,
  })
  const isCurrentFrameImageState = frameImageState.imageSrc === imageSrc
  const frameRetryNonce = isCurrentFrameImageState ? frameImageState.retryNonce : 0
  const isFrameLoaded = isCurrentFrameImageState ? frameImageState.isLoaded : false
  const hasFrameLoadError = isCurrentFrameImageState ? frameImageState.hasError : false
  const frameImageRequestSrc = buildFrameImageRequestSrc(imageSrc, frameRetryNonce)
  const shouldRenderFrameImage = normalizedFrameId !== 'none' && Boolean(imageSrc) && !hasFrameLoadError
  const hasFrame = normalizedFrameId !== 'none' && (shouldRenderFrameImage || Boolean(preset.ring))

  useEffect(() => {
    if (!shouldRenderFrameImage || isFrameLoaded) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setFrameImageState((currentState) => {
        const currentRetryNonce = currentState.imageSrc === imageSrc ? currentState.retryNonce : frameRetryNonce
        if (currentRetryNonce < 2) {
          return { imageSrc, retryNonce: currentRetryNonce + 1, isLoaded: false, hasError: false }
        }
        return { imageSrc, retryNonce: currentRetryNonce, isLoaded: false, hasError: true }
      })
    }, AVATAR_FRAME_LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timeoutId)
  }, [frameRetryNonce, imageSrc, isFrameLoaded, shouldRenderFrameImage])

  useEffect(() => {
    if (!shouldRenderFrameImage || !imageSrc) {
      return
    }

    const retryFailedFrame = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      setFrameImageState((currentState) => {
        if (currentState.imageSrc !== imageSrc || !currentState.hasError) {
          return currentState
        }
        return { imageSrc, retryNonce: currentState.retryNonce + 1, isLoaded: false, hasError: false }
      })
    }

    window.addEventListener('pageshow', retryFailedFrame)
    window.addEventListener('focus', retryFailedFrame)
    document.addEventListener('visibilitychange', retryFailedFrame)

    return () => {
      window.removeEventListener('pageshow', retryFailedFrame)
      window.removeEventListener('focus', retryFailedFrame)
      document.removeEventListener('visibilitychange', retryFailedFrame)
    }
  }, [imageSrc, shouldRenderFrameImage])

  return (
    <Box
      className="morius-framed-avatar"
      sx={{
        width: size,
        height: size,
        position: 'relative',
        flex: '0 0 auto',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        overflow: 'visible',
      }}
    >
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: hasFrame && preset.ring ? preset.ring.shadow : undefined,
          border: hasFrame && preset.ring ? preset.ring.border : 'none',
        }}
      >
        {children}
      </Box>
      {shouldRenderFrameImage && !isFrameLoaded ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: '-15%',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <CircularProgress size={Math.max(14, Math.round(size * 0.18))} sx={{ color: 'var(--morius-accent)' }} />
        </Box>
      ) : null}
      {shouldRenderFrameImage && imageSrc ? (
        <Box
          component="img"
          src={frameImageRequestSrc ?? imageSrc}
          className="morius-avatar-frame-image"
          alt=""
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          draggable={false}
          onLoad={() => setFrameImageState({ imageSrc, retryNonce: frameRetryNonce, isLoaded: true, hasError: false })}
          onError={() => {
            setFrameImageState((currentState) => {
              const currentRetryNonce = currentState.imageSrc === imageSrc ? currentState.retryNonce : frameRetryNonce
              if (currentRetryNonce < 2) {
                return { imageSrc, retryNonce: currentRetryNonce + 1, isLoaded: false, hasError: false }
              }
              return { imageSrc, retryNonce: currentRetryNonce, isLoaded: false, hasError: true }
            })
          }}
          sx={{
            position: 'absolute',
            inset: '-15%',
            width: '130%',
            height: '130%',
            maxWidth: 'none',
            maxHeight: 'none',
            objectFit: 'contain',
            borderRadius: 0,
            opacity: isFrameLoaded ? 1 : 0,
            transition: 'opacity 160ms ease',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      ) : null}
    </Box>
  )
}

export default AvatarFrame
