import { Box } from '@mui/material'

/**
 * The soft accent light that sits behind every redesigned page. It lives on the viewport
 * (fixed) so long pages don't drag it away, and below the shell's content via the
 * `isolation: isolate` the shell gets in index.css.
 */
function AppBackdropGlow() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        background:
          'radial-gradient(1100px 620px at 78% -8%, color-mix(in oklab, var(--morius-accent) 16%, transparent), transparent 70%), radial-gradient(900px 520px at 6% 4%, rgba(120, 180, 200, 0.055), transparent 68%)',
      }}
    />
  )
}

export default AppBackdropGlow
