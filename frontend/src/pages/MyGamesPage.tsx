import { forwardRef, useCallback, useEffect, useState, type ReactElement, type Ref } from 'react'
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

function sortGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort(
    (left, right) =>
      new Date(right.last_activity_at).getTime() - new Date(left.last_activity_at).getTime() || right.id - left.id,
  )
}

function normalizePreview(messages: StoryMessage[]): string {
  const source = [...messages]
    .reverse()
    .find((message) => message.content.replace(/\s+/g, ' ').trim().length > 0)

  if (!source) {
    return 'История еще не началась.'
  }

  const compact = source.content.replace(/\s+/g, ' ').trim()
  if (compact.length <= 180) {
    return compact
  }
  return `${compact.slice(0, 177)}...`
}

const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

function AvatarPlaceholder({ fallbackLabel, size = 44 }: AvatarPlaceholderProps) {
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

function UserAvatar({ user, size = 44 }: UserAvatarProps) {
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
            return [game.id, 'Не удалось загрузить превью этой истории.'] as const
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
        sx={{
          position: 'fixed',
          top: 20,
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
          top: 92,
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
          top: 20,
          right: 20,
          zIndex: 45,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.2}>
          <IconButton
            aria-label="Вернуться к игре"
            onClick={() => onNavigate('/home')}
            sx={{
              width: 44,
              height: 44,
              borderRadius: '14px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              backgroundColor: 'rgba(16, 20, 27, 0.82)',
            }}
          >
            <Box component="img" src={icons.arrowback} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
          </IconButton>
          <IconButton
            aria-label="Миры"
            sx={{
              width: 44,
              height: 44,
              borderRadius: '14px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              backgroundColor: 'rgba(16, 20, 27, 0.82)',
            }}
          >
            <Box component="img" src={icons.world} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
          </IconButton>
          <IconButton
            aria-label="ИИ"
            sx={{
              width: 44,
              height: 44,
              borderRadius: '14px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              backgroundColor: 'rgba(16, 20, 27, 0.82)',
            }}
          >
            <Box component="img" src={icons.ai} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
          </IconButton>
          <Button
            variant="text"
            onClick={() => setProfileDialogOpen(true)}
            aria-label="Открыть профиль"
            sx={{
              minWidth: 0,
              width: 44,
              height: 44,
              p: 0,
              borderRadius: '50%',
            }}
          >
            <UserAvatar user={user} />
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          pt: { xs: 94, md: 104 },
          pb: { xs: 5, md: 7 },
          px: { xs: 2, md: 3.2 },
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1120 }}>
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Stack spacing={0.6} sx={{ mb: 2.2 }}>
            <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.2rem' }, fontWeight: 800, color: '#e4ebf7' }}>
              {pageTitle}
            </Typography>
            <Typography sx={{ color: 'rgba(191, 202, 220, 0.78)', fontSize: '1.02rem' }}>{pageDescription}</Typography>
          </Stack>

          <Button
            onClick={() => void handleCreateGame()}
            disabled={isCreatingGame}
            sx={{
              width: '100%',
              mb: 2.2,
              borderRadius: '16px',
              minHeight: 84,
              justifyContent: 'flex-start',
              textTransform: 'none',
              px: 2.2,
              border: '1px dashed rgba(192, 205, 223, 0.36)',
              background: 'linear-gradient(90deg, rgba(19, 24, 33, 0.72), rgba(13, 17, 24, 0.82))',
              color: '#dfe7f6',
            }}
          >
            <Stack spacing={0.3} alignItems="flex-start">
              <Typography sx={{ fontSize: '1.08rem', fontWeight: 700 }}>
                {isCreatingGame ? 'Создаём новую игру...' : '+ Создать новую игру'}
              </Typography>
              <Typography sx={{ fontSize: '0.94rem', color: 'rgba(186, 200, 219, 0.76)' }}>
                Откройте новый мир одним кликом.
              </Typography>
            </Stack>
          </Button>

          {isLoadingGames ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
              <CircularProgress size={34} />
            </Stack>
          ) : games.length === 0 ? (
            <Box
              sx={{
                borderRadius: '16px',
                border: '1px solid rgba(186, 202, 214, 0.14)',
                background: 'linear-gradient(180deg, rgba(16, 20, 27, 0.7), rgba(11, 14, 20, 0.84))',
                p: 2.4,
              }}
            >
              <Typography sx={{ color: 'rgba(196, 206, 223, 0.72)', fontSize: '1rem' }}>
                Здесь пока нет карточек. Создайте первую игру и начните историю.
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.6,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
              }}
            >
              {games.map((game) => (
                <Button
                  key={game.id}
                  onClick={() => onNavigate(`/home/${game.id}`)}
                  sx={{
                    borderRadius: '14px',
                    minHeight: 170,
                    p: 1.8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 1.1,
                    textTransform: 'none',
                    textAlign: 'left',
                    border: '1px solid rgba(186, 202, 214, 0.14)',
                    background:
                      'linear-gradient(180deg, rgba(24, 29, 39, 0.85), rgba(14, 18, 25, 0.92)), radial-gradient(circle at 20% 0%, rgba(186, 202, 214, 0.08), transparent 56%)',
                    color: '#dfe7f5',
                    '&:hover': {
                      borderColor: 'rgba(203, 216, 234, 0.38)',
                      background:
                        'linear-gradient(180deg, rgba(28, 34, 46, 0.88), rgba(17, 22, 30, 0.94)), radial-gradient(circle at 20% 0%, rgba(186, 202, 214, 0.11), transparent 56%)',
                    },
                  }}
                >
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.3 }}>{game.title}</Typography>
                  <Typography
                    sx={{
                      color: 'rgba(189, 201, 220, 0.84)',
                      fontSize: '0.94rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {gamePreviews[game.id] ?? 'Загружаем превью...'}
                  </Typography>
                  <Typography sx={{ mt: 'auto', color: 'rgba(176, 188, 206, 0.56)', fontSize: '0.82rem' }}>
                    Обновлено {new Date(game.last_activity_at).toLocaleString('ru-RU')}
                  </Typography>
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
