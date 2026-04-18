import type { StoryWorldCardTemplate, StoryWorldDetailType } from '../types/story'

export const STORY_WORLD_BANNER_PREVIEW_WIDTH = 286
export const STORY_WORLD_BANNER_PREVIEW_HEIGHT = 182
export const STORY_WORLD_BANNER_ASPECT = STORY_WORLD_BANNER_PREVIEW_WIDTH / STORY_WORLD_BANNER_PREVIEW_HEIGHT

export const DEFAULT_WORLD_DETAIL_TYPE_OPTIONS = ['Место', 'Предмет', 'Заклинание', 'Моб'] as const

export function normalizeStoryWorldDetailTypeValue(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function parseStoryWorldTriggers(value: string, fallbackTitle = ''): string[] {
  const unique = new Set<string>()
  const pushValue = (rawValue: string) => {
    const normalizedValue = rawValue.replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim()
    if (!normalizedValue) {
      return
    }
    unique.add(normalizedValue)
  }

  value
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach(pushValue)

  pushValue(fallbackTitle)

  return Array.from(unique).slice(0, 40)
}

export function buildStoryWorldDetailTypeSuggestions(
  detailTypes: StoryWorldDetailType[],
  extraValues: Array<string | null | undefined> = [],
): string[] {
  const unique = new Set<string>()
  DEFAULT_WORLD_DETAIL_TYPE_OPTIONS.forEach((item) => unique.add(item))
  detailTypes.forEach((item) => {
    const normalizedValue = normalizeStoryWorldDetailTypeValue(item.name)
    if (normalizedValue) {
      unique.add(normalizedValue)
    }
  })
  extraValues.forEach((item) => {
    const normalizedValue = normalizeStoryWorldDetailTypeValue(item)
    if (normalizedValue) {
      unique.add(normalizedValue)
    }
  })
  return Array.from(unique)
}

export function getStoryWorldTemplateEyebrow(template: StoryWorldCardTemplate): string | null {
  if (template.kind === 'world_profile') {
    return 'Описание мира'
  }
  if (template.detail_type.trim()) {
    return template.detail_type.trim()
  }
  return template.triggers.length > 0 ? `Триггеры: ${template.triggers.join(', ')}` : 'Связано с миром'
}
