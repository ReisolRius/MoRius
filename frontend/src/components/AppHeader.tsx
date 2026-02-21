import { type ReactNode } from 'react'
import { Box, Button, IconButton, Stack } from '@mui/material'
import { brandLogo, icons } from '../assets'
import { moriusThemeTokens } from '../theme'

export type AppHeaderMenuItem = {
  key: string
  label: string
  onClick: () => void
  isActive?: boolean
}

type ToggleLabels = {
  expanded: string
  collapsed: string
}

type AppHeaderProps = {
  isPageMenuOpen: boolean
  onTogglePageMenu: () => void
  menuItems: AppHeaderMenuItem[]
  pageMenuLabels: ToggleLabels
  isRightPanelOpen: boolean
  onToggleRightPanel: () => void
  rightToggleLabels: ToggleLabels
  rightActions: ReactNode
  rightActionsWidth?: number
}

const HEADER_BUTTON_SIZE = moriusThemeTokens.layout.headerButtonSize

const shellButtonSx = {
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  borderRadius: 'var(--morius-radius)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: 'var(--morius-elevated-bg)',
  color: 'var(--morius-accent)',
  transition: 'background-color 180ms ease',
  '&:hover': {
    backgroundColor: 'var(--morius-button-hover)',
  },
  '&:active': {
    backgroundColor: 'var(--morius-button-active)',
  },
} as const

const menuItemSx = (isActive: boolean) => ({
  width: '100%',
  justifyContent: 'flex-start',
  borderRadius: 'var(--morius-radius)',
  minHeight: 'var(--morius-action-size)',
  px: 1.6,
  color: 'var(--morius-accent)',
  textTransform: 'none',
  fontWeight: 700,
  fontSize: 'var(--morius-body-size)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: isActive ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
  '&:hover': {
    backgroundColor: 'var(--morius-button-hover)',
  },
  '&:active': {
    backgroundColor: 'var(--morius-button-active)',
  },
})

function AppHeader({
  isPageMenuOpen,
  onTogglePageMenu,
  menuItems,
  pageMenuLabels,
  isRightPanelOpen,
  onToggleRightPanel,
  rightToggleLabels,
  rightActions,
  rightActionsWidth = 240,
}: AppHeaderProps) {
  return (
    <>
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 'var(--morius-header-height)',
          zIndex: 34,
          borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)',
          backdropFilter: 'blur(8px)',
          backgroundColor: 'var(--morius-app-base)',
        }}
      />

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          left: 'var(--morius-header-side-offset)',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--morius-icon-gap)',
        }}
      >
        <Box component="img" src={brandLogo} alt="Morius" sx={{ width: moriusThemeTokens.layout.headerLogoWidth, opacity: 0.96 }} />
        <IconButton
          aria-label={isPageMenuOpen ? pageMenuLabels.expanded : pageMenuLabels.collapsed}
          onClick={onTogglePageMenu}
          sx={shellButtonSx}
        >
          <Box component="img" src={icons.home} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-menu-top)',
          left: 'var(--morius-header-side-offset)',
          zIndex: 30,
          width: { xs: moriusThemeTokens.layout.headerMenuWidthXs, md: moriusThemeTokens.layout.headerMenuWidthMd },
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-panel-gradient)',
          p: '10px',
          boxShadow: '0 20px 36px rgba(0, 0, 0, 0.3)',
          transform: isPageMenuOpen ? 'translateX(0)' : 'translateX(-30px)',
          opacity: isPageMenuOpen ? 1 : 0,
          pointerEvents: isPageMenuOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
        }}
      >
        <Stack spacing={1.1}>
          {menuItems.map((item) => (
            <Button key={item.key} sx={menuItemSx(Boolean(item.isActive))} onClick={item.onClick}>
              {item.label}
            </Button>
          ))}
        </Stack>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          right: 'var(--morius-header-side-offset)',
          zIndex: 45,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label={isRightPanelOpen ? rightToggleLabels.expanded : rightToggleLabels.collapsed}
            onClick={onToggleRightPanel}
            sx={shellButtonSx}
          >
            <Box
              component="img"
              src={icons.arrowback}
              alt=""
              sx={{
                width: 20,
                height: 20,
                opacity: 0.9,
                transform: isRightPanelOpen ? 'none' : 'rotate(180deg)',
                transition: 'transform 220ms ease',
              }}
            />
          </IconButton>

          <Box
            sx={{
              ml: isRightPanelOpen ? 1.2 : 0,
              maxWidth: isRightPanelOpen ? rightActionsWidth : 0,
              opacity: isRightPanelOpen ? 1 : 0,
              transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(14px)',
              pointerEvents: isRightPanelOpen ? 'auto' : 'none',
              overflow: 'hidden',
              transition: 'max-width 260ms ease, margin-left 260ms ease, opacity 220ms ease, transform 220ms ease',
            }}
          >
            {rightActions}
          </Box>
        </Box>
      </Box>
    </>
  )
}

export default AppHeader
