import type { StoryImageModelId } from '../types/story'

export type StoryImageModelOption = {
  id: StoryImageModelId
  title: string
  cost: number
}

export const STORY_IMAGE_MODEL_OPTIONS_SHARED: StoryImageModelOption[] = [
  { id: 'black-forest-labs/flux.2-klein-4b', title: 'Flux.2 Klein 4B', cost: 6 },
  { id: 'google/gemini-2.5-flash-image', title: 'Nano Banano', cost: 9 },
  { id: 'google/gemini-3.1-flash-image-preview', title: 'Nano Banano 2', cost: 13 },
  { id: 'black-forest-labs/flux.2-pro', title: 'Flux 2 Pro', cost: 18 },
  { id: 'bytedance-seed/seedream-4.5', title: 'Seedream 4.5', cost: 20 },
]

export const DEFAULT_STORY_BACKGROUND_IMAGE_MODEL: StoryImageModelId = 'black-forest-labs/flux.2-pro'
