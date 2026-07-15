import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type Ref,
  type TouchEvent as ReactTouchEvent,
  type UIEvent,
} from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grow,
  IconButton,
  MenuItem,
  Stack,
  SvgIcon,
  TextField,
  Typography,
  type GrowProps,
} from '@mui/material'
import dashboardContinueIconMarkup from '../assets/icons/dashboard-continue.svg?raw'
import dashboardQuickStartIconMarkup from '../assets/icons/dashboard-quick-start.svg?raw'
import sidebarPlusIconMarkup from '../assets/icons/custom/plus.svg?raw'
import sidebarVectorAltIconMarkup from '../assets/icons/custom/vector-1.svg?raw'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import ImageCropper from '../components/ImageCropper'
import quickStartDashboardImage from '../assets/images/dashboard/quick-start.png'
import newWorldDashboardImage from '../assets/images/dashboard/new-world.png'
import shopDashboardImage from '../assets/images/dashboard/shop.png'
import cardsCharactersIconMarkup from '../assets/icons/cards-characters.svg?raw'
import cardsRulesIconMarkup from '../assets/icons/cards-rules.svg?raw'
import communityPlayIconMarkup from '../assets/icons/community-play.svg?raw'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityCharacterCard from '../components/characters/CommunityCharacterCard'
import CommunityRuleCard from '../components/community/CommunityRuleCard'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import {
  CommunityModerationCardFrame,
  CommunityModerationMenu,
  canModerateCommunityContent,
  type CommunityModerationTarget,
} from '../components/community/CommunityModerationActions'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import QuickStartWizardDialog from '../components/home/QuickStartWizardDialog'
import {
  CreatorRewardPromoBanner,
  CreatorRewardPromoDialog,
  hasSeenCreatorRewardPromo,
  markCreatorRewardPromoSeen,
} from '../components/home/CreatorRewardPromo'
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
  createPublicationEncouragement,
  getCoinTopUpPlans,
  getCreatorMonthSlots,
  listCreatorCandidates,
  listDashboardNews,
  returnCharacterToModerationAsAdmin,
  returnInstructionTemplateToModerationAsAdmin,
  returnWorldToModerationAsAdmin,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  updateDashboardNews,
  updateCreatorMonthSlot,
  type CoinTopUpPlan,
  type CreatorCandidate,
  type CreatorMonthList,
  type CreatorMonthSlot,
  type DashboardNewsCard,
} from '../services/authApi'
import {
  addCommunityCharacter,
  addCommunityInstructionTemplate,
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
import { getProfileBannerPreset } from '../constants/profileBanners'
import { resolveProfileBannerImageUrl } from '../utils/cosmeticImageFallbacks'

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

type CreatorCandidateSort = 'rating_desc' | 'publications_desc' | 'worlds_desc' | 'characters_desc' | 'instructions_desc' | 'newest'

const CREATOR_CANDIDATE_PAGE_SIZE = 30
const CREATOR_CANDIDATE_SORT_OPTIONS: Array<{ value: CreatorCandidateSort; label: string }> = [
  { value: 'rating_desc', label: 'Рейтинг' },
  { value: 'publications_desc', label: 'Публикации' },
  { value: 'worlds_desc', label: 'Игры' },
  { value: 'characters_desc', label: 'Персонажи' },
  { value: 'instructions_desc', label: 'Инструкции' },
  { value: 'newest', label: 'Новые' },
]

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
        objectPosition: '72% 28%',
        opacity: loaded ? 0.94 : 0,
        transition: 'opacity 600ms ease',
        pointerEvents: 'none',
      }}
    />
  )
}

function NewsBlurBackgroundXfLayer({ src, onReady }: { src: string; onReady: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false)
  const calledRef = useRef(false)

  const handleLoad = () => {
    setLoaded(true)
    window.setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true
        onReady(src)
      }
    }, 720)
  }

  const handleError = () => {
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
        top: -100,
        left: '-12%',
        right: '-12%',
        width: '124%',
        height: 920,
        objectFit: 'cover',
        objectPosition: '50% 22%',
        filter: 'blur(115px) saturate(1.45)',
        transform: 'scale(1.08)',
        opacity: loaded ? 0.6 : 0,
        transition: 'opacity 900ms ease',
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
const HOME_ENTITY_DIALOG_PAPER_SX = {
  borderRadius: 'var(--morius-radius)',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  background: APP_CARD_BACKGROUND,
  color: APP_TEXT_PRIMARY,
  boxShadow: '0 26px 64px rgba(0,0,0,0.58)',
}
const HOME_ENTITY_DIALOG_BUTTON_SX = {
  minHeight: 40,
  borderRadius: '12px',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  textTransform: 'none',
  fontWeight: 800,
}
const CREATOR_DIALOG_PAPER_SX = {
  borderRadius: '18px',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  background: 'color-mix(in srgb, var(--morius-card-bg) 94%, #101821)',
  color: APP_TEXT_PRIMARY,
  boxShadow: '0 30px 76px rgba(0,0,0,0.62)',
}
const CREATOR_DIALOG_BUTTON_SX = {
  minHeight: 40,
  borderRadius: '12px',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  textTransform: 'none',
  fontWeight: 850,
  px: 2.2,
}
const HOME_NEWS_SKELETON_KEYS = Array.from({ length: 3 }, (_, index) => `home-news-skeleton-${index}`)
const HOME_COMMUNITY_SKELETON_CARD_KEYS = Array.from({ length: 4 }, (_, index) => `home-community-skeleton-${index}`)
const HOME_COMMUNITY_WORLD_LIMIT = 12

/** Section header with title, subtitle, and "Показать все" button */
function HomeSliderHeader({
  title,
  subtitle,
  iconMarkup,
  onShowAll,
}: {
  title: string
  subtitle: string
  iconMarkup: string
  onShowAll: () => void
}) {
  return (
    <Stack sx={{ mb: 2, mt: 'var(--morius-cards-title-gap)' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1.2}>
        <Stack direction="row" alignItems="center" spacing={0.85} sx={{ minWidth: 0 }}>
          <ThemedSvgIcon
            markup={iconMarkup}
            size={24}
            sx={{ color: 'var(--morius-accent)', flexShrink: 0, opacity: 0.96 }}
          />
          <Stack spacing={0.1} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontFamily: '"Spectral", serif', fontSize: { xs: '1.45rem', md: '26px' }, fontWeight: 700, color: 'var(--morius-title-text)', lineHeight: 1.1 }}>
              {title}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.94rem', lineHeight: 1.4 }}>
              {subtitle}
            </Typography>
          </Stack>
        </Stack>
        <Button
          onClick={onShowAll}
          sx={{
            minHeight: 34,
            px: 1.35,
            py: 0.45,
            flexShrink: 0,
            borderRadius: '999px',
            textTransform: 'none',
            fontWeight: 800,
            fontSize: { xs: '0.82rem', md: '0.86rem' },
            gap: 0.55,
            border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            color: 'var(--morius-text-primary)',
            '&:hover': { borderColor: 'var(--morius-hover-border)', backgroundColor: 'rgba(255,255,255,0.06)' },
            '&:active': { backgroundColor: APP_BUTTON_ACTIVE },
          }}
        >
          Показать все
          <SvgIcon sx={{ width: 16, height: 16 }}>
            <path d="M8.7 5.3 12.4 9l-3.7 3.7-1.1-1.1L9.4 9 7.6 6.4l1.1-1.1Z" fill="currentColor" />
          </SvgIcon>
        </Button>
      </Stack>
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
          gap: '18px',
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
        xs: 'calc(50% - 9px)',
        sm: 'calc(33.333% - 12px)',
        md: 'calc(25% - 13.5px)',
      },
      minWidth: {
        xs: 'calc(50% - 9px)',
        sm: 'calc(33.333% - 12px)',
        md: 'calc(25% - 13.5px)',
      },
    }}>
      {children}
    </Box>
  )
}

const MOBILE_CARD_HEIGHT = 130

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const DASHBOARD_NEWS_IMAGE_MAX_BYTES = 8 * 1024 * 1024
const DASHBOARD_NEWS_IMAGE_ASPECT = 2.1
const DASHBOARD_NEWS_IMAGE_OUTPUT_WIDTH = 1600
const DASHBOARD_NEWS_IMAGE_OUTPUT_HEIGHT = Math.round(DASHBOARD_NEWS_IMAGE_OUTPUT_WIDTH / DASHBOARD_NEWS_IMAGE_ASPECT)
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

function getDashboardNewsAmbientGradient(slot: number): string {
  if (slot === 2) {
    return 'radial-gradient(135% 78% at 50% -10%, rgba(60,68,112,0.34), rgba(72,42,98,0.15) 42%, transparent 72%)'
  }
  if (slot === 3) {
    return 'radial-gradient(135% 78% at 50% -10%, rgba(118,82,40,0.28), rgba(95,52,44,0.14) 42%, transparent 72%)'
  }
  return 'radial-gradient(135% 78% at 50% -10%, rgba(156,34,48,0.34), rgba(112,38,82,0.15) 42%, transparent 72%)'
}

function formatCreatorRating(value: number, count: number): string {
  if (!Number.isFinite(value) || count <= 0) {
    return '0'
  }
  return `${value.toFixed(1)} (${count})`
}

function formatCreatorMonthLabel(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  const parsedDate = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }
  const label = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsedDate)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function normalizeCreatorDateInput(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  return value.slice(0, 10)
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
  const [paymentReferralBonusCoins, setPaymentReferralBonusCoins] = useState(0)
  const [dashboardNews, setDashboardNews] = useState<DashboardNewsCard[]>([])
  const [selectedDashboardNewsId, setSelectedDashboardNewsId] = useState<number | null>(null)
  const [isDashboardNewsLoading, setIsDashboardNewsLoading] = useState(false)
  const [dashboardNewsError, setDashboardNewsError] = useState('')
  const [isDashboardNewsEditorOpen, setIsDashboardNewsEditorOpen] = useState(false)
  const [isDashboardNewsCloseConfirmOpen, setIsDashboardNewsCloseConfirmOpen] = useState(false)
  const [isDashboardNewsSaving, setIsDashboardNewsSaving] = useState(false)
  const [dashboardNewsEditorError, setDashboardNewsEditorError] = useState('')
  const [dashboardNewsDraft, setDashboardNewsDraft] = useState<DashboardNewsDraft>(createDashboardNewsDraft(null))
  const [dashboardNewsEditingId, setDashboardNewsEditingId] = useState<number | null>(null)
  const [dashboardNewsImageCropSource, setDashboardNewsImageCropSource] = useState<string | null>(null)
  const [dashboardNewsDialogItemId, setDashboardNewsDialogItemId] = useState<number | null>(null)
  const [creatorMonth, setCreatorMonth] = useState<CreatorMonthList | null>(null)
  const [isCreatorMonthLoading, setIsCreatorMonthLoading] = useState(false)
  const [creatorMonthError, setCreatorMonthError] = useState('')
  const [creatorDialogSlot, setCreatorDialogSlot] = useState<CreatorMonthSlot | null>(null)
  const [creatorCandidates, setCreatorCandidates] = useState<CreatorCandidate[]>([])
  const [creatorQuery, setCreatorQuery] = useState('')
  const [creatorPeriodStart, setCreatorPeriodStart] = useState('')
  const [creatorPeriodEnd, setCreatorPeriodEnd] = useState('')
  const [creatorCandidateSort, setCreatorCandidateSort] = useState<CreatorCandidateSort>('rating_desc')
  const [creatorOnlyWithPublications, setCreatorOnlyWithPublications] = useState(false)
  const [creatorOnlyWithRatings, setCreatorOnlyWithRatings] = useState(false)
  const [creatorCandidateTotal, setCreatorCandidateTotal] = useState(0)
  const [creatorCandidateHasMore, setCreatorCandidateHasMore] = useState(false)
  const [isCreatorCandidatesLoading, setIsCreatorCandidatesLoading] = useState(false)
  const [isCreatorSlotSaving, setIsCreatorSlotSaving] = useState(false)
  const [isQuickStartDialogOpen, setIsQuickStartDialogOpen] = useState(false)
  const [isCreatorRewardPromoOpen, setIsCreatorRewardPromoOpen] = useState(() => !hasSeenCreatorRewardPromo())
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
  const [selectedHomeCommunityCharacter, setSelectedHomeCommunityCharacter] = useState<StoryCommunityCharacterSummary | null>(null)
  const [isHomeCommunityCharacterAddSaving, setIsHomeCommunityCharacterAddSaving] = useState(false)
  const [communityRules, setCommunityRules] = useState<StoryCommunityInstructionTemplateSummary[]>([])
  const [isCommunityRulesLoading, setIsCommunityRulesLoading] = useState(false)
  const [communityRulesError, setCommunityRulesError] = useState('')
  const [selectedHomeCommunityRule, setSelectedHomeCommunityRule] = useState<StoryCommunityInstructionTemplateSummary | null>(null)
  const [isHomeCommunityRuleAddSaving, setIsHomeCommunityRuleAddSaving] = useState(false)
  const [homeCommunityActionError, setHomeCommunityActionError] = useState('')
  const [communityModerationAnchorEl, setCommunityModerationAnchorEl] = useState<HTMLElement | null>(null)
  const [communityModerationTarget, setCommunityModerationTarget] = useState<CommunityModerationTarget | null>(null)
  const [isCommunityModerationSaving, setIsCommunityModerationSaving] = useState(false)
  const [storyGames, setStoryGames] = useState<StoryGameSummary[]>([])
  const [isDashboardDataLoading, setIsDashboardDataLoading] = useState(true)
  const [isDashboardContinueResolving, setIsDashboardContinueResolving] = useState(false)
  const [communityWorldGameIds, setCommunityWorldGameIds] = useState<Record<number, number[]>>({})
  const [isCommunityWorldMyGamesSaving, setIsCommunityWorldMyGamesSaving] = useState(false)
  const [newsProgressKey, setNewsProgressKey] = useState(0)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const dashboardNewsImageInputRef = useRef<HTMLInputElement | null>(null)
  const hasLoadedCommunityWorldGameIdsRef = useRef(false)
  const handledMobileActionRef = useRef<string | null>(null)
  const newsAutoAdvanceTimerRef = useRef<number | null>(null)
  const dashboardNewsTouchStartRef = useRef<{ x: number; y: number } | null>(null)
  const dashboardNewsSwipeSuppressClickRef = useRef(false)
  const creatorCandidatesScrollRef = useRef<HTMLDivElement | null>(null)
  const isCreatorCandidatesLoadingRef = useRef(false)
  const creatorCandidatesRequestIdRef = useRef(0)
  const isCreatorMonthEditor = user.role === 'administrator' || user.role === 'moderator'

  const loadCreatorMonth = useCallback(() => {
    setIsCreatorMonthLoading(true)
    setCreatorMonthError('')
    void getCreatorMonthSlots({ token: authToken })
      .then((response) => setCreatorMonth(response))
      .catch((requestError) => {
        setCreatorMonthError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить креаторов месяца')
      })
      .finally(() => setIsCreatorMonthLoading(false))
  }, [authToken])

  useEffect(() => {
    loadCreatorMonth()
  }, [loadCreatorMonth])

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
    onNavigate('/shop')
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
  const creatorMonthSlots = useMemo(() => {
    const bySlot = new Map((creatorMonth?.slots ?? []).map((item) => [item.slot, item]))
    return [1, 2, 3].map((slot) => bySlot.get(slot) ?? {
      slot,
      user: null,
      stats: {
        worlds_count: 0,
        characters_count: 0,
        instruction_templates_count: 0,
        publications_count: 0,
        average_rating: 0,
        rating_count: 0,
      },
      period_start: creatorMonth?.period_start ?? null,
      period_end: creatorMonth?.period_end ?? null,
    })
  }, [creatorMonth])
  const selectedDashboardNews = useMemo(
    () => dashboardNews.find((item) => item.id === selectedDashboardNewsId) ?? dashboardNews[0] ?? null,
    [dashboardNews, selectedDashboardNewsId],
  )
  const dashboardNewsDialogItem = useMemo(
    () => dashboardNews.find((item) => item.id === dashboardNewsDialogItemId) ?? null,
    [dashboardNews, dashboardNewsDialogItemId],
  )
  const dashboardNewsEditingItem = useMemo(
    () => dashboardNews.find((item) => item.id === dashboardNewsEditingId) ?? null,
    [dashboardNews, dashboardNewsEditingId],
  )
  const dashboardNewsOriginalDraft = useMemo(
    () => createDashboardNewsDraft(dashboardNewsEditingItem),
    [dashboardNewsEditingItem],
  )
  const hasDashboardNewsDraftChanges =
    dashboardNewsDraft.category !== dashboardNewsOriginalDraft.category ||
    dashboardNewsDraft.title !== dashboardNewsOriginalDraft.title ||
    dashboardNewsDraft.description !== dashboardNewsOriginalDraft.description ||
    dashboardNewsDraft.image_url !== dashboardNewsOriginalDraft.image_url ||
    dashboardNewsDraft.date_label !== dashboardNewsOriginalDraft.date_label
  const dashboardNewsEditorPreviewImage =
    dashboardNewsDraft.image_url.trim() ||
    getDashboardNewsFallbackImage(dashboardNewsEditingItem?.slot ?? selectedDashboardNews?.slot ?? 1)

  const loadCreatorCandidates = useCallback((nextOffset = 0) => {
    const isReset = nextOffset <= 0
    if (isCreatorCandidatesLoadingRef.current && !isReset) {
      return
    }
    const requestId = creatorCandidatesRequestIdRef.current + 1
    creatorCandidatesRequestIdRef.current = requestId
    isCreatorCandidatesLoadingRef.current = true
    setIsCreatorCandidatesLoading(true)
    setCreatorMonthError('')
    void listCreatorCandidates({
      token: authToken,
      query: creatorQuery,
      period_start: creatorPeriodStart || null,
      period_end: creatorPeriodEnd || null,
      sort: creatorCandidateSort,
      offset: nextOffset,
      limit: CREATOR_CANDIDATE_PAGE_SIZE,
      has_publications: creatorOnlyWithPublications,
      has_ratings: creatorOnlyWithRatings,
    })
      .then((response) => {
        if (creatorCandidatesRequestIdRef.current !== requestId) {
          return
        }
        setCreatorCandidateTotal(response.total)
        setCreatorCandidateHasMore(response.has_more)
        setCreatorCandidates((previous) => {
          if (isReset) {
            return response.items
          }
          const byUserId = new Map(previous.map((item) => [item.user.id, item]))
          response.items.forEach((item) => byUserId.set(item.user.id, item))
          return Array.from(byUserId.values())
        })
      })
      .catch((requestError) => {
        if (creatorCandidatesRequestIdRef.current !== requestId) {
          return
        }
        setCreatorMonthError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить кандидатов')
        if (isReset) {
          setCreatorCandidates([])
          setCreatorCandidateTotal(0)
          setCreatorCandidateHasMore(false)
        }
      })
      .finally(() => {
        if (creatorCandidatesRequestIdRef.current === requestId) {
          isCreatorCandidatesLoadingRef.current = false
          setIsCreatorCandidatesLoading(false)
        }
      })
  }, [
    authToken,
    creatorCandidateSort,
    creatorOnlyWithPublications,
    creatorOnlyWithRatings,
    creatorPeriodEnd,
    creatorPeriodStart,
    creatorQuery,
  ])

  const handleOpenCreatorDialog = useCallback((slot: CreatorMonthSlot) => {
    if (!isCreatorMonthEditor) {
      if (slot.user) {
        onNavigate(`/profile/${slot.user.id}`)
      }
      return
    }
    setCreatorDialogSlot(slot)
    setCreatorQuery('')
    setCreatorPeriodStart(normalizeCreatorDateInput(slot.period_start ?? creatorMonth?.period_start))
    setCreatorPeriodEnd(normalizeCreatorDateInput(slot.period_end ?? creatorMonth?.period_end))
    setCreatorCandidateSort('rating_desc')
    setCreatorOnlyWithPublications(false)
    setCreatorOnlyWithRatings(false)
    setCreatorCandidateTotal(0)
    setCreatorCandidateHasMore(false)
    setCreatorCandidates([])
    window.setTimeout(() => {
      creatorCandidatesScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }, 0)
  }, [creatorMonth?.period_end, creatorMonth?.period_start, isCreatorMonthEditor, onNavigate])

  useEffect(() => {
    if (!creatorDialogSlot) {
      return
    }
    const timerId = window.setTimeout(() => {
      setCreatorCandidates([])
      setCreatorCandidateTotal(0)
      setCreatorCandidateHasMore(false)
      creatorCandidatesScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      loadCreatorCandidates(0)
    }, 220)
    return () => window.clearTimeout(timerId)
  }, [creatorDialogSlot, loadCreatorCandidates])

  const handleCreatorCandidatesScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    if (!creatorCandidateHasMore || isCreatorCandidatesLoading) {
      return
    }
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remaining <= 140) {
      loadCreatorCandidates(creatorCandidates.length)
    }
  }, [creatorCandidateHasMore, creatorCandidates.length, isCreatorCandidatesLoading, loadCreatorCandidates])

  const handleAssignCreatorSlot = useCallback(async (candidate: CreatorCandidate | null) => {
    if (!creatorDialogSlot || isCreatorSlotSaving) {
      return
    }
    setIsCreatorSlotSaving(true)
    setCreatorMonthError('')
    try {
      const updatedSlot = await updateCreatorMonthSlot({
        token: authToken,
        slot: creatorDialogSlot.slot,
        user_id: candidate?.user.id ?? null,
        period_start: creatorPeriodStart || null,
        period_end: creatorPeriodEnd || null,
      })
      setCreatorMonth((previous) => {
        const current = previous ?? {
          slots: [],
          period_start: creatorPeriodStart,
          period_end: creatorPeriodEnd,
        }
        const nextSlots = [1, 2, 3].map((slot) => {
          const existing = current.slots.find((item) => item.slot === slot)
          return slot === updatedSlot.slot ? updatedSlot : existing
        }).filter((item): item is CreatorMonthSlot => Boolean(item))
        return { ...current, slots: nextSlots }
      })
      setCreatorDialogSlot(null)
    } catch (requestError) {
      setCreatorMonthError(requestError instanceof Error ? requestError.message : 'Не удалось назначить креатора')
    } finally {
      setIsCreatorSlotSaving(false)
    }
  }, [authToken, creatorDialogSlot, creatorPeriodEnd, creatorPeriodStart, isCreatorSlotSaving])

  const handleAddHomeCommunityCharacter = useCallback(async () => {
    if (
      !selectedHomeCommunityCharacter ||
      isHomeCommunityCharacterAddSaving ||
      selectedHomeCommunityCharacter.is_added_by_user ||
      selectedHomeCommunityCharacter.author_id === user.id
    ) {
      return
    }
    setHomeCommunityActionError('')
    setIsHomeCommunityCharacterAddSaving(true)
    try {
      const updatedCharacter = await addCommunityCharacter({
        token: authToken,
        characterId: selectedHomeCommunityCharacter.id,
      })
      setSelectedHomeCommunityCharacter(updatedCharacter)
      setCommunityCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
    } catch (requestError) {
      setHomeCommunityActionError(requestError instanceof Error ? requestError.message : 'Не удалось добавить персонажа')
    } finally {
      setIsHomeCommunityCharacterAddSaving(false)
    }
  }, [authToken, isHomeCommunityCharacterAddSaving, selectedHomeCommunityCharacter, user.id])

  const handleAddHomeCommunityRule = useCallback(async () => {
    if (
      !selectedHomeCommunityRule ||
      isHomeCommunityRuleAddSaving ||
      selectedHomeCommunityRule.is_added_by_user ||
      selectedHomeCommunityRule.author_id === user.id
    ) {
      return
    }
    setHomeCommunityActionError('')
    setIsHomeCommunityRuleAddSaving(true)
    try {
      const updatedRule = await addCommunityInstructionTemplate({
        token: authToken,
        templateId: selectedHomeCommunityRule.id,
      })
      setSelectedHomeCommunityRule(updatedRule)
      setCommunityRules((previous) => previous.map((item) => (item.id === updatedRule.id ? updatedRule : item)))
    } catch (requestError) {
      setHomeCommunityActionError(requestError instanceof Error ? requestError.message : 'Не удалось добавить инструкцию')
    } finally {
      setIsHomeCommunityRuleAddSaving(false)
    }
  }, [authToken, isHomeCommunityRuleAddSaving, selectedHomeCommunityRule, user.id])

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

  const handleEncourageCommunityWorld = useCallback(async (amountCoins: number, message: string) => {
    if (!selectedCommunityWorld) {
      return
    }
    const response = await createPublicationEncouragement({
      token: authToken,
      target_type: 'world',
      target_id: selectedCommunityWorld.world.id,
      amount_coins: amountCoins,
      message,
    })
    onUserUpdate(response.user)
  }, [authToken, onUserUpdate, selectedCommunityWorld])

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
      const detail = error instanceof Error ? error.message : 'Не удалось обновить библиотеку'
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
          setPaymentReferralBonusCoins(response.referral_bonus_granted ? Math.max(0, Math.trunc(response.referral_bonus_amount ?? 0)) : 0)
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
    setDashboardNewsEditingId(selectedDashboardNews.id)
    setDashboardNewsDraft(createDashboardNewsDraft(selectedDashboardNews))
    setIsDashboardNewsEditorOpen(true)
  }, [isDashboardNewsEditor, selectedDashboardNews])

  const handleCloseDashboardNewsEditor = useCallback(() => {
    if (isDashboardNewsSaving) {
      return
    }
    setIsDashboardNewsCloseConfirmOpen(false)
    setIsDashboardNewsEditorOpen(false)
    setDashboardNewsEditorError('')
    setDashboardNewsEditingId(null)
    setDashboardNewsImageCropSource(null)
  }, [isDashboardNewsSaving])

  const handleChooseDashboardNewsImage = useCallback(() => {
    if (isDashboardNewsSaving) {
      return
    }
    dashboardNewsImageInputRef.current?.click()
  }, [isDashboardNewsSaving])

  const handleDashboardNewsImageChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setDashboardNewsEditorError('Выберите файл изображения: PNG, JPEG, WEBP или GIF.')
      return
    }

    if (selectedFile.size > DASHBOARD_NEWS_IMAGE_MAX_BYTES) {
      setDashboardNewsEditorError('Слишком большой файл. Максимум 8 МБ.')
      return
    }

    setDashboardNewsEditorError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setDashboardNewsImageCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось подготовить изображение'
      setDashboardNewsEditorError(detail)
    }
  }, [])

  const handleRequestCloseDashboardNewsEditor = useCallback(() => {
    if (isDashboardNewsSaving) {
      return
    }
    if (hasDashboardNewsDraftChanges) {
      setIsDashboardNewsCloseConfirmOpen(true)
      return
    }
    handleCloseDashboardNewsEditor()
  }, [handleCloseDashboardNewsEditor, hasDashboardNewsDraftChanges, isDashboardNewsSaving])

  const handleSaveDashboardNews = useCallback(async () => {
    if (!dashboardNewsEditingItem || !isDashboardNewsEditor || isDashboardNewsSaving) {
      return
    }

    setDashboardNewsEditorError('')
    setIsDashboardNewsSaving(true)
    try {
      const updatedItem = await updateDashboardNews({
        token: authToken,
        news_id: dashboardNewsEditingItem.id,
        category: dashboardNewsDraft.category,
        title: dashboardNewsDraft.title,
        description: dashboardNewsDraft.description,
        image_url: dashboardNewsDraft.image_url.trim() || null,
        date_label: dashboardNewsDraft.date_label,
      })
      setDashboardNews((previous) => previous.map((item) => (item.id === updatedItem.id ? updatedItem : item)))
      setSelectedDashboardNewsId(updatedItem.id)
      setDashboardNewsEditingId(null)
      setDashboardNewsImageCropSource(null)
      setIsDashboardNewsEditorOpen(false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить новость'
      setDashboardNewsEditorError(detail)
    } finally {
      setIsDashboardNewsSaving(false)
    }
  }, [
    authToken,
    dashboardNewsEditingItem,
    dashboardNewsDraft.category,
    dashboardNewsDraft.date_label,
    dashboardNewsDraft.description,
    dashboardNewsDraft.image_url,
    dashboardNewsDraft.title,
    isDashboardNewsEditor,
    isDashboardNewsSaving,
  ])

  const handleCloseDashboardNewsDialog = useCallback(() => {
    setDashboardNewsDialogItemId(null)
  }, [])

  const handleOpenDashboardNewsDialog = useCallback((item?: DashboardNewsCard | null) => {
    const targetItem = item ?? selectedDashboardNews
    if (!targetItem) {
      return
    }
    setSelectedDashboardNewsId(targetItem.id)
    setDashboardNewsDialogItemId(targetItem.id)
    setNewsProgressKey((k) => k + 1)
  }, [selectedDashboardNews])

  const selectDashboardNewsByOffset = useCallback((offset: number) => {
    if (dashboardNews.length <= 1) {
      return
    }
    const currentIndex = dashboardNews.findIndex((item) => item.id === selectedDashboardNews?.id)
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeCurrentIndex + offset + dashboardNews.length) % dashboardNews.length
    const nextItem = dashboardNews[nextIndex]
    if (!nextItem) {
      return
    }
    setSelectedDashboardNewsId(nextItem.id)
    setNewsProgressKey((k) => k + 1)
  }, [dashboardNews, selectedDashboardNews?.id])

  const handleDashboardNewsTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) {
      return
    }
    dashboardNewsTouchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const handleDashboardNewsTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touchStart = dashboardNewsTouchStartRef.current
    const touch = event.changedTouches[0]
    dashboardNewsTouchStartRef.current = null
    if (!touchStart || !touch || dashboardNews.length <= 1) {
      return
    }

    const deltaX = touch.clientX - touchStart.x
    const deltaY = touch.clientY - touchStart.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX < 52 || absX < absY * 1.15) {
      return
    }

    dashboardNewsSwipeSuppressClickRef.current = true
    selectDashboardNewsByOffset(deltaX < 0 ? 1 : -1)
    window.setTimeout(() => {
      dashboardNewsSwipeSuppressClickRef.current = false
    }, 240)
  }, [dashboardNews.length, selectDashboardNewsByOffset])

  useEffect(() => {
    if (dashboardNews.length === 0) {
      setSelectedDashboardNewsId(null)
      setDashboardNewsDialogItemId(null)
      return
    }
    if (dashboardNewsDialogItemId !== null && !dashboardNews.some((item) => item.id === dashboardNewsDialogItemId)) {
      setDashboardNewsDialogItemId(null)
    }
    if (selectedDashboardNewsId !== null && dashboardNews.some((item) => item.id === selectedDashboardNewsId)) {
      return
    }
    setSelectedDashboardNewsId(dashboardNews[0].id)
  }, [dashboardNews, dashboardNewsDialogItemId, selectedDashboardNewsId])

  // Auto-advance news selection every 15 s; newsProgressKey acts as the reset trigger
  useEffect(() => {
    if (dashboardNews.length <= 1) {
      return
    }
    if (isDashboardNewsEditorOpen || isDashboardNewsCloseConfirmOpen || dashboardNewsDialogItem) {
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
  }, [dashboardNews, dashboardNewsDialogItem, isDashboardNewsCloseConfirmOpen, isDashboardNewsEditorOpen, newsProgressKey])

  const selectedCommunityWorldGameIds = selectedCommunityWorld
    ? communityWorldGameIds[selectedCommunityWorld.world.id] ?? []
    : []
  const isSelectedCommunityWorldInMyGames = selectedCommunityWorldGameIds.length > 0
  const canModerateCommunityCards = canModerateCommunityContent(user.role)
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
  const selectedDashboardNewsAmbient = getDashboardNewsAmbientGradient(selectedDashboardNews?.slot ?? 1)
  const dashboardNewsDialogImage =
    dashboardNewsDialogItem?.image_url?.trim() || getDashboardNewsFallbackImage(dashboardNewsDialogItem?.slot ?? 1)
  const dashboardNewsDialogAmbient = getDashboardNewsAmbientGradient(dashboardNewsDialogItem?.slot ?? 1)
  const isCreatorMonthInitialLoading = isCreatorMonthLoading && creatorMonth === null
  const creatorMonthLabel = formatCreatorMonthLabel(creatorMonth?.period_start)
  const renderCreatorMonthSkeletonCard = (place: number) => (
    <Box
      key={`creator-month-skeleton-${place}`}
      sx={{
        position: 'relative',
        width: '100%',
        minHeight: { xs: 276, md: 286 },
        overflow: 'hidden',
        borderRadius: '18px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        background: 'linear-gradient(145deg, var(--morius-elevated-bg), var(--morius-card-bg))',
      }}
    >
      <Box
        className="morius-skeleton-card"
        sx={{ position: 'absolute', top: 18, right: 20, width: 60, height: 78, borderRadius: '14px', opacity: 0.42 }}
      />
      <Stack justifyContent="flex-end" sx={{ position: 'relative', zIndex: 1, minHeight: { xs: 276, md: 286 }, p: { xs: 2, md: 2.2 } }}>
        <Stack direction="row" spacing={1.35} alignItems="center">
          <Box className="morius-skeleton-card" sx={{ width: 62, height: 62, flexShrink: 0, borderRadius: '50%' }} />
          <Stack spacing={0.65} sx={{ minWidth: 0, flex: 1 }}>
            <Box className="morius-skeleton-card" sx={{ width: '64%', height: 18, borderRadius: '999px' }} />
            <Box className="morius-skeleton-card" sx={{ width: '36%', height: 12, borderRadius: '999px' }} />
          </Stack>
        </Stack>
        <Box sx={{ my: 1.55, borderTop: 'var(--morius-border-width) solid var(--morius-divider-color)' }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
          {[0, 1, 2, 3].map((key) => (
            <Stack key={`creator-month-skeleton-${place}-${key}`} spacing={0.55}>
              <Box className="morius-skeleton-card" sx={{ width: '76%', height: 9, borderRadius: '999px' }} />
              <Box className="morius-skeleton-card" sx={{ width: '48%', height: 17, borderRadius: '999px' }} />
            </Stack>
          ))}
        </Box>
      </Stack>
    </Box>
  )
  const renderCreatorMonthCard = (slot: CreatorMonthSlot) => {
    const creator = slot.user
    const place = slot.slot
    const placeStyle = place === 1
      ? {
          accent: '#e5c36f',
          border: 'rgba(225, 192, 109, 0.36)',
          glow: 'rgba(202, 159, 65, 0.2)',
        }
      : place === 2
        ? {
            accent: '#bcc5d4',
            border: 'rgba(185, 197, 214, 0.3)',
            glow: 'rgba(137, 153, 177, 0.18)',
          }
        : {
            accent: '#c58e66',
            border: 'rgba(194, 137, 96, 0.32)',
            glow: 'rgba(170, 105, 65, 0.18)',
          }
    const creatorBannerPreset = creator ? getProfileBannerPreset(creator.profile_banner_id) : null
    const creatorBannerSrc = creator
      ? resolveProfileBannerImageUrl(creator.profile_banner_id, creator.profile_banner_image_url ?? null) ?? creatorBannerPreset?.src ?? null
      : null
    const ratingValue = Number.isFinite(slot.stats.average_rating) && slot.stats.rating_count > 0
      ? slot.stats.average_rating.toFixed(1)
      : '0.0'
    const statItems = [
      ['Игры', slot.stats.worlds_count],
      ['Персонажи', slot.stats.characters_count],
      ['Правила', slot.stats.instruction_templates_count],
      ['Рейтинг', `★ ${ratingValue}`],
    ] as const
    return (
      <ButtonBase
        key={`creator-month-${place}`}
        aria-label={creator ? `Открыть профиль ${creator.display_name}` : `Место ${place}`}
        onClick={() => handleOpenCreatorDialog(slot)}
        disabled={!creator && !isCreatorMonthEditor}
        sx={{
          position: 'relative',
          width: '100%',
          minHeight: { xs: 276, md: 286 },
          display: 'block',
          p: 0,
          borderRadius: '18px',
          overflow: 'hidden',
          textAlign: 'left',
          border: `var(--morius-border-width) solid ${placeStyle.border}`,
          background: `radial-gradient(95% 80% at 100% 0%, ${placeStyle.glow}, transparent 62%), var(--morius-card-bg)`,
          color: APP_TEXT_PRIMARY,
          transition: 'transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
          '&:hover': {
            transform: 'translateY(-5px)',
            borderColor: placeStyle.accent,
            boxShadow: `0 18px 46px ${placeStyle.glow}`,
            '& .creator-month-banner': {
              transform: 'scale(1.035)',
            },
          },
          '&:focus-visible': {
            outline: `2px solid ${placeStyle.accent}`,
            outlineOffset: '2px',
          },
        }}
      >
        {creatorBannerSrc ? (
          <Box
            component="img"
            className="creator-month-banner"
            src={creatorBannerSrc}
            alt=""
            loading="lazy"
            decoding="async"
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: creatorBannerPreset?.objectPosition ?? 'center center',
              opacity: 0.52,
              filter: 'saturate(0.9) contrast(1.05)',
              transition: 'transform 360ms ease',
              pointerEvents: 'none',
            }}
          />
        ) : null}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            background: `linear-gradient(180deg, rgba(8, 10, 14, 0.38) 0%, rgba(8, 10, 14, 0.58) 38%, rgba(8, 10, 14, 0.97) 100%), radial-gradient(90% 72% at 100% 0%, ${placeStyle.glow}, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
        <Typography
          aria-hidden
          sx={{
            position: 'absolute',
            top: { xs: 12, md: 14 },
            right: { xs: 18, md: 22 },
            zIndex: 2,
            color: placeStyle.accent,
            fontFamily: '"Spectral", serif',
            fontSize: { xs: '4.4rem', md: '5.25rem' },
            fontWeight: 500,
            lineHeight: 0.9,
            opacity: 0.25,
          }}
        >
          {place}
        </Typography>

        <Stack
          justifyContent="flex-end"
          sx={{ position: 'relative', zIndex: 3, width: '100%', minHeight: { xs: 276, md: 286 }, p: { xs: 2, md: 2.2 } }}
        >
          <Stack direction="row" spacing={1.35} alignItems="center" sx={{ minWidth: 0, pr: 4.5 }}>
            <ProgressiveAvatar
              src={creator?.avatar_url ?? null}
              alt={creator?.display_name ?? `Место ${place}`}
              fallbackLabel={creator?.display_name ?? `${place}`}
              size={62}
              scale={creator?.avatar_scale ?? 1}
              frameId={creator?.avatar_frame_id ?? 'none'}
              frameImageUrl={creator?.avatar_frame_image_url ?? null}
              sx={{
                flexShrink: 0,
                border: `var(--morius-border-width) solid ${placeStyle.accent}`,
                boxShadow: `0 0 0 3px rgba(7, 9, 13, 0.72), 0 8px 24px ${placeStyle.glow}`,
                background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 42%, rgba(0,0,0,0.42) 100%)',
              }}
            />
            <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                title={creator?.display_name || undefined}
                sx={{
                  color: APP_TEXT_PRIMARY,
                  fontSize: { xs: '1.08rem', md: '1.16rem' },
                  fontWeight: 850,
                  lineHeight: 1.15,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textShadow: '0 2px 12px rgba(0,0,0,0.72)',
                }}
              >
                {creator?.display_name || (isCreatorMonthEditor ? 'Назначить креатора' : 'Место свободно')}
              </Typography>
              <Typography
                sx={{
                  color: placeStyle.accent,
                  fontSize: '0.74rem',
                  fontWeight: 850,
                  lineHeight: 1.2,
                  letterSpacing: '0.14em !important',
                  textTransform: 'uppercase',
                }}
              >
                {place} место
              </Typography>
            </Stack>
          </Stack>

          <Box sx={{ my: 1.55, borderTop: 'var(--morius-border-width) solid rgba(255,255,255,0.11)' }} />

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: { xs: 0.65, md: 1 } }}>
            {statItems.map(([label, value]) => {
              const isRating = label === 'Рейтинг'
              return (
                <Stack key={`${place}-${label}`} spacing={0.38} sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'rgba(197, 204, 218, 0.72)',
                      fontSize: { xs: '0.58rem', md: '0.62rem' },
                      fontWeight: 800,
                      lineHeight: 1,
                      letterSpacing: '0.1em !important',
                      textTransform: 'uppercase',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </Typography>
                  <Typography
                    sx={{
                      color: isRating ? 'var(--morius-rating-gold)' : APP_TEXT_PRIMARY,
                      fontSize: { xs: '0.92rem', md: '1rem' },
                      fontWeight: 850,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {String(value)}
                  </Typography>
                </Stack>
              )
            })}
          </Box>
        </Stack>
      </ButtonBase>
    )
  }

  const handleOpenCommunityModerationMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, target: CommunityModerationTarget) => {
      if (!canModerateCommunityCards || isCommunityModerationSaving) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setCommunityModerationAnchorEl(event.currentTarget)
      setCommunityModerationTarget(target)
    },
    [canModerateCommunityCards, isCommunityModerationSaving],
  )

  const handleCloseCommunityModerationMenu = useCallback(() => {
    if (isCommunityModerationSaving) {
      return
    }
    setCommunityModerationAnchorEl(null)
    setCommunityModerationTarget(null)
  }, [isCommunityModerationSaving])

  const handleReturnCommunityTargetToModeration = useCallback(
    async (target: CommunityModerationTarget) => {
      if (!canModerateCommunityCards || isCommunityModerationSaving) {
        return
      }
      setIsCommunityModerationSaving(true)
      setCommunityWorldsError('')
      setCommunityCharactersError('')
      setCommunityRulesError('')
      try {
        if (target.kind === 'world') {
          await returnWorldToModerationAsAdmin({ token: authToken, world_id: target.id })
          setCommunityWorlds((previous) => previous.filter((item) => item.id !== target.id))
          setSelectedCommunityWorld((previous) =>
            previous?.world.id === target.id ? null : previous,
          )
        } else if (target.kind === 'character') {
          await returnCharacterToModerationAsAdmin({ token: authToken, character_id: target.id })
          setCommunityCharacters((previous) => previous.filter((item) => item.id !== target.id))
        } else {
          await returnInstructionTemplateToModerationAsAdmin({ token: authToken, template_id: target.id })
          setCommunityRules((previous) => previous.filter((item) => item.id !== target.id))
        }
        setCommunityModerationAnchorEl(null)
        setCommunityModerationTarget(null)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось вернуть карточку на модерацию'
        if (target.kind === 'world') {
          setCommunityWorldsError(detail)
        } else if (target.kind === 'character') {
          setCommunityCharactersError(detail)
        } else {
          setCommunityRulesError(detail)
        }
      } finally {
        setIsCommunityModerationSaving(false)
      }
    },
    [authToken, canModerateCommunityCards, isCommunityModerationSaving],
  )

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
          : `Добро пожаловать, ${profileName}. Начните новую историю или быстро вернитесь в библиотеку игр.`,
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
        title: 'Новая игра',
        description: 'Соберите сеттинг, правила и персонажей вручную с полной настройкой игры.',
        imageSrc: newWorldDashboardImage,
        iconMarkup: sidebarPlusIconMarkup,
        onClick: () => onNavigate('/worlds/new'),
        disabled: false,
      },
      {
        key: 'shop',
        title: 'Магазин',
        description: 'Пакеты валюты и дополнительные возможности для длинных сессий и генерации.',
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
  const [newsBgCurrentSrc, setNewsBgCurrentSrc] = useState(selectedDashboardNewsImage)
  const [newsBgNextSrc, setNewsBgNextSrc] = useState<string | undefined>(undefined)
  const [newsBgNextKey, setNewsBgNextKey] = useState(0)
  useEffect(() => {
    if (selectedDashboardNewsImage !== newsXfCurrentSrc) {
      setNewsXfNextSrc(selectedDashboardNewsImage)
      setNewsXfNextKey((k) => k + 1)
    }
    if (selectedDashboardNewsImage !== newsBgCurrentSrc) {
      setNewsBgNextSrc(selectedDashboardNewsImage)
      setNewsBgNextKey((k) => k + 1)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDashboardNewsImage])

  const handleNewsXfReady = useCallback((src: string) => {
    setNewsXfCurrentSrc(src)
    setNewsXfNextSrc(undefined)
  }, [])
  const handleNewsBgReady = useCallback((src: string) => {
    setNewsBgCurrentSrc(src)
    setNewsBgNextSrc(undefined)
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
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        mobileActionItems={dashboardQuickActions}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: true, onClick: () => onNavigate('/dashboard') },
          { key: 'games-all', label: 'Сообщество', onClick: () => onNavigate('/games/all') },
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
        showAiAssistantAction={user.ai_assistant_visible ?? true}
        onOpenTopUpDialog={handleOpenTopUpDialog}
        hideRightToggle
        rightActions={<HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} />}
      />

      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          pt: { xs: 'max(56px, calc(var(--morius-header-menu-top) - 10px))', md: 'calc(var(--morius-header-menu-top) + 10px)' },
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box
          sx={{
            position: 'relative',
            isolation: 'isolate',
            width: '100%',
            maxWidth: 1400,
            mx: 'auto',
            '& > :not(.morius-home-news-bg)': {
              position: 'relative',
              zIndex: 1,
            },
          }}
        >
          <Box
            className="morius-home-news-bg"
            aria-hidden
            sx={{
              position: 'absolute',
              top: -100,
              left: '50%',
              width: '100vw',
              height: 920,
              transform: 'translateX(-50%)',
              zIndex: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              opacity: selectedDashboardNews ? 1 : 0,
              transition: 'opacity 320ms ease',
              maskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.9) 36%, rgba(0,0,0,0.45) 66%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.9) 36%, rgba(0,0,0,0.45) 66%, transparent 100%)',
            }}
          >
            {newsBgCurrentSrc ? (
              <Box
                component="img"
                src={newsBgCurrentSrc}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="high"
                sx={{
                  position: 'absolute',
                  top: -100,
                  left: '-12%',
                  right: '-12%',
                  width: '124%',
                  height: 920,
                  objectFit: 'cover',
                  objectPosition: '50% 22%',
                  filter: 'blur(115px) saturate(1.45)',
                  transform: 'scale(1.08)',
                  opacity: 0.6,
                }}
              />
            ) : null}
            {newsBgNextSrc ? (
              <NewsBlurBackgroundXfLayer
                key={newsBgNextKey}
                src={newsBgNextSrc}
                onReady={handleNewsBgReady}
              />
            ) : null}
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                background: `${selectedDashboardNewsAmbient}, radial-gradient(82% 70% at 50% 0%, transparent 48%, rgba(9,9,9,0.4) 100%)`,
              }}
            />
          </Box>
          <Box sx={{ display: 'grid', gap: 3.5, mb: 'var(--morius-cards-title-gap)' }}>
            <Box
              sx={{
                display: 'grid',
                gap: 1.25,
                gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.7fr) minmax(310px, 1fr)' },
                minWidth: 0,
                maxWidth: '100%',
                '@media (max-width:899.95px)': {
                  display: 'none',
                },
              }}
            >
              <Box
                role={selectedDashboardNews ? 'button' : undefined}
                tabIndex={selectedDashboardNews ? 0 : undefined}
                aria-label={selectedDashboardNews ? `Открыть новость: ${selectedDashboardNews.title}` : undefined}
                onClick={() => handleOpenDashboardNewsDialog(selectedDashboardNews)}
                onKeyDown={(event) => {
                  if (!selectedDashboardNews || (event.key !== 'Enter' && event.key !== ' ')) {
                    return
                  }
                  event.preventDefault()
                  handleOpenDashboardNewsDialog(selectedDashboardNews)
                }}
                sx={{
                  position: 'relative',
                  width: '100%',
                  minWidth: 0,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  cursor: selectedDashboardNews ? 'pointer' : 'default',
                  minHeight: { xs: 420, sm: 420, md: 390, xl: 380 },
                  borderRadius: '14px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  background: 'var(--morius-card-gradient)',
                  boxShadow: 'var(--morius-neutral-shadow)',
                  outline: 'none',
                  '&:focus-visible': {
                    borderColor: 'var(--morius-hover-border)',
                  },
                }}
              >
                {isDashboardNewsLoading && dashboardNews.length === 0 ? (
                  <Box className="morius-skeleton-card morius-skeleton-card--flat" sx={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
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
                          objectPosition: '72% 28%',
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
                          'linear-gradient(100deg, rgba(8,5,7,0.94) 4%, rgba(10,6,8,0.78) 38%, rgba(10,6,8,0.28) 66%, transparent 100%), linear-gradient(0deg, rgba(8,5,7,0.55) 0%, transparent 40%)',
                      }}
                    />
                    <Stack
                      spacing={1.15}
                      justifyContent="space-between"
                      sx={{
                        position: 'relative',
                        zIndex: 1,
                        width: '100%',
                        minHeight: '100%',
                        p: { xs: 1.7, md: 2.5 },
                        '@media (max-width:569.95px)': {
                          justifyContent: 'flex-end',
                          p: 1.25,
                        },
                      }}
                    >
                      <Stack spacing={1.1} sx={{ maxWidth: 500 }}>
                        <Typography sx={{ color: 'var(--accent, #4c8dff)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
                          Новость
                        </Typography>
                        <Typography sx={{ color: 'var(--morius-title-text)', fontFamily: '"Spectral", serif', fontSize: { xs: '2.1rem', md: '46px' }, fontWeight: 700, lineHeight: 1.02, maxWidth: 620 }}>
                          {selectedDashboardNews.title}
                        </Typography>
                        <Typography
                          sx={{
                            color: '#cbc7c0',
                            fontSize: { xs: '0.94rem', md: '1rem' },
                            lineHeight: 1.58,
                            maxWidth: 460,
                            whiteSpace: 'pre-line',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {selectedDashboardNews.description}
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box
                          sx={{
                            px: 1.25,
                            py: 0.75,
                            borderRadius: '999px',
                            border: 'var(--morius-border-width) solid rgba(255,255,255,0.09)',
                            backgroundColor: 'rgba(20,15,11,0.55)',
                            backdropFilter: 'blur(6px)',
                            color: '#cbc7c0',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                          }}
                        >
                          {selectedDashboardNews.date_label}
                        </Box>
                        <Box
                          sx={{
                            px: 1.25,
                            py: 0.75,
                            borderRadius: '999px',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--accent, #4c8dff) 32%, rgba(255,255,255,0.1))',
                            backgroundColor: 'color-mix(in srgb, var(--accent, #4c8dff) 16%, rgba(20,15,11,0.55))',
                            color: 'var(--morius-title-text)',
                            fontSize: '0.84rem',
                            fontWeight: 800,
                          }}
                        >
                          Читать полностью
                        </Box>
                        {isDashboardNewsEditor ? (
                          <Button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleOpenDashboardNewsEditor()
                            }}
                            sx={{
                              minHeight: 38,
                              width: 'fit-content',
                              px: 1.2,
                              borderRadius: '12px',
                              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                              backgroundColor: 'rgba(20,15,11,0.55)',
                              color: APP_TEXT_PRIMARY,
                              textTransform: 'none',
                              fontWeight: 800,
                              backdropFilter: 'blur(6px)',
                              '&:hover': {
                                backgroundColor: 'rgba(255,255,255,0.06)',
                              },
                            }}
                          >
                            Редактировать новость
                          </Button>
                        ) : null}
                      </Stack>
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
                    gap: 0,
                    flex: { xl: 1 },
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    height: { xl: 0, xs: 'auto' },
                    overflowX: { xs: 'auto', xl: 'hidden' },
                    overflowY: 'hidden',
                    borderRadius: '14px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    background: 'var(--morius-card-alt-gradient)',
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
                          className="morius-skeleton-card"
                          sx={{
                            width: { xs: '100%', xl: '100%' },
                            minWidth: { xs: '100%', xl: 0 },
                            maxWidth: { xs: '100%', xl: '100%' },
                            flex: { xs: '0 0 100%', xl: '0 0 auto' },
                            minHeight: 96,
                            borderRadius: '18px',
                            scrollSnapAlign: 'start',
                            boxSizing: 'border-box',
                          }}
                        />
                      ))
                    : dashboardNews.map((item) => {
                        const isSelected = item.id === selectedDashboardNews?.id
                        const isUpdateCategory = item.category.toLowerCase().includes('обнов')
                        return (
                          <ButtonBase
                            key={item.id}
                            aria-label={`Показать новость: ${item.title}`}
                            onClick={() => {
                              setSelectedDashboardNewsId(item.id)
                              setNewsProgressKey((key) => key + 1)
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
                              borderRadius: 0,
                              p: 1.15,
                              scrollSnapAlign: 'start',
                              boxSizing: 'border-box',
                              border: 'none',
                              borderBottom: 'var(--morius-border-width) solid var(--morius-divider-color)',
                              background: isSelected
                                ? 'color-mix(in srgb, var(--accent, #4c8dff) 11%, transparent)'
                                : 'transparent',
                              backdropFilter: 'blur(6px)',
                              transition: 'background 200ms ease',
                              '&::before': isSelected
                                ? {
                                    content: '""',
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: 0,
                                    width: 3,
                                    backgroundColor: 'var(--accent, #4c8dff)',
                                  }
                                : undefined,
                              '&:hover': {
                                background: isSelected ? 'color-mix(in srgb, var(--accent, #4c8dff) 11%, transparent)' : 'rgba(255,255,255,0.04)',
                              },
                            }}
                          >
                            {isSelected ? (
                              <Box
                                key={newsProgressKey}
                                aria-hidden
                                sx={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: 0,
                                  width: '0%',
                                  background:
                                    'linear-gradient(90deg, color-mix(in srgb, var(--morius-card-bg) 86%, black 14%) 0%, color-mix(in srgb, var(--morius-card-bg) 74%, black 26%) 100%)',
                                  opacity: 0.82,
                                  animation: 'morius-news-progress 15s linear forwards',
                                  pointerEvents: 'none',
                                }}
                              />
                            ) : null}
                            <Stack spacing={0.45} sx={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', minHeight: 0, pr: 3 }}>
                              <Typography sx={{ color: isUpdateCategory ? 'var(--morius-gold)' : 'var(--morius-muted-text)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
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
                              <Typography
                                sx={{
                                  color: 'var(--morius-text-secondary)',
                                  fontSize: '0.82rem',
                                  fontWeight: 650,
                                  lineHeight: 1.35,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {item.description}
                              </Typography>
                            </Stack>
                            <SvgIcon sx={{ position: 'absolute', top: '50%', right: 12, zIndex: 1, transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--morius-muted-text)' }}>
                              <path d="M8.7 5.3 12.4 9l-3.7 3.7-1.1-1.1L9.4 9 7.6 6.4l1.1-1.1Z" fill="currentColor" />
                            </SvgIcon>
                          </ButtonBase>
                        )
                      })}
                </Box>
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              display: { xs: 'block', md: 'none' },
              width: '100%',
              maxWidth: '100%',
              overflow: 'hidden',
            }}
          >
            {dashboardNewsError ? (
              <Alert severity="error" sx={{ mb: 1.2, borderRadius: '16px' }}>
                {dashboardNewsError}
              </Alert>
            ) : null}
            <Box
              role={selectedDashboardNews ? 'button' : undefined}
              tabIndex={selectedDashboardNews ? 0 : undefined}
              aria-label={selectedDashboardNews ? `Открыть новость: ${selectedDashboardNews.title}` : undefined}
              onClick={() => {
                if (dashboardNewsSwipeSuppressClickRef.current) {
                  return
                }
                handleOpenDashboardNewsDialog(selectedDashboardNews)
              }}
              onKeyDown={(event) => {
                if (!selectedDashboardNews || (event.key !== 'Enter' && event.key !== ' ')) {
                  return
                }
                event.preventDefault()
                handleOpenDashboardNewsDialog(selectedDashboardNews)
              }}
              onTouchStart={handleDashboardNewsTouchStart}
              onTouchEnd={handleDashboardNewsTouchEnd}
              sx={{
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                height: { xs: 382, sm: 420 },
                borderRadius: '0 0 16px 16px',
                background: APP_CARD_BACKGROUND,
                cursor: selectedDashboardNews ? 'pointer' : 'default',
                touchAction: 'pan-y',
                outline: 'none',
                '&:focus-visible': {
                  boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent, #4c8dff) 48%, transparent)',
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 86,
                  zIndex: 1,
                  pointerEvents: 'none',
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--morius-app-base) 90%, transparent) 0%, color-mix(in srgb, var(--morius-app-base) 48%, transparent) 48%, rgba(0,0,0,0) 100%)',
                },
              }}
            >
              {isDashboardNewsLoading && dashboardNews.length === 0 ? (
                <Box className="morius-skeleton-card morius-skeleton-card--flat" sx={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
              ) : selectedDashboardNews ? (
                <>
                  <Box
                    component="img"
                    src={newsXfCurrentSrc || selectedDashboardNewsImage}
                    alt=""
                    loading="eager"
                    decoding="async"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 1,
                      background:
                        'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.28) 48%, rgba(0,0,0,0.9) 100%)',
                    }}
                  />
                  <Stack
                    spacing={0.8}
                    justifyContent="flex-end"
                    sx={{
                      position: 'relative',
                      zIndex: 2,
                      height: '100%',
                      px: 2,
                      pb: 2.2,
                      color: '#fff',
                    }}
                  >
                    <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.82rem', fontWeight: 900, letterSpacing: 0, textTransform: 'uppercase' }}>
                      {selectedDashboardNews.category}
                    </Typography>
                    <Typography
                      sx={{
                        color: '#fff',
                        fontSize: '2rem',
                        fontWeight: 900,
                        lineHeight: 1.04,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {selectedDashboardNews.title}
                    </Typography>
                    <Typography
                      sx={{
                        color: 'rgba(255,255,255,0.76)',
                        fontSize: '0.95rem',
                        lineHeight: 1.45,
                        fontWeight: 700,
                        whiteSpace: 'pre-line',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {selectedDashboardNews.description}
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={0.8} sx={{ pt: 0.2, flexWrap: 'wrap' }}>
                      <Box
                        sx={{
                          px: 1,
                          py: 0.55,
                          borderRadius: '999px',
                          border: 'var(--morius-border-width) solid rgba(255,255,255,0.12)',
                          backgroundColor: 'rgba(9,9,9,0.42)',
                          color: 'rgba(255,255,255,0.82)',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                        }}
                      >
                        {selectedDashboardNews.date_label}
                      </Box>
                      <Box
                        sx={{
                          px: 1,
                          py: 0.55,
                          borderRadius: '999px',
                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--accent, #4c8dff) 34%, rgba(255,255,255,0.12))',
                          backgroundColor: 'color-mix(in srgb, var(--accent, #4c8dff) 18%, rgba(9,9,9,0.42))',
                          color: '#fff',
                          fontSize: '0.78rem',
                          fontWeight: 900,
                        }}
                      >
                        Читать полностью
                      </Box>
                    </Stack>
                    {isDashboardNewsEditor ? (
                      <Button
                        onClick={(event) => {
                          event.stopPropagation()
                          handleOpenDashboardNewsEditor()
                        }}
                        sx={{
                          width: 'fit-content',
                          minHeight: 32,
                          px: 0,
                          color: '#fff',
                          textTransform: 'none',
                          fontWeight: 800,
                          '&:hover': { color: 'var(--morius-accent)' },
                        }}
                      >
                        Редактировать новость
                      </Button>
                    ) : null}
                  </Stack>
                </>
              ) : (
                <Stack justifyContent="flex-end" sx={{ height: '100%', p: 2 }}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.2rem', fontWeight: 900 }}>Новостей пока нет</Typography>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Как только появятся обновления, они будут показаны здесь.</Typography>
                </Stack>
              )}
            </Box>
            {dashboardNews.length > 1 ? (
              <Stack direction="row" justifyContent="center" spacing={1} sx={{ mt: 1.35 }}>
                {dashboardNews.map((item) => {
                  const isSelected = item.id === selectedDashboardNews?.id
                  return (
                    <ButtonBase
                      key={`mobile-news-dot-${item.id}`}
                      aria-label={`Новость ${item.slot}`}
                      onClick={() => {
                        setSelectedDashboardNewsId(item.id)
                        setNewsProgressKey((k) => k + 1)
                      }}
                      sx={{
                        width: isSelected ? 26 : 20,
                        height: 4,
                        borderRadius: '999px',
                        backgroundColor: isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.24)',
                        transition: 'width 180ms ease, background-color 180ms ease',
                      }}
                    />
                  )
                })}
              </Stack>
            ) : null}
          </Box>

          <CreatorRewardPromoBanner />

          <Box sx={{ display: 'grid', gap: 1.35 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Box>
                <Typography sx={{ color: 'var(--morius-title-text)', fontFamily: '"Spectral", serif', fontSize: { xs: '1.45rem', md: '26px' }, fontWeight: 700, lineHeight: 1.08 }}>
                  Креаторы месяца
                </Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.96rem', lineHeight: 1.45 }}>
                  Три автора, которые сильнее всего оживили сообщество за выбранный период.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {creatorMonthLabel ? (
                  <Box
                    sx={{
                      minHeight: 36,
                      display: 'inline-flex',
                      alignItems: 'center',
                      px: 1.65,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, transparent)',
                      color: APP_TEXT_SECONDARY,
                      fontSize: '0.82rem',
                      fontWeight: 750,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {creatorMonthLabel}
                  </Box>
                ) : null}
                {isCreatorMonthLoading ? (
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.84rem', fontWeight: 700 }}>Загружаем...</Typography>
                ) : null}
              </Stack>
            </Stack>
            {creatorMonthError ? (
              <Alert severity="error" sx={{ borderRadius: '14px' }}>{creatorMonthError}</Alert>
            ) : null}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              {isCreatorMonthInitialLoading
                ? [1, 2, 3].map((place) => renderCreatorMonthSkeletonCard(place))
                : creatorMonthSlots.map((slot) => renderCreatorMonthCard(slot))}
            </Box>
          </Box>

          {/* ── Игры (worlds slider) ────────────────────────────────────── */}
          <Box data-tour-id="home-community-section" sx={{ scrollMarginTop: '120px' }}>
            <HomeSliderHeader
              title="Игры"
              subtitle="Публичные игры игроков. Откройте карточку, оцените и запускайте в свои игры."
              iconMarkup={communityPlayIconMarkup}
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
                        <CommunityModerationCardFrame
                          canModerate={canModerateCommunityCards}
                          disabled={isCommunityModerationSaving}
                          actionOffsetRight={50}
                          onOpenMenu={(event) =>
                            handleOpenCommunityModerationMenu(event, { kind: 'world', id: world.id, title: world.title })
                          }
                        >
                          <CommunityWorldCard
                            world={world}
                            onClick={() => void handleOpenCommunityWorld(world.id)}
                            onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                            disabled={isCommunityWorldDialogLoading}
                            showFavoriteButton
                            isFavoriteSaving={Boolean(favoriteWorldActionById[world.id])}
                            onToggleFavorite={(item) => void handleToggleFavoriteWorld(item)}
                          />
                        </CommunityModerationCardFrame>
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
                {isCommunityWorldsLoading && communityWorlds.length === 0
                  ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Box key={key} className="morius-skeleton-card" sx={{ height: MOBILE_CARD_HEIGHT, flexShrink: 0 }} />
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
                      authorAvatarFrameId={world.author_avatar_frame_id}
                      authorAvatarFrameImageUrl={world.author_avatar_frame_image_url}
                      stat1={`${world.community_launches} ▶`}
                      stat2={`${world.community_rating_avg.toFixed(1)} ★`}
                      onMenuClick={
                        canModerateCommunityCards
                          ? (event) =>
                              handleOpenCommunityModerationMenu(event, {
                                kind: 'world',
                                id: world.id,
                                title: world.title,
                              })
                          : undefined
                      }
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
              iconMarkup={cardsCharactersIconMarkup}
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
                        <Box className="morius-skeleton-card" sx={{ width: '100%', minHeight: 420, aspectRatio: '0.65 / 1' }} />
                      </SliderCard>
                    ))
                  : communityCharacters.map((item) => (
                      <SliderCard key={item.id}>
                        <CommunityModerationCardFrame
                          canModerate={canModerateCommunityCards}
                          disabled={isCommunityModerationSaving}
                          onOpenMenu={(event) =>
                            handleOpenCommunityModerationMenu(event, { kind: 'character', id: item.id, title: item.name })
                          }
                        >
                          <CommunityCharacterCard item={item} onClick={() => setSelectedHomeCommunityCharacter(item)} />
                        </CommunityModerationCardFrame>
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
              {isCommunityCharactersLoading && communityCharacters.length === 0
                ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Box key={key} className="morius-skeleton-card" sx={{ height: MOBILE_CARD_HEIGHT, flexShrink: 0 }} />
                  ))
                : communityCharacters.map((item) => (
                    <MobileCardItem
                      key={item.id}
                      imageUrl={resolveApiResourceUrl(item.avatar_url)}
                      title={item.name}
                      description={item.description}
                      authorName={item.author_name.trim() || 'Неизвестный автор'}
                      authorAvatarUrl={item.author_avatar_url}
                      authorAvatarFrameId={item.author_avatar_frame_id}
                      authorAvatarFrameImageUrl={item.author_avatar_frame_image_url}
                      stat1={`+${item.community_additions_count}`}
                      stat2={`${item.community_rating_avg.toFixed(1)} ★`}
                      showPlayButton={false}
                      onMenuClick={
                        canModerateCommunityCards
                          ? (event) =>
                              handleOpenCommunityModerationMenu(event, {
                                kind: 'character',
                                id: item.id,
                                title: item.name,
                              })
                          : undefined
                      }
                      onClick={() => setSelectedHomeCommunityCharacter(item)}
                    />
                  ))}
            </MobileCardSlider>
          </Box>

          {/* ── Правила (rules slider) ───────────────────────────────────── */}
          <Box sx={{ mt: 'var(--morius-cards-title-gap)' }}>
            <HomeSliderHeader
              title="Правила"
              subtitle="Публичные правила игроков"
              iconMarkup={cardsRulesIconMarkup}
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
                        <Box className="morius-skeleton-card" sx={{ height: 318 }} />
                      </SliderCard>
                    ))
                  : communityRules.map((item) => (
                      <SliderCard key={item.id}>
                        <CommunityModerationCardFrame
                          canModerate={canModerateCommunityCards}
                          disabled={isCommunityModerationSaving}
                          actionOffsetRight={92}
                          onOpenMenu={(event) =>
                            handleOpenCommunityModerationMenu(event, { kind: 'instruction_template', id: item.id, title: item.title })
                          }
                        >
                          <CommunityRuleCard
                            title={item.title}
                            content={item.content}
                            authorName={item.author_name}
                            authorAvatarUrl={item.author_avatar_url}
                            authorAvatarFrameId={item.author_avatar_frame_id}
                            authorAvatarFrameImageUrl={item.author_avatar_frame_image_url}
                            gamesCount={item.community_additions_count}
                            ratingAvg={item.community_rating_avg}
                            onClick={() => setSelectedHomeCommunityRule(item)}
                          />
                        </CommunityModerationCardFrame>
                      </SliderCard>
                    ))}
              </HomeCardSlider>
            </Box>
            {/* Mobile horizontal slider */}
            <MobileCardSlider>
              {isCommunityRulesLoading && communityRules.length === 0
                ? HOME_COMMUNITY_SKELETON_CARD_KEYS.map((key) => (
                    <Box key={key} className="morius-skeleton-card" sx={{ height: MOBILE_CARD_HEIGHT, flexShrink: 0 }} />
                  ))
                : communityRules.map((item) => (
                    <MobileCardItem
                      key={item.id}
                      fallbackBackground={buildWorldFallbackArtwork(item.id + 100000) as Record<string, unknown>}
                      title={item.title}
                      description={item.content}
                      authorName={item.author_name.trim() || 'Неизвестный автор'}
                      authorAvatarUrl={item.author_avatar_url}
                      authorAvatarFrameId={item.author_avatar_frame_id}
                      authorAvatarFrameImageUrl={item.author_avatar_frame_image_url}
                      stat1={`+${item.community_additions_count}`}
                      stat2={`${item.community_rating_avg.toFixed(1)} ★`}
                      showPlayButton={false}
                      onMenuClick={
                        canModerateCommunityCards
                          ? (event) =>
                              handleOpenCommunityModerationMenu(event, {
                                kind: 'instruction_template',
                                id: item.id,
                                title: item.title,
                              })
                          : undefined
                      }
                      onClick={() => setSelectedHomeCommunityRule(item)}
                    />
                  ))}
            </MobileCardSlider>
          </Box>


        </Box>
      </Box>

      <CommunityModerationMenu
        anchorEl={communityModerationAnchorEl}
        target={communityModerationTarget}
        isSaving={isCommunityModerationSaving}
        onClose={handleCloseCommunityModerationMenu}
        onReturnToModeration={(target) => {
          void handleReturnCommunityTargetToModeration(target)
        }}
      />

      <QuickStartWizardDialog
        open={isQuickStartDialogOpen}
        authToken={authToken}
        onClose={() => setIsQuickStartDialogOpen(false)}
        onStarted={handleQuickStartStarted}
      />

      <CreatorRewardPromoDialog
        open={isCreatorRewardPromoOpen}
        onClose={() => {
          markCreatorRewardPromoSeen()
          setIsCreatorRewardPromoOpen(false)
        }}
      />

      <Dialog
        open={Boolean(creatorDialogSlot)}
        onClose={() => {
          if (!isCreatorSlotSaving) {
            setCreatorDialogSlot(null)
          }
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: CREATOR_DIALOG_PAPER_SX }}
        BackdropProps={{ sx: { backgroundColor: 'rgba(2, 5, 10, 0.76)' } }}
      >
        <DialogTitle sx={{ pb: 1.1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.3rem', fontWeight: 950 }}>
                Креатор месяца #{creatorDialogSlot?.slot ?? ''}
              </Typography>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                Выберите автора и период, статистика считается автоматически.
              </Typography>
            </Box>
            <IconButton
              onClick={() => setCreatorDialogSlot(null)}
              disabled={isCreatorSlotSaving}
              sx={{
                color: APP_TEXT_SECONDARY,
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #0d131a)',
                '&:hover': { color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_HOVER },
              }}
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ pt: 0, overflow: 'hidden' }}>
          {creatorMonthError ? <Alert severity="error" sx={{ mb: 1.2, borderRadius: '12px' }}>{creatorMonthError}</Alert> : null}
          <Stack spacing={1.2}>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.4fr) 180px 150px 150px' } }}>
              <TextField label="Поиск пользователя" value={creatorQuery} onChange={(event) => setCreatorQuery(event.target.value.slice(0, 120))} />
              <TextField
                select
                label="Сортировка"
                value={creatorCandidateSort}
                onChange={(event) => setCreatorCandidateSort(event.target.value as CreatorCandidateSort)}
              >
                {CREATOR_CANDIDATE_SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Начало" type="date" value={creatorPeriodStart} onChange={(event) => setCreatorPeriodStart(event.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField label="Конец" type="date" value={creatorPeriodEnd} onChange={(event) => setCreatorPeriodEnd(event.target.value)} InputLabelProps={{ shrink: true }} />
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.4}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={creatorOnlyWithPublications}
                      onChange={(event) => setCreatorOnlyWithPublications(event.target.checked)}
                      sx={{ color: APP_TEXT_SECONDARY, '&.Mui-checked': { color: 'var(--morius-accent)' } }}
                    />
                  }
                  label="С публикациями"
                  sx={{ color: APP_TEXT_SECONDARY, mr: 1.2 }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={creatorOnlyWithRatings}
                      onChange={(event) => setCreatorOnlyWithRatings(event.target.checked)}
                      sx={{ color: APP_TEXT_SECONDARY, '&.Mui-checked': { color: 'var(--morius-accent)' } }}
                    />
                  }
                  label="С оценками"
                  sx={{ color: APP_TEXT_SECONDARY }}
                />
              </Stack>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem', fontWeight: 750 }}>
                Показано {creatorCandidates.length} из {creatorCandidateTotal}
              </Typography>
            </Stack>
            <Box
              ref={creatorCandidatesScrollRef}
              onScroll={handleCreatorCandidatesScroll}
              className="morius-scrollbar"
              sx={{
                display: 'grid',
                gap: 0.85,
                maxHeight: 'min(52vh, 470px)',
                overflowY: 'auto',
                pr: 0.45,
                scrollbarGutter: 'stable',
              }}
            >
              {isCreatorCandidatesLoading && creatorCandidates.length === 0 ? (
                [0, 1, 2, 3].map((key) => <Box key={`creator-candidate-skeleton-${key}`} className="morius-skeleton-card" sx={{ height: 72, borderRadius: '16px' }} />)
              ) : creatorCandidates.length === 0 ? (
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Кандидаты не найдены.</Typography>
              ) : (
                creatorCandidates.map((candidate) => (
                  <ButtonBase
                    key={candidate.user.id}
                    onClick={() => void handleAssignCreatorSlot(candidate)}
                    disabled={isCreatorSlotSaving}
                    sx={{
                      width: '100%',
                      borderRadius: '16px',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, #111922)',
                      p: 1,
                      textAlign: 'left',
                      transition: 'background-color 160ms ease, border-color 160ms ease, transform 160ms ease',
                      WebkitTapHighlightColor: 'transparent',
                      '&:hover': {
                        backgroundColor: APP_BUTTON_HOVER,
                        borderColor: 'color-mix(in srgb, var(--morius-accent) 42%, var(--morius-card-border))',
                      },
                      '&.Mui-focusVisible': {
                        backgroundColor: APP_BUTTON_HOVER,
                        outline: '2px solid color-mix(in srgb, var(--morius-accent) 58%, transparent)',
                        outlineOffset: 2,
                      },
                      '&:active': { transform: 'translateY(1px)' },
                      '&.Mui-disabled': { opacity: 0.72 },
                    }}
                  >
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ width: '100%' }}>
                      <ProgressiveAvatar
                        src={candidate.user.avatar_url}
                        alt={candidate.user.display_name}
                        fallbackLabel={candidate.user.display_name}
                        frameId={candidate.user.avatar_frame_id}
                        frameImageUrl={candidate.user.avatar_frame_image_url}
                        scale={candidate.user.avatar_scale}
                        size={52}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 900, lineHeight: 1.2 }}>
                          {candidate.user.display_name}
                        </Typography>
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem', lineHeight: 1.35 }}>
                          Публикаций: {candidate.stats.publications_count} · Игры: {candidate.stats.worlds_count} · Персонажи: {candidate.stats.characters_count} · Инструкции: {candidate.stats.instruction_templates_count}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          color: APP_TEXT_PRIMARY,
                          fontSize: '0.92rem',
                          fontWeight: 900,
                          borderRadius: '999px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 86%, transparent)',
                          px: 1.1,
                          py: 0.45,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatCreatorRating(candidate.stats.average_rating, candidate.stats.rating_count)}
                      </Typography>
                    </Stack>
                  </ButtonBase>
                ))
              )}
              {isCreatorCandidatesLoading && creatorCandidates.length > 0 ? (
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem', fontWeight: 750, textAlign: 'center', py: 0.7 }}>
                  Загружаем еще...
                </Typography>
              ) : null}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            borderTop: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, #0d131a)',
          }}
        >
          <Button
            onClick={() => void handleAssignCreatorSlot(null)}
            disabled={isCreatorSlotSaving}
            sx={{ ...CREATOR_DIALOG_BUTTON_SX, color: APP_TEXT_SECONDARY, backgroundColor: 'transparent', '&:hover': { color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_HOVER } }}
          >
            Очистить слот
          </Button>
          <Button
            onClick={() => setCreatorDialogSlot(null)}
            disabled={isCreatorSlotSaving}
            sx={{ ...CREATOR_DIALOG_BUTTON_SX, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedHomeCommunityCharacter)}
        onClose={() => {
          if (!isHomeCommunityCharacterAddSaving) {
            setSelectedHomeCommunityCharacter(null)
            setHomeCommunityActionError('')
          }
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: HOME_ENTITY_DIALOG_PAPER_SX }}
        BackdropProps={{ sx: { backgroundColor: 'rgba(2, 5, 10, 0.76)' } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.28rem', fontWeight: 950 }}>
              {selectedHomeCommunityCharacter?.name ?? ''}
            </Typography>
            <IconButton
              onClick={() => {
                setSelectedHomeCommunityCharacter(null)
                setHomeCommunityActionError('')
              }}
              disabled={isHomeCommunityCharacterAddSaving}
              sx={{ color: APP_TEXT_SECONDARY, backgroundColor: 'var(--morius-elevated-bg)' }}
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ maxHeight: 'min(68vh, 620px)' }}>
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ProgressiveAvatar
                src={selectedHomeCommunityCharacter?.avatar_url}
                alt={selectedHomeCommunityCharacter?.name ?? ''}
                fallbackLabel={selectedHomeCommunityCharacter?.name ?? ''}
                size={68}
                scale={selectedHomeCommunityCharacter?.avatar_scale ?? 1}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                  Автор: {selectedHomeCommunityCharacter?.author_name || 'Неизвестный автор'}
                </Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem' }}>
                  Рейтинг: {selectedHomeCommunityCharacter?.community_rating_avg.toFixed(1) ?? '0.0'} · Добавлений: {selectedHomeCommunityCharacter?.community_additions_count ?? 0}
                </Typography>
              </Box>
            </Stack>
            {selectedHomeCommunityCharacter?.note ? (
              <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.88rem', fontWeight: 800 }}>
                {selectedHomeCommunityCharacter.note}
              </Typography>
            ) : null}
            {homeCommunityActionError ? <Alert severity="error" sx={{ borderRadius: '12px' }}>{homeCommunityActionError}</Alert> : null}
            <Typography sx={{ color: 'rgba(224, 235, 249, 0.92)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {selectedHomeCommunityCharacter?.description ?? ''}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => {
              setSelectedHomeCommunityCharacter(null)
              setHomeCommunityActionError('')
            }}
            disabled={isHomeCommunityCharacterAddSaving}
            sx={{ ...HOME_ENTITY_DIALOG_BUTTON_SX, color: APP_TEXT_SECONDARY, backgroundColor: 'transparent' }}
          >
            Закрыть
          </Button>
          <Button
            onClick={() => void handleAddHomeCommunityCharacter()}
            disabled={
              !selectedHomeCommunityCharacter ||
              isHomeCommunityCharacterAddSaving ||
              selectedHomeCommunityCharacter.is_added_by_user ||
              selectedHomeCommunityCharacter.author_id === user.id
            }
            sx={{ ...HOME_ENTITY_DIALOG_BUTTON_SX, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}
          >
            {selectedHomeCommunityCharacter?.author_id === user.id
              ? 'Ваша карточка'
              : selectedHomeCommunityCharacter?.is_added_by_user
                ? 'Добавлено'
                : isHomeCommunityCharacterAddSaving
                  ? 'Добавляем...'
                  : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedHomeCommunityRule)}
        onClose={() => {
          if (!isHomeCommunityRuleAddSaving) {
            setSelectedHomeCommunityRule(null)
            setHomeCommunityActionError('')
          }
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: HOME_ENTITY_DIALOG_PAPER_SX }}
        BackdropProps={{ sx: { backgroundColor: 'rgba(2, 5, 10, 0.76)' } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.28rem', fontWeight: 950 }}>
              {selectedHomeCommunityRule?.title ?? ''}
            </Typography>
            <IconButton
              onClick={() => {
                setSelectedHomeCommunityRule(null)
                setHomeCommunityActionError('')
              }}
              disabled={isHomeCommunityRuleAddSaving}
              sx={{ color: APP_TEXT_SECONDARY, backgroundColor: 'var(--morius-elevated-bg)' }}
            >
              ×
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ maxHeight: 'min(68vh, 620px)' }}>
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ProgressiveAvatar
                src={selectedHomeCommunityRule?.author_avatar_url}
                alt={selectedHomeCommunityRule?.author_name ?? ''}
                fallbackLabel={selectedHomeCommunityRule?.author_name ?? ''}
                frameId={selectedHomeCommunityRule?.author_avatar_frame_id}
                frameImageUrl={selectedHomeCommunityRule?.author_avatar_frame_image_url}
                size={52}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                  Автор: {selectedHomeCommunityRule?.author_name || 'Неизвестный автор'}
                </Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem' }}>
                  Рейтинг: {selectedHomeCommunityRule?.community_rating_avg.toFixed(1) ?? '0.0'} · Добавлений: {selectedHomeCommunityRule?.community_additions_count ?? 0}
                </Typography>
              </Box>
            </Stack>
            {homeCommunityActionError ? <Alert severity="error" sx={{ borderRadius: '12px' }}>{homeCommunityActionError}</Alert> : null}
            <Typography sx={{ color: 'rgba(224, 235, 249, 0.92)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {selectedHomeCommunityRule?.content ?? ''}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => {
              setSelectedHomeCommunityRule(null)
              setHomeCommunityActionError('')
            }}
            disabled={isHomeCommunityRuleAddSaving}
            sx={{ ...HOME_ENTITY_DIALOG_BUTTON_SX, color: APP_TEXT_SECONDARY, backgroundColor: 'transparent' }}
          >
            Закрыть
          </Button>
          <Button
            onClick={() => void handleAddHomeCommunityRule()}
            disabled={
              !selectedHomeCommunityRule ||
              isHomeCommunityRuleAddSaving ||
              selectedHomeCommunityRule.is_added_by_user ||
              selectedHomeCommunityRule.author_id === user.id
            }
            sx={{ ...HOME_ENTITY_DIALOG_BUTTON_SX, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}
          >
            {selectedHomeCommunityRule?.author_id === user.id
              ? 'Ваша инструкция'
              : selectedHomeCommunityRule?.is_added_by_user
                ? 'Добавлено'
                : isHomeCommunityRuleAddSaving
                  ? 'Добавляем...'
                  : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>

      <BaseDialog
        open={Boolean(dashboardNewsDialogItem)}
        onClose={handleCloseDashboardNewsDialog}
        maxWidth="lg"
        transitionComponent={DialogTransition}
        rawChildren
        protectTextInputClose={false}
        showCloseButton={false}
        backdropSx={{
          backgroundColor: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(10px)',
        }}
        paperSx={{
          overflow: 'hidden',
          borderRadius: { xs: '20px 20px 0 0', md: '18px' },
          background: 'linear-gradient(180deg, #17171c 0%, #111114 100%)',
          color: 'var(--morius-text-primary)',
          width: { xs: '100%', md: 'min(1040px, calc(100vw - 48px))' },
          maxHeight: { xs: '92dvh', md: 'min(860px, 92dvh)' },
          m: { xs: 0, md: 2 },
        }}
      >
        {dashboardNewsDialogItem ? (
          <Box
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.08fr) minmax(360px, 0.92fr)' },
              minHeight: { md: 620 },
              maxHeight: { xs: '92dvh', md: 'min(860px, 92dvh)' },
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                position: 'relative',
                minHeight: { xs: 258, sm: 340, md: 620 },
                overflow: 'hidden',
                background: dashboardNewsDialogAmbient,
              }}
            >
              <Box
                component="img"
                src={dashboardNewsDialogImage}
                alt=""
                loading="eager"
                decoding="async"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: '72% 28%',
                }}
              />
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(90deg, rgba(9,9,9,0.1) 0%, rgba(9,9,9,0.08) 46%, rgba(9,9,9,0.56) 100%), linear-gradient(0deg, rgba(9,9,9,0.76) 0%, transparent 42%)',
                }}
              />
              <Stack
                direction="row"
                spacing={0.8}
                sx={{
                  position: 'absolute',
                  left: { xs: 16, md: 20 },
                  right: { xs: 64, md: 20 },
                  bottom: { xs: 16, md: 20 },
                  zIndex: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Box
                  sx={{
                    px: 1.15,
                    py: 0.62,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(9,9,9,0.48)',
                    backdropFilter: 'blur(8px)',
                    color: dashboardNewsDialogItem.category.toLowerCase().includes('обнов') ? 'var(--morius-gold)' : 'var(--accent, #4c8dff)',
                    fontSize: '0.78rem',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                  }}
                >
                  {dashboardNewsDialogItem.category}
                </Box>
                <Box
                  sx={{
                    px: 1.15,
                    py: 0.62,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(9,9,9,0.48)',
                    backdropFilter: 'blur(8px)',
                    color: '#d8d3ca',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                  }}
                >
                  {dashboardNewsDialogItem.date_label}
                </Box>
              </Stack>
              <Box
                component="button"
                type="button"
                aria-label="Закрыть новость"
                onClick={handleCloseDashboardNewsDialog}
                sx={{
                  position: 'absolute',
                  top: { xs: 14, md: 16 },
                  right: { xs: 14, md: 16 },
                  zIndex: 3,
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid rgba(255,255,255,0.12)',
                  backgroundColor: 'rgba(9,9,9,0.48)',
                  color: 'var(--morius-title-text)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(10px)',
                  '&:hover': {
                    borderColor: 'var(--morius-hover-border)',
                    backgroundColor: 'rgba(255,255,255,0.07)',
                  },
                }}
              >
                <SvgIcon sx={{ width: 20, height: 20 }}>
                  <path d="M6.7 6.7a1 1 0 0 1 1.4 0L12 10.6l3.9-3.9a1 1 0 1 1 1.4 1.4L13.4 12l3.9 3.9a1 1 0 0 1-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4" fill="currentColor" />
                </SvgIcon>
              </Box>
            </Box>

            <Box
              sx={{
                position: 'relative',
                overflowY: 'auto',
                minHeight: 0,
                maxHeight: { xs: 'calc(92dvh - 258px)', sm: 'calc(92dvh - 340px)', md: 'min(860px, 92dvh)' },
                px: { xs: 2, sm: 2.5, md: 3.25 },
                py: { xs: 2.1, md: 3.2 },
                borderLeft: { md: 'var(--morius-border-width) solid var(--morius-divider-color)' },
                background:
                  'radial-gradient(circle at 18% 0%, rgba(205,166,89,0.08) 0%, transparent 36%), linear-gradient(180deg, rgba(23,23,28,0.98) 0%, rgba(17,17,20,0.98) 100%)',
              }}
            >
              <Stack spacing={{ xs: 1.35, md: 1.65 }}>
                <Typography
                  component="h2"
                  sx={{
                    color: 'var(--morius-title-text)',
                    fontFamily: '"Spectral", serif',
                    fontSize: { xs: '2rem', sm: '2.35rem', md: '3rem' },
                    fontWeight: 700,
                    lineHeight: 1.02,
                    letterSpacing: 0,
                    pr: { md: 1.5 },
                  }}
                >
                  {dashboardNewsDialogItem.title}
                </Typography>
                <Box
                  sx={{
                    height: 1,
                    backgroundColor: 'var(--morius-divider-color)',
                  }}
                />
                <Typography
                  sx={{
                    color: '#d8d3ca',
                    fontSize: { xs: '1rem', md: '1.04rem' },
                    lineHeight: { xs: 1.68, md: 1.72 },
                    whiteSpace: 'pre-line',
                    overflowWrap: 'anywhere',
                    userSelect: 'text',
                  }}
                >
                  {dashboardNewsDialogItem.description}
                </Typography>
                <Box
                  component="button"
                  type="button"
                  onClick={handleCloseDashboardNewsDialog}
                  sx={{
                    alignSelf: 'flex-start',
                    mt: 0.5,
                    minHeight: 40,
                    px: 1.35,
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    color: 'var(--morius-text-primary)',
                    font: 'inherit',
                    fontWeight: 800,
                    cursor: 'pointer',
                    '&:hover': {
                      borderColor: 'var(--morius-hover-border)',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                    },
                  }}
                >
                  Закрыть
                </Box>
              </Stack>
            </Box>
          </Box>
        ) : null}
      </BaseDialog>

      <BaseDialog
        open={isDashboardNewsEditorOpen}
        onClose={handleRequestCloseDashboardNewsEditor}
        disableBackdropClose
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
            <Button onClick={handleRequestCloseDashboardNewsEditor} disabled={isDashboardNewsSaving} sx={{ color: APP_TEXT_SECONDARY }}>
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
          <Box>
            <Box
              component="input"
              ref={dashboardNewsImageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void handleDashboardNewsImageChange(event)
              }}
              sx={{ display: 'none' }}
            />
            <Stack spacing={0.8}>
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: `${DASHBOARD_NEWS_IMAGE_ASPECT} / 1`,
                  overflow: 'hidden',
                  borderRadius: '14px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: APP_CARD_BACKGROUND,
                }}
              >
                <Box
                  component="img"
                  src={dashboardNewsEditorPreviewImage}
                  alt=""
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center',
                  }}
                />
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(180deg, rgba(4, 8, 14, 0.02) 0%, rgba(4, 8, 14, 0.42) 100%)',
                  }}
                />
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                <Button
                  onClick={handleChooseDashboardNewsImage}
                  disabled={isDashboardNewsSaving}
                  sx={{
                    minHeight: 40,
                    borderRadius: '12px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    textTransform: 'none',
                    fontWeight: 800,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  Выбрать картинку
                </Button>
                {dashboardNewsDraft.image_url.trim() ? (
                  <Button
                    onClick={() => setDashboardNewsDraft((previous) => ({ ...previous, image_url: '' }))}
                    disabled={isDashboardNewsSaving}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      color: APP_TEXT_SECONDARY,
                      textTransform: 'none',
                      fontWeight: 800,
                      '&:hover': { backgroundColor: APP_BUTTON_HOVER, color: APP_TEXT_PRIMARY },
                    }}
                  >
                    Убрать картинку
                  </Button>
                ) : null}
              </Stack>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.35 }}>
                Изображение обрежется под формат главной новости.
              </Typography>
            </Stack>
          </Box>
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

      <BaseDialog
        open={isDashboardNewsCloseConfirmOpen}
        onClose={() => setIsDashboardNewsCloseConfirmOpen(false)}
        maxWidth="xs"
        header={<Typography sx={{ fontSize: '1.1rem', fontWeight: 900 }}>Закрыть без сохранения?</Typography>}
        actions={
          <>
            <Button onClick={() => setIsDashboardNewsCloseConfirmOpen(false)} sx={{ color: APP_TEXT_SECONDARY }}>
              Остаться
            </Button>
            <Button onClick={handleCloseDashboardNewsEditor} sx={{ color: APP_TEXT_PRIMARY }}>
              Закрыть
            </Button>
          </>
        }
      >
        <Typography sx={{ color: APP_TEXT_SECONDARY }}>
          Внесенные изменения в новости будут потеряны.
        </Typography>
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
        onEncourage={handleEncourageCommunityWorld}
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
        authToken={authToken}
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

      {dashboardNewsImageCropSource ? (
        <ImageCropper
          imageSrc={dashboardNewsImageCropSource}
          aspect={DASHBOARD_NEWS_IMAGE_ASPECT}
          frameRadius={14}
          title="Обрезка картинки новости"
          cancelLabel="Отмена"
          saveLabel="Применить"
          isSaving={isDashboardNewsSaving}
          outputWidth={DASHBOARD_NEWS_IMAGE_OUTPUT_WIDTH}
          outputHeight={DASHBOARD_NEWS_IMAGE_OUTPUT_HEIGHT}
          outputMime="image/webp"
          outputQuality={0.9}
          onCancel={() => {
            if (!isDashboardNewsSaving) {
              setDashboardNewsImageCropSource(null)
            }
          }}
          onSave={(croppedDataUrl) => {
            setDashboardNewsDraft((previous) => ({ ...previous, image_url: croppedDataUrl }))
            setDashboardNewsImageCropSource(null)
          }}
        />
      ) : null}

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        referralBonusCoins={paymentReferralBonusCoins}
        transitionComponent={DialogTransition}
        onClose={() => {
          setPaymentSuccessCoins(null)
          setPaymentReferralBonusCoins(0)
        }}
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
