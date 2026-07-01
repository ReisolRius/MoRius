import type { StorySummarySegment } from '../types/story'

// ---------------------------------------------------------------------------
// Story summary "book" renderer.
//
// Renders the literary retelling + illustrations into paginated A4 canvas pages
// (Cyrillic-safe, because the browser rasterises the text) and assembles a real,
// downloadable PDF by embedding every page as a JPEG image. No external deps.
// ---------------------------------------------------------------------------

export type StoryBookPage = {
  dataUrl: string
  jpegBytes: Uint8Array
  width: number
  height: number
}

const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
const MARGIN_X = 112
const MARGIN_TOP = 132
const MARGIN_BOTTOM = 132
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM

const COLOR_BG = '#F7F1E3'
const COLOR_BG_EDGE = '#EFE6D2'
const COLOR_TEXT = '#2B2118'
const COLOR_HEADING = '#7A4E22'
const COLOR_MUTED = '#6A5B45'
const COLOR_FRAME = '#D8C7A4'

const BODY_FONT = 'Georgia, "Times New Roman", "PT Serif", serif'
const HEADING_FONT = 'Georgia, "Times New Roman", "PT Serif", serif'

const BODY_SIZE = 30
const BODY_LINE = 46
const HEADING_SIZE = 44
const CAPTION_SIZE = 26
const JPEG_QUALITY = 0.9

type DrawContext = {
  pages: HTMLCanvasElement[]
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  y: number
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function paintPageBackground(ctx: CanvasRenderingContext2D, pageNumber: number): void {
  ctx.save()
  ctx.fillStyle = COLOR_BG
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  const gradient = ctx.createLinearGradient(0, 0, 0, PAGE_HEIGHT)
  gradient.addColorStop(0, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0)')
  gradient.addColorStop(1, COLOR_BG_EDGE)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  ctx.strokeStyle = COLOR_FRAME
  ctx.lineWidth = 2
  ctx.strokeRect(46, 46, PAGE_WIDTH - 92, PAGE_HEIGHT - 92)

  if (pageNumber > 0) {
    ctx.fillStyle = COLOR_MUTED
    ctx.font = `${CAPTION_SIZE - 2}px ${BODY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(pageNumber), PAGE_WIDTH / 2, PAGE_HEIGHT - 70)
  }
  ctx.restore()
}

function newPage(context: DrawContext): void {
  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable')
  }
  paintPageBackground(ctx, context.pages.length + 1)
  context.pages.push(canvas)
  context.canvas = canvas
  context.ctx = ctx
  context.y = MARGIN_TOP
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.replace(/\r/g, '').split('\n')
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        // Hard-break words that are wider than a full line.
        if (!current && ctx.measureText(word).width > maxWidth) {
          let chunk = ''
          for (const char of word) {
            if (ctx.measureText(chunk + char).width > maxWidth && chunk) {
              lines.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          current = chunk
          continue
        }
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current) {
      lines.push(current)
    }
  }
  return lines
}

function drawParagraph(context: DrawContext, text: string): void {
  const { ctx } = context
  ctx.fillStyle = COLOR_TEXT
  ctx.font = `${BODY_SIZE}px ${BODY_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const lines = wrapText(ctx, text, CONTENT_WIDTH)
  for (const line of lines) {
    if (context.y + BODY_LINE > CONTENT_BOTTOM) {
      newPage(context)
      ctx.fillStyle = COLOR_TEXT
      ctx.font = `${BODY_SIZE}px ${BODY_FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
    if (line) {
      context.ctx.fillText(line, MARGIN_X, context.y + BODY_SIZE)
    }
    context.y += BODY_LINE
  }
  context.y += 18
}

function drawHeading(context: DrawContext, text: string): void {
  // Keep a heading attached to following content: break early if near the bottom.
  if (context.y + HEADING_SIZE + BODY_LINE * 2 > CONTENT_BOTTOM) {
    newPage(context)
  } else if (context.y > MARGIN_TOP) {
    context.y += 34
  }

  const { ctx } = context
  ctx.fillStyle = COLOR_HEADING
  ctx.font = `bold ${HEADING_SIZE}px ${HEADING_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const lines = wrapText(ctx, text, CONTENT_WIDTH)
  for (const line of lines) {
    if (context.y + HEADING_SIZE + 12 > CONTENT_BOTTOM) {
      newPage(context)
      ctx.fillStyle = COLOR_HEADING
      ctx.font = `bold ${HEADING_SIZE}px ${HEADING_FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
    context.ctx.fillText(line, MARGIN_X, context.y + HEADING_SIZE)
    context.y += HEADING_SIZE + 12
  }

  // Decorative underline.
  ctx.strokeStyle = COLOR_FRAME
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN_X, context.y + 6)
  ctx.lineTo(MARGIN_X + 220, context.y + 6)
  ctx.stroke()
  context.y += 30
}

function drawImage(context: DrawContext, image: HTMLImageElement, caption: string): void {
  const naturalWidth = image.naturalWidth || image.width || 1
  const naturalHeight = image.naturalHeight || image.height || 1
  const aspect = naturalHeight / naturalWidth

  let drawWidth = CONTENT_WIDTH
  let drawHeight = Math.round(drawWidth * aspect)
  const maxImageHeight = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - (caption ? 70 : 20)
  if (drawHeight > maxImageHeight) {
    drawHeight = maxImageHeight
    drawWidth = Math.round(drawHeight / aspect)
  }

  const captionHeight = caption ? 70 : 0
  if (context.y + drawHeight + captionHeight > CONTENT_BOTTOM) {
    newPage(context)
  }

  const { ctx } = context
  const drawX = MARGIN_X + Math.round((CONTENT_WIDTH - drawWidth) / 2)
  const drawY = context.y

  ctx.save()
  ctx.shadowColor = 'rgba(43, 33, 24, 0.25)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 10
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(drawX, drawY, drawWidth, drawHeight)
  ctx.restore()

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)

  ctx.strokeStyle = COLOR_FRAME
  ctx.lineWidth = 3
  ctx.strokeRect(drawX, drawY, drawWidth, drawHeight)

  context.y += drawHeight + 14

  if (caption) {
    ctx.fillStyle = COLOR_MUTED
    ctx.font = `italic ${CAPTION_SIZE}px ${BODY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const captionLines = wrapText(ctx, caption, CONTENT_WIDTH - 80)
    for (const line of captionLines.slice(0, 2)) {
      ctx.fillText(line, PAGE_WIDTH / 2, context.y + CAPTION_SIZE)
      context.y += CAPTION_SIZE + 8
    }
  }
  context.y += 30
}

function drawCover(context: DrawContext, title: string, subtitle: string): void {
  const { ctx } = context
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Top ornament.
  ctx.strokeStyle = COLOR_FRAME
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(PAGE_WIDTH / 2 - 160, 420)
  ctx.lineTo(PAGE_WIDTH / 2 + 160, 420)
  ctx.stroke()

  ctx.fillStyle = COLOR_MUTED
  ctx.font = `italic ${CAPTION_SIZE + 4}px ${BODY_FONT}`
  ctx.fillText('Книга по мотивам вашей истории', PAGE_WIDTH / 2, 392)

  ctx.fillStyle = COLOR_TEXT
  const titleSize = title.length > 38 ? 64 : 84
  ctx.font = `bold ${titleSize}px ${HEADING_FONT}`
  const titleLines = wrapText(ctx, title, CONTENT_WIDTH - 40)
  let titleY = PAGE_HEIGHT / 2 - (titleLines.length * (titleSize + 14)) / 2
  for (const line of titleLines.slice(0, 4)) {
    ctx.fillText(line, PAGE_WIDTH / 2, titleY)
    titleY += titleSize + 14
  }

  ctx.strokeStyle = COLOR_HEADING
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAGE_WIDTH / 2 - 110, titleY + 28)
  ctx.lineTo(PAGE_WIDTH / 2 + 110, titleY + 28)
  ctx.stroke()

  if (subtitle) {
    ctx.fillStyle = COLOR_MUTED
    ctx.font = `${CAPTION_SIZE + 2}px ${BODY_FONT}`
    const subtitleLines = wrapText(ctx, subtitle, CONTENT_WIDTH - 120)
    let subtitleY = titleY + 92
    for (const line of subtitleLines.slice(0, 3)) {
      ctx.fillText(line, PAGE_WIDTH / 2, subtitleY)
      subtitleY += CAPTION_SIZE + 12
    }
  }

  ctx.strokeStyle = COLOR_FRAME
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(PAGE_WIDTH / 2 - 160, PAGE_HEIGHT - 420)
  ctx.lineTo(PAGE_WIDTH / 2 + 160, PAGE_HEIGHT - 420)
  ctx.stroke()
}

function canExportCanvas(canvas: HTMLCanvasElement): boolean {
  try {
    canvas.getContext('2d')
    canvas.toDataURL('image/jpeg', 0.1)
    return true
  } catch {
    return false
  }
}

export async function loadDrawableImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  const normalized = (src ?? '').trim()
  if (!normalized) {
    return null
  }
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    if (!normalized.startsWith('data:')) {
      image.crossOrigin = 'anonymous'
    }
    image.onload = () => {
      // Reject images that would taint the canvas (no usable CORS headers).
      try {
        const probe = createCanvas(2, 2)
        const probeCtx = probe.getContext('2d')
        if (!probeCtx) {
          resolve(null)
          return
        }
        probeCtx.drawImage(image, 0, 0, 2, 2)
        if (!canExportCanvas(probe)) {
          resolve(null)
          return
        }
        resolve(image)
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = normalized
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function buildStorySummaryBook(payload: {
  title: string
  subtitle?: string
  segments: StorySummarySegment[]
}): Promise<StoryBookPage[]> {
  const segments = payload.segments ?? []

  // Pre-load illustrations so layout can measure them.
  const loadedImages = new Map<number, HTMLImageElement | null>()
  await Promise.all(
    segments.map(async (segment, index) => {
      if (segment.type !== 'image') {
        return
      }
      const source = (segment.image_data_url ?? '').trim() || (segment.image_url ?? '').trim()
      loadedImages.set(index, await loadDrawableImage(source))
    }),
  )

  const context: DrawContext = {
    pages: [],
    canvas: null as unknown as HTMLCanvasElement,
    ctx: null as unknown as CanvasRenderingContext2D,
    y: MARGIN_TOP,
  }

  newPage(context)
  drawCover(context, payload.title || 'Моя история', payload.subtitle ?? '')
  newPage(context)

  segments.forEach((segment, index) => {
    if (segment.type === 'image') {
      const image = loadedImages.get(index) ?? null
      const caption = (segment.caption ?? '').trim()
      if (image) {
        drawImage(context, image, caption)
      } else if (caption) {
        drawParagraph(context, caption)
      }
      return
    }
    if (segment.type === 'heading') {
      const text = (segment.text ?? '').trim()
      if (text) {
        drawHeading(context, text)
      }
      return
    }
    const text = (segment.text ?? '').trim()
    if (text) {
      drawParagraph(context, text)
    }
  })

  return context.pages.map((canvas) => {
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return {
      dataUrl,
      jpegBytes: dataUrlToBytes(dataUrl),
      width: canvas.width,
      height: canvas.height,
    }
  })
}

// --- Minimal PDF writer (JPEG page images, DCTDecode) ----------------------

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) {
    total += chunk.length
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export function buildStorySummaryPdf(pages: StoryBookPage[]): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  const offsets: number[] = []

  const pushText = (text: string) => {
    const bytes = encoder.encode(text)
    chunks.push(bytes)
    length += bytes.length
  }
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes)
    length += bytes.length
  }
  const startObject = (id: number) => {
    offsets[id] = length
    pushText(`${id} 0 obj\n`)
  }

  pushText('%PDF-1.3\n%\xE2\xE3\xCF\xD3\n')

  const totalObjects = 2 + pages.length * 3

  // 1: Catalog
  startObject(1)
  pushText('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  // 2: Pages
  startObject(2)
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
  pushText(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`)

  // Render every page at A4 size (in PDF points) while embedding a high-resolution JPEG.
  const A4_WIDTH_PT = 595.28

  pages.forEach((page, index) => {
    const pageObjId = 3 + index * 3
    const contentObjId = pageObjId + 1
    const imageObjId = pageObjId + 2

    const pageWidthPt = A4_WIDTH_PT
    const pageHeightPt = Math.round(A4_WIDTH_PT * (page.height / page.width) * 100) / 100

    startObject(pageObjId)
    pushText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] ` +
        `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`,
    )

    const contentStream = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im0 Do\nQ\n`
    startObject(contentObjId)
    pushText(`<< /Length ${encoder.encode(contentStream).length} >>\nstream\n`)
    pushText(contentStream)
    pushText('endstream\nendobj\n')

    startObject(imageObjId)
    pushText(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`,
    )
    pushBytes(page.jpegBytes)
    pushText('\nendstream\nendobj\n')
  })

  const xrefOffset = length
  pushText(`xref\n0 ${totalObjects + 1}\n`)
  pushText('0000000000 65535 f \n')
  for (let id = 1; id <= totalObjects; id += 1) {
    const offset = offsets[id] ?? 0
    pushText(`${offset.toString().padStart(10, '0')} 00000 n \n`)
  }
  pushText(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const pdfBytes = concatBytes(chunks)
  const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(pdfBuffer).set(pdfBytes)
  return new Blob([pdfBuffer], { type: 'application/pdf' })
}

export function sanitizeStoryBookFilename(name: string): string {
  const normalized = (name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (normalized || 'Моя история').slice(0, 120)
}

export function downloadStoryBookPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
