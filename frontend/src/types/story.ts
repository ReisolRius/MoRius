import type { AuthUser } from './auth'

export type StoryRole = 'user' | 'assistant'
export type StoryGameVisibility = 'private' | 'public'
export type StoryPublicationStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type StoryPublicationState = {
  status: StoryPublicationStatus
  requested_at: string | null
  reviewed_at: string | null
  reviewer_user_id: number | null
  rejection_reason: string | null
}
export type StoryNarratorModelId =
  | 'z-ai/glm-5'
  | 'z-ai/glm-5.1'
  | 'z-ai/glm-4.7'
  | 'deepseek/deepseek-v3.2'
  | 'x-ai/grok-4.1-fast'
  | 'mistralai/mistral-nemo'
  | 'xiaomi/mimo-v2-flash'
  | 'xiaomi/mimo-v2-pro'
  | 'aion-labs/aion-2.0'
export type StoryMemoryOptimizationMode = 'standard' | 'enhanced' | 'maximum'
export type StoryImageModelId =
  | 'black-forest-labs/flux.2-pro'
  | 'bytedance-seed/seedream-4.5'
  | 'google/gemini-2.5-flash-image'
  | 'google/gemini-3.1-flash-image-preview'
  | 'grok-imagine-image'
  | 'grok-imagine-image-pro'
export type StoryCharacterEmotionId =
  | 'calm'
  | 'angry'
  | 'irritated'
  | 'stern'
  | 'cheerful'
  | 'smiling'
  | 'sly'
  | 'alert'
  | 'scared'
  | 'happy'
  | 'embarrassed'
  | 'confused'
  | 'thoughtful'
export type StoryCharacterEmotionAssets = Partial<Record<StoryCharacterEmotionId, string>>
export type StoryCharacterEmotionGenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type StorySceneEmotionCueParticipant = {
  name: string
  emotion: StoryCharacterEmotionId
  importance: 'primary' | 'secondary'
}
export type StorySceneEmotionCue = {
  show_visualization: boolean
  reason: string
  participants: StorySceneEmotionCueParticipant[]
}

export type StoryGameSummary = {
  id: number
  title: string
  description: string
  latest_message_preview?: string | null
  turn_count: number
  opening_scene: string
  visibility: StoryGameVisibility
  publication: StoryPublicationState
  age_rating: '6+' | '16+' | '18+'
  genres: string[]
  cover_image_url: string | null
  cover_scale: number
  cover_position_x: number
  cover_position_y: number
  source_world_id: number | null
  community_views: number
  community_launches: number
  community_rating_avg: number
  community_rating_count: number
  context_limit_chars: number
  response_max_tokens: number
  response_max_tokens_enabled: boolean
  story_llm_model: StoryNarratorModelId
  image_model: StoryImageModelId
  image_style_prompt: string
  memory_optimization_enabled: boolean
  memory_optimization_mode: StoryMemoryOptimizationMode
  story_repetition_penalty: number
  story_top_k: number
  story_top_r: number
  story_temperature: number
  show_gg_thoughts: boolean
  show_npc_thoughts: boolean
  ambient_enabled: boolean
  character_state_enabled: boolean
  environment_enabled?: boolean
  ambient_profile: StoryAmbientProfile | null
  environment_current_datetime?: string | null
  environment_current_weather?: Record<string, unknown> | null
  environment_tomorrow_weather?: Record<string, unknown> | null
  current_location_label?: string | null
  emotion_visualization_enabled?: boolean
  last_activity_at: string
  created_at: string
  updated_at: string
}

export type StoryMessage = {
  id: number
  game_id: number
  role: StoryRole
  content: string
  scene_emotion_payload?: string | null
  created_at: string
  updated_at: string
}

export type StoryInstructionCard = {
  id: number
  game_id: number
  title: string
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type StoryInstructionTemplate = {
  id: number
  user_id: number
  title: string
  content: string
  visibility: StoryGameVisibility
  publication: StoryPublicationState
  source_template_id: number | null
  community_rating_avg: number
  community_rating_count: number
  community_additions_count: number
  created_at: string
  updated_at: string
}

export type StoryPlotCardSource = 'user' | 'ai'

export type StoryPlotCard = {
  id: number
  game_id: number
  title: string
  content: string
  triggers: string[]
  memory_turns: number | null
  ai_edit_enabled: boolean
  is_enabled: boolean
  source: StoryPlotCardSource
  created_at: string
  updated_at: string
}

export type StoryPlotCardEventAction = 'added' | 'updated' | 'deleted'

export type StoryPlotCardSnapshot = {
  id: number | null
  title: string
  content: string
  triggers: string[]
  memory_turns: number | null
  ai_edit_enabled: boolean
  is_enabled: boolean
  source: StoryPlotCardSource
}

export type StoryPlotCardEvent = {
  id: number
  game_id: number
  assistant_message_id: number
  plot_card_id: number | null
  action: StoryPlotCardEventAction
  title: string
  changed_text: string
  before_snapshot: StoryPlotCardSnapshot | null
  after_snapshot: StoryPlotCardSnapshot | null
  created_at: string
}

export type StoryMemoryLayer = 'raw' | 'compressed' | 'super' | 'key' | 'location' | 'weather'

export type StoryMemoryBlock = {
  id: number
  game_id: number
  assistant_message_id: number | null
  layer: StoryMemoryLayer
  title: string
  content: string
  token_count: number
  created_at: string
  updated_at: string
}

export type StoryWorldCardSource = 'user' | 'ai'
export type StoryWorldCardKind = 'world' | 'npc' | 'main_hero'

export type StoryWorldCard = {
  id: number
  game_id: number
  title: string
  content: string
  race: string
  clothing: string
  inventory: string
  health_status: string
  triggers: string[]
  kind: StoryWorldCardKind
  avatar_url: string | null
  avatar_original_url?: string | null
  avatar_scale: number
  character_id: number | null
  memory_turns: number | null
  is_locked: boolean
  ai_edit_enabled: boolean
  source: StoryWorldCardSource
  created_at: string
  updated_at: string
}

export type StoryWorldCardEventAction = 'added' | 'updated' | 'deleted'

export type StoryWorldCardSnapshot = {
  id: number | null
  title: string
  content: string
  race: string
  clothing: string
  inventory: string
  health_status: string
  triggers: string[]
  kind: StoryWorldCardKind
  avatar_url: string | null
  avatar_original_url?: string | null
  avatar_scale: number
  character_id: number | null
  memory_turns: number | null
  is_locked: boolean
  ai_edit_enabled: boolean
  source: StoryWorldCardSource
}

export type StoryWorldCardEvent = {
  id: number
  game_id: number
  assistant_message_id: number
  world_card_id: number | null
  action: StoryWorldCardEventAction
  title: string
  changed_text: string
  before_snapshot: StoryWorldCardSnapshot | null
  after_snapshot: StoryWorldCardSnapshot | null
  created_at: string
}

export type StoryCharacterSource = 'user' | 'ai'

export type StoryCharacter = {
  id: number
  user_id: number
  name: string
  description: string
  race: string
  clothing: string
  inventory: string
  health_status: string
  note: string
  triggers: string[]
  avatar_url: string | null
  avatar_original_url?: string | null
  avatar_scale: number
  emotion_assets?: StoryCharacterEmotionAssets
  emotion_model?: string
  emotion_prompt_lock?: string | null
  source: StoryCharacterSource
  visibility: StoryGameVisibility
  publication: StoryPublicationState
  source_character_id: number | null
  community_rating_avg: number
  community_rating_count: number
  community_additions_count: number
  created_at: string
  updated_at: string
}

export type StoryCommunityCharacterSummary = {
  id: number
  name: string
  description: string
  race: string
  clothing: string
  inventory: string
  health_status: string
  note: string
  triggers: string[]
  avatar_url: string | null
  avatar_original_url?: string | null
  avatar_scale: number
  emotion_assets?: StoryCharacterEmotionAssets
  emotion_model?: string
  emotion_prompt_lock?: string | null
  visibility: StoryGameVisibility
  author_id: number
  author_name: string
  author_avatar_url: string | null
  community_rating_avg: number
  community_rating_count: number
  community_additions_count: number
  user_rating: number | null
  is_added_by_user: boolean
  is_reported_by_user: boolean
  created_at: string
  updated_at: string
}

export type StoryCharacterRace = {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export type StoryCommunityInstructionTemplateSummary = {
  id: number
  title: string
  content: string
  visibility: StoryGameVisibility
  author_id: number
  author_name: string
  author_avatar_url: string | null
  community_rating_avg: number
  community_rating_count: number
  community_additions_count: number
  user_rating: number | null
  is_added_by_user: boolean
  is_reported_by_user: boolean
  created_at: string
  updated_at: string
}

export type StoryGamePayload = {
  game: StoryGameSummary
  messages: StoryMessage[]
  has_older_messages?: boolean
  turn_images: StoryTurnImage[]
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  plot_card_events: StoryPlotCardEvent[]
  memory_blocks?: StoryMemoryBlock[]
  world_cards: StoryWorldCard[]
  world_card_events: StoryWorldCardEvent[]
  can_redo_assistant_step: boolean
}

export type StoryCommunityWorldSummary = {
  id: number
  title: string
  description: string
  author_id: number
  author_name: string
  author_avatar_url: string | null
  age_rating: '6+' | '16+' | '18+'
  genres: string[]
  cover_image_url: string | null
  cover_scale: number
  cover_position_x: number
  cover_position_y: number
  community_views: number
  community_launches: number
  community_rating_avg: number
  community_rating_count: number
  user_rating: number | null
  is_reported_by_user: boolean
  is_favorited_by_user: boolean
  created_at: string
  updated_at: string
}

export type StoryCommunityWorldComment = {
  id: number
  world_id: number
  parent_comment_id?: number | null
  user_id: number
  user_display_name: string
  user_avatar_url: string | null
  user_avatar_scale: number
  content: string
  created_at: string
  updated_at: string
}

export type StoryCommunityWorldPayload = {
  world: StoryCommunityWorldSummary
  context_limit_chars: number
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  world_cards: StoryWorldCard[]
  comments: StoryCommunityWorldComment[]
}

export type StoryStreamStartPayload = {
  assistant_message_id: number
  user_message_id: number | null
}

export type StoryStreamChunkPayload = {
  assistant_message_id: number
  delta: string
}

export type StoryAmbientProfile = {
  scene: string
  lighting: string
  primary_color: string
  secondary_color: string
  highlight_color: string
  glow_strength: number
  background_mix: number
  vignette_strength: number
}

export type StoryStreamDonePayload = {
  message: StoryMessage
  game?: StoryGameSummary
  user?: AuthUser
  turn_cost_tokens?: number
  world_card_events?: StoryWorldCardEvent[]
  plot_card_events?: StoryPlotCardEvent[]
  plot_cards?: StoryPlotCard[]
  ai_memory_blocks?: StoryMemoryBlock[]
  world_cards?: StoryWorldCard[]
  plot_card_created?: boolean
  ambient?: StoryAmbientProfile
  postprocess_pending?: boolean
}

export type StoryStreamPlotMemoryPayload = {
  assistant_message_id: number
  plot_card_events?: StoryPlotCardEvent[]
  plot_cards?: StoryPlotCard[]
  ai_memory_blocks?: StoryMemoryBlock[]
  plot_card_created?: boolean
}

export type StoryTurnImageGenerationPayload = {
  id: number
  assistant_message_id: number
  model: string
  prompt: string
  revised_prompt: string | null
  image_url: string | null
  image_data_url: string | null
  user?: AuthUser
}

export type StoryCharacterAvatarGenerationPayload = {
  model: string
  prompt: string
  revised_prompt: string | null
  image_url: string | null
  image_data_url: string | null
  user?: AuthUser
}

export type StoryCharacterEmotionGenerationPayload = {
  model: string
  avatar_prompt: string
  emotion_prompt_lock?: string | null
  reference_image_url: string | null
  reference_image_data_url: string | null
  emotion_assets: StoryCharacterEmotionAssets
  user?: AuthUser
}

export type StoryCharacterEmotionGenerationJobPayload = {
  id: number
  status: StoryCharacterEmotionGenerationJobStatus
  image_model: string
  completed_variants: number
  total_variants: number
  current_emotion_id?: StoryCharacterEmotionId | null
  error_detail?: string | null
  result?: StoryCharacterEmotionGenerationPayload | null
  user?: AuthUser
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
}

export type StoryTurnImage = {
  id: number
  assistant_message_id: number
  model: string
  prompt: string
  revised_prompt: string | null
  image_url: string | null
  image_data_url: string | null
  created_at: string
  updated_at: string
}
