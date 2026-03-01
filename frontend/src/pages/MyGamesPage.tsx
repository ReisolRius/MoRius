import { forwardRef, useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type Ref } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grow,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Stack,
  SvgIcon,
  Typography,
  type GrowProps,
  type SelectChangeEvent,
} from '@mui/material'
import type { MouseEvent } from 'react'
import { useRef } from 'react'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
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
import { cloneStoryGame, deleteStoryGame, getStoryGame, listCommunityWorlds, listStoryGames, rateCommunityWorld } from '../services/storyApi'
import { getDisplayStoryTitle, loadStoryTitleMap, persistStoryTitleMap, setStoryTitle, type StoryTitleMap } from '../services/storyTitleStore'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type { StoryCommunityWorldSummary, StoryGameSummary, StoryMessage } from '../types/story'

type MyGamesPageProps = {
  user: AuthUser
  authToken: string
  mode: 'my' | 'all'
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}



type GamesSortMode = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'
type CloneSectionKey = 'instructions' | 'plot' | 'world' | 'main_hero' | 'history'
type CloneSelectionState = Record<CloneSectionKey, boolean>

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const TOP_FILTER_CONTROL_HEIGHT = 48
const TOP_FILTER_CONTROL_RADIUS = '12px'
const TOP_FILTER_TEXT_PADDING_X = '14px'
const TOP_FILTER_TEXT_PADDING_WITH_ICON_X = '46px'
const TOP_FILTER_ICON_OFFSET_X = '12px'
const MY_GAMES_SEARCH_QUERY_MAX_LENGTH = 120
const EMPTY_PREVIEW_TEXT = 'История еще не началась.'
const PREVIEW_ERROR_TEXT = 'Не удалось загрузить превью этой истории.'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
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

const SORT_OPTIONS: Array<{ value: GamesSortMode; label: string }> = [
  { value: 'updated_desc', label: 'Недавние' },
  { value: 'updated_asc', label: 'Старые' },
  { value: 'created_desc', label: 'Созданы: новые' },
  { value: 'created_asc', label: 'Созданы: старые' },
]

const MY_GAMES_SKELETON_CARD_KEYS = Array.from({ length: 9 }, (_, index) => `my-game-skeleton-${index}`)

function sortGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort(
    (left, right) =>
      new Date(right.last_activity_at).getTime() - new Date(left.last_activity_at).getTime() || right.id - left.id,
  )
}

function sortGames(games: StoryGameSummary[], mode: GamesSortMode): StoryGameSummary[] {
  const sorted = [...games]
  sorted.sort((left, right) => {
    if (mode === 'updated_desc') {
      return new Date(right.last_activity_at).getTime() - new Date(left.last_activity_at).getTime()
    }
    if (mode === 'updated_asc') {
      return new Date(left.last_activity_at).getTime() - new Date(right.last_activity_at).getTime()
    }
    if (mode === 'created_desc') {
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  })
  return sorted
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

function normalizePreview(messages: StoryMessage[]): string {
  const source = [...messages]
    .reverse()
    .find((message) => message.content.replace(/\s+/g, ' ').trim().length > 0)

  if (!source) {
    return EMPTY_PREVIEW_TEXT
  }

  const compact = source.content.replace(/\s+/g, ' ').trim()
  if (compact.length <= 145) {
    return compact
  }
  return `${compact.slice(0, 142)}...`
}

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

function SortGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 21, height: 21 }}>
      <path
        d="M4 7h16v2H4zm4 4h12v2H8zm4 4h8v2h-8z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function EditGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="m15.7 3.3 5 5-9.8 9.8-5.8.8.8-5.8zm-11.2 16.4h15.5v1.8H4.5z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function CloneGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="M8 8h10a2 2 0 0 1 2 2v10H10a2 2 0 0 1-2-2zm-4-4h10a2 2 0 0 1 2 2v1.8H8A3.8 3.8 0 0 0 4.2 12V20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function DeleteGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="M8 4h8l1 2h4v2H3V6h4zm1 6h2v8H9zm4 0h2v8h-2zm-7 0h12l-1 10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function RatingGlyph() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="m12 3 2.6 5.3 5.9.8-4.3 4.2 1 5.9L12 16.4 6.8 19.2l1-5.9L3.5 9l5.9-.8z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

function MyGamesPage({ user, authToken, mode, onNavigate, onUserUpdate, onLogout }: MyGamesPageProps) {
  const [games, setGames] = useState<StoryGameSummary[]>([])
  const [gamePreviews, setGamePreviews] = useState<Record<number, string>>({})
  const [isLoadingGames, setIsLoadingGames] = useState(true)
  const [communityWorldById, setCommunityWorldById] = useState<Record<number, StoryCommunityWorldSummary>>({})
  const [ratingDialogGame, setRatingDialogGame] = useState<StoryGameSummary | null>(null)
  const [ratingDraft, setRatingDraft] = useState(0)
  const [isRatingSaving, setIsRatingSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
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
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<GamesSortMode>('updated_desc')
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
  const [gameMenuAnchorEl, setGameMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [gameMenuGameId, setGameMenuGameId] = useState<number | null>(null)
  const [deletingGameId, setDeletingGameId] = useState<number | null>(null)
  const [cloneDialogSourceGame, setCloneDialogSourceGame] = useState<StoryGameSummary | null>(null)
  const [cloneSelection, setCloneSelection] = useState<CloneSelectionState>({ ...DEFAULT_CLONE_SELECTION })
  const [isGameCloning, setIsGameCloning] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCustomTitleMap(loadStoryTitleMap())
  }, [])

  const loadGames = useCallback(async () => {
    setErrorMessage('')
    setIsLoadingGames(true)
    try {
      const loadedGames = await listStoryGames(authToken)
      const sortedGames = sortGamesByActivity(loadedGames)
      setGames(sortedGames)
      setCustomTitleMap((previousMap) => {
        let nextMap = previousMap
        let hasChanges = false
        sortedGames.forEach((game) => {
          if (previousMap[game.id]?.trim()) {
            return
          }
          nextMap = setStoryTitle(nextMap, game.id, game.title)
          hasChanges = true
        })
        if (hasChanges) {
          persistStoryTitleMap(nextMap)
          return nextMap
        }
        return previousMap
      })

      const previews = await Promise.all(
        sortedGames.map(async (game) => {
          try {
            const payload = await getStoryGame({ token: authToken, gameId: game.id })
            return [game.id, normalizePreview(payload.messages)] as const
          } catch {
            return [game.id, PREVIEW_ERROR_TEXT] as const
          }
        }),
      )

      setGamePreviews(Object.fromEntries(previews))

      try {
        const communityWorlds = await listCommunityWorlds(authToken)
        setCommunityWorldById(Object.fromEntries(communityWorlds.map((world) => [world.id, world])))
      } catch {
        setCommunityWorldById({})
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
      setErrorMessage(detail)
      setGames([])
      setGamePreviews({})
      setCommunityWorldById({})
    } finally {
      setIsLoadingGames(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadGames()
  }, [loadGames])

  const handleOpenWorldCreator = useCallback(() => {
    onNavigate('/worlds/new')
  }, [onNavigate])

  const handleOpenGameMenu = useCallback((event: MouseEvent<HTMLButtonElement>, gameId: number) => {
    event.preventDefault()
    event.stopPropagation()
    setGameMenuAnchorEl(event.currentTarget)
    setGameMenuGameId(gameId)
  }, [])

  const handleCloseGameMenu = useCallback(() => {
    setGameMenuAnchorEl(null)
    setGameMenuGameId(null)
  }, [])

  const handleEditGameFromMenu = useCallback(() => {
    if (!gameMenuGameId) {
      return
    }
    onNavigate(`/worlds/${gameMenuGameId}/edit`)
    handleCloseGameMenu()
  }, [gameMenuGameId, handleCloseGameMenu, onNavigate])

  const handleOpenCloneDialogFromMenu = useCallback(() => {
    if (!gameMenuGameId) {
      return
    }
    const targetGame = games.find((game) => game.id === gameMenuGameId) ?? null
    if (!targetGame) {
      return
    }
    setCloneDialogSourceGame(targetGame)
    setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
    handleCloseGameMenu()
  }, [gameMenuGameId, games, handleCloseGameMenu])

  const handleCloseCloneDialog = useCallback(() => {
    if (isGameCloning) {
      return
    }
    setCloneDialogSourceGame(null)
    setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
  }, [isGameCloning])

  const handleToggleCloneSection = useCallback((key: CloneSectionKey) => {
    setCloneSelection((previous) => ({
      ...previous,
      [key]: !previous[key],
    }))
  }, [])

  const handleSubmitGameClone = useCallback(async () => {
    if (!cloneDialogSourceGame || isGameCloning) {
      return
    }
    setErrorMessage('')
    setIsGameCloning(true)
    try {
      await cloneStoryGame({
        token: authToken,
        gameId: cloneDialogSourceGame.id,
        copy_instructions: cloneSelection.instructions,
        copy_plot: cloneSelection.plot,
        copy_world: cloneSelection.world,
        copy_main_hero: cloneSelection.main_hero,
        copy_history: cloneSelection.history,
      })
      setCloneDialogSourceGame(null)
      setCloneSelection({ ...DEFAULT_CLONE_SELECTION })
      await loadGames()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось клонировать мир'
      setErrorMessage(detail)
    } finally {
      setIsGameCloning(false)
    }
  }, [authToken, cloneDialogSourceGame, cloneSelection, isGameCloning, loadGames])

  const handleDeleteGameFromMenu = useCallback(async () => {
    if (!gameMenuGameId || deletingGameId !== null) {
      return
    }
    setDeletingGameId(gameMenuGameId)
    setErrorMessage('')
    try {
      await deleteStoryGame({
        token: authToken,
        gameId: gameMenuGameId,
      })
      setGames((previous) => previous.filter((game) => game.id !== gameMenuGameId))
      setGamePreviews((previous) => {
        const next = { ...previous }
        delete next[gameMenuGameId]
        return next
      })
      setCustomTitleMap((previous) => {
        if (!(gameMenuGameId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[gameMenuGameId]
        persistStoryTitleMap(next)
        return next
      })
      setGameMenuAnchorEl(null)
      setGameMenuGameId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить мир'
      setErrorMessage(detail)
    } finally {
      setDeletingGameId(null)
    }
  }, [authToken, deletingGameId, gameMenuGameId])

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
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setTopUpDialogOpen(false)
    setInstructionTemplateDialogOpen(false)
    setCharacterManagerOpen(true)
  }

  const handleOpenInstructionTemplateDialog = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
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

  const handleOpenRatingDialog = useCallback(
    (game: StoryGameSummary) => {
      if (!game.source_world_id) {
        return
      }

      const currentRating = communityWorldById[game.source_world_id]?.user_rating ?? 0
      setRatingDraft(currentRating)
      setRatingDialogGame(game)
      setErrorMessage('')
    },
    [communityWorldById],
  )

  const handleSubmitRating = useCallback(async () => {
    if (!ratingDialogGame?.source_world_id || ratingDraft < 1 || ratingDraft > 5 || isRatingSaving) {
      return
    }

    setIsRatingSaving(true)
    try {
      const updatedWorld = await rateCommunityWorld({
        token: authToken,
        worldId: ratingDialogGame.source_world_id,
        rating: ratingDraft,
      })
      setCommunityWorldById((previous) => ({
        ...previous,
        [updatedWorld.id]: updatedWorld,
      }))
      setRatingDialogGame(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setErrorMessage(detail)
    } finally {
      setIsRatingSaving(false)
    }
  }, [authToken, isRatingSaving, ratingDialogGame, ratingDraft])

  const resolveDisplayTitle = useCallback(
    (gameId: number) => getDisplayStoryTitle(gameId, customTitleMap),
    [customTitleMap],
  )

  const visibleGames = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    const filtered = normalizedSearch
      ? games.filter((game) => {
          const title = resolveDisplayTitle(game.id).toLowerCase()
          const preview = (gamePreviews[game.id] ?? '').toLowerCase()
          return title.includes(normalizedSearch) || preview.includes(normalizedSearch)
        })
      : games

    return sortGames(filtered, sortMode)
  }, [gamePreviews, games, resolveDisplayTitle, searchQuery, sortMode])
  const gameMenuTarget = useMemo(() => {
    if (!gameMenuGameId) {
      return null
    }
    return games.find((game) => game.id === gameMenuGameId) ?? null
  }, [gameMenuGameId, games])
  const pageTitle = mode === 'all' ? 'Сообщество' : 'Мои игры'
  const profileName = user.display_name || 'Игрок'

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
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: mode === 'my', onClick: () => onNavigate('/games') },
          { key: 'games-all', label: 'Сообщество', isActive: mode === 'all', onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen
        onToggleRightPanel={() => undefined}
        rightToggleLabels={{
          expanded: 'Скрыть кнопки шапки',
          collapsed: 'Показать кнопки шапки',
        }}
        hideRightToggle
        onOpenTopUpDialog={handleOpenTopUpDialog}
        rightActions={
          <Stack direction="row" spacing={1.2}>
            <IconButton
              aria-label="Поддержка"
              onClick={(event) => event.preventDefault()}
              sx={{
                display: 'none',
                width: 44,
                height: 44,
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              <Box component="img" src={icons.help} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
            <IconButton
              aria-label="Оформление"
              onClick={(event) => event.preventDefault()}
              sx={{
                display: 'none',
                width: 44,
                height: 44,
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              <Box component="img" src={icons.theme} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
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
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'auto minmax(0, 1fr) 220px 220px' },
              gap: 1.2,
              alignItems: 'center',
              mb: 2,
            }}
          >
            <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.2rem' }, fontWeight: 800, color: APP_TEXT_PRIMARY }}>
              {pageTitle}
            </Typography>

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
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value.slice(0, MY_GAMES_SEARCH_QUERY_MAX_LENGTH))}
                  placeholder="Поиск"
                  maxLength={MY_GAMES_SEARCH_QUERY_MAX_LENGTH}
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
                    fontSize: '1.02rem',
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
                value={sortMode}
                onChange={(event: SelectChangeEvent) => setSortMode(event.target.value as GamesSortMode)}
                IconComponent={() => null}
                sx={{
                  height: TOP_FILTER_CONTROL_HEIGHT,
                  borderRadius: TOP_FILTER_CONTROL_RADIUS,
                  color: APP_TEXT_PRIMARY,
                  px: 0,
                  fontSize: '0.98rem',
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
                  MenuListProps: {
                    sx: {
                      py: 0.45,
                    },
                  },
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.value}
                    value={option.value}
                    sx={{
                      fontSize: '0.96rem',
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
                  display: 'grid',
                  placeItems: 'center',
                  pointerEvents: 'none',
                }}
              >
                <SortGlyph />
              </Box>
            </FormControl>

            <Button
              onClick={handleOpenWorldCreator}
              sx={{
                minHeight: TOP_FILTER_CONTROL_HEIGHT,
                minWidth: 176,
                px: 2.35,
                borderRadius: TOP_FILTER_CONTROL_RADIUS,
                textTransform: 'none',
                color: APP_TEXT_PRIMARY,
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_BUTTON_ACTIVE,
                fontWeight: 700,
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              Новая игра +
            </Button>
          </Box>

          {isLoadingGames ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {MY_GAMES_SKELETON_CARD_KEYS.map((cardKey) => (
                <CommunityWorldCardSkeleton key={cardKey} />
              ))}
            </Box>
          ) : visibleGames.length === 0 ? (
            <Box
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                background: APP_CARD_BACKGROUND,
                p: 2.4,
              }}
            >
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>
                {searchQuery.trim()
                  ? 'По вашему запросу игры не найдены.'
                  : 'Здесь пока нет карточек. Создайте первую игру и начните историю.'}
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {visibleGames.map((game) => {
                const sourceWorld = game.source_world_id ? communityWorldById[game.source_world_id] ?? null : null
                const hasCover = Boolean(game.cover_image_url)
                const descriptionCandidate = (game.description || '').trim() || (gamePreviews[game.id] ?? 'Загружаем превью...')
                const cardDescription = descriptionCandidate.replace(/\s+/g, ' ').trim()
                const communityViews = sourceWorld?.community_views ?? game.community_views
                const communityLaunches = sourceWorld?.community_launches ?? game.community_launches
                const communityRatingAvg = sourceWorld?.community_rating_avg ?? game.community_rating_avg
                const communityRatingCount = sourceWorld?.community_rating_count ?? game.community_rating_count
                return (
                  <Box key={game.id} sx={{ position: 'relative', display: 'flex' }}>
                    <CommunityWorldCard
                      world={{
                        id: game.id,
                        title: resolveDisplayTitle(game.id),
                        description: cardDescription || 'Описание пока не указано.',
                        author_id: user.id,
                        author_name: profileName,
                        author_avatar_url: user.avatar_url ?? null,
                        age_rating: game.age_rating,
                        genres: game.genres,
                        cover_image_url: hasCover ? game.cover_image_url : null,
                        cover_scale: game.cover_scale,
                        cover_position_x: game.cover_position_x,
                        cover_position_y: game.cover_position_y,
                        community_views: communityViews,
                        community_launches: communityLaunches,
                        community_rating_avg: communityRatingAvg,
                        community_rating_count: communityRatingCount,
                        user_rating: sourceWorld?.user_rating ?? null,
                        is_reported_by_user: sourceWorld?.is_reported_by_user ?? false,
                        is_favorited_by_user: sourceWorld?.is_favorited_by_user ?? false,
                        created_at: game.created_at,
                        updated_at: game.updated_at,
                      }}
                      onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                      onClick={() => onNavigate(`/home/${game.id}`)}
                    />

                    <IconButton
                      onClick={(event) => handleOpenGameMenu(event, game.id)}
                      sx={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        zIndex: 2,
                        width: 32,
                        height: 32,
                        borderRadius: 'var(--morius-radius)',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: APP_TEXT_PRIMARY,
                        fontSize: '1rem',
                        '&:hover': {
                          backgroundColor: 'rgba(255,255,255,0.08)',
                        },
                      }}
                    >
                      {String.fromCharCode(8943)}
                    </IconButton>
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>

      <Menu
        anchorEl={gameMenuAnchorEl}
        open={Boolean(gameMenuAnchorEl && gameMenuGameId !== null)}
        onClose={handleCloseGameMenu}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
          },
        }}
      >
        <MenuItem onClick={handleEditGameFromMenu}>
          <Stack direction="row" spacing={1} alignItems="center">
            <EditGlyph />
            <Box component="span">Редактировать</Box>
          </Stack>
        </MenuItem>
        <MenuItem onClick={handleOpenCloneDialogFromMenu}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CloneGlyph />
            <Box component="span">Клонировать</Box>
          </Stack>
        </MenuItem>
        {gameMenuTarget?.source_world_id ? (
          <MenuItem
            onClick={() => {
              handleOpenRatingDialog(gameMenuTarget)
              handleCloseGameMenu()
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <RatingGlyph />
              <Box component="span">Оценить мир</Box>
            </Stack>
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => void handleDeleteGameFromMenu()} disabled={deletingGameId !== null}>
          <Stack direction="row" spacing={1} alignItems="center">
            <DeleteGlyph />
            <Box component="span">{deletingGameId === gameMenuGameId ? 'Удаляем...' : 'Удалить'}</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <BaseDialog
        open={Boolean(cloneDialogSourceGame)}
        onClose={handleCloseCloneDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          background: APP_CARD_BACKGROUND,
        }}
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Клонировать мир</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25}>
            <Typography sx={{ color: APP_TEXT_SECONDARY }}>
              {cloneDialogSourceGame
                ? `Выберите, что перенести в новый мир из «${resolveDisplayTitle(cloneDialogSourceGame.id)}».`
                : 'Выберите, что нужно перенести в новый мир.'}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.85}>
              {CLONE_SECTION_ITEMS.map((item) => {
                const isSelected = cloneSelection[item.key]
                return (
                  <Button
                    key={item.key}
                    onClick={() => handleToggleCloneSection(item.key)}
                    disabled={isGameCloning}
                    sx={{
                      minHeight: 34,
                      px: 1.2,
                      borderRadius: '10px',
                      textTransform: 'none',
                      color: APP_TEXT_PRIMARY,
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: isSelected ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                      '&:hover': {
                        backgroundColor: APP_BUTTON_HOVER,
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
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Пункты можно выбрать или оставить пустыми.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={handleCloseCloneDialog}
            disabled={isGameCloning}
            sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmitGameClone()}
            disabled={isGameCloning}
            sx={{
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              backgroundColor: APP_BUTTON_ACTIVE,
              '&:hover': { backgroundColor: APP_BUTTON_HOVER },
            }}
          >
            {isGameCloning ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Клонировать'}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={Boolean(ratingDialogGame)}
        onClose={() => {
          if (!isRatingSaving) {
            setRatingDialogGame(null)
          }
        }}
        maxWidth="xs"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          background: APP_CARD_BACKGROUND,
        }}
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Оценка мира</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY }}>
              {ratingDialogGame?.source_world_id ? 'Оставьте рейтинг комьюнити-миру от 1 до 5 звезд.' : 'Рейтинг недоступен.'}
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{ratingDialogGame ? resolveDisplayTitle(ratingDialogGame.id) : ''}</Typography>
            <Stack direction="row" justifyContent="center" sx={{ columnGap: 'var(--morius-rating-star-gap)' }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={value}
                  onClick={() => setRatingDraft(value)}
                  disabled={isRatingSaving}
                  sx={{
                    minWidth: 42,
                    minHeight: 42,
                    borderRadius: 'var(--morius-radius)',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: value <= ratingDraft ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    fontSize: '1.15rem',
                  }}
                >
                  {value <= ratingDraft ? String.fromCharCode(9733) : String.fromCharCode(9734)}
                </Button>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={() => setRatingDialogGame(null)}
            disabled={isRatingSaving}
            sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmitRating()}
            disabled={isRatingSaving || ratingDraft < 1 || !ratingDialogGame?.source_world_id}
            sx={{
              textTransform: 'none',
              color: APP_TEXT_PRIMARY,
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              backgroundColor: APP_BUTTON_ACTIVE,
              '&:hover': { backgroundColor: APP_BUTTON_HOVER },
            }}
          >
            {isRatingSaving ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Сохранить'}
          </Button>
        </DialogActions>
      </BaseDialog>
      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
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

export default MyGamesPage



