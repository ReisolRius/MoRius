import type {
  StoryCharacter,
  StoryCommunityWorldPayload,
  StoryCommunityWorldSummary,
  StoryGamePayload,
  StoryGameSummary,
  StoryGameVisibility,
  StoryImageModelId,
  StoryNarratorModelId,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryMessage,
  StoryPlotCard,
  StoryStreamChunkPayload,
  StoryStreamDonePayload,
  StoryStreamStartPayload,
  StoryTurnImageGenerationPayload,
  StoryWorldCard,
} from '../types/story'
import { buildApiUrl, parseApiError, requestNoContent } from './httpClient'

type RequestOptions = RequestInit & {
  skipJsonContentType?: boolean
}

type StreamEvent = {
  event: string
  data: string
}

const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])
const REQUEST_RETRY_DELAYS_MS = [250, 700] as const

function normalizeRequestMethod(method: string | undefined): string {
  return (method ?? 'GET').toUpperCase()
}

function isRetryableMethod(method: string): boolean {
  return RETRYABLE_METHODS.has(method)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type StoryGenerationStreamOptions = {
  token: string
  gameId: number
  prompt?: string
  rerollLastResponse?: boolean
  discardLastAssistantSteps?: number
  instructions?: StoryInstructionCardInput[]
  storyLlmModel?: StoryNarratorModelId
  responseMaxTokens?: number
  memoryOptimizationEnabled?: boolean
  storyTopK?: number
  storyTopR?: number
  ambientEnabled?: boolean
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

export type StoryCommunityWorldReportReason = 'cp' | 'politics' | 'racism' | 'nationalism' | 'other'

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

  const targetUrl = buildApiUrl(path)
  const method = normalizeRequestMethod(options.method)
  const retryableMethod = isRetryableMethod(method)

  for (let attempt = 0; attempt <= REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
    let response: Response
    try {
      response = await fetch(targetUrl, {
        ...options,
        method,
        headers,
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      if (retryableMethod && attempt < REQUEST_RETRY_DELAYS_MS.length) {
        await delay(REQUEST_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new Error(`Failed to connect to API (${targetUrl}).`)
    }

    if (response.ok) {
      return (await response.json()) as T
    }

    if (retryableMethod && RETRYABLE_STATUS_CODES.has(response.status) && attempt < REQUEST_RETRY_DELAYS_MS.length) {
      await delay(REQUEST_RETRY_DELAYS_MS[attempt])
      continue
    }

    throw await parseApiError(response)
  }

  throw new Error(`Failed to connect to API (${targetUrl}).`)
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
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function listFavoriteCommunityWorlds(token: string): Promise<StoryCommunityWorldSummary[]> {
  return request<StoryCommunityWorldSummary[]>('/api/story/community/favorites', {
    method: 'GET',
    cache: 'no-store',
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
    cache: 'no-store',
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

export async function reportCommunityWorld(payload: {
  token: string
  worldId: number
  reason: StoryCommunityWorldReportReason
  description: string
}): Promise<StoryCommunityWorldSummary> {
  return request<StoryCommunityWorldSummary>(`/api/story/community/worlds/${payload.worldId}/report`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      reason: payload.reason,
      description: payload.description,
    }),
  })
}

export async function favoriteCommunityWorld(payload: {
  token: string
  worldId: number
}): Promise<StoryCommunityWorldSummary> {
  return request<StoryCommunityWorldSummary>(`/api/story/community/worlds/${payload.worldId}/favorite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function unfavoriteCommunityWorld(payload: {
  token: string
  worldId: number
}): Promise<StoryCommunityWorldSummary> {
  return request<StoryCommunityWorldSummary>(`/api/story/community/worlds/${payload.worldId}/favorite`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
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
  return requestNoContent(`/api/story/characters/${payload.characterId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function listStoryInstructionTemplates(token: string): Promise<StoryInstructionTemplate[]> {
  return request<StoryInstructionTemplate[]>('/api/story/instruction-templates', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function createStoryInstructionTemplate(payload: {
  token: string
  title: string
  content: string
}): Promise<StoryInstructionTemplate> {
  return request<StoryInstructionTemplate>('/api/story/instruction-templates', {
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

export async function updateStoryInstructionTemplate(payload: {
  token: string
  templateId: number
  title: string
  content: string
}): Promise<StoryInstructionTemplate> {
  return request<StoryInstructionTemplate>(`/api/story/instruction-templates/${payload.templateId}`, {
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

export async function deleteStoryInstructionTemplate(payload: {
  token: string
  templateId: number
}): Promise<void> {
  return requestNoContent(`/api/story/instruction-templates/${payload.templateId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createStoryGame(payload: {
  token: string
  title?: string
  description?: string
  opening_scene?: string
  visibility?: StoryGameVisibility
  age_rating?: '6+' | '16+' | '18+'
  genres?: string[]
  cover_image_url?: string | null
  cover_scale?: number
  cover_position_x?: number
  cover_position_y?: number
  ambient_enabled?: boolean
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>('/api/story/games', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title ?? null,
      description: payload.description ?? null,
      opening_scene: payload.opening_scene ?? null,
      visibility: payload.visibility ?? null,
      age_rating: payload.age_rating ?? null,
      genres: payload.genres ?? null,
      cover_image_url: payload.cover_image_url ?? null,
      cover_scale: payload.cover_scale ?? null,
      cover_position_x: payload.cover_position_x ?? null,
      cover_position_y: payload.cover_position_y ?? null,
      ambient_enabled: payload.ambient_enabled ?? null,
    }),
  })
}

export async function cloneStoryGame(payload: {
  token: string
  gameId: number
  copy_instructions?: boolean
  copy_plot?: boolean
  copy_world?: boolean
  copy_main_hero?: boolean
  copy_history?: boolean
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/clone`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      copy_instructions: payload.copy_instructions ?? true,
      copy_plot: payload.copy_plot ?? true,
      copy_world: payload.copy_world ?? true,
      copy_main_hero: payload.copy_main_hero ?? true,
      copy_history: payload.copy_history ?? true,
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
  contextLimitTokens?: number
  responseMaxTokens?: number
  responseMaxTokensEnabled?: boolean
  storyLlmModel?: StoryNarratorModelId
  imageModel?: StoryImageModelId
  imageStylePrompt?: string
  memoryOptimizationEnabled?: boolean
  storyTopK?: number
  storyTopR?: number
  ambientEnabled?: boolean
}): Promise<StoryGameSummary> {
  const requestPayload: Record<string, unknown> = {}
  if (typeof payload.contextLimitTokens === 'number') {
    requestPayload.context_limit_chars = payload.contextLimitTokens
  }
  if (typeof payload.responseMaxTokens === 'number') {
    requestPayload.response_max_tokens = payload.responseMaxTokens
  }
  if (typeof payload.responseMaxTokensEnabled === 'boolean') {
    requestPayload.response_max_tokens_enabled = payload.responseMaxTokensEnabled
  }
  if (typeof payload.storyLlmModel === 'string') {
    requestPayload.story_llm_model = payload.storyLlmModel
  }
  if (typeof payload.imageModel === 'string') {
    requestPayload.image_model = payload.imageModel
  }
  if (typeof payload.imageStylePrompt === 'string') {
    requestPayload.image_style_prompt = payload.imageStylePrompt
  }
  if (typeof payload.memoryOptimizationEnabled === 'boolean') {
    requestPayload.memory_optimization_enabled = payload.memoryOptimizationEnabled
  }
  if (typeof payload.storyTopK === 'number') {
    requestPayload.story_top_k = payload.storyTopK
  }
  if (typeof payload.storyTopR === 'number') {
    requestPayload.story_top_r = payload.storyTopR
  }
  if (typeof payload.ambientEnabled === 'boolean') {
    requestPayload.ambient_enabled = payload.ambientEnabled
  }
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(requestPayload),
  })
}

export async function updateStoryGameMeta(payload: {
  token: string
  gameId: number
  title?: string
  description?: string
  opening_scene?: string
  visibility?: StoryGameVisibility
  age_rating?: '6+' | '16+' | '18+'
  genres?: string[]
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
      opening_scene: payload.opening_scene ?? null,
      visibility: payload.visibility ?? null,
      age_rating: payload.age_rating ?? null,
      genres: payload.genres ?? null,
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
  return requestNoContent(`/api/story/games/${payload.gameId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
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
  const targetUrl = buildApiUrl(`/api/story/games/${options.gameId}/generate`)
  const requestPayload: Record<string, unknown> = {
    prompt: options.prompt,
    reroll_last_response: Boolean(options.rerollLastResponse),
    instructions: options.instructions ?? [],
  }
  if (typeof options.discardLastAssistantSteps === 'number' && Number.isFinite(options.discardLastAssistantSteps)) {
    requestPayload.discard_last_assistant_steps = Math.max(0, Math.trunc(options.discardLastAssistantSteps))
  }
  if (typeof options.storyLlmModel === 'string') {
    requestPayload.story_llm_model = options.storyLlmModel
  }
  if (typeof options.responseMaxTokens === 'number') {
    requestPayload.response_max_tokens = options.responseMaxTokens
  }
  if (typeof options.memoryOptimizationEnabled === 'boolean') {
    requestPayload.memory_optimization_enabled = options.memoryOptimizationEnabled
  }
  if (typeof options.storyTopK === 'number') {
    requestPayload.story_top_k = options.storyTopK
  }
  if (typeof options.storyTopR === 'number') {
    requestPayload.story_top_r = options.storyTopR
  }
  if (typeof options.ambientEnabled === 'boolean') {
    requestPayload.ambient_enabled = options.ambientEnabled
  }
  let response: Response
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: options.signal,
    })
  } catch {
    throw new Error(`Failed to connect to API (${targetUrl}).`)
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  if (!response.body) {
    throw new Error('Streaming is not supported by this response')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamError: Error | null = null
  let streamTerminalEventReceived = false

  const toStreamError = (error: unknown, fallbackMessage: string): Error =>
    error instanceof Error ? error : new Error(fallbackMessage)

  const processBlock = (rawBlock: string) => {
    const parsed = parseSseBlock(rawBlock)
    if (!parsed) {
      return
    }

    if (parsed.event === 'start') {
      try {
        const payload = JSON.parse(parsed.data) as StoryStreamStartPayload
        options.onStart?.(payload)
      } catch (error) {
        streamError = toStreamError(error, 'Failed to process generation start event')
        streamTerminalEventReceived = true
      }
      return
    }

    if (parsed.event === 'chunk') {
      try {
        const payload = JSON.parse(parsed.data) as StoryStreamChunkPayload
        options.onChunk?.(payload)
      } catch (error) {
        streamError = toStreamError(error, 'Failed to process generation chunk event')
        streamTerminalEventReceived = true
      }
      return
    }

    if (parsed.event === 'done') {
      try {
        const payload = JSON.parse(parsed.data) as StoryStreamDonePayload
        options.onDone?.(payload)
      } catch (error) {
        streamError = toStreamError(error, 'Failed to process generation done event')
      }
      streamTerminalEventReceived = true
      return
    }

    if (parsed.event === 'error') {
      let detail = 'Text generation failed'
      try {
        const payload = JSON.parse(parsed.data) as { detail?: string }
        if (typeof payload.detail === 'string' && payload.detail.trim()) {
          detail = payload.detail.trim()
        }
      } catch {
        // Use fallback detail for malformed error payloads.
      }
      streamError = new Error(detail)
      streamTerminalEventReceived = true
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, '\n')
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      processBlock(rawBlock)
      if (streamTerminalEventReceived) {
        break
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
    if (streamTerminalEventReceived) {
      try {
        await reader.cancel()
      } catch {
        // Ignore cancel failures; stream is already terminal.
      }
      break
    }
  }

  if (!streamTerminalEventReceived) {
    buffer += decoder.decode()
    buffer = buffer.replace(/\r\n/g, '\n')
    if (buffer.trim()) {
      processBlock(buffer)
    }
  }

  if (streamError) {
    throw streamError
  }
}

export async function generateStoryTurnImage(payload: {
  token: string
  gameId: number
  assistantMessageId: number
  signal?: AbortSignal
}): Promise<StoryTurnImageGenerationPayload> {
  return request<StoryTurnImageGenerationPayload>(`/api/story/games/${payload.gameId}/turn-image`, {
    method: 'POST',
    signal: payload.signal,
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      assistant_message_id: payload.assistantMessageId,
    }),
  })
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
  return requestNoContent(`/api/story/games/${payload.gameId}/instructions/${payload.instructionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
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
  return requestNoContent(`/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
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
  memory_turns?: number | null
}): Promise<StoryWorldCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers,
    kind: payload.kind ?? 'world',
    avatar_url: payload.avatar_url ?? null,
    avatar_scale: payload.avatar_scale ?? null,
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
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
  memory_turns?: number | null
}): Promise<StoryWorldCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers,
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function deleteStoryWorldCard(payload: {
  token: string
  gameId: number
  cardId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function undoStoryWorldCardEvent(payload: {
  token: string
  gameId: number
  eventId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/world-card-events/${payload.eventId}/undo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function undoStoryPlotCardEvent(payload: {
  token: string
  gameId: number
  eventId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/plot-card-events/${payload.eventId}/undo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}
