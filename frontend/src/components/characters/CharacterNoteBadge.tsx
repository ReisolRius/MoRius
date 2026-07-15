import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

type CharacterNoteBadgeProps = {
  note: string
  maxWidth?: number | string
  sx?: SxProps<Theme>
}

function CharacterNoteBadge({ note, maxWidth = 112, sx }: CharacterNoteBadgeProps) {
  return (
    <Box
      title={note}
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 0,
          maxWidth,
          p: 0,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Typography
        sx={{
          color: 'var(--morius-rating-gold, #e2b75f)',
          fontFamily: '"Manrope", sans-serif',
          fontSize: '0.68rem',
          lineHeight: 1.18,
          fontWeight: 850,
          letterSpacing: '0.15em !important',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {note}
      </Typography>
    </Box>
  )
}

export default CharacterNoteBadge
