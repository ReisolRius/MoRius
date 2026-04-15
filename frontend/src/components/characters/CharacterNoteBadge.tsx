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
          px: 0.5,
          py: 0.14,
          borderRadius: '999px',
          border: 'var(--morius-border-width) solid rgba(140, 188, 230, 0.44)',
          backgroundColor: 'rgba(8, 12, 18, 0.32)',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Typography
        sx={{
          color: 'rgba(184, 218, 247, 0.96)',
          fontSize: '0.62rem',
          lineHeight: 1.2,
          fontWeight: 700,
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
