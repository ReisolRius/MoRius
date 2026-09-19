import { useCallback, useEffect, useState } from 'react'
import {
  getOnboardingGuideState,
  updateOnboardingGuideState,
  type OnboardingGuideState,
} from '../../services/authApi'
import { readExperienceMode, writeExperienceMode, type ExperienceMode } from '../../utils/experienceMode'
import ExperienceLevelDialog from './ExperienceLevelDialog'
import StarterTour from './StarterTour'

type PlayerOnboardingProps = {
  userId: number
  authToken: string
  path: string
  onNavigate: (path: string) => void
}

/** Where a first-time player is allowed to be interrupted: the pages the tour actually walks. */
const WELCOME_PATHS = new Set(['/dashboard', '/profile', '/games', '/games/all', '/games/publications'])

function normalizePathname(value: string): string {
  const normalized = value.replace(/\/+$/, '').toLowerCase()
  return normalized || '/'
}

/**
 * Asks the level question once per player, then - for a novice - runs the starter tour.
 *
 * Both answers live in the server-side onboarding blob, which is what makes "exactly once" hold
 * across devices and across a guest turning into a real account. The chosen mode is also mirrored
 * into localStorage the moment it is picked, so the game screen can decide what to render on its
 * first paint instead of flashing the advanced panel.
 */
function PlayerOnboarding({ userId, authToken, path, onNavigate }: PlayerOnboardingProps) {
  const [remoteState, setRemoteState] = useState<OnboardingGuideState | null>(null)
  const [isSavingLevel, setIsSavingLevel] = useState(false)
  const [isTourRunning, setIsTourRunning] = useState(false)

  // One read on mount: it seeds the local mirror and tells us whether anything is still pending.
  useEffect(() => {
    let isCancelled = false

    getOnboardingGuideState(authToken)
      .then((nextState) => {
        if (isCancelled) {
          return
        }
        if (nextState.experience_level) {
          // The server is the source of truth once it has an answer.
          writeExperienceMode(userId, nextState.experience_level)
          setRemoteState(nextState)
          return
        }

        // No answer on the server. A browser that still remembers one answered before this
        // field existed - hand it back up rather than asking the same question twice.
        const mirroredMode = readExperienceMode(userId)
        if (mirroredMode) {
          setRemoteState({ ...nextState, experience_level: mirroredMode })
          void updateOnboardingGuideState(authToken, { experience_level: mirroredMode }).catch(() => undefined)
          return
        }
        setRemoteState(nextState)
      })
      .catch(() => {
        if (isCancelled) {
          return
        }
        // Offline or a failing endpoint must not trap the player behind a modal they cannot
        // dismiss; `remoteState` stays null, so the question simply waits for the next visit.
        setRemoteState(null)
      })

    return () => {
      isCancelled = true
    }
  }, [authToken, userId])

  const patchRemoteState = useCallback(
    async (payload: Partial<OnboardingGuideState>) => {
      try {
        const nextState = await updateOnboardingGuideState(authToken, payload)
        setRemoteState(nextState)
        return nextState
      } catch {
        // Keep the optimistic local state; the next successful patch reconciles it.
        setRemoteState((previous) => (previous ? { ...previous, ...payload } : previous))
        return null
      }
    },
    [authToken],
  )

  const handleChooseLevel = useCallback(
    (mode: ExperienceMode) => {
      setIsSavingLevel(true)
      // Apply locally first: the game screen and the settings dialog react immediately, even if
      // the request is slow.
      writeExperienceMode(userId, mode)
      // The tour belongs to the first-run flow. Settling its status here too means a player who
      // says "I know my way around" and later switches to the simple mode in the settings is not
      // ambushed by a walkthrough on their next reload.
      const starterTourStatus = mode === 'novice' ? 'pending' : 'skipped'
      setRemoteState((previous) =>
        previous ? { ...previous, experience_level: mode, starter_tour_status: starterTourStatus } : previous,
      )

      void patchRemoteState({ experience_level: mode, starter_tour_status: starterTourStatus }).finally(() => {
        setIsSavingLevel(false)
        if (mode === 'novice') {
          if (normalizePathname(path) !== '/dashboard') {
            onNavigate('/dashboard')
          }
          setIsTourRunning(true)
        }
      })
    },
    [onNavigate, patchRemoteState, path, userId],
  )

  const handleFinishTour = useCallback(
    (status: 'completed' | 'skipped') => {
      setIsTourRunning(false)
      setRemoteState((previous) => (previous ? { ...previous, starter_tour_status: status } : previous))
      void patchRemoteState({ starter_tour_status: status })
    },
    [patchRemoteState],
  )

  // A novice who closed the tab mid-tour gets it offered again on the home page, once.
  useEffect(() => {
    if (!remoteState || isTourRunning) {
      return
    }
    if (remoteState.experience_level !== 'novice' || remoteState.starter_tour_status !== 'pending') {
      return
    }
    if (normalizePathname(path) !== '/dashboard') {
      return
    }
    setIsTourRunning(true)
  }, [isTourRunning, path, remoteState])

  const isOnWelcomePath = WELCOME_PATHS.has(normalizePathname(path))
  // `remoteState` is only set once the server has answered, so this is also the "hydrated" gate.
  const shouldAskLevel =
    Boolean(remoteState) &&
    remoteState?.experience_level === null &&
    readExperienceMode(userId) === null &&
    isOnWelcomePath

  return (
    <>
      <ExperienceLevelDialog open={shouldAskLevel} isSaving={isSavingLevel} onChoose={handleChooseLevel} />
      {isTourRunning && !shouldAskLevel ? (
        <StarterTour path={path} onNavigate={onNavigate} onFinish={handleFinishTour} />
      ) : null}
    </>
  )
}

export default PlayerOnboarding
