import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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

type InteractionState =
  | {
      type: 'move'
      pointerId: number
      startPointerX: number
      startPointerY: number
      startSelection: Selection
    }
  | {
      type: 'resize'
      pointerId: number
      startSelection: Selection
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

function getRadiusBounds(layout: Layout, centerX: number, centerY: number): { min: number; max: number } {
  const max = Math.max(
    12,
    Math.min(
      centerX - layout.x,
      layout.x + layout.width - centerX,
      centerY - layout.y,
      layout.y + layout.height - centerY,
    ),
  )
  return {
    min: Math.min(max, 12),
    max,
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
  const [interaction, setInteraction] = useState<InteractionState | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setNaturalImageSize(null)
    setSelection(null)
    setInteraction(null)
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
      const centerX = previous ? previous.centerX : imageLayout.x + imageLayout.width / 2
      const centerY = previous ? previous.centerY : imageLayout.y + imageLayout.height / 2
      const bounds = getRadiusBounds(imageLayout, centerX, centerY)
      const initialRadius = clamp(Math.min(imageLayout.width, imageLayout.height) * 0.28, bounds.min, bounds.max)
      const radius = previous ? clamp(previous.radius, bounds.min, bounds.max) : initialRadius

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
    if (!interaction || !selection || !imageLayout) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return
      }

      const point = getPointerInStage(event.clientX, event.clientY)
      if (!point) {
        return
      }

      if (interaction.type === 'move') {
        const dx = point.x - interaction.startPointerX
        const dy = point.y - interaction.startPointerY
        const minX = imageLayout.x + interaction.startSelection.radius
        const maxX = imageLayout.x + imageLayout.width - interaction.startSelection.radius
        const minY = imageLayout.y + interaction.startSelection.radius
        const maxY = imageLayout.y + imageLayout.height - interaction.startSelection.radius

        setSelection({
          ...interaction.startSelection,
          centerX: clamp(interaction.startSelection.centerX + dx, minX, maxX),
          centerY: clamp(interaction.startSelection.centerY + dy, minY, maxY),
        })
        return
      }

      const distanceFromCenter = Math.hypot(point.x - interaction.startSelection.centerX, point.y - interaction.startSelection.centerY)
      const bounds = getRadiusBounds(
        imageLayout,
        interaction.startSelection.centerX,
        interaction.startSelection.centerY,
      )
      const nextRadius = clamp(distanceFromCenter, bounds.min, bounds.max)

      setSelection({
        ...interaction.startSelection,
        radius: nextRadius,
      })
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === interaction.pointerId) {
        setInteraction(null)
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
  }, [getPointerInStage, imageLayout, interaction, selection])

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
    setInteraction({
      type: 'move',
      pointerId: event.pointerId,
      startPointerX: point.x,
      startPointerY: point.y,
      startSelection: selection,
    })
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selection || isSaving) {
      return
    }

    const point = getPointerInStage(event.clientX, event.clientY)
    if (!point) {
      return
    }

    event.preventDefault()
    setInteraction({
      type: 'resize',
      pointerId: event.pointerId,
      startSelection: selection,
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
  const overlayStyle = selection
    ? ({
        '--crop-center-x': `${selection.centerX}px`,
        '--crop-center-y': `${selection.centerY}px`,
        '--crop-radius': `${selection.radius}px`,
      } as CSSProperties)
    : undefined
  const resizeHandleStyle = selection
    ? ({
        left: selection.centerX + selection.radius * Math.SQRT1_2,
        top: selection.centerY + selection.radius * Math.SQRT1_2,
      } as CSSProperties)
    : undefined

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
              <div className="avatar-crop-overlay" style={overlayStyle} />
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
              <button
                type="button"
                className="avatar-crop-resize-handle"
                onPointerDown={handleResizePointerDown}
                disabled={isSaving}
                style={resizeHandleStyle}
                aria-label="Изменить размер области кадрирования"
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
