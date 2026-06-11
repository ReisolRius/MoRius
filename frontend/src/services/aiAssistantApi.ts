import type { AuthUser } from '../types/auth'
import { buildApiUrl, parseApiError, requestJson } from './httpClient'

export type AiAssistantPageContext = {
  route: string
  worldId?: string | number | null
  section?: string
  selectedEntityId?: string | number | null
}

export type AiAssistantSettings = {
  enabled: boolean
  configured: boolean
  visible: boolean
  model: string
  minSols: number
}

export type AiAssistantChatMessage = {
  id: number
  role: string
  content: string
  toolName?: string | null
  createdAt: string
  metadata?: Record<string, unknown>
}

export type AiAssistantConversation = {
  id: string
  title: string
  messages: AiAssistantChatMessage[]
}

export type AiAssistantEntityRef = {
  type: string
  id: number
  title: string
  url?: string | null
}

export type AiAssistantUsage = {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costRub: number
  chargedSols: number
  warning?: string | null
}

export type AiAssistantChatResponse = {
  conversationId: string
  assistantMessageId?: number | null
  message: string
  steps: Array<Record<string, unknown>>
  createdEntities: AiAssistantEntityRef[]
  updatedEntities: AiAssistantEntityRef[]
  deletedEntities?: AiAssistantEntityRef[]
  redirectUrl?: string | null
  chargedSols: number
  usage: AiAssistantUsage
  user?: Pick<AuthUser, 'id' | 'coins'>
}

export type AiAssistantUndoResponse = {
  ok: boolean
  batchId?: string | null
  revertedEntities: AiAssistantEntityRef[]
  message: string
}

const AI_ASSISTANT_NETWORK_ERROR =
  'Не удалось подключиться к AI-помощнику. Проверьте, что backend запущен и функция включена.'

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getAiAssistantSettings(payload: { token: string }): Promise<AiAssistantSettings> {
  return requestJson<AiAssistantSettings>(
    '/api/admin/ai-assistant/settings',
    {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders(payload.token),
    },
    AI_ASSISTANT_NETWORK_ERROR,
  )
}

export async function updateAiAssistantSettings(payload: {
  token: string
  visible: boolean
}): Promise<AiAssistantSettings> {
  return requestJson<AiAssistantSettings>(
    '/api/admin/ai-assistant/settings',
    {
      method: 'PATCH',
      headers: authHeaders(payload.token),
      body: JSON.stringify({ visible: payload.visible }),
    },
    AI_ASSISTANT_NETWORK_ERROR,
  )
}

export async function sendAiAssistantMessage(payload: {
  token: string
  message: string
  conversationId?: string | null
  pageContext?: AiAssistantPageContext
  usedVoiceInput?: boolean
  signal?: AbortSignal
}): Promise<AiAssistantChatResponse> {
  const response = await fetch(buildApiUrl('/api/admin/ai-assistant/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(payload.token),
    },
    body: JSON.stringify({
      message: payload.message,
      conversationId: payload.conversationId || undefined,
      pageContext: payload.pageContext,
      voiceMeta: payload.usedVoiceInput ? { usedVoiceInput: true, language: 'ru-RU' } : undefined,
    }),
    signal: payload.signal,
  })
  if (!response.ok) {
    throw await parseApiError(response, 'AI assistant request failed')
  }
  return (await response.json()) as AiAssistantChatResponse
}

export async function getAiAssistantConversation(payload: {
  token: string
  conversationId: string
}): Promise<AiAssistantConversation> {
  return requestJson<AiAssistantConversation>(
    `/api/admin/ai-assistant/conversations/${payload.conversationId}`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders(payload.token),
    },
    AI_ASSISTANT_NETWORK_ERROR,
  )
}

export async function sendAiAssistantFeedback(payload: {
  token: string
  conversationId: string
  messageId?: number | null
  rating: 'like' | 'dislike' | 'error'
  comment?: string
}): Promise<void> {
  await requestJson<{ ok: boolean }>(
    '/api/admin/ai-assistant/feedback',
    {
      method: 'POST',
      headers: authHeaders(payload.token),
      body: JSON.stringify({
        conversationId: payload.conversationId,
        messageId: payload.messageId ?? undefined,
        rating: payload.rating,
        comment: payload.comment,
      }),
    },
    AI_ASSISTANT_NETWORK_ERROR,
  )
}

export async function undoLastAiAssistantBatch(payload: {
  token: string
  conversationId?: string | null
  batchId?: string | null
}): Promise<AiAssistantUndoResponse> {
  return requestJson<AiAssistantUndoResponse>(
    '/api/admin/ai-assistant/undo',
    {
      method: 'POST',
      headers: authHeaders(payload.token),
      body: JSON.stringify({
        conversationId: payload.conversationId || undefined,
        batchId: payload.batchId || undefined,
      }),
    },
    AI_ASSISTANT_NETWORK_ERROR,
  )
}
