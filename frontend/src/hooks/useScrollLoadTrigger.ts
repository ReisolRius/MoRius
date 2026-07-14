import { useEffect, useRef, useState } from 'react'
import { useVisibilityTrigger } from './useVisibilityTrigger'

type UseScrollLoadTriggerOptions = {
  rootMargin?: string
  threshold?: number | number[]
  disabled?: boolean
}

export function useScrollLoadTrigger<T extends HTMLElement = HTMLElement>({
  rootMargin = '320px 0px',
  threshold = 0,
  disabled = false,
}: UseScrollLoadTriggerOptions = {}) {
  const [loadMoreSignal, setLoadMoreSignal] = useState(0)
  const lastTriggeredAtRef = useRef(0)
  const { ref, isVisible } = useVisibilityTrigger<T>({
    rootMargin,
    threshold,
    once: false,
    disabled,
  })

  useEffect(() => {
    if (disabled || !isVisible) {
      return
    }

    const elapsed = Date.now() - lastTriggeredAtRef.current
    const delay = Math.max(80, 120 - elapsed)
    const timeoutId = window.setTimeout(() => {
      lastTriggeredAtRef.current = Date.now()
      setLoadMoreSignal((currentSignal) => currentSignal + 1)
    }, delay)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [disabled, isVisible, loadMoreSignal])

  return {
    ref,
    loadMoreSignal,
  }
}
