import { forwardRef, useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type Ref } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  FormControl,
  Grow,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Stack,
  SvgIcon,
  Typography,
  useMediaQuery,
  type GrowProps,
  type SelectChangeEvent,
} from '@mui/material'
import type { MouseEvent } from 'react'
import { useRef } from 'react'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import HeaderAccountActions from '../components/HeaderAccountActions'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import searchIconRaw from '../assets/icons/search.svg?raw'
import searchCloseIconRaw from '../assets/icons/search-close.svg?raw'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import BaseDialog from '../components/dialogs/BaseDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import Footer from '../components/Footer'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
} from '../services/authApi'
import { cloneStoryGame, deleteStoryGame, getCommunityWorld, listStoryGames, rateCommunityWorld } from '../services/storyApi'
import { getDisplayStoryTitle, loadStoryTitleMap, persistStoryTitleMap, setStoryTitle, type StoryTitleMap } from '../services/storyTitleStore'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type { StoryCommunityWorldSummary, StoryGameSummary } from '../types/story'
import { buildUnifiedMobileQuickActions, rememberLastPlayedGameCard } from '../utils/mobileQuickActions'

type MyGamesPageProps = {
  user: AuthUser
  authToken: string
  mode: 'my' | 'all' | 'publications'
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
const CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'
const MY_GAMES_SEARCH_QUERY_MAX_LENGTH = 120
const EMPTY_PREVIEW_TEXT = 'История еще не началась.'
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

function normalizeGamePreview(value: string | null | undefined): string {
  const compact = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!compact) {
    return EMPTY_PREVIEW_TEXT
  }
  if (compact.length <= 145) {
    return compact
  }
  return `${compact.slice(0, 142)}...`
}

function clampCoverPosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 50
  }
  return Math.max(0, Math.min(value, 100))
}

function formatTurnCountLabel(value: number): string {
  const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  const mod10 = normalizedValue % 10
  const mod100 = normalizedValue % 100

  if (mod10 === 1 && mod100 !== 11) {
    return `${normalizedValue} \u0445\u043e\u0434`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${normalizedValue} \u0445\u043e\u0434\u0430`
  }
  return `${normalizedValue} \u0445\u043e\u0434\u043e\u0432`
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
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false)
  const isPhoneLayout = useMediaQuery('(max-width:767px)')
  const [sortMode, setSortMode] = useState<GamesSortMode>('updated_desc')
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
  const [gameMenuAnchorEl, setGameMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [gameMenuGameId, setGameMenuGameId] = useState<number | null>(null)
  const [confirmDeleteGameId, setConfirmDeleteGameId] = useState<number | null>(null)
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
      const loadedGames = await listStoryGames(authToken, { compact: true })
      const sortedGames = sortGamesByActivity(loadedGames)
      rememberLastPlayedGameCard(sortedGames[0] ?? null)
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

      setGamePreviews(
        Object.fromEntries(
          sortedGames.map((game) => [game.id, normalizeGamePreview(game.latest_message_preview)]),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
      setErrorMessage(detail)
      setGames([])
      setGamePreviews({})
    } finally {
      setIsLoadingGames(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadGames()
  }, [loadGames])

  useEffect(() => {
    rememberLastPlayedGameCard(games[0] ?? null)
  }, [games])

  useEffect(() => {
    const missingSourceWorldIds = Array.from(
      new Set(
        games
          .filter((game) => game.visibility !== 'public')
          .map((game) => game.source_world_id)
          .filter((worldId): worldId is number => typeof worldId === 'number' && worldId > 0)
          .filter((worldId) => !communityWorldById[worldId]),
      ),
    )
    if (missingSourceWorldIds.length === 0) {
      return
    }

    let cancelled = false
    void (async () => {
      const loadedEntries = await Promise.allSettled(
        missingSourceWorldIds.map(async (worldId) => {
          const payload = await getCommunityWorld({
            token: authToken,
            worldId,
          })
          return payload.world
        }),
      )
      if (cancelled) {
        return
      }

      const loadedWorldById: Record<number, StoryCommunityWorldSummary> = {}
      loadedEntries.forEach((entry) => {
        if (entry.status !== 'fulfilled') {
          return
        }
        loadedWorldById[entry.value.id] = entry.value
      })
      if (Object.keys(loadedWorldById).length === 0) {
        return
      }
      setCommunityWorldById((previous) => ({
        ...previous,
        ...loadedWorldById,
      }))
    })()

    return () => {
      cancelled = true
    }
  }, [authToken, communityWorldById, games])

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
    onNavigate(`/worlds/${gameMenuGameId}/edit?source=my-games`)
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

  const handleRequestDeleteGameFromMenu = useCallback(() => {
    if (!gameMenuGameId || deletingGameId !== null) {
      return
    }
    setConfirmDeleteGameId(gameMenuGameId)
    handleCloseGameMenu()
  }, [deletingGameId, gameMenuGameId, handleCloseGameMenu])

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

  const handleConfirmDeleteGame = useCallback(async () => {
    if (!confirmDeleteGameId || deletingGameId !== null) {
      return
    }
    const targetGameId = confirmDeleteGameId
    setDeletingGameId(targetGameId)
    setErrorMessage('')
    try {
      await deleteStoryGame({
        token: authToken,
        gameId: targetGameId,
      })
      setGames((previous) => previous.filter((game) => game.id !== targetGameId))
      setGamePreviews((previous) => {
        const next = { ...previous }
        delete next[targetGameId]
        return next
      })
      setCustomTitleMap((previous) => {
        if (!(targetGameId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[targetGameId]
        persistStoryTitleMap(next)
        return next
      })
      if (gameMenuGameId === targetGameId) {
        setGameMenuAnchorEl(null)
        setGameMenuGameId(null)
      }
      setConfirmDeleteGameId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить мир'
      setErrorMessage(detail)
    } finally {
      setDeletingGameId(null)
    }
  }, [authToken, confirmDeleteGameId, deletingGameId, gameMenuGameId])

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
    async (game: StoryGameSummary) => {
      if (!game.source_world_id) {
        return
      }

      const sourceWorldId = game.source_world_id
      const currentRating = communityWorldById[sourceWorldId]?.user_rating ?? 0
      setRatingDraft(currentRating)
      setRatingDialogGame(game)
      setErrorMessage('')

      if (communityWorldById[sourceWorldId]) {
        return
      }

      try {
        const payload = await getCommunityWorld({
          token: authToken,
          worldId: sourceWorldId,
        })
        const loadedWorld = payload.world
        setCommunityWorldById((previous) => ({
          ...previous,
          [loadedWorld.id]: loadedWorld,
        }))
        setRatingDraft(loadedWorld.user_rating ?? 0)
      } catch {
        // Rating dialog stays usable even when source world details are unavailable.
      }
    },
    [authToken, communityWorldById],
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
    const modeFilteredGames =
      mode === 'my'
        ? games.filter((game) => game.visibility !== 'public')
        : mode === 'publications'
          ? games.filter((game) => game.visibility === 'public')
          : games
    const normalizedSearch = searchQuery.trim().toLowerCase()
    const filtered = normalizedSearch
      ? modeFilteredGames.filter((game) => {
          const title = resolveDisplayTitle(game.id).toLowerCase()
          const preview = (gamePreviews[game.id] ?? '').toLowerCase()
          return title.includes(normalizedSearch) || preview.includes(normalizedSearch)
        })
      : modeFilteredGames

    return sortGames(filtered, sortMode)
  }, [gamePreviews, games, mode, resolveDisplayTitle, searchQuery, sortMode])
  const publicationSourceWorldIds = useMemo(
    () =>
      new Set(
        games
          .filter(
            (game) =>
              game.visibility === 'public' &&
              typeof game.source_world_id === 'number' &&
              Number.isFinite(game.source_world_id),
          )
          .map((game) => game.source_world_id as number),
      ),
    [games],
  )
  const gameMenuTarget = useMemo(() => {
    if (!gameMenuGameId) {
      return null
    }
    return games.find((game) => game.id === gameMenuGameId) ?? null
  }, [gameMenuGameId, games])
  const confirmDeleteGameTarget = useMemo(() => {
    if (!confirmDeleteGameId) {
      return null
    }
    return games.find((game) => game.id === confirmDeleteGameId) ?? null
  }, [confirmDeleteGameId, games])
  const pageTitle = mode === 'all' ? 'Сообщество' : mode === 'publications' ? 'Публикации' : 'Библиотека'
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
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        mobileActionItems={buildUnifiedMobileQuickActions({
          onContinue: () => onNavigate('/dashboard?mobileAction=continue'),
          onQuickStart: () => onNavigate('/dashboard?mobileAction=quick-start'),
          onCreateWorld: () => onNavigate('/worlds/new'),
          onOpenShop: handleOpenTopUpDialog,
          continueDescription: games[0]
            ? normalizeGamePreview(games[0].description || games[0].latest_message_preview || games[0].opening_scene)
            : undefined,
          continueHeadline: games[0] ? resolveDisplayTitle(games[0].id) : undefined,
          continueImageSrc: games[0]?.cover_image_url?.trim() || undefined,
          continueImageMode: games[0]?.cover_image_url ? 'cover' : undefined,
          continueImagePosition: games[0]
            ? `${clampCoverPosition(games[0].cover_position_x)}% ${clampCoverPosition(games[0].cover_position_y)}%`
            : undefined,
        })}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: mode === 'my', onClick: () => onNavigate('/games') },
          {
            key: 'games-publications',
            label: 'Мои публикации',
            isActive: mode === 'publications',
            onClick: () => onNavigate('/games/publications'),
          },
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
        onOpenSettingsDialog={() => setProfileDialogOpen(true)}
        hideRightToggle
        onOpenTopUpDialog={handleOpenTopUpDialog}
        centerSlot={
          <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
            <Box
              component="input"
              type="text"
              value={searchQuery}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value.slice(0, MY_GAMES_SEARCH_QUERY_MAX_LENGTH))}
              placeholder="Поиск"
              aria-label="Поиск по библиотеке"
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
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Typography
            sx={{
              mb: 1.4,
              fontSize: { xs: '2.05rem', md: '2.45rem' },
              fontWeight: 900,
              color: APP_TEXT_PRIMARY,
              textAlign: 'center',
            }}
          >
            {pageTitle}
          </Typography>

          {/* Compact pill filter row — matches Community page style */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: '20px' }}>
            {/* Sort select */}
            <FormControl sx={{ position: 'relative', borderRadius: '12px', border: `0.5px solid ${APP_BORDER_COLOR}`, backgroundColor: APP_CARD_BACKGROUND }}>
              <Select
                value={sortMode}
                onChange={(event: SelectChangeEvent) => setSortMode(event.target.value as GamesSortMode)}
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
                {SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value} sx={{ fontSize: '16px', fontWeight: 700, color: APP_TEXT_PRIMARY, '&.Mui-selected': { backgroundColor: APP_BUTTON_ACTIVE }, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
              <Box sx={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', color: APP_TEXT_SECONDARY, pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
                <SortGlyph />
              </Box>
            </FormControl>

            {/* New game button — pill, no border */}
            {mode === 'my' ? (
              <Box
                component="button"
                type="button"
                onClick={handleOpenWorldCreator}
                data-tour-id="my-games-create-button"
                sx={{
                  height: '38px',
                  px: '16px',
                  borderRadius: '9999px',
                  border: 'none',
                  backgroundColor: APP_CARD_BACKGROUND,
                  color: APP_TEXT_PRIMARY,
                  fontSize: '16px',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  transition: 'background-color 150ms ease',
                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                }}
              >
                Новая игра +
              </Box>
            ) : null}
          </Box>

          {isLoadingGames && games.length === 0 ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: CARD_GRID_TEMPLATE_COLUMNS,
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
                gridTemplateColumns: CARD_GRID_TEMPLATE_COLUMNS,
              }}
            >
              {visibleGames.map((game) => {
                const sourceWorld = game.source_world_id ? communityWorldById[game.source_world_id] ?? null : null
                const hasCover = Boolean(game.cover_image_url)
                const descriptionCandidate = (game.description || '').trim() || (gamePreviews[game.id] ?? 'Загружаем превью...')
                const cardDescription = descriptionCandidate.replace(/\s+/g, ' ').trim()
                const turnCountLabel = formatTurnCountLabel(game.turn_count)
                const communityViews = sourceWorld?.community_views ?? game.community_views
                const communityLaunches = sourceWorld?.community_launches ?? game.community_launches
                const communityRatingAvg = sourceWorld?.community_rating_avg ?? game.community_rating_avg
                const communityRatingCount = sourceWorld?.community_rating_count ?? game.community_rating_count
                return (
                  <Box key={game.id} sx={{ position: 'relative', display: 'flex' }}>
                    <CommunityWorldCard
                      world={{
                        id: game.id,
                        title: `${resolveDisplayTitle(game.id)}${publicationSourceWorldIds.has(game.id) ? ' (Частный)' : ''}`,
                        description: cardDescription || 'Описание пока не указано.',
                        author_id: sourceWorld?.author_id ?? (game.source_world_id ? 0 : user.id),
                        author_name: sourceWorld?.author_name ?? (game.source_world_id ? 'Автор сообщества' : profileName),
                        author_avatar_url: sourceWorld?.author_avatar_url ?? (game.source_world_id ? null : user.avatar_url ?? null),
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
                      onAuthorClick={(authorId) => {
                        if (authorId > 0) {
                          onNavigate(`/profile/${authorId}`)
                        }
                      }}
                      onClick={() => onNavigate(`/home/${game.id}`)}
                      coverBadge={
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.8,
                            minHeight: 32,
                            px: 1.15,
                            py: 0.7,
                            borderRadius: '999px',
                            border: '1px solid rgba(214, 226, 244, 0.2)',
                            background:
                              'linear-gradient(180deg, rgba(9, 14, 22, 0.86) 0%, rgba(12, 18, 28, 0.76) 100%)',
                            color: 'rgba(236, 243, 252, 0.96)',
                            backdropFilter: 'blur(12px)',
                            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
                          }}
                        >
                          <Box
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              flexShrink: 0,
                              background:
                                'linear-gradient(180deg, rgba(214, 228, 247, 0.95) 0%, rgba(150, 184, 226, 0.88) 100%)',
                              boxShadow: '0 0 0 4px rgba(197, 216, 241, 0.09)',
                            }}
                          />
                          <Typography
                            sx={{
                              fontSize: { xs: '0.76rem', md: '0.8rem' },
                              lineHeight: 1,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              letterSpacing: '0.01em',
                            }}
                          >
                            {turnCountLabel}
                          </Typography>
                        </Box>
                      }
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
              void handleOpenRatingDialog(gameMenuTarget)
              handleCloseGameMenu()
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <RatingGlyph />
              <Box component="span">Оценить мир</Box>
            </Stack>
          </MenuItem>
        ) : null}
        <MenuItem onClick={handleRequestDeleteGameFromMenu} disabled={deletingGameId !== null}>
          <Stack direction="row" spacing={1} alignItems="center">
            <DeleteGlyph />
            <Box component="span">{deletingGameId === gameMenuGameId ? 'Удаляем...' : 'Удалить'}</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <BaseDialog
        open={Boolean(confirmDeleteGameTarget)}
        onClose={() => {
          if (deletingGameId === null) {
            setConfirmDeleteGameId(null)
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
        <DialogTitle sx={{ fontWeight: 700 }}>Удалить мир?</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: APP_TEXT_SECONDARY }}>
            {confirmDeleteGameTarget
              ? `Мир «${resolveDisplayTitle(confirmDeleteGameTarget.id)}» будет удален без возможности восстановления.`
              : 'Это действие нельзя отменить.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={() => setConfirmDeleteGameId(null)}
            disabled={deletingGameId !== null}
            sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleConfirmDeleteGame()}
            disabled={deletingGameId !== null}
            sx={{
              textTransform: 'none',
              color: 'rgba(251, 190, 190, 0.94)',
              border: `var(--morius-border-width) solid color-mix(in srgb, #d87a7a 56%, ${APP_BORDER_COLOR})`,
              backgroundColor: 'rgba(184, 78, 78, 0.24)',
              '&:hover': { backgroundColor: 'rgba(196, 88, 88, 0.34)' },
            }}
          >
            {deletingGameId !== null ? (
              <CircularProgress size={16} sx={{ color: 'rgba(251, 190, 190, 0.94)' }} />
            ) : (
              'Удалить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

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

      {/* Mobile search overlay */}
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
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value.slice(0, MY_GAMES_SEARCH_QUERY_MAX_LENGTH))}
              placeholder="Поиск"
              aria-label="Поиск по библиотеке"
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
            onClick={() => { setIsMobileSearchOpen(false); setSearchQuery('') }}
            sx={{
              color: 'var(--morius-text-secondary)',
              p: 0.5,
              flexShrink: 0,
              transition: 'color 180ms ease',
              '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
              '&:active': { backgroundColor: 'transparent' },
            }}
          >
            <ThemedSvgIcon markup={searchCloseIconRaw} size={20} />
          </IconButton>
        </Box>
      </Fade>
    </Box>
  )
}

export default MyGamesPage



