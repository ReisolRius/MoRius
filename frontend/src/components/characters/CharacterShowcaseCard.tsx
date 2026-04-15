import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import CharacterNoteBadge from './CharacterNoteBadge'
import DeferredImage from '../media/DeferredImage'

type CharacterShowcaseCardProps = {
  title: string
  description: string
  imageUrl?: string | null
  imageScale?: number
  eyebrow?: string | null
  footerHint?: string | null
  hideFooter?: boolean
  metaPrimary?: string | null
  metaSecondary?: string | null
  metaTertiary?: string | null
  titleAccessory?: ReactNode
  actionSlot?: ReactNode
  heroHeader?: ReactNode
  onClick?: () => void
  disabled?: boolean
  minHeight?: number
  highlighted?: boolean
  descriptionLineClamp?: number
}

function CharacterShowcaseCard({
  title,
  description,
  imageUrl,
  imageScale = 1,
  eyebrow,
  footerHint,
  hideFooter = false,
  metaPrimary,
  metaSecondary,
  metaTertiary,
  titleAccessory,
  actionSlot,
  heroHeader,
  onClick,
  disabled = false,
  minHeight = 316,
  highlighted = false,
  descriptionLineClamp = 3,
}: CharacterShowcaseCardProps) {
  const resolvedDescription = description.replace(/\s+/g, ' ').trim()
  const hasMetaValues = [metaPrimary, metaSecondary, metaTertiary].some((value) => Boolean(value && value.trim()))
  const shouldRenderFooter = !hideFooter && (Boolean(footerHint) || hasMetaValues)

  const rootContent = (
    <Stack sx={{ width: '100%', minHeight, textAlign: 'left', justifyContent: 'space-between' }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: 182,
          overflow: 'hidden',
          background:
            'radial-gradient(circle at 24% 18%, color-mix(in srgb, var(--morius-accent) 14%, transparent), transparent 34%), linear-gradient(155deg, color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%) 0%, color-mix(in srgb, var(--morius-card-bg) 88%, #000 12%) 100%)',
        }}
      >
        {imageUrl ? (
          <DeferredImage
            src={imageUrl}
            alt=""
            rootMargin="320px 0px"
            objectFit="cover"
            objectPosition="center"
            imgSx={{
              transform: `scale(${Math.max(1, Math.min(3, imageScale))})`,
              transformOrigin: 'center center',
            }}
          />
        ) : null}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(8, 12, 18, 0.74) 0%, rgba(8, 12, 18, 0.3) 34%, rgba(8, 12, 18, 0.16) 100%)',
          }}
        />
        {heroHeader ? (
          <Box
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              right: 72,
              zIndex: 2,
              minWidth: 0,
            }}
          >
            {heroHeader}
          </Box>
        ) : null}
        {eyebrow ? (
          <Box
            sx={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              maxWidth: 'calc(100% - 72px)',
              zIndex: 2,
            }}
          >
            <CharacterNoteBadge note={eyebrow} maxWidth="100%" />
          </Box>
        ) : null}
        {actionSlot ? (
          <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
            {actionSlot}
          </Box>
        ) : null}
      </Box>

      <Stack
        spacing={1}
        sx={{
          flex: 1,
          px: 1.35,
          py: 1.18,
          backgroundColor: 'var(--morius-card-bg)',
          borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography
            sx={{
              color: 'var(--morius-text-primary)',
              fontSize: '1.06rem',
              fontWeight: 800,
              lineHeight: 1.16,
              minWidth: 0,
              flex: 1,
            }}
          >
            {title}
          </Typography>
          {titleAccessory ? <Box sx={{ flexShrink: 0 }}>{titleAccessory}</Box> : null}
        </Stack>

        <Typography
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '0.93rem',
            lineHeight: 1.52,
            display: '-webkit-box',
            WebkitLineClamp: descriptionLineClamp,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '4.2em',
          }}
        >
          {resolvedDescription || 'Описание пока не добавлено.'}
        </Typography>

        {shouldRenderFooter ? (
          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={1.2} sx={{ mt: 'auto' }}>
            <Typography
              sx={{
                color: 'rgba(201, 212, 225, 0.88)',
                fontSize: '0.8rem',
                fontWeight: 700,
                lineHeight: 1.3,
                minWidth: 0,
                flex: 1,
              }}
            >
              {footerHint}
            </Typography>

            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0 }}>
              {[metaPrimary, metaSecondary, metaTertiary]
                .filter((value): value is string => Boolean(value && value.trim()))
                .map((value) => (
                  <Typography key={value} sx={{ color: 'rgba(222, 231, 241, 0.9)', fontSize: '0.82rem', fontWeight: 700 }}>
                    {value}
                  </Typography>
                ))}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  )

  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        p: 0,
        borderRadius: '18px',
        border: highlighted
          ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border))'
          : 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'var(--morius-card-bg)',
        overflow: 'hidden',
        justifyContent: 'stretch',
        alignItems: 'stretch',
        boxShadow: highlighted ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 18%, transparent), 0 12px 26px rgba(0, 0, 0, 0.18)' : 'none',
        transition: 'transform 180ms ease, border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease',
        '&:hover': {
          backgroundColor: 'var(--morius-card-bg)',
          borderColor: 'color-mix(in srgb, var(--morius-accent) 46%, var(--morius-card-border))',
          transform: disabled ? 'none' : 'translateY(-2px)',
        },
      }}
    >
      {rootContent}
    </ButtonBase>
  )
}

export default CharacterShowcaseCard
