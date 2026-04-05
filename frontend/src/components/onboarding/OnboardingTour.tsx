import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import {
  getOnboardingGuideState,
  updateOnboardingGuideState,
  type OnboardingGuideState,
} from '../../services/authApi'
import { createStoryGame, listStoryGames } from '../../services/storyApi'
import {
  closePageMenu,
  ONBOARDING_GUIDE_START_EVENT,
  openPageMenu,
  sendOnboardingGuideCommand,
  type OnboardingGuideStartDetail,
} from '../../utils/onboardingGuide'

type OnboardingTourProps = {
  userId: number
  authToken: string
  path: string
  onNavigate: (path: string) => void
}

type TourRect = {
  top: number
  left: number
  width: number
  height: number
  right: number
  bottom: number
}

type ChapterId = 'intro' | 'character' | 'world' | 'game'

type TourStep = {
  id: string
  chapterId: ChapterId
  path: string | ((tutorialGameId: number | null) => string)
  selectors?: string[]
  secondarySelectors?: string[]
  title: string
  description: string
  padding?: number
  menuAction?: 'open' | 'close'
  enter?: () => Promise<void> | void
  beforeNext?: () => Promise<void> | void
}

const CHAPTERS: Record<ChapterId, { label: string; title: string }> = {
  intro: { label: 'Глава 1', title: 'Первое знакомство' },
  character: { label: 'Глава 2', title: 'Создание персонажа' },
  world: { label: 'Глава 3', title: 'Создание мира' },
  game: { label: 'Глава 4', title: 'Настройки игры' },
}

const TUTORIAL_GAME_TITLE = 'Моя первая игра'
const CARD_HORIZONTAL_MARGIN = 18
const CARD_GAP = 22
const CARD_FALLBACK_WIDTH = 398
const CARD_FALLBACK_HEIGHT = 264
const AUTO_START_POLL_INTERVAL_MS = 120
const TARGET_POLL_INTERVAL_MS = 48
const TARGET_MAX_ATTEMPTS = 140
const ROUTE_SETTLE_DELAY_MS = 120
const SCROLL_SETTLE_DELAY_MS = 180
const AUTO_START_DELAY_MS = 480
const ACTION_SETTLE_DELAY_MS = 96
const SETTINGS_SECTION_SETTLE_DELAY_MS = 220
const MENU_ACTION_SETTLE_DELAY_MS = 240

const STORY_SETTINGS_SECTIONS = [
  {
    toggleSelector: '[data-tour-id="story-settings-narrator-toggle"]',
    panelSelector: '[data-tour-id="story-settings-narrator-panel"]',
  },
  {
    toggleSelector: '[data-tour-id="story-settings-visualization-toggle"]',
    panelSelector: '[data-tour-id="story-settings-visualization-panel"]',
  },
  {
    toggleSelector: '[data-tour-id="story-settings-additional-toggle"]',
    panelSelector: '[data-tour-id="story-settings-additional-panel"]',
  },
  {
    toggleSelector: '[data-tour-id="story-settings-finetune-toggle"]',
    panelSelector: '[data-tour-id="story-settings-finetune-panel"]',
  },
] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizePathname(value: string): string {
  const normalized = value.replace(/\/+$/, '').toLowerCase()
  return normalized || '/'
}

function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function collectVisibleElements(selectors: string[] | undefined): HTMLElement[] {
  if (!selectors?.length) {
    return []
  }

  const unique = new Set<HTMLElement>()
  selectors.forEach((selector) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (isElementVisible(element)) {
        unique.add(element)
      }
    })
  })

  return Array.from(unique)
}

function clickFirstVisible(selectors: string[]): boolean {
  const element = collectVisibleElements(selectors)[0]
  if (!element) {
    return false
  }

  element.click()
  return true
}

function containsLoadingIndicators(elements: HTMLElement[]): boolean {
  return elements.some((element) => {
    if (element.matches('.MuiSkeleton-root, [role="progressbar"], [aria-busy="true"]')) {
      return true
    }
    return Boolean(element.querySelector('.MuiSkeleton-root, [role="progressbar"], [aria-busy="true"]'))
  })
}

function isElementInViewportPinnedLayer(element: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current) {
    const position = window.getComputedStyle(current).position
    if (position === 'fixed' || position === 'sticky') {
      return true
    }
    current = current.parentElement
  }

  return false
}

function isElementMostlyVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const isViewportPinned = isElementInViewportPinnedLayer(element)
  if (isViewportPinned) {
    const edgeThreshold = 4
    return (
      rect.bottom >= edgeThreshold &&
      rect.top <= viewportHeight - edgeThreshold &&
      rect.right >= edgeThreshold &&
      rect.left <= viewportWidth - edgeThreshold
    )
  }
  const threshold = Math.max(40, Math.min(88, Math.round(Math.min(viewportWidth, viewportHeight) * 0.08)))

  return (
    rect.bottom >= threshold &&
    rect.top <= viewportHeight - threshold &&
    rect.right >= threshold &&
    rect.left <= viewportWidth - threshold
  )
}

function buildTargetRect(elements: HTMLElement[], padding: number): TourRect | null {
  if (!elements.length) {
    return null
  }

  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  elements.forEach((element) => {
    const rect = element.getBoundingClientRect()
    top = Math.min(top, rect.top)
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  })

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const paddedLeft = clamp(left - padding, 8, Math.max(8, viewportWidth - 24))
  const paddedTop = clamp(top - padding, 8, Math.max(8, viewportHeight - 24))
  const paddedRight = clamp(right + padding, 24, viewportWidth - 8)
  const paddedBottom = clamp(bottom + padding, 24, viewportHeight - 8)

  return {
    top: paddedTop,
    left: paddedLeft,
    width: Math.max(32, paddedRight - paddedLeft),
    height: Math.max(32, paddedBottom - paddedTop),
    right: paddedRight,
    bottom: paddedBottom,
  }
}

function buildSecondaryTargetRects(selectors: string[] | undefined, padding: number): TourRect[] {
  if (!selectors?.length) {
    return []
  }

  return selectors
    .flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => isElementVisible(element))
        .map((element) => buildTargetRect([element], padding))
        .filter((rect): rect is TourRect => Boolean(rect)),
    )
}

function getTourRectRadius(rect: TourRect, variant: 'primary' | 'secondary' = 'primary'): number {
  const minSide = Math.min(rect.width, rect.height)
  if (Math.abs(rect.width - rect.height) <= 18 && Math.max(rect.width, rect.height) <= 92) {
    return Math.max(18, Math.round(minSide / 2))
  }

  const ratio = variant === 'primary' ? 0.16 : 0.14
  return Math.max(14, Math.min(24, Math.round(minSide * ratio)))
}

function getCardPosition(targetRect: TourRect | null, cardWidth: number, cardHeight: number): { top: number; left: number } {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const width = Math.min(cardWidth || CARD_FALLBACK_WIDTH, viewportWidth - CARD_HORIZONTAL_MARGIN * 2)
  const height = Math.min(cardHeight || CARD_FALLBACK_HEIGHT, viewportHeight - CARD_HORIZONTAL_MARGIN * 2)

  if (!targetRect) {
    return {
      top: clamp((viewportHeight - height) / 2, CARD_HORIZONTAL_MARGIN, viewportHeight - height - CARD_HORIZONTAL_MARGIN),
      left: clamp((viewportWidth - width) / 2, CARD_HORIZONTAL_MARGIN, viewportWidth - width - CARD_HORIZONTAL_MARGIN),
    }
  }

  const candidates = [
    { key: 'right', space: viewportWidth - targetRect.right - CARD_HORIZONTAL_MARGIN, top: targetRect.top + targetRect.height / 2 - height / 2, left: targetRect.right + CARD_GAP },
    { key: 'left', space: targetRect.left - CARD_HORIZONTAL_MARGIN, top: targetRect.top + targetRect.height / 2 - height / 2, left: targetRect.left - CARD_GAP - width },
    { key: 'bottom', space: viewportHeight - targetRect.bottom - CARD_HORIZONTAL_MARGIN, top: targetRect.bottom + CARD_GAP, left: targetRect.left + targetRect.width / 2 - width / 2 },
    { key: 'top', space: targetRect.top - CARD_HORIZONTAL_MARGIN, top: targetRect.top - CARD_GAP - height, left: targetRect.left + targetRect.width / 2 - width / 2 },
  ].sort((leftCandidate, rightCandidate) => rightCandidate.space - leftCandidate.space)

  const chosenCandidate =
    candidates.find((candidate) => (candidate.key === 'right' || candidate.key === 'left' ? candidate.space >= width : candidate.space >= height)) ??
    candidates[0]

  return {
    top: clamp(chosenCandidate.top, CARD_HORIZONTAL_MARGIN, viewportHeight - height - CARD_HORIZONTAL_MARGIN),
    left: clamp(chosenCandidate.left, CARD_HORIZONTAL_MARGIN, viewportWidth - width - CARD_HORIZONTAL_MARGIN),
  }
}

function setControlledInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillFirstInput(selectors: string[], value: string): boolean {
  const input = collectVisibleElements(selectors)[0] as HTMLInputElement | HTMLTextAreaElement | undefined
  if (!input) {
    return false
  }
  if ('value' in input && typeof input.value === 'string' && input.value.trim()) {
    return true
  }
  setControlledInputValue(input, value)
  return true
}

function resolveStepPath(step: TourStep, tutorialGameId: number | null): string {
  return normalizePathname(typeof step.path === 'function' ? step.path(tutorialGameId) : step.path)
}

function canAutoStartStep(step: TourStep, currentPath: string, tutorialGameId: number | null): boolean {
  if (normalizePathname(currentPath) !== resolveStepPath(step, tutorialGameId)) {
    return true
  }
  if (!step.selectors?.length || step.enter || step.menuAction === 'open') {
    return true
  }

  const elements = collectVisibleElements(step.selectors)
  return elements.length > 0 && !containsLoadingIndicators(elements)
}

function OnboardingTour({ userId, authToken, path, onNavigate }: OnboardingTourProps) {
  const [isActive, setIsActive] = useState(false)
  const [isHydratingRemoteState, setIsHydratingRemoteState] = useState(true)
  const [remoteState, setRemoteState] = useState<OnboardingGuideState | null>(null)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const [secondaryTargetRects, setSecondaryTargetRects] = useState<TourRect[]>([])
  const [cardSize, setCardSize] = useState({ width: CARD_FALLBACK_WIDTH, height: CARD_FALLBACK_HEIGHT })
  const [isResolvingStep, setIsResolvingStep] = useState(false)
  const [isBusyAction, setIsBusyAction] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const autoStartTokenRef = useRef<string | null>(null)
  const routeStepDelayUntilRef = useRef(0)
  const enterExecutionKeyRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
  const patchQueueRef = useRef<Promise<OnboardingGuideState | null>>(Promise.resolve(null))
  const remoteStateRef = useRef<OnboardingGuideState | null>(null)
  const tutorialGameIdRef = useRef<number | null>(null)

  useEffect(() => {
    remoteStateRef.current = remoteState
    tutorialGameIdRef.current = remoteState?.tutorial_game_id ?? tutorialGameIdRef.current ?? null
  }, [remoteState])

  const patchRemoteState = useCallback(
    async (payload: Partial<OnboardingGuideState>): Promise<OnboardingGuideState | null> => {
      if (!authToken) {
        return remoteStateRef.current
      }

      patchQueueRef.current = patchQueueRef.current
        .catch(() => remoteStateRef.current)
        .then(async () => {
          const nextState = await updateOnboardingGuideState(authToken, payload)
          remoteStateRef.current = nextState
          if (nextState.tutorial_game_id) {
            tutorialGameIdRef.current = nextState.tutorial_game_id
          }
          setRemoteState(nextState)
          return nextState
        })
        .catch((error) => {
          console.warn('Failed to sync onboarding guide state', error)
          return remoteStateRef.current
        })

      return patchQueueRef.current
    },
    [authToken],
  )

  const ensureTutorialGame = useCallback(async (): Promise<number | null> => {
    const currentTutorialGameId = tutorialGameIdRef.current ?? remoteStateRef.current?.tutorial_game_id ?? null
    const existingGames = await listStoryGames(authToken, { compact: true })
    const normalizedTitle = TUTORIAL_GAME_TITLE.trim().toLocaleLowerCase('ru')
    let tutorialGame =
      (currentTutorialGameId ? existingGames.find((game) => game.id === currentTutorialGameId) ?? null : null) ??
      existingGames.find((game) => game.title.trim().toLocaleLowerCase('ru') === normalizedTitle) ??
      null

    if (!tutorialGame) {
      tutorialGame = await createStoryGame({ token: authToken, title: TUTORIAL_GAME_TITLE, visibility: 'private' })
    }

    tutorialGameIdRef.current = tutorialGame.id
    if (remoteStateRef.current?.tutorial_game_id !== tutorialGame.id) {
      void patchRemoteState({ tutorial_game_id: tutorialGame.id })
    }

    return tutorialGame.id
  }, [authToken, patchRemoteState])

  const ensureWorldCreateTitleFilled = useCallback(async () => {
    fillFirstInput(['[data-tour-id="world-create-title-input"]'], TUTORIAL_GAME_TITLE)
  }, [])

  const ensureRightPanelOpen = useCallback(async () => {
    if (collectVisibleElements(['[data-tour-id="story-right-subtabs"]']).length > 0) {
      return
    }
    if (clickFirstVisible(['[data-tour-id="header-right-panel-toggle"]'])) {
      await sleep(ACTION_SETTLE_DELAY_MS)
    }
  }, [])

  const ensureStoryMode = useCallback(
    async (mode: 'ai' | 'world' | 'memory', subtab: 'primary' | 'secondary' = 'primary') => {
      await ensureRightPanelOpen()
      clickFirstVisible([
        mode === 'ai'
          ? '[data-tour-id="story-right-mode-ai"]'
          : mode === 'world'
            ? '[data-tour-id="story-right-mode-world"]'
            : '[data-tour-id="story-right-mode-memory"]',
      ])
      await sleep(ACTION_SETTLE_DELAY_MS)
      clickFirstVisible([subtab === 'primary' ? '[data-tour-id="story-right-subtab-primary"]' : '[data-tour-id="story-right-subtab-secondary"]'])
      await sleep(ACTION_SETTLE_DELAY_MS)
    },
    [ensureRightPanelOpen],
  )

  const ensureStorySettingsSection = useCallback(
    async (options: { toggleSelector: string; panelSelector: string }) => {
      await ensureStoryMode('ai', 'secondary')
      for (const section of STORY_SETTINGS_SECTIONS) {
        if (section.panelSelector === options.panelSelector) {
          continue
        }
        if (collectVisibleElements([section.panelSelector]).length > 0) {
          clickFirstVisible([section.toggleSelector])
          await sleep(SETTINGS_SECTION_SETTLE_DELAY_MS)
        }
      }
      if (collectVisibleElements([options.panelSelector]).length === 0) {
        clickFirstVisible([options.toggleSelector])
        await sleep(SETTINGS_SECTION_SETTLE_DELAY_MS)
      }
    },
    [ensureStoryMode],
  )

  const steps = useMemo<TourStep[]>(
    () => [
      {
        id: 'intro-welcome',
        chapterId: 'intro',
        path: '/dashboard',
        title: 'Приветствую!',
        description: 'У нас тут много всего, чтобы не потеряться, давай я проведу тебе гайд что тут и как устроено?',
        menuAction: 'close',
      },
      { id: 'home-community', chapterId: 'intro', path: '/dashboard', selectors: ['[data-tour-id="home-community-section"]'], title: 'Сообщество', description: 'Здесь игроки публикуют свои миры. Предустанавливают инструкции, NPC, вам останется поставить ГГ и можете смело начинать играть.', padding: 18, menuAction: 'close' },
      {
        id: 'home-profile',
        chapterId: 'intro',
        path: '/dashboard',
        selectors: ['[data-tour-id="header-profile-button"]'],
        title: 'Профиль',
        description: 'Ваш профиль, ваша база. Давайте перейдем в него.',
        padding: 12,
        menuAction: 'close',
        beforeNext: async () => {
          routeStepDelayUntilRef.current = Date.now() + ROUTE_SETTLE_DELAY_MS
          onNavigate('/profile')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      {
        id: 'profile-characters',
        chapterId: 'intro',
        path: '/profile',
        selectors: ['[data-tour-id="profile-characters-section"]'],
        title: 'Персонажи',
        description: 'Здесь вы можете создать персонажей, героев и просто NPC, которые можно добавлять в любой мир и переиспользовать.',
        padding: 18,
        menuAction: 'close',
        enter: async () => {
          sendOnboardingGuideCommand('profile:show-characters')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      {
        id: 'profile-character-create-card',
        chapterId: 'character',
        path: '/profile',
        selectors: ['[data-tour-id="profile-characters-create-card"]'],
        title: 'Давайте создадим первого персонажа!',
        description: 'Нажмите на карточку, чтобы добавить персонажа.',
        padding: 14,
        menuAction: 'close',
        enter: async () => {
          sendOnboardingGuideCommand('profile:show-characters')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
        beforeNext: async () => {
          sendOnboardingGuideCommand('profile:open-character-create')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      {
        id: 'character-dialog',
        chapterId: 'character',
        path: '/profile',
        selectors: ['[data-tour-id="character-manager-title"]', '[data-tour-id="character-manager-dialog"]'],
        title: 'Создание персонажа',
        description: 'Здесь вы добавляете аватарку, имя, описание, триггеры и пометки персонажа.',
        padding: 18,
        menuAction: 'close',
        enter: async () => {
          sendOnboardingGuideCommand('profile:open-character-create')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      { id: 'character-avatar', chapterId: 'character', path: '/profile', selectors: ['[data-tour-id="character-manager-avatar-section"]'], title: 'Аватар', description: 'Вы можете загрузить свой аватар или сгенерировать через ИИ.', padding: 18, menuAction: 'close' },
      {
        id: 'character-triggers',
        chapterId: 'character',
        path: '/profile',
        selectors: ['[data-tour-id="character-manager-triggers-section"]', '[data-tour-id="character-manager-notes-section"]'],
        title: 'Триггеры',
        description: 'Триггеры это слова, которые активируют персонажа, чтобы ИИ понял, что он используется в контексте. А пометки созданы для вашего удобства: пишите туда что угодно, например «Агент ФСБ».',
        padding: 18,
        menuAction: 'close',
        enter: async () => {
          sendOnboardingGuideCommand('profile:open-character-create')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
        beforeNext: async () => {
          sendOnboardingGuideCommand('profile:close-character-dialog')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      { id: 'profile-templates', chapterId: 'character', path: '/profile', selectors: ['[data-tour-id="profile-tab-instructions"]', '[data-tour-id="profile-tab-plots"]'], title: 'Шаблоны', description: 'С инструкциями и сюжетами тоже самое. Но сюжеты пока в разработке.', padding: 18, menuAction: 'close' },
      {
        id: 'my-games-create',
        chapterId: 'world',
        path: '/games',
        selectors: ['[data-tour-id="my-games-create-button"]'],
        title: 'Создание игры',
        description: 'Здесь вы можете создать свою первую игру самостоятельно. Давайте перейдем к заполнению.',
        padding: 12,
        menuAction: 'open',
        secondarySelectors: ['[data-tour-id="sidebar-item-games-my"]'],
        beforeNext: async () => {
          routeStepDelayUntilRef.current = Date.now() + ROUTE_SETTLE_DELAY_MS
          onNavigate('/worlds/new')
          await sleep(ACTION_SETTLE_DELAY_MS)
        },
      },
      { id: 'world-create-cover', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-cover"]'], title: 'Баннер', description: 'Здесь вы можете добавить свою обложку для карточки игры. Это необязательно, если что создадим за вас текстуру.', padding: 18, menuAction: 'close', enter: ensureWorldCreateTitleFilled },
      { id: 'world-create-main-info', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-main-info"]'], title: 'Основная информация', description: 'Тут важнее всего название мира. Без него никак. Ниже описание и вступительная сцена.', padding: 18, menuAction: 'close', enter: ensureWorldCreateTitleFilled },
      { id: 'world-create-opening-scene', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-opening-scene"]'], title: 'Вступительная сцена', description: 'При желании вы можете добавить стартовую сцену. Добавить диалог с нужным форматированием. Но сначала рекомендуем ознакомиться с основами игры.', padding: 18, menuAction: 'close' },
      { id: 'world-create-genres', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-genres"]'], title: 'Жанры', description: 'Вы можете выбрать жанры для своей игры. Если опубликуете, ее проще будет найти по фильтрам.', padding: 18, menuAction: 'close' },
      { id: 'world-create-cards', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-cards"]'], title: 'Карточки', description: 'Тут вы добавляете инструкции из шаблонов или новые, карточки сюжета если хотите, главного героя и NPC для игры.', padding: 18, menuAction: 'close' },
      { id: 'world-create-visibility', chapterId: 'world', path: '/worlds/new', selectors: ['[data-tour-id="world-create-visibility"]'], title: 'Приватность', description: 'Частная игра видна только вам. Публичная создастся в Мои публикации и будет видна всем. Важно: в публичной игре нельзя предустановить ГГ.', padding: 18, menuAction: 'close' },
      {
        id: 'world-create-submit',
        chapterId: 'world',
        path: '/worlds/new',
        selectors: ['[data-tour-id="world-create-submit"]'],
        title: 'А теперь к игре!',
        description: 'Перейдем на страницу самой игры.',
        padding: 14,
        menuAction: 'close',
        enter: ensureWorldCreateTitleFilled,
        beforeNext: async () => {
          const tutorialGameId = await ensureTutorialGame()
          if (tutorialGameId) {
            onNavigate(`/home/${tutorialGameId}`)
            await sleep(ACTION_SETTLE_DELAY_MS)
          }
        },
      },
      {
        id: 'story-ai-instructions',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: [
          '[data-tour-id="story-right-mode-ai"]',
          '[data-tour-id="story-right-subtabs"]',
          '[data-tour-id="story-ai-instructions-panel"]',
          '[data-tour-id="story-ai-instructions-add-first"]',
          '[data-tour-id="story-ai-instructions-template"]',
          '[data-tour-id="story-ai-instructions-empty-state"]',
        ],
        title: 'Инструкции',
        description: 'Это кастомные карточки, где вы пишите свои промпты для корректировки поведения ИИ. Например: отвечай 5 абзацами.',
        padding: 16,
        menuAction: 'close',
        enter: async () => {
          await ensureStoryMode('ai', 'primary')
        },
      },
      {
        id: 'story-settings-narrator',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-right-mode-ai"]', '[data-tour-id="story-right-subtabs"]', '[data-tour-id="story-settings-narrator-section"]'],
        title: 'Рассказчик',
        description: 'Модель, которая ведет игру. На любой вкус и цвет!',
        padding: 16,
        menuAction: 'close',
        enter: async () => {
          await ensureStorySettingsSection({ toggleSelector: '[data-tour-id="story-settings-narrator-toggle"]', panelSelector: '[data-tour-id="story-settings-narrator-panel"]' })
        },
      },
      {
        id: 'story-settings-visualization',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-settings-visualization-section"]'],
        title: 'Генерация картинок',
        description: 'Тут выбираем модель для генерации картинок и вручную задаем стиль, если хотим.',
        padding: 16,
        menuAction: 'close',
        enter: async () => {
          await ensureStorySettingsSection({ toggleSelector: '[data-tour-id="story-settings-visualization-toggle"]', panelSelector: '[data-tour-id="story-settings-visualization-panel"]' })
        },
      },
      {
        id: 'story-settings-additional',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-settings-additional-section"]'],
        title: 'Разное',
        description: 'Тут доп. функции. Подсветка под окружение, переключение показа мыслей ГГ и NPC по желанию.',
        padding: 16,
        menuAction: 'close',
        enter: async () => {
          await ensureStorySettingsSection({ toggleSelector: '[data-tour-id="story-settings-additional-toggle"]', panelSelector: '[data-tour-id="story-settings-additional-panel"]' })
        },
      },
      {
        id: 'story-settings-finetune',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-settings-finetune-section"]'],
        title: 'Доп. настройки',
        description: 'Тут мы задаем лимит памяти ИИ в токенах, лимит ответа ИИ в токенах и параметры температуры. Температура влияет на поведение ИИ, рекомендуем не изменять ее, если раньше не сталкивались.',
        padding: 16,
        menuAction: 'close',
        enter: async () => {
          await ensureStorySettingsSection({ toggleSelector: '[data-tour-id="story-settings-finetune-toggle"]', panelSelector: '[data-tour-id="story-settings-finetune-panel"]' })
        },
      },
      {
        id: 'story-navigation',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-right-mode-world"]', '[data-tour-id="story-right-mode-ai"]', '[data-tour-id="story-right-mode-memory"]'],
        title: 'Навигация игры',
        description: 'Это основные кнопки навигации в шапке игры: Мир, ИИ и Память.',
        padding: 12,
        menuAction: 'close',
        enter: ensureRightPanelOpen,
      },
      {
        id: 'story-plot',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-right-mode-world"]', '[data-tour-id="story-right-subtabs"]', '[data-tour-id="story-world-plot-panel"]'],
        title: 'Сюжет',
        description: 'Предустановленные события, которые включаются вами или по триггерам.',
        padding: 16,
        menuAction: 'close',
        enter: async () => { await ensureStoryMode('world', 'primary') },
      },
      {
        id: 'story-world',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-right-mode-world"]', '[data-tour-id="story-right-subtabs"]', '[data-tour-id="story-world-world-panel"]'],
        title: 'Мир',
        description: 'Здесь мы задаем нашего ГГ и NPC из персонажей, что создали. Важно: ГГ ИИ помнит всегда, а NPC только когда активируется триггер.',
        padding: 16,
        menuAction: 'close',
        enter: async () => { await ensureStoryMode('world', 'secondary') },
      },
      {
        id: 'story-memory',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-right-mode-memory"]', '[data-tour-id="story-right-subtabs"]', '[data-tour-id="story-memory-panel"]'],
        title: 'Память',
        description: 'Блок важных событий. Здесь ИИ записывает важные моменты, которые выделяет сама. Вы можете редактировать их или добавлять свои, если что-то не выделилось.',
        padding: 16,
        menuAction: 'close',
        enter: async () => { await ensureStoryMode('memory', 'primary') },
      },
      {
        id: 'story-input',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-composer-input"]'],
        title: 'Ввод хода',
        description: 'Здесь вы описываете свои действия или слова.',
        padding: 18,
        menuAction: 'close',
      },
      {
        id: 'story-controls',
        chapterId: 'game',
        path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'),
        selectors: ['[data-tour-id="story-composer-controls"]'],
        title: 'Кнопки управления',
        description:
          '1. Стоимость хода. Она будет меняться в зависимости от использования памяти и контекста. 2. Откат, откатываем ход ИИ или свой. 3. Возврат, если решили вернуть то, что откатили. 4. Реролл, перегенерация последнего ответа ИИ. 5. Генерация картинки, если хотите визуализировать сцену; повторное нажатие перегенерирует ее заново.',
        padding: 18,
        menuAction: 'close',
      },
      { id: 'story-support', chapterId: 'game', path: (tutorialGameId) => (tutorialGameId ? `/home/${tutorialGameId}` : '/home'), selectors: ['[data-tour-id="sidebar-utility-support"]'], title: 'Поддержка', description: 'Остались вопросы? Можете перейти в наш TG-канал, в нем есть раздел F.A.Q. А еще можно пообщаться с более опытными игроками.', padding: 10, menuAction: 'open' },
      {
        id: 'guide-finished',
        chapterId: 'game',
        path: '/dashboard',
        selectors: ['[data-tour-id="sidebar-item-guide"]'],
        title: 'Поздравляем!',
        description: 'Вы прошли основной гайд. Если захотите запустить его заново, откройте меню слева и нажмите кнопку Гайд.',
        padding: 16,
        menuAction: 'open',
      },
    ],
    [ensureRightPanelOpen, ensureStoryMode, ensureStorySettingsSection, ensureTutorialGame, ensureWorldCreateTitleFilled, onNavigate],
  )

  const stepIndexById = useMemo(() => new Map(steps.map((step, index) => [step.id, index])), [steps])
  const activeStep = steps[activeStepIndex] ?? null
  const activeStepPath = activeStep ? resolveStepPath(activeStep, tutorialGameIdRef.current) : path

  const chapterProgress = useMemo(() => {
    if (!activeStep) {
      return 0
    }
    const chapterSteps = steps.filter((step) => step.chapterId === activeStep.chapterId)
    const stepPosition = chapterSteps.findIndex((step) => step.id === activeStep.id)
    return stepPosition < 0 ? 0 : ((stepPosition + 1) / chapterSteps.length) * 100
  }, [activeStep, steps])

  const chapterMeta = activeStep ? CHAPTERS[activeStep.chapterId] : null

  const startGuideFromIndex = useCallback((index: number) => {
    sessionIdRef.current += 1
    enterExecutionKeyRef.current = null
    routeStepDelayUntilRef.current = 0
    setIsBusyAction(false)
    setIsResolvingStep(true)
    setTargetRect(null)
    setSecondaryTargetRects([])
    setActiveStepIndex(clamp(index, 0, Math.max(steps.length - 1, 0)))
    setIsActive(true)
  }, [steps.length])

  useEffect(() => {
    let isCancelled = false
    setIsHydratingRemoteState(true)
    setRemoteState(null)

    getOnboardingGuideState(authToken)
      .then((nextState) => {
        if (isCancelled) {
          return
        }
        remoteStateRef.current = nextState
        tutorialGameIdRef.current = nextState.tutorial_game_id
        setRemoteState(nextState)
      })
      .catch((error) => {
        console.warn('Failed to load onboarding guide state', error)
        if (!isCancelled) {
          setRemoteState(null)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsHydratingRemoteState(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [authToken, userId])

  useEffect(() => {
    if (!remoteState || isHydratingRemoteState || isActive || remoteState.status !== 'pending') {
      return
    }

    const autoStartToken = `${userId}:${remoteState.status}:${remoteState.current_step_id ?? 'initial'}:${remoteState.tutorial_game_id ?? 'none'}`
    if (autoStartTokenRef.current === autoStartToken) {
      return
    }

    let isCancelled = false
    let timerId = 0

    const waitForReadyState = () => {
      if (isCancelled) {
        return
      }
      if (document.readyState !== 'complete') {
        timerId = window.setTimeout(waitForReadyState, AUTO_START_POLL_INTERVAL_MS)
        return
      }

      const savedStepIndex = remoteState.current_step_id ? stepIndexById.get(remoteState.current_step_id) ?? 0 : 0
      const safeStepIndex = savedStepIndex >= 16 && !tutorialGameIdRef.current ? 0 : savedStepIndex
      const startStep = steps[safeStepIndex] ?? steps[0]
      if (!startStep) {
        return
      }
      if (!canAutoStartStep(startStep, path, tutorialGameIdRef.current)) {
        timerId = window.setTimeout(waitForReadyState, AUTO_START_POLL_INTERVAL_MS)
        return
      }

      autoStartTokenRef.current = autoStartToken
      timerId = window.setTimeout(() => {
        if (!isCancelled) {
          startGuideFromIndex(safeStepIndex)
        }
      }, AUTO_START_DELAY_MS)
    }

    waitForReadyState()

    return () => {
      isCancelled = true
      window.clearTimeout(timerId)
    }
  }, [isActive, isHydratingRemoteState, path, remoteState, startGuideFromIndex, stepIndexById, steps, userId])

  useEffect(() => {
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<OnboardingGuideStartDetail>).detail
      if (!detail) {
        return
      }
      closePageMenu()
      startGuideFromIndex(0)
    }

    window.addEventListener(ONBOARDING_GUIDE_START_EVENT, handleStart as EventListener)
    return () => {
      window.removeEventListener(ONBOARDING_GUIDE_START_EVENT, handleStart as EventListener)
    }
  }, [startGuideFromIndex])

  useEffect(() => {
    if (!isActive || !activeStep) {
      return
    }
    void patchRemoteState({ current_step_id: activeStep.id })
  }, [activeStep, isActive, patchRemoteState])

  useEffect(() => {
    if (!isActive || !activeStep) {
      return
    }
    if (isBusyAction) {
      return
    }
    if (path !== activeStepPath) {
      routeStepDelayUntilRef.current = Date.now() + ROUTE_SETTLE_DELAY_MS
      onNavigate(activeStepPath)
    }
  }, [activeStep, activeStepPath, isActive, isBusyAction, onNavigate, path])

  useEffect(() => {
    if (!isActive || !activeStep) {
      setIsResolvingStep(false)
      setTargetRect(null)
      setSecondaryTargetRects([])
      return
    }

    let isCancelled = false
    let timerId = 0
    let attempts = 0
    let hasAppliedMenuAction = false
    const executionKey = `${sessionIdRef.current}:${activeStep.id}:${activeStepPath}`

    const resolveTarget = async () => {
      if (isCancelled) {
        return
      }

      if (path !== activeStepPath) {
        timerId = window.setTimeout(() => {
          void resolveTarget()
        }, TARGET_POLL_INTERVAL_MS)
        return
      }

      const delayLeftMs = routeStepDelayUntilRef.current - Date.now()
      if (delayLeftMs > 0) {
        timerId = window.setTimeout(() => {
          void resolveTarget()
        }, delayLeftMs)
        return
      }

      if (!hasAppliedMenuAction) {
        if (activeStep.menuAction === 'open') {
          openPageMenu()
          hasAppliedMenuAction = true
          await sleep(MENU_ACTION_SETTLE_DELAY_MS)
        } else if (activeStep.menuAction === 'close') {
          closePageMenu()
          hasAppliedMenuAction = true
          await sleep(MENU_ACTION_SETTLE_DELAY_MS)
        }
        if (isCancelled) {
          return
        }
      }

      if (enterExecutionKeyRef.current !== executionKey) {
        enterExecutionKeyRef.current = executionKey
        await activeStep.enter?.()
        if (isCancelled) {
          return
        }
      }

      const selectors = activeStep.selectors ?? []
      if (!selectors.length) {
        setTargetRect(null)
        setSecondaryTargetRects([])
        setIsResolvingStep(false)
        return
      }

      const elements = collectVisibleElements(selectors)
      if (!elements.length || containsLoadingIndicators(elements)) {
        attempts += 1
        if (attempts < TARGET_MAX_ATTEMPTS) {
          timerId = window.setTimeout(() => {
            void resolveTarget()
          }, TARGET_POLL_INTERVAL_MS)
        } else {
          setTargetRect(null)
          setSecondaryTargetRects([])
          setIsResolvingStep(false)
        }
        return
      }

      const anchorElement = elements[0]
      if (!isElementMostlyVisible(anchorElement)) {
        anchorElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
        timerId = window.setTimeout(() => {
          void resolveTarget()
        }, SCROLL_SETTLE_DELAY_MS)
        return
      }

      setTargetRect(buildTargetRect(elements, activeStep.padding ?? 16))
      setSecondaryTargetRects(buildSecondaryTargetRects(activeStep.secondarySelectors, Math.max(10, (activeStep.padding ?? 16) - 4)))
      setIsResolvingStep(false)
    }

    setIsResolvingStep(true)
    setTargetRect(null)
    setSecondaryTargetRects([])
    void resolveTarget()

    return () => {
      isCancelled = true
      window.clearTimeout(timerId)
    }
  }, [activeStep, activeStepPath, isActive, path])

  useEffect(() => {
    if (!isActive || !activeStep || path !== activeStepPath) {
      return
    }

    const handleViewportChange = () => {
      const selectors = activeStep.selectors ?? []
      if (!selectors.length) {
        return
      }

      const elements = collectVisibleElements(selectors)
      if (!elements.length) {
        return
      }

      setTargetRect(buildTargetRect(elements, activeStep.padding ?? 16))
      setSecondaryTargetRects(buildSecondaryTargetRects(activeStep.secondarySelectors, Math.max(10, (activeStep.padding ?? 16) - 4)))
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [activeStep, activeStepPath, isActive, path])

  useEffect(() => {
    if (!isActive || !cardRef.current) {
      return
    }

    const measureCard = () => {
      if (!cardRef.current) {
        return
      }
      const rect = cardRef.current.getBoundingClientRect()
      setCardSize({ width: rect.width || CARD_FALLBACK_WIDTH, height: rect.height || CARD_FALLBACK_HEIGHT })
    }

    measureCard()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      measureCard()
    })
    observer.observe(cardRef.current)

    return () => {
      observer.disconnect()
    }
  }, [activeStep, isActive, targetRect])

  const handleFinish = useCallback((status: 'completed' | 'skipped') => {
    setIsActive(false)
    setIsResolvingStep(false)
    setIsBusyAction(false)
    setTargetRect(null)
    setSecondaryTargetRects([])
    void patchRemoteState({
      status,
      current_step_id: null,
      tutorial_game_id: tutorialGameIdRef.current ?? remoteStateRef.current?.tutorial_game_id ?? null,
    })
  }, [patchRemoteState])

  const handleNext = useCallback(async () => {
    if (!activeStep || isBusyAction) {
      return
    }

    setIsBusyAction(true)
    try {
      await activeStep.beforeNext?.()
      if (activeStepIndex >= steps.length - 1) {
        handleFinish('completed')
        return
      }
      enterExecutionKeyRef.current = null
      setTargetRect(null)
      setSecondaryTargetRects([])
      setIsResolvingStep(true)
      setActiveStepIndex((previous) => previous + 1)
    } finally {
      setIsBusyAction(false)
    }
  }, [activeStep, activeStepIndex, handleFinish, isBusyAction, steps.length])

  const handlePrevious = useCallback(async () => {
    if (isBusyAction || activeStepIndex <= 0) {
      return
    }

    const previousStep = steps[Math.max(activeStepIndex - 1, 0)] ?? null
    setIsBusyAction(true)
    try {
      if (previousStep && ['character-dialog', 'character-avatar', 'character-triggers'].includes(previousStep.id)) {
        sendOnboardingGuideCommand('profile:open-character-create')
        await sleep(ACTION_SETTLE_DELAY_MS)
      }
      enterExecutionKeyRef.current = null
      setTargetRect(null)
      setSecondaryTargetRects([])
      setIsResolvingStep(true)
      setActiveStepIndex((previous) => Math.max(previous - 1, 0))
    } finally {
      setIsBusyAction(false)
    }
  }, [activeStepIndex, isBusyAction, steps])

  const cardPosition = useMemo(() => getCardPosition(targetRect, cardSize.width, cardSize.height), [cardSize.height, cardSize.width, targetRect])

  if (!isActive || !activeStep || !chapterMeta) {
    return null
  }

  const overlayShadeColor = 'color-mix(in srgb, var(--morius-app-base) 68%, rgba(3, 6, 12, 0.58))'
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const overlayMaskId = `morius-onboarding-mask-${sessionIdRef.current}-${activeStep.id}`
  const overlayCutouts = targetRect ? [targetRect, ...secondaryTargetRects] : []
  const highlightRects = [
    ...(targetRect ? [{ rect: targetRect, variant: 'primary' as const }] : []),
    ...secondaryTargetRects.map((rect) => ({ rect, variant: 'secondary' as const })),
  ]

  return (
      <Box
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        sx={{ position: 'fixed', inset: 0, zIndex: 1600, animation: 'morius-onboarding-fade-in 220ms ease' }}
      >
      <Box aria-hidden sx={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        {overlayCutouts.length ? (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
            preserveAspectRatio="none"
            style={{ display: 'block' }}
          >
            <defs>
              <mask id={overlayMaskId}>
                <rect x="0" y="0" width={viewportWidth} height={viewportHeight} fill="white" />
                {overlayCutouts.map((rect, index) => (
                  <rect
                    key={`${rect.left}-${rect.top}-${index}`}
                    x={rect.left}
                    y={rect.top}
                    width={rect.width}
                    height={rect.height}
                    rx={getTourRectRadius(rect, index === 0 ? 'primary' : 'secondary')}
                    ry={getTourRectRadius(rect, index === 0 ? 'primary' : 'secondary')}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <rect x="0" y="0" width={viewportWidth} height={viewportHeight} fill={overlayShadeColor} mask={`url(#${overlayMaskId})`} />
          </svg>
        ) : (
          <Box sx={{ position: 'fixed', inset: 0, backgroundColor: overlayShadeColor }} />
        )}
      </Box>

      {highlightRects.map(({ rect, variant }, index) => (
        <Box
          key={`${rect.left}-${rect.top}-${index}`}
          aria-hidden
          sx={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: `${getTourRectRadius(rect, variant)}px`,
            pointerEvents: 'none',
            border: variant === 'primary' ? '1px solid color-mix(in srgb, var(--morius-accent) 56%, transparent)' : '1px solid color-mix(in srgb, var(--morius-accent) 34%, transparent)',
            boxShadow:
              variant === 'primary'
                ? '0 0 0 4px color-mix(in srgb, var(--morius-button-active) 44%, transparent), 0 18px 42px rgba(0, 0, 0, 0.28), inset 0 0 0 1px color-mix(in srgb, var(--morius-title-text) 12%, transparent)'
                : '0 0 0 2px color-mix(in srgb, var(--morius-button-active) 18%, transparent)',
            transition: 'top 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease',
            animation: variant === 'primary' ? 'morius-onboarding-target-pulse 2.1s ease-in-out infinite' : 'none',
          }}
        />
      ))}

      <Box
        ref={cardRef}
        sx={{
          position: 'fixed',
          top: cardPosition.top,
          left: cardPosition.left,
          width: `min(${CARD_FALLBACK_WIDTH}px, calc(100vw - ${CARD_HORIZONTAL_MARGIN * 2}px))`,
          borderRadius: 'calc(var(--morius-radius) + 8px)',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 96%, rgba(255, 255, 255, 0.02)) 0%, color-mix(in srgb, var(--morius-elevated-bg) 98%, rgba(0, 0, 0, 0.12)) 100%)',
          color: 'var(--morius-text-primary)',
          boxShadow: '0 22px 52px rgba(0, 0, 0, 0.46)',
          overflow: 'hidden',
          transition: 'top 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
          animation: 'morius-onboarding-card-enter 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top left, color-mix(in srgb, var(--morius-button-active) 34%, transparent) 0%, transparent 42%), linear-gradient(135deg, color-mix(in srgb, var(--morius-title-text) 4%, transparent) 0%, transparent 46%)', pointerEvents: 'none' }} />

        <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', minHeight: 0 }}>
          <Box
            sx={{
              px: 0.85,
              py: 1.1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 24%, transparent) 0%, color-mix(in srgb, var(--morius-elevated-bg) 92%, transparent) 100%)',
              borderRight: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
            }}
          >
            <Box sx={{ display: 'grid', rowGap: 0.32 }}>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{chapterMeta.label}</Typography>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 800, lineHeight: 1.2 }}>{chapterMeta.title}</Typography>
            </Box>

            <Box sx={{ mt: 1.1, width: 7, borderRadius: '999px', backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 54%, transparent)', overflow: 'hidden', alignSelf: 'center', flex: 1, minHeight: 88 }}>
              <Box sx={{ width: '100%', height: `${chapterProgress}%`, borderRadius: '999px', background: 'linear-gradient(180deg, var(--morius-accent) 0%, color-mix(in srgb, var(--morius-button-active) 82%, var(--morius-accent)) 100%)', boxShadow: '0 0 14px color-mix(in srgb, var(--morius-accent) 26%, transparent)', transition: 'height 260ms cubic-bezier(0.22, 1, 0.36, 1)' }} />
            </Box>
          </Box>

          <Box sx={{ px: 1.35, py: 1.2 }}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.28rem', fontWeight: 800, lineHeight: 1.16 }}>{activeStep.title}</Typography>
            <Typography sx={{ mt: 0.92, color: 'var(--morius-text-secondary)', fontSize: '0.95rem', lineHeight: 1.55 }}>{activeStep.description}</Typography>

            {isResolvingStep || isBusyAction ? (
              <Box sx={{ mt: 1, display: 'inline-flex', alignItems: 'center', gap: 0.65, color: 'var(--morius-text-secondary)' }}>
                <CircularProgress size={14} sx={{ color: 'var(--morius-accent)' }} />
                <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.2 }}>Подготавливаем следующий экран…</Typography>
              </Box>
            ) : null}

            <Box sx={{ mt: 1.35, display: 'flex', gap: 0.85, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.85,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {activeStepIndex === steps.length - 1 ? null : (
                  <Box
                    component="button"
                    type="button"
                    onClick={() => handleFinish('skipped')}
                    disabled={isBusyAction}
                    sx={{
                      minHeight: 42,
                      px: 1.4,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      background: 'color-mix(in srgb, var(--morius-elevated-bg) 90%, transparent)',
                      color: 'var(--morius-text-secondary)',
                      font: 'inherit',
                      fontWeight: 700,
                      cursor: isBusyAction ? 'default' : 'pointer',
                      transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                      '&:hover': isBusyAction ? undefined : { backgroundColor: 'transparent', borderColor: 'var(--morius-accent)', transform: 'translateY(-1px)' },
                    }}
                  >
                    Пропустить
                  </Box>
                )}
                {activeStepIndex === 0 ? null : (
                  <Box
                    component="button"
                    type="button"
                    onClick={handlePrevious}
                    disabled={isBusyAction}
                    sx={{
                      minHeight: 42,
                      px: 1.4,
                      borderRadius: '999px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      background: 'color-mix(in srgb, var(--morius-elevated-bg) 90%, transparent)',
                      color: 'var(--morius-text-secondary)',
                      font: 'inherit',
                      fontWeight: 700,
                      cursor: isBusyAction ? 'default' : 'pointer',
                      transition: 'background-color 180ms ease, border-color 180ms ease, transform 180ms ease',
                      '&:hover': isBusyAction ? undefined : { backgroundColor: 'transparent', borderColor: 'var(--morius-accent)', transform: 'translateY(-1px)' },
                    }}
                  >
                    Назад
                  </Box>
                )}
              </Box>

              <Box
                component="button"
                type="button"
                onClick={() => {
                  void handleNext()
                }}
                disabled={isBusyAction}
                sx={{
                  minHeight: 42,
                  px: 1.55,
                  borderRadius: '999px',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                  background: 'var(--morius-button-active)',
                  color: 'var(--morius-title-text)',
                  font: 'inherit',
                  fontWeight: 800,
                  cursor: isBusyAction ? 'default' : 'pointer',
                  boxShadow: '0 12px 24px color-mix(in srgb, var(--morius-accent) 16%, transparent)',
                  transition: 'transform 180ms ease, box-shadow 180ms ease, filter 180ms ease',
                  '&:hover': isBusyAction ? undefined : { transform: 'translateY(-1px)', boxShadow: '0 16px 28px color-mix(in srgb, var(--morius-accent) 22%, transparent)', backgroundColor: 'transparent' },
                }}
              >
                {activeStepIndex === steps.length - 1 ? 'Завершить' : activeStepIndex === 0 ? 'Начать' : 'Далее'}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default OnboardingTour
