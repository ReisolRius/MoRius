import { Box } from '@mui/material'

/**
 * The page backdrop behind every redesigned screen: AI Dungeon's layered off-black, so the page
 * is never flatly black. It lives on the viewport (fixed) so long pages don't drag it away, and
 * below the shell's content via the `isolation: isolate` the shell gets in index.css.
 *
 * Because it is opaque and sits above the shell's own background, it - not `--morius-app-bg` - is
 * what the user actually sees. Anything that wants to repaint the page (the story Appearance
 * panel's gradient, its UI styles) therefore overrides `--morius-app-backdrop` on the shell and
 * this element inherits it.
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
        background: 'var(--morius-app-backdrop, var(--morius-app-bg, #000000))',
        transition: 'background 240ms ease',
      }}
    />
  )
}

export default AppBackdropGlow
