import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  SvgIcon,
  TextField,
  Typography,
  useMediaQuery,
  type SelectChangeEvent,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import SoulAmount from '../components/currency/SoulAmount'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import {
  CommunityModerationCardFrame,
  CommunityModerationMenu,
  canModerateCommunityContent,
  type CommunityModerationTarget,
} from '../components/community/CommunityModerationActions'
import HeaderAccountActions from '../components/HeaderAccountActions'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import { useScrollLoadTrigger } from '../hooks/useScrollLoadTrigger'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import communityPlayRaw from '../assets/icons/community-play.svg?raw'
import cardsPlotRaw from '../assets/icons/cards-plot.svg?raw'
import cardsRulesRaw from '../assets/icons/cards-rules.svg?raw'
import searchIconRaw from '../assets/icons/search.svg?raw'
import searchCloseIconRaw from '../assets/icons/search-close.svg?raw'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import Footer from '../components/Footer'
import TextLimitIndicator from '../components/TextLimitIndicator'
import { WORLD_GENRE_OPTIONS } from '../constants/worldGenres'

import {
  createCoinTopUpPayment,
  createPublicationEncouragement,
  getCoinTopUpPlans,
  returnCharacterToModerationAsAdmin,
  returnInstructionTemplateToModerationAsAdmin,
  returnWorldToModerationAsAdmin,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  addCommunityCharacter,
  addCommunityInstructionTemplate,
  createCommunityWorldComment,
  deleteCommunityWorldComment,
  deleteStoryGame,
  favoriteCommunityWorld,
  getCommunityCharacter,
  getCommunityInstructionTemplate,
  getCommunityWorld,
  launchCommunityWorld,
  listCommunityCharacters,
  listCommunityInstructionTemplates,
  listCommunityWorlds,
  listStoryGames,
  rateCommunityCharacter,
  rateCommunityInstructionTemplate,
  rateCommunityWorld,
  reportCommunityCharacter,
  reportCommunityInstructionTemplate,
  reportCommunityWorld,
  updateCommunityWorldComment,
  unfavoriteCommunityWorld,
  type StoryCommunityWorldReportReason,
} from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type {
  StoryCommunityCharacterSummary,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldPayload,
  StoryCommunityWorldSummary,
  StoryGameSummary,
} from '../types/story'
import { moriusThemeTokens } from '../theme'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'
import { buildUnifiedMobileQuickActions } from '../utils/mobileQuickActions'
import { MobileCardItem } from '../components/mobile/MobileCardSlider'
import { resolveApiResourceUrl } from '../services/httpClient'



type CommunityWorldsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const COMMUNITY_WORLD_SKELETON_CARD_KEYS = Array.from({ length: 12 }, (_, index) => `community-world-skeleton-${index}`)

const COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
const COMMUNITY_CARD_BATCH_SIZE = 12
const COMMUNITY_PUBLIC_CARD_HERO_HEIGHT = 138
const GENRE_DRAG_THRESHOLD_PX = 6
const COMMUNITY_WORLD_GENRE_OPTIONS: string[] = [...WORLD_GENRE_OPTIONS]
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])

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

function parseSharedWorldIdFromLocation(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('worldId') ?? params.get('worldid')
  if (!rawValue) {
    return null
  }
  const parsedValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }
  return parsedValue
}

function mergeCommunityItemsById<T extends { id: number }>(previous: T[], nextItems: T[]): T[] {
  const mergedById = new Map<number, T>()
  previous.forEach((item) => {
    mergedById.set(item.id, item)
  })
  nextItems.forEach((item) => {
    mergedById.set(item.id, item)
  })
  return Array.from(mergedById.values())
}

type EncouragementTarget = {
  target_type: 'character' | 'instruction_template'
  target_id: number
  title: string
}

type CommunitySection = 'worlds' | 'characters' | 'rules'
type CommunityWorldSortMode = 'updated_desc' | 'rating_desc' | 'launches_desc' | 'views_desc'
type CommunityCardSortMode = 'updated_desc' | 'rating_desc' | 'additions_desc'
type CommunityAddedFilter = 'all' | 'added' | 'not_added'
type CommunityWorldAgeFilter = 'all' | '6+' | '16+' | '18+'
type CommunityEntityReportTarget = 'character' | 'instruction_template'
type CommunityWorldGenreFilter = string[] | 'all'

const WORLD_SORT_OPTIONS: Array<{ value: CommunityWorldSortMode; label: string }> = [
  { value: 'updated_desc', label: 'Недавние' },
  { value: 'rating_desc', label: 'По рейтингу' },
  { value: 'launches_desc', label: 'По запускам' },
  { value: 'views_desc', label: 'По просмотрам' },
]

const COMMUNITY_REPORT_REASON_OPTIONS: Array<{ value: StoryCommunityWorldReportReason; label: string }> = [
  { value: 'cp', label: 'CP' },
  { value: 'politics', label: 'Politics' },
  { value: 'racism', label: 'Racism' },
  { value: 'nationalism', label: 'Nationalism' },
  { value: 'other', label: 'Other' },
]
// const COMMUNITY_SEARCH_QUERY_MAX_LENGTH = 120 — search UI removed per Figma design
const COMMUNITY_REPORT_DESCRIPTION_MAX_LENGTH = 2000

const CARD_SORT_OPTIONS: Array<{ value: CommunityCardSortMode; label: string }> = [
  { value: 'updated_desc', label: 'Недавние' },
  { value: 'rating_desc', label: 'По рейтингу' },
  { value: 'additions_desc', label: 'По добавлениям' },
]

const ADDED_FILTER_OPTIONS: Array<{ value: CommunityAddedFilter; label: string }> = [
  { value: 'all', label: 'Все карточки' },
  { value: 'added', label: 'Только добавленные' },
  { value: 'not_added', label: 'Не добавленные' },
]

const AGE_FILTER_OPTIONS: Array<{ value: CommunityWorldAgeFilter; label: string }> = [
  { value: 'all', label: 'Любой рейтинг' },
  { value: '6+', label: '6+' },
  { value: '16+', label: '16+' },
  { value: '18+', label: '18+' },
]


function FilterGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 21, height: 21 }}>
      <path
        d="M4 7h16v2H4zm4 4h12v2H8zm4 4h8v2h-8z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function formatCommunityDate(isoDate: string): string {
  const parsedDate = new Date(isoDate)
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Неизвестная дата'
  }
  return parsedDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function normalizeSearchValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function parseSortDateValue(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function compareCommunityDateDesc(
  left: { id: number; created_at: string },
  right: { id: number; created_at: string },
): number {
  return parseSortDateValue(right.created_at) - parseSortDateValue(left.created_at) || right.id - left.id
}

type CommunityCharacterCardProps = {
  item: StoryCommunityCharacterSummary
  currentUserId: number
  disabled?: boolean
  onClick: () => void
}

function CommunityCharacterCard({ item, currentUserId, disabled = false, onClick }: CommunityCharacterCardProps) {
  const authorName = item.author_name.trim() || 'Неизвестный автор'
  const isOwnedByUser = item.author_id === currentUserId
  const characterNote = item.note.trim()
  const footerHint = isOwnedByUser ? 'Ваша карточка' : item.is_added_by_user ? 'Уже добавлено' : `Автор: ${authorName}`

  return (
    <CharacterShowcaseCard
      title={item.name}
      description={item.description}
      imageUrl={item.avatar_url}
      imageScale={item.avatar_scale}
      eyebrow={characterNote || null}
      heroHeader={
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <ProgressiveAvatar
            src={item.author_avatar_url}
            fallbackLabel={authorName}
            size={36}
            frameId={item.author_avatar_frame_id}
            frameImageUrl={item.author_avatar_frame_image_url}
            sx={{
              border: 'var(--morius-border-width) solid rgba(214, 225, 239, 0.34)',
              backgroundColor: 'rgba(6, 10, 16, 0.76)',
            }}
          />
          <Typography
            sx={{
              color: 'rgba(233, 241, 252, 0.97)',
              fontSize: '0.95rem',
              lineHeight: 1.2,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
            title={authorName}
          >
            {authorName}
          </Typography>
        </Stack>
      }
      footerHint={footerHint}
      metaPrimary={`+${item.community_additions_count}`}
      metaSecondary={`${item.community_rating_avg.toFixed(1)} ★`}
      onClick={onClick}
      disabled={disabled}
    />
  )
}

type CommunityInstructionCardProps = {
  item: StoryCommunityInstructionTemplateSummary
  currentUserId: number
  disabled?: boolean
  onClick: () => void
}

function CommunityInstructionCard({ item, currentUserId, disabled = false, onClick }: CommunityInstructionCardProps) {
  const authorName = item.author_name.trim() || 'Неизвестный автор'
  const isOwnedByUser = item.author_id === currentUserId
  const addStatusLabel = isOwnedByUser ? 'Ваша карточка' : item.is_added_by_user ? 'Добавлено' : 'Не добавлено'
  const heroBackground = buildWorldFallbackArtwork(item.id + 100000)

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      sx={{
        p: 0,
        minHeight: 0,
        borderRadius: 'var(--morius-radius)',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        backgroundColor: APP_CARD_BACKGROUND,
        textTransform: 'none',
        justifyContent: 'stretch',
        alignItems: 'stretch',
        width: '100%',
        overflow: 'hidden',
        '&:hover': {
          backgroundColor: APP_BUTTON_HOVER,
        },
      }}
    >
      <Stack sx={{ width: '100%', textAlign: 'left', minHeight: 238, justifyContent: 'space-between' }}>
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: COMMUNITY_PUBLIC_CARD_HERO_HEIGHT,
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              ...heroBackground,
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.54) 44%, rgba(0, 0, 0, 0) 100%)',
            }}
          />
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              right: 10,
              minWidth: 0,
            }}
          >
            <ProgressiveAvatar
              src={item.author_avatar_url}
              fallbackLabel={authorName}
              size={36}
              frameId={item.author_avatar_frame_id}
              frameImageUrl={item.author_avatar_frame_image_url}
              sx={{
                border: 'var(--morius-border-width) solid rgba(205, 220, 242, 0.34)',
                backgroundColor: 'rgba(6, 10, 16, 0.72)',
              }}
            />
            <Typography
              sx={{
                color: 'rgba(233, 241, 252, 0.97)',
                fontSize: '0.95rem',
                lineHeight: 1.2,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={authorName}
            >
              {authorName}
            </Typography>
          </Stack>
        </Box>
        <Stack sx={{ width: '100%', p: 1.25, textAlign: 'left', flex: 1, justifyContent: 'space-between' }}>
          <Stack spacing={0.8}>
            <Typography
              sx={{
                color: APP_TEXT_PRIMARY,
                fontSize: '1.03rem',
                lineHeight: 1.2,
                fontWeight: 800,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </Typography>
            <Typography
              sx={{
                color: APP_TEXT_SECONDARY,
                fontSize: '0.9rem',
                lineHeight: 1.42,
                minHeight: '4.2em',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.content}
            </Typography>
          </Stack>

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.1 }}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
              {addStatusLabel}
            </Typography>
            <Stack direction="row" spacing={1.1} alignItems="center">
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.82rem', fontWeight: 700 }}>
                {item.community_additions_count} +
              </Typography>
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.82rem', fontWeight: 700 }}>
                {item.community_rating_avg.toFixed(1)} {'\u2605'}
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Stack>
    </Button>
  )
}

function CommunityWorldsPage({ user, authToken, onNavigate, onUserUpdate, onLogout }: CommunityWorldsPageProps) {
  const [activeSection, setActiveSection] = useState<CommunitySection>(() => {
    if (typeof window === 'undefined') return 'worlds'
    const tabParam = new URLSearchParams(window.location.search).get('tab')
    if (tabParam === 'characters') return 'characters'
    if (tabParam === 'rules') return 'rules'
    return 'worlds'
  })
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)
  const [paymentReferralBonusCoins, setPaymentReferralBonusCoins] = useState(0)
  const [communityWorlds, setCommunityWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [isCommunityWorldsLoading, setIsCommunityWorldsLoading] = useState(false)
  const [isCommunityWorldsLoadingMore, setIsCommunityWorldsLoadingMore] = useState(false)
  const [hasMoreCommunityWorldsServer, setHasMoreCommunityWorldsServer] = useState(false)
  const [communityCharacters, setCommunityCharacters] = useState<StoryCommunityCharacterSummary[]>([])
  const [isCommunityCharactersLoading, setIsCommunityCharactersLoading] = useState(false)
  const [isCommunityCharactersLoadingMore, setIsCommunityCharactersLoadingMore] = useState(false)
  const [hasMoreCommunityCharactersServer, setHasMoreCommunityCharactersServer] = useState(false)
  const [communityInstructionTemplates, setCommunityInstructionTemplates] = useState<StoryCommunityInstructionTemplateSummary[]>([])
  const [isCommunityInstructionTemplatesLoading, setIsCommunityInstructionTemplatesLoading] = useState(false)
  const [isCommunityInstructionTemplatesLoadingMore, setIsCommunityInstructionTemplatesLoadingMore] = useState(false)
  const [hasMoreCommunityInstructionTemplatesServer, setHasMoreCommunityInstructionTemplatesServer] = useState(false)
  const [communityWorldsError, setCommunityWorldsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [communityModerationAnchorEl, setCommunityModerationAnchorEl] = useState<HTMLElement | null>(null)
  const [communityModerationTarget, setCommunityModerationTarget] = useState<CommunityModerationTarget | null>(null)
  const [isCommunityModerationSaving, setIsCommunityModerationSaving] = useState(false)
  const [selectedCommunityWorld, setSelectedCommunityWorld] = useState<StoryCommunityWorldPayload | null>(null)
  const [isCommunityWorldDialogLoading, setIsCommunityWorldDialogLoading] = useState(false)
  const [communityRatingDraft, setCommunityRatingDraft] = useState(0)
  const [isCommunityRatingSaving, setIsCommunityRatingSaving] = useState(false)
  const [isLaunchingCommunityWorld, setIsLaunchingCommunityWorld] = useState(false)
  const [communityWorldGameIds, setCommunityWorldGameIds] = useState<Record<number, number[]>>({})
  const [isCommunityWorldMyGamesSaving, setIsCommunityWorldMyGamesSaving] = useState(false)
  const [isCommunityReportSubmitting, setIsCommunityReportSubmitting] = useState(false)
  const [favoriteWorldActionById, setFavoriteWorldActionById] = useState<Record<number, boolean>>({})
  const [selectedCommunityCharacter, setSelectedCommunityCharacter] = useState<StoryCommunityCharacterSummary | null>(null)
  const [isCommunityCharacterLoading, setIsCommunityCharacterLoading] = useState(false)
  const [communityCharacterRatingDraft, setCommunityCharacterRatingDraft] = useState(0)
  const [isCommunityCharacterRatingSaving, setIsCommunityCharacterRatingSaving] = useState(false)
  const [isCommunityCharacterAddSaving, setIsCommunityCharacterAddSaving] = useState(false)
  const [selectedCommunityInstructionTemplate, setSelectedCommunityInstructionTemplate] = useState<StoryCommunityInstructionTemplateSummary | null>(null)
  const [encouragementTarget, setEncouragementTarget] = useState<EncouragementTarget | null>(null)
  const [encouragementAmount, setEncouragementAmount] = useState('5')
  const [encouragementMessage, setEncouragementMessage] = useState('')
  const [encouragementError, setEncouragementError] = useState('')
  const [isEncouragementSubmitting, setIsEncouragementSubmitting] = useState(false)
  const [isCommunityInstructionTemplateLoading, setIsCommunityInstructionTemplateLoading] = useState(false)
  const [communityInstructionRatingDraft, setCommunityInstructionRatingDraft] = useState(0)
  const [isCommunityInstructionRatingSaving, setIsCommunityInstructionRatingSaving] = useState(false)
  const [isCommunityInstructionAddSaving, setIsCommunityInstructionAddSaving] = useState(false)
  const [communityEntityReportTarget, setCommunityEntityReportTarget] = useState<CommunityEntityReportTarget | null>(null)
  const [isCommunityEntityReportCloseConfirmOpen, setIsCommunityEntityReportCloseConfirmOpen] = useState(false)
  const [communityEntityReportReasonDraft, setCommunityEntityReportReasonDraft] = useState<StoryCommunityWorldReportReason>('other')
  const [communityEntityReportDescriptionDraft, setCommunityEntityReportDescriptionDraft] = useState('')
  const [communityEntityReportValidationError, setCommunityEntityReportValidationError] = useState('')
  const [isCommunityEntityReportSubmitting, setIsCommunityEntityReportSubmitting] = useState(false)
  const [sharedWorldIdFromLink] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : parseSharedWorldIdFromLocation(window.location.search),
  )
  const [hasAttemptedSharedWorldOpen, setHasAttemptedSharedWorldOpen] = useState(false)
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [worldSortMode, setWorldSortMode] = useState<CommunityWorldSortMode>('updated_desc')
  const [characterSortMode, setCharacterSortMode] = useState<CommunityCardSortMode>('updated_desc')
  const [instructionSortMode, setInstructionSortMode] = useState<CommunityCardSortMode>('updated_desc')
  const [worldAgeFilter, setWorldAgeFilter] = useState<CommunityWorldAgeFilter>('all')
  const [worldGenreFilter, setWorldGenreFilter] = useState<CommunityWorldGenreFilter>('all')
  const [characterAddedFilter, setCharacterAddedFilter] = useState<CommunityAddedFilter>('all')
  const [instructionAddedFilter, setInstructionAddedFilter] = useState<CommunityAddedFilter>('all')
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const genreScrollRef = useRef<HTMLDivElement | null>(null)
  const genreDragRef = useRef<{
    pointerId: number
    startX: number
    startScrollLeft: number
    isDragging: boolean
    hasPointerCapture: boolean
  } | null>(null)
  const shouldSuppressGenreClickRef = useRef(false)
  const hasLoadedCommunityWorldGameIdsRef = useRef(false)
  const communityWorldsLoadMoreTriggeredRef = useRef(0)
  const communityCharactersLoadMoreTriggeredRef = useRef(0)
  const communityInstructionTemplatesLoadMoreTriggeredRef = useRef(0)
  const communityWorldsRequestVersionRef = useRef(0)
  const communityCharactersRequestVersionRef = useRef(0)
  const communityInstructionTemplatesRequestVersionRef = useRef(0)
  const communityWorldsRequestInFlightRef = useRef(false)
  const communityCharactersRequestInFlightRef = useRef(false)
  const communityInstructionTemplatesRequestInFlightRef = useRef(false)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [isGenreStripHovered, setIsGenreStripHovered] = useState(false)
  const [canScrollGenresLeft, setCanScrollGenresLeft] = useState(false)
  const [canScrollGenresRight, setCanScrollGenresRight] = useState(false)

  const displayedWorldGenreOptions = COMMUNITY_WORLD_GENRE_OPTIONS

  const serverWorldGenreFilter = useMemo(
    () => {
      if (Array.isArray(worldGenreFilter)) {
        return worldGenreFilter.length === 1 ? worldGenreFilter[0] : null
      }
      return typeof worldGenreFilter === 'string' && worldGenreFilter !== 'all' ? worldGenreFilter : null
    },
    [worldGenreFilter],
  )

  const syncGenreScrollControls = useCallback(() => {
    const element = genreScrollRef.current
    if (!element) {
      setCanScrollGenresLeft(false)
      setCanScrollGenresRight(false)
      return
    }

    setCanScrollGenresLeft(element.scrollLeft > 4)
    setCanScrollGenresRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 4)
  }, [])

  useEffect(() => {
    syncGenreScrollControls()
    const element = genreScrollRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver(syncGenreScrollControls)
    observer.observe(element)
    window.addEventListener('resize', syncGenreScrollControls)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncGenreScrollControls)
    }
  }, [displayedWorldGenreOptions.length, syncGenreScrollControls])

  const scrollGenreStrip = useCallback((direction: 'left' | 'right') => {
    const element = genreScrollRef.current
    if (!element) {
      return
    }
    element.scrollBy({
      left: direction === 'left' ? -Math.max(240, element.clientWidth * 0.62) : Math.max(240, element.clientWidth * 0.62),
      behavior: 'smooth',
    })
  }, [])

  const handleGenreWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = genreScrollRef.current
    if (!element || element.scrollWidth <= element.clientWidth) {
      return
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) {
      return
    }

    event.preventDefault()
    element.scrollLeft += delta
    window.requestAnimationFrame(syncGenreScrollControls)
  }, [syncGenreScrollControls])

  const handleGenrePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const element = genreScrollRef.current
    if (!element || element.scrollWidth <= element.clientWidth || event.button !== 0) {
      return
    }

    genreDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      isDragging: false,
      hasPointerCapture: false,
    }
  }, [])

  const handleGenrePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const element = genreScrollRef.current
    const dragState = genreDragRef.current
    if (!element || !dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const dragDelta = event.clientX - dragState.startX
    if (!dragState.isDragging && Math.abs(dragDelta) < GENRE_DRAG_THRESHOLD_PX) {
      return
    }

    dragState.isDragging = true
    shouldSuppressGenreClickRef.current = true
    if (!dragState.hasPointerCapture) {
      element.setPointerCapture(event.pointerId)
      dragState.hasPointerCapture = true
    }

    event.preventDefault()
    element.scrollLeft = dragState.startScrollLeft - dragDelta
    syncGenreScrollControls()
  }, [syncGenreScrollControls])

  const stopGenrePointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const element = genreScrollRef.current
    const dragState = genreDragRef.current
    if (!element || !dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const wasDragging = dragState.isDragging
    if (dragState.hasPointerCapture && element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }
    genreDragRef.current = null

    if (wasDragging) {
      window.setTimeout(() => {
        shouldSuppressGenreClickRef.current = false
      }, 0)
    }
  }, [])

  useEffect(() => {
    if (worldGenreFilter === 'all') {
      return
    }
    const selectedGenres = Array.isArray(worldGenreFilter) ? worldGenreFilter : [worldGenreFilter]
    const validGenres = selectedGenres.filter((genre) => COMMUNITY_WORLD_GENRE_OPTIONS.includes(genre))
    if (validGenres.length === selectedGenres.length) {
      return
    }
    if (validGenres.length === 0) {
      setWorldGenreFilter('all')
    } else {
      setWorldGenreFilter(validGenres)
    }
  }, [worldGenreFilter])

  const normalizedSearchQuery = useMemo(() => normalizeSearchValue(deferredSearchQuery), [deferredSearchQuery])
  const canModerateCommunityCards = canModerateCommunityContent(user.role)

  const filteredCommunityWorlds = useMemo(() => {
    let filtered = communityWorlds

    if (worldAgeFilter !== 'all') {
      filtered = filtered.filter((world) => world.age_rating === worldAgeFilter)
    }

    if (worldGenreFilter !== 'all') {
      const selectedGenres = Array.isArray(worldGenreFilter) ? worldGenreFilter : [worldGenreFilter]
      filtered = filtered.filter((world) =>
        selectedGenres.some((selectedGenre) =>
          world.genres.some((genre) => genre.replace(/\s+/g, ' ').trim() === selectedGenre),
        ),
      )
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (worldSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count || compareCommunityDateDesc(left, right)
      }
      if (worldSortMode === 'launches_desc') {
        return right.community_launches - left.community_launches || compareCommunityDateDesc(left, right)
      }
      if (worldSortMode === 'views_desc') {
        return right.community_views - left.community_views || compareCommunityDateDesc(left, right)
      }
      return compareCommunityDateDesc(left, right)
    })
    return sorted
  }, [communityWorlds, worldAgeFilter, worldGenreFilter, worldSortMode])

  const filteredCommunityCharacters = useMemo(() => {
    let filtered = communityCharacters

    if (characterAddedFilter === 'added') {
      filtered = filtered.filter((item) => item.is_added_by_user)
    } else if (characterAddedFilter === 'not_added') {
      filtered = filtered.filter((item) => !item.is_added_by_user)
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (characterSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count || compareCommunityDateDesc(left, right)
      }
      if (characterSortMode === 'additions_desc') {
        return right.community_additions_count - left.community_additions_count || compareCommunityDateDesc(left, right)
      }
      return compareCommunityDateDesc(left, right)
    })
    return sorted
  }, [characterAddedFilter, characterSortMode, communityCharacters])

  const filteredCommunityInstructionTemplates = useMemo(() => {
    let filtered = communityInstructionTemplates

    if (instructionAddedFilter === 'added') {
      filtered = filtered.filter((item) => item.is_added_by_user)
    } else if (instructionAddedFilter === 'not_added') {
      filtered = filtered.filter((item) => !item.is_added_by_user)
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (instructionSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count || compareCommunityDateDesc(left, right)
      }
      if (instructionSortMode === 'additions_desc') {
        return right.community_additions_count - left.community_additions_count || compareCommunityDateDesc(left, right)
      }
      return compareCommunityDateDesc(left, right)
    })
    return sorted
  }, [communityInstructionTemplates, instructionAddedFilter, instructionSortMode])

  const visibleCommunityWorlds = filteredCommunityWorlds
  const visibleCommunityCharacters = filteredCommunityCharacters
  const visibleCommunityInstructionTemplates = filteredCommunityInstructionTemplates
  const hasMoreCommunityWorlds = hasMoreCommunityWorldsServer
  const hasMoreCommunityCharacters = hasMoreCommunityCharactersServer
  const hasMoreCommunityInstructionTemplates = hasMoreCommunityInstructionTemplatesServer
  const {
    ref: loadMoreCommunityWorldsRef,
    loadMoreSignal: loadMoreCommunityWorldsSignal,
  } = useScrollLoadTrigger<HTMLDivElement>({
    rootMargin: '360px 0px',
    disabled:
      activeSection !== 'worlds' ||
      !hasMoreCommunityWorldsServer ||
      isCommunityWorldsLoading ||
      isCommunityWorldsLoadingMore,
  })
  const {
    ref: loadMoreCommunityCharactersRef,
    loadMoreSignal: loadMoreCommunityCharactersSignal,
  } = useScrollLoadTrigger<HTMLDivElement>({
    rootMargin: '360px 0px',
    disabled:
      activeSection !== 'characters' ||
      !hasMoreCommunityCharactersServer ||
      isCommunityCharactersLoading ||
      isCommunityCharactersLoadingMore,
  })
  const {
    ref: loadMoreCommunityInstructionTemplatesRef,
    loadMoreSignal: loadMoreCommunityInstructionTemplatesSignal,
  } = useScrollLoadTrigger<HTMLDivElement>({
    rootMargin: '360px 0px',
    disabled:
      activeSection !== 'rules' ||
      !hasMoreCommunityInstructionTemplatesServer ||
      isCommunityInstructionTemplatesLoading ||
      isCommunityInstructionTemplatesLoadingMore,
  })

  const loadCommunityWorlds = useCallback(
    async (options?: { append?: boolean; offset?: number }) => {
      const append = options?.append === true
      const offset = Math.max(0, Math.trunc(options?.offset ?? 0))
      if (communityWorldsRequestInFlightRef.current) {
        return
      }

      const requestId = communityWorldsRequestVersionRef.current + 1
      communityWorldsRequestVersionRef.current = requestId
      communityWorldsRequestInFlightRef.current = true
      if (append) {
        setIsCommunityWorldsLoadingMore(true)
      } else {
        setIsCommunityWorldsLoading(true)
      }
      setCommunityWorldsError('')
      try {
        const worlds = await listCommunityWorlds(authToken, {
          limit: COMMUNITY_CARD_BATCH_SIZE + 1,
          offset,
          sort: worldSortMode,
          query: normalizedSearchQuery || undefined,
          ageRating: worldAgeFilter === 'all' ? null : worldAgeFilter,
          genre: serverWorldGenreFilter,
        })
        if (requestId !== communityWorldsRequestVersionRef.current) {
          return
        }
        const visibleWorlds = worlds.slice(0, COMMUNITY_CARD_BATCH_SIZE)
        setCommunityWorlds((previous) => (append ? mergeCommunityItemsById(previous, visibleWorlds) : visibleWorlds))
        setHasMoreCommunityWorldsServer(worlds.length > COMMUNITY_CARD_BATCH_SIZE)
      } catch (error) {
        if (requestId !== communityWorldsRequestVersionRef.current) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить сообщество'
        setCommunityWorldsError(detail)
        setHasMoreCommunityWorldsServer(false)
        if (!append) {
          setCommunityWorlds([])
        }
      } finally {
        if (requestId === communityWorldsRequestVersionRef.current) {
          communityWorldsRequestInFlightRef.current = false
          if (append) {
            setIsCommunityWorldsLoadingMore(false)
          } else {
            setIsCommunityWorldsLoading(false)
          }
        }
      }
    },
    [authToken, normalizedSearchQuery, serverWorldGenreFilter, worldAgeFilter, worldSortMode],
  )

  const loadCommunityCharacters = useCallback(
    async (options?: { append?: boolean; offset?: number }) => {
      const append = options?.append === true
      const offset = Math.max(0, Math.trunc(options?.offset ?? 0))
      if (communityCharactersRequestInFlightRef.current) {
        return
      }

      const requestId = communityCharactersRequestVersionRef.current + 1
      communityCharactersRequestVersionRef.current = requestId
      communityCharactersRequestInFlightRef.current = true
      if (append) {
        setIsCommunityCharactersLoadingMore(true)
      } else {
        setIsCommunityCharactersLoading(true)
      }
      setCommunityWorldsError('')
      try {
        const characters = await listCommunityCharacters(authToken, {
          limit: COMMUNITY_CARD_BATCH_SIZE + 1,
          offset,
          sort: characterSortMode,
          query: normalizedSearchQuery || undefined,
          addedFilter: characterAddedFilter,
        })
        if (requestId !== communityCharactersRequestVersionRef.current) {
          return
        }
        const visibleCharacters = characters.slice(0, COMMUNITY_CARD_BATCH_SIZE)
        setCommunityCharacters((previous) => (append ? mergeCommunityItemsById(previous, visibleCharacters) : visibleCharacters))
        setHasMoreCommunityCharactersServer(characters.length > COMMUNITY_CARD_BATCH_SIZE)
      } catch (error) {
        if (requestId !== communityCharactersRequestVersionRef.current) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей сообщества'
        setCommunityWorldsError(detail)
        setHasMoreCommunityCharactersServer(false)
        if (!append) {
          setCommunityCharacters([])
        }
      } finally {
        if (requestId === communityCharactersRequestVersionRef.current) {
          communityCharactersRequestInFlightRef.current = false
          if (append) {
            setIsCommunityCharactersLoadingMore(false)
          } else {
            setIsCommunityCharactersLoading(false)
          }
        }
      }
    },
    [authToken, characterAddedFilter, characterSortMode, normalizedSearchQuery],
  )

  const loadCommunityInstructionTemplates = useCallback(
    async (options?: { append?: boolean; offset?: number }) => {
      const append = options?.append === true
      const offset = Math.max(0, Math.trunc(options?.offset ?? 0))
      if (communityInstructionTemplatesRequestInFlightRef.current) {
        return
      }

      const requestId = communityInstructionTemplatesRequestVersionRef.current + 1
      communityInstructionTemplatesRequestVersionRef.current = requestId
      communityInstructionTemplatesRequestInFlightRef.current = true
      if (append) {
        setIsCommunityInstructionTemplatesLoadingMore(true)
      } else {
        setIsCommunityInstructionTemplatesLoading(true)
      }
      setCommunityWorldsError('')
      try {
        const templates = await listCommunityInstructionTemplates(authToken, {
          limit: COMMUNITY_CARD_BATCH_SIZE + 1,
          offset,
          sort: instructionSortMode,
          query: normalizedSearchQuery || undefined,
          addedFilter: instructionAddedFilter,
        })
        if (requestId !== communityInstructionTemplatesRequestVersionRef.current) {
          return
        }
        const visibleTemplates = templates.slice(0, COMMUNITY_CARD_BATCH_SIZE)
        setCommunityInstructionTemplates((previous) =>
          append ? mergeCommunityItemsById(previous, visibleTemplates) : visibleTemplates,
        )
        setHasMoreCommunityInstructionTemplatesServer(templates.length > COMMUNITY_CARD_BATCH_SIZE)
      } catch (error) {
        if (requestId !== communityInstructionTemplatesRequestVersionRef.current) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить инструкции сообщества'
        setCommunityWorldsError(detail)
        setHasMoreCommunityInstructionTemplatesServer(false)
        if (!append) {
          setCommunityInstructionTemplates([])
        }
      } finally {
        if (requestId === communityInstructionTemplatesRequestVersionRef.current) {
          communityInstructionTemplatesRequestInFlightRef.current = false
          if (append) {
            setIsCommunityInstructionTemplatesLoadingMore(false)
          } else {
            setIsCommunityInstructionTemplatesLoading(false)
          }
        }
      }
    },
    [authToken, instructionAddedFilter, instructionSortMode, normalizedSearchQuery],
  )

  useEffect(() => {
    if (activeSection !== 'worlds') {
      return
    }
    communityWorldsRequestVersionRef.current += 1
    communityWorldsRequestInFlightRef.current = false
    communityWorldsLoadMoreTriggeredRef.current = 0
    setCommunityWorlds([])
    setHasMoreCommunityWorldsServer(false)
    void loadCommunityWorlds({ offset: 0 })
  }, [activeSection, loadCommunityWorlds])

  useEffect(() => {
    if (activeSection !== 'characters') {
      return
    }
    communityCharactersRequestVersionRef.current += 1
    communityCharactersRequestInFlightRef.current = false
    communityCharactersLoadMoreTriggeredRef.current = 0
    setCommunityCharacters([])
    setHasMoreCommunityCharactersServer(false)
    void loadCommunityCharacters({ offset: 0 })
  }, [activeSection, loadCommunityCharacters])

  useEffect(() => {
    if (activeSection !== 'rules') {
      return
    }
    communityInstructionTemplatesRequestVersionRef.current += 1
    communityInstructionTemplatesRequestInFlightRef.current = false
    communityInstructionTemplatesLoadMoreTriggeredRef.current = 0
    setCommunityInstructionTemplates([])
    setHasMoreCommunityInstructionTemplatesServer(false)
    void loadCommunityInstructionTemplates({ offset: 0 })
  }, [activeSection, loadCommunityInstructionTemplates])

  useEffect(() => {
    if (loadMoreCommunityWorldsSignal <= 0) {
      return
    }
    if (
      activeSection !== 'worlds' ||
      !hasMoreCommunityWorldsServer ||
      communityWorldsLoadMoreTriggeredRef.current === loadMoreCommunityWorldsSignal
    ) {
      return
    }
    communityWorldsLoadMoreTriggeredRef.current = loadMoreCommunityWorldsSignal
    void loadCommunityWorlds({ append: true, offset: communityWorlds.length })
  }, [
    activeSection,
    communityWorlds.length,
    hasMoreCommunityWorldsServer,
    loadCommunityWorlds,
    loadMoreCommunityWorldsSignal,
  ])

  useEffect(() => {
    if (loadMoreCommunityCharactersSignal <= 0) {
      return
    }
    if (
      activeSection !== 'characters' ||
      !hasMoreCommunityCharactersServer ||
      communityCharactersLoadMoreTriggeredRef.current === loadMoreCommunityCharactersSignal
    ) {
      return
    }
    communityCharactersLoadMoreTriggeredRef.current = loadMoreCommunityCharactersSignal
    void loadCommunityCharacters({ append: true, offset: communityCharacters.length })
  }, [
    activeSection,
    communityCharacters.length,
    hasMoreCommunityCharactersServer,
    loadCommunityCharacters,
    loadMoreCommunityCharactersSignal,
  ])

  useEffect(() => {
    if (loadMoreCommunityInstructionTemplatesSignal <= 0) {
      return
    }
    if (
      activeSection !== 'rules' ||
      !hasMoreCommunityInstructionTemplatesServer ||
      communityInstructionTemplatesLoadMoreTriggeredRef.current === loadMoreCommunityInstructionTemplatesSignal
    ) {
      return
    }
    communityInstructionTemplatesLoadMoreTriggeredRef.current = loadMoreCommunityInstructionTemplatesSignal
    void loadCommunityInstructionTemplates({ append: true, offset: communityInstructionTemplates.length })
  }, [
    activeSection,
    communityInstructionTemplates.length,
    hasMoreCommunityInstructionTemplatesServer,
    loadCommunityInstructionTemplates,
    loadMoreCommunityInstructionTemplatesSignal,
  ])

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

  const syncCommunityWorldGameIds = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force ?? false
    if (hasLoadedCommunityWorldGameIdsRef.current && !forceReload) {
      return
    }
    try {
      const games = await listStoryGames(authToken, { compact: true })
      setCommunityWorldGameIds(buildCommunityWorldGameMap(games))
      hasLoadedCommunityWorldGameIdsRef.current = true
    } catch {
      // Optional data for dialog button state; ignore failures.
    }
  }, [authToken])

  const handleOpenCommunityModerationMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, target: CommunityModerationTarget) => {
      if (!canModerateCommunityCards || isCommunityModerationSaving) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setActionError('')
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
      setActionError('')
      setCommunityWorldsError('')
      setIsCommunityModerationSaving(true)
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
          setSelectedCommunityCharacter((previous) => (previous?.id === target.id ? null : previous))
        } else {
          await returnInstructionTemplateToModerationAsAdmin({ token: authToken, template_id: target.id })
          setCommunityInstructionTemplates((previous) => previous.filter((item) => item.id !== target.id))
          setSelectedCommunityInstructionTemplate((previous) => (previous?.id === target.id ? null : previous))
        }
        setCommunityModerationAnchorEl(null)
        setCommunityModerationTarget(null)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось вернуть карточку на модерацию'
        setActionError(detail)
      } finally {
        setIsCommunityModerationSaving(false)
      }
    },
    [authToken, canModerateCommunityCards, isCommunityModerationSaving],
  )

  const handleOpenCommunityWorld = useCallback(
    async (worldId: number) => {
      if (isCommunityWorldDialogLoading) {
        return
      }
      setActionError('')
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
        void syncCommunityWorldGameIds()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть игру'
        setActionError(detail)
      } finally {
        setIsCommunityWorldDialogLoading(false)
      }
    },
    [authToken, isCommunityWorldDialogLoading, syncCommunityWorldGameIds],
  )

  useEffect(() => {
    if (hasAttemptedSharedWorldOpen || sharedWorldIdFromLink === null || isCommunityWorldDialogLoading) {
      return
    }
    setHasAttemptedSharedWorldOpen(true)
    void handleOpenCommunityWorld(sharedWorldIdFromLink)
  }, [handleOpenCommunityWorld, hasAttemptedSharedWorldOpen, isCommunityWorldDialogLoading, sharedWorldIdFromLink])

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
  }, [isCommunityRatingSaving, isCommunityReportSubmitting, isCommunityWorldDialogLoading, isCommunityWorldMyGamesSaving, isLaunchingCommunityWorld])

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
    setActionError('')
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
      setActionError(detail)
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
      setActionError('')
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
        setActionError(detail)
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
      setActionError('')
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
        const detail = error instanceof Error ? error.message : 'Не удалось обновить избранные игры'
        setActionError(detail)
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

  const handleOpenCommunityCharacter = useCallback(
    async (characterId: number) => {
      if (isCommunityCharacterLoading) {
        return
      }
      setActionError('')
      setIsCommunityCharacterLoading(true)
      try {
        const payload = await getCommunityCharacter({
          token: authToken,
          characterId,
        })
        setSelectedCommunityCharacter(payload)
        setCommunityCharacterRatingDraft(payload.user_rating ?? 0)
        setCommunityCharacters((previous) => previous.map((item) => (item.id === payload.id ? payload : item)))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть карточку персонажа'
        setActionError(detail)
      } finally {
        setIsCommunityCharacterLoading(false)
      }
    },
    [authToken, isCommunityCharacterLoading],
  )

  const handleRateCommunityCharacter = useCallback(async (ratingValue: number) => {
    if (!selectedCommunityCharacter || isCommunityCharacterRatingSaving || ratingValue < 1 || ratingValue > 5) {
      return
    }
    setCommunityCharacterRatingDraft(ratingValue)
    setActionError('')
    setIsCommunityCharacterRatingSaving(true)
    try {
      const updatedCharacter = await rateCommunityCharacter({
        token: authToken,
        characterId: selectedCommunityCharacter.id,
        rating: ratingValue,
      })
      setSelectedCommunityCharacter(updatedCharacter)
      setCommunityCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setActionError(detail)
    } finally {
      setIsCommunityCharacterRatingSaving(false)
    }
  }, [authToken, isCommunityCharacterRatingSaving, selectedCommunityCharacter])

  const handleAddCommunityCharacter = useCallback(async () => {
    if (
      !selectedCommunityCharacter ||
      isCommunityCharacterAddSaving ||
      selectedCommunityCharacter.is_added_by_user ||
      selectedCommunityCharacter.author_id === user.id
    ) {
      return
    }
    setActionError('')
    setIsCommunityCharacterAddSaving(true)
    try {
      const updatedCharacter = await addCommunityCharacter({
        token: authToken,
        characterId: selectedCommunityCharacter.id,
      })
      setSelectedCommunityCharacter(updatedCharacter)
      setCommunityCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось добавить персонажа'
      setActionError(detail)
    } finally {
      setIsCommunityCharacterAddSaving(false)
    }
  }, [authToken, isCommunityCharacterAddSaving, selectedCommunityCharacter, user.id])

  const handleOpenCommunityInstructionTemplate = useCallback(
    async (templateId: number) => {
      if (isCommunityInstructionTemplateLoading) {
        return
      }
      setActionError('')
      setIsCommunityInstructionTemplateLoading(true)
      try {
        const payload = await getCommunityInstructionTemplate({
          token: authToken,
          templateId,
        })
        setSelectedCommunityInstructionTemplate(payload)
        setCommunityInstructionRatingDraft(payload.user_rating ?? 0)
        setCommunityInstructionTemplates((previous) => previous.map((item) => (item.id === payload.id ? payload : item)))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть инструкцию'
        setActionError(detail)
      } finally {
        setIsCommunityInstructionTemplateLoading(false)
      }
    },
    [authToken, isCommunityInstructionTemplateLoading],
  )

  const handleRateCommunityInstructionTemplate = useCallback(async (ratingValue: number) => {
    if (!selectedCommunityInstructionTemplate || isCommunityInstructionRatingSaving || ratingValue < 1 || ratingValue > 5) {
      return
    }
    setCommunityInstructionRatingDraft(ratingValue)
    setActionError('')
    setIsCommunityInstructionRatingSaving(true)
    try {
      const updatedTemplate = await rateCommunityInstructionTemplate({
        token: authToken,
        templateId: selectedCommunityInstructionTemplate.id,
        rating: ratingValue,
      })
      setSelectedCommunityInstructionTemplate(updatedTemplate)
      setCommunityInstructionTemplates((previous) => previous.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setActionError(detail)
    } finally {
      setIsCommunityInstructionRatingSaving(false)
    }
  }, [authToken, isCommunityInstructionRatingSaving, selectedCommunityInstructionTemplate])

  const handleAddCommunityInstructionTemplate = useCallback(async () => {
    if (
      !selectedCommunityInstructionTemplate ||
      isCommunityInstructionAddSaving ||
      selectedCommunityInstructionTemplate.is_added_by_user ||
      selectedCommunityInstructionTemplate.author_id === user.id
    ) {
      return
    }
    setActionError('')
    setIsCommunityInstructionAddSaving(true)
    try {
      const updatedTemplate = await addCommunityInstructionTemplate({
        token: authToken,
        templateId: selectedCommunityInstructionTemplate.id,
      })
      setSelectedCommunityInstructionTemplate(updatedTemplate)
      setCommunityInstructionTemplates((previous) => previous.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось добавить инструкцию'
      setActionError(detail)
    } finally {
      setIsCommunityInstructionAddSaving(false)
    }
  }, [authToken, isCommunityInstructionAddSaving, selectedCommunityInstructionTemplate, user.id])

  const resetCommunityEntityReportDialog = useCallback(() => {
    setIsCommunityEntityReportCloseConfirmOpen(false)
    setCommunityEntityReportTarget(null)
    setCommunityEntityReportReasonDraft('other')
    setCommunityEntityReportDescriptionDraft('')
    setCommunityEntityReportValidationError('')
  }, [])

  const hasCommunityEntityReportUnsavedChanges =
    communityEntityReportReasonDraft !== 'other' || Boolean(communityEntityReportDescriptionDraft.trim())

  const handleCloseCommunityEntityReportDialog = useCallback(() => {
    if (isCommunityEntityReportSubmitting) {
      return
    }
    if (hasCommunityEntityReportUnsavedChanges) {
      setIsCommunityEntityReportCloseConfirmOpen(true)
      return
    }
    resetCommunityEntityReportDialog()
  }, [hasCommunityEntityReportUnsavedChanges, isCommunityEntityReportSubmitting, resetCommunityEntityReportDialog])

  const handleOpenCharacterReportDialog = useCallback(() => {
    if (!selectedCommunityCharacter || selectedCommunityCharacter.is_reported_by_user || isCommunityEntityReportSubmitting) {
      return
    }
    setCommunityEntityReportTarget('character')
    setCommunityEntityReportReasonDraft('other')
    setCommunityEntityReportDescriptionDraft('')
    setCommunityEntityReportValidationError('')
  }, [isCommunityEntityReportSubmitting, selectedCommunityCharacter])

  const handleOpenInstructionTemplateReportDialog = useCallback(() => {
    if (
      !selectedCommunityInstructionTemplate ||
      selectedCommunityInstructionTemplate.is_reported_by_user ||
      isCommunityEntityReportSubmitting
    ) {
      return
    }
    setCommunityEntityReportTarget('instruction_template')
    setCommunityEntityReportReasonDraft('other')
    setCommunityEntityReportDescriptionDraft('')
    setCommunityEntityReportValidationError('')
  }, [isCommunityEntityReportSubmitting, selectedCommunityInstructionTemplate])

  const handleSubmitCommunityEntityReport = useCallback(async () => {
    if (!communityEntityReportTarget || isCommunityEntityReportSubmitting) {
      return
    }

    const normalizedDescription = communityEntityReportDescriptionDraft.trim()
    if (!normalizedDescription) {
      setCommunityEntityReportValidationError('Опишите причину жалобы.')
      return
    }

    setActionError('')
    setCommunityEntityReportValidationError('')
    setIsCommunityEntityReportSubmitting(true)
    try {
      if (communityEntityReportTarget === 'character') {
        if (!selectedCommunityCharacter) {
          throw new Error('Персонаж не выбран')
        }
        const updatedCharacter = await reportCommunityCharacter({
          token: authToken,
          characterId: selectedCommunityCharacter.id,
          reason: communityEntityReportReasonDraft,
          description: normalizedDescription,
        })
        setSelectedCommunityCharacter(updatedCharacter)
        setCommunityCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
      } else {
        if (!selectedCommunityInstructionTemplate) {
          throw new Error('Инструкция не выбрана')
        }
        const updatedTemplate = await reportCommunityInstructionTemplate({
          token: authToken,
          templateId: selectedCommunityInstructionTemplate.id,
          reason: communityEntityReportReasonDraft,
          description: normalizedDescription,
        })
        setSelectedCommunityInstructionTemplate(updatedTemplate)
        setCommunityInstructionTemplates((previous) => previous.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)))
      }
      resetCommunityEntityReportDialog()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отправить жалобу'
      setActionError(detail)
    } finally {
      setIsCommunityEntityReportSubmitting(false)
    }
  }, [
    authToken,
    communityEntityReportDescriptionDraft,
    communityEntityReportReasonDraft,
    communityEntityReportTarget,
    isCommunityEntityReportSubmitting,
    resetCommunityEntityReportDialog,
    selectedCommunityCharacter,
    selectedCommunityInstructionTemplate,
  ])

  const handleLaunchCommunityWorld = useCallback(async () => {
    if (!selectedCommunityWorld || isLaunchingCommunityWorld) {
      return
    }
    const worldId = selectedCommunityWorld.world.id
    setActionError('')
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
      onNavigate(`/home/${game.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось запустить игру'
      setActionError(detail)
    } finally {
      setIsLaunchingCommunityWorld(false)
    }
  }, [authToken, isLaunchingCommunityWorld, onNavigate, selectedCommunityWorld])

  const isPhoneLayout = useMediaQuery('(max-width:899.95px)')

  // Close mobile search when switching to desktop
  useEffect(() => {
    if (!isPhoneLayout && isMobileSearchOpen) {
      setIsMobileSearchOpen(false)
    }
  }, [isPhoneLayout, isMobileSearchOpen])

  const profileName = user.display_name || 'Игрок'

  const handleToggleCommunityWorldInMyGames = useCallback(async () => {
    if (!selectedCommunityWorld || isCommunityWorldMyGamesSaving || isLaunchingCommunityWorld) {
      return
    }

    const worldId = selectedCommunityWorld.world.id
    setActionError('')
    setIsCommunityWorldMyGamesSaving(true)
    try {
      let gameMapSnapshot = communityWorldGameIds
      try {
        const games = await listStoryGames(authToken, { compact: true })
        gameMapSnapshot = buildCommunityWorldGameMap(games)
        setCommunityWorldGameIds(gameMapSnapshot)
      } catch {
        // Keep local cache when metadata refresh fails.
      }

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
        setCommunityWorldGameIds((previous) => {
          const nextMap = { ...previous }
          delete nextMap[worldId]
          return nextMap
        })
        return
      }

      const game = await launchCommunityWorld({
        token: authToken,
        worldId,
      })
      setCommunityWorldGameIds((previous) => ({
        ...previous,
        [worldId]: [...new Set([...(previous[worldId] ?? []), game.id])],
      }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить список "Мои игры"'
      setActionError(detail)
    } finally {
      setIsCommunityWorldMyGamesSaving(false)
      void syncCommunityWorldGameIds({ force: true })
    }
  }, [
    authToken,
    communityWorldGameIds,
    isCommunityWorldMyGamesSaving,
    isLaunchingCommunityWorld,
    selectedCommunityWorld,
    syncCommunityWorldGameIds,
  ])

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

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to load top-up plans'
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
      const detail = error instanceof Error ? error.message : 'Failed to create payment'
      setTopUpError(detail)
      setActivePlanPurchaseId(null)
    }
  }

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }

  const selectedCommunityWorldGameIds = selectedCommunityWorld ? communityWorldGameIds[selectedCommunityWorld.world.id] ?? [] : []
  const isSelectedCommunityWorldInMyGames = selectedCommunityWorldGameIds.length > 0
  const isSelectedCommunityCharacterOwnedByUser = selectedCommunityCharacter?.author_id === user.id
  const selectedCommunityCharacterNote = selectedCommunityCharacter?.note.trim() ?? ''
  const isSelectedCommunityInstructionOwnedByUser = selectedCommunityInstructionTemplate?.author_id === user.id

  const handleOpenEncouragementDialog = useCallback((target: EncouragementTarget) => {
    setEncouragementTarget(target)
    setEncouragementAmount('5')
    setEncouragementMessage('')
    setEncouragementError('')
  }, [])

  const handleSubmitEncouragement = useCallback(async () => {
    if (!encouragementTarget || isEncouragementSubmitting) {
      return
    }
    const amount = Number.parseInt(encouragementAmount, 10)
    if (!Number.isFinite(amount) || amount < 5) {
      setEncouragementError('Минимальная сумма — 5.')
      return
    }
    setIsEncouragementSubmitting(true)
    setEncouragementError('')
    try {
      const response = await createPublicationEncouragement({
        token: authToken,
        target_type: encouragementTarget.target_type,
        target_id: encouragementTarget.target_id,
        amount_coins: amount,
        message: encouragementMessage.trim(),
      })
      onUserUpdate(response.user)
      setEncouragementTarget(null)
      setEncouragementMessage('')
      setEncouragementAmount('5')
    } catch (requestError) {
      setEncouragementError(requestError instanceof Error ? requestError.message : 'Не удалось отправить поддержку')
    } finally {
      setIsEncouragementSubmitting(false)
    }
  }, [authToken, encouragementAmount, encouragementMessage, encouragementTarget, isEncouragementSubmitting, onUserUpdate])

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
        mobileActionItems={buildUnifiedMobileQuickActions({
          onContinue: () => onNavigate('/dashboard?mobileAction=continue'),
          onQuickStart: () => onNavigate('/dashboard?mobileAction=quick-start'),
          onCreateWorld: () => onNavigate('/worlds/new'),
          onOpenShop: handleOpenTopUpDialog,
        })}
        menuItems={[
          { key: 'dashboard', label: 'Главная', onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Мои публикации', onClick: () => onNavigate('/games/publications') },
          { key: 'community-worlds', label: 'Сообщество', isActive: true, onClick: () => onNavigate('/games/all') },
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
        centerSlot={
          <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
            <Box
              component="input"
              type="text"
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value.slice(0, 120))}
              placeholder="Поиск"
              aria-label="Поиск по сообществу"
              sx={{
                width: '100%',
                height: '100%',
                borderRadius: '9999px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                pl: '16px',
                pr: '44px',
                outline: 'none',
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                transition: 'border-color 180ms ease',
                '&::placeholder': { color: 'var(--morius-text-secondary)' },
                '&:focus': { borderColor: 'color-mix(in srgb, var(--morius-accent) 60%, var(--morius-card-border))' },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                right: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--morius-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <ThemedSvgIcon markup={searchIconRaw} size={18} />
            </Box>
          </Box>
        }
        rightActions={
          <Stack direction="row" spacing={1} alignItems="center">
            {isPhoneLayout ? (
              <IconButton
                aria-label="Открыть поиск"
                onClick={() => setIsMobileSearchOpen(true)}
                sx={{
                  color: 'var(--morius-text-secondary)',
                  p: 0.5,
                  transition: 'color 180ms ease',
                  '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
                  '&:active': { backgroundColor: 'transparent' },
                }}
              >
                <ThemedSvgIcon markup={searchIconRaw} size={20} />
              </IconButton>
            ) : null}
            <HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} />
          </Stack>
        }
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto' }}>
          {actionError ? (
            <Alert severity="error" onClose={() => setActionError('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {actionError}
            </Alert>
          ) : null}

          {/* Tabs — use Box component="button" to avoid global MUI Button CSS overrides */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: '8px', mb: '27px', flexWrap: 'wrap' }}>
            {([
              { key: 'worlds', label: 'Игры', icon: communityPlayRaw },
              { key: 'characters', label: 'Персонажи', icon: cardsPlotRaw },
              { key: 'rules', label: 'Правила', icon: cardsRulesRaw },
            ] as const).map(({ key, label, icon }) => {
              const isActive = activeSection === key
              return (
                <Box
                  key={key}
                  component="button"
                  type="button"
                  onClick={() => setActiveSection(key)}
                  aria-pressed={isActive}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    height: '38px',
                    px: '16px',
                    borderRadius: '48px',
                    fontSize: '16px',
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    lineHeight: 1,
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: isActive ? 'var(--morius-title-text)' : APP_TEXT_SECONDARY,
                    boxShadow: isActive ? '0 14px 28px -24px rgba(0,0,0,0.78)' : 'none',
                    transition: 'box-shadow 250ms ease, color 200ms ease',
                    '&:hover': { color: 'var(--morius-title-text)' },
                    '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                  }}
                >
                  <ThemedSvgIcon markup={icon} size={13} sx={{ flexShrink: 0, color: 'inherit' }} />
                  {label}
                </Box>
              )
            })}
          </Box>



          {/* Genre Filters — pill buttons with darker bg per engineer feedback */}
          {activeSection === 'worlds' && displayedWorldGenreOptions.length > 0 ? (
            <Box
              onMouseEnter={() => setIsGenreStripHovered(true)}
              onMouseLeave={() => setIsGenreStripHovered(false)}
              sx={{
                position: 'relative',
                mb: '16px',
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <IconButton
                aria-label="Прокрутить жанры влево"
                onClick={() => scrollGenreStrip('left')}
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 3,
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 90%, black 10%)',
                  color: APP_TEXT_PRIMARY,
                  opacity: isGenreStripHovered && canScrollGenresLeft ? 1 : 0,
                  pointerEvents: isGenreStripHovered && canScrollGenresLeft ? 'auto' : 'none',
                  transition: 'opacity 160ms ease, background-color 160ms ease',
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 78%, black 22%)',
                  },
                }}
              >
                <SvgIcon sx={{ width: 20, height: 20 }}>
                  <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
                </SvgIcon>
              </IconButton>
              <Box
                ref={genreScrollRef}
                onScroll={syncGenreScrollControls}
                onWheel={handleGenreWheel}
                onPointerDown={handleGenrePointerDown}
                onPointerMove={handleGenrePointerMove}
                onPointerUp={stopGenrePointerDrag}
                onPointerCancel={stopGenrePointerDrag}
                sx={{
                  display: 'flex',
                  flexWrap: 'nowrap',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  maxWidth: '100%',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  overscrollBehaviorX: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  px: '1px',
                  pb: '4px',
                  cursor: genreDragRef.current ? 'grabbing' : 'grab',
                  touchAction: 'pan-x',
                  '&::-webkit-scrollbar': {
                    display: 'none',
                  },
                }}
              >
                {displayedWorldGenreOptions.map((genre) => {
                  const isSelected = Array.isArray(worldGenreFilter) && worldGenreFilter.includes(genre)
                  return (
                    <Box
                      key={genre}
                      component="button"
                      type="button"
                      onClick={() => {
                        if (shouldSuppressGenreClickRef.current) {
                          shouldSuppressGenreClickRef.current = false
                          return
                        }
                        if (Array.isArray(worldGenreFilter)) {
                          if (isSelected) {
                            const newFilter = worldGenreFilter.filter((g) => g !== genre)
                            setWorldGenreFilter(newFilter.length === 0 ? 'all' : newFilter)
                          } else {
                            setWorldGenreFilter([...worldGenreFilter, genre])
                          }
                        } else {
                          setWorldGenreFilter([genre])
                        }
                      }}
                      sx={{
                        flex: '0 0 auto',
                        whiteSpace: 'nowrap',
                        px: '14px',
                        py: '8px',
                        border: '1px solid',
                        borderColor: isSelected
                          ? 'color-mix(in srgb, var(--morius-accent) 28%, transparent)'
                          : 'color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                        outline: 'none',
                        cursor: 'pointer',
                        borderRadius: '9999px',
                        fontSize: '16px',
                        fontWeight: isSelected ? 700 : 500,
                        fontFamily: 'inherit',
                        lineHeight: 1.4,
                        userSelect: 'none',
                        backgroundColor: isSelected
                          ? 'color-mix(in srgb, var(--morius-app-bg) 76%, var(--morius-accent))'
                          : 'color-mix(in srgb, var(--morius-app-bg) 78%, black)',
                        color: isSelected ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                        transition: 'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                        '&:hover': {
                          backgroundColor: isSelected
                            ? 'color-mix(in srgb, var(--morius-app-bg) 70%, var(--morius-accent))'
                            : 'color-mix(in srgb, var(--morius-app-bg) 72%, black)',
                          color: isSelected ? 'var(--morius-accent)' : 'var(--morius-title-text)',
                        },
                        '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                      }}
                    >
                      {genre}
                    </Box>
                  )
                })}
              </Box>
              <IconButton
                aria-label="Прокрутить жанры вправо"
                onClick={() => scrollGenreStrip('right')}
                sx={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 3,
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 90%, black 10%)',
                  color: APP_TEXT_PRIMARY,
                  opacity: isGenreStripHovered && canScrollGenresRight ? 1 : 0,
                  pointerEvents: isGenreStripHovered && canScrollGenresRight ? 'auto' : 'none',
                  transition: 'opacity 160ms ease, background-color 160ms ease',
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 78%, black 22%)',
                  },
                }}
              >
                <SvgIcon sx={{ width: 20, height: 20 }}>
                  <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor" />
                </SvgIcon>
              </IconButton>
            </Box>
          ) : null}

          {/* Sort/Filter Controls — compact pill selects per Figma (30px h, radius 12px) */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: '20px' }}>
            {activeSection === 'worlds' ? (
              <>
                {/* Sort select */}
                <FormControl sx={{ position: 'relative', borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND }}>
                  <Select
                    value={worldSortMode}
                    onChange={(event: SelectChangeEvent) => setWorldSortMode(event.target.value as CommunityWorldSortMode)}
                    IconComponent={() => null}
                    sx={{
                      height: '38px',
                      color: APP_TEXT_PRIMARY,
                      fontSize: '16px',
                      fontWeight: 700,
                      '& .MuiSelect-select': {
                        py: '0 !important',
                        pl: '14px',
                        pr: '30px !important',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        boxSizing: 'border-box',
                      },
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none !important', borderRadius: '12px !important' },
                    }}
                    MenuProps={{ PaperProps: { sx: { mt: 0.5, borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND, color: APP_TEXT_PRIMARY, boxShadow: '0 18px 36px rgba(0,0,0,0.5)' } } }}
                  >
                    {WORLD_SORT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value} sx={{ fontSize: '16px', fontWeight: 700, color: APP_TEXT_PRIMARY, '&.Mui-selected': { backgroundColor: APP_BUTTON_ACTIVE }, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{o.label}</MenuItem>
                    ))}
                  </Select>
                  <Box sx={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', color: APP_TEXT_SECONDARY, pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
                    <FilterGlyph />
                  </Box>
                </FormControl>
                {/* Age/rating filter */}
                <FormControl sx={{ position: 'relative', borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND }}>
                  <Select
                    value={worldAgeFilter}
                    onChange={(event: SelectChangeEvent) => setWorldAgeFilter(event.target.value as CommunityWorldAgeFilter)}
                    IconComponent={() => null}
                    sx={{
                      height: '38px',
                      color: APP_TEXT_PRIMARY,
                      fontSize: '16px',
                      fontWeight: 700,
                      '& .MuiSelect-select': {
                        py: '0 !important',
                        pl: '14px',
                        pr: '30px !important',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        boxSizing: 'border-box',
                      },
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none !important', borderRadius: '12px !important' },
                    }}
                    MenuProps={{ PaperProps: { sx: { mt: 0.5, borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND, color: APP_TEXT_PRIMARY, boxShadow: '0 18px 36px rgba(0,0,0,0.5)' } } }}
                  >
                    {AGE_FILTER_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value} sx={{ fontSize: '16px', fontWeight: 700, color: APP_TEXT_PRIMARY, '&.Mui-selected': { backgroundColor: APP_BUTTON_ACTIVE }, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{o.label}</MenuItem>
                    ))}
                  </Select>
                  <Box sx={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', color: APP_TEXT_SECONDARY, pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
                    <FilterGlyph />
                  </Box>
                </FormControl>
              </>
            ) : (
              <>
                {/* Card sort */}
                <FormControl sx={{ position: 'relative', borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND }}>
                  <Select
                    value={activeSection === 'characters' ? characterSortMode : instructionSortMode}
                    onChange={(event: SelectChangeEvent) => {
                      const nextValue = event.target.value as CommunityCardSortMode
                      if (activeSection === 'characters') { setCharacterSortMode(nextValue) } else { setInstructionSortMode(nextValue) }
                    }}
                    IconComponent={() => null}
                    sx={{
                      height: '38px',
                      color: APP_TEXT_PRIMARY,
                      fontSize: '16px',
                      fontWeight: 700,
                      '& .MuiSelect-select': {
                       py: '0 !important',
                        pl: '14px',
                        pr: '30px !important',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        boxSizing: 'border-box',
                      },
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none !important', borderWidth: '0 !important' },
                    }}
                    MenuProps={{ PaperProps: { sx: { mt: 0.5, borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND, color: APP_TEXT_PRIMARY, boxShadow: '0 18px 36px rgba(0,0,0,0.5)' } } }}
                  >
                    {CARD_SORT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value} sx={{ fontSize: '16px', fontWeight: 700, color: APP_TEXT_PRIMARY, '&.Mui-selected': { backgroundColor: APP_BUTTON_ACTIVE }, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{o.label}</MenuItem>
                    ))}
                  </Select>
                  <Box sx={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', color: APP_TEXT_SECONDARY, pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
                    <FilterGlyph />
                  </Box>
                </FormControl>
                {/* Added filter */}
                <FormControl sx={{ position: 'relative', borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND }}>
                  <Select
                    value={activeSection === 'characters' ? characterAddedFilter : instructionAddedFilter}
                    onChange={(event: SelectChangeEvent) => {
                      const nextValue = event.target.value as CommunityAddedFilter
                      if (activeSection === 'characters') { setCharacterAddedFilter(nextValue) } else { setInstructionAddedFilter(nextValue) }
                    }}
                    IconComponent={() => null}
                    sx={{
                      height: '38px',
                      color: APP_TEXT_PRIMARY,
                      fontSize: '16px',
                      fontWeight: 700,
                      '& .MuiSelect-select': {
                        py: '0 !important',
                        pl: '14px',
                        pr: '30px !important',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        boxSizing: 'border-box',
                      },
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none !important', borderWidth: '0 !important' },
                    }}
                    MenuProps={{ PaperProps: { sx: { mt: 0.5, borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND, color: APP_TEXT_PRIMARY, boxShadow: '0 18px 36px rgba(0,0,0,0.5)' } } }}
                  >
                    {ADDED_FILTER_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value} sx={{ fontSize: '16px', fontWeight: 700, color: APP_TEXT_PRIMARY, '&.Mui-selected': { backgroundColor: APP_BUTTON_ACTIVE }, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{o.label}</MenuItem>
                    ))}
                  </Select>
                  <Box sx={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', color: APP_TEXT_SECONDARY, pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
                    <FilterGlyph />
                  </Box>
                </FormControl>
              </>
            )}
          </Box>

          {/* Cards Grid Section */}

          {communityWorldsError ? (
            <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>
              {communityWorldsError}
            </Alert>
          ) : null}

          <Fade in={activeSection === 'worlds'} timeout={300} unmountOnExit>
            <Box>
              {isCommunityWorldsLoading && communityWorlds.length === 0 ? (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.4,
                    gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                  }}
                >
                  {COMMUNITY_WORLD_SKELETON_CARD_KEYS.map((cardKey) => (
                    <CommunityWorldCardSkeleton key={cardKey} showFavoriteButton />
                  ))}
                </Box>
              ) : communityWorlds.length === 0 ? (
                <Box
                  sx={{
                    borderRadius: 'var(--morius-radius)',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    background: APP_CARD_BACKGROUND,
                    p: 1.4,
                  }}
                >
                  <Typography sx={{ color: APP_TEXT_SECONDARY }}>Пока нет публичных игр от игроков.</Typography>
                </Box>
              ) : filteredCommunityWorlds.length === 0 ? (
                <Box
                  sx={{
                    borderRadius: 'var(--morius-radius)',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    background: APP_CARD_BACKGROUND,
                    p: 1.4,
                  }}
                >
                  <Typography sx={{ color: APP_TEXT_SECONDARY }}>По выбранным фильтрам игры не найдены.</Typography>
                </Box>
              ) : (
              <>
                  {/* Desktop: portrait cards */}
                  <Box sx={{ display: { xs: 'none', sm: 'grid' }, gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                    {visibleCommunityWorlds.map((world) => (
                      <CommunityModerationCardFrame
                        key={world.id}
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
                    ))}
                  </Box>
                  {/* Mobile: landscape card list */}
                  <Stack spacing={1.6} sx={{ display: { xs: 'flex', sm: 'none' } }}>
                    {visibleCommunityWorlds.map((world) => (
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
                  </Stack>
                  {hasMoreCommunityWorlds ? <Box ref={loadMoreCommunityWorldsRef} sx={{ height: 32, width: '100%' }} /> : null}
                  {isCommunityWorldsLoadingMore ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ pt: 0.8 }}>
                      <CircularProgress size={22} />
                    </Stack>
                  ) : null}
                </>
              )}
            </Box>
          </Fade>
          <Fade in={activeSection === 'characters'} timeout={300} unmountOnExit>
            <Box>
              {isCommunityCharactersLoading && communityCharacters.length === 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.4,
                  gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                }}
              >
                {COMMUNITY_WORLD_SKELETON_CARD_KEYS.map((cardKey) => (
                  <CommunityWorldCardSkeleton key={cardKey} />
                ))}
              </Box>
            ) : communityCharacters.length === 0 ? (
              <Box
                sx={{
                  borderRadius: 'var(--morius-radius)',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  background: APP_CARD_BACKGROUND,
                  p: 1.4,
                }}
              >
                <Typography sx={{ color: APP_TEXT_SECONDARY }}>Пока нет публичных персонажей.</Typography>
              </Box>
            ) : filteredCommunityCharacters.length === 0 ? (
              <Box
                sx={{
                  borderRadius: 'var(--morius-radius)',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  background: APP_CARD_BACKGROUND,
                  p: 1.4,
                }}
              >
                <Typography sx={{ color: APP_TEXT_SECONDARY }}>По выбранным фильтрам персонажи не найдены.</Typography>
              </Box>
            ) : (
              <>
                {/* Desktop: portrait cards */}
                <Box sx={{ display: { xs: 'none', sm: 'grid' }, gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                  {visibleCommunityCharacters.map((item) => (
                    <CommunityModerationCardFrame
                      key={item.id}
                      canModerate={canModerateCommunityCards}
                      disabled={isCommunityModerationSaving}
                      onOpenMenu={(event) =>
                        handleOpenCommunityModerationMenu(event, { kind: 'character', id: item.id, title: item.name })
                      }
                    >
                      <CommunityCharacterCard
                        item={item}
                        currentUserId={user.id}
                        disabled={isCommunityCharacterLoading}
                        onClick={() => void handleOpenCommunityCharacter(item.id)}
                      />
                    </CommunityModerationCardFrame>
                  ))}
                </Box>
                {/* Mobile: landscape card list — no play button for characters */}
                <Stack spacing={1.6} sx={{ display: { xs: 'flex', sm: 'none' } }}>
                  {visibleCommunityCharacters.map((item) => (
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
                      onClick={() => void handleOpenCommunityCharacter(item.id)}
                    />
                  ))}
                </Stack>
                {hasMoreCommunityCharacters ? (
                  <Box ref={loadMoreCommunityCharactersRef} sx={{ height: 32, width: '100%' }} />
                ) : null}
                {isCommunityCharactersLoadingMore ? (
                  <Stack alignItems="center" justifyContent="center" sx={{ pt: 0.8 }}>
                    <CircularProgress size={22} />
                  </Stack>
                ) : null}
              </>
              )}
            </Box>
          </Fade>
          <Fade in={activeSection === 'rules'} timeout={300} unmountOnExit>
            <Box>
              {isCommunityInstructionTemplatesLoading && communityInstructionTemplates.length === 0 ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
              }}
            >
              {COMMUNITY_WORLD_SKELETON_CARD_KEYS.map((cardKey) => (
                <CommunityWorldCardSkeleton key={cardKey} />
              ))}
            </Box>
          ) : communityInstructionTemplates.length === 0 ? (
            <Box
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                background: APP_CARD_BACKGROUND,
                p: 1.4,
              }}
            >
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>Пока нет публичных инструкций.</Typography>
            </Box>
          ) : filteredCommunityInstructionTemplates.length === 0 ? (
            <Box
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                background: APP_CARD_BACKGROUND,
                p: 1.4,
              }}
            >
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>По выбранным фильтрам инструкции не найдены.</Typography>
            </Box>
          ) : (
            <>
              {/* Desktop: portrait cards */}
              <Box sx={{ display: { xs: 'none', sm: 'grid' }, gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {visibleCommunityInstructionTemplates.map((item) => (
                  <CommunityModerationCardFrame
                    key={item.id}
                    canModerate={canModerateCommunityCards}
                    disabled={isCommunityModerationSaving}
                    onOpenMenu={(event) =>
                      handleOpenCommunityModerationMenu(event, {
                        kind: 'instruction_template',
                        id: item.id,
                        title: item.title,
                      })
                    }
                  >
                    <CommunityInstructionCard
                      item={item}
                      currentUserId={user.id}
                      disabled={isCommunityInstructionTemplateLoading}
                      onClick={() => void handleOpenCommunityInstructionTemplate(item.id)}
                    />
                  </CommunityModerationCardFrame>
                ))}
              </Box>
              {/* Mobile: landscape card list — no play button for rules */}
              <Stack spacing={1.6} sx={{ display: { xs: 'flex', sm: 'none' } }}>
                {visibleCommunityInstructionTemplates.map((item) => (
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
                    onClick={() => void handleOpenCommunityInstructionTemplate(item.id)}
                  />
                ))}
              </Stack>
              {hasMoreCommunityInstructionTemplates ? (
                <Box ref={loadMoreCommunityInstructionTemplatesRef} sx={{ height: 32, width: '100%' }} />
              ) : null}
              {isCommunityInstructionTemplatesLoadingMore ? (
                <Stack alignItems="center" justifyContent="center" sx={{ pt: 0.8 }}>
                  <CircularProgress size={22} />
                </Stack>
              ) : null}
              </>
              )}
            </Box>
          </Fade>
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
      <Dialog
        open={Boolean(selectedCommunityCharacter)}
        onClose={() => {
          if (
            isCommunityCharacterAddSaving ||
            isCommunityCharacterRatingSaving ||
            (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'character')
          ) {
            return
          }
          if (communityEntityReportTarget === 'character') {
            resetCommunityEntityReportDialog()
          }
          setSelectedCommunityCharacter(null)
          setCommunityCharacterRatingDraft(0)
        }}
        fullWidth
        maxWidth="sm"
        sx={{
          '& .MuiDialog-paper': {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            color: APP_TEXT_PRIMARY,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          },
          '& .MuiDialogTitle-root': {
            px: 3,
            pt: 2.2,
            pb: 0.8,
          },
          '& .MuiDialogContent-root': {
            px: 3,
            pb: 1.1,
          },
          '& .MuiDialogActions-root': {
            px: 3,
            pb: 2.2,
          },
        }}
      >
        <DialogTitle>{selectedCommunityCharacter?.name ?? ''}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.15} sx={{ pt: 0.45 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  width: 62,
                  height: 62,
                  borderRadius: '50%',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  overflow: 'hidden',
                  display: 'grid',
                  placeItems: 'center',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  color: APP_TEXT_PRIMARY,
                  fontSize: '1.24rem',
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                <ProgressiveAvatar
                  src={selectedCommunityCharacter?.avatar_url}
                  alt={selectedCommunityCharacter?.name ?? ''}
                  fallbackLabel={selectedCommunityCharacter?.name ?? ''}
                  size={62}
                  scale={Math.max(1, Math.min(3, selectedCommunityCharacter?.avatar_scale || 1))}
                  sx={{
                    width: '100%',
                    height: '100%',
                    color: APP_TEXT_PRIMARY,
                    fontSize: '1.24rem',
                    fontWeight: 800,
                  }}
                />
              </Box>
              <Stack spacing={0.12} sx={{ minWidth: 0 }}>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                  Автор: {selectedCommunityCharacter?.author_name ?? 'Неизвестный автор'}
                </Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                  {selectedCommunityCharacter ? formatCommunityDate(selectedCommunityCharacter.created_at) : ''}
                </Typography>
                {selectedCommunityCharacterNote ? (
                  <Box
                    title={selectedCommunityCharacterNote}
                    sx={{
                      mt: 0.38,
                      width: 'fit-content',
                      maxWidth: '100%',
                      px: 0.78,
                      py: 0.24,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.46)',
                      color: 'rgba(170, 238, 191, 0.96)',
                      fontSize: '0.69rem',
                      lineHeight: 1.2,
                      letterSpacing: 0.2,
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {selectedCommunityCharacterNote}
                  </Box>
                ) : null}
              </Stack>
            </Stack>
            <Typography sx={{ color: APP_TEXT_SECONDARY, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {selectedCommunityCharacter?.description ?? ''}
            </Typography>
            <Stack direction="row" spacing={0.6} alignItems="center">
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={`community-character-rate-${value}`}
                  onClick={() => void handleRateCommunityCharacter(value)}
                  disabled={
                    isCommunityCharacterRatingSaving ||
                    isCommunityCharacterAddSaving ||
                    (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'character')
                  }
                  sx={{
                    minWidth: 34,
                    minHeight: 34,
                    borderRadius: '999px',
                    p: 0,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    '&:hover': {
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                  }}
                >
                  {value <= communityCharacterRatingDraft ? '★' : '☆'}
                </Button>
              ))}
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700 }}>
                {selectedCommunityCharacter ? selectedCommunityCharacter.community_rating_avg.toFixed(1) : '0.0'}
              </Typography>
            </Stack>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Добавлений: {selectedCommunityCharacter?.community_additions_count ?? 0}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (
                isCommunityCharacterAddSaving ||
                isCommunityCharacterRatingSaving ||
                (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'character')
              ) {
                return
              }
              if (communityEntityReportTarget === 'character') {
                resetCommunityEntityReportDialog()
              }
              setSelectedCommunityCharacter(null)
              setCommunityCharacterRatingDraft(0)
            }}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            Закрыть
          </Button>
          <Button
            onClick={() => {
              if (!selectedCommunityCharacter) {
                return
              }
              handleOpenEncouragementDialog({
                target_type: 'character',
                target_id: selectedCommunityCharacter.id,
                title: selectedCommunityCharacter.name,
              })
            }}
            disabled={!selectedCommunityCharacter || isSelectedCommunityCharacterOwnedByUser}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            Поддержать
          </Button>
          <Button
            onClick={handleOpenCharacterReportDialog}
            disabled={
              !selectedCommunityCharacter ||
              isCommunityCharacterAddSaving ||
              isCommunityCharacterRatingSaving ||
              isCommunityEntityReportSubmitting ||
              selectedCommunityCharacter.is_reported_by_user
            }
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            {selectedCommunityCharacter?.is_reported_by_user ? 'Жалоба отправлена' : 'Пожаловаться'}
          </Button>
          <Button
            onClick={() => void handleAddCommunityCharacter()}
            disabled={
              !selectedCommunityCharacter ||
              isCommunityCharacterAddSaving ||
              isCommunityCharacterRatingSaving ||
              isCommunityEntityReportSubmitting ||
              selectedCommunityCharacter.is_added_by_user ||
              isSelectedCommunityCharacterOwnedByUser
            }
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: 'var(--morius-button-active)',
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            {isSelectedCommunityCharacterOwnedByUser
              ? 'Ваша карточка'
              : selectedCommunityCharacter?.is_added_by_user
                ? 'Добавлено'
                : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(selectedCommunityInstructionTemplate)}
        onClose={() => {
          if (
            isCommunityInstructionAddSaving ||
            isCommunityInstructionRatingSaving ||
            (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'instruction_template')
          ) {
            return
          }
          if (communityEntityReportTarget === 'instruction_template') {
            resetCommunityEntityReportDialog()
          }
          setSelectedCommunityInstructionTemplate(null)
          setCommunityInstructionRatingDraft(0)
        }}
        fullWidth
        maxWidth="sm"
        sx={{
          '& .MuiDialog-paper': {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            color: APP_TEXT_PRIMARY,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          },
          '& .MuiDialogTitle-root': {
            px: 3,
            pt: 2.2,
            pb: 0.8,
          },
          '& .MuiDialogContent-root': {
            px: 3,
            pb: 1.1,
          },
          '& .MuiDialogActions-root': {
            px: 3,
            pb: 2.2,
          },
        }}
      >
        <DialogTitle>{selectedCommunityInstructionTemplate?.title ?? ''}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.15} sx={{ pt: 0.45 }}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Автор: {selectedCommunityInstructionTemplate?.author_name ?? 'Неизвестный автор'}
            </Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
              {selectedCommunityInstructionTemplate ? formatCommunityDate(selectedCommunityInstructionTemplate.created_at) : ''}
            </Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {selectedCommunityInstructionTemplate?.content ?? ''}
            </Typography>
            <Stack direction="row" spacing={0.6} alignItems="center">
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={`community-template-rate-${value}`}
                  onClick={() => void handleRateCommunityInstructionTemplate(value)}
                  disabled={
                    isCommunityInstructionRatingSaving ||
                    isCommunityInstructionAddSaving ||
                    (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'instruction_template')
                  }
                  sx={{
                    minWidth: 34,
                    minHeight: 34,
                    borderRadius: '999px',
                    p: 0,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    '&:hover': {
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                  }}
                >
                  {value <= communityInstructionRatingDraft ? '★' : '☆'}
                </Button>
              ))}
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700 }}>
                {selectedCommunityInstructionTemplate ? selectedCommunityInstructionTemplate.community_rating_avg.toFixed(1) : '0.0'}
              </Typography>
            </Stack>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Добавлений: {selectedCommunityInstructionTemplate?.community_additions_count ?? 0}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (
                isCommunityInstructionAddSaving ||
                isCommunityInstructionRatingSaving ||
                (isCommunityEntityReportSubmitting && communityEntityReportTarget === 'instruction_template')
              ) {
                return
              }
              if (communityEntityReportTarget === 'instruction_template') {
                resetCommunityEntityReportDialog()
              }
              setSelectedCommunityInstructionTemplate(null)
              setCommunityInstructionRatingDraft(0)
            }}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            Закрыть
          </Button>
          <Button
            onClick={() => {
              if (!selectedCommunityInstructionTemplate) {
                return
              }
              handleOpenEncouragementDialog({
                target_type: 'instruction_template',
                target_id: selectedCommunityInstructionTemplate.id,
                title: selectedCommunityInstructionTemplate.title,
              })
            }}
            disabled={!selectedCommunityInstructionTemplate || isSelectedCommunityInstructionOwnedByUser}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            Поддержать
          </Button>
          <Button
            onClick={handleOpenInstructionTemplateReportDialog}
            disabled={
              !selectedCommunityInstructionTemplate ||
              isCommunityInstructionAddSaving ||
              isCommunityInstructionRatingSaving ||
              isCommunityEntityReportSubmitting ||
              selectedCommunityInstructionTemplate.is_reported_by_user
            }
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            {selectedCommunityInstructionTemplate?.is_reported_by_user ? 'Жалоба отправлена' : 'Пожаловаться'}
          </Button>
          <Button
            onClick={() => void handleAddCommunityInstructionTemplate()}
            disabled={
              !selectedCommunityInstructionTemplate ||
              isCommunityInstructionAddSaving ||
              isCommunityInstructionRatingSaving ||
              isCommunityEntityReportSubmitting ||
              selectedCommunityInstructionTemplate.is_added_by_user ||
              isSelectedCommunityInstructionOwnedByUser
            }
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: 'var(--morius-button-active)',
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            {isSelectedCommunityInstructionOwnedByUser
              ? 'Ваша карточка'
              : selectedCommunityInstructionTemplate?.is_added_by_user
                ? 'Добавлено'
                : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(encouragementTarget)}
        onClose={() => {
          if (!isEncouragementSubmitting) {
            setEncouragementTarget(null)
          }
        }}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: '#11161d',
            color: APP_TEXT_PRIMARY,
            boxShadow: '0 28px 70px rgba(0,0,0,0.72)',
            '& .MuiInputBase-root': {
              borderRadius: '12px',
              backgroundColor: '#171d25',
              color: APP_TEXT_PRIMARY,
            },
            '& .MuiInputLabel-root': {
              color: APP_TEXT_SECONDARY,
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'color-mix(in srgb, var(--morius-card-border) 78%, transparent)',
            },
          },
        }}
        BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}
      >
        <DialogTitle sx={{ color: APP_TEXT_PRIMARY, fontWeight: 900 }}>Поддержать автора</DialogTitle>
        <DialogContent>
          <Stack spacing={1.1} sx={{ pt: 0.45 }}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem', lineHeight: 1.45 }}>
              Переведите автору публикации валюту со своего баланса. Минимум <SoulAmount amount={5} iconSize={15} color="inherit" fontSize="0.92rem" />.
            </Typography>
            <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800 }}>
              {encouragementTarget?.title ?? ''}
            </Typography>
            <TextField
              label="Сумма"
              value={encouragementAmount}
              onChange={(event) => setEncouragementAmount(event.target.value.replace(/\D/g, '').slice(0, 6))}
              fullWidth
            />
            <TextField
              label="Сообщение"
              value={encouragementMessage}
              onChange={(event) => setEncouragementMessage(event.target.value.slice(0, 240))}
              fullWidth
              multiline
              minRows={2}
            />
            {encouragementError ? <Alert severity="error">{encouragementError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setEncouragementTarget(null)} disabled={isEncouragementSubmitting} sx={{ color: APP_TEXT_SECONDARY }}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmitEncouragement()} disabled={isEncouragementSubmitting} sx={{ color: APP_TEXT_PRIMARY, backgroundColor: 'var(--morius-button-active)' }}>
            {isEncouragementSubmitting ? 'Отправляем...' : 'Поддержать'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={communityEntityReportTarget !== null}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick') {
            return
          }
          handleCloseCommunityEntityReportDialog()
        }}
        fullWidth
        maxWidth="sm"
        sx={{
          '& .MuiDialog-paper': {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            color: APP_TEXT_PRIMARY,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          },
          '& .MuiDialogTitle-root': {
            px: 3,
            pt: 2.2,
            pb: 0.8,
          },
          '& .MuiDialogContent-root': {
            px: 3,
            pb: 1.1,
          },
          '& .MuiDialogActions-root': {
            px: 3,
            pb: 2.2,
          },
        }}
      >
        <DialogTitle>
          {communityEntityReportTarget === 'character'
            ? 'Жалоба на персонажа'
            : communityEntityReportTarget === 'instruction_template'
              ? 'Жалоба на инструкцию'
              : ''}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.15} sx={{ pt: 0.45 }}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Опишите причину жалобы.</Typography>
            <FormControl fullWidth>
              <Select
                value={communityEntityReportReasonDraft}
                onChange={(event) => {
                  setCommunityEntityReportReasonDraft(event.target.value as StoryCommunityWorldReportReason)
                  setCommunityEntityReportValidationError('')
                }}
                disabled={isCommunityEntityReportSubmitting}
                size="small"
              >
                {COMMUNITY_REPORT_REASON_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box
              component="textarea"
              value={communityEntityReportDescriptionDraft}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setCommunityEntityReportDescriptionDraft(event.target.value.slice(0, COMMUNITY_REPORT_DESCRIPTION_MAX_LENGTH))
                setCommunityEntityReportValidationError('')
              }}
              disabled={isCommunityEntityReportSubmitting}
              placeholder="Опишите причину жалобы."
              maxLength={COMMUNITY_REPORT_DESCRIPTION_MAX_LENGTH}
              sx={{
                width: '100%',
                minHeight: 112,
                borderRadius: '10px',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                color: APP_TEXT_PRIMARY,
                resize: 'vertical',
                p: 1.1,
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                outline: 'none',
                '&::placeholder': {
                  color: APP_TEXT_SECONDARY,
                },
              }}
            />
            <TextLimitIndicator
              currentLength={communityEntityReportDescriptionDraft.length}
              maxLength={COMMUNITY_REPORT_DESCRIPTION_MAX_LENGTH}
            />
            {communityEntityReportValidationError ? (
              <Typography sx={{ color: 'error.main', fontSize: '0.86rem' }}>{communityEntityReportValidationError}</Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseCommunityEntityReportDialog}
            disabled={isCommunityEntityReportSubmitting}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: APP_CARD_BACKGROUND,
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            Закрыть
          </Button>
          <Button
            onClick={() => void handleSubmitCommunityEntityReport()}
            disabled={isCommunityEntityReportSubmitting}
            sx={{
              minHeight: 38,
              px: 1.35,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              backgroundColor: 'var(--morius-button-active)',
              '&:hover': {
                backgroundColor: APP_BUTTON_HOVER,
              },
            }}
          >
            {isCommunityEntityReportSubmitting ? 'Отправка...' : 'Отправить жалобу'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={isCommunityEntityReportCloseConfirmOpen}
        onClose={() => setIsCommunityEntityReportCloseConfirmOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            color: APP_TEXT_PRIMARY,
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Закрыть без сохранения?</DialogTitle>
        <DialogContent sx={{ color: APP_TEXT_SECONDARY, pt: 0.5 }}>
          Внесенные изменения будут потеряны.
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setIsCommunityEntityReportCloseConfirmOpen(false)} sx={{ color: APP_TEXT_SECONDARY }}>
            Остаться
          </Button>
          <Button onClick={resetCommunityEntityReportDialog} sx={{ color: APP_TEXT_PRIMARY }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
        onNavigate={onNavigate}
        profileName={profileName}
        avatarInputRef={avatarInputRef}
        avatarError={avatarError}
        isAvatarSaving={isAvatarSaving}
        onClose={handleCloseProfileDialog}
        onChooseAvatar={handleChooseAvatar}
        onAvatarChange={handleAvatarChange}
        onOpenTopUp={handleOpenTopUpDialog}
        onOpenCharacterManager={() => onNavigate('/dashboard')}
        onOpenInstructionTemplates={() => onNavigate('/dashboard')}
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
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={(planId) => void handlePurchasePlan(planId)}
      />
      <ConfirmLogoutDialog
        open={confirmLogoutOpen}
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
        referralBonusCoins={paymentReferralBonusCoins}
        onClose={() => {
          setPaymentSuccessCoins(null)
          setPaymentReferralBonusCoins(0)
        }}
      />

      {/* Mobile search overlay — slides in from top when search icon is tapped */}
      <Fade in={isMobileSearchOpen && isPhoneLayout} mountOnEnter unmountOnExit timeout={{ enter: 200, exit: 150 }}>
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 80,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            backgroundColor: 'var(--morius-app-base)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <Box sx={{ position: 'relative', flex: 1 }}>
            <Box
              component="input"
              type="text"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value.slice(0, 120))}
              placeholder="Поиск"
              aria-label="Поиск по сообществу"
              sx={{
                width: '100%',
                height: 44,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                pl: '16px',
                pr: '44px',
                outline: 'none',
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                transition: 'border-color 180ms ease',
                '&::placeholder': { color: 'var(--morius-text-secondary)' },
                '&:focus': { borderColor: 'color-mix(in srgb, var(--morius-accent) 60%, var(--morius-card-border))' },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                right: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--morius-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <ThemedSvgIcon markup={searchIconRaw} size={18} />
            </Box>
          </Box>
          <IconButton
            aria-label="Закрыть поиск"
            onClick={() => {
              setIsMobileSearchOpen(false)
              setSearchQuery('')
            }}
            sx={{
              flexShrink: 0,
              color: 'var(--morius-title-text)',
              p: 0.5,
              '&:hover': { backgroundColor: 'transparent' },
              '&:active': { backgroundColor: 'transparent' },
            }}
          >
            <ThemedSvgIcon markup={searchCloseIconRaw} size={20} />
          </IconButton>
        </Box>
      </Fade>

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

export default CommunityWorldsPage

