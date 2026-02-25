import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import AdminPanelDialog from '../components/profile/AdminPanelDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import UserAvatar from '../components/profile/UserAvatar'
import {
  createCoinTopUpPayment,
  followUserProfile,
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
} from '../services/authApi'
import {
  favoriteCommunityWorld,
  listFavoriteCommunityWorlds,
  listStoryCharacters,
  listStoryGames,
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

type ProfilePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  viewedUserId?: number | null
}

type TabId = 'characters' | 'instructions' | 'favorites' | 'plots' | 'subscriptions' | 'publications'

const PROFILE_NAME_MAX = 25
const PROFILE_DESC_MAX = 2000
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const HEADER_AVATAR_SIZE = 44
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

function sortGamesByLastUpdate(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort((left, right) => parseSortDate(right.updated_at) - parseSortDate(left.updated_at))
}

function resolveFirstLetter(value: string): string {
  return value.trim().charAt(0).toUpperCase() || '•'
}

function clampAvatarScale(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  return Math.max(1, Math.min(3, value))
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
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [tab, setTab] = useState<TabId>('characters')

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
  const [publicationGames, setPublicationGames] = useState<StoryGameSummary[]>([])
  const [favoriteWorlds, setFavoriteWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [favoriteLoadingById, setFavoriteLoadingById] = useState<Record<number, boolean>>({})

  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)

  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogMode, setCharacterDialogMode] = useState<'list' | 'create'>('list')
  const [characterEditId, setCharacterEditId] = useState<number | null>(null)
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [instructionDialogMode, setInstructionDialogMode] = useState<'list' | 'create'>('list')
  const [instructionEditId, setInstructionEditId] = useState<number | null>(null)

  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)

  const [error, setError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const profileName = user.display_name?.trim() || 'Игрок'
  const profileDescription = user.profile_description || ''
  const userLevel = Math.max(1, Math.trunc(user.level || 1))
  const coins = Math.max(0, Math.trunc(user.coins || 0))
  const canOpenAdmin = user.role === 'administrator' || user.role === 'moderator'

  const publicationWorlds = useMemo(
    () =>
      publicationGames.map((game) =>
        toPublicationWorld(game, {
          authorId: user.id,
          authorName: profileName,
          authorAvatarUrl: user.avatar_url ?? null,
        }),
      ),
    [publicationGames, profileName, user.avatar_url, user.id],
  )
  const resolvedProfileUser = profileView?.user ?? {
    id: user.id,
    display_name: profileName,
    profile_description: profileDescription,
    avatar_url: user.avatar_url,
    avatar_scale: user.avatar_scale ?? 1,
    created_at: user.created_at,
  }
  const resolvedProfileName = resolvedProfileUser.display_name?.trim() || profileName
  const resolvedProfileDescription = resolvedProfileUser.profile_description || profileDescription
  const resolvedAvatarUser = isOwnProfile ? user : toAvatarUser(resolvedProfileUser)
  const resolvedCanOpenAdmin = isOwnProfile && canOpenAdmin
  const followersCount = Math.max(0, profileView?.followers_count ?? 0)
  const subscriptionsCount = Math.max(0, profileView?.subscriptions_count ?? 0)
  const canViewSubscriptions = Boolean(profileView?.can_view_subscriptions)
  const canViewPublicWorlds = Boolean(profileView?.can_view_public_worlds)
  const canViewPrivateWorlds = Boolean(profileView?.can_view_private_worlds)
  const visiblePublicationWorlds = profileView?.published_worlds ?? publicationWorlds
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
  const isProfileBootstrapLoading = isProfileViewLoading || (isOwnProfile && isLoadingContent)
  const tabs = useMemo(() => {
    const subscriptionsLabel = `${isOwnProfile ? 'Мои подписки' : 'Подписки'} (${subscriptionsCount})`
    if (isOwnProfile) {
      return BASE_PROFILE_TABS.map((item) =>
        item.id === 'subscriptions'
          ? {
              ...item,
              label: subscriptionsLabel,
            }
          : item,
      )
    }
    return [
      { id: 'subscriptions' as TabId, label: subscriptionsLabel },
      { id: 'publications' as TabId, label: 'Публикации' },
    ]
  }, [isOwnProfile, subscriptionsCount])

  const sortedCharacters = useMemo(
    () =>
      [...characters].sort(
        (left, right) => parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id,
      ),
    [characters],
  )

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort(
        (left, right) => parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id,
      ),
    [templates],
  )

  useEffect(() => {
    if (!isEditing) {
      setNameDraft(resolvedProfileName)
      setDescriptionDraft(resolvedProfileDescription)
    }
  }, [isEditing, resolvedProfileDescription, resolvedProfileName])

  const loadCharactersOnly = useCallback(async () => {
    try {
      const loadedCharacters = await listStoryCharacters(authToken)
      setCharacters(loadedCharacters)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить персонажей'
      setError(detail)
    }
  }, [authToken])

  const loadTemplatesOnly = useCallback(async () => {
    try {
      const loadedTemplates = await listStoryInstructionTemplates(authToken)
      setTemplates(loadedTemplates)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить инструкции'
      setError(detail)
    }
  }, [authToken])

  const loadProfileContent = useCallback(async () => {
    if (!isOwnProfile) {
      setCharacters([])
      setTemplates([])
      setFavoriteWorlds([])
      setPublicationGames([])
      return
    }

    setIsLoadingContent(true)
    setError('')
    try {
      const [loadedCharacters, loadedTemplates, loadedGames, loadedFavorites] = await Promise.all([
        listStoryCharacters(authToken),
        listStoryInstructionTemplates(authToken),
        listStoryGames(authToken),
        listFavoriteCommunityWorlds(authToken),
      ])

      setCharacters(loadedCharacters)
      setTemplates(loadedTemplates)
      setPublicationGames(
        sortGamesByLastUpdate(
          loadedGames.filter(
            (game) => game.visibility === 'public' && (game.source_world_id === null || game.source_world_id <= 0),
          ),
        ),
      )
      setFavoriteWorlds(loadedFavorites)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить данные профиля'
      setError(detail)
    } finally {
      setIsLoadingContent(false)
    }
  }, [authToken, isOwnProfile])

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
    void loadProfileContent()
  }, [loadProfileContent])

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

  const handleOpenTopUpDialog = useCallback(() => {
    setTopUpError('')
    setTopUpDialogOpen(true)
  }, [])

  const handleCloseTopUpDialog = useCallback(() => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }, [])

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
          return
        }

        const updatedWorld = await favoriteCommunityWorld({ token: authToken, worldId: world.id })
        setFavoriteWorlds((previous) => [updatedWorld, ...previous.filter((item) => item.id !== updatedWorld.id)])
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

  const renderCharacterAvatar = (character: StoryCharacter) => {
    const fallbackLetter = resolveFirstLetter(character.name)
    return (
      <Box
        sx={{
          position: 'relative',
          width: 48,
          height: 48,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          border: 'var(--morius-border-width) solid rgba(201, 217, 235, 0.24)',
          backgroundColor: 'var(--morius-elevated-bg)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--morius-text-primary)',
          fontWeight: 700,
          fontSize: '1rem',
        }}
      >
        {fallbackLetter}
        {character.avatar_url ? (
          <Box
            component="img"
            src={character.avatar_url}
            alt={character.name}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${clampAvatarScale(character.avatar_scale)})`,
              transformOrigin: 'center center',
            }}
          />
        ) : null}
      </Box>
    )
  }

  const renderCharacters = () => {
    return (
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={0.7}>
          <Typography sx={{ fontSize: { xs: '1.03rem', md: '1.14rem' }, fontWeight: 800 }}>Мои персонажи</Typography>
          <Button
            onClick={openCharacterCreate}
            sx={{
              minHeight: 36,
              px: 1.25,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-text-primary)',
              textTransform: 'none',
              fontWeight: 700,
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Создать персонажа
          </Button>
        </Stack>

        {!sortedCharacters.length ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет персонажей.</Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {sortedCharacters.map((item) => (
              <ButtonBase
                key={item.id}
                onClick={() => openCharacterEdit(item.id)}
                sx={{
                  width: '100%',
                  minHeight: CARD_MIN_HEIGHT,
                  p: 1.1,
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                  '&:hover': {
                    backgroundColor: 'var(--morius-button-hover)',
                    borderColor: 'rgba(203, 217, 236, 0.48)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Stack spacing={0.7} sx={{ width: '100%', height: '100%' }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                    {renderCharacterAvatar(item)}
                    <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.name}
                      </Typography>
                      {item.triggers.length ? (
                        <Typography
                          sx={{
                            color: 'var(--morius-text-secondary)',
                            fontSize: '0.76rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Триггеры: {item.triggers.join(', ')}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                  <Typography
                    sx={{
                      color: 'var(--morius-text-secondary)',
                      fontSize: '0.84rem',
                      lineHeight: 1.36,
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      flex: 1,
                    }}
                  >
                    {item.description || 'Описание не заполнено.'}
                  </Typography>
                  <Typography sx={{ color: 'rgba(182, 200, 222, 0.8)', fontSize: '0.74rem', fontWeight: 700 }}>
                    Нажмите для редактирования
                  </Typography>
                </Stack>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Stack>
    )
  }

  const renderInstructions = () => {
    return (
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={0.7}>
          <Typography sx={{ fontSize: { xs: '1.03rem', md: '1.14rem' }, fontWeight: 800 }}>Мои инструкции</Typography>
          <Button
            onClick={openInstructionCreate}
            sx={{
              minHeight: 36,
              px: 1.25,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-text-primary)',
              textTransform: 'none',
              fontWeight: 700,
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Создать инструкцию
          </Button>
        </Stack>

        {!sortedTemplates.length ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)' }}>У вас пока нет инструкций.</Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {sortedTemplates.map((item) => (
              <ButtonBase
                key={item.id}
                onClick={() => openInstructionEdit(item.id)}
                sx={{
                  width: '100%',
                  minHeight: CARD_MIN_HEIGHT,
                  p: 1.1,
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                  '&:hover': {
                    backgroundColor: 'var(--morius-button-hover)',
                    borderColor: 'rgba(203, 217, 236, 0.48)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Stack spacing={0.7} sx={{ width: '100%', height: '100%' }}>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </Typography>
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
        )}
      </Stack>
    )
  }

  const renderFavorites = () => {
    if (!favoriteWorlds.length) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет любимых миров.</Typography>
    }

    return (
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        {favoriteWorlds.map((item) => (
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
    )
  }

  const renderSubscriptions = () => {
    if (!profileView) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Не удалось загрузить список подписок.</Typography>
    }
    if (!canViewSubscriptions) {
      return <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл список подписок.</Typography>
    }
    if (!visibleSubscriptions.length) {
      return (
        <Typography sx={{ color: 'var(--morius-text-secondary)' }}>
          {isOwnProfile ? 'Вы пока ни на кого не подписаны.' : 'У пользователя пока нет подписок.'}
        </Typography>
      )
    }

    return (
      <Box
        sx={{
          display: 'grid',
          gap: 0.9,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {visibleSubscriptions.map((subscription) => (
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
                backgroundColor: 'var(--morius-button-hover)',
                borderColor: 'rgba(203, 217, 236, 0.48)',
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
              {subscription.avatar_url ? (
                <Box
                  component="img"
                  src={subscription.avatar_url}
                  alt={subscription.display_name}
                  sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: `scale(${clampAvatarScale(subscription.avatar_scale)})`,
                    transformOrigin: 'center center',
                  }}
                />
              ) : (
                resolveFirstLetter(subscription.display_name)
              )}
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
    )
  }

  const renderPublications = () => {
    if (!publicationWorlds.length) {
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
        {publicationWorlds.map((item) => (
          <CommunityWorldCard key={item.id} world={item} onClick={() => onNavigate(`/home/${item.id}`)} />
        ))}
      </Box>
    )
  }

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
          ) : visiblePublicationWorlds.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет опубликованных миров.</Typography>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              {visiblePublicationWorlds.map((item) => (
                <CommunityWorldCard
                  key={item.id}
                  world={item}
                  onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                  onClick={() => onNavigate(isOwnProfile ? `/home/${item.id}` : `/games/all?worldId=${item.id}`)}
                />
              ))}
            </Box>
          )}
        </Stack>

        <Stack spacing={0.75}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>Неопубликованные миры</Typography>
          {!canViewPrivateWorlds ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пользователь скрыл неопубликованные миры.</Typography>
          ) : visibleUnpublishedWorlds.length === 0 ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>Пока нет неопубликованных миров.</Typography>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              {visibleUnpublishedWorlds.map((item) => (
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
          )}
        </Stack>
      </Stack>
    )
  }
  void renderPublications

  const renderTabContent = () => {
    if (isProfileBootstrapLoading) {
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
        menuItems={[
          { key: 'dashboard', label: 'Главная', onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', onClick: () => onNavigate('/games') },
          { key: 'games-all', label: 'Комьюнити миры', onClick: () => onNavigate('/games/all') },
          { key: 'profile', label: 'Профиль', isActive: true, onClick: () => onNavigate('/profile') },
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
        hideRightToggle
        rightActions={
          <Button
            variant="text"
            onClick={() => onNavigate('/profile')}
            aria-label="Открыть профиль"
            sx={{
              minWidth: 0,
              width: HEADER_AVATAR_SIZE,
              height: HEADER_AVATAR_SIZE,
              p: 0,
              borderRadius: '50%',
              overflow: 'hidden',
            }}
          >
            <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
          </Button>
        }
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 5, md: 6 },
          px: { xs: 2, md: 3.2 },
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
              mb: 1.2,
              p: { xs: 1.25, md: 1.55 },
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              background: 'var(--morius-card-bg)',
            }}
          >
            <Stack spacing={1.2} sx={{ display: isProfileBootstrapLoading ? 'flex' : 'none' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Skeleton variant="text" width={180} height={36} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                <Skeleton variant="rounded" width={136} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
              </Stack>

              <Stack direction="row" spacing={1.1} alignItems="flex-start">
                <Skeleton variant="circular" width={PROFILE_AVATAR_SIZE} height={PROFILE_AVATAR_SIZE} sx={{ flexShrink: 0, bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                <Stack spacing={0.72} sx={{ minWidth: 0, flex: 1 }}>
                  <Skeleton variant="text" width="48%" height={38} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                  <Skeleton variant="text" width="92%" height={26} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                  <Skeleton variant="text" width="80%" height={26} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                  <Skeleton variant="text" width="42%" height={22} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="center">
                <Skeleton variant="rounded" width={110} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={122} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={166} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                <Skeleton variant="rounded" width={126} height={34} sx={{ borderRadius: '999px', bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1}
              sx={{ mb: 1.1, display: isProfileBootstrapLoading ? 'none' : undefined }}
            >
              <Typography sx={{ fontSize: { xs: '1.3rem', md: '1.48rem' }, fontWeight: 800 }}>Об аккаунте</Typography>
              <Button
                onClick={() => {
                  if (isOwnProfile) {
                    handleOpenTopUpDialog()
                  }
                }}
                sx={{
                  display: isOwnProfile ? 'inline-flex' : 'none',
                  minHeight: 34,
                  px: 1.05,
                  py: 0.45,
                  borderRadius: '999px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  color: 'var(--morius-text-primary)',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: 'var(--morius-button-hover)',
                  },
                }}
              >
                Токены: {coins.toLocaleString('ru-RU')}
              </Button>
            </Stack>

            <Stack spacing={1.15} sx={{ display: isProfileBootstrapLoading ? 'none' : undefined }}>
              <Stack direction="row" spacing={1.1} alignItems="flex-start">
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

                <Stack spacing={0.72} sx={{ minWidth: 0, flex: 1 }}>
                  {isEditing && isOwnProfile ? (
                    <>
                      <TextField
                        size="small"
                        label="Ник"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value.slice(0, PROFILE_NAME_MAX))}
                      />
                      <TextField
                        label="Описание"
                        value={descriptionDraft}
                        onChange={(event) => setDescriptionDraft(event.target.value.slice(0, PROFILE_DESC_MAX))}
                        multiline
                        minRows={3}
                        maxRows={5}
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
                              backgroundColor: 'var(--morius-button-hover)',
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
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', whiteSpace: 'pre-wrap' }}>
                        {resolvedProfileDescription || 'Описание пока не добавлено.'}
                      </Typography>
                      {isOwnProfile ? (
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>{user.email}</Typography>
                      ) : null}
                    </>
                  )}
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="center">
                <Box
                  sx={{
                    display: isOwnProfile ? 'inline-flex' : 'none',
                    alignItems: 'center',
                    gap: 0.55,
                    px: 0.9,
                    py: 0.42,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                  }}
                >
                  <Typography component="span" sx={{ fontSize: '0.8rem', color: 'var(--morius-text-secondary)' }}>
                    Уровень
                  </Typography>
                  <Box
                    component="span"
                    sx={{
                      minWidth: 26,
                      height: 22,
                      px: 0.6,
                      borderRadius: '999px',
                      display: 'grid',
                      placeItems: 'center',
                      backgroundColor: 'var(--morius-button-active)',
                      color: 'var(--morius-text-primary)',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                    }}
                  >
                    {userLevel}
                  </Box>
                </Box>

                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.55,
                    px: 0.9,
                    py: 0.42,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                  }}
                >
                  <Typography component="span" sx={{ fontSize: '0.8rem', color: 'var(--morius-text-secondary)' }}>
                    Подписчики
                  </Typography>
                  <Box
                    component="span"
                    sx={{
                      minWidth: 26,
                      height: 22,
                      px: 0.6,
                      borderRadius: '999px',
                      display: 'grid',
                      placeItems: 'center',
                      backgroundColor: 'var(--morius-button-active)',
                      color: 'var(--morius-text-primary)',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                    }}
                  >
                    {followersCount}
                  </Box>
                </Box>

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
                        backgroundColor: 'var(--morius-button-hover)',
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
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  {isEditing ? 'Свернуть редактор' : 'Редактировать профиль'}
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
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  Приватность
                </Button>

                {resolvedCanOpenAdmin ? (
                  <Button
                    onClick={() => setAdminOpen(true)}
                    sx={{
                      minHeight: 34,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      color: 'var(--morius-text-primary)',
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: 'var(--morius-button-hover)',
                      },
                    }}
                  >
                    Админка
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
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 1.2,
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 250px' },
            }}
          >
            <Box
              sx={{
                p: 1,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background: 'var(--morius-card-bg)',
              }}
            >
              {renderTabContent()}
            </Box>

            <Box
              sx={{
                p: 0.9,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background: 'var(--morius-card-bg)',
                alignSelf: 'start',
              }}
            >
              <Stack spacing={0.7}>
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
                  : tabs.map((item) => (
                      <Button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        sx={{
                          minHeight: 38,
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          fontWeight: 700,
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          borderRadius: '10px',
                          backgroundColor: tab === item.id ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                          color: 'var(--morius-text-primary)',
                          '&:hover': {
                            backgroundColor: 'var(--morius-button-hover)',
                          },
                        }}
                      >
                        {item.label}
                      </Button>
                    ))}
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
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            {isSavingPrivacy ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Сохранить'}
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

      <CharacterManagerDialog
        open={characterDialogOpen}
        authToken={authToken}
        initialMode={characterDialogMode}
        initialCharacterId={characterEditId}
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
        onConfirm={() => {
          setLogoutOpen(false)
          setCharacterDialogOpen(false)
          setInstructionDialogOpen(false)
          setTopUpDialogOpen(false)
          onLogout()
        }}
      />

      <AdminPanelDialog
        open={adminOpen}
        authToken={authToken}
        currentUserEmail={user.email}
        onClose={() => setAdminOpen(false)}
      />
    </Box>
  )
}

export default ProfilePage
