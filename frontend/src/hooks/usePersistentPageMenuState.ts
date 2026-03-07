import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { PAGE_MENU_CONTROL_EVENT, type PageMenuControlDetail } from '../utils/onboardingGuide'

const PAGE_MENU_STORAGE_KEY = 'morius.page-menu-open'

function readInitialPageMenuState() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(PAGE_MENU_STORAGE_KEY) === '1'
}

export function usePersistentPageMenuState(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState<boolean>(readInitialPageMenuState)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePageMenuControl = (event: Event) => {
      const detail = (event as CustomEvent<PageMenuControlDetail>).detail
      if (!detail) {
        return
      }

      setIsPageMenuOpen((previous) => {
        if (detail.action === 'open') {
          return true
        }
        if (detail.action === 'close') {
          return false
        }
        return !previous
      })
    }

    window.addEventListener(PAGE_MENU_CONTROL_EVENT, handlePageMenuControl as EventListener)
    return () => {
      window.removeEventListener(PAGE_MENU_CONTROL_EVENT, handlePageMenuControl as EventListener)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(PAGE_MENU_STORAGE_KEY, isPageMenuOpen ? '1' : '0')
  }, [isPageMenuOpen])

  return [isPageMenuOpen, setIsPageMenuOpen]
}
