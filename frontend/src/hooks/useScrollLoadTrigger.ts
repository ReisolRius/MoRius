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

    const timeoutId = window.setTimeout(() => {
      const now = Date.now()
      if (now - lastTriggeredAtRef.current < 120) {
        return
      }
      lastTriggeredAtRef.current = now
      setLoadMoreSignal((currentSignal) => currentSignal + 1)
    }, 80)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [disabled, isVisible, loadMoreSignal])

  return {
    ref,
    loadMoreSignal,
  }
}
