import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

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

    window.localStorage.setItem(PAGE_MENU_STORAGE_KEY, isPageMenuOpen ? '1' : '0')
  }, [isPageMenuOpen])

  return [isPageMenuOpen, setIsPageMenuOpen]
}
