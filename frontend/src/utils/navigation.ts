/**
 * Moves the SPA to `path` from components that are not handed App's navigate callback.
 * App listens to popstate and re-resolves the page from the URL, the same mechanism the
 * header already used to open the wiki.
 */
export function navigateInApp(path: string): void {
  if (typeof window === 'undefined') {
    return
  }
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (currentHref !== path) {
    window.history.pushState({}, '', path)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}
