import { useEffect, useMemo, useState } from 'react'
import { useVisibilityTrigger } from './useVisibilityTrigger'

type UseIncrementalListOptions = {
  initialCount?: number
  step?: number
  enabled?: boolean
  resetKey?: unknown
  rootMargin?: string
}

export function useIncrementalList<T>(
  items: T[],
  {
    initialCount = 10,
    step = 10,
    enabled = true,
    resetKey,
    rootMargin = '800px 0px',
  }: UseIncrementalListOptions = {},
) {
  const [visibleCount, setVisibleCount] = useState(enabled ? initialCount : items.length)

  useEffect(() => {
    setVisibleCount(enabled ? initialCount : items.length)
  }, [enabled, initialCount, items.length, resetKey])

  const hasMore = enabled && visibleCount < items.length
  const { ref: loadMoreRef, isVisible: isLoadMoreVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin,
    once: false,
    disabled: !hasMore,
  })

  useEffect(() => {
    if (!enabled || !isLoadMoreVisible || !hasMore) {
      return
    }

    setVisibleCount((currentCount) => Math.min(items.length, currentCount + step))
  }, [enabled, hasMore, isLoadMoreVisible, items.length, step])

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
