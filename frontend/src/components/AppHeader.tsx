import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Fade,
  Grow,
  IconButton,
  Slide,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
  useMediaQuery,
  type SxProps,
  type Theme,
} from '@mui/material'
import { brandLogo, icons } from '../assets'
import aiIconMarkup from '../assets/icons/ai.svg?raw'
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
import AppBackdropGlow from './AppBackdropGlow'
import AppDownloadDialog from './AppDownloadDialog'
import { AI_ASSISTANT_OPEN_EVENT } from './ai/aiAssistantEvents'
import useMobileDialogSheet from './dialogs/useMobileDialogSheet'
import { AppHeaderSlotsContext, type AppHeaderSlots } from './header/appHeaderSlots'
import HeaderSearch from './header/HeaderSearch'
import { HEADER_CONTROL_SIZE, headerIconButtonSx } from './header/headerStyles'
import ThemedSvgIcon from './icons/ThemedSvgIcon'
import ProgressiveImage from './media/ProgressiveImage'
import { moriusThemeTokens } from '../theme'
import { navigateInApp } from '../utils/navigation'

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

/** A page that filters its own content hands its query here; the header search then drives it. */
export type AppHeaderSearchConfig = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  maxLength?: number
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
  hidePageMenu?: boolean
  hideRightToggle?: boolean
  onOpenTopUpDialog?: () => void
  onOpenBugReportDialog?: () => void
  onOpenSettingsDialog?: () => void
  showAiAssistantAction?: boolean
  onOpenAiAssistant?: () => void
  onGoHome?: () => void
  mobileVariant?: 'bottom-nav' | 'story'
  /** Page-scoped search. Without it the header search looks through the community instead. */
  search?: AppHeaderSearchConfig
  /** Kept for page-specific desktop controls while they migrate to the compact search slot. */
  centerSlot?: ReactNode
}

type SidebarIconComponent = typeof SidebarHomeIcon

const HEADER_BUTTON_SIZE = moriusThemeTokens.layout.headerButtonSize
const MENU_COLLAPSED_WIDTH = 64
const MENU_EXPANDED_WIDTH = 244
const MENU_PANEL_TOP_OFFSET = HEADER_BUTTON_SIZE + 12
const LOGO_WIDTH = 56
const DESKTOP_LOGO_WIDTH = 43
const LOGO_LEFT_OFFSET = HEADER_BUTTON_SIZE + 10
const SIDEBAR_ICON_SIZE = 22
const COMPACT_SIDEBAR_MEDIA_QUERY = '(max-width:1535.95px)'
const PHONE_MEDIA_QUERY = '(max-width:899.95px)'
const HIDE_LOGO_MEDIA_QUERY = '(max-width:499.95px)'
const MOBILE_BOTTOM_NAV_CONTENT_HEIGHT = 66
const MOBILE_BOTTOM_NAV_BOTTOM_GAP = 14
const MOBILE_BOTTOM_NAV_BACKGROUND = 'var(--morius-card-bg)'
const MOBILE_BOTTOM_NAV_HEIGHT = `calc(${MOBILE_BOTTOM_NAV_CONTENT_HEIGHT}px + ${MOBILE_BOTTOM_NAV_BOTTOM_GAP}px + env(safe-area-inset-bottom))`
const MOBILE_SHEET_TOP_OFFSET = 'calc(var(--morius-header-menu-top) + 8px)'
const MOBILE_ACTION_CARD_HEIGHT = 118
const HEADER_NAV_KEYS = new Set(['dashboard', 'games-all', 'community-worlds'])
const HEADER_CONTENT_MAX_WIDTH = 1400
const COMMUNITY_SEARCH_PLACEHOLDER = 'Игры, персонажи, правила'
const headerBackdropSx = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 'var(--morius-header-menu-top)',
  zIndex: 34,
  pointerEvents: 'none',
  background: 'var(--morius-glass-bg)',
  borderBottom: 'var(--morius-border-width) solid rgba(255,255,255,0.07)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
} as const

const headerNavButtonSx = (isActive: boolean) => ({
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  px: '14px',
  border: 'none',
  borderRadius: '11px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.875rem',
  fontWeight: isActive ? 600 : 500,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  // Flat accent with a dark label. Mixing the accent into navy produced a muddy gold that
  // matched nothing else on the page.
  color: isActive ? 'var(--morius-accent-contrast)' : 'var(--morius-text-secondary)',
  background: isActive ? 'var(--morius-accent)' : 'transparent',
  boxShadow: 'none',
  transition: 'background-color 160ms ease, color 160ms ease',
  '&:hover': {
    color: isActive ? 'var(--morius-accent-contrast)' : 'var(--morius-title-text)',
    backgroundColor: isActive ? undefined : 'rgba(255,255,255,0.06)',
  },
  '&:focus-visible': {
    outline: '2px solid color-mix(in oklab, var(--morius-accent) 70%, transparent)',
    outlineOffset: '2px',
  },
  '& .morius-header-nav-icon': {
    color: isActive ? 'var(--morius-accent-contrast)' : 'currentColor',
    opacity: isActive ? 1 : 0.9,
  },
})

const shellButtonSx = {
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  minWidth: HEADER_BUTTON_SIZE,
  minHeight: HEADER_BUTTON_SIZE,
  maxWidth: HEADER_BUTTON_SIZE,
  maxHeight: HEADER_BUTTON_SIZE,
  borderRadius: '12px !important',
  border: 'none !important',
  backgroundColor: 'rgba(255,255,255,0.07) !important',
  color: '#cfcdd4 !important',
  transition: 'background-color 160ms ease, color 160ms ease',
  '&:hover': {
    color: 'var(--morius-title-text) !important',
    backgroundColor: 'rgba(255,255,255,0.12) !important',
  },
  '&:active': {
    backgroundColor: 'rgba(255,255,255,0.08) !important',
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
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 74%, #000 26%)',
      boxShadow: 'none !important',
      color: preserveLabelColor ? baseTextColor : (isActive ? 'var(--morius-accent)' : 'var(--morius-title-text)'),
    },
    '&:active': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 62%, #000 38%)',
      boxShadow: 'none !important',
    },
    '&.Mui-focusVisible': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 74%, #000 26%)',
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

function SidebarShopIcon() {
  return <SidebarGlyphIcon markup={sidebarShopIconMarkup} />
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

function SidebarDownloadIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
      <path
        d="M12 3.25c.55 0 1 .45 1 1v8.02l2.18-2.18a1 1 0 1 1 1.41 1.41l-3.88 3.88a1 1 0 0 1-1.42 0L7.41 11.5a1 1 0 1 1 1.41-1.41L11 12.27V4.25c0-.55.45-1 1-1Zm-6.25 12.5c.55 0 1 .45 1 1v1.5h10.5v-1.5a1 1 0 1 1 2 0v2.5c0 .55-.45 1-1 1H5.75c-.55 0-1-.45-1-1v-2.5c0-.55.45-1 1-1Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
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
  hidePageMenu = false,
  hideRightToggle = false,
  onOpenTopUpDialog,
  onOpenBugReportDialog,
  onOpenSettingsDialog,
  showAiAssistantAction = false,
  onOpenAiAssistant,
  onGoHome,
  mobileVariant = 'bottom-nav',
  search,
  centerSlot,
}: AppHeaderProps) {
  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState(false)
  const [isAppDownloadDialogOpen, setIsAppDownloadDialogOpen] = useState(false)
  const [isMobileActionSheetOpen, setIsMobileActionSheetOpen] = useState(false)
  const [isMobileMoreSheetOpen, setIsMobileMoreSheetOpen] = useState(false)
  const [accountActionsConsumerCount, setAccountActionsConsumerCount] = useState(0)
  const menuTriggerRef = useRef<HTMLDivElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const desktopHeaderLeftRef = useRef<HTMLDivElement | null>(null)
  const desktopHeaderRightRef = useRef<HTMLDivElement | null>(null)
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
  const neutralImageIconFilter = 'none'
  const isCompactSidebar = useMediaQuery(COMPACT_SIDEBAR_MEDIA_QUERY)
  const isPhoneLayout = useMediaQuery(PHONE_MEDIA_QUERY)
  const shouldHideBrandLogo = useMediaQuery(HIDE_LOGO_MEDIA_QUERY)
  const isMobileBottomNav = mobileVariant === 'bottom-nav' && isPhoneLayout
  const isMobileStory = mobileVariant === 'story' && isPhoneLayout
  const shouldHideRightToggle = hideRightToggle || isMobileBottomNav

  const handleOpenSupportDialog = () => setIsSupportDialogOpen(true)
  const handleCloseSupportDialog = () => setIsSupportDialogOpen(false)
  const handleOpenAppDownloadDialog = () => setIsAppDownloadDialogOpen(true)
  const handleCloseAppDownloadDialog = () => setIsAppDownloadDialogOpen(false)

  const handleOpenWiki = () => {
    if (window.location.pathname !== '/wiki') {
      window.history.pushState({}, '', '/wiki')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

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

  const handleOpenAiAssistant = () => {
    if (onOpenAiAssistant) {
      onOpenAiAssistant()
      return
    }
    window.dispatchEvent(new CustomEvent(AI_ASSISTANT_OPEN_EVENT))
  }

  const primaryMenuIcons = [SidebarHomeIcon, SidebarCommunityIcon, SidebarPublicationsIcon]
  const primaryMenuIconByKey: Record<string, SidebarIconComponent> = {
    dashboard: SidebarHomeIcon,
    'games-publications': SidebarPublicationsIcon,
    'games-all': SidebarCommunityIcon,
    'community-worlds': SidebarCommunityIcon,
    shop: SidebarShopIcon,
    guide: SidebarGuideIcon,
    'world-create': SidebarLibraryIcon,
  }
  const resolvedMenuItems = [...menuItems]
    .filter((item) => item.key !== 'games-my')
    .map((item) => {
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
        'games-publications': 3,
      }
      return (orderByKey[left.key] ?? 10) - (orderByKey[right.key] ?? 10)
    })
  const getSidebarItemLabel = (item: AppHeaderMenuItem) => {
    if (item.key === 'games-publications') {
      return 'Публикации'
    }
    if (item.key === 'games-all' || item.key === 'community-worlds') {
      return 'Сообщество'
    }
    return item.label
  }
  const getDisplayedSidebarLabel = (item: AppHeaderMenuItem) => {
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
    if (itemKey === 'ai-assistant') {
      return 'AI-помощник'
    }
    if (itemKey === 'app-download') {
      return 'Скачать приложение'
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
    if (itemKey === 'ai-assistant') {
      return 'AI-\u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a'
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
  const utilityMenuItems = [
    ...(onOpenSettingsDialog
      ? [
          {
            key: 'theme-settings',
            label: 'Настройки',
            onClick: onOpenSettingsDialog,
            icon: <SidebarGlyphIcon markup={sidebarSettingsIconMarkup} />,
          },
        ]
      : []),
    ...(showAiAssistantAction
      ? [
          {
            key: 'ai-assistant',
            label: 'AI-помощник',
            onClick: handleOpenAiAssistant,
            icon: <SidebarGlyphIcon markup={aiIconMarkup} />,
          },
        ]
      : []),
    {
      key: 'wiki',
      label: 'Мору Вики',
      onClick: handleOpenWiki,
      icon: <SidebarGlyphIcon markup={sidebarBookIconMarkup} />,
    },
    {
      key: 'app-download',
      label: 'Скачать приложение',
      onClick: handleOpenAppDownloadDialog,
      icon: <SidebarDownloadIcon />,
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
  ].filter((item) => !['theme-settings', 'ai-assistant', 'support', 'top-up'].includes(item.key))

  const closeMobileSheets = useCallback(() => {
    setIsMobileActionSheetOpen(false)
    setIsMobileMoreSheetOpen(false)
  }, [])

  const closePageMenu = useCallback(() => {
    if (onClosePageMenu) {
      onClosePageMenu()
      return
    }
    if (isPageMenuOpen) {
      onTogglePageMenu()
    }
  }, [isPageMenuOpen, onClosePageMenu, onTogglePageMenu])

  const mobilePrimaryKeys = new Set(['dashboard', 'games-all', 'community-worlds'])
  const mobileHomeItem = resolvedMenuItems.find((item) => item.key === 'dashboard') ?? null
  const mobileCommunityItem =
    resolvedMenuItems.find((item) => item.key === 'games-all' || item.key === 'community-worlds') ?? null
  const mobileMoreMenuItems = resolvedMenuItems.filter((item) => !mobilePrimaryKeys.has(item.key))
  const headerNavItems: AppHeaderMenuItem[] = [
    ...resolvedMenuItems.filter((item) => HEADER_NAV_KEYS.has(item.key)),
    ...(onOpenTopUpDialog ? [{ key: 'shop', label: 'Магазин', onClick: handleOpenTopUpDialog }] : []),
  ]
  const currentPathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const isHeaderNavItemActive = (item: AppHeaderMenuItem) => {
    if (item.isActive) {
      return true
    }
    if (item.key === 'dashboard') {
      return currentPathname === '/' || currentPathname === '/dashboard'
    }
    if (item.key === 'games-all' || item.key === 'community-worlds') {
      return currentPathname.startsWith('/games/all')
    }
    if (item.key === 'shop') {
      return currentPathname.startsWith('/shop')
    }
    return false
  }
  const fallbackMobileActionItems: AppHeaderMobileActionItem[] = [
    ...(resolvedMenuItems.find((item) => item.key === 'world-create')
      ? [
          {
            key: 'world-create',
            title: '\u041d\u043e\u0432\u0430\u044f \u0438\u0433\u0440\u0430',
            description: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0438\u043b\u0438 \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440 \u0438\u0433\u0440\u044b.',
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
    ...(onOpenSettingsDialog
      ? [
          {
            key: 'theme-settings',
            title: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438',
            description: '\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0442\u0435\u043c\u0443, \u0448\u0440\u0438\u0444\u0442 \u0438 \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u043e\u043f\u0446\u0438\u0438.',
            iconMarkup: sidebarSettingsIconMarkup,
            onClick: onOpenSettingsDialog,
          },
        ]
      : []),
  ]
  const resolvedMobileActionItems = (mobileActionItems.length > 0 ? mobileActionItems : fallbackMobileActionItems).filter(
    (item) => !['theme-settings', 'top-up'].includes(item.key),
  )
  const shouldShowHeaderControls = !hidePageMenu && !isMobileStory && !isMobileBottomNav
  const shouldShowHeaderAiAction = shouldShowHeaderControls && !isMobileBottomNav && showAiAssistantAction
  const shouldShowHeaderPlay = shouldShowHeaderControls && !isMobileBottomNav
  // The new desktop header replaces the old collapsible sidebars. These aliases keep the
  // shared mobile/story branch intact without mounting any of the retired desktop UI.
  const shouldRenderLegacyHeaderTrigger = false
  const shouldRenderLegacyDesktopSidebar = false
  const shouldRenderLegacyCompactSidebar = false
  const shouldShowCompactSidebarOverlay = false
  const shouldRenderSidebarPanel = false
  const showLogo = false
  const showPrimaryItems = false
  const showUtilityItems = false
  const sidebarWidth = MENU_COLLAPSED_WIDTH
  const desktopHeaderLeftWidth = 0
  const desktopHeaderRightWidth = 0
  const desktopCenterLeftGap = 0
  const desktopCenterRightGap = 0
  const isMoreButtonActive =
    isMobileMoreSheetOpen || mobileMoreMenuItems.some((item) => item.isActive) || (!mobileHomeItem && !mobileCommunityItem)
  const dashboardMenuItemOnClick = resolvedMenuItems.find((item) => item.key === 'dashboard')?.onClick
  const canLogoNavigateHome = Boolean(onGoHome || dashboardMenuItemOnClick)
  const fallbackContinueAction = mobileActionItems.find((item) => item.key === 'continue') ?? null

  const handleBrandLogoClick = () => {
    closeMobileSheets()
    if (onGoHome) {
      onGoHome()
      return
    }
    dashboardMenuItemOnClick?.()
  }

  const registerAccountActions = useCallback(() => {
    setAccountActionsConsumerCount((count) => count + 1)
    return () => setAccountActionsConsumerCount((count) => Math.max(0, count - 1))
  }, [])

  const renderBrandLogo = ({
    width = LOGO_WIDTH,
    showWordmark = false,
  }: {
    width?: number
    showWordmark?: boolean
  } = {}) => {
    const brandContent = (
      <Stack direction="row" spacing={1.1} alignItems="center" sx={{ width: 'max-content' }}>
        <Box
          component="img"
          src={brandLogo}
          alt=""
          sx={{
            width,
            height: 'auto',
            display: 'block',
            opacity: 0.96,
            filter: 'brightness(0) invert(1)',
          }}
        />
        {showWordmark ? (
          <Typography
            component="span"
            sx={{
              color: 'var(--morius-title-text)',
              fontFamily: 'var(--morius-font-ui)',
              fontSize: '1.1rem',
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.01em !important',
              whiteSpace: 'nowrap',
            }}
          >
            Moru
          </Typography>
        ) : null}
      </Stack>
    )

    if (!canLogoNavigateHome) {
      return brandContent
    }

    return (
      <Box
        component="button"
        type="button"
        onClick={handleBrandLogoClick}
        aria-label="На главную"
        sx={{
          p: 0,
          m: 0,
          width: 'max-content',
          border: 'none',
          background: 'transparent',
          display: 'block',
          cursor: 'pointer',
          '&:focus-visible': {
            outline: '2px solid rgba(205, 223, 246, 0.62)',
            outlineOffset: '4px',
            borderRadius: '8px',
          },
        }}
      >
        {brandContent}
      </Box>
    )
  }

  useEffect(() => {
    if (hidePageMenu || !isPageMenuOpen || isMobileBottomNav || !isCompactSidebar) {
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
  }, [closePageMenu, hidePageMenu, isCompactSidebar, isMobileBottomNav, isPageMenuOpen])

  useEffect(() => {
    if (isPhoneLayout) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setIsMobileActionSheetOpen(false)
      setIsMobileMoreSheetOpen(false)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isPhoneLayout])

  const headerSearchNode = shouldShowHeaderControls ? (
    <HeaderSearch
      key={search ? 'page-search' : 'community-search'}
      value={search?.value}
      onChange={search?.onChange}
      onSubmit={search ? undefined : (query) => navigateInApp(`/games/all?q=${encodeURIComponent(query)}`)}
      placeholder={search?.placeholder ?? COMMUNITY_SEARCH_PLACEHOLDER}
      ariaLabel={search?.ariaLabel ?? 'Поиск по сообществу'}
      maxLength={search?.maxLength}
    />
  ) : null

  const headerAiActionNode = shouldShowHeaderAiAction ? (
    <IconButton
      className="morius-header-ai-button"
      aria-label={'AI-помощник'}
      onClick={handleOpenAiAssistant}
      sx={{ flex: `0 0 ${HEADER_CONTROL_SIZE}px`, p: 0 }}
    >
      <ThemedSvgIcon markup={aiIconMarkup} size={16} sx={{ color: 'inherit' }} />
    </IconButton>
  ) : null

  // Only reached when a page renders its own right cluster without HeaderAccountActions.
  const fallbackPlayNode = shouldShowHeaderPlay && fallbackContinueAction ? (
    <Box
      component="button"
      type="button"
      aria-label="Играть"
      onClick={fallbackContinueAction.onClick}
      disabled={fallbackContinueAction.disabled}
      sx={{
        ...headerIconButtonSx,
        width: 'auto',
        minWidth: 0,
        flex: '0 0 auto',
        px: '16px',
        display: 'inline-flex',
        gap: '8px',
        border: 'none',
        background: 'var(--morius-accent)',
        boxShadow: 'none',
        color: 'var(--morius-accent-contrast)',
        fontSize: '0.875rem',
        fontWeight: 600,
        lineHeight: 1,
        '&:hover': { filter: 'brightness(1.08)' },
      }}
    >
      <ThemedSvgIcon markup={mobilePlayIconMarkup} size={16} sx={{ color: 'var(--morius-accent-contrast)' }} />
      Играть
    </Box>
  ) : null

  const hasAccountActionsConsumer = accountActionsConsumerCount > 0
  const headerSlots: AppHeaderSlots = {
    search: headerSearchNode,
    aiAssistant: headerAiActionNode,
    showPlay: shouldShowHeaderPlay,
    registerAccountActions,
  }
  const standaloneHeaderControls = hasAccountActionsConsumer ? null : (
    <>
      {headerSearchNode}
      {headerAiActionNode}
      {fallbackPlayNode}
    </>
  )

  return (
    <AppHeaderSlotsContext.Provider value={headerSlots}>
      {/* Above the branch: the desktop layout needs the page backdrop just as much as mobile. */}
      <AppBackdropGlow />
      {isMobileBottomNav ? (
        <>
          <Box
            component="header"
            sx={{
              ...headerBackdropSx,
            }}
          />

          <Box
            sx={{
              position: 'fixed',
              top: 0,
              left: 'var(--morius-header-side-offset)',
              zIndex: 37,
              height: 'var(--morius-header-menu-top)',
              display: shouldHideBrandLogo ? 'none' : 'flex',
              alignItems: 'center',
              pointerEvents: canLogoNavigateHome ? 'auto' : 'none',
            }}
          >
            {renderBrandLogo({ width: 34, showWordmark: true })}
          </Box>

          <Box
            sx={{
              position: 'fixed',
              top: 0,
              right: 'var(--morius-header-side-offset)',
              zIndex: 45,
              height: 'var(--morius-header-menu-top)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              {standaloneHeaderControls}
              <Box>
                {rightActions}
              </Box>
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
                              <ProgressiveImage
                                src={item.imageSrc}
                                alt=""
                                loading="eager"
                                fetchPriority="high"
                                objectFit="cover"
                                objectPosition={item.imagePosition ?? 'center'}
                                loaderSize={22}
                                containerSx={{
                                  position: 'absolute',
                                  inset: 0,
                                }}
                                imgSx={{
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
                              <ProgressiveImage
                                src={item.imageSrc}
                                alt=""
                                loading="eager"
                                fetchPriority="high"
                                objectFit="contain"
                                loaderSize={18}
                                containerSx={{
                                  width: 80,
                                  height: 80,
                                  flexShrink: 0,
                                  alignSelf: 'flex-end',
                                  backgroundColor: 'transparent',
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
                            ? 'var(--morius-card-bg)'
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
              pb: `calc(${MOBILE_BOTTOM_NAV_BOTTOM_GAP}px + env(safe-area-inset-bottom))`,
              backgroundColor: MOBILE_BOTTOM_NAV_BACKGROUND,
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                pointerEvents: 'auto',
                minHeight: MOBILE_BOTTOM_NAV_CONTENT_HEIGHT,
                borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
                backgroundColor: MOBILE_BOTTOM_NAV_BACKGROUND,
                boxShadow: '0 -18px 34px rgba(0, 0, 0, 0.24)',
                px: 2.2,
                pt: 0.15,
                pb: 0.2,
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.2}>
                <IconButton
                  aria-label={'\u0413\u043b\u0430\u0432\u043d\u0430\u044f'}
                  onClick={() => {
                    closeMobileSheets()
                    mobileHomeItem?.onClick()
                  }}
                  sx={{ ...sidebarButtonSx(Boolean(mobileHomeItem?.isActive), false, false, false), minHeight: 46, height: 46 }}
                >
                  <Box sx={sidebarIconWrapSx(Boolean(mobileHomeItem?.isActive))}>
                    <SidebarHomeIcon />
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
                    width: 66,
                    minWidth: 66,
                    minHeight: 46,
                    height: 46,
                    justifyContent: 'center',
                    borderRadius: '16px',
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
                  sx={{ ...sidebarButtonSx(Boolean(mobileCommunityItem?.isActive), false, false, false), minHeight: 46, height: 46 }}
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
                  sx={{ ...sidebarButtonSx(isMoreButtonActive, false, true, false), minHeight: 46, height: 46 }}
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
              ...headerBackdropSx,
            }}
          />

          {!hidePageMenu ? (
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
          ) : null}

          {!hidePageMenu ? (
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
                pointerEvents: canLogoNavigateHome ? 'auto' : 'none',
              }}
            >
              {renderBrandLogo()}
            </Box>
          </Box>
          ) : null}

          {!hidePageMenu ? (
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
              {standaloneHeaderControls}
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
                    ? undefined
                    : {
                        ml: isRightPanelOpen ? 1 : 0,
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
      ) : (
        <>
          <Box
        component="header"
        sx={{
          ...headerBackdropSx,
        }}
      />

      {!hidePageMenu ? (
        <Box
          ref={desktopHeaderLeftRef}
          sx={{
            position: 'fixed',
            top: 'var(--morius-header-top-offset)',
            left: 'var(--morius-header-side-offset)',
            zIndex: 38,
            height: HEADER_BUTTON_SIZE,
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            pointerEvents: 'auto',
          }}
        >
          <Stack direction="row" spacing={3.1} alignItems="center" sx={{ height: '100%' }}>
            <Box
              sx={{
                display: shouldHideBrandLogo ? 'none' : 'block',
                flexShrink: 0,
                pointerEvents: canLogoNavigateHome ? 'auto' : 'none',
              }}
            >
              {renderBrandLogo({ width: DESKTOP_LOGO_WIDTH, showWordmark: true })}
            </Box>
            <Stack direction="row" spacing={1.15} alignItems="center" sx={{ height: '100%' }}>
              {headerNavItems.map((item, index) => {
                const MenuIcon = primaryMenuIconByKey[item.key] ?? primaryMenuIcons[index % primaryMenuIcons.length]
                const isActive = isHeaderNavItemActive(item)
                // These win over headerNavButtonSx because they are applied with !important, so
                // the active pill's label and icon have to be set here too - on the amber fill
                // they take the dark contrast colour, not white.
                const navItemColor = isActive ? 'var(--morius-accent-contrast)' : 'var(--morius-text-secondary)'
                const navIconColor = isActive ? 'var(--morius-accent-contrast)' : 'var(--morius-text-secondary)'

                return (
                  <Button
                    key={`header-nav-${item.key}`}
                    onClick={item.onClick}
                    disableRipple
                    sx={headerNavButtonSx(isActive)}
                  >
                    <Box
                      sx={{
                        display: 'inline-flex',
                        color: `${navIconColor} !important`,
                        '&, & *': { color: `${navIconColor} !important` },
                        '& svg': { color: `${navIconColor} !important` },
                        '& path': { fill: 'currentColor !important', stroke: 'currentColor !important' },
                      }}
                    >
                      <MenuIcon />
                    </Box>
                    <Box component="span" sx={{ color: `${navItemColor} !important` }}>
                      {getSafeSidebarLabel(item)}
                    </Box>
                  </Button>
                )
              })}
            </Stack>
          </Stack>
        </Box>
      ) : null}

      {shouldRenderLegacyHeaderTrigger ? (
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
            pointerEvents: showLogo && canLogoNavigateHome ? 'auto' : 'none',
            transition: 'opacity 180ms ease',
          }}
        >
          {renderBrandLogo()}
        </Box>
      </Box>
      ) : null}

      {centerSlot ? (
        <Box
          sx={{
            position: 'fixed',
            top: 'var(--morius-header-top-offset)',
            left: `calc(var(--morius-header-side-offset) + ${desktopHeaderLeftWidth + desktopCenterLeftGap}px)`,
            right: `calc(var(--morius-header-side-offset) + ${desktopHeaderRightWidth + desktopCenterRightGap}px)`,
            height: HEADER_BUTTON_SIZE,
            zIndex: 37,
            width: 'auto',
            maxWidth: `${HEADER_CONTENT_MAX_WIDTH}px`,
            minWidth: 0,
            mx: 'auto',
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            pointerEvents: 'auto',
            overflow: 'hidden',
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

      {shouldRenderLegacyDesktopSidebar && !isCompactSidebar && shouldRenderSidebarPanel ? (
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
                    <Tooltip key={item.key} disableInteractive title={isPageMenuOpen ? '' : resolvedLabel} placement="right" disableHoverListener={isPageMenuOpen}>
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
                  maxHeight: showUtilityItems ? 320 : 0,
                  opacity: showUtilityItems ? 1 : 0,
                  overflow: 'hidden',
                  pointerEvents: showUtilityItems ? 'auto' : 'none',
                  transition: 'max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                }}
              >
                {utilityMenuItems.map((item) => {
                  const resolvedLabel = getSafeUtilityItemLabel(item.key, item.label)

                  return (
                    <Tooltip key={item.key} disableInteractive title={isPageMenuOpen ? '' : resolvedLabel} placement="right" disableHoverListener={isPageMenuOpen}>
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

      {shouldRenderLegacyCompactSidebar && !hidePageMenu && isCompactSidebar ? (
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
        ref={desktopHeaderRightRef}
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          right: 'var(--morius-header-side-offset)',
          zIndex: 45,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {standaloneHeaderControls}
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
                ? undefined
                : {
                    ml: isRightPanelOpen ? 1 : 0,
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


      <AppDownloadDialog
        open={isAppDownloadDialogOpen}
        onClose={handleCloseAppDownloadDialog}
      />

      <BaseDialog
        open={isSupportDialogOpen}
        onClose={handleCloseSupportDialog}
        maxWidth="sm"
        header={<Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--morius-title-text)' }}>Нашли баг? Сообщите нам.</Typography>}
        paperSx={{
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
        actions={
          <Button
            onClick={handleCloseSupportDialog}
            sx={{
              minHeight: 40,
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--morius-text-secondary)',
              '&:hover': {
                backgroundColor: 'transparent',
                color: 'var(--morius-title-text)',
              },
            }}
          >
            Закрыть
          </Button>
        }
      >
        <Stack spacing={1.25}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', opacity: 0.72 }}>
            Выберите удобный канал и перейдите в сообщество в один клик.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            <Box
              component="a"
              href="https://t.me/+t2ueY4x_KvE4ZWEy"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-title-text)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                px: 1.5,
                py: 1,
                transition: 'background-color 160ms ease',
                '&:hover': {
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 80%, var(--morius-text-secondary) 20%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.2}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--morius-title-text)' }}>Телеграм</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                  https://t.me/+t2ueY4x_KvE4ZWEy
                </Typography>
              </Stack>
            </Box>
            <Box
              component="a"
              href="https://vk.com/moriusai"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-title-text)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                px: 1.5,
                py: 1,
                transition: 'background-color 160ms ease',
                '&:hover': {
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 80%, var(--morius-text-secondary) 20%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.2}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--morius-title-text)' }}>ВКонтакте</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>https://vk.com/moriusai</Typography>
              </Stack>
            </Box>
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
    </AppHeaderSlotsContext.Provider>
  )
}

export default AppHeader
