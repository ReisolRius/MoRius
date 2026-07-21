import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import ProgressiveAvatar from '../media/ProgressiveAvatar'

type CommunityRuleCardProps = {
  title: string
  content: string
  authorName: string
  authorAvatarUrl?: string | null
  authorAvatarFrameId?: string | null
  authorAvatarFrameImageUrl?: string | null
  gamesCount: number
  ratingAvg: number
  onClick?: () => void
  disabled?: boolean
  actionSlot?: ReactNode
  minHeight?: number
}

function formatGamesCount(value: number): string {
  const count = Math.max(0, Math.trunc(value))
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} игра`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} игры`
  }
  return `${count} игр`
}

function CommunityRuleCard({
  title,
  content,
  authorName,
  authorAvatarUrl,
  authorAvatarFrameId,
  authorAvatarFrameImageUrl,
  gamesCount,
  ratingAvg,
  onClick,
  disabled = false,
  actionSlot,
  minHeight = 318,
}: CommunityRuleCardProps) {
  const resolvedAuthorName = authorName.trim() || 'Неизвестный автор'
  const resolvedContent = content.replace(/\s+/g, ' ').trim() || 'Описание правила пока не добавлено.'

  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        position: 'relative',
        width: '100%',
        minWidth: 0,
        height: minHeight,
        minHeight,
        maxHeight: minHeight,
        p: 0,
        overflow: 'hidden',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        borderRadius: 'var(--morius-radius)',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, #b89451 12%)',
        background:
          'linear-gradient(145deg, color-mix(in srgb, var(--morius-card-bg) 96%, #b89451 4%) 0%, var(--morius-card-bg) 58%, color-mix(in srgb, var(--morius-card-bg) 97%, #000 3%) 100%)',
        color: 'var(--morius-text-primary)',
        textAlign: 'left',
        transition: 'transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
        '&:hover': {
          transform: disabled ? 'none' : 'translateY(-5px)',
          borderColor: 'color-mix(in srgb, var(--morius-rating-gold) 46%, var(--morius-card-border))',
          boxShadow: disabled ? 'none' : 'var(--morius-neutral-shadow)',
        },
        '&:focus-visible': {
          outline: '2px solid rgba(222, 188, 111, 0.68)',
          outlineOffset: '2px',
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          right: -8,
          bottom: -34,
          zIndex: 0,
          color: 'var(--morius-rating-gold)',
          fontFamily: '"Spectral", serif',
          fontSize: { xs: 104, md: 124 },
          fontWeight: 400,
          lineHeight: 1,
          opacity: 0.065,
          transform: 'rotate(-4deg)',
          pointerEvents: 'none',
        }}
      >
        §
      </Box>

      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          minHeight: 0,
          px: { xs: 2, md: 2.5 },
          py: { xs: 2, md: 2.35 },
          display: 'grid',
          gridTemplateRows: '44px minmax(0, 1fr) 42px',
          rowGap: { xs: 1.7, md: 2 },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.2}>
          <Box
            sx={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              borderRadius: '13px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-rating-gold) 46%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--morius-rating-gold) 9%, transparent)',
              color: 'var(--morius-rating-gold)',
              fontFamily: '"Spectral", serif',
              fontSize: '1.35rem',
              lineHeight: 1,
            }}
          >
            §
          </Box>

          <Stack direction="row" alignItems="center" spacing={0.8} sx={{ minWidth: 0 }}>
            <Box
              sx={{
                minHeight: 30,
                display: 'inline-flex',
                alignItems: 'center',
                px: 1.25,
                borderRadius: '999px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                color: 'var(--morius-text-secondary)',
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, transparent)',
                fontSize: '0.76rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {formatGamesCount(gamesCount)}
            </Box>
            {actionSlot ? <Box sx={{ flexShrink: 0 }}>{actionSlot}</Box> : null}
          </Stack>
        </Stack>

        <Box
          sx={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            rowGap: 1.2,
            overflow: 'hidden',
          }}
        >
          <Typography
            title={title}
            sx={{
              flexShrink: 0,
              color: 'var(--morius-title-text)',
              fontFamily: '"Spectral", serif',
              fontSize: { xs: '1.18rem', md: '1.34rem' },
              fontWeight: 700,
              lineHeight: 1.2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              flex: 1,
              minHeight: 0,
              color: 'var(--morius-text-secondary)',
              fontSize: { xs: '0.9rem', md: '0.96rem' },
              lineHeight: 1.52,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {resolvedContent}
          </Typography>
        </Box>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.2}
          sx={{ pt: 1.25, minWidth: 0, borderTop: 'var(--morius-border-width) solid var(--morius-divider-color)' }}
        >
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, maxWidth: '72%' }}>
            <ProgressiveAvatar
              src={authorAvatarUrl ?? null}
              fallbackLabel={resolvedAuthorName}
              size={28}
              frameId={authorAvatarFrameId ?? undefined}
              frameImageUrl={authorAvatarFrameImageUrl ?? null}
              sx={{ flexShrink: 0, border: 'var(--morius-border-width) solid rgba(215, 224, 236, 0.24)' }}
            />
            <Typography
              title={resolvedAuthorName}
              sx={{
                minWidth: 0,
                color: 'var(--morius-text-secondary)',
                fontSize: '0.82rem',
                fontWeight: 650,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {resolvedAuthorName}
            </Typography>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={0.45} sx={{ color: 'var(--morius-rating-gold)', flexShrink: 0 }}>
            <Typography component="span" sx={{ color: 'inherit', fontSize: '1.05rem', lineHeight: 1 }}>
              ★
            </Typography>
            <Typography component="span" sx={{ color: 'inherit', fontSize: '0.86rem', lineHeight: 1, fontWeight: 800 }}>
              {Math.max(0, ratingAvg).toFixed(1)}
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </ButtonBase>
  )
}

export default CommunityRuleCard
