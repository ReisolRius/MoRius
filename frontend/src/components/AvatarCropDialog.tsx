import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react'
import './AvatarCropDialog.css'

type Size = {
  width: number
  height: number
}

type Layout = Size & {
  x: number
  y: number
}

type Selection = {
  centerX: number
  centerY: number
  radius: number
}

type DragState = {
  pointerId: number
  startPointerX: number
  startPointerY: number
  startCenterX: number
  startCenterY: number
}

type AvatarCropDialogProps = {
  open: boolean
  imageSrc: string | null
  onCancel: () => void
  onSave: (croppedDataUrl: string) => void
  isSaving?: boolean
  outputSize?: number
}

const DEFAULT_OUTPUT_SIZE = 512
const MIN_RADIUS = 50

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function getContainedImageLayout(container: Size, natural: Size): Layout {
  const imageAspect = natural.width / natural.height
  const containerAspect = container.width / container.height

  if (containerAspect > imageAspect) {
    const height = container.height
    const width = height * imageAspect
    return {
      x: (container.width - width) / 2,
      y: 0,
      width,
      height,
    }
  }

  const width = container.width
  const height = width / imageAspect
  return {
    x: 0,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

function AvatarCropDialog({
  open,
  imageSrc,
  onCancel,
  onSave,
  isSaving = false,
  outputSize = DEFAULT_OUTPUT_SIZE,
}: AvatarCropDialogProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const [naturalImageSize, setNaturalImageSize] = useState<Size | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setNaturalImageSize(null)
    setSelection(null)
    setDragState(null)
    imageRef.current = null
  }, [imageSrc, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isSaving, onCancel, open])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const stage = stageRef.current
    if (!stage) {
      return
    }

    const syncSize = () => {
      setContainerSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      })
    }

    syncSize()
    const observer = new ResizeObserver(syncSize)
    observer.observe(stage)
    window.addEventListener('resize', syncSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncSize)
    }
  }, [open])

  const imageLayout = useMemo(() => {
    if (!naturalImageSize || containerSize.width === 0 || containerSize.height === 0) {
      return null
    }
    return getContainedImageLayout(containerSize, naturalImageSize)
  }, [containerSize, naturalImageSize])

  useEffect(() => {
    if (!open || !imageLayout) {
      return
    }

    setSelection((previous) => {
      const maxRadius = Math.max(10, Math.min(imageLayout.width, imageLayout.height) / 2 - 2)
      const initialRadius = clamp(Math.min(imageLayout.width, imageLayout.height) * 0.28, MIN_RADIUS, maxRadius)
      const radius = previous ? clamp(previous.radius, 10, maxRadius) : initialRadius

      return {
        centerX: previous
          ? clamp(previous.centerX, imageLayout.x + radius, imageLayout.x + imageLayout.width - radius)
          : imageLayout.x + imageLayout.width / 2,
        centerY: previous
          ? clamp(previous.centerY, imageLayout.y + radius, imageLayout.y + imageLayout.height - radius)
          : imageLayout.y + imageLayout.height / 2,
        radius,
      }
    })
  }, [imageLayout, open])

  const getPointerInStage = useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) {
      return null
    }

    const rect = stageRef.current.getBoundingClientRect()
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }, [])

  useEffect(() => {
    if (!dragState || !selection || !imageLayout) {
      return
    }

    const minX = imageLayout.x + selection.radius
    const maxX = imageLayout.x + imageLayout.width - selection.radius
    const minY = imageLayout.y + selection.radius
    const maxY = imageLayout.y + imageLayout.height - selection.radius

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const point = getPointerInStage(event.clientX, event.clientY)
      if (!point) {
        return
      }

      const dx = point.x - dragState.startPointerX
      const dy = point.y - dragState.startPointerY

      setSelection({
        ...selection,
        centerX: clamp(dragState.startCenterX + dx, minX, maxX),
        centerY: clamp(dragState.startCenterY + dy, minY, maxY),
      })
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerId) {
        setDragState(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [dragState, getPointerInStage, imageLayout, selection])

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    imageRef.current = image
    setNaturalImageSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }

  const handleSelectionPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selection || isSaving) {
      return
    }

    const point = getPointerInStage(event.clientX, event.clientY)
    if (!point) {
      return
    }

    event.preventDefault()
    setDragState({
      pointerId: event.pointerId,
      startPointerX: point.x,
      startPointerY: point.y,
      startCenterX: selection.centerX,
      startCenterY: selection.centerY,
    })
  }

  const handleSave = () => {
    if (!selection || !imageLayout || !imageRef.current || isSaving) {
      return
    }

    const scaleX = imageRef.current.naturalWidth / imageLayout.width
    const scaleY = imageRef.current.naturalHeight / imageLayout.height

    const sourceWidth = selection.radius * 2 * scaleX
    const sourceHeight = selection.radius * 2 * scaleY

    const sourceX = clamp(
      (selection.centerX - selection.radius - imageLayout.x) * scaleX,
      0,
      Math.max(0, imageRef.current.naturalWidth - sourceWidth),
    )
    const sourceY = clamp(
      (selection.centerY - selection.radius - imageLayout.y) * scaleY,
      0,
      Math.max(0, imageRef.current.naturalHeight - sourceHeight),
    )

    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      imageRef.current,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputSize,
      outputSize,
    )

    onSave(canvas.toDataURL('image/png'))
  }

  if (!open || !imageSrc) {
    return null
  }

  const holeLeft = selection ? selection.centerX - selection.radius : 0
  const holeTop = selection ? selection.centerY - selection.radius : 0
  const holeSize = selection ? selection.radius * 2 : 0

  return (
    <div
      className="avatar-crop-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onCancel()
        }
      }}
    >
      <div className="avatar-crop-modal" role="dialog" aria-modal="true" aria-label="Настройка аватара">
        <div className="avatar-crop-title">Настройка аватара</div>
        <div ref={stageRef} className="avatar-crop-stage">
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Загруженное изображение"
            draggable={false}
            onLoad={handleImageLoad}
            className="avatar-crop-image"
            style={
              imageLayout
                ? {
                    left: imageLayout.x,
                    top: imageLayout.y,
                    width: imageLayout.width,
                    height: imageLayout.height,
                  }
                : undefined
            }
          />

          {selection ? (
            <>
              <div className="avatar-crop-overlay" style={{ left: 0, top: 0, width: '100%', height: holeTop }} />
              <div
                className="avatar-crop-overlay"
                style={{ left: 0, top: holeTop, width: holeLeft, height: holeSize }}
              />
              <div
                className="avatar-crop-overlay"
                style={{
                  left: holeLeft + holeSize,
                  top: holeTop,
                  width: `calc(100% - ${holeLeft + holeSize}px)`,
                  height: holeSize,
                }}
              />
              <div
                className="avatar-crop-overlay"
                style={{ left: 0, top: holeTop + holeSize, width: '100%', height: `calc(100% - ${holeTop + holeSize}px)` }}
              />
              <button
                type="button"
                className="avatar-crop-selection"
                onPointerDown={handleSelectionPointerDown}
                disabled={isSaving}
                style={{
                  left: holeLeft,
                  top: holeTop,
                  width: holeSize,
                  height: holeSize,
                }}
                aria-label="Область кадрирования аватара"
              />
            </>
          ) : (
            <div className="avatar-crop-loading">Загружаем изображение…</div>
          )}
        </div>
        <div className="avatar-crop-actions">
          <button type="button" onClick={onCancel} className="avatar-crop-button avatar-crop-button--ghost" disabled={isSaving}>
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="avatar-crop-button avatar-crop-button--primary"
            disabled={!selection || isSaving}
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AvatarCropDialog
