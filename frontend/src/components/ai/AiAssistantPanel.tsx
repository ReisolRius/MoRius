import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import aiIconMarkup from '../../assets/icons/ai.svg?raw'
import closeIconMarkup from '../../assets/icons/mobile-close.svg?raw'
import sendIconMarkup from '../../assets/icons/send.svg?raw'
import undoIconMarkup from '../../assets/icons/undo.svg?raw'
import type { AuthUser } from '../../types/auth'
import {
  getAiAssistantSettings,
  sendAiAssistantFeedback,
  sendAiAssistantMessage,
  undoLastAiAssistantBatch,
  type AiAssistantChatResponse,
  type AiAssistantEntityRef,
  type AiAssistantPageContext,
  type AiAssistantSettings,
  type AiAssistantUsage,
} from '../../services/aiAssistantApi'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
import { AI_ASSISTANT_ENTITIES_CHANGED_EVENT, AI_ASSISTANT_OPEN_EVENT } from './aiAssistantEvents'

type AiAssistantPanelProps = {
  user: AuthUser
  authToken: string
  path: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
}

type LocalMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  assistantMessageId?: number | null
  usage?: AiAssistantUsage | null
  isIntro?: boolean
}

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: { transcript: string; confidence?: number }
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

type SpeechRecognitionLike = EventTarget & {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
}

const micIconMarkup = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5.75 10.5a6.25 6.25 0 0 0 12.5 0M12 16.75V21M9 21h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
const stopIconMarkup = `<svg viewBox="0 0 24 24" fill="none"><path d="M8 8h8v8H8V8Z" fill="currentColor"/></svg>`
const likeIconMarkup = `<svg viewBox="0 0 24 24" fill="none"><path d="M7 10.5v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7Zm2 8.5v-8.3l3.8-6.1a1.6 1.6 0 0 1 2.95 1.1l-.45 3.1h3.1a2.1 2.1 0 0 1 2.02 2.66l-1.62 5.8A2.4 2.4 0 0 1 16.5 19H9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
const dislikeIconMarkup = `<svg viewBox="0 0 24 24" fill="none"><path d="M17 13.5v-9h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H17ZM15 5v8.3l-3.8 6.1a1.6 1.6 0 0 1-2.95-1.1l.45-3.1H5.6a2.1 2.1 0 0 1-2.02-2.66l1.62-5.8A2.4 2.4 0 0 1 7.5 5H15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
const AI_ASSISTANT_HISTORY_LIMIT = 10
const AI_ASSISTANT_STORAGE_PREFIX = 'morius:ai-assistant:chat'
const AI_ASSISTANT_INTRO_MESSAGE =
  'Привет! Я помогу собрать мир, создать или поправить карточки, настроить правила и быстро объяснить, где что находится в MORIUS.'

function createLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createIntroMessage(): LocalMessage {
  return {
    id: 'assistant-intro',
    role: 'assistant',
    content: AI_ASSISTANT_INTRO_MESSAGE,
    isIntro: true,
  }
}

function buildStorageKey(userId: number | string | undefined) {
  return `${AI_ASSISTANT_STORAGE_PREFIX}:${String(userId || 'anonymous')}`
}

function normalizeStoredMessage(value: unknown): LocalMessage | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const rawMessage = value as Partial<LocalMessage>
  const role = rawMessage.role === 'user' || rawMessage.role === 'assistant' ? rawMessage.role : null
  const content = typeof rawMessage.content === 'string' ? rawMessage.content : ''
  if (!role || !content.trim()) {
    return null
  }
  return {
    id: typeof rawMessage.id === 'string' && rawMessage.id ? rawMessage.id : createLocalId(),
    role,
    content,
    assistantMessageId: typeof rawMessage.assistantMessageId === 'number' ? rawMessage.assistantMessageId : null,
    usage: rawMessage.usage ?? null,
  }
}

function loadStoredChatState(storageKey: string): { messages: LocalMessage[]; conversationId: string | null } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as {
      messages?: unknown[]
      conversationId?: unknown
    }
    const restoredMessages = Array.isArray(parsed.messages)
      ? parsed.messages.map(normalizeStoredMessage).filter((message): message is LocalMessage => Boolean(message))
      : []
    return {
      messages: restoredMessages.slice(-AI_ASSISTANT_HISTORY_LIMIT),
      conversationId: typeof parsed.conversationId === 'string' && parsed.conversationId ? parsed.conversationId : null,
    }
  } catch {
    return { messages: [], conversationId: null }
  }
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <Box key={`bold-${match.index}`} component="strong" sx={{ fontWeight: 900, color: 'inherit' }}>
          {token.slice(2, -2)}
        </Box>,
      )
    } else {
      nodes.push(
        <Box
          key={`code-${match.index}`}
          component="code"
          sx={{
            px: 0.35,
            py: 0.08,
            borderRadius: '5px',
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: 'var(--morius-title-text)',
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize: '0.88em',
          }}
        >
          {token.slice(1, -1)}
        </Box>,
      )
    }
    lastIndex = match.index + token.length
    match = pattern.exec(text)
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

function FormattedAssistantText({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  return (
    <Typography component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.94rem', lineHeight: 1.55 }}>
      {lines.map((line, index) => (
        <Box component="span" key={`${index}-${line}`}>
          {renderInlineMarkdown(line)}
          {index < lines.length - 1 ? <br /> : null}
        </Box>
      ))}
    </Typography>
  )
}

function resolvePageContext(path: string): AiAssistantPageContext {
  const worldMatch = /^\/home\/(\d+)$/.exec(path)
  if (worldMatch) {
    return { route: path, worldId: Number.parseInt(worldMatch[1], 10), section: 'world' }
  }
  if (path === '/dashboard') {
    return { route: path, section: 'home' }
  }
  if (path === '/worlds/new' || /^\/worlds\/\d+\/edit$/.test(path)) {
    return { route: path, section: 'templates' }
  }
  if (path === '/profile') {
    return { route: path, section: 'profile' }
  }
  return { route: path, section: 'home' }
}

function resolveQuickChips(path: string): string[] {
  if (/^\/home\/\d+$/.test(path)) {
    return [
      'Добавь персонажа',
      'Отредактируй карточку',
      'Создай правило против шаблонности',
      'Проверь карточки мира',
      'Сделай NPC',
    ]
  }
  if (path === '/worlds/new' || /^\/worlds\/\d+\/edit$/.test(path)) {
    return ['Заполни описание', 'Подбери правила', 'Создай стартовый набор карточек']
  }
  if (path === '/profile') {
    return ['Создай переиспользуемого персонажа', 'Объясни, как создать персонажа в профиль', 'Создай шаблон правила']
  }
  return ['Создай мир из шаблонов', 'Помоги найти персонажа', 'Объясни, как начать игру']
}

function getSpeechRecognition(): { new (): SpeechRecognitionLike } | null {
  const runtimeWindow = window as Window & {
    SpeechRecognition?: { new (): SpeechRecognitionLike }
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike }
  }
  return runtimeWindow.SpeechRecognition ?? runtimeWindow.webkitSpeechRecognition ?? null
}

function AiAssistantMessageList({
  messages,
  conversationId,
  authToken,
}: {
  messages: LocalMessage[]
  conversationId: string | null
  authToken: string
}) {
  if (messages.length === 0) {
    return (
      <Box
        sx={{
          minHeight: 220,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          px: 2,
          color: 'var(--morius-text-secondary)',
        }}
      >
        <Stack spacing={1} alignItems="center">
          <Box
            sx={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--morius-accent)',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)',
              boxShadow: '0 18px 34px -24px rgba(0, 0, 0, 0.78)',
            }}
          >
            <ThemedSvgIcon markup={aiIconMarkup} size={28} />
          </Box>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>
            {AI_ASSISTANT_INTRO_MESSAGE}
          </Typography>
        </Stack>
      </Box>
    )
  }

  return (
    <Stack spacing={1.05}>
      {messages.map((message) => {
        const isUser = message.role === 'user'
        return (
          <Box
            key={message.id}
            sx={{
              display: 'flex',
              justifyContent: isUser ? 'flex-end' : 'flex-start',
            }}
          >
            <Box
              sx={{
                maxWidth: '86%',
                borderRadius: isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: isUser
                  ? 'color-mix(in srgb, var(--morius-accent) 17%, #0b1017 83%)'
                  : 'color-mix(in srgb, var(--morius-elevated-bg) 62%, #05070b 38%)',
                px: 1.25,
                py: 1,
                color: 'var(--morius-text-primary)',
                boxShadow: '0 14px 34px rgba(0, 0, 0, 0.32)',
              }}
            >
              {message.pending ? (
                <Stack direction="row" spacing={0.8} alignItems="center">
                  <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} />
                  <Typography sx={{ fontSize: '0.9rem', color: 'var(--morius-text-secondary)' }}>Думаю...</Typography>
                </Stack>
              ) : (
                <FormattedAssistantText content={message.content} />
              )}
              {!isUser && !message.pending && conversationId ? (
                <Stack direction="row" spacing={0.4} justifyContent="flex-end" sx={{ mt: 0.75 }}>
                  <Tooltip title="Полезно">
                    <IconButton
                      size="small"
                      aria-label="Оценить ответ положительно"
                      onClick={() => void sendAiAssistantFeedback({ token: authToken, conversationId, messageId: message.assistantMessageId, rating: 'like' })}
                      sx={{ width: 28, height: 28, color: 'var(--morius-text-secondary)' }}
                    >
                      <ThemedSvgIcon markup={likeIconMarkup} size={15} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Не помогло">
                    <IconButton
                      size="small"
                      aria-label="Оценить ответ отрицательно"
                      onClick={() => void sendAiAssistantFeedback({ token: authToken, conversationId, messageId: message.assistantMessageId, rating: 'dislike' })}
                      sx={{ width: 28, height: 28, color: 'var(--morius-text-secondary)' }}
                    >
                      <ThemedSvgIcon markup={dislikeIconMarkup} size={15} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
            </Box>
          </Box>
        )
      })}
    </Stack>
  )
}

function AiVoiceInputButton({
  disabled,
  listening,
  onTranscript,
  onListeningChange,
}: {
  disabled?: boolean
  listening: boolean
  onTranscript: (value: string) => void
  onListeningChange: (value: boolean) => void
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [isUnsupported, setIsUnsupported] = useState(() => !getSpeechRecognition())

  const toggleListening = () => {
    if (disabled) {
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      onListeningChange(false)
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setIsUnsupported(true)
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'ru-RU'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.onstart = () => onListeningChange(true)
    recognition.onend = () => onListeningChange(false)
    recognition.onerror = () => onListeningChange(false)
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript
      }
      onTranscript(transcript.trim())
    }
    recognitionRef.current = recognition
    recognition.start()
  }

  return (
    <Tooltip title={isUnsupported ? 'Голосовой ввод недоступен в этом браузере, используйте текст' : listening ? 'Остановить запись' : 'Голосовой ввод'}>
      <span>
        <IconButton
          type="button"
          disabled={disabled || isUnsupported}
          aria-label={listening ? 'Остановить голосовой ввод' : 'Начать голосовой ввод'}
          onClick={toggleListening}
          sx={{
            width: 50,
            height: 50,
            borderRadius: '14px',
            border: 'none',
            color: listening ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
            backgroundColor: listening ? 'color-mix(in srgb, var(--morius-accent) 22%, var(--morius-card-bg))' : 'var(--morius-elevated-bg)',
            '&:hover': {
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-elevated-bg))',
            },
          }}
        >
          <ThemedSvgIcon markup={listening ? stopIconMarkup : micIconMarkup} size={20} />
        </IconButton>
      </span>
    </Tooltip>
  )
}

function AiAssistantInput({
  value,
  pending,
  disabled,
  listening,
  onChange,
  onSubmit,
  onStop,
  onTranscript,
  onListeningChange,
}: {
  value: string
  pending: boolean
  disabled: boolean
  listening: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  onTranscript: (value: string) => void
  onListeningChange: (value: boolean) => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    event.preventDefault()
    onSubmit()
  }

  return (
    <Stack spacing={0.85}>
      {listening ? (
        <Stack direction="row" spacing={0.8} alignItems="center" aria-live="polite" sx={{ color: 'var(--morius-accent)' }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: 'var(--morius-accent)',
              animation: 'morius-ai-orb-pulse 1.2s ease-in-out infinite',
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
              },
            }}
          />
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 800 }}>Слушаю...</Typography>
        </Stack>
      ) : null}
      <Stack direction="row" spacing={0.75} alignItems="center">
        <AiVoiceInputButton
          disabled={pending || disabled}
          listening={listening}
          onTranscript={onTranscript}
          onListeningChange={onListeningChange}
        />
        <TextField
          fullWidth
          multiline
          minRows={1}
          maxRows={5}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите задачу для помощника"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '16px',
              minHeight: 50,
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              alignItems: 'center',
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--morius-card-border)',
            },
            '& textarea': {
              fontSize: '0.94rem',
              lineHeight: 1.45,
            },
          }}
        />
        <Tooltip title={pending ? 'Остановить' : 'Отправить'}>
          <IconButton
            type="button"
            aria-label={pending ? 'Остановить ответ' : 'Отправить сообщение'}
            onClick={pending ? onStop : onSubmit}
            disabled={!pending && (disabled || !value.trim())}
            sx={{
              width: 50,
              height: 50,
              borderRadius: '14px',
              border: 'none',
              color: 'var(--morius-title-text)',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 22%, var(--morius-card-bg))',
              '&:hover': {
                backgroundColor: 'color-mix(in srgb, var(--morius-accent) 30%, var(--morius-card-bg))',
              },
              '&.Mui-disabled': {
                color: 'var(--morius-text-secondary)',
                backgroundColor: 'var(--morius-elevated-bg)',
              },
            }}
          >
            <ThemedSvgIcon markup={pending ? stopIconMarkup : sendIconMarkup} size={19} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  )
}

function AiAssistantJobToast({
  steps,
  createdEntities,
  redirectUrl,
  onOpenUrl,
}: {
  steps: Array<Record<string, unknown>>
  createdEntities: AiAssistantEntityRef[]
  redirectUrl?: string | null
  onOpenUrl: (url: string) => void
}) {
  const [dismissedSignature, setDismissedSignature] = useState('')
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const hasRunningStep = steps.some((step) => step.status === 'running')
  const hasToastContent = steps.length > 0 || createdEntities.length > 0
  const toastSignature = useMemo(
    () => JSON.stringify({
      steps: steps.map((step) => [step.label, step.status]),
      entities: createdEntities.map((entity) => [entity.type, entity.id]),
      redirectUrl: redirectUrl || '',
    }),
    [createdEntities, redirectUrl, steps],
  )
  const visible = hasToastContent && dismissedSignature !== toastSignature

  useEffect(() => {
    if (!hasToastContent || hasRunningStep) {
      return
    }
    const timeoutId = window.setTimeout(() => setDismissedSignature(toastSignature), 10_000)
    return () => window.clearTimeout(timeoutId)
  }, [hasRunningStep, hasToastContent, toastSignature])

  if (steps.length === 0 && createdEntities.length === 0) {
    return null
  }
  if (!visible) {
    return null
  }
  const visibleSteps = steps.slice(-5)
  return (
    <Box
      aria-live="polite"
      onPointerDown={(event) => {
        pointerStartRef.current = { x: event.clientX, y: event.clientY }
        setIsDragging(true)
      }}
      onPointerMove={(event) => {
        if (!pointerStartRef.current) {
          return
        }
        setDragOffset({
          x: event.clientX - pointerStartRef.current.x,
          y: event.clientY - pointerStartRef.current.y,
        })
      }}
      onPointerUp={() => {
        if (Math.abs(dragOffset.x) > 80 || Math.abs(dragOffset.y) > 70) {
          setDismissedSignature(toastSignature)
        }
        pointerStartRef.current = null
        setIsDragging(false)
        setDragOffset({ x: 0, y: 0 })
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null
        setIsDragging(false)
        setDragOffset({ x: 0, y: 0 })
      }}
      sx={{
        position: 'fixed',
        right: { xs: 12, md: 28 },
        bottom: { xs: 'calc(148px + env(safe-area-inset-bottom))', md: 104 },
        zIndex: 1301,
        width: { xs: 'calc(100vw - 24px)', sm: 360 },
        borderRadius: '18px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, rgba(4, 8, 12, 0.92) 18%)',
        backdropFilter: 'blur(18px)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
        p: 1.1,
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        opacity: Math.max(0.45, 1 - (Math.abs(dragOffset.x) + Math.abs(dragOffset.y)) / 260),
        transition: isDragging ? 'none' : 'opacity 180ms ease, transform 180ms ease',
        touchAction: 'none',
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.94rem', fontWeight: 900 }}>
            AI-помощник
          </Typography>
          <IconButton
            type="button"
            aria-label="Скрыть статус AI-помощника"
            onClick={() => setDismissedSignature(toastSignature)}
            sx={{ width: 28, height: 28, color: 'var(--morius-text-secondary)' }}
          >
            <ThemedSvgIcon markup={closeIconMarkup} size={16} />
          </IconButton>
        </Stack>
        {visibleSteps.map((step, index) => (
          <Stack key={`${String(step.label)}-${index}`} direction="row" spacing={0.75} alignItems="center">
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: step.status === 'error' ? '#ff6b6b' : step.status === 'running' ? 'var(--morius-accent)' : '#6ee7b7',
                flexShrink: 0,
              }}
            />
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', overflowWrap: 'anywhere' }}>
              {String(step.label || 'Выполняю шаг')}
            </Typography>
          </Stack>
        ))}
        {redirectUrl ? (
          <Button
            onClick={() => onOpenUrl(redirectUrl)}
            sx={{
              minHeight: 36,
              borderRadius: '12px',
              textTransform: 'none',
              color: 'var(--morius-title-text)',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg))',
            }}
          >
            {redirectUrl.startsWith('/profile') ? 'Открыть профиль' : 'Открыть мир'}
          </Button>
        ) : null}
      </Stack>
    </Box>
  )
}

function AiAssistantPanel({ user, authToken, path, onNavigate, onUserUpdate }: AiAssistantPanelProps) {
  const assistantStorageKey = useMemo(() => buildStorageKey(user.id), [user.id])
  const initialChatState = useMemo(() => loadStoredChatState(assistantStorageKey), [assistantStorageKey])
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>(() => initialChatState.messages.length > 0 ? initialChatState.messages : [createIntroMessage()])
  const [conversationId, setConversationId] = useState<string | null>(() => initialChatState.conversationId)
  const [pending, setPending] = useState(false)
  const [listening, setListening] = useState(false)
  const [steps, setSteps] = useState<Array<Record<string, unknown>>>([])
  const [createdEntities, setCreatedEntities] = useState<AiAssistantEntityRef[]>([])
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [assistantSettings, setAssistantSettings] = useState<AiAssistantSettings | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messageScrollRef = useRef<HTMLDivElement | null>(null)
  const isMobile = useMediaQuery('(max-width:899.95px)')
  const quickChips = useMemo(() => resolveQuickChips(path), [path])
  const topActionIconColor = 'color-mix(in srgb, var(--morius-text-secondary) 68%, transparent)'
  const availabilityMessage = useMemo(() => {
    if (settingsLoading) {
      return 'Проверяю доступность AI-помощника...'
    }
    if (settingsError) {
      return settingsError
    }
    if (!assistantSettings) {
      return ''
    }
    if (!assistantSettings.enabled) {
      return 'AI-помощник выключен на backend. Добавьте AI_ASSISTANT_ENABLED=true в backend/.env и перезапустите backend.'
    }
    if (!assistantSettings.configured) {
      return 'AI-помощнику нужен OpenRouter API key в POLZA_API_KEY в backend/.env.'
    }
    if (!assistantSettings.visible) {
      return 'Показ AI-помощника выключен в настройках профиля.'
    }
    return ''
  }, [assistantSettings, settingsError, settingsLoading])
  const assistantReady = Boolean(assistantSettings?.enabled && assistantSettings.configured && assistantSettings.visible && !settingsError)

  useEffect(() => {
    const restored = loadStoredChatState(assistantStorageKey)
    setMessages(restored.messages.length > 0 ? restored.messages : [createIntroMessage()])
    setConversationId(restored.conversationId)
  }, [assistantStorageKey])

  useEffect(() => {
    const persistedMessages = messages.filter((message) => !message.pending && !message.isIntro).slice(-AI_ASSISTANT_HISTORY_LIMIT)
    try {
      window.localStorage.setItem(
        assistantStorageKey,
        JSON.stringify({
          conversationId,
          messages: persistedMessages,
        }),
      )
    } catch {
      // Chat history is a convenience; ignore storage failures.
    }
  }, [assistantStorageKey, conversationId, messages])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener(AI_ASSISTANT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(AI_ASSISTANT_OPEN_EVENT, handleOpen)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      const element = messageScrollRef.current
      if (element) {
        element.scrollTop = element.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [availabilityMessage, messages, open, pending])

  useEffect(() => {
    if (!open || !authToken) {
      return
    }
    let active = true
    setSettingsLoading(true)
    setSettingsError('')
    void getAiAssistantSettings({ token: authToken })
      .then((settings) => {
        if (!active) {
          return
        }
        setAssistantSettings(settings)
      })
      .catch((requestError) => {
        if (!active) {
          return
        }
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось проверить настройки AI-помощника.'
        setSettingsError(detail)
      })
      .finally(() => {
        if (active) {
          setSettingsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [authToken, open])

  const handleStop = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setPending(false)
    setMessages((previous) => previous.filter((message) => !message.pending))
  }

  const applyResponse = (response: AiAssistantChatResponse) => {
    setConversationId(response.conversationId)
    setSteps(response.steps ?? [])
    setCreatedEntities([...(response.createdEntities ?? []), ...(response.updatedEntities ?? []), ...(response.deletedEntities ?? [])])
    setRedirectUrl(response.redirectUrl ?? null)
    setMessages((previous) => [
      ...previous.filter((message) => !message.pending),
      {
        id: createLocalId(),
        role: 'assistant',
        content: response.message,
        assistantMessageId: response.assistantMessageId ?? null,
        usage: response.usage,
      },
    ])
    if (response.user && typeof response.user.coins === 'number') {
      onUserUpdate({ ...user, coins: response.user.coins })
    }
    if (
      (response.createdEntities?.length ?? 0) > 0
      || (response.updatedEntities?.length ?? 0) > 0
      || (response.deletedEntities?.length ?? 0) > 0
      || response.redirectUrl
    ) {
      window.dispatchEvent(new CustomEvent(AI_ASSISTANT_ENTITIES_CHANGED_EVENT, { detail: response }))
    }
  }

  const handleSubmit = async (messageOverride?: string) => {
    const messageText = (messageOverride ?? inputValue).trim()
    if (!messageText || pending) {
      return
    }
    if (!assistantReady) {
      setError(availabilityMessage || 'AI-помощник сейчас недоступен.')
      return
    }
    setError('')
    setPending(true)
    setInputValue('')
    setSteps([{ label: 'Понимаю запрос', status: 'running' }])
    const controller = new AbortController()
    abortControllerRef.current = controller
    setMessages((previous) => [
      ...previous,
      { id: createLocalId(), role: 'user', content: messageText },
      { id: createLocalId(), role: 'assistant', content: '', pending: true },
    ])
    try {
      const response = await sendAiAssistantMessage({
        token: authToken,
        message: messageText,
        conversationId,
        pageContext: resolvePageContext(path),
        usedVoiceInput: listening,
        signal: controller.signal,
      })
      applyResponse(response)
    } catch (requestError) {
      if (controller.signal.aborted) {
        return
      }
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось выполнить запрос'
      setError(detail)
      setMessages((previous) => previous.filter((message) => !message.pending))
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
      setPending(false)
      setListening(false)
    }
  }

  const handleUndo = async () => {
    if (!conversationId || pending) {
      return
    }
    setError('')
    try {
      const response = await undoLastAiAssistantBatch({ token: authToken, conversationId })
      setMessages((previous) => [
        ...previous,
        {
          id: createLocalId(),
          role: 'assistant',
          content: response.message,
        },
      ])
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось откатить действие'
      setError(detail)
    }
  }

  const handleOpenUrl = (url: string) => {
    if (!url) {
      return
    }
    setOpen(false)
    onNavigate(url)
  }

  return (
    <>
      <Drawer
        anchor={isMobile ? 'bottom' : 'right'}
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width: isMobile ? '100%' : 440,
            maxWidth: '100vw',
            height: isMobile ? 'calc(100dvh - 12px)' : '100dvh',
            borderTopLeftRadius: isMobile ? '22px' : 0,
            borderTopRightRadius: isMobile ? '22px' : 0,
            borderLeft: isMobile ? 'none' : 'var(--morius-border-width) solid var(--morius-card-border)',
            borderTop: isMobile ? 'var(--morius-border-width) solid var(--morius-card-border)' : 'none',
            backgroundColor: '#07090e',
            color: 'var(--morius-text-primary)',
            backdropFilter: 'blur(18px)',
            overflow: 'hidden',
          },
        }}
      >
        <Box
          sx={{
            height: '100%',
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{
              px: 1.35,
              py: 1.15,
              borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 38%, #34383e 62%)',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--morius-accent)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)',
                  boxShadow: '0 16px 30px -22px rgba(0, 0, 0, 0.78)',
                }}
              >
                <ThemedSvgIcon markup={aiIconMarkup} size={23} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontWeight: 900, fontSize: '1rem' }}>
                  AI-помощник
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem' }}>
                  Инструменты MORIUS
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.4}>
              <Tooltip title="Откатить последнюю batch-операцию">
                <span>
                  <IconButton
                    type="button"
                    disabled={!conversationId || pending}
                    aria-label="Откатить последнюю операцию помощника"
                    onClick={() => void handleUndo()}
                    sx={{
                      color: topActionIconColor,
                      backgroundColor: 'transparent',
                      border: 'none',
                      '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
                      '&.Mui-disabled': { color: topActionIconColor },
                    }}
                  >
                    <ThemedSvgIcon markup={undoIconMarkup} size={20} />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                type="button"
                aria-label="Закрыть AI-помощника"
                onClick={() => setOpen(false)}
                sx={{
                  color: topActionIconColor,
                  backgroundColor: 'transparent',
                  border: 'none',
                  '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
                }}
              >
                <ThemedSvgIcon markup={closeIconMarkup} size={20} />
              </IconButton>
            </Stack>
          </Stack>

          <Box
            ref={messageScrollRef}
            className="morius-scrollbar"
            sx={{
              minHeight: 0,
              overflowY: 'auto',
              px: 1.25,
              py: 1.2,
              backgroundColor: '#05070b',
              backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.025), transparent 120px)',
            }}
          >
            {availabilityMessage ? (
              <Box
                sx={{
                  mb: 1,
                  borderRadius: '14px',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, #ffb86b 38%, var(--morius-card-border))',
                  backgroundColor: 'color-mix(in srgb, #ffb86b 12%, var(--morius-card-bg))',
                  color: 'var(--morius-title-text)',
                  px: 1.2,
                  py: 0.95,
                  fontSize: '0.86rem',
                  lineHeight: 1.45,
                }}
              >
                {availabilityMessage}
              </Box>
            ) : null}
            <AiAssistantMessageList messages={messages} conversationId={conversationId} authToken={authToken} />
          </Box>

          <Box
            sx={{
              px: 1.25,
              pt: 1,
              pb: 'calc(12px + env(safe-area-inset-bottom))',
              borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 52%, #05070b 48%)',
            }}
          >
            {error ? (
              <Box sx={{ mb: 0.8, borderRadius: '12px', color: '#ffb4b4', fontSize: '0.84rem' }}>
                {error}
              </Box>
            ) : null}
            <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mb: 0.85 }}>
              {quickChips.map((chip) => (
                <Chip
                  key={chip}
                  label={chip}
                  onClick={() => void handleSubmit(chip)}
                  disabled={pending || !assistantReady}
                  sx={{
                    height: 30,
                    borderRadius: '999px',
                    color: 'var(--morius-text-primary)',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    '& .MuiChip-label': {
                      px: 1.1,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                    },
                  }}
                />
              ))}
            </Stack>
            <AiAssistantInput
              value={inputValue}
              pending={pending}
              disabled={!assistantReady}
              listening={listening}
              onChange={setInputValue}
              onSubmit={() => void handleSubmit()}
              onStop={handleStop}
              onTranscript={(transcript) => setInputValue(transcript)}
              onListeningChange={setListening}
            />
          </Box>
        </Box>
      </Drawer>
      <AiAssistantJobToast steps={steps} createdEntities={createdEntities} redirectUrl={redirectUrl} onOpenUrl={handleOpenUrl} />
    </>
  )
}

export default AiAssistantPanel
