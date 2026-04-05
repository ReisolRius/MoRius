import { Box } from '@mui/material'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'

type ThemedSvgIconProps = {
  markup: string
  size?: number
  sx?: SxProps<Theme>
}

function normalizeSvgMarkup(markup: string): string {
  return markup
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/\s(fill|stroke)="(?!none)[^"]*"/gi, (_match, attr: string) => ` ${attr}="currentColor"`)
}

function ThemedSvgIcon({ markup, size = 24, sx }: ThemedSvgIconProps) {
  const normalizedMarkup = normalizeSvgMarkup(markup)

  return (
    <Box
      aria-hidden
      sx={[
        {
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          lineHeight: 0,
          '& svg': {
            width: '100%',
            height: '100%',
            display: 'block',
            fill: 'currentColor',
            stroke: 'currentColor',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      dangerouslySetInnerHTML={{ __html: normalizedMarkup }}
    />
  )
}

export default ThemedSvgIcon
