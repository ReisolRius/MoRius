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
  onClick,
  disabled = false,
  actionSlot,
  minHeight = 272,
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
        p: { xs: 1.75, md: 2.2 },
        overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(0, 1fr) auto',
        gap: { xs: 1.15, md: 1.35 },
        alignItems: 'stretch',
        justifyItems: 'stretch',
        borderRadius: '18px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        background: 'var(--morius-card-alt-gradient)',
        color: 'var(--morius-text-primary)',
        textAlign: 'left',
        transition: 'transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
        '&:hover': {
          transform: disabled ? 'none' : 'translateY(-3px)',
          borderColor: 'color-mix(in srgb, var(--morius-accent) 42%, var(--morius-card-border))',
          boxShadow: disabled ? 'none' : 'var(--morius-neutral-shadow)',
        },
        '&:focus-visible': {
          outline: '2px solid color-mix(in srgb, var(--morius-accent) 62%, transparent)',
          outlineOffset: '2px',
        },
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.2} sx={{ minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.9} sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              borderRadius: '8px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-rating-gold) 28%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--morius-rating-gold) 11%, transparent)',
              color: 'var(--morius-rating-gold)',
              fontFamily: 'var(--morius-font-heading)',
              fontSize: '0.92rem',
              lineHeight: 1,
            }}
          >
            §
          </Box>
          <Typography
            sx={{
              color: 'var(--morius-muted-text)',
              fontSize: '0.68rem',
              fontWeight: 750,
              letterSpacing: '0.11em !important',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            Инструкция
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.7} sx={{ minWidth: 0, flexShrink: 0 }}>
          <Typography sx={{ color: 'var(--morius-muted-text)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
            {formatGamesCount(gamesCount)}
          </Typography>
          {actionSlot ? <Box sx={{ flexShrink: 0 }}>{actionSlot}</Box> : null}
        </Stack>
      </Stack>

      <Typography
        title={title}
        sx={{
          color: 'var(--morius-title-text)',
          fontFamily: 'var(--morius-font-heading)',
          fontSize: { xs: '1.02rem', md: '1.08rem' },
          fontWeight: 700,
          lineHeight: 1.35,
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
          minHeight: 0,
          alignSelf: 'stretch',
          color: 'var(--morius-text-secondary)',
          pl: 1.4,
          borderLeft: '2px solid color-mix(in srgb, var(--morius-title-text) 11%, transparent)',
          fontSize: { xs: '0.8rem', md: '0.82rem' },
          lineHeight: 1.6,
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {resolvedContent}
      </Typography>

      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, pt: 0.2 }}>
        <ProgressiveAvatar
          src={authorAvatarUrl ?? null}
          fallbackLabel={resolvedAuthorName}
          size={22}
          frameId={authorAvatarFrameId ?? undefined}
          frameImageUrl={authorAvatarFrameImageUrl ?? null}
          sx={{
            flexShrink: 0,
            border: 'var(--morius-border-width) solid rgba(215, 224, 236, 0.2)',
          }}
        />
        <Typography
          title={resolvedAuthorName}
          sx={{
            minWidth: 0,
            color: 'var(--morius-text-secondary)',
            fontSize: '0.75rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {resolvedAuthorName}
        </Typography>
      </Stack>
    </ButtonBase>
  )
}

export default CommunityRuleCard
