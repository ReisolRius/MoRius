import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from 'react'
import { useMediaQuery, type SxProps, type Theme } from '@mui/material'

const MOBILE_DIALOG_MEDIA_QUERY = '(max-width:599.95px)'
const SWIPE_CLOSE_TRIGGER_PX = 96
const SWIPE_LOCK_THRESHOLD_PX = 10

type TouchSession = {
  startX: number
  startY: number
  lockedAxis: 'vertical' | 'blocked' | null
}

type UseMobileDialogSheetOptions = {
  onClose: () => void
  disabled?: boolean
  mediaQuery?: string
  showHandleIndicator?: boolean
}

type MobileDialogPaperTouchHandlers = {
  ref?: RefCallback<HTMLElement>
}

type UseMobileDialogSheetResult = {
  isMobileSheet: boolean
  dialogSx: SxProps<Theme>
  backdropSx: SxProps<Theme>
  paperSx: SxProps<Theme>
  paperTouchHandlers: MobileDialogPaperTouchHandlers
}

function resolveScrollableAncestor(target: EventTarget | null, boundary: HTMLElement): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null
  }

  let node: HTMLElement | null = target
  while (node && node !== boundary) {
    const styles = window.getComputedStyle(node)
    const overflowY = styles.overflowY
    const isScrollable = /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight - node.clientHeight > 2
    if (isScrollable) {
      return node
    }
    node = node.parentElement
  }

  return null
}

function useMobileDialogSheet({
  onClose,
  disabled = false,
  mediaQuery = MOBILE_DIALOG_MEDIA_QUERY,
  showHandleIndicator = true,
}: UseMobileDialogSheetOptions): UseMobileDialogSheetResult {
  const isMobileSheet = useMediaQuery(mediaQuery)
  const sessionRef = useRef<TouchSession | null>(null)
  const onCloseRef = useRef(onClose)
  const disabledRef = useRef(disabled)
  const dragOffsetRef = useRef(0)
  const [paperNode, setPaperNode] = useState<HTMLElement | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  const resetDragState = useCallback(() => {
    sessionRef.current = null
    dragOffsetRef.current = 0
    setIsDragging(false)
    setDragOffset(0)
  }, [])

  const setPaperRef = useCallback<RefCallback<HTMLElement>>((node) => {
    setPaperNode(node)
  }, [])

  useEffect(() => {
    if (!isMobileSheet) {
      resetDragState()
      return
    }

    if (!paperNode) {
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (disabledRef.current) {
        return
      }

      const touch = event.touches[0]
      if (!touch) {
        return
      }

      const scrollableAncestor = resolveScrollableAncestor(event.target, paperNode)
      if (scrollableAncestor && scrollableAncestor.scrollTop > 0) {
        sessionRef.current = null
        dragOffsetRef.current = 0
        setIsDragging(false)
        setDragOffset(0)
        return
      }

      sessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lockedAxis: null,
      }
      setIsDragging(false)
      setDragOffset(0)
    }

    const handleTouchMove = (event: TouchEvent) => {
      const session = sessionRef.current
      if (!session || disabledRef.current) {
        return
      }

      const touch = event.touches[0]
      if (!touch) {
        return
      }

      const deltaX = touch.clientX - session.startX
      const deltaY = touch.clientY - session.startY

      if (!session.lockedAxis) {
        const passedThreshold =
          Math.abs(deltaY) >= SWIPE_LOCK_THRESHOLD_PX || Math.abs(deltaX) >= SWIPE_LOCK_THRESHOLD_PX
        if (!passedThreshold) {
          return
        }

        const shouldLockVertical = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX) * 1.12
        session.lockedAxis = shouldLockVertical ? 'vertical' : 'blocked'
      }

      if (session.lockedAxis !== 'vertical') {
        return
      }

      const nextOffset = Math.max(0, deltaY)
      setIsDragging(true)
      dragOffsetRef.current = nextOffset
      setDragOffset(nextOffset)
      if (nextOffset > 0 && event.cancelable) {
        event.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      if (!sessionRef.current) {
        return
      }

      const shouldClose = dragOffsetRef.current >= SWIPE_CLOSE_TRIGGER_PX
      resetDragState()
      if (shouldClose && !disabledRef.current) {
        onCloseRef.current()
      }
    }

    const handleTouchCancel = () => {
      resetDragState()
    }

    paperNode.addEventListener('touchstart', handleTouchStart, { passive: true })
    paperNode.addEventListener('touchmove', handleTouchMove, { passive: false })
    paperNode.addEventListener('touchend', handleTouchEnd, { passive: true })
    paperNode.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    return () => {
      paperNode.removeEventListener('touchstart', handleTouchStart)
      paperNode.removeEventListener('touchmove', handleTouchMove)
      paperNode.removeEventListener('touchend', handleTouchEnd)
      paperNode.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [isMobileSheet, paperNode, resetDragState])

  const dialogSx = useMemo<SxProps<Theme>>(
    () =>
      (isMobileSheet
        ? {
            '& .MuiDialog-container': {
              alignItems: 'flex-end',
              overscrollBehaviorY: 'none',
            },
          }
        : {}) as SxProps<Theme>,
    [isMobileSheet],
  )

  const backdropSx = useMemo<SxProps<Theme>>(
    () => ({
      backgroundColor: 'rgba(1, 4, 8, 0.92)',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    }),
    [],
  )

  const paperSx = useMemo<SxProps<Theme>>(
    () =>
      isMobileSheet
        ? {
            position: 'relative',
            m: 0,
            width: '100%',
            maxWidth: '100%',
            maxHeight: '100dvh',
            borderRadius: '22px 22px 0 0',
            borderBottom: 'none',
            alignSelf: 'flex-end',
            overflow: 'hidden',
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch',
            '--morius-content-gap': '22px',
            '--morius-title-top-gap': '46px',
            '--morius-title-bottom-gap': '18px',
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : 'translateY(0)',
            transition: isDragging ? 'none' : 'transform 220ms ease',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 94%, #05070d 6%) 0%, color-mix(in srgb, var(--morius-card-bg) 88%, #020304 12%) 100%)',
            boxShadow: '0 -26px 56px rgba(0, 0, 0, 0.42)',
            ...(showHandleIndicator
              ? {
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 10,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 58,
                    height: 6,
                    borderRadius: '999px',
                    background:
                      'color-mix(in srgb, var(--morius-title-text) 62%, color-mix(in srgb, var(--morius-card-bg) 18%, #ffffff 82%) 38%)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--morius-title-text) 18%, transparent)',
                    zIndex: 2,
                  },
                }
              : {}),
          }
        : {},
    [dragOffset, isDragging, isMobileSheet, showHandleIndicator],
  )

  return {
    isMobileSheet,
    dialogSx,
    backdropSx,
    paperSx,
    paperTouchHandlers: {
      ref: setPaperRef,
    },
  }
}

export default useMobileDialogSheet
export { MOBILE_DIALOG_MEDIA_QUERY }
