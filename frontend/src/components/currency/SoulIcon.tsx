import type { SxProps, Theme } from '@mui/material/styles'
import soulIconMarkup from '../../assets/icons/new-sol.svg?raw'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'

type SoulIconProps = {
  size?: number
  sx?: SxProps<Theme>
}

export default function SoulIcon({ size = 18, sx }: SoulIconProps) {
  return (
    <ThemedSvgIcon
      markup={soulIconMarkup}
      size={size}
      sx={[
        {
          color: 'inherit',
          filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.16))',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}
