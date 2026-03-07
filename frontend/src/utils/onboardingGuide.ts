export const ONBOARDING_GUIDE_START_EVENT = 'morius:onboarding:start'
export const ONBOARDING_GUIDE_COMMAND_EVENT = 'morius:onboarding:command'
export const PAGE_MENU_CONTROL_EVENT = 'morius:page-menu:control'

const ONBOARDING_GUIDE_COMPLETED_KEY_PREFIX = 'morius.onboarding.guide.completed.v1'

export type OnboardingGuideStartSource = 'auto' | 'manual'
export type OnboardingGuideStartDetail = {
  source: OnboardingGuideStartSource
}

export type OnboardingGuideCommandType =
  | 'profile:show-characters'
  | 'profile:open-character-create'
  | 'profile:close-character-dialog'

export type OnboardingGuideCommandDetail = {
  type: OnboardingGuideCommandType
}

export type PageMenuControlAction = 'open' | 'close' | 'toggle'
export type PageMenuControlDetail = {
  action: PageMenuControlAction
}

function dispatchWindowEvent<TDetail>(eventName: string, detail: TDetail): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }))
}

export function startOnboardingGuide(source: OnboardingGuideStartSource = 'manual'): void {
  dispatchWindowEvent<OnboardingGuideStartDetail>(ONBOARDING_GUIDE_START_EVENT, { source })
}

export function sendOnboardingGuideCommand(type: OnboardingGuideCommandType): void {
  dispatchWindowEvent<OnboardingGuideCommandDetail>(ONBOARDING_GUIDE_COMMAND_EVENT, { type })
}

export function controlPageMenu(action: PageMenuControlAction): void {
  dispatchWindowEvent<PageMenuControlDetail>(PAGE_MENU_CONTROL_EVENT, { action })
}

export function openPageMenu(): void {
  controlPageMenu('open')
}

export function closePageMenu(): void {
  controlPageMenu('close')
}

export function togglePageMenu(): void {
  controlPageMenu('toggle')
}

export function buildOnboardingGuideCompletedStorageKey(userId: number): string {
  return `${ONBOARDING_GUIDE_COMPLETED_KEY_PREFIX}:${userId}`
}

export function hasCompletedOnboardingGuide(userId: number): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(buildOnboardingGuideCompletedStorageKey(userId)) === '1'
}

export function setOnboardingGuideCompleted(userId: number): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(buildOnboardingGuideCompletedStorageKey(userId), '1')
}
