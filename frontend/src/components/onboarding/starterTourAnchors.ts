/**
 * Geometry for the starter tour's spotlight.
 *
 * Two of the anchors are whole page sections - a slider header plus a row of cards - and on a
 * phone they are taller than the screen. Cutting a hole that big leaves the overlay meaningless
 * and the card with nowhere to sit, so a tall anchor is clipped to the top slice that actually
 * shows what the step is talking about, and "is it in view?" is judged on that slice.
 */

export const MORU_WIKI_PATH = '/wiki'
export const MORU_TELEGRAM_URL = 'https://t.me/+t2ueY4x_KvE4ZWEy'

export type AnchorRect = {
  top: number
  left: number
  right: number
  bottom: number
}

/** How much of the viewport a single cutout may claim before it gets clipped. */
const MAX_ANCHOR_HEIGHT_RATIO = 0.56

function getViewportHeight(): number {
  return typeof window === 'undefined' ? 900 : window.innerHeight
}

export function isAnchorTallerThanViewport(element: HTMLElement): boolean {
  return element.getBoundingClientRect().height > getViewportHeight() * MAX_ANCHOR_HEIGHT_RATIO
}

/** The rect the spotlight actually cuts out: the element's box, clipped when it is oversized. */
export function getStarterTourAnchorRect(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect()
  const maxHeight = getViewportHeight() * MAX_ANCHOR_HEIGHT_RATIO

  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.height > maxHeight ? rect.top + maxHeight : rect.bottom,
  }
}

/**
 * A tall anchor only has to have its top slice on screen; a normal one has to fit whole, with a
 * little breathing room, before the card is allowed to point at it.
 */
export function isStarterTourAnchorInView(element: HTMLElement, isPinned: boolean): boolean {
  const rect = element.getBoundingClientRect()
  const viewportHeight = getViewportHeight()
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth

  if (isPinned) {
    // A fixed header button is always where it is - scrolling would never move it.
    return rect.bottom >= 4 && rect.top <= viewportHeight - 4 && rect.right >= 4 && rect.left <= viewportWidth - 4
  }

  if (rect.height > viewportHeight * MAX_ANCHOR_HEIGHT_RATIO) {
    return rect.top >= -8 && rect.top <= viewportHeight * 0.34
  }

  const margin = Math.max(20, Math.min(72, Math.round(viewportHeight * 0.06)))
  return rect.top >= -margin && rect.bottom <= viewportHeight + margin
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Centres a normal anchor; a tall one is aligned near the top so its head is the part shown.
 *
 * `instant` is the escape hatch. A smooth scroll only advances while the page is animating, and
 * a page that is not - a background tab, a browser honouring reduced motion, a tab throttled by
 * the OS - would leave the tour waiting on a scroll that never happens. After a couple of
 * unanswered nudges the caller asks for the jump instead.
 */
export function scrollStarterTourAnchorIntoView(element: HTMLElement, options?: { instant?: boolean }): void {
  element.scrollIntoView({
    behavior: options?.instant || prefersReducedMotion() ? 'auto' : 'smooth',
    block: isAnchorTallerThanViewport(element) ? 'start' : 'center',
    inline: 'nearest',
  })
}
