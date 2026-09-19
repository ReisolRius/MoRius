import type { PlayerExperienceLevel } from '../services/authApi'

/**
 * Two ways to play the same game.
 *
 * `novice` strips the game screen down to the handful of controls a first-time player needs and
 * pins everything else to a sensible default under the hood; `expert` is the full board. The
 * answer lives on the server (so it follows the player between devices and survives a guest
 * turning into an account), but the game screen has to decide what to render on its very first
 * paint - a round trip there would flash the advanced UI and then tear half of it away. So the
 * chosen mode is mirrored into localStorage per user and read synchronously from there, with the
 * server value overwriting the mirror as soon as it lands.
 */
export type ExperienceMode = PlayerExperienceLevel

export const EXPERIENCE_MODE_CHANGED_EVENT = 'morius:experience-mode:changed'

const STORAGE_KEY_PREFIX = 'morius.experience.mode.v1'

/** Mirrors localStorage so repeated reads during a render pass stay cheap and consistent. */
const memoryCache = new Map<number, ExperienceMode | null>()
const subscribers = new Set<() => void>()

function buildStorageKey(userId: number): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`
}

function isExperienceMode(value: unknown): value is ExperienceMode {
  return value === 'novice' || value === 'expert'
}

function notifySubscribers(): void {
  subscribers.forEach((listener) => {
    try {
      listener()
    } catch {
      // A broken listener must not stop the others from hearing about the change.
    }
  })
}

/** The mode this browser last saw for `userId`, or `null` when the question is unanswered. */
export function readExperienceMode(userId: number | null | undefined): ExperienceMode | null {
  if (!userId || !Number.isFinite(userId)) {
    return null
  }

  if (memoryCache.has(userId)) {
    return memoryCache.get(userId) ?? null
  }

  let stored: ExperienceMode | null = null
  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId))
    stored = isExperienceMode(raw) ? raw : null
  } catch {
    stored = null
  }

  memoryCache.set(userId, stored)
  return stored
}

/** Writes the mirror and wakes every mounted screen. Passing `null` forgets the answer. */
export function writeExperienceMode(userId: number | null | undefined, mode: ExperienceMode | null): void {
  if (!userId || !Number.isFinite(userId)) {
    return
  }

  if (memoryCache.get(userId) === mode && memoryCache.has(userId)) {
    return
  }

  memoryCache.set(userId, mode)
  try {
    if (mode) {
      window.localStorage.setItem(buildStorageKey(userId), mode)
    } else {
      window.localStorage.removeItem(buildStorageKey(userId))
    }
  } catch {
    // Private mode or a full quota: the in-memory value still drives this session.
  }

  notifySubscribers()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EXPERIENCE_MODE_CHANGED_EVENT, { detail: { userId, mode } }))
  }
}

export function subscribeToExperienceMode(listener: () => void): () => void {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}

/**
 * Whether the stripped-down game screen is in force. An unanswered question reads as `false`:
 * showing everything and then hiding it is jarring, hiding nothing and then hiding it is not.
 */
export function isSimpleExperience(mode: ExperienceMode | null): boolean {
  return mode === 'novice'
}
