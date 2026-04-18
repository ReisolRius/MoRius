import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type Ref,
} from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Grow,
  IconButton,
  Skeleton,
  Stack,
  SvgIcon,
  TextField,
  Typography,
  useMediaQuery,
  type GrowProps,
} from '@mui/material'
import tavernBgImage from '../assets/images/tavern-bg.png'
import dashboardContinueIconMarkup from '../assets/icons/dashboard-continue.svg?raw'
import dashboardQuickStartIconMarkup from '../assets/icons/dashboard-quick-start.svg?raw'
import sidebarPlusIconMarkup from '../assets/icons/custom/plus.svg?raw'
import sidebarVectorAltIconMarkup from '../assets/icons/custom/vector-1.svg?raw'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import quickStartDashboardImage from '../assets/images/dashboard/quick-start.png'
import newWorldDashboardImage from '../assets/images/dashboard/new-world.png'
import shopDashboardImage from '../assets/images/dashboard/shop.png'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import DeferredImage from '../components/media/DeferredImage'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import QuickStartWizardDialog from '../components/home/QuickStartWizardDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import BaseDialog from '../components/dialogs/BaseDialog'
import HeaderAccountActions from '../components/HeaderAccountActions'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import Footer from '../components/Footer'
import { rememberLastPlayedGameCard } from '../utils/mobileQuickActions'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  listDashboardNews,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  updateDashboardNews,
  type CoinTopUpPlan,
  type DashboardNewsCard,
} from '../services/authApi'
import {
  createCommunityWorldComment,
  deleteCommunityWorldComment,
  deleteStoryGame,
  favoriteCommunityWorld,
  getStoryGame,
  getCommunityWorld,
  launchCommunityWorld,
  listCommunityCharacters,
  listCommunityInstructionTemplates,
  listCommunityWorlds,
  listStoryGames,
  rateCommunityWorld,
  reportCommunityWorld,
  updateCommunityWorldComment,
  unfavoriteCommunityWorld,
  type StoryCommunityWorldReportReason,
} from '../services/storyApi'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type { StoryCommunityCharacterSummary, StoryCommunityInstructionTemplateSummary, StoryCommunityWorldPayload, StoryCommunityWorldSummary, StoryGameSummary } from '../types/story'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'
import { resolveApiResourceUrl } from '../services/httpClient'
import { MobileCardItem, MobileCardSlider } from '../components/mobile/MobileCardSlider'

type AuthenticatedHomePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

type DashboardNewsDraft = {
  category: string
  title: string
  description: string
  image_url: string
  date_label: string
}

type DashboardQuickAction = {
  key: 'continue' | 'quick-start' | 'new-world' | 'shop'
  title: string
  description: string
  headline?: string
  imageSrc?: string
  imageMode?: 'contain' | 'cover'
  imagePosition?: string
  iconMarkup: string
  onClick: () => void
  disabled?: boolean
}

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'

/**
 * Crossfade layer for the news hero image.
 * Loads the new image invisibly, then fades it in and notifies parent via onReady.
 * Parent keeps the old image visible until onReady fires — no blank frames.
 */
function NewsXfLayer({ src, onReady }: { src: string; onReady: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false)
  const calledRef = useRef(false)

  const handleLoad = () => {
    setLoaded(true)
    // Wait for fade-in transition to reach ~50% before swapping in parent
    window.setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true
        onReady(src)
      }
    }, 320)
  }

  const handleError = () => {
    // On error, still notify parent so UI doesn't freeze on the old image
    if (!calledRef.current) {
      calledRef.current = true
      onReady(src)
    }
  }

  return (
    <Box
      component="img"
      src={src}
      alt=""
      loading="eager"
      decoding="async"
      fetchPriority="high"
      onLoad={handleLoad}
      onError={handleError}
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'center',
        opacity: loaded ? 0.94 : 0,
        transition: 'opacity 600ms ease',
        pointerEvents: 'none',
      }}
    />
  )
}
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const HOME_NEWS_SKELETON_KEYS = Array.from({ length: 3 }, (_, index) => `home-news-skeleton-${index}`)
const HOME_COMMUNITY_SKELETON_CARD_KEYS = Array.from({ length: 4 }, (_, index) => `home-community-skeleton-${index}`)
const HOME_COMMUNITY_WORLD_LIMIT = 12

/** Section header with title, subtitle, and "Показать все" button */
function HomeSliderHeader({ title, subtitle, onShowAll }: { title: string; subtitle: string; onShowAll: () => void }) {
  return (
    <Stack sx={{ mb: 'var(--morius-cards-title-gap)', mt: 'var(--morius-cards-title-gap)' }}>
      {/* Title row: always inline, button right-aligned */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontSize: { xs: '1.6rem', md: '1.9rem' }, fontWeight: 800, color: APP_TEXT_PRIMARY }}>
          {title}
        </Typography>
        <Button
          onClick={onShowAll}
          sx={{
            minHeight: 'var(--morius-action-size)',
            px: 1.35,
            flexShrink: 0,
            borderRadius: 'var(--morius-radius)',
            textTransform: 'none',
            fontWeight: 700,
            fontSize: { xs: '0.82rem', md: '0.9rem' },
            border: 'var(--morius-border-width) solid transparent',
            backgroundColor: 'transparent',
            color: 'var(--morius-accent)',
            '&:hover': { border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: APP_BUTTON_HOVER },
            '&:active': { border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: APP_BUTTON_ACTIVE },
          }}
        >
          Показать все
        </Button>
      </Stack>
      {/* Subtitle below */}
      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.01rem', mt: 0.35 }}>
        {subtitle}
      </Typography>
    </Stack>
  )
}

/** AI-Dungeon-style horizontal slider with hover arrows */
function HomeCardSlider({ children, cardCount = 0 }: { children: React.ReactNode; cardCount?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    checkScroll()
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkScroll, cardCount])

  const scroll = (dir: 'left' | 'right') => {
    // Scroll by the full visible width → moves exactly 4 cards
    const visibleWidth = scrollRef.current?.clientWidth ?? 0
    scrollRef.current?.scrollBy({
      left: dir === 'left' ? -visibleWidth : visibleWidth,
      behavior: 'smooth',
    })
  }

  const arrowSx = {
    position: 'absolute' as const,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: '50%',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: 'var(--morius-title-text)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.38)',
    opacity: 0,
    pointerEvents: 'none' as const,
    transition: 'opacity 200ms ease, background-color 180ms ease',
    '&:hover': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 98%, white 2%)',
    },
  }

  return (
    <Box
      sx={{ position: 'relative', overflow: 'hidden', mx: '-4px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Left arrow */}
      <IconButton
        onClick={() => scroll('left')}
        aria-label="Прокрутить влево"
        sx={{
          ...arrowSx,
          left: 8,
          opacity: isHovered && canScrollLeft ? 1 : 0,
          pointerEvents: isHovered && canScrollLeft ? 'auto' : 'none',
        }}
      >
        <SvgIcon sx={{ width: 22, height: 22 }}>
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
        </SvgIcon>
      </IconButton>

      {/* Scrollable row */}
      <Box
        ref={scrollRef}
        onScroll={checkScroll}
        sx={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          px: '4px',
          pb: '6px',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {children}
      </Box>

      {/* Right arrow */}
      <IconButton
        onClick={() => scroll('right')}
        aria-label="Прокрутить вправо"
        sx={{
          ...arrowSx,
          right: 8,
          opacity: isHovered && canScrollRight ? 1 : 0,
          pointerEvents: isHovered && canScrollRight ? 'auto' : 'none',
        }}
      >
        <SvgIcon sx={{ width: 22, height: 22 }}>
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor" />
        </SvgIcon>
      </IconButton>
    </Box>
  )
}

/**
 * Shared wrapper — exactly 4 cards fill the slider's visible width.
 * Formula: width = (100% − 3 × gap) / 4 = 25% − (3 × 12px / 4) = 25% − 9px
 * On smaller screens two cards fill the view.
 */
function SliderCard({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      flexShrink: 0,
      width: {
        xs: 'calc(50% - 6px)',   // 2 cards on phones
        sm: 'calc(33.333% - 8px)', // 3 cards on tablet
        md: 'calc(25% - 9px)',   // 4 cards on desktop
      },
      minWidth: {
        xs: 'calc(50% - 6px)',
        sm: 'calc(33.333% - 8px)',
        md: 'calc(25% - 9px)',
      },
    }}>
      {children}
    </Box>
  )
}

/** Character card for home sliders — uses CharacterShowcaseCard (has DeferredImage inside) */
function HomeCharacterCard({ item, onClick }: { item: StoryCommunityCharacterSummary; onClick: () => void }) {
  const authorName = item.author_name.trim() || 'Неизвестный автор'
  return (
    <CharacterShowcaseCard
      title={item.name}
      description={item.description}
      imageUrl={item.avatar_url}
      imageScale={item.avatar_scale}
      eyebrow={item.note.trim() || null}
      heroHeader={
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <ProgressiveAvatar
            src={item.author_avatar_url}
            fallbackLabel={authorName}
            size={34}
            sx={{ border: 'var(--morius-border-width) solid rgba(214,225,239,0.3)', backgroundColor: 'rgba(6,10,16,0.76)' }}
          />
          <Typography
            sx={{ color: 'rgba(233,241,252,0.97)', fontSize: '0.88rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {authorName}
          </Typography>
        </Stack>
      }
      footerHint={`Автор: ${authorName}`}
      metaPrimary={`+${item.community_additions_count}`}
      metaSecondary={`${item.community_rating_avg.toFixed(1)} ★`}
      onClick={onClick}
      minHeight={300}
      descriptionLineClamp={2}
    />
  )
}

/** Rule (instruction template) card for home sliders */
function HomeRuleCard({ item, onClick }: { item: StoryCommunityInstructionTemplateSummary; onClick: () => void }) {
  const authorName = item.author_name.trim() || 'Неизвестный автор'
  const heroBackground = buildWorldFallbackArtwork(item.id + 100000)
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        borderRadius: 'var(--morius-radius)',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: APP_CARD_BACKGROUND,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        minHeight: 300,
        transition: 'transform 180ms ease, border-color 180ms ease',
        '&:hover': { transform: 'translateY(-2px)', borderColor: 'rgba(203,216,234,0.36)' },
        '&:focus-visible': { outline: '2px solid rgba(205,223,246,0.62)', outlineOffset: '2px' },
      }}
    >
      {/* Hero */}
      <Box sx={{ position: 'relative', height: 130, flexShrink: 0, overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, ...heroBackground }} />
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.46) 50%, rgba(0,0,0,0) 100%)' }} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ position: 'absolute', top: 10, left: 12, right: 12, minWidth: 0 }}>
          <ProgressiveAvatar
            src={item.author_avatar_url}
            fallbackLabel={authorName}
            size={34}
            sx={{ border: 'var(--morius-border-width) solid rgba(205,220,242,0.3)', backgroundColor: 'rgba(6,10,16,0.72)' }}
          />
          <Typography sx={{ color: 'rgba(233,241,252,0.97)', fontSize: '0.88rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {authorName}
          </Typography>
        </Stack>
      </Box>
      {/* Body */}
      <Stack sx={{ flex: 1, px: '16px', py: '14px', backgroundColor: APP_CARD_BACKGROUND }} spacing={0.8}>
        <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.02rem', fontWeight: 800, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.title}
        </Typography>
        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem', lineHeight: 1.44, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
          {item.content}
        </Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 'auto', pt: 1 }}>
          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>{item.community_additions_count} +</Typography>
          <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.82rem', fontWeight: 700 }}>{item.community_rating_avg.toFixed(1)} ★</Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

const MOBILE_CARD_HEIGHT = 130

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const DASHBOARD_RECENT_GAME_LIMIT = 12
const COMMUNITY_WORLD_REFRESH_INTERVAL_MS = 30 * 60 * 1000
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный формат файла'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function createDashboardNewsDraft(item: DashboardNewsCard | null): DashboardNewsDraft {
  return {
    category: item?.category ?? '',
    title: item?.title ?? '',
    description: item?.description ?? '',
    image_url: item?.image_url ?? '',
    date_label: item?.date_label ?? '',
  }
}

function getDashboardNewsFallbackImage(slot: number): string {
  if (slot === 2) {
    return newWorldDashboardImage
  }
  if (slot === 3) {
    return shopDashboardImage
  }
  return quickStartDashboardImage
}

function AuthenticatedHomePage({ user, authToken, onNavigate, onUserUpdate, onLogout }: AuthenticatedHomePageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [characterManagerOpen, setCharacterManagerOpen] = useState(false)
  const [instructionTemplateDialogOpen, setInstructionTemplateDialogOpen] = useState(false)
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)
  const [dashboardNews, setDashboardNews] = useState<DashboardNewsCard[]>([])
  const [selectedDashboardNewsId, setSelectedDashboardNewsId] = useState<number | null>(null)
  const [isDashboardNewsLoading, setIsDashboardNewsLoading] = useState(false)
  const [dashboardNewsError, setDashboardNewsError] = useState('')
  const [isDashboardNewsEditorOpen, setIsDashboardNewsEditorOpen] = useState(false)
  const [isDashboardNewsSaving, setIsDashboardNewsSaving] = useState(false)
  const [dashboardNewsEditorError, setDashboardNewsEditorError] = useState('')
  const [dashboardNewsDraft, setDashboardNewsDraft] = useState<DashboardNewsDraft>(createDashboardNewsDraft(null))
  const [isQuickStartDialogOpen, setIsQuickStartDialogOpen] = useState(false)
  const [isBgImageLoaded, setIsBgImageLoaded] = useState(false)
  const [communityWorlds, setCommunityWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [isCommunityWorldsLoading, setIsCommunityWorldsLoading] = useState(false)
  const [communityWorldsError, setCommunityWorldsError] = useState('')
  const [selectedCommunityWorld, setSelectedCommunityWorld] = useState<StoryCommunityWorldPayload | null>(null)
  const [isCommunityWorldDialogLoading, setIsCommunityWorldDialogLoading] = useState(false)
  const [communityRatingDraft, setCommunityRatingDraft] = useState(0)
  const [isCommunityRatingSaving, setIsCommunityRatingSaving] = useState(false)
  const [isLaunchingCommunityWorld, setIsLaunchingCommunityWorld] = useState(false)
  const [isCommunityReportSubmitting, setIsCommunityReportSubmitting] = useState(false)
  const [favoriteWorldActionById, setFavoriteWorldActionById] = useState<Record<number, boolean>>({})
  const [communityCharacters, setCommunityCharacters] = useState<StoryCommunityCharacterSummary[]>([])
  const [isCommunityCharactersLoading, setIsCommunityCharactersLoading] = useState(false)
  const [communityCharactersError, setCommunityCharactersError] = useState('')
  const [communityRules, setCommunityRules] = useState<StoryCommunityInstructionTemplateSummary[]>([])
  const [isCommunityRulesLoading, setIsCommunityRulesLoading] = useState(false)
  const [communityRulesError, setCommunityRulesError] = useState('')
  const [storyGames, setStoryGames] = useState<StoryGameSummary[]>([])
  const [isDashboardDataLoading, setIsDashboardDataLoading] = useState(true)
  const [isDashboardContinueResolving, setIsDashboardContinueResolving] = useState(false)
  const [communityWorldGameIds, setCommunityWorldGameIds] = useState<Record<number, number[]>>({})
  const [isCommunityWorldMyGamesSaving, setIsCommunityWorldMyGamesSaving] = useState(false)
  const [newsProgressKey, setNewsProgressKey] = useState(0)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const hasLoadedCommunityWorldGameIdsRef = useRef(false)
  const handledMobileActionRef = useRef<string | null>(null)
  const newsAutoAdvanceTimerRef = useRef<number | null>(null)
  const isPhoneLayout = useMediaQuery('(max-width:899.95px)')

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setAvatarCropSource(null)
    setAvatarError('')
  }

  const handleCloseTopUpDialog = () => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }

  const handleOpenTopUpDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpError('')
    setTopUpDialogOpen(true)
  }

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setCharacterManagerOpen(false)
    setInstructionTemplateDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }

  const handleOpenCharacterManager = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpDialogOpen(false)
    setInstructionTemplateDialogOpen(false)
    setCharacterManagerOpen(true)
  }

  const handleOpenInstructionTemplateDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpDialogOpen(false)
    setCharacterManagerOpen(false)
    setInstructionTemplateDialogOpen(true)
  }

  const handleChooseAvatar = () => {
    if (isAvatarSaving) {
      return
    }
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    if (selectedFile.size > AVATAR_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось подготовить изображение'
      setAvatarError(detail)
    }
  }

  const handleSaveCroppedAvatar = async (croppedDataUrl: string) => {
    if (isAvatarSaving) {
      return
    }

    setAvatarError('')
    setIsAvatarSaving(true)
    try {
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: croppedDataUrl,
        avatar_scale: 1,
      })
      onUserUpdate(updatedUser)
      setAvatarCropSource(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleUpdateProfileName = useCallback(
    async (nextName: string) => {
      const updatedUser = await updateCurrentUserProfile({
        token: authToken,
        display_name: nextName,
      })
      onUserUpdate(updatedUser)
    },
    [authToken, onUserUpdate],
  )

  const loadCommunityWorlds = useCallback(async () => {
    setIsCommunityWorldsLoading(true)
    setCommunityWorldsError('')
    try {
      const worlds = await listCommunityWorlds(authToken, { limit: HOME_COMMUNITY_WORLD_LIMIT })
      setCommunityWorlds(worlds)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить сообщество'
      setCommunityWorldsError(detail)
      setCommunityWorlds([])
    } finally {
      setIsCommunityWorldsLoading(false)
    }
  }, [authToken])

  const loadCommunityCharacters = useCallback(async () => {
    setIsCommunityCharactersLoading(true)
    setCommunityCharactersError('')
    try {
      const characters = await listCommunityCharacters(authToken, { limit: HOME_COMMUNITY_WORLD_LIMIT })
      setCommunityCharacters(characters)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей'
      setCommunityCharactersError(detail)
      setCommunityCharacters([])
    } finally {
      setIsCommunityCharactersLoading(false)
    }
  }, [authToken])

  const loadCommunityRules = useCallback(async () => {
    setIsCommunityRulesLoading(true)
    setCommunityRulesError('')
    try {
      const rules = await listCommunityInstructionTemplates(authToken, { limit: HOME_COMMUNITY_WORLD_LIMIT })
      setCommunityRules(rules)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить правила'
      setCommunityRulesError(detail)
      setCommunityRules([])
    } finally {
      setIsCommunityRulesLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadCommunityWorlds()
  }, [loadCommunityWorlds])

  useEffect(() => {
    void loadCommunityCharacters()
  }, [loadCommunityCharacters])

  useEffect(() => {
    void loadCommunityRules()
  }, [loadCommunityRules])

  useEffect(() => {
    const refreshTimerId = window.setInterval(() => {
      void loadCommunityWorlds()
    }, COMMUNITY_WORLD_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(refreshTimerId)
  }, [loadCommunityWorlds])

  useEffect(() => {
    const selectedWorldId = selectedCommunityWorld?.world.id ?? null
    if (!selectedWorldId) {
      return
    }
    const syncedSummary = communityWorlds.find((world) => world.id === selectedWorldId)
    if (!syncedSummary) {
      return
    }
    setSelectedCommunityWorld((previous) => {
      if (!previous || previous.world.id !== syncedSummary.id) {
        return previous
      }
      const previousWorld = previous.world
      if (
        previousWorld.updated_at === syncedSummary.updated_at &&
        previousWorld.community_rating_avg === syncedSummary.community_rating_avg &&
        previousWorld.community_rating_count === syncedSummary.community_rating_count &&
        previousWorld.community_views === syncedSummary.community_views &&
        previousWorld.community_launches === syncedSummary.community_launches &&
        previousWorld.user_rating === syncedSummary.user_rating &&
        previousWorld.is_favorited_by_user === syncedSummary.is_favorited_by_user &&
        previousWorld.is_reported_by_user === syncedSummary.is_reported_by_user
      ) {
        return previous
      }
      return {
        ...previous,
        world: {
          ...previousWorld,
          ...syncedSummary,
        },
      }
    })
  }, [communityWorlds, selectedCommunityWorld?.world.id])

  const loadDashboardGamesSnapshot = useCallback(async (): Promise<StoryGameSummary[]> => {
    const games = await listStoryGames(authToken, { compact: true, limit: DASHBOARD_RECENT_GAME_LIMIT })
    setStoryGames(games)
    return games
  }, [authToken])

  const loadDashboardNewsSnapshot = useCallback(async (): Promise<DashboardNewsCard[]> => {
    setIsDashboardNewsLoading(true)
    setDashboardNewsError('')
    try {
      const items = await listDashboardNews({ token: authToken })
      setDashboardNews(items)
      return items
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить новости'
      setDashboardNewsError(detail)
      setDashboardNews([])
      return []
    } finally {
      setIsDashboardNewsLoading(false)
    }
  }, [authToken])

  const loadStoryGamesSnapshot = useCallback(async (): Promise<StoryGameSummary[]> => {
    const games = await listStoryGames(authToken, { compact: true })
    setStoryGames(games)
    setCommunityWorldGameIds(buildCommunityWorldGameMap(games))
    hasLoadedCommunityWorldGameIdsRef.current = true
    return games
  }, [authToken])

  const syncDashboardData = useCallback(async () => {
    setIsDashboardDataLoading(true)
    try {
      await loadDashboardGamesSnapshot()
    } catch {
      // Optional metadata for UI; skip hard error when unavailable.
      setStoryGames([])
    } finally {
      setIsDashboardDataLoading(false)
    }
  }, [loadDashboardGamesSnapshot])

  useEffect(() => {
    void syncDashboardData()
  }, [syncDashboardData])

  useEffect(() => {
    void loadDashboardNewsSnapshot()
  }, [loadDashboardNewsSnapshot])

  const isDashboardNewsEditor = user.role === 'administrator' || user.role === 'moderator'
  const selectedDashboardNews = useMemo(
    () => dashboardNews.find((item) => item.id === selectedDashboardNewsId) ?? dashboardNews[0] ?? null,
    [dashboardNews, selectedDashboardNewsId],
  )

  const handleOpenCommunityWorld = useCallback(
    async (worldId: number) => {
      if (isCommunityWorldDialogLoading) {
        return
      }
      setIsCommunityWorldDialogLoading(true)
      try {
        const payload = await getCommunityWorld({
          token: authToken,
          worldId,
        })
        const normalizedPayload: StoryCommunityWorldPayload = {
          ...payload,
          comments: payload.comments ?? [],
        }
        setSelectedCommunityWorld(normalizedPayload)
        setCommunityRatingDraft(normalizedPayload.world.user_rating ?? 0)
        setCommunityWorlds((previous) =>
          previous.map((world) => (world.id === normalizedPayload.world.id ? normalizedPayload.world : world)),
        )
        if (!hasLoadedCommunityWorldGameIdsRef.current) {
          void loadStoryGamesSnapshot()
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть мир'
        setCommunityWorldsError(detail)
      } finally {
        setIsCommunityWorldDialogLoading(false)
      }
    },
    [authToken, isCommunityWorldDialogLoading, loadStoryGamesSnapshot],
  )

  const handleCloseCommunityWorldDialog = useCallback(() => {
    if (
      isCommunityWorldDialogLoading ||
      isLaunchingCommunityWorld ||
      isCommunityRatingSaving ||
      isCommunityWorldMyGamesSaving ||
      isCommunityReportSubmitting
    ) {
      return
    }
    setSelectedCommunityWorld(null)
    setCommunityRatingDraft(0)
  }, [
    isCommunityRatingSaving,
    isCommunityReportSubmitting,
    isCommunityWorldDialogLoading,
    isCommunityWorldMyGamesSaving,
    isLaunchingCommunityWorld,
  ])

  const handleRateCommunityWorld = useCallback(async (ratingValue: number) => {
    if (!selectedCommunityWorld || ratingValue < 1 || ratingValue > 5 || isCommunityRatingSaving) {
      return
    }
    const worldId = selectedCommunityWorld.world.id
    const previousRating = selectedCommunityWorld.world.user_rating ?? 0
    const nextRating = previousRating === ratingValue ? 0 : ratingValue
    const nextUserRating = nextRating > 0 ? nextRating : null
    setCommunityRatingDraft(nextRating)
    setSelectedCommunityWorld((previous) =>
      previous && previous.world.id === worldId
        ? {
            ...previous,
            world: {
              ...previous.world,
              user_rating: nextUserRating,
            },
          }
        : previous,
    )
    setCommunityWorlds((previous) =>
      previous.map((world) => (world.id === worldId ? { ...world, user_rating: nextUserRating } : world)),
    )
    setIsCommunityRatingSaving(true)
    try {
      const updatedWorld = await rateCommunityWorld({
        token: authToken,
        worldId,
        rating: nextRating,
      })
      setSelectedCommunityWorld((previous) =>
        previous && previous.world.id === updatedWorld.id
          ? {
              ...previous,
              world: {
                ...previous.world,
                user_rating: updatedWorld.user_rating,
                is_reported_by_user: updatedWorld.is_reported_by_user,
                is_favorited_by_user: updatedWorld.is_favorited_by_user,
              },
            }
          : previous,
      )
      setCommunityWorlds((previous) =>
        previous.map((world) =>
          world.id === updatedWorld.id
            ? {
                ...world,
                user_rating: updatedWorld.user_rating,
                is_reported_by_user: updatedWorld.is_reported_by_user,
                is_favorited_by_user: updatedWorld.is_favorited_by_user,
              }
            : world,
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setCommunityWorldsError(detail)
      setCommunityRatingDraft(previousRating)
      setSelectedCommunityWorld((previous) =>
        previous && previous.world.id === worldId
          ? {
              ...previous,
              world: {
                ...previous.world,
                user_rating: previousRating > 0 ? previousRating : null,
              },
            }
          : previous,
      )
      setCommunityWorlds((previous) =>
        previous.map((world) =>
          world.id === worldId ? { ...world, user_rating: previousRating > 0 ? previousRating : null } : world,
        ),
      )
    } finally {
      setIsCommunityRatingSaving(false)
    }
  }, [authToken, isCommunityRatingSaving, selectedCommunityWorld])

  const handleReportCommunityWorld = useCallback(
    async (payload: { reason: StoryCommunityWorldReportReason; description: string }) => {
      if (!selectedCommunityWorld || isCommunityReportSubmitting) {
        return
      }
      setIsCommunityReportSubmitting(true)
      try {
        const updatedWorld = await reportCommunityWorld({
          token: authToken,
          worldId: selectedCommunityWorld.world.id,
          reason: payload.reason,
          description: payload.description,
        })
        setSelectedCommunityWorld((previous) => (previous ? { ...previous, world: updatedWorld } : previous))
        setCommunityWorlds((previous) => previous.map((world) => (world.id === updatedWorld.id ? updatedWorld : world)))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось отправить жалобу'
        setCommunityWorldsError(detail)
        throw error
      } finally {
        setIsCommunityReportSubmitting(false)
      }
    },
    [authToken, isCommunityReportSubmitting, selectedCommunityWorld],
  )

  const handleCreateCommunityWorldComment = useCallback(
    async (content: string) => {
      if (!selectedCommunityWorld) {
        return
      }
      const createdComment = await createCommunityWorldComment({
        token: authToken,
        worldId: selectedCommunityWorld.world.id,
        content,
      })
      setSelectedCommunityWorld((previous) =>
        previous && previous.world.id === createdComment.world_id
          ? {
              ...previous,
              comments: [...previous.comments, createdComment],
            }
          : previous,
      )
    },
    [authToken, selectedCommunityWorld],
  )

  const handleUpdateCommunityWorldComment = useCallback(
    async (commentId: number, content: string) => {
      if (!selectedCommunityWorld) {
        return
      }
      const updatedComment = await updateCommunityWorldComment({
        token: authToken,
        worldId: selectedCommunityWorld.world.id,
        commentId,
        content,
      })
      setSelectedCommunityWorld((previous) =>
        previous && previous.world.id === updatedComment.world_id
          ? {
              ...previous,
              comments: previous.comments.map((item) => (item.id === updatedComment.id ? updatedComment : item)),
            }
          : previous,
      )
    },
    [authToken, selectedCommunityWorld],
  )

  const handleDeleteCommunityWorldComment = useCallback(
    async (commentId: number) => {
      if (!selectedCommunityWorld) {
        return
      }
      const worldId = selectedCommunityWorld.world.id
      await deleteCommunityWorldComment({
        token: authToken,
        worldId,
        commentId,
      })
      setSelectedCommunityWorld((previous) =>
        previous && previous.world.id === worldId
          ? {
              ...previous,
              comments: previous.comments.filter((item) => item.id !== commentId),
            }
          : previous,
      )
    },
    [authToken, selectedCommunityWorld],
  )

  const handleToggleFavoriteWorld = useCallback(
    async (world: StoryCommunityWorldSummary) => {
      if (favoriteWorldActionById[world.id]) {
        return
      }

      setFavoriteWorldActionById((previous) => ({
        ...previous,
        [world.id]: true,
      }))
      setCommunityWorldsError('')
      try {
        const updatedWorld = world.is_favorited_by_user
          ? await unfavoriteCommunityWorld({
              token: authToken,
              worldId: world.id,
            })
          : await favoriteCommunityWorld({
              token: authToken,
              worldId: world.id,
            })

        setCommunityWorlds((previous) => previous.map((item) => (item.id === updatedWorld.id ? updatedWorld : item)))
        setSelectedCommunityWorld((previous) => (previous && previous.world.id === updatedWorld.id ? { ...previous, world: updatedWorld } : previous))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить любимые миры'
        setCommunityWorldsError(detail)
      } finally {
        setFavoriteWorldActionById((previous) => {
          const next = { ...previous }
          delete next[world.id]
          return next
        })
      }
    },
    [authToken, favoriteWorldActionById],
  )

  const handleLaunchCommunityWorld = useCallback(async () => {
    if (!selectedCommunityWorld || isLaunchingCommunityWorld) {
      return
    }
    const worldId = selectedCommunityWorld.world.id
    setIsLaunchingCommunityWorld(true)
    try {
      const game = await launchCommunityWorld({
        token: authToken,
        worldId,
      })
      setCommunityWorldGameIds((previous) => {
        const nextIds = [...new Set([...(previous[worldId] ?? []), game.id])]
        return {
          ...previous,
          [worldId]: nextIds,
        }
      })
      setStoryGames((previousGames) => sortStoryGamesByActivity([game, ...previousGames.filter((item) => item.id !== game.id)]))
      onNavigate(`/home/${game.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось запустить мир'
      setCommunityWorldsError(detail)
    } finally {
      setIsLaunchingCommunityWorld(false)
    }
  }, [authToken, isLaunchingCommunityWorld, onNavigate, selectedCommunityWorld])

  const handleToggleCommunityWorldInMyGames = useCallback(async () => {
    if (!selectedCommunityWorld || isCommunityWorldMyGamesSaving || isLaunchingCommunityWorld) {
      return
    }

    const worldId = selectedCommunityWorld.world.id
    setIsCommunityWorldMyGamesSaving(true)
    try {
      let gamesSnapshot = await listStoryGames(authToken, { compact: true })
      let gameMapSnapshot = buildCommunityWorldGameMap(gamesSnapshot)
      setStoryGames(gamesSnapshot)
      setCommunityWorldGameIds(gameMapSnapshot)
      hasLoadedCommunityWorldGameIdsRef.current = true

      const existingGameIds = gameMapSnapshot[worldId] ?? []
      if (existingGameIds.length > 0) {
        await Promise.all(
          existingGameIds.map((gameId) =>
            deleteStoryGame({
              token: authToken,
              gameId,
            }),
          ),
        )
        gamesSnapshot = gamesSnapshot.filter((game) => !existingGameIds.includes(game.id))
        gameMapSnapshot = buildCommunityWorldGameMap(gamesSnapshot)
        setStoryGames(gamesSnapshot)
        setCommunityWorldGameIds(gameMapSnapshot)
        return
      }

      const game = await launchCommunityWorld({
        token: authToken,
        worldId,
      })
      gamesSnapshot = sortStoryGamesByActivity([game, ...gamesSnapshot.filter((item) => item.id !== game.id)])
      gameMapSnapshot = buildCommunityWorldGameMap(gamesSnapshot)
      setStoryGames(gamesSnapshot)
      setCommunityWorldGameIds(gameMapSnapshot)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить список "Мои игры"'
      setCommunityWorldsError(detail)
    } finally {
      setIsCommunityWorldMyGamesSaving(false)
    }
  }, [authToken, isCommunityWorldMyGamesSaving, isLaunchingCommunityWorld, selectedCommunityWorld])

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить тарифы пополнения'
      setTopUpError(detail)
    } finally {
      setIsTopUpPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!topUpDialogOpen || hasTopUpPlansLoaded || isTopUpPlansLoading) {
      return
    }
    void loadTopUpPlans()
  }, [hasTopUpPlansLoaded, isTopUpPlansLoading, loadTopUpPlans, topUpDialogOpen])

  const syncPendingPayment = useCallback(
    async (paymentId: string) => {
      try {
        const response = await syncCoinTopUpPayment({
          token: authToken,
          payment_id: paymentId,
        })

        onUserUpdate(response.user)
        if (response.status === 'succeeded') {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
          setPaymentSuccessCoins(response.coins)
          return
        }

        if (FINAL_PAYMENT_STATUSES.has(response.status)) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to sync payment status'
        if (detail.includes('404')) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      }
    },
    [authToken, onUserUpdate],
  )

  useEffect(() => {
    const pendingPaymentId = localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY)
    if (!pendingPaymentId) {
      return
    }
    void syncPendingPayment(pendingPaymentId)
  }, [syncPendingPayment])

  const handlePurchasePlan = async (planId: string) => {
    setTopUpError('')
    setActivePlanPurchaseId(planId)
    try {
      const response = await createCoinTopUpPayment({
        token: authToken,
        plan_id: planId,
      })
      localStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, response.payment_id)
      window.location.assign(response.confirmation_url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать оплату'
      setTopUpError(detail)
      setActivePlanPurchaseId(null)
    }
  }

  const handleQuickStartStarted = useCallback(
    (game: StoryGameSummary) => {
      setIsQuickStartDialogOpen(false)
      setStoryGames((previousGames) => sortStoryGamesByActivity([game, ...previousGames.filter((item) => item.id !== game.id)]))
      onNavigate(`/home/${game.id}`)
    },
    [onNavigate],
  )

  const handleOpenDashboardNewsEditor = useCallback(() => {
    if (!selectedDashboardNews || !isDashboardNewsEditor) {
      return
    }
    setDashboardNewsEditorError('')
    setDashboardNewsDraft(createDashboardNewsDraft(selectedDashboardNews))
    setIsDashboardNewsEditorOpen(true)
  }, [isDashboardNewsEditor, selectedDashboardNews])

  const handleCloseDashboardNewsEditor = useCallback(() => {
    if (isDashboardNewsSaving) {
      return
    }
    setIsDashboardNewsEditorOpen(false)
    setDashboardNewsEditorError('')
  }, [isDashboardNewsSaving])

  const handleSaveDashboardNews = useCallback(async () => {
    if (!selectedDashboardNews || !isDashboardNewsEditor || isDashboardNewsSaving) {
      return
    }

    setDashboardNewsEditorError('')
    setIsDashboardNewsSaving(true)
    try {
      const updatedItem = await updateDashboardNews({
        token: authToken,
        news_id: selectedDashboardNews.id,
        category: dashboardNewsDraft.category,
        title: dashboardNewsDraft.title,
        description: dashboardNewsDraft.description,
        image_url: dashboardNewsDraft.image_url.trim() || null,
        date_label: dashboardNewsDraft.date_label,
      })
      setDashboardNews((previous) => previous.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
      setSelectedDashboardNewsId(updatedItem.id)
      setIsDashboardNewsEditorOpen(false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить новость'
      setDashboardNewsEditorError(detail)
    } finally {
      setIsDashboardNewsSaving(false)
    }
  }, [
    authToken,
    dashboardNewsDraft.category,
    dashboardNewsDraft.date_label,
    dashboardNewsDraft.description,
    dashboardNewsDraft.image_url,
    dashboardNewsDraft.title,
    isDashboardNewsEditor,
    isDashboardNewsSaving,
    selectedDashboardNews,
  ])

  useEffect(() => {
    if (dashboardNews.length === 0) {
      setSelectedDashboardNewsId(null)
      return
    }
    if (selectedDashboardNewsId !== null && dashboardNews.some((item) => item.id === selectedDashboardNewsId)) {
      return
    }
    setSelectedDashboardNewsId(dashboardNews[0].id)
  }, [dashboardNews, selectedDashboardNewsId])

  // Auto-advance news selection every 15 s; newsProgressKey acts as the reset trigger
  useEffect(() => {
    if (dashboardNews.length <= 1) {
      return
    }
    if (newsAutoAdvanceTimerRef.current !== null) {
      window.clearTimeout(newsAutoAdvanceTimerRef.current)
    }
    newsAutoAdvanceTimerRef.current = window.setTimeout(() => {
      setSelectedDashboardNewsId((prevId) => {
        const currentIndex = dashboardNews.findIndex((item) => item.id === prevId)
        const nextIndex = (currentIndex + 1) % dashboardNews.length
        return dashboardNews[nextIndex]?.id ?? prevId
      })
      setNewsProgressKey((k) => k + 1)
    }, 15000)
    return () => {
      if (newsAutoAdvanceTimerRef.current !== null) {
        window.clearTimeout(newsAutoAdvanceTimerRef.current)
        newsAutoAdvanceTimerRef.current = null
      }
    }
  }, [dashboardNews, newsProgressKey])

  const selectedCommunityWorldGameIds = selectedCommunityWorld
    ? communityWorldGameIds[selectedCommunityWorld.world.id] ?? []
    : []
  const isSelectedCommunityWorldInMyGames = selectedCommunityWorldGameIds.length > 0
  const profileName = user.display_name || 'Игрок'
  const communityWorldsPreview = communityWorlds.slice(0, HOME_COMMUNITY_WORLD_LIMIT)
  const dashboardLastPlayedGame = useMemo(() => selectLastPlayedGame(storyGames), [storyGames])
  const hasDashboardLastPlayedGame = dashboardLastPlayedGame !== null
  const dashboardHeroCoverUrl =
    hasDashboardLastPlayedGame && dashboardLastPlayedGame.cover_image_url
      ? dashboardLastPlayedGame.cover_image_url.trim()
      : ''
  const dashboardHeroCoverPositionX = hasDashboardLastPlayedGame
    ? clampCoverPosition(dashboardLastPlayedGame.cover_position_x)
    : 50
  const dashboardHeroCoverPositionY = hasDashboardLastPlayedGame
    ? clampCoverPosition(dashboardLastPlayedGame.cover_position_y)
    : 50
  const selectedDashboardNewsImage =
    selectedDashboardNews?.image_url?.trim() || getDashboardNewsFallbackImage(selectedDashboardNews?.slot ?? 1)

  useEffect(() => {
    rememberLastPlayedGameCard(dashboardLastPlayedGame)
  }, [dashboardLastPlayedGame])

  const handleDashboardContinue = useCallback(async () => {
    if (isDashboardDataLoading || isDashboardContinueResolving) {
      return
    }
    if (!dashboardLastPlayedGame) {
      onNavigate('/worlds/new')
      return
    }

    setIsDashboardContinueResolving(true)
    try {
      await getStoryGame({ token: authToken, gameId: dashboardLastPlayedGame.id })
      onNavigate(`/home/${dashboardLastPlayedGame.id}`)
      return
    } catch {
      try {
        const refreshedGames = await loadDashboardGamesSnapshot()
        const fallbackGame = selectLastPlayedGame(refreshedGames)
        if (fallbackGame) {
          onNavigate(`/home/${fallbackGame.id}`)
          return
        }
      } catch {
        // Ignore refresh errors and fallback to world creation.
      }
      onNavigate('/worlds/new')
    } finally {
      setIsDashboardContinueResolving(false)
    }
  }, [
    authToken,
    dashboardLastPlayedGame,
    isDashboardContinueResolving,
    isDashboardDataLoading,
    loadDashboardGamesSnapshot,
    onNavigate,
  ])
  const dashboardQuickActions = useMemo<DashboardQuickAction[]>(
    () => [
      {
        key: 'continue',
        title: 'Продолжить',
        description: hasDashboardLastPlayedGame
          ? buildDashboardGameDescription(dashboardLastPlayedGame!)
          : `Добро пожаловать, ${profileName}. Начните новую историю или быстро вернитесь в библиотеку миров.`,
        headline: hasDashboardLastPlayedGame ? buildDashboardGameHeadline(dashboardLastPlayedGame!) : undefined,
        imageSrc: dashboardHeroCoverUrl || undefined,
        imageMode: dashboardHeroCoverUrl ? 'cover' : 'contain',
        imagePosition: `${dashboardHeroCoverPositionX}% ${dashboardHeroCoverPositionY}%`,
        iconMarkup: dashboardContinueIconMarkup,
        onClick: () => void handleDashboardContinue(),
        disabled: false,
      },
      {
        key: 'quick-start',
        title: 'Быстрый старт',
        description: 'Выберите жанр, класс, имя героя и получите готовую стартовую сцену за пару шагов.',
        imageSrc: quickStartDashboardImage,
        iconMarkup: dashboardQuickStartIconMarkup,
        onClick: () => setIsQuickStartDialogOpen(true),
        disabled: false,
      },
      {
        key: 'new-world',
        title: 'Новый мир',
        description: 'Соберите сеттинг, правила и персонажей вручную с полной настройкой мира.',
        imageSrc: newWorldDashboardImage,
        iconMarkup: sidebarPlusIconMarkup,
        onClick: () => onNavigate('/worlds/new'),
        disabled: false,
      },
      {
        key: 'shop',
        title: 'Магазин',
        description: 'Пакеты солов и дополнительные возможности для длинных сессий и генерации.',
        imageSrc: shopDashboardImage,
        iconMarkup: sidebarVectorAltIconMarkup,
        onClick: handleOpenTopUpDialog,
        disabled: false,
      },
    ],
    [
      dashboardHeroCoverUrl,
      dashboardHeroCoverPositionX,
      dashboardHeroCoverPositionY,
      dashboardLastPlayedGame,
      handleDashboardContinue,
      handleOpenTopUpDialog,
      hasDashboardLastPlayedGame,
      isDashboardContinueResolving,
      onNavigate,
      profileName,
    ],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const requestedAction = params.get('mobileAction')
    if (!requestedAction || handledMobileActionRef.current === requestedAction) {
      return
    }

    const clearRequestedAction = () => {
      params.delete('mobileAction')
      const nextSearch = params.toString()
      const nextHref = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', nextHref)
    }

    if (requestedAction === 'quick-start') {
      handledMobileActionRef.current = requestedAction
      clearRequestedAction()
      setIsQuickStartDialogOpen(true)
      return
    }

    if (requestedAction === 'continue') {
      if (isDashboardDataLoading || isDashboardContinueResolving) {
        return
      }
      handledMobileActionRef.current = requestedAction
      clearRequestedAction()
      void handleDashboardContinue()
    }
  }, [handleDashboardContinue, isDashboardContinueResolving, isDashboardDataLoading])

  // ── News image crossfade ──────────────────────────────────────────────────
  // Keeps the old image visible until the new one finishes loading, then
  // fades in the new one on top — no blank frames.
  const [newsXfCurrentSrc, setNewsXfCurrentSrc] = useState(selectedDashboardNewsImage)
  const [newsXfNextSrc, setNewsXfNextSrc] = useState<string | undefined>(undefined)
  const [newsXfNextKey, setNewsXfNextKey] = useState(0)
  useEffect(() => {
    if (selectedDashboardNewsImage !== newsXfCurrentSrc) {
      setNewsXfNextSrc(selectedDashboardNewsImage)
      setNewsXfNextKey((k) => k + 1)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDashboardNewsImage])

  const handleNewsXfReady = useCallback((src: string) => {
    setNewsXfCurrentSrc(src)
    setNewsXfNextSrc(undefined)
  }, [])

  return (
    <Box
      className="morius-app-shell"
      sx={{
        minHeight: '100svh',
        color: APP_TEXT_PRIMARY,
        background: APP_PAGE_BACKGROUND,
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* Blurred hero background — fades into page background */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '100vh',
          zIndex: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          // CSS mask fades the entire layer to transparent at the bottom
          // This is theme-agnostic: whatever color is underneath shows through
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 45%, transparent 88%)',
          maskImage: 'linear-gradient(to bottom, black 0%, black 45%, transparent 88%)',
        }}
      >
        <Box
          component="img"
          src={tavernBgImage}
          alt=""
          fetchPriority="low"
          decoding="async"
          onLoad={() => setIsBgImageLoaded(true)}
          sx={{
            position: 'absolute',
            inset: '-8%',
            width: '116%',
            height: '116%',
            objectFit: 'cover',
            objectPosition: 'center 40%',
            filter: 'blur(56px) saturate(0.65) brightness(0.52)',
            opacity: isBgImageLoaded ? 1 : 0,
            transition: 'opacity 900ms ease',
          }}
        />
      </Box>

      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        mobileActionItems={dashboardQuickActions}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: true, onClick: () => onNavigate('/dashboard') },
          { key: 'games-all', label: 'Сообщество', onClick: () => onNavigate('/games/all') },
          { key: 'games-my', label: 'Библиотека', onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Публикации', onClick: () => onNavigate('/games/publications') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((previous) => !previous)}
        rightToggleLabels={{
          expanded: 'Скрыть кнопки шапки',
          collapsed: 'Показать кнопки шапки',
        }}
        onOpenSettingsDialog={() => setProfileDialogOpen(true)}
        onOpenTopUpDialog={handleOpenTopUpDialog}
        hideRightToggle
        rightActions={<HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} />}
      />

      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto' }}>
          <Stack alignItems="center" spacing={0.35} sx={{ mb: 'var(--morius-cards-title-gap)' }}>
            <Typography sx={{ fontSize: { xs: '2rem', md: '2.35rem' }, fontWeight: 900, color: APP_TEXT_PRIMARY, textAlign: 'center' }}>
              Главная
            </Typography>
          </Stack>

          <Box sx={{ display: 'grid', gap: 3.5, mb: 'var(--morius-cards-title-gap)' }}>
            {!isPhoneLayout ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                {dashboardQuickActions.map((action) => {
                  const isContinueCard = action.key === 'continue'
                  const hasContinueCover = action.imageMode === 'cover' && Boolean(action.imageSrc)
                  const isActionDisabled = Boolean(action.disabled) || (isContinueCard && isDashboardContinueResolving)

                  return (
                    <ButtonBase
                      key={action.key}
                      onClick={action.onClick}
                      disabled={isActionDisabled}
                      sx={{
                        position: 'relative',
                        overflow: 'hidden',
                        minHeight: 140,
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: APP_CARD_BACKGROUND,
                        justifyContent: 'flex-start',
                        alignItems: 'stretch',
                        textAlign: 'left',
                        boxShadow: 'none',
                        transition: 'transform 180ms ease, opacity 180ms ease, background-color 180ms ease',
                        '&:hover': {
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 86%, var(--morius-title-text) 14%)',
                          transform: isActionDisabled ? 'none' : 'translateY(-2px)',
                        },
                      }}
                    >
                      {hasContinueCover ? (
                        <>
                          <DeferredImage
                            src={action.imageSrc}
                            alt=""
                            rootMargin="0px"
                            objectFit="cover"
                            objectPosition={action.imagePosition ?? `${dashboardHeroCoverPositionX}% ${dashboardHeroCoverPositionY}%`}
                            imgSx={{ opacity: 0.82 }}
                          />
                          <Box
                            aria-hidden
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              background:
                                'linear-gradient(180deg, rgba(8, 12, 18, 0.54) 0%, rgba(8, 12, 18, 0.74) 52%, rgba(8, 12, 18, 0.9) 100%)',
                            }}
                          />
                        </>
                      ) : null}

                      {!isContinueCard && action.imageSrc ? (
                        <DeferredImage
                          src={action.imageSrc}
                          alt=""
                          rootMargin="0px"
                          objectFit="contain"
                          objectPosition="right bottom"
                          sx={{
                            inset: 'auto',
                            right: { xs: 0, md: 4 },
                            bottom: { xs: -4, md: -2 },
                            width: { xs: 114, md: 124 },
                            height: { xs: 114, md: 124 },
                          }}
                          imgSx={{ opacity: 1 }}
                        />
                      ) : null}

                      <Stack
                        spacing={0.8}
                        sx={{
                          position: 'relative',
                          zIndex: 1,
                          width: '100%',
                          minHeight: '100%',
                          p: 1.2,
                          justifyContent: 'space-between',
                        }}
                      >
                        <Stack spacing={0.8}>
                          <Stack spacing={action.headline ? 0.15 : 0.4}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Stack direction="row" alignItems="center" spacing={0.7} sx={{ minWidth: 0 }}>
                                <Box
                                  sx={{
                                    width: 26,
                                    height: 26,
                                    display: 'grid',
                                    placeItems: 'center',
                                    flexShrink: 0,
                                    color: APP_TEXT_PRIMARY,
                                  }}
                                >
                                  <ThemedSvgIcon markup={action.iconMarkup} size={18} />
                                </Box>
                                <Typography
                                  sx={{
                                    color: action.headline && hasContinueCover ? 'rgba(236, 243, 250, 0.82)' : APP_TEXT_PRIMARY,
                                    fontSize: action.headline ? '0.84rem' : '1.04rem',
                                    fontWeight: 900,
                                    lineHeight: 1.05,
                                  }}
                                >
                                  {action.title}
                                </Typography>
                              </Stack>
                            </Stack>

                            {action.headline ? (
                              <Typography
                                sx={{
                                  color: APP_TEXT_PRIMARY,
                                  fontSize: '1.18rem',
                                  fontWeight: 900,
                                  lineHeight: 1.08,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 1,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {action.headline}
                              </Typography>
                            ) : null}
                          </Stack>

                          <Typography
                            sx={{
                              color: hasContinueCover ? 'rgba(235, 242, 251, 0.9)' : APP_TEXT_SECONDARY,
                              fontSize: '0.9rem',
                              lineHeight: 1.45,
                              maxWidth: isContinueCard ? '100%' : '66%',
                              display: '-webkit-box',
                              WebkitLineClamp: action.headline ? 2 : 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {action.description}
                          </Typography>
                        </Stack>
                      </Stack>
                    </ButtonBase>
                  )
                })}
              </Box>
            ) : null}

            <Box
              sx={{
                display: 'grid',
                gap: 1.25,
                gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.7fr) minmax(310px, 1fr)' },
                minWidth: 0,
                maxWidth: '100%',
                '@media (max-width:699.95px)': {
                  display: 'none',
                },
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  minWidth: 0,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  minHeight: { xs: 520, sm: 430, md: 330 },
                  borderRadius: '20px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  background: APP_CARD_BACKGROUND,
                  boxShadow: '0 28px 44px rgba(0, 0, 0, 0.24)',
                }}
              >
                {isDashboardNewsLoading && dashboardNews.length === 0 ? (
                  <Stack spacing={1.2} sx={{ p: { xs: 1.5, md: 1.8 } }}>
                    <Skeleton variant="rectangular" height={190} sx={{ borderRadius: '16px', bgcolor: 'rgba(184, 201, 226, 0.14)' }} />
                    <Skeleton variant="text" width="22%" height={18} sx={{ bgcolor: 'rgba(184, 201, 226, 0.16)' }} />
                    <Skeleton variant="text" width="52%" height={42} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                    <Skeleton variant="text" width="94%" height={26} sx={{ bgcolor: 'rgba(184, 201, 226, 0.14)' }} />
                    <Skeleton variant="text" width="26%" height={18} sx={{ bgcolor: 'rgba(184, 201, 226, 0.14)' }} />
                  </Stack>
                ) : selectedDashboardNews ? (
                  <>
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'radial-gradient(circle at 18% 20%, rgba(88, 146, 233, 0.16), transparent 30%), linear-gradient(180deg, rgba(12, 16, 23, 0.94) 0%, rgba(9, 13, 19, 0.98) 100%)',
                      }}
                    />
                    {/* Current image — stays visible until next finishes loading */}
                    {newsXfCurrentSrc ? (
                      <Box
                        component="img"
                        src={newsXfCurrentSrc}
                        alt=""
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center',
                          opacity: 0.94,
                          pointerEvents: 'none',
                        }}
                      />
                    ) : null}
                    {/* Next image — fades in when loaded, then becomes current */}
                    {newsXfNextSrc ? (
                      <NewsXfLayer
                        key={newsXfNextKey}
                        src={newsXfNextSrc}
                        onReady={handleNewsXfReady}
                      />
                    ) : null}
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'linear-gradient(180deg, rgba(8, 12, 18, 0.18) 0%, rgba(8, 12, 18, 0.42) 36%, rgba(8, 12, 18, 0.92) 100%)',
                      }}
                    />
                    <Stack
                      spacing={1}
                      justifyContent="flex-end"
                      sx={{
                        position: 'relative',
                        zIndex: 1,
                        width: '100%',
                        minHeight: '100%',
                        p: { xs: 1.6, md: 1.9 },
                        '@media (max-width:569.95px)': {
                          justifyContent: 'flex-end',
                          p: 1.25,
                        },
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography sx={{ color: 'rgba(233, 240, 249, 0.78)', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                          {selectedDashboardNews.category}
                        </Typography>
                        <Typography sx={{ color: 'rgba(226, 235, 246, 0.68)', fontSize: '0.82rem' }}>
                          {selectedDashboardNews.date_label}
                        </Typography>
                      </Stack>
                      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: { xs: '1.8rem', md: '2.2rem' }, fontWeight: 900, lineHeight: 1.04, maxWidth: 640 }}>
                        {selectedDashboardNews.title}
                      </Typography>
                      <Typography
                        sx={{
                          color: 'rgba(232, 239, 248, 0.86)',
                          fontSize: { xs: '0.94rem', md: '1rem' },
                          lineHeight: 1.55,
                          maxWidth: 640,
                          whiteSpace: 'pre-line',
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {selectedDashboardNews.description}
                      </Typography>
                      {isDashboardNewsEditor ? (
                        <Box sx={{ pt: 0.35 }}>
                          <Button
                            onClick={handleOpenDashboardNewsEditor}
                            sx={{
                              minHeight: 38,
                              width: 'fit-content',
                              px: 1.2,
                              borderRadius: '12px',
                              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                              backgroundColor: 'rgba(10, 15, 22, 0.54)',
                              color: APP_TEXT_PRIMARY,
                              textTransform: 'none',
                              fontWeight: 700,
                              '&:hover': {
                                backgroundColor: 'rgba(14, 20, 28, 0.7)',
                              },
                            }}
                          >
                            Редактировать новость
                          </Button>
                        </Box>
                      ) : null}
                    </Stack>
                  </>
                ) : (
                  <Stack spacing={0.6} sx={{ p: 1.6 }}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.15rem', fontWeight: 800 }}>Новостей пока нет</Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY }}>
                      Как только появятся обновления, они будут показаны здесь.
                    </Typography>
                  </Stack>
                )}
              </Box>

              <Stack spacing={1.05} sx={{ minWidth: 0, maxWidth: '100%', height: '100%' }}>
                {dashboardNewsError ? (
                  <Alert severity="error" sx={{ borderRadius: '16px' }}>
                    {dashboardNewsError}
                  </Alert>
                ) : null}

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'row', xl: 'column' },
                    gap: 1.05,
                    flex: { xl: 1 },
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    height: { xl: 0, xs: 'auto' },
                    overflowX: { xs: 'auto', xl: 'visible' },
                    overflowY: 'visible',
                    pb: { xs: 0.2, xl: 0 },
                    pr: { xs: 0.2, xl: 0 },
                    scrollSnapType: { xs: 'x mandatory', xl: 'none' },
                    scrollPaddingInline: { xs: '1px', xl: 0 },
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': {
                      display: 'none',
                    },
                  }}
                >
                  {isDashboardNewsLoading && dashboardNews.length === 0
                    ? HOME_NEWS_SKELETON_KEYS.map((itemKey) => (
                        <Box
                          key={itemKey}
                          sx={{
                            width: { xs: '100%', xl: '100%' },
                            minWidth: { xs: '100%', xl: 0 },
                            maxWidth: { xs: '100%', xl: '100%' },
                            flex: { xs: '0 0 100%', xl: '0 0 auto' },
                            minHeight: 96,
                            borderRadius: '18px',
                            p: 1.25,
                            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                            background: APP_CARD_BACKGROUND,
                            scrollSnapAlign: 'start',
                            boxSizing: 'border-box',
                          }}
                        >
                          <Stack spacing={0.55}>
                            <Skeleton variant="text" width="34%" height={20} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                            <Skeleton variant="text" width="76%" height={28} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                            <Skeleton variant="text" width="90%" height={22} sx={{ bgcolor: 'rgba(184, 201, 226, 0.16)' }} />
                          </Stack>
                        </Box>
                      ))
                    : dashboardNews.map((item) => {
                        const isSelected = item.id === selectedDashboardNews?.id
                        return (
                          <ButtonBase
                            key={item.id}
                            onClick={() => {
                              setSelectedDashboardNewsId(item.id)
                              setNewsProgressKey((k) => k + 1)
                            }}
                            sx={{
                              position: 'relative',
                              overflow: 'hidden',
                              width: { xs: '100%', xl: '100%' },
                              minWidth: { xs: '100%', xl: 0 },
                              maxWidth: { xs: '100%', xl: '100%' },
                              flex: { xs: '0 0 100%', xl: 1 },
                              minHeight: { xs: 72, xl: 0 },
                              justifyContent: 'flex-start',
                              alignItems: 'stretch',
                              textAlign: 'left',
                              borderRadius: '10px',
                              p: 1.15,
                              scrollSnapAlign: 'start',
                              boxSizing: 'border-box',
                              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                              // Both states semi-transparent; selected more opaque
                              background: isSelected
                                ? 'color-mix(in srgb, var(--morius-card-bg) 80%, transparent)'
                                : 'color-mix(in srgb, var(--morius-card-bg) 45%, transparent)',
                              backdropFilter: 'blur(6px)',
                              transition: 'background 200ms ease',
                              '&:hover': {
                                background: 'color-mix(in srgb, var(--morius-card-bg) 80%, transparent)',
                              },
                            }}
                          >
                            <Stack spacing={0.35} sx={{ width: '100%' }}>
                              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                {item.category}
                              </Typography>
                              <Typography
                                sx={{
                                  color: APP_TEXT_PRIMARY,
                                  fontSize: '0.92rem',
                                  fontWeight: 800,
                                  lineHeight: 1.25,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {item.title}
                              </Typography>
                            </Stack>
                            {/* Auto-advance progress bar */}
                            {isSelected ? (
                              <Box
                                key={newsProgressKey}
                                aria-hidden
                                sx={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  height: '2px',
                                  background: 'var(--morius-accent)',
                                  opacity: 0.75,
                                  animation: 'morius-news-progress 15s linear forwards',
                                }}
                              />
                            ) : null}
                          </ButtonBase>
                        )
                      })}
                </Box>
              </Stack>
            </Box>
          </Box>

          {/* ── Миры (worlds slider) ────────────────────────────────────── */}
          <Box data-tour-id="home-community-section" sx={{ scrollMarginTop: '120px' }}>
            <HomeSliderHeader
              title="Миры"
              subtitle="Публичные миры игроков. Откройте карточку мира, оцените и запускайте в свои игры."
              onShowAll={() => onNavigate('/games/all?tab=worlds')}
            />
            {communityWorldsError ? (
              <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>{communityWorldsError}</Alert>
            ) : null}
            {/* Desktop slider */}
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <HomeCardSlider cardCount={communityWorldsPreview.length}>
                {isCommunityWorldsLoading && communityWorlds.length === 0
                  ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                      <SliderCard key={key}><CommunityWorldCardSkeleton showFavoriteButton /></SliderCard>
                    ))
                  : communityWorldsPreview.map((world) => (
                      <SliderCard key={world.id}>
                        <CommunityWorldCard
                          world={world}
                          onClick={() => void handleOpenCommunityWorld(world.id)}
                          onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                          disabled={isCommunityWorldDialogLoading}
                          showFavoriteButton
                          isFavoriteSaving={Boolean(favoriteWorldActionById[world.id])}
                          onToggleFavorite={(item) => void handleToggleFavoriteWorld(item)}
                        />
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
              {isCommunityWorldsLoading && communityWorlds.length === 0
                ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Skeleton key={key} variant="rectangular" height={MOBILE_CARD_HEIGHT} sx={{ borderRadius: 'var(--morius-radius)', bgcolor: 'rgba(184,201,226,0.12)', flexShrink: 0 }} />
                  ))
                : communityWorldsPreview.map((world) => (
                    <MobileCardItem
                      key={world.id}
                      imageUrl={resolveApiResourceUrl(world.cover_image_url)}
                      fallbackBackground={buildWorldFallbackArtwork(world.id) as Record<string, unknown>}
                      title={world.title}
                      description={world.description}
                      authorName={world.author_name.trim() || 'Неизвестный автор'}
                      authorAvatarUrl={world.author_avatar_url}
                      stat1={`${world.community_launches} ▶`}
                      stat2={`${world.community_rating_avg.toFixed(1)} ★`}
                      onClick={() => void handleOpenCommunityWorld(world.id)}
                    />
                  ))}
            </MobileCardSlider>
          </Box>

          {/* ── Персонажи (characters slider) ───────────────────────────── */}
          <Box sx={{ mt: 'var(--morius-cards-title-gap)' }}>
            <HomeSliderHeader
              title="Персонажи"
              subtitle="Публичные персонажи игроков"
              onShowAll={() => onNavigate('/games/all?tab=characters')}
            />
            {communityCharactersError ? (
              <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>{communityCharactersError}</Alert>
            ) : null}
            {/* Desktop slider */}
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <HomeCardSlider cardCount={communityCharacters.length}>
                {isCommunityCharactersLoading && communityCharacters.length === 0
                  ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                      <SliderCard key={key}>
                        <Skeleton variant="rectangular" sx={{ borderRadius: 'var(--morius-radius)', height: 300, bgcolor: 'rgba(184,201,226,0.12)' }} />
                      </SliderCard>
                    ))
                  : communityCharacters.map((item) => (
                      <SliderCard key={item.id}>
                        <HomeCharacterCard item={item} onClick={() => onNavigate('/games/all?tab=characters')} />
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
              {isCommunityCharactersLoading && communityCharacters.length === 0
                ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Skeleton key={key} variant="rectangular" height={MOBILE_CARD_HEIGHT} sx={{ borderRadius: 'var(--morius-radius)', bgcolor: 'rgba(184,201,226,0.12)', flexShrink: 0 }} />
                  ))
                : communityCharacters.map((item) => (
                    <MobileCardItem
                      key={item.id}
                      imageUrl={resolveApiResourceUrl(item.avatar_url)}
                      title={item.name}
                      description={item.description}
                      authorName={item.author_name.trim() || 'Неизвестный автор'}
                      authorAvatarUrl={item.author_avatar_url}
                      stat1={`+${item.community_additions_count}`}
                      stat2={`${item.community_rating_avg.toFixed(1)} ★`}
                      onClick={() => onNavigate('/games/all?tab=characters')}
                    />
                  ))}
            </MobileCardSlider>
          </Box>

          {/* ── Правила (rules slider) ───────────────────────────────────── */}
          <Box sx={{ mt: 'var(--morius-cards-title-gap)' }}>
            <HomeSliderHeader
              title="Правила"
              subtitle="Публичные правила игроков"
              onShowAll={() => onNavigate('/games/all?tab=rules')}
            />
            {communityRulesError ? (
              <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>{communityRulesError}</Alert>
            ) : null}
            {/* Desktop slider */}
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <HomeCardSlider cardCount={communityRules.length}>
                {isCommunityRulesLoading && communityRules.length === 0
                  ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                      <SliderCard key={key}>
                        <Skeleton variant="rectangular" sx={{ borderRadius: 'var(--morius-radius)', height: 300, bgcolor: 'rgba(184,201,226,0.12)' }} />
                      </SliderCard>
                    ))
                  : communityRules.map((item) => (
                      <SliderCard key={item.id}>
                        <HomeRuleCard item={item} onClick={() => onNavigate('/games/all?tab=rules')} />
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
              {isCommunityRulesLoading && communityRules.length === 0
                ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Skeleton key={key} variant="rectangular" height={MOBILE_CARD_HEIGHT} sx={{ borderRadius: 'var(--morius-radius)', bgcolor: 'rgba(184,201,226,0.12)', flexShrink: 0 }} />
                  ))
                : communityRules.map((item) => (
                    <MobileCardItem
                      key={item.id}
                      fallbackBackground={buildWorldFallbackArtwork(item.id + 100000) as Record<string, unknown>}
                      title={item.title}
                      description={item.content}
                      authorName={item.author_name.trim() || 'Неизвестный автор'}
                      authorAvatarUrl={item.author_avatar_url}
                      stat1={`+${item.community_additions_count}`}
                      stat2={`${item.community_rating_avg.toFixed(1)} ★`}
                      onClick={() => onNavigate('/games/all?tab=rules')}
                    />
                  ))}
            </MobileCardSlider>
          </Box>


        </Box>
      </Box>

      <QuickStartWizardDialog
        open={isQuickStartDialogOpen}
        authToken={authToken}
        onClose={() => setIsQuickStartDialogOpen(false)}
        onStarted={handleQuickStartStarted}
      />

      <BaseDialog
        open={isDashboardNewsEditorOpen}
        onClose={handleCloseDashboardNewsEditor}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        header={
          <Stack spacing={0.35}>
            <Typography sx={{ fontSize: '1.2rem', fontWeight: 900 }}>Редактировать новость</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Изменения увидят все игроки сразу после сохранения.
            </Typography>
          </Stack>
        }
        actions={
          <>
            <Button onClick={handleCloseDashboardNewsEditor} disabled={isDashboardNewsSaving} sx={{ color: APP_TEXT_SECONDARY }}>
              Отмена
            </Button>
            <Button
              onClick={() => void handleSaveDashboardNews()}
              disabled={isDashboardNewsSaving}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                px: 1.4,
                backgroundColor: 'var(--morius-button-active)',
                color: 'var(--morius-text-primary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
              }}
            >
              {isDashboardNewsSaving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <Stack spacing={1.1}>
          {dashboardNewsEditorError ? <Alert severity="error">{dashboardNewsEditorError}</Alert> : null}
          <TextField
            label="Категория"
            value={dashboardNewsDraft.category}
            onChange={(event) => setDashboardNewsDraft((previous) => ({ ...previous, category: event.target.value }))}
            fullWidth
          />
          <TextField
            label="Заголовок"
            value={dashboardNewsDraft.title}
            onChange={(event) => setDashboardNewsDraft((previous) => ({ ...previous, title: event.target.value }))}
            fullWidth
          />
          <TextField
            label="Дата"
            value={dashboardNewsDraft.date_label}
            onChange={(event) => setDashboardNewsDraft((previous) => ({ ...previous, date_label: event.target.value }))}
            fullWidth
          />
          <TextField
            label="URL изображения"
            value={dashboardNewsDraft.image_url}
            onChange={(event) => setDashboardNewsDraft((previous) => ({ ...previous, image_url: event.target.value }))}
            fullWidth
          />
          <TextField
            label="Текст"
            value={dashboardNewsDraft.description}
            onChange={(event) => setDashboardNewsDraft((previous) => ({ ...previous, description: event.target.value }))}
            fullWidth
            multiline
            minRows={5}
          />
        </Stack>
      </BaseDialog>

      <CommunityWorldDialog
        open={Boolean(selectedCommunityWorld) || isCommunityWorldDialogLoading}
        isLoading={isCommunityWorldDialogLoading}
        worldPayload={selectedCommunityWorld}
        currentUserId={user.id}
        ratingDraft={communityRatingDraft}
        isRatingSaving={isCommunityRatingSaving}
        isLaunching={isLaunchingCommunityWorld}
        isInMyGames={isSelectedCommunityWorldInMyGames}
        isMyGamesToggleSaving={isCommunityWorldMyGamesSaving}
        onClose={handleCloseCommunityWorldDialog}
        onPlay={() => void handleLaunchCommunityWorld()}
        onRate={(value) => void handleRateCommunityWorld(value)}
        onToggleMyGames={() => void handleToggleCommunityWorldInMyGames()}
        onAuthorClick={(authorId) => {
          setSelectedCommunityWorld(null)
          onNavigate(`/profile/${authorId}`)
        }}
        onSubmitReport={(payload) => handleReportCommunityWorld(payload)}
        onCreateComment={(content) => handleCreateCommunityWorldComment(content)}
        onUpdateComment={(commentId, content) => handleUpdateCommunityWorldComment(commentId, content)}
        onDeleteComment={(commentId) => handleDeleteCommunityWorldComment(commentId)}
        isReportSubmitting={isCommunityReportSubmitting}
      />
      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
        onNavigate={onNavigate}
        profileName={profileName}
        avatarInputRef={avatarInputRef}
        avatarError={avatarError}
        isAvatarSaving={isAvatarSaving}
        transitionComponent={DialogTransition}
        onClose={handleCloseProfileDialog}
        onChooseAvatar={handleChooseAvatar}
        onAvatarChange={handleAvatarChange}
        onOpenTopUp={handleOpenTopUpDialog}
        onOpenCharacterManager={handleOpenCharacterManager}
        onOpenInstructionTemplates={handleOpenInstructionTemplateDialog}
        onRequestLogout={() => setConfirmLogoutOpen(true)}
        onUpdateProfileName={handleUpdateProfileName}
        onUserUpdate={onUserUpdate}
      />

      <TopUpDialog
        open={topUpDialogOpen}
        topUpError={topUpError}
        isTopUpPlansLoading={isTopUpPlansLoading}
        topUpPlans={topUpPlans}
        activePlanPurchaseId={activePlanPurchaseId}
        transitionComponent={DialogTransition}
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={(planId) => void handlePurchasePlan(planId)}
      />

      <ConfirmLogoutDialog
        open={confirmLogoutOpen}
        transitionComponent={DialogTransition}
        onClose={() => setConfirmLogoutOpen(false)}
        onConfirm={handleConfirmLogout}
      />

      <AvatarCropDialog
        open={Boolean(avatarCropSource)}
        imageSrc={avatarCropSource}
        isSaving={isAvatarSaving}
        onCancel={() => {
          if (!isAvatarSaving) {
            setAvatarCropSource(null)
          }
        }}
        onSave={(croppedDataUrl) => void handleSaveCroppedAvatar(croppedDataUrl)}
      />

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        transitionComponent={DialogTransition}
        onClose={() => setPaymentSuccessCoins(null)}
      />

      <CharacterManagerDialog
        open={characterManagerOpen}
        authToken={authToken}
        showEmotionTools={user.role === 'administrator'}
        onClose={() => setCharacterManagerOpen(false)}
      />

      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode="manage"
        onClose={() => setInstructionTemplateDialogOpen(false)}
      />

      <Footer
        socialLinks={[
          { label: 'Вконтакте', href: 'https://vk.com/moriusai', external: true },
          { label: 'Телега', href: 'https://t.me/+t2ueY4x_KvE4ZWEy', external: true },
        ]}
        infoLinks={[
          { label: 'Политика конфиденциальности', path: '/privacy-policy' },
          { label: 'Пользовательское соглашение', path: '/terms-of-service' },
        ]}
        onNavigate={onNavigate}
      />
    </Box>
  )
}

function buildCommunityWorldGameMap(games: StoryGameSummary[]): Record<number, number[]> {
  const nextMap: Record<number, number[]> = {}
  games.forEach((game) => {
    if (!game.source_world_id || game.source_world_id <= 0) {
      return
    }
    const worldId = game.source_world_id
    const currentIds = nextMap[worldId] ?? []
    currentIds.push(game.id)
    nextMap[worldId] = currentIds
  })
  return nextMap
}

function parseStoryGameTimestamp(rawValue: string): number {
  const parsed = Date.parse(rawValue)
  return Number.isFinite(parsed) ? parsed : 0
}

function getStoryGameActivityTimestamp(game: StoryGameSummary): number {
  return Math.max(
    parseStoryGameTimestamp(game.last_activity_at),
    parseStoryGameTimestamp(game.updated_at),
    parseStoryGameTimestamp(game.created_at),
  )
}

function sortStoryGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort((left, right) => getStoryGameActivityTimestamp(right) - getStoryGameActivityTimestamp(left))
}

function selectLastPlayedGame(games: StoryGameSummary[]): StoryGameSummary | null {
  if (games.length === 0) {
    return null
  }
  const sortedGames = sortStoryGamesByActivity(games)
  return sortedGames[0] ?? null
}

function clampCoverPosition(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return 50
  }
  return Math.max(0, Math.min(rawValue, 100))
}

function buildDashboardGameHeadline(game: StoryGameSummary): string {
  const normalizedTitle = game.title.replace(/\s+/g, ' ').trim()
  if (normalizedTitle) {
    return normalizedTitle
  }
  return `Игра #${game.id}`
}

function buildDashboardGameDescription(game: StoryGameSummary): string {
  const descriptionSource = (game.description || game.latest_message_preview || game.opening_scene || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!descriptionSource) {
    return 'Продолжите историю с последнего хода.'
  }
  return descriptionSource
}

export default AuthenticatedHomePage


