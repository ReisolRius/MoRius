const CUSTOM_STORY_TITLES_KEY = 'morius.story.custom.titles'

export const DEFAULT_STORY_TITLE = '\u041d\u043e\u0432\u0430\u044f \u0438\u0433\u0440\u0430'

export type StoryTitleMap = Record<number, string>

export function sanitizeStoryTitle(title: string): string {
  return title
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:\s*[·•\-–—]\s*ход\s+\d+\s*)+$/giu, '')
    .trim()
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

export function getDisplayStoryTitle(gameId: number | null, map: StoryTitleMap): string {
  if (!gameId) {
    return DEFAULT_STORY_TITLE
  }

  return sanitizeStoryTitle(map[gameId] ?? '') || DEFAULT_STORY_TITLE
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
