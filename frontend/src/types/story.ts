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

export type StoryGamePayload = {
  game: StoryGameSummary
  messages: StoryMessage[]
  instruction_cards: StoryInstructionCard[]
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
}
