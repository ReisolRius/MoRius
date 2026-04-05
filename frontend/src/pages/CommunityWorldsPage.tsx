import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  MenuItem,
  Select,
  Stack,
  SvgIcon,
  Typography,
  type SelectChangeEvent,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import HeaderAccountActions from '../components/HeaderAccountActions'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import { useIncrementalList } from '../hooks/useIncrementalList'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import TextLimitIndicator from '../components/TextLimitIndicator'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
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
const TOP_FILTER_CONTROL_HEIGHT = 46
const TOP_FILTER_CONTROL_RADIUS = '12px'
const TOP_FILTER_TEXT_PADDING_X = '14px'
const TOP_FILTER_TEXT_PADDING_WITH_ICON_X = '46px'
const TOP_FILTER_ICON_OFFSET_X = '12px'
const COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
const COMMUNITY_CARD_BATCH_SIZE = 12
const COMMUNITY_PUBLIC_CARD_HERO_HEIGHT = 138
const COMMUNITY_FEED_CACHE_TTL_MS = 30 * 60 * 1000
const COMMUNITY_FEED_CACHE_KEY_PREFIX = 'morius.community.feed.cache.v2'
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])

type CommunityFeedCachePayload = {
  saved_at: number
  worlds: StoryCommunityWorldSummary[]
  characters: StoryCommunityCharacterSummary[]
  instruction_templates: StoryCommunityInstructionTemplateSummary[]
  has_characters: boolean
  has_instruction_templates: boolean
}

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

function buildCommunityFeedCacheKey(userId: number): string {
  return `${COMMUNITY_FEED_CACHE_KEY_PREFIX}:${userId}`
}

function readCommunityFeedCache(userId: number): CommunityFeedCachePayload | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const rawValue = window.localStorage.getItem(buildCommunityFeedCacheKey(userId))
    if (!rawValue) {
      return null
    }
    const parsed = JSON.parse(rawValue) as Partial<CommunityFeedCachePayload>
    if (typeof parsed.saved_at !== 'number' || !Number.isFinite(parsed.saved_at)) {
      return null
    }
    if (!Array.isArray(parsed.worlds) || !Array.isArray(parsed.characters) || !Array.isArray(parsed.instruction_templates)) {
      return null
    }
    return {
      saved_at: parsed.saved_at,
      worlds: parsed.worlds as StoryCommunityWorldSummary[],
      characters: parsed.characters as StoryCommunityCharacterSummary[],
      instruction_templates: parsed.instruction_templates as StoryCommunityInstructionTemplateSummary[],
      has_characters: parsed.has_characters === true,
      has_instruction_templates: parsed.has_instruction_templates === true,
    }
  } catch {
    return null
  }
}

function writeCommunityFeedCache(userId: number, payload: CommunityFeedCachePayload): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(buildCommunityFeedCacheKey(userId), JSON.stringify(payload))
  } catch {
    // Ignore storage quota or privacy mode restrictions.
  }
}

type CommunitySection = 'worlds' | 'characters' | 'instructions'
type CommunityWorldSortMode = 'updated_desc' | 'rating_desc' | 'launches_desc' | 'views_desc'
type CommunityCardSortMode = 'updated_desc' | 'rating_desc' | 'additions_desc'
type CommunityAddedFilter = 'all' | 'added' | 'not_added'
type CommunityWorldAgeFilter = 'all' | '6+' | '16+' | '18+'
type CommunityEntityReportTarget = 'character' | 'instruction_template'

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
const COMMUNITY_SEARCH_QUERY_MAX_LENGTH = 120
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

function SearchGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 21, height: 21 }}>
      <path
        d="M10.5 4a6.5 6.5 0 1 0 4.18 11.48l3.92 3.92a1 1 0 0 0 1.4-1.42l-3.87-3.86A6.5 6.5 0 0 0 10.5 4m0 2a4.5 4.5 0 1 1 0 9.01 4.5 4.5 0 0 1 0-9.01"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

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
        contentVisibility: 'auto',
        containIntrinsicSize: '238px',
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
  const [activeSection, setActiveSection] = useState<CommunitySection>('worlds')
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
  const [communityWorlds, setCommunityWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [isCommunityWorldsLoading, setIsCommunityWorldsLoading] = useState(false)
  const [communityCharacters, setCommunityCharacters] = useState<StoryCommunityCharacterSummary[]>([])
  const [isCommunityCharactersLoading, setIsCommunityCharactersLoading] = useState(false)
  const [hasLoadedCommunityCharacters, setHasLoadedCommunityCharacters] = useState(false)
  const [communityInstructionTemplates, setCommunityInstructionTemplates] = useState<StoryCommunityInstructionTemplateSummary[]>([])
  const [isCommunityInstructionTemplatesLoading, setIsCommunityInstructionTemplatesLoading] = useState(false)
  const [hasLoadedCommunityInstructionTemplates, setHasLoadedCommunityInstructionTemplates] = useState(false)
  const [communityWorldsError, setCommunityWorldsError] = useState('')
  const [actionError, setActionError] = useState('')
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
  const [isCommunityInstructionTemplateLoading, setIsCommunityInstructionTemplateLoading] = useState(false)
  const [communityInstructionRatingDraft, setCommunityInstructionRatingDraft] = useState(0)
  const [isCommunityInstructionRatingSaving, setIsCommunityInstructionRatingSaving] = useState(false)
  const [isCommunityInstructionAddSaving, setIsCommunityInstructionAddSaving] = useState(false)
  const [communityEntityReportTarget, setCommunityEntityReportTarget] = useState<CommunityEntityReportTarget | null>(null)
  const [communityEntityReportReasonDraft, setCommunityEntityReportReasonDraft] = useState<StoryCommunityWorldReportReason>('other')
  const [communityEntityReportDescriptionDraft, setCommunityEntityReportDescriptionDraft] = useState('')
  const [communityEntityReportValidationError, setCommunityEntityReportValidationError] = useState('')
  const [isCommunityEntityReportSubmitting, setIsCommunityEntityReportSubmitting] = useState(false)
  const [sharedWorldIdFromLink] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : parseSharedWorldIdFromLocation(window.location.search),
  )
  const [hasAttemptedSharedWorldOpen, setHasAttemptedSharedWorldOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [worldSortMode, setWorldSortMode] = useState<CommunityWorldSortMode>('updated_desc')
  const [characterSortMode, setCharacterSortMode] = useState<CommunityCardSortMode>('updated_desc')
  const [instructionSortMode, setInstructionSortMode] = useState<CommunityCardSortMode>('updated_desc')
  const [worldAgeFilter, setWorldAgeFilter] = useState<CommunityWorldAgeFilter>('all')
  const [worldGenreFilter, setWorldGenreFilter] = useState<string>('all')
  const [characterAddedFilter, setCharacterAddedFilter] = useState<CommunityAddedFilter>('all')
  const [instructionAddedFilter, setInstructionAddedFilter] = useState<CommunityAddedFilter>('all')
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const hasLoadedCommunityWorldGameIdsRef = useRef(false)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const writeCommunityFeedCacheSnapshot = useCallback(
    (payload: Partial<CommunityFeedCachePayload>) => {
      const cachedPayload = readCommunityFeedCache(user.id)
      writeCommunityFeedCache(user.id, {
        saved_at: Date.now(),
        worlds: payload.worlds ?? cachedPayload?.worlds ?? communityWorlds,
        characters: payload.characters ?? cachedPayload?.characters ?? communityCharacters,
        instruction_templates:
          payload.instruction_templates ?? cachedPayload?.instruction_templates ?? communityInstructionTemplates,
        has_characters:
          payload.characters !== undefined ? true : cachedPayload?.has_characters ?? hasLoadedCommunityCharacters,
        has_instruction_templates:
          payload.instruction_templates !== undefined
            ? true
            : cachedPayload?.has_instruction_templates ?? hasLoadedCommunityInstructionTemplates,
      })
    },
    [
      communityCharacters,
      communityInstructionTemplates,
      communityWorlds,
      hasLoadedCommunityCharacters,
      hasLoadedCommunityInstructionTemplates,
      user.id,
    ],
  )

  const worldGenreOptions = useMemo(() => {
    const uniqueGenres = new Set<string>()
    communityWorlds.forEach((world) => {
      world.genres.forEach((genre) => {
        const normalizedGenre = genre.replace(/\s+/g, ' ').trim()
        if (normalizedGenre) {
          uniqueGenres.add(normalizedGenre)
        }
      })
    })
    return Array.from(uniqueGenres).sort((left, right) => left.localeCompare(right, 'ru'))
  }, [communityWorlds])

  useEffect(() => {
    if (worldGenreFilter === 'all') {
      return
    }
    if (worldGenreOptions.includes(worldGenreFilter)) {
      return
    }
    setWorldGenreFilter('all')
  }, [worldGenreFilter, worldGenreOptions])

  const normalizedSearchQuery = useMemo(() => normalizeSearchValue(deferredSearchQuery), [deferredSearchQuery])

  const filteredCommunityWorlds = useMemo(() => {
    let filtered = communityWorlds

    if (normalizedSearchQuery) {
      filtered = filtered.filter((world) => {
        const haystack = [
          world.title,
          world.description,
          world.author_name,
          world.genres.join(' '),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedSearchQuery)
      })
    }

    if (worldAgeFilter !== 'all') {
      filtered = filtered.filter((world) => world.age_rating === worldAgeFilter)
    }

    if (worldGenreFilter !== 'all') {
      filtered = filtered.filter((world) => world.genres.some((genre) => genre.replace(/\s+/g, ' ').trim() === worldGenreFilter))
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (worldSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count
      }
      if (worldSortMode === 'launches_desc') {
        return right.community_launches - left.community_launches || parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
      }
      if (worldSortMode === 'views_desc') {
        return right.community_views - left.community_views || parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
      }
      return parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
    })
    return sorted
  }, [communityWorlds, normalizedSearchQuery, worldAgeFilter, worldGenreFilter, worldSortMode])

  const filteredCommunityCharacters = useMemo(() => {
    let filtered = communityCharacters

    if (normalizedSearchQuery) {
      filtered = filtered.filter((item) => {
        const haystack = [item.name, item.description, item.author_name, item.triggers.join(' ')].join(' ').toLowerCase()
        return haystack.includes(normalizedSearchQuery)
      })
    }

    if (characterAddedFilter === 'added') {
      filtered = filtered.filter((item) => item.is_added_by_user)
    } else if (characterAddedFilter === 'not_added') {
      filtered = filtered.filter((item) => !item.is_added_by_user)
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (characterSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count
      }
      if (characterSortMode === 'additions_desc') {
        return right.community_additions_count - left.community_additions_count || parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
      }
      return parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
    })
    return sorted
  }, [characterAddedFilter, characterSortMode, communityCharacters, normalizedSearchQuery])

  const filteredCommunityInstructionTemplates = useMemo(() => {
    let filtered = communityInstructionTemplates

    if (normalizedSearchQuery) {
      filtered = filtered.filter((item) => {
        const haystack = [item.title, item.content, item.author_name].join(' ').toLowerCase()
        return haystack.includes(normalizedSearchQuery)
      })
    }

    if (instructionAddedFilter === 'added') {
      filtered = filtered.filter((item) => item.is_added_by_user)
    } else if (instructionAddedFilter === 'not_added') {
      filtered = filtered.filter((item) => !item.is_added_by_user)
    }

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (instructionSortMode === 'rating_desc') {
        return right.community_rating_avg - left.community_rating_avg || right.community_rating_count - left.community_rating_count
      }
      if (instructionSortMode === 'additions_desc') {
        return right.community_additions_count - left.community_additions_count || parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
      }
      return parseSortDateValue(right.updated_at) - parseSortDateValue(left.updated_at)
    })
    return sorted
  }, [communityInstructionTemplates, instructionAddedFilter, instructionSortMode, normalizedSearchQuery])

  const {
    visibleItems: visibleCommunityWorlds,
    hasMore: hasMoreCommunityWorlds,
    loadMoreRef: loadMoreCommunityWorldsRef,
  } = useIncrementalList(filteredCommunityWorlds, {
    initialCount: COMMUNITY_CARD_BATCH_SIZE,
    step: COMMUNITY_CARD_BATCH_SIZE,
    resetKey: `${normalizedSearchQuery}|${worldSortMode}|${worldAgeFilter}|${worldGenreFilter}|${filteredCommunityWorlds.length}`,
  })
  const {
    visibleItems: visibleCommunityCharacters,
    hasMore: hasMoreCommunityCharacters,
    loadMoreRef: loadMoreCommunityCharactersRef,
  } = useIncrementalList(filteredCommunityCharacters, {
    initialCount: COMMUNITY_CARD_BATCH_SIZE,
    step: COMMUNITY_CARD_BATCH_SIZE,
    resetKey: `${normalizedSearchQuery}|${characterSortMode}|${characterAddedFilter}|${filteredCommunityCharacters.length}`,
  })
  const {
    visibleItems: visibleCommunityInstructionTemplates,
    hasMore: hasMoreCommunityInstructionTemplates,
    loadMoreRef: loadMoreCommunityInstructionTemplatesRef,
  } = useIncrementalList(filteredCommunityInstructionTemplates, {
    initialCount: COMMUNITY_CARD_BATCH_SIZE,
    step: COMMUNITY_CARD_BATCH_SIZE,
    resetKey: `${normalizedSearchQuery}|${instructionSortMode}|${instructionAddedFilter}|${filteredCommunityInstructionTemplates.length}`,
  })

  const loadCommunityWorlds = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force ?? false
    setIsCommunityWorldsLoading(true)
    setIsCommunityCharactersLoading(forceReload && hasLoadedCommunityCharacters)
    setIsCommunityInstructionTemplatesLoading(forceReload && hasLoadedCommunityInstructionTemplates)
    setCommunityWorldsError('')
    if (!forceReload) {
      const cachedPayload = readCommunityFeedCache(user.id)
      if (cachedPayload && Date.now() - cachedPayload.saved_at < COMMUNITY_FEED_CACHE_TTL_MS) {
        setCommunityWorlds(cachedPayload.worlds)
        setCommunityCharacters(cachedPayload.characters)
        setCommunityInstructionTemplates(cachedPayload.instruction_templates)
        setHasLoadedCommunityCharacters(cachedPayload.has_characters)
        setHasLoadedCommunityInstructionTemplates(cachedPayload.has_instruction_templates)
        setIsCommunityWorldsLoading(false)
        setIsCommunityCharactersLoading(false)
        setIsCommunityInstructionTemplatesLoading(false)
        return
      }
    }
    try {
      const worlds = await listCommunityWorlds(authToken)
      setCommunityWorlds(worlds)
      setIsCommunityWorldsLoading(false)
      const [charactersResult, templatesResult] = await Promise.allSettled([
        hasLoadedCommunityCharacters ? listCommunityCharacters(authToken) : Promise.resolve(null),
        hasLoadedCommunityInstructionTemplates ? listCommunityInstructionTemplates(authToken) : Promise.resolve(null),
      ])
      const characters = charactersResult.status === 'fulfilled' ? charactersResult.value : null
      const templates = templatesResult.status === 'fulfilled' ? templatesResult.value : null
      if (characters !== null) {
        setCommunityCharacters(characters)
        setHasLoadedCommunityCharacters(true)
      }
      if (templates !== null) {
        setCommunityInstructionTemplates(templates)
        setHasLoadedCommunityInstructionTemplates(true)
      }
      if (charactersResult.status === 'rejected' || templatesResult.status === 'rejected') {
        const rejectedReason =
          charactersResult.status === 'rejected'
            ? charactersResult.reason
            : templatesResult.status === 'rejected'
              ? templatesResult.reason
              : null
        const detail =
          rejectedReason instanceof Error
            ? rejectedReason.message
            : charactersResult.status === 'rejected'
              ? 'Не удалось обновить персонажей сообщества'
              : 'Не удалось обновить инструкции сообщества'
        setCommunityWorldsError((currentError) => currentError || detail)
      }
      writeCommunityFeedCacheSnapshot({
        worlds,
        characters: characters ?? undefined,
        instruction_templates: templates ?? undefined,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить сообщество'
      setCommunityWorldsError(detail)
      setCommunityWorlds([])
      if (!hasLoadedCommunityCharacters) {
        setCommunityCharacters([])
      }
      if (!hasLoadedCommunityInstructionTemplates) {
        setCommunityInstructionTemplates([])
      }
    } finally {
      setIsCommunityWorldsLoading(false)
      setIsCommunityCharactersLoading(false)
      setIsCommunityInstructionTemplatesLoading(false)
    }
  }, [
    authToken,
    hasLoadedCommunityCharacters,
    hasLoadedCommunityInstructionTemplates,
    user.id,
    writeCommunityFeedCacheSnapshot,
  ])

  useEffect(() => {
    void loadCommunityWorlds()
  }, [loadCommunityWorlds])

  useEffect(() => {
    const refreshTimerId = window.setInterval(() => {
      void loadCommunityWorlds({ force: true })
    }, COMMUNITY_FEED_CACHE_TTL_MS)
    return () => window.clearInterval(refreshTimerId)
  }, [loadCommunityWorlds])

  const loadCommunityCharacters = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force ?? false
    if (isCommunityCharactersLoading) {
      return
    }
    setIsCommunityCharactersLoading(true)
    if (!forceReload) {
      const cachedPayload = readCommunityFeedCache(user.id)
      if (
        cachedPayload &&
        cachedPayload.has_characters &&
        Date.now() - cachedPayload.saved_at < COMMUNITY_FEED_CACHE_TTL_MS
      ) {
        setCommunityCharacters(cachedPayload.characters)
        setHasLoadedCommunityCharacters(true)
        setIsCommunityCharactersLoading(false)
        return
      }
    }
    try {
      const characters = await listCommunityCharacters(authToken)
      setCommunityCharacters(characters)
      setHasLoadedCommunityCharacters(true)
      writeCommunityFeedCacheSnapshot({
        characters,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей сообщества'
      setCommunityWorldsError(detail)
      setCommunityCharacters([])
    } finally {
      setIsCommunityCharactersLoading(false)
    }
  }, [authToken, isCommunityCharactersLoading, user.id, writeCommunityFeedCacheSnapshot])

  const loadCommunityInstructionTemplates = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force ?? false
    if (isCommunityInstructionTemplatesLoading) {
      return
    }
    setIsCommunityInstructionTemplatesLoading(true)
    if (!forceReload) {
      const cachedPayload = readCommunityFeedCache(user.id)
      if (
        cachedPayload &&
        cachedPayload.has_instruction_templates &&
        Date.now() - cachedPayload.saved_at < COMMUNITY_FEED_CACHE_TTL_MS
      ) {
        setCommunityInstructionTemplates(cachedPayload.instruction_templates)
        setHasLoadedCommunityInstructionTemplates(true)
        setIsCommunityInstructionTemplatesLoading(false)
        return
      }
    }
    try {
      const templates = await listCommunityInstructionTemplates(authToken)
      setCommunityInstructionTemplates(templates)
      setHasLoadedCommunityInstructionTemplates(true)
      writeCommunityFeedCacheSnapshot({
        instruction_templates: templates,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить инструкции сообщества'
      setCommunityWorldsError(detail)
      setCommunityInstructionTemplates([])
    } finally {
      setIsCommunityInstructionTemplatesLoading(false)
    }
  }, [authToken, isCommunityInstructionTemplatesLoading, user.id, writeCommunityFeedCacheSnapshot])

  useEffect(() => {
    if (activeSection === 'characters' && !hasLoadedCommunityCharacters && !isCommunityCharactersLoading) {
      void loadCommunityCharacters()
      return
    }
    if (
      activeSection === 'instructions' &&
      !hasLoadedCommunityInstructionTemplates &&
      !isCommunityInstructionTemplatesLoading
    ) {
      void loadCommunityInstructionTemplates()
    }
  }, [
    activeSection,
    hasLoadedCommunityCharacters,
    hasLoadedCommunityInstructionTemplates,
    isCommunityCharactersLoading,
    isCommunityInstructionTemplatesLoading,
    loadCommunityCharacters,
    loadCommunityInstructionTemplates,
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
        const detail = error instanceof Error ? error.message : 'Не удалось открыть мир'
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
        const detail = error instanceof Error ? error.message : 'Не удалось обновить любимые миры'
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
    setCommunityEntityReportTarget(null)
    setCommunityEntityReportReasonDraft('other')
    setCommunityEntityReportDescriptionDraft('')
    setCommunityEntityReportValidationError('')
  }, [])

  const handleCloseCommunityEntityReportDialog = useCallback(() => {
    if (isCommunityEntityReportSubmitting) {
      return
    }
    resetCommunityEntityReportDialog()
  }, [isCommunityEntityReportSubmitting, resetCommunityEntityReportDialog])

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
      const detail = error instanceof Error ? error.message : 'Не удалось запустить мир'
      setActionError(detail)
    } finally {
      setIsLaunchingCommunityWorld(false)
    }
  }, [authToken, isLaunchingCommunityWorld, onNavigate, selectedCommunityWorld])

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
    setTopUpDialogOpen(true)
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
  const communitySectionDescription =
    activeSection === 'worlds'
      ? 'Публичные миры игроков. Откройте карточку мира, оцените и запускайте в свои игры.'
      : activeSection === 'characters'
        ? 'Персонажи сообщества. Оценивайте и добавляйте понравившихся в мои персонажи.'
        : 'Инструкции сообщества. Оценивайте и добавляйте их в мои инструкции.'
  const searchPlaceholder =
    activeSection === 'worlds'
      ? 'Поиск по мирам'
      : activeSection === 'characters'
        ? 'Поиск по персонажам'
        : 'Поиск по инструкциям'

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
        onOpenTopUpDialog={handleOpenTopUpDialog}
        hideRightToggle
        rightActions={<HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} />}
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 5, md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
          {actionError ? (
            <Alert severity="error" onClose={() => setActionError('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {actionError}
            </Alert>
          ) : null}

          <Stack alignItems="center" spacing={0.75} sx={{ mb: 1.55 }}>
            <Stack spacing={0.45} alignItems="center">
              <Typography
                sx={{
                  fontSize: { xs: '2rem', md: '2.35rem' },
                  fontWeight: 900,
                  color: APP_TEXT_PRIMARY,
                  textAlign: 'center',
                }}
              >
                Сообщество
              </Typography>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', textAlign: 'center', maxWidth: 720 }}>
                {communitySectionDescription}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', justifyContent: 'center', pt: 0.35 }}>
                <Button
                  onClick={() => setActiveSection('worlds')}
                  sx={{
                    minHeight: 34,
                    px: 1.15,
                    borderRadius: '999px',
                    textTransform: 'none',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor:
                      activeSection === 'worlds' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                    color: activeSection === 'worlds' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                    '&:hover': {
                      backgroundColor:
                        activeSection === 'worlds' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_BUTTON_HOVER,
                    },
                  }}
                >
                  Миры
                </Button>
                <Button
                  onClick={() => setActiveSection('characters')}
                  sx={{
                    minHeight: 34,
                    px: 1.15,
                    borderRadius: '999px',
                    textTransform: 'none',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor:
                      activeSection === 'characters' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                    color: activeSection === 'characters' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                    '&:hover': {
                      backgroundColor:
                        activeSection === 'characters'
                          ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))'
                          : APP_BUTTON_HOVER,
                    },
                  }}
                >
                  Персонажи
                </Button>
                <Button
                  onClick={() => setActiveSection('instructions')}
                  sx={{
                    minHeight: 34,
                    px: 1.15,
                    borderRadius: '999px',
                    textTransform: 'none',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor:
                      activeSection === 'instructions'
                        ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))'
                        : APP_CARD_BACKGROUND,
                    color: activeSection === 'instructions' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                    '&:hover': {
                      backgroundColor:
                        activeSection === 'instructions'
                          ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))'
                          : APP_BUTTON_HOVER,
                    },
                  }}
                >
                  Инструкции
                </Button>
              </Stack>
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                lg: activeSection === 'worlds' ? 'minmax(0, 1fr) 220px 180px 220px' : 'minmax(0, 1fr) 220px 220px',
              },
              gap: 1.1,
              alignItems: 'center',
              mb: 1.4,
            }}
          >
            <Stack spacing={0.45}>
              <Box
                sx={{
                  position: 'relative',
                  borderRadius: TOP_FILTER_CONTROL_RADIUS,
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: APP_CARD_BACKGROUND,
                  minHeight: TOP_FILTER_CONTROL_HEIGHT,
                }}
              >
                <Box
                  component="input"
                  value={searchQuery}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value.slice(0, COMMUNITY_SEARCH_QUERY_MAX_LENGTH))}
                  placeholder={searchPlaceholder}
                  maxLength={COMMUNITY_SEARCH_QUERY_MAX_LENGTH}
                  sx={{
                    width: '100%',
                    height: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: APP_TEXT_PRIMARY,
                    pl: TOP_FILTER_TEXT_PADDING_X,
                    pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                    outline: 'none',
                    fontSize: '1rem',
                    '&::placeholder': {
                      color: APP_TEXT_SECONDARY,
                    },
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    right: TOP_FILTER_ICON_OFFSET_X,
                    transform: 'translateY(-50%)',
                    color: APP_TEXT_SECONDARY,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <SearchGlyph />
                </Box>
              </Box>
            </Stack>

            {activeSection === 'worlds' ? (
              <>
                <FormControl
                  sx={{
                    position: 'relative',
                    minHeight: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                  }}
                >
                  <Select
                    value={worldSortMode}
                    onChange={(event: SelectChangeEvent) => setWorldSortMode(event.target.value as CommunityWorldSortMode)}
                    IconComponent={() => null}
                    sx={{
                      height: TOP_FILTER_CONTROL_HEIGHT,
                      borderRadius: TOP_FILTER_CONTROL_RADIUS,
                      color: APP_TEXT_PRIMARY,
                      px: 0,
                      fontSize: '0.95rem',
                      '& .MuiSelect-select': {
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        py: 0,
                        pl: TOP_FILTER_TEXT_PADDING_X,
                        pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        border: 'none',
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          mt: 0.5,
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_CARD_BACKGROUND,
                          color: APP_TEXT_PRIMARY,
                          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.44)',
                        },
                      },
                    }}
                  >
                    {WORLD_SORT_OPTIONS.map((option) => (
                      <MenuItem
                        key={option.value}
                        value={option.value}
                        sx={{
                          fontSize: '0.95rem',
                          color: APP_TEXT_PRIMARY,
                          '&.Mui-selected': {
                            backgroundColor: APP_BUTTON_ACTIVE,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right: TOP_FILTER_ICON_OFFSET_X,
                      transform: 'translateY(-50%)',
                      color: APP_TEXT_SECONDARY,
                      pointerEvents: 'none',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <FilterGlyph />
                  </Box>
                </FormControl>

                <FormControl
                  sx={{
                    position: 'relative',
                    minHeight: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                  }}
                >
                  <Select
                    value={worldAgeFilter}
                    onChange={(event: SelectChangeEvent) => setWorldAgeFilter(event.target.value as CommunityWorldAgeFilter)}
                    IconComponent={() => null}
                    sx={{
                      height: TOP_FILTER_CONTROL_HEIGHT,
                      borderRadius: TOP_FILTER_CONTROL_RADIUS,
                      color: APP_TEXT_PRIMARY,
                      px: 0,
                      fontSize: '0.95rem',
                      '& .MuiSelect-select': {
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        py: 0,
                        pl: TOP_FILTER_TEXT_PADDING_X,
                        pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        border: 'none',
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          mt: 0.5,
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_CARD_BACKGROUND,
                          color: APP_TEXT_PRIMARY,
                          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.44)',
                        },
                      },
                    }}
                  >
                    {AGE_FILTER_OPTIONS.map((option) => (
                      <MenuItem
                        key={option.value}
                        value={option.value}
                        sx={{
                          fontSize: '0.95rem',
                          color: APP_TEXT_PRIMARY,
                          '&.Mui-selected': {
                            backgroundColor: APP_BUTTON_ACTIVE,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right: TOP_FILTER_ICON_OFFSET_X,
                      transform: 'translateY(-50%)',
                      color: APP_TEXT_SECONDARY,
                      pointerEvents: 'none',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <FilterGlyph />
                  </Box>
                </FormControl>

                <FormControl
                  sx={{
                    position: 'relative',
                    minHeight: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                  }}
                >
                  <Select
                    value={worldGenreFilter}
                    onChange={(event: SelectChangeEvent) => setWorldGenreFilter(event.target.value)}
                    IconComponent={() => null}
                    sx={{
                      height: TOP_FILTER_CONTROL_HEIGHT,
                      borderRadius: TOP_FILTER_CONTROL_RADIUS,
                      color: APP_TEXT_PRIMARY,
                      px: 0,
                      fontSize: '0.95rem',
                      '& .MuiSelect-select': {
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        py: 0,
                        pl: TOP_FILTER_TEXT_PADDING_X,
                        pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        border: 'none',
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          mt: 0.5,
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_CARD_BACKGROUND,
                          color: APP_TEXT_PRIMARY,
                          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.44)',
                        },
                      },
                    }}
                  >
                    <MenuItem
                      value="all"
                      sx={{
                        fontSize: '0.95rem',
                        color: APP_TEXT_PRIMARY,
                        '&.Mui-selected': {
                          backgroundColor: APP_BUTTON_ACTIVE,
                        },
                        '&.Mui-selected:hover': {
                          backgroundColor: APP_BUTTON_HOVER,
                        },
                        '&:hover': {
                          backgroundColor: APP_BUTTON_HOVER,
                        },
                      }}
                    >
                      Все жанры
                    </MenuItem>
                    {worldGenreOptions.map((genre) => (
                      <MenuItem
                        key={genre}
                        value={genre}
                        sx={{
                          fontSize: '0.95rem',
                          color: APP_TEXT_PRIMARY,
                          '&.Mui-selected': {
                            backgroundColor: APP_BUTTON_ACTIVE,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {genre}
                      </MenuItem>
                    ))}
                  </Select>
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right: TOP_FILTER_ICON_OFFSET_X,
                      transform: 'translateY(-50%)',
                      color: APP_TEXT_SECONDARY,
                      pointerEvents: 'none',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <FilterGlyph />
                  </Box>
                </FormControl>
              </>
            ) : (
              <>
                <FormControl
                  sx={{
                    position: 'relative',
                    minHeight: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                  }}
                >
                  <Select
                    value={activeSection === 'characters' ? characterSortMode : instructionSortMode}
                    onChange={(event: SelectChangeEvent) => {
                      const nextValue = event.target.value as CommunityCardSortMode
                      if (activeSection === 'characters') {
                        setCharacterSortMode(nextValue)
                        return
                      }
                      setInstructionSortMode(nextValue)
                    }}
                    IconComponent={() => null}
                    sx={{
                      height: TOP_FILTER_CONTROL_HEIGHT,
                      borderRadius: TOP_FILTER_CONTROL_RADIUS,
                      color: APP_TEXT_PRIMARY,
                      px: 0,
                      fontSize: '0.95rem',
                      '& .MuiSelect-select': {
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        py: 0,
                        pl: TOP_FILTER_TEXT_PADDING_X,
                        pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        border: 'none',
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          mt: 0.5,
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_CARD_BACKGROUND,
                          color: APP_TEXT_PRIMARY,
                          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.44)',
                        },
                      },
                    }}
                  >
                    {CARD_SORT_OPTIONS.map((option) => (
                      <MenuItem
                        key={option.value}
                        value={option.value}
                        sx={{
                          fontSize: '0.95rem',
                          color: APP_TEXT_PRIMARY,
                          '&.Mui-selected': {
                            backgroundColor: APP_BUTTON_ACTIVE,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right: TOP_FILTER_ICON_OFFSET_X,
                      transform: 'translateY(-50%)',
                      color: APP_TEXT_SECONDARY,
                      pointerEvents: 'none',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <FilterGlyph />
                  </Box>
                </FormControl>

                <FormControl
                  sx={{
                    position: 'relative',
                    minHeight: TOP_FILTER_CONTROL_HEIGHT,
                    borderRadius: TOP_FILTER_CONTROL_RADIUS,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                  }}
                >
                  <Select
                    value={activeSection === 'characters' ? characterAddedFilter : instructionAddedFilter}
                    onChange={(event: SelectChangeEvent) => {
                      const nextValue = event.target.value as CommunityAddedFilter
                      if (activeSection === 'characters') {
                        setCharacterAddedFilter(nextValue)
                        return
                      }
                      setInstructionAddedFilter(nextValue)
                    }}
                    IconComponent={() => null}
                    sx={{
                      height: TOP_FILTER_CONTROL_HEIGHT,
                      borderRadius: TOP_FILTER_CONTROL_RADIUS,
                      color: APP_TEXT_PRIMARY,
                      px: 0,
                      fontSize: '0.95rem',
                      '& .MuiSelect-select': {
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        py: 0,
                        pl: TOP_FILTER_TEXT_PADDING_X,
                        pr: TOP_FILTER_TEXT_PADDING_WITH_ICON_X,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        border: 'none',
                      },
                    }}
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          mt: 0.5,
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_CARD_BACKGROUND,
                          color: APP_TEXT_PRIMARY,
                          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.44)',
                        },
                      },
                    }}
                  >
                    {ADDED_FILTER_OPTIONS.map((option) => (
                      <MenuItem
                        key={option.value}
                        value={option.value}
                        sx={{
                          fontSize: '0.95rem',
                          color: APP_TEXT_PRIMARY,
                          '&.Mui-selected': {
                            backgroundColor: APP_BUTTON_ACTIVE,
                          },
                          '&.Mui-selected:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      right: TOP_FILTER_ICON_OFFSET_X,
                      transform: 'translateY(-50%)',
                      color: APP_TEXT_SECONDARY,
                      pointerEvents: 'none',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <FilterGlyph />
                  </Box>
                </FormControl>
              </>
            )}
          </Box>

          {communityWorldsError ? (
            <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>
              {communityWorldsError}
            </Alert>
          ) : null}

          {activeSection === 'worlds' ? (
            isCommunityWorldsLoading && communityWorlds.length === 0 ? (
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
                <Typography sx={{ color: APP_TEXT_SECONDARY }}>Пока нет публичных миров от игроков.</Typography>
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
                <Typography sx={{ color: APP_TEXT_SECONDARY }}>По выбранным фильтрам миры не найдены.</Typography>
              </Box>
            ) : (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.4,
                    gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                  }}
                >
                  {visibleCommunityWorlds.map((world) => (
                    <CommunityWorldCard
                      key={world.id}
                      world={world}
                      onClick={() => void handleOpenCommunityWorld(world.id)}
                      onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                      disabled={isCommunityWorldDialogLoading}
                      showFavoriteButton
                      isFavoriteSaving={Boolean(favoriteWorldActionById[world.id])}
                      onToggleFavorite={(item) => void handleToggleFavoriteWorld(item)}
                    />
                  ))}
                </Box>
                {hasMoreCommunityWorlds ? <Box ref={loadMoreCommunityWorldsRef} sx={{ height: 1, width: '100%' }} /> : null}
              </>
            )
          ) : activeSection === 'characters' ? (
            isCommunityCharactersLoading && communityCharacters.length === 0 ? (
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
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.4,
                    gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                  }}
                >
                  {visibleCommunityCharacters.map((item) => (
                    <CommunityCharacterCard
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      disabled={isCommunityCharacterLoading}
                      onClick={() => void handleOpenCommunityCharacter(item.id)}
                    />
                  ))}
                </Box>
                {hasMoreCommunityCharacters ? (
                  <Box ref={loadMoreCommunityCharactersRef} sx={{ height: 1, width: '100%' }} />
                ) : null}
              </>
            )
          ) : isCommunityInstructionTemplatesLoading && communityInstructionTemplates.length === 0 ? (
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
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.4,
                  gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                }}
              >
                {visibleCommunityInstructionTemplates.map((item) => (
                  <CommunityInstructionCard
                    key={item.id}
                    item={item}
                    currentUserId={user.id}
                    disabled={isCommunityInstructionTemplateLoading}
                    onClick={() => void handleOpenCommunityInstructionTemplate(item.id)}
                  />
                ))}
              </Box>
              {hasMoreCommunityInstructionTemplates ? (
                <Box ref={loadMoreCommunityInstructionTemplatesRef} sx={{ height: 1, width: '100%' }} />
              ) : null}
            </>
          )}
        </Box>
      </Box>

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
        open={communityEntityReportTarget !== null}
        onClose={handleCloseCommunityEntityReportDialog}
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
        onClose={() => setPaymentSuccessCoins(null)}
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

