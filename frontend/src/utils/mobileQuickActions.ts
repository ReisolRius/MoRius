import type { AppHeaderMobileActionItem } from '../components/AppHeader'
import type { StoryGameSummary } from '../types/story'
import dashboardContinueIconMarkup from '../assets/icons/dashboard-continue.svg?raw'
import dashboardQuickStartIconMarkup from '../assets/icons/dashboard-quick-start.svg?raw'
import sidebarPlusIconMarkup from '../assets/icons/custom/plus.svg?raw'
import sidebarVectorAltIconMarkup from '../assets/icons/custom/vector-1.svg?raw'
import quickStartDashboardImage from '../assets/images/dashboard/quick-start.png'
import newWorldDashboardImage from '../assets/images/dashboard/new-world.png'
import shopDashboardImage from '../assets/images/dashboard/shop.png'

const DEFAULT_CONTINUE_DESCRIPTION = 'Продолжите историю с последнего хода.'
const LAST_PLAYED_GAME_STORAGE_KEY = 'morius.mobile-last-played-game'

type RememberedLastPlayedGameCard = {
  headline: string
  description: string
  imageSrc: string | null
  imagePosition?: string
}

type BuildUnifiedMobileQuickActionsOptions = {
  onContinue: () => void
  onQuickStart: () => void
  onCreateWorld: () => void
  onOpenShop: () => void
  continueDescription?: string
  continueHeadline?: string
  continueImageSrc?: string | null
  continueImageMode?: 'contain' | 'cover'
  continueImagePosition?: string
  isContinueDisabled?: boolean
}

type RememberLastPlayedGameCardOptions = {
  displayTitle?: string | null
}

function clampCoverPosition(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return 50
  }
  return Math.max(0, Math.min(rawValue, 100))
}

function buildContinueHeadline(game: StoryGameSummary, displayTitle?: string | null): string {
  const resolvedTitle = (displayTitle ?? game.title).replace(/\s+/g, ' ').trim()
  if (resolvedTitle) {
    return resolvedTitle
  }
  return `Игра #${game.id}`
}

function buildContinueDescription(game: StoryGameSummary): string {
  const descriptionSource = (game.description || game.latest_message_preview || game.opening_scene || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!descriptionSource) {
    return DEFAULT_CONTINUE_DESCRIPTION
  }
  return descriptionSource
}

function readRememberedLastPlayedGameCard(): RememberedLastPlayedGameCard | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(LAST_PLAYED_GAME_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<RememberedLastPlayedGameCard> | null
    const headline = typeof parsed?.headline === 'string' ? parsed.headline.replace(/\s+/g, ' ').trim() : ''
    const description = typeof parsed?.description === 'string' ? parsed.description.replace(/\s+/g, ' ').trim() : ''
    const imageSrc = typeof parsed?.imageSrc === 'string' ? parsed.imageSrc.trim() : null
    const imagePosition = typeof parsed?.imagePosition === 'string' ? parsed.imagePosition.trim() : ''
    if (!headline || !description) {
      return null
    }

    return {
      headline,
      description,
      imageSrc: imageSrc || null,
      imagePosition: imagePosition || undefined,
    }
  } catch {
    return null
  }
}

export function rememberLastPlayedGameCard(
  game: StoryGameSummary | null,
  options: RememberLastPlayedGameCardOptions = {},
): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (!game) {
      window.localStorage.removeItem(LAST_PLAYED_GAME_STORAGE_KEY)
      return
    }

    const nextSnapshot: RememberedLastPlayedGameCard = {
      headline: buildContinueHeadline(game, options.displayTitle),
      description: buildContinueDescription(game),
      imageSrc: game.cover_image_url?.trim() || null,
      imagePosition: `${clampCoverPosition(game.cover_position_x)}% ${clampCoverPosition(game.cover_position_y)}%`,
    }
    window.localStorage.setItem(LAST_PLAYED_GAME_STORAGE_KEY, JSON.stringify(nextSnapshot))
  } catch {
    // Ignore storage restrictions and keep the UI functional.
  }
}

export function buildUnifiedMobileQuickActions({
  onContinue,
  onQuickStart,
  onCreateWorld,
  onOpenShop,
  continueDescription,
  continueHeadline,
  continueImageSrc,
  continueImageMode,
  continueImagePosition,
  isContinueDisabled = false,
}: BuildUnifiedMobileQuickActionsOptions): AppHeaderMobileActionItem[] {
  const rememberedContinue = readRememberedLastPlayedGameCard()
  const resolvedContinueHeadline =
    typeof continueHeadline === 'undefined' ? rememberedContinue?.headline : continueHeadline
  const resolvedContinueDescription = continueDescription ?? rememberedContinue?.description ?? DEFAULT_CONTINUE_DESCRIPTION
  const resolvedContinueImageSrc =
    typeof continueImageSrc === 'undefined' ? rememberedContinue?.imageSrc ?? null : continueImageSrc
  const resolvedContinueImageMode =
    typeof continueImageMode === 'undefined'
      ? resolvedContinueImageSrc
        ? 'cover'
        : 'contain'
      : continueImageMode
  const resolvedContinueImagePosition =
    typeof continueImagePosition === 'undefined' ? rememberedContinue?.imagePosition : continueImagePosition

  return [
    {
      key: 'continue',
      title: 'Продолжить',
      description: resolvedContinueDescription,
      headline: resolvedContinueHeadline,
      imageSrc: resolvedContinueImageSrc || undefined,
      imageMode: resolvedContinueImageMode,
      imagePosition: resolvedContinueImagePosition,
      iconMarkup: dashboardContinueIconMarkup,
      onClick: onContinue,
      disabled: isContinueDisabled,
    },
    {
      key: 'quick-start',
      title: 'Быстрый старт',
      description: 'Выберите жанр, класс, имя героя и получите готовую стартовую сцену за пару шагов.',
      imageSrc: quickStartDashboardImage,
      iconMarkup: dashboardQuickStartIconMarkup,
      onClick: onQuickStart,
    },
    {
      key: 'new-world',
      title: 'Новый мир',
      description: 'Соберите сеттинг, правила и персонажей вручную с полной настройкой мира.',
      imageSrc: newWorldDashboardImage,
      iconMarkup: sidebarPlusIconMarkup,
      onClick: onCreateWorld,
    },
    {
      key: 'shop',
      title: 'Магазин',
      description: 'Откройте пакеты солов и пополнение.',
      imageSrc: shopDashboardImage,
      iconMarkup: sidebarVectorAltIconMarkup,
      onClick: onOpenShop,
    },
  ]
}
