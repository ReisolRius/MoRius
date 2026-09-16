import { requestJson, resolveApiResourceUrl } from './httpClient'

export type LandingShowcase = {
  players: number
  worlds: number
  characters: number
  avatars: string[]
}

const EMPTY_SHOWCASE: LandingShowcase = { players: 0, worlds: 0, characters: 0, avatars: [] }

/**
 * Public counters and avatar pictures for the presentation page. It is the only call the page
 * makes, it needs no session, and a failure is never fatal: the page falls back to its own
 * copy rather than showing an error to a visitor who has not even signed up yet.
 */
export async function fetchLandingShowcase(signal?: AbortSignal): Promise<LandingShowcase> {
  try {
    const data = await requestJson<LandingShowcase>('/api/public/landing/showcase', { signal })
    return {
      players: Number(data?.players) || 0,
      worlds: Number(data?.worlds) || 0,
      characters: Number(data?.characters) || 0,
      avatars: Array.isArray(data?.avatars)
        ? data.avatars.map((url) => resolveApiResourceUrl(url)).filter((url): url is string => Boolean(url))
        : [],
    }
  } catch {
    return EMPTY_SHOWCASE
  }
}
