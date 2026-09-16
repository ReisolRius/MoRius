import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'

/**
 * Pages hand the header their account cluster (daily rewards + avatar) as `rightActions`.
 * The redesigned header needs its own controls woven into that cluster — search first,
 * the assistant beside the daily rewards, "Играть" right before the avatar — so it exposes
 * them here and HeaderAccountActions lays them out. While no account cluster has registered,
 * the header keeps rendering the controls on its own.
 */
export type AppHeaderSlots = {
  search: ReactNode
  aiAssistant: ReactNode
  /** The cluster renders "Играть" itself: it holds the auth token the latest-game lookup needs. */
  showPlay: boolean
  registerAccountActions: () => () => void
}

export const AppHeaderSlotsContext = createContext<AppHeaderSlots | null>(null)

export function useAppHeaderSlots(): AppHeaderSlots | null {
  const slots = useContext(AppHeaderSlotsContext)
  const register = slots?.registerAccountActions
  useLayoutEffect(() => (register ? register() : undefined), [register])
  return slots
}
