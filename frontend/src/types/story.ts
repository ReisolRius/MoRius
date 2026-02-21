export type StoryRole = 'user' | 'assistant'
export type StoryGameVisibility = 'private' | 'public'

export type StoryGameSummary = {
  id: number
  title: string
  description: string
  visibility: StoryGameVisibility
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
  last_activity_at: string
  created_at: string
  updated_at: string
}

export type StoryMessage = {
  id: number
  game_id: number
  role: StoryRole
  content: string
  created_at: string
  updated_at: string
}

export type StoryInstructionCard = {
  id: number
  game_id: number
  title: string
  content: string
  created_at: string
  updated_at: string
}

export type StoryPlotCardSource = 'user' | 'ai'

export type StoryPlotCard = {
  id: number
  game_id: number
  title: string
  content: string
  source: StoryPlotCardSource
  created_at: string
  updated_at: string
}

export type StoryPlotCardEventAction = 'added' | 'updated' | 'deleted'

export type StoryPlotCardSnapshot = {
  id: number | null
  title: string
  content: string
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

export type StoryWorldCardSource = 'user' | 'ai'
export type StoryWorldCardKind = 'world' | 'npc' | 'main_hero'

export type StoryWorldCard = {
  id: number
  game_id: number
  title: string
  content: string
  triggers: string[]
  kind: StoryWorldCardKind
  avatar_url: string | null
  avatar_scale: number
  character_id: number | null
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
  triggers: string[]
  kind: StoryWorldCardKind
  avatar_url: string | null
  avatar_scale: number
  character_id: number | null
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
  triggers: string[]
  avatar_url: string | null
  avatar_scale: number
  source: StoryCharacterSource
  created_at: string
  updated_at: string
}

export type StoryGamePayload = {
  game: StoryGameSummary
  messages: StoryMessage[]
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  plot_card_events: StoryPlotCardEvent[]
  world_cards: StoryWorldCard[]
  world_card_events: StoryWorldCardEvent[]
}

export type StoryCommunityWorldSummary = {
  id: number
  title: string
  description: string
  author_name: string
  cover_image_url: string | null
  cover_scale: number
  cover_position_x: number
  cover_position_y: number
  community_views: number
  community_launches: number
  community_rating_avg: number
  community_rating_count: number
  user_rating: number | null
  created_at: string
  updated_at: string
}

export type StoryCommunityWorldPayload = {
  world: StoryCommunityWorldSummary
  context_limit_chars: number
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  world_cards: StoryWorldCard[]
}

export type StoryStreamStartPayload = {
  assistant_message_id: number
  user_message_id: number | null
}

export type StoryStreamChunkPayload = {
  assistant_message_id: number
  delta: string
}

export type StoryStreamDonePayload = {
  message: StoryMessage
  world_card_events?: StoryWorldCardEvent[]
  plot_card_events?: StoryPlotCardEvent[]
  plot_card_created?: boolean
}
