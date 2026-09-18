import type { StoryImageModelId } from '../types/story'

export type StoryImageModelOption = {
  id: StoryImageModelId
  title: string
  cost: number
}

// Mirrors STORY_TURN_IMAGE_COST_BY_MODEL in backend/app/main.py.
export const STORY_IMAGE_MODEL_OPTIONS_SHARED: StoryImageModelOption[] = [
  { id: 'google/gemini-2.5-flash-image', title: 'Nano Banano', cost: 7 },
  { id: 'google/gemini-3.1-flash-image-preview', title: 'Nano Banano 2', cost: 13 },
]

export const DEFAULT_STORY_BACKGROUND_IMAGE_MODEL: StoryImageModelId = 'google/gemini-2.5-flash-image'
