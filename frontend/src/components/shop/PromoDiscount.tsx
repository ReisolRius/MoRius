import { useEffect, useMemo, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'

// Mirrors backend app/services/promo.py. The backend stays the authority on the price that is
// actually charged -- this only decides what the storefront shows, so the worst case if the
// two ever disagree is a banner that lingers a moment, never a wrong charge.
export const PROMO_ENDS_AT_MS = Date.parse('2026-08-14T00:00:00+03:00')
export const PROMO_DISCOUNT_PERCENT = 10
export const PROMO_TITLE = 'Скидка 10% на всё'
export const PROMO_SUBTITLE = 'Солы и подписки — до 13 августа 23:59 (МСК)'

export function isPromoRunning(now: number = Date.now()): boolean {
  return now < PROMO_ENDS_AT_MS
}

function useMillisecondsLeft(): number {
  const [msLeft, setMsLeft] = useState(() => Math.max(PROMO_ENDS_AT_MS - Date.now(), 0))

  useEffect(() => {
    if (msLeft <= 0) {
      return
    }
    const timerId = window.setInterval(() => {
      setMsLeft(Math.max(PROMO_ENDS_AT_MS - Date.now(), 0))
    }, 1000)
    return () => window.clearInterval(timerId)
  }, [msLeft <= 0])

  return msLeft
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.floor(msLeft / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return days > 0
    ? `${days} д ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** Storewide banner with a live countdown. Renders nothing once the promotion is over. */
export function PromoBanner({ compact = false }: { compact?: boolean }) {
  const msLeft = useMillisecondsLeft()
  if (msLeft <= 0) {
    return null
  }

  return (
    <Box
      sx={{
        borderRadius: '14px',
        border: '1px solid rgba(255, 138, 76, 0.42)',
        background:
          'linear-gradient(135deg, rgba(255, 138, 76, 0.16) 0%, rgba(255, 92, 122, 0.12) 100%)',
        px: compact ? 1.2 : 1.6,
        py: compact ? 0.9 : 1.15,
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={0.85}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              px: 0.85,
              py: 0.3,
              borderRadius: '999px',
              backgroundColor: '#ff8a4c',
              color: '#1a1005',
              fontWeight: 900,
              fontSize: '0.78rem',
              lineHeight: 1.2,
              flexShrink: 0,
            }}
          >
            −{PROMO_DISCOUNT_PERCENT}%
          </Box>
          <Stack spacing={0.05} sx={{ minWidth: 0 }}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.94rem', fontWeight: 900, lineHeight: 1.2 }}>
              {PROMO_TITLE}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', lineHeight: 1.25 }}>
              {PROMO_SUBTITLE}
            </Typography>
          </Stack>
        </Stack>

        <Stack spacing={0.05} alignItems={{ xs: 'flex-start', sm: 'flex-end' }} sx={{ flexShrink: 0 }}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            До конца акции
          </Typography>
          <Typography
            sx={{
              color: '#ffb184',
              fontSize: '1.02rem',
              fontWeight: 900,
              lineHeight: 1.15,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatCountdown(msLeft)}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

/**
 * Price with the pre-discount amount struck through beside it.
 *
 * Falls back to rendering just the current price when there is no discount, so callers can
 * use it unconditionally and it stops showing an old price the moment the promotion ends.
 */
export function PromoPrice({
  price,
  basePrice,
  formatPrice,
  size = 'md',
}: {
  price: number
  basePrice?: number | null
  formatPrice: (value: number) => string
  size?: 'sm' | 'md'
}) {
  const hasDiscount = useMemo(
    () => typeof basePrice === 'number' && basePrice > price && isPromoRunning(),
    [basePrice, price],
  )

  if (!hasDiscount) {
    return <>{formatPrice(price)}</>
  }

  return (
    <Stack component="span" direction="row" alignItems="baseline" spacing={0.6} sx={{ display: 'inline-flex' }}>
      <Box component="span">{formatPrice(price)}</Box>
      <Box
        component="span"
        sx={{
          color: 'var(--morius-text-secondary)',
          textDecoration: 'line-through',
          fontWeight: 600,
          fontSize: size === 'sm' ? '0.76rem' : '0.86rem',
          opacity: 0.85,
        }}
      >
        {formatPrice(basePrice as number)}
      </Box>
    </Stack>
  )
}
