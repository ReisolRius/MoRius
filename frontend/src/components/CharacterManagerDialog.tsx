import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import {
  Alert,
  Box,
  Button,
  Collapse,
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
import { AI_ASSISTANT_ENTITIES_CHANGED_EVENT } from './ai/aiAssistantEvents'
import CharacterShowcaseCard from './characters/CharacterShowcaseCard'
import SoulAmount from './currency/SoulAmount'
import BaseDialog from './dialogs/BaseDialog'
import ProgressiveImage from './media/ProgressiveImage'
import {
  createStoryCharacterRace,
  createStoryCharacter,
  deleteStoryCharacter,
  generateStoryCharacterAvatar,
  listStoryCharacterRaces,
  listStoryCharacters,
  syncStoryCharacterEmotionAssets,
  updateStoryCharacter,
} from '../services/storyApi'
import type { AiAssistantChatResponse } from '../services/aiAssistantApi'
import type {
  StoryCharacter,
  StoryCharacterEmotionAssets,
  StoryCharacterEmotionId,
  StoryCharacterRace,
  StoryImageModelId,
  StoryNovelSpriteGender,
} from '../types/story'
import { STORY_CHARACTER_EMOTION_IDS, STORY_CHARACTER_EMOTION_LABELS } from '../types/story'
import TextLimitIndicator from './TextLimitIndicator'
import {
  compressImageDataUrl,
  getJsonDataUrlRequestSafeMaxBytes,
  prepareAvatarPayloadForRequest,
  resolveImageSourceToDataUrl,
} from '../utils/avatar'
import { resolvePublicationDraftVisibility } from '../utils/publication'

type CharacterManagerDialogProps = {
  open: boolean
  authToken: string
  onClose: () => void
  initialMode?: 'list' | 'create'
  initialCharacterId?: number | null
  includePublicationCopies?: boolean
  showEmotionTools?: boolean
  extraEditorContent?: ReactNode
}

type CharacterDraftMode = 'create' | 'edit'

const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const CHARACTER_IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024
const CHARACTER_AVATAR_REQUEST_MAX_BYTES = getJsonDataUrlRequestSafeMaxBytes(CHARACTER_AVATAR_MAX_BYTES)
const CHARACTER_EMOTION_IMAGE_SOURCE_MAX_BYTES = 50 * 1024 * 1024
const CHARACTER_EMOTION_ASSET_MAX_BYTES = 12 * 1024 * 1024
const CHARACTER_EMOTION_ASSET_MAX_DIMENSION = 2048
const CHARACTER_DESCRIPTION_MAX_LENGTH = 6000
const CHARACTER_RACE_MAX_LENGTH = 120
const CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH = 1000
const CHARACTER_TRIGGERS_MAX_LENGTH = 600
const CHARACTER_NOTE_MAX_LENGTH = 20
const CHARACTER_DEFAULT_TEXT_COLOR = '#DFE8F3'
const CHARACTER_TEXT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const DEFAULT_CHARACTER_RACE_VALUES = [
  '\u0427\u0435\u043b\u043e\u0432\u0435\u043a',
  '\u042d\u043b\u044c\u0444',
  '\u0414\u0432\u0430\u0440\u0444',
  '\u041f\u043e\u043b\u0443\u0440\u043e\u0441\u043b\u0438\u043a',
  '\u0413\u043d\u043e\u043c',
  '\u0414\u0440\u0443\u0433\u043e\u0435',
] as const
const CHARACTER_EDITOR_AVATAR_SIZE = 248
const CHARACTER_AI_AVATAR_OUTPUT_SIZE = 640
const CHARACTER_AI_AVATAR_STYLE_PROMPT_MAX_LENGTH = 320
const CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID: StoryImageModelId = 'black-forest-labs/flux.2-pro'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_KLEIN_4B_ID: StoryImageModelId = 'black-forest-labs/flux.2-klein-4b'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_SEEDREAM_ID: StoryImageModelId = 'bytedance-seed/seedream-4.5'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_ID: StoryImageModelId = 'google/gemini-2.5-flash-image'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_2_ID: StoryImageModelId = 'google/gemini-3.1-flash-image-preview'
const CHARACTER_AI_AVATAR_IMAGE_MODEL_OPTIONS: Array<{
  id: StoryImageModelId
  title: string
  description: string
  cost: number
}> = [
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_KLEIN_4B_ID,
    title: 'Flux.2 Klein 4B',
    description: 'RouterAI. Fast economical image generation.',
    cost: 6,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_ID,
    title: 'Nano Banano',
    description: 'High-detail character rendering.',
    cost: 9,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_NANO_BANANO_2_ID,
    title: 'Nano Banano 2',
    description: 'Maximum detail and depth rendering.',
    cost: 13,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID,
    title: 'Flux 2 Pro',
    description: 'Быстрая и сбалансированная генерация.',
    cost: 18,
  },
  {
    id: CHARACTER_AI_AVATAR_IMAGE_MODEL_SEEDREAM_ID,
    title: 'Seedream 4.5',
    description: 'Более художественная и мягкая подача.',
    cost: 20,
  },
]
const CHARACTER_EMOTION_IDS: StoryCharacterEmotionId[] = STORY_CHARACTER_EMOTION_IDS
const NOVEL_SPRITE_GENDER_OPTIONS: Array<{ value: StoryNovelSpriteGender; label: string }> = [
  { value: '', label: 'Не указан' },
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
]
const CHARACTER_EMOTION_LABELS: Record<StoryCharacterEmotionId, string> = STORY_CHARACTER_EMOTION_LABELS

type CharacterRaceOption = {
  label: string
  value: string
  isCreateAction?: boolean
}

const filterCharacterRaceOptions = createFilterOptions<CharacterRaceOption>()

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

function normalizeCharacterRaceDraft(value: string): string {
  return value
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHARACTER_RACE_MAX_LENGTH)
}

function normalizeCharacterAdditionalDraft(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH)
}

function normalizeCharacterTextColorValue(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim()
  return CHARACTER_TEXT_COLOR_PATTERN.test(normalized) ? normalized.toUpperCase() : ''
}

function normalizeCharacterTextColorDraft(value: string): string | null {
  return normalizeCharacterTextColorValue(value) || null
}

type CharacterTextColorFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

function CharacterTextColorField({ label, value, onChange, disabled = false }: CharacterTextColorFieldProps) {
  const normalizedValue = normalizeCharacterTextColorValue(value)
  const pickerValue = normalizedValue || CHARACTER_DEFAULT_TEXT_COLOR
  return (
    <Stack spacing={0.45}>
      <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.78rem', fontWeight: 700 }}>
        {label}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Box
          component="input"
          type="color"
          value={pickerValue}
          disabled={disabled}
          onChange={(event) => onChange(String((event.target as HTMLInputElement).value || '').toUpperCase())}
          aria-label={label}
          sx={{
            width: { xs: '100%', sm: 46 },
            height: 36,
            minWidth: { xs: '100%', sm: 46 },
            p: 0,
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            borderRadius: '8px',
            backgroundColor: 'transparent',
            cursor: disabled ? 'default' : 'pointer',
            '&::-webkit-color-swatch-wrapper': { p: 0 },
            '&::-webkit-color-swatch': { border: 0, borderRadius: '7px' },
            '&::-moz-color-swatch': { border: 0, borderRadius: '7px' },
          }}
        />
        <TextField
          value={value}
          onChange={(event) => onChange(event.target.value.trim().slice(0, 7).toUpperCase())}
          placeholder="По умолчанию"
          disabled={disabled}
          size="small"
          inputProps={{ maxLength: 7 }}
          sx={{ flex: 1 }}
        />
        <Button
          onClick={() => onChange('')}
          disabled={disabled || !value}
          sx={{
            minHeight: 36,
            borderRadius: '8px',
            color: 'var(--morius-text-secondary)',
            textTransform: 'none',
          }}
        >
          Сброс
        </Button>
      </Stack>
    </Stack>
  )
}

type CharacterTextColorControlsProps = {
  nameColor: string
  speechColor: string
  bubbleColor: string
  thoughtBubbleColor: string
  onNameColorChange: (value: string) => void
  onSpeechColorChange: (value: string) => void
  onBubbleColorChange: (value: string) => void
  onThoughtBubbleColorChange: (value: string) => void
  disabled?: boolean
}

function CharacterTextColorControls({
  nameColor,
  speechColor,
  bubbleColor,
  thoughtBubbleColor,
  onNameColorChange,
  onSpeechColorChange,
  onBubbleColorChange,
  onThoughtBubbleColorChange,
  disabled = false,
}: CharacterTextColorControlsProps) {
  return (
    <Stack spacing={0.85}>
      <CharacterTextColorField
        label="Цвет имени"
        value={nameColor}
        onChange={onNameColorChange}
        disabled={disabled}
      />
      <CharacterTextColorField
        label="Цвет реплик"
        value={speechColor}
        onChange={onSpeechColorChange}
        disabled={disabled}
      />
      <CharacterTextColorField
        label="Цвет фона реплик"
        value={bubbleColor}
        onChange={onBubbleColorChange}
        disabled={disabled}
      />
      <CharacterTextColorField
        label="Цвет фона «В голове»"
        value={thoughtBubbleColor}
        onChange={onThoughtBubbleColorChange}
        disabled={disabled}
      />
    </Stack>
  )
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = dataUrl
  })
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
  showEmotionTools = false,
  extraEditorContent = null,
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
  const [raceDraft, setRaceDraft] = useState('')
  const [raceInputDraft, setRaceInputDraft] = useState('')
  const [clothingDraft, setClothingDraft] = useState('')
  const [inventoryDraft, setInventoryDraft] = useState('')
  const [healthStatusDraft, setHealthStatusDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [triggersDraft, setTriggersDraft] = useState('')
  const [nameColorDraft, setNameColorDraft] = useState('')
  const [speechColorDraft, setSpeechColorDraft] = useState('')
  const [bubbleColorDraft, setBubbleColorDraft] = useState('')
  const [thoughtBubbleColorDraft, setThoughtBubbleColorDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [avatarSourceDraft, setAvatarSourceDraft] = useState<string | null>(null)
  const [avatarScaleDraft, setAvatarScaleDraft] = useState(1)
  const [visibilityDraft, setVisibilityDraft] = useState<'private' | 'public'>('private')
  const [emotionAssetsDraft, setEmotionAssetsDraft] = useState<StoryCharacterEmotionAssets>({})
  const [novelSpriteGenderDraft, setNovelSpriteGenderDraft] = useState<StoryNovelSpriteGender>('')
  const [uploadingEmotionId, setUploadingEmotionId] = useState<StoryCharacterEmotionId | null>(null)
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isAiAvatarDialogOpen, setIsAiAvatarDialogOpen] = useState(false)
  const [aiAvatarModelDraft, setAiAvatarModelDraft] = useState<StoryImageModelId>(CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID)
  const [aiAvatarStylePromptDraft, setAiAvatarStylePromptDraft] = useState('')
  const [isGeneratingAiAvatar, setIsGeneratingAiAvatar] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isAdditionalFieldsExpanded, setIsAdditionalFieldsExpanded] = useState(false)
  const [characterRaceOptions, setCharacterRaceOptions] = useState<StoryCharacterRace[]>([])
  const [isLoadingCharacterRaces, setIsLoadingCharacterRaces] = useState(false)
  const [isSavingCharacterRace, setIsSavingCharacterRace] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const [characterDeleteTarget, setCharacterDeleteTarget] = useState<StoryCharacter | null>(null)
  const [characterAvatarPreview, setCharacterAvatarPreview] = useState<{ url: string; name: string } | null>(null)
  const [characterEmotionPreview, setCharacterEmotionPreview] = useState<{
    url: string
    name: string
    emotionId: StoryCharacterEmotionId
  } | null>(null)
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
  const isAvatarActionsLocked = isSavingCharacter || isGeneratingAiAvatar || uploadingEmotionId !== null
  const isCharacterDialogBusy =
    isSavingCharacter || deletingCharacterId !== null || isGeneratingAiAvatar || uploadingEmotionId !== null
  const normalizedDescriptionDraft = useMemo(() => descriptionDraft.replace(/\r\n/g, '\n').trim(), [descriptionDraft])
  const normalizedRaceDraft = useMemo(() => normalizeCharacterRaceDraft(raceDraft), [raceDraft])
  const normalizedRaceInputDraft = useMemo(() => normalizeCharacterRaceDraft(raceInputDraft), [raceInputDraft])
  const raceOptions = useMemo(() => {
    const seen = new Set<string>()
    const items: CharacterRaceOption[] = []
    const pushOption = (rawValue: string) => {
      const normalizedValue = normalizeCharacterRaceDraft(rawValue)
      if (!normalizedValue) {
        return
      }
      const key = normalizedValue.toLocaleLowerCase()
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      items.push({
        label: normalizedValue,
        value: normalizedValue,
      })
    }
    DEFAULT_CHARACTER_RACE_VALUES.forEach((item) => pushOption(item))
    characterRaceOptions.forEach((item) => pushOption(item.name))
    pushOption(raceDraft)
    return items
  }, [characterRaceOptions, raceDraft])
  const selectedRaceOption = useMemo(
    () => raceOptions.find((option) => option.value === normalizedRaceDraft) ?? null,
    [normalizedRaceDraft, raceOptions],
  )
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
  const readyEmotionCount = useMemo(
    () => CHARACTER_EMOTION_IDS.filter((emotionId) => Boolean((emotionAssetsDraft[emotionId] ?? '').trim())).length,
    [emotionAssetsDraft],
  )
  const clearEmotionPresetDraft = useCallback(() => {
    setEmotionAssetsDraft({})
    setNovelSpriteGenderDraft('')
  }, [])

  const resetDraft = useCallback(() => {
    setDraftMode('create')
    setEditingCharacterId(null)
    setNameDraft('')
    setDescriptionDraft('')
    setRaceDraft('')
    setRaceInputDraft('')
    setClothingDraft('')
    setInventoryDraft('')
    setHealthStatusDraft('')
    setNoteDraft('')
    setTriggersDraft('')
    setNameColorDraft('')
    setSpeechColorDraft('')
    setAvatarDraft(null)
    setAvatarSourceDraft(null)
    setAvatarScaleDraft(1)
    setVisibilityDraft('private')
    clearEmotionPresetDraft()
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    setAiAvatarModelDraft(CHARACTER_AI_AVATAR_IMAGE_MODEL_FLUX_ID)
    setAiAvatarStylePromptDraft('')
    setIsGeneratingAiAvatar(false)
    setUploadingEmotionId(null)
    setIsAdditionalFieldsExpanded(false)
    setAvatarError('')
  }, [clearEmotionPresetDraft])

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
          race: typeof item.race === 'string' ? item.race : '',
          clothing: typeof item.clothing === 'string' ? item.clothing : '',
          inventory: typeof item.inventory === 'string' ? item.inventory : '',
          health_status: typeof item.health_status === 'string' ? item.health_status : '',
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

  const loadCharacterRaces = useCallback(async () => {
    setIsLoadingCharacterRaces(true)
    try {
      const loadedRaces = await listStoryCharacterRaces({ token: authToken })
      setCharacterRaceOptions(loadedRaces)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить расы персонажей'
      setErrorMessage(detail)
      setCharacterRaceOptions([])
    } finally {
      setIsLoadingCharacterRaces(false)
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
      setUploadingEmotionId(null)
      setHasAppliedInitialAction(false)
      setHasLoadedCharacters(false)
      setCharacterRaceOptions([])
      setRaceInputDraft('')
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
    void loadCharacterRaces()
  }, [loadCharacterRaces, loadCharacters, open, resetDraft])

  useEffect(() => {
    if (!open) {
      return
    }
    const handleAiAssistantEntitiesChanged = (event: Event) => {
      const detail = (event as CustomEvent<AiAssistantChatResponse>).detail
      const refs = [...(detail?.createdEntities ?? []), ...(detail?.updatedEntities ?? []), ...(detail?.deletedEntities ?? [])]
      if (refs.some((ref) => ref.type === 'profile_character')) {
        void loadCharacters()
      }
    }
    window.addEventListener(AI_ASSISTANT_ENTITIES_CHANGED_EVENT, handleAiAssistantEntitiesChanged as EventListener)
    return () => {
      window.removeEventListener(AI_ASSISTANT_ENTITIES_CHANGED_EVENT, handleAiAssistantEntitiesChanged as EventListener)
    }
  }, [loadCharacters, open])

  const handleCloseDialog = () => {
    if (isCharacterDialogBusy) {
      return
    }
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setCharacterDeleteTarget(null)
    setCharacterAvatarPreview(null)
    setCharacterEmotionPreview(null)
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    onClose()
  }

  const handleCloseCharacterAvatarPreview = useCallback(() => {
    setCharacterAvatarPreview(null)
  }, [])

  const handleOpenCharacterEmotionPreview = useCallback(
    (emotionId: StoryCharacterEmotionId, url: string, characterName: string) => {
      const normalizedUrl = url.trim()
      if (!normalizedUrl) {
        return
      }
      setCharacterEmotionPreview({
        url: normalizedUrl,
        name: characterName.trim() || 'Персонаж',
        emotionId,
      })
    },
    [],
  )

  const handleCloseCharacterEmotionPreview = useCallback(() => {
    setCharacterEmotionPreview(null)
  }, [])

  const handleStartCreate = useCallback(() => {
    if (isCharacterDialogBusy) {
      return
    }
    resetDraft()
    setIsEditorOpen(true)
  }, [isCharacterDialogBusy, resetDraft])

  const handleStartEdit = useCallback((character: StoryCharacter) => {
    if (isCharacterDialogBusy) {
      return
    }
    setDraftMode('edit')
    setEditingCharacterId(character.id)
    setNameDraft(character.name)
    setDescriptionDraft(character.description)
    setRaceDraft(character.race ?? '')
    setRaceInputDraft(character.race ?? '')
    setClothingDraft(character.clothing ?? '')
    setInventoryDraft(character.inventory ?? '')
    setHealthStatusDraft(character.health_status ?? '')
    setNoteDraft(character.note)
    setTriggersDraft(character.triggers.join(', '))
    setNameColorDraft(normalizeCharacterTextColorValue(character.name_color))
    setSpeechColorDraft(normalizeCharacterTextColorValue(character.speech_color))
    setBubbleColorDraft(normalizeCharacterTextColorValue(character.bubble_color))
    setThoughtBubbleColorDraft(normalizeCharacterTextColorValue(character.thought_bubble_color))
    setAvatarDraft(character.avatar_url)
    setAvatarSourceDraft(character.avatar_original_url ?? character.avatar_url)
    setAvatarScaleDraft(Math.max(1, Math.min(3, character.avatar_scale ?? 1)))
    setVisibilityDraft(resolvePublicationDraftVisibility(character.publication, character.visibility))
    setEmotionAssetsDraft(character.emotion_assets ?? {})
    setNovelSpriteGenderDraft(character.novel_sprite_gender ?? '')
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    setUploadingEmotionId(null)
    setIsAdditionalFieldsExpanded(
      Boolean(
        (character.clothing ?? '').trim() || (character.inventory ?? '').trim() || (character.health_status ?? '').trim(),
      ),
    )
    setAvatarError('')
    setIsEditorOpen(true)
  }, [isCharacterDialogBusy])

  const handleCancelEdit = () => {
    if (isCharacterDialogBusy) {
      return
    }
    setIsEditorOpen(false)
    setAvatarCropSource(null)
    setIsAiAvatarDialogOpen(false)
    resetDraft()
  }

  const handleChooseAvatar = () => {
    if (isAvatarActionsLocked) {
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

    if (selectedFile.size > CHARACTER_IMAGE_SOURCE_MAX_BYTES) {
      setAvatarError('Файл слишком большой для обработки в браузере. Максимум 20 МБ.')
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
      if (isAvatarActionsLocked || !croppedDataUrl) {
        return
      }
      void (async () => {
        try {
          const normalizedAvatar = await compressImageDataUrl(croppedDataUrl, {
            maxBytes: CHARACTER_AVATAR_REQUEST_MAX_BYTES,
            maxDimension: CHARACTER_AI_AVATAR_OUTPUT_SIZE,
          })
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
    [isAvatarActionsLocked],
  )

  const handleOpenAvatarCrop = useCallback(() => {
    if (isAvatarActionsLocked || !hasAvatarDraft) {
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
  }, [avatarDraft, avatarSourceDraft, hasAvatarDraft, isAvatarActionsLocked])

  const handleOpenAiAvatarDialog = useCallback(() => {
    if (isCharacterDialogBusy) {
      return
    }
    setIsAiAvatarDialogOpen(true)
  }, [isCharacterDialogBusy])

  const handleCloseAiAvatarDialog = useCallback(() => {
    if (isGeneratingAiAvatar) {
      return
    }
    setIsAiAvatarDialogOpen(false)
  }, [isGeneratingAiAvatar])

  const handleCreateRace = useCallback(
    async (rawValue: string) => {
      const normalizedValue = normalizeCharacterRaceDraft(rawValue)
      if (!normalizedValue || isSavingCharacterRace) {
        return
      }
      setIsSavingCharacterRace(true)
      setErrorMessage('')
      try {
        const createdRace = await createStoryCharacterRace({
          token: authToken,
          name: normalizedValue,
        })
        setCharacterRaceOptions((previous) => {
          const nextItems = [...previous.filter((item) => item.id !== createdRace.id), createdRace]
          nextItems.sort((left, right) => left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' }))
          return nextItems
        })
        setRaceDraft(createdRace.name)
        setRaceInputDraft(createdRace.name)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить новую расу'
        setErrorMessage(detail)
      } finally {
        setIsSavingCharacterRace(false)
      }
    },
    [authToken, isSavingCharacterRace],
  )

  const handleRaceSelectionChange = useCallback(
    (_event: unknown, option: CharacterRaceOption | null) => {
      if (isAvatarActionsLocked) {
        return
      }
      if (!option) {
        setRaceDraft('')
        setRaceInputDraft('')
        return
      }
      if (option.isCreateAction) {
        void handleCreateRace(option.value)
        return
      }
      setRaceDraft(option.value)
      setRaceInputDraft(option.value)
    },
    [handleCreateRace, isAvatarActionsLocked],
  )

  const handleGenerateAiAvatar = useCallback(async () => {
    if (isCharacterDialogBusy) {
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
        maxBytes: CHARACTER_AVATAR_REQUEST_MAX_BYTES,
        maxDimension: CHARACTER_AI_AVATAR_OUTPUT_SIZE,
      })
      setAvatarSourceDraft(sourceDataUrl)
      setAvatarDraft(normalizedAvatar)
      setAvatarScaleDraft(1)
      clearEmotionPresetDraft()
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
    clearEmotionPresetDraft,
    isCharacterDialogBusy,
    isGeneratingAiAvatar,
    normalizedAiAvatarStylePromptDraft,
    normalizedDescriptionDraft,
  ])

  const handleClearEmotionPreset = useCallback(() => {
    if (!showEmotionTools || isAvatarActionsLocked) {
      return
    }
    clearEmotionPresetDraft()
  }, [clearEmotionPresetDraft, isAvatarActionsLocked, showEmotionTools])

  const emotionSlotInputRef = useRef<HTMLInputElement | null>(null)
  const emotionSlotUploadTargetRef = useRef<StoryCharacterEmotionId | null>(null)

  const handleChooseEmotionSlot = useCallback(
    (emotionId: StoryCharacterEmotionId) => {
      if (!showEmotionTools || isAvatarActionsLocked) {
        return
      }
      emotionSlotUploadTargetRef.current = emotionId
      emotionSlotInputRef.current?.click()
    },
    [isAvatarActionsLocked, showEmotionTools],
  )

  const handleEmotionSlotFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    const emotionId = emotionSlotUploadTargetRef.current
    event.target.value = ''
    emotionSlotUploadTargetRef.current = null
    if (!selectedFile || !emotionId) {
      return
    }
    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }
    if (selectedFile.size > CHARACTER_EMOTION_IMAGE_SOURCE_MAX_BYTES) {
      setAvatarError('Файл слишком большой для обработки в браузере. Максимум 50 МБ.')
      return
    }

    setAvatarError('')
    setUploadingEmotionId(emotionId)
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      const normalizedSprite = await compressImageDataUrl(dataUrl, {
        maxBytes: CHARACTER_EMOTION_ASSET_MAX_BYTES,
        maxDimension: CHARACTER_EMOTION_ASSET_MAX_DIMENSION,
      })
      setEmotionAssetsDraft((current) => ({ ...current, [emotionId]: normalizedSprite }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить изображение'
      setAvatarError(detail)
    } finally {
      setUploadingEmotionId(null)
    }
  }, [])

  const handleRemoveEmotionSlot = useCallback(
    (emotionId: StoryCharacterEmotionId) => {
      if (!showEmotionTools || isAvatarActionsLocked) {
        return
      }
      setEmotionAssetsDraft((current) => {
        const next = { ...current }
        delete next[emotionId]
        return next
      })
    },
    [isAvatarActionsLocked, showEmotionTools],
  )

  const handleSaveCharacter = useCallback(async () => {
    if (isAvatarActionsLocked) {
      return
    }
    const normalizedName = nameDraft.replace(/\s+/g, ' ').trim()
    const normalizedDescription = descriptionDraft.replace(/\r\n/g, '\n').trim()
    const normalizedRace = normalizeCharacterRaceDraft(raceDraft)
    const normalizedClothing = normalizeCharacterAdditionalDraft(clothingDraft)
    const normalizedInventory = normalizeCharacterAdditionalDraft(inventoryDraft)
    const normalizedHealthStatus = normalizeCharacterAdditionalDraft(healthStatusDraft)
    const normalizedNote = normalizeCharacterNoteDraft(noteDraft)
    const normalizedNameColor = normalizeCharacterTextColorDraft(nameColorDraft)
    const normalizedSpeechColor = normalizeCharacterTextColorDraft(speechColorDraft)
    const normalizedBubbleColor = normalizeCharacterTextColorDraft(bubbleColorDraft)
    const normalizedThoughtBubbleColor = normalizeCharacterTextColorDraft(thoughtBubbleColorDraft)

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
      const preparedAvatarPayload = await prepareAvatarPayloadForRequest({
        avatarUrl: avatarDraft,
        avatarOriginalUrl: avatarSourceDraft ?? avatarDraft,
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: CHARACTER_AI_AVATAR_OUTPUT_SIZE,
      })
      const previousEmotionAssets =
        draftMode === 'edit' && editingCharacterId !== null
          ? sortedCharacters.find((character) => character.id === editingCharacterId)?.emotion_assets ?? {}
          : {}
      let savedCharacter: StoryCharacter | null = null
      if (draftMode === 'create') {
        savedCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            race: normalizedRace,
            clothing: normalizedClothing,
            inventory: normalizedInventory,
            health_status: normalizedHealthStatus,
            note: normalizedNote,
            name_color: normalizedNameColor,
            speech_color: normalizedSpeechColor,
            bubble_color: normalizedBubbleColor,
            thought_bubble_color: normalizedThoughtBubbleColor,
            triggers: normalizedTriggers,
            avatar_url: preparedAvatarPayload.avatarUrl,
            avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
            avatar_scale: avatarScaleDraft,
            novel_sprite_gender: showEmotionTools ? novelSpriteGenderDraft : '',
            visibility: visibilityDraft,
          },
        })
      } else if (editingCharacterId !== null) {
        savedCharacter = await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            race: normalizedRace,
            clothing: normalizedClothing,
            inventory: normalizedInventory,
            health_status: normalizedHealthStatus,
            note: normalizedNote,
            name_color: normalizedNameColor,
            speech_color: normalizedSpeechColor,
            bubble_color: normalizedBubbleColor,
            thought_bubble_color: normalizedThoughtBubbleColor,
            triggers: normalizedTriggers,
            avatar_url: preparedAvatarPayload.avatarUrl,
            avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
            avatar_scale: avatarScaleDraft,
            novel_sprite_gender: showEmotionTools ? novelSpriteGenderDraft : '',
            visibility: visibilityDraft,
          },
        })
      }
      if (showEmotionTools && savedCharacter) {
        await syncStoryCharacterEmotionAssets({
          token: authToken,
          characterId: savedCharacter.id,
          assets: emotionAssetsDraft,
          previousAssets: previousEmotionAssets,
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
    avatarSourceDraft,
    avatarScaleDraft,
    descriptionDraft,
    draftMode,
    emotionAssetsDraft,
    novelSpriteGenderDraft,
    editingCharacterId,
    clothingDraft,
    healthStatusDraft,
    inventoryDraft,
    isAvatarActionsLocked,
    loadCharacters,
    nameDraft,
    nameColorDraft,
    noteDraft,
    raceDraft,
    resetDraft,
    showEmotionTools,
    sortedCharacters,
    speechColorDraft,
    bubbleColorDraft,
    thoughtBubbleColorDraft,
    triggersDraft,
    visibilityDraft,
  ])

  const handleDeleteCharacter = useCallback(
    async (characterId: number) => {
      if (isCharacterDialogBusy) {
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
    [authToken, editingCharacterId, isCharacterDialogBusy, loadCharacters, resetDraft],
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
    if (!selectedCharacterMenuItem || isCharacterDialogBusy) {
      return
    }
    setCharacterDeleteTarget(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, isCharacterDialogBusy, selectedCharacterMenuItem])

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
      <DialogTitle data-tour-id="character-manager-title" sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.4rem' }}>Мои персонажи</Typography>
      </DialogTitle>
      <DialogContent data-tour-id="character-manager-dialog" sx={{ pt: 0.6 }}>
        <Stack spacing={1.1}>
          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          {isEditorOpen ? (
            <>
            <Box
              data-tour-id="character-manager-editor"
              sx={{
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
                px: 1.1,
                py: 1.1,
              }}
            >
              <Stack spacing={1}>
                <Stack data-tour-id="character-manager-avatar-section" spacing={0.7} alignItems="center">
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
                      <ProgressiveImage
                        src={avatarDraft}
                        alt={nameDraft || 'Character avatar'}
                        loading="eager"
                        fetchPriority="high"
                        objectFit="cover"
                        loaderSize={26}
                        containerSx={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                        }}
                        imgSx={{
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
                    <Tooltip disableInteractive title={hasAvatarDraft ? 'Изменить кроп аватара' : 'Сначала добавьте аватар'}>
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
                      disableInteractive
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

                <Autocomplete<CharacterRaceOption, false, false, false>
                  options={raceOptions}
                  value={selectedRaceOption}
                  inputValue={raceInputDraft}
                  onInputChange={(_event, nextValue, reason) => {
                    if (reason === 'reset') {
                      setRaceInputDraft(selectedRaceOption?.value ?? '')
                      return
                    }
                    setRaceInputDraft(nextValue.slice(0, CHARACTER_RACE_MAX_LENGTH))
                  }}
                  onChange={handleRaceSelectionChange}
                  filterOptions={(options, params) => {
                    const filtered = filterCharacterRaceOptions(options, params)
                    const normalizedInputValue = normalizeCharacterRaceDraft(params.inputValue)
                    const hasExactMatch = options.some(
                      (option) => option.value.toLocaleLowerCase() === normalizedInputValue.toLocaleLowerCase(),
                    )
                    if (normalizedInputValue && !hasExactMatch) {
                      filtered.push({
                        label: `Добавить: ${normalizedInputValue}`,
                        value: normalizedInputValue,
                        isCreateAction: true,
                      })
                    }
                    return filtered
                  }}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.value === value.value}
                  loading={isLoadingCharacterRaces || isSavingCharacterRace}
                  disabled={isAvatarActionsLocked || isSavingCharacterRace}
                  clearOnBlur
                  selectOnFocus
                  handleHomeEndKeys
                  renderOption={(props, option) => (
                    <Box component="li" {...props}>
                      {option.label}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Раса"
                      placeholder="Выберите или добавьте расу"
                      inputProps={{
                        ...params.inputProps,
                        maxLength: CHARACTER_RACE_MAX_LENGTH,
                      }}
                      helperText={<TextLimitIndicator currentLength={normalizedRaceInputDraft.length} maxLength={CHARACTER_RACE_MAX_LENGTH} />}
                      FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    />
                  )}
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
                <Stack spacing={0.7}>
                  <Button
                    onClick={() => setIsAdditionalFieldsExpanded((previous) => !previous)}
                    disabled={isAvatarActionsLocked}
                    sx={{
                      width: '100%',
                      minHeight: 42,
                      px: 0,
                      pb: 0.55,
                      borderRadius: 0,
                      justifyContent: 'space-between',
                      textTransform: 'none',
                      color: 'var(--morius-title-text)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                      boxShadow: 'none',
                      '&:hover': { backgroundColor: 'transparent', boxShadow: 'none' },
                    }}
                  >
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 700 }}>
                      Дополнительно
                    </Typography>
                    <SvgIcon
                      sx={{
                        fontSize: 20,
                        color: 'var(--morius-text-secondary)',
                        transform: isAdditionalFieldsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 180ms ease',
                      }}
                    >
                      <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                    </SvgIcon>
                  </Button>
                  <Collapse in={isAdditionalFieldsExpanded} timeout={180} unmountOnExit>
                    <Stack spacing={0.9}>
                      <TextField
                        label="Одежда"
                        value={clothingDraft}
                        onChange={(event) => setClothingDraft(event.target.value.slice(0, CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                        fullWidth
                        multiline
                        minRows={3}
                        maxRows={6}
                        disabled={isAvatarActionsLocked}
                        inputProps={{ maxLength: CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                        helperText={<TextLimitIndicator currentLength={clothingDraft.length} maxLength={CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      />
                      <TextField
                        label="Инвентарь"
                        value={inventoryDraft}
                        onChange={(event) => setInventoryDraft(event.target.value.slice(0, CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                        fullWidth
                        multiline
                        minRows={3}
                        maxRows={6}
                        disabled={isAvatarActionsLocked}
                        inputProps={{ maxLength: CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                        helperText={<TextLimitIndicator currentLength={inventoryDraft.length} maxLength={CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      />
                      <TextField
                        label="Состояние здоровья"
                        value={healthStatusDraft}
                        onChange={(event) => setHealthStatusDraft(event.target.value.slice(0, CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={5}
                        disabled={isAvatarActionsLocked}
                        inputProps={{ maxLength: CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                        helperText={<TextLimitIndicator currentLength={healthStatusDraft.length} maxLength={CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      />
                    </Stack>
                  </Collapse>
                </Stack>
                <TextField
                  label="Триггеры"
                  data-tour-id="character-manager-triggers-section"
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
                  data-tour-id="character-manager-notes-section"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value.slice(0, CHARACTER_NOTE_MAX_LENGTH))}
                  fullWidth
                  disabled={isAvatarActionsLocked}
                  placeholder="Например: Друг Акеми"
                  inputProps={{ maxLength: CHARACTER_NOTE_MAX_LENGTH }}
                  helperText={<TextLimitIndicator currentLength={noteDraft.length} maxLength={CHARACTER_NOTE_MAX_LENGTH} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <CharacterTextColorControls
                  nameColor={nameColorDraft}
                  speechColor={speechColorDraft}
                  bubbleColor={bubbleColorDraft}
                  thoughtBubbleColor={thoughtBubbleColorDraft}
                  onNameColorChange={setNameColorDraft}
                  onSpeechColorChange={setSpeechColorDraft}
                  onBubbleColorChange={setBubbleColorDraft}
                  onThoughtBubbleColorChange={setThoughtBubbleColorDraft}
                  disabled={isAvatarActionsLocked}
                />
                {extraEditorContent ? <Box>{extraEditorContent}</Box> : null}
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
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: visibilityDraft === 'private' ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                        fontWeight: visibilityDraft === 'private' ? 800 : 650,
                        textTransform: 'none',
                        '&:hover': {
                          backgroundColor: 'transparent',
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
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: visibilityDraft === 'public' ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                        fontWeight: visibilityDraft === 'public' ? 800 : 650,
                        textTransform: 'none',
                        '&:hover': {
                          backgroundColor: 'transparent',
                        },
                      }}
                    >
                      Публичная
                    </Button>
                  </Stack>
                </Stack>
                {showEmotionTools ? (
                  <Stack
                    spacing={0.7}
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 80%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                      px: 1,
                      py: 0.9,
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.86rem', fontWeight: 700 }}>
                          Спрайты эмоций (визуальная новелла)
                        </Typography>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                          {readyEmotionCount}/{CHARACTER_EMOTION_IDS.length} загружено вручную
                        </Typography>
                      </Box>
                      {readyEmotionCount > 0 ? (
                        <Button
                          onClick={handleClearEmotionPreset}
                          disabled={isAvatarActionsLocked}
                          sx={{
                            minHeight: 30,
                            borderRadius: '9px',
                            px: 1,
                            color: 'rgba(228, 194, 194, 0.92)',
                            textTransform: 'none',
                          }}
                        >
                          Очистить
                        </Button>
                      ) : null}
                    </Stack>
                    <Stack direction="row" spacing={0.6} alignItems="center">
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                        Пол (для силуэта-инкогнито):
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        {NOVEL_SPRITE_GENDER_OPTIONS.map((option) => {
                          const isSelected = novelSpriteGenderDraft === option.value
                          return (
                            <Button
                              key={option.value || 'none'}
                              onClick={() => setNovelSpriteGenderDraft(option.value)}
                              disabled={isAvatarActionsLocked}
                              sx={{
                                minHeight: 28,
                                borderRadius: '999px',
                                px: 1,
                                border: 'var(--morius-border-width) solid rgba(189, 202, 220, 0.22)',
                                backgroundColor: isSelected ? 'rgba(61, 84, 118, 0.56)' : 'rgba(26, 30, 35, 0.7)',
                                color: isSelected ? 'rgba(235, 243, 255, 0.96)' : 'var(--morius-text-secondary)',
                                fontSize: '0.72rem',
                                textTransform: 'none',
                              }}
                            >
                              {option.label}
                            </Button>
                          )
                        })}
                      </Stack>
                    </Stack>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
                        gap: 0.7,
                      }}
                    >
                      {CHARACTER_EMOTION_IDS.map((emotionId) => {
                        const assetUrl = (emotionAssetsDraft[emotionId] ?? '').trim()
                        const isUploadingSlot = uploadingEmotionId === emotionId
                        return (
                          <Box
                            key={emotionId}
                            sx={{
                              position: 'relative',
                              borderRadius: '14px',
                              overflow: 'hidden',
                              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                              backgroundColor: 'rgba(18, 21, 25, 0.88)',
                            }}
                          >
                            <Box
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                assetUrl
                                  ? handleOpenCharacterEmotionPreview(emotionId, assetUrl, nameDraft)
                                  : handleChooseEmotionSlot(emotionId)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  assetUrl
                                    ? handleOpenCharacterEmotionPreview(emotionId, assetUrl, nameDraft)
                                    : handleChooseEmotionSlot(emotionId)
                                }
                              }}
                              sx={{
                                position: 'relative',
                                height: 104,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: isAvatarActionsLocked ? 'default' : assetUrl ? 'zoom-in' : 'pointer',
                                background: assetUrl
                                  ? 'linear-gradient(180deg, rgba(34, 39, 46, 0.78) 0%, rgba(18, 21, 25, 0.96) 100%)'
                                  : 'transparent',
                                border: assetUrl ? 'none' : '1px dashed rgba(194, 208, 226, 0.4)',
                              }}
                            >
                              {assetUrl ? (
                                <ProgressiveImage
                                  src={assetUrl}
                                  alt={`${nameDraft || 'Персонаж'} ${CHARACTER_EMOTION_LABELS[emotionId]}`}
                                  loading="lazy"
                                  fetchPriority="low"
                                  objectFit="contain"
                                  objectPosition="top center"
                                  loaderSize={20}
                                  containerSx={{ width: '100%', height: '100%' }}
                                  imgSx={{ transform: 'scale(1.05)' }}
                                />
                              ) : (
                                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '1.6rem', fontWeight: 300 }}>
                                  +
                                </Typography>
                              )}
                              {isUploadingSlot ? (
                                <Box
                                  sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'grid',
                                    placeItems: 'center',
                                    backgroundColor: 'rgba(14, 16, 20, 0.56)',
                                  }}
                                >
                                  <CircularProgress size={20} sx={{ color: 'rgba(224, 232, 243, 0.95)' }} />
                                </Box>
                              ) : null}
                              {assetUrl && !isAvatarActionsLocked ? (
                                <IconButton
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleRemoveEmotionSlot(emotionId)
                                  }}
                                  sx={{
                                    position: 'absolute',
                                    top: 3,
                                    right: 3,
                                    width: 22,
                                    height: 22,
                                    backgroundColor: 'rgba(10, 12, 15, 0.72)',
                                    color: 'rgba(240, 244, 250, 0.92)',
                                    '&:hover': { backgroundColor: 'rgba(16, 18, 22, 0.88)' },
                                  }}
                                >
                                  <Typography sx={{ fontSize: '0.7rem', lineHeight: 1 }}>{'\u00d7'}</Typography>
                                </IconButton>
                              ) : null}
                            </Box>
                            <Box sx={{ px: 0.7, py: 0.5 }}>
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2 }}>
                                {CHARACTER_EMOTION_LABELS[emotionId]}
                              </Typography>
                            </Box>
                          </Box>
                        )
                      })}
                    </Box>
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', lineHeight: 1.32 }}>
                      Загрузите PNG для каждой эмоции вручную. Пустые слоты в новелле показываются как силуэт-инкогнито.
                    </Typography>
                    <input
                      ref={emotionSlotInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => void handleEmotionSlotFileChange(event)}
                    />
                  </Stack>
                ) : null}
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
                        backgroundColor: 'transparent',
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
            </>
          ) : (
            <Button
              onClick={handleStartCreate}
              disabled={isCharacterDialogBusy}
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
              <Stack spacing={0.9}>
                {sortedCharacters.map((character) => {
                  const emotionReadyCount = CHARACTER_EMOTION_IDS.filter((emotionId) => Boolean((character.emotion_assets?.[emotionId] ?? '').trim())).length
                  return (
                    <CharacterShowcaseCard
                      key={character.id}
                      title={character.name}
                      description={character.description || 'Описание не заполнено.'}
                      imageUrl={character.avatar_url}
                      imageScale={character.avatar_scale}
                      eyebrow={character.note || (character.triggers.length > 0 ? `Триггеры: ${character.triggers.join(', ')}` : null)}
                      footerHint={character.visibility === 'public' ? 'Публичный персонаж' : 'Приватный персонаж'}
                      metaPrimary={showEmotionTools ? `Эмоции ${emotionReadyCount}/${CHARACTER_EMOTION_IDS.length}` : null}
                      metaSecondary={character.race ? `Раса: ${character.race}` : character.visibility === 'public' ? 'Public' : 'Private'}
                      minHeight={300}
                      actionSlot={
                        <IconButton
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isAvatarActionsLocked || deletingCharacterId === character.id}
                          sx={{
                            width: 28,
                            height: 28,
                            color: 'rgba(239, 244, 250, 0.92)',
                            flexShrink: 0,
                            backgroundColor: 'rgba(8, 12, 18, 0.42) !important',
                            border: 'var(--morius-border-width) solid rgba(225, 233, 243, 0.16)',
                            '&:hover': { backgroundColor: 'rgba(10, 16, 24, 0.62) !important' },
                            '&:active': { backgroundColor: 'rgba(10, 16, 24, 0.72) !important' },
                            '&.Mui-focusVisible': { backgroundColor: 'rgba(10, 16, 24, 0.72) !important' },
                          }}
                        >
                          {deletingCharacterId === character.id ? (
                            <CircularProgress size={14} sx={{ color: 'rgba(239, 244, 250, 0.92)' }} />
                          ) : (
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>...</Box>
                          )}
                        </IconButton>
                      }
                      onClick={() => handleStartEdit(character)}
                      disabled={isAvatarActionsLocked || deletingCharacterId === character.id}
                    />
                  )
                })}
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
            isCharacterDialogBusy ||
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
            isCharacterDialogBusy ||
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
        maxWidth={false}
        fullWidth={false}
        header={characterAvatarPreview?.name || 'Аватар персонажа'}
        actions={
          <Button onClick={handleCloseCharacterAvatarPreview} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        }
        paperSx={{
          width: 'min(96vw, 1600px)',
          maxWidth: 'none',
          maxHeight: '96vh',
        }}
        contentSx={{
          px: 1,
          pt: 0.5,
          pb: 0.7,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          overflow: 'auto',
        }}
      >
        {characterAvatarPreview ? (
          <ProgressiveImage
            src={characterAvatarPreview.url}
            alt={characterAvatarPreview.name || 'Character avatar'}
            loading="eager"
            fetchPriority="high"
            objectFit="contain"
            loaderSize={32}
            containerSx={{
              width: 'fit-content',
              maxWidth: '100%',
              minHeight: 240,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              mx: 'auto',
            }}
            imgSx={{
              position: 'relative',
              width: 'auto',
              height: 'auto',
              maxWidth: 'min(92vw, 1500px)',
              maxHeight: 'min(84vh, 1800px)',
            }}
          />
        ) : null}
      </BaseDialog>

      <BaseDialog
        open={Boolean(characterEmotionPreview)}
        onClose={handleCloseCharacterEmotionPreview}
        maxWidth={false}
        fullWidth={false}
        header={
          characterEmotionPreview
            ? `${characterEmotionPreview.name} • ${CHARACTER_EMOTION_LABELS[characterEmotionPreview.emotionId]}`
            : 'Эмоция персонажа'
        }
        actions={
          <Button onClick={handleCloseCharacterEmotionPreview} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        }
        paperSx={{
          width: 'min(96vw, 1180px)',
          maxWidth: 'none',
          maxHeight: '96vh',
        }}
        contentSx={{
          px: 1,
          pt: 0.5,
          pb: 0.7,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          overflow: 'auto',
        }}
      >
        {characterEmotionPreview ? (
          <ProgressiveImage
            src={characterEmotionPreview.url}
            alt={`${characterEmotionPreview.name} ${CHARACTER_EMOTION_LABELS[characterEmotionPreview.emotionId]}`}
            loading="eager"
            fetchPriority="high"
            objectFit="contain"
            loaderSize={32}
            containerSx={{
              width: 'fit-content',
              maxWidth: '100%',
              minHeight: 240,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              mx: 'auto',
            }}
            imgSx={{
              position: 'relative',
              width: 'auto',
              height: 'auto',
              maxWidth: 'min(92vw, 1100px)',
              maxHeight: 'min(84vh, 1600px)',
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
          <Button onClick={handleCancelCharacterDeletion} disabled={deletingCharacterId !== null || isAvatarActionsLocked} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmCharacterDeletion()}
            disabled={deletingCharacterId !== null || isAvatarActionsLocked}
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
                  disabled={isAvatarActionsLocked}
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
                      backgroundColor: 'transparent',
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
                    <SoulAmount amount={option.cost} iconSize={17} color="rgba(231, 211, 158, 0.96)" fontSize="0.8rem" fontWeight={700} />
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
              disabled={isAvatarActionsLocked}
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
          <Button onClick={handleCloseAiAvatarDialog} disabled={isAvatarActionsLocked} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleGenerateAiAvatar()}
            disabled={isAvatarActionsLocked || !canGenerateAiAvatar}
            sx={{
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-text-primary)',
              textTransform: 'none',
              '&:hover': { backgroundColor: 'transparent' },
            }}
          >
            {isGeneratingAiAvatar ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : (
              <Stack component="span" direction="row" spacing={0.65} alignItems="center">
                <Box component="span">{hasAvatarDraft ? 'Перегенерировать за' : 'Сгенерировать за'}</Box>
                <SoulAmount amount={selectedAiAvatarGenerationCost} iconSize={17} />
              </Stack>
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <AvatarCropDialog
        open={Boolean(avatarCropSource)}
        imageSrc={avatarCropSource}
        isSaving={isAvatarActionsLocked}
        outputSize={384}
        onCancel={() => {
          if (!isAvatarActionsLocked) {
            setAvatarCropSource(null)
          }
        }}
        onSave={handleSaveCroppedAvatar}
      />

      <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
        <Button onClick={handleCloseDialog} disabled={isCharacterDialogBusy} sx={{ color: 'text.secondary' }}>
          Закрыть
        </Button>
      </DialogActions>
    </BaseDialog>
  )
}

export default CharacterManagerDialog
