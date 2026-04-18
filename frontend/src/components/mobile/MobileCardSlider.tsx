/**
 * Reusable AI Dungeon-style landscape card.
 * Used for: Library mobile list, Community mobile list, Game page compact card view.
 * MobileCardSlider is still used for the homepage horizontal slider.
 */
import { Box, IconButton, Stack, SvgIcon, Typography } from '@mui/material'
import type React from 'react'
import ProgressiveAvatar from '../media/ProgressiveAvatar'

// ─── constants ─────────────────────────────────────────────────────────────
export const MOBILE_CARD_HEIGHT = 130
export const MOBILE_CARD_IMAGE_WIDTH = 116
const CARD_BG = 'var(--morius-card-bg)'
const CARD_BORDER = 'var(--morius-card-border)'
const TEXT_PRIMARY = 'var(--morius-text-primary)'
const TEXT_SECONDARY = 'var(--morius-text-secondary)'

// ─── play icon ─────────────────────────────────────────────────────────────
function PlayCircle() {
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        backgroundColor: 'rgba(255,255,255,0.09)',
        border: '1px solid rgba(255,255,255,0.13)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <SvgIcon sx={{ width: 16, height: 16, color: TEXT_PRIMARY }}>
        <path d="M8 5v14l11-7z" fill="currentColor" />
      </SvgIcon>
    </Box>
  )
}

// ─── generic props ──────────────────────────────────────────────────────────
export type MobileCardItemProps = {
  /** Image shown on the left side of the card */
  imageUrl?: string | null
  /** Fallback CSS gradient/background when no image */
  fallbackBackground?: Record<string, unknown>
  /** Card title */
  title: string
  /** Card description (2 lines max) */
  description: string
  /** Author display name */
  authorName?: string
  /** Author avatar URL for the small avatar on top */
  authorAvatarUrl?: string | null
  /** Left stat label e.g. "40 ▶" or "+12" */
  stat1?: string
  /** Right stat label e.g. "5.0 ★" */
  stat2?: string
  /**
   * When true, shows a glowing accent border (card is active in AI memory).
   * @default false
   */
  isActive?: boolean
  /**
   * When provided, renders a ⋯ icon button in the top-right of the content area.
   * The event is NOT propagated to the card onClick.
   */
  onMenuClick?: (e: React.MouseEvent<HTMLElement>) => void
  /**
   * When false, hides the Play circle button. Default: true.
   * Set to false for character cards and rule cards.
   */
  showPlayButton?: boolean
  /**
   * Optional node rendered in the stats row (left side, instead of stat1/stat2 text).
   * Useful for icon badges (clock+turns, ai-edit, active chip, etc.).
   */
  infoNode?: React.ReactNode
  onClick: () => void
}

// ─── single card ───────────────────────────────────────────────────────────
export function MobileCardItem({
  imageUrl,
  fallbackBackground,
  title,
  description,
  authorName,
  authorAvatarUrl,
  stat1,
  stat2,
  isActive = false,
  onMenuClick,
  showPlayButton = true,
  infoNode,
  onClick,
}: MobileCardItemProps) {
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        height: MOBILE_CARD_HEIGHT,
        borderRadius: 'var(--morius-radius)',
        border: isActive
          ? '1.5px solid var(--morius-accent)'
          : `var(--morius-border-width) solid ${CARD_BORDER}`,
        boxShadow: isActive
          ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 40%, transparent) inset, 0 0 18px color-mix(in srgb, var(--morius-accent) 14%, transparent)'
          : 'none',
        backgroundColor: CARD_BG,
        overflow: 'hidden',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'border-color 180ms ease, box-shadow 180ms ease',
        '&:active': { borderColor: isActive ? 'var(--morius-accent)' : 'rgba(203,216,234,0.36)' },
        '&:focus-visible': { outline: '2px solid rgba(205,223,246,0.62)', outlineOffset: '2px' },
      }}
    >
      {/* Left thumbnail */}
      <Box
        sx={{
          position: 'relative',
          width: MOBILE_CARD_IMAGE_WIDTH,
          minWidth: MOBILE_CARD_IMAGE_WIDTH,
          flexShrink: 0,
          overflow: 'hidden',
          backgroundColor: 'rgba(22,32,46,0.9)',
          ...(fallbackBackground ?? {}),
        }}
      >
        {imageUrl ? (
          <Box
            component="img"
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'top center',
            }}
          />
        ) : null}
      </Box>

      {/* Right content */}
      <Stack
        sx={{
          flex: 1,
          minWidth: 0,
          px: 1.5,
          py: 1.4,
          justifyContent: 'space-between',
          gap: '5px',
          overflow: 'hidden',
        }}
      >
        {authorName ? (
          /* ── Author row (avatar + name + ⋮) then title below ── */
          <>
            <Stack direction="row" alignItems="center" sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.6} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                <ProgressiveAvatar
                  src={authorAvatarUrl ?? null}
                  fallbackLabel={authorName}
                  size={20}
                  sx={{ flexShrink: 0, border: 'none' }}
                />
                <Typography
                  sx={{
                    color: TEXT_SECONDARY,
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {authorName}
                </Typography>
              </Stack>
              {onMenuClick ? (
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onMenuClick(e) }}
                  sx={{ p: 0.3, ml: 0.5, flexShrink: 0, color: TEXT_SECONDARY, fontSize: '1rem', lineHeight: 1, '&:hover': { color: TEXT_PRIMARY, backgroundColor: 'rgba(255,255,255,0.08)' } }}
                  aria-label="Действия"
                >
                  {'\u22EE'}
                </IconButton>
              ) : null}
            </Stack>
            {/* Title below author */}
            <Typography sx={{ color: TEXT_PRIMARY, fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </Typography>
          </>
        ) : (
          /* ── No author: title + infoNode + ⋮ all on one row ── */
          <Stack direction="row" alignItems="center" sx={{ minWidth: 0, gap: 0.5 }}>
            <Typography sx={{ color: TEXT_PRIMARY, fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </Typography>
            {infoNode ? <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{infoNode}</Box> : null}
            {onMenuClick ? (
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onMenuClick(e) }}
                sx={{ p: 0.3, flexShrink: 0, color: TEXT_SECONDARY, fontSize: '1rem', lineHeight: 1, '&:hover': { color: TEXT_PRIMARY, backgroundColor: 'rgba(255,255,255,0.08)' } }}
                aria-label="Действия"
              >
                {'\u22EE'}
              </IconButton>
            ) : null}
          </Stack>
        )}

        {/* Description */}
        <Typography
          sx={{
            color: TEXT_SECONDARY,
            fontSize: '0.8rem',
            lineHeight: 1.36,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            flex: 1,
          }}
        >
          {description}
        </Typography>

        {/* Stats row — visible when author-based cards have stats or play button */}
        {(stat1 || stat2 || showPlayButton) ? (
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography sx={{ color: TEXT_SECONDARY, fontSize: '0.74rem', lineHeight: 1 }}>
              {[stat1, stat2].filter(Boolean).join('  ')}
            </Typography>
            {showPlayButton ? <PlayCircle /> : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}

// ─── slider wrapper (homepage only) ─────────────────────────────────────────
/**
 * Wraps children in a horizontally-scrollable snap slider.
 * Used ONLY on the AuthenticatedHomePage sections.
 * For Library/Community/Game page cards use a vertical Stack + MobileCardItem instead.
 */
export function MobileCardSlider({
  children,
  cardWidth = 'calc(100% - 28px)',
}: {
  children: React.ReactNode
  cardWidth?: string
}) {
  return (
    <Box
      sx={{
        display: { xs: 'flex', sm: 'none' },
        gap: '10px',
        overflowX: 'auto',
        pb: '6px',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollSnapType: 'x mandatory',
        '& > *': {
          scrollSnapAlign: 'start',
          width: cardWidth,
          minWidth: cardWidth,
        },
      }}
    >
      {children}
    </Box>
  )
}
