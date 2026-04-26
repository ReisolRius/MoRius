export const SMOOTH_STREAMING_STORAGE_KEY = 'morius.story.smooth_streaming.enabled'

type SmoothStreamingTextOptions = {
  enabled: boolean
  reducedMotion?: boolean
  onUpdate: (text: string) => void
}

export type SmoothStreamingTextController = {
  appendChunk: (chunk: string) => void
  appendFinalText: (text: string) => void
  finish: () => Promise<string>
  cancel: () => void
  getDisplayedText: () => string
  getTargetText: () => string
}

function splitText(value: string): string[] {
  return Array.from(value)
}

function resolveCatchUpSpeed(backlog: number): number {
  if (backlog > 4000) {
    return 900
  }
  if (backlog > 1500) {
    return 620
  }
  if (backlog > 600) {
    return 360
  }
  if (backlog > 160) {
    return 170
  }
  return 58
}

export function readSmoothStreamingPreference(): boolean {
  try {
    return localStorage.getItem(SMOOTH_STREAMING_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeSmoothStreamingPreference(enabled: boolean): void {
  try {
    localStorage.setItem(SMOOTH_STREAMING_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Keep the in-memory setting even if storage is unavailable.
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createSmoothStreamingTextController(
  options: SmoothStreamingTextOptions,
): SmoothStreamingTextController {
  const shouldAnimate = options.enabled && !options.reducedMotion && typeof window !== 'undefined'
  let targetChars: string[] = []
  let displayedChars: string[] = []
  let frameId: number | null = null
  let lastFrameTime = 0
  let charBudget = 0
  let cancelled = false
  let finishing = false
  let finishResolvers: Array<(text: string) => void> = []

  const getDisplayedText = () => displayedChars.join('')
  const getTargetText = () => targetChars.join('')

  const resolveFinishers = () => {
    if (!finishing || displayedChars.length < targetChars.length) {
      return
    }
    const text = getDisplayedText()
    const resolvers = finishResolvers
    finishResolvers = []
    finishing = false
    resolvers.forEach((resolve) => resolve(text))
  }

  const stopFrame = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
  }

  const flushToTarget = () => {
    stopFrame()
    displayedChars = [...targetChars]
    options.onUpdate(getDisplayedText())
    resolveFinishers()
  }

  const schedule = () => {
    if (!shouldAnimate || cancelled || frameId !== null || displayedChars.length >= targetChars.length) {
      resolveFinishers()
      return
    }
    frameId = window.requestAnimationFrame((timestamp) => {
      frameId = null
      if (cancelled) {
        return
      }
      const elapsedMs = lastFrameTime > 0 ? Math.max(12, Math.min(80, timestamp - lastFrameTime)) : 16
      lastFrameTime = timestamp
      const backlog = targetChars.length - displayedChars.length
      charBudget += (resolveCatchUpSpeed(backlog) * elapsedMs) / 1000
      const take = Math.max(1, Math.min(backlog, Math.floor(charBudget)))
      charBudget = Math.max(0, charBudget - take)
      displayedChars = targetChars.slice(0, displayedChars.length + take)
      options.onUpdate(getDisplayedText())
      if (displayedChars.length < targetChars.length) {
        schedule()
      } else {
        resolveFinishers()
      }
    })
  }

  const appendChunk = (chunk: string) => {
    if (cancelled) {
      return
    }
    const normalizedChunk = String(chunk ?? '')
    if (!normalizedChunk) {
      return
    }
    targetChars = targetChars.concat(splitText(normalizedChunk))
    if (!shouldAnimate) {
      displayedChars = [...targetChars]
      options.onUpdate(getDisplayedText())
      resolveFinishers()
      return
    }
    schedule()
  }

  const appendFinalText = (text: string) => {
    if (cancelled) {
      return
    }
    const finalText = String(text ?? '')
    const currentTarget = getTargetText()
    if (!finalText || finalText === currentTarget) {
      return
    }
    if (finalText.startsWith(currentTarget)) {
      appendChunk(finalText.slice(currentTarget.length))
      return
    }
    targetChars = splitText(finalText)
    if (displayedChars.length > targetChars.length || !finalText.startsWith(getDisplayedText())) {
      displayedChars = []
      charBudget = 0
    }
    if (!shouldAnimate) {
      flushToTarget()
      return
    }
    schedule()
  }

  return {
    appendChunk,
    appendFinalText,
    finish: () => {
      if (cancelled || displayedChars.length >= targetChars.length || !shouldAnimate) {
        flushToTarget()
        return Promise.resolve(getDisplayedText())
      }
      finishing = true
      schedule()
      return new Promise((resolve) => {
        finishResolvers.push(resolve)
      })
    },
    cancel: () => {
      cancelled = true
      stopFrame()
      finishResolvers.forEach((resolve) => resolve(getDisplayedText()))
      finishResolvers = []
    },
    getDisplayedText,
    getTargetText,
  }
}
