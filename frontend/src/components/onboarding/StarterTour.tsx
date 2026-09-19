/**
 * The short "where is everything" tour a novice gets right after picking their level.
 *
 * It is deliberately separate from the long chapter guide: four stops on the home page, one in
 * the profile, and a send-off card. Everything it needs it finds by `data-tour-id`, so a step
 * whose anchor is missing on this viewport (the desktop Play button on a phone, say) falls back
 * to the next selector in its list rather than breaking the run.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Box, ButtonBase, CircularProgress, Stack, SvgIcon, Typography } from '@mui/material'

import {
  getStarterTourAnchorRect,
  isStarterTourAnchorInView,
  MORU_TELEGRAM_URL,
  MORU_WIKI_PATH,
  scrollStarterTourAnchorIntoView,
} from './starterTourAnchors'

type StarterTourProps = {
  path: string
  onNavigate: (path: string) => void
  onFinish: (status: 'completed' | 'skipped') => void
}

type TourRect = {
  top: number
  left: number
  width: number
  height: number
  right: number
  bottom: number
}

type TourStep = {
  id: string
  path: string
  /** Tried in order; the first selector with a visible element on this viewport wins. */
  selectors?: string[]
  eyebrow: string
  title: string
  description: string
  padding?: number
  /** Where "Далее" takes the player, when this step hands over to another page. */
  nextPath?: string
  /** The send-off card: centred, wider, with the wiki and Telegram links. */
  isFarewell?: boolean
}

const CARD_MARGIN = 16
const CARD_GAP = 20
const CARD_WIDTH = 384
const FAREWELL_CARD_WIDTH = 480
const CARD_FALLBACK_HEIGHT = 232
const TARGET_POLL_INTERVAL_MS = 60
const TARGET_MAX_ATTEMPTS = 120
const ROUTE_SETTLE_DELAY_MS = 220
const SCROLL_SETTLE_DELAY_MS = 200
/** Backstop for layout the tour cannot hear about: lazy images, a slider easing into place. */
const DRIFT_POLL_INTERVAL_MS = 220
/** Below this the card stops orbiting the target and docks to the top or bottom edge. */
const COMPACT_LAYOUT_WIDTH = 760

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }
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

/** The first visible element among the step's selectors, so a step adapts to the viewport. */
function findStepElement(selectors: string[] | undefined): HTMLElement | null {
  if (!selectors?.length) {
    return null
  }
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const visible = candidates.find((element) => isElementVisible(element))
    if (visible) {
      return visible
    }
  }
  return null
}

function isElementInPinnedLayer(element: HTMLElement): boolean {
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

function buildRect(element: HTMLElement, padding: number): TourRect {
  const rect = getStarterTourAnchorRect(element)
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const left = clamp(rect.left - padding, 6, Math.max(6, viewportWidth - 24))
  const top = clamp(rect.top - padding, 6, Math.max(6, viewportHeight - 24))
  const right = clamp(rect.right + padding, 24, viewportWidth - 6)
  const bottom = clamp(rect.bottom + padding, 24, viewportHeight - 6)

  return {
    top,
    left,
    width: Math.max(28, right - left),
    height: Math.max(28, bottom - top),
    right,
    bottom,
  }
}

function areRectsEqual(left: TourRect | null, right: TourRect | null): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  )
}

function getRectRadius(rect: TourRect): number {
  const minSide = Math.min(rect.width, rect.height)
  if (Math.abs(rect.width - rect.height) <= 20 && Math.max(rect.width, rect.height) <= 96) {
    return Math.max(16, Math.round(minSide / 2))
  }
  return Math.max(14, Math.min(26, Math.round(minSide * 0.16)))
}

/**
 * Where the card sits. Wide viewports orbit the cutout on whichever side has room; narrow ones
 * dock the card to the edge furthest from the target, which is the only placement that reliably
 * clears both a highlighted header button and a highlighted card slider.
 */
function getCardPosition(
  targetRect: TourRect | null,
  cardWidth: number,
  cardHeight: number,
): { top: number; left: number; width: number } {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const isCompact = viewportWidth < COMPACT_LAYOUT_WIDTH
  const width = Math.min(cardWidth, viewportWidth - CARD_MARGIN * 2)
  const height = Math.min(cardHeight || CARD_FALLBACK_HEIGHT, viewportHeight - CARD_MARGIN * 2)
  const maxTop = Math.max(CARD_MARGIN, viewportHeight - height - CARD_MARGIN)
  const maxLeft = Math.max(CARD_MARGIN, viewportWidth - width - CARD_MARGIN)

  if (!targetRect) {
    return {
      top: clamp((viewportHeight - height) / 2, CARD_MARGIN, maxTop),
      left: clamp((viewportWidth - width) / 2, CARD_MARGIN, maxLeft),
      width,
    }
  }

  if (isCompact) {
    const spaceBelow = viewportHeight - targetRect.bottom
    const spaceAbove = targetRect.top
    const shouldDockBelow = spaceBelow >= spaceAbove
    const top = shouldDockBelow
      ? Math.min(targetRect.bottom + CARD_GAP, maxTop)
      : Math.max(targetRect.top - CARD_GAP - height, CARD_MARGIN)
    return {
      top: clamp(top, CARD_MARGIN, maxTop),
      left: clamp((viewportWidth - width) / 2, CARD_MARGIN, maxLeft),
      width,
    }
  }

  const candidates = [
    {
      key: 'right' as const,
      space: viewportWidth - targetRect.right - CARD_MARGIN,
      needed: width + CARD_GAP,
      top: targetRect.top + targetRect.height / 2 - height / 2,
      left: targetRect.right + CARD_GAP,
    },
    {
      key: 'left' as const,
      space: targetRect.left - CARD_MARGIN,
      needed: width + CARD_GAP,
      top: targetRect.top + targetRect.height / 2 - height / 2,
      left: targetRect.left - CARD_GAP - width,
    },
    {
      key: 'bottom' as const,
      space: viewportHeight - targetRect.bottom - CARD_MARGIN,
      needed: height + CARD_GAP,
      top: targetRect.bottom + CARD_GAP,
      left: targetRect.left + targetRect.width / 2 - width / 2,
    },
    {
      key: 'top' as const,
      space: targetRect.top - CARD_MARGIN,
      needed: height + CARD_GAP,
      top: targetRect.top - CARD_GAP - height,
      left: targetRect.left + targetRect.width / 2 - width / 2,
    },
  ]

  const chosen =
    candidates.find((candidate) => candidate.space >= candidate.needed) ??
    [...candidates].sort((a, b) => b.space - a.space)[0]

  return {
    top: clamp(chosen.top, CARD_MARGIN, maxTop),
    left: clamp(chosen.left, CARD_MARGIN, maxLeft),
    width,
  }
}

function StarterTour({ path, onNavigate, onFinish }: StarterTourProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const [isResolvingStep, setIsResolvingStep] = useState(true)
  const [cardHeight, setCardHeight] = useState(CARD_FALLBACK_HEIGHT)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const routeSettleUntilRef = useRef(0)
  const maskIdBase = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  const steps = useMemo<TourStep[]>(
    () => [
      {
        id: 'play',
        path: '/dashboard',
        // Desktop header button first, then the phone bottom-nav play control.
        selectors: ['[data-tour-id="header-play-button"]', '[data-tour-id="mobile-play-button"]'],
        eyebrow: 'Шаг 1',
        title: 'Кнопка «Играть»',
        description:
          'Отсюда начинается любая история. Нажмёте — и сможете продолжить последнюю игру или создать новую с нуля.',
        padding: 10,
      },
      {
        id: 'community-worlds',
        path: '/dashboard',
        selectors: ['[data-tour-id="home-community-section"]'],
        eyebrow: 'Шаг 2',
        title: 'Готовые игры',
        description:
          'Миры, которые уже собрали другие игроки: правила, NPC и вступление настроены. Откройте карточку и запускайте — ничего настраивать не нужно.',
        padding: 14,
      },
      {
        id: 'community-characters',
        path: '/dashboard',
        selectors: ['[data-tour-id="home-characters-section"]'],
        eyebrow: 'Шаг 3',
        title: 'Готовые персонажи',
        description:
          'Чужих героев и NPC можно забрать себе и добавить в любую свою игру. Удобно, если не хочется описывать персонажа самому.',
        padding: 14,
      },
      {
        id: 'profile',
        path: '/dashboard',
        selectors: ['[data-tour-id="header-profile-button"]'],
        eyebrow: 'Шаг 4',
        title: 'Ваш профиль',
        description: 'Ваша база: всё созданное и сохранённое лежит здесь. Нажмите «Далее» — заглянем внутрь.',
        padding: 8,
        nextPath: '/profile',
      },
      {
        id: 'library',
        path: '/profile',
        selectors: ['[data-tour-id="profile-library-section"]'],
        eyebrow: 'Шаг 5',
        title: 'Библиотека',
        description:
          'Здесь хранятся все ваши карточки: игры, персонажи, инструкции и сюжеты. Отсюда вы их открываете, редактируете и запускаете.',
        padding: 12,
      },
      {
        id: 'farewell',
        path: '/profile',
        eyebrow: 'Готово',
        title: 'Хороших игр!',
        description:
          'Это всё, что нужно для старта. Если что-то останется непонятным — в Мору Вики разобран каждый экран, а в нашем Telegram подскажут игроки и админ.',
        isFarewell: true,
      },
    ],
    [],
  )

  const activeStep = steps[activeStepIndex] ?? steps[0]
  const activeStepPath = normalizePathname(activeStep.path)
  const isLastStep = activeStepIndex >= steps.length - 1

  const finish = useCallback(
    (status: 'completed' | 'skipped') => {
      setTargetRect(null)
      onFinish(status)
    },
    [onFinish],
  )

  // Keep the route in step with the tour: a player who wandered off is brought back.
  useEffect(() => {
    if (normalizePathname(path) !== activeStepPath) {
      routeSettleUntilRef.current = Date.now() + ROUTE_SETTLE_DELAY_MS
      onNavigate(activeStep.path)
    }
  }, [activeStep.path, activeStepPath, onNavigate, path])

  // Find the anchor, scroll it into view, then measure it.
  useEffect(() => {
    let isCancelled = false
    let timerId = 0
    let attempts = 0
    let scrollAttempts = 0

    setIsResolvingStep(true)
    setTargetRect(null)

    const resolve = () => {
      if (isCancelled) {
        return
      }

      if (normalizePathname(path) !== activeStepPath) {
        timerId = window.setTimeout(resolve, TARGET_POLL_INTERVAL_MS)
        return
      }

      const settleLeftMs = routeSettleUntilRef.current - Date.now()
      if (settleLeftMs > 0) {
        timerId = window.setTimeout(resolve, settleLeftMs)
        return
      }

      if (!activeStep.selectors?.length) {
        setTargetRect(null)
        setIsResolvingStep(false)
        return
      }

      const element = findStepElement(activeStep.selectors)
      if (!element) {
        attempts += 1
        if (attempts < TARGET_MAX_ATTEMPTS) {
          timerId = window.setTimeout(resolve, TARGET_POLL_INTERVAL_MS)
        } else {
          // The anchor never appeared - show the card centred rather than stalling the tour.
          setTargetRect(null)
          setIsResolvingStep(false)
        }
        return
      }

      if (!isStarterTourAnchorInView(element, isElementInPinnedLayer(element))) {
        // Two smooth nudges, then jump: see `scrollStarterTourAnchorIntoView` for why waiting
        // on a smooth scroll alone can hang.
        scrollStarterTourAnchorIntoView(element, { instant: scrollAttempts >= 2 })
        scrollAttempts += 1
        attempts += 1
        timerId = window.setTimeout(resolve, attempts > 8 ? TARGET_POLL_INTERVAL_MS : SCROLL_SETTLE_DELAY_MS)
        return
      }

      setTargetRect(buildRect(element, activeStep.padding ?? 12))
      setIsResolvingStep(false)
    }

    resolve()

    return () => {
      isCancelled = true
      window.clearTimeout(timerId)
    }
  }, [activeStep, activeStepPath, path])

  // Follow the anchor while the step is on screen: resizes, scrolling, sliders settling, images
  // loading. Scroll and resize cover the moves a player makes; a slow interval catches the rest
  // (a lazy image arriving, a slider animating). Measuring every frame instead would force a
  // layout per frame on a page this heavy - enough to stall painting on a mid-range machine.
  useEffect(() => {
    if (isResolvingStep || !activeStep.selectors?.length) {
      return
    }

    let lastRect: TourRect | null = null
    let frameId = 0

    const measure = () => {
      frameId = 0
      const element = findStepElement(activeStep.selectors)
      if (!element) {
        return
      }
      const nextRect = buildRect(element, activeStep.padding ?? 12)
      if (!areRectsEqual(lastRect, nextRect)) {
        lastRect = nextRect
        setTargetRect(nextRect)
      }
    }

    // Coalesce the bursts a smooth scroll produces into one measurement per frame.
    const scheduleMeasure = () => {
      if (frameId) {
        return
      }
      frameId = window.requestAnimationFrame(measure)
    }

    const intervalId = window.setInterval(scheduleMeasure, DRIFT_POLL_INTERVAL_MS)
    window.addEventListener('scroll', scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      window.clearInterval(intervalId)
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
      window.removeEventListener('scroll', scheduleMeasure, true)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [activeStep, isResolvingStep])

  // The card's own height decides whether it fits beside the target, so measure it for real.
  useEffect(() => {
    const node = cardRef.current
    if (!node) {
      return
    }

    const measure = () => {
      const rect = node.getBoundingClientRect()
      if (rect.height > 0) {
        setCardHeight(rect.height)
      }
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [activeStepIndex])

  const handleNext = useCallback(() => {
    if (isLastStep) {
      finish('completed')
      return
    }
    if (activeStep.nextPath) {
      routeSettleUntilRef.current = Date.now() + ROUTE_SETTLE_DELAY_MS
      onNavigate(activeStep.nextPath)
    }
    setTargetRect(null)
    setIsResolvingStep(true)
    setActiveStepIndex((previous) => previous + 1)
  }, [activeStep, finish, isLastStep, onNavigate])

  const handlePrevious = useCallback(() => {
    if (activeStepIndex <= 0) {
      return
    }
    setTargetRect(null)
    setIsResolvingStep(true)
    setActiveStepIndex((previous) => Math.max(0, previous - 1))
  }, [activeStepIndex])

  // Arrow keys and Escape, so the tour is not mouse-only.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish('skipped')
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault()
        handleNext()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handlePrevious()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [finish, handleNext, handlePrevious])

  const cardWidth = activeStep.isFarewell ? FAREWELL_CARD_WIDTH : CARD_WIDTH
  const cardPosition = useMemo(
    () => getCardPosition(targetRect, cardWidth, cardHeight),
    [cardHeight, cardWidth, targetRect],
  )

  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const overlayShade = 'color-mix(in srgb, var(--morius-app-base) 66%, rgba(2, 5, 11, 0.62))'
  const maskId = `moru-starter-mask-${maskIdBase}-${activeStep.id}`
  const progressPercent = ((activeStepIndex + 1) / steps.length) * 100

  const secondaryButtonSx = {
    minHeight: 40,
    px: 1.6,
    borderRadius: '999px',
    border: 'var(--morius-border-width) solid var(--morius-card-border)',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
    color: 'var(--morius-text-secondary)',
    fontSize: '0.86rem',
    fontWeight: 700,
    transition: 'border-color 180ms ease, color 180ms ease, transform 180ms ease',
    '&:hover': { borderColor: 'var(--morius-accent)', color: 'var(--morius-title-text)', transform: 'translateY(-1px)' },
  } as const

  return (
    <Box
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{ position: 'fixed', inset: 0, zIndex: 1600, animation: 'morius-onboarding-fade-in 220ms ease' }}
    >
      <Box aria-hidden sx={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        {targetRect ? (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
            preserveAspectRatio="none"
            style={{ display: 'block' }}
          >
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width={viewportWidth} height={viewportHeight} fill="white" />
                <rect
                  x={targetRect.left}
                  y={targetRect.top}
                  width={targetRect.width}
                  height={targetRect.height}
                  rx={getRectRadius(targetRect)}
                  ry={getRectRadius(targetRect)}
                  fill="black"
                />
              </mask>
            </defs>
            <rect x="0" y="0" width={viewportWidth} height={viewportHeight} fill={overlayShade} mask={`url(#${maskId})`} />
          </svg>
        ) : (
          <Box sx={{ position: 'fixed', inset: 0, backgroundColor: overlayShade }} />
        )}
      </Box>

      {targetRect ? (
        <Box
          aria-hidden
          sx={{
            position: 'fixed',
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            borderRadius: `${getRectRadius(targetRect)}px`,
            pointerEvents: 'none',
            border: '1px solid color-mix(in srgb, var(--morius-accent) 62%, transparent)',
            boxShadow:
              '0 0 0 4px color-mix(in srgb, var(--morius-accent) 22%, transparent), 0 20px 46px rgba(0, 0, 0, 0.34)',
            transition:
              'top 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1)',
            animation: 'morius-onboarding-target-pulse 2.1s ease-in-out infinite',
          }}
        />
      ) : null}

      <Box
        ref={cardRef}
        role="dialog"
        aria-live="polite"
        aria-label={activeStep.title}
        sx={{
          position: 'fixed',
          top: cardPosition.top,
          left: cardPosition.left,
          width: cardPosition.width,
          maxHeight: `calc(100vh - ${CARD_MARGIN * 2}px)`,
          overflowY: 'auto',
          borderRadius: 'calc(var(--morius-radius) + 6px)',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 97%, rgba(255, 255, 255, 0.02)) 0%, color-mix(in srgb, var(--morius-elevated-bg) 98%, rgba(0, 0, 0, 0.14)) 100%)',
          color: 'var(--morius-text-primary)',
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.5)',
          transition:
            'top 240ms cubic-bezier(0.22, 1, 0.36, 1), left 240ms cubic-bezier(0.22, 1, 0.36, 1), width 240ms ease',
          animation: 'morius-onboarding-card-enter 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            height: 4,
            width: '100%',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 60%, transparent)',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${progressPercent}%`,
              backgroundColor: 'var(--morius-accent)',
              transition: 'width 280ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </Box>

        <Box sx={{ p: { xs: 1.6, sm: 1.9 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography
              sx={{
                color: 'var(--morius-accent)',
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              {activeStep.eyebrow}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 700 }}>
              {activeStepIndex + 1} / {steps.length}
            </Typography>
          </Stack>

          <Typography
            sx={{
              mt: 0.6,
              color: 'var(--morius-title-text)',
              fontSize: { xs: '1.2rem', sm: '1.34rem' },
              fontWeight: 900,
              lineHeight: 1.14,
            }}
          >
            {activeStep.title}
          </Typography>
          <Typography sx={{ mt: 0.8, color: 'var(--morius-text-secondary)', fontSize: '0.93rem', lineHeight: 1.52 }}>
            {activeStep.description}
          </Typography>

          {activeStep.isFarewell ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
              <ButtonBase
                onClick={() => {
                  finish('completed')
                  onNavigate(MORU_WIKI_PATH)
                }}
                sx={{
                  flex: 1,
                  minHeight: 46,
                  px: 1.6,
                  gap: 0.8,
                  borderRadius: '14px',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 46%, var(--morius-card-border))',
                  backgroundColor: 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg))',
                  color: 'var(--morius-title-text)',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-elevated-bg))' },
                }}
              >
                <SvgIcon viewBox="0 0 24 24" sx={{ width: 19, height: 19, color: 'var(--morius-accent)' }}>
                  <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
                    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
                  </g>
                </SvgIcon>
                Мору Вики
              </ButtonBase>
              <ButtonBase
                component="a"
                href={MORU_TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  flex: 1,
                  minHeight: 46,
                  px: 1.6,
                  gap: 0.8,
                  borderRadius: '14px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
                  color: 'var(--morius-title-text)',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  textDecoration: 'none',
                  '&:hover': { borderColor: 'var(--morius-accent)' },
                }}
              >
                <SvgIcon viewBox="0 0 24 24" sx={{ width: 19, height: 19, color: 'var(--morius-accent)' }}>
                  <path
                    d="M21.7 4.3 2.9 11.6c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.4c.2.7 1.1.9 1.6.3l2.5-2.7 4.7 3.5c.6.4 1.4.1 1.6-.6l3-14.9c.2-.8-.6-1.5-1.4-1.2z"
                    fill="currentColor"
                  />
                </SvgIcon>
                Telegram
              </ButtonBase>
            </Stack>
          ) : null}

          {isResolvingStep ? (
            <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 1.1 }}>
              <CircularProgress size={14} sx={{ color: 'var(--morius-accent)' }} />
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem' }}>
                Подсвечиваем нужное место…
              </Typography>
            </Stack>
          ) : null}

          <Stack
            direction="row"
            spacing={0.9}
            alignItems="center"
            justifyContent="space-between"
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 1.5 }}
          >
            <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
              {isLastStep ? null : (
                <ButtonBase onClick={() => finish('skipped')} sx={secondaryButtonSx}>
                  Пропустить
                </ButtonBase>
              )}
              {activeStepIndex === 0 ? null : (
                <ButtonBase onClick={handlePrevious} sx={secondaryButtonSx}>
                  Назад
                </ButtonBase>
              )}
            </Stack>

            <ButtonBase
              onClick={handleNext}
              sx={{
                minHeight: 44,
                px: 2.1,
                borderRadius: '999px',
                backgroundColor: 'var(--morius-accent)',
                color: 'var(--morius-accent-contrast, #161009)',
                fontSize: '0.92rem',
                fontWeight: 900,
                transition: 'filter 180ms ease, transform 180ms ease',
                '&:hover': { filter: 'brightness(1.08)', transform: 'translateY(-1px)' },
              }}
            >
              {isLastStep ? 'Начать играть' : 'Далее'}
            </ButtonBase>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}

export default StarterTour
