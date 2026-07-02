const CUSTOM_STORY_TITLES_KEY = 'morius.story.custom.titles'

export const DEFAULT_STORY_TITLE = '\u041d\u043e\u0432\u0430\u044f \u0438\u0433\u0440\u0430'

export type StoryTitleMap = Record<number, string>

const STORY_TITLE_TURN_COUNTER_SUFFIX_PATTERN =
  /(?:\s*[\u00b7\u2022\-\u2013\u2014]\s*\u0445\u043e\u0434\s+\d+\s*)+$/giu
const STORY_TITLE_DANGLING_SEPARATOR_PATTERN = /\s*[\u00b7\u2022\-\u2013\u2014]\s*$/u

export function sanitizeStoryTitle(title: string): string {
  let normalized = title
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()

  let previousTitle = ''
  while (normalized && normalized !== previousTitle) {
    previousTitle = normalized
    normalized = normalized
      .replace(STORY_TITLE_TURN_COUNTER_SUFFIX_PATTERN, '')
      .replace(STORY_TITLE_DANGLING_SEPARATOR_PATTERN, '')
      .trim()
  }

  return normalized
}

export function loadStoryTitleMap(): StoryTitleMap {
  try {
    const raw = localStorage.getItem(CUSTOM_STORY_TITLES_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, string>
    const next: StoryTitleMap = {}

    for (const [key, value] of Object.entries(parsed)) {
      const gameId = Number.parseInt(key, 10)
      if (Number.isNaN(gameId) || gameId <= 0) {
        continue
      }

      const normalized = sanitizeStoryTitle(value)
      if (normalized) {
        next[gameId] = normalized
      }
    }

    return next
  } catch {
    return {}
  }
}

export function persistStoryTitleMap(map: StoryTitleMap): void {
  localStorage.setItem(CUSTOM_STORY_TITLES_KEY, JSON.stringify(map))
}

export function getDisplayStoryTitle(gameId: number | null, map: StoryTitleMap, fallbackTitle = ''): string {
  if (!gameId) {
    return DEFAULT_STORY_TITLE
  }

  return sanitizeStoryTitle(map[gameId] ?? fallbackTitle) || DEFAULT_STORY_TITLE
}

export function setStoryTitle(map: StoryTitleMap, gameId: number, title: string): StoryTitleMap {
  const normalized = sanitizeStoryTitle(title)
  const next = { ...map }

  if (!normalized || normalized === DEFAULT_STORY_TITLE) {
    delete next[gameId]
    return next
  }

  next[gameId] = normalized
  return next
}
