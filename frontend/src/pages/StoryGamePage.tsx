import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
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
  Menu,
  MenuItem,
  Slider,
  Stack,
  Typography,
  type GrowProps,
} from '@mui/material'
import type { AlertColor } from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import { OPEN_CHARACTER_MANAGER_FLAG_KEY, QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  createStoryCharacter,
  createStoryInstructionCard,
  createStoryGame,
  createStoryNpcFromCharacter,
  createStoryPlotCard,
  createStoryWorldCard,
  deleteStoryCharacter,
  deleteStoryInstructionCard,
  deleteStoryPlotCard,
  deleteStoryWorldCard,
  generateStoryResponseStream,
  getStoryGame,
  listStoryCharacters,
  listStoryGames,
  selectStoryMainHero,
  updateStoryCharacter,
  updateStoryGameSettings,
  updateStoryPlotCard,
  undoStoryPlotCardEvent,
  undoStoryWorldCardEvent,
  updateStoryInstructionCard,
  updateStoryWorldCardAiEdit,
  updateStoryWorldCardAvatar,
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
import type {
  StoryCharacter,
  StoryGameSummary,
  StoryInstructionCard,
  StoryMessage,
  StoryPlotCard,
  StoryPlotCardEvent,
  StoryWorldCard,
  StoryWorldCardEvent,
} from '../types/story'
import { compressImageFileToDataUrl } from '../utils/avatar'
import { moriusThemeTokens } from '../theme'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  initialGameId: number | null
  onNavigate: (path: string) => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
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

type RightPanelMode = 'ai' | 'world'
type AiPanelTab = 'instructions' | 'settings'
type WorldPanelTab = 'story' | 'world'
type PanelCardMenuType = 'instruction' | 'plot' | 'world'
type DeletionTargetType = 'instruction' | 'plot' | 'world' | 'character'
type CharacterDialogMode = 'manage' | 'select-main-hero' | 'select-npc'
type CharacterDraftMode = 'create' | 'edit'
type DeletionPrompt = {
  type: DeletionTargetType
  targetId: number
  title: string
  message: string
}
type AssistantMessageBlock =
  | { type: 'narrative'; text: string }
  | { type: 'npc'; npcName: string; text: string }

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const CHARACTER_AVATAR_MAX_BYTES = 200 * 1024
const INITIAL_STORY_PLACEHOLDER = 'Начните свою историю...'
const INITIAL_INPUT_PLACEHOLDER = 'Как же все началось?'
const NEXT_INPUT_PLACEHOLDER = 'Введите ваше действие...'
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const WORLD_CARD_CONTENT_MAX_LENGTH = 1000
const STORY_PLOT_CARD_CONTENT_MAX_LENGTH = 16000
const STORY_CONTEXT_LIMIT_MIN = 500
const STORY_CONTEXT_LIMIT_MAX = 5000
const STORY_DEFAULT_CONTEXT_LIMIT = 2000
const RIGHT_PANEL_WIDTH_MIN = 300
const RIGHT_PANEL_WIDTH_MAX = 460
const RIGHT_PANEL_WIDTH_DEFAULT = 332
const RIGHT_PANEL_CARD_HEIGHT = 198
const STORY_TOKEN_ESTIMATE_PATTERN = /[0-9a-zа-яё]+|[^\s]/gi
const STORY_MATCH_TOKEN_PATTERN = /[0-9a-zа-яё]+/gi
const WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
const CONTEXT_NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU')
const WORLD_CARD_EVENT_STATUS_LABEL: Record<'added' | 'updated' | 'deleted', string> = {
  added: 'Добавлено',
  updated: 'Обновлено',
  deleted: 'Удалено',
}
const NPC_DIALOGUE_MARKER_PATTERN = /^\[\[NPC:([^\]]+)\]\]\s*([\s\S]*)$/i
type WorldCardContextState = {
  isActive: boolean
  isAlwaysActive: boolean
  turnsRemaining: number
  lastTriggerTurn: number | null
  isTriggeredThisTurn: boolean
}

function splitAssistantParagraphs(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : ['']
}

function parseAssistantMessageBlocks(content: string): AssistantMessageBlock[] {
  const paragraphs = splitAssistantParagraphs(content)
  const blocks: AssistantMessageBlock[] = []
  paragraphs.forEach((paragraph) => {
    const markerMatch = paragraph.match(NPC_DIALOGUE_MARKER_PATTERN)
    if (!markerMatch) {
      blocks.push({ type: 'narrative', text: paragraph })
      return
    }
    const npcName = markerMatch[1].trim()
    const npcText = markerMatch[2].trim()
    if (!npcName || !npcText) {
      blocks.push({ type: 'narrative', text: paragraph })
      return
    }
    blocks.push({
      type: 'npc',
      npcName,
      text: npcText,
    })
  })
  return blocks
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

function normalizeCharacterTriggersDraft(draft: string, fallbackName: string): string[] {
  return normalizeWorldCardTriggersDraft(draft, fallbackName).slice(0, 40)
}

function clampStoryContextLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_CONTEXT_LIMIT
  }
  return Math.min(STORY_CONTEXT_LIMIT_MAX, Math.max(STORY_CONTEXT_LIMIT_MIN, Math.round(value)))
}

function clampRightPanelWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return RIGHT_PANEL_WIDTH_DEFAULT
  }
  return Math.min(RIGHT_PANEL_WIDTH_MAX, Math.max(RIGHT_PANEL_WIDTH_MIN, Math.round(value)))
}

function formatContextChars(value: number): string {
  return CONTEXT_NUMBER_FORMATTER.format(Math.max(0, Math.round(value)))
}

function estimateTextTokens(value: string): number {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return 0
  }
  const matches = normalized.toLowerCase().replace(/ё/g, 'е').match(STORY_TOKEN_ESTIMATE_PATTERN)
  if (matches && matches.length > 0) {
    return matches.length
  }
  return Math.max(1, Math.ceil(normalized.length / 4))
}

function normalizeStoryMatchTokens(value: string): string[] {
  const normalized = value.toLowerCase().replace(/ё/g, 'е')
  return normalized.match(STORY_MATCH_TOKEN_PATTERN) ?? []
}

function isStoryTriggerMatch(trigger: string, promptTokens: string[]): boolean {
  const triggerTokens = normalizeStoryMatchTokens(trigger)
  if (triggerTokens.length === 0) {
    return false
  }

  if (triggerTokens.length === 1) {
    const [triggerToken] = triggerTokens
    if (triggerToken.length < 2) {
      return false
    }
    return promptTokens.some((token) => {
      if (token === triggerToken || token.startsWith(triggerToken)) {
        return true
      }
      return token.length >= 4 && triggerToken.startsWith(token)
    })
  }

  return triggerTokens.every((triggerToken) =>
    promptTokens.some(
      (token) =>
        token === triggerToken || token.startsWith(triggerToken) || (token.length >= 4 && triggerToken.startsWith(token)),
    ),
  )
}

function formatTurnsWord(value: number): string {
  const absValue = Math.abs(Math.trunc(value))
  const mod10 = absValue % 10
  const mod100 = absValue % 100
  if (mod10 === 1 && mod100 !== 11) {
    return 'ход'
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'хода'
  }
  return 'ходов'
}

function formatWorldCardContextStatus(state: WorldCardContextState | undefined): string {
  if (!state || !state.isActive) {
    return 'неактивна'
  }
  if (state.isAlwaysActive) {
    return 'активна'
  }
  if (state.isTriggeredThisTurn) {
    return `активна · +${WORLD_CARD_TRIGGER_ACTIVE_TURNS} ${formatTurnsWord(WORLD_CARD_TRIGGER_ACTIVE_TURNS)}`
  }
  return `активна · ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
}

function buildWorldCardContextStateById(worldCards: StoryWorldCard[], messages: StoryMessage[]): Map<number, WorldCardContextState> {
  const userTurnTokens = messages
    .filter((message) => message.role === 'user')
    .map((message) => normalizeStoryMatchTokens(message.content.replace(/\r\n/g, '\n').trim()))
  const currentTurnIndex = userTurnTokens.length

  const stateById = new Map<number, WorldCardContextState>()
  worldCards.forEach((card) => {
    if (card.kind === 'main_hero') {
      stateById.set(card.id, {
        isActive: true,
        isAlwaysActive: true,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }

    const fallbackTrigger = card.title.replace(/\s+/g, ' ').trim()
    const triggers = card.triggers
      .map((trigger) => trigger.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (fallbackTrigger.length > 0 && !triggers.some((trigger) => trigger.toLowerCase() === fallbackTrigger.toLowerCase())) {
      triggers.unshift(fallbackTrigger)
    }

    let lastTriggerTurn = 0
    if (triggers.length > 0) {
      userTurnTokens.forEach((tokens, index) => {
        if (tokens.length === 0) {
          return
        }
        const matched = triggers.some((trigger) => isStoryTriggerMatch(trigger, tokens))
        if (matched) {
          lastTriggerTurn = index + 1
        }
      })
    }

    let isActive = false
    let turnsRemaining = 0
    let isTriggeredThisTurn = false
    if (lastTriggerTurn > 0 && currentTurnIndex > 0) {
      const turnsSinceTrigger = currentTurnIndex - lastTriggerTurn
      if (turnsSinceTrigger <= WORLD_CARD_TRIGGER_ACTIVE_TURNS) {
        isActive = true
        turnsRemaining = Math.max(WORLD_CARD_TRIGGER_ACTIVE_TURNS - turnsSinceTrigger, 0)
        isTriggeredThisTurn = turnsSinceTrigger === 0
      }
    }

    stateById.set(card.id, {
      isActive,
      isAlwaysActive: false,
      turnsRemaining,
      lastTriggerTurn: lastTriggerTurn > 0 ? lastTriggerTurn : null,
      isTriggeredThisTurn,
    })
  })

  return stateById
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
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        border: '1px solid rgba(186, 202, 214, 0.28)',
        background: 'linear-gradient(180deg, rgba(38, 45, 57, 0.9), rgba(18, 22, 30, 0.96))',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
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
  const avatarScale = Math.max(1, Math.min(3, user.avatar_scale ?? 1))

  if (user.avatar_url && user.avatar_url !== failedImageUrl) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          overflow: 'hidden',
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      >
        <Box
          component="img"
          src={user.avatar_url}
          alt={fallbackLabel}
          onError={() => setFailedImageUrl(user.avatar_url)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${avatarScale})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
    )
  }

  return <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
}

type CharacterAvatarProps = {
  avatarUrl: string | null
  avatarScale?: number
  fallbackLabel: string
  size?: number
}

function CharacterAvatar({ avatarUrl, avatarScale = 1, fallbackLabel, size = 44 }: CharacterAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)

  if (avatarUrl && avatarUrl !== failedImageUrl) {
    return (
      <Box
        sx={{
          display: 'block',
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          overflow: 'hidden',
          aspectRatio: '1 / 1',
          flexShrink: 0,
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      >
        <Box
          component="img"
          src={avatarUrl}
          alt={fallbackLabel}
          onError={() => setFailedImageUrl(avatarUrl)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            transform: `scale(${Math.max(1, Math.min(3, avatarScale))})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
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
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_WIDTH_DEFAULT)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('ai')
  const [activeAiPanelTab, setActiveAiPanelTab] = useState<AiPanelTab>('instructions')
  const [activeWorldPanelTab, setActiveWorldPanelTab] = useState<WorldPanelTab>('story')
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
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
  const [plotCards, setPlotCards] = useState<StoryPlotCard[]>([])
  const [plotCardDialogOpen, setPlotCardDialogOpen] = useState(false)
  const [editingPlotCardId, setEditingPlotCardId] = useState<number | null>(null)
  const [plotCardTitleDraft, setPlotCardTitleDraft] = useState('')
  const [plotCardContentDraft, setPlotCardContentDraft] = useState('')
  const [isSavingPlotCard, setIsSavingPlotCard] = useState(false)
  const [deletingPlotCardId, setDeletingPlotCardId] = useState<number | null>(null)
  const [plotCardEvents, setPlotCardEvents] = useState<StoryPlotCardEvent[]>([])
  const [dismissedPlotCardEventIds, setDismissedPlotCardEventIds] = useState<number[]>([])
  const [expandedPlotCardEventIds, setExpandedPlotCardEventIds] = useState<number[]>([])
  const [undoingPlotCardEventIds, setUndoingPlotCardEventIds] = useState<number[]>([])
  const [worldCards, setWorldCards] = useState<StoryWorldCard[]>([])
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [hasLoadedCharacters, setHasLoadedCharacters] = useState(false)
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false)
  const [isSavingCharacter, setIsSavingCharacter] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<number | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogMode, setCharacterDialogMode] = useState<CharacterDialogMode>('manage')
  const [characterDraftMode, setCharacterDraftMode] = useState<CharacterDraftMode>('create')
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null)
  const [characterNameDraft, setCharacterNameDraft] = useState('')
  const [characterDescriptionDraft, setCharacterDescriptionDraft] = useState('')
  const [characterTriggersDraft, setCharacterTriggersDraft] = useState('')
  const [characterAvatarDraft, setCharacterAvatarDraft] = useState<string | null>(null)
  const [characterAvatarError, setCharacterAvatarError] = useState('')
  const [isSelectingCharacter, setIsSelectingCharacter] = useState(false)
  const [worldCardAvatarTargetId, setWorldCardAvatarTargetId] = useState<number | null>(null)
  const [isSavingWorldCardAvatar, setIsSavingWorldCardAvatar] = useState(false)
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
  const [updatingWorldCardAiEditId, setUpdatingWorldCardAiEditId] = useState<number | null>(null)
  const [deletingWorldCardId, setDeletingWorldCardId] = useState<number | null>(null)
  const [mainHeroPreviewOpen, setMainHeroPreviewOpen] = useState(false)
  const [contextLimitChars, setContextLimitChars] = useState(STORY_DEFAULT_CONTEXT_LIMIT)
  const [contextLimitDraft, setContextLimitDraft] = useState(String(STORY_DEFAULT_CONTEXT_LIMIT))
  const [isSavingContextLimit, setIsSavingContextLimit] = useState(false)
  const [cardMenuAnchorEl, setCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [cardMenuType, setCardMenuType] = useState<PanelCardMenuType | null>(null)
  const [cardMenuCardId, setCardMenuCardId] = useState<number | null>(null)
  const [deletionPrompt, setDeletionPrompt] = useState<DeletionPrompt | null>(null)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const rightPanelResizingRef = useRef(false)
  const instructionDialogGameIdRef = useRef<number | null>(null)
  const plotCardDialogGameIdRef = useRef<number | null>(null)
  const worldCardDialogGameIdRef = useRef<number | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const worldCardAvatarInputRef = useRef<HTMLInputElement | null>(null)

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
  const rightPanelContentKey =
    rightPanelMode === 'ai'
      ? `ai-${activeAiPanelTab}`
      : `world-${activeWorldPanelTab}`
  const visibleWorldCardEvents = useMemo(
    () => worldCardEvents.filter((event) => !dismissedWorldCardEventIds.includes(event.id)),
    [dismissedWorldCardEventIds, worldCardEvents],
  )
  const visiblePlotCardEvents = useMemo(
    () => plotCardEvents.filter((event) => !dismissedPlotCardEventIds.includes(event.id)),
    [dismissedPlotCardEventIds, plotCardEvents],
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
  const plotCardEventsByAssistantId = useMemo(() => {
    const nextMap = new Map<number, StoryPlotCardEvent[]>()
    visiblePlotCardEvents.forEach((event) => {
      const currentItems = nextMap.get(event.assistant_message_id) ?? []
      currentItems.push(event)
      nextMap.set(event.assistant_message_id, currentItems)
    })
    return nextMap
  }, [visiblePlotCardEvents])
  const normalizedInstructionCardsForContext = useMemo(
    () =>
      instructionCards
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0),
    [instructionCards],
  )
  const normalizedPlotCardsForContext = useMemo(
    () =>
      plotCards
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0),
    [plotCards],
  )
  const worldCardContextStateById = useMemo(
    () => buildWorldCardContextStateById(worldCards, messages),
    [messages, worldCards],
  )
  const activeWorldCardsForContext = useMemo(
    () => worldCards.filter((card) => worldCardContextStateById.get(card.id)?.isActive),
    [worldCardContextStateById, worldCards],
  )
  const normalizedWorldCardsForContext = useMemo(
    () =>
      activeWorldCardsForContext
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
          triggers: card.triggers.map((trigger) => trigger.replace(/\s+/g, ' ').trim()).filter(Boolean),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0),
    [activeWorldCardsForContext],
  )
  const instructionContextTokensUsed = useMemo(() => {
    if (normalizedInstructionCardsForContext.length === 0) {
      return 0
    }
    const payload = normalizedInstructionCardsForContext
      .map((card, index) => `${index + 1}. ${card.title}: ${card.content}`)
      .join('\n')
    return estimateTextTokens(payload)
  }, [normalizedInstructionCardsForContext])
  const plotContextTokensUsed = useMemo(() => {
    if (normalizedPlotCardsForContext.length === 0) {
      return 0
    }
    const payload = normalizedPlotCardsForContext.map((card, index) => `${index + 1}. ${card.title}: ${card.content}`).join('\n')
    return estimateTextTokens(payload)
  }, [normalizedPlotCardsForContext])
  const historyContextTokensUsed = useMemo(() => {
    const normalizedHistory = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role,
        content: message.content.replace(/\r\n/g, '\n').trim(),
      }))
      .filter((message) => message.content.length > 0)
    if (normalizedHistory.length === 0) {
      return 0
    }

    const payload = normalizedHistory
      .map((message) => `${message.role === 'user' ? 'Игрок' : 'ИИ'}: ${message.content}`)
      .join('\n')
    return estimateTextTokens(payload)
  }, [messages])
  const worldContextTokensUsed = useMemo(() => {
    if (normalizedWorldCardsForContext.length === 0) {
      return 0
    }
    const lines: string[] = []
    normalizedWorldCardsForContext.forEach((card, index) => {
      lines.push(`${index + 1}. ${card.title}: ${card.content}`)
      lines.push(`Триггеры: ${card.triggers.length > 0 ? card.triggers.join(', ') : 'нет'}`)
    })
    return estimateTextTokens(lines.join('\n'))
  }, [normalizedWorldCardsForContext])
  const isPlotMemoryActive = normalizedPlotCardsForContext.length > 0
  const storyMemoryTokensUsed = isPlotMemoryActive ? plotContextTokensUsed : historyContextTokensUsed
  const storyMemoryLabel = isPlotMemoryActive ? 'Карточки сюжета' : 'История сообщений'
  const storyMemoryHint = isPlotMemoryActive
    ? `Учитываются карточки сюжета: ${normalizedPlotCardsForContext.length}.`
    : 'Карточек сюжета нет, учитывается история диалога.'
  const cardsContextCharsUsed = instructionContextTokensUsed + storyMemoryTokensUsed + worldContextTokensUsed
  const freeContextChars = Math.max(contextLimitChars - cardsContextCharsUsed, 0)
  const cardsContextOverflowChars = Math.max(cardsContextCharsUsed - contextLimitChars, 0)
  const cardsContextUsagePercent =
    contextLimitChars > 0 ? Math.min(100, (cardsContextCharsUsed / contextLimitChars) * 100) : 100
  const isInstructionCardActionLocked = isGenerating || isSavingInstruction || isCreatingGame || deletingInstructionId !== null
  const isPlotCardActionLocked = isGenerating || isSavingPlotCard || isCreatingGame || deletingPlotCardId !== null
  const isWorldCardActionLocked = isGenerating || isSavingWorldCard || isCreatingGame || deletingWorldCardId !== null
  const isDeletionPromptInProgress = Boolean(
    deletionPrompt &&
      ((deletionPrompt.type === 'instruction' && deletingInstructionId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'plot' && deletingPlotCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'world' && deletingWorldCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'character' && deletingCharacterId === deletionPrompt.targetId)),
  )
  const mainHeroCard = useMemo(
    () => worldCards.find((card) => card.kind === 'main_hero') ?? null,
    [worldCards],
  )
  const displayedWorldCards = useMemo(
    () => worldCards.filter((card) => card.kind !== 'main_hero'),
    [worldCards],
  )
  const resolveWorldCardAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card) {
        return null
      }
      return card.avatar_url
    },
    [],
  )
  const mainHeroAvatarUrl = useMemo(() => resolveWorldCardAvatar(mainHeroCard), [mainHeroCard, resolveWorldCardAvatar])
  const mainHeroCharacterId = useMemo(
    () => (mainHeroCard && mainHeroCard.character_id && mainHeroCard.character_id > 0 ? mainHeroCard.character_id : null),
    [mainHeroCard],
  )
  const npcCharacterIds = useMemo(() => {
    const selectedIds = new Set<number>()
    worldCards.forEach((card) => {
      if (card.kind !== 'npc' || !card.character_id || card.character_id <= 0) {
        return
      }
      selectedIds.add(card.character_id)
    })
    return selectedIds
  }, [worldCards])
  const getCharacterSelectionDisabledReason = useCallback(
    (characterId: number, mode: CharacterDialogMode): string | null => {
      if (mode === 'select-main-hero') {
        if (npcCharacterIds.has(characterId)) {
          return 'Уже выбран как NPC'
        }
        return null
      }

      if (mainHeroCharacterId !== null && characterId === mainHeroCharacterId) {
        return 'Уже выбран как ГГ'
      }
      if (npcCharacterIds.has(characterId)) {
        return 'Уже выбран как NPC'
      }
      return null
    },
    [mainHeroCharacterId, npcCharacterIds],
  )
  const npcCardsForAvatar = useMemo(() => {
    const entries: Array<{ name: string; avatar: string | null }> = []
    worldCards.forEach((card) => {
      if (card.kind !== 'npc') {
        return
      }
      const key = card.title.trim().toLowerCase()
      if (!key) {
        return
      }
      entries.push({ name: key, avatar: resolveWorldCardAvatar(card) })
    })
    return entries
  }, [resolveWorldCardAvatar, worldCards])
  const resolveNpcAvatar = useCallback(
    (npcName: string): string | null => {
      const normalizedName = npcName.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!normalizedName) {
        return null
      }

      const exact = npcCardsForAvatar.find((entry) => entry.name === normalizedName)
      if (exact) {
        return exact.avatar
      }

      const fuzzy = npcCardsForAvatar.find(
        (entry) => entry.name.startsWith(normalizedName) || normalizedName.startsWith(entry.name),
      )
      return fuzzy?.avatar ?? null
    },
    [npcCardsForAvatar],
  )
  const selectedMenuWorldCard = useMemo(
    () => (cardMenuType === 'world' && cardMenuCardId !== null ? worldCards.find((card) => card.id === cardMenuCardId) ?? null : null),
    [cardMenuCardId, cardMenuType, worldCards],
  )
  const selectedCharacterMenuItem = useMemo(
    () =>
      characterMenuCharacterId !== null
        ? characters.find((character) => character.id === characterMenuCharacterId) ?? null
        : null,
    [characterMenuCharacterId, characters],
  )
  const isSelectedMenuWorldCardLocked = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.is_locked,
  )
  const isSelectedMenuWorldCardAiEditUpdating = Boolean(
    selectedMenuWorldCard && updatingWorldCardAiEditId === selectedMenuWorldCard.id,
  )
  const canDeleteSelectedMenuWorldCard = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.kind !== 'main_hero',
  )
  const getWorldCardAiEditStatusLabel = useCallback(
    (card: StoryWorldCard): string => (card.ai_edit_enabled ? 'ИИ редактирование: разрешено' : 'ИИ редактирование: запрещено'),
    [],
  )

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
  const applyPlotCardEvents = useCallback((nextEvents: StoryPlotCardEvent[]) => {
    setPlotCardEvents(nextEvents)
    const eventIds = new Set(nextEvents.map((event) => event.id))
    setDismissedPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setExpandedPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setUndoingPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
  }, [])

  const loadCharacters = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      if (!silent) {
        setIsLoadingCharacters(true)
      }
      try {
        const loadedCharacters = await listStoryCharacters(authToken)
        setCharacters(loadedCharacters)
        setHasLoadedCharacters(true)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей'
        setErrorMessage(detail)
      } finally {
        if (!silent) {
          setIsLoadingCharacters(false)
        }
      }
    },
    [authToken],
  )

  const resetCharacterDraft = useCallback(() => {
    setCharacterDraftMode('create')
    setEditingCharacterId(null)
    setCharacterNameDraft('')
    setCharacterDescriptionDraft('')
    setCharacterTriggersDraft('')
    setCharacterAvatarDraft(null)
    setCharacterAvatarError('')
  }, [])

  const openCharacterDialog = useCallback(
    async (mode: CharacterDialogMode) => {
      setCharacterDialogMode(mode)
      setCharacterDialogOpen(true)
      setCharacterAvatarError('')
      if (!hasLoadedCharacters && !isLoadingCharacters) {
        await loadCharacters()
      }
    },
    [hasLoadedCharacters, isLoadingCharacters, loadCharacters],
  )

  const handleOpenCharacterManager = useCallback(async () => {
    resetCharacterDraft()
    await openCharacterDialog('manage')
  }, [openCharacterDialog, resetCharacterDraft])

  const handleOpenCharacterSelectorForMainHero = useCallback(async () => {
    await openCharacterDialog('select-main-hero')
  }, [openCharacterDialog])

  const handleOpenCharacterSelectorForNpc = useCallback(async () => {
    await openCharacterDialog('select-npc')
  }, [openCharacterDialog])

  const handleCloseCharacterDialog = useCallback(() => {
    if (isSavingCharacter || isSelectingCharacter) {
      return
    }
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setDeletionPrompt((previous) => (previous?.type === 'character' ? null : previous))
    setCharacterDialogOpen(false)
    setCharacterAvatarError('')
    if (characterDialogMode === 'manage') {
      resetCharacterDraft()
    }
  }, [characterDialogMode, isSavingCharacter, isSelectingCharacter, resetCharacterDraft])

  const handleStartCreateCharacter = useCallback(() => {
    resetCharacterDraft()
  }, [resetCharacterDraft])

  const handleStartEditCharacter = useCallback((character: StoryCharacter) => {
    setCharacterDraftMode('edit')
    setEditingCharacterId(character.id)
    setCharacterNameDraft(character.name)
    setCharacterDescriptionDraft(character.description)
    setCharacterTriggersDraft(character.triggers.join(', '))
    setCharacterAvatarDraft(character.avatar_url)
    setCharacterAvatarError('')
  }, [])

  const handleChooseCharacterAvatar = useCallback(() => {
    if (isSavingCharacter) {
      return
    }
    characterAvatarInputRef.current?.click()
  }, [isSavingCharacter])

  const handleCharacterAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setCharacterAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    setCharacterAvatarError('')
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(selectedFile, {
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: 960,
      })
      setCharacterAvatarDraft(compressedDataUrl)
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Не удалось обработать аватар персонажа'
      setCharacterAvatarError(detail)
    }
  }, [])

  const handleSaveCharacter = useCallback(async () => {
    if (isSavingCharacter) {
      return
    }

    const normalizedName = characterNameDraft.replace(/\s+/g, ' ').trim()
    const normalizedDescription = characterDescriptionDraft.replace(/\r\n/g, '\n').trim()
    if (!normalizedName) {
      setErrorMessage('Имя персонажа не может быть пустым')
      return
    }
    if (!normalizedDescription) {
      setErrorMessage('Описание персонажа не может быть пустым')
      return
    }

    const normalizedTriggers = normalizeCharacterTriggersDraft(characterTriggersDraft, normalizedName)
    setErrorMessage('')
    setIsSavingCharacter(true)
    try {
      if (characterDraftMode === 'create') {
        const createdCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: characterAvatarDraft,
          },
        })
        setCharacters((previous) => [...previous, createdCharacter])
      } else if (editingCharacterId !== null) {
        const updatedCharacter = await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: characterAvatarDraft,
          },
        })
        setCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
      }
      resetCharacterDraft()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacter(false)
    }
  }, [
    authToken,
    characterAvatarDraft,
    characterDescriptionDraft,
    characterDraftMode,
    characterNameDraft,
    characterTriggersDraft,
    editingCharacterId,
    isSavingCharacter,
    resetCharacterDraft,
  ])

  const handleDeleteCharacter = useCallback(
    async (characterId: number) => {
      if (deletingCharacterId !== null || isSavingCharacter) {
        return
      }
      setDeletingCharacterId(characterId)
      setErrorMessage('')
      try {
        await deleteStoryCharacter({
          token: authToken,
          characterId,
        })
        setCharacters((previous) => previous.filter((character) => character.id !== characterId))
        if (editingCharacterId === characterId) {
          resetCharacterDraft()
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить персонажа'
        setErrorMessage(detail)
      } finally {
        setDeletingCharacterId(null)
      }
    },
    [authToken, deletingCharacterId, editingCharacterId, isSavingCharacter, resetCharacterDraft],
  )

  const handleOpenCharacterItemMenu = useCallback((event: ReactMouseEvent<HTMLElement>, characterId: number) => {
    event.stopPropagation()
    setCharacterMenuAnchorEl(event.currentTarget)
    setCharacterMenuCharacterId(characterId)
  }, [])

  const handleCloseCharacterItemMenu = useCallback(() => {
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
  }, [])

  const handleEditCharacterFromMenu = useCallback(() => {
    if (!selectedCharacterMenuItem) {
      return
    }
    handleStartEditCharacter(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, handleStartEditCharacter, selectedCharacterMenuItem])

  const handleDeleteCharacterFromMenu = useCallback(async () => {
    if (!selectedCharacterMenuItem) {
      return
    }
    setDeletionPrompt({
      type: 'character',
      targetId: selectedCharacterMenuItem.id,
      title: 'Удалить персонажа?',
      message: `Персонаж «${selectedCharacterMenuItem.name}» будет удален из «Мои персонажи». Это действие нельзя отменить.`,
    })
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, selectedCharacterMenuItem, setDeletionPrompt])

  const handleEditMainHeroFromPreview = () => {
    if (!mainHeroCard || isWorldCardActionLocked) {
      return
    }
    handleOpenEditWorldCardDialog(mainHeroCard)
    setMainHeroPreviewOpen(false)
  }

  const ensureGameForCharacterSelection = useCallback(async (): Promise<number | null> => {
    if (activeGameId) {
      return activeGameId
    }
    setIsCreatingGame(true)
    try {
      const newGame = await createStoryGame({ token: authToken })
      setGames((previousGames) => sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]))
      setActiveGameId(newGame.id)
      const normalizedContextLimit = clampStoryContextLimit(newGame.context_limit_chars)
      setContextLimitChars(normalizedContextLimit)
      setContextLimitDraft(String(normalizedContextLimit))
      setInstructionCards([])
      setPlotCards([])
      setWorldCards([])
      applyPlotCardEvents([])
      applyWorldCardEvents([])
      onNavigate(`/home/${newGame.id}`)
      return newGame.id
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
      setErrorMessage(detail)
      return null
    } finally {
      setIsCreatingGame(false)
    }
  }, [activeGameId, applyPlotCardEvents, applyWorldCardEvents, authToken, onNavigate])

  const handleSelectCharacterForGame = useCallback(
    async (character: StoryCharacter) => {
      if (isSelectingCharacter) {
        return
      }
      const disabledReason = getCharacterSelectionDisabledReason(character.id, characterDialogMode)
      if (disabledReason) {
        setErrorMessage(disabledReason)
        return
      }
      setIsSelectingCharacter(true)
      setErrorMessage('')
      try {
        const targetGameId = await ensureGameForCharacterSelection()
        if (!targetGameId) {
          return
        }

        const createdCard =
          characterDialogMode === 'select-main-hero'
            ? await selectStoryMainHero({
                token: authToken,
                gameId: targetGameId,
                characterId: character.id,
              })
            : await createStoryNpcFromCharacter({
                token: authToken,
                gameId: targetGameId,
                characterId: character.id,
              })

        setWorldCards((previousCards) => {
          const hasCard = previousCards.some((card) => card.id === createdCard.id)
          if (hasCard) {
            return previousCards.map((card) => (card.id === createdCard.id ? createdCard : card))
          }
          return [...previousCards, createdCard]
        })
        setCharacterDialogOpen(false)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось применить персонажа'
        setErrorMessage(detail)
      } finally {
        setIsSelectingCharacter(false)
      }
    },
    [
      authToken,
      characterDialogMode,
      ensureGameForCharacterSelection,
      getCharacterSelectionDisabledReason,
      isSelectingCharacter,
    ],
  )

  const handleOpenWorldCardAvatarPicker = useCallback((cardId: number) => {
    if (isSavingWorldCardAvatar) {
      return
    }
    setWorldCardAvatarTargetId(cardId)
    worldCardAvatarInputRef.current?.click()
  }, [isSavingWorldCardAvatar])

  const handleWorldCardAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile || !activeGameId || worldCardAvatarTargetId === null) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorMessage('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    setErrorMessage('')
    setIsSavingWorldCardAvatar(true)
    try {
      const avatarDataUrl = await compressImageFileToDataUrl(selectedFile, {
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: 960,
      })
      const updatedCard = await updateStoryWorldCardAvatar({
        token: authToken,
        gameId: activeGameId,
        cardId: worldCardAvatarTargetId,
        avatar_url: avatarDataUrl,
      })
      setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить аватар персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingWorldCardAvatar(false)
      setWorldCardAvatarTargetId(null)
    }
  }, [activeGameId, authToken, worldCardAvatarTargetId])

  const handleToggleWorldCardAiEdit = useCallback(async () => {
    if (
      !activeGameId ||
      !selectedMenuWorldCard ||
      isWorldCardActionLocked ||
      isSelectedMenuWorldCardAiEditUpdating
    ) {
      return
    }
    const targetCard = selectedMenuWorldCard
    setErrorMessage('')
    setUpdatingWorldCardAiEditId(targetCard.id)
    try {
      const updatedCard = await updateStoryWorldCardAiEdit({
        token: authToken,
        gameId: activeGameId,
        cardId: targetCard.id,
        ai_edit_enabled: !targetCard.ai_edit_enabled,
      })
      setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      setCardMenuAnchorEl(null)
      setCardMenuType(null)
      setCardMenuCardId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить настройку редактирования ИИ'
      setErrorMessage(detail)
    } finally {
      setUpdatingWorldCardAiEditId(null)
    }
  }, [
    activeGameId,
    authToken,
    isSelectedMenuWorldCardAiEditUpdating,
    isWorldCardActionLocked,
    selectedMenuWorldCard,
  ])

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
        setPlotCards(payload.plot_cards ?? [])
        applyPlotCardEvents(payload.plot_card_events ?? [])
        setWorldCards(payload.world_cards)
        const normalizedContextLimit = clampStoryContextLimit(payload.game.context_limit_chars)
        setContextLimitChars(normalizedContextLimit)
        setContextLimitDraft(String(normalizedContextLimit))
        applyWorldCardEvents(payload.world_card_events ?? [])
        setGames((previousGames) => {
          const hasGame = previousGames.some((game) => game.id === payload.game.id)
          const nextGames = hasGame
            ? previousGames.map((game) => (game.id === payload.game.id ? payload.game : game))
            : [payload.game, ...previousGames]
          return sortGamesByActivity(nextGames)
        })
        setCustomTitleMap((previousMap) => {
          if (previousMap[payload.game.id]?.trim()) {
            return previousMap
          }
          const nextMap = setStoryTitle(previousMap, payload.game.id, payload.game.title)
          persistStoryTitleMap(nextMap)
          return nextMap
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
    [applyPlotCardEvents, applyWorldCardEvents, authToken],
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
        if (sortedGames.length > 0) {
          const preferredGameId =
            initialGameId && sortedGames.some((game) => game.id === initialGameId) ? initialGameId : sortedGames[0].id
          setActiveGameId(preferredGameId)
          await loadGameById(preferredGameId)
        } else {
          setActiveGameId(null)
          setMessages([])
          setInstructionCards([])
          setPlotCards([])
          setWorldCards([])
          setContextLimitChars(STORY_DEFAULT_CONTEXT_LIMIT)
          setContextLimitDraft(String(STORY_DEFAULT_CONTEXT_LIMIT))
          applyPlotCardEvents([])
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
  }, [applyPlotCardEvents, applyWorldCardEvents, authToken, initialGameId, loadGameById])

  useEffect(() => {
    setCustomTitleMap(loadStoryTitleMap())
  }, [])

  useEffect(() => {
    setQuickStartIntro('')
  }, [activeGameId])

  useEffect(() => {
    setCardMenuAnchorEl(null)
    setCardMenuType(null)
    setCardMenuCardId(null)
  }, [activeGameId])

  useEffect(() => {
    return () => {
      if (rightPanelResizingRef.current) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

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
    if (plotCardDialogGameIdRef.current === activeGameId) {
      return
    }
    plotCardDialogGameIdRef.current = activeGameId

    if (isSavingPlotCard || isCreatingGame) {
      return
    }
    setPlotCardDialogOpen(false)
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
    setDeletingPlotCardId(null)
  }, [activeGameId, isCreatingGame, isSavingPlotCard])

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
    if (!activeGameId) {
      return
    }
    const shouldOpenCharacterManager = localStorage.getItem(OPEN_CHARACTER_MANAGER_FLAG_KEY)
    if (shouldOpenCharacterManager !== '1') {
      return
    }
    localStorage.removeItem(OPEN_CHARACTER_MANAGER_FLAG_KEY)
    void handleOpenCharacterManager()
  }, [activeGameId, handleOpenCharacterManager])

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
        const normalizedContextLimit = clampStoryContextLimit(newGame.context_limit_chars)
        setContextLimitChars(normalizedContextLimit)
        setContextLimitDraft(String(normalizedContextLimit))
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
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
    applyPlotCardEvents,
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

  const handleOpenCreatePlotCardDialog = () => {
    if (isGenerating || isSavingPlotCard || isCreatingGame) {
      return
    }
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
    setPlotCardDialogOpen(true)
  }

  const handleOpenEditPlotCardDialog = (card: StoryPlotCard) => {
    if (isGenerating || isSavingPlotCard || isCreatingGame) {
      return
    }
    setEditingPlotCardId(card.id)
    setPlotCardTitleDraft(card.title)
    setPlotCardContentDraft(card.content)
    setPlotCardDialogOpen(true)
  }

  const handleClosePlotCardDialog = () => {
    if (isSavingPlotCard || isCreatingGame) {
      return
    }
    setPlotCardDialogOpen(false)
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
  }

  const handleSavePlotCard = useCallback(async () => {
    if (isSavingPlotCard || isCreatingGame) {
      return
    }

    const normalizedTitle = plotCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = plotCardContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки сюжета не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст карточки сюжета не может быть пустым')
      return
    }
    if (normalizedContent.length > STORY_PLOT_CARD_CONTENT_MAX_LENGTH) {
      setErrorMessage(`Текст карточки сюжета не должен превышать ${STORY_PLOT_CARD_CONTENT_MAX_LENGTH} символов`)
      return
    }

    setErrorMessage('')
    setIsSavingPlotCard(true)
    let targetGameId = activeGameId
    try {
      if (!targetGameId) {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        const normalizedContextLimit = clampStoryContextLimit(newGame.context_limit_chars)
        setContextLimitChars(normalizedContextLimit)
        setContextLimitDraft(String(normalizedContextLimit))
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      }

      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки сюжета')
        return
      }

      if (editingPlotCardId === null) {
        const createdCard = await createStoryPlotCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setPlotCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryPlotCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingPlotCardId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setPlotCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      }

      setPlotCardDialogOpen(false)
      setEditingPlotCardId(null)
      setPlotCardTitleDraft('')
      setPlotCardContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку сюжета'
      setErrorMessage(detail)
    } finally {
      setIsSavingPlotCard(false)
      setIsCreatingGame(false)
    }
  }, [
    activeGameId,
    authToken,
    editingPlotCardId,
    isCreatingGame,
    isSavingPlotCard,
    onNavigate,
    applyPlotCardEvents,
    applyWorldCardEvents,
    plotCardContentDraft,
    plotCardTitleDraft,
  ])

  const handleDeletePlotCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingPlotCardId !== null || isSavingPlotCard || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingPlotCardId(cardId)
      try {
        await deleteStoryPlotCard({
          token: authToken,
          gameId: activeGameId,
          cardId,
        })
        setPlotCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingPlotCardId === cardId) {
          setPlotCardDialogOpen(false)
          setEditingPlotCardId(null)
          setPlotCardTitleDraft('')
          setPlotCardContentDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку сюжета'
        setErrorMessage(detail)
      } finally {
        setDeletingPlotCardId(null)
      }
    },
    [activeGameId, authToken, deletingPlotCardId, editingPlotCardId, isCreatingGame, isSavingPlotCard],
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
        const normalizedContextLimit = clampStoryContextLimit(newGame.context_limit_chars)
        setContextLimitChars(normalizedContextLimit)
        setContextLimitDraft(String(normalizedContextLimit))
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
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
    applyPlotCardEvents,
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

  const handleOpenCardMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, type: PanelCardMenuType, cardId: number) => {
      event.stopPropagation()
      setCardMenuAnchorEl(event.currentTarget)
      setCardMenuType(type)
      setCardMenuCardId(cardId)
    },
    [],
  )

  const handleCloseCardMenu = useCallback(() => {
    setCardMenuAnchorEl(null)
    setCardMenuType(null)
    setCardMenuCardId(null)
  }, [])

  const handleCardMenuEdit = () => {
    if (cardMenuCardId === null || cardMenuType === null) {
      handleCloseCardMenu()
      return
    }

    if (cardMenuType === 'instruction') {
      const card = instructionCards.find((item) => item.id === cardMenuCardId)
      if (card) {
        handleOpenEditInstructionDialog(card)
      }
    } else if (cardMenuType === 'plot') {
      const card = plotCards.find((item) => item.id === cardMenuCardId)
      if (card) {
        handleOpenEditPlotCardDialog(card)
      }
    } else {
      const card = worldCards.find((item) => item.id === cardMenuCardId)
      if (card && !card.is_locked) {
        handleOpenEditWorldCardDialog(card)
      }
    }

    handleCloseCardMenu()
  }

  const handleCardMenuDelete = useCallback(async () => {
    if (cardMenuCardId === null || cardMenuType === null) {
      handleCloseCardMenu()
      return
    }

    const targetCardId = cardMenuCardId
    const targetType = cardMenuType
    handleCloseCardMenu()

    if (targetType === 'instruction') {
      const card = instructionCards.find((item) => item.id === targetCardId)
      const normalizedTitle = card?.title?.trim() || 'без названия'
      setDeletionPrompt({
        type: 'instruction',
        targetId: targetCardId,
        title: 'Удалить инструкцию?',
        message: `Инструкция «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
    if (targetType === 'plot') {
      const card = plotCards.find((item) => item.id === targetCardId)
      const normalizedTitle = card?.title?.trim() || 'без названия'
      setDeletionPrompt({
        type: 'plot',
        targetId: targetCardId,
        title: 'Удалить карточку сюжета?',
        message: `Карточка сюжета «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
    if (targetType === 'world') {
      const worldCard = worldCards.find((card) => card.id === targetCardId)
      if (worldCard?.kind === 'main_hero') {
        setErrorMessage('Главного героя нельзя удалить после выбора')
        return
      }
      const normalizedTitle = worldCard?.title?.trim() || 'без названия'
      const worldCardLabel =
        worldCard?.kind === 'npc' ? 'NPC-карточку' : 'карточку мира'
      setDeletionPrompt({
        type: 'world',
        targetId: targetCardId,
        title: 'Удалить карточку мира?',
        message: `${worldCardLabel} «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
  }, [
    cardMenuCardId,
    cardMenuType,
    handleCloseCardMenu,
    instructionCards,
    plotCards,
    setDeletionPrompt,
    worldCards,
    setErrorMessage,
  ])

  const handleCancelDeletionPrompt = useCallback(() => {
    if (deletingInstructionId !== null || deletingPlotCardId !== null || deletingWorldCardId !== null || deletingCharacterId !== null) {
      return
    }
    setDeletionPrompt(null)
  }, [deletingCharacterId, deletingInstructionId, deletingPlotCardId, deletingWorldCardId])

  const handleConfirmDeletionPrompt = useCallback(async () => {
    if (!deletionPrompt) {
      return
    }
    const prompt = deletionPrompt
    setDeletionPrompt(null)
    if (prompt.type === 'instruction') {
      await handleDeleteInstructionCard(prompt.targetId)
      return
    }
    if (prompt.type === 'plot') {
      await handleDeletePlotCard(prompt.targetId)
      return
    }
    if (prompt.type === 'world') {
      await handleDeleteWorldCard(prompt.targetId)
      return
    }
    await handleDeleteCharacter(prompt.targetId)
  }, [
    deletionPrompt,
    handleDeleteCharacter,
    handleDeleteInstructionCard,
    handleDeletePlotCard,
    handleDeleteWorldCard,
  ])

  const handleStartRightPanelResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    rightPanelResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const updateWidth = (clientX: number) => {
      const computedWidth = window.innerWidth - clientX - 18
      setRightPanelWidth(clampRightPanelWidth(computedWidth))
    }

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      updateWidth(mouseEvent.clientX)
    }

    const stopResizing = () => {
      rightPanelResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)
  }, [])

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

  const handleDismissPlotCardEvent = useCallback((eventId: number) => {
    setDismissedPlotCardEventIds((previousIds) => (previousIds.includes(eventId) ? previousIds : [...previousIds, eventId]))
  }, [])

  const handleTogglePlotCardEventExpanded = useCallback((eventId: number) => {
    setExpandedPlotCardEventIds((previousIds) =>
      previousIds.includes(eventId)
        ? previousIds.filter((value) => value !== eventId)
        : [...previousIds, eventId],
    )
  }, [])

  const handleUndoPlotCardEvent = useCallback(
    async (eventId: number) => {
      if (!activeGameId || undoingPlotCardEventIds.includes(eventId)) {
        return
      }

      setErrorMessage('')
      setUndoingPlotCardEventIds((previousIds) =>
        previousIds.includes(eventId) ? previousIds : [...previousIds, eventId],
      )
      try {
        await undoStoryPlotCardEvent({
          token: authToken,
          gameId: activeGameId,
          eventId,
        })
        await loadGameById(activeGameId, { silent: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось откатить изменение карточки сюжета'
        setErrorMessage(detail)
      } finally {
        setUndoingPlotCardEventIds((previousIds) => previousIds.filter((value) => value !== eventId))
      }
    },
    [activeGameId, authToken, loadGameById, undoingPlotCardEventIds],
  )

  const persistContextLimit = useCallback(
    async (nextValue: number) => {
      const targetGameId = activeGameId
      if (!targetGameId || isSavingContextLimit) {
        return
      }

      const normalizedValue = clampStoryContextLimit(nextValue)
      setContextLimitChars(normalizedValue)
      setContextLimitDraft(String(normalizedValue))
      setErrorMessage('')
      setIsSavingContextLimit(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          contextLimitTokens: normalizedValue,
        })
        const persistedValue = clampStoryContextLimit(updatedGame.context_limit_chars)
        setContextLimitChars(persistedValue)
        setContextLimitDraft(String(persistedValue))
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить лимит контекста'
        setErrorMessage(detail)
      } finally {
        setIsSavingContextLimit(false)
      }
    },
    [activeGameId, authToken, isSavingContextLimit],
  )

  const handleContextLimitSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    const normalizedValue = clampStoryContextLimit(rawValue)
    setContextLimitChars(normalizedValue)
    setContextLimitDraft(String(normalizedValue))
  }, [])

  const handleContextLimitSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistContextLimit(rawValue)
    },
    [persistContextLimit],
  )

  const handleContextLimitDraftChange = useCallback((value: string) => {
    const sanitized = value.replace(/[^\d]/g, '')
    setContextLimitDraft(sanitized)
    if (!sanitized) {
      return
    }
    const parsed = Number.parseInt(sanitized, 10)
    if (Number.isNaN(parsed)) {
      return
    }
    setContextLimitChars(clampStoryContextLimit(parsed))
  }, [])

  const handleContextLimitDraftCommit = useCallback(async () => {
    if (!contextLimitDraft.trim()) {
      const normalized = clampStoryContextLimit(contextLimitChars)
      setContextLimitDraft(String(normalized))
      await persistContextLimit(normalized)
      return
    }

    const parsed = Number.parseInt(contextLimitDraft, 10)
    const normalized = clampStoryContextLimit(Number.isNaN(parsed) ? contextLimitChars : parsed)
    setContextLimitChars(normalized)
    setContextLimitDraft(String(normalized))
    await persistContextLimit(normalized)
  }, [contextLimitChars, contextLimitDraft, persistContextLimit])

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
        const normalizedContextLimit = clampStoryContextLimit(newGame.context_limit_chars)
        setContextLimitChars(normalizedContextLimit)
        setContextLimitDraft(String(normalizedContextLimit))
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
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
  }, [activeGameId, applyPlotCardEvents, applyWorldCardEvents, authToken, inputValue, instructionCards, isGenerating, onNavigate, runStoryGeneration])

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

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }

  const profileName = user.display_name || 'Игрок'

  return (
    <Box
      className="morius-app-shell"
      sx={{
        height: '100svh',
        color: 'var(--morius-text-primary)',
        background: 'var(--morius-app-bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'games-all', label: 'Все игры', isActive: false, onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen={isRightPanelOpen}
        onToggleRightPanel={() => setIsRightPanelOpen((previous) => !previous)}
        rightToggleLabels={{
          expanded: 'Свернуть правую панель',
          collapsed: 'Развернуть правую панель',
        }}
        rightActionsWidth={220}
        rightActions={
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
                    : '1px solid var(--morius-card-border)',
                background:
                  rightPanelMode === 'world'
                    ? 'linear-gradient(180deg, #2d3b50, #243142)'
                    : 'var(--morius-card-bg)',
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
                    : '1px solid var(--morius-card-border)',
                background:
                  rightPanelMode === 'ai'
                    ? 'linear-gradient(180deg, #2d3b50, #243142)'
                    : 'var(--morius-card-bg)',
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
        }
      />

      <Box
        sx={{
          position: 'fixed',
          top: 82,
          right: 18,
          bottom: 20,
          width: { xs: 292, md: rightPanelWidth },
          zIndex: 25,
          borderRadius: '14px',
          border: '1px solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          opacity: isRightPanelOpen ? 1 : 0,
          pointerEvents: isRightPanelOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 18px 40px rgba(0, 0, 0, 0.28)',
        }}
      >
        <Box
          onMouseDown={handleStartRightPanelResize}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            zIndex: 2,
            display: { xs: 'none', md: 'block' },
            '&:hover::after': {
              opacity: 1,
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 1,
              top: 12,
              bottom: 12,
              width: 2,
              borderRadius: '999px',
              backgroundColor: 'rgba(186, 202, 214, 0.46)',
              opacity: 0,
              transition: 'opacity 180ms ease',
            },
          }}
        />
        <Box sx={{ px: 1.1, pt: 1.1, borderBottom: '1px solid var(--morius-card-border)' }}>
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
        <Box sx={{ p: 1.2, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Box
            key={rightPanelContentKey}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.2,
              minHeight: 0,
              flex: 1,
              animation: 'morius-panel-content-enter 240ms cubic-bezier(0.22, 1, 0.36, 1)',
              '@keyframes morius-panel-content-enter': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
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
                      backgroundColor: 'var(--morius-card-bg)',
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
                            border: '1px solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-card-bg)',
                            px: 1,
                            py: 0.85,
                            height: RIGHT_PANEL_CARD_HEIGHT,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.35}>
                            <Typography
                              sx={{
                                color: '#e2e8f3',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                lineHeight: 1.25,
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                            >
                              {card.title}
                            </Typography>
                            <Typography
                              sx={{
                                color: 'rgba(170, 238, 191, 0.96)',
                                fontSize: '0.66rem',
                                lineHeight: 1,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: '1px solid rgba(128, 213, 162, 0.48)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              активна
                            </Typography>
                            <IconButton
                              onClick={(event) => handleOpenCardMenu(event, 'instruction', card.id)}
                              disabled={isInstructionCardActionLocked}
                              sx={{ width: 26, height: 26, color: 'rgba(208, 219, 235, 0.84)' }}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                            </IconButton>
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 6,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {card.content}
                          </Typography>
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
                      border: '1px dashed var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
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
                px: 0.25,
                py: 0.2,
              }}
            >
              <Typography sx={{ color: '#dfe6f2', fontSize: '0.9rem', fontWeight: 700 }}>Лимит контекста</Typography>
              <Typography sx={{ mt: 0.4, color: 'rgba(190, 202, 220, 0.72)', fontSize: '0.82rem', lineHeight: 1.38 }}>
                Ограничивает размер отправляемого контекста в токенах.
              </Typography>

              {!activeGameId ? (
                <Typography sx={{ mt: 0.85, color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.82rem' }}>
                  Настройка появится после создания игры.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 1.15 }}>
                    <Box
                      component="input"
                      value={contextLimitDraft}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => handleContextLimitDraftChange(event.target.value)}
                      onBlur={() => {
                        void handleContextLimitDraftCommit()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleContextLimitDraftCommit()
                        }
                      }}
                      disabled={isSavingContextLimit || isGenerating}
                      inputMode="numeric"
                      sx={{
                        width: 112,
                        minHeight: 34,
                        borderRadius: '9px',
                        border: '1px solid rgba(186, 202, 214, 0.26)',
                        backgroundColor: 'rgba(12, 16, 24, 0.76)',
                        color: '#deE6f3',
                        px: 0.9,
                        outline: 'none',
                        fontSize: '0.88rem',
                      }}
                    />
                    <Typography sx={{ color: 'rgba(186, 202, 220, 0.68)', fontSize: '0.8rem' }}>токенов</Typography>
                    {isSavingContextLimit ? <CircularProgress size={14} sx={{ color: 'rgba(205, 215, 231, 0.86)' }} /> : null}
                  </Stack>

                  <Slider
                    value={contextLimitChars}
                    min={STORY_CONTEXT_LIMIT_MIN}
                    max={STORY_CONTEXT_LIMIT_MAX}
                    step={1}
                    onChange={handleContextLimitSliderChange}
                    onChangeCommitted={(event, value) => {
                      void handleContextLimitSliderCommit(event, value)
                    }}
                    disabled={isSavingContextLimit || isGenerating}
                    sx={{
                      mt: 0.9,
                      color: '#c6d3e5',
                      '& .MuiSlider-thumb': {
                        width: 16,
                        height: 16,
                      },
                    }}
                  />

                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.3 }}>
                    <Typography sx={{ color: 'rgba(184, 198, 219, 0.62)', fontSize: '0.74rem' }}>
                      {STORY_CONTEXT_LIMIT_MIN}
                    </Typography>
                    <Typography sx={{ color: 'rgba(184, 198, 219, 0.62)', fontSize: '0.74rem' }}>
                      {STORY_CONTEXT_LIMIT_MAX}
                    </Typography>
                  </Stack>

                  <Box
                    sx={{
                      mt: 1.05,
                      pt: 0.92,
                      borderTop: '1px solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography sx={{ color: '#dfe7f4', fontSize: '0.8rem', fontWeight: 700 }}>
                        Использование контекста
                      </Typography>
                      <Typography sx={{ color: 'rgba(194, 208, 227, 0.72)', fontSize: '0.76rem' }}>
                        {formatContextChars(cardsContextCharsUsed)} / {formatContextChars(contextLimitChars)}
                      </Typography>
                    </Stack>

                    <Box
                      sx={{
                        mt: 0.7,
                        height: 7,
                        borderRadius: '999px',
                        backgroundColor: 'rgba(123, 145, 172, 0.22)',
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        sx={{
                          width: `${cardsContextUsagePercent}%`,
                          height: '100%',
                          borderRadius: '999px',
                          background: 'linear-gradient(90deg, rgba(127, 214, 255, 0.9), rgba(159, 190, 255, 0.86))',
                          transition: 'width 180ms ease',
                        }}
                      />
                    </Box>

                    <Stack spacing={0.56} sx={{ mt: 0.85 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>Инструкции</Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(instructionContextTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>
                          {storyMemoryLabel}
                        </Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(storyMemoryTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>
                          Карточки мира (активные)
                        </Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(worldContextTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>Свободно</Typography>
                        <Typography
                          sx={{
                            color: cardsContextOverflowChars > 0 ? 'rgba(255, 167, 167, 0.92)' : 'rgba(185, 241, 194, 0.92)',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                          }}
                        >
                          {formatContextChars(freeContextChars)}
                        </Typography>
                      </Stack>
                    </Stack>

                    <Typography sx={{ mt: 0.72, color: 'rgba(176, 190, 211, 0.66)', fontSize: '0.73rem', lineHeight: 1.36 }}>
                      {storyMemoryHint} Карточек в контексте: инструкции {normalizedInstructionCardsForContext.length},
                      сюжет {normalizedPlotCardsForContext.length}, мир {normalizedWorldCardsForContext.length} из {worldCards.length}.
                    </Typography>

                    {cardsContextOverflowChars > 0 ? (
                      <Alert
                        severity="warning"
                        sx={{
                          mt: 0.78,
                          py: 0.2,
                          borderRadius: '8px',
                          backgroundColor: 'rgba(76, 40, 28, 0.64)',
                          color: 'rgba(255, 221, 189, 0.92)',
                          border: '1px solid rgba(255, 188, 138, 0.26)',
                          '& .MuiAlert-icon': {
                            color: 'rgba(255, 201, 153, 0.95)',
                            alignItems: 'center',
                            py: 0.1,
                          },
                        }}
                      >
                        Карточки превышают лимит на {formatContextChars(cardsContextOverflowChars)} токенов.
                      </Alert>
                    ) : null}
                  </Box>
                </>
              )}
            </Box>
          ) : null}

          {rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {plotCards.length === 0 ? (
                <>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || isCreatingGame}
                    sx={{
                      minHeight: 44,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed rgba(186, 202, 214, 0.28)',
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  >
                    Добавить первую карточку
                  </Button>
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                    Здесь хранятся сюжетные сводки и важные изменения истории.
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
                      {plotCards.map((card) => (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: '1px solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-card-bg)',
                            px: 1,
                            py: 0.85,
                            height: RIGHT_PANEL_CARD_HEIGHT,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                          }}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.8}>
                            <Typography
                              sx={{
                                color: '#e2e8f3',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                lineHeight: 1.25,
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                            >
                              {card.title}
                            </Typography>
                            <Typography
                              sx={{
                                color: 'rgba(170, 238, 191, 0.96)',
                                fontSize: '0.66rem',
                                lineHeight: 1,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: '1px solid rgba(128, 213, 162, 0.48)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              активна
                            </Typography>
                            {card.source === 'ai' ? (
                              <Typography
                                sx={{
                                  color: 'rgba(165, 188, 224, 0.66)',
                                  fontSize: '0.68rem',
                                  lineHeight: 1,
                                  letterSpacing: 0.2,
                                  flexShrink: 0,
                                }}
                              >
                                ии
                              </Typography>
                            ) : null}
                            <IconButton
                              onClick={(event) => handleOpenCardMenu(event, 'plot', card.id)}
                              disabled={isPlotCardActionLocked}
                              sx={{ width: 26, height: 26, color: 'rgba(208, 219, 235, 0.84)' }}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                            </IconButton>
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 7,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {card.content}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || deletingPlotCardId !== null || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px dashed var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  >
                    Добавить карточку
                  </Button>
                </>
              )}
            </Box>
          ) : null}

          {rightPanelMode === 'world' && activeWorldPanelTab === 'world' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Stack direction="column" spacing={0.7}>
                {!mainHeroCard ? (
                  <Button
                    onClick={() => void handleOpenCharacterSelectorForMainHero()}
                    disabled={isGenerating || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: '1px solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  >
                    Выбрать главного героя
                  </Button>
                ) : (
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Открыть описание главного героя"
                    onClick={() => setMainHeroPreviewOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setMainHeroPreviewOpen(true)
                      }
                    }}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      border: '1px solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      px: 0.8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.7,
                      cursor: 'pointer',
                      transition: 'border-color 180ms ease, background-color 180ms ease',
                      '&:hover': {
                        borderColor: 'rgba(143, 169, 199, 0.52)',
                        backgroundColor: 'rgba(20, 25, 34, 0.92)',
                      },
                      '&:focus-visible': {
                        outline: 'none',
                        borderColor: 'rgba(168, 196, 231, 0.72)',
                        boxShadow: '0 0 0 1px rgba(168, 196, 231, 0.42) inset',
                      },
                    }}
                  >
                    <CharacterAvatar avatarUrl={mainHeroAvatarUrl} avatarScale={mainHeroCard.avatar_scale} fallbackLabel={mainHeroCard.title} size={28} />
                    <Stack spacing={0.05} sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: '#d9dee8',
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {mainHeroCard.title}
                      </Typography>
                      <Typography sx={{ color: 'rgba(166, 186, 214, 0.74)', fontSize: '0.74rem', lineHeight: 1.1 }}>
                        Главный герой выбран
                      </Typography>
                      <Typography
                        sx={{
                          color: mainHeroCard.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                          fontSize: '0.7rem',
                          lineHeight: 1.1,
                        }}
                      >
                        {getWorldCardAiEditStatusLabel(mainHeroCard)}
                      </Typography>
                    </Stack>
                    <IconButton
                      onClick={(event) => handleOpenCardMenu(event, 'world', mainHeroCard.id)}
                      disabled={isWorldCardActionLocked}
                      sx={{ width: 26, height: 26, color: 'rgba(208, 219, 235, 0.84)', ml: 'auto', flexShrink: 0 }}
                    >
                      <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                    </IconButton>
                  </Box>
                )}
                <Button
                  onClick={() => void handleOpenCharacterSelectorForNpc()}
                  disabled={isGenerating || isCreatingGame}
                  sx={{
                    minHeight: 40,
                    borderRadius: '12px',
                    textTransform: 'none',
                    color: '#d9dee8',
                    border: '1px solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                  }}
                >
                  Добавить NPC из персонажей
                </Button>
              </Stack>
              <Typography sx={{ color: 'rgba(171, 189, 214, 0.66)', fontSize: '0.76rem', lineHeight: 1.35 }}>
                Главный герой всегда активен. Остальные карточки мира активируются по триггеру и остаются в контексте еще на 5 ходов.
              </Typography>

              {displayedWorldCards.length === 0 ? (
                <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                  Здесь живут NPC, предметы и важные детали мира. Главный герой отображается выше.
                </Typography>
              ) : (
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
                    {displayedWorldCards.map((card) => {
                      const contextState = worldCardContextStateById.get(card.id)
                      const isCardContextActive = Boolean(contextState?.isActive)
                      return (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: isCardContextActive
                              ? '1px solid rgba(131, 213, 164, 0.62)'
                              : '1px solid var(--morius-card-border)',
                            backgroundColor: isCardContextActive ? 'rgba(18, 30, 24, 0.54)' : 'var(--morius-card-bg)',
                            boxShadow: isCardContextActive ? '0 0 0 1px rgba(79, 164, 116, 0.22) inset' : 'none',
                            px: 1,
                            py: 0.85,
                            height: RIGHT_PANEL_CARD_HEIGHT,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                          }}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.8}>
                            <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                              {card.kind === 'npc' || card.kind === 'main_hero' ? (
                                <Button
                                  onClick={() => handleOpenWorldCardAvatarPicker(card.id)}
                                  disabled={isSavingWorldCardAvatar || isGenerating || isCreatingGame}
                                  sx={{
                                    minWidth: 0,
                                    minHeight: 0,
                                    p: 0,
                                    width: 30,
                                    height: 30,
                                    borderRadius: '50%',
                                    flexShrink: 0,
                                    lineHeight: 0,
                                  }}
                                >
                                  <CharacterAvatar avatarUrl={resolveWorldCardAvatar(card)} avatarScale={card.avatar_scale} fallbackLabel={card.title} size={30} />
                                </Button>
                              ) : null}
                              <Typography
                                sx={{
                                  color: '#e2e8f3',
                                  fontWeight: 700,
                                  fontSize: '0.95rem',
                                  lineHeight: 1.25,
                                  flex: 1,
                                  minWidth: 0,
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  overflow: 'hidden',
                                }}
                              >
                                {card.title}
                              </Typography>
                            </Stack>
                            <Typography
                              sx={{
                                color: isCardContextActive ? 'rgba(170, 238, 191, 0.96)' : 'rgba(155, 172, 196, 0.84)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.22,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: isCardContextActive
                                  ? '1px solid rgba(128, 213, 162, 0.48)'
                                  : '1px solid rgba(137, 154, 178, 0.38)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              {formatWorldCardContextStatus(contextState)}
                            </Typography>
                            <Typography
                              sx={{
                                color: card.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.18,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: card.ai_edit_enabled
                                  ? '1px solid rgba(132, 168, 210, 0.4)'
                                  : '1px solid rgba(236, 148, 148, 0.46)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              {card.ai_edit_enabled ? 'ИИ: РАЗРЕШЕНО' : 'ИИ: ЗАПРЕЩЕНО'}
                            </Typography>
                            {card.source === 'ai' ? (
                              <Typography
                                sx={{
                                  color: 'rgba(165, 188, 224, 0.66)',
                                  fontSize: '0.68rem',
                                  lineHeight: 1,
                                  letterSpacing: 0.2,
                                  flexShrink: 0,
                                }}
                              >
                                ии
                              </Typography>
                            ) : null}
                            <IconButton
                              onClick={(event) => handleOpenCardMenu(event, 'world', card.id)}
                              disabled={isWorldCardActionLocked}
                              sx={{ width: 26, height: 26, color: 'rgba(208, 219, 235, 0.84)' }}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                            </IconButton>
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 5,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
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
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            Триггеры: {card.triggers.length > 0 ? card.triggers.join(', ') : '—'}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              )}
              <Button
                onClick={handleOpenCreateWorldCardDialog}
                disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                sx={{
                  minHeight: 40,
                  borderRadius: '12px',
                  textTransform: 'none',
                  color: '#d9dee8',
                  border: '1px dashed var(--morius-card-border)',
                  backgroundColor: 'var(--morius-card-bg)',
                }}
              >
                Новая карточка мира
              </Button>
            </Box>
          ) : null}
        </Box>
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
          {paymentNotice ? (
            <Alert
              severity={paymentNotice.severity}
              onClose={() => setPaymentNotice(null)}
              sx={{ width: '100%', mb: 1.2, borderRadius: '12px' }}
            >
              {paymentNotice.text}
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
                          backgroundColor: 'var(--morius-card-bg)',
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
                    const blocks = parseAssistantMessageBlocks(message.content)
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating
                    const messagePlotCardEvents = plotCardEventsByAssistantId.get(message.id) ?? []
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
                          {blocks.map((block, index) => {
                            if (block.type === 'npc') {
                              const npcAvatar = resolveNpcAvatar(block.npcName)
                              return (
                                <Stack
                                  key={`${message.id}-${index}-npc`}
                                  direction="row"
                                  spacing={0.9}
                                  alignItems="flex-start"
                                  sx={{
                                    borderRadius: '12px',
                                    border: '1px solid rgba(186, 202, 214, 0.2)',
                                    backgroundColor: 'rgba(22, 30, 42, 0.56)',
                                    px: 0.85,
                                    py: 0.7,
                                  }}
                                >
                                  <CharacterAvatar avatarUrl={npcAvatar} fallbackLabel={block.npcName} size={30} />
                                  <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                                    <Typography
                                      sx={{
                                        color: 'rgba(178, 198, 228, 0.9)',
                                        fontSize: '0.84rem',
                                        lineHeight: 1.2,
                                        fontWeight: 700,
                                        letterSpacing: 0.18,
                                      }}
                                    >
                                      {block.npcName}
                                    </Typography>
                                    <Typography
                                      sx={{
                                        color: '#d8dde7',
                                        lineHeight: 1.54,
                                        fontSize: { xs: '1rem', md: '1.08rem' },
                                        whiteSpace: 'pre-wrap',
                                      }}
                                    >
                                      {block.text}
                                    </Typography>
                                  </Stack>
                                </Stack>
                              )
                            }

                            return (
                              <Typography
                                key={`${message.id}-${index}`}
                                sx={{
                                  color: '#d8dde7',
                                  lineHeight: 1.58,
                                  fontSize: { xs: '1.02rem', md: '1.12rem' },
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {block.text}
                              </Typography>
                            )
                          })}
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
                          {messagePlotCardEvents.length > 0 || messageWorldCardEvents.length > 0 ? (
                            <Stack spacing={0.75}>
                              {messagePlotCardEvents.map((plotCardEvent) => {
                                const isExpanded = expandedPlotCardEventIds.includes(plotCardEvent.id)
                                const isUndoing = undoingPlotCardEventIds.includes(plotCardEvent.id)
                                const statusLabel = WORLD_CARD_EVENT_STATUS_LABEL[plotCardEvent.action]
                                const statusColor =
                                  plotCardEvent.action === 'added'
                                    ? 'rgba(118, 232, 177, 0.94)'
                                    : plotCardEvent.action === 'deleted'
                                      ? 'rgba(249, 160, 160, 0.92)'
                                      : 'rgba(112, 195, 248, 0.94)'
                                const statusBackground =
                                  plotCardEvent.action === 'added'
                                    ? 'rgba(51, 104, 81, 0.46)'
                                    : plotCardEvent.action === 'deleted'
                                      ? 'rgba(112, 55, 61, 0.46)'
                                      : 'rgba(44, 89, 126, 0.46)'

                                return (
                                  <Box
                                    key={`plot-event-${plotCardEvent.id}`}
                                    onClick={(event) => event.stopPropagation()}
                                    sx={{
                                      borderRadius: '12px',
                                      border: '1px solid var(--morius-card-border)',
                                      backgroundColor: 'rgba(26, 37, 56, 0.58)',
                                      px: 0.95,
                                      py: 0.62,
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" spacing={0.55}>
                                      <Box
                                        sx={{
                                          borderRadius: '999px',
                                          px: 0.92,
                                          py: 0.22,
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
                                        {plotCardEvent.title}
                                      </Typography>
                                      <IconButton
                                        aria-label="Откатить изменение карточки сюжета"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleUndoPlotCardEvent(plotCardEvent.id)
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
                                          handleDismissPlotCardEvent(plotCardEvent.id)
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
                                          handleTogglePlotCardEventExpanded(plotCardEvent.id)
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
                                        {plotCardEvent.changed_text}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )
                              })}
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
                                      border: '1px solid var(--morius-card-border)',
                                      backgroundColor: 'rgba(26, 37, 56, 0.58)',
                                      px: 0.95,
                                      py: 0.62,
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" spacing={0.55}>
                                      <Box
                                        sx={{
                                          borderRadius: '999px',
                                          px: 0.92,
                                          py: 0.22,
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
                    <Stack
                      key={message.id}
                      onClick={() => handleStartMessageEdit(message)}
                      title="Нажмите, чтобы изменить текст"
                      direction="row"
                      spacing={0.8}
                      alignItems="flex-start"
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
                      <CharacterAvatar
                        avatarUrl={mainHeroAvatarUrl}
                        fallbackLabel={mainHeroCard?.title || user.display_name || 'Игрок'}
                        size={28}
                      />
                      <Typography
                        sx={{
                          color: 'rgba(198, 207, 222, 0.92)',
                          lineHeight: 1.58,
                          whiteSpace: 'pre-wrap',
                          fontSize: { xs: '1rem', md: '1.08rem' },
                          pt: 0.14,
                        }}
                      >
                        {message.content}
                      </Typography>
                    </Stack>
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
              border: '1px solid var(--morius-card-border)',
              background: 'var(--morius-card-bg)',
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
                borderTop: '1px solid var(--morius-card-border)',
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
                  backgroundColor: 'var(--morius-button-active)',
                  border: '1px solid var(--morius-card-border)',
                  color: 'var(--morius-text-primary)',
                  '&:disabled': {
                    opacity: 0.5,
                    backgroundColor: 'var(--morius-button-hover)',
                  },
                }}
              >
                {isGenerating ? (
                  <Box
                    sx={{
                      width: 11,
                      height: 11,
                      borderRadius: '2px',
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  />
                ) : (
                  <Box component="img" src={icons.send} alt="" sx={{ width: 18, height: 18 }} />
                )}
              </IconButton>
            </Stack>
          </Box>
      </Box>

      <input
        ref={characterAvatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleCharacterAvatarChange}
        style={{ display: 'none' }}
      />
      <input
        ref={worldCardAvatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleWorldCardAvatarChange}
        style={{ display: 'none' }}
      />

      <Menu
        anchorEl={cardMenuAnchorEl}
        open={Boolean(cardMenuAnchorEl)}
        onClose={handleCloseCardMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 154,
          },
        }}
      >
        {cardMenuType === 'world' ? (
          <MenuItem
            onClick={() => {
              void handleToggleWorldCardAiEdit()
            }}
            disabled={isWorldCardActionLocked || !selectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuWorldCardAiEditUpdating ? (
              <CircularProgress size={14} sx={{ color: 'rgba(220, 231, 245, 0.92)' }} />
            ) : selectedMenuWorldCard?.ai_edit_enabled ? (
              'Не редактировать ИИ'
            ) : (
              'Разрешить редактирование ИИ'
            )}
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={handleCardMenuEdit}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked
                  : isWorldCardActionLocked || isSelectedMenuWorldCardLocked || isSelectedMenuWorldCardAiEditUpdating
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          Редактировать
        </MenuItem>
        <MenuItem
          onClick={() => {
            void handleCardMenuDelete()
          }}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked
                  : isWorldCardActionLocked || !canDeleteSelectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating
          }
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          Удалить
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(deletionPrompt)}
        onClose={handleCancelDeletionPrompt}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>{deletionPrompt?.title || 'Подтвердите удаление'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            {deletionPrompt?.message || 'Это действие нельзя отменить.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCancelDeletionPrompt} disabled={isDeletionPromptInProgress} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmDeletionPrompt()}
            disabled={isDeletionPromptInProgress}
            sx={{
              border: '1px solid rgba(228, 120, 120, 0.44)',
              backgroundColor: 'rgba(184, 78, 78, 0.3)',
              color: 'rgba(251, 190, 190, 0.94)',
              '&:hover': {
                backgroundColor: 'rgba(196, 88, 88, 0.4)',
              },
            }}
          >
            {isDeletionPromptInProgress ? (
              <CircularProgress size={16} sx={{ color: 'rgba(251, 190, 190, 0.94)' }} />
            ) : (
              'Удалить'
            )}
          </Button>
        </DialogActions>
      </Dialog>

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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
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
                backgroundColor: 'var(--morius-card-bg)',
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
                backgroundColor: 'var(--morius-card-bg)',
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
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingInstruction || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingInstructionId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={plotCardDialogOpen}
        onClose={handleClosePlotCardDialog}
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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingPlotCardId === null ? 'Новая карточка сюжета' : 'Редактирование карточки сюжета'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={plotCardTitleDraft}
              placeholder="Название карточки сюжета"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPlotCardTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSavePlotCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={plotCardContentDraft}
              placeholder="Кратко сохраните важные сюжетные события и детали."
              maxLength={STORY_PLOT_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPlotCardContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSavePlotCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 140,
                resize: 'vertical',
                borderRadius: '11px',
                border: '1px solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
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
              {plotCardContentDraft.length}/{STORY_PLOT_CARD_CONTENT_MAX_LENGTH}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button onClick={handleClosePlotCardDialog} disabled={isSavingPlotCard || isCreatingGame} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSavePlotCard()}
            disabled={isSavingPlotCard || isCreatingGame}
            sx={{
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingPlotCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingPlotCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={mainHeroPreviewOpen && Boolean(mainHeroCard)}
        onClose={() => setMainHeroPreviewOpen(false)}
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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {mainHeroCard?.title || 'Главный герой'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1}>
            <Typography
              sx={{
                color: '#dbe2ee',
                fontSize: '0.95rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}
            >
              {mainHeroCard?.content || 'Описание недоступно.'}
            </Typography>
            <Typography sx={{ color: 'rgba(178, 195, 221, 0.7)', fontSize: '0.82rem', lineHeight: 1.4 }}>
              Триггеры: {mainHeroCard?.triggers.length ? mainHeroCard.triggers.join(', ') : '—'}
            </Typography>
            {mainHeroCard ? (
              <Typography
                sx={{
                  color: mainHeroCard.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                  fontSize: '0.8rem',
                  lineHeight: 1.35,
                }}
              >
                {getWorldCardAiEditStatusLabel(mainHeroCard)}
              </Typography>
            ) : null}
            <Typography sx={{ color: 'rgba(170, 238, 191, 0.86)', fontSize: '0.8rem', lineHeight: 1.35 }}>
              Главный герой всегда активен и всегда учитывается в контексте.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button
            onClick={handleEditMainHeroFromPreview}
            disabled={!mainHeroCard || isWorldCardActionLocked}
            sx={{ color: 'var(--morius-text-primary)' }}
          >
            Редактировать
          </Button>
          <Button onClick={() => setMainHeroPreviewOpen(false)} sx={{ color: 'text.secondary' }}>
            Закрыть
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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
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
                backgroundColor: 'var(--morius-card-bg)',
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
                backgroundColor: 'var(--morius-card-bg)',
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
                backgroundColor: 'var(--morius-card-bg)',
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
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingWorldCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingWorldCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={characterDialogOpen}
        onClose={handleCloseCharacterDialog}
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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {characterDialogMode === 'manage'
              ? 'Мои персонажи'
              : characterDialogMode === 'select-main-hero'
                ? 'Выбрать главного героя'
                : 'Выбрать NPC'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          {isLoadingCharacters && characters.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4 }}>
              <CircularProgress size={26} />
            </Stack>
          ) : null}

          {characterDialogMode === 'manage' ? (
            <Stack spacing={1.1}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  borderRadius: '12px',
                  border: '1px solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-card-bg)',
                  p: 1,
                }}
              >
                <Stack spacing={0.7} alignItems="center">
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Изменить аватар персонажа"
                    onClick={handleChooseCharacterAvatar}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleChooseCharacterAvatar()
                      }
                    }}
                    sx={{
                      position: 'relative',
                      width: 76,
                      height: 76,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: isSavingCharacter ? 'default' : 'pointer',
                      outline: 'none',
                      '&:hover .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                      '&:focus-visible .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                    }}
                  >
                    <CharacterAvatar
                      avatarUrl={characterAvatarDraft}
                      avatarScale={1}
                      fallbackLabel={characterNameDraft || 'Персонаж'}
                      size={76}
                    />
                    <Box
                      className="morius-character-avatar-overlay"
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
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          border: '1px solid rgba(219, 221, 231, 0.5)',
                          backgroundColor: 'rgba(17, 20, 27, 0.78)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--morius-text-primary)',
                          fontSize: '1.08rem',
                          fontWeight: 700,
                        }}
                      >
                        ✎
                      </Box>
                    </Box>
                  </Box>
                </Stack>
                <Stack spacing={0.8} sx={{ flex: 1 }}>
                  <Box
                    component="input"
                    value={characterNameDraft}
                    placeholder="Имя"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setCharacterNameDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 40,
                      borderRadius: '11px',
                      border: '1px solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.96rem',
                    }}
                  />
                  <Box
                    component="textarea"
                    value={characterDescriptionDraft}
                    placeholder="Описание персонажа"
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCharacterDescriptionDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 92,
                      resize: 'vertical',
                      borderRadius: '11px',
                      border: '1px solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      py: 0.9,
                      outline: 'none',
                      fontSize: '0.92rem',
                      lineHeight: 1.4,
                      fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                    }}
                  />
                  <Box
                    component="input"
                    value={characterTriggersDraft}
                    placeholder="Триггеры через запятую"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setCharacterTriggersDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: '11px',
                      border: '1px solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.9rem',
                    }}
                  />
                  {characterAvatarError ? <Alert severity="error">{characterAvatarError}</Alert> : null}
                  <Stack direction="row" spacing={0.7}>
                    <Button
                      variant="contained"
                      onClick={() => void handleSaveCharacter()}
                      disabled={isSavingCharacter}
                      sx={{
                        minHeight: 36,
                        borderRadius: '10px',
                        textTransform: 'none',
                        backgroundColor: 'var(--morius-card-bg)',
                        color: 'var(--morius-text-primary)',
                      }}
                    >
                      {isSavingCharacter ? (
                        <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                      ) : characterDraftMode === 'create' ? (
                        'Добавить'
                      ) : (
                        'Сохранить'
                      )}
                    </Button>
                    <Button onClick={handleStartCreateCharacter} disabled={isSavingCharacter} sx={{ textTransform: 'none' }}>
                      Очистить
                    </Button>
                  </Stack>
                </Stack>
              </Stack>

              <Box className="morius-scrollbar" sx={{ maxHeight: 280, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={0.7}>
                  {characters.map((character) => (
                    <Box
                      key={character.id}
                      sx={{
                        borderRadius: '12px',
                        border: '1px solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-card-bg)',
                        px: 0.95,
                        py: 0.75,
                      }}
                    >
                      <Stack direction="row" spacing={0.7} alignItems="flex-start">
                        <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                        <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.28}>
                          <Typography sx={{ color: '#e2e8f3', fontWeight: 700, fontSize: '0.94rem' }}>{character.name}</Typography>
                          <Typography
                            sx={{
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.84rem',
                              lineHeight: 1.36,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {character.description}
                          </Typography>
                        </Stack>
                        <IconButton
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isSavingCharacter || deletingCharacterId === character.id}
                          sx={{ width: 28, height: 28, color: 'rgba(208, 219, 235, 0.84)', flexShrink: 0 }}
                        >
                          {deletingCharacterId === character.id ? (
                            <CircularProgress size={14} sx={{ color: 'rgba(208, 219, 235, 0.84)' }} />
                          ) : (
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                          )}
                        </IconButton>
                      </Stack>
                    </Box>
                  ))}
                  {characters.length === 0 ? (
                    <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                      Персонажей пока нет. Создайте первого.
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <Stack spacing={0.8}>
              <Typography sx={{ color: 'rgba(190, 202, 220, 0.72)', fontSize: '0.9rem' }}>
                {characterDialogMode === 'select-main-hero'
                  ? 'Выберите персонажа для роли главного героя. После выбора смена будет недоступна.'
                  : 'Выберите персонажа для добавления как NPC.'}
              </Typography>
              <Box className="morius-scrollbar" sx={{ maxHeight: 360, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={0.75}>
                  {characters.map((character) => {
                    const disabledReason = getCharacterSelectionDisabledReason(character.id, characterDialogMode)
                    const isCharacterDisabled = Boolean(disabledReason)
                    return (
                      <Button
                        key={character.id}
                        onClick={() => void handleSelectCharacterForGame(character)}
                        disabled={isSelectingCharacter || isCharacterDisabled}
                        sx={{
                          borderRadius: '12px',
                          border: '1px solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-card-bg)',
                          color: '#d9dee8',
                          textTransform: 'none',
                          alignItems: 'center',
                          textAlign: 'left',
                          px: 0.9,
                          py: 0.7,
                          justifyContent: 'flex-start',
                          opacity: isCharacterDisabled ? 0.64 : 1,
                        }}
                      >
                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ width: '100%' }}>
                          <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#e2e8f3' }}>{character.name}</Typography>
                            <Typography
                              sx={{
                                color: 'rgba(207, 217, 232, 0.86)',
                                fontSize: '0.84rem',
                                lineHeight: 1.36,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {character.description}
                            </Typography>
                            {disabledReason ? (
                              <Typography sx={{ color: 'rgba(241, 189, 159, 0.9)', fontSize: '0.74rem', lineHeight: 1.25 }}>
                                {disabledReason}
                              </Typography>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Button>
                    )
                  })}
                  {characters.length === 0 ? (
                    <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                      Сначала создайте персонажей в разделе «Мои персонажи».
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.4 }}>
          <Button
            onClick={handleCloseCharacterDialog}
            disabled={isSavingCharacter || isSelectingCharacter}
            sx={{ color: 'text.secondary' }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={characterMenuAnchorEl}
        open={Boolean(characterMenuAnchorEl && selectedCharacterMenuItem)}
        onClose={handleCloseCharacterItemMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            borderRadius: '12px',
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 176,
          },
        }}
      >
        <MenuItem
          onClick={handleEditCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>✎</Box>
            <Box component="span">Редактировать</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={() => void handleDeleteCharacterFromMenu()}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>⌦</Box>
            <Box component="span">Удалить</Box>
          </Stack>
        </MenuItem>
      </Menu>

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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
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
                      color: 'var(--morius-text-primary)',
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
                  borderColor: 'var(--morius-card-border)',
                  color: 'var(--morius-text-secondary)',
                }}
              >
                {isAvatarSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Удалить'}
              </Button>
            </Stack>

            {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

            <Box
              sx={{
                borderRadius: '12px',
                border: '1px solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
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
                    border: '1px solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-button-active)',
                    color: 'var(--morius-text-primary)',
                    fontWeight: 700,
                    '&:hover': {
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  Пополнить баланс
                </Button>
              </Stack>
            </Box>

            <Button
              variant="outlined"
              onClick={() => {
                handleCloseProfileDialog()
                void handleOpenCharacterManager()
              }}
              sx={{
                minHeight: 42,
                borderColor: 'rgba(186, 202, 214, 0.38)',
                color: 'var(--morius-text-primary)',
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
        open={topUpDialogOpen}
        onClose={handleCloseTopUpDialog}
        maxWidth="md"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
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
                        border: '1px solid var(--morius-card-border)',
                        background: 'var(--morius-card-bg)',
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
                        <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--morius-text-primary)' }}>
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
                          border: '1px solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-button-active)',
                          color: 'var(--morius-text-primary)',
                          fontWeight: 700,
                          '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                        }}
                      >
                        {isBuying ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Купить'}
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
            border: '1px solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
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
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
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


