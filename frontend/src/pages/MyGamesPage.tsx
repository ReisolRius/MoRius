import { forwardRef, useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type Ref } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grow,
  IconButton,
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
import type { AlertColor } from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  type CoinTopUpPlan,
} from '../services/authApi'
import { getStoryGame, listCommunityWorlds, listStoryGames, rateCommunityWorld } from '../services/storyApi'
import { getDisplayStoryTitle, loadStoryTitleMap, type StoryTitleMap } from '../services/storyTitleStore'
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

type PaymentNotice = {
  severity: AlertColor
  text: string
}

type AvatarPlaceholderProps = {
  fallbackLabel: string
  size?: number
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
}

type GamesSortMode = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const EMPTY_PREVIEW_TEXT = 'История еще не началась.'
const PREVIEW_ERROR_TEXT = 'Не удалось загрузить превью этой истории.'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])

const SORT_OPTIONS: Array<{ value: GamesSortMode; label: string }> = [
  { value: 'updated_desc', label: 'Недавние' },
  { value: 'updated_asc', label: 'Старые' },
  { value: 'created_desc', label: 'Созданы: новые' },
  { value: 'created_asc', label: 'Созданы: старые' },
]

const CARD_PALETTES = [
  {
    base: '214, 32%, 17%',
    deep: '223, 40%, 11%',
    accent: '198, 26%, 58%',
    accentSoft: '186, 18%, 52%',
    warm: '34, 22%, 56%',
  },
  {
    base: '206, 30%, 16%',
    deep: '215, 38%, 10%',
    accent: '192, 24%, 56%',
    accentSoft: '210, 20%, 60%',
    warm: '26, 20%, 54%',
  },
  {
    base: '220, 28%, 15%',
    deep: '231, 34%, 9%',
    accent: '208, 22%, 60%',
    accentSoft: '174, 18%, 54%',
    warm: '42, 18%, 52%',
  },
  {
    base: '212, 26%, 14%',
    deep: '222, 32%, 8%',
    accent: '200, 20%, 57%',
    accentSoft: '224, 18%, 62%',
    warm: '30, 16%, 50%',
  },
] as const

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

function buildCardArtwork(gameId: number): string {
  const palette = CARD_PALETTES[gameId % CARD_PALETTES.length]
  const variant = Math.floor(gameId / CARD_PALETTES.length) % 4

  if (variant === 0) {
    return [
      `repeating-radial-gradient(circle at 0 0, hsla(${palette.accent}, 0.18) 0 4px, transparent 4px 18px)`,
      `radial-gradient(circle at 78% 16%, hsla(${palette.warm}, 0.12), transparent 42%)`,
      `linear-gradient(145deg, hsla(${palette.base}, 0.98) 0%, hsla(${palette.deep}, 0.99) 100%)`,
    ].join(', ')
  }

  if (variant === 1) {
    return [
      `repeating-linear-gradient(28deg, hsla(${palette.accentSoft}, 0.2) 0 10px, transparent 10px 24px)`,
      `repeating-linear-gradient(118deg, hsla(${palette.warm}, 0.14) 0 12px, transparent 12px 26px)`,
      `linear-gradient(160deg, hsla(${palette.base}, 0.98) 0%, hsla(${palette.deep}, 0.99) 100%)`,
    ].join(', ')
  }

  if (variant === 2) {
    return [
      `repeating-conic-gradient(from 0deg at 84% 14%, hsla(${palette.accent}, 0.22) 0deg 22deg, transparent 22deg 46deg)`,
      `radial-gradient(circle at 12% 82%, hsla(${palette.accentSoft}, 0.2), transparent 48%)`,
      `linear-gradient(155deg, hsla(${palette.base}, 0.97) 0%, hsla(${palette.deep}, 0.99) 100%)`,
    ].join(', ')
  }

  return [
    `repeating-linear-gradient(90deg, hsla(${palette.accent}, 0.18) 0 2px, transparent 2px 14px)`,
    `repeating-linear-gradient(0deg, hsla(${palette.warm}, 0.12) 0 16px, transparent 16px 32px)`,
    `radial-gradient(circle at 70% 18%, hsla(${palette.accentSoft}, 0.18), transparent 46%)`,
    `linear-gradient(165deg, hsla(${palette.base}, 0.98) 0%, hsla(${palette.deep}, 0.99) 100%)`,
  ].join(', ')
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

function toStarLabel(value: number): string {
  const safeValue = Math.max(0, Math.min(5, Math.round(value)))
  return '★'.repeat(safeValue) + '☆'.repeat(5 - safeValue)
}

const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

function AvatarPlaceholder({ fallbackLabel, size = HEADER_AVATAR_SIZE }: AvatarPlaceholderProps) {
  const headSize = Math.max(12, Math.round(size * 0.27))
  const bodyWidth = Math.max(18, Math.round(size * 0.42))
  const bodyHeight = Math.max(10, Math.round(size * 0.21))

  return (
    <Box
      aria-label="Нет аватарки"
      title={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid rgba(186, 202, 214, 0.28)',
        background: 'linear-gradient(180deg, rgba(38, 45, 57, 0.9), rgba(18, 22, 30, 0.96))',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Stack alignItems="center" spacing={0.4}>
        <Box
          sx={{
            width: headSize,
            height: headSize,
            borderRadius: '50%',
            backgroundColor: 'rgba(196, 208, 224, 0.92)',
          }}
        />
        <Box
          sx={{
            width: bodyWidth,
            height: bodyHeight,
            borderRadius: '10px 10px 7px 7px',
            backgroundColor: 'rgba(196, 208, 224, 0.92)',
          }}
        />
      </Stack>
    </Box>
  )
}

function UserAvatar({ user, size = HEADER_AVATAR_SIZE }: UserAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const fallbackLabel = user.display_name || user.email

  if (user.avatar_url && user.avatar_url !== failedImageUrl) {
    return (
      <Box
        component="img"
        src={user.avatar_url}
        alt={fallbackLabel}
        onError={() => setFailedImageUrl(user.avatar_url)}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          objectFit: 'cover',
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      />
    )
  }

  return <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
}

function MyGamesPage({ user, authToken, mode, onNavigate, onUserUpdate, onLogout }: MyGamesPageProps) {
  const [games, setGames] = useState<StoryGameSummary[]>([])
  const [gamePreviews, setGamePreviews] = useState<Record<number, string>>({})
  const [isLoadingGames, setIsLoadingGames] = useState(true)
  const [communityWorldById, setCommunityWorldById] = useState<Record<number, StoryCommunityWorldSummary>>({})
  const [ratingDialogGame, setRatingDialogGame] = useState<StoryGameSummary | null>(null)
  const [ratingDraft, setRatingDraft] = useState(0)
  const [isRatingSaving, setIsRatingSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [characterManagerOpen, setCharacterManagerOpen] = useState(false)
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<GamesSortMode>('updated_desc')
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
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

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
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
    setTopUpDialogOpen(false)
    onLogout()
  }

  const handleOpenCharacterManager = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setTopUpDialogOpen(false)
    setCharacterManagerOpen(true)
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
    setIsAvatarSaving(true)
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: dataUrl,
      })
      onUserUpdate(updatedUser)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (isAvatarSaving) {
      return
    }

    setAvatarError('')
    setIsAvatarSaving(true)
    try {
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: null,
      })
      onUserUpdate(updatedUser)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

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
          setPaymentNotice({
            severity: 'success',
            text: `Баланс пополнен: +${response.coins} монет.`,
          })
          return
        }

        if (response.status === 'canceled') {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
          setPaymentNotice({
            severity: 'error',
            text: 'Оплата не прошла. Можно попробовать снова.',
          })
          return
        }

        if (!FINAL_PAYMENT_STATUSES.has(response.status)) {
          setPaymentNotice({
            severity: 'info',
            text: 'Платеж обрабатывается. Монеты будут начислены после подтверждения оплаты.',
          })
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось проверить статус оплаты'
        setPaymentNotice({
          severity: 'error',
          text: detail,
        })
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
    (event: MouseEvent<HTMLButtonElement>, game: StoryGameSummary) => {
      event.preventDefault()
      event.stopPropagation()
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

  const pageTitle = mode === 'all' ? 'Все игры' : 'Мои игры'
  const profileName = user.display_name || 'Игрок'

  const formatUpdatedAtLabel = (value: string) => `Обновлено ${new Date(value).toLocaleString('ru-RU')}`

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
          { key: 'games-all', label: 'Все игры', isActive: mode === 'all', onClick: () => onNavigate('/games/all') },
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
        rightActions={
          <Stack direction="row" spacing={1.2}>
            <IconButton
              aria-label="Поддержка"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
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
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
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
              onClick={() => setProfileDialogOpen(true)}
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
          pt: { xs: '82px', md: '88px' },
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
          {paymentNotice ? (
            <Alert severity={paymentNotice.severity} onClose={() => setPaymentNotice(null)} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {paymentNotice.text}
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

            <Box
              sx={{
                position: 'relative',
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                minHeight: 54,
              }}
            >
              <Box
                component="input"
                value={searchQuery}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
                placeholder="Поиск"
                sx={{
                  width: '100%',
                  minHeight: 54,
                  borderRadius: '14px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: APP_TEXT_PRIMARY,
                  pl: 1.4,
                  pr: 5.2,
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
                  right: 1.1,
                  transform: 'translateY(-50%)',
                  color: APP_TEXT_SECONDARY,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <SearchGlyph />
              </Box>
            </Box>

            <FormControl
              sx={{
                position: 'relative',
                minHeight: 54,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
              }}
            >
              <Select
                value={sortMode}
                onChange={(event: SelectChangeEvent) => setSortMode(event.target.value as GamesSortMode)}
                IconComponent={() => null}
                sx={{
                  minHeight: 54,
                  borderRadius: '14px',
                  color: APP_TEXT_PRIMARY,
                  pl: 0.2,
                  pr: 4.4,
                  fontSize: '0.98rem',
                  '& .MuiSelect-select': {
                    py: 1.2,
                    pl: 1.15,
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
                      border: `1px solid ${APP_BORDER_COLOR}`,
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
                  right: 1.05,
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
                minHeight: 54,
                minWidth: 176,
                borderRadius: '12px',
                textTransform: 'none',
                color: APP_TEXT_PRIMARY,
                border: `1px solid ${APP_BORDER_COLOR}`,
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
            <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
              <CircularProgress size={34} />
            </Stack>
          ) : visibleGames.length === 0 ? (
            <Box
              sx={{
                borderRadius: '16px',
                border: `1px solid ${APP_BORDER_COLOR}`,
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
                return (
                  <Button
                    key={game.id}
                    onClick={() => onNavigate(`/home/${game.id}`)}
                    sx={{
                      borderRadius: '20px',
                      minHeight: { xs: 300, md: 330 },
                      p: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      textTransform: 'none',
                      textAlign: 'left',
                      border: `1px solid ${APP_BORDER_COLOR}`,
                      overflow: 'hidden',
                      background: APP_CARD_BACKGROUND,
                      color: APP_TEXT_PRIMARY,
                      transition: 'transform 180ms ease, border-color 180ms ease',
                      '&:hover': {
                        borderColor: 'rgba(203, 216, 234, 0.38)',
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <Box
                      sx={{
                        minHeight: { xs: 174, md: 194 },
                        backgroundImage: buildCardArtwork(game.id),
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        position: 'relative',
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          background:
                            'linear-gradient(180deg, rgba(5, 8, 12, 0.14) 0%, rgba(5, 8, 12, 0.24) 58%, rgba(5, 8, 12, 0.42) 100%)',
                        }}
                      />
                    </Box>
                    <Box
                      sx={{
                        width: '100%',
                        px: { xs: 1.2, md: 1.35 },
                        py: { xs: 1.05, md: 1.2 },
                        background: 'linear-gradient(180deg, rgba(15, 29, 52, 0.92) 0%, rgba(9, 20, 39, 0.96) 100%)',
                        borderTop: '1px solid rgba(88, 116, 156, 0.42)',
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: { xs: '1.12rem', md: '1.16rem' },
                          fontWeight: 800,
                          lineHeight: 1.2,
                          color: APP_TEXT_PRIMARY,
                          mb: 0.62,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {resolveDisplayTitle(game.id)}
                      </Typography>
                      <Typography
                        sx={{
                          color: APP_TEXT_SECONDARY,
                          fontSize: { xs: '0.92rem', md: '0.95rem' },
                          lineHeight: 1.4,
                          mb: 0.95,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {gamePreviews[game.id] ?? 'Загружаем превью...'}
                      </Typography>
                      {game.source_world_id ? (
                        <Stack spacing={0.3} sx={{ mb: 0.8 }}>
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem' }}>
                            {sourceWorld
                              ? `Комьюнити: просмотры ${sourceWorld.community_views}, запуски ${sourceWorld.community_launches}`
                              : 'Комьюнити мир'}
                          </Typography>
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem' }}>
                            {sourceWorld
                              ? `Рейтинг ${sourceWorld.community_rating_avg.toFixed(1)} (${sourceWorld.community_rating_count})`
                              : 'Рейтинг: откройте оценку'}
                          </Typography>
                          <Button
                            onClick={(event) => handleOpenRatingDialog(event, game)}
                            disabled={isRatingSaving}
                            sx={{
                              alignSelf: 'flex-start',
                              minHeight: 28,
                              px: 1,
                              py: 0.2,
                              borderRadius: '8px',
                              textTransform: 'none',
                              color: APP_TEXT_PRIMARY,
                              border: `1px solid ${APP_BORDER_COLOR}`,
                              backgroundColor: 'rgba(34, 51, 79, 0.44)',
                              fontSize: '0.78rem',
                            }}
                          >
                            {sourceWorld?.user_rating ? `Ваша оценка: ${toStarLabel(sourceWorld.user_rating)}` : 'Оценить мир'}
                          </Button>
                        </Stack>
                      ) : null}
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                        {formatUpdatedAtLabel(game.last_activity_at)}
                      </Typography>
                    </Box>
                  </Button>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>

      <Dialog
        open={Boolean(ratingDialogGame)}
        onClose={() => {
          if (!isRatingSaving) {
            setRatingDialogGame(null)
          }
        }}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Оценка мира</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY }}>
              {ratingDialogGame?.source_world_id ? 'Оставьте рейтинг комьюнити-миру от 1 до 5 звезд.' : 'Рейтинг недоступен.'}
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{ratingDialogGame ? resolveDisplayTitle(ratingDialogGame.id) : ''}</Typography>
            <Stack direction="row" spacing={0.5} justifyContent="center">
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={value}
                  onClick={() => setRatingDraft(value)}
                  disabled={isRatingSaving}
                  sx={{
                    minWidth: 42,
                    minHeight: 42,
                    borderRadius: '10px',
                    border: `1px solid ${APP_BORDER_COLOR}`,
                    backgroundColor: value <= ratingDraft ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    fontSize: '1.15rem',
                  }}
                >
                  {value <= ratingDraft ? '★' : '☆'}
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
              border: `1px solid ${APP_BORDER_COLOR}`,
              backgroundColor: APP_BUTTON_ACTIVE,
              '&:hover': { backgroundColor: APP_BUTTON_HOVER },
            }}
          >
            {isRatingSaving ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={profileDialogOpen}
        onClose={handleCloseProfileDialog}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.76)',
            backdropFilter: 'blur(5px)',
          },
        }}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1.4 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.6rem' }}>Профиль</Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 0.2 }}>
          <Stack spacing={2.2}>
            <Stack direction="row" spacing={1.8} alignItems="center">
              <Box
                role="button"
                tabIndex={0}
                aria-label="Изменить аватар"
                onClick={handleChooseAvatar}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleChooseAvatar()
                  }
                }}
                sx={{
                  position: 'relative',
                  width: 84,
                  height: 84,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  cursor: isAvatarSaving ? 'default' : 'pointer',
                  outline: 'none',
                  '&:hover .morius-profile-avatar-overlay': {
                    opacity: isAvatarSaving ? 0 : 1,
                  },
                  '&:focus-visible .morius-profile-avatar-overlay': {
                    opacity: isAvatarSaving ? 0 : 1,
                  },
                }}
              >
                <UserAvatar user={user} size={84} />
                <Box
                  className="morius-profile-avatar-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(7, 11, 19, 0.58)',
                    opacity: 0,
                    transition: 'opacity 180ms ease',
                  }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      border: '1px solid rgba(219, 221, 231, 0.5)',
                      backgroundColor: 'rgba(17, 20, 27, 0.78)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: APP_TEXT_PRIMARY,
                      fontSize: '1.12rem',
                      fontWeight: 700,
                    }}
                  >
                    ✎
                  </Box>
                </Box>
              </Box>
              <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '1.24rem', fontWeight: 700 }}>{profileName}</Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '0.94rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.email}
                </Typography>
              </Stack>
            </Stack>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={handleRemoveAvatar}
                disabled={isAvatarSaving || !user.avatar_url}
                sx={{
                  minHeight: 40,
                  borderColor: APP_BORDER_COLOR,
                  color: APP_TEXT_SECONDARY,
                }}
              >
                {isAvatarSaving ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Удалить'}
              </Button>
            </Stack>

            {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

            <Box
              sx={{
                borderRadius: '12px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                px: 1.5,
                py: 1.2,
              }}
            >
              <Stack spacing={1.3}>
                <Stack direction="row" spacing={1.1} alignItems="center">
                  <Box component="img" src={icons.coin} alt="" sx={{ width: 20, height: 20, opacity: 0.92 }} />
                  <Typography sx={{ fontSize: '0.98rem', color: 'text.secondary' }}>
                    Монеты: {user.coins.toLocaleString('ru-RU')}
                  </Typography>
                </Stack>
                <Button
                  variant="contained"
                  onClick={handleOpenTopUpDialog}
                  sx={{
                    minHeight: 40,
                    borderRadius: '10px',
                    border: `1px solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_BUTTON_ACTIVE,
                    color: APP_TEXT_PRIMARY,
                    fontWeight: 700,
                    '&:hover': {
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                  }}
                >
                  Пополнить баланс
                </Button>
              </Stack>
            </Box>

            <Button
              variant="outlined"
              onClick={handleOpenCharacterManager}
              sx={{
                minHeight: 42,
                borderColor: 'rgba(186, 202, 214, 0.38)',
                color: APP_TEXT_PRIMARY,
                '&:hover': {
                  borderColor: 'rgba(206, 220, 237, 0.54)',
                  backgroundColor: 'rgba(34, 45, 62, 0.32)',
                },
              }}
            >
              Мои персонажи
            </Button>
            <Button
              variant="outlined"
              onClick={() => setConfirmLogoutOpen(true)}
              sx={{
                minHeight: 42,
                borderColor: 'rgba(228, 120, 120, 0.44)',
                color: 'rgba(251, 190, 190, 0.92)',
                '&:hover': {
                  borderColor: 'rgba(238, 148, 148, 0.72)',
                  backgroundColor: 'rgba(214, 86, 86, 0.14)',
                },
              }}
            >
              Выйти из аккаунта
            </Button>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.4, pt: 0.6 }}>
          <Button onClick={handleCloseProfileDialog} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={topUpDialogOpen}
        onClose={handleCloseTopUpDialog}
        maxWidth="md"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.8 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.55rem' }}>Пополнение монет</Typography>
          <Typography sx={{ color: 'text.secondary', mt: 0.6 }}>
            Выберите пакет и нажмите «Купить», чтобы перейти к оплате.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={1.8}>
            {topUpError ? <Alert severity="error">{topUpError}</Alert> : null}
            {isTopUpPlansLoading ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
                <CircularProgress size={30} />
              </Stack>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.6,
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                }}
              >
                {topUpPlans.map((plan) => {
                  const isBuying = activePlanPurchaseId === plan.id
                  return (
                    <Box
                      key={plan.id}
                      sx={{
                        borderRadius: '14px',
                        border: `1px solid ${APP_BORDER_COLOR}`,
                        background: APP_CARD_BACKGROUND,
                        px: 2,
                        py: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: 210,
                      }}
                    >
                      <Stack spacing={0.7}>
                        <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>{plan.title}</Typography>
                        <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: APP_TEXT_PRIMARY }}>
                          {plan.price_rub} ₽
                        </Typography>
                        <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>
                          {plan.description}
                        </Typography>
                        <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>
                          +{plan.coins.toLocaleString('ru-RU')} монет
                        </Typography>
                      </Stack>
                      <Button
                        variant="contained"
                        disabled={Boolean(activePlanPurchaseId)}
                        onClick={() => void handlePurchasePlan(plan.id)}
                        sx={{
                          mt: 2,
                          minHeight: 40,
                          borderRadius: '10px',
                          border: `1px solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_BUTTON_ACTIVE,
                          color: APP_TEXT_PRIMARY,
                          fontWeight: 700,
                          '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                        }}
                      >
                        {isBuying ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Купить'}
                      </Button>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={handleCloseTopUpDialog} sx={{ color: 'text.secondary' }}>
            Назад
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Подтвердите выход</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            Вы точно хотите выйти из аккаунта? После выхода вы вернетесь на страницу превью.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setConfirmLogoutOpen(false)} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmLogout}
            sx={{
              border: `1px solid ${APP_BORDER_COLOR}`,
              backgroundColor: APP_BUTTON_ACTIVE,
              color: APP_TEXT_PRIMARY,
              '&:hover': { backgroundColor: APP_BUTTON_HOVER },
            }}
          >
            Выйти
          </Button>
        </DialogActions>
      </Dialog>

      <CharacterManagerDialog
        open={characterManagerOpen}
        authToken={authToken}
        onClose={() => setCharacterManagerOpen(false)}
      />
    </Box>
  )
}

export default MyGamesPage
