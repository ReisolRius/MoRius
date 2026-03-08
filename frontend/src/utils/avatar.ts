const DEFAULT_TARGET_MIME = 'image/webp'
const TRANSPARENT_TARGET_MIME = 'image/png'

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) {
    return dataUrl.length
  }
  const payload = dataUrl.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, (payload.length * 3) / 4 - padding)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435'))
    image.src = dataUrl
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0444\u0430\u0439\u043b'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0444\u043e\u0440\u043c\u0430\u0442 \u0444\u0430\u0439\u043b\u0430'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

type CompressOptions = {
  maxBytes: number
  maxDimension?: number
}

type PrepareAvatarPayloadOptions = {
  avatarUrl: string | null | undefined
  avatarOriginalUrl?: string | null
  maxBytes: number
  maxDimension?: number
}

async function compressLoadedImageToDataUrl(image: HTMLImageElement, options: CompressOptions): Promise<string> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435')
  }

  const maxDimension = Math.max(256, Math.round(options.maxDimension ?? 1024))
  let width = image.naturalWidth
  let height = image.naturalHeight
  if (width > maxDimension || height > maxDimension) {
    const scale = Math.min(maxDimension / width, maxDimension / height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  const render = (targetWidth: number, targetHeight: number) => {
    canvas.width = targetWidth
    canvas.height = targetHeight
    context.clearRect(0, 0, targetWidth, targetHeight)
    context.drawImage(image, 0, 0, targetWidth, targetHeight)
  }

  let targetWidth = width
  let targetHeight = height
  render(targetWidth, targetHeight)

  let quality = 0.92
  let candidate = canvas.toDataURL(DEFAULT_TARGET_MIME, quality)
  for (let attempt = 0; attempt < 8 && estimateDataUrlBytes(candidate) > options.maxBytes; attempt += 1) {
    quality = Math.max(0.45, quality - 0.08)
    candidate = canvas.toDataURL(DEFAULT_TARGET_MIME, quality)
  }

  for (let attempt = 0; attempt < 5 && estimateDataUrlBytes(candidate) > options.maxBytes; attempt += 1) {
    targetWidth = Math.max(220, Math.round(targetWidth * 0.84))
    targetHeight = Math.max(220, Math.round(targetHeight * 0.84))
    render(targetWidth, targetHeight)
    quality = 0.88
    candidate = canvas.toDataURL(DEFAULT_TARGET_MIME, quality)
    for (let q = 0; q < 8 && estimateDataUrlBytes(candidate) > options.maxBytes; q += 1) {
      quality = Math.max(0.42, quality - 0.08)
      candidate = canvas.toDataURL(DEFAULT_TARGET_MIME, quality)
    }
  }

  if (estimateDataUrlBytes(candidate) > options.maxBytes) {
    throw new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u0436\u0430\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0434\u043e \u043d\u0443\u0436\u043d\u043e\u0433\u043e \u0440\u0430\u0437\u043c\u0435\u0440\u0430')
  }
  return candidate
}

export async function compressImageDataUrl(dataUrl: string, options: CompressOptions): Promise<string> {
  if (estimateDataUrlBytes(dataUrl) <= options.maxBytes) {
    return dataUrl
  }
  const image = await loadImage(dataUrl)
  return compressLoadedImageToDataUrl(image, options)
}

export async function compressImageFileToDataUrl(file: File, options: CompressOptions): Promise<string> {
  const initialDataUrl = await readFileAsDataUrl(file)
  return compressImageDataUrl(initialDataUrl, options)
}

export async function resolveImageSourceToDataUrl(source: string): Promise<string> {
  const normalizedSource = source.trim()
  if (!normalizedSource) {
    throw new Error('\u041f\u0443\u0441\u0442\u043e\u0439 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f')
  }
  if (normalizedSource.startsWith('data:image/')) {
    return normalizedSource
  }

  const response = await fetch(normalizedSource, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435')
  }

  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0444\u043e\u0440\u043c\u0430\u0442 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}

export async function removeNearWhiteBackgroundFromDataUrl(
  dataUrl: string,
  options: {
    threshold?: number
    chromaTolerance?: number
    edgeSoftness?: number
    cropPadding?: number
  } = {},
): Promise<string> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth)
  canvas.height = Math.max(1, image.naturalHeight)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const width = canvas.width
  const height = canvas.height
  const imageData = context.getImageData(0, 0, width, height)
  const pixelData = imageData.data
  const threshold = Math.min(254, Math.max(216, Math.round(options.threshold ?? 238)))
  const chromaTolerance = Math.min(72, Math.max(10, Math.round(options.chromaTolerance ?? 30)))
  const edgeSoftness = Math.min(54, Math.max(0, Math.round(options.edgeSoftness ?? 20)))
  const cropPadding = Math.min(40, Math.max(8, Math.round(options.cropPadding ?? 18)))
  const backgroundMask = new Uint8Array(width * height)
  const queue: number[] = []
  const samplePixels: Array<{ red: number; green: number; blue: number; luma: number; chroma: number }> = []
  const borderMarginX = Math.max(6, Math.round(width * 0.08))
  const borderMarginY = Math.max(6, Math.round(height * 0.08))
  const isWithinSamplingBorder = (x: number, y: number) =>
    y < borderMarginY ||
    x < borderMarginX ||
    x >= width - borderMarginX ||
    (y >= height - borderMarginY && (x < borderMarginX || x >= width - borderMarginX))

  const getPixelIndex = (x: number, y: number) => y * width + x
  const getPixelOffset = (index: number) => index * 4
  const getPixelValues = (index: number) => {
    const offset = getPixelOffset(index)
    const red = pixelData[offset]
    const green = pixelData[offset + 1]
    const blue = pixelData[offset + 2]
    const alpha = pixelData[offset + 3]
    const minChannel = Math.min(red, green, blue)
    const maxChannel = Math.max(red, green, blue)
    const luma = (red * 0.299 + green * 0.587 + blue * 0.114)
    const chroma = maxChannel - minChannel
    return { red, green, blue, alpha, minChannel, maxChannel, luma, chroma }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isWithinSamplingBorder(x, y)) {
        continue
      }
      const values = getPixelValues(getPixelIndex(x, y))
      if (values.alpha === 0) {
        continue
      }
      if (values.luma < 176 || values.chroma > 72) {
        continue
      }
      samplePixels.push(values)
    }
  }

  if (samplePixels.length === 0) {
    samplePixels.push({ red: 255, green: 255, blue: 255, luma: 255, chroma: 0 })
  }

  const averageBackground = samplePixels.reduce(
    (accumulator, values) => ({
      red: accumulator.red + values.red,
      green: accumulator.green + values.green,
      blue: accumulator.blue + values.blue,
      luma: accumulator.luma + values.luma,
      chroma: accumulator.chroma + values.chroma,
    }),
    { red: 0, green: 0, blue: 0, luma: 0, chroma: 0 },
  )

  const backgroundSampleCount = Math.max(1, samplePixels.length)
  const backgroundRed = averageBackground.red / backgroundSampleCount
  const backgroundGreen = averageBackground.green / backgroundSampleCount
  const backgroundBlue = averageBackground.blue / backgroundSampleCount
  const backgroundLuma = averageBackground.luma / backgroundSampleCount
  const backgroundChroma = averageBackground.chroma / backgroundSampleCount
  const backgroundDistances = samplePixels
    .map((values) =>
      Math.sqrt(
        (values.red - backgroundRed) ** 2 +
        (values.green - backgroundGreen) ** 2 +
        (values.blue - backgroundBlue) ** 2,
      ),
    )
    .sort((left, right) => left - right)
  const distancePercentileIndex = Math.min(
    backgroundDistances.length - 1,
    Math.max(0, Math.round(backgroundDistances.length * 0.9)),
  )
  const backgroundDistanceThreshold = Math.max(
    18,
    Math.min(74, Math.round((backgroundDistances[distancePercentileIndex] ?? 22) + 14)),
  )
  const backgroundLumaFloor = Math.max(164, Math.min(252, Math.round(Math.min(backgroundLuma - 34, threshold - 6))))
  const backgroundChromaCeiling = Math.max(18, Math.min(86, Math.round(Math.max(backgroundChroma + 18, chromaTolerance))))

  const getEdgeStrength = (index: number) => {
    const x = index % width
    const y = Math.floor(index / width)
    const values = getPixelValues(index)
    let maxDelta = 0
    const compareNeighbor = (neighborX: number, neighborY: number) => {
      if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
        return
      }
      const neighbor = getPixelValues(getPixelIndex(neighborX, neighborY))
      const delta = Math.max(
        Math.abs(values.red - neighbor.red),
        Math.abs(values.green - neighbor.green),
        Math.abs(values.blue - neighbor.blue),
      )
      if (delta > maxDelta) {
        maxDelta = delta
      }
    }
    compareNeighbor(x - 1, y)
    compareNeighbor(x + 1, y)
    compareNeighbor(x, y - 1)
    compareNeighbor(x, y + 1)
    return maxDelta
  }

  const isEdgeConnectedBackgroundPixel = (index: number): boolean => {
    const values = getPixelValues(index)
    if (values.alpha === 0) {
      return true
    }
    if (values.luma < backgroundLumaFloor || values.luma < 146) {
      return false
    }

    const distanceToBackground = Math.sqrt(
      (values.red - backgroundRed) ** 2 +
      (values.green - backgroundGreen) ** 2 +
      (values.blue - backgroundBlue) ** 2,
    )
    const edgeStrength = getEdgeStrength(index)
    const definitelyBackground =
      values.minChannel >= threshold &&
      values.chroma <= backgroundChromaCeiling &&
      distanceToBackground <= backgroundDistanceThreshold + 10
    const maybeBackground =
      values.luma >= backgroundLumaFloor &&
      values.chroma <= backgroundChromaCeiling &&
      distanceToBackground <= backgroundDistanceThreshold

    if (!definitelyBackground && !maybeBackground) {
      return false
    }
    if (edgeStrength > 60 && distanceToBackground > backgroundDistanceThreshold * 0.7) {
      return false
    }
    return true
  }

  const enqueuePixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return
    }

    const index = y * width + x
    if (backgroundMask[index] === 1 || !isEdgeConnectedBackgroundPixel(index)) {
      return
    }

    backgroundMask[index] = 1
    queue.push(index)
  }

  for (let x = 0; x < width; x += 1) {
    enqueuePixel(x, 0)
    enqueuePixel(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    enqueuePixel(0, y)
    enqueuePixel(width - 1, y)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    const x = index % width
    const y = Math.floor(index / width)
    enqueuePixel(x + 1, y)
    enqueuePixel(x - 1, y)
    enqueuePixel(x, y + 1)
    enqueuePixel(x, y - 1)
  }

  for (let index = 0; index < backgroundMask.length; index += 1) {
    if (backgroundMask[index] !== 1) {
      continue
    }
    pixelData[index * 4 + 3] = 0
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = getPixelIndex(x, y)
        if (backgroundMask[index] === 1 || !isEdgeConnectedBackgroundPixel(index)) {
          continue
        }

        let maskedNeighbors = 0
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue
            }
            if (backgroundMask[getPixelIndex(x + offsetX, y + offsetY)] === 1) {
              maskedNeighbors += 1
            }
          }
        }

        if (maskedNeighbors >= 5) {
          backgroundMask[index] = 1
          pixelData[getPixelOffset(index) + 3] = 0
        }
      }
    }
  }

  if (edgeSoftness > 0) {
    const softnessFloor = Math.max(0, backgroundLumaFloor - edgeSoftness * 2)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = getPixelIndex(x, y)
        if (backgroundMask[index] === 1) {
          continue
        }

        const hasBackgroundNeighbor =
          backgroundMask[index - 1] === 1 ||
          backgroundMask[index + 1] === 1 ||
          backgroundMask[index - width] === 1 ||
          backgroundMask[index + width] === 1
        if (!hasBackgroundNeighbor) {
          continue
        }

        const offset = getPixelOffset(index)
        const alpha = pixelData[offset + 3]
        if (alpha === 0) {
          continue
        }

        const values = getPixelValues(index)
        const distanceToBackground = Math.sqrt(
          (values.red - backgroundRed) ** 2 +
          (values.green - backgroundGreen) ** 2 +
          (values.blue - backgroundBlue) ** 2,
        )
        if (values.luma < softnessFloor || values.chroma > backgroundChromaCeiling + 12) {
          continue
        }

        const lumaProgress = Math.min(1, Math.max(0, (values.luma - softnessFloor) / Math.max(1, backgroundLuma - softnessFloor)))
        const distanceProgress = Math.min(1, distanceToBackground / Math.max(1, backgroundDistanceThreshold + 12))
        const alphaMultiplier = Math.max(0.02, distanceProgress * (1 - lumaProgress * 0.9))
        const nextAlpha = Math.max(0, Math.min(255, Math.round(alpha * alphaMultiplier)))
        pixelData[offset + 3] = nextAlpha
        if (nextAlpha > 0 && nextAlpha < 255) {
          const normalizedAlpha = nextAlpha / 255
          pixelData[offset] = Math.max(0, Math.min(255, Math.round((values.red - backgroundRed * (1 - normalizedAlpha)) / normalizedAlpha)))
          pixelData[offset + 1] = Math.max(0, Math.min(255, Math.round((values.green - backgroundGreen * (1 - normalizedAlpha)) / normalizedAlpha)))
          pixelData[offset + 2] = Math.max(0, Math.min(255, Math.round((values.blue - backgroundBlue * (1 - normalizedAlpha)) / normalizedAlpha)))
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = getPixelIndex(x, y)
      const offset = getPixelOffset(index)
      const alpha = pixelData[offset + 3]
      if (alpha === 0 || backgroundMask[index] === 1) {
        continue
      }

      let transparentNeighborCount = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue
          }
          if (pixelData[getPixelOffset(getPixelIndex(x + offsetX, y + offsetY)) + 3] === 0) {
            transparentNeighborCount += 1
          }
        }
      }

      if (transparentNeighborCount < 2) {
        continue
      }

      const values = getPixelValues(index)
      const distanceToBackground = Math.sqrt(
        (values.red - backgroundRed) ** 2 +
        (values.green - backgroundGreen) ** 2 +
        (values.blue - backgroundBlue) ** 2,
      )
      if (distanceToBackground > backgroundDistanceThreshold * 0.82 || values.luma < backgroundLumaFloor - 18) {
        continue
      }

      const cleanupMultiplier = transparentNeighborCount >= 5 ? 0 : transparentNeighborCount >= 4 ? 0.2 : 0.45
      const nextAlpha = Math.max(0, Math.min(255, Math.round(alpha * cleanupMultiplier)))
      pixelData[offset + 3] = nextAlpha
      if (nextAlpha <= 10) {
        pixelData[offset + 3] = 0
      }
    }
  }

  context.putImageData(imageData, 0, 0)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixelData[(y * width + x) * 4 + 3]
      if (alpha <= 6) {
        continue
      }
      if (x < minX) {
        minX = x
      }
      if (y < minY) {
        minY = y
      }
      if (x > maxX) {
        maxX = x
      }
      if (y > maxY) {
        maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return canvas.toDataURL(TRANSPARENT_TARGET_MIME)
  }

  const sourceX = Math.max(0, minX - cropPadding)
  const sourceY = Math.max(0, minY - cropPadding)
  const sourceWidth = Math.min(width - sourceX, maxX - minX + 1 + cropPadding * 2)
  const sourceHeight = Math.min(height - sourceY, maxY - minY + 1 + cropPadding * 2)
  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = Math.max(1, sourceWidth)
  trimmedCanvas.height = Math.max(1, sourceHeight)
  const trimmedContext = trimmedCanvas.getContext('2d')
  if (!trimmedContext) {
    throw new Error('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435')
  }

  trimmedContext.clearRect(0, 0, trimmedCanvas.width, trimmedCanvas.height)
  trimmedContext.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )

  return trimmedCanvas.toDataURL(TRANSPARENT_TARGET_MIME)
}

export async function prepareAvatarPayloadForRequest(
  options: PrepareAvatarPayloadOptions,
): Promise<{ avatarUrl: string | null; avatarOriginalUrl: string | null }> {
  const normalizedAvatarUrl = (options.avatarUrl ?? '').trim()
  if (!normalizedAvatarUrl) {
    return {
      avatarUrl: null,
      avatarOriginalUrl: null,
    }
  }

  const avatarUrl = normalizedAvatarUrl.startsWith('data:image/')
    ? await compressImageDataUrl(normalizedAvatarUrl, {
        maxBytes: options.maxBytes,
        maxDimension: options.maxDimension,
      })
    : normalizedAvatarUrl

  const normalizedAvatarOriginalUrl = (options.avatarOriginalUrl ?? '').trim()
  if (!normalizedAvatarOriginalUrl) {
    return {
      avatarUrl,
      avatarOriginalUrl: null,
    }
  }

  if (normalizedAvatarOriginalUrl.startsWith('data:image/')) {
    return {
      avatarUrl,
      avatarOriginalUrl: null,
    }
  }

  return {
    avatarUrl,
    avatarOriginalUrl: normalizedAvatarOriginalUrl,
  }
}
