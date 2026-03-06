import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  SvgIcon,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AvatarCropDialog from './AvatarCropDialog'
import BaseDialog from './dialogs/BaseDialog'
import {
  createStoryCharacter,
  deleteStoryCharacter,
  generateStoryCharacterAvatar,
  listStoryCharacters,
  updateStoryCharacter,
} from '../services/storyApi'
import type { StoryCharacter, StoryImageModelId } from '../types/story'
import TextLimitIndicator from './TextLimitIndicator'
import { compressImageDataUrl } from '../utils/avatar'

type CharacterManagerDialogProps = {
  open: boolean
  authToken: string
  onClose: () => void
  initialMode?: 'list' | 'create'
  initialCharacterId?: number | null
  includePublicationCopies?: boolean
}

type CharacterDraftMode = 'create' | 'edit'

const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const CHARACTER_AVATAR_SOURCE_MAX_BYTES = 2 * 1024 * 1024
const CHARACTER_DESCRIPTION_MAX_LENGTH = 6000
const CHARACTER_TRIGGERS_MAX_LENGTH = 600
const CHARACTER_NOTE_MAX_LENGTH = 20
const CHARACTER_EDITOR_AVATAR_SIZE = 248
const CHARACTER_AI_AVATAR_OUTPUT_SIZE = 640
const CHARACTER_AI_AVATAR_STYLE_PROMPT_MAX_LENGTH = 320
const CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID: StoryImageModelId = 'black-forest-labs/flux.2-pro'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_SEEDREAM_ID: StoryImageModelId = 'bytedance-seed/seedream-4.5'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_ID: StoryImageModelId = 'google/gemini-2.5-flash-image'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_2_ID: StoryImageModelId = 'google/gemini-3.1-flash-image-preview'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_GROK_ID: StoryImageModelId = 'grok-imagine-image-pro'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_OPTIONS: Array<{
  id: StoryImageModelId
  title: string
  description: string
  cost: number
}> = [
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID,
    title: 'Flux',
    description: 'Быстрая и сбалансированная генерация.',
    cost: 3,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_SEEDREAM_ID,
    title: 'Seedream',
    description: 'Более художественная и мягкая подача.',
    cost: 5,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_ID,
    title: 'Nano Banano',
    description: 'Высокая детализация персонажа.',
    cost: 15,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_2_ID,
    title: 'Nano Banano 2',
    description: 'Maximum detail and depth rendering.',
    cost: 30,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_GROK_ID,
    title: 'Grok (VPN!)',
    description: 'Максимальная глубина и качество рендера.',
    cost: 30,
  },
]

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to process image'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid image format'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
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

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) {
    return dataUrl.length
  }
  const payload = dataUrl.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, (payload.length * 3) / 4 - padding)
}

function normalizeCharacterTriggersDraft(value: string, fallbackName: string): string[] {
  const normalizedValues = value
    .split(/[\n,;]+/)
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter((entry) => entry.length > 0)

  const deduplicated: string[] = []
  const seen = new Set<string>()
  normalizedValues.forEach((entry) => {
    const key = entry.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    deduplicated.push(entry)
  })

  if (deduplicated.length === 0) {
    const fallback = fallbackName.replace(/\s+/g, ' ').trim()
    if (fallback) {
      deduplicated.push(fallback)
    }
  }

  return deduplicated.slice(0, 16)
}

function normalizeCharacterNoteDraft(value: string): string {
  return value
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHARACTER_NOTE_MAX_LENGTH)
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = dataUrl
  })
}

async function resolveImageSourceToDataUrl(source: string): Promise<string> {
  const normalizedSource = source.trim()
  if (normalizedSource.startsWith('data:image/')) {
    return normalizedSource
  }

  const response = await fetch(normalizedSource, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to fetch generated image')
  }
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) {
    throw new Error('AI returned an unsupported image format')
  }
  return readBlobAsDataUrl(blob)
}

type DetectedCharacterFrame = {
  top: number
  centerX: number
}

function detectCharacterFrame(image: HTMLImageElement): DetectedCharacterFrame | null {
  const naturalWidth = Math.max(1, image.naturalWidth)
  const naturalHeight = Math.max(1, image.naturalHeight)
  const probeScale = Math.min(1, 320 / Math.max(naturalWidth, naturalHeight))
  const probeWidth = Math.max(1, Math.round(naturalWidth * probeScale))
  const probeHeight = Math.max(1, Math.round(naturalHeight * probeScale))

  const canvas = document.createElement('canvas')
  canvas.width = probeWidth
  canvas.height = probeHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.drawImage(image, 0, 0, probeWidth, probeHeight)
  const imageData = context.getImageData(0, 0, probeWidth, probeHeight).data
  const edgeWidth = Math.max(2, Math.round(probeWidth * 0.08))
  const centerStart = Math.max(0, Math.floor(probeWidth * 0.34))
  const centerEnd = Math.min(probeWidth - 1, Math.ceil(probeWidth * 0.66))
  const rowThreshold = 58
  const requiredRun = 4

  const averageRowRange = (y: number, fromX: number, toX: number) => {
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    for (let x = fromX; x <= toX; x += 1) {
      const offset = (y * probeWidth + x) * 4
      red += imageData[offset]
      green += imageData[offset + 1]
      blue += imageData[offset + 2]
      count += 1
    }
    if (count === 0) {
      return { red: 0, green: 0, blue: 0 }
    }
    return {
      red: red / count,
      green: green / count,
      blue: blue / count,
    }
  }

  const rowHasCharacter = new Array<boolean>(probeHeight).fill(false)
  for (let y = 0; y < probeHeight; y += 1) {
    const leftEdge = averageRowRange(y, 0, edgeWidth - 1)
    const rightEdge = averageRowRange(y, probeWidth - edgeWidth, probeWidth - 1)
    const rowBackground = {
      red: (leftEdge.red + rightEdge.red) / 2,
      green: (leftEdge.green + rightEdge.green) / 2,
      blue: (leftEdge.blue + rightEdge.blue) / 2,
    }
    const center = averageRowRange(y, centerStart, centerEnd)
    const delta =
      Math.abs(center.red - rowBackground.red) +
      Math.abs(center.green - rowBackground.green) +
      Math.abs(center.blue - rowBackground.blue)
    rowHasCharacter[y] = delta > rowThreshold
  }

  let probeTop = -1
  for (let y = 0; y <= probeHeight - requiredRun; y += 1) {
    let match = true
    for (let runOffset = 0; runOffset < requiredRun; runOffset += 1) {
      if (!rowHasCharacter[y + runOffset]) {
        match = false
        break
      }
    }
    if (match) {
      probeTop = y
      break
    }
  }
  if (probeTop < 0) {
    return null
  }

  const sampleY = Math.min(probeHeight - 1, Math.max(0, probeTop + Math.round(probeHeight * 0.14)))
  const leftEdge = averageRowRange(sampleY, 0, edgeWidth - 1)
  const rightEdge = averageRowRange(sampleY, probeWidth - edgeWidth, probeWidth - 1)
  const rowBackground = {
    red: (leftEdge.red + rightEdge.red) / 2,
    green: (leftEdge.green + rightEdge.green) / 2,
    blue: (leftEdge.blue + rightEdge.blue) / 2,
  }
  const columnThreshold = 56
  let left = -1
  let right = -1
  for (let x = 0; x < probeWidth; x += 1) {
    const offset = (sampleY * probeWidth + x) * 4
    const delta =
      Math.abs(imageData[offset] - rowBackground.red) +
      Math.abs(imageData[offset + 1] - rowBackground.green) +
      Math.abs(imageData[offset + 2] - rowBackground.blue)
    if (delta > columnThreshold) {
      if (left < 0) {
        left = x
      }
      right = x
    }
  }

  const top = probeTop / probeScale
  const centerX =
    left >= 0 && right >= 0
      ? ((left + right) / 2) / probeScale
      : naturalWidth / 2

  return {
    top: Math.max(0, Math.min(top, naturalHeight - 1)),
    centerX: Math.max(0, Math.min(centerX, naturalWidth)),
  }
}

async function buildAutoCroppedAvatar(dataUrl: string): Promise<string> {
  const image = await loadImageFromDataUrl(dataUrl)
  const naturalWidth = Math.max(1, image.naturalWidth)
  const naturalHeight = Math.max(1, image.naturalHeight)
  const isPortrait = naturalHeight >= naturalWidth * 1.15
  const detectedFrame = detectCharacterFrame(image)

  const shortSide = Math.min(naturalWidth, naturalHeight)
  const framingScale = isPortrait ? 0.34 : 0.36
  const sourceSize = Math.min(shortSide, Math.max(150, Math.round(shortSide * framingScale)))
  const baseCenterX = detectedFrame?.centerX ?? naturalWidth / 2
  const proposedX = Math.round(baseCenterX - sourceSize / 2)
  const sourceX = Math.max(0, Math.min(proposedX, naturalWidth - sourceSize))

  const fallbackTop = Math.round(naturalHeight * (isPortrait ? 0.08 : 0.1))
  const detectedTop = detectedFrame?.top ?? fallbackTop
  const headroom = Math.round(sourceSize * 0.08)
  const proposedY = Math.round(detectedTop - headroom)
  const maxPortraitTop = Math.round(naturalHeight * (isPortrait ? 0.24 : 0.28))
  const clampedTop = Math.min(proposedY, maxPortraitTop)
  const sourceY = Math.max(0, Math.min(clampedTop, naturalHeight - sourceSize))

  const canvas = document.createElement('canvas')
  canvas.width = CHARACTER_AI_AVATAR_OUTPUT_SIZE
  canvas.height = CHARACTER_AI_AVATAR_OUTPUT_SIZE

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to prepare avatar canvas')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    CHARACTER_AI_AVATAR_OUTPUT_SIZE,
    CHARACTER_AI_AVATAR_OUTPUT_SIZE,
  )
  return canvas.toDataURL('image/png')
}

type CharacterAvatarProps = {
  avatarUrl: string | null
  avatarScale?: number
  fallbackLabel: string
  size?: number
}

function CharacterAvatar({ avatarUrl, avatarScale = 1, fallbackLabel, size = 44 }: CharacterAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const firstSymbol = fallbackLabel.trim().charAt(0).toUpperCase() || '•'

  if (avatarUrl && avatarUrl !== failedImageUrl) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        <Box
          component="img"
          src={avatarUrl}
          alt={fallbackLabel}
          onError={() => setFailedImageUrl(avatarUrl)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${Math.max(1, Math.min(3, avatarScale))})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
    )
  }

  return (
    <Box
      title={fallbackLabel}
      aria-label={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(219, 227, 236, 0.92)',
        fontSize: Math.max(14, Math.round(size * 0.38)),
        fontWeight: 700,
      }}
    >
      {firstSymbol}
    </Box>
  )
}

function SparkleIcon() {
  return (
    <SvgIcon sx={{ fontSize: '1.04rem' }} viewBox="0 0 24 24">
      <path d="M12 2l1.9 4.6L18.5 8l-4.6 1.4L12 14l-1.9-4.6L5.5 8l4.6-1.4L12 2zm7 9l.95 2.05L22 14l-2.05.95L19 17l-.95-2.05L16 14l2.05-.95L19 11zM5 13l1.2 2.8L9 17l-2.8 1.2L5 21l-1.2-2.8L1 17l2.8-1.2L5 13z" />
    </SvgIcon>
  )
}

function RegenerateIcon() {
  return (
    <SvgIcon sx={{ fontSize: '1.04rem' }} viewBox="0 0 24 24">
      <path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5 0 1.01-.3 1.95-.82 2.74l1.46 1.46A6.986 6.986 0 0 0 19 13c0-3.87-3.13-7-7-7zm-5.18.26L5.36 4.8A6.986 6.986 0 0 0 5 11c0 3.87 3.13 7 7 7v3l4-4-4-4v3c-2.76 0-5-2.24-5-5 0-1.01.3-1.95.82-2.74z" />
    </SvgIcon>
  )
}

function CropFreeIcon() {
  return (
    <SvgIcon sx={{ fontSize: '1.06rem' }} viewBox="0 0 24 24">
      <path d="M5 9V5h4V3H3v6h2zm0 6H3v6h6v-2H5zm14 4h-4v2h6v-6h-2zm0-16h-6v2h4v4h2z" />
    </SvgIcon>
  )
}

function CharacterManagerDialog({
  open,
  authToken,
  onClose,
  initialMode = 'list',
  initialCharacterId = null,
  includePublicationCopies = false,
}: CharacterManagerDialogProps) {
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false)
  const [isSavingCharacter, setIsSavingCharacter] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [draftMode, setDraftMode] = useState<CharacterDraftMode>('create')
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [triggersDraft, setTriggersDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [avatarSourceDraft, setAvatarSourceDraft] = useState<string | null>(null)
  const [avatarScaleDraft, setAvatarScaleDraft] = useState(1)
  const [visibilityDraft, setVisibilityDraft] = useState<'private' | 'public'>('private')
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isAiAvatarDialogOpen, setIsAiAvatarDialogOpen] = useState(false)
  const [aiAvatarModelDraft, setAiAvatarModelDraft] = useState<StoryImageModelId>(CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID)
  const [aiAvatarStylePromptDraft, setAiAvatarStylePromptDraft] = useState('')
  const [isGeneratingAiAvatar, setIsGeneratingAiAvatar] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const [characterDeleteTarget, setCharacterDeleteTarget] = useState<StoryCharacter | null>(null)
  const [characterAvatarPreview, setCharacterAvatarPreview] = useState<{ url: string; name: string } | null>(null)
  const [hasAppliedInitialAction, setHasAppliedInitialAction] = useState(false)
  const [hasLoadedCharacters, setHasLoadedCharacters] = useState(false)

  const managedCharacters = useMemo(
    () =>
      characters
        .filter((item): item is StoryCharacter => Boolean(item) && typeof item.id === 'number')
        .filter((character) => {
          if (includePublicationCopies) {
            return true
          }
          if (character.visibility !== 'public' || character.source_character_id === null) {
            return true
          }
          const sourceCharacter = characters.find((candidate) => candidate.id === character.source_character_id)
          return !sourceCharacter || sourceCharacter.user_id !== character.user_id
        }),
    [characters, includePublicationCopies],
  )
  const sortedCharacters = useMemo(
    () => [...managedCharacters].sort((left, right) => left.id - right.id),
    [managedCharacters],
  )
  const selectedCharacterMenuItem = useMemo(
    () =>
      characterMenuCharacterId !== null
        ? sortedCharacters.find((character) => character.id === characterMenuCharacterId) ?? null
        : null,
    [characterMenuCharacterId, sortedCharacters],
  )
  const hasAvatarDraft = Boolean((avatarDraft ?? '').trim())
  const isAvatarActionsLocked = isSavingCharacter || isGeneratingAiAvatar
  const normalizedDescriptionDraft = useMemo(() => descriptionDraft.replace(/\r\n/g, '\n').trim(), [descriptionDraft])
  const selectedAiAvatarModelOption = useMemo(
    () =>
      CHARACTER_AI_AVATAR_IMAGE_MODEL_OPTIONS.find((option) => option.id === aiAvatarModelDraft) ??
      CHARACTER_AI_AVATAR_IMAGE_MODEL_OPTIONS[0],
    [aiAvatarModelDraft],
  )
  const normalizedAiAvatarStylePromptDraft = useMemo(
    () =>
      aiAvatarStylePromptDraft
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trimStart()
        .slice(0, CHARACTER_AI_AVATAR_STYLE_PROMPT_MAX_LENGTH),
    [aiAvatarStylePromptDraft],
  )
  const selectedAiAvatarGenerationCost = selectedAiAvatarModelOption?.cost ?? 0
  const canGenerateAiAvatar = normalizedDescriptionDraft.length > 0

  const resetDraft = useCallback(() => {
    setDraftMode('create')
    setEditingCharacterId(null)
    setNameDraft('')
    setDescriptionDraft('')
    setNoteDraft('')
    setTriggersDraft('')
    setAvatarDraft(null)
    setAvatarSourceDraft(null)
    setAvatarScaleDraft(1)
    setVisibilityDraft('private')
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    setAiAvatarModelDraft(CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID)
    setAiAvatarStylePromptDraft('')
    setIsGeneratingAiAvatar(false)
    setAvatarError('')
  }, [])

  const loadCharacters = useCallback(async () => {
    setErrorMessage('')
    setIsLoadingCharacters(true)
    try {
      const loadedCharacters = await listStoryCharacters(authToken)
      const normalizedCharacters = loadedCharacters
        .filter((item): item is StoryCharacter => Boolean(item) && typeof item.id === 'number')
        .map((item) => ({
          ...item,
          name: typeof item.name === 'string' ? item.name : '',
          description: typeof item.description === 'string' ? item.description : '',
          note: typeof item.note === 'string' ? item.note : '',
          triggers: Array.isArray(item.triggers) ? item.triggers.filter((value): value is string => typeof value === 'string') : [],
          avatar_url: typeof item.avatar_url === 'string' ? item.avatar_url : null,
          avatar_scale: typeof item.avatar_scale === 'number' ? item.avatar_scale : 1,
        }))
      setCharacters(normalizedCharacters)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей'
      setErrorMessage(detail)
      setCharacters([])
    } finally {
      setIsLoadingCharacters(false)
      setHasLoadedCharacters(true)
    }
  }, [authToken])

  useEffect(() => {
    if (!open) {
      setCharacterMenuAnchorEl(null)
      setCharacterMenuCharacterId(null)
      setCharacterDeleteTarget(null)
      setCharacterAvatarPreview(null)
      setAvatarCropSource(null)
      setIsAiAvatarDialogOpen(false)
      setIsGeneratingAiAvatar(false)
      setHasAppliedInitialAction(false)
      setHasLoadedCharacters(false)
      return
    }
    setHasLoadedCharacters(false)
    setIsEditorOpen(false)
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setCharacterDeleteTarget(null)
    setCharacterAvatarPreview(null)
    setHasAppliedInitialAction(false)
    resetDraft()
    void loadCharacters()
  }, [loadCharacters, open, resetDraft])

  const handleCloseDialog = () => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setCharacterDeleteTarget(null)
    setCharacterAvatarPreview(null)
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    onClose()
  }

  const handleOpenCharacterAvatarPreview = useCallback((event: ReactMouseEvent<HTMLElement>, character: StoryCharacter) => {
    if (!character.avatar_url) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setCharacterAvatarPreview({
      url: character.avatar_url,
      name: character.name,
    })
  }, [])

  const handleCloseCharacterAvatarPreview = useCallback(() => {
    setCharacterAvatarPreview(null)
  }, [])

  const handleStartCreate = useCallback(() => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    resetDraft()
    setIsEditorOpen(true)
  }, [deletingCharacterId, isGeneratingAiAvatar, isSavingCharacter, resetDraft])

  const handleStartEdit = useCallback((character: StoryCharacter) => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    setDraftMode('edit')
    setEditingCharacterId(character.id)
    setNameDraft(character.name)
    setDescriptionDraft(character.description)
    setNoteDraft(character.note)
    setTriggersDraft(character.triggers.join(', '))
    setAvatarDraft(character.avatar_url)
    setAvatarSourceDraft(character.avatar_url)
    setAvatarScaleDraft(Math.max(1, Math.min(3, character.avatar_scale ?? 1)))
    setVisibilityDraft(character.visibility === 'public' ? 'public' : 'private')
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    setAvatarError('')
    setIsEditorOpen(true)
  }, [deletingCharacterId, isGeneratingAiAvatar, isSavingCharacter])

  const handleCancelEdit = () => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    setIsEditorOpen(false)
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    resetDraft()
  }

  const handleChooseAvatar = () => {
    if (isSavingCharacter || isGeneratingAiAvatar) {
      return
    }
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    if (selectedFile.size > CHARACTER_AVATAR_SOURCE_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarSourceDraft(dataUrl)
      setAvatarCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обработать изображение'
      setAvatarError(detail)
    }
  }, [])

  const handleSaveCroppedAvatar = useCallback(
    (croppedDataUrl: string) => {
      if (isSavingCharacter || isGeneratingAiAvatar || !croppedDataUrl) {
        return
      }
      void (async () => {
        try {
          const normalizedAvatar = await compressImageDataUrl(croppedDataUrl, {
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: CHARACTER_AI_AVATAR_OUTPUT_SIZE,
          })
          if (estimateDataUrlBytes(normalizedAvatar) > CHARACTER_AVATAR_MAX_BYTES) {
            setAvatarError('Аватар слишком большой после кропа. Максимум 2 МБ.')
            return
          }
          setAvatarDraft(normalizedAvatar)
          setAvatarScaleDraft(1)
          setAvatarCropSource(null)
          setAvatarError('')
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Не удалось сохранить кроп аватара'
          setAvatarError(detail)
        }
      })()
    },
    [isGeneratingAiAvatar, isSavingCharacter],
  )

  const handleOpenAvatarCrop = useCallback(() => {
    if (isSavingCharacter || isGeneratingAiAvatar || !hasAvatarDraft) {
      return
    }
    const sourceCandidate = (avatarSourceDraft ?? avatarDraft ?? '').trim()
    if (!sourceCandidate) {
      return
    }
    setAvatarError('')
    void (async () => {
      try {
        const sourceDataUrl = await resolveImageSourceToDataUrl(sourceCandidate)
        setAvatarSourceDraft(sourceDataUrl)
        setAvatarCropSource(sourceDataUrl)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть кроп аватара'
        setAvatarError(detail)
      }
    })()
  }, [avatarDraft, avatarSourceDraft, hasAvatarDraft, isGeneratingAiAvatar, isSavingCharacter])

  const handleOpenAiAvatarDialog = useCallback(() => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    setIsAiAvatarDialogOpen(true)
  }, [deletingCharacterId, isGeneratingAiAvatar, isSavingCharacter])

  const handleCloseAiAvatarDialog = useCallback(() => {
    if (isGeneratingAiAvatar) {
      return
    }
    setIsAiAvatarDialogOpen(false)
  }, [isGeneratingAiAvatar])

  const handleGenerateAiAvatar = useCallback(async () => {
    if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
      return
    }
    if (!normalizedDescriptionDraft) {
      setAvatarError('Сначала заполните описание персонажа, затем запускайте генерацию аватара.')
      return
    }

    setAvatarError('')
    setIsAiAvatarDialogOpen(false)
    setIsGeneratingAiAvatar(true)
    try {
      const generation = await generateStoryCharacterAvatar({
        token: authToken,
        imageModel: aiAvatarModelDraft,
        description: normalizedDescriptionDraft,
        stylePrompt: normalizedAiAvatarStylePromptDraft || undefined,
      })
      const imageSource = (generation.image_data_url ?? generation.image_url ?? '').trim()
      if (!imageSource) {
        throw new Error('ИИ не вернул изображение')
      }
      const sourceDataUrl = await resolveImageSourceToDataUrl(imageSource)
      const autoCroppedAvatar = await buildAutoCroppedAvatar(sourceDataUrl)
      const normalizedAvatar = await compressImageDataUrl(autoCroppedAvatar, {
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: CHARACTER_AI_AVATAR_OUTPUT_SIZE,
      })
      if (estimateDataUrlBytes(normalizedAvatar) > CHARACTER_AVATAR_MAX_BYTES) {
        throw new Error('Аватар от ИИ слишком большой после обработки')
      }
      setAvatarSourceDraft(sourceDataUrl)
      setAvatarDraft(normalizedAvatar)
      setAvatarScaleDraft(1)
      setAvatarError('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сгенерировать аватар'
      setAvatarError(detail)
    } finally {
      setIsGeneratingAiAvatar(false)
    }
  }, [
    aiAvatarModelDraft,
    authToken,
    deletingCharacterId,
    isGeneratingAiAvatar,
    isSavingCharacter,
    normalizedAiAvatarStylePromptDraft,
    normalizedDescriptionDraft,
  ])

  const handleSaveCharacter = useCallback(async () => {
    if (isSavingCharacter || isGeneratingAiAvatar) {
      return
    }
    const normalizedName = nameDraft.replace(/\s+/g, ' ').trim()
    const normalizedDescription = descriptionDraft.replace(/\r\n/g, '\n').trim()
    const normalizedNote = normalizeCharacterNoteDraft(noteDraft)

    if (!normalizedName) {
      setErrorMessage('Имя персонажа не может быть пустым')
      return
    }
    if (!normalizedDescription) {
      setErrorMessage('Описание персонажа не может быть пустым')
      return
    }

    const normalizedTriggers = normalizeCharacterTriggersDraft(triggersDraft, normalizedName)

    setErrorMessage('')
    setIsSavingCharacter(true)
    try {
      if (draftMode === 'create') {
        await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            note: normalizedNote,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
            avatar_scale: avatarScaleDraft,
            visibility: visibilityDraft,
          },
        })
      } else if (editingCharacterId !== null) {
        await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            note: normalizedNote,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
            avatar_scale: avatarScaleDraft,
            visibility: visibilityDraft,
          },
        })
      }
      await loadCharacters()

      setIsEditorOpen(false)
      resetDraft()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacter(false)
    }
  }, [
    authToken,
    avatarDraft,
    avatarScaleDraft,
    descriptionDraft,
    draftMode,
    editingCharacterId,
    isGeneratingAiAvatar,
    isSavingCharacter,
    loadCharacters,
    nameDraft,
    noteDraft,
    resetDraft,
    triggersDraft,
    visibilityDraft,
  ])

  const handleDeleteCharacter = useCallback(
    async (characterId: number) => {
      if (isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar) {
        return
      }

      setErrorMessage('')
      setDeletingCharacterId(characterId)
      try {
        await deleteStoryCharacter({
          token: authToken,
          characterId,
        })
        await loadCharacters()
        if (editingCharacterId === characterId) {
          setIsEditorOpen(false)
          resetDraft()
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить персонажа'
        setErrorMessage(detail)
      } finally {
        setDeletingCharacterId(null)
      }
    },
    [authToken, deletingCharacterId, editingCharacterId, isGeneratingAiAvatar, isSavingCharacter, loadCharacters, resetDraft],
  )

  const handleOpenCharacterItemMenu = useCallback((event: ReactMouseEvent<HTMLElement>, characterId: number) => {
    event.stopPropagation()
    setCharacterMenuAnchorEl(event.currentTarget)
    setCharacterMenuCharacterId(characterId)
  }, [])

  const handleCloseCharacterItemMenu = useCallback(() => {
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
  }, [])

  const handleEditCharacterFromMenu = useCallback(() => {
    if (!selectedCharacterMenuItem) {
      return
    }
    handleStartEdit(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, handleStartEdit, selectedCharacterMenuItem])

  const handleRequestDeleteCharacterFromMenu = useCallback(() => {
    if (!selectedCharacterMenuItem || isSavingCharacter || isGeneratingAiAvatar) {
      return
    }
    setCharacterDeleteTarget(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, isGeneratingAiAvatar, isSavingCharacter, selectedCharacterMenuItem])

  const handleCancelCharacterDeletion = useCallback(() => {
    if (deletingCharacterId !== null) {
      return
    }
    setCharacterDeleteTarget(null)
  }, [deletingCharacterId])

  const handleConfirmCharacterDeletion = useCallback(async () => {
    if (!characterDeleteTarget) {
      return
    }
    const targetId = characterDeleteTarget.id
    setCharacterDeleteTarget(null)
    await handleDeleteCharacter(targetId)
  }, [characterDeleteTarget, handleDeleteCharacter])

  useEffect(() => {
    if (!open || hasAppliedInitialAction) {
      return
    }

    if (initialCharacterId !== null) {
      if (!hasLoadedCharacters || isLoadingCharacters) {
        return
      }
      const targetCharacter = sortedCharacters.find((character) => character.id === initialCharacterId) ?? null
      if (targetCharacter) {
        handleStartEdit(targetCharacter)
      }
      setHasAppliedInitialAction(true)
      return
    }

    if (initialMode === 'create') {
      handleStartCreate()
      setHasAppliedInitialAction(true)
      return
    }

    setHasAppliedInitialAction(true)
  }, [
    handleStartCreate,
    handleStartEdit,
    hasAppliedInitialAction,
    hasLoadedCharacters,
    initialCharacterId,
    initialMode,
    isLoadingCharacters,
    open,
    sortedCharacters,
  ])

  return (
    <BaseDialog
      open={open}
      onClose={handleCloseDialog}
      maxWidth="sm"
      rawChildren
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.4rem' }}>Мои персонажи</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.6 }}>
        <Stack spacing={1.1}>
          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          {isEditorOpen ? (
            <Box
              sx={{
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
                px: 1.1,
                py: 1.1,
              }}
            >
              <Stack spacing={1}>
                <Stack spacing={0.7} alignItems="center">
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Изменить аватар персонажа"
                    onClick={handleChooseAvatar}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleChooseAvatar()
                      }
                    }}
                    sx={{
                      position: 'relative',
                      width: CHARACTER_EDITOR_AVATAR_SIZE,
                      height: CHARACTER_EDITOR_AVATAR_SIZE,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: isAvatarActionsLocked ? 'default' : 'pointer',
                      border: '1px dashed rgba(194, 208, 226, 0.5)',
                      background: 'linear-gradient(135deg, rgba(30, 33, 39, 0.86), rgba(56, 60, 68, 0.9))',
                      outline: 'none',
                      '&:hover .morius-character-avatar-overlay': {
                        opacity: hasAvatarDraft && !isAvatarActionsLocked ? 1 : hasAvatarDraft ? 0 : 1,
                      },
                      '&:focus-visible .morius-character-avatar-overlay': {
                        opacity: hasAvatarDraft && !isAvatarActionsLocked ? 1 : hasAvatarDraft ? 0 : 1,
                      },
                    }}
                  >
                    {hasAvatarDraft ? (
                      <Box
                        component="img"
                        src={avatarDraft ?? undefined}
                        alt={nameDraft || 'Character avatar'}
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: `scale(${Math.max(1, Math.min(3, avatarScaleDraft))})`,
                          transformOrigin: 'center center',
                        }}
                      />
                    ) : null}
                    <Box
                      className="morius-character-avatar-overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: hasAvatarDraft ? 'rgba(16, 18, 20, 0.58)' : 'transparent',
                        opacity: hasAvatarDraft ? 0 : 1,
                        transition: 'opacity 180ms ease',
                        pointerEvents: 'none',
                      }}
                    >
                      <Box
                        sx={{
                          width: 62,
                          height: 62,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid rgba(219, 221, 231, 0.68)',
                          backgroundColor: 'rgba(22, 24, 27, 0.66)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--morius-text-primary)',
                          fontSize: '2rem',
                          fontWeight: 400,
                        }}
                      >
                        +
                      </Box>
                    </Box>
                    {isGeneratingAiAvatar ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'grid',
                          placeItems: 'center',
                          backgroundColor: 'rgba(14, 16, 20, 0.56)',
                        }}
                      >
                        <CircularProgress size={28} sx={{ color: 'rgba(224, 232, 243, 0.95)' }} />
                      </Box>
                    ) : null}
                  </Box>
                  <Stack direction="row" spacing={0.7} alignItems="center" justifyContent="center" sx={{ width: '100%' }}>
                    <Tooltip title={hasAvatarDraft ? 'Изменить кроп аватара' : 'Сначала добавьте аватар'}>
                      <span>
                        <IconButton
                          onClick={handleOpenAvatarCrop}
                          disabled={!hasAvatarDraft || isAvatarActionsLocked}
                          sx={{
                            width: 36,
                            height: 36,
                            border: 'var(--morius-border-width) solid rgba(198, 207, 221, 0.36)',
                            backgroundColor: 'rgba(20, 22, 25, 0.76)',
                            color: 'rgba(224, 231, 241, 0.9)',
                            '&:hover': {
                              backgroundColor: 'rgba(29, 33, 37, 0.85)',
                            },
                          }}
                        >
                          <CropFreeIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        hasAvatarDraft
                          ? 'Перегенерировать через ИИ'
                          : canGenerateAiAvatar
                          ? 'Сгенерировать через ИИ'
                          : 'Сначала заполните описание персонажа'
                      }
                    >
                      <span>
                        <IconButton
                          onClick={handleOpenAiAvatarDialog}
                          disabled={isAvatarActionsLocked}
                          sx={{
                            width: 36,
                            height: 36,
                            border: 'var(--morius-border-width) solid rgba(201, 210, 223, 0.36)',
                            backgroundColor: 'rgba(20, 22, 25, 0.76)',
                            color: 'rgba(226, 233, 243, 0.95)',
                            '&:hover': {
                              backgroundColor: 'rgba(29, 33, 37, 0.86)',
                            },
                          }}
                        >
                          {hasAvatarDraft ? <RegenerateIcon /> : <SparkleIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />

                <TextField
                  label="Имя"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  fullWidth
                  disabled={isAvatarActionsLocked}
                  inputProps={{ maxLength: 120 }}
                  helperText={<TextLimitIndicator currentLength={nameDraft.length} maxLength={120} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <TextField
                  label="Описание"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  maxRows={8}
                  disabled={isAvatarActionsLocked}
                  inputProps={{ maxLength: CHARACTER_DESCRIPTION_MAX_LENGTH }}
                  helperText={<TextLimitIndicator currentLength={descriptionDraft.length} maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <TextField
                  label="Триггеры"
                  value={triggersDraft}
                  onChange={(event) => setTriggersDraft(event.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={5}
                  disabled={isAvatarActionsLocked}
                  placeholder="через запятую"
                  inputProps={{ maxLength: CHARACTER_TRIGGERS_MAX_LENGTH }}
                  helperText={<TextLimitIndicator currentLength={triggersDraft.length} maxLength={CHARACTER_TRIGGERS_MAX_LENGTH} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <TextField
                  label="Пометка"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value.slice(0, CHARACTER_NOTE_MAX_LENGTH))}
                  fullWidth
                  disabled={isAvatarActionsLocked}
                  placeholder="Например: Друг Акеми"
                  inputProps={{ maxLength: CHARACTER_NOTE_MAX_LENGTH }}
                  helperText={<TextLimitIndicator currentLength={noteDraft.length} maxLength={CHARACTER_NOTE_MAX_LENGTH} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <Stack spacing={0.6}>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem', fontWeight: 700 }}>
                    Видимость карточки
                  </Typography>
                  <Stack direction="row" spacing={0.8}>
                    <Button
                      onClick={() => setVisibilityDraft('private')}
                      disabled={isAvatarActionsLocked}
                      sx={{
                        minHeight: 34,
                        borderRadius: '10px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: visibilityDraft === 'private' ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                        color: 'var(--morius-text-primary)',
                        textTransform: 'none',
                        '&:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                        },
                      }}
                    >
                      Приватная
                    </Button>
                    <Button
                      onClick={() => setVisibilityDraft('public')}
                      disabled={isAvatarActionsLocked}
                      sx={{
                        minHeight: 34,
                        borderRadius: '10px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: visibilityDraft === 'public' ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                        color: 'var(--morius-text-primary)',
                        textTransform: 'none',
                        '&:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                        },
                      }}
                    >
                      Публичная
                    </Button>
                  </Stack>
                </Stack>
                {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}
                <Stack direction="row" justifyContent="flex-end" spacing={0.8}>
                  <Button onClick={handleCancelEdit} disabled={isAvatarActionsLocked} sx={{ color: 'text.secondary' }}>
                    Отмена
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void handleSaveCharacter()}
                    disabled={isAvatarActionsLocked}
                    sx={{
                      minHeight: 38,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-button-active)',
                      color: 'var(--morius-text-primary)',
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: 'var(--morius-button-hover)',
                      },
                    }}
                  >
                    {isSavingCharacter ? (
                      <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                    ) : draftMode === 'create' ? (
                      'Создать'
                    ) : (
                      'Сохранить'
                    )}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : (
            <Button
              onClick={handleStartCreate}
              disabled={isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                color: 'var(--morius-text-primary)',
                textTransform: 'none',
                alignSelf: 'flex-start',
              }}
            >
              Создать персонажа
            </Button>
          )}

          {isLoadingCharacters && sortedCharacters.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4.2 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Box className="morius-scrollbar" sx={{ maxHeight: 350, overflowY: 'auto', pr: 0.2 }}>
              <Stack spacing={0.75}>
                {sortedCharacters.map((character) => (
                  <Box
                    key={character.id}
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      px: 0.95,
                      py: 0.72,
                    }}
                  >
                    <Stack spacing={0.45}>
                      <Stack direction="row" spacing={0.8} alignItems="center">
                        {character.avatar_url ? (
                          <Box
                            component="button"
                            type="button"
                            onClick={(event) => handleOpenCharacterAvatarPreview(event, character)}
                            aria-label={`Открыть аватар персонажа ${character.name}`}
                            sx={{
                              p: 0,
                              m: 0,
                              border: 'none',
                              outline: 'none',
                              background: 'transparent',
                              borderRadius: '50%',
                              display: 'inline-flex',
                              cursor: 'zoom-in',
                              flexShrink: 0,
                            }}
                          >
                            <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                          </Box>
                        ) : (
                          <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                        )}
                        <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.08}>
                          <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0 }}>
                            <Typography
                              sx={{
                                color: 'var(--morius-title-text)',
                                fontWeight: 700,
                                fontSize: '0.9rem',
                                lineHeight: 1.2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              {character.name}
                            </Typography>
                            {character.note ? (
                              <Box
                                sx={{
                                  borderRadius: '999px',
                                  border: 'var(--morius-border-width) solid rgba(140, 188, 230, 0.44)',
                                  backgroundColor: 'rgba(23, 33, 45, 0.66)',
                                  color: 'rgba(184, 218, 247, 0.96)',
                                  px: 0.58,
                                  py: 0.1,
                                  fontSize: '0.64rem',
                                  lineHeight: 1.2,
                                  fontWeight: 700,
                                  maxWidth: 112,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  flexShrink: 0,
                                }}
                                title={character.note}
                              >
                                {character.note}
                              </Box>
                            ) : null}
                          </Stack>
                          {character.triggers.length > 0 ? (
                            <Typography
                              sx={{
                                color: 'var(--morius-text-secondary)',
                                fontSize: '0.76rem',
                                lineHeight: 1.2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Триггеры: {character.triggers.join(', ')}
                            </Typography>
                          ) : null}
                          <Typography
                            sx={{
                              color: 'var(--morius-text-secondary)',
                              fontSize: '0.74rem',
                              lineHeight: 1.2,
                              opacity: 0.92,
                            }}
                          >
                            {character.visibility === 'public' ? 'Публичная' : 'Приватная'}
                          </Typography>
                        </Stack>
                        <IconButton
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isSavingCharacter || isGeneratingAiAvatar || deletingCharacterId === character.id}
                          sx={{
                            width: 28,
                            height: 28,
                            color: 'var(--morius-text-secondary)',
                            flexShrink: 0,
                            backgroundColor: 'transparent !important',
                            border: 'none',
                            '&:hover': {
                              backgroundColor: 'transparent !important',
                            },
                            '&:active': { backgroundColor: 'transparent !important' },
                            '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                          }}
                        >
                          {deletingCharacterId === character.id ? (
                            <CircularProgress size={14} sx={{ color: 'var(--morius-text-secondary)' }} />
                          ) : (
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>...</Box>
                          )}
                        </IconButton>
                      </Stack>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.82rem',
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {character.description}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
                {sortedCharacters.length === 0 ? (
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                    Персонажей пока нет. Создайте первого.
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <Menu
        anchorEl={characterMenuAnchorEl}
        open={Boolean(characterMenuAnchorEl && selectedCharacterMenuItem)}
        onClose={handleCloseCharacterItemMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 178,
          },
        }}
      >
        <MenuItem
          onClick={handleEditCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            isGeneratingAiAvatar ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>✎</Box>
            <Box component="span">Изменить</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={handleRequestDeleteCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            isGeneratingAiAvatar ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>⌦</Box>
            <Box component="span">Удалить</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <BaseDialog
        open={Boolean(characterAvatarPreview)}
        onClose={handleCloseCharacterAvatarPreview}
        maxWidth="md"
        header={characterAvatarPreview?.name || 'Аватар персонажа'}
        actions={
          <Button onClick={handleCloseCharacterAvatarPreview} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        }
        contentSx={{ px: 1.2, pt: 0.6, pb: 0.7 }}
      >
        {characterAvatarPreview ? (
          <Box
            component="img"
            src={characterAvatarPreview.url}
            alt={characterAvatarPreview.name || 'Character avatar'}
            sx={{
              width: '100%',
              maxHeight: '75vh',
              objectFit: 'contain',
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              display: 'block',
              mx: 'auto',
            }}
          />
        ) : null}
      </BaseDialog>

      <BaseDialog
        open={Boolean(characterDeleteTarget)}
        onClose={handleCancelCharacterDeletion}
        maxWidth="xs"
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Удалить персонажа?</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            {characterDeleteTarget
              ? `Персонаж «${characterDeleteTarget.name}» будет удален из «Мои персонажи». Это действие нельзя отменить.`
              : 'Это действие нельзя отменить.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCancelCharacterDeletion} disabled={deletingCharacterId !== null || isGeneratingAiAvatar} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmCharacterDeletion()}
            disabled={deletingCharacterId !== null || isGeneratingAiAvatar}
            sx={{
              border: 'var(--morius-border-width) solid rgba(228, 120, 120, 0.44)',
              backgroundColor: 'rgba(184, 78, 78, 0.3)',
              color: 'rgba(251, 190, 190, 0.94)',
              '&:hover': { backgroundColor: 'rgba(196, 88, 88, 0.4)' },
            }}
          >
            {deletingCharacterId !== null ? (
              <CircularProgress size={16} sx={{ color: 'rgba(251, 190, 190, 0.94)' }} />
            ) : (
              'Удалить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={isAiAvatarDialogOpen}
        onClose={handleCloseAiAvatarDialog}
        maxWidth="xs"
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {hasAvatarDraft ? 'Перегенерация аватара' : 'Генерация аватара'}
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          <Stack spacing={0.7}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
              Выберите ИИ-модель для генерации персонажа. Стоимость спишется сразу при запуске генерации.
            </Typography>
            <Stack spacing={0.6}>
              {CHARACTER_AI_AVATAR_IMAGE_MODEL_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  onClick={() => setAiAvatarModelDraft(option.id)}
                  disabled={isGeneratingAiAvatar}
                  sx={{
                    justifyContent: 'flex-start',
                    borderRadius: '10px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: aiAvatarModelDraft === option.id ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    px: 1,
                    py: 0.85,
                    '&:hover': {
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                    <Stack alignItems="flex-start" spacing={0.15} sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', lineHeight: 1.25 }}>{option.title}</Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', lineHeight: 1.25 }}>
                        {option.description}
                      </Typography>
                    </Stack>
                    <Typography sx={{ color: 'rgba(231, 211, 158, 0.96)', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {option.cost} Сол
                    </Typography>
                  </Stack>
                </Button>
              ))}
            </Stack>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.84rem', fontWeight: 700 }}>
              Стиль
            </Typography>
            <Box
              component="input"
              value={aiAvatarStylePromptDraft}
              placeholder="Стиль изображения..."
              maxLength={CHARACTER_AI_AVATAR_STYLE_PROMPT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setAiAvatarStylePromptDraft(event.target.value)}
              disabled={isGeneratingAiAvatar}
              sx={{
                width: '100%',
                minHeight: 36,
                borderRadius: '11px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-text-primary)',
                px: 0.92,
                outline: 'none',
                fontSize: '0.85rem',
                '&::placeholder': {
                  color: 'var(--morius-text-secondary)',
                },
              }}
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                {aiAvatarStylePromptDraft.length}/{CHARACTER_AI_AVATAR_STYLE_PROMPT_MAX_LENGTH}
              </Typography>
              {!canGenerateAiAvatar ? (
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                  Сначала заполните описание персонажа
                </Typography>
              ) : null}
            </Stack>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
              Поле «Стиль» необязательно, но помогает задать визуальную манеру.
            </Typography>
            <Box
              sx={{
                borderRadius: '10px',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
                px: 1,
                py: 0.75,
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
              }}
            >
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', mt: 0.2 }}>
                Аватар генерируется в полный рост, после чего автоматически кадрируется под портрет (лицо и грудь).
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseAiAvatarDialog} disabled={isGeneratingAiAvatar} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleGenerateAiAvatar()}
            disabled={isGeneratingAiAvatar || !canGenerateAiAvatar}
            sx={{
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-text-primary)',
              textTransform: 'none',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isGeneratingAiAvatar ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : hasAvatarDraft ? (
              `Перегенерировать за ${selectedAiAvatarGenerationCost} Сол`
            ) : (
              `Сгенерировать за ${selectedAiAvatarGenerationCost} Сол`
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <AvatarCropDialog
        open={Boolean(avatarCropSource)}
        imageSrc={avatarCropSource}
        isSaving={isSavingCharacter || isGeneratingAiAvatar}
        outputSize={384}
        onCancel={() => {
          if (!isSavingCharacter && !isGeneratingAiAvatar) {
            setAvatarCropSource(null)
          }
        }}
        onSave={handleSaveCroppedAvatar}
      />

      <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
        <Button onClick={handleCloseDialog} disabled={isSavingCharacter || isGeneratingAiAvatar || deletingCharacterId !== null} sx={{ color: 'text.secondary' }}>
          Закрыть
        </Button>
      </DialogActions>
    </BaseDialog>
  )
}

export default CharacterManagerDialog


