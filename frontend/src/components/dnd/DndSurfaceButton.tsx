// A button that keeps its own surface inside a dialog.
//
// BaseDialog deliberately flattens every MUI Button and IconButton it contains
// (`background: transparent !important; border: none !important; box-shadow: none !important`)
// so that ordinary dialog actions read as plain text. That is the right default — but the
// D&D sheet needs real controls: a segmented mode switch, ability steppers, weather tiles.
// Those lose their meaning without a fill.
//
// Rather than fight the cascade with ever more !important, this renders a bare <button>, so
// the dialog's `.MuiButton-root` rules simply do not apply to it.

import { Box, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

export type DndSurfaceButtonProps = {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  ariaLabel?: string
  sx?: SxProps<Theme>
  children: ReactNode
}

const baseSx = {
  appearance: 'none',
  font: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0.4,
  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
  borderRadius: '11px',
  color: 'var(--morius-text-secondary)',
  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
  transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 120ms ease',
  '&:hover:not(:disabled)': {
    backgroundColor: 'color-mix(in srgb, var(--morius-accent) 16%, var(--morius-elevated-bg))',
    borderColor: 'color-mix(in srgb, var(--morius-accent) 40%, var(--morius-card-border))',
    color: 'var(--morius-title-text)',
  },
  '&:active:not(:disabled)': { transform: 'scale(0.97)' },
  '&:disabled': {
    cursor: 'default',
    opacity: 0.45,
  },
  '&:focus-visible': {
    outline: '2px solid color-mix(in srgb, var(--morius-accent) 70%, transparent)',
    outlineOffset: 2,
  },
} as const

const activeSx = {
  color: '#11070A',
  backgroundColor: 'var(--morius-accent)',
  borderColor: 'var(--morius-accent)',
  '&:hover:not(:disabled)': {
    color: '#11070A',
    backgroundColor: 'color-mix(in srgb, var(--morius-accent) 86%, #fff 14%)',
    borderColor: 'var(--morius-accent)',
  },
} as const

export default function DndSurfaceButton({
  onClick,
  disabled = false,
  active = false,
  ariaLabel,
  sx,
  children,
}: DndSurfaceButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      sx={[baseSx, active ? activeSx : {}, ...(Array.isArray(sx) ? sx : [sx ?? {}])]}
    >
      {children}
    </Box>
  )
}
