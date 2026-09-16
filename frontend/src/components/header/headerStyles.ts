export const HEADER_CONTROL_SIZE = 40

/**
 * Header controls are plain buttons rather than MUI IconButtons: the shell stylesheet pins
 * IconButton sizes and colours with !important, and the redesigned header needs its own.
 */
export const headerIconButtonSx = {
  position: 'relative',
  width: HEADER_CONTROL_SIZE,
  height: HEADER_CONTROL_SIZE,
  minWidth: HEADER_CONTROL_SIZE,
  flex: `0 0 ${HEADER_CONTROL_SIZE}px`,
  display: 'inline-grid',
  placeItems: 'center',
  p: 0,
  m: 0,
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.045)',
  color: '#cfd4e0',
  cursor: 'pointer',
  font: 'inherit',
  lineHeight: 0,
  transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease',
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: 'rgba(255,255,255,0.12)',
    color: 'var(--morius-title-text)',
  },
  '&:focus-visible': {
    outline: '2px solid color-mix(in oklab, var(--morius-accent) 70%, transparent)',
    outlineOffset: '2px',
  },
  '&:disabled': {
    cursor: 'default',
    opacity: 0.6,
  },
} as const
