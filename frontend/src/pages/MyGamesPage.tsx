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
  Grow,
  IconButton,
  Stack,
  Typography,
  type GrowProps,
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
const EMPTY_PREVIEW_TEXT = 'История еще не началась.'
const PREVIEW_ERROR_TEXT = 'Не удалось загрузить превью этой истории.'

const SORT_OPTIONS: Array<{ value: GamesSortMode; label: string }> = [
  { value: 'updated_desc', label: 'Упорядочить по дате: новые' },
  { value: 'updated_asc', label: 'Упорядочить по дате: старые' },
  { value: 'created_desc', label: 'Сначала новые игры' },
  { value: 'created_asc', label: 'Сначала старые игры' },
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
  const pageDescription =
    mode === 'all'
      ? 'Открывайте любую историю и продолжайте приключение.'
      : 'Продолжайте начатые истории или создайте новую игру.'

  const menuButtonSx = (isActive: boolean) => ({
    width: '100%',
    justifyContent: 'flex-start',
    borderRadius: '14px',
    minHeight: 52,
    px: 1.8,
    color: isActive ? '#f5f8ff' : '#d8dee9',
    textTransform: 'none',
    fontWeight: 700,
    fontSize: '1.02rem',
    border: '1px solid rgba(186, 202, 214, 0.12)',
    background: isActive
      ? 'linear-gradient(90deg, rgba(77, 84, 96, 0.62), rgba(39, 44, 53, 0.56))'
      : 'linear-gradient(90deg, rgba(54, 57, 62, 0.58), rgba(31, 34, 40, 0.52))',
    '&:hover': {
      background: 'linear-gradient(90deg, rgba(68, 71, 77, 0.62), rgba(38, 42, 49, 0.58))',
    },
  })

  return (
    <Box
      sx={{
        minHeight: '100svh',
        color: '#d6dbe4',
        background:
          'radial-gradient(circle at 68% -8%, rgba(173, 107, 44, 0.07), transparent 42%), linear-gradient(180deg, #04070d 0%, #02050a 100%)',
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
          borderBottom: '1px solid rgba(186, 202, 214, 0.12)',
          backdropFilter: 'blur(8px)',
          background: 'linear-gradient(180deg, rgba(5, 7, 11, 0.9) 0%, rgba(5, 7, 11, 0.8) 100%)',
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
          sx={{
            width: 44,
            height: 44,
            borderRadius: '14px',
            border: '1px solid rgba(186, 202, 214, 0.14)',
            backgroundColor: 'rgba(16, 20, 27, 0.82)',
          }}
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
          border: '1px solid rgba(186, 202, 214, 0.12)',
          background:
            'linear-gradient(180deg, rgba(17, 21, 29, 0.86) 0%, rgba(13, 16, 22, 0.93) 100%), radial-gradient(circle at 40% 0%, rgba(186, 202, 214, 0.06), transparent 60%)',
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

          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.2rem' }, fontWeight: 800, color: '#e4ebf7' }}>
              {pageTitle}
            </Typography>
            <Typography sx={{ color: 'rgba(191, 202, 220, 0.78)', fontSize: '1.02rem' }}>{pageDescription}</Typography>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 260px 170px' },
              gap: 1.2,
              mb: 2,
            }}
          >
            <Box
              component="input"
              value={searchQuery}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
              placeholder="Введите название игры для поиска..."
              sx={{
                width: '100%',
                minHeight: 54,
                borderRadius: '14px',
                border: '1px solid rgba(186, 202, 214, 0.14)',
                backgroundColor: 'rgba(23, 34, 52, 0.72)',
                color: '#dce3ef',
                px: 1.4,
                outline: 'none',
                fontSize: '1.02rem',
                '&::placeholder': {
                  color: 'rgba(188, 200, 218, 0.62)',
                },
              }}
            />

            <Box
              component="select"
              value={sortMode}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortMode(event.target.value as GamesSortMode)}
              sx={{
                width: '100%',
                minHeight: 54,
                borderRadius: '14px',
                border: '1px solid rgba(186, 202, 214, 0.14)',
                backgroundColor: 'rgba(24, 35, 53, 0.72)',
                color: '#dce4f2',
                px: 1.2,
                outline: 'none',
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Box>

            <Button
              onClick={() => void handleCreateGame()}
              disabled={isCreatingGame}
              sx={{
                minHeight: 54,
                borderRadius: '14px',
                textTransform: 'none',
                color: '#e4ebf8',
                border: '1px solid rgba(186, 202, 214, 0.2)',
                background: 'linear-gradient(90deg, rgba(30, 41, 61, 0.92), rgba(26, 34, 49, 0.9))',
                fontWeight: 700,
                fontSize: '1.02rem',
              }}
            >
              {isCreatingGame ? <CircularProgress size={18} sx={{ color: '#e4ebf8' }} /> : '+ Создать игру'}
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
                border: '1px solid rgba(186, 202, 214, 0.14)',
                background: 'linear-gradient(180deg, rgba(16, 20, 27, 0.7), rgba(11, 14, 20, 0.84))',
                p: 2.4,
              }}
            >
              <Typography sx={{ color: 'rgba(196, 206, 223, 0.72)', fontSize: '1rem' }}>
                {searchQuery.trim()
                  ? 'По вашему запросу игры не найдены.'
                  : 'Здесь пока нет карточек. Создайте первую игру и начните историю.'}
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.3,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, minmax(0, 1fr))',
                  xl: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {visibleGames.map((game) => (
                <Button
                  key={game.id}
                  onClick={() => onNavigate(`/home/${game.id}`)}
                  sx={{
                    borderRadius: '16px',
                    minHeight: { xs: 184, md: 212 },
                    p: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    textTransform: 'none',
                    textAlign: 'left',
                    border: '1px solid rgba(186, 202, 214, 0.14)',
                    overflow: 'hidden',
                    backgroundImage: buildCardArtwork(game.id),
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    color: '#dfe7f5',
                    transition: 'transform 180ms ease, border-color 180ms ease',
                    '&:hover': {
                      borderColor: 'rgba(203, 216, 234, 0.38)',
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      mt: 'auto',
                      width: '100%',
                      px: { xs: 1.2, md: 1.35 },
                      py: { xs: 1.05, md: 1.2 },
                      background:
                        'linear-gradient(180deg, rgba(6, 9, 14, 0.14) 0%, rgba(6, 9, 14, 0.9) 44%, rgba(6, 9, 14, 0.96) 100%)',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: { xs: '1.12rem', md: '1.16rem' },
                        fontWeight: 800,
                        lineHeight: 1.2,
                        color: '#eef3fb',
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
                        color: 'rgba(210, 222, 239, 0.9)',
                        fontSize: { xs: '0.92rem', md: '0.95rem' },
                        lineHeight: 1.4,
                        mb: 0.85,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {gamePreviews[game.id] ?? 'Загружаем превью...'}
                    </Typography>
                    <Typography sx={{ color: 'rgba(176, 188, 206, 0.78)', fontSize: '0.8rem' }}>
                      Обновлено {new Date(game.last_activity_at).toLocaleString('ru-RU')}
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
            border: '1px solid rgba(186, 202, 214, 0.16)',
            background: 'linear-gradient(180deg, rgba(16, 18, 24, 0.97) 0%, rgba(9, 11, 16, 0.98) 100%)',
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
                border: '1px solid rgba(186, 202, 214, 0.16)',
                backgroundColor: 'rgba(12, 16, 22, 0.62)',
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
            border: '1px solid rgba(186, 202, 214, 0.16)',
            background: 'linear-gradient(180deg, rgba(16, 18, 24, 0.98) 0%, rgba(10, 12, 18, 0.99) 100%)',
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
              backgroundColor: '#d9e4f2',
              color: '#171716',
              '&:hover': { backgroundColor: '#edf4fc' },
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
