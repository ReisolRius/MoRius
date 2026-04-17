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
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
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
import HeaderAccountActions from '../components/HeaderAccountActions'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import ProgressiveImage from '../components/media/ProgressiveImage'
import { useIncrementalList } from '../hooks/useIncrementalList'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import { useVisibilityTrigger } from '../hooks/useVisibilityTrigger'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import AdminPanelDialog from '../components/profile/AdminPanelDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TextLimitIndicator from '../components/TextLimitIndicator'
import TopUpDialog from '../components/profile/TopUpDialog'
import UserAvatar from '../components/profile/UserAvatar'
import Footer from '../components/Footer'
import { ONBOARDING_GUIDE_COMMAND_EVENT, type OnboardingGuideCommandDetail } from '../utils/onboardingGuide'
import { buildUnifiedMobileQuickActions } from '../utils/mobileQuickActions'
import {
  createCoinTopUpPayment,
  deleteCurrentUserNotification,
  followUserProfile,
  getCurrentUserNotificationSummary,
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
  type ProfileFollowState,
  type ProfileView,
  type UserNotificationCounters,
  type UserNotification,
} from '../services/authApi'
import {
  deleteStoryCharacter,
  deleteStoryInstructionTemplate,
  favoriteCommunityWorld,
  listFavoriteCommunityWorlds,
  listStoryCharacters,
  listStoryInstructionTemplates,
  unfavoriteCommunityWorld,
} from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type {
  StoryCharacter,
  StoryCommunityWorldSummary,
  StoryGameSummary,
  StoryInstructionTemplate,
} from '../types/story'
import { moriusThemeTokens } from '../theme'
import { resolveApiResourceUrl } from '../services/httpClient'
import { dispatchNotificationsChanged } from '../utils/notifications'

type ProfilePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  viewedUserId?: number | null
}

type TabId = 'characters' | 'instructions' | 'favorites' | 'notifications' | 'plots' | 'subscriptions' | 'publications'
type NotificationSortMode = 'newest' | 'oldest'
type ProfileContentSortMode = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'popular_desc' | 'rating_desc'

const PROFILE_NAME_MAX = 25
const PROFILE_DESC_MAX = 2000
const PROFILE_CONTENT_SEARCH_MAX = 120
const PROFILE_CARD_BATCH_SIZE = 12
const PROFILE_NOTIFICATION_PAGE_SIZE = 12
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const PROFILE_AVATAR_SIZE = 96
const CARD_MIN_HEIGHT = 174
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const PROFILE_CONTENT_SKELETON_CARD_KEYS = Array.from({ length: 4 }, (_, index) => `profile-content-skeleton-${index}`)
const PROFILE_TAB_BUTTON_SKELETON_KEYS = Array.from({ length: 6 }, (_, index) => `profile-tab-skeleton-${index}`)

const BASE_PROFILE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'characters', label: 'Персонажи' },
  { id: 'instructions', label: 'Инструкции' },
  { id: 'favorites', label: 'Любимые миры' },
  { id: 'plots', label: 'Сюжеты' },
  { id: 'subscriptions', label: 'Подписки' },
  { id: 'publications', label: 'Публикации' },
]

const PROFILE_TAB_LABELS: Record<Exclude<TabId, 'notifications'>, string> = {
  publications: 'Публикации',
  characters: 'Персонажи',
  instructions: 'Инструкции',
  favorites: 'Любимое',
  plots: 'Сюжеты',
  subscriptions: 'Подписки',
}

const PROFILE_NOTIFICATIONS_LABEL = 'Уведомления'
const NOTIFICATIONS_TAB = { id: 'notifications' as const, label: PROFILE_NOTIFICATIONS_LABEL }
const NOTIFICATION_SORT_OPTIONS: Array<{ value: NotificationSortMode; label: string }> = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
]

const PROFILE_SORT_COLLATOR = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true })

const PROFILE_TAB_SORT_OPTIONS: Partial<Record<TabId, Array<{ value: string; label: string }>>> = {
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
  characters: 'updated_desc',
  instructions: 'updated_desc',
  favorites: 'popular_desc',
  publications: 'popular_desc',
  subscriptions: 'name_asc',
}

type ProfileSortableCommunityCard = Pick<
  StoryCharacter,
  'id' | 'updated_at' | 'name' | 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableTemplateCard = Pick<
  StoryInstructionTemplate,
  'id' | 'updated_at' | 'title' | 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableWorldCard = Pick<
  StoryCommunityWorldSummary,
  'id' | 'title' | 'created_at' | 'updated_at' | 'community_launches' | 'community_views' | 'community_rating_avg' | 'community_rating_count'
>

type ProfileSortableSubscription = Pick<ProfileView['subscriptions'][number], 'id' | 'display_name'>

function compareProfileText(left: string, right: string): number {
  return PROFILE_SORT_COLLATOR.compare(left.trim(), right.trim())
}

function compareProfilePopularity(
  left: Pick<ProfileSortableCommunityCard | ProfileSortableTemplateCard, 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'>,
  right: Pick<ProfileSortableCommunityCard | ProfileSortableTemplateCard, 'community_additions_count' | 'community_rating_avg' | 'community_rating_count'>,
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

function sortProfileCharacters(items: StoryCharacter[], mode: ProfileContentSortMode): StoryCharacter[] {
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
    if (mode === 'popular_desc') {
      return compareProfilePopularity(left, right) || parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
    }
    return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
  })
}

function sortProfileTemplates(items: StoryInstructionTemplate[], mode: ProfileContentSortMode): StoryInstructionTemplate[] {
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
  },
): StoryCommunityWorldSummary {
  return {
    id: game.id,
    title: (game.title || '').trim() || 'Без названия',
    description: (game.description || '').trim() || 'Описание пока не добавлено.',
    author_id: payload.authorId,
    author_name: payload.authorName,
    author_avatar_url: payload.authorAvatarUrl,
    age_rating: game.age_rating,
    genres: game.genres,
    cover_image_url: game.cover_image_url,
    cover_scale: game.cover_scale,
    cover_position_x: game.cover_position_x,
    cover_position_y: game.cover_position_y,
    community_views: game.community_views,
    community_launches: game.community_launches,
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
    avatar_url: profileUser.avatar_url,
    avatar_scale: profileUser.avatar_scale,
    auth_provider: 'email',
    role: 'user',
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
  const [tab, setTab] = useState<TabId>('characters')
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSortMenuAnchorEl, setContentSortMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [contentSortModeByTab, setContentSortModeByTab] = useState<Partial<Record<TabId, ProfileContentSortMode>>>(
    PROFILE_TAB_DEFAULT_SORT_MODE,
  )
  const [mobileProfileMenuAnchorEl, setMobileProfileMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [isDescExpanded, setIsDescExpanded] = useState(false)
  const deferredContentSearchQuery = useDeferredValue(contentSearchQuery)

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
  })

  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [templates, setTemplates] = useState<StoryInstructionTemplate[]>([])
  const [favoriteWorlds, setFavoriteWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [hasLoadedFavoriteWorlds, setHasLoadedFavoriteWorlds] = useState(false)
  const [isFavoriteWorldsLoading, setIsFavoriteWorldsLoading] = useState(false)
  const [favoriteLoadingById, setFavoriteLoadingById] = useState<Record<number, boolean>>({})
  const [notifications, setNotifications] = useState<UserNotification[]>([])
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
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [instructionDialogMode, setInstructionDialogMode] = useState<'list' | 'create'>('list')
  const [instructionEditId, setInstructionEditId] = useState<number | null>(null)
  const [contentCardMenuAnchorEl, setContentCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [contentCardMenuType, setContentCardMenuType] = useState<'character' | 'instruction' | null>(null)
  const [contentCardMenuItemId, setContentCardMenuItemId] = useState<number | null>(null)

  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)

  const [error, setError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const lastContentTabRef = useRef<TabId>('characters')
  const notificationsLoadMoreTriggeredRef = useRef(false)

  const profileName = user.display_name?.trim() || 'Игрок'
  const profileDescription = user.profile_description || ''
  const coins = Math.max(0, Math.trunc(user.coins || 0))
  const canOpenAdmin = user.role === 'administrator' || user.role === 'moderator'
  const isProfileNarrowMobile = useMediaQuery('(max-width:550px)')

  const fallbackOwnProfileUser = {
    id: user.id,
    display_name: profileName,
    profile_description: profileDescription,
    avatar_url: user.avatar_url,
    avatar_scale: user.avatar_scale ?? 1,
    created_at: user.created_at,
  }
  const fallbackViewedProfileUser = {
    id: normalizedViewedUserId ?? 0,
    display_name: '',
    profile_description: '',
    avatar_url: null,
    avatar_scale: 1,
    created_at: user.created_at,
  }
  const resolvedProfileUser = profileView?.user ?? (isOwnProfile ? fallbackOwnProfileUser : fallbackViewedProfileUser)
  const resolvedProfileName = resolvedProfileUser.display_name?.trim() || (isOwnProfile ? profileName : 'Игрок')
  const resolvedProfileDescription = resolvedProfileUser.profile_description || ''
  const resolvedAvatarUser = isOwnProfile ? user : toAvatarUser(resolvedProfileUser)
  const resolvedCanOpenAdmin = isOwnProfile && canOpenAdmin
  const followersCount = Math.max(0, profileView?.followers_count ?? 0)
  const subscriptionsCount = Math.max(0, profileView?.subscriptions_count ?? 0)
  const canViewSubscriptions = Boolean(profileView?.can_view_subscriptions)
  const canViewPublicWorlds = Boolean(profileView?.can_view_public_worlds)
  const canViewPrivateWorlds = Boolean(profileView?.can_view_private_worlds)
  const visiblePublicationWorlds = profileView?.published_worlds ?? []
  const visibleUnpublishedWorlds = useMemo(
    () =>
      (profileView?.unpublished_worlds ?? []).map((game) =>
        toPublicationWorld(game, {
          authorId: resolvedProfileUser.id,
          authorName: resolvedProfileName,
          authorAvatarUrl: resolvedProfileUser.avatar_url,
        }),
      ),
    [profileView, resolvedProfileName, resolvedProfileUser.avatar_url, resolvedProfileUser.id],
  )
  const visibleSubscriptions = profileView?.subscriptions ?? []
  const isProfileBootstrapLoading = isProfileViewLoading
  const isCurrentTabContentLoading =
    (tab === 'characters' && isOwnProfile && isLoadingContent && characters.length === 0) ||
    (tab === 'instructions' && isOwnProfile && isLoadingContent && templates.length === 0) ||
    (tab === 'favorites' && isOwnProfile && isFavoriteWorldsLoading && !hasLoadedFavoriteWorlds) ||
    (tab === 'notifications' && isOwnProfile && isNotificationsLoading && !hasLoadedNotifications)
  const tabs = useMemo(() => {
    const subscriptionsLabel = `${isOwnProfile ? 'Мои подписки' : 'Подписки'} (${subscriptionsCount})`
    if (isOwnProfile) {
      const ownTabs = BASE_PROFILE_TABS.map((item) =>
        item.id === 'subscriptions'
          ? {
              ...item,
              label: subscriptionsLabel,
            }
          : item,
      )
      ownTabs.splice(3, 0, NOTIFICATIONS_TAB)
      return ownTabs
    }
    return [
      { id: 'subscriptions' as TabId, label: subscriptionsLabel },
      { id: 'publications' as TabId, label: 'Публикации' },
    ]
  }, [isOwnProfile, subscriptionsCount])

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
  const normalizedContentSearchQuery = useMemo(
    () => normalizeProfileSearchValue(deferredContentSearchQuery),
    [deferredContentSearchQuery],
  )
  const characterSortMode = contentSortModeByTab.characters ?? PROFILE_TAB_DEFAULT_SORT_MODE.characters ?? 'updated_desc'
  const instructionSortMode = contentSortModeByTab.instructions ?? PROFILE_TAB_DEFAULT_SORT_MODE.instructions ?? 'updated_desc'
  const favoriteSortMode = contentSortModeByTab.favorites ?? PROFILE_TAB_DEFAULT_SORT_MODE.favorites ?? 'popular_desc'
  const publicationSortMode = contentSortModeByTab.publications ?? PROFILE_TAB_DEFAULT_SORT_MODE.publications ?? 'popular_desc'
  const subscriptionSortMode = contentSortModeByTab.subscriptions ?? PROFILE_TAB_DEFAULT_SORT_MODE.subscriptions ?? 'name_asc'
  const activeContentSortOptions = useMemo(
    () => (tab === 'notifications' ? NOTIFICATION_SORT_OPTIONS : PROFILE_TAB_SORT_OPTIONS[tab] ?? []),
    [tab],
  )
  const activeContentSortMode = tab === 'notifications'
    ? notificationSortMode
    : contentSortModeByTab[tab] ?? PROFILE_TAB_DEFAULT_SORT_MODE[tab] ?? ''
  const activeContentSortLabel = useMemo(
    () => activeContentSortOptions.find((option) => option.value === activeContentSortMode)?.label ?? 'Сортировка',
    [activeContentSortMode, activeContentSortOptions],
  )
  const isActiveContentSortDefault = activeContentSortMode === (tab === 'notifications' ? 'newest' : PROFILE_TAB_DEFAULT_SORT_MODE[tab] ?? '')
  const filteredCharacters = useMemo(
    () =>
      sortProfileCharacters(
        sortedCharacters.filter((item) =>
          matchesProfileSearch(normalizedContentSearchQuery, [
            item.name,
            item.race,
            item.description,
            item.clothing,
            item.inventory,
            item.health_status,
            item.note,
            item.triggers.join(' '),
          ]),
        ),
        characterSortMode,
      ),
    [characterSortMode, normalizedContentSearchQuery, sortedCharacters],
  )
  const filteredTemplates = useMemo(
    () =>
      sortProfileTemplates(
        sortedTemplates.filter((item) => matchesProfileSearch(normalizedContentSearchQuery, [item.title, item.content])),
        instructionSortMode,
      ),
    [instructionSortMode, normalizedContentSearchQuery, sortedTemplates],
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
  const {
    visibleItems: visibleCharacters,
    hasMore: hasMoreCharacters,
    loadMoreRef: loadMoreCharactersRef,
  } = useIncrementalList(filteredCharacters, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|characters|${filteredCharacters.length}`,
  })
  const {
    visibleItems: visibleTemplates,
    hasMore: hasMoreTemplates,
    loadMoreRef: loadMoreTemplatesRef,
  } = useIncrementalList(filteredTemplates, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|instructions|${filteredTemplates.length}`,
  })
  const {
    visibleItems: visibleFavoriteWorlds,
    hasMore: hasMoreFavoriteWorlds,
    loadMoreRef: loadMoreFavoriteWorldsRef,
  } = useIncrementalList(filteredFavoriteWorlds, {
    initialCount: PROFILE_CARD_BATCH_SIZE,
    step: PROFILE_CARD_BATCH_SIZE,
    resetKey: `${normalizedContentSearchQuery}|favorites|${filteredFavoriteWorlds.length}`,
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
    ref: loadMoreNotificationsRef,
    isVisible: isLoadMoreNotificationsVisible,
  } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin: '140px 0px',
    once: false,
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
  const activeContentHeading = tab === 'notifications' ? PROFILE_NOTIFICATIONS_LABEL : PROFILE_TAB_LABELS[tab]
  const profileSidebarItems = useMemo(() => {
    const items: Array<{ id: TabId; label: string; count: number }> = [
      {
        id: 'publications',
        label: PROFILE_TAB_LABELS.publications,
        count: visiblePublicationWorlds.length + (isOwnProfile && canViewPrivateWorlds ? visibleUnpublishedWorlds.length : 0),
      },
    ]
    if (isOwnProfile) {
      items.push(
        { id: 'characters', label: PROFILE_TAB_LABELS.characters, count: managedCharacters.length },
        { id: 'instructions', label: PROFILE_TAB_LABELS.instructions, count: sortedTemplates.length },
        { id: 'favorites', label: PROFILE_TAB_LABELS.favorites, count: favoriteWorlds.length },
        { id: 'notifications', label: PROFILE_NOTIFICATIONS_LABEL, count: notificationCounts.total_count },
      )
    }
    items.push({ id: 'subscriptions', label: PROFILE_TAB_LABELS.subscriptions, count: subscriptionsCount })
    return items
  }, [
    canViewPrivateWorlds,
    favoriteWorlds.length,
    isOwnProfile,
    managedCharacters.length,
    notificationCounts.total_count,
    sortedTemplates.length,
    subscriptionsCount,
    visiblePublicationWorlds.length,
    visibleUnpublishedWorlds.length,
  ])
  const profileSidebarSubscriptions = useMemo(() => visibleSubscriptions.slice(0, 6), [visibleSubscriptions])
  const mobileContentTabs = useMemo(
    () => [
      { id: 'publications' as TabId, label: 'Миры' },
      { id: 'instructions' as TabId, label: 'Инструкции' },
      { id: 'characters' as TabId, label: 'Персонажи' },
      { id: 'plots' as TabId, label: 'Сюжеты' },
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
      return
    }
    setError('')
    setIsLoadingContent(true)
    try {
      const loadedCharacters = await listStoryCharacters(authToken)
      setCharacters(loadedCharacters)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить персонажей'
      setCharacters([])
      setError(detail)
    } finally {
      setIsLoadingContent(false)
    }
  }, [authToken, isOwnProfile])

  const loadTemplatesOnly = useCallback(async () => {
    if (!isOwnProfile) {
      setTemplates([])
      return
    }
    setError('')
    setIsLoadingContent(true)
    try {
      const loadedTemplates = await listStoryInstructionTemplates(authToken)
      setTemplates(loadedTemplates)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить инструкции'
      setTemplates([])
      setError(detail)
    } finally {
      setIsLoadingContent(false)
    }
  }, [authToken, isOwnProfile])

  const loadProfileContent = useCallback(async () => {
    if (!isOwnProfile) {
      setCharacters([])
      setTemplates([])
      setFavoriteWorlds([])
      setHasLoadedFavoriteWorlds(false)
      setIsLoadingContent(false)
      setIsFavoriteWorldsLoading(false)
      return
    }

    setError('')
    setIsLoadingContent(true)
    setIsFavoriteWorldsLoading(true)

    const [charactersResult, templatesResult, favoritesResult] = await Promise.allSettled([
      listStoryCharacters(authToken),
      listStoryInstructionTemplates(authToken),
      listFavoriteCommunityWorlds(authToken),
    ])

    const nextErrors: string[] = []

    if (charactersResult.status === 'fulfilled') {
      setCharacters(charactersResult.value)
    } else {
      setCharacters([])
      nextErrors.push(
        charactersResult.reason instanceof Error
          ? charactersResult.reason.message
          : 'Не удалось загрузить персонажей',
      )
    }

    if (templatesResult.status === 'fulfilled') {
      setTemplates(templatesResult.value)
    } else {
      setTemplates([])
      nextErrors.push(
        templatesResult.reason instanceof Error
          ? templatesResult.reason.message
          : 'Не удалось загрузить инструкции',
      )
    }

    if (favoritesResult.status === 'fulfilled') {
      setFavoriteWorlds(favoritesResult.value)
      setHasLoadedFavoriteWorlds(true)
    } else {
      setFavoriteWorlds([])
      setHasLoadedFavoriteWorlds(false)
      nextErrors.push(
        favoritesResult.reason instanceof Error
          ? favoritesResult.reason.message
          : 'Не удалось загрузить любимые миры',
      )
    }

    setError(nextErrors[0] ?? '')
    setIsLoadingContent(false)
    setIsFavoriteWorldsLoading(false)
  }, [authToken, isOwnProfile])

  const loadFavoriteWorlds = useCallback(async () => {
    if (!isOwnProfile) {
      setFavoriteWorlds([])
      setHasLoadedFavoriteWorlds(false)
      return
    }

    setIsFavoriteWorldsLoading(true)
    setError('')
    try {
      const loadedFavorites = await listFavoriteCommunityWorlds(authToken)
      setFavoriteWorlds(loadedFavorites)
      setHasLoadedFavoriteWorlds(true)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить любимые миры'
      setError(detail)
    } finally {
      setIsFavoriteWorldsLoading(false)
    }
  }, [authToken, isOwnProfile])
  void loadFavoriteWorlds

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

  const loadProfileView = useCallback(async () => {
    setIsProfileViewLoading(true)
    setError('')
    try {
      const response = await getProfileView({
        token: authToken,
        user_id: normalizedViewedUserId,
      })
      setProfileView(response)
      setPrivacyDraft({
        show_subscriptions: response.privacy.show_subscriptions,
        show_public_worlds: response.privacy.show_public_worlds,
        show_private_worlds: response.privacy.show_private_worlds,
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
    setFavoriteWorlds([])
    setHasLoadedFavoriteWorlds(false)
    setNotifications([])
    setNotificationCounts({ unread_count: 0, total_count: 0 })
    setHasLoadedNotifications(false)
    setHasMoreNotificationsServer(false)
    setIsNotificationsLoadingMore(false)
    notificationsLoadMoreTriggeredRef.current = false
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
    if (!tabs.some((item) => item.id === tab)) {
      setTab(tabs[0].id)
    }
  }, [tab, tabs])

  useEffect(() => {
    setContentSortMenuAnchorEl(null)
  }, [tab])

  useEffect(() => {
    setMobileProfileMenuAnchorEl(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'favorites' && tab !== 'notifications' && tab !== 'subscriptions') {
      lastContentTabRef.current = tab
    }
  }, [tab])

  useEffect(() => {
    if (tab !== 'notifications' || !hasLoadedNotifications || isNotificationsLoading) {
      return
    }
    void markNotificationsRead()
  }, [hasLoadedNotifications, isNotificationsLoading, markNotificationsRead, tab])

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
    notificationsLoadMoreTriggeredRef.current = false
  }, [isOwnProfile, notificationSortMode])

  useEffect(() => {
    if (!isLoadMoreNotificationsVisible) {
      notificationsLoadMoreTriggeredRef.current = false
      return
    }
    if (
      notificationsLoadMoreTriggeredRef.current ||
      !hasLoadedNotifications ||
      !hasMoreNotificationsServer ||
      isNotificationsLoading ||
      isNotificationsLoadingMore ||
      tab !== 'notifications'
    ) {
      return
    }
    notificationsLoadMoreTriggeredRef.current = true
    void loadNotifications({ append: true })
  }, [
    hasLoadedNotifications,
    hasMoreNotificationsServer,
    isLoadMoreNotificationsVisible,
    isNotificationsLoading,
    isNotificationsLoadingMore,
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

  const handleOpenTopUpDialog = useCallback(() => {
    setProfileDialogOpen(false)
    setLogoutOpen(false)
    setTopUpError('')
    setTopUpDialogOpen(true)
  }, [])

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
    [authToken, onUserUpdate],
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

  const handleOpenPrivacyDialog = useCallback(() => {
    if (!isOwnProfile || !profileView) {
      return
    }
    setPrivacyDraft({
      show_subscriptions: profileView.privacy.show_subscriptions,
      show_public_worlds: profileView.privacy.show_public_worlds,
      show_private_worlds: profileView.privacy.show_private_worlds,
    })
    setPrivacyDialogOpen(true)
  }, [isOwnProfile, profileView])

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
      if (tab === 'notifications') {
        setNotificationSortMode(nextValue as NotificationSortMode)
      } else {
        setContentSortModeByTab((previous) => ({
          ...previous,
          [tab]: nextValue as ProfileContentSortMode,
        }))
      }
      setContentSortMenuAnchorEl(null)
    },
    [tab],
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

  const handleCloseCharacterAvatarPreview = useCallback(() => {
    setCharacterAvatarPreview(null)
  }, [])

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
                        overflow: 'hidden',
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
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
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
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
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
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
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
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
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

  const renderTabContent = () => {
    if (isProfileBootstrapLoading || isCurrentTabContentLoading) {
      return (
        <Stack spacing={1.05} sx={{ py: 0.4 }}>
          <Skeleton variant="text" width={220} height={34} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {PROFILE_CONTENT_SKELETON_CARD_KEYS.map((cardKey) => (
              <CommunityWorldCardSkeleton key={cardKey} />
            ))}
          </Box>
        </Stack>
      )
    }

    if (tab === 'characters') {
      if (!isOwnProfile) {
        return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Раздел доступен только владельцу профиля.</Typography>
      }
      return renderCharacters()
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
        onOpenTopUpDialog={handleOpenTopUpDialog}
        hideRightToggle
        rightActions={<Box sx={{ display: { xs: 'none', md: 'block' } }}><HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} /></Box>}
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 },
          px: { xs: 1.2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
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
            <Stack spacing={1.2} sx={{ display: isProfileBootstrapLoading ? 'flex' : 'none' }}>
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
                  {coins.toLocaleString('ru-RU')} солов
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
                  Солы: {coins.toLocaleString('ru-RU')}
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
                    overflow: 'hidden',
                    cursor: isOwnProfile && !isAvatarSaving ? 'pointer' : 'default',
                    flexShrink: 0,
                    mx: isProfileNarrowMobile ? 'auto' : 0,
                    '&:hover .morius-profile-avatar-overlay': {
                      opacity: isOwnProfile && !isAvatarSaving ? 1 : 0,
                    },
                  }}
                >
                  <UserAvatar user={resolvedAvatarUser} size={PROFILE_AVATAR_SIZE} />
                  <Box
                    className="morius-profile-avatar-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
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
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  {resolvedCanOpenAdmin ? 'Админка' : (isEditing ? 'Свернуть редактор' : 'Редактировать профиль')}
                </Button>

                <Button
                  onClick={() => handleOpenPrivacyDialog()}
                  sx={{
                    display: isOwnProfile ? 'inline-flex' : 'none',
                    minHeight: 34,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  Приватность
                </Button>

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
                    border: 'var(--morius-border-width) solid rgba(228, 120, 120, 0.44)',
                    color: 'rgba(251, 190, 190, 0.92)',
                    textTransform: 'none',
                    '&:hover': {
                      borderColor: 'rgba(238, 148, 148, 0.72)',
                      backgroundColor: 'rgba(214, 86, 86, 0.14)',
                    },
                  }}
                >
                  Выйти
                </Button>
              </Stack>
            </Stack>

            <Box sx={{ display: isProfileBootstrapLoading ? 'none' : undefined }}>
              <Stack spacing={{ xs: 1.2, md: 1.45 }}>
                <Stack
                  direction={{ xs: 'column', lg: 'row' }}
                  justifyContent="space-between"
                  spacing={{ xs: 1.25, lg: 2.2 }}
                  alignItems={{ xs: 'stretch', lg: 'flex-start' }}
                  sx={{ minWidth: 0 }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 1, md: 1.35 }}
                    alignItems={{ xs: (isEditing && isOwnProfile) ? 'stretch' : 'center', sm: 'flex-start' }}
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
                        width: 112,
                        height: 112,
                        borderRadius: '50%',
                        overflow: 'hidden',
                        cursor: isOwnProfile && !isAvatarSaving ? 'pointer' : 'default',
                        flexShrink: 0,
                        mx: { xs: 'auto', sm: 0 },
                        boxShadow: '0 0 0 1px color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                        '&:hover .morius-profile-avatar-overlay': {
                          opacity: isOwnProfile && !isAvatarSaving ? 1 : 0,
                        },
                      }}
                    >
                      <UserAvatar user={resolvedAvatarUser} size={112} />
                      <Box
                        className="morius-profile-avatar-overlay"
                        sx={{
                          position: 'absolute',
                          inset: 0,
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
                      spacing={0.78}
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        width: '100%',
                        alignItems: { xs: (isEditing && isOwnProfile) ? 'stretch' : 'center', sm: 'stretch' },
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
                          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.8rem', md: '2.15rem' }, fontWeight: 800, lineHeight: 1.05 }}>
                            {resolvedProfileName}
                          </Typography>
                          <Stack direction="row" spacing={1.2} alignItems="center" flexWrap="wrap">
                            {isOwnProfile ? (
                              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>{user.email}</Typography>
                            ) : null}
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
                              {followersCount.toLocaleString('ru-RU')} {followersCount === 1 ? 'подписчик' : 'подписчика'}
                            </Typography>
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
                        </>
                      )}
                    </Stack>
                  </Stack>

                  <Stack
                    spacing={1.05}
                    sx={{
                      width: { xs: '100%', lg: 'auto' },
                      minWidth: { lg: 280 },
                      alignItems: { xs: 'stretch', lg: 'flex-end' },
                    }}
                  >
                    {isOwnProfile ? (
                      <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}>
                        <Button
                          onClick={handleOpenTopUpDialog}
                          sx={{
                            minHeight: 34,
                            px: 1.6,
                            borderRadius: '9999px',
                            border: 'none',
                            backgroundColor: 'var(--morius-accent)',
                            color: '#ffffff',
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '12px',
                            '&:hover': {
                              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 85%, #fff 15%)',
                              color: '#ffffff',
                            },
                          }}
                        >
                          {coins.toLocaleString('ru-RU')} Солов
                        </Button>
                      </Box>
                    ) : null}

                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" justifyContent={{ xs: 'flex-start', lg: 'flex-end' }} sx={{ display: { xs: 'none', md: 'flex' } }}>
                      {!isOwnProfile ? (
                        <Button
                          onClick={() => void handleToggleFollow()}
                          disabled={isFollowSaving || !profileView}
                          sx={{
                            minHeight: 40,
                            px: 1.6,
                            borderRadius: '16px',
                            border: 'none',
                            backgroundColor: 'transparent',
                            color: 'var(--morius-text-secondary)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'transparent',
                              color: 'var(--morius-title-text)',
                            },
                          }}
                        >
                          {isFollowSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} /> : profileView?.is_following ? 'Отписаться' : 'Подписаться'}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            if (resolvedCanOpenAdmin) {
                              setAdminOpen(true)
                              return
                            }
                            setIsEditing((previous) => !previous)
                          }}
                          sx={{
                            minHeight: 40,
                            px: 1.75,
                            borderRadius: '16px',
                            border: 'none',
                            backgroundColor: 'transparent',
                            color: 'var(--morius-text-secondary)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'transparent',
                              color: 'var(--morius-title-text)',
                            },
                          }}
                        >
                          {resolvedCanOpenAdmin ? 'Админка' : (isEditing ? 'Свернуть' : 'Редактировать')}
                        </Button>
                      )}

                      {isOwnProfile ? (
                        <Button
                          onClick={() => setLogoutOpen(true)}
                          sx={{
                            minHeight: 40,
                            px: 1.55,
                            borderRadius: '16px',
                            border: 'none',
                            backgroundColor: 'transparent',
                            color: 'var(--morius-text-secondary)',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: 'transparent',
                              color: 'var(--morius-title-text)',
                            },
                          }}
                        >
                          Выход
                        </Button>
                      ) : null}
                    </Stack>

                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ display: { xs: 'flex', md: 'none' } }}>
                      {isOwnProfile ? (
                        <Button
                          onClick={() => {
                            if (resolvedCanOpenAdmin) {
                              setAdminOpen(true)
                              return
                            }
                            setIsEditing((previous) => !previous)
                          }}
                          sx={{
                            minHeight: 40,
                            px: 1.45,
                            borderRadius: '14px',
                            border: 'none',
                            backgroundColor: 'var(--morius-button-active)',
                            color: 'var(--morius-title-text)',
                            textTransform: 'none',
                            fontWeight: 700,
                            flex: 1,
                          }}
                        >
                          {resolvedCanOpenAdmin ? 'Админка' : (isEditing ? 'Свернуть' : 'Редактировать')}
                        </Button>
                      ) : (
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
                      )}
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
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: { xs: 1.4, lg: 2.2 },
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 272px' },
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
              <Box sx={{ display: { xs: 'block', lg: 'none' }, mb: 1, minWidth: 0 }}>
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

              <Stack spacing={1.15} sx={{ display: { xs: 'none', lg: 'flex' }, mb: 1.15, width: '100%', minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2rem', fontWeight: 800, lineHeight: 1.02 }}>
                  {activeContentHeading}
                </Typography>
                <Stack direction="row" spacing={0.7} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
                  <TextField
                    size="small"
                    value={contentSearchQuery}
                    onChange={(event) => setContentSearchQuery(event.target.value.slice(0, PROFILE_CONTENT_SEARCH_MAX))}
                    placeholder="Поиск"
                    inputProps={{ maxLength: PROFILE_CONTENT_SEARCH_MAX }}
                    sx={{
                      flex: 1,
                      '& .MuiInputBase-root': {
                        borderRadius: '14px',
                        minHeight: 46,
                        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
                      },
                    }}
                  />
                  <IconButton
                    onClick={handleOpenContentSortMenu}
                    disabled={activeContentSortOptions.length === 0}
                    title={activeContentSortLabel}
                    aria-label={activeContentSortLabel}
                    sx={{
                      width: 46,
                      height: 46,
                      borderRadius: '14px',
                      border:
                        !isActiveContentSortDefault || Boolean(contentSortMenuAnchorEl)
                          ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))'
                          : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
                      '&:hover': {
                        backgroundColor:
                          activeContentSortOptions.length > 0
                            ? 'color-mix(in srgb, var(--morius-card-bg) 90%, #000 10%)'
                            : 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
                      },
                    }}
                  >
                    <Box component="img" src={icons.profileSearchFilter} alt="" sx={{ width: 18, height: 10, opacity: 0.95 }} />
                  </IconButton>
                </Stack>
              </Stack>

              {renderTabContent()}
            </Box>

            <Box
              sx={{
                display: { xs: 'none', lg: 'block' },
                p: 0,
                border: 'none',
                background: 'transparent',
                alignSelf: 'start',
              }}
            >
              <Stack spacing={1.35}>
                {isProfileBootstrapLoading
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
              if (resolvedCanOpenAdmin) {
                setAdminOpen(true)
              } else {
                setIsEditing((previous) => !previous)
              }
              handleCloseMobileProfileMenu()
            }}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {resolvedCanOpenAdmin ? 'Админка' : (isEditing ? 'Свернуть редактор' : 'Редактировать профиль')}
          </MenuItem>
        )}

        {isOwnProfile ? (
          <MenuItem
            onClick={() => {
              handleCloseMobileProfileMenu()
              handleOpenPrivacyDialog()
            }}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            Приватность
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
            Выйти
          </MenuItem>
        ) : null}
      </Menu>

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
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={(planId) => void handlePurchasePlan(planId)}
      />

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        onClose={() => setPaymentSuccessCoins(null)}
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
        onUserUpdate={onUserUpdate}
      />

      <CharacterManagerDialog
        open={characterDialogOpen}
        authToken={authToken}
        initialMode={characterDialogMode}
        initialCharacterId={characterEditId}
        showEmotionTools={user.role === 'administrator'}
        onClose={closeCharacterDialog}
      />

      <InstructionTemplateDialog
        open={instructionDialogOpen}
        authToken={authToken}
        mode="manage"
        initialMode={instructionDialogMode}
        initialTemplateId={instructionEditId}
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
        currentUserEmail={user.email}
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
