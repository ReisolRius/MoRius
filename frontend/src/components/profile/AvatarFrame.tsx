import { Box } from '@mui/material'
import { getAvatarFramePreset, normalizeAvatarFrameId } from '../../constants/avatarFrames'
import { resolveApiResourceUrl } from '../../services/httpClient'
import type { ReactNode } from 'react'

type AvatarFrameProps = {
  children: ReactNode
  frameId?: string | null
  frameImageUrl?: string | null
  size: number
}

function resolveFrameImage(frameId: string, frameImageUrl?: string | null): string | null {
  const resolvedDynamicImage = resolveApiResourceUrl(frameImageUrl)
  if (resolvedDynamicImage) {
    return resolvedDynamicImage
  }
  const preset = getAvatarFramePreset(frameId)
  return preset.imageSrc
}

function AvatarFrame({ children, frameId, frameImageUrl, size }: AvatarFrameProps) {
  const normalizedFrameId = normalizeAvatarFrameId(frameId)
  const preset = getAvatarFramePreset(normalizedFrameId)
  const imageSrc = resolveFrameImage(normalizedFrameId, frameImageUrl)
  const hasFrame = normalizedFrameId !== 'none' && (Boolean(imageSrc) || Boolean(preset.ring))

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
      {hasFrame && imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          draggable={false}
          sx={{
            position: 'absolute',
            inset: '-15%',
            width: '130%',
            height: '130%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      ) : null}
    </Box>
  )
}

export default AvatarFrame
