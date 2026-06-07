import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { icons } from '../../assets'

type SoulAmountProps = {
  amount: number | string
  iconSize?: number
  gap?: number
  color?: string
  fontSize?: string | number | Record<string, string | number>
  fontWeight?: number
  sx?: SxProps<Theme>
}

function formatSoulAmount(amount: number | string): string {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return Math.max(0, Math.trunc(amount)).toLocaleString('ru-RU')
  }
  return String(amount)
}

export default function SoulAmount({
  amount,
  iconSize = 16,
  gap = 0.45,
  color = 'currentColor',
  fontSize = 'inherit',
  fontWeight = 900,
  sx,
}: SoulAmountProps) {
  return (
    <Box
      component="span"
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          gap,
          color,
          lineHeight: 1,
          verticalAlign: 'middle',
          whiteSpace: 'nowrap',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Typography component="span" sx={{ color: 'inherit', fontSize, fontWeight, lineHeight: 1 }}>
        {formatSoulAmount(amount)}
      </Typography>
      <Box
        component="img"
        src={icons.coin}
        alt=""
        aria-hidden
        sx={{
          width: Math.round(iconSize * 0.64),
          height: iconSize,
          flex: '0 0 auto',
          display: 'block',
          filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.18))',
        }}
      />
    </Box>
  )
}
