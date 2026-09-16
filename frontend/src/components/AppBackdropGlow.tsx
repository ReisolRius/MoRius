import { Box } from '@mui/material'

/**
 * The page backdrop behind every redesigned screen: AI Dungeon's off-black radial, anchored
 * off the top-left corner so the page is never flatly black. It lives on the viewport (fixed)
 * so long pages don't drag it away, and below the shell's content via the `isolation: isolate`
 * the shell gets in index.css.
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
          'radial-gradient(120% 85% at 18% -6%, #0d0e0f 0%, #070708 45%, #010102 75%, #000000 100%)',
      }}
    />
  )
}

export default AppBackdropGlow
