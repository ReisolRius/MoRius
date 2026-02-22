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
import './ImageCropper.css'

type Point = {
  x: number
  y: number
}

type Size = {
  width: number
  height: number
}

type ImageLayout = Size & {
  x: number
  y: number
}

type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

type CropInteraction =
  | {
      type: 'move'
      startPointer: Point
      startRect: CropRect
    }
  | {
      type: 'resize'
      corner: ResizeCorner
      startPointer: Point
      startRect: CropRect
    }

export type ImageCropperProps = {
  imageSrc: string
  aspect?: number
  onSave: (croppedDataUrl: string) => void
  onCancel: () => void
  frameRadius?: number
  title?: string
  cancelLabel?: string
  saveLabel?: string
}

const DEFAULT_ASPECT = 1
const MIN_CROP_SIZE = 64

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function getContainedImageLayout(container: Size, natural: Size): ImageLayout {
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

function createInitialCropRect(image: ImageLayout, aspect: number): CropRect {
  const maxStartWidth = image.width * 0.72
  const maxStartHeight = image.height * 0.72

  let width = maxStartWidth
  let height = width / aspect

  if (height > maxStartHeight) {
    height = maxStartHeight
    width = height * aspect
  }

  return {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
  }
}

function resizeCropRect(options: {
  corner: ResizeCorner
  pointer: Point
  startRect: CropRect
  image: ImageLayout
  aspect: number
}): CropRect {
  const { corner, pointer, startRect, image, aspect } = options

  let anchorX = 0
  let anchorY = 0
  let widthFromPointer = 0
  let heightFromPointer = 0
  let maxWidth = 0

  if (corner === 'se') {
    anchorX = startRect.x
    anchorY = startRect.y
    widthFromPointer = pointer.x - anchorX
    heightFromPointer = (pointer.y - anchorY) * aspect
    maxWidth = Math.min(image.width - anchorX, (image.height - anchorY) * aspect)
  } else if (corner === 'nw') {
    anchorX = startRect.x + startRect.width
    anchorY = startRect.y + startRect.height
    widthFromPointer = anchorX - pointer.x
    heightFromPointer = (anchorY - pointer.y) * aspect
    maxWidth = Math.min(anchorX, anchorY * aspect)
  } else if (corner === 'ne') {
    anchorX = startRect.x
    anchorY = startRect.y + startRect.height
    widthFromPointer = pointer.x - anchorX
    heightFromPointer = (anchorY - pointer.y) * aspect
    maxWidth = Math.min(image.width - anchorX, anchorY * aspect)
  } else {
    anchorX = startRect.x + startRect.width
    anchorY = startRect.y
    widthFromPointer = anchorX - pointer.x
    heightFromPointer = (pointer.y - anchorY) * aspect
    maxWidth = Math.min(anchorX, (image.height - anchorY) * aspect)
  }

  const minWidth = Math.min(
    maxWidth,
    Math.max(MIN_CROP_SIZE, Math.min(image.width, image.height * aspect) * 0.12),
  )

  const candidateWidth = Math.min(widthFromPointer, heightFromPointer)
  const width = clamp(candidateWidth, minWidth, maxWidth)
  const height = width / aspect

  if (corner === 'se') {
    return {
      x: anchorX,
      y: anchorY,
      width,
      height,
    }
  }

  if (corner === 'nw') {
    return {
      x: anchorX - width,
      y: anchorY - height,
      width,
      height,
    }
  }

  if (corner === 'ne') {
    return {
      x: anchorX,
      y: anchorY - height,
      width,
      height,
    }
  }

  return {
    x: anchorX - width,
    y: anchorY,
    width,
    height,
  }
}

export function ImageCropper({
  imageSrc,
  aspect = DEFAULT_ASPECT,
  onSave,
  onCancel,
  frameRadius = 12,
  title = 'Настройка изображения',
  cancelLabel = 'Отмена',
  saveLabel = 'Сохранить',
}: ImageCropperProps) {
  const normalizedAspect = aspect > 0 ? aspect : DEFAULT_ASPECT

  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageElementRef = useRef<HTMLImageElement | null>(null)
  const previousImageLayoutRef = useRef<ImageLayout | null>(null)

  const [containerSize, setContainerSize] = useState<Size>({
    width: 0,
    height: 0,
  })
  const [naturalImageSize, setNaturalImageSize] = useState<Size | null>(null)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [interaction, setInteraction] = useState<CropInteraction | null>(null)

  useEffect(() => {
    setNaturalImageSize(null)
    setCropRect(null)
    previousImageLayoutRef.current = null
    imageElementRef.current = null
  }, [imageSrc])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const syncSize = () =>
      setContainerSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      })

    syncSize()

    const observer = new ResizeObserver(syncSize)
    observer.observe(stage)
    window.addEventListener('resize', syncSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncSize)
    }
  }, [])

  const imageLayout = useMemo(() => {
    if (!naturalImageSize || containerSize.width === 0 || containerSize.height === 0) {
      return null
    }

    return getContainedImageLayout(containerSize, naturalImageSize)
  }, [containerSize, naturalImageSize])

  useEffect(() => {
    if (!imageLayout) {
      return
    }

    setCropRect((previous) => {
      const previousLayout = previousImageLayoutRef.current
      previousImageLayoutRef.current = imageLayout

      if (!previous || !previousLayout) {
        return createInitialCropRect(imageLayout, normalizedAspect)
      }

      const scale = imageLayout.width / previousLayout.width
      const next = {
        x: previous.x * scale,
        y: previous.y * scale,
        width: previous.width * scale,
        height: previous.height * scale,
      }

      return {
        x: clamp(next.x, 0, imageLayout.width - next.width),
        y: clamp(next.y, 0, imageLayout.height - next.height),
        width: next.width,
        height: next.height,
      }
    })
  }, [imageLayout, normalizedAspect])

  const getPointerInImageSpace = useCallback(
    (clientX: number, clientY: number): Point | null => {
      if (!stageRef.current || !imageLayout) {
        return null
      }

      const stageRect = stageRef.current.getBoundingClientRect()
      return {
        x: clientX - stageRect.left - imageLayout.x,
        y: clientY - stageRect.top - imageLayout.y,
      }
    },
    [imageLayout],
  )

  useEffect(() => {
    if (!interaction || !imageLayout) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const pointer = getPointerInImageSpace(event.clientX, event.clientY)
      if (!pointer) {
        return
      }

      if (interaction.type === 'move') {
        const dx = pointer.x - interaction.startPointer.x
        const dy = pointer.y - interaction.startPointer.y

        setCropRect({
          ...interaction.startRect,
          x: clamp(interaction.startRect.x + dx, 0, imageLayout.width - interaction.startRect.width),
          y: clamp(interaction.startRect.y + dy, 0, imageLayout.height - interaction.startRect.height),
        })
        return
      }

      setCropRect(
        resizeCropRect({
          corner: interaction.corner,
          pointer,
          startRect: interaction.startRect,
          image: imageLayout,
          aspect: normalizedAspect,
        }),
      )
    }

    const stopInteraction = () => setInteraction(null)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopInteraction)
    window.addEventListener('pointercancel', stopInteraction)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopInteraction)
      window.removeEventListener('pointercancel', stopInteraction)
    }
  }, [getPointerInImageSpace, imageLayout, interaction, normalizedAspect])

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    imageElementRef.current = image
    setNaturalImageSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })
  }

  const handleMovePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropRect) {
      return
    }
    const pointer = getPointerInImageSpace(event.clientX, event.clientY)
    if (!pointer) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setInteraction({
      type: 'move',
      startPointer: pointer,
      startRect: cropRect,
    })
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, corner: ResizeCorner) => {
    if (!cropRect) {
      return
    }
    const pointer = getPointerInImageSpace(event.clientX, event.clientY)
    if (!pointer) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setInteraction({
      type: 'resize',
      corner,
      startPointer: pointer,
      startRect: cropRect,
    })
  }

  const handleSave = () => {
    if (!imageElementRef.current || !imageLayout || !cropRect) {
      return
    }

    const sourceX = (cropRect.x * imageElementRef.current.naturalWidth) / imageLayout.width
    const sourceY = (cropRect.y * imageElementRef.current.naturalHeight) / imageLayout.height
    const sourceWidth = (cropRect.width * imageElementRef.current.naturalWidth) / imageLayout.width
    const sourceHeight = (cropRect.height * imageElementRef.current.naturalHeight) / imageLayout.height

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceWidth))
    canvas.height = Math.max(1, Math.round(sourceHeight))

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      imageElementRef.current,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="image-cropper-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="image-cropper-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div ref={stageRef} className="image-cropper-stage">
          <img
            ref={imageElementRef}
            src={imageSrc}
            alt="Источник для обрезки"
            className="image-cropper-image"
            onLoad={handleImageLoad}
            draggable={false}
            style={
              imageLayout
                ? {
                    left: `${imageLayout.x}px`,
                    top: `${imageLayout.y}px`,
                    width: `${imageLayout.width}px`,
                    height: `${imageLayout.height}px`,
                  }
                : undefined
            }
          />

          {cropRect && imageLayout ? (
            <div
              className="image-cropper-frame"
              style={{
                left: `${imageLayout.x + cropRect.x}px`,
                top: `${imageLayout.y + cropRect.y}px`,
                width: `${cropRect.width}px`,
                height: `${cropRect.height}px`,
                borderRadius: `${Math.max(0, frameRadius)}px`,
              }}
              onPointerDown={handleMovePointerDown}
            >
              <div className="image-cropper-grid" />
              <button
                type="button"
                className="image-cropper-handle image-cropper-handle--nw"
                aria-label="Изменить размер сверху слева"
                onPointerDown={(event) => handleResizePointerDown(event, 'nw')}
              />
              <button
                type="button"
                className="image-cropper-handle image-cropper-handle--ne"
                aria-label="Изменить размер сверху справа"
                onPointerDown={(event) => handleResizePointerDown(event, 'ne')}
              />
              <button
                type="button"
                className="image-cropper-handle image-cropper-handle--sw"
                aria-label="Изменить размер снизу слева"
                onPointerDown={(event) => handleResizePointerDown(event, 'sw')}
              />
              <button
                type="button"
                className="image-cropper-handle image-cropper-handle--se"
                aria-label="Изменить размер снизу справа"
                onPointerDown={(event) => handleResizePointerDown(event, 'se')}
              />
            </div>
          ) : (
            <div className="image-cropper-loading">Загрузка изображения…</div>
          )}
        </div>

        <div className="image-cropper-actions">
          <button type="button" className="image-cropper-button image-cropper-button--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="image-cropper-button image-cropper-button--primary"
            onClick={handleSave}
            disabled={!cropRect}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageCropper
