import type {
  StoryCharacter,
  StoryCharacterRace,
  StoryCharacterAvatarGenerationPayload,
  StoryCharacterEmotionAssets,
  StoryCharacterEmotionId,
  StoryCharacterEmotionGenerationPayload,
  StoryCharacterEmotionGenerationJobPayload,
  SmartRegenerationMode,
  SmartRegenerationOption,
  StoryCommunityCharacterSummary,
  StoryCommunityWorldComment,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldPayload,
  StoryCommunityWorldSummary,
  StoryGamePayload,
  StoryGameSummary,
  StoryGameVisibility,
  StoryImageModelId,
  StoryMemoryOptimizationMode,
  StoryNarratorModelId,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryMessage,
  StoryMemoryBlock,
  StoryPlotCard,
  StoryPublicationState,
  StoryStreamChunkPayload,
  StoryStreamDonePayload,
  StoryStreamPlotMemoryPayload,
  StoryStreamStartPayload,
  StoryTurnImageGenerationPayload,
  StoryWorldCard,
  StoryWorldCardTemplate,
  StoryWorldDetailType,
} from '../types/story'
import { buildApiUrl, normalizeApiMediaPayload, parseApiError, requestNoContent } from './httpClient'

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
const STORY_CHARACTER_EMOTION_GENERATION_TIMEOUT_MS = 600_000
const STORY_CHARACTER_EMOTION_GENERATION_POLL_INTERVAL_MS = 1_500
const STORY_DEFAULT_REPETITION_PENALTY = 1.05
const DEFAULT_PUBLICATION_STATE: StoryPublicationState = {
  status: 'none',
  requested_at: null,
  reviewed_at: null,
  reviewer_user_id: null,
  rejection_reason: null,
}

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

function normalizeStoryProviderErrorMessage(detail: string): string {
  const normalizedDetail = detail.replace(/\s+/g, ' ').trim()
  if (!normalizedDetail) {
    return 'Story generation failed'
  }

  let cleanedDetail = normalizedDetail
  const loweredDetail = normalizedDetail.toLocaleLowerCase()
  const structuredPayloadStart = normalizedDetail.indexOf('{')
  if (loweredDetail.startsWith('openrouter chat error') && structuredPayloadStart >= 0) {
    cleanedDetail = normalizedDetail.slice(0, structuredPayloadStart).replace(/[.:,\s]+$/, '').trim()
  }

  return cleanedDetail
}

export type StoryGenerationStreamOptions = {
  token: string
  gameId: number
  prompt?: string
  rerollLastResponse?: boolean
  discardLastAssistantSteps?: number
  smartRegeneration?: {
    enabled: boolean
    mode?: SmartRegenerationMode
    options: SmartRegenerationOption[]
  }
  instructions?: StoryInstructionCardInput[]
  storyLlmModel?: StoryNarratorModelId
  responseMaxTokens?: number
  memoryOptimizationEnabled?: boolean
  storyRepetitionPenalty?: number
  storyTopK?: number
  storyTopR?: number
  storyTemperature?: number
  showGgThoughts?: boolean
  showNpcThoughts?: boolean
  ambientEnabled?: boolean
  environmentEnabled?: boolean
  emotionVisualizationEnabled?: boolean
  signal?: AbortSignal
  onStart?: (payload: StoryStreamStartPayload) => void
  onChunk?: (payload: StoryStreamChunkPayload) => void
  onPlotMemory?: (payload: StoryStreamPlotMemoryPayload) => void
  onDone?: (payload: StoryStreamDonePayload) => void
}

export type StoryInstructionCardInput = {
  title: string
  content: string
  is_active?: boolean
}

export type StoryWorldCardInput = {
  title: string
  content: string
  race?: string
  clothing?: string
  inventory?: string
  health_status?: string
  triggers: string[]
  detail_type?: string
}

export type StoryCommunityWorldReportReason = 'cp' | 'politics' | 'racism' | 'nationalism' | 'other'

export type StoryCharacterInput = {
  name: string
  description: string
  race?: string
  clothing?: string
  inventory?: string
  health_status?: string
  note?: string
  triggers: string[]
  avatar_url: string | null
  avatar_original_url?: string | null
  avatar_scale?: number
  emotion_assets?: StoryCharacterEmotionAssets
  emotion_model?: string | null
  emotion_prompt_lock?: string | null
  emotion_generation_job_id?: number | null
  preserve_existing_emotions?: boolean
  visibility?: StoryGameVisibility
}

const STORY_CHARACTER_EMOTION_IDS = [
  'calm',
  'angry',
  'irritated',
  'stern',
  'cheerful',
  'smiling',
  'sly',
  'alert',
  'scared',
  'happy',
  'embarrassed',
  'confused',
  'thoughtful',
] as const

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
        cache: options.cache ?? (method === 'GET' || method === 'HEAD' ? 'no-store' : undefined),
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
      return normalizeApiMediaPayload((await response.json()) as T)
    }

    if (retryableMethod && RETRYABLE_STATUS_CODES.has(response.status) && attempt < REQUEST_RETRY_DELAYS_MS.length) {
      await delay(REQUEST_RETRY_DELAYS_MS[attempt])
      continue
    }

    const parsedError = await parseApiError(response)
    throw new Error(normalizeStoryProviderErrorMessage(parsedError.message))
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

function normalizeStoryCharacterEmotionAssets(rawValue: unknown): StoryCharacterEmotionAssets {
  if (!rawValue || typeof rawValue !== 'object') {
    return {}
  }

  const normalizedAssets: StoryCharacterEmotionAssets = {}
  STORY_CHARACTER_EMOTION_IDS.forEach((emotionId) => {
    const rawAsset = (rawValue as Record<string, unknown>)[emotionId]
    if (typeof rawAsset === 'string' && rawAsset.trim().length > 0) {
      normalizedAssets[emotionId] = rawAsset
    }
  })
  return normalizedAssets
}

function countStoryCharacterEmotionAssets(value: StoryCharacterEmotionAssets | undefined): number {
  return STORY_CHARACTER_EMOTION_IDS.reduce((count, emotionId) => {
    return count + ((value?.[emotionId] ?? '').trim().length > 0 ? 1 : 0)
  }, 0)
}

function normalizeStoryCharacterLinkName(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value
    .toLocaleLowerCase()
    .replace(/[.,!?()[\]{}"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStoryCharacterLinkAvatar(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function buildStoryCharacterLinkSignature(character: Pick<StoryCharacter, 'name' | 'avatar_url' | 'avatar_original_url'>): string {
  const normalizedName = normalizeStoryCharacterLinkName(character.name)
  const normalizedAvatar = normalizeStoryCharacterLinkAvatar(character.avatar_original_url ?? character.avatar_url)
  if (!normalizedName) {
    return ''
  }
  return `${normalizedName}|${normalizedAvatar}`
}

function normalizeStoryPublicationState(rawValue: unknown): StoryPublicationState {
  const value = rawValue as Partial<StoryPublicationState> | null | undefined
  return {
    status:
      value?.status === 'pending' || value?.status === 'approved' || value?.status === 'rejected'
        ? value.status
        : 'none',
    requested_at: typeof value?.requested_at === 'string' ? value.requested_at : null,
    reviewed_at: typeof value?.reviewed_at === 'string' ? value.reviewed_at : null,
    reviewer_user_id:
      typeof value?.reviewer_user_id === 'number' && Number.isFinite(value.reviewer_user_id)
        ? Math.trunc(value.reviewer_user_id)
        : null,
    rejection_reason: typeof value?.rejection_reason === 'string' ? value.rejection_reason : null,
  }
}

function normalizeStoryStringArray(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return []
  }
  return rawValue
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeStoryGameSummaryPayload(rawGame: StoryGameSummary): StoryGameSummary {
  const game = rawGame as Partial<StoryGameSummary>
  return {
    ...rawGame,
    id: typeof game.id === 'number' && Number.isFinite(game.id) ? Math.trunc(game.id) : 0,
    title: typeof game.title === 'string' ? game.title : '',
    description: typeof game.description === 'string' ? game.description : '',
    latest_message_preview: typeof game.latest_message_preview === 'string' ? game.latest_message_preview : null,
    turn_count: typeof game.turn_count === 'number' && Number.isFinite(game.turn_count) ? Math.max(0, Math.trunc(game.turn_count)) : 0,
    opening_scene: typeof game.opening_scene === 'string' ? game.opening_scene : '',
    visibility: game.visibility === 'public' ? 'public' : 'private',
    publication: normalizeStoryPublicationState(game.publication ?? DEFAULT_PUBLICATION_STATE),
    age_rating: game.age_rating === '6+' || game.age_rating === '18+' ? game.age_rating : '16+',
    genres: normalizeStoryStringArray(game.genres),
    cover_image_url: typeof game.cover_image_url === 'string' ? game.cover_image_url : null,
    cover_scale: typeof game.cover_scale === 'number' && Number.isFinite(game.cover_scale) ? Math.max(1, Math.min(3, game.cover_scale)) : 1,
    cover_position_x:
      typeof game.cover_position_x === 'number' && Number.isFinite(game.cover_position_x)
        ? Math.max(0, Math.min(100, game.cover_position_x))
        : 50,
    cover_position_y:
      typeof game.cover_position_y === 'number' && Number.isFinite(game.cover_position_y)
        ? Math.max(0, Math.min(100, game.cover_position_y))
        : 50,
    source_world_id:
      typeof game.source_world_id === 'number' && Number.isFinite(game.source_world_id)
        ? Math.trunc(game.source_world_id)
        : null,
    community_views:
      typeof game.community_views === 'number' && Number.isFinite(game.community_views)
        ? Math.max(0, Math.trunc(game.community_views))
        : 0,
    community_launches:
      typeof game.community_launches === 'number' && Number.isFinite(game.community_launches)
        ? Math.max(0, Math.trunc(game.community_launches))
        : 0,
    community_rating_avg:
      typeof game.community_rating_avg === 'number' && Number.isFinite(game.community_rating_avg)
        ? game.community_rating_avg
        : 0,
    community_rating_count:
      typeof game.community_rating_count === 'number' && Number.isFinite(game.community_rating_count)
        ? Math.max(0, Math.trunc(game.community_rating_count))
        : 0,
    context_limit_chars:
      typeof game.context_limit_chars === 'number' && Number.isFinite(game.context_limit_chars)
        ? Math.max(0, Math.trunc(game.context_limit_chars))
        : 0,
    response_max_tokens:
      typeof game.response_max_tokens === 'number' && Number.isFinite(game.response_max_tokens)
        ? Math.max(0, Math.trunc(game.response_max_tokens))
        : 0,
    response_max_tokens_enabled: Boolean(game.response_max_tokens_enabled),
    story_llm_model:
      typeof game.story_llm_model === 'string'
        ? (game.story_llm_model as StoryGameSummary['story_llm_model'])
        : 'deepseek/deepseek-chat-v3-0324',
    image_model:
      typeof game.image_model === 'string'
        ? (game.image_model as StoryGameSummary['image_model'])
        : 'black-forest-labs/flux.2-pro',
    image_style_prompt: typeof game.image_style_prompt === 'string' ? game.image_style_prompt : '',
    memory_optimization_enabled: Boolean(game.memory_optimization_enabled),
    memory_optimization_mode:
      typeof game.memory_optimization_mode === 'string'
        ? (game.memory_optimization_mode as StoryGameSummary['memory_optimization_mode'])
        : 'standard',
    story_repetition_penalty:
      typeof game.story_repetition_penalty === 'number' && Number.isFinite(game.story_repetition_penalty)
        ? Math.max(1, Math.min(2, Math.round(game.story_repetition_penalty * 100) / 100))
        : STORY_DEFAULT_REPETITION_PENALTY,
    story_top_k: typeof game.story_top_k === 'number' && Number.isFinite(game.story_top_k) ? Math.trunc(game.story_top_k) : 0,
    story_top_r: typeof game.story_top_r === 'number' && Number.isFinite(game.story_top_r) ? game.story_top_r : 1,
    story_temperature:
      typeof game.story_temperature === 'number' && Number.isFinite(game.story_temperature) ? game.story_temperature : 1,
    show_gg_thoughts: Boolean(game.show_gg_thoughts),
    show_npc_thoughts: Boolean(game.show_npc_thoughts),
    ambient_enabled: Boolean(game.ambient_enabled),
    character_state_enabled: Boolean(game.character_state_enabled),
    canonical_state_pipeline_enabled: game.canonical_state_pipeline_enabled !== false,
    canonical_state_safe_fallback_enabled: Boolean(game.canonical_state_safe_fallback_enabled),
    environment_enabled: Boolean(game.environment_enabled),
    environment_time_enabled: Boolean(game.environment_time_enabled ?? game.environment_enabled),
    environment_weather_enabled: Boolean(game.environment_weather_enabled ?? game.environment_enabled),
    ambient_profile:
      game.ambient_profile && typeof game.ambient_profile === 'object'
        ? (game.ambient_profile as StoryGameSummary['ambient_profile'])
        : null,
    environment_current_datetime:
      typeof game.environment_current_datetime === 'string' ? game.environment_current_datetime : null,
    environment_current_weather:
      game.environment_current_weather && typeof game.environment_current_weather === 'object'
        ? (game.environment_current_weather as Record<string, unknown>)
        : null,
    environment_tomorrow_weather:
      game.environment_tomorrow_weather && typeof game.environment_tomorrow_weather === 'object'
        ? (game.environment_tomorrow_weather as Record<string, unknown>)
        : null,
    current_location_label: typeof game.current_location_label === 'string' ? game.current_location_label : null,
    emotion_visualization_enabled: Boolean(game.emotion_visualization_enabled),
    last_activity_at: typeof game.last_activity_at === 'string' ? game.last_activity_at : new Date(0).toISOString(),
    created_at: typeof game.created_at === 'string' ? game.created_at : new Date(0).toISOString(),
    updated_at: typeof game.updated_at === 'string' ? game.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryInstructionCardPayload(rawCard: StoryInstructionCard): StoryInstructionCard {
  const card = rawCard as Partial<StoryInstructionCard>
  return {
    ...rawCard,
    id: typeof card.id === 'number' && Number.isFinite(card.id) ? Math.trunc(card.id) : 0,
    game_id: typeof card.game_id === 'number' && Number.isFinite(card.game_id) ? Math.trunc(card.game_id) : 0,
    title: typeof card.title === 'string' ? card.title : '',
    content: typeof card.content === 'string' ? card.content : '',
    is_active: Boolean(card.is_active),
    created_at: typeof card.created_at === 'string' ? card.created_at : new Date(0).toISOString(),
    updated_at: typeof card.updated_at === 'string' ? card.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryPlotCardPayload(rawCard: StoryPlotCard): StoryPlotCard {
  const card = rawCard as Partial<StoryPlotCard>
  return {
    ...rawCard,
    id: typeof card.id === 'number' && Number.isFinite(card.id) ? Math.trunc(card.id) : 0,
    game_id: typeof card.game_id === 'number' && Number.isFinite(card.game_id) ? Math.trunc(card.game_id) : 0,
    title: typeof card.title === 'string' ? card.title : '',
    content: typeof card.content === 'string' ? card.content : '',
    triggers: normalizeStoryStringArray(card.triggers),
    memory_turns:
      typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns) ? Math.trunc(card.memory_turns) : null,
    ai_edit_enabled: Boolean(card.ai_edit_enabled),
    is_enabled: Boolean(card.is_enabled),
    source: card.source === 'ai' ? 'ai' : 'user',
    created_at: typeof card.created_at === 'string' ? card.created_at : new Date(0).toISOString(),
    updated_at: typeof card.updated_at === 'string' ? card.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryWorldCardPayload(rawCard: StoryWorldCard): StoryWorldCard {
  const card = rawCard as Partial<StoryWorldCard>
  return {
    ...rawCard,
    id: typeof card.id === 'number' && Number.isFinite(card.id) ? Math.trunc(card.id) : 0,
    game_id: typeof card.game_id === 'number' && Number.isFinite(card.game_id) ? Math.trunc(card.game_id) : 0,
    title: typeof card.title === 'string' ? card.title : '',
    content: typeof card.content === 'string' ? card.content : '',
    race: typeof card.race === 'string' ? card.race : '',
    clothing: typeof card.clothing === 'string' ? card.clothing : '',
    inventory: typeof card.inventory === 'string' ? card.inventory : '',
    health_status: typeof card.health_status === 'string' ? card.health_status : '',
    triggers: normalizeStoryStringArray(card.triggers),
    kind: card.kind === 'npc' || card.kind === 'main_hero' || card.kind === 'world_profile' ? card.kind : 'world',
    detail_type: typeof card.detail_type === 'string' ? card.detail_type : '',
    avatar_url: typeof card.avatar_url === 'string' ? card.avatar_url : null,
    avatar_original_url: typeof card.avatar_original_url === 'string' ? card.avatar_original_url : null,
    avatar_scale:
      typeof card.avatar_scale === 'number' && Number.isFinite(card.avatar_scale)
        ? Math.max(1, Math.min(3, card.avatar_scale))
        : 1,
    character_id:
      typeof card.character_id === 'number' && Number.isFinite(card.character_id) ? Math.trunc(card.character_id) : null,
    memory_turns:
      typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns) ? Math.trunc(card.memory_turns) : null,
    is_locked: Boolean(card.is_locked),
    ai_edit_enabled: Boolean(card.ai_edit_enabled),
    source: card.source === 'ai' ? 'ai' : 'user',
    created_at: typeof card.created_at === 'string' ? card.created_at : new Date(0).toISOString(),
    updated_at: typeof card.updated_at === 'string' ? card.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryWorldDetailTypePayload(rawType: StoryWorldDetailType): StoryWorldDetailType {
  const detailType = rawType as Partial<StoryWorldDetailType>
  return {
    ...rawType,
    id: typeof detailType.id === 'number' && Number.isFinite(detailType.id) ? Math.trunc(detailType.id) : 0,
    name: typeof detailType.name === 'string' ? detailType.name : '',
    created_at: typeof detailType.created_at === 'string' ? detailType.created_at : new Date(0).toISOString(),
    updated_at: typeof detailType.updated_at === 'string' ? detailType.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryWorldCardTemplatePayload(rawTemplate: StoryWorldCardTemplate): StoryWorldCardTemplate {
  const template = rawTemplate as Partial<StoryWorldCardTemplate>
  return {
    ...rawTemplate,
    id: typeof template.id === 'number' && Number.isFinite(template.id) ? Math.trunc(template.id) : 0,
    user_id: typeof template.user_id === 'number' && Number.isFinite(template.user_id) ? Math.trunc(template.user_id) : 0,
    title: typeof template.title === 'string' ? template.title : '',
    content: typeof template.content === 'string' ? template.content : '',
    triggers: normalizeStoryStringArray(template.triggers),
    kind: template.kind === 'world' ? 'world' : 'world_profile',
    detail_type: typeof template.detail_type === 'string' ? template.detail_type : '',
    avatar_url: typeof template.avatar_url === 'string' ? template.avatar_url : null,
    avatar_original_url: typeof template.avatar_original_url === 'string' ? template.avatar_original_url : null,
    avatar_scale:
      typeof template.avatar_scale === 'number' && Number.isFinite(template.avatar_scale)
        ? Math.max(1, Math.min(3, template.avatar_scale))
        : 1,
    memory_turns:
      typeof template.memory_turns === 'number' && Number.isFinite(template.memory_turns) ? Math.trunc(template.memory_turns) : null,
    created_at: typeof template.created_at === 'string' ? template.created_at : new Date(0).toISOString(),
    updated_at: typeof template.updated_at === 'string' ? template.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryGamePayload(rawPayload: StoryGamePayload): StoryGamePayload {
  const payload = rawPayload as Partial<StoryGamePayload>
  return {
    ...rawPayload,
    game: normalizeStoryGameSummaryPayload((payload.game ?? {}) as StoryGameSummary),
    messages: Array.isArray(payload.messages) ? payload.messages.filter((item) => Boolean(item) && typeof item === 'object') : [],
    has_older_messages: Boolean(payload.has_older_messages),
    turn_images: Array.isArray(payload.turn_images) ? payload.turn_images.filter((item) => Boolean(item) && typeof item === 'object') : [],
    instruction_cards: Array.isArray(payload.instruction_cards)
      ? payload.instruction_cards
          .filter((item): item is StoryInstructionCard => Boolean(item) && typeof item === 'object')
          .map((item) => normalizeStoryInstructionCardPayload(item))
          .filter((item) => item.id > 0)
      : [],
    plot_cards: Array.isArray(payload.plot_cards)
      ? payload.plot_cards
          .filter((item): item is StoryPlotCard => Boolean(item) && typeof item === 'object')
          .map((item) => normalizeStoryPlotCardPayload(item))
          .filter((item) => item.id > 0)
      : [],
    plot_card_events: Array.isArray(payload.plot_card_events) ? payload.plot_card_events.filter((item) => Boolean(item) && typeof item === 'object') : [],
    memory_blocks: Array.isArray(payload.memory_blocks) ? payload.memory_blocks.filter((item) => Boolean(item) && typeof item === 'object') : [],
    world_cards: Array.isArray(payload.world_cards)
      ? payload.world_cards
          .filter((item): item is StoryWorldCard => Boolean(item) && typeof item === 'object')
          .map((item) => normalizeStoryWorldCardPayload(item))
          .filter((item) => item.id > 0)
      : [],
    world_card_events: Array.isArray(payload.world_card_events) ? payload.world_card_events.filter((item) => Boolean(item) && typeof item === 'object') : [],
    can_redo_assistant_step: Boolean(payload.can_redo_assistant_step),
  }
}

function normalizeStoryCharacterPayload(rawCharacter: StoryCharacter): StoryCharacter {
  const character = rawCharacter as Partial<StoryCharacter>
  const normalizedTriggers = Array.isArray(character.triggers)
    ? character.triggers.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : []

  return {
    ...rawCharacter,
    id: typeof character.id === 'number' && Number.isFinite(character.id) ? Math.trunc(character.id) : 0,
    user_id: typeof character.user_id === 'number' && Number.isFinite(character.user_id) ? Math.trunc(character.user_id) : 0,
    name: typeof character.name === 'string' ? character.name : '',
    description: typeof character.description === 'string' ? character.description : '',
    race: typeof character.race === 'string' ? character.race : '',
    clothing: typeof character.clothing === 'string' ? character.clothing : '',
    inventory: typeof character.inventory === 'string' ? character.inventory : '',
    health_status: typeof character.health_status === 'string' ? character.health_status : '',
    note: typeof character.note === 'string' ? character.note : '',
    triggers: normalizedTriggers,
    avatar_url: typeof character.avatar_url === 'string' ? character.avatar_url : null,
    avatar_original_url: typeof character.avatar_original_url === 'string' ? character.avatar_original_url : null,
    avatar_scale:
      typeof character.avatar_scale === 'number' && Number.isFinite(character.avatar_scale)
        ? Math.max(1, Math.min(3, character.avatar_scale))
        : 1,
    emotion_assets: normalizeStoryCharacterEmotionAssets(character.emotion_assets),
    emotion_model: typeof character.emotion_model === 'string' ? character.emotion_model : '',
    emotion_prompt_lock: typeof character.emotion_prompt_lock === 'string' ? character.emotion_prompt_lock : null,
    source: character.source === 'ai' ? 'ai' : 'user',
    visibility: character.visibility === 'public' ? 'public' : 'private',
    publication: normalizeStoryPublicationState(character.publication ?? DEFAULT_PUBLICATION_STATE),
    source_character_id:
      typeof character.source_character_id === 'number' && Number.isFinite(character.source_character_id)
        ? Math.trunc(character.source_character_id)
        : null,
    community_rating_avg:
      typeof character.community_rating_avg === 'number' && Number.isFinite(character.community_rating_avg)
        ? character.community_rating_avg
        : 0,
    community_rating_count:
      typeof character.community_rating_count === 'number' && Number.isFinite(character.community_rating_count)
        ? Math.max(0, Math.trunc(character.community_rating_count))
        : 0,
    community_additions_count:
      typeof character.community_additions_count === 'number' && Number.isFinite(character.community_additions_count)
        ? Math.max(0, Math.trunc(character.community_additions_count))
        : 0,
    created_at: typeof character.created_at === 'string' ? character.created_at : new Date(0).toISOString(),
    updated_at: typeof character.updated_at === 'string' ? character.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryCharacterListPayload(rawCharacters: StoryCharacter[]): StoryCharacter[] {
  if (!Array.isArray(rawCharacters)) {
    return []
  }
  const normalizedCharacters = rawCharacters
    .filter((item): item is StoryCharacter => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeStoryCharacterPayload(item))
    .filter((item) => item.id > 0)

  const donorById = new Map<number, StoryCharacter>()
  const donorsBySignature = new Map<string, StoryCharacter[]>()
  const donorsByName = new Map<string, StoryCharacter[]>()

  normalizedCharacters.forEach((character) => {
    if (countStoryCharacterEmotionAssets(character.emotion_assets) <= 0) {
      return
    }
    donorById.set(character.id, character)

    const signature = buildStoryCharacterLinkSignature(character)
    if (signature) {
      const signatureDonors = donorsBySignature.get(signature) ?? []
      signatureDonors.push(character)
      donorsBySignature.set(signature, signatureDonors)
    }

    const normalizedName = normalizeStoryCharacterLinkName(character.name)
    if (normalizedName) {
      const nameDonors = donorsByName.get(normalizedName) ?? []
      nameDonors.push(character)
      donorsByName.set(normalizedName, nameDonors)
    }
  })

  return normalizedCharacters.map((character) => {
    if (countStoryCharacterEmotionAssets(character.emotion_assets) > 0) {
      return character
    }

    let donor: StoryCharacter | null = null
    if (typeof character.source_character_id === 'number' && character.source_character_id > 0) {
      donor = donorById.get(character.source_character_id) ?? null
    }

    if (!donor) {
      const signatureDonors = donorsBySignature.get(buildStoryCharacterLinkSignature(character)) ?? []
      donor = signatureDonors.find((candidate) => candidate.id !== character.id) ?? null
    }

    if (!donor) {
      const nameDonors = donorsByName.get(normalizeStoryCharacterLinkName(character.name)) ?? []
      if (nameDonors.length === 1 && nameDonors[0].id !== character.id) {
        donor = nameDonors[0]
      }
    }

    if (!donor) {
      return character
    }

    return {
      ...character,
      emotion_assets: donor.emotion_assets,
      emotion_model: character.emotion_model || donor.emotion_model,
      emotion_prompt_lock: character.emotion_prompt_lock ?? donor.emotion_prompt_lock,
    }
  })
}

function normalizeStoryCommunityCharacterSummaryPayload(
  rawCharacter: StoryCommunityCharacterSummary,
): StoryCommunityCharacterSummary {
  const character = rawCharacter as Partial<StoryCommunityCharacterSummary>
  const normalizedTriggers = Array.isArray(character.triggers)
    ? character.triggers.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : []

  return {
    ...rawCharacter,
    id: typeof character.id === 'number' && Number.isFinite(character.id) ? Math.trunc(character.id) : 0,
    name: typeof character.name === 'string' ? character.name : '',
    description: typeof character.description === 'string' ? character.description : '',
    race: typeof character.race === 'string' ? character.race : '',
    clothing: typeof character.clothing === 'string' ? character.clothing : '',
    inventory: typeof character.inventory === 'string' ? character.inventory : '',
    health_status: typeof character.health_status === 'string' ? character.health_status : '',
    note: typeof character.note === 'string' ? character.note : '',
    triggers: normalizedTriggers,
    avatar_url: typeof character.avatar_url === 'string' ? character.avatar_url : null,
    avatar_original_url: typeof character.avatar_original_url === 'string' ? character.avatar_original_url : null,
    avatar_scale:
      typeof character.avatar_scale === 'number' && Number.isFinite(character.avatar_scale)
        ? Math.max(1, Math.min(3, character.avatar_scale))
        : 1,
    emotion_assets: normalizeStoryCharacterEmotionAssets(character.emotion_assets),
    emotion_model: typeof character.emotion_model === 'string' ? character.emotion_model : '',
    emotion_prompt_lock: typeof character.emotion_prompt_lock === 'string' ? character.emotion_prompt_lock : null,
    visibility: character.visibility === 'public' ? 'public' : 'private',
    author_id: typeof character.author_id === 'number' && Number.isFinite(character.author_id) ? Math.trunc(character.author_id) : 0,
    author_name: typeof character.author_name === 'string' ? character.author_name : '',
    author_avatar_url: typeof character.author_avatar_url === 'string' ? character.author_avatar_url : null,
    community_rating_avg:
      typeof character.community_rating_avg === 'number' && Number.isFinite(character.community_rating_avg)
        ? character.community_rating_avg
        : 0,
    community_rating_count:
      typeof character.community_rating_count === 'number' && Number.isFinite(character.community_rating_count)
        ? Math.max(0, Math.trunc(character.community_rating_count))
        : 0,
    community_additions_count:
      typeof character.community_additions_count === 'number' && Number.isFinite(character.community_additions_count)
        ? Math.max(0, Math.trunc(character.community_additions_count))
        : 0,
    user_rating:
      typeof character.user_rating === 'number' && Number.isFinite(character.user_rating)
        ? Math.max(0, Math.trunc(character.user_rating))
        : null,
    is_added_by_user: Boolean(character.is_added_by_user),
    is_reported_by_user: Boolean(character.is_reported_by_user),
    created_at: typeof character.created_at === 'string' ? character.created_at : new Date(0).toISOString(),
    updated_at: typeof character.updated_at === 'string' ? character.updated_at : new Date(0).toISOString(),
  }
}

function normalizeStoryCharacterRacePayload(rawRace: StoryCharacterRace): StoryCharacterRace {
  const race = rawRace as Partial<StoryCharacterRace>
  return {
    ...rawRace,
    id: typeof race.id === 'number' && Number.isFinite(race.id) ? Math.trunc(race.id) : 0,
    name: typeof race.name === 'string' ? race.name : '',
    created_at: typeof race.created_at === 'string' ? race.created_at : new Date(0).toISOString(),
    updated_at: typeof race.updated_at === 'string' ? race.updated_at : new Date(0).toISOString(),
  }
}

export async function listStoryGames(
  token: string,
  options: {
    compact?: boolean
    limit?: number
  } = {},
): Promise<StoryGameSummary[]> {
  const params = new URLSearchParams()
  if (options.compact) {
    params.set('compact', '1')
  }
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.max(1, Math.trunc(options.limit))))
  }
  const query = params.toString()
  const path = query ? `/api/story/games?${query}` : '/api/story/games'
  return request<StoryGameSummary[]>(path, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function listCommunityWorlds(
  token: string,
  options: {
    limit?: number
    offset?: number
    sort?: 'updated_desc' | 'rating_desc' | 'launches_desc' | 'views_desc'
    query?: string
    ageRating?: '6+' | '16+' | '18+' | null
    genre?: string | null
  } = {},
): Promise<StoryCommunityWorldSummary[]> {
  const params = new URLSearchParams()
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.max(1, Math.trunc(options.limit))))
  }
  if (typeof options.offset === 'number' && Number.isFinite(options.offset) && options.offset >= 0) {
    params.set('offset', String(Math.max(0, Math.trunc(options.offset))))
  }
  if (typeof options.sort === 'string' && options.sort.trim()) {
    params.set('sort', options.sort.trim())
  }
  if (typeof options.query === 'string' && options.query.trim()) {
    params.set('query', options.query.trim())
  }
  if (typeof options.ageRating === 'string' && options.ageRating.trim()) {
    params.set('age_rating', options.ageRating.trim())
  }
  if (typeof options.genre === 'string' && options.genre.trim()) {
    params.set('genre', options.genre.trim())
  }
  const query = params.toString()
  const path = query ? `/api/story/community/worlds?${query}` : '/api/story/community/worlds'
  return request<StoryCommunityWorldSummary[]>(path, {
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

export async function listCommunityWorldComments(payload: {
  token: string
  worldId: number
}): Promise<StoryCommunityWorldComment[]> {
  return request<StoryCommunityWorldComment[]>(`/api/story/community/worlds/${payload.worldId}/comments`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createCommunityWorldComment(payload: {
  token: string
  worldId: number
  content: string
}): Promise<StoryCommunityWorldComment> {
  return request<StoryCommunityWorldComment>(`/api/story/community/worlds/${payload.worldId}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      content: payload.content,
    }),
  })
}

export async function updateCommunityWorldComment(payload: {
  token: string
  worldId: number
  commentId: number
  content: string
}): Promise<StoryCommunityWorldComment> {
  return request<StoryCommunityWorldComment>(
    `/api/story/community/worlds/${payload.worldId}/comments/${payload.commentId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
      body: JSON.stringify({
        content: payload.content,
      }),
    },
  )
}

export async function deleteCommunityWorldComment(payload: {
  token: string
  worldId: number
  commentId: number
}): Promise<void> {
  return requestNoContent(`/api/story/community/worlds/${payload.worldId}/comments/${payload.commentId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
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

export async function listCommunityCharacters(
  token: string,
  options: {
    limit?: number
    offset?: number
    sort?: 'updated_desc' | 'rating_desc' | 'additions_desc'
    query?: string
    addedFilter?: 'all' | 'added' | 'not_added'
  } = {},
): Promise<StoryCommunityCharacterSummary[]> {
  const params = new URLSearchParams()
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.max(1, Math.trunc(options.limit))))
  }
  if (typeof options.offset === 'number' && Number.isFinite(options.offset) && options.offset >= 0) {
    params.set('offset', String(Math.max(0, Math.trunc(options.offset))))
  }
  if (typeof options.sort === 'string' && options.sort.trim()) {
    params.set('sort', options.sort.trim())
  }
  if (typeof options.query === 'string' && options.query.trim()) {
    params.set('query', options.query.trim())
  }
  if (typeof options.addedFilter === 'string' && options.addedFilter.trim()) {
    params.set('added_filter', options.addedFilter.trim())
  }
  const query = params.toString()
  const response = await request<StoryCommunityCharacterSummary[]>(
    query ? `/api/story/community/characters?${query}` : '/api/story/community/characters',
    {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  return Array.isArray(response) ? response.map((item) => normalizeStoryCommunityCharacterSummaryPayload(item)) : []
}

export async function getCommunityCharacter(payload: {
  token: string
  characterId: number
}): Promise<StoryCommunityCharacterSummary> {
  const response = await request<StoryCommunityCharacterSummary>(`/api/story/community/characters/${payload.characterId}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return normalizeStoryCommunityCharacterSummaryPayload(response)
}

export async function rateCommunityCharacter(payload: {
  token: string
  characterId: number
  rating: number
}): Promise<StoryCommunityCharacterSummary> {
  const response = await request<StoryCommunityCharacterSummary>(`/api/story/community/characters/${payload.characterId}/rating`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      rating: payload.rating,
    }),
  })
  return normalizeStoryCommunityCharacterSummaryPayload(response)
}

export async function reportCommunityCharacter(payload: {
  token: string
  characterId: number
  reason: StoryCommunityWorldReportReason
  description: string
}): Promise<StoryCommunityCharacterSummary> {
  const response = await request<StoryCommunityCharacterSummary>(`/api/story/community/characters/${payload.characterId}/report`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      reason: payload.reason,
      description: payload.description,
    }),
  })
  return normalizeStoryCommunityCharacterSummaryPayload(response)
}

export async function addCommunityCharacter(payload: {
  token: string
  characterId: number
}): Promise<StoryCommunityCharacterSummary> {
  const response = await request<StoryCommunityCharacterSummary>(`/api/story/community/characters/${payload.characterId}/add`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return normalizeStoryCommunityCharacterSummaryPayload(response)
}

export async function listCommunityInstructionTemplates(
  token: string,
  options: {
    limit?: number
    offset?: number
    sort?: 'updated_desc' | 'rating_desc' | 'additions_desc'
    query?: string
    addedFilter?: 'all' | 'added' | 'not_added'
  } = {},
): Promise<StoryCommunityInstructionTemplateSummary[]> {
  const params = new URLSearchParams()
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.max(1, Math.trunc(options.limit))))
  }
  if (typeof options.offset === 'number' && Number.isFinite(options.offset) && options.offset >= 0) {
    params.set('offset', String(Math.max(0, Math.trunc(options.offset))))
  }
  if (typeof options.sort === 'string' && options.sort.trim()) {
    params.set('sort', options.sort.trim())
  }
  if (typeof options.query === 'string' && options.query.trim()) {
    params.set('query', options.query.trim())
  }
  if (typeof options.addedFilter === 'string' && options.addedFilter.trim()) {
    params.set('added_filter', options.addedFilter.trim())
  }
  const query = params.toString()
  return request<StoryCommunityInstructionTemplateSummary[]>(
    query ? `/api/story/community/instruction-templates?${query}` : '/api/story/community/instruction-templates',
    {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function getCommunityInstructionTemplate(payload: {
  token: string
  templateId: number
}): Promise<StoryCommunityInstructionTemplateSummary> {
  return request<StoryCommunityInstructionTemplateSummary>(`/api/story/community/instruction-templates/${payload.templateId}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function rateCommunityInstructionTemplate(payload: {
  token: string
  templateId: number
  rating: number
}): Promise<StoryCommunityInstructionTemplateSummary> {
  return request<StoryCommunityInstructionTemplateSummary>(`/api/story/community/instruction-templates/${payload.templateId}/rating`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      rating: payload.rating,
    }),
  })
}

export async function reportCommunityInstructionTemplate(payload: {
  token: string
  templateId: number
  reason: StoryCommunityWorldReportReason
  description: string
}): Promise<StoryCommunityInstructionTemplateSummary> {
  return request<StoryCommunityInstructionTemplateSummary>(`/api/story/community/instruction-templates/${payload.templateId}/report`, {
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

export async function addCommunityInstructionTemplate(payload: {
  token: string
  templateId: number
}): Promise<StoryCommunityInstructionTemplateSummary> {
  return request<StoryCommunityInstructionTemplateSummary>(`/api/story/community/instruction-templates/${payload.templateId}/add`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function listStoryCharacters(token: string): Promise<StoryCharacter[]> {
  const response = await request<StoryCharacter[]>('/api/story/characters', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  return normalizeStoryCharacterListPayload(response)
}

export async function listStoryCharacterRaces(payload: { token: string }): Promise<StoryCharacterRace[]> {
  const response = await request<StoryCharacterRace[]>('/api/story/character-races', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return Array.isArray(response)
    ? response
        .filter((item): item is StoryCharacterRace => Boolean(item) && typeof item === 'object')
        .map((item) => normalizeStoryCharacterRacePayload(item))
        .filter((item) => item.id > 0 && item.name.trim().length > 0)
    : []
}

export async function createStoryCharacterRace(payload: {
  token: string
  name: string
}): Promise<StoryCharacterRace> {
  const response = await request<StoryCharacterRace>('/api/story/character-races', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      name: payload.name,
    }),
  })
  return normalizeStoryCharacterRacePayload(response)
}

export async function listStoryWorldDetailTypes(payload: { token: string }): Promise<StoryWorldDetailType[]> {
  const response = await request<StoryWorldDetailType[]>('/api/story/world-detail-types', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return Array.isArray(response)
    ? response
        .filter((item): item is StoryWorldDetailType => Boolean(item) && typeof item === 'object')
        .map((item) => normalizeStoryWorldDetailTypePayload(item))
    : []
}

export async function createStoryWorldDetailType(payload: {
  token: string
  name: string
}): Promise<StoryWorldDetailType> {
  const response = await request<StoryWorldDetailType>('/api/story/world-detail-types', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      name: payload.name,
    }),
  })
  return normalizeStoryWorldDetailTypePayload(response)
}

export async function listStoryWorldCardTemplates(payload: { token: string }): Promise<StoryWorldCardTemplate[]> {
  const response = await request<StoryWorldCardTemplate[]>('/api/story/world-card-templates', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return Array.isArray(response)
    ? response
        .filter((item): item is StoryWorldCardTemplate => Boolean(item) && typeof item === 'object')
        .map((item) => normalizeStoryWorldCardTemplatePayload(item))
    : []
}

export async function createStoryWorldCardTemplate(payload: {
  token: string
  title: string
  content: string
  triggers?: string[]
  kind?: 'world' | 'world_profile'
  detail_type?: string
  avatar_url?: string | null
  avatar_original_url?: string | null
  avatar_scale?: number
  memory_turns?: number | null
}): Promise<StoryWorldCardTemplate> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers ?? [],
    kind: payload.kind ?? 'world_profile',
    detail_type: payload.detail_type ?? '',
    avatar_url: payload.avatar_url ?? null,
    avatar_original_url: payload.avatar_original_url ?? null,
    avatar_scale: payload.avatar_scale ?? null,
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  const response = await request<StoryWorldCardTemplate>('/api/story/world-card-templates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
  })
  return normalizeStoryWorldCardTemplatePayload(response)
}

export async function updateStoryWorldCardTemplate(payload: {
  token: string
  templateId: number
  title: string
  content: string
  triggers?: string[]
  detail_type?: string
  avatar_url?: string | null
  avatar_original_url?: string | null
  avatar_scale?: number
  memory_turns?: number | null
}): Promise<StoryWorldCardTemplate> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers ?? [],
    detail_type: payload.detail_type ?? '',
    avatar_url: payload.avatar_url ?? null,
    avatar_original_url: payload.avatar_original_url ?? null,
    avatar_scale: payload.avatar_scale ?? null,
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  const response = await request<StoryWorldCardTemplate>(`/api/story/world-card-templates/${payload.templateId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
  })
  return normalizeStoryWorldCardTemplatePayload(response)
}

export async function deleteStoryWorldCardTemplate(payload: {
  token: string
  templateId: number
}): Promise<void> {
  return requestNoContent(`/api/story/world-card-templates/${payload.templateId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function createStoryCharacter(payload: {
  token: string
  input: StoryCharacterInput
}): Promise<StoryCharacter> {
  const response = await request<StoryCharacter>('/api/story/characters', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(payload.input),
  })
  return normalizeStoryCharacterPayload(response)
}

export async function updateStoryCharacter(payload: {
  token: string
  characterId: number
  input: StoryCharacterInput
}): Promise<StoryCharacter> {
  const response = await request<StoryCharacter>(`/api/story/characters/${payload.characterId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(payload.input),
  })
  return normalizeStoryCharacterPayload(response)
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

function normalizeStoryCharacterAvatarGenerationPayload(
  rawPayload: StoryCharacterAvatarGenerationPayload,
): StoryCharacterAvatarGenerationPayload {
  const payload = rawPayload as Partial<StoryCharacterAvatarGenerationPayload>
  return {
    model: typeof payload.model === 'string' ? payload.model : '',
    prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
    revised_prompt: typeof payload.revised_prompt === 'string' ? payload.revised_prompt : null,
    image_url: typeof payload.image_url === 'string' ? payload.image_url : null,
    image_data_url: typeof payload.image_data_url === 'string' ? payload.image_data_url : null,
    user: payload.user,
  }
}

function normalizeStoryCharacterEmotionGenerationPayload(
  rawPayload: StoryCharacterEmotionGenerationPayload,
): StoryCharacterEmotionGenerationPayload {
  const payload = rawPayload as Partial<StoryCharacterEmotionGenerationPayload>
  return {
    model: typeof payload.model === 'string' ? payload.model : '',
    avatar_prompt: typeof payload.avatar_prompt === 'string' ? payload.avatar_prompt : '',
    emotion_prompt_lock: typeof payload.emotion_prompt_lock === 'string' ? payload.emotion_prompt_lock : null,
    reference_image_url: typeof payload.reference_image_url === 'string' ? payload.reference_image_url : null,
    reference_image_data_url: typeof payload.reference_image_data_url === 'string' ? payload.reference_image_data_url : null,
    emotion_assets: normalizeStoryCharacterEmotionAssets(payload.emotion_assets),
    user: payload.user,
  }
}

function normalizeStoryCharacterEmotionGenerationJobPayload(
  rawPayload: StoryCharacterEmotionGenerationJobPayload,
): StoryCharacterEmotionGenerationJobPayload {
  const payload = rawPayload as Partial<StoryCharacterEmotionGenerationJobPayload>
  const status =
    payload.status === 'queued' || payload.status === 'running' || payload.status === 'completed' || payload.status === 'failed'
      ? payload.status
      : 'failed'
  const currentEmotionId =
    typeof payload.current_emotion_id === 'string' &&
    STORY_CHARACTER_EMOTION_IDS.includes(payload.current_emotion_id as (typeof STORY_CHARACTER_EMOTION_IDS)[number])
      ? payload.current_emotion_id
      : null

  return {
    id: typeof payload.id === 'number' && Number.isFinite(payload.id) ? Math.trunc(payload.id) : 0,
    status,
    image_model: typeof payload.image_model === 'string' ? payload.image_model : '',
    completed_variants:
      typeof payload.completed_variants === 'number' && Number.isFinite(payload.completed_variants)
        ? Math.max(0, Math.trunc(payload.completed_variants))
        : 0,
    total_variants:
      typeof payload.total_variants === 'number' && Number.isFinite(payload.total_variants)
        ? Math.max(0, Math.trunc(payload.total_variants))
        : 0,
    current_emotion_id: currentEmotionId,
    error_detail: typeof payload.error_detail === 'string' ? payload.error_detail : null,
    result: payload.result ? normalizeStoryCharacterEmotionGenerationPayload(payload.result) : null,
    user: payload.user,
    created_at: typeof payload.created_at === 'string' ? payload.created_at : new Date(0).toISOString(),
    updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : new Date(0).toISOString(),
    started_at: typeof payload.started_at === 'string' ? payload.started_at : null,
    completed_at: typeof payload.completed_at === 'string' ? payload.completed_at : null,
  }
}

export async function generateStoryCharacterAvatar(payload: {
  token: string
  imageModel?: StoryImageModelId
  name?: string
  description?: string
  triggers?: string[]
  stylePrompt?: string
}): Promise<StoryCharacterAvatarGenerationPayload> {
  const response = await request<StoryCharacterAvatarGenerationPayload>('/api/story/characters/avatar/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      image_model: payload.imageModel ?? null,
      name: payload.name ?? null,
      description: payload.description ?? null,
      style_prompt: payload.stylePrompt ?? null,
      triggers: Array.isArray(payload.triggers)
        ? payload.triggers.filter((value): value is string => typeof value === 'string')
        : [],
    }),
  })
  return normalizeStoryCharacterAvatarGenerationPayload(response)
}

export async function generateStoryCharacterEmotionPack(payload: {
  token: string
  imageModel?: StoryImageModelId
  name?: string
  description?: string
  triggers?: string[]
  stylePrompt?: string
  referenceAvatarUrl?: string | null
  emotionIds?: StoryCharacterEmotionId[]
  pollTimeoutMs?: number
  pollIntervalMs?: number
  onProgress?: (job: StoryCharacterEmotionGenerationJobPayload) => void
}): Promise<StoryCharacterEmotionGenerationPayload> {
  const initialJobResponse = await request<StoryCharacterEmotionGenerationJobPayload>('/api/story/characters/emotions/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      image_model: payload.imageModel ?? null,
      name: payload.name ?? null,
      description: payload.description ?? null,
      style_prompt: payload.stylePrompt ?? null,
      triggers: Array.isArray(payload.triggers)
        ? payload.triggers.filter((value): value is string => typeof value === 'string')
        : [],
      reference_avatar_url: payload.referenceAvatarUrl ?? null,
      emotion_ids: Array.isArray(payload.emotionIds)
        ? payload.emotionIds.filter((value): value is StoryCharacterEmotionId => STORY_CHARACTER_EMOTION_IDS.includes(value))
        : [],
    }),
  })
  let job = normalizeStoryCharacterEmotionGenerationJobPayload(initialJobResponse)
  payload.onProgress?.(job)

  const timeoutMs =
    typeof payload.pollTimeoutMs === 'number' && Number.isFinite(payload.pollTimeoutMs)
      ? Math.max(5_000, Math.trunc(payload.pollTimeoutMs))
      : STORY_CHARACTER_EMOTION_GENERATION_TIMEOUT_MS
  const pollIntervalMs =
    typeof payload.pollIntervalMs === 'number' && Number.isFinite(payload.pollIntervalMs)
      ? Math.max(500, Math.trunc(payload.pollIntervalMs))
      : STORY_CHARACTER_EMOTION_GENERATION_POLL_INTERVAL_MS
  const startedAt = Date.now()

  while (true) {
    if (job.status === 'completed') {
      if (job.result) {
        return job.result
      }
      throw new Error('Emotion generation finished without a result payload')
    }

    if (job.status === 'failed') {
      throw new Error(job.error_detail?.trim() || 'Не удалось сгенерировать эмоции персонажа')
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Превышено ожидание генерации эмоций (10 минут)')
    }

    await delay(pollIntervalMs)
    const nextJobResponse = await request<StoryCharacterEmotionGenerationJobPayload>(
      `/api/story/characters/emotions/generate/${job.id}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${payload.token}`,
        },
      },
    )
    job = normalizeStoryCharacterEmotionGenerationJobPayload(nextJobResponse)
    payload.onProgress?.(job)
  }
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
  visibility?: StoryGameVisibility
}): Promise<StoryInstructionTemplate> {
  return request<StoryInstructionTemplate>('/api/story/instruction-templates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      visibility: payload.visibility ?? null,
    }),
  })
}

export async function updateStoryInstructionTemplate(payload: {
  token: string
  templateId: number
  title: string
  content: string
  visibility?: StoryGameVisibility
}): Promise<StoryInstructionTemplate> {
  return request<StoryInstructionTemplate>(`/api/story/instruction-templates/${payload.templateId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
      visibility: payload.visibility ?? null,
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
  show_gg_thoughts?: boolean
  show_npc_thoughts?: boolean
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
      show_gg_thoughts: payload.show_gg_thoughts ?? null,
      show_npc_thoughts: payload.show_npc_thoughts ?? null,
      ambient_enabled: payload.ambient_enabled ?? null,
    }),
  })
}

export async function createQuickStartStoryGame(payload: {
  token: string
  genre: string
  hero_class: string
  protagonist_name: string
  start_mode: 'calm' | 'action'
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>('/api/story/games/quick-start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      genre: payload.genre,
      hero_class: payload.hero_class,
      protagonist_name: payload.protagonist_name,
      start_mode: payload.start_mode,
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
  assistantTurnsLimit?: number
  beforeMessageId?: number | null
}): Promise<StoryGamePayload> {
  const queryParams = new URLSearchParams()
  if (typeof payload.assistantTurnsLimit === 'number' && Number.isFinite(payload.assistantTurnsLimit)) {
    queryParams.set('assistant_turns_limit', String(Math.max(1, Math.trunc(payload.assistantTurnsLimit))))
  }
  if (typeof payload.beforeMessageId === 'number' && Number.isFinite(payload.beforeMessageId) && payload.beforeMessageId > 0) {
    queryParams.set('before_message_id', String(Math.max(1, Math.trunc(payload.beforeMessageId))))
  }
  const queryString = queryParams.toString()
  const path = queryString ? `/api/story/games/${payload.gameId}?${queryString}` : `/api/story/games/${payload.gameId}`
  const response = await request<StoryGamePayload>(path, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
  return normalizeStoryGamePayload(response)
}

export async function createStoryBugReport(payload: {
  token: string
  gameId: number
  title: string
  description: string
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/bug-reports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      description: payload.description,
    }),
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
  memoryOptimizationMode?: StoryMemoryOptimizationMode
  storyRepetitionPenalty?: number
  storyTopK?: number
  storyTopR?: number
  storyTemperature?: number
  showGgThoughts?: boolean
  showNpcThoughts?: boolean
  ambientEnabled?: boolean
  characterStateEnabled?: boolean
  emotionVisualizationEnabled?: boolean
  canonicalStatePipelineEnabled?: boolean
  canonicalStateSafeFallbackEnabled?: boolean
  environmentEnabled?: boolean
  environmentTimeEnabled?: boolean
  environmentWeatherEnabled?: boolean
  environmentCurrentDatetime?: string | null
  environmentCurrentWeather?: Record<string, unknown> | null
  environmentTomorrowWeather?: Record<string, unknown> | null
  currentLocationLabel?: string | null
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
  if (typeof payload.memoryOptimizationMode === 'string') {
    requestPayload.memory_optimization_mode = payload.memoryOptimizationMode
  }
  if (typeof payload.storyRepetitionPenalty === 'number') {
    requestPayload.story_repetition_penalty = payload.storyRepetitionPenalty
  }
  if (typeof payload.storyTopK === 'number') {
    requestPayload.story_top_k = payload.storyTopK
  }
  if (typeof payload.storyTopR === 'number') {
    requestPayload.story_top_r = payload.storyTopR
  }
  if (typeof payload.storyTemperature === 'number') {
    requestPayload.story_temperature = payload.storyTemperature
  }
  if (typeof payload.showGgThoughts === 'boolean') {
    requestPayload.show_gg_thoughts = payload.showGgThoughts
  }
  if (typeof payload.showNpcThoughts === 'boolean') {
    requestPayload.show_npc_thoughts = payload.showNpcThoughts
  }
  if (typeof payload.ambientEnabled === 'boolean') {
    requestPayload.ambient_enabled = payload.ambientEnabled
  }
  if (typeof payload.characterStateEnabled === 'boolean') {
    requestPayload.character_state_enabled = payload.characterStateEnabled
  }
  if (typeof payload.emotionVisualizationEnabled === 'boolean') {
    requestPayload.emotion_visualization_enabled = payload.emotionVisualizationEnabled
  }
  if (typeof payload.canonicalStatePipelineEnabled === 'boolean') {
    requestPayload.canonical_state_pipeline_enabled = payload.canonicalStatePipelineEnabled
  }
  if (typeof payload.canonicalStateSafeFallbackEnabled === 'boolean') {
    requestPayload.canonical_state_safe_fallback_enabled = payload.canonicalStateSafeFallbackEnabled
  }
  if (typeof payload.environmentEnabled === 'boolean') {
    requestPayload.environment_enabled = payload.environmentEnabled
  }
  if (typeof payload.environmentTimeEnabled === 'boolean') {
    requestPayload.environment_time_enabled = payload.environmentTimeEnabled
  }
  if (typeof payload.environmentWeatherEnabled === 'boolean') {
    requestPayload.environment_weather_enabled = payload.environmentWeatherEnabled
  }
  if (typeof payload.environmentCurrentDatetime === 'string' || payload.environmentCurrentDatetime === null) {
    requestPayload.environment_current_datetime = payload.environmentCurrentDatetime
  }
  if (payload.environmentCurrentWeather !== undefined) {
    requestPayload.environment_current_weather = payload.environmentCurrentWeather
  }
  if (payload.environmentTomorrowWeather !== undefined) {
    requestPayload.environment_tomorrow_weather = payload.environmentTomorrowWeather
  }
  if (typeof payload.currentLocationLabel === 'string' || payload.currentLocationLabel === null) {
    requestPayload.current_location_label = payload.currentLocationLabel
  }
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(requestPayload),
  })
}

export async function regenerateStoryEnvironmentWeather(payload: {
  token: string
  gameId: number
}): Promise<StoryGameSummary> {
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/environment/regenerate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
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
  const requestPayload: Record<string, unknown> = {}
  if (payload.title !== undefined) {
    requestPayload.title = payload.title
  }
  if (payload.description !== undefined) {
    requestPayload.description = payload.description
  }
  if (payload.opening_scene !== undefined) {
    requestPayload.opening_scene = payload.opening_scene
  }
  if (payload.visibility !== undefined) {
    requestPayload.visibility = payload.visibility
  }
  if (payload.age_rating !== undefined) {
    requestPayload.age_rating = payload.age_rating
  }
  if (payload.genres !== undefined) {
    requestPayload.genres = payload.genres
  }
  if (payload.cover_image_url !== undefined) {
    requestPayload.cover_image_url = payload.cover_image_url
  }
  if (payload.cover_scale !== undefined) {
    requestPayload.cover_scale = payload.cover_scale
  }
  if (payload.cover_position_x !== undefined) {
    requestPayload.cover_position_x = payload.cover_position_x
  }
  if (payload.cover_position_y !== undefined) {
    requestPayload.cover_position_y = payload.cover_position_y
  }
  return request<StoryGameSummary>(`/api/story/games/${payload.gameId}/meta`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(requestPayload),
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

export async function optimizeStoryMemory(payload: {
  token: string
  gameId: number
  messageId?: number | null
  maxAssistantMessages?: number
}): Promise<StoryMemoryBlock[]> {
  return request<StoryMemoryBlock[]>(`/api/story/games/${payload.gameId}/memory/optimize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      message_id: typeof payload.messageId === 'number' ? payload.messageId : undefined,
      max_assistant_messages:
        typeof payload.maxAssistantMessages === 'number' ? payload.maxAssistantMessages : undefined,
    }),
  })
}

export async function refreshStoryMessageSceneEmotionCue(payload: {
  token: string
  gameId: number
  messageId: number
}): Promise<StoryMessage> {
  return request<StoryMessage>(`/api/story/games/${payload.gameId}/messages/${payload.messageId}/scene-emotion/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
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
  if (options.smartRegeneration) {
    requestPayload.smart_regeneration = {
      enabled: Boolean(options.smartRegeneration.enabled),
      mode: options.smartRegeneration.mode,
      options: options.smartRegeneration.options,
    }
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
  if (typeof options.storyRepetitionPenalty === 'number') {
    requestPayload.story_repetition_penalty = options.storyRepetitionPenalty
  }
  if (typeof options.storyTopK === 'number') {
    requestPayload.story_top_k = options.storyTopK
  }
  if (typeof options.storyTopR === 'number') {
    requestPayload.story_top_r = options.storyTopR
  }
  if (typeof options.storyTemperature === 'number') {
    requestPayload.story_temperature = options.storyTemperature
  }
  if (typeof options.showGgThoughts === 'boolean') {
    requestPayload.show_gg_thoughts = options.showGgThoughts
  }
  if (typeof options.showNpcThoughts === 'boolean') {
    requestPayload.show_npc_thoughts = options.showNpcThoughts
  }
  if (typeof options.ambientEnabled === 'boolean') {
    requestPayload.ambient_enabled = options.ambientEnabled
  }
  if (typeof options.environmentEnabled === 'boolean') {
    requestPayload.environment_enabled = options.environmentEnabled
  }
  if (typeof options.emotionVisualizationEnabled === 'boolean') {
    requestPayload.emotion_visualization_enabled = options.emotionVisualizationEnabled
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
    const parsedError = await parseApiError(response)
    throw new Error(normalizeStoryProviderErrorMessage(parsedError.message))
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

  const processBufferedBlocks = (allowTrailingBlock: boolean) => {
    buffer = buffer.replace(/\r\n/g, '\n')
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      processBlock(rawBlock)
      if (streamTerminalEventReceived) {
        return
      }
      separatorIndex = buffer.indexOf('\n\n')
    }

    if (!allowTrailingBlock || streamTerminalEventReceived) {
      return
    }
    const trailingBlock = buffer.trim()
    if (!trailingBlock) {
      buffer = ''
      return
    }
    buffer = ''
    processBlock(trailingBlock)
  }

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

    if (parsed.event === 'plot_memory') {
      try {
        const payload = JSON.parse(parsed.data) as StoryStreamPlotMemoryPayload
        options.onPlotMemory?.(payload)
      } catch (error) {
        streamError = toStreamError(error, 'Failed to process generation plot memory event')
        streamTerminalEventReceived = true
      }
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
      streamError = new Error(normalizeStoryProviderErrorMessage(detail))
      streamTerminalEventReceived = true
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    processBufferedBlocks(false)
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
    processBufferedBlocks(true)
  }

  if (!streamTerminalEventReceived && !streamError) {
    throw new Error('Generation stream ended unexpectedly before terminal event')
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
  triggers?: string[]
  memory_turns?: number | null
  is_enabled?: boolean
}): Promise<StoryPlotCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers ?? [],
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  if (payload.is_enabled !== undefined) {
    body.is_enabled = payload.is_enabled
  }
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function updateStoryPlotCard(payload: {
  token: string
  gameId: number
  cardId: number
  title: string
  content: string
  triggers?: string[]
  memory_turns?: number | null
  is_enabled?: boolean
}): Promise<StoryPlotCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    triggers: payload.triggers ?? [],
  }
  if (payload.memory_turns !== undefined) {
    body.memory_turns = payload.memory_turns
  }
  if (payload.is_enabled !== undefined) {
    body.is_enabled = payload.is_enabled
  }
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function updateStoryPlotCardAiEdit(payload: {
  token: string
  gameId: number
  cardId: number
  ai_edit_enabled: boolean
}): Promise<StoryPlotCard> {
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}/ai-edit`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      ai_edit_enabled: payload.ai_edit_enabled,
    }),
  })
}

export async function updateStoryPlotCardEnabled(payload: {
  token: string
  gameId: number
  cardId: number
  is_enabled: boolean
}): Promise<StoryPlotCard> {
  return request<StoryPlotCard>(`/api/story/games/${payload.gameId}/plot-cards/${payload.cardId}/enabled`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      is_enabled: payload.is_enabled,
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

export async function createStoryMemoryBlock(payload: {
  token: string
  gameId: number
  title: string
  content: string
}): Promise<StoryMemoryBlock> {
  return request<StoryMemoryBlock>(`/api/story/games/${payload.gameId}/memory-blocks`, {
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

export async function updateStoryMemoryBlock(payload: {
  token: string
  gameId: number
  blockId: number
  title: string
  content: string
}): Promise<StoryMemoryBlock> {
  return request<StoryMemoryBlock>(`/api/story/games/${payload.gameId}/memory-blocks/${payload.blockId}`, {
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

export async function deleteStoryMemoryBlock(payload: {
  token: string
  gameId: number
  blockId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/memory-blocks/${payload.blockId}`, {
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
  race?: string
  clothing?: string
  inventory?: string
  health_status?: string
  triggers: string[]
  kind?: 'world' | 'world_profile' | 'npc' | 'main_hero'
  detail_type?: string
  avatar_url?: string | null
  avatar_original_url?: string | null
  avatar_scale?: number
  character_id?: number | null
  memory_turns?: number | null
}): Promise<StoryWorldCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    race: payload.race ?? '',
    clothing: payload.clothing ?? '',
    inventory: payload.inventory ?? '',
    health_status: payload.health_status ?? '',
    triggers: payload.triggers,
    kind: payload.kind ?? 'world',
    detail_type: payload.detail_type ?? '',
    avatar_url: payload.avatar_url ?? null,
    avatar_original_url: payload.avatar_original_url ?? null,
    avatar_scale: payload.avatar_scale ?? null,
  }
  if (payload.character_id !== undefined) {
    body.character_id = payload.character_id
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
  avatar_original_url?: string | null
  avatar_scale?: number
}): Promise<StoryWorldCard> {
  return request<StoryWorldCard>(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}/avatar`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      avatar_url: payload.avatar_url,
      avatar_original_url: payload.avatar_original_url ?? null,
      avatar_scale: payload.avatar_scale ?? null,
    }),
  })
}

export async function updateStoryInstructionCardActive(payload: {
  token: string
  gameId: number
  instructionId: number
  is_active: boolean
}): Promise<StoryInstructionCard> {
  return request<StoryInstructionCard>(`/api/story/games/${payload.gameId}/instructions/${payload.instructionId}/active`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
    body: JSON.stringify({
      is_active: payload.is_active,
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
  race?: string
  clothing?: string
  inventory?: string
  health_status?: string
  triggers: string[]
  detail_type?: string
  character_id?: number | null
  memory_turns?: number | null
}): Promise<StoryWorldCard> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    race: payload.race ?? '',
    clothing: payload.clothing ?? '',
    inventory: payload.inventory ?? '',
    health_status: payload.health_status ?? '',
    triggers: payload.triggers,
    detail_type: payload.detail_type ?? '',
  }
  if (payload.character_id !== undefined) {
    body.character_id = payload.character_id
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
  allowMainHeroDelete?: boolean
}): Promise<void> {
  const search = payload.allowMainHeroDelete ? '?allow_main_hero_delete=1' : ''
  return requestNoContent(`/api/story/games/${payload.gameId}/world-cards/${payload.cardId}${search}`, {
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

export async function undoStoryAssistantStep(payload: {
  token: string
  gameId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/assistant-step/undo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.token}`,
    },
  })
}

export async function redoStoryAssistantStep(payload: {
  token: string
  gameId: number
}): Promise<void> {
  return requestNoContent(`/api/story/games/${payload.gameId}/assistant-step/redo`, {
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
