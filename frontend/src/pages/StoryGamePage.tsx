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
import { updateCurrentUserAvatar } from '../services/authApi'
import { createStoryGame, generateStoryResponseStream, getStoryGame, listStoryGames } from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type { StoryGameSummary, StoryMessage } from '../types/story'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
}

type MenuSection = 'home' | 'my' | 'all'

type AvatarPlaceholderProps = {
  fallbackLabel: string
  size?: number
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const INITIAL_STORY_PLACEHOLDER = 'Здесь пока пусто. Начни историю и сделай первый ход.'
const INITIAL_INPUT_PLACEHOLDER = 'Как же все началось?'
const NEXT_INPUT_PLACEHOLDER = 'Что вы будете делать дальше?'

function splitAssistantParagraphs(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : ['']
}

function sortGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort(
    (left, right) =>
      new Date(right.last_activity_at).getTime() - new Date(left.last_activity_at).getTime() || right.id - left.id,
  )
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

function StoryGamePage({ user, authToken, onNavigate, onLogout, onUserUpdate }: StoryGamePageProps) {
  const [games, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingGames, setIsLoadingGames] = useState(true)
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<number | null>(null)
  const [activeMenuSection, setActiveMenuSection] = useState<MenuSection>('home')
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const generationAbortRef = useRef<AbortController | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const visibleGames = useMemo(() => {
    if (activeMenuSection === 'home') {
      return []
    }
    return games
  }, [activeMenuSection, games])

  const hasMessages = messages.length > 0
  const inputPlaceholder = hasMessages ? NEXT_INPUT_PLACEHOLDER : INITIAL_INPUT_PLACEHOLDER
  const canReroll =
    !isGenerating &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    Boolean(activeGameId)

  const adjustInputHeight = useCallback(() => {
    const node = textAreaRef.current
    if (!node) {
      return
    }

    node.style.height = '0px'
    const maxHeight = Math.floor(window.innerHeight * 0.34)
    const nextHeight = Math.min(node.scrollHeight, maxHeight)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  const loadGameById = useCallback(
    async (gameId: number, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      if (!silent) {
        setIsLoadingGameMessages(true)
      }
      try {
        const payload = await getStoryGame({ token: authToken, gameId })
        setMessages(payload.messages)
        setGames((previousGames) => {
          const hasGame = previousGames.some((game) => game.id === payload.game.id)
          const nextGames = hasGame
            ? previousGames.map((game) => (game.id === payload.game.id ? payload.game : game))
            : [payload.game, ...previousGames]
          return sortGamesByActivity(nextGames)
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить историю игры'
        setErrorMessage(detail)
      } finally {
        if (!silent) {
          setIsLoadingGameMessages(false)
        }
      }
    },
    [authToken],
  )

  useEffect(() => {
    let isActive = true

    const bootstrap = async () => {
      setIsLoadingGames(true)
      try {
        const loadedGames = await listStoryGames(authToken)
        if (!isActive) {
          return
        }
        const sortedGames = sortGamesByActivity(loadedGames)
        setGames(sortedGames)
        if (sortedGames.length > 0) {
          const firstGameId = sortedGames[0].id
          setActiveGameId(firstGameId)
          await loadGameById(firstGameId)
        } else {
          setActiveGameId(null)
          setMessages([])
        }
      } catch (error) {
        if (!isActive) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
        setErrorMessage(detail)
      } finally {
        if (isActive) {
          setIsLoadingGames(false)
        }
      }
    }

    void bootstrap()

    return () => {
      isActive = false
      generationAbortRef.current?.abort()
    }
  }, [authToken, loadGameById])

  useEffect(() => {
    adjustInputHeight()
  }, [adjustInputHeight, inputValue])

  useEffect(() => {
    const handleResize = () => adjustInputHeight()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [adjustInputHeight])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, isGenerating])

  const handleCreateGame = useCallback(async () => {
    if (isCreatingGame || isGenerating) {
      return
    }

    setErrorMessage('')
    setIsCreatingGame(true)
    try {
      const game = await createStoryGame({ token: authToken })
      setGames((previousGames) => sortGamesByActivity([game, ...previousGames.filter((item) => item.id !== game.id)]))
      setActiveGameId(game.id)
      setMessages([])
      setInputValue('')
      setActiveMenuSection('my')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
      setErrorMessage(detail)
    } finally {
      setIsCreatingGame(false)
    }
  }, [authToken, isCreatingGame, isGenerating])

  const handleSelectGame = useCallback(
    async (gameId: number) => {
      if (isGenerating || gameId === activeGameId) {
        return
      }
      setErrorMessage('')
      setActiveGameId(gameId)
      await loadGameById(gameId)
    },
    [activeGameId, isGenerating, loadGameById],
  )

  const runStoryGeneration = useCallback(
    async (options: { gameId: number; prompt?: string; rerollLastResponse?: boolean }) => {
      setErrorMessage('')
      setIsGenerating(true)
      setActiveAssistantMessageId(null)
      const controller = new AbortController()
      generationAbortRef.current = controller
      let wasAborted = false
      let streamStarted = false

      try {
        await generateStoryResponseStream({
          token: authToken,
          gameId: options.gameId,
          prompt: options.prompt,
          rerollLastResponse: options.rerollLastResponse,
          signal: controller.signal,
          onStart: (payload) => {
            streamStarted = true
            setActiveAssistantMessageId(payload.assistant_message_id)
            setMessages((previousMessages) => {
              const nextMessages = [...previousMessages]
              if (payload.user_message_id !== null) {
                const firstTempUserIndex = nextMessages.findIndex((message) => message.id < 0 && message.role === 'user')
                if (firstTempUserIndex >= 0) {
                  nextMessages[firstTempUserIndex] = {
                    ...nextMessages[firstTempUserIndex],
                    id: payload.user_message_id,
                  }
                }
              }
              if (!nextMessages.some((message) => message.id === payload.assistant_message_id)) {
                const now = new Date().toISOString()
                nextMessages.push({
                  id: payload.assistant_message_id,
                  game_id: options.gameId,
                  role: 'assistant',
                  content: '',
                  created_at: now,
                  updated_at: now,
                })
              }
              return nextMessages
            })
          },
          onChunk: (payload) => {
            setMessages((previousMessages) =>
              previousMessages.map((message) =>
                message.id === payload.assistant_message_id
                  ? {
                      ...message,
                      content: `${message.content}${payload.delta}`,
                      updated_at: new Date().toISOString(),
                    }
                  : message,
              ),
            )
          },
          onDone: (payload) => {
            setMessages((previousMessages) =>
              previousMessages.map((message) => (message.id === payload.message.id ? payload.message : message)),
            )
          },
        })
      } catch (error) {
        if (controller.signal.aborted) {
          wasAborted = true
        } else {
          const detail = error instanceof Error ? error.message : 'Не удалось сгенерировать ответ'
          setErrorMessage(detail)
        }
      } finally {
        setIsGenerating(false)
        setActiveAssistantMessageId(null)
        generationAbortRef.current = null

        if (wasAborted && streamStarted) {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 700)
          })
        }

        await loadGameById(options.gameId, { silent: true })
        try {
          const refreshedGames = await listStoryGames(authToken)
          setGames(sortGamesByActivity(refreshedGames))
        } catch {
          // Keep current games if refresh failed.
        }
      }
    },
    [authToken, loadGameById],
  )

  const handleSendPrompt = useCallback(async () => {
    if (isGenerating) {
      return
    }

    const normalizedPrompt = inputValue.replace(/\r\n/g, '\n').trim()
    if (!normalizedPrompt) {
      return
    }

    let targetGameId = activeGameId
    if (!targetGameId) {
      try {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        targetGameId = newGame.id
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
        setErrorMessage(detail)
        setIsCreatingGame(false)
        return
      } finally {
        setIsCreatingGame(false)
      }
    }

    if (!targetGameId) {
      return
    }

    const now = new Date().toISOString()
    const temporaryUserMessageId = -Date.now()
    setMessages((previousMessages) => [
      ...previousMessages,
      {
        id: temporaryUserMessageId,
        game_id: targetGameId,
        role: 'user',
        content: normalizedPrompt,
        created_at: now,
        updated_at: now,
      },
    ])
    setInputValue('')
    await runStoryGeneration({
      gameId: targetGameId,
      prompt: normalizedPrompt,
    })
  }, [activeGameId, authToken, inputValue, isGenerating, runStoryGeneration])

  const handleStopGeneration = useCallback(() => {
    generationAbortRef.current?.abort()
  }, [])

  const handleRerollLastResponse = useCallback(async () => {
    if (!canReroll || !activeGameId) {
      return
    }

    setMessages((previousMessages) => {
      const nextMessages = [...previousMessages]
      const lastMessage = nextMessages[nextMessages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        nextMessages.pop()
      }
      return nextMessages
    })

    await runStoryGeneration({
      gameId: activeGameId,
      rerollLastResponse: true,
    })
  }, [activeGameId, canReroll, runStoryGeneration])

  const handleMenuSectionClick = (section: MenuSection) => {
    if (section === 'home') {
      onNavigate('/dashboard')
      setIsPageMenuOpen(false)
      return
    }
    setActiveMenuSection(section)
  }

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setAvatarError('')
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

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    onLogout()
  }

  const menuItemSx = {
    width: '100%',
    justifyContent: 'flex-start',
    borderRadius: '14px',
    minHeight: 52,
    px: 1.8,
    color: '#d8dee9',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '1.02rem',
    border: '1px solid rgba(186, 202, 214, 0.12)',
    background: 'linear-gradient(90deg, rgba(54, 57, 62, 0.58), rgba(31, 34, 40, 0.52))',
    '&:hover': {
      background: 'linear-gradient(90deg, rgba(68, 71, 77, 0.62), rgba(38, 42, 49, 0.58))',
    },
  }

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
          <Button sx={menuItemSx} onClick={() => handleMenuSectionClick('home')}>
            Главная
          </Button>
          <Button sx={menuItemSx} onClick={() => handleMenuSectionClick('my')}>
            Мои игры
          </Button>
          <Button sx={menuItemSx} onClick={() => handleMenuSectionClick('all')}>
            Все игры
          </Button>
        </Stack>

        {activeMenuSection !== 'home' ? (
          <Box sx={{ mt: 1.2 }}>
            {isLoadingGames ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 1.5 }}>
                <CircularProgress size={18} />
              </Stack>
            ) : visibleGames.length === 0 ? (
              <Button
                fullWidth
                onClick={() => void handleCreateGame()}
                disabled={isCreatingGame || isGenerating}
                sx={{
                  borderRadius: '12px',
                  minHeight: 44,
                  color: '#dbe1eb',
                  textTransform: 'none',
                  border: '1px dashed rgba(186, 202, 214, 0.28)',
                  backgroundColor: 'rgba(18, 22, 29, 0.5)',
                }}
              >
                {isCreatingGame ? <CircularProgress size={16} sx={{ color: '#dbe1eb' }} /> : 'Добавить первую игру'}
              </Button>
            ) : (
              <Stack spacing={0.8}>
                {visibleGames.slice(0, 4).map((game) => (
                  <Button
                    key={game.id}
                    fullWidth
                    onClick={() => void handleSelectGame(game.id)}
                    disabled={isGenerating}
                    sx={{
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                      borderRadius: '12px',
                      minHeight: 46,
                      px: 1.2,
                      color: game.id === activeGameId ? '#f4f7fd' : 'rgba(215, 222, 234, 0.82)',
                      border: '1px solid rgba(186, 202, 214, 0.16)',
                      background:
                        game.id === activeGameId
                          ? 'linear-gradient(90deg, rgba(186, 202, 214, 0.22), rgba(186, 202, 214, 0.1))'
                          : 'rgba(16, 20, 27, 0.58)',
                    }}
                  >
                    {game.title}
                  </Button>
                ))}
              </Stack>
            )}
          </Box>
        ) : null}
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
            aria-label={isRightPanelOpen ? 'Свернуть правую панель' : 'Развернуть правую панель'}
            onClick={() => setIsRightPanelOpen((previous) => !previous)}
            sx={{
              width: 44,
              height: 44,
              borderRadius: '14px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              backgroundColor: 'rgba(16, 20, 27, 0.82)',
            }}
          >
            <Box
              component="img"
              src={icons.arrowback}
              alt=""
              sx={{
                width: 20,
                height: 20,
                opacity: 0.9,
                transform: isRightPanelOpen ? 'none' : 'rotate(180deg)',
                transition: 'transform 220ms ease',
              }}
            />
          </IconButton>

          <Stack
            direction="row"
            spacing={1.2}
            sx={{
              opacity: isRightPanelOpen ? 1 : 0,
              transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(10px)',
              pointerEvents: isRightPanelOpen ? 'auto' : 'none',
              transition: 'opacity 220ms ease, transform 220ms ease',
            }}
          >
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
        </Stack>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 90,
          right: 18,
          bottom: 20,
          width: 278,
          zIndex: 25,
          borderRadius: '14px',
          border: '1px solid rgba(186, 202, 214, 0.14)',
          background: 'linear-gradient(180deg, rgba(18, 22, 30, 0.9), rgba(13, 16, 22, 0.95))',
          transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          opacity: isRightPanelOpen ? 1 : 0,
          pointerEvents: isRightPanelOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ px: 1.2, pt: 1.2, borderBottom: '1px solid rgba(186, 202, 214, 0.14)' }}>
          <Stack direction="row" spacing={2.6}>
            <Typography sx={{ color: '#d9dee8', fontSize: '1rem', lineHeight: 1.1 }}>Инструкции</Typography>
            <Typography sx={{ color: 'rgba(186, 202, 214, 0.7)', fontSize: '1rem', lineHeight: 1.1 }}>
              Настройки
            </Typography>
          </Stack>
          <Box sx={{ mt: 0.9, width: 130, height: 2, backgroundColor: 'rgba(205, 216, 233, 0.75)' }} />
        </Box>
        <Box sx={{ p: 1.2, display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <Button
            onClick={() => void handleCreateGame()}
            disabled={isCreatingGame || isGenerating}
            sx={{
              minHeight: 44,
              borderRadius: '12px',
              textTransform: 'none',
              color: '#d9dee8',
              border: '1px dashed rgba(186, 202, 214, 0.28)',
              backgroundColor: 'rgba(20, 24, 32, 0.66)',
            }}
          >
            {isCreatingGame ? <CircularProgress size={16} sx={{ color: '#d9dee8' }} /> : 'Добавить первую карточку'}
          </Button>
          <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
            Пока пусто. Здесь появится ваш контекст игры.
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          pt: { xs: 80, md: 92 },
          pb: { xs: 2, md: 3 },
          px: { xs: 1.4, md: 3 },
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 980,
          }}
        >
          {errorMessage ? (
            <Alert
              severity="error"
              onClose={() => setErrorMessage('')}
              sx={{ width: '100%', mb: 1.2, borderRadius: '12px' }}
            >
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            ref={messagesViewportRef}
            sx={{
              px: { xs: 0.3, md: 0.8 },
              pb: { xs: 18, md: 20 },
            }}
          >
            {isLoadingGameMessages ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}

            {!isLoadingGameMessages && messages.length === 0 ? (
              <Stack spacing={2.2} sx={{ color: 'rgba(210, 219, 234, 0.78)', mt: { xs: 4, md: 6 }, maxWidth: 820 }}>
                <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.2rem' }, color: 'rgba(226, 232, 243, 0.9)' }}>
                  {INITIAL_STORY_PLACEHOLDER}
                </Typography>
                <Button
                  onClick={() => void handleCreateGame()}
                  disabled={isCreatingGame || isGenerating}
                  sx={{
                    alignSelf: 'flex-start',
                    minHeight: 42,
                    borderRadius: '12px',
                    px: 2.2,
                    textTransform: 'none',
                    color: '#d9dee8',
                    border: '1px dashed rgba(186, 202, 214, 0.28)',
                    backgroundColor: 'rgba(20, 24, 32, 0.52)',
                  }}
                >
                  {isCreatingGame ? <CircularProgress size={16} sx={{ color: '#d9dee8' }} /> : 'Добавить первую игру'}
                </Button>
              </Stack>
            ) : null}

            {!isLoadingGameMessages
              ? messages.map((message) => {
                  if (message.role === 'assistant') {
                    const paragraphs = splitAssistantParagraphs(message.content)
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating
                    return (
                      <Box key={message.id} sx={{ mb: 2.4 }}>
                        <Stack spacing={1.5}>
                          {paragraphs.map((paragraph, index) => (
                            <Typography
                              key={`${message.id}-${index}`}
                              sx={{
                                color: '#d8dde7',
                                lineHeight: 1.58,
                                fontSize: { xs: '1.02rem', md: '1.12rem' },
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {paragraph}
                            </Typography>
                          ))}
                          {isStreaming ? (
                            <Box
                              sx={{
                                width: 34,
                                height: 4,
                                borderRadius: '999px',
                                backgroundColor: 'rgba(195, 209, 228, 0.72)',
                              }}
                            />
                          ) : null}
                        </Stack>
                      </Box>
                    )
                  }

                  return (
                    <Typography
                      key={message.id}
                      sx={{
                        mb: 2.4,
                        color: 'rgba(198, 207, 222, 0.92)',
                        lineHeight: 1.58,
                        whiteSpace: 'pre-wrap',
                        fontSize: { xs: '1rem', md: '1.08rem' },
                      }}
                    >
                      {'> '}
                      {message.content}
                    </Typography>
                  )
                })
              : null}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: { xs: 10, md: 18 },
          width: 'min(980px, calc(100% - 22px))',
          zIndex: 20,
        }}
      >
          <Box
            sx={{
              width: '100%',
              borderRadius: '16px',
              border: '1px solid rgba(186, 202, 214, 0.16)',
              background: 'linear-gradient(180deg, rgba(19, 23, 31, 0.9), rgba(13, 16, 22, 0.95))',
              boxShadow: '0 14px 30px rgba(0, 0, 0, 0.28)',
              overflow: 'hidden',
            }}
          >
            <Box sx={{ px: 1.4, pt: 1.1, pb: 0.7 }}>
              <Box
                component="textarea"
                ref={textAreaRef}
                value={inputValue}
                placeholder={inputPlaceholder}
                disabled={isGenerating}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSendPrompt()
                  }
                }}
                sx={{
                  width: '100%',
                  minHeight: 42,
                  maxHeight: '34vh',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: '#e6ebf4',
                  fontSize: { xs: '0.98rem', md: '1.05rem' },
                  lineHeight: 1.42,
                  fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                  '&::placeholder': {
                    color: 'rgba(205, 214, 228, 0.56)',
                  },
                }}
              />
            </Box>

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                borderTop: '1px solid rgba(186, 202, 214, 0.14)',
                px: 1,
                py: 0.55,
              }}
            >
              <Stack direction="row" spacing={0.25} alignItems="center">
                <Stack direction="row" spacing={0.35} alignItems="center" sx={{ pl: 0.45, pr: 0.52 }}>
                  <Box component="img" src={icons.tabcoin} alt="" sx={{ width: 13, height: 13 }} />
                  <Typography sx={{ color: 'rgba(209, 218, 232, 0.9)', fontSize: '1.42rem', lineHeight: 1 }}>
                    {user.coins}
                  </Typography>
                </Stack>
                <IconButton aria-label="Назад" onClick={(event) => event.preventDefault()} sx={{ width: 32, height: 32 }}>
                  <Box component="img" src={icons.back} alt="" sx={{ width: 16, height: 16, opacity: 0.9 }} />
                </IconButton>
                <IconButton aria-label="Отменить" onClick={(event) => event.preventDefault()} sx={{ width: 32, height: 32 }}>
                  <Box component="img" src={icons.undo} alt="" sx={{ width: 16, height: 16, opacity: 0.9 }} />
                </IconButton>
                <IconButton
                  aria-label="Перегенерировать"
                  onClick={() => void handleRerollLastResponse()}
                  disabled={!canReroll}
                  sx={{ width: 32, height: 32, opacity: canReroll ? 1 : 0.45 }}
                >
                  <Box component="img" src={icons.reload} alt="" sx={{ width: 16, height: 16, opacity: 0.9 }} />
                </IconButton>
              </Stack>

              <IconButton
                aria-label={isGenerating ? 'Остановить генерацию' : 'Отправить'}
                onClick={() => {
                  if (isGenerating) {
                    handleStopGeneration()
                    return
                  }
                  void handleSendPrompt()
                }}
                disabled={isCreatingGame || (!isGenerating && !inputValue.trim())}
                sx={{
                  width: 38,
                  height: 38,
                  borderRadius: '13px',
                  backgroundColor: '#c8d4e3',
                  border: '1px solid rgba(186, 202, 214, 0.3)',
                  color: '#11151d',
                  '&:disabled': {
                    opacity: 0.5,
                    backgroundColor: '#8796a9',
                  },
                }}
              >
                {isGenerating ? (
                  <Box
                    sx={{
                      width: 11,
                      height: 11,
                      borderRadius: '2px',
                      backgroundColor: '#11151d',
                    }}
                  />
                ) : (
                  <Box component="img" src={icons.send} alt="" sx={{ width: 18, height: 18 }} />
                )}
              </IconButton>
            </Stack>
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
        <DialogTitle sx={{ pb: 1.4 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.6rem' }}>Профиль</Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 0.2 }}>
          <Stack spacing={2.2}>
            <Stack direction="row" spacing={1.8} alignItems="center">
              <UserAvatar user={user} size={84} />
              <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '1.24rem', fontWeight: 700 }}>{user.display_name || 'Игрок'}</Typography>
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="outlined"
                onClick={handleChooseAvatar}
                disabled={isAvatarSaving}
                sx={{
                  minHeight: 40,
                  borderColor: 'rgba(186, 202, 214, 0.28)',
                  color: 'rgba(223, 229, 239, 0.9)',
                }}
              >
                {isAvatarSaving ? <CircularProgress size={16} sx={{ color: 'rgba(223, 229, 239, 0.9)' }} /> : 'Изменить аватар'}
              </Button>
              <Button
                variant="text"
                onClick={handleRemoveAvatar}
                disabled={isAvatarSaving || !user.avatar_url}
                sx={{ minHeight: 40, color: 'rgba(223, 229, 239, 0.78)' }}
              >
                Удалить
              </Button>
            </Stack>

            {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

            <Box
              sx={{
                borderRadius: '12px',
                border: '1px solid rgba(186, 202, 214, 0.16)',
                backgroundColor: 'rgba(12, 16, 22, 0.62)',
                px: 1.5,
                py: 1.2,
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

        <DialogActions sx={{ px: 3, pb: 2.4, pt: 0.6 }}>
          <Button
            onClick={handleCloseProfileDialog}
            sx={{
              color: 'text.secondary',
            }}
          >
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

export default StoryGamePage

