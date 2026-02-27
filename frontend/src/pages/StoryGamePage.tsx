import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type Ref,
} from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grow,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography,
  type GrowProps,
  type SelectChangeEvent,
} from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import BaseDialog from '../components/dialogs/BaseDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import UserAvatar, { AvatarPlaceholder } from '../components/profile/UserAvatar'
import { OPEN_CHARACTER_MANAGER_FLAG_KEY, QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  createStoryCharacter,
  createStoryInstructionCard,
  createStoryGame,
  createStoryNpcFromCharacter,
  createStoryPlotCard,
  createStoryWorldCard,
  deleteStoryCharacter,
  deleteStoryInstructionCard,
  deleteStoryPlotCard,
  deleteStoryWorldCard,
  generateStoryResponseStream,
  generateStoryTurnImage,
  getStoryGame,
  listStoryCharacters,
  listStoryGames,
  selectStoryMainHero,
  updateStoryCharacter,
  updateStoryGameSettings,
  updateStoryPlotCard,
  redoStoryAssistantStep,
  undoStoryAssistantStep,
  undoStoryPlotCardEvent,
  undoStoryWorldCardEvent,
  updateStoryInstructionCard,
  updateStoryWorldCardAiEdit,
  updateStoryWorldCardAvatar,
  updateStoryWorldCard,
  updateStoryMessage,
} from '../services/storyApi'
import {
  DEFAULT_STORY_TITLE,
  getDisplayStoryTitle,
  loadStoryTitleMap,
  persistStoryTitleMap,
  setStoryTitle,
  type StoryTitleMap,
} from '../services/storyTitleStore'
import type { AuthUser } from '../types/auth'
import type {
  StoryAmbientProfile,
  StoryCharacter,
  StoryGameSummary,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryImageModelId,
  StoryMessage,
  StoryNarratorModelId,
  StoryPlotCard,
  StoryPlotCardEvent,
  StoryWorldCard,
  StoryWorldCardKind,
  StoryWorldCardEvent,
} from '../types/story'
import { compressImageFileToDataUrl } from '../utils/avatar'
import { moriusThemeTokens } from '../theme'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  initialGameId: number | null
  onNavigate: (path: string) => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
}

type StorySettingsOverride = {
  storyLlmModel: StoryNarratorModelId
  responseMaxTokens: number
  responseMaxTokensEnabled: boolean
  memoryOptimizationEnabled: boolean
  storyTopK: number
  storyTopR: number
  ambientEnabled: boolean
}



type RightPanelMode = 'ai' | 'world'
type AiPanelTab = 'instructions' | 'settings'
type WorldPanelTab = 'story' | 'world'
type PanelCardMenuType = 'instruction' | 'plot' | 'world'
type DeletionTargetType = 'instruction' | 'plot' | 'world' | 'character'
type CharacterDialogMode = 'manage' | 'select-main-hero' | 'select-npc'
type CharacterSelectionDialogMode = Exclude<CharacterDialogMode, 'manage'>
type CharacterDraftMode = 'create' | 'edit'
type DeletionPrompt = {
  type: DeletionTargetType
  targetId: number
  title: string
  message: string
}
type AssistantDialogueDelivery = 'speech' | 'thought'
type AssistantMessageBlock =
  | { type: 'narrative'; text: string }
  | { type: 'character'; speakerName: string; text: string; delivery: AssistantDialogueDelivery }
type StoryTurnImageStatus = 'loading' | 'ready' | 'error'
type StoryTurnImageEntry = {
  id: number
  status: StoryTurnImageStatus
  imageUrl: string | null
  prompt: string | null
  error: string | null
  createdAt: string | null
  updatedAt: string | null
}
type SpeakerAvatarEntry = {
  names: string[]
  avatar: string | null
  displayName: string
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const STORY_TURN_IMAGE_TOGGLE_STORAGE_KEY = 'morius.story.turn-image.enabled'
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_DEFAULT_MS = 45_000
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_NANO_BANANO_2_MS = 180_000
const STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH = 320
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const CHARACTER_AVATAR_MAX_BYTES = 500 * 1024
const INITIAL_STORY_PLACEHOLDER = 'Начните свою историю...'
const INITIAL_INPUT_PLACEHOLDER = 'Как же все началось?'
const NEXT_INPUT_PLACEHOLDER = 'Введите ваше действие...'
const OUT_OF_TOKENS_INPUT_PLACEHOLDER = 'Закончились солы'
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const WORLD_CARD_CONTENT_MAX_LENGTH = 6000
const STORY_PLOT_CARD_CONTENT_MAX_LENGTH = 16000
const STORY_CONTEXT_LIMIT_MIN = 500
const STORY_CONTEXT_LIMIT_MAX = 4000
const STORY_DEFAULT_CONTEXT_LIMIT = 1500
const STORY_RESPONSE_MAX_TOKENS_MIN = 200
const STORY_RESPONSE_MAX_TOKENS_MAX = 800
const STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
const STORY_TURN_COST_LOW_CONTEXT_LIMIT_MAX = 1500
const STORY_TURN_COST_MEDIUM_CONTEXT_LIMIT_MAX = 3000
const STORY_TOP_K_MIN = 0
const STORY_TOP_K_MAX = 200
const STORY_DEFAULT_TOP_K = 0
const STORY_TOP_R_MIN = 0.1
const STORY_TOP_R_MAX = 1
const STORY_DEFAULT_TOP_R = 1
const STORY_DEFAULT_NARRATOR_MODEL_ID: StoryNarratorModelId = 'z-ai/glm-5'
const STORY_IMAGE_MODEL_FLUX_ID: StoryImageModelId = 'black-forest-labs/flux.2-pro'
const STORY_IMAGE_MODEL_SEEDREAM_ID: StoryImageModelId = 'bytedance-seed/seedream-4.5'
const STORY_IMAGE_MODEL_NANO_BANANO_ID: StoryImageModelId = 'google/gemini-2.5-flash-image'
const STORY_IMAGE_MODEL_NANO_BANANO_2_ID: StoryImageModelId = 'google/gemini-3.1-flash-image-preview'
const STORY_DEFAULT_IMAGE_MODEL_ID: StoryImageModelId = STORY_IMAGE_MODEL_FLUX_ID
const STORY_NARRATOR_MODEL_OPTIONS: Array<{
  id: StoryNarratorModelId
  title: string
  description: string
}> = [
  {
    id: 'z-ai/glm-5',
    title: 'Огма',
    description: 'Базовая модель рассказчика.',
  },
  {
    id: 'arcee-ai/trinity-large-preview:free',
    title: 'Исида',
    description: 'Альтернативная модель рассказчика.',
  },
  {
    id: 'moonshotai/kimi-k2-0905',
    title: 'Митра',
    description: 'Модель с упором на детализацию.',
  },
]
const STORY_IMAGE_MODEL_OPTIONS: Array<{
  id: StoryImageModelId
  title: string
  description: string
}> = [
  {
    id: STORY_IMAGE_MODEL_FLUX_ID,
    title: 'Flux',
    description: '3 сола за генерацию кадра.',
  },
  {
    id: STORY_IMAGE_MODEL_SEEDREAM_ID,
    title: 'Seedream',
    description: '5 солов за генерацию кадра.',
  },
  {
    id: STORY_IMAGE_MODEL_NANO_BANANO_ID,
    title: 'Nano Banano',
    description: '15 солов за генерацию кадра.',
  },
  {
    id: STORY_IMAGE_MODEL_NANO_BANANO_2_ID,
    title: 'Nano Banano 2',
    description: '30 солов за генерацию кадра.',
  },
]
function getStoryTurnImageRequestTimeoutMs(modelId: StoryImageModelId): number {
  if (modelId === STORY_IMAGE_MODEL_NANO_BANANO_2_ID) {
    return STORY_TURN_IMAGE_REQUEST_TIMEOUT_NANO_BANANO_2_MS
  }
  return STORY_TURN_IMAGE_REQUEST_TIMEOUT_DEFAULT_MS
}
const RIGHT_PANEL_WIDTH_MIN = 300
const RIGHT_PANEL_WIDTH_MAX = 460
const RIGHT_PANEL_WIDTH_DEFAULT = 332
const RIGHT_PANEL_CARD_HEIGHT = 198
const ASSISTANT_DIALOGUE_AVATAR_SIZE = 30
const ASSISTANT_DIALOGUE_AVATAR_GAP = 0.9
const STRUCTURED_MARKER_START_PATTERN = /^\[\[\s*([A-Za-z_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]*)$/iu
const STRUCTURED_TAG_PATTERN = /^<\s*([A-Za-z_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)<\/\s*([A-Za-z_ -]+)\s*>$/iu
const GENERIC_DIALOGUE_SPEAKER_DEFAULT = 'НПС'
const SPEAKER_REFERENCE_PREFIX_PATTERN = /^(?:char|character|\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436)\s*:\s*/iu
const STORY_TOKEN_ESTIMATE_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+|[^\s]/gi
const STORY_SENTENCE_MATCH_PATTERN = /[^.!?…]+[.!?…]?/gu
const STORY_BULLET_PREFIX_PATTERN = /^\s*[-•*]+\s*/u
const STORY_MATCH_TOKEN_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+/gi
const STORY_CYRILLIC_TOKEN_PATTERN = /^[\u0430-\u044f\u0451]+$/i
const STORY_LATIN_TO_CYRILLIC_LOOKALIKE_MAP: Record<string, string> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
}
const STORY_RUSSIAN_INFLECTION_ENDINGS = [
  'иями',
  'ями',
  'ами',
  'его',
  'ого',
  'ему',
  'ому',
  'ыми',
  'ими',
  'иях',
  'ях',
  'ах',
  'ов',
  'ев',
  'ей',
  'ой',
  'ий',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ую',
  'юю',
  'ою',
  'ею',
  'ам',
  'ям',
  'ом',
  'ем',
  'ия',
  'ья',
  'ие',
  'ье',
  'ию',
  'ью',
  'а',
  'я',
  'ы',
  'и',
  'у',
  'ю',
  'е',
  'о',
  'й',
  'ь',
] as const
const INLINE_EDIT_RAIL_COLOR = 'color-mix(in srgb, var(--morius-title-text) 76%, transparent)'
const WORLD_CARD_TRIGGER_ACTIVE_TURNS = 5
const NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 10
const NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS = [5, 10, 15] as const
type NpcMemoryTurnsOption = (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number] | null
const CONTEXT_NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU')
const WORLD_CARD_EVENT_STATUS_LABEL: Record<'added' | 'updated' | 'deleted', string> = {
  added: 'Добавлено',
  updated: 'Обновлено',
  deleted: 'Удалено',
}
type WorldCardContextState = {
  isActive: boolean
  isAlwaysActive: boolean
  memoryTurns: number | null
  turnsRemaining: number
  lastTriggerTurn: number | null
  isTriggeredThisTurn: boolean
}
const STORY_AMBIENT_HEX_COLOR_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const STORY_AMBIENT_DEFAULT_PROFILE: StoryAmbientProfile = {
  scene: 'unknown',
  lighting: 'dim',
  primary_color: '#101826',
  secondary_color: '#1a2436',
  highlight_color: '#324865',
  glow_strength: 0.2,
  background_mix: 0.18,
  vignette_strength: 0.34,
}

function clampAmbientValue(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numericValue)) {
    return fallback
  }
  return Math.max(minimum, Math.min(numericValue, maximum))
}

function normalizeAmbientHexColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = (value ?? '').trim().toLowerCase()
  if (!STORY_AMBIENT_HEX_COLOR_PATTERN.test(normalizedValue)) {
    return fallback
  }
  const colorValue = normalizedValue.startsWith('#') ? normalizedValue.slice(1) : normalizedValue
  if (colorValue.length === 3) {
    return `#${colorValue
      .split('')
      .map((item) => `${item}${item}`)
      .join('')}`
  }
  return `#${colorValue}`
}

function hexToRgba(hexColor: string, alpha: number): string {
  const normalizedColor = normalizeAmbientHexColor(hexColor, STORY_AMBIENT_DEFAULT_PROFILE.primary_color)
  const colorValue = normalizedColor.slice(1)
  const red = Number.parseInt(colorValue.slice(0, 2), 16)
  const green = Number.parseInt(colorValue.slice(2, 4), 16)
  const blue = Number.parseInt(colorValue.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clampAmbientValue(alpha, 0, 1, 0)})`
}

function normalizeStoryAmbientProfile(
  value: Partial<StoryAmbientProfile> | null | undefined,
): StoryAmbientProfile {
  if (!value) {
    return STORY_AMBIENT_DEFAULT_PROFILE
  }
  const defaultProfile = STORY_AMBIENT_DEFAULT_PROFILE
  const normalizeLabel = (rawValue: string | null | undefined, fallback: string) => {
    const normalizedValue = (rawValue ?? '').replace(/\r\n/g, ' ').trim().replace(/\s+/g, ' ')
    if (!normalizedValue) {
      return fallback
    }
    return normalizedValue.slice(0, 80)
  }
  return {
    scene: normalizeLabel(value.scene, defaultProfile.scene),
    lighting: normalizeLabel(value.lighting, defaultProfile.lighting),
    primary_color: normalizeAmbientHexColor(value.primary_color, defaultProfile.primary_color),
    secondary_color: normalizeAmbientHexColor(value.secondary_color, defaultProfile.secondary_color),
    highlight_color: normalizeAmbientHexColor(value.highlight_color, defaultProfile.highlight_color),
    glow_strength: clampAmbientValue(value.glow_strength, 0, 1, defaultProfile.glow_strength),
    background_mix: clampAmbientValue(value.background_mix, 0, 1, defaultProfile.background_mix),
    vignette_strength: clampAmbientValue(value.vignette_strength, 0, 1, defaultProfile.vignette_strength),
  }
}

function splitAssistantParagraphs(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : ['']
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

function normalizeAssistantMarkerKey(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '_').trim()
}

type AssistantMarkerKind = 'narrative' | 'speech' | 'thought'

function resolveAssistantMarkerKind(
  markerKey: string,
): AssistantMarkerKind | null {
  const compact = markerKey.replace(/_/g, '')
  if (compact === 'narrator' || compact === 'narration' || compact === 'narrative') {
    return 'narrative'
  }
  if (
    compact === 'npc' ||
    compact === 'gg' ||
    compact === 'mc' ||
    compact === 'mainhero' ||
    compact === 'say' ||
    compact === 'speech'
  ) {
    return 'speech'
  }
  if (compact === 'npcthought' || compact === 'ggthought' || compact === 'thought' || compact === 'think') {
    return 'thought'
  }
  return null
}

type AssistantTagDescriptor = {
  kind: AssistantMarkerKind
  defaultSpeakerName: string | null
}

function resolveAssistantTagKind(markerKey: string): AssistantTagDescriptor | null {
  const compact = markerKey.replace(/_/g, '')
  if (compact === 'narrator' || compact === 'narration' || compact === 'narrative') {
    return {
      kind: 'narrative',
      defaultSpeakerName: null,
    }
  }
  if (
    compact === 'gg' ||
    compact === 'ggreplick' ||
    compact === 'ggreplica' ||
    compact === 'ggspeech' ||
    compact === 'ggdialogue'
  ) {
    return {
      kind: 'speech',
      defaultSpeakerName: 'ГГ',
    }
  }
  if (compact === 'ggthought' || compact === 'ggthink') {
    return {
      kind: 'thought',
      defaultSpeakerName: 'ГГ',
    }
  }
  if (
    compact === 'npc' ||
    compact === 'npcreplick' ||
    compact === 'npcreplica' ||
    compact === 'npcspeech' ||
    compact === 'npcdialogue'
  ) {
    return {
      kind: 'speech',
      defaultSpeakerName: GENERIC_DIALOGUE_SPEAKER_DEFAULT,
    }
  }
  if (compact === 'npcthought' || compact === 'npcthink') {
    return {
      kind: 'thought',
      defaultSpeakerName: GENERIC_DIALOGUE_SPEAKER_DEFAULT,
    }
  }
  return null
}

function parseStructuredAssistantParagraph(paragraph: string): AssistantMessageBlock | null {
  const normalized = paragraph.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const markerMatch = normalized.match(STRUCTURED_MARKER_START_PATTERN)
  if (!markerMatch) {
    return null
  }

  const markerKey = normalizeAssistantMarkerKey(markerMatch[1])
  const markerKind = resolveAssistantMarkerKind(markerKey)
  if (!markerKind) {
    return null
  }

  const bodyText = markerMatch[3].trim()
  if (!bodyText) {
    return null
  }

  if (markerKind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  const rawSpeakerName = markerMatch[2]?.trim() ?? ''
  const speakerName = rawSpeakerName.replace(/^["«„]+|["»”]+$/g, '').trim()
  if (!speakerName) {
    return null
  }

  return {
    type: 'character',
    speakerName,
    text: bodyText,
    delivery: markerKind === 'thought' ? 'thought' : 'speech',
  }
}

function parseTaggedAssistantParagraph(paragraph: string): AssistantMessageBlock | null {
  const normalized = paragraph.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const tagMatch = normalized.match(STRUCTURED_TAG_PATTERN)
  if (!tagMatch) {
    return null
  }

  const openingTagKey = normalizeAssistantMarkerKey(tagMatch[1])
  const closingTagKey = normalizeAssistantMarkerKey(tagMatch[4])
  if (!openingTagKey || openingTagKey !== closingTagKey) {
    return null
  }

  const tagDescriptor = resolveAssistantTagKind(openingTagKey)
  if (!tagDescriptor) {
    return null
  }

  const bodyText = tagMatch[3].trim()
  if (!bodyText) {
    return null
  }

  if (tagDescriptor.kind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  const rawSpeakerName = tagMatch[2]?.trim() ?? ''
  const explicitSpeakerName = rawSpeakerName.replace(/^["'«„]+|["'»”]+$/g, '').trim()
  const speakerName = explicitSpeakerName || tagDescriptor.defaultSpeakerName || GENERIC_DIALOGUE_SPEAKER_DEFAULT
  if (!speakerName) {
    return null
  }

  return {
    type: 'character',
    speakerName,
    text: bodyText,
    delivery: tagDescriptor.kind === 'thought' ? 'thought' : 'speech',
  }
}

function parseTaggedAssistantContent(content: string): AssistantMessageBlock[] | null {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const tagPattern = /<\s*([A-Za-z_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)<\/\s*([A-Za-z_ -]+)\s*>/giu
  const blocks: AssistantMessageBlock[] = []
  let hasTaggedBlocks = false
  let cursor = 0

  const pushNarrativeFragments = (value: string) => {
    const fragments = splitAssistantParagraphs(value)
    fragments.forEach((fragment) => {
      const text = fragment.trim()
      if (!text) {
        return
      }
      blocks.push({ type: 'narrative', text })
    })
  }

  for (const match of normalized.matchAll(tagPattern)) {
    const fullMatch = match[0]
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) {
      return null
    }

    const between = normalized.slice(cursor, matchIndex)
    if (between.trim().length > 0) {
      pushNarrativeFragments(between)
    }

    const parsedBlock = parseTaggedAssistantParagraph(fullMatch)
    if (!parsedBlock) {
      return null
    }
    blocks.push(parsedBlock)
    hasTaggedBlocks = true
    cursor = matchIndex + fullMatch.length
  }

  const tail = normalized.slice(cursor)
  if (tail.trim().length > 0) {
    pushNarrativeFragments(tail)
  }

  if (!hasTaggedBlocks || blocks.length === 0) {
    return null
  }

  return blocks
}

function parseAssistantMessageBlocks(content: string): AssistantMessageBlock[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const taggedContentBlocks = parseTaggedAssistantContent(normalized)
  if (taggedContentBlocks) {
    return taggedContentBlocks
  }

  const blocks: AssistantMessageBlock[] = []
  splitAssistantParagraphs(normalized).forEach((paragraph) => {
    const taggedBlock = parseTaggedAssistantParagraph(paragraph)
    if (taggedBlock) {
      blocks.push(taggedBlock)
      return
    }

    const structuredBlock = parseStructuredAssistantParagraph(paragraph)
    if (structuredBlock) {
      blocks.push(structuredBlock)
      return
    }

    // Strict mode: any unmarked paragraph is treated as narration only.
    blocks.push({ type: 'narrative', text: paragraph })
  })

  return blocks
}

function serializeAssistantMessageBlock(block: AssistantMessageBlock): string {
  const normalizedText = block.text.replace(/\r\n/g, '\n').trim()
  if (!normalizedText) {
    return ''
  }

  if (block.type === 'narrative') {
    return normalizedText
  }

  const tagName = block.delivery === 'thought' ? 'npc-thought' : 'npc-replick'
  const speakerName = block.speakerName.trim() || GENERIC_DIALOGUE_SPEAKER_DEFAULT
  return `<${tagName}:${speakerName}>${normalizedText}</${tagName}>`
}

function serializeAssistantMessageBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .map((block) => serializeAssistantMessageBlock(block))
    .filter((value) => value.length > 0)
    .join('\n\n')
    .trim()
}

function buildAssistantMessageContentWithEditedBlock(
  content: string,
  blockIndex: number,
  nextText: string,
): string | null {
  const blocks = parseAssistantMessageBlocks(content)
  if (blocks.length === 0 || blockIndex < 0 || blockIndex >= blocks.length) {
    return null
  }

  const normalizedText = nextText.replace(/\r\n/g, '\n').trim()
  if (!normalizedText) {
    return null
  }

  const nextBlocks = blocks.map((block, index) => (index === blockIndex ? { ...block, text: normalizedText } : block))
  const serialized = serializeAssistantMessageBlocks(nextBlocks)
  return serialized || null
}

function normalizeCharacterIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildCharacterAliases(value: string): string[] {
  const normalized = normalizeCharacterIdentity(value)
  if (!normalized) {
    return []
  }

  const aliases = new Set<string>([normalized])
  normalized.split(' ').forEach((token) => {
    if (token.length >= 2) {
      aliases.add(token)
    }
  })
  return [...aliases]
}

function buildIdentityTriggerAliases(title: string, triggers: string[]): string[] {
  const titleTokens = normalizeStoryMatchTokens(title)
  const primaryTitleToken = titleTokens[0] ?? ''
  if (!primaryTitleToken) {
    return []
  }

  const aliases = new Set<string>()
  triggers
    .flatMap((trigger) => splitStoryTriggerCandidates(trigger))
    .forEach((trigger) => {
      const normalizedTrigger = normalizeCharacterIdentity(trigger)
      if (!normalizedTrigger) {
        return
      }

      const triggerTokens = normalizeStoryMatchTokens(normalizedTrigger)
      const primaryTriggerToken = triggerTokens[0] ?? ''
      if (!primaryTriggerToken) {
        return
      }

      const isRelatedIdentity =
        primaryTriggerToken === primaryTitleToken ||
        (primaryTriggerToken.length >= 4 && primaryTitleToken.startsWith(primaryTriggerToken)) ||
        (primaryTitleToken.length >= 4 && primaryTriggerToken.startsWith(primaryTitleToken))
      if (!isRelatedIdentity) {
        return
      }

      aliases.add(normalizedTrigger)
      if (triggerTokens.length <= 2) {
        aliases.add(primaryTriggerToken)
      }
    })

  return [...aliases]
}

function extractSpeakerLookupValues(rawSpeakerName: string): string[] {
  const normalizedSpeakerName = rawSpeakerName.replace(/\r\n/g, ' ').trim()
  if (!normalizedSpeakerName) {
    return []
  }

  const values = new Set<string>([normalizedSpeakerName])

  if (normalizedSpeakerName.startsWith('@')) {
    const withoutAt = normalizedSpeakerName.slice(1).trim()
    if (withoutAt) {
      values.add(withoutAt)
      const withoutAtAndPrefix = withoutAt.replace(SPEAKER_REFERENCE_PREFIX_PATTERN, '').trim()
      if (withoutAtAndPrefix) {
        values.add(withoutAtAndPrefix)
      }
    }
  }

  const withoutPrefix = normalizedSpeakerName.replace(SPEAKER_REFERENCE_PREFIX_PATTERN, '').trim()
  if (withoutPrefix && withoutPrefix !== normalizedSpeakerName) {
    values.add(withoutPrefix)
  }

  return [...values]
}

function upsertStoryPlotCard(cards: StoryPlotCard[], card: StoryPlotCard): StoryPlotCard[] {
  const existingIndex = cards.findIndex((item) => item.id === card.id)
  if (existingIndex < 0) {
    return [...cards, card]
  }
  const nextCards = [...cards]
  nextCards[existingIndex] = card
  return nextCards
}

function upsertStoryWorldCard(cards: StoryWorldCard[], card: StoryWorldCard): StoryWorldCard[] {
  const existingIndex = cards.findIndex((item) => item.id === card.id)
  if (existingIndex < 0) {
    return [...cards, card]
  }
  const nextCards = [...cards]
  nextCards[existingIndex] = card
  return nextCards
}

function mapPlotSnapshotToCard(
  snapshot: StoryPlotCardEvent['before_snapshot'] | StoryPlotCardEvent['after_snapshot'],
  gameId: number,
  fallbackId: number | null,
  nowIso: string,
): StoryPlotCard | null {
  if (!snapshot) {
    return null
  }
  const cardId = snapshot.id ?? fallbackId
  if (!cardId) {
    return null
  }
  return {
    id: cardId,
    game_id: gameId,
    title: snapshot.title,
    content: snapshot.content,
    source: snapshot.source,
    created_at: nowIso,
    updated_at: nowIso,
  }
}

function mapWorldSnapshotToCard(
  snapshot: StoryWorldCardEvent['before_snapshot'] | StoryWorldCardEvent['after_snapshot'],
  gameId: number,
  fallbackId: number | null,
  nowIso: string,
): StoryWorldCard | null {
  if (!snapshot) {
    return null
  }
  const cardId = snapshot.id ?? fallbackId
  if (!cardId) {
    return null
  }
  return {
    id: cardId,
    game_id: gameId,
    title: snapshot.title,
    content: snapshot.content,
    triggers: snapshot.triggers,
    kind: snapshot.kind,
    avatar_url: snapshot.avatar_url,
    avatar_scale: snapshot.avatar_scale,
    character_id: snapshot.character_id,
    memory_turns: snapshot.memory_turns,
    is_locked: snapshot.is_locked,
    ai_edit_enabled: snapshot.ai_edit_enabled,
    source: snapshot.source,
    created_at: nowIso,
    updated_at: nowIso,
  }
}

function rollbackPlotCardsByEvents(
  cards: StoryPlotCard[],
  events: StoryPlotCardEvent[],
  gameId: number,
): StoryPlotCard[] {
  let nextCards = [...cards]
  const nowIso = new Date().toISOString()
  const rollbackEvents = [...events].sort((left, right) => right.id - left.id)
  rollbackEvents.forEach((event) => {
    if (event.action === 'added') {
      const removedCardId = event.plot_card_id ?? event.after_snapshot?.id ?? null
      if (removedCardId) {
        nextCards = nextCards.filter((card) => card.id !== removedCardId)
      }
      return
    }

    const restoredCard = mapPlotSnapshotToCard(event.before_snapshot, gameId, event.plot_card_id, nowIso)
    if (restoredCard) {
      nextCards = upsertStoryPlotCard(nextCards, restoredCard)
    }
  })
  return nextCards
}

function reapplyPlotCardsByEvents(
  cards: StoryPlotCard[],
  events: StoryPlotCardEvent[],
  gameId: number,
): StoryPlotCard[] {
  let nextCards = [...cards]
  const nowIso = new Date().toISOString()
  const forwardEvents = [...events].sort((left, right) => left.id - right.id)
  forwardEvents.forEach((event) => {
    if (event.action === 'deleted') {
      const removedCardId = event.plot_card_id ?? event.before_snapshot?.id ?? null
      if (removedCardId) {
        nextCards = nextCards.filter((card) => card.id !== removedCardId)
      }
      return
    }

    const appliedCard = mapPlotSnapshotToCard(event.after_snapshot, gameId, event.plot_card_id, nowIso)
    if (appliedCard) {
      nextCards = upsertStoryPlotCard(nextCards, appliedCard)
    }
  })
  return nextCards
}

function rollbackWorldCardsByEvents(
  cards: StoryWorldCard[],
  events: StoryWorldCardEvent[],
  gameId: number,
): StoryWorldCard[] {
  let nextCards = [...cards]
  const nowIso = new Date().toISOString()
  const rollbackEvents = [...events].sort((left, right) => right.id - left.id)
  rollbackEvents.forEach((event) => {
    if (event.action === 'added') {
      const removedCardId = event.world_card_id ?? event.after_snapshot?.id ?? null
      if (removedCardId) {
        nextCards = nextCards.filter((card) => card.id !== removedCardId)
      }
      return
    }

    const restoredCard = mapWorldSnapshotToCard(event.before_snapshot, gameId, event.world_card_id, nowIso)
    if (restoredCard) {
      nextCards = upsertStoryWorldCard(nextCards, restoredCard)
    }
  })
  return nextCards
}

function reapplyWorldCardsByEvents(
  cards: StoryWorldCard[],
  events: StoryWorldCardEvent[],
  gameId: number,
): StoryWorldCard[] {
  let nextCards = [...cards]
  const nowIso = new Date().toISOString()
  const forwardEvents = [...events].sort((left, right) => left.id - right.id)
  forwardEvents.forEach((event) => {
    if (event.action === 'deleted') {
      const removedCardId = event.world_card_id ?? event.before_snapshot?.id ?? null
      if (removedCardId) {
        nextCards = nextCards.filter((card) => card.id !== removedCardId)
      }
      return
    }

    const appliedCard = mapWorldSnapshotToCard(event.after_snapshot, gameId, event.world_card_id, nowIso)
    if (appliedCard) {
      nextCards = upsertStoryWorldCard(nextCards, appliedCard)
    }
  })
  return nextCards
}

function mergePlotEvents(
  existingEvents: StoryPlotCardEvent[],
  incomingEvents: StoryPlotCardEvent[],
): StoryPlotCardEvent[] {
  const nextMap = new Map<number, StoryPlotCardEvent>()
  existingEvents.forEach((event) => nextMap.set(event.id, event))
  incomingEvents.forEach((event) => nextMap.set(event.id, event))
  return [...nextMap.values()].sort((left, right) => left.id - right.id)
}

function mergeWorldEvents(
  existingEvents: StoryWorldCardEvent[],
  incomingEvents: StoryWorldCardEvent[],
): StoryWorldCardEvent[] {
  const nextMap = new Map<number, StoryWorldCardEvent>()
  existingEvents.forEach((event) => nextMap.set(event.id, event))
  incomingEvents.forEach((event) => nextMap.set(event.id, event))
  return [...nextMap.values()].sort((left, right) => left.id - right.id)
}

function sortGamesByActivity(games: StoryGameSummary[]): StoryGameSummary[] {
  return [...games].sort(
    (left, right) =>
      new Date(right.last_activity_at).getTime() - new Date(left.last_activity_at).getTime() || right.id - left.id,
  )
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

function normalizeWorldCardTriggersDraft(draft: string, fallbackTitle: string): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  const pushTrigger = (value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) {
      return
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    normalized.push(trimmed)
  }

  splitStoryTriggerCandidates(draft).forEach((part) => pushTrigger(part))
  pushTrigger(fallbackTitle)

  return normalized.slice(0, 40)
}

function normalizeCharacterTriggersDraft(draft: string, fallbackName: string): string[] {
  return normalizeWorldCardTriggersDraft(draft, fallbackName).slice(0, 40)
}

function createInstructionTemplateSignature(title: string, content: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase()
  return `${normalizedTitle}::${normalizedContent}`
}

function clampStoryContextLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_CONTEXT_LIMIT
  }
  return Math.min(STORY_CONTEXT_LIMIT_MAX, Math.max(STORY_CONTEXT_LIMIT_MIN, Math.round(value)))
}

function clampStoryResponseMaxTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_RESPONSE_MAX_TOKENS
  }
  return Math.min(STORY_RESPONSE_MAX_TOKENS_MAX, Math.max(STORY_RESPONSE_MAX_TOKENS_MIN, Math.round(value)))
}

function sanitizeStoryImageStylePromptDraft(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trimStart().slice(0, STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH)
}

function normalizeStoryImageStylePrompt(value: string | null | undefined): string {
  return sanitizeStoryImageStylePromptDraft(value ?? '').trim()
}

function getStoryTurnCostTokens(contextUsageTokens: number): number {
  const normalizedUsage = Math.max(0, Math.round(contextUsageTokens))
  if (normalizedUsage <= STORY_TURN_COST_LOW_CONTEXT_LIMIT_MAX) {
    return 1
  }
  if (normalizedUsage <= STORY_TURN_COST_MEDIUM_CONTEXT_LIMIT_MAX) {
    return 2
  }
  return 3
}

function clampStoryTopK(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_TOP_K
  }
  return Math.min(STORY_TOP_K_MAX, Math.max(STORY_TOP_K_MIN, Math.round(value)))
}

function clampStoryTopR(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_TOP_R
  }
  const clampedValue = Math.min(STORY_TOP_R_MAX, Math.max(STORY_TOP_R_MIN, value))
  return Math.round(clampedValue * 100) / 100
}

function normalizeStoryNarratorModelId(value: string | null | undefined): StoryNarratorModelId {
  const normalized = (value ?? '').trim() as StoryNarratorModelId
  if (STORY_NARRATOR_MODEL_OPTIONS.some((option) => option.id === normalized)) {
    return normalized
  }
  return STORY_DEFAULT_NARRATOR_MODEL_ID
}

function normalizeStoryImageModelId(value: string | null | undefined): StoryImageModelId {
  const normalized = (value ?? '').trim() as StoryImageModelId
  if (STORY_IMAGE_MODEL_OPTIONS.some((option) => option.id === normalized)) {
    return normalized
  }
  return STORY_DEFAULT_IMAGE_MODEL_ID
}

function clampRightPanelWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return RIGHT_PANEL_WIDTH_DEFAULT
  }
  return Math.min(RIGHT_PANEL_WIDTH_MAX, Math.max(RIGHT_PANEL_WIDTH_MIN, Math.round(value)))
}

function formatContextChars(value: number): string {
  return CONTEXT_NUMBER_FORMATTER.format(Math.max(0, Math.round(value)))
}

function estimateTextTokens(value: string): number {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return 0
  }
  const matches = normalized.toLowerCase().replace(/\u0451/g, '\u0435').match(STORY_TOKEN_ESTIMATE_PATTERN)
  if (matches && matches.length > 0) {
    return matches.length
  }
  return Math.max(1, Math.ceil(normalized.length / 4))
}

function trimStoryTextTailByTokens(value: string, tokenLimit: number): string {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized || tokenLimit <= 0) {
    return ''
  }
  const tokenPattern = /[0-9a-z\u0430-\u044f\u0451]+|[^\s]/gi
  const matches = [...normalized.toLowerCase().replace(/\u0451/g, '\u0435').matchAll(tokenPattern)]
  if (matches.length === 0) {
    const charLimit = Math.max(tokenLimit * 4, 1)
    return normalized.slice(-charLimit)
  }
  if (matches.length <= tokenLimit) {
    return normalized
  }
  const startIndex = matches[matches.length - tokenLimit]?.index ?? 0
  return normalized.slice(startIndex).trimStart()
}

function splitStoryTextIntoSentences(value: string): string[] {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const sentences: string[] = []
  normalized.split('\n').forEach((rawLine) => {
    const line = rawLine.replace(STORY_BULLET_PREFIX_PATTERN, '').trim()
    if (!line) {
      return
    }
    const compactLine = line.replace(/\s+/g, ' ').trim()
    if (!compactLine) {
      return
    }
    const matches = compactLine.match(STORY_SENTENCE_MATCH_PATTERN)
    if (!matches || matches.length === 0) {
      sentences.push(compactLine)
      return
    }
    matches.forEach((sentence) => {
      const compactSentence = sentence.trim()
      if (compactSentence) {
        sentences.push(compactSentence)
      }
    })
  })
  return sentences
}

function formatStorySentences(sentences: string[], useBullets: boolean): string {
  if (sentences.length === 0) {
    return ''
  }
  if (useBullets) {
    return sentences.map((sentence) => `- ${sentence}`).join('\n')
  }
  return sentences.join(' ')
}

function trimStoryTextTailBySentenceTokens(value: string, tokenLimit: number): string {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized || tokenLimit <= 0) {
    return ''
  }
  const sentences = splitStoryTextIntoSentences(normalized)
  if (sentences.length === 0) {
    return trimStoryTextTailByTokens(normalized, tokenLimit)
  }

  const useBullets = normalized.split('\n').some((line) => STORY_BULLET_PREFIX_PATTERN.test(line))
  const selectedReversed: string[] = []
  let consumedTokens = 0

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]
    const sentenceCost = estimateTextTokens(sentence) + 1
    if (consumedTokens + sentenceCost <= tokenLimit) {
      selectedReversed.push(sentence)
      consumedTokens += sentenceCost
      continue
    }
    if (selectedReversed.length === 0) {
      const tailSentence = trimStoryTextTailByTokens(sentence, Math.max(tokenLimit, 1))
      if (tailSentence) {
        selectedReversed.push(tailSentence)
      }
    }
    break
  }

  return formatStorySentences(selectedReversed.reverse(), useBullets)
}

function estimatePlotCardsTokensWithinBudget(
  plotCards: Array<{ title: string; content: string }>,
  tokenBudget: number,
): number {
  if (plotCards.length === 0 || tokenBudget <= 0) {
    return 0
  }

  const selectedReversed: Array<{ title: string; content: string }> = []
  let consumedTokens = 0

  for (let index = plotCards.length - 1; index >= 0; index -= 1) {
    const plotCard = plotCards[index]
    const title = plotCard.title.replace(/\s+/g, ' ').trim()
    const content = plotCard.content.replace(/\r\n/g, '\n').trim()
    if (!title || !content) {
      continue
    }

    const cardCost = estimateTextTokens(title) + estimateTextTokens(content) + 6
    if (consumedTokens + cardCost <= tokenBudget) {
      selectedReversed.push({ title, content })
      consumedTokens += cardCost
      continue
    }

    if (selectedReversed.length === 0) {
      const titleCost = estimateTextTokens(title) + 6
      const contentBudget = Math.max(tokenBudget - titleCost, 1)
      const trimmedContent = trimStoryTextTailBySentenceTokens(content, contentBudget)
      if (trimmedContent) {
        selectedReversed.push({ title, content: trimmedContent })
      }
    }
    break
  }

  const selected = selectedReversed.reverse()
  if (selected.length === 0) {
    return 0
  }

  const payload = selected.map((plotCard, index) => `${index + 1}. ${plotCard.title}: ${plotCard.content}`).join('\n')
  return estimateTextTokens(payload)
}

function estimateHistoryTokensWithinBudget(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  tokenBudget: number,
): number {
  if (history.length === 0 || tokenBudget <= 0) {
    return 0
  }

  const selectedReversed: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let consumedTokens = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    const content = message.content.replace(/\r\n/g, '\n').trim()
    if (!content) {
      continue
    }

    const messageCost = estimateTextTokens(content) + 4
    if (consumedTokens + messageCost <= tokenBudget) {
      selectedReversed.push({ role: message.role, content })
      consumedTokens += messageCost
      continue
    }

    if (selectedReversed.length === 0) {
      const trimmedContent = trimStoryTextTailByTokens(content, Math.max(tokenBudget - 4, 1))
      if (trimmedContent) {
        selectedReversed.push({ role: message.role, content: trimmedContent })
      }
    }
    break
  }

  const selected = selectedReversed.reverse()
  if (selected.length === 0) {
    return 0
  }

  const payload = selected
    .map((message) => `${message.role === 'user' ? 'Игрок' : 'ИИ'}: ${message.content}`)
    .join('\n')
  return estimateTextTokens(payload)
}

function normalizeStoryMatchTokens(value: string): string[] {
  const normalized = value.toLowerCase().replace(/\u0451/g, '\u0435')
  const rawTokens = normalized.match(STORY_MATCH_TOKEN_PATTERN) ?? []
  return rawTokens.map((token) => normalizeStoryTokenScript(token)).filter((token) => token.length > 0)
}

function normalizeStoryTokenScript(token: string): string {
  const normalized = token.trim().toLowerCase().replace(/\u0451/g, '\u0435')
  if (!normalized) {
    return ''
  }
  const hasCyrillic = /[\u0430-\u044f]/i.test(normalized)
  const hasLatin = /[a-z]/i.test(normalized)
  if (!hasCyrillic || !hasLatin) {
    return normalized
  }
  return normalized
    .split('')
    .map((char) => STORY_LATIN_TO_CYRILLIC_LOOKALIKE_MAP[char] ?? char)
    .join('')
}

function splitStoryTriggerCandidates(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .split(/[,\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function deriveStoryRussianStems(token: string): string[] {
  if (token.length < 4 || !STORY_CYRILLIC_TOKEN_PATTERN.test(token)) {
    return [token]
  }

  const stems = new Set<string>([token])
  let candidate = token
  for (let pass = 0; pass < 2; pass += 1) {
    let stripped = false
    for (const ending of STORY_RUSSIAN_INFLECTION_ENDINGS) {
      if (!candidate.endsWith(ending)) {
        continue
      }
      if (candidate.length - ending.length < 3) {
        continue
      }
      candidate = candidate.slice(0, candidate.length - ending.length)
      if (candidate.length > 0) {
        stems.add(candidate)
        const compact = candidate.replace(/[\u044c\u0439]+$/i, '')
        if (compact.length >= 3) {
          stems.add(compact)
        }
      }
      stripped = true
      break
    }
    if (!stripped) {
      break
    }
  }
  return [...stems]
}

function buildStoryTokenMatchForms(token: string): string[] {
  const normalized = normalizeStoryTokenScript(token)
  if (!normalized) {
    return []
  }
  const forms = new Set<string>([normalized])
  deriveStoryRussianStems(normalized).forEach((stem) => forms.add(stem))
  return [...forms]
}

function isStoryTokenMatch(triggerToken: string, promptToken: string): boolean {
  const triggerForms = buildStoryTokenMatchForms(triggerToken)
  const promptForms = buildStoryTokenMatchForms(promptToken)
  if (triggerForms.length === 0 || promptForms.length === 0) {
    return false
  }

  if (triggerForms.some((triggerForm) => promptForms.includes(triggerForm))) {
    return true
  }

  return triggerForms.some((triggerForm) => {
    if (triggerForm.length < 4) {
      return false
    }
    return promptForms.some((promptForm) => {
      if (promptForm.length < 4) {
        return false
      }
      if (promptForm.startsWith(triggerForm) || triggerForm.startsWith(promptForm)) {
        return true
      }
      const shorter = triggerForm.length <= promptForm.length ? triggerForm : promptForm
      const longer = triggerForm.length <= promptForm.length ? promptForm : triggerForm
      return shorter.length >= 5 && longer.startsWith(shorter)
    })
  })
}

function isStoryTriggerMatch(trigger: string, promptTokens: string[]): boolean {
  const triggerCandidates = splitStoryTriggerCandidates(trigger)
  if (triggerCandidates.length > 1) {
    return triggerCandidates.some((candidate) => isStoryTriggerMatch(candidate, promptTokens))
  }

  const triggerTokens = normalizeStoryMatchTokens(trigger).filter((token) => token.length >= 2)
  if (triggerTokens.length === 0) {
    return false
  }

  if (triggerTokens.length === 1) {
    const [triggerToken] = triggerTokens
    return promptTokens.some((token) => isStoryTokenMatch(triggerToken, token))
  }

  return triggerTokens.every((triggerToken) => promptTokens.some((token) => isStoryTokenMatch(triggerToken, token)))
}

function formatTurnsWord(value: number): string {
  const absValue = Math.abs(Math.trunc(value))
  const mod10 = absValue % 10
  const mod100 = absValue % 100
  if (mod10 === 1 && mod100 !== 11) {
    return 'ход'
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'хода'
  }
  return 'ходов'
}

function resolveWorldCardMemoryTurns(card: Pick<StoryWorldCard, 'kind' | 'memory_turns'>): number | null {
  if (card.kind === 'main_hero') {
    return null
  }
  if (card.memory_turns === null) {
    return null
  }
  if (typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns) && card.memory_turns > 0) {
    return Math.round(card.memory_turns)
  }
  if (card.kind === 'npc') {
    return NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS
  }
  return WORLD_CARD_TRIGGER_ACTIVE_TURNS
}

function formatWorldCardMemoryLabel(memoryTurns: number | null): string {
  if (memoryTurns === null) {
    return 'Помнить всегда'
  }
  return `${memoryTurns} ${formatTurnsWord(memoryTurns)}`
}

function toNpcMemoryTurnsOption(memoryTurns: number | null): NpcMemoryTurnsOption {
  if (memoryTurns === null) {
    return null
  }
  if (NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS.includes(memoryTurns as (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number])) {
    return memoryTurns as (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number]
  }
  return NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS
}

function formatWorldCardContextStatus(state: WorldCardContextState | undefined): string {
  if (!state || !state.isActive) {
    return 'неактивна'
  }
  if (state.isAlwaysActive) {
    return 'активна'
  }
  const memoryTurns = state.memoryTurns ?? WORLD_CARD_TRIGGER_ACTIVE_TURNS
  if (state.isTriggeredThisTurn) {
    return `активна · +${memoryTurns} ${formatTurnsWord(memoryTurns)}`
  }
  return `активна · ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
}

function buildWorldCardContextStateById(worldCards: StoryWorldCard[], messages: StoryMessage[]): Map<number, WorldCardContextState> {
  const turnTokenEntries: Array<{ turnIndex: number; tokens: string[] }> = []
  let currentTurnIndex = 0
  messages.forEach((message) => {
    if (message.role === 'user') {
      currentTurnIndex += 1
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      return
    }
    if (currentTurnIndex <= 0) {
      return
    }
    const tokens = normalizeStoryMatchTokens(message.content.replace(/\r\n/g, '\n').trim())
    if (tokens.length === 0) {
      return
    }
    turnTokenEntries.push({ turnIndex: currentTurnIndex, tokens })
  })

  const stateById = new Map<number, WorldCardContextState>()
  worldCards.forEach((card) => {
    const memoryTurns = resolveWorldCardMemoryTurns(card)
    if (card.kind === 'main_hero') {
      stateById.set(card.id, {
        isActive: true,
        isAlwaysActive: true,
        memoryTurns: null,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }

    const fallbackTrigger = card.title.replace(/\s+/g, ' ').trim()
    const triggers = card.triggers
      .flatMap((trigger) => splitStoryTriggerCandidates(trigger))
      .map((trigger) => trigger.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (fallbackTrigger.length > 0 && !triggers.some((trigger) => trigger.toLowerCase() === fallbackTrigger.toLowerCase())) {
      triggers.unshift(fallbackTrigger)
    }

    if (memoryTurns === null) {
      stateById.set(card.id, {
        isActive: true,
        isAlwaysActive: true,
        memoryTurns: null,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }

    let lastTriggerTurn = 0
    if (triggers.length > 0) {
      turnTokenEntries.forEach(({ turnIndex, tokens }) => {
        const matched = triggers.some((trigger) => isStoryTriggerMatch(trigger, tokens))
        if (matched) {
          lastTriggerTurn = turnIndex
        }
      })
    }

    let isActive = false
    let turnsRemaining = 0
    let isTriggeredThisTurn = false
    if (lastTriggerTurn > 0 && currentTurnIndex > 0) {
      const turnsSinceTrigger = currentTurnIndex - lastTriggerTurn
      if (turnsSinceTrigger <= memoryTurns) {
        isActive = true
        turnsRemaining = Math.max(memoryTurns - turnsSinceTrigger, 0)
        isTriggeredThisTurn = turnsSinceTrigger === 0
      }
    }

    stateById.set(card.id, {
      isActive,
      isAlwaysActive: false,
      memoryTurns,
      turnsRemaining,
      lastTriggerTurn: lastTriggerTurn > 0 ? lastTriggerTurn : null,
      isTriggeredThisTurn,
    })
  })

  return stateById
}
const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

type CharacterAvatarProps = {
  avatarUrl: string | null
  avatarScale?: number
  fallbackLabel: string
  size?: number
}

function CharacterAvatar({ avatarUrl, avatarScale = 1, fallbackLabel, size = 44 }: CharacterAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)

  if (avatarUrl && avatarUrl !== failedImageUrl) {
    return (
      <Box
        sx={{
          display: 'block',
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: '50%',
          overflow: 'hidden',
          aspectRatio: '1 / 1',
          flexShrink: 0,
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
            objectPosition: 'center',
            transform: `scale(${Math.max(1, Math.min(3, avatarScale))})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
    )
  }

  return <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
}

function StoryTitleLoadingSkeleton() {
  return (
    <Skeleton
      variant="rounded"
      height={40}
      sx={{
        width: { xs: '68%', md: '42%' },
        borderRadius: '12px',
        bgcolor: 'rgba(166, 181, 204, 0.2)',
        mb: 1.1,
        mx: { xs: 0.3, md: 0.8 },
      }}
    />
  )
}

function StoryMessagesLoadingSkeleton() {
  return (
    <Stack spacing="var(--morius-story-message-gap)" sx={{ mt: 0.1, maxWidth: 860 }}>
      <Stack spacing={0.52}>
        <Skeleton variant="text" height={30} width="95%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
        <Skeleton variant="text" height={30} width="89%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
        <Skeleton variant="text" height={30} width="64%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
      </Stack>
      <Stack direction="row" spacing={ASSISTANT_DIALOGUE_AVATAR_GAP} alignItems="flex-start">
        <Skeleton
          variant="circular"
          width={ASSISTANT_DIALOGUE_AVATAR_SIZE}
          height={ASSISTANT_DIALOGUE_AVATAR_SIZE}
          sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }}
        />
        <Stack spacing={0.48} sx={{ minWidth: 0, flex: 1 }}>
          <Skeleton variant="text" height={21} width="29%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
          <Skeleton variant="text" height={28} width="92%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
          <Skeleton variant="text" height={28} width="86%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
        </Stack>
      </Stack>
      <Stack spacing={0.52}>
        <Skeleton variant="text" height={30} width="93%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
        <Skeleton variant="text" height={30} width="78%" sx={{ bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
      </Stack>
    </Stack>
  )
}

function StoryRightPanelLoadingSkeleton() {
  return (
    <Stack spacing={0.88} sx={{ minHeight: 0, flex: 1 }}>
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85, minHeight: 0, flex: 1 }}>
        <Skeleton variant="rounded" height={RIGHT_PANEL_CARD_HEIGHT} sx={{ borderRadius: '12px', bgcolor: 'rgba(166, 181, 204, 0.18)' }} />
        <Skeleton variant="rounded" height={RIGHT_PANEL_CARD_HEIGHT} sx={{ borderRadius: '12px', bgcolor: 'rgba(166, 181, 204, 0.18)' }} />
      </Box>
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'rgba(166, 181, 204, 0.2)' }} />
    </Stack>
  )
}

function StoryGamePage({ user, authToken, initialGameId, onNavigate, onLogout, onUserUpdate }: StoryGamePageProps) {
  const [, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [ambientByAssistantMessageId, setAmbientByAssistantMessageId] = useState<Record<number, StoryAmbientProfile>>({})
  const [inputValue, setInputValue] = useState('')
  const [quickStartIntro, setQuickStartIntro] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isBootstrappingGameData, setIsBootstrappingGameData] = useState(true)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isTurnImageGenerationEnabled, setIsTurnImageGenerationEnabled] = useState(false)
  const [turnImageByAssistantMessageId, setTurnImageByAssistantMessageId] = useState<
    Record<number, StoryTurnImageEntry[]>
  >({})
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<number | null>(null)
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_WIDTH_DEFAULT)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('ai')
  const [activeAiPanelTab, setActiveAiPanelTab] = useState<AiPanelTab>('instructions')
  const [activeWorldPanelTab, setActiveWorldPanelTab] = useState<WorldPanelTab>('story')
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [instructionTemplateDialogOpen, setInstructionTemplateDialogOpen] = useState(false)
  const [instructionTemplateDialogMode, setInstructionTemplateDialogMode] = useState<'manage' | 'picker'>('picker')
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentSuccessCoins, setPaymentSuccessCoins] = useState<number | null>(null)
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [isSavingMessage, setIsSavingMessage] = useState(false)
  const [instructionCards, setInstructionCards] = useState<StoryInstructionCard[]>([])
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [editingInstructionId, setEditingInstructionId] = useState<number | null>(null)
  const [instructionTitleDraft, setInstructionTitleDraft] = useState('')
  const [instructionContentDraft, setInstructionContentDraft] = useState('')
  const [isSavingInstruction, setIsSavingInstruction] = useState(false)
  const [deletingInstructionId, setDeletingInstructionId] = useState<number | null>(null)
  const [plotCards, setPlotCards] = useState<StoryPlotCard[]>([])
  const [plotCardDialogOpen, setPlotCardDialogOpen] = useState(false)
  const [editingPlotCardId, setEditingPlotCardId] = useState<number | null>(null)
  const [plotCardTitleDraft, setPlotCardTitleDraft] = useState('')
  const [plotCardContentDraft, setPlotCardContentDraft] = useState('')
  const [isSavingPlotCard, setIsSavingPlotCard] = useState(false)
  const [deletingPlotCardId, setDeletingPlotCardId] = useState<number | null>(null)
  const [plotCardEvents, setPlotCardEvents] = useState<StoryPlotCardEvent[]>([])
  const [dismissedPlotCardEventIds, setDismissedPlotCardEventIds] = useState<number[]>([])
  const [expandedPlotCardEventIds, setExpandedPlotCardEventIds] = useState<number[]>([])
  const [undoingPlotCardEventIds, setUndoingPlotCardEventIds] = useState<number[]>([])
  const [isUndoingAssistantStep, setIsUndoingAssistantStep] = useState(false)
  const [worldCards, setWorldCards] = useState<StoryWorldCard[]>([])
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [hasLoadedCharacters, setHasLoadedCharacters] = useState(false)
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false)
  const [isSavingCharacter, setIsSavingCharacter] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<number | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterManagerDialogOpen, setCharacterManagerDialogOpen] = useState(false)
  const [characterDialogMode, setCharacterDialogMode] = useState<CharacterDialogMode>('manage')
  const [characterDialogReturnMode, setCharacterDialogReturnMode] = useState<CharacterSelectionDialogMode | null>(null)
  const [characterDraftMode, setCharacterDraftMode] = useState<CharacterDraftMode>('create')
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null)
  const [characterNameDraft, setCharacterNameDraft] = useState('')
  const [characterDescriptionDraft, setCharacterDescriptionDraft] = useState('')
  const [characterTriggersDraft, setCharacterTriggersDraft] = useState('')
  const [characterAvatarDraft, setCharacterAvatarDraft] = useState<string | null>(null)
  const [characterAvatarCropSource, setCharacterAvatarCropSource] = useState<string | null>(null)
  const [characterAvatarError, setCharacterAvatarError] = useState('')
  const [isSelectingCharacter, setIsSelectingCharacter] = useState(false)
  const [worldCardAvatarTargetId, setWorldCardAvatarTargetId] = useState<number | null>(null)
  const [isSavingWorldCardAvatar, setIsSavingWorldCardAvatar] = useState(false)
  const [worldCardEvents, setWorldCardEvents] = useState<StoryWorldCardEvent[]>([])
  const [canRedoAssistantStepServer, setCanRedoAssistantStepServer] = useState(false)
  const [dismissedWorldCardEventIds, setDismissedWorldCardEventIds] = useState<number[]>([])
  const [expandedWorldCardEventIds, setExpandedWorldCardEventIds] = useState<number[]>([])
  const [undoingWorldCardEventIds, setUndoingWorldCardEventIds] = useState<number[]>([])
  const [worldCardDialogOpen, setWorldCardDialogOpen] = useState(false)
  const [editingWorldCardId, setEditingWorldCardId] = useState<number | null>(null)
  const [editingWorldCardKind, setEditingWorldCardKind] = useState<StoryWorldCardKind>('world')
  const [worldCardTitleDraft, setWorldCardTitleDraft] = useState('')
  const [worldCardContentDraft, setWorldCardContentDraft] = useState('')
  const [worldCardTriggersDraft, setWorldCardTriggersDraft] = useState('')
  const [worldCardMemoryTurnsDraft, setWorldCardMemoryTurnsDraft] = useState<NpcMemoryTurnsOption>(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
  const [isSavingWorldCard, setIsSavingWorldCard] = useState(false)
  const [updatingWorldCardAiEditId, setUpdatingWorldCardAiEditId] = useState<number | null>(null)
  const [deletingWorldCardId, setDeletingWorldCardId] = useState<number | null>(null)
  const [mainHeroPreviewOpen, setMainHeroPreviewOpen] = useState(false)
  const [contextLimitChars, setContextLimitChars] = useState(STORY_DEFAULT_CONTEXT_LIMIT)
  const [contextLimitDraft, setContextLimitDraft] = useState(String(STORY_DEFAULT_CONTEXT_LIMIT))
  const [isSavingContextLimit, setIsSavingContextLimit] = useState(false)
  const [responseMaxTokens, setResponseMaxTokens] = useState(STORY_DEFAULT_RESPONSE_MAX_TOKENS)
  const [responseMaxTokensEnabled, setResponseMaxTokensEnabled] = useState(false)
  const [isSavingResponseMaxTokens, setIsSavingResponseMaxTokens] = useState(false)
  const [isSavingResponseMaxTokensEnabled, setIsSavingResponseMaxTokensEnabled] = useState(false)
  const [storyLlmModel, setStoryLlmModel] = useState<StoryNarratorModelId>(STORY_DEFAULT_NARRATOR_MODEL_ID)
  const [storyImageModel, setStoryImageModel] = useState<StoryImageModelId>(STORY_DEFAULT_IMAGE_MODEL_ID)
  const [imageStylePromptDraft, setImageStylePromptDraft] = useState('')
  const [memoryOptimizationEnabled, setMemoryOptimizationEnabled] = useState(true)
  const [storyTopK, setStoryTopK] = useState(STORY_DEFAULT_TOP_K)
  const [storyTopR, setStoryTopR] = useState(STORY_DEFAULT_TOP_R)
  const [ambientEnabled, setAmbientEnabled] = useState(false)
  const [persistedAmbientProfile, setPersistedAmbientProfile] = useState<StoryAmbientProfile | null>(null)
  const [storySettingsOverrides, setStorySettingsOverrides] = useState<Record<number, StorySettingsOverride>>({})
  const [isSavingStoryLlmModel, setIsSavingStoryLlmModel] = useState(false)
  const [isSavingStoryImageModel, setIsSavingStoryImageModel] = useState(false)
  const [isSavingImageStylePrompt, setIsSavingImageStylePrompt] = useState(false)
  const [isSavingMemoryOptimization, setIsSavingMemoryOptimization] = useState(false)
  const [isSavingStorySampling, setIsSavingStorySampling] = useState(false)
  const [isSavingAmbientEnabled, setIsSavingAmbientEnabled] = useState(false)
  const [cardMenuAnchorEl, setCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [cardMenuType, setCardMenuType] = useState<PanelCardMenuType | null>(null)
  const [cardMenuCardId, setCardMenuCardId] = useState<number | null>(null)
  const [deletionPrompt, setDeletionPrompt] = useState<DeletionPrompt | null>(null)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const turnImageAbortControllersRef = useRef<Map<number, AbortController>>(new Map())
  const imageStylePromptByGameRef = useRef<Record<number, string>>({})
  const activeGameIdRef = useRef<number | null>(null)
  const rightPanelResizingRef = useRef(false)
  const instructionDialogGameIdRef = useRef<number | null>(null)
  const plotCardDialogGameIdRef = useRef<number | null>(null)
  const worldCardDialogGameIdRef = useRef<number | null>(null)
  const hasTriedAutoLoadCharactersRef = useRef(false)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const worldCardAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)

  const activeDisplayTitle = useMemo(
    () => getDisplayStoryTitle(activeGameId, customTitleMap),
    [activeGameId, customTitleMap],
  )

  useEffect(() => {
    activeGameIdRef.current = activeGameId
  }, [activeGameId])
  const activeAmbientProfile = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') {
        continue
      }
      const profile = ambientByAssistantMessageId[message.id]
      if (profile) {
        return profile
      }
    }
    return persistedAmbientProfile ?? STORY_AMBIENT_DEFAULT_PROFILE
  }, [ambientByAssistantMessageId, messages, persistedAmbientProfile])
  const storyStageSx = useMemo(
    () => ({
      width: '100%',
      maxWidth: 980,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      pt: { xs: 0.9, md: 1.1 },
    }),
    [],
  )
  const messagesViewportBottomPadding = useMemo(() => {
    const fallbackComposerHeight = 152
    const measuredComposerHeight = composerHeight > 0 ? composerHeight : fallbackComposerHeight
    return measuredComposerHeight + moriusThemeTokens.layout.interfaceGap + 40
  }, [composerHeight])
  const composerAmbientVisual = useMemo(() => {
    if (!ambientEnabled) {
      return null
    }

    const baseAuraAlpha = 0.2
    const pulseMinAlpha = clampAmbientValue(0.11 + activeAmbientProfile.glow_strength * 0.04, 0, 1, 0.12)
    const pulseMaxAlpha = clampAmbientValue(pulseMinAlpha + 0.04 + (isGenerating ? 0.01 : 0), 0, 1, 0.17)
    const borderAlpha = clampAmbientValue(0.18 + activeAmbientProfile.glow_strength * 0.1, 0, 1, 0.24)

    const basePrimary = hexToRgba(activeAmbientProfile.primary_color, baseAuraAlpha)
    const baseSecondary = hexToRgba(activeAmbientProfile.secondary_color, baseAuraAlpha)
    const baseHighlight = hexToRgba(activeAmbientProfile.highlight_color, baseAuraAlpha)

    const pulsePrimaryMin = hexToRgba(activeAmbientProfile.primary_color, pulseMinAlpha)
    const pulseSecondaryMin = hexToRgba(activeAmbientProfile.secondary_color, pulseMinAlpha)
    const pulseHighlightMin = hexToRgba(activeAmbientProfile.highlight_color, pulseMinAlpha)
    const pulsePrimaryMax = hexToRgba(activeAmbientProfile.primary_color, pulseMaxAlpha)
    const pulseSecondaryMax = hexToRgba(activeAmbientProfile.secondary_color, pulseMaxAlpha)
    const pulseHighlightMax = hexToRgba(activeAmbientProfile.highlight_color, pulseMaxAlpha)

    return {
      borderColor: hexToRgba(activeAmbientProfile.highlight_color, borderAlpha),
      baseShadow: `0 0 85px -11px ${basePrimary}, 0 0 85px -11px ${baseSecondary}, 0 0 85px -11px ${baseHighlight}`,
      pulseShadowMin: `0 0 85px -11px ${pulsePrimaryMin}, 0 0 85px -11px ${pulseSecondaryMin}, 0 0 85px -11px ${pulseHighlightMin}`,
      pulseShadowMax: `0 0 85px -11px ${pulsePrimaryMax}, 0 0 85px -11px ${pulseSecondaryMax}, 0 0 85px -11px ${pulseHighlightMax}`,
    }
  }, [activeAmbientProfile, ambientEnabled, isGenerating])

  const applyStoryGameSettings = useCallback((game: StoryGameSummary) => {
    const normalizedContextLimit = clampStoryContextLimit(game.context_limit_chars)
    setContextLimitChars(normalizedContextLimit)
    setContextLimitDraft(String(normalizedContextLimit))
    const runtimeGame = game as Partial<StoryGameSummary>
    const normalizedImageModel = normalizeStoryImageModelId(runtimeGame.image_model)
    setStoryImageModel(normalizedImageModel)
    const normalizedImageStylePrompt = normalizeStoryImageStylePrompt(runtimeGame.image_style_prompt)
    setImageStylePromptDraft(normalizedImageStylePrompt)
    imageStylePromptByGameRef.current[game.id] = normalizedImageStylePrompt
    const normalizedResponseMaxTokens = clampStoryResponseMaxTokens(runtimeGame.response_max_tokens ?? STORY_DEFAULT_RESPONSE_MAX_TOKENS)
    const normalizedResponseMaxTokensEnabled =
      typeof runtimeGame.response_max_tokens_enabled === 'boolean'
        ? runtimeGame.response_max_tokens_enabled
        : false
    setResponseMaxTokens(normalizedResponseMaxTokens)
    setResponseMaxTokensEnabled(normalizedResponseMaxTokensEnabled)
    const rawAmbientProfile = runtimeGame.ambient_profile
    if (rawAmbientProfile && typeof rawAmbientProfile === 'object') {
      setPersistedAmbientProfile(normalizeStoryAmbientProfile(rawAmbientProfile))
    } else {
      setPersistedAmbientProfile(null)
    }
    const override = storySettingsOverrides[game.id]
    if (override) {
      setStoryLlmModel(override.storyLlmModel)
      setResponseMaxTokens(clampStoryResponseMaxTokens(override.responseMaxTokens))
      setResponseMaxTokensEnabled(override.responseMaxTokensEnabled)
      setMemoryOptimizationEnabled(override.memoryOptimizationEnabled)
      setStoryTopK(clampStoryTopK(override.storyTopK))
      setStoryTopR(clampStoryTopR(override.storyTopR))
      setAmbientEnabled(override.ambientEnabled)
      return
    }
    if (typeof runtimeGame.story_llm_model === 'string' && runtimeGame.story_llm_model.trim().length > 0) {
      setStoryLlmModel(normalizeStoryNarratorModelId(runtimeGame.story_llm_model))
    }
    if (typeof runtimeGame.memory_optimization_enabled === 'boolean') {
      setMemoryOptimizationEnabled(runtimeGame.memory_optimization_enabled)
    }
    if (typeof runtimeGame.story_top_k === 'number') {
      setStoryTopK(clampStoryTopK(runtimeGame.story_top_k))
    } else {
      setStoryTopK(STORY_DEFAULT_TOP_K)
    }
    if (typeof runtimeGame.story_top_r === 'number') {
      setStoryTopR(clampStoryTopR(runtimeGame.story_top_r))
    } else {
      setStoryTopR(STORY_DEFAULT_TOP_R)
    }
    if (typeof runtimeGame.ambient_enabled === 'boolean') {
      setAmbientEnabled(runtimeGame.ambient_enabled)
    } else {
      setAmbientEnabled(false)
    }
  }, [storySettingsOverrides])

  const isAdministrator = user.role === 'administrator'
  const hasMessages = messages.length > 0
  const shouldShowStoryTitleLoadingSkeleton = isBootstrappingGameData
  const shouldShowStoryMessagesLoadingSkeleton = (isBootstrappingGameData || isLoadingGameMessages) && messages.length === 0
  const shouldShowRightPanelLoadingSkeleton =
    isBootstrappingGameData && instructionCards.length === 0 && plotCards.length === 0 && worldCards.length === 0
  const quickStartIntroBlocks = useMemo(() => parseAssistantMessageBlocks(quickStartIntro), [quickStartIntro])
  const hasUndoneAssistantSteps = canRedoAssistantStepServer
  const canUndoAssistantStep =
    !isGenerating &&
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    messages.length > 0
  const canRedoAssistantStep =
    !isGenerating &&
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    canRedoAssistantStepServer
  const canReroll =
    !isGenerating &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    Boolean(activeGameId) &&
    !hasUndoneAssistantSteps
  const leftPanelTabLabel = rightPanelMode === 'ai' ? 'Инструкции' : 'Сюжет'
  const rightPanelTabLabel = rightPanelMode === 'ai' ? 'Настройки' : 'Мир'
  const isLeftPanelTabActive =
    rightPanelMode === 'ai' ? activeAiPanelTab === 'instructions' : activeWorldPanelTab === 'story'
  const rightPanelContentKey =
    rightPanelMode === 'ai'
      ? `ai-${activeAiPanelTab}`
      : `world-${activeWorldPanelTab}`
  const visibleWorldCardEvents = useMemo(
    () => worldCardEvents.filter((event) => !dismissedWorldCardEventIds.includes(event.id)),
    [dismissedWorldCardEventIds, worldCardEvents],
  )
  const visiblePlotCardEvents = useMemo(
    () => plotCardEvents.filter((event) => !dismissedPlotCardEventIds.includes(event.id)),
    [dismissedPlotCardEventIds, plotCardEvents],
  )
  const worldCardEventsByAssistantId = useMemo(() => {
    const nextMap = new Map<number, StoryWorldCardEvent[]>()
    visibleWorldCardEvents.forEach((event) => {
      const currentItems = nextMap.get(event.assistant_message_id) ?? []
      currentItems.push(event)
      nextMap.set(event.assistant_message_id, currentItems)
    })
    return nextMap
  }, [visibleWorldCardEvents])
  const plotCardEventsByAssistantId = useMemo(() => {
    const nextMap = new Map<number, StoryPlotCardEvent[]>()
    visiblePlotCardEvents.forEach((event) => {
      const currentItems = nextMap.get(event.assistant_message_id) ?? []
      currentItems.push(event)
      nextMap.set(event.assistant_message_id, currentItems)
    })
    return nextMap
  }, [visiblePlotCardEvents])
  const normalizedInstructionCardsForContext = useMemo(
    () =>
      instructionCards
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0),
    [instructionCards],
  )
  const selectedInstructionTemplateSignatures = useMemo(
    () =>
      instructionCards.map((card) => createInstructionTemplateSignature(card.title, card.content)),
    [instructionCards],
  )
  const normalizedPlotCardsForContext = useMemo(
    () => {
      if (!memoryOptimizationEnabled) {
        return []
      }
      return plotCards
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0)
    },
    [memoryOptimizationEnabled, plotCards],
  )
  const worldCardContextStateById = useMemo(
    () => buildWorldCardContextStateById(worldCards, messages),
    [messages, worldCards],
  )
  const activeWorldCardsForContext = useMemo(
    () => worldCards.filter((card) => worldCardContextStateById.get(card.id)?.isActive),
    [worldCardContextStateById, worldCards],
  )
  const normalizedWorldCardsForContext = useMemo(
    () =>
      activeWorldCardsForContext
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: card.content.replace(/\r\n/g, '\n').trim(),
          triggers: card.triggers
            .flatMap((trigger) => splitStoryTriggerCandidates(trigger))
            .map((trigger) => trigger.replace(/\s+/g, ' ').trim())
            .filter(Boolean),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0),
    [activeWorldCardsForContext],
  )
  const instructionContextTokensUsed = useMemo(() => {
    if (normalizedInstructionCardsForContext.length === 0) {
      return 0
    }
    const payload = normalizedInstructionCardsForContext
      .map((card, index) => `${index + 1}. ${card.title}: ${card.content}`)
      .join('\n')
    return estimateTextTokens(payload)
  }, [normalizedInstructionCardsForContext])
  const worldContextTokensUsed = useMemo(() => {
    if (normalizedWorldCardsForContext.length === 0) {
      return 0
    }
    const lines: string[] = []
    normalizedWorldCardsForContext.forEach((card, index) => {
      lines.push(`${index + 1}. ${card.title}: ${card.content}`)
      lines.push(`Триггеры: ${card.triggers.length > 0 ? card.triggers.join(', ') : 'нет'}`)
    })
    return estimateTextTokens(lines.join('\n'))
  }, [normalizedWorldCardsForContext])
  const effectiveHistoryContextTokensUsed = useMemo(() => {
    const normalizedHistory = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content.replace(/\r\n/g, '\n').trim(),
      }))
      .filter((message) => message.content.length > 0)
    if (normalizedHistory.length === 0) {
      return 0
    }
    const historyBudgetTokens = Math.max(contextLimitChars - instructionContextTokensUsed - worldContextTokensUsed, 0)
    return estimateHistoryTokensWithinBudget(normalizedHistory, historyBudgetTokens)
  }, [contextLimitChars, instructionContextTokensUsed, messages, worldContextTokensUsed])
  const effectivePlotContextTokensUsed = useMemo(() => {
    if (!memoryOptimizationEnabled || normalizedPlotCardsForContext.length === 0) {
      return 0
    }
    const plotBudgetTokens = Math.max(contextLimitChars - instructionContextTokensUsed - worldContextTokensUsed, 0)
    return estimatePlotCardsTokensWithinBudget(normalizedPlotCardsForContext, plotBudgetTokens)
  }, [
    contextLimitChars,
    instructionContextTokensUsed,
    memoryOptimizationEnabled,
    normalizedPlotCardsForContext,
    worldContextTokensUsed,
  ])
  const isPlotMemoryActive = memoryOptimizationEnabled && normalizedPlotCardsForContext.length > 0
  const storyMemoryTokensUsed = isPlotMemoryActive ? effectivePlotContextTokensUsed : effectiveHistoryContextTokensUsed
  const storyMemoryLabel = isPlotMemoryActive ? 'Карточки сюжета' : 'История сообщений'
  const storyMemoryHint = !memoryOptimizationEnabled
    ? 'Оптимизация памяти выключена: карточки сюжета не используются в контексте.'
    : isPlotMemoryActive
      ? `Учитываются карточки сюжета: ${normalizedPlotCardsForContext.length}.`
      : 'Карточек сюжета нет, учитывается история диалога.'
  const cardsContextCharsUsed = instructionContextTokensUsed + storyMemoryTokensUsed + worldContextTokensUsed
  const freeContextChars = Math.max(contextLimitChars - cardsContextCharsUsed, 0)
  const cardsContextOverflowChars = Math.max(cardsContextCharsUsed - contextLimitChars, 0)
  const cardsContextUsagePercent =
    contextLimitChars > 0 ? Math.min(100, (cardsContextCharsUsed / contextLimitChars) * 100) : 100
  const currentTurnCostTokens = useMemo(() => getStoryTurnCostTokens(cardsContextCharsUsed), [cardsContextCharsUsed])
  const hasInsufficientTokensForTurn = user.coins < currentTurnCostTokens
  const inputPlaceholder = hasInsufficientTokensForTurn
    ? OUT_OF_TOKENS_INPUT_PLACEHOLDER
    : hasMessages
      ? NEXT_INPUT_PLACEHOLDER
      : INITIAL_INPUT_PLACEHOLDER
  const isSavingStorySettings =
    isSavingContextLimit ||
    isSavingResponseMaxTokens ||
    isSavingResponseMaxTokensEnabled ||
    isSavingStoryLlmModel ||
    isSavingStoryImageModel ||
    isSavingImageStylePrompt ||
    isSavingMemoryOptimization ||
    isSavingStorySampling ||
    isSavingAmbientEnabled
  const isInstructionCardActionLocked = isGenerating || isSavingInstruction || isCreatingGame || deletingInstructionId !== null
  const isPlotCardActionLocked = isGenerating || isSavingPlotCard || isCreatingGame || deletingPlotCardId !== null
  const isWorldCardActionLocked = isGenerating || isSavingWorldCard || isCreatingGame || deletingWorldCardId !== null
  const isDeletionPromptInProgress = Boolean(
    deletionPrompt &&
      ((deletionPrompt.type === 'instruction' && deletingInstructionId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'plot' && deletingPlotCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'world' && deletingWorldCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'character' && deletingCharacterId === deletionPrompt.targetId)),
  )
  const mainHeroCard = useMemo(
    () => worldCards.find((card) => card.kind === 'main_hero') ?? null,
    [worldCards],
  )
  const displayedWorldCards = useMemo(
    () => worldCards.filter((card) => card.kind !== 'main_hero'),
    [worldCards],
  )
  const resolveWorldCardAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card) {
        return null
      }
      return card.avatar_url
    },
    [],
  )
  const mainHeroAvatarUrl = useMemo(() => resolveWorldCardAvatar(mainHeroCard), [mainHeroCard, resolveWorldCardAvatar])
  const mainHeroCharacterId = useMemo(
    () => (mainHeroCard && mainHeroCard.character_id && mainHeroCard.character_id > 0 ? mainHeroCard.character_id : null),
    [mainHeroCard],
  )
  const mainHeroName = useMemo(() => normalizeCharacterIdentity(mainHeroCard?.title ?? ''), [mainHeroCard])
  const npcCharacterIds = useMemo(() => {
    const selectedIds = new Set<number>()
    worldCards.forEach((card) => {
      if (card.kind !== 'npc' || !card.character_id || card.character_id <= 0) {
        return
      }
      selectedIds.add(card.character_id)
    })
    return selectedIds
  }, [worldCards])
  const npcCharacterNames = useMemo(() => {
    const selectedNames = new Set<string>()
    worldCards.forEach((card) => {
      if (card.kind !== 'npc') {
        return
      }
      const normalizedName = normalizeCharacterIdentity(card.title)
      if (normalizedName) {
        selectedNames.add(normalizedName)
      }
    })
    return selectedNames
  }, [worldCards])
  const getCharacterSelectionDisabledReason = useCallback(
    (character: StoryCharacter, mode: CharacterDialogMode): string | null => {
      const normalizedCharacterName = normalizeCharacterIdentity(character.name)

      if (mode === 'select-main-hero') {
        if (npcCharacterIds.has(character.id) || (normalizedCharacterName && npcCharacterNames.has(normalizedCharacterName))) {
          return 'Уже выбран как NPC'
        }
        return null
      }

      if (
        (mainHeroCharacterId !== null && character.id === mainHeroCharacterId) ||
        (mainHeroName && normalizedCharacterName && normalizedCharacterName === mainHeroName)
      ) {
        return 'Уже выбран как ГГ'
      }
      if (npcCharacterIds.has(character.id) || (normalizedCharacterName && npcCharacterNames.has(normalizedCharacterName))) {
        return 'Уже выбран как NPC'
      }
      return null
    },
    [mainHeroCharacterId, mainHeroName, npcCharacterIds, npcCharacterNames],
  )
  const charactersById = useMemo(() => {
    const nextMap = new Map<number, StoryCharacter>()
    characters.forEach((character) => {
      nextMap.set(character.id, character)
    })
    return nextMap
  }, [characters])
  const speakerCardsForAvatar = useMemo(() => {
    const entries: SpeakerAvatarEntry[] = []
    const appendEntry = (names: string[], avatar: string | null, displayName: string) => {
      const normalizedNames = [...new Set(names.filter(Boolean))]
      if (normalizedNames.length === 0) {
        return
      }
      const normalizedDisplayName = displayName.trim()
      entries.push({ names: normalizedNames, avatar, displayName: normalizedDisplayName || normalizedNames[0] })
    }

    worldCards.forEach((card) => {
      if (card.kind !== 'npc' && card.kind !== 'main_hero') {
        return
      }
      const aliasSet = new Set<string>()
      buildCharacterAliases(card.title).forEach((alias) => aliasSet.add(alias))
      buildIdentityTriggerAliases(card.title, card.triggers).forEach((alias) => aliasSet.add(alias))

      const linkedCharacter =
        card.character_id && card.character_id > 0 ? charactersById.get(card.character_id) ?? null : null
      if (linkedCharacter) {
        buildCharacterAliases(linkedCharacter.name).forEach((alias) => aliasSet.add(alias))
      }

      const avatar = resolveWorldCardAvatar(card) ?? linkedCharacter?.avatar_url ?? null
      appendEntry([...aliasSet], avatar, card.title)
    })

    characters.forEach((character) => {
      appendEntry(buildCharacterAliases(character.name), character.avatar_url, character.name)
    })

    return entries
  }, [characters, charactersById, resolveWorldCardAvatar, worldCards])
  const genericDialogueSpeakerNames = useMemo(() => {
    const names = new Set<string>()
    const defaultSpeaker = normalizeCharacterIdentity(GENERIC_DIALOGUE_SPEAKER_DEFAULT)
    if (defaultSpeaker) {
      names.add(defaultSpeaker)
    }
    return names
  }, [])
  const findSpeakerEntryByName = useCallback(
    (rawSpeakerName: string): SpeakerAvatarEntry | null => {
      const lookupValues = extractSpeakerLookupValues(rawSpeakerName)
      for (const lookupValue of lookupValues) {
        const normalizedName = normalizeCharacterIdentity(lookupValue)
        if (!normalizedName) {
          continue
        }

        const exact = speakerCardsForAvatar.find((entry) =>
          entry.names.some((name) => name === normalizedName),
        )
        if (exact) {
          return exact
        }
      }

      return null
    },
    [speakerCardsForAvatar],
  )
  const resolveDialogueAvatar = useCallback(
    (speakerName: string): string | null => {
      const speakerEntry = findSpeakerEntryByName(speakerName)
      return speakerEntry?.avatar ?? null
    },
    [findSpeakerEntryByName],
  )
  const resolveDialogueSpeakerName = useCallback(
    (speakerName: string, _dialogueText: string, _nearbyNarrativeText = ''): string => {
      void _dialogueText
      void _nearbyNarrativeText
      const speakerLookupValues = extractSpeakerLookupValues(speakerName)
      const speakerDisplayName = speakerLookupValues[0] ?? speakerName.trim()
      const normalizedSpeaker = normalizeCharacterIdentity(speakerDisplayName)

      if (normalizedSpeaker) {
        const speakerEntry = findSpeakerEntryByName(speakerDisplayName)
        if (speakerEntry) {
          const normalizedDisplay = normalizeCharacterIdentity(speakerEntry.displayName)
          if (
            !genericDialogueSpeakerNames.has(normalizedSpeaker) ||
            (normalizedDisplay && normalizedDisplay !== normalizedSpeaker)
          ) {
            return speakerEntry.displayName
          }
        }
      }

      if (normalizedSpeaker && !genericDialogueSpeakerNames.has(normalizedSpeaker)) {
        return speakerDisplayName || speakerName
      }

      return speakerDisplayName || speakerName
    },
    [findSpeakerEntryByName, genericDialogueSpeakerNames],
  )
  const selectedMenuWorldCard = useMemo(
    () => (cardMenuType === 'world' && cardMenuCardId !== null ? worldCards.find((card) => card.id === cardMenuCardId) ?? null : null),
    [cardMenuCardId, cardMenuType, worldCards],
  )
  const selectedCharacterMenuItem = useMemo(
    () =>
      characterMenuCharacterId !== null
        ? characters.find((character) => character.id === characterMenuCharacterId) ?? null
        : null,
    [characterMenuCharacterId, characters],
  )
  const isSelectedMenuWorldCardLocked = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.is_locked,
  )
  const isSelectedMenuWorldCardAiEditUpdating = Boolean(
    selectedMenuWorldCard && updatingWorldCardAiEditId === selectedMenuWorldCard.id,
  )
  const canDeleteSelectedMenuWorldCard = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.kind !== 'main_hero',
  )
  const getWorldCardAiEditStatusLabel = useCallback(
    (card: StoryWorldCard): string => (card.ai_edit_enabled ? 'ИИ редактирование: разрешено' : 'ИИ редактирование: запрещено'),
    [],
  )

  const adjustInputHeight = useCallback(() => {
    const node = textAreaRef.current
    if (!node) {
      return
    }

    node.style.height = '0px'
    const maxHeight = Math.floor(window.innerHeight * 0.34)
    const nextHeight = Math.min(node.scrollHeight, maxHeight)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  const applyWorldCardEvents = useCallback((nextEvents: StoryWorldCardEvent[]) => {
    setWorldCardEvents(nextEvents)
    const eventIds = new Set(nextEvents.map((event) => event.id))
    setDismissedWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setExpandedWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setUndoingWorldCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
  }, [])
  const applyPlotCardEvents = useCallback((nextEvents: StoryPlotCardEvent[]) => {
    setPlotCardEvents(nextEvents)
    const eventIds = new Set(nextEvents.map((event) => event.id))
    setDismissedPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setExpandedPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
    setUndoingPlotCardEventIds((previousIds) => previousIds.filter((eventId) => eventIds.has(eventId)))
  }, [])

  const loadCharacters = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      setIsLoadingCharacters(true)
      try {
        const loadedCharacters = await listStoryCharacters(authToken)
        setCharacters(loadedCharacters)
        setHasLoadedCharacters(true)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей'
        if (!silent) {
          setErrorMessage(detail)
        }
      } finally {
        setIsLoadingCharacters(false)
      }
    },
    [authToken],
  )

  useEffect(() => {
    if (hasTriedAutoLoadCharactersRef.current) {
      return
    }
    if (hasLoadedCharacters || isLoadingCharacters) {
      return
    }

    hasTriedAutoLoadCharactersRef.current = true
    void loadCharacters({ silent: true })
  }, [hasLoadedCharacters, isLoadingCharacters, loadCharacters])

  const resetCharacterDraft = useCallback(() => {
    setCharacterDraftMode('create')
    setEditingCharacterId(null)
    setCharacterNameDraft('')
    setCharacterDescriptionDraft('')
    setCharacterTriggersDraft('')
    setCharacterAvatarDraft(null)
    setCharacterAvatarCropSource(null)
    setCharacterAvatarError('')
  }, [])

  const openCharacterDialog = useCallback(
    async (mode: CharacterDialogMode) => {
      setCharacterDialogMode(mode)
      setCharacterDialogReturnMode(null)
      setCharacterDialogOpen(true)
      setCharacterAvatarError('')
      if (!hasLoadedCharacters && !isLoadingCharacters) {
        await loadCharacters()
      }
    },
    [hasLoadedCharacters, isLoadingCharacters, loadCharacters],
  )

  const handleOpenCharacterManager = useCallback(() => {
    setCharacterManagerDialogOpen(true)
  }, [])

  const handleOpenCharacterSelectorForMainHero = useCallback(async () => {
    await openCharacterDialog('select-main-hero')
  }, [openCharacterDialog])

  const handleOpenCharacterSelectorForNpc = useCallback(async () => {
    await openCharacterDialog('select-npc')
  }, [openCharacterDialog])

  const handleCloseCharacterDialog = useCallback(() => {
    if (isSavingCharacter || isSelectingCharacter) {
      return
    }
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setDeletionPrompt((previous) => (previous?.type === 'character' ? null : previous))
    setCharacterDialogReturnMode(null)
    setCharacterDialogOpen(false)
    setCharacterAvatarCropSource(null)
    setCharacterAvatarError('')
  }, [isSavingCharacter, isSelectingCharacter])

  const handleStartCreateCharacter = useCallback(() => {
    resetCharacterDraft()
  }, [resetCharacterDraft])

  const handleStartCreateCharacterFromNpcSelector = useCallback(() => {
    if (characterDialogMode !== 'select-npc' || isSavingCharacter || isSelectingCharacter) {
      return
    }
    setCharacterDialogReturnMode('select-npc')
    setCharacterDialogMode('manage')
    resetCharacterDraft()
  }, [characterDialogMode, isSavingCharacter, isSelectingCharacter, resetCharacterDraft])

  const handleStartEditCharacter = useCallback((character: StoryCharacter) => {
    setCharacterDialogReturnMode(null)
    setCharacterDraftMode('edit')
    setEditingCharacterId(character.id)
    setCharacterNameDraft(character.name)
    setCharacterDescriptionDraft(character.description)
    setCharacterTriggersDraft(character.triggers.join(', '))
    setCharacterAvatarDraft(character.avatar_url)
    setCharacterAvatarCropSource(null)
    setCharacterAvatarError('')
  }, [])

  const handleChooseCharacterAvatar = useCallback(() => {
    if (isSavingCharacter) {
      return
    }
    characterAvatarInputRef.current?.click()
  }, [isSavingCharacter])

  const handleCharacterAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setCharacterAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    setCharacterAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setCharacterAvatarCropSource(dataUrl)
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Не удалось обработать аватар персонажа'
      setCharacterAvatarError(detail)
    }
  }, [])

  const handleSaveCroppedCharacterAvatar = useCallback(
    (croppedDataUrl: string) => {
      if (isSavingCharacter || !croppedDataUrl) {
        return
      }
      if (estimateDataUrlBytes(croppedDataUrl) > CHARACTER_AVATAR_MAX_BYTES) {
        setCharacterAvatarError('Avatar is too large after crop. Maximum is 500 KB.')
        return
      }
      setCharacterAvatarDraft(croppedDataUrl)
      setCharacterAvatarCropSource(null)
      setCharacterAvatarError('')
    },
    [isSavingCharacter],
  )

  const handleSaveCharacter = useCallback(async () => {
    if (isSavingCharacter) {
      return
    }

    const normalizedName = characterNameDraft.replace(/\s+/g, ' ').trim()
    const normalizedDescription = characterDescriptionDraft.replace(/\r\n/g, '\n').trim()
    if (!normalizedName) {
      setErrorMessage('Имя персонажа не может быть пустым')
      return
    }
    if (!normalizedDescription) {
      setErrorMessage('Описание персонажа не может быть пустым')
      return
    }

    const normalizedTriggers = normalizeCharacterTriggersDraft(characterTriggersDraft, normalizedName)
    setErrorMessage('')
    setIsSavingCharacter(true)
    try {
      if (characterDraftMode === 'create') {
        const createdCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: characterAvatarDraft,
          },
        })
        setCharacters((previous) => [...previous, createdCharacter])
        if (characterDialogReturnMode) {
          setCharacterDialogMode(characterDialogReturnMode)
          setCharacterDialogReturnMode(null)
        }
      } else if (editingCharacterId !== null) {
        const updatedCharacter = await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: characterAvatarDraft,
          },
        })
        setCharacters((previous) => previous.map((item) => (item.id === updatedCharacter.id ? updatedCharacter : item)))
      }
      resetCharacterDraft()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacter(false)
    }
  }, [
    authToken,
    characterAvatarDraft,
    characterDescriptionDraft,
    characterDraftMode,
    characterDialogReturnMode,
    characterNameDraft,
    characterTriggersDraft,
    editingCharacterId,
    isSavingCharacter,
    resetCharacterDraft,
  ])

  const handleDeleteCharacter = useCallback(
    async (characterId: number) => {
      if (deletingCharacterId !== null || isSavingCharacter) {
        return
      }
      setDeletingCharacterId(characterId)
      setErrorMessage('')
      try {
        await deleteStoryCharacter({
          token: authToken,
          characterId,
        })
        setCharacters((previous) => previous.filter((character) => character.id !== characterId))
        if (editingCharacterId === characterId) {
          resetCharacterDraft()
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить персонажа'
        setErrorMessage(detail)
      } finally {
        setDeletingCharacterId(null)
      }
    },
    [authToken, deletingCharacterId, editingCharacterId, isSavingCharacter, resetCharacterDraft],
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
    handleStartEditCharacter(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, handleStartEditCharacter, selectedCharacterMenuItem])

  const handleDeleteCharacterFromMenu = useCallback(async () => {
    if (!selectedCharacterMenuItem) {
      return
    }
    setDeletionPrompt({
      type: 'character',
      targetId: selectedCharacterMenuItem.id,
      title: 'Удалить персонажа?',
      message: `Персонаж «${selectedCharacterMenuItem.name}» будет удален из «Мои персонажи». Это действие нельзя отменить.`,
    })
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, selectedCharacterMenuItem, setDeletionPrompt])

  const handleEditMainHeroFromPreview = () => {
    if (!mainHeroCard || isWorldCardActionLocked) {
      return
    }
    handleOpenEditWorldCardDialog(mainHeroCard)
    setMainHeroPreviewOpen(false)
  }

  const ensureGameForCharacterSelection = useCallback(async (): Promise<number | null> => {
    if (activeGameId) {
      return activeGameId
    }
    setIsCreatingGame(true)
    try {
      const newGame = await createStoryGame({ token: authToken })
      setGames((previousGames) => sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]))
      setActiveGameId(newGame.id)
      applyStoryGameSettings(newGame)
      setInstructionCards([])
      setPlotCards([])
      setWorldCards([])
      applyPlotCardEvents([])
      applyWorldCardEvents([])
      onNavigate(`/home/${newGame.id}`)
      return newGame.id
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
      setErrorMessage(detail)
      return null
    }
  }, [activeGameId, applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken, onNavigate])

  const handleSelectCharacterForGame = useCallback(
    async (character: StoryCharacter) => {
      if (isSelectingCharacter) {
        return
      }
      const disabledReason = getCharacterSelectionDisabledReason(character, characterDialogMode)
      if (disabledReason) {
        setErrorMessage(disabledReason)
        return
      }
      setIsSelectingCharacter(true)
      setErrorMessage('')
      try {
        const targetGameId = await ensureGameForCharacterSelection()
        if (!targetGameId) {
          return
        }

        const createdCard =
          characterDialogMode === 'select-main-hero'
            ? await selectStoryMainHero({
                token: authToken,
                gameId: targetGameId,
                characterId: character.id,
              })
            : await createStoryNpcFromCharacter({
                token: authToken,
                gameId: targetGameId,
                characterId: character.id,
              })

        setWorldCards((previousCards) => {
          const hasCard = previousCards.some((card) => card.id === createdCard.id)
          if (hasCard) {
            return previousCards.map((card) => (card.id === createdCard.id ? createdCard : card))
          }
          return [...previousCards, createdCard]
        })
        setCharacterDialogOpen(false)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось применить персонажа'
        setErrorMessage(detail)
      } finally {
        setIsSelectingCharacter(false)
      }
    },
    [
      authToken,
      characterDialogMode,
      ensureGameForCharacterSelection,
      getCharacterSelectionDisabledReason,
      isSelectingCharacter,
    ],
  )

  const handleOpenWorldCardAvatarPicker = useCallback((cardId: number) => {
    if (isSavingWorldCardAvatar) {
      return
    }
    setWorldCardAvatarTargetId(cardId)
    worldCardAvatarInputRef.current?.click()
  }, [isSavingWorldCardAvatar])

  const handleWorldCardAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile || !activeGameId || worldCardAvatarTargetId === null) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorMessage('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    setErrorMessage('')
    setIsSavingWorldCardAvatar(true)
    try {
      const avatarDataUrl = await compressImageFileToDataUrl(selectedFile, {
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: 960,
      })
      const updatedCard = await updateStoryWorldCardAvatar({
        token: authToken,
        gameId: activeGameId,
        cardId: worldCardAvatarTargetId,
        avatar_url: avatarDataUrl,
      })
      setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить аватар персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingWorldCardAvatar(false)
      setWorldCardAvatarTargetId(null)
    }
  }, [activeGameId, authToken, worldCardAvatarTargetId])

  const handleToggleWorldCardAiEdit = useCallback(async () => {
    if (
      !activeGameId ||
      !selectedMenuWorldCard ||
      isWorldCardActionLocked ||
      isSelectedMenuWorldCardAiEditUpdating
    ) {
      return
    }
    const targetCard = selectedMenuWorldCard
    setErrorMessage('')
    setUpdatingWorldCardAiEditId(targetCard.id)
    try {
      const updatedCard = await updateStoryWorldCardAiEdit({
        token: authToken,
        gameId: activeGameId,
        cardId: targetCard.id,
        ai_edit_enabled: !targetCard.ai_edit_enabled,
      })
      setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      setCardMenuAnchorEl(null)
      setCardMenuType(null)
      setCardMenuCardId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить настройку редактирования ИИ'
      setErrorMessage(detail)
    } finally {
      setUpdatingWorldCardAiEditId(null)
    }
  }, [
    activeGameId,
    authToken,
    isSelectedMenuWorldCardAiEditUpdating,
    isWorldCardActionLocked,
    selectedMenuWorldCard,
  ])

  const loadGameById = useCallback(
    async (gameId: number, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      if (!silent) {
        setIsLoadingGameMessages(true)
      }
      try {
        const payload = await getStoryGame({ token: authToken, gameId })
        const serverOpeningScene = (payload.game.opening_scene ?? '').trim()
        setQuickStartIntro((previousIntro) => (serverOpeningScene.length > 0 ? serverOpeningScene : previousIntro))
        setMessages(payload.messages)
        const restoredTurnImages = (payload.turn_images ?? []).reduce<Record<number, StoryTurnImageEntry[]>>(
          (accumulator, item) => {
            const assistantMessageId = Number(item.assistant_message_id)
            if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) {
              return accumulator
            }
            const resolvedImageUrl = (item.image_data_url ?? item.image_url ?? '').trim()
            if (!resolvedImageUrl) {
              return accumulator
            }
            const restoredEntry: StoryTurnImageEntry = {
              id: item.id,
              status: 'ready',
              imageUrl: resolvedImageUrl,
              prompt: item.prompt ?? null,
              error: null,
              createdAt: item.created_at ?? null,
              updatedAt: item.updated_at ?? null,
            }
            const existingEntries = accumulator[assistantMessageId] ?? []
            accumulator[assistantMessageId] = [...existingEntries, restoredEntry]
            return accumulator
          },
          {},
        )
        setTurnImageByAssistantMessageId((previousState) => {
          const nextState: Record<number, StoryTurnImageEntry[]> = { ...restoredTurnImages }
          payload.messages.forEach((message) => {
            if (message.role !== 'assistant') {
              return
            }
            const existingEntries = previousState[message.id]
            if (!existingEntries?.length) {
              return
            }
            const loadingEntries = existingEntries.filter((entry) => entry.status === 'loading')
            if (!loadingEntries.length) {
              return
            }
            const restoredEntries = nextState[message.id] ?? []
            nextState[message.id] = [...restoredEntries, ...loadingEntries]
          })
          return nextState
        })
        setInstructionCards(payload.instruction_cards)
        setPlotCards(payload.plot_cards ?? [])
        applyPlotCardEvents(payload.plot_card_events ?? [])
        setWorldCards(payload.world_cards)
        applyStoryGameSettings(payload.game)
        applyWorldCardEvents(payload.world_card_events ?? [])
        setCanRedoAssistantStepServer(Boolean(payload.can_redo_assistant_step))
        setGames((previousGames) => {
          const hasGame = previousGames.some((game) => game.id === payload.game.id)
          const nextGames = hasGame
            ? previousGames.map((game) => (game.id === payload.game.id ? payload.game : game))
            : [payload.game, ...previousGames]
          return sortGamesByActivity(nextGames)
        })
        setCustomTitleMap((previousMap) => {
          if (previousMap[payload.game.id]?.trim()) {
            return previousMap
          }
          const nextMap = setStoryTitle(previousMap, payload.game.id, payload.game.title)
          persistStoryTitleMap(nextMap)
          return nextMap
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить историю игры'
        setErrorMessage(detail)
      } finally {
        if (!silent) {
          setIsLoadingGameMessages(false)
        }
      }
    },
    [applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken],
  )

  useEffect(() => {
    let isActive = true

    const bootstrap = async () => {
      setIsBootstrappingGameData(true)
      try {
        const loadedGames = await listStoryGames(authToken)
        if (!isActive) {
          return
        }
        const sortedGames = sortGamesByActivity(loadedGames)
        setGames(sortedGames)
        setCustomTitleMap((previousMap) => {
          let nextMap = previousMap
          let hasChanges = false
          sortedGames.forEach((game) => {
            if (previousMap[game.id]?.trim()) {
              return
            }
            nextMap = setStoryTitle(nextMap, game.id, game.title)
            hasChanges = true
          })
          if (hasChanges) {
            persistStoryTitleMap(nextMap)
            return nextMap
          }
          return previousMap
        })
        if (sortedGames.length > 0) {
          const preferredGameId =
            initialGameId && sortedGames.some((game) => game.id === initialGameId) ? initialGameId : sortedGames[0].id
          setActiveGameId(preferredGameId)
          await loadGameById(preferredGameId)
        } else {
          setActiveGameId(null)
          setMessages([])
          setTurnImageByAssistantMessageId({})
          setAmbientByAssistantMessageId({})
          setPersistedAmbientProfile(null)
          setInstructionCards([])
          setPlotCards([])
          setWorldCards([])
          setCanRedoAssistantStepServer(false)
          setContextLimitChars(STORY_DEFAULT_CONTEXT_LIMIT)
          setContextLimitDraft(String(STORY_DEFAULT_CONTEXT_LIMIT))
          setResponseMaxTokens(STORY_DEFAULT_RESPONSE_MAX_TOKENS)
          setResponseMaxTokensEnabled(false)
          setStoryLlmModel(STORY_DEFAULT_NARRATOR_MODEL_ID)
          setStoryImageModel(STORY_DEFAULT_IMAGE_MODEL_ID)
          setImageStylePromptDraft('')
          imageStylePromptByGameRef.current = {}
          setMemoryOptimizationEnabled(true)
          setAmbientEnabled(false)
          applyPlotCardEvents([])
          applyWorldCardEvents([])
        }
      } catch (error) {
        if (!isActive) {
          return
        }
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
        setErrorMessage(detail)
      } finally {
        if (isActive) {
          setIsBootstrappingGameData(false)
        }
      }
    }

    void bootstrap()
    const turnImageAbortControllers = turnImageAbortControllersRef.current

    return () => {
      isActive = false
      generationAbortRef.current?.abort()
      turnImageAbortControllers.forEach((controller) => controller.abort())
      turnImageAbortControllers.clear()
    }
  }, [applyPlotCardEvents, applyWorldCardEvents, authToken, initialGameId, loadGameById])

  useEffect(() => {
    setCustomTitleMap(loadStoryTitleMap())
  }, [])

  useEffect(() => {
    const storedValue = localStorage.getItem(STORY_TURN_IMAGE_TOGGLE_STORAGE_KEY)
    setIsTurnImageGenerationEnabled(storedValue === '1')
  }, [])

  useEffect(() => {
    setQuickStartIntro('')
    setPersistedAmbientProfile(null)
    if (!activeGameId) {
      setStoryImageModel(STORY_DEFAULT_IMAGE_MODEL_ID)
      setImageStylePromptDraft('')
    }
  }, [activeGameId])

  useEffect(() => {
    setCardMenuAnchorEl(null)
    setCardMenuType(null)
    setCardMenuCardId(null)
  }, [activeGameId])

  useEffect(() => {
    return () => {
      if (rightPanelResizingRef.current) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

  useEffect(() => {
    if (instructionDialogGameIdRef.current === activeGameId) {
      return
    }
    instructionDialogGameIdRef.current = activeGameId

    if (isSavingInstruction || isCreatingGame) {
      return
    }
    setInstructionDialogOpen(false)
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
    setDeletingInstructionId(null)
  }, [activeGameId, isCreatingGame, isSavingInstruction])

  useEffect(() => {
    if (plotCardDialogGameIdRef.current === activeGameId) {
      return
    }
    plotCardDialogGameIdRef.current = activeGameId

    if (isSavingPlotCard || isCreatingGame) {
      return
    }
    setPlotCardDialogOpen(false)
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
    setDeletingPlotCardId(null)
  }, [activeGameId, isCreatingGame, isSavingPlotCard])

  useEffect(() => {
    if (worldCardDialogGameIdRef.current === activeGameId) {
      return
    }
    worldCardDialogGameIdRef.current = activeGameId

    if (isSavingWorldCard || isCreatingGame) {
      return
    }
    setWorldCardDialogOpen(false)
    setEditingWorldCardId(null)
    setEditingWorldCardKind('world')
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setDeletingWorldCardId(null)
  }, [activeGameId, isCreatingGame, isSavingWorldCard])

  useEffect(() => {
    if (!activeGameId || isLoadingGameMessages || messages.length > 0) {
      return
    }

    const rawPayload = localStorage.getItem(QUICK_START_WORLD_STORAGE_KEY)
    if (!rawPayload) {
      return
    }

    try {
      const parsed = JSON.parse(rawPayload) as {
        gameId?: unknown
        title?: unknown
        opening_scene?: unknown
        description?: unknown
      }
      if (parsed.gameId !== activeGameId) {
        return
      }

      if (typeof parsed.title === 'string') {
        const normalizedTitle = parsed.title.trim()
        if (normalizedTitle.length > 0) {
          setCustomTitleMap((previousMap) => {
            const nextMap = setStoryTitle(previousMap, activeGameId, normalizedTitle)
            persistStoryTitleMap(nextMap)
            return nextMap
          })
        }
      }

      const openingSceneFromStorage =
        typeof parsed.opening_scene === 'string'
          ? parsed.opening_scene.trim()
          : ''
      if (openingSceneFromStorage.length > 0) {
        setQuickStartIntro(openingSceneFromStorage)
      } else if (typeof parsed.description === 'string') {
        const normalizedDescription = parsed.description.trim()
        if (normalizedDescription.length > 0) {
          setQuickStartIntro(normalizedDescription)
        }
      }

      setInputValue('')
      localStorage.removeItem(QUICK_START_WORLD_STORAGE_KEY)
    } catch {
      localStorage.removeItem(QUICK_START_WORLD_STORAGE_KEY)
    }
  }, [activeGameId, isLoadingGameMessages, messages.length])

  useEffect(() => {
    if (!activeGameId) {
      return
    }
    const shouldOpenCharacterManager = localStorage.getItem(OPEN_CHARACTER_MANAGER_FLAG_KEY)
    if (shouldOpenCharacterManager !== '1') {
      return
    }
    localStorage.removeItem(OPEN_CHARACTER_MANAGER_FLAG_KEY)
    void handleOpenCharacterManager()
  }, [activeGameId, handleOpenCharacterManager])

  useEffect(() => {
    adjustInputHeight()
  }, [adjustInputHeight, inputValue])

  useEffect(() => {
    const handleResize = () => adjustInputHeight()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [adjustInputHeight])

  useEffect(() => {
    const composerNode = composerContainerRef.current
    if (!composerNode) {
      return
    }

    const measureComposerHeight = () => {
      const nextHeight = Math.ceil(composerNode.getBoundingClientRect().height)
      setComposerHeight((previous) => (previous === nextHeight ? previous : nextHeight))
    }

    measureComposerHeight()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        measureComposerHeight()
      })
      observer.observe(composerNode)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measureComposerHeight)
    return () => window.removeEventListener('resize', measureComposerHeight)
  }, [])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, isGenerating, messagesViewportBottomPadding])

  const applyCustomTitle = useCallback((gameId: number, nextTitle: string) => {
    setCustomTitleMap((previousMap) => {
      const nextMap = setStoryTitle(previousMap, gameId, nextTitle)
      persistStoryTitleMap(nextMap)
      return nextMap
    })
  }, [])

  const handleCommitInlineTitle = useCallback(
    (rawValue: string) => {
      if (!activeGameId) {
        return
      }
      const normalized = rawValue.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() || DEFAULT_STORY_TITLE
      applyCustomTitle(activeGameId, normalized)
    },
    [activeGameId, applyCustomTitle],
  )

  const handleInlineTitleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.currentTarget.textContent = activeDisplayTitle
        event.currentTarget.blur()
      }
    },
    [activeDisplayTitle],
  )

  const handleInlineTitleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    handleCommitInlineTitle(event.currentTarget.textContent ?? '')
  }, [handleCommitInlineTitle])

  const handleInlineTitleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (!activeGameId || isGenerating) {
      event.currentTarget.blur()
      return
    }
  }, [activeGameId, isGenerating])

  const handleCancelMessageEdit = () => {
    setEditingMessageId(null)
    setMessageDraft('')
    setIsSavingMessage(false)
  }

  const handleSaveEditedMessage = useCallback(async () => {
    if (editingMessageId === null || isSavingMessage) {
      return
    }
    const currentMessage = messages.find((message) => message.id === editingMessageId)
    if (!currentMessage || !activeGameId) {
      setEditingMessageId(null)
      setMessageDraft('')
      setIsSavingMessage(false)
      return
    }

    const normalized = messageDraft.trim()
    if (!normalized) {
      setErrorMessage('Текст сообщения не может быть пустым')
      return
    }

    if (normalized === currentMessage.content.trim()) {
      setEditingMessageId(null)
      setMessageDraft('')
      setIsSavingMessage(false)
      return
    }

    setIsSavingMessage(true)
    setErrorMessage('')
    try {
      const updatedMessage = await updateStoryMessage({
        token: authToken,
        gameId: activeGameId,
        messageId: currentMessage.id,
        content: normalized,
      })
      setMessages((previousMessages) =>
        previousMessages.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
      )
      setEditingMessageId(null)
      setMessageDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
      setErrorMessage(detail)
    } finally {
      setIsSavingMessage(false)
    }
  }, [activeGameId, authToken, editingMessageId, isSavingMessage, messageDraft, messages])

  const handleSaveMessageInline = useCallback(
    async (messageId: number, nextContentRaw: string) => {
      if (isGenerating || isSavingMessage || !activeGameId) {
        return
      }

      const currentMessage = messages.find((message) => message.id === messageId)
      if (!currentMessage) {
        return
      }

      const normalized = nextContentRaw.replace(/\r\n/g, '\n').trim()
      const currentNormalized = currentMessage.content.replace(/\r\n/g, '\n').trim()
      if (!normalized) {
        setErrorMessage('Текст сообщения не может быть пустым')
        return
      }
      if (normalized === currentNormalized) {
        return
      }

      setIsSavingMessage(true)
      setErrorMessage('')
      try {
        const updatedMessage = await updateStoryMessage({
          token: authToken,
          gameId: activeGameId,
          messageId,
          content: normalized,
        })
        setMessages((previousMessages) =>
          previousMessages.map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
        setErrorMessage(detail)
      } finally {
        setIsSavingMessage(false)
      }
    },
    [activeGameId, authToken, isGenerating, isSavingMessage, messages],
  )

  const ensureGameForInstructionCard = useCallback(async (): Promise<number | null> => {
    const existingGameId = activeGameIdRef.current
    if (existingGameId) {
      return existingGameId
    }

    setIsCreatingGame(true)
    try {
      const newGame = await createStoryGame({ token: authToken })
      setGames((previousGames) =>
        sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
      )
      setActiveGameId(newGame.id)
      applyStoryGameSettings(newGame)
      setMessages([])
      setInstructionCards([])
      setPlotCards([])
      setWorldCards([])
      setCanRedoAssistantStepServer(false)
      applyPlotCardEvents([])
      applyWorldCardEvents([])
      onNavigate(`/home/${newGame.id}`)
      return newGame.id
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to create game'
      setErrorMessage(detail)
      return null
    } finally {
      setIsCreatingGame(false)
    }
  }, [applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken, onNavigate])

  const handleOpenCreateInstructionDialog = () => {
    if (isGenerating || isSavingInstruction || isCreatingGame) {
      return
    }
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
    setInstructionDialogOpen(true)
  }

  const handleOpenEditInstructionDialog = (card: StoryInstructionCard) => {
    if (isGenerating || isSavingInstruction || isCreatingGame) {
      return
    }
    setEditingInstructionId(card.id)
    setInstructionTitleDraft(card.title)
    setInstructionContentDraft(card.content)
    setInstructionDialogOpen(true)
  }

  const handleOpenInstructionTemplateDialog = () => {
    if (isGenerating || isSavingInstruction || isCreatingGame || deletingInstructionId !== null) {
      return
    }
    setInstructionTemplateDialogMode('picker')
    setInstructionTemplateDialogOpen(true)
  }

  const handleCloseInstructionDialog = () => {
    if (isSavingInstruction || isCreatingGame) {
      return
    }
    setInstructionDialogOpen(false)
    setEditingInstructionId(null)
    setInstructionTitleDraft('')
    setInstructionContentDraft('')
  }

  const handleSaveInstructionCard = useCallback(async () => {
    if (isSavingInstruction || isCreatingGame) {
      return
    }

    const normalizedTitle = instructionTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = instructionContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст инструкции не может быть пустым')
      return
    }

    setErrorMessage('')
    setIsSavingInstruction(true)
    try {
      const targetGameId = await ensureGameForInstructionCard()
      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки инструкции')
        return
      }

      if (editingInstructionId === null) {
        const createdCard = await createStoryInstructionCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setInstructionCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryInstructionCard({
          token: authToken,
          gameId: targetGameId,
          instructionId: editingInstructionId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setInstructionCards((previousCards) =>
          previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)),
        )
      }

      setInstructionDialogOpen(false)
      setEditingInstructionId(null)
      setInstructionTitleDraft('')
      setInstructionContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку'
      setErrorMessage(detail)
    } finally {
      setIsSavingInstruction(false)

    }
  }, [
    authToken,
    editingInstructionId,
    ensureGameForInstructionCard,
    instructionContentDraft,
    instructionTitleDraft,
    isCreatingGame,
    isSavingInstruction,
  ])

  const handleApplyInstructionTemplate = useCallback(
    async (template: StoryInstructionTemplate) => {
      if (isSavingInstruction || isCreatingGame) {
        return
      }

      const normalizedTitle = template.title.replace(/\s+/g, ' ').trim()
      const normalizedContent = template.content.replace(/\r\n/g, '\n').trim()
      if (!normalizedTitle || !normalizedContent) {
        setErrorMessage('Template is empty')
        return
      }
      const templateSignature = createInstructionTemplateSignature(normalizedTitle, normalizedContent)
      const alreadyAdded = instructionCards.some(
        (card) => createInstructionTemplateSignature(card.title, card.content) === templateSignature,
      )
      if (alreadyAdded) {
        const detail = 'Этот шаблон уже добавлен в инструкции игры.'
        setErrorMessage(detail)
        throw new Error(detail)
      }

      setErrorMessage('')
      setIsSavingInstruction(true)
      try {
        const targetGameId = await ensureGameForInstructionCard()
        if (!targetGameId) {
          return
        }
        const createdCard = await createStoryInstructionCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setInstructionCards((previousCards) => [...previousCards, createdCard])
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to apply template'
        setErrorMessage(detail)
        throw error
      } finally {
        setIsSavingInstruction(false)
      }
    },
    [authToken, ensureGameForInstructionCard, instructionCards, isCreatingGame, isSavingInstruction],
  )

  const handleDeleteInstructionCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingInstructionId !== null || isSavingInstruction || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingInstructionId(cardId)
      try {
        await deleteStoryInstructionCard({
          token: authToken,
          gameId: activeGameId,
          instructionId: cardId,
        })
        setInstructionCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingInstructionId === cardId) {
          setInstructionDialogOpen(false)
          setEditingInstructionId(null)
          setInstructionTitleDraft('')
          setInstructionContentDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку'
        setErrorMessage(detail)
      } finally {
        setDeletingInstructionId(null)
      }
    },
    [activeGameId, authToken, deletingInstructionId, editingInstructionId, isCreatingGame, isSavingInstruction],
  )

  const handleOpenCreatePlotCardDialog = () => {
    if (isGenerating || isSavingPlotCard || isCreatingGame) {
      return
    }
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
    setPlotCardDialogOpen(true)
  }

  const handleOpenEditPlotCardDialog = (card: StoryPlotCard) => {
    if (isGenerating || isSavingPlotCard || isCreatingGame) {
      return
    }
    setEditingPlotCardId(card.id)
    setPlotCardTitleDraft(card.title)
    setPlotCardContentDraft(card.content)
    setPlotCardDialogOpen(true)
  }

  const handleClosePlotCardDialog = () => {
    if (isSavingPlotCard || isCreatingGame) {
      return
    }
    setPlotCardDialogOpen(false)
    setEditingPlotCardId(null)
    setPlotCardTitleDraft('')
    setPlotCardContentDraft('')
  }

  const handleSavePlotCard = useCallback(async () => {
    if (isSavingPlotCard || isCreatingGame) {
      return
    }

    const normalizedTitle = plotCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = plotCardContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки сюжета не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст карточки сюжета не может быть пустым')
      return
    }
    if (normalizedContent.length > STORY_PLOT_CARD_CONTENT_MAX_LENGTH) {
      setErrorMessage(`Текст карточки сюжета не должен превышать ${STORY_PLOT_CARD_CONTENT_MAX_LENGTH} символов`)
      return
    }

    setErrorMessage('')
    setIsSavingPlotCard(true)
    let targetGameId = activeGameId
    try {
      if (!targetGameId) {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        applyStoryGameSettings(newGame)
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      }

      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки сюжета')
        return
      }

      if (editingPlotCardId === null) {
        const createdCard = await createStoryPlotCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setPlotCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryPlotCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingPlotCardId,
          title: normalizedTitle,
          content: normalizedContent,
        })
        setPlotCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      }

      setPlotCardDialogOpen(false)
      setEditingPlotCardId(null)
      setPlotCardTitleDraft('')
      setPlotCardContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку сюжета'
      setErrorMessage(detail)
    } finally {
      setIsSavingPlotCard(false)

    }
  }, [
    activeGameId,
    applyStoryGameSettings,
    authToken,
    editingPlotCardId,
    isCreatingGame,
    isSavingPlotCard,
    onNavigate,
    applyPlotCardEvents,
    applyWorldCardEvents,
    plotCardContentDraft,
    plotCardTitleDraft,
  ])

  const handleDeletePlotCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingPlotCardId !== null || isSavingPlotCard || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingPlotCardId(cardId)
      try {
        await deleteStoryPlotCard({
          token: authToken,
          gameId: activeGameId,
          cardId,
        })
        setPlotCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingPlotCardId === cardId) {
          setPlotCardDialogOpen(false)
          setEditingPlotCardId(null)
          setPlotCardTitleDraft('')
          setPlotCardContentDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку сюжета'
        setErrorMessage(detail)
      } finally {
        setDeletingPlotCardId(null)
      }
    },
    [activeGameId, authToken, deletingPlotCardId, editingPlotCardId, isCreatingGame, isSavingPlotCard],
  )

  const handleOpenCreateWorldCardDialog = () => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    setEditingWorldCardId(null)
    setEditingWorldCardKind('world')
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setWorldCardDialogOpen(true)
  }

  const handleOpenEditWorldCardDialog = (card: StoryWorldCard) => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    setEditingWorldCardId(card.id)
    setEditingWorldCardKind(card.kind)
    setWorldCardTitleDraft(card.title)
    setWorldCardContentDraft(card.content)
    setWorldCardTriggersDraft(card.triggers.join(', '))
    setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(card)))
    setWorldCardDialogOpen(true)
  }

  const handleCloseWorldCardDialog = () => {
    if (isSavingWorldCard || isCreatingGame) {
      return
    }
    setWorldCardDialogOpen(false)
    setEditingWorldCardId(null)
    setEditingWorldCardKind('world')
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
  }

  const handleSaveWorldCard = useCallback(async () => {
    if (isSavingWorldCard || isCreatingGame) {
      return
    }

    const normalizedTitle = worldCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = worldCardContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки мира не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст карточки мира не может быть пустым')
      return
    }
    if (normalizedContent.length > WORLD_CARD_CONTENT_MAX_LENGTH) {
      setErrorMessage(`Текст карточки мира не должен превышать ${WORLD_CARD_CONTENT_MAX_LENGTH} символов`)
      return
    }

    const normalizedTriggers = normalizeWorldCardTriggersDraft(worldCardTriggersDraft, normalizedTitle)
    const normalizedMemoryTurns =
      editingWorldCardKind === 'npc'
        ? worldCardMemoryTurnsDraft
        : undefined
    setErrorMessage('')
    setIsSavingWorldCard(true)
    let targetGameId = activeGameId
    try {
      if (!targetGameId) {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        applyStoryGameSettings(newGame)
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      }

      if (!targetGameId) {
        setErrorMessage('Не удалось создать игру для карточки мира')
        return
      }

      if (editingWorldCardId === null) {
        const createdCard = await createStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
          triggers: normalizedTriggers,
          memory_turns: normalizedMemoryTurns,
        })
        setWorldCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingWorldCardId,
          title: normalizedTitle,
          content: normalizedContent,
          triggers: normalizedTriggers,
          memory_turns: normalizedMemoryTurns,
        })
        setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      }

      setWorldCardDialogOpen(false)
      setEditingWorldCardId(null)
      setEditingWorldCardKind('world')
      setWorldCardTitleDraft('')
      setWorldCardContentDraft('')
      setWorldCardTriggersDraft('')
      setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку мира'
      setErrorMessage(detail)
    } finally {
      setIsSavingWorldCard(false)

    }
  }, [
    activeGameId,
    applyStoryGameSettings,
    authToken,
    editingWorldCardId,
    editingWorldCardKind,
    isCreatingGame,
    isSavingWorldCard,
    onNavigate,
    applyPlotCardEvents,
    applyWorldCardEvents,
    worldCardContentDraft,
    worldCardMemoryTurnsDraft,
    worldCardTitleDraft,
    worldCardTriggersDraft,
  ])

  const handleDeleteWorldCard = useCallback(
    async (cardId: number) => {
      if (!activeGameId || deletingWorldCardId !== null || isSavingWorldCard || isCreatingGame) {
        return
      }

      setErrorMessage('')
      setDeletingWorldCardId(cardId)
      try {
        await deleteStoryWorldCard({
          token: authToken,
          gameId: activeGameId,
          cardId,
        })
        setWorldCards((previousCards) => previousCards.filter((card) => card.id !== cardId))
        if (editingWorldCardId === cardId) {
          setWorldCardDialogOpen(false)
          setEditingWorldCardId(null)
          setEditingWorldCardKind('world')
          setWorldCardTitleDraft('')
          setWorldCardContentDraft('')
          setWorldCardTriggersDraft('')
          setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку мира'
        setErrorMessage(detail)
      } finally {
        setDeletingWorldCardId(null)
      }
    },
    [activeGameId, authToken, deletingWorldCardId, editingWorldCardId, isCreatingGame, isSavingWorldCard],
  )

  const handleOpenCardMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, type: PanelCardMenuType, cardId: number) => {
      event.stopPropagation()
      setCardMenuAnchorEl(event.currentTarget)
      setCardMenuType(type)
      setCardMenuCardId(cardId)
    },
    [],
  )

  const handleCloseCardMenu = useCallback(() => {
    setCardMenuAnchorEl(null)
    setCardMenuType(null)
    setCardMenuCardId(null)
  }, [])

  const handleCardMenuEdit = () => {
    if (cardMenuCardId === null || cardMenuType === null) {
      handleCloseCardMenu()
      return
    }

    if (cardMenuType === 'instruction') {
      const card = instructionCards.find((item) => item.id === cardMenuCardId)
      if (card) {
        handleOpenEditInstructionDialog(card)
      }
    } else if (cardMenuType === 'plot') {
      const card = plotCards.find((item) => item.id === cardMenuCardId)
      if (card) {
        handleOpenEditPlotCardDialog(card)
      }
    } else {
      const card = worldCards.find((item) => item.id === cardMenuCardId)
      if (card && !card.is_locked) {
        handleOpenEditWorldCardDialog(card)
      }
    }

    handleCloseCardMenu()
  }

  const handleCardMenuDelete = useCallback(async () => {
    if (cardMenuCardId === null || cardMenuType === null) {
      handleCloseCardMenu()
      return
    }

    const targetCardId = cardMenuCardId
    const targetType = cardMenuType
    handleCloseCardMenu()

    if (targetType === 'instruction') {
      const card = instructionCards.find((item) => item.id === targetCardId)
      const normalizedTitle = card?.title?.trim() || 'без названия'
      setDeletionPrompt({
        type: 'instruction',
        targetId: targetCardId,
        title: 'Удалить инструкцию?',
        message: `Инструкция «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
    if (targetType === 'plot') {
      const card = plotCards.find((item) => item.id === targetCardId)
      const normalizedTitle = card?.title?.trim() || 'без названия'
      setDeletionPrompt({
        type: 'plot',
        targetId: targetCardId,
        title: 'Удалить карточку сюжета?',
        message: `Карточка сюжета «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
    if (targetType === 'world') {
      const worldCard = worldCards.find((card) => card.id === targetCardId)
      if (worldCard?.kind === 'main_hero') {
        setErrorMessage('Главного героя нельзя удалить после выбора')
        return
      }
      const normalizedTitle = worldCard?.title?.trim() || 'без названия'
      const worldCardLabel =
        worldCard?.kind === 'npc' ? 'NPC-карточку' : 'карточку мира'
      setDeletionPrompt({
        type: 'world',
        targetId: targetCardId,
        title: 'Удалить карточку мира?',
        message: `${worldCardLabel} «${normalizedTitle}» будет удалена без возможности восстановления.`,
      })
      return
    }
  }, [
    cardMenuCardId,
    cardMenuType,
    handleCloseCardMenu,
    instructionCards,
    plotCards,
    setDeletionPrompt,
    worldCards,
    setErrorMessage,
  ])

  const handleCancelDeletionPrompt = useCallback(() => {
    if (deletingInstructionId !== null || deletingPlotCardId !== null || deletingWorldCardId !== null || deletingCharacterId !== null) {
      return
    }
    setDeletionPrompt(null)
  }, [deletingCharacterId, deletingInstructionId, deletingPlotCardId, deletingWorldCardId])

  const handleConfirmDeletionPrompt = useCallback(async () => {
    if (!deletionPrompt) {
      return
    }
    const prompt = deletionPrompt
    setDeletionPrompt(null)
    if (prompt.type === 'instruction') {
      await handleDeleteInstructionCard(prompt.targetId)
      return
    }
    if (prompt.type === 'plot') {
      await handleDeletePlotCard(prompt.targetId)
      return
    }
    if (prompt.type === 'world') {
      await handleDeleteWorldCard(prompt.targetId)
      return
    }
    await handleDeleteCharacter(prompt.targetId)
  }, [
    deletionPrompt,
    handleDeleteCharacter,
    handleDeleteInstructionCard,
    handleDeletePlotCard,
    handleDeleteWorldCard,
  ])

  const handleStartRightPanelResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    rightPanelResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const updateWidth = (clientX: number) => {
      const computedWidth = window.innerWidth - clientX - 18
      setRightPanelWidth(clampRightPanelWidth(computedWidth))
    }

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      updateWidth(mouseEvent.clientX)
    }

    const stopResizing = () => {
      rightPanelResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)
  }, [])

  const handleDismissWorldCardEvent = useCallback((eventId: number) => {
    setDismissedWorldCardEventIds((previousIds) => (previousIds.includes(eventId) ? previousIds : [...previousIds, eventId]))
  }, [])

  const handleToggleWorldCardEventExpanded = useCallback((eventId: number) => {
    setExpandedWorldCardEventIds((previousIds) =>
      previousIds.includes(eventId)
        ? previousIds.filter((value) => value !== eventId)
        : [...previousIds, eventId],
    )
  }, [])

  const handleUndoWorldCardEvent = useCallback(
    async (eventId: number) => {
      if (!activeGameId || undoingWorldCardEventIds.includes(eventId)) {
        return
      }

      setErrorMessage('')
      setUndoingWorldCardEventIds((previousIds) =>
        previousIds.includes(eventId) ? previousIds : [...previousIds, eventId],
      )
      try {
        await undoStoryWorldCardEvent({
          token: authToken,
          gameId: activeGameId,
          eventId,
        })
        await loadGameById(activeGameId, { silent: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось откатить изменение карточки'
        setErrorMessage(detail)
      } finally {
        setUndoingWorldCardEventIds((previousIds) => previousIds.filter((value) => value !== eventId))
      }
    },
    [activeGameId, authToken, loadGameById, undoingWorldCardEventIds],
  )

  const handleDismissPlotCardEvent = useCallback((eventId: number) => {
    setDismissedPlotCardEventIds((previousIds) => (previousIds.includes(eventId) ? previousIds : [...previousIds, eventId]))
  }, [])

  const handleTogglePlotCardEventExpanded = useCallback((eventId: number) => {
    setExpandedPlotCardEventIds((previousIds) =>
      previousIds.includes(eventId)
        ? previousIds.filter((value) => value !== eventId)
        : [...previousIds, eventId],
    )
  }, [])

  const handleUndoPlotCardEvent = useCallback(
    async (eventId: number) => {
      if (!activeGameId || undoingPlotCardEventIds.includes(eventId)) {
        return
      }

      setErrorMessage('')
      setUndoingPlotCardEventIds((previousIds) =>
        previousIds.includes(eventId) ? previousIds : [...previousIds, eventId],
      )
      try {
        await undoStoryPlotCardEvent({
          token: authToken,
          gameId: activeGameId,
          eventId,
        })
        await loadGameById(activeGameId, { silent: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось откатить изменение карточки сюжета'
        setErrorMessage(detail)
      } finally {
        setUndoingPlotCardEventIds((previousIds) => previousIds.filter((value) => value !== eventId))
      }
    },
    [activeGameId, authToken, loadGameById, undoingPlotCardEventIds],
  )

  const persistContextLimit = useCallback(
    async (nextValue: number) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingContextLimit ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingStorySampling ||
        isSavingAmbientEnabled
      ) {
        return
      }

      const normalizedValue = clampStoryContextLimit(nextValue)
      setContextLimitChars(normalizedValue)
      setContextLimitDraft(String(normalizedValue))
      setErrorMessage('')
      setIsSavingContextLimit(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          contextLimitTokens: normalizedValue,
        })
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить лимит контекста'
        setErrorMessage(detail)
      } finally {
        setIsSavingContextLimit(false)
      }
    },
    [
      activeGameId,
      authToken,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
    ],
  )

  const persistStoryResponseMaxTokens = useCallback(
    async (nextValue: number) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        !responseMaxTokensEnabled ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingStorySampling ||
        isSavingAmbientEnabled
      ) {
        return
      }

      const normalizedValue = clampStoryResponseMaxTokens(nextValue)
      setResponseMaxTokens(normalizedValue)
      setErrorMessage('')
      setIsSavingResponseMaxTokens(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          responseMaxTokens: normalizedValue,
          responseMaxTokensEnabled: true,
        })
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить лимит ответа ИИ'
        setErrorMessage(detail)
      } finally {
        setIsSavingResponseMaxTokens(false)
      }
    },
    [
      activeGameId,
      authToken,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
      responseMaxTokensEnabled,
    ],
  )

  const persistStoryNarratorModel = useCallback(
    async (nextModelId: StoryNarratorModelId) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingStoryLlmModel ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingMemoryOptimization ||
        isSavingStorySampling ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }

      const normalizedModel = normalizeStoryNarratorModelId(nextModelId)
      if (normalizedModel === storyLlmModel) {
        return
      }
      const previousMemoryOptimizationEnabled = memoryOptimizationEnabled
      const previousStoryTopK = storyTopK
      const previousStoryTopR = storyTopR
      const previousAmbientEnabled = ambientEnabled
      const previousResponseMaxTokens = responseMaxTokens
      const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
      setStoryLlmModel(normalizedModel)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          storyLlmModel: normalizedModel,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          memoryOptimizationEnabled: previousMemoryOptimizationEnabled,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          ambientEnabled: previousAmbientEnabled,
        },
      }))
      setErrorMessage('')
      setIsSavingStoryLlmModel(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          storyLlmModel: normalizedModel,
          contextLimitTokens: contextLimitChars,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          ambientEnabled: previousAmbientEnabled,
        })
        const persistedContextLimit = clampStoryContextLimit(updatedGame.context_limit_chars)
        setContextLimitChars(persistedContextLimit)
        setContextLimitDraft(String(persistedContextLimit))
        setStoryLlmModel(normalizedModel)
        setGames((previousGames) =>
          sortGamesByActivity(
            previousGames.map((game) =>
              game.id === updatedGame.id
                ? {
                    ...updatedGame,
                    story_llm_model: normalizedModel,
                    memory_optimization_enabled: previousMemoryOptimizationEnabled,
                    story_top_k: previousStoryTopK,
                    story_top_r: previousStoryTopR,
                  }
                : game,
            ),
          ),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить модель рассказчика'
        setErrorMessage(detail)
      } finally {
        setIsSavingStoryLlmModel(false)
      }
    },
    [
      activeGameId,
      authToken,
      isGenerating,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStorySampling,
      isSavingStoryLlmModel,
      contextLimitChars,
      responseMaxTokens,
      responseMaxTokensEnabled,
      memoryOptimizationEnabled,
      ambientEnabled,
      storyTopK,
      storyTopR,
      storyLlmModel,
    ],
  )

  const persistStoryImageModel = useCallback(
    async (nextModelId: StoryImageModelId) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingStoryImageModel ||
        isSavingImageStylePrompt ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingStorySampling ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }

      const normalizedModel = normalizeStoryImageModelId(nextModelId)
      if (normalizedModel === storyImageModel) {
        return
      }

      setStoryImageModel(normalizedModel)
      setErrorMessage('')
      setIsSavingStoryImageModel(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          imageModel: normalizedModel,
        })
        const persistedModel = normalizeStoryImageModelId(updatedGame.image_model)
        if (activeGameIdRef.current === updatedGame.id) {
          setStoryImageModel(persistedModel)
        }
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить модель генерации изображения'
        setErrorMessage(detail)
      } finally {
        setIsSavingStoryImageModel(false)
      }
    },
    [
      activeGameId,
      authToken,
      isGenerating,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingImageStylePrompt,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryImageModel,
      isSavingStoryLlmModel,
      isSavingStorySampling,
      storyImageModel,
    ],
  )

  const persistImageStylePrompt = useCallback(
    async (nextValue: string) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingImageStylePrompt ||
        isSavingStoryImageModel ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingStorySampling ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }

      const normalizedValue = normalizeStoryImageStylePrompt(nextValue)
      const persistedValue = imageStylePromptByGameRef.current[targetGameId] ?? ''
      setImageStylePromptDraft(normalizedValue)
      if (normalizedValue === persistedValue) {
        return
      }

      setErrorMessage('')
      setIsSavingImageStylePrompt(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          imageStylePrompt: normalizedValue,
        })
        const persistedStylePrompt = normalizeStoryImageStylePrompt(updatedGame.image_style_prompt)
        imageStylePromptByGameRef.current[updatedGame.id] = persistedStylePrompt
        if (activeGameIdRef.current === updatedGame.id) {
          setImageStylePromptDraft(persistedStylePrompt)
        }
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить стиль изображения'
        setErrorMessage(detail)
      } finally {
        setIsSavingImageStylePrompt(false)
      }
    },
    [
      activeGameId,
      authToken,
      isGenerating,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingImageStylePrompt,
      isSavingStoryImageModel,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
    ],
  )

  const handleImageStylePromptCommit = useCallback(async () => {
    await persistImageStylePrompt(imageStylePromptDraft)
  }, [imageStylePromptDraft, persistImageStylePrompt])

  const toggleMemoryOptimization = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingMemoryOptimization ||
      isSavingResponseMaxTokens ||
      isSavingResponseMaxTokensEnabled ||
      isSavingContextLimit ||
      isSavingStoryLlmModel ||
      isSavingStorySampling ||
      isSavingAmbientEnabled ||
      isGenerating
    ) {
      return
    }

    const nextValue = !memoryOptimizationEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
    setMemoryOptimizationEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: nextValue,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        ambientEnabled: previousAmbientEnabled,
      },
    }))
    setErrorMessage('')
    setIsSavingMemoryOptimization(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        memoryOptimizationEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        ambientEnabled: previousAmbientEnabled,
      })
      const persistedContextLimit = clampStoryContextLimit(updatedGame.context_limit_chars)
      setContextLimitChars(persistedContextLimit)
      setContextLimitDraft(String(persistedContextLimit))
      setMemoryOptimizationEnabled(nextValue)
      setGames((previousGames) =>
        sortGamesByActivity(
          previousGames.map((game) =>
            game.id === updatedGame.id
              ? {
                  ...updatedGame,
                  story_llm_model: previousStoryLlmModel,
                  memory_optimization_enabled: nextValue,
                  story_top_k: previousStoryTopK,
                  story_top_r: previousStoryTopR,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить оптимизацию памяти'
      setErrorMessage(detail)
    } finally {
      setIsSavingMemoryOptimization(false)
    }
  }, [
    activeGameId,
    authToken,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingMemoryOptimization,
    isSavingResponseMaxTokens,
    isSavingResponseMaxTokensEnabled,
    isSavingStorySampling,
    isSavingStoryLlmModel,
    contextLimitChars,
    responseMaxTokens,
    responseMaxTokensEnabled,
    memoryOptimizationEnabled,
    ambientEnabled,
    storyTopK,
    storyTopR,
    storyLlmModel,
  ])

  const toggleAmbientEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingAmbientEnabled ||
      isSavingResponseMaxTokens ||
      isSavingResponseMaxTokensEnabled ||
      isSavingContextLimit ||
      isSavingStoryLlmModel ||
      isSavingMemoryOptimization ||
      isSavingStorySampling ||
      isGenerating
    ) {
      return
    }

    const nextValue = !ambientEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
    setAmbientEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        ambientEnabled: nextValue,
      },
    }))
    setErrorMessage('')
    setIsSavingAmbientEnabled(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        ambientEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
      })
      setAmbientEnabled(nextValue)
      setGames((previousGames) =>
        sortGamesByActivity(
          previousGames.map((game) =>
            game.id === updatedGame.id
              ? {
                  ...updatedGame,
                  story_llm_model: previousStoryLlmModel,
                  memory_optimization_enabled: previousMemoryOptimization,
                  story_top_k: previousStoryTopK,
                  story_top_r: previousStoryTopR,
                  ambient_enabled: nextValue,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить эмбиент подсветку'
      setErrorMessage(detail)
    } finally {
      setIsSavingAmbientEnabled(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    contextLimitChars,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingMemoryOptimization,
    isSavingResponseMaxTokens,
    isSavingResponseMaxTokensEnabled,
    isSavingStoryLlmModel,
    isSavingStorySampling,
    memoryOptimizationEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    storyTopK,
    storyTopR,
    storyLlmModel,
  ])

  const toggleResponseMaxTokensEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingResponseMaxTokensEnabled ||
      isSavingResponseMaxTokens ||
      isSavingContextLimit ||
      isSavingStoryLlmModel ||
      isSavingMemoryOptimization ||
      isSavingStorySampling ||
      isSavingAmbientEnabled ||
      isGenerating
    ) {
      return
    }

    const nextValue = !responseMaxTokensEnabled
    const normalizedResponseMaxTokens = clampStoryResponseMaxTokens(responseMaxTokens)
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousAmbientEnabled = ambientEnabled
    setResponseMaxTokensEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: normalizedResponseMaxTokens,
        responseMaxTokensEnabled: nextValue,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        ambientEnabled: previousAmbientEnabled,
      },
    }))
    setErrorMessage('')
    setIsSavingResponseMaxTokensEnabled(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        responseMaxTokensEnabled: nextValue,
        responseMaxTokens: normalizedResponseMaxTokens,
      })
      setResponseMaxTokensEnabled(nextValue)
      setResponseMaxTokens(clampStoryResponseMaxTokens(updatedGame.response_max_tokens))
      setGames((previousGames) =>
        sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить режим лимита ответа ИИ'
      setErrorMessage(detail)
    } finally {
      setIsSavingResponseMaxTokensEnabled(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingMemoryOptimization,
    isSavingResponseMaxTokens,
    isSavingResponseMaxTokensEnabled,
    isSavingStoryLlmModel,
    isSavingStorySampling,
    memoryOptimizationEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    storyTopK,
    storyTopR,
    storyLlmModel,
  ])

  const handleResponseMaxTokensSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setResponseMaxTokens(clampStoryResponseMaxTokens(rawValue))
  }, [])

  const handleResponseMaxTokensSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStoryResponseMaxTokens(rawValue)
    },
    [persistStoryResponseMaxTokens],
  )

  const handleContextLimitSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    const normalizedValue = clampStoryContextLimit(rawValue)
    setContextLimitChars(normalizedValue)
    setContextLimitDraft(String(normalizedValue))
  }, [])

  const handleContextLimitSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistContextLimit(rawValue)
    },
    [persistContextLimit],
  )

  const handleContextLimitDraftChange = useCallback((value: string) => {
    const sanitized = value.replace(/[^\d]/g, '')
    setContextLimitDraft(sanitized)
    if (!sanitized) {
      return
    }
    const parsed = Number.parseInt(sanitized, 10)
    if (Number.isNaN(parsed)) {
      return
    }
    setContextLimitChars(clampStoryContextLimit(parsed))
  }, [])

  const handleImageStylePromptDraftChange = useCallback((value: string) => {
    setImageStylePromptDraft(sanitizeStoryImageStylePromptDraft(value))
  }, [])

  const handleContextLimitDraftCommit = useCallback(async () => {
    if (!contextLimitDraft.trim()) {
      const normalized = clampStoryContextLimit(contextLimitChars)
      setContextLimitDraft(String(normalized))
      await persistContextLimit(normalized)
      return
    }

    const parsed = Number.parseInt(contextLimitDraft, 10)
    const normalized = clampStoryContextLimit(Number.isNaN(parsed) ? contextLimitChars : parsed)
    setContextLimitChars(normalized)
    setContextLimitDraft(String(normalized))
    await persistContextLimit(normalized)
  }, [contextLimitChars, contextLimitDraft, persistContextLimit])

  const persistStorySamplingSettings = useCallback(
    async (nextTopK: number, nextTopR: number) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingStorySampling ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }
      const normalizedTopK = clampStoryTopK(nextTopK)
      const normalizedTopR = clampStoryTopR(nextTopR)
      const normalizedStoryModel = storyLlmModel
      const normalizedMemoryOptimization = memoryOptimizationEnabled
      const normalizedAmbientEnabled = ambientEnabled
      const normalizedResponseMaxTokens = responseMaxTokens
      const normalizedResponseMaxTokensEnabled = responseMaxTokensEnabled
      setStoryTopK(normalizedTopK)
      setStoryTopR(normalizedTopR)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          storyLlmModel: normalizedStoryModel,
          responseMaxTokens: normalizedResponseMaxTokens,
          responseMaxTokensEnabled: normalizedResponseMaxTokensEnabled,
          memoryOptimizationEnabled: normalizedMemoryOptimization,
          storyTopK: normalizedTopK,
          storyTopR: normalizedTopR,
          ambientEnabled: normalizedAmbientEnabled,
        },
      }))
      setErrorMessage('')
      setIsSavingStorySampling(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          storyTopK: normalizedTopK,
          storyTopR: normalizedTopR,
          responseMaxTokens: normalizedResponseMaxTokens,
          responseMaxTokensEnabled: normalizedResponseMaxTokensEnabled,
          ambientEnabled: normalizedAmbientEnabled,
        })
        setGames((previousGames) =>
          sortGamesByActivity(
            previousGames.map((game) =>
              game.id === updatedGame.id
                ? {
                    ...updatedGame,
                    story_llm_model: normalizedStoryModel,
                    memory_optimization_enabled: normalizedMemoryOptimization,
                    story_top_k: normalizedTopK,
                    story_top_r: normalizedTopR,
                  }
                : game,
            ),
          ),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить температуру'
        setErrorMessage(detail)
      } finally {
        setIsSavingStorySampling(false)
      }
    },
    [
      activeGameId,
      authToken,
      isGenerating,
      isSavingAmbientEnabled,
      isSavingContextLimit,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
      memoryOptimizationEnabled,
      ambientEnabled,
      responseMaxTokens,
      responseMaxTokensEnabled,
      storyLlmModel,
    ],
  )

  const handleStoryTopKSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopK(clampStoryTopK(rawValue))
  }, [])

  const handleStoryTopKSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(rawValue, storyTopR)
    },
    [persistStorySamplingSettings, storyTopR],
  )

  const handleStoryTopRSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopR(clampStoryTopR(rawValue))
  }, [])

  const handleStoryTopRSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTopK, rawValue)
    },
    [persistStorySamplingSettings, storyTopK],
  )

  const handleResetStorySampling = useCallback(async () => {
    await persistStorySamplingSettings(STORY_DEFAULT_TOP_K, STORY_DEFAULT_TOP_R)
  }, [persistStorySamplingSettings])

  const handleToggleTurnImageGeneration = useCallback(() => {
    setIsTurnImageGenerationEnabled((previousValue) => {
      const nextValue = !previousValue
      localStorage.setItem(STORY_TURN_IMAGE_TOGGLE_STORAGE_KEY, nextValue ? '1' : '0')
      if (!nextValue) {
        turnImageAbortControllersRef.current.forEach((controller) => controller.abort())
        turnImageAbortControllersRef.current.clear()
        setTurnImageByAssistantMessageId((previousState) => {
          const nextState: Record<number, StoryTurnImageEntry[]> = {}
          Object.entries(previousState).forEach(([assistantMessageIdRaw, entries]) => {
            const assistantMessageId = Number(assistantMessageIdRaw)
            if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) {
              return
            }
            const persistedEntries = entries.filter((entry) => entry.status !== 'loading')
            if (persistedEntries.length > 0) {
              nextState[assistantMessageId] = persistedEntries
            }
          })
          return nextState
        })
      }
      return nextValue
    })
  }, [])

  const clearTurnImageEntries = useCallback((assistantMessageIds: number[]) => {
    if (!assistantMessageIds.length) {
      return
    }
    const uniqueIds = Array.from(new Set(assistantMessageIds.filter((id) => Number.isInteger(id) && id > 0)))
    if (!uniqueIds.length) {
      return
    }

    setTurnImageByAssistantMessageId((previousState) => {
      let nextState: Record<number, StoryTurnImageEntry[]> | null = null
      for (const assistantMessageId of uniqueIds) {
        if (!(assistantMessageId in previousState)) {
          continue
        }
        if (nextState === null) {
          nextState = { ...previousState }
        }
        delete nextState[assistantMessageId]
      }
      return nextState ?? previousState
    })

    for (const assistantMessageId of uniqueIds) {
      const controller = turnImageAbortControllersRef.current.get(assistantMessageId)
      if (!controller) {
        continue
      }
      controller.abort()
      turnImageAbortControllersRef.current.delete(assistantMessageId)
    }
  }, [])

  const generateTurnImageAfterAssistantMessage = useCallback(
    async (options: { gameId: number; assistantMessageId: number }) => {
      turnImageAbortControllersRef.current.get(options.assistantMessageId)?.abort()
      const requestController = new AbortController()
      turnImageAbortControllersRef.current.set(options.assistantMessageId, requestController)
      const loadingEntryId = -Math.abs(Date.now() + Math.floor(Math.random() * 1000))
      const loadingStartedAt = new Date().toISOString()
      const timeoutId = window.setTimeout(() => {
        requestController.abort()
      }, getStoryTurnImageRequestTimeoutMs(storyImageModel))

      setTurnImageByAssistantMessageId((previousState) => {
        const existingEntries = (previousState[options.assistantMessageId] ?? []).filter(
          (entry) => entry.status !== 'loading',
        )
        return {
          ...previousState,
          [options.assistantMessageId]: [
            ...existingEntries,
            {
              id: loadingEntryId,
              status: 'loading',
              imageUrl: null,
              prompt: null,
              error: null,
              createdAt: loadingStartedAt,
              updatedAt: loadingStartedAt,
            },
          ],
        }
      })
      try {
        const imagePayload = await generateStoryTurnImage({
          token: authToken,
          gameId: options.gameId,
          assistantMessageId: options.assistantMessageId,
          signal: requestController.signal,
        })
        const resolvedImageUrl = (imagePayload.image_data_url ?? imagePayload.image_url ?? '').trim()
        if (!resolvedImageUrl) {
          throw new Error('Image service returned an empty image payload')
        }
        if (imagePayload.user) {
          onUserUpdate(imagePayload.user)
        }
        if (turnImageAbortControllersRef.current.get(options.assistantMessageId) !== requestController) {
          return
        }

        const persistedEntryId =
          Number.isInteger(imagePayload.id) && imagePayload.id > 0 ? imagePayload.id : Math.abs(loadingEntryId)
        const resolvedAt = new Date().toISOString()
        setTurnImageByAssistantMessageId((previousState) => {
          const existingEntries = previousState[options.assistantMessageId]
          if (!existingEntries?.length) {
            return previousState
          }
          let hasUpdatedEntry = false
          const nextEntries = existingEntries.map((entry) => {
            if (entry.id !== loadingEntryId) {
              return entry
            }
            hasUpdatedEntry = true
            return {
              ...entry,
              id: persistedEntryId,
              status: 'ready' as const,
              imageUrl: resolvedImageUrl,
              prompt: imagePayload.prompt ?? null,
              error: null,
              updatedAt: resolvedAt,
            }
          })
          if (!hasUpdatedEntry) {
            nextEntries.push({
              id: persistedEntryId,
              status: 'ready',
              imageUrl: resolvedImageUrl,
              prompt: imagePayload.prompt ?? null,
              error: null,
              createdAt: resolvedAt,
              updatedAt: resolvedAt,
            })
          }
          return {
            ...previousState,
            [options.assistantMessageId]: nextEntries,
          }
        })
      } catch (error) {
        if (turnImageAbortControllersRef.current.get(options.assistantMessageId) !== requestController) {
          return
        }
        const detail =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Генерация изображения заняла слишком много времени. Попробуйте еще раз.'
            : error instanceof Error
              ? error.message
              : 'Failed to generate image'
        const resolvedAt = new Date().toISOString()
        setTurnImageByAssistantMessageId((previousState) => {
          const existingEntries = previousState[options.assistantMessageId] ?? []
          let hasUpdatedEntry = false
          const nextEntries = existingEntries.map((entry) => {
            if (entry.id !== loadingEntryId) {
              return entry
            }
            hasUpdatedEntry = true
            return {
              ...entry,
              status: 'error' as const,
              imageUrl: null,
              prompt: null,
              error: detail,
              updatedAt: resolvedAt,
            }
          })
          if (!hasUpdatedEntry) {
            nextEntries.push({
              id: loadingEntryId,
              status: 'error',
              imageUrl: null,
              prompt: null,
              error: detail,
              createdAt: resolvedAt,
              updatedAt: resolvedAt,
            })
          }
          return {
            ...previousState,
            [options.assistantMessageId]: nextEntries,
          }
        })
      } finally {
        window.clearTimeout(timeoutId)
        if (turnImageAbortControllersRef.current.get(options.assistantMessageId) === requestController) {
          turnImageAbortControllersRef.current.delete(options.assistantMessageId)
        }
      }
    },
    [authToken, onUserUpdate, storyImageModel],
  )

  useEffect(() => {
    const assistantMessageIds = new Set(
      messages
        .filter((message) => message.role === 'assistant' && message.id > 0)
        .map((message) => message.id),
    )
    const staleAssistantMessageIds = Object.keys(turnImageByAssistantMessageId)
      .map((value) => Number(value))
      .filter((assistantMessageId) => Number.isInteger(assistantMessageId) && assistantMessageId > 0 && !assistantMessageIds.has(assistantMessageId))
    if (!staleAssistantMessageIds.length) {
      return
    }
    clearTurnImageEntries(staleAssistantMessageIds)
  }, [clearTurnImageEntries, messages, turnImageByAssistantMessageId])

  const runStoryGeneration = useCallback(
    async (options: {
      gameId: number
      prompt?: string
      rerollLastResponse?: boolean
      discardLastAssistantSteps?: number
      instructionCards?: StoryInstructionCard[]
    }) => {
      setErrorMessage('')
      setIsGenerating(true)
      setActiveAssistantMessageId(null)
      const controller = new AbortController()
      generationAbortRef.current = controller
      let wasAborted = false
      let streamStarted = false
      let generationFailed = false
      let postprocessPending = false

      try {
        await generateStoryResponseStream({
          token: authToken,
          gameId: options.gameId,
          prompt: options.prompt,
          rerollLastResponse: options.rerollLastResponse,
          discardLastAssistantSteps: options.discardLastAssistantSteps,
          instructions: (options.instructionCards ?? [])
            .map((card) => ({
              title: card.title.replace(/\s+/g, ' ').trim(),
              content: card.content.replace(/\r\n/g, '\n').trim(),
            }))
            .filter((card) => card.title.length > 0 && card.content.length > 0),
          storyLlmModel,
          responseMaxTokens: responseMaxTokensEnabled ? responseMaxTokens : undefined,
          memoryOptimizationEnabled,
          storyTopK,
          storyTopR,
          ambientEnabled,
          signal: controller.signal,
          onStart: (payload) => {
            streamStarted = true
            setActiveAssistantMessageId(payload.assistant_message_id)
            setMessages((previousMessages) => {
              const nextMessages = [...previousMessages]
              if (payload.user_message_id !== null) {
                const firstTempUserIndex = nextMessages.findIndex((message) => message.id < 0 && message.role === 'user')
                if (firstTempUserIndex >= 0) {
                  nextMessages[firstTempUserIndex] = {
                    ...nextMessages[firstTempUserIndex],
                    id: payload.user_message_id,
                  }
                }
              }
              if (!nextMessages.some((message) => message.id === payload.assistant_message_id)) {
                const now = new Date().toISOString()
                nextMessages.push({
                  id: payload.assistant_message_id,
                  game_id: options.gameId,
                  role: 'assistant',
                  content: '',
                  created_at: now,
                  updated_at: now,
                })
              }
              return nextMessages
            })
          },
          onChunk: (payload) => {
            const now = new Date().toISOString()
            setMessages((previousMessages) => {
              const lastIndex = previousMessages.length - 1
              if (lastIndex >= 0 && previousMessages[lastIndex].id === payload.assistant_message_id) {
                const nextMessages = [...previousMessages]
                const targetMessage = nextMessages[lastIndex]
                nextMessages[lastIndex] = {
                  ...targetMessage,
                  content: `${targetMessage.content}${payload.delta}`,
                  updated_at: now,
                }
                return nextMessages
              }

              const targetIndex = previousMessages.findIndex((message) => message.id === payload.assistant_message_id)
              if (targetIndex < 0) {
                return previousMessages
              }

              const nextMessages = [...previousMessages]
              const targetMessage = nextMessages[targetIndex]
              nextMessages[targetIndex] = {
                ...targetMessage,
                content: `${targetMessage.content}${payload.delta}`,
                updated_at: now,
              }
              return nextMessages
            })
          },
          onDone: (payload) => {
            if (payload.user) {
              onUserUpdate(payload.user)
            }
            postprocessPending = Boolean(payload.postprocess_pending)
            if (payload.ambient) {
              const normalizedAmbient = normalizeStoryAmbientProfile(payload.ambient)
              setPersistedAmbientProfile(normalizedAmbient)
              setAmbientByAssistantMessageId((previousMap) => ({
                ...previousMap,
                [payload.message.id]: normalizedAmbient,
              }))
              setGames((previousGames) =>
                sortGamesByActivity(
                  previousGames.map((game) =>
                    game.id === options.gameId
                      ? {
                          ...game,
                          ambient_profile: normalizedAmbient,
                        }
                      : game,
                  ),
                ),
              )
            }
            setMessages((previousMessages) => {
              const targetIndex = previousMessages.findIndex((message) => message.id === payload.message.id)
              if (targetIndex < 0) {
                return previousMessages
              }
              const nextMessages = [...previousMessages]
              nextMessages[targetIndex] = payload.message
              return nextMessages
            })
            if (isTurnImageGenerationEnabled && payload.message.id > 0) {
              window.setTimeout(() => {
                void generateTurnImageAfterAssistantMessage({
                  gameId: options.gameId,
                  assistantMessageId: payload.message.id,
                }).catch((error) => {
                  console.error('Turn image generation start failed', error)
                })
              }, 0)
            }
          },
        })
      } catch (error) {
        if (controller.signal.aborted) {
          wasAborted = true
        } else {
          generationFailed = true
          const detail = error instanceof Error ? error.message : 'Не удалось сгенерировать ответ'
          if (/недостаточно (?:токенов|солов)/i.test(detail)) {
            setInputValue('')
            setTopUpError('')
            setTopUpDialogOpen(true)
            setProfileDialogOpen(false)
            setConfirmLogoutOpen(false)
          } else {
            setErrorMessage(detail)
          }
        }
      } finally {
        setIsGenerating(false)
        setActiveAssistantMessageId(null)
        generationAbortRef.current = null

        if (wasAborted && streamStarted) {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 700)
          })
        }

        await loadGameById(options.gameId, { silent: true })
        try {
          const refreshedGames = await listStoryGames(authToken)
          setGames(sortGamesByActivity(refreshedGames))
        } catch {
          // Keep current games if refresh failed.
        }

        if (postprocessPending) {
          void (async () => {
            const maxAttempts = 20
            const delayMs = 3000
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
              await new Promise<void>((resolve) => {
                window.setTimeout(resolve, delayMs)
              })
              if (activeGameIdRef.current !== options.gameId) {
                break
              }
              if (generationAbortRef.current !== null) {
                // Another generation started; stop background sync loop.
                break
              }
              try {
                await loadGameById(options.gameId, { silent: true })
                const refreshedGames = await listStoryGames(authToken)
                setGames(sortGamesByActivity(refreshedGames))
              } catch {
                // Ignore background sync errors; next attempt may succeed.
              }
            }
          })()
        }
      }

      return {
        streamStarted,
        failed: generationFailed,
        aborted: wasAborted,
      }
    },
    [
      ambientEnabled,
      authToken,
      generateTurnImageAfterAssistantMessage,
      isTurnImageGenerationEnabled,
      loadGameById,
      memoryOptimizationEnabled,
      onUserUpdate,
      responseMaxTokensEnabled,
      responseMaxTokens,
      storyLlmModel,
      storyTopK,
      storyTopR,
    ],
  )

  const handleSendPrompt = useCallback(async () => {
    if (isGenerating) {
      return
    }

    if (hasInsufficientTokensForTurn) {
      setInputValue('')
      setErrorMessage(`Недостаточно солов для хода: нужно ${currentTurnCostTokens}.`)
      setTopUpError('')
      setTopUpDialogOpen(true)
      setProfileDialogOpen(false)
      setConfirmLogoutOpen(false)
      return
    }

    const normalizedPrompt = inputValue.replace(/\r\n/g, '\n').trim()
    if (!normalizedPrompt) {
      return
    }

    let targetGameId = activeGameId
    if (!targetGameId) {
      try {
        setIsCreatingGame(true)
        const newGame = await createStoryGame({ token: authToken })
        setGames((previousGames) =>
          sortGamesByActivity([newGame, ...previousGames.filter((game) => game.id !== newGame.id)]),
        )
        setActiveGameId(newGame.id)
        applyStoryGameSettings(newGame)
        setInstructionCards([])
        setPlotCards([])
        setWorldCards([])
        applyPlotCardEvents([])
        applyWorldCardEvents([])
        onNavigate(`/home/${newGame.id}`)
        targetGameId = newGame.id
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
        setErrorMessage(detail)

        return
      }
    }

    if (!targetGameId) {
      return
    }

    const now = new Date().toISOString()
    const temporaryUserMessageId = -Date.now()
    setMessages((previousMessages) => [
      ...previousMessages,
      {
        id: temporaryUserMessageId,
        game_id: targetGameId,
        role: 'user',
        content: normalizedPrompt,
        created_at: now,
        updated_at: now,
      },
    ])
    setInputValue('')
    await runStoryGeneration({
      gameId: targetGameId,
      prompt: normalizedPrompt,
      instructionCards,
    })
  }, [activeGameId, applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken, currentTurnCostTokens, hasInsufficientTokensForTurn, inputValue, instructionCards, isGenerating, onNavigate, runStoryGeneration])

  const handleUndoAssistantStep = useCallback(async () => {
    if (!activeGameId || !canUndoAssistantStep || isUndoingAssistantStep) {
      return
    }

    setErrorMessage('')
    setIsUndoingAssistantStep(true)
    try {
      await undoStoryAssistantStep({
        token: authToken,
        gameId: activeGameId,
      })
      await loadGameById(activeGameId, { silent: true })
      try {
        const refreshedGames = await listStoryGames(authToken)
        setGames(sortGamesByActivity(refreshedGames))
      } catch {
        // Keep current list if refresh failed.
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось выполнить откат'
      setErrorMessage(detail)
    } finally {
      setIsUndoingAssistantStep(false)
    }
  }, [activeGameId, authToken, canUndoAssistantStep, isUndoingAssistantStep, loadGameById])

  const handleRedoAssistantStep = useCallback(async () => {
    if (!activeGameId || !canRedoAssistantStep || isUndoingAssistantStep) {
      return
    }

    setErrorMessage('')
    setIsUndoingAssistantStep(true)
    try {
      await redoStoryAssistantStep({
        token: authToken,
        gameId: activeGameId,
      })
      await loadGameById(activeGameId, { silent: true })
      try {
        const refreshedGames = await listStoryGames(authToken)
        setGames(sortGamesByActivity(refreshedGames))
      } catch {
        // Keep current list if refresh failed.
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось выполнить возврат'
      setErrorMessage(detail)
    } finally {
      setIsUndoingAssistantStep(false)
    }
  }, [activeGameId, authToken, canRedoAssistantStep, isUndoingAssistantStep, loadGameById])

  const handleStopGeneration = useCallback(() => {
    generationAbortRef.current?.abort()
  }, [])

  const handleRerollLastResponse = useCallback(async () => {
    if (!canReroll || !activeGameId) {
      return
    }

    if (hasInsufficientTokensForTurn) {
      setInputValue('')
      setErrorMessage(`Недостаточно солов для хода: нужно ${currentTurnCostTokens}.`)
      setTopUpError('')
      setTopUpDialogOpen(true)
      setProfileDialogOpen(false)
      setConfirmLogoutOpen(false)
      return
    }

    if (hasUndoneAssistantSteps) {
      setErrorMessage('Сначала верните откатанные ответы кнопкой вперед или обновите игру.')
      return
    }

    setErrorMessage('')

    const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!lastAssistantMessage) {
      return
    }

    const relatedPlotEvents = plotCardEvents
      .filter((event) => event.assistant_message_id === lastAssistantMessage.id)
      .sort((left, right) => left.id - right.id)
    const relatedWorldEvents = worldCardEvents
      .filter((event) => event.assistant_message_id === lastAssistantMessage.id)
      .sort((left, right) => left.id - right.id)
    const remainingPlotEvents = plotCardEvents.filter((event) => event.assistant_message_id !== lastAssistantMessage.id)
    const remainingWorldEvents = worldCardEvents.filter((event) => event.assistant_message_id !== lastAssistantMessage.id)

    setMessages((previousMessages) => previousMessages.filter((message) => message.id !== lastAssistantMessage.id))
    clearTurnImageEntries([lastAssistantMessage.id])
    setPlotCards((previousCards) => rollbackPlotCardsByEvents(previousCards, relatedPlotEvents, activeGameId))
    setWorldCards((previousCards) => rollbackWorldCardsByEvents(previousCards, relatedWorldEvents, activeGameId))
    applyPlotCardEvents(remainingPlotEvents)
    applyWorldCardEvents(remainingWorldEvents)

    const generationResult = await runStoryGeneration({
      gameId: activeGameId,
      rerollLastResponse: true,
      instructionCards,
    })

    if (generationResult.failed && !generationResult.streamStarted) {
      setMessages((previousMessages) => {
        if (previousMessages.some((message) => message.id === lastAssistantMessage.id)) {
          return previousMessages
        }
        return [...previousMessages, lastAssistantMessage].sort((left, right) => left.id - right.id)
      })
      setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, relatedPlotEvents, activeGameId))
      setWorldCards((previousCards) => reapplyWorldCardsByEvents(previousCards, relatedWorldEvents, activeGameId))
      applyPlotCardEvents(mergePlotEvents(remainingPlotEvents, relatedPlotEvents))
      applyWorldCardEvents(mergeWorldEvents(remainingWorldEvents, relatedWorldEvents))
    }
  }, [
    activeGameId,
    applyPlotCardEvents,
    applyWorldCardEvents,
    canReroll,
    clearTurnImageEntries,
    currentTurnCostTokens,
    hasInsufficientTokensForTurn,
    hasUndoneAssistantSteps,
    instructionCards,
    messages,
    plotCardEvents,
    runStoryGeneration,
    worldCardEvents,
  ])

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setAvatarCropSource(null)
    setAvatarError('')
  }

  const handleCloseTopUpDialog = () => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }

  const handleOpenTopUpDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpError('')
    setTopUpDialogOpen(true)
  }

  const handleOpenInstructionTemplateManager = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpDialogOpen(false)
    setInstructionTemplateDialogMode('manage')
    setInstructionTemplateDialogOpen(true)
  }

  const handleChooseAvatar = () => {
    if (isAvatarSaving) {
      return
    }
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    if (selectedFile.size > AVATAR_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось подготовить изображение'
      setAvatarError(detail)
    }
  }

  const handleSaveCroppedAvatar = async (croppedDataUrl: string) => {
    if (isAvatarSaving) {
      return
    }

    setAvatarError('')
    setIsAvatarSaving(true)
    try {
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: croppedDataUrl,
        avatar_scale: 1,
      })
      onUserUpdate(updatedUser)
      setAvatarCropSource(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleUpdateProfileName = useCallback(
    async (nextName: string) => {
      const updatedUser = await updateCurrentUserProfile({
        token: authToken,
        display_name: nextName,
      })
      onUserUpdate(updatedUser)
    },
    [authToken, onUserUpdate],
  )

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить тарифы пополнения'
      setTopUpError(detail)
    } finally {
      setIsTopUpPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!topUpDialogOpen || hasTopUpPlansLoaded || isTopUpPlansLoading) {
      return
    }
    void loadTopUpPlans()
  }, [hasTopUpPlansLoaded, isTopUpPlansLoading, loadTopUpPlans, topUpDialogOpen])

  const syncPendingPayment = useCallback(
    async (paymentId: string) => {
      try {
        const response = await syncCoinTopUpPayment({
          token: authToken,
          payment_id: paymentId,
        })

        onUserUpdate(response.user)
        if (response.status === 'succeeded') {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
          setPaymentSuccessCoins(response.coins)
          return
        }

        if (FINAL_PAYMENT_STATUSES.has(response.status)) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to sync payment status'
        if (detail.includes('404')) {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
        }
      }
    },
    [authToken, onUserUpdate],
  )

  useEffect(() => {
    const pendingPaymentId = localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY)
    if (!pendingPaymentId) {
      return
    }
    void syncPendingPayment(pendingPaymentId)
  }, [syncPendingPayment])

  const handlePurchasePlan = async (planId: string) => {
    setTopUpError('')
    setActivePlanPurchaseId(planId)
    try {
      const response = await createCoinTopUpPayment({
        token: authToken,
        plan_id: planId,
      })
      localStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, response.payment_id)
      window.location.assign(response.confirmation_url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать оплату'
      setTopUpError(detail)
      setActivePlanPurchaseId(null)
    }
  }

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setInstructionTemplateDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }

  const profileName = user.display_name || 'Игрок'

  return (
    <Box
      className="morius-app-shell"
      sx={{
        height: '100svh',
        color: 'var(--morius-text-primary)',
        background: 'var(--morius-app-bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'games-all', label: 'Комьюнити миры', isActive: false, onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen={isRightPanelOpen}
        onToggleRightPanel={() => setIsRightPanelOpen((previous) => !previous)}
        rightToggleLabels={{
          expanded: 'Свернуть правую панель',
          collapsed: 'Развернуть правую панель',
        }}
        onOpenTopUpDialog={handleOpenTopUpDialog}
        rightActionsWidth={220}
        rightActions={
          <Stack direction="row" sx={{ gap: 'var(--morius-icon-gap)' }}>
            <IconButton
              aria-label="Миры"
              onClick={() => setRightPanelMode('world')}
              sx={{
                width: 'var(--morius-action-size)',
                height: 'var(--morius-action-size)',
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${rightPanelMode === 'world' ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                backgroundColor: rightPanelMode === 'world' ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                color: rightPanelMode === 'world' ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
                '&:active': {
                  backgroundColor: 'var(--morius-button-active)',
                },
              }}
            >
              <Box
                component="img"
                src={icons.world}
                alt=""
                sx={{
                  width: 'var(--morius-action-icon-size)',
                  height: 'var(--morius-action-icon-size)',
                  opacity: rightPanelMode === 'world' ? 1 : 0.84,
                }}
              />
            </IconButton>
            <IconButton
              aria-label="ИИ"
              onClick={() => setRightPanelMode('ai')}
              sx={{
                width: 'var(--morius-action-size)',
                height: 'var(--morius-action-size)',
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${rightPanelMode === 'ai' ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                backgroundColor: rightPanelMode === 'ai' ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                color: rightPanelMode === 'ai' ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
                '&:active': {
                  backgroundColor: 'var(--morius-button-active)',
                },
              }}
            >
              <Box
                component="img"
                src={icons.ai}
                alt=""
                sx={{
                  width: 'var(--morius-action-icon-size)',
                  height: 'var(--morius-action-icon-size)',
                  opacity: rightPanelMode === 'ai' ? 1 : 0.84,
                }}
              />
            </IconButton>
            <Button
              variant="text"
              onClick={() => onNavigate('/profile')}
              sx={{
                minWidth: 0,
                width: HEADER_AVATAR_SIZE,
                height: HEADER_AVATAR_SIZE,
                p: 0,
                borderRadius: '50%',
              }}
            >
              <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
            </Button>
          </Stack>
        }
      />

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-menu-top)',
          right: 'var(--morius-interface-gap)',
          bottom: 'var(--morius-interface-gap)',
          width: { xs: 292, md: rightPanelWidth },
          zIndex: 25,
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          backgroundColor: 'var(--morius-card-bg)',
          transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + var(--morius-interface-gap)))',
          opacity: isRightPanelOpen ? 1 : 0,
          pointerEvents: isRightPanelOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 18px 40px rgba(0, 0, 0, 0.28)',
        }}
      >
        <Box
          onMouseDown={handleStartRightPanelResize}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            zIndex: 2,
            display: { xs: 'none', md: 'block' },
            '&:hover::after': {
              opacity: 1,
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 1,
              top: 12,
              bottom: 12,
              width: 2,
              borderRadius: '999px',
              backgroundColor: 'var(--morius-accent)',
              opacity: 0,
              transition: 'opacity 180ms ease',
            },
          }}
        />
        <Box sx={{ px: 'var(--morius-story-right-padding)', pt: 'var(--morius-story-right-padding)', borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              alignItems: 'center',
              gap: 0.2,
            }}
          >
            <Button
              onClick={() =>
                rightPanelMode === 'ai' ? setActiveAiPanelTab('instructions') : setActiveWorldPanelTab('story')
              }
              sx={{
                color: isLeftPanelTabActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                fontSize: 'var(--morius-body-size)',
                fontWeight: isLeftPanelTabActive ? 700 : 500,
                lineHeight: 1.1,
                textAlign: 'center',
                py: 0.65,
                minHeight: 0,
                borderRadius: 'var(--morius-radius)',
                textTransform: 'none',
                backgroundColor: 'transparent',
                border: 'none',
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
                '&:active': {
                  backgroundColor: 'var(--morius-button-active)',
                },
              }}
            >
              {leftPanelTabLabel}
            </Button>
            <Button
              onClick={() => (rightPanelMode === 'ai' ? setActiveAiPanelTab('settings') : setActiveWorldPanelTab('world'))}
              sx={{
                color: isLeftPanelTabActive ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)',
                fontSize: 'var(--morius-body-size)',
                fontWeight: isLeftPanelTabActive ? 500 : 700,
                lineHeight: 1.1,
                textAlign: 'center',
                py: 0.65,
                minHeight: 0,
                borderRadius: 'var(--morius-radius)',
                textTransform: 'none',
                backgroundColor: 'transparent',
                border: 'none',
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
                '&:active': {
                  backgroundColor: 'var(--morius-button-active)',
                },
              }}
            >
              {rightPanelTabLabel}
            </Button>
          </Box>
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: 2,
              backgroundColor: 'var(--morius-card-border)',
            }}
          >
            <Box
              sx={{
                width: '50%',
                height: '100%',
                backgroundColor: 'var(--morius-accent)',
                transform: isLeftPanelTabActive ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 220ms ease',
              }}
            />
          </Box>
        </Box>
        <Box
          sx={{
            p: 'var(--morius-story-right-padding)',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            '--morius-scrollbar-offset': '0px',
            '--morius-scrollbar-gutter': 'auto',
          }}
        >
          <Box
            key={rightPanelContentKey}
            className="morius-scrollbar"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--morius-story-right-padding)',
              minHeight: 0,
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              pr: 0,
              animation: 'morius-panel-content-enter 240ms cubic-bezier(0.22, 1, 0.36, 1)',
              '@keyframes morius-panel-content-enter': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
          {shouldShowRightPanelLoadingSkeleton ? <StoryRightPanelLoadingSkeleton /> : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'ai' && activeAiPanelTab === 'instructions' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {instructionCards.length === 0 ? (
                <>
                  <Stack spacing={0.75}>
                    <Button
                      onClick={handleOpenCreateInstructionDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 46,
                        borderRadius: '14px',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '1rem',
                        color: '#e3ebf8',
                        border: 'var(--morius-border-width) solid rgba(170, 194, 224, 0.46)',
                        background: 'linear-gradient(180deg, rgba(53, 64, 81, 0.94) 0%, rgba(39, 48, 63, 0.94) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(225, 235, 249, 0.08)',
                        '&:hover': {
                          background: 'linear-gradient(180deg, rgba(62, 74, 93, 0.98) 0%, rgba(46, 56, 73, 0.98) 100%)',
                        },
                        '&:active': {
                          transform: 'translateY(1px)',
                        },
                      }}
                    >
                      Добавить первую карточку
                    </Button>
                    <Button
                      onClick={handleOpenInstructionTemplateDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 46,
                        borderRadius: '14px',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '1rem',
                        color: '#dbe7f8',
                        border: 'var(--morius-border-width) solid rgba(146, 172, 205, 0.42)',
                        backgroundColor: 'rgba(31, 39, 52, 0.92)',
                        '&:hover': {
                          backgroundColor: 'rgba(40, 50, 65, 0.96)',
                        },
                        '&:active': {
                          transform: 'translateY(1px)',
                        },
                      }}
                    >
                      Из шаблона
                    </Button>
                  </Stack>
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                    Добавьте инструкции с нужным стилем истории. Они автоматически отправляются с каждым вашим сообщением.
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    className="morius-scrollbar"
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      pr: 0,
                    }}
                  >
                    <Stack spacing={0.85}>
                      {instructionCards.map((card) => (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            px: 'var(--morius-story-right-padding)',
                            py: 'var(--morius-story-right-padding)',
                            height: RIGHT_PANEL_CARD_HEIGHT,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.35}>
                            <Typography
                              sx={{
                                color: '#e2e8f3',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                lineHeight: 1.25,
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                            >
                              {card.title}
                            </Typography>
                            <Typography
                              sx={{
                                color: 'rgba(170, 238, 191, 0.96)',
                                fontSize: '0.66rem',
                                lineHeight: 1,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.48)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              активна
                            </Typography>
                            <IconButton
                              onClick={(event) => handleOpenCardMenu(event, 'instruction', card.id)}
                              disabled={isInstructionCardActionLocked}
                              sx={{
                                width: 22,
                                height: 22,
                                p: 0,
                                minWidth: 0,
                                color: 'rgba(208, 219, 235, 0.84)',
                                ml: 'auto',
                                backgroundColor: 'transparent !important',
                                border: 'none',
                                '&:hover': { backgroundColor: 'transparent !important' },
                                '&:active': { backgroundColor: 'transparent !important' },
                                '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                              }}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                            </IconButton>
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 6,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {card.content}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 0.75,
                      gridTemplateColumns: {
                        xs: '1fr',
                        md: 'repeat(2, minmax(0, 1fr))',
                      },
                    }}
                  >
                    <Button
                      onClick={handleOpenCreateInstructionDialog}
                      disabled={isGenerating || isSavingInstruction || deletingInstructionId !== null || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 40,
                        borderRadius: '12px',
                        textTransform: 'none',
                        color: '#d9dee8',
                        border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                      }}
                    >
                      Добавить карточку
                    </Button>
                    <Button
                      onClick={handleOpenInstructionTemplateDialog}
                      disabled={isGenerating || isSavingInstruction || deletingInstructionId !== null || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 40,
                        borderRadius: '12px',
                        textTransform: 'none',
                        color: '#d9dee8',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                      }}
                    >
                      Из шаблона
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'ai' && activeAiPanelTab === 'settings' ? (
            <Box
              sx={{
                px: 0,
                py: 0.2,
              }}
            >
              {!activeGameId ? (
                <Typography sx={{ mt: 0.85, color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.82rem' }}>
                  Настройка появится после создания игры.
                </Typography>
              ) : (
                <>
                  <Typography sx={{ mt: 0.95, color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>
                    Рассказчик
                  </Typography>
                  <FormControl fullWidth size="small" sx={{ mt: 0.72 }}>
                    <Select
                      value={storyLlmModel}
                      disabled={isSavingStorySettings || isGenerating}
                      onChange={(event: SelectChangeEvent<string>) => {
                        const nextModel = normalizeStoryNarratorModelId(event.target.value)
                        void persistStoryNarratorModel(nextModel)
                      }}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            mt: 0.45,
                            borderRadius: '12px',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-card-bg)',
                            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.42)',
                            '& .MuiMenuItem-root': {
                              color: 'var(--morius-text-primary)',
                              fontWeight: 600,
                              fontSize: '0.94rem',
                              minHeight: 40,
                            },
                            '& .MuiMenuItem-root:hover': {
                              backgroundColor: 'var(--morius-button-hover)',
                            },
                            '& .MuiMenuItem-root.Mui-selected': {
                              backgroundColor: 'var(--morius-button-active)',
                              color: 'var(--morius-title-text)',
                            },
                            '& .MuiMenuItem-root.Mui-selected:hover': {
                              backgroundColor: 'var(--morius-button-active)',
                            },
                          },
                        },
                      }}
                      sx={{
                        color: 'var(--morius-title-text)',
                        fontWeight: 700,
                        borderRadius: '12px',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        '& .MuiSelect-select': {
                          py: 0.88,
                        },
                        '& .MuiOutlinedInput-notchedOutline': {
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'var(--morius-accent)',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'var(--morius-accent)',
                        },
                        '& .MuiSelect-icon': {
                          color: 'var(--morius-text-secondary)',
                        },
                        '&.Mui-disabled .MuiSelect-select': {
                          WebkitTextFillColor: 'var(--morius-text-secondary)',
                        },
                      }}
                    >
                      {STORY_NARRATOR_MODEL_OPTIONS.map((option) => (
                        <MenuItem key={option.id} value={option.id}>
                          {option.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>
                      Художник
                    </Typography>
                    <FormControl fullWidth size="small" sx={{ mt: 0.72 }}>
                      <Select
                        value={storyImageModel}
                        disabled={isSavingStorySettings || isGenerating}
                        onChange={(event: SelectChangeEvent<string>) => {
                          const nextModel = normalizeStoryImageModelId(event.target.value)
                          void persistStoryImageModel(nextModel)
                        }}
                        MenuProps={{
                          PaperProps: {
                            sx: {
                              mt: 0.45,
                              borderRadius: '12px',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'var(--morius-card-bg)',
                              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.42)',
                              '& .MuiMenuItem-root': {
                                color: 'var(--morius-text-primary)',
                                fontWeight: 600,
                                fontSize: '0.94rem',
                                minHeight: 40,
                              },
                              '& .MuiMenuItem-root:hover': {
                                backgroundColor: 'var(--morius-button-hover)',
                              },
                              '& .MuiMenuItem-root.Mui-selected': {
                                backgroundColor: 'var(--morius-button-active)',
                                color: 'var(--morius-title-text)',
                              },
                              '& .MuiMenuItem-root.Mui-selected:hover': {
                                backgroundColor: 'var(--morius-button-active)',
                              },
                            },
                          },
                        }}
                        sx={{
                          color: 'var(--morius-title-text)',
                          fontWeight: 700,
                          borderRadius: '12px',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          '& .MuiSelect-select': {
                            py: 0.88,
                          },
                          '& .MuiOutlinedInput-notchedOutline': {
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          },
                          '&:hover .MuiOutlinedInput-notchedOutline': {
                            borderColor: 'var(--morius-accent)',
                          },
                          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                            borderColor: 'var(--morius-accent)',
                          },
                          '& .MuiSelect-icon': {
                            color: 'var(--morius-text-secondary)',
                          },
                          '&.Mui-disabled .MuiSelect-select': {
                            WebkitTextFillColor: 'var(--morius-text-secondary)',
                          },
                        }}
                      >
                        {STORY_IMAGE_MODEL_OPTIONS.map((option) => (
                          <MenuItem key={option.id} value={option.id}>
                            {option.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Box
                      component="input"
                      value={imageStylePromptDraft}
                      placeholder="Аниме стиль..."
                      maxLength={STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => handleImageStylePromptDraftChange(event.target.value)}
                      onBlur={() => {
                        void handleImageStylePromptCommit()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleImageStylePromptCommit()
                        }
                      }}
                      disabled={isSavingStorySettings || isGenerating}
                      sx={{
                        mt: 0.72,
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
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.44 }}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                        {imageStylePromptDraft.length}/{STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH}
                      </Typography>
                      <Stack direction="row" spacing={0.45} alignItems="center">
                        {isSavingStoryImageModel ? <CircularProgress size={13} sx={{ color: 'var(--morius-accent)' }} /> : null}
                        {isSavingImageStylePrompt ? <CircularProgress size={13} sx={{ color: 'var(--morius-accent)' }} /> : null}
                      </Stack>
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                        Лимит контекста
                      </Typography>
                      <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.84rem' }}>{contextLimitChars}</Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.78 }}>
                      <Box
                        component="input"
                        value={contextLimitDraft}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => handleContextLimitDraftChange(event.target.value)}
                        onBlur={() => {
                          void handleContextLimitDraftCommit()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleContextLimitDraftCommit()
                          }
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        inputMode="numeric"
                        sx={{
                          width: 92,
                          minHeight: 32,
                          borderRadius: '999px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          color: 'var(--morius-text-primary)',
                          px: 1,
                          outline: 'none',
                          fontSize: '0.84rem',
                        }}
                      />
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem' }}>Токенов</Typography>
                      {isSavingContextLimit ? <CircularProgress size={13} sx={{ color: 'var(--morius-accent)' }} /> : null}
                    </Stack>

                    <Slider
                      value={contextLimitChars}
                      min={STORY_CONTEXT_LIMIT_MIN}
                      max={STORY_CONTEXT_LIMIT_MAX}
                      step={1}
                      onChange={handleContextLimitSliderChange}
                      onChangeCommitted={(event, value) => {
                        void handleContextLimitSliderCommit(event, value)
                      }}
                      disabled={isSavingStorySettings || isGenerating}
                      sx={{
                        mt: 0.72,
                        color: 'var(--morius-accent)',
                        '& .MuiSlider-thumb': {
                          width: 16,
                          height: 16,
                          backgroundColor: 'var(--morius-title-text)',
                          border: '2px solid var(--morius-accent)',
                        },
                        '& .MuiSlider-rail': {
                          opacity: 1,
                          backgroundColor: 'var(--morius-card-border)',
                        },
                      }}
                    />

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.24 }}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                        {STORY_CONTEXT_LIMIT_MIN}
                      </Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                        {STORY_CONTEXT_LIMIT_MAX}
                      </Typography>
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                        Ответ ИИ в токенах
                      </Typography>
                      <Switch
                        checked={responseMaxTokensEnabled}
                        onChange={() => {
                          void toggleResponseMaxTokensEnabled()
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: 'var(--morius-accent)',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-button-active)',
                            opacity: 1,
                          },
                          '& .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-card-border)',
                            opacity: 1,
                          },
                        }}
                      />
                    </Stack>

                    <Box sx={{ mt: 0.86 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>
                          Лимит ответа
                        </Typography>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>{responseMaxTokens}</Typography>
                      </Stack>
                      <Slider
                        value={responseMaxTokens}
                        min={STORY_RESPONSE_MAX_TOKENS_MIN}
                        max={STORY_RESPONSE_MAX_TOKENS_MAX}
                        step={1}
                        onChange={handleResponseMaxTokensSliderChange}
                        onChangeCommitted={(event, value) => {
                          void handleResponseMaxTokensSliderCommit(event, value)
                        }}
                        disabled={!responseMaxTokensEnabled || isSavingStorySettings || isGenerating}
                        sx={{
                          mt: 0.42,
                          color: 'var(--morius-accent)',
                          '& .MuiSlider-thumb': {
                            width: 14,
                            height: 14,
                            backgroundColor: 'var(--morius-title-text)',
                            border: '2px solid var(--morius-accent)',
                          },
                          '& .MuiSlider-rail': {
                            opacity: 1,
                            backgroundColor: 'var(--morius-card-border)',
                          },
                        }}
                      />
                    </Box>

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.28 }}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                        {STORY_RESPONSE_MAX_TOKENS_MIN}
                      </Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>
                        {STORY_RESPONSE_MAX_TOKENS_MAX}
                      </Typography>
                    </Stack>

                    {isSavingResponseMaxTokens || isSavingResponseMaxTokensEnabled ? (
                      <CircularProgress size={14} sx={{ mt: 0.45, color: 'var(--morius-accent)' }} />
                    ) : null}
                  </Box>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                        Оптимизация памяти
                      </Typography>
                      <Switch
                        checked={memoryOptimizationEnabled}
                        onChange={() => {
                          void toggleMemoryOptimization()
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: 'var(--morius-accent)',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-button-active)',
                            opacity: 1,
                          },
                          '& .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-card-border)',
                            opacity: 1,
                          },
                        }}
                      />
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                        Эмбиент подсветка
                      </Typography>
                      <Switch
                        checked={ambientEnabled}
                        onChange={() => {
                          void toggleAmbientEnabled()
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: 'var(--morius-accent)',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-button-active)',
                            opacity: 1,
                          },
                          '& .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-card-border)',
                            opacity: 1,
                          },
                        }}
                      />
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      mt: 0.98,
                      pt: 0.9,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>
                        Температура
                      </Typography>
                      <Button
                        onClick={() => {
                          void handleResetStorySampling()
                        }}
                        disabled={isSavingStorySettings || isGenerating || (storyTopK === STORY_DEFAULT_TOP_K && storyTopR === STORY_DEFAULT_TOP_R)}
                        sx={{
                          minHeight: 30,
                          px: 1.1,
                          borderRadius: '999px',
                          textTransform: 'none',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          color: 'var(--morius-text-secondary)',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          '&:hover': {
                            backgroundColor: 'var(--morius-button-hover)',
                          },
                        }}
                      >
                        Сброс
                      </Button>
                    </Stack>

                    <Box sx={{ mt: 0.86 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>Топ-K</Typography>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>{storyTopK}</Typography>
                      </Stack>
                      <Slider
                        value={storyTopK}
                        min={STORY_TOP_K_MIN}
                        max={STORY_TOP_K_MAX}
                        step={1}
                        onChange={handleStoryTopKSliderChange}
                        onChangeCommitted={(event, value) => {
                          void handleStoryTopKSliderCommit(event, value)
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        sx={{
                          mt: 0.42,
                          color: 'var(--morius-accent)',
                          '& .MuiSlider-thumb': {
                            width: 14,
                            height: 14,
                            backgroundColor: 'var(--morius-title-text)',
                            border: '2px solid var(--morius-accent)',
                          },
                          '& .MuiSlider-rail': {
                            opacity: 1,
                            backgroundColor: 'var(--morius-card-border)',
                          },
                        }}
                      />
                    </Box>

                    <Box sx={{ mt: 0.34 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>Топ-P</Typography>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>{storyTopR.toFixed(2)}</Typography>
                      </Stack>
                      <Slider
                        value={storyTopR}
                        min={STORY_TOP_R_MIN}
                        max={STORY_TOP_R_MAX}
                        step={0.01}
                        onChange={handleStoryTopRSliderChange}
                        onChangeCommitted={(event, value) => {
                          void handleStoryTopRSliderCommit(event, value)
                        }}
                        disabled={isSavingStorySettings || isGenerating}
                        sx={{
                          mt: 0.42,
                          color: 'var(--morius-accent)',
                          '& .MuiSlider-thumb': {
                            width: 14,
                            height: 14,
                            backgroundColor: 'var(--morius-title-text)',
                            border: '2px solid var(--morius-accent)',
                          },
                          '& .MuiSlider-rail': {
                            opacity: 1,
                            backgroundColor: 'var(--morius-card-border)',
                          },
                        }}
                      />
                    </Box>

                    {isSavingStorySampling ? <CircularProgress size={14} sx={{ mt: 0.45, color: 'var(--morius-accent)' }} /> : null}
                  </Box>

                  {isAdministrator ? (
                    <Box
                    sx={{
                      mt: 1.05,
                      pt: 0.92,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography sx={{ color: '#dfe7f4', fontSize: '0.8rem', fontWeight: 700 }}>
                        Использование контекста
                      </Typography>
                      <Typography sx={{ color: 'rgba(194, 208, 227, 0.72)', fontSize: '0.76rem' }}>
                        {formatContextChars(cardsContextCharsUsed)} / {formatContextChars(contextLimitChars)}
                      </Typography>
                    </Stack>

                    <Box
                      sx={{
                        mt: 0.7,
                        height: 7,
                        borderRadius: '999px',
                        backgroundColor: 'rgba(123, 145, 172, 0.22)',
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        sx={{
                          width: `${cardsContextUsagePercent}%`,
                          height: '100%',
                          borderRadius: '999px',
                          background: 'linear-gradient(90deg, rgba(127, 214, 255, 0.9), rgba(159, 190, 255, 0.86))',
                          transition: 'width 180ms ease',
                        }}
                      />
                    </Box>

                    <Stack spacing={0.56} sx={{ mt: 0.85 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>Инструкции</Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(instructionContextTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>
                          {storyMemoryLabel}
                        </Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(storyMemoryTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>
                          Карточки мира (активные)
                        </Typography>
                        <Typography sx={{ color: '#dbe5f4', fontSize: '0.78rem', fontWeight: 600 }}>
                          {formatContextChars(worldContextTokensUsed)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'rgba(196, 208, 226, 0.82)', fontSize: '0.76rem' }}>Свободно</Typography>
                        <Typography
                          sx={{
                            color: cardsContextOverflowChars > 0 ? 'rgba(255, 167, 167, 0.92)' : 'rgba(185, 241, 194, 0.92)',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                          }}
                        >
                          {formatContextChars(freeContextChars)}
                        </Typography>
                      </Stack>
                    </Stack>

                    <Typography sx={{ mt: 0.72, color: 'rgba(176, 190, 211, 0.66)', fontSize: '0.73rem', lineHeight: 1.36 }}>
                      {storyMemoryHint} Карточек в контексте: инструкции {normalizedInstructionCardsForContext.length},
                      сюжет {normalizedPlotCardsForContext.length}, мир {normalizedWorldCardsForContext.length} из {worldCards.length}.
                    </Typography>

                    {cardsContextOverflowChars > 0 ? (
                      <Alert
                        severity="warning"
                        sx={{
                          mt: 0.78,
                          py: 0.2,
                          borderRadius: 'var(--morius-radius)',
                          backgroundColor: 'rgba(76, 40, 28, 0.64)',
                          color: 'rgba(255, 221, 189, 0.92)',
                          border: 'var(--morius-border-width) solid rgba(255, 188, 138, 0.26)',
                          '& .MuiAlert-icon': {
                            color: 'rgba(255, 201, 153, 0.95)',
                            alignItems: 'center',
                            py: 0.1,
                          },
                        }}
                      >
                        Карточки превышают лимит на {formatContextChars(cardsContextOverflowChars)} токенов.
                      </Alert>
                    ) : null}
                    </Box>
                  ) : null}
                </>
              )}
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {plotCards.length === 0 ? (
                <>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || isCreatingGame}
                    sx={{
                      minHeight: 44,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                    }}
                  >
                    Добавить первую карточку
                  </Button>
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                    Здесь хранятся сюжетные сводки и важные изменения истории.
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    className="morius-scrollbar"
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      pr: 0,
                    }}
                  >
                    <Stack spacing={0.85}>
                      {plotCards.map((card) => (
                        <Box
                          key={card.id}
                          sx={{
                            borderRadius: '12px',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            px: 'var(--morius-story-right-padding)',
                            py: 'var(--morius-story-right-padding)',
                            height: RIGHT_PANEL_CARD_HEIGHT,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.45 }}>
                            <Typography
                              sx={{
                                color: '#e2e8f3',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                lineHeight: 1.25,
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                              }}
                            >
                              {card.title}
                            </Typography>
                            <Typography
                              sx={{
                                color: 'rgba(170, 238, 191, 0.96)',
                                fontSize: '0.66rem',
                                lineHeight: 1,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.48)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              активна
                            </Typography>
                            {card.source === 'ai' ? (
                              <Typography
                                sx={{
                                  color: 'rgba(165, 188, 224, 0.66)',
                                  fontSize: '0.68rem',
                                  lineHeight: 1,
                                  letterSpacing: 0.2,
                                  flexShrink: 0,
                                }}
                              >
                                ии
                              </Typography>
                            ) : null}
                            <IconButton
                              onClick={(event) => handleOpenCardMenu(event, 'plot', card.id)}
                              disabled={isPlotCardActionLocked}
                              sx={{
                                width: 22,
                                height: 22,
                                p: 0,
                                minWidth: 0,
                                color: 'rgba(208, 219, 235, 0.84)',
                                backgroundColor: 'transparent !important',
                                border: 'none',
                                '&:hover': { backgroundColor: 'transparent !important' },
                                '&:active': { backgroundColor: 'transparent !important' },
                                '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                              }}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                            </IconButton>
                          </Stack>
                          <Typography
                            sx={{
                              mt: 0.55,
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.86rem',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 7,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {card.content}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || deletingPlotCardId !== null || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                    }}
                  >
                    Добавить карточку
                  </Button>
                </>
              )}
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'world' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Stack direction="column" spacing={0.7}>
                {!mainHeroCard ? (
                  <Button
                    onClick={() => void handleOpenCharacterSelectorForMainHero()}
                    disabled={isGenerating || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: '#d9dee8',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                    }}
                  >
                    Выбрать главного героя
                  </Button>
                ) : (
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Открыть описание главного героя"
                    onClick={() => setMainHeroPreviewOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setMainHeroPreviewOpen(true)
                      }
                    }}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      px: 0.8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.7,
                      cursor: 'pointer',
                      transition: 'border-color 180ms ease, background-color 180ms ease',
                      '&:hover': {
                        borderColor: 'rgba(143, 169, 199, 0.52)',
                        backgroundColor: 'rgba(20, 25, 34, 0.92)',
                      },
                      '&:focus-visible': {
                        outline: 'none',
                        borderColor: 'rgba(168, 196, 231, 0.72)',
                        boxShadow: '0 0 0 1px rgba(168, 196, 231, 0.42) inset',
                      },
                    }}
                  >
                    <CharacterAvatar avatarUrl={mainHeroAvatarUrl} avatarScale={mainHeroCard.avatar_scale} fallbackLabel={mainHeroCard.title} size={28} />
                    <Stack spacing={0.05} sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: '#d9dee8',
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {mainHeroCard.title}
                      </Typography>
                      <Typography sx={{ color: 'rgba(166, 186, 214, 0.74)', fontSize: '0.74rem', lineHeight: 1.1 }}>
                        Главный герой выбран
                      </Typography>
                      <Typography
                        sx={{
                          color: mainHeroCard.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                          fontSize: '0.7rem',
                          lineHeight: 1.1,
                        }}
                      >
                        {getWorldCardAiEditStatusLabel(mainHeroCard)}
                      </Typography>
                    </Stack>
                    <IconButton
                      onClick={(event) => handleOpenCardMenu(event, 'world', mainHeroCard.id)}
                      disabled={isWorldCardActionLocked}
                      sx={{
                        width: 22,
                        height: 22,
                        p: 0,
                        minWidth: 0,
                        color: 'rgba(208, 219, 235, 0.84)',
                        ml: 'auto',
                        flexShrink: 0,
                        backgroundColor: 'transparent !important',
                        border: 'none',
                        '&:hover': { backgroundColor: 'transparent !important' },
                        '&:active': { backgroundColor: 'transparent !important' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                      }}
                    >
                      <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                    </IconButton>
                  </Box>
                )}
                <Button
                  onClick={() => void handleOpenCharacterSelectorForNpc()}
                  disabled={isGenerating || isCreatingGame}
                  sx={{
                    minHeight: 40,
                    borderRadius: '12px',
                    textTransform: 'none',
                    color: '#d9dee8',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                  }}
                >
                  Добавить NPC из персонажей
                </Button>
              </Stack>
              <Typography sx={{ color: 'rgba(171, 189, 214, 0.66)', fontSize: '0.76rem', lineHeight: 1.35 }}>
                Главный герой всегда активен. Остальные карточки активируются по триггерам из сообщений игрока и ИИ. У NPC по умолчанию память 10 ходов, её можно менять в профиле NPC.
              </Typography>

              {displayedWorldCards.length === 0 ? (
                <Typography sx={{ color: 'rgba(186, 202, 214, 0.64)', fontSize: '0.9rem' }}>
                  Здесь живут NPC, предметы и важные детали мира. Главный герой отображается выше.
                </Typography>
              ) : (
                <Box
                  className="morius-scrollbar"
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    pr: 0,
                  }}
                >
                  <Stack spacing={0.85}>
                    {displayedWorldCards.map((card) => {
                      const contextState = worldCardContextStateById.get(card.id)
                      const isCardContextActive = Boolean(contextState?.isActive)
                      return (
                        <Box key={card.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.45 }}>
                          <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap', px: 0 }}>
                            <Typography
                              sx={{
                                color: isCardContextActive ? 'rgba(170, 238, 191, 0.96)' : 'rgba(155, 172, 196, 0.84)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.22,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: isCardContextActive
                                  ? 'var(--morius-border-width) solid rgba(128, 213, 162, 0.48)'
                                  : 'var(--morius-border-width) solid rgba(137, 154, 178, 0.38)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                              }}
                            >
                              {formatWorldCardContextStatus(contextState)}
                            </Typography>
                            <Typography
                              sx={{
                                color: card.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.18,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: card.ai_edit_enabled
                                  ? 'var(--morius-border-width) solid rgba(132, 168, 210, 0.4)'
                                  : 'var(--morius-border-width) solid rgba(236, 148, 148, 0.46)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                              }}
                            >
                              {card.ai_edit_enabled ? 'ИИ: РАЗРЕШЕНО' : 'ИИ: ЗАПРЕЩЕНО'}
                            </Typography>
                          </Stack>
                          <Box
                            sx={{
                              borderRadius: '12px',
                              border: isCardContextActive
                                ? 'var(--morius-border-width) solid rgba(131, 213, 164, 0.62)'
                                : 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: isCardContextActive ? 'rgba(18, 30, 24, 0.54)' : 'var(--morius-elevated-bg)',
                              boxShadow: isCardContextActive ? '0 0 0 1px rgba(79, 164, 116, 0.22) inset' : 'none',
                              px: 'var(--morius-story-right-padding)',
                              py: 'var(--morius-story-right-padding)',
                              height: RIGHT_PANEL_CARD_HEIGHT,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden',
                            }}
                          >
                            <Stack direction="row" alignItems="center" spacing={0.5}>
                              <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                                {card.kind === 'npc' || card.kind === 'main_hero' ? (
                                  <Button
                                    onClick={() => handleOpenWorldCardAvatarPicker(card.id)}
                                    disabled={isSavingWorldCardAvatar || isGenerating || isCreatingGame}
                                    sx={{
                                      minWidth: 0,
                                      minHeight: 0,
                                      p: 0,
                                      width: 30,
                                      height: 30,
                                      borderRadius: '50%',
                                      flexShrink: 0,
                                      lineHeight: 0,
                                    }}
                                  >
                                    <CharacterAvatar avatarUrl={resolveWorldCardAvatar(card)} avatarScale={card.avatar_scale} fallbackLabel={card.title} size={30} />
                                  </Button>
                                ) : null}
                                <Typography
                                  sx={{
                                    color: '#e2e8f3',
                                    fontWeight: 700,
                                    fontSize: '0.95rem',
                                    lineHeight: 1.25,
                                    flex: 1,
                                    minWidth: 0,
                                    whiteSpace: 'nowrap',
                                    textOverflow: 'ellipsis',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {card.title}
                                </Typography>
                              </Stack>
                              {card.source === 'ai' ? (
                                <Typography
                                  sx={{
                                    color: 'rgba(165, 188, 224, 0.66)',
                                    fontSize: '0.68rem',
                                    lineHeight: 1,
                                    letterSpacing: 0.2,
                                    flexShrink: 0,
                                  }}
                                >
                                  ии
                                </Typography>
                              ) : null}
                              <IconButton
                                onClick={(event) => handleOpenCardMenu(event, 'world', card.id)}
                                disabled={isWorldCardActionLocked}
                                sx={{
                                  width: 22,
                                  height: 22,
                                  p: 0,
                                  minWidth: 0,
                                  color: 'rgba(208, 219, 235, 0.84)',
                                  backgroundColor: 'transparent !important',
                                  border: 'none',
                                  '&:hover': { backgroundColor: 'transparent !important' },
                                  '&:active': { backgroundColor: 'transparent !important' },
                                  '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                                }}
                              >
                                <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                              </IconButton>
                            </Stack>
                            <Typography
                              sx={{
                                mt: 0.55,
                                color: 'rgba(207, 217, 232, 0.86)',
                                fontSize: '0.86rem',
                                lineHeight: 1.4,
                                whiteSpace: 'pre-wrap',
                                display: '-webkit-box',
                                WebkitLineClamp: 5,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {card.content}
                            </Typography>
                            <Typography
                              sx={{
                                mt: 0.45,
                                color: 'rgba(178, 195, 221, 0.7)',
                                fontSize: '0.78rem',
                                lineHeight: 1.3,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              Триггеры: {card.triggers.length > 0 ? card.triggers.join(', ') : '—'}
                            </Typography>
                            {card.kind === 'npc' ? (
                              <Typography
                                sx={{
                                  mt: 0.2,
                                  color: 'rgba(170, 190, 214, 0.72)',
                                  fontSize: '0.74rem',
                                  lineHeight: 1.25,
                                }}
                              >
                                Память: {formatWorldCardMemoryLabel(resolveWorldCardMemoryTurns(card))}
                              </Typography>
                            ) : null}
                          </Box>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              )}
              <Button
                onClick={handleOpenCreateWorldCardDialog}
                disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                sx={{
                  minHeight: 40,
                  borderRadius: '12px',
                  textTransform: 'none',
                  color: '#d9dee8',
                  border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                }}
              >
                Новая карточка мира
              </Button>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>

      <Box
        ref={messagesViewportRef}
        className="morius-scrollbar"
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-menu-top)',
          left: 0,
          right: 0,
          bottom: `${messagesViewportBottomPadding}px`,
          px: 'var(--morius-interface-gap)',
          pb: 'var(--morius-interface-gap)',
          display: 'flex',
          justifyContent: 'center',
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          zIndex: 1,
        }}
      >
        <Box
          sx={storyStageSx}
        >
          {errorMessage ? (
            <Alert
              severity="error"
              onClose={() => setErrorMessage('')}
              sx={{ width: '100%', mb: 1.2, borderRadius: '12px' }}
            >
              {errorMessage}
            </Alert>
          ) : null}

          {shouldShowStoryTitleLoadingSkeleton ? (
            <StoryTitleLoadingSkeleton />
          ) : (
            <Typography
              component="div"
              contentEditable={!isGenerating && Boolean(activeGameId)}
              suppressContentEditableWarning
              spellCheck={false}
              onFocus={handleInlineTitleFocus}
              onBlur={handleInlineTitleBlur}
              onKeyDown={handleInlineTitleKeyDown}
              sx={{
                px: { xs: 0.3, md: 0.8 },
                mb: 1.1,
                color: '#e0e7f4',
                fontWeight: 700,
                fontSize: { xs: '1.18rem', md: '1.42rem' },
                lineHeight: 1.25,
                cursor: isGenerating ? 'default' : 'text',
                outline: 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {activeDisplayTitle}
            </Typography>
          )}

          <Box
            sx={{
              px: { xs: 0.3, md: 0.8 },
              pb: { xs: 1.5, md: 1.8 },
            }}
          >
            {shouldShowStoryMessagesLoadingSkeleton ? (
              <StoryMessagesLoadingSkeleton />
            ) : null}

            {!shouldShowStoryMessagesLoadingSkeleton && isLoadingGameMessages ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}

            {!shouldShowStoryMessagesLoadingSkeleton && !isLoadingGameMessages ? (
              quickStartIntroBlocks.length > 0 ? (
                <Box
                  sx={{
                    mb: 'var(--morius-story-message-gap)',
                    borderRadius: 'var(--morius-radius)',
                    px: 0.42,
                    py: 0.3,
                  }}
                >
                  <Stack spacing="var(--morius-story-message-gap)">
                    {quickStartIntroBlocks.map((block, index) => {
                      if (block.type === 'character') {
                        const nearbyNarrativeContext = quickStartIntroBlocks
                          .slice(Math.max(0, index - 3), Math.min(quickStartIntroBlocks.length, index + 4))
                          .filter((candidate) => candidate.type === 'narrative')
                          .map((candidate) => candidate.text)
                          .join('\n')
                        const resolvedSpeakerName = resolveDialogueSpeakerName(
                          block.speakerName,
                          block.text,
                          nearbyNarrativeContext,
                        )
                        const speakerAvatar = resolveDialogueAvatar(resolvedSpeakerName)
                        return (
                          <Stack
                            key={`quick-start-character-${index}`}
                            direction="row"
                            spacing={ASSISTANT_DIALOGUE_AVATAR_GAP}
                            alignItems="flex-start"
                            sx={{
                              px: 0.05,
                              py: 0.05,
                            }}
                          >
                            <CharacterAvatar
                              avatarUrl={speakerAvatar}
                              fallbackLabel={resolvedSpeakerName}
                              size={ASSISTANT_DIALOGUE_AVATAR_SIZE}
                            />
                            <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                sx={{
                                  color: block.delivery === 'thought' ? 'rgba(166, 187, 214, 0.9)' : 'rgba(178, 198, 228, 0.9)',
                                  fontSize: '0.84rem',
                                  lineHeight: 1.2,
                                  fontWeight: 700,
                                  letterSpacing: 0.18,
                                }}
                              >
                                {block.delivery === 'thought' ? `${resolvedSpeakerName} (В голове)` : resolvedSpeakerName}
                              </Typography>
                              <Typography
                                sx={{
                                  color: block.delivery === 'thought' ? 'rgba(207, 220, 237, 0.92)' : 'var(--morius-title-text)',
                                  lineHeight: 1.54,
                                  fontSize: { xs: '1rem', md: '1.08rem' },
                                  fontStyle: block.delivery === 'thought' ? 'italic' : 'normal',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {block.text}
                              </Typography>
                            </Stack>
                          </Stack>
                        )
                      }

                      return (
                        <Box
                          key={`quick-start-narrative-${index}`}
                          sx={{
                            px: 0.05,
                            py: 0.05,
                          }}
                        >
                          <Typography
                            sx={{
                              color: 'var(--morius-title-text)',
                              lineHeight: 1.58,
                              fontSize: { xs: '1.02rem', md: '1.12rem' },
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {block.text}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              ) : messages.length === 0 ? (
                <Stack spacing={1.2} sx={{ color: 'rgba(210, 219, 234, 0.72)', mt: 0.6, maxWidth: 820 }}>
                  <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.2rem' }, color: 'rgba(226, 232, 243, 0.9)' }}>
                    {INITIAL_STORY_PLACEHOLDER}
                  </Typography>
                </Stack>
              ) : null
            ) : null}

            {!shouldShowStoryMessagesLoadingSkeleton && !isLoadingGameMessages
              ? messages.map((message) => {
                  if (editingMessageId === message.id) {
                    return (
                      <Box
                        key={message.id}
                        sx={{
                          mb: 'var(--morius-story-message-gap)',
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                          backgroundColor: 'var(--morius-card-bg)',
                          p: 1.1,
                        }}
                      >
                        <Box
                          component="textarea"
                          value={messageDraft}
                          autoFocus
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessageDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              handleCancelMessageEdit()
                            }
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                              event.preventDefault()
                              void handleSaveEditedMessage()
                            }
                          }}
                          sx={{
                            width: '100%',
                            minHeight: 108,
                            resize: 'vertical',
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: '#dbe2ee',
                            lineHeight: 1.58,
                            fontSize: { xs: '1rem', md: '1.07rem' },
                            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                          }}
                        />
                        <Stack direction="row" spacing={0.7} justifyContent="flex-end" sx={{ mt: 0.7 }}>
                          <Button
                            onClick={() => void handleSaveEditedMessage()}
                            disabled={isSavingMessage}
                            sx={{
                              minHeight: 34,
                              borderRadius: 'var(--morius-radius)',
                              textTransform: 'none',
                              color: '#dce4f1',
                              border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.24)',
                              backgroundColor: 'rgba(23, 28, 38, 0.84)',
                              minWidth: 100,
                            }}
                          >
                            {isSavingMessage ? <CircularProgress size={16} sx={{ color: '#dce4f1' }} /> : 'Сохранить'}
                          </Button>
                          <Button
                            onClick={handleCancelMessageEdit}
                            disabled={isSavingMessage}
                            sx={{
                              minHeight: 34,
                              borderRadius: 'var(--morius-radius)',
                              textTransform: 'none',
                              color: 'rgba(193, 205, 221, 0.88)',
                            }}
                          >
                            Отмена
                          </Button>
                        </Stack>
                      </Box>
                    )
                  }

                  if (message.role === 'assistant') {
                    const blocks = parseAssistantMessageBlocks(message.content)
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating
                    const messagePlotCardEvents = plotCardEventsByAssistantId.get(message.id) ?? []
                    const messageWorldCardEvents = worldCardEventsByAssistantId.get(message.id) ?? []
                    const assistantTurnImages = turnImageByAssistantMessageId[message.id] ?? []
                    return (
                      <Box
                        key={message.id}
                        sx={{
                          mb: 'var(--morius-story-message-gap)',
                          cursor: isGenerating ? 'default' : 'text',
                          position: 'relative',
                          borderRadius: 'var(--morius-radius)',
                          px: 0.42,
                          py: 0.3,
                          '&::before, &::after': {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: 2,
                            borderRadius: '999px',
                            backgroundColor: INLINE_EDIT_RAIL_COLOR,
                            opacity: 0,
                            transition: 'opacity 170ms ease',
                            pointerEvents: 'none',
                          },
                          '&::before': {
                            left: 0,
                          },
                          '&::after': {
                            right: 0,
                          },
                          '&:hover::before, &:hover::after': isGenerating ? {} : { opacity: 0.9 },
                        }}
                      >
                        <Stack spacing="var(--morius-story-message-gap)">
                          {blocks.map((block, index) => {
                            if (block.type === 'character') {
                              const nearbyNarrativeContext = blocks
                                .slice(Math.max(0, index - 3), Math.min(blocks.length, index + 4))
                                .filter((candidate) => candidate.type === 'narrative')
                                .map((candidate) => candidate.text)
                                .join('\n')
                              const resolvedSpeakerName = resolveDialogueSpeakerName(
                                block.speakerName,
                                block.text,
                                nearbyNarrativeContext,
                              )
                              const speakerAvatar = resolveDialogueAvatar(resolvedSpeakerName)
                              return (
                                <Stack
                                  key={`${message.id}-${index}-character`}
                                  direction="row"
                                  spacing={ASSISTANT_DIALOGUE_AVATAR_GAP}
                                  alignItems="flex-start"
                                  sx={{
                                    px: 0.05,
                                    py: 0.05,
                                  }}
                                >
                                  <CharacterAvatar
                                    avatarUrl={speakerAvatar}
                                    fallbackLabel={resolvedSpeakerName}
                                    size={ASSISTANT_DIALOGUE_AVATAR_SIZE}
                                  />
                                  <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography
                                      sx={{
                                        color: block.delivery === 'thought' ? 'rgba(166, 187, 214, 0.9)' : 'rgba(178, 198, 228, 0.9)',
                                        fontSize: '0.84rem',
                                        lineHeight: 1.2,
                                        fontWeight: 700,
                                        letterSpacing: 0.18,
                                      }}
                                    >
                                      {block.delivery === 'thought' ? `${resolvedSpeakerName} (В голове)` : resolvedSpeakerName}
                                    </Typography>
                                    <Box
                                      component="div"
                                      contentEditable={!isGenerating && !isSavingMessage}
                                      suppressContentEditableWarning
                                      spellCheck={false}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          event.currentTarget.textContent = block.text
                                          event.currentTarget.blur()
                                        }
                                      }}
                                      onBlur={(event) => {
                                        const nextContent = buildAssistantMessageContentWithEditedBlock(
                                          message.content,
                                          index,
                                          event.currentTarget.textContent ?? '',
                                        )
                                        if (!nextContent) {
                                          event.currentTarget.textContent = block.text
                                          return
                                        }
                                        void handleSaveMessageInline(message.id, nextContent)
                                      }}
                                      sx={{
                                        color: block.delivery === 'thought' ? 'rgba(207, 220, 237, 0.92)' : 'var(--morius-title-text)',
                                        lineHeight: 1.54,
                                        fontSize: { xs: '1rem', md: '1.08rem' },
                                        fontStyle: block.delivery === 'thought' ? 'italic' : 'normal',
                                        whiteSpace: 'pre-wrap',
                                        outline: 'none',
                                        cursor: isGenerating ? 'default' : 'text',
                                      }}
                                    >
                                      {block.text}
                                    </Box>
                                  </Stack>
                                </Stack>
                              )
                            }

                            return (
                              <Box
                                key={`${message.id}-${index}`}
                                sx={{
                                  px: 0.05,
                                  py: 0.05,
                                }}
                              >
                                <Box
                                  component="div"
                                  contentEditable={!isGenerating && !isSavingMessage}
                                  suppressContentEditableWarning
                                  spellCheck={false}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      event.currentTarget.textContent = block.text
                                      event.currentTarget.blur()
                                    }
                                  }}
                                  onBlur={(event) => {
                                    const nextContent = buildAssistantMessageContentWithEditedBlock(
                                      message.content,
                                      index,
                                      event.currentTarget.textContent ?? '',
                                    )
                                    if (!nextContent) {
                                      event.currentTarget.textContent = block.text
                                      return
                                    }
                                    void handleSaveMessageInline(message.id, nextContent)
                                  }}
                                  sx={{
                                    color: 'var(--morius-title-text)',
                                    lineHeight: 1.58,
                                    fontSize: { xs: '1.02rem', md: '1.12rem' },
                                    whiteSpace: 'pre-wrap',
                                    outline: 'none',
                                    cursor: isGenerating ? 'default' : 'text',
                                  }}
                                >
                                  {block.text}
                                </Box>
                              </Box>
                            )
                          })}
                          {isStreaming ? (
                            <Stack direction="row" alignItems="center" spacing={0.65} sx={{ px: 0.05, py: 0.05 }}>
                              <Stack direction="row" alignItems="center" spacing={0.65} className="morius-generating-indicator">
                                <Box className="morius-generating-pulse-dot" />
                                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', letterSpacing: 0.1 }}>
                                  Смотрим, что было дальше...
                                </Typography>
                              </Stack>
                            </Stack>
                          ) : null}
                          {messagePlotCardEvents.length > 0 || messageWorldCardEvents.length > 0 ? (
                            <Stack spacing={0.75}>
                              {messagePlotCardEvents.map((plotCardEvent) => {
                                const isExpanded = expandedPlotCardEventIds.includes(plotCardEvent.id)
                                const isUndoing = undoingPlotCardEventIds.includes(plotCardEvent.id)
                                const statusLabel = WORLD_CARD_EVENT_STATUS_LABEL[plotCardEvent.action]
                                const statusColor =
                                  plotCardEvent.action === 'added'
                                    ? 'rgba(118, 232, 177, 0.94)'
                                    : plotCardEvent.action === 'deleted'
                                      ? 'rgba(249, 160, 160, 0.92)'
                                      : 'rgba(112, 195, 248, 0.94)'
                                const statusBackground =
                                  plotCardEvent.action === 'added'
                                    ? 'rgba(51, 104, 81, 0.46)'
                                    : plotCardEvent.action === 'deleted'
                                      ? 'rgba(112, 55, 61, 0.46)'
                                      : 'rgba(44, 89, 126, 0.46)'

                                return (
                                  <Box
                                    key={`plot-event-${plotCardEvent.id}`}
                                    onClick={(event) => event.stopPropagation()}
                                    sx={{
                                      borderRadius: '12px',
                                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                      backgroundColor: 'var(--morius-elevated-bg)',
                                      px: 0.95,
                                      py: 0.62,
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" spacing={0.55}>
                                      <Box
                                        sx={{
                                          borderRadius: '999px',
                                          px: 0.92,
                                          py: 0.22,
                                          fontSize: '0.67rem',
                                          lineHeight: 1.2,
                                          textTransform: 'uppercase',
                                          letterSpacing: 0.2,
                                          color: statusColor,
                                          backgroundColor: statusBackground,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {statusLabel}
                                      </Box>
                                      <Typography
                                        sx={{
                                          color: 'rgba(226, 235, 248, 0.94)',
                                          fontSize: '0.88rem',
                                          lineHeight: 1.25,
                                          fontWeight: 600,
                                          flex: 1,
                                          minWidth: 0,
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        {plotCardEvent.title}
                                      </Typography>
                                      <IconButton
                                        aria-label="Откатить изменение карточки сюжета"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleUndoPlotCardEvent(plotCardEvent.id)
                                        }}
                                        disabled={isUndoing}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        {isUndoing ? (
                                          <CircularProgress size={14} sx={{ color: 'rgba(208, 220, 237, 0.86)' }} />
                                        ) : (
                                          <Box component="img" src={icons.back} alt="" sx={{ width: 14, height: 14, opacity: 0.88 }} />
                                        )}
                                      </IconButton>
                                      <IconButton
                                        aria-label="Скрыть блок"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleDismissPlotCardEvent(plotCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '1.05rem',
                                          lineHeight: 1,
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        ×
                                      </IconButton>
                                      <IconButton
                                        aria-label={isExpanded ? 'Свернуть изменения' : 'Развернуть изменения'}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleTogglePlotCardEventExpanded(plotCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '0.98rem',
                                          lineHeight: 1,
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        {isExpanded ? '˄' : '˅'}
                                      </IconButton>
                                    </Stack>
                                    {isExpanded ? (
                                      <Typography
                                        sx={{
                                          mt: 0.55,
                                          color: 'rgba(202, 214, 232, 0.88)',
                                          fontSize: '0.82rem',
                                          lineHeight: 1.36,
                                          whiteSpace: 'pre-wrap',
                                        }}
                                      >
                                        {plotCardEvent.changed_text}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )
                              })}
                              {messageWorldCardEvents.map((worldCardEvent) => {
                                const isExpanded = expandedWorldCardEventIds.includes(worldCardEvent.id)
                                const isUndoing = undoingWorldCardEventIds.includes(worldCardEvent.id)
                                const statusLabel = WORLD_CARD_EVENT_STATUS_LABEL[worldCardEvent.action]
                                const statusColor =
                                  worldCardEvent.action === 'added'
                                    ? 'rgba(118, 232, 177, 0.94)'
                                    : worldCardEvent.action === 'deleted'
                                      ? 'rgba(249, 160, 160, 0.92)'
                                      : 'rgba(112, 195, 248, 0.94)'
                                const statusBackground =
                                  worldCardEvent.action === 'added'
                                    ? 'rgba(51, 104, 81, 0.46)'
                                    : worldCardEvent.action === 'deleted'
                                      ? 'rgba(112, 55, 61, 0.46)'
                                      : 'rgba(44, 89, 126, 0.46)'

                                return (
                                  <Box
                                    key={worldCardEvent.id}
                                    onClick={(event) => event.stopPropagation()}
                                    sx={{
                                      borderRadius: '12px',
                                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                      backgroundColor: 'var(--morius-elevated-bg)',
                                      px: 0.95,
                                      py: 0.62,
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" spacing={0.55}>
                                      <Box
                                        sx={{
                                          borderRadius: '999px',
                                          px: 0.92,
                                          py: 0.22,
                                          fontSize: '0.67rem',
                                          lineHeight: 1.2,
                                          textTransform: 'uppercase',
                                          letterSpacing: 0.2,
                                          color: statusColor,
                                          backgroundColor: statusBackground,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {statusLabel}
                                      </Box>
                                      <Typography
                                        sx={{
                                          color: 'rgba(226, 235, 248, 0.94)',
                                          fontSize: '0.88rem',
                                          lineHeight: 1.25,
                                          fontWeight: 600,
                                          flex: 1,
                                          minWidth: 0,
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        {worldCardEvent.title}
                                      </Typography>
                                      <IconButton
                                        aria-label="Откатить изменение карточки"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleUndoWorldCardEvent(worldCardEvent.id)
                                        }}
                                        disabled={isUndoing}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        {isUndoing ? (
                                          <CircularProgress size={14} sx={{ color: 'rgba(208, 220, 237, 0.86)' }} />
                                        ) : (
                                          <Box component="img" src={icons.back} alt="" sx={{ width: 14, height: 14, opacity: 0.88 }} />
                                        )}
                                      </IconButton>
                                      <IconButton
                                        aria-label="Скрыть блок"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleDismissWorldCardEvent(worldCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '1.05rem',
                                          lineHeight: 1,
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        ×
                                      </IconButton>
                                      <IconButton
                                        aria-label={isExpanded ? 'Свернуть изменения' : 'Развернуть изменения'}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleToggleWorldCardEventExpanded(worldCardEvent.id)
                                        }}
                                        sx={{
                                          width: 28,
                                          height: 28,
                                          p: 0,
                                          border: 'none',
                                          backgroundColor: 'transparent',
                                          color: 'rgba(198, 210, 228, 0.86)',
                                          fontSize: '0.98rem',
                                          lineHeight: 1,
                                          '&:hover': { backgroundColor: 'transparent' },
                                          '&:active': { backgroundColor: 'transparent' },
                                        }}
                                      >
                                        {isExpanded ? '˄' : '˅'}
                                      </IconButton>
                                    </Stack>
                                    {isExpanded ? (
                                      <Typography
                                        sx={{
                                          mt: 0.55,
                                          color: 'rgba(202, 214, 232, 0.88)',
                                          fontSize: '0.82rem',
                                          lineHeight: 1.36,
                                          whiteSpace: 'pre-wrap',
                                        }}
                                      >
                                        {worldCardEvent.changed_text}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )
                              })}
                            </Stack>
                          ) : null}
                          {assistantTurnImages.length > 0 ? (
                            <Stack spacing={0.75} sx={{ width: '100%', alignSelf: 'stretch' }}>
                              {assistantTurnImages.map((assistantTurnImage, imageIndex) => (
                                <Box
                                  key={`turn-image-${message.id}-${assistantTurnImage.id}-${imageIndex}`}
                                  sx={{
                                    borderRadius: '12px',
                                    border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.24)',
                                    backgroundColor: 'rgba(19, 25, 36, 0.72)',
                                    p: 0.7,
                                    width: '100%',
                                    mx: 'auto',
                                  }}
                                >
                              <Box
                                sx={{
                                  width: '100%',
                                  ...(assistantTurnImage.status === 'error'
                                    ? {
                                        minHeight: 124,
                                        px: 1.2,
                                        py: 1.1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }
                                    : assistantTurnImage.status === 'loading'
                                      ? {
                                          aspectRatio: '16 / 9',
                                        }
                                      : {}),
                                  borderRadius: '10px',
                                  overflow: 'hidden',
                                  position: 'relative',
                                  background:
                                    'linear-gradient(140deg, rgba(42, 56, 78, 0.6) 0%, rgba(22, 31, 46, 0.88) 48%, rgba(26, 40, 61, 0.84) 100%)',
                                  ...(assistantTurnImage.status === 'loading'
                                    ? {
                                        '@keyframes morius-turn-image-shimmer': {
                                          '0%': { transform: 'translateX(-110%)' },
                                          '100%': { transform: 'translateX(160%)' },
                                        },
                                        '&::before': {
                                          content: '""',
                                          position: 'absolute',
                                          inset: 0,
                                          background:
                                            'linear-gradient(105deg, transparent 0%, rgba(193, 216, 247, 0.18) 48%, transparent 100%)',
                                          animation: 'morius-turn-image-shimmer 1.8s ease-in-out infinite',
                                        },
                                      }
                                    : {}),
                                }}
                              >
                                {assistantTurnImage.status === 'ready' && assistantTurnImage.imageUrl ? (
                                  <Box
                                    component="img"
                                    src={assistantTurnImage.imageUrl}
                                    alt="Scene frame"
                                    loading="lazy"
                                    sx={{
                                      width: '100%',
                                      height: 'auto',
                                      objectFit: 'contain',
                                      display: 'block',
                                    }}
                                  />
                                ) : assistantTurnImage.status === 'error' ? (
                                  <Stack
                                    spacing={0.55}
                                    alignItems="center"
                                    justifyContent="center"
                                    sx={{ width: '100%', textAlign: 'center', maxWidth: 560 }}
                                  >
                                    <Typography sx={{ color: 'rgba(235, 185, 185, 0.92)', fontSize: '0.88rem', fontWeight: 700 }}>
                                      Не удалось сгенерировать кадр сцены
                                    </Typography>
                                    {assistantTurnImage.error ? (
                                      <Typography sx={{ color: 'rgba(222, 195, 195, 0.82)', fontSize: '0.76rem', lineHeight: 1.35 }}>
                                        {assistantTurnImage.error}
                                      </Typography>
                                    ) : null}
                                  </Stack>
                                ) : (
                                  <Stack
                                    spacing={0.75}
                                    alignItems="center"
                                    justifyContent="center"
                                    sx={{ width: '100%', height: '100%', px: 1.2, textAlign: 'center' }}
                                  >
                                    <Typography sx={{ color: 'rgba(221, 231, 246, 0.94)', fontSize: '0.96rem', fontWeight: 700 }}>
                                      Не двигайтесь! Рисуем...
                                    </Typography>
                                    <Stack direction="row" spacing={0.45} alignItems="center" className="morius-generating-indicator">
                                      <Box className="morius-generating-dot" />
                                      <Box className="morius-generating-dot" />
                                      <Box className="morius-generating-dot" />
                                    </Stack>
                                  </Stack>
                                )}
                                  </Box>
                                </Box>
                              ))}
                            </Stack>
                          ) : null}
                        </Stack>
                      </Box>
                    )
                  }

                  return (
                    <Stack
                      key={message.id}
                      direction="row"
                      spacing={0.8}
                      alignItems="flex-start"
                      sx={{
                        mb: 'var(--morius-story-message-gap)',
                        cursor: isGenerating ? 'default' : 'text',
                        position: 'relative',
                        borderRadius: 'var(--morius-radius)',
                        px: 0.42,
                        py: 0.3,
                        '&::before, &::after': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          width: 2,
                          borderRadius: '999px',
                          backgroundColor: INLINE_EDIT_RAIL_COLOR,
                          opacity: 0,
                          transition: 'opacity 170ms ease',
                          pointerEvents: 'none',
                        },
                        '&::before': {
                          left: 0,
                        },
                        '&::after': {
                          right: 0,
                        },
                        '&:hover::before, &:hover::after': isGenerating ? {} : { opacity: 0.9 },
                      }}
                    >
                      <CharacterAvatar
                        avatarUrl={mainHeroAvatarUrl}
                        fallbackLabel={mainHeroCard?.title || user.display_name || 'Игрок'}
                        size={28}
                      />
                      <Box
                        component="div"
                        contentEditable={!isGenerating && !isSavingMessage}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            event.currentTarget.textContent = message.content
                            event.currentTarget.blur()
                          }
                        }}
                        onBlur={(event) => {
                          void handleSaveMessageInline(message.id, event.currentTarget.textContent ?? '')
                        }}
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          lineHeight: 1.58,
                          whiteSpace: 'pre-wrap',
                          fontSize: { xs: '1rem', md: '1.08rem' },
                          pt: 0.14,
                          flex: 1,
                          outline: 'none',
                          cursor: isGenerating ? 'default' : 'text',
                        }}
                      >
                        {message.content}
                      </Box>
                    </Stack>
                  )
                })
              : null}
          </Box>
        </Box>
      </Box>

      <Box
        ref={composerContainerRef}
        sx={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 'var(--morius-interface-gap)',
          width: 'calc(100% - var(--morius-interface-gap) - var(--morius-interface-gap))',
          maxWidth: 980,
          zIndex: 20,
          ...(composerAmbientVisual
            ? {
                isolation: 'isolate',
                '@keyframes morius-composer-ambient-pulse': {
                  '0%, 100%': {
                    opacity: 0.46,
                    transform: 'scale(0.9988)',
                    boxShadow: composerAmbientVisual.pulseShadowMin,
                  },
                  '50%': {
                    opacity: 0.62,
                    transform: 'scale(1.0012)',
                    boxShadow: composerAmbientVisual.pulseShadowMax,
                  },
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 'var(--morius-radius)',
                  pointerEvents: 'none',
                  boxShadow: composerAmbientVisual.pulseShadowMin,
                  opacity: 0.46,
                  transformOrigin: '50% 50%',
                  animation: 'morius-composer-ambient-pulse 6.8s ease-in-out infinite',
                  transition: 'box-shadow 1000ms ease, opacity 1000ms ease',
                  zIndex: 0,
                },
              }
            : {}),
        }}
      >
          <Box
            sx={{
              width: '100%',
              borderRadius: 'var(--morius-radius)',
              border: composerAmbientVisual
                ? `var(--morius-border-width) solid ${composerAmbientVisual.borderColor}`
                : 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-card-bg)',
              boxShadow: composerAmbientVisual
                ? `0 14px 30px rgba(0, 0, 0, 0.28), ${composerAmbientVisual.baseShadow}`
                : '0 14px 30px rgba(0, 0, 0, 0.28)',
              transition: 'box-shadow 1000ms ease, border-color 1000ms ease',
              overflow: 'hidden',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Box sx={{ px: 1.35, pt: 'var(--morius-story-right-padding)', pb: 'var(--morius-story-right-padding)' }}>
              <Box
                component="textarea"
                ref={textAreaRef}
                value={inputValue}
                placeholder={inputPlaceholder}
                disabled={isGenerating || hasInsufficientTokensForTurn}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSendPrompt()
                  }
                }}
                sx={{
                  width: '100%',
                  minHeight: 42,
                  maxHeight: '34vh',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--morius-title-text)',
                  fontSize: 'var(--morius-body-size)',
                  lineHeight: 1.42,
                  fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                  '&::placeholder': {
                    color: 'var(--morius-text-secondary)',
                  },
                }}
              />
            </Box>

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                px: 1.35,
                py: 'var(--morius-story-right-padding)',
              }}
            >
              <Stack direction="row" alignItems="center" sx={{ gap: 1.1 }}>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    <Box sx={{ whiteSpace: 'pre-line' }}>
                      {'Стоимость хода зависит от использованного контекста:\nдо 1500 — 1 сол\n1500-3000 — 2 сола\n3000-4000 — 3 сола'}
                    </Box>
                  }
                >
                  <Stack direction="row" spacing={0.35} alignItems="center" sx={{ cursor: 'help' }}>
                    <Box component="img" src={icons.coin} alt="" sx={{ width: 16, height: 16, opacity: 0.92 }} />
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: 'var(--morius-subheading-size)', lineHeight: 1 }}>
                      {currentTurnCostTokens}
                    </Typography>
                  </Stack>
                </Tooltip>
                <IconButton
                  aria-label="Назад"
                  onClick={() => void handleUndoAssistantStep()}
                  disabled={!canUndoAssistantStep}
                  sx={{
                    opacity: canUndoAssistantStep ? 1 : 0.45,
                    p: 0,
                    backgroundColor: 'transparent',
                    border: 'none',
                    '&:hover': { backgroundColor: 'transparent' },
                    '&:active': { backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.back}
                    alt=""
                    sx={{ width: 'var(--morius-action-icon-size)', height: 'var(--morius-action-icon-size)', opacity: 0.9 }}
                  />
                </IconButton>
                <IconButton
                  aria-label="Отменить"
                  onClick={() => void handleRedoAssistantStep()}
                  disabled={!canRedoAssistantStep}
                  sx={{
                    opacity: canRedoAssistantStep ? 1 : 0.45,
                    p: 0,
                    backgroundColor: 'transparent',
                    border: 'none',
                    '&:hover': { backgroundColor: 'transparent' },
                    '&:active': { backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.undo}
                    alt=""
                    sx={{ width: 'var(--morius-action-icon-size)', height: 'var(--morius-action-icon-size)', opacity: 0.9 }}
                  />
                </IconButton>
                <IconButton
                  aria-label="Перегенерировать"
                  onClick={() => void handleRerollLastResponse()}
                  disabled={!canReroll}
                  sx={{
                    opacity: canReroll ? 1 : 0.45,
                    p: 0,
                    backgroundColor: 'transparent',
                    border: 'none',
                    '&:hover': { backgroundColor: 'transparent' },
                    '&:active': { backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.reload}
                    alt=""
                    sx={{ width: 'var(--morius-action-icon-size)', height: 'var(--morius-action-icon-size)', opacity: 0.9 }}
                  />
                </IconButton>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    isTurnImageGenerationEnabled
                      ? 'Auto-scene image after turn is enabled'
                      : 'Enable auto-scene image after turn'
                  }
                >
                  <IconButton
                    aria-label={
                      isTurnImageGenerationEnabled
                        ? 'Disable auto-scene image'
                        : 'Enable auto-scene image'
                    }
                    onClick={handleToggleTurnImageGeneration}
                    disableRipple
                    disableFocusRipple
                    sx={{
                      opacity: isTurnImageGenerationEnabled ? 1 : 0.72,
                      p: 0,
                      width: 24,
                      height: 24,
                      borderRadius: '7px',
                      color: '#ffffff',
                      border: isTurnImageGenerationEnabled
                        ? 'var(--morius-border-width) solid rgba(255, 255, 255, 0.88)'
                        : 'var(--morius-border-width) solid rgba(255, 255, 255, 0.24)',
                      backgroundColor: isTurnImageGenerationEnabled ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                      position: 'relative',
                      transition: 'border-color .15s ease, background-color .15s ease, opacity .15s ease',
                      '&:hover': {
                        backgroundColor: isTurnImageGenerationEnabled ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.1)',
                      },
                      '&:active': {
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      },
                      '&.Mui-focusVisible': {
                        outline: '1px solid rgba(255, 255, 255, 0.92)',
                        outlineOffset: 1,
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={icons.imageGen}
                      alt=""
                      sx={{
                        width: 16,
                        height: 16,
                        display: 'block',
                        opacity: isTurnImageGenerationEnabled ? 1 : 0.94,
                        filter: 'brightness(0) invert(1)',
                      }}
                    />
                    <Box
                      component="span"
                      sx={{
                        position: 'absolute',
                        right: -1,
                        bottom: -1,
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        border: '1px solid rgba(11, 16, 24, 0.94)',
                        backgroundColor: isTurnImageGenerationEnabled ? '#ffffff' : 'rgba(184, 194, 207, 0.84)',
                      }}
                    />
                  </IconButton>
                </Tooltip>
              </Stack>

              <IconButton
                aria-label={isGenerating ? 'Остановить генерацию' : 'Отправить'}
                onClick={() => {
                  if (isGenerating) {
                    handleStopGeneration()
                    return
                  }
                  void handleSendPrompt()
                }}
                disabled={isCreatingGame || (!isGenerating && !inputValue.trim())}
                sx={{
                  width: 'var(--morius-action-size)',
                  height: 'var(--morius-action-size)',
                  borderRadius: 'var(--morius-radius)',
                  backgroundColor: isGenerating ? 'transparent' : '#BACAD6',
                  border: isGenerating ? 'none' : 'var(--morius-border-width) solid var(--morius-card-border)',
                  color: isGenerating ? 'var(--morius-accent)' : '#141414',
                  '&:hover': {
                    backgroundColor: isGenerating ? 'transparent' : '#C5D2DD',
                  },
                  '&:active': {
                    backgroundColor: isGenerating ? 'transparent' : '#AFC0CD',
                  },
                  '&:disabled': {
                    opacity: 1,
                    color: '#0f1011',
                    backgroundColor: isGenerating ? 'transparent' : '#99A6B1',
                    border: isGenerating ? 'none' : 'var(--morius-border-width) solid var(--morius-card-border)',
                  },
                }}
              >
                {isGenerating ? (
                  <Box
                    className="morius-stop-indicator"
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: 'var(--morius-accent)',
                    }}
                  />
                ) : (
                  <Box
                    component="img"
                    src={icons.send}
                    alt=""
                    sx={{ width: 'var(--morius-action-icon-size)', height: 'var(--morius-action-icon-size)' }}
                  />
                )}
              </IconButton>
            </Stack>
          </Box>
      </Box>

      <input
        ref={characterAvatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleCharacterAvatarChange}
        style={{ display: 'none' }}
      />
      <input
        ref={worldCardAvatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleWorldCardAvatarChange}
        style={{ display: 'none' }}
      />

      <Menu
        anchorEl={cardMenuAnchorEl}
        open={Boolean(cardMenuAnchorEl)}
        onClose={handleCloseCardMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 154,
          },
        }}
      >
        {cardMenuType === 'world' ? (
          <MenuItem
            onClick={() => {
              void handleToggleWorldCardAiEdit()
            }}
            disabled={isWorldCardActionLocked || !selectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuWorldCardAiEditUpdating ? (
              <CircularProgress size={14} sx={{ color: 'rgba(220, 231, 245, 0.92)' }} />
            ) : selectedMenuWorldCard?.ai_edit_enabled ? (
              'Не редактировать ИИ'
            ) : (
              'Разрешить редактирование ИИ'
            )}
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={handleCardMenuEdit}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked
                  : isWorldCardActionLocked || isSelectedMenuWorldCardLocked || isSelectedMenuWorldCardAiEditUpdating
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          Редактировать
        </MenuItem>
        <MenuItem
          onClick={() => {
            void handleCardMenuDelete()
          }}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked
                  : isWorldCardActionLocked || !canDeleteSelectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating
          }
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          Удалить
        </MenuItem>
      </Menu>

      <BaseDialog
        open={Boolean(deletionPrompt)}
        onClose={handleCancelDeletionPrompt}
        maxWidth="xs"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>{deletionPrompt?.title || 'Подтвердите удаление'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            {deletionPrompt?.message || 'Это действие нельзя отменить.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCancelDeletionPrompt} disabled={isDeletionPromptInProgress} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmDeletionPrompt()}
            disabled={isDeletionPromptInProgress}
            sx={{
              border: 'var(--morius-border-width) solid rgba(228, 120, 120, 0.44)',
              backgroundColor: 'rgba(184, 78, 78, 0.3)',
              color: 'rgba(251, 190, 190, 0.94)',
              '&:hover': {
                backgroundColor: 'rgba(196, 88, 88, 0.4)',
              },
            }}
          >
            {isDeletionPromptInProgress ? (
              <CircularProgress size={16} sx={{ color: 'rgba(251, 190, 190, 0.94)' }} />
            ) : (
              'Удалить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={instructionDialogOpen}
        onClose={handleCloseInstructionDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingInstructionId === null ? 'Новая инструкция' : 'Редактирование инструкции'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={instructionTitleDraft}
              placeholder="Название карточки"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setInstructionTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveInstructionCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={instructionContentDraft}
              placeholder="Опишите стиль, жанр, формат и другие пожелания к ответам ИИ."
              maxLength={8000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInstructionContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveInstructionCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 150,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {instructionContentDraft.length}/8000
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button
            onClick={handleCloseInstructionDialog}
            disabled={isSavingInstruction || isCreatingGame}
            sx={{ color: 'text.secondary' }}
          >
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveInstructionCard()}
            disabled={isSavingInstruction || isCreatingGame}
            sx={{
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingInstruction || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingInstructionId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={plotCardDialogOpen}
        onClose={handleClosePlotCardDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingPlotCardId === null ? 'Новая карточка сюжета' : 'Редактирование карточки сюжета'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={plotCardTitleDraft}
              placeholder="Название карточки сюжета"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPlotCardTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSavePlotCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={plotCardContentDraft}
              placeholder="Кратко сохраните важные сюжетные события и детали."
              maxLength={STORY_PLOT_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPlotCardContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSavePlotCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 140,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {plotCardContentDraft.length}/{STORY_PLOT_CARD_CONTENT_MAX_LENGTH}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button onClick={handleClosePlotCardDialog} disabled={isSavingPlotCard || isCreatingGame} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSavePlotCard()}
            disabled={isSavingPlotCard || isCreatingGame}
            sx={{
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingPlotCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingPlotCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={mainHeroPreviewOpen && Boolean(mainHeroCard)}
        onClose={() => setMainHeroPreviewOpen(false)}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {mainHeroCard?.title || 'Главный герой'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1}>
            <Typography
              sx={{
                color: '#dbe2ee',
                fontSize: '0.95rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}
            >
              {mainHeroCard?.content || 'Описание недоступно.'}
            </Typography>
            <Typography sx={{ color: 'rgba(178, 195, 221, 0.7)', fontSize: '0.82rem', lineHeight: 1.4 }}>
              Триггеры: {mainHeroCard?.triggers.length ? mainHeroCard.triggers.join(', ') : '—'}
            </Typography>
            {mainHeroCard ? (
              <Typography
                sx={{
                  color: mainHeroCard.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                  fontSize: '0.8rem',
                  lineHeight: 1.35,
                }}
              >
                {getWorldCardAiEditStatusLabel(mainHeroCard)}
              </Typography>
            ) : null}
            <Typography sx={{ color: 'rgba(170, 238, 191, 0.86)', fontSize: '0.8rem', lineHeight: 1.35 }}>
              Главный герой всегда активен и всегда учитывается в контексте.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button
            onClick={handleEditMainHeroFromPreview}
            disabled={!mainHeroCard || isWorldCardActionLocked}
            sx={{ color: 'var(--morius-text-primary)' }}
          >
            Редактировать
          </Button>
          <Button onClick={() => setMainHeroPreviewOpen(false)} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={worldCardDialogOpen}
        onClose={handleCloseWorldCardDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingWorldCardKind === 'npc'
              ? editingWorldCardId === null
                ? 'Новый профиль NPC'
                : 'Редактирование профиля NPC'
              : editingWorldCardId === null
                ? 'Новая карточка мира'
                : 'Редактирование карточки мира'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={worldCardTitleDraft}
              placeholder="Название (персонаж, предмет, место)"
              maxLength={120}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWorldCardTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveWorldCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={worldCardContentDraft}
              placeholder="Кратко опишите сущность: внешность, роль, свойства, важные детали."
              maxLength={WORLD_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setWorldCardContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveWorldCard()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 130,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Box
              component="input"
              value={worldCardTriggersDraft}
              placeholder="Триггеры через запятую: Алекс, Алексу, капитан"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWorldCardTriggersDraft(event.target.value)}
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dbe2ee',
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />
            {editingWorldCardKind === 'npc' ? (
              <Stack spacing={0.35}>
                <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                  Память NPC в контексте
                </Typography>
                <Box
                  component="select"
                  value={worldCardMemoryTurnsDraft === null ? 'always' : String(worldCardMemoryTurnsDraft)}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    const nextValue = event.target.value
                    setWorldCardMemoryTurnsDraft(nextValue === 'always' ? null : (Number(nextValue) as NpcMemoryTurnsOption))
                  }}
                  sx={{
                    width: '100%',
                    minHeight: 40,
                    borderRadius: 'var(--morius-radius)',
                    border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                    backgroundColor: 'var(--morius-card-bg)',
                    color: '#dbe2ee',
                    px: 1.1,
                    outline: 'none',
                    fontSize: '0.9rem',
                  }}
                >
                  <option value="5">5 ходов</option>
                  <option value="10">10 ходов</option>
                  <option value="15">15 ходов</option>
                  <option value="always">Помнить всегда</option>
                </Box>
              </Stack>
            ) : null}
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {worldCardContentDraft.length}/{WORLD_CARD_CONTENT_MAX_LENGTH}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button onClick={handleCloseWorldCardDialog} disabled={isSavingWorldCard || isCreatingGame} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveWorldCard()}
            disabled={isSavingWorldCard || isCreatingGame}
            sx={{
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingWorldCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingWorldCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <CharacterManagerDialog
        open={characterManagerDialogOpen}
        authToken={authToken}
        onClose={() => {
          setCharacterManagerDialogOpen(false)
          void loadCharacters({ silent: true })
        }}
      />

      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode={instructionTemplateDialogMode}
        selectedTemplateSignatures={
          instructionTemplateDialogMode === 'picker' ? selectedInstructionTemplateSignatures : undefined
        }
        onClose={() => {
          if (!isSavingInstruction && !isCreatingGame) {
            setInstructionTemplateDialogOpen(false)
          }
        }}
        onSelectTemplate={
          instructionTemplateDialogMode === 'picker'
            ? (template) => handleApplyInstructionTemplate(template)
            : undefined
        }
      />

      <BaseDialog
        open={characterDialogOpen}
        onClose={handleCloseCharacterDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {characterDialogMode === 'manage'
              ? 'Мои персонажи'
              : characterDialogMode === 'select-main-hero'
                ? 'Выбрать главного героя'
                : 'Выбрать NPC'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          {isLoadingCharacters && characters.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4 }}>
              <CircularProgress size={26} />
            </Stack>
          ) : null}

          {characterDialogMode === 'manage' ? (
            <Stack spacing={1.1}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-card-bg)',
                  p: 1,
                }}
              >
                <Stack spacing={0.7} alignItems="center">
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Изменить аватар персонажа"
                    onClick={handleChooseCharacterAvatar}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleChooseCharacterAvatar()
                      }
                    }}
                    sx={{
                      position: 'relative',
                      width: 76,
                      height: 76,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: isSavingCharacter ? 'default' : 'pointer',
                      outline: 'none',
                      '&:hover .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                      '&:focus-visible .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                    }}
                  >
                    <CharacterAvatar
                      avatarUrl={characterAvatarDraft}
                      avatarScale={1}
                      fallbackLabel={characterNameDraft || 'Персонаж'}
                      size={76}
                    />
                    <Box
                      className="morius-character-avatar-overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(7, 11, 19, 0.58)',
                        opacity: 0,
                        transition: 'opacity 180ms ease',
                      }}
                    >
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid rgba(219, 221, 231, 0.5)',
                          backgroundColor: 'rgba(17, 20, 27, 0.78)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--morius-text-primary)',
                          fontSize: '1.08rem',
                          fontWeight: 700,
                        }}
                      >
                        ✎
                      </Box>
                    </Box>
                  </Box>
                </Stack>
                <Stack spacing={0.8} sx={{ flex: 1 }}>
                  <Box
                    component="input"
                    value={characterNameDraft}
                    placeholder="Имя"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setCharacterNameDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.96rem',
                    }}
                  />
                  <Box
                    component="textarea"
                    value={characterDescriptionDraft}
                    maxLength={6000}
                    placeholder="Описание персонажа"
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCharacterDescriptionDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 92,
                      resize: 'vertical',
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      py: 0.9,
                      outline: 'none',
                      fontSize: '0.92rem',
                      lineHeight: 1.4,
                      fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                    }}
                  />
                  <Box
                    component="input"
                    value={characterTriggersDraft}
                    placeholder="Триггеры через запятую"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setCharacterTriggersDraft(event.target.value)}
                    sx={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: '#dbe2ee',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.9rem',
                    }}
                  />
                  {characterAvatarError ? <Alert severity="error">{characterAvatarError}</Alert> : null}
                  <Stack direction="row" spacing={0.7}>
                    <Button
                      variant="contained"
                      onClick={() => void handleSaveCharacter()}
                      disabled={isSavingCharacter}
                      sx={{
                        minHeight: 36,
                        borderRadius: 'var(--morius-radius)',
                        textTransform: 'none',
                        backgroundColor: 'var(--morius-card-bg)',
                        color: 'var(--morius-text-primary)',
                      }}
                    >
                      {isSavingCharacter ? (
                        <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                      ) : characterDraftMode === 'create' ? (
                        'Добавить'
                      ) : (
                        'Сохранить'
                      )}
                    </Button>
                    <Button onClick={handleStartCreateCharacter} disabled={isSavingCharacter} sx={{ textTransform: 'none' }}>
                      Очистить
                    </Button>
                  </Stack>
                </Stack>
              </Stack>

              <Box className="morius-scrollbar" sx={{ maxHeight: 280, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={0.7}>
                  {characters.map((character) => (
                    <Box
                      key={character.id}
                      sx={{
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-card-bg)',
                        px: 0.95,
                        py: 0.75,
                      }}
                    >
                      <Stack direction="row" spacing={0.7} alignItems="flex-start">
                        <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                        <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.28}>
                          <Typography sx={{ color: '#e2e8f3', fontWeight: 700, fontSize: '0.94rem' }}>{character.name}</Typography>
                          <Typography
                            sx={{
                              color: 'rgba(207, 217, 232, 0.86)',
                              fontSize: '0.84rem',
                              lineHeight: 1.36,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {character.description}
                          </Typography>
                        </Stack>
                        <IconButton
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isSavingCharacter || deletingCharacterId === character.id}
                          sx={{
                            width: 28,
                            height: 28,
                            color: 'rgba(208, 219, 235, 0.84)',
                            flexShrink: 0,
                            backgroundColor: 'transparent !important',
                            border: 'none',
                            '&:hover': { backgroundColor: 'transparent !important' },
                            '&:active': { backgroundColor: 'transparent !important' },
                            '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                          }}
                        >
                          {deletingCharacterId === character.id ? (
                            <CircularProgress size={14} sx={{ color: 'rgba(208, 219, 235, 0.84)' }} />
                          ) : (
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>⋯</Box>
                          )}
                        </IconButton>
                      </Stack>
                    </Box>
                  ))}
                  {characters.length === 0 ? (
                    <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                      Персонажей пока нет. Создайте первого.
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <Stack spacing={0.8}>
              <Typography sx={{ color: 'rgba(190, 202, 220, 0.72)', fontSize: '0.9rem' }}>
                {characterDialogMode === 'select-main-hero'
                  ? 'Выберите персонажа для роли главного героя. После выбора смена будет недоступна.'
                  : 'Выберите персонажа для добавления как NPC.'}
              </Typography>
              <Box className="morius-scrollbar" sx={{ maxHeight: 360, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={0.75}>
                  {characterDialogMode === 'select-npc' ? (
                    <Button
                      onClick={handleStartCreateCharacterFromNpcSelector}
                      aria-label="Create character"
                      disabled={isSavingCharacter || isSelectingCharacter}
                      sx={{
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) dashed rgba(203, 217, 236, 0.46)',
                        backgroundColor: 'rgba(116, 140, 171, 0.08)',
                        minHeight: 72,
                        color: '#d9dee8',
                        textTransform: 'none',
                        alignItems: 'center',
                        justifyContent: 'center',
                        '&:hover': {
                          backgroundColor: 'rgba(129, 151, 182, 0.14)',
                          borderColor: 'rgba(203, 217, 236, 0.7)',
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid rgba(214, 226, 241, 0.62)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '1.45rem',
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                      >
                        +
                      </Box>
                    </Button>
                  ) : null}
                  {characters.map((character) => {
                    const disabledReason = getCharacterSelectionDisabledReason(character, characterDialogMode)
                    const isCharacterDisabled = Boolean(disabledReason)
                    return (
                      <Button
                        key={character.id}
                        onClick={() => void handleSelectCharacterForGame(character)}
                        disabled={isSelectingCharacter || isCharacterDisabled}
                        sx={{
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-card-bg)',
                          color: '#d9dee8',
                          textTransform: 'none',
                          alignItems: 'center',
                          textAlign: 'left',
                          px: 0.9,
                          py: 0.7,
                          justifyContent: 'flex-start',
                          opacity: isCharacterDisabled ? 0.64 : 1,
                        }}
                      >
                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ width: '100%' }}>
                          <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#e2e8f3' }}>{character.name}</Typography>
                            <Typography
                              sx={{
                                color: 'rgba(207, 217, 232, 0.86)',
                                fontSize: '0.84rem',
                                lineHeight: 1.36,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {character.description}
                            </Typography>
                            {disabledReason ? (
                              <Typography sx={{ color: 'rgba(241, 189, 159, 0.9)', fontSize: '0.74rem', lineHeight: 1.25 }}>
                                {disabledReason}
                              </Typography>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Button>
                    )
                  })}
                  {characters.length === 0 ? (
                    <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                      Сначала создайте персонажей в разделе «Мои персонажи».
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.4 }}>
          <Button
            onClick={handleCloseCharacterDialog}
            disabled={isSavingCharacter || isSelectingCharacter}
            sx={{ color: 'text.secondary' }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </BaseDialog>

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
            minWidth: 176,
          },
        }}
      >
        <MenuItem
          onClick={handleEditCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>✎</Box>
            <Box component="span">Редактировать</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={() => void handleDeleteCharacterFromMenu()}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
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
      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
        profileName={profileName}
        avatarInputRef={avatarInputRef}
        avatarError={avatarError}
        isAvatarSaving={isAvatarSaving}
        transitionComponent={DialogTransition}
        onClose={handleCloseProfileDialog}
        onChooseAvatar={handleChooseAvatar}
        onAvatarChange={handleAvatarChange}
        onOpenTopUp={handleOpenTopUpDialog}
        onOpenCharacterManager={() => {
          handleCloseProfileDialog()
          void handleOpenCharacterManager()
        }}
        onOpenInstructionTemplates={handleOpenInstructionTemplateManager}
        onRequestLogout={() => setConfirmLogoutOpen(true)}
        onUpdateProfileName={handleUpdateProfileName}
      />

      <TopUpDialog
        open={topUpDialogOpen}
        topUpError={topUpError}
        isTopUpPlansLoading={isTopUpPlansLoading}
        topUpPlans={topUpPlans}
        activePlanPurchaseId={activePlanPurchaseId}
        transitionComponent={DialogTransition}
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={(planId) => void handlePurchasePlan(planId)}
      />

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        transitionComponent={DialogTransition}
        onClose={() => setPaymentSuccessCoins(null)}
      />

      <ConfirmLogoutDialog
        open={confirmLogoutOpen}
        transitionComponent={DialogTransition}
        variant="muted"
        onClose={() => setConfirmLogoutOpen(false)}
        onConfirm={handleConfirmLogout}
      />

      <AvatarCropDialog
        open={Boolean(avatarCropSource)}
        imageSrc={avatarCropSource}
        isSaving={isAvatarSaving}
        onCancel={() => {
          if (!isAvatarSaving) {
            setAvatarCropSource(null)
          }
        }}
        onSave={(croppedDataUrl) => void handleSaveCroppedAvatar(croppedDataUrl)}
      />
      <AvatarCropDialog
        open={Boolean(characterAvatarCropSource)}
        imageSrc={characterAvatarCropSource}
        isSaving={isSavingCharacter}
        outputSize={384}
        onCancel={() => {
          if (!isSavingCharacter) {
            setCharacterAvatarCropSource(null)
          }
        }}
        onSave={handleSaveCroppedCharacterAvatar}
      />
    </Box>
  )
}

export default StoryGamePage
