import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  Box,
  Button,
  Fade,
  FormControl,
  Grow,
  IconButton,
  MenuItem,
  Popover,
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
import AppDownloadDialog from './AppDownloadDialog'
import { AI_ASSISTANT_OPEN_EVENT } from './ai/aiAssistantEvents'
import useMobileDialogSheet from './dialogs/useMobileDialogSheet'
import ThemedSvgIcon from './icons/ThemedSvgIcon'
import ProgressiveImage from './media/ProgressiveImage'
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
  hidePageMenu?: boolean
  hideRightToggle?: boolean
  onOpenTopUpDialog?: () => void
  onOpenBugReportDialog?: () => void
  onOpenSettingsDialog?: () => void
  showAiAssistantAction?: boolean
  onOpenAiAssistant?: () => void
  onGoHome?: () => void
  mobileVariant?: 'bottom-nav' | 'story'
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
const HEADER_NAV_ACTIVE_COLOR = 'var(--morius-gold, #cda659)'
const HEADER_PLAY_ICON_COLOR = '#FFFFFF'
const HEADER_PLAY_BUTTON_WIDTH = 124
const HEADER_PLAY_BUTTON_HEIGHT = HEADER_BUTTON_SIZE
const HEADER_PLAY_ICON_SIZE = 20
const HEADER_CONTENT_MAX_WIDTH = 1320
const DESKTOP_HEADER_CENTER_GAP = 14
const DESKTOP_HEADER_LEFT_FALLBACK_WIDTH = 460

const headerBackdropSx = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 'var(--morius-header-menu-top)',
  zIndex: 34,
  pointerEvents: 'none',
  background: 'linear-gradient(180deg, rgba(11,11,13,0.94), rgba(11,11,13,0.66))',
  borderBottom: 'var(--morius-border-width) solid rgba(255,255,255,0.06)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
} as const

const shellButtonSx = {
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  minWidth: HEADER_BUTTON_SIZE,
  minHeight: HEADER_BUTTON_SIZE,
  maxWidth: HEADER_BUTTON_SIZE,
  maxHeight: HEADER_BUTTON_SIZE,
  borderRadius: '12px !important',
  border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
  backgroundColor: 'rgba(255,255,255,0.03) !important',
  color: '#cfcdd4 !important',
  transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease',
  '&:hover': {
    color: 'var(--morius-title-text) !important',
    backgroundColor: 'rgba(255,255,255,0.06) !important',
    borderColor: 'var(--morius-hover-border)',
  },
  '&:active': {
    backgroundColor: 'rgba(255,255,255,0.08) !important',
  },
} as const

const headerRoundActionButtonSx = {
  minWidth: 0,
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  minHeight: HEADER_BUTTON_SIZE,
  maxWidth: HEADER_BUTTON_SIZE,
  maxHeight: HEADER_BUTTON_SIZE,
  flex: `0 0 ${HEADER_BUTTON_SIZE}px`,
  mr: 1,
  p: 0,
  borderRadius: '12px !important',
  color: '#cfcdd4 !important',
  backgroundColor: 'rgba(255,255,255,0.03) !important',
  border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
  boxShadow: 'none !important',
  opacity: '1 !important',
  transition: 'background-color 160ms ease, color 160ms ease',
  position: 'relative',
  overflow: 'hidden',
  '&:hover': {
    color: 'var(--morius-title-text) !important',
    backgroundColor: 'rgba(255,255,255,0.06) !important',
    borderColor: 'var(--morius-hover-border)',
    opacity: '1 !important',
  },
  '&:active': {
    backgroundColor: 'rgba(255,255,255,0.08) !important',
  },
} as const

const headerPlayActionButtonSx = {
  '--morius-header-play-width': `${HEADER_PLAY_BUTTON_WIDTH}px`,
  '--morius-header-play-height': `${HEADER_PLAY_BUTTON_HEIGHT}px`,
  '--morius-header-play-radius': '12px',
  '--morius-header-play-icon-size': `${HEADER_PLAY_ICON_SIZE}px`,
  '--morius-header-play-bg': 'linear-gradient(180deg, color-mix(in srgb, var(--accent, #4c8dff) 82%, #ffffff 18%), var(--accent, #4c8dff))',
  minWidth: HEADER_PLAY_BUTTON_WIDTH,
  width: HEADER_PLAY_BUTTON_WIDTH,
  height: HEADER_PLAY_BUTTON_HEIGHT,
  minHeight: HEADER_PLAY_BUTTON_HEIGHT,
  maxWidth: HEADER_PLAY_BUTTON_WIDTH,
  maxHeight: HEADER_PLAY_BUTTON_HEIGHT,
  flex: `0 0 ${HEADER_PLAY_BUTTON_WIDTH}px`,
  mr: 1,
  px: 1.55,
  py: 0,
  gap: 1.1,
  borderRadius: '12px !important',
  color: '#FFFFFF !important',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent, #4c8dff) 82%, #ffffff 18%), var(--accent, #4c8dff)) !important',
  border: 'none',
  boxShadow: 'none !important',
  opacity: '1 !important',
  transition: 'background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
  position: 'relative',
  overflow: 'hidden',
  '&:hover': {
    color: '#FFFFFF !important',
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent, #4c8dff) 88%, #ffffff 12%), color-mix(in srgb, var(--accent, #4c8dff) 92%, #000 8%)) !important',
    boxShadow: 'none !important',
    opacity: '1 !important',
  },
  '&:active': {
    background: 'color-mix(in srgb, var(--accent, #4c8dff) 88%, #000 12%) !important',
    boxShadow: 'none !important',
    transform: 'translateY(1px)',
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
  centerSlot,
}: AppHeaderProps) {
  const [isThemeDialogOpen, setIsThemeDialogOpen] = useState(false)
  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState(false)
  const [isAppDownloadDialogOpen, setIsAppDownloadDialogOpen] = useState(false)
  const [isMobileActionSheetOpen, setIsMobileActionSheetOpen] = useState(false)
  const [isMobileMoreSheetOpen, setIsMobileMoreSheetOpen] = useState(false)
  const [headerQuickActionsAnchorEl, setHeaderQuickActionsAnchorEl] = useState<HTMLElement | null>(null)
  const [desktopHeaderSideWidths, setDesktopHeaderSideWidths] = useState({ left: 0, right: 0 })
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

  const handleCloseThemeDialog = () => setIsThemeDialogOpen(false)
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
  const showLogo = !hidePageMenu && !shouldHideBrandLogo && (isPageMenuOpen || !isCompactSidebar)
  const showPrimaryItems = !hidePageMenu && (isPageMenuOpen || !isCompactSidebar)
  const showUtilityItems = !hidePageMenu && isPageMenuOpen
  const shouldRenderSidebarPanel = !hidePageMenu && (!isCompactSidebar || isPageMenuOpen)
  const sidebarWidth = isCompactSidebar
    ? (isPageMenuOpen ? MENU_EXPANDED_WIDTH : HEADER_BUTTON_SIZE)
    : (isPageMenuOpen ? MENU_EXPANDED_WIDTH : MENU_COLLAPSED_WIDTH)
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
      label: 'Мориус Вики',
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
  const headerNavItems = resolvedMenuItems.filter((item) => HEADER_NAV_KEYS.has(item.key))
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
  const headerQuickActionItems = mobileActionItems.filter(
    (item) => !['support', 'games-my'].includes(item.key),
  )
  const shouldShowHeaderQuickActions = !hidePageMenu && !isMobileBottomNav && !isMobileStory && headerQuickActionItems.length > 0
  const shouldShowHeaderAiAction = !hidePageMenu && !isMobileBottomNav && !isMobileStory && showAiAssistantAction
  const isHeaderQuickActionsOpen = Boolean(headerQuickActionsAnchorEl)
  const shouldRenderLegacyHeaderTrigger = false
  const shouldRenderLegacyDesktopSidebar = false
  const shouldRenderLegacyCompactSidebar = false
  const isMoreButtonActive =
    isMobileMoreSheetOpen || mobileMoreMenuItems.some((item) => item.isActive) || (!mobileHomeItem && !mobileCommunityItem)
  const shouldShowCompactSidebarOverlay = false
  const dashboardMenuItemOnClick = resolvedMenuItems.find((item) => item.key === 'dashboard')?.onClick
  const canLogoNavigateHome = Boolean(onGoHome || dashboardMenuItemOnClick)

  useLayoutEffect(() => {
    if (isPhoneLayout) {
      return
    }

    const measureHeaderSides = () => {
      const left = Math.ceil(desktopHeaderLeftRef.current?.getBoundingClientRect().width ?? 0)
      const right = Math.ceil(desktopHeaderRightRef.current?.getBoundingClientRect().width ?? 0)
      setDesktopHeaderSideWidths((current) => (
        current.left === left && current.right === right ? current : { left, right }
      ))
    }

    measureHeaderSides()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureHeaderSides)
      return () => window.removeEventListener('resize', measureHeaderSides)
    }

    const resizeObserver = new ResizeObserver(measureHeaderSides)
    if (desktopHeaderLeftRef.current) {
      resizeObserver.observe(desktopHeaderLeftRef.current)
    }
    if (desktopHeaderRightRef.current) {
      resizeObserver.observe(desktopHeaderRightRef.current)
    }
    window.addEventListener('resize', measureHeaderSides)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', measureHeaderSides)
    }
  }, [hidePageMenu, isPhoneLayout, shouldHideRightToggle, shouldShowHeaderAiAction, shouldShowHeaderQuickActions])

  const desktopHeaderLeftWidth = hidePageMenu
    ? 0
    : (desktopHeaderSideWidths.left || DESKTOP_HEADER_LEFT_FALLBACK_WIDTH)
  const desktopHeaderRightWidth = desktopHeaderSideWidths.right
  const desktopCenterLeftGap = desktopHeaderLeftWidth > 0 ? DESKTOP_HEADER_CENTER_GAP : 0
  const desktopCenterRightGap = desktopHeaderRightWidth > 0 ? DESKTOP_HEADER_CENTER_GAP : 0

  const handleBrandLogoClick = () => {
    closeMobileSheets()
    if (onGoHome) {
      onGoHome()
      return
    }
    dashboardMenuItemOnClick?.()
  }

  const handleCloseHeaderQuickActions = () => {
    setHeaderQuickActionsAnchorEl(null)
  }

  const handleToggleHeaderQuickActions = (event: ReactMouseEvent<HTMLElement>) => {
    setHeaderQuickActionsAnchorEl((current) => (current ? null : event.currentTarget))
  }

  const renderBrandLogo = ({
    width = LOGO_WIDTH,
    showWordmark = false,
  }: {
    width?: number
    showWordmark?: boolean
  } = {}) => {
    const brandContent = (
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ width: 'max-content' }}>
        <Box
          component="img"
          src={brandLogo}
          alt=""
          sx={{
            width,
            height: 'auto',
            display: 'block',
            opacity: 0.96,
          }}
        />
        {showWordmark ? (
          <Typography
            component="span"
            sx={{
              color: 'var(--morius-title-text)',
              fontFamily: '"Spectral", "Times New Roman", serif',
              fontSize: '1.48rem',
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            MoRius
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

  useEffect(() => {
    if (shouldShowHeaderQuickActions) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setHeaderQuickActionsAnchorEl(null)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [shouldShowHeaderQuickActions])

  const headerContinueAction = headerQuickActionItems.find((item) => item.key === 'continue') ?? null
  const headerCompactActions = ['quick-start', 'new-world']
    .map((key) => headerQuickActionItems.find((item) => item.key === key) ?? null)
    .filter((item): item is AppHeaderMobileActionItem => Boolean(item))
  const headerShopAction =
    headerQuickActionItems.find((item) => item.key === 'shop' || item.key === 'top-up') ?? null

  const handleHeaderQuickAction = (item: AppHeaderMobileActionItem) => {
    handleCloseHeaderQuickActions()
    item.onClick()
  }

  const headerQuickActionsNode = shouldShowHeaderQuickActions ? (
    <>
      <Button
        className="morius-header-play-button"
        aria-label="Играть"
        aria-expanded={isHeaderQuickActionsOpen ? 'true' : undefined}
        onClick={handleToggleHeaderQuickActions}
        sx={{
          ...headerPlayActionButtonSx,
          opacity: isHeaderQuickActionsOpen ? 0.96 : 1,
        }}
      >
        <ThemedSvgIcon markup={mobilePlayIconMarkup} size={HEADER_PLAY_ICON_SIZE} sx={{ color: HEADER_PLAY_ICON_COLOR }} />
        <Typography component="span" sx={{ color: 'inherit', fontSize: '1rem', fontWeight: 800, lineHeight: 1 }}>
          Играть
        </Typography>
      </Button>

      <Popover
        open={isHeaderQuickActionsOpen}
        anchorEl={headerQuickActionsAnchorEl}
        onClose={handleCloseHeaderQuickActions}
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 1.15,
            width: 348,
            maxWidth: 'calc(100vw - 28px)',
            p: 1.4,
            borderRadius: '20px',
            border: 'var(--morius-border-width) solid rgba(255,255,255,0.1)',
            background: 'linear-gradient(180deg, #171a20 0%, #12151a 100%)',
            boxShadow: '0 30px 70px -20px rgba(0,0,0,0.86)',
            overflow: 'hidden',
          },
        }}
      >
        <Stack spacing={1.15}>
          {headerContinueAction ? (
            <Button
              onClick={() => handleHeaderQuickAction(headerContinueAction)}
              disabled={headerContinueAction.disabled}
              sx={{
                width: '100%',
                minHeight: 78,
                px: 1.35,
                py: 1.15,
                justifyContent: 'flex-start',
                textAlign: 'left',
                textTransform: 'none',
                color: 'var(--morius-title-text)',
                borderRadius: '15px',
                border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
                backgroundColor: 'rgba(255,255,255,0.035)',
                gap: 1.25,
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.065)',
                  borderColor: 'rgba(255,255,255,0.15)',
                },
                '&.Mui-disabled': { opacity: 0.5, color: 'var(--morius-title-text)' },
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '13px',
                  color: '#9ebcff',
                  border: 'var(--morius-border-width) solid rgba(91,137,238,0.48)',
                  background: 'linear-gradient(145deg, rgba(69,103,182,0.28), rgba(38,52,88,0.44))',
                }}
              >
                {headerContinueAction.iconMarkup ? (
                  <ThemedSvgIcon markup={headerContinueAction.iconMarkup} size={19} />
                ) : null}
              </Box>
              <Stack spacing={0.18} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                <Typography
                  sx={{
                    color: 'var(--morius-text-secondary)',
                    fontSize: '0.68rem',
                    fontWeight: 900,
                    lineHeight: 1,
                    letterSpacing: '0.14em !important',
                    textTransform: 'uppercase',
                  }}
                >
                  {headerContinueAction.title}
                </Typography>
                <Typography
                  noWrap
                  sx={{ width: '100%', color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 850, lineHeight: 1.18 }}
                >
                  {headerContinueAction.headline || 'Вернуться в историю'}
                </Typography>
                {headerContinueAction.description ? (
                  <Typography
                    noWrap
                    sx={{ width: '100%', color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.15 }}
                  >
                    {headerContinueAction.description}
                  </Typography>
                ) : null}
              </Stack>
              <Box component="img" src={icons.arrowback} alt="" sx={{ width: 12, height: 12, flexShrink: 0, opacity: 0.64 }} />
            </Button>
          ) : null}

          {headerCompactActions.length > 0 ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.15 }}>
              {headerCompactActions.map((item) => {
                const compactDescription =
                  item.key === 'quick-start'
                    ? 'Случайный мир — в бой'
                    : item.key === 'new-world'
                      ? 'С чистого листа'
                      : item.description
                return (
                  <Button
                    key={item.key}
                    onClick={() => handleHeaderQuickAction(item)}
                    disabled={item.disabled}
                    sx={{
                      minWidth: 0,
                      minHeight: 116,
                      px: 1.35,
                      py: 1.35,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      textTransform: 'none',
                      color: 'var(--morius-title-text)',
                      borderRadius: '15px',
                      border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
                      backgroundColor: 'rgba(255,255,255,0.035)',
                      '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.065)',
                        borderColor: 'rgba(255,255,255,0.15)',
                      },
                      '&.Mui-disabled': { opacity: 0.5, color: 'var(--morius-title-text)' },
                    }}
                  >
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '11px',
                        color: '#9ebcff',
                        border: 'var(--morius-border-width) solid rgba(91,137,238,0.42)',
                        backgroundColor: 'rgba(57,82,143,0.2)',
                      }}
                    >
                      {item.iconMarkup ? <ThemedSvgIcon markup={item.iconMarkup} size={19} /> : null}
                    </Box>
                    <Stack spacing={0.35} sx={{ width: '100%', alignItems: 'flex-start' }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 850, lineHeight: 1.08 }}>
                        {item.title}
                      </Typography>
                      {compactDescription ? (
                        <Typography
                          sx={{
                            color: 'var(--morius-text-secondary)',
                            fontSize: '0.76rem',
                            lineHeight: 1.25,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {compactDescription}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Button>
                )
              })}
            </Box>
          ) : null}

          {headerShopAction ? (
            <Button
              onClick={() => handleHeaderQuickAction(headerShopAction)}
              disabled={headerShopAction.disabled}
              sx={{
                width: '100%',
                minHeight: 62,
                px: 1.35,
                py: 1,
                gap: 1.2,
                justifyContent: 'flex-start',
                textAlign: 'left',
                textTransform: 'none',
                color: '#f1d48a',
                borderRadius: '15px',
                border: 'var(--morius-border-width) solid rgba(205,166,89,0.48)',
                background: 'linear-gradient(90deg, rgba(205,166,89,0.12), rgba(205,166,89,0.035))',
                '&:hover': {
                  borderColor: 'rgba(226,190,109,0.7)',
                  background: 'linear-gradient(90deg, rgba(205,166,89,0.18), rgba(205,166,89,0.06))',
                },
                '&.Mui-disabled': { opacity: 0.5, color: '#f1d48a' },
              }}
            >
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '11px',
                  color: '#edc873',
                  border: 'var(--morius-border-width) solid rgba(205,166,89,0.5)',
                  backgroundColor: 'rgba(205,166,89,0.14)',
                }}
              >
                {headerShopAction.iconMarkup ? <ThemedSvgIcon markup={headerShopAction.iconMarkup} size={18} /> : null}
              </Box>
              <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                <Typography sx={{ color: 'inherit', fontSize: '0.98rem', fontWeight: 850, lineHeight: 1.08 }}>
                  {headerShopAction.title}
                </Typography>
                <Typography sx={{ color: 'rgba(229,192,111,0.82)', fontSize: '0.77rem', lineHeight: 1.2 }}>
                  Пакеты солов и кристаллы
                </Typography>
              </Stack>
              <Box component="img" src={icons.arrowback} alt="" sx={{ width: 12, height: 12, flexShrink: 0, opacity: 0.74 }} />
            </Button>
          ) : null}
        </Stack>
      </Popover>
    </>
  ) : null

  const headerAiActionNode = shouldShowHeaderAiAction ? (
    <IconButton
      className="morius-header-ai-button"
      aria-label={'AI-\u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a'}
      onClick={handleOpenAiAssistant}
      sx={headerRoundActionButtonSx}
    >
      <ThemedSvgIcon markup={aiIconMarkup} size={16} sx={{ color: 'inherit' }} />
    </IconButton>
  ) : null

  return (
    <>
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
              top: 'var(--morius-header-top-offset)',
              left: 'var(--morius-header-side-offset)',
              zIndex: 37,
              display: shouldHideBrandLogo ? 'none' : 'block',
              pointerEvents: canLogoNavigateHome ? 'auto' : 'none',
            }}
          >
            {renderBrandLogo()}
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
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {headerAiActionNode}
              {headerQuickActionsNode}
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
              {headerAiActionNode}
              {headerQuickActionsNode}
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
                const navItemColor = isActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)'
                const navIconColor = isActive ? HEADER_NAV_ACTIVE_COLOR : 'var(--morius-text-secondary)'

                return (
                  <Button
                    key={`header-nav-${item.key}`}
                    onClick={item.onClick}
                    disableRipple
                    sx={{
                      minWidth: 0,
                      minHeight: HEADER_BUTTON_SIZE,
                      px: 1.8,
                      py: 0,
                      gap: 1,
                      border: isActive
                        ? 'var(--morius-border-width) solid rgba(255,255,255,0.14)'
                        : 'var(--morius-border-width) solid transparent',
                      borderRadius: '12px !important',
                      backgroundColor: isActive ? 'rgba(255,255,255,0.055) !important' : 'transparent !important',
                      color: `${navItemColor} !important`,
                      textTransform: 'none',
                      fontSize: '1rem',
                      fontWeight: 750,
                      lineHeight: 1,
                      '&:hover': {
                        backgroundColor: isActive ? 'rgba(255,255,255,0.075) !important' : 'rgba(255,255,255,0.035) !important',
                        borderColor: isActive ? 'rgba(255,255,255,0.18)' : 'transparent',
                        color: 'var(--morius-title-text) !important',
                      },
                      '&:active': {
                        backgroundColor: isActive ? 'rgba(255,255,255,0.055) !important' : 'transparent !important',
                      },
                    }}
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
          {headerAiActionNode}
          {headerQuickActionsNode}
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
    </>
  )
}

export default AppHeader
