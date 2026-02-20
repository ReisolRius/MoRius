import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material'
import { brandLogo, icons } from '../assets'
import {
  createStoryGame,
  generateStoryResponseStream,
  getStoryGame,
  listStoryGames,
  updateStoryMessage,
} from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type { StoryGameSummary, StoryMessage } from '../types/story'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onLogout: () => void
}

const INITIAL_STORY_PLACEHOLDER = 'Начните свою истори...'
const INITIAL_INPUT_PLACEHOLDER = 'Как же всё началось?'
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

function StoryGamePage({ user, authToken, onNavigate, onLogout }: StoryGamePageProps) {
  const [games, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isLoadingGames, setIsLoadingGames] = useState(true)
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<number | null>(null)
  const [savingMessageIds, setSavingMessageIds] = useState<number[]>([])
  const generationAbortRef = useRef<AbortController | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)

  const activeGame = useMemo(
    () => games.find((game) => game.id === activeGameId) ?? null,
    [activeGameId, games],
  )

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
    const maxHeight = Math.floor(window.innerHeight * 0.45)
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

  const persistAssistantEdits = useCallback(
    async (messageId: number, container: HTMLElement) => {
      if (!activeGameId) {
        return
      }

      const paragraphNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-ai-paragraph="true"]'))
      const nextContent = paragraphNodes
        .map((node) => (node.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd())
        .join('\n\n')
        .trim()

      if (!nextContent) {
        return
      }

      const currentMessage = messages.find((message) => message.id === messageId)
      if (!currentMessage || currentMessage.content.trim() === nextContent) {
        return
      }

      setSavingMessageIds((previous) => (previous.includes(messageId) ? previous : [...previous, messageId]))
      setMessages((previousMessages) =>
        previousMessages.map((message) => (message.id === messageId ? { ...message, content: nextContent } : message)),
      )

      try {
        const updatedMessage = await updateStoryMessage({
          token: authToken,
          gameId: activeGameId,
          messageId,
          content: nextContent,
        })
        setMessages((previousMessages) =>
          previousMessages.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить правку ответа'
        setErrorMessage(detail)
        void loadGameById(activeGameId, { silent: true })
      } finally {
        setSavingMessageIds((previous) => previous.filter((id) => id !== messageId))
      }
    },
    [activeGameId, authToken, loadGameById, messages],
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

  const avatarInitial = (user.display_name || user.email || '?').trim().charAt(0).toUpperCase()

  return (
    <Box
      sx={{
        minHeight: '100svh',
        color: '#e4e7ee',
        background:
          'radial-gradient(circle at 75% -10%, rgba(84, 103, 148, 0.14), transparent 45%), linear-gradient(180deg, #030509 0%, #06080d 100%)',
      }}
    >
      <Box
        sx={{
          px: { xs: 1.2, md: 2.4 },
          py: { xs: 1.2, md: 1.8 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(168, 179, 201, 0.12)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Box component="img" src={brandLogo} alt="MoRius" sx={{ width: 88, opacity: 0.94 }} />
          <IconButton
            aria-label="Перейти к главной"
            onClick={() => onNavigate('/dashboard')}
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              border: '1px solid rgba(168, 179, 201, 0.22)',
              backgroundColor: 'rgba(13, 16, 22, 0.82)',
            }}
          >
            <Box component="img" src={icons.home} alt="" sx={{ width: 18, height: 18, opacity: 0.92 }} />
          </IconButton>
          <IconButton
            aria-label={isSidebarOpen ? 'Свернуть панель игр' : 'Развернуть панель игр'}
            onClick={() => setIsSidebarOpen((previous) => !previous)}
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              border: '1px solid rgba(168, 179, 201, 0.22)',
              backgroundColor: 'rgba(13, 16, 22, 0.82)',
            }}
          >
            <Box
              component="img"
              src={icons.arrowback}
              alt=""
              sx={{
                width: 18,
                height: 18,
                opacity: 0.92,
                transform: isSidebarOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 200ms ease',
              }}
            />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              border: '1px solid rgba(168, 179, 201, 0.22)',
              backgroundColor: 'rgba(13, 16, 22, 0.82)',
            }}
          >
            <Box component="img" src={icons.ai} alt="" sx={{ width: 18, height: 18, opacity: 0.88 }} />
          </IconButton>
          <IconButton
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              border: '1px solid rgba(168, 179, 201, 0.22)',
              backgroundColor: 'rgba(13, 16, 22, 0.82)',
            }}
          >
            <Box component="img" src={icons.world} alt="" sx={{ width: 18, height: 18, opacity: 0.88 }} />
          </IconButton>
          <Button
            onClick={onLogout}
            sx={{
              minWidth: 0,
              px: 0.9,
              py: 0.35,
              borderRadius: '999px',
              border: '1px solid rgba(168, 179, 201, 0.22)',
              color: 'rgba(225, 232, 245, 0.86)',
              textTransform: 'none',
              fontWeight: 700,
              backgroundColor: 'rgba(13, 16, 22, 0.82)',
            }}
          >
            {user.avatar_url ? (
              <Box
                component="img"
                src={user.avatar_url}
                alt={user.display_name || user.email}
                sx={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  backgroundColor: 'rgba(172, 190, 219, 0.24)',
                  color: '#d9e4f2',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                }}
              >
                {avatarInitial}
              </Box>
            )}
          </Button>
        </Stack>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100svh - 74px)' }}>
        {isSidebarOpen ? (
          <Box
            sx={{
              width: { xs: 235, md: 280 },
              borderRight: '1px solid rgba(168, 179, 201, 0.12)',
              background:
                'linear-gradient(180deg, rgba(15, 18, 25, 0.8) 0%, rgba(8, 10, 15, 0.88) 100%), radial-gradient(circle at 20% 0%, rgba(164, 188, 226, 0.08), transparent 42%)',
              p: 1.4,
            }}
          >
            <Button
              fullWidth
              onClick={() => void handleCreateGame()}
              disabled={isCreatingGame || isGenerating}
              sx={{
                borderRadius: '12px',
                minHeight: 44,
                color: '#f0f4fb',
                fontWeight: 700,
                textTransform: 'none',
                backgroundColor: 'rgba(182, 199, 224, 0.16)',
                border: '1px solid rgba(168, 179, 201, 0.28)',
                '&:hover': {
                  backgroundColor: 'rgba(182, 199, 224, 0.24)',
                },
              }}
            >
              {isCreatingGame ? <CircularProgress size={18} sx={{ color: '#d9e4f2' }} /> : 'Новая игра'}
            </Button>

            <Stack spacing={0.8} sx={{ mt: 1.2, maxHeight: 'calc(100svh - 190px)', overflowY: 'auto', pr: 0.3 }}>
              {games.map((game) => (
                <Button
                  key={game.id}
                  fullWidth
                  disabled={isGenerating}
                  onClick={() => void handleSelectGame(game.id)}
                  sx={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    borderRadius: '12px',
                    border: '1px solid rgba(168, 179, 201, 0.16)',
                    minHeight: 50,
                    px: 1.3,
                    py: 1,
                    color: game.id === activeGameId ? '#f5f7fd' : 'rgba(210, 219, 234, 0.82)',
                    background:
                      game.id === activeGameId
                        ? 'linear-gradient(90deg, rgba(185, 201, 225, 0.24), rgba(185, 201, 225, 0.09))'
                        : 'rgba(16, 20, 27, 0.58)',
                    textTransform: 'none',
                  }}
                >
                  <Stack spacing={0.18} alignItems="flex-start">
                    <Typography sx={{ fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.2 }}>{game.title}</Typography>
                    <Typography sx={{ fontSize: '0.72rem', opacity: 0.72, lineHeight: 1.2 }}>
                      {new Date(game.last_activity_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  </Stack>
                </Button>
              ))}
              {!isLoadingGames && games.length === 0 ? (
                <Typography sx={{ px: 0.6, py: 0.8, color: 'rgba(210, 219, 234, 0.62)', fontSize: '0.88rem' }}>
                  Пока нет созданных игр.
                </Typography>
              ) : null}
            </Stack>
          </Box>
        ) : null}

        <Box
          sx={{
            flex: 1,
            px: { xs: 1.2, md: 3 },
            py: { xs: 1.3, md: 2.2 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 920, mb: 1.2 }}>
            <Typography sx={{ color: 'rgba(215, 224, 239, 0.72)', fontSize: '0.9rem', px: 0.3 }}>
              {activeGame ? activeGame.title : 'Новая история'}
            </Typography>
          </Box>

          {errorMessage ? (
            <Alert
              severity="error"
              onClose={() => setErrorMessage('')}
              sx={{ width: '100%', maxWidth: 920, mb: 1.2, borderRadius: '12px' }}
            >
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            ref={messagesViewportRef}
            sx={{
              width: '100%',
              maxWidth: 920,
              flex: 1,
              minHeight: 0,
              maxHeight: 'calc(100svh - 300px)',
              overflowY: 'auto',
              pr: { xs: 0.4, md: 1.2 },
              pb: 1.8,
            }}
          >
            {isLoadingGameMessages ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}

            {!isLoadingGameMessages && messages.length === 0 ? (
              <Box
                sx={{
                  borderRadius: '16px',
                  border: '1px dashed rgba(168, 179, 201, 0.28)',
                  minHeight: 220,
                  display: 'grid',
                  placeItems: 'center',
                  px: 2,
                  color: 'rgba(210, 219, 234, 0.58)',
                  fontSize: { xs: '1.05rem', md: '1.22rem' },
                  textAlign: 'center',
                }}
              >
                {INITIAL_STORY_PLACEHOLDER}
              </Box>
            ) : null}

            {!isLoadingGameMessages
              ? messages.map((message) => {
                  if (message.role === 'assistant') {
                    const paragraphs = splitAssistantParagraphs(message.content)
                    const isSaving = savingMessageIds.includes(message.id)
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating

                    return (
                      <Box
                        key={message.id}
                        data-assistant-message-container="true"
                        sx={{
                          mb: 2.05,
                          borderRadius: '12px',
                          border: '1px solid rgba(168, 179, 201, 0.08)',
                          background: 'rgba(13, 15, 21, 0.52)',
                          px: { xs: 1.2, md: 1.5 },
                          py: { xs: 1, md: 1.25 },
                          boxShadow: isStreaming ? '0 0 0 1px rgba(190, 211, 243, 0.35) inset' : 'none',
                        }}
                      >
                        <Stack spacing={1.15}>
                          {paragraphs.map((paragraph, index) => (
                            <Box
                              key={`${message.id}-${index}`}
                              className="ui-answer"
                              data-ai-paragraph="true"
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={(event) => {
                                const container = event.currentTarget.closest<HTMLElement>(
                                  '[data-assistant-message-container="true"]',
                                )
                                if (!container) {
                                  return
                                }
                                void persistAssistantEdits(message.id, container)
                              }}
                              sx={{
                                color: '#f2f4fb',
                                lineHeight: 1.64,
                                fontSize: { xs: '1.02rem', md: '1.12rem' },
                                whiteSpace: 'pre-wrap',
                                outline: 'none',
                                borderRadius: '8px',
                                px: 0.6,
                                py: 0.24,
                                '&:focus-visible': {
                                  boxShadow: '0 0 0 1px rgba(190, 211, 243, 0.35) inset',
                                },
                              }}
                            >
                              {paragraph}
                            </Box>
                          ))}
                        </Stack>
                        {isSaving ? (
                          <Typography sx={{ mt: 0.8, fontSize: '0.75rem', color: 'rgba(205, 220, 245, 0.72)' }}>
                            Сохраняем правки...
                          </Typography>
                        ) : null}
                      </Box>
                    )
                  }

                  return (
                    <Box
                      key={message.id}
                      sx={{
                        mb: 2.05,
                        borderRadius: '12px',
                        border: '1px solid rgba(168, 179, 201, 0.08)',
                        backgroundColor: 'rgba(88, 96, 110, 0.22)',
                        color: '#cfd6e5',
                        px: { xs: 1.2, md: 1.5 },
                        py: { xs: 1, md: 1.2 },
                        lineHeight: 1.62,
                        whiteSpace: 'pre-wrap',
                        fontSize: { xs: '1rem', md: '1.07rem' },
                      }}
                    >
                      {message.content}
                    </Box>
                  )
                })
              : null}
          </Box>

          <Box
            sx={{
              width: '100%',
              maxWidth: 920,
              borderRadius: '14px',
              border: '1px solid rgba(168, 179, 201, 0.16)',
              background: 'linear-gradient(180deg, rgba(20, 23, 30, 0.86), rgba(13, 16, 22, 0.94))',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.28)',
            }}
          >
            <Box sx={{ px: 1.2, pt: 1, pb: 0.7 }}>
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
                  maxHeight: '45vh',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: '#f0f4fb',
                  fontSize: { xs: '1rem', md: '1.08rem' },
                  lineHeight: 1.45,
                  fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                  '&::placeholder': {
                    color: 'rgba(210, 219, 234, 0.62)',
                  },
                }}
              />
            </Box>

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                borderTop: '1px solid rgba(168, 179, 201, 0.14)',
                px: 1,
                py: 0.7,
              }}
            >
              <Stack direction="row" spacing={0.4} alignItems="center">
                <IconButton
                  aria-label="Перегенерировать последний ответ"
                  onClick={() => void handleRerollLastResponse()}
                  disabled={!canReroll}
                  sx={{
                    width: 33,
                    height: 33,
                    borderRadius: '10px',
                    border: '1px solid rgba(168, 179, 201, 0.18)',
                    opacity: canReroll ? 1 : 0.45,
                  }}
                >
                  <Box component="img" src={icons.reload} alt="" sx={{ width: 17, height: 17, opacity: 0.88 }} />
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
                  width: 36,
                  height: 36,
                  borderRadius: '12px',
                  border: '1px solid rgba(168, 179, 201, 0.26)',
                  backgroundColor: '#c8d4e3',
                  color: '#11151d',
                  '&:disabled': {
                    opacity: 0.48,
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
      </Box>
    </Box>
  )
}

export default StoryGamePage
