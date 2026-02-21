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
import { brandLogo, icons } from '../assets'
import { createStoryGame, getStoryGame, listStoryGames } from '../services/storyApi'
import { getDisplayStoryTitle, loadStoryTitleMap, type StoryTitleMap } from '../services/storyTitleStore'
import type { AuthUser } from '../types/auth'
import type { StoryGameSummary, StoryMessage } from '../types/story'

type MyGamesPageProps = {
  user: AuthUser
  authToken: string
  mode: 'my' | 'all'
  onNavigate: (path: string) => void
  onLogout: () => void
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

const HEADER_AVATAR_SIZE = 44
const APP_PAGE_BACKGROUND = 'radial-gradient(circle at 50% -24%, #141F2D 0%, #111111 62%)'
const APP_CARD_BACKGROUND = '#15181C'
const APP_BORDER_COLOR = '#31302E'
const APP_TEXT_PRIMARY = '#DBDDE7'
const APP_TEXT_SECONDARY = '#A4ADB6'
const APP_BUTTON_HOVER = '#1D2738'
const APP_BUTTON_ACTIVE = '#25354D'
const APP_BUTTON_SHELL = {
  width: 44,
  height: 44,
  borderRadius: '14px',
  border: `1px solid ${APP_BORDER_COLOR}`,
  backgroundColor: APP_CARD_BACKGROUND,
  transition: 'background-color 180ms ease',
  '&:hover': {
    backgroundColor: APP_BUTTON_HOVER,
  },
} as const
const EMPTY_PREVIEW_TEXT = 'История еще не началась.'
const PREVIEW_ERROR_TEXT = 'Не удалось загрузить превью этой истории.'

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

function MyGamesPage({ user, authToken, mode, onNavigate, onLogout }: MyGamesPageProps) {
  const [games, setGames] = useState<StoryGameSummary[]>([])
  const [gamePreviews, setGamePreviews] = useState<Record<number, string>>({})
  const [isLoadingGames, setIsLoadingGames] = useState(true)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<GamesSortMode>('updated_desc')
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})

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

  const handleCreateGame = useCallback(async () => {
    if (isCreatingGame) {
      return
    }
    setErrorMessage('')
    setIsCreatingGame(true)
    try {
      const newGame = await createStoryGame({ token: authToken })
      onNavigate(`/home/${newGame.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
      setErrorMessage(detail)
    } finally {
      setIsCreatingGame(false)
    }
  }, [authToken, isCreatingGame, onNavigate])

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
  }

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    onLogout()
  }

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

  const formatUpdatedAtLabel = (value: string) => `Обновлено ${new Date(value).toLocaleString('ru-RU')}`

  const menuButtonSx = (isActive: boolean) => ({
    width: '100%',
    justifyContent: 'flex-start',
    borderRadius: '14px',
    minHeight: 52,
    px: 1.8,
    color: APP_TEXT_PRIMARY,
    textTransform: 'none',
    fontWeight: 700,
    fontSize: '1.02rem',
    border: `1px solid ${APP_BORDER_COLOR}`,
    backgroundColor: isActive ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
    '&:hover': {
      backgroundColor: APP_BUTTON_HOVER,
    },
  })

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
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 74,
          zIndex: 34,
          borderBottom: `1px solid ${APP_BORDER_COLOR}`,
          backdropFilter: 'blur(8px)',
          backgroundColor: APP_CARD_BACKGROUND,
        }}
      />

      <Box
        sx={{
          position: 'fixed',
          top: 12,
          left: 20,
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: 1.2,
        }}
      >
        <Box component="img" src={brandLogo} alt="Morius" sx={{ width: 76, opacity: 0.96 }} />
        <IconButton
          aria-label={isPageMenuOpen ? 'Свернуть меню страниц' : 'Открыть меню страниц'}
          onClick={() => setIsPageMenuOpen((previous) => !previous)}
          sx={APP_BUTTON_SHELL}
        >
          <Box component="img" src={icons.home} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 82,
          left: 20,
          zIndex: 30,
          width: { xs: 252, md: 276 },
          borderRadius: '14px',
          border: `1px solid ${APP_BORDER_COLOR}`,
          background: APP_CARD_BACKGROUND,
          p: 1.3,
          boxShadow: '0 20px 36px rgba(0, 0, 0, 0.3)',
          transform: isPageMenuOpen ? 'translateX(0)' : 'translateX(-30px)',
          opacity: isPageMenuOpen ? 1 : 0,
          pointerEvents: isPageMenuOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
        }}
      >
        <Stack spacing={1.1}>
          <Button sx={menuButtonSx(false)} onClick={() => onNavigate('/dashboard')}>
            Главная
          </Button>
          <Button sx={menuButtonSx(mode === 'my')} onClick={() => onNavigate('/games')}>
            Мои игры
          </Button>
          <Button sx={menuButtonSx(mode === 'all')} onClick={() => onNavigate('/games/all')}>
            Все игры
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 12,
          right: 20,
          zIndex: 45,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label={isHeaderActionsOpen ? 'Скрыть кнопки шапки' : 'Показать кнопки шапки'}
            onClick={() => setIsHeaderActionsOpen((previous) => !previous)}
            sx={APP_BUTTON_SHELL}
          >
            <Box
              component="img"
              src={icons.arrowback}
              alt=""
              sx={{
                width: 20,
                height: 20,
                opacity: 0.9,
                transform: isHeaderActionsOpen ? 'none' : 'rotate(180deg)',
                transition: 'transform 220ms ease',
              }}
            />
          </IconButton>

          <Box
            sx={{
              ml: isHeaderActionsOpen ? 1.2 : 0,
              maxWidth: isHeaderActionsOpen ? 240 : 0,
              opacity: isHeaderActionsOpen ? 1 : 0,
              transform: isHeaderActionsOpen ? 'translateX(0)' : 'translateX(14px)',
              pointerEvents: isHeaderActionsOpen ? 'auto' : 'none',
              overflow: 'hidden',
              transition: 'max-width 260ms ease, margin-left 260ms ease, opacity 220ms ease, transform 220ms ease',
            }}
          >
            <Stack direction="row" spacing={1.2}>
              <IconButton aria-label="Поддержка" onClick={(event) => event.preventDefault()} sx={APP_BUTTON_SHELL}>
                <Box component="img" src={icons.help} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
              </IconButton>
              <IconButton aria-label="Оформление" onClick={(event) => event.preventDefault()} sx={APP_BUTTON_SHELL}>
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
          </Box>
        </Box>
      </Box>

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
              onClick={() => void handleCreateGame()}
              disabled={isCreatingGame}
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
              {isCreatingGame ? <CircularProgress size={18} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Новая игра +'}
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
              {visibleGames.map((game) => (
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
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                      {formatUpdatedAtLabel(game.last_activity_at)}
                    </Typography>
                  </Box>
                </Button>
              ))}
            </Box>
          )}
        </Box>
      </Box>

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
        <DialogTitle sx={{ pb: 1.2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.55rem' }}>Профиль</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.2 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.6} alignItems="center">
              <UserAvatar user={user} size={72} />
              <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '1.2rem', fontWeight: 700 }}>{user.display_name || 'Игрок'}</Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '0.92rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.email}
                </Typography>
              </Stack>
            </Stack>
            <Box
              sx={{
                borderRadius: '12px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                px: 1.5,
                py: 1.1,
              }}
            >
              <Stack direction="row" spacing={1.1} alignItems="center">
                <Box component="img" src={icons.coin} alt="" sx={{ width: 20, height: 20, opacity: 0.92 }} />
                <Typography sx={{ fontSize: '0.98rem', color: 'text.secondary' }}>
                  Монеты: {user.coins.toLocaleString('ru-RU')}
                </Typography>
              </Stack>
            </Box>
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
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.6 }}>
          <Button onClick={handleCloseProfileDialog} sx={{ color: 'text.secondary' }}>
            Закрыть
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
    </Box>
  )
}

export default MyGamesPage

