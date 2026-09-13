// Inline SVG glyph set for the D&D panels. Everything is stroke-based on a 24x24 grid and
// inherits currentColor, so the same icon reads correctly on the dark rail, on a coloured
// sky card and inside a condition chip without a second asset.

import { SvgIcon, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

type GlyphProps = {
  size?: number
  sx?: SxProps<Theme>
  title?: string
}

function Glyph({ size = 20, sx, title, children }: GlyphProps & { children: ReactNode }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size, ...(sx as object) }}>
      {title ? <title>{title}</title> : null}
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </SvgIcon>
  )
}

export function DndD20Icon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M12 2.6 21 7.9v8.2L12 21.4 3 16.1V7.9z" />
      <path d="M12 2.6 7.1 11h9.8z" />
      <path d="M7.1 11 3 16.1M16.9 11 21 16.1M7.1 11h9.8l-4.9 10.4z" />
    </Glyph>
  )
}

export function DndHeartIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M12 20.4 4.6 13a4.7 4.7 0 0 1 0-6.7 4.7 4.7 0 0 1 6.6 0l.8.8.8-.8a4.7 4.7 0 0 1 6.6 0 4.7 4.7 0 0 1 0 6.7z" />
    </Glyph>
  )
}

export function DndShieldIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M12 2.8 20 6v6c0 4.6-3.3 8-8 9.2C7.3 20 4 16.6 4 12V6z" />
    </Glyph>
  )
}

export function DndBackpackIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M6 9a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M9.5 5V4.2A2.2 2.2 0 0 1 11.7 2h.6A2.2 2.2 0 0 1 14.5 4.2V5" />
      <path d="M9 13h6v4H9z" />
    </Glyph>
  )
}

export function DndSheetIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12h7M8.5 15.5h7M8.5 19h4" />
    </Glyph>
  )
}

export function DndStarIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="m12 3.4 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z" />
    </Glyph>
  )
}

export function DndScrollIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M6 4.5h11a2 2 0 0 1 2 2V18a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18V7" />
      <path d="M4.5 7A2.5 2.5 0 0 1 7 4.5" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
    </Glyph>
  )
}

export function DndPeopleIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 6.2M17 14.4a5.5 5.5 0 0 1 3.5 5.1" />
    </Glyph>
  )
}

export function DndPinIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Glyph>
  )
}

// --- Time of day ------------------------------------------------------------------------

export function DndTimeIcon({ timeOfDay, size = 20, sx }: GlyphProps & { timeOfDay: string }) {
  if (timeOfDay === 'night' || timeOfDay === 'midnight') {
    return (
      <Glyph size={size} sx={sx}>
        <path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2z" />
      </Glyph>
    )
  }
  if (timeOfDay === 'dawn' || timeOfDay === 'dusk' || timeOfDay === 'evening') {
    return (
      <Glyph size={size} sx={sx}>
        <path d="M3.5 18h17" />
        <path d="M7 14.5a5 5 0 0 1 10 0" />
        <path d="M12 4.5v2.4M5.4 7.4 7 9M18.6 7.4 17 9M2.8 21h18.4" />
      </Glyph>
    )
  }
  return (
    <Glyph size={size} sx={sx}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2.6M12 18.8v2.6M4.3 4.3l1.9 1.9M17.8 17.8l1.9 1.9M2.6 12h2.6M18.8 12h2.6M4.3 19.7l1.9-1.9M17.8 6.2l1.9-1.9" />
    </Glyph>
  )
}

// --- Weather ------------------------------------------------------------------------------

export function DndWeatherIcon({ weather, size = 20, sx }: GlyphProps & { weather: string }) {
  switch (weather) {
    case 'rain':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M7 15.5a4 4 0 0 1 .5-8 5.2 5.2 0 0 1 9.8 1.3A3.6 3.6 0 0 1 17 15.5z" />
          <path d="M8.5 18.2 7.6 20.4M12 18.2l-.9 2.2M15.5 18.2l-.9 2.2" />
        </Glyph>
      )
    case 'storm':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M7 14.6a4 4 0 0 1 .5-8 5.2 5.2 0 0 1 9.8 1.3 3.6 3.6 0 0 1-.3 6.7" />
          <path d="m12.6 13-2.4 3.8h3l-2.2 3.7" />
        </Glyph>
      )
    case 'snow':
    case 'blizzard':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M7 14.6a4 4 0 0 1 .5-8 5.2 5.2 0 0 1 9.8 1.3A3.6 3.6 0 0 1 17 14.6z" />
          <path d="M9 18.2h.01M12 19.6h.01M15 18.2h.01M10.5 21h.01M13.5 21h.01" />
        </Glyph>
      )
    case 'fog':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M4 9.5h16M3 13h18M5 16.5h14M7 20h10" />
        </Glyph>
      )
    case 'wind':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M3 8.5h10a2.6 2.6 0 1 0-2.6-2.6" />
          <path d="M3 13h14a2.8 2.8 0 1 1-2.8 2.8" />
          <path d="M3 17.6h7" />
        </Glyph>
      )
    case 'cloudy':
    case 'overcast':
      return (
        <Glyph size={size} sx={sx}>
          <path d="M7 17.5a4 4 0 0 1 .5-8 5.2 5.2 0 0 1 9.8 1.3A3.6 3.6 0 0 1 17 17.5z" />
        </Glyph>
      )
    case 'heat':
      return (
        <Glyph size={size} sx={sx}>
          <circle cx="12" cy="9.5" r="3.4" />
          <path d="M12 2.8v1.8M5.6 9.5H3.8M20.2 9.5h-1.8M6.9 4.4 5.7 3.2M17.1 4.4l1.2-1.2" />
          <path d="M4.5 16.5c1.6-1.2 3.2 1.2 4.8 0s3.2 1.2 4.8 0 3.2 1.2 4.8 0M4.5 20c1.6-1.2 3.2 1.2 4.8 0s3.2 1.2 4.8 0 3.2 1.2 4.8 0" />
        </Glyph>
      )
    default:
      return (
        <Glyph size={size} sx={sx}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.4M12 19v2.4M4.5 4.5 6.2 6.2M17.8 17.8l1.7 1.7M2.6 12H5M19 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" />
        </Glyph>
      )
  }
}

// --- Conditions ----------------------------------------------------------------------------

const CONDITION_PATHS: Record<string, ReactNode> = {
  'eye-off': (
    <>
      <path d="M3 3.5 20.5 21" />
      <path d="M10.3 6.3A9 9 0 0 1 12 6.2c5 0 9 5.8 9 5.8a17 17 0 0 1-2.8 3.4M6.4 8.1A17 17 0 0 0 3 12s4 5.8 9 5.8a8.6 8.6 0 0 0 3.2-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  heart: <path d="M12 20.4 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 0 1 6.6 6.7z" />,
  'ear-off': (
    <>
      <path d="M3 3.5 20.5 21" />
      <path d="M7 8a5 5 0 0 1 9.4-1.6M16.5 12.4c-.8 1.4-2 2.2-2.4 3.6-.4 1.6-1.4 3-3.3 3A3 3 0 0 1 7.8 16" />
    </>
  ),
  skull: (
    <>
      <path d="M12 2.8a8 8 0 0 1 8 8c0 2.6-1.2 4.1-2.2 5-.5.5-.8 1-.8 1.7v1.3a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 18.8v-1.3c0-.7-.3-1.2-.8-1.7-1-.9-2.2-2.4-2.2-5a8 8 0 0 1 8-8z" />
      <circle cx="9" cy="11" r="1.5" />
      <circle cx="15" cy="11" r="1.5" />
      <path d="M10 20.6v1.2M14 20.6v1.2" />
    </>
  ),
  grab: (
    <>
      <path d="M8 11V5.8a1.4 1.4 0 0 1 2.8 0V11M10.8 10.4V4.6a1.4 1.4 0 1 1 2.8 0v5.8M13.6 10.8V6.2a1.4 1.4 0 1 1 2.8 0V13" />
      <path d="M8 11V9.2a1.4 1.4 0 0 0-2.8 0v5.4a6.4 6.4 0 0 0 6.4 6.4h1.4a5 5 0 0 0 5-5" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m6 6 12 12" />
    </>
  ),
  'zap-off': (
    <>
      <path d="M3 3.5 20.5 21" />
      <path d="M13.4 3.5 7.8 11h3.4l-.6 4.2M12.6 20.5l3.9-5.3" />
    </>
  ),
  gem: (
    <>
      <path d="M6.5 3.5h11l3.5 5-9 12-9-12z" />
      <path d="M3 8.5h18M9 3.5 7.5 8.5 12 20.5l4.5-12L15 3.5" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3h5M10.5 3v6L5.8 17.4A2.6 2.6 0 0 0 8 21.3h8a2.6 2.6 0 0 0 2.2-3.9L13.5 9V3" />
      <path d="M7.4 14.8h9.2" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4.5v14" />
      <path d="m6.5 13 5.5 5.5 5.5-5.5" />
    </>
  ),
  chain: (
    <>
      <path d="M9.5 14.5a3.6 3.6 0 0 0 5.2 0l2.7-2.8a3.7 3.7 0 0 0-5.2-5.2l-1.5 1.6" />
      <path d="M14.5 9.5a3.6 3.6 0 0 0-5.2 0l-2.7 2.8a3.7 3.7 0 0 0 5.2 5.2l1.5-1.6" />
    </>
  ),
  stars: (
    <>
      <path d="m12 3.5 1.6 3.6 3.9.5-2.9 2.7.8 3.9L12 12.3 8.6 14.2l.8-3.9L6.5 7.6l3.9-.5z" />
      <path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16 18l1.5-.5zM5.5 15.5 6 17l1.5.5L6 18l-.5 1.5L5 18l-1.5-.5L5 17z" />
    </>
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2z" />,
  'battery-low': (
    <>
      <rect x="2.5" y="7.5" width="16" height="9" rx="2" />
      <path d="M21.5 11v2" />
      <path d="M5.5 10.5h2v3h-2z" />
    </>
  ),
  bandage: (
    <>
      <rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)" />
      <path d="M8.6 8.6 15.4 15.4" />
      <path d="M11 11h.01M13 13h.01M13 11h.01M11 13h.01" />
    </>
  ),
  ghost: (
    <>
      <path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.7-2.3 1.7-2.4-1.7-2.4 1.7L7.3 18.3z" />
      <circle cx="9.6" cy="10.5" r="1" />
      <circle cx="14.4" cy="10.5" r="1" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M18 16.5 18.6 18l1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5.8l10-2v12.4" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16.2" r="2.5" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8.5h10a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M3 13h14a2.8 2.8 0 1 1-2.8 2.8" />
    </>
  ),
  flame: (
    <>
      <path d="M12 21.4c3.6 0 6.4-2.6 6.4-6.1 0-4.6-4.4-6.7-4-12.7-3 1.7-5.3 5-5.3 7.7 0 1.4.5 2.3.5 2.3s-1.4-.6-2.2-2c-.9 1.4-1.8 3-1.8 4.7 0 3.5 2.8 6.1 6.4 6.1z" />
    </>
  ),
  shield: <path d="M12 2.8 20 6v6c0 4.6-3.3 8-8 9.2C7.3 20 4 16.6 4 12V6z" />,
  leaf: (
    <>
      <path d="M4.5 19.5C3 15 5.5 4.5 20 4.5c0 11-6 14.5-11 14.5-2 0-3.5-.5-4.5-1z" />
      <path d="M9 15c1.5-3.5 4-6 8-7.5" />
    </>
  ),
}

export function DndLockIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.2" />
      <path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8" />
      <path d="M12 14.4v2.4" />
    </Glyph>
  )
}

export function DndCoinIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="5.1" />
      <path d="M12 9.3v5.4M10.4 10.6h2.4a1.3 1.3 0 0 1 0 2.6h-1.6a1.3 1.3 0 0 0 0 2.6h2.4" />
    </Glyph>
  )
}

export function DndSwordsIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M20.5 3.5 11 13m-2.6 2.6L3.5 20.5" />
      <path d="M17.4 3.5h3.1v3.1" />
      <path d="M3.5 3.5h3.1L16 13m2.6 2.6 1.9 1.9v3.1h-3.1l-1.9-1.9" />
      <path d="M6.8 15.6 4.9 17.5v3.1H8l1.9-1.9" />
    </Glyph>
  )
}

export function DndSkullIcon({ size = 20, sx, title }: GlyphProps) {
  return (
    <Glyph size={size} sx={sx} title={title}>
      <path d="M12 3.2c-4.3 0-7.4 3-7.4 6.9 0 2.3 1.1 4 2.6 5.1v2.4a1.6 1.6 0 0 0 1.6 1.6h6.4a1.6 1.6 0 0 0 1.6-1.6v-2.4c1.5-1.1 2.6-2.8 2.6-5.1 0-3.9-3.1-6.9-7.4-6.9z" />
      <circle cx="9.2" cy="10.4" r="1.5" />
      <circle cx="14.8" cy="10.4" r="1.5" />
      <path d="M12 13.6v2.2" />
    </Glyph>
  )
}

export function DndConditionIcon({ icon, size = 18, sx }: GlyphProps & { icon: string }) {
  const paths = CONDITION_PATHS[icon] ?? CONDITION_PATHS.sparkle
  return (
    <Glyph size={size} sx={sx}>
      {paths}
    </Glyph>
  )
}
