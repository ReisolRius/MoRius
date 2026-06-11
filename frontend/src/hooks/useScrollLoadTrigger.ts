import { useEffect, useRef, useState } from 'react'
import { useVisibilityTrigger } from './useVisibilityTrigger'

type UseScrollLoadTriggerOptions = {
  rootMargin?: string
  threshold?: number | number[]
  disabled?: boolean
}

export function useScrollLoadTrigger<T extends HTMLElement = HTMLElement>({
  rootMargin = '120px 0px',
  threshold = 0,
  disabled = false,
}: UseScrollLoadTriggerOptions = {}) {
  const [pendingScrollSignal, setPendingScrollSignal] = useState(false)
  const [loadMoreSignal, setLoadMoreSignal] = useState(0)
  const lastScrollTopRef = useRef(0)
  const isArmedRef = useRef(true)
  const { ref, isVisible } = useVisibilityTrigger<T>({
    rootMargin,
    threshold,
    once: false,
    disabled,
  })

  useEffect(() => {
    if (disabled) {
      setPendingScrollSignal(false)
      isArmedRef.current = true
      return
    }

    const scrollingElement = document.scrollingElement ?? document.documentElement
    lastScrollTopRef.current = window.scrollY || scrollingElement.scrollTop || 0

    const handleScroll = () => {
      const activeScrollingElement = document.scrollingElement ?? document.documentElement
      const currentScrollTop = window.scrollY || activeScrollingElement.scrollTop || 0
      const isScrollingDown = currentScrollTop > lastScrollTopRef.current
      lastScrollTopRef.current = currentScrollTop

      if (!isScrollingDown) {
        setPendingScrollSignal(false)
        return
      }

      setPendingScrollSignal(true)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [disabled])

  useEffect(() => {
    if (disabled) {
      return
    }

    if (!isVisible) {
      isArmedRef.current = true
      return
    }

    if (!pendingScrollSignal || !isArmedRef.current) {
      return
    }

    isArmedRef.current = false
    setPendingScrollSignal(false)
    setLoadMoreSignal((currentSignal) => currentSignal + 1)
  }, [disabled, isVisible, pendingScrollSignal])

  return {
    ref,
    loadMoreSignal,
  }
}
