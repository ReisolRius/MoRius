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
import {
  createStoryInstructionCard,
  createStoryGame,
  createStoryWorldCard,
  deleteStoryInstructionCard,
  deleteStoryWorldCard,
  generateStoryResponseStream,
  getStoryGame,
  listStoryGames,
  undoStoryWorldCardEvent,
  updateStoryInstructionCard,
  updateStoryWorldCard,
  updateStoryMessage,
} from '../services/storyApi'
import {
  DEFAULT_STORY_TITLE,
  getDisplayStoryTitle,
  loadStoryTitleMap,
  persistStoryTitleMap,
  setStoryTitle,
  type StoryTitleMap,
} from '../services/storyTitleStore'
import type { AuthUser } from '../types/auth'
import type { StoryGameSummary, StoryInstructionCard, StoryMessage, StoryWorldCard, StoryWorldCardEvent } from '../types/story'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  initialGameId: number | null
  onNavigate: (path: string) => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
}

type AvatarPlaceholderProps = {
  fallbackLabel: string
  size?: number
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
}

type RightPanelMode = 'ai' | 'world'
type AiPanelTab = 'instructions' | 'settings'
type WorldPanelTab = 'story' | 'world'

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const INITIAL_STORY_PLACEHOLDER = 'Начните свою историю...'
const INITIAL_INPUT_PLACEHOLDER = 'Как же все началось?'
const NEXT_INPUT_PLACEHOLDER = 'Что вы будете делать дальше?'
const HEADER_AVATAR_SIZE = 44
const QUICK_START_WORLD_STORAGE_KEY = 'morius.quickstart.world'
const WORLD_CARD_CONTENT_MAX_LENGTH = 1000
const WORLD_CARD_EVENT_STATUS_LABEL: Record<'added' | 'updated' | 'deleted', string> = {
  added: 'Добавлено',
  updated: 'Обновлено',
  deleted: 'Удалено',
}

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

function normalizeWorldCardTriggersDraft(draft: string, fallbackTitle: string): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  const pushTrigger = (value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) {
      return
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    normalized.push(trimmed)
  }

  draft.split(',').forEach((part) => pushTrigger(part))
  pushTrigger(fallbackTitle)

  return normalized.slice(0, 40)
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

function StoryGamePage({ user, authToken, initialGameId, onNavigate, onLogout, onUserUpdate }: StoryGamePageProps) {
  const [, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [quickStartIntro, setQuickStartIntro] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<number | null>(null)
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('ai')
  const [activeAiPanelTab, setActiveAiPanelTab] = useState<AiPanelTab>('instructions')
  const [activeWorldPanelTab, setActiveWorldPanelTab] = useState<WorldPanelTab>('story')
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(DEFAULT_STORY_TITLE)
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [isSavingMessage, setIsSavingMessage] = useState(false)
  const [instructionCards, setInstructionCards] = useState<StoryInstructionCard[]>([])
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [editingInstructionId, setEditingInstructionId] = useState<number | null>(null)
  const [instructionTitleDraft, setInstructionTitleDraft] = useState('')
  const [instructionContentDraft, setInstructionContentDraft] = useState('')
  const [isSavingInstruction, setIsSavingInstruction] = useState(false)
  const [deletingInstructionId, setDeletingInstructionId] = useState<number | null>(null)
  const [worldCards, setWorldCards] = useState<StoryWorldCard[]>([])
  const [worldCardEvents, setWorldCardEvents] = useState<StoryWorldCardEvent[]>([])
  const [dismissedWorldCardEventIds, setDismissedWorldCardEventIds] = useState<number[]>([])
  const [expandedWorldCardEventIds, setExpandedWorldCardEventIds] = useState<number[]>([])
  const [undoingWorldCardEventIds, setUndoingWorldCardEventIds] = useState<number[]>([])
  const [worldCardDialogOpen, setWorldCardDialogOpen] = useState(false)
  const [editingWorldCardId, setEditingWorldCardId] = useState<number | null>(null)
  const [worldCardTitleDraft, setWorldCardTitleDraft] = useState('')
  const [worldCardContentDraft, setWorldCardContentDraft] = useState('')
  const [worldCardTriggersDraft, setWorldCardTriggersDraft] = useState('')
  const [isSavingWorldCard, setIsSavingWorldCard] = useState(false)
  const [deletingWorldCardId, setDeletingWorldCardId] = useState<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const instructionDialogGameIdRef = useRef<number | null>(null)
  const worldCardDialogGameIdRef = useRef<number | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const activeDisplayTitle = useMemo(
    () => getDisplayStoryTitle(activeGameId, customTitleMap),
    [activeGameId, customTitleMap],
  )

  const hasMessages = messages.length > 0
  const inputPlaceholder = hasMessages ? NEXT_INPUT_PLACEHOLDER : INITIAL_INPUT_PLACEHOLDER
  const canReroll =
    !isGenerating &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    Boolean(activeGameId)
  const leftPanelTabLabel = rightPanelMode === 'ai' ? 'Инструкции' : 'Сюжет'
  const rightPanelTabLabel = rightPanelMode === 'ai' ? 'Настройки' : 'Мир'
  const isLeftPanelTabActive =
    rightPanelMode === 'ai' ? activeAiPanelTab === 'instructions' : activeWorldPanelTab === 'story'
  const visibleWorldCardEvents = useMemo(
    () => worldCardEvents.filter((event) => !dismissedWorldCardEventIds.includes(event.id)),
    [dismissedWorldCardEventIds, worldCardEvents],
  )
  const worldCardEventsByAssistantId = useMemo(() => {
    const nextMap = new Map<number, StoryWorldCardEvent[]>()
    visibleWorldCardEvents.forEach((event) => {
      const currentItems = nextMap.get(event.assistant_message_id) ?? []
      currentItems.push(event)
      nextMap.set(event.assistant_message_id, currentItems)
    })
    return nextMap
  }, [visibleWorldCardEvents])

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

  const applyWorldCardEvents = useCallback((nextEvents: StoryWorldCardEvent[]) => {
    setWorldCardEvents(nextEvents)
    const eventIds = new Set(nextEvents.map((event) => event.id))
    setDismissedWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setExpandedWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setUndoingWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
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
        setInstructionCards(payload.instruction_cards)
        setWorldCards(payload.world_cards)
        applyWorldCardEvents(payload.world_card_events ?? [])
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
    [applyWorldCardEvents, authToken],
  )

  useEffect(() => {
    let isActive = true

    const bootstrap = async () => {
      try {
        const loadedGames = await listStoryGames(authToken)
        if (!isActive) {
          return
        }
        const sortedGames = sortGamesByActivity(loadedGames)
        setGames(sortedGames)
        if (sortedGames.length > 0) {
          const preferredGameId =
            initialGameId && sortedGames.some((game) => game.id === initialGameId) ? initialGameId : sortedGames[0].id
          setActiveGameId(preferredGameId)
          await loadGameById(preferredGameId)
        } else {
          setActiveGameId(null)
          setMessages([])
          setInstructionCards([])
          setWorldCards([])
          applyWorldCardEvents([])
        }
      } catch (error) {
        if (!isActive) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
        setErrorMessage(detail)
      }
    }

    void bootstrap()

    return () => {
      isActive = false
      generationAbortRef.current?.abort()
    }
  }, [applyWorldCardEvents, authToken, initialGameId, loadGameById])

  useEffect(() => {
    setCustomTitleMap(loadStoryTitleMap())
  }, [])

  useEffect(() => {
    setQuickStartIntro('')
  }, [activeGameId])

  useEffect(() => {
    if (instructionDialogGameIdRef.current === activeGameId) {
      return
    }
    instructionDialogGameIdRef.current = activeGameId

    if (isSavingInstruction || isCreatingGame) {
      return
    }
    setInstructionDialogOpen(false)
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
    setDeletingInstructionId(null)
  }, [activeGameId, isCreatingGame, isSavingInstruction])

  useEffect(() => {
    if (worldCardDialogGameIdRef.current === activeGameId) {
      return
    }
    worldCardDialogGameIdRef.current = activeGameId

    if (isSavingWorldCard || isCreatingGame) {
      return
    }
    setWorldCardDialogOpen(false)
    setEditingWorldCardId(null)
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
    setDeletingWorldCardId(null)
  }, [activeGameId, isCreatingGame, isSavingWorldCard])

  useEffect(() => {
    if (!activeGameId || isLoadingGameMessages || messages.length > 0) {
      return
    }

    const rawPayload = localStorage.getItem(QUICK_START_WORLD_STORAGE_KEY)
    if (!rawPayload) {
      return
    }

    try {
      const parsed = JSON.parse(rawPayload) as {
        gameId?: unknown
        title?: unknown
        description?: unknown
      }
      if (parsed.gameId !== activeGameId) {
        return
      }

      if (typeof parsed.title === 'string') {
        const normalizedTitle = parsed.title.trim()
        if (normalizedTitle.length > 0) {
          setCustomTitleMap((previousMap) => {
            const nextMap = setStoryTitle(previousMap, activeGameId, normalizedTitle)
            persistStoryTitleMap(nextMap)
            return nextMap
          })
        }
      }

      if (typeof parsed.description === 'string') {
        const normalizedDescription = parsed.description.trim()
        if (normalizedDescription.length > 0) {
          setQuickStartIntro(normalizedDescription)
        }
      }

      setInputValue('')
      localStorage.removeItem(QUICK_START_WORLD_STORAGE_KEY)
    } catch {
      localStorage.removeItem(QUICK_START_WORLD_STORAGE_KEY)
    }
  }, [activeGameId, isLoadingGameMessages, messages.length])

  useEffect(() => {
    if (isEditingTitle) {
      return
    }
    setTitleDraft(activeDisplayTitle)
  }, [activeDisplayTitle, isEditingTitle])

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

  const applyCustomTitle = useCallback((gameId: number, nextTitle: string) => {
    setCustomTitleMap((previousMap) => {
      const nextMap = setStoryTitle(previousMap, gameId, nextTitle)
      persistStoryTitleMap(nextMap)
      return nextMap
    })
  }, [])

  const handleStartTitleEdit = () => {
    if (!activeGameId || isGenerating) {
      return
    }
    setTitleDraft(activeDisplayTitle)
    setIsEditingTitle(true)
  }

  const handleSaveTitle = () => {
    if (!activeGameId) {
      setIsEditingTitle(false)
      return
    }
    const normalized = titleDraft.trim() || DEFAULT_STORY_TITLE
    applyCustomTitle(activeGameId, normalized)
    setTitleDraft(normalized)
    setIsEditingTitle(false)
  }

  const handleCancelTitleEdit = () => {
    setTitleDraft(activeDisplayTitle)
    setIsEditingTitle(false)
  }

  const handleStartMessageEdit = (message: StoryMessage) => {
    if (isGenerating) {
      return
    }
    setEditingMessageId(message.id)
    setMessageDraft(message.content)
  }

  const handleCancelMessageEdit = () => {
    setEditingMessageId(null)
    setMessageDraft('')
    setIsSavingMessage(false)
  }

  const handleSaveEditedMessage = useCallback(async () => {
    if (editingMessageId === null || isSavingMessage) {
      return
    }
    const currentMessage = messages.find((message) => message.id === editingMessageId)
    if (!currentMessage || !activeGameId) {
      setEditingMessageId(null)
      setMessageDraft('')
      setIsSavingMessage(false)
      return
    }

    const normalized = messageDraft.trim()
    if (!normalized) {
      setErrorMessage('Текст сообщения не может быть пустым')
      return
    }

    if (normalized === currentMessage.content.trim()) {
      setEditingMessageId(null)
      setMessageDraft('')
      setIsSavingMessage(false)
      return
    }

    setIsSavingMessage(true)
    setErrorMessage('')
    try {
      const updatedMessage = await updateStoryMessage({
        token: authToken,
        gameId: activeGameId,
        messageId: currentMessage.id,
        content: normalized,
      })
      setMessages((previousMessages) =>
        previousMessages.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
      )
      setEditingMessageId(null)
      setMessageDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
      setErrorMessage(detail)
    } finally {
      setIsSavingMessage(false)
    }
  }, [activeGameId, authToken, editingMessageId, isSavingMessage, messageDraft, messages])

  const handleOpenCreateInstructionDialog = () => {
    if (isGenerating || isSavingInstruction || isCreatingGame) {
      return
    }
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
    setInstructionDialogOpen(true)
  }

  const handleOpenEditInstructionDialog = (card: StoryInstructionCard) => {
    if (isGenerating || isSavingInstruction || isCreatingGame) {
      return
    }
    setEditingInstructionId(card.id)
    setInstructionTitleDraft(card.title)
    setInstructionContentDraft(card.content)
    setInstructionDialogOpen(true)
  }

  const handleCloseInstructionDialog = () => {
    if (isSavingInstruction || isCreatingGame) {
      return
    }
    setInstructionDialogOpen(false)
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
  }

  const handleSaveInstructionCard = useCallback(async () => {
    if (isSavingInstruction || isCreatingGame) {
      return
    }

    const normalizedTitle = instructionTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = instructionContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст инструкции не может быть пустым')
      return
    }

    setErrorMessage('')
    setIsSavingInstruction(true)
    let targetGameId = activeGameId
    try {
      if (!targetGameId) {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        setInstructionCards([])
        setWorldCards([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      }

      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки инструкции')
        return
      }

      if (editingInstructionId === null) {
        const createdCard = await createStoryInstructionCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setInstructionCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryInstructionCard({
          token: authToken,
          gameId: targetGameId,
          instructionId: editingInstructionId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setInstructionCards((previousCards) =>
          previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)),
        )
      }

      setInstructionDialogOpen(false)
      setEditingInstructionId(null)
      setInstructionTitleDraft('')
      setInstructionContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку'
      setErrorMessage(detail)
    } finally {
      setIsSavingInstruction(false)
      setIsCreatingGame(false)
    }
  }, [
    activeGameId,
    authToken,
    editingInstructionId,
    instructionContentDraft,
    instructionTitleDraft,
    isCreatingGame,
    isSavingInstruction,
    onNavigate,
    applyWorldCardEvents,
  ])

  const handleDeleteInstructionCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingInstructionId !== null || isSavingInstruction || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingInstructionId(cardId)
      try {
        await deleteStoryInstructionCard({
          token: authToken,
          gameId: activeGameId,
          instructionId: cardId,
        })
        setInstructionCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingInstructionId === cardId) {
          setInstructionDialogOpen(false)
          setEditingInstructionId(null)
          setInstructionTitleDraft('')
          setInstructionContentDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку'
        setErrorMessage(detail)
      } finally {
        setDeletingInstructionId(null)
      }
    },
    [activeGameId, authToken, deletingInstructionId, editingInstructionId, isCreatingGame, isSavingInstruction],
  )

  const handleOpenCreateWorldCardDialog = () => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    setEditingWorldCardId(null)
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardDialogOpen(true)
  }

  const handleOpenEditWorldCardDialog = (card: StoryWorldCard) => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    setEditingWorldCardId(card.id)
    setWorldCardTitleDraft(card.title)
    setWorldCardContentDraft(card.content)
    setWorldCardTriggersDraft(card.triggers.join(', '))
    setWorldCardDialogOpen(true)
  }

  const handleCloseWorldCardDialog = () => {
    if (isSavingWorldCard || isCreatingGame) {
      return
    }
    setWorldCardDialogOpen(false)
    setEditingWorldCardId(null)
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
  }

  const handleSaveWorldCard = useCallback(async () => {
    if (isSavingWorldCard || isCreatingGame) {
      return
    }

    const normalizedTitle = worldCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = worldCardContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки мира не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст карточки мира не может быть пустым')
      return
    }
    if (normalizedContent.length > WORLD_CARD_CONTENT_MAX_LENGTH) {
      setErrorMessage(`Текст карточки мира не должен превышать ${WORLD_CARD_CONTENT_MAX_LENGTH} символов`)
      return
    }

    const normalizedTriggers = normalizeWorldCardTriggersDraft(worldCardTriggersDraft, normalizedTitle)
    setErrorMessage('')
    setIsSavingWorldCard(true)
    let targetGameId = activeGameId
    try {
      if (!targetGameId) {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        setInstructionCards([])
        setWorldCards([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      }

      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки мира')
        return
      }

      if (editingWorldCardId === null) {
        const createdCard = await createStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
          triggers: normalizedTriggers,
        })
        setWorldCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingWorldCardId,
          title: normalizedTitle,
          content: normalizedContent,
          triggers: normalizedTriggers,
        })
        setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      }

      setWorldCardDialogOpen(false)
      setEditingWorldCardId(null)
      setWorldCardTitleDraft('')
      setWorldCardContentDraft('')
      setWorldCardTriggersDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку мира'
      setErrorMessage(detail)
    } finally {
      setIsSavingWorldCard(false)
      setIsCreatingGame(false)
    }
  }, [
    activeGameId,
    authToken,
    editingWorldCardId,
    isCreatingGame,
    isSavingWorldCard,
    onNavigate,
    applyWorldCardEvents,
    worldCardContentDraft,
    worldCardTitleDraft,
    worldCardTriggersDraft,
  ])

  const handleDeleteWorldCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingWorldCardId !== null || isSavingWorldCard || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingWorldCardId(cardId)
      try {
        await deleteStoryWorldCard({
          token: authToken,
          gameId: activeGameId,
          cardId,
        })
        setWorldCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingWorldCardId === cardId) {
          setWorldCardDialogOpen(false)
          setEditingWorldCardId(null)
          setWorldCardTitleDraft('')
          setWorldCardContentDraft('')
          setWorldCardTriggersDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку мира'
        setErrorMessage(detail)
      } finally {
        setDeletingWorldCardId(null)
      }
    },
    [activeGameId, authToken, deletingWorldCardId, editingWorldCardId, isCreatingGame, isSavingWorldCard],
  )

  const handleDismissWorldCardEvent = useCallback((eventId: number) => {
    setDismissedWorldCardEventIds((previousIds) => (previousIds.includes(eventId) ? previousIds : [...previousIds, eventId]))
  }, [])

  const handleToggleWorldCardEventExpanded = useCallback((eventId: number) => {
    setExpandedWorldCardEventIds((previousIds) =>
      previousIds.includes(eventId)
        ? previousIds.filter((value) => value !== eventId)
        : [...previousIds, eventId],
    )
  }, [])

  const handleUndoWorldCardEvent = useCallback(
    async (eventId: number) => {
      if (!activeGameId || undoingWorldCardEventIds.includes(eventId)) {
        return
      }

      setErrorMessage('')
      setUndoingWorldCardEventIds((previousIds) =>
        previousIds.includes(eventId) ? previousIds : [...previousIds, eventId],
      )
      try {
        await undoStoryWorldCardEvent({
          token: authToken,
          gameId: activeGameId,
          eventId,
        })
        await loadGameById(activeGameId, { silent: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось откатить изменение карточки'
        setErrorMessage(detail)
      } finally {
        setUndoingWorldCardEventIds((previousIds) => previousIds.filter((value) => value !== eventId))
      }
    },
    [activeGameId, authToken, loadGameById, undoingWorldCardEventIds],
  )

  const runStoryGeneration = useCallback(
    async (options: {
      gameId: number
      prompt?: string
      rerollLastResponse?: boolean
      instructionCards?: StoryInstructionCard[]
    }) => {
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
          instructions: (options.instructionCards ?? [])
            .map((card) => ({
              title: card.title.replace(/\s+/g, ' ').trim(),
              content: card.content.replace(/\r\n/g, '\n').trim(),
            }))
            .filter((card) => card.title.length > 0 && card.content.length > 0),
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
        setInstructionCards([])
        setWorldCards([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
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
      instructionCards,
    })
  }, [activeGameId, applyWorldCardEvents, authToken, inputValue, instructionCards, isGenerating, onNavigate, runStoryGeneration])

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
      instructionCards,
    })
  }, [activeGameId, canReroll, instructionCards, runStoryGeneration])

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
        height: '100svh',
        color: '#d6dbe4',
        background:
          'radial-gradient(circle at 68% -8%, rgba(173, 107, 44, 0.07), transparent 42%), linear-gradient(180deg, #04070d 0%, #02050a 100%)',
        position: 'relative',
        overflow: 'hidden',
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
          <Button sx={menuItemSx} onClick={() => onNavigate('/dashboard')}>
            Главная
          </Button>
          <Button sx={menuItemSx} onClick={() => onNavigate('/games')}>
            Мои игры
          </Button>
          <Button sx={menuItemSx} onClick={() => onNavigate('/games/all')}>
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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
          }}
        >
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

          <Box
            sx={{
              ml: isRightPanelOpen ? 1.2 : 0,
              maxWidth: isRightPanelOpen ? 220 : 0,
              opacity: isRightPanelOpen ? 1 : 0,
              transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(14px)',
              pointerEvents: isRightPanelOpen ? 'auto' : 'none',
              overflow: 'hidden',
              transition: 'max-width 260ms ease, margin-left 260ms ease, opacity 220ms ease, transform 220ms ease',
            }}
          >
            <Stack direction="row" spacing={1.2}>
              <IconButton
                aria-label="Миры"
                onClick={() => setRightPanelMode('world')}
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '14px',
                  border:
                    rightPanelMode === 'world'
                      ? '1px solid rgba(206, 219, 236, 0.38)'
                      : '1px solid rgba(186, 202, 214, 0.14)',
                  background:
                    rightPanelMode === 'world'
                      ? 'linear-gradient(180deg, rgba(43, 53, 69, 0.9), rgba(28, 35, 48, 0.92))'
                      : 'rgba(16, 20, 27, 0.82)',
                }}
              >
                <Box component="img" src={icons.world} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
              </IconButton>
              <IconButton
                aria-label="ИИ"
                onClick={() => setRightPanelMode('ai')}
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '14px',
                  border:
                    rightPanelMode === 'ai'
                      ? '1px solid rgba(206, 219, 236, 0.38)'
                      : '1px solid rgba(186, 202, 214, 0.14)',
                  background:
                    rightPanelMode === 'ai'
                      ? 'linear-gradient(180deg, rgba(43, 53, 69, 0.9), rgba(28, 35, 48, 0.92))'
                      : 'rgba(16, 20, 27, 0.82)',
                }}
              >
                <Box component="img" src={icons.ai} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
              </IconButton>
              <Button
                variant="text"
                onClick={() => setProfileDialogOpen(true)}
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
          position: 'fixed',
          top: 82,
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
        <Box sx={{ px: 1.1, pt: 1.1, borderBottom: '1px solid rgba(186, 202, 214, 0.14)' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              alignItems: 'center',
              gap: 0.2,
            }}
          >
            <Button
              onClick={() =>
                rightPanelMode === 'ai' ? setActiveAiPanelTab('instructions') : setActiveWorldPanelTab('story')
              }
              sx={{
                color: isLeftPanelTabActive ? '#d9dee8' : 'rgba(186, 202, 214, 0.7)',
                fontSize: '1rem',
                fontWeight: isLeftPanelTabActive ? 700 : 500,
                lineHeight: 1.1,
                textAlign: 'center',
                py: 0.65,
                minHeight: 0,
                borderRadius: '10px',
                textTransform: 'none',
              }}
            >
              {leftPanelTabLabel}
            </Button>
            <Button
              onClick={() => (rightPanelMode === 'ai' ? setActiveAiPanelTab('settings') : setActiveWorldPanelTab('world'))}
              sx={{
                color: isLeftPanelTabActive ? 'rgba(186, 202, 214, 0.7)' : '#d9dee8',
                fontSize: '1rem',
                fontWeight: isLeftPanelTabActive ? 500 : 700,
                lineHeight: 1.1,
                textAlign: 'center',
                py: 0.65,
                minHeight: 0,
                borderRadius: '10px',
                textTransform: 'none',
              }}
            >
              {rightPanelTabLabel}
            </Button>
          </Box>
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: 2,
              backgroundColor: 'rgba(186, 202, 214, 0.18)',
            }}
          >
            <Box
              sx={{
                width: '50%',
                height: '100%',
                backgroundColor: 'rgba(205, 216, 233, 0.78)',
                transform: isLeftPanelTabActive ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 220ms ease',
              }}
            />
          </Box>
        </Box>
        <Box sx={{ p: 1.2, display: 'flex', flexDirection: 'column', gap: 1.2, flex: 1 }}>
          {rightPanelMode === 'ai' && activeAiPanelTab === 'instructions' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {instructionCards.length === 0 ? (
                <>
                  <Button
                    onClick={handleOpenCreateInstructionDialog}
                    disabled={isGenerating || isSavingInstruction || isCreatingGame}
                    sx={{
                      minHeight: 44,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed rgba(186, 202, 214, 0.28)',
                      backgroundColor: 'rgba(20, 24, 32, 0.66)',
                    }}
                  >
                    Добавить первую карточку
                  </Button>
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                    Добавьте инструкции с нужным стилем истории. Они автоматически отправляются с каждым вашим сообщением.
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    className="morius-scrollbar"
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      pr: 0.25,
                    }}
                  >
                    <Stack spacing={0.85}>
                      {instructionCards.map((card) => (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: '1px solid rgba(186, 202, 214, 0.2)',
                            backgroundColor: 'rgba(16, 20, 28, 0.68)',
                            px: 1,
                            py: 0.9,
                          }}
                        >
                          <Typography
                            sx={{
                              color: '#e2e8f3',
                              fontWeight: 700,
                              fontSize: '0.95rem',
                              lineHeight: 1.25,
                            }}
                          >
                            {card.title}
                          </Typography>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {card.content}
                          </Typography>
                          <Stack direction="row" spacing={0.45} justifyContent="flex-end" sx={{ mt: 0.8 }}>
                            <Button
                              onClick={() => handleOpenEditInstructionDialog(card)}
                              disabled={isSavingInstruction || deletingInstructionId === card.id || isGenerating || isCreatingGame}
                              sx={{
                                minHeight: 30,
                                borderRadius: '9px',
                                textTransform: 'none',
                                px: 1.1,
                                color: 'rgba(208, 219, 235, 0.9)',
                                fontSize: '0.8rem',
                              }}
                            >
                              Редактировать
                            </Button>
                            <Button
                              onClick={() => void handleDeleteInstructionCard(card.id)}
                              disabled={
                                isSavingInstruction || deletingInstructionId !== null || isGenerating || isCreatingGame
                              }
                              sx={{
                                minHeight: 30,
                                borderRadius: '9px',
                                textTransform: 'none',
                                px: 1.1,
                                color: 'rgba(248, 176, 176, 0.9)',
                                fontSize: '0.8rem',
                                border: '1px solid rgba(236, 142, 142, 0.22)',
                              }}
                            >
                              {deletingInstructionId === card.id ? (
                                <CircularProgress size={14} sx={{ color: 'rgba(248, 176, 176, 0.9)' }} />
                              ) : (
                                'Удалить'
                              )}
                            </Button>
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Button
                    onClick={handleOpenCreateInstructionDialog}
                    disabled={isGenerating || isSavingInstruction || deletingInstructionId !== null || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed rgba(186, 202, 214, 0.3)',
                      backgroundColor: 'rgba(18, 22, 30, 0.58)',
                    }}
                  >
                    Добавить карточку
                  </Button>
                </>
              )}
            </Box>
          ) : null}

          {rightPanelMode === 'ai' && activeAiPanelTab === 'settings' ? (
            <Box
              sx={{
                borderRadius: '12px',
                border: '1px dashed rgba(186, 202, 214, 0.22)',
                backgroundColor: 'rgba(18, 22, 30, 0.52)',
                px: 1.1,
                py: 1.2,
              }}
            >
              <Typography sx={{ color: 'rgba(190, 202, 220, 0.68)', fontSize: '0.9rem' }}>
                Настройки ИИ скоро появятся.
              </Typography>
            </Box>
          ) : null}

          {rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
            <Box
              sx={{
                borderRadius: '12px',
                border: '1px dashed rgba(186, 202, 214, 0.22)',
                backgroundColor: 'rgba(18, 22, 30, 0.52)',
                px: 1.1,
                py: 1.2,
              }}
            >
              <Typography sx={{ color: 'rgba(190, 202, 220, 0.68)', fontSize: '0.9rem' }}>
                Сюжетные заметки скоро появятся.
              </Typography>
            </Box>
          ) : null}

          {rightPanelMode === 'world' && activeWorldPanelTab === 'world' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {worldCards.length === 0 ? (
                <>
                  <Button
                    onClick={handleOpenCreateWorldCardDialog}
                    disabled={isGenerating || isSavingWorldCard || isCreatingGame}
                    sx={{
                      minHeight: 44,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed rgba(186, 202, 214, 0.28)',
                      backgroundColor: 'rgba(20, 24, 32, 0.66)',
                    }}
                  >
                    Добавить первую карточку
                  </Button>
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                    Здесь живут персонажи, предметы и важные детали мира. Используйте триггеры через запятую.
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    className="morius-scrollbar"
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      pr: 0.25,
                    }}
                  >
                    <Stack spacing={0.85}>
                      {worldCards.map((card) => (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: '1px solid rgba(186, 202, 214, 0.2)',
                            backgroundColor: 'rgba(16, 20, 28, 0.68)',
                            px: 1,
                            py: 0.9,
                          }}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.8}>
                            <Typography
                              sx={{
                                color: '#e2e8f3',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                lineHeight: 1.25,
                              }}
                            >
                              {card.title}
                            </Typography>
                            {card.source === 'ai' ? (
                              <Box
                                sx={{
                                  borderRadius: '999px',
                                  px: 0.7,
                                  py: 0.08,
                                  border: '1px solid rgba(168, 201, 255, 0.36)',
                                  color: 'rgba(192, 214, 255, 0.9)',
                                  fontSize: '0.7rem',
                                  lineHeight: 1.2,
                                  flexShrink: 0,
                                }}
                              >
                                ИИ
                              </Box>
                            ) : null}
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {card.content}
                          </Typography>
                          <Typography
                            sx={{
                              mt: 0.45,
                              color: 'rgba(178, 195, 221, 0.7)',
                              fontSize: '0.78rem',
                              lineHeight: 1.3,
                            }}
                          >
                            Триггеры: {card.triggers.length > 0 ? card.triggers.join(', ') : '—'}
                          </Typography>
                          <Stack direction="row" spacing={0.45} justifyContent="flex-end" sx={{ mt: 0.8 }}>
                            <Button
                              onClick={() => handleOpenEditWorldCardDialog(card)}
                              disabled={isSavingWorldCard || deletingWorldCardId === card.id || isGenerating || isCreatingGame}
                              sx={{
                                minHeight: 30,
                                borderRadius: '9px',
                                textTransform: 'none',
                                px: 1.1,
                                color: 'rgba(208, 219, 235, 0.9)',
                                fontSize: '0.8rem',
                              }}
                            >
                              Редактировать
                            </Button>
                            <Button
                              onClick={() => void handleDeleteWorldCard(card.id)}
                              disabled={isSavingWorldCard || deletingWorldCardId !== null || isGenerating || isCreatingGame}
                              sx={{
                                minHeight: 30,
                                borderRadius: '9px',
                                textTransform: 'none',
                                px: 1.1,
                                color: 'rgba(248, 176, 176, 0.9)',
                                fontSize: '0.8rem',
                                border: '1px solid rgba(236, 142, 142, 0.22)',
                              }}
                            >
                              {deletingWorldCardId === card.id ? (
                                <CircularProgress size={14} sx={{ color: 'rgba(248, 176, 176, 0.9)' }} />
                              ) : (
                                'Удалить'
                              )}
                            </Button>
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Button
                    onClick={handleOpenCreateWorldCardDialog}
                    disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed rgba(186, 202, 214, 0.3)',
                      backgroundColor: 'rgba(18, 22, 30, 0.58)',
                    }}
                  >
                    Добавить карточку
                  </Button>
                </>
              )}
            </Box>
          ) : null}
        </Box>
      </Box>

      <Box
        sx={{
          position: 'absolute',
          top: 74,
          left: 0,
          right: 0,
          bottom: { xs: 112, md: 128 },
          px: { xs: 1.4, md: 3 },
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 980,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            pt: { xs: 0.9, md: 1.1 },
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

          {isEditingTitle ? (
            <Box sx={{ px: { xs: 0.3, md: 0.8 }, mb: 1.1 }}>
              <Box
                component="input"
                value={titleDraft}
                autoFocus
                onChange={(event: ChangeEvent<HTMLInputElement>) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleSaveTitle()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    handleCancelTitleEdit()
                  }
                }}
                sx={{
                  width: '100%',
                  minHeight: 44,
                  borderRadius: '12px',
                  border: '1px solid rgba(188, 202, 220, 0.28)',
                  backgroundColor: 'rgba(18, 22, 30, 0.76)',
                  color: '#e3e9f4',
                  fontSize: { xs: '1.12rem', md: '1.3rem' },
                  fontWeight: 700,
                  px: 1.2,
                  outline: 'none',
                }}
              />
              <Stack direction="row" spacing={0.7} sx={{ mt: 0.7 }}>
                <Button
                  onClick={handleSaveTitle}
                  sx={{
                    minHeight: 34,
                    borderRadius: '10px',
                    textTransform: 'none',
                    color: '#e2e9f5',
                    border: '1px solid rgba(188, 202, 220, 0.26)',
                    backgroundColor: 'rgba(24, 29, 39, 0.8)',
                  }}
                >
                  Сохранить
                </Button>
                <Button
                  onClick={handleCancelTitleEdit}
                  sx={{
                    minHeight: 34,
                    borderRadius: '10px',
                    textTransform: 'none',
                    color: 'rgba(196, 208, 223, 0.88)',
                  }}
                >
                  Отмена
                </Button>
              </Stack>
            </Box>
          ) : (
            <Typography
              onClick={handleStartTitleEdit}
              title="Нажмите, чтобы изменить заголовок"
              sx={{
                px: { xs: 0.3, md: 0.8 },
                mb: 1.1,
                color: '#e0e7f4',
                fontWeight: 700,
                fontSize: { xs: '1.18rem', md: '1.42rem' },
                lineHeight: 1.25,
                cursor: isGenerating ? 'default' : 'text',
              }}
            >
              {activeDisplayTitle}
            </Typography>
          )}

          <Box
            ref={messagesViewportRef}
            className="morius-scrollbar"
            sx={{
              flex: 1,
              minHeight: 0,
              px: { xs: 0.3, md: 0.8 },
              pb: { xs: 1.5, md: 1.8 },
              overflowY: 'auto',
              overscrollBehavior: 'contain',
            }}
          >
            {isLoadingGameMessages ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}

            {!isLoadingGameMessages && messages.length === 0 ? (
              <Stack spacing={1.2} sx={{ color: 'rgba(210, 219, 234, 0.72)', mt: 0.6, maxWidth: 820 }}>
                <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.2rem' }, color: 'rgba(226, 232, 243, 0.9)' }}>
                  {quickStartIntro || INITIAL_STORY_PLACEHOLDER}
                </Typography>
              </Stack>
            ) : null}

            {!isLoadingGameMessages
              ? messages.map((message) => {
                  if (editingMessageId === message.id) {
                    return (
                      <Box
                        key={message.id}
                        sx={{
                          mb: 2.2,
                          borderRadius: '12px',
                          border: '1px solid rgba(186, 202, 214, 0.22)',
                          backgroundColor: 'rgba(13, 17, 24, 0.66)',
                          p: 1.1,
                        }}
                      >
                        <Box
                          component="textarea"
                          value={messageDraft}
                          autoFocus
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessageDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              handleCancelMessageEdit()
                            }
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                              event.preventDefault()
                              void handleSaveEditedMessage()
                            }
                          }}
                          sx={{
                            width: '100%',
                            minHeight: 108,
                            resize: 'vertical',
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: '#dbe2ee',
                            lineHeight: 1.58,
                            fontSize: { xs: '1rem', md: '1.07rem' },
                            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                          }}
                        />
                        <Stack direction="row" spacing={0.7} justifyContent="flex-end" sx={{ mt: 0.7 }}>
                          <Button
                            onClick={() => void handleSaveEditedMessage()}
                            disabled={isSavingMessage}
                            sx={{
                              minHeight: 34,
                              borderRadius: '10px',
                              textTransform: 'none',
                              color: '#dce4f1',
                              border: '1px solid rgba(186, 202, 214, 0.24)',
                              backgroundColor: 'rgba(23, 28, 38, 0.84)',
                              minWidth: 100,
                            }}
                          >
                            {isSavingMessage ? <CircularProgress size={16} sx={{ color: '#dce4f1' }} /> : 'Сохранить'}
                          </Button>
                          <Button
                            onClick={handleCancelMessageEdit}
                            disabled={isSavingMessage}
                            sx={{
                              minHeight: 34,
                              borderRadius: '10px',
                              textTransform: 'none',
                              color: 'rgba(193, 205, 221, 0.88)',
                            }}
                          >
                            Отмена
                          </Button>
                        </Stack>
                      </Box>
                    )
                  }

                  if (message.role === 'assistant') {
                    const paragraphs = splitAssistantParagraphs(message.content)
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating
                    const messageWorldCardEvents = worldCardEventsByAssistantId.get(message.id) ?? []
                    return (
                      <Box
                        key={message.id}
                        onClick={() => handleStartMessageEdit(message)}
                        title="Нажмите, чтобы изменить текст"
                        sx={{
                          mb: 2.4,
                          cursor: isGenerating ? 'default' : 'text',
                          borderRadius: '10px',
                          px: 0.42,
                          py: 0.3,
                          transition: 'background-color 180ms ease',
                          '&:hover': isGenerating ? {} : { backgroundColor: 'rgba(186, 202, 214, 0.06)' },
                        }}
                      >
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
                          {messageWorldCardEvents.length > 0 ? (
                            <Stack spacing={0.75}>
                              {messageWorldCardEvents.map((worldCardEvent) => {
                                const isExpanded = expandedWorldCardEventIds.includes(worldCardEvent.id)
                                const isUndoing = undoingWorldCardEventIds.includes(worldCardEvent.id)
                                const statusLabel = WORLD_CARD_EVENT_STATUS_LABEL[worldCardEvent.action]
                                const statusColor =
                                  worldCardEvent.action === 'added'
                                    ? 'rgba(118, 232, 177, 0.94)'
                                    : worldCardEvent.action === 'deleted'
                                      ? 'rgba(249, 160, 160, 0.92)'
                                      : 'rgba(112, 195, 248, 0.94)'
                                const statusBackground =
                                  worldCardEvent.action === 'added'
                                    ? 'rgba(51, 104, 81, 0.46)'
                                    : worldCardEvent.action === 'deleted'
                                      ? 'rgba(112, 55, 61, 0.46)'
                                      : 'rgba(44, 89, 126, 0.46)'

                                return (
                                  <Box
                                    key={worldCardEvent.id}
                                    onClick={(event) => event.stopPropagation()}
                                    sx={{
                                      borderRadius: '12px',
                                      border: '1px solid rgba(186, 202, 214, 0.2)',
                                      backgroundColor: 'rgba(26, 37, 56, 0.58)',
                                      px: 0.95,
                                      py: 0.62,
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" spacing={0.55}>
                                      <Box
                                        sx={{
                                          borderRadius: '999px',
                                          px: 0.65,
                                          py: 0.08,
                                          fontSize: '0.67rem',
                                          lineHeight: 1.2,
                                          textTransform: 'uppercase',
                                          letterSpacing: 0.2,
                                          color: statusColor,
                                          backgroundColor: statusBackground,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {statusLabel}
                                      </Box>
                                      <Typography
                                        sx={{
                                          color: 'rgba(226, 235, 248, 0.94)',
                                          fontSize: '0.88rem',
                                          lineHeight: 1.25,
                                          fontWeight: 600,
                                          flex: 1,
                                          minWidth: 0,
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        {worldCardEvent.title}
                                      </Typography>
                                      <IconButton
                                        aria-label="Откатить изменение карточки"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleUndoWorldCardEvent(worldCardEvent.id)
                                        }}
                                        disabled={isUndoing}
                                        sx={{ width: 28, height: 28 }}
                                      >
                                        {isUndoing ? (
                                          <CircularProgress size={14} sx={{ color: 'rgba(208, 220, 237, 0.86)' }} />
                                        ) : (
                                          <Box component="img" src={icons.undo} alt="" sx={{ width: 14, height: 14, opacity: 0.88 }} />
                                        )}
                                      </IconButton>
                                      <IconButton
                                        aria-label="Скрыть блок"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleDismissWorldCardEvent(worldCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '1.05rem',
                                          lineHeight: 1,
                                        }}
                                      >
                                        ×
                                      </IconButton>
                                      <IconButton
                                        aria-label={isExpanded ? 'Свернуть изменения' : 'Развернуть изменения'}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleToggleWorldCardEventExpanded(worldCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '0.98rem',
                                          lineHeight: 1,
                                        }}
                                      >
                                        {isExpanded ? '˄' : '˅'}
                                      </IconButton>
                                    </Stack>
                                    {isExpanded ? (
                                      <Typography
                                        sx={{
                                          mt: 0.55,
                                          color: 'rgba(202, 214, 232, 0.88)',
                                          fontSize: '0.82rem',
                                          lineHeight: 1.36,
                                          whiteSpace: 'pre-wrap',
                                        }}
                                      >
                                        {worldCardEvent.changed_text}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )
                              })}
                            </Stack>
                          ) : null}
                        </Stack>
                      </Box>
                    )
                  }

                  return (
                    <Typography
                      key={message.id}
                      onClick={() => handleStartMessageEdit(message)}
                      title="Нажмите, чтобы изменить текст"
                      sx={{
                        mb: 2.4,
                        color: 'rgba(198, 207, 222, 0.92)',
                        lineHeight: 1.58,
                        whiteSpace: 'pre-wrap',
                        fontSize: { xs: '1rem', md: '1.08rem' },
                        cursor: isGenerating ? 'default' : 'text',
                        borderRadius: '10px',
                        px: 0.42,
                        py: 0.3,
                        transition: 'background-color 180ms ease',
                        '&:hover': isGenerating ? {} : { backgroundColor: 'rgba(186, 202, 214, 0.06)' },
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
        open={instructionDialogOpen}
        onClose={handleCloseInstructionDialog}
        maxWidth="sm"
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
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingInstructionId === null ? 'Новая инструкция' : 'Редактирование инструкции'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={instructionTitleDraft}
              placeholder="Название карточки"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setInstructionTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveInstructionCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'rgba(16, 20, 27, 0.82)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={instructionContentDraft}
              placeholder="Опишите стиль, жанр, формат и другие пожелания к ответам ИИ."
              maxLength={8000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInstructionContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveInstructionCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 150,
                resize: 'vertical',
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'rgba(13, 17, 24, 0.8)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {instructionContentDraft.length}/8000
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button
            onClick={handleCloseInstructionDialog}
            disabled={isSavingInstruction || isCreatingGame}
            sx={{ color: 'text.secondary' }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveInstructionCard()}
            disabled={isSavingInstruction || isCreatingGame}
            sx={{
              backgroundColor: '#d9e4f2',
              color: '#171716',
              minWidth: 118,
              '&:hover': { backgroundColor: '#edf4fc' },
            }}
          >
            {isSavingInstruction || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: '#171716' }} />
            ) : editingInstructionId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={worldCardDialogOpen}
        onClose={handleCloseWorldCardDialog}
        maxWidth="sm"
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
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingWorldCardId === null ? 'Новая карточка мира' : 'Редактирование карточки мира'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={worldCardTitleDraft}
              placeholder="Название (персонаж, предмет, место)"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWorldCardTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveWorldCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'rgba(16, 20, 27, 0.82)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={worldCardContentDraft}
              placeholder="Кратко опишите сущность: внешность, роль, свойства, важные детали."
              maxLength={WORLD_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setWorldCardContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveWorldCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 130,
                resize: 'vertical',
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'rgba(13, 17, 24, 0.8)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Box
              component="input"
              value={worldCardTriggersDraft}
              placeholder="Триггеры через запятую: Алекс, Алексу, капитан"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWorldCardTriggersDraft(event.target.value)}
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'rgba(13, 17, 24, 0.8)',
                color: '#dbe2ee',
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {worldCardContentDraft.length}/{WORLD_CARD_CONTENT_MAX_LENGTH}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button onClick={handleCloseWorldCardDialog} disabled={isSavingWorldCard || isCreatingGame} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveWorldCard()}
            disabled={isSavingWorldCard || isCreatingGame}
            sx={{
              backgroundColor: '#d9e4f2',
              color: '#171716',
              minWidth: 118,
              '&:hover': { backgroundColor: '#edf4fc' },
            }}
          >
            {isSavingWorldCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: '#171716' }} />
            ) : editingWorldCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
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

