import { API_BASE_URL } from '../config/env'
import type {
  StoryCharacter,
  StoryCommunityWorldPayload,
  StoryCommunityWorldSummary,
  StoryGamePayload,
  StoryGameSummary,
  StoryGameVisibility,
  StoryInstructionCard,
  StoryMessage,
  StoryPlotCard,
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

export type StoryCharacterInput = {
  name: string
  description: string
  triggers: string[]
  avatar_url: string | null
  avatar_scale?: number
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

export async function listCommunityWorlds(token: string): Promise<StoryCommunityWorldSummary[]> {
  return request<StoryCommunityWorldSummary[]>('/api/story/community/worlds', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function getCommunityWorld(payload: {
  token: string
  worldId: number
}): Promise<StoryCommunityWorldPayload> {
  return request<StoryCommunityWorldPayload>(`/api/story/community/worlds/${payload.worldId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function launchCommunityWorld(payload: {
  token: string
  worldId: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/community/worlds/${payload.worldId}/launch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function rateCommunityWorld(payload: {
  token: string
  worldId: number
  rating: number
}): Promise<StoryCommunityWorldSummary> {
  return request<StoryCommunityWorldSummary>(`/api/story/community/worlds/${payload.worldId}/rating`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      rating: payload.rating,
    }),
  })
}

export async function listStoryCharacters(token: string): Promise<StoryCharacter[]> {
  return request<StoryCharacter[]>('/api/story/characters', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function createStoryCharacter(payload: {
  token: string
  input: StoryCharacterInput
}): Promise<StoryCharacter> {
  return request<StoryCharacter>('/api/story/characters', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(payload.input),
  })
}

export async function updateStoryCharacter(payload: {
  token: string
  characterId: number
  input: StoryCharacterInput
}): Promise<StoryCharacter> {
  return request<StoryCharacter>(`/api/story/characters/${payload.characterId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(payload.input),
  })
}

export async function deleteStoryCharacter(payload: {
  token: string
  characterId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/characters/${payload.characterId}`, {
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

export async function createStoryGame(payload: {
  token: string
  title?: string
  description?: string
  visibility?: StoryGameVisibility
  cover_image_url?: string | null
  cover_scale?: number
  cover_position_x?: number
  cover_position_y?: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>('/api/story/games', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title ?? null,
      description: payload.description ?? null,
      visibility: payload.visibility ?? null,
      cover_image_url: payload.cover_image_url ?? null,
      cover_scale: payload.cover_scale ?? null,
      cover_position_x: payload.cover_position_x ?? null,
      cover_position_y: payload.cover_position_y ?? null,
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
  contextLimitTokens: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      context_limit_chars: payload.contextLimitTokens,
    }),
  })
}

export async function updateStoryGameMeta(payload: {
  token: string
  gameId: number
  title?: string
  description?: string
  visibility?: StoryGameVisibility
  cover_image_url?: string | null
  cover_scale?: number
  cover_position_x?: number
  cover_position_y?: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/meta`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title ?? null,
      description: payload.description ?? null,
      visibility: payload.visibility ?? null,
      cover_image_url: payload.cover_image_url ?? null,
      cover_scale: payload.cover_scale ?? null,
      cover_position_x: payload.cover_position_x ?? null,
      cover_position_y: payload.cover_position_y ?? null,
    }),
  })
}

export async function deleteStoryGame(payload: {
  token: string
  gameId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}`, {
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

export async function listStoryPlotCards(payload: {
  token: string
  gameId: number
}): Promise<StoryPlotCard[]> {
  return request<StoryPlotCard[]>(`/api/story/games/${payload.gameId}/plot-cards`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createStoryPlotCard(payload: {
  token: string
  gameId: number
  title: string
  content: string
}): Promise<StoryPlotCard> {
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards`, {
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

export async function updateStoryPlotCard(payload: {
  token: string
  gameId: number
  cardId: number
  title: string
  content: string
}): Promise<StoryPlotCard> {
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}`, {
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

export async function deleteStoryPlotCard(payload: {
  token: string
  gameId: number
  cardId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}`, {
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
  kind?: 'world' | 'npc' | 'main_hero'
  avatar_url?: string | null
  avatar_scale?: number
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
      kind: payload.kind ?? 'world',
      avatar_url: payload.avatar_url ?? null,
      avatar_scale: payload.avatar_scale ?? null,
    }),
  })
}

export async function selectStoryMainHero(payload: {
  token: string
  gameId: number
  characterId: number
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/main-hero`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      character_id: payload.characterId,
    }),
  })
}

export async function createStoryNpcFromCharacter(payload: {
  token: string
  gameId: number
  characterId: number
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/npc-from-character`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      character_id: payload.characterId,
    }),
  })
}

export async function updateStoryWorldCardAvatar(payload: {
  token: string
  gameId: number
  cardId: number
  avatar_url: string | null
  avatar_scale?: number
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}/avatar`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      avatar_url: payload.avatar_url,
      avatar_scale: payload.avatar_scale ?? null,
    }),
  })
}

export async function updateStoryWorldCardAiEdit(payload: {
  token: string
  gameId: number
  cardId: number
  ai_edit_enabled: boolean
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}/ai-edit`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      ai_edit_enabled: payload.ai_edit_enabled,
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

export async function undoStoryPlotCardEvent(payload: {
  token: string
  gameId: number
  eventId: number
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/story/games/${payload.gameId}/plot-card-events/${payload.eventId}/undo`, {
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
