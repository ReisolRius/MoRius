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
  const [frameRetryNonce, setFrameRetryNonce] = useState(0)
  const [isFrameLoaded, setIsFrameLoaded] = useState(false)
  const [hasFrameLoadError, setHasFrameLoadError] = useState(false)
  const frameImageRequestSrc = buildFrameImageRequestSrc(imageSrc, frameRetryNonce)
  const shouldRenderFrameImage = normalizedFrameId !== 'none' && Boolean(imageSrc) && !hasFrameLoadError
  const hasFrame = normalizedFrameId !== 'none' && (shouldRenderFrameImage || Boolean(preset.ring))

  useEffect(() => {
    setFrameRetryNonce(0)
    setIsFrameLoaded(false)
    setHasFrameLoadError(false)
  }, [imageSrc])

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
          alt=""
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          draggable={false}
          onLoad={() => setIsFrameLoaded(true)}
          onError={() => {
            setIsFrameLoaded(false)
            if (frameRetryNonce < 2) {
              setFrameRetryNonce((current) => current + 1)
            } else {
              setHasFrameLoadError(true)
            }
          }}
          sx={{
            position: 'absolute',
            inset: '-15%',
            width: '130%',
            height: '130%',
            objectFit: 'contain',
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
