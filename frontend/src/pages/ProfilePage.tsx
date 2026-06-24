import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Skeleton,
  Stack,
  SvgIcon,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import AppDownloadDialog from '../components/AppDownloadDialog'
import HeaderAccountActions from '../components/HeaderAccountActions'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import SoulAmount from '../components/currency/SoulAmount'
import { AI_ASSISTANT_ENTITIES_CHANGED_EVENT } from '../components/ai/aiAssistantEvents'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import ProgressiveImage from '../components/media/ProgressiveImage'
import { useIncrementalList } from '../hooks/useIncrementalList'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import { useScrollLoadTrigger } from '../hooks/useScrollLoadTrigger'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import { MobileCardItem } from '../components/mobile/MobileCardSlider'
import AdminPanelDialog from '../components/profile/AdminPanelDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import WorldCardTemplatesPanel from '../components/profile/WorldCardTemplatesPanel'
import TextLimitIndicator from '../components/TextLimitIndicator'
import TopUpDialog from '../components/profile/TopUpDialog'
import UserAvatar from '../components/profile/UserAvatar'
import Footer from '../components/Footer'
import { ONBOARDING_GUIDE_COMMAND_EVENT, type OnboardingGuideCommandDetail } from '../utils/onboardingGuide'
import { buildUnifiedMobileQuickActions } from '../utils/mobileQuickActions'
import {
  createCoinTopUpPayment,
  deleteCurrentUserGalleryImage,
  deleteCurrentUserNotification,
  followUserProfile,
  getCurrentUserNotificationSummary,
  getCurrentUserReferralSummary,
  getShopCatalog,
  listCurrentUserNotifications,
  markAllCurrentUserNotificationsRead,
  getProfileView,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  unfollowUserProfile,
  updateCurrentUserAvatar,
  updateCurrentUserProfilePrivacy,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
  type CosmeticItem,
  type ProfileFollowState,
  type ProfileGalleryImage,
  type ProfileView,
  type ReferralSummary,
  type UserNotificationCounters,
  type UserNotification,
} from '../services/authApi'
import { buildReferralLink } from '../utils/referrals'
import {
  cloneStoryGame,
  deleteStoryCharacter,
  deleteStoryGame,
  deleteStoryInstructionTemplate,
  favoriteCommunityWorld,
  listStoryGames,
  listFavoriteCommunityWorlds,
  listStoryCharacters,
  listStoryInstructionTemplates,
  unfavoriteCommunityWorld,
} from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import { getDisplayedTagLabel } from '../types/auth'
import type { AiAssistantChatResponse } from '../services/aiAssistantApi'
import type {
  StoryCharacter,
  StoryCommunityCharacterSummary,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldSummary,
  StoryGameSummary,
  StoryInstructionTemplate,
} from '../types/story'
import { moriusThemeTokens } from '../theme'
import { getProfileBannerPreset, normalizeProfileBannerId } from '../constants/profileBanners'
import { resolveProfileBannerImageUrl, withKnownCosmeticImageUrl } from '../utils/cosmeticImageFallbacks'
import { normalizeAvatarFrameId } from '../constants/avatarFrames'
import { resolveApiResourceUrl } from '../services/httpClient'
import { dispatchNotificationsChanged } from '../utils/notifications'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'
import {
  PublicationEntityCard,
  buildPublicationCardPresentation,
  mergePublicationWorldSourceRows,
  resolvePublicationDisplayState,
  resolvePublicationWorldEditTargetId,
  selectVisiblePublicationItems,
  type PublicationSection,
} from './MyPublicationsPage'

type ProfilePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  viewedUserId?: number | null
}

type TabId = 'games' | 'characters' | 'world_cards' | 'instructions' | 'gallery' | 'favorites' | 'notifications' | 'plots' | 'subscriptions' | 'publications'
type ProfileMainSection = 'library' | 'publications'
type NotificationSortMode = 'newest' | 'oldest'
type ProfileContentSortMode = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'popular_desc' | 'rating_desc'
type CloneSectionKey = 'instructions' | 'plot' | 'world' | 'main_hero' | 'history'
type CloneSelectionState = Record<CloneSectionKey, boolean>
type ProfileServerPage<T> = {
  items: T[]
  hasMore: boolean
}

const PROFILE_NAME_MAX = 25
const PROFILE_DESC_MAX = 2000
const PROFILE_CONTENT_SEARCH_MAX = 120
const PROFILE_CONTENT_SEARCH_DEBOUNCE_MS = 280
const PROFILE_CARD_BATCH_SIZE = 12
const PROFILE_SERVER_REQUEST_SIZE = PROFILE_CARD_BATCH_SIZE + 1
const PROFILE_NOTIFICATION_PAGE_SIZE = 12
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const PROFILE_AVATAR_SIZE = 128
const CARD_MIN_HEIGHT = 174
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const PROFILE_CONTENT_SKELETON_CARD_KEYS = Array.from({ length: 4 }, (_, index) => `profile-content-skeleton-${index}`)
const PROFILE_TAB_BUTTON_SKELETON_KEYS = Array.from({ length: 6 }, (_, index) => `profile-tab-skeleton-${index}`)
const PROFILE_PUBLICATION_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
const DEFAULT_CLONE_SELECTION: CloneSelectionState = {
  instructions: true,
  plot: true,
  world: true,
  main_hero: true,
  history: true,
}
const CLONE_SECTION_ITEMS: Array<{ key: CloneSectionKey; label: string }> = [
  { key: 'instructions', label: 'Инструкции' },
  { key: 'plot', label: 'Сюжет' },
  { key: 'world', label: 'Мир' },
  { key: 'main_hero', label: 'ГГ' },
  { key: 'history', label: 'История' },
]

const BASE_PROFILE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'games', label: 'Игры' },
  { id: 'world_cards', label: 'Миры' },
  { id: 'characters', label: 'Персонажи' },
  { id: 'instructions', label: 'Правила' },
  { id: 'gallery', label: 'Галерея' },
]

const PROFILE_PUBLICATION_TABS: Array<{ id: PublicationSection; label: string; iconTab: TabId }> = [
  { id: 'worlds', label: 'Игры', iconTab: 'games' },
  { id: 'characters', label: 'Персонажи', iconTab: 'characters' },
  { id: 'instructions', label: 'Правила', iconTab: 'instructions' },
]

const PROFILE_TAB_LABELS: Record<Exclude<TabId, 'notifications'>, string> = {
  games: 'Игры',
  publications: 'Миры',
  characters: 'Персонажи',
  world_cards: 'Миры',
  instructions: 'Правила',
  gallery: 'Галерея',
  favorites: 'Любимое',
  plots: 'Сюжеты',
  subscriptions: 'Подписки',
}

const PROFILE_NOTIFICATIONS_LABEL = 'Уведомления'
const NOTIFICATION_SORT_OPTIONS: Array<{ value: NotificationSortMode; label: string }> = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
]

const PROFILE_SORT_COLLATOR = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true })

const PROFILE_TAB_SORT_OPTIONS: Partial<Record<TabId, Array<{ value: string; label: string }>>> = {
  games: [
    { value: 'updated_desc', label: 'Сначала новые' },
    { value: 'updated_asc', label: 'Сначала старые' },
    { value: 'name_asc', label: 'Название А-Я' },
    { value: 'name_desc', label: 'Название Я-А' },
  ],
  characters: [
    { value: 'updated_desc', label: 'Сначала новые' },
    { value: 'updated_asc', label: 'Сначала старые' },
    { value: 'name_asc', label: 'Имя А-Я' },
    { value: 'name_desc', label: 'Имя Я-А' },
    { value: 'popular_desc', label: 'По добавлениям' },
  ],
  instructions: [
    { value: 'updated_desc', label: 'Сначала новые' },
    { value: 'updated_asc', label: 'Сначала старые' },
    { value: 'name_asc', label: 'Название А-Я' },
    { value: 'name_desc', label: 'Название Я-А' },
    { value: 'popular_desc', label: 'По добавлениям' },
  ],
  favorites: [
    { value: 'popular_desc', label: 'По популярности' },
    { value: 'rating_desc', label: 'По рейтингу' },
    { value: 'updated_desc', label: 'Сначала новые' },
    { value: 'updated_asc', label: 'Сначала старые' },
    { value: 'name_asc', label: 'Название А-Я' },
  ],
  publications: [
    { value: 'popular_desc', label: 'По популярности' },
    { value: 'rating_desc', label: 'По рейтингу' },
    { value: 'updated_desc', label: 'Сначала новые' },
    { value: 'updated_asc', label: 'Сначала старые' },
    { value: 'name_asc', label: 'Название А-Я' },
  ],
  subscriptions: [
    { value: 'name_asc', label: 'Имя А-Я' },
    { value: 'name_desc', label: 'Имя Я-А' },
  ],
}

const PROFILE_TAB_DEFAULT_SORT_MODE: Partial<Record<TabId, ProfileContentSortMode>> = {
  games: 'updated_desc',
  characters: 'updated_desc',
  instructions: 'updated_desc',
  favorites: 'popular_desc',
  publications: 'popular_desc',
  subscriptions: 'name_asc',
}

type ProfileSortableCharacterCard = Pick<
  StoryCharacter | StoryCommunityCharacterSummary,
  'id' | 'updated_at' | 'name' | 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableTemplateCard = Pick<
  StoryInstructionTemplate | StoryCommunityInstructionTemplateSummary,
  'id' | 'updated_at' | 'title' | 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableWorldCard = Pick<
  StoryCommunityWorldSummary,
  'id' | 'title' | 'created_at' | 'updated_at' | 'community_launches' | 'community_views' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableGameCard = Pick<StoryGameSummary, 'id' | 'title' | 'created_at' | 'updated_at' | 'last_activity_at'>

type ProfileSortableSubscription = Pick<ProfileView['subscriptions'][number], 'id' | 'display_name'>

function compareProfileText(left: string, right: string): number {
  return PROFILE_SORT_COLLATOR.compare(left.trim(), right.trim())
}

function compareProfilePopularity(
  left: Pick<ProfileSortableCharacterCard | ProfileSortableTemplateCard, 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'>,
  right: Pick<ProfileSortableCharacterCard | ProfileSortableTemplateCard, 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'>,
): number {
  if (right.community_additions_count !== left.community_additions_count) {
    return right.community_additions_count - left.community_additions_count
  }
  if (right.community_rating_count !== left.community_rating_count) {
    return right.community_rating_count - left.community_rating_count
  }
  if (right.community_rating_avg !== left.community_rating_avg) {
    return right.community_rating_avg - left.community_rating_avg
  }
  return 0
}

function compareProfileWorldPopularity(left: ProfileSortableWorldCard, right: ProfileSortableWorldCard): number {
  if (right.community_launches !== left.community_launches) {
    return right.community_launches - left.community_launches
  }
  if (right.community_views !== left.community_views) {
    return right.community_views - left.community_views
  }
  if (right.community_rating_count !== left.community_rating_count) {
    return right.community_rating_count - left.community_rating_count
  }
  if (right.community_rating_avg !== left.community_rating_avg) {
    return right.community_rating_avg - left.community_rating_avg
  }
  return 0
}

function sortProfileCharacters<T extends ProfileSortableCharacterCard>(items: T[], mode: ProfileContentSortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === 'name_asc') {
      return compareProfileText(left.name, right.name) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'name_desc') {
      return compareProfileText(right.name, left.name) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'updated_asc') {
      return parseSortDate(left.updated_at) - parseSortDate(right.updated_at) || left.id - right.id
    }
    if (mode === 'rating_desc') {
      if (right.community_rating_count !== left.community_rating_count) {
        return right.community_rating_count - left.community_rating_count
      }
      if (right.community_rating_avg !== left.community_rating_avg) {
        return right.community_rating_avg - left.community_rating_avg
      }
      return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'popular_desc') {
      return compareProfilePopularity(left, right) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
  })
}

function sortProfileTemplates<T extends ProfileSortableTemplateCard>(items: T[], mode: ProfileContentSortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === 'name_asc') {
      return compareProfileText(left.title, right.title) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'name_desc') {
      return compareProfileText(right.title, left.title) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'updated_asc') {
      return parseSortDate(left.updated_at) - parseSortDate(right.updated_at) || left.id - right.id
    }
    if (mode === 'rating_desc') {
      if (right.community_rating_count !== left.community_rating_count) {
        return right.community_rating_count - left.community_rating_count
      }
      if (right.community_rating_avg !== left.community_rating_avg) {
        return right.community_rating_avg - left.community_rating_avg
      }
      return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'popular_desc') {
      return compareProfilePopularity(left, right) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
  })
}

function sortProfileWorlds<T extends ProfileSortableWorldCard>(items: T[], mode: ProfileContentSortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === 'name_asc') {
      return compareProfileText(left.title, right.title) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    if (mode === 'updated_asc') {
      return parseSortDate(left.updated_at || left.created_at) - parseSortDate(right.updated_at || right.created_at) || left.id - right.id
    }
    if (mode === 'rating_desc') {
      if (right.community_rating_count !== left.community_rating_count) {
        return right.community_rating_count - left.community_rating_count
      }
      if (right.community_rating_avg !== left.community_rating_avg) {
        return right.community_rating_avg - left.community_rating_avg
      }
      return parseSortDate(right.updated_at || right.created_at) - parseSortDate(left.updated_at || left.created_at) || right.id - left.id
    }
    if (mode === 'popular_desc') {
      return compareProfileWorldPopularity(left, right)
        || parseSortDate(right.updated_at || right.created_at) - parseSortDate(left.updated_at || left.created_at)
        || right.id - left.id
    }
    return parseSortDate(right.updated_at || right.created_at) - parseSortDate(left.updated_at || left.created_at) || right.id - left.id
  })
}

function sortProfileGames<T extends ProfileSortableGameCard>(items: T[], mode: ProfileContentSortMode): T[] {
  return [...items].sort((left, right) => {
    if (mode === 'name_asc') {
      return compareProfileText(left.title, right.title) || parseSortDate(right.last_activity_at || right.updated_at || right.created_at) - parseSortDate(left.last_activity_at || left.updated_at || left.created_at) || right.id - left.id
    }
    if (mode === 'name_desc') {
      return compareProfileText(right.title, left.title) || parseSortDate(right.last_activity_at || right.updated_at || right.created_at) - parseSortDate(left.last_activity_at || left.updated_at || left.created_at) || right.id - left.id
    }
    if (mode === 'updated_asc') {
      return parseSortDate(left.last_activity_at || left.updated_at || left.created_at) - parseSortDate(right.last_activity_at || right.updated_at || right.created_at) || left.id - right.id
    }
    return parseSortDate(right.last_activity_at || right.updated_at || right.created_at) - parseSortDate(left.last_activity_at || left.updated_at || left.created_at) || right.id - left.id
  })
}

function sortProfileSubscriptions<T extends ProfileSortableSubscription>(
  items: T[],
  mode: Extract<ProfileContentSortMode, 'name_asc' | 'name_desc'>,
): T[] {
  return [...items].sort((left, right) => {
    if (mode === 'name_desc') {
      return compareProfileText(right.display_name, left.display_name) || right.id - left.id
    }
    return compareProfileText(left.display_name, right.display_name) || left.id - right.id
  })
}

function splitProfileServerPage<T>(items: T[]): ProfileServerPage<T> {
  return {
    items: items.slice(0, PROFILE_CARD_BATCH_SIZE),
    hasMore: items.length > PROFILE_CARD_BATCH_SIZE,
  }
}

function mergeProfileServerItems<T extends { id: number }>(currentItems: T[], nextItems: T[]): T[] {
  const seenIds = new Set(currentItems.map((item) => item.id))
  const mergedItems = [...currentItems]
  nextItems.forEach((item) => {
    if (seenIds.has(item.id)) {
      return
    }
    seenIds.add(item.id)
    mergedItems.push(item)
  })
  return mergedItems
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timerId = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timerId)
  }, [delayMs, value])

  return debouncedValue
}

function toProfileGameApiSort(mode: ProfileContentSortMode): 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' {
  if (mode === 'updated_asc') {
    return 'updated_asc'
  }
  return 'updated_desc'
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

function toPublicationWorld(
  game: StoryGameSummary,
  payload: {
    authorId: number
    authorName: string
    authorAvatarUrl: string | null
    authorAvatarFrameId?: string | null
    authorAvatarFrameImageUrl?: string | null
  },
): StoryCommunityWorldSummary {
  return {
    id: game.id,
    title: (game.title || '').trim() || 'Без названия',
    description: (game.description || '').trim() || 'Описание пока не добавлено.',
    author_id: payload.authorId,
    author_name: payload.authorName,
    author_avatar_url: payload.authorAvatarUrl,
    author_avatar_frame_id: normalizeAvatarFrameId(payload.authorAvatarFrameId),
    author_avatar_frame_image_url: payload.authorAvatarFrameImageUrl ?? null,
    age_rating: game.age_rating,
    genres: game.genres,
    cover_image_url: game.cover_image_url,
    cover_scale: game.cover_scale,
    cover_position_x: game.cover_position_x,
    cover_position_y: game.cover_position_y,
    community_views: game.community_views,
    community_launches: Math.max(0, game.turn_count || 0),
    community_rating_avg: game.community_rating_avg,
    community_rating_count: game.community_rating_count,
    user_rating: null,
    is_reported_by_user: false,
    is_favorited_by_user: false,
    created_at: game.created_at,
    updated_at: game.updated_at,
  }
}

function parseSortDate(rawValue: string): number {
  const parsed = Date.parse(rawValue)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNotificationDate(rawValue: string): string {
  const parsed = Date.parse(rawValue)
  if (!Number.isFinite(parsed)) {
    return 'Дата неизвестна'
  }
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}

function formatProfileGameTurnCount(value: number): string {
  const count = Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0)
  const mod10 = count % 10
  const mod100 = count % 100
  const label = mod10 === 1 && mod100 !== 11 ? 'ход' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'хода' : 'ходов'
  return `${count.toLocaleString('ru-RU')} ${label}`
}

function formatProfileGameCardDate(rawValue: string | null | undefined): string {
  const parsed = Date.parse(String(rawValue || ''))
  if (!Number.isFinite(parsed)) {
    return ''
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(parsed))
}

function resolveProfileGameCardDescription(game: StoryGameSummary): string {
  return (
    (game.latest_message_preview || '').trim()
    || (game.description || '').trim()
    || (game.opening_scene || '').trim()
    || 'Продолжите историю с последнего хода.'
  )
}

function clampAvatarScale(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  return Math.max(1, Math.min(3, value))
}

function normalizeProfileSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function matchesProfileSearch(query: string, fields: Array<string | null | undefined>): boolean {
  if (!query) {
    return true
  }
  return fields.some((field) => normalizeProfileSearchValue(field ?? '').includes(query))
}

function mergeNotificationsById(previous: UserNotification[], nextItems: UserNotification[]): UserNotification[] {
  const nextById = new Map<number, UserNotification>()
  previous.forEach((item) => {
    nextById.set(item.id, item)
  })
  nextItems.forEach((item) => {
    nextById.set(item.id, item)
  })
  return Array.from(nextById.values())
}

function toAvatarUser(profileUser: ProfileView['user']): AuthUser {
  return {
    id: profileUser.id,
    email: '',
    display_name: profileUser.display_name,
    profile_description: profileUser.profile_description,
    profile_banner_id: normalizeProfileBannerId(profileUser.profile_banner_id),
    profile_banner_image_url: profileUser.profile_banner_image_url ?? null,
    avatar_frame_id: normalizeAvatarFrameId(profileUser.avatar_frame_id),
    avatar_url: profileUser.avatar_url,
    avatar_scale: profileUser.avatar_scale,
    auth_provider: 'email',
    role: profileUser.role,
    profile_tag: profileUser.profile_tag,
    level: 1,
    coins: 0,
    is_banned: false,
    ban_expires_at: null,
    created_at: profileUser.created_at,
  }
}

function ProfilePage({ user, authToken, onNavigate, onUserUpdate, onLogout, viewedUserId = null }: ProfilePageProps) {
    const normalizedViewedUserId =
      typeof viewedUserId === 'number' && Number.isFinite(viewedUserId) && viewedUserId > 0 ? viewedUserId : null
    const isOwnProfile = normalizedViewedUserId === null || normalizedViewedUserId === user.id
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileMainSection, setProfileMainSection] = useState<ProfileMainSection>('library')
  const [tab, setTab] = useState<TabId>('games')
  const [publicationSection, setPublicationSection] = useState<PublicationSection>('worlds')
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSortMenuAnchorEl, setContentSortMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [contentSortModeByTab, setContentSortModeByTab] = useState<Partial<Record<TabId, ProfileContentSortMode>>>(
    PROFILE_TAB_DEFAULT_SORT_MODE,
  )
  const [mobileProfileMenuAnchorEl, setMobileProfileMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [isDescExpanded, setIsDescExpanded] = useState(false)
  const debouncedContentSearchQuery = useDebouncedValue(contentSearchQuery, PROFILE_CONTENT_SEARCH_DEBOUNCE_MS)
  const deferredContentSearchQuery = useDeferredValue(debouncedContentSearchQuery)

  const [isEditing, setIsEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(user.display_name || 'Игрок')
  const [descriptionDraft, setDescriptionDraft] = useState(user.profile_description || '')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileView, setProfileView] = useState<ProfileView | null>(null)
  const [isProfileViewLoading, setIsProfileViewLoading] = useState(false)
  const [isFollowSaving, setIsFollowSaving] = useState(false)
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false)
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false)
  const [privacyDraft, setPrivacyDraft] = useState({
    show_subscriptions: false,
    show_public_worlds: false,
    show_private_worlds: false,
    show_public_characters: false,
    show_public_instruction_templates: false,
  })

  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [templates, setTemplates] = useState<StoryInstructionTemplate[]>([])
  const [worldCardTemplateCount, setWorldCardTemplateCount] = useState(0)
  void worldCardTemplateCount
  const [favoriteWorlds, setFavoriteWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [hasLoadedFavoriteWorlds, setHasLoadedFavoriteWorlds] = useState(false)
  const [isFavoriteWorldsLoading, setIsFavoriteWorldsLoading] = useState(false)
  const [isFavoriteWorldsLoadingMore, setIsFavoriteWorldsLoadingMore] = useState(false)
  const [hasMoreFavoriteWorldsServer, setHasMoreFavoriteWorldsServer] = useState(false)
  const [favoriteLoadingById, setFavoriteLoadingById] = useState<Record<number, boolean>>({})
  const [ownGames, setOwnGames] = useState<StoryGameSummary[]>([])
  const [isOwnGamesLoading, setIsOwnGamesLoading] = useState(false)
  const [isOwnGamesLoadingMore, setIsOwnGamesLoadingMore] = useState(false)
  const [hasMoreOwnGamesServer, setHasMoreOwnGamesServer] = useState(false)
  const [isCharactersLoadingMore, setIsCharactersLoadingMore] = useState(false)
  const [hasMoreCharactersServer, setHasMoreCharactersServer] = useState(false)
  const [isTemplatesLoadingMore, setIsTemplatesLoadingMore] = useState(false)
  const [hasMoreTemplatesServer, setHasMoreTemplatesServer] = useState(false)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [notificationPopoverAnchorEl, setNotificationPopoverAnchorEl] = useState<HTMLElement | null>(null)
  const [notificationCounts, setNotificationCounts] = useState<UserNotificationCounters>({ unread_count: 0, total_count: 0 })
  const [hasLoadedNotifications, setHasLoadedNotifications] = useState(false)
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false)
  const [isNotificationsLoadingMore, setIsNotificationsLoadingMore] = useState(false)
  const [hasMoreNotificationsServer, setHasMoreNotificationsServer] = useState(false)
  const [notificationSortMode, setNotificationSortMode] = useState<NotificationSortMode>('newest')
  const [notificationDeletingId, setNotificationDeletingId] = useState<number | null>(null)
  const [hoveredNotificationId, setHoveredNotificationId] = useState<number | null>(null)

  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)

  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogMode, setCharacterDialogMode] = useState<'list' | 'create'>('list')
  const [characterEditId, setCharacterEditId] = useState<number | null>(null)
  const [characterAvatarPreview, setCharacterAvatarPreview] = useState<{ url: string; name: string } | null>(null)
  const [galleryPreviewImage, setGalleryPreviewImage] = useState<ProfileGalleryImage | null>(null)
  const [deletingGalleryImageIds, setDeletingGalleryImageIds] = useState<Set<number>>(() => new Set())
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [instructionDialogMode, setInstructionDialogMode] = useState<'list' | 'create'>('list')
  const [instructionEditId, setInstructionEditId] = useState<number | null>(null)
  const [contentCardMenuAnchorEl, setContentCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [contentCardMenuType, setContentCardMenuType] = useState<'character' | 'instruction' | null>(null)
  const [contentCardMenuItemId, setContentCardMenuItemId] = useState<number | null>(null)
  const [gameCardMenuAnchorEl, setGameCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [gameCardMenuGameId, setGameCardMenuGameId] = useState<number | null>(null)
  const [gameCardMenuBusyAction, setGameCardMenuBusyAction] = useState<'clone' | 'delete' | null>(null)
  const [cloneDialogSourceGame, setCloneDialogSourceGame] = useState<StoryGameSummary | null>(null)
  const [cloneSelection, setCloneSelection] = useState<CloneSelectionState>({ ...DEFAULT_CLONE_SELECTION })

  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)
  const [paymentReferralBonusCoins, setPaymentReferralBonusCoins] = useState(0)
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null)
  const [isReferralSummaryLoading, setIsReferralSummaryLoading] = useState(false)
  const [referralError, setReferralError] = useState('')
  const [isReferralCopied, setIsReferralCopied] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [appDownloadDialogOpen, setAppDownloadDialogOpen] = useState(false)
  const [shopProfileBanners, setShopProfileBanners] = useState<CosmeticItem[]>([])

  const [error, setError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const lastContentTabRef = useRef<TabId>('characters')
  const notificationsLoadMoreTriggeredRef = useRef(0)

  const profileName = user.display_name?.trim() || 'Игрок'
  const profileDescription = user.profile_description || ''
  const coins = Math.max(0, Math.trunc(user.coins || 0))
  const canOpenAdmin = user.role === 'administrator' || user.role === 'moderator'
  const isProfileNarrowMobile = useMediaQuery('(max-width:550px)')

  const fallbackOwnProfileUser = {
    id: user.id,
    display_name: profileName,
    profile_description: profileDescription,
    profile_banner_id: normalizeProfileBannerId(user.profile_banner_id),
    profile_banner_image_url: user.profile_banner_image_url ?? null,
    avatar_frame_id: normalizeAvatarFrameId(user.avatar_frame_id),
    avatar_frame_image_url: user.avatar_frame_image_url ?? null,
    avatar_url: user.avatar_url,
    avatar_scale: user.avatar_scale ?? 1,
    role: user.role,
    profile_tag: user.profile_tag ?? '',
    created_at: user.created_at,
  }
  const fallbackViewedProfileUser = {
    id: normalizedViewedUserId ?? 0,
    display_name: '',
    profile_description: '',
    profile_banner_id: normalizeProfileBannerId(null),
    profile_banner_image_url: null,
    avatar_frame_id: normalizeAvatarFrameId(null),
    avatar_frame_image_url: null,
    avatar_url: null,
    avatar_scale: 1,
    role: 'user',
    profile_tag: '',
    created_at: user.created_at,
  }
  const resolvedProfileUser = profileView?.user ?? (isOwnProfile ? fallbackOwnProfileUser : fallbackViewedProfileUser)
  const resolvedProfileName = resolvedProfileUser.display_name?.trim() || (isOwnProfile ? profileName : 'Игрок')
  const resolvedProfileRoleBadge = getDisplayedTagLabel(resolvedProfileUser.role, resolvedProfileUser.profile_tag)
  const resolvedProfileDescription = resolvedProfileUser.profile_description || ''
  const resolvedProfileBanner = getProfileBannerPreset(resolvedProfileUser.profile_banner_id)
  const resolvedPaidProfileBanner = shopProfileBanners.find((item) => item.selection_id === resolvedProfileUser.profile_banner_id) ?? null
  const resolvedPaidProfileBannerSrc = resolvedPaidProfileBanner?.image_url ?? null
  const resolvedProfileBannerSrc =
    resolveProfileBannerImageUrl(
      resolvedProfileUser.profile_banner_id,
      resolvedProfileUser.profile_banner_image_url ?? resolvedPaidProfileBannerSrc,
    ) ?? resolvedProfileBanner.src
  const resolvedProfileBannerObjectPosition =
    resolvedProfileUser.profile_banner_image_url || resolvedPaidProfileBanner ? 'center center' : resolvedProfileBanner.objectPosition
  const shouldLoadPaidProfileBannerCatalog =
    resolvedProfileUser.profile_banner_id.startsWith('b') && !resolvedProfileUser.profile_banner_image_url
  const resolvedAvatarUser = isOwnProfile ? user : toAvatarUser(resolvedProfileUser)
  const resolvedCanOpenAdmin = isOwnProfile && canOpenAdmin
  const followersCount = Math.max(0, profileView?.followers_count ?? 0)
  const subscriptionsCount = Math.max(0, profileView?.subscriptions_count ?? 0)
  const canViewSubscriptions = Boolean(profileView?.can_view_subscriptions)
  const canViewPublicWorlds = Boolean(profileView?.can_view_public_worlds)
  const canViewPublicCharacters = Boolean(profileView?.can_view_public_characters)
  const canViewPublicInstructionTemplates = Boolean(profileView?.can_view_public_instruction_templates)
  const canViewPrivateWorlds = Boolean(profileView?.can_view_private_worlds)
  const visiblePublicationWorlds = profileView?.published_worlds ?? []
  const visiblePublicationCharacters = profileView?.published_characters ?? []
  const visiblePublicationTemplates = profileView?.published_instruction_templates ?? []
  const visibleUnpublishedWorlds = useMemo(
    () =>
      (profileView?.unpublished_worlds ?? []).map((game) =>
        toPublicationWorld(game, {
          authorId: resolvedProfileUser.id,
          authorName: resolvedProfileName,
          authorAvatarUrl: resolvedProfileUser.avatar_url,
          authorAvatarFrameId: resolvedProfileUser.avatar_frame_id,
          authorAvatarFrameImageUrl: resolvedProfileUser.avatar_frame_image_url,
        }),
      ),
    [profileView, resolvedProfileName, resolvedProfileUser.avatar_frame_id, resolvedProfileUser.avatar_frame_image_url, resolvedProfileUser.avatar_url, resolvedProfileUser.id],
  )

  useEffect(() => {
    if (!shouldLoadPaidProfileBannerCatalog) {
      setShopProfileBanners([])
      return
    }

    let ignore = false
    void getShopCatalog({ token: authToken })
      .then((response) => {
        if (!ignore) {
          setShopProfileBanners(response.profile_banners.map(withKnownCosmeticImageUrl))
        }
      })
      .catch(() => {
        if (!ignore) {
          setShopProfileBanners([])
        }
      })
    return () => {
      ignore = true
    }
  }, [authToken, shouldLoadPaidProfileBannerCatalog])
  const visibleSubscriptions = profileView?.subscriptions ?? []
  const profileGalleryImages = profileView?.gallery_images ?? []
  const referralLink = useMemo(
    () => buildReferralLink(referralSummary?.referral_code ?? user.referral_code ?? ''),
    [referralSummary?.referral_code, user.referral_code],
  )
  const isProfileBootstrapLoading = isProfileViewLoading
  const isCurrentTabContentLoading =
    (tab === 'games' && isOwnProfile && isOwnGamesLoading && ownGames.length === 0) ||
    (tab === 'characters' && isOwnProfile && isLoadingContent && characters.length === 0) ||
    (tab === 'instructions' && isOwnProfile && isLoadingContent && templates.length === 0) ||
    (tab === 'favorites' && isOwnProfile && isFavoriteWorldsLoading && !hasLoadedFavoriteWorlds) ||
    (tab === 'notifications' && isOwnProfile && isNotificationsLoading && !hasLoadedNotifications)
  const isProfileShellBlocked = !isOwnProfile && isProfileBootstrapLoading && !profileView
  const isCurrentTabWaitingForProfileView =
    isProfileBootstrapLoading &&
    !profileView &&
    (!isOwnProfile || tab === 'publications' || tab === 'subscriptions' || tab === 'gallery')
  const tabs = useMemo(() => {
    if (isOwnProfile) {
      return BASE_PROFILE_TABS
    }
    return [
      { id: 'publications' as TabId, label: 'Миры' },
      { id: 'characters' as TabId, label: 'Персонажи' },
      { id: 'instructions' as TabId, label: 'Правила' },
    ]
  }, [isOwnProfile])

  const managedCharacters = useMemo(
    () =>
      characters.filter((character) => {
        if (character.visibility !== 'public' || character.source_character_id === null) {
          return true
        }
        const sourceCharacter = characters.find((candidate) => candidate.id === character.source_character_id)
        return !sourceCharacter || sourceCharacter.user_id !== character.user_id
      }),
    [characters],
  )

  const sortedCharacters = useMemo(
    () =>
      [...managedCharacters].sort(
        (left, right) => parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id,
      ),
    [managedCharacters],
  )

  const managedTemplates = useMemo(
    () =>
      templates.filter((template) => {
        if (template.visibility !== 'public' || template.source_template_id === null) {
          return true
        }
        const sourceTemplate = templates.find((candidate) => candidate.id === template.source_template_id)
        return !sourceTemplate || sourceTemplate.user_id !== template.user_id
      }),
    [templates],
  )

  const sortedTemplates = useMemo(
    () =>
      [...managedTemplates].sort(
        (left, right) => parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id,
      ),
    [managedTemplates],
  )
  const selectedContentCharacterMenuItem = useMemo(
    () =>
      contentCardMenuType === 'character' && contentCardMenuItemId !== null
        ? sortedCharacters.find((character) => character.id === contentCardMenuItemId) ?? null
        : null,
    [contentCardMenuItemId, contentCardMenuType, sortedCharacters],
  )
  const selectedContentInstructionMenuItem = useMemo(
    () =>
      contentCardMenuType === 'instruction' && contentCardMenuItemId !== null
        ? sortedTemplates.find((template) => template.id === contentCardMenuItemId) ?? null
        : null,
    [contentCardMenuItemId, contentCardMenuType, sortedTemplates],
  )
  const selectedGameCardMenuItem = useMemo(
    () => (gameCardMenuGameId !== null ? ownGames.find((game) => game.id === gameCardMenuGameId) ?? null : null),
    [gameCardMenuGameId, ownGames],
  )
  const normalizedContentSearchQuery = useMemo(
    () => normalizeProfileSearchValue(deferredContentSearchQuery),
    [deferredContentSearchQuery],
  )
  const characterSortMode = contentSortModeByTab.characters ?? PROFILE_TAB_DEFAULT_SORT_MODE.characters ?? 'updated_desc'
  const instructionSortMode = contentSortModeByTab.instructions ?? PROFILE_TAB_DEFAULT_SORT_MODE.instructions ?? 'updated_desc'
  const gameSortMode = contentSortModeByTab.games ?? PROFILE_TAB_DEFAULT_SORT_MODE.games ?? 'updated_desc'
  const favoriteSortMode = contentSortModeByTab.favorites ?? PROFILE_TAB_DEFAULT_SORT_MODE.favorites ?? 'popular_desc'
  const publicationSortMode = contentSortModeByTab.publications ?? PROFILE_TAB_DEFAULT_SORT_MODE.publications ?? 'popular_desc'
  const subscriptionSortMode = contentSortModeByTab.subscriptions ?? PROFILE_TAB_DEFAULT_SORT_MODE.subscriptions ?? 'name_asc'
  const activeContentSortTab: TabId =
    profileMainSection === 'publications' && isOwnProfile
      ? publicationSection === 'worlds'
        ? 'games'
        : publicationSection === 'characters'
          ? 'characters'
          : 'instructions'
      : tab
  const activeContentSortOptions = useMemo(
    () =>
      activeContentSortTab === 'notifications'
        ? NOTIFICATION_SORT_OPTIONS
        : PROFILE_TAB_SORT_OPTIONS[activeContentSortTab] ?? [],
    [activeContentSortTab],
  )
  const activeContentSortMode = activeContentSortTab === 'notifications'
    ? notificationSortMode
    : contentSortModeByTab[activeContentSortTab] ?? PROFILE_TAB_DEFAULT_SORT_MODE[activeContentSortTab] ?? ''
  const activeContentSortLabel = useMemo(
    () => activeContentSortOptions.find((option) => option.value === activeContentSortMode)?.label ?? 'Сортировка',
    [activeContentSortMode, activeContentSortOptions],
  )
  const isActiveContentSortDefault =
    activeContentSortMode ===
    (activeContentSortTab === 'notifications' ? 'newest' : PROFILE_TAB_DEFAULT_SORT_MODE[activeContentSortTab] ?? '')
  const filteredOwnGames = useMemo(
    () =>
      sortProfileGames(
        ownGames,
        gameSortMode,
      ),
    [gameSortMode, ownGames],
  )
  const filteredCharacters = useMemo(
    () =>
      sortProfileCharacters(
        sortedCharacters,
        characterSortMode,
      ),
    [characterSortMode, sortedCharacters],
  )
  const filteredTemplates = useMemo(
    () =>
      sortProfileTemplates(
        sortedTemplates,
        instructionSortMode,
      ),
    [instructionSortMode, sortedTemplates],
  )
  const filteredFavoriteWorlds = useMemo(
    () =>
      sortProfileWorlds(
        favoriteWorlds.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.description, item.author_name]),
        ),
        favoriteSortMode,
      ),
    [favoriteSortMode, favoriteWorlds, normalizedContentSearchQuery],
  )
  const filteredSubscriptions = useMemo(
    () =>
      sortProfileSubscriptions(
        visibleSubscriptions.filter((item) => matchesProfileSearch(normalizedContentSearchQuery, [item.display_name])),
        subscriptionSortMode as Extract<ProfileContentSortMode, 'name_asc' | 'name_desc'>,
      ),
    [normalizedContentSearchQuery, subscriptionSortMode, visibleSubscriptions],
  )
  const filteredGalleryImages = useMemo(
    () =>
      profileGalleryImages.filter((item) =>
        matchesProfileSearch(normalizedContentSearchQuery, [
          item.prompt,
          item.model,
          item.created_at,
          item.updated_at,
        ]),
      ),
    [normalizedContentSearchQuery, profileGalleryImages],
  )
  const filteredNotifications = useMemo(
    () =>
      [...notifications]
        .filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.body, item.actor_display_name]),
        )
        .sort((left, right) => {
          const difference = parseSortDate(right.created_at) - parseSortDate(left.created_at)
          if (difference !== 0) {
            return notificationSortMode === 'oldest' ? -difference : difference
          }
          return notificationSortMode === 'oldest' ? left.id - right.id : right.id - left.id
        }),
    [normalizedContentSearchQuery, notificationSortMode, notifications],
  )
  const filteredVisiblePublicationWorlds = useMemo(
    () =>
      sortProfileWorlds(
        visiblePublicationWorlds.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.description, item.author_name]),
        ),
        publicationSortMode,
      ),
    [normalizedContentSearchQuery, publicationSortMode, visiblePublicationWorlds],
  )
  const filteredVisiblePublicationCharacters = useMemo(
    () =>
      sortProfileCharacters(
        visiblePublicationCharacters.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [
            item.name,
            item.race,
            item.description,
            item.note,
            item.author_name,
            item.triggers.join(' '),
          ]),
        ),
        publicationSortMode,
      ),
    [normalizedContentSearchQuery, publicationSortMode, visiblePublicationCharacters],
  )
  const filteredVisiblePublicationTemplates = useMemo(
    () =>
      sortProfileTemplates(
        visiblePublicationTemplates.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.content, item.author_name]),
        ),
        publicationSortMode,
      ),
    [normalizedContentSearchQuery, publicationSortMode, visiblePublicationTemplates],
  )
  const filteredVisibleUnpublishedWorlds = useMemo(
    () =>
      sortProfileWorlds(
        visibleUnpublishedWorlds.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.description, item.author_name]),
        ),
        publicationSortMode,
      ),
    [normalizedContentSearchQuery, publicationSortMode, visibleUnpublishedWorlds],
  )
  const profilePublicationWorldSelection = useMemo(
    () => selectVisiblePublicationItems(mergePublicationWorldSourceRows(ownGames), (item) => item.source_world_id),
    [ownGames],
  )
  const profilePublicationCharacterSelection = useMemo(
    () => selectVisiblePublicationItems(characters, (item) => item.source_character_id),
    [characters],
  )
  const profilePublicationTemplateSelection = useMemo(
    () => selectVisiblePublicationItems(templates, (item) => item.source_template_id),
    [templates],
  )
  const profilePublicationGames = profilePublicationWorldSelection.visibleItems
  const profilePublicationWorldCopySourceIds = profilePublicationWorldSelection.publicationCopySourceIds
  const profilePublicationCharacters = profilePublicationCharacterSelection.visibleItems
  const profilePublicationCharacterCopySourceIds = profilePublicationCharacterSelection.publicationCopySourceIds
  const profilePublicationTemplates = profilePublicationTemplateSelection.visibleItems
  const profilePublicationTemplateCopySourceIds = profilePublicationTemplateSelection.publicationCopySourceIds
  const filteredProfilePublicationGames = useMemo(
    () =>
      sortProfileGames(
        profilePublicationGames,
        gameSortMode,
      ),
    [gameSortMode, profilePublicationGames],
  )
  const filteredProfilePublicationCharacters = useMemo(
    () =>
      sortProfileCharacters(
        profilePublicationCharacters,
        characterSortMode,
      ),
    [characterSortMode, profilePublicationCharacters],
  )
  const filteredProfilePublicationTemplates = useMemo(
    () =>
      sortProfileTemplates(
        profilePublicationTemplates,
        instructionSortMode,
      ),
    [instructionSortMode, profilePublicationTemplates],
  )
  const loadMoreOwnGames = useCallback(async () => {
    if (!isOwnProfile || isOwnGamesLoading || isOwnGamesLoadingMore || !hasMoreOwnGamesServer) {
      return
    }
    setIsOwnGamesLoadingMore(true)
    setError('')
    try {
      const loadedGames = await listStoryGames(authToken, {
        compact: true,
        limit: PROFILE_SERVER_REQUEST_SIZE,
        offset: ownGames.length,
        sort: toProfileGameApiSort(gameSortMode),
        query: normalizedContentSearchQuery || undefined,
      })
      const page = splitProfileServerPage(loadedGames)
      setOwnGames((previous) => mergeProfileServerItems(previous, page.items))
      setHasMoreOwnGamesServer(page.hasMore)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить еще игры'
      setError(detail)
    } finally {
      setIsOwnGamesLoadingMore(false)
    }
  }, [
    authToken,
    gameSortMode,
    hasMoreOwnGamesServer,
    isOwnGamesLoading,
    isOwnGamesLoadingMore,
    isOwnProfile,
    normalizedContentSearchQuery,
    ownGames.length,
  ])
  const loadMoreCharacters = useCallback(async () => {
    if (!isOwnProfile || isLoadingContent || isCharactersLoadingMore || !hasMoreCharactersServer) {
      return
    }
    setIsCharactersLoadingMore(true)
    setError('')
    try {
      const loadedCharacters = await listStoryCharacters(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        offset: characters.length,
        query: normalizedContentSearchQuery || undefined,
        includeEmotionAssets: false,
      })
      const page = splitProfileServerPage(loadedCharacters)
      setCharacters((previous) => mergeProfileServerItems(previous, page.items))
      setHasMoreCharactersServer(page.hasMore)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить еще персонажей'
      setError(detail)
    } finally {
      setIsCharactersLoadingMore(false)
    }
  }, [
    authToken,
    characters.length,
    hasMoreCharactersServer,
    isCharactersLoadingMore,
    isLoadingContent,
    isOwnProfile,
    normalizedContentSearchQuery,
  ])
  const loadMoreTemplates = useCallback(async () => {
    if (!isOwnProfile || isLoadingContent || isTemplatesLoadingMore || !hasMoreTemplatesServer) {
      return
    }
    setIsTemplatesLoadingMore(true)
    setError('')
    try {
      const loadedTemplates = await listStoryInstructionTemplates(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        offset: templates.length,
        query: normalizedContentSearchQuery || undefined,
      })
      const page = splitProfileServerPage(loadedTemplates)
      setTemplates((previous) => mergeProfileServerItems(previous, page.items))
      setHasMoreTemplatesServer(page.hasMore)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить еще инструкции'
      setError(detail)
    } finally {
      setIsTemplatesLoadingMore(false)
    }
  }, [
    authToken,
    hasMoreTemplatesServer,
    isLoadingContent,
    isOwnProfile,
    isTemplatesLoadingMore,
    normalizedContentSearchQuery,
    templates.length,
  ])
  const loadMoreFavoriteWorlds = useCallback(async () => {
    if (!isOwnProfile || isFavoriteWorldsLoading || isFavoriteWorldsLoadingMore || !hasMoreFavoriteWorldsServer) {
      return
    }
    setIsFavoriteWorldsLoadingMore(true)
    setError('')
    try {
      const loadedFavorites = await listFavoriteCommunityWorlds(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        offset: favoriteWorlds.length,
      })
      const page = splitProfileServerPage(loadedFavorites)
      setFavoriteWorlds((previous) => mergeProfileServerItems(previous, page.items))
      setHasMoreFavoriteWorldsServer(page.hasMore)
      setHasLoadedFavoriteWorlds(true)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить еще любимые миры'
      setError(detail)
    } finally {
      setIsFavoriteWorldsLoadingMore(false)
    }
  }, [
    authToken,
    favoriteWorlds.length,
    hasMoreFavoriteWorldsServer,
    isFavoriteWorldsLoading,
    isFavoriteWorldsLoadingMore,
    isOwnProfile,
  ])
  const {
    visibleItems: visibleOwnGames,
    hasMore: hasMoreOwnGames,
    loadMoreRef: loadMoreOwnGamesRef,
  } = useIncrementalList(filteredOwnGames, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|games|${gameSortMode}`,
    hasMoreRemote: hasMoreOwnGamesServer,
    isLoadingMore: isOwnGamesLoadingMore,
    onLoadMore: loadMoreOwnGames,
  })
  const {
    visibleItems: visibleCharacters,
    hasMore: hasMoreCharacters,
    loadMoreRef: loadMoreCharactersRef,
  } = useIncrementalList(filteredCharacters, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|characters|${characterSortMode}`,
    hasMoreRemote: hasMoreCharactersServer,
    isLoadingMore: isCharactersLoadingMore,
    onLoadMore: loadMoreCharacters,
  })
  const {
    visibleItems: visibleTemplates,
    hasMore: hasMoreTemplates,
    loadMoreRef: loadMoreTemplatesRef,
  } = useIncrementalList(filteredTemplates, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|instructions|${instructionSortMode}`,
    hasMoreRemote: hasMoreTemplatesServer,
    isLoadingMore: isTemplatesLoadingMore,
    onLoadMore: loadMoreTemplates,
  })
  const {
    visibleItems: visibleFavoriteWorlds,
    hasMore: hasMoreFavoriteWorlds,
    loadMoreRef: loadMoreFavoriteWorldsRef,
  } = useIncrementalList(filteredFavoriteWorlds, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|favorites|${favoriteSortMode}`,
    hasMoreRemote: hasMoreFavoriteWorldsServer,
    isLoadingMore: isFavoriteWorldsLoadingMore,
    onLoadMore: loadMoreFavoriteWorlds,
  })
  const {
    visibleItems: visibleSubscriptionsList,
    hasMore: hasMoreSubscriptions,
    loadMoreRef: loadMoreSubscriptionsRef,
  } = useIncrementalList(filteredSubscriptions, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|subscriptions|${filteredSubscriptions.length}`,
  })
  const {
    visibleItems: visibleGalleryImages,
    hasMore: hasMoreGalleryImages,
    loadMoreRef: loadMoreGalleryImagesRef,
  } = useIncrementalList(filteredGalleryImages, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|gallery|${filteredGalleryImages.length}`,
  })
  const {
    ref: loadMoreNotificationsRef,
    loadMoreSignal: loadMoreNotificationsSignal,
  } = useScrollLoadTrigger<HTMLDivElement>({
    rootMargin: '140px 0px',
    disabled:
      tab !== 'notifications' ||
      !hasMoreNotificationsServer ||
      isNotificationsLoading ||
      isNotificationsLoadingMore,
  })
  const visibleNotifications = filteredNotifications
  const {
    visibleItems: visiblePublishedWorldCards,
    hasMore: hasMorePublishedWorldCards,
    loadMoreRef: loadMorePublishedWorldCardsRef,
  } = useIncrementalList(filteredVisiblePublicationWorlds, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|published|${filteredVisiblePublicationWorlds.length}`,
  })
  const {
    visibleItems: visibleUnpublishedWorldCards,
    hasMore: hasMoreUnpublishedWorldCards,
    loadMoreRef: loadMoreUnpublishedWorldCardsRef,
  } = useIncrementalList(filteredVisibleUnpublishedWorlds, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|unpublished|${filteredVisibleUnpublishedWorlds.length}`,
  })
  const {
    visibleItems: visiblePublishedCharacterCards,
    hasMore: hasMorePublishedCharacterCards,
    loadMoreRef: loadMorePublishedCharacterCardsRef,
  } = useIncrementalList(filteredVisiblePublicationCharacters, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|published-characters|${filteredVisiblePublicationCharacters.length}`,
  })
  const {
    visibleItems: visiblePublishedInstructionCards,
    hasMore: hasMorePublishedInstructionCards,
    loadMoreRef: loadMorePublishedInstructionCardsRef,
  } = useIncrementalList(filteredVisiblePublicationTemplates, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|published-instructions|${filteredVisiblePublicationTemplates.length}`,
  })
  const {
    visibleItems: visibleProfilePublicationGames,
    hasMore: hasMoreProfilePublicationGames,
    loadMoreRef: loadMoreProfilePublicationGamesRef,
  } = useIncrementalList(filteredProfilePublicationGames, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|profile-publication-games|${gameSortMode}`,
    hasMoreRemote: hasMoreOwnGamesServer,
    isLoadingMore: isOwnGamesLoadingMore,
    onLoadMore: loadMoreOwnGames,
  })
  const {
    visibleItems: visibleProfilePublicationCharacters,
    hasMore: hasMoreProfilePublicationCharacters,
    loadMoreRef: loadMoreProfilePublicationCharactersRef,
  } = useIncrementalList(filteredProfilePublicationCharacters, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|profile-publication-characters|${characterSortMode}`,
    hasMoreRemote: hasMoreCharactersServer,
    isLoadingMore: isCharactersLoadingMore,
    onLoadMore: loadMoreCharacters,
  })
  const {
    visibleItems: visibleProfilePublicationTemplates,
    hasMore: hasMoreProfilePublicationTemplates,
    loadMoreRef: loadMoreProfilePublicationTemplatesRef,
  } = useIncrementalList(filteredProfilePublicationTemplates, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|profile-publication-instructions|${instructionSortMode}`,
    hasMoreRemote: hasMoreTemplatesServer,
    isLoadingMore: isTemplatesLoadingMore,
    onLoadMore: loadMoreTemplates,
  })
  const activeContentHeading = tab === 'notifications' ? PROFILE_NOTIFICATIONS_LABEL : PROFILE_TAB_LABELS[tab]
  void activeContentHeading
  const profileSidebarItems = useMemo(() => {
    const items: Array<{ id: TabId; label: string; count: number }> = [
      {
        id: 'games',
        label: PROFILE_TAB_LABELS.games,
        count: ownGames.length,
      },
      {
        id: 'publications',
        label: PROFILE_TAB_LABELS.publications,
        count:
          visiblePublicationWorlds.length
          + visiblePublicationCharacters.length
          + visiblePublicationTemplates.length
          + (isOwnProfile && canViewPrivateWorlds ? visibleUnpublishedWorlds.length : 0),
      },
    ]
    if (isOwnProfile) {
      items.push(
        { id: 'characters', label: PROFILE_TAB_LABELS.characters, count: managedCharacters.length },
        { id: 'instructions', label: PROFILE_TAB_LABELS.instructions, count: sortedTemplates.length },
        { id: 'gallery', label: PROFILE_TAB_LABELS.gallery, count: profileGalleryImages.length },
      )
    }
    return items
  }, [
    canViewPrivateWorlds,
    isOwnProfile,
    managedCharacters.length,
    ownGames.length,
    profileGalleryImages.length,
    sortedTemplates.length,
    visiblePublicationCharacters.length,
    visiblePublicationTemplates.length,
    visiblePublicationWorlds.length,
    visibleUnpublishedWorlds.length,
  ])
  const libraryTabCounts = useMemo<Partial<Record<TabId, number>>>(
    () => ({
      games: ownGames.length,
      world_cards: worldCardTemplateCount,
      characters: managedCharacters.length,
      instructions: sortedTemplates.length,
      gallery: profileGalleryImages.length,
    }),
    [managedCharacters.length, ownGames.length, profileGalleryImages.length, sortedTemplates.length, worldCardTemplateCount],
  )
  const libraryTotalCount = useMemo(
    () => BASE_PROFILE_TABS.reduce((sum, item) => sum + (libraryTabCounts[item.id] ?? 0), 0),
    [libraryTabCounts],
  )
  const activeProfileItemCount =
    tab === 'notifications'
      ? notificationCounts.total_count
      : profileMainSection === 'publications' && isOwnProfile
        ? publicationSection === 'worlds'
          ? filteredProfilePublicationGames.length
          : publicationSection === 'characters'
            ? filteredProfilePublicationCharacters.length
            : filteredProfilePublicationTemplates.length
        : tab === 'publications'
          ? visiblePublicationWorlds.length + visiblePublicationCharacters.length + visiblePublicationTemplates.length
          : tab === 'subscriptions'
            ? visibleSubscriptions.length
            : tab === 'favorites'
              ? favoriteWorlds.length
              : libraryTabCounts[tab] ?? 0
  const profileSidebarSubscriptions = useMemo(() => visibleSubscriptions.slice(0, 6), [visibleSubscriptions])
  const mobileContentTabs = useMemo(
    () => [
      { id: 'games' as TabId, label: 'Игры' },
      { id: 'publications' as TabId, label: 'Миры' },
      { id: 'characters' as TabId, label: 'Персонажи' },
      { id: 'instructions' as TabId, label: 'Правила' },
      { id: 'gallery' as TabId, label: 'Галерея' },
    ].filter((item) => tabs.some((tabItem) => tabItem.id === item.id)),
    [tabs],
  )

  const mobilePrimaryTab =
    tab === 'favorites' ? 'favorites' : tab === 'notifications' ? 'notifications' : tab === 'subscriptions' ? 'subscriptions' : 'content'

  const mobilePrimaryTabs = useMemo(
    () =>
      isOwnProfile
        ? [
            { id: 'content' as const, label: 'Контент' },
            { id: 'favorites' as const, label: 'Лайки' },
            { id: 'subscriptions' as const, label: 'Подписки' },
          ]
        : [
            { id: 'content' as const, label: 'Контент' },
            { id: 'subscriptions' as const, label: 'Подписки' },
          ],
    [isOwnProfile],
  )

  const resolvedMobilePrimaryTabs = useMemo(
    () =>
      isOwnProfile
        ? [
            ...mobilePrimaryTabs.slice(0, 2),
            { id: 'notifications' as const, label: 'Уведомления' },
            ...mobilePrimaryTabs.slice(2),
          ]
        : mobilePrimaryTabs,
    [isOwnProfile, mobilePrimaryTabs],
  )

  useEffect(() => {
    if (!isEditing) {
      setNameDraft(resolvedProfileName)
      setDescriptionDraft(resolvedProfileDescription)
    }
  }, [isEditing, resolvedProfileDescription, resolvedProfileName])

  const loadCharactersOnly = useCallback(async () => {
    if (!isOwnProfile) {
      setCharacters([])
      setHasMoreCharactersServer(false)
      return
    }
    setError('')
    setIsLoadingContent(true)
    try {
      const loadedCharacters = await listStoryCharacters(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        query: normalizedContentSearchQuery || undefined,
        includeEmotionAssets: false,
      })
      const page = splitProfileServerPage(loadedCharacters)
      setCharacters(page.items)
      setHasMoreCharactersServer(page.hasMore)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить персонажей'
      setCharacters([])
      setHasMoreCharactersServer(false)
      setError(detail)
    } finally {
      setIsLoadingContent(false)
    }
  }, [authToken, isOwnProfile, normalizedContentSearchQuery])

  const loadTemplatesOnly = useCallback(async () => {
    if (!isOwnProfile) {
      setTemplates([])
      setHasMoreTemplatesServer(false)
      return
    }
    setError('')
    setIsLoadingContent(true)
    try {
      const loadedTemplates = await listStoryInstructionTemplates(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        query: normalizedContentSearchQuery || undefined,
      })
      const page = splitProfileServerPage(loadedTemplates)
      setTemplates(page.items)
      setHasMoreTemplatesServer(page.hasMore)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить инструкции'
      setTemplates([])
      setHasMoreTemplatesServer(false)
      setError(detail)
    } finally {
      setIsLoadingContent(false)
    }
  }, [authToken, isOwnProfile, normalizedContentSearchQuery])

  const loadProfileContent = useCallback(async () => {
    if (!isOwnProfile) {
      setOwnGames([])
      setCharacters([])
      setTemplates([])
      setFavoriteWorlds([])
      setHasLoadedFavoriteWorlds(false)
      setHasMoreOwnGamesServer(false)
      setHasMoreCharactersServer(false)
      setHasMoreTemplatesServer(false)
      setHasMoreFavoriteWorldsServer(false)
      setIsLoadingContent(false)
      setIsOwnGamesLoading(false)
      setIsOwnGamesLoadingMore(false)
      setIsCharactersLoadingMore(false)
      setIsTemplatesLoadingMore(false)
      setIsFavoriteWorldsLoading(false)
      setIsFavoriteWorldsLoadingMore(false)
      return
    }

    setError('')
    setIsLoadingContent(true)
    setIsOwnGamesLoading(true)
    setIsOwnGamesLoadingMore(false)
    setIsCharactersLoadingMore(false)
    setIsTemplatesLoadingMore(false)
    setIsFavoriteWorldsLoadingMore(false)
    setOwnGames([])
    setCharacters([])
    setTemplates([])
    setHasMoreOwnGamesServer(false)
    setHasMoreCharactersServer(false)
    setHasMoreTemplatesServer(false)

    const [gamesResult, charactersResult, templatesResult, favoritesResult] = await Promise.allSettled([
      listStoryGames(authToken, {
        compact: true,
        limit: PROFILE_SERVER_REQUEST_SIZE,
        sort: toProfileGameApiSort(gameSortMode),
        query: normalizedContentSearchQuery || undefined,
      }),
      listStoryCharacters(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        query: normalizedContentSearchQuery || undefined,
        includeEmotionAssets: false,
      }),
      listStoryInstructionTemplates(authToken, {
        limit: PROFILE_SERVER_REQUEST_SIZE,
        query: normalizedContentSearchQuery || undefined,
      }),
      listFavoriteCommunityWorlds(authToken, { limit: PROFILE_SERVER_REQUEST_SIZE }),
    ])

    const nextErrors: string[] = []

    if (gamesResult.status === 'fulfilled') {
      const page = splitProfileServerPage(gamesResult.value)
      setOwnGames(page.items)
      setHasMoreOwnGamesServer(page.hasMore)
    } else {
      setOwnGames([])
      setHasMoreOwnGamesServer(false)
      nextErrors.push(
        gamesResult.reason instanceof Error
          ? gamesResult.reason.message
          : 'Не удалось загрузить игры',
      )
    }

    if (charactersResult.status === 'fulfilled') {
      const page = splitProfileServerPage(charactersResult.value)
      setCharacters(page.items)
      setHasMoreCharactersServer(page.hasMore)
    } else {
      setCharacters([])
      setHasMoreCharactersServer(false)
      nextErrors.push(
        charactersResult.reason instanceof Error
          ? charactersResult.reason.message
          : 'Не удалось загрузить персонажей',
      )
    }

    if (templatesResult.status === 'fulfilled') {
      const page = splitProfileServerPage(templatesResult.value)
      setTemplates(page.items)
      setHasMoreTemplatesServer(page.hasMore)
    } else {
      setTemplates([])
      setHasMoreTemplatesServer(false)
      nextErrors.push(
        templatesResult.reason instanceof Error
          ? templatesResult.reason.message
          : 'Не удалось загрузить инструкции',
      )
    }

    if (favoritesResult.status === 'fulfilled') {
      const page = splitProfileServerPage(favoritesResult.value)
      setFavoriteWorlds(page.items)
      setHasMoreFavoriteWorldsServer(page.hasMore)
      setHasLoadedFavoriteWorlds(true)
    } else {
      setFavoriteWorlds([])
      setHasMoreFavoriteWorldsServer(false)
      setHasLoadedFavoriteWorlds(false)
      nextErrors.push(
        favoritesResult.reason instanceof Error
          ? favoritesResult.reason.message
          : 'Не удалось загрузить любимые миры',
      )
    }

    setError(nextErrors[0] ?? '')
    setIsLoadingContent(false)
    setIsOwnGamesLoading(false)
    setIsFavoriteWorldsLoading(false)
  }, [authToken, gameSortMode, isOwnProfile, normalizedContentSearchQuery])

  const loadFavoriteWorlds = useCallback(async () => {
    if (!isOwnProfile) {
      setFavoriteWorlds([])
      setHasLoadedFavoriteWorlds(false)
      setHasMoreFavoriteWorldsServer(false)
      return
    }

    setIsFavoriteWorldsLoading(true)
    setError('')
    try {
      const loadedFavorites = await listFavoriteCommunityWorlds(authToken, { limit: PROFILE_SERVER_REQUEST_SIZE })
      const page = splitProfileServerPage(loadedFavorites)
      setFavoriteWorlds(page.items)
      setHasMoreFavoriteWorldsServer(page.hasMore)
      setHasLoadedFavoriteWorlds(true)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить любимые миры'
      setError(detail)
      setHasMoreFavoriteWorldsServer(false)
    } finally {
      setIsFavoriteWorldsLoading(false)
    }
  }, [authToken, isOwnProfile])
  void loadFavoriteWorlds

  const loadReferralSummary = useCallback(async () => {
    if (!isOwnProfile) {
      setReferralSummary(null)
      setReferralError('')
      return
    }

    setIsReferralSummaryLoading(true)
    setReferralError('')
    try {
      const summary = await getCurrentUserReferralSummary({ token: authToken })
      setReferralSummary(summary)
    } catch (requestError) {
      setReferralSummary(null)
      setReferralError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить реферальную ссылку')
    } finally {
      setIsReferralSummaryLoading(false)
    }
  }, [authToken, isOwnProfile])

  useEffect(() => {
    void loadReferralSummary()
  }, [loadReferralSummary])

  const handleCopyReferralLink = useCallback(async () => {
    if (!referralLink) {
      return
    }
    setReferralError('')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(referralLink)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = referralLink
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setIsReferralCopied(true)
      window.setTimeout(() => setIsReferralCopied(false), 1800)
    } catch {
      setReferralError('Не удалось скопировать ссылку')
    }
  }, [referralLink])

  /* legacyLoadNotifications
    if (!isOwnProfile) {
      setNotifications([])
      setHasLoadedNotifications(false)
      setIsNotificationsLoading(false)
      return
    }

    setIsNotificationsLoading(true)
    try {
      const loadedNotifications = await listCurrentUserNotifications({ token: authToken })
      setNotifications(loadedNotifications.items)
      setHasLoadedNotifications(true)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить уведомления'
      setNotifications([])
      setHasLoadedNotifications(false)
      setError(detail)
    } finally {
      setIsNotificationsLoading(false)
    }
  */

  const loadNotificationSummary = useCallback(async () => {
    if (!isOwnProfile) {
      setNotificationCounts({ unread_count: 0, total_count: 0 })
      return
    }

    try {
      const response = await getCurrentUserNotificationSummary({ token: authToken })
      setNotificationCounts(response)
    } catch {
      // Keep the previous counters when summary refresh fails.
    }
  }, [authToken, isOwnProfile])

  const loadNotifications = useCallback(
    async (options?: { append?: boolean }) => {
      if (!isOwnProfile) {
        setNotifications([])
        setHasLoadedNotifications(false)
        setHasMoreNotificationsServer(false)
        setIsNotificationsLoading(false)
        setIsNotificationsLoadingMore(false)
        return
      }

      const append = options?.append ?? false
      const offset = append ? notifications.length : 0
      const order = notificationSortMode === 'oldest' ? 'asc' : 'desc'

      setError('')
      if (append) {
        setIsNotificationsLoadingMore(true)
      } else {
        setIsNotificationsLoading(true)
      }
      try {
        const response = await listCurrentUserNotifications({
          token: authToken,
          limit: PROFILE_NOTIFICATION_PAGE_SIZE,
          offset,
          order,
        })
        setNotifications((previous) => (append ? mergeNotificationsById(previous, response.items) : response.items))
        setHasLoadedNotifications(true)
        setHasMoreNotificationsServer(response.has_more)
        setNotificationCounts({
          unread_count: response.unread_count,
          total_count: response.total_count,
        })
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить уведомления'
        if (!append) {
          setNotifications([])
          setHasLoadedNotifications(false)
          setHasMoreNotificationsServer(false)
        }
        setError(detail)
      } finally {
        if (append) {
          setIsNotificationsLoadingMore(false)
        } else {
          setIsNotificationsLoading(false)
        }
      }
    },
    [authToken, isOwnProfile, notificationSortMode, notifications.length],
  )

  const markNotificationsRead = useCallback(async () => {
    if (!isOwnProfile || !hasLoadedNotifications || !notifications.some((item) => !item.is_read)) {
      return
    }
    try {
      const response = await markAllCurrentUserNotificationsRead({ token: authToken })
      setNotifications((previous) => previous.map((item) => ({ ...item, is_read: true })))
      dispatchNotificationsChanged(response.unread_count)
      setNotificationCounts(response)
    } catch {
      // Silent fail: the page content remains available even if read-state sync fails.
    }
  }, [authToken, hasLoadedNotifications, isOwnProfile, notifications])

  const handleDeleteNotification = useCallback(
    async (notificationId: number) => {
      if (notificationDeletingId !== null) {
        return
      }

      setNotificationDeletingId(notificationId)
      try {
        const response = await deleteCurrentUserNotification({
          token: authToken,
          notificationId,
        })
        setNotifications((previous) => previous.filter((item) => item.id !== notificationId))
        if (hoveredNotificationId === notificationId) {
          setHoveredNotificationId(null)
        }
        dispatchNotificationsChanged(response.unread_count)
        setNotificationCounts(response)
        setHasMoreNotificationsServer((response.total_count ?? 0) > Math.max(0, notifications.length - 1))
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить уведомление'
        setError(detail)
      } finally {
        setNotificationDeletingId(null)
      }
    },
    [authToken, hoveredNotificationId, notificationDeletingId, notifications.length],
  )

  const handleOpenNotification = useCallback(
    (notification: UserNotification) => {
      const actionUrl = notification.action_url?.trim()
      if (!actionUrl) {
        return
      }
      if (/^https?:\/\//i.test(actionUrl)) {
        window.location.assign(actionUrl)
        return
      }
      onNavigate(actionUrl)
    },
    [onNavigate],
  )

  const handleToggleNotificationPopover = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (notificationPopoverAnchorEl) {
        setNotificationPopoverAnchorEl(null)
        return
      }
      setNotificationPopoverAnchorEl(event.currentTarget)
      if (!hasLoadedNotifications && !isNotificationsLoading) {
        void loadNotifications()
      }
    },
    [hasLoadedNotifications, isNotificationsLoading, loadNotifications, notificationPopoverAnchorEl],
  )

  const handleCloseNotificationPopover = useCallback(() => {
    setNotificationPopoverAnchorEl(null)
  }, [])

  const handleOpenAllNotifications = useCallback(() => {
    setNotificationPopoverAnchorEl(null)
    setTab('notifications')
    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 0)
    if (!hasLoadedNotifications && !isNotificationsLoading) {
      void loadNotifications()
    }
  }, [hasLoadedNotifications, isNotificationsLoading, loadNotifications])

  const loadProfileView = useCallback(async () => {
    setIsProfileViewLoading(true)
    setError('')
    try {
      const response = await getProfileView({
        token: authToken,
        user_id: normalizedViewedUserId,
      })
      setProfileView(response)
      setWorldCardTemplateCount(Math.max(0, response.world_card_templates_count ?? 0))
      setPrivacyDraft({
        show_subscriptions: response.privacy.show_subscriptions,
        show_public_worlds: response.privacy.show_public_worlds,
        show_private_worlds: response.privacy.show_private_worlds,
        show_public_characters: response.privacy.show_public_characters ?? false,
        show_public_instruction_templates: response.privacy.show_public_instruction_templates ?? false,
      })
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить профиль'
      setError(detail)
      setProfileView(null)
    } finally {
      setIsProfileViewLoading(false)
    }
  }, [authToken, normalizedViewedUserId])

  useEffect(() => {
    setProfileView(null)
    setWorldCardTemplateCount(0)
    setOwnGames([])
    setFavoriteWorlds([])
    setHasLoadedFavoriteWorlds(false)
    setHasMoreOwnGamesServer(false)
    setHasMoreCharactersServer(false)
    setHasMoreTemplatesServer(false)
    setHasMoreFavoriteWorldsServer(false)
    setIsOwnGamesLoadingMore(false)
    setIsCharactersLoadingMore(false)
    setIsTemplatesLoadingMore(false)
    setIsFavoriteWorldsLoadingMore(false)
    setNotifications([])
    setNotificationCounts({ unread_count: 0, total_count: 0 })
    setHasLoadedNotifications(false)
    setHasMoreNotificationsServer(false)
    setIsNotificationsLoadingMore(false)
    setGalleryPreviewImage(null)
    setDeletingGalleryImageIds(new Set())
    notificationsLoadMoreTriggeredRef.current = 0
  }, [normalizedViewedUserId])

  useEffect(() => {
    void loadProfileContent()
  }, [loadProfileContent])

  useEffect(() => {
    void loadNotificationSummary()
  }, [loadNotificationSummary])

  useEffect(() => {
    void loadProfileView()
  }, [loadProfileView])

  useEffect(() => {
    if (tabs.length === 0) {
      return
    }
    if (tab === 'notifications') {
      return
    }
    if (!tabs.some((item) => item.id === tab)) {
      setTab(tabs[0].id)
    }
  }, [tab, tabs])

  useEffect(() => {
    if (!isOwnProfile && profileMainSection === 'publications') {
      setProfileMainSection('library')
    }
  }, [isOwnProfile, profileMainSection])

  useEffect(() => {
    if (tab === 'favorites' || tab === 'notifications' || tab === 'subscriptions') {
      setProfileMainSection('library')
    }
  }, [tab])

  useEffect(() => {
    setContentSortMenuAnchorEl(null)
  }, [profileMainSection, publicationSection, tab])

  useEffect(() => {
    setMobileProfileMenuAnchorEl(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'favorites' && tab !== 'notifications' && tab !== 'subscriptions') {
      lastContentTabRef.current = tab
    }
  }, [tab])

  useEffect(() => {
    if (!isOwnProfile || tab !== 'notifications' || hasLoadedNotifications || isNotificationsLoading) {
      return
    }
    void loadNotifications()
  }, [hasLoadedNotifications, isNotificationsLoading, isOwnProfile, loadNotifications, tab])

  useEffect(() => {
    if (!isOwnProfile) {
      return
    }
    setNotifications([])
    setHasLoadedNotifications(false)
    setHasMoreNotificationsServer(false)
    notificationsLoadMoreTriggeredRef.current = 0
  }, [isOwnProfile, notificationSortMode])

  useEffect(() => {
    if (loadMoreNotificationsSignal <= 0) {
      return
    }
    if (
      notificationsLoadMoreTriggeredRef.current === loadMoreNotificationsSignal ||
      !hasLoadedNotifications ||
      !hasMoreNotificationsServer ||
      isNotificationsLoading ||
      isNotificationsLoadingMore ||
      tab !== 'notifications'
    ) {
      return
    }
    notificationsLoadMoreTriggeredRef.current = loadMoreNotificationsSignal
    void loadNotifications({ append: true })
  }, [
    hasLoadedNotifications,
    hasMoreNotificationsServer,
    isNotificationsLoading,
    isNotificationsLoadingMore,
    loadMoreNotificationsSignal,
    loadNotifications,
    tab,
  ])

  const saveProfile = useCallback(async () => {
    if (isSavingProfile) {
      return
    }

    const nextName = nameDraft.trim()
    const nextDescription = descriptionDraft.replace(/\r\n/g, '\n').trim()

    if (!nextName) {
      setError('Ник не может быть пустым')
      return
    }
    if (nextName.length > PROFILE_NAME_MAX) {
      setError(`Максимальная длина ника: ${PROFILE_NAME_MAX}`)
      return
    }
    if (nextDescription.length > PROFILE_DESC_MAX) {
      setError(`Максимальная длина описания: ${PROFILE_DESC_MAX}`)
      return
    }

    const isNothingChanged = nextName === resolvedProfileName && nextDescription === resolvedProfileDescription
    if (isNothingChanged) {
      setIsEditing(false)
      setError('')
      return
    }

    setError('')
    setIsSavingProfile(true)
    try {
      const updatedUser = await updateCurrentUserProfile({
        token: authToken,
        display_name: nextName,
        profile_description: nextDescription,
      })
      onUserUpdate(updatedUser)
      setIsEditing(false)
      void loadProfileView()
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить профиль'
      setError(detail)
    } finally {
      setIsSavingProfile(false)
    }
  }, [
    authToken,
    descriptionDraft,
    isSavingProfile,
    loadProfileView,
    nameDraft,
    onUserUpdate,
    resolvedProfileDescription,
    resolvedProfileName,
  ])

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!isOwnProfile) {
      return
    }
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('Максимальный размер аватара: 2 МБ')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setAvatarCropSource(dataUrl)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось подготовить изображение'
      setAvatarError(detail)
    }
  }

  const saveCroppedAvatar = async (croppedDataUrl: string) => {
    if (!isOwnProfile || isAvatarSaving) {
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
      void loadProfileView()
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleCloseProfileDialog = useCallback(() => {
    setProfileDialogOpen(false)
    setLogoutOpen(false)
    setAvatarCropSource(null)
    setAvatarError('')
  }, [])

  const handleChooseAvatar = useCallback(() => {
    if (isAvatarSaving) {
      return
    }
    avatarInputRef.current?.click()
  }, [isAvatarSaving])

  const handleUpdateProfileName = useCallback(
    async (nextName: string) => {
      const updatedUser = await updateCurrentUserProfile({
        token: authToken,
        display_name: nextName,
      })
      onUserUpdate(updatedUser)
      void loadProfileView()
    },
    [authToken, loadProfileView, onUserUpdate],
  )

  const handleProfileDialogUserUpdate = useCallback(
    (nextUser: AuthUser) => {
      onUserUpdate(nextUser)
      setProfileView((previous) => {
        if (!previous?.is_self) {
          return previous
        }
        return {
          ...previous,
          user: {
            ...previous.user,
            display_name: nextUser.display_name?.trim() || previous.user.display_name,
            profile_description: nextUser.profile_description ?? '',
            profile_banner_id: normalizeProfileBannerId(nextUser.profile_banner_id),
            profile_banner_image_url: nextUser.profile_banner_image_url ?? null,
            avatar_url: nextUser.avatar_url,
            avatar_scale: nextUser.avatar_scale ?? 1,
          },
        }
      })
      void loadProfileView()
    },
    [loadProfileView, onUserUpdate],
  )

  const handleOpenTopUpDialog = useCallback(() => {
    setProfileDialogOpen(false)
    setLogoutOpen(false)
    setTopUpError('')
    onNavigate('/shop')
  }, [onNavigate])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (params.get('mobileAction') !== 'shop') {
      return
    }
    params.delete('mobileAction')
    const nextSearch = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`)
    handleOpenTopUpDialog()
  }, [handleOpenTopUpDialog])

  const handleCloseTopUpDialog = useCallback(() => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }, [])

  const handleConfirmLogout = useCallback(() => {
    setLogoutOpen(false)
    setProfileDialogOpen(false)
    setCharacterDialogOpen(false)
    setInstructionDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }, [onLogout])

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить тарифы пополнения'
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
          if (response.referral_bonus_granted) {
            void loadReferralSummary()
          }
          return
        }

        if (FINAL_PAYMENT_STATUSES.has(response.status)) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Failed to sync payment status'
        if (detail.includes('404')) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      }
    },
    [authToken, loadReferralSummary, onUserUpdate],
  )

  useEffect(() => {
    const pendingPaymentId = localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY)
    if (!pendingPaymentId) {
      return
    }
    void syncPendingPayment(pendingPaymentId)
  }, [syncPendingPayment])

  const handlePurchasePlan = useCallback(
    async (planId: string) => {
      setTopUpError('')
      setActivePlanPurchaseId(planId)
      try {
        const response = await createCoinTopUpPayment({
          token: authToken,
          plan_id: planId,
        })
        localStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, response.payment_id)
        window.location.assign(response.confirmation_url)
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось создать оплату'
        setTopUpError(detail)
        setActivePlanPurchaseId(null)
      }
    },
    [authToken],
  )

  const toggleFavorite = useCallback(
    async (world: StoryCommunityWorldSummary) => {
      if (favoriteLoadingById[world.id]) {
        return
      }

      setFavoriteLoadingById((previous) => ({ ...previous, [world.id]: true }))
      try {
        if (world.is_favorited_by_user) {
          await unfavoriteCommunityWorld({ token: authToken, worldId: world.id })
          setFavoriteWorlds((previous) => previous.filter((item) => item.id !== world.id))
          setHasLoadedFavoriteWorlds(true)
          return
        }

        const updatedWorld = await favoriteCommunityWorld({ token: authToken, worldId: world.id })
        setFavoriteWorlds((previous) => [updatedWorld, ...previous.filter((item) => item.id !== updatedWorld.id)])
        setHasLoadedFavoriteWorlds(true)
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось обновить список избранного'
        setError(detail)
      } finally {
        setFavoriteLoadingById((previous) => {
          const next = { ...previous }
          delete next[world.id]
          return next
        })
      }
    },
    [authToken, favoriteLoadingById],
  )

  const applyFollowState = useCallback((state: ProfileFollowState) => {
    setProfileView((previous) => {
      if (!previous) {
        return previous
      }
      return {
        ...previous,
        is_following: state.is_following,
        followers_count: Math.max(0, state.followers_count),
      }
    })
  }, [])

  const handleToggleFollow = useCallback(async () => {
    if (isOwnProfile || !profileView || isFollowSaving) {
      return
    }
    setError('')
    setIsFollowSaving(true)
    try {
      const nextState = profileView.is_following
        ? await unfollowUserProfile({
            token: authToken,
            user_id: profileView.user.id,
          })
        : await followUserProfile({
            token: authToken,
            user_id: profileView.user.id,
          })
      applyFollowState(nextState)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось обновить подписку'
      setError(detail)
    } finally {
      setIsFollowSaving(false)
    }
  }, [applyFollowState, authToken, isFollowSaving, isOwnProfile, profileView])

  const handleSavePrivacy = useCallback(async () => {
    if (!isOwnProfile || isSavingPrivacy) {
      return
    }
    setError('')
    setIsSavingPrivacy(true)
    try {
      const nextPrivacy = await updateCurrentUserProfilePrivacy({
        token: authToken,
        show_subscriptions: privacyDraft.show_subscriptions,
        show_public_worlds: privacyDraft.show_public_worlds,
        show_private_worlds: privacyDraft.show_private_worlds,
        show_public_characters: privacyDraft.show_public_characters,
        show_public_instruction_templates: privacyDraft.show_public_instruction_templates,
      })
      setProfileView((previous) => {
        if (!previous) {
          return previous
        }
        return {
          ...previous,
          privacy: nextPrivacy,
          can_view_subscriptions: true,
          can_view_public_worlds: true,
          can_view_public_characters: true,
          can_view_public_instruction_templates: true,
          can_view_private_worlds: true,
        }
      })
      setPrivacyDialogOpen(false)
      void loadProfileView()
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить настройки приватности'
      setError(detail)
    } finally {
      setIsSavingPrivacy(false)
    }
  }, [authToken, isOwnProfile, isSavingPrivacy, loadProfileView, privacyDraft])

  const handleOpenMobileProfileMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setMobileProfileMenuAnchorEl(event.currentTarget)
  }, [])

  const handleCloseMobileProfileMenu = useCallback(() => {
    setMobileProfileMenuAnchorEl(null)
  }, [])

  const handleOpenContentSortMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (activeContentSortOptions.length === 0) {
        return
      }
      setContentSortMenuAnchorEl(event.currentTarget)
    },
    [activeContentSortOptions.length],
  )

  const handleCloseContentSortMenu = useCallback(() => {
    setContentSortMenuAnchorEl(null)
  }, [])

  const handleSelectContentSortMode = useCallback(
    (nextValue: string) => {
      if (activeContentSortTab === 'notifications') {
        setNotificationSortMode(nextValue as NotificationSortMode)
      } else {
        setContentSortModeByTab((previous) => ({
          ...previous,
          [activeContentSortTab]: nextValue as ProfileContentSortMode,
        }))
      }
      setContentSortMenuAnchorEl(null)
    },
    [activeContentSortTab],
  )

  const handleMobilePrimaryTabChange = useCallback(
    (newMobileTab: 'content' | 'favorites' | 'notifications' | 'subscriptions') => {
      if (newMobileTab === 'favorites') {
        setTab('favorites')
      } else if (newMobileTab === 'notifications') {
        setTab('notifications')
      } else if (newMobileTab === 'subscriptions') {
        setTab('subscriptions')
      } else {
        const isLastValid = mobileContentTabs.some((t) => t.id === lastContentTabRef.current)
        const targetTab = isLastValid ? lastContentTabRef.current : mobileContentTabs[0]?.id
        if (targetTab) {
          setTab(targetTab)
        }
      }
    },
    [mobileContentTabs],
  )

  const openCharacterCreate = useCallback(() => {
    setCharacterDialogMode('create')
    setCharacterEditId(null)
    setCharacterDialogOpen(true)
  }, [])

  const openCharacterEdit = useCallback((characterId: number) => {
    setCharacterDialogMode('list')
    setCharacterEditId(characterId)
    setCharacterDialogOpen(true)
  }, [])

  const closeCharacterDialog = useCallback(() => {
    setCharacterDialogOpen(false)
    setCharacterDialogMode('list')
    setCharacterEditId(null)
    void loadCharactersOnly()
  }, [loadCharactersOnly])

  useEffect(() => {
    const handleOnboardingCommand = (event: Event) => {
      const detail = (event as CustomEvent<OnboardingGuideCommandDetail>).detail
      if (!detail || !isOwnProfile) {
        return
      }

      if (detail.type === 'profile:show-characters') {
        setTab('characters')
        return
      }

      if (detail.type === 'profile:open-character-create') {
        setTab('characters')
        openCharacterCreate()
        return
      }

      if (detail.type === 'profile:close-character-dialog') {
        closeCharacterDialog()
      }
    }

    window.addEventListener(ONBOARDING_GUIDE_COMMAND_EVENT, handleOnboardingCommand as EventListener)
    return () => {
      window.removeEventListener(ONBOARDING_GUIDE_COMMAND_EVENT, handleOnboardingCommand as EventListener)
    }
  }, [closeCharacterDialog, isOwnProfile, openCharacterCreate, setTab])

  useEffect(() => {
    if (!isOwnProfile) {
      return
    }
    const handleAiAssistantEntitiesChanged = (event: Event) => {
      const detail = (event as CustomEvent<AiAssistantChatResponse>).detail
      if (!detail) {
        return
      }
      const refs = [...(detail.createdEntities ?? []), ...(detail.updatedEntities ?? []), ...(detail.deletedEntities ?? [])]
      if (refs.some((ref) => ref.type === 'world' || ref.type === 'world_game')) {
        void loadProfileView()
      }
      if (refs.some((ref) => ref.type === 'profile_character')) {
        setTab('characters')
        void loadCharactersOnly()
      }
      if (refs.some((ref) => ref.type === 'instruction_template')) {
        setTab('instructions')
        void loadTemplatesOnly()
      }
      if (refs.some((ref) => ref.type === 'world_card_template')) {
        setTab('world_cards')
      }
    }

    window.addEventListener(AI_ASSISTANT_ENTITIES_CHANGED_EVENT, handleAiAssistantEntitiesChanged as EventListener)
    return () => {
      window.removeEventListener(AI_ASSISTANT_ENTITIES_CHANGED_EVENT, handleAiAssistantEntitiesChanged as EventListener)
    }
  }, [isOwnProfile, loadCharactersOnly, loadProfileView, loadTemplatesOnly])

  const handleCloseCharacterAvatarPreview = useCallback(() => {
    setCharacterAvatarPreview(null)
  }, [])

  const handleCloseGalleryPreview = useCallback(() => {
    setGalleryPreviewImage(null)
  }, [])

  const handleDeleteGalleryImage = useCallback(
    async (imageId: number, event?: ReactMouseEvent<HTMLElement>) => {
      if (event) {
        event.preventDefault()
        event.stopPropagation()
      }
      if (!isOwnProfile || deletingGalleryImageIds.has(imageId)) {
        return
      }

      setDeletingGalleryImageIds((previousIds) => new Set(previousIds).add(imageId))
      setError('')
      try {
        await deleteCurrentUserGalleryImage({
          token: authToken,
          galleryImageId: imageId,
        })
        setProfileView((currentView) =>
          currentView
            ? {
                ...currentView,
                gallery_images: currentView.gallery_images.filter((item) => item.id !== imageId),
              }
            : currentView,
        )
        setGalleryPreviewImage((currentImage) => (currentImage?.id === imageId ? null : currentImage))
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить картинку из галереи'
        setError(detail)
      } finally {
        setDeletingGalleryImageIds((previousIds) => {
          const nextIds = new Set(previousIds)
          nextIds.delete(imageId)
          return nextIds
        })
      }
    },
    [authToken, deletingGalleryImageIds, isOwnProfile],
  )

  const openInstructionCreate = useCallback(() => {
    setInstructionDialogMode('create')
    setInstructionEditId(null)
    setInstructionDialogOpen(true)
  }, [])

  const openInstructionEdit = useCallback((templateId: number) => {
    setInstructionDialogMode('list')
    setInstructionEditId(templateId)
    setInstructionDialogOpen(true)
  }, [])

  const closeInstructionDialog = useCallback(() => {
    setInstructionDialogOpen(false)
    setInstructionDialogMode('list')
    setInstructionEditId(null)
    void loadTemplatesOnly()
  }, [loadTemplatesOnly])

  const handleOpenContentCardMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, type: 'character' | 'instruction', itemId: number) => {
      event.preventDefault()
      event.stopPropagation()
      setContentCardMenuAnchorEl(event.currentTarget)
      setContentCardMenuType(type)
      setContentCardMenuItemId(itemId)
    },
    [],
  )

  const handleCloseContentCardMenu = useCallback(() => {
    setContentCardMenuAnchorEl(null)
    setContentCardMenuType(null)
    setContentCardMenuItemId(null)
  }, [])

  const handleOpenGameCardMenu = useCallback((event: ReactMouseEvent<HTMLElement>, gameId: number) => {
    event.preventDefault()
    event.stopPropagation()
    setGameCardMenuAnchorEl(event.currentTarget)
    setGameCardMenuGameId(gameId)
  }, [])

  const handleCloseGameCardMenu = useCallback(() => {
    if (gameCardMenuBusyAction !== null) {
      return
    }
    setGameCardMenuAnchorEl(null)
    setGameCardMenuGameId(null)
  }, [gameCardMenuBusyAction])

  const handleEditGameCardFromMenu = useCallback(() => {
    if (!selectedGameCardMenuItem || gameCardMenuBusyAction !== null) {
      return
    }
    const targetGameId = selectedGameCardMenuItem.id
    setGameCardMenuAnchorEl(null)
    setGameCardMenuGameId(null)
    onNavigate(`/worlds/${targetGameId}/edit?source=profile`)
  }, [gameCardMenuBusyAction, onNavigate, selectedGameCardMenuItem])

  const handleOpenCloneGameCardDialogFromMenu = useCallback(() => {
    if (!selectedGameCardMenuItem || gameCardMenuBusyAction !== null) {
      return
    }
    setCloneDialogSourceGame(selectedGameCardMenuItem)
    setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
    setGameCardMenuAnchorEl(null)
    setGameCardMenuGameId(null)
  }, [gameCardMenuBusyAction, selectedGameCardMenuItem])

  const handleCloseCloneGameCardDialog = useCallback(() => {
    if (gameCardMenuBusyAction === 'clone') {
      return
    }
    setCloneDialogSourceGame(null)
    setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
  }, [gameCardMenuBusyAction])

  const handleToggleCloneSection = useCallback((key: CloneSectionKey) => {
    setCloneSelection((previous) => ({
      ...previous,
      [key]: !previous[key],
    }))
  }, [])

  const handleSubmitCloneGameCard = useCallback(async () => {
    if (!cloneDialogSourceGame || gameCardMenuBusyAction !== null) {
      return
    }
    setError('')
    setGameCardMenuBusyAction('clone')
    try {
      const clonedGame = await cloneStoryGame({
        token: authToken,
        gameId: cloneDialogSourceGame.id,
        copy_instructions: cloneSelection.instructions,
        copy_plot: cloneSelection.plot,
        copy_world: cloneSelection.world,
        copy_main_hero: cloneSelection.main_hero,
        copy_history: cloneSelection.history,
      })
      setOwnGames((previousGames) => [clonedGame, ...previousGames.filter((game) => game.id !== clonedGame.id)])
      setCloneDialogSourceGame(null)
      setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось клонировать мир'
      setError(detail)
    } finally {
      setGameCardMenuBusyAction(null)
    }
  }, [authToken, cloneDialogSourceGame, cloneSelection, gameCardMenuBusyAction])

  const handleDeleteGameCardFromMenu = useCallback(async () => {
    if (!selectedGameCardMenuItem || gameCardMenuBusyAction !== null) {
      return
    }
    const confirmed = typeof window === 'undefined' || window.confirm('Удалить выбранный мир? Это действие нельзя отменить.')
    if (!confirmed) {
      setGameCardMenuAnchorEl(null)
      setGameCardMenuGameId(null)
      return
    }
    const targetGameId = selectedGameCardMenuItem.id
    setError('')
    setGameCardMenuBusyAction('delete')
    try {
      await deleteStoryGame({
        token: authToken,
        gameId: targetGameId,
      })
      setOwnGames((previousGames) => previousGames.filter((game) => game.id !== targetGameId))
      setGameCardMenuAnchorEl(null)
      setGameCardMenuGameId(null)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить мир'
      setError(detail)
    } finally {
      setGameCardMenuBusyAction(null)
    }
  }, [authToken, gameCardMenuBusyAction, selectedGameCardMenuItem])

  const handleEditContentCardFromMenu = useCallback(() => {
    if (contentCardMenuType === 'character' && selectedContentCharacterMenuItem) {
      openCharacterEdit(selectedContentCharacterMenuItem.id)
    }
    if (contentCardMenuType === 'instruction' && selectedContentInstructionMenuItem) {
      openInstructionEdit(selectedContentInstructionMenuItem.id)
    }
    handleCloseContentCardMenu()
  }, [
    contentCardMenuType,
    handleCloseContentCardMenu,
    openCharacterEdit,
    openInstructionEdit,
    selectedContentCharacterMenuItem,
    selectedContentInstructionMenuItem,
  ])

  const handleDeleteContentCardFromMenu = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('Удалить выбранную карточку?')) {
      handleCloseContentCardMenu()
      return
    }
    if (contentCardMenuType === 'character' && selectedContentCharacterMenuItem) {
      try {
        setError('')
        await deleteStoryCharacter({
          token: authToken,
          characterId: selectedContentCharacterMenuItem.id,
        })
        setCharacters((previous) => previous.filter((item) => item.id !== selectedContentCharacterMenuItem.id))
        if (characterEditId === selectedContentCharacterMenuItem.id) {
          setCharacterDialogOpen(false)
          setCharacterDialogMode('list')
          setCharacterEditId(null)
        }
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить персонажа'
        setError(detail)
      } finally {
        handleCloseContentCardMenu()
      }
      return
    }

    if (contentCardMenuType === 'instruction' && selectedContentInstructionMenuItem) {
      try {
        setError('')
        await deleteStoryInstructionTemplate({
          token: authToken,
          templateId: selectedContentInstructionMenuItem.id,
        })
        setTemplates((previous) => previous.filter((item) => item.id !== selectedContentInstructionMenuItem.id))
        if (instructionEditId === selectedContentInstructionMenuItem.id) {
          setInstructionDialogOpen(false)
          setInstructionDialogMode('list')
          setInstructionEditId(null)
        }
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить инструкцию'
        setError(detail)
      } finally {
        handleCloseContentCardMenu()
      }
      return
    }

    handleCloseContentCardMenu()
  }, [
    authToken,
    characterEditId,
    contentCardMenuType,
    handleCloseContentCardMenu,
    instructionEditId,
    selectedContentCharacterMenuItem,
    selectedContentInstructionMenuItem,
  ])

  const renderCreatePlaceholderCard = (options: { onClick: () => void; ariaLabel: string; tourId?: string }) => (
    <ButtonBase
      onClick={options.onClick}
      aria-label={options.ariaLabel}
      data-tour-id={options.tourId}
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        minHeight: CARD_MIN_HEIGHT,
        p: 1.1,
        borderRadius: '12px',
        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
        '&:hover': {
          backgroundColor: 'transparent',
          borderColor: 'color-mix(in srgb, var(--morius-accent) 66%, transparent)',
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: 'var(--morius-border-width) solid rgba(214, 226, 241, 0.62)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--morius-text-primary)',
          fontSize: '1.6rem',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        +
      </Box>
    </ButtonBase>
  )

  const renderGames = () => {
    if (!isOwnProfile) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
    }

    if (isOwnGamesLoading && ownGames.length === 0) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Загружаем игры...</Typography>
    }

    if (!filteredOwnGames.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет игр.</Typography>
    }

    return (
      <>
        <Box
          sx={{
            display: { xs: 'none', sm: 'grid' },
            gap: 1,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
          }}
        >
          {visibleOwnGames.map((game) => (
            <Box
              key={game.id}
              sx={{
                position: 'relative',
                minWidth: 0,
                '&:hover .profile-game-card-menu-button, &:focus-within .profile-game-card-menu-button': {
                  opacity: 1,
                  pointerEvents: 'auto',
                  transform: 'translateY(0)',
                },
              }}
            >
              <CommunityWorldCard
                world={toPublicationWorld(game, {
                  authorId: resolvedProfileUser.id,
                  authorName: resolvedProfileName,
                  authorAvatarUrl: resolvedProfileUser.avatar_url,
                  authorAvatarFrameId: resolvedProfileUser.avatar_frame_id,
                  authorAvatarFrameImageUrl: resolvedProfileUser.avatar_frame_image_url,
                })}
                onClick={() => onNavigate(`/home/${game.id}`)}
              />
              <IconButton
                className="profile-game-card-menu-button"
                aria-label="Действия с миром"
                onClick={(event) => handleOpenGameCardMenu(event, game.id)}
                sx={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  zIndex: 4,
                  width: 34,
                  height: 34,
                  borderRadius: '10px',
                  border: 'var(--morius-border-width) solid rgba(214, 226, 244, 0.18)',
                  backgroundColor: 'rgba(5, 8, 13, 0.66)',
                  color: 'rgba(236, 243, 252, 0.96)',
                  opacity: { xs: 1, md: 0 },
                  pointerEvents: { xs: 'auto', md: 'none' },
                  transform: { xs: 'translateY(0)', md: 'translateY(-4px)' },
                  transition: 'opacity 180ms ease, transform 180ms ease, background-color 180ms ease',
                  backdropFilter: 'blur(10px)',
                  '&:hover': {
                    backgroundColor: 'rgba(17, 27, 40, 0.82)',
                  },
                }}
              >
                <Box sx={{ fontSize: '1.15rem', lineHeight: 1 }}>{String.fromCharCode(8943)}</Box>
              </IconButton>
            </Box>
          ))}
        </Box>
        <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
          {visibleOwnGames.map((game) => (
            <MobileCardItem
              key={`profile-game-mobile-${game.id}`}
              imageUrl={resolveApiResourceUrl(game.cover_image_url)}
              fallbackBackground={buildWorldFallbackArtwork(game.id) as Record<string, unknown>}
              title={(game.title || '').trim() || `Игра #${game.id}`}
              description={resolveProfileGameCardDescription(game)}
              authorName={resolvedProfileName}
              authorAvatarUrl={resolvedProfileUser.avatar_url}
              authorAvatarFrameId={resolvedProfileUser.avatar_frame_id}
              authorAvatarFrameImageUrl={resolvedProfileUser.avatar_frame_image_url}
              stat1={formatProfileGameTurnCount(game.turn_count)}
              stat2={formatProfileGameCardDate(game.last_activity_at || game.updated_at || game.created_at)}
              onMenuClick={(event) => handleOpenGameCardMenu(event, game.id)}
              onClick={() => onNavigate(`/home/${game.id}`)}
            />
          ))}
        </Stack>
        {isOwnGamesLoadingMore ? (
          <Stack alignItems="center" sx={{ py: 0.7 }}>
            <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
          </Stack>
        ) : null}
        {hasMoreOwnGames ? <Box ref={loadMoreOwnGamesRef} sx={{ height: 1, width: '100%' }} /> : null}
      </>
    )
  }

  const renderLibraryTabIcon = (tabId: TabId) => {
    if (tabId === 'games') {
      return (
        <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
          <path fill="currentColor" d="M7.2 9.2h2.1v1.9h1.9v2.1H9.3v1.9H7.2v-1.9H5.3v-2.1h1.9V9.2Zm8.15 1.35a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3Zm2.6 3.1a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3ZM7.4 6h9.2A5.4 5.4 0 0 1 22 11.4v1.2A5.4 5.4 0 0 1 16.6 18h-.9l-1.7-2H10l-1.7 2h-.9A5.4 5.4 0 0 1 2 12.6v-1.2A5.4 5.4 0 0 1 7.4 6Z" />
        </SvgIcon>
      )
    }
    if (tabId === 'publications' || tabId === 'world_cards') {
      return (
        <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
          <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3.05a15.8 15.8 0 0 0-1.2-5.02A8.03 8.03 0 0 1 18.9 11ZM12 4.05c.77 1.1 1.7 3.02 1.9 6.95h-3.8c.2-3.93 1.13-5.85 1.9-6.95ZM4.1 13h3.05c.16 2 .6 3.73 1.2 5.02A8.03 8.03 0 0 1 4.1 13Zm3.05-2H4.1a8.03 8.03 0 0 1 4.25-5.02A15.8 15.8 0 0 0 7.15 11ZM12 19.95c-.77-1.1-1.7-3.02-1.9-6.95h3.8c-.2 3.93-1.13 5.85-1.9 6.95Zm3.65-1.93c.6-1.29 1.04-3.02 1.2-5.02h3.05a8.03 8.03 0 0 1-4.25 5.02Z" />
        </SvgIcon>
      )
    }
    if (tabId === 'characters') {
      return (
        <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
          <path fill="currentColor" d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Zm0 2c-4.45 0-8 2.2-8 4.9V21h16v-2.1c0-2.7-3.55-4.9-8-4.9Z" />
        </SvgIcon>
      )
    }
    if (tabId === 'gallery') {
      return (
        <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
          <path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 13.2 4.2-4.2 2.6 2.6 3.8-4.8L19 15.1V6H5v11.2ZM8.5 10a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" />
        </SvgIcon>
      )
    }
    return (
      <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
        <path fill="currentColor" d="M6 3h11a2 2 0 0 1 2 2v15.5c0 .55-.45 1-1 1H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm1 14.5h10V5H6v10.67c.31-.11.65-.17 1-.17Zm0 2H17v-1H7a1 1 0 1 0 0 2ZM8 7h7v2H8V7Zm0 4h7v2H8v-2Z" />
      </SvgIcon>
    )
  }

  const renderCharacters = () => {
    return (
      <Stack data-tour-id="profile-characters-section" spacing={1} sx={{ width: '100%', minWidth: 0, scrollMarginTop: '120px' }}>
        <Typography sx={{ fontSize: { xs: '1.03rem', md: '1.14rem' }, fontWeight: 800 }}>Мои персонажи</Typography>

        {!filteredCharacters.length ? (
          <>
            {renderCreatePlaceholderCard({ onClick: openCharacterCreate, ariaLabel: 'Create character', tourId: 'profile-characters-create-card' })}
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет персонажей.</Typography>
          </>
        ) : (
          <>
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
                width: '100%',
                minWidth: 0,
              }}
            >
              {renderCreatePlaceholderCard({ onClick: openCharacterCreate, ariaLabel: 'Create character', tourId: 'profile-characters-create-card' })}
              {visibleCharacters.map((item) => (
                <CharacterShowcaseCard
                  key={item.id}
                  title={item.name}
                  description={item.description || 'Описание не заполнено.'}
                  imageUrl={item.avatar_url}
                  imageScale={clampAvatarScale(item.avatar_scale)}
                  eyebrow={item.triggers.length ? `Триггеры: ${item.triggers.join(', ')}` : item.note || 'Личный персонаж'}
                  footerHint="Нажмите для редактирования"
                  metaPrimary={item.visibility === 'public' ? 'Публичный' : 'Приватный'}
                  metaSecondary={item.community_rating_count > 0 ? `${item.community_rating_avg.toFixed(1)} ★` : null}
                  actionSlot={
                    <IconButton
                      onClick={(event) => handleOpenContentCardMenu(event, 'character', item.id)}
                      aria-label="Open character actions"
                      sx={{
                        width: 28,
                        height: 28,
                        color: 'rgba(238, 244, 251, 0.9)',
                        flexShrink: 0,
                        backgroundColor: 'rgba(8, 12, 18, 0.42) !important',
                        border: 'var(--morius-border-width) solid rgba(225, 233, 243, 0.16)',
                        '&:hover': { backgroundColor: 'rgba(10, 16, 24, 0.62) !important' },
                        '&:active': { backgroundColor: 'rgba(10, 16, 24, 0.72) !important' },
                        '&.Mui-focusVisible': { backgroundColor: 'rgba(10, 16, 24, 0.72) !important' },
                      }}
                    >
                      <Box sx={{ fontSize: '0.96rem', lineHeight: 1 }}>...</Box>
                    </IconButton>
                  }
                  onClick={() => openCharacterEdit(item.id)}
                />
              ))}
            </Box>
            {isCharactersLoadingMore ? (
              <Stack alignItems="center" sx={{ py: 0.7 }}>
                <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
              </Stack>
            ) : null}
            {hasMoreCharacters ? <Box ref={loadMoreCharactersRef} sx={{ height: 1, width: '100%' }} /> : null}
          </>
        )}
      </Stack>
    )
  }

  const renderInstructions = () => {
    return (
      <Stack spacing={1} sx={{ width: '100%', minWidth: 0 }}>
        <Typography sx={{ fontSize: { xs: '1.03rem', md: '1.14rem' }, fontWeight: 800 }}>Мои инструкции</Typography>

        {!filteredTemplates.length ? (
          <>
            {renderCreatePlaceholderCard({ onClick: openInstructionCreate, ariaLabel: 'Create instruction' })}
          <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет инструкций.</Typography>
          </>
        ) : (
          <>
            <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
              width: '100%',
              minWidth: 0,
            }}
          >
            {renderCreatePlaceholderCard({ onClick: openInstructionCreate, ariaLabel: 'Create instruction' })}
            {visibleTemplates.map((item) => (
              <ButtonBase
                key={item.id}
                onClick={() => openInstructionEdit(item.id)}
                sx={{
                  width: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  minHeight: CARD_MIN_HEIGHT,
                  p: 1.1,
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  overflow: 'hidden',
                  transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                  '&:hover': {
                    backgroundColor: 'transparent',
                    borderColor: 'color-mix(in srgb, var(--morius-accent) 48%, transparent)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Stack spacing={0.7} sx={{ width: '100%', height: '100%' }}>
                  <Stack direction="row" spacing={0.65} alignItems="flex-start" sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        overflow: 'visible',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {item.title}
                    </Typography>
                    <IconButton
                      onClick={(event) => handleOpenContentCardMenu(event, 'instruction', item.id)}
                      aria-label="Open instruction actions"
                      sx={{
                        width: 26,
                        height: 26,
                        color: 'rgba(208, 219, 235, 0.84)',
                        flexShrink: 0,
                        backgroundColor: 'transparent !important',
                        border: 'none',
                        '&:hover': { backgroundColor: 'transparent !important' },
                        '&:active': { backgroundColor: 'transparent !important' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                      }}
                    >
                      <Box sx={{ fontSize: '0.96rem', lineHeight: 1 }}>...</Box>
                    </IconButton>
                  </Stack>
                  <Typography
                    sx={{
                      color: 'var(--morius-text-secondary)',
                      fontSize: '0.84rem',
                      lineHeight: 1.36,
                      display: '-webkit-box',
                      WebkitLineClamp: 6,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      flex: 1,
                    }}
                  >
                    {item.content}
                  </Typography>
                  <Typography sx={{ color: 'rgba(182, 200, 222, 0.8)', fontSize: '0.74rem', fontWeight: 700 }}>
                    Нажмите для редактирования
                  </Typography>
                </Stack>
              </ButtonBase>
            ))}
            </Box>
            {isTemplatesLoadingMore ? (
              <Stack alignItems="center" sx={{ py: 0.7 }}>
                <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
              </Stack>
            ) : null}
            {hasMoreTemplates ? <Box ref={loadMoreTemplatesRef} sx={{ height: 1, width: '100%' }} /> : null}
          </>
        )}
      </Stack>
    )
  }

  const renderFavorites = () => {
    if (isFavoriteWorldsLoading && favoriteWorlds.length === 0) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Загружаем любимые миры...</Typography>
    }

    if (!filteredFavoriteWorlds.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет любимых миров.</Typography>
    }

    return (
      <>
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
          }}
        >
          {visibleFavoriteWorlds.map((item) => (
            <CommunityWorldCard
              key={item.id}
              world={item}
              onClick={() => onNavigate('/games/all')}
              onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
              showFavoriteButton
              isFavoriteSaving={Boolean(favoriteLoadingById[item.id])}
              onToggleFavorite={(world) => void toggleFavorite(world)}
            />
          ))}
        </Box>
        {isFavoriteWorldsLoadingMore ? (
          <Stack alignItems="center" sx={{ py: 0.7 }}>
            <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
          </Stack>
        ) : null}
        {hasMoreFavoriteWorlds ? <Box ref={loadMoreFavoriteWorldsRef} sx={{ height: 1, width: '100%' }} /> : null}
      </>
    )
  }

  const renderNotifications = () => {
    if (!isOwnProfile) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
    }

    if (isNotificationsLoading && notifications.length === 0) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Загружаем уведомления...</Typography>
    }

    if (!filteredNotifications.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет уведомлений.</Typography>
    }

    return (
      <Stack spacing={1}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={0.8}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
        >
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.85rem' }}>
            Всего уведомлений: {notificationCounts.total_count.toLocaleString('ru-RU')}
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
            Сортировка: {activeContentSortLabel}
          </Typography>
        </Stack>

        <Stack spacing={0.9}>
          {visibleNotifications.map((notification) => {
            const actorLabel = notification.actor_display_name?.trim() || 'MoRius'
            const isDeleting = notificationDeletingId === notification.id
            return (
              <Box
                key={notification.id}
                role={notification.action_url ? 'button' : undefined}
                tabIndex={notification.action_url ? 0 : -1}
                onMouseEnter={() => setHoveredNotificationId(notification.id)}
                onMouseLeave={() => setHoveredNotificationId(null)}
                onClick={() => handleOpenNotification(notification)}
                onKeyDown={(event) => {
                  if (!notification.action_url) {
                    return
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleOpenNotification(notification)
                  }
                }}
                sx={{
                  position: 'relative',
                  p: 1.05,
                  pr: 1.05,
                  pb: { xs: 1.6, md: 1.8 },
                  borderRadius: '14px',
                  border: notification.is_read
                    ? 'var(--morius-border-width) solid var(--morius-card-border)'
                    : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, transparent)',
                  backgroundColor: notification.is_read
                    ? 'var(--morius-elevated-bg)'
                    : 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg))',
                  cursor: notification.action_url ? 'pointer' : 'default',
                  transition: 'border-color 180ms ease, background-color 180ms ease, transform 180ms ease',
                  '&:hover': notification.action_url
                    ? {
                        transform: 'translateY(-1px)',
                        borderColor: 'color-mix(in srgb, var(--morius-accent) 58%, transparent)',
                      }
                    : undefined,
                }}
              >
                <IconButton
                  disabled={isDeleting}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleDeleteNotification(notification.id)
                  }}
                  sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    width: 30,
                    height: 30,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
                    backgroundColor: 'var(--morius-card-bg)',
                    color: 'var(--morius-text-secondary)',
                    opacity: { xs: 1, md: hoveredNotificationId === notification.id ? 1 : 0 },
                    pointerEvents: { xs: 'auto', md: hoveredNotificationId === notification.id ? 'auto' : 'none' },
                    transition: 'opacity 160ms ease',
                    '&:hover': {
                      backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, black 12%)',
                    },
                  }}
                >
                  {isDeleting ? (
                    <Typography sx={{ fontSize: '0.74rem', lineHeight: 1 }}>...</Typography>
                  ) : (
                    <SvgIcon sx={{ width: 17, height: 17 }}>
                      <path
                        fill="currentColor"
                        d="M6 7h2v10H6V7Zm5 0h2v10h-2V7ZM4 4h11v2H4V4Zm2-2h7l1 1h3v2H3V3h3l1-1Zm-1 4h9l-.7 12.1c-.05.85-.75 1.5-1.6 1.5H7.3c-.85 0-1.55-.65-1.6-1.5L5 6Z"
                      />
                    </SvgIcon>
                  )}
                </IconButton>

                <Stack direction="row" spacing={0.9} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      border: 'var(--morius-border-width) solid rgba(201, 217, 235, 0.24)',
                      backgroundColor: 'var(--morius-card-bg)',
                      flexShrink: 0,
                    }}
                  >
                    <ProgressiveAvatar
                      src={notification.actor_avatar_url}
                      alt={actorLabel}
                      fallbackLabel={actorLabel}
                      size={42}
                      priority={false}
                      scale={1}
                      sx={{
                        width: '100%',
                        height: '100%',
                        color: 'var(--morius-text-primary)',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                      }}
                    />
                  </Box>

                  <Stack spacing={0.36} sx={{ minWidth: 0, flex: 1 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={{ xs: 0.2, sm: 0.75 }}
                      alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
                      justifyContent="space-between"
                    >
                      <Typography sx={{ fontSize: '0.96rem', fontWeight: 800, minWidth: 0, flex: 1, pr: 1.2 }}>
                        {notification.title || 'Уведомление'}
                      </Typography>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.76rem',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          textAlign: 'right',
                          ml: { xs: 0, sm: 1.2 },
                        }}
                      >
                        {formatNotificationDate(notification.created_at)}
                      </Typography>
                    </Stack>

                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', fontWeight: 700 }}>
                      {actorLabel}
                    </Typography>

                    <Typography
                      sx={{
                        color: 'var(--morius-text-primary)',
                        fontSize: '0.88rem',
                        lineHeight: 1.55,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {notification.body || 'У вас новое уведомление.'}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
            )
          })}
        </Stack>

        {hasMoreNotificationsServer ? <Box ref={loadMoreNotificationsRef} sx={{ height: 1, width: '100%' }} /> : null}
        {isNotificationsLoadingMore ? (
          <Stack alignItems="center" sx={{ py: 0.4 }}>
            <CircularProgress size={20} />
          </Stack>
        ) : null}
      </Stack>
    )
  }

  const renderSubscriptions = () => {
    if (!profileView) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Не удалось загрузить список подписок.</Typography>
    }
    if (!canViewSubscriptions) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл список подписок.</Typography>
    }
    if (!filteredSubscriptions.length) {
      return (
        <Typography sx={{ color: 'var(--morius-text-secondary)' }}>
          {isOwnProfile ? 'Вы пока ни на кого не подписаны.' : 'У пользователя пока нет подписок.'}
        </Typography>
      )
    }

    return (
      <>
        <Box
          sx={{
            display: 'grid',
            gap: 0.9,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {visibleSubscriptionsList.map((subscription) => (
            <Box
              key={subscription.id}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(`/profile/${subscription.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onNavigate(`/profile/${subscription.id}`)
                }
              }}
              sx={{
                p: 0.9,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 0.7,
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: 'transparent',
                  borderColor: 'color-mix(in srgb, var(--morius-accent) 48%, transparent)',
                },
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  display: 'grid',
                  placeItems: 'center',
                  border: 'var(--morius-border-width) solid rgba(201, 217, 235, 0.24)',
                  backgroundColor: 'var(--morius-card-bg)',
                  color: 'var(--morius-text-primary)',
                  fontWeight: 700,
                  fontSize: '0.92rem',
                  flexShrink: 0,
                }}
              >
                <ProgressiveAvatar
                  src={subscription.avatar_url}
                  alt={subscription.display_name}
                  fallbackLabel={subscription.display_name}
                  size={40}
                  priority
                  scale={clampAvatarScale(subscription.avatar_scale)}
                  frameId={subscription.avatar_frame_id}
                  frameImageUrl={subscription.avatar_frame_image_url}
                  sx={{
                    width: '100%',
                    height: '100%',
                    color: 'var(--morius-text-primary)',
                    fontWeight: 700,
                    fontSize: '0.92rem',
                  }}
                />
              </Box>
              <Typography
                sx={{
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subscription.display_name}
              </Typography>
            </Box>
          ))}
        </Box>
        {hasMoreSubscriptions ? <Box ref={loadMoreSubscriptionsRef} sx={{ height: 1, width: '100%' }} /> : null}
      </>
    )
  }

  const renderGallery = () => {
    if (!isOwnProfile) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Галерея доступна только владельцу профиля.</Typography>
    }
    if (!profileView) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Не удалось загрузить галерею.</Typography>
    }
    if (!filteredGalleryImages.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>В галерее пока нет картинок.</Typography>
    }

    return (
      <>
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 0.75, sm: 1 },
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
              xl: 'repeat(5, minmax(0, 1fr))',
            },
            width: '100%',
            minWidth: 0,
          }}
        >
          {visibleGalleryImages.map((item) => {
            const rawImageUrl = (item.image_data_url ?? item.image_url ?? '').trim()
            const imageUrl = resolveApiResourceUrl(rawImageUrl) ?? rawImageUrl
            const isDeleting = deletingGalleryImageIds.has(item.id)

            return (
              <ButtonBase
                key={item.id}
                onClick={() => setGalleryPreviewImage(item)}
                sx={{
                  position: 'relative',
                  display: 'block',
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: { xs: '10px', md: '12px' },
                  overflow: 'hidden',
                  border: 'var(--morius-border-width) solid rgba(220, 232, 246, 0.12)',
                  backgroundColor: 'rgba(18, 24, 32, 0.7)',
                  boxShadow: '0 16px 38px rgba(0, 0, 0, 0.22)',
                  '&:hover .profile-gallery-delete-button, &:focus-within .profile-gallery-delete-button': {
                    opacity: 1,
                    pointerEvents: 'auto',
                    transform: 'translateY(0)',
                  },
                  '&:hover img': {
                    transform: 'scale(1.025)',
                  },
                }}
              >
                <ProgressiveImage
                  src={imageUrl}
                  alt="Gallery image"
                  loading="lazy"
                  objectFit="cover"
                  loaderSize={24}
                  containerSx={{
                    width: '100%',
                    height: '100%',
                    minHeight: 0,
                    borderRadius: 0,
                    backgroundColor: 'rgba(12, 17, 24, 0.72)',
                  }}
                  imgSx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transition: 'transform 220ms ease',
                  }}
                />
                <IconButton
                  className="profile-gallery-delete-button"
                  aria-label="Удалить из галереи"
                  onClick={(event) => void handleDeleteGalleryImage(item.id, event)}
                  disabled={isDeleting}
                  sx={{
                    position: 'absolute',
                    top: { xs: 7, md: 8 },
                    right: { xs: 7, md: 8 },
                    zIndex: 2,
                    width: { xs: 32, md: 34 },
                    height: { xs: 32, md: 34 },
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid rgba(235, 242, 251, 0.16)',
                    backgroundColor: 'rgba(8, 12, 18, 0.76)',
                    color: 'rgba(248, 176, 176, 0.96)',
                    opacity: { xs: 1, md: 0 },
                    pointerEvents: { xs: 'auto', md: 'none' },
                    transform: { xs: 'translateY(0)', md: 'translateY(-4px)' },
                    transition: 'opacity 180ms ease, transform 180ms ease, background-color 180ms ease',
                    backdropFilter: 'blur(10px)',
                    '&:hover': {
                      backgroundColor: 'rgba(55, 20, 26, 0.86)',
                    },
                    '&.Mui-disabled': {
                      color: 'rgba(248, 176, 176, 0.54)',
                      backgroundColor: 'rgba(8, 12, 18, 0.62)',
                    },
                  }}
                >
                  {isDeleting ? (
                    <CircularProgress size={16} sx={{ color: 'currentColor' }} />
                  ) : (
                    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
                      <path fill="currentColor" d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v9H9v-9Zm4 0h2v9h-2v-9Zm-5 11a2 2 0 0 1-2-2V9h12v10a2 2 0 0 1-2 2H8Z" />
                    </SvgIcon>
                  )}
                </IconButton>
              </ButtonBase>
            )
          })}
        </Box>
        {hasMoreGalleryImages ? <Box ref={loadMoreGalleryImagesRef} sx={{ height: 1, width: '100%' }} /> : null}
      </>
    )
  }

  const renderPublications = () => {
    const filteredPublicationWorlds = filteredVisiblePublicationWorlds

    if (!filteredPublicationWorlds.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет опубликованных миров.</Typography>
    }

    return (
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {visiblePublishedWorldCards.map((item) => (
          <CommunityWorldCard key={item.id} world={item} onClick={() => onNavigate(`/home/${item.id}`)} />
        ))}
      </Box>
    )
  }
  void renderPublications

  const renderProfileWorlds = () => {
    if (!profileView) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Не удалось загрузить публикации.</Typography>
    }

    return (
      <Stack spacing={1.4}>
        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>Опубликованные миры</Typography>
          {!canViewPublicWorlds ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл опубликованные миры.</Typography>
          ) : filteredVisiblePublicationWorlds.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет опубликованных миров.</Typography>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                {visiblePublishedWorldCards.map((item) => (
                  <CommunityWorldCard
                    key={item.id}
                    world={item}
                    onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                    onClick={() => onNavigate(item.author_id === user.id ? `/home/${item.id}` : `/games/all?worldId=${item.id}`)}
                  />
                ))}
              </Box>
              {hasMorePublishedWorldCards ? (
                <Box ref={loadMorePublishedWorldCardsRef} sx={{ height: 1, width: '100%' }} />
              ) : null}
            </>
          )}
        </Stack>

        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>Опубликованные персонажи</Typography>
          {!canViewPublicCharacters ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл опубликованных персонажей.</Typography>
          ) : filteredVisiblePublicationCharacters.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет опубликованных персонажей.</Typography>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
                  width: '100%',
                  minWidth: 0,
                }}
              >
                {visiblePublishedCharacterCards.map((item) => (
                  <CharacterShowcaseCard
                    key={item.id}
                    title={item.name}
                    description={item.description || 'Описание не заполнено.'}
                    imageUrl={item.avatar_url}
                    imageScale={clampAvatarScale(item.avatar_scale)}
                    eyebrow={item.triggers.length ? `Триггеры: ${item.triggers.join(', ')}` : item.note || 'Опубликованный персонаж'}
                    footerHint={`Автор: ${item.author_name}`}
                    metaPrimary="Публикация"
                    metaSecondary={item.community_rating_count > 0 ? `${item.community_rating_avg.toFixed(1)} ★` : null}
                    onClick={() => onNavigate('/games/all?tab=characters')}
                  />
                ))}
              </Box>
              {hasMorePublishedCharacterCards ? (
                <Box ref={loadMorePublishedCharacterCardsRef} sx={{ height: 1, width: '100%' }} />
              ) : null}
            </>
          )}
        </Stack>

        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>Опубликованные инструкции</Typography>
          {!canViewPublicInstructionTemplates ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл опубликованные инструкции.</Typography>
          ) : filteredVisiblePublicationTemplates.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет опубликованных инструкций.</Typography>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                {visiblePublishedInstructionCards.map((item) => (
                  <ButtonBase
                    key={item.id}
                    onClick={() => onNavigate('/games/all?tab=rules')}
                    sx={{
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      minHeight: CARD_MIN_HEIGHT,
                      p: 1.1,
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      textAlign: 'left',
                      alignItems: 'stretch',
                      overflow: 'hidden',
                      transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                      '&:hover': {
                        backgroundColor: 'transparent',
                        borderColor: 'color-mix(in srgb, var(--morius-accent) 48%, transparent)',
                        transform: 'translateY(-1px)',
                      },
                    }}
                  >
                    <Stack spacing={0.8} sx={{ width: '100%', height: '100%' }}>
                      <Stack direction="row" spacing={0.8} alignItems="flex-start" justifyContent="space-between">
                        <Typography
                          sx={{
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            minWidth: 0,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.title}
                        </Typography>
                        <Typography sx={{ color: 'rgba(182, 200, 222, 0.8)', fontSize: '0.74rem', fontWeight: 700 }}>
                          {item.community_rating_count > 0 ? `${item.community_rating_avg.toFixed(1)} ★` : 'Публикация'}
                        </Typography>
                      </Stack>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.84rem',
                          lineHeight: 1.36,
                          display: '-webkit-box',
                          WebkitLineClamp: 6,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          flex: 1,
                        }}
                      >
                        {item.content}
                      </Typography>
                      <Typography sx={{ color: 'rgba(182, 200, 222, 0.8)', fontSize: '0.74rem', fontWeight: 700 }}>
                        {`Автор: ${item.author_name}`}
                      </Typography>
                    </Stack>
                  </ButtonBase>
                ))}
              </Box>
              {hasMorePublishedInstructionCards ? (
                <Box ref={loadMorePublishedInstructionCardsRef} sx={{ height: 1, width: '100%' }} />
              ) : null}
            </>
          )}
        </Stack>

        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>Неопубликованные миры</Typography>
          {!canViewPrivateWorlds ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл неопубликованные миры.</Typography>
          ) : filteredVisibleUnpublishedWorlds.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет неопубликованных миров.</Typography>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                {visibleUnpublishedWorldCards.map((item) => (
                  <CommunityWorldCard
                    key={item.id}
                    world={item}
                    disabled={!isOwnProfile}
                    onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                    onClick={() => {
                      if (isOwnProfile) {
                        onNavigate(`/home/${item.id}`)
                      }
                    }}
                  />
                ))}
              </Box>
              {hasMoreUnpublishedWorldCards ? (
                <Box ref={loadMoreUnpublishedWorldCardsRef} sx={{ height: 1, width: '100%' }} />
              ) : null}
            </>
          )}
        </Stack>
      </Stack>
    )
  }

  const renderProfilePublications = () => {
    if (!isOwnProfile) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
    }

    const isPublicationLoading =
      (publicationSection === 'worlds' && isOwnGamesLoading && ownGames.length === 0) ||
      (publicationSection === 'characters' && isLoadingContent && characters.length === 0) ||
      (publicationSection === 'instructions' && isLoadingContent && templates.length === 0)

    if (isPublicationLoading) {
      return (
        <Box
          sx={{
            display: 'grid',
            gap: 1.4,
            gridTemplateColumns: PROFILE_PUBLICATION_CARD_GRID_TEMPLATE_COLUMNS,
          }}
        >
          {PROFILE_CONTENT_SKELETON_CARD_KEYS.map((cardKey) => (
            <CommunityWorldCardSkeleton key={`profile-publication-${cardKey}`} />
          ))}
        </Box>
      )
    }

    if (publicationSection === 'worlds') {
      if (filteredProfilePublicationGames.length === 0) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет игр на публикации.</Typography>
      }

      return (
        <>
          <Box
            sx={{
              display: 'grid',
              gap: 1.4,
              gridTemplateColumns: PROFILE_PUBLICATION_CARD_GRID_TEMPLATE_COLUMNS,
            }}
          >
            {visibleProfilePublicationGames.map((game) => {
              const publicationState = resolvePublicationDisplayState(
                game.publication,
                game.visibility,
                profilePublicationWorldCopySourceIds.includes(game.id),
              )
              const publicationMeta = buildPublicationCardPresentation(publicationState, game.visibility)
              return (
                <PublicationEntityCard
                  key={game.id}
                  title={game.title || 'Без названия'}
                  description={game.description || 'Описание отсутствует.'}
                  note={publicationMeta.note || game.genres[0] || ''}
                  authorName={resolvedProfileName}
                  authorAvatarUrl={resolvedProfileUser.avatar_url}
                  authorAvatarFrameId={resolvedProfileUser.avatar_frame_id}
                  authorAvatarFrameImageUrl={resolvedProfileUser.avatar_frame_image_url}
                  statusLabel={publicationMeta.statusLabel}
                  statusTone={publicationMeta.statusTone}
                  additionsCount={game.community_launches}
                  ratingAvg={game.community_rating_avg}
                  heroBackgroundSx={buildWorldFallbackArtwork(game.id)}
                  heroImageUrl={game.cover_image_url}
                  onClick={() => onNavigate(`/worlds/${resolvePublicationWorldEditTargetId(game, profilePublicationGames)}/edit?source=my-publications`)}
                />
              )
            })}
          </Box>
          {isOwnGamesLoadingMore ? (
            <Stack alignItems="center" sx={{ py: 0.7 }}>
              <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
            </Stack>
          ) : null}
          {hasMoreProfilePublicationGames ? <Box ref={loadMoreProfilePublicationGamesRef} sx={{ height: 2 }} /> : null}
        </>
      )
    }

    if (publicationSection === 'characters') {
      if (filteredProfilePublicationCharacters.length === 0) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет персонажей на публикации.</Typography>
      }

      return (
        <>
          <Box
            sx={{
              display: 'grid',
              gap: 1.4,
              gridTemplateColumns: PROFILE_PUBLICATION_CARD_GRID_TEMPLATE_COLUMNS,
            }}
          >
            {visibleProfilePublicationCharacters.map((character) => {
              const publicationState = resolvePublicationDisplayState(
                character.publication,
                character.visibility,
                profilePublicationCharacterCopySourceIds.includes(character.id),
              )
              const publicationMeta = buildPublicationCardPresentation(publicationState, character.visibility)
              return (
                <PublicationEntityCard
                  key={character.id}
                  title={character.name || 'Без имени'}
                  description={character.description || 'Описание отсутствует.'}
                  note={publicationMeta.note || character.note}
                  authorName={resolvedProfileName}
                  authorAvatarUrl={resolvedProfileUser.avatar_url}
                  authorAvatarFrameId={resolvedProfileUser.avatar_frame_id}
                  authorAvatarFrameImageUrl={resolvedProfileUser.avatar_frame_image_url}
                  statusLabel={publicationMeta.statusLabel}
                  statusTone={publicationMeta.statusTone}
                  additionsCount={character.community_additions_count}
                  ratingAvg={character.community_rating_avg}
                  heroBackgroundSx={buildWorldFallbackArtwork(character.id)}
                  heroImageUrl={character.avatar_url}
                  onClick={() => openCharacterEdit(character.source_character_id ?? character.id)}
                />
              )
            })}
          </Box>
          {isCharactersLoadingMore ? (
            <Stack alignItems="center" sx={{ py: 0.7 }}>
              <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
            </Stack>
          ) : null}
          {hasMoreProfilePublicationCharacters ? <Box ref={loadMoreProfilePublicationCharactersRef} sx={{ height: 2 }} /> : null}
        </>
      )
    }

    if (filteredProfilePublicationTemplates.length === 0) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет правил на публикации.</Typography>
    }

    return (
      <>
        <Box
          sx={{
            display: 'grid',
            gap: 1.4,
            gridTemplateColumns: PROFILE_PUBLICATION_CARD_GRID_TEMPLATE_COLUMNS,
          }}
        >
          {visibleProfilePublicationTemplates.map((template) => {
            const publicationState = resolvePublicationDisplayState(
              template.publication,
              template.visibility,
              profilePublicationTemplateCopySourceIds.includes(template.id),
            )
            const publicationMeta = buildPublicationCardPresentation(publicationState, template.visibility)
            return (
              <PublicationEntityCard
                key={template.id}
                title={template.title || 'Без названия'}
                description={template.content || 'Текст правила отсутствует.'}
                note={publicationMeta.note}
                authorName={resolvedProfileName}
                authorAvatarUrl={resolvedProfileUser.avatar_url}
                authorAvatarFrameId={resolvedProfileUser.avatar_frame_id}
                authorAvatarFrameImageUrl={resolvedProfileUser.avatar_frame_image_url}
                statusLabel={publicationMeta.statusLabel}
                statusTone={publicationMeta.statusTone}
                additionsCount={template.community_additions_count}
                ratingAvg={template.community_rating_avg}
                heroBackgroundSx={buildWorldFallbackArtwork(template.id + 100000)}
                onClick={() => openInstructionEdit(template.source_template_id ?? template.id)}
              />
            )
          })}
        </Box>
        {isTemplatesLoadingMore ? (
          <Stack alignItems="center" sx={{ py: 0.7 }}>
            <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
          </Stack>
        ) : null}
        {hasMoreProfilePublicationTemplates ? <Box ref={loadMoreProfilePublicationTemplatesRef} sx={{ height: 2 }} /> : null}
      </>
    )
  }

  const renderTabContent = () => {
    if (isCurrentTabWaitingForProfileView || isCurrentTabContentLoading) {
      return (
        <Stack spacing={1.05} sx={{ py: 0.4 }}>
          <Skeleton variant="text" width={220} height={34} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
            }}
          >
            {PROFILE_CONTENT_SKELETON_CARD_KEYS.map((cardKey) => (
              <CommunityWorldCardSkeleton key={cardKey} />
            ))}
          </Box>
        </Stack>
      )
    }

    if (tab === 'games') {
      return renderGames()
    }
    if (tab === 'characters') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return renderCharacters()
    }
    if (tab === 'world_cards') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return (
        <WorldCardTemplatesPanel
          authToken={authToken}
          searchQuery={contentSearchQuery}
          onTemplatesCountChange={setWorldCardTemplateCount}
        />
      )
    }
    if (tab === 'instructions') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return renderInstructions()
    }
    if (tab === 'favorites') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return renderFavorites()
    }
    if (tab === 'gallery') {
      return renderGallery()
    }
    if (tab === 'notifications') {
      return renderNotifications()
    }
    if (tab === 'subscriptions') {
      return renderSubscriptions()
    }
    if (tab === 'publications') {
      return renderProfileWorlds()
    }
    if (tab === 'plots') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел «Сюжеты» скоро появится.</Typography>
    }
    return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел «Подписки» пока в разработке.</Typography>
  }

  return (
    <Box
      className="morius-app-shell"
      sx={{
        minHeight: '100svh',
        color: 'var(--morius-text-primary)',
        background: 'var(--morius-app-bg)',
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
          { key: 'games-all', label: 'Сообщество', onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню',
          collapsed: 'Открыть меню',
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
              value={contentSearchQuery}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setContentSearchQuery(event.target.value.slice(0, PROFILE_CONTENT_SEARCH_MAX))}
              placeholder="Поиск"
              aria-label="Поиск по профилю"
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
            <SvgIcon
              viewBox="0 0 24 24"
              sx={{
                position: 'absolute',
                right: 14,
                top: '50%',
                width: 18,
                height: 18,
                transform: 'translateY(-50%)',
                color: 'var(--morius-text-secondary)',
                pointerEvents: 'none',
              }}
            >
              <path fill="currentColor" d="M10.8 4a6.8 6.8 0 0 1 5.36 10.98l3.43 3.43-1.18 1.18-3.43-3.43A6.8 6.8 0 1 1 10.8 4Zm0 1.7a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2Z" />
            </SvgIcon>
          </Box>
        }
        rightActions={<Box sx={{ display: { xs: 'none', md: 'block' } }}><HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} /></Box>}
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 },
          px: { xs: 1.2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
          {error ? (
            <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.1, borderRadius: '12px' }}>
              {error}
            </Alert>
          ) : null}
          {avatarError ? (
            <Alert severity="error" onClose={() => setAvatarError('')} sx={{ mb: 1.1, borderRadius: '12px' }}>
              {avatarError}
            </Alert>
          ) : null}

          <Box
            sx={{
              mb: 1.6,
              pt: { xs: 1.2, md: 1.8 },
              pb: { xs: 1.2, md: 1.4 },
            }}
          >
            <Stack spacing={1.2} sx={{ display: isProfileShellBlocked ? 'flex' : 'none' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Skeleton variant="text" width={180} height={36} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                <Skeleton variant="rounded" width={136} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.1} alignItems={{ xs: 'center', md: 'flex-start' }}>
                <Skeleton variant="circular" width={PROFILE_AVATAR_SIZE} height={PROFILE_AVATAR_SIZE} sx={{ flexShrink: 0, bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                <Stack spacing={0.72} sx={{ minWidth: 0, flex: 1, alignItems: { xs: 'center', md: 'flex-start' }, textAlign: { xs: 'center', md: 'left' } }}>
                  <Skeleton variant="text" width="48%" height={38} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                  <Skeleton variant="text" width="92%" height={26} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                  <Skeleton variant="text" width="80%" height={26} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                  <Skeleton variant="text" width="42%" height={22} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                </Stack>
              </Stack>

              <Stack
                direction="row"
                spacing={0.7}
                useFlexGap
                flexWrap="wrap"
                alignItems="center"
                sx={{ display: { xs: 'none', md: 'flex' } }}
              >
                <Skeleton variant="rounded" width={110} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={122} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={166} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={126} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
              </Stack>
            </Stack>

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={0.7}
              sx={{
                mb: 1,
                display: 'none',
              }}
            >
              <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--morius-text-secondary)',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    minHeight: 28,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  Подписчики ({followersCount.toLocaleString('ru-RU')})
                </Typography>
                <Button
                  onClick={() => {
                    if (isOwnProfile) {
                      handleOpenTopUpDialog()
                    }
                  }}
                  sx={{
                    minHeight: 28,
                    px: 1.2,
                    borderRadius: '999px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  <SoulAmount amount={coins} iconSize={17} fontSize="0.78rem" />
                </Button>
              </Stack>

              <IconButton
                onClick={handleOpenMobileProfileMenu}
                aria-label="Действия профиля"
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--morius-text-primary)',
                  '&:hover': {
                    backgroundColor: 'transparent',
                  },
                }}
              >
                <Typography component="span" sx={{ fontSize: '1.1rem', lineHeight: 1 }}>
                  ⋮
                </Typography>
              </IconButton>
            </Stack>

            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1}
              sx={{ mb: 1.1, display: 'none' }}
            >
              <Typography sx={{ fontSize: { xs: '1.3rem', md: '1.48rem' }, fontWeight: 800 }}>Об аккаунте</Typography>
              <Stack direction="row" spacing={0.8} alignItems="center">
                <Typography
                  sx={{
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: 'var(--morius-text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Подписчики ({followersCount.toLocaleString('ru-RU')})
                </Typography>
                <Button
                  onClick={() => {
                    if (isOwnProfile) {
                      handleOpenTopUpDialog()
                    }
                  }}
                  sx={{
                    display: isOwnProfile ? 'inline-flex' : 'none',
                    minHeight: 30,
                    px: 0.4,
                    py: 0,
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: 'var(--morius-text-primary)',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  <Stack component="span" direction="row" spacing={0.6} alignItems="center">
                    <Box component="span">Баланс</Box>
                    <SoulAmount amount={coins} iconSize={17} fontSize="0.9rem" />
                  </Stack>
                </Button>
              </Stack>
            </Stack>

            <Stack spacing={1.15} sx={{ display: 'none' }}>
              <Stack
                direction={isProfileNarrowMobile ? 'column' : 'row'}
                spacing={isProfileNarrowMobile ? 0.9 : 1.1}
                alignItems={isProfileNarrowMobile ? 'center' : 'flex-start'}
                sx={{ minWidth: 0 }}
              >
                <Box
                  role="button"
                  tabIndex={isOwnProfile ? 0 : -1}
                  onClick={() => {
                    if (isOwnProfile && !isAvatarSaving) {
                      avatarInputRef.current?.click()
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!isOwnProfile) {
                      return
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (!isAvatarSaving) {
                        avatarInputRef.current?.click()
                      }
                    }
                  }}
                  sx={{
                    position: 'relative',
                    width: PROFILE_AVATAR_SIZE,
                    height: PROFILE_AVATAR_SIZE,
                    borderRadius: '50%',
                    overflow: 'visible',
                    cursor: isOwnProfile && !isAvatarSaving ? 'pointer' : 'default',
                    flexShrink: 0,
                    mx: isProfileNarrowMobile ? 'auto' : 0,
                    '&:hover .morius-profile-avatar-overlay': {
                      opacity: isOwnProfile && !isAvatarSaving ? 1 : 0,
                    },
                  }}
                >
                  <UserAvatar user={resolvedAvatarUser} frameImageUrl={resolvedProfileUser.avatar_frame_image_url} size={PROFILE_AVATAR_SIZE} />
                  <Box
                    className="morius-profile-avatar-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      opacity: 0,
                      transition: 'opacity 180ms ease',
                      backgroundColor: 'rgba(8, 14, 22, 0.52)',
                    }}
                  >
                    <Box
                      sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        border: 'var(--morius-border-width) solid rgba(219, 231, 245, 0.5)',
                        backgroundColor: 'rgba(17, 27, 40, 0.86)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '1.05rem',
                        fontWeight: 700,
                      }}
                    >
                      ✎
                    </Box>
                  </Box>
                </Box>

                <Stack
                  spacing={0.72}
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    width: isProfileNarrowMobile ? '100%' : 'auto',
                    alignItems: isProfileNarrowMobile && !(isEditing && isOwnProfile) ? 'center' : 'stretch',
                    textAlign: isProfileNarrowMobile && !(isEditing && isOwnProfile) ? 'center' : 'left',
                  }}
                >
                  {isEditing && isOwnProfile ? (
                    <>
                      <TextField
                        size="small"
                        label="Ник"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value.slice(0, PROFILE_NAME_MAX))}
                        inputProps={{ maxLength: PROFILE_NAME_MAX }}
                        helperText={<TextLimitIndicator currentLength={nameDraft.length} maxLength={PROFILE_NAME_MAX} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      />
                      <TextField
                        label="Описание"
                        value={descriptionDraft}
                        onChange={(event) => setDescriptionDraft(event.target.value.slice(0, PROFILE_DESC_MAX))}
                        multiline
                        minRows={3}
                        maxRows={5}
                        inputProps={{ maxLength: PROFILE_DESC_MAX }}
                        helperText={<TextLimitIndicator currentLength={descriptionDraft.length} maxLength={PROFILE_DESC_MAX} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      />
                      <Stack direction="row" spacing={0.7}>
                        <Button
                          onClick={() => void saveProfile()}
                          disabled={isSavingProfile}
                          sx={{
                            minHeight: 34,
                            borderRadius: '10px',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-button-active)',
                            color: 'var(--morius-text-primary)',
                            '&:hover': {
                              backgroundColor: 'transparent',
                            },
                          }}
                        >
                          {isSavingProfile ? (
                            <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                          ) : (
                            'Сохранить'
                          )}
                        </Button>
                        <Button
                          onClick={() => {
                            setIsEditing(false)
                            setNameDraft(resolvedProfileName)
                            setDescriptionDraft(resolvedProfileDescription)
                          }}
                          sx={{ color: 'var(--morius-text-secondary)' }}
                        >
                          Отмена
                        </Button>
                      </Stack>
                    </>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: { xs: '1.34rem', md: '1.54rem' }, fontWeight: 800 }}>{resolvedProfileName}</Typography>
                      {isOwnProfile ? (
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>{user.email}</Typography>
                      ) : null}
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', whiteSpace: 'pre-wrap' }}>
                        {resolvedProfileDescription || 'Описание пока не добавлено.'}
                      </Typography>
                    </>
                  )}
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="center" sx={{ display: { xs: 'none', md: 'flex' } }}>

                {!isOwnProfile ? (
                  <Button
                    onClick={() => void handleToggleFollow()}
                    disabled={isFollowSaving || !profileView}
                    sx={{
                      minHeight: 34,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      color: 'var(--morius-text-primary)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: 'transparent',
                      },
                    }}
                  >
                    {isFollowSaving ? (
                      <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                    ) : profileView?.is_following ? (
                      'Отписаться'
                    ) : (
                      'Подписаться'
                    )}
                  </Button>
                ) : null}

                <Button
                  disabled
                  sx={{
                    display: 'none',
                    minHeight: 34,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    color: 'var(--morius-text-secondary)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    textTransform: 'none',
                  }}
                >
                  Подписаться
                </Button>

                <Button
                  onClick={() => {
                    if (isOwnProfile) {
                      if (resolvedCanOpenAdmin) {
                        setAdminOpen(true)
                        return
                      }
                      setIsEditing((previous) => !previous)
                    }
                  }}
                  sx={{
                    display: isOwnProfile ? 'inline-flex' : 'none',
                    minHeight: 34,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
                    },
                  }}
                >
                  {resolvedCanOpenAdmin ? 'Админка' : (isEditing ? 'Свернуть редактор' : 'Редактировать профиль')}
                </Button>

                {isOwnProfile && resolvedCanOpenAdmin ? (
                  <Button
                    onClick={() => setIsEditing((previous) => !previous)}
                    sx={{
                      minHeight: 34,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      color: 'var(--morius-text-primary)',
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
                      },
                    }}
                  >
                    {isEditing ? '\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440' : '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c'}
                  </Button>
                ) : null}

                <Button
                  onClick={() => {
                    if (isOwnProfile) {
                      setLogoutOpen(true)
                    }
                  }}
                  sx={{
                    display: isOwnProfile ? 'inline-flex' : 'none',
                    minHeight: 34,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
                    },
                  }}
                >
                  Выход
                </Button>
              </Stack>
            </Stack>

            <Box
              sx={{
                display: isProfileShellBlocked ? 'none' : undefined,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: { xs: '18px', md: '24px' },
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, #05080c 18%)',
              }}
            >
              <Box sx={{ position: 'relative', height: { xs: 188, sm: 224, md: 268 } }}>
                <ProgressiveImage
                  src={resolvedProfileBannerSrc}
                  alt=""
                  loading="lazy"
                  objectFit="cover"
                  objectPosition={resolvedProfileBannerObjectPosition}
                  loaderSize={30}
                  fallback={<Box sx={{ position: 'absolute', inset: 0, backgroundColor: 'var(--morius-card-bg)' }} />}
                  containerSx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'var(--morius-card-bg)',
                  }}
                  imgSx={{ filter: 'saturate(0.96) contrast(1.02)' }}
                />
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(5, 8, 12, 0.1)',
                  }}
                />
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{
                    position: 'absolute',
                    top: { xs: 12, md: 16 },
                    right: { xs: 12, md: 16 },
                    zIndex: 3,
                    display: { xs: 'none', md: 'flex' },
                  }}
                >
                  {isOwnProfile ? (
                    <IconButton
                      onClick={handleToggleNotificationPopover}
                      aria-label="Уведомления"
                      sx={{
                        position: 'relative',
                        overflow: 'visible',
                        width: '38px !important',
                        height: '38px !important',
                        minWidth: '38px !important',
                        minHeight: '38px !important',
                        borderRadius: '50% !important',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg) !important',
                        color: 'color-mix(in srgb, var(--morius-title-text) 78%, transparent) !important',
                        p: '0 !important',
                        '&:hover': {
                          backgroundColor: 'var(--morius-button-hover) !important',
                          color: 'var(--morius-title-text) !important',
                        },
                      }}
                    >
                      <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
                        <path fill="currentColor" d="M12 22a2.6 2.6 0 0 0 2.45-1.74h-4.9A2.6 2.6 0 0 0 12 22Zm7-5.2-1.6-2.5V10a5.4 5.4 0 0 0-4.35-5.3V3a1.05 1.05 0 1 0-2.1 0v1.7A5.4 5.4 0 0 0 6.6 10v4.3L5 16.8V18h14v-1.2Z" />
                      </SvgIcon>
                      {notificationCounts.unread_count > 0 ? (
                        <Box
                          sx={{
                            position: 'absolute',
                            top: -3,
                            right: -4,
                            minWidth: 18,
                            height: 16,
                            px: 0.45,
                            borderRadius: '99px',
                            backgroundColor: 'var(--morius-accent)',
                            color: '#fff',
                            fontSize: '0.62rem',
                            fontWeight: 900,
                            lineHeight: '16px',
                            textAlign: 'center',
                          }}
                        >
                          {notificationCounts.unread_count > 99 ? '99+' : notificationCounts.unread_count}
                        </Box>
                      ) : null}
                    </IconButton>
                  ) : null}
                  {!isOwnProfile ? (
                    <Button
                      onClick={() => void handleToggleFollow()}
                      disabled={isFollowSaving || !profileView}
                      sx={{
                        minHeight: 38,
                        px: 1.6,
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        color: 'var(--morius-title-text)',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                      }}
                    >
                      {isFollowSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} /> : profileView?.is_following ? 'Отписаться' : 'Подписаться'}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setProfileDialogOpen(true)}
                      sx={{
                        minHeight: 38,
                        px: 1.6,
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        color: 'var(--morius-title-text)',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                      }}
                    >
                      Настройки
                    </Button>
                  )}
                  {isOwnProfile && resolvedCanOpenAdmin ? (
                    <Button
                      onClick={() => setAdminOpen(true)}
                      sx={{
                        minHeight: 38,
                        px: 1.6,
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        color: 'var(--morius-title-text)',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                      }}
                    >
                      Админка
                    </Button>
                  ) : null}
                  {isOwnProfile ? (
                    <Button
                      onClick={() => setLogoutOpen(true)}
                      sx={{
                        minHeight: 38,
                        px: 1.6,
                        borderRadius: '12px',
                        border: 'none',
                        backgroundColor: 'rgba(175, 72, 72, 0.26)',
                        color: 'color-mix(in srgb, #ffd0d0 88%, var(--morius-title-text))',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        '&:hover': { backgroundColor: 'rgba(175, 72, 72, 0.4)', color: '#ffe1e1' },
                      }}
                    >
                      Выход
                    </Button>
                  ) : null}
                </Stack>
              </Box>
              <Stack spacing={{ xs: 1.2, md: 1.45 }} sx={{ position: 'relative', zIndex: 2, p: { xs: 2, sm: 2.4, md: 3 }, pt: 0 }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  spacing={{ xs: 1.4, md: 2.2 }}
                  alignItems={{ xs: 'stretch', md: 'flex-start' }}
                  sx={{ minWidth: 0 }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 1.1, sm: 2 }}
                    alignItems={{ xs: 'center', sm: 'flex-start' }}
                    sx={{ minWidth: 0, flex: 1 }}
                  >
                    <Box
                      role="button"
                      tabIndex={isOwnProfile ? 0 : -1}
                      onClick={() => {
                        if (isOwnProfile && !isAvatarSaving) {
                          avatarInputRef.current?.click()
                        }
                      }}
                      onKeyDown={(event) => {
                        if (!isOwnProfile) {
                          return
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          if (!isAvatarSaving) {
                            avatarInputRef.current?.click()
                          }
                        }
                      }}
                      sx={{
                        position: 'relative',
                        width: PROFILE_AVATAR_SIZE,
                        height: PROFILE_AVATAR_SIZE,
                        borderRadius: '50%',
                        overflow: 'visible',
                        cursor: isOwnProfile && !isAvatarSaving ? 'pointer' : 'default',
                        flexShrink: 0,
                        mx: { xs: 'auto', sm: 0 },
                        mt: { xs: '-62px', sm: '-68px', md: '-72px' },
                        boxShadow: '0 0 0 4px var(--morius-app-base), 0 18px 42px rgba(0, 0, 0, 0.3)',
                        '&:hover .morius-profile-avatar-overlay': {
                          opacity: isOwnProfile && !isAvatarSaving ? 1 : 0,
                        },
                      }}
                    >
                      <UserAvatar
                        user={resolvedAvatarUser}
                        frameImageUrl={resolvedProfileUser.avatar_frame_image_url}
                        size={PROFILE_AVATAR_SIZE}
                      />
                      <Box
                        className="morius-profile-avatar-overlay"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          opacity: 0,
                          transition: 'opacity 180ms ease',
                          backgroundColor: 'rgba(8, 14, 22, 0.52)',
                        }}
                      >
                        <Box
                          sx={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            border: 'var(--morius-border-width) solid rgba(219, 231, 245, 0.5)',
                            backgroundColor: 'rgba(17, 27, 40, 0.86)',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '1.05rem',
                            fontWeight: 700,
                          }}
                        >
                          +
                        </Box>
                      </Box>
                    </Box>

                    <Stack
                      spacing={0.65}
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        width: '100%',
                        pt: { sm: '10px' },
                        alignItems: { xs: (isEditing && isOwnProfile) ? 'stretch' : 'center', sm: 'flex-start' },
                        textAlign: { xs: (isEditing && isOwnProfile) ? 'left' : 'center', sm: 'left' },
                      }}
                    >
                      {isEditing && isOwnProfile ? (
                        <>
                          <TextField
                            size="small"
                            label="Ник"
                            value={nameDraft}
                            onChange={(event) => setNameDraft(event.target.value.slice(0, PROFILE_NAME_MAX))}
                            inputProps={{ maxLength: PROFILE_NAME_MAX }}
                            helperText={<TextLimitIndicator currentLength={nameDraft.length} maxLength={PROFILE_NAME_MAX} />}
                            FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                          />
                          <TextField
                            label="Описание"
                            value={descriptionDraft}
                            onChange={(event) => setDescriptionDraft(event.target.value.slice(0, PROFILE_DESC_MAX))}
                            multiline
                            minRows={3}
                            maxRows={5}
                            inputProps={{ maxLength: PROFILE_DESC_MAX }}
                            helperText={<TextLimitIndicator currentLength={descriptionDraft.length} maxLength={PROFILE_DESC_MAX} />}
                            FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                          />
                          <Stack direction="row" spacing={0.7}>
                            <Button
                              onClick={() => void saveProfile()}
                              disabled={isSavingProfile}
                              sx={{
                                minHeight: 38,
                                px: 1.4,
                                borderRadius: '14px',
                                border: 'none',
                                backgroundColor: 'var(--morius-button-active)',
                                color: 'var(--morius-title-text)',
                                textTransform: 'none',
                                fontWeight: 700,
                                '&:hover': {
                                  backgroundColor: 'color-mix(in srgb, var(--morius-button-active) 88%, #fff 12%)',
                                },
                              }}
                            >
                              {isSavingProfile ? <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} /> : 'Сохранить'}
                            </Button>
                            <Button
                              onClick={() => {
                                setIsEditing(false)
                                setNameDraft(resolvedProfileName)
                                setDescriptionDraft(resolvedProfileDescription)
                              }}
                              sx={{
                                minHeight: 38,
                                px: 1.2,
                                borderRadius: '14px',
                                border: 'none',
                                color: 'var(--morius-text-secondary)',
                                textTransform: 'none',
                              }}
                            >
                              Отмена
                            </Button>
                          </Stack>
                        </>
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.8rem', md: '2.15rem' }, fontWeight: 800, lineHeight: 1.05 }}>
                              {resolvedProfileName}
                            </Typography>
                            <Box
                              component="span"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 0.4,
                                height: 22,
                                px: 1,
                                borderRadius: '999px',
                                backgroundColor: 'var(--morius-accent)',
                                color: '#ffffff',
                                fontSize: '0.7rem',
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <Box component="span" sx={{ fontSize: '0.78rem', lineHeight: 1 }}>+</Box>
                              {resolvedProfileRoleBadge}
                            </Box>
                          </Stack>
                          {resolvedProfileDescription ? (
                            <Box>
                              <Typography
                                sx={{
                                  color: 'var(--morius-text-secondary)',
                                  fontSize: '1rem',
                                  lineHeight: 1.5,
                                  whiteSpace: 'pre-wrap',
                                  maxWidth: 680,
                                  overflow: isDescExpanded ? 'visible' : 'hidden',
                                  display: '-webkit-box',
                                  WebkitLineClamp: isDescExpanded ? 'unset' : 3,
                                  WebkitBoxOrient: 'vertical',
                                }}
                              >
                                {resolvedProfileDescription}
                              </Typography>
                              {!isDescExpanded && resolvedProfileDescription.length > 120 ? (
                                <Box
                                  component="button"
                                  type="button"
                                  onClick={() => setIsDescExpanded(true)}
                                  sx={{
                                    border: 'none',
                                    background: 'none',
                                    color: 'var(--morius-accent)',
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    p: 0,
                                    font: 'inherit',
                                  }}
                                >
                                  ещё...
                                </Box>
                              ) : isDescExpanded ? (
                                <Box
                                  component="button"
                                  type="button"
                                  onClick={() => setIsDescExpanded(false)}
                                  sx={{
                                    border: 'none',
                                    background: 'none',
                                    color: 'var(--morius-text-secondary)',
                                    fontSize: '0.88rem',
                                    cursor: 'pointer',
                                    p: 0,
                                    font: 'inherit',
                                  }}
                                >
                                  свернуть
                                </Box>
                              ) : null}
                            </Box>
                          ) : (
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '1rem', lineHeight: 1.5, maxWidth: 680 }}>
                              Описание пока не добавлено.
                            </Typography>
                          )}
                          {isOwnProfile ? (
                            <Stack direction="row" spacing={0.85} useFlexGap flexWrap="wrap" sx={{ pt: 1, display: { xs: 'flex', md: 'none' } }}>
                              <Button
                                onClick={handleOpenTopUpDialog}
                                sx={{
                                  minHeight: 28,
                                  px: 1.12,
                                  borderRadius: '8px',
                                  border: 'none',
                                  backgroundColor: 'var(--morius-accent)',
                                  color: '#fff',
                                  textTransform: 'none',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  lineHeight: 1,
                                  '&:hover': {
                                    backgroundColor: 'color-mix(in srgb, var(--morius-accent) 86%, #fff 14%)',
                                  },
                                }}
                              >
                                <SoulAmount amount={coins} iconSize={16} fontSize="0.72rem" />
                              </Button>
                              <Button
                                onClick={() => setAppDownloadDialogOpen(true)}
                                sx={{
                                  display: { xs: 'inline-flex', md: 'none' },
                                  minHeight: 28,
                                  px: 1.12,
                                  borderRadius: '8px',
                                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 42%, var(--morius-card-border))',
                                  backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 72%, var(--morius-accent) 28%)',
                                  color: 'var(--morius-title-text)',
                                  textTransform: 'none',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  lineHeight: 1,
                                  '&:hover': {
                                    backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 62%, var(--morius-accent) 38%)',
                                  },
                                }}
                              >
                                Скачать
                              </Button>
                            </Stack>
                          ) : null}
                        </>
                      )}
                    </Stack>
                  </Stack>

                  <Stack
                    spacing={1.05}
                    sx={{
                      width: { xs: '100%', md: 'auto' },
                      minWidth: { md: 200 },
                      alignItems: { xs: 'stretch', md: 'flex-end' },
                      pt: { md: '10px' },
                    }}
                  >
                    {isOwnProfile ? (
                      <Box
                        sx={{
                          display: 'none',
                          p: 1.05,
                          borderRadius: '8px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 84%, transparent)',
                        }}
                      >
                        <Stack spacing={0.82}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 900 }}>
                              Пригласи друга
                            </Typography>
                            <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.78rem', fontWeight: 900 }}>
                              <SoulAmount amount="+500" iconSize={17} fontSize="0.78rem" />
                            </Typography>
                          </Stack>
                          <Button
                            onClick={() => void handleCopyReferralLink()}
                            disabled={!referralLink || isReferralSummaryLoading}
                            sx={{
                              minHeight: 36,
                              px: 1,
                              borderRadius: '8px',
                              justifyContent: 'flex-start',
                              gap: 0.75,
                              textTransform: 'none',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'var(--morius-elevated-bg)',
                              color: 'var(--morius-text-primary)',
                              fontWeight: 800,
                              '&:hover': {
                                backgroundColor: 'var(--morius-button-hover)',
                              },
                            }}
                          >
                            <Box component="img" src={icons.communityShare} alt="" sx={{ width: 15, height: 15, flexShrink: 0 }} />
                            <Typography component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem', fontWeight: 800 }}>
                              {isReferralCopied ? 'Ссылка скопирована' : 'Скопировать реферальную ссылку'}
                            </Typography>
                          </Button>
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', lineHeight: 1.28 }}>
                            Оплаченных приглашений: {Math.max(0, referralSummary?.paid_referrals_count ?? 0)}
                          </Typography>
                        </Stack>
                      </Box>
                    ) : null}

                    <Stack
                      direction="row"
                      spacing={0.75}
                      useFlexGap
                      flexWrap="wrap"
                      alignItems="center"
                      justifyContent={{ xs: 'flex-start', lg: 'flex-end' }}
                      sx={{ display: 'none' }}
                    >
                      {isOwnProfile ? (
                        <IconButton
                          onClick={handleToggleNotificationPopover}
                          aria-label="Уведомления"
                          sx={{
                            position: 'relative',
                            overflow: 'visible',
                            flex: `0 0 ${HEADER_AVATAR_SIZE}px`,
                            alignSelf: 'center',
                            width: `${HEADER_AVATAR_SIZE}px !important`,
                            height: `${HEADER_AVATAR_SIZE}px !important`,
                            minWidth: `${HEADER_AVATAR_SIZE}px !important`,
                            minHeight: `${HEADER_AVATAR_SIZE}px !important`,
                            maxWidth: `${HEADER_AVATAR_SIZE}px !important`,
                            maxHeight: `${HEADER_AVATAR_SIZE}px !important`,
                            borderRadius: '50% !important',
                            border: 'none',
                            boxSizing: 'border-box',
                            backgroundColor: 'var(--morius-elevated-bg) !important',
                            color: 'color-mix(in srgb, var(--morius-title-text) 74%, transparent) !important',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            p: '0 !important',
                            '&:hover': {
                              backgroundColor: 'var(--morius-button-hover) !important',
                              color: 'var(--morius-title-text) !important',
                              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.24) !important',
                            },
                            '&:active': {
                              backgroundColor: 'var(--morius-button-active) !important',
                            },
                          }}
                        >
                          <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
                            <path fill="currentColor" d="M12 22a2.6 2.6 0 0 0 2.45-1.74h-4.9A2.6 2.6 0 0 0 12 22Zm7-5.2-1.6-2.5V10a5.4 5.4 0 0 0-4.35-5.3V3a1.05 1.05 0 1 0-2.1 0v1.7A5.4 5.4 0 0 0 6.6 10v4.3L5 16.8V18h14v-1.2Z" />
                          </SvgIcon>
                          {notificationCounts.unread_count > 0 ? (
                            <Box
                              sx={{
                                position: 'absolute',
                                top: -3,
                                right: -4,
                                minWidth: 24,
                                height: 16,
                                px: 0.45,
                                borderRadius: '99px',
                                backgroundColor: 'var(--morius-accent)',
                                color: '#fff',
                                fontSize: '0.62rem',
                                fontWeight: 900,
                                lineHeight: '16px',
                              }}
                            >
                              {notificationCounts.unread_count > 99 ? '99+' : notificationCounts.unread_count}
                            </Box>
                          ) : null}
                        </IconButton>
                      ) : null}
                      {!isOwnProfile ? (
                        <Button
                          onClick={() => void handleToggleFollow()}
                          disabled={isFollowSaving || !profileView}
                          sx={{
                            minHeight: 40,
                            px: 1.6,
                            borderRadius: '999px',
                            border: 'none',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'var(--morius-button-hover)',
                              color: 'var(--morius-title-text)',
                              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.2)',
                            },
                          }}
                        >
                          {isFollowSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} /> : profileView?.is_following ? 'Отписаться' : 'Подписаться'}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => setProfileDialogOpen(true)}
                          sx={{
                            minHeight: 40,
                            px: 1.75,
                            borderRadius: '999px',
                            border: 'none',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'var(--morius-button-hover)',
                              color: 'var(--morius-title-text)',
                              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.2)',
                            },
                          }}
                        >
                          Настройки
                        </Button>
                      )}

                      {isOwnProfile && resolvedCanOpenAdmin ? (
                        <Button
                          onClick={() => setAdminOpen(true)}
                          sx={{
                            minHeight: 40,
                            px: 1.75,
                            borderRadius: '999px',
                            border: 'none',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'var(--morius-button-hover)',
                              color: 'var(--morius-title-text)',
                              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.2)',
                            },
                          }}
                        >
                          Админка
                        </Button>
                      ) : null}

                      {isOwnProfile ? (
                        <Button
                          onClick={() => setLogoutOpen(true)}
                          sx={{
                            minHeight: 40,
                            px: 1.75,
                            borderRadius: '999px',
                            border: 'none',
                            backgroundColor: 'rgba(175, 72, 72, 0.2)',
                            color: 'color-mix(in srgb, #ffd0d0 88%, var(--morius-title-text))',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'rgba(175, 72, 72, 0.34)',
                              color: '#ffe1e1',
                            },
                          }}
                        >
                          Выход
                        </Button>
                      ) : null}
                    </Stack>

                    {isOwnProfile ? (
                      <Stack spacing={0.85} alignItems={{ xs: 'stretch', md: 'flex-end' }} sx={{ display: { xs: 'none', md: 'flex' }, width: '100%' }}>
                        <Button
                          onClick={handleOpenTopUpDialog}
                          sx={{
                            minHeight: 36,
                            px: 1.8,
                            borderRadius: '9999px',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 45%, var(--morius-card-border))',
                            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 70%, var(--morius-accent) 30%)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 800,
                            fontSize: '13px',
                            gap: 0.6,
                            alignSelf: { xs: 'stretch', md: 'flex-end' },
                            '&:hover': {
                              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 60%, var(--morius-accent) 40%)',
                            },
                          }}
                        >
                          <SoulAmount amount={coins} iconSize={16} fontSize="13px" />
                        </Button>
                      </Stack>
                    ) : null}

                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      justifyContent={isOwnProfile ? 'flex-end' : 'flex-start'}
                      sx={{ display: { xs: 'flex', md: 'none' } }}
                    >
                      {!isOwnProfile ? (
                        <Button
                          onClick={() => void handleToggleFollow()}
                          disabled={isFollowSaving || !profileView}
                          sx={{
                            minHeight: 40,
                            px: 1.45,
                            borderRadius: '14px',
                            border: 'none',
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 700,
                            flex: 1,
                          }}
                        >
                          {isFollowSaving ? 'Обновление...' : profileView?.is_following ? 'Отписаться' : 'Подписаться'}
                        </Button>
                      ) : null}
                      <IconButton
                        onClick={handleOpenMobileProfileMenu}
                        aria-label="Действия профиля"
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '14px',
                          border: 'none',
                          backgroundColor: 'rgba(255, 255, 255, 0.06)',
                          color: 'var(--morius-title-text)',
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          },
                        }}
                      >
                        <Typography component="span" sx={{ fontSize: '1.1rem', lineHeight: 1 }}>
                          {'\u22EE'}
                        </Typography>
                      </IconButton>
                    </Stack>
                  </Stack>
                </Stack>

                <Divider sx={{ borderColor: 'color-mix(in srgb, var(--morius-card-border) 84%, transparent)' }} />
                <Stack
                  direction="row"
                  spacing={1.1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  divider={<Divider orientation="vertical" flexItem sx={{ borderColor: 'color-mix(in srgb, var(--morius-card-border) 70%, transparent)', my: 0.3 }} />}
                  sx={{ minWidth: 0, justifyContent: { xs: 'center', sm: 'flex-start' } }}
                >
                  {isOwnProfile && user.email ? (
                    <Stack direction="row" spacing={0.55} alignItems="center">
                      <SvgIcon viewBox="0 0 24 24" sx={{ width: 15, height: 15, color: 'var(--morius-text-secondary)' }}>
                        <path fill="currentColor" d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm8 7 8-5H4l8 5Zm0 2L4 9v9h16V9l-8 5Z" />
                      </SvgIcon>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', fontWeight: 700 }}>{user.email}</Typography>
                    </Stack>
                  ) : null}
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
                    {followersCount.toLocaleString('ru-RU')} {followersCount === 1 ? '\u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A' : '\u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0430'}
                  </Typography>
                  {isOwnProfile || canViewSubscriptions ? (
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
                      {subscriptionsCount.toLocaleString('ru-RU')} {subscriptionsCount === 1 ? '\u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430' : '\u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438'}
                    </Typography>
                  ) : null}
                  {isOwnProfile ? (
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
                      {libraryTotalCount.toLocaleString('ru-RU')} {libraryTotalCount === 1 ? '\u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044F' : '\u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0439'}
                    </Typography>
                  ) : null}
                </Stack>
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: { xs: 1.4, lg: 2.2 },
              gridTemplateColumns: '1fr',
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                p: 0,
                border: 'none',
                background: 'transparent',
                minWidth: 0,
              }}
            >
              <Box sx={{ display: 'none', mb: 1, minWidth: 0 }}>
                {/* Mobile primary tabs: Контент / Лайки / Подписки */}
                <Box
                  sx={{
                    display: 'flex',
                    gap: 'clamp(4px, 1.7vw, 8px)',
                    mb: 0.8,
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  {resolvedMobilePrimaryTabs.map((item) => (
                    <ButtonBase
                      key={`mobile-primary-tab-${item.id}`}
                      onClick={() => handleMobilePrimaryTabChange(item.id)}
                      aria-pressed={mobilePrimaryTab === item.id}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: '1 1 0%',
                        minWidth: 0,
                        height: 'clamp(34px, 9.2vw, 39px)',
                        px: 'clamp(5px, 1.9vw, 8px)',
                        borderRadius: 'clamp(10px, 3vw, 12px)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        boxSizing: 'border-box',
                        fontSize: 'clamp(0.71rem, 2.35vw, 0.79rem)',
                        fontWeight: 700,
                        color: mobilePrimaryTab === item.id ? 'var(--morius-text-primary)' : 'var(--morius-text-secondary)',
                        lineHeight: 1,
                        letterSpacing: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        backgroundColor: mobilePrimaryTab === item.id ? 'var(--morius-button-active)' : 'transparent',
                        transition: 'background-color 180ms ease',
                        '&:hover': { backgroundColor: 'transparent' },
                      }}
                    >
                      {item.label}
                    </ButtonBase>
                  ))}
                </Box>

                {/* Content sub-tabs (Миры / Инструкции / Персонажи / Сюжеты) — swipeable */}
                {mobilePrimaryTab === 'content' && mobileContentTabs.length > 0 ? (
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 0.55,
                      mb: 0.8,
                      width: '100%',
                      minWidth: 0,
                      maxWidth: '100%',
                      overflowX: 'auto',
                    }}
                  >
                    {mobileContentTabs.map((item) => (
                      <Button
                        key={`mobile-content-tab-${item.id}`}
                        onClick={() => setTab(item.id)}
                        data-tour-id={
                          item.id === 'characters'
                            ? 'profile-tab-characters'
                            : item.id === 'instructions'
                              ? 'profile-tab-instructions'
                              : item.id === 'plots'
                                ? 'profile-tab-plots'
                                : undefined
                        }
                        sx={{
                          flexShrink: 0,
                          minHeight: 34,
                          px: 1.4,
                          borderRadius: '10px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: tab === item.id ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                          color: 'var(--morius-text-primary)',
                          textTransform: 'none',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          '&:hover': {
                            backgroundColor: 'transparent',
                          },
                        }}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </Box>
                ) : null}

                {profileMainSection === 'library' && isOwnProfile ? (
                  <Stack direction="row" spacing={1.2} alignItems="center" sx={{ pt: 0.6 }}>
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
                      Показано {libraryTabCounts[tab] ?? libraryTotalCount}
                    </Typography>
                    <ButtonBase
                      onClick={handleOpenContentSortMenu}
                      disabled={activeContentSortOptions.length === 0}
                      sx={{
                        color: 'var(--morius-text-secondary)',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        borderRadius: '8px',
                        px: 0.6,
                        gap: 0.4,
                        '&:hover': { color: 'var(--morius-title-text)' },
                      }}
                    >
                      {activeContentSortLabel}
                      <Box component="img" src={icons.profileSearchFilter} alt="" sx={{ width: 12, height: 7, opacity: 0.8 }} />
                    </ButtonBase>
                  </Stack>
                ) : null}

                <Stack direction="row" spacing={0.6} sx={{ pt: 0.8, minWidth: 0, width: '100%' }}>
                  <TextField
                    size="small"
                    value={contentSearchQuery}
                    onChange={(event) => setContentSearchQuery(event.target.value.slice(0, PROFILE_CONTENT_SEARCH_MAX))}
                    placeholder="Поиск"
                    inputProps={{ maxLength: PROFILE_CONTENT_SEARCH_MAX }}
                    sx={{
                      flex: 1,
                      '& .MuiInputBase-root': {
                        borderRadius: '12px',
                        minHeight: 38,
                        backgroundColor: 'var(--morius-elevated-bg)',
                      },
                    }}
                  />
                  <IconButton
                    onClick={handleOpenContentSortMenu}
                    disabled={activeContentSortOptions.length === 0}
                    title={activeContentSortLabel}
                    aria-label={activeContentSortLabel}
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '12px',
                      border:
                        !isActiveContentSortDefault || Boolean(contentSortMenuAnchorEl)
                          ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))'
                          : 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      '&:hover': {
                        backgroundColor:
                          activeContentSortOptions.length > 0
                            ? 'color-mix(in srgb, var(--morius-elevated-bg) 88%, var(--morius-card-bg) 12%)'
                            : 'var(--morius-elevated-bg)',
                      },
                    }}
                  >
                    <Box component="img" src={icons.profileSearchFilter} alt="" sx={{ width: 18, height: 10, opacity: 0.95 }} />
                  </IconButton>
                </Stack>
              </Box>

              <Stack spacing={1.3} sx={{ display: 'flex', mb: 1.4, width: '100%', minWidth: 0 }}>
                {tab === 'notifications' ? (
                  <>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2rem', fontWeight: 800, lineHeight: 1.02 }}>
                      Уведомления
                    </Typography>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Button
                      onClick={() => setTab('games')}
                      sx={{
                        minHeight: 34,
                        px: 1.2,
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        color: 'var(--morius-title-text)',
                        textTransform: 'none',
                        '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)' },
                      }}
                    >
                      Назад
                    </Button>
                    <Button
                      onClick={() => void markNotificationsRead()}
                      disabled={!notifications.some((item) => !item.is_read)}
                      sx={{
                        minHeight: 34,
                        px: 1.2,
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        color: 'var(--morius-title-text)',
                        textTransform: 'none',
                        '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)' },
                      }}
                    >
                      Отметить все прочитанными
                    </Button>
                  </Stack>
                  </>
                ) : (
                  <>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                      spacing={1}
                      sx={{
                        pb: 1.3,
                        borderBottom: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                      }}
                    >
                      {isOwnProfile ? (
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignSelf: { xs: 'flex-start', sm: 'center' },
                            p: 0.45,
                            borderRadius: '10px',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 84%, #000 16%)',
                          }}
                        >
                          {([
                            { id: 'library' as const, label: 'Библиотека' },
                            { id: 'publications' as const, label: 'Публикации' },
                          ]).map((item) => {
                            const isActive = profileMainSection === item.id
                            return (
                              <ButtonBase
                                key={`profile-main-section-${item.id}`}
                                onClick={() => setProfileMainSection(item.id)}
                                aria-pressed={isActive}
                                sx={{
                                  minHeight: 36,
                                  px: { xs: 1.6, sm: 2.2 },
                                  borderRadius: '7px',
                                  color: isActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                                  backgroundColor: isActive ? 'var(--morius-button-active)' : 'transparent',
                                  fontSize: '0.86rem',
                                  fontWeight: 800,
                                  lineHeight: 1,
                                  transition: 'background-color 160ms ease, color 160ms ease',
                                  '&:hover': {
                                    backgroundColor: isActive ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                                    color: 'var(--morius-title-text)',
                                  },
                                }}
                              >
                                {item.label}
                              </ButtonBase>
                            )
                          })}
                        </Box>
                      ) : (
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.45rem', fontWeight: 800, lineHeight: 1.05 }}>
                          Библиотека
                        </Typography>
                      )}

                      <Stack direction="row" spacing={1} alignItems="center" justifyContent={{ xs: 'space-between', sm: 'flex-end' }}>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          Показано {activeProfileItemCount.toLocaleString('ru-RU')}
                        </Typography>
                        <ButtonBase
                          onClick={handleOpenContentSortMenu}
                          disabled={activeContentSortOptions.length === 0}
                          aria-label={activeContentSortLabel}
                          sx={{
                            minHeight: 38,
                            px: 1.35,
                            borderRadius: '9px',
                            border:
                              !isActiveContentSortDefault || Boolean(contentSortMenuAnchorEl)
                                ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 56%, var(--morius-card-border))'
                                : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            color: activeContentSortOptions.length > 0 ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            gap: 0.8,
                            whiteSpace: 'nowrap',
                            '&:hover': {
                              backgroundColor:
                                activeContentSortOptions.length > 0
                                  ? 'var(--morius-button-hover)'
                                  : 'var(--morius-elevated-bg)',
                            },
                          }}
                        >
                          {activeContentSortLabel}
                          <Box component="img" src={icons.profileSearchFilter} alt="" sx={{ width: 12, height: 7, opacity: 0.85 }} />
                        </ButtonBase>
                      </Stack>
                    </Stack>

                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        pb: 1.3,
                        borderBottom: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                      }}
                    >
                      {(profileMainSection === 'publications' && isOwnProfile ? PROFILE_PUBLICATION_TABS : tabs).map((item) => {
                        const itemId = item.id
                        const iconTab = 'iconTab' in item ? item.iconTab : item.id
                        const isActive =
                          profileMainSection === 'publications' && isOwnProfile
                            ? publicationSection === itemId
                            : tab === itemId
                        const itemCount =
                          profileMainSection === 'publications' && isOwnProfile
                            ? itemId === 'worlds'
                              ? filteredProfilePublicationGames.length
                              : itemId === 'characters'
                                ? filteredProfilePublicationCharacters.length
                                : filteredProfilePublicationTemplates.length
                            : libraryTabCounts[itemId as TabId] ?? 0
                        return (
                          <ButtonBase
                            key={`profile-content-tab-${itemId}`}
                            onClick={() => {
                              if (profileMainSection === 'publications' && isOwnProfile) {
                                setPublicationSection(itemId as PublicationSection)
                              } else {
                                setProfileMainSection('library')
                                setTab(itemId as TabId)
                              }
                            }}
                            aria-pressed={isActive}
                            sx={{
                              minHeight: 40,
                              px: 1.55,
                              borderRadius: '9px',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: isActive ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                              color: isActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                              fontSize: '0.84rem',
                              fontWeight: 800,
                              gap: 0.65,
                              transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease',
                              '&:hover': {
                                backgroundColor: isActive ? 'var(--morius-button-active)' : 'var(--morius-button-hover)',
                                color: 'var(--morius-title-text)',
                              },
                            }}
                          >
                            {renderLibraryTabIcon(iconTab)}
                            <Box component="span">{item.label}</Box>
                            <Box
                              component="span"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minWidth: 20,
                                height: 20,
                                px: 0.5,
                                borderRadius: '999px',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                backgroundColor: isActive
                                  ? 'color-mix(in srgb, var(--morius-accent) 34%, transparent)'
                                  : 'color-mix(in srgb, var(--morius-card-bg) 72%, transparent)',
                                color: isActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                              }}
                            >
                              {itemCount}
                            </Box>
                          </ButtonBase>
                        )
                      })}
                    </Box>
                  </>
                )}
              </Stack>

              <Box
                key={`profile-tab-content-${profileMainSection}-${profileMainSection === 'publications' ? publicationSection : tab}`}
                sx={{
                  animation: 'moriusProfileTabEnter 220ms ease both',
                  '@keyframes moriusProfileTabEnter': {
                    '0%': { opacity: 0, transform: 'translateY(8px)' },
                    '100%': { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                {profileMainSection === 'publications' && isOwnProfile ? renderProfilePublications() : renderTabContent()}
              </Box>
            </Box>

            <Box
              sx={{
                display: 'none',
                p: 0,
                border: 'none',
                background: 'transparent',
                alignSelf: 'start',
              }}
            >
              <Stack spacing={1.35}>
                {isProfileShellBlocked
                  ? PROFILE_TAB_BUTTON_SKELETON_KEYS.map((itemKey) => (
                      <Skeleton
                        key={itemKey}
                        variant="rounded"
                        width="100%"
                        height={38}
                        sx={{ borderRadius: '10px', bgcolor: 'rgba(184, 201, 226, 0.18)' }}
                      />
                    ))
                  : profileSidebarItems.map((item) => (
                      <Button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        data-tour-id={
                          item.id === 'characters'
                            ? 'profile-tab-characters'
                            : item.id === 'instructions'
                              ? 'profile-tab-instructions'
                              : item.id === 'plots'
                                ? 'profile-tab-plots'
                                : undefined
                        }
                        sx={{
                          minHeight: 30,
                          justifyContent: 'space-between',
                          textTransform: 'none',
                          fontWeight: 700,
                          border: 'none',
                          borderRadius: 0,
                          backgroundColor: 'transparent',
                          color: tab === item.id ? 'var(--morius-accent)' : 'var(--morius-text-primary)',
                          px: 0,
                          '&:hover': {
                            backgroundColor: 'transparent',
                            color: 'var(--morius-accent)',
                          },
                        }}
                      >
                        <Box component="span">{item.label}</Box>
                        <Typography component="span" sx={{ color: tab === item.id ? 'var(--morius-accent)' : 'var(--morius-text-secondary)', fontSize: 'inherit', fontWeight: 700 }}>
                          {item.count}
                        </Typography>
                      </Button>
                    ))}

                {isOwnProfile ? (
                  <Box
                    sx={{
                      mt: 0.35,
                      p: 1.15,
                      borderRadius: '8px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, transparent)',
                    }}
                  >
                    <Stack spacing={0.9}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.94rem', fontWeight: 900 }}>
                          Пригласи друга
                        </Typography>
                        <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.78rem', fontWeight: 900 }}>
                          +500
                        </Typography>
                      </Stack>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                        Друг получит <SoulAmount amount="+500" iconSize={15} fontSize="0.78rem" /> после первой покупки, и ты тоже получишь <SoulAmount amount="+500" iconSize={15} fontSize="0.78rem" />.
                      </Typography>
                      {isReferralSummaryLoading && !referralSummary ? (
                        <Skeleton variant="rounded" height={34} sx={{ borderRadius: '8px', bgcolor: 'rgba(184, 201, 226, 0.16)' }} />
                      ) : (
                        <Button
                          onClick={() => void handleCopyReferralLink()}
                          disabled={!referralLink}
                          sx={{
                            minHeight: 34,
                            px: 1,
                            borderRadius: '8px',
                            justifyContent: 'flex-start',
                            gap: 0.75,
                            textTransform: 'none',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            color: 'var(--morius-text-primary)',
                            fontWeight: 800,
                            '&:hover': {
                              backgroundColor: 'var(--morius-button-hover)',
                            },
                          }}
                        >
                          <Box component="img" src={icons.communityShare} alt="" sx={{ width: 15, height: 15, flexShrink: 0 }} />
                          <Typography
                            component="span"
                            sx={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                            }}
                          >
                            {isReferralCopied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
                          </Typography>
                        </Button>
                      )}
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', lineHeight: 1.25 }}>
                        Оплаченных приглашений: {Math.max(0, referralSummary?.paid_referrals_count ?? 0)}
                      </Typography>
                      {referralError ? (
                        <Typography sx={{ color: 'var(--morius-danger, #ef6c6c)', fontSize: '0.74rem', lineHeight: 1.25 }}>
                          {referralError}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Box>
                ) : null}

                {profileSidebarSubscriptions.length > 0 ? (
                  <Stack spacing={0.8} sx={{ pt: 0.5 }}>
                    <Stack spacing={0.72}>
                      {profileSidebarSubscriptions.map((subscription) => (
                        <Button
                          key={`profile-sidebar-subscription-${subscription.id}`}
                          onClick={() => onNavigate(`/profile/${subscription.id}`)}
                          sx={{
                            justifyContent: 'flex-start',
                            gap: 0.72,
                            px: 0,
                            py: 0.08,
                            border: 'none',
                            borderRadius: 0,
                            backgroundColor: 'transparent',
                            textTransform: 'none',
                            color: 'var(--morius-text-primary)',
                            '&:hover': {
                              backgroundColor: 'transparent',
                              color: 'var(--morius-accent)',
                            },
                          }}
                        >
                          <ProgressiveAvatar
                            src={subscription.avatar_url}
                            fallbackLabel={subscription.display_name}
                            size={34}
                            priority
                            frameId={subscription.avatar_frame_id}
                            frameImageUrl={subscription.avatar_frame_image_url}
                          />
                          <Typography sx={{ fontSize: '0.88rem', textAlign: 'left', lineHeight: 1.2 }}>
                            {subscription.display_name}
                          </Typography>
                        </Button>
                      ))}
                    </Stack>
                  </Stack>
                ) : null}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Box>

      <Popover
        open={Boolean(notificationPopoverAnchorEl)}
        anchorEl={notificationPopoverAnchorEl}
        onClose={handleCloseNotificationPopover}
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 1,
            width: 310,
            maxWidth: 'calc(100vw - 24px)',
            p: 1,
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
            boxShadow: '0 18px 42px rgba(0, 0, 0, 0.38)',
          },
        }}
      >
        <Stack spacing={0.75}>
          {isNotificationsLoading && notifications.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={22} />
            </Stack>
          ) : notifications.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.85rem', px: 0.6, py: 1 }}>
              Уведомлений пока нет.
            </Typography>
          ) : (
            notifications.slice(0, 3).map((notification) => {
              const actorLabel = notification.actor_display_name?.trim() || 'MoRius'
              return (
                <Box
                  key={`notification-popover-${notification.id}`}
                  onClick={() => {
                    handleCloseNotificationPopover()
                    handleOpenNotification(notification)
                  }}
                  sx={{
                    position: 'relative',
                    p: 0.8,
                    borderRadius: '8px',
                    backgroundColor: notification.is_read ? 'var(--morius-elevated-bg)' : 'color-mix(in srgb, var(--morius-accent) 9%, var(--morius-elevated-bg))',
                    cursor: notification.action_url ? 'pointer' : 'default',
                    '&:hover': {
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)',
                    },
                  }}
                >
                  {!notification.is_read ? (
                    <Box sx={{ position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--morius-accent)' }} />
                  ) : null}
                  <Stack direction="row" spacing={0.75} alignItems="flex-start">
                    <ProgressiveAvatar
                      src={notification.actor_avatar_url}
                      alt={actorLabel}
                      fallbackLabel={actorLabel}
                      size={34}
                      priority={false}
                    />
                    <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem', lineHeight: 1.15 }}>
                        {actorLabel}
                      </Typography>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.84rem', fontWeight: 800, lineHeight: 1.2 }}>
                        {notification.title || 'Уведомление'}
                      </Typography>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-primary)',
                          fontSize: '0.78rem',
                          lineHeight: 1.25,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {notification.body || 'У вас новое уведомление.'}
                      </Typography>
                    </Stack>
                  </Stack>
                </Box>
              )
            })
          )}

          <Stack direction="row" spacing={0.7} alignItems="center">
            <Button
              onClick={handleOpenAllNotifications}
              sx={{
                flex: 1,
                minHeight: 34,
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                fontSize: '0.8rem',
                fontWeight: 700,
                '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)' },
              }}
            >
              Все уведомления
            </Button>
            <IconButton
              onClick={() => void markNotificationsRead()}
              disabled={!notifications.some((item) => !item.is_read)}
              aria-label="Отметить все прочитанными"
              sx={{
                width: 34,
                height: 34,
                borderRadius: '99px',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-title-text)',
                '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)' },
              }}
            >
              <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
                <path fill="currentColor" d="m9.2 16.6-4.1-4.1 1.4-1.4 2.7 2.7 8.3-8.3 1.4 1.4-9.7 9.7Z" />
              </SvgIcon>
            </IconButton>
          </Stack>
        </Stack>
      </Popover>

      <Dialog
        open={privacyDialogOpen}
        onClose={() => {
          if (!isSavingPrivacy) {
            setPrivacyDialogOpen(false)
          }
        }}
        fullWidth
        maxWidth="sm"
        sx={{
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(6, 12, 21, 0.72)',
            backdropFilter: 'blur(2px)',
          },
          '& .MuiDialog-paper': {
            borderRadius: '18px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 95%, #000 5%) 0%, var(--morius-card-bg) 100%)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 20px 52px rgba(0, 0, 0, 0.44)',
          },
          '& .MuiDialogTitle-root': {
            paddingBottom: 4,
            fontWeight: 800,
            letterSpacing: 0.2,
            color: 'var(--morius-title-text)',
          },
          '& .MuiDialogContent-root': {
            paddingTop: 6,
          },
          '& .MuiDialogActions-root': {
            paddingLeft: 18,
            paddingRight: 18,
            paddingTop: 8,
            paddingBottom: 14,
            gap: 6,
          },
          '& .MuiFormControlLabel-root': {
            margin: 0,
            padding: '4px 6px',
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
          },
          '& .MuiFormControlLabel-label': {
            color: 'var(--morius-text-primary)',
            fontWeight: 600,
          },
          '& .MuiSwitch-switchBase.Mui-checked': {
            color: 'var(--morius-title-text)',
          },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
            backgroundColor: 'var(--morius-accent)',
            opacity: 1,
          },
          '& .MuiSwitch-track': {
            backgroundColor: 'color-mix(in srgb, var(--morius-text-secondary) 48%, transparent)',
            opacity: 1,
          },
        }}
      >
        <DialogTitle>Настройки приватности</DialogTitle>
        <DialogContent>
          <Stack spacing={0.7} sx={{ pt: 0.6 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={privacyDraft.show_subscriptions}
                  onChange={(event) =>
                    setPrivacyDraft((previous) => ({
                      ...previous,
                      show_subscriptions: event.target.checked,
                    }))
                  }
                />
              }
              label="Показывать мои подписки"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={privacyDraft.show_public_worlds}
                  onChange={(event) =>
                    setPrivacyDraft((previous) => ({
                      ...previous,
                      show_public_worlds: event.target.checked,
                    }))
                  }
                />
              }
              label="Показывать опубликованные миры"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={privacyDraft.show_private_worlds}
                  onChange={(event) =>
                    setPrivacyDraft((previous) => ({
                      ...previous,
                      show_private_worlds: event.target.checked,
                    }))
                  }
                />
              }
              label="Показывать неопубликованные миры"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={privacyDraft.show_public_characters}
                  onChange={(event) =>
                    setPrivacyDraft((previous) => ({
                      ...previous,
                      show_public_characters: event.target.checked,
                    }))
                  }
                />
              }
              label="Показывать опубликованных персонажей"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={privacyDraft.show_public_instruction_templates}
                  onChange={(event) =>
                    setPrivacyDraft((previous) => ({
                      ...previous,
                      show_public_instruction_templates: event.target.checked,
                    }))
                  }
                />
              }
              label="Показывать опубликованные инструкции"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPrivacyDialogOpen(false)}
            disabled={isSavingPrivacy}
            sx={{
              minHeight: 38,
              px: 2.1,
              borderRadius: '999px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              color: 'var(--morius-text-secondary)',
              textTransform: 'none',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 92%, transparent)',
            }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSavePrivacy()}
            disabled={isSavingPrivacy}
            sx={{
              minHeight: 38,
              px: 2.3,
              borderRadius: '999px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-title-text)',
              textTransform: 'none',
              fontWeight: 700,
              '&:hover': {
                backgroundColor: 'transparent',
              },
            }}
          >
            {isSavingPrivacy ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={contentSortMenuAnchorEl}
        open={Boolean(contentSortMenuAnchorEl) && activeContentSortOptions.length > 0}
        onClose={handleCloseContentSortMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.45,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 208,
          },
        }}
      >
        {activeContentSortOptions.map((option) => {
          const isSelected = option.value === activeContentSortMode
          return (
            <MenuItem
              key={`profile-content-sort-${tab}-${option.value}`}
              onClick={() => handleSelectContentSortMode(option.value)}
              sx={{
                color: isSelected ? 'var(--morius-accent)' : 'rgba(220, 231, 245, 0.92)',
                fontSize: '0.9rem',
                fontWeight: isSelected ? 700 : 500,
              }}
            >
              {option.label}
            </MenuItem>
          )
        })}
      </Menu>

      <Menu
        anchorEl={mobileProfileMenuAnchorEl}
        open={Boolean(mobileProfileMenuAnchorEl)}
        onClose={handleCloseMobileProfileMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.45,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 188,
          },
        }}
      >
        {!isOwnProfile ? (
          <MenuItem
            onClick={() => {
              handleCloseMobileProfileMenu()
              void handleToggleFollow()
            }}
            disabled={isFollowSaving || !profileView}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isFollowSaving ? 'Обновление...' : profileView?.is_following ? 'Отписаться' : 'Подписаться'}
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              setProfileDialogOpen(true)
              handleCloseMobileProfileMenu()
            }}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            Настройки
          </MenuItem>
        )}

        {isOwnProfile && resolvedCanOpenAdmin ? (
          <MenuItem
            onClick={() => {
              handleCloseMobileProfileMenu()
              setAdminOpen(true)
            }}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            Админка
          </MenuItem>
        ) : null}

        {isOwnProfile ? (
          <MenuItem
            onClick={() => {
              setLogoutOpen(true)
              handleCloseMobileProfileMenu()
            }}
            sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
          >
            Выход
          </MenuItem>
        ) : null}
      </Menu>

      <Menu
        anchorEl={gameCardMenuAnchorEl}
        open={Boolean(gameCardMenuAnchorEl && selectedGameCardMenuItem)}
        onClose={handleCloseGameCardMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 180,
          },
        }}
      >
        <MenuItem
          onClick={handleEditGameCardFromMenu}
          disabled={!selectedGameCardMenuItem || gameCardMenuBusyAction !== null}
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          Редактировать
        </MenuItem>
        <MenuItem
          onClick={handleOpenCloneGameCardDialogFromMenu}
          disabled={!selectedGameCardMenuItem || gameCardMenuBusyAction !== null}
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          {gameCardMenuBusyAction === 'clone' ? 'Клонируем...' : 'Клонировать'}
        </MenuItem>
        <MenuItem
          onClick={() => void handleDeleteGameCardFromMenu()}
          disabled={!selectedGameCardMenuItem || gameCardMenuBusyAction !== null}
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          {gameCardMenuBusyAction === 'delete' ? 'Удаляем...' : 'Удалить'}
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(cloneDialogSourceGame)}
        onClose={handleCloseCloneGameCardDialog}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, color: 'var(--morius-text-primary)' }}>Клонировать мир</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25}>
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>
              {cloneDialogSourceGame
                ? `Выберите, что перенести в новый мир из «${(cloneDialogSourceGame.title || '').trim() || `Игра #${cloneDialogSourceGame.id}`}».`
                : 'Выберите, что нужно перенести в новый мир.'}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.85}>
              {CLONE_SECTION_ITEMS.map((item) => {
                const isSelected = cloneSelection[item.key]
                return (
                  <Button
                    key={item.key}
                    onClick={() => handleToggleCloneSection(item.key)}
                    disabled={gameCardMenuBusyAction === 'clone'}
                    sx={{
                      minHeight: 34,
                      px: 1.2,
                      borderRadius: '10px',
                      textTransform: 'none',
                      color: 'var(--morius-text-primary)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: isSelected ? 'var(--morius-button-active)' : 'var(--morius-card-bg)',
                      '&:hover': {
                        backgroundColor: 'var(--morius-button-hover)',
                      },
                    }}
                  >
                    <Stack direction="row" spacing={0.65} alignItems="center">
                      <Box component="span" sx={{ fontSize: '0.9rem', lineHeight: 1 }}>
                        {isSelected ? String.fromCharCode(10003) : String.fromCharCode(9711)}
                      </Box>
                      <Box component="span">{item.label}</Box>
                    </Stack>
                  </Button>
                )
              })}
            </Stack>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
              Пункты можно выбрать или оставить пустыми.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={handleCloseCloneGameCardDialog}
            disabled={gameCardMenuBusyAction === 'clone'}
            sx={{ color: 'var(--morius-text-secondary)', textTransform: 'none' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmitCloneGameCard()}
            disabled={gameCardMenuBusyAction === 'clone'}
            sx={{
              textTransform: 'none',
              color: 'var(--morius-text-primary)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {gameCardMenuBusyAction === 'clone' ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : (
              'Клонировать'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={contentCardMenuAnchorEl}
        open={Boolean(contentCardMenuAnchorEl && (selectedContentCharacterMenuItem || selectedContentInstructionMenuItem))}
        onClose={handleCloseContentCardMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 176,
          },
        }}
      >
        <MenuItem
          onClick={handleEditContentCardFromMenu}
          disabled={!selectedContentCharacterMenuItem && !selectedContentInstructionMenuItem}
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>✎</Box>
            <Box component="span">Редактировать</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={() => void handleDeleteContentCardFromMenu()}
          disabled={!selectedContentCharacterMenuItem && !selectedContentInstructionMenuItem}
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>⌦</Box>
            <Box component="span">Удалить</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(characterAvatarPreview)}
        onClose={handleCloseCharacterAvatarPreview}
        fullWidth={false}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 'min(96vw, 1600px)',
            maxWidth: 'none',
            maxHeight: '96vh',
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent
          sx={{
            px: 1,
            pt: 0.8,
            pb: 0.5,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            overflow: 'auto',
          }}
        >
          {characterAvatarPreview ? (
            <ProgressiveImage
              src={resolveApiResourceUrl(characterAvatarPreview.url) ?? characterAvatarPreview.url}
              alt={characterAvatarPreview.name || 'Character avatar'}
              loading="eager"
              fetchPriority="high"
              objectFit="contain"
              loaderSize={32}
              containerSx={{
                width: 'fit-content',
                maxWidth: '100%',
                minHeight: 240,
                borderRadius: '10px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
              }}
              imgSx={{
                position: 'relative',
                width: 'auto',
                height: 'auto',
                maxWidth: 'min(92vw, 1500px)',
                maxHeight: 'min(84vh, 1800px)',
              }}
            />
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 1.2, pb: 1.2 }}>
          <Button onClick={handleCloseCharacterAvatarPreview} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(galleryPreviewImage)}
        onClose={handleCloseGalleryPreview}
        fullWidth={false}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 'auto',
            maxWidth: '96vw',
            maxHeight: '96vh',
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent
          sx={{
            px: 1,
            pt: 0.8,
            pb: 0.5,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            overflow: 'auto',
          }}
        >
          {galleryPreviewImage
            ? (() => {
                const rawImageUrl = (galleryPreviewImage.image_data_url ?? galleryPreviewImage.image_url ?? '').trim()
                const imageUrl = resolveApiResourceUrl(rawImageUrl) ?? rawImageUrl
                return (
                  <ProgressiveImage
                    src={imageUrl}
                    alt="Gallery image"
                    loading="eager"
                    fetchPriority="high"
                    objectFit="contain"
                    loaderSize={32}
                    containerSx={{
                      width: 'fit-content',
                      maxWidth: '100%',
                      minHeight: 240,
                      borderRadius: '10px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                    }}
                    imgSx={{
                      position: 'relative',
                      width: 'auto',
                      height: 'auto',
                      maxWidth: 'min(92vw, 1500px)',
                      maxHeight: '82vh',
                      objectFit: 'contain',
                    }}
                  />
                )
              })()
            : null}
        </DialogContent>
        <DialogActions sx={{ px: 1.2, pb: 1.2, gap: 0.8 }}>
          {galleryPreviewImage && isOwnProfile ? (
            <Button
              onClick={(event) => void handleDeleteGalleryImage(galleryPreviewImage.id, event)}
              disabled={deletingGalleryImageIds.has(galleryPreviewImage.id)}
              sx={{
                color: 'rgba(248, 176, 176, 0.96)',
                '&.Mui-disabled': { color: 'rgba(248, 176, 176, 0.46)' },
              }}
            >
              {deletingGalleryImageIds.has(galleryPreviewImage.id) ? 'Удаляем...' : 'Удалить'}
            </Button>
          ) : null}
          <Button onClick={handleCloseGalleryPreview} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void handleAvatarChange(event)}
        style={{ display: 'none' }}
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
        onSave={(dataUrl) => void saveCroppedAvatar(dataUrl)}
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

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        referralBonusCoins={paymentReferralBonusCoins}
        onClose={() => {
          setPaymentSuccessCoins(null)
          setPaymentReferralBonusCoins(0)
        }}
      />

      <AppDownloadDialog
        open={appDownloadDialogOpen}
        onClose={() => setAppDownloadDialogOpen(false)}
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
        onClose={handleCloseProfileDialog}
        onChooseAvatar={handleChooseAvatar}
        onAvatarChange={handleAvatarChange}
        onOpenTopUp={handleOpenTopUpDialog}
        onOpenCharacterManager={() => {
          handleCloseProfileDialog()
          setCharacterDialogMode('list')
          setCharacterEditId(null)
          setCharacterDialogOpen(true)
        }}
        onOpenInstructionTemplates={() => {
          handleCloseProfileDialog()
          setInstructionDialogMode('list')
          setInstructionEditId(null)
          setInstructionDialogOpen(true)
        }}
        onRequestLogout={() => setLogoutOpen(true)}
        onUpdateProfileName={handleUpdateProfileName}
        onUserUpdate={handleProfileDialogUserUpdate}
      />

      <CharacterManagerDialog
        open={characterDialogOpen}
        authToken={authToken}
        initialMode={characterDialogMode}
        initialCharacterId={characterEditId}
        includePublicationCopies
        showEmotionTools={user.role === 'administrator'}
        onClose={closeCharacterDialog}
      />

      <InstructionTemplateDialog
        open={instructionDialogOpen}
        authToken={authToken}
        mode="manage"
        initialMode={instructionDialogMode}
        initialTemplateId={instructionEditId}
        includePublicationCopies
        onClose={closeInstructionDialog}
      />

      <ConfirmLogoutDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={handleConfirmLogout}
      />

      <AdminPanelDialog
        open={adminOpen}
        authToken={authToken}
        currentUserRole={user.role}
        onNavigate={onNavigate}
        onClose={() => setAdminOpen(false)}
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

export default ProfilePage
