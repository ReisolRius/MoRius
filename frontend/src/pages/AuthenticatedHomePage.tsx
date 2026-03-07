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
  DialogActions,
  DialogContent,
  DialogTitle,
  Grow,
  Skeleton,
  Stack,
  Typography,
  type GrowProps,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import BaseDialog from '../components/dialogs/BaseDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import UserAvatar from '../components/profile/UserAvatar'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  createCommunityWorldComment,
  deleteCommunityWorldComment,
  deleteStoryGame,
  favoriteCommunityWorld,
  getStoryGame,
  getCommunityWorld,
  launchCommunityWorld,
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
import type { StoryCommunityWorldPayload, StoryCommunityWorldSummary, StoryGameSummary } from '../types/story'

type AuthenticatedHomePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

type DashboardNewsItem = {
  id: string
  category: string
  title: string
  description: string
  dateLabel: string
}

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const HOME_NEWS_SKELETON_KEYS = Array.from({ length: 3 }, (_, index) => `home-news-skeleton-${index}`)
const HOME_COMMUNITY_SKELETON_CARD_KEYS = Array.from({ length: 3 }, (_, index) => `home-community-skeleton-${index}`)
const HOME_COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
const HOME_FOOTER_SOCIAL_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  { label: 'Вконтакте', href: 'https://vk.com/moriusai', external: true },
  { label: 'Телеграмм', href: 'https://t.me/+t2ueY4x_KvE4ZWEy', external: true },
]
const HOME_FOOTER_INFO_LINKS: Array<{ label: string; path: string }> = [
  { label: 'Политика конфиденциальности', path: '/privacy-policy' },
  { label: 'Пользовательское соглашение', path: '/terms-of-service' },
]
const DASHBOARD_NEWS: DashboardNewsItem[] = [
  {
    id: 'news-1',
    category: 'Обновление',
    title: 'Новые стили карточек и быстрый старт',
    description: 'Интерфейс стал легче, а стартовые миры доступны в один клик прямо на главной странице.',
    dateLabel: '20 февраля 2026',
  },
  {
    id: 'news-2',
    category: 'Игровой процесс',
    title: 'Редактирование сообщений в истории',
    description: 'Теперь вы можете поправить любую реплику в текущей сессии и продолжить сюжет с новой развилки.',
    dateLabel: '19 февраля 2026',
  },
  {
    id: 'news-3',
    category: 'Профиль',
    title: 'Гибкая работа с аватаром',
    description: 'Добавление, замена и удаление аватара теперь доступны из профиля без перехода между страницами.',
    dateLabel: '18 февраля 2026',
  },
]

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
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
  const [selectedNewsItem, setSelectedNewsItem] = useState<DashboardNewsItem | null>(null)
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
  const [storyGames, setStoryGames] = useState<StoryGameSummary[]>([])
  const [isDashboardDataLoading, setIsDashboardDataLoading] = useState(true)
  const [isDashboardContinueResolving, setIsDashboardContinueResolving] = useState(false)
  const [communityWorldGameIds, setCommunityWorldGameIds] = useState<Record<number, number[]>>({})
  const [isCommunityWorldMyGamesSaving, setIsCommunityWorldMyGamesSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

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
      const worlds = await listCommunityWorlds(authToken)
      setCommunityWorlds(worlds)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить сообщество'
      setCommunityWorldsError(detail)
      setCommunityWorlds([])
    } finally {
      setIsCommunityWorldsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadCommunityWorlds()
  }, [loadCommunityWorlds])

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

  const loadStoryGamesSnapshot = useCallback(async (): Promise<StoryGameSummary[]> => {
    const games = await listStoryGames(authToken, { compact: true })
    setStoryGames(games)
    setCommunityWorldGameIds(buildCommunityWorldGameMap(games))
    return games
  }, [authToken])

  const syncCommunityWorldGameIds = useCallback(async () => {
    setIsDashboardDataLoading(true)
    try {
      await loadStoryGamesSnapshot()
    } catch {
      // Optional metadata for UI; skip hard error when unavailable.
      setStoryGames([])
      setCommunityWorldGameIds({})
    } finally {
      setIsDashboardDataLoading(false)
    }
  }, [loadStoryGamesSnapshot])

  useEffect(() => {
    void syncCommunityWorldGameIds()
  }, [syncCommunityWorldGameIds])

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
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть мир'
        setCommunityWorldsError(detail)
      } finally {
        setIsCommunityWorldDialogLoading(false)
      }
    },
    [authToken, isCommunityWorldDialogLoading],
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

  const handleOpenNewsDetails = (item: DashboardNewsItem) => {
    setSelectedNewsItem(item)
  }

  const handleCloseNewsDetails = () => {
    setSelectedNewsItem(null)
  }

  const selectedCommunityWorldGameIds = selectedCommunityWorld
    ? communityWorldGameIds[selectedCommunityWorld.world.id] ?? []
    : []
  const isSelectedCommunityWorldInMyGames = selectedCommunityWorldGameIds.length > 0
  const profileName = user.display_name || 'Игрок'
  const communityWorldsPreview = communityWorlds.slice(0, 9)
  const dashboardView = 'welcome' as const
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
  const dashboardHeroTitle = hasDashboardLastPlayedGame
    ? buildDashboardGameTitle(dashboardLastPlayedGame)
    : `Добро пожаловать, ${profileName}.`
  const dashboardHeroDescription = hasDashboardLastPlayedGame
    ? buildDashboardGameDescription(dashboardLastPlayedGame)
    : 'Начните новую историю с чистого листа или выберите готовый мир ниже для быстрого старта.'
  const dashboardHeroButtonLabel = hasDashboardLastPlayedGame ? 'Продолжить' : 'Начать новую игру'

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
        const refreshedGames = await loadStoryGamesSnapshot()
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
    loadStoryGamesSnapshot,
    onNavigate,
  ])

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
          { key: 'dashboard', label: 'Главная', isActive: true, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Мои публикации', onClick: () => onNavigate('/games/publications') },
          { key: 'games-all', label: 'Сообщество', onClick: () => onNavigate('/games/all') },
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
        onOpenTopUpDialog={handleOpenTopUpDialog}
        hideRightToggle
        rightActions={
          <Stack direction="row" spacing={0}>
            <Button
              variant="text"
              onClick={() => onNavigate('/profile')}
              aria-label="Открыть профиль"
              data-tour-id="header-profile-button"
              sx={{
                minWidth: 0,
                width: HEADER_AVATAR_SIZE,
                height: HEADER_AVATAR_SIZE,
                p: 0,
                borderRadius: '50%',
              }}
            >
              <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
            </Button>
          </Stack>
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

          {dashboardView === 'welcome' ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.65fr) minmax(320px, 1fr)' },
                mb: 2.4,
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 'var(--morius-radius)',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  aspectRatio: '3 / 2',
                  p: { xs: 2, md: 2.6 },
                  display: 'flex',
                  alignItems: 'flex-end',
                  background: APP_CARD_BACKGROUND,
                  boxShadow: '0 28px 44px rgba(0, 0, 0, 0.35)',
                }}
              >
                {isDashboardDataLoading ? (
                  <Stack spacing={1.2} sx={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: { xs: '100%', lg: 560 } }}>
                    <Skeleton variant="text" width={92} height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.22)' }} />
                    <Skeleton variant="rounded" width="100%" height={58} sx={{ borderRadius: '12px', bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                    <Skeleton variant="text" width="96%" height={28} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                    <Skeleton variant="text" width="82%" height={28} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                    <Skeleton variant="rounded" width={220} height={46} sx={{ mt: 0.6, borderRadius: '12px', bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                  </Stack>
                ) : (
                  <>
                    {dashboardHeroCoverUrl ? (
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          backgroundImage: `url(${dashboardHeroCoverUrl})`,
                          backgroundRepeat: 'no-repeat',
                          backgroundSize: 'cover',
                          backgroundPosition: `${dashboardHeroCoverPositionX}% ${dashboardHeroCoverPositionY}%`,
                        }}
                      />
                    ) : null}
                    {!hasDashboardLastPlayedGame ? (
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          background:
                            'radial-gradient(circle at 84% 20%, rgba(233, 178, 91, 0.22), transparent 34%), repeating-linear-gradient(128deg, rgba(189, 205, 223, 0.09) 0 6px, transparent 6px 20px)',
                        }}
                      />
                    ) : null}
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'linear-gradient(180deg, rgba(4, 7, 11, 0.32) 0%, rgba(4, 7, 11, 0.56) 54%, rgba(4, 7, 11, 0.8) 100%)',
                      }}
                    />
                    {!hasDashboardLastPlayedGame ? (
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute',
                          right: -82,
                          top: -88,
                          width: 320,
                          height: 320,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(214, 158, 74, 0.22) 0%, rgba(214, 158, 74, 0) 68%)',
                        }}
                      />
                    ) : null}

                    <Stack spacing={1.05} sx={{ position: 'relative', zIndex: 1, maxWidth: { xs: '100%', lg: 560 } }}>
                      {!hasDashboardLastPlayedGame ? (
                        <Typography sx={{ color: APP_TEXT_SECONDARY, letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.78rem' }}>
                          WELCOME
                        </Typography>
                      ) : null}
                      <Typography sx={{ fontSize: { xs: '1.74rem', md: '2.38rem' }, fontWeight: 800, lineHeight: 1.14, color: APP_TEXT_PRIMARY }}>
                        {dashboardHeroTitle}
                      </Typography>
                      <Typography
                        sx={{
                          color: APP_TEXT_SECONDARY,
                          fontSize: { xs: '1rem', md: '1.06rem' },
                          lineHeight: 1.46,
                          ...(hasDashboardLastPlayedGame
                            ? {
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }
                            : {}),
                        }}
                      >
                        {dashboardHeroDescription}
                      </Typography>
                      <Button
                        onClick={() => void handleDashboardContinue()}
                        disabled={isDashboardDataLoading || isDashboardContinueResolving}
                        sx={{
                          mt: 0.6,
                          minHeight: 46,
                          maxWidth: 236,
                          borderRadius: '12px',
                          textTransform: 'none',
                          fontWeight: 800,
                          color: APP_TEXT_PRIMARY,
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_BUTTON_ACTIVE,
                          '&:hover': {
                            backgroundColor: APP_BUTTON_HOVER,
                          },
                        }}
                      >
                        {dashboardHeroButtonLabel}
                      </Button>
                    </Stack>
                  </>
                )}
              </Box>

              <Stack spacing={1.05}>
                {isDashboardDataLoading
                  ? HOME_NEWS_SKELETON_KEYS.map((itemKey) => (
                      <Box
                        key={itemKey}
                        sx={{
                          width: '100%',
                          minHeight: 112,
                          borderRadius: 'var(--morius-radius)',
                          p: 1.3,
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          background: APP_CARD_BACKGROUND,
                        }}
                      >
                        <Stack spacing={0.58}>
                          <Skeleton variant="text" width="26%" height={20} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                          <Skeleton variant="text" width="78%" height={30} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
                          <Skeleton variant="text" width="92%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                          <Skeleton variant="text" width="84%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                          <Skeleton variant="text" width="34%" height={20} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
                        </Stack>
                      </Box>
                    ))
                  : DASHBOARD_NEWS.map((item) => (
                      <Button
                        key={item.id}
                        onClick={() => handleOpenNewsDetails(item)}
                        sx={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          minHeight: 112,
                          borderRadius: 'var(--morius-radius)',
                          p: 1.3,
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          background: APP_CARD_BACKGROUND,
                          textTransform: 'none',
                          textAlign: 'left',
                          alignItems: 'flex-start',
                        }}
                      >
                        <Stack spacing={0.42}>
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                            {item.category}
                          </Typography>
                          <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.04rem', fontWeight: 700, lineHeight: 1.2 }}>
                            {item.title}
                          </Typography>
                          <Typography
                            sx={{
                              color: APP_TEXT_SECONDARY,
                              fontSize: '0.9rem',
                              lineHeight: 1.4,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {item.description}
                          </Typography>
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem' }}>{item.dateLabel}</Typography>
                        </Stack>
                      </Button>
                    ))}
              </Stack>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.2,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
                mb: 2.4,
              }}
            >
              {DASHBOARD_NEWS.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    borderRadius: 'var(--morius-radius)',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 56%, transparent)',
                    background: 'linear-gradient(166deg, rgba(20, 27, 37, 0.9), rgba(13, 18, 25, 0.95))',
                    p: 1.4,
                    minHeight: 182,
                    boxShadow: '0 14px 28px rgba(0, 0, 0, 0.24)',
                  }}
                >
                  <Stack spacing={0.5}>
                    <Typography sx={{ color: 'rgba(179, 194, 214, 0.72)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {item.category}
                    </Typography>
                    <Typography sx={{ color: '#e6edf8', fontSize: '1.1rem', fontWeight: 800, lineHeight: 1.2 }}>{item.title}</Typography>
                    <Typography sx={{ color: 'rgba(198, 210, 227, 0.82)', fontSize: '0.94rem', lineHeight: 1.45 }}>
                      {item.description}
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: 'rgba(165, 178, 198, 0.72)', fontSize: '0.8rem' }}>{item.dateLabel}</Typography>
                  </Stack>
                </Box>
              ))}
            </Box>
          )}

          <Box data-tour-id="home-community-section" sx={{ scrollMarginTop: '120px' }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'flex-end' }}
              spacing={1}
              sx={{ mb: 'var(--morius-cards-title-gap)', mt: 'var(--morius-cards-title-gap)' }}
            >
              <Stack spacing={0.45}>
                <Typography sx={{ fontSize: { xs: '1.6rem', md: '1.9rem' }, fontWeight: 800, color: APP_TEXT_PRIMARY }}>
                  Сообщество
                </Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.01rem' }}>
                  Публичные миры игроков. Откройте карточку мира, оцените и запускайте в свои игры.
                </Typography>
              </Stack>
              <Stack direction="row" alignItems="center" sx={{ gap: 0.9 }}>
                <Button
                  onClick={() => onNavigate('/games/all')}
                  sx={{
                    minHeight: 'var(--morius-action-size)',
                    px: 1.35,
                    borderRadius: 'var(--morius-radius)',
                    textTransform: 'none',
                    fontWeight: 700,
                    border: 'var(--morius-border-width) solid transparent',
                    backgroundColor: 'transparent',
                    color: 'var(--morius-accent)',
                    '&:hover': {
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                    '&:active': {
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_BUTTON_ACTIVE,
                    },
                  }}
                >
                  Показать все
                </Button>
              </Stack>
            </Stack>

            {communityWorldsError ? (
              <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>
                {communityWorldsError}
              </Alert>
            ) : null}

            {isCommunityWorldsLoading ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.4,
                  gridTemplateColumns: HOME_COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                }}
              >
                {HOME_COMMUNITY_SKELETON_CARD_KEYS.map((cardKey) => (
                  <Box key={cardKey}>
                    <CommunityWorldCardSkeleton showFavoriteButton />
                  </Box>
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
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.4,
                  gridTemplateColumns: HOME_COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS,
                }}
              >
                {communityWorldsPreview.map((world) => (
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
            )}
          </Box>

          <Box component="footer" sx={{ mt: 2.8, pb: 0.3 }}>
            <Box
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid color-mix(in srgb, ${APP_BORDER_COLOR} 80%, transparent)`,
                background:
                  'linear-gradient(145deg, color-mix(in srgb, var(--morius-card-bg) 94%, #03070d 6%), color-mix(in srgb, var(--morius-card-bg) 89%, #02060b 11%))',
                px: { xs: 1.4, md: 2.2 },
                py: { xs: 1.6, md: 2.1 },
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gap: { xs: 1.8, md: 2.6 },
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: '1.25fr 0.8fr 1.25fr' },
                  mb: 1.4,
                }}
              >
                <Stack spacing={0.55}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 700 }}>О проекте</Typography>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem', maxWidth: 320, lineHeight: 1.48 }}>
                    Текстовое приключение, где ИИ ведёт игру, а ты решаешь, кем стать и как закончится история
                  </Typography>
                </Stack>

                <Stack spacing={0.55}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 700 }}>Соц сети</Typography>
                  {HOME_FOOTER_SOCIAL_LINKS.map((link) => (
                    <Typography
                      key={link.label}
                      component="a"
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      sx={{
                        color: APP_TEXT_SECONDARY,
                        textDecoration: 'none',
                        fontSize: '0.92rem',
                        width: 'fit-content',
                        transition: 'color 170ms ease',
                        '&:hover': {
                          color: APP_TEXT_PRIMARY,
                        },
                      }}
                    >
                      {link.label}
                    </Typography>
                  ))}
                </Stack>

                <Stack spacing={0.55}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 700 }}>Информация</Typography>
                  {HOME_FOOTER_INFO_LINKS.map((link) => (
                    <Box
                      key={link.label}
                      component="button"
                      type="button"
                      onClick={() => onNavigate(link.path)}
                      sx={{
                        p: 0,
                        m: 0,
                        border: 'none',
                        background: 'none',
                        color: APP_TEXT_SECONDARY,
                        textAlign: 'left',
                        font: 'inherit',
                        fontSize: '0.92rem',
                        width: 'fit-content',
                        cursor: 'pointer',
                        transition: 'color 170ms ease',
                        '&:hover': {
                          color: APP_TEXT_PRIMARY,
                        },
                      }}
                    >
                      {link.label}
                    </Box>
                  ))}
                </Stack>
              </Box>

              <Typography sx={{ textAlign: 'center', color: APP_TEXT_SECONDARY, fontSize: '0.84rem' }}>
                MoRius ©
              </Typography>
            </Box>

            <Typography sx={{ textAlign: 'center', color: APP_TEXT_SECONDARY, fontSize: '0.78rem', mt: 1.05 }}>
              Бондарук Александр Георгиевич | ИНН: 772702320496 | ОГРНИП: 325774600487692 | Почта: alexunderstood8@gmail.com
            </Typography>
          </Box>
        </Box>
      </Box>

      <BaseDialog
        open={selectedNewsItem !== null}
        onClose={handleCloseNewsDetails}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          background: APP_CARD_BACKGROUND,
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 0.8 }}>
          <Stack spacing={0.4}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.04em' }}>
              {selectedNewsItem?.category}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.2 }}>{selectedNewsItem?.title}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.8, overflowX: 'hidden' }}>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', lineHeight: 1.6 }}>
              {selectedNewsItem?.description}
            </Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>{selectedNewsItem?.dateLabel}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseNewsDetails} sx={{ color: APP_TEXT_SECONDARY }}>
            Закрыть
          </Button>
        </DialogActions>
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
        onClose={() => setCharacterManagerOpen(false)}
      />

      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode="manage"
        onClose={() => setInstructionTemplateDialogOpen(false)}
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

function buildDashboardGameTitle(game: StoryGameSummary): string {
  const normalizedTitle = game.title.replace(/\s+/g, ' ').trim()
  if (normalizedTitle.length > 0) {
    return normalizedTitle
  }
  return `Игра #${game.id}`
}

function buildDashboardGameDescription(game: StoryGameSummary): string {
  const descriptionSource = (game.description || game.opening_scene || '').replace(/\s+/g, ' ').trim()
  if (!descriptionSource) {
    return 'Продолжите историю с последнего хода.'
  }
  return descriptionSource
}

export default AuthenticatedHomePage



