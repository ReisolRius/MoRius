import type { StoryGameSummary } from '../types/story'

function parseStoryGameTimestamp(rawValue: string | null | undefined): number {
  const parsed = Date.parse(rawValue ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function getStoryGameActivityTimestamp(game: StoryGameSummary): number {
  return Math.max(
    parseStoryGameTimestamp(game.last_activity_at),
    parseStoryGameTimestamp(game.updated_at),
    parseStoryGameTimestamp(game.created_at),
  )
}

export function sortStoryGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort((left, right) => getStoryGameActivityTimestamp(right) - getStoryGameActivityTimestamp(left))
}

export function selectLastPlayedGame(games: StoryGameSummary[]): StoryGameSummary | null {
  if (games.length === 0) {
    return null
  }
  return sortStoryGamesByActivity(games)[0] ?? null
}
