import { Box, Button, Stack, Typography } from '@mui/material'
import cardBgPutnik from '../../assets/images/packages/card-bg-putnik.png'
import cardBgIskatel from '../../assets/images/packages/card-bg-iskatel.png'
import cardBgArkhont from '../../assets/images/packages/card-bg-arkhont.png'
import cardBgLetopisets from '../../assets/images/packages/card-bg-letopisets.png'
import iconPutnik from '../../assets/images/packages/pkg-icon-putnik.png'
import iconIskatel from '../../assets/images/packages/pkg-icon-iskatel.png'
import iconArkhont from '../../assets/images/packages/pkg-icon-arkhont.png'
import iconLetopisets from '../../assets/images/packages/pkg-icon-letopisets.png'
import cardBgIskra from '../../assets/images/packages/card-bg-iskra.png'
import cardBgPlamya from '../../assets/images/packages/card-bg-plamya.png'
import cardBgSozvezdie from '../../assets/images/packages/card-bg-sozvezdie.png'
import iconIskra from '../../assets/images/packages/sub-icon-iskra.png'
import iconPlamya from '../../assets/images/packages/sub-icon-plamya.png'
import iconSozvezdie from '../../assets/images/packages/sub-icon-sozvezdie.png'

// Цвет нижней кромки фоновых картинок: карточка выше картинки, поэтому
// остаток заливается этим же цветом — переход бесшовный.
const CARD_BASE_COLOR = '#02060C'
const CARD_TEXT_COLOR = '#F2F5FB'
const SERIF_FONT = '"Spectral", "Times New Roman", serif'
const SANS_FONT = '"Manrope", "Segoe UI", sans-serif'

type CoinPackageStyle = {
  accent: string
  background: string
  icon: string
}

// Акценты совпадают с цветом верхней каймы, запечённой в фоновых картинках.
export const COIN_PACKAGE_STYLES: readonly CoinPackageStyle[] = [
  { accent: '#4E6EB2', background: cardBgPutnik, icon: iconPutnik },
  { accent: '#52C7B4', background: cardBgIskatel, icon: iconIskatel },
  { accent: '#DEA44F', background: cardBgArkhont, icon: iconArkhont },
  { accent: '#B375E8', background: cardBgLetopisets, icon: iconLetopisets },
]

export const COIN_PACKAGE_BULLETS = {
  standard: [
    'Для старта, тестовых миров и коротких кампаний',
    'Работает с лимитом контекста до 64k.',
    'Один баланс на текст, изображения и эффекты',
  ],
  pro: [
    'Оптимален для регулярной игры и длинных сцен.',
    'Лучший баланс между ценой и запасом валюты.',
    'Один баланс на текст, изображения и эффекты.',
  ],
  mega: [
    'Для больших кампаний и тяжёлых сцен с запасом.',
    'Удобен, если используете дорогие модели.',
    'Один баланс на текст, изображения и эффекты.',
  ],
  legendary: [
    'Максимальный запас для долгих хроник.',
    'Идеален для дорогих и активных кампаний.',
    'Один баланс на текст, изображения и эффекты',
  ],
} as const satisfies Record<string, readonly string[]>

export const SUBSCRIPTION_PACKAGE_STYLES: readonly CoinPackageStyle[] = [
  { accent: '#5DB555', background: cardBgIskra, icon: iconIskra },
  { accent: '#811E26', background: cardBgPlamya, icon: iconPlamya },
  { accent: '#E2B032', background: cardBgSozvezdie, icon: iconSozvezdie },
]

export const SUBSCRIPTION_PACKAGE_BULLETS = {
  spark: [
    '2 модели: DeepSeek V4 Flash и Gemini 2.5 Flash Lite',
    'До 40 ходов в день без списания солов',
    'Память сцены до 8K токенов',
  ],
  flame: [
    '3 модели: DeepSeek V4 Flash, Gemini 2.5 Flash Lite и GLM 4.5 Air',
    'До 60 ходов в день без списания солов',
    'Память сцены до 20K токенов',
  ],
  constellation: [
    '4 модели: добавляется Gemini 3 Flash Preview',
    'До 90 ходов в день без списания солов',
    'Память сцены до 32K токенов',
  ],
} as const satisfies Record<string, readonly string[]>

export type CoinPackageCardProps = {
  title: string
  priceLabel: string
  coinsLabel: string
  bullets: readonly string[]
  styleIndex: number
  buyLabel: string
  onBuy: () => void
  disabled?: boolean
}

function GemBullet({ color, centered = false }: { color: string; centered?: boolean }) {
  return (
    <Box component="svg" viewBox="0 0 13 13" aria-hidden="true" sx={{ width: 12, height: 12, flexShrink: 0, mt: centered ? 0 : '3px' }}>
      <path
        d="M12.3565 4.78125L11.8565 3.65625L10.7565 1.18125C10.4628 0.53125 10.0003 0 8.93777 0H3.56278C2.50028 0 2.03778 0.53125 1.74403 1.18125L0.644025 3.65625L0.144025 4.78125C-0.143475 5.4375 0.0127753 6.4 0.494025 6.93125L4.77528 11.6438C5.58778 12.5375 6.91278 12.5375 7.72528 11.6438L12.0065 6.93125C12.4878 6.4 12.644 5.4375 12.3565 4.78125Z"
        fill={color}
      />
    </Box>
  )
}

export type SubscriptionPlanCardProps = {
  title: string
  priceLabel: string
  bullets: readonly string[]
  styleIndex: number
  buyLabel: string
  onBuy: () => void
  disabled?: boolean
  dimmed?: boolean
}

export function SubscriptionPlanCard({
  title,
  priceLabel,
  bullets,
  styleIndex,
  buyLabel,
  onBuy,
  disabled = false,
  dimmed = false,
}: SubscriptionPlanCardProps) {
  const style = SUBSCRIPTION_PACKAGE_STYLES[styleIndex % SUBSCRIPTION_PACKAGE_STYLES.length]
  const { accent } = style
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        backgroundColor: CARD_BASE_COLOR,
        backgroundImage: `url(${style.background})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'top center',
        backgroundSize: '100% auto',
        border: '1px solid rgba(116, 136, 178, 0.22)',
        boxShadow: '0 18px 42px rgba(0, 0, 0, 0.45)',
        opacity: dimmed ? 0.78 : 1,
        transition: 'transform 240ms ease, box-shadow 240ms ease',
        '&:hover': { transform: 'translateY(-6px)', boxShadow: '0 24px 54px rgba(0, 0, 0, 0.55)' },
      }}
    >
      <Stack sx={{ flex: 1, px: 3.25, pt: 4.5, pb: 3.5 }}>
        <Box component="img" src={style.icon} alt="" loading="lazy" sx={{ width: 66, height: 66, mx: 'auto', objectFit: 'contain' }} />
        <Typography
          component="h3"
          sx={{
            mt: 3.25,
            textAlign: 'center',
            fontFamily: SERIF_FONT,
            fontWeight: 700,
            fontSize: '1.4rem',
            lineHeight: 1.15,
            letterSpacing: '0.02em',
            color: CARD_TEXT_COLOR,
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            mt: 1.75,
            textAlign: 'center',
            fontFamily: SERIF_FONT,
            fontWeight: 700,
            fontSize: '2.2rem',
            lineHeight: 1,
            color: '#FFFFFF',
          }}
        >
          {priceLabel}
        </Typography>
        <Stack sx={{ mt: 4, flex: 1 }}>
          {bullets.map((bullet, bulletIndex) => (
            <Box
              key={bulletIndex}
              sx={{
                display: 'flex',
                gap: 1.25,
                alignItems: 'center',
                py: 1.4,
                borderTop: '1px solid rgba(148, 166, 205, 0.18)',
              }}
            >
              <GemBullet color={accent} centered />
              <Typography sx={{ fontFamily: SANS_FONT, fontSize: '0.82rem', lineHeight: 1.45, color: 'rgba(224, 231, 243, 0.9)' }}>
                {bullet}
              </Typography>
            </Box>
          ))}
        </Stack>
        <Button
          fullWidth
          disableElevation
          onClick={onBuy}
          disabled={disabled}
          sx={{
            mt: 2.5,
            minHeight: 44,
            borderRadius: '10px',
            textTransform: 'none',
            fontFamily: SANS_FONT,
            fontWeight: 700,
            fontSize: '0.92rem',
            color: CARD_TEXT_COLOR,
            border: `1px solid color-mix(in srgb, ${accent} 78%, rgba(10, 16, 28, 0.4))`,
            backgroundColor: `color-mix(in srgb, ${accent} 34%, rgba(7, 12, 22, 0.85))`,
            '&:hover': { backgroundColor: `color-mix(in srgb, ${accent} 46%, rgba(7, 12, 22, 0.85))` },
            '&.Mui-disabled': {
              color: 'rgba(226, 232, 244, 0.55)',
              border: `1px solid color-mix(in srgb, ${accent} 40%, rgba(10, 16, 28, 0.4))`,
              backgroundColor: `color-mix(in srgb, ${accent} 14%, rgba(7, 12, 22, 0.85))`,
            },
          }}
        >
          {buyLabel}
        </Button>
      </Stack>
    </Box>
  )
}

export default function CoinPackageCard({
  title,
  priceLabel,
  coinsLabel,
  bullets,
  styleIndex,
  buyLabel,
  onBuy,
  disabled = false,
}: CoinPackageCardProps) {
  const style = COIN_PACKAGE_STYLES[styleIndex % COIN_PACKAGE_STYLES.length]
  const { accent } = style
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        backgroundColor: CARD_BASE_COLOR,
        backgroundImage: `url(${style.background})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'top center',
        backgroundSize: '100% auto',
        border: '1px solid rgba(116, 136, 178, 0.22)',
        boxShadow: '0 18px 42px rgba(0, 0, 0, 0.45)',
        transition: 'transform 240ms ease, box-shadow 240ms ease',
        '&:hover': { transform: 'translateY(-6px)', boxShadow: '0 24px 54px rgba(0, 0, 0, 0.55)' },
      }}
    >
      <Stack sx={{ flex: 1, px: 3.25, pt: 3.25, pb: 3.75 }}>
        <Box component="img" src={style.icon} alt="" loading="lazy" sx={{ width: 62, height: 62, mx: 'auto', objectFit: 'contain' }} />
        <Typography
          component="h3"
          sx={{
            mt: 2.75,
            textAlign: 'center',
            fontFamily: SERIF_FONT,
            fontWeight: 700,
            fontSize: '1.25rem',
            lineHeight: 1.15,
            letterSpacing: '0.02em',
            color: CARD_TEXT_COLOR,
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            mt: 1.625,
            textAlign: 'center',
            fontFamily: SERIF_FONT,
            fontWeight: 700,
            fontSize: '2rem',
            lineHeight: 1,
            color: '#FFFFFF',
          }}
        >
          {priceLabel}
        </Typography>
        <Typography
          sx={{
            mt: 2,
            textAlign: 'center',
            fontFamily: SERIF_FONT,
            fontWeight: 700,
            fontSize: '0.95rem',
            lineHeight: 1,
            color: accent,
          }}
        >
          {coinsLabel}
        </Typography>
        <Stack sx={{ mt: 3.75, flex: 1 }}>
          {bullets.map((bullet, bulletIndex) => (
            <Box
              key={bulletIndex}
              sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'flex-start',
                py: 1.5,
                borderTop: '1px solid rgba(148, 166, 205, 0.18)',
              }}
            >
              <GemBullet color={accent} />
              <Typography sx={{ fontFamily: SANS_FONT, fontSize: '0.78rem', lineHeight: 1.45, color: 'rgba(224, 231, 243, 0.9)' }}>
                {bullet}
              </Typography>
            </Box>
          ))}
        </Stack>
        <Button
          fullWidth
          disableElevation
          onClick={onBuy}
          disabled={disabled}
          sx={{
            mt: 2.25,
            minHeight: 40,
            borderRadius: '10px',
            textTransform: 'none',
            fontFamily: SANS_FONT,
            fontWeight: 700,
            fontSize: '0.9rem',
            color: CARD_TEXT_COLOR,
            border: `1px solid color-mix(in srgb, ${accent} 62%, rgba(10, 16, 28, 0.4))`,
            backgroundColor: `color-mix(in srgb, ${accent} 16%, rgba(7, 12, 22, 0.85))`,
            '&:hover': { backgroundColor: `color-mix(in srgb, ${accent} 28%, rgba(7, 12, 22, 0.85))` },
            '&.Mui-disabled': {
              color: 'rgba(226, 232, 244, 0.55)',
              border: `1px solid color-mix(in srgb, ${accent} 34%, rgba(10, 16, 28, 0.4))`,
              backgroundColor: `color-mix(in srgb, ${accent} 8%, rgba(7, 12, 22, 0.85))`,
            },
          }}
        >
          {buyLabel}
        </Button>
      </Stack>
    </Box>
  )
}
