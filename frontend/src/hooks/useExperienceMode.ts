import { useCallback, useSyncExternalStore } from 'react'
import {
  isSimpleExperience,
  readExperienceMode,
  subscribeToExperienceMode,
  type ExperienceMode,
} from '../utils/experienceMode'

type UseExperienceModeResult = {
  /** `null` while the welcome question is still unanswered. */
  mode: ExperienceMode | null
  /** The one flag screens branch on: hide the advanced controls. */
  isSimpleMode: boolean
}

/**
 * Reads the player's chosen mode without a round trip, and re-renders whenever it changes -
 * including when the change came from another screen (the settings dialog, the welcome dialog).
 */
function useExperienceMode(userId: number | null | undefined): UseExperienceModeResult {
  const getSnapshot = useCallback(() => readExperienceMode(userId), [userId])
  const mode = useSyncExternalStore(subscribeToExperienceMode, getSnapshot, getSnapshot)

  return { mode, isSimpleMode: isSimpleExperience(mode) }
}

export default useExperienceMode
