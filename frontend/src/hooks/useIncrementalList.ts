/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useScrollLoadTrigger } from './useScrollLoadTrigger'

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
    initialCount = 12,
    step = 12,
    enabled = true,
    resetKey,
    rootMargin = '120px 0px',
    hasMoreRemote = false,
    isLoadingMore = false,
    onLoadMore,
  }: UseIncrementalListOptions = {},
) {
  const [visibleCount, setVisibleCount] = useState(enabled ? initialCount : items.length)
  const lastHandledLoadMoreSignalRef = useRef(0)
  const resetStateRef = useRef({ enabled, initialCount, resetKey })

  const hasMoreLocal = enabled && visibleCount < items.length
  const hasMore = hasMoreLocal || (enabled && hasMoreRemote)
  const { ref: loadMoreRef, loadMoreSignal } = useScrollLoadTrigger<HTMLDivElement>({
    rootMargin,
    disabled: !hasMore || isLoadingMore,
  })

  useEffect(() => {
    const previousResetState = resetStateRef.current
    const hasResetChanged =
      previousResetState.enabled !== enabled ||
      previousResetState.initialCount !== initialCount ||
      !Object.is(previousResetState.resetKey, resetKey)
    if (!hasResetChanged) {
      return
    }
    resetStateRef.current = { enabled, initialCount, resetKey }
    lastHandledLoadMoreSignalRef.current = loadMoreSignal
    setVisibleCount((currentCount) => (enabled ? initialCount : currentCount))
  }, [enabled, initialCount, loadMoreSignal, resetKey])

  useEffect(() => {
    if (!enabled) {
      setVisibleCount(items.length)
      return
    }
    setVisibleCount((currentCount) => Math.min(currentCount, Math.max(items.length, initialCount)))
  }, [enabled, initialCount, items.length])

  useEffect(() => {
    if (!enabled || loadMoreSignal <= 0 || !hasMore || isLoadingMore) {
      return
    }

    if (lastHandledLoadMoreSignalRef.current === loadMoreSignal) {
      return
    }
    lastHandledLoadMoreSignalRef.current = loadMoreSignal

    if (hasMoreLocal) {
      setVisibleCount((currentCount) => Math.min(items.length, currentCount + step))
      return
    }

    if (hasMoreRemote && !isLoadingMore) {
      onLoadMore?.()
    }
  }, [enabled, hasMore, hasMoreLocal, hasMoreRemote, isLoadingMore, items.length, loadMoreSignal, onLoadMore, step])

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
