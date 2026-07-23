import { Box, Button, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import SoulIcon from '../currency/SoulIcon'
import planCardBg from '../../assets/images/presentation/plan-card-bg.jpg'
import perkGemMarkup from '../../assets/images/presentation/perk-gem.svg?raw'

type PresentationPlanCardProps = {
  title: string
  price: string
  accent: string
  details: string[]
  iconSrc?: string
  sparkleIcon?: boolean
  balance?: string | number | null
  priceCaption?: string
  buttonLabel: string
  onClick: () => void
  disabled?: boolean
  badge?: string | null
  note?: string
  minHeight?: number
  sx?: SxProps<Theme>
}

function SparkIcon({ color }: { color: string }) {
  return (
    <Box component="svg" viewBox="0 0 80 80" aria-hidden sx={{ width: 66, height: 66, color }}>
      <path d="M40 4c3 19 9 25 28 28-19 3-25 9-28 28-3-19-9-25-28-28C31 29 37 23 40 4Z" fill="currentColor" />
      <circle cx="17" cy="57" r="4" fill="currentColor" opacity="0.7" />
      <circle cx="63" cy="14" r="3" fill="currentColor" opacity="0.78" />
      <path d="M58 45c1.4 8.5 4.5 11.6 13 13-8.5 1.4-11.6 4.5-13 13-1.4-8.5-4.5-11.6-13-13 8.5-1.4 11.6-4.5 13-13Z" fill="currentColor" opacity="0.82" />
    </Box>
  )
}

function GemBullet({ accent }: { accent: string }) {
  return (
    <Box
      aria-hidden
      dangerouslySetInnerHTML={{ __html: perkGemMarkup }}
      sx={{
        width: 13,
        height: 13,
        mt: '3px',
        flex: '0 0 13px',
        lineHeight: 0,
        filter: `drop-shadow(0 0 5px ${accent})`,
        '& svg': { display: 'block', width: '13px', height: '13px' },
        '& path': { fill: `${accent} !important` },
      }}
    />
  )
}

export default function PresentationPlanCard({
  title,
  price,
  accent,
  details,
  iconSrc,
  sparkleIcon = false,
  balance = null,
  priceCaption,
  buttonLabel,
  onClick,
  disabled = false,
  badge,
  note,
  minHeight = 500,
  sx,
}: PresentationPlanCardProps) {
  return (
    <Box
      sx={[
        {
          position: 'relative',
          isolation: 'isolate',
          minHeight,
          height: '100%',
          overflow: 'hidden',
          borderRadius: '12px',
          border: `1px solid color-mix(in srgb, ${accent} 54%, rgba(255,255,255,0.06))`,
          backgroundImage: `linear-gradient(180deg, rgba(4,12,21,0.12) 0%, rgba(3,8,14,0.72) 34%, rgba(2,5,9,0.96) 100%), url(${planCardBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          boxShadow: `0 24px 60px rgba(0,0,0,0.52), inset 0 1px 0 color-mix(in srgb, ${accent} 30%, transparent)`,
          opacity: disabled ? 0.78 : 1,
          transition: 'transform 260ms ease, box-shadow 260ms ease, border-color 260ms ease',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            background: `radial-gradient(circle at 50% 2%, color-mix(in srgb, ${accent} 20%, transparent), transparent 34%)`,
            pointerEvents: 'none',
          },
          '&:hover': disabled
            ? undefined
            : {
                transform: 'translateY(-8px)',
                borderColor: `color-mix(in srgb, ${accent} 82%, white 18%)`,
                boxShadow: `0 34px 74px rgba(0,0,0,0.62), 0 0 34px color-mix(in srgb, ${accent} 12%, transparent)`,
              },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {badge ? (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 3,
            px: 1,
            py: 0.45,
            borderRadius: '999px',
            color: '#eef7ff',
            background: `color-mix(in srgb, ${accent} 28%, #050a10)`,
            border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
            fontSize: '0.66rem',
            fontWeight: 900,
          }}
        >
          {badge}
        </Box>
      ) : null}

      <Stack alignItems="center" sx={{ height: '100%', px: { xs: 2.2, md: 2.5 }, pt: 3, pb: 2.5 }}>
        <Box sx={{ height: 70, display: 'grid', placeItems: 'center', mb: 0.8 }}>
          {sparkleIcon ? (
            <SparkIcon color={accent} />
          ) : (
            <Box component="img" src={iconSrc} alt="" sx={{ width: 68, height: 68, objectFit: 'contain' }} />
          )}
        </Box>
        <Typography component="h3" sx={{ color: '#dce7f2', fontFamily: '"Spectral", serif', fontSize: '1.18rem', fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography
          sx={{
            mt: 0.4,
            color: '#fff',
            fontFamily: '"Spectral", serif',
            fontSize: { xs: '2rem', md: '2.15rem' },
            fontWeight: 700,
            lineHeight: 1.1,
            textShadow: '0 3px 18px rgba(255,255,255,0.12)',
          }}
        >
          {price}
        </Typography>

        {balance !== null && balance !== undefined ? (
          <Stack direction="row" alignItems="center" spacing={0.6} sx={{ mt: 0.65, color: accent }}>
            <Typography sx={{ color: 'inherit', fontSize: '0.9rem', fontWeight: 900 }}>{balance}</Typography>
            <SoulIcon size={17} sx={{ color: 'inherit', filter: `drop-shadow(0 0 5px ${accent})` }} />
          </Stack>
        ) : (
          <Typography sx={{ mt: 0.65, color: '#727f8f', fontSize: '0.72rem', fontWeight: 700 }}>
            {priceCaption ?? 'в месяц'}
          </Typography>
        )}

        <Stack spacing={1.05} sx={{ width: '100%', mt: 2.2, flex: 1 }}>
          {details.map((detail, index) => (
            <Stack key={`${index}-${detail}`} direction="row" spacing={1} alignItems="flex-start">
              <GemBullet accent={accent} />
              <Typography sx={{ color: '#aeb7c2', fontSize: '0.74rem', lineHeight: 1.48 }}>
                {detail}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {note ? (
          <Typography sx={{ width: '100%', mt: 1.2, color: '#727f8f', fontSize: '0.68rem', lineHeight: 1.45 }}>
            {note}
          </Typography>
        ) : null}

        <Button
          variant="contained"
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: '100%',
            minHeight: 40,
            mt: 2.2,
            borderRadius: '8px',
            color: '#edf6ff',
            background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 30%, #08121b), color-mix(in srgb, ${accent} 16%, #03080d))`,
            border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
            boxShadow: 'none',
            fontSize: '0.72rem',
            fontWeight: 800,
            textTransform: 'none',
            '&.Mui-disabled': {
              color: '#75808d',
              background: '#081018',
              borderColor: 'rgba(255,255,255,0.08)',
            },
            '&:hover': {
              background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 40%, #08121b), color-mix(in srgb, ${accent} 22%, #03080d))`,
              boxShadow: `0 8px 24px color-mix(in srgb, ${accent} 14%, transparent)`,
            },
          }}
        >
          {buttonLabel}
        </Button>
      </Stack>
    </Box>
  )
}
