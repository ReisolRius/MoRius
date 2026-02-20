export type StoryRole = 'user' | 'assistant'

export type StoryGameSummary = {
  id: number
  title: string
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

export type StoryWorldCardSource = 'user' | 'ai'

export type StoryWorldCard = {
  id: number
  game_id: number
  title: string
  content: string
  triggers: string[]
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

export type StoryGamePayload = {
  game: StoryGameSummary
  messages: StoryMessage[]
  instruction_cards: StoryInstructionCard[]
  world_cards: StoryWorldCard[]
  world_card_events: StoryWorldCardEvent[]
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
}
