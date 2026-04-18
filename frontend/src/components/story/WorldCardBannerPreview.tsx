import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { KeyboardEvent } from 'react'
import ProgressiveImage from '../media/ProgressiveImage'
import { STORY_WORLD_BANNER_ASPECT } from '../../utils/storyWorldCards'

type WorldCardBannerPreviewProps = {
  imageUrl?: string | null
  imageScale?: number
  title?: string
  description?: string
  actionLabel?: string
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  sx?: SxProps<Theme>
  borderRadius?: number
}

function WorldCardBannerPreview({
  imageUrl,
  imageScale = 1,
  title = 'Баннер карточки',
  description = 'Добавьте широкое изображение, чтобы карточка выглядела как баннер.',
  actionLabel = 'Выбрать баннер',
  disabled = false,
  loading = false,
  onClick,
  sx,
  borderRadius = 20,
}: WorldCardBannerPreviewProps) {
  const isInteractive = Boolean(onClick) && !disabled
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive || !onClick) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <Box
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : -1}
      aria-label={actionLabel}
      onClick={isInteractive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      sx={[
        {
          position: 'relative',
          width: '100%',
          minWidth: 0,
          flexShrink: 0,
          aspectRatio: `${STORY_WORLD_BANNER_ASPECT}`,
          minHeight: { xs: 184, sm: 236 },
          borderRadius: `${borderRadius}px`,
          overflow: 'hidden',
          cursor: isInteractive ? 'pointer' : 'default',
          border: '1px dashed rgba(194, 208, 226, 0.42)',
          background:
            'radial-gradient(circle at 24% 18%, color-mix(in srgb, var(--morius-accent) 14%, transparent), transparent 34%), linear-gradient(155deg, color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%) 0%, color-mix(in srgb, var(--morius-card-bg) 88%, #000 12%) 100%)',
          outline: 'none',
          '&:hover .morius-world-banner-preview-overlay': {
            opacity: isInteractive ? 1 : 0,
          },
          '&:focus-visible .morius-world-banner-preview-overlay': {
            opacity: isInteractive ? 1 : 0,
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {imageUrl ? (
        <ProgressiveImage
          src={imageUrl}
          alt=""
          objectFit="cover"
          containerSx={{ width: '100%', height: '100%' }}
          imgSx={{
            transform: `scale(${Math.max(1, Math.min(3, imageScale || 1))})`,
            transformOrigin: 'center center',
          }}
        />
      ) : (
        <Stack
          spacing={0.55}
          alignItems="flex-start"
          justifyContent="flex-end"
          sx={{
            position: 'absolute',
            inset: 0,
            px: { xs: 1.1, sm: 1.35 },
            py: { xs: 1, sm: 1.15 },
            backgroundColor: 'var(--morius-elevated-bg)',
          }}
        >
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1rem', sm: '1.08rem' }, fontWeight: 800 }}>
            {title}
          </Typography>
          <Typography sx={{ color: 'rgba(217, 227, 239, 0.78)', fontSize: '0.9rem', lineHeight: 1.45, maxWidth: '34rem' }}>
            {description}
          </Typography>
        </Stack>
      )}

      {imageUrl ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(8, 12, 18, 0.74) 0%, rgba(8, 12, 18, 0.28) 36%, rgba(8, 12, 18, 0.12) 100%)',
          }}
        />
      ) : null}

      <Box
        className="morius-world-banner-preview-overlay"
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: imageUrl ? 'rgba(12, 16, 22, 0.46)' : 'rgba(12, 16, 22, 0.2)',
          opacity: imageUrl ? 0 : 1,
          transition: 'opacity 180ms ease',
          pointerEvents: 'none',
        }}
      >
        <Box
          sx={{
            px: 1.2,
            py: 0.68,
            borderRadius: '999px',
            border: 'var(--morius-border-width) solid rgba(223, 232, 243, 0.58)',
            backgroundColor: 'rgba(20, 24, 31, 0.66)',
            color: 'var(--morius-title-text)',
            fontSize: '0.84rem',
            fontWeight: 800,
          }}
        >
          {actionLabel}
        </Box>
      </Box>

      {loading ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'rgba(14, 16, 20, 0.56)',
          }}
        >
          <CircularProgress size={28} sx={{ color: 'rgba(224, 232, 243, 0.95)' }} />
        </Box>
      ) : null}
    </Box>
  )
}

export default WorldCardBannerPreview
