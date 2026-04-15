import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Fade,
  FormControl,
  Grow,
  IconButton,
  MenuItem,
  Select,
  Slide,
  Stack,
  Switch,
  SvgIcon,
  Tooltip,
  Typography,
  useMediaQuery,
  type SelectChangeEvent,
  type SxProps,
  type Theme,
} from '@mui/material'
import { brandLogo, icons } from '../assets'
import homeIconMarkup from '../assets/icons/home.svg?raw'
import menuIconMarkup from '../assets/icons/menu.svg?raw'
import mobileCloseIconMarkup from '../assets/icons/mobile-close.svg?raw'
import mobilePlayIconMarkup from '../assets/icons/mobile-play.svg?raw'
import sidebarBookIconMarkup from '../assets/icons/custom/book.svg?raw'
import sidebarCommunityIconMarkup from '../assets/icons/custom/community.svg?raw'
import sidebarHelpIconMarkup from '../assets/icons/custom/help.svg?raw'
import sidebarPlusIconMarkup from '../assets/icons/custom/plus.svg?raw'
import sidebarPublicIconMarkup from '../assets/icons/custom/public.svg?raw'
import sidebarSettingsIconMarkup from '../assets/icons/custom/settings.svg?raw'
import sidebarShopIconMarkup from '../assets/icons/custom/shop.svg?raw'
import BaseDialog from './dialogs/BaseDialog'
import useMobileDialogSheet from './dialogs/useMobileDialogSheet'
import ThemedSvgIcon from './icons/ThemedSvgIcon'
import { moriusThemeTokens, useMoriusThemeController } from '../theme'

export type AppHeaderMenuItem = {
  key: string
  label: string
  onClick: () => void
  isActive?: boolean
}

export type AppHeaderMobileActionItem = {
  key: string
  title: string
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  description?: string
  headline?: string
  iconMarkup?: string
  imageSrc?: string
  imageMode?: 'contain' | 'cover'
  imagePosition?: string
}

type ToggleLabels = {
  expanded: string
  collapsed: string
}

type AppHeaderProps = {
  isPageMenuOpen: boolean
  onTogglePageMenu: () => void
  onClosePageMenu?: () => void
  menuItems: AppHeaderMenuItem[]
  mobileActionItems?: AppHeaderMobileActionItem[]
  pageMenuLabels: ToggleLabels
  isRightPanelOpen: boolean
  onToggleRightPanel: () => void
  rightToggleLabels: ToggleLabels
  rightActions: ReactNode
  rightActionsWidth?: number
  hideRightToggle?: boolean
  onOpenTopUpDialog?: () => void
  onOpenBugReportDialog?: () => void
  onOpenSettingsDialog?: () => void
  mobileVariant?: 'bottom-nav' | 'story'
  centerSlot?: ReactNode
}

type SidebarIconComponent = typeof SidebarHomeIcon

const HEADER_BUTTON_SIZE = moriusThemeTokens.layout.headerButtonSize
const MENU_COLLAPSED_WIDTH = 64
const MENU_EXPANDED_WIDTH = 244
const MENU_PANEL_TOP_OFFSET = HEADER_BUTTON_SIZE + 12
const LOGO_WIDTH = 86
const LOGO_LEFT_OFFSET = HEADER_BUTTON_SIZE + 10
const SIDEBAR_ICON_SIZE = 22
const COMPACT_SIDEBAR_MEDIA_QUERY = '(max-width:1535.95px)'
const PHONE_MEDIA_QUERY = '(max-width:899.95px)'
const HIDE_LOGO_MEDIA_QUERY = '(max-width:499.95px)'
const MOBILE_BOTTOM_NAV_HEIGHT = 'calc(78px + env(safe-area-inset-bottom))'
const MOBILE_SHEET_TOP_OFFSET = 'calc(var(--morius-header-menu-top) + 8px)'
const MOBILE_ACTION_CARD_HEIGHT = 118

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
  const resolvedTextColor = preserveLabelColor ? baseTextColor : (isActive ? 'var(--morius-accent)' : baseTextColor)

  return {
    width: isExpanded ? '100%' : HEADER_BUTTON_SIZE,
    minWidth: isExpanded ? '100%' : HEADER_BUTTON_SIZE,
    minHeight: 52,
    px: 0,
    py: 0.3,
    justifyContent: 'flex-start',
    borderRadius: isExpanded ? '16px' : '14px',
    border: 'none',
    backgroundColor: 'transparent',
    color: resolvedTextColor,
    textTransform: 'none',
    fontWeight: isActive ? 800 : 700,
    fontSize: '0.94rem',
    letterSpacing: '0.01em',
    transition: 'color 180ms ease, min-width 220ms ease, padding 220ms ease',
    '&:hover': {
      backgroundColor: 'transparent',
      boxShadow: 'none !important',
      color: preserveLabelColor ? baseTextColor : (isActive ? 'var(--morius-accent)' : 'var(--morius-title-text)'),
    },
    '&:active': {
      backgroundColor: 'transparent',
      boxShadow: 'none !important',
    },
    '&.Mui-focusVisible': {
      backgroundColor: 'transparent',
      boxShadow: 'none !important',
    },
  }
}

const sidebarIconWrapSx = (isActive: boolean) => ({
  width: HEADER_BUTTON_SIZE,
  minWidth: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  color: isActive ? 'var(--morius-accent)' : 'currentColor',
  backgroundColor: 'transparent',
  transition: 'color 180ms ease, opacity 180ms ease',
  opacity: isActive ? 1 : 0.96,
})

const sidebarLabelSx = (isExpanded: boolean) => ({
  ml: isExpanded ? 0.55 : 0,
  maxWidth: isExpanded ? 160 : 0,
  opacity: isExpanded ? 1 : 0,
  color: 'inherit',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  transition: 'max-width 220ms ease, opacity 180ms ease, margin-left 220ms ease',
})

function SidebarGlyphIcon({ markup, size = SIDEBAR_ICON_SIZE }: { markup: string; size?: number }) {
  return <ThemedSvgIcon markup={markup} size={size} />
}

function SidebarHomeIcon() {
  return <SidebarGlyphIcon markup={homeIconMarkup} />
}

function SidebarCommunityIcon() {
  return <SidebarGlyphIcon markup={sidebarCommunityIconMarkup} />
}

function SidebarLibraryIcon() {
  return <SidebarGlyphIcon markup={sidebarBookIconMarkup} />
}

function SidebarPublicationsIcon() {
  return <SidebarGlyphIcon markup={sidebarPublicIconMarkup} />
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

function SidebarGuideIcon() {
  return <SidebarGlyphIcon markup={sidebarHelpIconMarkup} />
}

function AppHeader({
  isPageMenuOpen,
  onTogglePageMenu,
  onClosePageMenu,
  menuItems,
  mobileActionItems = [],
  pageMenuLabels,
  isRightPanelOpen,
  onToggleRightPanel,
  rightToggleLabels,
  rightActions,
  rightActionsWidth = 240,
  hideRightToggle = false,
  onOpenTopUpDialog,
  onOpenBugReportDialog,
  onOpenSettingsDialog,
  mobileVariant = 'bottom-nav',
  centerSlot,
}: AppHeaderProps) {
  const [isThemeDialogOpen, setIsThemeDialogOpen] = useState(false)
  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState(false)
  const [isMobileActionSheetOpen, setIsMobileActionSheetOpen] = useState(false)
  const [isMobileMoreSheetOpen, setIsMobileMoreSheetOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLDivElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const mobileActionSheet = useMobileDialogSheet({
    onClose: () => setIsMobileActionSheetOpen(false),
    mediaQuery: PHONE_MEDIA_QUERY,
    showHandleIndicator: false,
  })
  const mobileMoreSheet = useMobileDialogSheet({
    onClose: () => setIsMobileMoreSheetOpen(false),
    mediaQuery: PHONE_MEDIA_QUERY,
    showHandleIndicator: false,
  })
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
  const neutralImageIconFilter = isGrayTheme ? 'grayscale(1) brightness(0.82)' : 'none'
  const isCompactSidebar = useMediaQuery(COMPACT_SIDEBAR_MEDIA_QUERY)
  const isPhoneLayout = useMediaQuery(PHONE_MEDIA_QUERY)
  const shouldHideBrandLogo = useMediaQuery(HIDE_LOGO_MEDIA_QUERY)
  const isMobileBottomNav = mobileVariant === 'bottom-nav' && isPhoneLayout
  const isMobileStory = mobileVariant === 'story' && isPhoneLayout
  const shouldHideRightToggle = hideRightToggle || isMobileBottomNav

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

  const primaryMenuIcons = [SidebarHomeIcon, SidebarCommunityIcon, SidebarLibraryIcon, SidebarPublicationsIcon]
  const primaryMenuIconByKey: Record<string, SidebarIconComponent> = {
    dashboard: SidebarHomeIcon,
    'games-my': SidebarLibraryIcon,
    'games-publications': SidebarPublicationsIcon,
    'games-all': SidebarCommunityIcon,
    'community-worlds': SidebarCommunityIcon,
    guide: SidebarGuideIcon,
    'world-create': SidebarLibraryIcon,
  }
  const resolvedMenuItems = [...menuItems]
    .map((item) => {
      if (item.key === 'games-my') {
        return { ...item, label: 'Библиотека' }
      }
      if (item.key === 'games-all' || item.key === 'community-worlds') {
        return { ...item, label: 'Сообщество' }
      }
      return item
    })
    .sort((left, right) => {
      const orderByKey: Record<string, number> = {
        dashboard: 0,
        'games-all': 1,
        'community-worlds': 1,
        'games-my': 2,
        'games-publications': 3,
      }
      return (orderByKey[left.key] ?? 10) - (orderByKey[right.key] ?? 10)
    })
  const getSidebarItemLabel = (item: AppHeaderMenuItem) => {
    if (item.key === 'games-my') {
      return 'Библиотека'
    }
    if (item.key === 'games-publications') {
      return 'Публикации'
    }
    if (item.key === 'games-all' || item.key === 'community-worlds') {
      return 'Сообщество'
    }
    return item.label
  }
  const getDisplayedSidebarLabel = (item: AppHeaderMenuItem) => {
    if (item.key === 'games-my') {
      return 'Библиотека'
    }
    if (item.key === 'games-publications') {
      return 'Публикации'
    }
    if (item.key === 'games-all' || item.key === 'community-worlds') {
      return 'Сообщество'
    }
    return item.label
  }
  const getUtilityItemLabel = (itemKey: string, fallbackLabel: string) => {
    if (itemKey === 'theme-settings') {
      return 'Настройки'
    }
    if (itemKey === 'support') {
      return 'Поддержка'
    }
    if (itemKey === 'top-up') {
      return 'Магазин'
    }
    if (itemKey === 'bug-report') {
      return 'Баг репорт'
    }
    return fallbackLabel
  }
  const getSafeSidebarLabel = (item: AppHeaderMenuItem) => {
    if (item.key === 'games-my') {
      return '\u0411\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0430'
    }
    if (item.key === 'games-publications') {
      return '\u041f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0438'
    }
    if (item.key === 'games-all' || item.key === 'community-worlds') {
      return '\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e'
    }
    return item.label
  }
  const getSafeUtilityItemLabel = (itemKey: string, fallbackLabel: string) => {
    if (itemKey === 'theme-settings') {
      return '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'
    }
    if (itemKey === 'support') {
      return '\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430'
    }
    if (itemKey === 'top-up') {
      return '\u041c\u0430\u0433\u0430\u0437\u0438\u043d'
    }
    if (itemKey === 'bug-report') {
      return '\u0411\u0430\u0433 \u0440\u0435\u043f\u043e\u0440\u0442'
    }
    return fallbackLabel
  }
  void getSidebarItemLabel
  void getDisplayedSidebarLabel
  void getUtilityItemLabel
  const showLogo = !shouldHideBrandLogo && (isPageMenuOpen || !isCompactSidebar)
  const showPrimaryItems = isPageMenuOpen || !isCompactSidebar
  const showUtilityItems = isPageMenuOpen
  const shouldRenderSidebarPanel = !isCompactSidebar || isPageMenuOpen
  const sidebarWidth = isCompactSidebar
    ? (isPageMenuOpen ? MENU_EXPANDED_WIDTH : HEADER_BUTTON_SIZE)
    : (isPageMenuOpen ? MENU_EXPANDED_WIDTH : MENU_COLLAPSED_WIDTH)
  const utilityMenuItems = [
    {
      key: 'theme-settings',
      label: 'Настройки',
      onClick: onOpenSettingsDialog ?? handleOpenThemeDialog,
      icon: <SidebarGlyphIcon markup={sidebarSettingsIconMarkup} />,
    },
    {
      key: 'support',
      label: 'Поддержка',
      onClick: handleOpenSupportDialog,
      icon: <SidebarGlyphIcon markup={sidebarHelpIconMarkup} />,
    },
    ...(onOpenTopUpDialog
      ? [
          {
            key: 'top-up',
            label: 'Магазин',
            onClick: handleOpenTopUpDialog,
            icon: <SidebarGlyphIcon markup={sidebarShopIconMarkup} />,
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

  const closeMobileSheets = () => {
    setIsMobileActionSheetOpen(false)
    setIsMobileMoreSheetOpen(false)
  }

  const closePageMenu = useCallback(() => {
    if (onClosePageMenu) {
      onClosePageMenu()
      return
    }
    if (isPageMenuOpen) {
      onTogglePageMenu()
    }
  }, [isPageMenuOpen, onClosePageMenu, onTogglePageMenu])

  const mobilePrimaryKeys = new Set(['dashboard', 'games-my', 'games-all', 'community-worlds'])
  const mobileHomeItem = resolvedMenuItems.find((item) => item.key === 'dashboard') ?? null
  const mobileLibraryItem = resolvedMenuItems.find((item) => item.key === 'games-my') ?? null
  const mobileCommunityItem =
    resolvedMenuItems.find((item) => item.key === 'games-all' || item.key === 'community-worlds') ?? null
  const mobileMoreMenuItems = resolvedMenuItems.filter((item) => !mobilePrimaryKeys.has(item.key))
  const fallbackMobileActionItems: AppHeaderMobileActionItem[] = [
    ...(resolvedMenuItems.find((item) => item.key === 'world-create')
      ? [
          {
            key: 'world-create',
            title: '\u041d\u043e\u0432\u044b\u0439 \u043c\u0438\u0440',
            description: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0438\u043b\u0438 \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440 \u043c\u0438\u0440\u0430.',
            iconMarkup: sidebarPlusIconMarkup,
            onClick: resolvedMenuItems.find((item) => item.key === 'world-create')!.onClick,
          },
        ]
      : []),
    ...(onOpenTopUpDialog
      ? [
          {
            key: 'top-up',
            title: '\u041c\u0430\u0433\u0430\u0437\u0438\u043d',
            description: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u043a\u0435\u0442\u044b \u0441\u043e\u043b\u043e\u0432 \u0438 \u043f\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435.',
            iconMarkup: sidebarShopIconMarkup,
            onClick: handleOpenTopUpDialog,
          },
        ]
      : []),
    {
      key: 'theme-settings',
      title: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438',
      description: '\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0442\u0435\u043c\u0443, \u0448\u0440\u0438\u0444\u0442 \u0438 \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u043e\u043f\u0446\u0438\u0438.',
      iconMarkup: sidebarSettingsIconMarkup,
      onClick: onOpenSettingsDialog ?? handleOpenThemeDialog,
    },
  ]
  const resolvedMobileActionItems = mobileActionItems.length > 0 ? mobileActionItems : fallbackMobileActionItems
  const isMoreButtonActive =
    isMobileMoreSheetOpen || mobileMoreMenuItems.some((item) => item.isActive) || (!mobileHomeItem && !mobileLibraryItem && !mobileCommunityItem)
  const shouldShowCompactSidebarOverlay = isCompactSidebar && isPageMenuOpen && !isMobileBottomNav && !isMobileStory

  useEffect(() => {
    if (!isPageMenuOpen || isMobileBottomNav || !isCompactSidebar) {
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

      closePageMenu()
    }

    window.addEventListener('pointerdown', handleOutsideMenuClick)
    return () => {
      window.removeEventListener('pointerdown', handleOutsideMenuClick)
    }
  }, [closePageMenu, isCompactSidebar, isMobileBottomNav, isPageMenuOpen])

  useEffect(() => {
    if (isPhoneLayout) {
      return
    }
    setIsMobileActionSheetOpen(false)
    setIsMobileMoreSheetOpen(false)
  }, [isPhoneLayout])

  return (
    <>
      {isMobileBottomNav ? (
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
            sx={{
              position: 'fixed',
              top: 'var(--morius-header-top-offset)',
              left: 'var(--morius-header-side-offset)',
              zIndex: 37,
              display: shouldHideBrandLogo ? 'none' : 'block',
              pointerEvents: 'none',
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

          <Box
            sx={{
              position: 'fixed',
              top: 'var(--morius-header-top-offset)',
              right: 'var(--morius-header-side-offset)',
              zIndex: 45,
            }}
          >
            <Box
              sx={{
                '& .MuiButtonBase-root': {
                  border: 'none !important',
                  backgroundColor: 'transparent !important',
                  boxShadow: 'none !important',
                },
              }}
            >
              {rightActions}
            </Box>
          </Box>

          <Fade in={Boolean(isMobileActionSheetOpen || isMobileMoreSheetOpen)} mountOnEnter unmountOnExit timeout={{ enter: 180, exit: 140 }}>
            <Box
              onClick={closeMobileSheets}
              sx={{
                position: 'fixed',
                inset: 0,
                zIndex: 39,
                backgroundColor: 'rgba(1, 4, 8, 0.82)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            />
          </Fade>

          <Slide in={isMobileActionSheetOpen} direction="up" mountOnEnter unmountOnExit timeout={{ enter: 240, exit: 180 }}>
            <Box
              {...mobileActionSheet.paperTouchHandlers}
              sx={
                [
                  mobileActionSheet.paperSx,
                  {
                    position: 'fixed',
                    top: MOBILE_SHEET_TOP_OFFSET,
                    left: 0,
                    right: 0,
                    bottom: MOBILE_BOTTOM_NAV_HEIGHT,
                    zIndex: 40,
                    borderTopLeftRadius: '24px',
                    borderTopRightRadius: '24px',
                    background: 'color-mix(in srgb, var(--morius-card-bg) 90%, transparent)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    boxShadow: '0 -24px 48px rgba(0, 0, 0, 0.36)',
                    overflow: 'hidden',
                  },
                ] as SxProps<Theme>
              }
            >
              <Stack spacing={1.15} sx={{ height: '100%', px: 2, pt: 1.1, pb: 1.1 }}>
                <Box
                  sx={{
                    width: 42,
                    height: 5,
                    borderRadius: '999px',
                    backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                    alignSelf: 'center',
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, flexShrink: 0 }}>
                  {'\u0411\u044b\u0441\u0442\u0440\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f'}
                </Typography>
                <Stack spacing={1} sx={{ minHeight: 0, overflowY: 'auto', pb: 0.4 }} className="morius-scrollbar">
                  {resolvedMobileActionItems.map((item) => (
                    (() => {
                      const hasCoverImage = item.imageMode === 'cover' && Boolean(item.imageSrc)
                      const hasHeadline = Boolean(item.headline)

                      return (
                        <Button
                          key={item.key}
                          onClick={() => {
                            closeMobileSheets()
                            item.onClick()
                          }}
                          disabled={item.disabled}
                          sx={{
                            position: 'relative',
                            height: MOBILE_ACTION_CARD_HEIGHT,
                            minHeight: MOBILE_ACTION_CARD_HEIGHT,
                            maxHeight: MOBILE_ACTION_CARD_HEIGHT,
                            borderRadius: '20px',
                            border: 'none',
                            backgroundColor: hasCoverImage ? 'transparent' : 'var(--morius-elevated-bg)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            alignItems: 'stretch',
                            justifyContent: 'flex-start',
                            overflow: 'hidden',
                            px: 1.35,
                            py: 1.15,
                            flexShrink: 0,
                            '&:hover': {
                              backgroundColor: hasCoverImage ? 'transparent' : 'var(--morius-button-hover)',
                            },
                          }}
                        >
                          {hasCoverImage ? (
                            <>
                              <Box
                                component="img"
                                src={item.imageSrc}
                                alt=""
                                sx={{
                                  position: 'absolute',
                                  inset: 0,
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  objectPosition: item.imagePosition ?? 'center',
                                  opacity: 0.92,
                                }}
                              />
                              <Box
                                aria-hidden
                                sx={{
                                  position: 'absolute',
                                  inset: 0,
                                  background:
                                    'linear-gradient(180deg, rgba(7, 11, 16, 0.52) 0%, rgba(7, 11, 16, 0.74) 54%, rgba(7, 11, 16, 0.92) 100%)',
                                }}
                              />
                            </>
                          ) : null}

                          <Stack
                            direction="row"
                            spacing={1.15}
                            alignItems="center"
                            sx={{ position: 'relative', zIndex: 1, width: '100%', minHeight: '100%' }}
                          >
                            <Stack spacing={0.45} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start', textAlign: 'left' }}>
                              <Stack spacing={hasHeadline ? 0.24 : 0.45} sx={{ minWidth: 0 }}>
                                <Stack direction="row" spacing={0.8} alignItems="center">
                                  {item.iconMarkup ? <ThemedSvgIcon markup={item.iconMarkup} size={20} /> : null}
                                  <Typography
                                    sx={{
                                      color: hasCoverImage ? 'rgba(236, 243, 250, 0.82)' : 'var(--morius-title-text)',
                                      fontSize: hasHeadline ? '0.82rem' : '1.02rem',
                                      fontWeight: 900,
                                      lineHeight: 1.08,
                                    }}
                                  >
                                    {item.title}
                                  </Typography>
                                </Stack>
                                {hasHeadline ? (
                                  <Typography
                                    sx={{
                                      color: hasCoverImage ? '#f4f8ff' : 'var(--morius-title-text)',
                                      fontSize: '1.08rem',
                                      fontWeight: 900,
                                      lineHeight: 1.08,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 1,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {item.headline}
                                  </Typography>
                                ) : null}
                              </Stack>
                              {item.description ? (
                                <Typography
                                  sx={{
                                    color: hasCoverImage ? 'rgba(232, 239, 248, 0.88)' : 'var(--morius-text-secondary)',
                                    fontSize: '0.82rem',
                                    lineHeight: 1.35,
                                    display: '-webkit-box',
                                    WebkitLineClamp: hasHeadline ? 3 : 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {item.description}
                                </Typography>
                              ) : null}
                            </Stack>
                            {item.imageSrc && !hasCoverImage ? (
                              <Box
                                component="img"
                                src={item.imageSrc}
                                alt=""
                                sx={{
                                  width: 80,
                                  height: 80,
                                  objectFit: 'contain',
                                  flexShrink: 0,
                                  alignSelf: 'flex-end',
                                }}
                              />
                            ) : null}
                          </Stack>
                        </Button>
                      )
                    })()
                  ))}
                </Stack>
              </Stack>
            </Box>
          </Slide>

          <Slide in={isMobileMoreSheetOpen} direction="up" mountOnEnter unmountOnExit timeout={{ enter: 240, exit: 180 }}>
            <Box
              {...mobileMoreSheet.paperTouchHandlers}
              sx={
                [
                  mobileMoreSheet.paperSx,
                  {
                    position: 'fixed',
                    top: MOBILE_SHEET_TOP_OFFSET,
                    left: 0,
                    right: 0,
                    bottom: MOBILE_BOTTOM_NAV_HEIGHT,
                    zIndex: 40,
                    borderTopLeftRadius: '24px',
                    borderTopRightRadius: '24px',
                    background: 'color-mix(in srgb, var(--morius-card-bg) 90%, transparent)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    boxShadow: '0 -24px 48px rgba(0, 0, 0, 0.36)',
                    overflow: 'hidden',
                  },
                ] as SxProps<Theme>
              }
            >
              <Stack spacing={1.05} sx={{ height: '100%', px: 2, pt: 1.1, pb: 1.1 }}>
                <Box
                  sx={{
                    width: 42,
                    height: 5,
                    borderRadius: '999px',
                    backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                    alignSelf: 'center',
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, flexShrink: 0 }}>
                  {'\u041c\u0435\u043d\u044e'}
                </Typography>
                <Stack spacing={0.45} sx={{ minHeight: 0, overflowY: 'auto', pb: 0.4 }} className="morius-scrollbar">
                  {mobileMoreMenuItems.map((item, index) => {
                    const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                    return (
                      <Button
                        key={item.key}
                        onClick={() => {
                          closeMobileSheets()
                          item.onClick()
                        }}
                        sx={{
                          minHeight: 58,
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          borderRadius: '16px',
                          color: item.isActive ? 'var(--morius-accent)' : 'var(--morius-text-primary)',
                          backgroundColor: item.isActive
                            ? 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-card-bg))'
                            : 'transparent',
                          flexShrink: 0,
                          '&:hover': {
                            backgroundColor: 'var(--morius-button-hover)',
                          },
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box sx={sidebarIconWrapSx(Boolean(item.isActive))}>
                            <MenuIcon />
                          </Box>
                          <Typography sx={{ fontSize: '0.96rem', fontWeight: 800 }}>{getSafeSidebarLabel(item)}</Typography>
                        </Stack>
                      </Button>
                    )
                  })}

                  {utilityMenuItems.length > 0 ? (
                    <Box
                      sx={{
                        mt: 0.35,
                        pt: 0.55,
                        borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
                        flexShrink: 0,
                      }}
                    >
                      <Stack spacing={0.45}>
                        {utilityMenuItems.map((item) => (
                          <Button
                            key={item.key}
                            onClick={() => {
                              closeMobileSheets()
                              item.onClick()
                            }}
                            sx={{
                              minHeight: 58,
                              justifyContent: 'flex-start',
                              textTransform: 'none',
                              borderRadius: '16px',
                              color: 'var(--morius-text-primary)',
                              backgroundColor: 'transparent',
                              flexShrink: 0,
                              '&:hover': {
                                backgroundColor: 'var(--morius-button-hover)',
                              },
                            }}
                          >
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Box sx={sidebarIconWrapSx(false)}>{item.icon}</Box>
                              <Typography sx={{ fontSize: '0.96rem', fontWeight: 800 }}>
                                {getSafeUtilityItemLabel(item.key, item.label)}
                              </Typography>
                            </Stack>
                          </Button>
                        ))}
                      </Stack>
                    </Box>
                  ) : null}
                </Stack>
              </Stack>
            </Box>
          </Slide>

          <Box
            sx={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 41,
              pb: 'env(safe-area-inset-bottom)',
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                pointerEvents: 'auto',
                minHeight: MOBILE_BOTTOM_NAV_HEIGHT,
                borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                boxShadow: '0 -18px 34px rgba(0, 0, 0, 0.24)',
                px: 0.6,
                pt: 0.4,
                pb: 0.45,
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.2}>
                <IconButton
                  aria-label={'\u0413\u043b\u0430\u0432\u043d\u0430\u044f'}
                  onClick={() => {
                    closeMobileSheets()
                    mobileHomeItem?.onClick()
                  }}
                  sx={sidebarButtonSx(Boolean(mobileHomeItem?.isActive), false, false, false)}
                >
                  <Box sx={sidebarIconWrapSx(Boolean(mobileHomeItem?.isActive))}>
                    <SidebarHomeIcon />
                  </Box>
                </IconButton>
                <IconButton
                  aria-label={'\u0411\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0430'}
                  onClick={() => {
                    closeMobileSheets()
                    mobileLibraryItem?.onClick()
                  }}
                  sx={sidebarButtonSx(Boolean(mobileLibraryItem?.isActive), false, false, false)}
                >
                  <Box sx={sidebarIconWrapSx(Boolean(mobileLibraryItem?.isActive))}>
                    <SidebarLibraryIcon />
                  </Box>
                </IconButton>
                <IconButton
                  aria-label={isMobileActionSheetOpen ? '\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0431\u044b\u0441\u0442\u0440\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f' : '\u0411\u044b\u0441\u0442\u0440\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f'}
                  onClick={() => {
                    setIsMobileMoreSheetOpen(false)
                    setIsMobileActionSheetOpen((previous) => !previous)
                  }}
                  sx={{
                    ...sidebarButtonSx(isMobileActionSheetOpen, false, false, false),
                    width: 72,
                    minWidth: 72,
                    height: 54,
                    justifyContent: 'center',
                    borderRadius: '18px',
                    backgroundColor: 'transparent',
                    color: isMobileActionSheetOpen ? 'var(--morius-title-text)' : 'var(--morius-accent)',
                    '&:hover': {
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  <ThemedSvgIcon markup={isMobileActionSheetOpen ? mobileCloseIconMarkup : mobilePlayIconMarkup} size={20} />
                </IconButton>
                <IconButton
                  aria-label={'\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e'}
                  onClick={() => {
                    closeMobileSheets()
                    mobileCommunityItem?.onClick()
                  }}
                  sx={sidebarButtonSx(Boolean(mobileCommunityItem?.isActive), false, false, false)}
                >
                  <Box sx={sidebarIconWrapSx(Boolean(mobileCommunityItem?.isActive))}>
                    <SidebarCommunityIcon />
                  </Box>
                </IconButton>
                <IconButton
                  aria-label={'\u041c\u0435\u043d\u044e'}
                  onClick={() => {
                    setIsMobileActionSheetOpen(false)
                    setIsMobileMoreSheetOpen((previous) => !previous)
                  }}
                  sx={sidebarButtonSx(isMoreButtonActive, false, true, false)}
                >
                  <Box sx={sidebarIconWrapSx(isMoreButtonActive)}>
                    <ThemedSvgIcon markup={menuIconMarkup} size={20} />
                  </Box>
                </IconButton>
              </Stack>
            </Box>
          </Box>
        </>
      ) : isMobileStory ? (
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

          <Fade in={isPageMenuOpen} mountOnEnter unmountOnExit timeout={{ enter: 180, exit: 140 }}>
            <Box
              onClick={closePageMenu}
              sx={{
                position: 'fixed',
                inset: 0,
                zIndex: 35,
                backgroundColor: 'rgba(1, 4, 8, 0.82)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            />
          </Fade>

          <Box
            ref={menuTriggerRef}
            sx={{
              position: 'fixed',
              top: 'var(--morius-header-top-offset)',
              left: 'var(--morius-header-side-offset)',
              zIndex: 37,
              width: MENU_EXPANDED_WIDTH,
              height: HEADER_BUTTON_SIZE,
              pointerEvents: 'none',
            }}
          >
            <IconButton
              aria-label={isPageMenuOpen ? pageMenuLabels.expanded : pageMenuLabels.collapsed}
              onClick={onTogglePageMenu}
              sx={{
                ...shellButtonSx,
                position: 'absolute',
                left: 0,
                top: 0,
                pointerEvents: 'auto',
              }}
            >
              <Box
                component="img"
                src={icons.menu}
                alt=""
                sx={{
                  width: SIDEBAR_ICON_SIZE,
                  height: SIDEBAR_ICON_SIZE,
                  opacity: 0.9,
                  ...(neutralImageIconFilter !== 'none' ? { filter: neutralImageIconFilter } : {}),
                }}
              />
            </IconButton>
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: `${LOGO_LEFT_OFFSET}px`,
                transform: 'translateY(-50%)',
                width: LOGO_WIDTH,
                display: shouldHideBrandLogo ? 'none' : 'block',
                pointerEvents: 'none',
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

          <Grow in={isPageMenuOpen} mountOnEnter unmountOnExit timeout={{ enter: 220, exit: 160 }} style={{ transformOrigin: 'top left' }}>
            <Box
              ref={menuPanelRef}
              sx={{
                position: 'fixed',
                top: `calc(var(--morius-header-top-offset) + ${MENU_PANEL_TOP_OFFSET}px)`,
                left: 'var(--morius-header-side-offset)',
                bottom: 'var(--morius-interface-gap)',
                zIndex: 36,
                width: 'min(82vw, 320px)',
                borderRadius: '28px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background: 'color-mix(in srgb, var(--morius-card-bg) 90%, transparent)',
                backdropFilter: 'blur(22px)',
                WebkitBackdropFilter: 'blur(22px)',
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.34)',
                overflow: 'hidden',
              }}
            >
              <Stack spacing={0.8} sx={{ height: '100%', p: 1.35 }}>
                <Stack spacing={0.45} sx={{ overflowY: 'auto', pr: 0.2 }} className="morius-scrollbar">
                  {resolvedMenuItems.map((item, index) => {
                    const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                    const isActive = Boolean(item.isActive)
                    return (
                      <Button
                        key={item.key}
                        disableRipple
                        disableFocusRipple
                        onClick={() => {
                          closePageMenu()
                          item.onClick()
                        }}
                        sx={[sidebarButtonSx(isActive, true, false, false), { px: 0.35 }]}
                      >
                        <Box sx={sidebarIconWrapSx(isActive)}>
                          <MenuIcon />
                        </Box>
                        <Box component="span" sx={sidebarLabelSx(true)}>
                          {getSafeSidebarLabel(item)}
                        </Box>
                      </Button>
                    )
                  })}
                </Stack>

                {utilityMenuItems.length > 0 ? (
                  <Box
                    sx={{
                      borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
                      pt: 0.6,
                    }}
                  >
                    <Stack spacing={0.45}>
                      {utilityMenuItems.map((item) => (
                        <Button
                          key={item.key}
                          disableRipple
                          disableFocusRipple
                          onClick={() => {
                            closePageMenu()
                            item.onClick()
                          }}
                          sx={[sidebarButtonSx(false, true, true), { px: 0.35 }]}
                        >
                          <Box sx={sidebarIconWrapSx(false)}>{item.icon}</Box>
                          <Box component="span" sx={sidebarLabelSx(true)}>
                            {getSafeUtilityItemLabel(item.key, item.label)}
                          </Box>
                        </Button>
                      ))}
                    </Stack>
                  </Box>
                ) : null}
              </Stack>
            </Box>
          </Grow>

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
                data-tour-id="header-right-panel-toggle"
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

              <Box
                sx={{
                  ml: isRightPanelOpen ? 'var(--morius-icon-gap)' : 0,
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
      ) : (
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
          width: MENU_EXPANDED_WIDTH,
          height: HEADER_BUTTON_SIZE,
          pointerEvents: 'none',
        }}
      >
        <IconButton
          aria-label={isPageMenuOpen ? pageMenuLabels.expanded : pageMenuLabels.collapsed}
          onClick={onTogglePageMenu}
          sx={{
            ...shellButtonSx,
            position: 'absolute',
            left: 0,
            top: 0,
            pointerEvents: 'auto',
          }}
        >
          <Box
            component="img"
            src={icons.menu}
            alt=""
            sx={{
              width: SIDEBAR_ICON_SIZE,
              height: SIDEBAR_ICON_SIZE,
              opacity: 0.9,
              ...(neutralImageIconFilter !== 'none' ? { filter: neutralImageIconFilter } : {}),
            }}
          />
        </IconButton>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: `${LOGO_LEFT_OFFSET}px`,
            transform: 'translateY(-50%)',
            flexShrink: 0,
            width: LOGO_WIDTH,
            opacity: showLogo ? 1 : 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            transition: 'opacity 180ms ease',
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

      {centerSlot ? (
        <Box
          sx={{
            position: 'fixed',
            top: 'var(--morius-header-top-offset)',
            left: `calc(var(--morius-header-side-offset) + ${MENU_EXPANDED_WIDTH + 12}px)`,
            right: `calc(var(--morius-header-side-offset) + 160px)`,
            height: HEADER_BUTTON_SIZE,
            zIndex: 37,
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
          }}
        >
          {centerSlot}
        </Box>
      ) : null}

      <Fade in={shouldShowCompactSidebarOverlay} mountOnEnter unmountOnExit timeout={{ enter: 180, exit: 140 }}>
        <Box
          onClick={closePageMenu}
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 35,
            backgroundColor: 'rgba(1, 4, 8, 0.74)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        />
      </Fade>

      {!isCompactSidebar && shouldRenderSidebarPanel ? (
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
              px: 0,
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
                  px: 0,
                  maxHeight: showPrimaryItems ? 320 : 0,
                  opacity: showPrimaryItems ? 1 : 0,
                  overflow: 'hidden',
                  pointerEvents: showPrimaryItems ? 'auto' : 'none',
                  transition: 'max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                }}
              >
                {resolvedMenuItems.map((item, index) => {
                  const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                  const isActive = Boolean(item.isActive)
                  const resolvedLabel = getSafeSidebarLabel(item)

                  return (
                    <Tooltip key={item.key} title={isPageMenuOpen ? '' : resolvedLabel} placement="right" disableHoverListener={isPageMenuOpen}>
                      <Button
                        data-tour-id={`sidebar-item-${item.key}`}
                        disableRipple
                        disableFocusRipple
                        sx={sidebarButtonSx(isActive, isPageMenuOpen, false, false)}
                        onClick={item.onClick}
                      >
                        <Box sx={sidebarIconWrapSx(isActive)}>
                          <MenuIcon />
                        </Box>
                        <Box component="span" sx={sidebarLabelSx(isPageMenuOpen)}>
                          {resolvedLabel}
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
                  px: 0,
                  maxHeight: showUtilityItems ? 240 : 0,
                  opacity: showUtilityItems ? 1 : 0,
                  overflow: 'hidden',
                  pointerEvents: showUtilityItems ? 'auto' : 'none',
                  transition: 'max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                }}
              >
                {utilityMenuItems.map((item) => {
                  const resolvedLabel = getSafeUtilityItemLabel(item.key, item.label)

                  return (
                    <Tooltip key={item.key} title={isPageMenuOpen ? '' : resolvedLabel} placement="right" disableHoverListener={isPageMenuOpen}>
                      <Button
                        data-tour-id={`sidebar-utility-${item.key}`}
                        disableRipple
                        disableFocusRipple
                        sx={sidebarButtonSx(false, isPageMenuOpen, true)}
                        onClick={item.onClick}
                      >
                        <Box sx={sidebarIconWrapSx(false)}>{item.icon}</Box>
                        <Box component="span" sx={sidebarLabelSx(isPageMenuOpen)}>
                          {resolvedLabel}
                        </Box>
                      </Button>
                    </Tooltip>
                  )
                })}
              </Stack>
            </Stack>
          </Box>
        </Box>
      ) : null}

      {isCompactSidebar ? (
        <Grow in={isPageMenuOpen} mountOnEnter unmountOnExit timeout={{ enter: 220, exit: 160 }} style={{ transformOrigin: 'top left' }}>
          <Box
            ref={menuPanelRef}
            sx={{
              position: 'fixed',
              top: `calc(var(--morius-header-top-offset) + ${MENU_PANEL_TOP_OFFSET}px)`,
              left: 'var(--morius-header-side-offset)',
              zIndex: 36,
              width: MENU_EXPANDED_WIDTH,
              maxHeight: 'calc(100svh - var(--morius-header-menu-top) - 24px)',
              borderRadius: '28px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              background: 'color-mix(in srgb, var(--morius-card-bg) 90%, transparent)',
              backdropFilter: 'blur(22px)',
              WebkitBackdropFilter: 'blur(22px)',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.34)',
              overflow: 'hidden',
            }}
          >
            <Stack spacing={0.8} sx={{ maxHeight: '100%', p: 1.35 }}>
              <Stack spacing={0.45} sx={{ minHeight: 0, overflowY: 'auto', pr: 0.2 }} className="morius-scrollbar">
                {resolvedMenuItems.map((item, index) => {
                  const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                  const isActive = Boolean(item.isActive)
                  return (
                    <Button
                      key={item.key}
                      disableRipple
                      disableFocusRipple
                      onClick={() => {
                        closePageMenu()
                        item.onClick()
                      }}
                      sx={[sidebarButtonSx(isActive, true, false, false), { px: 0.35 }]}
                    >
                      <Box sx={sidebarIconWrapSx(isActive)}>
                        <MenuIcon />
                      </Box>
                      <Box component="span" sx={sidebarLabelSx(true)}>
                        {getSafeSidebarLabel(item)}
                      </Box>
                    </Button>
                  )
                })}
              </Stack>

              {utilityMenuItems.length > 0 ? (
                <Box
                  sx={{
                    borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
                    pt: 0.6,
                  }}
                >
                  <Stack spacing={0.45}>
                    {utilityMenuItems.map((item) => (
                      <Button
                        key={item.key}
                        disableRipple
                        disableFocusRipple
                        onClick={() => {
                          closePageMenu()
                          item.onClick()
                        }}
                        sx={[sidebarButtonSx(false, true, true), { px: 0.35 }]}
                      >
                        <Box sx={sidebarIconWrapSx(false)}>{item.icon}</Box>
                        <Box component="span" sx={sidebarLabelSx(true)}>
                          {getSafeUtilityItemLabel(item.key, item.label)}
                        </Box>
                      </Button>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          </Box>
        </Grow>
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
          {!shouldHideRightToggle ? (
            <IconButton
              data-tour-id="header-right-panel-toggle"
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
              shouldHideRightToggle
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
        </>
      )}

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
