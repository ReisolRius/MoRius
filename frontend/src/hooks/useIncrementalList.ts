import { useEffect, useMemo, useState } from 'react'
import { useVisibilityTrigger } from './useVisibilityTrigger'

type UseIncrementalListOptions = {
  initialCount?: number
  step?: number
  enabled?: boolean
  resetKey?: unknown
  rootMargin?: string
  hasMoreRemote?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function useIncrementalList<T>(
  items: T[],
  {
    initialCount = 10,
    step = 10,
    enabled = true,
    resetKey,
    rootMargin = '120px 0px',
    hasMoreRemote = false,
    isLoadingMore = false,
    onLoadMore,
  }: UseIncrementalListOptions = {},
) {
  const [visibleCount, setVisibleCount] = useState(enabled ? initialCount : items.length)

  useEffect(() => {
    setVisibleCount(enabled ? initialCount : items.length)
  }, [enabled, initialCount, resetKey])

  useEffect(() => {
    if (!enabled) {
      setVisibleCount(items.length)
      return
    }
    setVisibleCount((currentCount) => Math.min(currentCount, Math.max(items.length, initialCount)))
  }, [enabled, initialCount, items.length])

  const hasMoreLocal = enabled && visibleCount < items.length
  const hasMore = hasMoreLocal || (enabled && hasMoreRemote)
  const { ref: loadMoreRef, isVisible: isLoadMoreVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin,
    once: false,
    disabled: !hasMore || isLoadingMore,
  })

  useEffect(() => {
    if (!enabled || !isLoadMoreVisible || !hasMore) {
      return
    }

    if (hasMoreLocal) {
      setVisibleCount((currentCount) => Math.min(items.length, currentCount + step))
      return
    }

    if (hasMoreRemote && !isLoadingMore) {
      onLoadMore?.()
    }
  }, [enabled, hasMore, hasMoreLocal, hasMoreRemote, isLoadMoreVisible, isLoadingMore, items.length, onLoadMore, step])

  const visibleItems = useMemo(
    () => (enabled ? items.slice(0, visibleCount) : items),
    [enabled, items, visibleCount],
  )

  return {
    visibleItems,
    visibleCount,
    totalCount: items.length,
    hasMore,
    loadMoreRef,
  }
}
