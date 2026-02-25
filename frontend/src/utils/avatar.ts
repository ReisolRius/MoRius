const DEFAULT_TARGET_MIME = 'image/webp'

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
    image.onerror = () => reject(new Error('Не удалось обработать изображение'))
    image.src = dataUrl
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный формат файла'))
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

async function compressLoadedImageToDataUrl(image: HTMLImageElement, options: CompressOptions): Promise<string> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Не удалось подготовить изображение')
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
    throw new Error('Не удалось сжать изображение до нужного размера')
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
