import type { StoryImageModelId } from '../types/story'

export type StoryImageModelOption = {
  id: StoryImageModelId
  title: string
  cost: number
}

export const STORY_IMAGE_MODEL_OPTIONS_SHARED: StoryImageModelOption[] = [
  { id: 'google/gemini-2.5-flash-image', title: 'Nano Banano', cost: 9 },
  { id: 'google/gemini-3.1-flash-image-preview', title: 'Nano Banano 2', cost: 13 },
  { id: 'bytedance-seed/seedream-4.5', title: 'Seedream 4.5', cost: 20 },
]

export const DEFAULT_STORY_BACKGROUND_IMAGE_MODEL: StoryImageModelId = 'google/gemini-2.5-flash-image'
