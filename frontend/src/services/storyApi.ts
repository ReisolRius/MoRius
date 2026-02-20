import { API_BASE_URL } from '../config/env'
import type {
  StoryGamePayload,
  StoryGameSummary,
  StoryInstructionCard,
  StoryMessage,
  StoryStreamChunkPayload,
  StoryStreamDonePayload,
  StoryStreamStartPayload,
  StoryWorldCard,
} from '../types/story'

type RequestOptions = RequestInit & {
  skipJsonContentType?: boolean
}

type StreamEvent = {
  event: string
  data: string
}

export type StoryGenerationStreamOptions = {
  token: string
  gameId: number
  prompt?: string
  rerollLastResponse?: boolean
  instructions?: StoryInstructionCardInput[]
  signal?: AbortSignal
  onStart?: (payload: StoryStreamStartPayload) => void
  onChunk?: (payload: StoryStreamChunkPayload) => void
  onDone?: (payload: StoryStreamDonePayload) => void
}

export type StoryInstructionCardInput = {
  title: string
  content: string
}

export type StoryWorldCardInput = {
  title: string
  content: string
  triggers: string[]
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  if (!options.skipJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
  } catch {
    throw new Error(`Не удалось подключиться к API (${API_BASE_URL}).`)
  }

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = (await response.json()) as { detail?: string }
      detail = payload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}

function parseSseBlock(rawBlock: string): StreamEvent | null {
  const lines = rawBlock.split('\n')
  let event = ''
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }

  if (!event || dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join('\n'),
  }
}

export async function listStoryGames(token: string): Promise<StoryGameSummary[]> {
  return request<StoryGameSummary[]>('/api/story/games', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function createStoryGame(payload: {
  token: string
  title?: string
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>('/api/story/games', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title ?? null,
    }),
  })
}

export async function getStoryGame(payload: {
  token: string
  gameId: number
}): Promise<StoryGamePayload> {
  return request<StoryGamePayload>(`/api/story/games/${payload.gameId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function updateStoryGameSettings(payload: {
  token: string
  gameId: number
  contextLimitChars: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      context_limit_chars: payload.contextLimitChars,
    }),
  })
}

export async function updateStoryMessage(payload: {
  token: string
  gameId: number
  messageId: number
  content: string
}): Promise<StoryMessage> {
  return request<StoryMessage>(`/api/story/games/${payload.gameId}/messages/${payload.messageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({ content: payload.content }),
  })
}

export async function generateStoryResponseStream(options: StoryGenerationStreamOptions): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${options.gameId}/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: options.prompt,
      reroll_last_response: Boolean(options.rerollLastResponse),
      instructions: options.instructions ?? [],
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const payload = (await response.json()) as { detail?: string }
      detail = payload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }

  if (!response.body) {
    throw new Error('Streaming is not supported by this response')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamError: Error | null = null

  const processBlock = (rawBlock: string) => {
    const parsed = parseSseBlock(rawBlock)
    if (!parsed) {
      return
    }

    try {
      if (parsed.event === 'start') {
        const payload = JSON.parse(parsed.data) as StoryStreamStartPayload
        options.onStart?.(payload)
        return
      }
      if (parsed.event === 'chunk') {
        const payload = JSON.parse(parsed.data) as StoryStreamChunkPayload
        options.onChunk?.(payload)
        return
      }
      if (parsed.event === 'done') {
        const payload = JSON.parse(parsed.data) as StoryStreamDonePayload
        options.onDone?.(payload)
        return
      }
      if (parsed.event === 'error') {
        const payload = JSON.parse(parsed.data) as { detail?: string }
        streamError = new Error(payload.detail || 'Text generation failed')
      }
    } catch {
      // Ignore malformed stream payloads.
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      processBlock(rawBlock)
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    processBlock(buffer)
  }

  if (streamError) {
    throw streamError
  }
}

export async function listStoryInstructionCards(payload: {
  token: string
  gameId: number
}): Promise<StoryInstructionCard[]> {
  return request<StoryInstructionCard[]>(`/api/story/games/${payload.gameId}/instructions`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createStoryInstructionCard(payload: {
  token: string
  gameId: number
  title: string
  content: string
}): Promise<StoryInstructionCard> {
  return request<StoryInstructionCard>(`/api/story/games/${payload.gameId}/instructions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
    }),
  })
}

export async function updateStoryInstructionCard(payload: {
  token: string
  gameId: number
  instructionId: number
  title: string
  content: string
}): Promise<StoryInstructionCard> {
  return request<StoryInstructionCard>(`/api/story/games/${payload.gameId}/instructions/${payload.instructionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
    }),
  })
}

export async function deleteStoryInstructionCard(payload: {
  token: string
  gameId: number
  instructionId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}/instructions/${payload.instructionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const errorPayload = (await response.json()) as { detail?: string }
      detail = errorPayload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }
}

export async function listStoryWorldCards(payload: {
  token: string
  gameId: number
}): Promise<StoryWorldCard[]> {
  return request<StoryWorldCard[]>(`/api/story/games/${payload.gameId}/world-cards`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createStoryWorldCard(payload: {
  token: string
  gameId: number
  title: string
  content: string
  triggers: string[]
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      triggers: payload.triggers,
    }),
  })
}

export async function updateStoryWorldCard(payload: {
  token: string
  gameId: number
  cardId: number
  title: string
  content: string
  triggers: string[]
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      triggers: payload.triggers,
    }),
  })
}

export async function deleteStoryWorldCard(payload: {
  token: string
  gameId: number
  cardId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}/world-cards/${payload.cardId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const errorPayload = (await response.json()) as { detail?: string }
      detail = errorPayload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }
}

export async function undoStoryWorldCardEvent(payload: {
  token: string
  gameId: number
  eventId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}/world-card-events/${payload.eventId}/undo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })

  if (!response.ok) {
    let detail = 'Request failed'
    try {
      const errorPayload = (await response.json()) as { detail?: string }
      detail = errorPayload.detail || detail
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail)
  }
}
