import { Box, Button, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import SoulIcon from '../currency/SoulIcon'
import pricingCardFrame from '../../assets/images/presentation/pricing-card-frame.png'
import redGemIcon from '../../assets/images/presentation/gem-red.svg'

type MoriusPricingCardProps = {
  title: string
  eyebrow?: string
  subtitle?: string
  priceLabel: string
  periodLabel?: string
  soulAmount?: number | string
  details: readonly string[]
  iconSrc: string
  accent: string
  ctaLabel: string
  onCta: () => void
  disabled?: boolean
  badge?: string | null
  footerNote?: string
  ornamentSrc?: string
  variant?: 'package' | 'subscription'
  sx?: SxProps<Theme>
}

export default function MoriusPricingCard({
  title,
  eyebrow,
  subtitle,
  priceLabel,
  periodLabel,
  soulAmount,
  details,
  iconSrc,
  accent,
  ctaLabel,
  onCta,
  disabled = false,
  badge = null,
  footerNote,
  ornamentSrc,
  variant = 'package',
  sx,
}: MoriusPricingCardProps) {
  const isSubscription = variant === 'subscription'

  return (
    <Box
      sx={[
        {
          position: 'relative',
          isolation: 'isolate',
          overflow: 'hidden',
          height: '100%',
          minHeight: { xs: isSubscription ? 420 : 392, sm: isSubscription ? 438 : 410 },
          borderRadius: '8px',
          border: `1px solid color-mix(in srgb, ${accent} 44%, rgba(153,209,255,0.16))`,
          backgroundColor: '#06111a',
          backgroundImage: `
            radial-gradient(circle at 50% 7%, color-mix(in srgb, ${accent} 24%, transparent) 0%, transparent 36%),
            linear-gradient(180deg, rgba(3,8,14,0.2) 0%, rgba(3,8,14,0.72) 52%, rgba(2,5,9,0.98) 100%),
            url(${pricingCardFrame})
          `,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover, cover, 100% 100%',
          backgroundPosition: 'center, center, center',
          boxShadow: `0 22px 58px color-mix(in srgb, ${accent} 12%, rgba(0,0,0,0.78))`,
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: '1px',
            zIndex: -1,
            borderRadius: '7px',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.012) 34%, transparent 100%)',
            pointerEvents: 'none',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            left: '7%',
            right: '7%',
            bottom: 0,
            height: '42%',
            zIndex: -1,
            background: `radial-gradient(ellipse at center bottom, color-mix(in srgb, ${accent} 15%, transparent) 0%, transparent 66%)`,
            pointerEvents: 'none',
          },
          '&:hover': {
            transform: 'translateY(-5px)',
            borderColor: `color-mix(in srgb, ${accent} 70%, rgba(255,255,255,0.24))`,
            boxShadow: `0 28px 72px color-mix(in srgb, ${accent} 18%, rgba(0,0,0,0.84))`,
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {badge ? (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 3,
            px: 1,
            py: 0.42,
            borderRadius: '999px',
            color: '#eef7ff',
            backgroundColor: 'rgba(4,10,16,0.74)',
            border: `1px solid color-mix(in srgb, ${accent} 58%, rgba(255,255,255,0.18))`,
            fontSize: '0.68rem',
            fontWeight: 900,
            lineHeight: 1,
            backdropFilter: 'blur(8px)',
            maxWidth: '46%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </Box>
      ) : null}

      <Stack spacing={0.75} alignItems="center" sx={{ px: 2, pt: { xs: 2.1, md: 2.35 }, pb: 1.1, textAlign: 'center' }}>
        <Box
          component="img"
          src={iconSrc}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{
            width: { xs: 54, md: 62 },
            height: { xs: 54, md: 62 },
            objectFit: 'contain',
            filter: `drop-shadow(0 0 18px color-mix(in srgb, ${accent} 62%, transparent))`,
          }}
        />
        {eyebrow ? (
          <Typography
            sx={{
              color: `color-mix(in srgb, ${accent} 86%, #fff 14%)`,
              fontFamily: '"Manrope", sans-serif',
              fontSize: '0.7rem',
              fontWeight: 900,
              lineHeight: 1,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography
          component="h3"
          sx={{
            color: '#f4f8ff',
            fontFamily: '"Spectral", serif',
            fontSize: { xs: '1.55rem', md: '1.72rem' },
            fontWeight: 700,
            lineHeight: 1.05,
            textShadow: `0 0 18px color-mix(in srgb, ${accent} 18%, transparent)`,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            sx={{
              color: 'rgba(213,227,239,0.72)',
              fontFamily: '"Manrope", sans-serif',
              fontSize: { xs: '0.78rem', md: '0.82rem' },
              lineHeight: 1.34,
              minHeight: isSubscription ? '2.7em' : undefined,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {subtitle}
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={1.15} sx={{ px: { xs: 1.75, md: 2 }, pb: 1.8, flex: 1 }}>
        <Stack spacing={0.7} alignItems="center" sx={{ textAlign: 'center' }}>
          <Stack direction="row" spacing={0.55} alignItems="baseline" justifyContent="center" sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: '#ffffff',
                fontFamily: '"Manrope", sans-serif',
                fontSize: { xs: isSubscription ? '1.82rem' : '2rem', md: isSubscription ? '1.98rem' : '2.12rem' },
                fontWeight: 950,
                lineHeight: 1,
                overflowWrap: 'anywhere',
              }}
            >
              {priceLabel}
            </Typography>
            {periodLabel ? (
              <Typography sx={{ color: 'rgba(213,227,239,0.72)', fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.1 }}>
                {periodLabel}
              </Typography>
            ) : null}
          </Stack>
          {soulAmount !== undefined ? (
            <Stack direction="row" spacing={0.55} alignItems="center" justifyContent="center">
              <Typography sx={{ color: `color-mix(in srgb, ${accent} 88%, #fff 12%)`, fontSize: '1.05rem', fontWeight: 950, lineHeight: 1 }}>
                {soulAmount}
              </Typography>
              <SoulIcon size={21} sx={{ color: `color-mix(in srgb, ${accent} 84%, #fff 16%)`, filter: 'none' }} />
            </Stack>
          ) : null}
        </Stack>

        {ornamentSrc ? (
          <Box
            component="img"
            src={ornamentSrc}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{
              width: '100%',
              height: 42,
              objectFit: 'contain',
              opacity: 0.58,
              filter: `drop-shadow(0 0 12px color-mix(in srgb, ${accent} 28%, transparent))`,
              my: -0.2,
            }}
          />
        ) : null}

        <Stack spacing={0.65} sx={{ flex: 1, minHeight: isSubscription ? 128 : 118 }}>
          {details.map((detail, index) => (
            <Stack key={`${title}-${index}`} direction="row" spacing={0.75} alignItems="flex-start">
              <Box
                component="img"
                src={redGemIcon}
                alt=""
                sx={{
                  width: 11,
                  height: 11,
                  flexShrink: 0,
                  mt: '0.32em',
                  filter: `drop-shadow(0 0 7px color-mix(in srgb, ${accent} 30%, transparent))`,
                }}
              />
              <Typography
                sx={{
                  color: 'rgba(213,227,239,0.76)',
                  fontFamily: '"Manrope", sans-serif',
                  fontSize: { xs: '0.82rem', md: '0.86rem' },
                  lineHeight: 1.35,
                }}
              >
                {detail}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {footerNote ? (
          <Typography sx={{ color: 'rgba(213,227,239,0.58)', fontSize: '0.74rem', lineHeight: 1.32 }}>
            {footerNote}
          </Typography>
        ) : null}

        <Button
          onClick={onCta}
          disabled={disabled}
          sx={{
            mt: 0.2,
            minHeight: 46,
            width: '100%',
            borderRadius: '8px',
            textTransform: 'none',
            color: disabled ? 'rgba(213,227,239,0.52)' : '#07131d',
            fontWeight: 950,
            fontSize: '0.95rem',
            background: disabled
              ? 'rgba(255,255,255,0.08)'
              : `linear-gradient(180deg, color-mix(in srgb, ${accent} 72%, #fff 28%) 0%, ${accent} 100%)`,
            border: `1px solid color-mix(in srgb, ${accent} 44%, rgba(255,255,255,0.16))`,
            '&.Mui-disabled': {
              color: 'rgba(213,227,239,0.52)',
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(255,255,255,0.12)',
            },
            '&:hover': {
              background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 62%, #fff 38%) 0%, color-mix(in srgb, ${accent} 92%, #fff 8%) 100%)`,
            },
          }}
        >
          {ctaLabel}
        </Button>
      </Stack>
    </Box>
  )
}
