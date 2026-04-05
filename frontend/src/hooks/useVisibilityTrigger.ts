import { useEffect, useRef, useState } from 'react'

type UseVisibilityTriggerOptions = {
  rootMargin?: string
  threshold?: number | number[]
  once?: boolean
  disabled?: boolean
}

export function useVisibilityTrigger<T extends HTMLElement = HTMLElement>({
  rootMargin = '0px',
  threshold = 0,
  once = true,
  disabled = false,
}: UseVisibilityTriggerOptions = {}) {
  const ref = useRef<T | null>(null)
  const [isVisible, setIsVisible] = useState(
    disabled || typeof window === 'undefined' || typeof window.IntersectionObserver === 'undefined',
  )

  useEffect(() => {
    if (disabled) {
      setIsVisible(true)
      return
    }

    if (typeof window === 'undefined' || typeof window.IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const node = ref.current
    if (!node) {
      return
    }

    if (once && isVisible) {
      return
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) {
          return
        }

        if (entry.isIntersecting) {
          setIsVisible(true)
          if (once) {
            observer.disconnect()
          }
          return
        }

        if (!once) {
          setIsVisible(false)
        }
      },
      {
        rootMargin,
        threshold,
      },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [disabled, isVisible, once, rootMargin, threshold])

  return {
    ref,
    isVisible,
  }
}
