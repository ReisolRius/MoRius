import { Box, Typography, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

type TextLimitIndicatorProps = {
  currentLength: number
  maxLength: number
  helperText?: ReactNode
  sx?: SxProps<Theme>
}

function TextLimitIndicator({ currentLength, maxLength, helperText, sx }: TextLimitIndicatorProps) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: helperText ? 'space-between' : 'flex-end',
          gap: 1,
          width: '100%',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {helperText ? (
        <Typography
          component="span"
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '0.74rem',
            lineHeight: 1.35,
            minWidth: 0,
          }}
        >
          {helperText}
        </Typography>
      ) : null}
      <Typography
        component="span"
        sx={{
          color: 'var(--morius-text-secondary)',
          fontSize: '0.74rem',
          lineHeight: 1.35,
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        {currentLength}/{maxLength}
      </Typography>
    </Box>
  )
}

export default TextLimitIndicator
