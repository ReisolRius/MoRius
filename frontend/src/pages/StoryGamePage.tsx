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
  Collapse,
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
  SvgIcon,
  Switch,
  TextField,
  Tooltip,
  Typography,
  type GrowProps,
  type SelectChangeEvent,
} from '@mui/material'
import { icons } from '../assets'
import narratorFreyaPortrait from '../assets/images/narrators/freya.svg'
import narratorIlonPortrait from '../assets/images/narrators/ilon.svg'
import narratorIsidaPortrait from '../assets/images/narrators/isida.svg'
import narratorOgmaPortrait from '../assets/images/narrators/ogma.svg'
import narratorVelesPortrait from '../assets/images/narrators/veles.svg'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import BaseDialog from '../components/dialogs/BaseDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TextLimitIndicator from '../components/TextLimitIndicator'
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
  addCommunityCharacter,
  createStoryCharacter,
  createStoryBugReport,
  createStoryInstructionCard,
  createStoryMemoryBlock,
  createStoryGame,
  createStoryNpcFromCharacter,
  createStoryPlotCard,
  createStoryWorldCard,
  deleteStoryCharacter,
  deleteStoryInstructionCard,
  deleteStoryMemoryBlock,
  deleteStoryPlotCard,
  deleteStoryWorldCard,
  generateStoryResponseStream,
  generateStoryTurnImage,
  getCommunityCharacter,
  getStoryGame,
  listCommunityCharacters,
  listStoryCharacters,
  listStoryGames,
  selectStoryMainHero,
  updateStoryCharacter,
  updateStoryGameSettings,
  updateStoryPlotCardEnabled,
  updateStoryPlotCard,
  redoStoryAssistantStep,
  undoStoryAssistantStep,
  undoStoryPlotCardEvent,
  undoStoryWorldCardEvent,
  updateStoryInstructionCard,
  updateStoryInstructionCardActive,
  updateStoryMemoryBlock,
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
  StoryCommunityCharacterSummary,
  StoryGameSummary,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryImageModelId,
  StoryMemoryBlock,
  StoryMessage,
  StoryNarratorModelId,
  StoryPlotCard,
  StoryPlotCardEvent,
  StoryWorldCard,
  StoryWorldCardKind,
  StoryWorldCardEvent,
} from '../types/story'
import { compressImageFileToDataUrl, prepareAvatarPayloadForRequest } from '../utils/avatar'
import { moriusThemeTokens, useMoriusThemeController } from '../theme'

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
  storyTemperature?: number
  showGgThoughts: boolean
  showNpcThoughts: boolean
  ambientEnabled: boolean
}



type RightPanelMode = 'ai' | 'world' | 'memory'
type AiPanelTab = 'instructions' | 'settings'
type WorldPanelTab = 'story' | 'world'
type MemoryPanelTab = 'memory' | 'dev'
type PanelCardMenuType = 'instruction' | 'plot' | 'world'
type DeletionTargetType = 'instruction' | 'plot' | 'world' | 'memory' | 'character'
type CharacterDialogMode = 'manage' | 'select-main-hero' | 'select-npc'
type CharacterSelectionDialogMode = Exclude<CharacterDialogMode, 'manage'>
type CharacterDraftMode = 'create' | 'edit'
type SelectorSourceTab = 'my' | 'community'
type CommunityAddedFilter = 'all' | 'added' | 'not_added'
type CommunitySortMode = 'updated_desc' | 'rating_desc' | 'additions_desc'
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
  previewAvatar: string | null
  displayName: string
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_DEFAULT_MS = 120_000
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_GROK_MS = 120_000
const STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH = 320
const STORY_PROMPT_MAX_LENGTH = 4000
const STORY_BUG_REPORT_TITLE_MAX_LENGTH = 160
const STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH = 8000
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const INITIAL_STORY_PLACEHOLDER = 'Начните свою историю...'
const INITIAL_INPUT_PLACEHOLDER = 'Как же все началось?'
const NEXT_INPUT_PLACEHOLDER = 'Введите ваше действие...'
const OUT_OF_TOKENS_INPUT_PLACEHOLDER = 'Закончились солы'
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const STORY_GAME_TITLE_MAX_LENGTH = 160
const STORY_CARD_TITLE_MAX_LENGTH = 120
const STORY_MEMORY_BLOCK_TITLE_MAX_LENGTH = 160
const STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH = 64000
const STORY_CONTEXT_LIMIT_INPUT_MAX_LENGTH = 5
const STORY_TRIGGER_INPUT_MAX_LENGTH = 600
const STORY_CHARACTER_NAME_MAX_LENGTH = 120
const STORY_CHARACTER_NOTE_MAX_LENGTH = 20
const WORLD_CARD_CONTENT_MAX_LENGTH = 6000
const STORY_PLOT_CARD_CONTENT_MAX_LENGTH = 32000
const STORY_CHARACTER_DESCRIPTION_MAX_LENGTH = 6000
const STORY_MESSAGE_MAX_LENGTH = 20000
const STORY_CONTEXT_LIMIT_MIN = 500
const STORY_CONTEXT_LIMIT_MAX = 15000
const STORY_DEFAULT_CONTEXT_LIMIT = 1500
const STORY_RESPONSE_MAX_TOKENS_MIN = 200
const STORY_RESPONSE_MAX_TOKENS_MAX = 800
const STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
const STORY_TURN_COST_STAGE_1_CONTEXT_LIMIT_MAX = 1500
const STORY_TURN_COST_STAGE_2_CONTEXT_LIMIT_MAX = 3000
const STORY_TURN_COST_STAGE_3_CONTEXT_LIMIT_MAX = 4000
const STORY_TURN_COST_STAGE_4_CONTEXT_LIMIT_MAX = 5500
const STORY_TURN_COST_STAGE_5_CONTEXT_LIMIT_MAX = 7000
const STORY_TURN_COST_STAGE_6_CONTEXT_LIMIT_MAX = 8500
const STORY_TURN_COST_STAGE_7_CONTEXT_LIMIT_MAX = 10000
const STORY_TURN_COST_STAGE_8_CONTEXT_LIMIT_MAX = 11500
const STORY_TURN_COST_STAGE_9_CONTEXT_LIMIT_MAX = 13000
const STORY_TOP_K_MIN = 0
const STORY_TOP_K_MAX = 200
const STORY_DEFAULT_TOP_K = 55
const STORY_TOP_R_MIN = 0.1
const STORY_TOP_R_MAX = 1
const STORY_DEFAULT_TOP_R = 0.85
const STORY_TEMPERATURE_MIN = 0
const STORY_TEMPERATURE_MAX = 2
const STORY_DEFAULT_TEMPERATURE = 0.85
const STORY_DEFAULT_NARRATOR_MODEL_ID: StoryNarratorModelId = 'deepseek/deepseek-v3.2'
const STORY_IMAGE_MODEL_FLUX_ID: StoryImageModelId = 'black-forest-labs/flux.2-pro'
const STORY_IMAGE_MODEL_SEEDREAM_ID: StoryImageModelId = 'bytedance-seed/seedream-4.5'
const STORY_IMAGE_MODEL_NANO_BANANO_ID: StoryImageModelId = 'google/gemini-2.5-flash-image'
const STORY_IMAGE_MODEL_NANO_BANANO_2_ID: StoryImageModelId = 'google/gemini-3.1-flash-image-preview'
const STORY_IMAGE_MODEL_GROK_ID: StoryImageModelId = 'grok-imagine-image-pro'
const STORY_DEFAULT_IMAGE_MODEL_ID: StoryImageModelId = STORY_IMAGE_MODEL_FLUX_ID
const STORY_AUTOSCROLL_BOTTOM_THRESHOLD = 72
const STORY_CONTINUE_PROMPT = 'Продолжай'
type StoryNarratorStat = {
  label: string
  value: number
}

type StoryNarratorModelOption = {
  id: StoryNarratorModelId
  title: string
  description: string
  portraitSrc: string
  portraitAlt: string
  stats: StoryNarratorStat[]
}

const NARRATOR_STAT_DOT_COUNT = 5

const STORY_NARRATOR_MODEL_OPTIONS: StoryNarratorModelOption[] = [
  {
    id: 'z-ai/glm-5',
    title: 'GLM 5.0',
    description:
      'Сбалансированная модель для стабильного повествования. Хорошо держит инструкции, аккуратно ведет сцену и обычно пишет чище остальных.',
    portraitSrc: narratorOgmaPortrait,
    portraitAlt: 'GLM 5.0',
    stats: [
      { label: 'Интеллект', value: 4 },
      { label: 'Скорость', value: 3 },
      { label: 'Глубина', value: 3 },
    ],
  },
  {
    id: 'z-ai/glm-4.7',
    title: 'GLM 4.7',
    description:
      'Более мягкая и эмоциональная вариация повествования. Часто пишет живо и естественно, но в целом спокойнее и медленнее, чем GLM 5.0.',
    portraitSrc: narratorFreyaPortrait,
    portraitAlt: 'GLM 4.7',
    stats: [
      { label: 'Интеллект', value: 3 },
      { label: 'Скорость', value: 2 },
      { label: 'Глубина', value: 3 },
    ],
  },
  {
    id: 'deepseek/deepseek-v3.2',
    title: 'DeepSeek V3.2',
    description:
      'Быстрая и энергичная модель для длинных сцен. Хорошо двигает сюжет вперед, но требует особенно четких инструкций и строгого контроля формата.',
    portraitSrc: narratorVelesPortrait,
    portraitAlt: 'DeepSeek V3.2',
    stats: [
      { label: 'Интеллект', value: 3 },
      { label: 'Скорость', value: 4 },
      { label: 'Глубина', value: 4 },
    ],
  },
  {
    id: 'x-ai/grok-4.1-fast',
    title: 'Grok 4.1 Fast',
    description:
      'Очень быстрая модель с резким темпом ответа. Может быть смелой и поверхностной, поэтому лучше подходит для динамичных сцен, чем для тонкой дисциплины.',
    portraitSrc: narratorIlonPortrait,
    portraitAlt: 'Grok 4.1 Fast',
    stats: [
      { label: 'Интеллект', value: 5 },
      { label: 'Скорость', value: 5 },
      { label: 'Глубина', value: 1 },
    ],
  },
  {
    id: 'arcee-ai/trinity-large-preview:free',
    title: 'Trinity',
    description:
      'Легкая модель для коротких сцен и быстрых проб. Может идти по своим рельсам, поэтому лучше чувствует себя в простых играх с минимальным числом правил.',
    portraitSrc: narratorIsidaPortrait,
    portraitAlt: 'Trinity',
    stats: [
      { label: 'Интеллект', value: 2 },
      { label: 'Скорость', value: 4 },
      { label: 'Глубина', value: 3 },
    ],
  },
]
const STORY_IMAGE_MODEL_OPTIONS: Array<{
  id: StoryImageModelId
  title: string
  description: string
  priceLabel: string
}> = [
  {
    id: STORY_IMAGE_MODEL_FLUX_ID,
    title: 'Flux',
    description: '3 сола за генерацию кадра.',
    priceLabel: '3 \u0441\u043e\u043b\u0430',
  },
  {
    id: STORY_IMAGE_MODEL_SEEDREAM_ID,
    title: 'Seedream',
    description: '5 солов за генерацию кадра.',
    priceLabel: '5 \u0441\u043e\u043b\u043e\u0432',
  },
  {
    id: STORY_IMAGE_MODEL_NANO_BANANO_ID,
    title: 'Nano Banano',
    description: '15 солов за генерацию кадра.',
    priceLabel: '15 \u0441\u043e\u043b\u043e\u0432',
  },
  {
    id: STORY_IMAGE_MODEL_NANO_BANANO_2_ID,
    title: 'Nano Banano 2',
    description: '30 sols per scene generation.',
    priceLabel: '30 \u0441\u043e\u043b\u043e\u0432',
  },
  {
    id: STORY_IMAGE_MODEL_GROK_ID,
    title: 'Grok (VPN!)',
    description: '30 солов за генерацию кадра.',
    priceLabel: '30 \u0441\u043e\u043b\u043e\u0432',
  },
]
const STORY_SETTINGS_INFO_TEXT = {
  narrator:
    'Выберите модель рассказчика. DeepSeek V3.2 быстрее и агрессивнее двигает сюжет, GLM 5.0 стабильнее держит инструкции и язык, GLM 4.7 мягче по стилю, Trinity проще и легче, а Grok 4.1 Fast отвечает очень быстро, но может быть поверхностнее.',
  artist:
    'Выберите ИИ-модель генерации изображения. У каждой своя цена, в зависимости от дороговизны модели.',
  contextLimit:
    'Ограничение памяти истории ИИ. Чем больше ограничение, тем дороже ход. Текущие списания: до 1500 — 1 сол, 1500–3000 — 2 сола, 3000–4000 — 3 сола, 4000–5500 — 4 сола, 5500–7000 — 5 солов, 7000–8500 — 6 солов, 8500–10000 — 7 солов, 10000–11500 — 8 солов, 11500–13000 — 9 солов, 13000–15000 — 10 солов.',
  responseTokens: 'Ограничьте объем ответа ИИ точечно в токенах.',
  showGgThoughts: 'Настройка того, будет ли ИИ генерировать и транслировать мысли вашего ГГ.',
  showNpcThoughts: 'Настройка того, будет ли ИИ генерировать и транслировать мысли NPC.',
  memoryOptimization:
    'Помогает дольше помнить старые события, ужимая память без потери смысла и важных деталей.',
  ambient:
    'БЕТА. Подсветка вокруг поля ввода меняется по окружению сцены (фон, свет, погода, локация) и использует 2-3 цвета. Включение стоит +1 сол за каждый ход, а ответ может генерироваться дольше.',
  temperature:
    'ТОЛЬКО ДЛЯ ОПЫТНЫХ. Настройка того, насколько креативно и смело будет отвечать ИИ.',
  contextUsage: 'Следите за тем, сколько у вас осталось места в памяти истории для ИИ.',
} as const

function formatStoryImageModelLabel(option: { title: string; priceLabel: string }): string {
  return `${option.title} (${option.priceLabel})`
}

function SettingsInfoTooltipIcon({ text }: { text: string }) {
  return (
    <Tooltip
      arrow
      placement="top-start"
      enterTouchDelay={0}
      title={<Box sx={{ maxWidth: 276, whiteSpace: 'normal' }}>{text}</Box>}
      componentsProps={{
        tooltip: {
          sx: {
            borderRadius: '11px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 95%, #000 5%) 0%, var(--morius-card-bg) 100%)',
            color: 'var(--morius-text-primary)',
            fontSize: '0.76rem',
            fontWeight: 600,
            lineHeight: 1.38,
            p: 0.95,
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.4)',
          },
        },
        arrow: {
          sx: {
            color: 'var(--morius-card-bg)',
          },
        },
      }}
    >
      <Box
        component="span"
        sx={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-title-text) 68%, transparent)',
          color: 'var(--morius-title-text)',
          fontSize: '0.68rem',
          fontWeight: 800,
          lineHeight: 1,
          cursor: 'help',
          flexShrink: 0,
          userSelect: 'none',
          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 92%, transparent)',
        }}
      >
        i
      </Box>
    </Tooltip>
  )
}

function RightPanelWorldIcon() {
  return (
    <SvgIcon viewBox="0 0 20 20" sx={{ width: 22, height: 22 }}>
      <path
        d="M10 0C15.523 0 20 4.477 20 10C20 15.523 15.523 20 10 20C4.477 20 0 15.523 0 10C0 4.477 4.477 0 10 0ZM12 11.4L10.436 12.651C10.3811 12.6949 10.3361 12.75 10.3039 12.8125C10.2717 12.875 10.2531 12.9436 10.2492 13.0138C10.2453 13.084 10.2563 13.1543 10.2814 13.22C10.3066 13.2856 10.3453 13.3453 10.395 13.395L11.634 14.634C11.8739 14.8742 12.0487 15.1715 12.142 15.498L12.317 16.111C12.3896 16.3682 12.5185 16.606 12.6944 16.8072C12.8703 17.0083 13.0888 17.1678 13.334 17.274C14.2908 16.835 15.1516 16.2114 15.867 15.439L15.633 13.562C15.5921 13.2354 15.4711 12.924 15.281 12.6554C15.0909 12.3868 14.8374 12.1692 14.543 12.022L13.073 11.286C12.902 11.2004 12.71 11.1657 12.5198 11.1859C12.3296 11.2061 12.1492 11.2804 12 11.4ZM10 2C8.77609 1.99918 7.56835 2.27955 6.46996 2.81947C5.37158 3.35938 4.41191 4.14442 3.665 5.114L3.5 5.335V7.02C3.49987 7.6305 3.68601 8.22651 4.03355 8.72844C4.38109 9.23036 4.87349 9.61431 5.445 9.829L5.623 9.889L6.913 10.284C8.286 10.704 9.623 9.587 9.49 8.188L9.471 8.043L9.296 6.994C9.25733 6.76163 9.30193 6.52307 9.42194 6.32037C9.54195 6.11767 9.72967 5.96384 9.952 5.886L10.06 5.856L10.672 5.716C11.0192 5.63663 11.3471 5.48851 11.6361 5.28038C11.9252 5.07225 12.1696 4.80833 12.355 4.50419C12.5404 4.20005 12.663 3.86185 12.7155 3.50955C12.7681 3.15726 12.7496 2.79801 12.661 2.453C11.8061 2.15237 10.9063 1.99919 10 2Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function RightPanelAiIcon() {
  return (
    <SvgIcon viewBox="0 0 20 20" sx={{ width: 22, height: 22 }}>
      <path
        d="M7.01238 3.448C7.61038 1.698 10.0284 1.645 10.7374 3.289L10.7974 3.449L11.6044 5.809C11.7893 6.35023 12.0882 6.84551 12.4808 7.26142C12.8734 7.67734 13.3507 8.00421 13.8804 8.22L14.0974 8.301L16.4574 9.107C18.2074 9.705 18.2604 12.123 16.6174 12.832L16.4574 12.892L14.0974 13.699C13.556 13.8838 13.0605 14.1826 12.6444 14.5753C12.2283 14.9679 11.9013 15.4452 11.6854 15.975L11.6044 16.191L10.7984 18.552C10.2004 20.302 7.78238 20.355 7.07438 18.712L7.01238 18.552L6.20638 16.192C6.02156 15.6506 5.72275 15.1551 5.33012 14.739C4.93749 14.3229 4.46017 13.9959 3.93038 13.78L3.71438 13.699L1.35438 12.893C-0.396622 12.295 -0.449622 9.877 1.19438 9.169L1.35438 9.107L3.71438 8.301C4.25561 8.11606 4.75089 7.81719 5.1668 7.42457C5.58271 7.03195 5.90959 6.55469 6.12538 6.025L6.20638 5.809L7.01238 3.448ZM16.9054 1.80688e-07C17.0925 -2.35972e-07 17.2758 0.0524783 17.4345 0.151472C17.5933 0.250465 17.7211 0.392003 17.8034 0.56L17.8514 0.677L18.2014 1.703L19.2284 2.053C19.4159 2.1167 19.5802 2.23462 19.7006 2.39182C19.821 2.54902 19.892 2.73842 19.9047 2.93602C19.9173 3.13362 19.871 3.33053 19.7716 3.50179C19.6722 3.67304 19.5242 3.81094 19.3464 3.898L19.2284 3.946L18.2024 4.296L17.8524 5.323C17.7886 5.51043 17.6706 5.6747 17.5133 5.79499C17.356 5.91529 17.1666 5.98619 16.969 5.99872C16.7714 6.01125 16.5746 5.96484 16.4034 5.86538C16.2322 5.76591 16.0944 5.61787 16.0074 5.44L15.9594 5.323L15.6094 4.297L14.5824 3.947C14.3949 3.8833 14.2305 3.76538 14.1101 3.60819C13.9898 3.45099 13.9187 3.26158 13.9061 3.06398C13.8935 2.86638 13.9398 2.66947 14.0392 2.49821C14.1385 2.32696 14.2865 2.18906 14.4644 2.102L14.5824 2.054L15.6084 1.704L15.9584 0.677C16.0258 0.479426 16.1534 0.307909 16.3232 0.186499C16.493 0.065089 16.6966 -0.000125281 16.9054 1.80688e-07Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function RightPanelMemoryIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 21, height: 21 }}>
      <path
        d="M7 4h10a2 2 0 0 1 2 2v3h1a1 1 0 1 1 0 2h-1v2h1a1 1 0 1 1 0 2h-1v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H4a1 1 0 1 1 0-2h1v-2H4a1 1 0 1 1 0-2h1V6a2 2 0 0 1 2-2Zm0 2v12h10V6H7Zm2 2h6v2H9V8Zm0 4h2v2H9v-2Zm4 0h2v2h-2v-2Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function ComposerGenerateImageIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-2 0H5l3.5-4.5 2.5 3.01L14.5 13l4.5 6zM8.5 9.5A1.5 1.5 0 1 0 8.5 6a1.5 1.5 0 0 0 0 3.5z"
        fill="currentColor"
      />
      <path
        d="M18.8 1.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function ComposerRegenerateImageIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
      <path
        d="M12 6V3L8 7l4 4V8c2.21 0 4 1.79 4 4 0 .73-.2 1.41-.54 2h2.13c.26-.63.41-1.31.41-2 0-3.31-2.69-6-6-6zm-4 4c0-.73.2-1.41.54-2H6.41C6.15 8.63 6 9.31 6 10c0 3.31 2.69 6 6 6v3l4-4-4-4v3c-2.21 0-4-1.79-4-4z"
        stroke="currentColor"
        strokeWidth="0.45"
      />
      <path
        d="M18.8 1.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z"
        fill="currentColor"
      />
      <path
        d="M4 5h10v8H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </SvgIcon>
  )
}

function ComposerMicIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 'var(--morius-action-icon-size)', height: 'var(--morius-action-icon-size)' }}>
      <path
        d="M12 15c1.66 0 3-1.34 3-3V6a3 3 0 0 0-6 0v6c0 1.66 1.34 3 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 1 0 10 0z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function RightPanelEmptyState({
  iconSrc,
  title,
  description,
  tourId,
}: {
  iconSrc: string
  title: string
  description: string
  tourId?: string
}) {
  return (
    <Box
      data-tour-id={tourId}
      sx={{
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent) 0%, color-mix(in srgb, var(--morius-card-bg) 94%, transparent) 100%)',
        px: 1,
        py: 0.95,
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '10px',
            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Box component="img" src={iconSrc} alt="" sx={{ width: 17, height: 17, opacity: 0.92 }} />
        </Box>
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.91rem', fontWeight: 700 }}>{title}</Typography>
      </Stack>
      <Typography sx={{ mt: 0.72, color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.42 }}>
        {description}
      </Typography>
    </Box>
  )
}

function getStoryTurnImageRequestTimeoutMs(modelId: StoryImageModelId): number {
  if (modelId === STORY_IMAGE_MODEL_GROK_ID || modelId === STORY_IMAGE_MODEL_NANO_BANANO_2_ID) {
    return STORY_TURN_IMAGE_REQUEST_TIMEOUT_GROK_MS
  }
  return STORY_TURN_IMAGE_REQUEST_TIMEOUT_DEFAULT_MS
}

type BrowserSpeechRecognitionResultAlternative = {
  transcript?: string
}

type BrowserSpeechRecognitionResultList = ArrayLike<ArrayLike<BrowserSpeechRecognitionResultAlternative>>

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition

const MOBILE_COMPOSER_MEDIA_QUERY = '(pointer: coarse), (max-width: 899px)'

function isMobileComposerViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(MOBILE_COMPOSER_MEDIA_QUERY).matches
}

function resolveSpeechRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === 'undefined') {
    return null
  }
  const extendedWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor
  }
  return extendedWindow.SpeechRecognition ?? extendedWindow.webkitSpeechRecognition ?? null
}

function moveContentEditableCaretToEnd(element: HTMLDivElement): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const selection = window.getSelection()
  if (!selection) {
    return
  }
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function truncateContentEditableText(element: HTMLDivElement, maxLength: number): string {
  const rawText = element.textContent ?? ''
  const nextText = rawText.slice(0, maxLength)
  if (nextText !== rawText) {
    element.textContent = nextText
    moveContentEditableCaretToEnd(element)
  }
  return nextText
}

const RIGHT_PANEL_WIDTH_MIN = 300
const RIGHT_PANEL_WIDTH_MAX = 460
const RIGHT_PANEL_WIDTH_DEFAULT = 332
const RIGHT_PANEL_CARD_HEIGHT = 198
const ASSISTANT_DIALOGUE_AVATAR_SIZE = 30
const ASSISTANT_DIALOGUE_AVATAR_GAP = 0.9
const STRUCTURED_MARKER_START_PATTERN = /^\[\[\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]*)$/iu
const STRUCTURED_MARKER_LINE_START_PATTERN = /^\[\[\s*[A-Za-z\u0400-\u04FF_ -]+(?:\s*:\s*[^\]]+?)?\s*\]\]/u
const STRUCTURED_MARKER_INLINE_SPLIT_PATTERN = /\[\[\s*[A-Za-z\u0400-\u04FF_ -]+(?:\s*:\s*[^\]]+?)?\s*\]\]/giu
const STRUCTURED_MARKER_STANDALONE_PATTERN = /^\[\[\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*$/iu
const STRUCTURED_TAG_PATTERN = /^<\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)<\/\s*([A-Za-z\u0400-\u04FF_ -]+)\s*>$/iu
const GENERIC_DIALOGUE_SPEAKER_DEFAULT = 'НПС'
const MAIN_HERO_SPEAKER_ALIASES = ['ГГ', 'Главный герой', 'Главный Герой', 'Main hero', 'Main character', 'MC', 'Hero'] as const
const MAIN_HERO_INLINE_TAG_PATTERN = /\[\[\s*GG(?:\s*:\s*([^\]]+?))?\s*\]\]/giu
const MAIN_HERO_FALLBACK_NAME = 'Главный Герой'
const SPEAKER_REFERENCE_PREFIX_PATTERN = /^(?:char|character|\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436)\s*:\s*/iu
const STORY_TOKEN_ESTIMATE_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+|[^\s]/gi
const STORY_SENTENCE_MATCH_PATTERN = /[^.!?…]+[.!?…]?/gu
const STORY_BULLET_PREFIX_PATTERN = /^\s*[-•*]+\s*/u
const STORY_MATCH_TOKEN_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+/gi
const STORY_CYRILLIC_TOKEN_PATTERN = /^[\u0430-\u044f\u0451]+$/i
const DIALOGUE_QUOTE_CUE_PATTERN = /["'\u00ab\u00bb\u201e\u201c\u201d]/u
const DIALOGUE_DASH_START_CUE_PATTERN = /^\s*(?:\u2014|-)\s*\S/u
const DIALOGUE_DASH_AFTER_PUNCT_CUE_PATTERN = /[.!?\u2026]\s*(?:\u2014|-)\s*\S/u
const FIRST_OR_SECOND_PERSON_PRONOUN_PATTERN =
  /\b(?:\u044f|\u043c\u0435\u043d\u044f|\u043c\u043d\u0435|\u043c\u043d\u043e\u0439|\u043c\u044b|\u043d\u0430\u0441|\u043d\u0430\u043c|\u043d\u0430\u0448|\u043d\u0430\u0448\u0430|\u043d\u0430\u0448\u0435|\u043d\u0430\u0448\u0438|\u0442\u044b|\u0442\u0435\u0431\u044f|\u0442\u0435\u0431\u0435|\u0442\u043e\u0431\u043e\u0439|\u0432\u044b|\u0432\u0430\u0441|\u0432\u0430\u043c|\u0432\u0430\u043c\u0438|\u0432\u0430\u0448|\u0432\u0430\u0448\u0430|\u0432\u0430\u0448\u0435|\u0432\u0430\u0448\u0438|i|me|my|mine|we|us|our|ours|you|your|yours)\b/iu
const THIRD_PERSON_NARRATIVE_START_PATTERN =
  /^(?:\u043e\u043d|\u043e\u043d\u0430|\u043e\u043d\u0438|\u0435\u0433\u043e|\u0435\u0451|\u0435\u0435|\u0438\u0445|\u043a\u0442\u043e-\u0442\u043e|\u043a\u0442\u043e \u0442\u043e|he|she|they|his|her|their)\b/iu
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
const NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS = 3
const NPC_WORLD_CARD_MEMORY_TURNS_DISABLED = 0
const NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS = [NPC_WORLD_CARD_MEMORY_TURNS_DISABLED, 3, 5, 10] as const
type NpcMemoryTurnsOption = (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number] | null
const PLOT_CARD_TRIGGER_ACTIVE_TURNS = 2
const PLOT_CARD_MEMORY_TURNS_OPTIONS = [2, 3, 5, 10, 15] as const
type PlotMemoryTurnsOption = (typeof PLOT_CARD_MEMORY_TURNS_OPTIONS)[number] | null
const CONTEXT_NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU')
const WORLD_CARD_EVENT_STATUS_LABEL: Record<'added' | 'updated' | 'deleted', string> = {
  added: 'Добавлено',
  updated: 'Обновлено',
  deleted: 'Удалено',
}
const AI_MEMORY_LAYER_LABEL: Record<'raw' | 'compressed' | 'super', string> = {
  raw: 'Свежие блоки В· 50%',
  compressed: 'Сжатые блоки В· 30%',
  super: 'Суперсжатые блоки В· 20%',
}
type WorldCardContextState = {
  isActive: boolean
  isAlwaysActive: boolean
  memoryTurns: number | null
  turnsRemaining: number
  lastTriggerTurn: number | null
  isTriggeredThisTurn: boolean
}
type PlotCardContextState = {
  isActive: boolean
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
const STORY_AMBIENT_YAMI_PROFILE: StoryAmbientProfile = {
  scene: 'unknown',
  lighting: 'dim',
  primary_color: '#2A2323',
  secondary_color: '#222222',
  highlight_color: '#FF6666',
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

function splitAssistantParagraphByInlineMarkers(paragraph: string): string[] {
  const normalized = paragraph.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const matches = [...normalized.matchAll(STRUCTURED_MARKER_INLINE_SPLIT_PATTERN)]
  if (matches.length === 0) {
    return [normalized]
  }

  const chunks: string[] = []
  const firstMatchIndex = matches[0]?.index ?? -1
  if (firstMatchIndex < 0) {
    return [normalized]
  }

  const leadingText = normalized.slice(0, firstMatchIndex).trim()
  if (leadingText) {
    chunks.push(leadingText)
  }

  for (let index = 0; index < matches.length; index += 1) {
    const currentMatch = matches[index]
    const markerToken = (currentMatch?.[0] ?? '').trim()
    if (!markerToken) {
      continue
    }
    const markerEnd = (currentMatch?.index ?? 0) + markerToken.length
    const nextMatchStart = matches[index + 1]?.index ?? normalized.length
    const segmentText = normalized.slice(markerEnd, nextMatchStart).trim()
    if (segmentText) {
      chunks.push(`${markerToken} ${segmentText}`.trim())
      continue
    }
    chunks.push(markerToken)
  }

  return chunks.length > 0 ? chunks : [normalized]
}

function normalizeAssistantStructuredParagraphs(content: string): string {
  const baseParagraphs = splitAssistantParagraphs(mergeAssistantOrphanStructuredParagraphs(content))
  const normalizedParagraphs: string[] = []
  baseParagraphs.forEach((paragraph) => {
    normalizedParagraphs.push(...splitAssistantParagraphByInlineMarkers(paragraph))
  })
  return normalizedParagraphs.join('\n\n').trim()
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
  const normalizedKey = value.toLowerCase().replace(/[\s-]+/g, '_').replace(/ё/g, 'е').trim()
  const compactKey = normalizedKey.replace(/_/g, '')
  const aliasKeyByCompact: Record<string, string> = {
    narrator: 'narrator',
    narration: 'narration',
    narrative: 'narrative',
    '\u0440\u0430\u0441\u0441\u043a\u0430\u0437\u0447\u0438\u043a': 'narrator',
    '\u043d\u0430\u0440\u0440\u0430\u0442\u043e\u0440': 'narrator',
    '\u043f\u043e\u0432\u0435\u0441\u0442\u0432\u043e\u0432\u0430\u043d\u0438\u0435': 'narration',
    npc: 'npc',
    '\u043d\u043f\u0441': 'npc',
    '\u043d\u043f\u043a': 'npc',
    npcreplick: 'npc',
    npcreplica: 'npc',
    npcspeech: 'npc',
    npcdialogue: 'npc',
    gg: 'gg',
    '\u0433\u0433': 'gg',
    ggreplick: 'gg',
    ggreplica: 'gg',
    ggspeech: 'gg',
    ggdialogue: 'gg',
    mc: 'mc',
    mainhero: 'mainhero',
    maincharacter: 'mainhero',
    say: 'say',
    speech: 'speech',
    npcthought: 'npc_thought',
    npcthink: 'npc_thought',
    ggthought: 'gg_thought',
    ggthink: 'gg_thought',
    thought: 'thought',
    think: 'think',
    '\u043d\u043f\u0441\u043c\u044b\u0441\u043b\u044c': 'npc_thought',
    '\u043d\u043f\u0441\u043c\u044b\u0441\u043b\u0438': 'npc_thought',
    '\u043d\u043f\u043a\u043c\u044b\u0441\u043b\u044c': 'npc_thought',
    '\u043d\u043f\u043a\u043c\u044b\u0441\u043b\u0438': 'npc_thought',
    '\u0433\u0433\u043c\u044b\u0441\u043b\u044c': 'gg_thought',
    '\u0433\u0433\u043c\u044b\u0441\u043b\u0438': 'gg_thought',
  }
  return aliasKeyByCompact[compactKey] ?? normalizedKey
}

function resolveMainHeroDisplayName(rawMainHeroName: string | null | undefined): string {
  const normalizedMainHeroName = (rawMainHeroName ?? '').replace(/\s+/g, ' ').trim()
  return normalizedMainHeroName || MAIN_HERO_FALLBACK_NAME
}

function normalizeMainHeroInlineFallbackName(rawValue: string | null | undefined): string {
  const normalizedValue = (rawValue ?? '').replace(/\s+/g, ' ').trim()
  if (!normalizedValue) {
    return MAIN_HERO_FALLBACK_NAME
  }
  return normalizedValue.toLowerCase().replace(/ё/g, 'е') === 'главный герой'
    ? MAIN_HERO_FALLBACK_NAME
    : normalizedValue
}

function replaceMainHeroInlineTags(value: string, rawMainHeroName: string | null | undefined): string {
  if (!value || !value.includes('[[')) {
    return value
  }
  const normalizedMainHeroName = (rawMainHeroName ?? '').replace(/\s+/g, ' ').trim()
  return value.replace(MAIN_HERO_INLINE_TAG_PATTERN, (_fullMatch, inlineFallbackName: string | undefined) => {
    return normalizedMainHeroName || normalizeMainHeroInlineFallbackName(inlineFallbackName)
  })
}

function mergeAssistantOrphanStructuredParagraphs(content: string): string {
  const paragraphs = splitAssistantParagraphs(content)
  const mergedParagraphs: string[] = []
  let pendingMarker = ''

  paragraphs.forEach((paragraph) => {
    const lines = paragraph
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      return
    }

    const firstLine = lines[0] ?? ''
    if (pendingMarker) {
      if (!STRUCTURED_MARKER_LINE_START_PATTERN.test(firstLine)) {
        mergedParagraphs.push(`${pendingMarker} ${lines.join(' ')}`.trim())
        pendingMarker = ''
        return
      }
      pendingMarker = ''
    }

    if (STRUCTURED_MARKER_STANDALONE_PATTERN.test(firstLine)) {
      if (lines.length === 1) {
        pendingMarker = firstLine
        return
      }
      const trailingText = lines.slice(1).join(' ').trim()
      if (!trailingText) {
        pendingMarker = firstLine
        return
      }
      if (STRUCTURED_MARKER_LINE_START_PATTERN.test(trailingText)) {
        mergedParagraphs.push(trailingText)
        return
      }
      mergedParagraphs.push(`${firstLine} ${trailingText}`.trim())
      return
    }

    mergedParagraphs.push(lines.join('\n'))
  })

  return mergedParagraphs.join('\n\n').trim()
}

function normalizeAssistantSpeakerName(rawValue: string | null | undefined): string {
  return (rawValue ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«„]+|["'»”]+$/g, '')
    .trim()
    .replace(/^[\s.,:;!?()[\]-]+|[\s.,:;!?()[\]-]+$/gu, '')
    .trim()
}

function stripLeadingStructuredMarkerLines(value: string): string {
  let normalized = value.replace(/\r\n/g, '\n').trim()
  while (true) {
    const nextValue = normalized.replace(
      /^\[\[\s*[A-Za-z\u0400-\u04FF_ -]+(?:\s*:\s*[^\]]+?)?\s*\]\]\s*(?:\n+\s*|\s+)/u,
      '',
    ).trim()
    if (nextValue === normalized) {
      return normalized
    }
    normalized = nextValue
  }
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

function resolveAssistantBareSpeakerMarkerName(
  rawMarkerName: string,
  rawSpeakerName: string | null | undefined,
): string | null {
  const explicitSpeakerName = normalizeAssistantSpeakerName(rawSpeakerName)
  if (explicitSpeakerName) {
    return null
  }

  const speakerName = normalizeAssistantSpeakerName(rawMarkerName)
  if (!speakerName) {
    return null
  }

  const markerKind = resolveAssistantMarkerKind(normalizeAssistantMarkerKey(speakerName))
  if (markerKind) {
    return null
  }

  return speakerName
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

  const rawMarkerName = markerMatch[1]?.trim() ?? ''
  const rawSpeakerName = markerMatch[2]?.trim() ?? ''
  let markerKind = resolveAssistantMarkerKind(normalizeAssistantMarkerKey(rawMarkerName))
  let speakerName = normalizeAssistantSpeakerName(rawSpeakerName)
  if (!markerKind) {
    speakerName = resolveAssistantBareSpeakerMarkerName(rawMarkerName, rawSpeakerName) ?? ''
    if (!speakerName) {
      return null
    }
    markerKind = 'speech'
  }

  const bodyText = stripLeadingStructuredMarkerLines(markerMatch[3].trim())
  if (!bodyText) {
    return null
  }

  if (markerKind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

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

  const bodyText = stripLeadingStructuredMarkerLines(tagMatch[3].trim())
  if (!bodyText) {
    return null
  }

  if (tagDescriptor.kind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  const rawSpeakerName = tagMatch[2]?.trim() ?? ''
  const explicitSpeakerName = normalizeAssistantSpeakerName(rawSpeakerName)
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
  const normalized = normalizeAssistantStructuredParagraphs(content)
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

function isLikelyNarrativeSpeechLine(text: string, speakerName: string): boolean {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  if (!normalizedText) {
    return true
  }
  if (
    DIALOGUE_QUOTE_CUE_PATTERN.test(normalizedText) ||
    DIALOGUE_DASH_START_CUE_PATTERN.test(normalizedText) ||
    DIALOGUE_DASH_AFTER_PUNCT_CUE_PATTERN.test(normalizedText) ||
    FIRST_OR_SECOND_PERSON_PRONOUN_PATTERN.test(normalizedText)
  ) {
    return false
  }

  const normalizedLine = normalizedText.replace(/^[\s"'.,:;!?()[\]\u00ab\u00bb\u201e\u201c\u201d-]+/u, '').toLowerCase()
  if (THIRD_PERSON_NARRATIVE_START_PATTERN.test(normalizedLine)) {
    return true
  }

  const normalizedSpeakerName = speakerName.replace(/\s+/g, ' ').trim().toLowerCase()
  return Boolean(normalizedSpeakerName) && normalizedLine.startsWith(`${normalizedSpeakerName} `)
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
  const nextBlocks = normalizedText
    ? blocks.map((block, index) => (index === blockIndex ? { ...block, text: normalizedText } : block))
    : blocks.filter((_, index) => index !== blockIndex)
  if (nextBlocks.length === 0) {
    return null
  }

  const serialized = serializeAssistantMessageBlocks(nextBlocks)
  return serialized || null
}

const LATIN_TO_CYRILLIC_NAME_DIGRAPHS: Array<[string, string]> = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['yo', 'ё'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'р'],
  ['ye', 'е'],
]

const LATIN_TO_CYRILLIC_NAME_MAP: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'й',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  y: 'и',
  z: 'з',
}

function transliterateLatinNameToCyrillic(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z\s-]/g, ' ').trim()
  if (!normalized) {
    return ''
  }

  let converted = normalized
  LATIN_TO_CYRILLIC_NAME_DIGRAPHS.forEach(([latin, cyrillic]) => {
    converted = converted.split(latin).join(cyrillic)
  })

  const transliterated = converted
    .split('')
    .map((char) => (/[a-z]/.test(char) ? (LATIN_TO_CYRILLIC_NAME_MAP[char] ?? char) : char))
    .join('')

  return transliterated.replace(/\s+/g, ' ').trim()
}

function normalizeCharacterIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCharacterNoteValue(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STORY_CHARACTER_NOTE_MAX_LENGTH)
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
  const addTransliterated = (value: string) => {
    const hasLatin = /[a-z]/i.test(value)
    const hasCyrillic = /[а-яё]/i.test(value)
    if (!hasLatin || hasCyrillic) {
      return
    }
    const transliterated = transliterateLatinNameToCyrillic(value)
    if (transliterated) {
      values.add(transliterated)
    }
  }
  addTransliterated(normalizedSpeakerName)

  if (normalizedSpeakerName.startsWith('@')) {
    const withoutAt = normalizedSpeakerName.slice(1).trim()
    if (withoutAt) {
      values.add(withoutAt)
      addTransliterated(withoutAt)
      const withoutAtAndPrefix = withoutAt.replace(SPEAKER_REFERENCE_PREFIX_PATTERN, '').trim()
      if (withoutAtAndPrefix) {
        values.add(withoutAtAndPrefix)
        addTransliterated(withoutAtAndPrefix)
      }
    }
  }

  const withoutPrefix = normalizedSpeakerName.replace(SPEAKER_REFERENCE_PREFIX_PATTERN, '').trim()
  if (withoutPrefix && withoutPrefix !== normalizedSpeakerName) {
    values.add(withoutPrefix)
    addTransliterated(withoutPrefix)
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
    triggers: snapshot.triggers,
    memory_turns: snapshot.memory_turns,
    ai_edit_enabled: snapshot.ai_edit_enabled,
    is_enabled: snapshot.is_enabled,
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

function normalizeWorldCardTriggersDraft(draft: string, fallbackTitle?: string): string[] {
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
  if (fallbackTitle) {
    pushTrigger(fallbackTitle)
  }

  return normalized.slice(0, 40)
}

function normalizePlotCardTriggersDraft(draft: string): string[] {
  return normalizeWorldCardTriggersDraft(draft).slice(0, 40)
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

function getStoryTurnCostTokens(contextUsageTokens: number, ambientEnabled: boolean): number {
  const normalizedUsage = Math.max(0, Math.round(contextUsageTokens))
  let baseCost = 10
  if (normalizedUsage <= STORY_TURN_COST_STAGE_1_CONTEXT_LIMIT_MAX) {
    baseCost = 1
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_2_CONTEXT_LIMIT_MAX) {
    baseCost = 2
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_3_CONTEXT_LIMIT_MAX) {
    baseCost = 3
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_4_CONTEXT_LIMIT_MAX) {
    baseCost = 4
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_5_CONTEXT_LIMIT_MAX) {
    baseCost = 5
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_6_CONTEXT_LIMIT_MAX) {
    baseCost = 6
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_7_CONTEXT_LIMIT_MAX) {
    baseCost = 7
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_8_CONTEXT_LIMIT_MAX) {
    baseCost = 8
  } else if (normalizedUsage <= STORY_TURN_COST_STAGE_9_CONTEXT_LIMIT_MAX) {
    baseCost = 9
  }
  return ambientEnabled ? baseCost + 1 : baseCost
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

function clampStoryTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_TEMPERATURE
  }
  const clampedValue = Math.min(STORY_TEMPERATURE_MAX, Math.max(STORY_TEMPERATURE_MIN, value))
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
    .map((message) => `${message.role === 'user' ? 'грок' : ''}: ${message.content}`)
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

function countStoryCompletedTurns(messages: StoryMessage[]): number {
  let completedTurns = 0
  let hasPendingUserTurn = false

  messages.forEach((message) => {
    if (message.role === 'user') {
      hasPendingUserTurn = true
      return
    }
    if (message.role === 'assistant' && hasPendingUserTurn) {
      completedTurns += 1
      hasPendingUserTurn = false
    }
  })

  return completedTurns
}

function resolveWorldCardMemoryTurns(card: Pick<StoryWorldCard, 'kind' | 'memory_turns'>): number | null {
  if (card.kind === 'main_hero') {
    return null
  }
  if (card.memory_turns === null) {
    return null
  }
  if (typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns)) {
    const roundedTurns = Math.round(card.memory_turns)
    if (roundedTurns <= NPC_WORLD_CARD_MEMORY_TURNS_DISABLED) {
      return NPC_WORLD_CARD_MEMORY_TURNS_DISABLED
    }
    return roundedTurns
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
  if (memoryTurns <= NPC_WORLD_CARD_MEMORY_TURNS_DISABLED) {
    return 'выключено'
  }
  return `${memoryTurns} ${formatTurnsWord(memoryTurns)}`
}

function toNpcMemoryTurnsOption(memoryTurns: number | null): NpcMemoryTurnsOption {
  if (memoryTurns === null) {
    return null
  }
  if (memoryTurns <= NPC_WORLD_CARD_MEMORY_TURNS_DISABLED) {
    return NPC_WORLD_CARD_MEMORY_TURNS_DISABLED
  }
  if (NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS.includes(memoryTurns as (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number])) {
    return memoryTurns as (typeof NPC_WORLD_CARD_MEMORY_TURNS_OPTIONS)[number]
  }
  return NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS
}

function resolvePlotCardMemoryTurns(card: Pick<StoryPlotCard, 'memory_turns'>): number | null {
  if (card.memory_turns === null) {
    return null
  }
  if (typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns)) {
    const roundedTurns = Math.round(card.memory_turns)
    if (roundedTurns <= 0) {
      return null
    }
    return roundedTurns
  }
  return PLOT_CARD_TRIGGER_ACTIVE_TURNS
}

function toPlotCardMemoryTurnsOption(memoryTurns: number | null): PlotMemoryTurnsOption {
  if (memoryTurns === null) {
    return null
  }
  if (PLOT_CARD_MEMORY_TURNS_OPTIONS.includes(memoryTurns as (typeof PLOT_CARD_MEMORY_TURNS_OPTIONS)[number])) {
    return memoryTurns as (typeof PLOT_CARD_MEMORY_TURNS_OPTIONS)[number]
  }
  return PLOT_CARD_TRIGGER_ACTIVE_TURNS
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
    return `активна В· +${memoryTurns} ${formatTurnsWord(memoryTurns)}`
  }
  return `активна В· ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
}

function formatPlotCardContextStatus(state: PlotCardContextState | undefined): string {
  if (!state || !state.isActive) {
    return 'неактивна'
  }
  if (state.lastTriggerTurn === null) {
    return 'активна'
  }
  const memoryTurns = state.memoryTurns ?? PLOT_CARD_TRIGGER_ACTIVE_TURNS
  if (state.isTriggeredThisTurn) {
    return `активна В· +${memoryTurns} ${formatTurnsWord(memoryTurns)}`
  }
  return `активна В· ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
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
    if (memoryTurns <= NPC_WORLD_CARD_MEMORY_TURNS_DISABLED) {
      stateById.set(card.id, {
        isActive: false,
        isAlwaysActive: false,
        memoryTurns,
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

function buildPlotCardContextStateById(plotCards: StoryPlotCard[], messages: StoryMessage[]): Map<number, PlotCardContextState> {
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

  const stateById = new Map<number, PlotCardContextState>()
  plotCards.forEach((card) => {
    const memoryTurns = resolvePlotCardMemoryTurns(card)
    const triggers = card.triggers
      .flatMap((trigger) => splitStoryTriggerCandidates(trigger))
      .map((trigger) => trigger.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    if (!card.is_enabled) {
      stateById.set(card.id, {
        isActive: false,
        memoryTurns,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }
    if (triggers.length === 0) {
      stateById.set(card.id, {
        isActive: true,
        memoryTurns,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }
    if (memoryTurns === null || currentTurnIndex <= 0) {
      stateById.set(card.id, {
        isActive: false,
        memoryTurns,
        turnsRemaining: 0,
        lastTriggerTurn: null,
        isTriggeredThisTurn: false,
      })
      return
    }
    let lastTriggerTurn = 0
    turnTokenEntries.forEach(({ turnIndex, tokens }) => {
      const matched = triggers.some((trigger) => isStoryTriggerMatch(trigger, tokens))
      if (matched) {
        lastTriggerTurn = turnIndex
      }
    })

    let isActive = false
    let turnsRemaining = 0
    let isTriggeredThisTurn = false
    if (lastTriggerTurn > 0) {
      const turnsSinceTrigger = currentTurnIndex - lastTriggerTurn
      if (turnsSinceTrigger <= memoryTurns) {
        isActive = true
        turnsRemaining = Math.max(memoryTurns - turnsSinceTrigger, 0)
        isTriggeredThisTurn = turnsSinceTrigger === 0
      }
    }

    stateById.set(card.id, {
      isActive,
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
        bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)',
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
        <Skeleton variant="text" height={30} width="95%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
        <Skeleton variant="text" height={30} width="89%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
        <Skeleton variant="text" height={30} width="64%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
      </Stack>
      <Stack direction="row" spacing={ASSISTANT_DIALOGUE_AVATAR_GAP} alignItems="flex-start">
        <Skeleton
          variant="circular"
          width={ASSISTANT_DIALOGUE_AVATAR_SIZE}
          height={ASSISTANT_DIALOGUE_AVATAR_SIZE}
          sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }}
        />
        <Stack spacing={0.48} sx={{ minWidth: 0, flex: 1 }}>
          <Skeleton variant="text" height={21} width="29%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
          <Skeleton variant="text" height={28} width="92%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
          <Skeleton variant="text" height={28} width="86%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
        </Stack>
      </Stack>
      <Stack spacing={0.52}>
        <Skeleton variant="text" height={30} width="93%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
        <Skeleton variant="text" height={30} width="78%" sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
      </Stack>
    </Stack>
  )
}

function StoryRightPanelLoadingSkeleton() {
  return (
    <Stack spacing={0.88} sx={{ minHeight: 0, flex: 1 }}>
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85, minHeight: 0, flex: 1 }}>
        <Skeleton variant="rounded" height={RIGHT_PANEL_CARD_HEIGHT} sx={{ borderRadius: '12px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 20%, transparent)' }} />
        <Skeleton variant="rounded" height={RIGHT_PANEL_CARD_HEIGHT} sx={{ borderRadius: '12px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 20%, transparent)' }} />
      </Box>
      <Skeleton variant="rounded" height={40} sx={{ borderRadius: '12px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)' }} />
    </Stack>
  )
}

function StoryGamePage({ user, authToken, initialGameId, onNavigate, onLogout, onUserUpdate }: StoryGamePageProps) {
  const {
    themeId,
    storyHistoryFontFamily,
    storyHistoryFontWeight,
    voiceInputEnabled,
    storyHistoryFontFamilyOptions,
    storyHistoryFontWeightOptions,
  } = useMoriusThemeController()
  const isGrayTheme = themeId === 'gray'
  const isYamiTheme = themeId === 'yami-rius'
  const rightPanelActiveTabColor = isYamiTheme ? 'var(--morius-title-text)' : 'var(--morius-accent)'
  const rightPanelTabHoverBackground = isYamiTheme
    ? 'color-mix(in srgb, var(--morius-card-border) 58%, transparent)'
    : 'var(--morius-button-hover)'
  const assistantReplyTextColor = isGrayTheme ? '#CECECE' : 'var(--morius-title-text)'
  const playerMessageColor = isGrayTheme ? '#808080' : 'var(--morius-text-secondary)'
  const switchTrackColor = isGrayTheme ? '#1D1D1D' : (isYamiTheme ? '#333333' : 'var(--morius-card-border)')
  const switchCheckedTrackColor = isGrayTheme ? '#1D1D1D' : (isYamiTheme ? '#333333' : 'var(--morius-button-active)')
  const sliderRailColor = isGrayTheme ? '#1D1D1D' : (isYamiTheme ? '#333333' : 'var(--morius-card-border)')
  const sliderThumbColor = isGrayTheme ? '#939393' : (isYamiTheme ? '#EEEEEE' : 'var(--morius-title-text)')
  const sliderThumbBorderColor = isGrayTheme ? '#1D1D1D' : (isYamiTheme ? '#333333' : 'var(--morius-accent)')
  const assistantSpeakerLabelColor = 'var(--morius-text-primary)'
  const assistantThoughtLabelColor = 'var(--morius-text-secondary)'
  const assistantThoughtTextColor = 'var(--morius-text-primary)'
  const secondaryGameButtonColor = isYamiTheme ? '#EEEEEE' : 'var(--morius-text-secondary)'
  const rightPanelModeInactiveColor = isYamiTheme ? 'var(--morius-text-secondary)' : secondaryGameButtonColor
  const sendButtonIconColor = isYamiTheme ? '#333333' : '#242424'
  const composerUtilityIconFilter = isGrayTheme ? 'grayscale(1) brightness(0.83)' : (isYamiTheme ? 'brightness(1.7) grayscale(1)' : 'none')
  const rightPanelModeButtonSx = (isActive: boolean) => ({
    width: 'var(--morius-action-size)',
    height: 'var(--morius-action-size)',
    borderRadius: 'var(--morius-radius)',
    border: 'none',
    backgroundColor: 'transparent !important',
    color: 'var(--morius-text-secondary) !important',
    '& .MuiSvgIcon-root': {
      color: `${isActive ? 'var(--morius-accent)' : rightPanelModeInactiveColor} !important`,
    },
    '&:hover': {
      backgroundColor: 'transparent !important',
      color: 'var(--morius-text-secondary) !important',
      '& .MuiSvgIcon-root': {
        color: `${isYamiTheme ? (isActive ? 'var(--morius-accent)' : rightPanelModeInactiveColor) : 'var(--morius-accent)'} !important`,
      },
    },
    '&:active': {
      backgroundColor: 'transparent !important',
    },
  })
  const [, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameSummary, setActiveGameSummary] = useState<StoryGameSummary | null>(null)
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [ambientByAssistantMessageId, setAmbientByAssistantMessageId] = useState<Record<number, StoryAmbientProfile>>({})
  const [inputValue, setInputValue] = useState('')
  const [isMobileComposer, setIsMobileComposer] = useState<boolean>(() => isMobileComposerViewport())
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false)
  const [quickStartIntro, setQuickStartIntro] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isBootstrappingGameData, setIsBootstrappingGameData] = useState(true)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false)
  const [continueHiddenForMessageId, setContinueHiddenForMessageId] = useState<number | null>(null)
  const [hiddenUserMessageIds, setHiddenUserMessageIds] = useState<number[]>([])
  const [turnImageByAssistantMessageId, setTurnImageByAssistantMessageId] = useState<
    Record<number, StoryTurnImageEntry[]>
  >({})
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<number | null>(null)
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_WIDTH_DEFAULT)
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('ai')
  const [activeAiPanelTab, setActiveAiPanelTab] = useState<AiPanelTab>('instructions')
  const [activeWorldPanelTab, setActiveWorldPanelTab] = useState<WorldPanelTab>('story')
  const [activeMemoryPanelTab, setActiveMemoryPanelTab] = useState<MemoryPanelTab>('memory')
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
  const [updatingInstructionActiveId, setUpdatingInstructionActiveId] = useState<number | null>(null)
  const [deletingInstructionId, setDeletingInstructionId] = useState<number | null>(null)
  const [plotCards, setPlotCards] = useState<StoryPlotCard[]>([])
  const [plotCardDialogOpen, setPlotCardDialogOpen] = useState(false)
  const [editingPlotCardId, setEditingPlotCardId] = useState<number | null>(null)
  const [plotCardTitleDraft, setPlotCardTitleDraft] = useState('')
  const [plotCardContentDraft, setPlotCardContentDraft] = useState('')
  const [plotCardTriggersDraft, setPlotCardTriggersDraft] = useState('')
  const [plotCardMemoryTurnsDraft, setPlotCardMemoryTurnsDraft] = useState<PlotMemoryTurnsOption>(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
  const [isSavingPlotCard, setIsSavingPlotCard] = useState(false)
  const [updatingPlotCardEnabledId, setUpdatingPlotCardEnabledId] = useState<number | null>(null)
  const [deletingPlotCardId, setDeletingPlotCardId] = useState<number | null>(null)
  const [plotCardEvents, setPlotCardEvents] = useState<StoryPlotCardEvent[]>([])
  const [aiMemoryBlocks, setAiMemoryBlocks] = useState<StoryMemoryBlock[]>([])
  const [openedAiMemoryBlockId, setOpenedAiMemoryBlockId] = useState<number | null>(null)
  const [memoryBlockDialogOpen, setMemoryBlockDialogOpen] = useState(false)
  const [editingMemoryBlockId, setEditingMemoryBlockId] = useState<number | null>(null)
  const [memoryBlockTitleDraft, setMemoryBlockTitleDraft] = useState('')
  const [memoryBlockContentDraft, setMemoryBlockContentDraft] = useState('')
  const [isSavingMemoryBlock, setIsSavingMemoryBlock] = useState(false)
  const [deletingMemoryBlockId, setDeletingMemoryBlockId] = useState<number | null>(null)
  const [dismissedPlotCardEventIds, setDismissedPlotCardEventIds] = useState<number[]>([])
  const [expandedPlotCardEventIds, setExpandedPlotCardEventIds] = useState<number[]>([])
  const [undoingPlotCardEventIds, setUndoingPlotCardEventIds] = useState<number[]>([])
  const [isUndoingAssistantStep, setIsUndoingAssistantStep] = useState(false)
  const [isRerollTurnPendingReplacement, setIsRerollTurnPendingReplacement] = useState(false)
  const [worldCards, setWorldCards] = useState<StoryWorldCard[]>([])
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [hasLoadedCharacters, setHasLoadedCharacters] = useState(false)
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false)
  const [isSavingCharacter, setIsSavingCharacter] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<number | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterManagerDialogOpen, setCharacterManagerDialogOpen] = useState(false)
  const [characterManagerInitialMode, setCharacterManagerInitialMode] = useState<'list' | 'create'>('list')
  const [characterManagerInitialCharacterId, setCharacterManagerInitialCharacterId] = useState<number | null>(null)
  const [characterManagerSyncCardId, setCharacterManagerSyncCardId] = useState<number | null>(null)
  const [characterDialogMode, setCharacterDialogMode] = useState<CharacterDialogMode>('select-main-hero')
  const [characterDialogReturnMode, setCharacterDialogReturnMode] = useState<CharacterSelectionDialogMode | null>(null)
  const [characterDraftMode, setCharacterDraftMode] = useState<CharacterDraftMode>('create')
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null)
  const [characterNameDraft, setCharacterNameDraft] = useState('')
  const [characterDescriptionDraft, setCharacterDescriptionDraft] = useState('')
  const [characterNoteDraft, setCharacterNoteDraft] = useState('')
  const [characterTriggersDraft, setCharacterTriggersDraft] = useState('')
  const [characterAvatarDraft, setCharacterAvatarDraft] = useState<string | null>(null)
  const [characterAvatarSourceDraft, setCharacterAvatarSourceDraft] = useState<string | null>(null)
  const [characterAvatarCropSource, setCharacterAvatarCropSource] = useState<string | null>(null)
  const [characterAvatarError, setCharacterAvatarError] = useState('')
  const [isSelectingCharacter, setIsSelectingCharacter] = useState(false)
  const [characterSelectionTab, setCharacterSelectionTab] = useState<SelectorSourceTab>('my')
  const [characterSelectionSearchQuery, setCharacterSelectionSearchQuery] = useState('')
  const [characterSelectionAddedFilter, setCharacterSelectionAddedFilter] = useState<CommunityAddedFilter>('all')
  const [characterSelectionSortMode, setCharacterSelectionSortMode] = useState<CommunitySortMode>('updated_desc')
  const [communityCharacterOptions, setCommunityCharacterOptions] = useState<StoryCommunityCharacterSummary[]>([])
  const [isLoadingCommunityCharacterOptions, setIsLoadingCommunityCharacterOptions] = useState(false)
  const [hasLoadedCommunityCharacterOptions, setHasLoadedCommunityCharacterOptions] = useState(false)
  const [expandedCommunityCharacterId, setExpandedCommunityCharacterId] = useState<number | null>(null)
  const [loadingCommunityCharacterId, setLoadingCommunityCharacterId] = useState<number | null>(null)
  const [savingCommunityCharacterId, setSavingCommunityCharacterId] = useState<number | null>(null)
  const [worldCardAvatarTargetId, setWorldCardAvatarTargetId] = useState<number | null>(null)
  const [worldCardCharacterMirrorByCardId, setWorldCardCharacterMirrorByCardId] = useState<Record<number, number>>({})
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
  const [worldCardMemoryTurnsDraft, setWorldCardMemoryTurnsDraft] = useState<NpcMemoryTurnsOption>(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
  const [isSavingWorldCard, setIsSavingWorldCard] = useState(false)
  const [updatingWorldCardAiEditId, setUpdatingWorldCardAiEditId] = useState<number | null>(null)
  const [deletingWorldCardId, setDeletingWorldCardId] = useState<number | null>(null)
  const [mainHeroPreviewOpen, setMainHeroPreviewOpen] = useState(false)
  const [characterAvatarPreview, setCharacterAvatarPreview] = useState<{ url: string; name: string } | null>(null)
  const [contextLimitChars, setContextLimitChars] = useState(STORY_DEFAULT_CONTEXT_LIMIT)
  const [contextLimitDraft, setContextLimitDraft] = useState(String(STORY_DEFAULT_CONTEXT_LIMIT))
  const [isNarratorSettingsExpanded, setIsNarratorSettingsExpanded] = useState(false)
  const [isVisualizationSettingsExpanded, setIsVisualizationSettingsExpanded] = useState(false)
  const [isAdditionalSettingsExpanded, setIsAdditionalSettingsExpanded] = useState(false)
  const [isFineTuneSettingsExpanded, setIsFineTuneSettingsExpanded] = useState(false)
  const [isContextUsageExpanded, setIsContextUsageExpanded] = useState(false)
  const [isSavingContextLimit, setIsSavingContextLimit] = useState(false)
  const [responseMaxTokens, setResponseMaxTokens] = useState(STORY_DEFAULT_RESPONSE_MAX_TOKENS)
  const [responseMaxTokensEnabled, setResponseMaxTokensEnabled] = useState(false)
  const [isSavingResponseMaxTokens, setIsSavingResponseMaxTokens] = useState(false)
  const [isSavingResponseMaxTokensEnabled, setIsSavingResponseMaxTokensEnabled] = useState(false)
  const [storyLlmModel, setStoryLlmModel] = useState<StoryNarratorModelId>(STORY_DEFAULT_NARRATOR_MODEL_ID)
  const [storyImageModel, setStoryImageModel] = useState<StoryImageModelId>(STORY_DEFAULT_IMAGE_MODEL_ID)
  const [imageStylePromptDraft, setImageStylePromptDraft] = useState('')
  const [memoryOptimizationEnabled, setMemoryOptimizationEnabled] = useState(true)
  const [storyTemperature, setStoryTemperature] = useState(STORY_DEFAULT_TEMPERATURE)
  const [storyTopK, setStoryTopK] = useState(STORY_DEFAULT_TOP_K)
  const [storyTopR, setStoryTopR] = useState(STORY_DEFAULT_TOP_R)
  const [showGgThoughts, setShowGgThoughts] = useState(false)
  const [showNpcThoughts, setShowNpcThoughts] = useState(false)
  const [ambientEnabled, setAmbientEnabled] = useState(false)
  const [persistedAmbientProfile, setPersistedAmbientProfile] = useState<StoryAmbientProfile | null>(null)
  const [storySettingsOverrides, setStorySettingsOverrides] = useState<Record<number, StorySettingsOverride>>({})
  const storySettingsOverridesRef = useRef<Record<number, StorySettingsOverride>>({})
  const [isSavingStoryLlmModel, setIsSavingStoryLlmModel] = useState(false)
  const [isSavingStoryImageModel, setIsSavingStoryImageModel] = useState(false)
  const [isSavingImageStylePrompt, setIsSavingImageStylePrompt] = useState(false)
  const [isSavingMemoryOptimization] = useState(false)
  const [isSavingStorySampling, setIsSavingStorySampling] = useState(false)
  const [isSavingShowGgThoughts, setIsSavingShowGgThoughts] = useState(false)
  const [isSavingShowNpcThoughts, setIsSavingShowNpcThoughts] = useState(false)
  const [isSavingAmbientEnabled, setIsSavingAmbientEnabled] = useState(false)
  const [cardMenuAnchorEl, setCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [cardMenuType, setCardMenuType] = useState<PanelCardMenuType | null>(null)
  const [cardMenuCardId, setCardMenuCardId] = useState<number | null>(null)
  const [deletionPrompt, setDeletionPrompt] = useState<DeletionPrompt | null>(null)
  const [bugReportDialogOpen, setBugReportDialogOpen] = useState(false)
  const [bugReportTitleDraft, setBugReportTitleDraft] = useState('')
  const [bugReportDescriptionDraft, setBugReportDescriptionDraft] = useState('')
  const [isBugReportSubmitting, setIsBugReportSubmitting] = useState(false)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const hiddenContinueTempUserMessageIdRef = useRef<number | null>(null)
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
  const voiceRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceSessionRequestedRef = useRef(false)
  const hasVoiceTranscriptRef = useRef(false)
  const voiceBasePromptRef = useRef('')
  const voiceFinalTranscriptRef = useRef('')
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const worldCardAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)

  const activeDisplayTitle = useMemo(
    () => getDisplayStoryTitle(activeGameId, customTitleMap),
    [activeGameId, customTitleMap],
  )

  const handleOpenCharacterAvatarPreview = useCallback((event: ReactMouseEvent<HTMLElement>, avatarUrl: string | null, fallbackName: string) => {
    if (!avatarUrl) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setCharacterAvatarPreview({
      url: avatarUrl,
      name: fallbackName,
    })
  }, [])

  const handleCloseCharacterAvatarPreview = useCallback(() => {
    setCharacterAvatarPreview(null)
  }, [])

  const renderPreviewableCharacterAvatar = useCallback(
    (options: {
      avatarUrl: string | null
      previewUrl?: string | null
      avatarScale?: number
      fallbackLabel: string
      size?: number
    }) => {
      const avatarNode = (
        <CharacterAvatar
          avatarUrl={options.avatarUrl}
          avatarScale={options.avatarScale}
          fallbackLabel={options.fallbackLabel}
          size={options.size}
        />
      )

      const previewUrl = options.previewUrl ?? options.avatarUrl

      if (!previewUrl) {
        return avatarNode
      }

      return (
        <Box
          component="span"
          onClick={(event) => handleOpenCharacterAvatarPreview(event, previewUrl, options.fallbackLabel)}
          sx={{
            display: 'inline-flex',
            borderRadius: '50%',
            cursor: 'zoom-in',
            flexShrink: 0,
          }}
        >
          {avatarNode}
        </Box>
      )
    },
    [handleOpenCharacterAvatarPreview],
  )

  useEffect(() => {
    storySettingsOverridesRef.current = storySettingsOverrides
  }, [storySettingsOverrides])

  useEffect(() => {
    activeGameIdRef.current = activeGameId
  }, [activeGameId])

  useEffect(() => {
    setIsAutoScrollPaused(false)
    setContinueHiddenForMessageId(null)
    setHiddenUserMessageIds([])
    hiddenContinueTempUserMessageIdRef.current = null
  }, [activeGameId])

  useEffect(() => {
    if (hiddenUserMessageIds.length === 0) {
      return
    }
    const messageIdSet = new Set(messages.map((message) => message.id))
    setHiddenUserMessageIds((previousIds) => {
      const nextIds = previousIds.filter((messageId) => messageIdSet.has(messageId))
      if (nextIds.length === previousIds.length && nextIds.every((messageId, index) => messageId === previousIds[index])) {
        return previousIds
      }
      return nextIds
    })
  }, [hiddenUserMessageIds, messages])
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
    if (persistedAmbientProfile) {
      return persistedAmbientProfile
    }

    return isYamiTheme ? STORY_AMBIENT_YAMI_PROFILE : STORY_AMBIENT_DEFAULT_PROFILE
  }, [ambientByAssistantMessageId, isYamiTheme, messages, persistedAmbientProfile])
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
    const gradientColorAlpha = clampAmbientValue(0.2 + activeAmbientProfile.glow_strength * 0.18, 0, 1, 0.3)
    const gradientOpacityMin = clampAmbientValue(0.34 + activeAmbientProfile.glow_strength * 0.1, 0, 1, 0.4)
    const gradientOpacityMax = clampAmbientValue(gradientOpacityMin + 0.16 + (isGenerating ? 0.04 : 0), 0, 1, 0.62)

    const basePrimary = hexToRgba(activeAmbientProfile.primary_color, baseAuraAlpha)
    const baseSecondary = hexToRgba(activeAmbientProfile.secondary_color, baseAuraAlpha)
    const baseHighlight = hexToRgba(activeAmbientProfile.highlight_color, baseAuraAlpha)

    const pulsePrimaryMin = hexToRgba(activeAmbientProfile.primary_color, pulseMinAlpha)
    const pulseSecondaryMin = hexToRgba(activeAmbientProfile.secondary_color, pulseMinAlpha)
    const pulseHighlightMin = hexToRgba(activeAmbientProfile.highlight_color, pulseMinAlpha)
    const pulsePrimaryMax = hexToRgba(activeAmbientProfile.primary_color, pulseMaxAlpha)
    const pulseSecondaryMax = hexToRgba(activeAmbientProfile.secondary_color, pulseMaxAlpha)
    const pulseHighlightMax = hexToRgba(activeAmbientProfile.highlight_color, pulseMaxAlpha)
    const gradientPrimary = hexToRgba(activeAmbientProfile.primary_color, gradientColorAlpha)
    const gradientSecondary = hexToRgba(activeAmbientProfile.secondary_color, gradientColorAlpha)
    const gradientHighlight = hexToRgba(activeAmbientProfile.highlight_color, gradientColorAlpha)

    return {
      borderColor: hexToRgba(activeAmbientProfile.highlight_color, borderAlpha),
      baseShadow: `0 0 85px -11px ${basePrimary}, 0 0 85px -11px ${baseSecondary}, 0 0 85px -11px ${baseHighlight}`,
      pulseShadowMin: `0 0 85px -11px ${pulsePrimaryMin}, 0 0 85px -11px ${pulseSecondaryMin}, 0 0 85px -11px ${pulseHighlightMin}`,
      pulseShadowMax: `0 0 85px -11px ${pulsePrimaryMax}, 0 0 85px -11px ${pulseSecondaryMax}, 0 0 85px -11px ${pulseHighlightMax}`,
      gradientLayer: `radial-gradient(145% 120% at 6% 6%, ${gradientPrimary} 0%, transparent 64%), radial-gradient(135% 118% at 94% 8%, ${gradientSecondary} 0%, transparent 64%), radial-gradient(120% 130% at 50% 102%, ${gradientHighlight} 0%, transparent 62%)`,
      gradientOpacityMin,
      gradientOpacityMax,
    }
  }, [activeAmbientProfile, ambientEnabled, isGenerating])
  const storyHistoryTextFontFamily = useMemo(() => {
    return storyHistoryFontFamilyOptions.find((option) => option.id === storyHistoryFontFamily)?.cssFontFamily ?? 'inherit'
  }, [storyHistoryFontFamily, storyHistoryFontFamilyOptions])
  const storyHistoryTextFontWeight = useMemo(() => {
    return storyHistoryFontWeightOptions.find((option) => option.id === storyHistoryFontWeight)?.cssFontWeight ?? 400
  }, [storyHistoryFontWeight, storyHistoryFontWeightOptions])
  const storyHistoryTextSx = useMemo(
    () => ({
      fontFamily: storyHistoryTextFontFamily,
      fontWeight: storyHistoryTextFontWeight,
    }),
    [storyHistoryTextFontFamily, storyHistoryTextFontWeight],
  )
  const selectedNarratorOption = useMemo(
    () => STORY_NARRATOR_MODEL_OPTIONS.find((option) => option.id === storyLlmModel) ?? STORY_NARRATOR_MODEL_OPTIONS[0],
    [storyLlmModel],
  )

  const applyStoryGameSettings = useCallback((game: StoryGameSummary) => {
    const normalizedContextLimit = clampStoryContextLimit(game.context_limit_chars)
    setContextLimitChars(normalizedContextLimit)
    setContextLimitDraft(String(normalizedContextLimit))
    const runtimeGame = game as Partial<StoryGameSummary>
    const normalizedRuntimeStoryTemperature =
      typeof runtimeGame.story_temperature === 'number'
        ? clampStoryTemperature(runtimeGame.story_temperature)
        : STORY_DEFAULT_TEMPERATURE
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
    const override = storySettingsOverridesRef.current[game.id]
    if (override) {
      setStoryLlmModel(override.storyLlmModel)
      setResponseMaxTokens(clampStoryResponseMaxTokens(override.responseMaxTokens))
      setResponseMaxTokensEnabled(override.responseMaxTokensEnabled)
      setMemoryOptimizationEnabled(true)
      setStoryTemperature(clampStoryTemperature(override.storyTemperature ?? normalizedRuntimeStoryTemperature))
      setStoryTopK(clampStoryTopK(override.storyTopK))
      setStoryTopR(clampStoryTopR(override.storyTopR))
      setShowGgThoughts(override.showGgThoughts)
      setShowNpcThoughts(override.showNpcThoughts)
      setAmbientEnabled(override.ambientEnabled)
      return
    }
    if (typeof runtimeGame.story_llm_model === 'string' && runtimeGame.story_llm_model.trim().length > 0) {
      setStoryLlmModel(normalizeStoryNarratorModelId(runtimeGame.story_llm_model))
    }
    setMemoryOptimizationEnabled(true)
    if (typeof runtimeGame.story_temperature === 'number') {
      setStoryTemperature(clampStoryTemperature(runtimeGame.story_temperature))
    } else {
      setStoryTemperature(STORY_DEFAULT_TEMPERATURE)
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
    if (typeof runtimeGame.show_gg_thoughts === 'boolean') {
      setShowGgThoughts(runtimeGame.show_gg_thoughts)
    } else {
      setShowGgThoughts(false)
    }
    if (typeof runtimeGame.show_npc_thoughts === 'boolean') {
      setShowNpcThoughts(runtimeGame.show_npc_thoughts)
    } else {
      setShowNpcThoughts(false)
    }
    if (typeof runtimeGame.ambient_enabled === 'boolean') {
      setAmbientEnabled(runtimeGame.ambient_enabled)
    } else {
      setAmbientEnabled(false)
    }
  }, [])

  const hasMessages = messages.length > 0
  const shouldShowStoryTitleLoadingSkeleton = isBootstrappingGameData
  const shouldShowStoryMessagesLoadingSkeleton = (isBootstrappingGameData || isLoadingGameMessages) && messages.length === 0
  const shouldShowRightPanelLoadingSkeleton =
    isBootstrappingGameData && instructionCards.length === 0 && plotCards.length === 0 && worldCards.length === 0
  const quickStartIntroBlocks = useMemo(() => {
    const mainHeroName = worldCards.find((card) => card.kind === 'main_hero')?.title ?? null
    return parseAssistantMessageBlocks(replaceMainHeroInlineTags(quickStartIntro, mainHeroName))
  }, [quickStartIntro, worldCards])
  const lastCurrentUserMessageIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        return index
      }
    }
    return -1
  }, [messages])
  const currentRerollSourceUserMessage = lastCurrentUserMessageIndex >= 0 ? messages[lastCurrentUserMessageIndex] : null
  const currentRerollAssistantMessage =
    lastCurrentUserMessageIndex >= 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages.length - 1 > lastCurrentUserMessageIndex
      ? messages[messages.length - 1]
      : null
  const isPrivateStoryGame = activeGameSummary?.visibility === 'private'
  const storyTurnCount = useMemo(
    () => countStoryCompletedTurns(messages) + (isRerollTurnPendingReplacement ? 1 : 0),
    [isRerollTurnPendingReplacement, messages],
  )
  const latestTurnAssistantMessageId = currentRerollAssistantMessage?.id ?? null
  const latestTurnImageEntries =
    latestTurnAssistantMessageId !== null
      ? (turnImageByAssistantMessageId[latestTurnAssistantMessageId] ?? [])
      : []
  const isLatestTurnImageLoading = latestTurnImageEntries.some((entry) => entry.status === 'loading')
  const hasLatestTurnImage = latestTurnImageEntries.some(
    (entry) => entry.status === 'ready' && Boolean(entry.imageUrl),
  )
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
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    currentRerollSourceUserMessage !== null
  const canGenerateLatestTurnImage =
    !isGenerating &&
    !isUndoingAssistantStep &&
    !isCreatingGame &&
    Boolean(activeGameId) &&
    currentRerollAssistantMessage !== null &&
    !isLatestTurnImageLoading
  const canViewDevMemoryTab = user.role === 'administrator'
  const isRightPanelSecondTabVisible = rightPanelMode !== 'memory' || canViewDevMemoryTab
  const leftPanelTabLabel =
    rightPanelMode === 'ai'
      ? 'Инструкции'
      : rightPanelMode === 'world'
        ? 'Сюжет'
        : 'Память'
  const rightPanelTabLabel =
    rightPanelMode === 'ai'
      ? 'Настройки'
      : rightPanelMode === 'world'
        ? 'Мир'
        : 'Дев Память'
  const isLeftPanelTabActive =
    rightPanelMode === 'ai'
      ? activeAiPanelTab === 'instructions'
      : rightPanelMode === 'world'
        ? activeWorldPanelTab === 'story'
        : activeMemoryPanelTab === 'memory'
  const rightPanelContentKey =
    rightPanelMode === 'ai'
      ? `ai-${activeAiPanelTab}`
      : rightPanelMode === 'world'
        ? `world-${activeWorldPanelTab}`
        : `memory-${activeMemoryPanelTab}`
  useEffect(() => {
    if (!canViewDevMemoryTab && activeMemoryPanelTab === 'dev') {
      setActiveMemoryPanelTab('memory')
    }
  }, [activeMemoryPanelTab, canViewDevMemoryTab])
  const visibleWorldCardEvents = useMemo(
    () => worldCardEvents.filter((event) => !dismissedWorldCardEventIds.includes(event.id)),
    [dismissedWorldCardEventIds, worldCardEvents],
  )
  const visiblePlotCardEvents = useMemo(
    () => plotCardEvents.filter((event) => !dismissedPlotCardEventIds.includes(event.id)),
    [dismissedPlotCardEventIds, plotCardEvents],
  )
  const aiMemoryBlocksByLayer = useMemo(() => {
    const nextMap = new Map<'raw' | 'compressed' | 'super', StoryMemoryBlock[]>()
    nextMap.set('raw', [])
    nextMap.set('compressed', [])
    nextMap.set('super', [])
    aiMemoryBlocks.forEach((block) => {
      if (block.layer === 'raw' || block.layer === 'compressed' || block.layer === 'super') {
        const currentItems = nextMap.get(block.layer) ?? []
        currentItems.push(block)
        nextMap.set(block.layer, currentItems)
      }
    })
    nextMap.forEach((blocks, layer) => {
      nextMap.set(
        layer,
        [...blocks].sort((a, b) => b.id - a.id),
      )
    })
    return nextMap
  }, [aiMemoryBlocks])
  const importantMemoryBlocks = useMemo(
    () =>
      [...aiMemoryBlocks]
        .filter((block) => block.layer === 'key')
        .sort((a, b) => b.id - a.id),
    [aiMemoryBlocks],
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
    () => {
      const resolvedMainHeroName = resolveMainHeroDisplayName(
        worldCards.find((worldCard) => worldCard.kind === 'main_hero')?.title,
      )
      return instructionCards
        .filter((card) => card.is_active)
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: replaceMainHeroInlineTags(card.content.replace(/\r\n/g, '\n').trim(), resolvedMainHeroName),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0)
    },
    [instructionCards, worldCards],
  )
  const selectedInstructionTemplateSignatures = useMemo(
    () =>
      instructionCards.map((card) => createInstructionTemplateSignature(card.title, card.content)),
    [instructionCards],
  )
  const normalizedAiMemoryCardsForContext = useMemo(() => {
    if (!memoryOptimizationEnabled || aiMemoryBlocks.length === 0) {
      return []
    }
    const layerWeight: Record<string, number> = {
      key: -1,
      super: 0,
      compressed: 1,
      raw: 2,
    }
    const orderedBlocks = [...aiMemoryBlocks].sort((a, b) => {
      const layerDiff = (layerWeight[a.layer] ?? 99) - (layerWeight[b.layer] ?? 99)
      if (layerDiff !== 0) {
        return layerDiff
      }
      return a.id - b.id
    })
    return orderedBlocks
      .map((block) => ({
        title: block.title.replace(/\s+/g, ' ').trim(),
        content: block.content.replace(/\r\n/g, '\n').trim(),
      }))
      .filter((block) => block.title.length > 0 && block.content.length > 0)
  }, [aiMemoryBlocks, memoryOptimizationEnabled])
  const plotCardContextStateById = useMemo(
    () => buildPlotCardContextStateById(plotCards, messages),
    [messages, plotCards],
  )
  const activePlotCardsForContext = useMemo(
    () => plotCards.filter((card) => plotCardContextStateById.get(card.id)?.isActive),
    [plotCardContextStateById, plotCards],
  )
  const mainHeroDisplayNameForTags = useMemo(() => {
    const mainHero = worldCards.find((card) => card.kind === 'main_hero') ?? null
    return resolveMainHeroDisplayName(mainHero?.title)
  }, [worldCards])
  const normalizedPlotCardsForContext = useMemo(
    () => {
      if (!memoryOptimizationEnabled) {
        return []
      }
      return activePlotCardsForContext
        .map((card) => ({
          title: card.title.replace(/\s+/g, ' ').trim(),
          content: replaceMainHeroInlineTags(card.content.replace(/\r\n/g, '\n').trim(), mainHeroDisplayNameForTags),
        }))
        .filter((card) => card.title.length > 0 && card.content.length > 0)
    },
    [activePlotCardsForContext, mainHeroDisplayNameForTags, memoryOptimizationEnabled],
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
  const effectiveAiMemoryContextTokensUsed = useMemo(() => {
    if (!memoryOptimizationEnabled || normalizedAiMemoryCardsForContext.length === 0) {
      return 0
    }
    const memoryBudgetTokens = Math.max(contextLimitChars - instructionContextTokensUsed - worldContextTokensUsed, 0)
    return estimatePlotCardsTokensWithinBudget(normalizedAiMemoryCardsForContext, memoryBudgetTokens)
  }, [
    contextLimitChars,
    instructionContextTokensUsed,
    memoryOptimizationEnabled,
    normalizedAiMemoryCardsForContext,
    worldContextTokensUsed,
  ])
  const isAiMemoryActive = memoryOptimizationEnabled && normalizedAiMemoryCardsForContext.length > 0
  const isPlotMemoryActive = memoryOptimizationEnabled && normalizedPlotCardsForContext.length > 0
  const storyMemoryTokensUsed = memoryOptimizationEnabled
    ? effectiveAiMemoryContextTokensUsed + effectivePlotContextTokensUsed
    : effectiveHistoryContextTokensUsed
  const storyMemoryLabel = memoryOptimizationEnabled
    ? isAiMemoryActive && isPlotMemoryActive
      ? 'Память + Сюжет'
      : isAiMemoryActive
        ? 'Память'
        : isPlotMemoryActive
          ? 'Карточки сюжета'
          : 'История сообщений'
    : 'История сообщений'
  const storyMemoryHint = !memoryOptimizationEnabled
    ? 'Оптимизация памяти выключена: карточки сюжета не используются в контексте.'
    : isAiMemoryActive && isPlotMemoryActive
      ? `Используются рекурсивная память (${normalizedAiMemoryCardsForContext.length}) и карточки сюжета (${normalizedPlotCardsForContext.length}).`
      : isAiMemoryActive
        ? `Используется рекурсивная память: ${normalizedAiMemoryCardsForContext.length} блоков.`
        : isPlotMemoryActive
          ? `Учитываются карточки сюжета: ${normalizedPlotCardsForContext.length}.`
          : 'Карточек памяти нет, учитывается история диалога.'
  const cardsContextCharsUsed = instructionContextTokensUsed + storyMemoryTokensUsed + worldContextTokensUsed
  const freeContextChars = Math.max(contextLimitChars - cardsContextCharsUsed, 0)
  const cardsContextOverflowChars = Math.max(cardsContextCharsUsed - contextLimitChars, 0)
  const cardsContextUsagePercent =
    contextLimitChars > 0 ? Math.min(100, (cardsContextCharsUsed / contextLimitChars) * 100) : 100
  const currentTurnCostTokens = useMemo(
    () => getStoryTurnCostTokens(cardsContextCharsUsed, ambientEnabled),
    [ambientEnabled, cardsContextCharsUsed],
  )
  const hasInsufficientTokensForTurn = user.coins < currentTurnCostTokens
  const isSavingThoughtVisibility = isSavingShowGgThoughts || isSavingShowNpcThoughts
  const inputPlaceholder = hasInsufficientTokensForTurn
    ? OUT_OF_TOKENS_INPUT_PLACEHOLDER
    : hasMessages
      ? NEXT_INPUT_PLACEHOLDER
      : INITIAL_INPUT_PLACEHOLDER
  const speechRecognitionCtor = useMemo(() => resolveSpeechRecognitionCtor(), [])
  const voiceInputSupported = speechRecognitionCtor !== null
  const hasPromptText = inputValue.trim().length > 0
  const showMicAction = voiceInputEnabled && !isGenerating && (!hasPromptText || isVoiceInputActive)
  const canUseVoiceInput =
    voiceInputEnabled &&
    !isGenerating &&
    !isCreatingGame &&
    !hasInsufficientTokensForTurn &&
    voiceInputSupported
  const isSavingStorySettings =
    isSavingContextLimit ||
    isSavingResponseMaxTokens ||
    isSavingResponseMaxTokensEnabled ||
    isSavingStoryLlmModel ||
    isSavingStoryImageModel ||
    isSavingImageStylePrompt ||
    isSavingMemoryOptimization ||
    isSavingStorySampling ||
    isSavingThoughtVisibility ||
    isSavingAmbientEnabled
  const isInstructionCardActionLocked =
    isGenerating || isSavingInstruction || isCreatingGame || deletingInstructionId !== null || updatingInstructionActiveId !== null
  const isPlotCardActionLocked = isGenerating || isSavingPlotCard || isCreatingGame || deletingPlotCardId !== null
  const isWorldCardActionLocked = isGenerating || isSavingWorldCard || isCreatingGame || deletingWorldCardId !== null
  const isMemoryCardActionLocked = isGenerating || isSavingMemoryBlock || isCreatingGame || deletingMemoryBlockId !== null
  const isDeletionPromptInProgress = Boolean(
    deletionPrompt &&
      ((deletionPrompt.type === 'instruction' && deletingInstructionId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'plot' && deletingPlotCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'world' && deletingWorldCardId === deletionPrompt.targetId) ||
        (deletionPrompt.type === 'memory' && deletingMemoryBlockId === deletionPrompt.targetId) ||
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
  const resolveWorldCardPreviewAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card) {
        return null
      }
      return card.avatar_original_url ?? card.avatar_url
    },
    [],
  )
  const mainHeroAvatarUrl = useMemo(() => resolveWorldCardAvatar(mainHeroCard), [mainHeroCard, resolveWorldCardAvatar])
  const editingWorldCard = useMemo(
    () => (editingWorldCardId !== null ? worldCards.find((card) => card.id === editingWorldCardId) ?? null : null),
    [editingWorldCardId, worldCards],
  )
  const editingWorldCardAvatarUrl = useMemo(
    () => resolveWorldCardAvatar(editingWorldCard),
    [editingWorldCard, resolveWorldCardAvatar],
  )
  const isCharacterWorldCardEditor =
    worldCardDialogOpen && (editingWorldCardKind === 'main_hero' || editingWorldCardKind === 'npc')
  const mainHeroCharacterId = useMemo(
    () => (mainHeroCard && mainHeroCard.character_id && mainHeroCard.character_id > 0 ? mainHeroCard.character_id : null),
    [mainHeroCard],
  )
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
  const charactersById = useMemo(() => {
    const nextMap = new Map<number, StoryCharacter>()
    characters.forEach((character) => {
      nextMap.set(character.id, character)
    })
    return nextMap
  }, [characters])
  const resolveLinkedCharacterPreviewAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card?.character_id || card.character_id <= 0) {
        return null
      }
      const linkedCharacter = charactersById.get(card.character_id) ?? null
      return linkedCharacter?.avatar_original_url ?? linkedCharacter?.avatar_url ?? null
    },
    [charactersById],
  )
  const mainHeroPreviewAvatarUrl = useMemo(
    () => resolveWorldCardPreviewAvatar(mainHeroCard) ?? resolveLinkedCharacterPreviewAvatar(mainHeroCard),
    [mainHeroCard, resolveLinkedCharacterPreviewAvatar, resolveWorldCardPreviewAvatar],
  )
  const mainHeroSourceCharacterId = useMemo(() => {
    if (!mainHeroCard?.character_id || mainHeroCard.character_id <= 0) {
      return null
    }
    const linkedCharacter = charactersById.get(mainHeroCard.character_id) ?? null
    if (!linkedCharacter?.source_character_id || linkedCharacter.source_character_id <= 0) {
      return null
    }
    return linkedCharacter.source_character_id
  }, [charactersById, mainHeroCard])
  const npcSourceCharacterIds = useMemo(() => {
    const selectedIds = new Set<number>()
    worldCards.forEach((card) => {
      if (card.kind !== 'npc' || !card.character_id || card.character_id <= 0) {
        return
      }
      const linkedCharacter = charactersById.get(card.character_id) ?? null
      if (!linkedCharacter?.source_character_id || linkedCharacter.source_character_id <= 0) {
        return
      }
      selectedIds.add(linkedCharacter.source_character_id)
    })
    return selectedIds
  }, [charactersById, worldCards])
  const getCharacterSelectionDisabledReason = useCallback(
    (character: StoryCharacter, mode: CharacterDialogMode): string | null => {
      if (mode === 'select-main-hero') {
        return npcCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
      }
      if (mainHeroCharacterId !== null && character.id === mainHeroCharacterId) {
        return 'Уже выбран как ГГ'
      }
      if (npcCharacterIds.has(character.id)) {
        return 'Уже выбран как NPC'
      }
      return null
    },
    [mainHeroCharacterId, npcCharacterIds],
  )
  const ownCharacterOptions = useMemo(
    () => [...characters].sort((left, right) => right.id - left.id),
    [characters],
  )
  const filteredOwnCharacterOptions = useMemo(() => {
    const normalizedQuery = normalizeCharacterIdentity(characterSelectionSearchQuery)
    if (!normalizedQuery) {
      return ownCharacterOptions
    }
    return ownCharacterOptions.filter((character) => {
      const searchValues = [
        character.name,
        character.description,
        ...character.triggers,
      ]
      return searchValues.some((value) => normalizeCharacterIdentity(value).includes(normalizedQuery))
    })
  }, [characterSelectionSearchQuery, ownCharacterOptions])
  const filteredCommunityCharacterOptions = useMemo(() => {
    const normalizedQuery = normalizeCharacterIdentity(characterSelectionSearchQuery)
    let nextItems = [...communityCharacterOptions]
    if (characterSelectionAddedFilter === 'added') {
      nextItems = nextItems.filter((item) => item.is_added_by_user)
    } else if (characterSelectionAddedFilter === 'not_added') {
      nextItems = nextItems.filter((item) => !item.is_added_by_user)
    }
    if (normalizedQuery) {
      nextItems = nextItems.filter((item) => {
        const searchValues = [
          item.name,
          item.description,
          item.author_name,
          ...item.triggers,
        ]
        return searchValues.some((value) => normalizeCharacterIdentity(value).includes(normalizedQuery))
      })
    }
    nextItems.sort((left, right) => {
      if (characterSelectionSortMode === 'rating_desc') {
        if (right.community_rating_avg !== left.community_rating_avg) {
          return right.community_rating_avg - left.community_rating_avg
        }
        return right.community_rating_count - left.community_rating_count
      }
      if (characterSelectionSortMode === 'additions_desc') {
        if (right.community_additions_count !== left.community_additions_count) {
          return right.community_additions_count - left.community_additions_count
        }
        return right.id - left.id
      }
      const leftTimestamp = Date.parse(left.updated_at)
      const rightTimestamp = Date.parse(right.updated_at)
      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && rightTimestamp !== leftTimestamp) {
        return rightTimestamp - leftTimestamp
      }
      return right.id - left.id
    })
    return nextItems
  }, [
    characterSelectionAddedFilter,
    characterSelectionSearchQuery,
    characterSelectionSortMode,
    communityCharacterOptions,
  ])
  const getCommunityCharacterSelectionDisabledReason = useCallback(
    (character: StoryCommunityCharacterSummary, mode: CharacterDialogMode): string | null => {
      if (mode === 'select-main-hero') {
        return npcSourceCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
      }
      if (mainHeroSourceCharacterId === character.id) {
        return 'Уже выбран как ГГ'
      }
      if (npcSourceCharacterIds.has(character.id)) {
        return 'Уже выбран как NPC'
      }
      return null
    },
    [mainHeroSourceCharacterId, npcSourceCharacterIds],
  )
  const speakerCardsForAvatar = useMemo(() => {
    const entries: SpeakerAvatarEntry[] = []
    const appendEntry = (names: string[], avatar: string | null, previewAvatar: string | null, displayName: string) => {
      const normalizedNames = [...new Set(names.filter(Boolean))]
      if (normalizedNames.length === 0) {
        return
      }
      const normalizedDisplayName = displayName.trim()
      entries.push({
        names: normalizedNames,
        avatar,
        previewAvatar: previewAvatar ?? avatar,
        displayName: normalizedDisplayName || normalizedNames[0],
      })
    }

    worldCards.forEach((card) => {
      if (card.kind !== 'npc' && card.kind !== 'main_hero') {
        return
      }
      const aliasSet = new Set<string>()
      buildCharacterAliases(card.title).forEach((alias) => aliasSet.add(alias))
      buildIdentityTriggerAliases(card.title, card.triggers).forEach((alias) => aliasSet.add(alias))
      if (card.kind === 'main_hero') {
        MAIN_HERO_SPEAKER_ALIASES.forEach((alias) => {
          const normalizedAlias = normalizeCharacterIdentity(alias)
          if (normalizedAlias) {
            aliasSet.add(normalizedAlias)
          }
        })
      }

      const linkedCharacter =
        card.character_id && card.character_id > 0 ? charactersById.get(card.character_id) ?? null : null
      if (linkedCharacter) {
        buildCharacterAliases(linkedCharacter.name).forEach((alias) => aliasSet.add(alias))
      }

      const avatar = resolveWorldCardAvatar(card) ?? linkedCharacter?.avatar_url ?? null
      const previewAvatar =
        resolveWorldCardPreviewAvatar(card) ??
        linkedCharacter?.avatar_original_url ??
        linkedCharacter?.avatar_url ??
        avatar
      appendEntry([...aliasSet], avatar, previewAvatar, card.title)
    })

    characters.forEach((character) => {
      appendEntry(
        buildCharacterAliases(character.name),
        character.avatar_url,
        character.avatar_original_url ?? character.avatar_url,
        character.name,
      )
    })

    return entries
  }, [characters, charactersById, resolveWorldCardAvatar, resolveWorldCardPreviewAvatar, worldCards])
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
  const resolveDialogueAvatarPreview = useCallback(
    (speakerName: string): string | null => {
      const speakerEntry = findSpeakerEntryByName(speakerName)
      return speakerEntry?.previewAvatar ?? speakerEntry?.avatar ?? null
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
  const selectedMenuPlotCard = useMemo(
    () => (cardMenuType === 'plot' && cardMenuCardId !== null ? plotCards.find((card) => card.id === cardMenuCardId) ?? null : null),
    [cardMenuCardId, cardMenuType, plotCards],
  )
  const selectedMenuInstructionCard = useMemo(
    () =>
      cardMenuType === 'instruction' && cardMenuCardId !== null
        ? instructionCards.find((card) => card.id === cardMenuCardId) ?? null
        : null,
    [cardMenuCardId, cardMenuType, instructionCards],
  )
  const openedAiMemoryBlock = useMemo(
    () => (openedAiMemoryBlockId !== null ? aiMemoryBlocks.find((block) => block.id === openedAiMemoryBlockId) ?? null : null),
    [aiMemoryBlocks, openedAiMemoryBlockId],
  )
  const isSelectedMenuWorldCardLocked = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.is_locked,
  )
  const isSelectedMenuPlotCardEnabledUpdating = Boolean(
    selectedMenuPlotCard && updatingPlotCardEnabledId === selectedMenuPlotCard.id,
  )
  const isSelectedMenuPlotCardToggleUpdating = isSelectedMenuPlotCardEnabledUpdating
  const isSelectedMenuInstructionActiveUpdating = Boolean(
    selectedMenuInstructionCard && updatingInstructionActiveId === selectedMenuInstructionCard.id,
  )
  const isSelectedMenuWorldCardAiEditUpdating = Boolean(
    selectedMenuWorldCard && updatingWorldCardAiEditId === selectedMenuWorldCard.id,
  )
  const canDeleteSelectedMenuWorldCard = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.kind !== 'main_hero',
  )
  const getWorldCardAiEditStatusLabel = useCallback(
    (card: StoryWorldCard): string => (card.ai_edit_enabled ? ' редактирование: разрешено' : ' редактирование: запрещено'),
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
    setCharacterNoteDraft('')
    setCharacterTriggersDraft('')
    setCharacterAvatarDraft(null)
    setCharacterAvatarSourceDraft(null)
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

  const handleOpenCharacterManager = useCallback(
    (options?: { initialCharacterId?: number | null; syncCardId?: number | null }) => {
      const initialCharacterId = options?.initialCharacterId ?? null
      const syncCardId = options?.syncCardId ?? null
      setCharacterManagerInitialMode('list')
      setCharacterManagerInitialCharacterId(initialCharacterId)
      setCharacterManagerSyncCardId(syncCardId)
      setCharacterManagerDialogOpen(true)
    },
    [],
  )

  const handleCloseCharacterManager = useCallback(() => {
    const targetGameId = activeGameId
    const targetCharacterId = characterManagerInitialCharacterId
    const targetCardId = characterManagerSyncCardId
    const returnMode = characterDialogReturnMode
    let latestCharacters = characters

    setCharacterManagerDialogOpen(false)
    setCharacterManagerInitialMode('list')
    setCharacterManagerInitialCharacterId(null)
    setCharacterManagerSyncCardId(null)
    setCharacterDialogReturnMode(null)

    void (async () => {
      try {
        const loadedCharacters = await listStoryCharacters(authToken)
        latestCharacters = loadedCharacters
        setCharacters(loadedCharacters)
        setHasLoadedCharacters(true)
      } catch {
        // Ignore transient load errors here; other requests can still proceed.
      }

      if (returnMode) {
        setCharacterDialogMode(returnMode)
        setCharacterDialogOpen(true)
      }

      if (!targetGameId || !targetCharacterId || !targetCardId) {
        return
      }

      const linkedCharacter = latestCharacters.find((item) => item.id === targetCharacterId) ?? null
      const linkedWorldCard = worldCards.find((card) => card.id === targetCardId) ?? null
      if (!linkedCharacter || !linkedWorldCard) {
        return
      }

      try {
        const normalizedTriggers = Array.isArray(linkedCharacter.triggers)
          ? linkedCharacter.triggers.filter((value): value is string => typeof value === 'string')
          : []
        const syncedCard = await updateStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          cardId: linkedWorldCard.id,
          title: linkedCharacter.name,
          content: linkedCharacter.description,
          triggers: normalizedTriggers,
          memory_turns: linkedWorldCard.kind === 'npc' ? resolveWorldCardMemoryTurns(linkedWorldCard) : undefined,
        })
        const syncedCardWithAvatar = await updateStoryWorldCardAvatar({
          token: authToken,
          gameId: targetGameId,
          cardId: linkedWorldCard.id,
          avatar_url: linkedCharacter.avatar_url,
          avatar_original_url: linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url,
          avatar_scale: linkedCharacter.avatar_scale,
        })
        setWorldCards((previousCards) =>
          previousCards.map((card) => {
            if (card.id !== linkedWorldCard.id) {
              return card
            }
            return {
              ...syncedCard,
              avatar_url: syncedCardWithAvatar.avatar_url,
              avatar_original_url: syncedCardWithAvatar.avatar_original_url ?? syncedCardWithAvatar.avatar_url,
              avatar_scale: syncedCardWithAvatar.avatar_scale,
            }
          }),
        )
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : 'Не удалось синхронизировать карточку мира после редактирования персонажа'
        setErrorMessage(detail)
      }
    })()
  }, [
    activeGameId,
    authToken,
    characterDialogReturnMode,
    characterManagerInitialCharacterId,
    characterManagerSyncCardId,
    characters,
    worldCards,
  ])

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

  const loadCommunityCharacterOptions = useCallback(async () => {
    setIsLoadingCommunityCharacterOptions(true)
    setErrorMessage('')
    try {
      const items = await listCommunityCharacters(authToken)
      setCommunityCharacterOptions(items.map((item) => ({ ...item, note: normalizeCharacterNoteValue(item.note) })))
      setHasLoadedCommunityCharacterOptions(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей сообщества'
      setErrorMessage(detail)
    } finally {
      setIsLoadingCommunityCharacterOptions(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!characterDialogOpen) {
      setCharacterSelectionTab('my')
      setCharacterSelectionSearchQuery('')
      setCharacterSelectionAddedFilter('all')
      setCharacterSelectionSortMode('updated_desc')
      setExpandedCommunityCharacterId(null)
      setLoadingCommunityCharacterId(null)
      setSavingCommunityCharacterId(null)
      return
    }
    if (characterDialogMode === 'manage') {
      return
    }
    setCharacterSelectionTab('my')
    setCharacterSelectionSearchQuery('')
    setCharacterSelectionAddedFilter('all')
    setCharacterSelectionSortMode('updated_desc')
    setExpandedCommunityCharacterId(null)
    setLoadingCommunityCharacterId(null)
    setSavingCommunityCharacterId(null)
  }, [characterDialogMode, characterDialogOpen])

  useEffect(() => {
    if (
      !characterDialogOpen ||
      characterDialogMode === 'manage' ||
      characterSelectionTab !== 'community' ||
      hasLoadedCommunityCharacterOptions ||
      isLoadingCommunityCharacterOptions
    ) {
      return
    }
    void loadCommunityCharacterOptions()
  }, [
    characterDialogMode,
    characterDialogOpen,
    characterSelectionTab,
    hasLoadedCommunityCharacterOptions,
    isLoadingCommunityCharacterOptions,
    loadCommunityCharacterOptions,
  ])

  const handleToggleCommunityCharacterCard = useCallback(
    async (characterId: number) => {
      if (expandedCommunityCharacterId === characterId) {
        setExpandedCommunityCharacterId(null)
        return
      }
      setExpandedCommunityCharacterId(characterId)
      setLoadingCommunityCharacterId(characterId)
      try {
        const detailedCharacter = await getCommunityCharacter({
          token: authToken,
          characterId,
        })
        setCommunityCharacterOptions((previous) =>
          previous.map((item) =>
            item.id === detailedCharacter.id ? { ...detailedCharacter, note: normalizeCharacterNoteValue(detailedCharacter.note) } : item,
          ),
        )
      } catch {
        // We still keep local summary data expanded.
      } finally {
        setLoadingCommunityCharacterId((previous) => (previous === characterId ? null : previous))
      }
    },
    [authToken, expandedCommunityCharacterId],
  )

  const handleStartCreateCharacter = useCallback(() => {
    resetCharacterDraft()
  }, [resetCharacterDraft])

  const handleStartCreateCharacterFromNpcSelector = useCallback(() => {
    if (characterDialogMode !== 'select-npc' || isSelectingCharacter) {
      return
    }
    setCharacterDialogOpen(false)
    setCharacterDialogReturnMode('select-npc')
    setCharacterManagerInitialMode('create')
    setCharacterManagerInitialCharacterId(null)
    setCharacterManagerSyncCardId(null)
    setCharacterManagerDialogOpen(true)
  }, [characterDialogMode, isSelectingCharacter])

  const handleStartEditCharacter = useCallback((character: StoryCharacter) => {
    setCharacterDialogReturnMode(null)
    setCharacterDraftMode('edit')
    setEditingCharacterId(character.id)
    setCharacterNameDraft(character.name)
    setCharacterDescriptionDraft(character.description)
    setCharacterNoteDraft(character.note)
    setCharacterTriggersDraft(character.triggers.join(', '))
    setCharacterAvatarDraft(character.avatar_url)
    setCharacterAvatarSourceDraft(character.avatar_original_url ?? character.avatar_url)
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
    if (selectedFile.size > CHARACTER_AVATAR_MAX_BYTES) {
      setCharacterAvatarError('Файл слишком большой. Максимум 2 МБ.')
      return
    }

    setCharacterAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setCharacterAvatarSourceDraft(dataUrl)
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
        setCharacterAvatarError('Avatar is too large after crop. Maximum is 2 MB.')
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
    const normalizedNote = normalizeCharacterNoteValue(characterNoteDraft)
    if (!normalizedName) {
      setErrorMessage('мя персонажа не может быть пустым')
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
      const preparedAvatarPayload = await prepareAvatarPayloadForRequest({
        avatarUrl: characterAvatarDraft,
        avatarOriginalUrl: characterAvatarSourceDraft ?? characterAvatarDraft,
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: 960,
      })
      if (characterDraftMode === 'create') {
        const createdCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            note: normalizedNote,
            triggers: normalizedTriggers,
            avatar_url: preparedAvatarPayload.avatarUrl,
            avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
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
            note: normalizedNote,
            triggers: normalizedTriggers,
            avatar_url: preparedAvatarPayload.avatarUrl,
            avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
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
    characterAvatarSourceDraft,
    characterDescriptionDraft,
    characterDraftMode,
    characterDialogReturnMode,
    characterNameDraft,
    characterNoteDraft,
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
      setAiMemoryBlocks([])
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
        if (characterDialogMode === 'select-npc') {
          setEditingWorldCardId(createdCard.id)
          setEditingWorldCardKind(createdCard.kind)
          setWorldCardTitleDraft(createdCard.title)
          setWorldCardContentDraft(createdCard.content)
          setWorldCardTriggersDraft(createdCard.triggers.join(', '))
          setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(createdCard)))
          setWorldCardDialogOpen(true)
        }
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

  const handleApplyCommunityCharacterForGame = useCallback(
    async (
      character: StoryCommunityCharacterSummary,
      options: { saveToProfile: boolean },
    ) => {
      if (isSelectingCharacter || savingCommunityCharacterId !== null) {
        return
      }

      const disabledReason = getCommunityCharacterSelectionDisabledReason(character, characterDialogMode)
      if (disabledReason) {
        setErrorMessage(disabledReason)
        return
      }

      setIsSelectingCharacter(true)
      setSavingCommunityCharacterId(character.id)
      setErrorMessage('')
      let temporaryCharacterId: number | null = null

      try {
        const targetGameId = await ensureGameForCharacterSelection()
        if (!targetGameId) {
          return
        }

        let gameCharacterId: number | null = null
        if (options.saveToProfile) {
          await addCommunityCharacter({
            token: authToken,
            characterId: character.id,
          })
          const refreshedCharacters = await listStoryCharacters(authToken)
          const normalizedCharacters = refreshedCharacters.map((item) => ({
            ...item,
            note: normalizeCharacterNoteValue(item.note),
          }))
          setCharacters(normalizedCharacters)
          const linkedCharacter = normalizedCharacters.find((item) => item.source_character_id === character.id) ?? null
          if (!linkedCharacter) {
            throw new Error('Не удалось найти сохраненного персонажа в профиле')
          }
          gameCharacterId = linkedCharacter.id
          setCommunityCharacterOptions((previous) =>
            previous.map((item) =>
              item.id === character.id ? { ...item, is_added_by_user: true } : item,
            ),
          )
        } else {
          const temporaryCharacter = await createStoryCharacter({
            token: authToken,
            input: {
              name: character.name,
              description: character.description,
              note: character.note,
              triggers: character.triggers,
              avatar_url: character.avatar_url,
              avatar_original_url: character.avatar_original_url ?? character.avatar_url,
              avatar_scale: character.avatar_scale,
              visibility: 'private',
            },
          })
          temporaryCharacterId = temporaryCharacter.id
          gameCharacterId = temporaryCharacter.id
        }

        if (!gameCharacterId) {
          throw new Error('Не удалось подготовить персонажа для добавления в игру')
        }

        const createdCard =
          characterDialogMode === 'select-main-hero'
            ? await selectStoryMainHero({
                token: authToken,
                gameId: targetGameId,
                characterId: gameCharacterId,
              })
            : await createStoryNpcFromCharacter({
                token: authToken,
                gameId: targetGameId,
                characterId: gameCharacterId,
              })

        if (temporaryCharacterId !== null) {
          try {
            await deleteStoryCharacter({
              token: authToken,
              characterId: temporaryCharacterId,
            })
          } catch {
            // Best-effort cleanup for temporary profile character.
          }
        }

        setWorldCards((previousCards) => {
          const hasCard = previousCards.some((card) => card.id === createdCard.id)
          if (hasCard) {
            return previousCards.map((card) => (card.id === createdCard.id ? createdCard : card))
          }
          return [...previousCards, createdCard]
        })
        setCharacterDialogOpen(false)
        if (characterDialogMode === 'select-npc') {
          setEditingWorldCardId(createdCard.id)
          setEditingWorldCardKind(createdCard.kind)
          setWorldCardTitleDraft(createdCard.title)
          setWorldCardContentDraft(createdCard.content)
          setWorldCardTriggersDraft(createdCard.triggers.join(', '))
          setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(createdCard)))
          setWorldCardDialogOpen(true)
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось применить персонажа из сообщества'
        setErrorMessage(detail)
      } finally {
        setIsSelectingCharacter(false)
        setSavingCommunityCharacterId((previous) => (previous === character.id ? null : previous))
      }
    },
    [
      authToken,
      characterDialogMode,
      ensureGameForCharacterSelection,
      getCommunityCharacterSelectionDisabledReason,
      isSelectingCharacter,
      savingCommunityCharacterId,
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
        avatar_original_url: avatarDataUrl,
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
      const detail = error instanceof Error ? error.message : 'Не удалось обновить настройку редактирования '
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

  const handleToggleInstructionCardActive = useCallback(async () => {
    if (
      !activeGameId ||
      !selectedMenuInstructionCard ||
      isInstructionCardActionLocked ||
      isSelectedMenuInstructionActiveUpdating
    ) {
      return
    }
    const targetCard = selectedMenuInstructionCard
    setErrorMessage('')
    setUpdatingInstructionActiveId(targetCard.id)
    try {
      const updatedCard = await updateStoryInstructionCardActive({
        token: authToken,
        gameId: activeGameId,
        instructionId: targetCard.id,
        is_active: !targetCard.is_active,
      })
      setInstructionCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      setCardMenuAnchorEl(null)
      setCardMenuType(null)
      setCardMenuCardId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить статус инструкции'
      setErrorMessage(detail)
    } finally {
      setUpdatingInstructionActiveId(null)
    }
  }, [
    activeGameId,
    authToken,
    isInstructionCardActionLocked,
    isSelectedMenuInstructionActiveUpdating,
    selectedMenuInstructionCard,
  ])

  const handleTogglePlotCardEnabled = useCallback(async () => {
    if (
      !activeGameId ||
      !selectedMenuPlotCard ||
      isPlotCardActionLocked ||
      isSelectedMenuPlotCardToggleUpdating
    ) {
      return
    }
    const targetCard = selectedMenuPlotCard
    setErrorMessage('')
    setUpdatingPlotCardEnabledId(targetCard.id)
    try {
      const updatedCard = await updateStoryPlotCardEnabled({
        token: authToken,
        gameId: activeGameId,
        cardId: targetCard.id,
        is_enabled: !targetCard.is_enabled,
      })
      setPlotCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      setCardMenuAnchorEl(null)
      setCardMenuType(null)
      setCardMenuCardId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить статус карточки сюжета'
      setErrorMessage(detail)
    } finally {
      setUpdatingPlotCardEnabledId(null)
    }
  }, [
    activeGameId,
    authToken,
    isPlotCardActionLocked,
    isSelectedMenuPlotCardToggleUpdating,
    selectedMenuPlotCard,
  ])

  const loadGameById = useCallback(
    async (gameId: number, options?: { silent?: boolean; suppressErrors?: boolean }): Promise<boolean> => {
      const silent = options?.silent ?? false
      const suppressErrors = options?.suppressErrors ?? false
      if (!silent) {
        setIsLoadingGameMessages(true)
      }
      try {
        const payload = await getStoryGame({ token: authToken, gameId })
        setActiveGameSummary(payload.game)
        const serverOpeningScene = (payload.game.opening_scene ?? '').trim()
        setQuickStartIntro(serverOpeningScene)
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
            const currentEntry = accumulator[assistantMessageId]?.[0] ?? null
            if (!currentEntry || restoredEntry.id >= currentEntry.id) {
              accumulator[assistantMessageId] = [restoredEntry]
            }
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
        setAiMemoryBlocks(payload.memory_blocks ?? [])
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
        return true
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить историю игры'
        if (!suppressErrors) {
          setErrorMessage(detail)
        }
        return false
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
        const initialTargetGameId =
          typeof initialGameId === 'number' && Number.isFinite(initialGameId) && initialGameId > 0
            ? initialGameId
            : null
        const initialGameLoadPromise =
          initialTargetGameId !== null
            ? loadGameById(initialTargetGameId, { suppressErrors: true })
            : Promise.resolve(false)
        const loadedGames = await listStoryGames(authToken, { compact: true })
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
          let activeGameLoaded = false
          if (initialTargetGameId !== null && sortedGames.some((game) => game.id === initialTargetGameId)) {
            setActiveGameId(initialTargetGameId)
            activeGameLoaded = await initialGameLoadPromise
            if (!isActive) {
              return
            }
          }

          if (!activeGameLoaded) {
            const preferredGameId = sortedGames[0].id
            setActiveGameId(preferredGameId)
            await loadGameById(preferredGameId, {
              suppressErrors: initialTargetGameId !== null,
            })
            if (!isActive) {
              return
            }
          }
        } else {
          setActiveGameId(null)
          setMessages([])
          setTurnImageByAssistantMessageId({})
          setAmbientByAssistantMessageId({})
          setPersistedAmbientProfile(null)
          setInstructionCards([])
          setPlotCards([])
          setAiMemoryBlocks([])
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
    setPersistedAmbientProfile(null)
    if (!activeGameId) {
      setQuickStartIntro('')
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
    setPlotCardTriggersDraft('')
    setPlotCardMemoryTurnsDraft(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
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
    setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setDeletingWorldCardId(null)
  }, [activeGameId, isCreatingGame, isSavingWorldCard])

  useEffect(() => {
    if (isSavingMemoryBlock || isCreatingGame) {
      return
    }
    setMemoryBlockDialogOpen(false)
    setEditingMemoryBlockId(null)
    setMemoryBlockTitleDraft('')
    setMemoryBlockContentDraft('')
    setDeletingMemoryBlockId(null)
    setOpenedAiMemoryBlockId(null)
  }, [activeGameId, isCreatingGame, isSavingMemoryBlock])

  useEffect(() => {
    setOpenedAiMemoryBlockId((previousId) => {
      if (previousId === null) {
        return previousId
      }
      const stillExists = aiMemoryBlocks.some((block) => block.id === previousId)
      return stillExists ? previousId : null
    })
  }, [aiMemoryBlocks])

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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(MOBILE_COMPOSER_MEDIA_QUERY)
    const updateComposerDeviceMode = () => setIsMobileComposer(mediaQuery.matches)
    updateComposerDeviceMode()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateComposerDeviceMode)
      return () => mediaQuery.removeEventListener('change', updateComposerDeviceMode)
    }

    mediaQuery.addListener(updateComposerDeviceMode)
    return () => mediaQuery.removeListener(updateComposerDeviceMode)
  }, [])

  useEffect(() => () => {
    voiceSessionRequestedRef.current = false
    const recognition = voiceRecognitionRef.current
    voiceRecognitionRef.current = null
    if (!recognition) {
      return
    }
    try {
      recognition.stop()
    } catch {
      // Ignore stop errors during unmount cleanup.
    }
  }, [])

  useEffect(() => {
    if (voiceInputEnabled) {
      return
    }
    voiceSessionRequestedRef.current = false
    const recognition = voiceRecognitionRef.current
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // Ignore stop errors when voice input setting is disabled.
      }
    }
    setIsVoiceInputActive(false)
  }, [voiceInputEnabled])

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

  const handleMessagesViewportScroll = useCallback(() => {
    if (isAutoScrollPaused || !isGenerating) {
      return
    }
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    const distanceFromBottom = viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
    if (distanceFromBottom > STORY_AUTOSCROLL_BOTTOM_THRESHOLD) {
      setIsAutoScrollPaused(true)
    }
  }, [isAutoScrollPaused, isGenerating])

  useEffect(() => {
    if (isAutoScrollPaused) {
      return
    }
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, isAutoScrollPaused, isGenerating, messagesViewportBottomPadding])

  useEffect(() => {
    if (!errorMessage) {
      return
    }
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth',
      })
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [errorMessage])

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
      const normalized =
        rawValue.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().slice(0, STORY_GAME_TITLE_MAX_LENGTH)
        || DEFAULT_STORY_TITLE
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
    const nextValue = truncateContentEditableText(event.currentTarget, STORY_GAME_TITLE_MAX_LENGTH)
    handleCommitInlineTitle(nextValue)
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

    const normalized = messageDraft.slice(0, STORY_MESSAGE_MAX_LENGTH).trim()
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
      await loadGameById(activeGameId, { silent: true })
      setEditingMessageId(null)
      setMessageDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
      setErrorMessage(detail)
    } finally {
      setIsSavingMessage(false)
    }
  }, [activeGameId, authToken, editingMessageId, isSavingMessage, loadGameById, messageDraft, messages])

  const handleSaveMessageInline = useCallback(
    async (messageId: number, nextContentRaw: string) => {
      if (isGenerating || isSavingMessage || !activeGameId) {
        return
      }

      const currentMessage = messages.find((message) => message.id === messageId)
      if (!currentMessage) {
        return
      }

      const normalized = nextContentRaw.replace(/\r\n/g, '\n').slice(0, STORY_MESSAGE_MAX_LENGTH).trim()
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
        await loadGameById(activeGameId, { silent: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
        setErrorMessage(detail)
      } finally {
        setIsSavingMessage(false)
      }
    },
    [activeGameId, authToken, isGenerating, isSavingMessage, loadGameById, messages],
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
      setAiMemoryBlocks([])
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
    setPlotCardTriggersDraft('')
    setPlotCardMemoryTurnsDraft(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
    setPlotCardDialogOpen(true)
  }

  const handleOpenEditPlotCardDialog = (card: StoryPlotCard) => {
    if (isGenerating || isSavingPlotCard || isCreatingGame) {
      return
    }
    setEditingPlotCardId(card.id)
    setPlotCardTitleDraft(card.title)
    setPlotCardContentDraft(card.content)
    setPlotCardTriggersDraft(card.triggers.join(', '))
    setPlotCardMemoryTurnsDraft(toPlotCardMemoryTurnsOption(resolvePlotCardMemoryTurns(card)))
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
    setPlotCardTriggersDraft('')
    setPlotCardMemoryTurnsDraft(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
  }

  const handleSavePlotCard = useCallback(async () => {
    if (isSavingPlotCard || isCreatingGame) {
      return
    }

    const normalizedTitle = plotCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = plotCardContentDraft.replace(/\r\n/g, '\n').trim()
    const normalizedTriggers = normalizePlotCardTriggersDraft(plotCardTriggersDraft)
    const normalizedMemoryTurns = plotCardMemoryTurnsDraft

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
        setAiMemoryBlocks([])
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
          triggers: normalizedTriggers,
          memory_turns: normalizedMemoryTurns,
        })
        setPlotCards((previousCards) => [...previousCards, createdCard])
      } else {
        const updatedCard = await updateStoryPlotCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingPlotCardId,
          title: normalizedTitle,
          content: normalizedContent,
          triggers: normalizedTriggers,
          memory_turns: normalizedMemoryTurns,
        })
        setPlotCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      }

      setPlotCardDialogOpen(false)
      setEditingPlotCardId(null)
      setPlotCardTitleDraft('')
      setPlotCardContentDraft('')
      setPlotCardTriggersDraft('')
      setPlotCardMemoryTurnsDraft(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
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
    plotCardMemoryTurnsDraft,
    plotCardTitleDraft,
    plotCardTriggersDraft,
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
          setPlotCardTriggersDraft('')
          setPlotCardMemoryTurnsDraft(PLOT_CARD_TRIGGER_ACTIVE_TURNS)
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
    setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setWorldCardDialogOpen(true)
  }

  const handleOpenEditWorldCardDialog = (card: StoryWorldCard) => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    if (card.kind === 'main_hero') {
      const linkedCharacterId =
        typeof card.character_id === 'number' && card.character_id > 0
          ? card.character_id
          : worldCardCharacterMirrorByCardId[card.id] ?? null
      const hasLinkedCharacter = linkedCharacterId ? characters.some((item) => item.id === linkedCharacterId) : false
      if (linkedCharacterId && linkedCharacterId > 0 && hasLinkedCharacter) {
        handleOpenCharacterManager({
          initialCharacterId: linkedCharacterId,
          syncCardId: card.id,
        })
        return
      }

      void (async () => {
        try {
          const normalizedName = card.title.replace(/\s+/g, ' ').trim() || 'Персонаж'
          const normalizedDescription = card.content.replace(/\r\n/g, '\n').trim() || 'Описание персонажа'
          const normalizedTriggers =
            Array.isArray(card.triggers) && card.triggers.length > 0
              ? card.triggers
              : normalizeCharacterTriggersDraft('', normalizedName)
          const mirroredCharacter = await createStoryCharacter({
            token: authToken,
            input: {
              name: normalizedName,
              description: normalizedDescription,
              note: '',
              triggers: normalizedTriggers,
              avatar_url: resolveWorldCardAvatar(card),
              avatar_original_url: resolveWorldCardPreviewAvatar(card) ?? resolveLinkedCharacterPreviewAvatar(card),
              avatar_scale: card.avatar_scale,
              visibility: 'private',
            },
          })
          setCharacters((previous) =>
            [...previous.filter((item) => item.id !== mirroredCharacter.id), mirroredCharacter].sort((left, right) => left.id - right.id),
          )
          setHasLoadedCharacters(true)
          setWorldCardCharacterMirrorByCardId((previous) => ({
            ...previous,
            [card.id]: mirroredCharacter.id,
          }))
          handleOpenCharacterManager({
            initialCharacterId: mirroredCharacter.id,
            syncCardId: card.id,
          })
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Не удалось открыть редактор персонажа'
          setErrorMessage(detail)
        }
      })()
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
    setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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
        setAiMemoryBlocks([])
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
      setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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
        setWorldCardCharacterMirrorByCardId((previous) => {
          if (!(cardId in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[cardId]
          return next
        })
        if (editingWorldCardId === cardId) {
          setWorldCardDialogOpen(false)
          setEditingWorldCardId(null)
          setEditingWorldCardKind('world')
          setWorldCardTitleDraft('')
          setWorldCardContentDraft('')
          setWorldCardTriggersDraft('')
          setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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

  const handleOpenCreateMemoryBlockDialog = useCallback(() => {
    if (isMemoryCardActionLocked || !activeGameId) {
      return
    }
    setEditingMemoryBlockId(null)
    setMemoryBlockTitleDraft('')
    setMemoryBlockContentDraft('')
    setMemoryBlockDialogOpen(true)
  }, [activeGameId, isMemoryCardActionLocked])

  const handleOpenEditMemoryBlockDialog = useCallback((block: StoryMemoryBlock) => {
    if (isMemoryCardActionLocked || !activeGameId) {
      return
    }
    if (block.layer !== 'key') {
      return
    }
    setEditingMemoryBlockId(block.id)
    setMemoryBlockTitleDraft(block.title)
    setMemoryBlockContentDraft(block.content)
    setMemoryBlockDialogOpen(true)
  }, [activeGameId, isMemoryCardActionLocked])

  const handleCloseMemoryBlockDialog = useCallback(() => {
    if (isSavingMemoryBlock || isCreatingGame) {
      return
    }
    setMemoryBlockDialogOpen(false)
    setEditingMemoryBlockId(null)
    setMemoryBlockTitleDraft('')
    setMemoryBlockContentDraft('')
  }, [isCreatingGame, isSavingMemoryBlock])

  const handleSaveMemoryBlock = useCallback(async () => {
    if (isSavingMemoryBlock || isCreatingGame || !activeGameId) {
      return
    }

    const normalizedTitle = memoryBlockTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = memoryBlockContentDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedTitle) {
      setErrorMessage('Название карточки памяти не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Текст карточки памяти не может быть пустым')
      return
    }
    if (normalizedContent.length > STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH) {
      setErrorMessage(`Текст карточки памяти не должен превышать ${STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH} символов`)
      return
    }

    setErrorMessage('')
    setIsSavingMemoryBlock(true)
    try {
      const nextBlock =
        editingMemoryBlockId === null
          ? await createStoryMemoryBlock({
              token: authToken,
              gameId: activeGameId,
              title: normalizedTitle,
              content: normalizedContent,
            })
          : await updateStoryMemoryBlock({
              token: authToken,
              gameId: activeGameId,
              blockId: editingMemoryBlockId,
              title: normalizedTitle,
              content: normalizedContent,
            })

      setAiMemoryBlocks((previousBlocks) => {
        const hasBlock = previousBlocks.some((block) => block.id === nextBlock.id)
        const mergedBlocks = hasBlock
          ? previousBlocks.map((block) => (block.id === nextBlock.id ? nextBlock : block))
          : [...previousBlocks, nextBlock]
        return [...mergedBlocks].sort((left, right) => left.id - right.id)
      })
      setOpenedAiMemoryBlockId(nextBlock.id)
      setMemoryBlockDialogOpen(false)
      setEditingMemoryBlockId(null)
      setMemoryBlockTitleDraft('')
      setMemoryBlockContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку памяти'
      setErrorMessage(detail)
    } finally {
      setIsSavingMemoryBlock(false)
    }
  }, [
    activeGameId,
    authToken,
    editingMemoryBlockId,
    isCreatingGame,
    isSavingMemoryBlock,
    memoryBlockContentDraft,
    memoryBlockTitleDraft,
  ])

  const handleDeleteMemoryBlock = useCallback(async (blockId: number) => {
    if (!activeGameId || deletingMemoryBlockId !== null || isSavingMemoryBlock || isCreatingGame) {
      return
    }

    setErrorMessage('')
    setDeletingMemoryBlockId(blockId)
    try {
      await deleteStoryMemoryBlock({
        token: authToken,
        gameId: activeGameId,
        blockId,
      })
      setAiMemoryBlocks((previousBlocks) => previousBlocks.filter((block) => block.id !== blockId))
      setOpenedAiMemoryBlockId((previousId) => (previousId === blockId ? null : previousId))
      if (editingMemoryBlockId === blockId) {
        setMemoryBlockDialogOpen(false)
        setEditingMemoryBlockId(null)
        setMemoryBlockTitleDraft('')
        setMemoryBlockContentDraft('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить карточку памяти'
      setErrorMessage(detail)
    } finally {
      setDeletingMemoryBlockId(null)
    }
  }, [activeGameId, authToken, deletingMemoryBlockId, editingMemoryBlockId, isCreatingGame, isSavingMemoryBlock])

  const handleRequestDeleteMemoryBlock = useCallback((block: StoryMemoryBlock) => {
    const normalizedTitle = block.title.trim() || 'без названия'
    setDeletionPrompt({
      type: 'memory',
      targetId: block.id,
      title: 'Удалить карточку памяти?',
      message: `Карточка памяти «${normalizedTitle}» будет удалена без возможности восстановления.`,
    })
  }, [])

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
    if (
      deletingInstructionId !== null ||
      deletingPlotCardId !== null ||
      deletingWorldCardId !== null ||
      deletingMemoryBlockId !== null ||
      deletingCharacterId !== null
    ) {
      return
    }
    setDeletionPrompt(null)
  }, [deletingCharacterId, deletingInstructionId, deletingMemoryBlockId, deletingPlotCardId, deletingWorldCardId])

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
    if (prompt.type === 'memory') {
      await handleDeleteMemoryBlock(prompt.targetId)
      return
    }
    await handleDeleteCharacter(prompt.targetId)
  }, [
    deletionPrompt,
    handleDeleteCharacter,
    handleDeleteInstructionCard,
    handleDeleteMemoryBlock,
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
        isSavingThoughtVisibility ||
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
          memoryOptimizationEnabled: memoryOptimizationEnabled,
          showGgThoughts: showGgThoughts,
          showNpcThoughts: showNpcThoughts,
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
      memoryOptimizationEnabled,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
      isSavingThoughtVisibility,
      showGgThoughts,
      showNpcThoughts,
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
        isSavingThoughtVisibility ||
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
          memoryOptimizationEnabled: memoryOptimizationEnabled,
          showGgThoughts: showGgThoughts,
          showNpcThoughts: showNpcThoughts,
        })
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить лимит ответа '
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
      memoryOptimizationEnabled,
      isSavingMemoryOptimization,
      isSavingResponseMaxTokens,
      isSavingResponseMaxTokensEnabled,
      isSavingStoryLlmModel,
      isSavingStorySampling,
      isSavingThoughtVisibility,
      responseMaxTokensEnabled,
      showGgThoughts,
      showNpcThoughts,
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
        isSavingThoughtVisibility ||
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
      const previousShowGgThoughts = showGgThoughts
      const previousShowNpcThoughts = showNpcThoughts
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
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
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
          memoryOptimizationEnabled: previousMemoryOptimizationEnabled,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
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
                    show_gg_thoughts: previousShowGgThoughts,
                    show_npc_thoughts: previousShowNpcThoughts,
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
      isSavingThoughtVisibility,
      isSavingStoryLlmModel,
      contextLimitChars,
      responseMaxTokens,
      responseMaxTokensEnabled,
      memoryOptimizationEnabled,
      ambientEnabled,
      showGgThoughts,
      showNpcThoughts,
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
        isSavingThoughtVisibility ||
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
          memoryOptimizationEnabled: memoryOptimizationEnabled,
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
      isSavingThoughtVisibility,
      memoryOptimizationEnabled,
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
        isSavingThoughtVisibility ||
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
          memoryOptimizationEnabled: memoryOptimizationEnabled,
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
      isSavingThoughtVisibility,
      memoryOptimizationEnabled,
    ],
  )

  const handleImageStylePromptCommit = useCallback(async () => {
    await persistImageStylePrompt(imageStylePromptDraft)
  }, [imageStylePromptDraft, persistImageStylePrompt])

  const toggleShowGgThoughts = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingShowGgThoughts ||
      isSavingShowNpcThoughts ||
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

    const nextValue = !showGgThoughts
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowNpcThoughts = showNpcThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
    setShowGgThoughts(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: nextValue,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      },
    }))
    setErrorMessage('')
    setIsSavingShowGgThoughts(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        showGgThoughts: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
      setShowGgThoughts(nextValue)
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
                  show_gg_thoughts: nextValue,
                  show_npc_thoughts: previousShowNpcThoughts,
                  ambient_enabled: previousAmbientEnabled,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить настройку мыслей ГГ'
      setErrorMessage(detail)
    } finally {
      setIsSavingShowGgThoughts(false)
    }
  }, [
    activeGameId,
    authToken,
    contextLimitChars,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingMemoryOptimization,
    isSavingResponseMaxTokens,
    isSavingResponseMaxTokensEnabled,
    isSavingShowGgThoughts,
    isSavingShowNpcThoughts,
    isSavingStoryLlmModel,
    isSavingStorySampling,
    memoryOptimizationEnabled,
    ambientEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    showGgThoughts,
    showNpcThoughts,
    storyTopK,
    storyTopR,
    storyLlmModel,
  ])

  const toggleShowNpcThoughts = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingShowNpcThoughts ||
      isSavingShowGgThoughts ||
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

    const nextValue = !showNpcThoughts
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
    setShowNpcThoughts(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: nextValue,
        ambientEnabled: previousAmbientEnabled,
      },
    }))
    setErrorMessage('')
    setIsSavingShowNpcThoughts(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        showNpcThoughts: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
      setShowNpcThoughts(nextValue)
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
                  show_gg_thoughts: previousShowGgThoughts,
                  show_npc_thoughts: nextValue,
                  ambient_enabled: previousAmbientEnabled,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить настройку мыслей NPC'
      setErrorMessage(detail)
    } finally {
      setIsSavingShowNpcThoughts(false)
    }
  }, [
    activeGameId,
    authToken,
    contextLimitChars,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingMemoryOptimization,
    isSavingResponseMaxTokens,
    isSavingResponseMaxTokensEnabled,
    isSavingShowGgThoughts,
    isSavingShowNpcThoughts,
    isSavingStoryLlmModel,
    isSavingStorySampling,
    memoryOptimizationEnabled,
    ambientEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    showGgThoughts,
    showNpcThoughts,
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
        isSavingThoughtVisibility ||
        isGenerating
      ) {
      return
    }

    const nextValue = !ambientEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
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
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
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
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
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
                  show_gg_thoughts: previousShowGgThoughts,
                  show_npc_thoughts: previousShowNpcThoughts,
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
    isSavingThoughtVisibility,
    memoryOptimizationEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    showGgThoughts,
    showNpcThoughts,
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
        isSavingThoughtVisibility ||
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
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
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
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
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
        memoryOptimizationEnabled: previousMemoryOptimization,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
      })
      setResponseMaxTokensEnabled(nextValue)
      setResponseMaxTokens(clampStoryResponseMaxTokens(updatedGame.response_max_tokens))
      setGames((previousGames) =>
        sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить режим лимита ответа '
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
    isSavingThoughtVisibility,
    memoryOptimizationEnabled,
    responseMaxTokens,
    responseMaxTokensEnabled,
    showGgThoughts,
    showNpcThoughts,
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
    const sanitized = value.replace(/[^\d]/g, '').slice(0, STORY_CONTEXT_LIMIT_INPUT_MAX_LENGTH)
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
    async (nextTemperature: number, nextTopK: number, nextTopR: number) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingStorySampling ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingMemoryOptimization ||
        isSavingThoughtVisibility ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }
      const normalizedTemperature = clampStoryTemperature(nextTemperature)
      const normalizedTopK = clampStoryTopK(nextTopK)
      const normalizedTopR = clampStoryTopR(nextTopR)
      const normalizedStoryModel = storyLlmModel
      const normalizedMemoryOptimization = memoryOptimizationEnabled
      const normalizedAmbientEnabled = ambientEnabled
      const normalizedShowGgThoughts = showGgThoughts
      const normalizedShowNpcThoughts = showNpcThoughts
      const normalizedResponseMaxTokens = responseMaxTokens
      const normalizedResponseMaxTokensEnabled = responseMaxTokensEnabled
      setStoryTemperature(normalizedTemperature)
      setStoryTopK(normalizedTopK)
      setStoryTopR(normalizedTopR)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          storyLlmModel: normalizedStoryModel,
          responseMaxTokens: normalizedResponseMaxTokens,
          responseMaxTokensEnabled: normalizedResponseMaxTokensEnabled,
          memoryOptimizationEnabled: normalizedMemoryOptimization,
          storyTemperature: normalizedTemperature,
          storyTopK: normalizedTopK,
          storyTopR: normalizedTopR,
          showGgThoughts: normalizedShowGgThoughts,
          showNpcThoughts: normalizedShowNpcThoughts,
          ambientEnabled: normalizedAmbientEnabled,
        },
      }))
      setErrorMessage('')
      setIsSavingStorySampling(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          storyTemperature: normalizedTemperature,
          storyTopK: normalizedTopK,
          storyTopR: normalizedTopR,
          responseMaxTokens: normalizedResponseMaxTokens,
          responseMaxTokensEnabled: normalizedResponseMaxTokensEnabled,
          memoryOptimizationEnabled: normalizedMemoryOptimization,
          showGgThoughts: normalizedShowGgThoughts,
          showNpcThoughts: normalizedShowNpcThoughts,
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
                    story_temperature: normalizedTemperature,
                    story_top_k: normalizedTopK,
                    story_top_r: normalizedTopR,
                    show_gg_thoughts: normalizedShowGgThoughts,
                    show_npc_thoughts: normalizedShowNpcThoughts,
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
      isSavingThoughtVisibility,
      memoryOptimizationEnabled,
      ambientEnabled,
      showGgThoughts,
      showNpcThoughts,
      responseMaxTokens,
      responseMaxTokensEnabled,
      storyLlmModel,
    ],
  )

  const handleStoryTemperatureSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTemperature(clampStoryTemperature(rawValue))
  }, [])

  const handleStoryTemperatureSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(rawValue, storyTopK, storyTopR)
    },
    [persistStorySamplingSettings, storyTopK, storyTopR],
  )

  const handleStoryTopKSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopK(clampStoryTopK(rawValue))
  }, [])

  const handleStoryTopKSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTemperature, rawValue, storyTopR)
    },
    [persistStorySamplingSettings, storyTemperature, storyTopR],
  )

  const handleStoryTopRSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopR(clampStoryTopR(rawValue))
  }, [])

  const handleStoryTopRSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTemperature, storyTopK, rawValue)
    },
    [persistStorySamplingSettings, storyTemperature, storyTopK],
  )

  const handleResetStorySampling = useCallback(async () => {
    await persistStorySamplingSettings(STORY_DEFAULT_TEMPERATURE, STORY_DEFAULT_TOP_K, STORY_DEFAULT_TOP_R)
  }, [persistStorySamplingSettings])

  const handleOpenBugReportDialog = useCallback(() => {
    if (!activeGameId || isCreatingGame || isGenerating) {
      return
    }
    setBugReportDialogOpen(true)
  }, [activeGameId, isCreatingGame, isGenerating])

  const handleCloseBugReportDialog = useCallback(() => {
    if (isBugReportSubmitting) {
      return
    }
    setBugReportDialogOpen(false)
    setBugReportTitleDraft('')
    setBugReportDescriptionDraft('')
  }, [isBugReportSubmitting])

  const handleSubmitBugReport = useCallback(async () => {
    if (!activeGameId || isBugReportSubmitting) {
      return
    }
    const normalizedTitle = bugReportTitleDraft.trim()
    const normalizedDescription = bugReportDescriptionDraft.trim()
    if (!normalizedTitle) {
      setErrorMessage('Введите заголовок баг-репорта')
      return
    }
    if (!normalizedDescription) {
      setErrorMessage('Введите описание баг-репорта')
      return
    }

    setIsBugReportSubmitting(true)
    setErrorMessage('')
    try {
      await createStoryBugReport({
        token: authToken,
        gameId: activeGameId,
        title: normalizedTitle,
        description: normalizedDescription,
      })
      setBugReportDialogOpen(false)
      setBugReportTitleDraft('')
      setBugReportDescriptionDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отправить баг-репорт'
      setErrorMessage(detail)
    } finally {
      setIsBugReportSubmitting(false)
    }
  }, [activeGameId, authToken, bugReportDescriptionDraft, bugReportTitleDraft, isBugReportSubmitting])

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
        return {
          ...previousState,
          [options.assistantMessageId]: [
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
            return {
              ...previousState,
              [options.assistantMessageId]: [
                {
                  id: persistedEntryId,
                  status: 'ready',
                  imageUrl: resolvedImageUrl,
                  prompt: imagePayload.prompt ?? null,
                  error: null,
                  createdAt: resolvedAt,
                  updatedAt: resolvedAt,
                },
              ],
            }
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
          return {
            ...previousState,
            [options.assistantMessageId]:
              hasUpdatedEntry
                ? nextEntries
                : [
                    {
                      id: persistedEntryId,
                      status: 'ready',
                      imageUrl: resolvedImageUrl,
                      prompt: imagePayload.prompt ?? null,
                      error: null,
                      createdAt: resolvedAt,
                      updatedAt: resolvedAt,
                    },
                  ],
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
          return {
            ...previousState,
            [options.assistantMessageId]:
              hasUpdatedEntry
                ? nextEntries
                : [
                    {
                      id: loadingEntryId,
                      status: 'error',
                      imageUrl: null,
                      prompt: null,
                      error: detail,
                      createdAt: resolvedAt,
                      updatedAt: resolvedAt,
                    },
                  ],
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

  const handleGenerateLatestTurnImage = useCallback(() => {
    if (!activeGameId || !currentRerollAssistantMessage || isGenerating || isCreatingGame || isUndoingAssistantStep) {
      return
    }
    setErrorMessage('')
    void generateTurnImageAfterAssistantMessage({
      gameId: activeGameId,
      assistantMessageId: currentRerollAssistantMessage.id,
    }).catch((error) => {
      console.error('Turn image generation start failed', error)
    })
  }, [
    activeGameId,
    currentRerollAssistantMessage,
    generateTurnImageAfterAssistantMessage,
    isCreatingGame,
    isGenerating,
    isUndoingAssistantStep,
  ])

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
      setIsAutoScrollPaused(false)
      setErrorMessage('')
      setIsGenerating(true)
      setActiveAssistantMessageId(null)
      const controller = new AbortController()
      generationAbortRef.current = controller
      let wasAborted = false
      let streamStarted = false
      let generationFailed = false
      let postprocessPending = false
      let startedAssistantMessageId: number | null = null
      let completedAssistantMessageId: number | null = null

      try {
        await generateStoryResponseStream({
          token: authToken,
          gameId: options.gameId,
          prompt: options.prompt,
          rerollLastResponse: options.rerollLastResponse,
          discardLastAssistantSteps: options.discardLastAssistantSteps,
          instructions: (options.instructionCards ?? [])
            .filter((card) => card.is_active !== false)
            .map((card) => ({
              title: card.title.replace(/\s+/g, ' ').trim(),
              content: replaceMainHeroInlineTags(card.content.replace(/\r\n/g, '\n').trim(), mainHeroDisplayNameForTags),
            }))
            .filter((card) => card.title.length > 0 && card.content.length > 0),
          storyLlmModel,
          responseMaxTokens: responseMaxTokensEnabled ? responseMaxTokens : undefined,
          memoryOptimizationEnabled,
          storyTemperature,
          storyTopK,
          storyTopR,
          showGgThoughts,
          showNpcThoughts,
          ambientEnabled,
          signal: controller.signal,
          onStart: (payload) => {
            streamStarted = true
            if (options.rerollLastResponse) {
              setIsRerollTurnPendingReplacement(false)
            }
            startedAssistantMessageId = payload.assistant_message_id
            setActiveAssistantMessageId(payload.assistant_message_id)
            setMessages((previousMessages) => {
              const nextMessages = [...previousMessages]
              if (payload.user_message_id !== null) {
                const persistedUserMessageId = payload.user_message_id
                const firstTempUserIndex = nextMessages.findIndex((message) => message.id < 0 && message.role === 'user')
                if (firstTempUserIndex >= 0) {
                  const replacedTempUserMessageId = nextMessages[firstTempUserIndex].id
                  nextMessages[firstTempUserIndex] = {
                    ...nextMessages[firstTempUserIndex],
                    id: persistedUserMessageId,
                  }
                  if (hiddenContinueTempUserMessageIdRef.current === replacedTempUserMessageId) {
                    setHiddenUserMessageIds((previousIds) =>
                      previousIds.map((messageId) => (messageId === replacedTempUserMessageId ? persistedUserMessageId : messageId)),
                    )
                    hiddenContinueTempUserMessageIdRef.current = null
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
          onPlotMemory: (payload) => {
            const nextPlotEvents = payload.plot_card_events ?? []
            const nextPlotCards = payload.plot_cards ?? null
            const nextAiMemoryBlocks = payload.ai_memory_blocks ?? null
            if (nextPlotCards !== null) {
              setPlotCards(nextPlotCards)
            } else if (nextPlotEvents.length > 0) {
              setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, nextPlotEvents, options.gameId))
            }
            if (nextAiMemoryBlocks !== null) {
              setAiMemoryBlocks(nextAiMemoryBlocks)
            }
            applyPlotCardEvents(nextPlotEvents)
          },
          onDone: (payload) => {
            completedAssistantMessageId = payload.message.id
            if (payload.user) {
              onUserUpdate(payload.user)
            }
            postprocessPending = Boolean(payload.postprocess_pending)
            const nextPlotEvents = payload.plot_card_events ?? []
            const nextWorldEvents = payload.world_card_events ?? []
            const nextPlotCards = payload.plot_cards ?? null
            const nextAiMemoryBlocks = payload.ai_memory_blocks ?? null
            const nextWorldCards = payload.world_cards ?? null
            if (nextPlotCards !== null) {
              setPlotCards(nextPlotCards)
            } else if (nextPlotEvents.length > 0) {
              setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, nextPlotEvents, options.gameId))
            }
            if (nextAiMemoryBlocks !== null) {
              setAiMemoryBlocks(nextAiMemoryBlocks)
            }
            if (nextWorldCards !== null) {
              setWorldCards(nextWorldCards)
            } else if (nextWorldEvents.length > 0) {
              setWorldCards((previousCards) => reapplyWorldCardsByEvents(previousCards, nextWorldEvents, options.gameId))
            }
            applyPlotCardEvents(nextPlotEvents)
            applyWorldCardEvents(nextWorldEvents)
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
        if (options.rerollLastResponse && !streamStarted) {
          setIsRerollTurnPendingReplacement(false)
        }
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
          const refreshedGames = await listStoryGames(authToken, { compact: true })
          setGames(sortGamesByActivity(refreshedGames))
        } catch {
          // Keep current games if refresh failed.
        }

        const shouldRetryGameSyncWithoutDoneEvent =
          !wasAborted && streamStarted && startedAssistantMessageId !== null && completedAssistantMessageId === null
        if (shouldRetryGameSyncWithoutDoneEvent) {
          const retryAttempts = 2
          for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 800)
            })
            if (activeGameIdRef.current !== options.gameId) {
              break
            }
            if (generationAbortRef.current !== null) {
              break
            }
            await loadGameById(options.gameId, { silent: true })
          }
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
                const refreshedGames = await listStoryGames(authToken, { compact: true })
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
      applyPlotCardEvents,
      applyWorldCardEvents,
      ambientEnabled,
      authToken,
      loadGameById,
      memoryOptimizationEnabled,
      onUserUpdate,
      responseMaxTokensEnabled,
      responseMaxTokens,
      showGgThoughts,
      showNpcThoughts,
      mainHeroDisplayNameForTags,
      storyLlmModel,
      storyTemperature,
      storyTopK,
      storyTopR,
      setIsRerollTurnPendingReplacement,
    ],
  )

  const stopVoiceInput = useCallback(() => {
    voiceSessionRequestedRef.current = false
    const activeRecognition = voiceRecognitionRef.current
    if (activeRecognition) {
      try {
        activeRecognition.stop()
      } catch {
        // Ignore repeated stop calls from toggle handlers.
      }
    }
    setIsVoiceInputActive(false)
  }, [])

  const startVoiceInput = useCallback(() => {
    if (isVoiceInputActive || !speechRecognitionCtor || !canUseVoiceInput) {
      if (!speechRecognitionCtor && !isGenerating && !hasPromptText) {
        setErrorMessage('Голосовой ввод недоступен в этом браузере.')
      }
      return
    }

    voiceSessionRequestedRef.current = true

    const recognition = new speechRecognitionCtor()
    voiceRecognitionRef.current = recognition
    hasVoiceTranscriptRef.current = false
    voiceBasePromptRef.current = inputValue.replace(/\r\n/g, '\n').trim()
    voiceFinalTranscriptRef.current = ''

    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => {
      setIsVoiceInputActive(true)
    }
    recognition.onresult = (event: Event) => {
      const rawResults = (event as Event & { results?: BrowserSpeechRecognitionResultList }).results
      if (!rawResults) {
        return
      }

      const finalizedParts: string[] = []
      const interimParts: string[] = []
      for (let index = 0; index < rawResults.length; index += 1) {
        const result = rawResults[index] as ({ isFinal?: boolean } & ArrayLike<BrowserSpeechRecognitionResultAlternative>) | undefined
        if (!result) {
          continue
        }
        const candidate = result[0]
        const transcript = typeof candidate?.transcript === 'string' ? candidate.transcript.trim() : ''
        if (transcript) {
          if (result.isFinal) {
            finalizedParts.push(transcript)
          } else {
            interimParts.push(transcript)
          }
        }
      }

      const normalizedFinalTranscript = finalizedParts.join(' ').replace(/\s+/g, ' ').trim()
      voiceFinalTranscriptRef.current = normalizedFinalTranscript
      hasVoiceTranscriptRef.current = normalizedFinalTranscript.length > 0
      const interimTranscript = interimParts.join(' ').replace(/\s+/g, ' ').trim()
      const combinedTranscript = [voiceBasePromptRef.current, normalizedFinalTranscript, interimTranscript]
        .filter((value) => value.trim().length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      setInputValue(combinedTranscript.slice(0, STORY_PROMPT_MAX_LENGTH))
    }
    recognition.onerror = (event: Event) => {
      const errorCode = String((event as Event & { error?: string }).error ?? '').trim().toLowerCase()
      if (!errorCode || errorCode === 'aborted' || errorCode === 'no-speech') {
        return
      }
      setErrorMessage('Не удалось распознать голос. Проверьте разрешение на микрофон и попробуйте снова.')
    }
    recognition.onend = () => {
      voiceRecognitionRef.current = null
      setIsVoiceInputActive(false)
      if (!voiceSessionRequestedRef.current) {
        return
      }
      window.setTimeout(() => {
        if (!voiceSessionRequestedRef.current) {
          return
        }
        if (voiceRecognitionRef.current) {
          return
        }
        if (isGenerating || isCreatingGame || hasInsufficientTokensForTurn) {
          voiceSessionRequestedRef.current = false
          return
        }
        startVoiceInput()
      }, 140)
    }

    try {
      recognition.start()
    } catch {
      voiceRecognitionRef.current = null
      setIsVoiceInputActive(false)
      setErrorMessage('Не удалось запустить голосовой ввод.')
    }
  }, [canUseVoiceInput, hasPromptText, inputValue, isCreatingGame, isGenerating, isVoiceInputActive, hasInsufficientTokensForTurn, speechRecognitionCtor])

  const sendStoryPrompt = useCallback(
    async (rawPrompt: string, options?: { clearComposer?: boolean; hideUserMessage?: boolean }) => {
      if (isGenerating) {
        return null
      }

      if (hasInsufficientTokensForTurn) {
        if (options?.clearComposer) {
          setInputValue('')
        }
        setErrorMessage(`Недостаточно солов для хода: нужно ${currentTurnCostTokens}.`)
        setTopUpError('')
        setTopUpDialogOpen(true)
        setProfileDialogOpen(false)
        setConfirmLogoutOpen(false)
        return null
      }

      const normalizedPrompt = rawPrompt.replace(/\r\n/g, '\n').trim()
      if (!normalizedPrompt) {
        return null
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
          setAiMemoryBlocks([])
          setWorldCards([])
          applyPlotCardEvents([])
          applyWorldCardEvents([])
          onNavigate(`/home/${newGame.id}`)
          targetGameId = newGame.id
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Не удалось создать игру'
          setErrorMessage(detail)
          return null
        }
      }

      if (!targetGameId) {
        return null
      }

      setIsAutoScrollPaused(false)
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
      if (options?.hideUserMessage) {
        hiddenContinueTempUserMessageIdRef.current = temporaryUserMessageId
        setHiddenUserMessageIds((previousIds) =>
          previousIds.includes(temporaryUserMessageId) ? previousIds : [...previousIds, temporaryUserMessageId],
        )
      } else {
        hiddenContinueTempUserMessageIdRef.current = null
      }
      if (options?.clearComposer) {
        setInputValue('')
      }

      return runStoryGeneration({
        gameId: targetGameId,
        prompt: normalizedPrompt,
        instructionCards,
      })
    },
    [
      activeGameId,
      applyPlotCardEvents,
      applyStoryGameSettings,
      applyWorldCardEvents,
      authToken,
      currentTurnCostTokens,
      hasInsufficientTokensForTurn,
      instructionCards,
      isGenerating,
      onNavigate,
      runStoryGeneration,
    ],
  )

  const handleSendPrompt = useCallback(async () => {
    if (isVoiceInputActive) {
      voiceSessionRequestedRef.current = false
      const activeRecognition = voiceRecognitionRef.current
      if (activeRecognition) {
        try {
          activeRecognition.stop()
        } catch {
          // Ignore voice stop errors before message send.
        }
      }
      setIsVoiceInputActive(false)
    }

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
        setAiMemoryBlocks([])
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
  }, [activeGameId, applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken, currentTurnCostTokens, hasInsufficientTokensForTurn, inputValue, instructionCards, isGenerating, isVoiceInputActive, onNavigate, runStoryGeneration])

  const handleContinueStory = useCallback(
    async (assistantMessageId: number) => {
      if (isGenerating || isCreatingGame) {
        return
      }
      setContinueHiddenForMessageId(assistantMessageId)
      const generationResult = await sendStoryPrompt(STORY_CONTINUE_PROMPT, { hideUserMessage: true })
      if (!generationResult?.streamStarted) {
        setContinueHiddenForMessageId(null)
      }
    },
    [isCreatingGame, isGenerating, sendStoryPrompt],
  )

  const handleVoiceActionClick = useCallback(() => {
    if (isGenerating) {
      const activeController = generationAbortRef.current
      if (activeController) {
        activeController.abort()
        generationAbortRef.current = null
      }
      setIsGenerating(false)
      setActiveAssistantMessageId(null)
      return
    }
    if (!showMicAction) {
      void handleSendPrompt()
      return
    }
    if (isVoiceInputActive) {
      stopVoiceInput()
      return
    }
    voiceSessionRequestedRef.current = true
    startVoiceInput()
  }, [handleSendPrompt, isGenerating, isVoiceInputActive, showMicAction, startVoiceInput, stopVoiceInput])

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
        const refreshedGames = await listStoryGames(authToken, { compact: true })
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
        const refreshedGames = await listStoryGames(authToken, { compact: true })
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

    setErrorMessage('')

    if (!currentRerollSourceUserMessage) {
      return
    }

    const rerollAssistantMessage = currentRerollAssistantMessage
    const relatedPlotEvents = rerollAssistantMessage
      ? plotCardEvents
          .filter((event) => event.assistant_message_id === rerollAssistantMessage.id)
          .sort((left, right) => left.id - right.id)
      : []
    const relatedWorldEvents = rerollAssistantMessage
      ? worldCardEvents
          .filter((event) => event.assistant_message_id === rerollAssistantMessage.id)
          .sort((left, right) => left.id - right.id)
      : []
    const remainingPlotEvents = rerollAssistantMessage
      ? plotCardEvents.filter((event) => event.assistant_message_id !== rerollAssistantMessage.id)
      : plotCardEvents
    const remainingWorldEvents = rerollAssistantMessage
      ? worldCardEvents.filter((event) => event.assistant_message_id !== rerollAssistantMessage.id)
      : worldCardEvents
    const relatedMemoryBlocks = rerollAssistantMessage
      ? aiMemoryBlocks
          .filter((block) => block.assistant_message_id === rerollAssistantMessage.id)
          .sort((left, right) => left.id - right.id)
      : []
    const remainingMemoryBlocks = rerollAssistantMessage
      ? aiMemoryBlocks.filter((block) => block.assistant_message_id !== rerollAssistantMessage.id)
      : aiMemoryBlocks

    if (rerollAssistantMessage) {
      setIsRerollTurnPendingReplacement(true)
      setMessages((previousMessages) => previousMessages.filter((message) => message.id !== rerollAssistantMessage.id))
      clearTurnImageEntries([rerollAssistantMessage.id])
      setPlotCards((previousCards) => rollbackPlotCardsByEvents(previousCards, relatedPlotEvents, activeGameId))
      setWorldCards((previousCards) => rollbackWorldCardsByEvents(previousCards, relatedWorldEvents, activeGameId))
      setAiMemoryBlocks(remainingMemoryBlocks)
      setOpenedAiMemoryBlockId((previousId) => {
        if (previousId === null) {
          return previousId
        }
        return remainingMemoryBlocks.some((block) => block.id === previousId) ? previousId : null
      })
      applyPlotCardEvents(remainingPlotEvents)
      applyWorldCardEvents(remainingWorldEvents)
    }

    const generationResult = await runStoryGeneration({
      gameId: activeGameId,
      rerollLastResponse: true,
      instructionCards,
    })

    if (rerollAssistantMessage && generationResult.failed && !generationResult.streamStarted) {
      setIsRerollTurnPendingReplacement(false)
      setMessages((previousMessages) => {
        if (previousMessages.some((message) => message.id === rerollAssistantMessage.id)) {
          return previousMessages
        }
        return [...previousMessages, rerollAssistantMessage].sort((left, right) => left.id - right.id)
      })
      setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, relatedPlotEvents, activeGameId))
      setWorldCards((previousCards) => reapplyWorldCardsByEvents(previousCards, relatedWorldEvents, activeGameId))
      setAiMemoryBlocks((previousBlocks) =>
        [...previousBlocks, ...relatedMemoryBlocks]
          .filter((block, index, array) => array.findIndex((candidate) => candidate.id === block.id) === index)
          .sort((left, right) => left.id - right.id),
      )
      applyPlotCardEvents(mergePlotEvents(remainingPlotEvents, relatedPlotEvents))
      applyWorldCardEvents(mergeWorldEvents(remainingWorldEvents, relatedWorldEvents))
    }
  }, [
    aiMemoryBlocks,
    activeGameId,
    applyPlotCardEvents,
    applyWorldCardEvents,
    canReroll,
    clearTurnImageEntries,
    currentTurnCostTokens,
    currentRerollAssistantMessage,
    currentRerollSourceUserMessage,
    hasInsufficientTokensForTurn,
    instructionCards,
    plotCardEvents,
    runStoryGeneration,
    setIsRerollTurnPendingReplacement,
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

  const profileName = user.display_name || 'грок'

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
          { key: 'games-all', label: 'Сообщество', isActive: false, onClick: () => onNavigate('/games/all') },
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
        onOpenBugReportDialog={handleOpenBugReportDialog}
        rightActionsWidth={360}
        rightActions={
          <Stack data-tour-id="story-right-mode-buttons" direction="row" sx={{ gap: 'var(--morius-icon-gap)' }}>
            <IconButton
              data-tour-id="story-right-mode-world"
              aria-label="Сюжет и мир"
              onClick={() => {
                setRightPanelMode('world')
                setActiveWorldPanelTab('story')
              }}
              sx={rightPanelModeButtonSx(rightPanelMode === 'world')}
            >
              <RightPanelWorldIcon />
            </IconButton>
            <IconButton
              data-tour-id="story-right-mode-ai"
              aria-label="Инструкции и настройки"
              onClick={() => {
                setRightPanelMode('ai')
                setActiveAiPanelTab('instructions')
              }}
              sx={rightPanelModeButtonSx(rightPanelMode === 'ai')}
            >
              <RightPanelAiIcon />
            </IconButton>
            <IconButton
              data-tour-id="story-right-mode-memory"
              aria-label="Память"
              onClick={() => {
                setRightPanelMode('memory')
                setActiveMemoryPanelTab('memory')
              }}
              sx={rightPanelModeButtonSx(rightPanelMode === 'memory')}
            >
              <RightPanelMemoryIcon />
            </IconButton>
            <Button
              variant="text"
              onClick={() => onNavigate('/profile')}
              data-tour-id="header-profile-button"
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
        <Box sx={{ px: '10px', pt: 'var(--morius-story-right-padding)', borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
          <Box
            data-tour-id="story-right-subtabs"
            sx={{
              display: 'grid',
              gridTemplateColumns: isRightPanelSecondTabVisible ? '1fr 1fr' : '1fr',
              alignItems: 'center',
              gap: 0.2,
            }}
          >
            <Button
              data-tour-id="story-right-subtab-primary"
              onClick={() =>
                rightPanelMode === 'ai'
                  ? setActiveAiPanelTab('instructions')
                  : rightPanelMode === 'world'
                    ? setActiveWorldPanelTab('story')
                    : setActiveMemoryPanelTab('memory')
              }
              sx={{
                color: isLeftPanelTabActive ? rightPanelActiveTabColor : 'var(--morius-text-secondary)',
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
                  backgroundColor: rightPanelTabHoverBackground,
                  color: isLeftPanelTabActive ? rightPanelActiveTabColor : 'var(--morius-text-secondary)',
                },
                '&:active': {
                  backgroundColor: rightPanelTabHoverBackground,
                },
              }}
            >
              {leftPanelTabLabel}
            </Button>
              {isRightPanelSecondTabVisible ? (
                <Button
                  data-tour-id="story-right-subtab-secondary"
                  onClick={() =>
                    rightPanelMode === 'ai'
                      ? setActiveAiPanelTab('settings')
                    : rightPanelMode === 'world'
                      ? setActiveWorldPanelTab('world')
                      : setActiveMemoryPanelTab('dev')
                }
                sx={{
                  color: isLeftPanelTabActive ? 'var(--morius-text-secondary)' : rightPanelActiveTabColor,
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
                    backgroundColor: rightPanelTabHoverBackground,
                    color: isLeftPanelTabActive ? 'var(--morius-text-secondary)' : rightPanelActiveTabColor,
                  },
                  '&:active': {
                    backgroundColor: rightPanelTabHoverBackground,
                  },
                }}
              >
                {rightPanelTabLabel}
              </Button>
            ) : null}
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
                width: isRightPanelSecondTabVisible ? '50%' : '100%',
                height: '100%',
                backgroundColor: 'var(--morius-accent)',
                transform: isRightPanelSecondTabVisible
                  ? isLeftPanelTabActive
                    ? 'translateX(0)'
                    : 'translateX(100%)'
                  : 'translateX(0)',
                transition: 'transform 220ms ease',
              }}
            />
          </Box>
        </Box>
        <Box
          sx={{
            px: '10px',
            py: 'var(--morius-story-right-padding)',
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
            <Box data-tour-id="story-ai-instructions-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {instructionCards.length === 0 ? (
                <>
                  <Stack spacing={0.75}>
                    <Button
                      data-tour-id="story-ai-instructions-add-first"
                      onClick={handleOpenCreateInstructionDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 46,
                        borderRadius: '13px',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.98rem',
                        color: 'var(--morius-title-text)',
                        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
                        background:
                          isYamiTheme
                            ? 'var(--morius-elevated-bg)'
                            : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 80%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                        boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--morius-title-text) 10%, transparent)',
                        '&:hover': {
                          background:
                            isYamiTheme
                              ? 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))'
                              : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 82%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                          borderColor: isYamiTheme ? 'var(--morius-card-border)' : 'var(--morius-accent)',
                        },
                        '&:active': {
                          transform: 'translateY(1px)',
                        },
                      }}
                    >
                      Добавить первую карточку
                    </Button>
                    <Button
                      data-tour-id="story-ai-instructions-template"
                      onClick={handleOpenInstructionTemplateDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{
                        width: '100%',
                        minHeight: 46,
                        borderRadius: '13px',
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.98rem',
                        color: 'var(--morius-title-text)',
                        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        '&:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                          borderColor: isYamiTheme
                            ? 'var(--morius-card-border)'
                            : 'color-mix(in srgb, var(--morius-accent) 78%, var(--morius-card-border))',
                        },
                        '&:active': {
                          transform: 'translateY(1px)',
                        },
                      }}
                    >
                      Из шаблона
                    </Button>
                  </Stack>
                  <RightPanelEmptyState
                    tourId="story-ai-instructions-empty-state"
                    iconSrc={icons.communityCards}
                    title="Инструкции"
                    description="Задавайте свои шаблоны и ограничения, которым будет следовать ИИ. Например: отвечай максимум 5 небольшими абзацами, в художественном стиле"
                  />
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
                            opacity: card.is_active ? 1 : 0.78,
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.35}>
                            <Typography
                              sx={{
                                color: 'var(--morius-title-text)',
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
                                color: card.is_active ? 'rgba(170, 238, 191, 0.96)' : 'rgba(235, 199, 144, 0.96)',
                                fontSize: '0.66rem',
                                lineHeight: 1,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: card.is_active
                                  ? 'var(--morius-border-width) solid rgba(128, 213, 162, 0.48)'
                                  : 'var(--morius-border-width) solid rgba(227, 182, 108, 0.48)',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              {card.is_active ? 'активно' : 'неактивно'}
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
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
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
                            {replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
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
                        borderRadius: '13px',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                        background:
                          isYamiTheme
                            ? 'var(--morius-elevated-bg)'
                            : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                        '&:hover': {
                          background:
                            isYamiTheme
                              ? 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))'
                              : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                        },
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
                        borderRadius: '13px',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        '&:hover': {
                          backgroundColor: 'var(--morius-button-hover)',
                        },
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
                  <Box
                    data-tour-id="story-settings-narrator-section"
                    sx={{
                      mt: 0.35,
                      borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                    }}
                  >
                    <Button
                      data-tour-id="story-settings-narrator-toggle"
                      onClick={() => setIsNarratorSettingsExpanded((previous) => !previous)}
                      sx={{
                        width: '100%',
                        minHeight: 54,
                        px: 0,
                        borderRadius: 0,
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        backgroundColor: 'transparent',
                        border: 'none',
                        boxShadow: 'none',
                        '&:hover': { backgroundColor: 'transparent', boxShadow: 'none' },
                        '&:active': { backgroundColor: 'transparent' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent' },
                      }}
                    >
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>Рассказчик</Typography>
                      <SvgIcon
                        sx={{
                          fontSize: 21,
                          color: 'var(--morius-text-secondary)',
                          transform: isNarratorSettingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms ease',
                        }}
                      >
                        <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                      </SvgIcon>
                    </Button>
                    <Collapse in={isNarratorSettingsExpanded} timeout={200} unmountOnExit>
                      <Box data-tour-id="story-settings-narrator-panel" sx={{ pb: 0.9 }}>
                        <Stack direction="row" spacing={0.45} alignItems="center">
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                            Выбор рассказчика
                          </Typography>
                          <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.narrator} />
                        </Stack>
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
                            mt: 0.95,
                            borderRadius: '16px',
                            backgroundColor: 'var(--morius-card-bg)',
                            boxShadow: '0 10px 24px color-mix(in srgb, var(--morius-app-base) 48%, transparent)',
                            px: 1,
                            pb: 1.05,
                            pt: 0.9,
                          }}
                        >
                          <Box
                            sx={{
                              borderRadius: '12px',
                              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 80%, var(--morius-card-border))',
                              minHeight: 228,
                              px: 0.65,
                              pt: 0.45,
                              display: 'flex',
                              alignItems: 'flex-end',
                              justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              role="img"
                              aria-label={selectedNarratorOption.portraitAlt}
                              sx={{
                                width: '100%',
                                maxWidth: 286,
                                height: 226,
                                backgroundColor: 'var(--morius-text-secondary)',
                                WebkitMaskImage: `url(${selectedNarratorOption.portraitSrc})`,
                                WebkitMaskRepeat: 'no-repeat',
                                WebkitMaskPosition: 'center bottom',
                                WebkitMaskSize: 'contain',
                                maskImage: `url(${selectedNarratorOption.portraitSrc})`,
                                maskRepeat: 'no-repeat',
                                maskPosition: 'center bottom',
                                maskSize: 'contain',
                              }}
                            />
                          </Box>

                          <Typography
                            sx={{
                              mt: 0.9,
                              color: 'var(--morius-title-text)',
                              fontSize: '2.2rem',
                              fontWeight: 800,
                              letterSpacing: '-0.03em',
                              lineHeight: 1,
                            }}
                          >
                            {selectedNarratorOption.title}
                          </Typography>
                          <Typography
                            sx={{
                              mt: 0.65,
                              color: 'var(--morius-text-secondary)',
                              fontSize: '0.9rem',
                              fontWeight: 600,
                              lineHeight: 1.34,
                            }}
                          >
                            {selectedNarratorOption.description}
                          </Typography>

                          <Stack spacing={0.52} sx={{ mt: 0.9 }}>
                            {selectedNarratorOption.stats.map((stat) => (
                              <Stack key={stat.label} direction="row" alignItems="center" justifyContent="space-between">
                                <Typography
                                  sx={{
                                    color: 'var(--morius-title-text)',
                                    fontSize: '1.02rem',
                                    fontWeight: 600,
                                    lineHeight: 1.1,
                                  }}
                                >
                                  {stat.label}
                                </Typography>
                                <Stack direction="row" spacing={0.42}>
                                  {Array.from({ length: NARRATOR_STAT_DOT_COUNT }).map((_, dotIndex) => {
                                    const isActiveDot = dotIndex < stat.value
                                    return (
                                      <Box
                                        key={`${stat.label}-${dotIndex}`}
                                        sx={{
                                          width: 11,
                                          height: 11,
                                          borderRadius: '50%',
                                          backgroundColor: isActiveDot
                                            ? 'color-mix(in srgb, var(--morius-accent) 82%, var(--morius-title-text))'
                                            : 'color-mix(in srgb, var(--morius-app-base) 84%, var(--morius-card-border))',
                                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 64%, transparent)',
                                        }}
                                      />
                                    )
                                  })}
                                </Stack>
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                      </Box>
                    </Collapse>
                  </Box>

                  <Box data-tour-id="story-settings-visualization-section" sx={{ borderTop: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
                    <Button
                      data-tour-id="story-settings-visualization-toggle"
                      onClick={() => setIsVisualizationSettingsExpanded((previous) => !previous)}
                      sx={{
                        width: '100%',
                        minHeight: 54,
                        px: 0,
                        borderRadius: 0,
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        backgroundColor: 'transparent',
                        border: 'none',
                        boxShadow: 'none',
                        '&:hover': { backgroundColor: 'transparent', boxShadow: 'none' },
                        '&:active': { backgroundColor: 'transparent' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent' },
                      }}
                    >
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>Визуализация</Typography>
                      <SvgIcon
                        sx={{
                          fontSize: 21,
                          color: 'var(--morius-text-secondary)',
                          transform: isVisualizationSettingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms ease',
                        }}
                      >
                        <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                      </SvgIcon>
                    </Button>
                    <Collapse in={isVisualizationSettingsExpanded} timeout={200} unmountOnExit>
                      <Box data-tour-id="story-settings-visualization-panel" sx={{ pb: 0.9, pt: 0.08 }}>
                        <Stack direction="row" spacing={0.45} alignItems="center">
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                            Художник
                          </Typography>
                          <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.artist} />
                        </Stack>
                        <FormControl fullWidth size="small" sx={{ mt: 0.72 }}>
                          <Select
                            value={storyImageModel}
                            disabled={isSavingStorySettings || isGenerating}
                            renderValue={(selectedValue) => {
                              const option = STORY_IMAGE_MODEL_OPTIONS.find((item) => item.id === selectedValue)
                              return option ? formatStoryImageModelLabel(option) : String(selectedValue)
                            }}
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
                                {formatStoryImageModelLabel(option)}
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
                    </Collapse>
                  </Box>

                  <Box data-tour-id="story-settings-additional-section" sx={{ borderTop: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
                    <Button
                      data-tour-id="story-settings-additional-toggle"
                      onClick={() => setIsAdditionalSettingsExpanded((previous) => !previous)}
                      sx={{
                        width: '100%',
                        minHeight: 54,
                        px: 0,
                        borderRadius: 0,
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        backgroundColor: 'transparent',
                        border: 'none',
                        boxShadow: 'none',
                        '&:hover': { backgroundColor: 'transparent', boxShadow: 'none' },
                        '&:active': { backgroundColor: 'transparent' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent' },
                      }}
                    >
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>Дополнительно</Typography>
                      <SvgIcon
                        sx={{
                          fontSize: 21,
                          color: 'var(--morius-text-secondary)',
                          transform: isAdditionalSettingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms ease',
                        }}
                      >
                        <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                      </SvgIcon>
                    </Button>
                    <Collapse in={isAdditionalSettingsExpanded} timeout={200} unmountOnExit>
                      <Box
                        data-tour-id="story-settings-additional-panel"
                        sx={{
                          pb: 0.9,
                          pt: 0.08,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.72,
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                          <Stack direction="row" spacing={0.45} alignItems="center">
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 700 }}>
                              Эмбиент подсветка
                            </Typography>
                            <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.ambient} />
                          </Stack>
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
                                backgroundColor: switchCheckedTrackColor,
                                opacity: 1,
                              },
                              '& .MuiSwitch-track': {
                                backgroundColor: switchTrackColor,
                                opacity: 1,
                              },
                            }}
                          />
                        </Stack>

                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                          <Stack direction="row" spacing={0.45} alignItems="center">
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 700 }}>
                              Показывать мысли ГГ
                            </Typography>
                            <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.showGgThoughts} />
                          </Stack>
                          <Switch
                            checked={showGgThoughts}
                            onChange={() => {
                              void toggleShowGgThoughts()
                            }}
                            disabled={isSavingStorySettings || isGenerating}
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': {
                                color: 'var(--morius-accent)',
                              },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                backgroundColor: switchCheckedTrackColor,
                                opacity: 1,
                              },
                              '& .MuiSwitch-track': {
                                backgroundColor: switchTrackColor,
                                opacity: 1,
                              },
                            }}
                          />
                        </Stack>

                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                          <Stack direction="row" spacing={0.45} alignItems="center">
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 700 }}>
                              Показывать мысли NPC
                            </Typography>
                            <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.showNpcThoughts} />
                          </Stack>
                          <Switch
                            checked={showNpcThoughts}
                            onChange={() => {
                              void toggleShowNpcThoughts()
                            }}
                            disabled={isSavingStorySettings || isGenerating}
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': {
                                color: 'var(--morius-accent)',
                              },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                backgroundColor: switchCheckedTrackColor,
                                opacity: 1,
                              },
                              '& .MuiSwitch-track': {
                                backgroundColor: switchTrackColor,
                                opacity: 1,
                              },
                            }}
                          />
                        </Stack>

                        {isSavingThoughtVisibility || isSavingAmbientEnabled ? (
                          <CircularProgress size={14} sx={{ color: 'var(--morius-accent)' }} />
                        ) : null}
                      </Box>
                    </Collapse>
                  </Box>

                  <Box data-tour-id="story-settings-finetune-section" sx={{ borderTop: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
                    <Button
                      data-tour-id="story-settings-finetune-toggle"
                      onClick={() => setIsFineTuneSettingsExpanded((previous) => !previous)}
                      sx={{
                        width: '100%',
                        minHeight: 54,
                        px: 0,
                        borderRadius: 0,
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        color: 'var(--morius-title-text)',
                        backgroundColor: 'transparent',
                        border: 'none',
                        boxShadow: 'none',
                        '&:hover': { backgroundColor: 'transparent', boxShadow: 'none' },
                        '&:active': { backgroundColor: 'transparent' },
                        '&.Mui-focusVisible': { backgroundColor: 'transparent' },
                      }}
                    >
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>Дополнительная настройка</Typography>
                      <SvgIcon
                        sx={{
                          fontSize: 21,
                          color: 'var(--morius-text-secondary)',
                          transform: isFineTuneSettingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms ease',
                        }}
                      >
                        <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                      </SvgIcon>
                    </Button>
                    <Collapse in={isFineTuneSettingsExpanded} timeout={200} unmountOnExit>
                      <Box data-tour-id="story-settings-finetune-panel" sx={{ pb: 0.9, pt: 0.08 }}>
                        <Box sx={{ mt: 0.12 }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                            <Stack direction="row" spacing={0.45} alignItems="center">
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                                Лимит контекста
                              </Typography>
                              <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.contextLimit} />
                            </Stack>
                            <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.84rem' }}>{contextLimitChars}</Typography>
                          </Stack>

                          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.78 }}>
                            <Box
                              component="input"
                              value={contextLimitDraft}
                              maxLength={STORY_CONTEXT_LIMIT_INPUT_MAX_LENGTH}
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
                          <TextLimitIndicator
                            currentLength={contextLimitDraft.length}
                            maxLength={STORY_CONTEXT_LIMIT_INPUT_MAX_LENGTH}
                            sx={{ mt: 0.45 }}
                          />

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
                                backgroundColor: sliderThumbColor,
                                border: `2px solid ${sliderThumbBorderColor}`,
                              },
                              '& .MuiSlider-rail': {
                                opacity: 1,
                                backgroundColor: sliderRailColor,
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
                            <Stack spacing={0.14}>
                              <Stack direction="row" spacing={0.42} alignItems="center">
                                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.8rem', fontWeight: 700 }}>
                                  Использование контекста
                                </Typography>
                                <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.contextUsage} />
                              </Stack>
                              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem' }}>
                                {formatContextChars(cardsContextCharsUsed)} / {formatContextChars(contextLimitChars)}
                              </Typography>
                            </Stack>
                            <Button
                              onClick={() => setIsContextUsageExpanded((previous) => !previous)}
                              sx={{
                                minHeight: 28,
                                px: 1,
                                borderRadius: '999px',
                                textTransform: 'none',
                                fontSize: '0.73rem',
                                fontWeight: 700,
                                color: 'var(--morius-text-primary)',
                                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                backgroundColor: 'var(--morius-elevated-bg)',
                                '&:hover': {
                                  backgroundColor: 'var(--morius-button-hover)',
                                },
                              }}
                            >
                              {isContextUsageExpanded ? 'Свернуть' : 'Подробнее'}
                            </Button>
                          </Stack>

                          <Box
                            sx={{
                              mt: 0.64,
                              height: 7,
                              borderRadius: '999px',
                              backgroundColor: switchTrackColor,
                              overflow: 'hidden',
                            }}
                          >
                            <Box
                              sx={{
                                width: `${cardsContextUsagePercent}%`,
                                height: '100%',
                                borderRadius: '999px',
                                backgroundColor: 'var(--morius-accent)',
                                transition: 'width 180ms ease',
                              }}
                            />
                          </Box>

                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.7 }}>
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>Свободно</Typography>
                            <Typography
                              sx={{
                                color: cardsContextOverflowChars > 0 ? 'error.main' : 'success.main',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                              }}
                            >
                              {formatContextChars(freeContextChars)}
                            </Typography>
                          </Stack>

                          {isContextUsageExpanded ? (
                            <>
                              <Stack spacing={0.56} sx={{ mt: 0.85 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>Инструкции</Typography>
                                  <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.78rem', fontWeight: 600 }}>
                                    {formatContextChars(instructionContextTokensUsed)}
                                  </Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>
                                    {storyMemoryLabel}
                                  </Typography>
                                  <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.78rem', fontWeight: 600 }}>
                                    {formatContextChars(storyMemoryTokensUsed)}
                                  </Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>
                                    Карточки мира (активные)
                                  </Typography>
                                  <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.78rem', fontWeight: 600 }}>
                                    {formatContextChars(worldContextTokensUsed)}
                                  </Typography>
                                </Stack>
                              </Stack>

                              <Typography sx={{ mt: 0.72, color: 'var(--morius-text-secondary)', fontSize: '0.73rem', lineHeight: 1.36 }}>
                                {storyMemoryHint} Карточек в контексте: инструкции {normalizedInstructionCardsForContext.length}, ИИ-память{' '}
                                {normalizedAiMemoryCardsForContext.length}, сюжет {normalizedPlotCardsForContext.length}, мир{' '}
                                {normalizedWorldCardsForContext.length} из {worldCards.length}.
                              </Typography>

                              {cardsContextOverflowChars > 0 ? (
                                <Alert
                                  severity="warning"
                                  sx={{
                                    mt: 0.78,
                                    py: 0.2,
                                    borderRadius: 'var(--morius-radius)',
                                    backgroundColor: 'rgba(171, 57, 26, 0.16)',
                                    color: 'var(--morius-text-primary)',
                                    border: 'var(--morius-border-width) solid rgba(214, 116, 82, 0.32)',
                                    '& .MuiAlert-icon': {
                                      color: 'error.main',
                                      alignItems: 'center',
                                      py: 0.1,
                                    },
                                  }}
                                >
                                  Карточки превышают лимит на {formatContextChars(cardsContextOverflowChars)} токенов.
                                </Alert>
                              ) : null}
                            </>
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
                            <Stack direction="row" spacing={0.45} alignItems="center">
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 700 }}>
                                Ответ ИИ в токенах
                              </Typography>
                              <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.responseTokens} />
                            </Stack>
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
                                  backgroundColor: switchCheckedTrackColor,
                                  opacity: 1,
                                },
                                '& .MuiSwitch-track': {
                                  backgroundColor: switchTrackColor,
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
                                  backgroundColor: sliderThumbColor,
                                  border: `2px solid ${sliderThumbBorderColor}`,
                                },
                                '& .MuiSlider-rail': {
                                  opacity: 1,
                                  backgroundColor: sliderRailColor,
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
                            <Stack direction="row" spacing={0.45} alignItems="center">
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>
                                Параметры модели
                              </Typography>
                              <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.temperature} />
                            </Stack>
                            <Button
                              onClick={() => {
                                void handleResetStorySampling()
                              }}
                              disabled={
                                isSavingStorySettings ||
                                isGenerating ||
                                (storyTemperature === STORY_DEFAULT_TEMPERATURE &&
                                  storyTopK === STORY_DEFAULT_TOP_K &&
                                  storyTopR === STORY_DEFAULT_TOP_R)
                              }
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
                              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>
                                Температура
                              </Typography>
                              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>
                                {storyTemperature.toFixed(2)}
                              </Typography>
                            </Stack>
                            <Slider
                              value={storyTemperature}
                              min={STORY_TEMPERATURE_MIN}
                              max={STORY_TEMPERATURE_MAX}
                              step={0.01}
                              onChange={handleStoryTemperatureSliderChange}
                              onChangeCommitted={(event, value) => {
                                void handleStoryTemperatureSliderCommit(event, value)
                              }}
                              disabled={isSavingStorySettings || isGenerating}
                              sx={{
                                mt: 0.42,
                                color: 'var(--morius-accent)',
                                '& .MuiSlider-thumb': {
                                  width: 14,
                                  height: 14,
                                  backgroundColor: sliderThumbColor,
                                  border: `2px solid ${sliderThumbBorderColor}`,
                                },
                                '& .MuiSlider-rail': {
                                  opacity: 1,
                                  backgroundColor: sliderRailColor,
                                },
                              }}
                            />
                          </Box>

                          <Box sx={{ mt: 0.34 }}>
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
                                  backgroundColor: sliderThumbColor,
                                  border: `2px solid ${sliderThumbBorderColor}`,
                                },
                                '& .MuiSlider-rail': {
                                  opacity: 1,
                                  backgroundColor: sliderRailColor,
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
                                  backgroundColor: sliderThumbColor,
                                  border: `2px solid ${sliderThumbBorderColor}`,
                                },
                                '& .MuiSlider-rail': {
                                  opacity: 1,
                                  backgroundColor: sliderRailColor,
                                },
                              }}
                            />
                          </Box>

                          {isSavingStorySampling ? <CircularProgress size={14} sx={{ mt: 0.45, color: 'var(--morius-accent)' }} /> : null}
                        </Box>
                      </Box>
                    </Collapse>
                  </Box>
                </>
              )}
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'memory' && activeMemoryPanelTab === 'memory' ? (
            <Box data-tour-id="story-memory-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Button
                onClick={handleOpenCreateMemoryBlockDialog}
                disabled={isMemoryCardActionLocked || !activeGameId}
                sx={{
                  minHeight: 44,
                  borderRadius: '13px',
                  textTransform: 'none',
                  color: 'var(--morius-title-text)',
                  border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                  background:
                    isYamiTheme
                      ? 'var(--morius-elevated-bg)'
                      : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                  '&:hover': {
                    background:
                      isYamiTheme
                        ? 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))'
                        : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                  },
                }}
              >
                {importantMemoryBlocks.length === 0 ? 'Добавить первую карточку' : 'Добавить карточку'}
              </Button>
              {importantMemoryBlocks.length === 0 ? (
                <RightPanelEmptyState
                  iconSrc={icons.communityInfo}
                  title="Память"
                  description="Здесь появятся только действительно важные моменты сюжета. Обычные ходы сюда не попадают."
                />
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
                  <Stack spacing={0.75}>
                    {importantMemoryBlocks.map((block) => (
                      <Button
                        key={block.id}
                        onClick={() => setOpenedAiMemoryBlockId(block.id)}
                        sx={{
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          px: 0.8,
                          py: 0.72,
                          minHeight: 66,
                          textTransform: 'none',
                          justifyContent: 'flex-start',
                          alignItems: 'flex-start',
                          '&:hover': {
                            backgroundColor: 'var(--morius-button-hover)',
                          },
                        }}
                      >
                        <Stack spacing={0.28} sx={{ width: '100%' }}>
                          <Typography
                            sx={{
                              color: 'var(--morius-title-text)',
                              fontSize: '0.83rem',
                              fontWeight: 700,
                              textAlign: 'left',
                              lineHeight: 1.24,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            #{block.id} В· {block.title}
                          </Typography>
                          <Typography
                            sx={{
                              color: 'var(--morius-text-secondary)',
                              fontSize: '0.76rem',
                              textAlign: 'left',
                              lineHeight: 1.35,
                              whiteSpace: 'pre-wrap',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {block.content}
                          </Typography>
                        </Stack>
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'memory' && canViewDevMemoryTab && activeMemoryPanelTab === 'dev' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 700 }}>
                  DEV В·  память
                </Typography>
                {(['raw', 'compressed', 'super'] as const).map((layer) => {
                  const layerBlocks = aiMemoryBlocksByLayer.get(layer) ?? []
                  return (
                    <Box
                      key={`ai-memory-${layer}`}
                      sx={{
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        px: 0.8,
                        py: 0.75,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.6,
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 700 }}>
                          {AI_MEMORY_LAYER_LABEL[layer]}
                        </Typography>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                          {layerBlocks.length}
                        </Typography>
                      </Stack>
                      {layerBlocks.length === 0 ? (
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem' }}>
                          Пусто
                        </Typography>
                      ) : (
                        <Stack spacing={0.45}>
                          {layerBlocks.map((block) => (
                            <Button
                              key={block.id}
                              onClick={() => setOpenedAiMemoryBlockId(block.id)}
                              sx={{
                                minHeight: 38,
                                borderRadius: '10px',
                                px: 0.65,
                                py: 0.5,
                                textTransform: 'none',
                                justifyContent: 'flex-start',
                                alignItems: 'flex-start',
                                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                                backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 78%, transparent)',
                                '&:hover': {
                                  backgroundColor: 'var(--morius-button-hover)',
                                },
                              }}
                            >
                              <Stack spacing={0.22} sx={{ width: '100%' }}>
                                <Typography
                                  sx={{
                                    color: 'var(--morius-title-text)',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    textAlign: 'left',
                                    lineHeight: 1.25,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  #{block.id} В· {block.title}
                                </Typography>
                                <Typography
                                  sx={{
                                    color: 'var(--morius-text-secondary)',
                                    fontSize: '0.74rem',
                                    textAlign: 'left',
                                    lineHeight: 1.3,
                                    whiteSpace: 'pre-wrap',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {block.content}
                                </Typography>
                              </Stack>
                            </Button>
                          ))}
                        </Stack>
                      )}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
            <Box data-tour-id="story-world-plot-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {plotCards.length === 0 ? (
                <>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || isCreatingGame}
                    sx={{
                      minHeight: 44,
                      borderRadius: '13px',
                      textTransform: 'none',
                      color: 'var(--morius-title-text)',
                      border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                      background:
                        isYamiTheme
                          ? 'var(--morius-elevated-bg)'
                          : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                      '&:hover': {
                        background:
                          isYamiTheme
                            ? 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))'
                            : 'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                      },
                    }}
                  >
                    Добавить первую карточку
                  </Button>
                  <RightPanelEmptyState
                    iconSrc={icons.communityInfo}
                    title="Сюжет"
                    description="Карточки сюжета создаются только вручную. ИИ их не создает и не редактирует."
                  />
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
                      {plotCards.map((card) => {
                        const contextState = plotCardContextStateById.get(card.id)
                        const isCardContextActive = Boolean(contextState?.isActive)
                        const resolvedPlotMemoryTurns = resolvePlotCardMemoryTurns(card)
                        const resolvedPlotCardContent = replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)
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
                              {formatPlotCardContextStatus(contextState)}
                            </Typography>
                          </Stack>
                          <Box
                            sx={{
                              borderRadius: '12px',
                              border: !card.is_enabled
                                ? 'var(--morius-border-width) solid rgba(137, 154, 178, 0.42)'
                                : isCardContextActive
                                  ? 'var(--morius-border-width) solid rgba(131, 213, 164, 0.62)'
                                  : 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: !card.is_enabled
                                ? 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)'
                                : isCardContextActive
                                  ? 'rgba(18, 30, 24, 0.54)'
                                  : 'var(--morius-elevated-bg)',
                              boxShadow: isCardContextActive ? '0 0 0 1px rgba(79, 164, 116, 0.22) inset' : 'none',
                              px: 'var(--morius-story-right-padding)',
                              py: 'var(--morius-story-right-padding)',
                              height: RIGHT_PANEL_CARD_HEIGHT,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              opacity: card.is_enabled ? 1 : 0.82,
                            }}
                          >
                            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.45 }}>
                              <Typography
                                sx={{
                                  color: 'var(--morius-title-text)',
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
                                <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                              </IconButton>
                            </Stack>
                            <Typography
                              sx={{
                                mt: 0.55,
                                color: card.is_enabled ? 'rgba(207, 217, 232, 0.86)' : 'rgba(181, 194, 214, 0.72)',
                                fontSize: '0.86rem',
                                lineHeight: 1.4,
                                whiteSpace: 'pre-wrap',
                                display: '-webkit-box',
                                WebkitLineClamp: 5,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {resolvedPlotCardContent}
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
                            <Typography
                              sx={{
                                mt: 0.2,
                                color: 'rgba(170, 190, 214, 0.72)',
                                fontSize: '0.74rem',
                                lineHeight: 1.25,
                              }}
                            >
                              Память: {resolvedPlotMemoryTurns === null ? 'выключено' : `${resolvedPlotMemoryTurns} ${formatTurnsWord(resolvedPlotMemoryTurns)}`}
                            </Typography>
                          </Box>
                        </Box>
                        )
                      })}
                    </Stack>
                  </Box>
                  <Button
                    onClick={handleOpenCreatePlotCardDialog}
                    disabled={isGenerating || isSavingPlotCard || deletingPlotCardId !== null || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: 'var(--morius-text-primary)',
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
            <Box data-tour-id="story-world-world-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Stack direction="column" spacing={0.7}>
                {!mainHeroCard ? (
                  <Button
                    onClick={() => void handleOpenCharacterSelectorForMainHero()}
                    disabled={isGenerating || isCreatingGame}
                    sx={{
                      minHeight: 40,
                      borderRadius: '12px',
                      textTransform: 'none',
                      color: 'var(--morius-text-primary)',
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
                    {renderPreviewableCharacterAvatar({
                      avatarUrl: mainHeroAvatarUrl,
                      previewUrl: mainHeroPreviewAvatarUrl,
                      avatarScale: mainHeroCard.avatar_scale,
                      fallbackLabel: mainHeroCard.title,
                      size: 28,
                    })}
                    <Stack spacing={0.05} sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-primary)',
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
                      <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
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
                    color: 'var(--morius-text-primary)',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                  }}
                >
                  Добавить NPC из персонажей
                </Button>
              </Stack>
              <Typography sx={{ color: 'rgba(171, 189, 214, 0.66)', fontSize: '0.76rem', lineHeight: 1.35 }}>
                Главный герой всегда активен. Остальные карточки активируются по триггерам из сообщений игрока и ИИ. У NPC по умолчанию память 3 хода, ее можно менять при редактировании карточки NPC.
              </Typography>

              {displayedWorldCards.length === 0 ? (
                <RightPanelEmptyState
                  iconSrc={icons.world}
                  title="Мир"
                  description="Добавляйте новых NPC, а также важные предметы. Например: Ключ. Виктория передала ГГ ключ от потайной комнаты в замке."
                />
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
                              {card.ai_edit_enabled ? ': РАЗРЕШЕНО' : ': ЗАПРЕЩЕНО'}
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
                                    color: 'var(--morius-title-text)',
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
                                  ИИ
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
                                <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
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
                  color: 'var(--morius-text-primary)',
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
        onScroll={handleMessagesViewportScroll}
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
          {shouldShowStoryTitleLoadingSkeleton ? (
            <StoryTitleLoadingSkeleton />
          ) : (
            <Box
              sx={{
                px: { xs: 0.3, md: 0.8 },
                mb: 1.1,
              }}
            >
              <Typography
                component="div"
                contentEditable={!isGenerating && Boolean(activeGameId)}
                suppressContentEditableWarning
                spellCheck={false}
                onFocus={handleInlineTitleFocus}
                onInput={(event) => {
                  truncateContentEditableText(event.currentTarget, STORY_GAME_TITLE_MAX_LENGTH)
                }}
                onBlur={handleInlineTitleBlur}
                onKeyDown={handleInlineTitleKeyDown}
                sx={{
                  color: 'var(--morius-title-text)',
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
              {isPrivateStoryGame ? (
                <Box
                  sx={{
                    mt: 0.8,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.8,
                    px: 1.05,
                    py: 0.55,
                    borderRadius: '999px',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 44%, var(--morius-card-border))',
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--morius-button-active) 78%, transparent) 0%, color-mix(in srgb, var(--morius-card-bg) 92%, transparent) 100%)',
                    boxShadow: '0 10px 24px color-mix(in srgb, var(--morius-accent) 14%, transparent)',
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: 'var(--morius-accent)',
                      boxShadow: '0 0 14px color-mix(in srgb, var(--morius-accent) 62%, transparent)',
                      flexShrink: 0,
                    }}
                  />
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.76rem', fontWeight: 800, letterSpacing: 0.35, textTransform: 'uppercase' }}>
                    Ходы
                  </Typography>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 800 }}>
                    {storyTurnCount} {formatTurnsWord(storyTurnCount)}
                  </Typography>
                </Box>
              ) : null}
            </Box>
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
	                        const shouldShowCharacterIdentity =
	                          block.delivery === 'thought' || !isLikelyNarrativeSpeechLine(block.text, resolvedSpeakerName)
	                        if (!shouldShowCharacterIdentity) {
	                          return (
	                            <Box
	                              key={`quick-start-character-narrative-${index}`}
	                              sx={{
	                                px: 0.05,
	                                py: 0.05,
	                              }}
	                            >
                              <Typography
                                sx={{
                                  color: assistantReplyTextColor,
                                  lineHeight: 1.58,
                                  fontSize: { xs: '1.02rem', md: '1.12rem' },
                                  ...storyHistoryTextSx,
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {block.text}
                              </Typography>
	                            </Box>
	                          )
	                        }
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
                            {renderPreviewableCharacterAvatar({
                              avatarUrl: speakerAvatar,
                              previewUrl: resolveDialogueAvatarPreview(resolvedSpeakerName),
                              fallbackLabel: resolvedSpeakerName,
                              size: ASSISTANT_DIALOGUE_AVATAR_SIZE,
                            })}
                            <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                sx={{
                                  color: block.delivery === 'thought' ? assistantThoughtLabelColor : assistantSpeakerLabelColor,
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
                                  color: isGrayTheme
                                    ? assistantReplyTextColor
                                    : block.delivery === 'thought'
                                      ? assistantThoughtTextColor
                                      : 'var(--morius-title-text)',
                                  lineHeight: 1.54,
                                  fontSize: { xs: '1rem', md: '1.08rem' },
                                  ...storyHistoryTextSx,
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
                              color: assistantReplyTextColor,
                              lineHeight: 1.58,
                              fontSize: { xs: '1.02rem', md: '1.12rem' },
                              ...storyHistoryTextSx,
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
                  if (message.role === 'user') {
                    const normalizedUserMessageContent = message.content.replace(/\r\n/g, '\n').trim()
                    if (hiddenUserMessageIds.includes(message.id) || normalizedUserMessageContent === STORY_CONTINUE_PROMPT) {
                      return null
                    }
                  }

                  if (editingMessageId === message.id) {
                    return (
                      <Box
                        key={message.id}
                        sx={{
                          mb: 'var(--morius-story-message-gap)',
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                          backgroundColor: 'var(--morius-card-bg)',
                          p: 1.1,
                        }}
                      >
                        <Box
                          component="textarea"
                          value={messageDraft}
                          autoFocus
                          maxLength={STORY_MESSAGE_MAX_LENGTH}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                            setMessageDraft(event.target.value.slice(0, STORY_MESSAGE_MAX_LENGTH))
                          }
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
                            color: 'var(--morius-text-primary)',
                            lineHeight: 1.58,
                            fontSize: { xs: '1rem', md: '1.07rem' },
                            ...storyHistoryTextSx,
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
                              color: 'var(--morius-text-primary)',
                              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 78%, transparent)',
                              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, #000 12%)',
                              minWidth: 100,
                            }}
                          >
                            {isSavingMessage ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Сохранить'}
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
                    const blocks = parseAssistantMessageBlocks(
                      replaceMainHeroInlineTags(message.content, mainHeroDisplayNameForTags),
                    )
                    const isStreaming = activeAssistantMessageId === message.id && isGenerating
                    const messagePlotCardEvents = plotCardEventsByAssistantId.get(message.id) ?? []
                    const messageWorldCardEvents = worldCardEventsByAssistantId.get(message.id) ?? []
                    const assistantTurnImages = turnImageByAssistantMessageId[message.id] ?? []
                    const shouldShowContinueButton =
                      !isStreaming &&
                      !isGenerating &&
                      !isUndoingAssistantStep &&
                      !isCreatingGame &&
                      currentRerollAssistantMessage?.id === message.id &&
                      continueHiddenForMessageId !== message.id
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
	                              const shouldShowCharacterIdentity =
	                                block.delivery === 'thought' || !isLikelyNarrativeSpeechLine(block.text, resolvedSpeakerName)
	                              if (!shouldShowCharacterIdentity) {
	                                return (
	                                  <Box
	                                    key={`${message.id}-${index}-character-narrative`}
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
	                                      onInput={(event) => {
	                                        truncateContentEditableText(event.currentTarget, STORY_MESSAGE_MAX_LENGTH)
	                                      }}
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
	                                        color: assistantReplyTextColor,
	                                        lineHeight: 1.58,
	                                        fontSize: { xs: '1.02rem', md: '1.12rem' },
	                                        ...storyHistoryTextSx,
	                                        whiteSpace: 'pre-wrap',
	                                        outline: 'none',
	                                        cursor: isGenerating ? 'default' : 'text',
	                                      }}
	                                    >
	                                      {block.text}
	                                    </Box>
	                                  </Box>
	                                )
	                              }
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
                                  {renderPreviewableCharacterAvatar({
                                    avatarUrl: speakerAvatar,
                                    previewUrl: resolveDialogueAvatarPreview(resolvedSpeakerName),
                                    fallbackLabel: resolvedSpeakerName,
                                    size: ASSISTANT_DIALOGUE_AVATAR_SIZE,
                                  })}
                                  <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography
                                      sx={{
                                        color: block.delivery === 'thought' ? assistantThoughtLabelColor : assistantSpeakerLabelColor,
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
                                      onInput={(event) => {
                                        truncateContentEditableText(event.currentTarget, STORY_MESSAGE_MAX_LENGTH)
                                      }}
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
                                        color: isGrayTheme
                                          ? assistantReplyTextColor
                                          : block.delivery === 'thought'
                                            ? assistantThoughtTextColor
                                            : 'var(--morius-title-text)',
                                        lineHeight: 1.54,
                                        fontSize: { xs: '1rem', md: '1.08rem' },
                                        ...storyHistoryTextSx,
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
                                  onInput={(event) => {
                                    truncateContentEditableText(event.currentTarget, STORY_MESSAGE_MAX_LENGTH)
                                  }}
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
                                    color: assistantReplyTextColor,
                                    lineHeight: 1.58,
                                    fontSize: { xs: '1.02rem', md: '1.12rem' },
                                    ...storyHistoryTextSx,
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
                                        Г—
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
                                        {isExpanded ? 'Л„' : 'Л…'}
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
                                        Г—
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
                                        {isExpanded ? 'Л„' : 'Л…'}
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
                                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 78%, transparent)',
                                    backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, #000 18%)',
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
                          {shouldShowContinueButton ? (
                            <Box sx={{ px: 0.05, py: 0.02 }}>
                              <Button
                                onClick={() => void handleContinueStory(message.id)}
                                disabled={isGenerating}
                                variant="text"
                                sx={{
                                  minHeight: 24,
                                  minWidth: 0,
                                  px: 1.05,
                                  py: 0,
                                  borderRadius: '8px',
                                  backgroundColor: 'transparent',
                                  textTransform: 'none',
                                  fontSize: '0.8rem',
                                  lineHeight: 1.2,
                                  fontWeight: 600,
                                  color: 'var(--morius-text-secondary)',
                                  justifyContent: 'flex-start',
                                  alignSelf: 'flex-start',
                                  '&:hover': {
                                    backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 18%, transparent)',
                                    color: 'var(--morius-title-text)',
                                  },
                                }}
                              >
                                Продолжить
                              </Button>
                            </Box>
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
                      {renderPreviewableCharacterAvatar({
                        avatarUrl: mainHeroAvatarUrl,
                        previewUrl: mainHeroPreviewAvatarUrl,
                        fallbackLabel: mainHeroCard?.title || user.display_name || 'грок',
                        size: 28,
                      })}
                      <Box
                        component="div"
                        contentEditable={!isGenerating && !isSavingMessage}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onInput={(event) => {
                          truncateContentEditableText(event.currentTarget, STORY_MESSAGE_MAX_LENGTH)
                        }}
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
                          color: playerMessageColor,
                          lineHeight: 1.58,
                          whiteSpace: 'pre-wrap',
                          fontSize: { xs: '1rem', md: '1.08rem' },
                          ...storyHistoryTextSx,
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
            {errorMessage ? (
              <Alert
                severity="error"
                onClose={() => setErrorMessage('')}
                sx={{ width: '100%', mt: 1.2, borderRadius: '12px' }}
              >
                {errorMessage}
              </Alert>
            ) : null}
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
                '@keyframes morius-composer-ambient-gradient-breathe': {
                  '0%, 100%': {
                    opacity: composerAmbientVisual.gradientOpacityMin,
                    transform: 'translate3d(0, 0, 0) scale(1)',
                    backgroundPosition: '0% 32%',
                  },
                  '50%': {
                    opacity: composerAmbientVisual.gradientOpacityMax,
                    transform: 'translate3d(0, -1%, 0) scale(1.026)',
                    backgroundPosition: '100% 68%',
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
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: '-22px',
                  borderRadius: 'calc(var(--morius-radius) + 24px)',
                  pointerEvents: 'none',
                  backgroundImage: composerAmbientVisual.gradientLayer,
                  backgroundSize: '170% 170%',
                  backgroundPosition: '0% 32%',
                  opacity: composerAmbientVisual.gradientOpacityMin,
                  transformOrigin: '50% 50%',
                  filter: 'blur(24px) saturate(112%)',
                  animation: 'morius-composer-ambient-gradient-breathe 9.4s ease-in-out infinite',
                  transition: 'opacity 1000ms ease',
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
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
              background: 'color-mix(in srgb, var(--morius-card-bg) 96%, #000 4%)',
              boxShadow: 'none',
              transition: 'none',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Stack
              data-tour-id="story-composer-input"
              direction="row"
              alignItems="stretch"
              spacing={0}
              sx={{
                px: 1.1,
                pt: 0.84,
                pb: 0.72,
                position: 'relative',
              }}
            >
              <Box
                component="textarea"
                ref={textAreaRef}
                value={inputValue}
                placeholder={inputPlaceholder}
                maxLength={STORY_PROMPT_MAX_LENGTH}
                disabled={isGenerating || hasInsufficientTokensForTurn}
                onChange={(event) => setInputValue(event.target.value.slice(0, STORY_PROMPT_MAX_LENGTH))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return
                  }
                  if (isMobileComposer) {
                    return
                  }
                  if (!event.shiftKey) {
                    event.preventDefault()
                    void handleSendPrompt()
                  }
                }}
                sx={{
                  flex: 1,
                  minHeight: 96,
                  maxHeight: '34vh',
                  resize: 'none',
                  border: 'none',
                  borderRadius: 'calc(var(--morius-radius) - 2px)',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--morius-title-text)',
                  fontSize: { xs: '1.12rem', sm: 'var(--morius-body-size)' },
                  lineHeight: 1.42,
                  fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                  px: 1.2,
                  py: 0.95,
                  pr: 8.05,
                  '&::placeholder': {
                    color: 'var(--morius-text-secondary)',
                  },
                }}
              />
              <IconButton
                aria-label={isGenerating ? 'Остановить генерацию' : 'Отправить'}
                onClick={handleVoiceActionClick}
                disabled={isGenerating ? false : (showMicAction ? (!canUseVoiceInput && !isVoiceInputActive) : (isCreatingGame || !hasPromptText))}
                sx={{
                  '@keyframes morius-voice-pulse': {
                    '0%, 100%': {
                      transform: 'scale(1)',
                      boxShadow: '0 0 0 0 color-mix(in srgb, var(--morius-accent) 34%, transparent)',
                    },
                    '50%': {
                      transform: 'scale(1.03)',
                      boxShadow: '0 0 0 7px color-mix(in srgb, var(--morius-accent) 0%, transparent)',
                    },
                  },
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 'var(--morius-action-size)',
                  height: 'var(--morius-action-size)',
                  borderRadius: 'var(--morius-radius)',
                  backgroundColor: isGenerating ? 'transparent' : 'var(--morius-send-button-bg)',
                  border: isGenerating ? 'none' : 'var(--morius-border-width) solid var(--morius-card-border)',
                  color: isGenerating ? 'var(--morius-accent)' : sendButtonIconColor,
                  ...(isVoiceInputActive && showMicAction
                    ? {
                        color: sendButtonIconColor,
                        backgroundColor: 'color-mix(in srgb, var(--morius-send-button-bg) 78%, var(--morius-accent) 22%)',
                        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border) 42%)',
                        animation: 'morius-voice-pulse 1.05s ease-in-out infinite',
                      }
                    : {}),
                  '&:hover': {
                    backgroundColor: isGenerating ? 'transparent' : 'color-mix(in srgb, var(--morius-send-button-bg) 92%, #fff 8%)',
                  },
                  '&:active': {
                    backgroundColor: isGenerating ? 'transparent' : 'color-mix(in srgb, var(--morius-send-button-bg) 88%, #000 12%)',
                  },
                  '&:disabled': {
                    opacity: isGenerating ? 0.7 : 0.62,
                    color: isGenerating ? 'var(--morius-accent)' : sendButtonIconColor,
                    backgroundColor: isGenerating ? 'transparent' : 'var(--morius-send-button-bg)',
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
                ) : showMicAction ? (
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      transform: isVoiceInputActive ? 'scale(1.06)' : 'scale(1)',
                      transition: 'transform 120ms ease',
                    }}
                  >
                    <ComposerMicIcon />
                  </Box>
                ) : (
                  <Box
                    component="img"
                    src={icons.send}
                    alt=""
                    sx={{
                      width: 'var(--morius-action-icon-size)',
                      height: 'var(--morius-action-icon-size)',
                    }}
                  />
                )}
              </IconButton>
              {isVoiceInputActive && showMicAction ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.45}
                  sx={{
                    position: 'absolute',
                    left: 13,
                    bottom: 9,
                    color: 'var(--morius-accent)',
                    '@keyframes morius-voice-dot': {
                      '0%, 100%': {
                        opacity: 0.45,
                        transform: 'scale(0.88)',
                      },
                      '50%': {
                        opacity: 1,
                        transform: 'scale(1.2)',
                      },
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: 'var(--morius-accent)',
                      animation: 'morius-voice-dot 0.86s ease-in-out infinite',
                    }}
                  />
                  <Typography sx={{ fontSize: '0.73rem', lineHeight: 1, fontWeight: 700 }}>
                    дет запись...
                  </Typography>
                </Stack>
              ) : null}
            </Stack>

            <Stack
              data-tour-id="story-composer-controls"
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 80%, transparent)',
                px: 1.1,
                py: 0.78,
                gap: 0.8,
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                sx={{
                  gap: 0.74,
                  flexWrap: 'nowrap',
                  minWidth: 0,
                  flex: 1,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    <Box sx={{ whiteSpace: 'pre-line' }}>
                      {
                        'Стоимость хода зависит от использованного контекста:\nдо 1500 — 1 сол\n1500–3000 — 2 сола\n3000–4000 — 3 сола\n4000–5500 — 4 сола\n5500–7000 — 5 солов\n7000–8500 — 6 солов\n8500–10000 — 7 солов\n10000–11500 — 8 солов\n11500–13000 — 9 солов\n13000–15000 — 10 солов\nЭмбиент подсветка (если включена): +1 сол за ход'
                      }
                    </Box>
                  }
                >
                  <Stack
                    direction="row"
                    spacing={0.42}
                    alignItems="center"
                    sx={{
                      cursor: 'help',
                      px: 0.18,
                    }}
                  >
                    <Box
                      component="img"
                      src={icons.coin}
                      alt=""
                      sx={{
                        width: 15,
                        height: 15,
                        opacity: 0.96,
                        filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--morius-accent) 38%, transparent))',
                      }}
                    />
                    <Typography
                      sx={{
                        color: 'var(--morius-accent)',
                        fontSize: '1.02rem',
                        lineHeight: 1,
                        fontWeight: 800,
                        letterSpacing: '0.01em',
                      }}
                    >
                      {currentTurnCostTokens}
                    </Typography>
                  </Stack>
                </Tooltip>
                <IconButton
                  aria-label="Назад"
                  onClick={() => void handleUndoAssistantStep()}
                  disabled={!canUndoAssistantStep}
                  sx={{
                    width: 'var(--morius-action-size)',
                    height: 'var(--morius-action-size)',
                    borderRadius: 'var(--morius-radius)',
                    opacity: canUndoAssistantStep ? 0.95 : 0.45,
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                    backgroundColor: 'transparent',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, #fff 10%)' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.back}
                    alt=""
                    sx={{
                      width: 'var(--morius-action-icon-size)',
                      height: 'var(--morius-action-icon-size)',
                      opacity: 0.9,
                      filter: composerUtilityIconFilter,
                    }}
                  />
                </IconButton>
                <IconButton
                  aria-label="Отменить"
                  onClick={() => void handleRedoAssistantStep()}
                  disabled={!canRedoAssistantStep}
                  sx={{
                    width: 'var(--morius-action-size)',
                    height: 'var(--morius-action-size)',
                    borderRadius: 'var(--morius-radius)',
                    opacity: canRedoAssistantStep ? 0.95 : 0.45,
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                    backgroundColor: 'transparent',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, #fff 10%)' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.undo}
                    alt=""
                    sx={{
                      width: 'var(--morius-action-icon-size)',
                      height: 'var(--morius-action-icon-size)',
                      opacity: 0.9,
                      filter: composerUtilityIconFilter,
                    }}
                  />
                </IconButton>
                <IconButton
                  aria-label="Перегенерировать"
                  onClick={() => void handleRerollLastResponse()}
                  disabled={!canReroll}
                  sx={{
                    width: 'var(--morius-action-size)',
                    height: 'var(--morius-action-size)',
                    borderRadius: 'var(--morius-radius)',
                    opacity: canReroll ? 0.95 : 0.45,
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                    backgroundColor: 'transparent',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, #fff 10%)' },
                  }}
                >
                  <Box
                    component="img"
                    src={icons.reload}
                    alt=""
                    sx={{
                      width: 'var(--morius-action-icon-size)',
                      height: 'var(--morius-action-icon-size)',
                      opacity: 0.9,
                      filter: composerUtilityIconFilter,
                    }}
                  />
                </IconButton>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    isLatestTurnImageLoading
                      ? 'Генерируем кадр сцены'
                      : hasLatestTurnImage
                        ? 'Перегенерировать картинку'
                        : 'Сгенерировать картинку'
                  }
                >
                  <IconButton
                    aria-label={hasLatestTurnImage ? 'Перегенерировать картинку' : 'Сгенерировать картинку'}
                    onClick={handleGenerateLatestTurnImage}
                    disabled={!canGenerateLatestTurnImage}
                    sx={{
                      opacity: canGenerateLatestTurnImage ? 0.95 : 0.45,
                      width: 'var(--morius-action-size)',
                      height: 'var(--morius-action-size)',
                      borderRadius: 'var(--morius-radius)',
                      color: hasLatestTurnImage ? 'var(--morius-accent)' : secondaryGameButtonColor,
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                      backgroundColor: 'transparent',
                      transition: 'color .15s ease, opacity .15s ease',
                      '&:hover': {
                        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, #fff 10%)',
                        color: 'var(--morius-accent)',
                        opacity: 1,
                      },
                    }}
                  >
                    {isLatestTurnImageLoading ? (
                      <CircularProgress size={14} sx={{ color: 'var(--morius-accent)' }} />
                    ) : hasLatestTurnImage ? (
                      <ComposerRegenerateImageIcon />
                    ) : (
                      <ComposerGenerateImageIcon />
                    )}
                  </IconButton>
                </Tooltip>
              </Stack>
              <Typography
                sx={{
                  color: 'var(--morius-text-secondary)',
                  fontSize: '0.74rem',
                  lineHeight: 1,
                  flexShrink: 0,
                  pr: 0.1,
                }}
              >
                {`${inputValue.length}/${STORY_PROMPT_MAX_LENGTH}`}
              </Typography>

            </Stack>
          </Box>
      </Box>

      <BaseDialog
        open={bugReportDialogOpen}
        onClose={handleCloseBugReportDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.22rem' }}>Баг-репорт</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.05}>
            <Box
              component="input"
              value={bugReportTitleDraft}
              placeholder="Заголовок"
              maxLength={STORY_BUG_REPORT_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setBugReportTitleDraft(event.target.value.slice(0, STORY_BUG_REPORT_TITLE_MAX_LENGTH))
              }
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.94rem',
              }}
            />
            <TextLimitIndicator currentLength={bugReportTitleDraft.length} maxLength={STORY_BUG_REPORT_TITLE_MAX_LENGTH} />
            <Box
              component="textarea"
              value={bugReportDescriptionDraft}
              placeholder="Опишите баг подробно: что делали, что ожидали, что получили."
              maxLength={STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setBugReportDescriptionDraft(event.target.value.slice(0, STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH))
              }
              sx={{
                width: '100%',
                minHeight: 170,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.94rem',
                lineHeight: 1.43,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <TextLimitIndicator
              currentLength={bugReportDescriptionDraft.length}
              maxLength={STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.4 }}>
          <Button onClick={handleCloseBugReportDialog} disabled={isBugReportSubmitting} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSubmitBugReport()}
            disabled={isBugReportSubmitting || !bugReportTitleDraft.trim() || !bugReportDescriptionDraft.trim()}
            sx={{
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            {isBugReportSubmitting ? <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} /> : 'Отправить'}
          </Button>
        </DialogActions>
      </BaseDialog>

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
              'Не редактировать '
            ) : (
              'Разрешить редактирование '
            )}
          </MenuItem>
        ) : null}
        {cardMenuType === 'instruction' ? (
          <MenuItem
            onClick={() => {
              void handleToggleInstructionCardActive()
            }}
            disabled={isInstructionCardActionLocked || !selectedMenuInstructionCard || isSelectedMenuInstructionActiveUpdating}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuInstructionActiveUpdating ? (
              <CircularProgress size={14} sx={{ color: 'rgba(220, 231, 245, 0.92)' }} />
            ) : selectedMenuInstructionCard?.is_active ? (
              'Выключить'
            ) : (
              'Включить'
            )}
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={handleCardMenuEdit}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked || isSelectedMenuInstructionActiveUpdating
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked || isSelectedMenuPlotCardToggleUpdating
                  : isWorldCardActionLocked || isSelectedMenuWorldCardLocked || isSelectedMenuWorldCardAiEditUpdating
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          Редактировать
        </MenuItem>
        {cardMenuType === 'plot' ? (
          <MenuItem
            onClick={() => {
              void handleTogglePlotCardEnabled()
            }}
            disabled={isPlotCardActionLocked || !selectedMenuPlotCard || isSelectedMenuPlotCardToggleUpdating}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuPlotCardEnabledUpdating ? (
              <CircularProgress size={14} sx={{ color: 'rgba(220, 231, 245, 0.92)' }} />
            ) : selectedMenuPlotCard?.is_enabled ? (
              'Выключить'
            ) : (
              'Включить'
            )}
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            void handleCardMenuDelete()
          }}
          disabled={
            cardMenuType === null
              ? true
              : cardMenuType === 'instruction'
                ? isInstructionCardActionLocked || isSelectedMenuInstructionActiveUpdating
                : cardMenuType === 'plot'
                  ? isPlotCardActionLocked || isSelectedMenuPlotCardToggleUpdating
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
          {isCharacterWorldCardEditor ? (
            <Stack spacing={0.95}>
              <Stack spacing={0.7} alignItems="center">
                <Box
                  role="button"
                  tabIndex={editingWorldCard ? 0 : -1}
                  aria-label="зменить аватар персонажа"
                  onClick={() => {
                    if (!editingWorldCard || isWorldCardActionLocked) {
                      return
                    }
                    handleOpenWorldCardAvatarPicker(editingWorldCard.id)
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && editingWorldCard && !isWorldCardActionLocked) {
                      event.preventDefault()
                      handleOpenWorldCardAvatarPicker(editingWorldCard.id)
                    }
                  }}
                  sx={{
                    position: 'relative',
                    width: 248,
                    height: 248,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    cursor: editingWorldCard && !isWorldCardActionLocked ? 'pointer' : 'default',
                    border: '1px dashed rgba(194, 208, 226, 0.5)',
                    background: 'linear-gradient(135deg, rgba(30, 33, 39, 0.86), rgba(56, 60, 68, 0.9))',
                    outline: 'none',
                    '&:hover .morius-world-card-avatar-overlay': {
                      opacity: editingWorldCard && !isWorldCardActionLocked ? 1 : 0,
                    },
                    '&:focus-visible .morius-world-card-avatar-overlay': {
                      opacity: editingWorldCard && !isWorldCardActionLocked ? 1 : 0,
                    },
                  }}
                >
                  <CharacterAvatar
                    avatarUrl={editingWorldCardAvatarUrl}
                    avatarScale={editingWorldCard?.avatar_scale ?? 1}
                    fallbackLabel={worldCardTitleDraft || 'Персонаж'}
                    size={248}
                  />
                  <Box
                    className="morius-world-card-avatar-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(16, 18, 20, 0.58)',
                      opacity: 0,
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
                  {isSavingWorldCardAvatar ? (
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
              </Stack>
              <TextField
                label="мя"
                value={worldCardTitleDraft}
                onChange={(event) => setWorldCardTitleDraft(event.target.value.slice(0, STORY_CARD_TITLE_MAX_LENGTH))}
                fullWidth
                autoFocus
                disabled={isWorldCardActionLocked}
                inputProps={{ maxLength: STORY_CARD_TITLE_MAX_LENGTH }}
                helperText={<TextLimitIndicator currentLength={worldCardTitleDraft.length} maxLength={STORY_CARD_TITLE_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              <TextField
                label="Описание"
                value={worldCardContentDraft}
                onChange={(event) => setWorldCardContentDraft(event.target.value.slice(0, WORLD_CARD_CONTENT_MAX_LENGTH))}
                fullWidth
                multiline
                minRows={4}
                maxRows={8}
                disabled={isWorldCardActionLocked}
                inputProps={{ maxLength: WORLD_CARD_CONTENT_MAX_LENGTH }}
                helperText={<TextLimitIndicator currentLength={worldCardContentDraft.length} maxLength={WORLD_CARD_CONTENT_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              <TextField
                label="Триггеры"
                value={worldCardTriggersDraft}
                onChange={(event) => setWorldCardTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))}
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                disabled={isWorldCardActionLocked}
                placeholder="через запятую"
                inputProps={{ maxLength: STORY_TRIGGER_INPUT_MAX_LENGTH }}
                helperText={<TextLimitIndicator currentLength={worldCardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              {editingWorldCardKind === 'npc' ? (
                <Stack spacing={0.35}>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    Память NPC в контексте
                  </Typography>
                  <Box
                    component="select"
                    value={
                      worldCardMemoryTurnsDraft === null
                        ? 'always'
                        : worldCardMemoryTurnsDraft === NPC_WORLD_CARD_MEMORY_TURNS_DISABLED
                          ? 'off'
                          : String(worldCardMemoryTurnsDraft)
                    }
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                      const nextValue = event.target.value
                      if (nextValue === 'always') {
                        setWorldCardMemoryTurnsDraft(null)
                        return
                      }
                      if (nextValue === 'off') {
                        setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_MEMORY_TURNS_DISABLED)
                        return
                      }
                      setWorldCardMemoryTurnsDraft(Number(nextValue) as NpcMemoryTurnsOption)
                    }}
                    sx={{
                      width: '100%',
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.9rem',
                    }}
                  >
                    <option value="off">Отключено</option>
                    <option value="3">3 хода</option>
                    <option value="5">5 ходов</option>
                    <option value="10">10 ходов</option>
                    <option value="always">Помнить всегда</option>
                  </Box>
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Stack spacing={1.1}>
            <Box
              component="input"
              value={instructionTitleDraft}
              placeholder="Название карточки"
              maxLength={STORY_CARD_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setInstructionTitleDraft(event.target.value.slice(0, STORY_CARD_TITLE_MAX_LENGTH))
              }
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <TextLimitIndicator currentLength={instructionTitleDraft.length} maxLength={STORY_CARD_TITLE_MAX_LENGTH} />
            <Box
              component="textarea"
              value={instructionContentDraft}
              placeholder="Опишите стиль, жанр, формат и другие пожелания к ответам ."
              maxLength={8000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInstructionContentDraft(event.target.value.slice(0, 8000))}
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <TextLimitIndicator currentLength={instructionContentDraft.length} maxLength={8000} />
          </Stack>
          )}
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
              maxLength={STORY_CARD_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPlotCardTitleDraft(event.target.value.slice(0, STORY_CARD_TITLE_MAX_LENGTH))
              }
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <TextLimitIndicator currentLength={plotCardTitleDraft.length} maxLength={STORY_CARD_TITLE_MAX_LENGTH} />
            <Box
              component="textarea"
              value={plotCardContentDraft}
              placeholder="Кратко сохраните важные сюжетные события и детали."
              maxLength={STORY_PLOT_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setPlotCardContentDraft(event.target.value.slice(0, STORY_PLOT_CARD_CONTENT_MAX_LENGTH))
              }
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <TextLimitIndicator currentLength={plotCardContentDraft.length} maxLength={STORY_PLOT_CARD_CONTENT_MAX_LENGTH} />
            <Box
              component="input"
              value={plotCardTriggersDraft}
              placeholder="Триггеры через запятую: Алекс, клятва, договор"
              maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPlotCardTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))
              }
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />
            <TextLimitIndicator currentLength={plotCardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />
            <Stack spacing={0.35}>
              <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                Память карточки сюжета
              </Typography>
              <Box
                component="select"
                value={plotCardMemoryTurnsDraft === null ? 'off' : String(plotCardMemoryTurnsDraft)}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const nextValue = event.target.value
                  setPlotCardMemoryTurnsDraft(
                    nextValue === 'off' ? null : (Number(nextValue) as PlotMemoryTurnsOption),
                  )
                }}
                sx={{
                  width: '100%',
                  minHeight: 40,
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                  backgroundColor: 'var(--morius-card-bg)',
                  color: 'var(--morius-text-primary)',
                  px: 1.1,
                  outline: 'none',
                  fontSize: '0.9rem',
                }}
              >
                <option value="off">Выключить</option>
                <option value="2">2 хода</option>
                <option value="3">3 хода</option>
                <option value="5">5 ходов</option>
                <option value="10">10 ходов</option>
                <option value="15">15 ходов</option>
              </Box>
            </Stack>
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
        open={memoryBlockDialogOpen}
        onClose={handleCloseMemoryBlockDialog}
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
            {editingMemoryBlockId === null ? 'Новая карточка памяти' : 'Редактирование карточки памяти'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.1}>
            <Box
              component="input"
              value={memoryBlockTitleDraft}
              placeholder="Название карточки памяти"
              maxLength={STORY_MEMORY_BLOCK_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setMemoryBlockTitleDraft(event.target.value.slice(0, STORY_MEMORY_BLOCK_TITLE_MAX_LENGTH))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveMemoryBlock()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <TextLimitIndicator currentLength={memoryBlockTitleDraft.length} maxLength={STORY_MEMORY_BLOCK_TITLE_MAX_LENGTH} />
            <Box
              component="textarea"
              value={memoryBlockContentDraft}
              placeholder="Кратко зафиксируйте важный факт, изменение или событие."
              maxLength={STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setMemoryBlockContentDraft(event.target.value.slice(0, STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH))
              }
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveMemoryBlock()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 140,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <TextLimitIndicator currentLength={memoryBlockContentDraft.length} maxLength={STORY_MEMORY_BLOCK_CONTENT_MAX_LENGTH} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button onClick={handleCloseMemoryBlockDialog} disabled={isSavingMemoryBlock || isCreatingGame} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveMemoryBlock()}
            disabled={isSavingMemoryBlock || isCreatingGame}
            sx={{
              backgroundColor: 'var(--morius-card-bg)',
              color: 'var(--morius-text-primary)',
              minWidth: 118,
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingMemoryBlock || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingMemoryBlockId === null ? (
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
                color: 'var(--morius-text-primary)',
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
              maxLength={STORY_CARD_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setWorldCardTitleDraft(event.target.value.slice(0, STORY_CARD_TITLE_MAX_LENGTH))
              }
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <TextLimitIndicator currentLength={worldCardTitleDraft.length} maxLength={STORY_CARD_TITLE_MAX_LENGTH} />
            <Box
              component="textarea"
              value={worldCardContentDraft}
              placeholder="Кратко опишите сущность: внешность, роль, свойства, важные детали."
              maxLength={WORLD_CARD_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setWorldCardContentDraft(event.target.value.slice(0, WORLD_CARD_CONTENT_MAX_LENGTH))
              }
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
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
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
              maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setWorldCardTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))
              }
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />
            <TextLimitIndicator currentLength={worldCardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />
            {editingWorldCardKind === 'npc' ? (
              <Stack spacing={0.35}>
                <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                  Память NPC в контексте
                </Typography>
                <Box
                  component="select"
                  value={
                    worldCardMemoryTurnsDraft === null
                      ? 'always'
                      : worldCardMemoryTurnsDraft === NPC_WORLD_CARD_MEMORY_TURNS_DISABLED
                        ? 'off'
                        : String(worldCardMemoryTurnsDraft)
                  }
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    const nextValue = event.target.value
                    if (nextValue === 'always') {
                      setWorldCardMemoryTurnsDraft(null)
                      return
                    }
                    if (nextValue === 'off') {
                      setWorldCardMemoryTurnsDraft(NPC_WORLD_CARD_MEMORY_TURNS_DISABLED)
                      return
                    }
                    setWorldCardMemoryTurnsDraft(Number(nextValue) as NpcMemoryTurnsOption)
                  }}
                  sx={{
                    width: '100%',
                    minHeight: 40,
                    borderRadius: 'var(--morius-radius)',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                    backgroundColor: 'var(--morius-card-bg)',
                    color: 'var(--morius-text-primary)',
                    px: 1.1,
                    outline: 'none',
                    fontSize: '0.9rem',
                  }}
                >
                  <option value="off">Отключено</option>
                  <option value="3">3 хода</option>
                  <option value="5">5 ходов</option>
                  <option value="10">10 ходов</option>
                  <option value="always">Помнить всегда</option>
                </Box>
              </Stack>
            ) : null}
            <TextLimitIndicator currentLength={worldCardContentDraft.length} maxLength={WORLD_CARD_CONTENT_MAX_LENGTH} />
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
        initialMode={characterManagerInitialMode}
        initialCharacterId={characterManagerInitialCharacterId}
        onClose={handleCloseCharacterManager}
      />

      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode={instructionTemplateDialogMode}
        enableCommunityPicker={instructionTemplateDialogMode === 'picker'}
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
                    aria-label="зменить аватар персонажа"
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
                    placeholder="мя"
                    maxLength={STORY_CHARACTER_NAME_MAX_LENGTH}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setCharacterNameDraft(event.target.value.slice(0, STORY_CHARACTER_NAME_MAX_LENGTH))
                    }
                    sx={{
                      width: '100%',
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.96rem',
                    }}
                  />
                  <TextLimitIndicator currentLength={characterNameDraft.length} maxLength={STORY_CHARACTER_NAME_MAX_LENGTH} />
                  <Box
                    component="textarea"
                    value={characterDescriptionDraft}
                    maxLength={STORY_CHARACTER_DESCRIPTION_MAX_LENGTH}
                    placeholder="Описание персонажа"
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setCharacterDescriptionDraft(event.target.value.slice(0, STORY_CHARACTER_DESCRIPTION_MAX_LENGTH))
                    }
                    sx={{
                      width: '100%',
                      minHeight: 92,
                      resize: 'vertical',
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1.1,
                      py: 0.9,
                      outline: 'none',
                      fontSize: '0.92rem',
                      lineHeight: 1.4,
                      fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                    }}
                  />
                  <TextLimitIndicator
                    currentLength={characterDescriptionDraft.length}
                    maxLength={STORY_CHARACTER_DESCRIPTION_MAX_LENGTH}
                  />
                  <Box
                    component="input"
                    value={characterTriggersDraft}
                    placeholder="Триггеры через запятую"
                    maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setCharacterTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))
                    }
                    sx={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.9rem',
                    }}
                  />
                  <TextLimitIndicator currentLength={characterTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />
                  <Box
                    component="input"
                    value={characterNoteDraft}
                    placeholder="Пометка (до 20 символов)"
                    maxLength={STORY_CHARACTER_NOTE_MAX_LENGTH}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setCharacterNoteDraft(event.target.value.slice(0, STORY_CHARACTER_NOTE_MAX_LENGTH))
                    }
                    sx={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                      backgroundColor: 'var(--morius-card-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1.1,
                      outline: 'none',
                      fontSize: '0.9rem',
                    }}
                  />
                  <TextLimitIndicator currentLength={characterNoteDraft.length} maxLength={STORY_CHARACTER_NOTE_MAX_LENGTH} />
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
                        {renderPreviewableCharacterAvatar({
                          avatarUrl: character.avatar_url,
                          previewUrl: character.avatar_original_url ?? character.avatar_url,
                          avatarScale: character.avatar_scale,
                          fallbackLabel: character.name,
                          size: 34,
                        })}
                        <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.28}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontWeight: 700, fontSize: '0.94rem', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.name}</Typography>
                            {character.note ? (
                              <Typography
                                sx={{
                                  color: 'rgba(184, 218, 247, 0.96)',
                                  fontSize: '0.62rem',
                                  lineHeight: 1.2,
                                  fontWeight: 700,
                                  border: 'var(--morius-border-width) solid rgba(140, 188, 230, 0.44)',
                                  borderRadius: '999px',
                                  px: 0.5,
                                  py: 0.08,
                                  maxWidth: 98,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  flexShrink: 0,
                                }}
                                title={character.note}
                              >
                                {character.note}
                              </Typography>
                            ) : null}
                          </Stack>
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
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                          )}
                        </IconButton>
                      </Stack>
                    </Box>
                  ))}
                  {characters.length === 0 ? (
                    <Typography sx={{ color: 'color-mix(in srgb, var(--morius-text-secondary) 72%, transparent)', fontSize: '0.9rem' }}>
                      Персонажей пока нет. Создайте первого.
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <Stack spacing={0.85}>
              <Typography sx={{ color: 'rgba(190, 202, 220, 0.72)', fontSize: '0.9rem' }}>
                {characterDialogMode === 'select-main-hero'
                  ? 'Выберите персонажа для роли главного героя. После выбора смена будет недоступна.'
                  : 'Выберите персонажа для добавления как NPC.'}
              </Typography>
              <Stack direction="row" spacing={0.8}>
                <Button
                  onClick={() => setCharacterSelectionTab('my')}
                  disabled={isSavingCharacter || isSelectingCharacter || savingCommunityCharacterId !== null}
                  sx={{
                    minHeight: 34,
                    borderRadius: '10px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor:
                      characterSelectionTab === 'my' ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                  }}
                >
                  Мои персонажи
                </Button>
                <Button
                  onClick={() => setCharacterSelectionTab('community')}
                  disabled={isSavingCharacter || isSelectingCharacter || savingCommunityCharacterId !== null}
                  sx={{
                    minHeight: 34,
                    borderRadius: '10px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor:
                      characterSelectionTab === 'community'
                        ? 'var(--morius-button-active)'
                        : 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    textTransform: 'none',
                    '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                  }}
                >
                  Сообщество
                </Button>
              </Stack>
              <Box
                component="input"
                value={characterSelectionSearchQuery}
                placeholder="Поиск по имени, описанию, триггерам и автору"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setCharacterSelectionSearchQuery(event.target.value.slice(0, 240))
                }
                sx={{
                  width: '100%',
                  minHeight: 38,
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                  backgroundColor: 'var(--morius-card-bg)',
                  color: 'var(--morius-text-primary)',
                  px: 1.1,
                  outline: 'none',
                  fontSize: '0.9rem',
                }}
              />
              {characterSelectionTab === 'community' ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  <Box
                    component="select"
                    value={characterSelectionAddedFilter}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setCharacterSelectionAddedFilter(event.target.value as CommunityAddedFilter)
                    }
                    sx={{
                      flex: 1,
                      minHeight: 36,
                      borderRadius: '10px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1,
                      fontSize: '0.84rem',
                      outline: 'none',
                    }}
                  >
                    <option value="all">Все</option>
                    <option value="added">Сохраненные</option>
                    <option value="not_added">Не сохраненные</option>
                  </Box>
                  <Box
                    component="select"
                    value={characterSelectionSortMode}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setCharacterSelectionSortMode(event.target.value as CommunitySortMode)
                    }
                    sx={{
                      flex: 1,
                      minHeight: 36,
                      borderRadius: '10px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      color: 'var(--morius-text-primary)',
                      px: 1,
                      fontSize: '0.84rem',
                      outline: 'none',
                    }}
                  >
                    <option value="updated_desc">Сначала новые</option>
                    <option value="rating_desc">По рейтингу</option>
                    <option value="additions_desc">По добавлениям</option>
                  </Box>
                </Stack>
              ) : null}
              <Box className="morius-scrollbar" sx={{ maxHeight: 390, overflowY: 'auto', pr: 0.2 }}>
                {characterSelectionTab === 'my' ? (
                  <Stack spacing={0.75}>
                    {characterDialogMode === 'select-npc' ? (
                      <Button
                        onClick={handleStartCreateCharacterFromNpcSelector}
                        aria-label="Create character"
                        disabled={isSavingCharacter || isSelectingCharacter}
                        sx={{
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)',
                          minHeight: 72,
                          color: 'var(--morius-text-primary)',
                          textTransform: 'none',
                          alignItems: 'center',
                          justifyContent: 'center',
                          '&:hover': {
                            backgroundColor: 'rgba(129, 151, 182, 0.14)',
                            borderColor: 'color-mix(in srgb, var(--morius-accent) 66%, transparent)',
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
                    {filteredOwnCharacterOptions.map((character) => {
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
                            color: 'var(--morius-text-primary)',
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
                            {renderPreviewableCharacterAvatar({
                              avatarUrl: character.avatar_url,
                              previewUrl: character.avatar_original_url ?? character.avatar_url,
                              avatarScale: character.avatar_scale,
                              fallbackLabel: character.name,
                              size: 34,
                            })}
                            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--morius-title-text)', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {character.name}
                                </Typography>
                                {character.note ? (
                                  <Typography
                                    sx={{
                                      color: 'rgba(184, 218, 247, 0.96)',
                                      fontSize: '0.62rem',
                                      lineHeight: 1.2,
                                      fontWeight: 700,
                                      border: 'var(--morius-border-width) solid rgba(140, 188, 230, 0.44)',
                                      borderRadius: '999px',
                                      px: 0.5,
                                      py: 0.08,
                                      maxWidth: 98,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      flexShrink: 0,
                                    }}
                                    title={character.note}
                                  >
                                    {character.note}
                                  </Typography>
                                ) : null}
                              </Stack>
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
                    {filteredOwnCharacterOptions.length === 0 ? (
                      <Typography sx={{ color: 'color-mix(in srgb, var(--morius-text-secondary) 72%, transparent)', fontSize: '0.9rem' }}>
                        Персонажи не найдены.
                      </Typography>
                    ) : null}
                  </Stack>
                ) : isLoadingCommunityCharacterOptions ? (
                  <Stack alignItems="center" justifyContent="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </Stack>
                ) : filteredCommunityCharacterOptions.length === 0 ? (
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem' }}>
                    Персонажи сообщества не найдены.
                  </Typography>
                ) : (
                  <Stack spacing={0.75}>
                    {filteredCommunityCharacterOptions.map((character) => {
                      const disabledReason = getCommunityCharacterSelectionDisabledReason(character, characterDialogMode)
                      const isExpanded = expandedCommunityCharacterId === character.id
                      const isLoadingDetails = loadingCommunityCharacterId === character.id
                      const isSavingCommunityCharacter = savingCommunityCharacterId === character.id
                      return (
                        <Box
                          key={character.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => void handleToggleCommunityCharacterCard(character.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleToggleCommunityCharacterCard(character.id)
                            }
                          }}
                          sx={{
                            borderRadius: '12px',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: isExpanded ? 'var(--morius-button-hover)' : 'var(--morius-elevated-bg)',
                            px: 0.9,
                            py: 0.75,
                            cursor: 'pointer',
                          }}
                        >
                          <Stack spacing={0.35}>
                            <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                              {renderPreviewableCharacterAvatar({
                                avatarUrl: character.avatar_url,
                                previewUrl: character.avatar_original_url ?? character.avatar_url,
                                avatarScale: character.avatar_scale,
                                fallbackLabel: character.name,
                                size: 34,
                              })}
                              <Stack spacing={0.18} sx={{ minWidth: 0, flex: 1 }}>
                                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                                  <Typography
                                    sx={{
                                      color: 'var(--morius-title-text)',
                                      fontWeight: 700,
                                      fontSize: '0.94rem',
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
                                    <Typography
                                      sx={{
                                        color: 'rgba(184, 218, 247, 0.96)',
                                        fontSize: '0.62rem',
                                        lineHeight: 1.2,
                                        fontWeight: 700,
                                        border: 'var(--morius-border-width) solid rgba(140, 188, 230, 0.44)',
                                        borderRadius: '999px',
                                        px: 0.5,
                                        py: 0.08,
                                        maxWidth: 98,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        flexShrink: 0,
                                      }}
                                      title={character.note}
                                    >
                                      {character.note}
                                    </Typography>
                                  ) : null}
                                </Stack>
                                <Typography sx={{ color: 'rgba(181, 199, 220, 0.82)', fontSize: '0.74rem' }}>
                                  Автор: {character.author_name || 'Неизвестно'}
                                </Typography>
                              </Stack>
                              {isLoadingDetails ? (
                                <CircularProgress size={14} sx={{ color: 'rgba(208, 219, 235, 0.84)' }} />
                              ) : null}
                            </Stack>
                            <Typography
                              sx={{
                                color: 'rgba(207, 217, 232, 0.86)',
                                fontSize: '0.84rem',
                                lineHeight: 1.36,
                                whiteSpace: isExpanded ? 'pre-wrap' : 'normal',
                                display: isExpanded ? 'block' : '-webkit-box',
                                WebkitLineClamp: isExpanded ? 'none' : 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {character.description}
                            </Typography>
                            <Stack direction="row" spacing={0.9} alignItems="center" sx={{ color: 'rgba(181, 199, 220, 0.82)', fontSize: '0.74rem' }}>
                              <Typography sx={{ fontSize: 'inherit' }}>
                                {character.community_additions_count} + / {character.community_rating_avg.toFixed(1)} 
                              </Typography>
                              <Typography sx={{ fontSize: 'inherit', fontWeight: 700 }}>
                                {disabledReason
                                  ? disabledReason
                                  : character.is_added_by_user
                                    ? 'Сохранено'
                                    : 'Не сохранено'}
                              </Typography>
                            </Stack>
                            {isExpanded ? (
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ pt: 0.35 }}>
                                <Button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedCommunityCharacterId(null)
                                  }}
                                  disabled={isSelectingCharacter || isSavingCommunityCharacter}
                                  sx={{
                                    textTransform: 'none',
                                    minHeight: 34,
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                    backgroundColor: 'transparent',
                                    color: 'var(--morius-text-secondary)',
                                    '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                                  }}
                                >
                                  Свернуть
                                </Button>
                                <Button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleApplyCommunityCharacterForGame(character, { saveToProfile: false })
                                  }}
                                  disabled={Boolean(disabledReason) || isSelectingCharacter || isSavingCommunityCharacter}
                                  sx={{
                                    textTransform: 'none',
                                    minHeight: 34,
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                    backgroundColor: 'transparent',
                                    color: 'var(--morius-text-primary)',
                                    '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                                  }}
                                >
                                  {isSavingCommunityCharacter ? (
                                    <CircularProgress size={14} sx={{ color: 'var(--morius-text-primary)' }} />
                                  ) : (
                                    'Добавить'
                                  )}
                                </Button>
                                <Button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleApplyCommunityCharacterForGame(character, { saveToProfile: true })
                                  }}
                                  disabled={Boolean(disabledReason) || isSelectingCharacter || isSavingCommunityCharacter}
                                  sx={{
                                    textTransform: 'none',
                                    minHeight: 34,
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                    backgroundColor: 'transparent',
                                    color: 'var(--morius-text-primary)',
                                    '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                                  }}
                                >
                                  Сохранить
                                </Button>
                              </Stack>
                            ) : null}
                          </Stack>
                        </Box>
                      )
                    })}
                  </Stack>
                )}
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

      <BaseDialog
        open={openedAiMemoryBlock !== null}
        onClose={() => setOpenedAiMemoryBlockId(null)}
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
          <Typography sx={{ fontWeight: 700, fontSize: '1.2rem' }}>
            {openedAiMemoryBlock ? `#${openedAiMemoryBlock.id} В· ${openedAiMemoryBlock.title}` : 'Блок  памяти'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          <Typography
            sx={{
              color: 'var(--morius-text-primary)',
              fontSize: '0.94rem',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {openedAiMemoryBlock?.content ?? ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.4 }}>
          <Button
            onClick={() => {
              if (!openedAiMemoryBlock || openedAiMemoryBlock.layer !== 'key') {
                return
              }
              handleOpenEditMemoryBlockDialog(openedAiMemoryBlock)
            }}
            disabled={isMemoryCardActionLocked || !openedAiMemoryBlock || openedAiMemoryBlock.layer !== 'key'}
            sx={{ color: 'var(--morius-text-primary)' }}
          >
            Редактировать
          </Button>
          <Button
            onClick={() => {
              if (!openedAiMemoryBlock || openedAiMemoryBlock.layer !== 'key') {
                return
              }
              handleRequestDeleteMemoryBlock(openedAiMemoryBlock)
            }}
            disabled={isMemoryCardActionLocked || !openedAiMemoryBlock || openedAiMemoryBlock.layer !== 'key'}
            sx={{ color: 'rgba(248, 176, 176, 0.94)' }}
          >
            Удалить
          </Button>
          <Button onClick={() => setOpenedAiMemoryBlockId(null)} sx={{ color: 'text.secondary' }}>
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
          <Box
            component="img"
            src={characterAvatarPreview.url}
            alt={characterAvatarPreview.name || 'Character avatar'}
            sx={{
              width: 'auto',
              height: 'auto',
              maxWidth: 'none',
              maxHeight: 'none',
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              display: 'block',
              mx: 'auto',
            }}
          />
        ) : null}
      </BaseDialog>

      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
        onNavigate={onNavigate}
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


