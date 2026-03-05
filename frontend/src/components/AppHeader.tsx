import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  SvgIcon,
  Tooltip,
  Typography,
  useMediaQuery,
  type SelectChangeEvent,
} from '@mui/material'
import { brandLogo, icons } from '../assets'
import BaseDialog from './dialogs/BaseDialog'
import { moriusThemeTokens, useMoriusThemeController } from '../theme'

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
  hideRightToggle?: boolean
  onOpenTopUpDialog?: () => void
  onOpenBugReportDialog?: () => void
}

type SidebarIconComponent = typeof SidebarHomeIcon

const HEADER_BUTTON_SIZE = moriusThemeTokens.layout.headerButtonSize
const MENU_COLLAPSED_WIDTH = 64
const MENU_EXPANDED_WIDTH = 244
const MENU_PANEL_TOP_OFFSET = HEADER_BUTTON_SIZE + 12
const LOGO_WIDTH = 86

const shellButtonSx = {
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  borderRadius: '10px',
  border: 'none',
  backgroundColor: 'transparent',
  color: 'var(--morius-text-secondary)',
  transition: 'color 180ms ease',
  '&:hover': {
    color: 'var(--morius-accent)',
    backgroundColor: 'transparent',
  },
  '&:active': {
    backgroundColor: 'transparent',
  },
} as const

const sidebarButtonSx = (isActive: boolean, isExpanded: boolean, isUtility = false, preserveLabelColor = false) => {
  const baseTextColor = isUtility ? 'var(--morius-text-secondary)' : 'var(--morius-text-primary)'
  const resolvedTextColor = preserveLabelColor ? baseTextColor : (isActive ? 'var(--morius-title-text)' : baseTextColor)

  return {
    width: isExpanded ? '100%' : 'fit-content',
    minWidth: isExpanded ? '100%' : 0,
    minHeight: isExpanded ? 44 : 0,
    px: isExpanded ? 1 : 0,
    py: isExpanded ? 0.5 : 0,
    justifyContent: 'flex-start',
    borderRadius: isExpanded ? '14px' : '12px',
    border: isActive && isExpanded ? 'var(--morius-border-width) solid transparent' : 'var(--morius-border-width) solid transparent',
    backgroundColor: isActive && isExpanded ? 'var(--morius-button-hover)' : 'transparent',
    color: resolvedTextColor,
    textTransform: 'none',
    fontWeight: isActive ? 800 : 700,
    fontSize: '0.94rem',
    letterSpacing: '0.01em',
    transition: 'background-color 220ms ease, color 180ms ease, min-width 220ms ease, padding 220ms ease',
    '&:hover': {
      backgroundColor: isExpanded
        ? (isActive ? 'var(--morius-button-hover)' : 'color-mix(in srgb, var(--morius-button-hover) 72%, transparent)')
        : 'transparent',
      color: preserveLabelColor ? baseTextColor : 'var(--morius-title-text)',
    },
    '&:active': {
      backgroundColor: isExpanded
        ? (isActive ? 'var(--morius-button-hover)' : 'color-mix(in srgb, var(--morius-button-hover) 72%, transparent)')
        : 'transparent',
    },
  }
}

const sidebarIconWrapSx = (isActive: boolean, isExpanded: boolean) => ({
  width: isExpanded ? 40 : 42,
  height: isExpanded ? 36 : 42,
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: isExpanded ? 'flex-start' : 'center',
  pl: isExpanded ? 1 : 0,
  flexShrink: 0,
  color: isActive ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
  backgroundColor: isActive ? 'color-mix(in srgb, var(--morius-button-hover) 92%, var(--morius-app-surface))' : 'transparent',
  transition: 'background-color 220ms ease, color 180ms ease',
})

const sidebarLabelSx = (isExpanded: boolean) => ({
  ml: isExpanded ? 0.8 : 0,
  maxWidth: isExpanded ? 160 : 0,
  opacity: isExpanded ? 1 : 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  transition: 'max-width 220ms ease, opacity 180ms ease, margin-left 220ms ease',
})

function SidebarHomeIcon() {
  return (
    <SvgIcon viewBox="0 0 20 19" sx={{ width: 20, height: 20 }}>
      <path
        d="M11.2281 0.421388C10.877 0.148279 10.4449 0 10.0001 0C9.5553 0 9.12319 0.148279 8.7721 0.421388L0.388104 6.94139C-0.363896 7.52839 0.0501037 8.73339 1.0031 8.73339H2.0001V16.7334C2.0001 17.2638 2.21082 17.7725 2.58589 18.1476C2.96096 18.5227 3.46967 18.7334 4.0001 18.7334H8.0001V12.7334C8.0001 12.203 8.21082 11.6942 8.58589 11.3192C8.96096 10.9441 9.46967 10.7334 10.0001 10.7334C10.5305 10.7334 11.0392 10.9441 11.4143 11.3192C11.7894 11.6942 12.0001 12.203 12.0001 12.7334V18.7334H16.0001C16.5305 18.7334 17.0392 18.5227 17.4143 18.1476C17.7894 17.7725 18.0001 17.2638 18.0001 16.7334V8.73339H18.9971C19.9491 8.73339 20.3651 7.52839 19.6121 6.94239L11.2281 0.421388Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function SidebarCommunityIcon() {
  return (
    <SvgIcon viewBox="0 0 29 20" sx={{ width: 20, height: 20 }}>
      <path
        d="M14.2857 0C13.1491 0 12.059 0.451529 11.2553 1.25526C10.4515 2.05898 10 3.14907 10 4.28571C10 5.42236 10.4515 6.51245 11.2553 7.31617C12.059 8.1199 13.1491 8.57143 14.2857 8.57143C15.4224 8.57143 16.5124 8.1199 17.3162 7.31617C18.1199 6.51245 18.5714 5.42236 18.5714 4.28571C18.5714 3.14907 18.1199 2.05898 17.3162 1.25526C16.5124 0.451529 15.4224 0 14.2857 0ZM15.7143 10H12.8571C8.91429 10 5.71429 13.2 5.71429 17.1429V17.8571C5.71429 19.0429 6.67143 20 7.85714 20H20.7143C21.9 20 22.8571 19.0429 22.8571 17.8571V17.1429C22.8571 13.2 19.6571 10 15.7143 10ZM6.42857 8.57143C7.1 8.57143 7.71429 8.4 8.24286 8.1C7.64371 7.14606 7.27724 6.06462 7.17301 4.94296C7.06879 3.82131 7.22973 2.69086 7.64286 1.64286C7.27143 1.51429 6.85714 1.42857 6.42857 1.42857C4.37143 1.42857 2.85714 2.94286 2.85714 5C2.85714 7.05714 4.37143 8.57143 6.42857 8.57143ZM5.87143 10H5C2.24286 10 0 12.2429 0 15V16.4286C0 16.8286 0.314286 17.1429 0.714286 17.1429H2.85714C2.85714 14.3429 4.01429 11.8143 5.87143 10ZM22.1429 8.57143C24.2 8.57143 25.7143 7.05714 25.7143 5C25.7143 2.94286 24.2 1.42857 22.1429 1.42857C21.7 1.42857 21.3 1.51429 20.9286 1.64286C21.3417 2.69086 21.5026 3.82131 21.3984 4.94296C21.2942 6.06462 20.9277 7.14606 20.3286 8.1C20.8571 8.4 21.4571 8.57143 22.1429 8.57143ZM23.5714 10H22.7C23.6545 10.9285 24.4131 12.0391 24.9309 13.266C25.4486 14.4929 25.715 15.8112 25.7143 17.1429H27.8571C28.2571 17.1429 28.5714 16.8286 28.5714 16.4286V15C28.5714 12.2429 26.3286 10 23.5714 10Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function SidebarLibraryIcon() {
  return (
    <SvgIcon viewBox="0 0 18 20" sx={{ width: 20, height: 20 }}>
      <path d="M17 0H3C1.35 0 0 1.35 0 3V17C0 18.65 1.35 20 3 20H18V18H3C2.45 18 2 17.55 2 17C2 16.45 2.45 16 3 16H17C17.55 16 18 15.55 18 15V1C18 0.45 17.55 0 17 0ZM14 6H5V4H14V6Z" fill="currentColor" />
    </SvgIcon>
  )
}

function SidebarBugReportIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
      <path
        d="M17 4h-1.18C15.4 2.84 14.3 2 13 2h-2c-1.3 0-2.4.84-2.82 2H7c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-6 0h2c.37 0 .69.2.87.5h-3.74c.18-.3.5-.5.87-.5zM12 18a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 12 18zm1-4h-2V8h2v6z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

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
  hideRightToggle = false,
  onOpenTopUpDialog,
  onOpenBugReportDialog,
}: AppHeaderProps) {
  const [isThemeDialogOpen, setIsThemeDialogOpen] = useState(false)
  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLDivElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const {
    themeId,
    themes,
    placeholders,
    setTheme,
    storyHistoryFontFamily,
    storyHistoryFontWeight,
    voiceInputEnabled,
    storyHistoryFontFamilyOptions,
    storyHistoryFontWeightOptions,
    setStoryHistoryFontFamily,
    setStoryHistoryFontWeight,
    setVoiceInputEnabled,
  } = useMoriusThemeController()
  const isGrayTheme = themeId === 'gray'
  const isYamiTheme = themeId === 'yami-rius'
  const neutralImageIconFilter = isGrayTheme ? 'grayscale(1) brightness(0.82)' : (isYamiTheme ? 'grayscale(1) brightness(1.72)' : 'none')
  const isCompactSidebar = useMediaQuery('(max-width:1439.95px)')

  const handleOpenThemeDialog = () => setIsThemeDialogOpen(true)
  const handleCloseThemeDialog = () => setIsThemeDialogOpen(false)
  const handleOpenSupportDialog = () => setIsSupportDialogOpen(true)
  const handleCloseSupportDialog = () => setIsSupportDialogOpen(false)

  const handleOpenTopUpDialog = () => {
    if (!onOpenTopUpDialog) {
      return
    }
    onOpenTopUpDialog()
  }

  const handleOpenBugReportDialog = () => {
    if (!onOpenBugReportDialog) {
      return
    }
    onOpenBugReportDialog()
  }

  const primaryMenuIcons = [SidebarHomeIcon, SidebarCommunityIcon, SidebarLibraryIcon]
  const primaryMenuIconByKey: Record<string, SidebarIconComponent> = {
    dashboard: SidebarHomeIcon,
    'games-my': SidebarLibraryIcon,
    'games-all': SidebarCommunityIcon,
    'community-worlds': SidebarCommunityIcon,
    'world-create': SidebarLibraryIcon,
  }
  const showLogo = isPageMenuOpen || !isCompactSidebar
  const showPrimaryItems = isPageMenuOpen || !isCompactSidebar
  const showUtilityItems = isPageMenuOpen
  const shouldRenderSidebarPanel = !isCompactSidebar || isPageMenuOpen
  const sidebarWidth = isCompactSidebar
    ? (isPageMenuOpen ? MENU_EXPANDED_WIDTH : HEADER_BUTTON_SIZE)
    : (isPageMenuOpen ? MENU_EXPANDED_WIDTH : MENU_COLLAPSED_WIDTH)
  const utilityImageIconSx = {
    width: 20,
    height: 20,
    opacity: 0.92,
    ...(neutralImageIconFilter !== 'none' ? { filter: neutralImageIconFilter } : {}),
  } as const
  const utilityMenuItems = [
    {
      key: 'theme-settings',
      label: 'Настройки',
      onClick: handleOpenThemeDialog,
      icon: <Box component="img" src={icons.menuSettings} alt="" sx={utilityImageIconSx} />,
    },
    {
      key: 'support',
      label: 'Поддержка',
      onClick: handleOpenSupportDialog,
      icon: <Box component="img" src={icons.help} alt="" sx={utilityImageIconSx} />,
    },
    ...(onOpenTopUpDialog
      ? [
          {
            key: 'top-up',
            label: 'Пополнить',
            onClick: handleOpenTopUpDialog,
            icon: <Box component="img" src={icons.menuShop} alt="" sx={utilityImageIconSx} />,
          },
        ]
      : []),
    ...(onOpenBugReportDialog
      ? [
          {
            key: 'bug-report',
            label: 'Баг Репорт',
            onClick: handleOpenBugReportDialog,
            icon: <SidebarBugReportIcon />,
          },
        ]
      : []),
  ]

  useEffect(() => {
    if (!isPageMenuOpen) {
      return
    }

    const handleOutsideMenuClick = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      const clickedToggleArea = menuTriggerRef.current?.contains(target) ?? false
      const clickedMenuPanel = menuPanelRef.current?.contains(target) ?? false
      if (clickedToggleArea || clickedMenuPanel) {
        return
      }

      onTogglePageMenu()
    }

    window.addEventListener('pointerdown', handleOutsideMenuClick)
    return () => {
      window.removeEventListener('pointerdown', handleOutsideMenuClick)
    }
  }, [isPageMenuOpen, onTogglePageMenu])

  return (
    <>
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 'calc(var(--morius-header-height) + 40px)',
          zIndex: 34,
          pointerEvents: 'none',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)',
          maskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.52) 64%, rgba(0, 0, 0, 0) 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.52) 64%, rgba(0, 0, 0, 0) 100%)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--morius-app-base) 68%, transparent) 0%, color-mix(in srgb, var(--morius-app-base) 32%, transparent) 46%, rgba(0, 0, 0, 0) 100%)',
        }}
      />

      <Box
        ref={menuTriggerRef}
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          left: 'var(--morius-header-side-offset)',
          zIndex: 37,
          width: isPageMenuOpen ? sidebarWidth : 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 0.8,
          pointerEvents: 'auto',
        }}
      >
        <IconButton
          aria-label={isPageMenuOpen ? pageMenuLabels.expanded : pageMenuLabels.collapsed}
          onClick={onTogglePageMenu}
          sx={shellButtonSx}
        >
          <Box
            component="img"
            src={icons.menu}
            alt=""
            sx={{
              width: 20,
              height: 20,
              opacity: 0.9,
              ...(neutralImageIconFilter !== 'none' ? { filter: neutralImageIconFilter } : {}),
            }}
          />
        </IconButton>
        <Box
          sx={{
            position: isPageMenuOpen ? 'absolute' : 'relative',
            left: isPageMenuOpen ? '50%' : 'auto',
            transform: isPageMenuOpen ? 'translateX(-50%)' : 'none',
            flexShrink: 0,
            width: showLogo ? LOGO_WIDTH : 0,
            opacity: showLogo ? 1 : 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            transition: 'width 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 220ms ease',
          }}
        >
          <Box
            component="img"
            src={brandLogo}
            alt="Morius"
            sx={{
              width: LOGO_WIDTH,
              height: 'auto',
              display: 'block',
              opacity: 0.96,
            }}
          />
        </Box>
      </Box>

      {shouldRenderSidebarPanel ? (
        <Box
          ref={menuPanelRef}
          sx={{
            position: 'fixed',
            top: `calc(var(--morius-header-top-offset) + ${MENU_PANEL_TOP_OFFSET}px)`,
            left: 'var(--morius-header-side-offset)',
            zIndex: 36,
            width: sidebarWidth,
            pointerEvents: 'auto',
            transition: 'width 240ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <Box
            sx={{
              overflow: 'hidden',
              px: isPageMenuOpen ? 1.1 : 0.65,
              py: 0.8,
              borderRadius: '28px',
              background: 'color-mix(in srgb, var(--morius-app-surface) 90%, transparent)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              transition:
                'padding 240ms cubic-bezier(0.22, 1, 0.36, 1), background-color 220ms ease, border-radius 220ms ease',
            }}
          >
            <Stack spacing={1.2} alignItems="flex-start">
              <Stack
                spacing={0.55}
                sx={{
                  width: isPageMenuOpen ? '100%' : 'fit-content',
                  minWidth: 0,
                  pt: 1,
                  maxHeight: showPrimaryItems ? 320 : 0,
                  opacity: showPrimaryItems ? 1 : 0,
                  overflow: 'hidden',
                  pointerEvents: showPrimaryItems ? 'auto' : 'none',
                  transition: 'max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                }}
              >
                {menuItems.map((item, index) => {
                  const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                  const isActive = Boolean(item.isActive)

                  return (
                    <Tooltip key={item.key} title={isPageMenuOpen ? '' : item.label} placement="right" disableHoverListener={isPageMenuOpen}>
                      <Button sx={sidebarButtonSx(isActive, isPageMenuOpen, false, isGrayTheme)} onClick={item.onClick}>
                        <Box sx={sidebarIconWrapSx(isActive, isPageMenuOpen)}>
                          <MenuIcon />
                        </Box>
                        <Box component="span" sx={sidebarLabelSx(isPageMenuOpen)}>
                          {item.label}
                        </Box>
                      </Button>
                    </Tooltip>
                  )
                })}
              </Stack>

              {showUtilityItems ? (
                <Box
                  sx={{
                    width: '100%',
                    borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
                    opacity: showUtilityItems ? 1 : 0,
                    transition: 'opacity 180ms ease',
                  }}
                />
              ) : null}

              <Stack
                spacing={0.55}
                sx={{
                  width: '100%',
                  maxHeight: showUtilityItems ? 240 : 0,
                  opacity: showUtilityItems ? 1 : 0,
                  overflow: 'hidden',
                  pointerEvents: showUtilityItems ? 'auto' : 'none',
                  transition: 'max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                }}
              >
                {utilityMenuItems.map((item) => (
                  <Tooltip key={item.key} title={isPageMenuOpen ? '' : item.label} placement="right" disableHoverListener={isPageMenuOpen}>
                    <Button sx={sidebarButtonSx(false, isPageMenuOpen, true)} onClick={item.onClick}>
                      <Box sx={sidebarIconWrapSx(false, isPageMenuOpen)}>{item.icon}</Box>
                      <Box component="span" sx={sidebarLabelSx(isPageMenuOpen)}>
                        {item.label}
                      </Box>
                    </Button>
                  </Tooltip>
                ))}
              </Stack>
            </Stack>
          </Box>
        </Box>
      ) : null}
      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          right: 'var(--morius-header-side-offset)',
          zIndex: 45,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {!hideRightToggle ? (
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
                  ...(neutralImageIconFilter !== 'none' ? { filter: neutralImageIconFilter } : {}),
                  transform: isRightPanelOpen ? 'none' : 'rotate(180deg)',
                  transition: 'transform 220ms ease',
                }}
              />
            </IconButton>
          ) : null}

          <Box
            sx={
              hideRightToggle
                ? {
                    '& .MuiButtonBase-root': {
                      border: 'none !important',
                      backgroundColor: 'transparent !important',
                      boxShadow: 'none !important',
                    },
                  }
                : {
                    ml: isRightPanelOpen ? 'var(--morius-icon-gap)' : 0,
                    maxWidth: isRightPanelOpen ? rightActionsWidth : 0,
                    opacity: isRightPanelOpen ? 1 : 0,
                    transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(14px)',
                    pointerEvents: isRightPanelOpen ? 'auto' : 'none',
                    overflow: 'hidden',
                    transition: 'max-width 260ms ease, margin-left 260ms ease, opacity 220ms ease, transform 220ms ease',
                  }
            }
          >
            {rightActions}
          </Box>
        </Box>
      </Box>

      <BaseDialog
        open={isThemeDialogOpen}
        onClose={handleCloseThemeDialog}
        maxWidth="md"
        header={<Typography sx={{ fontSize: '1.2rem', fontWeight: 800 }}>Настройки</Typography>}
        paperSx={{
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
        actions={
          <Button
            onClick={handleCloseThemeDialog}
            sx={{
              minHeight: 40,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Закрыть
          </Button>
        }
      >
        <Stack spacing={1.2}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
            Нажмите на тему, чтобы применить её сразу. Выбор сохраняется после перезапуска и повторного входа.
          </Typography>

          <Box
            sx={{
              borderRadius: '12px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              px: 1,
              py: 0.9,
            }}
          >
            <Stack spacing={0.72}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Stack spacing={0.2}>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 800 }}>
                    Голосовой ввод
                  </Typography>
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem', lineHeight: 1.35 }}>
                    Показывать микрофон в поле ввода и разрешать диктовку.
                  </Typography>
                </Stack>
                <Switch
                  checked={voiceInputEnabled}
                  onChange={(event) => setVoiceInputEnabled(event.target.checked)}
                  color="default"
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': {
                      color: 'var(--morius-accent)',
                    },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                      backgroundColor: 'var(--morius-accent)',
                      opacity: 0.85,
                    },
                  }}
                />
              </Stack>
              <Box
                sx={{
                  width: '100%',
                  borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 80%, transparent)',
                  my: 0.3,
                }}
              />
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 800 }}>
                Шрифт истории в игре
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.4 }}>
                Меняет только сообщения игрока и ответы ИИ в истории игры.
              </Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={storyHistoryFontFamily}
                  onChange={(event: SelectChangeEvent<string>) => {
                    setStoryHistoryFontFamily(event.target.value as typeof storyHistoryFontFamily)
                  }}
                  MenuProps={{
                    PaperProps: {
                      sx: {
                        mt: 0.45,
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-card-bg)',
                        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.42)',
                        '& .MuiMenuItem-root': {
                          color: 'var(--morius-text-primary)',
                          fontWeight: 600,
                          fontSize: '0.92rem',
                          minHeight: 38,
                        },
                        '& .MuiMenuItem-root:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                        },
                        '& .MuiMenuItem-root.Mui-selected': {
                          backgroundColor: 'var(--morius-button-active)',
                          color: 'var(--morius-title-text)',
                        },
                        '& .MuiMenuItem-root.Mui-selected:hover': {
                          backgroundColor: 'var(--morius-button-active)',
                        },
                      },
                    },
                  }}
                  sx={{
                    color: 'var(--morius-title-text)',
                    fontWeight: 700,
                    borderRadius: '11px',
                    backgroundColor: 'var(--morius-card-bg)',
                    '& .MuiSelect-select': {
                      py: 0.8,
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--morius-accent)',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--morius-accent)',
                    },
                    '& .MuiSelect-icon': {
                      color: 'var(--morius-text-secondary)',
                    },
                  }}
                >
                  {storyHistoryFontFamilyOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <Select
                  value={storyHistoryFontWeight}
                  onChange={(event: SelectChangeEvent<string>) => {
                    setStoryHistoryFontWeight(event.target.value as typeof storyHistoryFontWeight)
                  }}
                  MenuProps={{
                    PaperProps: {
                      sx: {
                        mt: 0.45,
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-card-bg)',
                        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.42)',
                        '& .MuiMenuItem-root': {
                          color: 'var(--morius-text-primary)',
                          fontWeight: 600,
                          fontSize: '0.92rem',
                          minHeight: 38,
                        },
                        '& .MuiMenuItem-root:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                        },
                        '& .MuiMenuItem-root.Mui-selected': {
                          backgroundColor: 'var(--morius-button-active)',
                          color: 'var(--morius-title-text)',
                        },
                        '& .MuiMenuItem-root.Mui-selected:hover': {
                          backgroundColor: 'var(--morius-button-active)',
                        },
                      },
                    },
                  }}
                  sx={{
                    color: 'var(--morius-title-text)',
                    fontWeight: 700,
                    borderRadius: '11px',
                    backgroundColor: 'var(--morius-card-bg)',
                    '& .MuiSelect-select': {
                      py: 0.8,
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--morius-accent)',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--morius-accent)',
                    },
                    '& .MuiSelect-icon': {
                      color: 'var(--morius-text-secondary)',
                    },
                  }}
                >
                  {storyHistoryFontWeightOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            {themes.map((themeOption) => {
              const isActiveTheme = themeId === themeOption.id
              const previewColors = [
                themeOption.colors.appSurface,
                themeOption.colors.appElevated,
                themeOption.colors.buttonHover,
                themeOption.colors.accent,
                themeOption.colors.textPrimary,
              ]

              return (
                <Button
                  key={themeOption.id}
                  onClick={() => setTheme(themeOption.id)}
                  sx={{
                    width: '100%',
                    minHeight: 178,
                    p: 1.1,
                    borderRadius: '12px',
                    border: `var(--morius-border-width) solid ${isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                    background: isActiveTheme ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                    color: 'var(--morius-title-text)',
                    textTransform: 'none',
                    alignItems: 'stretch',
                    justifyContent: 'flex-start',
                    '&:hover': {
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  <Stack spacing={0.8} sx={{ width: '100%' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', textAlign: 'left' }}>{themeOption.name}</Typography>
                      <Box
                        sx={{
                          borderRadius: '999px',
                          px: 0.6,
                          py: 0.1,
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                          border: `var(--morius-border-width) solid ${isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                          display: isActiveTheme ? 'block' : 'none',
                          lineHeight: 1.3,
                        }}
                      >
                        {isActiveTheme ? 'Выбрана' : null}
                      </Box>
                    </Stack>

                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', textAlign: 'left', lineHeight: 1.4 }}>
                      {themeOption.description}
                    </Typography>

                    <Stack direction="row" spacing={0.45} sx={{ pt: 0.4 }}>
                      {previewColors.map((colorChip, index) => (
                        <Box
                          key={`${themeOption.id}-chip-${index}`}
                          sx={{
                            width: 18,
                            height: 18,
                            borderRadius: '6px',
                            border: 'var(--morius-border-width) solid rgba(0, 0, 0, 0.22)',
                            backgroundColor: colorChip,
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Button>
              )
            })}
          </Box>

          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', pt: 0.25 }}>Будущие темы:</Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 0.8,
            }}
          >
            {placeholders.map((placeholderTheme) => (
              <Box
                key={placeholderTheme.id}
                sx={{
                  borderRadius: '10px',
                  border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, transparent)',
                  minHeight: 70,
                  px: 0.85,
                  py: 0.7,
                  display: 'grid',
                  alignContent: 'center',
                  rowGap: 0.2,
                }}
              >
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 700 }}>
                  {placeholderTheme.name}
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                  {placeholderTheme.description}
                </Typography>
              </Box>
            ))}
          </Box>
        </Stack>
      </BaseDialog>

      <BaseDialog
        open={isSupportDialogOpen}
        onClose={handleCloseSupportDialog}
        maxWidth="sm"
        header={<Typography sx={{ fontSize: '1.2rem', fontWeight: 800 }}>Нашли баг? Сообщите нам.</Typography>}
        paperSx={{
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
        actions={
          <Button
            onClick={handleCloseSupportDialog}
            sx={{
              minHeight: 40,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Закрыть
          </Button>
        }
      >
        <Stack spacing={1.25}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
            Выберите удобный канал и перейдите в сообщество в один клик.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            <Button
              component="a"
              href="https://t.me/+t2ueY4x_KvE4ZWEy"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                justifyContent: 'flex-start',
                px: 1.2,
                '&:hover': {
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.1}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2 }}>Телеграм</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                  https://t.me/+t2ueY4x_KvE4ZWEy
                </Typography>
              </Stack>
            </Button>
            <Button
              component="a"
              href="https://vk.com/moriusai"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                justifyContent: 'flex-start',
                px: 1.2,
                '&:hover': {
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.1}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2 }}>ВКонтакте</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>https://vk.com/moriusai</Typography>
              </Stack>
            </Button>
          </Box>
          <Box
            sx={{
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              px: 1.1,
              py: 0.95,
            }}
          >
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--morius-title-text)' }}>Связь со мной:</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>Тг: @JustRius</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>Вк: @optrovert</Typography>
          </Box>
        </Stack>
      </BaseDialog>
    </>
  )
}

export default AppHeader
